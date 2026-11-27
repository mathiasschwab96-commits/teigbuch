// Teigbuch – Hintergrundwissen: Mehl-Bibliothek und Erfolge
// Reine Daten/Funktionen, keine gespeicherten Felder → kein Einfluss auf Sicherungen.
import { num, fermGroups, sameName } from './calc.js';

// ---------- Mehl-Katalog (ab 2.7): Getreide × Art mit Richtwerten ----------
// Richtwerte aus Mühlen-Datenblättern, Fachliteratur (u. a. Uni Hohenheim, AGF/Max Rubner-Institut) und Bäckerpraxis –
// je nach Mühle, Ernte und Sorte verschieden; Packungsangaben haben immer Vorrang.
// Typenzahl = Mineralstoffgehalt (Asche) in mg je 100 g Trockenmasse: mehr Schale → mehr Aroma, Enzyme und Wasserbindung, schnellere Gärung.
// wFac = Kleberkraft im Vergleich zu Weizen bei gleichem Eiweiß (für die W-Schätzung aus dem Eiweiß; 0 = kein W).
export const GRAINS = {
  weizen: { label: 'Weizen', wFac: 1, info: 'Weichweizen bildet den stärksten Kleber (Gliadin + Glutenin): elastisch und dehnbar, hält Gas sehr gut. Basis für Pizza, Weißbrot, Semmeln und Feingebäck.', tips: [] },
  dinkel: { label: 'Dinkel', wFac: 0.6, info: 'Viel Eiweiß, aber ein weicher, schnell überknetbarer Kleber (mehr Gliadin als Weizen). Teige werden rasch weich und reißen.',
    tips: ['Kurz und langsam kneten (etwa ⅔ der Weizen-Knetzeit).', 'Teigtemperatur möglichst ≤ 24 °C – lieber kühl und länger führen.', 'Etwa 3–5 %-Punkte weniger Wasser als bei Weizen; ein Kochstück hält die Krume saftig.'] },
  roggen: { label: 'Roggen', wFac: 0, rye: true, info: 'Kaum backfähiger Kleber – das Gerüst bilden Pentosane (Schleimstoffe), die viel Wasser binden. Roggen hat aktive Amylasen: ohne Säure bauen sie Stärke ab, die Krume wird klitschig.',
    tips: ['Roggen braucht Säure: meist 35–50 % des Roggenmehls als Sauerteig (helles Mehl weniger, dunkles und Vollkorn mehr).', 'Nicht kneten wie Weizen – nur gut mischen; der Teig bleibt klebrig.', 'Großzügig Wasser (Teigausbeute 170–185), dunkle Mehle und Vollkorn noch mehr.', 'Gut ausbacken und vor dem Anschneiden 12–24 h ruhen lassen.'] },
  hartweizen: { label: 'Hartweizen (Durum)', wFac: 0.75, info: 'Hartes, gelbes Korn mit viel Carotin: fester, zäher Kleber (hohes P/L), wenig dehnbar. Klassisch für Pasta und Pane di Semola.',
    tips: ['Als 10–30 % Anteil gibt er Pizza und Brot Biss, gelbe Krume und eine knusprige Kruste.', 'Semola rimacinata (doppelt gemahlen) nehmen – grober Grieß bindet Wasser zu langsam.', 'Teiglinge länger entspannen lassen, sie ziehen sich gern zurück.'] },
  einkorn: { label: 'Einkorn', wFac: 0.35, info: 'Urgetreide mit viel Eiweiß, Carotin und Aroma, aber sehr weichem Kleber – Teige halten kaum Stand.',
    tips: ['Kaum kneten – nur mischen, Struktur mit Dehnen & Falten.', 'Weniger Wasser (ca. 55–62 %), kühl führen (z. B. ca. 3 °C bis 20 h).', 'In der Kastenform backen oder als 20–40 % Anteil mischen.'] },
  emmer: { label: 'Emmer', wFac: 0.5, info: 'Urweizen mit kräftig-nussigem Geschmack. Kleber besser als Einkorn, schwächer als Weizen – stark sortenabhängig.',
    tips: ['Weniger kneten als Weizen oder Dinkel.', 'Wasser vorsichtig dosieren (bindet weniger); Sauerteig und lange Führung bringen Volumen und Aroma.'] },
  khorasan: { label: 'Khorasan', wFac: 0.65, info: 'Großkörniger Urweizen (bekannt als Kamut®) mit buttrig-süßlichem Geschmack und goldener Krume; Kleber ähnlich Hartweizen: fest, wenig dehnbar.',
    tips: ['Gut als 20–50 % Anteil für Aroma und Farbe.', 'Eine Autolyse macht den Teig dehnbarer.'] },
  andere: { label: 'Sonstiges', wFac: 0, noGlut: true, info: 'Hafer, Gerste, Buchweizen, Mais, Reis, Hirse: kein backfähiger Kleber – sie tragen kein Gasgerüst und binden oft viel Wasser.',
    tips: ['Nur als Anteil (meist bis 20–30 %) zu einem Klebermehl mischen.', 'Je mehr davon, desto dichter die Krume – etwas mehr Wasser und kürzere Gare.'] },
};
export const REGIONS = { AT: 'Österreich', DE: 'Deutschland', IT: 'Italien', '': 'Allgemein' };
// pr = Eiweiß-Spanne (%), wv = typische Backstärke W, abs = Wasseraufnahme (Farinograph, %), cap = gut verträgliche Hydration (%),
// sour = empfohlener Sauerteig-Anteil am Roggenmehl (%), eq = Entsprechung, use = feste Zusatz-Verwendungen
const T = (id, grain, reg, name, label, o = {}) => ({ id, grain, reg, name, label, eq: '', ash: '', note: '', ...o });
export const FLOUR_TYPES = [
  // Weizen – Italien (Typen nach Aschegehalt; 00 am feinsten)
  T('it-man', 'weizen', 'IT', 'Manitoba', 'Manitoba', { pr: [13.5, 15], wv: 380, abs: 66, cap: 80, rx: /manitoba/, note: 'Sehr kräftig (nordamerikanischer Weizen) – für Biga, Panettone und lange Kaltgare, oft als 20–40 % Anteil.' }),
  T('it-00s', 'weizen', 'IT', 'Tipo 00 W 330', 'Tipo 00 W 320+', { pr: [13, 14], wv: 340, abs: 62, cap: 75, ash: 'max. 0,55 %', test: (s, w) => /tipo\s*00|\b00\b/.test(s) && w >= 320, note: 'Kräftiges 00 für 48–72 h Kaltgare, Biga und reiche Teige.' }),
  T('it-00', 'weizen', 'IT', 'Tipo 00', 'Tipo 00', { pr: [11.5, 12.5], wv: 270, abs: 58, cap: 70, ash: 'max. 0,55 %', rx: /tipo\s*00|\b00\b|pizzamehl/, note: 'Sehr fein und hell – der Klassiker für Pizza napoletana; mit W 250–300 für ca. 8–24 h.' }),
  T('it-0', 'weizen', 'IT', 'Tipo 0', 'Tipo 0', { pr: [11.5, 12.5], wv: 260, abs: 59, cap: 70, ash: 'max. 0,65 %', rx: /tipo\s*0(?!0)\b/, note: 'Etwas mehr Schale als 00 – kräftiger; für Pizza und Brot.' }),
  T('it-1', 'weizen', 'IT', 'Tipo 1', 'Tipo 1', { pr: [12, 13], wv: 270, abs: 62, cap: 73, ash: 'max. 0,80 %', rx: /tipo\s*1\b/, note: 'Rustikal und nussig, nimmt mehr Wasser – beliebt für Pizza contemporanea und Brot.' }),
  T('it-2', 'weizen', 'IT', 'Tipo 2', 'Tipo 2', { pr: [12.5, 13.5], wv: 250, abs: 64, cap: 75, ash: 'max. 0,95 %', rx: /tipo\s*2\b/, note: 'Halbvollkorn: viel Aroma, gärt schneller, braucht mehr Wasser.' }),
  T('it-int', 'weizen', 'IT', 'Farina integrale', 'Integrale', { pr: [12.5, 14], wv: 220, abs: 68, cap: 78, whole: true, ash: 'ca. 1,3–1,7 %', rx: /integrale/, note: 'Italienisches Weizenvollkornmehl.' }),
  // Weizen – Österreich (Codex B 20; glatt/griffig = Körnung)
  T('at-w480', 'weizen', 'AT', 'Weizenmehl W480 glatt', 'W480 glatt', { eq: '≈ DE Type 405', pr: [10, 11.5], wv: 180, abs: 56, cap: 64, ash: 'ca. 0,48 %', rx: /glatt/, nums: [480], use: ['cake', 'strudel'], note: 'Feine Körnung, löst sich sofort – für Kuchen, Biskuit, Strudelteig und Saucen. Für Brot und Pizza nur kurz führen.' }),
  T('at-w480g', 'weizen', 'AT', 'Weizenmehl W480 griffig', 'W480 griffig', { eq: '≈ DE Type 405, grob', pr: [10, 11.5], wv: 180, abs: 55, cap: 62, ash: 'ca. 0,48 %', rx: /griffig/, use: ['dumpling', 'cake'], note: 'Grobe Körnung: nimmt Wasser langsamer auf – Teige wirken erst fest und werden später weicher. Für Knödel, Nockerl, Spätzle, Mürbteig.' }),
  T('at-w480u', 'weizen', 'AT', 'Weizenmehl W480 Universal', 'W480 Universal', { eq: '≈ DE Type 405', pr: [10, 11.5], wv: 180, abs: 56, cap: 63, ash: 'ca. 0,48 %', rx: /universal/, use: ['cake'], note: 'Je zur Hälfte glatt und griffig – Allzweckmehl für Küche und Kuchen.' }),
  T('at-w700', 'weizen', 'AT', 'Weizenmehl W700', 'W700', { eq: '≈ DE Type 550–812', pr: [11, 12.5], wv: 230, abs: 60, cap: 70, ash: 'ca. 0,7 %', rx: /\bw\s?700\b/, nums: [700], note: 'Österreichisches Gebäck- und Brotmehl: Semmeln, Kleingebäck, Weißbrot, Pizza bis ca. 24 h.' }),
  T('at-w1600', 'weizen', 'AT', 'Weizenmehl W1600', 'W1600', { eq: '≈ DE Type 1600 (oft statt 1050 verwendet)', pr: [12.5, 13.5], wv: 220, abs: 65, cap: 74, ash: 'ca. 1,5–1,75 %', rx: /\bw\s?1600\b/, note: 'Dunkles Weizenbrotmehl: viel Aroma und Enzyme, gärt schneller und braucht mehr Wasser.' }),
  // Weizen – Deutschland (DIN 10355)
  T('de-405', 'weizen', 'DE', 'Weizenmehl 405', 'Type 405', { eq: '≈ AT W480', pr: [9.5, 11], wv: 170, abs: 55, cap: 63, ash: 'bis 0,50 %', nums: [405], use: ['cake'], note: 'Feines Haushaltsmehl – Kuchen, Mürbteig, Biskuit. Für Brot und Pizza nur kurz führen.' }),
  T('de-550', 'weizen', 'DE', 'Weizenmehl 550', 'Type 550', { eq: '≈ AT W700', pr: [10.5, 12.5], wv: 220, abs: 59, cap: 70, ash: '0,51–0,63 %', nums: [550], def: true, note: 'Allrounder für Brötchen, Weißbrot und Pizza – am besten bis ca. 24 h Gesamtführung.' }),
  T('de-812', 'weizen', 'DE', 'Weizenmehl 812', 'Type 812', { eq: '≈ AT W700', pr: [11, 13], wv: 230, abs: 61, cap: 71, ash: '0,64–0,90 %', nums: [812], note: 'Halbweißes Brotmehl (v. a. Süddeutschland) – etwas kräftiger als 550.' }),
  T('de-1050', 'weizen', 'DE', 'Weizenmehl 1050', 'Type 1050', { eq: 'zwischen AT W700 und W1600', pr: [11.5, 13.5], wv: 230, abs: 63, cap: 72, ash: '0,91–1,20 %', nums: [1050], note: 'Kräftiger Geschmack, nimmt mehr Wasser auf – Misch- und Landbrote.' }),
  T('de-1600', 'weizen', 'DE', 'Weizenmehl 1600', 'Type 1600', { eq: '≈ AT W1600', pr: [12, 14], wv: 220, abs: 65, cap: 75, ash: '1,51–1,80 %', nums: [1600], note: 'Dunkles Weizenmehl – aromatisch, mehr Enzyme, mehr Wasser.' }),
  // Weizen – allgemein
  T('w-voll', 'weizen', '', 'Weizenvollkornmehl', 'Vollkorn', { pr: [12, 14], wv: 220, abs: 68, cap: 78, whole: true, ash: 'ca. 1,5–2 %', note: 'Ganzes Korn inkl. Keim: 5–10 %-Punkte mehr Wasser, Quellzeit oder Autolyse hilft; wird schneller ranzig.' }),
  T('w-bread', 'weizen', '', 'Bread Flour', 'Bread Flour', { pr: [12.5, 14], wv: 300, abs: 64, cap: 75, rx: /bread flour|strong (white )?flour/, note: 'Englisch-amerikanisches Brotmehl – kräftig, gut für lange Führung.' }),
  // Dinkel
  T('at-dfein', 'dinkel', 'AT', 'Dinkelfeinmehl', 'Dinkelfeinmehl', { eq: '≈ DE Type 630', pr: [12, 14], wv: 180, abs: 56, cap: 65, rx: /feinmehl|\bd\s?700\b/, nums: [700], note: 'Österreichisches helles Dinkelmehl.' }),
  T('de-d630', 'dinkel', 'DE', 'Dinkelmehl 630', 'Type 630', { eq: '≈ AT Dinkelfeinmehl', pr: [12, 14], wv: 180, abs: 56, cap: 65, ash: 'bis 0,90 %', nums: [630], def: true, note: 'Helles Dinkelmehl – feinporig, mild-nussig.' }),
  T('de-d812', 'dinkel', 'DE', 'Dinkelmehl 812', 'Type 812', { pr: [12.5, 14], wv: 180, abs: 58, cap: 67, nums: [812], note: 'Halbhelles Dinkelmehl.' }),
  T('de-d1050', 'dinkel', 'DE', 'Dinkelmehl 1050', 'Type 1050', { pr: [13, 14.5], wv: 170, abs: 61, cap: 69, nums: [1050], note: 'Dunkles Dinkelmehl – aromatisch, bindet mehr Wasser.' }),
  T('d-voll', 'dinkel', '', 'Dinkelvollkornmehl', 'Vollkorn', { pr: [13, 15], wv: 170, abs: 64, cap: 73, whole: true, note: 'Dinkel-Vollkorn: ein Kochstück oder lange Quellzeit hält die Krume saftig.' }),
  // Roggen (kein W – entscheidend sind Säure, Wasser und Fallzahl)
  T('at-r500', 'roggen', 'AT', 'Roggenmehl R500', 'R500 hell', { eq: '≈ DE Type 815', pr: [6.5, 8.5], cap: 72, sour: [20, 35], ash: 'ca. 0,5 %', rx: /\br\s?500\b/, nums: [500], note: 'Helles, mildes Roggenmehl – für helle Mischbrote und als Anteil in Gebäck.' }),
  T('at-r960', 'roggen', 'AT', 'Roggenmehl R960', 'R960', { eq: 'zwischen DE Type 997 und 1150', pr: [7.5, 9.5], cap: 76, sour: [35, 45], ash: 'ca. 0,88–1,12 %', rx: /\br\s?960\b/, nums: [960], note: 'Das Standard-Roggenmehl in Österreich – für Misch- und Roggenbrote.' }),
  T('at-r2500', 'roggen', 'AT', 'Roggenmehl R2500', 'R2500 dunkel', { eq: '≈ DE Type 1740–1800', pr: [9, 11], cap: 82, sour: [40, 50], ash: 'ca. 2,5 %', rx: /\br\s?2500\b/, nums: [2500], note: 'Sehr dunkles, kräftiges Roggenbrotmehl – nahe am Vollkorn.' }),
  T('de-r815', 'roggen', 'DE', 'Roggenmehl 815', 'Type 815', { eq: '≈ AT R500', pr: [6.5, 8.5], cap: 72, sour: [20, 35], ash: 'bis 0,90 %', nums: [815], note: 'Helles Roggenmehl – mild, für helle Mischbrote.' }),
  T('de-r997', 'roggen', 'DE', 'Roggenmehl 997', 'Type 997', { eq: '≈ AT R960', pr: [7, 9], cap: 74, sour: [30, 40], nums: [997], note: 'Gute Teigstabilität und Volumen, mildes Aroma.' }),
  T('de-r1150', 'roggen', 'DE', 'Roggenmehl 1150', 'Type 1150', { eq: '≈ AT R960', pr: [7.5, 9.5], cap: 76, sour: [35, 45], nums: [1150], def: true, note: 'Der Klassiker für Roggen- und Mischbrot, gut für Sauerteig.' }),
  T('de-r1370', 'roggen', 'DE', 'Roggenmehl 1370', 'Type 1370', { pr: [8, 10], cap: 79, sour: [40, 50], nums: [1370], note: 'Dunkles Roggenmehl – kräftig, braucht etwas mehr Wasser.' }),
  T('de-r1740', 'roggen', 'DE', 'Roggenmehl 1740', 'Type 1740', { eq: '≈ AT R2500', pr: [9, 11], cap: 82, sour: [40, 50], nums: [1740, 1800], note: 'Sehr dunkel (Backschrot-Bereich) – viel Aroma und Wasserbindung.' }),
  T('r-voll', 'roggen', '', 'Roggenvollkornmehl', 'Vollkorn', { pr: [9, 11], cap: 85, sour: [40, 50], whole: true, note: 'Ganzes Roggenkorn: viel Wasser, lange Quellzeit und kräftige Säure.' }),
  // Hartweizen
  T('it-semrim', 'hartweizen', 'IT', 'Semola rimacinata', 'Semola rimacinata', { pr: [12, 13.5], wv: 200, abs: 62, cap: 68, rx: /rimacinat|semola/, def: true, use: ['pasta'], note: 'Doppelt gemahlener Hartweizengrieß – für Pane di Semola, Pasta und als Anteil in Pizza; ideal zum Bestreuen beim Ausziehen.' }),
  T('hw-griess', 'hartweizen', '', 'Hartweizengrieß', 'Grieß (grob)', { pr: [12, 13.5], wv: 180, abs: 55, cap: 60, rx: /grie(ß|ss)/, use: ['pasta'], note: 'Grob – für Pasta und zum Bestreuen; im Brot nur nach langer Quellzeit.' }),
  T('hw-voll', 'hartweizen', '', 'Hartweizen-Vollkornmehl', 'Vollkorn', { pr: [12.5, 14], wv: 180, abs: 66, cap: 74, whole: true, note: 'Kräftig und gelb, braucht mehr Wasser.' }),
  // Urgetreide
  T('ek-hell', 'einkorn', '', 'Einkornmehl', 'hell', { pr: [13, 17], wv: 90, abs: 55, cap: 60, def: true }),
  T('ek-voll', 'einkorn', '', 'Einkorn-Vollkornmehl', 'Vollkorn', { pr: [14, 18], wv: 80, abs: 60, cap: 66, whole: true }),
  T('em-hell', 'emmer', '', 'Emmermehl', 'hell', { pr: [13, 16], wv: 140, abs: 56, cap: 64, def: true }),
  T('em-voll', 'emmer', '', 'Emmer-Vollkornmehl', 'Vollkorn', { pr: [14, 17], wv: 130, abs: 61, cap: 70, whole: true }),
  T('kh-hell', 'khorasan', '', 'Khorasanmehl', 'hell', { pr: [14, 16], wv: 200, abs: 60, cap: 66, def: true }),
  T('kh-voll', 'khorasan', '', 'Khorasan-Vollkornmehl', 'Vollkorn', { pr: [14, 17], wv: 180, abs: 65, cap: 72, whole: true }),
  // Ohne backfähigen Kleber
  T('o-hafer', 'andere', '', 'Hafermehl', 'Hafer', { pr: [12, 14], cap: 85, rx: /hafer|\boat/, note: 'Bindet viel Wasser (Beta-Glucane) und macht die Krume saftig – bis ca. 20 %.' }),
  T('o-gerste', 'andere', '', 'Gerstenmehl', 'Gerste', { pr: [9, 11], cap: 78, rx: /gerste|barley/, note: 'Mild-süßlich, kaum Kleber – bis ca. 20 %.' }),
  T('o-buchw', 'andere', '', 'Buchweizenmehl', 'Buchweizen', { pr: [11, 13], cap: 80, rx: /buchweizen|saraceno/, note: 'Glutenfrei, kräftig-herb – bis ca. 20–30 %.' }),
  T('o-mais', 'andere', '', 'Maismehl', 'Mais', { pr: [7, 9], cap: 70, rx: /\bmais|polenta|\bcorn/, note: 'Glutenfrei, gelb, süßlich – bis ca. 20 %; Polenta vorher quellen lassen.' }),
  T('o-reis', 'andere', '', 'Reismehl', 'Reis', { pr: [6, 8], cap: 70, rx: /\breis|\brice/, note: 'Glutenfrei – ideal zum Bestreuen von Gärkörbchen (klebt nicht).' }),
  T('o-hirse', 'andere', '', 'Hirsemehl', 'Hirse', { pr: [10, 12], cap: 75, rx: /hirse|millet/, note: 'Glutenfrei, wird alt leicht bitter – frisch verwenden, bis ca. 20 %.' }),
];
const dec = (v) => String(v).replace('.', ',');
// Für ältere Programmteile (Mehl-Infos, Ampel): Eiweiß/W als Text, Stärke, Roggen/Vollkorn
FLOUR_TYPES.forEach((t) => {
  const g = GRAINS[t.grain];
  Object.assign(t, { protein: t.pr ? `${dec(t.pr[0])}–${dec(t.pr[1])}` : '–', w: t.wv ? `~${t.wv}` : '–', wv: t.wv || 0, rye: !!g.rye, noGlut: !!g.noGlut, whole: !!t.whole,
    strength: !t.wv || t.wv < 215 ? 'weak' : t.wv >= 330 ? 'strong' : 'medium', mid: t.pr ? (t.pr[0] + t.pr[1]) / 2 : null });
});
export const typeById = (id) => (id ? FLOUR_TYPES.find((t) => t.id === id) || null : null);
// W-Wert im Namen („Tipo 00 W 300“). Österreichische Typen (W480, W700, W1600) sind KEIN W-Wert.
export function wInName(name) {
  const m = /\bw\s?(\d{3})\b/i.exec(name || '');
  const w = m ? Number(m[1]) : 0;
  return w >= 120 && w <= 450 && w !== 480 ? w : 0;
}
// Getreide aus dem Namen erkennen (Reihenfolge wichtig: Buchweizen/Hartweizen vor Weizen)
const GRAIN_RX = [['einkorn', /einkorn/], ['emmer', /emmer/], ['khorasan', /khorasan|kamut/], ['dinkel', /dinkel|spelt|farro/],
  ['roggen', /roggen|segale|\br\s?(500|960|2500)\b/], ['hartweizen', /hartweizen|semola|durum|grano duro/],
  ['andere', /hafer|\boat|gerste|barley|buchweizen|saraceno|\bmais|polenta|\bcorn|\breis|\brice|hirse|millet/],
  ['weizen', /weizen|tipo\s*[012]|\b00\b|manitoba|wei(ß|ss)mehl|bread flour|strong (white )?flour|pizzamehl|integrale|\bw\s?(480|700|1600)\b|\b(405|550|812|1050|1600)\b|universal|griffig|glatt/]];
