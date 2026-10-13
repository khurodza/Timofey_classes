/* ============================================================
   Live sync — sends the student's answers to Firebase so the
   teacher can watch them (teacher.html), brings answers from one
   device to another, and shows the teacher's marks and comments.

   Load it on every lesson page BEFORE the page's own scripts:
     <script src="../assets/sync.js"></script>

   It does not change any exercise code. Every page already saves
   its answers into one localStorage key (IS_ANSWERS below says
   which); this script copies those saves to Firebase. The same
   file runs on all four students' sites — only the settings
   block differs.

   Two modes:
   • normal — the student works. Answers are uploaded ~0.5 s after
     each change, with a progress count and the fields that changed.
     Teacher marks (✓ / ✗) and comments appear next to the answers,
     and a reset by the teacher reaches the open page straight away.
   • watch  — the page is opened inside teacher.html with
     ?watch=<student>. It shows that student's answers read-only,
     never touches the teacher's own saves, and lets the teacher
     mark, comment on and reset answers (through window.__watch).
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

  /* ================= shared helpers ================= */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cssId = s => (window.CSS && CSS.escape ? CSS.escape(s) : s);

  // compare answers the way the sites do: case, punctuation, curly quotes and short/long forms don't matter
  function norm(str) {
    let t = String(str).toLowerCase().replace(/[’‘`]/g, "'").replace(/é/g, 'e');
    t = t.replace(/can't/g, 'cannot').replace(/won't/g, 'will not').replace(/n't/g, ' not')
      .replace(/'m\b/g, ' am').replace(/'re\b/g, ' are').replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will');
    return t.replace(/[.,!?;:"“”()…]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function matches(val, answer, contains) {
    const v = norm(val); if (!v) return false;
    const list = String(answer).split('|').map(norm);
    return contains ? list.some(a => a && v.includes(a)) : list.includes(v);
  }

  // which saved answer an element belongs to (the same name the page saves it under)
  function anchorOf(el) {
    const radio = el.matches('input[type=radio]') ? el : el.querySelector && el.querySelector('input[type=radio]');
    const group = el.closest('.mc-options, .choice-group, .word-choice, .match-grid, [id^="ex-match"]');
    if (group && group.classList.contains('mc-options') && radio) return 'mc-' + radio.name;
    if (group && group.id) return group.id;
    if (el.id) return el.id;
    if (el.dataset && el.dataset.key) return el.dataset.key;
    const withId = el.closest('[id]');
    return withId ? withId.id : null;
  }
  function findAnchor(a) {
    if (!a) return null;
    let el = document.getElementById(a) || document.querySelector('[data-key="' + cssId(a) + '"]');
    if (!el && a.startsWith('mc-')) { const r = document.querySelector('input[name="' + cssId(a.slice(3)) + '"]'); el = r && r.closest('.mc-options'); }
    if (!el && /^match[-_]/.test(a)) el = document.getElementById(a.slice(6)) || document.querySelector('[data-match-id="' + cssId(a.slice(6)) + '"]');
    return el;
  }
  // the element a mark / comment / highlight is drawn on
  const visual = el => (el && el.matches('input[type=radio]') ? el.closest('.mc-options') : el);

  // progress: how many questions with a right answer the page has, how many are answered and right
  function stats() {
    let total = 0, answered = 0, right = 0;
    const count = (done, ok) => { total++; if (done) answered++; if (ok) right++; };
    document.querySelectorAll('input[data-answer]:not(.xw-blank), textarea[data-answer], select[data-answer]').forEach(el =>
      count(!!el.value.trim(), matches(el.value, el.dataset.answer, el.dataset.check === 'contains')));
    document.querySelectorAll('.mc-options[data-correct]').forEach(g => { const c = g.querySelector('input:checked') || g.querySelector('.mc-option.selected input'); count(!!c, c && c.value === g.dataset.correct); });
    document.querySelectorAll('.choice-group[data-correct]').forEach(g => { const c = g.querySelector('.choice-btn.selected'); count(!!c, c && c.dataset.value === g.dataset.correct); });
    document.querySelectorAll('.word-choice[data-answer]').forEach(g => { const c = g.querySelector('.selected'); count(!!c, c && c.textContent.trim().toLowerCase() === g.dataset.answer.toLowerCase()); });
    return { total, answered, right };
  }

  // teacher marks and comments, drawn next to the answers (student page and teacher view)
  const NOTE_CSS =
    '.sync-note{display:block;margin:6px 0 4px;padding:8px 12px;border-radius:12px;background:#FFF6DB;border:1px solid #F2D58A;color:#4A3B12;font:600 14px/1.4 system-ui,sans-serif;max-width:560px;text-align:left}' +
    '.sync-note b{color:#8A6510}' +
    '.sync-right{outline:3px solid #2E9E6B!important;outline-offset:2px;border-radius:8px}' +
    '.sync-wrong{outline:3px solid #D9534F!important;outline-offset:2px;border-radius:8px}' +
    '.sync-badge{display:inline-grid;place-items:center;width:22px;height:22px;margin-left:6px;border-radius:50%;color:#fff;font:800 13px/1 system-ui;vertical-align:middle}' +
    '.sync-badge.r{background:#2E9E6B}.sync-badge.w{background:#D9534F}';
  function addCss(text) { const s = document.createElement('style'); s.textContent = text; document.head.appendChild(s); }
  function drawNotes(notes) {
    document.querySelectorAll('.sync-note, .sync-badge').forEach(n => n.remove());
    document.querySelectorAll('.sync-right, .sync-wrong').forEach(n => n.classList.remove('sync-right', 'sync-wrong'));
    Object.values(notes || {}).forEach(n => {
      const el = visual(findAnchor(n.anchor));
      if (!el) return;
      let after = el;
      if (n.mark === 'right' || n.mark === 'wrong') {
        el.classList.add(n.mark === 'right' ? 'sync-right' : 'sync-wrong');
        const b = document.createElement('span');
        b.className = 'sync-badge ' + (n.mark === 'right' ? 'r' : 'w'); b.textContent = n.mark === 'right' ? '✓' : '✗';
        el.insertAdjacentElement('afterend', b); after = b;
      }
      if (n.comment) {
        const c = document.createElement('span');
        c.className = 'sync-note'; c.innerHTML = '<b>💬 Teacher:</b> ' + esc(n.comment);
        after.insertAdjacentElement('afterend', c);
      }
    });
  }

  /* ================= WATCH MODE (teacher) ================= */
  if (WATCH) {
    // answers come from teacher.html through sessionStorage (shared by the page and its frame)
    const name = params.get('name') || WATCH;
    let shown = null;                   // the answers currently on screen (to work out what changed)
    Storage.prototype.getItem = function (k) {
      if (this === store && IS_ANSWERS(k)) {
        const v = sessionStorage.getItem('watch-' + WATCH + '-' + k);
        if (shown === null) { try { shown = JSON.parse(v || '{}') || {}; } catch (e) { shown = {}; } }
        return v;
      }
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
    const teacher = () => { try { return window.parent && window.parent.__teacher; } catch (e) { return null; } };

    // "Show right / wrong": use the page's own checking — checkAll() where the site has it,
    // otherwise press every visible Check / ✓ / "Show my score" button (never Clear, Reset or Send)
    function showRightWrong() {
      if (typeof checkAll === 'function') { checkAll(); return; }
      document.querySelectorAll('button').forEach(b => {
        const t = b.textContent.trim();
        if (b.offsetParent === null || b.closest('.watch-tools')) return;
        if (/^check\b/i.test(t) || t === '✓' || /^show my score/i.test(t)) { try { b.click(); } catch (e) {} }
      });
    }

    const ANSWERABLE = 'input:not([type=hidden]):not([type=checkbox]), textarea, select, .mc-options, .choice-group, .word-choice, .match-grid, [id^="ex-match"]';
    const TASKS = '.card, .exercise, .quiz, .section';
    function keysIn(box) {             // every name the page may have saved this task's answers under
      const keys = new Set();
      box.querySelectorAll('[id]').forEach(e => { keys.add(e.id); keys.add('match-' + e.id); });
      if (box.id) { keys.add(box.id); keys.add('match-' + box.id); }
      box.querySelectorAll('[data-key]').forEach(e => keys.add(e.dataset.key));
      box.querySelectorAll('input[type=radio][name]').forEach(e => keys.add('mc-' + e.name));
      box.querySelectorAll('[data-match-id]').forEach(e => keys.add('match_' + e.dataset.matchId));
      return [...keys];
    }

    // set one saved answer on the page the way the site itself restores it; false = unknown kind of answer
    function applyKey(k, v) {
      const val = v == null ? '' : v;
      const fire = el => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const el = document.getElementById(k);
      if (el) {
        if (el.matches('input[type=checkbox]')) { el.checked = !!v; return true; }
        if (el.matches('input[type=radio]')) return false;
        if (el.matches('input, textarea, select')) {
          el.value = val;
          el.classList.remove('correct', 'wrong', 'is-right', 'is-wrong');
          if (el.classList.contains('xw-blank')) { const g = el.closest('.xw-grid'); if (g) g.dispatchEvent(new Event('input', { bubbles: true })); }
          else fire(el);                  // word counters, word boxes etc. update themselves
          return true;
        }
        if (el.classList.contains('word-choice')) {
          el.querySelectorAll('.word-choice-btn').forEach(b => { b.classList.toggle('selected', b.textContent.trim() === val); b.classList.remove('correct', 'wrong'); });
          return true;
        }
        if (el.classList.contains('choice-group')) {
          el.querySelectorAll('.choice-btn').forEach(b => { b.classList.toggle('selected', b.dataset.value === val); b.classList.remove('is-right', 'is-wrong'); });
          return true;
        }
        return false;
      }
      if (k.startsWith('mc-')) {
        const radios = document.querySelectorAll('input[name="' + cssId(k.slice(3)) + '"]');
        if (!radios.length) return false;
        radios.forEach(r => { r.checked = r.value === val; const l = r.closest('.mc-option'); if (l) { l.classList.toggle('selected', r.value === val); l.classList.remove('correct', 'wrong'); } });
        return true;
      }
      const dk = document.querySelector('[data-key="' + cssId(k) + '"]');
      if (dk && dk.matches('input, textarea, select')) { dk.value = val; fire(dk); return true; }
      return false;
    }

    let latest = [];
    window.__watch = {
      // new answers from the student → change only what changed, without reloading; false = please reload
      apply(json) {
        let next; try { next = JSON.parse(json || '{}') || {}; } catch (e) { return false; }
        const prev = shown || {};
        const diff = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
        for (const k of diff) if (!applyKey(k, next[k])) return false;
        shown = next;
        try { if (typeof data === 'object' && data) { Object.keys(data).forEach(k => delete data[k]); Object.assign(data, next); } } catch (e) {}   // the page's own copy
        if (params.get('check') === '1') showRightWrong();
        return true;
      },
      ready: false,
      highlight(keys) {                 // outline the field(s) the student changed last
        document.querySelectorAll('.w-latest').forEach(e => e.classList.remove('w-latest'));
        latest = (keys || []).map(findAnchor).map(visual).filter(Boolean);
        latest.forEach(e => e.classList.add('w-latest'));
        return latest.length;
      },
      scrollToLatest() { if (latest[0]) latest[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); },
      setNotes(notes) { drawNotes(notes); },
      stats
    };

    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.classList.add('watching');
      window.toast = () => {};
      addCss(NOTE_CSS +
        '.watch-bar{position:sticky;top:0;z-index:9999;padding:7px 16px;background:#1F7A5A;color:#fff;font:700 14px/1.3 system-ui,sans-serif;text-align:center;letter-spacing:.02em}' +
        'html.watching .rec,html.watching .dict-fab{display:none}' +
        '.w-latest{box-shadow:0 0 0 4px #FFB547,0 0 18px 6px rgba(255,181,71,.55)!important;border-radius:8px;animation:wLatest 1.2s ease-in-out 3}' +
        '@keyframes wLatest{50%{box-shadow:0 0 0 7px #FFB547,0 0 26px 10px rgba(255,181,71,.35)}}' +
        '.w-pen{position:absolute;z-index:9998;display:none;border:0;border-radius:99px;padding:5px 11px;background:#2B2F3A;color:#fff;font:700 13px/1 system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
        '.w-pen:hover{background:#E8664A}' +
        '.w-task{position:relative}' +
        '.w-reset{position:absolute;top:8px;right:8px;z-index:20;border:1px solid #E5D9D3;border-radius:99px;padding:4px 10px;background:#fff;color:#8A3B2A;font:700 12px/1 system-ui;cursor:pointer;opacity:0;transition:opacity .15s}' +
        '.w-task:hover>.w-reset{opacity:1}');
      const bar = document.createElement('div');
      bar.className = 'watch-bar watch-tools';
      bar.textContent = '👀 ' + name + '’s answers — read-only · point at an answer and click ✎ to mark or comment';
      document.body.prepend(bar);

      // ✎ button: appears on the answer under the mouse
      const pen = document.createElement('button');
      pen.className = 'w-pen watch-tools'; pen.type = 'button'; pen.textContent = '✎ Mark / comment';
      document.body.appendChild(pen);
      let target = null;
      document.addEventListener('mouseover', e => {
        if (e.target === pen) return;
        const el = e.target.closest && e.target.closest(ANSWERABLE);
        if (!el || el.closest('.watch-tools')) return;
        target = visual(el);
        const r = target.getBoundingClientRect();
        pen.style.left = (r.right + scrollX - 4) + 'px'; pen.style.top = (r.top + scrollY - 14) + 'px'; pen.style.display = 'block';
      });
      pen.addEventListener('click', () => {
        const t = teacher(); if (!t || !target) return;
        const anchor = anchorOf(target);
        if (!anchor) return;
        const label = (target.value || target.textContent || '').trim().slice(0, 140);
        t.annotate(anchor, label);
      });

      // "↺ Reset task" on every task box that holds answers
      document.querySelectorAll(TASKS).forEach(box => {
        if (!box.querySelector(ANSWERABLE) || box.querySelector(TASKS)) return;   // innermost boxes only
        box.classList.add('w-task');
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'w-reset watch-tools'; b.textContent = '↺ Reset task';
        b.addEventListener('click', () => {
          const t = teacher(); if (!t) return;
          const title = (box.querySelector('h2,h3,.instructions') || {}).textContent || '';
          t.resetTask(keysIn(box), title.trim().slice(0, 80));
        });
        box.prepend(b);
      });

      if (params.get('check') === '1') setTimeout(showRightWrong, 200);
      setTimeout(() => { window.__watch.ready = true; }, params.get('check') === '1' ? 350 : 120);
    });
    return;
  }

  /* ================= NORMAL MODE (student) ================= */
  // remember when this device last changed the answers, so two devices don't overwrite each other
  let KEY = null, changed = new Set();
  const metaKey = () => 'sync-at-' + KEY;
  function noteChange(oldJson, newJson) {
    let a = {}, b = {};
    try { a = JSON.parse(oldJson || '{}') || {}; } catch (e) {}
    try { b = JSON.parse(newJson || '{}') || {}; } catch (e) {}
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(x => { if (JSON.stringify(a[x]) !== JSON.stringify(b[x])) changed.add(x); });
  }
  Storage.prototype.setItem = function (k, v) {
    const old = this === store && IS_ANSWERS(k) ? rawGet.call(this, k) : null;
    const r = rawSet.call(this, k, v);
    if (this === store && IS_ANSWERS(k)) { KEY = k; noteChange(old, v); set(metaKey(), String(Date.now())); queueUpload(); }
    return r;
  };
  Storage.prototype.removeItem = function (k) {             // "clear my answers" buttons
    const old = this === store && IS_ANSWERS(k) ? rawGet.call(this, k) : null;
    const r = rawRemove.call(this, k);
    if (this === store && IS_ANSWERS(k)) { KEY = k; noteChange(old, '{}'); set(metaKey(), String(Date.now())); queueUpload(); }
    return r;
  };

  let fb = null, timer = null;
  function queueUpload() { clearTimeout(timer); timer = setTimeout(upload, 500); }
  function upload() {
    if (!fb || !KEY) return;                            // not connected yet: start() uploads later
    const json = get(KEY) || '{}';
    const at = +get(metaKey()) || Date.now();
    const rec = { json, key: KEY, at, path: location.pathname, title: document.title, dev: fb.uid, stats: stats() };
    if (changed.size) rec.changed = [...changed].slice(-5);
    changed = new Set();
    fb.db.set(fb.db.ref(fb.d, `students/${STUDENT}/pages/${PAGE}`), rec).catch(() => {});
  }

  let part = '';
  function presence(online) {
    if (!fb) return;
    fb.db.set(fb.db.ref(fb.d, `students/${STUDENT}/presence`),
      { page: PAGE, path: location.pathname, title: document.title, part, online, at: Date.now() }).catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', () => {
    addCss(NOTE_CSS);
    if (typeof window.showPart === 'function') {        // tell the teacher which tab is open
      const orig = window.showPart;
      window.showPart = function (id) { orig(id); part = id; presence(true); };
      const open = document.querySelector('.lesson-part.active');
      if (open) part = open.id;
    }
    const y = sessionStorage.getItem('sync-scroll-' + PAGE);   // after a reload caused by the teacher / another device
    if (y) { sessionStorage.removeItem('sync-scroll-' + PAGE); setTimeout(() => scrollTo(0, +y), 50); }
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

    // answers changed somewhere else (another device, or a reset by the teacher) → use them
    let first = true;
    db.onValue(db.ref(d, `students/${STUDENT}/pages/${PAGE}`), snap => {
      const remote = snap.val();
      KEY = KEY || (remote && remote.key) || guessKey();
      const localAt = KEY ? (+get(metaKey()) || 0) : 0, local = KEY ? get(KEY) : null;
      if (KEY && remote && remote.dev !== uid && remote.at > localAt && remote.json !== local) {
        set(KEY, remote.json); set(metaKey(), String(remote.at));
        sessionStorage.setItem('sync-scroll-' + PAGE, String(scrollY));
        location.reload();
        return;
      }
      if (first && KEY && local && (!remote || localAt > remote.at)) upload();   // changes made offline, or before syncing existed
      else if (first && KEY && remote && !remote.stats) setTimeout(upload, 800); // older record: add the progress count
      first = false;
    });

    // the teacher's marks and comments for this page
    db.onValue(db.ref(d, `students/${STUDENT}/notes/${PAGE}`), snap => {
      const notes = snap.val();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => drawNotes(notes));
      else drawNotes(notes);
    });

    const pres = db.ref(d, `students/${STUDENT}/presence`);
    db.onDisconnect(pres).update({ online: false, at: db.serverTimestamp() });
    presence(document.visibilityState === 'visible');
  }
  start().catch(e => console.warn('sync off:', e && e.message));
})();
