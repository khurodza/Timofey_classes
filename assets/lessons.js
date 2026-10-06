/* ============================================================
   Matvey's English Lessons — shared exercise engine
   Loaded by every lesson page. Do not edit unless you want to
   change how exercises are checked / saved on every lesson.

   The lesson key (used for saving answers) is worked out
   automatically from the file name, e.g. lessons/lesson-01.html
   → "lesson-01". You never need to set it by hand.
   ============================================================ */

const LESSON_KEY = 'answers-' + location.pathname.split('/').pop().replace('.html', '');

let data = {};
try { data = JSON.parse(localStorage.getItem(LESSON_KEY)) || {}; } catch (e) {}

function save(patch) {
  Object.assign(data, patch);
  localStorage.setItem(LESSON_KEY, JSON.stringify(data));
}

/* ---------------- toast ---------------- */
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1900);
}

function studentName() {
  return (localStorage.getItem('studentName') || '').trim();
}

/* ============================================================
   FILL IN THE BLANKS
   <input class="blank" id="UNIQUE" data-answer="word|otherword">
   ============================================================ */
function checkBlanks(exId, cls) {
  cls = cls || 'blank';
  const scope = exId ? document.getElementById(exId) : document;
  scope.querySelectorAll('.' + cls).forEach(inp => {
    if (!inp.dataset.answer) return;   // free-writing line — nothing to check
    const val = inp.value.trim().toLowerCase();
    const answers = inp.dataset.answer.toLowerCase().split('|').map(s => s.trim());
    inp.classList.remove('correct', 'wrong');
    if (!val) return;
    inp.classList.add(answers.includes(val) ? 'correct' : 'wrong');
  });
  updateScoreBar();
}

function resetBlanks(exId, cls) {
  cls = cls || 'blank';
  const scope = exId ? document.getElementById(exId) : document;
  scope.querySelectorAll('.' + cls).forEach(inp => {
    inp.value = '';
    inp.classList.remove('correct', 'wrong');
    save({ [inp.id]: '' });
  });
  updateScoreBar();
}

/* ============================================================
   MULTIPLE CHOICE
   <div class="mc-options" data-correct="b">
     <label class="mc-option"><input type="radio" name="mcX" value="b">...</label>
   </div>
   ============================================================ */
function checkMC(exId) {
  const scope = exId ? document.getElementById(exId) : document;
  scope.querySelectorAll('.mc-options').forEach(group => {
    const correct = group.dataset.correct;
    const selected = group.querySelector('.mc-option.selected');
    group.querySelectorAll('.mc-option').forEach(l => l.classList.remove('correct', 'wrong'));
    if (!selected) return;
    const val = selected.querySelector('input').value;
    selected.classList.add(val === correct ? 'correct' : 'wrong');
    if (val !== correct) {
      group.querySelectorAll('.mc-option').forEach(l => {
        if (l.querySelector('input').value === correct) l.classList.add('correct');
      });
    }
  });
  updateScoreBar();
}

function resetMC(exId) {
  const scope = exId ? document.getElementById(exId) : document;
  scope.querySelectorAll('.mc-option').forEach(l => {
    l.classList.remove('selected', 'correct', 'wrong');
    const input = l.querySelector('input');
    if (input) save({ ['mc-' + input.name]: '' });
  });
  updateScoreBar();
}

function restoreMC() {
  document.querySelectorAll('.mc-options').forEach(group => {
    group.querySelectorAll('.mc-option').forEach(label => {
      const input = label.querySelector('input');
      const saved = data['mc-' + input.name];
      if (saved && saved === input.value) label.classList.add('selected');
    });
  });
}

document.addEventListener('click', e => {
  const label = e.target.closest('.mc-option');
  if (!label) return;
  const group = label.closest('.mc-options');
  group.querySelectorAll('.mc-option').forEach(l => l.classList.remove('selected'));
  label.classList.add('selected');
  const input = label.querySelector('input');
  save({ ['mc-' + input.name]: input.value });
});

/* ============================================================
   MATCHING
   Each exercise wraps two .match-col lists inside a div with
   a unique id (exId). Items with the same data-pair match.
   <div class="match-item" data-pair="1" onclick="selectMatch(this,'ex-match-01')">
   ============================================================ */
