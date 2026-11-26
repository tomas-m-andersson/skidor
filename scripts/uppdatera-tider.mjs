// Fyller i starttider för längdskidor (världscup, Tour de Ski, VM) i tablån
// när FIS publicerar dem, och uppdaterar dem om de ändras.
// Körs automatiskt av GitHub Actions (.github/workflows/tider.yml) två gånger per dygn.
//
// Regler – för att aldrig förstöra något som lagts in för hand:
//   * Bara längdskidor i serierna vc, tds och vm rörs.
//   * En dag uppdateras bara om ALLA dess rader (för den serien) saknar tid,
//     har en preliminär tid eller redan är automatiskt ifyllda ("auto": true).
//     Har någon rad den dagen en tid som lagts in för hand rörs inte dagen.
//   * Första loppet på dagen behåller radens id, så påminnelser följer med.
//   * Filen kontrolleras innan den sparas; alla andra rader måste vara oförändrade.
//
// Köra lokalt:  node scripts/uppdatera-tider.mjs            (sparar)
//               node scripts/uppdatera-tider.mjs --torrkor  (visar bara vad som skulle ändras)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fisKalender, fisEvent, fisResultat, svenskGren, klassFranText } from './hamta-resultat.mjs';

const ROT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TORRKOR = process.argv.includes('--torrkor');
const FIS = 'https://www.fis-ski.com/DB';
const TZ = 'Europe/Stockholm';
const UA = 'Mozilla/5.0 (compatible; SKIDOR-tider/1.0; +https://github.com/tomas-m-andersson/skidor)';
const SERIER = ['vc', 'tds', 'vm'];

const vanta = (ms) => new Promise((r) => setTimeout(r, ms));
async function hamta(url, forsok = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html', Referer: 'https://www.fis-ski.com/' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (fel) {
      if (i >= forsok) throw new Error(`${url}: ${fel.message}`);
      await vanta(1500 * i);
    }
  }
}
const svDatum = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const svTid = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
const slug = (s) => s.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Gren för tablån: tydliga namn på sprintens delar
export function tablaGren(rubrik) {
  let g = svenskGren(rubrik);
  if (/team sprint/i.test(rubrik)) g = g.replace(/^Lagsprint(?! kval)/, /final/i.test(rubrik) ? 'Lagsprint final' : 'Lagsprint');
  else if (/sprint/i.test(rubrik) && /final/i.test(rubrik)) g = g.replace(/^Sprint(?! kval)/, 'Sprint finaler');
  return g;
}

// Gör om FIS-loppen för en dag till tablårader. Sprint (kval/finaler) slås ihop
// för damer och herrar till en rad med den tidigaste starten.
export function dagensRader(lopp) {
  const ut = [];
  for (const l of lopp.sort((a, b) => a.start - b.start)) {
    const arSprint = /sprint/i.test(l.rubrik);
    const gren = tablaGren(l.rubrik);
    const klass = klassFranText(l.rubrik) || 'DH';
    if (arSprint) {
      const finns = ut.find((r) => r.gren === gren);
      if (finns) { if (finns.klass !== klass) finns.klass = 'DH'; continue; }
    }
    ut.push({ gren, klass, start: svTid(l.start), startMs: l.start.getTime() });
  }
  return ut.sort((a, b) => a.startMs - b.startMs);
}

async function hamtaFisLopp(fisSasong) {
  const helger = [];
  for (const [kategori, serieStd] of [['WC', 'vc'], ['WSC', 'vm']]) {
    const url = `${FIS}/cross-country/calendar-results.html?eventselection=&place=&sectorcode=CC&seasoncode=${fisSasong}&categorycode=${kategori}&disciplinecode=&gendercode=&racedate=&racecodex=&nationcode=&seasonmonth=X-${fisSasong}&saveselection=-1&seasonselection=`;
    for (const h of fisKalender(await hamta(url))) {
      if (/Tour de Ski/i.test(h.ort)) continue;
      helger.push({ ...h, serie: kategori === 'WSC' ? 'vm' : /\bSWC\b/.test(h.koder) ? 'tds' : serieStd });
    }
  }
  const lopp = [];
  const nu = Date.now();
  for (const h of helger) {
    let lista;
    try { lista = fisEvent(await hamta(`${FIS}/general/event-details.html?sectorcode=CC&eventid=${h.id}&seasoncode=${fisSasong}`)); }
    catch (fel) { console.warn('FIS-helg:', fel.message); continue; }
    for (const { id, start } of lista) {
      if (start.getTime() < nu - 2 * 864e5) continue; // bara kommande lopp
      try {
        const r = fisResultat(await hamta(`${FIS}/general/results.html?sectorcode=CC&raceid=${id}`));
        if (!r.rubrik) continue;
        const st = r.start || start;
        if (/cancel/i.test(r.rubrik)) continue;
        lopp.push({ serie: h.serie, datum: svDatum(st), start: st, rubrik: r.rubrik });
      } catch (fel) { console.warn('FIS-lopp:', fel.message); }
      await vanta(250);
    }
  }
  return lopp;
}

const rorbar = (e) => e.sport === 'langd' && SERIER.includes(e.serie) &&
  (!e.start || e.auto === true || /Preliminär starttid/i.test(e.notering || ''));

