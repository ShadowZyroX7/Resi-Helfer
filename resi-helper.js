// ReSi-Helfer – Hauptskript (wird vom Lader im Seitenkontext ausgeführt)
(function () {
  'use strict';
  if (window.__resiHelfer) return; // nicht doppelt laden
  window.__resiHelfer = true;

  const isMainPage = window.top === window && !!document.getElementById('departments');
  const isMissionFrame = /^\/mission\/\d+/.test(location.pathname) && !!document.querySelector('.detail-title[missionid]');
  const isDepartmentFrame = /^\/department\/\d+/.test(location.pathname) && !!document.getElementById('countUserPersonals');
  const isMissionNewFrame = /^\/missionNew\/\d+/.test(location.pathname) && !!document.getElementById('newMissionNameInput');
  if (!isMainPage && !isMissionFrame && !isDepartmentFrame && !isMissionNewFrame) return;

  console.log('[ReSi-Helfer] geladen:', isMainPage ? 'Leitstelle' : isMissionFrame ? 'Einsatzfenster'
    : isMissionNewFrame ? 'Einsatz anlegen' : 'Wache');

  // =====================================================================
  // Einstellungen (im Browser gespeichert)
  // =====================================================================
  const SETTINGS_KEY = 'resiHelfer.settings';
  const DEFAULTS = {
    statusbar: true,
    s5Sound: true,
    s5Title: true,
    callSound: true,
    callDesktop: false,
    countdown: true,
    missionColors: true,
    volume: 0.4,
    missionBox: true,        // Infobox "benötigte Fahrzeuge" im Einsatzfenster
    listOnlyFree: false,     // Fahrzeugliste: nur S1/S2
    listOnlyNeeded: false,   // Fahrzeugliste: nur Fahrzeuge, die noch fehlen
    listBar: true,           // Filterleiste über der Fahrzeugliste anzeigen
    listMaxKm: 0,            // Fahrzeugliste: max. Entfernung in km (0 = alle)
    missionInfo: true,       // Einsatzliste: Vergütung
    missionSortBar: true,    // Sortier-Auswahl über der Einsatzliste
    missionSort: 'default',  // default | unalarmed | time | credits | distance
    sharedMine: true,        // Freigaben: Symbol mit Anzahl eigener alarmierter Fahrzeuge
    sharedEnough: 4,         // ab so vielen eigenen Fahrzeugen gilt eine Freigabe als versorgt
    mapBorders: true,        // Karte: Grenzen anzeigen
    mapDistricts: true,      //   … Landkreise
    mapStates: true,         //   … Bundesländer
    headerStats: true,       // Statistik-Leiste in der Kopfzeile
    countdownSoon: 30,       // Countdown wird ab so vielen Sekunden grün
    statusShowAll: false,    // Statusleiste: auch leere Status 5–8 zeigen
    tabCounters: true,       // Zähler an den Reitern Einsätze/Freigaben
    personnel: true,         // Personal pro Wache
    hotkeys: true,           // Tastenkürzel im Einsatzfenster und beim Einsatz anlegen
    missionNewFocus: true,   // Einsatz anlegen: Cursor direkt ins Einsatzstichwort
    buildingNotes: true,     // eigene Notizen an Wachen
    keys: {                  // frei belegbare Tasten
      alarm: 'Enter',
      alarmClose: 'Shift+Enter',
      share: 'F',
      shareClose: 'Shift+F',
      create: 'Ctrl+Enter',
      createOpen: 'Ctrl+Shift+Enter',
      prevMission: 'A',
      nextMission: 'D',
    },
  };
  const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  settings.keys = Object.assign({}, DEFAULTS.keys, settings.keys || {}); // neue Aktionen ergänzen
  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  // =====================================================================
  // Tastenkürzel (gemeinsam für alle Fenster)
  // =====================================================================
  const KEY_ACTIONS = [
    ['alarm',      'Alarmieren',               'Einsatzfenster'],
    ['alarmClose', 'Alarmieren & Schließen',   'Einsatzfenster'],
    ['share',      'Freigeben',                'Einsatzfenster'],
    ['shareClose', 'Freigeben & Schließen',    'Einsatzfenster'],
    ['create',     'Anlegen',                  'Einsatz anlegen'],
    ['createOpen', 'Anlegen & öffnen',         'Einsatz anlegen'],
    ['prevMission', 'Vorheriger Einsatz',      'Einsatzfenster – springt in der Einsatzliste nach oben'],
    ['nextMission', 'Nächster Einsatz',        'Einsatzfenster – springt in der Einsatzliste nach unten'],
  ];
  // "Ctrl+Shift+Enter" aus einem Tastendruck; Buchstaben/Ziffern unabhängig von Shift
  function comboFromEvent(e) {
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
    let k = e.code?.startsWith('Key') ? e.code.slice(3)
      : e.code?.startsWith('Digit') ? e.code.slice(5)
      : e.key === ' ' ? 'Space' : e.key;
    if (k.length === 1) k = k.toUpperCase();
    return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
  }
  const prettyCombo = c => c ? c.replace('Ctrl', 'Strg').replace('Shift', '⇧').split('+').map(p => `<kbd>${p}</kbd>`).join('+') : '<em>keine</em>';
  const isTypingEl = el => !!el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  // Kürzel ohne Strg/Alt werden beim Tippen in Textfeldern ignoriert
  const needsFreeFocus = c => !/^(Ctrl|Alt)\+/.test(c);

  // =====================================================================
  // Hilfsfunktionen
  // =====================================================================
  function observe(el, fn, opts) {
    if (!el) return;
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; fn(); });
    }).observe(el, Object.assign({ subtree: true, childList: true }, opts));
  }

  // Symbole aus der Font-Awesome-Bibliothek des Spiels – damit sie genauso aussehen wie die Spiel-Symbole
  const faIcon = name => `<i class="fas fa-${name}"></i>`;
  const renderFa = node => { try { window.FontAwesome?.dom?.i2svg({ node }); } catch (e) { /* Symbole fehlen dann nur */ } };

  // Töne ohne Audiodateien (Web Audio)
  let audioCtx = null;
  function beep(pattern) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      let t = audioCtx.currentTime;
      for (const [freq, dur, pause] of pattern) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(settings.volume, t + 0.01);
        gain.gain.linearRampToValueAtTime(0, t + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        t += dur + (pause || 0.05);
      }
    } catch (e) { console.warn('[ReSi-Helfer] Ton fehlgeschlagen', e); }
  }
  const SOUND_S5 = [[880, 0.12], [660, 0.12], [880, 0.12], [660, 0.18]];
  const SOUND_CALL = [[523, 0.15, 0.08], [784, 0.25]];
  // Browser erlauben Ton erst nach einer Interaktion -> beim ersten Klick freischalten
  document.addEventListener('pointerdown', () => {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });

  // Tab-Titel blinken lassen
  const baseTitle = document.title;
  let titleAlert = null, titleTimer = null;
  function setTitleAlert(text) {
    titleAlert = text;
    clearInterval(titleTimer);
    if (!text) { document.title = baseTitle; return; }
    let on = false;
    titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? text : baseTitle;
    }, 900);
  }

  if (isMissionFrame) { runMissionFrame(); return; }
  if (isDepartmentFrame) { runDepartmentFrame(); return; }
  if (isMissionNewFrame) { runMissionNewFrame(); return; }

  // =====================================================================
  // CSS
  // =====================================================================
  const css = document.createElement('style');
  css.textContent = `
    #rh-statusbar { display:flex; gap:4px; flex-wrap:wrap; align-items:center; padding:4px 10px 6px; }
    #rh-statusbar .rh-s { cursor:pointer; border-radius:4px; padding:1px 6px; font-size:12px;
      font-weight:bold; color:#fff; opacity:.9; user-select:none; }
    #rh-statusbar .rh-s:hover { opacity:1; }
    #rh-statusbar .rh-s.rh-active { outline:2px solid #fff; }
    #rh-statusbar .rh-s.rh-zero { opacity:.35; }
    .rh-hidden { display:none !important; }

    .rh-cd { display:inline-block; margin-left:6px; padding:0 5px; border-radius:3px; font-size:11px;
      font-weight:bold; background:rgba(0,0,0,.35); color:#fff; vertical-align:middle; }
    .rh-cd.rh-cd-soon { background:#2e9e44; }

    .mission-list-mission[data-rh-cat] { border-left:4px solid transparent; }
    .mission-list-mission[data-rh-cat="brand"]   { border-left-color:#e03131; }
    .mission-list-mission[data-rh-cat="thl"]     { border-left-color:#1c7ed6; }
    .mission-list-mission[data-rh-cat="rd"]      { border-left-color:#f08c00; }
    .mission-list-mission[data-rh-cat="polizei"] { border-left-color:#2f9e44; }
    body.rh-no-colors .mission-list-mission[data-rh-cat] { border-left-color:transparent; }

    #radio-container-s5 .radio-vehicle-message { animation: rh-pulse 1s ease-in-out infinite; }
    @keyframes rh-pulse { 50% { box-shadow: 0 0 0 3px #b02ad1; } }

    /* Einsatzinfos in der Einsatzliste */
    .rh-minfo { display:flex; flex-wrap:wrap; align-items:center; gap:3px; margin-top:3px; font-size:10.5px; line-height:1.5; }
    .rh-minfo .rh-mi-coin { color:#ffd43b; font-weight:600; margin-right:3px; font-variant-numeric:tabular-nums; }

    /* Wachen-Notizen */
    .rh-note-btn { display:inline-flex; align-items:center; margin-right:7px; cursor:pointer; opacity:.7; vertical-align:middle; }
    .rh-note-btn:hover { opacity:1; }
    .rh-note-btn.rh-has { opacity:1; color:#ffd43b; }
    .rh-bnote { margin:4px 8px 2px; padding:4px 8px; font-size:11.5px; line-height:1.4; color:#fff; white-space:pre-wrap;
      background:rgba(255,212,59,.08); border-left:3px solid #ffd43b; border-radius:0 4px 4px 0; cursor:pointer; }
    #rh-note-pop { position:fixed; z-index:100000; width:280px; background:#282c35; border:1px solid rgba(255,255,255,.14); border-radius:10px;
      box-shadow:0 12px 32px rgba(0,0,0,.55); color:#fff; font-size:13px; overflow:hidden; animation:rh-pop .12s ease-out; }
    #rh-note-pop .rh-np-head { padding:9px 12px; font-weight:600; border-bottom:1px solid rgba(255,255,255,.07); display:flex; gap:8px; align-items:center; }
    #rh-note-pop .rh-np-head small { color:#868e96; font-weight:400; }
    #rh-note-pop textarea { display:block; width:100%; box-sizing:border-box; min-height:90px; resize:vertical; border:0; outline:0;
      padding:10px 12px; background:#21242b; color:#fff; font:inherit; }
    #rh-note-pop .rh-np-foot { display:flex; gap:6px; align-items:center; padding:8px 12px; border-top:1px solid rgba(255,255,255,.07); }
    #rh-note-pop .rh-np-foot span { flex:1; font-size:11px; color:#6c757d; }
    #rh-note-pop button { cursor:pointer; border:1px solid rgba(255,255,255,.14); background:transparent; color:#ced4da; border-radius:6px; padding:3px 10px; font-size:12px; }
    #rh-note-pop button.rh-primary { background:#28a745; border-color:#28a745; color:#fff; font-weight:600; }
    /* ---- Rettungssimulator-Design ---- */
    #rh-note-pop { background:#282c35; border:0; border-radius:15px; box-shadow:0 3px 3px rgba(0,0,0,.13), 0 12px 34px rgba(0,0,0,.45); }
    #rh-note-pop .rh-np-head { background:#DB1111; border-bottom:0; padding:6px 12px; }
    #rh-note-pop .rh-np-head small { color:rgba(255,255,255,.8); }
    #rh-note-pop textarea { background:#21242b; }
    #rh-note-pop .rh-np-foot { border-top:0; }
    #rh-note-pop button { border:2px solid #b1b1b1; background:transparent; color:#b1b1b1; border-radius:100px; font:700 12px Arial, sans-serif; padding:3px 12px; }
    #rh-note-pop button:hover { border-color:#fff; color:#fff; }
    #rh-note-pop button.rh-primary { border-color:#28a745; color:#28a745; background:transparent; }
    #rh-note-pop button.rh-primary:hover { background:#28a745; color:#fff; }
    @keyframes rh-pop { from { opacity:0; transform:translateY(-4px); } }

  `;
  document.head.appendChild(css);

  // =====================================================================
  // 1) Statusleiste über "Wachen & Gebäude"
  // =====================================================================
  const COLORS = { 1:'#2196F3', 2:'#28a745', 3:'#FFB300', 4:'#DB1111', 5:'#b02ad1', 6:'#5a5a5a', 7:'#DB115C', 8:'#7A11DB' };
  const LABELS = { 1:'frei über Funk', 2:'auf Wache', 3:'Anfahrt', 4:'am Einsatzort', 5:'Sprechwunsch', 6:'außer Dienst', 7:'Patient aufgenommen', 8:'am Transportziel' };

  const departments = document.getElementById('departments');
  const bar = document.createElement('div');
  bar.id = 'rh-statusbar';
  departments.querySelector('.panel-headline').after(bar);
  let filter = null;

  function vehicleStatus(el) {
    const m = el.querySelector('.vehicle-status')?.className.match(/\bs(\d+)\b/);
    return m ? +m[1] : null;
  }

  function renderStatusbar() {
    const counts = {};
    departments.querySelectorAll('.vehicle[uservehicleid]').forEach(v => {
      const s = vehicleStatus(v);
      if (s != null) counts[s] = (counts[s] || 0) + 1;
      v.classList.toggle('rh-hidden', settings.statusbar && filter != null && s !== filter);
    });
    const chips = !settings.statusbar ? '' : [1, 2, 3, 4, 5, 6, 7, 8]
      .filter(s => counts[s] || s <= 4 || settings.statusShowAll)
      .map(s => `<span class="rh-s${filter === s ? ' rh-active' : ''}${counts[s] ? '' : ' rh-zero'}"
                  data-s="${s}" title="Status ${s}: ${LABELS[s] || ''} – klicken zum Filtern"
                  style="background:${COLORS[s] || '#777'}">S${s}: ${counts[s] || 0}</span>`).join('');
    bar.innerHTML = chips;
  }

  bar.addEventListener('click', e => {
    const s = +e.target.closest('.rh-s')?.dataset.s;
    if (!s) return;
    filter = filter === s ? null : s;
    renderStatusbar();
  });
  // =====================================================================
  // 1b) Notizen an Wachen
  // =====================================================================
  const NOTES_KEY = 'resiHelfer.buildingNotes';
  const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
  const NOTE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><path d="M8 13h8M8 17h5"/></svg>`;

  function decorateBuildings() {
    departments.querySelectorAll('.card[userdepartmentid]').forEach(card => {
      const id = card.getAttribute('userdepartmentid');
      const head = card.querySelector('.card-headline');
      const tools = head?.querySelector('.card-tools');
      let btn = tools?.querySelector('.rh-note-btn');
      let line = card.querySelector('.rh-bnote');
      if (!settings.buildingNotes) { btn?.remove(); line?.remove(); return; }
      if (tools && !btn) {
        btn = document.createElement('span');
        btn.className = 'rh-note-btn';
        btn.innerHTML = NOTE_ICON;
        tools.insertBefore(btn, tools.firstChild);
      }
      const text = notes[id] || '';
      if (btn) {
        btn.classList.toggle('rh-has', !!text);
        btn.title = text ? 'Notiz bearbeiten' : 'Notiz zur Wache hinzufügen';
      }
      if (!text) { line?.remove(); return; }
      if (!line) {
        line = document.createElement('div');
        line.className = 'rh-bnote';
        line.title = 'Klicken zum Bearbeiten';
        head.after(line);
      }
      if (line.textContent !== text) line.textContent = text;
    });
  }

  function closeNoteEditor() { document.getElementById('rh-note-pop')?.remove(); }

  function openNoteEditor(card) {
    closeNoteEditor();
    const id = card.getAttribute('userdepartmentid');
    const name = card.getAttribute('userbuildingname') || 'Wache';
    const pop = document.createElement('div');
    pop.id = 'rh-note-pop';
    pop.innerHTML = `
      <div class="rh-np-head">${NOTE_ICON}<span>Notiz <small>· ${name.replace(/</g, '&lt;')}</small></span></div>
      <textarea placeholder="z. B. „Personal knapp“, „DLK nur für Großeinsätze“ …"></textarea>
      <div class="rh-np-foot"><span>Strg+Enter speichert</span>
        <button data-a="del">Löschen</button><button data-a="save" class="rh-primary">Speichern</button></div>`;
    document.body.appendChild(pop);
    const ta = pop.querySelector('textarea');
    ta.value = notes[id] || '';
    const r = card.querySelector('.card-headline').getBoundingClientRect();
    pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    ta.focus();

    const save = text => {
      if (text.trim()) notes[id] = text.trim(); else delete notes[id];
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
      decorateBuildings();
      closeNoteEditor();
    };
    pop.addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'save') save(ta.value);
      if (a === 'del') save('');
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) save(ta.value);
      if (e.key === 'Escape') closeNoteEditor();
    });
  }

  // Klick auf Symbol oder Notiz -> Editor (vor dem Spiel abfangen, damit die Karte nicht auf-/zuklappt)
  departments.addEventListener('click', e => {
    const target = e.target.closest('.rh-note-btn, .rh-bnote');
    if (!target) return;
    e.stopPropagation();
    e.preventDefault();
    openNoteEditor(target.closest('.card[userdepartmentid]'));
  }, true);
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#rh-note-pop, .rh-note-btn, .rh-bnote')) closeNoteEditor();
  });

  observe(departments.querySelector('.panel-body'), () => { renderStatusbar(); decorateBuildings(); },
    { attributes: true, attributeFilter: ['class'] });
  renderStatusbar();
  decorateBuildings();

  // =====================================================================
  // 2) Sprechwunsch-Alarm (Status 5)
  // =====================================================================
  const s5Container = document.getElementById('radio-container-s5');
  let knownS5 = new Set();

  function checkS5() {
    const items = [...s5Container.querySelectorAll('[uservehicleid]')];
    const ids = new Set(items.map(el => el.getAttribute('uservehicleid')));
    const isNew = [...ids].some(id => !knownS5.has(id));
    knownS5 = ids;

    if (isNew && settings.s5Sound) beep(SOUND_S5);
    if (settings.s5Title && ids.size > 0) {
      const text = `🔴 ${ids.size}× Sprechwunsch!`;
      if (titleAlert !== text) setTitleAlert(text);
    } else if (titleAlert) {
      setTitleAlert(null);
    }
  }
  // vorhandene Sprechwünsche beim Laden nicht anpiepen, aber im Titel zeigen
  knownS5 = new Set([...s5Container.querySelectorAll('[uservehicleid]')].map(el => el.getAttribute('uservehicleid')));
  observe(s5Container, checkS5);
  checkS5();

  // =====================================================================
  // 3) Einsätze: Countdown + Farbe nach Einsatzart
  // =====================================================================
  // Reihenfolge zählt: der erste Treffer gewinnt
  const CATEGORIES = [
    ['brand',   /brand|brenn|feuer|bma|rauch|qualm|flamm|explosion|glut|schwel/i],
    ['thl',     /umgestürzt|baum|eingeklemmt|verkehrsunfall|unfall|öl|wasser|tier|unwetter|sturm|maschine|lkw|pkw|türöffnung|rohrbruch|keller|gas|aufzug|bergung/i],
    ['polizei', /diebstahl|einbruch|schlägerei|ruhestörung|randal|überfall|bedrohung|polizei|verdächtig|ladendieb|vandal|demonstr|streit/i],
    ['rd',      /verletz|person|patient|\bsturz|\bgestürzt|bewusstlos|notfall|herz|atem|kollaps|geburt|krampf|blutung|unwohl|schlaganfall|vergiftung|rettungsdienst/i],
  ];
  function missionName(mission) {
    const live = window.ControlCenter?.missions?.[mission.getAttribute('usermissionid')];
    if (live?.missionName) return live.missionName;
    const el = mission.querySelector('.mission-list-name');
    if (!el) return '';
    // nur der Text des Spiels, ohne unseren Countdown
    return [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
  }

  function categorize(mission) {
    const name = missionName(mission);
    const img = mission.querySelector('img')?.getAttribute('src') || '';
    for (const [cat, re] of CATEGORIES) if (re.test(name)) return cat;
    if (/fire/i.test(img)) return 'brand'; // Brand-Symbol, auch wenn der Name nichts verrät
    return 'thl';
  }

  const missionContainers = ['missions-container-own', 'missions-container-shared']
    .map(id => document.getElementById(id)).filter(Boolean);

  // Einsatztypen + Fahrzeugkategorien vom Spiel (für die Einsatzinfos)
  let missionTypesByName = null;
  // Namen robust vergleichen: manche Einsatztypen haben im Spiel z. B. ein Leerzeichen am Anfang
  // (" Austritt Kohlenstoffmonoxid") – also Leerzeichen und Groß-/Kleinschreibung angleichen
  const normName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  fetch('/api/missions').then(r => r.json()).then(types => {
    missionTypesByName = new Map(Object.values(types).map(t => [normName(t.name), t]));
    decorateMissions();
  }).catch(e => console.warn('[ReSi-Helfer] Einsatztypen nicht geladen', e));

  const kShort = n => n >= 1000
    ? (n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + 'k'
    : String(n);

  function renderMissionInfo(m) {
    let info = m.querySelector('.rh-minfo');
    const type = settings.missionInfo && missionTypesByName?.get(normName(missionName(m)));
    if (!type) { info?.remove(); return; }
    if (info?.dataset.k === String(type.id)) return;
    if (!info) {
      info = document.createElement('div');
      info.className = 'rh-minfo';
      m.querySelector('.mission-list-text')?.appendChild(info);
    }
    info.dataset.k = type.id;
    const coins = type.maxCredits > type.credits ? `${kShort(type.credits)}–${kShort(type.maxCredits)}` : kShort(type.credits);
    info.innerHTML = `<span class="rh-mi-coin" title="Vergütung: ${type.credits} bis ${type.maxCredits} Münzen">◉ ${coins} Münzen</span>`;
  }

  function decorateMissions() {
    document.body.classList.toggle('rh-no-colors', !settings.missionColors);
    for (const c of missionContainers) {
      for (const m of c.querySelectorAll('.mission-list-mission')) {
        // neu einordnen, sobald sich Name/Symbol ändern (neue Einsätze bekommen den Namen oft erst später)
        const key = missionName(m) + '|' + (m.querySelector('img')?.getAttribute('src') || '');
        if (m.dataset.rhKey !== key) { m.dataset.rhKey = key; m.dataset.rhCat = categorize(m); }
        const nameEl = m.querySelector('.mission-list-name');
        if (nameEl && !nameEl.querySelector('.rh-cd')) {
          const cd = document.createElement('span');
          cd.className = 'rh-cd rh-hidden';
          nameEl.appendChild(cd);
        }
        renderMissionInfo(m);
        renderMine(m);
      }
    }
    tickCountdowns();
    applyMissionSort();
  }

  function tickCountdowns() {
    const now = Date.now();
    for (const c of missionContainers) {
      for (const m of c.querySelectorAll('.mission-list-mission')) {
        const cd = m.querySelector('.rh-cd');
        if (!cd) continue;
        // Live-Daten des Spiels bevorzugen; das HTML-Attribut gibt es nur direkt nach dem Seitenladen
        const live = window.ControlCenter?.missions?.[m.getAttribute('usermissionid')];
        const ft = live ? live.finishTime : m.querySelector('.mission-list-progress')?.getAttribute('finishtime');
        const left = ft ? Math.round((Date.parse(ft) - now) / 1000) : NaN;
        if (!settings.countdown || !(left > 0)) { cd.classList.add('rh-hidden'); continue; }
        const txt = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (cd.textContent !== txt) cd.textContent = txt;
        cd.classList.remove('rh-hidden');
        cd.classList.toggle('rh-cd-soon', left <= (+settings.countdownSoon || 0));
      }
    }
  }

  // =====================================================================
  // Einsatzliste sortieren + eigene Fahrzeuge bei Verbandsfreigaben
  // =====================================================================
  const SORTS = [
    ['default',   'Wie im Spiel'],
    ['unalarmed', 'Unalarmierte zuerst'],
    ['time',      'Restzeit (kürzeste zuerst)'],
    ['credits',   'Max. Vergütung'],      // sortiert nach der bestmöglichen Vergütung
    ['distance',  'Entfernung (nächste zuerst)'],
  ];
  let ownByMission = new Map();   // Einsatz-ID -> Anzahl eigener Fahrzeuge
  let buildingSpots = [];         // Standorte deiner Wachen (für "Entfernung")
  const firstSeen = new Map(); let seenCounter = 0;

  const sortCss = document.createElement('style');
  sortCss.textContent = `
    /* width:0 + flex:1: die Auswahl richtet sich nach der Spalte, statt sie mit langen Texten breiter zu drücken */
    #rh-sortbar { display:flex; align-items:center; gap:8px; min-width:0; padding:6px 12px 2px; font-size:12px; color:#b1b1b1; }
    #rh-sortbar select { flex:1 1 0; width:0; min-width:0; text-overflow:ellipsis; background:#21242b; color:#fff; border:2px solid #b1b1b1; border-radius:100px;
      padding:2px 10px; font:700 12px Arial, sans-serif; cursor:pointer; outline:none; }
    #rh-sortbar select:focus { border-color:#28a745; }
    .rh-mine { display:inline-flex; align-items:center; gap:4px; margin-top:3px; padding:0 7px; border-radius:20px;
      background:#3c414b; color:#fff; font-size:10.5px; font-weight:700; line-height:16px; cursor:default; }
    .rh-mine svg { width:11px; height:11px; }
    .rh-mine.rh-enough { background:#28a745; }
  `;
  document.head.appendChild(sortCss);

  // Sortier-Auswahl unter den Reitern "Einsätze | Freigaben"
  const sortBar = document.createElement('div');
  sortBar.id = 'rh-sortbar';
  sortBar.innerHTML = `<span>Sortieren:</span><select title="Einsatzliste sortieren">
    ${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
  document.querySelector('#missions .panel-headline')?.after(sortBar);
  const sortSelect = sortBar.querySelector('select');
  sortSelect.addEventListener('change', () => {
    settings.missionSort = sortSelect.value;
    saveSettings();
    if (settings.missionSort === 'distance' && !buildingSpots.length) loadBuildingSpots();
    applyMissionSort();
  });

  async function loadOwnVehicles() {
    if (!settings.sharedMine && settings.missionSort === 'default') return;
    try {
      const list = await fetch('/api/userVehicles').then(r => r.json());
      const map = new Map();
      list.forEach(v => { if (v.userMissionID) map.set(String(v.userMissionID), (map.get(String(v.userMissionID)) || 0) + 1); });
      ownByMission = map;
      decorateMissions();
    } catch (e) { console.warn('[ReSi-Helfer] userVehicles fehlgeschlagen', e); }
  }
  async function loadBuildingSpots() {
    try {
      const list = await fetch('/api/userBuildings').then(r => r.json());
      buildingSpots = list.map(b => b.location).filter(l => l && isFinite(l.lat) && isFinite(l.lng));
      applyMissionSort();
    } catch (e) { console.warn('[ReSi-Helfer] userBuildings fehlgeschlagen', e); }
  }
  // Luftlinie in km zur nächsten eigenen Wache
  function nearestKm(lat, lng) {
    if (!buildingSpots.length || !isFinite(lat) || !isFinite(lng)) return Infinity;
    const rad = x => x * Math.PI / 180;
    return Math.min(...buildingSpots.map(b => {
      const dLat = rad(b.lat - lat), dLng = rad(b.lng - lng);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
      return 12742 * Math.asin(Math.sqrt(a));
    }));
  }

  const enoughLimit = () => Math.max(1, +settings.sharedEnough || 1);

  // Symbol "deine Fahrzeuge" an Freigaben
  function renderMine(m) {
    let chip = m.querySelector('.rh-mine');
    const shared = m.closest('#missions-container-shared');
    const n = ownByMission.get(m.getAttribute('usermissionid')) || 0;
    if (!settings.sharedMine || !shared || !n) { chip?.remove(); return; }
    const enough = n >= enoughLimit();
    const key = `${n}|${enough}`;
    if (chip?.dataset.k === key) return;
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'rh-mine';
      m.querySelector('.mission-list-text')?.appendChild(chip);
    }
    chip.dataset.k = key;
    chip.classList.toggle('rh-enough', enough);
    chip.title = `Du hast ${n} ${n === 1 ? 'Fahrzeug' : 'Fahrzeuge'} alarmiert` +
      (enough ? ` – versorgt (ab ${enoughLimit()})` : ` – versorgt ab ${enoughLimit()}`);
    chip.innerHTML = `${faIcon('truck')} ${enough ? '✓ ' : ''}${n}`;
    renderFa(chip);
  }

  // Sortiert, indem die Einträge in der passenden Reihenfolge neu angehängt werden.
  // Nur wenn sich die Reihenfolge wirklich ändert – sonst würde jede Änderung eine neue auslösen.
  function applyMissionSort() {
    if (sortSelect.value !== (settings.missionSort || 'default')) sortSelect.value = settings.missionSort || 'default';
    sortBar.style.display = settings.missionSortBar ? '' : 'none';
    const mode = settings.missionSortBar ? (settings.missionSort || 'default') : 'default';
    const now = Date.now();
    for (const c of missionContainers) {
      const shared = c.id === 'missions-container-shared';
      const items = [...c.children].filter(el => el.classList.contains('mission-list-mission'));
      if (items.length < 2) continue;
      // Reihenfolge des Spiels merken (wann wir einen Einsatz zuerst gesehen haben) – für 'Wie im Spiel' und Gleichstand
      items.forEach(el => { const id = el.getAttribute('usermissionid'); if (!firstSeen.has(id)) firstSeen.set(id, seenCounter++); });
      const keyOf = el => {
        const id = el.getAttribute('usermissionid');
        const live = window.ControlCenter?.missions?.[id] || {};
        // versorgte Freigaben immer ans Ende
        const enough = shared && settings.sharedMine && (ownByMission.get(id) || 0) >= enoughLimit() ? 1 : 0;
        let primary = 0;
        if (mode === 'unalarmed') primary = live.status === 1 ? 0 : 1;
        else if (mode === 'time') {
          const left = live.finishTime ? Date.parse(live.finishTime) - now : NaN;
          primary = left > 0 ? left : Infinity;
        } else if (mode === 'credits') {
          const t = missionTypesByName?.get(normName(missionName(el)));
          primary = t ? -(t.maxCredits || t.credits || 0) : Infinity;
        } else if (mode === 'distance') primary = nearestKm(+live.lat, +live.lng);
        return [enough, primary];
      };
      const keyed = items.map(el => ({ el, i: firstSeen.get(el.getAttribute('usermissionid')), k: keyOf(el) }));
      keyed.sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] === b.k[1] ? 0 : a.k[1] < b.k[1] ? -1 : 1) || (a.i - b.i));
      if (keyed.every((x, i) => x.el === items[i])) continue; // schon richtig sortiert
      const frag = document.createDocumentFragment();
      keyed.forEach(x => frag.appendChild(x.el));
      c.appendChild(frag);
    }
  }

  setInterval(loadOwnVehicles, 20000);
  setInterval(applyMissionSort, 5000); // Restzeiten ändern sich laufend
  try {
    let t = null;
    window.socket?.on('vehicleFMS', () => { clearTimeout(t); t = setTimeout(loadOwnVehicles, 1500); });
  } catch (e) { /* ohne Socket reicht das Intervall */ }
  loadOwnVehicles();
  if (settings.missionSort === 'distance') loadBuildingSpots();

  missionContainers.forEach(c => observe(c, decorateMissions, { attributes: true, attributeFilter: ['finishtime'] }));
  setInterval(tickCountdowns, 1000);
  decorateMissions();

  // =====================================================================
  // 4) Hinweis bei neuen Anrufen
  // =====================================================================
  const callsPanel = document.getElementById('calls');
  const callIds = () => new Set([...callsPanel.querySelectorAll('.call[usermissionid]')].map(c => c.getAttribute('usermissionid')));
  let knownCalls = callIds();

  function checkCalls() {
    const now = callIds();
    const fresh = [...now].filter(id => !knownCalls.has(id));
    knownCalls = now;
    if (!fresh.length) return;
    if (settings.callSound) beep(SOUND_CALL);
    if (settings.callDesktop && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      const card = callsPanel.querySelector(`.call[usermissionid="${fresh[0]}"] .answers`);
      const body = card?.getAttribute('object') || 'Neuer Notruf eingegangen';
      const n = new Notification('📞 Neuer Anruf – Rettungssimulator', { body, tag: 'resi-call' });
      n.onclick = () => { window.focus(); n.close(); };
    }
  }
  observe(callsPanel, checkCalls);

  // =====================================================================
  // Menü: Symbol in der Kopfleiste + Modulübersicht
  // =====================================================================
  const VERSION = '0.10.0';
  const MODULES = [
    ['Leitstelle', [
      ['statusbar',     'Fahrzeug-Statusleiste', 'Zähler S1–S8 über den Wachen, Klick filtert'],
      ['countdown',     'Einsatz-Countdown',     'Restzeit neben laufenden Einsätzen'],
      ['missionColors', 'Einsatzfarben',         'Rand nach Art: Brand, THL, RD, Polizei'],
      ['missionInfo',   'Einsatzinfos',          'Vergütung in der Einsatzliste'],
      ['missionSortBar','Einsatzliste sortieren', 'Unalarmierte zuerst, Restzeit, Vergütung oder Entfernung'],
      ['sharedMine',    'Eigene Fahrzeuge bei Freigaben', 'Zeigt, wie viele deiner Fahrzeuge bei einer Freigabe sind'],
      ['mapBorders',    'Grenzen auf der Karte', 'Landkreis- und Bundeslandgrenzen einblenden'],
      ['buildingNotes', 'Wachen-Notizen',        'Eigene Notizen an jeder Wache'],
      ['headerStats',   'Tagesleiste',           'Einsätze, freie Fahrzeuge und Tagesverdienst oben'],
      ['tabCounters',   'Reiter-Zähler',         'Neue und gesamte Einsätze an „Einsätze“ und „Freigaben“'],
      ['personnel',     'Personal',              'Vorhandenes und benötigtes Personal pro Wache'],
    ]],
    ['Alarme', [
      ['s5Sound',       'Sprechwunsch-Ton',      'Ton, wenn ein Fahrzeug Status 5 meldet'],
      ['s5Title',       'Sprechwunsch im Tab',   'Tab-Titel blinkt bei offenem Sprechwunsch'],
      ['callSound',     'Anruf-Ton',             'Ton bei neuem Notruf'],
      ['callDesktop',   'Desktop-Hinweis',       'Benachrichtigung bei Notruf im Hintergrund'],
    ]],
    ['Einsatzfenster', [
      ['missionBox',    'Einsatz-Check',         'Benötigte Fahrzeuge, Vergütung, Dauer'],
      ['listBar',       'Listenfilter',          '„Nur freie“, „Nur benötigte“, Umkreis'],
      ['hotkeys',       'Einsatz-Hotkeys',       'Eigene Tasten fürs Alarmieren, Freigeben und Anlegen'],
      ['missionNewFocus','Stichwort fokussieren', 'Beim Einsatz anlegen steht der Cursor sofort im Einsatzstichwort'],
    ]],
  ];
  const ALL_KEYS = MODULES.flatMap(([, items]) => items.map(i => i[0]));

  const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/>
      <path d="M6 12.5h3l1.6-4 2.8 8 1.6-4H18"/></svg>`;

  const menuCss = document.createElement('style');
  menuCss.textContent = `
    #rh-navbtn { display:flex; align-items:center; margin-right:16px; cursor:pointer; color:inherit;
      position:relative; transition:opacity .15s; }
    #rh-navbtn:hover { opacity:.8; }
    #rh-navbtn:hover, #rh-navbtn.rh-open { opacity:1; color:#28a745; }
    #rh-navbtn .rh-dot { position:absolute; top:-3px; right:-4px; width:8px; height:8px; border-radius:50%;
      background:#b02ad1; box-shadow:0 0 0 2px #21242b; display:none; }
    #rh-navbtn.rh-s5 .rh-dot { display:block; }

    #rh-menu { position:fixed; z-index:100000; width:310px; background:#282c35; border:1px solid rgba(255,255,255,.14);
      border-radius:12px; box-shadow:0 14px 40px rgba(0,0,0,.55); color:#fff; font-size:13px; overflow:hidden;
      animation:rh-pop .12s ease-out; }
    @keyframes rh-pop { from { opacity:0; transform:translateY(-4px); } }
    #rh-menu .rh-m-head { display:flex; gap:11px; align-items:center; padding:14px;
      background:radial-gradient(circle at 0 0, rgba(40,167,69,.20), transparent 70%); border-bottom:1px solid rgba(255,255,255,.07); }
    #rh-menu .rh-m-logo { width:34px; height:34px; flex:none; border-radius:9px; background:#28a745; color:#fff;
      display:grid; place-items:center; }
    #rh-menu .rh-m-title { font-weight:700; font-size:15px; }
    #rh-menu .rh-m-sub { font-size:11px; color:#868e96; }
    #rh-menu .rh-m-ver { margin-left:auto; align-self:flex-start; font-size:10px; padding:2px 7px; border-radius:999px;
      background:rgba(255,255,255,.07); color:#adb5bd; font-variant-numeric:tabular-nums; }
    #rh-menu .rh-m-scroll { max-height:52vh; overflow:auto; padding:4px 0 6px; }
    #rh-menu .rh-m-links { display:flex; gap:6px; padding:12px 14px 14px; }
    #rh-menu .rh-m-links button { flex:1; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;
      border:1px solid rgba(255,255,255,.14); background:transparent; color:#dee2e6; border-radius:8px; padding:6px 0; font-size:12px; }
    #rh-menu .rh-m-links button:hover { border-color:#28a745; color:#fff; }
    #rh-menu .rh-m-links span { color:#28a745; }
    /* ---- Rettungssimulator-Design ---- */
    #rh-navbtn:hover, #rh-navbtn.rh-open { color:#fff; }
    #rh-navbtn .rh-dot { box-shadow:0 0 0 2px #21242b; }
    #rh-menu { background:#282c35; border:0; border-radius:15px; box-shadow:0 3px 3px rgba(0,0,0,.13), 0 12px 34px rgba(0,0,0,.45); font-family:"Segoe UI", sans-serif; }
    #rh-menu .rh-m-head { background:#DB1111; border-bottom:0; padding:12px 14px; }
    #rh-menu .rh-m-logo { background:rgba(0,0,0,.22); color:#fff; border-radius:100px; }
    #rh-menu .rh-m-sub { color:rgba(255,255,255,.82); }
    #rh-menu .rh-m-ver { background:rgba(0,0,0,.25); color:#fff; }
    #rh-menu .rh-m-links { padding:14px; }
    #rh-menu .rh-m-links button { border:2px solid #b1b1b1; background:transparent; color:#b1b1b1; border-radius:100px; font:700 12px Arial, sans-serif; padding:6px 0; }
    #rh-menu .rh-m-links button:hover { border-color:#fff; color:#fff; }
    #rh-menu .rh-m-links span { color:inherit; }
    #rh-menu .rh-m-links { flex-wrap:wrap; }
    #rh-menu .rh-m-links button { flex:1 1 calc(50% - 6px); }

    /* ---- Update-Hinweis ---- */
    #rh-navbtn .rh-dot { right:auto; left:-4px; }  /* Sprechwunsch-Punkt links, Update-Zeichen rechts */
    #rh-navbtn .rh-upd-badge { display:none; position:absolute; top:-7px; right:-14px; background:#28a745; color:#fff;
      border-radius:20px; padding:.9px 4.5px; font:700 9px/1.25 Arial, sans-serif; }
    #rh-navbtn.rh-upd .rh-upd-badge { display:block; }
    #rh-menu .rh-m-update { display:flex; align-items:center; gap:10px; margin:14px 14px 0; padding:10px 12px;
      background:#21242b; border-radius:12.5px; box-shadow:inset 3px 0 0 #28a745; }
    #rh-menu .rh-m-update div { flex:1; min-width:0; }
    #rh-menu .rh-m-update b { display:block; font-size:13px; }
    #rh-menu .rh-m-update small { color:#b1b1b1; font-size:11.5px; }
    #rh-menu .rh-m-update button, #rh-cc .rh-upd-btn { cursor:pointer; border:2px solid #28a745; background:transparent; color:#28a745;
      border-radius:100px; font:700 12px Arial, sans-serif; padding:4px 12px; white-space:nowrap; }
    #rh-menu .rh-m-update button:hover, #rh-cc .rh-upd-btn:hover { background:#28a745; color:#fff; }
    #rh-cc .rh-cc-updbox .rh-upd-btn { display:block; width:100%; margin-bottom:10px; }
    #rh-menu .rh-m-group { display:flex; justify-content:space-between; padding:10px 14px 3px; font-size:10px;
      letter-spacing:.08em; text-transform:uppercase; color:#6c757d; font-weight:700; }
    #rh-menu .rh-m-row { display:flex; align-items:center; gap:10px; padding:7px 14px; cursor:pointer; user-select:none; }
    #rh-menu .rh-m-row:hover { background:rgba(255,255,255,.05); }
    #rh-menu .rh-m-text { min-width:0; }
    #rh-menu .rh-m-name { font-weight:500; }
    #rh-menu .rh-m-desc { font-size:11px; color:#7d858f; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #rh-menu .rh-sw { margin-left:auto; flex:none; width:30px; height:17px; border-radius:999px; background:rgba(255,255,255,.14);
      position:relative; transition:background .15s; }
    #rh-menu .rh-sw::after { content:''; position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:50%;
      background:#adb5bd; transition:left .15s, background .15s; }
    #rh-menu .rh-on .rh-sw { background:#28a745; }
    #rh-menu .rh-on .rh-sw::after { left:15px; background:#fff; }
    #rh-menu .rh-m-foot { border-top:1px solid rgba(255,255,255,.07); padding:10px 14px 12px; display:flex; flex-direction:column; gap:9px; }
    #rh-menu .rh-m-vol { display:flex; align-items:center; gap:10px; font-size:12px; color:#adb5bd; }
    #rh-menu .rh-m-vol input { flex:1; accent-color:#28a745; }
    #rh-menu .rh-m-btns { display:flex; gap:6px; }
    #rh-menu .rh-m-btns button { flex:1; cursor:pointer; border:1px solid rgba(255,255,255,.14); background:transparent; color:#ced4da;
      border-radius:6px; padding:4px 0; font-size:12px; }
    #rh-menu .rh-m-btns button:hover { border-color:#28a745; color:#fff; }
  `;
  document.head.appendChild(menuCss);

  const navBtn = document.createElement('div');
  navBtn.id = 'rh-navbtn';
  navBtn.title = 'ReSi-Helfer';
  navBtn.innerHTML = faIcon('sliders-h') + '<span class="rh-dot"></span><span class="rh-upd-badge">neu</span>';
  renderFa(navBtn);
  const headerRight = document.querySelector('header .right');
  headerRight?.insertBefore(navBtn, headerRight.firstChild);

  // Punkt am Symbol, solange ein Sprechwunsch offen ist
  const updateNavDot = () => navBtn.classList.toggle('rh-s5', knownS5.size > 0);
  observe(s5Container, updateNavDot);
  updateNavDot();

  function applySettings() {
    renderStatusbar();
    decorateBuildings();
    decorateMissions();
    checkS5();
    renderHeaderStats();
    renderTabCounters();
    renderBorders();
    loadOwnVehicles();
    if (settings.missionSort === 'distance' && !buildingSpots.length) loadBuildingSpots();
    if (settings.personnel && !buildingInfo.size) loadBuildings(); else decoratePersonnel();
  }

  function renderMenu(menu) {
    const active = ALL_KEYS.filter(k => settings[k]).length;
    menu.innerHTML = `
      <div class="rh-m-head">
        <div class="rh-m-logo">${ICON}</div>
        <div><div class="rh-m-title">ReSi-Helfer</div><div class="rh-m-sub">${active} von ${ALL_KEYS.length} Modulen aktiv</div></div>
        <span class="rh-m-ver">v${VERSION}</span>
      </div>
      ${updateAvailable() ? `
      <div class="rh-m-update">
        <div><b>Update verfügbar</b><small>v${VERSION} → v${latestVersion}</small></div>
        <button data-update>Installieren</button>
      </div>` : ''}
      <div class="rh-m-links">
        <button data-open="modules"><span>▦</span> Module</button>
        <button data-open="stats"><span>▥</span> Statistik</button>
        <button data-open="realbau"><span>⌂</span> Realbau</button>
        <button data-open="settings"><span>⚙</span> Einstellungen</button>
      </div>`;
  }

  function closeMenu() {
    document.getElementById('rh-menu')?.remove();
    navBtn.classList.remove('rh-open');
  }

  function openMenu() {
    const menu = document.createElement('div');
    menu.id = 'rh-menu';
    renderMenu(menu);
    document.body.appendChild(menu);
    const r = navBtn.getBoundingClientRect();
    menu.style.top = (r.bottom + 10) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth + 20)) + 'px';
    navBtn.classList.add('rh-open');

    menu.addEventListener('click', e => {
      if (e.target.closest('[data-update]')) { closeMenu(); return installUpdate(); }
      const page = e.target.closest('[data-open]')?.dataset.open;
      if (page) { closeMenu(); openCenter(page); }
    });
  }

  navBtn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('rh-menu') ? closeMenu() : openMenu();
  });
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#rh-menu, #rh-navbtn')) closeMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  // =====================================================================
  // Update-Hinweis: prüft auf GitHub, ob es eine neuere Version gibt
  // =====================================================================
  const UPDATE_URL = 'https://raw.githubusercontent.com/ShadowZyroX7/Resi-Helfer/main/resi-helfer.user.js';
  const UPDATE_KEY = 'resiHelfer.update';
  const UPDATE_EVERY = 30 * 60000; // höchstens alle 30 Minuten nachsehen
  let latestVersion = null, updateChecked = 0;

  const isNewer = (a, b) => { // ist Version a neuer als b?
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  };
  const updateAvailable = () => !!latestVersion && isNewer(latestVersion, VERSION);

  async function checkForUpdate(force) {
    const cached = JSON.parse(localStorage.getItem(UPDATE_KEY) || 'null');
    if (!force && cached && Date.now() - cached.checked < UPDATE_EVERY) {
      latestVersion = cached.latest; updateChecked = cached.checked;
    } else {
      try {
        const text = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' })
          .then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))));
        latestVersion = text.match(/@version\s+([\d.]+)/)?.[1] || null;
        updateChecked = Date.now();
        localStorage.setItem(UPDATE_KEY, JSON.stringify({ checked: updateChecked, latest: latestVersion }));
      } catch (e) { console.warn('[ReSi-Helfer] Update-Prüfung fehlgeschlagen', e); }
    }
    navBtn.classList.toggle('rh-upd', updateAvailable());
    navBtn.title = updateAvailable() ? `ReSi-Helfer – Update auf v${latestVersion} verfügbar` : 'ReSi-Helfer';
    const menu = document.getElementById('rh-menu');
    if (menu) renderMenu(menu);
    if (document.getElementById('rh-cc')) renderCenter();
  }
  // Tampermonkey erkennt den .user.js-Link und zeigt seine Installationsseite
  const installUpdate = () => window.open(UPDATE_URL, '_blank', 'noopener');

  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_EVERY);

  // Hotkeys an ein offenes Einsatzfenster weiterreichen, solange der Fokus noch in der Leitstelle liegt
  document.addEventListener('keydown', e => {
    if (!settings.hotkeys || e.repeat) return;
    if (document.getElementById('rh-cc') || document.getElementById('rh-note-pop')) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const frame = [...document.querySelectorAll('iframe')]
      .find(f => /\/mission(New)?\/\d+/.test(f.src) && f.offsetParent !== null);
    try {
      if (frame?.contentWindow?.__rhHotkey?.(combo, isTypingEl(e.target))) e.preventDefault();
    } catch (err) { /* Fenster noch nicht bereit */ }
  });


  // =====================================================================
  // Zähler an den Reitern "Einsätze" / "Freigaben"
  // =====================================================================
  const tbCss = document.createElement('style');
  tbCss.textContent = `
    /* als Bläschen oben rechts im Reiter – nimmt keinen Platz weg, damit die Spalte nicht breiter wird */
    #missions .tab.rh-tab-count { position:relative; }
    .rh-tb { position:absolute; top:-3px; right:0; pointer-events:none;
      display:inline-flex; align-items:center; gap:2px; padding:1px; border-radius:999px; box-shadow:0 0 0 2px #282c35;
      background:#3c414b; font-size:10px; font-weight:700; line-height:14px; color:#ced4da;
      font-variant-numeric:tabular-nums; letter-spacing:0; }
    .rh-tb > span { min-width:9px; padding:0 5px; border-radius:999px; text-align:center; }
    .rh-tb .rh-tb-new { background:#DB1111; color:#fff; }
    .rh-tb .rh-tb-own { background:#28a745; color:#fff; }

    .rh-pers { display:inline-flex; align-items:center; gap:3px; margin-right:7px; padding:0 7px; border-radius:999px;
      background:rgba(0,0,0,.28); color:#fff; font-size:11px; font-weight:700; line-height:17px; vertical-align:middle;
      font-variant-numeric:tabular-nums; cursor:default; }
    .rh-pers small { font-weight:500; opacity:.75; font-size:10.5px; }
    .rh-pers.rh-bad { background:#fff; color:#c92a2a; }
  `;
  document.head.appendChild(tbCss);

  function setTabBadge(tab, html) {
    const t = document.querySelector(`#missions .tab[tab="${tab}"]`);
    if (!t) return;
    let b = t.querySelector('.rh-tb');
    t.classList.toggle('rh-tab-count', !!html);
    if (!html) { b?.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'rh-tb'; t.appendChild(b); }
    if (b.innerHTML !== html) b.innerHTML = html;
  }

  function renderTabCounters() {
    if (!settings.tabCounters) { setTabBadge('ownMissions', ''); setTabBadge('sharedMissions', ''); return; }
    const all = Object.values(window.ControlCenter?.missions || {});
    const own = all.filter(m => !m.isShared);
    const shared = all.filter(m => m.isShared);
    const ownNew = own.filter(m => m.status === 1).length;
    const sharedMine = shared.filter(m => m.ownParticipation).length;
    setTabBadge('ownMissions',
      (ownNew ? `<span class="rh-tb-new" title="Noch nicht alarmiert">${ownNew}</span>` : '') +
      `<span title="Eigene Einsätze gesamt">${own.length}</span>`);
    setTabBadge('sharedMissions',
      (sharedMine ? `<span class="rh-tb-own" title="Freigaben mit deinen Fahrzeugen">${sharedMine}</span>` : '') +
      `<span title="Freigegebene Einsätze gesamt">${shared.length}</span>`);
  }
  setInterval(renderTabCounters, 1000);
  renderTabCounters();

  // =====================================================================
  // Personal pro Wache (Kärtchen in der Wachen-Überschrift)
  // =====================================================================
  const PERS_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/>
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>`;
  let buildingInfo = new Map();

  async function loadBuildings() {
    if (!settings.personnel) return;
    try {
      const list = await fetch('/api/userBuildings').then(r => r.json());
      buildingInfo = new Map(list.map(b => [String(b.userBuildingID), b]));
      decoratePersonnel();
    } catch (e) { console.warn('[ReSi-Helfer] userBuildings fehlgeschlagen', e); }
  }

  function decoratePersonnel() {
    departments.querySelectorAll('.card[userdepartmentid]').forEach(card => {
      const tools = card.querySelector('.card-headline .card-tools');
      let chip = card.querySelector('.rh-pers');
      const b = buildingInfo.get(card.getAttribute('userdepartmentid'));
      if (!settings.personnel || !b || !tools) { chip?.remove(); return; }
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'rh-pers';
        tools.insertBefore(chip, tools.firstChild);
      }
      const have = b.personalCount, need = b.maxNeededPersonalCount, diff = have - need;
      const html = `${PERS_ICON}${have}<small>/${need}</small>`;
      if (chip.innerHTML !== html) chip.innerHTML = html;
      chip.classList.toggle('rh-bad', diff < 0);
      chip.title = `Personal: ${have} von ${need} benötigt · ${diff >= 0 ? diff + ' frei' : -diff + ' fehlen'}` +
        (b.isHiring ? ' · Werbung läuft' : ' · keine Werbung');
    });
  }
  observe(departments.querySelector('.panel-body'), decoratePersonnel);
  setInterval(loadBuildings, 60000);
  loadBuildings();

  // =====================================================================
  // Tagesleiste in der Kopfzeile
  // =====================================================================
  const DAILY_KEY = 'resiHelfer.daily';
  const todayStr = () => new Date().toLocaleDateString('sv'); // JJJJ-MM-TT
  let daily = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null');
  const rollDay = () => { if (!daily || daily.date !== todayStr()) daily = { date: todayStr(), earned: 0, finished: 0 }; };
  rollDay();
  const saveDaily = () => localStorage.setItem(DAILY_KEY, JSON.stringify(daily));

  // Aufbau wie die Kopfzeile des Spiels: "58.500 Münzen [Symbol] | 40 Marken [Symbol]"
  const hsCss = document.createElement('style');
  hsCss.textContent = `
    #rh-hs { font:inherit; color:inherit; }
    #rh-hs .rh-hs-i { white-space:nowrap; cursor:default; }
    #rh-hs .rh-hs-ico { position:relative; display:inline-block; }
    #rh-hs .rh-hs-badge { position:absolute; top:-6px; right:-9px; background:#ff0000; color:#fff; border-radius:20px;
      padding:.9px 4.5px; font-size:9px; line-height:1.25; font-weight:400; }
    @media (max-width: 1300px) { #rh-hs .rh-hs-l { display:none; } }
  `;
  document.head.appendChild(hsCss);

  const hs = document.createElement('span');
  hs.id = 'rh-hs';
  const coinBox = document.querySelector('header .muenzen_marken');
  coinBox?.insertBefore(hs, coinBox.firstChild);

  const coinsEl = document.querySelector('header .muenzen');
  const parseCoins = () => +((coinsEl?.textContent || '').replace(/\D/g, '')) || 0;
  let lastCoins = parseCoins();
  observe(coinsEl, () => {
    rollDay();
    const now = parseCoins();
    if (now > lastCoins) { daily.earned += now - lastCoins; saveDaily(); } // Ausgaben (Käufe) zählen nicht
    lastCoins = now;
    renderHeaderStats();
  }, { characterData: true });

  // abgeschlossene eigene Einsätze zählen
  const ownSeen = new Set();
  try {
    window.socket?.on('finishMission', d => {
      const id = String(d && typeof d === 'object' ? (d.userMissionID ?? d.missionID ?? d.id) : d);
      if (!ownSeen.has(id)) return;
      rollDay();
      daily.finished++;
      saveDaily();
      renderHeaderStats();
    });
  } catch (e) { console.warn('[ReSi-Helfer] finishMission nicht abonnierbar', e); }

  function renderHeaderStats() {
    hs.style.display = settings.headerStats ? '' : 'none';
    if (!settings.headerStats) return;
    rollDay();
    const own = document.querySelectorAll('#missions-container-own .mission-list-mission[usermissionid]');
    own.forEach(m => ownSeen.add(m.getAttribute('usermissionid')));
    const fresh = Object.values(window.ControlCenter?.missions || {}).filter(m => !m.isShared && m.status === 1).length;
    let free = 0, total = 0;
    departments.querySelectorAll('.vehicle[uservehicleid]').forEach(v => {
      total++;
      const s = vehicleStatus(v);
      if (s === 1 || s === 2) free++;
    });
    const html =
      `<span class="rh-hs-i" title="Eigene Einsätze${fresh ? ` – davon ${fresh} noch nicht alarmiert` : ''}">` +
        `${own.length} <span class="rh-hs-l">Einsätze</span> <span class="rh-hs-ico">${faIcon('bell')}` +
        `${fresh ? `<span class="rh-hs-badge">${fresh}</span>` : ''}</span></span> | ` +
      `<span class="rh-hs-i" title="Freie Fahrzeuge (Status 1 und 2) von allen">` +
        `${free}/${total} <span class="rh-hs-l">frei</span> ${faIcon('truck')}</span> | ` +
      `<span class="rh-hs-i" title="Heute verdient (ohne Ausgaben)">` +
        `+${daily.earned.toLocaleString('de-DE')} <span class="rh-hs-l">heute</span> ${faIcon('coins')}</span> | ` +
      `<span class="rh-hs-i" title="Heute abgeschlossene eigene Einsätze">` +
        `${daily.finished} <span class="rh-hs-l">erledigt</span> ${faIcon('check')}</span> | `;
    if (hs.dataset.html !== html) { hs.dataset.html = html; hs.innerHTML = html; renderFa(hs); }
  }
  setInterval(renderHeaderStats, 1500);
  renderHeaderStats();

  // =====================================================================
  // Karte: Landkreis- und Bundeslandgrenzen
  // Daten: github.com/isellsoap/deutschlandGeoJSON (Quelle: DIVA-GIS), im Browser zwischengespeichert
  // =====================================================================
  const GEO_BASE = 'https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/';
  const GEO_URLS = {
    districts: GEO_BASE + '4_kreise/4_niedrig.geo.json',      // 434 Landkreise / kreisfreie Städte
    states:    GEO_BASE + '2_bundeslaender/3_mittel.geo.json', // 16 Bundesländer
  };
  const GEO_STYLE = {
    districts: { color: '#ffffff', weight: 1.3, opacity: 0.6, dashArray: '5 5', fill: false },
    states:    { color: '#FFB300', weight: 2.6, opacity: 0.9, fill: false },
  };
  const geoLayers = {};
  const geoLoading = {};

  async function loadGeo(url) {
    try { // Cache-Speicher des Browsers, damit die Daten nicht bei jedem Laden neu kommen
      const cache = await caches.open('resi-helfer-geo');
      let res = await cache.match(url);
      if (!res) { res = await fetch(url); if (res.ok) await cache.put(url, res.clone()); }
      return await res.json();
    } catch (e) {
      return fetch(url).then(r => r.json());
    }
  }

  async function renderBorders() {
    const map = window.mymap, Lf = window.L;
    if (!map || !Lf?.geoJSON) return;
    if (!map.getPane('rhBorders')) {
      const pane = map.createPane('rhBorders');
      pane.style.zIndex = 390;          // über der Karte, unter Fahrzeugen und Einsätzen
      pane.style.pointerEvents = 'none'; // Klicks gehen weiter an die Karte
    }
    for (const kind of ['districts', 'states']) {
      const on = settings.mapBorders && settings[kind === 'states' ? 'mapStates' : 'mapDistricts'];
      if (on && !geoLayers[kind] && !geoLoading[kind]) {
        geoLoading[kind] = loadGeo(GEO_URLS[kind])
          .then(data => {
            geoLayers[kind] = Lf.geoJSON(data, { pane: 'rhBorders', interactive: false, style: GEO_STYLE[kind] });
            renderBorders();
          })
          .catch(e => console.warn('[ReSi-Helfer] Grenzen nicht geladen', e))
          .finally(() => { delete geoLoading[kind]; });
        continue;
      }
      const layer = geoLayers[kind];
      if (!layer) continue;
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    }
  }
  renderBorders();

  // =====================================================================
  // Kontrollzentrum: Module + Einstellungen (großes Fenster)
  // =====================================================================
  const MOD_ICONS = {
    statusbar:     '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
    countdown:     '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    missionColors: '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="6.5" r="3"/><circle cx="17" cy="17.5" r="3"/>',
    missionInfo:   '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5"/>',
    buildingNotes: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5M8 13h8M8 17h5"/>',
    headerStats:   '<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>',
    s5Sound:       '<rect x="7" y="7" width="10" height="14" rx="2"/><path d="M10 7V3M10 11h4M10 15h4"/>',
    s5Title:       '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 5v4"/>',
    callSound:     '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    callDesktop:   '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    missionBox:    '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17"/>',
    listBar:       '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    mapBorders:    '<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
    missionSortBar:'<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
    sharedMine:    '<path d="M3 16V8h11v8M14 11h4l3 3v2h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 5h4"/>',
    tabCounters:   '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 11h18M9 7V4h6v3"/>',
    personnel:     '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    hotkeys:       '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    missionNewFocus:'<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 10v4"/>',
  };
  const modIcon = k => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MOD_ICONS[k] || MOD_ICONS.missionBox}</svg>`;

  const ccCss = document.createElement('style');
  ccCss.textContent = `
    #rh-cc { position:fixed; inset:0; z-index:100001; display:grid; place-items:center; background:rgba(8,10,13,.62);
      backdrop-filter:blur(3px); animation:rh-fade .15s ease-out; }
    @keyframes rh-fade { from { opacity:0; } }
    #rh-cc .rh-cc-win { display:grid; grid-template-columns:220px 1fr; width:min(1040px,94vw); height:min(700px,90vh);
      background:#21242b; border:1px solid rgba(255,255,255,.14); border-radius:16px; overflow:hidden; color:#fff; font-size:13px;
      box-shadow:0 24px 80px rgba(0,0,0,.6); animation:rh-rise .18s ease-out; text-align:left; }
    #rh-cc h2, #rh-cc h3, #rh-cc h4, #rh-cc p { text-align:left; }
    @keyframes rh-rise { from { transform:translateY(8px) scale(.99); opacity:0; } }

    #rh-cc .rh-cc-side { display:flex; flex-direction:column; background:#21242b; border-right:1px solid rgba(255,255,255,.07); padding:18px 12px; }
    #rh-cc .rh-cc-brand { display:flex; gap:10px; align-items:center; padding:0 6px 18px; }
    #rh-cc .rh-cc-logo { width:36px; height:36px; border-radius:10px; background:#28a745; color:#fff; display:grid; place-items:center; }
    #rh-cc .rh-cc-brand b { display:block; font-size:15px; }
    #rh-cc .rh-cc-brand small { color:#868e96; font-size:11px; }
    #rh-cc .rh-cc-nav { display:flex; align-items:center; gap:10px; padding:9px 12px; margin:2px 0; border-radius:8px; cursor:pointer;
      color:#adb5bd; user-select:none; }
    #rh-cc .rh-cc-nav:hover { background:rgba(255,255,255,.08); color:#fff; }
    #rh-cc .rh-cc-nav.rh-act { background:rgba(40,167,69,.14); color:#fff; box-shadow:inset 3px 0 0 #28a745; }
    #rh-cc .rh-cc-nav .rh-cc-count { margin-left:auto; font-size:11px; color:#868e96; }
    #rh-cc .rh-cc-sidefoot { margin-top:auto; padding:12px 8px 0; border-top:1px solid rgba(255,255,255,.07); font-size:11px; color:#6c757d; line-height:1.6; }
    #rh-cc .rh-cc-meter { height:5px; border-radius:3px; background:rgba(255,255,255,.07); overflow:hidden; margin:6px 0 2px; }
    #rh-cc .rh-cc-meter i { display:block; height:100%; background:#28a745; }

    /* min-height:0 ist nötig, sonst wächst der Inhalt über das Fenster hinaus und lässt sich nicht scrollen */
    #rh-cc .rh-cc-win { grid-template-rows:minmax(0,1fr); }
    #rh-cc .rh-cc-side, #rh-cc .rh-cc-main { min-height:0; }
    #rh-cc .rh-cc-main { display:flex; flex-direction:column; min-width:0; overflow:hidden; }
    #rh-cc .rh-cc-head { display:flex; align-items:flex-start; gap:12px; padding:20px 24px 14px; border-bottom:1px solid rgba(255,255,255,.08); }
    #rh-cc .rh-cc-head h2 { margin:0; font-size:20px; font-weight:700; }
    #rh-cc .rh-cc-head p { margin:3px 0 0; color:#868e96; font-size:12.5px; }
    #rh-cc .rh-cc-close { margin-left:auto; width:32px; height:32px; border-radius:8px; display:grid; place-items:center; cursor:pointer;
      color:#adb5bd; font-size:18px; }
    #rh-cc .rh-cc-close:hover { background:rgba(255,255,255,.08); color:#fff; }
    #rh-cc .rh-cc-body { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:18px 24px 24px; }

    #rh-cc .rh-cc-tools { display:flex; gap:8px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
    #rh-cc .rh-cc-search { flex:1; min-width:180px; background:#21242b; border:1px solid rgba(255,255,255,.14); border-radius:8px; padding:7px 11px;
      color:#fff; font:inherit; outline:none; }
    #rh-cc .rh-cc-search:focus { border-color:#28a745; }
    #rh-cc .rh-cc-chip { cursor:pointer; padding:5px 11px; border-radius:999px; border:1px solid rgba(255,255,255,.14); color:#adb5bd; font-size:12px; user-select:none; }
    #rh-cc .rh-cc-chip.rh-act { border-color:#28a745; color:#fff; background:rgba(40,167,69,.14); }

    #rh-cc .rh-cc-group { margin:6px 0 10px; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#6c757d; }
    #rh-cc .rh-cc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:12px; margin-bottom:22px; }
    #rh-cc .rh-cc-card { position:relative; display:flex; flex-direction:column; gap:10px; padding:14px; border-radius:12px;
      background:#21242b; border:1px solid rgba(255,255,255,.07); cursor:pointer; user-select:none; transition:border-color .15s, background .15s, transform .15s; }
    #rh-cc .rh-cc-card:hover { transform:translateY(-1px); border-color:rgba(255,255,255,.14); }
    #rh-cc .rh-cc-card.rh-on { border-color:rgba(40,167,69,.55); background:linear-gradient(180deg, rgba(40,167,69,.08), #21242b 60%); }
    #rh-cc .rh-cc-card-top { display:flex; align-items:center; justify-content:space-between; }
    #rh-cc .rh-cc-ico { width:40px; height:40px; border-radius:11px; display:grid; place-items:center; background:rgba(255,255,255,.07); color:#868e96; transition:.15s; }
    #rh-cc .rh-on .rh-cc-ico { background:#28a745; color:#fff; }
    #rh-cc .rh-cc-card h4 { margin:0; font-size:14px; font-weight:600; }
    #rh-cc .rh-cc-card p { margin:0; color:#868e96; font-size:12px; line-height:1.45; }
    #rh-cc .rh-cc-state { font-size:11px; font-weight:600; color:#6c757d; }
    #rh-cc .rh-on .rh-cc-state { color:#28a745; }

    #rh-cc .rh-sw { flex:none; width:34px; height:19px; border-radius:999px; background:rgba(255,255,255,.14); position:relative; transition:background .15s; }
    #rh-cc .rh-sw::after { content:''; position:absolute; top:2px; left:2px; width:15px; height:15px; border-radius:50%;
      background:#adb5bd; transition:left .15s, background .15s; }
    #rh-cc .rh-on > .rh-sw, #rh-cc .rh-on .rh-cc-card-top .rh-sw { background:#28a745; }
    #rh-cc .rh-on > .rh-sw::after, #rh-cc .rh-on .rh-cc-card-top .rh-sw::after { left:17px; background:#fff; }

    #rh-cc .rh-cc-sec { margin-bottom:22px; }
    #rh-cc .rh-cc-sec h3 { margin:0 0 8px; font-size:13px; font-weight:700; color:#ced4da; display:flex; align-items:center; gap:8px; }
    #rh-cc .rh-cc-sec h3 svg { color:#28a745; }
    #rh-cc .rh-cc-rows { border:1px solid rgba(255,255,255,.07); border-radius:12px; overflow:hidden; }
    #rh-cc .rh-cc-row { display:flex; align-items:center; gap:16px; padding:12px 16px; background:#21242b; }
    #rh-cc .rh-cc-row + .rh-cc-row { border-top:1px solid rgba(255,255,255,.05); }
    #rh-cc .rh-cc-row .rh-cc-lbl { flex:1; min-width:0; }
    #rh-cc .rh-cc-row .rh-cc-lbl b { display:block; font-weight:500; }
    #rh-cc .rh-cc-row .rh-cc-lbl small { color:#7d858f; font-size:11.5px; }
    #rh-cc .rh-cc-row.rh-toggle { cursor:pointer; user-select:none; }
    #rh-cc .rh-cc-row input[type=range] { width:180px; accent-color:#28a745; }
    #rh-cc .rh-cc-row input[type=number] { width:70px; background:#21242b; border:1px solid rgba(255,255,255,.14); border-radius:6px; color:#fff;
      padding:5px 8px; font:inherit; text-align:right; }
    #rh-cc .rh-btn { cursor:pointer; border:1px solid rgba(255,255,255,.14); background:transparent; color:#dee2e6; border-radius:8px; padding:6px 12px; font-size:12px; }
    #rh-cc .rh-btn:hover { border-color:#28a745; color:#fff; }
    #rh-cc .rh-btn.rh-danger:hover { border-color:#DB1111; color:#ffa8a8; }
    #rh-cc .rh-cc-btns { display:flex; gap:6px; flex-wrap:wrap; }
    #rh-cc .rh-cc-empty { color:#6c757d; padding:30px 0; text-align:center; }
    #rh-cc .rh-combo { white-space:nowrap; font-size:12px; color:#ced4da; }
    #rh-cc .rh-combo em { font-style:normal; color:#28a745; }
    #rh-cc kbd { display:inline-block; min-width:18px; padding:1px 6px; border-radius:5px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14);
      border-bottom-width:2px; color:#fff; font:600 11.5px/17px inherit; text-align:center; }
    #rh-cc .rh-cc-row.rh-rec { background:rgba(40,167,69,.08); box-shadow:inset 3px 0 0 #28a745; }
    /* ---- Rettungssimulator-Design ---- */
    #rh-cc .rh-cc-win { background:#282c35; border:0; border-radius:15px; box-shadow:0 3px 3px rgba(0,0,0,.13), 0 12px 34px rgba(0,0,0,.45); font-family:"Segoe UI", sans-serif; }
    #rh-cc .rh-cc-side { background:#21242b; border-right:0; }
    #rh-cc .rh-cc-logo { background:#DB1111; color:#fff; border-radius:100px; }
    #rh-cc .rh-cc-nav { border-radius:100px; }
    #rh-cc .rh-cc-nav:hover { background:rgba(255,255,255,.06); }
    #rh-cc .rh-cc-nav.rh-act { background:#DB1111; color:#fff; box-shadow:none; }
    #rh-cc .rh-cc-nav.rh-act .rh-cc-count { color:rgba(255,255,255,.85); }
    #rh-cc .rh-cc-sidefoot { border-top:1px solid rgba(255,255,255,.08); }
    #rh-cc .rh-cc-meter { background:#282c35; }
    #rh-cc .rh-cc-meter i { background:#28a745; }
    #rh-cc .rh-cc-head { border-bottom:0; padding-bottom:6px; }
    #rh-cc .rh-cc-close:hover { background:rgba(255,255,255,.08); }
    #rh-cc .rh-cc-search { background:#21242b; border:0; border-radius:100px; padding:8px 16px; }
    #rh-cc .rh-cc-search:focus { box-shadow:0 0 0 2px #28a745; }
    #rh-cc .rh-cc-chip { border:2px solid #b1b1b1; background:transparent; color:#b1b1b1; border-radius:100px; font:700 12px Arial, sans-serif; padding:4px 14px; }
    #rh-cc .rh-cc-chip.rh-act { border-color:#28a745; color:#28a745; background:transparent; }
    #rh-cc .rh-cc-card { background:#21242b; border:2px solid transparent; border-radius:12.5px; }
    #rh-cc .rh-cc-card:hover { border-color:rgba(255,255,255,.15); }
    #rh-cc .rh-cc-card.rh-on { background:#21242b; border-color:#28a745; }
    #rh-cc .rh-cc-ico { border-radius:100px; background:#282c35; color:#b1b1b1; }
    #rh-cc .rh-on .rh-cc-ico { background:#28a745; color:#fff; }
    #rh-cc .rh-on .rh-cc-state { color:#28a745; }
    #rh-cc .rh-cc-sec h3 svg { color:#DB1111; }
    #rh-cc .rh-cc-rows { border:0; border-radius:12.5px; }
    #rh-cc .rh-cc-row { background:#21242b; }
    #rh-cc .rh-cc-row + .rh-cc-row { border-top:1px solid rgba(255,255,255,.06); }
    #rh-cc .rh-cc-row.rh-rec { background:#21242b; box-shadow:inset 3px 0 0 #28a745; }
    #rh-cc .rh-combo em { color:#28a745; }
    #rh-cc .rh-cc-row input[type=number] { background:#282c35; border:0; border-radius:100px; padding:5px 12px; }
    #rh-cc .rh-cc-row input[type=range] { accent-color:#28a745; }
    #rh-cc kbd { background:#282c35; border-color:rgba(255,255,255,.18); }
    #rh-cc .rh-sw { background:#3c414b; }
    #rh-cc .rh-on > .rh-sw, #rh-cc .rh-on .rh-cc-card-top .rh-sw { background:#28a745; }
    #rh-cc .rh-btn { border:2px solid #b1b1b1; background:transparent; color:#b1b1b1; border-radius:100px; font:700 12px Arial, sans-serif; padding:4px 14px; }
    #rh-cc .rh-btn:hover { border-color:#fff; color:#fff; }
    #rh-cc .rh-btn.rh-danger { border-color:#DB1111; color:#DB1111; }
    #rh-cc .rh-btn.rh-danger:hover { background:#DB1111; color:#fff; }
    #rh-cc .rh-btn[disabled] { opacity:.5; cursor:default; }

    /* ---- Statistik ---- */
    #rh-cc .rh-st-top { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
    #rh-cc .rh-st-tabs { display:flex; gap:6px; flex-wrap:wrap; }
    #rh-cc .rh-st-period { margin-left:auto; display:flex; align-items:center; gap:10px; font-size:14px; }
    #rh-cc .rh-st-arrow { width:28px; height:28px; border-radius:100px; border:2px solid #b1b1b1; background:transparent; color:#b1b1b1;
      font:700 16px/1 Arial, sans-serif; cursor:pointer; display:grid; place-items:center; padding:0; }
    #rh-cc .rh-st-arrow:hover:not([disabled]) { border-color:#fff; color:#fff; }
    #rh-cc .rh-st-arrow[disabled] { opacity:.3; cursor:default; }
    #rh-cc .rh-st-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(175px,1fr)); gap:12px; margin-bottom:14px; }
    #rh-cc .rh-st-kpi { background:#21242b; border-radius:12.5px; padding:12px 14px; }
    #rh-cc .rh-st-kpi small { color:#b1b1b1; font-size:12px; }
    #rh-cc .rh-st-kpi b { display:block; margin:2px 0 3px; font-size:23px; font-weight:700; font-variant-numeric:tabular-nums; }
    #rh-cc .rh-st-kpi em { font-style:normal; font-size:11.5px; color:#b1b1b1; }
    #rh-cc .rh-pos { color:#28a745; } #rh-cc .rh-neg { color:#ff4d4d; }
    #rh-cc .rh-st-card { background:#21242b; border-radius:12.5px; padding:12px 14px; margin-bottom:14px; min-width:0; }
    #rh-cc .rh-st-card h4 { margin:0 0 10px; font-size:13px; font-weight:700; color:#fff; }
    #rh-cc .rh-st-chart { display:flex; align-items:stretch; gap:3px; height:160px; }
    #rh-cc .rh-st-bar { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; cursor:default; }
    #rh-cc .rh-st-bar i { display:block; width:100%; max-width:36px; background:#28a745; border-radius:4px 4px 0 0; transition:height .25s; }
    #rh-cc .rh-st-bar.rh-zero i { background:#3c414b; }
    #rh-cc .rh-st-bar.rh-now i { background:#3ddc63; box-shadow:0 0 0 2px rgba(61,220,99,.25); }
    #rh-cc .rh-st-bar:hover i { filter:brightness(1.2); }
    #rh-cc .rh-st-bar span { margin-top:5px; font-size:10.5px; color:#b1b1b1; white-space:nowrap; }
    #rh-cc .rh-st-cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    @media (max-width: 900px) { #rh-cc .rh-st-cols { grid-template-columns:1fr; } }
    #rh-cc .rh-st-li { display:flex; align-items:center; gap:10px; padding:6px 0; font-size:12.5px; }
    #rh-cc .rh-st-li + .rh-st-li { border-top:1px solid rgba(255,255,255,.06); }
    #rh-cc .rh-st-name { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #rh-cc .rh-st-n { color:#b1b1b1; font-variant-numeric:tabular-nums; }
    #rh-cc .rh-st-li b { min-width:70px; text-align:right; font-variant-numeric:tabular-nums; }
    #rh-cc .rh-st-empty { color:#b1b1b1; font-size:12px; padding:6px 0; }
    #rh-cc .rh-st-loading { background:#21242b; border-radius:12.5px; padding:40px 20px; text-align:center; color:#fff; }
    #rh-cc .rh-st-loading small { color:#b1b1b1; }
    #rh-cc .rh-st-foot { display:flex; align-items:center; gap:12px; justify-content:space-between; font-size:11.5px; color:#b1b1b1; }

    /* ---- Realbau ---- */
    #rh-cc .rh-rb-st { background:#21242b; border-radius:12.5px; margin-bottom:12px; overflow:hidden; }
    #rh-cc .rh-rb-head { display:flex; align-items:center; gap:12px; padding:8px 14px; background:#DB1111; cursor:pointer; user-select:none; }
    #rh-cc .rh-rb-head b { font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #rh-cc .rh-rb-prog { margin-left:auto; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
    #rh-cc .rh-rb-bar { width:110px; height:6px; border-radius:3px; background:rgba(0,0,0,.3); overflow:hidden; flex:none; }
    #rh-cc .rh-rb-bar i { display:block; height:100%; background:#fff; }
    #rh-cc .rh-rb-headcost { font-size:11.5px; background:rgba(0,0,0,.25); border-radius:100px; padding:1px 8px; white-space:nowrap; }
    #rh-cc .rh-rb-head .rh-caret { color:#fff; transition:transform .15s; transform:rotate(-90deg); }
    #rh-cc .rh-rb-st.rh-open .rh-caret { transform:none; }
    #rh-cc .rh-rb-body { padding:6px 14px 12px; }
    #rh-cc .rh-rb-row { display:grid; grid-template-columns:minmax(0,1fr) 70px 64px 110px 80px; align-items:center; gap:10px; padding:6px 0; font-size:12.5px; }
    #rh-cc .rh-rb-row + .rh-rb-row { border-top:1px solid rgba(255,255,255,.06); }
    #rh-cc .rh-rb-th { color:#b1b1b1; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    #rh-cc .rh-rb-name { min-width:0; }
    #rh-cc .rh-rb-name b { display:block; }
    #rh-cc .rh-rb-name small { display:block; color:#b1b1b1; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #rh-cc .rh-rb-count { font-variant-numeric:tabular-nums; font-weight:700; text-align:center; }
    #rh-cc .rh-rb-step { display:flex; gap:4px; }
    #rh-cc .rh-rb-step button { width:26px; height:26px; border-radius:100px; border:2px solid #b1b1b1; background:transparent; color:#b1b1b1;
      font:700 14px/1 Arial, sans-serif; cursor:pointer; padding:0; }
    #rh-cc .rh-rb-step button:hover:not([disabled]) { border-color:#fff; color:#fff; }
    #rh-cc .rh-rb-step button[disabled] { opacity:.3; cursor:default; }
    #rh-cc .rh-rb-chip { display:inline-block; padding:1px 9px; border-radius:100px; font-size:11.5px; font-weight:700; white-space:nowrap; }
    #rh-cc .rh-rb-green { background:#28a745; color:#fff; }
    #rh-cc .rh-rb-red { background:#DB1111; color:#fff; }
    #rh-cc .rh-rb-gray { background:#3c414b; color:#ddd; }
    #rh-cc .rh-rb-cost { text-align:right; color:#ff4d4d; font-variant-numeric:tabular-nums; }
    #rh-cc .rh-rb-add { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,.08); }
    #rh-cc .rh-rb-add select { flex:1 1 220px; min-width:0; background:#282c35; color:#fff; border:2px solid #b1b1b1; border-radius:100px;
      padding:4px 12px; font:700 12px Arial, sans-serif; outline:none; }
  `;
  document.head.appendChild(ccCss);

  const SETTINGS_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const REALBAU_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/></svg>';
  const STATS_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V12M10 20V6M16 20v-9M22 20H2"/></svg>';
  const GRID_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  const secIcon = k => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${MOD_ICONS[k]}</svg>`;

  let ccPage = 'modules', ccQuery = '', ccFilter = 'all', ccRecording = null;

  function closeCenter() { document.getElementById('rh-cc')?.remove(); }

  function openCenter(page) {
    closeCenter();
    ccPage = page || 'modules';
    const cc = document.createElement('div');
    cc.id = 'rh-cc';
    cc.innerHTML = `
      <div class="rh-cc-win" role="dialog" aria-label="ReSi-Helfer Kontrollzentrum">
        <aside class="rh-cc-side">
          <div class="rh-cc-brand"><div class="rh-cc-logo">${ICON}</div><div><b>ReSi-Helfer</b><small>Kontrollzentrum</small></div></div>
          <div class="rh-cc-nav" data-page="modules">${GRID_ICON}<span>Module</span><span class="rh-cc-count"></span></div>
          <div class="rh-cc-nav" data-page="stats">${STATS_ICON}<span>Statistik</span></div>
          <div class="rh-cc-nav" data-page="realbau">${REALBAU_ICON}<span>Realbau</span></div>
          <div class="rh-cc-nav" data-page="settings">${SETTINGS_ICON}<span>Einstellungen</span></div>
          <div class="rh-cc-sidefoot"><div class="rh-cc-updbox"></div><div class="rh-cc-active"></div><div class="rh-cc-meter"><i></i></div>Version ${VERSION}</div>
        </aside>
        <section class="rh-cc-main">
          <div class="rh-cc-head"><div><h2></h2><p></p></div><div class="rh-cc-close" title="Schließen (Esc)">✕</div></div>
          <div class="rh-cc-body"></div>
        </section>
      </div>`;
    document.body.appendChild(cc);

    cc.addEventListener('mousedown', e => { if (e.target === cc) closeCenter(); });
    cc.querySelector('.rh-cc-close').onclick = closeCenter;
    cc.querySelector('.rh-cc-side').addEventListener('click', e => {
      if (e.target.closest('[data-update]')) return installUpdate();
      const p = e.target.closest('[data-page]')?.dataset.page;
      if (p) { ccPage = p; renderCenter(); }
    });
    cc.querySelector('.rh-cc-body').addEventListener('click', onCenterClick);
    cc.querySelector('.rh-cc-body').addEventListener('input', onCenterInput);
    cc.querySelector('.rh-cc-body').addEventListener('change', onCenterChange);
    renderCenter();
  }

  function renderCenter() {
    const cc = document.getElementById('rh-cc');
    if (!cc) return;
    const active = ALL_KEYS.filter(k => settings[k]).length;
    cc.querySelectorAll('.rh-cc-nav').forEach(n => n.classList.toggle('rh-act', n.dataset.page === ccPage));
    cc.querySelector('.rh-cc-count').textContent = `${active}/${ALL_KEYS.length}`;
    cc.querySelector('.rh-cc-active').textContent = `${active} von ${ALL_KEYS.length} Modulen aktiv`;
    cc.querySelector('.rh-cc-meter i').style.width = (active / ALL_KEYS.length * 100) + '%';
    const updHtml = updateAvailable()
      ? `<button class="rh-upd-btn" data-update title="Öffnet die Tampermonkey-Installation">↑ Update auf v${latestVersion}</button>` : '';
    const updBox = cc.querySelector('.rh-cc-updbox');
    if (updBox.innerHTML !== updHtml) updBox.innerHTML = updHtml;
    const [h2, p] = [cc.querySelector('.rh-cc-head h2'), cc.querySelector('.rh-cc-head p')];
    const body = cc.querySelector('.rh-cc-body');
    const scroll = body.scrollTop;

    if (ccPage === 'modules') {
      h2.textContent = 'Module';
      p.textContent = 'Schalte einzelne Funktionen an oder aus – Änderungen gelten sofort.';
      // Suchfeld nur einmal aufbauen, damit der Fokus beim Tippen bleibt
      if (!body.querySelector('.rh-cc-search')) {
        body.innerHTML = `
          <div class="rh-cc-tools">
            <input class="rh-cc-search" type="search" placeholder="Module durchsuchen …">
            <span class="rh-cc-chip" data-filter="all">Alle</span>
            <span class="rh-cc-chip" data-filter="on">Aktiv</span>
            <span class="rh-cc-chip" data-filter="off">Inaktiv</span>
          </div>
          <div class="rh-cc-list"></div>`;
        body.querySelector('.rh-cc-search').value = ccQuery;
      }
      body.querySelectorAll('.rh-cc-chip').forEach(c => c.classList.toggle('rh-act', c.dataset.filter === ccFilter));
      const q = ccQuery.trim().toLowerCase();
      const groups = MODULES.map(([group, items]) => [group, items.filter(([k, name, desc]) =>
        (!q || (name + ' ' + desc).toLowerCase().includes(q)) &&
        (ccFilter === 'all' || (ccFilter === 'on') === !!settings[k]))]).filter(([, items]) => items.length);
      body.querySelector('.rh-cc-list').innerHTML = groups.map(([group, items]) => `
        <div class="rh-cc-group">${group}</div>
        <div class="rh-cc-grid">${items.map(([k, name, desc]) => `
          <div class="rh-cc-card${settings[k] ? ' rh-on' : ''}" data-k="${k}">
            <div class="rh-cc-card-top"><div class="rh-cc-ico">${modIcon(k)}</div><span class="rh-sw"></span></div>
            <div><h4>${name}</h4><p>${desc}</p></div>
            <span class="rh-cc-state">${settings[k] ? 'Aktiv' : 'Aus'}</span>
          </div>`).join('')}</div>`).join('') || '<div class="rh-cc-empty">Kein Modul gefunden.</div>';
    } else if (ccPage === 'stats') {
      renderStats(body, h2, p);
    } else if (ccPage === 'realbau') {
      renderRealbau(body, h2, p);
    } else {
      h2.textContent = 'Einstellungen';
      p.textContent = 'Feinschliff für die Module, Töne und deine Daten.';
      const sw = (k, label, hint) => `
        <div class="rh-cc-row rh-toggle${settings[k] ? ' rh-on' : ''}" data-k="${k}">
          <div class="rh-cc-lbl"><b>${label}</b><small>${hint}</small></div><span class="rh-sw"></span></div>`;
      body.innerHTML = `
        <div class="rh-cc-sec"><h3>${secIcon('s5Sound')} Töne</h3><div class="rh-cc-rows">
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Lautstärke</b><small>Gilt für Sprechwunsch- und Anruf-Ton</small></div>
            <input type="range" min="0" max="1" step="0.05" data-set="volume" value="${settings.volume}"></div>
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Probehören</b><small>Browser spielen Töne erst nach einem Klick auf die Seite</small></div>
            <div class="rh-cc-btns"><button class="rh-btn" data-test="s5">▶ Sprechwunsch</button><button class="rh-btn" data-test="call">▶ Anruf</button></div></div>
        </div></div>

        <div class="rh-cc-sec"><h3>${secIcon('statusbar')} Leitstelle</h3><div class="rh-cc-rows">
          ${sw('statusShowAll', 'Alle Status in der Statusleiste', 'Auch leere Status 5–8 anzeigen')}
          ${sw('mapDistricts', 'Landkreisgrenzen auf der Karte', 'Weiße gestrichelte Linien (Modul „Grenzen auf der Karte“ muss an sein)')}
          ${sw('mapStates', 'Bundeslandgrenzen auf der Karte', 'Gelbe Linien (Modul „Grenzen auf der Karte“ muss an sein)')}
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Countdown hervorheben</b><small>Restzeit wird grün, wenn weniger als so viele Sekunden übrig sind</small></div>
            <input type="number" min="0" max="600" step="5" data-set="countdownSoon" value="${settings.countdownSoon}"></div>
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Freigabe gilt als versorgt ab</b>
            <small>So viele <u>eigene</u> Fahrzeuge bei einer Verbandsfreigabe – dann wird sie grün markiert und rutscht in der Liste nach unten</small></div>
            <input type="number" min="1" max="50" step="1" data-set="sharedEnough" value="${settings.sharedEnough}"></div>
        </div></div>

        <div class="rh-cc-sec"><h3>${secIcon('listBar')} Einsatzfenster</h3><div class="rh-cc-rows">
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Umkreis der Fahrzeugliste</b><small>Fahrzeuge weiter weg ausblenden (0 = alle zeigen)</small></div>
            <input type="number" min="0" max="30" step="1" data-set="listMaxKm" value="${settings.listMaxKm}"></div>
          ${sw('listOnlyFree', 'Nur freie Fahrzeuge', 'Voreinstellung für „Nur freie (S1/S2)“')}
          ${sw('listOnlyNeeded', 'Nur benötigte Fahrzeuge', 'Voreinstellung für „Nur benötigte“')}
        </div></div>

        <div class="rh-cc-sec"><h3>${secIcon('hotkeys')} Tastenkürzel</h3><div class="rh-cc-rows">
          ${sw('hotkeys', 'Tastenkürzel aktiv', 'Kürzel ohne Strg/Alt wirken nicht, während du in ein Textfeld tippst')}
          ${sw('missionNewFocus', 'Einsatzstichwort fokussieren',
            'Beim Einsatz anlegen steht der Cursor sofort im Feld „Einsatzstichwort“')}
          ${KEY_ACTIONS.map(([a, label, where]) => `
            <div class="rh-cc-row${ccRecording === a ? ' rh-rec' : ''}">
              <div class="rh-cc-lbl"><b>${label}</b><small>${where}</small></div>
              <span class="rh-combo">${ccRecording === a ? '<em>Taste drücken … (Esc abbrechen, Entf leeren)</em>' : prettyCombo(settings.keys[a])}</span>
              <button class="rh-btn" data-act="rec" data-key="${a}">${ccRecording === a ? 'Abbrechen' : 'Ändern'}</button>
            </div>`).join('')}
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Standardbelegung</b>
            <small>Enter / ⇧+Enter / F / ⇧+F / A / D im Einsatz · Strg+Enter / Strg+⇧+Enter beim Anlegen</small></div>
            <button class="rh-btn" data-act="keysDefault">Wiederherstellen</button></div>
        </div></div>

        <div class="rh-cc-sec"><h3>${secIcon('headerStats')} Tagesleiste</h3><div class="rh-cc-rows">
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Heute: +${daily.earned.toLocaleString('de-DE')} Münzen · ${daily.finished} Einsätze</b>
            <small>Zählt ab Mitternacht neu. Ausgaben werden nicht abgezogen.</small></div>
            <button class="rh-btn" data-act="resetDay">Zurücksetzen</button></div>
        </div></div>

        <div class="rh-cc-sec"><h3>${secIcon('buildingNotes')} Daten</h3><div class="rh-cc-rows">
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Version ${VERSION}${updateAvailable() ? ` – <span style="color:#28a745">v${latestVersion} verfügbar</span>` : latestVersion ? ' – aktuell' : ''}</b>
            <small>${updateChecked ? `Zuletzt geprüft um ${new Date(updateChecked).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ` : ''}Tampermonkey installiert Updates auch selbst, meist einmal am Tag</small></div>
            <div class="rh-cc-btns">${updateAvailable() ? '<button class="rh-upd-btn" data-update>Installieren</button>' : ''}
              <button class="rh-btn" data-act="checkUpdate">Jetzt prüfen</button></div></div>
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Sichern &amp; wiederherstellen</b>
            <small>Einstellungen und Wachen-Notizen als Datei speichern oder laden</small></div>
            <div class="rh-cc-btns"><button class="rh-btn" data-act="export">Exportieren</button>
              <button class="rh-btn" data-act="import">Importieren</button></div></div>
          <div class="rh-cc-row"><div class="rh-cc-lbl"><b>Alles zurücksetzen</b><small>Löscht alle Einstellungen, Notizen und den Tageszähler</small></div>
            <button class="rh-btn rh-danger" data-act="reset">Zurücksetzen</button></div>
        </div></div>`;
    }
    body.scrollTop = scroll;
  }

  // =====================================================================
  // Statistik aus dem Münzverlauf des Spiels (transactions/muenzen)
  // =====================================================================
  const TX_KEY = 'resiHelfer.tx';
  let tx = JSON.parse(localStorage.getItem(TX_KEY) || 'null') || { rows: [] }; // rows: [zeit, wert, text], neueste zuerst
  let txLoading = null, txProgress = '', txError = '', txLastAttempt = 0;
  let statRange = 'week', statShift = 0;
  const nf = n => Number(n).toLocaleString('de-DE');

  // "19:27 24.11.26" -> Zeitstempel
  const parseTxTime = s => {
    const m = s.match(/(\d{1,2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (!m) return NaN;
    const y = +m[5] < 100 ? 2000 + +m[5] : +m[5];
    return new Date(y, m[4] - 1, m[3], m[1], m[2]).getTime();
  };
  const parseTxValue = s => +s.replace(/[^\d-]/g, '') || 0; // "-20.000" -> -20000

  async function fetchTxPage(page) {
    const html = await fetch('transactions/muenzen/' + page).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('tr')].map(r => [...r.cells]).filter(c => c.length >= 4)
      .map(c => [parseTxTime(c[3].textContent), parseTxValue(c[1].textContent), c[2].textContent.replace(/\s+/g, ' ').trim()])
      .filter(r => !isNaN(r[0]));
    const pages = Math.max(page, ...[...doc.querySelectorAll('a[href*="transactions/muenzen/"]')]
      .map(a => +(a.getAttribute('href').match(/muenzen\/(\d+)/)?.[1] || 0)));
    return { rows, pages };
  }

  const renderCenterIfStats = () => { if (ccPage === 'stats' && document.getElementById('rh-cc')) renderCenter(); };

  // Lädt nur neue Seiten nach – bekannte Einträge bleiben im Browser gespeichert
  function loadTx() {
    if (txLoading) return txLoading;
    txError = '';
    txLastAttempt = Date.now();
    txLoading = (async () => {
      const newest = tx.rows[0]?.[0] ?? -Infinity;
      const fresh = [];
      let page = 1, pages = 1;
      while (page <= pages) {
        txProgress = `Lade Münzverlauf … Seite ${page}${pages > 1 ? ` von ${pages}` : ''}`;
        renderCenterIfStats();
        const res = await fetchTxPage(page);
        pages = res.pages;
        if (!res.rows.length) break;
        fresh.push(...res.rows.filter(r => r[0] >= newest));
        if (res.rows[res.rows.length - 1][0] < newest) break; // ab hier kennen wir alles schon
        page++;
        await new Promise(r => setTimeout(r, 120)); // Server schonen
      }
      tx.rows = [...fresh, ...tx.rows.filter(r => r[0] < newest)];
      tx.updated = Date.now();
      localStorage.setItem(TX_KEY, JSON.stringify(tx));
    })()
      .catch(e => { txError = 'Der Münzverlauf konnte nicht geladen werden.'; console.warn('[ReSi-Helfer]', e); })
      .finally(() => { txLoading = null; txProgress = ''; renderCenterIfStats(); });
    return txLoading;
  }

  // ---------- Zeiträume ----------
  const DAY = 86400000;
  const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const MON_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const dmy = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  }

  // liefert Start/Ende, Beschriftung und die Balken (Stunden, Tage oder Monate)
  function statPeriod(range, shift) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const buckets = [];
    let start, end, label, unit;
    if (range === 'day') {
      start = new Date(y, m, d + shift); end = new Date(y, m, d + shift + 1);
      label = shift === 0 ? 'Heute' : shift === -1 ? 'Gestern' : `${WD[(start.getDay() + 6) % 7]}, ${dmy(start)}${start.getFullYear()}`;
      unit = 'Stunde';
      for (let h = 0; h < 24; h++) buckets.push({ s: +start + h * 3600000, e: +start + (h + 1) * 3600000, l: String(h) });
    } else if (range === 'week') {
      const dow = (now.getDay() + 6) % 7;
      start = new Date(y, m, d - dow + 7 * shift); end = new Date(y, m, d - dow + 7 * shift + 7);
      label = `KW ${isoWeek(start)} · ${dmy(start)} – ${dmy(new Date(+end - 1))}`;
      unit = 'Tag';
      for (let i = 0; i < 7; i++) { const s = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); buckets.push({ s: +s, e: +new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1), l: WD[i] }); }
    } else if (range === 'month') {
      start = new Date(y, m + shift, 1); end = new Date(y, m + shift + 1, 1);
      label = `${MON_LONG[start.getMonth()]} ${start.getFullYear()}`;
      unit = 'Tag';
      for (let s = new Date(start); s < end; s = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1))
        buckets.push({ s: +s, e: +new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1), l: String(s.getDate()) });
    } else if (range === 'year') {
      start = new Date(y + shift, 0, 1); end = new Date(y + shift + 1, 0, 1);
      label = String(start.getFullYear());
      unit = 'Monat';
      for (let i = 0; i < 12; i++) buckets.push({ s: +new Date(start.getFullYear(), i, 1), e: +new Date(start.getFullYear(), i + 1, 1), l: MON[i] });
    } else { // gesamt
      const first = tx.rows.length ? new Date(tx.rows[tx.rows.length - 1][0]) : now;
      start = new Date(first.getFullYear(), first.getMonth(), 1); end = new Date(y, m + 1, 1);
      label = `Seit ${dmy(first)}${first.getFullYear()}`;
      unit = 'Monat';
      for (let s = new Date(start); s < end; s = new Date(s.getFullYear(), s.getMonth() + 1, 1))
        buckets.push({ s: +s, e: +new Date(s.getFullYear(), s.getMonth() + 1, 1), l: `${MON[s.getMonth()]} ${String(s.getFullYear()).slice(2)}` });
    }
    return { start: +start, end: +end, label, unit, buckets };
  }

  const MISSION_RE = /^Einsatz (.+?) erfolgreich abgeschlossen/;
  function expenseGroup(text) {
    if (/^Fahrzeug/i.test(text)) return 'Fahrzeuge';
    if (/^Gebäude|Ausbau|Erweiterung/i.test(text)) return 'Gebäude & Ausbauten';
    if (/Stellplatz/i.test(text)) return 'Stellplätze';
    if (/Lehrgang|Ausbildung/i.test(text)) return 'Lehrgänge';
    if (/Personal|Werb/i.test(text)) return 'Personal';
    return 'Sonstiges';
  }

  function renderStats(body, h2, p) {
    h2.textContent = 'Statistik';
    p.textContent = 'Deine Einnahmen und Einsätze – direkt aus dem Münzverlauf des Spiels.';

    // automatisch aktualisieren (höchstens einmal pro Minute)
    if (!txLoading && Date.now() - txLastAttempt > 60000) loadTx();

    const RANGES = [['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr'], ['all', 'Gesamt']];
    const per = statPeriod(statRange, statShift);
    const rows = tx.rows.filter(r => r[0] >= per.start && r[0] < per.end);
    const income = rows.filter(r => r[1] > 0), expenses = rows.filter(r => r[1] < 0);
    const missions = income.filter(r => MISSION_RE.test(r[2]));
    const earned = income.reduce((s, r) => s + r[1], 0);
    const spent = Math.abs(expenses.reduce((s, r) => s + r[1], 0)); // abs: sonst "-0" ohne Ausgaben
    const missionSum = missions.reduce((s, r) => s + r[1], 0);

    const bars = per.buckets.map(b => {
      const inB = income.filter(r => r[0] >= b.s && r[0] < b.e);
      return { ...b, v: inB.reduce((s, r) => s + r[1], 0), n: inB.filter(r => MISSION_RE.test(r[2])).length };
    });
    const max = Math.max(1, ...bars.map(b => b.v));
    const best = bars.reduce((a, b) => (b.v > a.v ? b : a), { v: 0 });
    const step = bars.length > 16 ? Math.ceil(bars.length / 12) : 1;
    const nowTs = Date.now();

    const types = {};
    missions.forEach(r => { const n = r[2].match(MISSION_RE)[1]; (types[n] ||= { n: 0, v: 0 }); types[n].n++; types[n].v += r[1]; });
    const topTypes = Object.entries(types).sort((a, b) => b[1].n - a[1].n || b[1].v - a[1].v).slice(0, 6);
    const groups = {};
    expenses.forEach(r => { const g = expenseGroup(r[2]); (groups[g] ||= { n: 0, v: 0 }); groups[g].n++; groups[g].v -= r[1]; });
    const topGroups = Object.entries(groups).sort((a, b) => b[1].v - a[1].v);

    const first = tx.rows.length ? new Date(tx.rows[tx.rows.length - 1][0]) : null;
    const status = txProgress || txError || (tx.updated
      ? `Stand ${new Date(tx.updated).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${nf(tx.rows.length)} Buchungen${first ? ` seit ${dmy(first)}${first.getFullYear()}` : ''}`
      : 'Noch nicht geladen');

    const list = (items, empty, cls) => items.length ? items.map(([name, d]) => `
        <div class="rh-st-li"><span class="rh-st-name" title="${name}">${name}</span>
          <span class="rh-st-n">${d.n}×</span><b class="${cls}">${cls === 'rh-neg' ? '−' : '+'}${nf(d.v)}</b></div>`).join('')
      : `<div class="rh-st-empty">${empty}</div>`;

    body.innerHTML = `
      <div class="rh-st-top">
        <div class="rh-st-tabs">${RANGES.map(([k, l]) => `<span class="rh-cc-chip${statRange === k ? ' rh-act' : ''}" data-range="${k}">${l}</span>`).join('')}</div>
        <div class="rh-st-period">
          ${statRange !== 'all' ? `<button class="rh-st-arrow" data-shift="-1" title="Zurück">‹</button>` : ''}
          <b>${per.label}</b>
          ${statRange !== 'all' ? `<button class="rh-st-arrow" data-shift="1" title="Weiter" ${statShift >= 0 ? 'disabled' : ''}>›</button>` : ''}
        </div>
      </div>

      ${!tx.rows.length && txLoading ? `<div class="rh-st-loading">${txProgress || 'Lade Münzverlauf …'}<br><small>Beim ersten Mal wird der gesamte Verlauf geladen, danach nur noch Neues.</small></div>` : `
      <div class="rh-st-kpis">
        <div class="rh-st-kpi"><small>Verdient</small><b class="rh-pos">+${nf(earned)}</b><em>davon Einsätze: ${nf(missionSum)}</em></div>
        <div class="rh-st-kpi"><small>Ausgegeben</small><b class="${spent ? 'rh-neg' : ''}">${spent ? '−' : ''}${nf(spent)}</b><em>Bilanz: <span class="${earned - spent >= 0 ? 'rh-pos' : 'rh-neg'}">${earned - spent >= 0 ? '+' : '−'}${nf(Math.abs(earned - spent))}</span></em></div>
        <div class="rh-st-kpi"><small>Einsätze abgeschlossen</small><b>${nf(missions.length)}</b><em>${best.v ? `Bester ${per.unit}: ${best.l} (+${nf(best.v)})` : '&nbsp;'}</em></div>
        <div class="rh-st-kpi"><small>Ø pro Einsatz</small><b>${missions.length ? nf(Math.round(missionSum / missions.length)) : '–'}</b><em>Münzen</em></div>
      </div>

      <div class="rh-st-card">
        <h4>Verdienst pro ${per.unit}</h4>
        <div class="rh-st-chart">
          ${bars.map((b, i) => `
            <div class="rh-st-bar${b.v ? '' : ' rh-zero'}${nowTs >= b.s && nowTs < b.e ? ' rh-now' : ''}" title="${b.l}: +${nf(b.v)} Münzen · ${b.n} Einsätze">
              <i style="height:${Math.max(2, (b.v / max) * 100)}%"></i>
              <span>${i % step === 0 ? b.l : '&nbsp;'}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="rh-st-cols">
        <div class="rh-st-card"><h4>Häufigste Einsätze</h4>${list(topTypes, 'Keine Einsätze in diesem Zeitraum', 'rh-pos')}</div>
        <div class="rh-st-card"><h4>Ausgaben</h4>${list(topGroups, 'Keine Ausgaben in diesem Zeitraum', 'rh-neg')}</div>
      </div>`}

      <div class="rh-st-foot"><span>${status}</span>
        <button class="rh-btn" data-act="txReload" ${txLoading ? 'disabled' : ''}>${txLoading ? 'Lädt …' : 'Aktualisieren'}</button></div>`;
  }

  // =====================================================================
  // Realbau: Soll/Ist-Abgleich pro Wache
  // =====================================================================
  const RB_KEY = 'resiHelfer.realbau';
  let realbau = JSON.parse(localStorage.getItem(RB_KEY) || '{}'); // { wachenId: { fahrzeugTypId: soll } }
  const saveRealbau = () => localStorage.setItem(RB_KEY, JSON.stringify(realbau));
  let rbBuildings = null, rbVehicles = null, rbLoading = null, rbError = '', rbLoaded = 0;
  const rbCatalog = {};      // Gebäudetyp -> [{ id, name, task, coins }]
  const rbOpen = new Set();  // aufgeklappte Wachen

  // Fahrzeugkatalog aus dem Shop der Wache (nur lesen), je Gebäudetyp einen Tag zwischengespeichert
  async function loadShop(building, force) {
    const key = 'resiHelfer.shop.' + building.buildingType;
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (!force && cached && Date.now() - cached.t < 86400000) return cached.list;
    const html = await fetch('vehicleShop/' + building.userBuildingID).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const list = [...doc.querySelectorAll('.element-card[vehicleid]')].map(c => {
      const prices = [...c.textContent.replace(/\s+/g, ' ').matchAll(/([\d.]+)\s*Münzen/g)];
      return {
        id: +c.getAttribute('vehicleid'),
        name: c.querySelector('.element-card-description-name')?.textContent.trim() || '?',
        task: c.querySelector('.element-card-description-task')?.textContent.trim() || '',
        coins: prices.length ? +prices[prices.length - 1][1].replace(/\./g, '') : 0, // letzter Treffer = Preis
      };
    });
    const uniq = [...new Map(list.map(v => [v.id, v])).values()];
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), list: uniq }));
    return uniq;
  }

  function loadRealbau(force) {
    if (rbLoading) return rbLoading;
    rbError = '';
    rbLoading = (async () => {
      const [buildings, vehicles] = await Promise.all([
        fetch('/api/userBuildings').then(r => r.json()),
        fetch('/api/userVehicles').then(r => r.json()),
      ]);
      rbBuildings = buildings;
      rbVehicles = vehicles;
      for (const b of buildings) {
        if (rbCatalog[b.buildingType] && !force) continue;
        try { rbCatalog[b.buildingType] = await loadShop(b, force); } catch (e) { rbCatalog[b.buildingType] = []; }
      }
      rbLoaded = Date.now();
    })()
      .catch(e => { rbError = 'Wachen und Fahrzeuge konnten nicht geladen werden.'; console.warn('[ReSi-Helfer]', e); })
      .finally(() => { rbLoading = null; if (ccPage === 'realbau' && document.getElementById('rh-cc')) renderCenter(); });
    return rbLoading;
  }

  // Ist-Bestand einer Wache: Fahrzeugtyp -> Anzahl
  function rbIst(buildingId) {
    const m = new Map();
    (rbVehicles || []).forEach(v => { if (String(v.userBuildingID) === String(buildingId)) m.set(v.vehicleID, (m.get(v.vehicleID) || 0) + 1); });
    return m;
  }
  // Auswertung einer Wache
  function rbStation(b) {
    const cat = rbCatalog[b.buildingType] || [];
    const byId = new Map(cat.map(v => [v.id, v]));
    const soll = realbau[b.userBuildingID] || {};
    const ist = rbIst(b.userBuildingID);
    const ids = [...new Set([...Object.keys(soll).map(Number), ...ist.keys()])];
    const rows = ids.map(id => {
      const s = +soll[id] || 0, i = ist.get(id) || 0, v = byId.get(id) || { id, name: `Typ ${id}`, task: '', coins: 0 };
      return { ...v, s, i, missing: Math.max(0, s - i), extra: s ? Math.max(0, i - s) : 0 };
    }).sort((a, b) => (b.s > 0) - (a.s > 0) || a.name.localeCompare(b.name, 'de'));
    const sollSum = rows.reduce((t, r) => t + r.s, 0);
    const done = rows.reduce((t, r) => t + Math.min(r.s, r.i), 0);
    const cost = rows.reduce((t, r) => t + r.missing * r.coins, 0);
    return { cat, rows, sollSum, done, cost, planned: sollSum > 0 };
  }

  function renderRealbau(body, h2, p) {
    h2.textContent = 'Realbau';
    p.textContent = 'Soll/Ist pro Wache: Trag ein, welche echten Fahrzeuge an der Wache stehen – das Skript zeigt, was noch fehlt.';
    if (!rbLoading && Date.now() - rbLoaded > 60000) loadRealbau();
    if (!rbBuildings) {
      body.innerHTML = `<div class="rh-st-loading">${rbError || 'Lade Wachen, Fahrzeuge und Fahrzeugkatalog …'}</div>`;
      return;
    }
    const stations = rbBuildings
      .filter(b => (rbCatalog[b.buildingType] || []).length) // nur Gebäude mit Fahrzeugen
      .map(b => ({ b, r: rbStation(b) }));
    if (stations.length <= 3 && !rbOpen.size) stations.forEach(s => rbOpen.add(String(s.b.userBuildingID)));

    const planned = stations.filter(s => s.r.planned);
    const sollAll = planned.reduce((t, s) => t + s.r.sollSum, 0);
    const doneAll = planned.reduce((t, s) => t + s.r.done, 0);
    const costAll = planned.reduce((t, s) => t + s.r.cost, 0);
    const complete = planned.filter(s => s.r.done >= s.r.sollSum).length;

    const rowHtml = (b, r) => {
      let state;
      if (!r.s) state = `<span class="rh-rb-chip rh-rb-gray" title="Steht im Spiel, ist aber nicht im Soll">nicht im Soll</span>`;
      else if (r.missing) state = `<span class="rh-rb-chip rh-rb-red">fehlt ${r.missing}</span>`;
      else state = `<span class="rh-rb-chip rh-rb-green">✓${r.extra ? ` +${r.extra}` : ''}</span>`;
      return `
        <div class="rh-rb-row">
          <div class="rh-rb-name"><b>${r.name}</b><small>${r.task}</small></div>
          <div class="rh-rb-count" title="Ist / Soll">${r.i} / ${r.s}</div>
          <div class="rh-rb-step">
            <button data-rb-act="dec" data-b="${b.userBuildingID}" data-v="${r.id}" title="Soll verringern" ${r.s ? '' : 'disabled'}>−</button>
            <button data-rb-act="inc" data-b="${b.userBuildingID}" data-v="${r.id}" title="Soll erhöhen">+</button>
          </div>
          <div class="rh-rb-state">${state}</div>
          <div class="rh-rb-cost">${r.missing && r.coins ? `${nf(r.missing * r.coins)}` : ''}</div>
        </div>`;
    };

    body.innerHTML = `
      <div class="rh-st-kpis">
        <div class="rh-st-kpi"><small>Fahrzeuge laut Soll</small><b>${doneAll} / ${sollAll}</b><em>${sollAll ? Math.round(doneAll / sollAll * 100) + ' % erreicht' : 'Noch kein Soll eingetragen'}</em></div>
        <div class="rh-st-kpi"><small>Fehlen noch</small><b class="${sollAll - doneAll ? 'rh-neg' : 'rh-pos'}">${sollAll - doneAll}</b><em>Fahrzeuge</em></div>
        <div class="rh-st-kpi"><small>Kosten für den Rest</small><b>${nf(costAll)}</b><em>Münzen (Shop-Preise)</em></div>
        <div class="rh-st-kpi"><small>Wachen komplett</small><b>${complete} / ${planned.length}</b><em>${stations.length - planned.length ? `${stations.length - planned.length} ohne Soll` : '&nbsp;'}</em></div>
      </div>
      ${stations.map(({ b, r }) => {
        const open = rbOpen.has(String(b.userBuildingID));
        const pct = r.sollSum ? Math.round(r.done / r.sollSum * 100) : 0;
        const options = r.cat.slice().sort((x, y) => x.name.localeCompare(y.name, 'de'))
          .map(v => `<option value="${v.id}">${v.name}${v.task ? ' – ' + v.task : ''}${v.coins ? ` (${nf(v.coins)})` : ''}</option>`).join('');
        return `
        <div class="rh-rb-st${open ? ' rh-open' : ''}">
          <div class="rh-rb-head" data-rb-toggle="${b.userBuildingID}">
            <b>${b.userBuildingName}</b>
            <span class="rh-rb-prog">${r.planned ? `${r.done} / ${r.sollSum}` : 'kein Soll'}</span>
            <span class="rh-rb-bar"><i style="width:${pct}%"></i></span>
            ${r.cost ? `<span class="rh-rb-headcost">${nf(r.cost)} Münzen</span>` : ''}
            <span class="rh-caret">▾</span>
          </div>
          ${open ? `
          <div class="rh-rb-body">
            ${r.rows.length ? `
              <div class="rh-rb-row rh-rb-th"><div>Fahrzeug</div><div>Ist / Soll</div><div>Soll</div><div>Status</div><div>Kosten</div></div>
              ${r.rows.map(row => rowHtml(b, row)).join('')}` : '<div class="rh-st-empty">Noch keine Fahrzeuge – füg unten welche hinzu.</div>'}
            <div class="rh-rb-add">
              <select data-rb-sel="${b.userBuildingID}">${options}</select>
              <button class="rh-btn" data-rb-act="add" data-b="${b.userBuildingID}">+ Ins Soll</button>
              <button class="rh-btn" data-rb-act="fromIst" data-b="${b.userBuildingID}" title="Setzt das Soll auf den aktuellen Bestand im Spiel">Ist übernehmen</button>
              ${r.planned ? `<button class="rh-btn rh-danger" data-rb-act="clear" data-b="${b.userBuildingID}">Soll leeren</button>` : ''}
            </div>
          </div>` : ''}
        </div>`;
      }).join('') || '<div class="rh-st-empty">Keine Wachen mit Fahrzeugen gefunden.</div>'}
      <div class="rh-st-foot"><span>${rbError || `Stand ${new Date(rbLoaded).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · Preise aus dem Fahrzeug-Shop`}</span>
        <button class="rh-btn" data-rb-act="reload" ${rbLoading ? 'disabled' : ''}>${rbLoading ? 'Lädt …' : 'Aktualisieren'}</button></div>`;
  }

  function onRealbauClick(el) {
    const tog = el.dataset.rbToggle;
    if (tog) { rbOpen.has(tog) ? rbOpen.delete(tog) : rbOpen.add(tog); return renderCenter(); }
    const act = el.dataset.rbAct, b = el.dataset.b, v = el.dataset.v;
    const soll = (realbau[b] ||= {});
    if (act === 'inc') soll[v] = (+soll[v] || 0) + 1;
    else if (act === 'dec') { soll[v] = Math.max(0, (+soll[v] || 0) - 1); if (!soll[v]) delete soll[v]; }
    else if (act === 'add') {
      const id = document.querySelector(`#rh-cc [data-rb-sel="${b}"]`)?.value;
      if (id) soll[id] = (+soll[id] || 0) + 1;
    } else if (act === 'fromIst') {
      if (Object.keys(soll).length && !confirm('Das bisherige Soll dieser Wache durch den aktuellen Bestand ersetzen?')) return;
      realbau[b] = Object.fromEntries(rbIst(b));
    } else if (act === 'clear') {
      if (!confirm('Soll dieser Wache wirklich leeren?')) return;
      delete realbau[b];
    } else if (act === 'reload') { loadRealbau(true); return renderCenter(); }
    if (realbau[b] && !Object.keys(realbau[b]).length) delete realbau[b];
    saveRealbau();
    renderCenter();
  }

  function afterChange() {
    saveSettings();
    applySettings();
    renderCenter();
  }

  async function onCenterClick(e) {
    const rbEl = e.target.closest('[data-rb-act],[data-rb-toggle]');
    if (rbEl) { if (!rbEl.disabled) onRealbauClick(rbEl); return; }
    const range = e.target.closest('[data-range]');
    if (range) { statRange = range.dataset.range; statShift = 0; return renderCenter(); }
    const shift = e.target.closest('[data-shift]');
    if (shift) { if (!shift.disabled) statShift = Math.min(0, statShift + +shift.dataset.shift); return renderCenter(); }
    if (e.target.closest('[data-act="txReload"]')) { loadTx(); return; }
    const chip = e.target.closest('[data-filter]');
    if (chip) { ccFilter = chip.dataset.filter; return renderCenter(); }
    const test = e.target.closest('[data-test]')?.dataset.test;
    if (test === 's5') return beep(SOUND_S5);
    if (test === 'call') return beep(SOUND_CALL);

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rec') {
      const k = e.target.closest('[data-key]').dataset.key;
      ccRecording = ccRecording === k ? null : k;
      return renderCenter();
    }
    if (act === 'checkUpdate') { e.target.textContent = 'Prüfe …'; return checkForUpdate(true); }
    if (e.target.closest('[data-update]')) return installUpdate();
    if (act === 'keysDefault') { settings.keys = Object.assign({}, DEFAULTS.keys); ccRecording = null; return afterChange(); }
    if (act === 'resetDay') { daily = { date: todayStr(), earned: 0, finished: 0 }; saveDaily(); renderHeaderStats(); return renderCenter(); }
    if (act === 'export') {
      const data = { app: 'resi-helfer', version: VERSION, settings, notes, realbau, exported: new Date().toISOString() };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `resi-helfer-sicherung-${todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    if (act === 'import') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        try {
          const data = JSON.parse(await input.files[0].text());
          if (data.app !== 'resi-helfer') throw new Error('Keine ReSi-Helfer-Sicherung');
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign({}, DEFAULTS, data.settings || {})));
          localStorage.setItem(NOTES_KEY, JSON.stringify(data.notes || {}));
          if (data.realbau) localStorage.setItem(RB_KEY, JSON.stringify(data.realbau));
          location.reload();
        } catch (err) { alert('Import fehlgeschlagen: ' + err.message); }
      };
      input.click();
      return;
    }
    if (act === 'reset') {
      if (!confirm('Alle ReSi-Helfer-Einstellungen, Wachen-Notizen und den Tageszähler löschen?')) return;
      [SETTINGS_KEY, NOTES_KEY, DAILY_KEY, TX_KEY, RB_KEY].forEach(k => localStorage.removeItem(k));
      location.reload();
      return;
    }

    const toggle = e.target.closest('.rh-cc-card[data-k], .rh-cc-row.rh-toggle[data-k]');
    if (!toggle) return;
    const k = toggle.dataset.k;
    settings[k] = !settings[k];
    if (k === 'callDesktop' && settings.callDesktop && 'Notification' in window && Notification.permission !== 'granted') {
      if (await Notification.requestPermission() !== 'granted') settings.callDesktop = false;
    }
    afterChange();
  }

  function onCenterInput(e) {
    if (e.target.classList.contains('rh-cc-search')) { ccQuery = e.target.value; return renderCenter(); }
    if (e.target.dataset.set === 'volume') { settings.volume = +e.target.value; saveSettings(); }
  }

  function onCenterChange(e) {
    const k = e.target.dataset.set;
    if (!k || k === 'volume') return;
    const v = Math.max(+e.target.min || 0, Math.min(+e.target.max || 9999, +e.target.value || 0));
    e.target.value = v;
    settings[k] = v;
    afterChange();
  }

  // Tastenkürzel aufnehmen (läuft vor allen anderen Tasten-Handlern)
  document.addEventListener('keydown', e => {
    if (!ccRecording || !document.getElementById('rh-cc')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { ccRecording = null; return renderCenter(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { settings.keys[ccRecording] = ''; ccRecording = null; return afterChange(); }
    const combo = comboFromEvent(e);
    if (!combo) return; // nur Strg/Shift/Alt gedrückt – auf die eigentliche Taste warten
    for (const k of Object.keys(settings.keys)) if (settings.keys[k] === combo) settings.keys[k] = ''; // doppelte Belegung lösen
    settings.keys[ccRecording] = combo;
    ccRecording = null;
    afterChange();
  }, true);

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { ccRecording = null; closeCenter(); } });


  // =====================================================================
  // EINSATZFENSTER: Box "benötigte Fahrzeuge" + Fahrzeuglisten-Filter
  // =====================================================================
  function runMissionFrame() {
    const missionTypeId = document.querySelector('.detail-title[missionid]').getAttribute('missionid');
    const missionId = location.pathname.match(/\/mission\/(\d+)/)[1];

    const style = document.createElement('style');
    style.textContent = `
      /* ===== Einsatz-Check ===== */
      #rh-mbox { --ok:#28a745; --warn:#fab005; --sel:#28a745; --bad:#DB1111; --line:rgba(255,255,255,.14); --state:#868e96;
        margin:0 0 12px; background:linear-gradient(180deg,#21242b,#21242b); border:1px solid var(--line);
        border-left:4px solid var(--state); border-radius:8px; color:#fff; font-size:13px; line-height:1.35; }
      #rh-mbox[data-state="bad"]  { --state:var(--bad); }
      #rh-mbox[data-state="warn"] { --state:var(--warn); }
      #rh-mbox[data-state="ok"]   { --state:var(--ok); }

      #rh-mbox .rh-top { display:flex; align-items:center; gap:10px; padding:8px 12px; cursor:pointer; user-select:none; }
      #rh-mbox .rh-title { flex:1; min-width:0; font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #rh-mbox .rh-id { font-size:11px; color:#adb5bd; background:rgba(255,255,255,.08); border-radius:999px; padding:1px 8px; font-variant-numeric:tabular-nums; }
      #rh-mbox .rh-state { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--state); white-space:nowrap; }
      #rh-mbox .rh-caret { color:#868e96; transition:transform .15s; }
      #rh-mbox.rh-collapsed .rh-caret { transform:rotate(-90deg); }
      #rh-mbox.rh-collapsed .rh-body { display:none; }
      #rh-mbox .rh-body { padding:0 12px 10px; }

      #rh-mbox .rh-meter { display:flex; height:6px; background:rgba(255,255,255,.08); border-radius:3px; overflow:hidden; }
      #rh-mbox .rh-meter i { display:block; height:100%; }
      #rh-mbox .rh-meter-label { display:flex; justify-content:space-between; margin:4px 0 8px; font-size:11px; color:#adb5bd; }

      #rh-mbox .rh-reqs { display:flex; flex-wrap:wrap; gap:5px; }
      #rh-mbox .rh-req { display:inline-flex; align-items:center; gap:6px; background:rgba(255,255,255,.07); border-radius:6px;
        padding:4px 8px; cursor:default; }
      #rh-mbox .rh-req.rh-open { box-shadow:inset 0 0 0 1px rgba(250,82,82,.55); }
      #rh-mbox .rh-qty { font-size:11px; color:#adb5bd; font-variant-numeric:tabular-nums; }
      #rh-mbox .rh-name { font-size:12.5px; font-weight:700; color:#fff; white-space:nowrap; }
      #rh-mbox .rh-pips { display:flex; gap:3px; align-items:center; }
      #rh-mbox .rh-pip { width:9px; height:9px; border-radius:50%; box-sizing:border-box; }
      #rh-mbox .rh-count { font-size:11px; color:#adb5bd; font-variant-numeric:tabular-nums; margin-left:2px; }
      .rh-p-onscene { background:var(--ok); } .rh-p-enroute { background:var(--warn); }
      .rh-p-selected { background:var(--sel); } .rh-p-missing { border:2px solid var(--bad); }

      #rh-mbox .rh-note { display:flex; gap:6px; margin-top:8px; padding:6px 8px; border-radius:6px; font-size:12px;
        background:rgba(250,82,82,.12); color:#ffb3b3; }
      #rh-mbox .rh-stats { display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:8px; padding-top:8px;
        border-top:1px dashed var(--line); font-size:12px; color:#adb5bd; }
      #rh-mbox .rh-stats b { color:#fff; font-weight:600; font-variant-numeric:tabular-nums; }
      #rh-mbox .rh-foot { margin-top:6px; font-size:11px; color:#7d858f; }

      /* ===== Filter über der Fahrzeugliste ===== */
      #rh-listbar { display:flex; gap:6px; align-items:center; margin:4px 0 8px; flex-wrap:wrap; }
      #rh-listbar .rh-tgl { cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:6px;
        border:1px solid rgba(255,255,255,.14); border-radius:6px; padding:3px 10px; font-size:12px; background:#21242b; color:#ced4da; }
      #rh-listbar .rh-tgl::before { content:''; width:10px; height:10px; border-radius:3px; border:1.5px solid #6c757d; box-sizing:border-box; }
      #rh-listbar .rh-tgl.rh-on { border-color:#28a745; color:#fff; background:rgba(40,167,69,.12); }
      #rh-listbar .rh-tgl.rh-on::before { background:#28a745; border-color:#28a745; }
      #rh-listbar .rh-info { font-size:12px; color:#868e96; }
      #rh-listbar .rh-dist { display:inline-flex; align-items:center; gap:7px; border:1px solid rgba(255,255,255,.14); border-radius:6px;
        padding:2px 10px; font-size:12px; background:#21242b; color:#ced4da; }
      #rh-listbar .rh-dist.rh-on { border-color:#28a745; background:rgba(40,167,69,.12); color:#fff; }
      #rh-listbar .rh-dist input { width:90px; margin:0; accent-color:#28a745; }
      #rh-listbar .rh-dist b { min-width:46px; font-weight:600; font-variant-numeric:tabular-nums; }
      #rh-listbar .rh-keys { margin-left:auto; font-size:11px; color:#7d858f; white-space:nowrap; }
      #rh-listbar kbd { display:inline-block; min-width:16px; padding:0 4px; border-radius:4px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14);
        border-bottom-width:2px; color:#dee2e6; font:600 10.5px/15px inherit; text-align:center; }

      .rh-flash { animation:rh-flash .35s ease-out; }
      @keyframes rh-flash { from { box-shadow:0 0 0 3px #28a745; } }
      .mission-vehicle.rh-hidden { display:none !important; }

      /* ---- Rettungssimulator-Design ---- */
      #rh-mbox { --ok:#28a745; --warn:#FFB300; --sel:#2196F3; --bad:#DB1111; background:#21242b; border:0; border-radius:15px;
        overflow:hidden; box-shadow:0 3px 3px rgba(0,0,0,.13); font-family:"Segoe UI", sans-serif; }
      #rh-mbox .rh-top { background:#DB1111; padding:6px 12px; }
      #rh-mbox .rh-id { background:rgba(0,0,0,.25); color:#fff; }
      #rh-mbox .rh-state { padding:0 9px; border-radius:100px; background:rgba(0,0,0,.3); color:#fff; letter-spacing:.03em; }
      #rh-mbox[data-state="ok"] .rh-state { background:#28a745; }
      #rh-mbox[data-state="warn"] .rh-state { background:#FFB300; color:#21242b; }
      #rh-mbox .rh-caret { color:#fff; }
      #rh-mbox .rh-body { padding:10px 12px 12px; }
      #rh-mbox .rh-meter { background:#282c35; }
      #rh-mbox .rh-req { background:#282c35; border-radius:100px; }
      #rh-mbox .rh-req.rh-open { box-shadow:inset 0 0 0 2px #DB1111; }
      #rh-mbox .rh-note { background:rgba(219,17,17,.15); color:#ff8a8a; border-radius:12.5px; }
      #rh-mbox .rh-stats { border-top:1px solid rgba(255,255,255,.08); }
      #rh-listbar .rh-tgl, #rh-listbar .rh-dist { border:2px solid #b1b1b1; background:transparent; color:#b1b1b1; border-radius:100px; font:700 12px Arial, sans-serif; padding:3px 12px; }
      #rh-listbar .rh-tgl::before { border-color:#b1b1b1; border-radius:100px; }
      #rh-listbar .rh-tgl.rh-on, #rh-listbar .rh-dist.rh-on { border-color:#28a745; color:#28a745; background:transparent; }
      #rh-listbar .rh-tgl.rh-on::before { background:#28a745; border-color:#28a745; }
      #rh-listbar .rh-dist input { accent-color:#28a745; }
      #rh-listbar kbd { background:#21242b; border-color:rgba(255,255,255,.18); }
    `;
    document.head.appendChild(style);

    // ---------- Daten laden ----------
    let categories = null, missionType = null, ownVehicles = new Map();

    async function loadCategories() {
      try { if (typeof vehicleCategories !== 'undefined') return vehicleCategories; } catch (e) { /* nicht vorhanden */ }
      return fetch('/api/vehicleCategories').then(r => r.json());
    }
    async function loadMissionType() {
      const key = 'resiHelfer.missionType.' + missionTypeId;
      const cached = sessionStorage.getItem(key);
      if (cached) return JSON.parse(cached);
      const data = await fetch('/api/missions/' + missionTypeId).then(r => r.json());
      sessionStorage.setItem(key, JSON.stringify(data));
      return data;
    }
    let lastVehicleFetch = 0, vehicleFetchTimer = null;
    function refreshOwnVehicles() {
      // höchstens alle 2 Sekunden beim Server nachfragen
      clearTimeout(vehicleFetchTimer);
      const wait = Math.max(0, 2000 - (Date.now() - lastVehicleFetch));
      vehicleFetchTimer = setTimeout(async () => {
        lastVehicleFetch = Date.now();
        try {
          const list = await fetch('/api/userVehicles').then(r => r.json());
          ownVehicles = new Map(list.map(v => [String(v.userVehicleID), v]));
          update();
        } catch (e) { console.warn('[ReSi-Helfer] userVehicles fehlgeschlagen', e); }
      }, wait);
    }

    // Welche Kategorien erfüllen eine Anforderung? (z. B. "lf" -> lf, tlf, hlf, lgf)
    const expandCache = {};
    function expand(cat) {
      if (expandCache[cat]) return expandCache[cat];
      const out = new Set(), todo = [cat];
      while (todo.length) {
        const c = todo.pop();
        if (out.has(c)) continue;
        out.add(c);
        (categories?.[c]?.roles || []).forEach(r => todo.push(r));
      }
      return (expandCache[cat] = out);
    }
    // Kategorien eines Fahrzeugs über seine Typ-ID
    const typeCatCache = {};
    function catsOfType(vehicleID) {
      if (typeCatCache[vehicleID]) return typeCatCache[vehicleID];
      const cats = Object.entries(categories || {}).filter(([, c]) => (c.ids || []).includes(vehicleID)).map(([k]) => k);
      return (typeCatCache[vehicleID] = cats);
    }
    function catsOfVehicle(userVehicleID, fallbackCat) {
      const v = ownVehicles.get(String(userVehicleID));
      const cats = v ? catsOfType(v.vehicleID) : [];
      return cats.length ? cats : (fallbackCat ? [fallbackCat] : []);
    }
    const fits = (vehicleCats, req) => { const ok = expand(req); return vehicleCats.some(c => ok.has(c)); };
    const catName = c => categories?.[c]?.name || categories?.[c]?.readableShortName || c;

    // ---------- Berechnung ----------
    function computeCoverage() {
      const assigned = []; // {id, cats, state}
      // eigene Fahrzeuge, die diesem Einsatz zugeordnet sind
      for (const [id, v] of ownVehicles) {
        if (String(v.userMissionID) !== missionId) continue;
        const state = v.fms === 4 ? 'onscene' : v.fms === 3 ? 'enroute' : 'onscene'; // 7/8 = Transport, zählt als dagewesen
        assigned.push({ id, cats: catsOfType(v.vehicleID), state });
      }
      // aktuell ausgewählte Fahrzeuge (noch nicht alarmiert)
      const seen = new Set(assigned.map(a => a.id));
      document.querySelectorAll('#mission-vehicle-group-by-vehicle .mission-vehicle.mission-vehicle-selected').forEach(el => {
        const id = el.getAttribute('uservehicleid');
        if (seen.has(id)) return;
        seen.add(id);
        assigned.push({ id, cats: catsOfVehicle(id, el.getAttribute('vehiclecategory')), state: 'selected' });
      });

      const prio = { onscene: 0, enroute: 1, selected: 2 };
      assigned.sort((a, b) => prio[a.state] - prio[b.state]);

      // spezifische Anforderungen zuerst bedienen (weniger passende Kategorien)
      const reqs = Object.entries(missionType?.neededVehicles || {})
        .map(([cat, count]) => ({ cat, count, onscene: 0, enroute: 0, selected: 0, missing: 0 }))
        .sort((a, b) => expand(a.cat).size - expand(b.cat).size);
      const used = new Set();
      for (const r of reqs) {
        for (let i = 0; i < r.count; i++) {
          const v = assigned.find(a => !used.has(a.id) && fits(a.cats, r.cat));
          if (v) { used.add(v.id); r[v.state]++; } else r.missing++;
        }
      }
      // ursprüngliche Reihenfolge der API für die Anzeige
      const order = Object.keys(missionType?.neededVehicles || {});
      reqs.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
      return reqs;
    }

    // ---------- Box ----------
    const box = document.createElement('div');
    box.id = 'rh-mbox';
    // rechte Spalte, über "Fahrzeuge auf Anfahrt"; sonst oben über dem Hinweis des Spiels
    const rightColumn = document.querySelector('.alarmed-vehicles');
    if (rightColumn) rightColumn.insertBefore(box, rightColumn.firstChild);
    else {
      const anchor = document.querySelector('.missing-vehicles');
      anchor?.parentNode.insertBefore(box, anchor);
    }

    const fmt = n => Number(n).toLocaleString('de-DE');

    // Text aus dem eigenen Hinweis des Spiels ("Es fehlen noch: ..."), falls sichtbar
    function gameMissingText() {
      const el = document.querySelector('.missing-vehicles');
      if (!el || el.style.display === 'none') return '';
      const parts = ['missingVehicles', 'missingQualifications']
        .map(id => document.getElementById(id)?.textContent.trim()).filter(Boolean);
      return parts.join(' · ').replace(/^Es fehlen noch:\s*/i, 'es fehlen noch ');
    }

    function renderBox(reqs) {
      if (!settings.missionBox || !missionType) { box.style.display = 'none'; return; }
      box.style.display = '';
      box.classList.toggle('rh-collapsed', !!settings.missionBoxCollapsed);

      const missingCount = reqs.reduce((s, r) => s + r.missing, 0);
      const pendingSel = reqs.some(r => r.selected > 0);
      // Meldung des Spiels nach der Lagemeldung (berücksichtigt Variationen) hat Vorrang
      const gameMissing = gameMissingText();

      let state, stateText;
      if (gameMissing || missingCount) { state = 'bad'; stateText = 'Unvollständig'; }
      else if (pendingSel) { state = 'warn'; stateText = 'Noch alarmieren'; }
      else { state = 'ok'; stateText = 'Abgedeckt'; }
      box.dataset.state = state;

      // Fortschrittsbalken über alle benötigten Einheiten
      const total = reqs.reduce((s, r) => s + r.count, 0) || 1;
      const sum = k => reqs.reduce((s, r) => s + r[k], 0);
      const seg = (k, color) => sum(k) ? `<i style="width:${(sum(k) / total) * 100}%;background:var(${color})"></i>` : '';
      const covered = total - missingCount;

      const LABEL = { onscene: 'vor Ort', enroute: 'auf Anfahrt', selected: 'ausgewählt', missing: 'fehlt' };
      const pips = r => {
        if (r.count > 8) {
          return `<span class="rh-count">${r.onscene + r.enroute + r.selected}/${r.count}</span>`;
        }
        const list = [];
        ['onscene', 'enroute', 'selected', 'missing'].forEach(k => { for (let i = 0; i < r[k]; i++) list.push(k); });
        return list.map(k => `<span class="rh-pip rh-p-${k}" title="${LABEL[k]}"></span>`).join('');
      };
      const abbr = c => categories?.[c]?.readableShortName || c.toUpperCase();
      const range = (a, b) => b > a ? `${fmt(a)} – ${fmt(b)}` : fmt(a);

      const mins = Math.max(1, Math.round((missionType.duration || 0) / 60));
      box.innerHTML = `
        <div class="rh-top" title="Ein-/ausklappen">
          <span class="rh-title">${missionType.name}</span>
          <span class="rh-id">#${missionType.id}</span>
          <span class="rh-state">${stateText}</span>
          <span class="rh-caret">▾</span>
        </div>
        <div class="rh-body">
          <div class="rh-meter">${seg('onscene', '--ok')}${seg('enroute', '--warn')}${seg('selected', '--sel')}</div>
          <div class="rh-meter-label"><span>Mindestanforderung</span><span>${covered} / ${reqs.length ? total : 0} abgedeckt</span></div>
          <div class="rh-reqs">
            ${reqs.map(r => `
              <div class="rh-req${r.missing ? ' rh-open' : ''}" title="${r.count}× ${catName(r.cat)}">
                <span class="rh-qty">${r.count}×</span>
                <span class="rh-name">${abbr(r.cat)}</span>
                <span class="rh-pips">${pips(r)}</span>
              </div>`).join('') || '<div class="rh-req"><span class="rh-name">Keine Angaben zum Einsatz</span></div>'}
          </div>
          ${gameMissing ? `<div class="rh-note"><span>⚠</span><span>Lagemeldung: ${gameMissing}</span></div>` : ''}
          <div class="rh-stats">
            <span>Vergütung <b>${range(missionType.credits, missionType.maxCredits)}</b></span>
            <span>Verband <b>${range(Math.round(missionType.credits * 0.8), Math.round(missionType.maxCredits * 0.8))}</b></span>
            <span>Dauer <b>~${mins} Min</b></span>
          </div>
          <div class="rh-foot">Variationen können mehr Fahrzeuge erfordern – die Lagemeldung zählt.</div>
        </div>`;
    }
    box.addEventListener('click', e => {
      if (!e.target.closest('.rh-top')) return;
      settings.missionBoxCollapsed = !settings.missionBoxCollapsed;
      saveSettings();
      update();
    });

    // ---------- Fahrzeugliste filtern ----------
    const listContainer = document.querySelector('.mission-vehicles-group-container');
    const listbar = document.createElement('div');
    listbar.id = 'rh-listbar';
    listContainer?.parentNode.insertBefore(listbar, listContainer);

    // Aufbau einmalig, danach nur Zustände aktualisieren (sonst bricht das Ziehen am Regler ab)
    listbar.innerHTML = `
      <span class="rh-tgl" data-k="listOnlyFree" title="Nur Fahrzeuge in Status 1 oder 2 zeigen">Nur freie (S1/S2)</span>
      <span class="rh-tgl" data-k="listOnlyNeeded" title="Nur Fahrzeuge zeigen, die eine noch fehlende Anforderung erfüllen">Nur benötigte</span>
      <label class="rh-dist" title="Nur Fahrzeuge in diesem Umkreis zeigen (ganz links = alle)">Umkreis
        <input type="range" min="0" max="30" step="1"><b></b></label>
      <span class="rh-info"></span>
      <span class="rh-keys" title="Einsatz-Hotkeys – belegen unter Kontrollzentrum › Einstellungen"></span>`;
    const distInput = listbar.querySelector('.rh-dist input');
    const distLabel = listbar.querySelector('.rh-dist b');

    function renderListbar(hiddenCount) {
      listbar.style.display = settings.listBar ? '' : 'none';
      listbar.querySelectorAll('.rh-tgl').forEach(t => t.classList.toggle('rh-on', !!settings[t.dataset.k]));
      const km = +settings.listMaxKm || 0;
      if (document.activeElement !== distInput) distInput.value = km;
      distLabel.textContent = km ? `≤ ${km} km` : 'alle';
      listbar.querySelector('.rh-dist').classList.toggle('rh-on', km > 0);
      listbar.querySelector('.rh-info').textContent = hiddenCount ? `${hiddenCount} ausgeblendet` : '';
      const keysEl = listbar.querySelector('.rh-keys');
      keysEl.style.display = settings.hotkeys ? '' : 'none';
      const k = settings.keys;
      const parts = [['alarm', 'Alarm'], ['alarmClose', '+ Schließen'], ['share', 'Freigeben']]
        .filter(([a]) => k[a]).map(([a, l]) => `${prettyCombo(k[a])} ${l}`);
      const nav = [k.prevMission, k.nextMission].filter(Boolean).map(prettyCombo).join(' / ');
      if (nav) parts.push(`${nav} Einsatz wechseln`);
      const legend = parts.join(' · ');
      if (keysEl.innerHTML !== legend) keysEl.innerHTML = legend;
    }
    listbar.addEventListener('click', e => {
      const k = e.target.closest('.rh-tgl')?.dataset.k;
      if (!k) return;
      settings[k] = !settings[k];
      saveSettings();
      update();
    });
    distInput.addEventListener('input', () => {
      settings.listMaxKm = +distInput.value;
      saveSettings();
      update();
    });
    const vehicleKm = el => parseFloat((el.querySelector('.vehicle-distance')?.textContent || '').replace('~', '').replace(',', '.'));

    // "1x Löschfahrzeug, 2x RTW" aus der Spielmeldung -> Kategorie-Schlüssel
    function gameMissingCats() {
      const el = document.querySelector('.missing-vehicles');
      if (!el || el.style.display === 'none') return [];
      const txt = document.getElementById('missingVehicles')?.textContent || '';
      const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
      return [...txt.matchAll(/\d+\s*x\s*([^,]+)/gi)].map(m => norm(m[1])).map(name =>
        Object.keys(categories).find(k => norm(categories[k].name || '') === name || norm(categories[k].readableShortName || '') === name)
      ).filter(Boolean);
    }

    function filterList(reqs) {
      const stillMissing = [...reqs.filter(r => r.missing > 0).map(r => r.cat), ...gameMissingCats()];
      let hidden = 0;
      const counted = new Set();
      document.querySelectorAll('.mission-vehicles-group-container .mission-vehicle[uservehicleid]').forEach(el => {
        const id = el.getAttribute('uservehicleid');
        const status = +(el.querySelector('.vehicle-status')?.className.match(/\bs(\d+)\b/)?.[1] || 0);
        let hide = false;
        if (settings.listBar && !el.classList.contains('mission-vehicle-selected')) { // ausgewählte nie ausblenden
          if (settings.listOnlyFree && status !== 1 && status !== 2) hide = true;
          const km = vehicleKm(el);
          if (settings.listMaxKm > 0 && km > settings.listMaxKm) hide = true;
          if (settings.listOnlyNeeded) {
            const cats = catsOfVehicle(id, el.getAttribute('vehiclecategory'));
            if (!stillMissing.some(req => fits(cats, req))) hide = true;
          }
        }
        el.classList.toggle('rh-hidden', hide);
        if (hide && !counted.has(id)) { counted.add(id); hidden++; }
      });
      renderListbar(hidden);
    }

    // ---------- Aktualisieren ----------
    function update() {
      if (!categories) return;
      const reqs = computeCoverage();
      renderBox(reqs);
      filterList(reqs);
    }

    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; update(); });
    };
    // Auswahl / Status in der Liste
    document.querySelectorAll('#mission-vehicle-group-by-vehicle, #mission-vehicle-group-by-building').forEach(el =>
      new MutationObserver(schedule).observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }));
    // Fahrzeuge auf Anfahrt / vor Ort -> Serverdaten neu holen
    const alarmed = document.querySelector('.alarmed-vehicles');
    if (alarmed) new MutationObserver(refreshOwnVehicles).observe(alarmed, { subtree: true, childList: true });
    // Hinweis des Spiels zu fehlenden Fahrzeugen
    const gameHint = document.querySelector('.missing-vehicles');
    if (gameHint) new MutationObserver(schedule).observe(gameHint, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });

    // ---------- Hotkeys (frei belegbar, nur Alarmieren/Freigeben) ----------
    const MISSION_BUTTONS = {
      alarm: '.alarming-submit',
      alarmClose: '.alarming-submit-close',
      share: '.alarming-submit-share',
      shareClose: '.alarming-submit-share-close',
    };
    // Zum vorherigen/nächsten Einsatz in der Einsatzliste der Leitstelle springen (am Ende geht es von vorn los)
    function gotoMission(step) {
      let top;
      try { top = window.top.document; } catch (e) { return false; } // Einsatz in eigenem Tab geöffnet
      const own = [...top.querySelectorAll('#missions-container-own .mission-list-mission[usermissionid]')];
      const shared = [...top.querySelectorAll('#missions-container-shared .mission-list-mission[usermissionid]')];
      const idOf = el => el.getAttribute('usermissionid');
      // in der Liste bleiben, in der der aktuelle Einsatz steht (eigene Einsätze oder Freigaben)
      const list = shared.some(el => idOf(el) === missionId) ? shared : own;
      if (!list.length) return true;
      const i = list.findIndex(el => idOf(el) === missionId);
      const next = i < 0 ? list[step > 0 ? 0 : list.length - 1] : list[(i + step + list.length) % list.length];
      if (idOf(next) === missionId) return true; // nur ein Einsatz in der Liste
      // genauso öffnen, als hätte man in der Liste auf den Einsatz geklickt
      const opener = next.querySelector('.mission-list-content.frame-opener, .frame-opener');
      if (opener) opener.click(); else location.href = 'mission/' + idOf(next);
      next.scrollIntoView({ block: 'nearest' });
      return true;
    }

    // gibt true zurück, wenn das Kürzel zu einer Aktion gehört
    function handleCombo(combo, typing) {
      if (!settings.hotkeys || !combo) return false;
      if (typing && needsFreeFocus(combo)) return false;
      if (settings.keys.prevMission === combo) return gotoMission(-1);
      if (settings.keys.nextMission === combo) return gotoMission(1);
      const action = Object.keys(MISSION_BUTTONS).find(a => settings.keys[a] === combo);
      if (!action) return false;
      const btn = document.querySelector(MISSION_BUTTONS[action]);
      if (!btn) return false;
      if (!btn.classList.contains('button-disabled')) {
        btn.click();
        btn.classList.remove('rh-flash'); void btn.offsetWidth; btn.classList.add('rh-flash');
      }
      return true;
    }
    document.addEventListener('keydown', e => {
      if (e.repeat) return;
      if (handleCombo(comboFromEvent(e), isTypingEl(e.target))) e.preventDefault();
    });
    // damit die Leitstelle Tasten weiterreichen kann, solange der Fokus noch dort liegt
    window.__rhHotkey = handleCombo;

    // Änderungen aus dem Menü der Leitstelle sofort übernehmen
    window.addEventListener('storage', e => {
      if (e.key !== SETTINGS_KEY) return;
      Object.assign(settings, JSON.parse(e.newValue || '{}'));
      settings.keys = Object.assign({}, DEFAULTS.keys, settings.keys || {});
      update();
    });

    Promise.all([loadCategories(), loadMissionType()]).then(([c, m]) => {
      categories = c;
      missionType = m;
      update();
      refreshOwnVehicles();
    }).catch(e => console.warn('[ReSi-Helfer] Einsatzdaten konnten nicht geladen werden', e));
  }

  // =====================================================================
  // EINSATZ ANLEGEN: Hotkeys + Cursor direkt ins Einsatzstichwort
  // =====================================================================
  function runMissionNewFrame() {
    // Cursor sofort ins Feld "Einsatzstichwort" setzen, damit man direkt lostippen kann
    if (settings.missionNewFocus) {
      const focusKeyword = () => {
        const input = document.getElementById('newMissionNameInput');
        if (!input || document.activeElement === input) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange?.(input.value.length, input.value.length);
      };
      focusKeyword();
      setTimeout(focusKeyword, 150); // das Fenster blendet sich erst noch ein
    }

    const FORM_BUTTONS = { create: '#missionNewSave', createOpen: '#missionNewOpen' };
    function handleCombo(combo, typing) {
      if (!settings.hotkeys || !combo) return false;
      const action = Object.keys(FORM_BUTTONS).find(a => settings.keys[a] === combo);
      if (!action || (typing && needsFreeFocus(combo))) return false;
      const btn = document.querySelector(FORM_BUTTONS[action]);
      if (btn && !btn.disabled) btn.click();
      return true;
    }
    // Capture-Phase, damit das Spiel Enter nicht vorher für die Vorschlagsliste verbraucht
    document.addEventListener('keydown', e => {
      if (e.repeat) return;
      if (handleCombo(comboFromEvent(e), isTypingEl(e.target))) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.__rhHotkey = handleCombo;

    window.addEventListener('storage', e => {
      if (e.key !== SETTINGS_KEY) return;
      Object.assign(settings, JSON.parse(e.newValue || '{}'));
      settings.keys = Object.assign({}, DEFAULTS.keys, settings.keys || {});
    });
  }

  // =====================================================================
  // WACHENFENSTER: freies Personal neben "Personal x / y"
  // =====================================================================
  function runDepartmentFrame() {
    if (!settings.personnel) return;
    const count = document.getElementById('countUserPersonals');
    const holder = count.parentElement;
    const style = document.createElement('style');
    style.textContent = `
      .rh-pfree { display:inline-block; margin-left:8px; padding:0 8px; border-radius:999px; font-size:11.5px; font-weight:700;
        line-height:18px; background:rgba(64,192,87,.18); color:#69db7c; vertical-align:middle; }
      .rh-pfree.rh-bad { background:rgba(250,82,82,.18); color:#ff8787; }
    `;
    document.head.appendChild(style);
    const chip = document.createElement('span');
    chip.className = 'rh-pfree';
    holder.appendChild(chip);

    const render = () => {
      const have = +count.textContent.replace(/\D/g, '');
      // Text neben der Zahl: " / 40"
      const rest = [...holder.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('');
      const needStr = (rest.split('/')[1] || '').replace(/\D/g, '');
      if (!needStr) return;
      const need = +needStr, diff = have - need;
      const text = diff >= 0 ? `+${diff} frei` : `${-diff} fehlen`;
      if (chip.textContent !== text) chip.textContent = text;
      chip.classList.toggle('rh-bad', diff < 0);
      chip.title = `${have} Personal vorhanden, ${need} benötigt, um alle Fahrzeuge zu besetzen`;
    };
    observe(count, render, { characterData: true });
    render();
  }
})();