const matchState = {};

function selectMatch(el, exId) {
  if (el.classList.contains('matched')) return;
  if (!matchState[exId]) matchState[exId] = { left: null, right: null };
  const state = matchState[exId];
  const col = el.closest('.match-col');
  col.querySelectorAll('.match-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');

  const side = col.dataset.side;
  state[side] = el;
  const otherSide = side === 'left' ? 'right' : 'left';

  if (state[otherSide]) {
    const a = state.left, b = state.right;
    if (a.dataset.pair === b.dataset.pair) {
      a.classList.remove('selected'); a.classList.add('matched', 'locked');
      b.classList.remove('selected'); b.classList.add('matched', 'locked');
      const matched = data['match-' + exId] || [];
      matched.push(a.dataset.pair);
      save({ ['match-' + exId]: matched });
      toast('Matched');
    } else {
      [a, b].forEach(x => x.classList.add('shake'));
      setTimeout(() => [a, b].forEach(x => x.classList.remove('selected', 'shake')), 400);
    }
    state.left = null; state.right = null;
  }
  updateScoreBar();
}

function resetMatchEx(exId) {
  const container = document.getElementById(exId);
  container.querySelectorAll('.match-item').forEach(el => el.classList.remove('matched', 'locked', 'selected', 'shake'));
  matchState[exId] = { left: null, right: null };
  save({ ['match-' + exId]: [] });
  updateScoreBar();
}

function restoreMatching() {
  document.querySelectorAll('[id^="ex-match"]').forEach(container => {
    const exId = container.id;
    const matched = data['match-' + exId] || [];
    matched.forEach(pair => {
      container.querySelectorAll(`.match-item[data-pair="${pair}"]`).forEach(el => el.classList.add('matched', 'locked'));
    });
  });
}

/* ============================================================
   WORD CHOICE (inline take/give style buttons)
   <span class="word-choice" data-answer="take">
     <button class="word-choice-btn" onclick="selectWord(this)">take</button>
     <button class="word-choice-btn" onclick="selectWord(this)">give</button>
   </span>
   ============================================================ */
