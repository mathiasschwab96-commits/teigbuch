// Teigbuch – App-Oberfläche
//
// Aufbau dieser Datei (Abschnitte sind mit „// ---------- Name ----------“ markiert, Suche nach dem Namen):
//   Funktionen an/aus · kleine Helfer · Speichern · Geräte-Sync · Router
//   Ansichten:  Übersicht · Fehlende Angaben · Rezept-Detail · Kuchen umrechnen · Editor (inkl. KI-Brücke,
//               Mengen in % oder g, Kuchen) · Planer · Backvorgang · 🎨 Anpassen · Teighände-Modus ·
//               Temperatur-Messwerte · Backprotokoll · Vergleich · Tagebuch ansehen/bearbeiten ·
//               🫙 Meine Kulturen · 🌾 Meine Mehle · Einstellungen
//   Technik:    Export/Import/Teilen · QR-Code · Benachrichtigungen · Sheet (Auswahlmenü)
//   Bedienung:  Aktionen (A, data-action) · Eingaben (INPUTS data-input, CHANGES data-change, data-bind)
//               · Navigation/Zurück · Kein Zoomen · Start
// Andere Dateien: calc.js (Rechnen, Zeitplan, Vorlagen, Datenbereinigung) · extras.js (Mehl-Wissen, Ampel,
//   Erfolge) · migrate.js (Datenversionen) · db.js (Speicher) · sync.js (Supabase) · ki-import.js · qr.js
import * as db from './db.js';
import * as C from './calc.js';
import { qrSVG } from './qr.js';
import * as sync from './sync.js';
import * as MG from './migrate.js';
import * as X from './extras.js';
import * as KI from './ki-import.js';

const { calc, fmtG, fmtPct, fmtNum, fmtDur, fmtRel, fmtTime, fmtCountdown, planInfo, uid, num, PF_TYPES, STEP_KINDS, LOCATIONS, TEMPLATES } = C;
const VERSION = '2.6.1';
const EXPORT_META = { schema: MG.SCHEMA, appVersion: VERSION };
// Einheitlicher Weg für ALLE Daten von außen (Datei, QR, Sync): erst migrieren, dann bereinigen
const { importRecipe, importLog } = MG;
// Fallback für ältere Browser (iOS < 15.4)
if (typeof globalThis.structuredClone !== 'function') globalThis.structuredClone = (o) => JSON.parse(JSON.stringify(o));

const S = {
  recipes: [], logs: [], sessions: [], cultures: [],
  settings: { id: 'settings', nightFrom: 23, nightTo: 7, lastBackup: 0, ddtRoom: 22, ddtFlour: 21, ddtPf: 22, ddtFriction: 3, refRoom: 22,
    features: { tempComp: true, handsFree: true, voice: true, wakeLock: true, qr: true, nightOpt: true } },
  hands: null, ticks: new Set(), measOpen: null, ki: { input: '', answer: '', error: '' }, importPreview: null, scanStream: null, logNewPhotos: [], searchOpen: false,
  draft: null, draftOrig: null, draftNewPhotos: [], wiz: 0, openStep: null,
  logDraft: null, scale: null, plan: null, installEvt: null, listQuery: '', listFilter: 'all', sheetItems: [],
};

const CAT = {
  pizza: { label: 'Pizza', icon: '🍕', piece: 'Teigling', pieces: 'Teiglinge' },
  bread: { label: 'Brot', icon: '🍞', piece: 'Laib', pieces: 'Laibe' },
  fine: { label: 'Feingebäck', icon: '🥐', piece: 'Stück', pieces: 'Stück' },
  cake: { label: 'Kuchen', icon: '🎂', piece: 'Kuchen', pieces: 'Kuchen' },
  other: { label: 'Sonstiges', icon: '🍽️', piece: 'Stück', pieces: 'Stück' },
};
// Feingebäck & Kuchen lassen sich unter Einstellungen → Funktionen ausblenden (vorhandene Rezepte bleiben)
const NEW_CATS = ['fine', 'cake'];
const catsShown = (cur) => Object.keys(CAT).filter((k) => feat('pastry') || !NEW_CATS.includes(k) || k === cur);
const isCake = C.isCake;
const FLOUR_PRESETS = ['Tipo 00', 'Tipo 0', 'Tipo 1', 'Manitoba', 'Semola rimacinata', 'Weizenmehl 405', 'Weizenmehl 550', 'Weizenvollkornmehl', 'Dinkelmehl 630', 'Roggenmehl 1150'];
const SUBRATINGS = {
  pizza: [['rim', 'Rand'], ['base', 'Boden'], ['taste', 'Geschmack'], ['digest', 'Bekömmlichkeit']],
  bread: [['crust', 'Kruste'], ['crumb', 'Krume'], ['spring', 'Ofentrieb'], ['taste', 'Geschmack']],
  fine: [['flaky', 'Blätterung / Lockerheit'], ['crumb', 'Krume / Waben'], ['color', 'Farbe & Glanz'], ['taste', 'Geschmack']],
  cake: [['texture', 'Textur'], ['moist', 'Saftigkeit'], ['look', 'Optik'], ['taste', 'Geschmack']],
  other: [['texture', 'Textur'], ['taste', 'Geschmack']],
};
// Rechnet ein Rezept passend zu seiner Art: Bäckerprozente oder Kuchen (Zutatenliste × Formfaktor)
const calcFor = (r, ov) => (isCake(r) ? C.calcCake(r, ov) : calc(r, ov));