export const grainOf = (name) => { const s = String(name || '').toLowerCase(); return (GRAIN_RX.find(([, rx]) => rx.test(s)) || [''])[0]; };
// Art aus dem Namen erkennen (innerhalb eines bekannten oder erkannten Getreides); null = unbekannt
export function typeFromName(name, grain = '') {
  const s = String(name || '').toLowerCase();
  const g = grain || grainOf(s);
  if (!g) return null;
  const cand = FLOUR_TYPES.filter((t) => t.grain === g), w = wInName(s);
  const whole = /vollkorn|vollmehl|integral|whole|\bvoll\b/.test(s);
  return cand.find((t) => t.test?.(s, w))
    || (whole ? cand.find((t) => t.whole && t.rx?.test(s)) || cand.find((t) => t.whole && !t.rx) : null)
    || cand.find((t) => t.rx?.test(s))
    || cand.find((t) => (t.nums || []).some((n) => new RegExp(`\\b[a-z]?\\s?${n}\\b`).test(s)))
    || cand.find((t) => t.def) || cand[0] || null;
}
export const FLOURS = FLOUR_TYPES;
export const FLOUR_NAMES = FLOUR_TYPES.map((f) => f.name);
// Richtwerte zu einem Mehlnamen (Rezept-Mehle, die nicht unter „Meine Mehle“ stehen)
export const flourInfo = (name) => (name ? typeFromName(name) : null);

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
// Alte „Sorte“ (bis Schema 9) → Richtwert-Art, falls weder Getreide noch Art gewählt sind
const KIND_TYPE = { tipo00: 'it-00', tipo0: 'it-0', wheat: 'de-550', manitoba: 'it-man', whole: 'w-voll', spelt: 'de-d630', rye: 'de-r1150', durum: 'it-semrim' };
const KIND_GRAIN = { tipo00: 'weizen', tipo0: 'weizen', wheat: 'weizen', manitoba: 'weizen', spelt: 'dinkel', rye: 'roggen', durum: 'hartweizen' };
// Für ältere App-Versionen: passende alte „Sorte“ zu Getreide/Art
export function kindFor(grain, typeId) {
  const t = typeById(typeId);
  if (grain === 'weizen') return t?.whole ? 'whole' : /^it-00/.test(typeId) ? 'tipo00' : /^it-[012]$/.test(typeId) ? 'tipo0' : typeId === 'it-man' || typeId === 'w-bread' ? 'manitoba' : 'wheat';
  return { dinkel: 'spelt', roggen: 'rye', hartweizen: 'durum' }[grain] || (grain ? 'other' : '');
}
const has = (v) => v !== '' && v !== null && v !== undefined;
// Wissenschaftliche Faustformeln (Richtwerte):
//  • W aus Eiweiß (Weizen): W ≈ 40 · Eiweiß% − 210  (11 % → 230, 12 % → 270, 13 % → 310, 14 % → 350);
//    andere Getreide haben bei gleichem Eiweiß schwächeren Kleber → × wFac (Dinkel 0,6, Emmer 0,5, Einkorn 0,35 …)
//  • Verträgliche Hydration aus der Wasseraufnahme (Farinograph, 500 FE): ca. +8 %-Punkte für handwerkliche, lang geführte Teige
//  • ohne Wasseraufnahme aus Eiweiß (Weizen): ca. 45 + 2,3 · Eiweiß% (Vollkorn +5) – Kleber und Kleie binden Wasser;
//    andere Getreide: Richtwert der Art ± 1,5 %-Punkte je %-Punkt Eiweiß Abweichung
export const wFromProtein = (p, wFac = 1) => Math.round(Math.min(450, Math.max(120, 40 * num(p) - 210)) * wFac);
// Getreide und Art eines Mehls: Auswahl bei „Meine Mehle“ → sonst aus dem Namen → sonst alte „Sorte“
export function flourKind(name) {
  const m = myFlour(name);
  const grain = m?.grain || (m && !m.type && KIND_GRAIN[m.kind]) || grainOf(name) || (m?.brand ? grainOf(m.brand) : '');
  const type = (m?.type && typeById(m.type)) || typeFromName(name, grain) || (m?.brand ? typeFromName(m.brand, grain) : null)
    || (m && !m.grain ? typeById(KIND_TYPE[m.kind]) : null);
  return { m, grain: grain || type?.grain || '', type, auto: !m?.type && !!type };
}
export function flourProps(name) {
  const { m, grain, type: lib } = flourKind(name);
  const nameW = wInName(name);
  if (!m && !lib && !nameW) return null;
  const g = GRAINS[grain] || GRAINS.weizen;
  const rye = !!g.rye || m?.kind === 'rye', noGlut = !!g.noGlut, whole = !!lib?.whole || (m?.kind === 'whole' && !m?.type);
  let w = null, wSrc = '';
  if (!rye && !noGlut) {
    if (m && has(m.w)) { w = num(m.w); wSrc = 'Packung'; }
    else if (nameW) { w = nameW; wSrc = 'Name'; }
    else if (m && has(m.protein)) { w = wFromProtein(m.protein, g.wFac); wSrc = 'aus Eiweiß geschätzt'; }
    else if (lib?.wv) { w = lib.wv; wSrc = `Richtwert ${lib.label}`; }
  }
  let cap, capSrc;
  if (m && has(m.absorption)) { cap = num(m.absorption) + 8; capSrc = 'aus Wasseraufnahme'; }
  else if (m && has(m.protein) && (!grain || grain === 'weizen' || !lib?.mid)) { cap = 45 + 2.3 * num(m.protein) + (whole ? 5 : 0); capSrc = 'aus Eiweiß geschätzt'; }
  else if (m && has(m.protein)) { cap = lib.cap + (num(m.protein) - lib.mid) * 1.5; capSrc = 'aus Eiweiß geschätzt'; }
  else { cap = lib?.cap ?? 70; capSrc = lib ? `Richtwert ${lib.label}` : 'Richtwert'; }
  return { mine: !!m, my: m, lib, grain, w, wSrc, cap, capSrc, rye, noGlut, whole, protein: m && has(m.protein) ? num(m.protein) : null,
    pl: m && has(m.pl) ? num(m.pl) : null, falling: m && has(m.falling) ? num(m.falling) : null };
}
const LEVEL = { info: -1, green: 0, yellow: 1, red: 2 };
const worst = (a, b) => (LEVEL[b] > LEVEL[a] ? b : a);
const fmt = (v) => String(Math.round(v)).replace('.', ',');
const fmt1 = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
// Gewichtete Eigenschaften einer Mehlmischung [{name, pct}] – nur bekannte Mehle
export function blendOf(list) {
  let tot = 0, known = 0, w = 0, wN = 0, cap = 0, rye = 0, whole = 0, mine = 0, fall = 0, fallN = 0, pl = 0, plN = 0, prot = 0, protN = 0, noGlut = 0;
  const wSrc = new Set(), parts = [], grains = {};
  (list || []).forEach((f) => {
    const p = Math.max(0, num(f.pct)); tot += p;
    const x = flourProps(f.name);
    if (!x) return;
    known += p; parts.push({ name: f.name, pct: p, ...x });
    if (x.mine) mine += p;
    if (x.rye) rye += p; else if (x.w) { w += x.w * p; wN += p; wSrc.add(x.wSrc); }
    if (x.noGlut) noGlut += p;
    if (x.whole) whole += p;
    cap += x.cap * p;
    const pr = x.protein ?? x.lib?.mid;
    if (pr) { prot += pr * p; protN += p; }
    if (x.grain) grains[x.grain] = (grains[x.grain] || 0) + p;
    if (x.falling !== null) { fall += x.falling * p; fallN += p; }
    if (x.pl !== null) { pl += x.pl * p; plN += p; }
  });
  const pc = (v) => (tot ? (v / tot) * 100 : 0);
  return { tot, known, w: wN ? w / wN : null, wSrc: [...wSrc], cap: known ? cap / known : null, rye: pc(rye), whole: pc(whole), noGlut: pc(noGlut),
    mine: pc(mine), falling: fallN ? fall / fallN : null, pl: plN ? pl / plN : null, protein: protN ? prot / protN : null,
    grains: Object.fromEntries(Object.entries(grains).map(([k, v]) => [k, pc(v)])), parts };
}

