# How to Build Lessons — Guide

## Project structure

```
website/
├── index.html              ← Home page (greets by name, lists all lessons)
├── GUIDE.md                 ← This file
├── assets/
│   ├── style.css             ← All shared visual styles — don't touch unless redesigning
│   └── lessons.js             ← All shared exercise logic — don't touch unless changing behaviour
└── lessons/
    ├── lesson-template.html   ← Blank class-lesson template — copy this for a new lesson
    ├── lesson-01.html          ← Lesson 1: site tour + placement test + 4 follow-up tabs
    ├── images/                 ← Put lesson images here
    ├── audio/                  ← Put lesson audio files here
    └── homework/
        ├── homework-template.html   ← Blank homework template — copy this for new homework
```

Each lesson has its own homework page, kept in a separate `homework/`
subfolder rather than being a section inside the lesson itself. The lesson
page links out to its homework page (and back), and the home page lists both.

There is no lesson number to set by hand anywhere in the JavaScript — every
page automatically saves its answers under its own file name, so lessons and
homework pages never mix up their saved answers.

---

## The student's name

The first time the site is opened (any page), a small window asks the student
to type his name (`assets/name.js`). Until he does, headers show neutral text.
To show the name somewhere, give the element the class `name-slot`:

```html
<h1 class="name-slot" data-with="Lesson 2: Hi, {name}!" data-without="Lesson 2">Lesson 2</h1>
```

He can change it later in the "Your name" box on the home page.

---

## Adding a new lesson (with its homework)

1. **Copy the lesson template.** Duplicate `lessons/lesson-template.html` and
   rename it `lessons/lesson-02.html` (always two digits: `02`, `03`, …).
2. **Copy the homework template.** Duplicate
   `lessons/homework/homework-template.html` and rename it
   `lessons/homework/homework-02.html`.
3. **Replace every `★` placeholder** in both files — title, headings,
   instructions, badges, answers. Update the `NUMBER` in file paths too:
   the lesson's "Go to homework" link and the homework's "Back to Lesson"
   link both need the real lesson number.
4. **Add a card on the home page.** Open `index.html`, find the comment
   `ADD NEW LESSON CARDS HERE`, and paste a copy of the `.lesson-card` block
   right below it (at the top of the list), updating the number, topic, tags,
   date, and both `href`s (lesson and homework). Newest lesson goes first —
   each new card pushes the earlier ones down, so the list always reads
   newest-to-oldest.
5. **Delete anything you don't need** — exercise blocks, embed slots, whole
   `<section class="step">` blocks. Copy a block to add more of the same type.

Card colours on the home page and step-number badges inside a page cycle
automatically — you never set a colour yourself. Homework pages use a violet
header instead of the navy-blue one, so it's visually obvious which mode you're in.

Timofey's site has its own look ("language explorer": navy/blue, rounded
cards, a floating score bar). It uses exactly the same class names as the
original site, so every exercise snippet below works unchanged.

Each lesson card shows small topic tags under its title (`.lesson-tags` >
`.lesson-tag` spans) — one per vocabulary/grammar focus of that lesson, e.g.
`comparatives`, `phrasal verbs`, `past simple`. Keep them short (1-3 words),
lowercase, and specific to what's actually taught.

---

## Exercise types

### Fill in the blanks

```html
<input class="blank" id="f1" data-answer="cat">
```

- `data-answer` is checked case-insensitively.
- More than one accepted answer: separate with `|` → `data-answer="cat|kitten"`
- Wrap the exercise in a card with a unique `id` and pass it to the buttons:
  `onclick="checkBlanks('ex-fill')"` / `onclick="resetBlanks('ex-fill')"`
- Every `<input>` needs its own unique `id` across the whole page.
- To highlight the word the student has to change (the adjective in brackets,
  the base form before an arrow), wrap it in `<span class="cue">happy</span>` —
  a yellow pill. Use it only for words that get transformed, not for emphasis.
- Inside a long sentence, don't put the word in brackets after the blank — it
  wraps to the next line and is hard to follow. Use the label form instead: the
  word sits on a small yellow label directly above the input box.

```html
<span class="cue-input">
  <span class="cue-lab">long</span>
  <input class="blank" id="qz1" data-answer="longer" placeholder="?">
</span>
```

  For the worked example, swap the `<input>` for `<span class="given">longer</span>`
  (a dashed green box, not editable).

### Two-speaker dialogue

