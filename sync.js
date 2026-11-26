// Teigbuch – Geräte-Sync über Supabase (ohne Bibliothek, nur fetch)
//
// Prinzip „offline zuerst“: Alles liegt lokal (IndexedDB). Der Abgleich holt zuerst neue Daten
// vom Server (pull), dann schickt er lokale Änderungen hoch (push). Bei Konflikten gewinnt die
// zuletzt gespeicherte Version (updatedAt). Gelöschtes wird als „Grabstein“ (deleted=true) übertragen.
import * as db from './db.js';
import { safeId } from './calc.js';
import { importRecipe, importLog, importCulture, importFlour } from './migrate.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const AUTH_ID = 'auth', STATE_ID = 'sync';
const freshState = (userId = null) => ({ id: STATE_ID, userId, lastPull: 0, synced: {}, pendingDeletes: [], uploaded: [], lastOk: 0, lastError: '' });

const cfg = { url: '', key: '' };
let auth = null;
let state = freshState();
let running = null;
const listeners = new Set();

export async function init(settings = {}) {
  setConfig(settings.sbUrl || SUPABASE_URL, settings.sbKey || SUPABASE_ANON_KEY);
  auth = (await db.get('meta', AUTH_ID)) || null;
  state = { ...freshState(), ...((await db.get('meta', STATE_ID)) || {}) };
  db.setPhotoFetcher(fetchPhoto);
  await handleLinkLogin();
}

export function setConfig(url, key) {
  cfg.url = String(url || '').trim().replace(/\/+$/, '');
  cfg.key = String(key || '').trim();
}
export const configured = () => /^https:\/\/.+/.test(cfg.url) && cfg.key.length > 20;
export const fromConfigFile = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const loggedIn = () => !!auth?.refresh_token;
export const info = () => ({
  configured: configured(), loggedIn: loggedIn(), email: auth?.user?.email || '', running: !!running,
  lastOk: state.lastOk, lastError: state.lastError, pending: state.pendingDeletes.length,
  // Supabase-Tabelle kennt die Datenart „culture“ noch nicht → einmalig SQL ausführen (siehe Anleitung)
  cultureSql: !!state.cultureSql,
  flourSql: !!state.flourSql,
});
export const onUpdate = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => { try { fn(info()); } catch { /* ignore */ } });
const saveState = () => db.put('meta', state);

// ---------- HTTP ----------
async function api(path, { method = 'GET', body, headers = {}, raw = false, authed = true } = {}) {
  if (!configured()) throw new Error('Sync ist nicht eingerichtet.');
  if (authed) await ensureToken();
  const h = { apikey: cfg.key, ...headers };
  if (authed) h.Authorization = `Bearer ${auth.access_token}`;
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(cfg.url + path, { method, headers: h, body: payload }); }
  catch { throw new Error('offline'); }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.msg || j.message || j.error_description || j.error || msg; } catch { /* kein JSON */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

function friendly(e) {
  if (e.message === 'offline') return 'Keine Verbindung zu Supabase (offline oder Projekt pausiert).';
  if (e.status === 401 || /jwt|token/i.test(e.message)) return 'Anmeldung abgelaufen – bitte neu anmelden.';
  if (e.status === 404) return 'Tabelle nicht gefunden – wurde das SQL-Skript ausgeführt?';
  if (e.status === 429) return 'Zu viele Anfragen – bitte kurz warten.';
  return e.message || 'Unbekannter Fehler';
}

// ---------- Anmeldung (E-Mail-Code) ----------
function jwtPayload(token) {
  try {
    let p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (p.length % 4) p += '=';
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch { return {}; }
}

async function setSession(r) {
  const p = jwtPayload(r.access_token);
  auth = {
    id: AUTH_ID, access_token: r.access_token, refresh_token: r.refresh_token,
    expires_at: Date.now() + (Number(r.expires_in) || 3600) * 1000,
    user: { id: r.user?.id || p.sub, email: r.user?.email || p.email || '' },
  };
  await db.put('meta', auth);
  if (state.userId !== auth.user.id) {
    // Anderes Konto als zuvor auf diesem Gerät → App fragt, was mit den lokalen Daten passiert
    accountSwitched = !!state.userId;
    state = freshState(auth.user.id);
    await saveState();
  }
  emit();
}
let accountSwitched = false;
export function consumeAccountSwitch() { const v = accountSwitched; accountSwitched = false; return v; }

// Nur EINE Token-Erneuerung gleichzeitig (Fotos und Abgleich können parallel anfragen)
let refreshing = null;
async function ensureToken() {
  if (!auth) throw Object.assign(new Error('Nicht angemeldet'), { status: 401 });
  if (Date.now() < auth.expires_at - 60000) return;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: auth.refresh_token }, authed: false });
        await setSession(r);
      } catch (e) {
        if (e.status === 400 || e.status === 401) { await clearAuth(); throw Object.assign(new Error('Anmeldung abgelaufen'), { status: 401 }); }
        throw e;
      } finally { refreshing = null; }
    })();
  }
  await refreshing;
  if (!auth) throw Object.assign(new Error('Nicht angemeldet'), { status: 401 });
}

