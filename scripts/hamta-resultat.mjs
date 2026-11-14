// Hämtar tävlingsresultat och cupställningar för SKIDOR och sparar dem i
// data/resultat-<säsong>.json. Körs automatiskt av GitHub Actions
// (.github/workflows/resultat.yml) – ingen behöver redigera resultatfilen för hand.
//
// Källor:
//   Skidskytte: IBU:s öppna data (samma som biathlonworld.com använder)
//   Längd:      FIS resultatsidor (fis-ski.com), avläsning av webbsidorna
//
// Köra lokalt (Node 20+):  node scripts/hamta-resultat.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SASONG = { id: '2026-27', ibu: '2627', fis: '2027' };
const FIL = path.join(ROT, 'data', `resultat-${SASONG.id}.json`);
const TOPP = 30;          // antal placeringar som sparas per lopp/cup (+ alla svenskar)
const TZ = 'Europe/Stockholm';
const UA = 'Mozilla/5.0 (compatible; SKIDOR-resultat/1.0; +https://github.com/tomas-m-andersson/skidor)';

// ---------- Hjälp ----------
const vanta = (ms) => new Promise((r) => setTimeout(r, ms));
async function hamta(url, typ = 'text', forsok = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: typ === 'json' ? 'application/json' : 'text/html', Referer: url.includes('biathlon') ? 'https://www.biathlonworld.com/' : 'https://www.fis-ski.com/' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return typ === 'json' ? await r.json() : await r.text();
    } catch (fel) {
      if (i >= forsok) throw new Error(`${url}: ${fel.message}`);
      await vanta(1500 * i);
    }
  }
}
const svDatum = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const svTid = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
const avkoda = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&#39;|&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
// Behåll topp N + alla svenskar
const urval = (rader) => rader.filter((r, i) => i < TOPP || r.land === 'SWE');

