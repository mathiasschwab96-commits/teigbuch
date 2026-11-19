// Teigbuch – Datenversionen & Migrationen
//
// ZIEL: Jede jemals erstellte Sicherung (und jeder Datenstand auf einem Gerät) muss mit jeder
// späteren App-Version weiter funktionieren.
//
// REGELN FÜR JEDE ÄNDERUNG AM DATENFORMAT (siehe auch CLAUDE.md):
//  1. SCHEMA um 1 erhöhen.
//  2. Eine Migration „vorherige Version → neue Version“ in RECIPE_MIGRATIONS / LOG_MIGRATIONS ergänzen.
//     Migrationen dürfen nur ergänzen/umrechnen – niemals Daten stillschweigend verwerfen.
//  3. Kann ein neuer Wert NICHT sicher abgeleitet werden: KEINEN Wert erfinden, sondern das Feld leer
//     lassen und in CHECKS eine Frage ergänzen → die App lässt die Angabe nachtragen.
//  4. In tests/fixtures/ eine Sicherung der VORHERIGEN Version ablegen und tests/compat.html erweitern.
//  5. Felder nie umbenennen oder entfernen, ohne Migration. Unbekannte Felder werden aufbewahrt.
//
// Versionsgeschichte
//   1  bis App 1.4 – Einträge ohne Versionsfeld
//   2  App 1.5 – Feld „v“ je Eintrag, Rezept-„source“, yield.mode immer gesetzt
//   3  App 1.7 – optional: Rezept water.temp (°C) und water.icePct (% des Hauptteig-Wassers als Eis);
//               Tagebuch waterTemp / iceG. Leer = nicht angegeben, daher keine Rückfrage nötig.
import { num, sanitizeRecipe, sanitizeLog } from './calc.js';

export const SCHEMA = 3;

const RECIPE_MIGRATIONS = {
  // 1 → 2
  1: (r) => {
    r.source = r.source ?? '';
    r.yield = { ...(r.yield || {}) };
    if (r.yield.mode !== 'flour' && r.yield.mode !== 'pieces') r.yield.mode = num(r.yield.flour) > 0 && !(num(r.yield.pieceWeight) > 0) ? 'flour' : 'pieces';
    return r;
  },
  // 2 → 3: optionale Wasser-Angaben ergänzen (vorhandene Werte bleiben unberührt)
  2: (r) => {
    r.water = { ...(r.water || {}) };
    if (r.water.temp === undefined) r.water.temp = '';
    if (r.water.icePct === undefined) r.water.icePct = '';
    return r;
  },
};

const LOG_MIGRATIONS = {
  // 1 → 2 (keine inhaltliche Änderung)
  1: (l) => l,
  // 2 → 3: optionale Felder Wassertemperatur / Eis
  2: (l) => ({ ...l, waterTemp: l.waterTemp ?? '', iceG: l.iceG ?? '' }),
};

function run(rec, migrations) {
  let r = { ...rec };
  let v = Math.max(1, Math.floor(num(r.v)) || 1);
  if (v > SCHEMA) return { rec: r, newer: true };       // aus neuerer App-Version: unverändert aufbewahren
  while (v < SCHEMA) {
    const step = migrations[v];
    if (step) r = step(r) || r;
    v++;
  }
  r.v = SCHEMA;
  return { rec: r, newer: false };
}

export const migrateRecipe = (r) => run(r, RECIPE_MIGRATIONS);
export const migrateLog = (l) => run(l, LOG_MIGRATIONS);
export const needsMigration = (rec) => (Math.floor(num(rec?.v)) || 1) < SCHEMA;

// DER eine Weg für alle Daten von außen (Sicherungsdatei, QR-Code, Geräte-Sync):
// erst auf das aktuelle Format bringen, dann bereinigen. newer = stammt aus neuerer App-Version.
export function importRecipe(raw) { const m = migrateRecipe(raw); return { rec: sanitizeRecipe(m.rec), newer: m.newer }; }
export function importLog(raw) { const m = migrateLog(raw); return { rec: sanitizeLog(m.rec), newer: m.newer }; }

// ---------- Fehlende Angaben, die der Nutzer nachtragen soll ----------
// Jede Prüfung: wann sie greift, wann etwas fehlt, wie gefragt wird und wie die Antwort gespeichert wird.
const usesYeast = (r) => num(r.yeastPct) > 0 || (r.preferments || []).some((p) => num(p.yeastPct) > 0);

export const CHECKS = [
  {
    id: 'category', question: 'Ist das ein Pizza- oder ein Brotrezept?',
    missing: (r) => !['pizza', 'bread', 'other'].includes(r.category),
    input: { type: 'choice', options: [['pizza', '🍕 Pizza'], ['bread', '🍞 Brot'], ['other', '🥐 Sonstiges']] },
    apply: (r, v) => { r.category = v; },
  },
  {
    id: 'yeastType', question: 'Welche Hefe verwendet dieses Rezept?',
    missing: (r) => usesYeast(r) && !['fresh', 'dry'].includes(r.yeastType),
    input: { type: 'choice', options: [['fresh', 'Frischhefe'], ['dry', 'Trockenhefe']] },
    apply: (r, v) => { r.yeastType = v; },
  },
  {
    id: 'pieceWeight', question: 'Wie schwer ist ein Teigling bzw. Laib?',
    missing: (r) => r.yield?.mode !== 'flour' && !(num(r.yield?.pieceWeight) > 0),
    input: { type: 'number', unit: 'g', min: 1 },
    apply: (r, v) => { r.yield = { ...r.yield, mode: 'pieces', pieceWeight: num(v), count: num(r.yield?.count) || 1 }; },
  },
  {
    id: 'flour', question: 'Wie viel Mehl (gesamt) enthält das Rezept?',
    missing: (r) => r.yield?.mode === 'flour' && !(num(r.yield?.flour) > 0),
    input: { type: 'number', unit: 'g', min: 1 },
    apply: (r, v) => { r.yield = { ...r.yield, flour: num(v) }; },
  },
];

export const openQuestions = (r) => CHECKS.filter((c) => c.missing(r));
