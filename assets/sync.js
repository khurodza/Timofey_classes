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
   Extras: blocks with data-extra="id" (a step, a card, a tab and its
   chip) are hidden from the student until the teacher opens them in
   teacher.html (students/<id>/extras/<page>/<id>). The student's open
   page shows them at once. ?extras=all shows every extra (teacher's
   own browser, screen sharing).
   Moved tasks: the teacher can move any step (section.step with an id)
   into the Homework tab and back (students/<id>/moved/<page>/<step id>).
   A Homework tab is made if the lesson has none; a moved extra is shown.
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
    const live = el => !el.closest('[data-extra]:not(.unlocked)');
    document.querySelectorAll('input[data-answer]:not(.xw-blank), textarea[data-answer], select[data-answer]').forEach(el => live(el) &&
      count(!!el.value.trim(), matches(el.value, el.dataset.answer, el.dataset.check === 'contains')));
    document.querySelectorAll('.mc-options[data-correct]').forEach(g => { if (!live(g)) return; const c = g.querySelector('input:checked') || g.querySelector('.mc-option.selected input'); count(!!c, c && c.value === g.dataset.correct); });
    document.querySelectorAll('.choice-group[data-correct]').forEach(g => { const c = g.querySelector('.choice-btn.selected'); count(!!c, c && c.dataset.value === g.dataset.correct); });
    document.querySelectorAll('.word-choice[data-answer]').forEach(g => { if (!live(g)) return; const c = g.querySelector('.selected'); count(!!c, c && c.textContent.trim().toLowerCase() === g.dataset.answer.toLowerCase()); });
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

  // extras the teacher has opened: { id: time } → .unlocked on every [data-extra="id"]
  function applyExtras(map) {
    map = map || {};
    const all = params.get('extras') === 'all';
    document.querySelectorAll('[data-extra]').forEach(el => el.classList.toggle('unlocked', all || !!map[el.dataset.extra]));
    document.querySelectorAll('.extra-toggle').forEach(t => {
      const on = all || !!map[t.dataset.for];
      t.classList.toggle('on', on);
      t.querySelector('span').textContent = on ? '🔓 Extra · open for the student' : '🔒 Extra · hidden from the student';
      t.querySelector('button').textContent = on ? 'Hide again' : 'Open for the student';
    });
    if (!WATCH) {                                         // the open tab was closed again → back to the first tab
      const open = document.querySelector('.lesson-part.active');
      if (open && open.matches('[data-extra]:not(.unlocked)') && typeof window.showPart === 'function') window.showPart(document.querySelector('.lesson-part').id);
    }
    if (typeof updateScoreBar === 'function') try { updateScoreBar(); } catch (e) {}
  }
  // tasks the teacher moved to homework: { task: time } → the task goes to the homework (and back).
  // The page layout is detected, so the same code works on every site:
  //   steps — section.step inside .lesson-part tabs, Homework = the .part-tab.hw tab (Timofey, Matvey)
  //   tabs  — .exercise inside .tab-content tabs, Homework = #tab-hw (Polina)
  //   plain — .section / section.step on one page; a "🏠 Homework" block is added at the end (Ksyusha, tab-less lessons)
  const LAYOUT = () => document.querySelector('.lesson-part') ? 'steps' : document.querySelector('.tab-content') ? 'tabs' : 'plain';
  const TASKS_SEL = { steps: 'section.step', tabs: '.tab-content > .exercise', plain: '.section, section.step' };
  let taskKeysDone = false;
  function taskKeys() {                                 // every task's name: its id, or its place on the page (fixed before anything moves)
    if (taskKeysDone) return; taskKeysDone = true;
    document.querySelectorAll(TASKS_SEL[LAYOUT()]).forEach((el, i) => { if (!el.parentElement.closest(TASKS_SEL[LAYOUT()])) el.dataset.task = el.id || 'task-' + (i + 1); });
  }
  const taskEl = k => document.querySelector('[data-task="' + cssId(k) + '"]');
  function homeworkBox(make) {                          // where moved tasks go (made if needed and make is true)
    const lay = LAYOUT();
    if (lay === 'steps') {
      const tab = document.querySelector('.part-tab.hw');
      let part = tab ? document.getElementById(tab.dataset.part) : document.getElementById('part-homework');
      if (!part && make) {
        const parts = document.querySelectorAll('.lesson-part'), bar = document.querySelector('nav.parts .wrap');
        part = document.createElement('div');
        part.id = 'part-homework'; part.className = 'lesson-part'; part.dataset.made = '1';
        part.innerHTML = '<nav class="chips"><div class="wrap"></div></nav><div class="wrap"></div>';
        parts[parts.length - 1].after(part);
        const b = document.createElement('button');
        b.className = 'part-tab hw'; b.dataset.part = 'part-homework'; b.dataset.made = '1'; b.textContent = 'Homework';
        b.addEventListener('click', () => window.showPart('part-homework'));
        if (bar) bar.appendChild(b);
      }
      return part && { root: part, box: part.querySelector(':scope > .wrap') || part, chips: part.querySelector('nav.chips .wrap') };
    }
    if (lay === 'tabs') {
      let part = document.getElementById('tab-hw');
      if (!part && make) {
        const tabs = document.querySelectorAll('.tab-content'), bar = document.querySelector('.tab-bar');
        part = document.createElement('div');
        part.id = 'tab-hw'; part.className = 'tab-content'; part.dataset.made = '1';
        tabs[tabs.length - 1].after(part);
        const b = document.createElement('button');
        b.className = 'tab-btn'; b.dataset.made = '1'; b.dataset.tab = 'hw'; b.textContent = '🏠 Homework';
        b.addEventListener('click', () => typeof window.switchTab === 'function' && window.switchTab('hw', b));
        if (bar) bar.appendChild(b);
      }
      return part && { root: part, box: part };
    }
    let part = document.getElementById('moved-homework');
    if (!part && make) {
      part = document.createElement('div');
      part.id = 'moved-homework'; part.className = 'hw-block'; part.dataset.made = '1';
      part.innerHTML = '<h2 class="hw-block-title">🏠 Homework</h2>';
      const tasks = [...document.querySelectorAll('[data-task]')], last = tasks[tasks.length - 1];
      (last ? last.parentElement : document.body).appendChild(part);
    }
    return part && { root: part, box: part };
  }
  function applyMoves(map) {
    map = map || {};
    taskKeys();
    document.querySelectorAll('[data-task][data-moved]').forEach(el => {     // back to the lesson
      const k = el.dataset.task;
      if (map[k]) return;
      const home = document.querySelector('template[data-home="' + cssId(k) + '"]');
      if (home) home.replaceWith(el);
      if (el.id) {
        const chip = document.querySelector('a[data-moved][href="#' + cssId(el.id) + '"]'), chome = document.querySelector('template[data-chip-home="' + cssId(el.id) + '"]');
        if (chip && chome) { chome.replaceWith(chip); chip.removeAttribute('data-moved'); }
      }
      const num = el.querySelector('.step-num'); if (num && el.dataset.num != null) num.textContent = el.dataset.num;
      el.removeAttribute('data-moved'); el.classList.remove('has-moved');
    });
    const keys = Object.keys(map).filter(k => taskEl(k)).sort((a, b) => map[a] - map[b]);
    const hw = homeworkBox(keys.length > 0);
    keys.forEach(k => {
      const el = taskEl(k);
      if (el.dataset.moved || el.closest('#' + cssId(hw.root.id))) return;
      const t = document.createElement('template'); t.dataset.home = k; el.before(t);
      const finish = [...hw.box.querySelectorAll(':scope > *')].find(x => x.querySelector('.fun-check') && !x.dataset.moved);   // keep Итог last
      finish ? finish.before(el) : hw.box.appendChild(el);
      el.dataset.moved = '1'; el.classList.add('has-moved');
      const chip = el.id && document.querySelector('nav.chips a[href="#' + cssId(el.id) + '"]');
      if (chip && hw.chips) { const ct = document.createElement('template'); ct.dataset.chipHome = el.id; chip.before(ct); chip.dataset.moved = '1'; hw.chips.appendChild(chip); }
    });
    if (hw) {
      if (LAYOUT() === 'steps') {                         // renumber the homework steps 1, 2, 3 …
        let n = 0;
        hw.root.querySelectorAll('section.step').forEach(sec => {
          const num = sec.querySelector('.step-num'); if (!num || num.classList.contains('plus')) return;
          if (sec.dataset.num == null) sec.dataset.num = num.textContent;
          num.textContent = ++n;
        });
        hw.root.querySelectorAll('nav.chips a').forEach(a => {
          const sec = document.getElementById(a.getAttribute('href').slice(1)), num = sec && sec.querySelector('.step-num');
          if (num) a.textContent = num.textContent + ' · ' + a.textContent.replace(/^\s*[^·]*·\s*/, '');
        });
      }
      const any = !!hw.root.querySelector('[data-moved]');
      hw.root.classList.toggle('has-moved', any);
      const tab = document.querySelector('.part-tab[data-part="' + cssId(hw.root.id) + '"], .tab-btn[data-made]');
      if (tab) tab.classList.toggle('has-moved', any);
      if (hw.root.dataset.made && !any) {                 // a homework place we made, now empty again
        const wasOpen = hw.root.classList.contains('active');
        document.querySelectorAll('[data-made]').forEach(x => x !== hw.root && x.matches('.part-tab, .tab-btn') && x.remove());
        hw.root.remove();
        if (wasOpen && typeof window.showPart === 'function' && document.querySelector('.lesson-part')) window.showPart(document.querySelector('.lesson-part').id);
        if (wasOpen && typeof window.switchTab === 'function' && document.querySelector('.tab-content')) window.switchTab(document.querySelector('.tab-content').id.replace(/^tab-/, ''), document.querySelector('.tab-btn'));
      }
    }
    document.querySelectorAll('.move-btn').forEach(b => {
      const on = !!b.parentElement.dataset.moved;
      b.textContent = on ? '↩ Back to the lesson' : '📚 Move to homework';
      b.classList.toggle('on', on);
    });
    if (typeof updateScoreBar === 'function') try { updateScoreBar(); } catch (e) {}
  }
  // styles for extras and moved tasks (here, so every site has them whatever its stylesheet)
  addCss(
    'html:not(.watching) [data-extra]:not(.unlocked):not(.has-moved){display:none!important}' +
    'html.watching section[data-extra],html.watching div.card[data-extra]{outline:3px dashed #9B7BE6;outline-offset:8px;border-radius:18px}' +
    'html.watching section[data-extra].unlocked,html.watching div.card[data-extra].unlocked{outline-color:#12A374}' +
    'html.watching .part-tab[data-extra]{border-style:dashed;border-color:#9B7BE6}html.watching .part-tab[data-extra].unlocked{border-color:#12A374}' +
    'html.watching .chips a[data-extra]{opacity:.6;font-style:italic}html.watching .chips a[data-extra].unlocked{opacity:1;font-style:normal}' +
    '.extra-toggle{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:8px 12px;border-radius:12px;background:#F1ECFD;border:2px solid #9B7BE6;font:700 14px/1.3 system-ui,sans-serif;color:#4B3A8C}' +
    '.extra-toggle button{border:0;border-radius:99px;padding:6px 14px;background:#7B5CE6;color:#fff;font:800 13px/1 system-ui;cursor:pointer}' +
    '.extra-toggle.on{background:#E8F7EF;border-color:#12A374;color:#0D6B4C}.extra-toggle.on button{background:#fff;color:#0D6B4C;border:2px solid #12A374}' +
    '.w-movable{position:relative}' +
    '.move-btn{position:absolute;top:-14px;right:16px;z-index:21;border:2px solid #7B5CE6;border-radius:99px;padding:5px 12px;background:#fff;color:#5B44B8;font:800 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}' +
    '.move-btn:hover{background:#7B5CE6;color:#fff}.move-btn.on{border-color:#12A374;color:#0D6B4C}.move-btn.on:hover{background:#12A374;color:#fff}' +
    '.hw-block{margin:40px 0 20px;padding-top:12px;border-top:3px dashed #7B5CE6}.hw-block-title{color:#7B5CE6;margin:0 0 12px}');
  const whenReady = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn();

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
      if (k === 'activeTab' || k.startsWith('chk-')) return true;   // only which tab is open / that Check was pressed: nothing to show
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
          el.querySelectorAll('.word-choice-btn').forEach(b => { b.classList.toggle('selected', (b.dataset.val ?? b.dataset.value ?? b.textContent.trim()) === val); b.classList.remove('correct', 'wrong'); });
          return true;
        }
        if (el.classList.contains('choice-group')) {
          el.querySelectorAll('.choice-btn').forEach(b => { b.classList.toggle('selected', b.dataset.value === val); b.classList.remove('is-right', 'is-wrong'); });
          return true;
        }
        return false;
      }
      if (k.startsWith('st-') && document.getElementById(k.slice(3))) {   // Polina: stressed syllable picked by number
        document.getElementById(k.slice(3)).querySelectorAll('.syl').forEach((x, i) => { x.classList.toggle('picked', i === v); x.classList.remove('ok', 'no'); });
        return true;
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
      setExtras(map) { applyExtras(map); },
      setMoved(map) { applyMoves(map); },
      stats
    };

    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.classList.add('watching');
      window.toast = () => {};
      addCss(NOTE_CSS +
        '.watch-bar{position:sticky;top:0;z-index:9999;padding:7px 16px;background:#F2A3C2;color:#1E2C4D;border-bottom:2px solid #1E2C4D;font:700 14px/1.3 system-ui,sans-serif;text-align:center;letter-spacing:.02em}' +
        'html.watching .rec,html.watching .dict-fab{display:none}' +
        '.w-latest{box-shadow:0 0 0 4px #FFB547,0 0 18px 6px rgba(255,181,71,.55)!important;border-radius:8px;animation:wLatest 1.2s ease-in-out 3}' +
        '@keyframes wLatest{50%{box-shadow:0 0 0 7px #FFB547,0 0 26px 10px rgba(255,181,71,.35)}}' +
        '.w-pen{position:absolute;z-index:9998;display:none;border:0;border-radius:99px;padding:5px 11px;background:#2D5DA8;color:#fff;font:700 13px/1 system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
        '.w-pen:hover{background:#D9628F}' +
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

      // Open / Hide switch on every extra block (not on its tab button or chip: those follow the block)
      document.querySelectorAll('[data-extra]:not(.part-tab):not(a)').forEach(box => {
        const bar = document.createElement('div');
        bar.className = 'extra-toggle watch-tools';
        bar.dataset.for = box.dataset.extra;
        bar.innerHTML = '<span></span><button type="button"></button>';
        bar.querySelector('button').addEventListener('click', () => {
          const t = teacher(); if (t && t.setExtra) t.setExtra(box.dataset.extra, !box.classList.contains('unlocked'));
        });
        (box.classList.contains('lesson-part') ? box.querySelector('.wrap:not(nav .wrap)') || box : box).prepend(bar);
      });
      applyExtras({});

      // 📚 Move to homework / ↩ Back to the lesson on every task (not on tasks that are homework already)
      taskKeys();
      const hwHome = homeworkBox(false);
      document.querySelectorAll('[data-task]').forEach(el => {
        if (hwHome && hwHome.root.contains(el)) return;
        el.classList.add('w-movable');
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'move-btn watch-tools'; b.textContent = '📚 Move to homework';
        b.addEventListener('click', () => { const t = teacher(); if (t && t.moveTask) t.moveTask(el.dataset.task, !el.dataset.moved); });
        el.prepend(b);
      });
      applyMoves({});

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

  // extras: last known state from this device first (works offline / on a local copy), then live from Firebase
  const EXTRAS_KEY = 'extras-' + PAGE;
  let extras = {}; try { extras = JSON.parse(get(EXTRAS_KEY) || '{}') || {}; } catch (e) {}
  whenReady(() => applyExtras(extras));
  const MOVED_KEY = 'moved-' + PAGE;
  let moved = {}; try { moved = JSON.parse(get(MOVED_KEY) || '{}') || {}; } catch (e) {}
  whenReady(() => applyMoves(moved));
  function movedChanged(map) {
    map = map || {};
    const fresh = Object.keys(map).filter(k => !moved[k]);
    moved = map; set(MOVED_KEY, JSON.stringify(map));
    whenReady(() => {
      applyMoves(map);
      if (fresh.length && typeof toast === 'function') toast('📚 New homework task!');
    });
  }
  function extrasChanged(map) {
    map = map || {};
    const fresh = Object.keys(map).filter(k => !extras[k]);
    extras = map; set(EXTRAS_KEY, JSON.stringify(map));
    whenReady(() => {
      applyExtras(map);
      const el = fresh.length && document.querySelector('[data-extra="' + cssId(fresh[0]) + '"]:not(.part-tab):not(a)');
      const h = el && el.querySelector('h2, h3');
      if (el && typeof toast === 'function') toast('🔓 New task: ' + (h ? h.textContent.trim() : 'open!'));
    });
  }

  // before the first save on this device: find this page's answers key among the saved ones
  function guessKey() {
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (IS_ANSWERS(k) && k.includes(PAGE)) return k; }
    return null;
  }

  async function start() {
    if (location.hostname !== 'khurodza.github.io') return;   // local copy / preview: don't write to the students' live data
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

    // "Start fresh" by the teacher: answers saved on this device before that moment are not counted again
    const resetAt = +((await db.get(db.ref(d, `students/${STUDENT}/resetAt`))).val() || 0);

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
      if (first && KEY && local && localAt > resetAt && (!remote || localAt > remote.at)) upload();   // changes made offline, or before syncing existed
      else if (first && KEY && remote && !remote.stats) setTimeout(upload, 800); // older record: add the progress count
      first = false;
    });

    db.onValue(db.ref(d, `students/${STUDENT}/extras/${PAGE}`), snap => extrasChanged(snap.val()));
    db.onValue(db.ref(d, `students/${STUDENT}/moved/${PAGE}`), snap => movedChanged(snap.val()));

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
