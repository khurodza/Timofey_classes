/* ============================================================
   Teacher desk (teacher.html)
   • Overview of all students, a dashboard per student, "new" badges
   • Live view of the page a student works on (smooth double-frame
     updates, the latest answer highlighted)
   • Marks (✓ / ✗) and comments on any answer — the student sees them
   • Reset a whole page or one task
   • A printable progress report in Russian (assets/curriculum.js +
     the teacher's own edits)
   Data lives in Firebase (see assets/sync.js and firebase-rules.json):
     students/<id>/pages/<page>   answers + progress, written by the student's page
     students/<id>/presence       which page is open right now
     students/<id>/notes/<page>   the teacher's marks and comments
     students/<id>/extras/<page>  extra tasks the teacher opened for the student ({ id: time })
     students/<id>/flashcards/<deck>  flashcard progress (known / still learning / Learn stage), written by the student's site
     teacher/seen/<id>/<page>     when the teacher last looked (for "new")
     teacher/reports/<id>/...     the teacher's edits of the report
     teacher/done/<id>/<page>     pages the teacher marked as done by hand (time)
   ============================================================ */
import CURRICULUM from './curriculum.js';
import { initSchedule } from './schedule.js';
import { initNotes } from './notes.js';

const TEACHER = 'nkomlyakova15@gmail.com';
const STUDENTS = [
  { id: 'timofey', name: 'Timofey', ru: 'Тимофей', female: false, site: '/Timofey_classes/', color: '#2D5DA8' },
  { id: 'polina',  name: 'Polina',  ru: 'Полина',  female: true,  site: '/Polina_classes/',  color: '#D9628F' },
  { id: 'matvey',  name: 'Matvey',  ru: 'Матвей',  female: false, site: '/Matvey_classes/',  color: '#A99A3C' },
  { id: 'ksyusha', name: 'Ksyusha', ru: 'Ксюша',   female: true,  site: '/Ksyusha_classes/', color: '#5F8FC9' }
];
const FIREBASE = {
  apiKey: 'AIzaSyAHX47UEkMuLtZS4LrxIKiFQtThG4beysQ',
  authDomain: 'english-classes-37405.firebaseapp.com',
  databaseURL: 'https://english-classes-37405-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'english-classes-37405',
  appId: '1:229340805566:web:df26380fbf8de9f152a1ef'
};
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const { initializeApp } = await import(SDK + 'firebase-app.js');
const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } = await import(SDK + 'firebase-auth.js');
const { getDatabase, ref, onValue, set, update, remove, push } = await import(SDK + 'firebase-database.js');
const app = initializeApp(FIREBASE), auth = getAuth(app), db = getDatabase(app);

/* ---------------- small helpers ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fbKey = s => encodeURIComponent(s).replace(/\./g, '%2E');           // Firebase keys can't contain . # $ [ ] /
const stu = id => STUDENTS.find(s => s.id === id);
const ago = t => { if (!t) return ''; const s = Math.round((Date.now() - t) / 1000);
  return s < 15 ? 'just now' : s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago'
    : s < 7 * 86400 ? Math.round(s / 86400) + ' d ago' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const ruDate = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const isLive = p => p && p.online && Date.now() - p.at < 6 * 3600e3;
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }
function avatar(s, cls = '', withDot = true) {
  return `<span class="avatar ${cls}" style="--c:${s.color}">${s.name[0]}${withDot ? `<i class="dot ${isLive(presence[s.id]) ? 'live' : ''}"></i>` : ''}</span>`;
}

/* ---------------- state ---------------- */
const presence = {}, pages = {}, seen = {}, notes = {}, extras = {}, reports = {}, siteLists = {}, tracking = {}, markedDone = {};
const flash = {}, deckLists = {}, openDecks = new Set();   // flashcard progress + each site's decks.js
STUDENTS.forEach(s => { pages[s.id] = {}; seen[s.id] = {}; notes[s.id] = {}; extras[s.id] = {}; reports[s.id] = {}; markedDone[s.id] = {}; });
let route = { view: 'overview' };

/* ---------------- sign-in ---------------- */
$('in').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => { $('err').textContent = e.message; });
$('out').onclick = () => signOut(auth);
onAuthStateChanged(auth, user => {
  const ok = user && !user.isAnonymous && (user.email || '').toLowerCase() === TEACHER;
  $('signin').hidden = !!ok; $('app').hidden = !ok;
  $('err').textContent = user && !user.isAnonymous && !ok ? 'This Google account is not the teacher account.' : '';
  if (ok) { $('who').textContent = user.email; start(); }
});

let started = false;
const ctx = { db, ref, onValue, set, remove, push, STUDENTS, $, esc, toast,
  pageList: sid => pageList(sid), go: h => go(h), route: () => route, onChange: () => refresh() };
