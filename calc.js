// Teigbuch – Teigberechnung (Bäckerprozente), Zeitplanung und Vorlagen
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function num(v) {
  const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(x) ? x : 0;
}
// Optionale Zahl: '' bleibt '' (= nicht angegeben), sonst eine endliche Zahl
export function optNum(v) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return '';
  const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(x) ? x : '';
}
const p = (v) => num(v) / 100;
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);

// ---------- Stammdaten ----------
export const PF_TYPES = {
  biga: { label: 'Biga', icon: '🧱', hydration: 50, flourPct: 50, yeastPct: 1, starterPct: 0,
    info: 'Fester Vorteig (45–55 % Hydration), meist 0,5–1 % Hefe. Typisch 2 h RT + 16–48 h Kühlschrank.' },
  poolish: { label: 'Poolish', icon: '🫧', hydration: 100, flourPct: 30, yeastPct: 0.3, starterPct: 0,
    info: 'Flüssiger Vorteig (100 % Hydration). Hefemenge je nach Zeit: 0,1 % (16 h RT) bis 1 % (3 h).' },
  levain: { label: 'Sauerteig', icon: '🌾', hydration: 100, flourPct: 10, yeastPct: 0, starterPct: 20, starterHydration: 100,
    info: 'Levain aus Anstellgut + frischem Mehl/Wasser. Anstellgut 10–50 % vom frischen Mehl, reif nach 4–12 h.' },
  madre: { label: 'Lievito Madre', icon: '🫙', hydration: 50, flourPct: 10, yeastPct: 0, starterPct: 100, starterHydration: 50,
    info: 'Fester italienischer Sauerteig (45–50 % Hydration). Auffrischen meist 1 : 1 : 0,5 (Madre : Mehl : Wasser), reif nach 3–4 h bei 26–28 °C.' },
  custom: { label: 'Eigener Vorteig', icon: '🥣', hydration: 70, flourPct: 20, yeastPct: 0, starterPct: 0,
    info: 'Frei definierbar – z. B. Pâte fermentée, Roggensauer, Quellstück (ohne Hefe).' },
};

export const STEP_KINDS = {
  prep: { label: 'Vorteig ansetzen', icon: '🥣' },
  autolyse: { label: 'Autolyse', icon: '💧' },
  mix: { label: 'Mischen / Kneten', icon: '🌀' },
  bulk: { label: 'Stockgare', icon: '⏳' },
  rest: { label: 'Ruhen / Reifen', icon: '💤' },
  fold: { label: 'Dehnen & Falten', icon: '🙌' },
  shape: { label: 'Formen / Ballen', icon: '🫓' },
  laminate: { label: 'Tourieren', icon: '🧈' },
  proof: { label: 'Stückgare', icon: '🎈' },
  temper: { label: 'Akklimatisieren', icon: '🌡️' },
  preheat: { label: 'Ofen vorheizen', icon: '♨️' },
  bake: { label: 'Backen', icon: '🔥' },
  cool: { label: 'Auskühlen', icon: '🧊' },
  assemble: { label: 'Füllen / Fertigstellen', icon: '🎂' },
  other: { label: 'Sonstiges', icon: '📝' },
};

// Rezept-Kategorien. „cake“ nutzt ein eigenes Modell: Zutatenliste in Bestandteilen + Backform (statt Bäckerprozenten).
export const CATEGORIES = ['pizza', 'bread', 'fine', 'cake', 'other'];
export const isCake = (r) => r?.category === 'cake';

// ---------- Kuchen & Torten: Einheiten und Backformen ----------
export const UNITS = ['g', 'ml', 'Stk', 'EL', 'TL', 'Pck', 'Prise'];
export const PAN_SHAPES = { round: 'Rund', rect: 'Eckig', count: 'Stück' };
export function panArea(p) {
  if (!p) return 0;
  if (p.shape === 'round') return Math.PI * (num(p.d) / 2) ** 2;
  if (p.shape === 'rect') return num(p.l) * num(p.w);
  return 0;
}
export const panValid = (p) => (p?.shape === 'count' ? num(p.n) > 0 : panArea(p) > 0);
// Umrechnungsfaktor von der Rezept-Form auf eine andere Form (gleiche Höhe → nach Fläche; Stück → nach Anzahl)
export function panFactor(base, target) {
  if (!panValid(base) || !panValid(target)) return 1;
  if (base.shape === 'count' || target.shape === 'count') return base.shape === target.shape ? num(target.n) / num(base.n) : 1;
  return panArea(target) / panArea(base);
}
export function panLabel(p) {
  if (!panValid(p)) return '';
  if (p.shape === 'round') return `Ø ${fmtNum(p.d)} cm`;
  if (p.shape === 'rect') return `${fmtNum(p.l)} × ${fmtNum(p.w)} cm`;
  return `${fmtNum(p.n, 0)} Stück`;
}
// Ungefähres Gewicht je Stück (für „1½ Eier ≈ 80 g“)
const PIECE_G = [[/eigelb/i, 18], [/eiwei(ß|ss)|eiklar/i, 33], [/\bei(er)?\b|vollei/i, 52]];
export const pieceGrams = (name) => PIECE_G.find(([re]) => re.test(name || ''))?.[1] || 0;

// Kuchen-Rezept berechnen: ov.factor (direkt) oder ov.pan (Zielform) – sonst Rezept-Form
export function calcCake(r, ov = {}) {
  const base = r.pan || {};
  let factor = 1, pan = base;
  if (num(ov.factor) > 0) { factor = num(ov.factor); pan = null; }
  else if (ov.pan && panValid(ov.pan)) { pan = ov.pan; factor = panFactor(base, ov.pan); }
  const warnings = [];
  if (ov.pan && panValid(ov.pan) && panValid(base) && (base.shape === 'count') !== (ov.pan.shape === 'count')) warnings.push('Stückzahl und Backform lassen sich nicht ineinander umrechnen – es gilt die Rezeptmenge.');
  const parts = (r.parts || []).map((p) => {
    const items = (p.items || []).map((it) => {
      const v = num(it.amount) * factor;
      return { name: it.name, unit: it.unit || 'g', amount: num(it.amount), v, g: it.unit === 'g' || !it.unit ? v : it.unit === 'ml' ? v : it.unit === 'Stk' && pieceGrams(it.name) ? v * pieceGrams(it.name) : null };
    });
    return { id: p.id, name: p.name, items, g: items.reduce((s, x) => s + (x.g || 0), 0) };
  });
  const total = parts.reduce((s, p) => s + p.g, 0);
  return { kind: 'cake', factor, pan, parts, total, warnings };
}

// Wasseranteil typischer flüssiger Zutaten (für die „wirksame Hydration“ bei Feingebäck)
const LIQUID = [[/buttermilch/i, 90], [/milch|milk/i, 87], [/eigelb/i, 50], [/eiwei(ß|ss)|eiklar/i, 88], [/\bei(er)?\b|vollei/i, 75],
  [/sahne|rahm/i, 60], [/butter/i, 16], [/joghurt/i, 85], [/quark|topfen/i, 80], [/honig/i, 17], [/saft|bier|wein/i, 90]];
export const liquidShare = (name) => (LIQUID.find(([re]) => re.test(name || ''))?.[1] || 0) / 100;

export const LOCATIONS = {
  rt: { label: 'Raumtemperatur', short: 'RT', icon: '🏠' },
  fridge: { label: 'Kühlschrank', short: 'Kühlschrank', icon: '❄️' },
  warm: { label: 'Warm (Gärbox)', short: 'Warm', icon: '☀️' },
  oven: { label: 'Ofen', short: 'Ofen', icon: '🔥' },
};