```html
<div class="dialogue">
  <span class="dl-name">Daniel</span>
  <p class="dl-text ask">Which match is … ?</p>
  <span class="dl-name two">Andrea</span>
  <p class="dl-text">I don't know.</p>
</div>
```

Names become colour chips in their own column (`.two` = the second speaker, a
different colour). Add `ask` to the lines that contain the blanks — they get a
soft yellow background, so it's obvious at a glance which lines need answers.

### Multiple choice

```html
<div class="mc-options" data-correct="b">
  <label class="mc-option"><input type="radio" name="mc1" value="a"><span class="mc-bullet">A</span> dog</label>
  <label class="mc-option"><input type="radio" name="mc1" value="b"><span class="mc-bullet">B</span> cat</label>
</div>
```

- `data-correct` = the `value` of the right option.
- Use a different `name="mcX"` for every question on the page.
- `onclick="checkMC('ex-mc')"` / `onclick="resetMC('ex-mc')"`

### Matching

```html
<div class="match-item" data-pair="1" onclick="selectMatch(this,'ex-match-01')">word</div>
```

- Wrap each matching exercise in a container with a unique `id` starting with
  `ex-match` (e.g. `ex-match-01`, `ex-match-02`).
- Items on both sides with the same `data-pair` number are a correct pair.
- Shuffle the right-hand column order so pairs don't line up visually.
- The string inside `selectMatch(this,'…')` must match the container's `id`.
- When a pair is matched correctly, the right-hand item moves level with its
  partner so the pair sits side by side (`assets/matching.js`, loaded after
  `lessons.js` — the templates already include it).

### Word choice (inline buttons, e.g. take/give)

```html
<span class="word-choice" id="wc1" data-answer="take">
  <button class="word-choice-btn" onclick="selectWord(this)">take</button>
  <button class="word-choice-btn" onclick="selectWord(this)">give</button>
</span>
```

### Crossword (advanced)