function start() {
  if (started) return; started = true;
  initNotes(ctx);              // notes about each student (assets/notes.js)
  initSchedule(ctx);           // schedule (assets/schedule.js)
  $('today').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  STUDENTS.forEach(s => {
    onValue(ref(db, `students/${s.id}/presence`), snap => { presence[s.id] = snap.val(); refresh(); followStudent(s.id); });
    onValue(ref(db, `students/${s.id}/pages`), snap => { pages[s.id] = snap.val() || {}; refresh(); viewerDataChanged(s.id); });
    onValue(ref(db, `students/${s.id}/notes`), snap => { notes[s.id] = snap.val() || {}; refresh(); viewerNotesChanged(s.id); });
    onValue(ref(db, `students/${s.id}/extras`), snap => { extras[s.id] = snap.val() || {}; viewerExtrasChanged(s.id); });
    onValue(ref(db, `students/${s.id}/flashcards`), snap => { flash[s.id] = snap.val() || {}; if (Object.keys(flash[s.id]).length) loadDecks(s); refresh(); });
    onValue(ref(db, `teacher/seen/${s.id}`), snap => { seen[s.id] = snap.val() || {}; refresh(); });
    onValue(ref(db, `teacher/reports/${s.id}`), snap => { reports[s.id] = snap.val() || {}; if (route.view === 'report' && route.s === s.id && !reportEditing) renderReport(); });
    onValue(ref(db, `teacher/done/${s.id}`), snap => { markedDone[s.id] = snap.val() || {}; refresh(); });
    onValue(ref(db, `teacher/tracking/${s.id}`), snap => { tracking[s.id] = snap.val(); initTracking(s.id); refresh(); });
    loadSiteList(s).then(() => { initTracking(s.id); refresh(); });
  });
  window.addEventListener('hashchange', readHash);
  readHash();
  setInterval(refresh, 30000);              // keep "5 min ago" fresh
}

/* ---------------- each site's list of pages (from its home page) ---------------- */
async function fetchTitle(path) {
  const k = 'title:' + path, c = sessionStorage.getItem(k);
  if (c) return c;
  try {
    const h = await (await fetch(path)).text();
    const t = (h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const title = new DOMParser().parseFromString(t, 'text/html').documentElement.textContent.trim();
    sessionStorage.setItem(k, title); return title;
  } catch (e) { return ''; }
}
async function loadSiteList(s) {
  const found = new Map();
  for (const index of ['index.html', 'homework.html']) {
    try {
      const res = await fetch(s.site + index); if (!res.ok) continue;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      doc.querySelectorAll('a[href]').forEach(a => {
        const url = new URL(a.getAttribute('href'), location.origin + s.site + index);
        if (!/\/(lessons|homework)\/[^/]+\.html$/.test(url.pathname) || /template/.test(url.pathname)) return;
        const page = url.pathname.split('/').pop().replace('.html', '');
        if (!found.has(page)) found.set(page, { page, path: url.pathname });
      });
    } catch (e) {}
  }
  const list = [...found.values()];
  await Promise.all(list.map(async p => { p.title = await fetchTitle(p.path); }));
  siteLists[s.id] = list;
}
function pageList(sid) {               // site pages + any page with saved answers, newest lesson first
  const m = new Map((siteLists[sid] || []).map(p => [p.page, { ...p }]));
  Object.entries(pages[sid]).forEach(([page, r]) => { if (!m.has(page)) m.set(page, { page, path: r.path, title: r.title }); else if (!m.get(page).title) m.get(page).title = r.title; });
  return [...m.values()].map(p => ({ ...p, rec: pages[sid][p.page], hw: /homework|^hw-/.test(p.path + p.page) }))
    .sort((a, b) => b.page.localeCompare(a.page, undefined, { numeric: true }));
}
const isNew = (sid, page) => { const r = pages[sid][page]; return !!(r && r.at > (seen[sid][page] || 0) && r.dev !== 'teacher'); };
const newCount = sid => Object.keys(pages[sid]).filter(p => isNew(sid, p) && isTracked(sid, p)).length;
// Counting starts at each student's newest lesson that existed when tracking began (and lessons after it);
// work saved before that moment isn't counted. teacher/tracking/<id> = { from: lesson number, since: time }
const pageNo = page => +((String(page).match(/\d+/) || [])[0] || 0);
function initTracking(sid) {
  if (tracking[sid] !== null || !siteLists[sid] || !siteLists[sid].length) return;   // already set, or not loaded yet
  const from = Math.max(...siteLists[sid].filter(p => !/homework|^hw-/.test(p.path + p.page)).map(p => pageNo(p.page)));
  tracking[sid] = { from, since: Date.now() };
  set(ref(db, `teacher/tracking/${sid}`), tracking[sid]);
}
const isTracked = (sid, page) => !!tracking[sid] && pageNo(page) >= tracking[sid].from;
const counts = (sid, rec) => !!(rec && tracking[sid] && rec.at >= tracking[sid].since);
function totals(sid) {
  let total = 0, answered = 0, right = 0, started = 0, pagesCounted = 0;
  pageList(sid).filter(p => isTracked(sid, p.page)).forEach(p => {
    pagesCounted++;
    const r = p.rec; if (!counts(sid, r) || !r.stats) return;
    total += r.stats.total; answered += r.stats.answered; right += r.stats.right; if (r.stats.answered) started++;
  });
  return { total, answered, right, started, pagesCounted };
}
const noteCount = (sid, page) => Object.values(notes[sid][page] || {}).length;
function bar(st) {
  if (!st || !st.total) return '<div class="bar"></div>';
  return `<div class="bar"><i class="r" style="width:${pct(st.right, st.total)}%"></i><i class="a" style="width:${pct(st.answered - st.right, st.total)}%"></i></div>`;
}
const shortTitle = t => String(t || '').replace(/^Lesson (\d+)\s*[–—-]\s*/i, 'L$1 · ').replace(/^Homework\s*[–—-]\s*/i, 'HW · ');

/* ---------------- routing: #/  #/s/<id>  #/s/<id>/live  #/s/<id>/report ---------------- */
function go(hash) { if (location.hash === hash) readHash(); else location.hash = hash; }
function readHash() {
  const [, top, sid, sub] = (location.hash || '#/').split('/');
  if (top === 's' && sid && stu(sid)) route = { view: sub === 'live' ? 'live' : sub === 'report' ? 'report' : 'dash', s: sid };
  else if (top === 'schedule') route = { view: 'schedule' };
  else if (top === 'notes') route = { view: 'notes', student: sid || null };
  else route = { view: 'overview' };
  ['overview', 'dash', 'view', 'report', 'schedule', 'notes'].forEach(v => $('v-' + v).hidden = v !== ({ overview: 'overview', dash: 'dash', live: 'view', report: 'report', schedule: 'schedule', notes: 'notes' })[route.view]);
  if (route.view === 'notes') ctx.renderNotes();
  if (route.view !== 'live') closeViewer();
  if (route.view === 'live') openLive(route.s);
  if (route.view === 'report') renderReport();
  refresh();
  document.querySelector('.main').scrollTop = 0;
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go === 'overview' ? '#/' : '#/' + b.dataset.go));