function selectWord(btn) {
  const span = btn.closest('.word-choice');
  span.querySelectorAll('.word-choice-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  save({ [span.id]: btn.textContent.trim() });
}

function checkWords(exId) {
  const scope = exId ? document.getElementById(exId) : document;
  scope.querySelectorAll('.word-choice').forEach(span => {
    const answer = (span.dataset.answer || '').toLowerCase();
    span.querySelectorAll('.word-choice-btn').forEach(b => b.classList.remove('correct', 'wrong'));
    const selected = span.querySelector('.word-choice-btn.selected');
    if (!selected) return;
    if (selected.textContent.trim().toLowerCase() === answer) {
      selected.classList.add('correct');
    } else {
      selected.classList.add('wrong');
      span.querySelectorAll('.word-choice-btn').forEach(b => {
        if (b.textContent.trim().toLowerCase() === answer) b.classList.add('correct');
      });
    }
  });
  updateScoreBar();
}

function resetWords(exId) {
  document.getElementById(exId).querySelectorAll('.word-choice').forEach(span => {
    span.querySelectorAll('.word-choice-btn').forEach(b => b.classList.remove('selected', 'correct', 'wrong'));
    save({ [span.id]: '' });
  });
}

function restoreWords() {
  document.querySelectorAll('.word-choice[id]').forEach(span => {
    const saved = data[span.id];
    if (!saved) return;
    span.querySelectorAll('.word-choice-btn').forEach(b => {
      if (b.textContent.trim() === saved) b.classList.add('selected');
    });
  });
}

/* ============================================================
   FREE WRITING — autosaves on every keystroke, no checking
   ============================================================ */
function setupFreeWriting() {
  document.querySelectorAll('.free-write').forEach(el => {
    if (data[el.id] !== undefined) el.value = data[el.id];
    const cc = document.getElementById('cc-' + el.id);
    if (cc) cc.textContent = (el.value || '').length + ' characters';
    el.addEventListener('input', () => {
      save({ [el.id]: el.value });
      if (cc) cc.textContent = el.value.length + ' characters';
    });
  });
}

/* ============================================================
   REFLECTION CHECKLIST — ticks autosave, no correct/wrong
   <label class="reflect-item">
     <input type="checkbox" id="unique">
     <span class="check-box"></span>
     <span class="reflect-text">know about boccia</span>
   </label>
   ============================================================ */
function setupChecklist() {
  document.querySelectorAll('.reflect-item input[type=checkbox]').forEach(cb => {
    if (data[cb.id] !== undefined) cb.checked = data[cb.id];
    cb.addEventListener('change', () => save({ [cb.id]: cb.checked }));
  });
}

/* ============================================================
   FILL-IN INPUTS — restore saved values + autosave
   ============================================================ */
function setupBlanks(cls) {
  cls = cls || 'blank';
  document.querySelectorAll('.' + cls).forEach(el => {
    if (data[el.id] !== undefined) el.value = data[el.id];
    el.addEventListener('input', () => save({ [el.id]: el.value }));
  });
}

/* ============================================================
   CROSSWORD — each letter is an .xw-blank input (same checking
   mechanics as .blank, kept separate so ~100 single-letter
   cells don't flood the main lesson score bar). Typing a
   letter auto-advances to the next cell below in the column.
   Cell ids must follow "xw-c{col}-r{row}" so auto-advance can
   compute the next id.
   ============================================================ */
function setupCrossword() {
  setupBlanks('xw-blank');
  const pos = el => (el.id.match(/^xw-c(\d+)-r(\d+)$/) || []).slice(1).map(Number);
  const cell = (c, r) => document.getElementById(`xw-c${c}-r${r}`);
  let dir = 'down', last = null;
  document.querySelectorAll('.xw-blank').forEach(el => {
    // typing direction: follow the way the student is moving; on a fresh tap,
    // go across if the word runs left-right here, otherwise down
    el.addEventListener('focus', () => {
      const [c, r] = pos(el);
      if (c === undefined) return;
      const [lc, lr] = last ? pos(last) : [];
      if (lr === r && lc === c - 1) dir = 'across';
      else if (lc === c && lr === r - 1) dir = 'down';
      else dir = (cell(c + 1, r) || cell(c - 1, r)) && !cell(c, r + 1) && !cell(c, r - 1) ? 'across'
               : cell(c, r + 1) || cell(c, r - 1) ? 'down' : 'across';
      last = el;
      el.select();   // typing replaces a letter that's already there
    });
    el.addEventListener('input', () => {
      if (!el.value) return;
      const [c, r] = pos(el);
      if (c === undefined) return;
      const next = dir === 'across' ? cell(c + 1, r) : cell(c, r + 1);
      if (next) next.focus();
    });
  });
}

/* word box: tap a word to cross it out once it's used */
document.addEventListener('click', e => {
  const w = e.target.closest('.word-bank-ref span');
  if (w) w.classList.toggle('crossed');
});

/* ============================================================
   STICKY SCORE BAR — counts every auto-checkable exercise
   on the page (fill-in blanks + multiple choice) and shows
   how many are answered / correct so far.
   ============================================================ */
function updateScoreBar() {
  const bar = document.getElementById('scoreBar');
  if (!bar) return;

  let total = 0, done = 0, correct = 0;

  document.querySelectorAll('.blank[data-answer]').forEach(inp => {
    total++;
    if (inp.value.trim()) done++;
    if (inp.classList.contains('correct')) correct++;
  });

  document.querySelectorAll('.mc-options[data-correct]').forEach(group => {
    total++;
    const selected = group.querySelector('.mc-option.selected');
    if (selected) done++;
    if (group.querySelector('.mc-option.correct.selected')) correct++;
  });

  if (total === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';

  // folded view: a small ring + "answered / total"; tap to open the full score
  let mini = bar.querySelector('.sb-mini');
  if (!mini) {
    mini = document.createElement('button');
    mini.type = 'button';
    mini.className = 'sb-mini';
    mini.addEventListener('click', () => bar.classList.toggle('open'));
    document.addEventListener('click', e => { if (!bar.contains(e.target)) bar.classList.remove('open'); });
    bar.querySelector('.wrap').prepend(mini);
  }
  mini.innerHTML = '<span class="sb-ring" style="--p:' + Math.round(done / total * 100) + '"></span>' + done + ' / ' + total;
  mini.setAttribute('aria-label', 'Progress: ' + done + ' of ' + total + ' answered, ' + correct + ' correct. Show score');

  document.getElementById('scoreCorrect').textContent = correct;
  document.getElementById('scoreDone').textContent = done;
  document.getElementById('scoreTotal').textContent = total;
  document.getElementById('scoreMeter').style.width = (done / total * 100) + '%';
}

function checkAll() {
  document.querySelectorAll('.blank[data-answer]').forEach(inp => {
    const val = inp.value.trim().toLowerCase();
    const answers = inp.dataset.answer.toLowerCase().split('|').map(s => s.trim());
    inp.classList.remove('correct', 'wrong');
    if (val) inp.classList.add(answers.includes(val) ? 'correct' : 'wrong');
  });
  checkMC();
  checkWords();
  updateScoreBar();
  const name = studentName();
  toast(name ? `Nice work, ${name}.` : 'Nice work.');
}

/* ============================================================
   TAP TO UNDERLINE
   <span class="tap" data-key onclick="toggleTap(this)">Look!</span>
   Spans with data-key are the ones the student should find.
   Give the container an id and pass it to checkTap / resetTap.
   ============================================================ */
function tapKey(el) {
  const scope = el.closest('[id]');
  const all = Array.from(scope.querySelectorAll('.tap'));
  return 'tap-' + scope.id + '-' + all.indexOf(el);
}

function toggleTap(el) {
  el.classList.toggle('ul');
  el.classList.remove('correct', 'wrong');
  save({ [tapKey(el)]: el.classList.contains('ul') ? 1 : '' });
}

function checkTap(exId) {
  document.getElementById(exId).querySelectorAll('.tap').forEach(el => {
    el.classList.remove('correct', 'wrong');
    if (!el.classList.contains('ul')) return;
    el.classList.add(el.hasAttribute('data-key') ? 'correct' : 'wrong');
  });
}

function resetTap(exId) {
  document.getElementById(exId).querySelectorAll('.tap').forEach(el => {
    el.classList.remove('ul', 'correct', 'wrong');
    save({ [tapKey(el)]: '' });
  });
}

function restoreTap() {
  document.querySelectorAll('.tap').forEach(el => {
    if (data[tapKey(el)]) el.classList.add('ul');
  });
}

/* ============================================================
   LESSON PARTS (tabs)
   <nav class="parts"><button class="part-tab" data-part="part-a" onclick="showPart('part-a')">…</button></nav>
   <div class="lesson-part" id="part-a"> …chips + steps… </div>
   A lesson always opens on its first tab; a #hash into a hidden
   part opens that part instead.
   ============================================================ */
function showPart(id) {
  document.querySelectorAll('.lesson-part').forEach(p => p.classList.toggle('active', p.id === id));
  document.querySelectorAll('.part-tab').forEach(b => b.classList.toggle('active', b.dataset.part === id));
  localStorage.setItem('part-' + LESSON_KEY, id);
}

function initParts() {
  const parts = document.querySelectorAll('.lesson-part');
  if (!parts.length) return;
  let id = parts[0].id;
  let target = null;
  try { target = location.hash && document.querySelector(location.hash); } catch (e) {}
  if (target && target.closest('.lesson-part')) id = target.closest('.lesson-part').id;
  showPart(id);
  if (target) target.scrollIntoView();
}

/* ============================================================
   AUDIO PLAYER — turns every <audio> inside .audio-wrap into a
   styled player: big play button, rewind 5 s, seekable progress
   bar, time, and a slow-down (0.75×) toggle. The original
   <audio> stays in the page (hidden) and does the playing.
   Only one track plays at a time.
   ============================================================ */
const AUDIO_ICONS = {
  play:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
  back:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>'
};

function fmtTime(t) {
  if (!isFinite(t)) return '0:00';
  t = Math.floor(t);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

function setupAudio() {
  document.querySelectorAll('.audio-wrap audio').forEach(audio => {
    audio.removeAttribute('controls');
    audio.preload = 'metadata';

    const ui = document.createElement('div');
    ui.className = 'ap';
    ui.innerHTML =
      '<button type="button" class="ap-play" aria-label="Play">' + AUDIO_ICONS.play + '</button>' +
      '<button type="button" class="ap-back" aria-label="Back 5 seconds" title="Back 5 seconds">' + AUDIO_ICONS.back + '<span>5</span></button>' +
      '<div class="ap-track" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
        '<div class="ap-fill"></div><div class="ap-knob"></div></div>' +
      '<span class="ap-time"><span class="ap-cur">0:00</span> / <span class="ap-dur">0:00</span></span>' +
      '<button type="button" class="ap-speed" aria-label="Playback speed" title="Slower / normal">1×</button>';
    audio.after(ui);

    const play = ui.querySelector('.ap-play'), back = ui.querySelector('.ap-back');
    const track = ui.querySelector('.ap-track'), fill = ui.querySelector('.ap-fill'), knob = ui.querySelector('.ap-knob');
    const cur = ui.querySelector('.ap-cur'), dur = ui.querySelector('.ap-dur'), speed = ui.querySelector('.ap-speed');

    const render = () => {
      const pct = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
      fill.style.width = pct + '%';
      knob.style.left = pct + '%';
      track.setAttribute('aria-valuenow', Math.round(pct));
      cur.textContent = fmtTime(audio.currentTime);
    };
    const setPlaying = on => {
      ui.classList.toggle('playing', on);
      play.innerHTML = on ? AUDIO_ICONS.pause : AUDIO_ICONS.play;
      play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    };

    play.addEventListener('click', () => {
      if (audio.paused) {
        document.querySelectorAll('.audio-wrap audio').forEach(a => { if (a !== audio) a.pause(); });
        audio.play();
      } else audio.pause();
    });
    back.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); render(); });
    speed.addEventListener('click', () => {
      audio.playbackRate = audio.playbackRate === 1 ? 0.75 : 1;
      speed.textContent = audio.playbackRate === 1 ? '1×' : '0.75×';
      speed.classList.toggle('slow', audio.playbackRate !== 1);
    });

    const seekTo = e => {
      if (!audio.duration) return;
      const r = track.getBoundingClientRect();
      const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      audio.currentTime = x * audio.duration;
      render();
    };
    track.addEventListener('pointerdown', e => {
      track.setPointerCapture(e.pointerId);
      ui.classList.add('seeking');
      seekTo(e);
    });
    track.addEventListener('pointermove', e => { if (track.hasPointerCapture(e.pointerId)) seekTo(e); });
    track.addEventListener('pointerup', () => ui.classList.remove('seeking'));
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
      else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
      else return;
      e.preventDefault(); render();
    });

    audio.addEventListener('loadedmetadata', () => { dur.textContent = fmtTime(audio.duration); });
    audio.addEventListener('timeupdate', render);
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => { setPlaying(false); audio.currentTime = 0; render(); });
    if (audio.readyState >= 1) dur.textContent = fmtTime(audio.duration);

    // file not uploaded yet → a calm note instead of a dead player
    const missing = () => { ui.className = 'ap ap-missing'; ui.textContent = '🎧 Audio coming soon'; };
    const sources = audio.querySelectorAll('source');
    audio.addEventListener('error', missing);
    if (sources.length) sources[sources.length - 1].addEventListener('error', missing);
    // start loading again now that we're listening, so an early failure isn't missed
    // (networkState can't be trusted here: it reads "no source" while the browser is still choosing one)
    audio.load();
  });
}

