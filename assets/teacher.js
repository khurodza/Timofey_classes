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
     teacher/seen/<id>/<page>     when the teacher last looked (for "new")
     teacher/reports/<id>/...     the teacher's edits of the report
   ============================================================ */
import CURRICULUM from './curriculum.js';

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
const { getDatabase, ref, onValue, set, update, remove } = await import(SDK + 'firebase-database.js');
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
const presence = {}, pages = {}, seen = {}, notes = {}, reports = {}, siteLists = {};
STUDENTS.forEach(s => { pages[s.id] = {}; seen[s.id] = {}; notes[s.id] = {}; reports[s.id] = {}; });
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
function start() {
  if (started) return; started = true;
  $('today').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  STUDENTS.forEach(s => {
    onValue(ref(db, `students/${s.id}/presence`), snap => { presence[s.id] = snap.val(); refresh(); followStudent(s.id); });
    onValue(ref(db, `students/${s.id}/pages`), snap => { pages[s.id] = snap.val() || {}; refresh(); viewerDataChanged(s.id); });
    onValue(ref(db, `students/${s.id}/notes`), snap => { notes[s.id] = snap.val() || {}; refresh(); viewerNotesChanged(s.id); });
    onValue(ref(db, `teacher/seen/${s.id}`), snap => { seen[s.id] = snap.val() || {}; refresh(); });
    onValue(ref(db, `teacher/reports/${s.id}`), snap => { reports[s.id] = snap.val() || {}; if (route.view === 'report' && route.s === s.id && !reportEditing) renderReport(); });
    loadSiteList(s).then(refresh);
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
const newCount = sid => Object.keys(pages[sid]).filter(p => isNew(sid, p)).length;
function totals(sid) {
  let total = 0, answered = 0, right = 0, started = 0;
  Object.values(pages[sid]).forEach(r => { if (!r.stats) return; total += r.stats.total; answered += r.stats.answered; right += r.stats.right; if (r.stats.answered) started++; });
  return { total, answered, right, started };
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
  const [, , sid, sub] = (location.hash || '#/').split('/');
  if (sid && stu(sid)) route = { view: sub === 'live' ? 'live' : sub === 'report' ? 'report' : 'dash', s: sid };
  else route = { view: 'overview' };
  ['overview', 'dash', 'view', 'report'].forEach(v => $('v-' + v).hidden = v !== ({ overview: 'overview', dash: 'dash', live: 'view', report: 'report' })[route.view]);
  if (route.view !== 'live') closeViewer();
  if (route.view === 'live') openLive(route.s);
  if (route.view === 'report') renderReport();
  refresh();
  document.querySelector('.main').scrollTop = 0;
}
document.querySelectorAll('[data-go=overview]').forEach(b => b.onclick = () => go('#/'));

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
  document.querySelector('.nav-item[data-go=overview]').classList.toggle('on', route.view === 'overview');
  if (route.view === 'overview') renderOverview();
  if (route.view === 'dash') renderDash();
  if (route.view === 'live') renderViewerBar();
}

/* ---------------- overview ---------------- */
function renderOverview() {
  $('overview').innerHTML = STUDENTS.map(s => {
    const p = presence[s.id], t = totals(s.id), n = newCount(s.id);
    const now = isLive(p) ? `<span class="pill live">Online · ${esc(shortTitle(p.title || p.page))}</span>` : p ? `Last seen ${ago(p.at)}` : 'Not connected yet';
    return `<div class="s-card" style="--c:${s.color}">
      <div class="top">${avatar(s)}<div style="flex:1"><h2>${esc(s.name)}</h2><div class="now">${now}</div></div>${n ? `<span class="badge-new">${n} new</span>` : ''}</div>
      <div>${bar(t)}<div class="legend"><span>${t.answered} answers</span><span>${pct(t.right, t.answered)}% right</span></div></div>
      <div class="row"><button class="btn" data-dash="${s.id}">Dashboard</button><button class="btn primary" data-live="${s.id}">● Live</button></div>
    </div>`;
  }).join('');
  $('overview').querySelectorAll('[data-dash]').forEach(b => b.onclick = () => go('#/s/' + b.dataset.dash));
  $('overview').querySelectorAll('[data-live]').forEach(b => b.onclick = () => go('#/s/' + b.dataset.live + '/live'));
}

/* ---------------- one student's dashboard ---------------- */
function renderDash() {
  const s = stu(route.s), p = presence[s.id], t = totals(s.id), list = pageList(s.id);
  $('d-avatar').outerHTML = `<span id="d-avatar">${avatar(s, 'big', false)}</span>`;
  $('d-name').textContent = s.name;
  $('d-status').innerHTML = isLive(p) ? `<span class="pill live">Online now · ${esc(shortTitle(p.title || p.page))}</span>` : p ? 'Last seen ' + ago(p.at) : 'Not connected yet';
  const notesTotal = Object.values(notes[s.id]).reduce((n, o) => n + Object.keys(o || {}).length, 0);
  $('d-tiles').innerHTML = `
    <div class="tile"><b>${Object.keys(pages[s.id]).length}<small style="font-size:16px;color:var(--muted)"> / ${list.length}</small></b><span>pages worked on</span></div>
    <div class="tile"><b>${t.answered}</b><span>answers given</span></div>
    <div class="tile"><b>${t.answered ? pct(t.right, t.answered) + '%' : '—'}</b><span>right (where there is a key)</span></div>
    <div class="tile"><b>${notesTotal}</b><span>your marks & comments</span></div>`;
  const card = pg => {
    const r = pg.rec, st = r && r.stats, nw = isNew(s.id, pg.page), nc = noteCount(s.id, pg.page);
    const info = !r ? 'Not opened yet' : st && st.total ? `${st.answered} / ${st.total} answered · ${st.right} right` : 'answers saved';
    return `<div class="p-card ${nw ? 'is-new' : ''} ${r ? '' : 'untouched'}">
      <div class="t"><b>${esc(pg.title || pg.page)}</b>${nw ? '<span class="badge-new">NEW</span>' : ''}</div>
      ${bar(st)}
      <div class="sub"><span>${info}</span>${r ? `<span>🕑 ${ago(r.at)}</span>` : ''}${nc ? `<span>💬 ${nc}</span>` : ''}</div>
      <div class="acts">${r ? `<button class="btn small ghost danger" data-reset="${esc(pg.page)}">↺ Reset</button>` : ''}<button class="btn small" data-open="${esc(pg.page)}" data-path="${esc(pg.path)}">Open →</button></div>
    </div>`;
  };
  const lessons = list.filter(p => !p.hw), hws = list.filter(p => p.hw);
  $('d-pages').innerHTML = (lessons.length ? `<div class="group-title">Lessons</div><div class="pages">${lessons.map(card).join('')}</div>` : '')
    + (hws.length ? `<div class="group-title">Homework</div><div class="pages">${hws.map(card).join('')}</div>` : '')
    + (list.length ? '' : '<p class="empty">Loading the lessons…</p>');
  $('d-pages').querySelectorAll('[data-open]').forEach(b => b.onclick = () => { $('follow').checked = false; go('#/s/' + s.id + '/live'); showPage(s.id, b.dataset.open, b.dataset.path); });
  $('d-pages').querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPage(s.id, b.dataset.reset));
  $('d-live').onclick = () => { $('follow').checked = true; go('#/s/' + s.id + '/live'); };
  $('d-report').onclick = () => go('#/s/' + s.id + '/report');
}

/* ---------------- live viewer (two frames: the new version loads behind, then swaps in) ---------------- */
const frames = [$('frame-a'), $('frame-b')];
let front = 0, viewing = null, loadToken = 0;   // viewing = { s, page, path, part, json }
window.__teacher = {                             // called from the page inside the frame (assets/sync.js)
  annotate: (anchor, label) => viewing && openNote(viewing.s, viewing.page, anchor, label),
  resetTask: (keys, title) => viewing && resetTask(viewing.s, viewing.page, keys, title)
};
function openLive(sid) {
  const p = presence[sid];
  if (viewing && viewing.s === sid) return renderViewerBar();
  if ($('follow').checked && p && p.page) showPage(sid, p.page, p.path, p.part);
  else if (!viewing || viewing.s !== sid) { const last = pageList(sid).filter(x => x.rec).sort((a, b) => b.rec.at - a.rec.at)[0]; if (last) showPage(sid, last.page, last.path); else { viewing = { s: sid }; frames.forEach(f => f.hidden = true); $('v-empty').hidden = false; } }
  renderViewerBar();
}
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
}
function storeAnswers(sid, page) {
  const r = pages[sid][page], key = (r && r.key) || 'answers-' + page;
  sessionStorage.setItem(`watch-${sid}-${key}`, r ? r.json : '{}');
}
function showPage(sid, page, path, part, highlight) {
  const s = stu(sid);
  path = path || (pages[sid][page] || {}).path || (pageList(sid).find(x => x.page === page) || {}).path;
  if (!path) return;
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
  if (p && p.page && (p.page !== viewing.page || (p.part || null) !== viewing.part)) showPage(sid, p.page, p.path, p.part);
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
function renderReport() {
  const s = stu(route.s), sid = s.id, meta = (reports[sid] || {})._meta || {};
  const list = reportPages(sid), shown = list.filter(p => !p.skip);
  const recs = Object.values(pages[sid]);
  const firstAt = recs.length ? Math.min(...recs.map(r => r.at)) : Date.now();
  let total = 0, answered = 0, right = 0;
  shown.forEach(p => { const st = p.rec && p.rec.stats; if (st) { total += st.total; answered += st.answered; right += st.right; } });
  const skills = [...new Set(shown.flatMap(p => p.skills.split(';').map(x => x.trim()).filter(Boolean)))];
  $('r-heading').textContent = s.name + ' — report';
  const ed = (field, text, cls = '', tag = 'span') => `<${tag} class="${cls}" contenteditable="true" data-field="${field}">${esc(text)}</${tag}>`;
  $('report').innerHTML = `
    <div class="r-top">
      <div><p class="eyebrow">Английский язык</p><h1>Отчёт об успехах</h1><div style="font:600 20px/1.3 var(--serif);margin-top:4px">${esc(s.ru)}</div></div>
      <div class="r-meta">Дата: ${ruDate(Date.now())}<br>Период: ${ed('_meta.period', meta.period || 'с ' + ruDate(firstAt) + ' по ' + ruDate(Date.now()))}<br>Преподаватель: ${ed('_meta.teacher', meta.teacher || '')}</div>
    </div>
    <div class="r-sum">
      <div><b>${shown.length}</b><span>уроков и заданий пройдено</span></div>
      <div><b>${answered}${total ? ' / ' + total : ''}</b><span>заданий выполнено на сайте</span></div>
      <div><b>${answered ? pct(right, answered) + '%' : '—'}</b><span>правильных ответов</span></div>
    </div>
    <h2>Чему ${s.female ? 'научилась' : 'научился'} ${esc(s.ru)}</h2>
    <ul class="r-skills">${skills.map(x => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul>
    <h2>Пройденные темы</h2>
    ${shown.map(p => { const st = p.rec && p.rec.stats;
      const stat = st && st.total ? `выполнено ${st.answered} из ${st.total}, верно ${pct(st.right, st.answered || 1)}%` : p.rec ? 'выполнено на сайте' : '';
      return `<div class="r-lesson"><button class="r-skip no-print" data-skip="${esc(p.page)}" title="Убрать из отчёта">✕ убрать</button>
        <div class="r-h">${ed(p.page + '.title', p.title, '', 'h3')}<span class="r-stat">${stat}</span></div>
        <div class="r-lines"><span>Темы</span>${ed(p.page + '.topics', p.topics)}<span>Умения</span>${ed(p.page + '.skills', p.skills)}</div></div>`; }).join('')}
    ${list.some(p => p.skip) ? `<p class="no-print" style="color:var(--muted);font-size:13px">Убрано из отчёта: ${list.filter(p => p.skip).map(p => `<a href="#" data-unskip="${esc(p.page)}">${esc(p.title)}</a>`).join(', ')}</p>` : ''}
    <h2>Комментарий преподавателя</h2>
    ${ed('_meta.comment', meta.comment || '', 'r-comment', 'div')}
    <div class="r-sign"><span>Подпись преподавателя: ____________________</span><span>${ruDate(Date.now())}</span></div>`;
  $('report').querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('focus', () => { reportEditing = true; });
    el.addEventListener('blur', () => {
      reportEditing = false;
      const [page, field] = el.dataset.field.split('.');
      set(ref(db, `teacher/reports/${sid}/${page}/${field}`), el.innerText.trim()).then(() => toast('Saved'));
    });
  });
  $('report').querySelectorAll('[data-skip]').forEach(b => b.onclick = () => set(ref(db, `teacher/reports/${sid}/${b.dataset.skip}/skip`), true));
  $('report').querySelectorAll('[data-unskip]').forEach(a => a.onclick = e => { e.preventDefault(); remove(ref(db, `teacher/reports/${sid}/${a.dataset.unskip}/skip`)); });
}
$('r-back').onclick = () => go('#/s/' + route.s);
$('r-print').onclick = () => window.print();
