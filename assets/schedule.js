/* ============================================================
   Schedule (teacher.html → #/schedule)
   A week calendar of lessons. Every lesson shows the teacher's own
   time and Moscow time, and links to Zoom, the student's site, the
   lesson page and the lesson plan. Lessons can repeat weekly; a
   single week can be skipped.
   Firebase:
     teacher/schedule/<id>  { student, start (ms), minutes, weekly, until, skip:{yyyy-mm-dd:true},
                              zoom, page, note, plan }
     teacher/links/<student> { zoom }        default Zoom link per student
   ============================================================ */
export function initSchedule(ctx) {
  const { db, ref, onValue, set, remove, push, STUDENTS, $, esc, toast, pageList, go, plans } = ctx;
  const stu = id => STUDENTS.find(s => s.id === id);
  let events = {}, links = {}, weekStart = mondayOf(new Date());
  const MOSCOW = 'Europe/Moscow';
  const myZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  onValue(ref(db, 'teacher/schedule'), snap => { events = snap.val() || {}; ctx.onChange(); });
  onValue(ref(db, 'teacher/links'), snap => { links = snap.val() || {}; ctx.onChange(); });

  /* ---------- dates ---------- */
  function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fmtTime = (t, zone) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone });
  const sameDay = (a, b) => dayKey(a) === dayKey(b);

  // every lesson happening between from and to (weekly series expanded)
  function occurrences(from, to) {
    const out = [];
    Object.entries(events).forEach(([id, e]) => {
      if (!e.weekly) { if (e.start >= +from && e.start < +to) out.push({ id, e, at: e.start }); return; }
      const first = new Date(e.start);
      let t = new Date(first);
      if (t < from) { const weeks = Math.floor((from - t) / (7 * 864e5)); t.setDate(t.getDate() + weeks * 7); }
      for (; t < to; t.setDate(t.getDate() + 7)) {
        if (t < from || t < first) continue;
        if (e.until && t > new Date(e.until + 'T23:59')) break;
        if (e.skip && e.skip[dayKey(t)]) continue;
        out.push({ id, e, at: +t });
      }
    });
    return out.sort((a, b) => a.at - b.at);
  }
  ctx.nextLesson = () => occurrences(new Date(Date.now() - 50 * 6e4), new Date(Date.now() + 30 * 864e5))
    .find(o => o.at + (o.e.minutes || 60) * 6e4 > Date.now());
  ctx.nextLessonFor = sid => occurrences(new Date(), new Date(Date.now() + 30 * 864e5)).find(o => o.e.student === sid);

  const studentSite = sid => stu(sid).site;
  // each lesson date has its own plan (a weekly series gets one per week)
  const planOf = o => o.e.weekly ? (o.e.plans || {})[dayKey(new Date(o.at))] : o.e.plan;
  const zoomFor = e => e.zoom || (links[e.student] || {}).zoom || '';
  function lessonLinks(o) {
    const e = o.e, s = stu(e.student), zoom = zoomFor(e), planId = planOf(o);
    const page = e.page ? (pageList(e.student).find(p => p.page === e.page) || {}) : null;
    return `<div class="ev-links">
      ${zoom ? `<a class="btn small primary" href="${esc(zoom)}" target="_blank" rel="noopener">● Join Zoom</a>` : `<button class="btn small ghost" data-setzoom="${s.id}">+ Zoom link</button>`}
      <a class="btn small" href="${esc(studentSite(s.id))}" target="_blank" rel="noopener" title="${esc(s.name)}’s site">Site ↗</a>
      ${page && page.path ? `<a class="btn small" href="${esc(page.path)}" target="_blank" rel="noopener">${esc(shortT(page.title || e.page))} ↗</a>` : ''}
      ${planId && plans()[planId] ? `<button class="btn small" data-plan="${esc(planId)}">📝 ${esc(plans()[planId].title || 'Plan')}</button>` : `<button class="btn small ghost" data-newplan="${o.id}|${o.at}">+ Plan</button>`}
    </div>`;
  }
  const shortT = t => String(t || '').replace(/^Lesson (\d+)\s*[–—-]\s*/i, 'L$1 · ');

  /* ---------- "Up next" card on the home screen ---------- */
  ctx.renderUpNext = el => {
    const o = ctx.nextLesson();
    if (!o) { el.innerHTML = `<div class="upnext empty-next"><span class="lab">Up next</span><span>No lessons planned — <a href="#/schedule">open the schedule</a> to add one.</span></div>`; return; }
    const s = stu(o.e.student), start = new Date(o.at), live = Date.now() >= o.at - 10 * 6e4;
    const when = sameDay(start, new Date()) ? 'Today' : start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    el.innerHTML = `<div class="upnext ${live ? 'soon' : ''}">
      <span class="avatar" style="--c:${s.color}">${s.name[0]}</span>
      <div class="un-text"><span class="lab">Up next${live ? ' · starting now' : ''}</span>
        <b>${esc(s.name)} · ${when}, ${fmtTime(o.at)}</b>
        <small>${fmtTime(o.at, MOSCOW)} in Moscow · ${o.e.minutes || 60} min${o.e.note ? ' · ' + esc(o.e.note) : ''}</small></div>
      ${lessonLinks(o)}</div>`;
    wire(el);
  };

  /* ---------- the week view ---------- */
  ctx.renderSchedule = () => {
    const end = new Date(weekStart); end.setDate(end.getDate() + 7);
    const occ = occurrences(weekStart, end), today = new Date();
    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const last = new Date(end); last.setDate(last.getDate() - 1);
    $('sch-range').textContent = `${fmt(weekStart)} – ${fmt(last)} ${last.getFullYear()}`;
    $('sch-zones').textContent = `Your time (${myZone.replace('_', ' ')}) · Moscow time in small letters`;
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart); d.setDate(d.getDate() + i);
      const items = occ.filter(o => sameDay(new Date(o.at), d));
      html += `<div class="day ${sameDay(d, today) ? 'today' : ''}">
        <div class="day-head"><span>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span><b>${d.getDate()}</b></div>
        ${items.map(o => { const s = stu(o.e.student); return `<div class="ev" style="--c:${s.color}">
          <div class="ev-top"><span class="avatar small" style="--c:${s.color}">${s.name[0]}</span><b>${esc(s.name)}</b>${o.e.weekly ? '<span class="tag-rep" title="Every week">↻</span>' : ''}</div>
          <div class="ev-time">${fmtTime(o.at)}<small>${fmtTime(o.at, MOSCOW)} in Moscow · ${o.e.minutes || 60} min</small></div>
          ${o.e.note ? `<div class="ev-note">${esc(o.e.note)}</div>` : ''}
          ${lessonLinks(o)}
          <div class="ev-edit"><button data-edit="${o.id}">Edit</button>${o.e.weekly ? `<button data-skip="${o.id}|${dayKey(new Date(o.at))}">Skip week</button>` : ''}</div>
        </div>`; }).join('')}
        <button class="add-here" data-add="${dayKey(d)}">+ lesson</button>
      </div>`;
    }
    $('sch-week').innerHTML = html;
    $('sch-links').innerHTML = STUDENTS.map(s => `<label class="zl"><span class="avatar small" style="--c:${s.color}">${s.name[0]}</span><b>${esc(s.name)}</b>
      <input type="url" placeholder="Zoom link for ${esc(s.name)}" value="${esc((links[s.id] || {}).zoom || '')}" data-zoom="${s.id}">
      <a href="${esc(s.site)}" target="_blank" rel="noopener" class="btn small">Site ↗</a></label>`).join('');
    $('sch-links').querySelectorAll('[data-zoom]').forEach(i => i.onchange = () => set(ref(db, `teacher/links/${i.dataset.zoom}/zoom`), i.value.trim()).then(() => toast('Zoom link saved')));
    wire($('v-schedule'));
  };
  function wire(root) {
    root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openEvent(null, b.dataset.add));
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEvent(b.dataset.edit));
    root.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => { const [id, day] = b.dataset.skip.split('|'); set(ref(db, `teacher/schedule/${id}/skip/${day}`), true).then(() => toast('Skipped this week')); });
    root.querySelectorAll('[data-setzoom]').forEach(b => b.onclick = () => go('#/schedule'));
    root.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => go('#/plans/' + b.dataset.plan));
    root.querySelectorAll('[data-newplan]').forEach(b => b.onclick = () => { const [id, at] = b.dataset.newplan.split('|'); ctx.newPlanFor(id, events[id], +at); });
  }
  $('sch-prev').onclick = () => { weekStart.setDate(weekStart.getDate() - 7); ctx.renderSchedule(); };
  $('sch-next').onclick = () => { weekStart.setDate(weekStart.getDate() + 7); ctx.renderSchedule(); };
  $('sch-today').onclick = () => { weekStart = mondayOf(new Date()); ctx.renderSchedule(); };
  $('sch-new').onclick = () => openEvent(null, dayKey(new Date()));

  /* ---------- add / edit dialog ---------- */
  let editing = null;
  function openEvent(id, day) {
    editing = id;
    const e = id ? events[id] : { student: STUDENTS[0].id, minutes: 60, weekly: true };
    const start = id ? new Date(e.start) : new Date(day + 'T17:00');
    $('ev-title').textContent = id ? 'Edit lesson' : 'New lesson';
    $('ev-student').innerHTML = STUDENTS.map(s => `<option value="${s.id}" ${s.id === e.student ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    $('ev-date').value = dayKey(start);
    $('ev-time').value = start.toTimeString().slice(0, 5);
    $('ev-min').value = e.minutes || 60;
    $('ev-weekly').checked = !!e.weekly;
    $('ev-until').value = e.until || '';
    $('ev-zoom').value = e.zoom || '';
    $('ev-note').value = e.note || '';
    fillPages(e.student, e.page);
    $('ev-del').hidden = !id;
    showMoscow();
    $('ev-dlg').showModal();
  }
  function fillPages(sid, cur) {
    $('ev-page').innerHTML = '<option value="">— no specific page —</option>' + pageList(sid).slice().reverse()
      .map(p => `<option value="${esc(p.page)}" ${p.page === cur ? 'selected' : ''}>${esc(p.title || p.page)}</option>`).join('');
    $('ev-zoom').placeholder = (links[sid] || {}).zoom ? 'uses ' + stu(sid).name + '’s saved link' : 'https://zoom.us/j/…';
  }
  function showMoscow() {
    const t = new Date($('ev-date').value + 'T' + ($('ev-time').value || '00:00'));
    $('ev-msk').textContent = isNaN(t) ? '' : '= ' + fmtTime(+t, MOSCOW) + ' in Moscow (' + t.toLocaleDateString('en-GB', { weekday: 'short', timeZone: MOSCOW }) + ')';
  }
  $('ev-student').onchange = () => fillPages($('ev-student').value);
  $('ev-date').oninput = $('ev-time').oninput = showMoscow;
  $('ev-dlg').addEventListener('close', () => {
    const v = $('ev-dlg').returnValue;
    if (v === 'delete' && editing) { if (confirm('Delete this lesson' + (events[editing].weekly ? ' and all its repeats' : '') + '?')) remove(ref(db, `teacher/schedule/${editing}`)).then(() => toast('Lesson deleted')); return; }
    if (v !== 'save') return;
    const start = +new Date($('ev-date').value + 'T' + $('ev-time').value);
    if (isNaN(start)) return toast('Please choose a date and time');
    const old = editing ? events[editing] : {};
    const rec = { ...old, student: $('ev-student').value, start, minutes: +$('ev-min').value || 60, weekly: $('ev-weekly').checked,
      until: $('ev-until').value || null, zoom: $('ev-zoom').value.trim() || null, page: $('ev-page').value || null, note: $('ev-note').value.trim() || null };
    const r = editing ? ref(db, `teacher/schedule/${editing}`) : push(ref(db, 'teacher/schedule'));
    set(r, rec).then(() => toast('Lesson saved'));
  });

  ctx.linkPlan = (eventId, at, planId) => events[eventId] && set(ref(db, events[eventId].weekly ? `teacher/schedule/${eventId}/plans/${dayKey(new Date(at))}` : `teacher/schedule/${eventId}/plan`), planId);
  ctx.lessonsFor = sid => occurrences(new Date(Date.now() - 60 * 864e5), new Date(Date.now() + 60 * 864e5)).filter(o => o.e.student === sid);
  ctx.planOf = planOf;
  ctx.dayKey = dayKey;
  ctx.eventsList = () => events;
  ctx.fmtTime = fmtTime;
}