// ---------- Formatierung ----------
const nfCache = {};
const nf = (d) => (nfCache[d] ||= new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export function fmtNum(x, d = 1) { return nf(d).format(num(x)); }
export function fmtG(g) {
  if (!Number.isFinite(g)) return '–';
  const a = Math.abs(g);
  return nf(a < 1 ? 2 : a < 20 ? 1 : 0).format(g) + ' g';
}
export function fmtPct(x) { const v = num(x); return nf(Math.abs(v) < 1 ? 2 : 1).format(v) + ' %'; }
export function fmtDur(min) {
  min = Math.round(num(min));
  if (min < 60) return `${min} min`;
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  const parts = [];
  if (d) parts.push(`${d} T`);
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  return parts.join(' ');
}
const tf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
export const fmtTime = (ms) => tf.format(ms);
export function fmtRel(ms) {
  if (!Number.isFinite(ms)) return '–';
  const d = new Date(ms), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  const t = fmtTime(ms);
  if (diff === 0) return `heute ${t}`;
  if (diff === 1) return `morgen ${t}`;
  if (diff === 2) return `übermorgen ${t}`;
  if (diff === -1) return `gestern ${t}`;
  return `${df.format(d)} ${t}`;
}
export function fmtCountdown(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p2 = (x) => String(x).padStart(2, '0');
  if (d > 0) return `${d} T ${h}:${p2(m)} h`;
  if (h > 0) return `${h}:${p2(m)}:${p2(sec)}`;
  return `${m}:${p2(sec)}`;
}

// ---------- Teigberechnung ----------
// Alle Prozentwerte beziehen sich auf die GESAMTE Mehlmenge (inkl. Mehl in Vorteigen = 100 %).
// Vorteig-Hefe bezieht sich auf das Vorteigmehl, Anstellgut auf das frische Mehl im Levain.
export function calc(r, ov = {}) {
  const y = { ...r.yield, ...(ov.yield || {}) };
  const pfs = r.preferments || [];
  const waterPct = ov.hydration != null && ov.hydration !== '' ? num(ov.hydration) : num(r.water?.pct);
  const fr = {
    water: waterPct / 100,
    oil: p(r.oil?.pct),
    salt: p(r.salt),
    yeast: p(r.yeastPct),
    pfYeast: sum(pfs, (pf) => p(pf.flourPct) * p(pf.yeastPct)),
    extras: sum(r.extras || [], (e) => p(e.pct)),
    // Ab Schema 4: Ziehfett zum Tourieren (Croissant, Plunder) in % vom Mehl – gehört zum Teiggewicht
    lam: Math.max(0, p(r.lamination?.pct)),
  };
  const S = 1 + fr.water + fr.oil + fr.salt + fr.yeast + fr.pfYeast + fr.extras + fr.lam;
  const loss = 1 + p(y.loss);
  let F, D, count = num(y.count);
  const pw = num(y.pieceWeight);
  if (y.mode === 'flour') { F = num(y.flour); D = F * S; count = pw > 0 ? D / loss / pw : 0; }
  else { D = count * pw * loss; F = D / S; }
  const warnings = [];

  const blend = r.flours && r.flours.length ? r.flours : [{ name: 'Mehl', pct: 100 }];
  const blendSum = sum(blend, (f) => num(f.pct)) || 100;
  if (Math.abs(blendSum - 100) > 0.5) warnings.push(`Die Mehlanteile ergeben ${fmtNum(blendSum)} % statt 100 % – es wird anteilig gerechnet.`);
  const flours = blend.map((f) => ({ name: f.name || 'Mehl', total: (F * num(f.pct)) / blendSum, g: (F * num(f.pct)) / blendSum }));

  const pfRes = pfs.map((pf) => {
    const flour = F * p(pf.flourPct);
    const water = flour * p(pf.hydration);
    const yeast = flour * p(pf.yeastPct);
    let starter = 0, sFlour = 0, sWater = 0;
    if (num(pf.starterPct) > 0) {
      const i = p(pf.starterPct), hS = p(pf.starterHydration ?? 100);
      const fresh = flour / (1 + i / (1 + hS));
      starter = fresh * i; sFlour = starter / (1 + hS); sWater = starter - sFlour;
    }
    const target = flours.find((f) => f.name === pf.flourName) || flours[0];
    target.g -= flour;
    return { id: pf.id, pf, flourName: target.name, flour, water, yeast, starter, freshFlour: flour - sFlour, freshWater: water - sWater, total: flour + water + yeast };
  });
  flours.forEach((f) => { if (f.g < -0.5) warnings.push(`Die Vorteige brauchen mehr „${f.name}“ als im Rezept vorgesehen.`); });
  const pfFlourPct = sum(pfs, (pf) => num(pf.flourPct));
  if (pfFlourPct > 100.01) warnings.push(`Die Vorteige enthalten zusammen ${fmtNum(pfFlourPct)} % des Mehls – mehr als 100 % geht nicht.`);

  const totalWater = F * fr.water;
  const pfWater = sum(pfRes, (x) => x.water);
  const mainWater = totalWater - pfWater;
  if (mainWater < -0.5) warnings.push('Die Vorteige enthalten mehr Wasser als die Gesamthydration erlaubt – Hydration erhöhen oder Vorteig-Hydration senken.');
  const oil = F * fr.oil, salt = F * fr.salt, yeastMain = F * fr.yeast;
  const extras = (r.extras || []).map((e) => ({ name: e.name, pct: num(e.pct), g: F * p(e.pct) }));
  // Optional (ab Schema 3): Wassertemperatur und Eis-Anteil des Hauptteig-Wassers – ändert die Hydration nicht
  const waterTemp = optNum(r.water?.temp);
  const icePct = Math.min(100, Math.max(0, num(r.water?.icePct)));
  const ice = Math.max(0, mainWater) * icePct / 100;
  const lamG = F * fr.lam;
  // Wirksame Flüssigkeit: Wasser + Wasseranteil von Milch, Ei, Butter … (nur Anzeige, ändert nichts an den Mengen)
  const liquid = totalWater + sum(extras, (e) => e.g * liquidShare(e.name));

  return {
    F, D, count, pieceWeight: pw, mode: y.mode, warnings,
    pfs: pfRes,
    main: { flours: flours.map((f) => ({ name: f.name, g: f.g })), water: mainWater, oil, salt, yeast: yeastMain, extras, waterTemp, ice, icePct },
    lam: { g: lamG, pct: fr.lam * 100, name: (r.lamination?.name || '').trim() || 'Butter', base: D - lamG },
    totals: {
      flour: F, water: totalWater, oil, salt, dough: D, lam: lamG,
      liquid, hydEff: F > 0 ? (liquid / F) * 100 : 0,
      yeast: yeastMain + sum(pfRes, (x) => x.yeast),
      starter: sum(pfRes, (x) => x.starter),
      extras: sum(extras, (e) => e.g),
      hydration: waterPct,
      hydrationOil: F > 0 ? ((totalWater + oil) / F) * 100 : 0,
      pfFlourPct,
      flours: flours.map((f) => ({ name: f.name, g: f.total, pct: F > 0 ? (f.total / F) * 100 : 0 })),
    },
  };
}

// Wasser/Öl in Gramm eingegeben -> Prozentwert berechnen (gilt auch, wenn die Mehlmenge aus dem Teiggewicht folgt)
export function pctFromGrams(r, field, grams) {
  const c = calc(r);
  if (r.yield.mode === 'flour') return c.F > 0 ? (grams / c.F) * 100 : 0;
  const S = c.F > 0 ? c.D / c.F : 1;
  const Sw = S - p(r[field]?.pct);
  const F = (c.D - grams) / Sw;
  return F > 0 ? (grams / F) * 100 : 0;
}

// Wassertemperatur für Zielteigtemperatur (Faktor 3 ohne, 4 mit Vorteig)
export function waterTemp({ ddt, room, flour, pf, friction, hasPf }) {
  const nF = hasPf ? 4 : 3;
  return num(ddt) * nF - (num(room) + num(flour) + (hasPf ? num(pf) : 0) + num(friction));
}

// ---------- Zeitplanung ----------
// Schritte laufen nacheinander; "parallel" startet gleichzeitig mit dem vorherigen Schritt.
// now: für laufende Backvorgänge – nicht erledigte, überfällige Schritte gelten als "jetzt fertig".
export function timeline(steps, startAt, now = -Infinity) {
  const out = [];
  let maxFinish = startAt;
  (steps || []).forEach((s, i) => {
    const start = i === 0 ? startAt : s.parallel ? out[i - 1].start : maxFinish;
    const end = start + num(s.durationMin) * 60000;
    const finish = s.doneAt ?? Math.max(end, now);
    maxFinish = i === 0 ? finish : Math.max(maxFinish, finish);
    out.push({ ...s, i, start, end, finish });
  });
  return out;
}

export function planInfo(steps, startAt, now = -Infinity) {
  const tl = timeline(steps, startAt, now);
  const endAt = tl.length ? Math.max(...tl.map((s) => s.finish)) : startAt;
  const bake = tl.find((s) => s.kind === 'bake');
  const bakeAt = bake ? bake.start : endAt;
  return { tl, startAt, endAt, bakeAt, total: (endAt - startAt) / 60000, bakeOff: (bakeAt - startAt) / 60000 };
}

export function locationMinutes(steps) {
  const out = { rt: 0, fridge: 0, warm: 0, oven: 0 };
  (steps || []).forEach((s) => { if (!s.parallel) out[s.location] = (out[s.location] || 0) + num(s.durationMin); });
  return out;
}

// ---------- Temperatur-Ausgleich ----------
// Faustregel: Gärung läuft pro +8 °C etwa doppelt so schnell (+4 °C ≈ 30 % kürzer).
export function parseTemp(t) {
  // „24-26 °C“ ist ein Bereich, keine negative Zahl
  const m = String(t ?? '').replace(/,/g, '.').replace(/(\d)\s*[-–—]\s*(?=\d)/g, '$1 ').match(/-?\d+(\.\d+)?/g);
  if (!m) return null;
  const v = m.slice(0, 2).map(Number);
  return v.reduce((a, b) => a + b, 0) / v.length;
}
const COMP_KINDS = ['bulk', 'rest', 'proof', 'fold'];
const has = (v) => v !== undefined && v !== null && v !== '';
export function compFactor(actual, ref) {
  const delta = Math.max(-12, Math.min(12, actual - ref));
  return Math.pow(2, -delta / 8);
}
// Passt Gare-Schritte bei RT/Warm an die tatsächliche Temperatur an.
// room: erwartete Raumtemperatur (aus dem Planer); gemessene Werte (meas.room) gelten ab ihrem Schritt.
export function compensateSteps(steps, { room = null, refRoom = 22 } = {}) {
  let last = has(room) ? num(room) : null;
  return (steps || []).map((s) => {
    const m = s.meas?.room;
    if (has(m) && s.location !== 'warm') last = num(m);
    if (!COMP_KINDS.includes(s.kind) || !(s.location === 'rt' || s.location === 'warm')) return s;
    const actual = s.location === 'warm' ? (has(m) ? num(m) : null) : last;
    if (actual === null) return s;
    const ref = parseTemp(s.temp) ?? (s.location === 'warm' ? 26 : num(refRoom));
    if (Math.abs(actual - ref) < 0.5) return s;
    const dur = Math.max(1, Math.round(num(s.durationMin) * compFactor(actual, ref)));
    return { ...s, durationMin: dur, _comp: { from: num(s.durationMin), actual, ref } };
  });
}

export function isNight(ms, from, to) {
  const d = new Date(ms);
  const h = d.getHours() + d.getMinutes() / 60;
  return from > to ? h >= from || h < to : h >= from && h < to;
}

// ---------- Importierte Daten bereinigen ----------
// Fremde Dateien/QR-Links dürfen nur erwartete Werte enthalten (Schutz vor eingeschleustem HTML/JS).
export const safeId = (v) => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 48);
const str = (v, max = 4000) => (v === undefined || v === null ? '' : String(v).slice(0, max));
const pick = (v, allowed, fallback) => (Object.prototype.hasOwnProperty.call(allowed, v) ? v : fallback);