/* ---------------- sidebar ---------------- */
const side = $('side');
if (localStorage.getItem('teacher-side-mini') === '1') side.classList.add('mini');
$('collapse').onclick = () => { side.classList.toggle('mini'); localStorage.setItem('teacher-side-mini', side.classList.contains('mini') ? '1' : '0'); };

function refresh() {
  if (!started) return;
  // sidebar
  $('students').innerHTML = STUDENTS.map(s => {
    const p = presence[s.id], n = newCount(s.id);
    const status = isLive(p) ? '● ' + shortTitle(p.title || p.page) : p ? 'seen ' + ago(p.at) : 'not connected yet';
    return `<button class="stu ${route.s === s.id ? 'on' : ''}" data-s="${s.id}" title="${esc(s.name)}">${avatar(s)}
      <span class="meta hide-mini"><b>${esc(s.name)}</b><small>${esc(status)}</small></span>${n ? `<span class="badge-new">${n}</span>` : ''}</button>`;
  }).join('');
  $('students').querySelectorAll('.stu').forEach(b => b.onclick = () => go('#/s/' + b.dataset.s));
  document.querySelectorAll('.nav-item[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === route.view));
  if (route.view === 'schedule') ctx.renderSchedule();
  if (route.view === 'overview') ctx.renderUpNext($('upnext'));
  if (route.view === 'overview') renderOverview();
  if (route.view === 'dash') renderDash();
  if (route.view === 'live') renderViewerBar();
  if (route.view === 'report' && !reportEditing) renderReport();   // the lesson list and scores may arrive after the report was drawn
}

/* ---------------- overview ---------------- */
function renderOverview() {
  $('overview').innerHTML = STUDENTS.map(s => {
    const p = presence[s.id], t = totals(s.id), n = newCount(s.id);
    const where = isLive(p) && esc(shortTitle(p.title || p.page));
    const now = isLive(p) ? `<span class="pill live" title="${where}"><span class="pill-t">Online · ${where}</span></span>` : p ? `Last seen ${ago(p.at)}` : 'Not connected yet';
    return `<div class="s-card" style="--c:${s.color}">
      <div class="top">${avatar(s)}<div style="flex:1"><h2>${esc(s.name)}</h2><div class="now">${now}</div></div>${n ? `<span class="badge-new">${n} new</span>` : ''}</div>
      <div>${bar(t)}<div class="legend"><span>${t.answered} answers</span><span>${pct(t.right, t.answered)}% right</span></div></div>
      <div class="row"><button class="btn" data-dash="${s.id}">Dashboard</button><button class="btn primary" data-live="${s.id}">● Live</button></div>
    </div>`;
  }).join('');
  $('overview').querySelectorAll('[data-dash]').forEach(b => b.onclick = () => go('#/s/' + b.dataset.dash));
  $('overview').querySelectorAll('[data-live]').forEach(b => b.onclick = () => go('#/s/' + b.dataset.live + '/live'));
}

/* ---------------- flashcards: which words she knows ---------------- */
// the student's own decks.js gives the full word list (words she hasn't seen yet, translations)
async function loadDecks(s) {
  if (deckLists[s.id]) return;
  deckLists[s.id] = [];
  try {
    const w = {};
    new Function('window', await (await fetch(s.site + 'decks.js')).text())(w);
    deckLists[s.id] = w.DECKS || [];
    refresh();
  } catch (e) {}
}
function renderCards(s) {
  const data = flash[s.id] || {}, ids = Object.keys(data);
  if (!ids.length) return '';
  const decks = deckLists[s.id] || [];
  const deckCards = ids.map(id => {
    let st = {}; try { st = JSON.parse(data[id].json || '{}'); } catch (e) {}
    const known = st.known || {}, stage = st.stage || {};
    const deck = decks.find(d => d.id === id);
    const words = deck ? deck.cards : [...new Set([...Object.keys(known), ...Object.keys(stage)])].map(w => ({ w }));
    const chip = c => `<span class="fc-chip${stage[c.w] === 2 ? ' mastered' : ''}" title="${esc(c.t || '')}">${esc(c.w)}${stage[c.w] === 2 ? ' 🏆' : ''}</span>`;
    const yes = words.filter(c => known[c.w] === true), no = words.filter(c => known[c.w] === false), unseen = words.filter(c => known[c.w] === undefined);
    const mastered = words.filter(c => stage[c.w] === 2).length;
    const group = (cls, title, list) => list.length ? `<div class="fc-group ${cls}"><h4>${title} <span>${list.length}</span></h4><div class="fc-chips">${list.map(chip).join('')}</div></div>` : '';
    return { at: data[id].at || 0, html: `<details class="fc-deck" data-deck="${esc(id)}"${openDecks.has(s.id + id) ? ' open' : ''}>
      <summary><b>${esc(deck ? deck.name : id)}</b><span class="fc-sum"><span class="no">✗ ${no.length} still learning</span><span class="yes">✓ ${yes.length} know</span>${mastered ? `<span class="m">🏆 ${mastered} mastered</span>` : ''}${unseen.length ? `<span class="un">${unseen.length} not marked yet</span>` : ''}</span><span class="fc-at">🕑 ${ago(data[id].at)}</span></summary>
      ${group('no', '✗ Still learning', no)}${group('yes', '✓ Knows', yes)}${group('un', 'Not marked yet', unseen)}
    </details>` };
  }).sort((a, b) => b.at - a.at);
  return `<h2 class="group-title fc-title">🃏 Flashcards</h2><p class="fc-help">What she marks in Flashcards mode (✓ Know / ✗ Still learning); a wrong answer in Test moves a word back to “still learning”. 🏆 = mastered in Learn mode. Point at a word to see its translation.</p>${deckCards.map(d => d.html).join('')}`;
}

/* ---------------- one student's dashboard ---------------- */
function renderDash() {
  const s = stu(route.s), p = presence[s.id], t = totals(s.id), list = pageList(s.id);
  $('d-avatar').outerHTML = `<span id="d-avatar">${avatar(s, 'big', false)}</span>`;
  $('d-name').textContent = s.name;
  $('d-status').innerHTML = isLive(p) ? `<span class="pill live">Online now · ${esc(shortTitle(p.title || p.page))}</span>` : p ? 'Last seen ' + ago(p.at) : 'Not connected yet';
  // index cards: big number, label and a short note, all from counted work
  const allNotes = Object.values(notes[s.id]).flatMap(o => Object.values(o || {}));
  const marks = allNotes.filter(n => n.mark).length, comments = allNotes.filter(n => n.comment).length;
  const counted = list.filter(p => isTracked(s.id, p.page) && counts(s.id, p.rec));
  const lastAt = counted.length ? Math.max(...counted.map(p => p.rec.at)) : 0;
  const doing = counted.find(p => !markedDone[s.id][p.page] && p.rec.stats && p.rec.stats.answered && p.rec.stats.answered < p.rec.stats.total);
  const ix = (n, label, note, tape, rot) => `<div class="tile ix" style="--tape:${tape};--rot:${rot}deg"><b>${n}</b><span class="lab">${label}</span><span class="note">${note}</span></div>`;
  $('d-tiles').innerHTML =
    ix(`${t.started}<small> / ${t.pagesCounted}</small>`, 'pages worked on', doing ? esc(shortTitle(doing.title || doing.page)) + ' in progress' : t.started ? 'all started pages finished' : 'nothing started yet', 'var(--pink)', -1.6) +
    ix(t.answered, 'answers given', lastAt ? 'last answer ' + ago(lastAt) : 'none yet', 'var(--olive)', 1.2) +
    ix(t.answered ? pct(t.right, t.answered) + '%' : '—', 'right', t.answered ? `${t.right} of ${t.answered} answers` : 'nothing to check yet', 'var(--sky)', -0.8) +
    ix(marks + comments, 'marks &amp; comments', marks + comments ? `${marks} marks · ${comments} comments` : 'none yet', 'var(--sage)', 1.6);
  const card = (pg, i = 0) => {
    const r = counts(s.id, pg.rec) || !isTracked(s.id, pg.page) ? pg.rec : null;   // counted work only (older test answers ignored)
    const st = r && r.stats, nw = isNew(s.id, pg.page), nc = noteCount(s.id, pg.page);
    const info = !r ? 'Not opened yet' : st && st.total ? `${st.answered} / ${st.total} answered · ${st.right} right` : 'answers saved';
    const rot = [-1.2, 0.9, -0.6, 1.3, -0.9, 0.5][i % 6], md = markedDone[s.id][pg.page];
    const doneBtn = !isTracked(s.id, pg.page) ? '' : md ? `<button class="btn small ghost" data-undone="${esc(pg.page)}" title="Marked done by you ${ago(md)}">↩ Not done</button>`
      : stage(pg) !== 'done' ? `<button class="btn small ghost" data-done="${esc(pg.page)}">✓ Mark done</button>` : '';
    return `<div class="p-card ${nw ? 'is-new' : ''} ${r ? '' : 'untouched'}" style="--rot:${rot}deg">
      <div class="t"><b>${esc(pg.title || pg.page)}</b>${pg.hw ? '<span class="tag-hw">HW</span>' : ''}${md ? '<span class="tag-hw tag-done" title="Marked done by you">✓ BY YOU</span>' : ''}${nw ? '<span class="badge-new">NEW</span>' : ''}</div>
      ${r ? bar(st) : ''}
      <div class="sub"><span>${info}</span>${r ? `<span>🕑 ${ago(r.at)}</span>` : ''}${nc ? `<span>💬 ${nc}</span>` : ''}</div>
      <div class="acts">${doneBtn}${r ? `<button class="btn small ghost danger" data-reset="${esc(pg.page)}">↺ Reset</button>` : ''}<button class="btn small" data-open="${esc(pg.page)}" data-path="${esc(pg.path)}">Open →</button></div>
    </div>`;
  };
  // board: To do → In progress → Done, worked out from the counted answers (or marked done by hand)
  const stage = pg => {
    if (markedDone[s.id][pg.page]) return 'done';
    const r = counts(s.id, pg.rec) ? pg.rec : null, st = r && r.stats;
    if (!r || (st && !st.answered)) return 'todo';
    if (st && st.total && st.answered >= st.total) return 'done';
    return 'doing';
  };
  const now = list.filter(p => isTracked(s.id, p.page)).reverse(), earlier = list.filter(p => !isTracked(s.id, p.page));
  const col = (key, title) => { const items = now.filter(p => stage(p) === key);
    return `<div class="col col-${key}"><h3>${title}<span>${items.length}</span></h3>${items.map(card).join('') || '<p class="col-empty">—</p>'}</div>`; };
  $('d-pages').innerHTML = (now.length ? `<div class="board">${col('todo', 'To do')}${col('doing', 'In progress')}${col('done', 'Done')}</div>` : '')
    + (earlier.length ? `<details class="earlier"><summary class="group-title">Earlier lessons · not counted (${earlier.length})</summary><div class="pages">${earlier.map(card).join('')}</div></details>` : '')
    + (list.length ? '' : '<p class="empty">Loading the lessons…</p>');
  $('d-cards').innerHTML = renderCards(s);
  $('d-cards').querySelectorAll('.fc-deck').forEach(d => d.addEventListener('toggle', () => { d.open ? openDecks.add(s.id + d.dataset.deck) : openDecks.delete(s.id + d.dataset.deck); }));
  $('d-pages').querySelectorAll('[data-open]').forEach(b => b.onclick = () => { $('follow').checked = false; go('#/s/' + s.id + '/live'); showPage(s.id, b.dataset.open, b.dataset.path); });
  $('d-pages').querySelectorAll('[data-done]').forEach(b => b.onclick = () => set(ref(db, `teacher/done/${s.id}/${b.dataset.done}`), Date.now()).then(() => toast('Marked done')));
  $('d-pages').querySelectorAll('[data-undone]').forEach(b => b.onclick = () => remove(ref(db, `teacher/done/${s.id}/${b.dataset.undone}`)).then(() => toast('Back on the board')));
  $('d-pages').querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPage(s.id, b.dataset.reset));
  $('d-live').onclick = () => { $('follow').checked = true; go('#/s/' + s.id + '/live'); };
  $('d-fresh').onclick = () => startFresh(s.id);
  ctx.renderNextClass($('d-next'), s.id);
  $('d-report').onclick = () => go('#/s/' + s.id + '/report');
}