// ---------- Einschätzungen (ab 2.7) – Texte für die ⓘ-Felder; lvl: ok | info | warn ----------
const r0 = (v) => String(Math.round(v));
const strengthTxt = (w) => (w < 180 ? 'schwach' : w < 260 ? 'mittel' : w < 320 ? 'kräftig' : w < 380 ? 'stark' : 'sehr stark');
// Wofür passt ein Mehl bzw. eine Mischung? (aus W, Eiweiß, Getreide; dazu feste Verwendungen der Art)
const USE = { pizza: '🍕 Pizza', pizzaLong: '🍕 Pizza mit langer Kaltgare / Biga', bread: '🍞 Brot', rolls: '🥖 Semmeln & Kleingebäck',
  sweet: '🥯 Hefezopf & Hefeteig', rich: '🥯 Brioche, Panettone (reiche Teige)', lam: '🥐 Croissant & Plunder', cake: '🎂 Kuchen, Mürbteig, Biskuit',
  rye: '🍞 Roggen- & Mischbrot (mit Sauerteig)', mixin: '➕ als Anteil (ca. 10–30 %)', pasta: '🍝 Pasta', dumpling: '🥟 Knödel, Nockerl, Spätzle', strudel: '🥧 Strudelteig', loaf: '🍞 Kastenbrot' };
