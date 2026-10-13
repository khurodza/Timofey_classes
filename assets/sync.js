/* ============================================================
   Live sync — sends the student's answers to Firebase so the
   teacher can watch them (teacher.html), and brings answers
   from one device to another.

   Load it on every lesson page BEFORE the page's own scripts:
     <script src="../assets/sync.js"></script>

   It does not change any exercise code. Every page already saves
   its answers into one localStorage key (IS_ANSWERS below says
   which); this script copies those saves to Firebase. The same
   file runs on all four students' sites — only the settings
   block differs.

   Two modes:
   • normal  — the student works; answers are uploaded ~0.5 s
               after each change, and the student's "presence"
               (which page and tab is open) is shown to the teacher.
   • watch   — the page is opened inside teacher.html with
               ?watch=<student>; it shows that student's answers
               read-only and never touches the teacher's own saves.
   ============================================================ */
(function () {
  const PAGE = location.pathname.split('/').pop().replace('.html', '') || 'index';
  /* ---- settings: only this block differs between the students' sites ---- */
  const STUDENT = 'timofey';
  const IS_ANSWERS = k => k === 'answers-' + PAGE;     // which localStorage key holds this page's answers
  const NAME_KEY = 'studentName';                       // where the site keeps the student's name
  /* ---- the same on every site ---- */
  const FIREBASE = {
    apiKey: 'AIzaSyAHX47UEkMuLtZS4LrxIKiFQtThG4beysQ',
    authDomain: 'english-classes-37405.firebaseapp.com',
    databaseURL: 'https://english-classes-37405-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'english-classes-37405',
    appId: '1:229340805566:web:df26380fbf8de9f152a1ef'
  };
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

  const params = new URLSearchParams(location.search);
  const WATCH = params.get('watch');                    // student id when opened by teacher.html
  const store = window.localStorage;
  const rawGet = Storage.prototype.getItem, rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const get = k => { try { return rawGet.call(store, k); } catch (e) { return null; } };
  const set = (k, v) => { try { rawSet.call(store, k, v); } catch (e) {} };

  /* ================= WATCH MODE (teacher) ================= */
  if (WATCH) {
    // answers come from teacher.html through sessionStorage (shared by the page and its iframe)
    const name = params.get('name') || WATCH;
    Storage.prototype.getItem = function (k) {
      if (this === store && IS_ANSWERS(k)) return sessionStorage.getItem('watch-' + WATCH + '-' + k);
      if (this === store && k === NAME_KEY) return name;
      if (this === store && k === 'studentNameEntered') return '1';
      return rawGet.call(this, k);
    };
    Storage.prototype.setItem = function (k, v) {
      if (this === store && (IS_ANSWERS(k) || k.startsWith('part-') || k === NAME_KEY || k === 'studentNameEntered')) return;   // read-only: keep the teacher's own saves clean
      return rawSet.call(this, k, v);
    };
    Storage.prototype.removeItem = function (k) { if (this === store && IS_ANSWERS(k)) return; return rawRemove.call(this, k); };
    // no pop-ups in the teacher's view; "Are you sure you want to clear…?" is always answered "no"
    window.alert = () => {}; window.confirm = () => false; window.prompt = () => null;
    // "Show right / wrong": use the page's own checking — checkAll() where the site has it,
    // otherwise press every visible Check / ✓ / "Show my score" button (never Clear, Reset or Send)
    function showRightWrong() {
      if (typeof checkAll === 'function') { checkAll(); return; }
      document.querySelectorAll('button').forEach(b => {
        const t = b.textContent.trim();
        if (b.offsetParent === null || b.closest('.watch-bar')) return;
        if (/^check\b/i.test(t) || t === '✓' || /^show my score/i.test(t)) { try { b.click(); } catch (e) {} }
      });
      window.scrollTo(0, 0);
    }
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.classList.add('watching');
      const css = document.createElement('style');
      css.textContent = '.watch-bar{position:sticky;top:0;z-index:9999;padding:8px 16px;background:#12A374;color:#fff;font:700 15px/1.3 system-ui,sans-serif;text-align:center}' +
        'html.watching .rec,html.watching .dict-fab{display:none}';
      document.head.appendChild(css);
      const bar = document.createElement('div');
      bar.className = 'watch-bar';
      bar.textContent = '👀 Watching ' + name + ' — read-only';
      document.body.prepend(bar);
      if (params.get('check') === '1') setTimeout(showRightWrong, 300);
    });
    return;
  }

  /* ================= NORMAL MODE (student) ================= */
  // remember when this device last changed the answers, so two devices don't overwrite each other
  let KEY = null;
  const metaKey = () => 'sync-at-' + KEY;
  Storage.prototype.setItem = function (k, v) {
    const r = rawSet.call(this, k, v);
    if (this === store && IS_ANSWERS(k)) { KEY = k; set(metaKey(), String(Date.now())); queueUpload(); }
    return r;
  };
  Storage.prototype.removeItem = function (k) {             // "clear my answers" buttons
    const r = rawRemove.call(this, k);
    if (this === store && IS_ANSWERS(k)) { KEY = k; set(metaKey(), String(Date.now())); queueUpload(); }
    return r;
  };
  let fb = null, timer = null;
  function queueUpload() { clearTimeout(timer); timer = setTimeout(upload, 500); }
  function upload() {
    if (!fb) return;                                    // not connected yet: start() uploads later
    if (!KEY) return;
    const json = get(KEY) || '{}';
    const at = +get(metaKey()) || Date.now();
    fb.db.set(fb.db.ref(fb.d, `students/${STUDENT}/pages/${PAGE}`),
      { json, key: KEY, at, path: location.pathname, title: document.title, dev: fb.uid }).catch(() => {});
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

  // before the first save on this device: find this page's answers key among the saved ones
  function guessKey() {
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (IS_ANSWERS(k) && k.includes(PAGE)) return k; }
    return null;
  }

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
    const remote = snap.val();
    KEY = KEY || (remote && remote.key) || guessKey();
    const localAt = +get(metaKey()) || 0, local = KEY ? get(KEY) : null;
    if (KEY && remote && remote.at > localAt && remote.json !== local) {
      set(KEY, remote.json); set(metaKey(), String(remote.at));
      if (!sessionStorage.getItem('sync-reloaded-' + PAGE)) {
        sessionStorage.setItem('sync-reloaded-' + PAGE, '1');
        location.reload();
        return;
      }
    } else if (KEY && local && (!remote || localAt > remote.at)) {
      upload();                                                  // changes made offline, or before syncing existed
    }
    sessionStorage.removeItem('sync-reloaded-' + PAGE);

    const pres = db.ref(d, `students/${STUDENT}/presence`);
    db.onDisconnect(pres).update({ online: false, at: db.serverTimestamp() });
    presence(document.visibilityState === 'visible');
  }
  start().catch(e => console.warn('sync off:', e && e.message));
})();