/* ---------------- live viewer (two frames: the new version loads behind, then swaps in) ---------------- */
const frames = [$('frame-a'), $('frame-b')];
let front = 0, viewing = null, loadToken = 0;   // viewing = { s, page, path, part, json }
window.__teacher = {                             // called from the page inside the frame (assets/sync.js)
  annotate: (anchor, label) => viewing && openNote(viewing.s, viewing.page, anchor, label),
  resetTask: (keys, title) => viewing && resetTask(viewing.s, viewing.page, keys, title),
  setExtra: (id, on) => viewing && setExtra(viewing.s, viewing.page, id, on)
};
// open / hide an extra task on the student's page (they see it at once)
function setExtra(sid, page, id, on) {
  const r = ref(db, `students/${sid}/extras/${page}/${id}`);
  (on ? set(r, Date.now()) : remove(r)).then(() => toast(on ? `Opened for ${stu(sid).name}` : `Hidden from ${stu(sid).name}`));
}
function viewerExtrasChanged(sid) {
  if (!viewing || viewing.s !== sid) return;
  try { frames[front].contentWindow.__watch.setExtras(extras[sid][viewing.page]); } catch (e) {}
}
function openLive(sid) {
  const p = presence[sid];
  if (viewing && viewing.s === sid) return renderViewerBar();
  if ($('follow').checked && isLive(p) && p.page) showPage(sid, p.page, p.path, p.part);
  else if (!viewing || viewing.s !== sid) { const last = pageList(sid).filter(x => x.rec).sort((a, b) => b.rec.at - a.rec.at)[0]; if (last) showPage(sid, last.page, last.path); else { viewing = { s: sid }; frames.forEach(f => f.hidden = true); $('v-empty').hidden = false; } }
  renderViewerBar();
}
// ✎ Notes: side panel next to the student's page (stays open between visits)
const notesPanel = $('v-notes-panel');
function liveNotes() { if (viewing && !notesPanel.hidden) ctx.renderLiveNotes(notesPanel, viewing.s); }
ctx.refreshLiveNotes = () => route.view === 'live' && liveNotes();
$('v-notes-btn').onclick = () => {
  notesPanel.hidden = !notesPanel.hidden;
  $('v-notes-btn').classList.toggle('on', !notesPanel.hidden);
  try { localStorage.setItem('teacher-live-notes', notesPanel.hidden ? '0' : '1'); } catch (e) {}
  liveNotes();
  if (!notesPanel.hidden) setTimeout(() => { const i = $('ln-text'); if (i) i.focus(); }, 50);
};
try { if (localStorage.getItem('teacher-live-notes') === '1') { notesPanel.hidden = false; $('v-notes-btn').classList.add('on'); } } catch (e) {}
function closeViewer() { viewing = null; frames.forEach(f => { f.hidden = true; f.removeAttribute('src'); }); }
function renderViewerBar() {
  if (!viewing) return;
  const s = stu(viewing.s), p = presence[s.id], r = viewing.page && pages[s.id][viewing.page];
  $('v-avatar').outerHTML = `<span class="avatar small" id="v-avatar" style="--c:${s.color}">${s.name[0]}</span>`;
  $('v-title').textContent = s.name + (viewing.page ? ' · ' + ((r && r.title) || (pageList(s.id).find(x => x.page === viewing.page) || {}).title || viewing.page) : '');
  const here = isLive(p) && p.page === viewing.page;
  $('v-live').className = 'pill ' + (here ? 'live' : '');
  $('v-live').textContent = here ? 'on this page now' : isLive(p) ? 'online · elsewhere' : p ? 'offline · ' + ago(p.at) : 'offline';
  $('v-reset').hidden = !r;
  liveNotes();
}
function storeAnswers(sid, page) {
  const r = pages[sid][page], key = (r && r.key) || 'answers-' + page;
  sessionStorage.setItem(`watch-${sid}-${key}`, r ? r.json : '{}');
}
function showPage(sid, page, path, part, highlight) {
  const s = stu(sid);
  // prefer the path from the student's own site list; a saved path can come from a local copy of the site (→ 404)
  const listed = (siteLists[sid] || []).find(x => x.page === page);
  path = (listed && listed.path) || path || (pages[sid][page] || {}).path;
  if (!path || !path.startsWith(s.site)) return;
  const samePage = viewing && viewing.s === sid && viewing.page === page;
  viewing = { s: sid, page, path, part: part || null, json: (pages[sid][page] || {}).json };
  storeAnswers(sid, page);
  markSeen(sid, page);
  $('v-empty').hidden = true;
  const token = ++loadToken;
  // "&v=" makes every load a real reload: with only a "#tab" change the browser would just jump inside the old copy
  const url = path + '?watch=' + sid + '&name=' + encodeURIComponent(s.name) + ($('check').checked ? '&check=1' : '') + '&v=' + token + (part ? '#' + part : '');
  const vis = frames[front], back = frames[1 - front];
  let y = 0; try { if (samePage && !vis.hidden) y = vis.contentWindow.scrollY; } catch (e) {}
  back.hidden = false; back.classList.add('back');
  back.src = url;
  const t0 = Date.now();
  const wait = setInterval(() => {
    if (token !== loadToken) return clearInterval(wait);
    let w; try { w = back.contentWindow; } catch (e) {}
    let fresh = false; try { fresh = new URLSearchParams(w.location.search).get('v') === String(token); } catch (e) {}   // not the previous copy still sitting in this frame
    const ready = fresh && w.__watch && w.__watch.ready;
    if (!ready && Date.now() - t0 < 6000) return;
    clearInterval(wait);
    try {
      if (y) w.scrollTo(0, y);
      w.__watch.setNotes(notes[sid][page]);
      if (w.__watch.setExtras) w.__watch.setExtras(extras[sid][page]);
      if (highlight && highlight.length && w.__watch.highlight(highlight) && !samePage) w.__watch.scrollToLatest();
    } catch (e) {}
    back.classList.remove('back'); vis.classList.add('back');
    front = 1 - front;
    setTimeout(() => { if (token === loadToken) { vis.hidden = true; vis.classList.remove('back'); } }, 220);
  }, 60);
  renderViewerBar();
}
function viewerDataChanged(sid) {
  if (!viewing || viewing.s !== sid || !viewing.page) return;
  const r = pages[sid][viewing.page];
  if (!r || r.json === viewing.json) return renderViewerBar();
  // first try to change the answers on the open page in place; reload in the background only if that isn't possible
  let w; try { w = frames[front].contentWindow; } catch (e) {}
  let done = false; try { done = !!(w && w.__watch && w.__watch.ready && w.__watch.apply(r.json)); } catch (e) {}
  if (!done) return showPage(sid, viewing.page, viewing.path, viewing.part, r.dev === 'teacher' ? null : r.changed);
  viewing.json = r.json;
  storeAnswers(sid, viewing.page);
  markSeen(sid, viewing.page);
  try { if (r.dev !== 'teacher' && r.changed) w.__watch.highlight(r.changed); w.__watch.setNotes(notes[sid][viewing.page]); } catch (e) {}
  renderViewerBar();
}
function viewerNotesChanged(sid) {
  if (!viewing || viewing.s !== sid) return;
  try { frames[front].contentWindow.__watch.setNotes(notes[sid][viewing.page]); } catch (e) {}
}
function followStudent(sid) {
  if (route.view !== 'live' || !viewing || viewing.s !== sid || !$('follow').checked) return renderViewerBar();
  const p = presence[sid];
  if (isLive(p) && p.page && (p.page !== viewing.page || (p.part || null) !== viewing.part)) showPage(sid, p.page, p.path, p.part);
  else renderViewerBar();
}
function markSeen(sid, page) {
  const r = pages[sid][page];
  if (r && r.at > (seen[sid][page] || 0)) set(ref(db, `teacher/seen/${sid}/${page}`), r.at);
}
$('v-back').onclick = () => go('#/s/' + (viewing ? viewing.s : route.s));
$('check').onchange = () => viewing && viewing.page && showPage(viewing.s, viewing.page, viewing.path, viewing.part);
$('follow').onchange = () => viewing && followStudent(viewing.s);
$('v-latest').onclick = () => { try { frames[front].contentWindow.__watch.scrollToLatest(); } catch (e) {} };
$('v-reset').onclick = () => viewing && resetPage(viewing.s, viewing.page);

