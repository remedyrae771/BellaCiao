/* ============================================================
   Bella Ciao — Kitchen App
   Одностраничное приложение без сервера: данные хранятся
   в localStorage устройства (планшет на кухне).
   ============================================================ */
(() => {
  'use strict';

  /* ---------------- Хранилище ---------------- */
  const KEY = {
    staff: 'bc_staff_v1',
    ttk: 'bc_ttk_v1',
    safety: 'bc_safety_v1',
    lists: 'bc_checklists_v1',
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
  const stationById = (id) => STATIONS.find((s) => s.id === id) || { name: id, short: id, icon: '•' };

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
    if (!load(KEY.staff)) {
      const staff = [];
      for (const s of DEFAULT_STAFF) {
        const { pin, ...rest } = s;
        staff.push({ ...rest, pinHash: await hashPin(pin), defaultPin: true });
      }
      save(KEY.staff, staff);
    }
    if (!load(KEY.ttk)) save(KEY.ttk, DEFAULT_TTK);
    if (!load(KEY.safety)) save(KEY.safety, DEFAULT_SAFETY);
    if (!load(KEY.lists)) {
      const lists = {};
      for (const st of STATIONS) {
        lists[st.id] = {};
        for (const t of CHECKLIST_TYPES) {
          lists[st.id][t.id] = [
            ...(COMMON_CHECKLISTS[t.id] || []),
            ...((STATION_CHECKLISTS[st.id] || {})[t.id] || []),
          ].map((text) => ({ id: uid(), text }));
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
    failed: 0,
    lockedUntil: 0,
  };

  const can = {
    allStations: () => ROLES[state.user.role].level >= 2,
    editTtk: () => ROLES[state.user.role].level >= 2,
    editLists: () => state.user.role === 'chef',
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
    state.user = null; state.pin = ''; state.view = 'home'; state.params = {};
    localStorage.removeItem(KEY.session);
    clearTimeout(idleTimer);
    render();
  }

  async function tryLogin() {
    if (Date.now() < state.lockedUntil) return;
    const pin = state.pin;
    const h = await hashPin(pin);
    const user = load(KEY.staff, []).find((u) => u.pinHash === h && !u.disabled);
    if (user) {
      state.user = user; state.pin = ''; state.failed = 0;
      state.view = 'home'; state.params = {};
      save(KEY.session, { id: user.id, at: Date.now() });
      resetIdle();
      render();
      if (user.defaultPin) toast('Вы вошли со стандартным кодом — смените его в профиле');
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
        ${back ? `<button class="icon-btn" data-go="${back}" aria-label="Назад">‹</button>` : `<div class="brand-mini" aria-label="Bella Ciao">BC</div>`}
        <h1>${title === 'Bella Ciao' ? '<span class="script">Bella Ciao</span>' : esc(title)}</h1>
        <button class="avatar" data-go="profile" title="${esc(state.user.name)}">${esc(initials(state.user.name))}</button>
      </header>
      <div class="ceramic-rule"></div>
    </div>`;

  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function nav() {
    const items = [
      ['home', '⌂', 'Главная'],
      ['checklists', '✓', 'Чек-листы'],
      ['ttk', '📖', 'ТТК'],
      ['safety', '⛑', 'ТБ'],
    ];
    if (can.report()) items.push(['team', '👥', 'Команда']);
    return `<nav class="bottom-nav">${items.map(([v, i, l]) =>
      `<button class="${state.view.startsWith(v) ? 'active' : ''}" data-go="${v}"><span class="ni">${i}</span><span>${l}</span></button>`
    ).join('')}</nav>`;
  }

  /* ================= ЭКРАНЫ ================= */

  function viewLogin() {
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
            <div class="logo-tag">CUCINA · ALMATY</div>
          </div>
          <p class="login-hint">${locked ? 'Слишком много попыток. Подождите 30 секунд.' : 'Введите ваш личный код'}</p>
          <div class="pin-dots">${dots}</div>
          <div class="keypad">
            ${keys.map((k) => k === ''
              ? '<span></span>'
              : `<button class="key${k === '⌫' ? ' key-del' : ''}" data-key="${k}" ${locked ? 'disabled' : ''}>${k}</button>`).join('')}
          </div>
          <p class="login-foot">Кухня · Чек-листы · ТТК · Техника безопасности</p>
        </div>
      </main>`;
  }

  function viewHome() {
    const u = state.user;
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
    const myStations = visibleStations();
    const acks = load(KEY.acks, {})[u.id] || {};
    const mySafety = load(KEY.safety, []).filter((s) => !s.stations.length || s.stations.includes(u.station) || can.allStations());
    const unread = mySafety.filter((s) => !acks[s.id]).length;

    return `${header('Bella Ciao')}
      <main class="page">
        <section class="hero">
          <div class="hero-greet">${greet},</div>
          <div class="hero-name">${esc(u.name)}</div>
          <div class="hero-meta">${ROLES[u.role].name} · ${esc(stationById(u.station).name)} · ${fmtDate(Date.now())}</div>
        </section>

        ${u.defaultPin ? `<div class="alert" data-go="profile">🔐 Вы используете стандартный код. <b>Смените его</b> — нажмите здесь.</div>` : ''}
        ${unread ? `<div class="alert alert-olive" data-go="safety">⛑ Не прочитано разделов ТБ: <b>${unread}</b>. Ознакомьтесь и подтвердите.</div>` : ''}

        <h2 class="section-title">Чек-листы на сегодня</h2>
        <div class="grid">
          ${myStations.map((s) => {
            const p = stationProgress(s.id);
            return `<button class="card station-card" data-go="checklists" data-station="${s.id}">
              <span class="st-icon">${s.icon}</span>
              <span class="st-body"><b>${esc(s.name)}</b><small>${p.n} из ${p.total} пунктов</small></span>
              ${ring(p.pct)}
            </button>`;
          }).join('')}
        </div>

        <h2 class="section-title">Быстрый доступ</h2>
        <div class="quick">
          <button class="card quick-card" data-go="ttk"><span>📖</span><b>ТТК</b><small>Технологические карты</small></button>
          <button class="card quick-card" data-go="safety"><span>⛑</span><b>Техника безопасности</b><small>Правила и инструкции</small></button>
          ${can.report() ? `<button class="card quick-card" data-go="team"><span>📊</span><b>Отчёт смены</b><small>Выполнение по станциям</small></button>` : ''}
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
          `<button class="chip ${s.id === st ? 'on' : ''}" data-go="checklists" data-station="${s.id}" data-type="${type}">${s.icon} ${esc(s.short)}</button>`).join('')}</div>` : ''}

        <div class="segmented">${CHECKLIST_TYPES.map((t) => {
          const tp = progress(st, t.id);
          return `<button class="${t.id === type ? 'on' : ''}" data-go="checklists" data-station="${st}" data-type="${t.id}">
            ${t.icon} ${t.name}<small>${tp.n}/${tp.total}</small></button>`;
        }).join('')}</div>

        <div class="list-head">
          <div>
            <div class="eyebrow">${esc(stationById(st).name)}</div>
            <h2>${CHECKLIST_TYPES.find((t) => t.id === type).name}</h2>
            <div class="bar"><span style="width:${p.pct}%"></span></div>
          </div>
          ${ring(p.pct, 64)}
        </div>

        <ul class="checklist">
          ${items.map((it) => {
            const d = done[it.id];
            return `<li class="${d ? 'done' : ''}">
              ${editing
                ? `<input class="edit-input" data-edit-item="${it.id}" value="${esc(it.text)}"/>
                   <button class="icon-btn danger" data-del-item="${it.id}" aria-label="Удалить">✕</button>`
                : `<button class="check-row" data-check="${it.id}" data-station="${st}" data-type="${type}">
                    <span class="box">${d ? '✓' : ''}</span>
                    <span class="txt">${esc(it.text)}${d ? `<small>${esc(d.by)} · ${fmtTime(d.at)}</small>` : ''}</span>
                  </button>`}
            </li>`;
          }).join('') || '<li class="empty">Пунктов пока нет</li>'}
        </ul>

        ${editing ? `
          <form class="add-row" data-form="add-item" data-station="${st}" data-type="${type}">
            <input name="text" placeholder="Новый пункт чек-листа" required/>
            <button class="btn">Добавить</button>
          </form>
          <button class="btn btn-ghost wide" data-go="checklists" data-station="${st}" data-type="${type}">Готово</button>`
          : `${p.pct === 100 && items.length ? '<div class="done-banner">Perfetto! Чек-лист выполнен</div>' : ''}
             ${can.editLists() ? `<button class="btn btn-ghost wide" data-go="checklists" data-station="${st}" data-type="${type}" data-edit="1">✎ Редактировать пункты</button>` : ''}`}
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
          ${STATIONS.map((s) => `<button class="chip ${s.id === st ? 'on' : ''}" data-go="ttk" data-station="${s.id}">${s.icon} ${esc(s.short)}</button>`).join('')}
        </div>
        <div class="ttk-list">
          ${list.map((t) => `
            <button class="card ttk-card" data-go="ttk-view" data-id="${t.id}">
              <span class="ttk-st">${stationById(t.station).icon}</span>
              <span class="ttk-body">
                <b>${esc(t.name)}</b>
                <small>${esc(stationById(t.station).short)} · выход ${t.yield ? t.yield + ' г' : '—'} · ${esc(t.time)}</small>
              </span>
              <span class="chev">›</span>
            </button>`).join('') || '<p class="empty">Ничего не найдено</p>'}
        </div>
        ${can.editTtk() ? `<button class="fab" data-go="ttk-edit" aria-label="Новая ТТК">＋</button>` : ''}
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
        <div class="eyebrow">${stationById(t.station).icon} ${esc(stationById(t.station).name)}</div>
        <h2 class="dish">${esc(t.name)}</h2>
        <div class="meta-row">
          <span>Выход: <b>${t.yield ? fmtNum(t.yield * k) + ' г' : '—'}</b></span>
          <span>Время: <b>${esc(t.time)}</b></span>
        </div>

        <div class="scaler">
          <span>Порций:</span>
          <button class="icon-btn" data-scale="-1">−</button>
          <b>${k}</b>
          <button class="icon-btn" data-scale="1">+</button>
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
          <button class="btn" data-go="ttk-edit" data-id="${t.id}">✎ Редактировать</button>
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
                <span class="acc-ic">${s.icon}</span>
                <span class="acc-t"><b>${esc(s.title)}</b><small>${esc(scope)}</small></span>
                <span class="pill ${a ? 'ok' : ''}">${a ? '✓ Ознакомлен' : 'Не прочитано'}</span>
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

  function viewTeam() {
    const staff = load(KEY.staff, []);
    const acks = load(KEY.acks, {});
    const safety = load(KEY.safety, []);
    const date = state.params.date || today();
    const tab = state.params.tab || 'report';

    const report = `
      <div class="date-row">
        <label>Дата отчёта <input type="date" id="report-date" value="${date}" max="${today()}"/></label>
      </div>
      <div class="report">
        ${STATIONS.map((s) => {
          const sp = stationProgress(s.id, date);
          return `<div class="card report-card">
            <div class="rc-head"><span>${s.icon} <b>${esc(s.name)}</b></span>${ring(sp.pct, 48)}</div>
            ${CHECKLIST_TYPES.map((t) => {
              const p = progress(s.id, t.id, date);
              return `<div class="rc-line"><span>${t.icon} ${t.name}</span>
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
              <small>${ROLES[u.role].name} · ${esc(stationById(u.station).name)}</small>
              <small>ТБ: ${ackN}/${relevant.length} ${u.defaultPin ? ' · <span class="warn-t">стандартный код</span>' : ''}${u.disabled ? ' · отключён' : ''}</small>
            </div>
            ${can.manageTeam() ? `<button class="icon-btn" data-go="member" data-id="${u.id}" aria-label="Изменить">✎</button>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${can.manageTeam() ? `<button class="fab" data-go="member" aria-label="Добавить сотрудника">＋</button>` : ''}`;

    return `${header('Команда')}
      <main class="page">
        <div class="segmented two">
          <button class="${tab === 'report' ? 'on' : ''}" data-go="team" data-tab="report">📊 Отчёт смены</button>
          <button class="${tab === 'staff' ? 'on' : ''}" data-go="team" data-tab="staff">👥 Сотрудники</button>
        </div>
        ${tab === 'report' ? report : team}
      </main>${nav()}`;
  }

  function missing(station, date) {
    const lists = load(KEY.lists, {})[station] || {};
    const out = [];
    for (const t of CHECKLIST_TYPES) {
      const done = getChecks(date, station, t.id);
      (lists[t.id] || []).forEach((i) => { if (!done[i.id]) out.push(`${t.icon} ${i.text}`); });
    }
    if (!out.length) return '<p class="ok-t">Всё выполнено ✓</p>';
    return `<details class="missing"><summary>Не выполнено: ${out.length}</summary><ul>${out.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
  }

  function viewMember() {
    const u = load(KEY.staff, []).find((x) => x.id === state.params.id) || { id: '', name: '', role: 'cook', station: 'cold' };
    return `${header(u.id ? 'Сотрудник' : 'Новый сотрудник', 'team')}
      <main class="page">
        <form class="form" data-form="member" data-id="${u.id}">
          <label>Имя и фамилия<input name="name" required value="${esc(u.name)}"/></label>
          <div class="form-row">
            <label>Должность
              <select name="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${r.name}</option>`).join('')}</select>
            </label>
            <label>Станция
              <select name="station">${STATIONS.map((s) => `<option value="${s.id}" ${s.id === u.station ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
            </label>
          </div>
          <label>${u.id ? 'Новый код (оставьте пустым, чтобы не менять)' : 'Личный код (4 цифры)'}
            <input name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" ${u.id ? '' : 'required'} autocomplete="off"/></label>
          ${u.id ? `<label class="check"><input type="checkbox" name="disabled" ${u.disabled ? 'checked' : ''}/> Доступ отключён (уволен / в отпуске)</label>` : ''}
          <button class="btn wide">Сохранить</button>
          ${u.id && u.id !== state.user.id ? `<button type="button" class="btn btn-ghost danger wide" data-del-member="${u.id}">Удалить сотрудника</button>` : ''}
        </form>
      </main>${nav()}`;
  }

  function viewProfile() {
    const u = state.user;
    return `${header('Профиль', 'home')}
      <main class="page">
        <div class="profile-card card">
          <div class="avatar xl">${esc(initials(u.name))}</div>
          <h2>${esc(u.name)}</h2>
          <p class="muted">${ROLES[u.role].name} · ${esc(stationById(u.station).name)}</p>
        </div>
        <h2 class="section-title">Сменить личный код</h2>
        <form class="form" data-form="pin">
          <label>Текущий код<input name="old" type="password" inputmode="numeric" maxlength="4" required autocomplete="off"/></label>
          <label>Новый код (4 цифры)<input name="new1" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off"/></label>
          <label>Повторите новый код<input name="new2" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off"/></label>
          <button class="btn wide">Сохранить код</button>
        </form>
        <button class="btn btn-dark wide" data-logout>Выйти</button>
      </main>${nav()}`;
  }

  /* ---------------- Рендер ---------------- */
  const VIEWS = {
    home: viewHome, checklists: viewChecklists, ttk: viewTtk, 'ttk-view': viewTtkDetail,
    'ttk-edit': viewTtkEdit, safety: viewSafety, team: viewTeam, member: viewMember, profile: viewProfile,
  };

  function render() {
    const app = $('#app');
    if (!state.user) { app.innerHTML = viewLogin(); document.body.className = 'is-login'; return; }
    document.body.className = '';
    // защита маршрутов
    if ((state.view === 'team' && !can.report()) || (state.view === 'member' && !can.manageTeam())
      || (state.view === 'ttk-edit' && !can.editTtk())) state.view = 'home';
    app.innerHTML = (VIEWS[state.view] || viewHome)();
  }

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
      toast('Подтверждено. Grazie!');
      state.params.open = ''; render(); return;
    }
    if (d.delItem) {
      const lists = load(KEY.lists, {});
      const { station, type } = state.params;
      lists[station][type] = lists[station][type].filter((i) => i.id !== d.delItem);
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
      for (const k of ['station', 'type', 'id', 'tab', 'open', 'edit']) if (d[k] !== undefined) p[k] = d[k];
      if (d.go === 'ttk-view' && !p.id) p.id = state.params.id;
      if (d.go === 'checklists') {
        if (!p.station) p.station = state.params.station;
        if (!p.type && p.station === state.params.station) p.type = state.params.type;
      }
      if (d.go === 'ttk' && p.station === undefined && state.view === 'ttk') p.station = state.params.station;
      go(d.go, p);
    }
  });

  // Сохранение текста пункта чек-листа при редактировании
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.editItem) {
      const lists = load(KEY.lists, {});
      const { station, type } = state.params;
      const it = lists[station][type].find((i) => i.id === t.dataset.editItem);
      if (it) { it.text = t.value.trim() || it.text; save(KEY.lists, lists); toast('Сохранено'); }
    }
    if (t.id === 'report-date') go('team', { tab: 'report', date: t.value });
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
      let pinHash;
      if (fd.pin) {
        if (!/^\d{4}$/.test(fd.pin)) return toast('Код — ровно 4 цифры');
        pinHash = await hashPin(fd.pin);
        if (staff.some((u) => u.pinHash === pinHash && u.id !== id)) return toast('Такой код уже занят — выберите другой');
      }
      if (id) {
        const u = staff.find((x) => x.id === id);
        Object.assign(u, { name: fd.name.trim(), role: fd.role, station: fd.station, disabled: !!fd.disabled });
        if (pinHash) { u.pinHash = pinHash; u.defaultPin = false; }
        if (u.id === state.user.id) state.user = u;
      } else {
        staff.push({ id: 'u' + uid(), name: fd.name.trim(), role: fd.role, station: fd.station, pinHash, defaultPin: false });
      }
      if (!staff.some((u) => u.role === 'chef' && !u.disabled)) return toast('Должен остаться хотя бы один активный шеф-повар');
      save(KEY.staff, staff); toast('Сохранено'); go('team', { tab: 'staff' });
    }

    if (type === 'pin') {
      const staff = load(KEY.staff, []);
      const u = staff.find((x) => x.id === state.user.id);
      if (await hashPin(fd.old) !== u.pinHash) return toast('Текущий код неверный');
      if (!/^\d{4}$/.test(fd.new1)) return toast('Код — ровно 4 цифры');
      if (fd.new1 !== fd.new2) return toast('Коды не совпадают');
      const h = await hashPin(fd.new1);
      if (staff.some((x) => x.pinHash === h && x.id !== u.id)) return toast('Такой код уже занят — выберите другой');
      u.pinHash = h; u.defaultPin = false;
      save(KEY.staff, staff); state.user = u;
      toast('Код изменён'); go('home');
    }
  });

  /* ---------------- Старт ---------------- */
  init().then(() => { restoreSession(); render(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
