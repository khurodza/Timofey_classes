/* ============================================================
   Live sync — sends the student's answers to Firebase so the
   teacher can watch them (teacher.html), and brings answers
   from one device to another.

   Load it on every lesson page BEFORE lessons.js:
     <script src="../assets/sync.js"></script>

   It does not change any exercise code. Every exercise already
   saves into localStorage under "answers-<page>"; this script
   copies those saves to Firebase.

   Two modes:
   • normal  — the student works; answers are uploaded ~0.5 s
               after each change, and the student's "presence"
               (which page and tab is open) is shown to the teacher.
   • watch   — the page is opened inside teacher.html with
               ?watch=<student>; it shows that student's answers
               read-only and never touches the teacher's own saves.
   ============================================================ */
(function () {
  /* ---- settings (the same on every student's site, except STUDENT) ---- */
  const STUDENT = 'timofey';
  const FIREBASE = {
    apiKey: 'AIzaSyAHX47UEkMuLtZS4LrxIKiFQtThG4beysQ',
    authDomain: 'english-classes-37405.firebaseapp.com',
    databaseURL: 'https://english-classes-37405-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'english-classes-37405',
    appId: '1:229340805566:web:df26380fbf8de9f152a1ef'
  };
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

  const PAGE = location.pathname.split('/').pop().replace('.html', '') || 'index';
  const KEY = 'answers-' + PAGE;                       // the same key lessons.js uses
  const params = new URLSearchParams(location.search);
  const WATCH = params.get('watch');                    // student id when opened by teacher.html
  const store = window.localStorage;
  const rawGet = Storage.prototype.getItem, rawSet = Storage.prototype.setItem;
  const get = k => { try { return rawGet.call(store, k); } catch (e) { return null; } };
  const set = (k, v) => { try { rawSet.call(store, k, v); } catch (e) {} };

  /* ================= WATCH MODE (teacher) ================= */
  if (WATCH) {
    // answers come from teacher.html through sessionStorage (shared by the page and its iframe)
    const watched = k => k.startsWith('answers-') || k.startsWith('part-answers-');
    Storage.prototype.getItem = function (k) {
      if (this === store && watched(k)) return sessionStorage.getItem('watch-' + WATCH + '-' + k);
      if (this === store && k === 'studentNameEntered') return '1';
      if (this === store && k === 'studentName') return params.get('name') || WATCH;
      return rawGet.call(this, k);
    };
    Storage.prototype.setItem = function (k, v) {
      if (this === store && (watched(k) || k.startsWith('studentName'))) return;   // read-only: keep the teacher's own saves clean
      return rawSet.call(this, k, v);
    };
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.classList.add('watching');
      const bar = document.createElement('div');
      bar.className = 'watch-bar';
      bar.textContent = '👀 Watching ' + (params.get('name') || WATCH) + ' — read-only';
      document.body.prepend(bar);
      if (params.get('check') === '1' && typeof checkAll === 'function') setTimeout(() => { checkAll(); }, 0);
    });
    return;
  }

  /* ================= NORMAL MODE (student) ================= */
  // remember when this device last changed the answers, so two devices don't overwrite each other
  const metaKey = 'sync-at-' + KEY;
  Storage.prototype.setItem = function (k, v) {
    const r = rawSet.call(this, k, v);
    if (this === store && k === KEY) { set(metaKey, String(Date.now())); queueUpload(); }
    return r;
  };

  let fb = null, timer = null;
  function queueUpload() { clearTimeout(timer); timer = setTimeout(upload, 500); }
  function upload() {
    if (!fb) return;                                    // not connected yet: start() uploads later
    const json = get(KEY);
    if (json == null) return;
    const at = +get(metaKey) || Date.now();
    fb.db.set(fb.db.ref(fb.d, `students/${STUDENT}/pages/${PAGE}`),
      { json, at, path: location.pathname, title: document.title, dev: fb.uid }).catch(() => {});
  }

  let part = '';
  function presence(online) {
    if (!fb) return;
    fb.db.set(fb.db.ref(fb.d, `students/${STUDENT}/presence`),
      { page: PAGE, path: location.pathname, title: document.title, part, online, at: Date.now() }).catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.showPart === 'function') {        // tell the teacher which tab is open
      const orig = window.showPart;
      window.showPart = function (id) { orig(id); part = id; presence(true); };
      const open = document.querySelector('.lesson-part.active');
      if (open) part = open.id;
    }
  });
  document.addEventListener('visibilitychange', () => presence(document.visibilityState === 'visible'));

  async function start() {
    const [app, auth, db] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-database.js')]);
    const a = app.initializeApp(FIREBASE);
    const au = auth.getAuth(a);
    await au.authStateReady();
    if (au.currentUser && !au.currentUser.isAnonymous) return;   // the teacher is signed in here: don't sync her test answers
    if (!au.currentUser) await auth.signInAnonymously(au);
    const d = db.getDatabase(a), uid = au.currentUser.uid;
    fb = { db, d, uid };

    await db.set(db.ref(d, `devices/${uid}`), STUDENT);           // this device belongs to this student

    // answers saved on another device and newer than this one → use them
    const snap = await db.get(db.ref(d, `students/${STUDENT}/pages/${PAGE}`));
    const remote = snap.val(), localAt = +get(metaKey) || 0, local = get(KEY);
    if (remote && remote.at > localAt && remote.json !== local) {
      set(KEY, remote.json); set(metaKey, String(remote.at));
      if (!sessionStorage.getItem('sync-reloaded-' + PAGE)) {
        sessionStorage.setItem('sync-reloaded-' + PAGE, '1');
        location.reload();
        return;
      }
    } else if (local && localAt > (remote ? remote.at : 0)) {
      upload();                                                  // changes made offline
    }
    sessionStorage.removeItem('sync-reloaded-' + PAGE);

    const pres = db.ref(d, `students/${STUDENT}/presence`);
    db.onDisconnect(pres).update({ online: false, at: db.serverTimestamp() });
    presence(document.visibilityState === 'visible');
  }
  start().catch(e => console.warn('sync off:', e && e.message));
})();
