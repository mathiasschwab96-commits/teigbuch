// Teigbuch – Hintergrundwissen: Mehl-Bibliothek und Erfolge
// Reine Daten/Funktionen, keine gespeicherten Felder → kein Einfluss auf Sicherungen.
import { num, fermGroups, sameName } from './calc.js';

// ---------- Mehl-Bibliothek ----------
// Richtwerte – je nach Hersteller verschieden. strength: weak | medium | strong
// Für die Mehl-Ampel (ab 2.5): wv = typische Backstärke W (Mittelwert), cap = Hydration, die das Mehl gut verträgt (%),
// rye/whole = Roggen bzw. Vollkorn. Ein W-Wert im Namen („Tipo 00 W 300“) hat Vorrang vor dem Richtwert.
export const FLOURS = [
  { name: 'Tipo 00', match: /tipo\s*00|\b00\b|pizzamehl/i, protein: '11–13', w: '220–320', strength: 'medium', wv: 260, cap: 70, note: 'Klassiker für Pizza; mit W 300+ auch für Biga und 48 h Kühlschrank.' },
  { name: 'Tipo 0', match: /tipo\s*0(?!0)\b/i, protein: '11–13', w: '220–300', strength: 'medium', wv: 260, cap: 70, note: 'Etwas mehr Schale als Tipo 00, kräftigerer Geschmack.' },
  { name: 'Tipo 1', match: /tipo\s*1\b/i, protein: '11,5–13', w: '250–320', strength: 'medium', wv: 280, cap: 74, note: 'Rustikal, nimmt etwas mehr Wasser auf.' },
  { name: 'Tipo 2', match: /tipo\s*2\b/i, protein: '12–13', w: '–', strength: 'medium', wv: 250, cap: 75, whole: true, note: 'Fast Vollkorn – mehr Wasser, kürzere Gare.' },
  { name: 'Manitoba', match: /manitoba/i, protein: '13,5–15', w: '350–420', strength: 'strong', wv: 380, cap: 80, note: 'Sehr kräftig – ideal für lange Führungen und Biga, oft als Anteil gemischt.' },
  { name: 'Semola rimacinata', match: /semola|hartweizen/i, protein: '12–13', w: '–', strength: 'medium', wv: 220, cap: 66, note: 'Hartweizen: gelbe Krume, gut zum Bestreuen beim Ausformen.' },
  { name: 'Weizenmehl 405', match: /\b405\b/i, protein: '9–11', w: '~150–200', strength: 'weak', wv: 170, cap: 64, note: 'Eher für Kuchen – für Pizza/Brot nur kurz geführt.' },
  { name: 'Weizenmehl 550', match: /\b550\b/i, protein: '10,5–12', w: '~200–250', strength: 'weak', wv: 220, cap: 70, note: 'Allrounder – am besten bis ca. 24 h Gesamtführung.' },
  { name: 'Weizenmehl 1050', match: /\b1050\b/i, protein: '11–13', w: '–', strength: 'medium', wv: 230, cap: 72, note: 'Kräftiger Geschmack, nimmt mehr Wasser auf.' },
  { name: 'Weizenvollkornmehl', match: /weizen.*vollkorn|vollkorn.*weizen|^vollkorn/i, protein: '12–14', w: '–', strength: 'medium', wv: 230, cap: 76, whole: true, note: 'Braucht ca. 5–10 % mehr Wasser; Quellzeit hilft.' },
  { name: 'Dinkelmehl 630', match: /dinkel/i, protein: '11–13', w: '–', strength: 'weak', wv: 190, cap: 66, note: 'Empfindliches Klebergerüst: kürzer kneten, etwas weniger Wasser.' },
  { name: 'Roggenmehl 1150', match: /roggen/i, protein: '8–10', w: '–', strength: 'weak', wv: 0, cap: 80, rye: true, note: 'Kaum Kleber – braucht Sauerteig (Säure) für gute Backeigenschaften.' },
];
export const FLOUR_NAMES = FLOURS.map((f) => f.name);
export const flourInfo = (name) => (name ? FLOURS.find((f) => f.match.test(name)) || null : null);

