'use strict';
// ui.js — the game around the sim: settings, sound, input, play flow, HUD, play-call sheet, overlays, and the Film Room hooks.
// Phases (ph): title · kopre · auto · call · pre · live · post · kick · final. One requestAnimationFrame loop drives update() and render().

// ===== ui part 1: DOM, settings, sound, input =====
const $ = (id) => document.getElementById(id);
const gl = $('gl'), stage = $('stage');
let CAN3 = false, SW = 1, SH = 1;
const SET = { snd: true, qlen: 180, user: 0 };
try { Object.assign(SET, JSON.parse(localStorage.getItem('mbowl') || '{}')); } catch (e) {}
const saveSet = () => { try { localStorage.setItem('mbowl', JSON.stringify(SET)); } catch (e) {} };

function fit() {
  const r = stage.getBoundingClientRect(); if (!r.width) return; SW = r.width; SH = r.height;
  if (CAN3) r3resize(SW, SH);
}
window.addEventListener('resize', fit);

// --- sound: square-wave blips and noise bursts, started by the first tap ---
let AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function tone(f, d, v, type, slide, at) {
  if (!SET.snd || !AC) return; const t = AC.currentTime + (at || 0), o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, f + slide), t + d);
  g.gain.setValueAtTime(v || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0008, t + d); o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d + 0.02);
}
function noise(d, v, at, freq) {
  if (!SET.snd || !AC) return; const t = AC.currentTime + (at || 0), n = Math.floor(AC.sampleRate * d), buf = AC.createBuffer(1, n, AC.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
  const s = AC.createBufferSource(), g = AC.createGain(), fl = AC.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = freq || 900; fl.Q.value = 0.7;
  s.buffer = buf; g.gain.setValueAtTime(v || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0008, t + d); s.connect(fl); fl.connect(g); g.connect(AC.destination); s.start(t);
}
const SFX = {
  sel: () => tone(660, 0.05, 0.04, 'triangle'), snap: () => { tone(180, 0.06, 0.07); noise(0.08, 0.08, 0, 400); },
  throw: () => { tone(500, 0.16, 0.04, 'triangle', 420); noise(0.18, 0.04, 0, 2400); }, catch: () => { tone(880, 0.05, 0.05, 'triangle'); tone(1320, 0.08, 0.05, 'triangle', 0, 0.05); },
  hit: () => { noise(0.16, 0.2, 0, 260); tone(90, 0.14, 0.11, 'triangle', -40); }, juke: () => noise(0.1, 0.05, 0, 3000),
  whistle: () => { tone(2100, 0.1, 0.03); tone(2300, 0.22, 0.03, 'square', 0, 0.1); }, crowd: (d) => noise(d || 1.2, 0.06, 0, 1400),
  td: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.16, 0.06, 'square', 0, i * 0.12)); noise(2.4, 0.09, 0, 1500); },
  to: () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.16, 0.06, 'sawtooth', 0, i * 0.13)); noise(1, 0.05, 0, 700); },
  good: () => { tone(784, 0.12, 0.06, 'triangle'); tone(1047, 0.2, 0.06, 'triangle', 0, 0.12); noise(1.2, 0.05, 0.1, 1500); }, bad: () => tone(200, 0.4, 0.07, 'sawtooth', -90),
  flag: () => { tone(1900, 0.07, 0.035); tone(1500, 0.16, 0.035, 'square', 0, 0.08); noise(0.5, 0.04, 0.1, 900); },
  kick: () => { noise(0.07, 0.16, 0, 250); tone(140, 0.1, 0.09, 'triangle', -60); }, big: () => { tone(659, 0.1, 0.05, 'triangle'); tone(988, 0.16, 0.05, 'triangle', 0, 0.1); noise(1.4, 0.07, 0, 1500); },
};

// --- input: keyboard, thumb stick, A/B, taps on the field ---
const IN = { mx: 0, my: 0, a: false, b: false, bh: false, tap: null, num: null, sx: 0, sy: 0, keys: {} };
const KEYMAP = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', a: 'l', d: 'r', w: 'u', s: 'd', A: 'l', D: 'r', W: 'u', S: 'd' };
let onA = () => {}, onMenu = () => {};
function pressA() { IN.a = true; audio(); onA(); }
function pressB(h) { if (h) IN.b = true; IN.bh = h; }
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // typing an answer or notes: the game keys stay out of it
  if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  const k = KEYMAP[e.key];
  if (k) { IN.keys[k] = true; e.preventDefault(); }
  else if (e.key === ' ' || e.key === 'z' || e.key === 'Z' || e.key === 'Enter' || e.key === 'j') { if (!e.repeat) pressA(); e.preventDefault(); }
  else if (e.key === 'x' || e.key === 'X' || e.key === 'Shift' || e.key === 'k') { if (!e.repeat) pressB(true); }
  else if (e.key >= '1' && e.key <= '5') IN.num = +e.key - 1;
  else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') onMenu();
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) IN.keys[k] = false; if (e.key === 'x' || e.key === 'X' || e.key === 'Shift' || e.key === 'k') pressB(false); });
window.addEventListener('blur', () => { IN.keys = {}; IN.bh = false; });

