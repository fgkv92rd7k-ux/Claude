'use strict';
// study.js — the Film Room: what you are learning, asked back at you between drives.
//
//  • Decks: two built-in (decks.js) plus anything you paste or upload. Four input shapes are understood:
//      Q:/A: pairs, "term | definition" style lines (tab, |, ::, —, -, or "term: definition"), our own JSON backup,
//      and free text, which Claude turns into cards when the page runs inside claude.ai (the `sample` capability);
//      offline the page falls back to fill-in-the-blank cards cut from your sentences.
//  • Scheduling: SM-2 spaced repetition. A miss comes back in ten minutes; a hit comes back in 1, 3, then ef× days.
//    Due cards first, then new cards (easy ones first, decks interleaved), then the soonest-due card.
//  • Grading is automatic (fast + no hint = 5, correct = 4, after a hint = 3, miss = 1); typed answers are matched
//    with accents/articles stripped, numerically, or within one or two typos. "Reveal" lets you grade yourself.
//  • Cadence: at changes of possession, every quarter, or every N plays; and a timer while the game is idle.
//  • Progress lives in this browser (localStorage). Export makes a JSON backup; paste it back to restore.
// ui.js wires the hooks: Study.onResult(ok, card) feeds momentum; Study.gameBreak() and Study.tick() decide when to ask.