async function clearAuth() {
  auth = null;
  await db.del('meta', AUTH_ID);
  emit();
}

export async function sendCode(email) {
  try { await api('/auth/v1/otp', { method: 'POST', body: { email: email.trim(), create_user: true }, authed: false }); }
  catch (e) { throw new Error(friendly(e)); }
}

export async function verifyCode(email, code) {
  try {
    const r = await api('/auth/v1/verify', { method: 'POST', body: { type: 'email', email: email.trim(), token: String(code).replace(/\s/g, '') }, authed: false });
    await setSession(r);
  } catch (e) {
    throw new Error(e.status === 403 || e.status === 400 ? 'Code ungültig oder abgelaufen.' : friendly(e));
  }
}

// Anmelde-Link aus der E-Mail, in die App eingefügt (funktioniert ohne eigenen E-Mail-Server und
// auch in der installierten iPhone-App, wo ein angetippter Link in Safari landen würde).
// Akzeptiert: Supabase-Link (…/auth/v1/verify?token=…&type=…) oder eine bereits weitergeleitete
// App-Adresse (…#access_token=…&refresh_token=…).
export function parseLoginLink(text) {
  const m = String(text || '').match(/https?:\/\/\S+/);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace(/[)>\]"']+$/, ''));
    const token = u.searchParams.get('token') || u.searchParams.get('token_hash');
    if (token) return { token_hash: token, type: u.searchParams.get('type') || 'email' };
    const h = new URLSearchParams(u.hash.replace(/^#\/?/, ''));
    if (h.get('access_token') && h.get('refresh_token')) {
      return { session: { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: h.get('expires_in') } };
    }
  } catch { /* keine gültige Adresse */ }
  return null;
}

export async function verifyLink(text) {
  const p = parseLoginLink(text);
  if (!p) throw new Error('Das ist kein Anmelde-Link aus der E-Mail.');
  if (p.session) { await setSession(p.session); return; }
  // Ältere Link-Typen (magiclink/signup) und der neue Typ „email“ – nacheinander probieren
  const types = [...new Set([p.type, 'email'])];
  let last;
  for (const type of types) {
    try {
      const r = await api('/auth/v1/verify', { method: 'POST', body: { type, token_hash: p.token_hash }, authed: false });
      await setSession(r);
      return;
    } catch (e) { last = e; if (!(e.status === 400 || e.status === 403 || e.status === 422)) break; }
  }
  throw new Error(last && (last.status === 400 || last.status === 403 || last.status === 422)
    ? 'Link ungültig oder schon benutzt – bitte einen neuen Link anfordern.' : friendly(last || new Error('')));
}

// Falls doch der Link aus der E-Mail angetippt wurde: Tokens stehen im #-Teil der Adresse.
async function handleLinkLogin() {
  const h = location.hash;
  if (!h.includes('access_token=')) return;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname + '#/settings');
  if (p.get('access_token') && p.get('refresh_token')) {
    await setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') });
  }
}

export async function logout() {
  try { if (auth) await api('/auth/v1/logout', { method: 'POST' }); } catch { /* egal */ }
  await clearAuth();
}

// Lokal alles gelöscht → Sync-Stand zurücksetzen und abmelden (Cloud-Daten bleiben erhalten)
export async function resetLocal() {
  state = freshState();
  await saveState();
  await clearAuth();
}

// ---------- Abgleich ----------
// Löschungen auch merken, wenn gerade niemand angemeldet ist (z. B. abgelaufene Anmeldung) –
// sie werden beim nächsten Abgleich nachgereicht. Nur für Geräte, die schon einmal gesynct haben.
export async function markDeleted(kind, id) {
  if (!state.userId) return;
  state.pendingDeletes.push({ kind, id, at: Date.now() });
  delete state.synced[id];
  await saveState();
}

export const idle = () => running || Promise.resolve();

