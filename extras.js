// Teigbuch – Hintergrundwissen: Mehl-Bibliothek und Erfolge
// Reine Daten/Funktionen, keine gespeicherten Felder → kein Einfluss auf Sicherungen.
import { num } from './calc.js';

// ---------- Mehl-Bibliothek ----------
// Richtwerte – je nach Hersteller verschieden. strength: weak | medium | strong
export const FLOURS = [
  { name: 'Tipo 00', match: /tipo\s*00|\b00\b|pizzamehl/i, protein: '11–13', w: '220–320', strength: 'medium', note: 'Klassiker für Pizza; mit W 300+ auch für Biga und 48 h Kühlschrank.' },
  { name: 'Tipo 0', match: /tipo\s*0(?!0)\b/i, protein: '11–13', w: '220–300', strength: 'medium', note: 'Etwas mehr Schale als Tipo 00, kräftigerer Geschmack.' },
  { name: 'Tipo 1', match: /tipo\s*1\b/i, protein: '11,5–13', w: '250–320', strength: 'medium', note: 'Rustikal, nimmt etwas mehr Wasser auf.' },
  { name: 'Tipo 2', match: /tipo\s*2\b/i, protein: '12–13', w: '–', strength: 'medium', note: 'Fast Vollkorn – mehr Wasser, kürzere Gare.' },
  { name: 'Manitoba', match: /manitoba/i, protein: '13,5–15', w: '350–420', strength: 'strong', note: 'Sehr kräftig – ideal für lange Führungen und Biga, oft als Anteil gemischt.' },
  { name: 'Semola rimacinata', match: /semola|hartweizen/i, protein: '12–13', w: '–', strength: 'medium', note: 'Hartweizen: gelbe Krume, gut zum Bestreuen beim Ausformen.' },
  { name: 'Weizenmehl 405', match: /\b405\b/i, protein: '9–11', w: '~150–200', strength: 'weak', note: 'Eher für Kuchen – für Pizza/Brot nur kurz geführt.' },
  { name: 'Weizenmehl 550', match: /\b550\b/i, protein: '10,5–12', w: '~200–250', strength: 'weak', note: 'Allrounder – am besten bis ca. 24 h Gesamtführung.' },
  { name: 'Weizenmehl 1050', match: /\b1050\b/i, protein: '11–13', w: '–', strength: 'medium', note: 'Kräftiger Geschmack, nimmt mehr Wasser auf.' },
  { name: 'Weizenvollkornmehl', match: /weizen.*vollkorn|vollkorn.*weizen|^vollkorn/i, protein: '12–14', w: '–', strength: 'medium', note: 'Braucht ca. 5–10 % mehr Wasser; Quellzeit hilft.' },
  { name: 'Dinkelmehl 630', match: /dinkel/i, protein: '11–13', w: '–', strength: 'weak', note: 'Empfindliches Klebergerüst: kürzer kneten, etwas weniger Wasser.' },
  { name: 'Roggenmehl 1150', match: /roggen/i, protein: '8–10', w: '–', strength: 'weak', note: 'Kaum Kleber – braucht Sauerteig (Säure) für gute Backeigenschaften.' },
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
