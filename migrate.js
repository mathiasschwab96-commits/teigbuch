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
//   4  App 1.9 – neue Kategorien „fine“ (Feingebäck) und „cake“ (Kuchen & Torten);
//               Rezept lamination {pct, name} (Ziehfett, 0 = keins), pan {shape, d, l, w, n} (Backform, '' = keine Angabe),
//               parts [{id, name, items:[{name, amount, unit}]}] (nur Kuchen); Schritt-Arten „laminate“, „assemble“;
//               Tagebuch params.pan (Form als Text). Ältere Rezepte hatten nichts davon → leer/0, keine Rückfrage nötig.
//   5  App 2.0 – Schritt „align“ ('' = zusammen starten wie bisher, 'end' = zusammen fertig) für parallele Schritte;
//               Tagebuch „protocol“ (Backprotokoll: Schritte geplant/tatsächlich, Notizen, Fotos, Teiggefühl,
//               Anpassungen, Mengen). Ältere Einträge haben kein Protokoll (null) – es wird nichts erfunden.
//   6  App 2.1 – Vorteige: liquid ('water' | 'milk'), saltPct (Salz im Vorteig), seeds (Quellstück aus Saaten);
//               neue Vorteig-Arten dampfl, pate, tangzhong, yudane, quell. Bisherige Vorteige waren immer
//               Wasser ohne Salz und ohne Saaten → eindeutig, keine Rückfrage.
//               Neu: „Meine Kulturen“ (eigene Datenart, Sicherung „cultures“, Sync kind 'culture').
//   7  App 2.2 – Vorteige: liquid 'mix' + milkShare (Wasser/Milch gemischt), extras [{name, pct}] (Zutaten im Vorteig,
//               z. B. Zucker/Butter/Eigelb beim Panettone), starterFrom (mehrstufiger Sauerteig: vorige Stufe als Anstellgut).
//               Bisher gab es nichts davon → leer, keine Rückfrage.
//   8  App 2.4 – Vorteige: flours [{name, pct}] (Mehlmischung im Vorteig; leer = eine Sorte wie bisher über flourName),
//               liquidName (Flüssigkeit statt Milch, z. B. Bier/Buttermilch; '' = Milch wie bisher).
//               Bisher immer eine Sorte und Milch → leer, keine Rückfrage. flourName bleibt (erste Sorte) für ältere Apps.
//   9  App 2.6 – neue Datenart „Meine Mehle“ (IndexedDB „flours“, DB-Version 3; Sicherung „flours“; Sync kind 'flour').
//               Rezepte verweisen weiterhin nur über den Mehlnamen → an Rezepten/Tagebuch ändert sich nichts.
//               Ältere Sicherungen haben keine Mehle → einfach keine, keine Rückfrage.
import { num, sanitizeRecipe, sanitizeLog, sanitizeCulture, sanitizeFlour, CATEGORIES, isCake } from './calc.js';

export const SCHEMA = 9;

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
  // 3 → 4: Ziehfett, Backform und Kuchen-Bestandteile – bisherige Rezepte hatten nichts davon
  3: (r) => {
    if (r.lamination === undefined) r.lamination = { pct: 0, name: '' };
    if (r.pan === undefined) r.pan = { shape: '', d: 0, l: 0, w: 0, n: 0 };
    if (r.parts === undefined) r.parts = [];
    return r;
  },
  // 4 → 5: parallele Schritte starteten bisher immer gleichzeitig mit dem vorherigen → align '' (eindeutig, keine Rückfrage)
  4: (r) => {
    r.steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => (s && s.align === undefined ? { ...s, align: '' } : s));
    return r;
  },
  // 5 → 6: Vorteige waren bisher immer mit Wasser, ohne Salz, ohne Saaten
  5: (r) => {
    r.preferments = (Array.isArray(r.preferments) ? r.preferments : []).map((pf) => (pf && typeof pf === 'object'
      ? { ...pf, liquid: pf.liquid ?? 'water', saltPct: pf.saltPct ?? 0, seeds: pf.seeds ?? false } : pf));
    return r;
  },
  // 6 → 7: keine Mischflüssigkeit, keine Zutaten im Vorteig, keine Stufen-Kette
  6: (r) => {
    r.preferments = (Array.isArray(r.preferments) ? r.preferments : []).map((pf) => (pf && typeof pf === 'object'
      ? { ...pf, milkShare: pf.milkShare ?? 0, extras: pf.extras ?? [], starterFrom: pf.starterFrom ?? '' } : pf));
    return r;
  },
  // 7 → 8: bisher eine Mehlsorte je Vorteig und als Flüssigkeit nur Wasser/Milch
  7: (r) => {
    r.preferments = (Array.isArray(r.preferments) ? r.preferments : []).map((pf) => (pf && typeof pf === 'object'
      ? { ...pf, flours: pf.flours ?? [], liquidName: pf.liquidName ?? '' } : pf));
    return r;
  },
  // 8 → 9: keine Änderung am Rezept (neu ist nur die eigene Datenart „Meine Mehle“)
  8: (r) => r,
};

