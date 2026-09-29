/* ============================================================
   Matching: side-by-side pairs
   Load AFTER lessons.js. When a pair is matched correctly, the
   right-hand item moves into the same row as its partner, so the
   two sit side by side. Unmatched right-hand items keep their
   shuffled order in the rows that are still free; Reset puts
   everything back where it started.
   Needs the .match-grid / .match-col rules in style.css
   (the columns use display:contents so both sides share rows).
   ============================================================ */
(function () {
  function align(container) {
    if (!container) return;
    const left = [...container.querySelectorAll('.match-col[data-side="left"] .match-item')];
    const right = [...container.querySelectorAll('.match-col[data-side="right"] .match-item')];
    right.forEach((el, i) => { if (!el.dataset.home) el.dataset.home = i + 1; });

    const rowOfPair = {};
    left.forEach((el, i) => {
      el.style.gridRow = i + 1;
      if (el.classList.contains('matched')) rowOfPair[el.dataset.pair] = i + 1;
    });

    const isPlaced = el => el.classList.contains('matched') && rowOfPair[el.dataset.pair];
    const taken = new Set();
    right.filter(isPlaced).forEach(el => {
      el.style.gridRow = rowOfPair[el.dataset.pair];
      taken.add(rowOfPair[el.dataset.pair]);
    });

    const rows = Math.max(left.length, right.length);
    const free = [];
    for (let r = 1; r <= rows; r++) if (!taken.has(r)) free.push(r);
    right.filter(el => !isPlaced(el))
      .sort((a, b) => a.dataset.home - b.dataset.home)
      .forEach((el, i) => { el.style.gridRow = free[i]; });
  }

  const baseSelect = window.selectMatch;
  const baseReset = window.resetMatchEx;
  window.selectMatch = function (el, exId) { baseSelect(el, exId); align(document.getElementById(exId)); };
  window.resetMatchEx = function (exId) { baseReset(exId); align(document.getElementById(exId)); };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[id^="ex-match"]').forEach(align);
  });
})();