export function uppdatera(handelser, fisLopp) {
  const andringar = [];
  const perDag = new Map();
  for (const l of fisLopp) {
    const k = `${l.datum}|${l.serie}`;
    if (!perDag.has(k)) perDag.set(k, []);
    perDag.get(k).push(l);
  }
  let ut = handelser.slice();
  for (const [k, lopp] of perDag) {
    const [datum, serie] = k.split('|');
    const dagens = ut.filter((e) => e.sport === 'langd' && e.datum === datum && e.serie === serie);
    if (!dagens.length) continue;                 // ingen rad i tablån den dagen – lägg inte till nya dagar
    if (!dagens.every(rorbar)) continue;          // handinlagda tider vinner
    const nya = dagensRader(lopp);
    if (!nya.length) continue;
    if (nya.length < dagens.length) continue;    // FIS har inte publicerat alla dagens lopp än – vänta
    const mall = dagens[0];
    const lediga = dagens.map((e) => e.id);
    const anvanda = new Set();
    const bygg = nya.map((n) => {
      const naturligt = `${datum}-langd-${serie}-${slug(mall.ort).slice(0, 14)}-${slug(n.gren).slice(0, 18)}-${n.klass.toLowerCase()}`;
      let id = lediga.find((x) => x === naturligt && !anvanda.has(x)) || null;
      return { n, id, naturligt };
    });
    for (const b of bygg) if (b.id) anvanda.add(b.id);
    for (const b of bygg) {
      if (b.id) continue;
      const ledig = lediga.find((x) => !anvanda.has(x));
      if (ledig) { b.id = ledig; anvanda.add(ledig); continue; }
      let id = b.naturligt, i = 2;
      while (ut.some((e) => e.id === id) || bygg.some((x) => x !== b && x.id === id)) id = `${b.naturligt}-${i++}`;
      b.id = id; anvanda.add(id);
    }
    const rader = bygg.map(({ n, id }) => {
      const gammal = dagens.find((e) => e.id === id);
      return {
        datum, start: n.start, sport: 'langd', serie, ort: mall.ort, land: mall.land, gren: n.gren, klass: n.klass,
        kanal: (gammal || mall).kanal || [],
        notering: 'Starttid enligt FIS (loppets start – sändningen börjar ofta en stund före).',
        auto: true, id
      };
    });
    const fore = JSON.stringify(dagens.map(({ id, start, gren, klass }) => ({ id, start, gren, klass })));
    const efter = JSON.stringify(rader.map(({ id, start, gren, klass }) => ({ id, start, gren, klass })));
    const kanalAndrad = rader.some((r) => { const g = dagens.find((e) => e.id === r.id); return !g || g.notering !== r.notering || !g.auto; });
    if (fore === efter && !kanalAndrad) continue;
    // Behåll handinlagda raders ordning: ta bort dagens rader och lägg in de nya
    const bortIds = new Set(dagens.map((e) => e.id));
    ut = ut.filter((e) => !bortIds.has(e.id)).concat(rader);
    andringar.push({ datum, serie, ort: mall.ort, fore: dagens, efter: rader });
  }
  ut.sort((a, b) => (a.datum + (a.start || '99')).localeCompare(b.datum + (b.start || '99')));
  return { handelser: ut, andringar };
}

// Skriver filen i samma format som tidigare: en händelse per rad
const fmt = (v) => Array.isArray(v) ? `[${v.map(fmt).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${fmt(x)}`).join(', ')}}`
  : JSON.stringify(v);
export function skrivText(data) {
  const { handelser, ...huvud } = data;
  const head = JSON.stringify(huvud, null, 2).slice(0, -2);
  return `${head},\n  "handelser": [\n    ${handelser.map(fmt).join(',\n    ')}\n  ]\n}\n`;
}

async function main() {
  const konfig = JSON.parse(await fs.readFile(path.join(ROT, 'data', 'sasonger.json'), 'utf8'));
  const sasong = konfig.sasonger.find((s) => s.id === konfig.standard);
  const fil = path.join(ROT, sasong.fil);
  const data = JSON.parse(await fs.readFile(fil, 'utf8'));
  const fisSasong = '20' + sasong.id.slice(5, 7);

  const fisLopp = await hamtaFisLopp(fisSasong);
  console.log(`FIS: ${fisLopp.length} kommande lopp hittade.`);
  if (!fisLopp.length) { console.log('Inget att göra.'); return; }

  const { handelser, andringar } = uppdatera(data.handelser, fisLopp);
  if (!andringar.length) { console.log('Inga nya eller ändrade tider.'); return; }

  // Säkerhetskontroll: allt som inte får röras ska vara exakt som förut
  const orort = (lista) => JSON.stringify(lista.filter((e) => !(e.sport === 'langd' && SERIER.includes(e.serie))).sort((a, b) => a.id.localeCompare(b.id)));
  if (orort(handelser) !== orort(data.handelser)) throw new Error('Säkerhetsspärr: andra rader skulle ändras – inget sparat.');
  const ids = handelser.map((e) => e.id);
  if (new Set(ids).size !== ids.length) throw new Error('Säkerhetsspärr: dubbla id – inget sparat.');

  for (const a of andringar) {
    console.log(`\n${a.datum} ${a.ort} (${a.serie}):`);
    for (const e of a.fore) console.log(`  före:  ${e.start || '--:--'} ${e.gren} (${e.klass})`);
    for (const e of a.efter) console.log(`  efter: ${e.start} ${e.gren} (${e.klass})`);
  }
  if (TORRKOR) { console.log('\nTorrkörning – inget sparat.'); return; }

  const idag = svDatum(new Date());
  const ny = { ...data, uppdaterad: idag, handelser };
  const text = skrivText(ny);
  JSON.parse(text); // kontroll: giltig JSON
  await fs.writeFile(fil, text);
  await fs.writeFile(path.join(ROT, 'data', 'senaste-tidsuppdatering.txt'),
    `${new Date().toISOString()}\n` + andringar.map((a) => `${a.datum} ${a.ort}: ${a.efter.map((e) => `${e.start} ${e.gren} (${e.klass})`).join(', ')}`).join('\n') + '\n');
  console.log(`\nSparade ändringar för ${andringar.length} dagar.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((fel) => { console.error(fel.message); process.exitCode = 1; });
}