const stick = $('stick'), nub = $('nub'); let stickId = null;
function stickMove(e) {
  const r = stick.getBoundingClientRect(), R = r.width / 2; let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R); const m = Math.hypot(dx, dy), lim = R * 0.6;
  if (m > lim) { dx = (dx / m) * lim; dy = (dy / m) * lim; }
  IN.sx = dx / lim; IN.sy = -dy / lim; nub.style.transform = `translate(${dx}px,${dy}px)`;
}
stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (x) {} stickMove(e); audio(); e.preventDefault(); });
stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickMove(e); });
const stickUp = (e) => { if (e.pointerId !== stickId) return; stickId = null; IN.sx = IN.sy = 0; nub.style.transform = ''; };
stick.addEventListener('pointerup', stickUp); stick.addEventListener('pointercancel', stickUp);
const hold = (el, dn, up) => {
  el.addEventListener('pointerdown', (e) => { el.classList.add('dn'); try { el.setPointerCapture(e.pointerId); } catch (x) {} dn(); e.preventDefault(); });
  const u = () => { el.classList.remove('dn'); up && up(); }; el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
};
hold($('bA'), pressA); hold($('bB'), () => pressB(true), () => pressB(false));
function fieldTap(e) { // a tap on the turf: snap, or throw to the nearest receiver
  const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  IN.tap = CAN3 ? r3pick(px, py) : null;
  audio(); onA(true); e.preventDefault();
}
gl.addEventListener('pointerdown', fieldTap);
const TAGS = [0, 1, 2, 3, 4].map((i) => { const b = document.createElement('button'); b.className = 'tag'; b.textContent = i + 1; b.hidden = true; b.setAttribute('aria-label', 'Throw to receiver ' + (i + 1)); b.addEventListener('pointerdown', (e) => { IN.num = i; audio(); e.preventDefault(); }); $('tags').append(b); return b; });
function readInput() {
  const kx = (IN.keys.r ? 1 : 0) - (IN.keys.l ? 1 : 0), ky = (IN.keys.u ? 1 : 0) - (IN.keys.d ? 1 : 0);
  IN.mx = kx || IN.sx; IN.my = ky || IN.sy; return IN;
}
function clearEdges() { IN.a = IN.b = false; IN.tap = null; IN.num = null; }

