/* ============================================================
   Подключение к Firebase Firestore.
   Даёт тот же интерфейс базы, что использует js/sync.js
   (doc / collection / where / onSnapshot / get / set / update).
   ============================================================ */
const FirebaseDB = (() => {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Не загрузился ' + src));
    document.head.appendChild(s);
  });

  const wrapDoc = (snap) => ({
    id: snap.id,
    exists: snap.exists,
    data: () => snap.data(),
    metadata: { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites },
  });
  const toErr = (e) => ({ code: e && e.code === 'permission-denied' ? 'invalid_argument' : 'unavailable', message: String(e && e.message) });

  function wrap(fs) {
    const docRef = (path) => {
      const ref = fs.doc(path);
      return {
        path, id: ref.id,
        get: async () => wrapDoc(await ref.get()),
        set: (b) => ref.set(b).catch((e) => { throw toErr(e); }),
        // Слияние вложенных полей (items.<id>) — как update в общей базе claude.ai, но без требования, чтобы документ уже был
        update: (b) => ref.set(b, { merge: true }).catch((e) => { throw toErr(e); }),
        delete: () => ref.delete(),
        onSnapshot: (next, err) => ref.onSnapshot({ includeMetadataChanges: true }, (s) => next(wrapDoc(s)), (e) => err && err(toErr(e))),
      };
    };
    const query = (q) => ({
      where: (f, op, v) => query(q.where(f, op, v)),
      onSnapshot: (next, err) => q.onSnapshot((qs) => next({
        docs: qs.docs.map(wrapDoc), size: qs.size, empty: qs.empty, metadata: qs.metadata,
      }), (e) => err && err(toErr(e))),
    });
    return { doc: docRef, collection: (path) => query(fs.collection(path)) };
  }

  async function connect(config) {
    for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) await loadScript(SDK + f);
    const app = window.firebase.initializeApp(config);
    const fs = app.firestore();
    // Работа без интернета: изменения сохранятся и уйдут, когда связь вернётся
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch { /* приватный режим или другая вкладка */ }
    await app.auth().signInAnonymously();
    return wrap(fs);
  }

  return { connect };
})();