// Felder, die diese App-Version (noch) nicht kennt, unverändert aufbewahren – z. B. aus einer
// Sicherung einer neueren Version. Sie werden nie angezeigt, gehen aber auch nicht verloren.
function keepUnknown(src, known) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of Object.keys(src)) {
    if (known.includes(k) || k.startsWith('_') || !/^[\w-]{1,40}$/.test(k)) continue;
    try {
      const json = JSON.stringify(src[k]);
      if (json !== undefined && json.length <= 20000) out[k] = JSON.parse(json);
    } catch { /* nicht speicherbar → auslassen */ }
  }
  return out;
}
const R_KEYS = ['v', 'id', 'name', 'category', 'description', 'source', 'tags', 'favorite', 'photos', 'cover', 'yield', 'flours', 'water', 'oil', 'salt', 'yeastType', 'yeastPct', 'extras', 'preferments', 'steps', 'ddt', 'notes', 'createdAt', 'updatedAt', 'lamination', 'pan', 'parts'];
const PF_KEYS = ['id', 'type', 'name', 'flourPct', 'hydration', 'yeastPct', 'starterPct', 'starterHydration', 'flourName'];
const ST_KEYS = ['id', 'kind', 'name', 'durationMin', 'location', 'temp', 'notes', 'parallel', 'stage', 'repeat'];
const L_KEYS = ['v', 'id', 'recipeId', 'date', 'rating', 'sub', 'params', 'roomTemp', 'doughTemp', 'fridgeTemp', 'waterTemp', 'iceG', 'oven', 'bakeTemp', 'bakeTime', 'notes', 'nextTime', 'photos', 'sessionId', 'createdAt', 'updatedAt'];

