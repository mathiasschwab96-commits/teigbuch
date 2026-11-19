// Teigbuch – Rezept aus Bild, Link oder Text über eine beliebige KI („KI-Brücke“)
//
// Ablauf: Die App erzeugt einen Auftragstext → der Nutzer gibt ihn mit Foto/Screenshot in eine
// KI-App seiner Wahl ein → die Antwort (JSON in Gramm) wird hier eingefügt und in ein
// Teigbuch-Rezept (Bäckerprozente) umgerechnet. Das Ergebnis läuft danach wie jede Datei von
// außen über MG.importRecipe (Bereinigung) und öffnet sich als Entwurf im Editor.
// Es wird keine KI direkt angesprochen und kein Schlüssel gespeichert.
import { num, uid, PF_TYPES, STEP_KINDS, LOCATIONS } from './calc.js';

export const KI_FORMAT = 'ki-1';

const EXAMPLE = {
  teigbuch: KI_FORMAT, name: '', category: 'pizza', description: '', source: '', yeastType: 'fresh',
  pieces: { count: 4, weight_g: 280 },
  preferments: [{ type: 'biga', name: 'Biga', flour_name: 'Tipo 00', flour_g: 200, water_g: 100, yeast_g: 1, starter_g: 0, starter_hydration: 100 }],
  main: { flours: [{ name: 'Tipo 00', g: 500 }], water_g: 300, ice_g: 0, water_temp_c: null, salt_g: 15, yeast_g: 0, oil_g: 0, extras: [{ name: 'Honig', g: 5 }] },
  steps: [{ kind: 'prep', name: 'Biga ansetzen', minutes: 10, location: 'rt', temp: '', stage: 'pf1', parallel: false, repeat: null, notes: '' }],
  notes: '',
};

// Auftragstext für die KI. input = optionaler Link oder Rezepttext.
export function buildPrompt(input = '') {
  const t = String(input || '').trim();
  const src = !t ? 'Das Rezept steht im angehängten Bild bzw. Screenshot.'
    : /^https?:\/\/\S+$/i.test(t) ? `Das Rezept findest du unter diesem Link (falls du ihn nicht öffnen kannst, sag es kurz – dann schicke ich Screenshots):\n${t}`
      : `Hier ist der Rezepttext (ggf. zusätzlich angehängte Bilder beachten):\n"""\n${t.slice(0, 12000)}\n"""`;
  return `Du hilfst mir, ein Rezept in meine Back-App „Teigbuch“ zu übernehmen.
${src}

Gib das Rezept AUSSCHLIESSLICH als JSON in genau diesem Format zurück – ein einziger \`\`\`json-Codeblock, kein weiterer Text:

${JSON.stringify(EXAMPLE, null, 1)}

Regeln:
- Alle Mengen in Gramm als Zahl (ohne Einheit). Stehen nur Bäckerprozente da, rechne für die angegebene Teigmenge in Gramm um. Löffel/Stück sinnvoll in Gramm schätzen und in "notes" vermerken.
- Vorteige (Biga, Poolish, Sauerteig/Levain, Lievito Madre) gehören in "preferments" – nur ihre eigenen Zutaten. "main" enthält NUR, was beim Hauptteig zusätzlich dazukommt (nicht den Vorteig selbst). Kein Vorteig: "preferments": [].
- preferments.type: "biga", "poolish", "levain" (Sauerteig), "madre" (Lievito Madre) oder "custom". starter_g = Anstellgut bzw. Madre, das in diesen Vorteig kommt; starter_hydration in % (meist 100, Madre meist 50). flour_name = Mehlsorte des Vorteigs.
- Kommt Anstellgut/Madre direkt in den Hauptteig (ohne eigenen Vorteig), lege dafür einen Vorteig an: {"type": "levain", "name": "Anstellgut", "flour_g": 0, "water_g": 0, "starter_g": <Menge>, "starter_hydration": <Hydration>}.
- water_g = flüssiges Wasser OHNE Eis; Eis separat in ice_g; water_temp_c = Wassertemperatur in °C oder null. Milch, Bier usw. als "extras".
- yeastType: "fresh" (Frischhefe) oder "dry" (Trockenhefe); "" wenn keine Hefe oder unklar.
- category: "pizza", "bread" oder "other". pieces: Anzahl und Gewicht je Teigling/Laib, sonst null.
- steps in zeitlicher Reihenfolge. kind: "prep" (Vorteig ansetzen/auffrischen), "autolyse", "mix" (Hauptteig mischen/kneten), "bulk" (Stockgare), "rest" (Ruhe/Reife), "fold" (Dehnen & Falten), "shape" (teilen/formen), "proof" (Stückgare), "temper" (akklimatisieren), "preheat" (Ofen vorheizen), "bake", "cool", "other".
  location: "rt" (Raumtemperatur), "fridge" (Kühlschrank), "warm" oder "oven". minutes = Dauer in Minuten (bei Spannen den Mittelwert).
  stage: "pf1"/"pf2" = gehört zum 1./2. Vorteig, "main" = Hauptteig, sonst null. parallel: true, wenn der Schritt gleichzeitig mit dem vorherigen läuft (z. B. Ofen vorheizen während der Stückgare).
  repeat: z. B. {"count": 4, "interval_min": 30} bei wiederholtem Dehnen & Falten, sonst null. temp: Temperatur als Text, z. B. "18 °C".
- Was nicht im Rezept steht: leer lassen ("", null oder 0) – nichts erfinden.
- source: Link oder Buch/Kanal, falls bekannt. Alle Texte auf Deutsch.`;
}