export function flourUses(x) {
  const u = new Set(x.lib?.use || []), w = x.w, g = x.grain || 'weizen';
  if (x.rye) { u.add('rye'); if ((x.lib?.cap ?? 80) <= 74) u.add('mixin'); }
  else if (x.noGlut) u.add('mixin');
  else if (g === 'einkorn' || g === 'emmer') { u.add('loaf'); u.add('mixin'); }
  else if (w) {
    if (g === 'hartweizen' || g === 'khorasan') { u.add('bread'); u.add('mixin'); }
    else {
      if (w >= 200 && w <= 330 && !x.whole) u.add('pizza');
      if (w >= 300) u.add('pizzaLong');
      if (w >= 200) u.add('bread');
      if (g === 'weizen' && w >= 210 && w <= 320 && !x.whole) u.add('rolls');
      if (w >= 290) u.add('rich'); else if (w >= 210) u.add('sweet');
      if (w >= 280 && !x.whole && (x.protein === null || x.protein >= 12)) u.add('lam');
      if (w <= 200 && !x.whole) u.add('cake');
    }
  }
  return [...u].map((k) => USE[k]).filter(Boolean);
}
// Wasser-Unterschied zwischen zwei Mischungen [{name, pct}] in %-Punkten (positiv = neue Mischung bindet mehr)
export function waterShift(fromList, toList) {
  const a = blendOf(fromList), b = blendOf(toList);
  if (!a.cap || !b.cap || a.known < a.tot * 0.7 || b.known < b.tot * 0.7) return null;
  return { d: b.cap - a.cap, from: a, to: b };
}
// Einschätzung zu einem Mehl (Seite „Meine Mehle“): je Abschnitt eine Liste {t, lvl}
export function flourInsights(name) {
  const x = flourProps(name) || {}, k = flourKind(name), t = k.type, m = k.m || {}, g = GRAINS[k.grain];
  const out = { grain: [], type: [], w: [], protein: [], absorption: [], pl: [], falling: [], uses: [], tips: [] };
  const add = (sec, t2, lvl = 'info') => out[sec].push({ t: t2, lvl });
  if (g) { add('grain', g.info); g.tips.forEach((tip) => add('tips', tip)); }
  else add('grain', 'Wähle das Getreide – dann kennt die App typische Werte und Eigenheiten.');
  if (t) {
    add('type', `${t.label}${t.reg ? ` · ${REGIONS[t.reg]}` : ''}${t.eq ? ` – ${t.eq}` : ''}.${k.auto ? ' Aus dem Namen erkannt – zum Festlegen „Art“ wählen.' : ''}`);
    if (t.ash) add('type', `Mineralstoffe (Asche) ${t.ash}: je mehr Schale im Mehl, desto mehr Aroma, Enzyme und Wasserbindung – und desto schneller die Gärung.`);
    add('type', `Richtwerte: Eiweiß ${t.protein} %${t.wv ? ` · W ≈ ${t.wv}` : ''}${t.abs ? ` · Wasseraufnahme ≈ ${t.abs} %` : ''} · gut verträglich bis ca. ${t.cap} % Wasser.`);
    if (t.note) add('type', t.note);
    if (t.sour) add('type', `Sauerteig: ca. ${t.sour[0]}–${t.sour[1]} % des Roggenmehls versäuern.`);
    if (t.whole) add('tips', 'Vollkorn: 5–10 %-Punkte mehr Wasser, 20–60 min Quellzeit (Autolyse) vor dem Kneten; kühl und dunkel lagern – der Keim wird ranzig.');
  }
  // Backstärke
  if (x.rye || x.noGlut) { if (has(m.w)) add('w', `Bei ${g?.label || 'diesem Getreide'} ist der W-Wert nicht aussagekräftig – das Gerüst bildet kein Kleber.`, 'warn'); }
  else if (x.w) {
    const maxH = maxHoursForW(x.w);
    add('w', `W ≈ ${r0(x.w)} (${x.wSrc}) = ${strengthTxt(x.w)} → verträgt etwa ${maxH} h Gärzeit (Kühlschrank zählt halb).`, 'ok');
    if (has(m.w) && t?.wv && Math.abs(num(m.w) - t.wv) > 110) add('w', `Für ${t.label} ungewöhnlich (Richtwert ≈ ${t.wv}) – Packung prüfen oder eine andere Art wählen.`, 'warn');
    if (has(m.w) && has(m.protein)) {
      const est = wFromProtein(m.protein, g?.wFac ?? 1);
      if (Math.abs(num(m.w) - est) > 90) add('w', `W und Eiweiß passen nicht ganz zusammen (${dec(m.protein)} % Eiweiß ließe W ≈ ${est} erwarten). Kleberqualität (Sorte, Ernte) zählt mehr als die Menge – für die Gärzeit gilt der W-Wert.`, 'info');
    }
  }
  // Eiweiß
  const pr = has(m.protein) ? num(m.protein) : null;
  if (pr !== null) {
    if (t?.pr && (pr < t.pr[0] - 1.2 || pr > t.pr[1] + 1.2)) add('protein', `${dec(pr)} % liegt außerhalb des Üblichen für ${t.label} (${t.protein} %) – Angabe prüfen.`, 'warn');
    if (x.rye) add('protein', 'Roggeneiweiß bildet kaum Kleber – für die Backfähigkeit zählen Säure und Wasser.', 'info');
    else if (g && g.wFac < 0.8 && !x.noGlut) add('protein', `Viel Eiweiß heißt bei ${g.label} nicht viel Kraft: der Kleber ist weicher als bei Weizen (W-Schätzung daher ≈ ${wFromProtein(pr, g.wFac)}).`, 'info');
    else if (!x.noGlut) add('protein', `${pr >= 13 ? 'Eiweißreich – viel Kleber, gut für lange Führung und hohe Hydration.' : pr >= 11.5 ? 'Mittlerer Eiweißgehalt – vielseitig für Brot und Pizza.' : pr >= 10.5 ? 'Eher knapp – gut für Semmeln, Weißbrot und Pizza mit kurzer bis mittlerer Gare.' : 'Eiweißarm – zarte Krume; ideal für Kuchen, für Brot nur kurz führen.'}`, 'ok');
  } else if (t?.pr) add('protein', `Leer = Richtwert ${t.protein} %. Steht meist in der Nährwerttabelle der Packung.`);
  // Wasser
  if (has(m.absorption)) {
    add('absorption', `Wasseraufnahme ${dec(m.absorption)} % (Standardteig) → handwerklich gut bis ca. ${r0(num(m.absorption) + 8)} %, Empfehlung ca. ${r0(num(m.absorption) + 6)} %.`, 'ok');
    if (t?.abs && Math.abs(num(m.absorption) - t.abs) > 6) add('absorption', `Deutlich ${num(m.absorption) > t.abs ? 'mehr' : 'weniger'} als typisch für ${t.label} (≈ ${t.abs} %).`, 'info');
  } else add('absorption', `Ohne Angabe: gut verträglich bis ca. ${r0(x.cap || 70)} % Wasser (${x.capSrc || 'Richtwert'}). Wasseraufnahme steht auf Profi-Datenblättern (Farinograph).`);
  // P/L
  if (has(m.pl)) {
    const pl = num(m.pl);
    add('pl', pl > 1.2 ? `P/L ${dec(pl)}: sehr zäh – typisch für Hartweizen; für Pizza nur als Anteil.` : pl > 0.8 ? `P/L ${dec(pl)}: zäh-elastisch – Teiglinge länger entspannen lassen, ideal für lange Führung.` : pl < 0.4 ? `P/L ${dec(pl)}: sehr dehnbar – straff formen, Stückgare kürzer.` : `P/L ${dec(pl)}: ausgewogen – ${pl >= 0.5 && pl <= 0.7 ? 'ideal für Pizza zum Ausziehen' : 'gut zu verarbeiten'}.`, pl > 1.2 ? 'info' : 'ok');
  } else add('pl', 'P/L = Zähigkeit : Dehnbarkeit (Alveograph). Pizza ideal ca. 0,5–0,7.');
  // Fallzahl
  if (has(m.falling)) {
    const f = num(m.falling);
    if (x.rye) add('falling', f < 120 ? `${r0(f)} s: sehr viel Enzym (Auswuchs-Gefahr) – kräftig säuern (mehr Sauerteig), weniger Wasser, länger backen.` : f < 160 ? `${r0(f)} s: eher niedrig – etwas mehr Sauerteig und gut ausbacken.` : f > 250 ? `${r0(f)} s: wenig Enzym – die Krume kann trocken werden; ein Brüh- oder Kochstück hilft.` : `${r0(f)} s: gut für Roggen (ca. 160–250 s).`, f < 160 ? 'warn' : 'ok');
    else add('falling', f < 220 ? `${r0(f)} s: viel Enzymaktivität – bei langer Gare wird der Teig weich; kürzer oder kälter führen.` : f > 380 ? `${r0(f)} s: wenig Enzyme – blasse Kruste; 0,3–0,5 % Backmalz oder lange kalte Gare helfen.` : `${r0(f)} s: normale Enzymaktivität (ideal ca. 250–350 s).`, f < 220 ? 'warn' : 'ok');
  } else add('falling', x.rye ? 'Fallzahl = Enzymaktivität. Für Roggen ideal ca. 160–250 s.' : 'Fallzahl = Enzymaktivität. Für Weizen ideal ca. 250–350 s.');
  out.uses = flourUses(x);
  return out;
}
// Analyse einer Mehlmischung im Rezept: [{t, lvl}]; hours = längste Gare (h) für den Manitoba-Tipp
// sourPct = Mehl im Sauerteig in % vom Gesamtmehl (null = Rezept ohne Sauerteig-Angabe)
export function blendInsights(list, { hours = 0, hydration = 0, sourPct = null } = {}) {
  const b = blendOf(list), out = [], add = (t, lvl = 'info') => out.push({ t, lvl });
  if (!(b.tot > 0) || !b.parts.length) return { items: out, uses: [], blend: b };
  const gTxt = Object.entries(b.grains).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${r0(v)} % ${GRAINS[k]?.label || k}`).join(' · ');
  if (gTxt) add(`Zusammensetzung: ${gTxt}${b.whole >= 5 ? ` · davon ${r0(b.whole)} % Vollkorn` : ''}.`);
  if (b.known < b.tot - 0.5) add(`${r0(100 - (b.known / b.tot) * 100)} % der Mischung kennt die App nicht (${b.tot ? (list || []).filter((f) => !flourProps(f.name)).map((f) => `„${f.name || '?'}“`).join(', ') : ''}) – Mehltype in den Namen schreiben oder unter „Meine Mehle“ anlegen.`);
  if (b.w) {
    add(`Backstärke ≈ W ${r0(b.w)} (${strengthTxt(b.w)}${b.parts.filter((p) => p.w).length > 1 ? ', nach Anteilen gemittelt' : ''}) → Gare bis ca. ${maxHoursForW(b.w)} h.`, 'ok');
    const ws = b.parts.filter((p) => p.w).map((p) => p.w);
    if (ws.length > 1 && Math.max(...ws) - Math.min(...ws) >= 100) add('Starkes und schwaches Mehl gemischt: So stellst du die Backstärke gezielt ein – die Mischung verhält sich etwa wie der gemittelte W-Wert.');
    if (hours > 0 && hours > maxHoursForW(b.w)) {
      // kleinstes W, das diese Gärzeit trägt (W_HOURS: unter „lim“ → h Stunden)
      const i = W_HOURS.findIndex(([, h]) => h >= hours), target = i > 0 ? W_HOURS[i - 1][0] : 0;
      const share = target ? (target - b.w) / (380 - b.w) : 0;
      if (target && target < 380 && share > 0 && share <= 0.6) add(`Für ca. ${r0(hours)} h Gare reicht W ${r0(b.w)} knapp nicht: mit ca. ${r0(Math.ceil(share * 20) * 5)} % Manitoba (W ≈ 380) statt eines Teils des schwächsten Mehls käme die Mischung auf W ≈ ${target}.`, 'warn');
    }
  }
  if (b.protein) add(`Ø Eiweiß ≈ ${dec(Math.round(b.protein * 10) / 10)} %.`);
  if (b.cap) add(`Wasser: gut verträglich bis ca. ${r0(b.cap)} %, Empfehlung ca. ${r0(b.cap - 2)} %${hydration > 0 ? ` – im Rezept ${dec(Math.round(hydration * 10) / 10)} %${hydration > b.cap + 4 ? ' (eher viel)' : hydration < b.cap - 10 ? ' (eher fest)' : ' (passt)'}` : ''}.`, hydration > b.cap + 4 ? 'warn' : 'ok');
  if (b.rye >= 10) {
    const sour = b.parts.filter((p) => p.rye && p.lib?.sour), lo = sour.length ? Math.min(...sour.map((p) => p.lib.sour[0])) : 35, hi = sour.length ? Math.max(...sour.map((p) => p.lib.sour[1])) : 45;
    const rec = `${r0(b.rye)} % Roggen: ca. ${lo}–${hi} % des Roggenmehls versäuern (≈ ${r0((b.rye * lo) / 100)}–${r0((b.rye * hi) / 100)} % vom Gesamtmehl als Sauerteig).`;
    const mixTip = b.rye >= 50 ? ' Teig nur mischen, nicht lange kneten.' : '';
    if (sourPct === null) add(rec + mixTip, b.rye >= 20 ? 'warn' : 'info');
    else {
      const q = (sourPct / b.rye) * 100;
      add(`${rec} Im Rezept: ≈ ${r0(q)} %${q < lo - 5 ? ' – eher wenig Säure, die Krume kann klitschig werden.' : q > hi + 15 ? ' – viel Säure, das Brot wird kräftig-sauer.' : ' – passt.'}${mixTip}`, q < lo - 5 ? 'warn' : 'ok');
    }
  }
  if (b.whole >= 30) add(`${r0(b.whole)} % Vollkorn: 20–60 min Quellzeit oder ein Quellstück, und etwas mehr Wasser.`);
  if ((b.grains.dinkel || 0) >= 40) add(`${r0(b.grains.dinkel)} % Dinkel: kurz kneten, Teigtemperatur ≤ 24 °C, nicht übergären lassen.`);
  if ((b.grains.einkorn || 0) + (b.grains.emmer || 0) >= 30) add('Viel Einkorn/Emmer: weicher Kleber – wenig kneten, eher kühl führen oder in der Form backen.');
  if ((b.grains.hartweizen || 0) >= 10) add(`${r0(b.grains.hartweizen)} % Hartweizen: gelbe Krume, mehr Biss, knusprige Kruste – der Teig ist zäher.`);
  if (b.noGlut >= 20) add(`${r0(b.noGlut)} % Mehl ohne Kleber: das Gerüst wird schwächer, die Krume dichter${b.noGlut >= 35 ? ' – mehr als ca. 30 % sind heikel' : ''}.`, b.noGlut >= 35 ? 'warn' : 'info');
  const mix = { ...b, grain: Object.entries(b.grains).sort((p, q) => q[1] - p[1])[0]?.[0] || 'weizen', rye: b.rye >= 50, noGlut: b.noGlut >= 50, whole: b.whole >= 50, lib: null };
  // Roggenanteil prägt das Gebäck: ab ca. 15 % Mischbrot, ab 50 % Roggenbrot
  const uses = b.rye >= 50 ? [USE.rye] : b.rye >= 15 ? ['🍞 Mischbrot (mit Sauerteig)'] : flourUses(mix);
  return { items: out, uses, blend: b };
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
  // 3b) Mehle ohne backfähigen Kleber (Hafer, Buchweizen, Mais …) tragen kein Gasgerüst
  if (b.noGlut >= 35) add(b.noGlut >= 60 ? 'red' : 'yellow', `${fmt(b.noGlut)} % Mehl ohne Kleber – der Teig hält das Gas kaum, die Krume wird dicht.`, 'Auf ca. 20–30 % begrenzen oder ein kräftiges Weizenmehl dazunehmen.');
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