// Kurzer Hinweis, wenn eine sehr lange Führung auf ein schwaches Mehl trifft.
// Gezählt wird nur die Gärzeit (ohne Vorheizen, Backen, Auskühlen, Formen).
const NO_FERMENT = new Set(['preheat', 'bake', 'cool', 'shape']);
export function fermentMinutes(steps) {
  return (steps || []).filter((s) => !NO_FERMENT.has(s.kind) && !s.parallel).reduce((t, s) => t + num(s.durationMin), 0);
}
export function flourHints(r) {
  const hints = [];
  if (r.category === 'cake') return hints;
  const weak = (r.flours || []).filter((f) => num(f.pct) >= 50 && flourInfo(f.name)?.strength === 'weak');
  if (weak.length && fermentMinutes(r.steps) > 72 * 60) hints.push(`„${weak[0].name}“ ist eher schwach für eine Gärzeit über 72 h – ein kräftigeres Mehl (z. B. Tipo 00 W 300+ oder ein Manitoba-Anteil) hält länger durch.`);
  return hints;
}

// ---------- Mehl-Ampel (ab 2.5) ----------
// Passt das Mehl zu Hydration, Gärzeit, Roggenanteil und Anreicherung? Ergebnis: green | yellow | red (null = nicht bewertbar).
// Faustregeln (Richtwerte aus der Bäckerpraxis): W unter 200 → bis ca. 12 h, bis 240 → 18 h, bis 280 → 24 h, bis 320 → 48 h,
// bis 360 → 72 h, darüber → 96 h. Kühlschrankstunden zählen halb (der Kleber wird dort langsamer abgebaut).
const W_HOURS = [[200, 12], [240, 18], [280, 24], [320, 48], [360, 72], [Infinity, 96]];
export const maxHoursForW = (w) => W_HOURS.find(([lim]) => w < lim)[1];
// ---------- Meine Mehle (ab 2.6): Packungsangaben haben Vorrang vor Richtwerten ----------
// Die App meldet die eigenen Mehle hier an (setMyFlours); alle Funktionen bleiben ohne Speicherzugriff.
let MY = [];
export const setMyFlours = (list) => { MY = Array.isArray(list) ? list : []; };
export const myFlours = () => MY;
export const myFlour = (name) => (name ? MY.find((f) => sameName(f.name, name)) || null : null);
const KIND_LIB = { tipo00: 'Tipo 00', tipo0: 'Tipo 0', wheat: 'Weizenmehl 550', manitoba: 'Manitoba', whole: 'Weizenvollkornmehl', spelt: 'Dinkelmehl 630', rye: 'Roggenmehl 1150', durum: 'Semola rimacinata' };
const has = (v) => v !== '' && v !== null && v !== undefined;
// Wissenschaftliche Faustformeln (Richtwerte):
//  • W aus Eiweiß (Weizen): W ≈ 40 · Eiweiß% − 210  (11 % → 230, 12 % → 270, 13 % → 310, 14 % → 350)
//  • Verträgliche Hydration aus der Wasseraufnahme (Farinograph, 500 FE): ca. +8 %-Punkte für handwerkliche, lang geführte Teige
//  • ohne Wasseraufnahme aus Eiweiß: ca. 45 + 2,3 · Eiweiß% (Vollkorn +5) – Kleber und Kleie binden Wasser
export const wFromProtein = (p) => Math.round(Math.min(450, Math.max(120, 40 * num(p) - 210)));
export function flourProps(name) {
  const m = myFlour(name);
  const lib = (m?.kind && FLOURS.find((f) => f.name === KIND_LIB[m.kind])) || flourInfo(name) || (m?.brand ? flourInfo(m.brand) : null);
  const nameW = /\bW\s?(\d{3})/i.exec(name || '');
  if (!m && !lib && !nameW) return null;
  const rye = !!lib?.rye || m?.kind === 'rye', whole = !!lib?.whole || m?.kind === 'whole';
  let w = null, wSrc = '';
  if (m && has(m.w)) { w = num(m.w); wSrc = 'Packung'; }
  else if (nameW) { w = Number(nameW[1]); wSrc = 'Name'; }
  else if (m && has(m.protein) && !rye) { w = wFromProtein(m.protein); wSrc = 'aus Eiweiß geschätzt'; }
  else if (lib && !rye) { w = lib.wv; wSrc = 'Richtwert'; }
  let cap, capSrc;
  if (m && has(m.absorption)) { cap = num(m.absorption) + 8; capSrc = 'aus Wasseraufnahme'; }
  else if (m && has(m.protein)) { cap = 45 + 2.3 * num(m.protein) + (whole ? 5 : 0); capSrc = 'aus Eiweiß geschätzt'; }
  else { cap = lib?.cap ?? 70; capSrc = 'Richtwert'; }
  return { mine: !!m, my: m, lib, w, wSrc, cap, capSrc, rye, whole, protein: m && has(m.protein) ? num(m.protein) : null,
    pl: m && has(m.pl) ? num(m.pl) : null, falling: m && has(m.falling) ? num(m.falling) : null };
}
const LEVEL = { info: -1, green: 0, yellow: 1, red: 2 };
const worst = (a, b) => (LEVEL[b] > LEVEL[a] ? b : a);
const fmt = (v) => String(Math.round(v)).replace('.', ',');
const fmt1 = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
// Gewichtete Eigenschaften einer Mehlmischung [{name, pct}] – nur bekannte Mehle
function blendOf(list) {
  let tot = 0, known = 0, w = 0, wN = 0, cap = 0, rye = 0, whole = 0, mine = 0, fall = 0, fallN = 0, pl = 0, plN = 0;
  const wSrc = new Set(), parts = [];
  (list || []).forEach((f) => {
    const p = Math.max(0, num(f.pct)); tot += p;
    const x = flourProps(f.name);
    if (!x) return;
    known += p; parts.push({ name: f.name, pct: p, ...x });
    if (x.mine) mine += p;
    if (x.rye) rye += p; else if (x.w) { w += x.w * p; wN += p; wSrc.add(x.wSrc); }
    if (x.whole) whole += p;
    cap += x.cap * p;
    if (x.falling !== null) { fall += x.falling * p; fallN += p; }
    if (x.pl !== null) { pl += x.pl * p; plN += p; }
  });
  return { tot, known, w: wN ? w / wN : null, wSrc: [...wSrc], cap: known ? cap / known : null, rye: tot ? (rye / tot) * 100 : 0, whole: tot ? (whole / tot) * 100 : 0,
    mine: tot ? (mine / tot) * 100 : 0, falling: fallN ? fall / fallN : null, pl: plN ? pl / plN : null, parts };
}
// Mehlbedarf eines Backtags je eigenem Mehl (aus calc().totals.flours) – für Vorrat und Kosten
export function flourNeeds(c) {
  return (c?.totals?.flours || []).map((f) => ({ f: myFlour(f.name), g: num(f.g) })).filter((x) => x.f && x.g > 0);
}
export const flourCost = (needs) => needs.reduce((s, x) => s + (has(x.f.price) ? (x.g / 1000) * num(x.f.price) : 0), 0);
export const hasPrice = (needs) => needs.some((x) => has(x.f.price));
// Auswertung aus dem Tagebuch: Backtage mit diesem Mehl, Ø-Bewertung und „Sweet Spot“ der Hydration (Backtage ab 4 ★)
export function flourStats(f, logs, recipes) {
  const byId = new Map((recipes || []).map((r) => [r.id, r]));
  const uses = (l) => String(l.params?.flour || '').toLowerCase().includes(String(f.name || '').toLowerCase())
    || (!l.params?.flour && (byId.get(l.recipeId)?.flours || []).some((x) => sameName(x.name, f.name)));
  const list = (logs || []).filter((l) => f.name && uses(l));
  const rated = list.filter((l) => num(l.rating) > 0);
  const good = rated.filter((l) => num(l.rating) >= 4 && num(l.params?.hydration) > 0).map((l) => num(l.params.hydration));
  const last = list.map((l) => l.date).filter(Boolean).sort().pop() || '';
  return { count: list.length, avg: rated.length ? rated.reduce((s, l) => s + num(l.rating), 0) / rated.length : 0,
    sweet: good.length ? [Math.min(...good), Math.max(...good)] : null, last };
}
// Empfohlene Hydration für eine Mehlmischung (etwas unter der verträglichen Grenze)
export function idealHydration(r) {
  if (!r || r.category === 'cake' || r.category === 'fine') return null;
  const b = blendOf(r.flours);
  return b.cap && b.known >= b.tot * 0.5 ? Math.round(b.cap - 2) : null;
}
// Effektive Gärstunden je Stufe (Kühlschrank zählt halb)
function fermHours(r, steps) {
  const g = fermGroups(r, steps), out = {};
  (steps || []).forEach((s, i) => { const k = g[i]; if (k) out[k] = (out[k] || 0) + (num(s.durationMin) / 60) * (s.location === 'fridge' ? 0.5 : 1); });
  return out;
}
// r = Rezept; opt.hydration / opt.steps = Werte des Backtags (Planer); opt.hydEff = wirksame Flüssigkeit (Feingebäck)
export function flourCheck(r, opt = {}) {
  if (!r || r.category === 'cake') return null;
  const b = blendOf(r.flours);
  if (!(b.tot > 0) || b.known < b.tot * 0.5) return { level: null, items: [], blend: b };
  const items = [];
  const add = (level, text, tip = '') => items.push({ level, text, tip });
  const fine = r.category === 'fine';
  const hyd = num(opt.hydration ?? r.water?.pct);
  const steps = opt.steps || r.steps || [];
  const pfs = r.preferments || [];
  const sour = pfs.some((p) => p.type === 'levain' || p.type === 'madre');
  // 1) Hydration (nicht bei Feingebäck – dort machen Butter/Ei den Teig weich)
  if (!fine && b.cap && hyd > 0) {
    const over = hyd - b.cap;
    if (over > 8) add('red', `${fmt(hyd)} % Wasser ist sehr viel für diese Mehle (gut verträglich bis ca. ${fmt(b.cap)} %).`, 'Weniger Wasser, Bassinage (Wasser nach und nach) oder einen Manitoba-Anteil.');
    else if (over > 4) add('yellow', `${fmt(hyd)} % Wasser liegt über dem, was diese Mehle gut verkraften (ca. ${fmt(b.cap)} %).`, 'Geht mit guter Knettechnik und Dehnen & Falten – sonst 2–3 % weniger.');
    else if (b.whole >= 50 && hyd < b.cap - 8) add('yellow', `Viel Vollkorn bei nur ${fmt(hyd)} % Wasser – der Teig wird eher fest und trocken.`, 'Vollkorn verträgt meist 5–10 % mehr Wasser, ein Quellstück hilft.');
  }
  // 2) Gärzeit gegen Backstärke: Hauptteig und jeder Vorteig mit eigenem Mehl
  const h = fermHours(r, steps), mainH = h.main || 0;
  if (b.w && b.rye < 50) {
    const max = maxHoursForW(b.w);
    if (mainH > max * 1.5) add('red', `Die Gare im Hauptteig (ca. ${fmt(mainH)} h) ist zu lang für ein Mehl mit W ≈ ${fmt(b.w)} (bis ca. ${max} h).`, 'Kräftigeres Mehl (W 300+, Manitoba-Anteil) oder kürzer bzw. kälter führen.');
    else if (mainH > max) add('yellow', `Die Gare im Hauptteig (ca. ${fmt(mainH)} h) ist eher lang für W ≈ ${fmt(b.w)} (bis ca. ${max} h).`, 'Ein Anteil kräftigeres Mehl gibt Sicherheit.');
  }
  pfs.forEach((pf) => {
    // Sauerteig/Madre werden immer lange geführt (Säure stabilisiert) – hier zählt nur der Hauptteig
    if (pf.seeds || ['tangzhong', 'yudane', 'quell', 'dampfl', 'levain', 'madre'].includes(pf.type)) return;
    const mix = (pf.flours || []).filter((f) => num(f.pct) > 0);
    const list = mix.length ? mix : [{ name: pf.flourName || r.flours?.[0]?.name, pct: 100 }];
    const pb = blendOf(list);
    if (!pb.w || pb.rye >= 50) return;
    const hrs = (h[pf.id] ?? h.pf ?? 0) + mainH, max = maxHoursForW(pb.w);
    const nm = pf.name || 'Vorteig';
    if (hrs > max * 1.5) add('red', `„${nm}“ läuft insgesamt ca. ${fmt(hrs)} h – zu lang für W ≈ ${fmt(pb.w)} (bis ca. ${max} h).`, 'Für den Vorteig ein kräftiges Mehl nehmen (W 300+ oder Manitoba).');
    else if (hrs > max) add('yellow', `„${nm}“ läuft insgesamt ca. ${fmt(hrs)} h – eher lang für W ≈ ${fmt(pb.w)} (bis ca. ${max} h).`, 'Ein kräftigeres Mehl im Vorteig hält länger durch.');
  });
  // 3) Roggen braucht Säure
  if (b.rye >= 20 && !sour) add(b.rye >= 50 ? 'red' : 'yellow', `${fmt(b.rye)} % Roggen ohne Sauerteig – Roggen backt ohne Säure oft klitschig.`, 'Einen Teil des Roggenmehls als Sauerteig führen.');
  // 4) Viel Butter/Zucker/Ei braucht kräftiges Mehl
  const rich = (r.extras || []).filter((e) => /butter|zucker|ei(gelb)?\b|vollei|honig/i.test(e.name || '')).reduce((s, e) => s + num(e.pct), 0) + num(r.lamination?.pct) * 0.5;
  if (rich >= 60 && b.w && b.w < 280) add('yellow', `Sehr viel Butter, Zucker und Ei (ca. ${fmt(rich)} %) für ein Mehl mit W ≈ ${fmt(b.w)}.`, 'Ein Anteil kräftiges Mehl (Manitoba oder W 330+) trägt so reiche Teige besser – z. B. bei Brioche oder Panettone.');
  // 5) Fallzahl (Enzymaktivität, nur bei eigenen Mehlen mit Angabe): niedrige Fallzahl = viel Amylase → Stärke wird abgebaut,
  //    bei langer Gare wird der Teig weich/klebrig; hohe Fallzahl = wenig Enzyme → blasse Kruste, wenig Aroma
  const longest = mainH + Math.max(0, ...Object.entries(h).filter(([k]) => k !== 'main').map(([, v]) => v));
  const malt = (r.extras || []).some((e) => /malz/i.test(e.name || ''));
  if (b.falling !== null) {
    if (b.rye >= 50 && b.falling < 160) add('yellow', `Fallzahl ca. ${fmt(b.falling)} s – für Roggen niedrig: die Krume kann feucht und klitschig werden.`, 'Mehr Sauerteig (Säure bremst die Enzyme), etwas weniger Wasser und gut ausbacken.');
    else if (b.rye < 50 && b.falling < 220 && longest > 16) add(b.falling < 180 && longest > 24 ? 'red' : 'yellow', `Fallzahl ca. ${fmt(b.falling)} s = viel Enzymaktivität. Bei ca. ${fmt(longest)} h Gare wird viel Stärke abgebaut – der Teig wird weich und klebrig.`, 'Kürzer oder kälter führen, weniger Wasser, oder ein Mehl mit höherer Fallzahl untermischen.');
    else if (b.rye < 50 && b.falling > 380 && !malt) add('info', `Fallzahl ca. ${fmt(b.falling)} s = wenig Enzyme: die Kruste bräunt schwächer, der Teig bekommt weniger Zucker.`, '0,3–0,5 % diastatisches Malz oder eine längere (kalte) Gare gleichen das aus.');
  }
  // 6) P/L (Alveograph: Zähigkeit zu Dehnbarkeit) – nur Hinweis zur Verarbeitung
  if (b.pl !== null && b.rye < 50) {
    if (b.pl > 0.8) add('info', `P/L ca. ${fmt1(b.pl)}: zäh-elastischer Teig, er zieht sich beim Ausziehen gern zurück.`, 'Ballen vor dem Formen länger entspannen lassen; eignet sich gut für lange Gare.');
    else if (b.pl < 0.4) add('info', `P/L ca. ${fmt1(b.pl)}: sehr dehnbarer Teig, der wenig Spannung hält.`, 'Straffer ballen, Stückgare nicht zu lang, eher mit kräftigerem Mehl mischen.');
  }
  // 7) Mindesthaltbarkeit der eigenen Mehle (Vollkorn wird durch Fette im Keim schneller ranzig)
  const today = new Date().toISOString().slice(0, 10);
  b.parts.filter((x) => x.mine && x.my.bestBefore && x.my.bestBefore < today).forEach((x) => add(x.whole ? 'yellow' : 'info',
    `„${x.my.name}“ ist laut MHD abgelaufen (${x.my.bestBefore.split('-').reverse().join('.')}).`, x.whole ? 'Vollkorn kann ranzig werden – vorher riechen und probieren.' : 'Meist noch gut, aber Backkraft und Enzyme lassen nach.'));
  const level = items.reduce((l, x) => (x.level === 'info' ? l : worst(l, x.level)), 'green');
  return { level, items, blend: b, hours: { main: mainH, ...h } };
}