/* ---------------- marks & comments ---------------- */
let noteCtx = null;
function openNote(sid, page, anchor, label) {
  const cur = (notes[sid][page] || {})[fbKey(anchor)] || {};
  noteCtx = { sid, page, anchor };
  $('note-answer').textContent = label || '';
  document.querySelectorAll('#note-dlg input[name=mark]').forEach(i => { i.checked = (i.value === (cur.mark || '')); });
  $('note-text').value = cur.comment || '';
  $('note-del').hidden = !cur.anchor;
  $('note-dlg').showModal();
  setTimeout(() => $('note-text').focus(), 50);
}
$('note-dlg').addEventListener('close', () => {
  const v = $('note-dlg').returnValue, c = noteCtx; noteCtx = null;
  if (!c) return;
  const path = `students/${c.sid}/notes/${c.page}/${fbKey(c.anchor)}`;
  if (v === 'delete') { remove(ref(db, path)); toast('Removed'); return; }
  if (v !== 'save') return;
  const mark = (document.querySelector('#note-dlg input[name=mark]:checked') || {}).value || '';
  const comment = $('note-text').value.trim();
  if (!mark && !comment) { remove(ref(db, path)); return; }
  set(ref(db, path), { anchor: c.anchor, mark, comment, at: Date.now() }).then(() => toast('Saved — the student sees it now'));
});