export function sanitizeRecipe(r) {
  const pfIds = new Map();
  const preferments = (Array.isArray(r.preferments) ? r.preferments : []).map((pf) => {
    const id = safeId(pf.id) || uid();
    pfIds.set(pf.id, id);
    return { ...keepUnknown(pf, PF_KEYS), id, type: pick(pf.type, PF_TYPES, 'custom'), name: str(pf.name, 80), flourPct: num(pf.flourPct), hydration: num(pf.hydration),
      yeastPct: num(pf.yeastPct), starterPct: num(pf.starterPct), starterHydration: num(pf.starterHydration ?? 100), flourName: str(pf.flourName, 80) };
  });
  // Kuchen & Torten (ab Schema 4): Bestandteile (Teig, Füllung, Creme …) mit Zutaten in beliebigen Einheiten
  const partIds = new Map();
  const parts = (Array.isArray(r.parts) ? r.parts : []).slice(0, 30).map((pt) => {
    const id = safeId(pt?.id) || uid();
    partIds.set(pt?.id, id);
    return { ...keepUnknown(pt, ['id', 'name', 'items']), id, name: str(pt?.name, 80),
      items: (Array.isArray(pt?.items) ? pt.items : []).slice(0, 100).map((it) => ({ ...keepUnknown(it, ['name', 'amount', 'unit']),
        name: str(it?.name, 80), amount: Math.max(0, num(it?.amount)), unit: UNITS.includes(it?.unit) ? it.unit : 'g' })) };
  });
  const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => ({
    ...keepUnknown(s, ST_KEYS),
    id: safeId(s.id) || uid(), kind: pick(s.kind, STEP_KINDS, 'other'), name: str(s.name, 120), durationMin: Math.max(0, num(s.durationMin)),
    location: pick(s.location, LOCATIONS, 'rt'), temp: str(s.temp, 40), notes: str(s.notes, 2000), parallel: !!s.parallel,
    stage: s.stage === 'main' || s.stage === 'lam' ? s.stage : pfIds.get(s.stage) || partIds.get(s.stage) || null,
    repeat: s.repeat && num(s.repeat.count) > 0 ? { count: Math.round(num(s.repeat.count)), intervalMin: Math.max(1, num(s.repeat.intervalMin)) } : null,
  }));
  const y = r.yield || {};
  const photos = (Array.isArray(r.photos) ? r.photos : []).map(safeId).filter(Boolean);
  return {
    ...keepUnknown(r, R_KEYS),
    v: Math.max(1, Math.floor(num(r.v)) || 1),
    // Unbekannte/fehlende Angaben NICHT raten – leer lassen, die App fragt nach (migrate.js → CHECKS)
    id: safeId(r.id) || uid(), name: str(r.name, 120), category: CATEGORIES.includes(r.category) ? r.category : '',
    description: str(r.description, 500), source: str(r.source, 300), tags: (Array.isArray(r.tags) ? r.tags : []).map((t) => str(t, 40)).slice(0, 20), favorite: !!r.favorite,
    photos, cover: photos.includes(safeId(r.cover)) ? safeId(r.cover) : null,
    yield: { ...keepUnknown(y, ['mode', 'count', 'pieceWeight', 'flour', 'loss']), mode: y.mode === 'flour' ? 'flour' : 'pieces', count: num(y.count) || 1, pieceWeight: num(y.pieceWeight), flour: num(y.flour), loss: num(y.loss) },
    flours: (Array.isArray(r.flours) ? r.flours : []).map((f) => ({ name: str(f.name, 80), pct: num(f.pct) })),
    water: { ...keepUnknown(r.water, ['pct', 'temp', 'icePct']), pct: num(r.water?.pct), temp: optNum(r.water?.temp), icePct: optNum(r.water?.icePct) === '' ? '' : Math.min(100, Math.max(0, optNum(r.water.icePct))) },
    oil: { ...keepUnknown(r.oil, ['pct']), pct: num(r.oil?.pct) }, salt: num(r.salt),
    yeastType: r.yeastType === 'dry' || r.yeastType === 'fresh' ? r.yeastType : '', yeastPct: num(r.yeastPct),
    extras: (Array.isArray(r.extras) ? r.extras : []).map((e) => ({ name: str(e.name, 80), pct: num(e.pct) })),
    preferments, steps, ddt: num(r.ddt ?? 24), notes: str(r.notes, 8000),
    lamination: { ...keepUnknown(r.lamination, ['pct', 'name']), pct: Math.max(0, num(r.lamination?.pct)), name: str(r.lamination?.name, 80) },
    // Form: '' = keine Angabe (dann nur Umrechnen per Faktor) – wird nicht geraten
    pan: { ...keepUnknown(r.pan, ['shape', 'd', 'l', 'w', 'n']), shape: Object.prototype.hasOwnProperty.call(PAN_SHAPES, r.pan?.shape) ? r.pan.shape : '',
      d: Math.max(0, num(r.pan?.d)), l: Math.max(0, num(r.pan?.l)), w: Math.max(0, num(r.pan?.w)), n: Math.max(0, Math.round(num(r.pan?.n))) },
    parts,
    createdAt: num(r.createdAt) || Date.now(), updatedAt: num(r.updatedAt) || Date.now(),
  };
}

export function sanitizeLog(l) {
  const p = l.params || {};
  const sub = {};
  Object.entries(l.sub || {}).forEach(([k, v]) => { const kk = safeId(k); if (kk) sub[kk] = Math.max(0, Math.min(5, Math.round(num(v)))); });
  return {
    ...keepUnknown(l, L_KEYS),
    v: Math.max(1, Math.floor(num(l.v)) || 1),
    id: safeId(l.id) || uid(), recipeId: safeId(l.recipeId), date: /^\d{4}-\d{2}-\d{2}$/.test(l.date) ? l.date : '',
    rating: Math.max(0, Math.min(5, Math.round(num(l.rating)))), sub,
    params: { ...keepUnknown(p, ['hydration', 'salt', 'yeastPct', 'pf', 'count', 'pieceWeight', 'totalHours', 'flour', 'pan']), hydration: num(p.hydration), salt: num(p.salt), yeastPct: num(p.yeastPct), pf: str(p.pf, 120), count: num(p.count),
      pieceWeight: num(p.pieceWeight), totalHours: num(p.totalHours), flour: str(p.flour, 200), pan: str(p.pan, 80) },
    roomTemp: str(l.roomTemp, 10), doughTemp: str(l.doughTemp, 10), fridgeTemp: str(l.fridgeTemp, 10), waterTemp: str(l.waterTemp, 10), iceG: str(l.iceG, 10), oven: str(l.oven, 80),
    bakeTemp: str(l.bakeTemp, 10), bakeTime: str(l.bakeTime, 40), notes: str(l.notes, 4000), nextTime: str(l.nextTime, 1000),
    photos: (Array.isArray(l.photos) ? l.photos : []).map(safeId).filter(Boolean), sessionId: safeId(l.sessionId) || null,
    createdAt: num(l.createdAt) || Date.now(), updatedAt: num(l.updatedAt) || 0,
  };
}

// ---------- Vorlagen ----------
export const step = (kind, name, durationMin, location = 'rt', extra = {}) => ({
  id: uid(), kind, name, durationMin, location, temp: '', stage: null, notes: '', parallel: false, repeat: null, ...extra,
});

export function makePf(type, extra = {}) {
  const t = PF_TYPES[type] || PF_TYPES.custom;
  return { id: uid(), type, name: t.label, flourPct: t.flourPct, hydration: t.hydration, yeastPct: t.yeastPct,
    starterPct: t.starterPct || 0, starterHydration: t.starterHydration || 100, flourName: '', ...extra };
}

