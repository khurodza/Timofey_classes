/* ============================================================
   Notes (teacher.html → #/notes, #/notes/<student>)
   One notebook per student: strong points, things to work on,
   ideas / to-do for the next class (a checklist), free notes.
   The open to-dos also appear on the student's dashboard.
   Firebase: teacher/notes/<student>
     { strong:{id:{text,at}}, weak:{id:{text,at}}, todo:{id:{text,at,done}}, free }
   ============================================================ */
export function initNotes(ctx) {
  const { db, ref, onValue, set, remove, push, STUDENTS, $, esc, toast, go } = ctx;
  const stu = id => STUDENTS.find(s => s.id === id);
  let notes = {}, typing = false;
  onValue(ref(db, 'teacher/notes'), snap => {
    notes = snap.val() || {};
    ctx.onChange();
    if (ctx.route().view === 'notes' && !typing) ctx.renderNotes();
  });
  const list = (sid, kind) => Object.entries((notes[sid] || {})[kind] || {}).sort((a, b) => a[1].at - b[1].at);
  const openTodos = sid => list(sid, 'todo').filter(([, t]) => !t.done);
  const when = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const BOXES = [
    ['strong', 'Strong points', 'What the student already does well', 'e.g. reads short words confidently'],
    ['weak', 'To work on', 'Gaps, typical mistakes, sounds to practise', 'e.g. mixes up a / an before vowels'],
    ['todo', 'Next class', 'Ideas and things to do — tick them off in class', 'e.g. recycle classroom objects with a quiz']
  ];

  ctx.renderNotes = () => {
    const sid = stu(ctx.route().student) ? ctx.route().student : STUDENTS[0].id, s = stu(sid);
    $('nt-tabs').innerHTML = STUDENTS.map(x => { const n = openTodos(x.id).length;
      return `<a class="nt-tab ${x.id === sid ? 'on' : ''}" href="#/notes/${x.id}" style="--c:${x.color}"><span class="avatar small" style="--c:${x.color}">${x.name[0]}</span>${esc(x.name)}${n ? `<span class="badge-new">${n}</span>` : ''}</a>`; }).join('');
    const done = list(sid, 'todo').filter(([, t]) => t.done).length;
    $('nt-body').innerHTML = `<div class="nt-boxes">${BOXES.map(([kind, title, sub, ph]) => `
      <section class="nt-box nt-${kind}">
        <h3>${title}</h3><p class="nt-sub">${sub}</p>
        <ul>${list(sid, kind).map(([id, it]) => `<li class="${it.done ? 'done' : ''}">
          ${kind === 'todo' ? `<input type="checkbox" data-done="${id}" ${it.done ? 'checked' : ''}>` : '<span class="dot-i"></span>'}
          <span class="txt" contenteditable="true" data-edit="${kind}/${id}">${esc(it.text)}</span>
          <small>${when(it.at)}</small><button class="x" data-del="${kind}/${id}" title="Delete">✕</button></li>`).join('') || '<li class="none">Nothing yet.</li>'}</ul>
        <form class="nt-add" data-add="${kind}"><input placeholder="${esc(ph)}"><button class="btn small">Add</button></form>
        ${kind === 'todo' && done ? `<button class="nt-clear" id="nt-clear">Clear ${done} done</button>` : ''}
      </section>`).join('')}</div>
      <section class="nt-free"><h3>Free notes</h3>
        <textarea id="nt-free" rows="6" placeholder="Anything else about ${esc(s.name)}: interests, parents’ wishes, exam dates…">${esc((notes[sid] || {}).free || '')}</textarea></section>`;
    wire(sid);
  };

  function wire(sid) {
    const base = `teacher/notes/${sid}`, body = $('nt-body');
    body.querySelectorAll('[data-add]').forEach(f => f.onsubmit = e => {
      e.preventDefault();
      const input = f.querySelector('input'), text = input.value.trim(); if (!text) return;
      const r = push(ref(db, `${base}/${f.dataset.add}`));
      set(r, { text, at: Date.now(), ...(f.dataset.add === 'todo' ? { done: false } : {}) });
      input.value = '';
      setTimeout(() => { const again = $('nt-body').querySelector(`[data-add="${f.dataset.add}"] input`); if (again) again.focus(); }, 80);
    });
    body.querySelectorAll('[data-done]').forEach(c => c.onchange = () => set(ref(db, `${base}/todo/${c.dataset.done}/done`), c.checked));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(ref(db, `${base}/${b.dataset.del}`)));
    body.querySelectorAll('[data-edit]').forEach(el => {
      el.onfocus = () => { typing = true; };
      el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
      el.onblur = () => { typing = false; const t = el.innerText.trim();
        if (t) set(ref(db, `${base}/${el.dataset.edit}/text`), t); else remove(ref(db, `${base}/${el.dataset.edit}`)); };
    });
    const clr = $('nt-clear');
    if (clr) clr.onclick = () => list(sid, 'todo').filter(([, t]) => t.done).forEach(([id]) => remove(ref(db, `${base}/todo/${id}`)));
    const free = $('nt-free'); let t;
    free.oninput = () => { typing = true; clearTimeout(t); t = setTimeout(() => set(ref(db, `${base}/free`), free.value).then(() => { typing = false; }), 600); };
  }

  // "Next class" sticky note on a student's dashboard
  ctx.renderNextClass = (el, sid) => {
    const todos = openTodos(sid), weak = list(sid, 'weak').slice(-3);
    el.innerHTML = `<div class="sticky">
      <div class="sticky-head"><b>Next class</b><a href="#/notes/${sid}">all notes →</a></div>
      ${todos.length ? `<ul>${todos.map(([id, it]) => `<li><input type="checkbox" data-sdone="${id}"><span>${esc(it.text)}</span></li>`).join('')}</ul>` : '<p class="none">No to-dos yet. <a href="#/notes/' + sid + '">Add ideas</a> for the next class.</p>'}
      ${weak.length ? `<p class="sticky-weak"><span>To work on:</span> ${weak.map(([, w]) => esc(w.text)).join(' · ')}</p>` : ''}
    </div>`;
    el.querySelectorAll('[data-sdone]').forEach(c => c.onchange = () => set(ref(db, `teacher/notes/${sid}/todo/${c.dataset.sdone}/done`), c.checked).then(() => toast('Done ✓')));
  };
  ctx.openTodoCount = sid => openTodos(sid).length;
}