/* ---------------- resets ---------------- */
// clear a student's progress: answers, counts, NEW badges and marks. Old answers still saved on the
// student's own device are not counted again (sync.js skips anything older than resetAt).
function startFresh(sid) {
  const s = stu(sid);
  if (!confirm(`Start fresh for ${s.name}?\n\nThis clears ${s.name}’s answers, progress counts, NEW badges and your marks and comments on every page. Only work done from now on will count. This can’t be undone.`)) return;
  Promise.all([
    remove(ref(db, `students/${sid}/pages`)),
    remove(ref(db, `students/${sid}/notes`)),
    remove(ref(db, `teacher/seen/${sid}`)),
    remove(ref(db, `teacher/done/${sid}`)),
    set(ref(db, `students/${sid}/resetAt`), Date.now()),
    tracking[sid] && set(ref(db, `teacher/tracking/${sid}/since`), Date.now())
  ]).then(() => toast(`${s.name} starts fresh`));
}
function resetPage(sid, page) {
  const r = pages[sid][page], s = stu(sid);
  if (!r || !confirm(`Clear all of ${s.name}’s answers on “${r.title || page}”?\nYour marks and comments on this page are removed too. This can’t be undone.`)) return;
  set(ref(db, `students/${sid}/pages/${page}`), { json: '{}', key: r.key || 'answers-' + page, at: Date.now(), path: r.path, title: r.title || page, dev: 'teacher' });
  remove(ref(db, `students/${sid}/notes/${page}`));
  toast('Page reset');
}
function resetTask(sid, page, keys, title) {
  const r = pages[sid][page];
  if (!r) return toast('Nothing saved on this page yet');
  let data = {}; try { data = JSON.parse(r.json || '{}'); } catch (e) {}
  const hit = keys.filter(k => k in data);
  if (!hit.length) return toast('Nothing to reset in this task');
  if (!confirm(`Clear ${stu(sid).name}’s answers in this task${title ? ` (“${title}”)` : ''}?`)) return;
  hit.forEach(k => delete data[k]);
  set(ref(db, `students/${sid}/pages/${page}`), { json: JSON.stringify(data), key: r.key || 'answers-' + page, at: Date.now(), path: r.path, title: r.title || page, dev: 'teacher' });
  const gone = new Set(keys.map(fbKey)), n = notes[sid][page] || {};
  Object.keys(n).forEach(k => { if (gone.has(k)) remove(ref(db, `students/${sid}/notes/${page}/${k}`)); });
  toast('Task reset');
}

