/* ============================================================
   Настройки базы Firebase для отдельного адреса приложения.

   Пока здесь null, приложение на своём адресе хранит данные только
   на устройстве. Чтобы включить общую базу:
     1. console.firebase.google.com → «Создать проект».
     2. Build → Firestore Database → «Создать базу» (регион europe-west).
     3. Build → Authentication → «Начать» → Sign-in method → Anonymous → включить.
     4. Настройки проекта (шестерёнка) → «Ваши приложения» → значок </> (Web) →
        зарегистрировать → скопировать объект firebaseConfig сюда.
     5. Firestore → вкладка «Правила» → вставить содержимое firestore.rules → «Опубликовать».

   Эти ключи не секретные: они всегда видны в коде веб-приложения,
   доступ к данным ограничивают правила Firestore.
   ============================================================ */
const FIREBASE_CONFIG = null;
/* Пример:
const FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: 'bella-ciao-kitchen.firebaseapp.com',
  projectId: 'bella-ciao-kitchen',
  storageBucket: 'bella-ciao-kitchen.appspot.com',
  messagingSenderId: '...',
  appId: '...',
};
*/
