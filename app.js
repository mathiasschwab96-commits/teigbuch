// Teigbuch – App-Oberfläche
import * as db from './db.js';
import * as C from './calc.js';
import { qrSVG } from './qr.js';
import * as sync from './sync.js';
import * as MG from './migrate.js';
import * as X from './extras.js';
import * as KI from './ki-import.js';

const { calc, fmtG, fmtPct, fmtNum, fmtDur, fmtRel, fmtTime, fmtCountdown, planInfo, uid, num, PF_TYPES, STEP_KINDS, LOCATIONS, TEMPLATES } = C;
const VERSION = '1.8.1';
const EXPORT_META = { schema: MG.SCHEMA, appVersion: VERSION };
// Einheitlicher Weg für ALLE Daten von außen (Datei, QR, Sync): erst migrieren, dann bereinigen
const { importRecipe, importLog } = MG;
// Fallback für ältere Browser (iOS < 15.4)
if (typeof globalThis.structuredClone !== 'function') globalThis.structuredClone = (o) => JSON.parse(JSON.stringify(o));

const S = {
  recipes: [], logs: [], sessions: [],
  settings: { id: 'settings', nightFrom: 23, nightTo: 7, lastBackup: 0, ddtRoom: 22, ddtFlour: 21, ddtPf: 22, ddtFriction: 3, refRoom: 22,
    features: { tempComp: true, handsFree: true, voice: true, wakeLock: true, qr: true, nightOpt: true } },
  hands: null, ticks: new Set(), measOpen: null, ki: { input: '', answer: '', error: '' }, importPreview: null, scanStream: null, logNewPhotos: [], searchOpen: false,
  draft: null, draftOrig: null, draftNewPhotos: [], wiz: 0, openStep: null,
  logDraft: null, scale: null, plan: null, installEvt: null, listQuery: '', listFilter: 'all', sheetItems: [],
};

const CAT = {
  pizza: { label: 'Pizza', icon: '🍕', piece: 'Teigling', pieces: 'Teiglinge' },
  bread: { label: 'Brot', icon: '🍞', piece: 'Laib', pieces: 'Laibe' },
  other: { label: 'Sonstiges', icon: '🥐', piece: 'Stück', pieces: 'Stück' },
};
const FLOUR_PRESETS = ['Tipo 00', 'Tipo 0', 'Tipo 1', 'Manitoba', 'Semola rimacinata', 'Weizenmehl 550', 'Weizenvollkornmehl', 'Dinkelmehl 630', 'Roggenmehl 1150'];
const SUBRATINGS = {
  pizza: [['rim', 'Rand'], ['base', 'Boden'], ['taste', 'Geschmack'], ['digest', 'Bekömmlichkeit']],
  bread: [['crust', 'Kruste'], ['crumb', 'Krume'], ['spring', 'Ofentrieb'], ['taste', 'Geschmack']],
  other: [['texture', 'Textur'], ['taste', 'Geschmack']],
};

// ---------- Funktionen an/aus ----------
const feat = (k) => S.settings.features?.[k] !== false;
// Schritte eines Backvorgangs inkl. Temperatur-Ausgleich
// (±-Verschiebungen per Knopf werden NACH dem Ausgleich addiert, damit +15 min auch +15 min bleiben)
const effSteps = (s) => (feat('tempComp') ? C.compensateSteps(s.steps, { room: s.room, refRoom: S.settings.refRoom }) : s.steps)
  .map((x) => (num(x.shiftMin) ? { ...x, durationMin: Math.max(1, num(x.durationMin) + num(x.shiftMin)) } : x));

// ---------- kleine Helfer ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const byId = (id) => S.recipes.find((r) => r.id === id);
const sessById = (id) => S.sessions.find((s) => s.id === id);
const catOf = (c) => CAT[c] || CAT.other;
const kindOf = (k) => STEP_KINDS[k] || STEP_KINDS.other;
const locOf = (l) => LOCATIONS[l] || LOCATIONS.rt;
const logsFor = (id) => S.logs.filter((l) => l.recipeId === id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
const avgRating = (id) => { const ls = logsFor(id).filter((l) => l.rating > 0); return ls.length ? ls.reduce((s, l) => s + l.rating, 0) / ls.length : 0; };
const coverOf = (r) => (r.cover && (r.photos || []).includes(r.cover) ? r.cover : (r.photos || [])[0] || null);
const pfLabel = (pfs) => (pfs?.length ? pfs.map((p) => `${esc(p.name || PF_TYPES[p.type]?.label)} ${fmtNum(p.flourPct, 0)} %`).join(' + ') : 'Direkte Führung');
const yeastName = (t) => (t === 'dry' ? 'Trockenhefe' : 'Frischhefe');
const fmtIn = (v, d = 2) => String(Math.round(num(v) * 10 ** d) / 10 ** d).replace('.', ',');
const stars = (v) => { const n = Math.round(v); return `<span class="stars-s" aria-label="${fmtNum(v)} von 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`; };
const p2 = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const fmtDate = (iso) => (iso ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso + 'T12:00')) : '');
const slug = (s) => (s || 'rezept').toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const I = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  book: '<path d="M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4z"/><path d="M5 16a4 4 0 0 1 4-4h9"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>',
  check: '<path d="M5 12l5 5L19 7"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  text: '<path d="M5 6h14M5 12h14M5 18h9"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Speichern ----------
async function saveRecipe(r) {
  r.updatedAt = Date.now();
  r.v = Math.max(MG.SCHEMA, num(r.v)); // Kennung einer neueren Version nie herabsetzen
  const i = S.recipes.findIndex((x) => x.id === r.id);
  if (i >= 0) S.recipes[i] = r; else S.recipes.push(r);
  await db.put('recipes', r);
  scheduleSync();
}
async function saveLog(l) {
  l.updatedAt = Date.now();
  l.v = Math.max(MG.SCHEMA, num(l.v));
  const i = S.logs.findIndex((x) => x.id === l.id);
  if (i >= 0) S.logs[i] = l; else S.logs.push(l);
  await db.put('logs', l);
  scheduleSync();
}

// ---------- Geräte-Sync ----------
let syncTimer = null;
function scheduleSync(delay = 3000) {
  if (!sync.loggedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}
async function runSync() {
  if (!sync.loggedIn() || !navigator.onLine) return;
  const changed = await sync.syncNow();
  if (changed > 0) {
    await reload();
    // Nicht neu zeichnen, während jemand tippt – sonst springt der Cursor
    if (!document.activeElement?.matches('input,textarea,select')) render();
  }
}
async function saveSession(s) {
  const i = S.sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) S.sessions[i] = s; else S.sessions.push(s);
  await db.put('sessions', s);
}
async function saveSettings() { await db.put('meta', S.settings); }

// Erfolge: neu erreichte melden. Beim allerersten Mal (Update) still übernehmen – keine Meldungsflut.
async function checkAchievements() {
  const earned = X.earnedAchievements({ recipes: S.recipes, logs: S.logs });
  if (!Array.isArray(S.settings.achSeen)) { S.settings.achSeen = earned; await saveSettings(); return []; }
  const fresh = earned.filter((id) => !S.settings.achSeen.includes(id));
  if (fresh.length) { S.settings.achSeen = [...S.settings.achSeen, ...fresh]; await saveSettings(); }
  return fresh.map((id) => X.ACHIEVEMENTS.find((a) => a.id === id));
}
function achievementsCard() {
  const earned = new Set(X.earnedAchievements({ recipes: S.recipes, logs: S.logs }));
  return `<details class="card ach"><summary>🏅 Erfolge <small class="muted">${earned.size} von ${X.ACHIEVEMENTS.length}</small></summary>
    <div class="ach-grid">${X.ACHIEVEMENTS.map((a) => `<div class="ach-i ${earned.has(a.id) ? 'on' : ''}"><span class="ach-ic">${earned.has(a.id) ? a.icon : '🔒'}</span><span><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></span></div>`).join('')}</div>
  </details>`;
}

// ---------- Router ----------
let lastHash = null;
function route() {
  const raw = location.hash.slice(1) || '/';
  const [path, q = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(q) };
}

function render() {
  const { parts, q } = route();
  const [a, b, c] = parts;
  const same = location.hash === lastHash;
  const y = window.scrollY;
  lastHash = location.hash;
  if (S.hands && !(a === 'bake' && b === S.hands)) { S.hands = null; keepAwake(false); }
  document.body.toggleAttribute('data-hands', !!S.hands);
  let out, tab = 'recipes';
  try {
    if (!a) out = vList();
    else if (a === 'r') out = vRecipe(b, q.get('tab') || 'ing');
    else if (a === 'edit') out = vEdit(b);
    else if (a === 'plan') out = vPlan(b);
    else if (a === 'bake') { tab = 'bake'; out = b ? vSession(b) : vBakeList(); }
    else if (a === 'log') out = vLog(b, c, q);
    else if (a === 'import') out = vImport(b || '');
    else if (a === 'fix') out = vFix();
    else if (a === 'ki') out = vKi();
    else if (a === 'settings') { tab = 'settings'; out = vSettings(); }
    else out = vNotFound();
  } catch (e) {
    console.error(e);
    out = { html: `<div class="pad"><h1 class="title">Ups</h1><p>Da ist etwas schiefgelaufen: ${esc(e.message)}</p><a class="btn" href="#/">Zur Übersicht</a></div>` };
  }
  view.innerHTML = out.html;
  document.body.dataset.view = a || 'list';
  $$('.tabbar a').forEach((el) => el.classList.toggle('on', el.dataset.tab === tab));
  const active = S.sessions.filter((s) => s.status === 'active').length;
  const badge = $('#bake-badge');
  badge.textContent = active || '';
  badge.hidden = !active;
  window.scrollTo(0, same ? y : 0);
  // Abgehakte Zutaten bleiben beim Neuzeichnen abgehakt
  if (S.ticks.size) $$('[data-action="tick"]').forEach((el) => { if (S.ticks.has(tickKey(el))) el.classList.add('checked'); });
  hydratePhotos();
  tick(true);
  out.after?.();
}

// Schlüssel für abgehakte Zutaten: Seite + Tabelle (data-tk) + Position darin + Name ohne „(8 °C)“-Zusatz
function tickKey(el) {
  const scope = el.closest('[data-tk]');
  const i = scope ? $$('[data-action="tick"]', scope).indexOf(el) : -1;
  const name = (el.firstElementChild?.firstChild?.textContent || '').replace(/\s*\(.*\)\s*$/, '');
  return `${location.hash}|${scope?.dataset.tk || ''}|${i}|${name}`;
}

function hydratePhotos() {
  $$('img[data-photo]').forEach((img) => {
    db.photoURL(img.dataset.photo).then((u) => {
      if (u) img.src = u; else img.closest('.ph')?.classList.add('missing');
    });
  });
}

const vNotFound = () => ({ html: `<div class="pad empty"><div class="empty-ic">🤷</div><h2>Nicht gefunden</h2><p>Dieses Rezept gibt es nicht (mehr).</p><a class="btn primary" href="#/">Zur Übersicht</a></div>` });

// ---------- Übersicht ----------
function vList() {
  const active = S.sessions.filter((s) => s.status === 'active');
  // Filter nur anbieten, wenn sie etwas bewirken
  const cats = new Set(S.recipes.map((r) => r.category));
  const filters = [['all', 'Alle'], ...[['pizza', '🍕 Pizza'], ['bread', '🍞 Brot'], ['other', '🥐 Sonstiges']].filter(([k]) => cats.has(k)),
    ...(S.recipes.some((r) => r.favorite) ? [['fav', '★ Favoriten']] : [])];
  const showSearch = S.searchOpen || S.listQuery;
  const html = `
  <header class="top">
    <div><div class="eyebrow">Pizza &amp; Brot</div><h1 class="title brand">Teigbuch</h1></div>
    ${S.recipes.length ? `<div class="top-actions"><button class="icon-btn tonal" data-action="toggleSearch" aria-label="Suchen">${icon('search')}</button></div>` : ''}
  </header>
  <div class="pad">
    ${sessionBanners(active)}
    ${fixHint()}
    ${backupHint()}
    ${S.recipes.length ? `
      ${showSearch ? `<div class="search">${icon('search')}<input type="search" id="q" data-input="search" placeholder="Name, Schlagwort …" value="${esc(S.listQuery)}" aria-label="Rezept suchen"></div>` : ''}
      ${filters.length > 2 ? `<div class="chips scroll">${filters.map(([k, l]) => `<button class="chip ${S.listFilter === k ? 'on' : ''}" data-action="filter" data-v="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="cards" id="cards">${listCards()}</div>` : emptyList()}
  </div>
  <a class="fab" href="#/edit/new">${icon('plus')}<span>Rezept</span></a>`;
  return { html, after: () => { if (S.searchOpen && !S.listQuery) $('#q')?.focus(); } };
}

function listCards() {
  const q = S.listQuery.trim().toLowerCase();
  const lastUsed = (r) => Math.max(r.updatedAt || 0, ...logsFor(r.id).map((l) => l.createdAt || 0));
  let list = S.recipes.slice().sort((a, b) => (!!b.favorite - !!a.favorite) || lastUsed(b) - lastUsed(a));
  if (S.listFilter === 'fav') list = list.filter((r) => r.favorite);
  else if (S.listFilter !== 'all') list = list.filter((r) => r.category === S.listFilter);
  if (q) list = list.filter((r) => [r.name, r.description, ...(r.tags || [])].join(' ').toLowerCase().includes(q));
  if (!list.length) return '<p class="muted center">Keine Treffer.</p>';
  return list.map((r) => {
    const cover = coverOf(r), avg = avgRating(r.id), n = logsFor(r.id).length;
    const info = planInfo(r.steps, 0);
    return `<a class="rcard" href="#/r/${r.id}">
      <div class="rcard-img ph">${cover ? `<img data-photo="${cover}" alt="">` : ''}<span class="ph-emoji">${catOf(r.category).icon}</span></div>
      <div class="rcard-body">
        <div class="rcard-title">${r.favorite ? '<span class="fav">★</span> ' : ''}${esc(r.name || 'Ohne Namen')}</div>
        <div class="meta">${pfLabel(r.preferments)} · ${fmtNum(r.water?.pct)} %${r.steps?.length ? ` · ${fmtDur(info.total)}` : ''}</div>
        ${avg ? `<div class="meta">${stars(avg)} <small>${n}×</small></div>` : ''}
      </div></a>`;
  }).join('');
}

function emptyList() {
  return `<div class="empty">
    <div class="empty-ic">🍕🍞</div>
    <h2>Dein Teigbuch ist noch leer</h2>
    <p>Lege dein erstes Rezept an – am schnellsten aus einer Vorlage. Alles lässt sich danach anpassen.</p>
    <a class="btn primary big" href="#/edit/new">${icon('plus')} Erstes Rezept anlegen</a>
    <button class="btn ghost" data-action="loadSamples">Beispielrezepte laden</button>
    <button class="btn ghost" data-action="importFile">${icon('upload')} Backup importieren</button>
  </div>`;
}

function backupHint() {
  if (!S.recipes.length || (S.settings.backupSnooze || 0) > Date.now()) return '';
  const days = S.settings.lastBackup ? Math.floor((Date.now() - S.settings.lastBackup) / 86400000) : null;
  if (days !== null && days < 30) return '';
  return `<div class="hint-card"><div>💾 <b>${days === null ? 'Noch nicht gesichert' : `Sicherung ${days} Tage alt`}</b></div>
    <div class="row gap"><button class="btn sm" data-action="exportAll">Sichern</button><button class="icon-btn x-btn" data-action="snoozeBackup" aria-label="Später erinnern">${icon('x')}</button></div></div>`;
}

function sessionBanner(s) {
  const now = Date.now();
  const info = planInfo(effSteps(s), s.startAt, now);
  const cur = info.tl.find((x) => !x.doneAt);
  const planned = cur && cur.i === 0 && cur.start > now;
  return `<a class="banner" href="#/bake/${s.id}">
    <div class="banner-k"><span>${planned ? '🗓️' : '🔥'} ${esc(s.recipeName)}</span><span>Backen ${fmtRel(info.bakeAt)}</span></div>
    <div class="banner-v">${cur ? `${esc(cur.name)} <span class="cd" data-cd="${planned ? cur.start : cur.end}" data-cd-mode="${planned ? 'start' : 'left'}"></span>` : '🎉 Fertig – wie war\'s?'}</div>
  </a>`;
}
function sessionBanners(list, max = 2) {
  return list.slice(0, max).map(sessionBanner).join('')
    + (list.length > max ? `<a class="more-link" href="#/bake">+ ${list.length - max} ${list.length - max === 1 ? 'weiterer Backvorgang' : 'weitere Backvorgänge'}</a>` : '');
}

// ---------- Fehlende Angaben nachtragen (nach Import oder App-Update) ----------
const recipesWithQuestions = () => S.recipes.map((r) => ({ r, qs: MG.openQuestions(r) })).filter((x) => x.qs.length);

function fixHint() {
  const n = recipesWithQuestions().length;
  return n ? `<div class="hint-card warnc"><div>📝 <b>${n === 1 ? '1 Rezept braucht' : `${n} Rezepte brauchen`} noch eine Angabe</b></div><a class="btn sm primary" href="#/fix">Nachtragen</a></div>` : '';
}

function vFix() {
  const items = recipesWithQuestions();
  S.fixAnswers ||= {};
  const field = (r, q) => {
    const key = `${r.id}:${q.id}`, cur = S.fixAnswers[key];
    if (q.input.type === 'choice') {
      return `<div class="fld"><span class="fld-l">${esc(q.question)}</span><div class="seg">${q.input.options.map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-action="fixPick" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
    }
    return fldU(esc(q.question), `<input class="in" inputmode="decimal" data-input="fixNum" data-k="${key}" value="${cur ?? ''}">`, q.input.unit || '');
  };
  const html = `
  <header class="top sub"><a class="icon-btn" href="#/" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Nach Import oder Update</div><h1 class="title sm">Angaben nachtragen</h1></div></header>
  <div class="pad">
    ${items.length ? `
      <p class="muted small">Bei diesen Rezepten fehlt eine Angabe, die die App nicht sicher ableiten kann. Bitte ergänze sie – alles andere wurde unverändert übernommen.</p>
      ${items.map(({ r, qs }) => `<section class="card"><div class="card-h"><b>${catOf(r.category).icon} ${esc(r.name || 'Ohne Namen')}</b><a class="small" href="#/r/${r.id}">ansehen</a></div>${qs.map((q) => field(r, q)).join('')}</section>`).join('')}
      <button class="btn primary big block" data-action="fixSave">${icon('check')} Speichern</button>`
    : `<div class="empty"><div class="empty-ic">✅</div><h2>Alles vollständig</h2><p>Bei keinem Rezept fehlt etwas.</p><a class="btn primary" href="#/">Zu den Rezepten</a></div>`}
  </div>`;
  return { html };
}

