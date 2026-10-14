/* ============================================================
   Lesson planner (teacher.html → #/plans, #/plans/<id>)
   Plans built around a communicative + lexical approach:
   a can-do outcome, target chunks, timed stages with tips,
   a principles checklist and chunks to recycle from earlier plans.
   Firebase: teacher/plans/<id>
     { title, student, at, eventId, minutes, level, template, outcome,
       lexis:[{chunk, example, l1, recycle}], stages:[{name, minutes, interaction, aim, procedure}],
       checks:{key:true}, materials, homework, reflection, updated }
   ============================================================ */
export const TEMPLATES = {
  cl: { name: 'Communicative + lexical', stages: [
    ['Lead-in', 5, 'T–S', 'Engage and personalise the topic', 'Ask a real question about the student’s life connected to today’s topic. Listen for gaps — what they try to say but can’t shows which chunks to teach.'],
    ['Meet the language in context', 8, 'S', 'Meaning first: the chunks inside a text or audio', 'Short text, dialogue or video where the target chunks appear naturally. First a gist question (meaning), only then look at the language.'],
    ['Noticing', 7, 'S + T', 'Notice whole chunks and patterns', 'The student finds and underlines whole chunks (verb + noun, phrase, sentence starter), not single words. Ask: what comes before / after? Is it the same in Russian?'],
    ['Controlled practice', 8, 'S', 'Accurate use of the chunks', 'Matching halves, gap-fills, putting chunks in order. Drill the whole chunk aloud: stress, linking, rhythm.'],
    ['Communicative task', 12, 'S–T (pair)', 'Use the chunks for a real purpose', 'Information gap, opinion gap or role-play with an outcome (decide, plan, find out, compare). The student needs the chunks to finish it. Don’t correct during the task — take notes.'],
    ['Feedback & language upgrade', 6, 'T–S', 'Better versions of what the student said', 'Praise good chunks. Reformulate 3–5 things the student said into more natural chunks and write them down (“upgrades”).'],
    ['Recycle & wrap-up', 4, 'S', 'Retrieval and spaced repetition', 'Student recalls today’s chunks (and some from last lesson) without looking; personal sentences; set homework that recycles them.']] },
  tbl: { name: 'Task-based', stages: [
    ['Pre-task', 6, 'T–S', 'Topic, task instructions, a few useful chunks', 'Introduce the topic with a picture or question. Give 3–5 chunks that will help, but don’t pre-teach everything.'],
    ['Task', 10, 'S–T (pair)', 'Fluency: do the task', 'You are the partner. Real outcome: a decision, a list, a plan. Let the student struggle a little; note language gaps.'],
    ['Planning', 6, 'S', 'Prepare to report the outcome', 'The student prepares to tell / write the result more carefully. Help with chunks they ask for.'],
    ['Report', 6, 'S', 'Accuracy under some pressure', 'The student presents the outcome. Respond to the content first, then the language.'],
    ['Language focus', 10, 'S + T', 'Analyse chunks from the task / a model text', 'Compare with a model (recording or text by a proficient speaker). Notice the chunks the student lacked.'],
    ['Practice', 8, 'S', 'Practise the new chunks', 'Short controlled practice of the chunks from the language focus.'],
    ['Recycle', 4, 'S', 'Retrieval', 'Repeat the task briefly with the new chunks, or retell it.']] },
  ttt: { name: 'Test – teach – test', stages: [
    ['Test 1', 10, 'S–T', 'See what the student can already do', 'A short communicative task. Note what works and which chunks are missing.'],
    ['Teach', 12, 'T–S', 'Fill the gaps you noticed', 'Present the missing chunks in context; noticing and quick controlled practice.'],
    ['Test 2', 12, 'S–T', 'Do a similar task again', 'A variation of the first task. The student should now use the new chunks.'],
    ['Feedback & upgrade', 6, 'T–S', 'Compare test 1 and test 2', 'Show progress; upgrade 3–5 phrases.'],
    ['Recycle', 5, 'S', 'Retrieval', 'Recall the chunks; personal sentences; homework.']] }
};
export const PRINCIPLES = [
  ['purpose', 'Communicative', 'The main task has a real purpose and an outcome (decide, plan, find out…)'],
  ['gap', 'Communicative', 'There is an information gap or an opinion gap'],
  ['stt', 'Communicative', 'The student talks more than the teacher (aim: 60 %+)'],
  ['fluency', 'Communicative', 'Fluency before accuracy; correction is delayed, not during the task'],
  ['personal', 'Communicative', 'The topic is personalised — connected to the student’s life'],
  ['chunks', 'Lexical', 'Target language is chunks and collocations, not isolated words'],
  ['notice', 'Lexical', 'There is a noticing step: the student finds the chunks in context'],
  ['recycle', 'Lexical', 'Chunks from earlier lessons are recycled (aim: meet each chunk 6–7 times)'],
  ['l1', 'Lexical', 'Contrast with Russian where it helps (false friends, word-for-word traps)'],
  ['record', 'Lexical', 'New chunks go into the student’s dictionary with an example']
];

