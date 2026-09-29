/* ============================================================
   Student name — asked once, then shown in the page header.
   On the first visit (any page) a small window asks the student
   to type his name. Until then, headers show their neutral text.

   Mark the places that show the name like this:
     <h1 class="name-slot" data-with="Welcome, {name}!" data-without="Welcome!">Welcome!</h1>
   The name is saved as "studentName" (the same key lessons.js
   uses for its "Nice work, …" message).
   ============================================================ */
(function () {
  const NAME_KEY = 'studentName';
  const DONE_KEY = 'studentNameEntered';

  function read(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function write(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  function currentName() { return read(DONE_KEY) ? read(NAME_KEY).trim() : ''; }

  function render() {
    const name = currentName();
    document.querySelectorAll('.name-slot').forEach(el => {
      el.textContent = name ? el.dataset.with.replace('{name}', name) : el.dataset.without;
    });
    document.dispatchEvent(new CustomEvent('studentnamechange', { detail: name }));
  }

  /* Public: used by the name box on the home page */
  window.setStudentName = function (name) {
    name = (name || '').trim().slice(0, 30);
    write(NAME_KEY, name);
    write(DONE_KEY, name ? '1' : '');
    render();
  };
  window.getStudentName = currentName;

  function askForName() {
    const overlay = document.createElement('div');
    overlay.className = 'name-overlay';
    overlay.innerHTML =
      '<form class="name-dialog" role="dialog" aria-modal="true" aria-labelledby="nameAskTitle">' +
        '<div class="name-wave" aria-hidden="true">👋</div>' +
        '<h2 id="nameAskTitle">Hi! What’s your name?</h2>' +
        '<p>Type your name and press the button.</p>' +
        '<input type="text" id="nameAskInput" maxlength="30" autocomplete="off" placeholder="My name is…" aria-label="Your name">' +
        '<button type="submit" class="btn-primary">Let’s go →</button>' +
      '</form>';
    document.body.appendChild(overlay);
    document.body.classList.add('name-open');

    const form = overlay.querySelector('form');
    const input = overlay.querySelector('input');
    setTimeout(() => input.focus(), 50);

    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) {
        input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
        input.focus();
        return;
      }
      window.setStudentName(name);
      overlay.classList.add('closing');
      document.body.classList.remove('name-open');
      setTimeout(() => overlay.remove(), 220);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    if (!read(DONE_KEY)) askForName();
  });
})();
