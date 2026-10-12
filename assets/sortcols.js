/* ============================================================
   SORT INTO COLUMNS: drag each word to the correct column
   Load AFTER lessons.js.
   <div class="card" id="ex-sort">
     <div class="sc-bank" id="sc-01">
       <span class="sc-tile" data-col="an">actor</span> …
     </div>
     <div class="sc-cols">
       <div class="sc-col" data-col="a"><div class="sc-head">a</div>
         <div class="sc-drop"><span class="sc-tile given">city</span></div></div>
       <div class="sc-col" data-col="an"><div class="sc-head">an</div>
         <div class="sc-drop"></div></div>
     </div>
     <button onclick="checkSort('ex-sort')">Check ✓</button>
     <button onclick="resetSort('ex-sort')">Try again</button>
   </div>
   Drag a word into a column, or tap a word and then tap a column.
   Words can be dragged back to the list. Places save automatically.
   ============================================================ */
(function () {
  let picked = null;

  const bankOf = ex => ex.querySelector('.sc-bank');
  const movable = ex => [...ex.querySelectorAll('.sc-tile:not(.given)')];

  function changed(ex) {
    const bank = bankOf(ex), places = {};
    movable(ex).forEach(t => {
      t.classList.remove('correct', 'wrong');
      const col = t.closest('.sc-col');
      if (col) places[t.dataset.i] = col.dataset.col;
    });
    save({ [bank.id]: places });
  }

  function dropInto(ex, tile, x, y) {
    const over = document.elementFromPoint(x, y);
    if (!over || !ex.contains(over)) return false;
    const col = over.closest('.sc-col');
    if (col) { col.querySelector('.sc-drop').appendChild(tile); return true; }
    if (over.closest('.sc-bank')) { bankOf(ex).appendChild(tile); return true; }
    return false;
  }

  function unpick() { if (picked) picked.classList.remove('sc-picked'); picked = null; }

  function init(ex) {
    const bank = bankOf(ex);
    movable(ex).forEach((t, i) => { t.dataset.i = i; });
    ex._tiles = movable(ex);
    const saved = data[bank.id] || {};
    Object.keys(saved).forEach(i => {
      const col = ex.querySelector('.sc-col[data-col="' + saved[i] + '"] .sc-drop');
      if (col && ex._tiles[i]) col.appendChild(ex._tiles[i]);
    });

    ex.addEventListener('pointerdown', e => {
      const tile = e.target.closest('.sc-tile');
      if (!tile || tile.classList.contains('given')) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, r = tile.getBoundingClientRect();
      let ghost = null;

      const onMove = ev => {
        if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        if (!ghost) {
          unpick();
          ghost = tile.cloneNode(true);
          ghost.classList.add('sc-ghost');
          ghost.style.width = r.width + 'px';
          document.body.appendChild(ghost);
          tile.classList.add('sc-drag');
        }
        ghost.style.left = (ev.clientX - (x0 - r.left)) + 'px';
        ghost.style.top = (ev.clientY - (y0 - r.top)) + 'px';
        ex.querySelectorAll('.sc-col').forEach(c => c.classList.remove('sc-over'));
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const col = over && over.closest('.sc-col');
        if (col && ex.contains(col)) col.classList.add('sc-over');
      };
      const onUp = ev => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        ex.querySelectorAll('.sc-col').forEach(c => c.classList.remove('sc-over'));
        if (ghost) {
          ghost.remove(); tile.classList.remove('sc-drag');
          if (dropInto(ex, tile, ev.clientX, ev.clientY)) changed(ex);
          return;
        }
        // tap: pick a word, then tap a column
        if (picked === tile) return unpick();
        unpick(); picked = tile; tile.classList.add('sc-picked');
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    // second tap on a column (or the word list) moves the picked word there
    ex.addEventListener('click', e => {
      if (!picked || !ex.contains(picked) || e.target.closest('.sc-tile')) return;
      const col = e.target.closest('.sc-col');
      if (col) col.querySelector('.sc-drop').appendChild(picked);
      else if (e.target.closest('.sc-bank')) bank.appendChild(picked);
      else return;
      unpick(); changed(ex);
    });
  }

  window.checkSort = function (exId) {
    const ex = document.getElementById(exId);
    movable(ex).forEach(t => {
      const col = t.closest('.sc-col');
      t.classList.remove('correct', 'wrong');
      if (col) t.classList.add(col.dataset.col === t.dataset.col ? 'correct' : 'wrong');
    });
    const left = bankOf(ex).querySelectorAll('.sc-tile').length;
    if (left && window.toast) toast('Move all the words first! (' + left + ' left)');
  };

  window.resetSort = function (exId) {
    const ex = document.getElementById(exId);
    unpick();
    ex._tiles.forEach(t => { t.classList.remove('correct', 'wrong'); bankOf(ex).appendChild(t); });
    save({ [bankOf(ex).id]: {} });
  };

  document.querySelectorAll('.sc-bank').forEach(b => init(b.closest('.card')));
})();
