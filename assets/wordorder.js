/* ============================================================
   WORD ORDER: put the words in order
   Load AFTER lessons.js.
   <div class="card" id="ex-wo-01">
     <div class="wo-q" id="wo-01-1" data-answer="What’s your name ?">
       <span class="wo-tile">your</span><span class="wo-tile">name</span>…
     </div>
     <button onclick="checkWordOrder('ex-wo-01')">Check ✓</button>
     <button onclick="resetWordOrder('ex-wo-01')">Try again</button>
   </div>
   Drag a word to move it, or tap a word and then tap where it
   should go. The order saves automatically.
   ============================================================ */
(function () {
  let picked = null;

  const tiles = q => [...q.querySelectorAll('.wo-tile')];
  const sentence = q => tiles(q).map(t => t.textContent.trim()).join(' ');

  function changed(q) {
    q.classList.remove('correct', 'wrong');
    save({ [q.id]: tiles(q).map(t => t.dataset.i).join(',') });
    updateScoreBar();
  }

  function moveTo(tile, target, after) {
    if (tile === target) return;
    target.parentNode.insertBefore(tile, after ? target.nextSibling : target);
  }

  function initQ(q) {
    tiles(q).forEach((t, i) => { t.dataset.i = i; t.dataset.home = i; });
    q._start = tiles(q);
    const saved = data[q.id];
    if (saved) saved.split(',').forEach(i => q.appendChild(q._start[i]));

    q.addEventListener('pointerdown', e => {
      const tile = e.target.closest('.wo-tile');
      if (!tile) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY;
      let dragging = false;

      const onMove = ev => {
        if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        dragging = true;
        tile.classList.add('wo-drag');
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = over && over.closest('.wo-tile');
        if (target && target !== tile && target.parentNode === q) {
          const r = target.getBoundingClientRect();
          moveTo(tile, target, ev.clientX > r.left + r.width / 2);
        }
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        tile.classList.remove('wo-drag');
        if (dragging) { if (picked) picked.classList.remove('wo-picked'); picked = null; changed(q); return; }
        // tap: pick a word, then tap another word to put it there
        if (!picked) { picked = tile; tile.classList.add('wo-picked'); return; }
        const from = picked; from.classList.remove('wo-picked'); picked = null;
        if (from === tile || from.parentNode !== q) return;
        const list = tiles(q);
        moveTo(from, tile, list.indexOf(from) < list.indexOf(tile));
        changed(q);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  window.checkWordOrder = function (exId) {
    const scope = exId ? document.getElementById(exId) : document;
    scope.querySelectorAll('.wo-q[data-answer]').forEach(q => {
      const ok = sentence(q).toLowerCase() === q.dataset.answer.trim().toLowerCase();
      q.classList.remove('correct', 'wrong');
      q.classList.add(ok ? 'correct' : 'wrong');
    });
    updateScoreBar();
  };

  window.resetWordOrder = function (exId) {
    document.getElementById(exId).querySelectorAll('.wo-q').forEach(q => {
      q._start.forEach(t => q.appendChild(t));
      q.classList.remove('correct', 'wrong');
      save({ [q.id]: '' });
    });
    updateScoreBar();
  };

  document.querySelectorAll('.wo-q').forEach(initQ);

  // count word-order questions in the score badge and "Check my answers"
  const baseCheckAll = window.checkAll;
  window.woScore = () => {
    const qs = [...document.querySelectorAll('.wo-q[data-answer]')];
    return { total: qs.length, done: qs.filter(q => data[q.id]).length, correct: qs.filter(q => q.classList.contains('correct')).length };
  };
  window.checkAll = function () { checkWordOrder(); baseCheckAll(); };
  updateScoreBar();
})();