// ===== ui part 2: game flow, juice, main loop =====
let G = null, pl = null, ph = 'title', phT = 0, paused = false, T = 0, last = 0, pend = null, kickS = null, bannerT = 0, evI = 0, postExtra = null;
let slowT = 0, slowK = 1, hero = -1, cut = true, turbo = false, staShown = -1;
const userSide = () => (!G || G.user < 0 ? -1 : G.user === G.poss ? 0 : 1);
function say(s) { const t = $('tick'); t.textContent = s; t.classList.remove('in'); void t.offsetWidth; t.classList.add('in'); }
function showBanner(text, cls, dur) { const b = $('banner'); b.hidden = true; void b.offsetWidth; $('bantxt').textContent = text; b.className = cls || ''; b.hidden = false; bannerT = dur || 1.6; }
function flash() { const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
const slowmo = (sec, k) => { slowT = sec; slowK = k; };
const fx = (kind, x, y, team) => { if (CAN3) r3burst(kind, x, y, team); };

// ---- Film Room momentum: a level per team (0..3) that becomes a speed multiplier in sim.js's BOOST ----
const MOMO = { lvl: [0, 0], prime: -1 }; // prime = team whose returner has the jets on the kickoff being played
const myTeam = () => (G && G.user >= 0 ? G.user : 0);
function momentumApply() { for (const t of [0, 1]) { BOOST.ms[t] = 1 + 0.03 * MOMO.lvl[t]; BOOST.kr[t] = MOMO.lvl[t] >= 3 ? 1.12 : 1; } }
function momentumReset() { MOMO.lvl = [0, 0]; MOMO.prime = -1; momentumApply(); }
Study.onResult = (ok, card, info) => {
  (ok ? SFX.good : SFX.bad)();
  if (!G || !Study.settings().stakes) return;
  const me = myTeam(), t = ok ? me : 1 - me, o = 1 - t;
  MOMO.lvl[t] = Math.min(3, MOMO.lvl[t] + 1); MOMO.lvl[o] = Math.max(0, MOMO.lvl[o] - 1); momentumApply(); hud();
  const n = TEAMS[t].name, kr = TEAMS[t].kr.n;
  say(ok ? (MOMO.lvl[t] >= 3 ? `FILM ROOM: ${n} HAVE THE MOMENTUM — ${kr} GETS THE JETS ON THE NEXT KICKOFF` : `FILM ROOM: CORRECT — MOMENTUM ${n}`) : `FILM ROOM: MISSED IT — MOMENTUM ${n}`);
  if (ok && info && info.streak > 0 && info.streak % 5 === 0) { showBanner(`${info.streak} STRAIGHT!`, 'good', 1.6); if (pl) fx('study', pl.bx, pl.los); }
};
const fmtClock = (c) => { const s = Math.ceil(c); return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`; };
const qtrName = () => (G.qtr > 4 ? 'OT' : ORD[G.qtr]);
function jumbo(a, b) { if (CAN3) r3jumbo(a ? [a, b || ''] : G ? [`${TEAMS[0].abbr} ${G.score[0]} · ${G.score[1]} ${TEAMS[1].abbr}`, G.over ? 'FINAL' : `${qtrName()}${G.qtr > 4 ? '' : ' QUARTER'}`] : ['MONSTROSITY BOWL', '']); }

function hud() {
  if (!G) return;
  $('s0').textContent = G.score[0]; $('s1').textContent = G.score[1]; $('qt').textContent = `${qtrName()} ${fmtClock(G.clock)}`;
  $('t0').classList.toggle('has', G.poss === 0); $('t1').classList.toggle('has', G.poss === 1);
  $('dd').innerHTML = G.next.k === 'call' ? `<b>${situation(G)}</b> · ${ballOn(G)}` : G.next.k === 'pat' ? 'EXTRA POINT' : G.next.k === 'ko' ? 'KICKOFF' : 'FINAL';
  const m = MOMO.lvl[myTeam()], pips = m ? ` · <b>${'●'.repeat(m)}</b>${'○'.repeat(3 - m)}` : '';
  $('you').innerHTML = (G.user < 0 ? 'CPU VS CPU' : `YOU · <b>${TEAMS[G.user].abbr}</b> ${userSide() === 0 ? 'OFFENSE' : 'DEFENSE'}`) + pips;
}
function labels() {
  let a = '', b = '';
  const us = pl ? pl.userSide : -1, c = pl && pl.live ? carrier(pl) : null;
  if (ph === 'kick') a = 'KICK';
  else if (ph === 'pre') { a = us === 0 ? 'SNAP' : us === 1 ? 'READY' : ''; b = us === 1 ? 'SWITCH' : ''; }
  else if (ph === 'live' && us === 0) { if (c && c.key === 'QB' && pl.pass && !pl.scr && !pl.thrown) { a = 'THROW'; b = 'NEXT'; } else { a = 'JUKE'; b = 'TURBO'; } }
  else if (ph === 'live' && us === 1) { if (c && c.side === 1) { a = 'JUKE'; b = 'TURBO'; } else { a = pl.ball.st === 'air' ? 'SWAT' : 'DIVE'; b = 'SWITCH'; } }
  else if (ph === 'post') a = 'NEXT';
  if ($('bAl').textContent !== a) $('bAl').textContent = a; if ($('bBl').textContent !== b) $('bBl').textContent = b;
  const fl = !!(pl && pl.flags && pl.flags.length && G); if ($('flagchip').hidden === fl) $('flagchip').hidden = !fl;
  const mine = c && pl.user === c.i && pl.userSide >= 0, sta = mine ? Math.round(c.sta * 100) : 100; // turbo ring around B, speed lines while it burns
  if (sta !== staShown) { staShown = sta; $('bB').style.setProperty('--sta', sta); }
  const sp = turbo && ph === 'live' && mine; if (stage.classList.contains('boost') !== !!sp) stage.classList.toggle('boost', !!sp);
}

function startGame(user) { if (user >= 0) { SET.user = user; saveSet(); } G = newGame({ qlen: SET.qlen, user }); momentumReset(); Study.gameStart(G); hideOverlay(); audio(); jumbo(); nextStep(); }
function nextStep() {
  kickS = null; hero = -1; stage.classList.remove('cine'); $('kick').hidden = true; $('hint').textContent = '';
  if (G.over) return showFinal();
  // Film Room: between drives the coach may stop you with a question; the game resumes when you answer.
  const ctx = { plays: G.stats[0].plays + G.stats[1].plays, poss: G.poss, qtr: G.qtr, next: G.next.k };
  if (Study.gameBreak(ctx, nextStep2)) { hud(); return; }
  nextStep2();
}
function nextStep2() {
  const n = G.next;
  if (n.k === 'ko') return startKO(n.rec);
  if (n.k === 'pat') return startKick('pat', n.team);
  startCall();
}
function startKO(rec) {
  G.poss = rec; pl = setupKick(TEAMS[rec], TEAMS[1 - rec]); pl.userSide = userSide(); evI = 0; cut = true;
  MOMO.prime = MOMO.lvl[rec] >= 3 ? rec : -1; // PRIME TIME: three momentum steps give the returner the jets, then it is spent
  ph = 'kopre'; phT = 1.4; say(`${TEAMS[1 - rec].k.n} KICKS OFF TO ${TEAMS[rec].kr.n}${MOMO.prime === rec ? ' — PRIME TIME' : ''}`); hud(); jumbo();
  if (pl.userSide === 0) $('hint').innerHTML = MOMO.prime === rec ? `PRIME TIME · <b>${TEAMS[rec].kr.n}</b> HAS THE JETS · <b>A</b> JUKE · HOLD <b>B</b> TURBO` : 'YOUR RETURN · <b>A</b> JUKE · HOLD <b>B</b> TURBO';
}
function preview() { const off = TEAMS[G.poss], def = TEAMS[1 - G.poss]; pl = setupScrim(off, def, off.plays[2], def.dcalls[3], G.ydl, G.bx); pl.frozen = true; pl.userSide = -1; pl.fd = G.ydl + G.togo; }
function startCall() {
  pend = { oc: null, dc: null, sp: null }; hud(); jumbo(); preview();
  const us = userSide();
  if (us !== 0) { const c = cpuOff(G); if (c.k === 'play') pend.oc = c.play; else pend.sp = c.k; }
  if (us !== 1) pend.dc = cpuDef(G);
  if (us === -1 && pend.oc) pend.oc = audible(TEAMS[G.poss], pend.oc, pend.dc);
  if (us === -1 || pend.sp) { ph = 'auto'; phT = pend.sp ? 1.2 : 0.9; if (pend.sp) say(`${TEAMS[G.poss].abbr} SENDS OUT THE ${pend.sp === 'fg' ? 'FIELD GOAL' : 'PUNT'} UNIT`); return; }
  ph = 'call'; showPanel(us);
}
function lineUp() {
  $('panel').hidden = true;
  if (pend.sp === 'punt') { SFX.kick(); return finish(applyPunt(G), 1.7); }
  if (pend.sp === 'fg') return startKick('fg', G.poss);
  const off = TEAMS[G.poss], def = TEAMS[1 - G.poss], us = userSide();
  if (us === 1) pend.oc = audible(off, pend.oc, pend.dc); // the CPU offense reads your call
  pl = setupScrim(off, def, pend.oc, pend.dc, G.ydl, G.bx); pl.userSide = us; pl.fd = G.ydl + G.togo; evI = 0;
  if (us === 1) pl.user = pl.D.find((d) => d.key === 'D' + def.lb).i; else if (us === 0) pl.user = 0;
  ph = 'pre'; phT = us === 0 ? 1e9 : 1.2 + Math.random() * 0.8;
  const rush = pl.D.filter((d) => d.job.t === 'rush').length, man = pl.D.filter((d) => d.job.t === 'man').length >= 3;
  let h = '';
  if (us === 0) {
    h = pl.pass ? '<b>A</b> SNAPS · THEN TAP A RECEIVER TO THROW' : '<b>A</b> SNAPS · THEN <b>A</b> JUKE · HOLD <b>B</b> TURBO';
    if (off.tr.motion) h += `<br>MOTION READ: <b>${man ? 'MAN' : 'ZONE'}${rush >= 5 ? ' · ' + rush + ' RUSHING' : ''}</b>`;
  } else if (us === 1) { const me = pl.P[pl.user].r; h = `YOU ARE <b>#${me.num} ${me.n}</b> · <b>A</b> DIVE · <b>B</b> SWITCH`; }
  $('hint').innerHTML = h;
  say(us === 0 ? pend.oc.name : us === 1 ? pend.dc.name : `${off.abbr} ${pend.oc.name} VS ${pend.dc.name}`);
}
function doSnap() {
  if (!pl || ph !== 'pre') return; clearEdges(); $('hint').textContent = '';
  const foul = preSnapFoul(G, pl);
  if (foul) { const f = pl.flags[0]; f.by.y += f.side === 0 ? 0.9 : -1.1; SFX.flag(); fx('flag', f.x, f.y); return finish(foul, 2.4); } // somebody jumped
  snap(pl); ph = 'live';
}

function finish(out, wait) {
  say(out.text); const adv = advance(G), t = out.tone;
  (SFX[t === 'td' ? 'td' : t === 'to' ? 'to' : t === 'big' ? 'big' : t === 'good' ? 'good' : t === 'bad' ? 'bad' : t === 'flag' ? 'flag' : 'sel'])();
  if (out.banner) showBanner(out.banner, t === 'to' || t === 'bad' ? 'to' : t === 'good' ? 'good' : t === 'flag' ? 'flag' : '', t === 'flag' ? 2.2 : 1.8);
  if (t === 'td' || t === 'good' || t === 'big') fx('flash'); if (out.banner && t) jumbo(out.banner, TEAMS[G.poss].name); else jumbo();
  ph = 'post'; phT = t === 'td' ? 3.2 : t === 'flag' ? 2.8 : out.banner ? 2.1 : wait;
  postExtra = adv === 'qtr' ? `END OF ${ORD[G.qtr - 1]} QUARTER` : adv === 'half' ? 'HALFTIME' : adv === 'ot' ? 'OVERTIME' : adv === 'final' ? 'FINAL' : null;
  if (postExtra) phT += 1.8;
  hud();
}
function endLive() {
  turbo = false;
  const r = pl.res, scorer = r.type === 'td' && r.c ? r.c : null;
  if (r.type === 'sack') { SFX.hit(); fx('big', r.x, r.y); slowmo(0.5, 0.25); }
  else if (r.type === 'tackle') { SFX.hit(); fx('hit', r.x, r.y); }
  SFX.whistle();
  const scoringTeam = scorer ? (scorer.side === 0 ? pl.off.id : pl.def.id) : -1;
  const out = pl.kind === 'ko' ? applyKick(G, pl) : applyScrim(G, pl);
  if (pl.kind === 'ko' && MOMO.prime >= 0) { MOMO.lvl[MOMO.prime] = 0; MOMO.prime = -1; momentumApply(); }
  if (scorer) { hero = scorer.i; stage.classList.add('cine'); flash(); slowmo(0.7, 0.3); fx('td', scorer.x, scorer.y, scoringTeam); }
  finish(out, 1.6);
}

function startKick(kind, team) {
  const los = kind === 'pat' ? 85 : G.ydl, d = kind === 'pat' ? 33 : fgDist(G), k = TEAMS[team].k, off = TEAMS[team], def = TEAMS[1 - team];
  G.poss = team; hero = -1; stage.classList.remove('cine'); cut = true;
  pl = setupScrim(off, def, off.plays[0], def.dcalls[1], los, MID); pl.frozen = true; pl.userSide = -1;
  kickS = { kind, team, d, k, los, st: 'aim', t: 1.0, m: -1, dir: 1, user: G.user === team, dev: 0, ball: null, good: false,
    speed: clamp(1.1 + d * 0.02 - (k.skl - 85) * 0.02, 0.9, 2.6), win: clamp(3.08 / (d * 0.16), 0.12, 0.95) };
  ph = 'kick'; $('panel').hidden = true; hud();
  const what = kind === 'pat' ? 'EXTRA POINT' : `${d}-YARD FIELD GOAL`;
  if (kickS.user) { $('kick').hidden = false; $('kickT').innerHTML = `${what} <span>${k.n} · STOP IT IN THE GREEN</span>`; $('zone').style.left = 50 - kickS.win * 50 + '%'; $('zone').style.width = kickS.win * 100 + '%'; }
  say(`${k.n} LINES UP THE ${what}`);
}
function kickGo() {
  const s = kickS; $('kick').hidden = true; SFX.kick(); fx('juke', pl.bx, s.los - 7);
  s.short = s.d > 45 + s.k.pow * 0.15; s.good = !s.short && Math.abs(s.dev) < 3.08;
  s.st = 'fly'; s.t = 0; s.T = 1.5 + s.d * 0.012; s.x0 = pl.bx; s.y0 = s.los - 7; s.y1 = s.short ? 104 : 128; s.h = s.short ? 6 : 11; s.up = (110 - s.y0) / (s.y1 - s.y0);
}
function kickStop() { const s = kickS; if (!s || s.st !== 'aim' || !s.user) return; s.dev = s.m * s.d * 0.16 + gauss() * (1.2 - s.k.skl / 99) * 3; kickGo(); }
function kickUpdate(dt) {
  const s = kickS;
  if (s.st === 'aim') {
    if (s.user) { s.m += s.dir * s.speed * dt * 2; if (s.m > 1) { s.m = 1; s.dir = -1; } else if (s.m < -1) { s.m = -1; s.dir = 1; } $('mark').style.left = 50 + s.m * 50 + '%'; }
    else if ((s.t -= dt) <= 0) { const ok = rnd() < kickProb(s.k, s.d); s.dev = ok ? (rnd() * 2 - 1) * 2.4 : (rnd() < 0.5 ? -1 : 1) * (3.7 + rnd() * 3); kickGo(); }
  } else if (s.st === 'fly') {
    s.t += dt; const u = Math.min(1, s.t / s.T); // the ball crosses the posts at u = s.up, exactly dev yards off centre
    s.ball = { x: s.x0 + (MID + s.dev - s.x0) * (u / s.up), y: s.y0 + (s.y1 - s.y0) * u, z: 4 * s.h * u * (1 - u) + 0.3 };
    if (u >= 1) { s.st = 'done'; s.ball = null; const out = s.kind === 'pat' ? applyPAT(G, s.team, s.good) : applyFG(G, s.good); if (s.kind === 'pat') out.banner = s.good ? '' : 'NO GOOD'; finish(out, 1.5); }
  }
}

onA = (fromTap) => {
  if (paused || !G || Study.open) return;
  if (ph === 'pre' && pl && pl.userSide === 0) doSnap();
  else if (ph === 'kick') kickStop();
  else if (ph === 'post' && !fromTap && phT > 0.35 && !postExtra) phT = 0.35;
};
$('kickBtn').addEventListener('click', () => { audio(); kickStop(); });

function update(dt) {
  const inp = readInput();
  if (bannerT > 0 && (bannerT -= dt) <= 0) $('banner').hidden = true;
  if (ph === 'kopre') { if ((phT -= dt) <= 0) { snap(pl); SFX.kick(); fx('juke', MID, 65); ph = 'live'; } }
  else if (ph === 'auto') { if ((phT -= dt) <= 0) lineUp(); }
  else if (ph === 'pre') {
    if (pl.userSide === 1 && inp.b) { // pick your defender before the snap
      const D = pl.D, me = D[(D.findIndex((d) => d.i === pl.user) + 1) % D.length]; pl.user = me.i; SFX.sel();
      $('hint').innerHTML = `YOU ARE <b>#${me.r.num} ${me.r.n}</b> · <b>A</b> DIVE · <b>B</b> SWITCH`;
    }
    if ((phT -= dt) <= 0) doSnap();
  } else if (ph === 'live') {
    let acc = dt * (slowT > 0 ? slowK : 1); const b = pl.ball;
    if (b.st === 'air' && !b.kick && !b.away && !pl.slowed && b.T > 1.05 && b.T - b.ft < 0.3) { pl.slowed = true; slowmo(0.55, 0.3); } // deep ball: hold the moment
    while (acc > 1e-6 && !pl.dead) { const h = Math.min(1 / 60, acc); stepPlay(pl, h, pl.userSide >= 0 ? inp : null); clearEdges(); acc -= h; if (pl.kind === 'scrim' || pl.caught) G.clock = Math.max(0, G.clock - h); }
    const c = carrier(pl);
    for (; evI < pl.ev.length; evI++) {
      const e = pl.ev[evI].e, x = c ? c.x : b.x, y = c ? c.y : b.y;
      if (e === 'snap') SFX.snap(); else if (e === 'throw') SFX.throw(); else if (e === 'catch') { SFX.catch(); fx('catch', x, y); } else if (e === 'miss') { SFX.hit(); fx('hit', x, y); }
      else if (e === 'juke') { SFX.juke(); fx('juke', x, y); } else if (e === 'int') { SFX.crowd(0.9); fx('int', x, y); flash(); slowmo(0.5, 0.3); }
      else if (e === 'flag') { SFX.flag(); fx('flag', pl.ev[evI].x, pl.ev[evI].y); }
    }
    turbo = !!(c && c.sta < 0.98 && c.sta > 0.03 && Math.hypot(c.vx, c.vy) > c.ms * 1.05);
    if (CAN3 && turbo) r3emit(W3(c.x - c.vx * 0.08), 0.8 + Math.random() * 1.6, Z3(c.y - c.vy * 0.08), 0, 0, 0, 0.22, 0.5, 1, 1, 1, 0, 0.45); // turbo streaks
    $('qt').textContent = `${qtrName()} ${fmtClock(G.clock)}`;
    if (pl.dead) endLive();
  } else if (ph === 'post') {
    phT -= dt; if (postExtra && phT <= 1.8) { showBanner(postExtra, '', 1.7); SFX.whistle(); postExtra = null; }
    if (phT <= 0) nextStep();
  } else if (ph === 'kick') kickUpdate(dt);
  clearEdges(); labels();
}
function render(dt) {
  const off = pl ? pl.off : G ? TEAMS[G.poss] : TEAMS[0], def = pl ? pl.def : G ? TEAMS[1 - G.poss] : TEAMS[1], scr = pl && pl.kind === 'scrim' && G;
  const los = scr ? pl.los : null, fd = scr && !kickS ? pl.fd : null, live = ph === 'pre' || ph === 'live';
  const tags = scr && pl.userSide === 0 && !pl.frozen && live && pl.pass && !pl.thrown, userOn = !!pl && pl.userSide >= 0 && live;
  if (!CAN3) return;
  r3frame({ pl, G, off, def, los, fd, t: T, userOn, kb: kickS && kickS.ball, kick: kickS && pl ? { x: pl.bx, y0: kickS.los - 7 } : null, title: !G, hero, cut, paused, flag: !!(pl && pl.flags && pl.flags.length), sheet: ph === 'call' || Study.open, turbo: turbo && ph === 'live' }, dt); cut = false;
  for (let i = 0; i < 5; i++) { // receiver tags ride above their men
    const el = TAGS[i], p = tags ? pl.order[i] : null; if (!p) { if (!el.hidden) el.hidden = true; continue; }
    const [x, y, ok] = r3project(p.x, p.y, 4.4); el.hidden = !ok; el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`; el.classList.toggle('sel', i === pl.sel);
  }
}
let qLvl = 3, qT = 0, ema = 0.016;
const SAFE = { title: 1, call: 1, post: 1, final: 1 }; // phases where a quiz can interrupt without spoiling a play
function frame(now) {
  const raw = (now - last) / 1000 || 0, dt = Math.min(0.05, raw); last = now; T += dt; if (slowT > 0) slowT -= dt;
  ema += (Math.min(raw, 0.25) - ema) * 0.05; qT += raw; // ease the pixel ratio one step (never below 1.5×) if the device cannot hold ~40 fps
  if (CAN3 && qLvl > 0 && qT > 2.5 && ema > 0.025 && !(window.__mb && window.__mb.q != null)) { qLvl--; qT = 0; r3quality(qLvl); }
  const hold = paused || Study.open;
  if (!hold && G) { const n = (window.__mb && window.__mb.speed) || 1; for (let k = 0; k < n && !paused && !Study.open && G; k++) update(dt); } else clearEdges();
  Study.tick(!!SAFE[ph] || paused);
  render(dt); requestAnimationFrame(frame);
}

// ===== ui part 3: play-call sheet, overlays, boot =====
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const btn = (label, fn, cls) => { const b = h('button', 'btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', () => { audio(); SFX.sel(); fn(); }); return b; };
const row = (...els) => { const r = h('div', 'row'); r.append(...els); return r; };

// Play diagram for a call card: offense routes in gold, or the defense's rush, man and zone jobs.
function playArt(c, off, def, play, dcall) {
  const g = c.getContext('2d'), W = c.width, H = c.height, p0 = setupScrim(off, def, play || off.plays[2], dcall || def.dcalls[0], 30, MID);
  const X = (x) => ((x - MID + 21) / 42) * W, Y = (y) => H - 22 - (y - 30) * (H / 26);
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#2f7f40'); gr.addColorStop(1, '#1f5f30'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.lineCap = g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1;
  for (const y of [30, 35, 40, 45, 50]) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(W, Y(y)); g.stroke(); }
  const path = (pts, col, w, arrow) => {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke();
    if (!arrow || pts.length < 2) return; const [x1, y1] = pts[pts.length - 1], [x0, y0] = pts[pts.length - 2], a = Math.atan2(Y(y1) - Y(y0), X(x1) - X(x0));
    g.fillStyle = col; g.beginPath(); for (const da of [0, 2.5, -2.5]) g.lineTo(X(x1) + Math.cos(a + da) * 8, Y(y1) + Math.sin(a + da) * 8); g.fill();
  };
  const dot = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(X(x), Y(y), r, 0, 7); g.fill(); };
  if (!dcall) {
    for (const p of p0.O) if (p.rt) {
      const pts = [[p.x, p.y]];
      for (const [x, y] of p.rt.pts) { const [px, py] = pts[pts.length - 1]; if (y > 50) { const k = (50 - py) / (y - py); pts.push([px + (x - px) * k, 50]); break; } pts.push([x, y]); }
      path(pts, '#ffc42e', 3.5, true);
    }
    if (play.type === 'run') { const r = p0.K.R, gx = p0.bx + play.run.gap * p0.f, wide = Math.abs(play.run.gap) > 5; path([[r.x, r.y], [gx, 30.5], [gx + (wide ? Math.sign(play.run.gap * p0.f) * 2.5 : 0), 43]], '#ffffff', 4, true); }
    for (const p of p0.O) dot(p.x, p.y, 4.4, p.key === 'QB' ? '#ffffff' : p.rt || (play.type === 'run' && p.key === 'R') ? '#ffc42e' : '#9db8a6');
  } else {
    for (const d of p0.D) { const j = d.job; if (j.t !== 'zone' && j.t !== 'deep') continue; g.fillStyle = j.t === 'deep' ? 'rgba(255,196,46,.32)' : 'rgba(76,151,255,.38)'; g.beginPath(); g.ellipse(X(j.ax), Y(j.t === 'deep' ? 44 : j.ay), W * 0.13, H * 0.1, 0, 0, 7); g.fill(); }
    for (const p of p0.O) dot(p.x, p.y, 3.2, 'rgba(255,255,255,.4)');
    for (const d of p0.D) {
      const j = d.job;
      if (j.t === 'rush') path([[d.x, d.y], [p0.bx + (d.x - p0.bx) * 0.35, 27]], '#ff5a5a', 3.5, true); else if (j.t === 'man') path([[d.x, d.y], [j.m.x, j.m.y]], 'rgba(255,255,255,.7)', 2);
      dot(d.x, d.y, 4.4, j.t === 'rush' ? '#ff5a5a' : '#ffffff');
    }
  }
}

function showPanel(us) {
  const P = $('panel'), off = TEAMS[G.poss], def = TEAMS[1 - G.poss]; P.innerHTML = ''; P.hidden = false; P.scrollTop = 0;
  P.append(h('h2', '', `${us === 0 ? 'YOUR BALL' : 'YOUR DEFENSE'} <span>${situation(G)} · ball on ${ballOn(G)}</span>`));
  const grid = h('div', 'grid');
  const add = (cls, name, tag, sub, art, fn) => {
    const b = h('button', 'play ' + cls), c = h('canvas'); b.type = 'button'; c.width = 124; c.height = 100; art(c);
    b.append(c, h('div', '', `<b>${name}</b><i><em>${tag}</em>${sub ? ' · ' + sub : ''}</i>`)); b.addEventListener('click', () => { audio(); SFX.sel(); fn(); }); grid.append(b);
  };
  if (us === 0) off.plays.forEach((p) => add(p.type, p.name, p.tag, p.sub, (c) => playArt(c, off, def, p, null), () => { pend.oc = p; lineUp(); }));
  else def.dcalls.forEach((c) => add('def', c.name, c.sub.split(' · ')[0], c.sub.split(' · ').slice(1).join(' · '), (cvs) => playArt(cvs, off, def, null, c), () => { pend.dc = c; lineUp(); }));
  P.append(grid);
  const r = row();
  if (us === 0) { const d = fgDist(G), fg = btn(`Field goal · ${d} yd`, () => { pend.sp = 'fg'; lineUp(); }); fg.disabled = d > 62; r.append(btn('Punt', () => { pend.sp = 'punt'; lineUp(); }), fg); }
  r.append(btn(`Swap to ${TEAMS[1 - G.user].abbr}`, () => setUser(1 - G.user)));
  P.append(r);
}
function setUser(u) {
  G.user = u; if (u >= 0) { SET.user = u; saveSet(); }
  if (ph === 'live' && pl) { pl.userSide = userSide(); pl.user = -1; }
  else if (ph === 'call' || ph === 'auto' || ph === 'pre') { $('panel').hidden = true; startCall(); }
  hud(); if (u >= 0) say(`YOU NOW CONTROL ${TEAMS[u].name}`);
}

function hideOverlay() { $('overlay').hidden = true; stage.classList.remove('ov'); paused = false; }
function ov(nodes) { const o = $('overlay'); o.innerHTML = ''; o.append(...nodes); o.hidden = false; o.scrollTop = 0; stage.classList.add('ov'); paused = true; }
const HOWTO = `<li>Move with the stick or the arrow keys. Let go and your player runs his own assignment.</li>
<li><b>Offense:</b> A snaps the ball. On a pass, tap a receiver or his number to throw. A throws to the highlighted receiver and B picks the next one. With the ball in your hands, A jukes and holding B is turbo.</li>
<li><b>Defense:</b> you start as the middle linebacker. B switches to the defender nearest the ball. A dives at the ball carrier, or swats at a pass in the air.</li>
<li><b>Keyboard:</b> Space or Z is A, X or Shift is B, 1–5 throw, P pauses.</li>
<li><b>Flags:</b> holding, pass interference, false starts, offside, face masks and late hits are all called. Dive at the quarterback after he has thrown and you will draw one.</li>
<li>Swap teams any time from the play screen or the pause button.</li>
<li><b>Film Room:</b> paste notes or flashcards and the coach asks you questions between drives. Right answers give your team momentum; three in a row and your kick returner gets the jets.</li>`;
const WHY = `<li>The 46 sends six rushers at five blockers, so one man always comes free. The answer is to throw before he arrives, and Marino has the quickest release in this game. His 1985 Dolphins handed the '85 Bears their only loss, 38–24.</li>
<li>The 46 leaves its corners alone with no safety behind them. Deion can erase one receiver. Rice, Moss, Welker, Gronkowski and Faulk are five.</li>
<li>Miami beat that defense by putting a third receiver in the slot against a linebacker. Welker lines up there on every pass.</li>
<li>On defense the Antidote rushes four (Donald, Greene, Bruce Smith, Lawrence Taylor) and keeps two safeties deep. Tampa Bay used that plan in Super Bowl LV and held Mahomes without a touchdown.</li>
<li>Hester returns the kicks.</li>`;
const sndBtn = (again) => btn(SET.snd ? 'Sound on' : 'Sound off', () => { SET.snd = !SET.snd; saveSet(); again(); });
const filmBtn = (again) => btn('Film Room', () => showFilmRoom(again));
function showFilmRoom(back) { ov(Study.panel(() => showFilmRoom(back), back)); }
function filmCard() { // the Film Room tile on the title screen
  const s = Study.summary(), c = h('button', 'fr', `<u>FILM ROOM</u><b>${s.cards ? `${s.due} due · ${s.cards} cards` : 'LOAD YOUR NOTES'}</b><small>${s.cards ? `${s.decks} deck${s.decks === 1 ? '' : 's'} on · streak ${s.streak} · ${s.learned} learned` : 'Paste notes or flashcards and the coach quizzes you between drives'}</small>`);
  c.type = 'button'; c.addEventListener('click', () => { audio(); SFX.sel(); showFilmRoom(showTitle); }); return c;
}

function showTitle() {
  G = null; kickS = null; hero = -1; ph = 'title'; cut = true; stage.classList.remove('cine'); $('panel').hidden = true; $('kick').hidden = true; $('banner').hidden = true; $('hint').textContent = ''; $('tick').textContent = ''; momentumReset();
  pl = setupScrim(TEAMS[0], TEAMS[1], TEAMS[0].plays[4], TEAMS[1].dcalls[0], 50, MID); pl.frozen = true; pl.userSide = -1; // two teams at midfield behind the menu
  if (!(SET.user === 0 || SET.user === 1)) SET.user = 0;
  const cards = h('div', 'cards');
  TEAMS.forEach((t, i) => {
    const c = h('button', `card c${i}` + (SET.user === i ? ' sel' : ''), `<u>${i ? 'TEAM B' : 'TEAM 1'}</u><b>${t.name}</b><small>${t.hc} · ${t.dc}</small><small>${i ? 'Marino · Rice · Moss · L. Taylor · Reed' : 'Mahomes · Payton · Garrett · Deion'}</small>`);
    c.type = 'button'; c.addEventListener('click', () => { audio(); SFX.sel(); SET.user = i; saveSet(); showTitle(); }); cards.append(c);
  });
  const q = row(); [120, 180, 300].forEach((s) => q.append(btn(`${s / 60} min quarters`, () => { SET.qlen = s; saveSet(); showTitle(); }, SET.qlen === s ? 'on' : '')));
  const nodes = [h('h1', '', 'MONSTROSITY<em>BOWL</em>'), h('p', 'c', 'The super team against the team built to beat it. Pick a side, load what you’re studying, and the coach quizzes you between drives.'), cards, q,
    row(btn(`Kick off as ${TEAMS[SET.user].name}`, () => startGame(SET.user), 'go')), filmCard(),
    row(btn('Watch CPU vs CPU', () => startGame(-1)), btn('Scouting report', () => showRosters(showTitle))), row(sndBtn(showTitle), btn('Quiz me now', () => { if (!Study.ask()) showFilmRoom(showTitle); }))];
  if (!CAN3) nodes.push(h('p', 'c', 'This browser could not start the 3D view (WebGL). The game needs it to draw the field.'));
  nodes.push(h('h3', '', 'How to play'), h('ul', '', HOWTO));
  ov(nodes); jumbo();
}
function showMenu() {
  const who = row(); [[0, TEAMS[0].abbr], [1, TEAMS[1].abbr], [-1, 'Watch']].forEach(([u, l]) => who.append(btn(l, () => { setUser(u); showMenu(); }, G.user === u ? 'on' : '')));
  ov([h('h1', 'sm', 'PAUSED'), row(btn('Resume', hideOverlay, 'go')), h('h3', '', 'You control'), who, row(sndBtn(showMenu), filmBtn(showMenu)),
    row(btn('Quiz me now', () => { if (!Study.ask()) showFilmRoom(showMenu); }), btn('Scouting report', () => showRosters(showMenu))), row(btn('Quit to title', showTitle)), h('h3', '', 'How to play'), h('ul', '', HOWTO)]);
}
function showRosters(back) {
  const nodes = [h('h1', 'sm', 'SCOUTING <em>REPORT</em>')], line = (p) => `<span>${p.pos}</span><span>${p.n}${p.fill ? ' <em>*</em>' : ''}</span><span>#${p.num}</span>`;
  TEAMS.forEach((t, i) => {
    const r = h('div', 'ros');
    r.innerHTML = ['QB', 'R', 'X', 'S', 'Z', 'T', 'LT', 'LG', 'C', 'RG', 'RT'].map((k) => line(t.off[k])).join('') + t.def.map(line).join('') + line(t.k) + (t.krDef < 0 ? line(t.kr) : '');
    nodes.push(h('h3', '', `${i ? 'Team B' : 'Team 1'} · ${t.name} · ${t.hc} / ${t.dc}`), r);
  });
  nodes.push(h('p', '', '<b style="color:var(--gold)">*</b> A spot the original list left open, filled in so both sides field eleven.'),
    h('h3', '', 'Why the Antidote is built this way'), h('ul', '', WHY), row(btn('Back', back, 'go')));
  ov(nodes);
}
function showFinal() {
  ph = 'final'; const [a, b] = G.score, w = a > b ? 0 : 1, S = G.stats, u = G.user;
  const rows = [['Total yards', (s) => s.py + s.ry], ['Passing', (s) => `${s.pc}/${s.pa} · ${s.py}`], ['Rushing', (s) => `${s.ra} · ${s.ry}`], ['First downs', (s) => s.fd], ['Sacks', (s) => s.sk], ['Giveaways', (s) => s.to], ['Penalties', (s) => `${s.pen} · ${s.peny}`]];
  const tb = h('table', '', `<tr><th></th><th style="color:var(--mon)">${TEAMS[0].abbr} ${a}</th><th style="color:var(--ant)">${TEAMS[1].abbr} ${b}</th></tr>` + rows.map(([n, f]) => `<tr><td>${n}</td><td>${f(S[0])}</td><td>${f(S[1])}</td></tr>`).join(''));
  const st = Study.stats(), sm = Study.summary();
  ov([h('h1', '', u < 0 ? `${TEAMS[w].name}<em>WINS</em>` : u === w ? 'YOU<em>WIN</em>' : 'YOU<em>LOSE</em>'), h('p', 'c', `Final${G.ot ? ' in overtime' : ''}`), tb,
    h('p', 'c', st.today ? `Film Room today: ${st.today} answered · streak ${st.streak} · ${sm.due} due now` : 'Film Room: nothing asked this game. Load a deck from the title screen.'),
    row(btn('Rematch', () => startGame(u), 'go')), row(btn(u < 0 ? 'Play as MON' : `Rematch as ${TEAMS[1 - u].abbr}`, () => startGame(u < 0 ? 0 : 1 - u)), btn('Title screen', showTitle))]);
  (u < 0 || u === w ? SFX.td : SFX.to)(); jumbo();
}

onMenu = () => { if (!G || ph === 'final') return; if ($('overlay').hidden) showMenu(); else hideOverlay(); };
$('menuBtn').addEventListener('click', () => { audio(); onMenu(); });
if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
function boot(data) {
  try { CAN3 = r3init(gl); } catch (e) { CAN3 = false; }
  gl.hidden = !CAN3; fit();
  if (data && data.G && data.G.next) { G = data.G; if (data.momo) MOMO.lvl = data.momo; momentumApply(); Study.gameStart(G); hideOverlay(); jumbo(); nextStep(); } else showTitle();
  requestAnimationFrame((t) => { last = t; frame(t); });
}
const hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) hot.snapshot(() => (G && !G.over ? { G: JSON.parse(JSON.stringify(G)), momo: MOMO.lvl.slice() } : {}));
if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
if (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') // local testing only
  window.__mb = { G: () => G, pl: () => pl, ph: () => ph, final: () => showFinal(), rosters: () => showRosters(showTitle), menu: () => showMenu(), step: () => { hideOverlay(); nextStep(); }, Study, MOMO, start: startGame, title: showTitle, film: () => showFilmRoom(showTitle), r3: () => R3 };