A vocabulary-review crossword (see Lesson 1's "Remember the words?" step) uses
its own cell class, `.xw-blank`, instead of `.blank` — so its many single-letter
cells don't flood the main lesson score bar. Each cell is placed on a CSS grid
by coordinates:

```html
<div class="xw-grid" style="grid-template-columns:repeat(12,38px);grid-template-rows:repeat(16,38px)">
  <div class="xw-cell" style="grid-column:2;grid-row:8">
    <span class="xw-num">2</span>
    <input type="text" class="xw-blank" maxlength="1" id="xw-c1-r7" data-answer="O">
  </div>
  ...
</div>
```

- Cell ids must follow `xw-c{col}-r{row}` (0-indexed) — typing a letter
  auto-advances to the next cell below in that column.
- Add `xw-grey` to a cell's classes to highlight a "mystery word" row.
- Add `xw-given` (and swap the `<input>` for a plain `<span class="xw-letter">`)
  for a pre-filled example word.
- Check/reset with `checkBlanks('containerId','xw-blank')` /
  `resetBlanks('containerId','xw-blank')` — the extra second argument is what
  keeps crossword cells out of `checkAll()` and the sticky score bar.

Building the grid coordinates by hand is tedious and error-prone — this was
generated from a pixel analysis of the original workbook puzzle. Ask Claude
to build a new one from a photo or PDF of the puzzle rather than hand-placing
cells.

### Parts inside a lesson (tabs)

A long lesson can be split into named parts (e.g. *Let's remember* /
*Say it*). Big tabs under the header switch between them; only one part
is shown at a time, and each part has its own sticky chip nav and its own
step numbering starting from 1. The open tab is remembered per lesson.

```html
<nav class="parts">
  <div class="wrap">
    <button class="part-tab" data-part="part-remember" onclick="showPart('part-remember')">Let's remember</button>
    <button class="part-tab" data-part="part-say-it" onclick="showPart('part-say-it')">Say it</button>
  </div>
</nav>

<div class="lesson-part" id="part-remember">
  <nav class="chips"> …one chip per step in this part… </nav>
  <div class="wrap"> …<section class="step">…</section>… </div>
</div>
<div class="lesson-part" id="part-say-it"> …same again… </div>
```

- `data-part` and the `showPart('…')` argument must equal the part's `id`.
- Step / input ids still have to be unique across the whole page — use a
  different prefix per part (e.g. `s1…` in the first, `t1…` in the second).
- The score bar counts every part together.
- Homework can be a part too (Lesson 4 does this): give its tab the extra
  class `hw` so it turns lilac when open, and link to it from the home page
  with `lessons/lesson-NN.html#part-homework` instead of a separate
  `homework/homework-NN.html` file.

### Tap to underline (find the phrases in a text)

```html
<div class="card" id="ex-find">
  <p><span class="tap" data-key onclick="toggleTap(this)">Look!</span>
     <span class="tap" onclick="toggleTap(this)">Our team is playing.</span></p>
  <button onclick="checkTap('ex-find')">Check</button>
  <button onclick="resetTap('ex-find')">Try again</button>
</div>
```

- Every chunk the student can tap is a `.tap` span; the ones they should
  find carry `data-key`. Tapping underlines; checking marks green/red.
- Selections autosave; the container needs a unique `id`.

### Reflection checklist (Finish step)

```html
<label class="reflect-item">
  <input type="checkbox" id="r1">
  <span class="check-box"></span>
  <span class="reflect-text">know about boccia</span>
</label>
```

Used in the "Finish" step instead of a summary paragraph — he ticks off what he
now knows or can do, rather than reading back what happened in class. Each
checkbox needs a unique `id`; ticks autosave and there's no correct/wrong
state. Add or remove items to match what the lesson actually covered.

### Free writing

```html
<textarea class="free-write" id="fw-unique" placeholder="Write here…" rows="4"></textarea>
<div class="char-count" id="cc-fw-unique">0 characters</div>
```

Saves on every keystroke. There's no automatic checking for writing — that's
something to go over separately.

### Embeds

- **Wordwall** — Wordwall blocks embedding in local files, so use the link
  button (`.wordwall-btn`) instead of an iframe.
- **YouTube** — paste the video's embed URL into the iframe `src`.
- **Audio** — put the file in `lessons/audio/` and point `<source src="...">`
  at it, inside `<div class="audio-wrap"><audio controls>…</audio></div>`.
  `lessons.js` automatically swaps the browser's plain player for the styled
  one (play/pause, back 5 s, seek bar, 0.75× slow-down) — nothing to add.
- **Images** — put the file in `lessons/images/` and point `<img src="...">`
  at it.

---

## The sticky score bar

Every lesson and homework page has its own score bar pinned to the bottom of
the screen. It counts every fill-in-the-blank and multiple-choice exercise on
that page automatically — nothing to configure. It stays hidden until the
page has at least one of those exercises. Clicking **Check my answers**
checks everything on the page at once and shows a small confirmation toast.
A lesson page and its homework page score separately, since they're separate
pages.

---

## Answers and saving

- Everything (typed answers, selected choices, matched pairs, writing) saves
  automatically to the browser as it's typed — no save button, and no
  teacher involvement needed for it to work.
- Answers persist between visits as long as the same browser and device are
  used.
- Switching device or clearing browser data loses saved answers — the lesson
  content itself is not affected.
- You cannot see the answers remotely. This is designed for independent,
  self-paced use — he opens a lesson or homework page on his own and works
  through it.

---

## Picture credits

The class-English pictures in `lessons/images/class-english/` are Microsoft
Fluent Emoji (MIT licence, see the licence file in that folder).

---

## Publishing to GitHub Pages

1. Upload the whole `website` folder to a GitHub repository.
2. In the repository: **Settings → Pages → Source → Deploy from branch →
   main / root**.
3. GitHub gives you a URL like `https://yourusername.github.io/reponame/`.
4. Share that URL with Timofey — he can bookmark it and open it from any
   browser.

If you already use GitHub Desktop for `polina_classes`, the same four-click
workflow applies here: **edit → open GitHub Desktop → write a summary →
Commit to main → Push origin**.

---

## Checklist when adding a new lesson

- [ ] Copied `lesson-template.html` → renamed to `lesson-NN.html`
- [ ] Copied `homework/homework-template.html` → renamed to `homework/homework-NN.html`
- [ ] Replaced every `★` placeholder in both files
- [ ] Updated the lesson number in both files' cross-links (lesson → homework, homework → lesson)
- [ ] Added a `.lesson-card` block in `index.html` with both the lesson and homework `href`s
- [ ] Placed any images in `lessons/images/`, audio in `lessons/audio/`
- [ ] Every exercise container has a unique `id`
- [ ] Every input/textarea has a unique `id`
- [ ] Every MC question group has a unique `name="mcX"`
- [ ] Every matching container's `id` starts with `ex-match`