/* ============================================================
   SOUND BUTTONS — tap a word to hear it.
   <button class="say" data-say="sit">sit</button>
   <button class="say say-big" data-say="sheep" aria-label="Listen"></button>
   Plays lessons/audio/words/<name>.m4a, where <name> is the
   data-say text in lowercase, spaces → "-", punctuation removed
   ("Is it a cat?" → is-it-a-cat.m4a). data-file="…" overrides it.
   No file yet? The browser's own English voice reads the text.
   ============================================================ */
const WORDS_AUDIO = (() => {
  const s = document.currentScript && document.currentScript.src;
  return s ? new URL('../lessons/audio/words/', s).href : 'audio/words/';
})();

function sayFile(text) {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

let sayAudio = null, sayBtn = null;

function sayStop() {
  if (sayAudio) { sayAudio.pause(); sayAudio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (sayBtn) sayBtn.classList.remove('playing');
  sayBtn = null;
}

function sayFallback(text, btn) {
  if (!window.speechSynthesis) { btn.classList.remove('playing'); sayBtn = null; return; }
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => v.lang === 'en-GB') || voices.find(v => /^en/.test(v.lang));
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'en-GB';
  u.rate = 0.85;
  u.onend = u.onerror = () => { btn.classList.remove('playing'); if (sayBtn === btn) sayBtn = null; };
  speechSynthesis.speak(u);
}

function say(btn) {
  const same = sayBtn === btn;
  sayStop();
  if (same) return;
  document.querySelectorAll('.audio-wrap audio').forEach(a => a.pause());
  const text = btn.dataset.say;
  sayBtn = btn;
  btn.classList.add('playing');
  const a = new Audio(WORDS_AUDIO + (btn.dataset.file || sayFile(text)) + '.m4a');
  sayAudio = a;
  a.onended = () => { btn.classList.remove('playing'); if (sayAudio === a) { sayAudio = null; sayBtn = null; } };
  a.onerror = () => { if (sayAudio === a) { sayAudio = null; sayFallback(text, btn); } };
  a.play().catch(() => {});
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.say');
  if (btn) { e.preventDefault(); say(btn); }
});