// ---------- Rezept-Detail ----------
function vRecipe(id, tab) {
  const r = byId(id);
  if (!r) return vNotFound();
  if (!S.scale || S.scale.id !== id) S.scale = { id, yield: { ...r.yield } };
  const cover = coverOf(r);
  const info = planInfo(r.steps, 0);
  const avg = avgRating(id);
  const logs = logsFor(id);
  const c = calc(r);
  const tabs = [['ing', 'Zutaten'], ['flow', 'Ablauf'], ['log', `Tagebuch${logs.length ? ` (${logs.length})` : ''}`]];
  let body = '';
  if (tab === 'flow') body = recipeFlow(r, info);
  else if (tab === 'log') body = recipeLog(r, logs);
  else body = recipeIng(r);
  const html = `
  <div class="hero ph ${cover ? 'has-img' : ''}">
    ${cover ? `<img data-photo="${cover}" alt="">` : ''}<span class="ph-emoji">${catOf(r.category).icon}</span>
    <a class="hbtn" href="#/" aria-label="Zurück">${icon('back')}</a>
    <div class="hbtns">
      <button class="hbtn ${r.favorite ? 'on' : ''}" data-action="fav" data-id="${id}" aria-label="Favorit">${icon('star')}</button>
      <a class="hbtn" href="#/edit/${id}" aria-label="Bearbeiten">${icon('edit')}</a>
      <button class="hbtn" data-action="recipeMenu" data-id="${id}" aria-label="Mehr">${icon('more')}</button>
    </div>
  </div>
  <div class="pad">
    <div class="eyebrow">${catOf(r.category).icon} ${catOf(r.category).label}${(r.tags || []).map((t) => ` · ${esc(t)}`).join('')}</div>
    <h1 class="title serif">${esc(r.name || 'Ohne Namen')}</h1>
    ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ''}
    ${r.source ? `<p class="small muted" style="margin:4px 0 0">Quelle: ${/^https?:\/\/\S+$/i.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${esc(r.source.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 48))}</a>` : esc(r.source)}</p>` : ''}
    <div class="facts">
      <span class="fact">💧 ${fmtPct(c.totals.hydration)}</span>
      <span class="fact">${r.preferments?.length ? `🧱 ${pfLabel(r.preferments)}` : '⚡ direkt'}</span>
      ${r.steps?.length ? `<span class="fact">⏱ ${fmtDur(info.total)}</span>` : ''}
      ${avg ? `<span class="fact">★ ${fmtNum(avg)} <small>(${logs.length})</small></span>` : ''}
    </div>
    ${MG.openQuestions(r).length ? `<div class="hint-card warnc"><div>📝 Hier fehlt noch eine Angabe: ${esc(MG.openQuestions(r)[0].question)}</div><a class="btn sm primary" href="#/fix">Nachtragen</a></div>` : ''}
    <a class="btn primary big block" href="#/plan/${id}">${icon('timer')} Backen planen</a>
    <div class="seg" role="tablist">${tabs.map(([k, l]) => `<a role="tab" class="${tab === k ? 'on' : ''}" href="#/r/${id}?tab=${k}">${l}</a>`).join('')}</div>
    <div id="tabbody">${body}</div>
  </div>`;
  return { html };
}

function recipeIng(r) {
  const y = S.scale.yield;
  const c = calc(r, { yield: y });
  const changed = scaleChanged(r);
  const cat = catOf(r.category);
  const orig = r.yield.mode === 'flour' ? `${fmtNum(r.yield.flour, 0)} g Mehl` : `${fmtNum(r.yield.count, 0)} × ${fmtNum(r.yield.pieceWeight, 0)} g`;
  const scaler = y.mode === 'flour'
    ? `<div class="scaler-row"><span class="unit-in"><input class="in" inputmode="decimal" data-input="scale" data-k="flour" value="${fmtIn(y.flour, 0)}"><span class="u">g Mehl</span></span></div>`
    : `<div class="scaler-row">
        <div class="stepper"><button data-action="scaleCount" data-d="-1" aria-label="weniger">−</button><input class="in" inputmode="numeric" data-input="scale" data-k="count" value="${fmtIn(y.count, 0)}" aria-label="Anzahl"><button data-action="scaleCount" data-d="1" aria-label="mehr">+</button></div>
        <span class="x">×</span>
        <span class="unit-in"><input class="in" inputmode="decimal" data-input="scale" data-k="pieceWeight" value="${fmtIn(y.pieceWeight, 0)}" aria-label="Gewicht pro ${cat.piece}"><span class="u">g</span></span>
      </div>`;
  return `
  <section class="card scaler">
    <div class="card-h"><b>Menge anpassen</b>
      <div class="seg small" style="margin:0">${[['pieces', cat.pieces], ['flour', 'Mehl']].map(([k, l]) => `<button class="${y.mode === k || (k === 'pieces' && y.mode !== 'flour') ? 'on' : ''}" data-action="scaleMode" data-v="${k}">${l}</button>`).join('')}</div>
    </div>
    ${scaler}
    <div class="muted small" id="sc-dough" style="margin-top:8px">${scaleInfo(r, c)}</div>
    <div class="row gap ${changed ? '' : 'hidden'}" id="sc-actions"><button class="btn sm ghost" data-action="scaleReset">Zurück auf ${orig}</button><button class="btn sm" data-action="scaleSave">Als Standard</button></div>
  </section>
  <div id="ing-box">${ingredientBlocks(c, r.yeastType, true)}</div>
  ${waterTempTool(r)}
  ${r.notes ? `<details class="card"><summary>📝 Notizen</summary><p class="pre">${esc(r.notes)}</p></details>` : ''}`;
}

// Skalierung: nur die tatsächlich wirksamen Werte vergleichen
function scaleChanged(r) {
  const y = S.scale?.id === r.id ? S.scale.yield : null;
  if (!y) return false;
  if (y.mode !== (r.yield.mode === 'flour' ? 'flour' : 'pieces')) return true;
  return y.mode === 'flour' ? num(y.flour) !== num(r.yield.flour)
    : num(y.count) !== num(r.yield.count) || num(y.pieceWeight) !== num(r.yield.pieceWeight);
}
function scaleInfo(r, c) {
  const base = calc(r);
  const f = base.D > 0 ? c.D / base.D : 1;
  return `Teig gesamt <b>${fmtG(c.D)}</b> · Mehl ${fmtG(c.F)}${Math.abs(f - 1) > 0.005 ? ` · <b>${fmtNum(f, 2)}×</b> Rezept` : ''}`;
}

function ingTable(title, sub, rows, cls = '') {
  const total = rows.reduce((s, x) => s + (x.g || 0), 0);
  return `<section class="ing ${cls}" ${title ? `data-tk="${esc(title.replace(/<[^>]*>/g, ''))}"` : ''}>
    ${title ? `<h3>${title}${sub ? `<small>${sub}</small>` : ''}</h3>` : ''}
    <table>${rows.map((x) => `<tr data-action="tick"><td>${esc(x.name)}${x.hint ? `<small>${esc(x.hint)}</small>` : ''}</td><td class="num">${fmtG(x.g)}</td></tr>`).join('')}
    <tr class="sum"><td>Summe</td><td class="num">${fmtG(total)}</td></tr></table>
  </section>`;
}

function pfRows(x, yt) {
  const rows = [];
  if (x.starter > 0) rows.push({ name: x.pf.type === 'madre' ? 'Lievito Madre (aufgefrischt)' : 'Anstellgut', hint: `${fmtNum(x.pf.starterHydration ?? 100, 0)} % Hydration`, g: x.starter });
  rows.push({ name: x.flourName || 'Mehl', g: x.freshFlour });
  rows.push({ name: 'Wasser', g: x.freshWater });
  if (x.yeast > 0) rows.push({ name: yeastName(yt), g: x.yeast });
  return rows;
}
function mainRows(c, yt) {
  const rows = [];
  c.pfs.forEach((x) => rows.push({ name: x.pf.name || 'Vorteig', hint: 'kompletter Vorteig', g: x.total }));
  c.main.flours.forEach((f) => { if (f.g > 0.05) rows.push({ name: f.name, g: f.g }); });
  const w = Math.max(0, c.main.water), ice = Math.min(w, num(c.main.ice));
  const wt = c.main.waterTemp;
  rows.push({ name: wt !== undefined && wt !== '' ? `Wasser (${fmtNum(wt)} °C)` : 'Wasser', g: w - ice });
  if (ice > 0) rows.push({ name: 'Eis', hint: 'ersetzt einen Teil des Wassers', g: ice });
  if (c.main.salt > 0) rows.push({ name: 'Salz', g: c.main.salt });
  if (c.main.yeast > 0) rows.push({ name: yeastName(yt), g: c.main.yeast });
  if (c.main.oil > 0) rows.push({ name: 'Öl', g: c.main.oil });
  c.main.extras.forEach((e) => { if (e.g > 0) rows.push({ name: e.name || 'Zutat', g: e.g }); });
  return rows;
}
function stageRows(c, stage, yt) {
  if (stage === 'main') return { title: 'Hauptteig', rows: mainRows(c, yt) };
  const x = c.pfs.find((p) => p.id === stage);
  return x ? { title: x.pf.name || 'Vorteig', rows: pfRows(x, yt) } : null;
}

function ingredientBlocks(c, yt, withTotals) {
  const warn = c.warnings.length ? `<div class="warn">${c.warnings.map((w) => `⚠️ ${esc(w)}`).join('<br>')}</div>` : '';
  const blocks = c.pfs.map((x, i) => ingTable(`${PF_TYPES[x.pf.type]?.icon || '🥣'} ${esc(x.pf.name || 'Vorteig')}`, `Stufe ${i + 1}`, pfRows(x, yt), 'pf')).join('');
  const main = ingTable('🌀 Hauptteig', c.pfs.length ? `Stufe ${c.pfs.length + 1}` : 'direkte Führung', mainRows(c, yt), 'main');
  let totals = '';
  if (withTotals) {
    const t = c.totals;
    const yeastEq = t.yeast > 0 ? (yt === 'dry' ? `≙ ${fmtG(t.yeast * 3)} Frischhefe` : `≙ ${fmtG(t.yeast / 3)} Trockenhefe`) : '';
    const rows = [
      ...t.flours.map((f) => [f.name, f.g, f.pct]),
      ['Wasser (Hydration)', t.water, t.hydration],
      t.oil > 0 && ['Öl', t.oil, (t.oil / t.flour) * 100],
      ['Salz', t.salt, (t.salt / t.flour) * 100],
      t.yeast > 0 && [yeastName(yt), t.yeast, (t.yeast / t.flour) * 100, yeastEq],
      ...c.main.extras.filter((e) => e.g > 0).map((e) => [e.name || 'Zutat', e.g, e.pct]),
    ].filter(Boolean);
    totals = `<details class="card totals"><summary>Σ Gesamtrezept <small class="muted">Bäckerprozente · ${fmtG(t.dough)}</small></summary>
      <section class="ing"><table>${rows.map(([n, g, pc, h]) => `<tr><td>${esc(n)}${h ? `<small>${esc(h)}</small>` : ''}</td><td class="num">${fmtG(g)}</td><td class="num pct">${fmtPct(pc)}</td></tr>`).join('')}
      ${c.pfs.length ? `<tr class="sub"><td>Mehl im Vorteig</td><td></td><td class="num pct">${fmtPct(t.pfFlourPct)}</td></tr>` : ''}
      ${t.oil > 0 ? `<tr class="sub"><td>Flüssigkeit inkl. Öl</td><td></td><td class="num pct">${fmtPct(t.hydrationOil)}</td></tr>` : ''}
      <tr class="sum"><td>Teig gesamt</td><td class="num">${fmtG(t.dough)}</td><td></td></tr></table>
    </section></details>`;
  }
  return warn + blocks + main + totals;
}

function waterTempTool(r) {
  const st = S.settings, hasPf = (r.preferments || []).length > 0;
  return `<details class="card tool" id="wt-tool"><summary>🌡️ Wassertemperatur <small class="muted">für ${fmtNum(r.ddt ?? 24)} °C Teig</small></summary>
    <p class="muted small">Reibung: Hand ≈ 2–3 °C, Spiralkneter ≈ 6–8 °C, Küchenmaschine ≈ 10–14 °C.</p>
    <div class="grid2">
      ${fldU('Zieltemperatur Teig', `<input class="in" inputmode="decimal" data-input="wt" data-k="ddt" value="${fmtIn(r.ddt ?? 24)}">`, '°C')}
      ${fldU('Raum', `<input class="in" inputmode="decimal" data-input="wt" data-k="ddtRoom" value="${fmtIn(st.ddtRoom)}">`, '°C')}
      ${fldU('Mehl', `<input class="in" inputmode="decimal" data-input="wt" data-k="ddtFlour" value="${fmtIn(st.ddtFlour)}">`, '°C')}
      ${hasPf ? fldU('Vorteig', `<input class="in" inputmode="decimal" data-input="wt" data-k="ddtPf" value="${fmtIn(st.ddtPf)}">`, '°C') : ''}
      ${fldU('Reibung', `<input class="in" inputmode="decimal" data-input="wt" data-k="ddtFriction" value="${fmtIn(st.ddtFriction)}">`, '°C')}
    </div>
    <div class="result" id="wt-res" data-rid="${r.id}">${waterTempResult(r)}</div>
  </details>`;
}
function waterTempResult(r) {
  const st = S.settings, hasPf = (r.preferments || []).length > 0;
  const t = C.waterTemp({ ddt: r.ddt ?? 24, room: st.ddtRoom, flour: st.ddtFlour, pf: st.ddtPf, friction: st.ddtFriction, hasPf });
  const note = t < 2 ? ' – Eiswasser bzw. teilweise Eiswürfel verwenden' : t > 38 ? ' – Vorsicht, über 38 °C leidet die Hefe' : '';
  return `Wasser mit <b>${fmtNum(t)} °C</b> verwenden${note}`;
}

function recipeFlow(r, info) {
  if (!r.steps?.length) return `<div class="empty small"><p>Noch kein Ablauf hinterlegt.</p><a class="btn primary" href="#/edit/${r.id}" data-action="editAt" data-step="5">Teigführung anlegen</a></div>`;
  const loc = C.locationMinutes(r.steps);
  return `
  <section class="card">
    <div class="flow-sum"><div><small>Gesamt</small><b>${fmtDur(info.total)}</b></div><div><small>Backen nach</small><b>${fmtDur(info.bakeOff)}</b></div></div>
    <div class="flowbar">${info.tl.filter((s) => !s.parallel).map((s) => `<i class="loc-${s.location}" style="flex:${Math.max(num(s.durationMin), 1)}" title="${esc(s.name)}"></i>`).join('')}</div>
    <div class="legend">
      ${loc.rt ? `<span><i class="loc-rt"></i>Raum ${fmtDur(loc.rt)}</span>` : ''}
      ${loc.fridge ? `<span><i class="loc-fridge"></i>Kühlschrank ${fmtDur(loc.fridge)}</span>` : ''}
      ${loc.warm ? `<span><i class="loc-warm"></i>Warm ${fmtDur(loc.warm)}</span>` : ''}
      ${loc.oven ? `<span><i class="loc-oven"></i>Ofen ${fmtDur(loc.oven)}</span>` : ''}
    </div>
  </section>
  <ol class="tl">${info.tl.map((s) => stepRow(s, `+${fmtDur(s.start / 60000)}`, r)).join('')}</ol>`;
}

// Eine Zeile im Zeitstrahl: Kopf immer sichtbar, Details per Tipp aufklappbar
function stepRow(s, when, r, extra = '', tail = '') {
  const k = kindOf(s.kind), l = locOf(s.location);
  const stageName = s.stage === 'main' ? 'Hauptteig' : (r?.preferments || []).find((p) => p.id === s.stage)?.name;
  const details = [
    s.temp && `🌡️ ${esc(s.temp)}`,
    stageName && `Zutaten: ${esc(stageName)}`,
    s.parallel && '⇉ läuft parallel zum vorherigen Schritt',
    s.repeat?.count && `🔁 ${s.repeat.count}× alle ${s.repeat.intervalMin} min`,
    s.meas && measLabel(s.meas) && `Gemessen: ${measLabel(s.meas)}`,
    s._comp && `<span class="comp">Temperatur-Ausgleich: ${fmtDur(s._comp.from)} → ${fmtDur(s.durationMin)} bei ${fmtNum(s._comp.actual)} °C</span>`,
    s._adj && `🪄 Nachtruhe: ${s._adj > 0 ? '+' : '−'}${fmtDur(Math.abs(s._adj))}`,
  ].filter(Boolean);
  const more = details.length || s.notes;
  const head = `<div class="tl-h"><b>${esc(s.name || k.label)}</b><span class="tl-when">${when}</span></div>
    <div class="tl-m"><span class="loc-chip loc-${s.location}">${l.icon} ${l.short}</span> ${fmtDur(s.durationMin)}${s._comp ? ' 🌡️' : ''}${s._adj ? ' 🪄' : ''}${s.repeat?.count ? ` · 🔁 ${s.repeat.count}×` : ''}${more ? ' · <span class="tl-more">mehr</span>' : ''}</div>`;
  const body = more
    ? `<details><summary>${head}</summary>${details.length ? `<div class="tl-m">${details.join('<br>')}</div>` : ''}${s.notes ? `<div class="tl-n">${esc(s.notes)}</div>` : ''}</details>`
    : head;
  return `<li class="tl-i loc-${s.location} ${extra}"><div class="tl-dot">${k.icon}</div><div class="tl-c">${body}</div>${tail}</li>`;
}

function recipeLog(r, logs) {
  const withHyd = logs.filter((l) => l.rating > 0 && num(l.params?.hydration) > 0);
  const best = logs.filter((l) => l.rating > 0).sort((a, b) => b.rating - a.rating)[0];
  return `
  <a class="btn block" href="#/log/${r.id}/new">${icon('plus')} Neuer Eintrag</a>
  ${best && logs.length > 1 ? `<details class="card"><summary>🏆 Bestes Ergebnis <small class="muted">${fmtDate(best.date)} · ${fmtPct(best.params?.hydration)}</small></summary>
    <div class="pchips">${paramChips(best.params)}</div>
    ${withHyd.length >= 2 ? hydChart(withHyd) : ''}</details>` : ''}
  ${logs.length ? logs.map((l) => logCard(l, r)).join('') : `<div class="empty small"><div class="empty-ic">📓</div><p>Noch keine Einträge. Halte nach dem Backen fest, was du verändert hast und wie es geworden ist.</p></div>`}`;
}

function paramChips(pr, plain = false) {
  if (!pr) return '';
  const items = [
    pr.hydration && `💧 ${fmtPct(pr.hydration)}`,
    pr.pf && `🧱 ${esc(pr.pf)}`,
    pr.count && pr.pieceWeight && `⚖️ ${fmtNum(pr.count, 0)} × ${fmtNum(pr.pieceWeight, 0)} g`,
    pr.yeastPct && `🦠 ${fmtPct(pr.yeastPct)} Hefe`,
    pr.salt && `🧂 ${fmtPct(pr.salt)}`,
    pr.totalHours && `⏱ ${fmtNum(pr.totalHours)} h`,
    pr.flour && `🌾 ${esc(pr.flour)}`,
  ].filter(Boolean);
  return plain ? items.join(' · ') : items.map((x) => `<span class="pchip">${x}</span>`).join('');
}

function logCard(l, r) {
  const subs = SUBRATINGS[r.category] || SUBRATINGS.other;
  const subTxt = subs.filter(([k]) => l.sub?.[k]).map(([k, lbl]) => `${lbl} ${l.sub[k]}/5`).join(' · ');
  const cond = [l.doughTemp && `Teig ${esc(l.doughTemp)} °C`, l.roomTemp && `Raum ${esc(l.roomTemp)} °C`, l.fridgeTemp && `Kühlschrank ${esc(l.fridgeTemp)} °C`, l.waterTemp && `Wasser ${esc(l.waterTemp)} °C`, l.iceG && `Eis ${esc(l.iceG)} g`, l.oven && esc(l.oven), l.bakeTemp && `${esc(l.bakeTemp)} °C`, l.bakeTime && esc(l.bakeTime)].filter(Boolean).join(' · ');
  const hyd = num(l.params?.hydration);
  return `<details class="card log">
    <summary><span class="log-d">${fmtDate(l.date)}</span>${hyd ? `<span class="log-h">💧 ${fmtPct(hyd)}</span>` : ''}<span class="grow"></span>${l.rating ? stars(l.rating) : '<small class="muted">–</small>'}</summary>
    <div class="pchips">${paramChips(l.params)}</div>
    ${subTxt ? `<div class="muted small">${subTxt}</div>` : ''}
    ${cond ? `<div class="muted small">🌡️ ${cond}</div>` : ''}
    ${l.notes ? `<p class="pre">${esc(l.notes)}</p>` : ''}
    ${l.nextTime ? `<p class="next">➡️ <b>Nächstes Mal:</b> ${esc(l.nextTime)}</p>` : ''}
    ${(l.photos || []).length ? `<div class="thumbs">${l.photos.map((p) => `<button class="ph thumb" data-action="viewPhoto" data-id="${p}"><img data-photo="${p}" alt=""></button>`).join('')}</div>` : ''}
    <div class="act-row">
      <button class="btn sm" data-action="bakeAgain" data-id="${l.id}">${icon('play')} So nochmal backen</button>
      <button class="btn sm ghost" data-action="applyLog" data-id="${l.id}">Ins Rezept</button>
      <a class="icon-btn" href="#/log/${r.id}/${l.id}" aria-label="Bearbeiten">${icon('edit')}</a>
    </div>
  </details>`;
}

function hydChart(logs) {
  const W = 320, H = 150, pad = { l: 34, r: 12, t: 12, b: 30 };
  const xs = logs.map((l) => num(l.params.hydration));
  let x0 = Math.floor(Math.min(...xs) - 1), x1 = Math.ceil(Math.max(...xs) + 1);
  if (x1 - x0 < 4) { x0 -= 2; x1 += 2; }
  const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - ((v - 0.5) / 5) * (H - pad.t - pad.b);
  const ticks = [];
  const step = Math.max(1, Math.round((x1 - x0) / 5));
  for (let v = x0; v <= x1; v += step) ticks.push(v);
  return `<section class="chart" style="margin-top:12px">
    <div class="card-h"><small class="muted">Hydration vs. Bewertung · ${logs.length} Backtage</small></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Streudiagramm Hydration gegen Bewertung">
      ${[1, 2, 3, 4, 5].map((s) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(s)}" y2="${Y(s)}" class="grid"/><text x="${pad.l - 8}" y="${Y(s) + 4}" text-anchor="end" class="ax">${s}★</text>`).join('')}
      ${ticks.map((v) => `<text x="${X(v)}" y="${H - 10}" text-anchor="middle" class="ax">${v} %</text>`).join('')}
      ${logs.map((l) => `<circle cx="${X(num(l.params.hydration))}" cy="${Y(l.rating)}" r="6" class="pt"><title>${fmtDate(l.date)}: ${fmtPct(l.params.hydration)} → ${l.rating}★</title></circle>`).join('')}
    </svg>
  </section>`;
}

// ---------- Editor (Schritt-für-Schritt) ----------
const WIZ = ['Grunddaten', 'Teigmenge', 'Mehl & Wasser', 'Vorteig', 'Salz, Hefe & Co.', 'Teigführung', 'Fotos & Notizen'];

// Ungespeicherten Entwurf verwerfen – inkl. der dafür neu hochgeladenen Fotos
function discardDraft() {
  S.draftNewPhotos.forEach((p) => db.deletePhoto(p));
  S.draftNewPhotos = [];
  S.draft = null;
}

function vEdit(id) {
  if (id === 'new') {
    if (S.draft && !S.draft._new) discardDraft();
  } else if (!S.draft || S.draft.id !== id) {
    const r = byId(id);
    if (!r) return vNotFound();
    discardDraft();
    S.draft = structuredClone(r);
    S.draft._tags = (r.tags || []).join(', ');
    S.draftOrig = { photos: [...(r.photos || [])] };
    S.draftNewPhotos = [];
    S.wiz = S.wizStart ?? 0;
    S.wizStart = null;
  }
  if (!S.draft) return templatePicker();
  const d = S.draft, w = S.wiz;
  const bodies = [wBasis, wMenge, wMehl, wVorteig, wZutaten, wAblauf, wDetails];
  const html = `
  <header class="top sub">
    <button class="icon-btn" data-action="editCancel" aria-label="Abbrechen">${icon('x')}</button>
    <div class="grow"><div class="eyebrow">${d._new ? 'Neues Rezept' : esc(d.name || 'Rezept')} · Schritt ${w + 1}/${WIZ.length}</div><h1 class="title sm">${WIZ[w]}</h1></div>
    <button class="btn sm primary" data-action="editSave">Speichern</button>
  </header>
  <nav class="wiz-dots">${WIZ.map((t, i) => `<button data-action="wizGo" data-i="${i}" class="${i === w ? 'on' : i < w ? 'done' : ''}" aria-label="${t}"><span>${i + 1}</span><small>${t}</small></button>`).join('')}</nav>
  <div class="pad wiz-body">${bodies[w](d)}</div>
  <div class="wiz-foot">
    <div class="live" data-live="summary" data-html>${liveSummary(calc(d), d)}</div>
    <div class="row gap">
      <button class="btn ghost" data-action="wizPrev" ${w === 0 ? 'disabled' : ''}>Zurück</button>
      ${w < WIZ.length - 1 ? `<button class="btn primary grow" data-action="wizNext">Weiter: ${WIZ[w + 1]}</button>` : `<button class="btn primary grow" data-action="editSave">${icon('check')} Rezept speichern</button>`}
    </div>
  </div>`;
  return { html, after: liveDraft };
}

// ---------- Rezept aus Bild / Link / Text (KI-Brücke) ----------
function vKi() {
  const k = S.ki;
  const share = typeof navigator.share === 'function';
  return { html: `
  <header class="top sub"><a class="icon-btn" href="#/edit/new" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Neues Rezept</div><h1 class="title sm">Aus Bild, Link oder Text</h1></div></header>
  <div class="pad">
    <section class="card">
      <div class="card-h"><b>① Auftrag an die KI</b></div>
      ${fld('Link oder Rezepttext <small class="muted">(optional)</small>', `<textarea class="in" rows="3" data-input="kiInput" placeholder="https://… oder Text, z. B. aus einer Videobeschreibung. Leer lassen, wenn du ein Foto/Screenshot anhängst.">${esc(k.input)}</textarea>`)}
      <div class="row gap wrap">
        <button class="btn primary" data-action="kiCopy">📋 Auftrag kopieren</button>
        ${share ? '<button class="btn" data-action="kiShare">📤 An KI-App teilen</button>' : ''}
      </div>
      <ol class="small login-steps">
        <li>Eine KI-App öffnen – z. B. ChatGPT, Claude, Gemini oder Copilot</li>
        <li>Auftrag einfügen und <b>Foto oder Screenshot des Rezepts anhängen</b></li>
        <li>Absenden und die <b>komplette Antwort</b> kopieren</li>
      </ol>
      <details class="info"><summary>ⓘ Auftrag ansehen</summary><textarea class="in mono" rows="6" readonly id="ki-prompt">${esc(KI.buildPrompt(k.input))}</textarea></details>
    </section>
    <section class="card">
      <div class="card-h"><b>② Antwort einfügen</b></div>
      <textarea class="in mono" rows="5" id="ki-answer" data-input="kiAnswer" placeholder="Antwort der KI hier einfügen (der Teil in { … } genügt)">${esc(k.answer)}</textarea>
      ${navigator.clipboard?.readText ? '<button class="btn sm ghost" data-action="kiPaste">📋 Aus Zwischenablage einfügen</button>' : ''}
      ${k.error ? `<div class="hint-card warnc small"><div>⚠️ ${esc(k.error)}</div></div>` : ''}
      <button class="btn primary big block" data-action="kiCreate">✨ Rezept erstellen</button>
      <p class="muted small" style="margin-bottom:0">Das Rezept öffnet sich zuerst im Editor – du prüfst alles und speicherst erst dann.</p>
    </section>
    <details class="card"><summary>Tipps &amp; Hinweise</summary>
      <ul class="small">
        <li><b>Videos:</b> Die meisten KIs können Videos nicht ansehen. Kopiere die Videobeschreibung oder mache Screenshots der Zutaten-Einblendungen.</li>
        <li><b>Links:</b> Nicht jede KI kann Webseiten öffnen. Klappt es nicht: Screenshots der Zutaten und Schritte anhängen.</li>
        <li><b>Mehrere Bilder</b> (Zutaten + Zubereitung) kannst du in den meisten KI-Apps gemeinsam anhängen.</li>
        <li>KIs machen Fehler – Mengen und Zeiten im Editor kurz gegenprüfen.</li>
        <li>Bild und Text gehen an den Anbieter der gewählten KI-App, nicht an Teigbuch. Schick dort nichts Vertrauliches mit.</li>
      </ul>
    </details>
  </div>` };
}

function templatePicker() {
  return { html: `
  <header class="top sub"><a class="icon-btn" href="#/" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Neues Rezept</div><h1 class="title sm">Womit startest du?</h1></div></header>
  <div class="pad">
    <a class="tpl ki-tpl" href="#/ki"><span class="tpl-ic">📷</span><span><b>Aus Bild, Link oder Text</b><small>Screenshot, Foto, Webseite oder Videobeschreibung – eine KI deiner Wahl liest das Rezept aus.</small></span></a>
    <p class="muted">Oder wähle eine Vorlage – Mengen, Vorteig und Ablauf sind schon ausgefüllt und lassen sich Schritt für Schritt anpassen.</p>
    <div class="tpl-grid">
      ${TEMPLATES.map((t) => `<button class="tpl" data-action="pickTpl" data-t="${t.id}"><span class="tpl-ic">${t.icon}</span><b>${t.name}</b><small>${t.desc}</small></button>`).join('')}
      <button class="tpl blank" data-action="pickBlank" data-c="pizza"><span class="tpl-ic">➕🍕</span><b>Leeres Pizzarezept</b><small>Alles selbst eingeben</small></button>
      <button class="tpl blank" data-action="pickBlank" data-c="bread"><span class="tpl-ic">➕🍞</span><b>Leeres Brotrezept</b><small>Alles selbst eingeben</small></button>
    </div>
  </div>` };
}

const fld = (label, inner, hint = '') => `<label class="fld"><span class="fld-l">${label}</span>${inner}${hint ? `<span class="fld-h">${hint}</span>` : ''}</label>`;
const fldU = (label, input, unit, hint = '') => fld(label, `<span class="unit-in">${input}<span class="u">${unit}</span></span>`, hint);
const numIn = (path, val, attrs = '') => `<input class="in" inputmode="decimal" data-bind="d.${path}" data-num value="${fmtIn(val)}" ${attrs}>`;
const txtIn = (path, val, ph = '') => `<input class="in" data-bind="d.${path}" value="${esc(val)}" placeholder="${esc(ph)}">`;

// ---------- Mengen wahlweise in % oder Gramm eingeben ----------
// Intern bleibt alles in Bäckerprozenten. Im Gramm-Modus wird der passende Prozentwert errechnet.
const gramMode = () => S.settings.unitMode === 'g';
function gramDef(key) {
  const d = S.draft, [a, b, c2] = key.split('.');
  if (a === 'salt') return { get: (c) => c.totals.salt, pct: () => num(d.salt), set: (v) => { d.salt = v; } };
  if (a === 'yeast') return { get: (c) => c.main.yeast, pct: () => num(d.yeastPct), set: (v) => { d.yeastPct = v; } };
  if (a === 'ex') { const e = d.extras[+b]; return { get: (c) => c.main.extras[+b]?.g || 0, pct: () => num(e?.pct), set: (v) => { e.pct = v; } }; }
  if (a === 'pf') {
    const pf = d.preferments[+b];
    // Gramm-Felder zeigen die FRISCH zugegebenen Mengen (wie im Rezepttext) – ohne Mehl/Wasser im Anstellgut
    const [g, p] = { flour: ['freshFlour', 'flourPct'], water: ['freshWater', 'hydration'], yeast: ['yeast', 'yeastPct'], starter: ['starter', 'starterPct'] }[c2];
    return { get: (c) => c.pfs[+b]?.[g] || 0, pct: () => num(pf?.[p]), set: (v) => { pf[p] = v; } };
  }
  return null;
}
// Prozentwert so lange anpassen, bis die gewünschte Grammzahl herauskommt (konvergiert in wenigen Schritten)
function solveGram(key, target) {
  if (key.startsWith('pf.')) { const [, i, f] = key.split('.'); solvePf(+i, f, target); return; }
  const g = gramDef(key);
  if (!g) return;
  if (!(target > 0)) { g.set(0); return; }
  let p = g.pct() > 0 ? g.pct() : 1;
  for (let k = 0; k < 15; k++) {
    g.set(p);
    const cur = g.get(calc(S.draft));
    if (!(cur > 0)) break;
    const next = (p * target) / cur;
    if (Math.abs(next - p) < 1e-7) break;
    p = next;
  }
  // Rundungsreste wie 50,0001 % auf glatte Werte setzen
  const r2 = Math.round(p * 100) / 100;
  g.set(Math.abs(p - r2) < 0.0005 ? r2 : Math.round(p * 10000) / 10000);
}
// Vorteig in Gramm: frisches Mehl, frisches Wasser, Anstellgut und Hefe GEMEINSAM in Prozente umrechnen,
// damit sich bereits eingetragene Werte nicht verschieben (Anstellgut enthält selbst Mehl und Wasser).
function solvePf(i, field, target) {
  const d = S.draft, pf = d.preferments[i];
  const x = calc(d).pfs[i];
  if (!pf || !x) return;
  const v = { flour: x.freshFlour, water: x.freshWater, starter: x.starter, yeast: x.yeast };
  v[field] = Math.max(0, num(target));
  const sh = num(pf.starterHydration ?? 100) / 100;
  const sFlour = v.starter / (1 + sh), sWater = v.starter - sFlour;
  // Nur Anstellgut ohne frisches Mehl: das reife Anstellgut selbst ist der Vorteig
  const onlyStarter = v.starter > 0 && v.flour <= 0;
  const flour = onlyStarter ? sFlour : v.flour + sFlour, water = onlyStarter ? sWater : v.water + sWater;
  const r = (n, dec = 4) => Math.round(n * 10 ** dec) / 10 ** dec;
  for (let k = 0; k < 8; k++) {
    const F = calc(d).F;
    if (!(F > 0)) break;
    pf.flourPct = r((flour / F) * 100);
    pf.hydration = flour > 0 ? r((water / flour) * 100, 2) : 0;
    pf.starterPct = onlyStarter || !(v.flour > 0) ? 0 : r((v.starter / v.flour) * 100, 2);
    if (onlyStarter) pf.hydration = r(sh * 100, 2);
    pf.yeastPct = flour > 0 ? r((v.yeast / flour) * 100) : 0;
  }
}
function amt(key, label, pctHint = '') {
  const input = gramMode()
    ? `<input class="in" inputmode="decimal" data-input="gram" data-gram="${key}">`
    : `<input class="in" inputmode="decimal" data-input="pctamt" data-gram="${key}" value="${fmtIn(gramDef(key)?.pct() ?? 0, 3)}">`;
  return fldU(label, input, gramMode() ? 'g' : '%', `<span data-live="amt-${key}"></span>${!gramMode() && pctHint ? ` · ${pctHint}` : ''}`);
}
const unitSeg = () => `<div class="unit-seg"><span class="muted small">Mengen eingeben in</span>
  <div class="seg small">${[['pct', '%'], ['g', 'Gramm']].map(([k, l]) => `<button class="${(gramMode() ? 'g' : 'pct') === k ? 'on' : ''}" data-action="setUnit" data-v="${k}">${l}</button>`).join('')}</div></div>`;

function wBasis(d) {
  return `
  ${fld('Name', txtIn('name', d.name, 'z. B. Pizza Napoletana mit Biga'))}
  <div class="fld"><span class="fld-l">Kategorie</span>
    <div class="seg">${Object.entries(CAT).map(([k, v]) => `<button class="${d.category === k ? 'on' : ''}" data-action="setCat" data-v="${k}">${v.icon} ${v.label}</button>`).join('')}</div>
  </div>
  ${fld('Kurzbeschreibung', `<textarea class="in" rows="2" data-bind="d.description" placeholder="Was macht dieses Rezept aus?">${esc(d.description)}</textarea>`)}
  ${fld('Quelle <small class="muted">(optional)</small>', txtIn('source', d.source || '', 'Link oder Buch, z. B. https://…'))}
  ${fld('Schlagworte', txtIn('_tags', d._tags ?? (d.tags || []).join(', '), 'z. B. Napoletana, Ooni, Party'), 'Mit Komma trennen – hilft bei der Suche.')}`;
}

function wMenge(d) {
  const cat = catOf(d.category), y = d.yield;
  const presets = d.category === 'bread' ? [500, 750, 900, 1000, 1500] : [200, 230, 250, 260, 280];
  return `
  <div class="seg">
    <button class="${y.mode !== 'flour' ? 'on' : ''}" data-action="setYieldMode" data-v="pieces">Nach ${cat.pieces}</button>
    <button class="${y.mode === 'flour' ? 'on' : ''}" data-action="setYieldMode" data-v="flour">Nach Mehlmenge</button>
  </div>
  ${y.mode === 'flour' ? `
    ${fldU('Mehl gesamt (inkl. Vorteig)', numIn('yield.flour', y.flour), 'g')}
    ${fldU(`Gewicht pro ${cat.piece} (optional)`, numIn('yield.pieceWeight', y.pieceWeight), 'g', `Ergibt ca. <b data-live="count"></b> ${cat.pieces}.`)}
  ` : `
    <div class="fld"><span class="fld-l">Anzahl ${cat.pieces}</span>
      <div class="stepper big"><button data-action="draftCount" data-d="-1" aria-label="weniger">−</button>${numIn('yield.count', y.count, 'id="d-count"')}<button data-action="draftCount" data-d="1" aria-label="mehr">+</button></div>
    </div>
    ${fldU(`Gewicht pro ${cat.piece}`, numIn('yield.pieceWeight', y.pieceWeight, 'id="d-pw"'), 'g')}
    <div class="chips">${presets.map((g) => `<button class="chip" data-action="setPw" data-v="${g}">${g} g</button>`).join('')}</div>
  `}
  ${fldU('Zuschlag für Verlust', numIn('yield.loss', y.loss), '%', 'Teig, der in Schüssel und Kneter hängen bleibt – meist 0–3 %.')}
  <div class="result-grid">
    <div><small>Teig gesamt</small><b data-live="dough"></b></div>
    <div><small>Mehl gesamt</small><b data-live="flour"></b></div>
  </div>`;
}

// Mehl-Bibliothek: nur Hintergrundinfos (eingeklappt) + ein Hinweis, wenn Mehl und Führung nicht zusammenpassen
function flourLib(d) {
  const known = [...new Map((d.flours || []).map((f) => [X.flourInfo(f.name), f.name]).filter(([i]) => i)).entries()];
  const hints = X.flourHints(d);
  if (!known.length && !hints.length) return '';
  return `${hints.map((h) => `<div class="hint-card warnc small"><div>🌾 ${esc(h)}</div></div>`).join('')}
    ${known.length ? `<details class="info"><summary>ⓘ Mehl-Infos <small class="muted">${known.map(([i]) => esc(i.name)).join(', ')}</small></summary>
      ${known.map(([i]) => `<p><b>${esc(i.name)}</b> · ca. ${esc(i.protein)} % Eiweiß${i.w !== '–' ? ` · W ${esc(i.w)}` : ''}<br><small>${esc(i.note)}</small></p>`).join('')}
      <p class="muted small">Richtwerte – je nach Hersteller verschieden. Maßgeblich ist die Angabe auf der Packung.</p></details>` : ''}`;
}

function wMehl(d) {
  const hydHints = [[60, 'fest'], [65, 'klassisch'], [68, 'Napoli'], [70, 'luftig'], [75, 'Sauerteig'], [80, 'Teglia']];
  return `
  <div class="fld"><span class="fld-l">Mehlmischung <small class="muted">(Anteile am Gesamtmehl)</small></span>
    ${(d.flours || []).map((f, i) => `<div class="row gap line">
      <input class="in grow" data-input="flourName" data-i="${i}" value="${esc(f.name)}" placeholder="Mehlsorte" list="flour-lib">
      <span class="unit-in w90"><input class="in" inputmode="decimal" data-bind="d.flours.${i}.pct" data-num value="${fmtIn(f.pct)}"><span class="u">%</span></span>
      ${d.flours.length > 1 ? `<button class="icon-btn" data-action="delFlour" data-i="${i}" aria-label="Entfernen">${icon('x')}</button>` : ''}
    </div>`).join('')}
    <details class="addmore">
      <summary><span class="btn sm ghost">${icon('plus')} Mehl dazumischen</span><small class="muted">Summe: <b data-live="blendSum"></b></small></summary>
      <div class="chips">${FLOUR_PRESETS.filter((n) => !(d.flours || []).some((f) => f.name === n)).map((n) => `<button class="chip" data-action="addFlour" data-v="${n}">${n}</button>`).join('')}<button class="chip" data-action="addFlour" data-v="">Eigenes …</button></div>
      <p class="muted small">Startet mit 20 % – wird vom ersten Mehl abgezogen, die Summe bleibt 100 %.</p>
    </details>
    <datalist id="flour-lib">${X.FLOUR_NAMES.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div id="flour-lib-box">${flourLib(d)}</div>
  </div>
  <div class="link-card">
    <div class="link-h"><b>💧 Wasser</b><small>Gib Hydration <u>oder</u> Wassermenge ein – das andere wird berechnet.</small></div>
    <div class="link-row">
      <span class="unit-in"><input class="in big" inputmode="decimal" data-input="link" data-link="water" data-unit="pct" value="${fmtIn(d.water.pct)}" aria-label="Hydration in Prozent"><span class="u">%</span></span>
      <span class="link-arrow">⇄</span>
      <span class="unit-in"><input class="in big" inputmode="decimal" data-input="link" data-link="water" data-unit="g" aria-label="Wassermenge in Gramm"><span class="u">g</span></span>
    </div>
    <div class="chips">${hydHints.map(([v, l]) => `<button class="chip" data-action="setHyd" data-v="${v}">${v} % <small>${l}</small></button>`).join('')}</div>
    <div class="muted small" data-live="hydHint"></div>
  </div>
  <details class="card" ${d.water.temp !== '' && d.water.temp !== undefined || num(d.water.icePct) > 0 ? 'open' : ''}>
    <summary>🌡️ Wassertemperatur &amp; Eis <small class="muted">optional</small></summary>
    <p class="muted small" style="margin-top:0">Gilt für das Wasser im Hauptteig. Eis ersetzt einen Teil davon – die Hydration bleibt gleich.</p>
    ${fldU('Wassertemperatur', `<input class="in" inputmode="decimal" data-input="wtemp" value="${d.water.temp !== '' && d.water.temp !== undefined ? fmtIn(d.water.temp, 1) : ''}" placeholder="z. B. 8">`, '°C')}
    <div class="fld"><span class="fld-l">Davon als Eis</span>
      <div class="link-row">
        <span class="unit-in"><input class="in" inputmode="decimal" data-input="ice" data-unit="pct" value="${num(d.water.icePct) > 0 ? fmtIn(d.water.icePct) : ''}" placeholder="0" aria-label="Eis in Prozent des Hauptteig-Wassers"><span class="u">%</span></span>
        <span class="link-arrow">⇄</span>
        <span class="unit-in"><input class="in" inputmode="decimal" data-input="ice" data-unit="g" placeholder="0" aria-label="Eis in Gramm"><span class="u">g</span></span>
      </div>
      <small class="muted" data-live="iceHint"></small>
    </div>
  </details>
  <details class="card" ${num(d.oil.pct) > 0 ? 'open' : ''}>
    <summary>🫒 Öl <small class="muted">optional</small></summary>
    <div class="link-row">
      <span class="unit-in"><input class="in" inputmode="decimal" data-input="link" data-link="oil" data-unit="pct" value="${fmtIn(d.oil.pct)}" aria-label="Öl in Prozent"><span class="u">%</span></span>
      <span class="link-arrow">⇄</span>
      <span class="unit-in"><input class="in" inputmode="decimal" data-input="link" data-link="oil" data-unit="g" aria-label="Öl in Gramm"><span class="u">g</span></span>
    </div>
    <div class="muted small" style="margin-top:8px">Flüssigkeit gesamt inkl. Öl: <b data-live="hydOil"></b></div>
  </details>`;
}

function wVorteig(d) {
  const flourNames = (d.flours || []).map((f) => f.name).filter(Boolean);
  const pfs = d.preferments || [];
  return `
  ${unitSeg()}
  <details class="info"><summary>ⓘ So wird gerechnet</summary><p>Prozentwerte beziehen sich auf das <b>Gesamtmehl</b>. Mehl und Wasser im Vorteig werden automatisch vom Hauptteig abgezogen – die Gesamthydration bleibt gleich. Hefe-Art (frisch/trocken) im nächsten Schritt.</p></details>
  ${pfs.length ? '' : '<div class="hint-card"><div>Kein Vorteig – <b>direkte Führung</b>.</div></div>'}
  ${pfs.map((pf, i) => {
    const t = PF_TYPES[pf.type] || PF_TYPES.custom;
    const sour = pf.type === 'levain' || pf.type === 'madre';
    const showYeast = !sour || num(pf.yeastPct) > 0;
    const showStarter = sour || pf.type === 'custom';
    return `<section class="card pf-card">
      <div class="row gap"><span class="pf-ic">${t.icon}</span><input class="in grow strong" data-bind="d.preferments.${i}.name" value="${esc(pf.name)}"><button class="icon-btn" data-action="delPf" data-i="${i}" aria-label="Vorteig entfernen">${icon('trash')}</button></div>
      <div class="seg small">${Object.entries(PF_TYPES).map(([k, v]) => `<button class="${pf.type === k ? 'on' : ''}" data-action="pfType" data-i="${i}" data-v="${k}">${v.label}</button>`).join('')}</div>
      <details class="info"><summary>ⓘ Typische Werte</summary><p>${t.info}</p></details>
      <div class="grid2">
        ${amt(`pf.${i}.flour`, gramMode() ? (showStarter ? 'Mehl (frisch)' : 'Mehl') : 'Mehlanteil', 'vom Gesamtmehl')}
        ${amt(`pf.${i}.water`, gramMode() ? (showStarter ? 'Wasser (frisch)' : 'Wasser') : 'Hydration')}
        ${showYeast ? amt(`pf.${i}.yeast`, `${yeastName(d.yeastType)}`, 'vom Vorteigmehl') : ''}
        ${showStarter ? amt(`pf.${i}.starter`, pf.type === 'madre' ? 'Madre (Anstellgut)' : 'Anstellgut', 'vom frischen Mehl') : ''}
        ${showStarter ? fldU(pf.type === 'madre' ? 'Hydration Madre' : 'Hydration Anstellgut', numIn(`preferments.${i}.starterHydration`, pf.starterHydration ?? 100), '%') : ''}
        ${flourNames.length > 1 ? fld('Mehlsorte', `<select class="in" data-bind="d.preferments.${i}.flourName">${flourNames.map((n) => `<option ${pf.flourName === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`) : ''}
      </div>
      <div class="pf-out" data-live="pf-${i}"></div>
    </section>`;
  }).join('')}
  <details class="addmore" ${pfs.length ? '' : 'open'}>
    <summary><span class="btn sm">${icon('plus')} Vorteig hinzufügen</span></summary>
    <div class="chips">${Object.entries(PF_TYPES).map(([k, v]) => `<button class="chip" data-action="addPf" data-v="${k}">${v.icon} ${v.label}</button>`).join('')}</div>
  </details>
  <div data-live="warnings" data-html></div>`;
}

function wZutaten(d) {
  const presets = ['Zucker', 'Diastatisches Malz', 'Honig', 'Milchpulver', 'Saaten', 'Kochstück'];
  return `
  ${unitSeg()}
  <div class="fld"><span class="fld-l">Hefe-Art <small class="muted">(gilt für das ganze Rezept)</small></span>
    <div class="seg">${[['fresh', 'Frischhefe'], ['dry', 'Trockenhefe']].map(([k, l]) => `<button class="${d.yeastType === k ? 'on' : ''}" data-action="setYeastType" data-v="${k}">${l}</button>`).join('')}</div>
  </div>
  <div class="grid2">
    ${amt('salt', 'Salz')}
    ${amt('yeast', `${yeastName(d.yeastType)} im Hauptteig`)}
  </div>
  <div class="muted small" data-live="yeast"></div>
  <div class="fld"><span class="fld-l">Weitere Zutaten</span>
    ${(d.extras || []).map((e, i) => `<div class="row gap line">
      <input class="in grow" data-bind="d.extras.${i}.name" value="${esc(e.name)}" placeholder="Zutat">
      <span class="unit-in w90">${gramMode() ? `<input class="in" inputmode="decimal" data-input="gram" data-gram="ex.${i}">` : `<input class="in" inputmode="decimal" data-input="pctamt" data-gram="ex.${i}" value="${fmtIn(e.pct)}">`}<span class="u">${gramMode() ? 'g' : '%'}</span></span>
      <span class="muted small w60" data-live="amt-ex.${i}"></span>
      <button class="icon-btn" data-action="delExtra" data-i="${i}" aria-label="Entfernen">${icon('x')}</button>
    </div>`).join('')}
    <details class="addmore">
      <summary><span class="btn sm ghost">${icon('plus')} Zutat hinzufügen</span></summary>
      <div class="chips">${presets.map((n) => `<button class="chip" data-action="addExtra" data-v="${n}">${n}</button>`).join('')}<button class="chip" data-action="addExtra" data-v="">Eigene …</button></div>
    </details>
  </div>
  ${fldU('Zielteigtemperatur', numIn('ddt', d.ddt ?? 24), '°C', 'für den Wassertemperatur-Rechner')}`;
}

function wAblauf(d) {
  const steps = d.steps || [];
  const pfs = d.preferments || [];
  const addKinds = [['prep', 'Vorteig'], ['autolyse', 'Autolyse'], ['mix', 'Mischen'], ['bulk', 'Stockgare'], ['fold', 'Dehnen & Falten'], ['shape', 'Formen'], ['proof', 'Stückgare'], ['temper', 'Akklimatisieren'], ['preheat', 'Vorheizen'], ['bake', 'Backen'], ['other', 'Sonstiges']];
  return `
  <div class="result-grid">
    <div><small>Gesamtdauer</small><b data-live="total"></b></div>
    <div><small>Backen nach</small><b data-live="bakeOff"></b></div>
  </div>
  ${steps.length ? '' : `<div class="empty small"><p>Noch keine Schritte – lass dir einen passenden Ablauf vorschlagen.</p><button class="btn primary" data-action="suggestSteps">✨ Ablauf vorschlagen</button></div>`}
  <ol class="steps-edit">${steps.map((s, i) => {
    const k = kindOf(s.kind), open = S.openStep === s.id;
    const hh = Math.floor(num(s.durationMin) / 60), mm = Math.round(num(s.durationMin) % 60);
    return `<li class="se ${open ? 'open' : ''} loc-${s.location}">
      <button class="se-h" data-action="toggleStep" data-id="${s.id}">
        <span class="se-n">${i + 1}</span><span class="se-ic">${k.icon}</span>
        <span class="se-t"><b>${esc(s.name || k.label)}</b><small>${locOf(s.location).icon} ${locOf(s.location).short} · <span data-live="dur-${i}">${fmtDur(s.durationMin)}</span>${s.parallel ? ' · ⇉ parallel' : ''}${s.repeat?.count ? ` · ${s.repeat.count}×` : ''}</small></span>
        ${icon(open ? 'up' : 'down')}
      </button>
      ${open ? `<div class="se-b">
        ${fld('Bezeichnung', `<input class="in" data-bind="d.steps.${i}.name" value="${esc(s.name)}">`)}
        <div class="grid2">
          ${fld('Art', `<select class="in" data-bind="d.steps.${i}.kind" data-rerender>${Object.entries(STEP_KINDS).map(([kk, v]) => `<option value="${kk}" ${s.kind === kk ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select>`)}
          ${fld('Dauer', `<div class="row gap dur"><span class="unit-in"><input class="in" inputmode="numeric" data-input="dur" data-i="${i}" data-part="h" value="${hh}"><span class="u">h</span></span><span class="unit-in"><input class="in" inputmode="numeric" data-input="dur" data-i="${i}" data-part="m" value="${mm}"><span class="u">min</span></span></div>`)}
        </div>
        <div class="fld"><span class="fld-l">Wo?</span><div class="seg small">${Object.entries(LOCATIONS).map(([kk, v]) => `<button class="${s.location === kk ? 'on' : ''}" data-action="stepLoc" data-i="${i}" data-v="${kk}">${v.icon} ${v.short}</button>`).join('')}</div></div>
        ${fld('Hinweise', `<textarea class="in" rows="2" data-bind="d.steps.${i}.notes" placeholder="Was ist zu tun?">${esc(s.notes)}</textarea>`)}
        <details class="fold" ${s.repeat || s.parallel ? 'open' : ''}>
          <summary>Weitere Optionen <small class="muted">${[s.temp && esc(s.temp), s.stage && 'Zutaten', s.parallel && 'parallel', s.repeat && `${s.repeat.count}× Erinnerung`].filter(Boolean).join(' · ')}</small></summary>
          <div class="grid2">
            ${fld('Temperatur', `<input class="in" data-bind="d.steps.${i}.temp" value="${esc(s.temp)}" placeholder="z. B. 24–26 °C">`, feat('tempComp') && ['bulk', 'rest', 'proof', 'fold'].includes(s.kind) && s.location !== 'fridge' ? 'Basis für den Temperatur-Ausgleich' : '')}
            ${fld('Zutaten zeigen', `<select class="in" data-bind="d.steps.${i}.stage"><option value="">–</option>${pfs.map((p) => `<option value="${p.id}" ${s.stage === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="main" ${s.stage === 'main' ? 'selected' : ''}>Hauptteig</option></select>`, 'beim Backen in diesem Schritt')}
          </div>
          ${i > 0 ? `<label class="check"><input type="checkbox" data-bind="d.steps.${i}.parallel" ${s.parallel ? 'checked' : ''}> Parallel zum vorherigen Schritt</label>` : ''}
          <label class="check"><input type="checkbox" data-action="toggleRepeat" data-i="${i}" ${s.repeat ? 'checked' : ''}> Wiederkehrende Erinnerung <small class="muted">(Dehnen &amp; Falten)</small></label>
          ${s.repeat ? `<div class="grid2">${fldU('Wie oft', `<input class="in" inputmode="numeric" data-bind="d.steps.${i}.repeat.count" data-num value="${s.repeat.count}">`, '×')}${fldU('Abstand', `<input class="in" inputmode="numeric" data-bind="d.steps.${i}.repeat.intervalMin" data-num value="${s.repeat.intervalMin}">`, 'min')}</div>` : ''}
        </details>
        <div class="se-tools">
          <button class="icon-btn tonal" data-action="moveStep" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">${icon('up')}</button>
          <button class="icon-btn tonal" data-action="moveStep" data-i="${i}" data-d="1" ${i === steps.length - 1 ? 'disabled' : ''} aria-label="Nach unten">${icon('down')}</button>
          <button class="icon-btn tonal" data-action="dupStep" data-i="${i}" aria-label="Duplizieren">${icon('copy')}</button>
          <button class="icon-btn tonal danger" data-action="delStep" data-i="${i}" aria-label="Löschen" style="color:var(--danger)">${icon('trash')}</button>
        </div>
      </div>` : ''}
    </li>`;
  }).join('')}</ol>
  <details class="addmore">
    <summary><span class="btn sm">${icon('plus')} Schritt hinzufügen</span>${steps.length ? '<button class="btn sm ghost" data-action="suggestSteps" style="pointer-events:auto">✨ Neu vorschlagen</button>' : ''}</summary>
    <div class="chips">${addKinds.map(([kk, l]) => `<button class="chip" data-action="addStep" data-v="${kk}">${STEP_KINDS[kk].icon} ${l}</button>`).join('')}</div>
  </details>`;
}

function wDetails(d) {
  return `
  <div class="fld"><span class="fld-l">Fotos</span>
    <div class="thumbs big">${(d.photos || []).map((p) => `<div class="ph thumb ${coverOf(d) === p ? 'cover' : ''}"><img data-photo="${p}" alt=""><button class="t-x" data-action="delDraftPhoto" data-id="${p}" aria-label="Foto entfernen">${icon('x')}</button><button class="t-c" data-action="setCover" data-id="${p}">${coverOf(d) === p ? '★ Titelbild' : 'Als Titelbild'}</button></div>`).join('')}
      <label class="thumb add">${icon('camera')}<span>Foto</span><input type="file" accept="image/*" multiple hidden data-change="addPhotos" data-target="d"></label>
    </div>
  </div>
  ${fld('Notizen', `<textarea class="in" rows="6" data-bind="d.notes" placeholder="Tipps, Bezugsquellen, Ofeneinstellungen …">${esc(d.notes)}</textarea>`)}`;
}

function liveSummary(c, d) {
  const cat = catOf(d.category);
  const qty = d.yield.mode === 'flour' ? `<b>${fmtG(c.D)}</b> Teig` : `${fmtNum(d.yield.count, 0)} × ${fmtNum(d.yield.pieceWeight, 0)} g`;
  return `<span>${cat.icon} ${qty}</span><span>Mehl <b>${fmtG(c.F)}</b></span><span>Wasser <b>${fmtG(c.totals.water)}</b></span><span>💧 <b>${fmtPct(c.totals.hydration)}</b></span>${c.warnings.length ? `<span class="w">⚠️ ${c.warnings.length}</span>` : ''}`;
}

function hydHint(h) {
  if (h < 58) return 'Fester Teig – leicht zu verarbeiten.';
  if (h < 63) return 'Klassisch, gut formbar.';
  if (h < 68) return 'Typisch für Pizza Napoletana (60–68 %).';
  if (h < 73) return 'Luftig, etwas klebriger – gute Knettechnik hilft.';
  if (h < 80) return 'Weich – typisch für Sauerteigbrot und offene Krume.';
  return 'Sehr weich – Ciabatta/Teglia, braucht Übung und Dehnen & Falten.';
}

function liveDraft() {
  const d = S.draft;
  if (!d) return;
  const c = calc(d);
  const info = planInfo(d.steps, 0);
  const blendSum = (d.flours || []).reduce((s, f) => s + num(f.pct), 0);
  const L = {
    summary: liveSummary(c, d), dough: fmtG(c.D), flour: fmtG(c.F), count: fmtNum(c.count, 1),
    blendSum: `${fmtNum(blendSum)} %${Math.abs(blendSum - 100) > 0.5 ? ' ⚠️' : ' ✓'}`,
    hydHint: hydHint(c.totals.hydration), hydOil: fmtPct(c.totals.hydrationOil),
    iceHint: c.main.ice > 0 ? `Hauptteig: ${fmtG(Math.max(0, c.main.water) - c.main.ice)} Wasser + ${fmtG(c.main.ice)} Eis` : `Wasser im Hauptteig: ${fmtG(Math.max(0, c.main.water))}`,
    salt: fmtG(c.totals.salt),
    yeast: `${fmtG(c.main.yeast)} im Hauptteig · gesamt ${fmtG(c.totals.yeast)}`,
    total: d.steps?.length ? fmtDur(info.total) : '–', bakeOff: d.steps?.length ? fmtDur(info.bakeOff) : '–',
    warnings: c.warnings.length ? `<div class="warn">${c.warnings.map((w) => `⚠️ ${esc(w)}`).join('<br>')}</div>` : '',
  };
  c.pfs.forEach((x, i) => {
    L[`pf-${i}`] = `${x.starter > 0 ? `${fmtG(x.starter)} ${x.pf.type === 'madre' ? 'Madre' : 'Anstellgut'} + ` : ''}${fmtG(x.freshFlour)} Mehl + ${fmtG(x.freshWater)} Wasser${x.yeast > 0 ? ` + ${fmtG(x.yeast)} Hefe` : ''} = <b>${fmtG(x.total)}</b>`;
  });
  c.main.extras.forEach((e, i) => { L[`ex-${i}`] = fmtG(e.g); });
  (d.steps || []).forEach((s, i) => { L[`dur-${i}`] = fmtDur(s.durationMin); });
  $$('[data-live]').forEach((el) => {
    const k = el.dataset.live;
    if (!(k in L)) return;
    if (el.hasAttribute('data-html') || k.startsWith('pf-')) el.innerHTML = L[k]; else el.textContent = L[k];
  });
  $$('input[data-link]').forEach((el) => {
    if (el === document.activeElement) return;
    const f = el.dataset.link;
    el.value = el.dataset.unit === 'pct' ? fmtIn(d[f].pct) : fmtIn(f === 'water' ? c.totals.water : c.totals.oil, 0);
  });
  $$('input[data-input="ice"]').forEach((el) => {
    if (el === document.activeElement) return;
    const has = num(d.water.icePct) > 0;
    el.value = !has ? '' : el.dataset.unit === 'pct' ? fmtIn(d.water.icePct) : fmtIn(c.main.ice, 0);
  });
  // Mengenfelder: Gegenwert anzeigen (g bzw. %), Gramm-Felder nachführen
  $$('[data-gram]').forEach((el) => {
    const g = gramDef(el.dataset.gram);
    if (!g) return;
    const grams = g.get(c);
    const lab = $(`[data-live="amt-${el.dataset.gram}"]`);
    if (lab) lab.textContent = gramMode() ? `= ${fmtPct(g.pct())}` : `= ${fmtG(grams)}`;
    if (gramMode() && el !== document.activeElement) el.value = fmtIn(grams, grams < 20 ? 1 : 0);
  });
}

// ---------- Planer ----------
function vPlan(id) {
  const r = byId(id);
  if (!r) return vNotFound();
  if (!S.plan || S.plan.id !== id) S.plan = initPlan(r);
  const P = S.plan;
  const steps = planSteps(r);
  const base = planInfo(steps, 0);
  if (!r.steps?.length) {
    return { html: `<header class="top sub"><a class="icon-btn" href="#/r/${id}">${icon('back')}</a><div class="grow"><div class="eyebrow">Backen planen</div><h1 class="title sm">${esc(r.name)}</h1></div></header>
      <div class="pad empty"><div class="empty-ic">🗓️</div><p>Für die Planung braucht das Rezept eine Teigführung (Schritte mit Dauer).</p><button class="btn primary" data-action="editAt" data-id="${id}" data-step="5">Teigführung anlegen</button></div>` };
  }
  const now = Math.floor(Date.now() / 60000) * 60000;
  const start = P.mode === 'now' ? now : P.mode === 'bake' ? P.at - base.bakeOff * 60000 : P.at;
  const info = planInfo(steps, start);
  const night = info.tl.filter((s) => C.isNight(s.start, S.settings.nightFrom, S.settings.nightTo));
  const hasAdj = Object.keys(P.adj || {}).length > 0;
  const c = calc(r, planOv(r));
  const cat = catOf(r.category);
  const html = `
  <header class="top sub"><a class="icon-btn" href="#/r/${id}" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Backen planen</div><h1 class="title sm">${esc(r.name)}</h1></div></header>
  <div class="pad">
    <div class="seg">
      <button class="${P.mode === 'now' ? 'on' : ''}" data-action="planMode" data-v="now">Jetzt starten</button>
      <button class="${P.mode === 'bake' ? 'on' : ''}" data-action="planMode" data-v="bake">Backen um …</button>
      <button class="${P.mode === 'start' ? 'on' : ''}" data-action="planMode" data-v="start">Start um …</button>
    </div>
    ${P.mode !== 'now' ? fld(P.mode === 'bake' ? 'Wann willst du backen?' : 'Wann startest du?', `<input class="in big" type="datetime-local" data-change="planAt" value="${toLocalInput(P.at)}">`) : ''}
    <div class="big-result">
      <div class="br-k">Backen</div>
      <div class="br-v">${fmtRel(info.bakeAt)}</div>
      <div class="br-s">${P.mode === 'bake' ? `Start: <b>${fmtRel(start)}</b>` : `Start: ${fmtRel(start)}`} · Dauer ${fmtDur(info.total)}${info.endAt !== info.bakeAt ? ` · fertig ${fmtRel(info.endAt)}` : ''}</div>
      ${start < now - 60000 ? '<div class="br-w">⚠️ Der Start läge in der Vergangenheit – wähle einen späteren Backzeitpunkt.</div>' : ''}
    </div>
    ${night.length ? `<div class="hint-card warnc"><div>🌙 <b>${night.length} Schritt${night.length > 1 ? 'e' : ''} in der Nacht</b><br><small>${night.slice(0, 3).map((s) => `${new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(s.start)} ${fmtTime(s.start)}`).join(' · ')}${night.length > 3 ? ' …' : ''}</small></div>
      ${feat('nightOpt') ? '<button class="btn sm primary" data-action="nightOpt">🪄 Anpassen</button>' : ''}</div>` : ''}
    ${hasAdj ? `<div class="hint-card good"><div>🪄 ${steps.filter((s) => s._adj).map((s) => `${esc(s.name)} ${s._adj > 0 ? '+' : '−'}${fmtDur(Math.abs(s._adj))}`).join(' · ')}</div><button class="btn sm ghost" data-action="nightReset">Zurück</button></div>` : ''}
    <section class="card scaler">
      <div class="card-h"><b>Menge für diesen Backtag</b></div>
      <div class="seg small" style="margin:0 0 10px">${[['pieces', cat.pieces], ['flour', 'Mehl']].map(([k, l]) => `<button class="${(P.ov.ymode === 'flour' ? 'flour' : 'pieces') === k ? 'on' : ''}" data-action="planYMode" data-v="${k}">${l}</button>`).join('')}</div>
      ${P.ov.ymode === 'flour'
        ? `<div class="scaler-row"><span class="unit-in"><input class="in" inputmode="decimal" data-change="planOv" data-k="flour" value="${fmtIn(P.ov.flour, 0)}" aria-label="Mehl"><span class="u">g Mehl</span></span></div>`
        : `<div class="scaler-row">
          <div class="stepper"><button data-action="planCount" data-d="-1" aria-label="weniger">−</button><input class="in" inputmode="numeric" data-change="planOv" data-k="count" value="${fmtIn(P.ov.count, 0)}" aria-label="Anzahl"><button data-action="planCount" data-d="1" aria-label="mehr">+</button></div>
          <span class="x">×</span>
          <span class="unit-in"><input class="in" inputmode="decimal" data-change="planOv" data-k="pieceWeight" value="${fmtIn(P.ov.pieceWeight, 0)}" aria-label="Gewicht pro ${cat.piece}"><span class="u">g</span></span>
        </div>`}
      <div class="muted small" style="margin-top:8px">${scaleInfo(r, c)}</div>
      <small class="muted">Zeiten und Temperaturen bleiben gleich · das Rezept selbst bleibt unverändert.</small>
    </section>
    <details class="card fold" ${P.adjOpen ? 'open' : ''} data-action-toggle="adj">
      <summary>Weitere Anpassungen <small class="muted">${fmtPct(P.ov.hydration)} Hydration${P.ov.room !== undefined && P.ov.room !== '' ? ` · ${fmtNum(P.ov.room)} °C` : ''}</small></summary>
      <p class="muted small" style="margin-top:0">Gilt nur für diesen Backtag und landet später im Tagebuch.</p>
      <div class="grid2">
        ${fldU('Hydration', `<input class="in" inputmode="decimal" data-change="planOv" data-k="hydration" value="${fmtIn(P.ov.hydration)}">`, '%')}
        ${feat('tempComp') ? fldU('Raumtemperatur', `<input class="in" inputmode="decimal" data-change="planOv" data-k="room" value="${P.ov.room !== undefined && P.ov.room !== '' ? fmtIn(P.ov.room, 1) : ''}" placeholder="${fmtIn(S.settings.refRoom, 1)}">`, '°C', 'Gare-Zeiten werden angepasst') : ''}
      </div>
    </details>
    <h3 class="sec">Zeitplan</h3>
    <ol class="tl">${info.tl.map((s) => stepRow(s, fmtRel(s.start), r, C.isNight(s.start, S.settings.nightFrom, S.settings.nightTo) ? 'night' : '')).join('')}
      <li class="tl-i end"><div class="tl-dot">🎉</div><div class="tl-c"><div class="tl-h"><b>Fertig</b><span class="tl-when">${fmtRel(info.endAt)}</span></div></div></li>
    </ol>
  </div>
  <div class="sticky-actions">
    <button class="btn ghost" data-action="planIcs">${icon('cal')} Kalender</button>
    <button class="btn primary grow" data-action="startSession">${icon('play')} ${P.mode === 'now' ? 'Jetzt starten' : 'Plan aktivieren'}</button>
  </div>`;
  return { html };
}

function initPlan(r) {
  const base = planInfo(r.steps, 0);
  let target = new Date(); target.setHours(19, 0, 0, 0);
  while (target.getTime() - base.bakeOff * 60000 < Date.now()) target = new Date(target.getTime() + 86400000);
  // Eine im Rezept eingestellte Menge (z. B. 4 × 280 g) wird für den Backtag übernommen
  const y = S.scale?.id === r.id ? S.scale.yield : r.yield;
  return { id: r.id, mode: 'now', at: target.getTime(),
    ov: { ymode: y.mode === 'flour' ? 'flour' : 'pieces', count: y.count, pieceWeight: y.pieceWeight, flour: y.flour, hydration: r.water.pct } };
}

// Schritte inkl. Anpassungen aus dem Nachtruhe-Optimierer (ohne Temperatur-Ausgleich)
function planStepsBase(r, adj = S.plan?.adj || {}) {
  return (r.steps || []).map((s) => (adj[s.id] ? { ...s, durationMin: num(s.durationMin) + adj[s.id], _adj: adj[s.id] } : s));
}
// … plus Temperatur-Ausgleich, falls eine Raumtemperatur für den Backtag angegeben ist
function planSteps(r, adj) {
  const base = planStepsBase(r, adj);
  const room = S.plan?.ov?.room;
  return feat('tempComp') && room !== undefined && room !== '' ? C.compensateSteps(base, { room, refRoom: S.settings.refRoom }) : base;
}

// Probiert Verlängerung/Verkürzung der (bis zu zwei) längsten Kühlschrankphasen,
// damit möglichst kein Schritt in die Nachtruhe fällt – bei möglichst kleiner Änderung.
function optimizeNight(r) {
  const P = S.plan, { nightFrom: from, nightTo: to } = S.settings;
  const flex = r.steps.filter((s) => s.location === 'fridge' && num(s.durationMin) >= 120).sort((a, b) => num(b.durationMin) - num(a.durationMin)).slice(0, 2);
  if (!flex.length) return null;
  const range = (s) => { const out = []; const lo = -Math.floor((num(s.durationMin) * 0.4) / 30) * 30; for (let d = lo; d <= 12 * 60; d += 30) out.push(d); return out; };
  const d0 = range(flex[0]), d1 = flex[1] ? range(flex[1]) : [0];
  const now = Date.now();
  let best = null;
  for (const a of d0) {
    for (const b of d1) {
      const adj = { [flex[0].id]: a };
      if (flex[1]) adj[flex[1].id] = b;
      const steps = planSteps(r, adj);
      const bo = planInfo(steps, 0).bakeOff;
      const start = P.mode === 'now' ? now : P.mode === 'bake' ? P.at - bo * 60000 : P.at;
      if (start < now - 60000) continue;
      const night = planInfo(steps, start).tl.filter((x) => C.isNight(x.start, from, to)).length;
      const score = night * 1e6 + Math.abs(a) + Math.abs(b);
      if (!best || score < best.score) best = { score, adj, night };
    }
  }
  if (best) Object.keys(best.adj).forEach((k) => { if (!best.adj[k]) delete best.adj[k]; });
  return best;
}

function planOv(r) {
  const o = S.plan.ov;
  const flourMode = (o.ymode || r.yield.mode) === 'flour';
  return { yield: flourMode ? { mode: 'flour', flour: num(o.flour) } : { mode: 'pieces', count: num(o.count), pieceWeight: num(o.pieceWeight) }, hydration: num(o.hydration) };
}

function planStart(r) {
  const base = planInfo(planSteps(r), 0);
  const P = S.plan;
  return P.mode === 'now' ? Date.now() : P.mode === 'bake' ? P.at - base.bakeOff * 60000 : P.at;
}

// ---------- Backvorgang ----------
function sessionEvents(s, now) {
  const tl = C.timeline(s.recipeId ? effSteps(s) : s.steps, s.startAt, now);
  const ev = [];
  const m = (x) => Math.round(x / 60000);
  tl.forEach((st, i) => {
    if (st.doneAt) return;
    if (i === 0 && !(s.createdAt && st.start <= s.createdAt + 60000)) ev.push({ key: `${s.id}:s0:${m(st.start)}`, at: st.start, title: `Los geht's: ${st.name}`, body: s.recipeName });
    if (st.repeat?.count > 0 && st.repeat.intervalMin > 0) {
      for (let k = 1; k <= st.repeat.count; k++) {
        const at = st.start + k * st.repeat.intervalMin * 60000;
        if (at < st.end) ev.push({ key: `${s.id}:r${i}:${k}:${m(at)}`, at, title: `${kindOf(st.kind).icon} ${st.name} – ${k}/${st.repeat.count}`, body: `Zeit für Dehnen & Falten · ${s.recipeName}` });
      }
    }
    const next = tl.slice(i + 1).find((x) => !x.doneAt);
    ev.push({ key: `${s.id}:e${i}:${m(st.end)}`, at: st.end,
      title: next ? `⏰ Jetzt: ${next.name}` : `🎉 ${s.recipeName} ist fertig!`,
      body: next ? `„${st.name}“ ist abgeschlossen · ${s.recipeName}` : 'Trag dein Ergebnis ins Tagebuch ein.' });
  });
  return ev;
}

function vBakeList() {
  const active = S.sessions.filter((s) => s.status === 'active').sort((a, b) => a.startAt - b.startAt);
  const past = S.sessions.filter((s) => s.status !== 'active').sort((a, b) => b.startAt - a.startAt).slice(0, 10);
  const html = `
  <header class="top"><h1 class="title">Backen</h1></header>
  <div class="pad">
    ${notifCard()}
    ${active.length ? active.map(sessionBanner).join('') : `<div class="empty"><div class="empty-ic">⏲️</div><h2>Gerade läuft nichts</h2><p>Öffne ein Rezept und tippe auf <b>Backen planen</b>. Du siehst sofort, wann du backen kannst – und wirst bei jedem Schritt erinnert.</p><a class="btn primary" href="#/">Zu den Rezepten</a></div>`}
    ${past.length ? `<h3 class="sec">Zuletzt</h3>${past.map((s) => `<div class="card row between"><div><b>${esc(s.recipeName)}</b><br><small class="muted">${fmtRel(s.startAt)} · ${s.status === 'done' ? 'abgeschlossen' : 'abgebrochen'}</small></div>${s.status === 'done' && !s.logId && byId(s.recipeId) ? `<a class="btn sm" href="#/log/${s.recipeId}/new?session=${s.id}">📓 Eintragen</a>` : ''}</div>`).join('')}` : ''}
  </div>`;
  return { html };
}

function notifCard() {
  if (!('Notification' in window)) return `<div class="hint-card"><div>🔕 Keine Benachrichtigungen möglich${isIOS() ? ' – App zum Home-Bildschirm hinzufügen' : ''}. Tipp: ⋯ → Kalender.</div></div>`;
  if (Notification.permission === 'granted') return '';
  if (Notification.permission === 'denied') return `<div class="hint-card warnc"><div>🔕 Benachrichtigungen blockiert – nutze ⋯ → Kalender.</div></div>`;
  return `<div class="hint-card"><div>🔔 <b>Erinnerungen aktivieren?</b></div><button class="btn sm primary" data-action="askNotif">Aktivieren</button></div>`;
}

function vSession(sid) {
  const s = sessById(sid);
  if (!s) return vNotFound();
  if (S.hands === sid) return vHands(s);
  const now = Date.now();
  const info = planInfo(effSteps(s), s.startAt, now);
  const tl = info.tl;
  const cur = tl.find((x) => !x.doneAt);
  const planned = cur && cur.i === 0 && cur.start > now;
  const done = !cur;
  const r = byId(s.recipeId);
  let heroHtml;
  if (s.status !== 'active') {
    heroHtml = `<div class="hero-timer done"><div class="ht-name">${s.status === 'done' ? '✅ Abgeschlossen' : '⏹️ Abgebrochen'}</div>${s.status === 'done' && !s.logId && r ? `<a class="btn primary big" href="#/log/${s.recipeId}/new?session=${s.id}">📓 Tagebuch-Eintrag erstellen</a>` : ''}</div>`;
  } else if (done) {
    heroHtml = `<div class="hero-timer done"><div class="ht-big">🎉</div><div class="ht-name">Fertig – guten Appetit!</div><p>Wie ist es geworden? Halte es im Tagebuch fest, solange du es noch frisch im Kopf hast.</p>
      ${r ? `<a class="btn primary big block" href="#/log/${s.recipeId}/new?session=${s.id}">📓 Tagebuch-Eintrag erstellen</a>` : ''}
      <button class="btn ghost block" data-action="sessFinish" data-id="${s.id}">Ohne Eintrag abschließen</button>
      <button class="btn ghost sm" data-action="stepBack" data-id="${s.id}">↶ Letzten Schritt wieder öffnen</button></div>`;
  } else if (planned) {
    heroHtml = `<div class="hero-timer planned"><div class="ht-step">Geplant · Start ${fmtRel(cur.start)}</div><div class="ht-name">${kindOf(cur.kind).icon} ${esc(cur.name)}</div>
      <div class="ht-cd" data-cd="${cur.start}" data-cd-mode="bare"></div><div class="ht-sub">bis zum Start</div>
      <button class="btn primary big block" data-action="sessStartNow" data-id="${s.id}">${icon('play')} Jetzt schon starten</button></div>`;
  } else {
    const next = tl.slice(cur.i + 1).find((x) => !x.doneAt);
    let rep = '';
    if (cur.repeat?.count > 0 && cur.repeat.intervalMin > 0) {
      const iv = cur.repeat.intervalMin * 60000;
      const k = Math.min(cur.repeat.count, Math.max(0, Math.floor((now - cur.start) / iv)));
      const nextAt = cur.start + (k + 1) * iv;
      rep = `<div class="ht-rep">🙌 ${k}/${cur.repeat.count} erledigt${k < cur.repeat.count ? ` · nächstes Mal ${fmtTime(nextAt)} (<span data-cd="${nextAt}" data-cd-mode="start"></span>)` : ''}</div>`;
    }
    heroHtml = `<div class="hero-timer loc-${cur.location}">
      <div class="ht-step">Schritt ${cur.i + 1} von ${tl.length} · ${locOf(cur.location).icon} ${locOf(cur.location).label}${cur.temp ? ` · ${esc(cur.temp)}` : ''}</div>
      <div class="ht-name">${kindOf(cur.kind).icon} ${esc(cur.name)}</div>
      <div class="ht-cd" data-cd="${cur.end}" data-cd-mode="bare"></div>
      <div class="ht-sub">${cur.end > now ? `fertig um ${fmtTime(cur.end)}` : 'Zeit ist um – weiter, wenn du bereit bist'}</div>
      <div class="progress"><i data-prog="${cur.start},${cur.end}"></i></div>
      ${compNote(cur)}
      ${rep}
      ${cur.notes ? `<div class="ht-notes">${esc(cur.notes)}</div>` : ''}
      ${measBox(s, cur)}
      <div class="ht-tools">
        ${hasDone(s) ? `<button class="btn sm" data-action="stepBack" data-id="${s.id}" aria-label="Einen Schritt zurück">↶ Zurück</button>` : ''}
        <button class="btn sm" data-action="stepShift" data-id="${s.id}" data-i="${cur.i}" data-min="-15">−15</button>
        <button class="btn sm" data-action="stepShift" data-id="${s.id}" data-i="${cur.i}" data-min="15">+15</button>
        <button class="btn sm" data-action="stepShift" data-id="${s.id}" data-i="${cur.i}" data-min="60">+1 h</button>
        ${feat('handsFree') ? `<button class="btn sm" data-action="handsOn" data-id="${s.id}" aria-label="Teighände-Modus">🙌 Groß</button>` : ''}
      </div>
    </div>`;
  }
  // Laufender Schritt: Zutaten (nur beim Vermengen) und darunter der Weiter-Knopf
  let goHtml = '';
  if (s.status === 'active' && cur && !planned) {
    const stg = stepIngredients(s, cur);
    const next = tl.slice(cur.i + 1).find((x) => !x.doneAt);
    goHtml = `${stg ? `<section class="card step-ing" data-tk="${s.id}:${cur.i}"><div class="card-h"><b>🧾 Zutaten: ${esc(stg.title)}</b><small class="muted">antippen zum Abhaken</small></div>${ingTable('', '', stg.rows)}</section>` : ''}
      <button class="btn primary big block step-go" data-action="stepDone" data-id="${s.id}" data-i="${cur.i}">${icon('check')} ${next ? `Weiter: ${esc(next.name)}` : 'Fertig'}</button>`;
  }
  const html = `
  <header class="top sub"><a class="icon-btn" href="#/bake" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Backvorgang</div><h1 class="title sm">${esc(s.recipeName)}</h1></div>
    <button class="icon-btn" data-action="sessMenu" data-id="${s.id}" aria-label="Mehr">${icon('more')}</button></header>
  <div class="pad">
    ${s.status === 'active' ? notifCard() : ''}
    ${heroHtml}
    ${goHtml}
    <div class="result-grid">
      <div><small>🔥 Backen</small><b>${fmtRel(info.bakeAt)}</b></div>
      <div><small>🎉 Fertig</small><b>${fmtRel(info.endAt)}</b></div>
    </div>
    <h3 class="sec">Ablauf</h3>
    <ol class="tl tl-live">${tl.map((x) => {
      const isRun = !x.doneAt && x.start <= now && s.status === 'active';
      const when = x.doneAt ? `✓ ${fmtTime(x.doneAt)}` : fmtRel(x.start);
      return stepRow(x, when, r, `${x.doneAt ? 'done' : ''} ${isRun ? 'run' : ''} ${!x.doneAt && x.end < now && isRun ? 'over' : ''}`,
        isRun && x.i !== cur?.i ? `<button class="icon-btn tl-done" data-action="stepDone" data-id="${s.id}" data-i="${x.i}" aria-label="Erledigt">${icon('check')}</button>` : '');
    }).join('')}</ol>
    <details class="card"><summary>Alle Zutaten <small class="muted">${s.calc.mode === 'flour' ? fmtG(s.calc.F) + ' Mehl' : `${fmtNum(s.calc.count, 0)} × ${fmtNum(s.calc.pieceWeight, 0)} g`} · ${fmtPct(s.calc.totals.hydration)}</small></summary>${ingredientBlocks(sessCalc(s), s.yeastType, true)}</details>
  </div>`;
  return { html };
}

async function finishStep(s, i, hands) {
  if (s.steps[i].doneAt) return render();
  s.steps[i].doneAt = Date.now();
  await saveSession(s);
  if (hands) {
    const next = planInfo(effSteps(s), s.startAt, Date.now()).tl.find((x) => !x.doneAt);
    speak(next ? `Jetzt: ${next.name}. ${speakDur(next.durationMin)}.` : 'Fertig. Guten Appetit!');
  }
  render();
}
const hasDone = (s) => s.steps.some((x) => x.doneAt);
// Zutaten nur bei Schritten zeigen, in denen tatsächlich etwas vermengt wird
const MIX_KINDS = new Set(['prep', 'autolyse', 'mix']);
function stepIngredients(s, st) {
  if (!st || !MIX_KINDS.has(st.kind)) return null;
  const stage = st.stage || (st.kind === 'mix' ? 'main' : null);
  return stage ? stageRows(sessCalc(s), stage, s.yeastType) : null;
}
// Mengen des Backvorgangs – mit heute notierter Wassertemperatur/Eis-Menge
// Heute notierte Wasser/Eis-Werte aus ALLEN Hauptteig-Mischschritten ('' = bewusst leer)
function waterOverrides(s) {
  const o = {};
  s.steps.forEach((x) => { if (isMainMix(x) && x.meas) ['water', 'ice'].forEach((k) => { if (x.meas[k] !== undefined) o[k] = x.meas[k]; }); });
  return o;
}
function sessCalc(s) {
  const o = waterOverrides(s);
  if (!Object.keys(o).length) return s.calc;
  const c = structuredClone(s.calc);
  if ('water' in o) c.main.waterTemp = o.water;
  if ('ice' in o) c.main.ice = Math.min(Math.max(0, c.main.water), Math.max(0, num(o.ice)));
  return c;
}

// ---------- Teighände-Modus ----------
function vHands(s) {
  const now = Date.now();
  const tl = planInfo(effSteps(s), s.startAt, now).tl;
  const cur = tl.find((x) => !x.doneAt);
  const undo = hasDone(s) ? `<button class="hands-small" data-action="stepBack" data-id="${s.id}">↶ Zurück</button>` : '';
  const top = (label) => `<div class="hands-top"><span>${label}</span><button class="hands-x" data-action="handsExit" aria-label="Teighände-Modus beenden">${icon('x')}</button></div>`;
  let body;
  if (!cur) {
    body = `${top('Fertig')}<div class="hands-name">🎉 Guten Appetit!</div><div class="grow"></div>
      <button class="hands-go" data-action="handsExit">Teighände-Modus beenden</button>${undo ? `<div class="hands-row">${undo}</div>` : ''}`;
  } else if (cur.i === 0 && cur.start > now) {
    body = `${top('Geplant')}<div class="hands-name">${kindOf(cur.kind).icon} ${esc(cur.name)}</div>
      <div class="hands-cd" data-cd="${cur.start}" data-cd-mode="bare"></div><div class="hands-sub">bis zum Start</div><div class="grow"></div>
      <button class="hands-go" data-action="sessStartNow" data-id="${s.id}">▶ Jetzt starten</button>`;
  } else {
    const next = tl.slice(cur.i + 1).find((x) => !x.doneAt);
    const stg = stepIngredients(s, cur);
    let rep = '';
    if (cur.repeat?.count > 0 && cur.repeat.intervalMin > 0) {
      const iv = cur.repeat.intervalMin * 60000;
      const k = Math.min(cur.repeat.count, Math.max(0, Math.floor((now - cur.start) / iv)));
      rep = `<div class="hands-rep">🙌 ${k}/${cur.repeat.count}${k < cur.repeat.count ? ` · nächstes Mal <span data-cd="${cur.start + (k + 1) * iv}" data-cd-mode="start"></span>` : ''}</div>`;
    }
    body = `${top(`Schritt ${cur.i + 1}/${tl.length} · ${locOf(cur.location).icon} ${locOf(cur.location).short}`)}
      <div class="hands-name">${kindOf(cur.kind).icon} ${esc(cur.name)}</div>
      <div class="hands-cd" data-cd="${cur.end}" data-cd-mode="bare"></div>
      <div class="progress big"><i data-prog="${cur.start},${cur.end}"></i></div>
      ${compNote(cur)}${rep}
      ${cur.notes ? `<div class="hands-notes">${esc(cur.notes)}</div>` : ''}
      ${stg ? `<div class="hands-ing" data-tk="${s.id}:${cur.i}">${stg.rows.map((x) => `<div data-action="tick"><span>${esc(x.name)}</span><b>${fmtG(x.g)}</b></div>`).join('')}</div>` : ''}
      <div class="grow"></div>
      ${next ? `<div class="hands-sub">Danach: <b>${esc(next.name)}</b> · ${fmtTime(Math.max(next.start, cur.end))}</div>` : ''}
      <button class="hands-go" data-action="stepDone" data-id="${s.id}" data-i="${cur.i}" data-hands="1">✓ ${next ? 'Weiter' : 'Fertig'}</button>
      <div class="hands-row">${undo}<button class="hands-small" data-action="stepShift" data-id="${s.id}" data-i="${cur.i}" data-min="15">+15 min</button></div>`;
  }
  return { html: `<div class="hands">${body}</div>` };
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && feat('wakeLock') && 'wakeLock' in navigator && !document.hidden) {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* nicht unterstützt */ }
}

const speakDur = (min) => {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return [h && `${h} ${h === 1 ? 'Stunde' : 'Stunden'}`, m && `${m} Minuten`].filter(Boolean).join(' und ') || 'kurz';
};
function speak(text) {
  if (!feat('voice') || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu, '').trim());
    u.lang = 'de-DE';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

// ---------- Temperatur-Messwerte ----------
const MEAS = [['dough', 'Teig', '°C'], ['room', 'Raum', '°C'], ['fridge', 'Kühlschrank', '°C']];
// Nur beim Mischen des Hauptteigs: Wassertemperatur und Eis (vorbelegt aus dem Rezept)
const MEAS_WATER = [['water', 'Wasser', '°C'], ['ice', 'Eis', 'g']];
const isMainMix = (st) => MIX_KINDS.has(st?.kind) && (st.stage || (st.kind === 'mix' ? 'main' : null)) === 'main';
function measDefaults(s) {
  const m = s.calc?.main || {};
  return { water: m.waterTemp !== undefined && m.waterTemp !== '' ? m.waterTemp : undefined, ice: num(m.ice) > 0 ? Math.round(m.ice) : undefined };
}
function measLabel(m) {
  return [...MEAS, ...MEAS_WATER].filter(([k]) => m?.[k] !== undefined && m[k] !== '').map(([k, l, u]) => `${l} ${fmtNum(m[k])} ${u}`).join(' · ');
}
function measBox(s, cur) {
  const m = s.steps[cur.i].meas || {};
  const water = isMainMix(cur);
  const def = water ? measDefaults(s) : {};
  const fields = water ? [...MEAS, ...MEAS_WATER] : MEAS;
  const shown = { ...def, ...(water ? waterOverrides(s) : {}), ...m };
  return `<details class="meas" data-meas="${s.id}:${cur.i}" ${S.measOpen === `${s.id}:${cur.i}` ? 'open' : ''}><summary>🌡️ <span id="meas-sum">${measLabel(m) || (water ? 'Temperaturen &amp; Wasser notieren' : 'Temperatur notieren')}</span></summary>
    <div class="meas-row">${fields.map(([k, l, u]) => `<label><small>${k === 'dough' ? 'Teig (z. B. nach Kneten)' : k === 'water' ? 'Wassertemperatur' : k === 'ice' ? 'davon Eis' : l}</small><span class="unit-in"><input class="in" inputmode="decimal" data-change="meas" data-id="${s.id}" data-i="${cur.i}" data-k="${k}" value="${shown[k] !== undefined && shown[k] !== '' ? fmtIn(shown[k], k === 'ice' ? 0 : 1) : ''}"><span class="u">${u}</span></span></label>`).join('')}</div>
    ${water && (def.water !== undefined || def.ice !== undefined) ? '<small class="muted">Wasser/Eis sind aus dem Rezept vorbelegt – ändere sie, falls du es heute anders machst.<br></small>' : ''}
    <small class="muted">Wird automatisch ins Tagebuch übernommen.${feat('tempComp') ? ' Die Raumtemperatur passt die Garzeiten an.' : ''}</small>
  </details>`;
}
function compNote(st) {
  if (!st._comp) return '';
  const c = st._comp;
  return `<div class="ht-comp">🌡️ ${fmtNum(c.actual)} °C statt ${fmtNum(c.ref)} °C · ${fmtDur(c.from)} → <b>${fmtDur(st.durationMin)}</b></div>`;
}
// Messwerte eines Backvorgangs für das Tagebuch zusammenfassen
function sessTemps(s) {
  if (!s) return {};
  const vals = (k) => s.steps.map((x) => x.meas?.[k]).filter((v) => v !== undefined && v !== '').map(num);
  const avg = (a) => (a.length ? fmtIn(a.reduce((x, y) => x + y, 0) / a.length, 1) : '');
  const doughStep = s.steps.find((x) => x.meas?.dough && (x.kind === 'mix' || x.kind === 'autolyse')) || s.steps.find((x) => x.meas?.dough);
  // Wasser/Eis: heute notierter Wert, sonst der Rezept-Wert (sofern der Backvorgang einen Hauptteig-Mischschritt hat)
  const mixStep = s.steps.find(isMainMix);
  const wm = { ...(mixStep ? measDefaults(s) : {}), ...waterOverrides(s) };
  const opt = (v, d) => (v !== undefined && v !== '' ? fmtIn(v, d) : '');
  return { doughTemp: doughStep ? fmtIn(doughStep.meas.dough, 1) : '', roomTemp: avg(vals('room')), fridgeTemp: avg(vals('fridge')),
    waterTemp: opt(wm.water, 1), iceG: opt(wm.ice, 0) };
}

// ---------- Tagebuch-Eintrag ----------
function vLog(rid, lid, q) {
  const r = byId(rid);
  if (!r) return vNotFound();
  const key = `${rid}/${lid}/${q.get('session') || ''}`;
  if (!S.logDraft || S.logDraft._key !== key) {
    // Ein verworfener, ungespeicherter Entwurf hinterlässt keine Fotos
    S.logNewPhotos.forEach((p) => db.deletePhoto(p));
    S.logNewPhotos = [];
    const ex = S.logs.find((l) => l.id === lid);
    if (ex) S.logDraft = structuredClone(ex);
    else {
      const sess = q.get('session') ? sessById(q.get('session')) : null;
      S.logDraft = {
        id: uid(), recipeId: rid, date: todayISO(), rating: 0, sub: {}, params: paramsFrom(r, sess),
        roomTemp: '', doughTemp: '', fridgeTemp: '', waterTemp: '', iceG: '', oven: '', bakeTemp: '', bakeTime: '', notes: '', nextTime: '', photos: [],
        sessionId: sess?.id || null, createdAt: Date.now(),
        ...sessTemps(sess),
      };
    }
    S.logDraft._key = key;
    S.logDraft._new = !ex;
  }
  const l = S.logDraft;
  const subs = SUBRATINGS[r.category] || SUBRATINGS.other;
  const starInput = (k, v, big) => `<div class="stars-in ${big ? 'big' : ''}">${[1, 2, 3, 4, 5].map((n) => `<button class="${n <= v ? 'on' : ''}" data-action="rate" data-k="${k}" data-v="${n}" aria-label="${n} Sterne">★</button>`).join('')}</div>`;
  const lb = (path, val, attrs = '') => `<input class="in" data-bind="l.${path}" value="${esc(val ?? '')}" ${attrs}>`;
  const html = `
  <header class="top sub"><a class="icon-btn" href="#/r/${rid}?tab=log" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Tagebuch · ${esc(r.name)}</div><h1 class="title sm">${l._new ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}</h1></div>
    <button class="btn sm primary" data-action="logSave">Speichern</button></header>
  <div class="pad">
    <section class="card">
      <div class="fld" style="margin-top:0"><span class="fld-l">Wie war's?</span>${starInput('rating', l.rating, true)}</div>
      <details class="fold sub-ratings" ${Object.values(l.sub || {}).some(Boolean) ? 'open' : ''}><summary>Teilnoten <small class="muted">${subs.map(([, lbl]) => lbl).join(', ')}</small></summary>
        ${subs.map(([k, lbl]) => `<div class="row between"><span>${lbl}</span>${starInput('sub.' + k, l.sub?.[k] || 0)}</div>`).join('')}</details>
    </section>
    ${fld('Notizen', `<textarea class="in" rows="3" data-bind="l.notes" placeholder="Wie war der Teig? Wie das Ergebnis?">${esc(l.notes)}</textarea>`)}
    ${fld('Nächstes Mal ändern', `<textarea class="in" rows="2" data-bind="l.nextTime" placeholder="z. B. 2 % mehr Wasser, Stockgare kürzer">${esc(l.nextTime)}</textarea>`)}
    <div class="fld"><span class="fld-l">Fotos</span>
      <div class="thumbs big">${(l.photos || []).map((p) => `<div class="ph thumb"><img data-photo="${p}" alt=""><button class="t-x" data-action="delLogPhoto" data-id="${p}" aria-label="Foto entfernen">${icon('x')}</button></div>`).join('')}
        <label class="thumb add">${icon('camera')}<span>Foto</span><input type="file" accept="image/*" multiple hidden data-change="addPhotos" data-target="l"></label>
      </div>
    </div>
    <details class="card"><summary>Parameter <small class="muted">${paramChips(l.params, true)}</small></summary>
    <p class="muted small" style="margin-top:0">Aus ${l.sessionId ? 'dem Backvorgang' : 'dem Rezept'} übernommen – ändere, was du anders gemacht hast.</p>
    ${fld('Datum', `<input class="in" type="date" data-bind="l.date" value="${esc(l.date)}">`)}
    <div class="grid2">
      ${fldU('Hydration', lb('params.hydration', fmtIn(l.params.hydration), 'inputmode="decimal" data-num'), '%')}
      ${fldU('Salz', lb('params.salt', fmtIn(l.params.salt), 'inputmode="decimal" data-num'), '%')}
      ${fldU('Hefe gesamt', lb('params.yeastPct', fmtIn(l.params.yeastPct, 3), 'inputmode="decimal" data-num'), '%')}
      ${fld('Vorteig', lb('params.pf', l.params.pf))}
      ${fldU('Anzahl', lb('params.count', fmtIn(l.params.count, 0), 'inputmode="numeric" data-num'), 'Stk')}
      ${fldU('Gewicht', lb('params.pieceWeight', fmtIn(l.params.pieceWeight, 0), 'inputmode="decimal" data-num'), 'g')}
      ${fldU('Gesamtzeit', lb('params.totalHours', fmtIn(l.params.totalHours, 1), 'inputmode="decimal" data-num'), 'h')}
      ${fld('Mehl', lb('params.flour', l.params.flour))}
    </div>
    </details>
    <details class="card"><summary>Temperaturen &amp; Ofen <small class="muted">${[l.doughTemp && `Teig ${esc(l.doughTemp)} °C`, l.roomTemp && `Raum ${esc(l.roomTemp)} °C`, l.waterTemp && `Wasser ${esc(l.waterTemp)} °C`, l.iceG && `Eis ${esc(l.iceG)} g`, l.oven && esc(l.oven)].filter(Boolean).join(' · ') || 'optional'}</small></summary>
    ${l.sessionId && (l.doughTemp || l.roomTemp || l.fridgeTemp || l.waterTemp || l.iceG) ? '<p class="muted small" style="margin-top:0">🌡️ Aus den Messwerten des Backvorgangs.</p>' : ''}
    <div class="grid2">
      ${fldU('Teig nach Kneten', lb('doughTemp', l.doughTemp, 'inputmode="decimal"'), '°C')}
      ${fldU('Raum', lb('roomTemp', l.roomTemp, 'inputmode="decimal"'), '°C')}
      ${fldU('Kühlschrank', lb('fridgeTemp', l.fridgeTemp, 'inputmode="decimal"'), '°C')}
      ${fldU('Wassertemperatur', lb('waterTemp', l.waterTemp ?? '', 'inputmode="decimal"'), '°C')}
      ${fldU('davon Eis', lb('iceG', l.iceG ?? '', 'inputmode="decimal"'), 'g')}
      ${fld('Ofen', lb('oven', l.oven, `placeholder="${r.category === 'bread' ? 'z. B. Backofen + Gusstopf' : 'z. B. Ooni Koda 16'}"`))}
      ${fldU('Backtemperatur', lb('bakeTemp', l.bakeTemp, 'inputmode="decimal"'), '°C')}
      ${fld('Backzeit', lb('bakeTime', l.bakeTime, 'placeholder="z. B. 90 s / 45 min"'))}
    </div>
    </details>
    <div class="row gap">
      ${!l._new ? `<button class="btn ghost danger" data-action="logDelete">${icon('trash')} Löschen</button>` : ''}
      <button class="btn primary grow" data-action="logSave">${icon('check')} Speichern</button>
    </div>
  </div>`;
  return { html };
}

function paramsFrom(r, sess) {
  const c = sess?.calc || calc(r);
  const steps = sess?.steps || r.steps;
  const lastDone = sess ? Math.max(0, ...steps.map((x) => x.doneAt || 0)) : 0;
  const total = sess ? ((lastDone || Date.now()) - sess.startAt) / 60000 : planInfo(steps, 0).total;
  return {
    hydration: c.totals.hydration,
    salt: c.totals.flour ? (c.totals.salt / c.totals.flour) * 100 : r.salt,
    yeastPct: c.totals.flour ? Math.round((c.totals.yeast / c.totals.flour) * 100000) / 1000 : 0,
    pf: (r.preferments || []).map((p) => `${p.name} ${fmtNum(p.flourPct, 0)} %`).join(' + ') || 'direkt',
    count: Math.round(c.count * 10) / 10, pieceWeight: c.pieceWeight,
    totalHours: Math.round((total / 60) * 10) / 10,
    flour: (r.flours || []).map((f) => f.name).filter(Boolean).join(', '),
  };
}

// ---------- Einstellungen ----------
function vSettings() {
  const st = S.settings;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const html = `
  <header class="top"><h1 class="title">Einstellungen</h1></header>
  <div class="pad">
    ${isStandalone() ? '' : `<section class="card">
      <div class="card-h"><b>📲 Als App installieren</b>${S.installEvt ? '<button class="btn sm primary" data-action="install">Installieren</button>' : ''}</div>
      ${S.installEvt ? '<p class="small muted" style="margin:0">Startet dann wie eine normale App – auch offline.</p>'
        : isIOS() ? '<p class="small" style="margin:0">Safari → <b>Teilen</b> → <b>„Zum Home-Bildschirm“</b>. Erst danach gibt es Benachrichtigungen (ab iOS 16.4).</p>'
        : '<p class="small" style="margin:0">Browser-Menü <b>⋮</b> → <b>„App installieren“</b>.</p>'}
    </section>`}
    ${syncCard()}
    <section class="card">
      <div class="card-h"><b>🔔 Erinnerungen</b>${perm === 'default' ? '<button class="btn sm primary" data-action="askNotif">Aktivieren</button>' : `<span class="pill ${perm === 'granted' ? 'ok' : ''}">${{ granted: 'aktiv', denied: 'blockiert', unsupported: 'nicht verfügbar' }[perm]}</span>`}</div>
      <details class="info"><summary>ⓘ Wann kommen Erinnerungen?</summary><p>Solange die App offen ist oder kurz im Hintergrund läuft. Wird sie komplett beendet, kann eine Web-App nicht mehr wecken – für garantierte Wecker im Backvorgang <b>⋯ → In Kalender eintragen</b>.</p>
      ${perm === 'granted' ? '<button class="btn sm" data-action="testNotif">Test senden</button>' : ''}</details>
    </section>
    <section class="card">
      <div class="card-h"><b>🧩 Funktionen</b><small class="muted">nach Bedarf an/aus</small></div>
      ${toggle('tempComp', '🌡️ Temperatur-Ausgleich', 'Passt Gare-Zeiten an die Raumtemperatur an (+4 °C ≈ 30 % kürzer).')}
      ${feat('tempComp') ? `<div class="sub-opt">${fldU('Rezepte sind ausgelegt für', `<input class="in" inputmode="decimal" data-bind="set.refRoom" data-num value="${fmtIn(st.refRoom, 1)}">`, '°C', 'Gilt, wenn im Schritt keine Temperatur steht.')}</div>` : ''}
      ${toggle('handsFree', '🙌 Teighände-Modus', 'Große Ansicht zum Bedienen mit Teig an den Fingern.')}
      ${feat('handsFree') ? `<div class="sub-opt">${toggle('voice', '🔊 Sprachansagen', 'Sagt im Teighände-Modus den nächsten Schritt an.')}${toggle('wakeLock', '💡 Bildschirm anlassen', 'Verhindert im Teighände-Modus das Abschalten des Displays.')}</div>` : ''}
      ${toggle('confirmEarly', '⏳ Vorzeitiges Weiter bestätigen', 'Fragt nach, wenn ein Schritt noch läuft und du schon weiter tippst.')}
      ${toggle('qr', '🔳 Teilen per QR-Code', 'Rezepte als QR-Code zeigen und empfangen.')}
      ${toggle('nightOpt', '🪄 Nachtruhe-Optimierer', 'Schlägt angepasste Kühlschrankzeiten vor.')}
      <div class="set-row"><span><b>🌙 Nachtruhe</b><br><small class="muted">Planer warnt in dieser Zeit</small></span>
        <span class="row gap"><select class="in" style="width:auto" data-bind="set.nightFrom" data-num aria-label="Nachtruhe von">${hours.map((h) => `<option value="${h}" ${st.nightFrom === h ? 'selected' : ''}>${p2(h)}:00</option>`).join('')}</select>–<select class="in" style="width:auto" data-bind="set.nightTo" data-num aria-label="Nachtruhe bis">${hours.map((h) => `<option value="${h}" ${st.nightTo === h ? 'selected' : ''}>${p2(h)}:00</option>`).join('')}</select></span></div>
    </section>
    <section class="card">
      <div class="card-h"><b>💾 Daten</b><small class="muted">${S.recipes.length} Rezepte · ${S.logs.length} Einträge</small></div>
      <p class="small muted" style="margin-top:0">Alles liegt nur auf diesem Gerät. Letzte Sicherung: <b>${st.lastBackup ? fmtRel(st.lastBackup) : 'noch nie'}</b></p>
      <div class="row gap wrap">
        <button class="btn primary sm" data-action="exportAll">${icon('download')} Sichern</button>
        <button class="btn sm" data-action="importFile">${icon('upload')} Importieren</button>
        ${feat('qr') ? '<button class="btn sm" data-action="scanQR">🔳 QR empfangen</button>' : ''}
      </div>
      <details class="fold"><summary>Mehr <small class="muted">Handywechsel, Beispiele, Löschen</small></summary>
        <p class="small">Handywechsel: Sicherung z. B. in Google Drive/iCloud ablegen und auf dem neuen Gerät importieren.</p>
        <div class="row gap wrap">
          <button class="btn sm" data-action="exportAll" data-nophotos="1">Sichern ohne Fotos</button>
          <button class="btn sm" data-action="loadSamples">Beispielrezepte laden</button>
          <button class="btn sm danger" data-action="wipe">Alles löschen</button>
        </div>
        <p class="small muted" id="storage-info"></p>
      </details>
    </section>
    ${achievementsCard()}
    <p class="muted center small">Teigbuch ${VERSION} · offline · ohne Werbung</p>
  </div>`;
  return {
    html,
    after: async () => {
      const [e, pers] = await Promise.all([db.estimate(), db.isPersisted()]);
      const el = $('#storage-info');
      if (el) el.textContent = `${e ? `Belegt: ${fmtNum((e.usage || 0) / 1048576, 1)} MB` : ''}${pers ? ' · dauerhafter Speicher aktiv ✓' : ' · Speicher kann vom Browser bei Platzmangel geleert werden – darum Sicherungen!'}`;
    },
  };
}

function syncCard() {
  const s = sync.info();
  if (!s.configured) {
    return `<section class="card">
      <div class="card-h"><b>☁️ Geräte-Sync</b><span class="pill">nicht eingerichtet</span></div>
      <p class="small muted" style="margin-top:0">Ein Rezeptbuch auf allen Geräten – Einrichtung siehe ANLEITUNG.txt.</p>
      <details class="fold"><summary>Zugangsdaten eingeben</summary>
        <p class="small muted">Nur nötig, wenn sie nicht schon in <b>config.js</b> stehen.</p>
        ${fld('Project URL', '<input class="in" id="sb-url" inputmode="url" placeholder="https://xxxx.supabase.co">')}
        ${fld('Publishable / anon key', '<input class="in" id="sb-key" placeholder="sb_publishable_…">')}
        <button class="btn sm primary" data-action="sbSaveCfg">Speichern</button>
      </details>
    </section>`;
  }
  if (!s.loggedIn) {
    return `<section class="card">
      <div class="card-h"><b>☁️ Geräte-Sync</b><button class="btn sm primary" data-action="sbLogin">Anmelden</button></div>
      <p class="small muted" style="margin:0">Melde dich mit deiner E-Mail an – auf jedem Gerät mit derselben Adresse siehst du dasselbe Rezeptbuch.</p>
      ${s.lastError ? `<div class="warn">⚠️ ${esc(s.lastError)}</div>` : ''}
    </section>`;
  }
  return `<section class="card">
    <div class="card-h"><b>☁️ Geräte-Sync</b><span class="pill ${s.lastError ? '' : 'ok'}">${s.running ? 'läuft …' : s.lastError ? 'Fehler' : 'aktiv'}</span></div>
    <p class="small muted" style="margin-top:0">${esc(s.email)} · zuletzt ${s.lastOk ? fmtRel(s.lastOk) : 'noch nie'}</p>
    ${s.lastError ? `<div class="warn">⚠️ ${esc(s.lastError)}</div>` : ''}
    <div class="row gap wrap">
      <button class="btn sm primary" data-action="sbSync" ${s.running ? 'disabled' : ''}>Jetzt abgleichen</button>
      <button class="btn sm ghost" data-action="sbLogout">Abmelden</button>
    </div>
  </section>`;
}

function loginSheet(step, email = '') {
  $('#sheet-root').innerHTML = `<div class="sheet-bg" data-action="sheetClose"></div><div class="sheet" role="dialog" aria-label="Anmelden">
    <div class="sheet-h">☁️ Geräte-Sync – Anmelden</div>
    ${step === 'email' ? `
      ${fld('Deine E-Mail-Adresse', `<input class="in" id="sb-email" type="email" autocomplete="email" inputmode="email" value="${esc(email)}" placeholder="name@beispiel.de">`, 'Du bekommst eine E-Mail mit einem Anmelde-Link – kein Passwort nötig.')}
      <button class="btn primary block" data-action="sbSendCode">E-Mail senden</button>`
    : `
      <p class="small" style="margin-top:0">E-Mail an <b>${esc(email)}</b> ist unterwegs (auch im Spam-Ordner nachsehen).</p>
      <ol class="small login-steps">
        <li>In der E-Mail den Link <b>„Sign in“</b> <b>gedrückt halten</b> (nicht antippen)</li>
        <li><b>„Link kopieren“</b> wählen</li>
        <li>Hier einfügen und <b>Anmelden</b> tippen</li>
      </ol>
      ${fld('Link (oder Code) aus der E-Mail', '<input class="in" id="sb-code" autocomplete="one-time-code" placeholder="https://… oder 123456">')}
      ${navigator.clipboard?.readText ? '<button class="btn sm ghost" data-action="sbPaste">📋 Aus Zwischenablage einfügen</button>' : ''}
      <button class="btn primary block" data-action="sbVerify">Anmelden</button>
      <button class="btn ghost block" data-action="sbLogin">Andere E-Mail / neue E-Mail anfordern</button>`}
    <button class="sheet-i cancel" data-action="sheetClose">Abbrechen</button></div>`;
  setTimeout(() => $(step === 'email' ? '#sb-email' : '#sb-code')?.focus(), 50);
}

function toggle(key, title, desc) {
  return `<label class="toggle"><span><b>${title}</b><small>${desc}</small></span>
    <input type="checkbox" role="switch" data-bind="set.features.${key}" data-rerender ${feat(key) ? 'checked' : ''}><i aria-hidden="true"></i></label>`;
}

// ---------- Export / Import / Teilen ----------
async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  const mobile = matchMedia('(pointer: coarse)').matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

async function exportAll(withPhotos = true) {
  toast('Sicherung wird erstellt …');
  const data = await db.buildExport({ withPhotos, meta: EXPORT_META });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const ok = await shareOrDownload(blob, `teigbuch-sicherung-${todayISO()}.json`, 'Teigbuch-Sicherung');
  if (ok) {
    S.settings.lastBackup = Date.now();
    await saveSettings();
    toast(`✓ Sicherung erstellt (${fmtNum(blob.size / 1048576, 1)} MB)`);
    render();
  }
}

function importFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      let newer = 0;
      const res = await db.importData(obj, {
        cleanRecipe: (x) => { const m = importRecipe(x); if (m.newer) newer++; return m.rec; },
        cleanLog: (x) => { const m = importLog(x); if (m.newer) newer++; return m.rec; },
      });
      await reload();
      S.scale = null; S.plan = null;
      scheduleSync(500);
      const open = S.recipes.filter((r) => MG.openQuestions(r).length).length;
      toast(`✓ Importiert: ${res.recipes} Rezepte, ${res.logs} Einträge, ${res.photos} Fotos${res.skipped ? ` (${res.skipped} neuere behalten)` : ''}`, 4000);
      if (newer) alert('Diese Sicherung stammt aus einer neueren Teigbuch-Version.\n\nDie Daten wurden vollständig übernommen. Bitte aktualisiere die App, damit alle Angaben genutzt werden können.');
      if (open) { location.hash = '#/fix'; return; }
      render();
    } catch (e) { toast('Import fehlgeschlagen: ' + e.message, 4000); }
  };
  inp.click();
}

function recipeText(r) {
  const c = calc(r);
  const lines = [`${catOf(r.category).icon} ${r.name}`, r.description || '', '',
    `Menge: ${r.yield.mode === 'flour' ? fmtG(c.F) + ' Mehl' : `${fmtNum(c.count, 0)} × ${fmtNum(c.pieceWeight, 0)} g`} · Hydration ${fmtPct(c.totals.hydration)}`, ''];
  c.pfs.forEach((x) => { lines.push(`— ${x.pf.name} —`); pfRows(x, r.yeastType).forEach((row) => lines.push(`${row.name}: ${fmtG(row.g)}`)); lines.push(''); });
  lines.push('— Hauptteig —');
  mainRows(c, r.yeastType).forEach((row) => lines.push(`${row.name}: ${fmtG(row.g)}`));
  if (r.steps?.length) {
    lines.push('', '— Ablauf —');
    planInfo(r.steps, 0).tl.forEach((s, i) => lines.push(`${i + 1}. ${s.name} – ${fmtDur(s.durationMin)} (${locOf(s.location).short})${s.notes ? ': ' + s.notes : ''}`));
  }
  if (r.notes) lines.push('', r.notes);
  return lines.join('\n');
}

function icsFor(events, name) {
  const f = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const e = (t) => String(t).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teigbuch//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${e(name)}`];
  events.forEach((ev, i) => {
    L.push('BEGIN:VEVENT', `UID:${ev.key.replace(/[^a-z0-9]/gi, '')}-${i}@teigbuch`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(ev.at)}`, `DTEND:${f(ev.at + 10 * 60000)}`,
      `SUMMARY:${e(ev.title)}`, `DESCRIPTION:${e(ev.body)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(ev.title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return new Blob([L.join('\r\n')], { type: 'text/calendar' });
}

// ---------- QR-Code: Rezept als Link verpacken ----------
// Das Rezept steckt komprimiert im #-Teil des Links – der wird nie an einen Server geschickt.
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (str) => { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); };
const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

async function packRecipe(r, dropNotes = false) {
  const o = structuredClone(r);
  ['id', 'photos', 'cover', 'favorite', 'createdAt', 'updatedAt', '_tags', '_new'].forEach((k) => delete o[k]);
  if (dropNotes) { delete o.notes; delete o.description; }
  o.steps = (o.steps || []).map(({ id, doneAt, meas, _adj, _comp, ...s }) => {
    if (dropNotes) delete s.notes;
    Object.keys(s).forEach((k) => { if (s[k] === '' || s[k] === null || s[k] === false) delete s[k]; });
    return s;
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, r: o }));
  if ('CompressionStream' in window) return 'z' + b64u(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
  return 'j' + b64u(bytes);
}
async function unpackRecipe(str) {
  const kind = str[0];
  let bytes = unb64u(str.slice(1));
  if (kind === 'z') {
    if (!('DecompressionStream' in window)) throw new Error('Dieser Browser kann den Code nicht entpacken – bitte aktualisieren.');
    bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== 'j') throw new Error('Unbekanntes Format');
  const { r } = JSON.parse(new TextDecoder().decode(bytes));
  if (!r || !r.name) throw new Error('Kein Rezept gefunden');
  const clean = importRecipe(r).rec;
  return { ...clean, id: uid(), photos: [], cover: null, favorite: false, createdAt: Date.now(), updatedAt: Date.now() };
}
const appBase = () => location.origin + location.pathname;

async function showQR(r) {
  let packed = await packRecipe(r), note = '';
  let url = `${appBase()}#/import/${packed}`;
  let svg;
  try { svg = qrSVG(url, 'L'); }
  catch {
    packed = await packRecipe(r, true);
    url = `${appBase()}#/import/${packed}`;
    try { svg = qrSVG(url, 'L'); note = 'Ohne Notizen – das Rezept war für einen QR-Code zu lang.'; }
    catch { toast('Rezept ist zu lang für einen QR-Code – bitte „Als Datei exportieren“ nutzen.', 4000); return; }
  }
  S.qrUrl = url;
  $('#sheet-root').innerHTML = `<div class="sheet-bg" data-action="sheetClose"></div><div class="sheet qr-sheet" role="dialog" aria-label="QR-Code">
    <div class="sheet-h">${esc(r.name)}</div>
    <div class="qr-box">${svg}</div>
    <p class="small center">Mit der Handy-Kamera scannen – der Link öffnet das Rezept in Teigbuch.${note ? `<br><span class="muted">${note}</span>` : ''}</p>
    ${location.hostname === 'localhost' ? '<p class="small center warnc">Hinweis: Die App läuft gerade lokal – der Link funktioniert erst, wenn Teigbuch online ist.</p>' : ''}
    <div class="row gap"><button class="btn grow" data-action="qrCopy">${icon('copy')} Link kopieren</button>${navigator.share ? `<button class="btn grow" data-action="qrShare">${icon('share')} Teilen</button>` : ''}</div>
    <button class="sheet-i cancel" data-action="sheetClose">Schließen</button></div>`;
}

function vImport(data) {
  const P = S.importPreview;
  if (!P || P.data !== data) {
    S.importPreview = { data, loading: true };
    unpackRecipe(data).then((r) => { S.importPreview = { data, r }; render(); })
      .catch((e) => { S.importPreview = { data, error: e.message }; render(); });
  }
  const p = S.importPreview;
  let body;
  if (p.loading) body = '<p class="muted center">Rezept wird gelesen …</p>';
  else if (p.error) body = `<div class="empty"><div class="empty-ic">😕</div><h2>Code nicht lesbar</h2><p>${esc(p.error)}</p><a class="btn" href="#/">Zur Übersicht</a></div>`;
  else {
    const r = p.r, c = calc(r), info = planInfo(r.steps, 0);
    body = `<section class="card">
      <div class="eyebrow">${catOf(r.category).icon} ${catOf(r.category).label}</div>
      <h2 class="title sm">${esc(r.name)}</h2>
      ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
      <div class="pchips">
        <span class="pchip">💧 ${fmtPct(c.totals.hydration)}</span>
        <span class="pchip">🧱 ${pfLabel(r.preferments)}</span>
        <span class="pchip">⚖️ ${r.yield.mode === 'flour' ? fmtG(c.F) + ' Mehl' : `${fmtNum(c.count, 0)} × ${fmtNum(c.pieceWeight, 0)} g`}</span>
        ${r.steps.length ? `<span class="pchip">⏱ ${fmtDur(info.total)}</span>` : ''}
      </div>
    </section>
    ${isIOS() && !isStandalone() ? `<div class="hint-card warnc col"><div>📱 <b>Nutzt du Teigbuch als App auf dem Home-Bildschirm?</b><br><small>Dann landet das Rezept hier in Safari, nicht in der App. Kopiere den Link und füge ihn in der App unter Einstellungen → QR empfangen ein.</small></div><button class="btn sm" data-action="copyHere">${icon('copy')} Link kopieren</button></div>` : ''}
    <button class="btn primary big block" data-action="importQR">${icon('download')} In mein Teigbuch übernehmen</button>
    <a class="btn ghost block" href="#/">Abbrechen</a>`;
  }
  return { html: `<header class="top sub"><a class="icon-btn" href="#/" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Geteiltes Rezept</div><h1 class="title sm">Rezept empfangen</h1></div></header><div class="pad">${body}</div>` };
}

async function openScanner() {
  const pasteHtml = `<p class="small">Oder den Link aus dem QR-Code hier einfügen:</p>
    <div class="row gap"><input class="in grow" id="qr-paste" placeholder="https://…#/import/…"><button class="btn primary" data-action="qrPasteGo">Öffnen</button></div>`;
  const supported = 'BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats().catch(() => [])).includes('qr_code');
  $('#sheet-root').innerHTML = `<div class="sheet-bg" data-action="sheetClose"></div><div class="sheet" role="dialog" aria-label="QR-Code scannen">
    <div class="sheet-h">Rezept per QR-Code empfangen</div>
    ${supported ? '<video id="qr-video" class="qr-video" playsinline muted autoplay></video><p class="small center muted">QR-Code ins Bild halten …</p>'
      : '<p class="small">Scanne den QR-Code einfach mit der <b>Kamera-App</b> deines Handys – der Link öffnet das Rezept direkt.</p>'}
    ${pasteHtml}
    <button class="sheet-i cancel" data-action="sheetClose">Abbrechen</button></div>`;
  if (!supported) return;
  try {
    S.scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('#qr-video');
    video.srcObject = S.scanStream;
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const loop = async () => {
      if (!S.scanStream) return;
      try {
        const codes = await det.detect(video);
        const hit = codes.map((c) => c.rawValue).find((v) => v.includes('#/import/'));
        if (hit) { closeSheet(); location.hash = '#/import/' + hit.split('#/import/')[1]; return; }
      } catch { /* weiter versuchen */ }
      setTimeout(loop, 300);
    };
    video.addEventListener('loadeddata', loop, { once: true });
  } catch { toast('Kamera nicht verfügbar – nutze die Kamera-App oder füge den Link ein.', 4000); }
}

// ---------- Benachrichtigungen ----------
async function askNotif() {
  if (!('Notification' in window)) { toast('Benachrichtigungen werden hier nicht unterstützt.'); return; }
  try { await Notification.requestPermission(); } catch { /* ignore */ }
  render();
}

let audioCtx;
// Browser erlauben Ton erst nach einer Berührung – darum beim ersten Tippen „aufwecken“
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* kein Audio */ }
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });
function beep() {
  try {
    unlockAudio();
    [0, 0.25, 0.5].forEach((t) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.2);
      o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.22);
    });
  } catch { /* kein Audio */ }
}

