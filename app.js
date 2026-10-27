/* Skidor på TV – all logik i en fil.
   Datan ligger i data/sasonger.json (lista över säsonger + färger/namn)
   och i en fil per säsong, t.ex. data/sasong-2026-27.json.
   Alla tider i datan är svensk tid. */
(() => {
  'use strict';

  const TZ = 'Europe/Stockholm';
  const LS = 'skidor.';
  const $ = (s, el = document) => el.querySelector(s);

  // ---------- Lagring (tål privat läge) ----------
  const lagra = {
    hamta(k, standard) {
      try { const v = localStorage.getItem(LS + k); return v === null ? standard : JSON.parse(v); } catch { return standard; }
    },
    spara(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* ignoreras */ } }
  };

  // ---------- Tillstånd ----------
  const st = {
    konfig: null,
    sasongId: null,
    sasong: null,
    handelser: [],
    vy: ['tabla', 'kalender', 'mina'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tabla',
    sporter: new Set(lagra.hamta('sporter', [])),
    serier: new Set(lagra.hamta('serier', [])),
    paminn: new Set(lagra.hamta('paminn', [])),
    aviserade: new Set(lagra.hamta('aviserade', [])),
    forvarning: lagra.hamta('forvarning', 15),
    visaPasserade: lagra.hamta('visaPasserade', false),
    baraTid: lagra.hamta('baraTid', false),
    notiser: lagra.hamta('notiser', false),
    kalManad: null,  // "2027-01"
    kalDag: null,    // "2027-01-14"
    visaTidigare: false
  };

  // ---------- Tid (svensk tid oavsett var man befinner sig) ----------
  function sistaSondag(ar, manad) { // manad 0-11
    const d = new Date(Date.UTC(ar, manad + 1, 0));
    return d.getUTCDate() - d.getUTCDay();
  }
  function arSommartid(utcMs) {
    const ar = new Date(utcMs).getUTCFullYear();
    const start = Date.UTC(ar, 2, sistaSondag(ar, 2), 1);
    const slut = Date.UTC(ar, 9, sistaSondag(ar, 9), 1);
    return utcMs >= start && utcMs < slut;
  }
  function tillDatum(datum, tid = '00:00') {
    const [y, m, d] = datum.split('-').map(Number);
    const [h, mi] = tid.split(':').map(Number);
    const naiv = Date.UTC(y, m - 1, d, h, mi);
    let ms = naiv - 3600e3;
    if (arSommartid(ms)) ms = naiv - 7200e3;
    return new Date(ms);
  }
  const dagNyckel = (date) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const idagNyckel = () => dagNyckel(new Date());
  function laggTillDagar(nyckel, n) {
    const [y, m, d] = nyckel.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  const utcDag = (nyckel) => { const [y, m, d] = nyckel.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
  const fmt = (o) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', ...o });
  const fDagLang = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const fDagKort = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
  const fManad = fmt({ month: 'long', year: 'numeric' });
  const stor = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const visaTid = (t) => t ? t.replace(':', '.') : '';

  // Start/slut som riktiga tidpunkter
  function startTid(e) { return tillDatum(e.datum, e.start || '00:00'); }
  function slutTid(e) {
    if (e.slut) {
      let s = tillDatum(e.datum, e.slut);
      if (s <= startTid(e)) s = new Date(s.getTime() + 864e5); // över midnatt
      return s;
    }
    if (e.start) return new Date(startTid(e).getTime() + 2 * 3600e3);
    return tillDatum(laggTillDagar(e.datum, 1));
  }
  const arPasserad = (e) => slutTid(e) < new Date();
  const arLive = (e) => e.start && startTid(e) <= new Date() && slutTid(e) > new Date();

  // ---------- Hjälp ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const serie = (e) => st.konfig.serier[e.serie] || { namn: e.serie, kort: e.serie, farg: '#888' };
  const sportNamn = (e) => (st.konfig.sporter[e.sport] || { namn: e.sport }).namn;
  const klassNamn = (e) => e.klass ? (st.konfig.klasser[e.klass] || e.klass) : '';
  const flagga = (e) => st.konfig.lander[e.land] || '';
  function rubrik(e) {
    const k = e.klass && e.klass !== 'DH' && e.klass !== 'Mix' ? ` (${e.klass})` : '';
    return e.gren + k;
  }
  function kortNamn(e) { return `${sportNamn(e)}, ${serie(e).namn}: ${rubrik(e)} – ${e.ort}`; }
  function kanalKlass(k) {
    const l = k.toLowerCase();
    if (l.startsWith('svt')) return 'svt';
    if (l.startsWith('viaplay')) return 'viaplay';
    if (l === 'tv6') return 'tv6';
    return '';
  }
  function kanalHtml(e) {
    if (!e.kanal || !e.kanal.length) return '<span class="kanal okand">Kanal ej klar</span>';
    return e.kanal.map((k) => `<span class="kanal ${kanalKlass(k)}">${esc(k)}</span>`).join('');
  }
  const klockIkon = '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('syns');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('syns'), 2600);
  }

  // ---------- Data ----------
  async function hamtaJson(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }
  async function laddaSasong(id) {
    const s = st.konfig.sasonger.find((x) => x.id === id) || st.konfig.sasonger[0];
    st.sasongId = s.id;
    lagra.spara('sasong', s.id);
    st.sasong = await hamtaJson(s.fil);
    st.handelser = st.sasong.handelser
      .slice()
      .sort((a, b) => (a.datum + (a.start || '99')).localeCompare(b.datum + (b.start || '99')));
    st.kalManad = null;
    st.kalDag = null;
  }

  function filtrerade() {
    return st.handelser.filter((e) =>
      (!st.sporter.size || st.sporter.has(e.sport)) &&
      (!st.serier.size || st.serier.has(e.serie)) &&
      (!st.baraTid || e.start));
  }

  // ---------- Filter-chips ----------
  function ritaFilter() {
    const finnsSerier = new Set(st.handelser.map((e) => e.serie));
    const finnsSporter = new Set(st.handelser.map((e) => e.sport));
    const chips = [];
    for (const [id, s] of Object.entries(st.konfig.sporter)) {
      if (!finnsSporter.has(id)) continue;
      chips.push(`<button class="chip" data-sport="${id}" aria-pressed="${st.sporter.has(id)}">${esc(s.namn)}</button>`);
    }
    chips.push('<span class="chip-skilj"></span>');
    for (const [id, s] of Object.entries(st.konfig.serier)) {
      if (!finnsSerier.has(id)) continue;
      chips.push(`<button class="chip" data-serie="${id}" style="--c:${s.farg}" aria-pressed="${st.serier.has(id)}"><i></i>${esc(s.namn)}</button>`);
    }
    $('#filter').innerHTML = chips.join('');
  }
  $('#filter').addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip');
    if (!b) return;
    const [set, nyckel, varde] = b.dataset.sport ? [st.sporter, 'sporter', b.dataset.sport] : [st.serier, 'serier', b.dataset.serie];
    set.has(varde) ? set.delete(varde) : set.add(varde);
    lagra.spara(nyckel, [...set]);
    ritaFilter();
    rita();
  });

  // ---------- Kort ----------
  function kortHtml(e) {
    const s = serie(e);
    const p = st.paminn.has(e.id);
    const tid = e.start
      ? `<div class="tid">${visaTid(e.start)}${e.slut ? `<small>–${visaTid(e.slut)}</small>` : ''}</div>`
      : '<div class="tid okand">Tid ej klar</div>';
    return `<article class="kort${arPasserad(e) ? ' passerad' : ''}" style="--c:${s.farg}" data-id="${esc(e.id)}" tabindex="0">
      ${tid}
      <div class="info">
        <div class="overrad">${esc(sportNamn(e))} · ${esc(s.namn)}${arLive(e) ? '<span class="live">LIVE</span>' : ''}</div>
        <div class="titel">${esc(rubrik(e))}</div>
        <div class="ort">${flagga(e)} ${esc(e.ort)}${e.klass === 'DH' ? ' · Damer & herrar' : e.klass === 'Mix' ? ' · Mixed' : ''}</div>
        <div class="kanaler">${kanalHtml(e)}</div>
      </div>
      <button class="klocka" data-paminn="${esc(e.id)}" aria-pressed="${p}" aria-label="${p ? 'Ta bort påminnelse' : 'Påminn mig'}">${klockIkon}</button>
    </article>`;
  }

  function dagRubrik(nyckel) {
    const idag = idagNyckel();
    const etikett = nyckel === idag ? '<span class="idag">Idag</span>' : nyckel === laggTillDagar(idag, 1) ? '<span class="idag">Imorgon</span>' : '';
    return `<div class="dag-rubrik"><h3>${stor(fDagLang.format(utcDag(nyckel)))}</h3>${etikett}</div>`;
  }

  function gruppera(lista) {
    const dagar = new Map();
    for (const e of lista) {
      if (!dagar.has(e.datum)) dagar.set(e.datum, []);
      dagar.get(e.datum).push(e);
    }
    return dagar;
  }

  // ---------- Vy: Tablå ----------
  function ritaTabla() {
    const alla = filtrerade();
    if (!alla.length) return tomt('Inga sändningar matchar filtret', 'Tryck på ett valt filter för att avmarkera det.');
    const visaGamla = st.visaPasserade || st.visaTidigare;
    const lista = visaGamla ? alla : alla.filter((e) => !arPasserad(e));
    const antalGamla = alla.length - lista.length;
    let html = installBanner();
    if (antalGamla && !visaGamla) {
      html += `<button class="knapp liten visa-tidigare" id="visaTidigare">Visa ${antalGamla} tidigare sändningar</button>`;
    }
    if (!lista.length) {
      html += '<div class="tomt"><b>Säsongen är slut</b>Inga fler sändningar i den här säsongen.</div>';
    }
    for (const [dag, ev] of gruppera(lista)) {
      html += `<section class="dag" data-dag="${dag}">${dagRubrik(dag)}<div class="lista">${ev.map(kortHtml).join('')}</div></section>`;
    }
    $('#innehall').innerHTML = html;
    if ($('#bannerInstall')) {
      $('#bannerInstall').onclick = installera;
      $('#bannerStang').onclick = () => { lagra.spara('installDold', true); $('.install-banner').remove(); toast('Du hittar installationen under Inställningar'); };
    }
    const knapp = $('#visaTidigare');
    if (knapp) knapp.onclick = () => { st.visaTidigare = true; rita(); scrollTillIdag(); };
  }

  function scrollTillIdag() {
    const idag = idagNyckel();
    const dagar = [...document.querySelectorAll('.dag')];
    const mal = dagar.find((d) => d.dataset.dag >= idag);
    if (mal && dagar.indexOf(mal) > 0) {
      const y = mal.getBoundingClientRect().top + scrollY - $('.topp').offsetHeight - 4;
      scrollTo({ top: y });
    }
  }

  // ---------- Vy: Kalender ----------
  function ritaKalender() {
    const lista = filtrerade();
    const idag = idagNyckel();
    const forsta = st.handelser[0]?.datum.slice(0, 7);
    const sista = st.handelser[st.handelser.length - 1]?.datum.slice(0, 7);
    if (!st.kalManad) {
      const nu = idag.slice(0, 7);
      st.kalManad = nu >= forsta && nu <= sista ? nu : forsta;
    }
    const [y, m] = st.kalManad.split('-').map(Number);
    const forstaDag = new Date(Date.UTC(y, m - 1, 1));
    const offset = (forstaDag.getUTCDay() + 6) % 7; // måndag först
    const startNyckel = laggTillDagar(`${st.kalManad}-01`, -offset);
    const perDag = gruppera(lista);

    let rutor = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'].map((d) => `<div class="vd">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const nyckel = laggTillDagar(startNyckel, i);
      if (i >= 35 && nyckel.slice(0, 7) !== st.kalManad) break;
      const ev = perDag.get(nyckel) || [];
      const klasser = ['ruta', nyckel.slice(0, 7) !== st.kalManad && 'annan', nyckel === idag && 'idag', nyckel === st.kalDag && 'vald'].filter(Boolean).join(' ');
      const prickar = ev.slice(0, 8).map((e) => `<i style="--c:${serie(e).farg}"></i>`).join('');
      const etiketter = ev.slice(0, 3).map((e) => `<span style="--c:${serie(e).farg}">${e.start ? visaTid(e.start) + ' ' : ''}${esc(serie(e).kort)} ${esc(e.gren.split(',')[0])}</span>`).join('')
        + (ev.length > 3 ? `<span style="--c:transparent">+${ev.length - 3} till</span>` : '');
      rutor += `<button class="${klasser}" data-dag="${nyckel}" aria-label="${fDagLang.format(utcDag(nyckel))}, ${ev.length} sändningar">
        <span class="nr">${Number(nyckel.slice(8))}</span><span class="prickar">${prickar}</span><span class="etiketter">${etiketter}</span></button>`;
    }

    const anvanda = [...new Set(lista.map((e) => e.serie))];
    const forklaring = anvanda.map((id) => `<span><i style="--c:${st.konfig.serier[id]?.farg}"></i>${esc(st.konfig.serier[id]?.namn || id)}</span>`).join('');

    let dagHtml = '';
    if (st.kalDag) {
      const ev = perDag.get(st.kalDag) || [];
      dagHtml = `<section class="kal-dag">${dagRubrik(st.kalDag)}<div class="lista">${ev.length ? ev.map(kortHtml).join('') : '<p class="hjalp">Inga sändningar den här dagen.</p>'}</div></section>`;
    }

    $('#innehall').innerHTML = `
      <div class="kal-huvud">
        <h3>${stor(fManad.format(utcDag(st.kalManad + '-15')))}</h3>
        <div class="kal-nav">
          <button class="ikonknapp" id="kalForra" aria-label="Föregående månad" ${st.kalManad <= forsta ? 'disabled' : ''}>‹</button>
          <button class="ikonknapp" id="kalNasta" aria-label="Nästa månad" ${st.kalManad >= sista ? 'disabled' : ''}>›</button>
        </div>
      </div>
      <div class="kal">${rutor}</div>
      <div class="forklaring">${forklaring}</div>
      ${dagHtml || '<p class="hjalp">Tryck på en dag för att se sändningarna.</p>'}`;

    const flytta = (n) => {
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      st.kalManad = d.toISOString().slice(0, 7);
      st.kalDag = null;
      ritaKalender();
    };
    $('#kalForra').onclick = () => flytta(-1);
    $('#kalNasta').onclick = () => flytta(1);
    $('.kal').onclick = (ev) => {
      const r = ev.target.closest('.ruta');
      if (!r) return;
      st.kalDag = r.dataset.dag;
      if (st.kalDag.slice(0, 7) !== st.kalManad) st.kalManad = st.kalDag.slice(0, 7);
      ritaKalender();
      const sek = $('.kal-dag');
      if (sek && innerWidth < 760) sek.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  // ---------- Vy: Påminnelser ----------
  function ritaMina() {
    const mina = st.handelser.filter((e) => st.paminn.has(e.id));
    const kommande = mina.filter((e) => !arPasserad(e));
    let html = `<div class="mina-topp">
      <h3>Dina påminnelser</h3>
      <p>Tryck på klockan 🔔 vid en sändning för att spara den här. Lägg sedan in dem i mobilens kalender – då får du ett larm ${st.forvarning >= 60 ? st.forvarning / 60 + ' tim' : st.forvarning + ' min'} före start, även när sidan är stängd.</p>
      <div class="knapprad">
        <button class="knapp primar" id="exportMina" ${kommande.length ? '' : 'disabled'}>📅 Lägg ${kommande.length || ''} i kalendern</button>
        <button class="knapp" id="exportFilter">Exportera allt i filtret</button>
      </div>
    </div>`;
    if (!mina.length) {
      html += '<div class="tomt"><b>Inga påminnelser ännu</b>Gå till Tablå eller Kalender och tryck på klockan vid en sändning.</div>';
    } else {
      for (const [dag, ev] of gruppera(mina)) {
        html += `<section class="dag">${dagRubrik(dag)}<div class="lista">${ev.map(kortHtml).join('')}</div></section>`;
      }
    }
    $('#innehall').innerHTML = html;
    $('#exportMina').onclick = () => laddaNerIcs(kommande, 'skidor-paminnelser.ics');
    $('#exportFilter').onclick = () => {
      const lista = filtrerade().filter((e) => !arPasserad(e));
      if (!lista.length) return toast('Inget att exportera');
      if (confirm(`Lägga ${lista.length} sändningar i kalendern på en gång?`)) laddaNerIcs(lista, 'skidor-tabla.ics');
    };
  }

  function tomt(rubrik, text) {
    $('#innehall').innerHTML = `<div class="tomt"><b>${esc(rubrik)}</b>${esc(text)}</div>`;
  }

  // ---------- Rita ----------
  function rita() {
    document.querySelectorAll('.flikar button').forEach((b) => b.setAttribute('aria-selected', b.dataset.vy === st.vy));
    const n = st.handelser.filter((e) => st.paminn.has(e.id) && !arPasserad(e)).length;
    const r = $('#minaAntal');
    r.hidden = !n; r.textContent = n;
    if (st.vy === 'kalender') ritaKalender();
    else if (st.vy === 'mina') ritaMina();
    else ritaTabla();
  }

  document.querySelector('.flikar').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    st.vy = b.dataset.vy;
    history.replaceState(null, '', '#' + st.vy);
    rita();
    scrollTo({ top: 0 });
    if (st.vy === 'tabla') scrollTillIdag();
  });

  // Klick i listor: klocka eller öppna detaljer
  $('#innehall').addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-paminn]');
    if (k) { ev.stopPropagation(); vaxlaPaminn(k.dataset.paminn); return; }
    const kort = ev.target.closest('.kort');
    if (kort) visaDetalj(kort.dataset.id);
  });
  $('#innehall').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.classList.contains('kort')) visaDetalj(ev.target.dataset.id);
  });

  function vaxlaPaminn(id) {
    if (st.paminn.has(id)) { st.paminn.delete(id); toast('Påminnelse borttagen'); }
    else { st.paminn.add(id); toast('Sparad under Påminnelser 🔔'); }
    lagra.spara('paminn', [...st.paminn]);
    const y = scrollY;
    rita();
    scrollTo({ top: y });
  }

  // ---------- Detaljer ----------
  function visaDetalj(id) {
    const e = st.handelser.find((x) => x.id === id);
    if (!e) return;
    const s = serie(e);
    const p = st.paminn.has(e.id);
    const tid = e.start ? `${visaTid(e.start)}${e.slut ? '–' + visaTid(e.slut) : ''} (svensk tid)` : 'Ej klar ännu';
    $('#detaljInre').innerHTML = `
      <div class="ark-huvud">
        <div class="overrad detalj-overrad" style="--c:${s.farg}">${esc(sportNamn(e))} · ${esc(s.namn)}</div>
        <button class="ikonknapp" id="stangDetalj" aria-label="Stäng">✕</button>
      </div>
      <div class="detalj-titel">${esc(rubrik(e))}</div>
      <div class="kanaler">${kanalHtml(e)}</div>
      <dl class="detalj-fakta">
        <dt>Datum</dt><dd>${stor(fDagLang.format(utcDag(e.datum)))}</dd>
        <dt>Tid</dt><dd>${tid}</dd>
        <dt>Plats</dt><dd>${flagga(e)} ${esc(e.ort)}</dd>
        ${e.klass ? `<dt>Klass</dt><dd>${esc(klassNamn(e))}</dd>` : ''}
      </dl>
      ${e.notering ? `<div class="notis">${esc(e.notering)}</div>` : ''}
      <div class="detalj-knappar">
        <button class="knapp ${p ? '' : 'primar'}" id="dPaminn">${p ? '🔕 Ta bort påminnelse' : '🔔 Påminn mig'}</button>
        <button class="knapp" id="dIcs">📅 Lägg i mobilens kalender</button>
        <a class="knapp" target="_blank" rel="noopener" href="${googleLank(e)}">Lägg i Google Kalender</a>
      </div>`;
    const dlg = $('#detalj');
    $('#stangDetalj').onclick = () => dlg.close();
    $('#dPaminn').onclick = () => { vaxlaPaminn(e.id); visaDetalj(e.id); };
    $('#dIcs').onclick = () => laddaNerIcs([e], `${e.id}.ics`);
    if (!dlg.open) dlg.showModal();
  }
  // Stäng dialog vid klick utanför
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
  }

  // ---------- Kalenderfiler (.ics) ----------
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lokal = (datum, tid) => datum.replace(/-/g, '') + 'T' + tid.replace(':', '') + '00';
  function vika(rad) { // radbrytning enligt standarden (max 75 tecken)
    const ut = [];
    while (rad.length > 73) { ut.push(rad.slice(0, 73)); rad = ' ' + rad.slice(73); }
    ut.push(rad);
    return ut.join('\r\n');
  }
  function beskrivning(e) {
    return [
      `${sportNamn(e)} – ${serie(e).namn}`,
      `${rubrik(e)}${e.klass ? ' · ' + klassNamn(e) : ''}`,
      `Kanal: ${e.kanal?.length ? e.kanal.join(', ') : 'ej klar'}`,
      e.start ? '' : 'Sändningstid ej klar – kolla tablån närmare inpå.',
      e.notering || ''
    ].filter(Boolean).join('\n');
  }
  function skapaIcs(lista) {
    const nu = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const rader = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Skidor på TV//SV', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:Skidor på TV', 'X-WR-TIMEZONE:Europe/Stockholm',
      'BEGIN:VTIMEZONE', 'TZID:Europe/Stockholm',
      'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
      'END:VTIMEZONE'
    ];
    for (const e of lista) {
      rader.push('BEGIN:VEVENT', `UID:${e.id}@skidor`, `DTSTAMP:${nu}`);
      if (e.start) {
        const slutD = slutTid(e);
        const slutNyckel = dagNyckel(slutD);
        const slutKl = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(slutD);
        rader.push(`DTSTART;TZID=${TZ}:${lokal(e.datum, e.start)}`, `DTEND;TZID=${TZ}:${lokal(slutNyckel, slutKl)}`);
      } else {
        rader.push(`DTSTART;VALUE=DATE:${e.datum.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${laggTillDagar(e.datum, 1).replace(/-/g, '')}`);
      }
      rader.push(
        `SUMMARY:${icsText((e.kanal?.length ? '📺 ' : '') + kortNamn(e))}`,
        `LOCATION:${icsText((e.kanal?.length ? e.kanal.join(', ') + ' – ' : '') + e.ort)}`,
        `DESCRIPTION:${icsText(beskrivning(e))}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(kortNamn(e))}`,
        // Med tid: X min före. Utan tid: kl 08.00 samma dag.
        e.start ? `TRIGGER:-PT${st.forvarning}M` : 'TRIGGER:PT8H',
        'END:VALARM', 'END:VEVENT'
      );
    }
    rader.push('END:VCALENDAR');
    return rader.map(vika).join('\r\n') + '\r\n';
  }
  function laddaNerIcs(lista, filnamn) {
    if (!lista.length) return toast('Inget att lägga till');
    const blob = new Blob([skapaIcs(lista)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filnamn;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Öppna filen för att lägga in i kalendern');
  }
  function googleLank(e) {
    let datum;
    if (e.start) {
      const slutD = slutTid(e);
      const kl = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(slutD);
      datum = `${lokal(e.datum, e.start)}/${lokal(dagNyckel(slutD), kl)}`;
    } else {
      datum = `${e.datum.replace(/-/g, '')}/${laggTillDagar(e.datum, 1).replace(/-/g, '')}`;
    }
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: kortNamn(e), dates: datum, ctz: TZ,
      details: beskrivning(e), location: (e.kanal || []).join(', ')
    });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }

  // ---------- Aviseringar i webbläsaren (när sidan är öppen) ----------
  async function kollaAviseringar() {
    if (!st.notiser || !('Notification' in window) || Notification.permission !== 'granted') return;
    const nu = Date.now();
    for (const e of st.handelser) {
      if (!e.start || !st.paminn.has(e.id) || st.aviserade.has(e.id)) continue;
      const start = startTid(e).getTime();
      if (nu >= start - st.forvarning * 60e3 && nu < start + 30 * 60e3) {
        st.aviserade.add(e.id);
        lagra.spara('aviserade', [...st.aviserade]);
        const titel = `${visaTid(e.start)} ${e.kanal?.join('/') || ''}`.trim();
        const opt = { body: kortNamn(e), tag: e.id, icon: 'icon-192.png' };
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          reg ? reg.showNotification(titel, opt) : new Notification(titel, opt);
        } catch { /* ignoreras */ }
      }
    }
  }
  setInterval(kollaAviseringar, 30e3);


  // ---------- Installera som app ----------
  let installPrompt = null;
  const arInstallerad = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const arIOS = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const arAndroid = /android/i.test(ua);
  const arMobil = arIOS || arAndroid;
  const delaIkon = '<span class="sym"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/></svg></span>';
  const plusIkon = '<span class="sym"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg></span>';
  const menyIkon = '<span class="sym"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg></span>';

  addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    installPrompt = ev;
    ritaInstall();
    if (st.vy === 'tabla' && st.handelser.length) { const y = scrollY; rita(); scrollTo({ top: y }); }
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('Appen är installerad – hitta den på hemskärmen ⛷️');
    ritaInstall();
  });

  async function installera() {
    if (installPrompt) {
      installPrompt.prompt();
      const val = await installPrompt.userChoice;
      installPrompt = null;
      if (val.outcome !== 'accepted') toast('Du kan installera senare under Inställningar');
      ritaInstall(); rita();
      return;
    }
    oppnaInst();
    setTimeout(() => $('#installera').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function ritaInstall() {
    const el = $('#installInnehall');
    if (!el) return;
    const kort = (text) => `<div class="install-kort"><img src="icon.svg" alt=""><p><b>Skidor på TV</b>${text}</p></div>`;
    if (arInstallerad()) {
      el.innerHTML = kort('✓ Du använder redan appen.');
      return;
    }
    if (installPrompt) {
      el.innerHTML = kort('Lägg sidan som en app på hemskärmen – öppnas i helskärm och fungerar även utan nät.') +
        '<button type="button" class="knapp primar" id="installKnapp" style="width:100%;margin-top:10px">Installera appen</button>';
      $('#installKnapp').onclick = installera;
      return;
    }
    let steg;
    if (arIOS) {
      steg = `<ol class="steg">
        <li>Öppna sidan i <b>Safari</b> (fungerar även i Chrome på nyare iPhone).</li>
        <li>Tryck på <b>Dela</b>-knappen ${delaIkon} – i Safari längst ner i mitten (på iPad uppe till höger).</li>
        <li>Scrolla ner i listan och tryck på <b>Lägg till på hemskärmen</b> ${plusIkon}.</li>
        <li>Tryck på <b>Lägg till</b> uppe till höger. Nu ligger ikonen bland dina appar.</li>
      </ol>`;
    } else if (arAndroid) {
      steg = `<ol class="steg">
        <li>Öppna sidan i <b>Chrome</b>.</li>
        <li>Tryck på menyn ${menyIkon} uppe till höger.</li>
        <li>Tryck på <b>Installera app</b> (kan heta <b>Lägg till på startskärmen</b>).</li>
        <li>Tryck på <b>Installera</b> i rutan som dyker upp.</li>
      </ol>`;
    } else {
      steg = `<ol class="steg">
        <li>Öppna sidan i <b>Chrome</b> eller <b>Edge</b>.</li>
        <li>Klicka på installationsikonen ${plusIkon} längst till höger i adressfältet (eller menyn ${menyIkon} → <b>Installera Skidor på TV</b>).</li>
        <li>Klicka på <b>Installera</b>.</li>
      </ol>`;
    }
    el.innerHTML = kort('Lägg sidan som en app – öppnas i helskärm och fungerar även utan nät.') + steg;
  }

  function installBanner() {
    if (arInstallerad() || lagra.hamta('installDold', false)) return '';
    if (!installPrompt && !arMobil) return '';
    return `<div class="install-banner">
      <img src="icon.svg" alt="">
      <div><b>Installera som app</b>Snabbt från hemskärmen, i helskärm.</div>
      <button class="knapp liten primar" id="bannerInstall">${installPrompt ? 'Installera' : 'Visa hur'}</button>
      <button class="stang" id="bannerStang" aria-label="Dölj">✕</button>
    </div>`;
  }

  // ---------- Inställningar ----------
  function tillampaTema(t) {
    if (t === 'ljus') document.documentElement.dataset.theme = 'light';
    else if (t === 'mork') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
  }
  function oppnaInst() {
    let tema = 'auto';
    try { tema = localStorage.getItem(LS + 'tema') || 'auto'; } catch { /* ignoreras */ }
    document.querySelectorAll('input[name="tema"]').forEach((r) => { r.checked = r.value === tema; });
    $('#forvarning').value = String(st.forvarning);
    $('#visaPasserade').checked = st.visaPasserade;
    $('#baraTid').checked = st.baraTid;
    $('#notiser').checked = st.notiser && ('Notification' in window) && Notification.permission === 'granted';
    const upd = st.sasong?.uppdaterad;
    $('#datainfo').textContent = `Säsong ${st.sasong?.sasong || ''} · ${st.handelser.length} sändningar/tävlingar${upd ? ' · data uppdaterad ' + fDagKort.format(utcDag(upd)).replace(/\.$/, '') : ''}. Alla tider är svensk tid.`;
    $('#kallor').innerHTML = (st.sasong?.kallor || []).map((k) => `<li><a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.namn)}</a></li>`).join('');
    ritaInstall();
    if (!$('#inst').open) $('#inst').showModal();
  }
  $('#oppnaInst').onclick = oppnaInst;
  $('#temaVal').addEventListener('change', (ev) => {
    // Sparas som ren text så att skriptet i <head> kan läsa det direkt
    try { localStorage.setItem(LS + 'tema', ev.target.value); } catch { /* ignoreras */ }
    tillampaTema(ev.target.value);
  });
  $('#forvarning').onchange = (ev) => { st.forvarning = Number(ev.target.value); lagra.spara('forvarning', st.forvarning); rita(); };
  $('#visaPasserade').onchange = (ev) => { st.visaPasserade = ev.target.checked; lagra.spara('visaPasserade', st.visaPasserade); rita(); };
  $('#baraTid').onchange = (ev) => { st.baraTid = ev.target.checked; lagra.spara('baraTid', st.baraTid); rita(); };
  $('#notiser').onchange = async (ev) => {
    if (ev.target.checked) {
      if (!('Notification' in window)) { ev.target.checked = false; return toast('Din webbläsare stöder inte aviseringar'); }
      const svar = await Notification.requestPermission();
      if (svar !== 'granted') { ev.target.checked = false; return toast('Aviseringar nekades i webbläsaren'); }
    }
    st.notiser = ev.target.checked;
    lagra.spara('notiser', st.notiser);
    kollaAviseringar();
  };
  $('#rensa').onclick = () => {
    if (!st.paminn.size) return toast('Du har inga påminnelser');
    if (!confirm(`Ta bort alla ${st.paminn.size} påminnelser? Det går inte att ångra.`)) return;
    st.paminn.clear();
    lagra.spara('paminn', []);
    rita();
    toast('Alla påminnelser borttagna');
  };

  // ---------- Säsongsväljare ----------
  $('#sasong').onchange = async (ev) => {
    await laddaSasong(ev.target.value);
    ritaFilter(); rita(); scrollTillIdag();
  };

  // Höjd på sidhuvudet → dagrubriker fastnar under det
  const satHojd = () => document.documentElement.style.setProperty('--topphojd', $('.topp').offsetHeight + 'px');
  addEventListener('resize', satHojd);

  // ---------- Start ----------
  async function start() {
    try {
      st.konfig = await hamtaJson('data/sasonger.json');
      const sparad = lagra.hamta('sasong', null);
      const id = st.konfig.sasonger.some((s) => s.id === sparad) ? sparad : st.konfig.standard;
      $('#sasong').innerHTML = st.konfig.sasonger.map((s) => `<option value="${s.id}">${esc(s.namn)}</option>`).join('');
      await laddaSasong(id);
      $('#sasong').value = st.sasongId;
      ritaFilter();
      satHojd();
      rita();
      if (st.vy === 'tabla') scrollTillIdag();
      $('#fot').innerHTML = `Alla tider är svensk tid. Tider och kanaler kan ändras – kolla gärna kanalens egen tablå. Källor finns under Inställningar.`;
      kollaAviseringar();
      setInterval(() => { if (!document.querySelector('dialog[open]')) { const y = scrollY; rita(); scrollTo({ top: y }); } }, 60e3);
    } catch (fel) {
      console.error(fel);
      tomt('Kunde inte ladda tablån', 'Kontrollera internetanslutningen och ladda om sidan.');
    }
  }
  start();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
