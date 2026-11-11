/* ============================================================
   Bella Ciao — общая база (синхронизация между устройствами)

   Когда приложение открыто как опубликованная страница claude.ai,
   данные кухни хранятся в общей базе страницы и сразу видны на всех
   устройствах. Иначе (локальный файл, свой хостинг) — работает
   по-старому, только на этом устройстве.

   Раскладка в базе:
     config/staff   {items: [...]}          сотрудники
     config/codes   {codes: {...}}          коды станций (хэши)
     config/lists   {lists: {...}}          пункты чек-листов
     config/ttk     {items: [...]}          ТТК
     config/safety  {items: [...]}          техника безопасности
     shifts/<uid>_<ГГГГ-ММ>  {uid, month, items: {id: смена | null}}
     checks/<дата>_<станция>_<тип>  {date, station, type, items: {пункт: отметка | null}}
     acks/<uid>     {items: {раздел ТБ: время}}
   Смены и отметки пишутся слиянием по одной записи, поэтому
   одновременные действия разных поваров не затирают друг друга.
   ============================================================ */
const Sync = (() => {
  'use strict';

  const SHARED = {
    bc_staff_v2: 'staff', bc_codes_v1: 'codes', bc_checklists_v2: 'lists', bc_ttk_v1: 'ttk',
    bc_safety_v1: 'safety', bc_shifts_v1: 'shifts', bc_checks_v1: 'checks', bc_acks_v1: 'acks',
  };
  const CONFIG = { staff: 'items', codes: 'codes', lists: 'lists', ttk: 'items', safety: 'items' };
  const CHECK_DAYS = 60;

  let db = null;
  let status = 'local'; // local | loading | online | offline
  const cache = {};
  const loaded = {};
  let defaults = {};
  let onChange = () => {};
  let onError = () => {};
  const queues = {};

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const handles = (k) => !!db && k in SHARED;

  /* ---------- запись: по одной операции на документ ---------- */
  function enqueue(path, fn) {
    const prev = queues[path] || Promise.resolve();
    const next = prev.then(fn).catch((e) => onError(e));
    queues[path] = next;
    return next;
  }

  // Слияние в документ; если документа ещё нет — создаём его
  function merge(path, body) {
    return enqueue(path, async () => {
      const ref = db.doc(path);
      try { await ref.update(body); }
      catch (e) {
        if (e && e.code === 'invalid_argument') {
          const snap = await ref.get();
          if (snap.exists) throw e; // документ есть, значит запись запрещена
          await ref.set(body);
        } else throw e;
      }
    });
  }

  const monthOf = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const shiftDoc = (s) => `shifts/${s.uid}_${monthOf(s.start)}`;
  const checkDoc = (key) => 'checks/' + key.split('|').join('_');

  function write(name, oldV, newV) {
    if (name in CONFIG) {
      return enqueue('config/' + name, () => db.doc('config/' + name).set({ [CONFIG[name]]: newV, updatedAt: Date.now() }));
    }
    if (name === 'shifts') {
      const o = new Map((oldV || []).map((s) => [s.id, s]));
      const n = new Map((newV || []).map((s) => [s.id, s]));
      for (const id of new Set([...o.keys(), ...n.keys()])) {
        const a = o.get(id), b = n.get(id);
        if (same(a, b)) continue;
        if (a && (!b || shiftDoc(a) !== shiftDoc(b))) merge(shiftDoc(a), { items: { [id]: null } });
        if (b) merge(shiftDoc(b), { uid: b.uid, month: monthOf(b.start), items: { [id]: b } });
      }
      return;
    }
    if (name === 'checks') {
      const o = oldV || {}, n = newV || {};
      for (const key of new Set([...Object.keys(o), ...Object.keys(n)])) {
        if (same(o[key], n[key])) continue;
        if (!n[key]) continue; // старые дни удаляет только очистка, не обычная работа
        const [date, station, type] = key.split('|');
        const items = {};
        for (const id of new Set([...Object.keys(o[key] || {}), ...Object.keys(n[key])])) {
          if (!same((o[key] || {})[id], n[key][id])) items[id] = n[key][id] || null;
        }
        merge(checkDoc(key), { date, station, type, items });
      }
      return;
    }
    if (name === 'acks') {
      const o = oldV || {}, n = newV || {};
      for (const uid of Object.keys(n)) {
        const items = {};
        for (const [sid, ts] of Object.entries(n[uid] || {})) if ((o[uid] || {})[sid] !== ts) items[sid] = ts;
        if (Object.keys(items).length) merge('acks/' + uid, { items });
      }
    }
  }

  /* ---------- чтение: подписки ---------- */
  const live = (items) => Object.fromEntries(Object.entries(items || {}).filter(([, v]) => v));

  function subscribe() {
    const fail = (e) => { if (e && e.code !== 'unavailable') onError(e); };

    for (const name of Object.keys(CONFIG)) {
      db.doc('config/' + name).onSnapshot((snap) => {
        if (snap.exists) cache[name] = clone(snap.data()[CONFIG[name]]);
        else if (!snap.metadata.fromCache && cache[name] === undefined) cache[name] = clone(defaults[name]);
        else if (snap.metadata.fromCache) return;
        loaded[name] = true;
        if (Object.keys(CONFIG).every((k) => loaded[k])) status = 'online';
        onChange(name);
      }, fail);
    }

    db.collection('shifts').onSnapshot((qs) => {
      cache.shifts = qs.docs.flatMap((d) => Object.values(live(d.data().items)));
      onChange('shifts');
    }, fail);

    const cutoff = new Date(Date.now() - CHECK_DAYS * 864e5).toISOString().slice(0, 10);
    db.collection('checks').where('date', '>=', cutoff).onSnapshot((qs) => {
      const out = {};
      for (const d of qs.docs) {
        const b = d.data();
        out[`${b.date}|${b.station}|${b.type}`] = live(b.items);
      }
      cache.checks = out;
      onChange('checks');
    }, fail);

    db.collection('acks').onSnapshot((qs) => {
      cache.acks = Object.fromEntries(qs.docs.map((d) => [d.id, live(d.data().items)]));
      onChange('acks');
    }, fail);

    setTimeout(() => { if (status === 'loading') { status = 'offline'; onChange('status'); } }, 10000);
  }

  return {
    handles,
    get status() { return status; },
    get(k) { return clone(cache[SHARED[k]]); },
    set(k, v) {
      const name = SHARED[k];
      const old = cache[name];
      cache[name] = clone(v);
      write(name, old, cache[name]);
    },
    // Пока страница выясняет, есть ли общая база, вход ждёт
    connecting() { if (status === 'local') status = 'loading'; },
    noDatabase() { if (!db) status = 'local'; },
    start(database, opts) {
      db = database;
      defaults = opts.defaults || {};
      onChange = opts.onChange || onChange;
      onError = opts.onError || onError;
      cache.shifts = []; cache.checks = {}; cache.acks = {};
      status = 'loading';
      subscribe();
    },
  };
})();