async function notify(ev, sid) {
  if (!document.hidden) {
    if (S.hands) setTimeout(() => speak(`${ev.title}. ${ev.body.split('·')[0]}`), 900);
    else showAlert(ev, sid);
    beep();
    navigator.vibrate?.([300, 120, 300]);
  }
  if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
    const opts = { body: ev.body, tag: ev.key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [300, 120, 300], requireInteraction: true, data: { hash: `#/bake/${sid}` } };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(ev.title, opts); else new Notification(ev.title, opts);
    } catch { /* ignore */ }
  }
}

function showAlert(ev, sid) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-bg" data-action="sheetClose"></div><div class="sheet alert" role="alertdialog">
    <div class="alert-t">${esc(ev.title)}</div><p>${esc(ev.body)}</p>
    <a class="btn primary big block" href="#/bake/${sid}" data-action="sheetClose" data-keep="1">Zum Backvorgang</a>
    <button class="btn ghost block" data-action="sheetClose">OK</button></div>`;
}

function tick(silent) {
  const now = Date.now();
  $$('[data-cd]').forEach((el) => {
    const t = +el.dataset.cd, mode = el.dataset.cdMode || 'left', d = t - now;
    el.classList.toggle('overdue', d < 0 && mode !== 'start');
    if (mode === 'bare') el.textContent = (d < 0 ? '+' : '') + fmtCountdown(Math.abs(d));
    else if (mode === 'start') el.textContent = d > 0 ? `in ${fmtCountdown(d)}` : 'jetzt';
    else el.textContent = d >= 0 ? `noch ${fmtCountdown(d)}` : `fällig seit ${fmtCountdown(-d)}`;
  });
  $$('[data-prog]').forEach((el) => {
    const [a, b] = el.dataset.prog.split(',').map(Number);
    el.style.width = `${Math.min(100, Math.max(0, ((now - a) / Math.max(1, b - a)) * 100))}%`;
  });
  if (silent === true) return;
  if (S.measDirty && !document.activeElement?.closest('.meas')) { S.measDirty = false; render(); return; }
  let fired = false;
  for (const s of S.sessions) {
    if (s.status !== 'active') continue;
    let dirty = false;
    for (const ev of sessionEvents(s, now)) {
      if (ev.at <= now && !s.notified.includes(ev.key)) {
        s.notified.push(ev.key);
        dirty = true;
        if (now - ev.at < 20 * 60000) { notify(ev, s.id); fired = true; }
      }
    }
    if (dirty) { s.notified = s.notified.slice(-300); saveSession(s); }
  }
  if (fired) {
    const a = route().parts[0];
    if ((a === 'bake' || !a) && !document.activeElement?.matches('input,textarea,select')) render();
  }
}

// ---------- Sheet ----------
// msg (optional, HTML): kurzer Text unter dem Titel, z. B. für Rückfragen
function sheet(title, items, msg = '') {
  S.sheetItems = items;
  $('#sheet-root').innerHTML = `<div class="sheet-bg" data-action="sheetClose"></div><div class="sheet" role="dialog" aria-label="${esc(title)}">
    <div class="sheet-h">${esc(title)}</div>
    ${msg ? `<div class="sheet-msg">${msg}</div>` : ''}
    ${items.map((it, i) => `<button class="sheet-i ${it.danger ? 'danger' : ''} ${it.primary ? 'primary' : ''}" data-action="sheetPick" data-i="${i}">${it.icon ? icon(it.icon) : ''}<span>${it.label}</span></button>`).join('')}
    <button class="sheet-i cancel" data-action="sheetClose">Abbrechen</button></div>`;
}
const closeSheet = () => {
  if (S.scanStream) { S.scanStream.getTracks().forEach((t) => t.stop()); S.scanStream = null; }
  $('#sheet-root').innerHTML = '';
};

// ---------- Aktionen ----------
const A = {
  filter: (el) => { S.listFilter = el.dataset.v; render(); },
  toggleSearch: () => { S.searchOpen = !S.searchOpen; if (!S.searchOpen) S.listQuery = ''; render(); },
  snoozeBackup: async () => { S.settings.backupSnooze = Date.now() + 7 * 86400000; await saveSettings(); toast('Erinnere dich in 7 Tagen wieder'); render(); },
  fav: async (el) => { const r = byId(el.dataset.id); r.favorite = !r.favorite; await saveRecipe(r); render(); },
  sheetClose: (el) => { closeSheet(); if (el.dataset.keep) location.hash = el.getAttribute('href'); },
  sheetPick: (el) => { const it = S.sheetItems[+el.dataset.i]; closeSheet(); it?.run(); },
  tick: (el) => {
    const on = el.classList.toggle('checked');
    const k = tickKey(el);
    if (on) S.ticks.add(k); else S.ticks.delete(k);
  },
  viewPhoto: async (el) => {
    const u = await db.photoURL(el.dataset.id);
    if (!u) return;
    $('#sheet-root').innerHTML = `<div class="lightbox" data-action="sheetClose"><img src="${u}" alt=""></div>`;
  },

  recipeMenu: (el) => {
    const r = byId(el.dataset.id);
    sheet(r.name, [
      { label: 'Duplizieren (Variante anlegen)', icon: 'copy', run: async () => {
        const c = structuredClone(r);
        // Fotos NICHT mitkopieren – sonst würde das Löschen der Variante die Fotos des Originals löschen
        Object.assign(c, { id: uid(), name: r.name + ' (Variante)', createdAt: Date.now(), favorite: false, photos: [], cover: null });
        c.preferments.forEach((pf) => { const old = pf.id; pf.id = uid(); c.steps.forEach((s) => { if (s.stage === old) s.stage = pf.id; }); });
        c.steps.forEach((s) => { s.id = uid(); });
        await saveRecipe(c); location.hash = `#/edit/${c.id}`;
      } },
      ...(feat('qr') ? [{ label: 'QR-Code zum Teilen zeigen', icon: 'share', run: () => showQR(r) }] : []),
      { label: 'Als Datei exportieren', icon: 'download', run: async () => {
        const data = await db.buildExport({ recipeIds: [r.id], meta: EXPORT_META });
        await shareOrDownload(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${slug(r.name)}.teigbuch.json`, r.name);
      } },
      { label: 'Als Text teilen / kopieren', icon: 'text', run: async () => {
        const t = recipeText(r);
        if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: r.name, text: t }); return; } catch { /* fallback */ } }
        try { await navigator.clipboard.writeText(t); toast('✓ Rezept in die Zwischenablage kopiert'); } catch { toast('Kopieren nicht möglich'); }
      } },
      { label: 'Rezept löschen', icon: 'trash', danger: true, run: async () => {
        if (!confirm(`„${r.name}“ samt ${logsFor(r.id).length} Tagebuch-Einträgen wirklich löschen?`)) return;
        for (const l of logsFor(r.id)) { for (const p of l.photos || []) await db.deletePhoto(p); await db.del('logs', l.id); await sync.markDeleted('log', l.id); }
        for (const p of r.photos || []) await db.deletePhoto(p);
        await db.del('recipes', r.id);
        await sync.markDeleted('recipe', r.id);
        scheduleSync(500);
        S.logs = S.logs.filter((l) => l.recipeId !== r.id);
        S.recipes = S.recipes.filter((x) => x.id !== r.id);
        toast('Rezept gelöscht'); location.hash = '#/';
      } },
    ]);
  },

  scaleCount: (el) => { if (!S.scale) return render(); S.scale.yield.count = Math.max(1, num(S.scale.yield.count) + +el.dataset.d); S.plan = null; render(); },
  scaleMode: (el) => {
    const r = S.scale && byId(S.scale.id);
    if (!r) return render();
    const y = S.scale.yield, to = el.dataset.v;
    if ((y.mode === 'flour' ? 'flour' : 'pieces') === to) return;
    S.plan = null;
    const c = calc(r, { yield: y });
    if (to === 'flour') S.scale.yield = { ...y, mode: 'flour', flour: Math.round(c.F) };
    else {
      // Sinnvolle Startwerte: vorhandenes Stückgewicht nutzen, sonst gleichmäßig auf 4 Stück verteilen
      const net = c.D / (1 + num(r.yield.loss) / 100); // ohne Verlust-Zuschlag
      const pw = num(r.yield.pieceWeight) > 0 && r.yield.mode !== 'flour' ? num(r.yield.pieceWeight) : 0;
      const count = pw ? Math.max(1, Math.round(net / pw)) : 4;
      S.scale.yield = { ...y, mode: 'pieces', count, pieceWeight: pw || Math.round(net / count) };
    }
    render();
  },
  scaleReset: () => { S.scale = null; S.plan = null; render(); },
  scaleSave: async () => { const r = S.scale && byId(S.scale.id); if (!r) return render(); r.yield = { ...S.scale.yield }; await saveRecipe(r); S.plan = null; toast('✓ Menge gespeichert'); render(); },

  editAt: (el) => { const id = el.dataset.id || route().parts[1]; discardDraft(); S.wizStart = +el.dataset.step; location.hash = `#/edit/${id}`; },
  kiCopy: async () => {
    const t = KI.buildPrompt(S.ki.input);
    try { await navigator.clipboard.writeText(t); toast('✓ Auftrag kopiert – jetzt in der KI-App einfügen'); }
    catch { const p = $('#ki-prompt'); if (p) { p.closest('details').open = true; p.select(); } toast('Bitte den Auftrag unten markieren und kopieren'); }
  },
  kiShare: async () => {
    try { await navigator.share({ text: KI.buildPrompt(S.ki.input) }); } catch (e) { if (e.name !== 'AbortError') A.kiCopy(); }
  },
  kiPaste: async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { S.ki.answer = t; S.ki.error = ''; render(); } else toast('Zwischenablage ist leer'); }
    catch { toast('Kein Zugriff auf die Zwischenablage – bitte lange ins Feld tippen → Einfügen'); }
  },
  kiCreate: () => {
    const k = S.ki;
    k.answer = $('#ki-answer')?.value ?? k.answer;
    if (!k.answer.trim()) { k.error = 'Bitte zuerst die Antwort der KI einfügen.'; render(); return; }
    try {
      const { recipe, warnings } = KI.kiToRecipe(KI.extractJSON(k.answer), { schema: MG.SCHEMA });
      if (!recipe.source && /^https?:\/\/\S+$/i.test(k.input.trim())) recipe.source = k.input.trim();
      // Wie jede Datei von außen: bereinigen über den gemeinsamen Importweg
      const { rec } = importRecipe(recipe);
      if (!rec.name) rec.name = '';
      discardDraft();
      S.draft = rec;
      S.ki = { input: '', answer: '', error: '' };
      startDraft();
      location.hash = '#/edit/new';
      toast(warnings.length ? `✓ Rezept erkannt – ${warnings[0]}` : '✓ Rezept erkannt – bitte kurz prüfen und speichern', warnings.length ? 6000 : 3500);
    } catch (e) { k.error = e.message; render(); }
  },
  pickTpl: (el) => { const t = TEMPLATES.find((x) => x.id === el.dataset.t); discardDraft(); S.draft = t.build(); startDraft(); },
  pickBlank: (el) => { discardDraft(); S.draft = C.blankRecipe(el.dataset.c); startDraft(); },
  wizGo: (el) => { S.wiz = +el.dataset.i; render(); },
  wizNext: () => { S.wiz = Math.min(WIZ.length - 1, S.wiz + 1); render(); },
  wizPrev: () => { S.wiz = Math.max(0, S.wiz - 1); render(); },
  editCancel: async () => {
    if (!confirm('Änderungen verwerfen?')) return;
    const id = S.draft?.id, wasNew = S.draft?._new;
    discardDraft();
    location.hash = wasNew || !id ? '#/' : `#/r/${id}`;
  },
  editSave: async () => {
    const d = S.draft;
    d.name = (d.name || '').trim() || (d.category === 'bread' ? 'Neues Brot' : 'Neue Pizza');
    d.tags = (d._tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const removed = (S.draftOrig?.photos || []).filter((p) => !(d.photos || []).includes(p));
    delete d._new; delete d._tags;
    for (const p of removed) await db.deletePhoto(p);
    await saveRecipe(d);
    S.draft = null; S.scale = null; S.plan = null; S.draftNewPhotos = [];
    toast('✓ Rezept gespeichert');
    location.hash = `#/r/${d.id}`;
  },
  setCat: (el) => { S.draft.category = el.dataset.v; render(); },
  setYieldMode: (el) => {
    const d = S.draft, c = calc(d);
    d.yield.mode = el.dataset.v;
    if (el.dataset.v === 'flour') d.yield.flour = Math.round(c.F);
    else {
      d.yield.count = Math.max(1, Math.round(c.count || 1));
      if (!(num(d.yield.pieceWeight) > 0)) d.yield.pieceWeight = Math.round(c.D / d.yield.count);
    }
    render();
  },
  draftCount: (el) => { const y = S.draft.yield; y.count = Math.max(1, num(y.count) + +el.dataset.d); $('#d-count').value = y.count; liveDraft(); },
  setPw: (el) => { S.draft.yield.pieceWeight = +el.dataset.v; $('#d-pw').value = el.dataset.v; liveDraft(); },
  setHyd: (el) => { S.draft.water.pct = +el.dataset.v; liveDraft(); },
  addFlour: (el) => {
    const fl = S.draft.flours;
    const take = fl.length ? Math.min(20, num(fl[0].pct)) : 100;
    if (fl.length) fl[0].pct = Math.round((num(fl[0].pct) - take) * 100) / 100;
    fl.push({ name: el.dataset.v || '', pct: take });
    render();
  },
  delFlour: (el) => {
    const fl = S.draft.flours, [gone] = fl.splice(+el.dataset.i, 1);
    if (fl[0]) fl[0].pct = Math.round((num(fl[0].pct) + num(gone.pct)) * 100) / 100;
    render();
  },
  addPf: (el) => {
    const d = S.draft;
    const pf = C.makePf(el.dataset.v, { flourName: d.flours?.[0]?.name || '' });
    if ((el.dataset.v === 'levain' || el.dataset.v === 'madre') && !d.preferments.length && confirm('Sauerteig-Führung: Hefe im Hauptteig auf 0 setzen?')) d.yeastPct = 0;
    d.preferments.push(pf);
    render();
  },
  delPf: (el) => {
    const d = S.draft, pf = d.preferments[+el.dataset.i];
    d.preferments.splice(+el.dataset.i, 1);
    d.steps.forEach((s) => { if (s.stage === pf.id) s.stage = null; });
    render();
  },
  pfType: (el) => {
    const pf = S.draft.preferments[+el.dataset.i], t = PF_TYPES[el.dataset.v];
    const wasDefaultName = Object.values(PF_TYPES).some((x) => x.label === pf.name);
    Object.assign(pf, { type: el.dataset.v, hydration: t.hydration, yeastPct: t.yeastPct, starterPct: t.starterPct || 0, starterHydration: t.starterHydration || 100 });
    if (wasDefaultName) pf.name = t.label;
    render();
  },
  setUnit: async (el) => { S.settings.unitMode = el.dataset.v; await saveSettings(); render(); },
  setYeastType: (el) => {
    const d = S.draft, from = d.yeastType, to = el.dataset.v;
    if (from === to) return;
    const hasYeast = num(d.yeastPct) > 0 || d.preferments.some((pf) => num(pf.yeastPct) > 0);
    // Nur umrechnen, wenn gewünscht – wer die Menge schon passend eingetippt hat, will keine Änderung
    if (hasYeast && confirm(`Eingetragene Hefemengen auf ${yeastName(to)} umrechnen?\n\nOK = umrechnen (Trockenhefe ≈ ⅓ Frischhefe)\nAbbrechen = Mengen so lassen`)) {
      const f = to === 'dry' ? 1 / 3 : 3;
      d.yeastPct = Math.round(num(d.yeastPct) * f * 1000) / 1000;
      d.preferments.forEach((pf) => { pf.yeastPct = Math.round(num(pf.yeastPct) * f * 1000) / 1000; });
      toast(`Hefemengen auf ${yeastName(to)} umgerechnet`);
    }
    d.yeastType = to;
    render();
  },
  addExtra: (el) => { S.draft.extras.push({ name: el.dataset.v, pct: 1 }); render(); },
  delExtra: (el) => { S.draft.extras.splice(+el.dataset.i, 1); render(); },
  suggestSteps: () => {
    const d = S.draft;
    if (d.steps.length && !confirm('Bestehenden Ablauf durch einen Vorschlag ersetzen?')) return;
    d.steps = C.suggestSteps(d);
    S.openStep = null;
    render();
  },
  addStep: (el) => {
    const k = el.dataset.v, d = S.draft;
    const defaults = { prep: [15, 'rt'], autolyse: [45, 'rt'], mix: [15, 'rt'], bulk: [120, 'rt'], fold: [120, 'rt'], shape: [15, 'rt'], proof: [720, 'fridge'], temper: [180, 'rt'], preheat: [45, 'oven'], bake: [30, 'oven'], other: [30, 'rt'] };
    const [dur, loc] = defaults[k] || [30, 'rt'];
    const s = C.step(k, STEP_KINDS[k].label, dur, loc, k === 'fold' ? { repeat: { count: 4, intervalMin: 30 } } : {});
    const bakeIdx = d.steps.findIndex((x) => x.kind === 'bake');
    if (k !== 'bake' && k !== 'cool' && bakeIdx >= 0) d.steps.splice(bakeIdx, 0, s); else d.steps.push(s);
    S.openStep = s.id;
    render();
  },
  toggleStep: (el) => { S.openStep = S.openStep === el.dataset.id ? null : el.dataset.id; render(); },
  stepLoc: (el) => { S.draft.steps[+el.dataset.i].location = el.dataset.v; render(); },
  toggleRepeat: (el) => { const s = S.draft.steps[+el.dataset.i]; s.repeat = s.repeat ? null : { count: 4, intervalMin: 30 }; render(); },
  moveStep: (el) => { const i = +el.dataset.i, j = i + +el.dataset.d, st = S.draft.steps; [st[i], st[j]] = [st[j], st[i]]; if (j === 0) st[0].parallel = false; render(); },
  dupStep: (el) => { const i = +el.dataset.i, c = structuredClone(S.draft.steps[i]); c.id = uid(); S.draft.steps.splice(i + 1, 0, c); S.openStep = c.id; render(); },
  delStep: (el) => { S.draft.steps.splice(+el.dataset.i, 1); if (S.draft.steps[0]) S.draft.steps[0].parallel = false; render(); },
  setCover: (el) => { S.draft.cover = el.dataset.id; render(); },
  delDraftPhoto: (el) => {
    const d = S.draft, id = el.dataset.id;
    d.photos = d.photos.filter((p) => p !== id);
    if (d.cover === id) d.cover = null;
    if (S.draftNewPhotos.includes(id)) { S.draftNewPhotos = S.draftNewPhotos.filter((p) => p !== id); db.deletePhoto(id); }
    render();
  },

  planMode: (el) => { S.plan.mode = el.dataset.v; render(); },
  planCount: (el) => { if (!S.plan) return render(); S.plan.ov.count = Math.max(1, num(S.plan.ov.count) + +el.dataset.d); render(); },
  planYMode: (el) => {
    const r = S.plan && byId(S.plan.id);
    if (!r) return render();
    const o = S.plan.ov, to = el.dataset.v;
    if ((o.ymode === 'flour' ? 'flour' : 'pieces') === to) return;
    const c = calc(r, planOv(r));
    if (to === 'flour') Object.assign(o, { ymode: 'flour', flour: Math.round(c.F) });
    else {
      const net = c.D / (1 + num(r.yield.loss) / 100); // ohne Verlust-Zuschlag
      const pw = num(o.pieceWeight) > 0 ? num(o.pieceWeight) : num(r.yield.pieceWeight);
      const count = pw > 0 ? Math.max(1, Math.round(net / pw)) : 4;
      Object.assign(o, { ymode: 'pieces', count, pieceWeight: pw > 0 ? pw : Math.round(net / count) });
    }
    render();
  },
  nightOpt: () => {
    const r = S.plan && byId(S.plan.id);
    if (!r) return render();
    const best = optimizeNight(r);
    if (!best) { toast('Keine Kühlschrankphase (≥ 2 h) zum Anpassen vorhanden.'); return; }
    S.plan.adj = best.adj;
    render();
    toast(best.night ? `Besser geht's nicht – noch ${best.night} Schritt(e) nachts. Probier eine andere Backzeit.` : '✓ Kein Schritt mehr in der Nachtruhe', 3500);
  },
  nightReset: () => { S.plan.adj = {}; render(); },
  planIcs: () => {
    const r = S.plan && byId(S.plan.id);
    if (!r) return render();
    const start = planStart(r);
    const evs = sessionEvents({ id: 'plan', steps: planSteps(r), startAt: start, recipeName: r.name }, -Infinity);
    shareOrDownload(icsFor(evs, `Teigbuch: ${r.name}`), `${slug(r.name)}-backplan.ics`, r.name);
  },
  startSession: async () => {
    const r = S.plan && byId(S.plan.id);
    if (!r) return render();
    let startAt = planStart(r);
    if (startAt < Date.now() - 60000 && S.plan.mode !== 'now') {
      if (!confirm('Der Start liegt in der Vergangenheit. Trotzdem jetzt starten?')) return;
      startAt = Date.now();
    }
    const ov = planOv(r);
    const s = {
      id: uid(), recipeId: r.id, recipeName: r.name, category: r.category, createdAt: Date.now(), startAt, status: 'active',
      ov, calc: calc(r, ov), yeastType: r.yeastType, steps: structuredClone(planStepsBase(r)).map((x) => ({ ...x, doneAt: null })), notified: [], logId: null,
      room: S.plan.ov.room ?? '',
    };
    await saveSession(s);
    S.plan = null;
    if ('Notification' in window && Notification.permission === 'default') await askNotif();
    location.hash = `#/bake/${s.id}`;
    toast(startAt > Date.now() + 60000 ? '✓ Plan aktiviert – du wirst zum Start erinnert' : '✓ Los geht’s!');
  },

  stepDone: (el) => {
    const s = sessById(el.dataset.id), i = +el.dataset.i, hands = !!el.dataset.hands;
    if (!s || s.steps[i]?.doneAt) return render();
    const now = Date.now();
    const tl = planInfo(effSteps(s), s.startAt, now).tl;
    const cur = tl.find((x) => x.i === i);
    const left = cur ? cur.end - now : 0;
    if (feat('confirmEarly') && left >= 60000) {
      const next = tl.find((x) => x.i > i && !x.doneAt);
      sheet(`„${cur.name}“ läuft noch ${fmtDur(left / 60000)}`, [
        { label: next ? `Ja, weiter zu „${esc(next.name)}“` : 'Ja, Backvorgang abschließen', icon: 'check', primary: true,
          // Session frisch holen – während das Fenster offen war, kann ein Sync die Daten neu geladen haben
          run: () => { const s2 = sessById(s.id); if (s2?.steps[i]) finishStep(s2, i, hands); } },
      ], `Geplantes Ende: <b>${fmtRel(cur.end)}</b>. Trotzdem jetzt schon weiter?`);
      return;
    }
    finishStep(s, i, hands);
  },
  stepBack: async (el) => {
    const s = sessById(el.dataset.id);
    if (!s) return render();
    const last = s.steps.reduce((b, x, i) => (x.doneAt && (b < 0 || x.doneAt >= s.steps[b].doneAt) ? i : b), -1);
    if (last < 0) return;
    s.steps[last].doneAt = null;
    if (s.status === 'done') s.status = 'active';
    await saveSession(s);
    toast(`↶ Schritt „${s.steps[last].name}“ wieder geöffnet`);
    if (S.hands === s.id) speak(`Zurück: ${s.steps[last].name}.`);
    render();
  },
  handsOn: (el) => { S.hands = el.dataset.id; render(); keepAwake(true); speak('Teighände-Modus an.'); },
  handsExit: () => { S.hands = null; keepAwake(false); render(); },
  stepShift: async (el) => {
    const s = sessById(el.dataset.id), i = +el.dataset.i, st = s.steps[i];
    const eff = effSteps(s)[i];
    // nicht unter 1 Minute Gesamtdauer
    const delta = Math.max(1 - num(eff.durationMin), +el.dataset.min);
    st.shiftMin = num(st.shiftMin) + delta;
    await saveSession(s);
    toast(`${+el.dataset.min > 0 ? '+' : ''}${el.dataset.min} min – Zeitplan angepasst`);
    render();
  },
  sessStartNow: async (el) => { const s = sessById(el.dataset.id); s.startAt = Date.now(); s.createdAt = Date.now(); await saveSession(s); render(); },
  sessFinish: async (el) => { const s = sessById(el.dataset.id); s.status = 'done'; await saveSession(s); location.hash = '#/bake'; },
  sessCancel: async (el) => {
    if (!confirm('Backvorgang abbrechen?')) return;
    const s = sessById(el.dataset.id); s.status = 'cancelled'; await saveSession(s); location.hash = '#/bake';
  },
  sessIcs: (el) => {
    const s = sessById(el.dataset.id);
    const evs = sessionEvents(s, Date.now()).filter((e) => e.at > Date.now());
    if (!evs.length) { toast('Keine anstehenden Schritte mehr.'); return; }
    shareOrDownload(icsFor(evs, `Teigbuch: ${s.recipeName}`), `${slug(s.recipeName)}-backplan.ics`, s.recipeName);
  },
  sessMenu: (el) => {
    const s = sessById(el.dataset.id);
    sheet(s.recipeName, [
      { label: 'In Kalender eintragen (Wecker)', icon: 'cal', run: () => A.sessIcs({ dataset: { id: s.id } }) },
      ...(byId(s.recipeId) ? [{ label: 'Rezept öffnen', icon: 'book', run: () => { location.hash = `#/r/${s.recipeId}`; } }] : []),
      { label: 'Neu starten (Startzeit jetzt)', icon: 'timer', run: async () => { if (!confirm('Alle Schritte zurücksetzen und jetzt neu starten?')) return; s.startAt = Date.now(); s.createdAt = Date.now(); s.steps.forEach((x) => { x.doneAt = null; x.shiftMin = 0; }); s.status = 'active'; await saveSession(s); render(); } },
      ...(s.status === 'active' ? [{ label: 'Backvorgang abbrechen', icon: 'x', danger: true, run: () => A.sessCancel({ dataset: { id: s.id } }) }] : []),
      { label: 'Backvorgang löschen', icon: 'trash', danger: true, run: async () => { if (!confirm('Backvorgang löschen?')) return; await db.del('sessions', s.id); S.sessions = S.sessions.filter((x) => x.id !== s.id); location.hash = '#/bake'; } },
    ]);
  },
  askNotif,
  testNotif: async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: 'So sehen deine Erinnerungen aus.', icon: 'icons/icon-192.png', tag: 'test' };
    try { if (reg) await reg.showNotification('⏰ Teigbuch-Test', opts); else new Notification('⏰ Teigbuch-Test', opts); } catch (e) { toast('Fehler: ' + e.message); }
  },

  rate: (el) => {
    const l = S.logDraft, k = el.dataset.k, v = +el.dataset.v;
    if (k === 'rating') l.rating = l.rating === v ? 0 : v;
    else { l.sub ||= {}; const kk = k.split('.')[1]; l.sub[kk] = l.sub[kk] === v ? 0 : v; }
    render();
  },
  delLogPhoto: (el) => {
    const l = S.logDraft, id = el.dataset.id;
    l.photos = l.photos.filter((p) => p !== id);
    // Noch nie gespeicherte Fotos sofort löschen, gespeicherte erst beim Speichern
    if (S.logNewPhotos.includes(id)) { S.logNewPhotos = S.logNewPhotos.filter((p) => p !== id); db.deletePhoto(id); }
    else (l._removed ||= []).push(id);
    render();
  },
  logSave: async () => {
    const l = S.logDraft;
    const isNew = l._new;
    for (const p of l._removed || []) await db.deletePhoto(p);
    delete l._key; delete l._new; delete l._removed;
    S.logNewPhotos = [];
    await saveLog(l);
    if (isNew && l.sessionId) {
      const s = sessById(l.sessionId);
      if (s) { s.logId = l.id; s.status = 'done'; await saveSession(s); }
    }
    S.logDraft = null;
    const fresh = await checkAchievements();
    toast(fresh.length ? `✓ Gespeichert · 🏅 ${fresh[0].icon} ${fresh[0].title}${fresh.length > 1 ? ` +${fresh.length - 1}` : ''}` : '✓ Eintrag gespeichert', fresh.length ? 3500 : undefined);
    location.hash = `#/r/${l.recipeId}?tab=log`;
  },
  logDelete: async () => {
    const l = S.logDraft;
    if (!confirm('Eintrag löschen?')) return;
    for (const p of [...(l.photos || []), ...(l._removed || [])]) await db.deletePhoto(p);
    S.logNewPhotos = [];
    await db.del('logs', l.id);
    await sync.markDeleted('log', l.id);
    scheduleSync(500);
    S.logs = S.logs.filter((x) => x.id !== l.id);
    S.logDraft = null;
    location.hash = `#/r/${l.recipeId}?tab=log`;
  },
  bakeAgain: (el) => {
    const l = S.logs.find((x) => x.id === el.dataset.id), r = byId(l.recipeId), pr = l.params || {};
    S.plan = initPlan(r);
    Object.assign(S.plan.ov, { hydration: num(pr.hydration) > 0 ? num(pr.hydration) : r.water.pct });
    if (r.yield.mode !== 'flour' && num(pr.count) > 0 && num(pr.pieceWeight) > 0) Object.assign(S.plan.ov, { ymode: 'pieces', count: Math.max(1, Math.round(num(pr.count))), pieceWeight: num(pr.pieceWeight) });
    S.plan.adjOpen = true;
    location.hash = `#/plan/${r.id}`;
    toast('Werte aus dem Tagebuch übernommen');
  },
  applyLog: async (el) => {
    const l = S.logs.find((x) => x.id === el.dataset.id), r = byId(l.recipeId), pr = l.params || {};
    if (!confirm(`Hydration ${fmtPct(pr.hydration)}, Salz ${fmtPct(pr.salt)}${pr.count ? `, ${fmtNum(pr.count, 0)} × ${fmtNum(pr.pieceWeight, 0)} g` : ''} ins Rezept übernehmen?`)) return;
    if (pr.hydration) r.water.pct = num(pr.hydration);
    if (pr.salt) r.salt = num(pr.salt);
    if (pr.count && r.yield.mode !== 'flour') { r.yield.count = num(pr.count); r.yield.pieceWeight = num(pr.pieceWeight) || r.yield.pieceWeight; }
    await saveRecipe(r);
    S.scale = null; S.plan = null;
    toast('✓ Rezept aktualisiert');
    render();
  },

  qrCopy: async () => { try { await navigator.clipboard.writeText(S.qrUrl); toast('✓ Link kopiert'); } catch { toast('Kopieren nicht möglich'); } },
  qrShare: async () => { try { await navigator.share({ title: 'Teigbuch-Rezept', url: S.qrUrl }); } catch { /* abgebrochen */ } },
  scanQR: () => openScanner(),
  copyHere: async () => { try { await navigator.clipboard.writeText(location.href); toast('✓ Link kopiert'); } catch { toast('Kopieren nicht möglich'); } },
  qrPasteGo: () => {
    const v = $('#qr-paste')?.value || '';
    if (!v.includes('#/import/')) { toast('Das ist kein Teigbuch-Link.'); return; }
    closeSheet();
    location.hash = '#/import/' + v.split('#/import/')[1].trim();
  },
  importQR: async () => {
    const r = S.importPreview?.r;
    if (!r) return;
    if (S.recipes.some((x) => x.name === r.name)) r.name += ' (geteilt)';
    await saveRecipe(r);
    S.importPreview = null;
    toast('✓ Rezept übernommen');
    location.hash = `#/r/${r.id}`;
  },
  fixPick: (el) => { S.fixAnswers[el.dataset.k] = el.dataset.v; render(); },
  fixSave: async () => {
    let n = 0;
    for (const { r, qs } of recipesWithQuestions()) {
      let changed = false;
      for (const q of qs) {
        const v = S.fixAnswers[`${r.id}:${q.id}`];
        if (v === undefined || v === '') continue;
        if (q.input.type === 'number' && !(num(v) >= (q.input.min ?? 0))) continue;
        q.apply(r, v);
        changed = true;
      }
      if (changed) { await saveRecipe(r); n++; }
    }
    S.fixAnswers = {}; S.scale = null; S.plan = null;
    const left = recipesWithQuestions().length;
    toast(n ? `✓ ${n} Rezept${n > 1 ? 'e' : ''} ergänzt${left ? ` – ${left} offen` : ''}` : 'Bitte zuerst die Angaben auswählen bzw. eintragen.');
    if (!left) location.hash = '#/'; else render();
  },
  sbSaveCfg: async () => {
    const url = $('#sb-url').value.trim(), key = $('#sb-key').value.trim();
    sync.setConfig(url, key);
    if (!sync.configured()) { toast('URL muss mit https:// beginnen, Schlüssel vollständig einfügen.'); return; }
    S.settings.sbUrl = url; S.settings.sbKey = key;
    await saveSettings();
    toast('✓ Gespeichert – jetzt anmelden');
    render();
  },
  sbLogin: () => loginSheet('email', S.sbEmail || ''),
  sbSendCode: async (el) => {
    const email = $('#sb-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Bitte eine gültige E-Mail-Adresse eingeben.'); return; }
    el.disabled = true; el.textContent = 'Sende …';
    try { await sync.sendCode(email); S.sbEmail = email; loginSheet('code', email); }
    catch (e) { toast(e.message, 4000); el.disabled = false; el.textContent = 'E-Mail senden'; }
  },
  sbPaste: async () => {
    try { const t = await navigator.clipboard.readText(); if (t) $('#sb-code').value = t.trim(); }
    catch { toast('Bitte lange ins Feld tippen und „Einfügen“ wählen.'); }
  },
  sbVerify: async (el) => {
    const val = $('#sb-code').value.trim();
    const isLink = /https?:\/\//.test(val);
    if (!isLink && !/^\d{6,10}$/.test(val.replace(/\s/g, ''))) { toast('Bitte den Link aus der E-Mail einfügen.'); return; }
    el.disabled = true; el.textContent = 'Prüfe …';
    try {
      if (isLink) await sync.verifyLink(val); else await sync.verifyCode(S.sbEmail, val);
      closeSheet();
      // Gerät war vorher mit einem anderen Konto verbunden → Daten nicht ungefragt vermischen
      if (sync.consumeAccountSwitch() && (S.recipes.length || S.logs.length)
        && !confirm('Dieses Gerät war mit einem anderen Konto verbunden.\n\nOK = vorhandene Rezepte in dieses Konto übernehmen\nAbbrechen = vorhandene Rezepte vom Gerät entfernen und nur die Rezepte dieses Kontos laden')) {
        for (const st of ['recipes', 'logs', 'photos']) await db.clear(st);
        await reload();
      }
      toast('✓ Angemeldet – Rezepte werden abgeglichen …', 3500);
      await runSync();
      render();
    } catch (e) { toast(e.message, 4000); el.disabled = false; el.textContent = 'Anmelden'; }
  },
  sbSync: async () => { await runSync(); render(); toast(sync.info().lastError ? '⚠️ ' + sync.info().lastError : '✓ Abgeglichen', 3500); },
  sbLogout: async () => {
    if (!confirm('Dieses Gerät abmelden? Deine Rezepte bleiben auf dem Gerät und in der Cloud erhalten.')) return;
    await sync.logout();
    render();
  },
  exportAll: (el) => exportAll(!el.dataset.nophotos),
  importFile,
  install: async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; render(); },
  loadSamples: async () => {
    for (const t of TEMPLATES) await saveRecipe(t.build());
    toast(`✓ ${TEMPLATES.length} Beispielrezepte geladen`);
    location.hash = '#/';
    render();
  },
  wipe: async () => {
    const cloud = sync.loggedIn() ? '\n\nDeine Daten in der Cloud bleiben erhalten – dieses Gerät wird dabei abgemeldet.' : '';
    if (!confirm(`Wirklich ALLE Daten auf diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.${cloud}`)) return;
    if (!confirm('Letzte Chance: Alles auf diesem Gerät löschen?')) return;
    await sync.idle(); // laufenden Abgleich abwarten, damit er nichts zurückschreibt
    for (const st of ['recipes', 'logs', 'sessions', 'photos']) await db.clear(st);
    await sync.resetLocal();
    await reload();
    toast('Alle Daten gelöscht');
    location.hash = '#/';
  },
};

