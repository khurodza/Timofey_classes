/* ============================================================
   Schedule (teacher.html → #/schedule)
   A week calendar of lessons. Every lesson shows the teacher's own
   time and Moscow time, and links to Zoom, the student's site, the
   lesson page and the student's notes. Lessons can repeat weekly; a
   single week can be skipped.
   Firebase:
     teacher/schedule/<id>  { student, start (ms), minutes, weekly, until, skip:{yyyy-mm-dd:true},
                              zoom, page, note }
     teacher/links/<student> { zoom }        default Zoom link per student
     teacher/homework/<student>/<yyyy-mm-dd> { text, at }   homework set in the class on that day
   ============================================================ */
export function initSchedule(ctx) {
  const { db, ref, onValue, set, remove, push, STUDENTS, $, esc, toast, pageList, go } = ctx;
  const stu = id => STUDENTS.find(s => s.id === id);
  let events = {}, links = {}, rates = {}, earnedByHand = {}, weekStart = mondayOf(new Date()), monthStart = firstOfMonth(new Date());
  // price of one lesson per student, in rubles (editable under "Student links"; saved in teacher/rates)
  const DEFAULT_RATES = { timofey: 3000, polina: 3000, matvey: 1000, ksyusha: 1500 };
  const rateOf = sid => +(rates[sid] ?? DEFAULT_RATES[sid] ?? 0);
  const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';
  const MOSCOW = 'Europe/Moscow';
  const myZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  onValue(ref(db, 'teacher/schedule'), snap => { events = snap.val() || {}; ctx.onChange(); });
  onValue(ref(db, 'teacher/links'), snap => { links = snap.val() || {}; ctx.onChange(); });
  onValue(ref(db, 'teacher/rates'), snap => { rates = snap.val() || {}; ctx.onChange(); });
  let homework = {};
  onValue(ref(db, 'teacher/homework'), snap => { homework = snap.val() || {}; ctx.onChange(); if (ctx.onHomework) ctx.onHomework(); });
  onValue(ref(db, 'teacher/earned'), snap => { earnedByHand = snap.val() || {}; ctx.onChange(); });
  // money earned before lessons were in the schedule, entered by hand per month: { amount, upTo: 'yyyy-mm-dd' }
  // (lessons in the schedule on or before upTo are then not counted again)
  const EARNED_START = { '2026-10': { amount: 13000, upTo: '2026-10-13' } };
  const monthKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const handFor = d => earnedByHand[monthKey(d)] || EARNED_START[monthKey(d)] || null;

  /* ---------- dates ---------- */
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
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
  const zoomFor = e => e.zoom || (links[e.student] || {}).zoom || '';
  function lessonLinks(o) {
    const e = o.e, s = stu(e.student), zoom = zoomFor(e);
    const page = e.page ? (pageList(e.student).find(p => p.page === e.page) || {}) : null;
    return `<div class="ev-links">
      ${zoom ? `<a class="btn small primary" href="${esc(zoom)}" target="_blank" rel="noopener">● Join Zoom</a>` : `<button class="btn small ghost" data-setzoom="${s.id}">+ Zoom link</button>`}
      <a class="btn small" href="${esc(studentSite(s.id))}" target="_blank" rel="noopener" title="${esc(s.name)}’s site">Site ↗</a>
      ${page && page.path ? `<a class="btn small" href="${esc(page.path)}" target="_blank" rel="noopener">${esc(shortT(page.title || e.page))} ↗</a>` : ''}
      ${ctx.openTodoCount && ctx.openTodoCount(s.id) ? `<a class="btn small" href="#/notes/${s.id}">✎ ${ctx.openTodoCount(s.id)} to do</a>` : `<a class="btn small ghost" href="#/notes/${s.id}">✎ Notes</a>`}
    </div>`;
  }
  // homework set in a class (one per student per day, so every week of a repeating lesson has its own)
  const hwOf = (sid, day) => (((homework[sid] || {})[day]) || {}).text || '';
  function saveHw(sid, day, text) {
    const r = ref(db, `teacher/homework/${sid}/${day}`);
    if (text === hwOf(sid, day)) return;
    (text ? set(r, { text, at: Date.now() }) : remove(r)).then(() => toast(text ? 'Homework saved' : 'Homework removed'));
  }
  const hwBox = o => { const day = dayKey(new Date(o.at));
    return `<label class="ev-hw"><span>📝 Homework</span><textarea rows="2" data-hw="${o.e.student}|${day}" placeholder="What did you set?">${esc(hwOf(o.e.student, day))}</textarea></label>`; };
  const typingHw = () => document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-hw]');
  ctx.homeworkOf = hwOf;
  ctx.saveHomework = saveHw;
  const shortT = t => String(t || '').replace(/^Lesson (\d+)\s*[–—-]\s*/i, 'L$1 · ');

  /* ---------- "Up next" card on the home screen ---------- */
  ctx.renderUpNext = el => {
    const o = ctx.nextLesson();
    if (!o) { el.innerHTML = `<div class="upnext empty-next"><span class="lab">Up next</span><span>No lessons planned — <a href="#/schedule">open the schedule</a> to add one.</span></div>`; return; }
    const s = stu(o.e.student), start = new Date(o.at), live = Date.now() >= o.at - 10 * 6e4;
    const prev = occurrences(new Date(o.at - 60 * 864e5), new Date(o.at)).filter(x => x.e.student === s.id).pop();
    const prevHw = prev && hwOf(s.id, dayKey(new Date(prev.at)));
    const when = sameDay(start, new Date()) ? 'Today' : start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    el.innerHTML = `<div class="upnext ${live ? 'soon' : ''}">
      <span class="avatar" style="--c:${s.color}">${s.name[0]}</span>
      <div class="un-text"><span class="lab">Up next${live ? ' · starting now' : ''}</span>
        <b>${esc(s.name)} · ${when}, ${fmtTime(o.at)}</b>
        <small>${fmtTime(o.at, MOSCOW)} in Moscow · ${o.e.minutes || 60} min${o.e.note ? ' · ' + esc(o.e.note) : ''}</small>
        ${prevHw ? `<small class="un-hw">📝 Homework from ${new Date(prev.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${esc(prevHw)}</small>` : ''}</div>
      ${lessonLinks(o)}</div>`;
    wire(el);
  };

  /* ---------- the week view ---------- */
  ctx.renderSchedule = () => {
    if (typingHw()) return;                      // don't redraw under the teacher's typing
    const end = new Date(weekStart); end.setDate(end.getDate() + 7);
    const occ = occurrences(weekStart, end), today = new Date();
    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const last = new Date(end); last.setDate(last.getDate() - 1);
    $('sch-range').textContent = `${fmt(weekStart)} – ${fmt(last)} ${last.getFullYear()}`;
    const wk = money(occ);
    $('sch-week-money').innerHTML = occ.length ? `This week: <b>${rub(wk.earned)}</b> earned${wk.planned ? ` · ${rub(wk.planned)} still planned` : ''}` : '';
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
          <div class="ev-price ${held(o) ? 'held' : ''}">${rub(rateOf(o.e.student))}${held(o) ? ' · earned' : ''}</div>
          ${o.e.note ? `<div class="ev-note">${esc(o.e.note)}</div>` : ''}
          ${hwBox(o)}
          ${lessonLinks(o)}
          <div class="ev-edit"><button data-edit="${o.id}">Edit</button>${o.e.weekly ? `<button data-skip="${o.id}|${dayKey(new Date(o.at))}">Skip week</button>` : ''}</div>
        </div>`; }).join('')}
        <button class="add-here" data-add="${dayKey(d)}">+ lesson</button>
      </div>`;
    }
    $('sch-week').innerHTML = html;
    $('sch-links').innerHTML = STUDENTS.map(s => `<label class="zl"><span class="avatar small" style="--c:${s.color}">${s.name[0]}</span><b>${esc(s.name)}</b>
      <input type="url" placeholder="Zoom link for ${esc(s.name)}" value="${esc((links[s.id] || {}).zoom || '')}" data-zoom="${s.id}">
      <span class="rate"><input type="number" min="0" step="100" value="${rateOf(s.id)}" data-rate="${s.id}" title="Price of one lesson"> ₽</span>
      <a href="${esc(s.site)}" target="_blank" rel="noopener" class="btn small">Site ↗</a></label>`).join('');
    $('sch-links').querySelectorAll('[data-zoom]').forEach(i => i.onchange = () => set(ref(db, `teacher/links/${i.dataset.zoom}/zoom`), i.value.trim()).then(() => toast('Zoom link saved')));
    $('sch-links').querySelectorAll('[data-rate]').forEach(i => i.onchange = () => set(ref(db, `teacher/rates/${i.dataset.rate}`), +i.value || 0).then(() => toast('Price saved')));
    renderMoney();
    wire($('v-schedule'));
  };
  function wire(root) {
    root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openEvent(null, b.dataset.add));
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEvent(b.dataset.edit));
    root.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => { const [id, day] = b.dataset.skip.split('|'); set(ref(db, `teacher/schedule/${id}/skip/${day}`), true).then(() => toast('Skipped this week')); });
    root.querySelectorAll('[data-hw]').forEach(t => t.onchange = () => { const [sid, day] = t.dataset.hw.split('|'); saveHw(sid, day, t.value.trim()); });
    root.querySelectorAll('[data-setzoom]').forEach(b => b.onclick = () => go('#/schedule'));
  }
  $('sch-prev').onclick = () => { weekStart.setDate(weekStart.getDate() - 7); ctx.renderSchedule(); };
  $('sch-next').onclick = () => { weekStart.setDate(weekStart.getDate() + 7); ctx.renderSchedule(); };
  $('sch-today').onclick = () => { weekStart = mondayOf(new Date()); ctx.renderSchedule(); };
  $('sch-new').onclick = () => openEvent(null, dayKey(new Date()));
  $('money-prev').onclick = () => { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1); renderMoney(); };
  $('money-next').onclick = () => { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1); renderMoney(); };

  /* ---------- earnings ---------- */
  // a lesson counts as earned once it has ended (skipped weeks are not in the calendar, so they never count)
  function held(o) { return o.at + (o.e.minutes || 60) * 6e4 <= Date.now(); }
  function money(list) {
    const per = {}; let earned = 0, planned = 0;
    list.forEach(o => { const h = handFor(new Date(o.at));
      if (h && h.upTo && dayKey(new Date(o.at)) <= h.upTo) return;        // already inside the amount entered by hand
      const r = rateOf(o.e.student), p = per[o.e.student] = per[o.e.student] || { held: 0, planned: 0 };
      if (held(o)) { p.held++; earned += r; } else { p.planned++; planned += r; } });
    return { per, earned, planned };
  }
  function renderMoney() {
    const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const m = money(occurrences(monthStart, end)), hand = handFor(monthStart), handAmt = hand ? +hand.amount || 0 : 0;
    m.earned += handAmt;
    const lessonsHeld = Object.values(m.per).reduce((n, p) => n + p.held, 0);
    const upToTxt = hand && hand.upTo ? new Date(hand.upTo + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    $('money-month').textContent = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    $('money-body').innerHTML = `
      <div class="money-tiles">
        <div class="mt earned"><span class="lab">Earned</span><b>${rub(m.earned)}</b><small>${handAmt ? `${rub(handAmt)} entered by you${lessonsHeld ? ` + ${lessonsHeld} lesson${lessonsHeld === 1 ? '' : 's'} from the schedule` : ''}` : `${lessonsHeld} lesson${lessonsHeld === 1 ? '' : 's'} held`}</small></div>
        <div class="mt planned"><span class="lab">Still planned</span><b>${rub(m.planned)}</b><small>rest of the month</small></div>
        <div class="mt total"><span class="lab">Month total</span><b>${rub(m.earned + m.planned)}</b><small>if every lesson happens</small></div>
      </div>
      <div class="money-rows">${STUDENTS.map(s => { const p = m.per[s.id] || { held: 0, planned: 0 }, r = rateOf(s.id);
        return `<div class="mr"><span class="avatar small" style="--c:${s.color}">${s.name[0]}</span><b>${esc(s.name)}</b>
          <span class="calc">${p.held} × ${rub(r)}</span><span class="sum">${rub(p.held * r)}</span>
          <span class="plan">${p.planned ? `+ ${p.planned} planned (${rub(p.planned * r)})` : ''}</span></div>`; }).join('')}</div>
      <form class="hand" id="hand-form">
        <span class="lab">Earned outside the schedule</span>
        <label><input type="number" min="0" step="100" id="hand-amt" value="${handAmt || ''}" placeholder="0"> ₽</label>
        <label>up to and including <input type="date" id="hand-upto" value="${hand && hand.upTo ? hand.upTo : ''}"></label>
        <button class="btn small">Save</button>
        <small>${handAmt ? `Lessons in the schedule up to ${upToTxt} aren’t counted again.` : 'For lessons you didn’t put in the schedule.'}</small>
      </form>`;
    $('hand-form').onsubmit = e => { e.preventDefault();
      const amount = +$('hand-amt').value || 0, upTo = $('hand-upto').value || null;
      set(ref(db, `teacher/earned/${monthKey(monthStart)}`), amount || upTo ? { amount, upTo } : { amount: 0, upTo: null }).then(() => toast('Saved')); };
  }

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

  ctx.lessonsFor = sid => occurrences(new Date(Date.now() - 60 * 864e5), new Date(Date.now() + 60 * 864e5)).filter(o => o.e.student === sid);
  ctx.dayKey = dayKey;
  ctx.eventsList = () => events;
  ctx.fmtTime = fmtTime;
}