const Study = (() => {
  const KEY = 'mbowl.study', DAY = 864e5, MIN = 6e4;
  const DEF = () => ({ v: 1, decks: {}, prog: {}, set: { when: 'poss', every: 4, timer: 5, off: [], stakes: true }, stats: { answered: 0, right: 0, streak: 0, best: 0, day: '', today: 0 } });
  let S = DEF();
  try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.v === 1) S = Object.assign(DEF(), j, { set: Object.assign(DEF().set, j.set), stats: Object.assign(DEF().stats, j.stats) }); } catch (e) {}
  let saveT = 0; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 150); };
  const now = () => Date.now(), el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hash = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x.toString(36); };
  const normA = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9ℝℚℕ∞π√.\-]+/g, ' ').trim();
  const normQ = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function lev(a, b) { // edit distance, small strings only
    if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m + n; let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }

  // ---- cards ----
  // Accepts our own shape or Claude's: {type, q, choices, a, alt, hint, why, level}. Returns a clean card or null.
  function normCard(c, deck) {
    if (!c || typeof c !== 'object') return null;
    const q = String(c.q || c.question || '').trim(), type = c.type === 'mc' ? 'mc' : 'short'; if (!q) return null;
    const card = { id: 'c' + hash(deck + '|' + q), deck, type, q, hint: String(c.hint || '').trim(), why: String(c.why || c.explanation || '').trim(), level: Math.min(3, Math.max(1, +c.level || 2)) };
    if (type === 'mc') {
      const ch = (Array.isArray(c.choices) ? c.choices : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 4); if (ch.length < 2) return null;
      const a = typeof c.a === 'number' ? c.a : ch.findIndex((s) => normA(s) === normA(c.a == null ? c.answer : c.a)); if (a < 0 || a >= ch.length) return null;
      card.choices = ch; card.a = a;
    } else {
      const a = String(c.a == null ? c.answer : c.a).trim(); if (!a) return null;
      card.a = a; card.alt = (Array.isArray(c.alt) ? c.alt : []).map((s) => String(s).trim()).filter(Boolean);
    }
    return card;
  }
  const builtin = () => (typeof DECKS !== 'undefined' ? DECKS : []).map((d) => (d._n || (d._n = { id: d.id, name: d.name, blurb: d.blurb, builtin: true, cards: d.cards.map((c) => normCard(c, d.id)).filter(Boolean) })));
  const userDecks = () => Object.values(S.decks).sort((a, b) => a.ts - b.ts);
  const allDecks = () => builtin().concat(userDecks());
  const deckOn = (d) => !S.set.off.includes(d.id) && d.cards.length > 0;
  const deckOf = (c) => allDecks().find((d) => d.id === c.deck);
  const prog = (c) => S.prog[c.id];
  const pool = () => { const out = []; for (const d of allDecks()) if (deckOn(d)) for (const c of d.cards) out.push(c); return out; };
  const dueCount = (cards) => { const t = now(); let n = 0; for (const c of cards) { const p = prog(c); if (p && p.due <= t) n++; } return n; };

  // ---- scheduling (SM-2) ----
  function grade(card, q) {
    const p = S.prog[card.id] || (S.prog[card.id] = { ef: 2.5, iv: 0, due: 0, reps: 0, lapses: 0, seen: 0, right: 0 }), t = now();
    p.seen++; p.last = t;
    if (q < 3) { p.reps = 0; p.iv = 0; p.lapses++; p.due = t + 10 * MIN; }
    else { p.right++; p.reps++; p.iv = p.reps === 1 ? 1 : p.reps === 2 ? 3 : Math.round(p.iv * p.ef); p.due = t + p.iv * DAY; }
    p.ef = Math.max(1.3, p.ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    const st = S.stats, day = new Date().toDateString(); if (st.day !== day) { st.day = day; st.today = 0; }
    st.answered++; st.today++; if (q >= 3) { st.right++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
    save();
  }
  const recent = [];
  function pick() {
    const P = pool(); if (!P.length) return null; const t = now(), skip = new Set(recent.slice(-4));
    const due = P.filter((c) => prog(c) && prog(c).due <= t && !skip.has(c.id)).sort((a, b) => prog(a).due - prog(b).due);
    if (due.length) return due[Math.floor(Math.random() * Math.min(3, due.length))];
    const fresh = P.filter((c) => !prog(c) && !skip.has(c.id));
    if (fresh.length) { // interleave: take from the deck you have seen least, easy cards first
      const seen = {}; for (const id in S.prog) { const c = P.find((x) => x.id === id); if (c) seen[c.deck] = (seen[c.deck] || 0) + 1; }
      fresh.sort((a, b) => (seen[a.deck] || 0) - (seen[b.deck] || 0) || a.level - b.level || Math.random() - 0.5);
      return fresh[Math.floor(Math.random() * Math.min(3, fresh.length))];
    }
    const soon = P.filter((c) => !skip.has(c.id)).sort((a, b) => prog(a).due - prog(b).due); return soon[0] || P[0];
  }

  // ---- answering ----
  function matches(card, input) {
    const u = normA(input); if (!u) return false;
    const opts = [card.a].concat(card.alt || []).map(normA);
    if (opts.includes(u)) return true;
    const nu = parseFloat(u.replace(/\s/g, '')); if (!isNaN(nu)) for (const o of opts) { const no = parseFloat(o.replace(/\s/g, '')); if (!isNaN(no) && Math.abs(no - nu) <= 1e-9 * Math.max(1, Math.abs(no))) return true; }
    for (const o of opts) if (o.length >= 5 && lev(u, o) <= (o.length >= 9 ? 2 : 1)) return true;
    return false;
  }
  const CHEER = ['FIRST DOWN, BRAIN.', 'RIGHT ON THE NUMBERS.', 'THAT’S A CLINIC.', 'TEXTBOOK.', 'MOVE THE CHAINS.', 'PRIME TIME ANSWER.', 'NOTHING BUT GREEN GRASS.'];
  const GROAN = ['FLAG ON THE PLAY. WATCH THE FILM.', 'INCOMPLETE. HERE’S THE READ.', 'BACK TO THE HUDDLE.', 'THE COVERAGE HAD YOU. STUDY THE TAPE.'];

  const Q = { card: null, order: null, t0: 0, hinted: false, done: false, resume: null, src: '' };
  let lastAsk = now(), fresh = true, last = { plays: 0, poss: -1, qtr: 0 };
  const api = { open: false, onResult: null };

  function render() {
    const box = el('quiz'), c = Q.card, d = deckOf(c), st = S.stats, due = dueCount(pool());
    box.innerHTML = ''; box.hidden = false; box.scrollTop = 0;
    box.append(h('h2', '', `FILM ROOM <span>${esc(d ? d.name : '')} · ${['', 'easy', 'medium', 'hard'][c.level]}${due ? ' · ' + due + ' due' : ''}${st.streak >= 2 ? ' · streak ' + st.streak : ''}</span>`));
    box.append(h('div', 'qz-q', esc(c.q)));
    if (c.type === 'mc') {
      Q.order = c.choices.map((_, i) => i).sort(() => Math.random() - 0.5);
      const g = h('div', 'qz-ch'); Q.order.forEach((ci, n) => { const b = h('button', 'choice', `<b>${'ABCD'[n]}</b><span>${esc(c.choices[ci])}</span>`); b.type = 'button'; b.dataset.i = ci; b.addEventListener('click', () => answer(ci)); g.append(b); }); box.append(g);
    } else {
      const r = h('div', 'qz-in'), inp = h('input'); inp.type = 'text'; inp.id = 'qzIn'; inp.autocomplete = 'off'; inp.autocapitalize = 'off'; inp.placeholder = 'Type your answer';
      const go = btn('Check', () => answer(inp.value), 'go'); go.style.flex = '0 0 auto'; go.style.marginBottom = '0'; go.style.fontSize = '17px';
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(inp.value); } });
      r.append(inp, go); box.append(r); setTimeout(() => { try { inp.focus(); } catch (e) {} }, 50);
    }
    const tools = row(); const hb = btn('Hint', () => { if (Q.hinted || Q.done) return; Q.hinted = true; hb.disabled = true; hint.textContent = c.hint ? 'Hint: ' + c.hint : 'No hint on this one.'; hint.hidden = false; }); hb.disabled = !c.hint;
    tools.append(hb);
    if (c.type === 'short') tools.append(btn('Reveal', () => reveal()));
    const sk = btn('Skip', () => finish(null)); sk.style.flex = '0 0 auto'; sk.style.opacity = '.7'; tools.append(sk);
    const hint = h('div', 'qz-hint'); hint.hidden = true; box.append(tools, hint);
  }
  function lockChoices(ci) { for (const b of el('quiz').querySelectorAll('.choice')) { b.disabled = true; const i = +b.dataset.i; if (i === Q.card.a) b.classList.add('ok'); else if (i === ci) b.classList.add('no'); } }
  function feedback(ok, q, answered) {
    const c = Q.card, box = el('quiz'), fb = h('div', 'qz-fb ' + (ok ? 'ok' : 'no'));
    const ans = c.type === 'mc' ? c.choices[c.a] : c.a;
    fb.append(h('b', '', ok ? CHEER[Math.floor(Math.random() * CHEER.length)] : GROAN[Math.floor(Math.random() * GROAN.length)]));
    if (!ok || c.type === 'short') fb.append(h('p', '', `<span style="color:var(--ink)">${ok ? 'Yours counts.' : 'Answer:'}</span> ${esc(ans)}${!ok && answered ? ` <span style="opacity:.7">(you said: ${esc(answered)})</span>` : ''}`));
    if (c.why) fb.append(h('p', '', esc(c.why)));
    const p = prog(c); fb.append(h('p', '', ok ? `Next review in ${p.iv >= 1 ? p.iv + (p.iv === 1 ? ' day' : ' days') : 'a bit'}.` : 'Comes back in about ten minutes.'));
    const cont = btn(Q.src === 'game' ? 'Back to the game' : 'Continue', () => finish(ok), 'go'); cont.id = 'qzGo'; fb.append(row(cont)); box.append(fb);
    setTimeout(() => { try { cont.focus(); } catch (e) {} }, 30);
    if (api.onResult) api.onResult(ok, c, { q, streak: S.stats.streak });
  }
  function answer(a) {
    if (Q.done) return; const c = Q.card; let ok, said = '';
    if (c.type === 'mc') { ok = a === c.a; lockChoices(a); } else { said = String(a || '').trim(); if (!said) return; ok = matches(c, said); const inp = el('qzIn'); if (inp) inp.disabled = true; }
    Q.done = true; const fast = now() - Q.t0 < 12000, q = ok ? (Q.hinted ? 3 : fast ? 5 : 4) : 1;
    grade(c, q); recent.push(c.id); feedback(ok, q, said);
  }
  function reveal() { // self-graded: honest answers are the whole point
    if (Q.done) return; Q.done = true; const c = Q.card, box = el('quiz'), inp = el('qzIn'); if (inp) inp.disabled = true;
    const fb = h('div', 'qz-fb'); fb.append(h('b', '', 'THE ANSWER'), h('p', '', `<span style="color:var(--ink)">${esc(c.a)}</span>${c.alt && c.alt.length ? ' <span style="opacity:.7">(also: ' + esc(c.alt.join(', ')) + ')</span>' : ''}`));
    if (c.why) fb.append(h('p', '', esc(c.why)));
    fb.append(h('p', '', 'Did you have it?'), row(btn('I had it', () => { fb.remove(); grade(c, 3); recent.push(c.id); feedback(true, 3, ''); }), btn('Missed it', () => { fb.remove(); grade(c, 1); recent.push(c.id); feedback(false, 1, ''); })));
    box.append(fb);
  }
  function finish(ok) {
    el('quiz').hidden = true; api.open = false; lastAsk = now(); const r = Q.resume; Q.resume = null; if (r) r();
  }
  // Open the question sheet. resume() runs when it closes. Returns false when there is nothing to ask.
  function ask(resume, src) {
    if (api.open) return false; const card = pick(); if (!card) return false;
    Object.assign(Q, { card, t0: now(), hinted: false, done: false, resume: resume || null, src: src || '' }); api.open = true; render(); return true;
  }

  // ---- when to ask ----
  function gameStart(G) { fresh = true; last = { plays: 0, poss: G ? G.poss : -1, qtr: G ? G.qtr : 1 }; }
  // ctx: { plays, poss, qtr, next }. Returns true when a question opened (resume() continues the game).
  function gameBreak(ctx, resume) {
    const w = S.set.when; if (w === 'off' || !pool().length) return false;
    if (fresh) { fresh = false; last = { plays: ctx.plays, poss: ctx.poss, qtr: ctx.qtr }; return false; }
    const gap = ctx.plays - last.plays; let go = false;
    if (w === 'poss') go = gap >= 2 && (ctx.poss !== last.poss || ctx.next === 'ko');
    else if (w === 'qtr') go = ctx.qtr !== last.qtr;
    else if (w === 'plays') go = gap >= (S.set.every || 4);
    if (!go) return false;
    last = { plays: ctx.plays, poss: ctx.poss, qtr: ctx.qtr };
    return ask(resume, 'game');
  }
  function tick(safe) { // the idle timer: ask while nothing is happening on the field
    if (!safe || api.open || !S.set.timer) return; if (now() - lastAsk < S.set.timer * MIN) return; if (ask(null, 'timer')) lastAsk = now();
  }

  // ---- making cards from what you paste ----
  function parseQA(text) {
    const out = []; let q = null;
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.match(/^\s*(?:q|question)\s*\d*\s*[:.)\-]\s*(.+)$/i), a = raw.match(/^\s*(?:a|answer)\s*\d*\s*[:.)\-]\s*(.+)$/i);
      if (m) q = m[1].trim(); else if (a && q) { out.push([q, a[1].trim()]); q = null; }
    }
    return out;
  }
  const SEPS = [/\t+/, / \| /, / :: /, / — /, / – /, / - /, /\|/];
  function parseDelimited(text) {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^#/.test(s)); if (lines.length < 2) return null;
    for (const sep of SEPS.concat([null])) {
      const pairs = [];
      for (const ln of lines) {
        let parts; if (sep) { const i = ln.search(sep); if (i < 0) continue; const m = ln.match(sep); parts = [ln.slice(0, i), ln.slice(i + m[0].length)]; }
        else { const i = ln.indexOf(': '); if (i < 1 || i > 70) continue; parts = [ln.slice(0, i), ln.slice(i + 2)]; }
        const [l, r] = parts.map((s) => s.trim().replace(/^"|"$/g, '')); if (l && r) pairs.push([l, r]);
      }
      if (pairs.length >= 2 && pairs.length >= lines.length * 0.6) return pairs;
    }
    return null;
  }
  // term/definition pairs -> a recall card each, plus multiple-choice cards whose distractors are the other definitions
  function cardsFromPairs(pairs, deck, qaOrder) {
    const out = [], isQ = (s) => /\?$/.test(s) || /^(what|which|who|when|where|why|how|name|define|state|give)\b/i.test(s);
    pairs.forEach(([l, r], n) => {
      const qFirst = qaOrder || (isQ(l) && !isQ(r)), q = qFirst ? l : r, a = qFirst ? r : l;
      out.push({ type: 'short', q: qFirst ? q : `Which term is this? ${q}`, a, hint: a.length > 2 ? `${a.length} characters, starts with “${a[0]}”` : '', why: qFirst ? '' : `${a}: ${q}`, level: 2 });
      if (pairs.length >= 4 && !qFirst && r.length <= 160) {
        const others = pairs.filter((p, i) => i !== n).map((p) => p[1]).sort(() => Math.random() - 0.5).slice(0, 3);
        out.push({ type: 'mc', q: `Which describes “${l}”?`, choices: [r].concat(others), a: 0, hint: '', why: `${l}: ${r}`, level: 1 });
      }
    });
    return out.map((c) => normCard(c, deck)).filter(Boolean);
  }
  // Offline fallback for free text: blank out a telling word in each good sentence.
  function cloze(text, deck) {
    const sents = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter((s) => s.length >= 40 && s.length <= 220);
    const out = [];
    for (const s of sents) {
      const words = s.split(' '); let best = -1, score = 0;
      words.forEach((w, i) => { const t = w.replace(/[^A-Za-z0-9\-]/g, ''); if (i === 0 || t.length < 4) return; let sc = t.length; if (/^[A-Z]/.test(t)) sc += 6; if (/\d/.test(t)) sc += 5; if (sc > score) { score = sc; best = i; } });
      if (best < 0) continue; const ans = words[best].replace(/[^A-Za-z0-9\-]/g, ''), q = words.map((w, i) => (i === best ? w.replace(ans, '_____') : w)).join(' ');
      out.push({ type: 'short', q, a: ans, hint: `${ans.length} letters, starts with “${ans[0]}”`, why: s, level: 2 }); if (out.length >= 24) break;
    }
    return out.map((c) => normCard(c, deck)).filter(Boolean);
  }
  const PROMPT = (name, n, text) => `You are a sharp, kind tutor writing ${n} study cards from a learner's notes for a quiz game. Favour questions that test understanding (why, how, compare, apply, pick the counterexample) over pure recall, but include a few key-term recall cards. Every card must be answerable from the notes alone and self-contained (the learner will not see the notes). Mix difficulty.
Reply with ONLY a JSON array of card objects, no prose, like:
[{"type":"mc","q":"...","choices":["...","...","...","..."],"a":"<the correct choice, verbatim>","hint":"...","why":"...","level":2},{"type":"short","q":"...","a":"<1-3 words or a number>","alt":["accepted spelling"],"hint":"...","why":"...","level":1}]
Rules: "mc" has exactly 4 plausible choices with one correct and "a" equal to that choice; "short" answers are 1 to 3 words or a number with "alt" spellings; "hint" nudges without giving the answer; "why" is 1 or 2 sentences explaining the answer; "level" is 1 easy, 2 medium or 3 hard. Plain text and Unicode only (ε, ℝ, x², aₙ), never LaTeX or Markdown.
Deck name: ${name}
NOTES:
${text}`;
  let ctl = null;
  async function claudeCards(text, name, onStatus) {
    const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
    if (!sample) throw { code: 'unavailable' };
    const slice = text.slice(0, 16000); if (text.length > 16000) onStatus('Notes are long: using the first 16,000 characters.');
    ctl = new AbortController(); const n = Math.min(16, Math.max(8, Math.round(slice.length / 600)));
    const arr = await sample.json(PROMPT(name, n, slice), { modelTier: 'default', signal: ctl.signal, onText: () => onStatus('Writing cards…') });
    ctl = null; if (!Array.isArray(arr)) throw { code: 'invalid_json' };
    return arr;
  }
  const ERR = { not_granted: 'Claude isn’t allowed on this page yet, so the cards were cut from your sentences instead.', rate_limited: 'Claude is busy right now. Try again in a minute.', invalid_json: 'Claude’s reply wasn’t usable. Try again or paste fewer notes.', refused: 'Claude declined these notes. Try different text.', cancelled: 'Stopped.', unavailable: 'Claude-made cards need this page open in claude.ai. Offline, cards are cut from your sentences.', prompt_too_large: 'Too much text at once. Paste a smaller section.' };
  function addDeck(name, cards, made) {
    const id = 'u' + now().toString(36), d = { id, name: name || 'My notes', cards: [], made, ts: now() };
    const seen = new Set(); for (const c of cards) { const k = normQ(c.q); if (seen.has(k)) continue; seen.add(k); d.cards.push(Object.assign({}, c, { deck: id, id: 'c' + hash(id + '|' + c.q) })); }
    S.decks[id] = d; save(); return d;
  }
  // Main entry for the upload box. Returns {deck, note}.
  async function make(text, name, onStatus, forceClaude) {
    text = String(text || '').trim(); if (!text) throw { code: 'empty' }; name = (name || '').trim() || 'My notes';
    if (/^[\[{]/.test(text)) try { const j = JSON.parse(text); const r = importJSON(j); if (r) return r; } catch (e) {}
    const qa = parseQA(text); if (qa.length >= 2 && !forceClaude) return { deck: addDeck(name, cardsFromPairs(qa, 'tmp', true), 'pairs'), note: `${qa.length} question/answer pairs found.` };
    const dl = !forceClaude && parseDelimited(text);
    if (dl) { const d = addDeck(name, cardsFromPairs(dl, 'tmp', false), 'pairs'); return { deck: d, note: `${dl.length} term/definition pairs found: ${d.cards.length} cards (recall plus multiple choice).` }; }
    onStatus('Asking Claude to write cards… (this can take a minute)');
    try { const raw = await claudeCards(text, name, onStatus), cards = raw.map((c) => normCard(c, 'tmp')).filter(Boolean); if (!cards.length) throw { code: 'invalid_json' }; return { deck: addDeck(name, cards, 'claude'), note: `Claude wrote ${cards.length} cards.` }; }
    catch (e) {
      const code = (e && e.code) || 'upstream_error'; if (code === 'cancelled') throw e;
      const cards = cloze(text, 'tmp'); if (!cards.length) throw { code, message: (ERR[code] || 'Claude could not answer.') + ' And no sentences long enough for fill-in-the-blank cards were found.' };
      return { deck: addDeck(name, cards, 'cloze'), note: (ERR[code] || 'Claude could not answer, so ') + ` ${cards.length} fill-in-the-blank cards were made.` };
    }
  }
  function stop() { if (ctl) ctl.abort(); }
  function importJSON(j) {
    const decks = Array.isArray(j) ? [{ name: 'Imported', cards: j }] : j && j.decks ? (Array.isArray(j.decks) ? j.decks : Object.values(j.decks)) : j && Array.isArray(j.cards) ? [j] : null; if (!decks) return null;
    let added = 0, last = null;
    for (const d of decks) {
      const cards = (d.cards || []).map((c) => normCard(c, 'tmp')).filter(Boolean); if (!cards.length) continue;
      const dup = userDecks().find((u) => u.name === (d.name || 'Imported') && u.cards.length === cards.length && u.cards.every((c, i) => normQ(c.q) === normQ(cards[i].q))); // the same deck again: keep the one you have
      if (dup) { last = dup; continue; }
      last = addDeck(d.name || 'Imported', cards, 'json'); added += last.cards.length;
    }
    if (j && j.prog && typeof j.prog === 'object') { for (const k in j.prog) if (!S.prog[k]) S.prog[k] = j.prog[k]; save(); }
    return last ? { deck: last, note: `Imported ${added} cards in ${decks.length} deck${decks.length === 1 ? '' : 's'}.` } : null;
  }
  const exportJSON = () => JSON.stringify({ v: 1, decks: userDecks().map((d) => ({ name: d.name, cards: d.cards })), prog: S.prog, stats: S.stats }, null, 1);

  // ---- the Film Room screen (nodes for ui.js's overlay) ----
  function summary() { const P = pool(); return { decks: allDecks().filter(deckOn).length, cards: P.length, due: dueCount(P), streak: S.stats.streak, learned: P.filter((c) => prog(c) && prog(c).iv >= 3).length }; }
  // again() redraws this screen after a change; back() leaves it.
  function panel(again, back) {
    const st = S.stats, sm = summary(), nodes = [h('h1', 'sm', 'FILM <em>ROOM</em>')];
    nodes.push(h('p', 'c', 'Load what you’re learning. The coach quizzes you between drives, and every right answer feeds your team’s momentum.'));
    const stat = h('div', 'stat', `<div><b>${sm.due}</b><small>due now</small></div><div><b>${st.answered ? Math.round((100 * st.right) / st.answered) : 0}%</b><small>accuracy</small></div><div><b>${st.streak}</b><small>streak · best ${st.best}</small></div>`);
    nodes.push(stat);
    nodes.push(h('h3', '', 'Decks'));
    for (const d of allDecks()) {
      const on = deckOn(d), due = dueCount(d.cards), row1 = h('div', 'deck');
      const sw = h('button', 'sw' + (on ? ' on' : '')); sw.type = 'button'; sw.setAttribute('aria-label', (on ? 'Turn off ' : 'Turn on ') + d.name); sw.setAttribute('aria-pressed', on);
      sw.addEventListener('click', () => { S.set.off = on ? S.set.off.concat(d.id) : S.set.off.filter((x) => x !== d.id); save(); again(); });
      row1.append(sw, h('div', '', `<b>${esc(d.name)}</b><br><small>${d.cards.length} cards${due ? ' · ' + due + ' due' : ''}${d.builtin ? '' : ' · ' + (d.made === 'claude' ? 'made by Claude' : d.made === 'cloze' ? 'fill-in-the-blank' : 'your pairs')}</small>`));
      if (!d.builtin) { const x = h('button', 'x', 'DELETE'); x.type = 'button'; x.addEventListener('click', () => { if (x.textContent !== 'SURE?') { x.textContent = 'SURE?'; return; } delete S.decks[d.id]; save(); again(); }); row1.append(x); }
      else { const x = h('button', 'x', 'RESET'); x.type = 'button'; x.title = 'Forget your progress on this deck'; x.addEventListener('click', () => { if (x.textContent !== 'SURE?') { x.textContent = 'SURE?'; return; } for (const c of d.cards) delete S.prog[c.id]; save(); again(); }); row1.append(x); }
      nodes.push(row1);
    }
    nodes.push(h('h3', '', 'When the coach asks'));
    const when = row(); [['poss', 'New possession'], ['qtr', 'Each quarter'], ['plays', 'Every 4 plays'], ['off', 'Never in game']].forEach(([k, l]) => when.append(btn(l, () => { S.set.when = k; save(); again(); }, S.set.when === k ? 'on' : '')));
    const timer = row(); [[0, 'Idle timer off'], [2, 'Every 2 min'], [5, 'Every 5 min'], [10, 'Every 10 min']].forEach(([k, l]) => timer.append(btn(l, () => { S.set.timer = k; save(); again(); }, S.set.timer === k ? 'on' : '')));
    nodes.push(when, timer, h('p', 'note', 'The idle timer asks while you sit on the title, the pause menu or the play-call screen. Stakes: a right answer gives your team momentum (a step of speed, three steps and your returner gets the jets on the next kickoff); a miss hands it to the other side.'));
    nodes.push(row(btn(S.set.stakes ? 'Stakes: on' : 'Stakes: off', () => { S.set.stakes = !S.set.stakes; save(); again(); }, S.set.stakes ? 'on' : '')));
    nodes.push(h('h3', '', 'Add what you’re learning'));
    const ta = h('textarea', 'box'); ta.id = 'frText'; ta.placeholder = 'Paste notes, or flashcards one per line:\n  mitochondria | the powerhouse of the cell\n  Q: What is sup A?  A: the least upper bound\nFree text becomes questions written by Claude (in claude.ai), or fill-in-the-blank cards offline.';
    const nm = h('input', 'box'); nm.id = 'frName'; nm.type = 'text'; nm.placeholder = 'Deck name (e.g. Week 6: compactness)'; nm.autocomplete = 'off';
    const file = h('label', 'btn file', 'Upload .txt / .md / .csv'); const fi = h('input'); fi.type = 'file'; fi.id = 'frFile'; fi.accept = '.txt,.md,.markdown,.csv,.tsv,.json,text/plain'; file.append(fi);
    fi.addEventListener('change', () => { const f = fi.files && fi.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ta.value = String(r.result || ''); if (!nm.value) nm.value = f.name.replace(/\.[^.]+$/, ''); status.textContent = `Loaded ${f.name} (${Math.round(f.size / 1024)} KB).`; }; r.readAsText(f); });
    const status = h('p', 'note', ''); status.id = 'frStatus'; status.setAttribute('aria-live', 'polite');
    const stopB = btn('Stop', () => stop()); stopB.hidden = true; stopB.style.flex = '0 0 auto';
    const run = async (force) => {
      const go = mkB; go.disabled = true; stopB.hidden = false; status.textContent = 'Reading…';
      try { const r = await make(ta.value, nm.value, (s) => (status.textContent = s), force); status.textContent = `Added “${r.deck.name}”: ${r.deck.cards.length} cards. ${r.note}`; ta.value = ''; if (typeof SFX !== 'undefined') SFX.good(); setTimeout(again, 900); }
      catch (e) { const code = (e && e.code) || ''; status.textContent = code === 'empty' ? 'Paste or upload something first.' : (e && e.message) || ERR[code] || 'Something went wrong.'; }
      finally { go.disabled = false; stopB.hidden = true; }
    };
    const mkB = btn('Make cards', () => run(false), 'go'); const mkC = btn('Have Claude write questions', () => run(true));
    nodes.push(ta, nm, row(file, mkC), row(mkB, stopB), status);
    nodes.push(h('h3', '', 'Backup'));
    const out = h('textarea', 'box'); out.id = 'frOut'; out.hidden = true; out.readOnly = true; out.style.minHeight = '90px';
    const exp = btn('Export decks', async () => {
      const json = exportJSON(); let saved = false;
      try { const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) { await dl.save({ filename: 'film-room-decks.json', data: json }); saved = true; } } catch (e) {}
      if (!saved) { out.value = json; out.hidden = false; try { await navigator.clipboard.writeText(json); status2.textContent = 'Copied to the clipboard. Paste it into the box above to restore later.'; } catch (e) { out.select(); status2.textContent = 'Copy the text below to keep it. Paste it into the box above to restore later.'; } }
      else status2.textContent = 'Saved.';
    });
    const status2 = h('p', 'note', ''); status2.setAttribute('aria-live', 'polite');
    nodes.push(row(exp), out, status2);
    nodes.push(row(btn('Quiz me now', () => { if (!ask(null, 'manual')) status.textContent = 'Turn a deck on first.'; }, 'go'), btn('Back', back)));
    return nodes;
  }

  Object.assign(api, { ask, gameStart, gameBreak, tick, summary, panel, make, stop, exportJSON, importJSON, allDecks, deckOn, pool, prog, normCard, matches, grade, pick, settings: () => S.set, stats: () => S.stats, _S: () => S });
  return api;
})();