function startDraft() {
  S.draft._new = true;
  S.draft._tags = (S.draft.tags || []).join(', ');
  S.draftOrig = { photos: [] };
  S.wiz = 0;
  S.openStep = null;
  render();
}

// ---------- Eingaben ----------
const roots = { d: () => S.draft, l: () => S.logDraft, set: () => S.settings };
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = val;
}

function onBind(el) {
  const [root, ...rest] = el.dataset.bind.split('.');
  const obj = roots[root]?.();
  if (!obj) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.hasAttribute('data-num')) v = num(el.value);
  else v = el.value;
  setPath(obj, rest.join('.'), v);
  if (root === 'd') {
    if (el.hasAttribute('data-rerender')) render(); else liveDraft();
  } else if (root === 'set') {
    saveSettings();
    if (el.hasAttribute('data-rerender') && el.type !== 'checkbox') render();
  }
}

const INPUTS = {
  search: (el) => { S.listQuery = el.value; $('#cards').innerHTML = listCards(); hydratePhotos(); },
  fixNum: (el) => { (S.fixAnswers ||= {})[el.dataset.k] = el.value.trim(); },
  gram: (el) => { solveGram(el.dataset.gram, num(el.value)); liveDraft(); },
  pctamt: (el) => { gramDef(el.dataset.gram)?.set(num(el.value)); liveDraft(); },
  // Mehl umbenennen: Vorteige, die dieses Mehl nutzen, wandern mit
  flourName: (el) => {
    const d = S.draft, f = d.flours[+el.dataset.i], old = f.name;
    f.name = el.value;
    d.preferments.forEach((pf) => { if (pf.flourName === old) pf.flourName = el.value; });
    liveDraft();
    const box = $('#flour-lib-box');
    if (box) { const open = !!box.querySelector('details[open]'); box.innerHTML = flourLib(d); if (open) box.querySelector('details')?.setAttribute('open', ''); }
  },
  link: (el) => {
    const d = S.draft, f = el.dataset.link, v = num(el.value);
    d[f].pct = el.dataset.unit === 'pct' ? v : Math.round(C.pctFromGrams(d, f, v) * 100) / 100;
    liveDraft();
  },
  kiInput: (el) => { S.ki.input = el.value; const p = $('#ki-prompt'); if (p) p.value = KI.buildPrompt(el.value); },
  kiAnswer: (el) => { S.ki.answer = el.value; },
  wtemp: (el) => { S.draft.water.temp = C.optNum(el.value); liveDraft(); },
  ice: (el) => {
    const d = S.draft, v = C.optNum(el.value);
    if (v === '' || v <= 0) d.water.icePct = '';
    else if (el.dataset.unit === 'pct') d.water.icePct = Math.min(100, v);
    else {
      const mw = Math.max(0, calc(d).main.water);
      d.water.icePct = mw > 0 ? Math.min(100, Math.round((v / mw) * 10000) / 100) : '';
    }
    liveDraft();
  },
  dur: (el) => {
    const s = S.draft.steps[+el.dataset.i];
    const h = num(el.closest('.row').querySelector('[data-part="h"]').value);
    const m = num(el.closest('.row').querySelector('[data-part="m"]').value);
    s.durationMin = Math.max(0, Math.round(h * 60 + m));
    liveDraft();
  },
  scale: (el) => {
    const r = S.scale && byId(S.scale.id);
    if (!r) { render(); return; }
    S.scale.yield[el.dataset.k] = num(el.value);
    S.plan = null; // Planer übernimmt die neue Menge
    const c = calc(r, { yield: S.scale.yield });
    $('#ing-box').innerHTML = ingredientBlocks(c, r.yeastType, true);
    $('#sc-dough').innerHTML = scaleInfo(r, c);
    $('#sc-actions').classList.toggle('hidden', !scaleChanged(r));
  },
  wt: async (el) => {
    const k = el.dataset.k, v = num(el.value);
    const r = byId($('#wt-res').dataset.rid);
    if (k === 'ddt') { r.ddt = v; await saveRecipe(r); } else { S.settings[k] = v; saveSettings(); }
    $('#wt-res').innerHTML = waterTempResult(r);
  },
};