const LOG_MIGRATIONS = {
  // 1 → 2 (keine inhaltliche Änderung)
  1: (l) => l,
  // 2 → 3: optionale Felder Wassertemperatur / Eis
  2: (l) => ({ ...l, waterTemp: l.waterTemp ?? '', iceG: l.iceG ?? '' }),
  // 3 → 4: optionale Backform (nur Kuchen)
  3: (l) => ({ ...l, params: { ...(l.params || {}), pan: l.params?.pan ?? '' } }),
  // 4 → 5: Backprotokoll gab es noch nicht → null (kann bei vorhandenem Backvorgang später übernommen werden)
  4: (l) => ({ ...l, protocol: l.protocol ?? null }),
  // 5 → 6, 6 → 7 und 7 → 8 (keine Änderung am Tagebuch; Protokoll-pct.pfs kann ab 2.4 flours/extras enthalten – optional)
  5: (l) => l,
  6: (l) => l,
  7: (l) => l,
  8: (l) => l,
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
// Kulturen gibt es ab Schema 6 – frühere Versionen hatten keine, daher (noch) keine Migrationen
const CULTURE_MIGRATIONS = {};
export const migrateCulture = (c) => run(c, CULTURE_MIGRATIONS);
export function importCulture(raw) { const m = migrateCulture(raw); return { rec: sanitizeCulture(m.rec), newer: m.newer }; }
// Meine Mehle gibt es ab Schema 9 – noch keine Migrationen
const FLOUR_MIGRATIONS = {};
export const migrateFlour = (f) => run(f, FLOUR_MIGRATIONS);
export function importFlour(raw) { const m = migrateFlour(raw); return { rec: sanitizeFlour(m.rec), newer: m.newer }; }
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
    // Kuchen werden nicht angeboten: deren Rezepte haben ein eigenes Format (Bestandteile statt Bäckerprozente)
    id: 'category', question: 'Zu welcher Art gehört das Rezept?',
    missing: (r) => !CATEGORIES.includes(r.category),
    input: { type: 'choice', options: [['pizza', '🍕 Pizza'], ['bread', '🍞 Brot'], ['fine', '🥐 Feingebäck'], ['other', '🍽️ Sonstiges']] },
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
    missing: (r) => !isCake(r) && r.yield?.mode !== 'flour' && !(num(r.yield?.pieceWeight) > 0),
    input: { type: 'number', unit: 'g', min: 1 },
    apply: (r, v) => { r.yield = { ...r.yield, mode: 'pieces', pieceWeight: num(v), count: num(r.yield?.count) || 1 }; },
  },
  {
    id: 'flour', question: 'Wie viel Mehl (gesamt) enthält das Rezept?',
    missing: (r) => !isCake(r) && r.yield?.mode === 'flour' && !(num(r.yield?.flour) > 0),
    input: { type: 'number', unit: 'g', min: 1 },
    apply: (r, v) => { r.yield = { ...r.yield, flour: num(v) }; },
  },
];

export const openQuestions = (r) => CHECKS.filter((c) => c.missing(r));