export function initPlanner(ctx) {
  const { db, ref, onValue, set, remove, push, STUDENTS, $, esc, toast, go } = ctx;
  const stu = id => STUDENTS.find(s => s.id === id);
  let plans = {}, current = null, saveTimer = null, typing = false;
  ctx.plans = () => plans;

  onValue(ref(db, 'teacher/plans'), snap => {
    plans = snap.val() || {};
    ctx.onChange();
    if (ctx.route().view === 'plans' && !typing) ctx.renderPlans();
  });

  const newStages = key => TEMPLATES[key].stages.map(([name, minutes, interaction, aim]) => ({ name, minutes, interaction, aim, procedure: '' }));
  function createPlan(extra = {}) {
    const key = push(ref(db, 'teacher/plans')).key;
    const p = { title: 'New lesson plan', student: STUDENTS[0].id, minutes: 50, level: '', template: 'cl', outcome: '',
      lexis: [{ chunk: '', example: '', l1: '' }], stages: newStages('cl'), checks: {}, materials: '', homework: '', reflection: '', updated: Date.now(), ...extra };
    plans[key] = p;
    set(ref(db, `teacher/plans/${key}`), p);
    return key;
  }
  // "+ Plan" on a calendar lesson
  ctx.newPlanFor = (eventId, ev, at) => {
    const s = stu(ev.student), d = new Date(at);
    const id = createPlan({ student: ev.student, at, eventId, minutes: ev.minutes || 50,
      title: `${s.name} · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` });
    ctx.linkPlan(eventId, at, id);
    go('#/plans/' + id);
  };

  /* ---------- list + editor ---------- */
  ctx.renderPlans = () => {
    const id = ctx.route().plan;
    current = id && plans[id] ? id : null;
    const list = Object.entries(plans).sort((a, b) => (b[1].at || b[1].updated) - (a[1].at || a[1].updated));
    $('pl-list').innerHTML = `<div class="pl-new"><select id="pl-tpl">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('')}</select>
      <button class="btn primary" id="pl-add">+ New plan</button></div>`
      + (list.length ? list.map(([k, p]) => { const s = stu(p.student) || STUDENTS[0];
        return `<a class="pl-item ${k === current ? 'on' : ''}" href="#/plans/${k}"><span class="avatar small" style="--c:${s.color}">${s.name[0]}</span>
          <span><b>${esc(p.title || 'Untitled')}</b><small>${p.at ? new Date(p.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' : ''}${esc(TEMPLATES[p.template || 'cl'].name)}</small></span></a>`; }).join('')
        : '<p class="pl-none">No plans yet.</p>');
    $('pl-add').onclick = () => { const t = $('pl-tpl').value; go('#/plans/' + createPlan({ template: t, stages: newStages(t) })); };
    if (!current) { $('pl-editor').innerHTML = welcome(); return; }
    renderEditor();
  };

  function welcome() {
    return `<div class="pl-welcome">
      <h2>Plan a lesson</h2>
      <p>Pick a lesson shape and press <b>+ New plan</b>, or press <b>+ Plan</b> on a lesson in the schedule. Everything saves as you type.</p>
      <div class="pl-princ">${['Communicative', 'Lexical'].map(g => `<div><span class="lab">${g} approach</span><ul>${PRINCIPLES.filter(p => p[1] === g).map(p => `<li>${esc(p[2])}</li>`).join('')}</ul></div>`).join('')}</div>
    </div>`;
  }

  function earlierChunks(p) {    // chunks from this student's earlier plans, to recycle
    const mine = Object.entries(plans).filter(([k, q]) => k !== current && q.student === p.student && (q.at || q.updated) < (p.at || p.updated || Date.now()));
    const have = new Set((p.lexis || []).map(l => (l.chunk || '').trim().toLowerCase()));
    return [...new Set(mine.flatMap(([, q]) => (q.lexis || []).map(l => (l.chunk || '').trim()).filter(Boolean)))].filter(c => !have.has(c.toLowerCase())).slice(0, 24);
  }

  function renderEditor() {
    plans[current].stages = plans[current].stages || [];   // Firebase drops empty lists
    plans[current].lexis = plans[current].lexis || [];
    const p = plans[current], s = stu(p.student) || STUDENTS[0], tpl = TEMPLATES[p.template || 'cl'];
    const tips = Object.fromEntries(Object.values(TEMPLATES).flatMap(t => t.stages.map(st => [st[0], st[4]])));
    const total = (p.stages || []).reduce((n, st) => n + (+st.minutes || 0), 0), len = +p.minutes || 50;
    const lessons = ctx.lessonsFor(p.student);
    const recycle = earlierChunks(p);
    const colors = ['var(--pink)', 'var(--olive)', 'var(--sky)', 'var(--sage)', 'var(--pink-2)', 'var(--olive-2)', 'var(--blue)'];
    $('pl-editor').innerHTML = `
      <div class="pl-doc">
        <div class="pl-top">
          <input class="pl-title" data-f="title" value="${esc(p.title)}" placeholder="Plan title">
          <div class="pl-actions no-print"><button class="btn" id="pl-print">🖨 Print</button><button class="btn ghost danger" id="pl-del">Delete</button></div>
        </div>
        <div class="pl-meta">
          <label>Student<select data-f="student">${STUDENTS.map(x => `<option value="${x.id}" ${x.id === p.student ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label>Lesson in the schedule<select id="pl-lesson"><option value="">— not linked —</option>${lessons.map(o => `<option value="${o.id}|${o.at}" ${p.eventId === o.id && p.at === o.at ? 'selected' : ''}>${new Date(o.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${ctx.fmtTime(o.at)}</option>`).join('')}</select></label>
          <label>Length, min<input type="number" min="10" step="5" data-f="minutes" value="${len}"></label>
          <label>Level<input data-f="level" value="${esc(p.level || '')}" placeholder="e.g. A1, B1+"></label>
          <label>Lesson shape<input value="${esc(tpl.name)}" disabled></label>
        </div>

        <section class="pl-sec"><h3>Can-do outcome</h3>
          <textarea data-f="outcome" rows="2" placeholder="By the end of the lesson ${esc(s.name)} can… (e.g. ask and answer about a classmate’s phone number using “What’s your…?” / “It’s…”)">${esc(p.outcome || '')}</textarea></section>

        <section class="pl-sec"><h3>Target chunks & collocations</h3>
          <div class="lx-head"><span>Chunk</span><span>Example sentence</span><span>Russian</span><span></span></div>
          ${(p.lexis || []).map((l, i) => `<div class="lx-row ${l.recycle ? 'rec' : ''}"><input data-lx="${i}.chunk" value="${esc(l.chunk)}" placeholder="have a look at"><input data-lx="${i}.example" value="${esc(l.example)}" placeholder="Can I have a look at your photos?"><input data-lx="${i}.l1" value="${esc(l.l1)}" placeholder="взглянуть на"><button class="x no-print" data-lxdel="${i}" title="Remove">✕</button></div>`).join('')}
          <button class="btn small no-print" id="lx-add">+ chunk</button>
          ${recycle.length ? `<div class="recycle no-print"><span class="lab">Recycle from earlier lessons — click to add</span>${recycle.map(c => `<button class="chip" data-rec="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        </section>

        <section class="pl-sec"><h3>Stages <small>${total} of ${len} min</small></h3>
          <div class="timeline">${(p.stages || []).map((st, i) => `<i style="flex:${+st.minutes || 0};background:${colors[i % colors.length]}" title="${esc(st.name)} · ${st.minutes}′"></i>`).join('')}${total < len ? `<i class="free" style="flex:${len - total}"></i>` : ''}</div>
          ${total > len ? `<p class="warn">The stages take ${total - len} min longer than the lesson.</p>` : ''}
          ${(p.stages || []).map((st, i) => `<div class="stage" style="--c:${colors[i % colors.length]}">
            <div class="st-head"><span class="st-n">${i + 1}</span><input class="st-name" data-st="${i}.name" value="${esc(st.name)}"><input class="st-min" type="number" min="0" data-st="${i}.minutes" value="${+st.minutes || 0}"><span>min</span>
              <select data-st="${i}.interaction">${['T–S', 'S–T', 'S', 'S + T', 'S–T (pair)', 'Video / audio'].map(x => `<option ${x === st.interaction ? 'selected' : ''}>${x}</option>`).join('')}</select>
              <span class="st-tools no-print"><button data-mv="${i}|-1" title="Up">↑</button><button data-mv="${i}|1" title="Down">↓</button><button data-stdel="${i}" title="Remove">✕</button></span></div>
            <input class="st-aim" data-st="${i}.aim" value="${esc(st.aim || '')}" placeholder="Aim of this stage">
            <textarea data-st="${i}.procedure" rows="3" placeholder="What exactly happens: activity, material, instructions…">${esc(st.procedure || '')}</textarea>
            ${tips[st.name] ? `<p class="tip no-print">💡 ${esc(tips[st.name])}</p>` : ''}
          </div>`).join('')}
          <button class="btn small no-print" id="st-add">+ stage</button>
        </section>

        <section class="pl-sec two">
          <div><h3>Materials & links</h3><textarea data-f="materials" rows="3" placeholder="Lesson page, Wordwall, video, Zoom whiteboard…">${esc(p.materials || '')}</textarea></div>
          <div><h3>Homework (recycling)</h3><textarea data-f="homework" rows="3" placeholder="Practice that brings today’s chunks back">${esc(p.homework || '')}</textarea></div>
        </section>

        <section class="pl-sec"><h3>Checklist</h3>
          <div class="checks">${['Communicative', 'Lexical'].map(g => `<div><span class="lab">${g}</span>${PRINCIPLES.filter(x => x[1] === g).map(([k, , t]) => `<label class="ck"><input type="checkbox" data-ck="${k}" ${(p.checks || {})[k] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>`).join('')}</div></section>

        <section class="pl-sec"><h3>After the lesson</h3>
          <textarea data-f="reflection" rows="3" placeholder="What worked? Which chunks need recycling next time?">${esc(p.reflection || '')}</textarea></section>
      </div>`;
    wireEditor();
  }

  function save(now) {
    clearTimeout(saveTimer);
    const run = () => { plans[current].updated = Date.now(); set(ref(db, `teacher/plans/${current}`), plans[current]).then(() => { typing = false; }); };
    if (now) run(); else saveTimer = setTimeout(run, 600);
  }
  function wireEditor() {
    const p = plans[current], ed = $('pl-editor');
    ed.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      typing = true; p[el.dataset.f] = el.type === 'number' ? +el.value : el.value;
      if (el.dataset.f === 'student' || el.dataset.f === 'minutes') { save(true); renderEditor(); } else save();
    }));
    ed.querySelectorAll('[data-lx]').forEach(el => el.addEventListener('input', () => { const [i, k] = el.dataset.lx.split('.'); typing = true; p.lexis[i][k] = el.value; save(); }));
    ed.querySelectorAll('[data-st]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const [i, k] = el.dataset.st.split('.'); typing = true; p.stages[i][k] = k === 'minutes' ? +el.value : el.value;
      if (k === 'minutes' || k === 'name') { clearTimeout(ed._t); ed._t = setTimeout(() => { save(true); renderEditor(); }, 700); } else save();
    }));
    ed.querySelectorAll('[data-ck]').forEach(el => el.onchange = () => { p.checks = p.checks || {}; p.checks[el.dataset.ck] = el.checked; save(true); });
    const re = () => { save(true); renderEditor(); };
    $('lx-add').onclick = () => { p.lexis = p.lexis || []; p.lexis.push({ chunk: '', example: '', l1: '' }); re(); };
    ed.querySelectorAll('[data-lxdel]').forEach(b => b.onclick = () => { p.lexis.splice(+b.dataset.lxdel, 1); re(); });
    ed.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => { p.lexis = (p.lexis || []).filter(l => l.chunk || l.example); p.lexis.push({ chunk: b.dataset.rec, example: '', l1: '', recycle: true }); re(); });
    $('st-add').onclick = () => { p.stages.push({ name: 'New stage', minutes: 5, interaction: 'S–T', aim: '', procedure: '' }); re(); };
    ed.querySelectorAll('[data-stdel]').forEach(b => b.onclick = () => { if (confirm('Remove this stage?')) { p.stages.splice(+b.dataset.stdel, 1); re(); } });
    ed.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split('|').map(Number), j = i + d;
      if (j < 0 || j >= p.stages.length) return; [p.stages[i], p.stages[j]] = [p.stages[j], p.stages[i]]; re(); });
    $('pl-lesson').onchange = () => { const v = $('pl-lesson').value;
      if (!v) { p.eventId = null; save(true); return; }
      const [eid, at] = v.split('|'); p.eventId = eid; p.at = +at; save(true); ctx.linkPlan(eid, +at, current); toast('Linked to the lesson'); };
    $('pl-print').onclick = () => { document.body.classList.add('printing-plan'); window.print(); document.body.classList.remove('printing-plan'); };
    $('pl-del').onclick = () => { if (confirm('Delete this plan?')) { remove(ref(db, `teacher/plans/${current}`)); go('#/plans'); } };
  }
}