const CHANGES = {
  planAt: (el) => { const t = new Date(el.value).getTime(); if (Number.isFinite(t)) { S.plan.at = t; render(); } },
  meas: async (el) => {
    const s = sessById(el.dataset.id), st = s.steps[+el.dataset.i];
    st.meas ||= {};
    const v = el.value.trim().replace(',', '.');
    const k = el.dataset.k;
    // Wasser/Eis sind aus dem Rezept vorbelegt: Leeren heißt „heute nicht“ → '' merken statt löschen
    if (v === '' || !Number.isFinite(+v)) { if (k === 'water' || k === 'ice') st.meas[k] = ''; else delete st.meas[k]; } else st.meas[k] = +v;
    await saveSession(s);
    const sum = $('#meas-sum');
    if (sum) sum.innerHTML = measLabel(st.meas) || 'Temperatur notieren';
    S.measOpen = `${s.id}:${el.dataset.i}`;
    S.measDirty = true; // neu zeichnen, sobald der Fokus das Feld verlässt (Zeitplan kann sich ändern)
  },
  planOv: (el) => {
    const k = el.dataset.k;
    let v = k === 'room' && el.value.trim() === '' ? '' : num(el.value);
    if (k === 'count') v = Math.max(1, Math.round(v));
    if ((k === 'pieceWeight' || k === 'flour') && !(v > 0)) { toast('Bitte eine Menge größer 0 eingeben'); render(); return; }
    if (k === 'hydration' && !(v > 0)) { toast('Bitte eine Hydration größer 0 eingeben'); render(); return; }
    S.plan.ov[k] = v;
    if (k === 'hydration' || k === 'room') S.plan.adjOpen = true;
    render();
  },
  addPhotos: async (el) => {
    const files = [...(el.files || [])];
    if (!files.length) return;
    toast('Foto wird gespeichert …');
    const target = el.dataset.target === 'l' ? S.logDraft : S.draft;
    for (const f of files) {
      try {
        const id = await db.addPhoto(f);
        target.photos = [...(target.photos || []), id];
        if (el.dataset.target === 'd') S.draftNewPhotos.push(id); else S.logNewPhotos.push(id);
      } catch (e) { toast('Foto konnte nicht gespeichert werden: ' + e.message); }
    }
    render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = A[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'A' && el.dataset.action !== 'sheetClose') e.preventDefault();
  if (el.dataset.action === 'sheetClose' && el.dataset.keep) e.preventDefault();
  fn(el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.bind && el.tagName !== 'SELECT') onBind(el);
  if (el.dataset.input && INPUTS[el.dataset.input]) INPUTS[el.dataset.input](el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.bind && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date')) {
    onBind(el);
    if (el.type === 'checkbox' && el.dataset.bind.startsWith('set.') && el.hasAttribute('data-rerender')) render();
  }
  if (el.dataset.change && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, e);
});
document.addEventListener('toggle', (e) => {
  if (e.target.dataset?.actionToggle === 'adj' && S.plan) S.plan.adjOpen = e.target.open;
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------- Start ----------
async function reload() {
  const [recipes, logs, sessions, settings] = await Promise.all([db.getAll('recipes'), db.getAll('logs'), db.getAll('sessions'), db.get('meta', 'settings')]);
  S.recipes = recipes || []; S.logs = logs || []; S.sessions = sessions || [];
  if (settings) Object.assign(S.settings, settings);
}

// Nach einem App-Update: vorhandene Daten auf dem Gerät auf das aktuelle Datenformat bringen.
// (updatedAt bleibt gleich – jedes Gerät migriert selbst, es muss nichts neu synchronisiert werden.)
async function migrateLocal() {
  let n = 0;
  for (const [store, list, mig] of [['recipes', S.recipes, MG.migrateRecipe], ['logs', S.logs, MG.migrateLog]]) {
    for (let i = 0; i < list.length; i++) {
      if (!MG.needsMigration(list[i])) continue;
      const { rec } = mig(list[i]);
      list[i] = rec;
      await db.put(store, rec);
      n++;
    }
  }
  return n;
}

async function init() {
  try { await reload(); await migrateLocal(); await checkAchievements(); } catch (e) { console.error(e); toast('Speicher nicht verfügbar – Daten können nicht gesichert werden.', 5000); }
  try { await sync.init(S.settings); } catch (e) { console.error(e); }
  sync.onUpdate(() => {
    // Status in den Einstellungen aktualisieren (ohne beim Tippen zu stören)
    if (route().parts[0] === 'settings' && !document.activeElement?.matches('input,textarea,select')) render();
  });
  window.addEventListener('online', () => scheduleSync(1000));
  setInterval(() => { if (!document.hidden) runSync(); }, 5 * 60000);
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    // Neue App-Version ist komplett geladen → einmal neu laden, damit alle Dateien zusammenpassen
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      // nicht mitten in einer Eingabe neu laden
      if (S.draft || S.logDraft) { toast('Neue Version installiert – wird beim nächsten Öffnen aktiv.', 4000); return; }
      location.reload();
    });
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'nav') location.hash = e.data.hash; });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { tick(); if (S.hands) keepAwake(true); if (route().parts[0] === 'bake') render(); scheduleSync(500); }
  });
  render();
  scheduleSync(800);
  setInterval(tick, 1000);
  db.persist();
}

init();
