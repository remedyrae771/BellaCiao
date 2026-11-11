/* ============================================================
   Bella Ciao — Kitchen App
   Одностраничное приложение без сервера: данные хранятся
   в localStorage устройства (планшет на кухне).
   ============================================================ */
(() => {
  'use strict';

  /* ---------------- Хранилище ---------------- */
  const KEY = {
    staff: 'bc_staff_v2',
    codes: 'bc_codes_v1',
    shifts: 'bc_shifts_v1',
    ttk: 'bc_ttk_v1',
    safety: 'bc_safety_v1',
    lists: 'bc_checklists_v2',
    checks: 'bc_checks_v1',
    acks: 'bc_acks_v1',
    session: 'bc_session_v1',
  };
  const load = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  };
  const save = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch { toast('Не удалось сохранить данные на устройстве'); }
  };

  /* ---------------- Утилиты ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const fmtNum = (n) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
  const stationById = (id) => STATIONS.find((s) => s.id === id) || { name: id, short: id, icon: 'clipboard' };
  const groupById = (id) => (id === 'chef' ? CHEF_GROUP : stationById(id));
  const fmtDT = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`; };
  const hours = (ms) => Math.round((ms / 3600000) * 100) / 100;
  const money = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₸';
  const dayStart = (dateStr) => new Date(dateStr + 'T00:00:00').getTime();
  const toLocalInput = (ts) => { const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

  async function hashPin(pin) {
    const data = 'bellaciao::' + pin;
    if (window.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Запасной вариант для небезопасного контекста (http:// в локальной сети)
    let h = 5381;
    for (const c of data) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
    return 'djb2-' + h.toString(16);
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------------- Первичная инициализация ---------------- */
  async function init() {
    if (!load(KEY.staff)) save(KEY.staff, DEFAULT_STAFF);
    // Обновление уже установленного приложения: настоящие шеф и су-шефы вместо демо
    if ((load('bc_seed', 0) || 0) < 2) {
      const staff = load(KEY.staff, []);
      for (const d of DEFAULT_STAFF.filter((x) => ['u1', 'u2', 'u8'].includes(x.id))) {
        const u = staff.find((x) => x.id === d.id);
        if (!u) staff.push({ ...d });
        else if (['Шеф-повар', 'Су-шеф (демо)'].includes(u.name)) Object.assign(u, { name: d.name, role: d.role });
      }
      save(KEY.staff, staff);
      save('bc_seed', 2);
    }
    if (!load(KEY.codes)) {
      const codes = {};
      for (const [g, code] of Object.entries(DEFAULT_CODES)) codes[g] = { hash: await hashPin(code), isDefault: true };
      save(KEY.codes, codes);
    }
    // старые данные с личными кодами больше не нужны
    ['bc_staff_v1', 'bc_checklists_v1'].forEach((k) => localStorage.removeItem(k));
    if (!load(KEY.ttk)) save(KEY.ttk, DEFAULT_TTK);
    // Удаляем примерные ТТК — ресторан загружает свои карты
    if ((load('bc_seed', 0) || 0) < 3) { save(KEY.ttk, []); save('bc_seed', 3); }
    if (!load(KEY.safety)) save(KEY.safety, DEFAULT_SAFETY);
    if (!load(KEY.lists)) {
      const lists = {};
      for (const st of STATIONS) {
        lists[st.id] = {};
        for (const t of CHECKLIST_TYPES) {
          lists[st.id][t.id] = [];
        }
      }
      save(KEY.lists, lists);
    }
  }

  /* ---------------- Состояние ---------------- */
  const state = {
    user: null,
    view: 'home',
    params: {},
    pin: '',
    group: null, // станция (или 'chef'), код которой введён — ждём выбора имени
    failed: 0,
    lockedUntil: 0,
  };

  const can = {
    allStations: () => ROLES[state.user.role].level >= 2,
    editTtk: () => ROLES[state.user.role].level >= 2,
    editLists: () => ROLES[state.user.role].level >= 2, // шеф и су-шефы
    manageTeam: () => state.user.role === 'chef',
    report: () => ROLES[state.user.role].level >= 2,
  };

  const visibleStations = () =>
    can.allStations() ? STATIONS : STATIONS.filter((s) => s.id === state.user.station);

  /* ---------------- Сессия и авто-выход ---------------- */
  const IDLE_MS = 10 * 60 * 1000;
  let idleTimer;
  function resetIdle() {
    if (!state.user) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { logout(); toast('Автоматический выход: нет активности 10 минут'); }, IDLE_MS);
  }
  ['pointerdown', 'keydown'].forEach((e) => document.addEventListener(e, resetIdle, { passive: true }));

  function restoreSession() {
    const s = load(KEY.session);
    if (!s || Date.now() - s.at > IDLE_MS) return;
    const u = load(KEY.staff, []).find((x) => x.id === s.id);
    if (u) { state.user = u; resetIdle(); }
  }

  function logout() {
    state.user = null; state.pin = ''; state.group = null; state.view = 'home'; state.params = {};
    localStorage.removeItem(KEY.session);
    clearTimeout(idleTimer);
    render();
  }

  async function tryLogin() {
    if (Date.now() < state.lockedUntil) return;
    const pin = state.pin;
    const h = await hashPin(pin);
    const codes = load(KEY.codes, {});
    const group = Object.keys(codes).find((g) => codes[g].hash === h);
    if (group) {
      state.group = group; state.pin = ''; state.failed = 0;
      render();
    } else {
      state.failed++;
      state.pin = '';
      if (state.failed >= 5) {
        state.lockedUntil = Date.now() + 30000;
        state.failed = 0;
        setTimeout(render, 30050);
      }
      render();
      const dots = $('.pin-dots');
      dots?.classList.add('shake');
    }
  }

  // Сотрудники, которых можно выбрать после ввода кода станции
  function groupMembers(group) {
    return load(KEY.staff, []).filter((u) => !u.disabled &&
      (group === 'chef' ? u.role === 'chef' : u.station === group && u.role !== 'chef'));
  }

  function pickUser(id) {
    const user = groupMembers(state.group).find((u) => u.id === id);
    if (!user) return;
    state.user = user; state.group = null;
    state.view = 'home'; state.params = {};
    save(KEY.session, { id: user.id, at: Date.now() });
    resetIdle();
    render();
  }

  /* ---------------- Смены (учёт рабочего времени) ---------------- */
  const allShifts = () => load(KEY.shifts, []);
  const openShift = (userId) => allShifts().find((s) => s.uid === userId && !s.end);

  function clockIn() {
    if (openShift(state.user.id)) return;
    const shifts = allShifts();
    shifts.push({ id: 's' + uid(), uid: state.user.id, start: Date.now(), end: null, station: state.user.station });
    save(KEY.shifts, shifts);
    toast(`Смена начата в ${fmtTime(Date.now())}`);
  }

  function clockOut() {
    const shifts = allShifts();
    const s = shifts.find((x) => x.uid === state.user.id && !x.end);
    if (!s) return;
    s.end = Date.now();
    save(KEY.shifts, shifts);
    toast(`Смена закрыта. Отработано: ${fmtDur(s.end - s.start)}`);
  }

  // Смены, начавшиеся в периоде [from, to] (даты 'YYYY-MM-DD' включительно)
  function shiftsInPeriod(from, to) {
    const a = dayStart(from), b = dayStart(to) + 864e5;
    return allShifts().filter((s) => s.start >= a && s.start < b).sort((x, y) => x.start - y.start);
  }
  const shiftMs = (s) => (s.end || Date.now()) - s.start;
  const LONG_SHIFT_MS = 16 * 3600000;

  /* ---------------- Навигация ---------------- */
  function go(view, params = {}) {
    state.view = view; state.params = params;
    if (state.user) save(KEY.session, { id: state.user.id, at: Date.now() });
    render();
    window.scrollTo(0, 0);
  }

  /* ---------------- Чек-листы: данные ---------------- */
  const checkKey = (date, station, type) => `${date}|${station}|${type}`;
  function getChecks(date, station, type) {
    return load(KEY.checks, {})[checkKey(date, station, type)] || {};
  }
  function toggleCheck(station, type, itemId) {
    const all = load(KEY.checks, {});
    const k = checkKey(today(), station, type);
    const rec = all[k] || {};
    if (rec[itemId]) delete rec[itemId];
    else rec[itemId] = { by: state.user.name, uid: state.user.id, at: Date.now() };
    all[k] = rec;
    // Храним историю за последние 60 дней
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    for (const key of Object.keys(all)) if (key.split('|')[0] < cutoff) delete all[key];
    save(KEY.checks, all);
  }
  function progress(station, type, date = today()) {
    const items = (load(KEY.lists, {})[station] || {})[type] || [];
    const done = getChecks(date, station, type);
    const n = items.filter((i) => done[i.id]).length;
    return { n, total: items.length, pct: items.length ? Math.round((n / items.length) * 100) : 0 };
  }
  function stationProgress(station, date = today()) {
    let n = 0, total = 0;
    for (const t of CHECKLIST_TYPES) { const p = progress(station, t.id, date); n += p.n; total += p.total; }
    return { n, total, pct: total ? Math.round((n / total) * 100) : 0 };
  }


  /* ---------------- Иконки (линейные SVG) ---------------- */
  const ICONS = {
    home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
    checklist: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L8 4.5M3.5 12l1.5 1.5L8 10.5M3.5 18l1.5 1.5L8 16.5',
    book: 'M3 5h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H3zM21 5h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H21z',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    chart: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    chevL: 'M15 18l-6-6 6-6', chevR: 'M9 6l6 6-6 6', chevUp: 'M6 15l6-6 6 6', chevDown: 'M6 9l6 6 6-6',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    x: 'M6 6l12 12M18 6 6 18',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
    alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
    snowflake: 'M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17M9 3.5 12 6l3-2.5M9 20.5l3-2.5 3 2.5',
    pasta: 'M3 11h18a9 9 0 0 1-18 0zM7.5 11c0-3 2-5.5 5-5.5M11.5 11c0-2 1-3.5 3-3.5M16 2l-4.5 9M20 3.5l-5.5 7.5',
    flame: 'M12 22c4 0 7-2.6 7-7 0-3.2-2-5.6-4-7.6 0 2.6-1.4 4-3 4 0-3-1-6.2-4-9.4 0 4.2-3 6.6-3 11.6C5 18.7 8 22 12 22z',
    bell: 'M3 18h18M5.5 18a6.5 6.5 0 0 1 13 0M12 11.5V9M10 9h4M2 21h20',
    pizza: 'M3 7c6-3 12-3 18 0L12 22zM4.6 9.7c4.9-2.1 9.9-2.1 14.8 0M9.5 12h.01M14 11.5h.01M12 16h.01',
    cake: 'M3 21h18M5 21v-8h14v8M5 16c2.3 1.4 4.7 1.4 7 0s4.7-1.4 7 0M12 13V9M12 6.5V6',
    chefhat: 'M7 17h10v4H7zM7 17v-4.2A4 4 0 0 1 6.3 5a5.5 5.5 0 0 1 11.4 0A4 4 0 0 1 17 12.8V17',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1.5v2M12 20.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
    moon: 'M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.8 6.8 0 0 0 10 10z',
    clipboard: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M9 11h6M9 15h6M9 19h3',
    knife: 'M3 21 13.5 10.5M13.5 10.5 20 4c1 3.5 0 6.5-3 8.5l-3.5-2z',
    extinguisher: 'M8 9h6v12H8zM11 9V6M8 6h6.5l2.5-2M9 6a3 3 0 0 0-4 3v3',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    drop: 'M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z',
    firstaid: 'M3 7h18v13H3zM8.5 7V4h7v3M12 10v7M8.5 13.5h7',
    cog: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  };
  const ic = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.shield}"/></svg>`;

  /* ---------------- Компоненты ---------------- */
  const ring = (pct, size = 56) => {
    const r = size / 2 - 5, c = 2 * Math.PI * r;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="${pct}%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c - (c * pct) / 100}"/>
      <text x="50%" y="50%" dy=".35em" text-anchor="middle">${pct}%</text></svg>`;
  };

  const header = (title, back) => `
    <div class="topbar-wrap">
      <header class="topbar">
        ${back ? `<button class="icon-btn" data-go="${back}" aria-label="Назад">${ic('chevL', 22)}</button>` : `<div class="brand-mini"><span>Bella Ciao</span><small>Кухня</small></div>`}
        <h1>${title === 'Bella Ciao' ? '' : esc(title)}</h1>
        <button class="avatar" data-go="profile" title="${esc(state.user.name)}">${esc(initials(state.user.name))}</button>
      </header>
      <div class="ceramic-rule"></div>
    </div>`;

  const initials = (name) => name.split(/\s+/).filter((w) => /^[\p{L}]/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function nav() {
    const items = [
      ['home', 'home', 'Главная'],
      ['checklists', 'checklist', 'Чек-листы'],
      ['ttk', 'book', 'ТТК'],
      ['safety', 'shield', 'ТБ'],
    ];
    if (can.report()) items.push(['team', 'users', 'Команда']);
    return `<nav class="bottom-nav">${items.map(([v, i, l]) =>
      `<button class="${state.view.startsWith(v) ? 'active' : ''}" data-go="${v}"><span class="ni">${ic(i, 22)}</span><span>${l}</span></button>`
    ).join('')}</nav>`;
  }

  // Карточка «Начать / закончить смену» на главной
  function shiftCard() {
    const open = openShift(state.user.id);
    const now = new Date();
    const monthFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthMs = shiftsInPeriod(monthFrom, today()).filter((s) => s.uid === state.user.id).reduce((a, s) => a + shiftMs(s), 0);
    return `<section class="shift-card ${open ? 'is-open' : ''}">
      <div class="shift-info">
        <div class="eyebrow">${open ? 'Вы на смене' : 'Смена не начата'}</div>
        ${open
          ? `<div class="shift-timer" data-since="${open.start}">${fmtDur(Date.now() - open.start)}</div>
             <small>Начало: ${fmtTime(open.start)} · ${fmtDate(open.start)}</small>`
          : `<div class="shift-timer muted-t">—</div><small>Отметьте приход, когда начинаете работу</small>`}
        <small class="shift-month">За этот месяц: <b>${fmtNum(hours(monthMs))} ч</b></small>
      </div>
      ${open
        ? `<button class="btn btn-big btn-out" data-clock="out">Закончить смену</button>`
        : `<button class="btn btn-big" data-clock="in">Начать смену</button>`}
    </section>`;
  }

  /* ================= ЭКРАНЫ ================= */

  function viewPickName() {
    const g = groupById(state.group);
    const members = groupMembers(state.group);
    return `
      <main class="login">
        <div class="login-card pick">
          <div class="pick-head">
            <span class="st-icon">${ic(g.icon, 22)}</span>
            <div><div class="eyebrow">${esc(g.name)}</div><h2>Кто вы?</h2></div>
          </div>
          <div class="pick-list">
            ${members.map((u) => {
              const open = openShift(u.id);
              return `<button class="pick-row" data-pick="${u.id}">
                <span class="avatar lg">${esc(initials(u.name))}</span>
                <span class="pick-body"><b>${esc(u.name)}</b>
                  <small>${ROLES[u.role].name}${open ? ` · <span class="on-shift">на смене с ${fmtTime(open.start)}</span>` : ''}</small></span>
                <span class="chev">${ic('chevR', 18)}</span>
              </button>`;
            }).join('') || '<p class="empty">На этой станции пока нет сотрудников. Шеф добавляет их в разделе «Команда».</p>'}
          </div>
          <button class="btn btn-ghost wide" data-cancel-pick>Ввести другой код</button>
        </div>
      </main>`;
  }

  function viewLogin() {
    if (state.group) return viewPickName();
    const locked = Date.now() < state.lockedUntil;
    const dots = [0, 1, 2, 3].map((i) => `<i class="${i < state.pin.length ? 'on' : ''}"></i>`).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    return `
      <main class="login">
        <div class="login-card">
          <div class="logo">
            <div class="logo-badge">
              <div class="logo-script">Bella Ciao</div>
              <div class="logo-sub">Trattoria Italiana</div>
            </div>
            <div class="logo-tag">Кухня · Алматы</div>
          </div>
          <p class="login-hint">${locked ? 'Слишком много попыток. Подождите 30 секунд.' : 'Введите код вашей станции'}</p>
          <div class="pin-dots">${dots}</div>
          <div class="keypad">
            ${keys.map((k) => k === ''
              ? '<span></span>'
              : `<button class="key${k === '⌫' ? ' key-del' : ''}" data-key="${k}" ${locked ? 'disabled' : ''} ${k === '⌫' ? 'aria-label="Стереть"' : ''}>${k === '⌫' ? ic('chevL', 24) : k}</button>`).join('')}
          </div>
          <p class="login-foot">Служебное приложение для сотрудников кухни</p>
        </div>
      </main>`;
  }

  function viewHome() {
    const u = state.user;
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
    const myStations = visibleStations();
    const acks = load(KEY.acks, {})[u.id] || {};
    const mySafety = load(KEY.safety, []).filter((s) => !s.stations.length || s.stations.includes(u.station) || can.allStations());
    const unread = mySafety.filter((s) => !acks[s.id]).length;

    return `${header('Bella Ciao')}
      <main class="page">
        <section class="hero">
          <div class="hero-greet">${greet}</div>
          <div class="hero-name">${esc(u.name)}</div>
          <div class="hero-meta">${ROLES[u.role].name} · ${esc(stationById(u.station).name)} · ${fmtDate(Date.now())}</div>
        </section>

        ${shiftCard()}
        ${can.manageTeam() && Object.values(load(KEY.codes, {})).some((c) => c.isDefault)
          ? `<div class="alert" data-go="team" data-tab="codes">${ic('lock', 18)}<span>Некоторые станции используют стандартные коды. <b>Смените их</b> в разделе «Команда → Коды».</span></div>` : ''}
        ${unread ? `<div class="alert alert-olive" data-go="safety">${ic('shield', 18)}<span>Не прочитано разделов ТБ: <b>${unread}</b>. Ознакомьтесь и подтвердите.</span></div>` : ''}

        ${can.report() ? (() => {
          const staff = load(KEY.staff, []);
          const on = allShifts().filter((x) => !x.end);
          return `<button class="card now-card now-home" data-go="team" data-tab="hours">
            <div class="eyebrow">Сейчас на смене · ${on.length}</div>
            <div class="now-names">${on.map((x) => `<span class="name-chip"><span class="dot-live"></span>${esc((staff.find((u) => u.id === x.uid) || { name: '—' }).name)}</span>`).join('') || '<span class="muted">Никого нет</span>'}</div>
          </button>`;
        })() : ''}

        <h2 class="section-title">Чек-листы на сегодня</h2>
        <div class="grid">
          ${myStations.map((s) => {
            const p = stationProgress(s.id);
            return `<button class="card station-card" data-go="checklists" data-station="${s.id}">
              <span class="st-icon">${ic(s.icon, 22)}</span>
              <span class="st-body"><b>${esc(s.name)}</b><small>${p.total ? `${p.n} из ${p.total} пунктов` : 'Чек-лист не заполнен'}</small></span>
              ${ring(p.pct)}
            </button>`;
          }).join('')}
        </div>

        <h2 class="section-title">Быстрый доступ</h2>
        <div class="quick">
          <button class="card quick-card" data-go="ttk"><span class="q-ic">${ic('book', 22)}</span><b>ТТК</b><small>Технологические карты</small></button>
          <button class="card quick-card" data-go="safety"><span class="q-ic">${ic('shield', 22)}</span><b>Техника безопасности</b><small>Правила и инструкции</small></button>
          ${can.report() ? `<button class="card quick-card" data-go="team"><span class="q-ic">${ic('clock', 22)}</span><b>Табель</b><small>Часы и оплата</small></button>` : ''}
        </div>
      </main>${nav()}`;
  }

  function viewChecklists() {
    const stations = visibleStations();
    const st = state.params.station && stations.some((s) => s.id === state.params.station)
      ? state.params.station : (stations.find((s) => s.id === state.user.station) || stations[0]).id;
    const type = state.params.type || (new Date().getHours() >= 21 ? 'close' : 'open');
    const items = (load(KEY.lists, {})[st] || {})[type] || [];
    const done = getChecks(today(), st, type);
    const p = progress(st, type);
    const editing = state.params.edit && can.editLists();

    return `${header('Чек-листы')}
      <main class="page">
        ${stations.length > 1 ? `<div class="chips">${stations.map((s) =>
          `<button class="chip ${s.id === st ? 'on' : ''}" data-go="checklists" data-station="${s.id}" data-type="${type}">${ic(s.icon, 16)} ${esc(s.short)}</button>`).join('')}</div>` : ''}

        <div class="segmented">${CHECKLIST_TYPES.map((t) => {
          const tp = progress(st, t.id);
          return `<button class="${t.id === type ? 'on' : ''}" data-go="checklists" data-station="${st}" data-type="${t.id}">
            <span class="seg-t">${ic(t.icon, 16)} ${t.name}</span><small>${tp.n}/${tp.total}</small></button>`;
        }).join('')}</div>

        <div class="list-head">
          <div>
            <div class="eyebrow">${esc(stationById(st).name)}</div>
            <h2>${CHECKLIST_TYPES.find((t) => t.id === type).name}</h2>
            <div class="bar"><span style="width:${p.pct}%"></span></div>
          </div>
          ${ring(p.pct, 64)}
        </div>

        ${!items.length && !editing ? `
          <div class="card empty-list">
            ${ic('checklist', 32)}
            <b>Чек-лист пока пустой</b>
            <p class="muted">${can.editLists() ? 'Добавьте пункты — их увидят все повара этой станции.' : 'Пункты заполняет шеф-повар или су-шеф.'}</p>
            ${can.editLists() ? `<button class="btn" data-go="checklists" data-station="${st}" data-type="${type}" data-edit="1">${ic('plus', 18)} Заполнить чек-лист</button>` : ''}
          </div>` : `
        <ul class="checklist">
          ${items.map((it, i) => {
            const d = done[it.id];
            return `<li class="${d ? 'done' : ''}${editing ? ' editing' : ''}">
              ${editing
                ? `<span class="num">${i + 1}</span>
                   <textarea class="edit-input" rows="${Math.min(4, Math.max(1, Math.ceil(it.text.length / 26)))}" data-edit-item="${it.id}" data-station="${st}" data-type="${type}" aria-label="Пункт ${i + 1}">${esc(it.text)}</textarea>
                   <span class="move">
                     <button class="icon-btn sm" data-move-item="${it.id}" data-dir="-1" data-station="${st}" data-type="${type}" ${i === 0 ? 'disabled' : ''} aria-label="Выше">${ic('chevUp', 16)}</button>
                     <button class="icon-btn sm" data-move-item="${it.id}" data-dir="1" data-station="${st}" data-type="${type}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Ниже">${ic('chevDown', 16)}</button>
                   </span>
                   <button class="icon-btn sm danger" data-del-item="${it.id}" data-station="${st}" data-type="${type}" aria-label="Удалить">${ic('x', 16)}</button>`
                : `<button class="check-row" data-check="${it.id}" data-station="${st}" data-type="${type}">
                    <span class="box">${d ? ic('check', 16) : ''}</span>
                    <span class="txt">${esc(it.text)}${d ? `<small>${esc(d.by)} · ${fmtTime(d.at)}</small>` : ''}</span>
                  </button>`}
            </li>`;
          }).join('') || '<li class="empty">Пунктов пока нет — добавьте первый ниже</li>'}
        </ul>`}

        ${editing ? `
          <form class="add-row" data-form="add-item" data-station="${st}" data-type="${type}">
            <input name="text" placeholder="Новый пункт: что нужно сделать" required autocomplete="off"/>
            <button class="btn">${ic('plus', 18)} Добавить</button>
          </form>
          <p class="muted">Изменения сохраняются сразу. Отметки, уже поставленные сегодня, не сбрасываются.</p>
          <button class="btn btn-ghost wide" data-go="checklists" data-station="${st}" data-type="${type}">${ic('check', 18)} Готово</button>`
          : `${p.pct === 100 && items.length ? `<div class="done-banner">${ic('check', 18)} Чек-лист выполнен полностью</div>` : ''}
             ${can.editLists() && items.length ? `<button class="btn btn-ghost wide" data-go="checklists" data-station="${st}" data-type="${type}" data-edit="1">${ic('edit', 16)} Редактировать пункты</button>` : ''}`}
      </main>${nav()}`;
  }

  function viewTtk() {
    const all = load(KEY.ttk, []);
    const q = (state.params.q || '').toLowerCase();
    const st = state.params.station ?? (can.allStations() ? '' : state.user.station);
    const list = all
      .filter((t) => !st || t.station === st)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.ingredients.some((i) => i[0].toLowerCase().includes(q)));

    return `${header('ТТК')}
      <main class="page">
        <div class="search">
          <input type="search" id="ttk-search" placeholder="Поиск блюда или ингредиента…" value="${esc(state.params.q || '')}"/>
        </div>
        <div class="chips">
          <button class="chip ${!st ? 'on' : ''}" data-go="ttk" data-station="">Все</button>
          ${STATIONS.map((s) => `<button class="chip ${s.id === st ? 'on' : ''}" data-go="ttk" data-station="${s.id}">${ic(s.icon, 16)} ${esc(s.short)}</button>`).join('')}
        </div>
        <div class="ttk-list">
          ${list.map((t) => `
            <button class="card ttk-card" data-go="ttk-view" data-id="${t.id}">
              <span class="ttk-st">${ic(stationById(t.station).icon, 22)}</span>
              <span class="ttk-body">
                <b>${esc(t.name)}</b>
                <small>${esc(stationById(t.station).short)} · выход ${t.yield ? t.yield + ' г' : '—'} · ${esc(t.time)}</small>
              </span>
              <span class="chev">${ic('chevR', 18)}</span>
            </button>`).join('') || (all.length ? '<p class="empty">Ничего не найдено</p>'
              : `<div class="card empty-list">${ic('book', 32)}<b>Технологических карт пока нет</b>
                  <p class="muted">${can.editTtk() ? 'Добавьте первую карту кнопкой «+».' : 'Карты добавляет шеф-повар или су-шеф.'}</p></div>`)}
        </div>
        ${can.editTtk() ? `<button class="fab" data-go="ttk-edit" aria-label="Новая ТТК">${ic('plus', 26)}</button>` : ''}
      </main>${nav()}`;
  }

  function viewTtkDetail() {
    const t = load(KEY.ttk, []).find((x) => x.id === state.params.id);
    if (!t) return viewTtk();
    const k = Number(state.params.k || 1);
    const sumB = t.ingredients.reduce((a, i) => a + Number(i[1] || 0), 0);
    const sumN = t.ingredients.reduce((a, i) => a + Number(i[2] || 0), 0);

    return `${header('ТТК', 'ttk')}
      <main class="page ttk-detail">
        <div class="eyebrow">${esc(stationById(t.station).name)}</div>
        <h2 class="dish">${esc(t.name)}</h2>
        <div class="meta-row">
          <span>Выход: <b>${t.yield ? fmtNum(t.yield * k) + ' г' : '—'}</b></span>
          <span>Время: <b>${esc(t.time)}</b></span>
        </div>

        <div class="scaler">
          <span>Порций:</span>
          <button class="icon-btn" data-scale="-1">${ic('minus', 18)}</button>
          <b>${k}</b>
          <button class="icon-btn" data-scale="1">${ic('plus', 18)}</button>
          ${[5, 10, 20].map((n) => `<button class="chip ${k === n ? 'on' : ''}" data-scale-set="${n}">×${n}</button>`).join('')}
        </div>

        <h3>Ингредиенты <small class="muted">· граммы</small></h3>
        <table class="ing">
          <thead><tr><th>Продукт</th><th>Брутто</th><th>Нетто</th></tr></thead>
          <tbody>${t.ingredients.map((i) => `<tr><td>${esc(i[0])}</td><td>${fmtNum(i[1] * k)}</td><td>${fmtNum(i[2] * k)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Итого</td><td>${fmtNum(sumB * k)}</td><td>${fmtNum(sumN * k)}</td></tr></tfoot>
        </table>

        <h3>Технология приготовления</h3>
        <ol class="steps">${t.tech.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>

        <div class="info-grid">
          <div class="info"><h4>Подача</h4><p>${esc(t.serve)}</p></div>
          <div class="info"><h4>Хранение</h4><p>${esc(t.storage)}</p></div>
          <div class="info warn"><h4>Аллергены</h4><p>${esc(t.allergens)}</p></div>
        </div>

        ${can.editTtk() ? `<div class="row-btns">
          <button class="btn" data-go="ttk-edit" data-id="${t.id}">${ic('edit', 16)} Редактировать</button>
          <button class="btn btn-ghost danger" data-del-ttk="${t.id}">Удалить</button>
        </div>` : ''}
      </main>${nav()}`;
  }

  function viewTtkEdit() {
    const t = load(KEY.ttk, []).find((x) => x.id === state.params.id) || {
      id: '', station: state.user.station, name: '', yield: '', time: '', ingredients: [['', '', '']],
      tech: [''], serve: '', storage: '', allergens: '',
    };
    const ingText = t.ingredients.map((i) => i.join(' ; ')).join('\n');
    return `${header(t.id ? 'Редактирование ТТК' : 'Новая ТТК', t.id ? 'ttk-view' : 'ttk')}
      <main class="page">
        <form class="form" data-form="ttk" data-id="${t.id}">
          <label>Название блюда<input name="name" required value="${esc(t.name)}"/></label>
          <div class="form-row">
            <label>Станция
              <select name="station">${STATIONS.map((s) => `<option value="${s.id}" ${s.id === t.station ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
            </label>
            <label>Выход, г<input name="yield" type="number" min="0" step="1" value="${esc(t.yield)}"/></label>
            <label>Время<input name="time" value="${esc(t.time)}" placeholder="10 мин"/></label>
          </div>
          <label>Ингредиенты <small>— по строке: Продукт ; брутто ; нетто (на 1 порцию)</small>
            <textarea name="ingredients" rows="7" placeholder="Спагетти ; 110 ; 110">${esc(ingText)}</textarea></label>
          <label>Технология <small>— каждый шаг с новой строки</small>
            <textarea name="tech" rows="6">${esc(t.tech.join('\n'))}</textarea></label>
          <label>Подача<textarea name="serve" rows="2">${esc(t.serve)}</textarea></label>
          <label>Хранение<textarea name="storage" rows="2">${esc(t.storage)}</textarea></label>
          <label>Аллергены<input name="allergens" value="${esc(t.allergens)}"/></label>
          <button class="btn wide">Сохранить</button>
        </form>
      </main>${nav()}`;
  }

  function viewSafety() {
    const acks = load(KEY.acks, {})[state.user.id] || {};
    const all = load(KEY.safety, []);
    const mine = all.filter((s) => !s.stations.length || s.stations.includes(state.user.station) || can.allStations());
    const open = state.params.open;
    return `${header('Техника безопасности')}
      <main class="page">
        <p class="lead">Ознакомьтесь с каждым разделом и подтвердите. Подтверждения видит шеф-повар.</p>
        <div class="acc">
          ${mine.map((s) => {
            const a = acks[s.id];
            const scope = s.stations.length ? s.stations.map((x) => stationById(x).short).join(', ') : 'Для всех';
            return `<section class="acc-item ${open === s.id ? 'open' : ''}">
              <button class="acc-head" data-go="safety" data-open="${open === s.id ? '' : s.id}">
                <span class="acc-ic">${ic(s.icon, 22)}</span>
                <span class="acc-t"><b>${esc(s.title)}</b><small>${esc(scope)}</small></span>
                <span class="pill ${a ? 'ok' : ''}">${a ? 'Ознакомлен' : 'Не прочитано'}</span>
              </button>
              ${open === s.id ? `<div class="acc-body">
                <ul class="rules">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
                ${a ? `<p class="muted">Подтверждено ${fmtDate(a)} в ${fmtTime(a)}</p>`
                  : `<button class="btn wide" data-ack="${s.id}">Я ознакомлен(а) и обязуюсь соблюдать</button>`}
              </div>` : ''}
            </section>`;
          }).join('')}
        </div>
      </main>${nav()}`;
  }

  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function periodPreset(id) {
    const d = new Date();
    if (id === 'today') return [today(), today()];
    if (id === 'week') { const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [ymd(m), today()]; }
    if (id === 'prev') { const f = new Date(d.getFullYear(), d.getMonth() - 1, 1); const l = new Date(d.getFullYear(), d.getMonth(), 0); return [ymd(f), ymd(l)]; }
    return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), today()];
  }

  function viewTeam() {
    const staff = load(KEY.staff, []);
    const acks = load(KEY.acks, {});
    const safety = load(KEY.safety, []);
    const date = state.params.date || today();
    const tab = state.params.tab || 'hours';

    const report = `
      <div class="date-row">
        <label>Дата отчёта <input type="date" id="report-date" value="${date}" max="${today()}"/></label>
      </div>
      <div class="report">
        ${STATIONS.map((s) => {
          const sp = stationProgress(s.id, date);
          return `<div class="card report-card">
            <div class="rc-head"><span class="rc-t">${ic(s.icon, 18)} <b>${esc(s.name)}</b></span>${ring(sp.pct, 48)}</div>
            ${CHECKLIST_TYPES.map((t) => {
              const p = progress(s.id, t.id, date);
              return `<div class="rc-line"><span>${t.name}</span>
                <div class="bar sm"><span style="width:${p.pct}%"></span></div><small>${p.n}/${p.total}</small></div>`;
            }).join('')}
            ${missing(s.id, date)}
          </div>`;
        }).join('')}
      </div>`;

    const team = `
      <div class="team-list">
        ${staff.map((u) => {
          const relevant = safety.filter((x) => !x.stations.length || x.stations.includes(u.station));
          const ackN = relevant.filter((x) => (acks[u.id] || {})[x.id]).length;
          return `<div class="card member ${u.disabled ? 'disabled' : ''}">
            <div class="avatar lg">${esc(initials(u.name))}</div>
            <div class="m-body">
              <b>${esc(u.name)}</b>
              <small>${ROLES[u.role].name} · ${esc(u.role === 'chef' ? 'вход по коду шефа' : stationById(u.station).name)}</small>
              <small>ТБ: ${ackN}/${relevant.length}${can.manageTeam() && u.rate ? ` · ${money(u.rate)}/ч` : ''}${u.disabled ? ' · отключён' : ''}</small>
            </div>
            ${can.manageTeam() ? `<button class="icon-btn" data-go="member" data-id="${u.id}" aria-label="Изменить">${ic('edit', 18)}</button>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${can.manageTeam() ? `<button class="fab" data-go="member" aria-label="Добавить сотрудника">${ic('plus', 26)}</button>` : ''}`;

    const tabs = [['hours', 'Табель'], ['report', 'Чек-листы'], ['staff', 'Сотрудники']];
    if (can.manageTeam()) tabs.push(['codes', 'Коды']);
    const body = { hours: timesheet, report: () => report, staff: () => team, codes: codesTab }[tab] || timesheet;

    return `${header('Команда')}
      <main class="page">
        <div class="segmented" style="grid-template-columns:repeat(${tabs.length},1fr)">
          ${tabs.map(([id, l]) => `<button class="${tab === id ? 'on' : ''}" data-go="team" data-tab="${id}">${l}</button>`).join('')}
        </div>
        ${body()}
      </main>${nav()}`;
  }

  // Табель: часы и оплата по сотрудникам за период
  function timesheet() {
    const [defFrom, defTo] = periodPreset('month');
    const from = state.params.from || defFrom, to = state.params.to || defTo;
    const staff = load(KEY.staff, []);
    const shifts = shiftsInPeriod(from, to);
    const showMoney = can.manageTeam();
    const onShift = allShifts().filter((s) => !s.end);
    const nameOf = (id) => (staff.find((u) => u.id === id) || { name: 'Удалённый сотрудник' }).name;

    const rows = staff.map((u) => {
      const list = shifts.filter((s) => s.uid === u.id);
      const ms = list.reduce((a, s) => a + shiftMs(s), 0);
      return { u, list, h: hours(ms), sum: hours(ms) * (u.rate || 0) };
    }).filter((r) => r.list.length);
    const totalH = rows.reduce((a, r) => a + r.h, 0), totalSum = rows.reduce((a, r) => a + r.sum, 0);

    return `
      <div class="card now-card">
        <div class="eyebrow">Сейчас на смене · ${onShift.length}</div>
        ${onShift.length ? `<ul class="now-list">${onShift.map((s) => `<li>
            <span class="dot-live"></span><b>${esc(nameOf(s.uid))}</b>
            <small>${esc(stationById(s.station).short)} · с ${fmtTime(s.start)} · ${fmtDur(Date.now() - s.start)}</small>
            ${Date.now() - s.start > LONG_SHIFT_MS ? '<span class="pill">забыл отметить уход?</span>' : ''}
          </li>`).join('')}</ul>` : '<p class="muted">Никого нет на смене</p>'}
      </div>

      <div class="chips period">
        ${[['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Этот месяц'], ['prev', 'Прошлый месяц']].map(([id, l]) => {
          const [f, t] = periodPreset(id);
          return `<button class="chip ${f === from && t === to ? 'on' : ''}" data-go="team" data-tab="hours" data-from="${f}" data-to="${t}">${l}</button>`;
        }).join('')}
      </div>
      <div class="date-row two">
        <label>С <input type="date" id="ts-from" value="${from}" max="${today()}"/></label>
        <label>По <input type="date" id="ts-to" value="${to}" max="${today()}"/></label>
      </div>

      <div class="ts-total card">
        <div><small>Всего часов</small><b>${fmtNum(totalH)}</b></div>
        <div><small>Смен</small><b>${shifts.length}</b></div>
        ${showMoney ? `<div><small>К оплате</small><b>${money(totalSum)}</b></div>` : ''}
      </div>

      <div class="ts-list">
        ${rows.map((r) => `
          <details class="card ts-row">
            <summary>
              <span class="avatar lg">${esc(initials(r.u.name))}</span>
              <span class="m-body"><b>${esc(r.u.name)}</b><small>${ROLES[r.u.role].name} · смен: ${r.list.length}${showMoney ? ` · ${money(r.u.rate || 0)}/ч` : ''}</small></span>
              <span class="ts-num"><b>${fmtNum(r.h)} ч</b>${showMoney ? `<small>${money(r.sum)}</small>` : ''}</span>
            </summary>
            <table class="ing ts-table">
              <thead><tr><th>Приход</th><th>Уход</th><th>Часы</th>${showMoney ? '<th></th>' : ''}</tr></thead>
              <tbody>${r.list.map((s) => `<tr class="${!s.end ? 'open-row' : ''}">
                <td>${fmtDT(s.start)}</td>
                <td>${s.end ? fmtDT(s.end) : '<span class="on-shift">на смене</span>'}</td>
                <td>${fmtNum(hours(shiftMs(s)))}${s.edited ? ' <span class="edited" title="Исправлено шефом">испр.</span>' : ''}</td>
                ${showMoney ? `<td><button class="icon-btn sm" data-go="shift-edit" data-id="${s.id}" aria-label="Исправить">${ic('edit', 15)}</button></td>` : ''}
              </tr>`).join('')}</tbody>
            </table>
          </details>`).join('') || '<p class="empty">За этот период смен нет</p>'}
      </div>

      <div class="row-btns">
        <button class="btn btn-ghost" data-export="${from}|${to}">${ic('download', 18)} Скачать табель (CSV)</button>
        ${showMoney ? `<button class="btn" data-go="shift-edit">${ic('plus', 18)} Добавить смену</button>` : ''}
      </div>`;
  }

  // Коды входа станций (только шеф)
  function codesTab() {
    const codes = load(KEY.codes, {});
    const groups = [...STATIONS, CHEF_GROUP];
    return `
      <p class="lead">У каждой станции свой код. После ввода кода сотрудник выбирает себя из списка поваров этой станции.
        Сами повара коды менять не могут.</p>
      <div class="codes">
        ${groups.map((g) => `
          <form class="card code-row" data-form="code" data-group="${g.id}">
            <span class="st-icon">${ic(g.icon, 22)}</span>
            <span class="m-body"><b>${esc(g.name)}</b>
              <small>${codes[g.id]?.isDefault ? '<span class="warn-t">стандартный код — смените</span>' : 'код установлен'} · ${groupMembers(g.id).length} чел.</small></span>
            <span class="code-in">
              <input name="code" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="••••" required autocomplete="off" aria-label="Новый код"/>
              <button class="btn">Сохранить</button>
            </span>
          </form>`).join('')}
      </div>`;
  }

  function missing(station, date) {
    const lists = load(KEY.lists, {})[station] || {};
    const out = [];
    for (const t of CHECKLIST_TYPES) {
      const done = getChecks(date, station, t.id);
      (lists[t.id] || []).forEach((i) => { if (!done[i.id]) out.push(`${t.name}: ${i.text}`); });
    }
    if (!Object.values(lists).some((l) => l.length)) return '<p class="muted">Пункты чек-листа не заданы</p>';
    if (!out.length) return '<p class="ok-t">Всё выполнено</p>';
    return `<details class="missing"><summary>Не выполнено: ${out.length}</summary><ul>${out.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
  }

  function viewMember() {
    const u = load(KEY.staff, []).find((x) => x.id === state.params.id) || { id: '', name: '', role: 'cook', station: 'cold', rate: '' };
    return `${header(u.id ? 'Сотрудник' : 'Новый сотрудник', 'team')}
      <main class="page">
        <form class="form" data-form="member" data-id="${u.id}">
          <label>Имя и фамилия<input name="name" required value="${esc(u.name)}"/></label>
          <div class="form-row">
            <label>Должность
              <select name="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${r.name}</option>`).join('')}</select>
            </label>
            <label>Станция (по её коду входит)
              <select name="station">${STATIONS.map((s) => `<option value="${s.id}" ${s.id === u.station ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
            </label>
            <label>Ставка, ₸ в час<input name="rate" type="number" min="0" step="50" value="${esc(u.rate)}"/></label>
          </div>
          <p class="muted">Шеф-повар входит по коду шефа, су-шефы — по коду раздачи, повара — по коду своей станции.</p>
          ${u.id ? `<label class="check"><input type="checkbox" name="disabled" ${u.disabled ? 'checked' : ''}/> Доступ отключён (уволен / в отпуске)</label>` : ''}
          <button class="btn wide">Сохранить</button>
          ${u.id && u.id !== state.user.id ? `<button type="button" class="btn btn-ghost danger wide" data-del-member="${u.id}">Удалить сотрудника</button>` : ''}
        </form>
      </main>${nav()}`;
  }

  function viewShiftEdit() {
    const staff = load(KEY.staff, []);
    const s = allShifts().find((x) => x.id === state.params.id) || { id: '', uid: staff[0]?.id, start: Date.now() - 8 * 3600000, end: Date.now() };
    return `${header(s.id ? 'Исправить смену' : 'Новая смена', 'team')}
      <main class="page">
        <form class="form" data-form="shift" data-id="${s.id}">
          <label>Сотрудник
            <select name="uid">${staff.map((u) => `<option value="${u.id}" ${u.id === s.uid ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
          </label>
          <div class="form-row">
            <label>Приход<input type="datetime-local" name="start" required value="${toLocalInput(s.start)}"/></label>
            <label>Уход <small>— пусто, если ещё на смене</small><input type="datetime-local" name="end" value="${s.end ? toLocalInput(s.end) : ''}"/></label>
          </div>
          <button class="btn wide">Сохранить</button>
          ${s.id ? `<button type="button" class="btn btn-ghost danger wide" data-del-shift="${s.id}">Удалить смену</button>` : ''}
        </form>
      </main>${nav()}`;
  }

  function viewProfile() {
    const u = state.user;
    const [from, to] = periodPreset('month');
    const mine = shiftsInPeriod(from, to).filter((s) => s.uid === u.id).reverse();
    const total = mine.reduce((a, s) => a + shiftMs(s), 0);
    return `${header('Профиль', 'home')}
      <main class="page">
        <div class="profile-card card">
          <div class="avatar xl">${esc(initials(u.name))}</div>
          <h2>${esc(u.name)}</h2>
          <p class="muted">${ROLES[u.role].name} · ${esc(stationById(u.station).name)}</p>
        </div>
        ${shiftCard()}
        <h2 class="section-title">Мои смены за месяц · ${fmtNum(hours(total))} ч</h2>
        ${mine.length ? `<table class="ing ts-table">
          <thead><tr><th>Приход</th><th>Уход</th><th>Часы</th></tr></thead>
          <tbody>${mine.map((s) => `<tr><td>${fmtDT(s.start)}</td><td>${s.end ? fmtDT(s.end) : '<span class="on-shift">на смене</span>'}</td><td>${fmtNum(hours(shiftMs(s)))}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="empty">В этом месяце смен пока нет</p>'}
        <p class="muted">Ошиблись с отметкой? Скажите су-шефу или шефу — он исправит время в табеле.</p>
        <button class="btn btn-dark wide" data-logout>${ic('logout', 18)} Выйти</button>
      </main>${nav()}`;
  }

  /* ---------------- Рендер ---------------- */
  const VIEWS = {
    home: viewHome, checklists: viewChecklists, ttk: viewTtk, 'ttk-view': viewTtkDetail,
    'ttk-edit': viewTtkEdit, safety: viewSafety, team: viewTeam, member: viewMember, profile: viewProfile,
    'shift-edit': viewShiftEdit,
  };

  function render() {
    const app = $('#app');
    if (!state.user) { app.innerHTML = viewLogin(); document.body.className = 'is-login'; return; }
    document.body.className = '';
    // защита маршрутов
    if ((state.view === 'team' && !can.report()) || (state.view === 'member' && !can.manageTeam())
      || (state.view === 'shift-edit' && !can.manageTeam())
      || (state.view === 'ttk-edit' && !can.editTtk())) state.view = 'home';
    app.innerHTML = (VIEWS[state.view] || viewHome)();
  }

  // Живой таймер смены
  setInterval(() => {
    document.querySelectorAll('.shift-timer[data-since]').forEach((el) => { el.textContent = fmtDur(Date.now() - Number(el.dataset.since)); });
  }, 30000);

  /* ---------------- События ---------------- */
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-go]');
    if (!el) return;
    const d = el.dataset;

    if (d.key !== undefined) {
      if (d.key === '⌫') state.pin = state.pin.slice(0, -1);
      else if (state.pin.length < 4) state.pin += d.key;
      render();
      if (state.pin.length === 4) setTimeout(tryLogin, 120);
      return;
    }
    if (d.pick) { pickUser(d.pick); return; }
    if (el.hasAttribute('data-cancel-pick')) { state.group = null; render(); return; }
    if (d.clock) {
      if (d.clock === 'in') clockIn();
      else if (confirm('Закончить смену сейчас?')) clockOut();
      else return;
      if (navigator.vibrate) navigator.vibrate(30);
      render(); return;
    }
    if (d.delShift) {
      if (!confirm('Удалить эту смену?')) return;
      save(KEY.shifts, allShifts().filter((x) => x.id !== d.delShift));
      toast('Смена удалена'); go('team', { tab: 'hours' }); return;
    }
    if (d.export) { exportCsv(...d.export.split('|')); return; }
    if (d.check) {
      toggleCheck(d.station, d.type, d.check);
      if (navigator.vibrate) navigator.vibrate(15);
      render();
      return;
    }
    if (d.scale || d.scaleSet) {
      const k = d.scaleSet ? Number(d.scaleSet) : Math.max(1, Number(state.params.k || 1) + Number(d.scale));
      state.params.k = k; render(); return;
    }
    if (d.ack) {
      const acks = load(KEY.acks, {});
      acks[state.user.id] = { ...(acks[state.user.id] || {}), [d.ack]: Date.now() };
      save(KEY.acks, acks);
      toast('Ознакомление подтверждено');
      state.params.open = ''; render(); return;
    }
    if (d.delItem) {
      const lists = load(KEY.lists, {});
      const arr = lists[d.station][d.type];
      const it = arr.find((i) => i.id === d.delItem);
      if (!it || !confirm(`Удалить пункт «${it.text}»?`)) return;
      lists[d.station][d.type] = arr.filter((i) => i.id !== d.delItem);
      save(KEY.lists, lists); render(); return;
    }
    if (d.moveItem) {
      const lists = load(KEY.lists, {});
      const arr = lists[d.station][d.type];
      const i = arr.findIndex((x) => x.id === d.moveItem), j = i + Number(d.dir);
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      save(KEY.lists, lists); render(); return;
    }
    if (d.delTtk) {
      if (!confirm('Удалить эту ТТК?')) return;
      save(KEY.ttk, load(KEY.ttk, []).filter((t) => t.id !== d.delTtk));
      toast('ТТК удалена'); go('ttk'); return;
    }
    if (d.delMember) {
      if (!confirm('Удалить сотрудника?')) return;
      save(KEY.staff, load(KEY.staff, []).filter((u) => u.id !== d.delMember));
      toast('Сотрудник удалён'); go('team', { tab: 'staff' }); return;
    }
    if (el.hasAttribute('data-logout')) { logout(); return; }

    if (d.go) {
      const p = {};
      for (const k of ['station', 'type', 'id', 'tab', 'open', 'edit', 'from', 'to']) if (d[k] !== undefined) p[k] = d[k];
      if (d.go === 'ttk-view' && !p.id) p.id = state.params.id;
      if (d.go === 'checklists') {
        if (!p.station) p.station = state.params.station;
        if (!p.type && p.station === state.params.station) p.type = state.params.type;
      }
      if (d.go === 'team' && p.tab === 'hours' && !p.from && state.params.from) { p.from = state.params.from; p.to = state.params.to; }
      if (d.go === 'ttk' && p.station === undefined && state.view === 'ttk') p.station = state.params.station;
      go(d.go, p);
    }
  });

  // Сохранение текста пункта чек-листа при редактировании
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.editItem) {
      const lists = load(KEY.lists, {});
      const it = lists[t.dataset.station][t.dataset.type].find((i) => i.id === t.dataset.editItem);
      if (it) { it.text = t.value.trim() || it.text; save(KEY.lists, lists); toast('Сохранено'); }
    }
    if (t.id === 'report-date') go('team', { tab: 'report', date: t.value });
    if (t.id === 'ts-from' || t.id === 'ts-to') {
      let from = $('#ts-from').value, to = $('#ts-to').value;
      if (from && to) { if (from > to) [from, to] = [to, from]; go('team', { tab: 'hours', from, to }); }
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'ttk-search') {
      state.params.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const inp = $('#ttk-search'); inp.focus(); inp.setSelectionRange(pos, pos);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (state.user || !/^[0-9]$|^Backspace$/.test(e.key)) return;
    $(`[data-key="${e.key === 'Backspace' ? '⌫' : e.key}"]`)?.click();
  });

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const fd = Object.fromEntries(new FormData(f));
    const type = f.dataset.form;

    if (type === 'add-item') {
      const lists = load(KEY.lists, {});
      lists[f.dataset.station][f.dataset.type].push({ id: uid(), text: fd.text.trim() });
      save(KEY.lists, lists); render(); $('.add-row input')?.focus();
    }

    if (type === 'ttk') {
      const all = load(KEY.ttk, []);
      const ingredients = fd.ingredients.split('\n').map((l) => l.split(';').map((x) => x.trim()))
        .filter((r) => r[0]).map((r) => [r[0], Number(String(r[1] || 0).replace(',', '.')) || 0,
          Number(String(r[2] ?? r[1] ?? 0).replace(',', '.')) || 0]);
      const rec = {
        id: f.dataset.id || 't' + uid(), name: fd.name.trim(), station: fd.station,
        yield: Number(fd.yield) || 0, time: fd.time.trim() || '—', ingredients,
        tech: fd.tech.split('\n').map((x) => x.trim()).filter(Boolean),
        serve: fd.serve.trim() || '—', storage: fd.storage.trim() || '—', allergens: fd.allergens.trim() || '—',
      };
      const i = all.findIndex((t) => t.id === rec.id);
      if (i >= 0) all[i] = rec; else all.push(rec);
      save(KEY.ttk, all); toast('ТТК сохранена'); go('ttk-view', { id: rec.id });
    }

    if (type === 'member') {
      const staff = load(KEY.staff, []);
      const id = f.dataset.id;
      const fields = { name: fd.name.trim(), role: fd.role, station: fd.station, rate: Math.max(0, Number(fd.rate) || 0) };
      if (id) {
        const u = staff.find((x) => x.id === id);
        Object.assign(u, fields, { disabled: !!fd.disabled });
        if (u.id === state.user.id) state.user = u;
      } else {
        staff.push({ id: 'u' + uid(), ...fields });
      }
      if (!staff.some((u) => u.role === 'chef' && !u.disabled)) return toast('Должен остаться хотя бы один активный шеф-повар');
      save(KEY.staff, staff); toast('Сохранено'); go('team', { tab: 'staff' });
    }

    if (type === 'code') {
      if (!/^\d{4}$/.test(fd.code)) return toast('Код — ровно 4 цифры');
      const codes = load(KEY.codes, {});
      const h = await hashPin(fd.code);
      if (Object.entries(codes).some(([g, c]) => g !== f.dataset.group && c.hash === h)) return toast('Этот код уже у другой станции');
      codes[f.dataset.group] = { hash: h, isDefault: false };
      save(KEY.codes, codes);
      toast(`Код «${groupById(f.dataset.group).name}» изменён`);
      go('team', { tab: 'codes' });
    }

    if (type === 'shift') {
      const start = new Date(fd.start).getTime();
      const end = fd.end ? new Date(fd.end).getTime() : null;
      if (!start) return toast('Укажите время прихода');
      if (end && end <= start) return toast('Уход должен быть позже прихода');
      const shifts = allShifts();
      const u = load(KEY.staff, []).find((x) => x.id === fd.uid);
      if (!end && shifts.some((x) => x.uid === fd.uid && !x.end && x.id !== f.dataset.id)) return toast('У сотрудника уже есть открытая смена');
      const rec = { uid: fd.uid, start, end, station: u?.station, edited: true, editedBy: state.user.name };
      const ex = shifts.find((x) => x.id === f.dataset.id);
      if (ex) Object.assign(ex, rec); else shifts.push({ id: 's' + uid(), ...rec });
      save(KEY.shifts, shifts); toast('Смена сохранена'); go('team', { tab: 'hours' });
    }
  });

  // Выгрузка табеля в CSV (открывается в Excel / Google Таблицах)
  function exportCsv(from, to) {
    const staff = load(KEY.staff, []);
    const money = can.manageTeam();
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['Сотрудник', 'Должность', 'Станция', 'Приход', 'Уход', 'Часы', ...(money ? ['Ставка ₸/ч', 'Сумма ₸'] : [])]];
    for (const s of shiftsInPeriod(from, to)) {
      const u = staff.find((x) => x.id === s.uid) || { name: '—', role: 'cook', rate: 0 };
      const h = hours(shiftMs(s));
      rows.push([u.name, ROLES[u.role].name, stationById(s.station).name,
        new Date(s.start).toLocaleString('ru-RU'), s.end ? new Date(s.end).toLocaleString('ru-RU') : 'на смене',
        String(h).replace('.', ','), ...(money ? [u.rate || 0, String(Math.round(h * (u.rate || 0)))] : [])]);
    }
    const csv = '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `tabel_${from}_${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------- Старт ---------------- */
  init().then(() => { restoreSession(); render(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