// ---------- Erfolge ----------
// Werden nur aus vorhandenen Daten berechnet. „Gesehen“ wird je Gerät in den Einstellungen vermerkt.
const pfTypes = (r) => (r?.preferments || []).map((p) => p.type);
const weekNo = (iso) => { const d = new Date(`${iso}T12:00:00`); return Math.floor((d.getTime() / 86400000 + 3) / 7); };

export const ACHIEVEMENTS = [
  { id: 'first', icon: '🥇', title: 'Erster Eintrag', desc: 'Den ersten Backtag ins Tagebuch geschrieben.', test: ({ logs }) => logs.length >= 1 },
  { id: 'pizza', icon: '🍕', title: 'Pizzaiolo', desc: 'Eine Pizza gebacken und eingetragen.', test: ({ logs, rec }) => logs.some((l) => rec(l)?.category === 'pizza') },
  { id: 'bread', icon: '🍞', title: 'Brotzeit', desc: 'Ein Brot gebacken und eingetragen.', test: ({ logs, rec }) => logs.some((l) => rec(l)?.category === 'bread') },
  { id: 'fine', icon: '🥐', title: 'Feinbäcker', desc: 'Ein Feingebäck gebacken und eingetragen.', test: ({ logs, rec }) => logs.some((l) => rec(l)?.category === 'fine') },
  { id: 'laminate', icon: '🧈', title: 'Tourier-Meister', desc: 'Einen Teig mit Ziehfett touriert (Croissant, Plunder).', test: ({ logs, rec }) => logs.some((l) => num(rec(l)?.lamination?.pct) > 0) },
  { id: 'cake', icon: '🎂', title: 'Konditor', desc: 'Einen Kuchen gebacken und eingetragen.', test: ({ logs, rec }) => logs.some((l) => rec(l)?.category === 'cake') },
  { id: 'five', icon: '⭐', title: 'Volltreffer', desc: 'Ein Ergebnis mit 5 Sternen bewertet.', test: ({ logs }) => logs.some((l) => num(l.rating) === 5) },
  { id: 'biga', icon: '🧱', title: 'Biga-Baumeister', desc: 'Mit Biga gebacken.', test: ({ logs, rec }) => logs.some((l) => pfTypes(rec(l)).includes('biga')) },
  { id: 'poolish', icon: '🫧', title: 'Poolish-Profi', desc: 'Mit Poolish gebacken.', test: ({ logs, rec }) => logs.some((l) => pfTypes(rec(l)).includes('poolish')) },
  { id: 'sour', icon: '🦠', title: 'Sauerteig-Hüter', desc: 'Mit Sauerteig oder Lievito Madre gebacken.', test: ({ logs, rec }) => logs.some((l) => pfTypes(rec(l)).some((t) => t === 'levain' || t === 'madre')) },
  { id: 'long', icon: '⏳', title: 'Geduldig', desc: 'Einen Teig 48 h oder länger geführt.', test: ({ logs }) => logs.some((l) => num(l.params?.totalHours) >= 48) },
  { id: 'hydro', icon: '💧', title: 'Nasse Sache', desc: 'Mit 75 % Hydration oder mehr gebacken.', test: ({ logs }) => logs.some((l) => num(l.params?.hydration) >= 75) },
  { id: 'ice', icon: '🧊', title: 'Cool bleiben', desc: 'Mit Eis im Teig gearbeitet.', test: ({ logs }) => logs.some((l) => num(l.iceG) > 0) },
  { id: 'thermo', icon: '🌡️', title: 'Thermometer-Profi', desc: 'In 3 Einträgen die Teigtemperatur notiert.', test: ({ logs }) => logs.filter((l) => String(l.doughTemp ?? '').trim() !== '').length >= 3 },
  { id: 'ten', icon: '📒', title: 'Back-Chronist', desc: '10 Backtage eingetragen.', test: ({ logs }) => logs.length >= 10 },
  { id: 'routine', icon: '🔁', title: 'Routine', desc: 'In 3 aufeinanderfolgenden Wochen gebacken.', test: ({ logs }) => {
    const w = [...new Set(logs.map((l) => l.date).filter(Boolean).map(weekNo))].sort((a, b) => a - b);
    return w.some((x, i) => w[i + 1] === x + 1 && w[i + 2] === x + 2);
  } },
  { id: 'collector', icon: '📚', title: 'Sammler', desc: '10 eigene Rezepte im Teigbuch.', test: ({ recipes }) => recipes.length >= 10 },
];

export function earnedAchievements({ recipes, logs }) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const ctx = { recipes, logs, rec: (l) => byId.get(l.recipeId) };
  return ACHIEVEMENTS.filter((a) => { try { return a.test(ctx); } catch { return false; } }).map((a) => a.id);
}