/* ============================================================
   RECORD YOURSELF — <div class="rec"></div>
   Builds a small recorder: press Record, read aloud, press Stop,
   then play it back and compare with the model. Recordings are
   not saved anywhere (they disappear when the page is closed).
   ============================================================ */
const REC_MAX = 60;   // seconds

function setupRecorders() {
  document.querySelectorAll('.rec').forEach(box => {
    if (!(navigator.mediaDevices && window.MediaRecorder)) {
      box.innerHTML = '<span class="rec-note">Recording doesn’t work in this browser. Try Chrome or Safari.</span>';
      return;
    }
    box.innerHTML =
      '<button type="button" class="rec-btn">● Record</button>' +
      '<button type="button" class="rec-play" disabled>▶ My voice</button>' +
      '<span class="rec-note">Press Record and read aloud.</span>';
    const btn = box.querySelector('.rec-btn'), play = box.querySelector('.rec-play'), note = box.querySelector('.rec-note');
    let rec = null, chunks = [], url = null, player = null, timer = null;

    const stop = () => { if (rec && rec.state === 'recording') rec.stop(); };

    btn.addEventListener('click', async () => {
      if (rec && rec.state === 'recording') { stop(); return; }
      sayStop();
      if (player) player.pause();
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { note.textContent = 'No microphone. Allow the microphone and try again.'; return; }
      chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => {
        clearTimeout(timer);
        stream.getTracks().forEach(t => t.stop());
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
        box.classList.remove('recording');
        btn.textContent = '● Record again';
        play.disabled = false;
        note.textContent = 'Listen to yourself. Then listen to the model again.';
      };
      rec.start();
      timer = setTimeout(stop, REC_MAX * 1000);
      box.classList.add('recording');
      btn.textContent = '■ Stop';
      note.textContent = 'Recording… read now.';
    });

    play.addEventListener('click', () => {
      if (!url) return;
      sayStop();
      if (player) player.pause();
      player = new Audio(url);
      player.play();
    });
  });
}

/* ============================================================
   INIT — runs on every lesson page
   ============================================================ */
function initLesson() {
  initParts();
  setupBlanks();
  setupCrossword();
  setupFreeWriting();
  setupChecklist();
  restoreMC();
  restoreMatching();
  restoreTap();
  restoreWords();
  setupAudio();
  setupRecorders();
  updateScoreBar();
}

document.addEventListener('DOMContentLoaded', initLesson);