// JSON aus einer KI-Antwort herauslösen (Codeblock oder erstes {…} bis letztes })
export function extractJSON(text) {
  const s = String(text || '');
  const block = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = block ? block[1] : s;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0) throw new Error('In der Antwort wurde kein Rezept-Code ({ … }) gefunden.');
  if (b <= a) throw new Error('Der Rezept-Code ist unvollständig. Bitte die komplette Antwort der KI kopieren.');
  body = body.slice(a, b + 1)
    .replace(/[“”„]/g, '"')                 // typografische Anführungszeichen
    .replace(/,\s*([}\]])/g, '$1');         // überzählige Kommas
  try { return JSON.parse(body); } catch { throw new Error('Der Rezept-Code ist unvollständig oder beschädigt. Bitte die komplette Antwort der KI kopieren.'); }
}

const g = (v) => Math.max(0, num(v));
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const txt = (v, max = 4000) => (v === undefined || v === null ? '' : String(v).slice(0, max));

// KI-Antwort (Gramm) → Teigbuch-Rezept (Bäckerprozente). Wirft verständliche Fehler.
export function kiToRecipe(data, { schema = 1 } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Der Rezept-Code hat ein unbekanntes Format.');
  if (!data.main && !data.preferments) throw new Error('Im Rezept-Code fehlen die Zutaten („main“).');
  const main = data.main || {};
  const warnings = [];

  // Mehle im Hauptteig
  const mainFlours = (Array.isArray(main.flours) ? main.flours : []).map((f) => ({ name: txt(f?.name, 80).trim() || 'Mehl', g: g(f?.g) })).filter((f) => f.g > 0);
  const defaultFlour = mainFlours[0]?.name || 'Mehl';

  // Vorteige: Gesamtmehl/-wasser inkl. Anstellgut
  const pfIn = (Array.isArray(data.preferments) ? data.preferments : []).slice(0, 4);
  const pfs = pfIn.map((p) => {
    const type = Object.prototype.hasOwnProperty.call(PF_TYPES, p?.type) ? p.type : 'custom';
    const s = g(p?.starter_g);
    const sh = num(p?.starter_hydration) > 0 ? num(p.starter_hydration) : (type === 'madre' ? 50 : 100);
    const sFlour = s / (1 + sh / 100), sWater = s - sFlour;
    const freshF = g(p?.flour_g), freshW = g(p?.water_g);
    const flour = freshF + sFlour, water = freshW + sWater;
    return { id: uid(), type, name: txt(p?.name, 80).trim() || PF_TYPES[type].label, flourName: txt(p?.flour_name, 80).trim() || defaultFlour,
      flour, water, yeast: g(p?.yeast_g), starter: s, sh, freshF };
  }).filter((p) => p.flour > 0);

  // Gesamtmehl je Sorte
  const blend = new Map();
  mainFlours.forEach((f) => blend.set(f.name, (blend.get(f.name) || 0) + f.g));
  pfs.forEach((p) => blend.set(p.flourName, (blend.get(p.flourName) || 0) + p.flour));
  const F = [...blend.values()].reduce((a, b) => a + b, 0);
  if (!(F > 0)) throw new Error('Im Rezept-Code wurde keine Mehlmenge gefunden.');

  const ice = g(main.ice_g), liquid = g(main.water_g);
  const mainWaterAll = liquid + ice;
  const totalWater = mainWaterAll + pfs.reduce((a, p) => a + p.water, 0);
  const hyd = (totalWater / F) * 100;
  if (hyd < 35 || hyd > 130) warnings.push(`Ungewöhnliche Hydration (${Math.round(hyd)} %) – bitte die Wassermengen prüfen.`);

  const preferments = pfs.map((p) => {
    // Anstellgut allein (ohne frisches Mehl) = reifer Sauerteig als Vorteig
    const onlyStarter = p.starter > 0 && p.freshF <= 0;
    return {
      id: p.id, type: p.type, name: p.name, flourName: p.flourName,
      flourPct: r4((p.flour / F) * 100),
      hydration: r2((p.water / p.flour) * 100),
      yeastPct: r4((p.yeast / p.flour) * 100),
      starterPct: onlyStarter ? 0 : r2((p.starter / p.freshF) * 100),
      starterHydration: p.sh,
    };
  });

  const yt = data.yeastType === 'fresh' || data.yeastType === 'dry' ? data.yeastType : '';
  const pcs = data.pieces && typeof data.pieces === 'object' ? data.pieces : null;
  const count = Math.round(num(pcs?.count)), weight = num(pcs?.weight_g ?? pcs?.weight);
  const wt = main.water_temp_c;

  // Schritte
  const stageOf = (st) => {
    const m = /^pf\s*(\d)$/i.exec(String(st ?? '').trim());
    if (m) return preferments[Number(m[1]) - 1]?.id || null;
    return String(st ?? '').trim().toLowerCase() === 'main' ? 'main' : null;
  };
  const steps = (Array.isArray(data.steps) ? data.steps : []).slice(0, 40).map((s, i) => ({
    id: uid(), kind: Object.prototype.hasOwnProperty.call(STEP_KINDS, s?.kind) ? s.kind : 'other',
    name: txt(s?.name, 120).trim() || STEP_KINDS[s?.kind]?.label || 'Schritt',
    durationMin: Math.max(0, Math.round(num(s?.minutes ?? s?.durationMin))),
    location: Object.prototype.hasOwnProperty.call(LOCATIONS, s?.location) ? s.location : 'rt',
    temp: txt(s?.temp, 40), notes: txt(s?.notes, 2000), parallel: i > 0 && s?.parallel === true,
    stage: stageOf(s?.stage),
    repeat: s?.repeat && num(s.repeat.count) > 0 ? { count: Math.round(num(s.repeat.count)), intervalMin: Math.max(1, num(s.repeat.interval_min ?? s.repeat.intervalMin) || 30) } : null,
  }));

  const recipe = {
    v: schema,
    id: uid(), name: txt(data.name, 120).trim(), category: ['pizza', 'bread', 'other'].includes(data.category) ? data.category : '',
    description: txt(data.description, 500), source: txt(data.source, 300), tags: [], favorite: false, photos: [], cover: null,
    // Mehlmenge exakt wie im Original; Stückzahl/-gewicht zusätzlich, wenn angegeben
    yield: { mode: 'flour', flour: r2(F), count: count > 0 ? count : 1, pieceWeight: weight > 0 ? weight : 0, loss: 0 },
    flours: [...blend.entries()].map(([name, grams]) => ({ name, pct: r2((grams / F) * 100) })),
    water: { pct: r2(hyd), temp: wt === null || wt === undefined || wt === '' || !Number.isFinite(Number(wt)) ? '' : Number(wt), icePct: ice > 0 && mainWaterAll > 0 ? r2((ice / mainWaterAll) * 100) : '' },
    oil: { pct: r4((g(main.oil_g) / F) * 100) },
    salt: r4((g(main.salt_g) / F) * 100),
    yeastType: yt, yeastPct: r4((g(main.yeast_g) / F) * 100),
    extras: (Array.isArray(main.extras) ? main.extras : []).map((e) => ({ name: txt(e?.name, 80).trim() || 'Zutat', pct: r4((g(e?.g) / F) * 100) })).filter((e) => e.pct > 0),
    preferments, steps, ddt: 24, notes: txt(data.notes, 8000), createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (!yt && (recipe.yeastPct > 0 || preferments.some((p) => p.yeastPct > 0))) warnings.push('Hefe-Art (frisch/trocken) unklar – bitte im Schritt „Salz, Hefe & Co.“ wählen.');
  if (!recipe.category) warnings.push('Bitte im ersten Schritt wählen, ob Pizza oder Brot.');
  if (!steps.length) warnings.push('Kein Ablauf erkannt – im Schritt „Teigführung“ kannst du „✨ Ablauf vorschlagen“ nutzen.');
  return { recipe, warnings, totals: { flour: F, water: totalWater, dough: F + totalWater + g(main.salt_g) + g(main.yeast_g) + g(main.oil_g) + pfs.reduce((a, p) => a + p.yeast, 0) } };
}
