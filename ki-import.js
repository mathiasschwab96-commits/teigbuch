// Teigbuch – Rezept aus Bild, Link oder Text über eine beliebige KI („KI-Brücke“)
//
// Ablauf: Die App erzeugt einen Auftragstext → der Nutzer gibt ihn mit Foto/Screenshot in eine
// KI-App seiner Wahl ein → die Antwort (JSON in Gramm) wird hier eingefügt und in ein
// Teigbuch-Rezept (Bäckerprozente) umgerechnet. Das Ergebnis läuft danach wie jede Datei von
// außen über MG.importRecipe (Bereinigung) und öffnet sich als Entwurf im Editor.
// Es wird keine KI direkt angesprochen und kein Schlüssel gespeichert.
import { num, uid, PF_TYPES, STEP_KINDS, LOCATIONS, UNITS, liquidShare, milkIndex, sameName, calc } from './calc.js';

export const KI_FORMAT = 'ki-1';

// Format A: Hefe-/Sauerteig (Pizza, Brot, Feingebäck) – Mengen in Gramm, App rechnet Bäckerprozente
const EXAMPLE = {
  teigbuch: KI_FORMAT, name: '', category: 'pizza', description: '', source: '', yeastType: 'fresh',
  pieces: { count: 4, weight_g: 280 },
  preferments: [{ type: 'biga', name: 'Biga', flour_name: 'Tipo 00', flour_g: 200, water_g: 100, milk_g: 0, yeast_g: 1, starter_g: 0, starter_hydration: 100, starter_from: null, salt_g: 0, seeds: false, extras: [] }],
  main: { flours: [{ name: 'Tipo 00', g: 500 }], water_g: 300, ice_g: 0, water_temp_c: null, salt_g: 15, yeast_g: 0, oil_g: 0, extras: [{ name: 'Honig', g: 5 }] },
  lamination: { name: '', g: 0 },
  steps: [{ kind: 'prep', name: 'Biga ansetzen', minutes: 10, location: 'rt', temp: '', stage: 'pf1', parallel: false, repeat: null, notes: '' }],
  notes: '',
};
// Format B: Kuchen & Torten – Zutatenliste je Bestandteil + Backform
const CAKE_EXAMPLE = {
  teigbuch: KI_FORMAT, name: '', category: 'cake', description: '', source: '',
  pan: { shape: 'round', diameter_cm: 26, length_cm: null, width_cm: null, count: null },
  parts: [{ name: 'Rührteig', items: [{ name: 'Butter', amount: 250, unit: 'g' }, { name: 'Eier', amount: 4, unit: 'Stk' }, { name: 'Backpulver', amount: 1, unit: 'Pck' }] }],
  steps: [{ kind: 'mix', name: 'Teig rühren', minutes: 15, location: 'rt', temp: '', stage: 'part1', parallel: false, repeat: null, notes: '' }],
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

Gib das Rezept AUSSCHLIESSLICH als JSON zurück – ein einziger \`\`\`json-Codeblock, kein weiterer Text. Wähle das passende Format:

FORMAT A – Teige mit Hefe oder Sauerteig (Pizza, Brot, Brötchen, Croissant, Plunder, Brioche, Hefezopf):
${JSON.stringify(EXAMPLE, null, 1)}

FORMAT B – Kuchen, Torten, Muffins, Kekse, Rühr-/Biskuit-/Mürbeteig (ohne Hefe-Führung):
${JSON.stringify(CAKE_EXAMPLE, null, 1)}

Regeln für FORMAT B:
- category: "cake". parts = Bestandteile wie im Rezept (z. B. "Boden", "Füllung", "Creme"); jede Zutat mit amount (Zahl) und unit: "g", "ml", "Stk", "EL", "TL", "Pck" oder "Prise" – so wie im Rezept angegeben, nicht umrechnen. amount 0 = "nach Belieben".
- pan.shape: "round" (Springform, diameter_cm), "rect" (eckig/Kastenform/Blech, length_cm und width_cm), "count" (Muffins/Kekse, count) oder "" wenn unbekannt.
- steps wie unten; stage: "part1"/"part2" … = Zutaten dieses Bestandteils werden in dem Schritt gebraucht, sonst null. Zusätzlich kind "assemble" (füllen/fertigstellen) möglich.

Regeln für FORMAT A:
- Alle Mengen in Gramm als Zahl (ohne Einheit). Stehen nur Bäckerprozente da, rechne für die angegebene Teigmenge in Gramm um. Löffel/Stück sinnvoll in Gramm schätzen und in "notes" vermerken.
- category: "pizza", "bread", "fine" (Feingebäck: Croissant, Plunder, Brioche, Hefezopf …) oder "other".
- Milch, Eier, Butter, Zucker im Teig als "extras" (Eier in Gramm, 1 Ei ≈ 50 g). Butter zum Tourieren/Einschlagen (Croissant, Plunder) NICHT in extras, sondern in "lamination" ({"name": "Butter", "g": Menge}); sonst g: 0. Touren als Schritte mit kind "laminate".
- Vorteige UND Vorstufen gehören in "preferments" – nur ihre eigenen Zutaten. "main" enthält NUR, was beim Hauptteig zusätzlich dazukommt (nicht den Vorteig selbst). Kein Vorteig: "preferments": [].
- preferments.type: "biga", "poolish", "levain" (Sauerteig), "madre" (Lievito Madre), "dampfl" (Dampfl/Hefestück/Sponge), "pate" (Pâte fermentée/Altteig), "tangzhong" (Tangzhong/Kochstück/Mehlkochstück), "yudane" (Yudane/Brühstück), "quell" (Quellstück) oder "custom". starter_g = Anstellgut bzw. Madre, das in diesen Vorteig kommt; starter_hydration in % (meist 100, Madre meist 50). flour_name = Mehlsorte des Vorteigs (bei Saaten deren Name).
- Zusätzlich je Vorteig: "water_g" = Wasser, "milk_g" = Milch (beides möglich, z. B. Tangzhong aus Wasser UND Milch), "salt_g" (Salz im Vorteig, sonst 0), "seeds": true bei einem Quellstück aus Saaten (flour_g = Saaten), sonst false, "extras": weitere Zutaten, die schon IN diesen Vorteig kommen (z. B. Zucker, Butter, Eigelb beim ersten Panettone-Teig) als [{"name": "Zucker", "g": 63}] – diese NICHT zusätzlich in main.extras.
- Mehrstufiger Sauerteig (z. B. Anfrisch-, Grund-, Vollsauer) bzw. erster/zweiter Teig: jede Stufe als eigener Vorteig; nutzt eine Stufe die GANZE vorige Stufe, dort "starter_from": "pf1" (bzw. "pf2") und nur die frisch zugegebenen Mengen in flour_g/water_g. In "main" kommt nur die letzte Stufe.
- Kommt Anstellgut/Madre direkt in den Hauptteig (ohne eigenen Vorteig), lege dafür einen Vorteig an: {"type": "levain", "name": "Anstellgut", "flour_g": 0, "water_g": 0, "starter_g": <Menge>, "starter_hydration": <Hydration>}.
- water_g = flüssiges Wasser OHNE Eis; Eis separat in ice_g; water_temp_c = Wassertemperatur in °C oder null. Milch, Bier usw. als "extras".
- yeastType: "fresh" (Frischhefe) oder "dry" (Trockenhefe); "" wenn keine Hefe oder unklar.
- pieces: Anzahl und Gewicht je Teigling/Laib/Stück, sonst null.

Für beide Formate:
- steps in zeitlicher Reihenfolge. kind: "prep" (Vorteig ansetzen/auffrischen), "autolyse", "mix" (mischen/kneten/rühren), "bulk" (Stockgare), "rest" (Ruhe/Reife/Kühlen), "fold" (Dehnen & Falten), "shape" (teilen/formen), "laminate" (tourieren), "proof" (Stückgare), "temper" (akklimatisieren), "preheat" (Ofen vorheizen), "bake", "cool", "assemble" (füllen/fertigstellen), "other".
  location: "rt" (Raumtemperatur), "fridge" (Kühlschrank), "warm" oder "oven". minutes = Dauer in Minuten (bei Spannen den Mittelwert).
  stage: "pf1"/"pf2" = gehört zum 1./2. Vorteig, "main" = Hauptteig, sonst null. parallel: true, wenn der Schritt nebenher zum vorherigen läuft; dazu "align": "end", wenn beide gleichzeitig fertig sein sollen (z. B. Ofen vorheizen während der Stückgare), sonst "align": "start" (beide starten gleichzeitig).
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
  body = body.slice(a, b + 1);
  // 1. Versuch: unverändert – typografische Anführungszeichen IM Text („Mehl“) sind gültiges JSON und bleiben erhalten
  try { return JSON.parse(body); } catch { /* reparieren */ }
  // 2. Versuch: nur reparieren, was die Struktur betrifft – typografische Anführungszeichen, die ein Feld
  //    umschließen (direkt nach { [ , : bzw. vor } ] , :), sowie überzählige Kommas
  const fixed = body
    .replace(/([{[,:]\s*)[“”„]/g, '$1"')
    .replace(/[“”„](\s*[}\],:])/g, '"$1')
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(fixed); } catch { throw new Error('Der Rezept-Code ist unvollständig oder beschädigt. Bitte die komplette Antwort der KI kopieren.'); }
}

const g = (v) => Math.max(0, num(v));
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const txt = (v, max = 4000) => (v === undefined || v === null ? '' : String(v).slice(0, max));

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
// Schritte (beide Formate). stageOf: KI-Kennung („pf1“, „main“, „part2“) → ID im Rezept
function parseSteps(list, stageOf) {
  return (Array.isArray(list) ? list : []).slice(0, 40).map((s, i) => ({
    id: uid(), kind: has(STEP_KINDS, s?.kind) ? s.kind : 'other',
    name: txt(s?.name, 120).trim() || STEP_KINDS[s?.kind]?.label || 'Schritt',
    durationMin: Math.max(0, Math.round(num(s?.minutes ?? s?.durationMin))),
    location: has(LOCATIONS, s?.location) ? s.location : 'rt',
    temp: txt(s?.temp, 40), notes: txt(s?.notes, 2000), parallel: i > 0 && s?.parallel === true,
    align: i > 0 && s?.parallel === true && s?.align === 'end' ? 'end' : '',
    stage: stageOf(s?.stage),
    repeat: s?.repeat && num(s.repeat.count) > 0 ? { count: Math.round(num(s.repeat.count)), intervalMin: Math.max(1, num(s.repeat.interval_min ?? s.repeat.intervalMin) || 30) } : null,
  }));
}

// Einheiten-Schreibweisen der KIs vereinheitlichen; kg/l werden in g/ml umgerechnet
// Unbekannte Einheiten (z. B. „Glas“, „Dose“) werden NICHT zu Gramm, sondern zu Stück mit der Einheit im Namen.
function unitOf(u, amount) {
  if (UNITS.includes(u)) return [u, amount, ''];
  // Zusätze wie „gestr.“, „gehäuft“, „große“, „ca.“ entfernen
  const s = String(u ?? '').trim().toLowerCase().replace(/\b(gestr(ichen)?e?r?|geh(äuft)?e?r?|knapp|gut|groß(e|er)?|gross(e|er)?|klein(e|er)?|ca|etwa)\b\.?/g, '').replace(/\./g, '').trim();
  if (!s || s === 'g' || s === 'gramm' || s === 'gr') return ['g', amount, ''];
  if (s === 'kg') return ['g', amount * 1000, ''];
  if (s === 'l' || s === 'liter') return ['ml', amount * 1000, ''];
  if (s === 'ml' || s === 'milliliter') return ['ml', amount, ''];
  if (s === 'cl') return ['ml', amount * 10, ''];
  if (/^(stk|stück|st|pcs|piece|ei(er)?$)/.test(s)) return ['Stk', amount, ''];
  if (/^(el|esslöffel|tbsp)/.test(s)) return ['EL', amount, ''];
  if (/^(tl|teelöffel|tsp)/.test(s)) return ['TL', amount, ''];
  if (/^(pck|päckchen|pkg|packung|beutel|tüte)/.test(s)) return ['Pck', amount, ''];
  if (/^prise/.test(s)) return ['Prise', amount, ''];
  return ['Stk', amount, String(u).trim().slice(0, 20)];
}

// FORMAT B: Kuchen & Torten
function kiCake(data, schema) {
  const warnings = [];
  const parts = (Array.isArray(data.parts) ? data.parts : []).slice(0, 12).map((p) => ({
    id: uid(), name: txt(p?.name, 80).trim() || 'Zutaten',
    items: (Array.isArray(p?.items) ? p.items : []).slice(0, 60).map((it) => {
      const [unit, amount, other] = unitOf(it?.unit, g(it?.amount));
      const name = txt(it?.name, 80).trim() || 'Zutat';
      if (other) warnings.push(`„${other}“ bei ${name} als Stück übernommen – bitte prüfen.`);
      return { name: other ? `${name} (${other})` : name, amount: r2(amount), unit };
    }),
  })).filter((p) => p.items.length);
  if (!parts.length) throw new Error('Im Rezept-Code wurden keine Zutaten gefunden.');
  const pi = data.pan && typeof data.pan === 'object' ? data.pan : {};
  const shape = ['round', 'rect', 'count'].includes(pi.shape) ? pi.shape : '';
  const pan = { shape, d: shape === 'round' ? g(pi.diameter_cm ?? pi.d) : 0, l: shape === 'rect' ? g(pi.length_cm ?? pi.l) : 0, w: shape === 'rect' ? g(pi.width_cm ?? pi.w) : 0, n: shape === 'count' ? Math.round(g(pi.count ?? pi.n)) : 0 };
  const okPan = shape === 'round' ? pan.d > 0 : shape === 'rect' ? pan.l > 0 && pan.w > 0 : shape === 'count' ? pan.n > 0 : false;
  if (!okPan) { pan.shape = ''; warnings.push('Backform nicht erkannt – bitte im Schritt „Form & Menge“ angeben, damit sich das Rezept umrechnen lässt.'); }
  const stageOf = (st) => { const m = /^part\s*(\d+)$/i.exec(String(st ?? '').trim()); return m ? parts[Number(m[1]) - 1]?.id || null : null; };
  const steps = parseSteps(data.steps, stageOf);
  if (!steps.length) warnings.push('Kein Ablauf erkannt – im Schritt „Ablauf“ kannst du „✨ Ablauf vorschlagen“ nutzen.');
  const noDur = steps.filter((s) => !(s.durationMin > 0)).length;
  if (noDur) warnings.push(`${noDur} ${noDur === 1 ? 'Schritt' : 'Schritte'} ohne Dauer – bitte im Schritt „Ablauf“ ergänzen (⚠️ markiert).`);
  const recipe = {
    v: schema, id: uid(), name: txt(data.name, 120).trim(), category: 'cake',
    description: txt(data.description, 500), source: txt(data.source, 300), tags: [], favorite: false, photos: [], cover: null,
    yield: { mode: 'pieces', count: 1, pieceWeight: 0, flour: 0, loss: 0 }, flours: [], water: { pct: 0, temp: '', icePct: '' }, oil: { pct: 0 }, salt: 0,
    yeastType: '', yeastPct: 0, extras: [], preferments: [], steps, ddt: 22, notes: txt(data.notes, 8000),
    lamination: { pct: 0, name: '' }, pan, parts, createdAt: Date.now(), updatedAt: Date.now(),
  };
  return { recipe, warnings, totals: {} };
}

// KI-Antwort → Teigbuch-Rezept. Format A (Gramm → Bäckerprozente) oder Format B (Kuchen). Wirft verständliche Fehler.
export function kiToRecipe(data, { schema = 1 } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Der Rezept-Code hat ein unbekanntes Format.');
  if (data.category === 'cake' || (Array.isArray(data.parts) && !data.main)) return kiCake(data, schema);
  if (!data.main && !data.preferments) throw new Error('Im Rezept-Code fehlen die Zutaten („main“).');
  const main = data.main || {};
  const warnings = [];

  // Mehle im Hauptteig
  const mainFlours = (Array.isArray(main.flours) ? main.flours : []).map((f) => ({ name: txt(f?.name, 80).trim() || 'Mehl', g: g(f?.g) })).filter((f) => f.g > 0);
  const defaultFlour = mainFlours[0]?.name || 'Mehl';

  // Vorteige: Gesamtmehl/-wasser inkl. Anstellgut
  const pfIn = (Array.isArray(data.preferments) ? data.preferments : []).slice(0, 6);
  const pfs = [];
  pfIn.forEach((p, i) => {
    const type = Object.prototype.hasOwnProperty.call(PF_TYPES, p?.type) ? p.type : 'custom';
    // Mehrstufiger Sauerteig: "starter_from": "pf1" = die ganze vorige Stufe ist das Anstellgut
    const m = /^pf\s*(\d)$/i.exec(String(p?.starter_from ?? '').trim());
    const src = m ? pfs[Number(m[1]) - 1] : null;
    const s = src ? 0 : g(p?.starter_g);
    const sh = num(p?.starter_hydration) > 0 ? num(p.starter_hydration) : (type === 'madre' ? 50 : 100);
    const sFlour = src ? src.flour : s / (1 + sh / 100), sWater = src ? src.water : s - sFlour;
    const freshF = g(p?.flour_g);
    // Flüssigkeit: water_g (+ milk_g) – "liquid": "milk" ohne milk_g heißt: water_g ist Milch
    let waterG = g(p?.water_g), milkG = g(p?.milk_g);
    if (p?.liquid === 'milk' && !milkG) { milkG = waterG; waterG = 0; }
    const freshW = waterG + milkG;
    const flour = freshF + sFlour, water = freshW + sWater;
    const seeds = p?.seeds === true;
    if (src) src.consumed = true;
    const extras = (Array.isArray(p?.extras) ? p.extras : []).map((e) => ({ name: txt(e?.name, 80).trim() || 'Zutat', g: g(e?.g) })).filter((e) => e.g > 0);
    pfs.push({ id: uid(), type, name: txt(p?.name, 80).trim() || PF_TYPES[type].label, flourName: txt(p?.flour_name, 80).trim() || (seeds ? 'Saaten' : defaultFlour),
      flour, water, yeast: g(p?.yeast_g), starter: s, sh, freshF, waterG: waterG + (src ? 0 : sWater), milkG, freshW, salt: g(p?.salt_g), seeds, src, extras, i });
  });
  const pfOk = pfs.filter((p) => p.flour > 0);

  // Gesamtmehl je Sorte (Saaten zählen nicht; eine verbrauchte Stufe steckt schon in der nächsten)
  const blend = new Map();
  mainFlours.forEach((f) => blend.set(f.name, (blend.get(f.name) || 0) + f.g));
  pfOk.filter((p) => !p.seeds && !p.consumed).forEach((p) => blend.set(p.flourName, (blend.get(p.flourName) || 0) + p.flour));
  const F = [...blend.values()].reduce((a, b) => a + b, 0);
  if (!(F > 0)) throw new Error('Im Rezept-Code wurde keine Mehlmenge gefunden.');

  const ice = g(main.ice_g), liquid = g(main.water_g);
  const mainWaterAll = liquid + ice;
  // Milch im Vorteig zählt zur Milch (Zutat), Saaten-Quellwasser kommt zusätzlich – beides nicht zur Hydration
  const totalWater = mainWaterAll + pfOk.filter((p) => !p.seeds).reduce((a, p) => a + p.waterG, 0);
  const pfMilk = pfOk.filter((p) => !p.seeds).reduce((a, p) => a + p.milkG, 0);
  const hyd = (totalWater / F) * 100;
  // Milch, Ei & Co. zählen bei der Plausibilitätsprüfung mit (Brioche hat oft gar kein Wasser)
  const exIn = (Array.isArray(main.extras) ? main.extras : []).map((e) => ({ name: txt(e?.name, 80).trim() || 'Zutat', g: g(e?.g) }));
  // Die Zutaten-Liste steht im Rezept für die GESAMTMENGE: Milch und Zutaten aus Vorteigen dazuzählen
  const addEx = (name, gr) => { const ex = name === 'Milch' ? exIn[milkIndex(exIn)] : exIn.find((e) => sameName(e.name, name)); if (ex) ex.g += gr; else exIn.push({ name, g: gr }); };
  if (pfMilk > 0) addEx('Milch', pfMilk);
  pfOk.forEach((p) => p.extras.forEach((e) => addEx(e.name, e.g)));
  const effHyd = ((totalWater + exIn.reduce((a, e) => a + e.g * liquidShare(e.name), 0)) / F) * 100;
  if (effHyd < 35 || effHyd > 130) warnings.push(`Ungewöhnliche Hydration (${Math.round(effHyd)} %) – bitte die Flüssigkeitsmengen prüfen.`);

  const preferments = pfOk.map((p) => {
    // Anstellgut allein (ohne frisches Mehl) = reifer Sauerteig als Vorteig
    const onlyStarter = p.starter > 0 && p.freshF <= 0;
    return {
      id: p.id, type: p.type, name: p.name, flourName: p.flourName,
      flourPct: r4((p.flour / F) * 100),
      hydration: r2((p.water / p.flour) * 100),
      yeastPct: r4((p.yeast / p.flour) * 100),
      starterPct: p.src || onlyStarter || !(p.freshF > 0) ? 0 : r2((p.starter / p.freshF) * 100),
      starterHydration: p.sh,
      liquid: p.milkG > 0 && p.waterG - (p.src ? 0 : p.water - p.freshW) > 0.05 ? 'mix' : p.milkG > 0 ? 'milk' : 'water',
      milkShare: p.freshW > 0 ? r2((p.milkG / p.freshW) * 100) : 0,
      saltPct: p.salt > 0 ? r4((p.salt / p.flour) * 100) : 0, seeds: p.seeds,
      extras: p.extras.map((e) => ({ name: e.name, pct: r4((e.g / F) * 100) })),
      starterFrom: p.src?.id || '',
    };
  });
  const pfSalt = pfOk.reduce((a, p) => a + p.salt, 0);

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
  const steps = parseSteps(data.steps, stageOf);
  const lamG = g(data.lamination?.g);

  const recipe = {
    v: schema,
    id: uid(), name: txt(data.name, 120).trim(), category: ['pizza', 'bread', 'fine', 'other'].includes(data.category) ? data.category : '',
    description: txt(data.description, 500), source: txt(data.source, 300), tags: [], favorite: false, photos: [], cover: null,
    // Mehlmenge exakt wie im Original; Stückzahl/-gewicht zusätzlich, wenn angegeben
    yield: { mode: 'flour', flour: r2(F), count: count > 0 ? count : 1, pieceWeight: weight > 0 ? weight : 0, loss: 0 },
    flours: [...blend.entries()].map(([name, grams]) => ({ name, pct: r2((grams / F) * 100) })),
    water: { pct: r2(hyd), temp: wt === null || wt === undefined || wt === '' || !Number.isFinite(Number(wt)) ? '' : Number(wt), icePct: ice > 0 && mainWaterAll > 0 ? r2((ice / mainWaterAll) * 100) : '' },
    oil: { pct: r4((g(main.oil_g) / F) * 100) },
    salt: r4(((g(main.salt_g) + pfSalt) / F) * 100),
    yeastType: yt, yeastPct: r4((g(main.yeast_g) / F) * 100),
    extras: exIn.map((e) => ({ name: e.name, pct: r4((e.g / F) * 100) })).filter((e) => e.pct > 0),
    preferments, steps, ddt: 24, notes: txt(data.notes, 8000), createdAt: Date.now(), updatedAt: Date.now(),
    lamination: { pct: lamG > 0 ? r4((lamG / F) * 100) : 0, name: lamG > 0 ? txt(data.lamination?.name, 80).trim() : '' },
    pan: { shape: '', d: 0, l: 0, w: 0, n: 0 }, parts: [],
  };
  if (!yt && (recipe.yeastPct > 0 || preferments.some((p) => p.yeastPct > 0))) warnings.push('Hefe-Art (frisch/trocken) unklar – bitte im Schritt „Salz, Hefe & Co.“ wählen.');
  if (!recipe.category) warnings.push('Bitte im ersten Schritt die Art wählen (Pizza, Brot, Feingebäck …).');
  if (!steps.length) warnings.push('Kein Ablauf erkannt – im Schritt „Teigführung“ kannst du „✨ Ablauf vorschlagen“ nutzen.');
  const noDur = steps.filter((s) => !(s.durationMin > 0)).length;
  if (noDur) warnings.push(`${noDur} ${noDur === 1 ? 'Schritt' : 'Schritte'} ohne Dauer – bitte im Schritt „Teigführung“ ergänzen (⚠️ markiert).`);
  // Stückzahl bekannt → Menge nach Stück anzeigen (Stückgewicht so, dass die Originalmengen exakt bleiben)
  if (count > 0) {
    const D = calc(recipe).D;
    if (D > 0) recipe.yield = { mode: 'pieces', count, pieceWeight: Math.round((D / count) * 100) / 100, flour: r2(F), loss: 0 };
  }
  return { recipe, warnings, totals: { flour: F, water: totalWater, dough: F + totalWater + g(main.salt_g) + g(main.yeast_g) + g(main.oil_g) + pfs.reduce((a, p) => a + p.yeast, 0) } };
}