// ---------- Funktionen an/aus ----------
const feat = (k) => S.settings.features?.[k] !== false;
const FEATURES = ['tempComp', 'handsFree', 'confirmEarly', 'adjust', 'nightOpt', 'yeastFit', 'pastry', 'cultures', 'myFlours', 'convert', 'flourAmp', 'qr'];
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
  if (!same) S.prevHash = lastHash; // für „Zurück“-Knöpfe und Speichern (zurück statt neue Seite)
  lastHash = location.hash;
  if (S.hands && !(a === 'bake' && b === S.hands)) { S.hands = null; keepAwake(false); }
  document.body.toggleAttribute('data-hands', !!S.hands);
  let out, tab = 'recipes';
  X.setMyFlours(feat('myFlours') ? S.flours || [] : []); // Schalter „Meine Mehle“ wirkt sofort
  try {
    if (!a) out = vList();
    else if (a === 'r') out = vRecipe(b, q.get('tab') || 'ing');
    else if (a === 'edit') out = vEdit(b);
    else if (a === 'plan') out = vPlan(b);
    else if (a === 'bake') { tab = 'bake'; out = b ? vSession(b) : vBakeList(); }
    else if (a === 'log') out = c === 'new' || parts[3] === 'edit' ? vLog(b, c, q) : vLogView(b, c, q);
    else if (a === 'cmp') out = vCmp(b, q);
    else if (a === 'culture') { tab = 'bake'; out = vCulture(b); }
    else if (a === 'flour') { tab = 'bake'; out = vFlour(b); }
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
  const filters = [['all', 'Alle'], ...Object.entries(CAT).map(([k, v]) => [k, `${v.icon} ${v.label}`]).filter(([k]) => cats.has(k)),
    ...(S.recipes.some((r) => r.favorite) ? [['fav', '★ Favoriten']] : [])];
  const showSearch = S.searchOpen || S.listQuery;
  const html = `
  <header class="top">
    <div><div class="eyebrow">${feat('pastry') ? 'Pizza · Brot · Gebäck' : 'Pizza &amp; Brot'}</div><h1 class="title brand">Teigbuch</h1></div>
    ${S.recipes.length ? `<div class="top-actions"><button class="icon-btn tonal" data-action="toggleSearch" aria-label="Suchen">${icon('search')}</button></div>` : ''}
  </header>
  <div class="pad">
    ${sessionBanners(active)}
    ${cultureHint()}
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
        <div class="meta">${isCake(r) ? `${esc(C.panLabel(r.pan) || 'Kuchen')} · ${(r.parts || []).reduce((n, p) => n + (p.items || []).length, 0)} Zutaten` : `${pfLabel(r.preferments)} · ${num(r.water?.pct) > 0 ? `${fmtNum(r.water.pct)} %` : `wirksam ${fmtPct(calc(r).totals.hydEff)}`}${num(r.lamination?.pct) > 0 ? ' · 🧈 touriert' : ''}`}${r.steps?.length ? ` · ${fmtDur(info.total)}` : ''}</div>
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
  const cur = curStep(info.tl);
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
  if (!S.scale || S.scale.id !== id) S.scale = { id, yield: { ...r.yield }, ...cakeScaleInit(r) };
  const cover = coverOf(r);
  const info = planInfo(r.steps, 0);
  const avg = avgRating(id);
  const logs = logsFor(id);
  const c = calcFor(r);
  const cake = isCake(r);
  const tabs = [['ing', 'Zutaten'], ['flow', 'Ablauf'], ['log', `Tagebuch${logs.length ? ` (${logs.length})` : ''}`]];
  let body = '';
  if (tab === 'flow') body = recipeFlow(r, info);
  else if (tab === 'log') body = recipeLog(r, logs);
  else body = cake ? cakeIng(r) : recipeIng(r);
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
      ${cake ? `${C.panLabel(r.pan) ? `<span class="fact">⭕ ${esc(C.panLabel(r.pan))}</span>` : ''}<span class="fact">⚖️ ≈ ${fmtG(c.total)}</span>`
        : `<span class="fact">💧 ${c.totals.hydration < 0.5 && c.totals.hydEff > 0 ? `wirksam ${fmtPct(c.totals.hydEff)}` : `${fmtPct(c.totals.hydration)}${showEff(c) ? ` <small>· wirksam ${fmtPct(c.totals.hydEff)}</small>` : ''}`}</span>
      <span class="fact">${r.preferments?.length ? `🧱 ${pfLabel(r.preferments)}` : '⚡ direkt'}</span>
      ${c.lam.g > 0 ? `<span class="fact">🧈 ${fmtPct(c.lam.pct)} Ziehfett</span>` : ''}`}
      ${r.steps?.length ? `<span class="fact">⏱ ${fmtDur(info.total)}</span>` : ''}
      ${avg ? `<span class="fact">★ ${fmtNum(avg)} <small>(${logs.length})</small></span>` : ''}
    </div>
    ${MG.openQuestions(r).length ? `<div class="hint-card warnc"><div>📝 Hier fehlt noch eine Angabe: ${esc(MG.openQuestions(r)[0].question)}</div><a class="btn sm primary" href="#/fix">Nachtragen</a></div>` : ''}
    ${cake ? '' : flourAmp(X.flourCheck(r), { quiet: true })}
    <a class="btn primary big block" href="#/plan/${id}">${icon('timer')} Backen planen</a>
    <div class="seg" role="tablist">${tabs.map(([k, l]) => `<a role="tab" data-replace class="${tab === k ? 'on' : ''}" href="#/r/${id}?tab=${k}">${l}</a>`).join('')}</div>
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
  return `Teig gesamt <b>${fmtG(c.D)}</b> · Mehl ${fmtG(c.F)}${c.lam?.g > 0 ? ` · davon Ziehfett ${fmtG(c.lam.g)}` : ''}${Math.abs(f - 1) > 0.005 ? ` · <b>${fmtNum(f, 2)}×</b> Rezept` : ''}`;
}
// Wirksame Hydration (inkl. Milch, Ei …) nur zeigen, wenn sie sich spürbar von der Wasser-Hydration unterscheidet
const showEff = (c) => num(c.totals?.hydEff) - num(c.totals?.hydration) > 0.5;

// ---------- Kuchen: Mengen umrechnen (Backform / Faktor) ----------
const cakeScaleInit = (r) => (isCake(r) ? { cmode: C.panValid(r.pan) ? 'pan' : 'factor', pan: { ...r.pan }, factor: 1 } : {});
const cakeOv = (st) => (st?.cmode === 'factor' || !C.panValid(st?.pan) ? { factor: num(st?.factor) > 0 ? num(st.factor) : 1 } : { pan: { ...st.pan } });
const cakeState = (t) => (t === 'plan' ? S.plan?.ov : S.scale);
const PAN_PRESETS = {
  round: [[18], [20], [22], [24], [26], [28]].map(([d]) => ({ label: `Ø ${d}`, shape: 'round', d })),
  rect: [{ label: '20 × 20', l: 20, w: 20 }, { label: 'Kasten 25', l: 25, w: 11 }, { label: 'Kasten 30', l: 30, w: 11 }, { label: '30 × 20', l: 30, w: 20 }, { label: 'Blech 40 × 30', l: 40, w: 30 }].map((x) => ({ ...x, shape: 'rect' })),
};
function cakeScaler(r, st, t) {
  const base = r.pan || {}, count = base.shape === 'count', canPan = C.panValid(base);
  const mode = canPan && st.cmode !== 'factor' ? 'pan' : 'factor';
  const p = st.pan || {};
  const inp = (k, v, label, w = '') => `<span class="unit-in ${w}"><input class="in" inputmode="decimal" data-change="cake" data-t="${t}" data-k="${k}" value="${v ? fmtIn(v, 1) : ''}" aria-label="${label}"><span class="u">${k === 'n' ? 'Stk' : k === 'factor' ? '×' : 'cm'}</span></span>`;
  let body;
  if (mode === 'factor') {
    body = `<div class="scaler-row">${inp('factor', st.factor || 1, 'Faktor')}</div>
      <div class="chips">${[0.5, 0.75, 1.5, 2].map((f) => `<button class="chip" data-action="cPreset" data-t="${t}" data-f="${f}">${fmtNum(f, 2)}×</button>`).join('')}</div>`;
  } else if (count) {
    body = `<div class="scaler-row">${inp('n', p.n, 'Anzahl')}</div>`;
  } else {
    const shape = p.shape === 'rect' ? 'rect' : 'round';
    body = `<div class="seg small" style="margin:0 0 8px">${[['round', 'Rund'], ['rect', 'Eckig']].map(([k, l]) => `<button class="${shape === k ? 'on' : ''}" data-action="cShape" data-t="${t}" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="scaler-row">${shape === 'round' ? `<span class="x">Ø</span>${inp('d', p.d, 'Durchmesser')}` : `${inp('l', p.l, 'Länge')}<span class="x">×</span>${inp('w', p.w, 'Breite')}`}</div>
      <div class="chips">${PAN_PRESETS[shape].map((x) => `<button class="chip" data-action="cPreset" data-t="${t}" data-shape="${x.shape}" data-d="${x.d || 0}" data-l="${x.l || 0}" data-w="${x.w || 0}">${x.label}</button>`).join('')}</div>`;
  }
  return `${canPan ? `<div class="seg small" style="margin:0 0 10px">${[['pan', count ? 'Stückzahl' : 'Backform'], ['factor', 'Faktor']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-action="cMode" data-t="${t}" data-v="${k}">${l}</button>`).join('')}</div>` : ''}${body}`;
}
function cakeInfo(r, c) {
  const changed = Math.abs(c.factor - 1) > 0.005;
  return `${C.panLabel(c.pan) ? `${esc(C.panLabel(c.pan))} · ` : ''}Zutaten ≈ <b>${fmtG(c.total)}</b>${changed ? ` · <b>${fmtNum(c.factor, 2)}×</b> Rezept` : ''}${changed && r.pan?.shape !== 'count' && c.pan ? '<br><small>Die Höhe bleibt gleich – Backzeit ähnlich, bei deutlich kleinerer Form etwas früher prüfen.</small>' : ''}`;
}
function cakeChanged(r) {
  const st = S.scale?.id === r.id ? S.scale : null;
  if (!st) return false;
  const c = C.calcCake(r, cakeOv(st));
  return Math.abs(c.factor - 1) > 0.0001 || (st.cmode !== 'factor' && C.panLabel(st.pan) !== C.panLabel(r.pan));
}
function cakeIng(r) {
  const c = C.calcCake(r, cakeOv(S.scale));
  return `
  <section class="card scaler">
    <div class="card-h"><b>Menge anpassen</b>${C.panLabel(r.pan) ? `<small class="muted">Rezept: ${esc(C.panLabel(r.pan))}</small>` : ''}</div>
    ${cakeScaler(r, S.scale, 'scale')}
    <div class="muted small" style="margin-top:8px">${cakeInfo(r, c)}</div>
    <div class="row gap ${cakeChanged(r) ? '' : 'hidden'}"><button class="btn sm ghost" data-action="scaleReset">Zurück zum Rezept</button>${S.scale.cmode !== 'factor' && C.panValid(S.scale.pan) && C.panValid(r.pan) ? '<button class="btn sm" data-action="scaleSave">Als Standard</button>' : ''}</div>
  </section>
  <div id="ing-box">${cakeBlocks(c)}</div>
  ${r.notes ? `<details class="card"><summary>📝 Notizen</summary><p class="pre">${esc(r.notes)}</p></details>` : ''}`;
}
// Menge mit Einheit lesbar machen: 1,77 Eier → „1½ Stk“ (≈ 92 g)
const FR = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
function fracTxt(v, step) {
  const r = Math.round(v / step) * step;
  const w = Math.floor(r + 1e-9), f = Math.round((r - w) * 100) / 100;
  return r <= 0 ? FR[step] || fmtNum(step, 2) : `${w || ''}${f ? FR[f] || fmtNum(f, 2).replace(/^0/, '') : ''}` || '0';
}
function amtTxt(it) {
  const v = it.v;
  if (!(it.amount > 0)) return { txt: 'n. B.' };
  if (it.unit === 'g') return { txt: fmtG(v), g: v };
  if (it.unit === 'ml') return { txt: `${fmtNum(v, v < 20 ? 1 : 0)} ml` };
  if (it.unit === 'Prise') return { txt: `${Math.max(1, Math.round(v))} Prise${Math.round(v) > 1 ? 'n' : ''}` };
  const step = it.unit === 'Stk' || it.unit === 'Pck' ? 0.5 : 0.25;
  const t = fracTxt(v, step), rounded = Math.round(v / step) * step;
  const pg = it.unit === 'Stk' ? C.pieceGrams(it.name) : 0;
  const hint = [pg && `≈ ${fmtG(v * pg)}${pg >= 30 ? ' (verquirlt abwiegen)' : ''}`, Math.abs(rounded - v) > 0.04 && `genau ${fmtNum(v, 2)}`].filter(Boolean).join(' · ');
  return { txt: `${t} ${it.unit === 'Pck' ? 'Pck.' : it.unit}`, hint };
}
const cakeRows = (p) => p.items.map((it, k) => { const a = amtTxt(it); return { key: `i${k}`, type: 'cake', unit: it.unit, v: it.v, name: it.name || 'Zutat', txt: a.txt, g: a.g, hint: a.hint }; });
function cakeBlocks(c) {
  const warn = c.warnings.length ? `<div class="warn">${c.warnings.map((w) => `⚠️ ${esc(w)}`).join('<br>')}</div>` : '';
  if (!c.parts.length) return `${warn}<div class="empty small"><p>Noch keine Zutaten eingetragen.</p></div>`;
  return warn + c.parts.map((p, i) => ingTable(`🥣 ${esc(p.name || 'Zutaten')}`, c.parts.length > 1 ? `Teil ${i + 1}` : '', cakeRows(p), 'main')).join('');
}

function ingTable(title, sub, rows, cls = '') {
  // Summe nur, wenn alle Zeilen in Gramm sind (Kuchen: EL, Stk … lassen sich nicht addieren)
  const allG = rows.length > 0 && rows.every((x) => Number.isFinite(x.g));
  const total = rows.reduce((s, x) => s + (x.g || 0), 0);
  return `<section class="ing ${cls}" ${title ? `data-tk="${esc(title.replace(/<[^>]*>/g, ''))}"` : ''}>
    ${title ? `<h3>${title}${sub ? `<small>${sub}</small>` : ''}</h3>` : ''}
    <table>${rows.map((x) => `<tr data-action="tick" ${x.chg ? 'class="chg"' : ''}><td>${x.type === 'flour' && myF(x.name) ? fDot(myF(x.name)) : ''}${esc(x.name)}${x.hint ? `<small>${esc(x.hint)}</small>` : ''}</td><td class="num">${x.txt ?? fmtG(x.g)}</td></tr>`).join('')}
    ${allG ? `<tr class="sum"><td>Summe</td><td class="num">${fmtG(total)}</td></tr>` : ''}</table>
  </section>`;
}

// Zeilen tragen einen Schlüssel (key) und eine Art (type) – für „🎨 Anpassen“ und das Backprotokoll
// Einlagen (Rosinen, Nüsse, Kandiertes …) erst zum Schluss unterarbeiten – nur Hinweis + am Ende der Liste
const LATE = /rosine|sultanine|korinthe|orangeat|zitronat|kandiert|nüsse|nuss|mandel|schoko(drops|stück|tropfen)|cranberr|olive|röstzwiebel|speckwürfel|feige|dattel|aprikose|trockenobst/i;
function pfRows(x, yt) {
  const rows = [];
  const src = x.chained ? x.src : '';
  if (x.starter > 0) rows.push({ key: 'starter', type: src ? 'fixed' : 'starter', name: src ? 'Vorige Stufe (komplett)' : x.pf.type === 'madre' ? 'Lievito Madre (aufgefrischt)' : 'Anstellgut', hint: src ? '' : `${fmtNum(x.pf.starterHydration ?? 100, 0)} % Hydration`, g: x.starter });
  // Mehl: eine Sorte (Schlüssel „flour“) oder Mischung (fl0, fl1 …); beim Backen dazugemischte Sorten (a0 …)
  const parts = !x.seeds && (x.flourParts || []).length ? x.flourParts : [{ name: x.flourName, g: x.freshFlour }];
  const multi = parts.filter((q) => !q._key).length > 1;
  parts.forEach((q, k) => { rows.push({ key: q._key || (multi ? `fl${k}` : 'flour'), type: x.seeds ? 'seeds' : 'flour', name: x.seeds ? (q.name || 'Saaten') : (q.name || 'Mehl'), hint: x.seeds ? 'zählt nicht zum Mehl' : '', g: q.g }); });
  // Wasser / Milch & Co. / gemischt – nur echtes Wasser ist „water“ (für Hydration, Ziel-Hydration, +10 g Wasser)
  const ln = x.liqName || 'Milch', mix = x.milk && x.milkG < x.freshWater - 0.05;
  rows.push({ key: 'water', type: x.seeds ? 'soak' : x.milk ? 'milk' : 'water', name: x.seeds ? 'Quellwasser' : mix ? `Wasser + ${ln}` : x.milk ? ln : 'Wasser',
    hint: mix ? `davon ${fmtG(x.milkG)} ${ln}` : '', g: x.freshWater });
  if (x.yeast > 0) rows.push({ key: 'yeast', type: 'yeast', name: yeastName(yt), g: x.yeast });
  if (x.salt > 0) rows.push({ key: 'salt', type: 'salt', name: 'Salz', g: x.salt });
  (x.extras || []).forEach((e, k) => rows.push({ key: `x${k}`, type: 'extra', name: e.name || 'Zutat', g: e.g }));
  return rows;
}
function mainRows(c, yt) {
  const rows = [];
  // Nur Vorteige, die in den Hauptteig kommen (eine Stufe, die in der nächsten steckt, nicht doppelt)
  c.pfs.filter((x) => !x.consumed).forEach((x) => rows.push({ key: `pf:${x.id}`, type: 'fixed', name: x.pf.name || 'Vorteig', hint: 'kompletter Vorteig', g: x.total }));
  c.main.flours.forEach((f, k) => { if (f.g > 0.05 || f._key) rows.push({ key: f._key || `f${k}`, type: 'flour', name: f.name, g: f.g }); });
  const w = Math.max(0, c.main.water), ice = Math.min(w, num(c.main.ice));
  const wt = c.main.waterTemp;
  rows.push({ key: 'water', type: 'water', name: wt !== undefined && wt !== '' ? `Wasser (${fmtNum(wt)} °C)` : 'Wasser', g: w - ice });
  if (ice > 0) rows.push({ key: 'ice', type: 'water', name: 'Eis', hint: 'ersetzt einen Teil des Wassers', g: ice });
  if (c.main.salt > 0) rows.push({ key: 'salt', type: 'salt', name: 'Salz', g: c.main.salt });
  if (c.main.yeast > 0) rows.push({ key: 'yeast', type: 'yeast', name: yeastName(yt), g: c.main.yeast });
  if (c.main.oil > 0) rows.push({ key: 'oil', type: 'oil', name: 'Öl', g: c.main.oil });
  const late = [];
  c.main.extras.forEach((e, j) => { if (e.g > 0 || e._key) (LATE.test(e.name || '') ? late : rows).push({ key: e._key || `x${j}`, type: 'extra', name: e.name || 'Zutat', g: e.g, hint: LATE.test(e.name || '') ? 'zum Schluss unterarbeiten' : '' }); });
  return [...rows, ...late];
}
// Ziehfett: dazu die ungefähre Größe der Butterplatte (1 cm dick, Butter ≈ 0,91 g/cm³)
function lamRows(c) {
  const side = Math.sqrt(c.lam.g / 0.91);
  return [{ key: 'lam', type: 'lam', name: c.lam.name, hint: `Platte ca. ${fmtNum(side, 0)} × ${fmtNum(side, 0)} cm, 1 cm dick`, g: c.lam.g }];
}
function stageRows(c, stage, yt) {
  if (c.kind === 'cake') { const p = c.parts.find((x) => x.id === stage); return p ? { title: p.name || 'Zutaten', rows: cakeRows(p) } : null; }
  if (stage === 'main') return { title: 'Hauptteig', rows: mainRows(c, yt) };
  if (stage === 'lam') return c.lam?.g > 0 ? { title: 'Ziehfett', rows: lamRows(c) } : null;
  const x = c.pfs.find((p) => p.id === stage);
  return x ? { title: x.pf.name || 'Vorteig', rows: pfRows(x, yt) } : null;
}

function ingredientBlocks(c, yt, withTotals) {
  if (c.kind === 'cake') return cakeBlocks(c);
  const warn = c.warnings.length ? `<div class="warn">${c.warnings.map((w) => `⚠️ ${esc(w)}`).join('<br>')}</div>` : '';
  const blocks = c.pfs.map((x, i) => ingTable(`${PF_TYPES[x.pf.type]?.icon || '🥣'} ${esc(x.pf.name || 'Vorteig')}`, `Stufe ${i + 1}`, pfRows(x, yt), 'pf')).join('');
  const main = ingTable(c.lam?.g > 0 ? '🌀 Grundteig' : '🌀 Hauptteig', c.pfs.length ? `Stufe ${c.pfs.length + 1}` : 'direkte Führung', mainRows(c, yt), 'main')
    + (c.lam?.g > 0 ? ingTable('🧈 Ziehfett', 'zum Tourieren', lamRows(c), 'pf') : '');
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
      ...c.main.extras.filter((e) => (e.total ?? e.g) > 0).map((e) => [e.name || 'Zutat', e.total ?? e.g, e.pct]),
      c.lam?.g > 0 && [`${c.lam.name} (Ziehfett)`, c.lam.g, c.lam.pct],
      ...c.pfs.filter((x) => x.seeds).map((x) => [`${x.flourName} (Quellstück, kein Mehl)`, x.flour, x.pf.flourPct]),
    ].filter(Boolean);
    totals = `<details class="card totals"><summary>Σ Gesamtrezept <small class="muted">Bäckerprozente · ${fmtG(t.dough)}</small></summary>
      <section class="ing"><table>${rows.map(([n, g, pc, h]) => `<tr><td>${esc(n)}${h ? `<small>${esc(h)}</small>` : ''}</td><td class="num">${fmtG(g)}</td><td class="num pct">${fmtPct(pc)}</td></tr>`).join('')}
      ${c.pfs.length ? `<tr class="sub"><td>Mehl im Vorteig</td><td></td><td class="num pct">${fmtPct(t.pfFlourPct)}</td></tr>` : ''}
      ${t.oil > 0 ? `<tr class="sub"><td>Flüssigkeit inkl. Öl</td><td></td><td class="num pct">${fmtPct(t.hydrationOil)}</td></tr>` : ''}
      ${showEff(c) ? `<tr class="sub"><td>Wirksame Flüssigkeit<small>Wasser + Wasseranteil von Milch, Ei, Butter …</small></td><td></td><td class="num pct">${fmtPct(t.hydEff)}</td></tr>` : ''}
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
  if (!r.steps?.length) return `<div class="empty small"><p>Noch kein Ablauf hinterlegt.</p><a class="btn primary" href="#/edit/${r.id}" data-action="editAt" data-step="${flowStep(r)}">Ablauf anlegen</a></div>`;
  const loc = C.locationMinutes(r.steps);
  return `
  <section class="card">
    <div class="flow-sum"><div><small>Gesamt</small><b>${fmtDur(info.total)}</b></div><div><small>Backen nach</small><b>${fmtDur(info.bakeOff)}</b></div></div>
    <div class="flowbar">${info.tl.filter((s) => !s.parallel).map((s) => `<i class="loc-${s.location}" style="flex:${Math.max(num(s.durationMin), 1)}" title="${esc(s.name)}"></i>`).join('')}</div>
    ${flowLane(info)}
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
  const stageName = s.stage === 'main' ? 'Hauptteig' : s.stage === 'lam' ? 'Ziehfett'
    : [...(r?.preferments || []), ...(r?.parts || [])].find((p) => p.id === s.stage)?.name;
  const details = [
    s.temp && `🌡️ ${esc(s.temp)}`,
    stageName && `Zutaten: ${esc(stageName)}`,
    s.parallel && (s.align === 'end' ? '⇉ läuft nebenher – zusammen fertig mit dem vorherigen Schritt' : '⇉ läuft nebenher – startet zusammen mit dem vorherigen Schritt'),
    s.repeat?.count && `🔁 ${s.repeat.count}× alle ${s.repeat.intervalMin} min`,
    s.meas && measLabel(s.meas) && `Gemessen: ${measLabel(s.meas)}`,
    s._comp && `<span class="comp">Temperatur-Ausgleich: ${fmtDur(s._comp.from)} → ${fmtDur(s.durationMin)} bei ${fmtNum(s._comp.actual)} °C</span>`,
    s._adj && `🪄 Nachtruhe: ${s._adj > 0 ? '+' : '−'}${fmtDur(Math.abs(s._adj))}`,
    s._dur !== undefined && `🧪 Gärzeit geändert (Rezept: ${fmtDur(s._dur)})`,
  ].filter(Boolean);
  const more = details.length || s.notes;
  // Nebenher-Schritte: eingerückt unter dem Hauptschritt, mit Uhrzeit von–bis (sofern bekannt)
  const par = s.parallel ? `<span class="par-tag">nebenher${s.end !== undefined && s.start > 1e11 ? ` bis ${fmtTime(s.end)}` : ''}</span> · ` : '';
  const head = `<div class="tl-h"><b>${esc(s.name || k.label)}</b><span class="tl-when">${when}</span></div>
    <div class="tl-m">${par}<span class="loc-chip loc-${s.location}">${l.icon} ${l.short}</span> ${fmtDur(s.durationMin)}${s._comp ? ' 🌡️' : ''}${s._adj ? ' 🪄' : ''}${s.repeat?.count ? ` · 🔁 ${s.repeat.count}×` : ''}${more ? ' · <span class="tl-more">mehr</span>' : ''}</div>`;
  const body = more
    ? `<details><summary>${head}</summary>${details.length ? `<div class="tl-m">${details.join('<br>')}</div>` : ''}${s.notes ? `<div class="tl-n">${esc(s.notes)}</div>` : ''}</details>`
    : head;
  return `<li class="tl-i loc-${s.location} ${s.parallel ? 'par' : ''} ${extra}"><div class="tl-dot">${k.icon}</div><div class="tl-c">${body}</div>${tail}</li>`;
}
// Zweite Spur unter der Zeitleiste: zeigt, wann Nebenher-Schritte laufen
function flowLane(info) {
  const par = info.tl.filter((s) => s.parallel);
  const total = (info.endAt - info.startAt) || 1;
  if (!par.length) return '';
  return `<div class="flowbar2" aria-hidden="true">${par.map((s) => `<i class="loc-${s.location}" style="left:${((s.start - info.startAt) / total) * 100}%;width:${Math.max(1.5, ((s.end - s.start) / total) * 100)}%" title="${esc(s.name)}"></i>`).join('')}</div>`;
}

function recipeLog(r, logs) {
  const withHyd = logs.filter((l) => l.rating > 0 && num(l.params?.hydration) > 0);
  const best = logs.filter((l) => l.rating > 0).sort((a, b) => b.rating - a.rating)[0];
  return `
  <div class="row gap"><a class="btn grow" href="#/log/${r.id}/new">${icon('plus')} Neuer Eintrag</a>${logs.length >= 2 ? `<a class="btn" href="#/cmp/${r.id}">⇄ Vergleichen</a>` : ''}</div>
  ${best && logs.length > 1 ? `<details class="card"><summary>🏆 Bestes Ergebnis <small class="muted">${fmtDate(best.date)}${num(best.params?.hydration) > 0 ? ` · ${fmtPct(best.params.hydration)}` : ''}</small></summary>
    <div class="pchips">${paramChips(best.params)}</div>
    ${withHyd.length >= 2 ? hydChart(withHyd) : ''}</details>` : ''}
  ${logs.length ? logs.map((l) => logCard(l, r)).join('') : `<div class="empty small"><div class="empty-ic">📓</div><p>Noch keine Einträge. Halte nach dem Backen fest, was du verändert hast und wie es geworden ist.</p></div>`}`;
}

function paramChips(pr, plain = false) {
  if (!pr) return '';
  const items = [
    pr.pan && `⭕ ${esc(pr.pan)}`,
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

// Schlanke Karte im Tagebuch-Reiter – antippen öffnet die Ansicht mit allen Details
function logCard(l, r) {
  const ph = (l.photos || [])[0], hyd = num(l.params?.hydration);
  const note = (l.notes || '').split(/(?<=[.!?])\s|\n/)[0];
  return `<a class="card log-card" href="#/log/${r.id}/${l.id}">
    ${ph ? `<span class="ph log-thumb"><img data-photo="${ph}" alt=""></span>` : ''}
    <span class="grow"><span class="row between"><b>${fmtDate(l.date)}</b>${l.rating ? stars(l.rating) : '<small class="muted">–</small>'}</span>
      <small class="muted">${[hyd && `💧 ${fmtPct(hyd)}`, l.params?.pan && `⭕ ${esc(l.params.pan)}`, l.protocol && protoSum(l.protocol)].filter(Boolean).join(' · ')}</small>
      ${note ? `<span class="log-note">${esc(note)}</span>` : ''}</span></a>`;
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
// Kuchen: eigener, kürzerer Ablauf (Zutatenliste statt Bäckerprozente)
const WIZ_CAKE = ['Grunddaten', 'Form & Menge', 'Zutaten', 'Ablauf', 'Fotos & Notizen'];
const wizFor = (d) => (isCake(d) ? { t: WIZ_CAKE, b: [wBasis, wPan, wCakeIng, wAblauf, wDetails] } : { t: WIZ, b: [wBasis, wMenge, wMehl, wVorteig, wZutaten, wAblauf, wDetails] });
const flowStep = (r) => (isCake(r) ? 3 : 5);

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
  const d = S.draft;
  if (S.editFor !== (d.id || 'new')) { S.editFor = d.id || 'new'; S.editFrom = S.prevHash; }
  const { t: titles, b: bodies } = wizFor(d);
  const w = S.wiz = Math.min(S.wiz, titles.length - 1);
  const html = `
  <header class="top sub">
    <button class="icon-btn" data-action="editCancel" aria-label="Abbrechen">${icon('x')}</button>
    <div class="grow"><div class="eyebrow">${d._new ? 'Neues Rezept' : esc(d.name || 'Rezept')} · Schritt ${w + 1}/${titles.length}</div><h1 class="title sm">${titles[w]}</h1></div>
    <button class="btn sm primary" data-action="editSave">Speichern</button>
  </header>
  <nav class="wiz-dots">${titles.map((t, i) => `<button data-action="wizGo" data-i="${i}" class="${i === w ? 'on' : i < w ? 'done' : ''}" aria-label="${t}"><span>${i + 1}</span><small>${t}</small></button>`).join('')}</nav>
  <div class="pad wiz-body">${bodies[w](d)}</div>
  <div class="wiz-foot">
    <div class="live" data-live="summary" data-html>${liveSummary(calcFor(d), d)}</div>
    <div class="row gap">
      <button class="btn ghost" data-action="wizPrev" ${w === 0 ? 'disabled' : ''}>Zurück</button>
      ${w < titles.length - 1 ? `<button class="btn primary grow" data-action="wizNext">Weiter: ${titles[w + 1]}</button>` : `<button class="btn primary grow" data-action="editSave">${icon('check')} Rezept speichern</button>`}
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
    <p class="muted">Oder wähle eine Vorlage – Mengen und Ablauf sind schon ausgefüllt und lassen sich Schritt für Schritt anpassen.</p>
    ${catsShown().filter((k) => k !== 'other').map((k) => {
      const list = TEMPLATES.filter((t) => tplCat(t) === k);
      const blank = { pizza: 'Leeres Pizzarezept', bread: 'Leeres Brotrezept', fine: 'Leeres Feingebäck', cake: 'Leerer Kuchen' }[k];
      return `<h3 class="sec">${CAT[k].icon} ${k === 'cake' ? 'Kuchen & Torten' : k === 'fine' ? 'Feingebäck · Croissant, Plunder, Hefeteig' : CAT[k].label}</h3>
      <div class="tpl-grid">
        ${list.map((t) => `<button class="tpl" data-action="pickTpl" data-t="${t.id}"><span class="tpl-ic">${t.icon}</span><b>${t.name}</b><small>${t.desc}</small></button>`).join('')}
        <button class="tpl blank" data-action="pickBlank" data-c="${k}"><span class="tpl-ic">➕${CAT[k].icon}</span><b>${blank}</b><small>${k === 'cake' ? 'Zutaten in g, Stk, EL …' : 'Alles selbst eingeben'}</small></button>
      </div>`;
    }).join('')}
  </div>` };
}
const tplCat = (t) => t.cat || (t.id === 'sourdough' ? 'bread' : 'pizza');

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
  // Zutaten-Liste = Gesamtmenge im Rezept (inkl. Milch im Vorteig)
  if (a === 'ex') { const e = d.extras[+b]; return { get: (c) => c.main.extras[+b]?.total ?? c.main.extras[+b]?.g ?? 0, pct: () => num(e?.pct), set: (v) => { e.pct = v; } }; }
  if (a === 'lam') return { get: (c) => c.lam?.g || 0, pct: () => num(d.lamination?.pct), set: (v) => { d.lamination = { ...(d.lamination || {}), pct: Math.max(0, v) }; } };
  if (a === 'pf' && c2 === 'x') {
    // Zutat im Vorteig (% vom Gesamtmehl)
    const k = +key.split('.')[3], e = d.preferments[+b]?.extras?.[k];
    return { get: (c) => c.pfs[+b]?.extras?.find((x) => C.sameName(x.name, e?.name))?.g || 0, pct: () => num(e?.pct), set: (v) => { if (e) e.pct = Math.max(0, v); } };
  }
  if (a === 'pf') {
    const pf = d.preferments[+b];
    // Gramm-Felder zeigen die FRISCH zugegebenen Mengen (wie im Rezepttext) – ohne Mehl/Wasser im Anstellgut
    const [g, p] = { flour: ['freshFlour', 'flourPct'], water: ['freshWater', 'hydration'], yeast: ['yeast', 'yeastPct'], starter: ['starter', 'starterPct'], salt: ['salt', 'saltPct'] }[c2];
    return { get: (c) => c.pfs[+b]?.[g] || 0, pct: () => num(pf?.[p]), set: (v) => { pf[p] = v; } };
  }
  return null;
}
// Prozentwert so lange anpassen, bis die gewünschte Grammzahl herauskommt (konvergiert in wenigen Schritten)
function solveGram(key, target) {
  if (/^pf\.\d+\.salt$/.test(key)) {
    // Salz im Vorteig: % vom Vorteig-Mehl
    const i = +key.split('.')[1], x = calc(S.draft).pfs[i];
    if (x) S.draft.preferments[i].saltPct = x.flour > 0 ? Math.round((Math.max(0, target) / x.flour) * 10000) / 100 : 0;
    return;
  }
  if (/^pf\.\d+\.x\.\d+$/.test(key)) {
    // Zutat im Vorteig: % vom Gesamtmehl (ändert die Mehlmenge nicht)
    const F = calc(S.draft).F;
    gramDef(key)?.set(F > 0 ? Math.round((Math.max(0, target) / F) * 1e6) / 1e4 : 0);
    return;
  }
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
  // Mehrstufig: Mehl/Wasser der vorigen Stufe stehen fest
  const chained = x.chained;
  const sFlour = chained ? x.flour - x.freshFlour : v.starter / (1 + sh), sWater = chained ? x.water - x.freshWater : v.starter - sFlour;
  if (chained) v.starter = 0;
  // Nur Anstellgut ohne frisches Mehl: das reife Anstellgut selbst ist der Vorteig
  const onlyStarter = !chained && v.starter > 0 && v.flour <= 0;
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
    : `<input class="in" inputmode="decimal" data-input="pctamt" data-gram="${key}" value="${fmtIn(gramDef(key)?.pct() ?? 0, num(gramDef(key)?.pct()) < 1 ? 3 : 2)}">`;
  return fldU(label, input, gramMode() ? 'g' : '%', `<span data-live="amt-${key}"></span>${!gramMode() && pctHint ? ` · ${pctHint}` : ''}`);
}
const unitSeg = () => `<div class="unit-seg"><span class="muted small">Mengen eingeben in</span>
  <div class="seg small">${[['pct', '%'], ['g', 'Gramm']].map(([k, l]) => `<button class="${(gramMode() ? 'g' : 'pct') === k ? 'on' : ''}" data-action="setUnit" data-v="${k}">${l}</button>`).join('')}</div></div>`;

function wBasis(d) {
  return `
  ${fld('Name', txtIn('name', d.name, 'z. B. Pizza Napoletana mit Biga'))}
  <div class="fld"><span class="fld-l">Kategorie</span>
    <div class="seg wrap">${catsShown(d.category).map((k) => `<button class="${d.category === k ? 'on' : ''}" data-action="setCat" data-v="${k}">${CAT[k].icon} ${CAT[k].label}</button>`).join('')}</div>
    ${isCake(d) ? '<small class="fld-h">Kuchen: Zutaten in g, ml, Stk, EL … – umrechnen auf jede Backform.</small>' : d.category === 'fine' ? '<small class="fld-h">Feingebäck: Hefeteig mit Milch, Ei, Butter – optional mit Ziehfett zum Tourieren.</small>' : ''}
  </div>
  ${fld('Kurzbeschreibung', `<textarea class="in" rows="2" data-bind="d.description" placeholder="Was macht dieses Rezept aus?">${esc(d.description)}</textarea>`)}
  ${fld('Quelle <small class="muted">(optional)</small>', txtIn('source', d.source || '', 'Link oder Buch, z. B. https://…'))}
  ${fld('Schlagworte', txtIn('_tags', d._tags ?? (d.tags || []).join(', '), 'z. B. Napoletana, Ooni, Party'), 'Mit Komma trennen – hilft bei der Suche.')}`;
}

function wMenge(d) {
  const cat = catOf(d.category), y = d.yield;
  const presets = d.category === 'bread' ? [500, 750, 900, 1000, 1500] : d.category === 'fine' ? [50, 70, 85, 100, 500] : [200, 230, 250, 260, 280];
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
  ${fldU('Zuschlag für Verlust', numIn('yield.loss', y.loss), '%', d.category === 'fine' ? 'Teigreste und Verschnitt beim Zuschneiden – bei Croissants meist 5–10 %.' : 'Teig, der in Schüssel und Kneter hängen bleibt – meist 0–3 %.')}
  <div class="result-grid">
    <div><small>Teig gesamt</small><b data-live="dough"></b></div>
    <div><small>Mehl gesamt</small><b data-live="flour"></b></div>
  </div>`;
}

// 🚦 Mehl-Ampel: passt das Mehl zu Hydration, Gärzeit, Roggenanteil und Anreicherung? (eingeklappt)
// quiet = nur bei Gelb/Rot zeigen (Rezeptseite, Planer); sonst auch Grün mit den Richtwerten (Editor)
const AMP = { green: ['🟢', 'Mehl passt'], yellow: ['🟡', 'Mehl: bitte prüfen'], red: ['🔴', 'Mehl passt nicht gut'] };
function flourAmp(res, { quiet = false, label = '' } = {}) {
  if (!feat('flourAmp') || !res?.level || (quiet && res.level === 'green')) return '';
  const [ic, t] = AMP[res.level], b = res.blend;
  const facts = [b.w && `W ≈ ${fmtNum(b.w, 0)} → Gare bis ca. ${X.maxHoursForW(b.w)} h`, b.cap && `Wasser bis ca. ${fmtNum(b.cap, 0)} %`].filter(Boolean).join(' · ');
  return `<details class="amp amp-${res.level}"><summary>${ic} <b>${label || t}</b> <small>${res.items.length ? `${res.items.length} Hinweis${res.items.length > 1 ? 'e' : ''}` : esc(facts)}</small></summary>
    ${res.items.map((x) => `<p>${x.level === 'red' ? '🔴' : '🟡'} ${esc(x.text)}${x.tip ? `<br><small>💡 ${esc(x.tip)}</small>` : ''}</p>`).join('')}
    ${facts ? `<p class="muted small">${esc(facts)}. Richtwerte – maßgeblich ist die Packung (W-Wert im Mehlnamen, z. B. „Tipo 00 W 300“, wird erkannt).</p>` : ''}</details>`;
}
// Mehl-Bibliothek: nur Hintergrundinfos (eingeklappt) + ein Hinweis, wenn Mehl und Führung nicht zusammenpassen
function flourLib(d) {
  const known = [...new Map((d.flours || []).map((f) => [X.flourInfo(f.name), f.name]).filter(([i]) => i)).entries()];
  const hints = feat('flourAmp') ? [] : X.flourHints(d);
  if (!known.length && !hints.length) return '';
  return `${hints.map((h) => `<div class="hint-card warnc small"><div>🌾 ${esc(h)}</div></div>`).join('')}
    ${known.length ? `<details class="info"><summary>ⓘ Mehl-Infos <small class="muted">${known.map(([i]) => esc(i.name)).join(', ')}</small></summary>
      ${known.map(([i]) => `<p><b>${esc(i.name)}</b> · ca. ${esc(i.protein)} % Eiweiß${i.w !== '–' ? ` · W ${esc(i.w)}` : ''}<br><small>${esc(i.note)}</small></p>`).join('')}
      <p class="muted small">Richtwerte – je nach Hersteller verschieden. Maßgeblich ist die Angabe auf der Packung.</p></details>` : ''}`;
}

function wMehl(d) {
  const fine = d.category === 'fine';
  const myList = feat('myFlours') ? S.flours.filter((m) => m.name) : [];
  const hydHints = fine ? [[0, 'nur Milch/Ei'], [25, 'mit Milch'], [30, 'Croissant'], [55, 'nur Wasser']] : [[60, 'fest'], [65, 'klassisch'], [68, 'Napoli'], [70, 'luftig'], [75, 'Sauerteig'], [80, 'Teglia']];
  // Passend zu den Mehlen (eigene Angaben bzw. Richtwerte): etwas unter der verträglichen Grenze
  const ideal = !fine && (d.flours || []).some((f) => myF(f.name)) ? X.idealHydration(d) : null;
  if (ideal) hydHints.unshift([ideal, '🌾 dein Mehl']);
  return `
  <div class="fld"><span class="fld-l">Mehlmischung <small class="muted">(Anteile am Gesamtmehl)</small></span>
    ${(d.flours || []).map((f, i) => `<div class="row gap line">
      <input class="in grow${mineAttr(f.name)}" data-input="flourName" data-i="${i}" value="${esc(f.name)}" placeholder="Mehlsorte" list="flour-lib">
      <span class="unit-in w90"><input class="in" inputmode="decimal" data-bind="d.flours.${i}.pct" data-num value="${fmtIn(f.pct)}"><span class="u">%</span></span>
      ${d.flours.length > 1 ? `<button class="icon-btn" data-action="delFlour" data-i="${i}" aria-label="Entfernen">${icon('x')}</button>` : ''}
    </div>`).join('')}
    <details class="addmore">
      <summary><span class="btn sm ghost">${icon('plus')} Mehl dazumischen</span><small class="muted">Summe: <b data-live="blendSum"></b></small></summary>
      ${myList.length ? `<div class="chips">${myList.filter((m) => !(d.flours || []).some((f) => C.sameName(f.name, m.name))).map((m) => `<button class="chip mine" style="--fc:${fColor(m)}" data-action="addFlour" data-v="${esc(m.name)}">${fDot(m)} ${esc(m.name)}</button>`).join('')}</div>` : ''}
      <div class="chips">${FLOUR_PRESETS.filter((n) => !(d.flours || []).some((f) => f.name === n)).map((n) => `<button class="chip" data-action="addFlour" data-v="${n}">${n}</button>`).join('')}<button class="chip" data-action="addFlour" data-v="">Eigenes …</button></div>
      <p class="muted small">Startet mit 20 % – wird vom ersten Mehl abgezogen, die Summe bleibt 100 %.${feat('myFlours') && !myList.length ? ' Tipp: Unter Backen → 🌾 Meine Mehle legst du deine eigenen Mehle mit Packungsangaben an.' : ''}</p>
    </details>
    <datalist id="flour-lib">${[...myList.map((m) => m.name), ...X.FLOUR_NAMES].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div data-live="flourAmp" data-html></div>
    <div id="flour-lib-box">${flourLib(d)}</div>
  </div>
  <div class="link-card">
    <div class="link-h"><b>💧 Wasser</b><small>Gib Hydration <u>oder</u> Wassermenge ein – das andere wird berechnet.${fine ? ' Milch, Ei und Butter trägst du unter „Salz, Hefe &amp; Co.“ ein.' : ''}</small></div>
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
    const starch = ['tangzhong', 'yudane', 'quell'].includes(pf.type);
    const showYeast = (!sour && !starch) || num(pf.yeastPct) > 0;
    const showStarter = sour || pf.type === 'custom';
    const ln = String(pf.liquidName || '').trim() || 'Milch';
    const liq = pf.liquid === 'milk' ? ln : pf.liquid === 'mix' ? `Wasser + ${ln}` : 'Wasser';
    const seeds = pf.type === 'quell' && pf.seeds, bread = seeds && C.isOldBread(pf);
    const chained = !!pf.starterFrom;
    const mixed = (pf.flours || []).length > 1;
    const fOpts = (sel) => [...new Set([...flourNames, sel].filter(Boolean))].map((n) => `<option value="${esc(n)}" ${sel === n ? 'selected' : ''}>${myF(n) ? '🌾 ' : ''}${esc(n)}</option>`).join('');
    // Mehlsorte(n) im Vorteig – eine Sorte als Auswahl, auf Wunsch als Mischung
    const flourUi = seeds || (flourNames.length < 2 && !mixed) ? ''
      : mixed ? `<div class="pf-mix"><span class="fld-l">Mehlmischung im Vorteig</span>
          ${pf.flours.map((f, k) => `<div class="row gap"><select class="in grow" data-bind="d.preferments.${i}.flours.${k}.name" aria-label="Mehlsorte">${fOpts(f.name)}</select><span class="unit-in w90"><input class="in" inputmode="decimal" data-bind="d.preferments.${i}.flours.${k}.pct" data-num value="${fmtIn(f.pct)}" aria-label="Anteil"><span class="u">%</span></span><button class="icon-btn" data-action="pfMixDel" data-i="${i}" data-k="${k}" aria-label="Mehlsorte entfernen">${icon('x')}</button></div>`).join('')}
          <div class="row gap"><button class="btn sm ghost" data-action="pfMixAdd" data-i="${i}">${icon('plus')} Mehlsorte</button><small class="muted" data-live="pfmix-${i}"></small></div></div>`
      : `<div class="pf-mix"><span class="fld-l">Mehlsorte</span><div class="row gap"><select class="in grow" data-bind="d.preferments.${i}.flourName" aria-label="Mehlsorte">${fOpts(pf.flourName)}</select><button class="btn sm ghost" data-action="pfMixAdd" data-i="${i}">${icon('plus')} mischen</button></div></div>`;
    // Zutaten, die schon in diesen Vorteig kommen (aus der Zutaten-Liste des Rezepts)
    const exNames = (d.extras || []).map((e) => e.name).filter((n) => n && !(pf.extras || []).some((x) => C.sameName(x.name, n)));
    return `<section class="card pf-card">
      <div class="row gap"><span class="pf-ic">${t.icon}</span><input class="in grow strong" data-bind="d.preferments.${i}.name" value="${esc(pf.name)}"><button class="icon-btn" data-action="delPf" data-i="${i}" aria-label="Vorteig entfernen">${icon('trash')}</button></div>
      <details class="fold pf-types" ${pf.type ? '' : 'open'}><summary>Art: <b>${esc(t.label)}</b> <small class="muted">ändern</small></summary>
        <div class="seg small">${Object.entries(PF_TYPES).map(([k, v]) => `<button class="${pf.type === k ? 'on' : ''}" data-action="pfType" data-i="${i}" data-v="${k}">${v.icon} ${v.label}</button>`).join('')}</div>
      </details>
      <details class="info"><summary>ⓘ Typische Werte</summary><p>${t.info}</p></details>
      ${i > 0 && ['levain', 'madre', 'custom'].includes(pf.type) ? fld('Anstellgut', `<select class="in" data-change="pfFrom" data-i="${i}">${[`<option value="">Eigenes Anstellgut (Menge unten)</option>`, ...pfs.slice(0, i).filter((p) => !pfs.some((q, j) => j !== i && q.starterFrom === p.id)).map((p) => `<option value="${p.id}" ${pf.starterFrom === p.id ? 'selected' : ''}>Ganze Stufe „${esc(p.name)}“</option>`)].join('')}</select>`, 'Mehrstufiger Sauerteig: die vorige Stufe komplett als Anstellgut') : ''}
      ${pf.type === 'quell' ? `<div class="seg small">${[['flour', '🌾 Schrot/Mehl'], ['seeds', '🌻 Saaten'], ['bread', '🍞 Altbrot']].map(([k, l]) => `<button class="${(bread ? 'bread' : seeds ? 'seeds' : 'flour') === k ? 'on' : ''}" data-action="pfQuell" data-i="${i}" data-v="${k}">${l}</button>`).join('')}</div>
        ${seeds ? '<p class="muted small">Zählt nicht zum Mehl – kommt mit dem Quellwasser zusätzlich in den Teig.</p>' : ''}` : ''}
      ${!seeds && (C.PF_LIQUID.has(pf.type) || pf.liquid !== 'water' && pf.liquid) ? (() => {
        const ui = `<div class="seg small">${[['water', '💧 Wasser'], ['milk', `🥛 ${pf.liquid === 'milk' && ln !== 'Milch' ? esc(ln) : 'Milch & Co.'}`], ['mix', '💧+🥛 Gemischt']].map(([k, l]) => `<button class="${(pf.liquid || 'water') === k ? 'on' : ''}" data-action="pfLiquid" data-i="${i}" data-v="${k}">${l}</button>`).join('')}</div>
        ${pf.liquid === 'milk' || pf.liquid === 'mix' ? `<div class="grid2">${fld('Flüssigkeit', `<input class="in" list="pf-liquids" data-change="pfLiqName" data-i="${i}" value="${esc(ln)}" aria-label="Flüssigkeit im Vorteig">`, 'aus den Zutaten des Rezepts')}
          ${pf.liquid === 'mix' ? fldU(`Davon ${esc(ln)}`, numIn(`preferments.${i}.milkShare`, pf.milkShare ?? 50), '%', 'Rest ist Wasser') : ''}</div>` : ''}`;
        // Biga, Sauerteig, Pâte fermentée sind fast immer mit Wasser – Auswahl nur auf Wunsch aufklappen
        return ['biga', 'levain', 'pate'].includes(pf.type) && (pf.liquid || 'water') === 'water'
          ? `<details class="fold pf-liq"><summary>Flüssigkeit: <b>Wasser</b> <small class="muted">ändern (z. B. Bier)</small></summary>${ui}</details>` : ui;
      })() : ''}
      <div class="grid2">
        ${amt(`pf.${i}.flour`, seeds ? (gramMode() ? (bread ? 'Altbrot' : 'Saaten') : bread ? 'Altbrot-Anteil' : 'Saaten-Anteil') : gramMode() ? (showStarter ? 'Mehl (frisch)' : 'Mehl') : 'Mehlanteil', seeds ? 'vom Mehl' : 'vom Gesamtmehl')}
        ${amt(`pf.${i}.water`, gramMode() ? (showStarter ? `${liq} (frisch)` : liq) : pf.liquid === 'milk' ? `${esc(ln)}-Anteil` : pf.liquid === 'mix' ? 'Flüssigkeit' : seeds ? 'Wasser' : 'Hydration', seeds ? (bread ? 'meist 200–300 %' : 'meist 100 %') : '')}
        ${showYeast ? amt(`pf.${i}.yeast`, `${yeastName(d.yeastType)}`, 'vom Vorteigmehl') : ''}
        ${C.PF_SALT.has(pf.type) || num(pf.saltPct) > 0 ? amt(`pf.${i}.salt`, 'Salz', 'vom Vorteigmehl') : ''}
        ${showStarter && !chained ? amt(`pf.${i}.starter`, pf.type === 'madre' ? 'Madre (Anstellgut)' : 'Anstellgut', 'vom frischen Mehl') : ''}
        ${showStarter && !chained ? fldU(pf.type === 'madre' ? 'Hydration Madre' : 'Hydration Anstellgut', numIn(`preferments.${i}.starterHydration`, pf.starterHydration ?? 100), '%') : ''}
        ${(pf.extras || []).map((e, k) => amt(`pf.${i}.x.${k}`, `${esc(e.name)} <button class="link-x" data-action="pfExDel" data-i="${i}" data-k="${k}" aria-label="${esc(e.name)} aus dem Vorteig entfernen">✕</button>`, 'vom Gesamtmehl')).join('')}
        ${seeds ? fld(bread ? 'Brot' : 'Saaten', txtIn(`preferments.${i}.flourName`, pf.flourName, bread ? 'z. B. Altbrot (geröstet)' : 'z. B. Leinsamen, Sonnenblumenkerne')) : ''}
      </div>
      ${flourUi}
      ${exNames.length ? `<details class="addmore"><summary><span class="btn sm ghost">${icon('plus')} Zutat in diesen Vorteig</span></summary>
        <div class="chips">${exNames.map((n) => `<button class="chip" data-action="pfExAdd" data-i="${i}" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <p class="muted small">Zum Beispiel Zucker, Butter oder Eigelb im ersten Panettone-Teig. Die Menge wird vom Hauptteig abgezogen – unter „Salz, Hefe &amp; Co.“ steht weiterhin die Gesamtmenge.</p></details>` : ''}
      <div class="pf-out" data-live="pf-${i}"></div>
    </section>`;
  }).join('')}
  <datalist id="pf-liquids">${C.PF_LIQUIDS.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
  <details class="addmore" ${pfs.length ? '' : 'open'}>
    <summary><span class="btn sm">${icon('plus')} Vorteig hinzufügen</span></summary>
    <div class="chips">${Object.entries(PF_TYPES).map(([k, v]) => `<button class="chip" data-action="addPf" data-v="${k}">${v.icon} ${v.label}</button>`).join('')}</div>
  </details>
  <div data-live="warnings" data-html></div>`;
}

function wZutaten(d) {
  const fine = d.category === 'fine';
  const presets = (fine ? ['Milch', 'Vollei', 'Eigelb', 'Butter', 'Zucker', 'Vanillezucker', 'Zitronenabrieb', 'Rosinen', 'Sahne', 'Quark']
    : ['Zucker', 'Diastatisches Malz', 'Honig', 'Milchpulver', 'Saaten', 'Kochstück', 'Milch', 'Butter']).filter((n) => !(d.extras || []).some((e) => e.name === n));
  const lam = d.lamination || {};
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
    <small class="muted" data-live="hydEff"></small>
  </div>
  ${fine || num(lam.pct) > 0 ? `<details class="card" ${num(lam.pct) > 0 ? 'open' : ''}>
    <summary>🧈 Ziehfett zum Tourieren <small class="muted">${num(lam.pct) > 0 ? fmtPct(lam.pct) : 'optional · Croissant, Plunder'}</small></summary>
    <p class="muted small" style="margin-top:0">Butter bzw. Ziehfett, das in den Grundteig eingeschlagen wird. Üblich: 40–60 % vom Mehl (Croissant ≈ 50 %). Es zählt zum Teiggewicht der Stücke.</p>
    <div class="grid2">
      ${amt('lam', 'Ziehfett', 'vom Mehl')}
      ${fld('Fett', `<input class="in" data-bind="d.lamination.name" value="${esc(lam.name || '')}" placeholder="Butter (Tourierbutter)">`)}
    </div>
    <small class="muted" data-live="lamHint"></small>
  </details>` : ''}
  ${fldU('Zielteigtemperatur', numIn('ddt', d.ddt ?? 24), '°C', 'für den Wassertemperatur-Rechner')}`;
}

// ---------- Editor: Kuchen & Torten ----------
function wPan(d) {
  const p = d.pan || {};
  const inp = (k, label, unit) => fldU(label, `<input class="in" inputmode="decimal" data-bind="d.pan.${k}" data-num value="${num(p[k]) > 0 ? fmtIn(p[k], 1) : ''}">`, unit);
  return `
  <div class="fld"><span class="fld-l">Für welche Form ist das Rezept?</span>
    <div class="seg">${[['round', '⭕ Rund'], ['rect', '▭ Eckig'], ['count', '🧁 Stück'], ['', 'keine Angabe']].map(([k, l]) => `<button class="${(p.shape || '') === k ? 'on' : ''}" data-action="setPanShape" data-v="${k}">${l}</button>`).join('')}</div>
  </div>
  ${p.shape === 'round' ? `${inp('d', 'Durchmesser', 'cm')}<div class="chips">${[18, 20, 22, 24, 26, 28].map((x) => `<button class="chip" data-action="setPan" data-shape="round" data-d="${x}">Ø ${x}</button>`).join('')}</div>`
    : p.shape === 'rect' ? `<div class="grid2">${inp('l', 'Länge', 'cm')}${inp('w', 'Breite', 'cm')}</div><div class="chips">${PAN_PRESETS.rect.map((x) => `<button class="chip" data-action="setPan" data-shape="rect" data-l="${x.l}" data-w="${x.w}">${x.label}</button>`).join('')}</div>`
    : p.shape === 'count' ? `${inp('n', 'Anzahl', 'Stück')}<p class="muted small">z. B. Muffins, Cupcakes, Kekse – umgerechnet wird nach Stückzahl.</p>`
    : '<p class="muted small">Ohne Form lässt sich das Rezept nur per Faktor (z. B. 1,5×) umrechnen.</p>'}
  <div class="hint-card small"><div>ⓘ Beim Backen kannst du auf jede andere Form umrechnen – z. B. von Ø 26 auf Ø 20 cm. Gerechnet wird nach Fläche, die Höhe bleibt gleich.</div></div>`;
}

const CAKE_PRESETS = [['Mehl', 'g'], ['Zucker', 'g'], ['Butter', 'g'], ['Eier', 'Stk'], ['Milch', 'ml'], ['Backpulver', 'Pck'], ['Vanillezucker', 'Pck'], ['Salz', 'Prise'], ['Speisestärke', 'g'], ['Sahne', 'ml'], ['Quark', 'g'], ['Kakaopulver', 'g']];
function wCakeIng(d) {
  const parts = d.parts || [];
  return `
  <p class="muted small" style="margin-top:0">Mengen wie im Originalrezept – für die Form aus Schritt 2. Umgerechnet wird später automatisch.</p>
  ${parts.map((p, pi) => `<section class="card cake-part">
    <div class="row gap"><span class="pf-ic">🥣</span><input class="in grow strong" data-bind="d.parts.${pi}.name" value="${esc(p.name)}" placeholder="z. B. Teig, Füllung, Creme" aria-label="Name des Bestandteils">
      ${parts.length > 1 ? `<button class="icon-btn" data-action="delPart" data-i="${pi}" aria-label="Bestandteil entfernen">${icon('trash')}</button>` : ''}</div>
    ${(p.items || []).map((it, ii) => `<div class="row gap line cake-item">
      <input class="in grow" data-bind="d.parts.${pi}.items.${ii}.name" value="${esc(it.name)}" placeholder="Zutat" aria-label="Zutat">
      <input class="in w70" inputmode="decimal" data-bind="d.parts.${pi}.items.${ii}.amount" data-num value="${num(it.amount) > 0 ? fmtIn(it.amount) : ''}" placeholder="n. B." aria-label="Menge">
      <select class="in w80" data-bind="d.parts.${pi}.items.${ii}.unit" aria-label="Einheit">${C.UNITS.map((u) => `<option ${it.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <button class="icon-btn" data-action="delItem" data-p="${pi}" data-i="${ii}" aria-label="Zutat entfernen">${icon('x')}</button>
    </div>`).join('')}
    <details class="addmore" ${(p.items || []).length ? '' : 'open'}>
      <summary><span class="btn sm ghost">${icon('plus')} Zutat</span><small class="muted" data-live="part-${pi}"></small></summary>
      <div class="chips">${CAKE_PRESETS.filter(([n]) => !(p.items || []).some((x) => x.name === n)).map(([n, u]) => `<button class="chip" data-action="addItem" data-p="${pi}" data-v="${n}" data-u="${u}">${n}</button>`).join('')}<button class="chip" data-action="addItem" data-p="${pi}" data-v="" data-u="g">Eigene …</button></div>
    </details>
  </section>`).join('')}
  <details class="addmore">
    <summary><span class="btn sm">${icon('plus')} Bestandteil hinzufügen</span></summary>
    <div class="chips">${['Boden', 'Füllung', 'Creme', 'Streusel', 'Glasur', 'Belag'].map((n) => `<button class="chip" data-action="addPart" data-v="${n}">${n}</button>`).join('')}<button class="chip" data-action="addPart" data-v="">Eigener …</button></div>
    <p class="muted small">Bestandteile werden getrennt angezeigt – und beim Backen genau im passenden Schritt.</p>
  </details>`;
}

// Parallele Schritte: Danach · Zusammen starten · Zusammen fertig
const whenOf = (s) => (!s.parallel ? 'seq' : s.align === 'end' ? 'end' : 'start');
function whenText(d, i) {
  const s = d.steps[i], p = d.steps[i - 1];
  if (!s || !p) return '';
  const pn = `„${esc(p.name || kindOf(p.kind).label)}“`;
  if (!s.parallel) return `Startet, wenn ${pn} fertig ist.`;
  if (s.align !== 'end') return `Startet gleichzeitig mit ${pn} und läuft nebenher.`;
  const diff = num(p.durationMin) - num(s.durationMin);
  return diff > 0 ? `Startet ${fmtDur(diff)} nach Beginn von ${pn} – beide sind gleichzeitig fertig.`
    : diff < 0 ? `Startet schon ${fmtDur(-diff)} vor ${pn} – beide sind gleichzeitig fertig.`
      : `Läuft genau gleichzeitig mit ${pn}.`;
}
// Gärschritte, nach denen „Vorheizen“ sinnvoll nebenher läuft
const FERMENT_KINDS = ['bulk', 'proof', 'rest', 'temper', 'fold'];
// Einmaliger Tipp: Vorheizen läuft nacheinander nach einer Gare → nebenher laufen lassen?
function preheatTip(d) {
  if ((S.settings.preheatTipOff || []).includes(d.id)) return '';
  const i = (d.steps || []).findIndex((s, k) => k > 0 && s.kind === 'preheat' && !s.parallel && FERMENT_KINDS.includes(d.steps[k - 1].kind));
  if (i < 0) return '';
  const s = d.steps[i], p = d.steps[i - 1];
  return `<div class="hint-card"><div>♨️ <b>„${esc(s.name)}“ nebenher laufen lassen?</b><br><small>Der Ofen ist dann genau zum Ende von „${esc(p.name)}“ heiß – spart ${fmtDur(Math.min(num(s.durationMin), num(p.durationMin)))}.</small></div>
    <div class="row gap"><button class="btn sm primary" data-action="preheatTip" data-i="${i}">Ja</button><button class="icon-btn x-btn" data-action="preheatTipOff" aria-label="Nicht mehr fragen">${icon('x')}</button></div></div>`;
}

function wAblauf(d) {
  const steps = d.steps || [];
  const pfs = d.preferments || [];
  const cake = isCake(d), lam = num(d.lamination?.pct) > 0;
  const addKinds = cake ? [['mix', 'Rühren / Mischen'], ['rest', 'Kühlen / Ruhen'], ['shape', 'Form auslegen'], ['preheat', 'Vorheizen'], ['bake', 'Backen'], ['cool', 'Auskühlen'], ['assemble', 'Füllen'], ['other', 'Sonstiges']]
    : [['prep', 'Vorteig'], ['autolyse', 'Autolyse'], ['mix', 'Mischen'], ['bulk', 'Stockgare'], ['fold', 'Dehnen & Falten'], ...(lam || d.category === 'fine' ? [['laminate', 'Tourieren']] : []), ['shape', 'Formen'], ['proof', 'Stückgare'], ['temper', 'Akklimatisieren'], ['preheat', 'Vorheizen'], ['bake', 'Backen'], ['other', 'Sonstiges']];
  // Welche Zutaten ein Schritt beim Backen zeigen kann
  const stageOpts = cake ? (d.parts || []).map((p) => [p.id, p.name || 'Zutaten'])
    : [...pfs.map((p) => [p.id, p.name]), ['main', lam ? 'Grundteig' : 'Hauptteig'], ...(lam ? [['lam', 'Ziehfett']] : [])];
  return `
  <div class="result-grid">
    <div><small>Gesamtdauer</small><b data-live="total"></b></div>
    <div><small>Backen nach</small><b data-live="bakeOff"></b></div>
  </div>
  ${steps.length ? preheatTip(d) : `<div class="empty small"><p>Noch keine Schritte – lass dir einen passenden Ablauf vorschlagen.</p><button class="btn primary" data-action="suggestSteps">✨ Ablauf vorschlagen</button></div>`}
  <ol class="steps-edit">${steps.map((s, i) => {
    const k = kindOf(s.kind), open = S.openStep === s.id;
    const hh = Math.floor(num(s.durationMin) / 60), mm = Math.round(num(s.durationMin) % 60);
    return `<li class="se ${open ? 'open' : ''} loc-${s.location}">
      <button class="se-h" data-action="toggleStep" data-id="${s.id}">
        <span class="se-n">${i + 1}</span><span class="se-ic">${k.icon}</span>
        <span class="se-t"><b>${esc(s.name || k.label)}</b><small>${locOf(s.location).icon} ${locOf(s.location).short} · <span data-live="dur-${i}">${num(s.durationMin) > 0 ? fmtDur(s.durationMin) : '⚠️ Dauer fehlt'}</span>${s.parallel ? ' · ⇉ nebenher' : ''}${s.repeat?.count ? ` · ${s.repeat.count}×` : ''}</small></span>
        ${icon(open ? 'up' : 'down')}
      </button>
      ${open ? `<div class="se-b">
        ${fld('Bezeichnung', `<input class="in" data-bind="d.steps.${i}.name" value="${esc(s.name)}">`)}
        <div class="grid2">
          ${fld('Art', `<select class="in" data-bind="d.steps.${i}.kind" data-rerender>${Object.entries(STEP_KINDS).filter(([kk]) => kk === s.kind || (cake ? !['prep', 'autolyse', 'bulk', 'fold', 'laminate', 'proof', 'temper'].includes(kk) : kk !== 'assemble')).map(([kk, v]) => `<option value="${kk}" ${s.kind === kk ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select>`)}
          ${fld('Dauer', `<div class="row gap dur"><span class="unit-in"><input class="in" inputmode="numeric" data-input="dur" data-i="${i}" data-part="h" value="${hh}"><span class="u">h</span></span><span class="unit-in"><input class="in" inputmode="numeric" data-input="dur" data-i="${i}" data-part="m" value="${mm}"><span class="u">min</span></span></div>`)}
        </div>
        <div class="fld"><span class="fld-l">Wo?</span><div class="seg small">${Object.entries(LOCATIONS).map(([kk, v]) => `<button class="${s.location === kk ? 'on' : ''}" data-action="stepLoc" data-i="${i}" data-v="${kk}">${v.icon} ${v.short}</button>`).join('')}</div></div>
        ${i > 0 ? `<div class="fld"><span class="fld-l">Wann?</span><div class="seg small">${[['seq', 'Danach'], ['start', 'Zusammen starten'], ['end', 'Zusammen fertig']].map(([kk, l]) => `<button class="${whenOf(s) === kk ? 'on' : ''}" data-action="stepWhen" data-i="${i}" data-v="${kk}">${l}</button>`).join('')}</div>
          <small class="fld-h" data-live="when-${i}">${whenText(d, i)}</small></div>` : ''}
        ${fld('Hinweise', `<textarea class="in" rows="2" data-bind="d.steps.${i}.notes" placeholder="Was ist zu tun?">${esc(s.notes)}</textarea>`)}
        <details class="fold" ${s.repeat || s.parallel ? 'open' : ''}>
          <summary>Weitere Optionen <small class="muted">${[s.temp && esc(s.temp), s.stage && 'Zutaten', s.repeat && `${s.repeat.count}× Erinnerung`].filter(Boolean).join(' · ')}</small></summary>
          <div class="grid2">
            ${fld('Temperatur', `<input class="in" data-bind="d.steps.${i}.temp" value="${esc(s.temp)}" placeholder="z. B. 24–26 °C">`, feat('tempComp') && ['bulk', 'rest', 'proof', 'fold'].includes(s.kind) && s.location !== 'fridge' ? 'Basis für den Temperatur-Ausgleich' : '')}
            ${fld('Zutaten zeigen', `<select class="in" data-bind="d.steps.${i}.stage"><option value="">–</option>${stageOpts.map(([v, l]) => `<option value="${esc(v)}" ${s.stage === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, 'beim Backen in diesem Schritt')}
          </div>
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
  if (c.kind === 'cake') {
    const n = c.parts.reduce((s, p) => s + p.items.length, 0);
    return `<span>${cat.icon} ${esc(C.panLabel(d.pan) || 'ohne Form')}</span><span><b>${n}</b> Zutaten</span><span>≈ <b>${fmtG(c.total)}</b></span>`;
  }
  const qty = d.yield.mode === 'flour' ? `<b>${fmtG(c.D)}</b> Teig` : `${fmtNum(d.yield.count, 0)} × ${fmtNum(d.yield.pieceWeight, 0)} g`;
  return `<span>${cat.icon} ${qty}</span><span>Mehl <b>${fmtG(c.F)}</b></span>${c.lam?.g > 0 ? `<span>🧈 <b>${fmtG(c.lam.g)}</b></span>` : `<span>Wasser <b>${fmtG(c.totals.water)}</b></span>`}<span>💧 <b>${fmtPct(showEff(c) ? c.totals.hydEff : c.totals.hydration)}</b>${showEff(c) ? ' <small>wirksam</small>' : ''}</span>${c.warnings.length ? `<span class="w">⚠️ ${c.warnings.length}</span>` : ''}`;
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
  if (isCake(d)) {
    const c = C.calcCake(d), info = planInfo(d.steps, 0);
    const L = { summary: liveSummary(c, d), total: d.steps?.length ? fmtDur(info.total) : '–', bakeOff: d.steps?.length ? fmtDur(info.bakeOff) : '–' };
    c.parts.forEach((p, i) => { L[`part-${i}`] = p.items.length ? `${p.items.length} Zutaten${p.g > 0 ? ` · ≈ ${fmtG(p.g)}` : ''}` : ''; });
    (d.steps || []).forEach((s, i) => { L[`dur-${i}`] = fmtDur(s.durationMin); if (i > 0) L[`when-${i}`] = whenText(d, i); });
    $$('[data-live]').forEach((el) => { const k = el.dataset.live; if (k in L) { if (el.hasAttribute('data-html') || k.startsWith('when-')) el.innerHTML = L[k]; else el.textContent = L[k]; } });
    return;
  }
  const c = calc(d);
  const info = planInfo(d.steps, 0);
  const blendSum = (d.flours || []).reduce((s, f) => s + num(f.pct), 0);
  const L = {
    summary: liveSummary(c, d), dough: fmtG(c.D), flour: fmtG(c.F), count: fmtNum(c.count, 1),
    blendSum: `${fmtNum(blendSum)} %${Math.abs(blendSum - 100) > 0.5 ? ' ⚠️' : ' ✓'}`,
    hydHint: d.category === 'fine' ? `Wirksame Flüssigkeit inkl. Milch, Ei & Butter: ${fmtPct(c.totals.hydEff)} – bei Feingebäck meist 50–60 %.` : hydHint(c.totals.hydration), hydOil: fmtPct(c.totals.hydrationOil),
    hydEff: showEff(c) ? `💧 Wirksame Flüssigkeit inkl. Milch, Ei & Butter: ${fmtPct(c.totals.hydEff)}` : '',
    lamHint: c.lam.g > 0 ? `Grundteig ${fmtG(c.lam.base)} + Ziehfett ${fmtG(c.lam.g)} (${fmtPct(c.lam.base > 0 ? (c.lam.g / c.lam.base) * 100 : 0)} vom Grundteig) · Platte ca. ${fmtNum(Math.sqrt(c.lam.g / 0.91), 0)} × ${fmtNum(Math.sqrt(c.lam.g / 0.91), 0)} cm` : '',
    iceHint: c.main.ice > 0 ? `Hauptteig: ${fmtG(Math.max(0, c.main.water) - c.main.ice)} Wasser + ${fmtG(c.main.ice)} Eis` : `Wasser im Hauptteig: ${fmtG(Math.max(0, c.main.water))}`,
    salt: fmtG(c.totals.salt),
    yeast: `${fmtG(c.main.yeast)} im Hauptteig · gesamt ${fmtG(c.totals.yeast)}`,
    total: d.steps?.length ? fmtDur(info.total) : '–', bakeOff: d.steps?.length ? fmtDur(info.bakeOff) : '–',
    warnings: c.warnings.length ? `<div class="warn">${c.warnings.map((w) => `⚠️ ${esc(w)}`).join('<br>')}</div>` : '',
    flourAmp: isCake(d) ? '' : flourAmp(X.flourCheck(d)),
  };
  c.pfs.forEach((x, i) => {
    const ln = esc(x.liqName || 'Milch');
    const liq = !x.milk ? `${fmtG(x.freshWater)} Wasser` : x.milkG < x.freshWater - 0.05 ? `${fmtG(x.freshWater - x.milkG)} Wasser + ${fmtG(x.milkG)} ${ln}` : `${fmtG(x.freshWater)} ${ln}`;
    const fl = x.seeds ? `${fmtG(x.freshFlour)} ${esc(x.flourName || 'Saaten')}` : (x.flourParts || []).length > 1 ? x.flourParts.map((q) => `${fmtG(q.g)} ${esc(q.name)}`).join(' + ') : `${fmtG(x.freshFlour)} Mehl`;
    const mx = d.preferments[i]?.flours || [];
    if (mx.length > 1) { const sm = mx.reduce((a, f) => a + num(f.pct), 0); L[`pfmix-${i}`] = `Summe ${fmtNum(sm)} %${Math.abs(sm - 100) > 0.5 ? ' ⚠️ wird anteilig gerechnet' : ' ✓'}`; }
    L[`pf-${i}`] = `${x.starter > 0 ? `${fmtG(x.starter)} ${x.chained ? 'vorige Stufe' : x.pf.type === 'madre' ? 'Madre' : 'Anstellgut'} + ` : ''}${fl} + ${liq}${x.yeast > 0 ? ` + ${fmtG(x.yeast)} Hefe` : ''}${x.salt > 0 ? ` + ${fmtG(x.salt)} Salz` : ''}${(x.extras || []).map((e) => ` + ${fmtG(e.g)} ${esc(e.name)}`).join('')} = <b>${fmtG(x.total)}</b>`;
  });
  c.main.extras.forEach((e, i) => { L[`ex-${i}`] = fmtG(e.g); });
  (d.steps || []).forEach((s, i) => { L[`dur-${i}`] = num(s.durationMin) > 0 ? fmtDur(s.durationMin) : '⚠️ Dauer fehlt'; if (i > 0) L[`when-${i}`] = whenText(d, i); });
  $$('[data-live]').forEach((el) => {
    const k = el.dataset.live;
    if (!(k in L)) return;
    if (el.hasAttribute('data-html') || k.startsWith('pf-') || k.startsWith('when-')) {
      // aufgeklappte Hinweise beim Live-Aktualisieren offen lassen
      const open = !!el.querySelector('details[open]');
      if (el.innerHTML !== L[k]) el.innerHTML = L[k];
      if (open) el.querySelector('details')?.setAttribute('open', '');
    } else el.textContent = L[k];
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
      <div class="pad empty"><div class="empty-ic">🗓️</div><p>Für die Planung braucht das Rezept einen Ablauf (Schritte mit Dauer).</p><button class="btn primary" data-action="editAt" data-id="${id}" data-step="${flowStep(r)}">Ablauf anlegen</button></div>` };
  }
  const now = Math.floor(Date.now() / 60000) * 60000;
  const start = P.mode === 'now' ? now : P.mode === 'bake' ? P.at - base.bakeOff * 60000 : P.at;
  const info = planInfo(steps, start);
  const night = info.tl.filter((s) => C.isNight(s.start, S.settings.nightFrom, S.settings.nightTo));
  const hasAdj = Object.keys(P.adj || {}).length > 0;
  const cake = isCake(r);
  const c = calcFor(planRecipe(r), planOv(r));
  const cat = catOf(r.category);
  // Hinweis: Beim letzten Backen wurde mit „🎨 Anpassen“ etwas geändert → für diesen Backtag übernehmen?
  const lastLog = logsFor(id)[0], lp = lastLog?.protocol;
  let lastHint = '';
  // 🫙 Anstellgut aus „Meine Kulturen“ vorher auffrischen (nur bei Sauerteig/Madre im Rezept)
  const usesStarter = !cake && (r.preferments || []).some((p) => num(p.starterPct) > 0 || ['levain', 'madre'].includes(p.type));
  // Passende Kulturen: Madre-Rezept → Madre/LiCoLi, Sauerteig → Sauerteige; gibt es keine passende, alle zeigen
  const madreR = (r.preferments || []).some((p) => p.type === 'madre');
  const fits = (c) => (madreR ? ['madre', 'licoli'] : ['rye', 'wheat', 'spelt', 'licoli', 'custom']).includes(c.type);
  const cultList = S.cultures.some(fits) ? S.cultures.filter(fits) : S.cultures;
  const cultRow = feat('cultures') && usesStarter && S.cultures.length ? `<div class="hint-card small cult-plan"><div>🫙 Anstellgut vorher auffrischen?</div>
    <select class="in" data-change="planCult" aria-label="Kultur auffrischen">${[`<option value="">Nein</option>`, ...cultList.map((c) => `<option value="${c.id}" ${P.cult === c.id ? 'selected' : ''}>${esc(c.name)} · ${fmtNum(c.lead)} h vorher</option>`)].join('')}</select></div>` : '';
  if (lp?.pct && lp.changes?.length) {
    const what = `${lp.changes.slice(0, 2).map((x) => `${esc(x.name)} ${esc(x.from)} → ${esc(x.to)}`).join(', ')}${lp.changes.length > 2 ? ` +${lp.changes.length - 2}` : ''}`;
    const hyd = lp.hydration !== null && lp.baseHydration !== null && Math.abs(lp.hydration - lp.baseHydration) > 0.05 ? ` (Hydration ${fmtPct(lp.hydration)})` : '';
    lastHint = P.usePct === lastLog.id
      ? `<div class="hint-card good"><div>🎨 Mengen vom ${fmtDate(lastLog.date)} übernommen${hyd}</div><button class="btn sm ghost" data-action="planUsePctOff">Zurück</button></div>`
      : `<div class="hint-card"><div>🎨 <b>Letztes Mal angepasst</b>${lastLog.rating ? ` ${stars(lastLog.rating)}` : ''}<br><small>${what}${hyd}</small></div><button class="btn sm primary" data-action="planUsePct" data-id="${lastLog.id}">Übernehmen</button></div>`;
  }
  const qtyCard = cake ? `<section class="card scaler">
      <div class="card-h"><b>Menge für diesen Backtag</b>${C.panLabel(r.pan) ? `<small class="muted">Rezept: ${esc(C.panLabel(r.pan))}</small>` : ''}</div>
      ${cakeScaler(r, P.ov, 'plan')}
      <div class="muted small" style="margin-top:8px">${cakeInfo(r, c)}</div>
      <small class="muted">Zeiten bleiben gleich · das Rezept selbst bleibt unverändert.</small>
    </section>` : '';
  const html = `
  <header class="top sub"><a class="icon-btn" href="#/r/${id}" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Backen planen</div><h1 class="title sm">${esc(r.name)}</h1></div></header>
  <div class="pad">
    <div class="seg">
      <button class="${P.mode === 'now' ? 'on' : ''}" data-action="planMode" data-v="now">Jetzt starten</button>
      <button class="${P.mode === 'bake' ? 'on' : ''}" data-action="planMode" data-v="bake">Backen um …</button>
      <button class="${P.mode === 'start' ? 'on' : ''}" data-action="planMode" data-v="start">Start um …</button>
    </div>
    <div class="big-result">
      <div class="br-k">Backen</div>
      <div class="br-v">${fmtRel(info.bakeAt)}</div>
      <div class="br-s">${P.mode === 'bake' ? `Start: <b>${fmtRel(start)}</b>` : `Start: ${fmtRel(start)}`} · Dauer ${fmtDur(info.total)}${info.endAt !== info.bakeAt ? ` · fertig ${fmtRel(info.endAt)}` : ''}</div>
      ${start < now - 60000 ? '<div class="br-w">⚠️ Der Start läge in der Vergangenheit – wähle einen späteren Backzeitpunkt.</div>' : ''}
    </div>
    ${P.mode !== 'now' ? planCalendar(steps, base) : ''}
    ${night.length ? `<div class="hint-card warnc"><div>🌙 <b>${night.length} Schritt${night.length > 1 ? 'e' : ''} in der Nacht</b><br><small>${night.slice(0, 3).map((s) => `${new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(s.start)} ${fmtTime(s.start)}`).join(' · ')}${night.length > 3 ? ' …' : ''}</small></div>
      ${feat('nightOpt') ? '<button class="btn sm primary" data-action="nightOpt">🪄 Anpassen</button>' : ''}</div>` : ''}
    ${hasAdj ? `<div class="hint-card good"><div>🪄 ${steps.filter((s) => s._adj).map((s) => `${esc(s.name)} ${s._adj > 0 ? '+' : '−'}${fmtDur(Math.abs(s._adj))}`).join(' · ')}</div><button class="btn sm ghost" data-action="nightReset">Zurück</button></div>` : ''}
    ${lastHint}
    ${cultRow}
    ${cake ? qtyCard : `<section class="card scaler">
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
    </details>`}
    ${planFlourCard(r)}
    ${yeastFitCard(r)}
    ${cake ? '' : flourAmp(X.flourCheck(planRecipe(r), { hydration: P.ov.hydration, steps: planDurSteps(r).map((s) => (P.adj?.[s.id] ? { ...s, durationMin: num(s.durationMin) + P.adj[s.id] } : s)) }), { quiet: true })}
    <h3 class="sec">Zeitplan</h3>
    <ol class="tl">${info.tl.map((s) => stepRow(s, fmtRel(s.start), r, C.isNight(s.start, S.settings.nightFrom, S.settings.nightTo) ? 'night' : '')).join('')}
      <li class="tl-i end"><div class="tl-dot">🎉</div><div class="tl-c"><div class="tl-h"><b>Fertig</b><span class="tl-when">${fmtRel(info.endAt)}</span></div></div></li>
    </ol>
  </div>
  <div class="sticky-actions">
    <button class="btn ghost" data-action="planIcs" aria-label="Plan in den Handy-Kalender eintragen">${icon('cal')} In Kalender</button>
    <button class="btn primary grow" data-action="startSession">${icon('play')} ${P.mode === 'now' ? 'Jetzt starten' : 'Plan aktivieren'}</button>
  </div>`;
  return { html };
}

// 📅 Tag im Monatskalender, Uhrzeit per Chip. Das 🌙 hängt nur an der Uhrzeit (nicht am Tag):
// es zeigt, bei welcher Uhrzeit ein Schritt in die Nachtruhe fiele.
const BAKE_TIMES = ['12:00', '17:00', '18:00', '19:00', '20:00'], START_TIMES = ['07:00', '08:00', '12:00', '18:00', '20:00'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const atOn = (key, time) => { const [y, m, d] = key.split('-').map(Number), [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };
function planCalendar(steps, base) {
  const P = S.plan, bake = P.mode === 'bake', now = Date.now(), off = base.bakeOff * 60000;
  const sel = new Date(P.at), selKey = dayKey(sel), time = hm(P.at), today = dayKey(new Date());
  const startOf = (at) => (bake ? at - off : at);
  const nights = (at) => planInfo(steps, startOf(at)).tl.filter((s) => C.isNight(s.start, S.settings.nightFrom, S.settings.nightTo)).length;
  // Monatsansicht (Wochen beginnen am Montag); ein Tag ist wählbar, wenn ein Start an diesem Tag noch in der Zukunft liegen kann
  const [vy, vm] = (P.calMonth || selKey.slice(0, 7)).split('-').map(Number);
  const first = new Date(vy, vm - 1, 1), lead = (first.getDay() + 6) % 7, days = new Date(vy, vm, 0).getDate();
  const cells = [...Array(lead).fill(''), ...Array.from({ length: days }, (_, i) => dayKey(new Date(vy, vm - 1, i + 1)))];
  const ok = (key) => startOf(atOn(key, '23:59')) >= now - 60000;
  const thisMonth = vy === new Date().getFullYear() && vm === new Date().getMonth() + 1;
  const times = [...new Set([...(bake ? BAKE_TIMES : START_TIMES), time])].sort();
  return `<section class="card cal">
    <div class="cal-h"><button class="icon-btn" data-action="planMonth" data-d="-1" ${thisMonth ? 'disabled' : ''} aria-label="Voriger Monat">‹</button><b>${MONTHS[vm - 1]} ${vy}</b><button class="icon-btn" data-action="planMonth" data-d="1" aria-label="Nächster Monat">›</button></div>
    <div class="cal-g">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span class="cal-wd">${d}</span>`).join('')}
      ${cells.map((k) => (k ? `<button class="cal-d ${k === selKey ? 'on' : ''} ${k === today ? 'today' : ''}" data-action="planDay" data-d="${k}" ${ok(k) ? '' : 'disabled'}>${Number(k.slice(8))}</button>` : '<span></span>')).join('')}</div>
    <div class="cal-q muted small">${bake ? 'Backen um' : 'Start um'}</div>
    <div class="chips cal-t">${times.map((t) => { const at = atOn(selKey, t), past = startOf(at) < now - 60000, n = past ? 0 : nights(at);
      return `<button class="chip ${t === time ? 'on' : ''}" data-action="planTime" data-t="${t}" ${past ? 'disabled' : ''} ${n ? `title="${n} Schritt${n > 1 ? 'e' : ''} in der Nacht"` : ''}>${t}${n ? ' 🌙' : ''}</button>`; }).join('')}</div>
    <div class="row gap cal-fine"><button class="btn sm ghost" data-action="planShift" data-d="-15">−15 min</button>
      <input class="in" type="time" step="300" data-change="planClock" value="${time}" aria-label="Uhrzeit genau">
      <button class="btn sm ghost" data-action="planShift" data-d="15">+15 min</button></div>
    ${times.some((t) => !(startOf(atOn(selKey, t)) < now - 60000) && nights(atOn(selKey, t))) ? '<p class="muted small" style="margin:6px 0 0">🌙 = bei dieser Uhrzeit fällt ein Schritt in deine Nachtruhe.</p>' : ''}
  </section>`;
}
function initPlan(r) {
  const base = planInfo(r.steps, 0);
  let target = new Date(); target.setHours(19, 0, 0, 0);
  while (target.getTime() - base.bakeOff * 60000 < Date.now()) target = new Date(target.getTime() + 86400000);
  // Eine im Rezept eingestellte Menge (z. B. 4 × 280 g) wird für den Backtag übernommen
  const y = S.scale?.id === r.id ? S.scale.yield : r.yield;
  if (isCake(r)) {
    const st = S.scale?.id === r.id ? S.scale : cakeScaleInit(r);
    return { id: r.id, mode: 'now', at: target.getTime(), ov: { cmode: st.cmode, pan: { ...st.pan }, factor: st.factor } };
  }
  return { id: r.id, mode: 'now', at: target.getTime(),
    ov: { ymode: y.mode === 'flour' ? 'flour' : 'pieces', count: y.count, pieceWeight: y.pieceWeight, flour: y.flour, hydration: r.water.pct } };
}

// Schritte inkl. Anpassungen aus dem Nachtruhe-Optimierer (ohne Temperatur-Ausgleich)
// … und – falls im Planer gewählt – „Anstellgut auffrischen“ aus „Meine Kulturen“ davor
// Gärzeiten, die im Planer unter „🧪 Gärzeit & Hefe“ geändert wurden (nur dieser Backtag)
function planDurSteps(r) {
  const dur = S.plan?.id === r.id ? S.plan.dur || {} : {};
  return (r.steps || []).map((s) => (dur[s.id] !== undefined ? { ...s, durationMin: dur[s.id], _dur: num(s.durationMin) } : s));
}
function planStepsBase(r, adj = S.plan?.adj || {}) {
  const steps = planDurSteps(r).map((s) => (adj[s.id] ? { ...s, durationMin: num(s.durationMin) + adj[s.id], _adj: adj[s.id] } : s));
  const c = S.plan?.cult && S.plan.id === r.id && cultById(S.plan.cult);
  if (!c) return steps;
  const [sa, fl, wa] = c.ratio || [1, 1, 1];
  return [
    C.step('prep', `${c.name} auffrischen`, 5, 'rt', { id: `cult-${c.id}`, cultureId: c.id, notes: c.type === 'yeastwater' ? 'Hefewasser nachfüttern.' : `Füttern ${fmtNum(sa, 2)} : ${fmtNum(fl, 2)} : ${fmtNum(wa, 2)} (Anstellgut : Mehl : Wasser) – Menge siehe Füttern-Rechner.` }),
    C.step('rest', `${c.name} reifen lassen`, Math.max(30, Math.round(num(c.lead) * 60)), c.type === 'madre' ? 'warm' : 'rt', { id: `cultr-${c.id}`, notes: 'Bereit, wenn sie sich etwa verdoppelt hat.' }),
    ...steps,
  ];
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

// Rezept für diesen Backtag – auf Wunsch mit den Mengen vom letzten Mal („🎨 Anpassen“), das Rezept selbst bleibt gleich
function planBaseRecipe(r) {
  const l = S.plan?.usePct && S.logs.find((x) => x.id === S.plan.usePct);
  let x = l?.protocol?.pct ? C.applyPct(structuredClone(r), l.protocol.pct) : r;
  // 🌾 Mehl für diesen Backtag: Rezept-Mehl durch eines meiner Mehle ersetzen (nur Namen – die Mengen bleiben)
  const map = S.plan?.id === r.id ? S.plan.flourMap || {} : {};
  if (!isCake(x) && Object.keys(map).length) {
    x = structuredClone(x);
    const ren = (n) => map[n] || n;
    (x.flours || []).forEach((f) => { f.name = ren(f.name); });
    (x.preferments || []).forEach((p) => { if (!p.seeds) p.flourName = ren(p.flourName); (p.flours || []).forEach((f) => { f.name = ren(f.name); }); });
  }
  return x;
}
// Karte im Planer: Mehl für diesen Backtag wählen, Vorrat prüfen, Kosten (eingeklappt, nur mit eigenen Mehlen)
function planFlourCard(r) {
  if (isCake(r) || !feat('myFlours') || !S.flours.some((m) => m.name)) return '';
  const P = S.plan, map = P.flourMap || {};
  const c = calcFor(planRecipe(r), planOv(r));
  const needs = stockOn() ? X.flourNeeds(c) : [];
  const short = needs.filter((x) => val(x.f.stock) && num(x.f.stock) < x.g);
  const cost = X.hasPrice(needs) ? X.flourCost(needs) : null;
  const rows = (r.flours || []).map((f) => {
    const cur = map[f.name] || '', now = myF(cur || f.name);
    return `<div class="adj-row"><span>${myF(f.name) ? fDot(myF(f.name)) : ''}${esc(f.name)} <small class="muted">${fmtNum(f.pct, 0)} %</small></span>
      <select class="in w150${now && cur ? ' mine" style="--fc:' + fColor(now) : ''}" data-change="planFlour" data-k="${esc(f.name)}" aria-label="Mehl für ${esc(f.name)}"><option value="">wie im Rezept</option>${S.flours.filter((m) => m.name && !C.sameName(m.name, f.name)).map((m) => `<option value="${esc(m.name)}" ${cur === m.name ? 'selected' : ''}>🌾 ${esc(m.name)}</option>`).join('')}</select></div>`;
  }).join('');
  const sum = [Object.keys(map).length && `${Object.keys(map).length} getauscht`, short.length ? '⚠️ Vorrat knapp' : needs.some((x) => val(x.f.stock)) && 'Vorrat reicht', cost !== null && `≈ ${fmtNum(cost, 2)} €`].filter(Boolean).join(' · ');
  return `<details class="card fold" ${P.flOpen || short.length ? 'open' : ''} data-action-toggle="fl">
    <summary>🌾 Mehl für diesen Backtag <small class="muted">${sum || 'eigene Mehle wählen'}</small></summary>
    ${rows}
    ${needs.length ? `<p class="small">${needs.map((x) => `${fDot(x.f)} ${esc(x.f.name)}: <b>${fmtG(x.g)}</b>${val(x.f.stock) ? ` <span class="${num(x.f.stock) < x.g ? 'warnt' : 'muted'}">von ${kg(x.f.stock)}</span>` : ''}`).join('<br>')}</p>` : ''}
    ${short.length ? `<div class="hint-card warnc small"><div>🫙 Vorrat reicht nicht: ${short.map((x) => `${esc(x.f.name)} fehlen ${fmtG(x.g - num(x.f.stock))}`).join(', ')}</div></div>` : ''}
    ${cost !== null ? `<p class="muted small">Mehlkosten für diesen Backtag ≈ <b>${fmtNum(cost, 2)} €</b>${c.count > 0 && c.mode !== 'flour' ? ` · ≈ ${fmtNum(cost / c.count, 2)} € pro Stück` : ''}</p>` : ''}
    ${needs.some((x) => val(x.f.stock)) ? '<p class="muted small">Beim Start wird der Vorrat automatisch abgezogen (bei Abbruch vor dem Kneten wieder gutgeschrieben).</p>' : ''}
  </details>`;
}
function planRecipe(r) {
  const x = planBaseRecipe(r);
  return isCake(x) ? x : C.applyYeastFit(x, planYeastFit(r));
}
// Karte im Planer: Gärzeiten ändern, Hefe passt sich an (eingeklappt)
function yeastFitCard(r) {
  if (isCake(r) || !feat('yeastFit') || !usesYeastR(r)) return '';
  const P = S.plan, groups = C.fermGroups(r, r.steps || []);
  if (!groups.some(Boolean)) return '';
  const durSteps = planDurSteps(r), fit = planYeastFit(r, true), on = P.yeastFit === true;
  const rb = planBaseRecipe(r), ov = planOv(r), c0 = calc(rb, ov), c1 = fit ? calc(C.applyYeastFit(rb, fit), ov) : c0;
  const lines = [];
  if (c0.main.yeast > 0) lines.push(['Hauptteig', c0.main.yeast, c1.main.yeast]);
  c0.pfs.forEach((x, k) => { if (x.yeast > 0) lines.push([x.pf.name || 'Vorteig', x.yeast, c1.pfs[k].yeast]); });
  const sum = lines.filter(([, a, b]) => Math.abs(a - b) > 0.05).map(([n, a, b]) => `${esc(n)} ${fmtG(a)} → <b>${fmtG(b)}</b>`).join(' · ');
  const changed = Object.keys(P.dur || {}).length > 0;
  const rows = (r.steps || []).map((s, i) => (groups[i] ? `<div class="adj-row ${durSteps[i]._dur !== undefined ? 'chg' : ''}"><span>${kindOf(s.kind).icon} ${esc(s.name)} <small class="muted">${esc(locOf(s.location).short)}</small></span>
    <span class="unit-in w90"><input class="in" inputmode="decimal" data-change="planDur" data-sid="${s.id}" value="${fmtIn(num(durSteps[i].durationMin) / 60, 2)}" aria-label="Dauer ${esc(s.name)} in Stunden"><span class="u">h</span></span></div>` : '')).join('');
  return `<details class="card fold yfit" ${P.yfOpen ? 'open' : ''} data-action-toggle="yf">
    <summary>🧪 Gärzeit &amp; Hefe <small class="muted">${on && sum ? 'Hefe angepasst' : changed ? 'Zeiten geändert' : 'Gare länger oder kürzer?'}</small></summary>
    <p class="muted small" style="margin-top:0">Gärzeiten nur für diesen Backtag ändern – die Hefe passt sich an. Faustregel: doppelte Zeit ≈ halbe Hefe, Kühlschrank zählt etwa ⅐.</p>
    ${rows}
    ${sum ? `<label class="check"><input type="checkbox" data-action="planYeastFit" ${on ? 'checked' : ''}> Hefe anpassen</label><div class="adj-info">${on ? '' : 'Vorschlag: '}${sum}</div>` : ''}
    ${changed ? '<button class="btn sm ghost" data-action="planDurReset">↶ Rezeptzeiten</button>' : ''}
  </details>`;
}
// 🧪 Gärzeit & Hefe: Faktor je Stufe, wenn Gärzeiten geändert wurden und „Hefe anpassen“ an ist
const usesYeastR = (r) => !isCake(r) && (num(r.yeastPct) > 0 || (r.preferments || []).some((p) => num(p.yeastPct) > 0));
function planYeastFit(r, force = false) {
  const P = S.plan;
  if (!P || P.id !== r.id || !feat('yeastFit') || (!force && P.yeastFit !== true) || !usesYeastR(r)) return null;
  const adj = P.adj || {};
  const steps = planDurSteps(r).map((s) => (adj[s.id] ? { ...s, durationMin: num(s.durationMin) + adj[s.id] } : s));
  const fit = C.yeastFit(r, r.steps || [], steps, S.settings.refRoom);
  const same = Math.abs(fit.main - 1) < 0.01 && Object.values(fit.pfs).every((f) => Math.abs(f - 1) < 0.01);
  return same ? null : fit;
}
function planOv(r) {
  const o = S.plan.ov;
  if (isCake(r)) return cakeOv(o);
  const flourMode = (o.ymode || r.yield.mode) === 'flour';
  return { yield: flourMode ? { mode: 'flour', flour: num(o.flour) } : { mode: 'pieces', count: num(o.count), pieceWeight: num(o.pieceWeight) }, hydration: num(o.hydration) };
}

function planStart(r) {
  const base = planInfo(planSteps(r), 0);
  const P = S.plan;
  return P.mode === 'now' ? Date.now() : P.mode === 'bake' ? P.at - base.bakeOff * 60000 : P.at;
}

// ---------- Backvorgang ----------
// Nebenher-Schritte (parallel, ohne Zutaten – z. B. Ofen vorheizen) halten „Weiter“ nicht auf
const MIX_LIKE = new Set(['prep', 'autolyse', 'mix', 'laminate']);
const isSide = (x) => !!x?.parallel && !MIX_LIKE.has(x.kind) && !x.stage;
const nextMain = (tl, i) => tl.find((x) => x.i > i && !x.doneAt && !isSide(x));
const curStep = (tl) => tl.find((x) => !x.doneAt && !isSide(x)) || tl.find((x) => !x.doneAt);

function sessionEvents(s, now) {
  const tl = C.timeline(s.recipeId ? effSteps(s) : s.steps, s.startAt, now);
  const ev = [];
  const m = (x) => Math.round(x / 60000);
  tl.forEach((st, i) => {
    if (st.doneAt) return;
    if (i === 0 && !(s.createdAt && st.start <= s.createdAt + 60000)) ev.push({ key: `${s.id}:s0:${m(st.start)}`, at: st.start, title: `Los geht's: ${st.name}`, body: s.recipeName });
    if (isSide(st)) {
      const main = tl.slice(0, i).reverse().find((x) => !isSide(x));
      if (i > 0 && !(s.createdAt && st.start <= s.createdAt + 60000)) ev.push({ key: `${s.id}:p${i}:${m(st.start)}`, at: st.start, title: `⇉ Jetzt nebenher: ${st.name}`, body: `${main ? `„${main.name}“ läuft weiter · ` : ''}${s.recipeName}` });
      ev.push({ key: `${s.id}:pe${i}:${m(st.end)}`, at: st.end, title: `✓ ${st.name} – fertig`, body: s.recipeName });
      return;
    }
    if (st.repeat?.count > 0 && st.repeat.intervalMin > 0) {
      for (let k = 1; k <= st.repeat.count; k++) {
        const at = st.start + k * st.repeat.intervalMin * 60000;
        if (at < st.end) ev.push({ key: `${s.id}:r${i}:${k}:${m(at)}`, at, title: `${kindOf(st.kind).icon} ${st.name} – ${k}/${st.repeat.count}`, body: `Zeit für Dehnen & Falten · ${s.recipeName}` });
      }
    }
    const next = nextMain(tl, i);
    ev.push({ key: `${s.id}:e${i}:${m(st.end)}`, at: st.end,
      title: next ? `⏰ Jetzt: ${next.name}` : `🎉 ${s.recipeName} ist fertig!`,
      body: next ? `„${st.name}“ ist abgeschlossen · ${s.recipeName}` : 'Trag dein Ergebnis ins Tagebuch ein.' });
  });
  return ev;
}

function vBakeList() {
  const active = S.sessions.filter((s) => s.status === 'active').sort((a, b) => a.startAt - b.startAt);
  const allPast = S.sessions.filter((s) => s.status !== 'active').sort((a, b) => b.startAt - a.startAt);
  const nCancel = allPast.filter((s) => s.status !== 'done').length;
  // Abgebrochene standardmäßig ausblenden
  const past = allPast.filter((s) => S.showCancelled || s.status === 'done').slice(0, S.showCancelled ? 20 : 10);
  const pastCard = (s) => {
    const log = s.logId && S.logs.find((l) => l.id === s.logId);
    const sub = `<small class="muted">${fmtRel(s.startAt)} · ${s.status === 'done' ? 'abgeschlossen' : 'abgebrochen'}</small>`;
    if (log) return `<a class="card row between past" href="#/log/${log.recipeId}/${log.id}"><div><b>${esc(s.recipeName)}</b><br>${sub}</div><span class="pill">📓 ansehen</span></a>`;
    return `<div class="card row between past"><a class="grow" href="#/bake/${s.id}"><b>${esc(s.recipeName)}</b><br>${sub}</a>${s.status === 'done' && byId(s.recipeId) ? `<a class="btn sm" href="#/log/${s.recipeId}/new?session=${s.id}">📓 Eintragen</a>` : ''}</div>`;
  };
  const html = `
  <header class="top"><h1 class="title">Backen</h1></header>
  <div class="pad">
    ${notifCard()}
    ${culturesCard()}
    ${floursCard()}
    ${active.length ? active.map(sessionBanner).join('') : `<div class="empty"><div class="empty-ic">⏲️</div><h2>Gerade läuft nichts</h2><p>Öffne ein Rezept und tippe auf <b>Backen planen</b>. Du siehst sofort, wann du backen kannst – und wirst bei jedem Schritt erinnert.</p><a class="btn primary" href="#/">Zu den Rezepten</a></div>`}
    ${past.length || nCancel ? `<h3 class="sec">Zuletzt</h3>${past.map(pastCard).join('')}
      ${nCancel ? `<button class="more-link" data-action="toggleCancelled">${S.showCancelled ? 'Abgebrochene ausblenden' : `+ ${nCancel} abgebrochene anzeigen`}</button>` : ''}` : ''}
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
  const cur = curStep(tl);
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
      ${sideSteps(s, tl, cur, now)}
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
    const next = nextMain(tl, cur.i);
    goHtml = `${stg ? `<section class="card step-ing" data-tk="${s.id}:${cur.i}"><div class="card-h"><b>🧾 Zutaten: ${esc(stg.title)}</b><small class="muted">antippen zum Abhaken</small></div>${ingTable('', '', stg.rows)}${adjBox(s, stg)}</section>` : ''}
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
    <details class="card"><summary>Alle Zutaten <small class="muted">${s.calc.kind === 'cake' ? `${esc(C.panLabel(s.calc.pan) || `${fmtNum(s.calc.factor, 2)}× Rezept`)} · ≈ ${fmtG(s.calc.total)}`
      : `${s.calc.mode === 'flour' ? fmtG(s.calc.F) + ' Mehl' : `${fmtNum(s.calc.count, 0)} × ${fmtNum(s.calc.pieceWeight, 0)} g`} · ${fmtPct(s.calc.totals.hydration)}`}</small></summary>${ingredientBlocks(sessCalc(s), s.yeastType, true)}</details>
  </div>`;
  return { html };
}

async function finishStep(s, i, hands) {
  if (s.steps[i].doneAt) return render();
  s.steps[i].doneAt = Date.now();
  await saveSession(s);
  // „Anstellgut auffrischen“ erledigt → Fütterung bei der Kultur eintragen
  const cult = s.steps[i].cultureId && cultById(s.steps[i].cultureId);
  if (cult) {
    const at = Date.now();
    await addFeed(cult, { at, note: `Backtag: ${s.recipeName}` });
    s.steps[i].feedAt = at; await saveSession(s); // für „↶ Zurück“: diese Fütterung wieder austragen
    toast(`🫙 Fütterung bei „${cult.name}“ eingetragen`);
  }
  if (hands) {
    const next = curStep(planInfo(effSteps(s), s.startAt, Date.now()).tl);
    speak(next ? `Jetzt: ${next.name}. ${speakDur(next.durationMin)}.` : 'Fertig. Guten Appetit!');
  }
  render();
}
const hasDone = (s) => s.steps.some((x) => x.doneAt);
// Zutaten nur bei Schritten zeigen, in denen tatsächlich etwas vermengt wird
const MIX_KINDS = new Set(['prep', 'autolyse', 'mix']);
// Kuchen: Zutaten bei allen Schritten mit zugeordnetem Bestandteil (z. B. „Füllen“); Tourieren: Ziehfett beim ersten Tourieren
function stageOfStep(s, st) {
  if (!st) return null;
  if (s.calc?.kind === 'cake') return st.stage || null;
  if (st.kind === 'laminate') {
    const first = s.steps.findIndex((x) => x.kind === 'laminate');
    return st.stage || (first === st.i ? 'lam' : null);
  }
  if (!MIX_KINDS.has(st.kind)) return null;
  return st.stage || (st.kind === 'mix' ? 'main' : null);
}
const rowVal = (x) => (x.type === 'cake' ? num(x.v) : num(x.g));
function stepIngredients(s, st) {
  const stage = stageOfStep(s, st);
  const res = stage ? stageRows(sessCalc(s), stage, s.yeastType) : null;
  if (!res) return null;
  // Mit „🎨 Anpassen“ geänderte Mengen kennzeichnen
  if (s.adjust?.[stage]) {
    const base = stageRows(sessCalc(s, false), stage, s.yeastType)?.rows || [];
    res.rows.forEach((r) => {
      const b = base.find((x) => x.key === r.key);
      if (!b) { r.chg = true; r.hint = [r.hint, 'dazu'].filter(Boolean).join(' · '); }
      else if (Math.abs(rowVal(b) - rowVal(r)) > 0.05) { r.chg = true; r.hint = [r.hint, `statt ${b.txt ?? fmtG(b.g)}`].filter(Boolean).join(' · '); }
    });
  }
  return { ...res, stage };
}
// Mengen des Backvorgangs – mit heute notierter Wassertemperatur/Eis-Menge
// Heute notierte Wasser/Eis-Werte aus ALLEN Hauptteig-Mischschritten ('' = bewusst leer)
function waterOverrides(s) {
  const o = {};
  s.steps.forEach((x) => { if (isMainMix(x) && x.meas) ['water', 'ice'].forEach((k) => { if (x.meas[k] !== undefined) o[k] = x.meas[k]; }); });
  return o;
}
// withAdj = false: Mengen laut Plan (ohne „🎨 Anpassen“)
function sessCalc(s, withAdj = true) {
  if (s.calc?.kind === 'cake') return withAdj ? adjCake(s.calc, s.adjust) : s.calc;
  const o = waterOverrides(s);
  let c = s.calc;
  if (Object.keys(o).length) {
    c = structuredClone(s.calc);
    if ('water' in o) c.main.waterTemp = o.water;
    if ('ice' in o) c.main.ice = Math.min(Math.max(0, c.main.water), Math.max(0, num(o.ice)));
  }
  return withAdj ? adjCalc(c, s.adjust) : c;
}

// ---------- 🎨 Anpassen: Mengen während des Backens ändern ----------
// s.adjust = { [Stufe]: { [Zeilen-Schlüssel]: neue Grammzahl, _add: [{ name, g }] } } – nur dieser Backvorgang.
// Was schon in einer Stufe steckt, bleibt fest: geändert wird nur die Stufe, deren Zeile angepasst wurde.
// Hydration, Salz-/Hefe-Anteil und Teigmenge werden über ALLE Stufen neu berechnet.
function adjCalc(c, adj) {
  if (!c || !adj || !Object.keys(adj).length) return c;
  const x = structuredClone(c), t = x.totals, m = x.main;
  const val = (st, k, base) => { const v = adj[st]?.[k]; return v === undefined || v === null || v === '' ? base : Math.max(0, num(v)); };
  let dF = 0, dW = 0, dD = 0, dLiq = 0;
  const flourD = new Map();
  const addF = (name, d) => { if (d) flourD.set(name, (flourD.get(name) || 0) + d); };
  x.pfs.forEach((p) => {
    if (!adj[p.id]) return;
    const a = adj[p.id];
    const sh = num(p.pf.starterHydration ?? 100) / 100, sF = (v) => v / (1 + sh);
    // Mehl je Sorte (eine Sorte = „flour“, Mischung = fl0, fl1 …) + beim Backen dazugemischte Sorten (a0 …)
    const base = !p.seeds && (p.flourParts || []).length ? p.flourParts : [{ name: p.flourName, g: p.freshFlour }];
    const multi = base.length > 1, parts = [], fD = [];
    base.forEach((q, k) => { const n = val(p.id, multi ? `fl${k}` : 'flour', q.g); parts.push({ ...q, g: n }); fD.push([q.name, n - q.g]); });
    (a._add || []).forEach((ad, n) => { const g = val(p.id, `a${n}`, num(ad.g)); parts.push({ name: ad.name || 'Mehl', g, _key: `a${n}` }); fD.push([ad.name || 'Mehl', g]); });
    const nf = parts.reduce((s2, q) => s2 + q.g, 0);
    const nw = val(p.id, 'water', p.freshWater), ns = val(p.id, 'starter', p.starter), ny = val(p.id, 'yeast', p.yeast);
    const dS = sF(ns) - sF(p.starter);
    const df = nf - p.freshFlour + dS, dw = nw - p.freshWater + (ns - sF(ns)) - (p.starter - sF(p.starter)), dy = ny - p.yeast;
    const nsl = val(p.id, 'salt', num(p.salt)), dsl = nsl - num(p.salt);
    // Zutaten im Vorteig (z. B. Zucker, Butter) – die Gesamtmenge im Rezept ändert sich mit
    let dx = 0;
    (p.extras || []).forEach((e, k) => {
      const n = val(p.id, `x${k}`, e.g), d = n - e.g;
      if (!d) return;
      e.g = n; dx += d; t.extras += d; dLiq += d * C.liquidShare(e.name);
      const mi = m.extras.findIndex((me) => C.sameName(me.name, e.name));
      if (mi >= 0) m.extras[mi].total = (m.extras[mi].total ?? m.extras[mi].g) + d;
    });
    // Frisch zugegebene Flüssigkeit aufteilen: Milch-/Bier-…-Anteil → gleichnamige Zutat des Rezepts, Rest + Anstellgut-Wasser → Wasser
    const share = p.pf.liquid === 'milk' ? 1 : p.pf.liquid === 'mix' ? Math.min(1, Math.max(0, num(p.pf.milkShare) / 100)) : 0;
    const dFresh = nw - p.freshWater, milkD = dFresh * share, waterD = dw - milkD;
    Object.assign(p, { freshFlour: nf, freshWater: nw, starter: ns, yeast: ny, salt: nsl, flour: p.flour + df, water: p.water + dw,
      milkG: num(p.milkG) + milkD, waterG: num(p.waterG) + waterD });
    if (!p.seeds) { p.flourParts = parts; p.flourName = parts.filter((q) => q.g > 0.05).map((q) => q.name).join(' + ') || p.flourName; }
    p.total += df + dw + dy + dsl + dx;
    dD += df + dw + dy + dsl + dx; t.yeast += dy; t.salt += dsl;
    // Saaten zählen nicht zum Mehl/Wasser; Milch & Co. zählt zur Zutat (Gesamtmenge) und zur wirksamen Flüssigkeit
    if (!p.seeds) {
      dF += df; dW += waterD;
      fD.forEach(([name, d]) => addF(name, d));
      if (dS) addF(base[0].name, dS);
      if (milkD) {
        const ln = p.liqName || 'Milch', mi = C.liquidIndex(m.extras, ln);
        if (mi >= 0) m.extras[mi].total = (m.extras[mi].total ?? m.extras[mi].g) + milkD;
        t.extras += milkD; dLiq += milkD * C.liquidShare(ln);
      }
    }
  });
  if (adj.main) {
    m.flours.forEach((f, k) => { const n = val('main', `f${k}`, f.g), d = n - f.g; if (d) { f.g = n; dF += d; dD += d; addF(f.name, d); } });
    (adj.main._add || []).forEach((a, n) => {
      const g = val('main', `a${n}`, num(a.g));
      m.flours.push({ name: a.name || 'Mehl', g, _key: `a${n}` });
      dF += g; dD += g; addF(a.name || 'Mehl', g);
    });
    const liq0 = Math.max(0, m.water) - num(m.ice);
    const nl = val('main', 'water', liq0), ni = val('main', 'ice', num(m.ice)), dw = nl + ni - liq0 - num(m.ice);
    if (dw || ni !== num(m.ice)) { m.water = Math.max(0, m.water) + dw; m.ice = ni; dW += dw; dD += dw; }
    ['salt', 'yeast', 'oil'].forEach((k) => { const n = val('main', k, m[k]), d = n - m[k]; if (d) { m[k] = n; dD += d; t[k] += d; } });
    m.extras.forEach((e, j) => { const n = val('main', `x${j}`, e.g), d = n - e.g; if (d) { e.g = n; e.total = (e.total ?? e.g - d) + d; dD += d; t.extras += d; dLiq += d * C.liquidShare(e.name); } });
    // Beim Backen spontan dazu (z. B. 20 g Honig, Saaten) – nur dieser Backtag
    (adj.main._addX || []).forEach((a, n) => {
      const g = val('main', `ax${n}`, num(a.g));
      m.extras.push({ name: a.name || 'Zutat', g, total: g, _key: `ax${n}` });
      dD += g; t.extras += g; dLiq += g * C.liquidShare(a.name);
    });
  }
  if (adj.lam && x.lam) { const n = val('lam', 'lam', x.lam.g), d = n - x.lam.g; if (d) { x.lam.g = n; t.lam = n; dD += d; } }
  // Summen neu
  x.F += dF; t.flour = x.F; t.water += dW; t.liquid = num(t.liquid) + dW + dLiq;
  x.D += dD; t.dough = x.D;
  t.hydration = x.F > 0 ? (t.water / x.F) * 100 : 0;
  t.hydEff = x.F > 0 ? (t.liquid / x.F) * 100 : 0;
  t.hydrationOil = x.F > 0 ? ((t.water + t.oil) / x.F) * 100 : 0;
  m.extras.forEach((e) => { e.pct = x.F > 0 ? ((e.total ?? e.g) / x.F) * 100 : 0; });
  if (x.lam) { x.lam.pct = x.F > 0 ? (x.lam.g / x.F) * 100 : 0; x.lam.base = x.D - x.lam.g; }
  const fl = (t.flours || []).map((f) => ({ ...f }));
  flourD.forEach((d, name) => { const f = fl.find((y) => y.name === name); if (f) f.g += d; else fl.push({ name, g: d }); });
  t.flours = fl.map((f) => ({ ...f, pct: x.F > 0 ? (f.g / x.F) * 100 : 0 }));
  t.pfFlourPct = x.F > 0 ? (x.pfs.filter((p) => !p.seeds).reduce((a, p) => a + p.flour, 0) / x.F) * 100 : 0;
  if (c.D > 0) { if (x.mode === 'flour') x.count = c.count * (x.D / c.D); else x.pieceWeight = c.pieceWeight * (x.D / c.D); }
  return x;
}
function adjCake(c, adj) {
  if (!c || !adj || !Object.keys(adj).length) return c;
  const x = structuredClone(c);
  x.parts.forEach((p) => {
    const a = adj[p.id];
    if (!a) return;
    (a._add || []).forEach((n) => p.items.push({ name: n.name || 'Zutat', unit: n.unit || 'g', amount: 1, v: Math.max(0, num(n.v)) }));
    p.items.forEach((it, k) => { const v = a[`i${k}`]; if (v !== undefined && v !== '') { it.v = Math.max(0, num(v)); if (!(it.amount > 0)) it.amount = 1; } it.g = C.cakeItemG(it); });
    p.g = p.items.reduce((s2, it) => s2 + (it.g || 0), 0);
  });
  x.total = x.parts.reduce((s2, p) => s2 + p.g, 0);
  return x;
}
async function adjSet(s, st, k, v) {
  s.adjust ||= {};
  s.adjust[st] ||= {};
  s.adjust[st][k] = v;
  S.adjOpen = `${s.id}:${st}`;
  await saveSession(s);
  render();
}
// Nebenher-Zeile im Backvorgang (z. B. Ofen vorheizen während der Stückgare)
function sideSteps(s, tl, cur, now) {
  const list = tl.filter((x) => isSide(x) && !x.doneAt && x !== cur && x.start <= cur.end);
  if (!list.length) return '';
  return `<div class="side-steps">${list.map((x) => `<div class="side-step"><span>⇉ ${kindOf(x.kind).icon} <b>${esc(x.name)}</b> <small>${x.start > now ? `nebenher ab ${fmtTime(x.start)}` : `nebenher · <span data-cd="${x.end}" data-cd-mode="left"></span>`}</small></span>
    ${x.start <= now ? `<button class="icon-btn" data-action="stepDone" data-id="${s.id}" data-i="${x.i}" aria-label="${esc(x.name)} erledigt">${icon('check')}</button>` : ''}</div>`).join('')}</div>`;
}
// „🎨 Anpassen“ unter den Zutaten eines Schritts (eingeklappt)
function adjBox(s, stg) {
  if (!feat('adjust') || !stg) return '';
  const st = stg.stage, cake = s.calc?.kind === 'cake', key = `${s.id}:${st}`;
  const c = sessCalc(s), c0 = sessCalc(s, false), changed = !!s.adjust?.[st];
  const rows = stg.rows.filter((r) => r.type !== 'fixed');
  // „Ziel-Hydration“ und „+10 g Wasser“ nur, wenn die Stufe echtes Wasser hat (nicht Milch, nicht Quellwasser)
  const realWater = rows.some((r) => r.key === 'water' && r.type === 'water');
  const field = (r) => `<span class="unit-in w90"><input class="in" inputmode="decimal" data-change="adj" data-id="${s.id}" data-st="${esc(st)}" data-k="${r.key}" value="${cake ? fmtIn(r.v, 2) : fmtIn(r.g, r.g < 20 ? 1 : 0)}" aria-label="${esc(r.name)}"><span class="u">${cake ? esc(r.unit) : 'g'}</span></span>`;
  const pct = (a, F) => (F > 0 ? (a / F) * 100 : 0);
  let info = '', align = false;
  if (cake) info = `Zutaten ≈ ${fmtG(c0.total)} → <b>${fmtG(c.total)}</b>`;
  else {
    const t = c.totals, t0 = c0.totals, sP = pct(t.salt, c.F), sP0 = pct(t0.salt, c0.F), yP = pct(t.yeast, c.F), yP0 = pct(t0.yeast, c0.F);
    const hChg = Math.abs(t.hydration - t0.hydration) > 0.05, dChg = Math.abs(c.D - c0.D) > 0.5;
    const parts = [hChg ? `Hydration ${fmtPct(t0.hydration)} → <b>${fmtPct(t.hydration)}</b>` : `Hydration ${fmtPct(t.hydration)}`];
    if (showEff(c)) parts.push(`wirksam ${fmtPct(t.hydEff)}`);
    if (Math.abs(sP - sP0) > 0.02) parts.push(`Salz ${fmtPct(sP0)} → ${fmtPct(sP)}`);
    if (t0.yeast > 0 && Math.abs(yP - yP0) > 0.005) parts.push(`Hefe ${fmtPct(yP0)} → ${fmtPct(yP)}`);
    parts.push(c.mode === 'flour' ? (dChg ? `Teig ${fmtG(c0.D)} → <b>${fmtG(c.D)}</b>` : `Teig ${fmtG(c.D)}`)
      : `${fmtNum(c.count, 0)} × ${dChg ? `<b>${fmtNum(c.pieceWeight, 0)} g</b> statt ${fmtNum(c0.pieceWeight, 0)} g` : `${fmtNum(c.pieceWeight, 0)} g`}`);
    info = parts.join(' · ');
    align = st === 'main' && (Math.abs(sP - sP0) > 0.02 || (c.main.yeast > 0 && Math.abs(yP - yP0) > 0.005));
  }
  const hasWater = realWater;
  // Mehl dazumischen / tauschen (Hauptteig und Vorteige mit Mehl) und Zutat dazu (Hauptteig) – erst auf Knopfdruck aufklappen
  const flourRows = rows.filter((r) => r.type === 'flour');
  const canFlour = !cake && (st === 'main' || flourRows.length > 0), canItem = !cake && st === 'main';
  const addMode = S.adjAdd?.key === key ? S.adjAdd.mode : '';
  const a = (attrs) => `data-id="${s.id}" data-st="${esc(st)}" ${attrs}`;
  const myPick = feat('myFlours') ? S.flours.filter((m) => m.name) : [];
  const addForm = addMode === 'flour' ? `${myPick.length ? `<div class="chips">${myPick.map((m) => `<button class="chip mine" style="--fc:${fColor(m)}" data-action="adjPickFlour" data-v="${esc(m.name)}">${fDot(m)} ${esc(m.name)}</button>`).join('')}</div>` : ''}
      <div class="row gap line adj-add"><input class="in grow adj-n" list="adj-flours" placeholder="Mehlsorte" aria-label="Mehlsorte">
      ${flourRows.length ? `<select class="in w110 adj-sw" aria-label="dazu oder statt">${['<option value="">dazu</option>', ...flourRows.map((r) => `<option value="${esc(r.key)}">statt ${esc(r.name)}</option>`)].join('')}</select>` : ''}
      <span class="unit-in w90"><input class="in adj-g" inputmode="decimal" placeholder="${flourRows.length ? 'gleich' : '0'}" aria-label="Menge"><span class="u">g</span></span>
      <button class="icon-btn tonal" data-action="adjAddFlour" ${a('')} aria-label="Mehl übernehmen">${icon('check')}</button></div>
      <datalist id="adj-flours">${[...new Set([...myPick.map((m) => m.name), ...flourRows.map((r) => r.name), ...X.FLOUR_NAMES])].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`
    : addMode === 'item' ? `<div class="row gap line adj-add"><input class="in grow adj-n" list="adj-items" placeholder="Zutat, z. B. Honig" aria-label="Zutat">
      <span class="unit-in w90"><input class="in adj-g" inputmode="decimal" placeholder="0" aria-label="Menge"><span class="u">g</span></span>
      <button class="icon-btn tonal" data-action="adjAddX" ${a('')} aria-label="Zutat übernehmen">${icon('check')}</button></div>
      <datalist id="adj-items">${['Honig', 'Zucker', 'Diastatisches Malz', 'Olivenöl', 'Butter', 'Saaten', 'Sonnenblumenkerne', 'Rosinen', 'Walnüsse', 'Milchpulver'].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>` : '';
  const chips = [
    hasWater && `<button class="chip" data-action="adjQuick" ${a('data-k="water" data-d="10"')}>+10 g Wasser</button>`,
    hasWater && flourRows.length && `<button class="chip" data-action="adjQuick" ${a('data-k="flour" data-d="10"')}>+10 g Mehl</button>`,
    canFlour && `<button class="chip ${addMode === 'flour' ? 'on' : ''}" data-action="adjAddOpen" ${a('data-m="flour"')}>⇄ Mehlsorte</button>`,
    canItem && `<button class="chip ${addMode === 'item' ? 'on' : ''}" data-action="adjAddOpen" ${a('data-m="item"')}>＋ Zutat</button>`,
  ].filter(Boolean);
  return `<details class="adj" data-adj="${esc(key)}" ${S.adjOpen === key ? 'open' : ''}>
    <summary>🎨 Anpassen${changed ? ` <small class="muted">· ${cake ? 'angepasst' : `jetzt ${fmtPct(c.totals.hydration)}`}</small>` : ''}</summary>
    ${rows.map((r) => `<div class="adj-row ${r.chg ? 'chg' : ''}"><span>${r.type === 'flour' && myF(r.name) ? fDot(myF(r.name)) : ''}${esc(r.name)}</span>${field(r)}</div>`).join('')}
    ${hasWater ? `<div class="adj-row"><span>Ziel-Hydration <small class="muted">gesamt</small></span><span class="unit-in w90"><input class="in" inputmode="decimal" data-change="adjHyd" data-id="${s.id}" data-st="${esc(st)}" value="${fmtIn(c.totals.hydration, 1)}" aria-label="Ziel-Hydration"><span class="u">%</span></span></div>` : ''}
    ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    ${addForm}
    ${cake ? `<div class="row gap line"><input class="in grow" id="adj-in" placeholder="Zutat dazu …"><input class="in w70" id="adj-iv" inputmode="decimal" placeholder="0"><select class="in w80" id="adj-iu">${C.UNITS.map((u) => `<option>${u}</option>`).join('')}</select><button class="icon-btn tonal" data-action="adjAddItem" data-id="${s.id}" data-st="${esc(st)}" aria-label="Zutat hinzufügen">${icon('plus')}</button></div>` : ''}
    <div class="adj-info">${info}</div>
    ${align || changed ? `<div class="row gap wrap">${align ? `<button class="btn sm" data-action="adjAlign" data-id="${s.id}">Salz/Hefe angleichen</button>` : ''}${changed ? `<button class="btn sm ghost" data-action="adjReset" data-id="${s.id}" data-st="${esc(st)}">↶ Rezeptmengen</button>` : ''}</div>` : ''}
  </details>`;
}

// ---------- Teighände-Modus ----------
function vHands(s) {
  const now = Date.now();
  const tl = planInfo(effSteps(s), s.startAt, now).tl;
  const cur = curStep(tl);
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
    const next = nextMain(tl, cur.i);
    const stg = stepIngredients(s, cur);
    const side = tl.find((x) => isSide(x) && !x.doneAt && x !== cur && x.start <= cur.end);
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
      ${stg ? `<div class="hands-ing" data-tk="${s.id}:${cur.i}">${stg.rows.map((x) => `<div data-action="tick"><span>${esc(x.name)}</span><b>${x.txt ?? fmtG(x.g)}</b></div>`).join('')}</div>` : ''}
      ${side ? `<div class="hands-sub">⇉ Nebenher: <b>${esc(side.name)}</b> ${side.start > now ? `ab ${fmtTime(side.start)}` : `· <span data-cd="${side.end}" data-cd-mode="left"></span>`}</div>` : ''}
      <div class="grow"></div>
      ${next ? `<div class="hands-sub">Danach: <b>${esc(next.name)}</b> · ${fmtTime(Math.max(next.start, cur.end))}</div>` : ''}
      <button class="hands-go" data-action="stepDone" data-id="${s.id}" data-i="${cur.i}" data-hands="1">✓ ${next ? 'Weiter' : 'Fertig'}</button>
      <div class="hands-row">${undo}${stg && feat('adjust') && stg.rows.some((x) => x.type === 'water') ? `<button class="hands-small" data-action="adjQuick" data-id="${s.id}" data-st="${stg.stage}" data-k="water" data-d="10">+10 g Wasser</button><button class="hands-small" data-action="adjQuick" data-id="${s.id}" data-st="${stg.stage}" data-k="flour" data-d="10">+10 g Mehl</button>` : ''}<button class="hands-small" data-action="stepShift" data-id="${s.id}" data-i="${cur.i}" data-min="15">+15 min</button></div>`;
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
// Teiggefühl nur bei Schritten, in denen man den Teig in der Hand hat
const FEEL_KINDS = new Set(['mix', 'autolyse', 'bulk', 'fold', 'shape', 'laminate', 'proof', 'rest']);
// Kurzfassung dessen, was zu einem Schritt notiert wurde (für die eingeklappte Zeile)
function noteSum(st) {
  return [measLabel(st.meas), st.feel && `🤲 ${C.FEELS[st.feel]}`, st.note && '✏️ Notiz', st.photos?.length && `📷 ${st.photos.length}`].filter(Boolean).join(' · ');
}
// „📝 Notieren“: Temperaturen, Teiggefühl, Notiz und Fotos zum laufenden Schritt – alles in einem eingeklappten Bereich
function measBox(s, cur) {
  const step = s.steps[cur.i], m = step.meas || {};
  const water = s.calc?.kind !== 'cake' && isMainMix(cur);
  const def = water ? measDefaults(s) : {};
  const fields = water ? [...MEAS, ...MEAS_WATER] : MEAS;
  const shown = { ...def, ...(water ? waterOverrides(s) : {}), ...m };
  const feel = s.calc?.kind !== 'cake' && FEEL_KINDS.has(cur.kind);
  const at = `data-id="${s.id}" data-i="${cur.i}"`;
  return `<details class="meas" data-meas="${s.id}:${cur.i}" ${S.measOpen === `${s.id}:${cur.i}` ? 'open' : ''}><summary>📝 <span id="meas-sum">${noteSum(step) || 'Notieren'}</span> <small class="muted">${noteSum(step) ? '' : feel ? 'Temperatur, Teiggefühl, Notiz, Foto' : 'Temperatur, Notiz, Foto'}</small></summary>
    ${feel ? `<div class="meas-l">Teiggefühl</div><div class="seg small feel">${Object.entries(C.FEELS).map(([k, l]) => `<button class="${step.feel === k ? 'on' : ''}" data-action="stepFeel" ${at} data-v="${k}">${l}</button>`).join('')}</div>` : ''}
    <div class="meas-row">${fields.map(([k, l, u]) => `<label><small>${k === 'dough' ? 'Teig (z. B. nach Kneten)' : k === 'water' ? 'Wassertemperatur' : k === 'ice' ? 'davon Eis' : l}</small><span class="unit-in"><input class="in" inputmode="decimal" data-change="meas" ${at} data-k="${k}" value="${shown[k] !== undefined && shown[k] !== '' ? fmtIn(shown[k], k === 'ice' ? 0 : 1) : ''}"><span class="u">${u}</span></span></label>`).join('')}</div>
    ${water && (def.water !== undefined || def.ice !== undefined) ? '<small class="muted">Wasser/Eis sind aus dem Rezept vorbelegt – ändere sie, falls du es heute anders machst.<br></small>' : ''}
    <textarea class="in note-in" rows="2" data-change="stepNote" ${at} placeholder="Notiz zu diesem Schritt, z. B. „Teig sehr klebrig“">${esc(step.note || '')}</textarea>
    <div class="thumbs">${(step.photos || []).map((p) => `<button class="ph thumb" data-action="viewPhoto" data-id="${p}"><img data-photo="${p}" alt=""></button>`).join('')}
      <label class="thumb add">${icon('camera')}<span>Foto</span><input type="file" accept="image/*" capture="environment" hidden data-change="stepPhoto" ${at}></label></div>
    <small class="muted">Alles landet automatisch im Tagebuch.${feat('tempComp') ? ' Die Raumtemperatur passt die Garzeiten an.' : ''}</small>
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

// ---------- Backprotokoll (im Tagebuch-Eintrag gespeichert) ----------
function protoBlocks(c, c0, yt) {
  const mk = (title, rows, base) => ({ title, rows: rows.map((x) => {
    const b = base.find((y) => y.key === x.key), txt = x.txt ?? fmtG(x.g), was = b ? (b.txt ?? fmtG(b.g)) : 'neu';
    return { name: x.name, txt, was: was === txt ? '' : was };
  }) });
  if (c.kind === 'cake') return c.parts.map((p) => mk(p.name || 'Zutaten', cakeRows(p), cakeRows(c0.parts.find((y) => y.id === p.id) || { items: [] })));
  const out = c.pfs.map((x) => mk(x.pf.name || 'Vorteig', pfRows(x, yt), pfRows(c0.pfs.find((y) => y.id === x.id) || x, yt)));
  out.push(mk(c.lam?.g > 0 ? 'Grundteig' : 'Hauptteig', mainRows(c, yt), mainRows(c0, yt)));
  if (c.lam?.g > 0) out.push(mk('Ziehfett', lamRows(c), c0.lam?.g > 0 ? lamRows(c0) : []));
  return out;
}
// Prozentwerte des Backtags – zum Übernehmen ins Rezept bzw. als Variante (C.applyPct)
function protoPct(c) {
  if (c.kind === 'cake') return { cake: c.parts.map((p) => ({ id: p.id, items: p.items.map((it) => ({ name: it.name, unit: it.unit, amount: c.factor > 0 ? Math.round((it.v / c.factor) * 100) / 100 : it.v })) })) };
  const F = c.F, pc = (g) => (F > 0 ? (g / F) * 100 : 0);
  return {
    water: c.totals.hydration, salt: pc(c.totals.salt), yeast: pc(c.main.yeast), oil: pc(c.totals.oil), lam: pc(c.lam?.g || 0),
    flours: (c.totals.flours || []).map((f) => ({ name: f.name, pct: f.pct })),
    extras: c.main.extras.filter((e) => !e._key || (e.total ?? e.g) > 0).map((e) => ({ name: e.name, pct: pc(e.total ?? e.g) })),
    pfs: c.pfs.map((p) => {
      const o = { id: p.id, flourPct: pc(p.flour), hydration: p.flour > 0 ? (p.water / p.flour) * 100 : 0,
        starterPct: !p.chained && p.freshFlour > 0 && num(p.pf.starterPct) > 0 ? (p.starter / p.freshFlour) * 100 : 0, yeastPct: p.flour > 0 ? (p.yeast / p.flour) * 100 : 0,
        saltPct: p.flour > 0 ? (num(p.salt) / p.flour) * 100 : 0 };
      // Mehlsorten im Vorteig (Anteil am frischen Vorteigmehl) und Zutaten im Vorteig (% vom Gesamtmehl)
      const fp = (p.flourParts || []).filter((q) => q.g > 0.05), fs = fp.reduce((s2, q) => s2 + q.g, 0);
      if (!p.seeds && fp.length && fs > 0) o.flours = fp.map((q) => ({ name: q.name, pct: (q.g / fs) * 100 }));
      if ((p.extras || []).length) o.extras = p.extras.map((e) => ({ name: e.name, pct: pc(e.g) }));
      return o;
    }),
  };
}
function buildProtocol(s) {
  const tl = C.timeline(effSteps(s), s.startAt);
  const c = sessCalc(s), c0 = sessCalc(s, false), cake = c.kind === 'cake', r = byId(s.recipeId);
  const blocks = protoBlocks(c, c0, s.yeastType);
  const changes = blocks.flatMap((b) => b.rows.filter((x) => x.was).map((x) => ({ stage: b.title, name: x.name, from: x.was === 'neu' ? '–' : x.was, to: x.txt })));
  const stName = (st) => (st === 'main' ? 'Hauptteig' : st === 'lam' ? 'Ziehfett' : [...(r?.preferments || []), ...(r?.parts || [])].find((p) => p.id === st)?.name || '');
  const done = tl.map((x) => x.doneAt).filter(Boolean);
  return {
    startAt: s.startAt, endAt: done.length ? Math.max(...done) : null,
    hydration: cake ? null : c.totals.hydration, baseHydration: cake ? null : c0.totals.hydration, dough: cake ? c.total : c.D,
    steps: tl.map((x) => {
      const b = s.steps[x.i];
      return { name: x.name, kind: x.kind, loc: x.location, plan: num(b.durationMin), act: x.doneAt ? Math.max(0, Math.round((x.doneAt - x.start) / 60000)) : null,
        start: x.start, end: x.doneAt || null, par: x.parallel ? (x.align === 'end' ? 'end' : 'start') : '', temp: x.temp || '', stage: stName(stageOfStep(s, x)),
        note: b.note || '', feel: b.feel || '', photos: b.photos || [], meas: b.meas || {}, shift: num(b.shiftMin) || null, comp: x._comp ? Math.round(num(x.durationMin) - num(b.shiftMin)) : null };
    }),
    blocks, changes, pct: changes.length ? protoPct(c) : null,
  };
}
// Abweichung eines Schritts: erst ab 5 min bzw. 10 % zählt sie (sonst wird es unruhig)
const protoDelta = (p) => {
  if (p.act === null || p.act === undefined || p.plan === null) return 0;
  const d = p.act - p.plan;
  return Math.abs(d) >= Math.max(5, 0.1 * p.plan) ? d : 0;
};
function protoSum(pr) {
  const st = pr.steps || [];
  const up = st.filter((p) => protoDelta(p) > 0).length, dn = st.filter((p) => protoDelta(p) < 0).length;
  const feels = [...new Set(st.map((p) => p.feel).filter(Boolean))].map((f) => C.FEELS[f]);
  return [up && `${up} länger`, dn && `${dn} kürzer`, !up && !dn && st.some((p) => p.act !== null) && 'wie geplant',
    pr.changes?.length && `🎨 ${pr.changes.length} angepasst`, feels.length && `🤲 ${feels.join(', ')}`,
    st.some((p) => p.note) && '✏️', st.some((p) => p.photos?.length) && '📷'].filter(Boolean).join(' · ');
}
function protoRow(p, i, edit) {
  const d = protoDelta(p);
  const extra = [p.feel && `🤲 ${C.FEELS[p.feel]}`, measLabel(p.meas), p.comp && `🌡️ Temperatur-Ausgleich: ${fmtDur(p.comp)}`, p.shift && `${p.shift > 0 ? '+' : '−'}${fmtDur(Math.abs(p.shift))} per Knopf`].filter(Boolean);
  const hh = Math.floor(num(p.act) / 60), mm = Math.round(num(p.act) % 60);
  return `<li class="tl-i loc-${p.loc} ${p.par ? 'par' : ''}"><div class="tl-dot">${kindOf(p.kind).icon}</div><div class="tl-c">
    <div class="tl-h"><b>${esc(p.name)}</b><span class="tl-when">${p.start ? fmtTime(p.start) : ''}</span></div>
    <div class="tl-m">${p.par ? '<span class="par-tag">nebenher</span> · ' : ''}geplant ${fmtDur(p.plan)}${p.act !== null ? ` · tatsächlich <b>${fmtDur(p.act)}</b>` : ' · <span class="muted">nicht erledigt</span>'}${d ? ` <span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmtDur(Math.abs(d))}</span>` : ''}</div>
    ${edit && p.act !== null ? `<div class="row gap dur proto-edit"><span class="unit-in"><input class="in" inputmode="numeric" data-change="protoAct" data-i="${i}" data-part="h" value="${hh}" aria-label="Stunden"><span class="u">h</span></span><span class="unit-in"><input class="in" inputmode="numeric" data-change="protoAct" data-i="${i}" data-part="m" value="${mm}" aria-label="Minuten"><span class="u">min</span></span></div>` : ''}
    ${extra.length ? `<div class="tl-m">${extra.map(esc).join(' · ')}</div>` : ''}
    ${p.note ? `<div class="tl-n">✏️ ${esc(p.note)}</div>` : ''}
    ${p.photos?.length ? `<div class="thumbs">${p.photos.map((ph) => `<button class="ph thumb" data-action="viewPhoto" data-id="${ph}"><img data-photo="${ph}" alt=""></button>`).join('')}</div>` : ''}
  </div></li>`;
}
function protoSection(l) {
  const pr = l.protocol;
  if (!pr) {
    return l.sessionId && sessById(l.sessionId) ? `<div class="hint-card small"><div>⏱ Der Backvorgang zu diesem Eintrag ist noch auf dem Gerät.</div><button class="btn sm" data-action="protoFromSession">Ablauf übernehmen</button></div>` : '';
  }
  const hyd = pr.hydration !== null && pr.baseHydration !== null && Math.abs(pr.hydration - pr.baseHydration) > 0.05 ? ` · Hydration ${fmtPct(pr.baseHydration)} → ${fmtPct(pr.hydration)}` : '';
  return `<details class="card proto" ${S.protoEdit ? 'open' : ''}><summary>⏱ Ablauf <small class="muted">${protoSum(pr) || `${pr.steps.length} Schritte`}</small></summary>
    ${pr.changes?.length ? `<div class="proto-chg">🎨 <b>Angepasst</b>${hyd}<br>${pr.changes.map((c) => `${esc(c.name)}: ${esc(c.from)} → <b>${esc(c.to)}</b>`).join('<br>')}</div>` : ''}
    <ol class="tl">${pr.steps.map((p, i) => protoRow(p, i, S.protoEdit)).join('')}</ol>
    ${pr.steps.some((p) => p.act !== null) ? `<button class="btn sm ghost" data-action="protoEdit">${S.protoEdit ? `${icon('check')} Fertig` : '✎ Zeiten korrigieren'}</button>` : ''}
  </details>
  ${pr.blocks?.length ? `<details class="card"><summary>🧾 Zutaten dieses Backtags${pr.hydration !== null ? ` <small class="muted">${fmtPct(pr.hydration)}</small>` : ''}</summary>
    ${pr.blocks.map((b) => `<section class="ing"><h3>${esc(b.title)}</h3><table>${b.rows.map((x) => `<tr ${x.was ? 'class="chg"' : ''}><td>${esc(x.name)}${x.was ? `<small>${x.was === 'neu' ? 'dazu' : `statt ${esc(x.was)}`}</small>` : ''}</td><td class="num">${esc(x.txt)}</td></tr>`).join('')}</table></section>`).join('')}
  </details>` : ''}`;
}

// ---------- Vergleich zweier Tagebuch-Einträge (nur Unterschiede) ----------
function vCmp(rid, q) {
  const r = byId(rid);
  if (!r) return vNotFound();
  const logs = logsFor(rid);
  if (logs.length < 2) return { html: `<div class="pad empty"><p>Zum Vergleichen braucht es mindestens zwei Tagebuch-Einträge.</p><a class="btn" href="#/r/${rid}?tab=log">Zurück</a></div>` };
  // Voreinstellung: bester gegen letzten Eintrag
  const best = logs.filter((l) => l.rating > 0).sort((x, y) => y.rating - x.rating)[0] || logs[1];
  let A = S.logs.find((l) => l.id === q.get('a')) || (best.id === logs[0].id ? logs[1] : best);
  let B = S.logs.find((l) => l.id === q.get('b')) || logs[0];
  if ((A.date || '') > (B.date || '')) [A, B] = [B, A]; // älterer links
  const win = A.rating === B.rating ? null : A.rating > B.rating ? 'a' : 'b';
  const pr = (l) => l.params || {};
  const T = (l, k) => esc(l[k] ?? '');
  const rows = [];
  const add = (label, a, b) => rows.push({ label, a: a === '' || a === undefined || a === null ? '–' : a, b: b === '' || b === undefined || b === null ? '–' : b });
  (SUBRATINGS[r.category] || SUBRATINGS.other).forEach(([k, lbl]) => add(lbl, A.sub?.[k] ? '★'.repeat(A.sub[k]) : '', B.sub?.[k] ? '★'.repeat(B.sub[k]) : ''));
  if (!isCake(r)) {
    add('Hydration', num(pr(A).hydration) ? fmtPct(pr(A).hydration) : '', num(pr(B).hydration) ? fmtPct(pr(B).hydration) : '');
    add('Salz', num(pr(A).salt) ? fmtPct(pr(A).salt) : '', num(pr(B).salt) ? fmtPct(pr(B).salt) : '');
    add('Hefe', num(pr(A).yeastPct) ? fmtPct(pr(A).yeastPct) : '', num(pr(B).yeastPct) ? fmtPct(pr(B).yeastPct) : '');
    add('Vorteig', esc(pr(A).pf), esc(pr(B).pf));
    add('Menge', pr(A).count ? `${fmtNum(pr(A).count, 0)} × ${fmtNum(pr(A).pieceWeight, 0)} g` : '', pr(B).count ? `${fmtNum(pr(B).count, 0)} × ${fmtNum(pr(B).pieceWeight, 0)} g` : '');
    add('Mehl', esc(pr(A).flour), esc(pr(B).flour));
  } else add('Form', esc(pr(A).pan), esc(pr(B).pan));
  add('Gesamtzeit', num(pr(A).totalHours) ? `${fmtNum(pr(A).totalHours)} h` : '', num(pr(B).totalHours) ? `${fmtNum(pr(B).totalHours)} h` : '');
  [['doughTemp', 'Teig', ' °C'], ['roomTemp', 'Raum', ' °C'], ['fridgeTemp', 'Kühlschrank', ' °C'], ['waterTemp', 'Wasser', ' °C'], ['iceG', 'Eis', ' g'], ['oven', 'Ofen', ''], ['bakeTemp', 'Backtemperatur', ' °C'], ['bakeTime', 'Backzeit', '']]
    .forEach(([k, lbl, u]) => add(lbl, A[k] ? T(A, k) + u : '', B[k] ? T(B, k) + u : ''));
  // Schritte aus dem Backprotokoll: tatsächliche Dauer (kleine Abweichungen unter 10 % zählen nicht) und Teiggefühl
  // Nur vergleichen, wenn beide Einträge ein Backprotokoll haben – sonst lauter „–“
  const sa = A.protocol?.steps || [], sb = B.protocol?.steps || [];
  if (sa.length && sb.length) [...new Set([...sa, ...sb].map((s) => s.name))].forEach((name) => {
    const x = sa.find((s) => s.name === name), y = sb.find((s) => s.name === name);
    const ta = x?.act ?? null, tb = y?.act ?? null;
    if (ta !== null && tb !== null && Math.abs(ta - tb) < Math.max(5, 0.1 * Math.max(ta, tb))) add(`⏱ ${esc(name)}`, fmtDur(ta), fmtDur(ta));
    else add(`⏱ ${esc(name)}`, ta !== null ? fmtDur(ta) : '', tb !== null ? fmtDur(tb) : '');
    if (x?.feel || y?.feel) add(`🤲 ${esc(name)}`, x?.feel ? C.FEELS[x.feel] : '', y?.feel ? C.FEELS[y.feel] : '');
  });
  add('🎨 Angepasst', (A.protocol?.changes || []).map((c) => `${esc(c.name)} → ${esc(c.to)}`).join('<br>'), (B.protocol?.changes || []).map((c) => `${esc(c.name)} → ${esc(c.to)}`).join('<br>'));
  add('Nächstes Mal', esc(A.nextTime), esc(B.nextTime));
  const diff = rows.filter((x) => x.a !== x.b), same = rows.filter((x) => x.a === x.b && x.a !== '–');
  const show = S.cmpAll ? rows.filter((x) => x.a !== '–' || x.b !== '–') : diff;
  // Kurze, eindeutige Beschriftung: Datum · Hydration · Sterne (zwei Backtage am selben Tag bleiben unterscheidbar)
  const lbl = (l) => [l.date ? l.date.split('-').reverse().join('.') : '–', num(l.params?.hydration) && fmtPct(l.params.hydration), l.rating && `${l.rating} ★`].filter(Boolean).join(' · ');
  const opt = (sel, side) => `<select class="in" data-change="cmpPick" data-side="${side}" data-rid="${rid}" data-a="${A.id}" data-b="${B.id}">${logs.map((l) => `<option value="${l.id}" ${l.id === sel.id ? 'selected' : ''}>${lbl(l)}</option>`).join('')}</select>`;
  // Teiggefühl nach Hydration über alle Einträge („Bei 72 % war er immer ‚passt‘“)
  const fh = new Map();
  logs.forEach((l) => (l.protocol?.steps || []).forEach((s) => { if (s.feel && num(l.params?.hydration)) { const k = fmtPct(Math.round(num(l.params.hydration) * 2) / 2); const m = fh.get(k) || {}; m[s.feel] = (m[s.feel] || 0) + 1; fh.set(k, m); } }));
  const feelCard = fh.size >= 2 ? `<details class="card"><summary>🤲 Teiggefühl nach Hydration <small class="muted">alle Einträge</small></summary>
    ${[...fh.entries()].sort((x, y) => num(x[0]) - num(y[0])).map(([h, m]) => `<div class="row between"><span>${h}</span><span>${Object.entries(m).map(([f, n]) => `${C.FEELS[f]}${n > 1 ? ` ×${n}` : ''}`).join(' · ')}</span></div>`).join('')}</details>` : '';
  return { html: `
  <header class="top sub"><a class="icon-btn" href="#/r/${rid}?tab=log" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Tagebuch · ${esc(r.name)}</div><h1 class="title sm">Vergleich</h1></div></header>
  <div class="pad">
    <div class="cmp-pick"><div class="${win === 'a' ? 'win' : ''}">${opt(A, 'a')}<div class="cmp-stars">${A.rating ? stars(A.rating) : '–'}</div></div><div class="${win === 'b' ? 'win' : ''}">${opt(B, 'b')}<div class="cmp-stars">${B.rating ? stars(B.rating) : '–'}</div></div></div>
    ${show.length ? `<table class="cmp">${show.map((x) => `<tr><th>${x.label}</th><td class="${win === 'a' ? 'win' : ''}">${x.a}</td><td class="${win === 'b' ? 'win' : ''}">${x.b}</td></tr>`).join('')}</table>`
      : '<p class="muted center">Keine Unterschiede gefunden.</p>'}
    <button class="more-link" data-action="cmpAll">${S.cmpAll ? 'Nur Unterschiede zeigen' : `${same.length} ${same.length === 1 ? 'Wert' : 'Werte'} gleich – alle zeigen`}</button>
    ${feelCard}
  </div>` };
}

// ---------- Tagebuch-Eintrag ansehen (Übersicht · Zutaten · Backprozess) ----------
const deltaPill = (d, unit = 'min') => (!d ? '<span class="dp"></span>'
  : `<span class="dp ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${unit === 'min' ? fmtDur(Math.abs(d)) : `${fmtNum(Math.abs(d), Math.abs(d) < 20 ? 1 : 0)} ${unit}`}</span>`);
function vLogView(rid, lid, q) {
  const r = byId(rid), l = S.logs.find((x) => x.id === lid);
  if (!r || !l) return vNotFound();
  const tab = q.get('tab') || 'ov', pr = l.protocol, p = l.params || {}, cake = isCake(r);
  const subs = (SUBRATINGS[r.category] || SUBRATINGS.other).filter(([k]) => l.sub?.[k]);
  const tabs = [['ov', 'Übersicht'], ['ing', 'Zutaten'], ['proc', 'Backprozess']];
  const base = `#/log/${rid}/${lid}`;
  let body = '';
  if (tab === 'ing') {
    if (!pr?.blocks?.length) body = '<div class="empty small"><p>Für diesen Eintrag gibt es keine genauen Mengen – er stammt aus der Zeit vor dem Backprotokoll oder wurde ohne Backvorgang angelegt.</p></div>';
    else {
      const only = !!S.logOnlyChg;
      body = `${pr.hydration !== null ? `<div class="lv-sum">💧 Hydration <b>${fmtPct(pr.hydration)}</b>${pr.baseHydration !== null && Math.abs(pr.hydration - pr.baseHydration) > 0.05 ? ` <span class="muted">statt ${fmtPct(pr.baseHydration)} im Rezept</span>` : ''}</div>` : ''}
        ${pr.blocks.map((b) => {
          const rows = b.rows.filter((x) => !only || x.was);
          return rows.length ? `<section class="ing lv-ing"><h3>${esc(b.title)}</h3><table>${rows.map((x) => {
            const d = x.was && x.was !== 'neu' ? num(x.txt) - num(x.was) : 0;
            return `<tr ${x.was ? 'class="chg"' : ''}><td>${esc(x.name)}${x.was ? `<small>${x.was === 'neu' ? 'neu dazu' : `statt ${esc(x.was)}`}</small>` : ''}</td><td class="num">${esc(x.txt)}</td><td class="num">${x.was === 'neu' ? '<span class="dp up">neu</span>' : deltaPill(d, /ml/.test(x.txt) ? 'ml' : 'g')}</td></tr>`;
          }).join('')}</table></section>` : '';
        }).join('')}
        <label class="check"><input type="checkbox" data-action="logOnlyChg" ${only ? 'checked' : ''}> Nur Änderungen zeigen</label>`;
    }
  } else if (tab === 'proc') {
    if (!pr?.steps?.length) body = '<div class="empty small"><p>Für diesen Eintrag gibt es keinen gespeicherten Ablauf.</p></div>';
    else {
      const planT = pr.steps.filter((s) => !s.par).reduce((a, s) => a + num(s.plan), 0);
      const actT = pr.endAt && pr.startAt ? (pr.endAt - pr.startAt) / 60000 : null;
      body = `<div class="lv-sum">⏱ Gesamt <b>${actT !== null ? fmtDur(actT) : '–'}</b> <span class="muted">geplant ${fmtDur(planT)}</span><br><small class="muted">${protoSum(pr)}</small></div>
        <div class="pt">${pr.steps.map((s) => {
          const d = protoDelta(s), extra = [s.feel && `🤲 ${C.FEELS[s.feel]}`, measLabel(s.meas), s.comp && `🌡️ Ausgleich ${fmtDur(s.comp)}`, s.shift && `${s.shift > 0 ? '+' : '−'}${fmtDur(Math.abs(s.shift))} per Knopf`].filter(Boolean);
          const icons = [s.note && '📝', s.photos?.length && '📷', s.feel && '🤲'].filter(Boolean).join(' ');
          const more = extra.length || s.note || s.photos?.length;
          const row = `<span class="pt-t">${s.start ? fmtTime(s.start) : ''}</span><span class="pt-n">${s.par ? '┗ ' : ''}${kindOf(s.kind).icon} ${esc(s.name)}${d ? `<small>geplant ${fmtDur(s.plan)}</small>` : ''}</span><span class="pt-d">${s.act !== null ? fmtDur(s.act) : '–'}${icons ? `<small>${icons}</small>` : ''}</span>${deltaPill(d)}`;
          return more ? `<details class="pt-r ${s.par ? 'par' : ''}"><summary>${row}</summary><div class="pt-x">${extra.length ? `<div class="muted small">${extra.map(esc).join(' · ')}</div>` : ''}${s.note ? `<div class="tl-n">✏️ ${esc(s.note)}</div>` : ''}${s.photos?.length ? `<div class="thumbs">${s.photos.map((ph) => `<button class="ph thumb" data-action="viewPhoto" data-id="${ph}"><img data-photo="${ph}" alt=""></button>`).join('')}</div>` : ''}</div></details>`
            : `<div class="pt-r ${s.par ? 'par' : ''}"><div class="pt-s">${row}</div></div>`;
        }).join('')}</div>
        ${pr.changes?.length ? `<p class="muted small">🎨 Zutaten wurden beim Backen angepasst – siehe Reiter „Zutaten“.</p>` : ''}`;
    }
  } else {
    // Übersicht
    const cover = (l.photos || [])[0];
    const recHyd = pr?.baseHydration ?? num(r.water?.pct);
    const tile = (k, v, sub = '') => `<div class="lv-tile"><small>${k}</small><b>${v}</b>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`;
    const planT = pr?.steps?.length ? pr.steps.filter((s) => !s.par).reduce((a, s) => a + num(s.plan), 0) / 60 : null;
    const tiles = [
      !cake && num(p.hydration) > 0 && tile('💧 Hydration', fmtPct(p.hydration), Math.abs(num(p.hydration) - recHyd) > 0.05 ? `Rezept ${fmtPct(recHyd)}` : ''),
      cake ? (p.pan && tile('⭕ Form', esc(p.pan))) : (num(p.count) > 0 && tile('⚖️ Menge', `${fmtNum(p.count, 0)} × ${fmtNum(p.pieceWeight, 0)} g`)),
      num(p.totalHours) > 0 && tile('⏱ Gesamtzeit', `${fmtNum(p.totalHours)} h`, planT ? `geplant ${fmtNum(planT)} h` : ''),
      (l.doughTemp || l.roomTemp) && tile('🌡️ Temperatur', l.doughTemp ? `Teig ${esc(l.doughTemp)} °C` : `Raum ${esc(l.roomTemp)} °C`, l.doughTemp && l.roomTemp ? `Raum ${esc(l.roomTemp)} °C` : ''),
      (l.oven || l.bakeTemp || l.bakeTime) && tile('🔥 Ofen', esc(l.bakeTemp ? `${l.bakeTemp} °C` : l.oven), [l.bakeTemp && l.oven, l.bakeTime].filter(Boolean).map(esc).join(' · ')),
    ].filter(Boolean);
    const devs = (pr?.steps || []).map((s) => ({ s, d: protoDelta(s) })).filter((x) => x.d).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
    body = `${cover ? `<div class="lv-photos"><button class="ph lv-cover" data-action="viewPhoto" data-id="${cover}"><img data-photo="${cover}" alt=""></button>
        ${(l.photos || []).length > 1 ? `<div class="thumbs">${l.photos.slice(1).map((ph) => `<button class="ph thumb" data-action="viewPhoto" data-id="${ph}"><img data-photo="${ph}" alt=""></button>`).join('')}</div>` : ''}</div>` : ''}
      ${subs.length ? `<div class="lv-subs">${subs.map(([k, lbl]) => `<span>${lbl} ${stars(l.sub[k])}</span>`).join('')}</div>` : ''}
      ${tiles.length ? `<div class="lv-tiles">${tiles.join('')}</div>` : ''}
      ${devs.length || pr?.changes?.length ? `<section class="card lv-dev"><b>Größte Abweichungen</b>
        ${devs.map(({ s, d }) => `<div class="lv-dr"><span>${esc(s.name)}</span>${deltaPill(d)}</div>`).join('')}
        ${pr?.changes?.length ? `<div class="lv-dr"><span>🎨 ${pr.changes.length} Zutat${pr.changes.length > 1 ? 'en' : ''} angepasst</span><a class="small" data-replace href="${base}?tab=ing">ansehen</a></div>` : ''}</section>` : ''}
      ${l.notes ? `<p class="pre lv-note">📝 ${esc(l.notes)}</p>` : ''}
      ${l.nextTime ? `<p class="next">➡️ <b>Nächstes Mal:</b> ${esc(l.nextTime)}</p>` : ''}
      <div class="act-row">
        <button class="btn sm" data-action="bakeAgain" data-id="${l.id}">${icon('play')} So nochmal backen</button>
        ${logsFor(rid).length >= 2 ? `<a class="btn sm ghost" href="#/cmp/${rid}?b=${l.id}">⇄ Vergleichen</a>` : ''}
        ${pr?.pct ? `<button class="btn sm ghost" data-action="logMenu" data-id="${l.id}">🎨 Übernehmen …</button>`
          : !cake ? `<button class="icon-btn" data-action="logMenu" data-id="${l.id}" aria-label="Mehr">${icon('more')}</button>` : ''}
      </div>`;
  }
  return { html: `
  <header class="top sub"><a class="icon-btn" href="#/r/${rid}?tab=log" aria-label="Zurück">${icon('back')}</a>
    <div class="grow"><div class="eyebrow">Tagebuch · ${esc(r.name)}</div><h1 class="title sm">${fmtDate(l.date)} ${l.rating ? stars(l.rating) : ''}</h1></div>
    <a class="icon-btn" href="${base}/edit" aria-label="Bearbeiten">${icon('edit')}</a></header>
  <div class="pad">
    <div class="seg" role="tablist">${tabs.map(([k, lbl]) => `<a role="tab" data-replace class="${tab === k ? 'on' : ''}" href="${base}?tab=${k}">${lbl}</a>`).join('')}</div>
    ${body}
  </div>` };
}

// ---------- Tagebuch-Eintrag bearbeiten ----------
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
        roomTemp: '', doughTemp: '', fridgeTemp: '', waterTemp: '', iceG: '', oven: '', bakeTemp: '', bakeTime: '', notes: '', nextTime: '',
        // Fotos aus dem Backvorgang (je Schritt) gehören zum Eintrag → Sicherung & Sync
        photos: sess ? [...new Set(sess.steps.flatMap((x) => x.photos || []))] : [],
        sessionId: sess?.id || null, createdAt: Date.now(),
        protocol: sess ? buildProtocol(sess) : null,
        ...sessTemps(sess),
      };
    }
    S.logDraft._key = key;
    S.logDraft._new = !ex;
    S.protoEdit = false;
    S.logFrom = S.prevHash;
  }
  const l = S.logDraft;
  const subs = SUBRATINGS[r.category] || SUBRATINGS.other;
  const starInput = (k, v, big) => `<div class="stars-in ${big ? 'big' : ''}">${[1, 2, 3, 4, 5].map((n) => `<button class="${n <= v ? 'on' : ''}" data-action="rate" data-k="${k}" data-v="${n}" aria-label="${n} Sterne">★</button>`).join('')}</div>`;
  const lb = (path, val, attrs = '') => `<input class="in" data-bind="l.${path}" value="${esc(val ?? '')}" ${attrs}>`;
  const html = `
  <header class="top sub"><a class="icon-btn" href="${l._new ? `#/r/${rid}?tab=log` : `#/log/${rid}/${l.id}`}" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">Tagebuch · ${esc(r.name)}</div><h1 class="title sm">${l._new ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}</h1></div>
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
    ${protoSection(l)}
    <details class="card"><summary>Parameter <small class="muted">${paramChips(l.params, true)}</small></summary>
    <p class="muted small" style="margin-top:0">Aus ${l.sessionId ? 'dem Backvorgang' : 'dem Rezept'} übernommen – ändere, was du anders gemacht hast.</p>
    ${fld('Datum', `<input class="in" type="date" data-bind="l.date" value="${esc(l.date)}">`)}
    ${isCake(r) ? `<div class="grid2">
      ${fld('Form / Menge', lb('params.pan', l.params.pan ?? '', 'placeholder="z. B. Ø 26 cm"'))}
      ${fldU('Gesamtzeit', lb('params.totalHours', fmtIn(l.params.totalHours, 1), 'inputmode="decimal" data-num'), 'h')}
    </div>` : `<div class="grid2">
      ${fldU('Hydration', lb('params.hydration', fmtIn(l.params.hydration), 'inputmode="decimal" data-num'), '%')}
      ${fldU('Salz', lb('params.salt', fmtIn(l.params.salt), 'inputmode="decimal" data-num'), '%')}
      ${fldU('Hefe gesamt', lb('params.yeastPct', fmtIn(l.params.yeastPct, 3), 'inputmode="decimal" data-num'), '%')}
      ${fld('Vorteig', lb('params.pf', l.params.pf))}
      ${fldU('Anzahl', lb('params.count', fmtIn(l.params.count, 0), 'inputmode="numeric" data-num'), 'Stk')}
      ${fldU('Gewicht', lb('params.pieceWeight', fmtIn(l.params.pieceWeight, 0), 'inputmode="decimal" data-num'), 'g')}
      ${fldU('Gesamtzeit', lb('params.totalHours', fmtIn(l.params.totalHours, 1), 'inputmode="decimal" data-num'), 'h')}
      ${fld('Mehl', lb('params.flour', l.params.flour))}
    </div>`}
    </details>
    <details class="card"><summary>Temperaturen &amp; Ofen <small class="muted">${[l.doughTemp && `Teig ${esc(l.doughTemp)} °C`, l.roomTemp && `Raum ${esc(l.roomTemp)} °C`, l.waterTemp && `Wasser ${esc(l.waterTemp)} °C`, l.iceG && `Eis ${esc(l.iceG)} g`, l.oven && esc(l.oven)].filter(Boolean).join(' · ') || 'optional'}</small></summary>
    ${l.sessionId && (l.doughTemp || l.roomTemp || l.fridgeTemp || l.waterTemp || l.iceG) ? '<p class="muted small" style="margin-top:0">🌡️ Aus den Messwerten des Backvorgangs.</p>' : ''}
    <div class="grid2">
      ${isCake(r) ? '' : fldU('Teig nach Kneten', lb('doughTemp', l.doughTemp, 'inputmode="decimal"'), '°C')}
      ${fldU('Raum', lb('roomTemp', l.roomTemp, 'inputmode="decimal"'), '°C')}
      ${fldU('Kühlschrank', lb('fridgeTemp', l.fridgeTemp, 'inputmode="decimal"'), '°C')}
      ${isCake(r) ? '' : `${fldU('Wassertemperatur', lb('waterTemp', l.waterTemp ?? '', 'inputmode="decimal"'), '°C')}
      ${fldU('davon Eis', lb('iceG', l.iceG ?? '', 'inputmode="decimal"'), 'g')}`}
      ${fld('Ofen', lb('oven', l.oven, `placeholder="${r.category === 'pizza' ? 'z. B. Ooni Koda 16' : r.category === 'bread' ? 'z. B. Backofen + Gusstopf' : 'z. B. Umluft, mittlere Schiene'}"`))}
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
  const c = sess ? sessCalc(sess) : calcFor(r);
  const steps = sess?.steps || r.steps;
  const lastDone = sess ? Math.max(0, ...steps.map((x) => x.doneAt || 0)) : 0;
  const total = sess ? ((lastDone || Date.now()) - sess.startAt) / 60000 : planInfo(steps, 0).total;
  if (c.kind === 'cake') {
    return { hydration: 0, salt: 0, yeastPct: 0, pf: '', count: 0, pieceWeight: 0, totalHours: Math.round((total / 60) * 10) / 10, flour: '',
      pan: C.panLabel(c.pan) || (Math.abs(c.factor - 1) > 0.005 ? `${fmtNum(c.factor, 2)}× Rezept` : '') };
  }
  return {
    pan: '',
    hydration: c.totals.hydration,
    salt: c.totals.flour ? (c.totals.salt / c.totals.flour) * 100 : r.salt,
    yeastPct: c.totals.flour ? Math.round((c.totals.yeast / c.totals.flour) * 100000) / 1000 : 0,
    pf: (r.preferments || []).map((p) => `${p.name} ${fmtNum(p.flourPct, 0)} %`).join(' + ') || 'direkt',
    count: Math.round(c.count * 10) / 10, pieceWeight: c.pieceWeight,
    totalHours: Math.round((total / 60) * 10) / 10,
    // Mehle des Backtags (inkl. im Planer getauschter oder beim Backen dazugemischter Sorten)
    flour: (c.totals.flours || []).filter((f) => f.g > 0.5 && f.name).map((f) => `${f.name} ${fmtNum(f.pct, 0)} %`).join(', ')
      || (r.flours || []).map((f) => f.name).filter(Boolean).join(', '),
  };
}

// ---------- 🫙 Meine Kulturen (Anstellgut, Madre, LiCoLi, Hefewasser …) ----------
const cultById = (id) => S.cultures.find((c) => c.id === id);
const lastFeed = (c) => (c.feeds || []).reduce((m, f) => Math.max(m, f.at), 0) || c.createdAt || 0;
// Tage bis zur nächsten Fütterung (negativ = überfällig); null = kein Rhythmus
const dueDays = (c) => (num(c.days) > 0 ? (lastFeed(c) + c.days * 86400000 - Date.now()) / 86400000 : null);
function dueTxt(c) {
  const d = dueDays(c);
  if (d === null) return '';
  if (d < -0.5) return `füttern fällig seit ${Math.round(-d)} ${Math.round(-d) === 1 ? 'Tag' : 'Tagen'}`;
  if (d < 0.5) return 'heute füttern';
  return `füttern in ${Math.round(d)} ${Math.round(d) === 1 ? 'Tag' : 'Tagen'}`;
}
async function saveCulture(c) {
  c.updatedAt = Date.now();
  c.v = Math.max(MG.SCHEMA, num(c.v));
  const i = S.cultures.findIndex((x) => x.id === c.id);
  if (i >= 0) S.cultures[i] = c; else S.cultures.push(c);
  await db.put('cultures', c);
  scheduleSync();
}
async function addFeed(c, f = {}) {
  c.feeds = [...(c.feeds || []), { at: Date.now(), g: '', temp: null, rise: null, note: '', ...f }].slice(-200);
  await saveCulture(c);
}
// Füttern-Rechner: gewünschte Menge → Anstellgut : Mehl : Wasser
function feedCalc(c, total) {
  const [s, f, w] = c.ratio || [1, 1, 1], sum = s + f + w;
  if (!(sum > 0) || !(total > 0)) return '';
  const g = (x) => fmtG(Math.round((total * x) / sum));
  return `<b>${g(s)}</b> ${c.type === 'madre' ? 'Madre' : 'Anstellgut'} + <b>${g(f)}</b> Mehl + <b>${g(w)}</b> Wasser`;
}
// Karte im Reiter „Backen“ (eingeklappt)
function culturesCard() {
  if (!feat('cultures')) return '';
  const list = S.cultures.slice().sort((a, b) => (dueDays(a) ?? 99) - (dueDays(b) ?? 99));
  const due = list.filter((c) => (dueDays(c) ?? 1) < 0.5).length;
  return `<details class="card cult" ${S.cultOpen || due ? 'open' : ''} data-action-toggle="cult">
    <summary>🫙 Meine Kulturen <small class="muted">${list.length ? `${list.length}${due ? ` · ${due} fällig` : ''}` : 'Anstellgut & Co. pflegen'}</small></summary>
    ${list.map((c) => `<div class="cult-row"><a class="grow" href="#/culture/${c.id}"><b>${C.CULTURE_TYPES[c.type]?.icon || '🧫'} ${esc(c.name || C.CULTURE_TYPES[c.type]?.label)}</b><br><small class="${(dueDays(c) ?? 1) < 0.5 ? 'warnt' : 'muted'}">${dueTxt(c) || 'ohne Rhythmus'} · zuletzt ${lastFeed(c) ? fmtRel(lastFeed(c)) : '–'}</small></a>
      <button class="btn sm" data-action="cultFed" data-id="${c.id}">✓ Gefüttert</button></div>`).join('')}
    <details class="addmore"><summary><span class="btn sm ghost">${icon('plus')} Kultur anlegen</span></summary>
      <div class="chips">${Object.entries(C.CULTURE_TYPES).map(([k, v]) => `<button class="chip" data-action="cultNew" data-v="${k}">${v.icon} ${v.label}</button>`).join('')}</div></details>
  </details>`;
}
// ---------- 🌾 Meine Mehle (ab 2.6) ----------
const flourById = (id) => S.flours.find((f) => f.id === id);
const myF = (name) => (feat('myFlours') ? X.myFlour(name) : null);
// Vorrat & Kosten lassen sich getrennt abschalten (Einstellungen → Funktionen → Meine Mehle)
const stockOn = () => feat('myFlours') && feat('flourStock');
const fColor = (f) => C.FLOUR_COLORS[f?.color] || C.FLOUR_COLORS.gold;
// Farbliche Hervorhebung: Punkt bzw. Rahmen in der Farbe des Mehls
const fDot = (f) => `<i class="fdot" style="--fc:${fColor(f)}" aria-hidden="true"></i>`;
const mineAttr = (name) => { const f = myF(name); return f ? ` mine" style="--fc:${fColor(f)}` : ''; };
const kg = (g) => (num(g) >= 1000 ? `${fmtNum(num(g) / 1000, 2)} kg` : fmtG(num(g)));
const val = (v) => v !== '' && v !== null && v !== undefined;
function flourSum(f) {
  const p = X.flourProps(f.name) || {};
  return [p.w && `W ${fmtNum(p.w, 0)}${f.w === '' ? '*' : ''}`, val(f.protein) && `${fmtNum(f.protein, 1)} % Eiweiß`, stockOn() && val(f.stock) && `🫙 ${kg(f.stock)}`].filter(Boolean).join(' · ');
}
function flourWarn(f) {
  const today = todayISO();
  if (f.bestBefore && f.bestBefore < today) return 'MHD abgelaufen';
  if (f.bestBefore && (new Date(f.bestBefore) - new Date(today)) / 86400000 <= 14) return 'MHD bald erreicht';
  if (stockOn() && val(f.stock) && num(f.stock) < 500) return num(f.stock) <= 0 ? 'leer' : 'Vorrat knapp';
  return '';
}
// Backvorgang abgebrochen/gelöscht, bevor ein Teig gemischt wurde → Mehl wieder dem Vorrat gutschreiben
async function flourGiveBack(s) {
  if (!s?.flourUse?.length || s.flourBack) return;
  if (s.steps.some((x) => x.doneAt && (x.stage || MIX_LIKE.has(x.kind)))) return;
  for (const u of s.flourUse) { const f = flourById(u.id); if (f && val(f.stock)) { f.stock = num(f.stock) + num(u.g); await saveFlour(f); } }
  s.flourBack = true;
  toast('🫙 Mehl wieder im Vorrat gutgeschrieben');
}
async function saveFlour(f) {
  f.updatedAt = Date.now();
  f.v = Math.max(MG.SCHEMA, num(f.v));
  const i = S.flours.findIndex((x) => x.id === f.id);
  if (i >= 0) S.flours[i] = f; else S.flours.push(f);
  X.setMyFlours(feat('myFlours') ? S.flours : []);
  await db.put('flours', f);
  scheduleSync();
}
// Karte im Reiter „Backen“ (eingeklappt)
function floursCard() {
  if (!feat('myFlours')) return '';
  const list = S.flours.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  const warn = list.filter(flourWarn).length;
  return `<details class="card cult" ${S.flourOpen ? 'open' : ''} data-action-toggle="flours">
    <summary>🌾 Meine Mehle <small class="muted">${list.length ? `${list.length}${warn ? ` · ${warn} Hinweis${warn > 1 ? 'e' : ''}` : ''}` : 'Mehlsorten mit Packungsangaben'}</small></summary>
    ${list.map((f) => `<a class="cult-row flour-row" href="#/flour/${f.id}" style="--fc:${fColor(f)}">${fDot(f)}<span class="grow"><b>${esc(f.name || 'Ohne Namen')}</b>${f.brand ? ` <small class="muted">${esc(f.brand)}</small>` : ''}<br><small class="muted">${flourSum(f) || 'noch keine Kennwerte'}</small></span>${flourWarn(f) ? `<span class="pill warnp">${flourWarn(f)}</span>` : ''}</a>`).join('')}
    <button class="btn sm ghost" data-action="flourNew">${icon('plus')} Mehl anlegen</button>
    ${list.length ? '' : '<p class="muted small">Trage deine Mehle mit den Angaben von der Packung ein (W-Wert, Eiweiß, Wasseraufnahme …). Alles ist freiwillig – die App rechnet mit dem, was da ist, und hebt deine Mehle in Rezepten farbig hervor.</p>'}
  </details>`;
}
function vFlour(id) {
  const f = flourById(id);
  if (!f) return vNotFound();
  const p = X.flourProps(f.name) || {};
  const inp = (k, unit, label, hint = '', ph = '') => fldU(label, `<input class="in" inputmode="decimal" data-change="flour" data-id="${f.id}" data-k="${k}" value="${val(f[k]) ? fmtIn(f[k], 2) : ''}" placeholder="${esc(ph)}">`, unit, hint);
  const st = X.flourStats(f, S.logs, S.recipes);
  const used = S.recipes.filter((r) => (r.flours || []).some((x) => C.sameName(x.name, f.name)));
  const maxH = p.w ? X.maxHoursForW(p.w) : null;
  // Was die App aus den Angaben ableitet (ohne Angaben: Richtwerte der Sorte)
  const derived = [
    p.w ? `<li><b>Backstärke W ≈ ${fmtNum(p.w, 0)}</b> <small class="muted">(${esc(p.wSrc)})</small> → verträgt etwa <b>${maxH} h</b> Gärzeit (Stunden im Kühlschrank zählen dabei nur halb).</li>` : p.rye ? '<li><b>Roggen:</b> kaum Kleber – das Gerüst bilden Schleimstoffe und Säure. Ohne Sauerteig wird die Krume oft klitschig.</li>' : '',
    p.cap ? `<li><b>Wasser:</b> gut verträglich bis ca. <b>${fmtNum(p.cap, 0)} %</b>, empfohlen ca. ${fmtNum(p.cap - 2, 0)} % <small class="muted">(${esc(p.capSrc)})</small>.</li>` : '',
    p.pl !== null && p.pl !== undefined ? `<li><b>P/L ${fmtNum(p.pl, 2)}:</b> ${p.pl > 0.8 ? 'zäh-elastisch – Teigling länger entspannen lassen, ideal für lange Führung.' : p.pl < 0.4 ? 'sehr dehnbar – straff formen, Stückgare kürzer.' : 'ausgewogen zwischen Stand und Dehnbarkeit.'}</li>` : '',
    p.falling !== null && p.falling !== undefined ? `<li><b>Fallzahl ${fmtNum(p.falling, 0)} s:</b> ${p.falling < 220 ? 'viel Enzymaktivität – bei langer Gare wird der Teig weich; kürzer/kälter führen.' : p.falling > 380 ? 'wenig Enzyme – Kruste bräunt schwächer; etwas Backmalz hilft.' : 'normale Enzymaktivität.'}</li>` : '',
  ].filter(Boolean).join('');
  const html = `
  <header class="top sub"><a class="icon-btn" href="#/bake" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">🌾 Meine Mehle${f.kind ? ` · ${esc(C.FLOUR_KINDS[f.kind])}` : ''}</div><h1 class="title sm">${fDot(f)} ${esc(f.name || 'Neues Mehl')}</h1></div>
    <button class="icon-btn" data-action="flourDel" data-id="${f.id}" aria-label="Mehl löschen">${icon('trash')}</button></header>
  <div class="pad">
    <section class="card">
      ${fld('Name', `<input class="in" data-change="flour" data-id="${f.id}" data-k="name" value="${esc(f.name)}" placeholder="z. B. Caputo Nuvola" list="flour-lib">`, 'So erscheint es in Rezepten und beim Backen')}
      <datalist id="flour-lib">${X.FLOUR_NAMES.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="grid2">
        ${fld('Hersteller', `<input class="in" data-change="flour" data-id="${f.id}" data-k="brand" value="${esc(f.brand)}" placeholder="optional">`)}
        ${fld('Sorte', `<select class="in" data-change="flour" data-id="${f.id}" data-k="kind"><option value="">–</option>${Object.entries(C.FLOUR_KINDS).map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
      </div>
      <div class="fcolors">${Object.entries(C.FLOUR_COLORS).map(([k, c]) => `<button class="fcol ${f.color === k ? 'on' : ''}" style="--fc:${c}" data-action="flourColor" data-id="${f.id}" data-v="${k}" aria-label="Farbe ${k}"></button>`).join('')}<small class="muted">Farbe in Rezepten</small></div>
    </section>
    <section class="card">
      <div class="card-h"><b>🔬 Kennwerte von der Packung</b><small class="muted">alle freiwillig</small></div>
      <div class="grid2">
        ${inp('w', 'W', 'Backstärke', 'Alveograph', p.w && !val(f.w) ? `≈ ${fmtNum(p.w, 0)}` : '')}
        ${inp('protein', '%', 'Eiweiß', 'Proteingehalt')}
        ${inp('absorption', '%', 'Wasseraufnahme', 'Farinograph')}
        ${inp('pl', 'P/L', 'Elastizität', 'Alveograph')}
        ${inp('falling', 's', 'Fallzahl', 'Enzymaktivität')}
      </div>
      <details class="info"><summary>ⓘ Was bedeuten die Werte?</summary>
        <p><b>W</b> (Backstärke): Energie, um eine Teigblase zu dehnen. Je höher, desto länger hält der Kleber. Unter 200 nur kurze Führungen, 280–320 für 24–48 h, über 350 für Biga und sehr lange Gare.</p>
        <p><b>Eiweiß</b>: ein Großteil davon bildet den Kleber. Ohne W-Wert schätzt die App ihn daraus (W ≈ 40 × Eiweiß − 210).</p>
        <p><b>Wasseraufnahme</b>: wie viel Wasser das Mehl für einen Standardteig bindet. Handwerkliche Teige vertragen meist ca. 5–10 %-Punkte mehr.</p>
        <p><b>P/L</b>: Zähigkeit zu Dehnbarkeit. Um 0,5–0,6 ausgewogen (Pizza), höher = elastisch, niedriger = sehr dehnbar.</p>
        <p><b>Fallzahl</b>: Maß für stärkeabbauende Enzyme. Niedrig (&lt; 220 s) = viel Enzym, Teig wird bei langer Gare weich; hoch (&gt; 350 s) = blasse Kruste.</p></details>
      ${derived ? `<div class="derived"><div class="card-h"><b>🧠 Was die App daraus ableitet</b></div><ul>${derived}</ul></div>` : ''}
    </section>
    <section class="card">
      <div class="card-h"><b>${stockOn() ? '🫙 Vorrat, Preis & Haltbarkeit' : '📅 Haltbarkeit'}</b>${flourWarn(f) ? `<span class="pill warnp">${flourWarn(f)}</span>` : ''}</div>
      ${stockOn() ? `<div class="grid2">
        ${inp('stock', 'g', 'Vorrat', 'wird beim Backen abgezogen')}
        ${inp('price', '€/kg', 'Preis')}
      </div>
      <div class="chips"><button class="chip" data-action="flourStock" data-id="${f.id}" data-d="1000">+1 kg</button><button class="chip" data-action="flourStock" data-id="${f.id}" data-d="5000">+5 kg</button><button class="chip" data-action="flourStock" data-id="${f.id}" data-d="25000">+25 kg Sack</button></div>` : ''}
      ${fld('Mindestens haltbar bis', `<input class="in" type="date" data-change="flour" data-id="${f.id}" data-k="bestBefore" value="${esc(f.bestBefore)}">`)}
    </section>
    <section class="card">
      <div class="card-h"><b>📓 Im Tagebuch</b></div>
      ${st.count ? `<div class="lv-tiles">
        <div class="lv-tile"><small>Backtage</small><b>${st.count}</b>${st.last ? `<small>zuletzt ${fmtDate(st.last)}</small>` : ''}</div>
        <div class="lv-tile"><small>Ø Bewertung</small><b>${st.avg ? `${fmtNum(st.avg, 1)} ★` : '–'}</b></div>
        ${st.sweet ? `<div class="lv-tile"><small>Sweet Spot (ab 4 ★)</small><b>${st.sweet[0] === st.sweet[1] ? fmtPct(st.sweet[0]) : `${fmtNum(st.sweet[0], 1)}–${fmtPct(st.sweet[1])}`}</b><small>Hydration</small></div>` : ''}
      </div>` : '<p class="muted small">Noch keine Backtage mit diesem Mehl.</p>'}
      ${used.length ? `<p class="small">In Rezepten: ${used.map((r) => `<a href="#/r/${r.id}">${esc(r.name)}</a>`).join(', ')}</p>` : ''}
    </section>
    ${fld('Notizen', `<textarea class="in" rows="2" data-change="flour" data-id="${f.id}" data-k="notes" placeholder="z. B. Bezugsquelle, Erfahrungen">${esc(f.notes)}</textarea>`)}
  </div>`;
  return { html };
}
function cultureHint() {
  if (!feat('cultures')) return '';
  const c = S.cultures.find((x) => (dueDays(x) ?? 1) < -0.5 && !(S.settings.cultSnooze?.[x.id] > Date.now()));
  return c ? `<div class="hint-card"><div>🫙 <b>${esc(c.name)}</b> – ${dueTxt(c)}</div><div class="row gap"><button class="btn sm primary" data-action="cultFed" data-id="${c.id}">✓ Gefüttert</button><button class="icon-btn x-btn" data-action="cultSnooze" data-id="${c.id}" aria-label="Morgen erinnern">${icon('x')}</button></div></div>` : '';
}
function vCulture(id) {
  const c = cultById(id);
  if (!c) return vNotFound();
  const t = C.CULTURE_TYPES[c.type] || C.CULTURE_TYPES.custom, yw = c.type === 'yeastwater';
  const inp = (k, val, unit, label, w = '') => fldU(label, `<input class="in ${w}" inputmode="decimal" data-change="cult" data-id="${c.id}" data-k="${k}" value="${val === '' || val === null || val === undefined ? '' : fmtIn(val, 2)}">`, unit);
  const feeds = (c.feeds || []).slice().reverse();
  const html = `
  <header class="top sub"><a class="icon-btn" href="#/bake" aria-label="Zurück">${icon('back')}</a><div class="grow"><div class="eyebrow">🫙 Meine Kulturen · ${esc(t.label)}</div><h1 class="title sm">${esc(c.name || t.label)}</h1></div>
    <button class="icon-btn" data-action="cultDel" data-id="${c.id}" aria-label="Kultur löschen">${icon('trash')}</button></header>
  <div class="pad">
    <div class="big-result small"><div class="br-k">${dueTxt(c) || 'Kein Rhythmus eingestellt'}</div><div class="br-s">zuletzt gefüttert ${lastFeed(c) ? fmtRel(lastFeed(c)) : '–'}</div></div>
    <section class="card">
      <div class="card-h"><b>✓ Gefüttert</b><small class="muted">optional: Details</small></div>
      <div class="grid2">
        ${fldU('Temperatur', '<input class="in" inputmode="decimal" id="cf-temp" placeholder="z. B. 24">', '°C')}
        ${fldU('Verdoppelt nach', '<input class="in" inputmode="decimal" id="cf-rise" placeholder="z. B. 6">', 'h')}
      </div>
      ${fld('Notiz', '<input class="in" id="cf-note" placeholder="z. B. riecht säuerlich, sehr aktiv">')}
      <button class="btn primary block" data-action="cultFedSave" data-id="${c.id}">${icon('check')} Jetzt gefüttert</button>
    </section>
    ${yw ? '' : `<section class="card">
      <div class="card-h"><b>🧮 Füttern-Rechner</b><small class="muted">${c.ratio.map((x) => fmtNum(x, 2)).join(' : ')}</small></div>
      ${fldU('Ich brauche insgesamt', `<input class="in" inputmode="decimal" data-input="cultCalc" data-id="${c.id}" value="${S.cultNeed || ''}" placeholder="z. B. 70 fürs Rezept + 20 Rest">`, 'g')}
      <div class="result" id="cult-calc">${feedCalc(c, num(S.cultNeed)) || '<span class="muted">Menge eingeben – z. B. was das Rezept braucht plus etwas Rest zum Weiterführen.</span>'}</div>
    </section>`}
    <details class="card"><summary>⚙️ Einstellungen <small class="muted">${c.days ? `alle ${c.days} Tage` : 'ohne Rhythmus'} · ${c.place === 'rt' ? 'Raum' : 'Kühlschrank'}</small></summary>
      ${fld('Name', `<input class="in" data-change="cult" data-id="${c.id}" data-k="name" value="${esc(c.name)}">`)}
      <div class="grid2">
        ${inp('days', c.days, 'Tage', 'Füttern alle')}
        ${inp('lead', c.lead, 'h', 'Auffrischen vor dem Backen')}
        ${yw ? '' : `${inp('r0', c.ratio[0], 'Teil', 'Anstellgut')}${inp('r1', c.ratio[1], 'Teile', 'Mehl')}${inp('r2', c.ratio[2], 'Teile', 'Wasser')}`}
      </div>
      <div class="seg small">${[['fridge', '❄️ Kühlschrank'], ['rt', '🏠 Raum']].map(([k, l]) => `<button class="${c.place === k ? 'on' : ''}" data-action="cultPlace" data-id="${c.id}" data-v="${k}">${l}</button>`).join('')}</div>
      ${fld('Notizen', `<textarea class="in" rows="2" data-change="cult" data-id="${c.id}" data-k="notes" placeholder="z. B. Mehlsorte, Herkunft">${esc(c.notes)}</textarea>`)}
      ${yw ? '<p class="muted small">Hefewasser: Wasser und etwas Zucker/Honig bzw. Obst nachfüttern, offen gären lassen, Deckel täglich lüften.</p>' : ''}
      <button class="btn sm" data-action="cultIcs" data-id="${c.id}">${icon('cal')} Erinnerung in Kalender (wiederkehrend)</button>
    </details>
    ${feeds.length ? `<h3 class="sec">Fütterungen</h3><div class="card">${feeds.slice(0, 15).map((f) => `<div class="row between cult-feed"><span>${fmtRel(f.at)}${f.note ? ` · ${esc(f.note)}` : ''}</span><small class="muted">${[f.temp !== null && f.temp !== undefined ? `${fmtNum(f.temp)} °C` : '', f.rise ? `×2 nach ${fmtNum(f.rise)} h` : ''].filter(Boolean).join(' · ')}</small></div>`).join('')}</div>` : ''}
  </div>`;
  return { html };
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
    <details class="card fun" ${S.funOpen ? 'open' : ''} data-action-toggle="fun">
      <summary><b>🧩 Funktionen</b> <small class="muted">${FEATURES.filter(feat).length} von ${FEATURES.length} an · antippen zum Ändern</small></summary>
      <div class="set-group">Beim Backen</div>
      ${toggle('tempComp', '🌡️ Temperatur-Ausgleich', 'Passt Gare-Zeiten an die Raumtemperatur an (+4 °C ≈ 30 % kürzer).')}
      ${feat('tempComp') ? `<div class="sub-opt">${fldU('Rezepte sind ausgelegt für', `<input class="in" inputmode="decimal" data-bind="set.refRoom" data-num value="${fmtIn(st.refRoom, 1)}">`, '°C', 'Gilt, wenn im Schritt keine Temperatur steht.')}</div>` : ''}
      ${toggle('handsFree', '🙌 Teighände-Modus', 'Große Ansicht zum Bedienen mit Teig an den Fingern.')}
      ${feat('handsFree') ? `<div class="sub-opt">${toggle('voice', '🔊 Sprachansagen', 'Sagt im Teighände-Modus den nächsten Schritt an.')}${toggle('wakeLock', '💡 Bildschirm anlassen', 'Verhindert im Teighände-Modus das Abschalten des Displays.')}</div>` : ''}
      ${toggle('confirmEarly', '⏳ Vorzeitiges Weiter bestätigen', 'Fragt nach, wenn ein Schritt noch läuft und du schon weiter tippst.')}
      ${toggle('adjust', '🎨 Anpassen beim Backen', 'Zutaten während des Backens ändern – mit Hydration live und Übernahme ins Rezept.')}
      ${toggle('nightOpt', '🪄 Nachtruhe-Optimierer', 'Schlägt angepasste Kühlschrankzeiten vor.')}
      ${toggle('yeastFit', '🧪 Gärzeit & Hefe', 'Im Planer Gärzeiten ändern – die Hefemenge passt sich an.')}
      <div class="set-row"><span><b>🌙 Nachtruhe</b><br><small class="muted">Planer warnt in dieser Zeit</small></span>
        <span class="row gap"><select class="in" style="width:auto" data-bind="set.nightFrom" data-num aria-label="Nachtruhe von">${hours.map((h) => `<option value="${h}" ${st.nightFrom === h ? 'selected' : ''}>${p2(h)}:00</option>`).join('')}</select>–<select class="in" style="width:auto" data-bind="set.nightTo" data-num aria-label="Nachtruhe bis">${hours.map((h) => `<option value="${h}" ${st.nightTo === h ? 'selected' : ''}>${p2(h)}:00</option>`).join('')}</select></span></div>
      <div class="set-group">Rezepte</div>
      ${toggle('pastry', '🥐 Feingebäck & Kuchen', 'Vorlagen und Kategorien für Croissant, Plunder, Hefeteig, Kuchen und Torten. Vorhandene Rezepte bleiben immer sichtbar.')}
      ${toggle('cultures', '🫙 Meine Kulturen', 'Anstellgut, Madre, LiCoLi & Co. pflegen – Fütter-Erinnerung, Rechner und Auffrischen vor dem Backtag.')}
      ${toggle('myFlours', '🌾 Meine Mehle', 'Eigene Mehlsorten mit Packungsangaben – farbig in Rezepten, mit Auswirkung auf Ampel und Planer.')}
      ${feat('myFlours') ? `<div class="sub-opt">${toggle('flourStock', '🫙 Vorrat & Kosten', 'Mehlvorrat beim Backen abziehen, warnen wenn er nicht reicht, Mehlkosten im Planer zeigen.')}</div>` : ''}
      ${toggle('convert', '🔁 Hefe ⇄ Sauerteig umstellen', 'Rezept als Variante auf Sauerteig, Lievito Madre oder Hefe umstellen.')}
      ${toggle('flourAmp', '🚦 Mehl-Ampel', 'Prüft, ob das Mehl zu Hydration, Gärzeit, Roggenanteil und Butter/Zucker passt.')}
      <div class="set-group">Teilen</div>
      ${toggle('qr', '🔳 Teilen per QR-Code', 'Rezepte als QR-Code zeigen und empfangen.')}
    </details>
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
    ${s.cultureSql ? '<div class="warn">🫙 „Meine Kulturen“ werden noch nicht abgeglichen: In Supabase einmal das aktuelle <b>supabase-setup.sql</b> ausführen (siehe ANLEITUNG-UPDATE.txt). Rezepte und Tagebuch laufen normal weiter.</div>' : ''}
    ${s.flourSql ? '<div class="warn">🌾 „Meine Mehle“ werden noch nicht abgeglichen: In Supabase einmal das aktuelle <b>supabase-setup.sql</b> ausführen (siehe ANLEITUNG-UPDATE.txt). Alles andere läuft normal weiter.</div>' : ''}
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
        cleanCulture: (x) => { const m = MG.importCulture(x); if (m.newer) newer++; return m.rec; },
        cleanFlour: (x) => { const m = MG.importFlour(x); if (m.newer) newer++; return m.rec; },
      });
      await reload();
      S.scale = null; S.plan = null;
      scheduleSync(500);
      const open = S.recipes.filter((r) => MG.openQuestions(r).length).length;
      toast(`✓ Importiert: ${res.recipes} Rezepte, ${res.logs} Einträge${res.cultures ? `, ${res.cultures} Kulturen` : ''}${res.flours ? `, ${res.flours} Mehle` : ''}, ${res.photos} Fotos${res.skipped ? ` (${res.skipped} neuere behalten)` : ''}`, 4000);
      if (newer) alert('Diese Sicherung stammt aus einer neueren Teigbuch-Version.\n\nDie Daten wurden vollständig übernommen. Bitte aktualisiere die App, damit alle Angaben genutzt werden können.');
      if (open) { location.hash = '#/fix'; return; }
      render();
    } catch (e) { toast('Import fehlgeschlagen: ' + e.message, 4000); }
  };
  inp.click();
}

function recipeText(r) {
  const c = calcFor(r);
  const lines = [`${catOf(r.category).icon} ${r.name}`, r.description || '', ''];
  if (c.kind === 'cake') {
    if (C.panLabel(r.pan)) lines.push(`Form: ${C.panLabel(r.pan)}`, '');
    c.parts.forEach((p) => { lines.push(`— ${p.name || 'Zutaten'} —`); cakeRows(p).forEach((row) => lines.push(`${row.name}: ${row.txt}`)); lines.push(''); });
  } else {
    lines.push(`Menge: ${r.yield.mode === 'flour' ? fmtG(c.F) + ' Mehl' : `${fmtNum(c.count, 0)} × ${fmtNum(c.pieceWeight, 0)} g`} · Hydration ${fmtPct(c.totals.hydration)}`, '');
    c.pfs.forEach((x) => { lines.push(`— ${x.pf.name} —`); pfRows(x, r.yeastType).forEach((row) => lines.push(`${row.name}: ${fmtG(row.g)}`)); lines.push(''); });
    lines.push(c.lam.g > 0 ? '— Grundteig —' : '— Hauptteig —');
    mainRows(c, r.yeastType).forEach((row) => lines.push(`${row.name}: ${fmtG(row.g)}`));
    if (c.lam.g > 0) lines.push('', '— Ziehfett —', `${c.lam.name}: ${fmtG(c.lam.g)}`);
  }
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
    const r = p.r, c = calcFor(r), info = planInfo(r.steps, 0);
    body = `<section class="card">
      <div class="eyebrow">${catOf(r.category).icon} ${catOf(r.category).label}</div>
      <h2 class="title sm">${esc(r.name)}</h2>
      ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
      <div class="pchips">
        ${c.kind === 'cake' ? `${C.panLabel(r.pan) ? `<span class="pchip">⭕ ${esc(C.panLabel(r.pan))}</span>` : ''}<span class="pchip">⚖️ ≈ ${fmtG(c.total)}</span>` : `
        <span class="pchip">💧 ${fmtPct(c.totals.hydration)}</span>
        <span class="pchip">🧱 ${pfLabel(r.preferments)}</span>
        <span class="pchip">⚖️ ${r.yield.mode === 'flour' ? fmtG(c.F) + ' Mehl' : `${fmtNum(c.count, 0)} × ${fmtNum(c.pieceWeight, 0)} g`}</span>`}
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
// Kopie eines Rezepts als eigene Variante (neue IDs; Fotos NICHT mitkopieren – sonst würde das Löschen
// der Variante die Fotos des Originals löschen)
function asVariant(r, suffix) {
  const c = structuredClone(r);
  Object.assign(c, { id: uid(), name: r.name + suffix, createdAt: Date.now(), updatedAt: Date.now(), favorite: false, photos: [], cover: null });
  c.preferments.forEach((pf) => { const old = pf.id; pf.id = uid(); c.steps.forEach((s) => { if (s.stage === old) s.stage = pf.id; }); c.preferments.forEach((q) => { if (q.starterFrom === old) q.starterFrom = pf.id; }); });
  c.steps.forEach((s) => { s.id = uid(); });
  return c;
}
// 🔁 Hefe ⇄ Sauerteig: Ziel wählen → Vorschau der Änderungen → als neue Variante anlegen
const CONVERT_LABEL = { levain: ['🌾 Auf Sauerteig umstellen', ' (Sauerteig)'], madre: ['🫙 Auf Lievito Madre umstellen', ' (Madre)'], yeast: ['🧈 Auf Hefe umstellen', ' (Hefe)'] };
function convertMenu(r) {
  const opts = C.convertOptions(r), sour = (r.preferments || []).some((p) => ['levain', 'madre'].includes(p.type));
  sheet('Rezept umstellen', opts.map((to) => ({ label: to === 'levain' && sour ? '🌾 Hefe weglassen (nur Sauerteig)' : CONVERT_LABEL[to][0], run: () => convertPreview(r, to) })),
    'Es entsteht eine <b>neue Variante</b> – das Original bleibt unverändert.');
}
function convertPreview(r, to) {
  const { recipe, changes } = C.convertRecipe(r, to);
  sheet(CONVERT_LABEL[to][0].replace(/^\S+\s/, ''), [{ label: 'Variante anlegen', icon: 'copy', primary: true, run: async () => {
    const c = asVariant(recipe, CONVERT_LABEL[to][1]);
    c.name = r.name + CONVERT_LABEL[to][1];
    await saveRecipe(c);
    location.hash = `#/r/${c.id}`;
    toast('✓ Variante angelegt – Zeiten beim ersten Backen gut beobachten', 4500);
  } }], `<ul class="conv-list">${changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted small">Faustregel-Vorschlag – im Editor jederzeit änderbar.</p>`);
}
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
  // Erst warten, bis das Schließen des Menüs im Verlauf angekommen ist – sonst würde ein „Zurück“
  // eine Navigation der gewählten Aktion (z. B. zur neuen Variante) gleich wieder rückgängig machen
  sheetPick: async (el) => {
    const it = S.sheetItems[+el.dataset.i], had = !!history.state?.sheet;
    closeSheet();
    if (had) await new Promise((res) => { const t = setTimeout(res, 400); window.addEventListener('popstate', () => { clearTimeout(t); setTimeout(res, 0); }, { once: true }); });
    it?.run();
  },
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
        const c = asVariant(r, ' (Variante)');
        await saveRecipe(c); location.hash = `#/edit/${c.id}`;
      } },
      ...(feat('convert') && C.convertOptions(r).length ? [{ label: '🔁 Umstellen: Hefe ⇄ Sauerteig', run: () => convertMenu(r) }] : []),
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
  scaleSave: async () => {
    const r = S.scale && byId(S.scale.id);
    if (!r) return render();
    if (isCake(r)) {
      // Kuchen dauerhaft auf eine andere Form umrechnen: alle Mengen × Faktor, neue Form als Rezept-Form
      const c = C.calcCake(r, cakeOv(S.scale));
      if (!C.panValid(c.pan) || !confirm(`Rezept dauerhaft auf ${C.panLabel(c.pan)} umrechnen?\n\nAlle Mengen werden mit ${fmtNum(c.factor, 2)} multipliziert.`)) return;
      const rnd = (v, unit) => (unit === 'g' || unit === 'ml' ? (v < 20 ? Math.round(v * 10) / 10 : Math.round(v)) : Math.round(v * 100) / 100);
      r.parts.forEach((p) => p.items.forEach((it) => { if (num(it.amount) > 0) it.amount = rnd(num(it.amount) * c.factor, it.unit); }));
      r.pan = { ...r.pan, shape: c.pan.shape, d: num(c.pan.d), l: num(c.pan.l), w: num(c.pan.w), n: num(c.pan.n) };
      await saveRecipe(r); S.scale = null; S.plan = null; toast(`✓ Rezept auf ${C.panLabel(r.pan)} umgerechnet`); render();
      return;
    }
    r.yield = { ...S.scale.yield }; await saveRecipe(r); S.plan = null; toast('✓ Menge gespeichert'); render();
  },
  // Kuchen: Umrechnen nach Backform oder Faktor (t = 'scale' für die Rezeptseite, 'plan' für den Planer)
  cMode: (el) => {
    const t = el.dataset.t, st = cakeState(t), r = byId(t === 'plan' ? S.plan?.id : S.scale?.id);
    if (!st || !r) return render();
    st.cmode = el.dataset.v;
    if (st.cmode === 'pan' && !C.panValid(st.pan)) st.pan = { ...r.pan };
    if (t === 'scale') S.plan = null;
    render();
  },
  cShape: (el) => {
    const t = el.dataset.t, st = cakeState(t), r = byId(t === 'plan' ? S.plan?.id : S.scale?.id);
    if (!st || !r) return render();
    const v = el.dataset.v;
    st.pan = r.pan.shape === v ? { ...r.pan } : v === 'round' ? { shape: 'round', d: 26, l: 0, w: 0, n: 0 } : { shape: 'rect', d: 0, l: 30, w: 20, n: 0 };
    if (t === 'scale') S.plan = null;
    render();
  },
  cPreset: (el) => {
    const t = el.dataset.t, st = cakeState(t);
    if (!st) return render();
    if (el.dataset.f) { st.cmode = 'factor'; st.factor = +el.dataset.f; }
    else { st.cmode = 'pan'; st.pan = { shape: el.dataset.shape, d: +el.dataset.d || 0, l: +el.dataset.l || 0, w: +el.dataset.w || 0, n: 0 }; }
    if (t === 'scale') S.plan = null;
    render();
  },

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
      location.replace('#/edit/new');
      toast(warnings.length ? `✓ Rezept erkannt – ${warnings[0]}` : '✓ Rezept erkannt – bitte kurz prüfen und speichern', warnings.length ? 6000 : 3500);
    } catch (e) { k.error = e.message; render(); }
  },
  pickTpl: (el) => { const t = TEMPLATES.find((x) => x.id === el.dataset.t); discardDraft(); S.draft = t.build(); startDraft(); },
  pickBlank: (el) => { discardDraft(); S.draft = C.blankRecipe(el.dataset.c); startDraft(); },
  // Editor-Schritte landen im Verlauf → die Zurück-Taste geht einen Schritt zurück statt aus dem Editor
  wizGo: (el) => { S.wiz = +el.dataset.i; history.pushState({ wiz: S.wiz, n: (history.state?.n || 0) + 1 }, ''); render(); },
  wizNext: () => { S.wiz = Math.min(wizFor(S.draft).t.length - 1, S.wiz + 1); history.pushState({ wiz: S.wiz, n: (history.state?.n || 0) + 1 }, ''); render(); },
  wizPrev: () => { if (history.state?.wiz !== undefined) history.back(); else { S.wiz = Math.max(0, S.wiz - 1); render(); } },
  editCancel: async () => {
    if (!confirm('Änderungen verwerfen?')) return;
    const id = S.draft?.id, wasNew = S.draft?._new;
    discardDraft();
    location.hash = wasNew || !id ? '#/' : `#/r/${id}`;
  },
  editSave: async () => {
    const d = S.draft;
    d.name = (d.name || '').trim() || ({ bread: 'Neues Brot', fine: 'Neues Feingebäck', cake: 'Neuer Kuchen', other: 'Neues Rezept' }[d.category] || 'Neue Pizza');
    d.tags = (d._tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const removed = (S.draftOrig?.photos || []).filter((p) => !(d.photos || []).includes(p));
    delete d._new; delete d._tags;
    for (const p of removed) await db.deletePhoto(p);
    await saveRecipe(d);
    S.draft = null; S.scale = null; S.plan = null; S.draftNewPhotos = [];
    toast('✓ Rezept gespeichert');
    leaveTo(`#/r/${d.id}`, S.editFrom, history.state?.n || 0); // Editor verschwindet aus dem Verlauf
  },
  setCat: (el) => {
    const d = S.draft, to = el.dataset.v;
    if (to === d.category) return;
    if (to === 'cake' && !isCake(d)) {
      // Wechsel zu Kuchen: Mengen einmalig als Zutatenliste übernehmen (Bäckerprozente bleiben unverändert erhalten)
      if (!(d.parts || []).some((p) => p.items?.length)) {
        const c = calc(d), it = [];
        const add = (name, g, unit = 'g') => { if (g > 0.05) it.push({ name, amount: g < 20 ? Math.round(g * 10) / 10 : Math.round(g), unit }); };
        c.totals.flours.forEach((f) => add(f.name, f.g));
        add('Wasser', c.totals.water, 'ml'); add('Salz', c.totals.salt); add(yeastName(d.yeastType), c.totals.yeast); add('Öl', c.totals.oil);
        c.main.extras.forEach((e) => add(e.name || 'Zutat', e.total ?? e.g)); add(c.lam.name, c.lam.g);
        c.pfs.filter((x) => x.seeds).forEach((x) => { add(x.flourName || 'Saaten', x.flour); add('Wasser (Quellstück)', x.water, 'ml'); });
        d.parts = [{ id: uid(), name: 'Teig', items: it }];
      }
      if (!C.panValid(d.pan)) d.pan = { shape: 'round', d: 26, l: 0, w: 0, n: 0 };
      // Schritte zeigen jetzt die Zutaten des Kuchen-Teils statt „Hauptteig“
      d.steps.forEach((s) => { if (s.stage === 'main') s.stage = d.parts[0].id; else if (s.stage && !d.parts.some((p) => p.id === s.stage)) s.stage = null; });
    } else if (isCake(d) && to !== 'cake') {
      if (!(d.flours || []).length) Object.assign(d, { flours: [{ name: 'Weizenmehl 550', pct: 100 }], yield: { mode: 'pieces', count: 1, pieceWeight: 500, flour: 300, loss: 0 }, water: { pct: 60, temp: '', icePct: '' }, salt: 2 });
      d.steps.forEach((s) => { if (s.stage && d.parts.some((p) => p.id === s.stage)) s.stage = null; });
      if (d.parts.some((p) => p.items?.length)) toast('Die Kuchen-Zutatenliste bleibt gespeichert, wird bei dieser Art aber nicht verwendet.', 4500);
    }
    d.category = to;
    render();
  },
  setPanShape: (el) => {
    const p = S.draft.pan ||= {}, v = el.dataset.v;
    p.shape = v;
    if (v === 'round' && !(num(p.d) > 0)) p.d = 26;
    if (v === 'rect' && !(num(p.l) > 0 && num(p.w) > 0)) Object.assign(p, { l: 30, w: 20 });
    if (v === 'count' && !(num(p.n) > 0)) p.n = 12;
    render();
  },
  setPan: (el) => { Object.assign(S.draft.pan, { shape: el.dataset.shape, d: +el.dataset.d || S.draft.pan.d || 0, l: +el.dataset.l || 0, w: +el.dataset.w || 0 }); render(); },
  addPart: (el) => { S.draft.parts.push({ id: uid(), name: el.dataset.v, items: [] }); render(); },
  delPart: (el) => {
    const d = S.draft, p = d.parts[+el.dataset.i];
    if (p.items?.length && !confirm(`„${p.name || 'Bestandteil'}“ mit ${p.items.length} Zutaten entfernen?`)) return;
    d.parts.splice(+el.dataset.i, 1);
    d.steps.forEach((s) => { if (s.stage === p.id) s.stage = null; });
    render();
  },
  addItem: (el) => { S.draft.parts[+el.dataset.p].items.push({ name: el.dataset.v, amount: 0, unit: el.dataset.u || 'g' }); render(); },
  delItem: (el) => { S.draft.parts[+el.dataset.p].items.splice(+el.dataset.i, 1); render(); },
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
    if (el.dataset.v === 'dampfl') dampflYeast(d, pf);
    d.preferments.push(pf);
    render();
  },
  delPf: (el) => {
    const d = S.draft, pf = d.preferments[+el.dataset.i];
    d.preferments.splice(+el.dataset.i, 1);
    d.steps.forEach((s) => { if (s.stage === pf.id) s.stage = null; });
    d.preferments.forEach((p) => { if (p.starterFrom === pf.id) p.starterFrom = ''; });
    render();
  },
  pfType: (el) => {
    const pf = S.draft.preferments[+el.dataset.i], t = PF_TYPES[el.dataset.v];
    const wasDefaultName = Object.values(PF_TYPES).some((x) => x.label === pf.name);
    Object.assign(pf, { type: el.dataset.v, hydration: t.hydration, yeastPct: t.yeastPct, starterPct: t.starterPct || 0, starterHydration: t.starterHydration || 100,
      liquid: t.liquid || 'water', saltPct: t.saltPct || 0, seeds: false });
    // Tangzhong & Co. sind deutlich kleiner als Biga/Poolish – typischen Anteil übernehmen
    if (['dampfl', 'tangzhong', 'yudane', 'quell', 'pate'].includes(el.dataset.v)) pf.flourPct = t.flourPct;
    if (el.dataset.v === 'dampfl') dampflYeast(S.draft, pf);
    if (wasDefaultName) pf.name = t.label;
    render();
  },
  pfLiquid: (el) => {
    const d = S.draft, pf = d.preferments[+el.dataset.i];
    pf.liquid = el.dataset.v;
    if (pf.liquid === 'mix' && !(num(pf.milkShare) > 0)) pf.milkShare = 50;
    ensurePfLiquid(d, +el.dataset.i);
    render();
  },
  // Mehlmischung im Vorteig (z. B. Biga 80 % Tipo 00 + 20 % Vollkorn)
  pfMixAdd: (el) => {
    const d = S.draft, pf = d.preferments[+el.dataset.i], names = (d.flours || []).map((f) => f.name).filter(Boolean);
    if ((pf.flours || []).length < 2) {
      const first = names.includes(pf.flourName) ? pf.flourName : names[0] || pf.flourName || 'Mehl';
      pf.flours = [{ name: first, pct: 80 }, { name: names.find((n) => n !== first) || first, pct: 20 }];
    } else pf.flours.push({ name: names.find((n) => !pf.flours.some((f) => f.name === n)) || names[0] || 'Mehl', pct: 0 });
    render();
  },
  pfMixDel: (el) => {
    const pf = S.draft.preferments[+el.dataset.i];
    pf.flours.splice(+el.dataset.k, 1);
    if (pf.flours.length < 2) { pf.flourName = pf.flours[0]?.name || pf.flourName; pf.flours = []; }
    render();
  },
  // Quellstück: Schrot/Mehl · Saaten · Altbrot (Saaten und Altbrot zählen nicht zum Mehl)
  pfQuell: (el) => {
    const pf = S.draft.preferments[+el.dataset.i], v = el.dataset.v, wasBread = C.isOldBread(pf);
    if (v === 'flour') { pf.seeds = false; if (wasBread || pf.flourName === 'Saaten') pf.flourName = S.draft.flours?.[0]?.name || ''; }
    else if (v === 'seeds') { pf.seeds = true; if (wasBread || !pf.flourName || (S.draft.flours || []).some((f) => f.name === pf.flourName)) pf.flourName = 'Saaten'; }
    else {
      pf.seeds = true;
      if (!wasBread) pf.flourName = 'Altbrot';
      if (num(pf.hydration) === PF_TYPES.quell.hydration) pf.hydration = 200;
    }
    render();
  },
  pfExAdd: (el) => {
    const pf = S.draft.preferments[+el.dataset.i];
    pf.extras = [...(pf.extras || []), { name: el.dataset.v, pct: 0 }];
    render();
  },
  pfExDel: (el, e) => { e?.preventDefault(); const pf = S.draft.preferments[+el.dataset.i]; pf.extras.splice(+el.dataset.k, 1); render(); },
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
    const defaults = { prep: [15, 'rt'], autolyse: [45, 'rt'], mix: [15, 'rt'], bulk: [120, 'rt'], fold: [120, 'rt'], shape: [15, 'rt'], laminate: [10, 'rt'], proof: [720, 'fridge'], temper: [180, 'rt'], preheat: [isCake(d) ? 15 : 45, 'oven'], bake: [30, 'oven'], cool: [60, 'rt'], assemble: [20, 'rt'], rest: [30, isCake(d) ? 'fridge' : 'rt'], other: [30, 'rt'] };
    const [dur, loc] = defaults[k] || [30, 'rt'];
    const s = C.step(k, STEP_KINDS[k].label, dur, loc, k === 'fold' ? { repeat: { count: 4, intervalMin: 30 } } : {});
    const bakeIdx = d.steps.findIndex((x) => x.kind === 'bake');
    const at = k !== 'bake' && k !== 'cool' && k !== 'assemble' && bakeIdx >= 0 ? bakeIdx : d.steps.length;
    // Vorheizen nach einer Gare läuft automatisch nebenher – der Ofen ist genau zum Ende der Gare heiß
    if (k === 'preheat' && at > 0 && FERMENT_KINDS.includes(d.steps[at - 1].kind)) Object.assign(s, { parallel: true, align: 'end' });
    d.steps.splice(at, 0, s);
    S.openStep = s.id;
    render();
  },
  toggleStep: (el) => { S.openStep = S.openStep === el.dataset.id ? null : el.dataset.id; render(); },
  stepLoc: (el) => { S.draft.steps[+el.dataset.i].location = el.dataset.v; render(); },
  toggleRepeat: (el) => { const s = S.draft.steps[+el.dataset.i]; s.repeat = s.repeat ? null : { count: 4, intervalMin: 30 }; render(); },
  moveStep: (el) => { const i = +el.dataset.i, j = i + +el.dataset.d, st = S.draft.steps; [st[i], st[j]] = [st[j], st[i]]; if (st[0]) Object.assign(st[0], { parallel: false, align: '' }); render(); },
  dupStep: (el) => { const i = +el.dataset.i, c = structuredClone(S.draft.steps[i]); c.id = uid(); S.draft.steps.splice(i + 1, 0, c); S.openStep = c.id; render(); },
  delStep: (el) => { S.draft.steps.splice(+el.dataset.i, 1); if (S.draft.steps[0]) Object.assign(S.draft.steps[0], { parallel: false, align: '' }); render(); },
  stepWhen: (el) => {
    const s = S.draft.steps[+el.dataset.i], v = el.dataset.v;
    Object.assign(s, { parallel: v !== 'seq', align: v === 'end' ? 'end' : '' });
    render();
  },
  preheatTip: (el) => { Object.assign(S.draft.steps[+el.dataset.i], { parallel: true, align: 'end' }); toast('✓ Vorheizen läuft jetzt nebenher'); render(); },
  preheatTipOff: async () => { S.settings.preheatTipOff = [...(S.settings.preheatTipOff || []), S.draft.id]; await saveSettings(); render(); },
  setCover: (el) => { S.draft.cover = el.dataset.id; render(); },
  delDraftPhoto: (el) => {
    const d = S.draft, id = el.dataset.id;
    d.photos = d.photos.filter((p) => p !== id);
    if (d.cover === id) d.cover = null;
    if (S.draftNewPhotos.includes(id)) { S.draftNewPhotos = S.draftNewPhotos.filter((p) => p !== id); db.deletePhoto(id); }
    render();
  },

  planMode: (el) => { S.plan.mode = el.dataset.v; S.plan.calMonth = null; render(); },
  // 📅 Kalender im Planer: Tag wählen (Uhrzeit bleibt), Uhrzeit wählen (Tag bleibt), ±15 min, Monat blättern
  planDay: (el) => { S.plan.at = atOn(el.dataset.d, hm(S.plan.at)); render(); },
  planTime: (el) => { S.plan.at = atOn(dayKey(new Date(S.plan.at)), el.dataset.t); render(); },
  planShift: (el) => { S.plan.at += num(el.dataset.d) * 60000; S.plan.calMonth = null; render(); },
  planMonth: (el) => {
    const [y, m] = (S.plan.calMonth || dayKey(new Date(S.plan.at)).slice(0, 7)).split('-').map(Number);
    const d = new Date(y, m - 1 + num(el.dataset.d), 1);
    S.plan.calMonth = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    render();
  },
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
  planYeastFit: (el) => { S.plan.yeastFit = el.checked; S.plan.yfOpen = true; render(); },
  flourNew: async () => {
    const cols = Object.keys(C.FLOUR_COLORS);
    const f = C.sanitizeFlour({ name: '', color: cols[S.flours.length % cols.length] });
    await saveFlour(f);
    location.hash = `#/flour/${f.id}`;
    setTimeout(() => $('[data-k="name"]')?.focus(), 60);
  },
  flourDel: async (el) => {
    const f = flourById(el.dataset.id);
    if (!f || !confirm(`„${f.name || 'Dieses Mehl'}“ löschen? Rezepte und Tagebuch bleiben unverändert.`)) return;
    await db.del('flours', f.id);
    await sync.markDeleted('flour', f.id);
    S.flours = S.flours.filter((x) => x.id !== f.id);
    X.setMyFlours(feat('myFlours') ? S.flours : []);
    scheduleSync(500);
    location.replace('#/bake');
  },
  flourColor: async (el) => { const f = flourById(el.dataset.id); if (!f) return; f.color = el.dataset.v; await saveFlour(f); render(); },
  flourStock: async (el) => { const f = flourById(el.dataset.id); if (!f) return; f.stock = Math.max(0, num(f.stock) + num(el.dataset.d)); await saveFlour(f); toast(`🫙 Vorrat jetzt ${kg(f.stock)}`); render(); },
  planDurReset: () => { S.plan.dur = {}; S.plan.yeastFit = undefined; render(); },
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
      ov, calc: calcFor(planRecipe(r), ov), yeastType: r.yeastType, steps: structuredClone(planStepsBase(r)).map((x) => ({ ...x, doneAt: null })), notified: [], logId: null,
      room: S.plan.ov.room ?? '',
    };
    // 🌾 Vorrat meiner Mehle abziehen (nur wo ein Vorrat eingetragen ist)
    const use = stockOn() ? X.flourNeeds(s.calc).filter((x) => val(x.f.stock)) : [];
    if (use.length) {
      s.flourUse = use.map((x) => ({ id: x.f.id, g: Math.round(x.g) }));
      for (const x of use) { const f = flourById(x.f.id); if (f) { f.stock = Math.max(0, num(f.stock) - Math.round(x.g)); await saveFlour(f); } }
    }
    await saveSession(s);
    S.plan = null;
    if (use.length) setTimeout(() => toast(`🫙 Vorrat: ${use.map((x) => `−${fmtG(x.g)} ${x.f.name}`).join(', ')}`, 3500), 1600);
    if ('Notification' in window && Notification.permission === 'default') await askNotif();
    location.replace(`#/bake/${s.id}`); // Planer verschwindet aus dem Verlauf
    toast(startAt > Date.now() + 60000 ? '✓ Plan aktiviert – du wirst zum Start erinnert' : '✓ Los geht’s!');
  },

  stepDone: (el) => {
    const s = sessById(el.dataset.id), i = +el.dataset.i, hands = !!el.dataset.hands;
    if (!s || s.steps[i]?.doneAt) return render();
    const now = Date.now();
    const tl = planInfo(effSteps(s), s.startAt, now).tl;
    const cur = tl.find((x) => x.i === i);
    const left = cur ? cur.end - now : 0;
    // Nebenher-Schritte (z. B. Ofen vorheizen) ohne Rückfrage abhaken
    if (feat('confirmEarly') && left >= 60000 && !isSide(cur)) {
      const next = nextMain(tl, i);
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
    // Automatisch eingetragene Fütterung wieder entfernen (sonst doppelt beim erneuten Erledigen)
    const cu = s.steps[last].cultureId && cultById(s.steps[last].cultureId);
    if (cu && s.steps[last].feedAt) { cu.feeds = (cu.feeds || []).filter((f) => f.at !== s.steps[last].feedAt); s.steps[last].feedAt = null; await saveCulture(cu); }
    if (s.status === 'done') s.status = 'active';
    await saveSession(s);
    toast(`↶ Schritt „${s.steps[last].name}“ wieder geöffnet`);
    if (S.hands === s.id) speak(`Zurück: ${s.steps[last].name}.`);
    render();
  },
  stepFeel: async (el) => {
    const s = sessById(el.dataset.id), st = s?.steps[+el.dataset.i];
    if (!st) return;
    st.feel = st.feel === el.dataset.v ? '' : el.dataset.v;
    S.measOpen = `${s.id}:${el.dataset.i}`;
    await saveSession(s);
    render();
  },
  adjQuick: (el) => {
    const s = sessById(el.dataset.id), st = el.dataset.st, d = num(el.dataset.d);
    if (!s) return;
    const rows = stageRows(sessCalc(s), st, s.yeastType)?.rows || [];
    const row = el.dataset.k === 'water' ? rows.find((r) => r.key === 'water' && r.type === 'water') : rows.find((r) => r.type === 'flour');
    if (!row) return;
    adjSet(s, st, row.key, Math.round((row.g + d) * 10) / 10).then(() => {
      toast(`+${d} g ${el.dataset.k === 'water' ? 'Wasser' : 'Mehl'} · Hydration jetzt ${fmtPct(sessCalc(s).totals.hydration)}`);
      if (S.hands) speak(`Hydration jetzt ${fmtNum(sessCalc(s).totals.hydration)} Prozent.`);
    });
  },
  adjPickFlour: (el) => { const n = el.closest('.adj')?.querySelector('.adj-n'); if (n) { n.value = el.dataset.v; n.classList.add('mine'); n.style.setProperty('--fc', fColor(myF(el.dataset.v))); } },
  adjAddOpen: (el) => {
    const key = `${el.dataset.id}:${el.dataset.st}`;
    S.adjAdd = S.adjAdd?.key === key && S.adjAdd.mode === el.dataset.m ? null : { key, mode: el.dataset.m };
    S.adjOpen = key;
    render();
    setTimeout(() => $(`details.adj[data-adj="${CSS.escape(key)}"] .adj-n`)?.focus(), 30);
  },
  // Mehlsorte dazumischen – oder eine Sorte tauschen („statt …“: alte Sorte auf 0, neue mit gleicher Menge)
  adjAddFlour: (el) => {
    const s = sessById(el.dataset.id), st = el.dataset.st, box = el.closest('.adj');
    if (!s || !box) return;
    const name = box.querySelector('.adj-n')?.value.trim(), sw = box.querySelector('.adj-sw')?.value || '';
    let g = num(box.querySelector('.adj-g')?.value);
    const old = sw ? (stageRows(sessCalc(s), st, s.yeastType)?.rows || []).find((r) => r.key === sw) : null;
    if (!(g > 0) && old) g = Math.round(old.g * 10) / 10;
    if (!name || !(g > 0)) { toast('Bitte Mehlsorte und Menge eingeben'); return; }
    s.adjust ||= {}; s.adjust[st] ||= {};
    if (old) s.adjust[st][sw] = 0;
    s.adjust[st]._add = [...(s.adjust[st]._add || []), { name, g }];
    S.adjAdd = null;
    adjSet(s, st, '_t', Date.now()).then(() => toast(old ? `${name} statt ${old.name}` : `${fmtG(g)} ${name} dazu · Hydration jetzt ${fmtPct(sessCalc(s).totals.hydration)}`));
  },
  // Zutat im Hauptteig spontan dazu (nur dieser Backtag; „Ins Rezept“ übernimmt sie auf Wunsch)
  adjAddX: (el) => {
    const s = sessById(el.dataset.id), box = el.closest('.adj');
    const name = box?.querySelector('.adj-n')?.value.trim(), g = num(box?.querySelector('.adj-g')?.value);
    if (!s || !name || !(g > 0)) { toast('Bitte Zutat und Menge eingeben'); return; }
    s.adjust ||= {}; s.adjust.main ||= {};
    s.adjust.main._addX = [...(s.adjust.main._addX || []), { name, g }];
    S.adjAdd = null;
    adjSet(s, 'main', '_t', Date.now());
  },
  adjAddItem: (el) => {
    const s = sessById(el.dataset.id), st = el.dataset.st, name = $('#adj-in')?.value.trim(), v = num($('#adj-iv')?.value), unit = $('#adj-iu')?.value || 'g';
    if (!s || !name || !(v > 0)) { toast('Bitte Zutat und Menge eingeben'); return; }
    s.adjust ||= {}; s.adjust[st] ||= {};
    s.adjust[st]._add = [...(s.adjust[st]._add || []), { name, v, unit }];
    adjSet(s, st, '_t', Date.now());
  },
  // Salz (und Hefe im Hauptteig) so anpassen, dass der Anteil am – geänderten – Mehl wie geplant bleibt
  adjAlign: (el) => {
    const s = sessById(el.dataset.id);
    if (!s) return;
    const c = sessCalc(s), c0 = sessCalc(s, false);
    s.adjust ||= {}; s.adjust.main ||= {};
    const msg = [];
    if (c0.F > 0) {
      const salt = c.main.salt + ((c0.totals.salt / c0.F) * c.F - c.totals.salt);
      if (salt >= 0 && Math.abs(salt - c.main.salt) > 0.05) { msg.push(`Salz ${fmtG(salt)}`); s.adjust.main.salt = Math.round(salt * 10) / 10; }
      const yeast = c.main.yeast + ((c0.totals.yeast / c0.F) * c.F - c.totals.yeast);
      if (c.main.yeast > 0 && yeast >= 0 && Math.abs(yeast - c.main.yeast) > 0.05) { msg.push(`${yeastName(s.yeastType)} ${fmtG(yeast)}`); s.adjust.main.yeast = Math.round(yeast * 10) / 10; }
    }
    adjSet(s, 'main', '_t', Date.now()).then(() => toast(msg.length ? `✓ ${msg.join(' · ')}` : 'Passt schon'));
  },
  adjReset: async (el) => {
    const s = sessById(el.dataset.id);
    if (!s?.adjust) return;
    delete s.adjust[el.dataset.st];
    await saveSession(s);
    toast('↶ Wieder die Mengen laut Plan');
    render();
  },
  toggleCancelled: () => { S.showCancelled = !S.showCancelled; render(); },
  logOnlyChg: () => { S.logOnlyChg = !S.logOnlyChg; render(); },
  logMenu: (el) => {
    const l = S.logs.find((x) => x.id === el.dataset.id), r = l && byId(l.recipeId);
    if (!r) return;
    sheet(fmtDate(l.date), [
      ...(l.protocol?.pct || !isCake(r) ? [{ label: 'Ins Rezept übernehmen', icon: 'check', run: () => A.applyLog({ dataset: { id: l.id } }) }] : []),
      ...(l.protocol?.pct ? [{ label: 'Als Variante speichern', icon: 'copy', run: () => A.logVariant({ dataset: { id: l.id } }) }] : []),
      { label: 'Bearbeiten', icon: 'edit', run: () => { location.hash = `#/log/${r.id}/${l.id}/edit`; } },
    ]);
  },
  // 🫙 Meine Kulturen
  cultNew: async (el) => {
    const t = C.CULTURE_TYPES[el.dataset.v] || C.CULTURE_TYPES.custom;
    const c = C.sanitizeCulture({ id: uid(), name: t.label, type: el.dataset.v, ratio: t.ratio, hydration: t.hydration, days: t.days, place: t.place, lead: t.lead, feeds: [{ at: Date.now(), note: 'angelegt' }] });
    await saveCulture(c);
    location.hash = `#/culture/${c.id}`;
  },
  cultFed: async (el) => {
    const c = cultById(el.dataset.id);
    if (!c) return;
    await addFeed(c);
    toast(`✓ ${c.name} gefüttert${c.days ? ` – nächstes Mal ${fmtRel(Date.now() + c.days * 86400000).replace(/ \d\d:\d\d$/, '')}` : ''}`);
    render();
  },
  cultFedSave: async (el) => {
    const c = cultById(el.dataset.id);
    if (!c) return;
    const temp = C.optNum($('#cf-temp')?.value), rise = C.optNum($('#cf-rise')?.value);
    await addFeed(c, { temp: temp === '' ? null : temp, rise: rise === '' ? null : rise, note: ($('#cf-note')?.value || '').trim().slice(0, 300) });
    toast('✓ Fütterung eingetragen');
    render();
  },
  cultSnooze: async (el) => { S.settings.cultSnooze = { ...(S.settings.cultSnooze || {}), [el.dataset.id]: Date.now() + 86400000 }; await saveSettings(); render(); },
  cultPlace: async (el) => { const c = cultById(el.dataset.id); if (!c) return; c.place = el.dataset.v; await saveCulture(c); render(); },
  cultIcs: (el) => {
    const c = cultById(el.dataset.id);
    if (!c || !(c.days > 0)) { toast('Bitte zuerst „Füttern alle … Tage“ einstellen.'); return; }
    const f = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const e = (t) => String(t).replace(/[\\;,]/g, (m) => '\\' + m);
    const at = new Date(lastFeed(c) + c.days * 86400000); at.setHours(9, 0, 0, 0);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teigbuch//DE', 'BEGIN:VEVENT', `UID:kultur-${c.id}@teigbuch`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(at.getTime())}`, `DTEND:${f(at.getTime() + 15 * 60000)}`,
      `RRULE:FREQ=DAILY;INTERVAL=${c.days}`, `SUMMARY:${e(`🫙 ${c.name} füttern`)}`, `DESCRIPTION:${e(`Teigbuch: ${c.ratio.map((x) => fmtNum(x, 2)).join(' : ')} (Anstellgut : Mehl : Wasser)`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(`${c.name} füttern`)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    shareOrDownload(new Blob([ics], { type: 'text/calendar' }), `${slug(c.name)}-fuettern.ics`, c.name);
  },
  cultDel: async (el) => {
    const c = cultById(el.dataset.id);
    if (!c || !confirm(`„${c.name}“ samt Fütterungsprotokoll löschen?`)) return;
    await db.del('cultures', c.id);
    await sync.markDeleted('culture', c.id);
    S.cultures = S.cultures.filter((x) => x.id !== c.id);
    scheduleSync(500);
    toast('Kultur gelöscht');
    location.hash = '#/bake';
  },
  cmpAll: () => { S.cmpAll = !S.cmpAll; render(); },
  handsOn: (el) => { S.hands = el.dataset.id; history.pushState({ hands: 1 }, ''); render(); keepAwake(true); speak('Teighände-Modus an.'); },
  handsExit: () => { if (history.state?.hands) { history.back(); return; } S.hands = null; keepAwake(false); render(); },
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
    const s = sessById(el.dataset.id); s.status = 'cancelled'; await flourGiveBack(s); await saveSession(s); location.hash = '#/bake';
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
      { label: 'Backvorgang löschen', icon: 'trash', danger: true, run: async () => {
        if (!confirm('Backvorgang löschen?')) return;
        // Schritt-Fotos mitlöschen – außer sie stecken schon in einem Tagebuch-Eintrag
        const used = new Set(S.logs.flatMap((l) => l.photos || []));
        for (const p of s.steps.flatMap((x) => x.photos || [])) if (!used.has(p)) await db.deletePhoto(p);
        await flourGiveBack(s);
        await db.del('sessions', s.id); S.sessions = S.sessions.filter((x) => x.id !== s.id); location.hash = '#/bake';
      } },
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
    // Entfernte Fotos auch aus dem Backprotokoll austragen (sonst tauchen sie per Sync wieder auf)
    if (l.protocol?.steps && (l._removed || []).length) l.protocol.steps.forEach((st) => { st.photos = (st.photos || []).filter((ph) => !l._removed.includes(ph)); });
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
    // Bearbeitet → zurück zur Ansicht; neu → Tagebuch des Rezepts (Formular verschwindet aus dem Verlauf)
    leaveTo(isNew ? `#/r/${l.recipeId}?tab=log` : `#/log/${l.recipeId}/${l.id}`, S.logFrom);
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
    leaveTo(`#/r/${l.recipeId}?tab=log`, S.logFrom); // Formular verschwindet aus dem Verlauf
  },
  bakeAgain: (el) => {
    const l = S.logs.find((x) => x.id === el.dataset.id), r = byId(l.recipeId), pr = l.params || {};
    S.plan = initPlan(r);
    if (isCake(r)) { location.hash = `#/plan/${r.id}`; return; }
    Object.assign(S.plan.ov, { hydration: num(pr.hydration) > 0 ? num(pr.hydration) : r.water.pct });
    if (r.yield.mode !== 'flour' && num(pr.count) > 0 && num(pr.pieceWeight) > 0) Object.assign(S.plan.ov, { ymode: 'pieces', count: Math.max(1, Math.round(num(pr.count))), pieceWeight: num(pr.pieceWeight) });
    S.plan.adjOpen = true;
    location.hash = `#/plan/${r.id}`;
    toast('Werte aus dem Tagebuch übernommen');
  },
  applyLog: async (el) => {
    const l = S.logs.find((x) => x.id === el.dataset.id), r = byId(l.recipeId), pr = l.params || {};
    // Mit Backprotokoll: genau die Änderungen dieses Backtags („🎨 Anpassen“) übernehmen
    if (l.protocol?.pct) {
      const ch = l.protocol.changes || [];
      if (!confirm(`Änderungen vom ${fmtDate(l.date)} ins Rezept übernehmen?\n\n${ch.slice(0, 8).map((c) => `${c.name}: ${c.from} → ${c.to}`).join('\n')}${ch.length > 8 ? '\n…' : ''}\n\nDie Menge (Anzahl/Gewicht) bleibt, die Anteile werden übernommen.`)) return;
      C.applyPct(r, l.protocol.pct);
      await saveRecipe(r);
      S.scale = null; S.plan = null;
      toast('✓ Rezept aktualisiert');
      render();
      return;
    }
    if (!confirm(`Hydration ${fmtPct(pr.hydration)}, Salz ${fmtPct(pr.salt)}${pr.count ? `, ${fmtNum(pr.count, 0)} × ${fmtNum(pr.pieceWeight, 0)} g` : ''} ins Rezept übernehmen?`)) return;
    if (pr.hydration) r.water.pct = num(pr.hydration);
    if (pr.salt) r.salt = num(pr.salt);
    if (pr.count && r.yield.mode !== 'flour') { r.yield.count = num(pr.count); r.yield.pieceWeight = num(pr.pieceWeight) || r.yield.pieceWeight; }
    await saveRecipe(r);
    S.scale = null; S.plan = null;
    toast('✓ Rezept aktualisiert');
    render();
  },

  // Änderungen eines Backtags als eigenes Rezept speichern – das Original bleibt unverändert
  logVariant: async (el) => {
    const l = S.logs.find((x) => x.id === el.dataset.id), r = byId(l?.recipeId);
    if (!r || !l.protocol?.pct) return;
    const c = asVariant(C.applyPct(structuredClone(r), l.protocol.pct), ` (Variante ${fmtDate(l.date).replace(/^\w+\.,\s*/, '')})`);
    await saveRecipe(c);
    toast('✓ Variante gespeichert – das Original bleibt unverändert', 3500);
    location.hash = `#/r/${c.id}`;
  },
  protoEdit: () => { S.protoEdit = !S.protoEdit; render(); },
  protoFromSession: () => {
    const l = S.logDraft, sess = l && sessById(l.sessionId);
    if (!sess) return;
    l.protocol = buildProtocol(sess);
    l.photos = [...new Set([...(l.photos || []), ...sess.steps.flatMap((x) => x.photos || [])])];
    toast('✓ Ablauf übernommen – zum Sichern „Speichern“ tippen');
    render();
  },
  planUsePct: (el) => {
    const r = S.plan && byId(S.plan.id), l = S.logs.find((x) => x.id === el.dataset.id);
    if (!r || !l?.protocol?.pct) return;
    S.plan.usePct = l.id;
    if (!isCake(r)) S.plan.ov.hydration = Math.round(l.protocol.pct.water * 100) / 100;
    render();
  },
  planUsePctOff: () => {
    const r = S.plan && byId(S.plan.id);
    if (!r) return;
    S.plan.usePct = null;
    if (!isCake(r)) S.plan.ov.hydration = r.water.pct;
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
        for (const st of ['recipes', 'logs', 'photos', 'cultures']) await db.clear(st);
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
    for (const st of ['recipes', 'logs', 'sessions', 'photos', 'cultures']) await db.clear(st);
    await sync.resetLocal();
    await reload();
    toast('Alle Daten gelöscht');
    location.hash = '#/';
  },
};

// Dampfl: die Hefe des Hauptteigs wandert in das Dampfl (sonst wäre sie doppelt)
// Milch/Bier/Buttermilch … im Vorteig kommt aus der Zutat des Rezepts – fehlt sie, gleich als Zutat anlegen
function ensurePfLiquid(d, i) {
  const pf = d.preferments[i];
  if (!pf || pf.liquid === 'water') return;
  const name = String(pf.liquidName || '').trim() || 'Milch';
  if (C.liquidIndex(d.extras, name) >= 0) return;
  const c = calc(d), x = c.pfs[i];
  d.extras.push({ name, pct: x && c.F > 0 ? Math.round((x.milkG / c.F) * 10000) / 100 : 10 });
  toast(`${name} als Zutat ergänzt – dort steht die gesamte Menge des Rezepts.`, 4000);
}
function dampflYeast(d, pf) {
  if (num(d.yeastPct) > 0 && num(pf.flourPct) > 0) {
    pf.yeastPct = Math.round((num(d.yeastPct) / num(pf.flourPct)) * 10000) / 100;
    d.yeastPct = 0;
    toast('Die Hefe ist jetzt komplett im Dampfl – im Hauptteig steht 0.', 4000);
  }
}

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
    // Eigenes Mehl farbig hervorheben (live beim Tippen)
    const m = myF(el.value);
    el.classList.toggle('mine', !!m);
    if (m) el.style.setProperty('--fc', fColor(m)); else el.style.removeProperty('--fc');
    d.preferments.forEach((pf) => {
      if (pf.flourName === old) pf.flourName = el.value;
      (pf.flours || []).forEach((x) => { if (x.name === old) x.name = el.value; });
    });
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
  cultCalc: (el) => {
    S.cultNeed = el.value;
    const c = cultById(el.dataset.id), box = $('#cult-calc');
    if (c && box) box.innerHTML = feedCalc(c, num(el.value)) || '<span class="muted">Menge eingeben.</span>';
  },
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
  planClock: (el) => { if (/^\d{2}:\d{2}$/.test(el.value)) { S.plan.at = atOn(dayKey(new Date(S.plan.at)), el.value); render(); } },
  planCult: (el) => { if (S.plan) { S.plan.cult = el.value || null; render(); } },
  // 🌾 Meine Mehle: Angaben ändern (alles freiwillig). Umbenennen zieht auf Wunsch die Rezepte mit.
  flour: async (el) => {
    const f = flourById(el.dataset.id), k = el.dataset.k;
    if (!f) return;
    const old = f.name;
    const raw = { ...f, [k]: ['name', 'brand', 'notes', 'kind', 'bestBefore'].includes(k) ? el.value : C.optNum(el.value) };
    Object.assign(f, C.sanitizeFlour(raw), { id: f.id, createdAt: f.createdAt });
    if (k === 'name' && old && f.name && !C.sameName(old, f.name)) {
      const rs = S.recipes.filter((r) => (r.flours || []).some((x) => C.sameName(x.name, old)));
      if (rs.length && confirm(`„${old}“ wird in ${rs.length} Rezept${rs.length > 1 ? 'en' : ''} verwendet. Dort auch in „${f.name}“ umbenennen?`)) {
        for (const r of rs) {
          const ren = (n) => (C.sameName(n, old) ? f.name : n);
          r.flours.forEach((x) => { x.name = ren(x.name); });
          (r.preferments || []).forEach((p) => { p.flourName = ren(p.flourName); (p.flours || []).forEach((x) => { x.name = ren(x.name); }); });
          await saveRecipe(r);
        }
      }
    }
    await saveFlour(f);
    render();
  },
  planFlour: (el) => { if (!S.plan) return; S.plan.flourMap ||= {}; if (el.value) S.plan.flourMap[el.dataset.k] = el.value; else delete S.plan.flourMap[el.dataset.k]; S.plan.flOpen = true; render(); },
  // 🧪 Gärzeit eines Schritts für diesen Backtag (in Stunden) – Hefe passt sich an
  planDur: (el) => {
    const P = S.plan, r = P && byId(P.id), st = r?.steps.find((x) => x.id === el.dataset.sid);
    if (!st) return;
    const v = Math.max(1, Math.round(num(el.value) * 60));
    P.dur ||= {};
    if (!el.value.trim() || v === Math.round(num(st.durationMin))) delete P.dur[st.id]; else P.dur[st.id] = v;
    if (P.yeastFit === undefined && Object.keys(P.dur).length) P.yeastFit = true;
    P.yfOpen = true;
    render();
  },
  // Flüssigkeit im Vorteig (Milch, Bier, Buttermilch …) – kommt aus der gleichnamigen Zutat des Rezepts
  pfLiqName: (el) => {
    const d = S.draft, i = +el.dataset.i, pf = d.preferments[i], v = el.value.trim();
    pf.liquidName = !v || C.sameName(v, 'Milch') ? '' : v;
    ensurePfLiquid(d, i);
    render();
  },
  // Mehrstufiger Sauerteig: vorige Stufe als Anstellgut (Mehl-/Wasseranteil gleich so setzen, dass die vorige Stufe hineinpasst)
  pfFrom: (el) => {
    const d = S.draft, i = +el.dataset.i, pf = d.preferments[i];
    pf.starterFrom = el.value;
    if (pf.starterFrom) {
      const prev = d.preferments.find((p) => p.id === pf.starterFrom);
      if (prev && num(pf.flourPct) <= num(prev.flourPct)) pf.flourPct = Math.round(num(prev.flourPct) * 3 * 100) / 100;
      pf.starterPct = 0;
    }
    render();
  },
  meas: async (el) => {
    const s = sessById(el.dataset.id), st = s.steps[+el.dataset.i];
    st.meas ||= {};
    const v = el.value.trim().replace(',', '.');
    const k = el.dataset.k;
    // Wasser/Eis sind aus dem Rezept vorbelegt: Leeren heißt „heute nicht“ → '' merken statt löschen
    if (v === '' || !Number.isFinite(+v)) { if (k === 'water' || k === 'ice') st.meas[k] = ''; else delete st.meas[k]; } else st.meas[k] = +v;
    await saveSession(s);
    const sum = $('#meas-sum');
    if (sum) sum.innerHTML = noteSum(st) || 'Notieren';
    S.measOpen = `${s.id}:${el.dataset.i}`;
    S.measDirty = true; // neu zeichnen, sobald der Fokus das Feld verlässt (Zeitplan kann sich ändern)
  },
  // Notiz und Foto zum laufenden Schritt (landen im Backprotokoll des Tagebuchs)
  stepNote: async (el) => {
    const s = sessById(el.dataset.id), st = s?.steps[+el.dataset.i];
    if (!st) return;
    st.note = el.value.trim().slice(0, 1000);
    await saveSession(s);
    const sum = $('#meas-sum');
    if (sum) sum.innerHTML = noteSum(st) || 'Notieren';
    S.measOpen = `${s.id}:${el.dataset.i}`;
  },
  stepPhoto: async (el) => {
    const s = sessById(el.dataset.id), st = s?.steps[+el.dataset.i], f = el.files?.[0];
    if (!st || !f) return;
    toast('Foto wird gespeichert …');
    try { const id = await db.addPhoto(f); st.photos = [...(st.photos || []), id]; await saveSession(s); toast('✓ Foto gespeichert'); }
    catch (e) { toast('Foto konnte nicht gespeichert werden: ' + e.message); }
    S.measOpen = `${s.id}:${el.dataset.i}`;
    render();
  },
  // 🎨 Anpassen: neue Menge einer Zutat bzw. Ziel-Hydration
  adj: (el) => {
    const s = sessById(el.dataset.id);
    if (!s) return;
    const v = el.value.trim() === '' ? 0 : num(el.value);
    if (!(v >= 0)) { toast('Bitte eine Menge ab 0 eingeben'); render(); return; }
    adjSet(s, el.dataset.st, el.dataset.k, Math.round(v * 100) / 100);
  },
  adjHyd: (el) => {
    const s = sessById(el.dataset.id), st = el.dataset.st, T = num(el.value);
    if (!s || !(T > 0)) { render(); return; }
    const c = sessCalc(s), w = stageRows(c, st, s.yeastType)?.rows.find((r) => r.key === 'water' && r.type === 'water');
    if (!w) return;
    const next = w.g + ((T / 100) * c.F - c.totals.water);
    if (next < 0) { toast('Dafür müsste Wasser wieder raus – gib lieber Mehl dazu.', 4000); render(); return; }
    adjSet(s, st, 'water', Math.round(next * 10) / 10);
    toast(`Wasser in diesem Schritt: ${fmtG(next)}`);
  },
  cult: async (el) => {
    const c = cultById(el.dataset.id), k = el.dataset.k;
    if (!c) return;
    if (k === 'name' || k === 'notes') c[k] = el.value.trim().slice(0, k === 'name' ? 80 : 2000);
    else if (/^r[012]$/.test(k)) c.ratio[+k[1]] = Math.max(0, num(el.value));
    else c[k] = Math.max(0, k === 'days' ? Math.round(num(el.value)) : num(el.value));
    await saveCulture(c);
    render();
  },
  cmpPick: (el) => {
    const a = el.dataset.side === 'a' ? el.value : el.dataset.a, b = el.dataset.side === 'b' ? el.value : el.dataset.b;
    location.replace(`#/cmp/${el.dataset.rid}?a=${a}&b=${b}`);
  },
  // Backprotokoll: tatsächliche Dauer eines Schritts korrigieren
  protoAct: (el) => {
    const p = S.logDraft?.protocol?.steps?.[+el.dataset.i];
    if (!p) return;
    const row = el.closest('.proto-edit');
    const h = num(row.querySelector('[data-part="h"]').value), m = num(row.querySelector('[data-part="m"]').value);
    p.act = Math.max(0, Math.round(h * 60 + m));
    render();
  },
  // Kuchen: Zielform / Faktor (Rezeptseite oder Planer)
  cake: (el) => {
    const t = el.dataset.t, k = el.dataset.k, st = cakeState(t);
    if (!st) return render();
    const v = num(el.value);
    if (!(v > 0)) { toast('Bitte eine Zahl größer 0 eingeben'); render(); return; }
    if (k === 'factor') st.factor = v;
    else st.pan = { ...st.pan, [k]: k === 'n' ? Math.round(v) : v };
    if (t === 'scale') S.plan = null;
    render();
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

// ---------- Navigation: Zurück wie am Handy ----------
const routeOf = (h) => String(h || '').split('?')[0];
// Nach Speichern/Starten: führt das Ziel dorthin zurück, wo man herkam → echter Schritt zurück, sonst Seite ersetzen
function leaveTo(target, from, depth = 0) {
  if (from && routeOf(from) === routeOf(target)) {
    history.go(-(1 + depth)); // depth = Editor-Schritte, die im Verlauf stehen
    if (from !== target) setTimeout(() => { if (routeOf(location.hash) === routeOf(target) && location.hash !== target) location.replace(target); }, 60);
  } else if (depth) { history.go(-depth); setTimeout(() => location.replace(target), 80); } else location.replace(target);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.defaultPrevented) return;
  const href = a.getAttribute('href');
  // Reiter (Zutaten/Ablauf/Tagebuch …) zählen nicht als eigene Seite
  if (a.hasAttribute('data-replace')) { e.preventDefault(); location.replace(href); return; }
  // „‹ Zurück“ oben: wie die Zurück-Taste, wenn man genau von dort kam
  if (a.getAttribute('aria-label') === 'Zurück' && S.prevHash && routeOf(S.prevHash) === routeOf(href)) { e.preventDefault(); history.back(); }
});
// Zurück-Taste schließt zuerst ein offenes Menü / Foto
let sheetState = false;
window.addEventListener('popstate', (e) => {
  if (sheetState && !e.state?.sheet) { sheetState = false; $('#sheet-root').innerHTML = ''; if (S.scanStream) { S.scanStream.getTracks().forEach((t) => t.stop()); S.scanStream = null; } return; }
  // Editor: Zurück = vorheriger Editor-Schritt (gleiche Adresse, nur der Schritt ändert sich)
  if (route().parts[0] === 'edit' && S.draft && !e.state?.sheet) { S.wiz = e.state?.wiz ?? 0; render(); }
  // Teighände-Modus: Zurück beendet zuerst den Modus
  if (S.hands && route().parts[0] === 'bake' && !e.state?.hands) { S.hands = null; keepAwake(false); render(); }
});
new MutationObserver(() => {
  const open = !!$('#sheet-root')?.firstElementChild;
  if (open && !sheetState) { sheetState = true; history.pushState({ sheet: 1 }, ''); }
  else if (!open && sheetState) { sheetState = false; if (history.state?.sheet) history.back(); }
}).observe(document.getElementById('sheet-root'), { childList: true });

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
  if (e.target.dataset?.actionToggle === 'yf' && S.plan) S.plan.yfOpen = e.target.open;
  if (e.target.dataset?.actionToggle === 'cult') S.cultOpen = e.target.open;
  if (e.target.dataset?.actionToggle === 'flours') S.flourOpen = e.target.open;
  if (e.target.dataset?.actionToggle === 'fl' && S.plan) S.plan.flOpen = e.target.open;
  if (e.target.dataset?.actionToggle === 'fun') S.funOpen = e.target.open;
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------- Kein Zoomen (ab 2.6): Doppeltippen und Zwei-Finger-Zoom unterbinden ----------
// (iPhone-Safari ignoriert „user-scalable=no“ teilweise – daher zusätzlich die Gesten abfangen)
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault(); }, { passive: false });
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

// ---------- Start ----------
async function reload() {
  const [recipes, logs, sessions, settings, cultures, flours] = await Promise.all([db.getAll('recipes'), db.getAll('logs'), db.getAll('sessions'), db.get('meta', 'settings'), db.getAll('cultures'), db.getAll('flours')]);
  S.recipes = recipes || []; S.logs = logs || []; S.sessions = sessions || []; S.cultures = cultures || []; S.flours = flours || [];
  if (settings) Object.assign(S.settings, settings);
  X.setMyFlours(feat('myFlours') ? S.flours : []);
}

// Nach einem App-Update: vorhandene Daten auf dem Gerät auf das aktuelle Datenformat bringen.
// (updatedAt bleibt gleich – jedes Gerät migriert selbst, es muss nichts neu synchronisiert werden.)
async function migrateLocal() {
  let n = 0;
  for (const [store, list, mig] of [['recipes', S.recipes, MG.migrateRecipe], ['logs', S.logs, MG.migrateLog], ['cultures', S.cultures, MG.migrateCulture], ['flours', S.flours, MG.migrateFlour]]) {
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
