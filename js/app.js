/* ============================================================
   Bella Ciao — Kitchen App
   Одностраничное приложение. В опубликованной версии данные кухни
   хранятся в общей базе (js/sync.js) и видны на всех устройствах;
   без неё — в localStorage этого устройства.
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
  // Во время отрисовки экран только читает данные — одно чтение на ключ за кадр
  let renderMemo = null;
  const load = (k, fallback) => {
    if (renderMemo && renderMemo.has(k)) { const v = renderMemo.get(k); return v === undefined ? fallback : v; }
    const v = loadRaw(k);
    if (renderMemo) renderMemo.set(k, v);
    return v === undefined ? fallback : v;
  };
  const loadRaw = (k) => {
    if (Sync.handles(k)) return Sync.get(k);
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; }
    catch { return undefined; }
  };
  const save = (k, v) => {
    if (renderMemo) renderMemo.delete(k);
    if (Sync.handles(k)) { Sync.set(k, v); return; }
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
  // Рабочий день кухни длится до 05:00: отметки закрытия после полуночи идут во вчерашний день
  const workDay = () => {
    const d = new Date(Date.now() - 5 * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const fmtNum = (n) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
  const stationById = (id) => STATIONS.find((s) => s.id === id) || { name: id, short: id, icon: 'clipboard' };
  const groupById = (id) => (id === 'chef' ? CHEF_GROUP : stationById(id));
  const fmtDT = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  // Таймер смены: 1:05:09 (часы без ведущего нуля, минуты и секунды двумя цифрами)
  const fmtClock = (ms, withSec = true) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return `${h}:${String(m).padStart(2, '0')}` + (withSec ? `:${String(sec).padStart(2, '0')}` : '');
  };
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

  // Окно подтверждения внутри приложения (системный confirm() работает не везде)
  function ask(text, okLabel = 'Да', danger = false) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      const single = okLabel === 'Понятно';
      wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
        <div class="modal-box">
          <p>${esc(text)}</p>
          <button class="sheet-btn ${danger ? 'is-danger' : ''}" data-ans="1">${esc(okLabel)}</button>
        </div>
        ${single ? '' : '<button class="sheet-btn sheet-cancel" data-ans="0">Отмена</button>'}
      </div>`;
      const done = (v) => {
        if (wrap.classList.contains('closing')) return;
        wrap.classList.add('closing');
        setTimeout(() => wrap.remove(), 220);
        resolve(v);
      };
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = e.target.closest('[data-ans]');
        if (b) done(b.dataset.ans === '1'); else if (e.target === wrap) done(false);
      });
      document.body.appendChild(wrap);
      wrap.querySelector('[data-ans="1"]').focus();
    });
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
    // Общая база: своя (Firebase) на отдельном адресе или база страницы claude.ai
    const firebaseCfg = typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG && !window.claude?.use ? FIREBASE_CONFIG : null;
    if (firebaseCfg || window.claude?.use) Sync.connecting();
    let db = null;
    if (firebaseCfg) {
      db = await FirebaseDB.connect(firebaseCfg).catch((e) => { console.error(e); return null; });
      if (!db) toast('Не удалось подключиться к базе. Работаем только на этом устройстве');
    } else if (window.claude?.use) {
      db = await window.claude.use('db').catch(() => null);
    }
    if (!db) Sync.noDatabase();
    if (db) {
      const codes = {};
      for (const [g, code] of Object.entries(DEFAULT_CODES)) codes[g] = { hash: await hashPin(code), isDefault: true };
      const lists = {};
      for (const st of STATIONS) { lists[st.id] = {}; for (const t of CHECKLIST_TYPES) lists[st.id][t.id] = []; }
      Sync.start(db, {
        defaults: { staff: DEFAULT_STAFF, codes, lists, ttk: DEFAULT_TTK, safety: DEFAULT_SAFETY },
        onChange: onRemoteChange,
        onError: (e) => {
          if (e && e.code === 'quota_exceeded') toast('База заполнена — сообщите администратору');
          else if (e && (e.code === 'invalid_argument' || e.code === 'not_granted')) toast(firebaseCfg ? 'База отклонила запись. Проверьте правила Firestore' : 'Нет прав на запись. Шефу нужно выдать доступ к странице');
          else if (e && e.code !== 'revoked') toast('Не удалось сохранить. Проверьте интернет');
        },
      });
      return;
    }
    await initLocal();
  }

  // ТТК из учётной системы: добавляются на все устройства один раз.
  // Карты, которые шеф правил, сохраняются; заменяются только старые версии с фото.
  const ttkNeedsUpdate = (list) => !list.some((t) => t.id === 'x001') || !list.some((t) => t.id === 'ny01') || list.some((t) => TTK_REPLACED_IDS.includes(t.id));
  const OLD_TTK_CATEGORIES = ['Мясо и птица', 'Начинки для равиоли', 'Закуски и намазки', 'Овощи и гарниры'];
  function mergeTtkDefaults(stored) {
    const have = new Set(stored.map((t) => t.id));
    const kept = stored.filter((t) => !TTK_REPLACED_IDS.includes(t.id))
      .map((t) => (OLD_TTK_CATEGORIES.includes(t.category) ? { ...t, category: 'Полуфабрикаты' } : t));
    return [...kept, ...DEFAULT_TTK.filter((d) => !have.has(d.id))];
  }

  // Изменения пришли из общей базы (с другого устройства или своё подтверждение)
  let pendingRender = false;
  function onRemoteChange() {
    if (Sync.status === 'online' && !state.ttkChecked) {
      state.ttkChecked = true;
      const ttk = load(KEY.ttk, []);
      if (ttkNeedsUpdate(ttk)) save(KEY.ttk, mergeTtkDefaults(ttk));
    }
    if (state.user) {
      const u = load(KEY.staff, []).find((x) => x.id === state.user.id);
      if (!u || u.disabled) { logout(); return; }
      state.user = u;
    } else if (!state.restored && Sync.ready) {
      state.restored = true; restoreSession();
    }
    const a = document.activeElement;
    const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'ttk-search' && a.id !== 'report-date' && a.id !== 'ts-from' && a.id !== 'ts-to';
    const formView = ['ttk-edit', 'member', 'shift-edit'].includes(state.view);
    if (state.user && (typing || formView)) { pendingRender = true; return; }
    scheduleRender();
  }

  async function initLocal() {
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
    // Загружаем ТТК ресторана (карты с кухни); вручную добавленные карты сохраняются
    { const ttk = load(KEY.ttk, []); if (ttkNeedsUpdate(ttk)) save(KEY.ttk, mergeTtkDefaults(ttk)); }
    if ((load('bc_seed', 0) || 0) < 4) {
      const mine = load(KEY.ttk, []).filter((t) => !DEFAULT_TTK.some((d) => d.id === t.id));
      save(KEY.ttk, [...DEFAULT_TTK, ...mine]);
      save('bc_seed', 4);
    }
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
  let sessionTouched = 0;
  function resetIdle() {
    if (!state.user) return;
    if (Date.now() - sessionTouched > 30000) {
      sessionTouched = Date.now();
      save(KEY.session, { id: state.user.id, at: Date.now(), view: state.view, params: state.params });
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { logout(); toast('Автоматический выход: нет активности 10 минут'); }, IDLE_MS);
  }
  ['pointerdown', 'keydown'].forEach((e) => document.addEventListener(e, resetIdle, { passive: true }));

  // Телефон мог выгрузить приложение из памяти (переключились на другое и вернулись).
  // Возвращаем на тот же экран и восстанавливаем путь «Назад»: главная → раздел → экран.
  const RESTORABLE = ['home', 'checklists', 'ttk', 'ttk-view', 'ttk-storage', 'tips', 'tips-cat', 'safety', 'team', 'profile'];
  function restoreSession() {
    const s = load(KEY.session);
    if (!s || Date.now() - s.at > IDLE_MS) return;
    const u = load(KEY.staff, []).find((x) => x.id === s.id);
    if (!u) return;
    state.user = u; resetIdle();
    if (!RESTORABLE.includes(s.view)) return;
    if (s.view === 'ttk-view' && !load(KEY.ttk, []).some((t) => t.id === (s.params || {}).id)) return;
    state.view = s.view; state.params = s.params || {};
    try {
      const chain = [];
      for (let v = { view: state.view, params: state.params }; v && v.view !== 'home'; v = parentOf(v.view, v.params)) chain.unshift(v);
      history.replaceState({ bc: true, view: 'home', params: {}, depth: 0 }, '');
      navDepth = 0;
      for (const v of chain) history.pushState({ bc: true, view: v.view, params: v.params, depth: ++navDepth }, '');
    } catch { /* история недоступна */ }
  }
  // Логический «родитель» экрана — куда ведёт «Назад», если истории нет
  function parentOf(view, p = {}) {
    if (view === 'ttk-view') {
      if (p.q) return { view: 'ttk', params: { q: p.q } };
      const t = load(KEY.ttk, []).find((x) => x.id === p.id);
      return { view: 'ttk', params: t ? { cat: t.category } : {} };
    }
    if (view === 'ttk-edit') return p.id ? { view: 'ttk-view', params: { id: p.id } } : { view: 'ttk', params: {} };
    if (view === 'ttk-storage') return { view: 'ttk', params: {} };
    if (view === 'tips-cat') return { view: 'tips', params: {} };
    if (view === 'member' || view === 'shift-edit') return { view: 'team', params: { tab: view === 'member' ? 'staff' : 'hours' } };
    if (view === 'ttk' && (p.cat || p.q)) return { view: 'ttk', params: {} };
    return view === 'home' ? null : { view: 'home', params: {} };
  }

  function logout() {
    state.user = null; state.pin = ''; state.group = null; state.view = 'home'; state.params = {};
    localStorage.removeItem(KEY.session);
    clearTimeout(idleTimer);
    render();
  }

  // Точки кода обновляются на месте — экран не перерисовывается и не моргает
  function updatePinDots() {
    const dots = document.querySelectorAll('.pin-dots i');
    if (!dots.length) { render(); return; }
    dots.forEach((dot, i) => dot.classList.toggle('on', i < state.pin.length));
    document.querySelector('.pin-dots')?.classList.remove('shake');
    const box = document.querySelector('.pin-dots');
    if (box) box.setAttribute('aria-label', `Введено цифр: ${state.pin.length} из 4`);
  }

  async function tryLogin() {
    if (Date.now() < state.lockedUntil) return;
    const pin = state.pin;
    const h = await hashPin(pin);
    const codes = load(KEY.codes, {});
    const group = LOGIN_GROUPS.find((g) => codes[g] && codes[g].hash === h);
    if (group) {
      state.group = group; state.pin = ''; state.failed = 0;
      render();
    } else {
      state.failed++;
      state.loginError = 'Неверный код. Попробуйте ещё раз';
      clearTimeout(state.loginErrorT);
      state.loginErrorT = setTimeout(() => { state.loginError = ''; if (!state.user && !state.group) render(); }, 2500);
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

  // Приложением пользуются только руководители кухни: шеф-повар (свой код) и су-шефы (код раздачи).
  // Повара не входят — их приход и уход отмечают шеф или су-шеф в разделе «Команда».
  const LOGIN_GROUPS = ['chef', 'pass'];
  function groupMembers(group) {
    return load(KEY.staff, []).filter((u) => !u.disabled &&
      (group === 'chef' ? u.role === 'chef' : group === 'pass' ? u.role === 'sous' : false));
  }

  function pickUser(id) {
    const user = groupMembers(state.group).find((u) => u.id === id);
    if (!user) return;
    state.user = user; state.group = null;
    state.view = 'home'; state.params = {};
    try { history.replaceState({ bc: true, view: 'home', params: {}, depth: 0 }, ''); navDepth = 0; } catch { /* нет истории */ }
    save(KEY.session, { id: user.id, at: Date.now() });
    resetIdle();
    render();
  }

  /* ---------------- Смены (учёт рабочего времени) ---------------- */
  const allShifts = () => load(KEY.shifts, []);
  const openShift = (userId) => allShifts().find((s) => s.uid === userId && !s.end);

  function clockIn(who = state.user) {
    if (openShift(who.id)) return;
    const shifts = allShifts();
    shifts.push({ id: 's' + uid(), uid: who.id, start: Date.now(), end: null, station: who.station,
      ...(who.id !== state.user.id ? { by: state.user.name } : {}) });
    save(KEY.shifts, shifts);
    toast(who.id === state.user.id ? `Смена начата в ${fmtTime(Date.now())}` : `${who.name}: приход в ${fmtTime(Date.now())}`);
  }

  function clockOut(who = state.user) {
    const shifts = allShifts();
    const s = shifts.find((x) => x.uid === who.id && !x.end);
    if (!s) return;
    s.end = Date.now();
    if (who.id !== state.user.id) s.endBy = state.user.name;
    save(KEY.shifts, shifts);
    toast(who.id === state.user.id ? `Смена закрыта. Отработано: ${fmtDur(s.end - s.start)}` : `${who.name}: уход, отработано ${fmtDur(s.end - s.start)}`);
  }

  // Смены, начавшиеся в периоде [from, to] (даты 'YYYY-MM-DD' включительно)
  function shiftsInPeriod(from, to) {
    const a = dayStart(from), b = dayStart(to) + 864e5;
    return allShifts().filter((s) => s.start >= a && s.start < b).sort((x, y) => x.start - y.start);
  }
  const shiftMs = (s) => (s.end || Date.now()) - s.start;
  const LONG_SHIFT_MS = 16 * 3600000;

  /* ---------------- Навигация ---------------- */
  // Ключ экрана: по нему помним прокрутку и понимаем, тот же ли это экран
  const viewKeyOf = (view, p = {}) => [view, p.station, p.type, p.id, p.tab, p.cat, p.edit, p.from, p.to, p.date].join('|');
  const scrollMemory = {};
  let navDepth = 0;

  // Переход на экран. Кнопка «Назад» телефона возвращает на предыдущий экран, а не закрывает приложение
  const TABS = ['home', 'checklists', 'ttk', 'tips', 'safety', 'team'];
  function go(view, params = {}, opts = {}) {
    scrollMemory[viewKeyOf(state.view, state.params)] = window.scrollY;
    const sameScreen = screenOf(view, params) === screenOf(state.view, state.params);
    // Направление перехода: назад — слева, вкладка — мягкая смена, остальное — справа
    state.navDir = opts.fromHistory ? 'back' : TABS.includes(view) && (TABS.includes(state.view) || opts.tab) ? 'tab' : 'forward';
    state.view = view; state.params = params; pendingRender = false;
    if (state.user) save(KEY.session, { id: state.user.id, at: Date.now(), view, params });
    if (!opts.fromHistory) {
      try {
        // Фильтры и вкладки внутри экрана не копятся в истории «Назад»
        if (sameScreen || opts.replace) history.replaceState({ bc: true, view, params, depth: navDepth }, '');
        else { history.pushState({ bc: true, view, params, depth: navDepth + 1 }, ''); navDepth++; }
      } catch { /* история недоступна */ }
    }
    render();
    if (!sameScreen) window.scrollTo(0, opts.fromHistory ? (scrollMemory[viewKeyOf(view, params)] || 0) : 0);
  }

  // Вкладки внизу — как в приложениях iPhone: переключение вкладки не добавляет шаг в «Назад».
  // В истории остаются только главная и путь внутри текущей вкладки, поэтому жест «назад»
  // никогда не перекидывает на другую вкладку (например, из ТТК в чек-листы).
  let pendingTab = null;
  function goTab(view, params) {
    if (navDepth > 1 || (view === 'home' && navDepth > 0)) {
      // сначала сворачиваем историю до главной (или до первой вкладки), потом показываем нужную
      pendingTab = { view, params };
      try { history.go(-(view === 'home' ? navDepth : navDepth - 1)); return; } catch { pendingTab = null; }
    }
    if (view === 'home') { go('home', params, { tab: true }); return; }
    showTab(view, params);
  }
  // Открыть вкладку на уровне 1 истории; если она открывается сразу внутри раздела
  // (ТТК помнит последний раздел), под ним в истории лежит начало вкладки
  function showTab(view, params) {
    const par = parentOf(view, params);
    if (par && par.view !== 'home') {
      try {
        if (navDepth >= 1) history.replaceState({ bc: true, view: par.view, params: par.params, depth: 1 }, '');
        else history.pushState({ bc: true, view: par.view, params: par.params, depth: 1 }, '');
        navDepth = 1;
      } catch { /* нет истории */ }
      go(view, params, { tab: true });
      return;
    }
    go(view, params, { tab: true, replace: navDepth >= 1 });
  }

  window.addEventListener('popstate', (e) => {
    if (!state.user) return;
    const st = e.state && e.state.bc ? e.state : { view: 'home', params: {}, depth: 0 };
    navDepth = st.depth || 0;
    document.querySelector('.modal')?.remove();
    if (pendingTab) {
      const t = pendingTab; pendingTab = null;
      if (t.view === 'home') go('home', t.params, { tab: true, replace: true });
      else showTab(t.view, t.params);
      return;
    }
    go(st.view, st.params || {}, { fromHistory: true });
  });

  // Свайп от левого края — «назад», как во всех приложениях iPhone. В Safari и Chrome этот жест
  // уже есть у браузера, поэтому включаем свой только в приложении, установленном на экран «Домой».
  const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (standalone && 'ontouchstart' in window) {
    let sw = null;
    document.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX > 24 || !state.user || navDepth < 1 || document.querySelector('.modal')) return;
      const strip = e.target.closest?.('.chips, .table-wrap');
      if (strip && strip.scrollLeft > 0) return; // это прокрутка ленты, а не «назад»
      const main = document.querySelector('#app > main');
      if (main) sw = { x: t.clientX, y: t.clientY, t: Date.now(), main, dx: 0, lock: null, lastX: t.clientX, lastT: Date.now(), v: 0 };
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!sw) return;
      const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (sw.lock === null && Math.abs(dx) + Math.abs(dy) > 8) {
        sw.lock = Math.abs(dx) > Math.abs(dy) * 1.2 && dx > 0;
        if (!sw.lock) { sw = null; return; }
        // анимация входа (fill: both) перекрывает transform — снимаем её
        sw.main.classList.remove('enter-forward', 'enter-back', 'enter-tab');
        sw.main.style.transition = 'none'; sw.main.style.willChange = 'transform';
        sw.main.classList.add('swiping');
      }
      if (!sw.lock) return;
      e.preventDefault();
      const now = Date.now();
      sw.v = (t.clientX - sw.lastX) / Math.max(1, now - sw.lastT); sw.lastX = t.clientX; sw.lastT = now;
      sw.dx = Math.max(0, dx);
      sw.main.style.transform = `translate3d(${sw.dx}px,0,0)`;
    }, { passive: false });
    const end = () => {
      if (!sw) return;
      const { main, dx, v, lock } = sw; sw = null;
      if (!lock) return;
      const w = window.innerWidth, done = dx > w * 0.33 || (v > 0.45 && dx > 30);
      main.style.transition = `transform ${done ? 0.22 : 0.35}s cubic-bezier(.22,1,.36,1)`;
      main.style.transform = done ? `translate3d(${w}px,0,0)` : '';
      setTimeout(() => {
        if (done) { if (navigator.vibrate) navigator.vibrate(8); history.back(); }
        else { main.style.transition = ''; main.style.willChange = ''; main.classList.remove('swiping'); }
      }, done ? 200 : 350);
    };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  }

  // Кнопка «‹» в шапке: назад по истории, если есть куда, иначе на указанный экран
  function goBack(fallback) {
    if (navDepth > 0) { history.back(); return; }
    const par = parentOf(state.view, state.params);
    if (par) go(par.view, par.params, { replace: true }); else go(fallback);
  }

  /* ---------------- Чек-листы: данные ---------------- */
  const checkKey = (date, station, type) => `${date}|${station}|${type}`;
  function getChecks(date, station, type) {
    return load(KEY.checks, {})[checkKey(date, station, type)] || {};
  }
  function toggleCheck(station, type, itemId) {
    const all = load(KEY.checks, {});
    const k = checkKey(workDay(), station, type);
    const rec = all[k] || {};
    if (rec[itemId]) delete rec[itemId];
    else rec[itemId] = { by: state.user.name, uid: state.user.id, at: Date.now() };
    all[k] = rec;
    // Храним историю за последние 60 дней
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    for (const key of Object.keys(all)) if (key.split('|')[0] < cutoff) delete all[key];
    save(KEY.checks, all);
  }
  function progress(station, type, date = workDay()) {
    const items = (load(KEY.lists, {})[station] || {})[type] || [];
    const done = getChecks(date, station, type);
    const n = items.filter((i) => done[i.id]).length;
    return { n, total: items.length, pct: items.length ? Math.round((n / items.length) * 100) : 0 };
  }
  // Какой чек-лист актуален сейчас: утром открытие, днём смена, вечером и ночью закрытие
  const defaultType = () => { const hr = new Date().getHours(); return hr >= 21 || hr < 5 ? 'close' : hr >= 11 ? 'shift' : 'open'; };
  function stationProgress(station, date = workDay()) {
    let n = 0, total = 0;
    for (const t of CHECKLIST_TYPES) { const p = progress(station, t.id, date); n += p.n; total += p.total; }
    return { n, total, pct: total ? Math.round((n / total) * 100) : 0 };
  }


  /* ---------------- Иконки (линейные SVG) ---------------- */
  const ICONS = {
    home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
    checklist: 'M10.5 7H20M10.5 12H20M10.5 17H20M4 7l1.4 1.4L8 5.8M4 12l1.4 1.4L8 10.8M4 17l1.4 1.4L8 15.8',
    book: 'M12 6.5C10.4 5 8 4.5 4 4.5v14c4 0 6.4.5 8 2 1.6-1.5 4-2 8-2v-14c-4 0-6.4.5-8 2zM12 6.5v14',
    shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6zM9 12l2 2 4-4',
    users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.2 2',
    chart: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
    lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
    chevL: 'M15 18l-6-6 6-6', chevR: 'M9 6l6 6-6 6', chevUp: 'M6 15l6-6 6 6', chevDown: 'M6 9l6 6 6-6',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l2 2',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    x: 'M6 6l12 12M18 6 6 18',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 17l5-5-5-5M15 12H3',
    alert: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.2h.01',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
    backspace: 'M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5',
    // станции
    snowflake: 'M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8M9.3 4.3 12 6.2l2.7-1.9M9.3 19.7l2.7-1.9 2.7 1.9M4.4 10.6l3.1.8-.8 3.1M19.6 13.4l-3.1-.8.8-3.1M4.4 13.4l3.1-.8-.8-3.1M19.6 10.6l-3.1.8.8 3.1',
    pasta: 'M3.5 11.5h17a8.5 8.5 0 0 1-17 0zM7.5 11.5c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4M10 11.5c0-1.1.9-2 2-2s2 .9 2 2M17.5 2.5l-4 9M20.5 4l-5.5 7.5',
    flame: 'M12 21.5c3.9 0 7-2.7 7-6.8 0-3.2-2-5.6-3.9-7.5 0 2.5-1.4 3.9-2.9 3.9 0-3-1-6.2-4-8.6 0 4.1-3.2 6.4-3.2 11.4 0 4.6 3 7.6 7 7.6zM12 21.5c-1.7 0-3-1.3-3-3 0-2 1.5-3 3-4.8 1.5 1.8 3 2.8 3 4.8 0 1.7-1.3 3-3 3z',
    bell: 'M3 18h18M4.5 18a7.5 7.5 0 0 1 15 0M12 10.5V8.5M10.2 8.5h3.6M2.5 21h19',
    pizza: 'M12 21.5 3 6.6A17 17 0 0 1 21 6.6zM5 9.8a13.5 13.5 0 0 1 14 0M10 12.6h.01M14 12.2h.01M12 16.5h.01',
    cake: 'M3.5 21h17M5.5 21v-6.5A1.5 1.5 0 0 1 7 13h10a1.5 1.5 0 0 1 1.5 1.5V21M5.5 17.2c1.6 1.2 3.2 1.2 4.8 0s3.2-1.2 4.8 0 2.6 1.1 3.4.6M12 13V9.8M12 7.3c-.8 0-1.4-.6-1.4-1.4 0-1 1.4-2.4 1.4-2.4s1.4 1.4 1.4 2.4c0 .8-.6 1.4-1.4 1.4z',
    chefhat: 'M7 16.5h10V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1zM7 16.5V13a4 4 0 0 1-.9-7.8A5.5 5.5 0 0 1 12 3a5.5 5.5 0 0 1 5.9 2.2A4 4 0 0 1 17 13v3.5',
    // категории ТТК
    coffee: 'M4.5 9h11.5v5a5 5 0 0 1-5 5H9.5a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.7.8-.7 1.7 0 2.5M11.5 3.5c-.7.8-.7 1.7 0 2.5M3.5 21.5h14',
    pot: 'M4 10h16v6.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M8.5 10V8a3.5 3.5 0 0 1 7 0v2',
    soup: 'M3.5 11.5h17a8.5 8.5 0 0 1-17 0zM8.5 8.5c.9-1.1.9-2.2 0-3.3M12 8.5c.9-1.1.9-2.2 0-3.3M15.5 8.5c.9-1.1.9-2.2 0-3.3',
    meat: 'M16 4.2c3 1.6 4.4 5.2 2.9 8.6-1.8 4-6.8 6.9-10.6 6.2-3.3-.6-4.7-3.6-3.6-6.6 1.2-3.6 4.4-5 6.6-6.8 1.6-1.3 3.1-2 4.7-1.4zM9.6 13.4a2 2 0 1 0 4 0 2 2 0 0 0-4 0z',
    carrot: 'M16.5 7.5 6 19.2c-1 1-2.6.1-2.2-1.2L7.5 8c1.3-2.6 4.8-3.3 7.3-1.5zM15.5 6.5 18 3M16.5 7.5l3.8-.9M16.5 7.5l1.2-3.8M8.4 13l2 .9M7.2 16.6l1.6.7',
    bread: 'M6 20h12a1 1 0 0 0 1-1v-7.2A4 4 0 0 0 17 5H7a4 4 0 0 0-2 6.8V19a1 1 0 0 0 1 1zM9.5 10l1.5 1.5M13 10l1.5 1.5',
    // ТБ
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1.5v2M12 20.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
    moon: 'M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.8 6.8 0 0 0 10 10z',
    clipboard: 'M9 3h6v3H9zM7 4.5H5.5a.5.5 0 0 0-.5.5v15.5a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H17M8.5 11h7M8.5 15h7M8.5 19h3.5',
    knife: 'M3 21 13.5 10.5M13.5 10.5 20 4c1 3.5 0 6.5-3 8.5l-3.5-2z',
    extinguisher: 'M8 9h6v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1zM11 9V6M8 6h6.5l2.5-2M9 6a3 3 0 0 0-4 3v3',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    drop: 'M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z',
    firstaid: 'M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM8.5 7V4.5h7V7M12 10.5v6M9 13.5h6',
    fish: 'M3 12c2.4-3.6 5.8-5.5 9.5-5.5S19 8.4 21 12c-2 3.6-4.8 5.5-8.5 5.5S5.4 15.6 3 12zM3 12 1 9.5M3 12l-2 2.5M16.5 10.8h.01',
    leaf: 'M5 19c-.5-6.5 3.5-12.5 15-14-1 11.5-7.5 15.5-14 14.5zM5 19l7.5-7.5',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5v-.5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z',
    gift: 'M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 7.5h18V11H3zM12 7.5V21M12 7.5C10.5 4 7 3.6 7 5.6 7 7 9.5 7.5 12 7.5zM12 7.5c1.5-3.5 5-3.9 5-1.9 0 1.4-2.5 1.9-5 1.9z',
    cog: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  };
  // Цвет плитки: у каждой станции и категории ТТК свой
  const STATION_TONE = { cold: 'sky', pasta: 'amber', grill: 'coral', pass: 'navy', pizza: 'rose', pastry: 'plum', chef: 'violet' };
  const CATEGORY_LOOK = {
    'Новогодний спешл': ['gift', 'coral'],
    'Завтраки': ['coffee', 'amber'], 'Салаты': ['leaf', 'green'], 'Закуски и антипасти': ['bread', 'teal'],
    'Супы и бульоны': ['soup', 'sky'], 'Паста и равиоли': ['pasta', 'navy'], 'Пицца': ['pizza', 'rose'],
    'Горячие блюда': ['flame', 'coral'], 'Детское меню': ['sun', 'violet'], 'Десерты': ['cake', 'plum'],
    'Соусы и заправки': ['pot', 'rose'], 'Тесто и хлеб': ['bread', 'amber'], 'Рыба и морепродукты': ['fish', 'sky'],
    'Полуфабрикаты': ['clipboard', 'navy'],
  };
  // Разделы меню и разделы полуфабрикатов на экране ТТК
  const MENU_CATEGORIES = ['Новогодний спешл', 'Завтраки', 'Салаты', 'Закуски и антипасти', 'Супы и бульоны', 'Паста и равиоли', 'Пицца', 'Горячие блюда', 'Детское меню', 'Десерты'];
  const plural = (n, [one, few, many]) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  const tone = (stationId) => 'tone-' + (STATION_TONE[stationId] || 'navy');
  const ic = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.shield}"/></svg>`;

  /* ---------------- Компоненты ---------------- */
  const ring = (pct, size = 56) => {
    const r = size / 2 - 5, c = 2 * Math.PI * r;
    return `<svg class="ring${pct >= 100 ? ' full' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="${pct}%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c - (c * pct) / 100}"/>
      <text x="50%" y="50%" dy=".35em" text-anchor="middle">${pct}%</text></svg>`;
  };

  // Шапка как в приложениях iPhone: на главных экранах — крупный заголовок, который при прокрутке
  // уезжает в полупрозрачную шапку; на вложенных — «‹ Назад» и заголовок по центру
  const header = (title, back) => `
    <div class="topbar-wrap ${back ? 'is-detail' : 'is-root'}">
      <header class="topbar">
        <div class="nav-lead">${back ? `<button class="nav-back" data-back="${back}" aria-label="Назад">${ic('chevL', 24)}<span>Назад</span></button>` : '<div class="brand-mini" aria-label="Bella Ciao">Bella Ciao</div>'}</div>
        <h1 class="nav-title">${esc(title)}</h1>
        <div class="nav-trail">
        ${(() => {
          const open = state.view !== 'home' && openShift(state.user.id);
          return open ? `<button class="shift-pill" data-go="home" aria-label="Вы на смене. Открыть главную">
            <i></i><span role="timer" aria-live="off" data-since="${open.start}" data-fmt="full">${fmtClock(Date.now() - open.start)}</span></button>` : '';
        })()}
        <button class="avatar ${tone(state.user.role === 'chef' ? 'chef' : state.user.station)}" data-go="profile" aria-label="Профиль: ${esc(state.user.name)}">${esc(initials(state.user.name))}</button>
        </div>
      </header>
    </div>${back ? '' : `<!--LT:${esc(title)}-->`}`;

  const initials = (name) => name.split(/\s+/).filter((w) => /^[\p{L}]/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function nav() {
    const items = [
      ['home', 'home', 'Главная'],
      ['checklists', 'checklist', 'Чек-листы'],
      ['ttk', 'book', 'ТТК'],
      ['tips', 'bulb', 'Советы'],
      ['safety', 'shield', 'ТБ'],
    ];
    if (can.report()) items.push(['team', 'users', 'Команда']);
    // Красные счётчики, как на iPhone: сколько пунктов осталось в текущем чек-листе своей станции
    // и сколько разделов ТБ ещё не прочитано
    const u = state.user;
    const badges = {};
    if (STATIONS.some((s) => s.id === u.station)) {
      const p = progress(u.station, defaultType());
      if (p.total > p.n) badges.checklists = p.total - p.n;
    }
    const acks = load(KEY.acks, {})[u.id] || {};
    const unread = load(KEY.safety, []).filter((s) => (!s.stations.length || s.stations.includes(u.station) || can.allStations()) && !acks[s.id]).length;
    if (unread) badges.safety = unread;
    return `<nav class="bottom-nav">${items.map(([v, i, l]) =>
      `<button class="${state.view.startsWith(v) ? 'active' : ''}" data-go="${v}"${badges[v] ? ` aria-label="${l}, ${badges[v]}"` : ''}><span class="ni">${ic(i, 22)}${badges[v] ? `<b class="badge">${badges[v] > 99 ? '99+' : badges[v]}</b>` : ''}</span><span>${l}</span></button>`
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
          ? `<div class="shift-timer" role="timer" aria-live="off" data-since="${open.start}" data-fmt="full">${fmtClock(Date.now() - open.start)}</div>
             <small>Начало в ${fmtTime(open.start)}${new Date(open.start).toDateString() === new Date().toDateString() ? '' : ' · ' + fmtDate(open.start)}</small>`
          : `<div class="shift-timer is-off">Не на смене</div><small>Отметьте приход, когда начинаете работу</small>`}
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
            <span class="st-icon ${tone(g.id)}">${ic(g.icon, 24)}</span>
            <div><div class="eyebrow">${esc(g.name)}</div><h2>Кто вы?</h2></div>
          </div>
          <div class="pick-list">
            ${members.map((u) => {
              const open = openShift(u.id);
              return `<button class="pick-row" data-pick="${u.id}">
                <span class="avatar lg ${tone(u.role === 'chef' ? 'chef' : u.station)}">${esc(initials(u.name))}</span>
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
    const locked = Date.now() < state.lockedUntil || ((Sync.status === 'loading' || Sync.status === 'offline') && !Sync.ready);
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
          <h1 class="login-title">Вход на кухню</h1>
          <p class="login-hint ${state.loginError || (Sync.status === 'offline' && !Sync.ready) || Date.now() < state.lockedUntil ? 'is-warn' : ''}" role="status">${Date.now() < state.lockedUntil ? 'Слишком много попыток. Подождите 30 секунд.'
            : state.loginError ? state.loginError
            : Sync.status === 'loading' && !Sync.ready ? 'Подключаемся к базе…'
            : Sync.status === 'offline' && !Sync.ready ? 'Нет связи с базой. Проверьте интернет — приложение подключится само.'
            : Date.now() < state.lockedUntil ? 'Слишком много попыток. Подождите 30 секунд.' : 'Введите код руководителя'}</p>
          <div class="pin-dots" aria-label="Введено цифр: ${state.pin.length} из 4">${dots}</div>
          <div class="keypad">
            ${keys.map((k) => k === ''
              ? '<span></span>'
              : `<button class="key${k === '⌫' ? ' key-del' : ''}" data-key="${k}" ${locked ? 'disabled' : ''} ${k === '⌫' ? 'aria-label="Стереть"' : ''}>${k === '⌫' ? ic('backspace', 26) : k}</button>`).join('')}
          </div>
          <p class="login-foot"><span class="net net-${Sync.status}"><i></i>${Sync.status === 'online' ? 'общая база подключена'
            : Sync.status === 'local' ? 'данные на этом устройстве' : Sync.status === 'offline' ? 'нет связи' : 'подключение…'}</span></p>
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

    return `${header(greet)}
      <main class="page">
        <p class="lt-sub">${esc(new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(u.name.split(/\s+/)[0])}, ${esc(u.role === 'cook' ? stationById(u.station).name.toLowerCase() : ROLES[u.role].name.toLowerCase())}</p>

        ${shiftCard()}
        ${can.manageTeam() && LOGIN_GROUPS.some((g) => load(KEY.codes, {})[g]?.isDefault)
          ? `<div class="alert" data-go="team" data-tab="codes">${ic('lock', 18)}<span>Стандартные коды входа ещё не сменены. <b>Смените их</b> в разделе «Команда → Коды».</span></div>` : ''}
        ${unread ? `<div class="quick"><button class="card quick-card" data-go="safety">
            <span class="q-ic tone-green">${ic('shield', 22)}</span>
            <span class="q-t"><b>Техника безопасности</b><small>Нужно прочитать и подтвердить</small></span>
            <span class="count-pill">${unread}</span>${ic('chevR', 18)}</button></div>` : ''}

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
              <span class="st-icon ${tone(s.id)}">${ic(s.icon, 24)}</span>
              <span class="st-body"><b>${esc(s.name)}</b><small${p.total && p.n === p.total ? ' class="ok-t"' : ''}>${!p.total ? 'Пункты ещё не добавлены' : p.n === p.total ? 'Всё выполнено' : `Выполнено ${p.n} из ${p.total}`}</small></span>
              ${p.total ? ring(p.pct) : `<span class="chev">${ic('chevR', 18)}</span>`}
            </button>`;
          }).join('')}
        </div>

      </main>${nav()}`;
  }

  function viewChecklists() {
    const stations = visibleStations();
    const st = state.params.station && stations.some((s) => s.id === state.params.station)
      ? state.params.station : (stations.find((s) => s.id === state.user.station) || stations[0]).id;
    const type = state.params.type || defaultType();
    state.lastCl = { station: st, type, at: Date.now() };
    const items = (load(KEY.lists, {})[st] || {})[type] || [];
    const done = getChecks(workDay(), st, type);
    const p = progress(st, type);
    const editing = state.params.edit && can.editLists();

    return `${header('Чек-листы')}
      <main class="page">
        ${stations.length > 1 ? `<div class="chips">${stations.map((s) =>
          `<button class="chip ${s.id === st ? 'on' : ''}" data-go="checklists" data-station="${s.id}" data-type="${type}">${ic(s.icon, 16)} ${esc(s.short)}</button>`).join('')}</div>` : ''}

        <div class="segmented">${CHECKLIST_TYPES.map((t) => {
          const tp = progress(st, t.id);
          return `<button class="${t.id === type ? 'on' : ''}" data-go="checklists" data-station="${st}" data-type="${t.id}">
            <span class="seg-t">${{ open: 'Открытие', shift: 'Смена', close: 'Закрытие' }[t.id] || t.name}</span><small>${tp.total ? `${tp.n} из ${tp.total}` : '—'}</small></button>`;
        }).join('')}</div>

        <div class="list-head">
          <div>
            <div class="eyebrow">${esc(stationById(st).name)}</div>
            <h2>${CHECKLIST_TYPES.find((t) => t.id === type).name}</h2>
            <div class="list-sub${p.total && p.n === p.total ? ' ok-t' : ''}">${!p.total ? 'Пунктов пока нет' : p.n === p.total ? 'Всё выполнено' : `Осталось ${p.total - p.n} из ${p.total}`}</div>
          </div>
          ${p.total ? ring(p.pct, 64) : ''}
        </div>

        ${editing ? `<div class="edit-banner">${ic('edit', 18)}<span>Пункты для станции <b>${esc(stationById(st).name)}</b> · ${CHECKLIST_TYPES.find((t) => t.id === type).name}. Их увидят только повара этой станции.</span></div>` : ''}
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
          ${(() => {
            const lists = load(KEY.lists, {});
            const sources = STATIONS.filter((x) => x.id !== st && ((lists[x.id] || {})[type] || []).length);
            return sources.length ? `<form class="copy-row" data-form="copy-items" data-station="${st}" data-type="${type}">
              <label for="copy-from">Скопировать пункты «${CHECKLIST_TYPES.find((t) => t.id === type).name.toLowerCase()}» из другой станции</label>
              <div class="copy-in">
                <select id="copy-from" name="from">${sources.map((x) => `<option value="${x.id}">${esc(x.name)} · ${lists[x.id][type].length} п.</option>`).join('')}</select>
                <button class="btn btn-ghost">${ic('plus', 16)} Добавить к списку</button>
              </div>
            </form>` : '';
          })()}
          <p class="muted">Изменения сохраняются сразу и видны всем. Отметки, уже поставленные сегодня, не сбрасываются.</p>
          <button class="btn btn-ghost wide" data-go="checklists" data-station="${st}" data-type="${type}">${ic('check', 18)} Готово</button>`
          : `${p.pct === 100 && items.length ? `<div class="done-banner">${ic('check', 18)} Чек-лист выполнен полностью</div>` : ''}
             ${can.editLists() && items.length ? `<button class="btn btn-ghost wide" data-go="checklists" data-station="${st}" data-type="${type}" data-edit="1">${ic('edit', 16)} Редактировать пункты</button>` : ''}`}
      </main>${nav()}`;
  }

  /* ---------- ТТК: форматирование ---------- */
  // Ингредиент: [название, количество, единица]. Старый формат [название, брутто, нетто] → граммы.
  const ingUnit = (i) => (typeof i[2] === 'string' ? i[2] : 'г');
  function fmtQty(q, unit) {
    const n = Number(q) || 0;
    const digits = unit === 'кг' || unit === 'л' ? 3 : 1;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: unit === 'кг' || unit === 'л' ? 3 : 0, maximumFractionDigits: digits });
  }
  // Для чтения на кухне: 270 г вместо 0,270 кг; 1,5 кг остаётся в килограммах
  function showQty(q, unit) {
    const n = Number(q) || 0;
    const nice = (v, d) => v.toLocaleString('ru-RU', { maximumFractionDigits: d });
    if (unit === 'кг' && n < 1) return [nice(n * 1000, 1), 'г'];
    if (unit === 'л' && n < 1) return [nice(n * 1000, 1), 'мл'];
    if (unit === 'кг' || unit === 'л') return [nice(n, 3), unit];
    return [nice(n, 2), unit];
  }
  // Поиск карты полуфабриката по названию ингредиента («ПФ Тесто для Пиццы» → его ТТК)
  const ttkKey = (s) => String(s).toLowerCase().replace(/ё/g, 'е')
    .replace(/\(new\)|new/g, ' ').replace(/(^|[^a-zа-я0-9])(пф|нетто)(?=[^a-zа-я0-9]|$)/g, '$1 ')
    .replace(/[^a-zа-я0-9]/g, '');
  const ttkStationLabel = (t) => (t.station ? stationById(t.station).short : 'Все станции');

  function viewTtk() {
    const all = load(KEY.ttk, []);
    const q = (state.params.q || '').trim().toLowerCase();
    const cat = state.params.cat || '';
    const st = ''; // фильтр по станциям убран: станция подписана у каждой карты
    const catOf = (t) => (TTK_CATEGORIES.includes(t.category) ? t.category : 'Другое');
    const cats = TTK_CATEGORIES.filter((c) => all.some((t) => t.category === c));
    if (all.some((t) => catOf(t) === 'Другое')) cats.push('Другое');
    const byStation = all.filter((t) => !st || t.station === st || !t.station);
    const look = (c) => CATEGORY_LOOK[c] || ['book', 'navy'];
    const card = (t) => `
      <button class="card ttk-card" data-go="ttk-view" data-id="${t.id}">
        <span class="ttk-st tone-${look(t.category)[1]}${t.photo ? ' has-photo' : ''}">${ic(look(t.category)[0], 22)}${t.photo ? `<img class="ttk-thumb" src="${esc(t.photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"/>` : ''}</span>
        <span class="ttk-body">
          <b>${esc(t.name)}</b>
          <small>${[t.kind === 'dish' ? '' : 'Полуфабрикат', t.station ? stationById(t.station).short : '', t.yield || ''].filter(Boolean).map(esc).join(' · ')}${t.note ? ' · <span class="warn-t">сверить</span>' : ''}</small>
        </span>
        <span class="chev">${ic('chevR', 18)}</span>
      </button>`;
    const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

    let body;
    if (!all.length) {
      body = `<div class="card empty-list">${ic('book', 32)}<b>Технологических карт пока нет</b>
        <p class="muted">${can.editTtk() ? 'Добавьте первую карту кнопкой «+».' : 'Карты добавляет шеф-повар или су-шеф.'}</p></div>`;
    } else if (q) {
      // Поиск — по всем картам: названию и составу
      const found = byStation.filter((t) => t.name.toLowerCase().includes(q) || t.ingredients.some((i) => String(i[0]).toLowerCase().includes(q)));
      const groups = cats.map((c) => [c, found.filter((t) => catOf(t) === c).sort(byName)]).filter(([, l]) => l.length);
      body = groups.length ? groups.map(([c, l]) => `<h2 class="section-title">${esc(c)} · ${l.length}</h2><div class="ttk-list">${l.map(card).join('')}</div>`).join('')
        : `<p class="empty">Ничего не найдено по запросу «${esc(state.params.q)}»</p>`;
    } else if (cat) {
      const l = byStation.filter((t) => catOf(t) === cat).sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === 'dish' ? -1 : 1));
      body = `<h2 class="section-title">${esc(cat)} · ${l.length}</h2><div class="ttk-list">${l.map(card).join('') || '<p class="empty">Для этой станции карт нет</p>'}</div>`;
    } else {
      // Главный экран ТТК — плитки разделов
      const tile = (c) => {
        const n = byStation.filter((t) => catOf(t) === c).length;
        const cover = all.find((t) => t.category === c && t.photo && t.id === 'ny05') || all.find((t) => t.category === c && t.photo);
        if (n && cover) return `<button class="card cat-tile cat-feature" data-go="ttk" data-cat="${esc(c)}" data-station="${st}">
          <img src="${esc(cover.photo)}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('no-photo'); this.remove()"/>
          <span class="cat-t"><b>${esc(c)}</b><small>${n} ${plural(n, ['карта', 'карты', 'карт'])}</small></span></button>`;
        return n ? `<button class="card cat-tile" data-go="ttk" data-cat="${esc(c)}" data-station="${st}">
          <span class="ttk-st tone-${look(c)[1]}">${ic(look(c)[0], 24)}</span>
          <span class="cat-t"><b>${esc(c)}</b><small>${n} ${plural(n, ['карта', 'карты', 'карт'])}</small></span></button>` : '';
      };
      const menu = cats.filter((c) => MENU_CATEGORIES.includes(c)).map(tile).join('');
      const pf = cats.filter((c) => !MENU_CATEGORIES.includes(c)).map(tile).join('');
      body = `${menu ? `<h2 class="section-title">Блюда меню</h2><div class="cat-grid">${menu}</div>` : ''}
        ${pf ? `<h2 class="section-title">Полуфабрикаты</h2><div class="cat-grid">${pf}</div>` : ''}
        <button class="card storage-link" data-go="ttk-storage">${ic('clock', 20)}<span><b>Сроки хранения ПФ</b><small>Срок, температура и тара</small></span>${ic('chevR', 18)}</button>`;
    }

    return `${header('ТТК')}
      <main class="page">
        <div class="search">
          <input type="search" id="ttk-search" placeholder="Блюдо или продукт" value="${esc(state.params.q || '')}" enterkeyhint="search" autocomplete="off"/>
        </div>
        ${cat || q ? `<div class="chips">
          <button class="chip ${!cat ? 'on' : ''}" data-go="ttk" data-cat="" data-station="${st}">Все разделы</button>
          ${cats.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-go="ttk" data-cat="${esc(c)}" data-station="${st}">${esc(c)}</button>`).join('')}
        </div>` : ''}
        ${body}
        ${can.editTtk() ? `<button class="fab" data-go="ttk-edit" aria-label="Новая ТТК">${ic('plus', 26)}</button>` : ''}
      </main>${nav()}`;
  }

  function viewTtkStorage() {
    return `${header('Сроки хранения', 'ttk')}
      <main class="page">
        <p class="lead">Таблица сроков хранения полуфабрикатов (лист с холодного цеха).</p>
        <div class="table-wrap">
          <table class="ing storage-table">
            <thead><tr><th>Полуфабрикат</th><th>Срок</th><th>Температура</th><th>Тара</th></tr></thead>
            <tbody>${STORAGE_TABLE.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </main>${nav()}`;
  }

  function viewTtkDetail() {
    const allTtk = load(KEY.ttk, []);
    const t = allTtk.find((x) => x.id === state.params.id);
    if (!t) return viewTtk();
    const pfIndex = new Map(allTtk.filter((x) => x.kind === 'pf').map((x) => [ttkKey(x.name), x.id]));
    const k = Number(state.params.k || 1);
    const isDish = t.kind === 'dish';
    const tech = (t.tech || []).filter(Boolean);
    const info = [['Подача', t.serve], ['Хранение', t.storage], ['Аллергены', t.allergens]].filter(([, v]) => v && v !== '—');

    return `${header('ТТК', 'ttk')}
      <main class="page ttk-detail">
        ${t.photo ? `<figure class="ttk-photo"><img src="${esc(t.photo)}" alt="${esc(t.name)}" decoding="async" onerror="this.parentNode.remove()"/></figure>` : ''}
        <div class="eyebrow">${esc([t.category, t.station ? stationById(t.station).short : 'Все станции']
          .filter((x, i, a) => x && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(' · '))}</div>
        <h2 class="dish">${esc(t.name)}</h2>
        <div class="meta-row">
          <span>Выход: <b>${esc(t.yield || '—')}</b>${k > 1 ? ` × ${k}` : ''}</span>
          ${t.time ? `<span>Время: <b>${esc(t.time)}</b></span>` : ''}
        </div>
        ${t.note ? `<div class="alert">${ic('alert', 18)}<span>${esc(t.note)}</span></div>` : ''}

        <div class="scaler">
          <div class="scaler-row">
            <span class="scaler-l">${isDish ? 'Порций' : 'Замесов'}</span>
            <span class="stepper">
              <button data-scale="-1" aria-label="Меньше" ${k <= 1 ? 'disabled' : ''}>${ic('minus', 18)}</button>
              <b aria-live="polite">${k}</b>
              <button data-scale="1" aria-label="Больше">${ic('plus', 18)}</button>
            </span>
          </div>
          <div class="segmented seg-sm">${[1, 2, 5, 10].map((n) => `<button class="${k === n ? 'on' : ''}" data-scale-set="${n}">×${n}</button>`).join('')}</div>
        </div>

        <h3>Ингредиенты ${k > 1 ? `<small class="muted">· пересчитано на ×${k}</small>` : ''}</h3>
        <table class="ing">
          <thead><tr><th>Продукт</th><th>Кол-во</th><th>Ед.</th></tr></thead>
          <tbody>${t.ingredients.map((i) => {
            const [qv, qu] = Number(i[1]) ? showQty(i[1] * k, ingUnit(i)) : ['—', 'уточнить'];
            const pf = /^пф/i.test(String(i[0])) ? pfIndex.get(ttkKey(i[0])) : null;
            const name = pf && pf !== t.id
              ? `<button class="ing-link" data-go="ttk-view" data-id="${pf}">${esc(i[0])}${ic('chevR', 14)}</button>` : esc(i[0]);
            return `<tr><td>${name}</td><td>${qv}</td><td class="unit">${qu}</td></tr>`;
          }).join('')}</tbody>
        </table>

        <h3>Технология приготовления</h3>
        ${tech.length ? `<ol class="steps">${tech.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p class="muted">На карте не заполнена.</p>'}

        ${info.length ? `<div class="info-grid">${info.map(([h, v]) =>
          `<div class="info ${h === 'Аллергены' ? 'warn' : ''}"><h4>${h}</h4><p>${esc(v)}</p></div>`).join('')}</div>` : ''}

        ${can.editTtk() ? `<div class="row-btns">
          <button class="btn" data-go="ttk-edit" data-id="${t.id}">${ic('edit', 16)} Редактировать</button>
          <button class="btn btn-ghost danger" data-del-ttk="${t.id}">Удалить</button>
        </div>` : ''}
      </main>${nav()}`;
  }

  function viewTtkEdit() {
    const t = load(KEY.ttk, []).find((x) => x.id === state.params.id) || {
      id: '', kind: 'pf', category: TTK_CATEGORIES[1], station: '', name: '', yield: '', ingredients: [],
      tech: [], serve: '', storage: '', allergens: '', note: '',
    };
    const ingText = t.ingredients.map((i) => [i[0], String(i[1]).replace('.', ','), ingUnit(i)].join(' ; ')).join('\n');
    const cats = TTK_CATEGORIES.includes(t.category) || !t.category ? TTK_CATEGORIES : [...TTK_CATEGORIES, t.category];
    return `${header(t.id ? 'Редактирование ТТК' : 'Новая ТТК', t.id ? 'ttk-view' : 'ttk')}
      <main class="page">
        <form class="form" data-form="ttk" data-id="${t.id}">
          <label>Название<input name="name" required value="${esc(t.name)}" placeholder="ПФ Соус песто"/></label>
          <div class="form-row">
            <label>Тип
              <select name="kind">
                <option value="pf" ${t.kind !== 'dish' ? 'selected' : ''}>Полуфабрикат (на замес)</option>
                <option value="dish" ${t.kind === 'dish' ? 'selected' : ''}>Блюдо (на порцию)</option>
              </select>
            </label>
            <label>Категория
              <select name="category">${cats.map((c) => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
            </label>
            <label>Станция
              <select name="station"><option value="">Все станции</option>${STATIONS.map((s) => `<option value="${s.id}" ${s.id === t.station ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
            </label>
            <label>Выход<input name="yield" value="${esc(t.yield)}" placeholder="0,340 кг"/></label>
          </div>
          <label>Ингредиенты <small>— по строке: Продукт ; количество ; единица (кг, л, г, шт)</small>
            <textarea name="ingredients" rows="10" placeholder="Орех кедровый ; 0,060 ; кг">${esc(ingText)}</textarea></label>
          <label>Технология <small>— каждый шаг с новой строки</small>
            <textarea name="tech" rows="7">${esc((t.tech || []).join('\n'))}</textarea></label>
          <label>Хранение<textarea name="storage" rows="2" placeholder="+2…+4 °C, не более 72 часов">${esc(t.storage || '')}</textarea></label>
          <label>Подача<textarea name="serve" rows="2">${esc(t.serve || '')}</textarea></label>
          <label>Аллергены<input name="allergens" value="${esc(t.allergens && t.allergens !== '—' ? t.allergens : '')}"/></label>
          <label>Пометка «сверить» <small>— оставьте пустым, если карта проверена</small>
            <textarea name="note" rows="2">${esc(t.note || '')}</textarea></label>
          <button class="btn wide">Сохранить</button>
        </form>
      </main>${nav()}`;
  }

  function viewSafety() {
    const acks = load(KEY.acks, {})[state.user.id] || {};
    const all = load(KEY.safety, []);
    const mine = all.filter((s) => !s.stations.length || s.stations.includes(state.user.station) || can.allStations());
    const open = state.params.open;
    return `${header('Безопасность')}
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

  /* ---------- Советы для профессиональной кухни ---------- */
  // Порядок разделов: от продукта и техники к организации кухни
  const TIP_ORDER = ['meat', 'fish', 'heat', 'pasta', 'pizza', 'sauce', 'stock', 'cold', 'veg', 'pastry', 'taste', 'prep', 'safety', 'lead', 'cost'];
  const tipSections = () => [...TIPS].sort((a, b) => (TIP_ORDER.indexOf(a.id) + 99) % 99 - (TIP_ORDER.indexOf(b.id) + 99) % 99);
  // Совет меняется каждые 2 часа (12 в сутки), одинаково на всех устройствах.
  // Разделы чередуются по кругу, чтобы два совета подряд не были про одно и то же.
  const TIP_EVERY_H = 2;
  let tipFlat = null;
  function tipQueue() {
    if (tipFlat) return tipFlat;
    const secs = tipSections(); tipFlat = [];
    for (let i = 0; secs.some((c) => c.tips[i]); i++) for (const c of secs) if (c.tips[i]) tipFlat.push({ ...c.tips[i], cat: c });
    return tipFlat;
  }
  function tipSlot(now = Date.now()) {
    const localH = Math.floor((now - new Date(now).getTimezoneOffset() * 60000) / 3600000);
    return Math.floor(localH / TIP_EVERY_H);
  }
  function currentTip() {
    const q = tipQueue(), slot = tipSlot();
    if (state.tipSlot !== slot) { state.tipSlot = slot; state.tipExtra = 0; }
    return q[(slot + (state.tipExtra || 0)) % q.length];
  }
  // Если вкладка «Советы» открыта, когда наступает новое двухчасовое окно, совет меняется сам
  setInterval(() => { if (state.user && state.view === 'tips' && tipSlot() !== state.tipSlot && document.visibilityState === 'visible') render(); }, 30000);
  const nextTipAt = () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + TIP_EVERY_H - (d.getHours() % TIP_EVERY_H)); return d; };
  const tipCard = (t, withCat) => `
    <article class="card tip">
      ${withCat ? `<div class="eyebrow">${esc(t.cat.title)}</div>` : ''}
      <h3 class="tip-t">${esc(t.t)}</h3>
      <p class="tip-d">${esc(t.d)}</p>
      ${t.why ? `<p class="tip-why"><b>Почему:</b> ${esc(t.why)}</p>` : ''}
    </article>`;

  function viewTips() {
    const day = currentTip();
    return `${header('Советы')}
      <main class="page">
        <p class="lt-sub">${tipQueue().length} ${plural(tipQueue().length, ['приём', 'приёма', 'приёмов'])} профессиональной кухни</p>
        <section class="tip-day">
          <div class="tip-day-h">${ic('star', 16)} ${state.tipExtra ? 'Ещё совет' : 'Совет сейчас'} · ${esc(day.cat.title)}</div>
          <h3 class="tip-t">${esc(day.t)}</h3>
          <p class="tip-d">${esc(day.d)}</p>
          ${day.why ? `<p class="tip-why"><b>Почему:</b> ${esc(day.why)}</p>` : ''}
          <div class="tip-day-f">
            <span>Новый совет в ${fmtTime(nextTipAt())}</span>
            <button class="tip-next" data-tip-next>Ещё совет ${ic('chevR', 16)}</button>
          </div>
        </section>
        <h2 class="section-title">Разделы</h2>
        <div class="quick">
          ${tipSections().map((c) => `<button class="card quick-card" data-go="tips-cat" data-id="${c.id}">
            <span class="q-ic tone-${c.tone}">${ic(c.icon, 22)}</span>
            <span class="q-t"><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></span>
            <span class="count-muted">${c.tips.length}</span>${ic('chevR', 18)}</button>`).join('')}
        </div>
      </main>${nav()}`;
  }

  function viewTipsCat() {
    const c = TIPS.find((x) => x.id === state.params.id) || TIPS[0];
    return `${header(c.title, 'tips')}
      <main class="page">
        <div class="tips-head"><span class="st-icon tone-${c.tone}">${ic(c.icon, 24)}</span>
          <div><h2 class="dish">${esc(c.title)}</h2><p class="muted">${esc(c.sub)} · ${c.tips.length} ${plural(c.tips.length, ['совет', 'совета', 'советов'])}</p></div></div>
        <div class="tips">${c.tips.map((t) => tipCard(t)).join('')}</div>
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
    const date = state.params.date || workDay();
    const tab = state.params.tab || 'hours';

    const report = `
      <div class="date-row">
        <label>Дата отчёта <input type="date" id="report-date" value="${date}" max="${workDay()}"/></label>
      </div>
      <div class="report">
        ${STATIONS.map((s) => {
          const sp = stationProgress(s.id, date);
          return `<div class="card report-card">
            <div class="rc-head"><span class="rc-t"><span class="mini-tile ${tone(s.id)}">${ic(s.icon, 18)}</span> <b>${esc(s.name)}</b></span>${ring(sp.pct, 48)}</div>
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
            <div class="avatar lg ${tone(u.role === 'chef' ? 'chef' : u.station)}">${esc(initials(u.name))}</div>
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

    const tabs = [['hours', 'Табель'], ['report', 'Чек-листы'], ['staff', 'Люди']];
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

    // Приход и уход поваров отмечает руководитель: повара в приложение не входят
    const crew = staff.filter((u) => !u.disabled && u.id !== state.user.id);
    const attendance = `
      <h2 class="section-title">Приход и уход</h2>
      <div class="team-list attend">
        ${crew.map((u) => {
          const o = openShift(u.id);
          return `<div class="member attend-row">
            <span class="avatar lg ${tone(u.role === 'chef' ? 'chef' : u.station)}">${esc(initials(u.name))}</span>
            <span class="m-body"><b>${esc(u.name)}</b><small>${o
              ? `<span class="on-shift">на смене</span> · с ${fmtTime(o.start)} · <span data-since="${o.start}" data-fmt="short">${fmtClock(Date.now() - o.start, false)}</span>`
              : `${u.role === 'cook' ? esc(stationById(u.station).short) : ROLES[u.role].name}`}</small></span>
            ${o ? `<button class="btn btn-sm btn-out" data-clock="out" data-uid="${u.id}">Ушёл</button>`
                : `<button class="btn btn-sm" data-clock="in" data-uid="${u.id}">Пришёл</button>`}
          </div>`;
        }).join('') || '<p class="empty">Добавьте сотрудников во вкладке «Люди»</p>'}
      </div>
      <h2 class="section-title">Табель</h2>`;

    return `${attendance}
      <div class="card now-card">
        <div class="eyebrow">Сейчас на смене · ${onShift.length}</div>
        ${onShift.length ? `<ul class="now-list">${onShift.map((s) => `<li>
            <span class="dot-live"></span><b>${esc(nameOf(s.uid))}</b>
            <small>${esc(stationById(s.station).short)} · с ${fmtTime(s.start)} · <span data-since="${s.start}" data-fmt="short">${fmtClock(Date.now() - s.start, false)}</span></small>
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
          <details class="card ts-row" data-k="ts-${r.u.id}">
            <summary>
              <span class="avatar lg ${tone(r.u.role === 'chef' ? 'chef' : r.u.station)}">${esc(initials(r.u.name))}</span>
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
    const groups = [CHEF_GROUP, { ...stationById('pass'), name: 'Су-шефы' }];
    return `
      <p class="lead">В приложение входят только шеф-повар и су-шефы. После ввода кода нужно выбрать себя из списка.
        Повара не входят: их приход и уход отмечает руководитель во вкладке «Табель».</p>
      <div class="codes">
        ${groups.map((g) => `
          <form class="card code-row" data-form="code" data-group="${g.id}">
            <span class="st-icon ${tone(g.id)}">${ic(g.icon, 24)}</span>
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
    return `<details class="missing" data-k="miss-${station}"><summary>Не выполнено: ${out.length}</summary><ul>${out.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
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
    'ttk-edit': viewTtkEdit, safety: viewSafety, tips: viewTips, 'tips-cat': viewTipsCat, team: viewTeam, member: viewMember, profile: viewProfile,
    'shift-edit': viewShiftEdit, 'ttk-storage': viewTtkStorage,
  };

  // Перерисовка не чаще раза за кадр (несколько обновлений из базы подряд → одна перерисовка)
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  /* ---------- Точечное обновление экрана (как в нативных приложениях) ----------
     Новая разметка сравнивается с тем, что на экране, и меняются только
     отличающиеся элементы. Узлы, фокус, прокрутка, раскрытые блоки, нажатые
     кнопки и идущие анимации сохраняются — экран не мигает. */
  function morphChildren(from, to) {
    const a = [...from.childNodes], b = [...to.childNodes];
    for (let i = 0; i < b.length; i++) {
      const x = a[i], y = b[i];
      if (!x) { from.appendChild(y); continue; }
      const keyX = x.nodeType === 1 ? x.getAttribute('data-id') || x.getAttribute('data-k') || '' : '';
      const keyY = y.nodeType === 1 ? y.getAttribute('data-id') || y.getAttribute('data-k') || '' : '';
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || keyX !== keyY) { from.replaceChild(y, x); continue; }
      if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
      morphEl(x, y);
    }
    for (let i = b.length; i < a.length; i++) a[i].remove();
  }
  function morphEl(x, y) {
    for (const { name } of [...x.attributes]) {
      if (y.hasAttribute(name)) continue;
      if (name === 'open' && x.tagName === 'DETAILS') continue; // раскрытое пользователем не сворачиваем
      x.removeAttribute(name);
    }
    for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
    const focused = x === document.activeElement;
    if (x.tagName === 'INPUT' || x.tagName === 'SELECT') {
      if (!focused && x.value !== y.value) x.value = y.value;
      if (x.type === 'checkbox' || x.type === 'radio') x.checked = y.checked;
      if (x.tagName === 'INPUT') return;
    }
    if (x.tagName === 'TEXTAREA') { if (!focused && x.value !== y.value) x.value = y.value; return; }
    morphChildren(x, y);
  }

  // «Экран» — это раздел (и карточка/сотрудник/смена для экранов-подробностей); фильтры и вкладки — тот же экран
  const screenOf = (view, p = {}) => (['ttk-view', 'ttk-edit', 'member', 'shift-edit', 'tips-cat'].includes(view) ? view + ':' + (p.id || '')
    : view === 'ttk' && p.cat ? 'ttk:cat' : view); // плитки разделов ТТК и список раздела — разные экраны

  let lastScreen = null;
  let lastHtml = '';
  // Галочка «рисуется» и кружок пружинит — только в момент отметки, не при каждом открытии экрана
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function animateCheck(id) {
    if (reduceMotion.matches) return;
    const box = document.querySelector(`[data-check="${CSS.escape(id)}"] .box`);
    const path = box?.querySelector('path');
    if (!box?.animate || !path) return;
    box.animate([{ transform: 'scale(.78)' }, { transform: 'scale(1.16)', offset: .55 }, { transform: 'scale(1.06)' }],
      { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
    path.animate([{ strokeDasharray: 24, strokeDashoffset: 24 }, { strokeDasharray: 24, strokeDashoffset: 0 }],
      { duration: 300, delay: 40, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'backwards' });
  }

  function render() {
    const app = $('#app');
    if (!state.user) {
      const screen = 'login' + (state.group || '');
      renderMemo = new Map();
      let html;
      try { html = viewLogin(); } finally { renderMemo = null; }
      document.body.classList.add('is-login');
      if (screen === lastScreen) { if (html !== lastHtml) patch(app, html); }
      else { app.innerHTML = html; app.querySelector('.login-card')?.classList.add('enter'); }
      lastScreen = screen; lastHtml = html; return;
    }
    document.body.classList.remove('is-login');
    // защита маршрутов
    if ((state.view === 'team' && !can.report()) || (state.view === 'member' && !can.manageTeam())
      || (state.view === 'shift-edit' && !can.manageTeam())
      || (state.view === 'ttk-edit' && !can.editTtk())) state.view = 'home';

    const screen = screenOf(state.view, state.params);
    renderMemo = new Map();
    let html;
    try { html = (VIEWS[state.view] || viewHome)(); } finally { renderMemo = null; }
    html = html.replace(/<!--LT:([\s\S]*?)-->\s*<main class="page([^"]*)">/, (m, t, cls) => `<main class="page${cls}"><h1 class="large-title">${t}</h1>`);
    if (screen === lastScreen) {
      if (html !== lastHtml) patch(app, html);
    } else {
      app.innerHTML = html;
      const dir = state.navDir || 'tab';
      app.querySelector('main')?.classList.add('enter-' + dir);
      app.querySelectorAll('.chips .chip.on').forEach((c) => {
        const strip = c.parentElement;
        if (c.offsetLeft + c.offsetWidth > strip.clientWidth - 8) strip.scrollLeft = c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2;
      });
    }
    state.navDir = null;
    lastScreen = screen; lastHtml = html;
    updateScrollState();
  }
  // Крупный заголовок уезжает в шапку при прокрутке (как в iOS)
  let scrollTick = false;
  function updateScrollState() {
    const y = window.scrollY;
    document.body.classList.toggle('scrolled', y > 2);
    document.body.classList.toggle('title-in', y > 36);
  }
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => { scrollTick = false; updateScrollState(); });
  }, { passive: true });

  function patch(app, html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    morphChildren(app, t.content);
  }

  // Живой таймер смены
  // Тикает каждую секунду, ровно на границе секунды; меняется только текст таймеров, экран не перерисовывается
  function tickTimers() {
    const now = Date.now();
    document.querySelectorAll('[data-since]').forEach((el) => {
      const txt = fmtClock(now - Number(el.dataset.since), el.dataset.fmt !== 'short');
      if (el.textContent !== txt) el.textContent = txt;
    });
  }
  // Следующий тик — ровно когда у таймера сменится секунда (отсчёт от начала смены, без отставания)
  (function loop() {
    const el = document.querySelector('[data-since]');
    const delay = el ? 1000 - ((Date.now() - Number(el.dataset.since)) % 1000) + 5 : 1000;
    setTimeout(() => { if (document.visibilityState === 'visible') tickTimers(); loop(); }, delay);
  })();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tickTimers(); });

  /* ---------------- События ---------------- */
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-go]');
    if (!el) return;
    const d = el.dataset;

    if (d.key !== undefined) {
      if (d.key === '⌫') state.pin = state.pin.slice(0, -1);
      else if (state.pin.length < 4) state.pin += d.key;
      updatePinDots();
      if (state.pin.length === 4) setTimeout(tryLogin, 120);
      return;
    }
    if (el.hasAttribute('data-tip-next')) {
      state.tipExtra = (state.tipExtra || 0) + 1;
      if (navigator.vibrate) navigator.vibrate(8);
      render();
      const card = document.querySelector('.tip-day');
      if (card?.animate && !reduceMotion.matches) card.animate([{ opacity: 0.4, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
      return;
    }
    if (d.pick) { pickUser(d.pick); return; }
    if (el.hasAttribute('data-cancel-pick')) { state.group = null; render(); return; }
    if (d.clock) {
      const who = d.uid ? load(KEY.staff, []).find((u) => u.id === d.uid) : state.user;
      if (!who || (who.id !== state.user.id && !can.report())) return;
      if (d.clock === 'in') clockIn(who);
      else if (await ask(who.id === state.user.id ? 'Закончить смену сейчас?' : `Отметить уход: ${who.name}?`, who.id === state.user.id ? 'Закончить' : 'Отметить уход')) clockOut(who);
      else return;
      if (navigator.vibrate) navigator.vibrate(30);
      render(); return;
    }
    if (d.delShift) {
      if (!(await ask('Удалить эту смену?', 'Удалить', true))) return;
      save(KEY.shifts, allShifts().filter((x) => x.id !== d.delShift));
      toast('Смена удалена'); go('team', { tab: 'hours' }); return;
    }
    if (d.export) { exportCsv(...d.export.split('|')); return; }
    if (d.check) {
      toggleCheck(d.station, d.type, d.check);
      if (navigator.vibrate) navigator.vibrate(15);
      render();
      animateCheck(d.check);
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
      if (!it || !(await ask(`Удалить пункт «${it.text}»?`, 'Удалить', true))) return;
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
      if (!(await ask('Удалить эту ТТК?', 'Удалить', true))) return;
      save(KEY.ttk, load(KEY.ttk, []).filter((t) => t.id !== d.delTtk));
      toast('ТТК удалена'); go('ttk'); return;
    }
    if (d.delMember) {
      if (allShifts().some((x) => x.uid === d.delMember)) {
        await ask('У сотрудника есть смены в табеле. Если удалить его, эти часы пропадут из оплаты. Вместо удаления отметьте «Доступ отключён».', 'Понятно');
        return;
      }
      if (!(await ask('Удалить сотрудника?', 'Удалить', true))) return;
      save(KEY.staff, load(KEY.staff, []).filter((u) => u.id !== d.delMember));
      toast('Сотрудник удалён'); go('team', { tab: 'staff' }); return;
    }
    if (el.hasAttribute('data-logout')) { logout(); return; }
    if (d.back) { goBack(d.back); return; }

    if (d.go) {
      const p = {};
      for (const k of ['station', 'type', 'id', 'tab', 'open', 'edit', 'from', 'to', 'cat']) if (d[k] !== undefined) p[k] = d[k];
      if (d.go === 'ttk-view' && !p.id) p.id = state.params.id;
      // карта, открытая из поиска, помнит запрос — «Назад» вернёт к результатам
      if (d.go === 'ttk-view' && state.view === 'ttk' && state.params.q) p.q = state.params.q;
      if (d.go === 'ttk-view' && state.view === 'ttk-view' && state.params.q) p.q = state.params.q;
      if (d.go === 'checklists') {
        // С другого экрана — открываем ту станцию и тот чек-лист, что были открыты в последний раз (в течение 3 часов)
        const last = state.lastCl && Date.now() - state.lastCl.at < 3 * 3600e3 ? state.lastCl : null;
        if (!p.station) p.station = state.view === 'checklists' ? state.params.station : last?.station;
        if (!p.type && p.station === (state.view === 'checklists' ? state.params.station : last?.station)) p.type = state.view === 'checklists' ? state.params.type : last?.type;
      }
      if (d.go === 'team' && p.tab === 'hours' && !p.from && state.params.from) { p.from = state.params.from; p.to = state.params.to; }
      if (d.go === 'ttk' && state.view !== 'ttk' && p.station === undefined) { p.station = state.lastTtk?.station; p.cat = state.lastTtk?.cat; }
      if (d.go === 'ttk') state.lastTtk = { station: p.station, cat: p.cat };
      if (el.closest('.bottom-nav')) goTab(d.go, p); else go(d.go, p);
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
      // запоминаем запрос в истории: «Назад» из карты вернёт к результатам поиска
      try { history.replaceState({ bc: true, view: state.view, params: { ...state.params }, depth: navDepth }, ''); } catch { /* нет истории */ }
      if (state.user) save(KEY.session, { id: state.user.id, at: Date.now(), view: state.view, params: { ...state.params } });
      render();
    }
  });

  const isField = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !['checkbox', 'radio', 'date'].includes(el.type);
  document.addEventListener('focusin', (e) => { if (isField(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isField(document.activeElement)) {
        document.body.classList.remove('kb');
        if (pendingRender && !['ttk-edit', 'member', 'shift-edit'].includes(state.view)) { pendingRender = false; scheduleRender(); }
      }
    }, 50);
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

    if (type === 'copy-items') {
      const lists = load(KEY.lists, {});
      const target = lists[f.dataset.station][f.dataset.type];
      const have = new Set(target.map((i) => i.text.trim().toLowerCase()));
      const add = ((lists[fd.from] || {})[f.dataset.type] || []).filter((i) => !have.has(i.text.trim().toLowerCase()));
      add.forEach((i) => target.push({ id: uid(), text: i.text }));
      save(KEY.lists, lists);
      toast(add.length ? `Добавлено пунктов: ${add.length}` : 'Все эти пункты уже есть в списке');
      render(); return;
    }

    if (type === 'add-item') {
      const lists = load(KEY.lists, {});
      lists[f.dataset.station][f.dataset.type].push({ id: uid(), text: fd.text.trim() });
      save(KEY.lists, lists); render(); $('.add-row input')?.focus();
    }

    if (type === 'ttk') {
      const all = load(KEY.ttk, []);
      const num = (v) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
      const ingredients = fd.ingredients.split('\n').map((l) => l.split(';').map((x) => x.trim()))
        .filter((r) => r[0]).map((r) => [r[0], num(r[1]), r[2] || 'г']);
      const old = all.find((t) => t.id === f.dataset.id) || {};
      const rec = {
        ...old,
        id: f.dataset.id || 't' + uid(), name: fd.name.trim(), kind: fd.kind, category: fd.category, station: fd.station,
        yield: fd.yield.trim(), ingredients,
        tech: fd.tech.split('\n').map((x) => x.trim()).filter(Boolean),
        serve: fd.serve.trim(), storage: fd.storage.trim(), allergens: fd.allergens.trim(), note: fd.note.trim(),
      };
      delete rec.time;
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
  if ((typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG) || window.claude?.use) Sync.connecting();
  // Есть копия базы на устройстве — сразу возвращаем в приложение, не дожидаясь сети
  if (Sync.ready) { state.restored = true; restoreSession(); }
  render();
  init().then(() => { if (Sync.status === 'local') restoreSession(); render(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Проверяем обновления при возвращении в приложение
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    // Новая версия установлена: на экране входа обновляемся сразу, иначе предлагаем обновить
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (!state.user) { location.reload(); return; }
      if (document.querySelector('.update-bar')) return;
      const bar = document.createElement('button');
      bar.className = 'update-bar';
      bar.innerHTML = `${ic('download', 18)}<span>Доступна новая версия · <b>Обновить</b></span>`;
      bar.addEventListener('click', () => location.reload());
      document.body.appendChild(bar);
    });
  }
})();