export function blankRecipe(category = 'pizza') {
  const bread = category === 'bread', fine = category === 'fine', cake = category === 'cake';
  const r = {
    id: uid(), name: '', category, description: '', tags: [], favorite: false, photos: [], cover: null,
    yield: bread ? { mode: 'pieces', count: 1, pieceWeight: 900, flour: 500, loss: 0 } : fine ? { mode: 'pieces', count: 12, pieceWeight: 80, flour: 500, loss: 5 } : { mode: 'pieces', count: 6, pieceWeight: 260, flour: 1000, loss: 0 },
    flours: [{ name: bread || fine ? 'Weizenmehl 550' : 'Tipo 00', pct: 100 }],
    water: { pct: bread ? 72 : fine ? 30 : 65, temp: '', icePct: '' }, oil: { pct: 0 }, salt: bread ? 2 : fine ? 1.8 : 2.8,
    yeastType: 'fresh', yeastPct: bread ? 0 : fine ? 3 : 0.2,
    extras: fine ? [{ name: 'Milch', pct: 25 }, { name: 'Zucker', pct: 10 }, { name: 'Butter', pct: 8 }] : [], preferments: [], steps: [], ddt: bread ? 25 : fine ? 24 : 23, notes: '',
    lamination: { pct: 0, name: '' }, pan: { shape: '', d: 0, l: 0, w: 0, n: 0 }, parts: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (cake) {
    // Kuchen: keine Bäckerprozente – Zutatenliste je Bestandteil + Backform
    Object.assign(r, { flours: [], yield: { mode: 'pieces', count: 1, pieceWeight: 0, flour: 0, loss: 0 }, water: { pct: 0, temp: '', icePct: '' }, salt: 0, yeastType: '', yeastPct: 0, ddt: 22,
      pan: { shape: 'round', d: 26, l: 0, w: 0, n: 0 }, parts: [{ id: uid(), name: 'Teig', items: [] }] });
  }
  return r;
}
const part = (name, items) => ({ id: uid(), name, items: items.map(([n, amount, unit = 'g']) => ({ name: n, amount, unit })) });

function pfChain(pf) {
  const nm = pf.name || PF_TYPES[pf.type]?.label || 'Vorteig';
  const st = { stage: pf.id };
  if (pf.type === 'biga') return { nm, prep: step('prep', `${nm} ansetzen`, 15, 'rt', st), rest: [step('rest', `${nm} anspringen lassen`, 120, 'rt', st), step('rest', `${nm} reifen`, 1440, 'fridge', { ...st, temp: '4–5 °C' })] };
  if (pf.type === 'poolish') return { nm, prep: step('prep', `${nm} ansetzen`, 10, 'rt', st), rest: [step('rest', `${nm} anspringen lassen`, 60, 'rt', st), step('rest', `${nm} reifen`, 960, 'fridge', st)] };
  if (pf.type === 'levain') return { nm, prep: step('prep', `${nm} ansetzen`, 5, 'rt', { ...st, notes: 'Anstellgut mit Mehl und warmem Wasser verrühren.' }), rest: [step('rest', `${nm} reifen`, 480, 'warm', { ...st, temp: '26 °C', notes: 'Reif, wenn verdoppelt und gewölbt.' })] };
  if (pf.type === 'madre') return { nm, prep: step('prep', `${nm} auffrischen`, 10, 'rt', { ...st, notes: 'Madre mit Mehl und Wasser fest verkneten, zur Kugel formen, kreuzweise einschneiden.' }), rest: [step('rest', `${nm} reifen`, 240, 'warm', { ...st, temp: '26–28 °C', notes: 'Reif, wenn sich das Volumen verdoppelt hat.' })] };
  return { nm, prep: step('prep', `${nm} ansetzen`, 10, 'rt', st), rest: [step('rest', `${nm} reifen`, 720, 'rt', st)] };
}

export function suggestSteps(r) {
  if (isCake(r)) {
    const parts = (r.parts || []).length ? r.parts : [{ id: null, name: 'Teig' }];
    const out = parts.map((p) => step('mix', `${p.name || 'Teig'} zubereiten`, 15, 'rt', { stage: p.id }));
    out.splice(1, 0, step('preheat', 'Ofen vorheizen', 15, 'oven', { temp: '175 °C', parallel: true }));
    out.push(step('bake', 'Backen', 45, 'oven', { temp: '175 °C', notes: 'Stäbchenprobe: Es darf kein Teig mehr kleben bleiben.' }), step('cool', 'Auskühlen', 60, 'rt'));
    if (parts.length > 1) out.push(step('assemble', 'Füllen & fertigstellen', 20, 'rt'));
    return out;
  }
  if (r.category === 'fine') return suggestFine(r);
  const out = [];
  // Mehrere Vorteige: alle gleichzeitig ansetzen (parallel), Reifezeit richtet sich nach dem ersten Vorteig.
  const chains = (r.preferments || []).map(pfChain);
  chains.forEach((c, i) => out.push(i ? { ...c.prep, parallel: true } : c.prep));
  if (chains.length) {
    const rest = chains[0].rest;
    if (chains.length > 1) {
      const others = chains.slice(1).map((c) => `${c.nm}: ${c.rest.map((s) => `${Math.round(s.durationMin / 60)} h ${s.location === 'fridge' ? 'Kühlschrank' : 'Raum'}`).join(' + ')}`).join('; ');
      rest.forEach((s) => { s.name = s.name.replace(chains[0].nm, 'Vorteige'); s.stage = null; s.notes = `Richtwert für ${chains[0].nm}. Weitere: ${others} – bei Bedarf früher ansetzen.`; });
    }
    out.push(...rest);
  }
  if (r.category === 'bread') {
    out.push(
      step('autolyse', 'Autolyse', 60, 'rt', { stage: 'main', notes: 'Mehl und Wasser mischen, abgedeckt ruhen lassen.' }),
      step('mix', 'Teig fertig kneten', 15, 'rt', { stage: 'main', notes: 'Vorteig, Salz und Restwasser einarbeiten.' }),
      step('bulk', 'Stockgare mit Dehnen & Falten', 240, 'rt', { temp: '24–26 °C', repeat: { count: 4, intervalMin: 30 } }),
      step('shape', 'Formen', 15, 'rt'),
      step('proof', 'Stückgare (kalt)', 840, 'fridge'),
      step('preheat', 'Ofen + Topf vorheizen', 45, 'oven', { temp: '250 °C' }),
      step('bake', 'Brot backen', 45, 'oven', { temp: '250 → 230 °C' }),
      step('cool', 'Auskühlen', 90, 'rt'),
    );
  } else {
    const hasPf = (r.preferments || []).length > 0;
    out.push(
      step('mix', 'Hauptteig mischen', 20, 'rt', { stage: 'main' }),
      step('bulk', 'Stockgare', hasPf ? 60 : 120, 'rt'),
      step('shape', 'Ballen formen', 15, 'rt'),
      step('proof', 'Ballengare', hasPf ? 720 : 1440, 'fridge'),
      step('temper', 'Akklimatisieren', 180, 'rt', { notes: 'Ballen rechtzeitig aus dem Kühlschrank holen.' }),
      step('bake', 'Pizza backen', 30, 'oven'),
    );
  }
  return out;
}

// Feingebäck: mit Ziehfett → Tourieren (Croissant/Plunder), sonst angereicherter Hefeteig (Brioche, Zopf)
function suggestFine(r) {
  const out = [step('mix', 'Teig kneten', 15, 'rt', { stage: 'main' })];
  if (num(r.lamination?.pct) > 0) {
    out.push(
      step('rest', 'Grundteig kühlen', 720, 'fridge', { temp: '4 °C', notes: 'Flach drücken, in Folie kühlen. Butterplatte vorbereiten und ebenfalls kühlen.' }),
      step('laminate', 'Butter einschlagen + 1. Tour', 15, 'rt', { stage: 'lam', notes: 'Teig und Butter sollen gleich kühl und biegsam sein.' }),
      step('rest', 'Kühlen', 30, 'fridge'),
      step('laminate', '2. Tour', 10, 'rt'),
      step('rest', 'Kühlen', 30, 'fridge'),
      step('laminate', '3. Tour', 10, 'rt'),
      step('rest', 'Kühlen', 60, 'fridge'),
      step('shape', 'Ausrollen & formen', 30, 'rt'),
      step('proof', 'Stückgare', 120, 'warm', { temp: '26 °C', notes: 'Nicht über 27 °C – sonst läuft die Butter aus.' }),
      step('bake', 'Backen', 18, 'oven', { temp: '190 °C' }),
    );
  } else {
    out.push(step('bulk', 'Stockgare', 60, 'warm', { temp: '26 °C' }), step('shape', 'Formen', 20, 'rt'),
      step('proof', 'Stückgare', 60, 'warm', { temp: '28 °C' }), step('bake', 'Backen', 30, 'oven', { temp: '180 °C' }));
  }
  out.push(step('cool', 'Auskühlen', 30, 'rt'));
  return out;
}

export const TEMPLATES = [
  {
    id: 'napoli-biga', icon: '🍕', name: 'Pizza Napoletana · Biga', desc: '50 % Biga · 68 % · ca. 43 h',
    build() {
      const r = blankRecipe('pizza');
      Object.assign(r, { name: 'Pizza Napoletana mit Biga', description: 'Luftiger Rand dank 50 % Biga – 2 h RT + 24 h Kühlschrank.', salt: 2.8, yeastPct: 0, tags: ['Napoletana', 'Biga'] });
      r.water.pct = 68; r.flours = [{ name: 'Tipo 00 (W300+)', pct: 100 }];
      const b = makePf('biga', { flourName: 'Tipo 00 (W300+)' });
      r.preferments = [b];
      r.steps = [
        step('prep', 'Biga ansetzen', 15, 'rt', { stage: b.id, notes: 'Mehl, kaltes Wasser (ca. 18 °C) und Hefe nur grob vermengen – krümelig lassen, nicht kneten.' }),
        step('rest', 'Biga anspringen lassen', 120, 'rt', { stage: b.id }),
        step('rest', 'Biga reifen', 1440, 'fridge', { stage: b.id, temp: '4–5 °C' }),
        step('mix', 'Hauptteig mischen', 20, 'rt', { stage: 'main', notes: 'Biga mit dem Großteil des Wassers lösen, Mehl zugeben, Salz nach 5 min, Restwasser schluckweise.' }),
        step('bulk', 'Stockgare', 60, 'rt'),
        step('shape', 'Ballen formen', 15, 'rt', { notes: 'Teiglinge straff schleifen, in leicht geölte Boxen.' }),
        step('proof', 'Ballengare', 720, 'fridge'),
        step('temper', 'Akklimatisieren', 180, 'rt', { notes: 'Ofen in der letzten Stunde vorheizen.' }),
        step('bake', 'Pizza backen', 30, 'oven', { temp: '430–480 °C', notes: '60–90 Sekunden pro Pizza.' }),
      ];
      return r;
    },
  },
  {
    id: 'poolish', icon: '🫧', name: 'Pizza mit Poolish', desc: '30 % Poolish · 70 % · ca. 25 h',
    build() {
      const r = blankRecipe('pizza');
      Object.assign(r, { name: 'Pizza mit Poolish', description: 'Aromatisch und leicht – Poolish über Nacht im Kühlschrank.', salt: 2.8, yeastPct: 0.1, tags: ['Poolish'] });
      r.water.pct = 70;
      const pf = makePf('poolish', { flourPct: 30 });
      r.preferments = [pf];
      r.steps = [
        step('prep', 'Poolish ansetzen', 10, 'rt', { stage: pf.id, notes: 'Hefe im Wasser auflösen, Mehl einrühren, abdecken.' }),
        step('rest', 'Poolish anspringen lassen', 60, 'rt', { stage: pf.id }),
        step('rest', 'Poolish reifen', 960, 'fridge', { stage: pf.id, notes: 'Reif, wenn voller Bläschen und leicht eingefallen.' }),
        step('mix', 'Hauptteig mischen', 20, 'rt', { stage: 'main' }),
        step('bulk', 'Stockgare', 120, 'rt'),
        step('shape', 'Ballen formen', 15, 'rt'),
        step('proof', 'Ballengare', 240, 'rt'),
        step('bake', 'Pizza backen', 30, 'oven'),
      ];
      return r;
    },
  },
  {
    id: 'madre-pizza', icon: '🫙', name: 'Pizza mit Lievito Madre', desc: 'Madre · 65 % · ca. 27 h',
    build() {
      const r = blankRecipe('pizza');
      Object.assign(r, { name: 'Pizza mit Lievito Madre', description: 'Ohne Hefe – milde Säure, sehr bekömmlich.', salt: 2.8, yeastPct: 0, tags: ['Lievito Madre', 'Sauerteig'] });
      r.water.pct = 65;
      r.flours = [{ name: 'Tipo 00', pct: 80 }, { name: 'Manitoba', pct: 20 }];
      const lm = makePf('madre', { flourName: 'Manitoba', flourPct: 10 });
      r.preferments = [lm];
      r.steps = [
        step('prep', 'Lievito Madre auffrischen', 10, 'rt', { stage: lm.id, notes: 'Madre mit Mehl und Wasser fest verkneten, zur Kugel formen, kreuzweise einschneiden.' }),
        step('rest', 'Lievito Madre reifen', 240, 'warm', { stage: lm.id, temp: '26–28 °C', notes: 'Reif, wenn verdoppelt.' }),
        step('mix', 'Hauptteig kneten', 25, 'rt', { stage: 'main', notes: 'Madre in Stücken mit dem Wasser lösen, Mehl zugeben, Salz zum Schluss.' }),
        step('bulk', 'Stockgare', 120, 'rt'),
        step('shape', 'Ballen formen', 15, 'rt'),
        step('proof', 'Ballengare', 960, 'fridge', { temp: '4–6 °C' }),
        step('temper', 'Akklimatisieren', 240, 'rt'),
        step('bake', 'Pizza backen', 30, 'oven'),
      ];
      return r;
    },
  },
  {
    id: 'ny-direct', icon: '🗽', name: 'New York Style · direkt', desc: 'Mit Öl & Zucker · 48 h kalt',
    build() {
      const r = blankRecipe('pizza');
      Object.assign(r, { name: 'New York Style Pizza', description: 'Direkte Führung mit langer kalter Gare. Öl und Zucker für Bräunung im Haushaltsofen.', salt: 2.5, yeastType: 'dry', yeastPct: 0.4, tags: ['direkt', 'Haushaltsofen'] });
      r.yield = { mode: 'pieces', count: 4, pieceWeight: 280, flour: 600, loss: 0 };
      r.flours = [{ name: 'Weizenmehl 550', pct: 100 }];
      r.water.pct = 63; r.oil.pct = 3; r.extras = [{ name: 'Zucker', pct: 2 }];
      r.steps = [
        step('mix', 'Teig kneten', 15, 'rt', { stage: 'main' }),
        step('rest', 'Teigruhe', 30, 'rt'),
        step('shape', 'Ballen formen', 15, 'rt'),
        step('proof', 'Kalte Gare', 2880, 'fridge'),
        step('temper', 'Akklimatisieren', 120, 'rt', { notes: 'Ofen mit Stein/Stahl 1 h vorheizen.' }),
        step('bake', 'Pizza backen', 30, 'oven', { temp: '280–300 °C', notes: '6–8 min pro Pizza.' }),
      ];
      return r;
    },
  },
  {
    id: 'sourdough', icon: '🍞', name: 'Weizen-Sauerteigbrot', desc: 'Levain · 75 % · Dehnen & Falten',
    build() {
      const r = blankRecipe('bread');
      Object.assign(r, { name: 'Weizen-Sauerteigbrot (Landbrot)', description: 'Offene Krume, knusprige Kruste – im Topf gebacken.', salt: 2, yeastPct: 0, ddt: 25, tags: ['Sauerteig', 'Topfbrot'] });
      r.yield = { mode: 'pieces', count: 1, pieceWeight: 950, flour: 500, loss: 0 };
      r.flours = [{ name: 'Weizenmehl 550', pct: 85 }, { name: 'Weizenvollkornmehl', pct: 15 }];
      r.water.pct = 75;
      const lv = makePf('levain', { flourName: 'Weizenvollkornmehl', flourPct: 10, starterPct: 20 });
      r.preferments = [lv];
      r.steps = [
        step('prep', 'Levain ansetzen', 5, 'rt', { stage: lv.id, notes: 'Anstellgut mit Mehl und Wasser (ca. 28 °C) verrühren. Rest-Anstellgut zurück in den Kühlschrank.' }),
        step('rest', 'Levain reifen', 480, 'warm', { stage: lv.id, temp: '26 °C', notes: 'Fertig, wenn verdoppelt, gewölbt und angenehm säuerlich.' }),
        step('autolyse', 'Autolyse', 60, 'rt', { stage: 'main', notes: 'Mehl + Wasser mischen – ca. 30 g Wasser zurückhalten.' }),
        step('mix', 'Teig fertigstellen', 15, 'rt', { stage: 'main', notes: 'Levain einarbeiten, Salz mit dem Restwasser zugeben.' }),
        step('bulk', 'Stockgare mit Dehnen & Falten', 240, 'rt', { temp: '24–26 °C', repeat: { count: 4, intervalMin: 30 }, notes: 'Am Ende ca. 50–75 % Volumenzunahme, gewölbte Oberfläche.' }),
        step('shape', 'Vorformen', 10, 'rt'),
        step('rest', 'Teigruhe', 20, 'rt'),
        step('shape', 'Formen & ins Gärkörbchen', 10, 'rt'),
        step('proof', 'Stückgare (kalt)', 840, 'fridge'),
        step('preheat', 'Ofen + Topf vorheizen', 45, 'oven', { temp: '250 °C' }),
        step('bake', 'Brot backen', 45, 'oven', { temp: '250 → 230 °C', notes: '20 min mit Deckel, 25 min ohne. Kerntemperatur ≥ 96 °C.' }),
        step('cool', 'Auskühlen', 90, 'rt', { notes: 'Erst anschneiden, wenn ausgekühlt.' }),
      ];
      return r;
    },
  },
  // ---------- Feingebäck ----------
  {
    id: 'croissant', cat: 'fine', icon: '🥐', name: 'Croissants', desc: '50 % Butter · 3 einfache Touren · über Nacht',
    build() {
      const r = blankRecipe('fine');
      Object.assign(r, { name: 'Croissants', description: 'Blättrig und buttrig – Grundteig über Nacht, am Backtag tourieren.', salt: 2, yeastPct: 4, ddt: 24, tags: ['Viennoiserie', 'Plunderteig'] });
      r.yield = { mode: 'pieces', count: 12, pieceWeight: 85, flour: 480, loss: 8 };
      r.water.pct = 28;
      r.extras = [{ name: 'Milch', pct: 28 }, { name: 'Zucker', pct: 12 }, { name: 'Butter', pct: 6 }];
      r.lamination = { pct: 50, name: 'Butter (Tourierbutter)' };
      r.steps = [
        step('mix', 'Grundteig kneten', 10, 'rt', { stage: 'main', notes: 'Nur kurz kneten, bis der Teig glatt ist – zu lang geknetet zieht er sich beim Ausrollen zusammen.' }),
        step('rest', 'Grundteig kühlen', 720, 'fridge', { temp: '4 °C', notes: 'Flach drücken, in Folie über Nacht kühlen. Butter zu einer Platte ausrollen und ebenfalls kühlen.' }),
        step('laminate', 'Butter einschlagen + 1. Tour (einfach)', 15, 'rt', { stage: 'lam', notes: 'Butter ca. 15 min vorher aus dem Kühlschrank – sie soll biegsam sein, aber kühl (ca. 12–14 °C).' }),
        step('rest', 'Kühlen', 30, 'fridge'),
        step('laminate', '2. Tour (einfach)', 10, 'rt'),
        step('rest', 'Kühlen', 30, 'fridge'),
        step('laminate', '3. Tour (einfach)', 10, 'rt'),
        step('rest', 'Kühlen', 60, 'fridge'),
        step('shape', 'Ausrollen, schneiden & formen', 30, 'rt', { notes: 'Auf ca. 4 mm ausrollen, Dreiecke (ca. 9 × 25 cm) schneiden und locker aufrollen.' }),
        step('proof', 'Stückgare', 120, 'warm', { temp: '26 °C', notes: 'Nicht über 27 °C – sonst läuft die Butter aus. Fertig, wenn sie deutlich gewachsen sind und leicht wackeln.' }),
        step('bake', 'Backen', 18, 'oven', { temp: '190 °C', notes: 'Mit verquirltem Ei abstreichen. Ofen rechtzeitig vorheizen.' }),
        step('cool', 'Auskühlen', 30, 'rt'),
      ];
      return r;
    },
  },
  {
    id: 'plunder', cat: 'fine', icon: '🌀', name: 'Dänischer Plunder', desc: 'Milch & Ei · 1 doppelte + 1 einfache Tour',
    build() {
      const r = blankRecipe('fine');
      Object.assign(r, { name: 'Dänischer Plunder', description: 'Schnecken, Taschen oder Hahnenkämme – Füllung nach Wahl.', salt: 1.5, yeastPct: 5, ddt: 22, tags: ['Plunder'] });
      r.yield = { mode: 'pieces', count: 16, pieceWeight: 70, flour: 400, loss: 8 };
      r.water.pct = 0;
      r.extras = [{ name: 'Milch', pct: 48 }, { name: 'Vollei', pct: 12 }, { name: 'Zucker', pct: 10 }, { name: 'Butter', pct: 8 }];
      r.lamination = { pct: 50, name: 'Butter (Ziehfett)' };
      r.steps = [
        step('mix', 'Grundteig kneten', 10, 'rt', { stage: 'main', notes: 'Kalte Milch verwenden – der Teig soll kühl bleiben (ca. 22 °C).' }),
        step('rest', 'Teig kühlen', 30, 'fridge'),
        step('laminate', 'Butter einschlagen + 1. Tour (doppelt)', 15, 'rt', { stage: 'lam' }),
        step('rest', 'Kühlen', 30, 'fridge'),
        step('laminate', '2. Tour (einfach)', 10, 'rt'),
        step('rest', 'Kühlen', 60, 'fridge'),
        step('shape', 'Ausrollen, füllen & formen', 30, 'rt', { notes: 'Ca. 4 mm dick ausrollen. Füllung z. B. Vanillepudding, Nuss- oder Mohnfüllung.' }),
        step('proof', 'Stückgare', 60, 'warm', { temp: '26 °C', notes: 'Nicht zu warm, sonst läuft die Butter aus.' }),
        step('bake', 'Backen', 15, 'oven', { temp: '200 °C', notes: 'Mit Ei abstreichen.' }),
        step('cool', 'Auskühlen & glasieren', 20, 'rt', { notes: 'Noch warm aprikotieren, nach dem Abkühlen glasieren.' }),
      ];
      return r;
    },
  },
  {
    id: 'brioche', cat: 'fine', icon: '🍞', name: 'Brioche', desc: '50 % Butter · 50 % Ei · Kastenform',
    build() {
      const r = blankRecipe('fine');
      Object.assign(r, { name: 'Brioche', description: 'Fluffig und reichhaltig – der kalte Teig lässt sich am nächsten Tag gut formen.', salt: 2, yeastPct: 3, ddt: 24, tags: ['Brioche', 'Kastenform'] });
      r.yield = { mode: 'pieces', count: 2, pieceWeight: 500, flour: 450, loss: 3 };
      r.water.pct = 0;
      r.extras = [{ name: 'Vollei', pct: 50 }, { name: 'Milch', pct: 10 }, { name: 'Zucker', pct: 12 }, { name: 'Butter', pct: 50 }];
      r.steps = [
        step('mix', 'Teig kneten (Butter zum Schluss)', 25, 'rt', { stage: 'main', notes: 'Erst ohne Butter ca. 10 min kneten, dann die kalte Butter in Stücken nach und nach einarbeiten, bis der Teig glänzt und sich vom Schüsselrand löst.' }),
        step('bulk', 'Stockgare', 60, 'rt'),
        step('rest', 'Über Nacht kühlen', 720, 'fridge', { notes: 'Kalter Teig lässt sich viel besser formen.' }),
        step('shape', 'Formen', 20, 'rt', { notes: 'Je 6 Kugeln in die gefettete Kastenform setzen.' }),
        step('proof', 'Stückgare', 150, 'warm', { temp: '26 °C' }),
        step('bake', 'Backen', 30, 'oven', { temp: '180 °C', notes: 'Mit Ei abstreichen. Kerntemperatur ca. 90 °C.' }),
        step('cool', 'Auskühlen', 60, 'rt'),
      ];
      return r;
    },
  },
  {
    id: 'hefezopf', cat: 'fine', icon: '🥨', name: 'Hefezopf', desc: 'Milch, Butter, Ei · ca. 3 h',
    build() {
      const r = blankRecipe('fine');
      Object.assign(r, { name: 'Hefezopf', description: 'Klassischer Sonntagszopf, auf Wunsch mit Rosinen oder Hagelzucker.', salt: 1, yeastPct: 4, ddt: 26, tags: ['Zopf'] });
      r.yield = { mode: 'pieces', count: 1, pieceWeight: 980, flour: 500, loss: 2 };
      r.water.pct = 0;
      r.extras = [{ name: 'Milch', pct: 50 }, { name: 'Butter', pct: 16 }, { name: 'Zucker', pct: 14 }, { name: 'Vollei', pct: 11 }];
      r.steps = [
        step('mix', 'Teig kneten', 15, 'rt', { stage: 'main', notes: 'Milch lauwarm (ca. 30 °C) – Butter weich zugeben.' }),
        step('bulk', 'Gehen lassen', 60, 'warm', { temp: '26 °C', notes: 'Bis sich das Volumen etwa verdoppelt hat.' }),
        step('shape', 'Zopf flechten', 15, 'rt', { notes: 'In 3 Stränge teilen, flechten, Enden unterschlagen.' }),
        step('proof', 'Stückgare', 45, 'warm', { temp: '26 °C' }),
        step('bake', 'Backen', 35, 'oven', { temp: '180 °C', notes: 'Mit Eigelb-Milch bestreichen, nach Wunsch Hagelzucker.' }),
        step('cool', 'Auskühlen', 60, 'rt'),
      ];
      return r;
    },
  },
  // ---------- Kuchen & Torten ----------
  {
    id: 'marmor', cat: 'cake', icon: '🍰', name: 'Marmorkuchen', desc: 'Rührteig · Kastenform 30 cm',
    build() {
      const r = blankRecipe('cake');
      Object.assign(r, { name: 'Marmorkuchen', description: 'Saftiger Rührkuchen – hell und dunkel marmoriert.', tags: ['Rührteig'] });
      r.pan = { shape: 'rect', d: 0, l: 30, w: 11, n: 0 };
      const a = part('Rührteig', [['Butter (weich)', 250], ['Zucker', 200], ['Vanillezucker', 1, 'Pck'], ['Salz', 1, 'Prise'], ['Eier', 4, 'Stk'], ['Weizenmehl 405', 375], ['Backpulver', 1, 'Pck'], ['Milch', 125, 'ml']]);
      const b = part('Dunkler Teig', [['Kakaopulver', 20], ['Zucker', 20], ['Milch', 30, 'ml']]);
      r.parts = [a, b];
      r.steps = [
        step('mix', 'Rührteig zubereiten', 15, 'rt', { stage: a.id, notes: 'Butter, Zucker, Vanillezucker und Salz cremig rühren. Eier einzeln unterrühren. Mehl mit Backpulver im Wechsel mit der Milch unterrühren.' }),
        step('preheat', 'Ofen vorheizen', 15, 'oven', { temp: '175 °C Ober-/Unterhitze', parallel: true }),
        step('mix', 'Dunklen Teig marmorieren', 5, 'rt', { stage: b.id, notes: 'Ein Drittel des Teigs mit Kakao, Zucker und Milch verrühren. Abwechselnd in die Form füllen und mit einer Gabel spiralförmig durchziehen.' }),
        step('bake', 'Backen', 55, 'oven', { temp: '175 °C', notes: 'Stäbchenprobe: Es darf kein Teig mehr kleben bleiben.' }),
        step('cool', 'Auskühlen', 60, 'rt', { notes: '10 min in der Form ruhen lassen, dann stürzen.' }),
      ];
      return r;
    },
  },
  {
    id: 'biskuit', cat: 'cake', icon: '🎂', name: 'Biskuitboden', desc: 'Für Torten · Springform Ø 26 cm',
    build() {
      const r = blankRecipe('cake');
      Object.assign(r, { name: 'Biskuitboden', description: 'Luftiger Boden für Torten – zweimal durchschneiden und füllen.', tags: ['Biskuit', 'Torte'] });
      r.pan = { shape: 'round', d: 26, l: 0, w: 0, n: 0 };
      const a = part('Biskuit', [['Eier', 4, 'Stk'], ['Zucker', 120], ['Vanillezucker', 1, 'Pck'], ['Salz', 1, 'Prise'], ['Weizenmehl 405', 80], ['Speisestärke', 40], ['Backpulver', 1, 'TL']]);
      r.parts = [a];
      r.steps = [
        step('mix', 'Eischaum aufschlagen', 15, 'rt', { stage: a.id, notes: 'Eier mit Zucker, Vanillezucker und Salz 8–10 min hell-cremig aufschlagen. Mehl, Stärke und Backpulver darübersieben und vorsichtig unterheben.' }),
        step('preheat', 'Ofen vorheizen', 15, 'oven', { temp: '180 °C Ober-/Unterhitze', parallel: true }),
        step('bake', 'Backen', 25, 'oven', { temp: '180 °C', notes: 'Nur den Boden der Springform mit Backpapier auslegen, den Rand nicht fetten. Ofentür nicht öffnen.' }),
        step('cool', 'Auskühlen', 120, 'rt', { notes: 'Kopfüber auskühlen lassen, dann zweimal waagrecht durchschneiden.' }),
      ];
      return r;
    },
  },
  {
    id: 'kaesekuchen', cat: 'cake', icon: '🧀', name: 'Käsekuchen', desc: 'Mürbeteig + Quarkfüllung · Ø 26 cm',
    build() {
      const r = blankRecipe('cake');
      Object.assign(r, { name: 'Käsekuchen', description: 'Cremiger Quarkkuchen auf Mürbeteig-Boden.', tags: ['Mürbeteig', 'Quark'] });
      r.pan = { shape: 'round', d: 26, l: 0, w: 0, n: 0 };
      const a = part('Mürbeteig', [['Weizenmehl 405', 200], ['Butter (kalt)', 100], ['Zucker', 70], ['Ei', 1, 'Stk'], ['Backpulver', 1, 'TL']]);
      const b = part('Quarkfüllung', [['Magerquark', 750], ['Zucker', 180], ['Eier', 3, 'Stk'], ['Sahne', 200, 'ml'], ['Speisestärke', 40], ['Vanillezucker', 1, 'Pck'], ['Zitronenabrieb', 1, 'TL']]);
      r.parts = [a, b];
      r.steps = [
        step('mix', 'Mürbeteig kneten', 10, 'rt', { stage: a.id, notes: 'Schnell zu einem glatten Teig verkneten, nicht zu lange – sonst wird er brüchig.' }),
        step('rest', 'Teig kühlen', 30, 'fridge'),
        step('mix', 'Füllung rühren', 10, 'rt', { stage: b.id, notes: 'Alle Zutaten glatt rühren, nicht schaumig schlagen.' }),
        step('preheat', 'Ofen vorheizen', 15, 'oven', { temp: '170 °C Ober-/Unterhitze', parallel: true }),
        step('shape', 'Form auslegen & füllen', 10, 'rt', { notes: 'Boden und ca. 3 cm Rand mit dem Teig auslegen, Füllung einfüllen.' }),
        step('bake', 'Backen', 70, 'oven', { temp: '170 °C', notes: 'Danach bei leicht geöffneter Ofentür 15 min ruhen lassen – so reißt er weniger.' }),
        step('cool', 'Auskühlen', 180, 'rt'),
        step('rest', 'Durchkühlen', 240, 'fridge', { notes: 'Am besten über Nacht – dann lässt er sich sauber schneiden.' }),
      ];
      return r;
    },
  },
];
