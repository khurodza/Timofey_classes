/* ============================================================
   End-of-part celebration. Load AFTER lessons.js (+ celebrate.css).
   <div class="card fin" data-steps="hw1,hw2" data-show="letters"></div>   (or data-show="podium")
   The card shows which steps are complete. When every question in them
   is answered, "I finished!" opens: it checks the answers and plays
   the animation, with 1–3 stars for the share of right answers.
   Open the page with ?preview to see the animation without answering.
   ============================================================ */
(function () {
  const $$ = (s, r) => [...r.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SHOW = {
    letters: {
      title: 'You know the letter teams', ru: 'Буквенные пары sh, ch, ph и ck пройдены!',
      bits: ['sh', 'ch', 'ph', 'ck', '★'],
      art: () => '<div class="cel-tiles">' + [['sh', '🐑', '#3352E0'], ['ch', '🍟', '#FF7A45'], ['ph', '📸', '#7B5CE6'], ['ck', '🦆', '#12A374']]
        .map((t, i) => `<div class="cel-tile" style="--i:${i};--c:${t[2]}"><b>${t[0]}</b><i>${t[1]}</i></div>`).join('') + '</div>'
    },
    podium: {
      title: 'You are first in ordinal numbers', ru: 'Порядковые числительные пройдены!',
      bits: ['1st', '2nd', '3rd', '4th', '★'],
      art: () => '<div class="cel-podium">' + [['2nd', 'second', '🥈', 85, '.3s', '#7C8DB5'], ['1st', 'first', '🏆', 125, '.8s', '#E0A100'], ['3rd', 'third', '🥉', 62, '0s', '#C0703A']]
        .map(t => `<div class="cel-place" style="--h:${t[3]}px;--d:${t[4]};--c:${t[5]}"><span>${t[2]}</span><div>${t[0]}<small>${t[1]}</small></div></div>`).join('') + '</div>'
    }
  };
  const COL = ['#3352E0', '#FF7A45', '#7B5CE6', '#12A374', '#FFC53D', '#E03E52'];

  function stepsOf(card) {
    return card.dataset.steps.split(',').map(id => document.getElementById(id)).filter(el => el && !el.matches('.sent-away'));
  }
  // every question in a step: [answered, right]
  function items(step) {
    return [
      ...$$('.blank[data-answer]', step).map(b => [!!b.value.trim(), b.classList.contains('correct')]),
      ...$$('.word-choice[data-answer]', step).map(w => [!!w.querySelector('.selected'), !!w.querySelector('.selected.correct')]),
      ...$$('.mc-options[data-correct]', step).map(g => [!!g.querySelector('.selected'), !!g.querySelector('.selected.correct')]),
      ...$$('.sc-tile:not(.given)', step).map(t => [!!t.closest('.sc-col'), t.classList.contains('correct')]),
      ...$$('[data-side="left"] .match-item', step).map(m => [m.classList.contains('matched'), m.classList.contains('matched')]),
      ...$$('.blank:not([data-answer])', step).map(b => [!!b.value.trim(), true]),
      ...$$('.free-write', step).map(f => [!!f.value.trim(), true])
    ];
  }
  const done = step => items(step).every(x => x[0]);

  function refresh(card) {
    const steps = stepsOf(card), ok = steps.map(done), all = steps.length > 0 && ok.every(Boolean);
    $$('.fin-dots a', card).forEach(a => {
      const i = steps.findIndex(s => '#' + s.id === a.getAttribute('href'));
      a.hidden = i < 0; a.classList.toggle('ok', !!ok[i]);
    });
    card.classList.toggle('ready', all);
    card.querySelector('.btn-accent').disabled = !all;
    card.querySelector('.fin-msg').textContent = all ? 'All done! Press the button.' : 'Complete all the tasks. The green ones are done.';
    card.querySelector('.ru-hint').textContent = all ? 'Всё готово! Нажми на кнопку.' : 'Выполни все задания. Зелёные уже готовы.';
    return all;
  }

  function burst(layer, bits) {
    if (calm) return;
    const W = innerWidth, H = innerHeight;
    for (let i = 0; i < 90; i++) {
      const el = document.createElement('span'), left = i % 2, c = COL[Math.random() * COL.length | 0];
      el.className = 'cel-bit';
      if (i % 3) { el.style.cssText = `width:${8 + Math.random() * 8}px;height:14px;background:${c};border-radius:3px`; }
      else { el.textContent = bits[i / 3 % bits.length]; el.style.color = c; }
      el.style.left = left ? '0' : 'calc(100% - 30px)'; el.style.top = '75%';
      layer.appendChild(el);
      const dx = (left ? 1 : -1) * Math.random() * W * .9, up = -H * (.3 + Math.random() * .45), r = Math.random() * 900 - 450;
      el.animate([
        { transform: 'translate(0,0)', opacity: 0 },
        { opacity: 1, offset: .04 },
        { transform: `translate(${dx * .7}px,${up}px) rotate(${r / 2}deg)`, offset: .35, easing: 'ease-in' },
        { transform: `translate(${dx}px,${H * .4}px) rotate(${r}deg)` }
      ], { duration: 2600 + Math.random() * 1800, delay: (i % 3) * 700 + Math.random() * 250, easing: 'ease-out', fill: 'both' }).onfinish = () => el.remove();
    }
  }
  function fanfare() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [[523, 0], [659, .14], [784, .28], [1047, .42], [784, .62], [1047, .76]].forEach(([f, t], i) => {
        const o = ac.createOscillator(), g = ac.createGain(), at = ac.currentTime + t, len = i === 5 ? .7 : .2;
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(.12, at); g.gain.exponentialRampToValueAtTime(.001, at + len);
        o.connect(g).connect(ac.destination); o.start(at); o.stop(at + len);
      });
      setTimeout(() => ac.close(), 2500);
    } catch (e) {}
  }

  function play(card, preview) {
    const steps = stepsOf(card), cfg = SHOW[card.dataset.show];
    if (!preview) steps.forEach(s => $$('.btn-row .btn-primary', s).forEach(b => b.click()));   // check everything
    const list = steps.flatMap(items), right = preview ? list.length : list.filter(x => x[1]).length, share = right / list.length;
    const stars = share >= .9 ? 3 : share >= .7 ? 2 : 1;
    const name = window.getStudentName ? getStudentName() : '';
    const both = $$('.fin', document).every(c => stepsOf(c).every(done));
    const layer = document.createElement('div');
    layer.className = 'cel';
    layer.innerHTML = '<div class="cel-box" role="dialog" aria-modal="true" aria-labelledby="celTitle">' + cfg.art() +
      '<h2 id="celTitle"></h2><p><b>' + cfg.title + '!</b></p><p class="cel-ru" lang="ru">' + cfg.ru + '</p>' +
      '<div class="cel-stars" aria-label="' + stars + ' of 3 stars">' + [0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}" style="--i:${i}">⭐</span>`).join('') + '</div>' +
      '<p><b>' + right + ' / ' + list.length + '</b>' + (right < list.length ? ' · Look at the red answers and try again.<br><span class="cel-ru" lang="ru">Посмотри на красные ответы и попробуй ещё раз.</span>' : ' · Perfect!') + '</p>' +
      (both ? '<p>🎒 <b>All the homework is done!</b> <span class="cel-ru" lang="ru">Вся домашняя работа готова!</span></p>' : '') +
      '<button class="btn-primary" type="button">Hooray!</button></div>';
    layer.querySelector('h2').textContent = name ? 'Well done, ' + name + '!' : 'Well done!';
    document.body.appendChild(layer);
    const back = document.activeElement, btn = layer.querySelector('button');
    const close = () => { layer.remove(); document.removeEventListener('keydown', key); back && back.focus && back.focus({ preventScroll: true }); };
    const key = e => { if (e.key === 'Escape') close(); if (e.key === 'Tab') { e.preventDefault(); btn.focus(); } };
    document.addEventListener('keydown', key);
    btn.onclick = close;
    layer.onclick = e => { if (e.target === layer) close(); };
    btn.focus({ preventScroll: true });
    burst(layer, cfg.bits); fanfare();
  }

  document.addEventListener('DOMContentLoaded', () => $$('.fin', document).forEach(card => {
    card.innerHTML = '<div class="exercise-label hw">Finish</div><h3 class="fin-msg"></h3><p class="ru-hint" lang="ru" data-auto></p>' +
      '<div class="fin-dots">' + card.dataset.steps.split(',').map(id => `<a href="#${id}" aria-label="Task ${id.replace(/\D/g, '')}">${id.replace(/\D/g, '')}</a>`).join('') + '</div>' +
      '<button class="btn-accent" type="button">🎉 I finished!</button>';
    card.querySelector('.btn-accent').onclick = () => { if (refresh(card)) play(card); };
    if (new URLSearchParams(location.search).has('preview')) {   // teacher: ?preview adds a button that plays the animation and leaves the answers alone
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn-ghost'; b.textContent = '👀 Preview the animation'; b.style.marginLeft = '10px';
      b.onclick = () => play(card, true);
      card.appendChild(b);
    }
    refresh(card);
    if (new URLSearchParams(location.search).get('preview') === card.dataset.show) setTimeout(() => card.scrollIntoView({ block: 'center' }), 600);
    setInterval(() => { if (card.offsetParent) refresh(card); }, 700);   // also catches answers that arrive from another device
  }));
})();