/* ---------------- progress report (Russian) ---------------- */
let reportEditing = false;
function reportPages(sid) {
  const base = CURRICULUM[sid] || {}, edits = reports[sid] || {};
  return pageList(sid).slice().reverse()                    // oldest lesson first
    .map(p => {
      const c = base[p.page] || {}, e = edits[p.page] || {};
      return { ...p, skip: !!e.skip, title: e.title ?? c.title ?? p.title ?? p.page,
        topics: e.topics ?? (c.topics || []).join('; '), skills: e.skills ?? (c.skills || []).join('; ') };
    });
}
// **word** in the summaries = a highlighted key word (Cmd+B while editing does the same)
const hl = text => esc(text).replace(/\*\*(.+?)\*\*/g, '<b class="hl">$1</b>');
function unhl(el) {                    // back from the edited text to "**word**" form
  let out = '';
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) out += n.textContent;
    else if (/^(B|STRONG)$/.test(n.nodeName) || (n.classList && n.classList.contains('hl'))) out += '**' + n.textContent + '**';
    else if (n.nodeName === 'BR') out += ' ';
    else out += unhl(n);
  });
  return out.replace(/\*\*\s*\*\*/g, '').replace(/\s+/g, ' ');
}
function renderReport() {
  const s = stu(route.s), sid = s.id, meta = (reports[sid] || {})._meta || {};
  const list = reportPages(sid), shown = list.filter(p => !p.skip);
  const recs = Object.values(pages[sid]);
  const firstAt = recs.length ? Math.min(...recs.map(r => r.at)) : Date.now();
  const skills = [...new Set(shown.flatMap(p => p.skills.split(';').map(x => x.trim()).filter(Boolean)))];
  $('r-heading').textContent = s.name + ' — report';
  const ed = (field, text, cls = '', tag = 'span', rich = false) =>
    `<${tag} class="${cls}" contenteditable="true" data-field="${field}"${rich ? ' data-rich="1"' : ''}>${rich ? hl(text) : esc(text)}</${tag}>`;
  $('report').innerHTML = `
    <div class="r-top">
      <div><p class="eyebrow">Английский язык</p><h1>Отчёт об успехах</h1><div style="font:800 24px/1.3 var(--ru-head);margin-top:6px;color:var(--pink-2)">${esc(s.ru)}</div></div>
      <div class="r-meta">Дата: ${ruDate(Date.now())}<br>Период: ${ed('_meta.period', meta.period || 'с ' + ruDate(firstAt) + ' по ' + ruDate(Date.now()))}<br><span class="r-count">Пройдено уроков: <b>${shown.length}</b></span></div>
    </div>
    <h2>Чему ${s.female ? 'научилась' : 'научился'} ${esc(s.ru)}</h2>
    <ul class="r-skills">${skills.map(x => `<li>${hl(x)}</li>`).join('') || '<li>—</li>'}</ul>
    <h2>Пройденные темы</h2>
    ${shown.map(p => `<div class="r-lesson"><button class="r-skip no-print" data-skip="${esc(p.page)}" title="Убрать из отчёта">✕ убрать</button>
        <div class="r-h">${ed(p.page + '.title', p.title, '', 'h3')}</div>
        <div class="r-lines"><span>Темы</span>${ed(p.page + '.topics', p.topics, 'r-topics', 'span', true)}<span>Умения</span>${ed(p.page + '.skills', p.skills, '', 'span', true)}</div></div>`).join('')}
    ${list.some(p => p.skip) ? `<p class="no-print" style="color:var(--muted);font-size:13px">Убрано из отчёта: ${list.filter(p => p.skip).map(p => `<a href="#" data-unskip="${esc(p.page)}">${esc(p.title)}</a>`).join(', ')}</p>` : ''}
    <p class="no-print r-tip">Совет: выделите слово и нажмите <b>⌘ + B</b> (Ctrl + B), чтобы подсветить его.</p>
    <h2>Комментарий преподавателя</h2>
    ${ed('_meta.comment', meta.comment || '', 'r-comment', 'div')}`;
  $('report').querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('focus', () => { reportEditing = true; });
    el.addEventListener('blur', () => {
      reportEditing = false;
      const [page, field] = el.dataset.field.split('.');
      const value = el.dataset.rich ? unhl(el).trim() : el.innerText.trim();
      set(ref(db, `teacher/reports/${sid}/${page}/${field}`), value).then(() => toast('Saved'));
    });
  });
  $('report').querySelectorAll('[data-skip]').forEach(b => b.onclick = () => set(ref(db, `teacher/reports/${sid}/${b.dataset.skip}/skip`), true));
  $('report').querySelectorAll('[data-unskip]').forEach(a => a.onclick = e => { e.preventDefault(); remove(ref(db, `teacher/reports/${sid}/${a.dataset.unskip}/skip`)); });
}
$('r-back').onclick = () => go('#/s/' + route.s);
$('r-print').onclick = () => window.print();