export async function syncNow() {
  if (!configured() || !loggedIn()) return 0;
  if (running) return running;
  running = (async () => {
    let changed = 0;
    try {
      changed = await pull();
      await pushPhotos();           // Fotos zuerst – damit andere Geräte sie finden, sobald das Rezept ankommt
      changed += await push();
      state.lastOk = Date.now();
      state.lastError = '';
      db.clearPhotoFetchFailures();
    } catch (e) {
      state.lastError = friendly(e);
      if (e.status === 401) await clearAuth();
    }
    await saveState();
    return changed;
  })();
  emit();
  try { return await running; } finally { running = null; emit(); }
}

// Server-Zeitstempel („…12:00:00.123456+00:00“) robust in ms umrechnen – Safari mag keine Mikrosekunden
const tsMs = (s) => {
  const t = Date.parse(String(s || '').replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(t) ? t : 0;
};

async function pull() {
  let changed = 0;
  // 10 s Überlappung, falls Einträge zeitgleich geschrieben wurden – doppelt verarbeiten schadet nicht
  const lastMs = typeof state.lastPull === 'number' ? state.lastPull : tsMs(state.lastPull);
  const since = lastMs ? new Date(lastMs - 10000).toISOString() : '1970-01-01T00:00:00Z';
  let maxSeen = lastMs;
  for (let offset = 0; ; offset += 1000) {
    const rows = await api(`/rest/v1/items?select=${ROW_FIELDS}&server_at=gt.${encodeURIComponent(since)}&order=server_at.asc&offset=${offset}&limit=1000`);
    for (const row of rows) {
      maxSeen = Math.max(maxSeen, tsMs(row.server_at));
      changed += await applyRow(row);
    }
    if (rows.length < 1000) break;
  }
  state.lastPull = maxSeen || lastMs || 0;
  return changed;
}

const ROW_FIELDS = 'id,kind,data,deleted,updated_at,server_at';

// Einen Server-Eintrag lokal übernehmen – die neuere Version gewinnt
async function applyRow(row) {
  const id = safeId(row.id);
  const store = { recipe: 'recipes', log: 'logs', culture: 'cultures', flour: 'flours' }[row.kind] || null;
  if (!store || !id) return 0;
  const remoteAt = Number(row.updated_at) || 0;
  // Hier schon gelöscht und noch nicht hochgeladen → nicht wieder auferstehen lassen
  if (state.pendingDeletes.some((d) => d.id === id && d.at >= remoteAt)) return 0;
  const local = await db.get(store, id);
  const localAt = local?.updatedAt || 0;
  if (row.deleted) {
    delete state.synced[id];
    if (!local || localAt > remoteAt) return 0;
    await removeLocal(store, local);
    return 1;
  }
  if (!row.data) return 0;
  if (!local || remoteAt > localAt) {
    // Daten von Geräten mit älterer App-Version erst auf den aktuellen Stand bringen
    const clean = (row.kind === 'recipe' ? importRecipe(row.data) : row.kind === 'culture' ? importCulture(row.data) : row.kind === 'flour' ? importFlour(row.data) : importLog(row.data)).rec;
    clean.id = id;
    clean.updatedAt = remoteAt;
    await db.put(store, clean);
    state.synced[id] = remoteAt;
    return 1;
  }
  if (localAt === remoteAt) state.synced[id] = remoteAt;
  return 0;
}

// Lokal löschen inkl. Fotos; bei Rezepten auch die zugehörigen Tagebuch-Einträge
async function removeLocal(store, rec) {
  for (const p of rec.photos || []) await db.deletePhoto(p);
  await db.del(store, rec.id);
  if (store === 'recipes') {
    for (const l of (await db.getAll('logs')).filter((x) => x.recipeId === rec.id)) {
      for (const p of l.photos || []) await db.deletePhoto(p);
      await db.del('logs', l.id);
      state.pendingDeletes.push({ kind: 'log', id: l.id, at: Date.now() });
      delete state.synced[l.id];
    }
  }
}

const strip = (o) => { const c = { ...o }; Object.keys(c).forEach((k) => { if (k.startsWith('_')) delete c[k]; }); return c; };

async function push() {
  const uid = auth.user.id;
  const rows = [];
  for (const [store, kind] of [['recipes', 'recipe'], ['logs', 'log']]) {
    for (const rec of await db.getAll(store)) {
      const at = rec.updatedAt || 0;
      if (state.synced[rec.id] !== at) rows.push({ user_id: uid, id: rec.id, kind, data: strip(rec), deleted: false, updated_at: at });
    }
  }
  const deletes = state.pendingDeletes.filter((d) => d.kind !== 'culture' && d.kind !== 'flour');
  deletes.forEach((d) => rows.push({ user_id: uid, id: d.id, kind: d.kind, data: null, deleted: true, updated_at: d.at }));
  const accepted = new Set();
  for (let i = 0; i < rows.length; i += 200) {
    // return=representation: der Server meldet zurück, welche Einträge er übernommen hat
    const res = await api('/rest/v1/items?on_conflict=user_id,id&select=id', {
      method: 'POST', body: rows.slice(i, i + 200), headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    });
    (res || []).forEach((x) => accepted.add(x.id));
  }
  // Kulturen (ab App 2.1) GETRENNT senden: Ist die Supabase-Tabelle noch nicht erweitert, scheitert nur dieser Teil –
  // Rezepte und Tagebuch synchronisieren trotzdem. Die App zeigt dann den Hinweis auf das einmalige SQL.
  // Ab App 2.6 genauso: „Meine Mehle“ (kind 'flour') in einer eigenen Anfrage
  for (const [store, kind] of [['cultures', 'culture'], ['flours', 'flour']]) {
    const cRows = [];
    for (const rec of await db.getAll(store)) {
      const at = rec.updatedAt || 0;
      if (state.synced[rec.id] !== at) cRows.push({ user_id: uid, id: rec.id, kind, data: strip(rec), deleted: false, updated_at: at });
    }
    const cDeletes = state.pendingDeletes.filter((d) => d.kind === kind);
    cDeletes.forEach((d) => cRows.push({ user_id: uid, id: d.id, kind, data: null, deleted: true, updated_at: d.at }));
    if (!cRows.length) continue;
    try {
      const res = await api('/rest/v1/items?on_conflict=user_id,id&select=id', {
        method: 'POST', body: cRows, headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      });
      (res || []).forEach((x) => accepted.add(x.id));
      rows.push(...cRows); deletes.push(...cDeletes);
      if (kind === 'culture') state.cultureSql = false; else state.flourSql = false;
    } catch (e) {
      if (/check|constraint|kind|23514|violat/i.test(String(e?.message || e))) { if (kind === 'culture') state.cultureSql = true; else state.flourSql = true; } else throw e;
    }
  }
  // Abgelehnt = der Server hat bereits eine neuere Version (z. B. von einem anderen Gerät) → diese holen
  const rejected = rows.filter((r) => !accepted.has(r.id)).map((r) => r.id);
  rows.forEach((r) => { if (!r.deleted && accepted.has(r.id)) state.synced[r.id] = r.updated_at; });
  state.pendingDeletes = state.pendingDeletes.filter((d) => !deletes.includes(d));
  let changed = 0;
  for (let i = 0; i < rejected.length; i += 100) {
    const ids = rejected.slice(i, i + 100).map(safeId).filter(Boolean).join(',');
    if (!ids) continue;
    for (const row of await api(`/rest/v1/items?select=${ROW_FIELDS}&id=in.(${ids})`)) changed += await applyRow(row);
  }
  return changed;
}

async function pushPhotos() {
  const uid = auth.user.id;
  const uploaded = new Set(state.uploaded);
  const refs = new Set([...(await db.getAll('recipes')).flatMap((r) => r.photos || []), ...(await db.getAll('logs')).flatMap((l) => l.photos || [])]);
  for (const id of refs) {
    if (uploaded.has(id)) continue;
    const ph = await db.get('photos', id);
    if (!ph) continue;
    try {
      await api(`/storage/v1/object/photos/${uid}/${encodeURIComponent(id)}`, {
        method: 'POST', body: new Blob([ph.data], { type: ph.type }), headers: { 'Content-Type': ph.type, 'x-upsert': 'true' }, raw: true,
      });
      uploaded.add(id);
      state.uploaded = [...uploaded];
    } catch (e) {
      // Ein einzelnes problematisches Foto darf den restlichen Abgleich nicht blockieren
      if (e.message === 'offline' || e.status === 401) throw e;
    }
  }
}

// Fotos, die auf diesem Gerät fehlen, bei Bedarf nachladen
async function fetchPhoto(id) {
  if (!configured() || !loggedIn()) return null;
  const res = await api(`/storage/v1/object/authenticated/photos/${auth.user.id}/${encodeURIComponent(id)}`, { raw: true });
  const blob = await res.blob();
  if (!state.uploaded.includes(id)) { state.uploaded.push(id); saveState(); }
  return blob;
}