// ---------- Svenska namn på grenar ----------
export function svenskGren(text) {
  let t = ' ' + text.toLowerCase() + ' ';
  const byt = [
    [/women'?s|ladies'?|men'?s/g, ''],
    [/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*km/g, (_, a, b) => `${a}×${b.replace('.', ',')} km`],
    [/(\d+(?:[.,]\d+)?)\s*km/g, (_, a) => `${a.replace('.', ',')} km`],
    [/\+/g, ' + '],
    [/single mixed relay|single mixed/g, 'singelmixstafett'],
    [/mixed relay/g, 'mixstafett'],
    [/team sprint/g, 'lagsprint'],
    [/interval start/g, 'intervallstart'],
    [/mass start/g, 'masstart'],
    [/pursuit/g, 'jaktstart'],
    [/skiathlon/g, 'skiathlon'],
    [/individual/g, 'distans'],
    [/relay/g, 'stafett'],
    [/sprint/g, 'sprint'],
    [/qualification/g, 'kval'],
    [/final climb/g, 'final climb'],
    [/classic(al)?/g, 'klassiskt'],
    [/free(style)?/g, 'fristil'],
    [/\(m\s*\+\s*w\)|\(w\s*\+\s*m\)/g, ''],
    [/\bmixed\b/g, 'mix']
  ];
  for (const [re, ny] of byt) t = t.replace(re, ny);
  t = t.replace(/\s+/g, ' ').trim();
  // "10 km intervallstart klassiskt" -> "10 km intervallstart, klassiskt"
  t = t.replace(/ (klassiskt|fristil)$/, ', $1');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const klassFranText = (t) => /mixed|\(m\s*\+\s*w\)/i.test(t) ? 'Mix' : /women|ladies/i.test(t) ? 'D' : /\bmen/i.test(t) ? 'H' : '';

// ======================================================================
// SKIDSKYTTE (IBU)
// ======================================================================
const IBU = 'https://bw.biathlonresults.com/modules/sportapi/api/';
const IBU_GREN = { SP: 'Sprint', PU: 'Jaktstart', IN: 'Distans', MS: 'Masstart', RL: 'Stafett', SR: 'Singelmixstafett' };

export function ibuLopp(event, comp, res) {
  const start = new Date(comp.StartTime);
  const klass = comp.catId === 'SW' ? 'D' : comp.catId === 'SM' ? 'H' : 'Mix';
  let gren = IBU_GREN[comp.DisciplineId] || comp.ShortDescription;
  if (comp.catId === 'MX' && comp.DisciplineId === 'RL') gren = 'Mixstafett';
  const km = comp.km ? String(comp.km).replace('.', ',').replace('x', '×') + ' km' : '';
  const rader = (res.Results || [])
    .filter((r) => !r.Leg || r.IsTeam) // stafett: bara lagrader
    .filter((r) => r.Rank || r.IRM)
    .map((r) => ({
      plats: r.Rank ? Number(r.Rank) : null,
      namn: r.IsTeam ? lagNamn(r.Nat) : namnIbu(r),
      land: r.Nat,
      tid: r.IRM || r.TotalTime || r.Result || '',
      efter: r.Rank === '1' ? '' : (r.Behind && r.Behind !== '0.0' ? r.Behind : ''),
      skytte: r.ShootingTotal ?? ''
    }))
    .sort((a, b) => (a.plats ?? 9999) - (b.plats ?? 9999));
  return {
    id: comp.RaceId,
    sport: 'skidskytte',
    serie: event.EventId.includes('CH') ? 'vm' : 'vc',
    datum: svDatum(start),
    tid: svTid(start),
    ort: ortIbu(event.Organizer),
    land: event.Nat,
    gren: km ? `${gren} ${km}` : gren,
    klass,
    status: /final|official|unofficial/i.test(comp.StatusText || '') ? 'klar' : 'preliminar',
    lag: rader.length > 0 && (res.Results || []).some((r) => r.IsTeam),
    kalla: `https://www.biathlonworld.com/results/${SASONG.ibu}/`,
    rader: urval(rader)
  };
}
function namnIbu(r) {
  const efter = r.FamilyName ? r.FamilyName.charAt(0) + r.FamilyName.slice(1).toLowerCase() : '';
  const efterNamn = efter.replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return [r.GivenName, efterNamn].filter(Boolean).join(' ') || r.Name;
}
const ORTER = { Oestersund: 'Östersund', 'Oslo Holmenkollen': 'Holmenkollen', 'Nove Mesto na Morave': 'Nové Město', Otepaa: 'Otepää', 'Antholz-Anterselva': 'Antholz', 'Le Grand Bornand': 'Le Grand-Bornand' };
const ortIbu = (o) => ORTER[o] || o;
const LAG = { SWE: 'Sverige', NOR: 'Norge', FIN: 'Finland', GER: 'Tyskland', FRA: 'Frankrike', ITA: 'Italien', AUT: 'Österrike', SUI: 'Schweiz', USA: 'USA', CAN: 'Kanada', CZE: 'Tjeckien', SLO: 'Slovenien', EST: 'Estland', POL: 'Polen', UKR: 'Ukraina', BUL: 'Bulgarien', SVK: 'Slovakien', LAT: 'Lettland', LTU: 'Litauen', BEL: 'Belgien', JPN: 'Japan', KAZ: 'Kazakstan', CHN: 'Kina', GBR: 'Storbritannien', ROU: 'Rumänien' };
const lagNamn = (nat) => LAG[nat] || nat;

export function ibuCup(cup, data) {
  const klass = cup.CatId === 'SW' ? 'D' : cup.CatId === 'SM' ? 'H' : 'Mix';
  const namn = { TS: 'Totalt', SP: 'Sprint', PU: 'Jaktstart', IN: 'Distans', MS: 'Masstart' }[cup.DisciplineId];
  const rader = (data.Rows || []).map((r) => ({ plats: Number(r.Rank) || null, namn: namnIbu(r), land: r.Nat, poang: Number(String(r.Score).replace(/\D/g, '')) || 0 }));
  return {
    id: cup.CupId, sport: 'skidskytte', namn, klass,
    efter: data.RaceCount != null && data.TotalRaces ? `Efter ${data.RaceCount} av ${data.TotalRaces} lopp` : '',
    rader: urval(rader)
  };
}

async function hamtaIbu(tidigare) {
  const lopp = [];
  const events = await hamta(`${IBU}Events?SeasonId=${SASONG.ibu}&Level=1`, 'json');
  const nu = Date.now();
  for (const ev of events) {
    if (new Date(ev.StartDate).getTime() > nu) continue;
    const comps = await hamta(`${IBU}Competitions?EventId=${ev.EventId}`, 'json');
    for (const c of comps) {
      const start = new Date(c.StartTime).getTime();
      if (start > nu) continue;
      const gammal = tidigare.get(c.RaceId);
      // Klara lopp hämtas inte om (utom första dygnet, ifall resultatet justeras)
      if (gammal && gammal.status === 'klar' && nu - start > 36 * 3600e3) { lopp.push(gammal); continue; }
      try {
        const res = await hamta(`${IBU}Results?RaceId=${c.RaceId}`, 'json');
        if ((res.Results || []).length) lopp.push(ibuLopp(ev, c, res));
      } catch (fel) { console.warn('IBU-resultat:', fel.message); if (gammal) lopp.push(gammal); }
    }
  }
  const cuper = [];
  const allaCuper = await hamta(`${IBU}Cups?SeasonId=${SASONG.ibu}&Language=EN`, 'json');
  for (const cup of allaCuper.filter((c) => c.Level === 1 && ['TS', 'SP', 'PU', 'IN', 'MS'].includes(c.DisciplineId) && ['SW', 'SM'].includes(c.CatId))) {
    try {
      const data = await hamta(`${IBU}CupResults?CupId=${cup.CupId}&Language=EN`, 'json');
      if ((data.Rows || []).length) cuper.push(ibuCup(cup, data));
    } catch (fel) { console.warn('IBU-cup:', fel.message); }
  }
  return { lopp, cuper };
}

// ======================================================================
// LÄNGD (FIS)
// ======================================================================
const FIS = 'https://www.fis-ski.com/DB';

// Kalendersidan → lista över tävlingshelger (eventid + serie)
export function fisKalender(html) {
  const ut = [];
  for (const del of html.split('<div class="table-row reset-padding"').slice(1)) {
    const id = (del.match(/^[^>]*id="(\d+)"/) || [])[1];
    if (!id) continue;
    const koder = avkoda((del.match(/<span class="gray clip">([^<]*)</) || [])[1] || '');
    const ort = avkoda((del.match(/<span class="bold clip-xs">([^<]*)</) || [])[1] || '');
    ut.push({ id, koder, ort });
  }
  return ut;
}
// Tävlingshelgens sida → lopp-id:n med starttid
export function fisEvent(html) {
  const ut = new Map();
  for (const m of html.matchAll(/results\.html\?sectorcode=CC&(?:amp;)?raceid=(\d+)"[\s\S]{0,1500}?data-iso-date="([^"]+)"/g)) {
    if (!ut.has(m[1])) ut.set(m[1], m[2]);
  }
  return [...ut].map(([id, iso]) => ({ id, start: new Date(iso) }));
}
// Resultatsidan för ett lopp
export function fisResultat(html) {
  const rubrik = avkoda((html.match(/event-header__kind">\s*([^<]*?)\s*</) || [])[1] || '');
  const platsText = avkoda((html.match(/<h1 class="heading[^"]*">([^<]*)</) || [])[1] || '');
  const iso = (html.match(/event-header__date[\s\S]{0,400}?data-iso-date="([^"]+)"/) || [])[1];
  const del = html.slice(html.indexOf('id="events-info-results"'));
  const rader = [];
  if (html.includes('id="events-info-results"')) {
    for (const rad of del.split(/<a class="table-row(?=[\s"])/).slice(1)) {
      const medlem = /^[^>]*table-row_theme_additional/.test(rad);
      const celler = rad.slice(rad.indexOf('>') + 1)
        .replace(/<!--[\s\S]*?-->/g, '')
        .split(/<[^>]+>/).map(avkoda).filter(Boolean);
      if (medlem) {
        // Lagmedlem (stafett/lagsprint): lägg till under senaste laget
        const namn = celler.find((c) => /\p{L}{2}/u.test(c) && !/^\d/.test(c));
        const lag = rader[rader.length - 1];
        if (namn && lag) (lag.medlemmar ||= []).push(namnFis(namn, ''));
        continue;
      }
      if (!celler.length || !/^\d+$/.test(celler[0])) continue;
      const landIdx = celler.findIndex((c, i) => i > 1 && /^[A-Z]{3}$/.test(c));
      if (landIdx < 0) continue;
      const land = celler[landIdx];
      // Namn: första cellen med bokstäver efter plats/startnummer/kod
      const namn = celler.slice(1, landIdx).find((c) => /\p{L}{2}/u.test(c)) || land;
      const efterLand = celler.slice(landIdx + 1);
      const tid = efterLand.find((c) => /^\d{1,2}:\d{2}(:\d{2})?(\.\d{1,2})?$|^\d{1,2}\.\d{1,2}$/.test(c)) || '';
      const efter = efterLand.find((c) => /^\+/.test(c)) || '';
      const arLag = /table-row_theme_main/.test(rad.slice(0, 200)) || (namn === namn.toUpperCase() && !/\p{Ll}/u.test(namn));
      rader.push({ plats: Number(celler[0]), namn: arLag ? lagNamnFis(namn, land) : namnFis(namn, land), land, tid, efter });
      if (rader.length > 300) break;
    }
  }
  return { rubrik, platsText, start: iso ? new Date(iso) : null, rader };
}
// "SWEDEN I" -> "Sverige I"
function lagNamnFis(namn, land) {
  const nr = (namn.match(/\s(I{1,3}|IV|V|\d)$/) || [])[1];
  return land ? `${lagNamn(land)}${nr ? ' ' + nr : ''}` : namn;
}
function namnFis(namn, land) {
  if (namn === land) return lagNamn(land);
  // "SVAHN Linn" -> "Linn Svahn"
  const ord = namn.split(' ');
  const efter = ord.filter((o) => o === o.toUpperCase() && /\p{Lu}/u.test(o));
  const for_ = ord.filter((o) => !efter.includes(o));
  if (!efter.length || !for_.length) return namn;
  const snygg = efter.join(' ').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return `${for_.join(' ')} ${snygg}`;
}
// Cupställning
export function fisCup(html) {
  const efter = avkoda((html.match(/After ([^<]*?\(\d+\/\d+\))/) || [])[1] || '');
  const rader = [];
  for (const rad of html.split(/<a class="table-row\s+reset-padding"/).slice(1)) {
    const namn = avkoda((rad.match(/justify-left bold align-xs-top">([\s\S]*?)<\/div>/) || [])[1] || '');
    const land = (rad.match(/country__name-short">([A-Z]{3})</) || [])[1] || '';
    // Siffror i ordning: Totalt plats, poäng, Distans plats, poäng, Sprint plats, poäng
    const tal = [...rad.matchAll(/justify-right[^"]*">\s*([\d']+|---)\s*</g)].map((m) => m[1] === '---' ? null : Number(m[1].replace(/'/g, '')));
    if (!namn || tal.length < 2) continue;
    rader.push({ namn: namnFis(namn, land), land, tot: [tal[0], tal[1]], dist: [tal[2] ?? null, tal[3] ?? null], sprint: [tal[4] ?? null, tal[5] ?? null] });
  }
  return { efter, rader };
}
const efterText = (s) => {
  const m = s.match(/\((\d+)\/(\d+)\)/);
  return m ? `Efter ${m[1]} av ${m[2]} lopp` : '';
};

async function hamtaFis(tidigare) {
  const lopp = [];
  const nu = Date.now();
  const helger = [];
  for (const [kategori, serieStd] of [['WC', 'vc'], ['WSC', 'vm']]) {
    const url = `${FIS}/cross-country/calendar-results.html?eventselection=&place=&sectorcode=CC&seasoncode=${SASONG.fis}&categorycode=${kategori}&disciplinecode=&gendercode=&racedate=&racecodex=&nationcode=&seasonmonth=X-${SASONG.fis}&saveselection=-1&seasonselection=`;
    try {
      for (const h of fisKalender(await hamta(url))) {
        if (/Tour de Ski/i.test(h.ort)) continue; // samlingsevent – etapperna finns som egna helger
        helger.push({ ...h, serie: kategori === 'WSC' ? 'vm' : /\bSWC\b/.test(h.koder) ? 'tds' : serieStd });
      }
    } catch (fel) { console.warn('FIS-kalender:', fel.message); }
  }
  for (const h of helger) {
    let lista;
    try { lista = fisEvent(await hamta(`${FIS}/general/event-details.html?sectorcode=CC&eventid=${h.id}&seasoncode=${SASONG.fis}`)); }
    catch (fel) { console.warn('FIS-helg:', fel.message); continue; }
    for (const { id, start } of lista) {
      if (start.getTime() > nu) continue;
      const lid = `FIS${id}`;
      const gammal = tidigare.get(lid);
      if (gammal && gammal.status === 'klar' && nu - start.getTime() > 36 * 3600e3) { lopp.push(gammal); continue; }
      try {
        const r = fisResultat(await hamta(`${FIS}/general/results.html?sectorcode=CC&raceid=${id}`));
        if (/qualification/i.test(r.rubrik)) continue; // kval visas inte
        if (!r.rader.length) { if (gammal) lopp.push(gammal); continue; }
        const st = r.start || start;
        lopp.push({
          id: lid, sport: 'langd', serie: h.serie,
          datum: svDatum(st), tid: svTid(st),
          ort: r.platsText.replace(/\s*\([A-Z]{3}\)\s*$/, '') || h.ort,
          land: (r.platsText.match(/\(([A-Z]{3})\)/) || [])[1] || '',
          gren: svenskGren(r.rubrik), klass: klassFranText(r.rubrik),
          status: nu - st.getTime() > 3 * 3600e3 ? 'klar' : 'preliminar',
          lag: /relay|team sprint|stafett/i.test(r.rubrik),
          kalla: `${FIS}/general/results.html?sectorcode=CC&raceid=${id}`,
          rader: urval(r.rader)
        });
      } catch (fel) { console.warn('FIS-resultat:', fel.message); if (gammal) lopp.push(gammal); }
      await vanta(300);
    }
  }
  const cuper = [];
  for (const [kon, klass] of [['W', 'D'], ['M', 'H']]) {
    try {
      const { efter, rader } = fisCup(await hamta(`${FIS}/cross-country/cup-standings.html?sectorcode=CC&seasoncode=${SASONG.fis}&cupcode=WC&disciplinecode=ALL&gendercode=${kon}&nationcode=`));
      if (!rader.length) continue;
      const del = (namn, nyckel) => {
        const r = rader.filter((x) => x[nyckel][0] != null && x[nyckel][1])
          .map((x) => ({ plats: x[nyckel][0], namn: x.namn, land: x.land, poang: x[nyckel][1] }))
          .sort((a, b) => a.plats - b.plats);
        return { id: `FIS-WC-${kon}-${nyckel}`, sport: 'langd', namn, klass, efter: efterText(efter), rader: urval(r) };
      };
      cuper.push(del('Totalt', 'tot'), del('Distans', 'dist'), del('Sprint', 'sprint'));
    } catch (fel) { console.warn('FIS-cup:', fel.message); }
  }
  return { lopp, cuper: cuper.filter((c) => c.rader.length) };
}

// ======================================================================
async function main() {
  let tidigareData = { lopp: [], cuper: [] };
  try { tidigareData = JSON.parse(await fs.readFile(FIL, 'utf8')); } catch { /* första gången */ }
  const tidigare = new Map((tidigareData.lopp || []).map((l) => [l.id, l]));

  const delar = await Promise.allSettled([hamtaIbu(tidigare), hamtaFis(tidigare)]);
  const lopp = [], cuper = [];
  const fel = [];
  delar.forEach((d, i) => {
    const sport = i === 0 ? 'skidskytte' : 'langd';
    if (d.status === 'fulfilled') { lopp.push(...d.value.lopp); cuper.push(...d.value.cuper); }
    else {
      fel.push(`${sport}: ${d.reason?.message || d.reason}`);
      // Behåll det vi hade om en källa är nere
      lopp.push(...(tidigareData.lopp || []).filter((l) => l.sport === sport));
      cuper.push(...(tidigareData.cuper || []).filter((c) => c.sport === sport));
    }
  });
  lopp.sort((a, b) => (b.datum + b.tid).localeCompare(a.datum + a.tid));

  const innehall = { sasong: '2026/27', lopp, cuper };
  const gammalJson = JSON.stringify({ sasong: tidigareData.sasong, lopp: tidigareData.lopp, cuper: tidigareData.cuper });
  if (JSON.stringify(innehall) === gammalJson) {
    console.log('Inga nya resultat.');
  } else {
    const ut = { uppdaterad: new Date().toISOString(), ...innehall };
    await fs.writeFile(FIL, JSON.stringify(ut, null, 1) + '\n');
    console.log(`Sparade ${lopp.length} lopp och ${cuper.length} cupställningar.`);
  }
  if (fel.length) { console.error('Fel:', fel.join(' | ')); if (fel.length === 2) process.exitCode = 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
