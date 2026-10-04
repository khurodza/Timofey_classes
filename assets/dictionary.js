/* ============================================================
   My Dictionary — the student's personal word list.
   Loaded by every page. On lesson / homework / home pages it adds a
   floating "+ Word" button (select a word in the text first and it
   is filled in). On dictionary.html it also draws the full list.

   Words live in a Google Sheet (see GUIDE.md → "My Dictionary").
   A copy is kept in localStorage, so the list shows instantly and
   words added offline are sent the next time the site is online.

   Pronunciation: a recording from lessons/audio/words/ if there is
   one, else a real recording from dictionaryapi.dev (single words
   only), else the browser's own English voice.
   ============================================================ */
(function () {
  /* ---- settings ---- */
  const API = 'https://script.google.com/macros/s/AKfycby_7NBmrIFDhg0Sury5GiKOc9QcFqJV5dTpSgvnOG38iqXuc1bgjBSJbWHbJt5KY2D9bg/exec';
  const KEY = 'LKJZyy7CDAFsEJ4XoE9o6oKUGlv-eQuF';   // must match SECRET in the Apps Script
  const LANG = 'de';                                       // translate into German
  const LANG_NAME = 'German';

  const CACHE_KEY = 'dictionary-words';
  const QUEUE_KEY = 'dictionary-queue';
  const AUDIO_KEY = 'dictionary-audio';

  const WORDS_AUDIO = (() => {
    const s = document.currentScript && document.currentScript.src;
    return s ? new URL('../lessons/audio/words/', s).href : 'lessons/audio/words/';
  })();

  /* ---- localStorage helpers ---- */
  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  let words = readJSON(CACHE_KEY, []);
  let queue = readJSON(QUEUE_KEY, []);
  let status = 'idle';   // idle | syncing | saved | offline
  const listeners = [];

  function changed() {
    writeJSON(CACHE_KEY, words);
    writeJSON(QUEUE_KEY, queue);
    listeners.forEach(fn => fn());
  }
  function setStatus(s) { status = s; listeners.forEach(fn => fn()); }

  function clean(w) {
    return {
      id: String(w.id || ''),
      word: String(w.word || '').trim(),
      translation: String(w.translation || '').trim(),
      note: String(w.note || '').trim(),
      added: w.added ? String(w.added) : ''
    };
  }

  /* ---- talking to the Google Sheet ---- */
  async function post(body) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },   // avoids a CORS preflight Apps Script can't answer
      body: JSON.stringify(Object.assign({ key: KEY }, body))
    });
    const res = await r.json();
    if (res.error) throw new Error(res.error);
  }

  async function flush() {
    while (queue.length) {
      await post(queue[0]);
      queue.shift();
      writeJSON(QUEUE_KEY, queue);
    }
  }

  let syncing = null;
  function sync() {
    if (syncing) return syncing;
    setStatus('syncing');
    syncing = (async () => {
      try {
        await flush();
        const r = await fetch(API + '?key=' + encodeURIComponent(KEY));
        const res = await r.json();
        if (res.error) throw new Error(res.error);
        // sheet headers may carry stray spaces or capitals ("Translation ") — normalise them
        const tidy = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
        words = res.words.map(tidy).map(clean).filter(w => w.word);
        changed();
        setStatus('saved');
      } catch (e) {
        setStatus('offline');
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  function find(word) {
    const w = word.trim().toLowerCase();
    return words.find(x => x.word.toLowerCase() === w);
  }

  function add(word, translation, note) {
    const w = clean({
      id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)),
      word: word.replace(/^=+/, ''),   // a leading "=" would turn into a formula in the sheet
      translation: translation.replace(/^=+/, ''),
      note: (note || '').replace(/^=+/, ''),
      added: new Date().toISOString()
    });
    words.push(w);
    queue.push({ action: 'add', word: w });
    changed();
    sync();
    return w;
  }

  function remove(id) {
    if (!id) return;
    words = words.filter(w => w.id !== id);
    const i = queue.findIndex(q => q.action === 'add' && q.word.id === id);
    if (i >= 0) queue.splice(i, 1);        // never reached the sheet — just forget it
    else queue.push({ action: 'delete', id });
    changed();
    sync();
  }

  /* ---- translation suggestions (MyMemory, free, no key) ---- */
  async function suggest(text) {
    const url = 'https://api.mymemory.translated.net/get?langpair=en|' + LANG + '&q=' + encodeURIComponent(text);
    const res = await (await fetch(url)).json();
    const out = [];
    const push = t => {
      t = String(t || '').trim();
      if (t && !/MYMEMORY|QUERY LENGTH/i.test(t) && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t);
    };
    push(res.responseData && res.responseData.translatedText);
    (res.matches || []).sort((a, b) => b.match - a.match).forEach(m => push(m.translation));
    return out.slice(0, 4);
  }

  /* ---- pronunciation ---- */
  const audioUrls = readJSON(AUDIO_KEY, {});   // word → recording URL ('' = none found)
  let current = null, currentBtn = null, playToken = 0;

  function stop() {
    playToken++;
    if (current) { current.pause(); current = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (currentBtn) currentBtn.classList.remove('playing');
    currentBtn = null;
  }

  function fileName(text) {
    return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function tts(text, done) {
    if (!window.speechSynthesis) { done(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const v = voices.find(v => v.lang === 'en-GB') || voices.find(v => /^en/.test(v.lang));
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'en-GB';
    u.rate = 0.85;
    u.onend = u.onerror = done;
    speechSynthesis.speak(u);
  }

  async function onlineRecording(text) {
    const w = text.trim().toLowerCase();
    if (!/^[a-z][a-z'-]*$/.test(w)) return '';   // phrases: no recordings exist
    if (w in audioUrls) return audioUrls[w];
    let url = '';
    try {
      const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w));
      if (r.ok) {
        const all = (await r.json()).flatMap(e => e.phonetics || []).map(p => p.audio).filter(Boolean);
        url = all.find(a => /-uk\.mp3$/.test(a)) || all[0] || '';
      }
    } catch (e) { return ''; }   // offline: don't remember "no recording"
    audioUrls[w] = url;
    writeJSON(AUDIO_KEY, audioUrls);
    return url;
  }

  function playUrl(url) {
    return new Promise((resolve, reject) => {
      const a = new Audio(url);
      current = a;
      a.onended = () => resolve(true);
      a.onerror = () => reject();
      a.play().catch(reject);
    });
  }

  async function speak(text, btn) {
    const same = btn && currentBtn === btn;
    stop();
    if (same || !text.trim()) return;
    if (window.sayStop) window.sayStop();   // lesson sound buttons (lessons.js)
    const mine = playToken;   // a newer speak() or stop() changes playToken
    currentBtn = btn || null;
    if (btn) btn.classList.add('playing');
    const done = () => { if (btn) btn.classList.remove('playing'); if (currentBtn === btn) currentBtn = null; };
    const tryUrl = async url => {
      if (!url || mine !== playToken) return false;
      try { await playUrl(url); return true; } catch (e) { return false; }
    };
    if (await tryUrl(WORDS_AUDIO + fileName(text) + '.m4a')) { done(); return; }
    const online = await onlineRecording(text);
    if (mine !== playToken) return;
    if (await tryUrl(online)) { done(); return; }
    if (mine !== playToken) return;
    tts(text, done);
  }

  /* ---- small message at the bottom of the screen ---- */
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

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ============================================================
     ADD-WORD FORM — used both in the pop-up window and on
     dictionary.html. Fills `box` with the fields and buttons.
     ============================================================ */
  function buildForm(box, opts) {
    box.innerHTML =
      '<label class="dict-field"><span>English word or phrase</span>' +
        '<span class="dict-input-row"><input type="text" name="word" maxlength="80" autocomplete="off" placeholder="e.g. take off">' +
        '<button type="button" class="say say-big dict-listen" aria-label="Listen"></button></span></label>' +
      '<label class="dict-field"><span>' + LANG_NAME + '</span>' +
        '<span class="dict-input-row"><input type="text" name="translation" maxlength="120" autocomplete="off" placeholder="Translation">' +
        '<button type="button" class="btn-ghost dict-suggest">Suggest</button></span></label>' +
      '<div class="dict-suggestions" hidden></div>' +
      '<label class="dict-field"><span>Note <i>(optional)</i></span>' +
        '<input type="text" name="note" maxlength="120" autocomplete="off" placeholder="e.g. Lesson 3, the plane takes off"></label>' +
      '<p class="dict-msg" aria-live="polite"></p>' +
      '<div class="btn-row"><button type="submit" class="btn-primary">+ Add to my dictionary</button></div>';

    const form = box.closest('form');
    const word = box.querySelector('[name=word]');
    const tr = box.querySelector('[name=translation]');
    const note = box.querySelector('[name=note]');
    const msg = box.querySelector('.dict-msg');
    const sug = box.querySelector('.dict-suggestions');
    const sugBtn = box.querySelector('.dict-suggest');

    if (opts.word) word.value = opts.word;

    box.querySelector('.dict-listen').addEventListener('click', e => speak(word.value, e.currentTarget));

    const checkDuplicate = () => {
      const old = find(word.value);
      msg.className = 'dict-msg' + (old ? ' warn' : '');
      msg.textContent = old ? 'Already in your dictionary: ' + old.word + ' = ' + old.translation : '';
    };
    word.addEventListener('input', () => { sug.hidden = true; checkDuplicate(); });
    checkDuplicate();

    sugBtn.addEventListener('click', async () => {
      const text = word.value.trim();
      if (!text) { word.focus(); return; }
      sugBtn.disabled = true;
      sugBtn.textContent = '…';
      try {
        const list = await suggest(text);
        sug.innerHTML = '';
        if (!list.length) throw new Error();
        sug.appendChild(el('span', 'dict-sug-label', 'Tap one:'));
        list.forEach(t => {
          const b = el('button', 'word-choice-btn', t);
          b.type = 'button';
          b.addEventListener('click', () => { tr.value = t; sug.hidden = true; tr.focus(); });
          sug.appendChild(b);
        });
        if (!tr.value) tr.value = list[0];
        sug.hidden = false;
      } catch (e) {
        msg.className = 'dict-msg warn';
        msg.textContent = 'No suggestion right now. Type the translation yourself.';
      }
      sugBtn.disabled = false;
      sugBtn.textContent = 'Suggest';
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const missing = !word.value.trim() ? word : !tr.value.trim() ? tr : null;
      if (missing) {
        missing.classList.remove('shake'); void missing.offsetWidth; missing.classList.add('shake');
        missing.focus();
        return;
      }
      const w = add(word.value, tr.value, note.value);
      toast('Added: ' + w.word);
      form.reset();
      sug.hidden = true;
      msg.textContent = '';
      if (opts.onAdded) opts.onAdded(w);
      else word.focus();
    });

    return { word, tr };
  }

  /* ============================================================
     FLOATING "+ Word" BUTTON + pop-up window (all other pages)
     ============================================================ */
  function dictionaryHref() {
    const s = document.currentScript || document.querySelector('script[src*="dictionary.js"]');
    return s ? new URL('../dictionary.html', s.src).href : 'dictionary.html';
  }
  const DICT_HREF = dictionaryHref();

  function openDialog(prefill) {
    const overlay = el('div', 'name-overlay dict-overlay');
    overlay.innerHTML =
      '<form class="name-dialog dict-dialog" role="dialog" aria-modal="true" aria-labelledby="dictDlgTitle">' +
        '<button type="button" class="dict-close" aria-label="Close">×</button>' +
        '<h2 id="dictDlgTitle">📖 New word</h2>' +
        '<div class="dict-form"></div>' +
        '<a class="dict-open-link" href="' + DICT_HREF + '">Open my dictionary →</a>' +
      '</form>';
    document.body.appendChild(overlay);
    document.body.classList.add('name-open');

    const close = () => {
      stop();
      overlay.classList.add('closing');
      document.body.classList.remove('name-open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 220);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.dict-close').addEventListener('click', close);

    const f = buildForm(overlay.querySelector('.dict-form'), { word: prefill, onAdded: close });
    setTimeout(() => (prefill ? f.tr : f.word).focus(), 50);
  }

  function addFloatingButton() {
    const fab = el('button', 'dict-fab', '+ Word');
    fab.type = 'button';
    fab.title = 'Add a word to my dictionary (select a word in the text first)';
    let picked = '';
    // read the selection before the tap clears it
    fab.addEventListener('pointerdown', () => {
      picked = String(window.getSelection() || '').trim().replace(/\s+/g, ' ');
      if (picked.length > 80) picked = '';
    });
    fab.addEventListener('click', () => { openDialog(picked); picked = ''; });
    document.body.appendChild(fab);
  }

  /* ============================================================
     DICTIONARY PAGE (dictionary.html, element #dictPage)
     ============================================================ */
  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function setupPage(page) {
    buildForm(page.querySelector('.dict-form'), {});
    const list = page.querySelector('.dict-list');
    const search = page.querySelector('.dict-search');
    const count = page.querySelector('.dict-count');
    const state = page.querySelector('.dict-status');

    const STATUS = {
      idle: '',
      syncing: '⟳ Saving…',
      saved: '☁️ Saved in the cloud',
      offline: '⚠️ No connection — your words are safe on this device and will be saved later'
    };

    function render() {
      state.textContent = queue.length && status !== 'syncing' ? STATUS.offline : STATUS[status];
      state.className = 'dict-status ' + status;
      const q = search.value.trim().toLowerCase();
      const shown = words
        .filter(w => !q || (w.word + ' ' + w.translation + ' ' + w.note).toLowerCase().includes(q))
        .sort((a, b) => String(b.added).localeCompare(String(a.added)));
      count.textContent = words.length === 1 ? '1 word' : words.length + ' words';
      list.innerHTML = '';
      if (!shown.length) {
        list.appendChild(el('p', 'empty-note', words.length ? 'Nothing found.' : 'Your dictionary is empty. Add your first word above!'));
        return;
      }
      shown.forEach(w => {
        const row = el('div', 'dict-item');
        const play = el('button', 'say say-big');
        play.type = 'button';
        play.setAttribute('aria-label', 'Listen: ' + w.word);
        play.addEventListener('click', () => speak(w.word, play));
        const text = el('div', 'dict-text');
        text.appendChild(el('span', 'dict-word', w.word));
        text.appendChild(el('span', 'dict-tr', w.translation));
        if (w.note) text.appendChild(el('span', 'dict-note', w.note));
        const side = el('div', 'dict-side');
        side.appendChild(el('span', 'dict-date', formatDate(w.added)));
        if (w.id) {
          const del = el('button', 'dict-del', '×');
          del.type = 'button';
          del.setAttribute('aria-label', 'Delete ' + w.word);
          del.addEventListener('click', () => {
            if (confirm('Delete “' + w.word + '” from your dictionary?')) remove(w.id);
          });
          side.appendChild(del);
        }
        row.append(play, text, side);
        list.appendChild(row);
      });
    }

    listeners.push(render);
    search.addEventListener('input', render);
    render();
  }

  /* ---- public API ---- */
  window.Dictionary = { add, remove, sync, speak, open: openDialog, get words() { return words.slice(); } };

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('dictPage');
    if (page) setupPage(page);
    else addFloatingButton();
    sync();
  });
  window.addEventListener('online', () => sync());
})();
