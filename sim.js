'use strict';
// sim.js — Monstrosity Bowl: data (teams, playbooks, routes), the play simulation and the game rules.
// Pure logic, no DOM and no Three.js. Shared with the other scripts through the global lexical scope (classic scripts).
// Offense always attacks +y; the field is 53.33 yards wide (x) and 100 yards long (y) with 10-yard end zones.
// ===== data: teams, ratings, playbooks =====
// player: k=key, n=name, num, pos, spd, pow, skl, fill = position the original list left open
const mk = (n, num, pos, spd, pow, skl, fill) => ({ n, num, pos, spd, pow, skl, fill: !!fill });

// Offensive plays. routes: X / S(lot) / Z / T(E) / R(B). A route is a name or [name, dir] (dir +1 = toward TE side).
// d = depth class for CPU play-calling: r run, q quick, m medium, d deep
const PLAYS_MON = [
  { id: 'dive', name: 'PAYTON DIVE', tag: 'RUN', sub: 'INSIDE', type: 'run', d: 'r', run: { gap: 1.2, t: 0.45 } },
  { id: 'toss', name: 'PAYTON TOSS', tag: 'RUN', sub: 'OFF TACKLE', type: 'run', d: 'r', run: { gap: 6.6, t: 0.32 } },
  { id: 'quick', name: 'MOORE QUICK OUT', tag: 'PASS', sub: 'QUICK', type: 'pass', d: 'q', drop: 3,
    routes: { X: 'slant', S: 'out', Z: 'curl', T: 'seam', R: ['flat', -1] }, read: ['Z', 'S', 'X', 'R', 'T'] },
  { id: 'levels', name: 'LEVELS', tag: 'PASS', sub: 'MEDIUM', type: 'pass', d: 'm', drop: 4,
    routes: { X: 'in', S: 'cross', Z: 'post', T: 'curl', R: ['flat', 1] }, read: ['X', 'T', 'S', 'R', 'Z'] },
  { id: 'dbl', name: 'ALLEN DBL MOVE', tag: 'PASS', sub: 'DEEP', type: 'pass', d: 'd', drop: 6,
    routes: { X: 'post', S: 'dbl', Z: 'in', T: 'block', R: ['flat', 1] }, read: ['S', 'Z', 'X', 'R'] },
  { id: 'jump', name: 'JUMP BALL', tag: 'PASS', sub: 'DEEP', type: 'pass', d: 'd', drop: 6,
    routes: { X: 'fade', S: 'seam', Z: 'go', T: 'cross', R: 'block' }, read: ['X', 'S', 'T', 'Z'] },
];
const PLAYS_ANT = [
  { id: 'draw', name: 'FAULK DRAW', tag: 'RUN', sub: 'INSIDE', type: 'run', d: 'r', run: { gap: -1.2, t: 0.7 } },
  { id: 'stretch', name: 'STRETCH LEFT', tag: 'RUN', sub: 'OFF TACKLE', type: 'run', d: 'r', flip: true, run: { gap: 6.6, t: 0.32 } },
  { id: 'slants', name: 'QUICK SLANTS', tag: 'PASS', sub: 'QUICK', type: 'pass', d: 'q', drop: 3,
    routes: { X: 'slant', S: 'out', Z: 'slant', T: 'stick', R: ['flat', -1] }, read: ['X', 'Z', 'S', 'T', 'R'] },
  { id: 'texas', name: 'TEXAS', tag: 'PASS', sub: 'QUICK', type: 'pass', d: 'q', drop: 3,
    routes: { X: 'curl', S: 'out', Z: 'in', T: 'seam', R: ['angle', -1] }, read: ['R', 'S', 'X', 'T', 'Z'] },
  { id: 'seam', name: 'GRONK SEAM', tag: 'PASS', sub: 'MEDIUM', type: 'pass', d: 'm', drop: 5, flip: true,
    routes: { X: 'in', S: 'curl', Z: 'go', T: 'seam', R: 'block' }, read: ['T', 'X', 'S', 'Z'] },
  { id: 'moss', name: 'MOSS GO', tag: 'PASS', sub: 'MAX PROTECT', type: 'pass', d: 'd', drop: 6,
    routes: { X: 'post', S: 'cross', Z: 'go', T: 'block', R: 'block' }, read: ['Z', 'X', 'S'] },
];

// Defensive calls. Each entry: [rosterIdx, align, a1, a2, job, j1, j2]
// align 'b' = offset from ball (dx toward TE side, dy past LOS); 'm' = over receiver key with cushion; 'f' = field fraction + depth
// job: rush | man(recKey, over|trail) | zone(dx, depth) | deep(xfrac) ; run = how hard the call commits to the run (0..1)
const DCALLS_MON = [
  { name: '46 BLITZ', sub: '6 RUSH · MAN · 1 DEEP', run: 0.5, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 5.4, 1.1, 'rush'],
    [5, 'b', 8.3, 1.1, 'rush'], [6, 'b', -7.6, 1.1, 'rush'],
    [7, 'm', 'X', 6, 'man', 'X', 'over'], [8, 'm', 'Z', 6, 'man', 'Z', 'over'], [4, 'm', 'S', 4.5, 'man', 'S', 'over'],
    [10, 'm', 'T', 4, 'man', 'T', 'over'], [9, 'f', 0.5, 13, 'deep', 0.5]] },
  { name: '46 BEAR', sub: 'RUN STUFF · 8 IN BOX', run: 1, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 5.4, 1.1, 'rush'],
    [5, 'b', 9.8, 1.2, 'rush'],
    [7, 'm', 'X', 6, 'man', 'X', 'over'], [8, 'm', 'Z', 6, 'man', 'Z', 'over'], [6, 'm', 'S', 4.5, 'man', 'S', 'over'],
    [10, 'm', 'T', 3.5, 'man', 'T', 'over'], [4, 'b', 0, 3.6, 'man', 'R', 'over'], [9, 'f', 0.5, 13, 'deep', 0.5]] },
  { name: 'COVER 1', sub: '4 RUSH · MAN · 1 DEEP', run: 0.4, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 6, 1.1, 'rush'],
    [7, 'm', 'X', 2, 'man', 'X', 'trail'], [8, 'm', 'Z', 6, 'man', 'Z', 'over'], [6, 'm', 'S', 4, 'man', 'S', 'over'],
    [10, 'm', 'T', 4, 'man', 'T', 'over'], [5, 'b', -1.5, 4.2, 'man', 'R', 'over'], [4, 'b', 1, 5, 'zone', 0, 7],
    [9, 'f', 0.5, 15, 'deep', 0.5]] },
  { name: 'COVER 3', sub: '4 RUSH · ZONE · 3 DEEP', run: 0.4, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 6, 1.1, 'rush'],
    [7, 'f', 0.14, 8, 'deep', 0.17], [9, 'f', 0.5, 14, 'deep', 0.5], [8, 'f', 0.86, 8, 'deep', 0.83],
    [5, 'b', -9, 4.5, 'zone', -14, 5], [4, 'b', -2, 4.5, 'zone', -4.5, 6.5], [6, 'b', 3, 4.5, 'zone', 5, 6.5],
    [10, 'b', 9, 5, 'zone', 14, 5]] },
];
const DCALLS_ANT = [
  { name: '2-MAN', sub: '4 RUSH · MAN · 2 DEEP', run: 0.3, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 6, 1.1, 'rush'],
    [6, 'm', 'X', 1.8, 'man', 'X', 'trail'], [7, 'm', 'Z', 2.2, 'man', 'Z', 'trail'], [8, 'm', 'S', 2.5, 'man', 'S', 'trail'],
    [4, 'm', 'T', 4, 'man', 'T', 'trail'], [5, 'b', -1.5, 4.5, 'man', 'R', 'over'],
    [9, 'f', 0.27, 15, 'deep', 0.27], [10, 'f', 0.73, 15, 'deep', 0.73]] },
  { name: 'TAMPA 2', sub: '4 RUSH · ZONE · 2 DEEP', run: 0.4, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 6, 1.1, 'rush'],
    [6, 'm', 'X', 4, 'zone', -19, 4.5], [7, 'm', 'Z', 4, 'zone', 19, 4.5], [8, 'b', -8, 4.5, 'zone', -8, 7],
    [5, 'b', 5, 4.5, 'zone', 8, 7], [4, 'b', 0, 5, 'zone', 0, 12],
    [9, 'f', 0.25, 15, 'deep', 0.25], [10, 'f', 0.75, 15, 'deep', 0.75]] },
  { name: 'FIRE ZONE', sub: '5 RUSH · SLOT BLITZ · 3 DEEP', run: 0.5, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 6, 1.1, 'rush'],
    [8, 'b', -9, 1.6, 'rush'],
    [6, 'f', 0.14, 7, 'deep', 0.17], [9, 'f', 0.5, 14, 'deep', 0.5], [7, 'f', 0.86, 7, 'deep', 0.83],
    [5, 'b', -5, 4.5, 'zone', -10, 6], [4, 'b', 0, 4.5, 'zone', 0, 6.5], [10, 'b', 6, 5, 'zone', 10, 6]] },
  { name: 'RUN FIT', sub: 'RUN STUFF · LOTT IN BOX', run: 1, a: [
    [0, 'b', -6, 1.1, 'rush'], [1, 'b', -2, 1.1, 'rush'], [2, 'b', 2, 1.1, 'rush'], [3, 'b', 6, 1.1, 'rush'],
    [6, 'm', 'X', 5, 'man', 'X', 'over'], [7, 'm', 'Z', 5, 'man', 'Z', 'over'], [8, 'm', 'S', 4.5, 'man', 'S', 'over'],
    [10, 'm', 'T', 3, 'man', 'T', 'over'], [5, 'b', -2, 3.6, 'man', 'R', 'over'], [4, 'b', 1, 3.4, 'zone', 0, 3.5],
    [9, 'f', 0.5, 13, 'deep', 0.5]] },
];

const TEAMS = [
  { id: 0, name: 'MONSTROSITY', abbr: 'MON', hc: 'BEN JOHNSON', dc: 'BUDDY RYAN', scheme: 'MOTION SPREAD · 46 DEFENSE',
    col: { jersey: '#1d2f6f', helmet: '#f77f00', pants: '#f1f1f1', ez: '#16224f', ezt: '#f77f00', ui: '#f77f00' },
    tr: { rel: 0.36, onRun: 1, escape: 0.22, motion: 1, sep: 0.14, wRun: 0.3, w: { q: 0.28, m: 0.24, d: 0.18 }, dw: [0.36, 0.2, 0.24, 0.2] },
    off: {
      QB: mk('MAHOMES', 15, 'QB', 82, 97, 96), R: mk('PAYTON', 34, 'RB', 91, 97, 86),
      X: mk('B.MARSHALL', 15, 'WR', 87, 94, 92), S: mk('K.ALLEN', 13, 'WR', 86, 78, 97), Z: mk('D.MOORE', 2, 'WR', 94, 86, 92),
      T: mk('DITKA', 89, 'TE', 78, 93, 86, 1),
      LT: mk('TUNSIL', 78, 'LT', 66, 90, 95), LG: mk('Q.NELSON', 56, 'LG', 62, 97, 93), C: mk('WEBSTER', 52, 'C', 60, 96, 94),
      RG: mk('Z.MARTIN', 70, 'RG', 64, 93, 96, 1), RT: mk('F.GREGG', 75, 'RT', 66, 92, 96, 1) },
    def: [mk('MACK', 52, 'EDGE', 86, 95, 97), mk('HAMPTON', 99, 'DT', 72, 96, 94), mk('DENT', 95, 'DE', 82, 93, 96),
      mk('GARRETT', 95, 'EDGE', 89, 96, 98), mk('SINGLETARY', 50, 'MLB', 84, 97, 90), mk('O.WILSON', 55, 'OLB', 86, 92, 84),
      mk('W.MARSHALL', 58, 'OLB', 88, 93, 88), mk('DEION', 21, 'CB', 99, 72, 99), mk('TILLMAN', 33, 'CB', 89, 86, 90, 1),
      mk('FENCIK', 45, 'FS', 87, 88, 88, 1), mk('DUERSON', 22, 'SS', 87, 91, 86, 1)],
    k: mk('GOULD', 9, 'K', 50, 84, 88), kr: null, krDef: 7, lb: 4,
    plays: PLAYS_MON, dcalls: DCALLS_MON },
  { id: 1, name: 'ANTIDOTE', abbr: 'ANT', hc: 'BILL WALSH', dc: 'BILL BELICHICK', scheme: 'WEST COAST QUICK GAME · TWO-HIGH SHELL',
    col: { jersey: '#f4f4f4', helmet: '#d62839', pants: '#d4a72c', ez: '#a81f2d', ezt: '#f4f4f4', ui: '#ff5d6c' },
    tr: { rel: 0.18, onRun: 0, escape: 0.05, motion: 0, wRun: 0.28, w: { q: 0.36, m: 0.2, d: 0.16 }, dw: [0.3, 0.3, 0.18, 0.22] },
    off: {
      QB: mk('MARINO', 13, 'QB', 52, 98, 96), R: mk('FAULK', 28, 'RB', 93, 82, 95),
      X: mk('RICE', 80, 'WR', 90, 84, 99), S: mk('WELKER', 83, 'WR', 87, 72, 94), Z: mk('MOSS', 84, 'WR', 97, 82, 96),
      T: mk('GRONKOWSKI', 87, 'TE', 82, 97, 92),
      LT: mk('MUNOZ', 78, 'LT', 68, 96, 98), LG: mk('L.ALLEN', 73, 'LG', 64, 99, 93), C: mk('DAWSON', 63, 'C', 68, 92, 94),
      RG: mk('B.MATTHEWS', 74, 'RG', 64, 94, 95), RT: mk('L.JOHNSON', 65, 'RT', 70, 93, 95) },
    def: [mk('B.SMITH', 78, 'DE', 84, 94, 96), mk('DONALD', 99, 'DT', 84, 96, 99), mk('J.GREENE', 75, 'DT', 76, 98, 94),
      mk('L.TAYLOR', 56, 'EDGE', 91, 95, 99), mk('R.LEWIS', 52, 'MLB', 88, 97, 92), mk('BROOKS', 55, 'WLB', 90, 88, 95),
      mk('REVIS', 24, 'CB', 92, 78, 98), mk('R.WOODSON', 26, 'CB', 94, 86, 95), mk('C.WOODSON', 21, 'NB', 91, 85, 95),
      mk('E.REED', 20, 'FS', 92, 80, 99), mk('LOTT', 42, 'SS', 89, 97, 93)],
    k: mk('VINATIERI', 4, 'K', 50, 86, 92), kr: mk('HESTER', 23, 'KR', 98, 80, 97), krDef: -1, lb: 4,
    plays: PLAYS_ANT, dcalls: DCALLS_ANT },
];
TEAMS[0].kr = TEAMS[0].def[7];

// routes: offsets from the receiver's start, dx > 0 = toward the ball (inside). stop = settle at the end.
const ROUTES = {
  go: { p: [[0, 50]] }, fade: { p: [[-1.5, 8], [-2.5, 50]] }, seam: { p: [[0, 14], [0.5, 50]] },
  slant: { p: [[0, 3], [16, 14], [30, 24]] }, out: { p: [[0, 7], [-9, 7.5]], stop: 1 },
  in: { p: [[0, 11], [22, 12]] }, post: { p: [[0, 12], [10, 34], [12, 50]] },
  curl: { p: [[0, 11], [1.2, 9.2]], stop: 1 }, stick: { p: [[0, 6], [-1.5, 5.5]], stop: 1 },
  flat: { p: [[-6, 1], [-11, 2.5]], stop: 1 }, bubble: { p: [[-3, -1.5]], stop: 1 },
  cross: { p: [[2, 2.5], [26, 6]] }, dbl: { p: [[0, 7.5], [-3, 8.2], [-3.5, 50]], fake: 1 },
  angle: { p: [[-5, 1.5], [1, 7.5], [5, 13]], stop: 1 },
};

// ===== sim part 1: helpers + play setup =====
const FW = 53.33, MID = FW / 2;
// Film Room momentum, indexed by team id: a speed multiplier for the whole team and an extra one for the kick returner.
// Set by the study layer (study.js) after a quiz answer; read once per play when the players are created.
const BOOST = { ms: [1, 1], kr: [1, 1] };
let rnd = Math.random;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const spdOf = (r) => (3.4 + r.spd * 0.055) * 0.82;
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.87; // ~N(0,0.5)
const POSADJ = { TE: -8, RB: -16, WR: -28, QB: -30, KR: -28, K: -30 };
const blockScore = (r) => 0.6 * r.skl + 0.4 * r.pow + (POSADJ[r.pos] || 0);
const rushScore = (r) => (/^(DE|DT|EDGE)$/.test(r.pos) ? 0.6 * r.skl + 0.4 * r.pow : 0.5 * r.spd + 0.3 * r.pow + 0.2 * r.skl - 4);
const runDef = (r) => 0.7 * r.pow + 0.3 * r.spd + (/^(DE|DT|EDGE|MLB|OLB|WLB)$/.test(r.pos) ? 6 : 0);
const isOL = (p) => /^(LT|LG|C|RG|RT)$/.test(p.key);

function mkP(P, side, r, key, x, y) {
  const p = { i: P.length, side, r, key, x: clamp(x, 1.2, FW - 1.2), y: clamp(y, -9, 109), vx: 0, vy: 0, hy: side ? -1 : 1,
    stun: 0, eng: -1, engT: 0, free: 0, cd: 0, juke: 0, jcd: 0, sta: 1, an: 0, dive: 0, jump: 0, job: null, blk: -1, dbl: 0,
    ms: spdOf(r), h: [] };
  P.push(p); return p;
}

function buildRoute(p, spec, bx, f) {
  let name = spec, dir = 0;
  if (Array.isArray(spec)) { name = spec[0]; dir = spec[1]; }
  if (name === 'block') return null;
  const R = ROUTES[name];
  // inside = toward the ball; for backs the play says which way is "out"
  const ins = dir ? -dir * f : (p.x < bx ? 1 : -1);
  return { name, i: 0, stop: !!R.stop, fake: !!R.fake, done: false,
    pts: R.p.map(([dx, dy]) => [clamp(p.x + dx * ins, 1.6, FW - 1.6), Math.min(p.y + dy, 108)]) };
}

// Scrimmage play. off/def = team objects, oc = offensive play, dc = defensive call. Offense always attacks +y.
function setupScrim(off, def, oc, dc, los, bx) {
  const P = [], f = oc.flip ? -1 : 1, O = off.off, K = {};
  const o = (key, x, y) => (K[key] = mkP(P, 0, O[key], key, x, y));
  o('QB', bx, los - 4.6); o('R', bx - 1.9 * f, los - 4.9);
  o('LT', bx - 5, los - 0.7); o('LG', bx - 2.5, los - 0.7); o('C', bx, los - 0.7); o('RG', bx + 2.5, los - 0.7); o('RT', bx + 5, los - 0.7);
  o('T', bx + 7.5 * f, los - 0.7);
  o('X', bx - 16 * f, los - 0.5); o('Z', bx + 16 * f, los - 1.2); o('S', bx - 9.5 * f, los - 1.2); // tighter splits keep the whole formation on a phone screen
  const pl = { kind: 'scrim', P, K, bx, los, f, oc, dc, off, def, t: 0, live: false, dead: false, res: null, ev: [],
    ball: { st: 'held', c: 0, x: bx, y: los, z: 0 }, pass: oc.type === 'pass', thrown: false, caught: false, ret: false,
    run: false, pt: 1e9, rel: null, sel: 0, scr: false, ai: { next: 0, drop: los - (oc.drop || 5) - 2.2, away: false },
    user: -1, userSide: -1, recs: [], air: null, flags: [] };
  if (!pl.pass) pl.gapX = bx + oc.run.gap * f;
  if (pl.pass) {
    for (const k of ['X', 'S', 'Z', 'T', 'R']) {
      const p = K[k], rt = buildRoute(p, oc.routes[k], bx, f);
      if (rt) { p.rt = rt; pl.recs.push(p); } else p.pb = true;
    }
    pl.order = oc.read.map((k) => K[k]).filter((p) => p.rt);
  }
  for (const e of dc.a) {
    const [idx, at, a1, a2, job, j1, j2] = e; let x, y = los + a2;
    if (at === 'b') x = bx + a1 * f;
    else if (at === 'm') { const rp = K[a1]; x = rp.x + (rp.x < bx ? 0.9 : -0.9); }
    else x = (f > 0 ? a1 : 1 - a1) * FW;
    const p = mkP(P, 1, def.def[idx], 'D' + idx, x, Math.min(y, 107));
    p.job = job === 'man' ? { t: 'man', m: K[j1], tech: j2 }
      : job === 'zone' ? { t: 'zone', ax: clamp(bx + j1 * f, 3, FW - 3), ay: Math.min(los + j2, 106) }
      : job === 'deep' ? { t: 'deep', ax: (f > 0 ? j1 : 1 - j1) * FW, ay: Math.min(los + 14, 107) } : { t: 'rush' };
    p.rd = (0.75 - 0.6 * dc.run) * (1.3 - (p.r.skl / 99) * 0.5);
  }
  pl.D = P.filter((p) => p.side === 1); pl.O = P.filter((p) => p.side === 0);
  for (const p of P) p.ms *= BOOST.ms[p.side === 0 ? off.id : def.id];
  assignBlocks(pl);
  return pl;
}

// OL takes rushers inside-out; extra rushers go to backs/TE who stay in; anyone left over comes free.
function assignBlocks(pl) {
  const { bx, pass } = pl;
  const cand = pl.D.filter((d) => pass ? d.job.t === 'rush' : (d.job.t === 'rush' || d.y - pl.los < 6))
    .sort((a, b) => (pass ? Math.abs(a.x - bx) - Math.abs(b.x - bx) : (a.job.t === 'rush' ? 0 : 1) - (b.job.t === 'rush' ? 0 : 1) || Math.abs(a.x - bx) - Math.abs(b.x - bx)));
  const blockers = pl.O.filter((p) => isOL(p)).concat(pl.O.filter((p) => !isOL(p) && (pass ? p.pb : (p.key === 'T'))));
  const taken = new Set();
  for (const d of cand) {
    let best = null, bd = pass ? 6 : 9;
    for (const b of blockers) { if (taken.has(b.i)) continue; const dd = Math.abs(b.x - d.x) + (isOL(b) ? 0 : 2.5); if (dd < bd) { bd = dd; best = b; } }
    if (best) { best.blk = d.i; taken.add(best.i); }
  }
  for (const b of blockers) if (!taken.has(b.i)) b.help = true;
  if (!pass) for (const k of ['X', 'Z', 'S']) { // receivers stalk-block the nearest defensive back
    const w = pl.K[k]; let best = null, bd = 99;
    for (const d of pl.D) { if (d.job.t === 'rush') continue; const dd = dist(w, d); if (dd < bd) { bd = dd; best = d; } }
    if (best) w.blk = best.i;
  }
}

// Kickoff: receiving team is side 0 (attacks +y), kicking team side 1 kicks from y=65.
function setupKick(rec, kick) {
  const P = [], O = rec.off, keys = ['LT', 'LG', 'C', 'RG', 'RT', 'T', 'X', 'Z', 'S', 'R'];
  const kr = mkP(P, 0, rec.kr, 'KR', MID, 4);
  const spots = [[8, 34], [17, 36], [26.6, 37], [36, 36], [45, 34], [14, 26], [26.6, 27], [39, 26], [21, 16], [32, 16]];
  keys.forEach((k, n) => { const p = mkP(P, 0, O[k], k, spots[n][0], spots[n][1]); p.kb = true; });
  for (let n = 0; n < 10; n++) { const d = mkP(P, 1, kick.def[n === 7 && kick.krDef === 7 ? 10 : n], 'D' + n, 3.5 + n * 5.1, 64.5); d.job = { t: n === 4 ? 'safety' : 'cover' }; d.rd = 0; }
  const k = mkP(P, 1, kick.k, 'K', MID, 66); k.job = { t: 'safety' }; k.rd = 0;
  const tx = 12 + rnd() * 29, ty = 1 + rnd() * 7, T = 3.3 + rnd() * 0.4;
  const pl = { kind: 'ko', P, K: { KR: kr }, bx: MID, los: 35, f: 1, off: rec, def: kick, t: 0, live: false, dead: false, res: null, ev: [],
    ball: { st: 'air', kick: true, c: -1, sx: MID, sy: 65, tx, ty, x: MID, y: 65, z: 0, ft: 0, T, h: 16 },
    pass: false, thrown: false, caught: false, ret: false, run: false, pt: 1e9, rel: null, sel: 0, scr: false, ai: {},
    user: -1, userSide: -1, recs: [], air: null, flags: [], oc: { name: 'KICKOFF', type: 'ko' }, dc: { run: 1 } };
  pl.D = P.filter((p) => p.side === 1); pl.O = P.filter((p) => p.side === 0);
  for (const p of P) p.ms *= BOOST.ms[p.side === 0 ? rec.id : kick.id];
  kr.ms *= BOOST.kr[rec.id]; // PRIME TIME: a returner with momentum behind him
  return pl;
}

// ===== sim part 2: movement, ball carrier, quarterback, passing, blocking =====
function steer(p, dx, dy, mul, dt) {
  const m = Math.hypot(dx, dy); let tx = 0, ty = 0;
  if (m > 0.001 && mul > 0) { const s = p.ms * mul; tx = (dx / m) * s; ty = (dy / m) * s; }
  const a = 26 * dt, ex = tx - p.vx, ey = ty - p.vy, em = Math.hypot(ex, ey);
  if (em <= a) { p.vx = tx; p.vy = ty; } else { p.vx += (ex / em) * a; p.vy += (ey / em) * a; }
}
function goTo(p, x, y, mul, dt) {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.25) { steer(p, 0, 0, 0, dt); return true; }
  steer(p, dx, dy, mul * Math.min(1, d / 0.8 + 0.25), dt); return false;
}
function pursue(d, c, dt, mul) {
  const tl = clamp((dist(d, c) / (d.ms + 0.1)) * 0.85, 0, 1.1);
  steer(d, c.x + c.vx * tl - d.x, c.y + c.vy * tl - d.y, mul || 1, dt);
}
const idle = (inp) => !inp || Math.hypot(inp.mx, inp.my) < 0.2;
const carrier = (pl) => (pl.ball.st === 'held' ? pl.P[pl.ball.c] : null);

const HEADS = [-1.2, -0.85, -0.55, -0.28, 0, 0.28, 0.55, 0.85, 1.2];
function aiRun(pl, p, foes, dir) {
  if (pl.kind === 'scrim' && !pl.pass && p.key === 'R' && !pl.ret && pl.t - pl.pt < 1.1) { // hit the designed gap first
    const gx = pl.bx + pl.oc.run.gap * pl.f, gy = pl.los + 0.6;
    if (p.y < gy - 0.4 && Math.abs(gx - p.x) > 0.8) return [gx - p.x, Math.max(0.15, gy - p.y) * (Math.abs(pl.oc.run.gap) > 5 ? 0.5 : 1.4)];
  }
  // score a fan of headings by how crowded the ground ahead will be, then commit to the best lane
  let best = 0, bc = 1e9;
  for (const a of HEADS) {
    const hx = Math.sin(a), hy = Math.cos(a) * dir; let c = -Math.cos(a) * TUNE.fwd + (a === p.head ? -0.12 : 0);
    for (const L of [1.8, 4.2]) {
      const qx = p.x + hx * L, qy = p.y + hy * L, t = (L / p.ms) * 0.6;
      if (qx < 1.5 || qx > FW - 1.5) c += 1.5;
      for (const d of foes) {
        if (d.stun > 0) continue;
        const e = d.eng >= 0, fx = e ? d.x : d.x + d.vx * t, fy = e ? d.y : d.y + d.vy * t;
        c += ((e ? 0.25 : 1) * (L < 2 ? 1.6 : 1)) / ((qx - fx) ** 2 + (qy - fy) ** 2 + 0.6);
      }
    }
    if (c < bc) { bc = c; best = a; }
  }
  p.head = best;
  return [Math.sin(best), Math.cos(best) * dir];
}

function carrierStep(pl, p, dt, inp) {
  const dir = p.side === 0 ? 1 : -1, foes = p.side === 0 ? pl.D : pl.O;
  let dx, dy, mul = 1, near = 99;
  for (const d of foes) if (d.stun <= 0) near = Math.min(near, dist(d, p));
  const manual = inp && !idle(inp);
  if (manual) { dx = inp.mx; dy = inp.my; } else [dx, dy] = aiRun(pl, p, foes, dir);
  const turbo = inp ? inp.bh : near < 6 && p.sta > 0.25;
  if (turbo && p.sta > 0.03) { mul = 1.17; p.sta -= 0.55 * dt; } else p.sta = Math.min(1, p.sta + 0.22 * dt);
  const wantJ = inp ? inp.a : near < 2.0 && rnd() < dt * TUNE.aiJuke * (p.r.skl / 99);
  if (wantJ && p.jcd <= 0) { p.juke = 0.3; p.jcd = 1.8; p.vx += (dx >= 0 ? 1 : -1) * 3.4; pl.ev.push({ e: 'juke' }); }
  if (p.slow > 0) mul *= p.stumble > 0 ? 0.6 : 0.72;
  steer(p, dx, dy, mul, dt);
}

function ballSpeed(r) { return 15 + r.pow * 0.09; }
// How much room the receiver will have when the ball gets there, in yards (defenders break on the throw).
function openness(pl, qb, rc) {
  if (rc.stun > 0) return -9;
  const d = dist(qb, rc), T = (d / ballSpeed(qb.r)) * (1 + d / 70) + 0.08;
  if (d > 35 + qb.r.pow * 0.3) return -9;
  const done = rc.rt && rc.rt.done, lx = rc.x + (done ? 0 : rc.vx * T * 0.92), ly = rc.y + (done ? 0 : rc.vy * T * 0.92);
  let o = 99;
  for (const e of pl.D) {
    if (e.stun > 0 || e.eng >= 0) continue;
    const eff = Math.min(Math.hypot(e.x + e.vx * T - lx, e.y + e.vy * T - ly), Math.hypot(e.x - lx, e.y - ly) - e.ms * Math.max(0, T - 0.25));
    if (eff < o) o = eff;
  }
  rc.gain = ly - pl.los;
  return o;
}

function startThrow(pl, qb, rec, away) { if (!pl.rel) pl.rel = { t: pl.off.tr.rel, rec, away: !!away }; }

function launch(pl, qb, rec, away) {
  const b = pl.ball, r = qb.r, v = ballSpeed(r); let tx, ty, T = 0.6, d = 12;
  pl.rel = null; pl.thrown = true;
  if (away) { tx = qb.x < MID ? -2 : FW + 2; ty = qb.y + 10; T = 0.9; }
  else {
    const done = rec.rt && rec.rt.done;
    for (let k = 0; k < 4; k++) {
      tx = clamp(rec.x + (done ? 0 : rec.vx * T * 0.92), 1.2, FW - 1.2); ty = clamp(rec.y + (done ? 0 : rec.vy * T * 0.92), -8, 108.5);
      d = Math.hypot(tx - qb.x, ty - qb.y); T = (d / v) * (1 + d / 70) + 0.08;
    }
    const maxD = 35 + r.pow * 0.3;
    if (d > maxD) { const k = maxD / d; tx = qb.x + (tx - qb.x) * k; ty = qb.y + (ty - qb.y) * k; d = maxD; }
    let sig = (0.25 + d * 0.028) * (1.6 - (r.skl / 99) * 0.9);
    if (pl.D.some((e) => e.stun <= 0 && dist(e, qb) < 2.2)) sig *= 1.7;
    if (Math.hypot(qb.vx, qb.vy) > 2.5 && !pl.off.tr.onRun) sig *= 1.5;
    const hot = pl.D.some((e) => e.stun <= 0 && dist(e, qb) < 2.2);
    if (rnd() < 0.04 + (99 - r.skl) * 0.004 + (hot ? 0.12 : 0)) sig *= 4; // sailed it
    tx += gauss() * sig * 2; ty += gauss() * sig * 2;
    rec.toBall = true;
  }
  Object.assign(b, { st: 'air', kick: false, c: -1, sx: qb.x, sy: qb.y, tx, ty, ft: 0, T, h: Math.min(9, 0.6 + d * 0.13), rec: away ? -1 : rec.i, away: !!away, x: qb.x, y: qb.y });
  pl.air = { t0: pl.t }; pl.target = away ? null : rec; pl.ev.push({ e: 'throw' });
  if (pl.userSide === 1 && !away) { // hand the user the defender closest to where the ball is going
    let best = null, bd = 99;
    for (const e of pl.D) { if (e.stun > 0 || e.eng >= 0) continue; const dd = Math.hypot(e.x - tx, e.y - ty); if (dd < bd) { bd = dd; best = e; } }
    const cur = pl.user >= 0 ? pl.P[pl.user] : null;
    if (best && (!cur || Math.hypot(cur.x - tx, cur.y - ty) > bd + 3)) pl.user = best.i;
  }
}

function cpuQB(pl, qb, dt) {
  const ai = pl.ai, tr = pl.off.tr, t = pl.t;
  let thr = null, td = 99;
  for (const d of pl.D) { if (d.stun > 0 || d.eng >= 0) continue; const dd = dist(d, qb); if (dd < td && (d.job.t === 'rush' || dd < 5)) { td = dd; thr = d; } }
  let gx = pl.bx, gy = ai.drop + 2.2, mul = 0.7;
  if (thr && td < 4.5) {
    gx = qb.x + ((qb.x - thr.x) / td) * 3; gy = qb.y + clamp(((qb.y - thr.y) / td) * 2.5, -2.5, 1.5);
    mul = qb.r.spd >= 75 ? 0.85 : 0.65; gy = clamp(gy, ai.drop - 2, pl.los - 1);
  }
  goTo(qb, clamp(gx, Math.max(2, pl.bx - 11), Math.min(FW - 2, pl.bx + 11)), gy, mul, dt);
  if (ai.hold) return;
  if (t < ai.next) return; ai.next = t + 0.12;
  const pressure = td < 2.4 + tr.rel * 6, tMin = (pl.oc.d === 'q' ? 0.75 : pl.oc.d === 'm' ? 1.3 : 1.9) * (tr.rel < 0.25 ? 0.85 : 1);
  if (t < tMin && !pressure) return;
  // value = room at the catch + yards it would gain; the bar drops the longer he holds it
  let best = null, bs = -9, bo = -9;
  pl.order.forEach((rc, i) => {
    const o = openness(pl, qb, rc); if (o < 0.9) return;
    const v = Math.min(o, 3) + clamp(rc.gain, -3, 22) * TUNE.gainW + (i === 0 ? 0.35 : i === 1 ? 0.15 : 0) + (pl.oc.hot === rc.key ? 1.3 : rc.gain < 1.5 ? -0.9 : 0); // a dump-off short of the line is a last resort, unless it is the designed screen
    if (v > bs) { bs = v; bo = o; best = rc; }
  });
  if (best && bs >= TUNE.bar - (t - tMin) * 1.1) return startThrow(pl, qb, best);
  if (pressure) {
    if (best) return startThrow(pl, qb, best);
    if (t > 1.0 && td < 1.6 + tr.rel * 5) { // nobody open and the rush is here: run for it or get rid of it
      if (qb.r.spd >= 75 && rnd() < 0.5) { pl.scr = true; pl.run = true; pl.pt = Math.min(pl.pt, t); return; }
      if (rnd() < 0.55) return startThrow(pl, qb, null, true);
    }
  }
  if (t > 5.2) { pl.scr = true; pl.run = true; pl.pt = Math.min(pl.pt, t); }
}

function qbStep(pl, qb, dt, inp) {
  if (pl.rel) { pl.rel.t -= dt; steer(qb, 0, 0, 0, dt); if (pl.rel.t <= 0) launch(pl, qb, pl.rel.rec, pl.rel.away); return; }
  if (qb.y > pl.los + 0.4) { pl.scr = true; pl.run = true; pl.pt = Math.min(pl.pt, pl.t); return; }
  if (!inp) return cpuQB(pl, qb, dt);
  if (idle(inp)) { if (pl.t < 0.9) goTo(qb, pl.bx, pl.ai.drop + 2.2, 0.8, dt); else steer(qb, 0, 0, 0, dt); }
  else steer(qb, inp.mx, inp.my, 0.88, dt);
  let rec = null;
  if (inp.num != null && pl.order[inp.num]) rec = pl.order[inp.num];
  if (inp.tap) { let bd = 8; for (const r of pl.order) { const dd = Math.hypot(r.x - inp.tap.x, r.y - inp.tap.y); if (dd < bd) { bd = dd; rec = r; } } }
  if (inp.b) pl.sel = (pl.sel + 1) % pl.order.length;
  if (inp.a) rec = pl.order[pl.sel];
  if (rec && pl.t > 0.2) startThrow(pl, qb, rec);
}

function routeStep(pl, p, dt) {
  const rt = p.rt; if (!rt || rt.done) return steer(p, 0, 0, 0, dt);
  const [x, y] = rt.pts[rt.i], dx = x - p.x, dy = y - p.y;
  if (Math.hypot(dx, dy) < 0.7) { rt.i++; if (rt.fake && rt.i === 2) rt.bite = pl.t; if (rt.i >= rt.pts.length) rt.done = true; return; }
  steer(p, dx, dy, 0.96, dt);
}

function passBlockStep(pl, p, dt) {
  const qb = pl.K.QB; let d = p.blk >= 0 ? pl.P[p.blk] : null;
  if (!d || d.stun > 0 || (d.eng >= 0 && d.eng !== p.i)) {
    d = null; let bd = 5.5;
    for (const e of pl.D) { if (e.stun > 0 || e.eng >= 0 || e.free > 0.2 || (e.job.t !== 'rush' && e.y > pl.los + 1.5)) continue; const dd = dist(e, p); if (dd < bd) { bd = dd; d = e; } }
    p.blk = d ? d.i : -1;
  }
  if (!d) { // nobody to block: help a neighbour
    let e2 = null, bd = 4.5;
    for (const e of pl.D) { if (e.eng < 0) continue; const dd = dist(e, p); if (dd < bd) { bd = dd; e2 = e; } }
    if (e2) { e2.dbl = 0.3; goTo(p, e2.x + (p.x < e2.x ? -1.2 : 1.2), e2.y - 0.5, 0.8, dt); } else goTo(p, p.x, Math.min(p.y, pl.los - 1.5), 0.6, dt);
    return;
  }
  const ux = qb.x - d.x, uy = qb.y - d.y, m = Math.hypot(ux, uy) || 1;
  goTo(p, d.x + (ux / m) * 1.2, d.y + (uy / m) * 1.2, 1, dt);
}

function runBlockStep(pl, p, dt, c) {
  let d = p.blk >= 0 ? pl.P[p.blk] : null;
  if (!d || d.stun > 0 || (d.eng >= 0 && d.eng !== p.i) || d.free > 0) {
    d = null; let bd = isOL(p) ? 8 : 4.5;
    for (const e of pl.D) { if (e.stun > 0 || e.eng >= 0 || e.free > 0) continue; const dd = dist(e, p) + (c ? dist(e, c) * 0.3 : 0); if (dd < bd) { bd = dd; d = e; } }
    p.blk = d ? d.i : -1;
  }
  if (d) goTo(p, d.x, d.y, 1, dt);
  else if (c) goTo(p, c.x + (p.x < c.x ? -2.5 : 2.5), c.y + 4, 0.95, dt);
  else steer(p, 0, 0, 0, dt);
}

// ===== sim part 3: per-side logic, blocks, catches, tackles, main step =====
function offenseStep(pl, dt, inp) {
  const b = pl.ball, c = carrier(pl), ui = pl.userSide === 0 ? inp : null;
  for (const p of pl.O) {
    if (p.stun > 0) { steer(p, 0, 0, 0, dt); continue; }
    if (p.eng >= 0) continue;
    if (c === p) { if (p.key === 'QB' && pl.pass && !pl.scr && !pl.thrown) qbStep(pl, p, dt, ui); else carrierStep(pl, p, dt, ui); continue; }
    if (pl.ret) { if (c) pursue(p, c, dt); continue; }
    if (b.st === 'air') {
      if (b.kick) { if (p.key === 'KR') goTo(p, b.tx, b.ty, 1, dt); else steer(p, 0, 0, 0, dt); continue; }
      if (b.rec === p.i) { goTo(p, b.tx, b.ty, 1, dt); continue; }
    }
    if (pl.kind === 'ko') { runBlockStep(pl, p, dt, c); continue; }
    if (p.key === 'QB') { steer(p, 0, 0, 0, dt); continue; }
    if (pl.run && c) { runBlockStep(pl, p, dt, c); continue; }
    if (!pl.pass) { if (p.key === 'R') goTo(p, pl.bx + clamp(pl.oc.run.gap * pl.f, -1.5, 1.5), pl.los - 3.6, 0.9, dt); else runBlockStep(pl, p, dt, null); continue; }
    if (p.rt) routeStep(pl, p, dt); else passBlockStep(pl, p, dt);
  }
}

function aiDef(pl, d, dt, c, qb) {
  const b = pl.ball, j = d.job;
  if (j.t === 'cover' || j.t === 'safety') { // kickoff coverage
    if (b.st === 'air') return j.t === 'cover' ? goTo(d, d.x * 0.75 + b.tx * 0.25, b.ty + 14, 1, dt) : goTo(d, MID, 52, 0.5, dt);
    if (c) { if (j.t === 'safety' && c.y < 32) goTo(d, c.x * 0.5 + MID * 0.5, 50, 0.6, dt); else pursue(d, c, dt); }
    return;
  }
  if (b.st === 'air') {
    if (!b.away && pl.t - pl.air.t0 > 0.16 + (1 - d.r.skl / 99) * 0.5) {
      const dl = Math.hypot(d.x - b.tx, d.y - b.ty);
      if ((j.t === 'man' && j.m.i === b.rec) || dl < 13) return goTo(d, b.tx, b.ty, 1, dt);
      if (j.t === 'rush') return goTo(d, b.tx, b.ty, 0.8, dt);
    }
  } else if (c && pl.run && c.side === 0 && pl.t >= pl.pt + (j.t === 'rush' ? 0 : d.rd)) return pursue(d, c, dt);
  if (j.t === 'rush') return pursue(d, c && c.side === 0 ? c : qb, dt);
  if (j.t === 'man') {
    const m = j.m;
    if (!m.rt) { if (pl.pass && pl.t > 1.6) pursue(d, qb, dt); else goTo(d, clamp(qb.x, pl.bx - 6, pl.bx + 6), pl.los + 3.2, 0.7, dt); return; }
    const lag = clamp(TUNE.lag + (pl.off.tr.sep || 0) + (j.tech === 'trail' ? TUNE.trail : 0) + (m.r.skl - d.r.skl) * 0.011 + 0.07 * pl.dc.run + (m.rt.bite && pl.t - m.rt.bite < 0.7 ? 0.25 : 0) + Math.max(0, pl.t - 2.3) * TUNE.wear, 0.05, 0.7); // coverage cannot hold forever
    const n = m.h.length, hp = n ? m.h[Math.max(0, n - 1 - Math.round(lag * 60))] : [m.x, m.y, 0, 0];
    const px = hp[0] + hp[2] * lag, py = hp[1] + hp[3] * lag; // where he'd be if he hadn't cut since I last read him
    if (j.tech === 'trail') {
      if (!d.passed && m.y < d.y - 1) return void goTo(d, px, d.y, 0.9, dt); // sit at depth until he gets to me
      d.passed = true; return void goTo(d, px, py - 0.4, 1, dt);
    }
    const lev = m.x < pl.bx ? TUNE.lev : -TUNE.lev; // off-man plays with inside leverage: it sits on slants and gives up the out
    if (m.rt.i < 1 && !m.rt.done) return void goTo(d, px + lev, Math.max(py + 2.0, d.y), 0.92, dt); // keep a cushion through the stem
    return void goTo(d, px + lev, py + 0.7, 1, dt);
  }
  if (j.t === 'zone') {
    let tx = j.ax + (qb.x - pl.bx) * 0.4, ty = j.ay, best = null, bd = 8.5;
    for (const r of pl.recs) { const dd = Math.hypot(r.x - j.ax, r.y - j.ay); if (dd < bd) { bd = dd; best = r; } }
    if (best) { tx = j.ax * 0.3 + best.x * 0.7; ty = j.ay * 0.3 + (best.y + 1.2) * 0.7; }
    return void goTo(d, tx, ty, best ? 0.95 : 0.7, dt);
  }
  let tx = j.ax, ty = j.ay, deep = null; // deep zone: stay on top of the deepest threat in my part of the field
  for (const r of pl.recs) if (Math.abs(r.x - j.ax) < 13 && r.y > pl.los + 6 && (!deep || r.y > deep.y)) deep = r;
  if (deep) { tx = j.ax * 0.45 + deep.x * 0.55; ty = Math.max(j.ay, deep.y + 4); }
  goTo(d, tx, Math.min(ty, 107), 0.95, dt);
}

function defenseStep(pl, dt, inp) {
  const b = pl.ball, c = carrier(pl), qb = pl.K.QB;
  for (const d of pl.D) {
    d.shedTry = false;
    const ui = d.i === pl.user && pl.userSide === 1 ? inp : null;
    if (ui && ui.a) {
      if (d.eng >= 0) d.shedTry = rnd() < 0.4;
      else if (b.st === 'air') d.jump = 0.45;
      else if (d.stun <= 0 && d.dive <= 0 && c !== d) { // dive tackle
        let dx = idle(ui) ? (c ? c.x - d.x : 0) : ui.mx, dy = idle(ui) ? (c ? c.y - d.y : -1) : ui.my; const m = Math.hypot(dx, dy) || 1;
        d.vx = (dx / m) * 11; d.vy = (dy / m) * 11; d.dive = 0.24;
      }
    }
    if (d.stun > 0) { steer(d, 0, 0, 0, dt); continue; }
    if (d.eng >= 0 || d.dive > 0) continue;
    if (c === d) { carrierStep(pl, d, dt, ui); continue; }
    if (ui && !idle(ui)) { steer(d, ui.mx, ui.my, 1, dt); continue; }
    if (pl.ret) { if (c) goTo(d, c.x + (d.x < c.x ? -3 : 3), c.y - 3, 0.9, dt); continue; }
    aiDef(pl, d, dt, c, qb);
  }
}

// Throw a flag: one per side per play. side 0 = offense (or the return team), 1 = defense.
function flag(pl, type, side, by, x, y) { if (pl.flags.some((f) => f.side === side)) return; pl.flags.push({ type, side, by, x, y }); pl.ev.push({ e: 'flag', x, y }); }
function release(pl, d) { if (d.eng >= 0) { const o = pl.P[d.eng]; o.eng = -1; d.eng = -1; return o; } return null; }

function engageStep(pl, dt) {
  const P = pl.P, c = carrier(pl);
  if (pl.ret) { for (const d of pl.D) release(pl, d); return; }
  const runNow = pl.run || !pl.pass || pl.kind === 'ko';
  for (const o of pl.O) {
    if (o.blk < 0 || o.eng >= 0 || o.stun > 0 || o === c) continue;
    const d = P[o.blk];
    if (d.eng >= 0 || d.stun > 0 || d.free > 0 || d.dive > 0 || d === c) continue;
    if (dist(o, d) < 1.5) { o.eng = d.i; d.eng = o.i; d.engT = 0; if (pl.kind === 'ko' && rnd() < TUNE.bib) flag(pl, 'bib', 0, o, o.x, o.y); }
  }
  for (const d of pl.D) {
    if (d.eng < 0) continue;
    const o = P[d.eng], bs = blockScore(o.r); d.engT += dt;
    let lam, px = 0, py = 0;
    if (!runNow) {
      const rs = rushScore(d.r), qb = pl.K.QB, ux = qb.x - d.x, uy = qb.y - d.y, m = Math.hypot(ux, uy) || 1;
      lam = d.engT < TUNE.minEng ? 0 : TUNE.rush * Math.exp((rs - bs) / 8) * (1 - 0.35 * pl.dc.run) * (d.dbl > 0 ? 0.45 : 1);
      const v = clamp(0.4 + (rs - bs) * 0.03, 0.12, 1.2); px = (ux / m) * v; py = (uy / m) * v;
    } else {
      const ds = runDef(d.r);
      lam = d.engT < 0.35 ? 0 : TUNE.shed * Math.exp((ds - bs) / 9) * (0.7 + 0.8 * pl.dc.run) * (pl.kind === 'ko' ? 6 : 1);
      if (c && dist(c, d) < 3.2) lam += TUNE.nearShed;
      py = clamp(0.7 + (bs - ds) * 0.04, -0.3, 1.6);
      if (pl.gapX != null) px = clamp(d.x - pl.gapX, -1, 1) * 0.9; // wall the defender off from the hole
    }
    if (rnd() < lam * dt || d.shedTry) {
      if (!d.shedTry && pl.kind === 'scrim' && isOL(o) && !o.held && rnd() < TUNE.hold) { o.held = true; d.engT = -0.9; flag(pl, 'hold', 0, o, o.x, o.y); } // beaten, so he grabs: the block lasts a beat longer and the flag flies
      else { release(pl, d); d.free = 1.0; o.stun = 0.4; pl.ev.push({ e: 'shed' }); }
    }
    else { d.vx = o.vx = px; d.vy = o.vy = py; }
  }
}

function endPlay(pl, res) { pl.dead = true; pl.ball.st = 'dead'; pl.res = Object.assign({ x: pl.ball.x, y: pl.ball.y, t: pl.t }, res); }

function resolveArrival(pl) {
  const b = pl.ball, P = pl.P;
  if (b.kick) { const kr = pl.K.KR; kr.x = b.tx; kr.y = b.ty; b.st = 'held'; b.c = kr.i; pl.run = pl.caught = true; pl.pt = pl.t - 5; pl.ev.push({ e: 'catch' }); return; }
  if (b.away) return endPlay(pl, { type: 'inc', away: true });
  const rc = P[b.rec], L = { x: b.tx, y: b.ty };
  if (L.x < 0.3 || L.x > FW - 0.3 || L.y > 109.6) return endPlay(pl, { type: 'inc' });
  let c1 = 0, c2 = 0, D1 = null;
  for (const e of pl.D) {
    if (e.stun > 0 || e.eng >= 0) continue;
    const dd = dist(e, L); if (dd > 3) continue;
    let cv = (1 - dd / 3) * (0.55 + (0.45 * e.r.skl) / 99);
    if (e.jump > 0) cv = Math.min(1, cv * 1.4 + 0.1);
    if (cv > c1) { c2 = c1; c1 = cv; D1 = e; } else if (cv > c2) c2 = cv;
  }
  const cov = 1 - (1 - c1) * (1 - 0.5 * c2), dR = dist(rc, L), reach = dR < 2.3 && rc.stun <= 0;
  let pInt = D1 ? c1 * c1 * TUNE.int * (D1.r.skl / 99) ** 2 * (D1.jump > 0 ? 1.8 : 1) : 0;
  if (!reach && D1) pInt = Math.max(pInt, 0.3 * c1 * (D1.r.skl / 99) ** 2);
  if (b.h > 5) pInt *= 1.25;
  if (D1 && rnd() < pInt) {
    pl.int = D1; pl.ev.push({ e: 'int' });
    if (D1.y >= 100) return endPlay(pl, { type: 'tb', int: true, c: D1 });
    for (const d of pl.D) release(pl, d);
    D1.x = L.x; D1.y = L.y; b.st = 'held'; b.c = D1.i; pl.ret = pl.run = true; pl.pt = pl.t - 5;
    if (pl.userSide === 1) pl.user = D1.i;
    return;
  }
  if (reach) {
    const pc = (0.56 + (0.38 * rc.r.skl) / 99) * (1 - cov * (0.78 - (0.26 * rc.r.pow) / 99)) * (dR > 1.4 ? 0.8 : 1);
    if (rnd() < pc) { rc.x = L.x; rc.y = L.y; rc.slow = rc.fresh = TUNE.catchSlow; b.st = 'held'; b.c = rc.i; pl.caught = pl.run = true; pl.pt = pl.t - 5; pl.ev.push({ e: 'catch' }); return; }
  }
  if (reach && D1 && c1 > 0.5 && L.y > pl.los + 1 && rnd() < TUNE.dpi * (1.3 - (D1.r.skl / 99) * 0.6)) flag(pl, 'dpi', 1, D1, L.x, L.y); // got there early
  endPlay(pl, { type: 'inc', swat: !!D1 && c1 > 0.3, by: D1 });
}

function tryTackle(pl, t, c, sackable) {
  let p = sackable ? 0.92 - pl.off.tr.escape : clamp(TUNE.tkl + (t.r.pow - c.r.pow) * 0.004 + (t.dive > 0 ? 0.1 : 0) + (c.fresh > 0 || c.stumble > 0 ? 0.1 : 0), 0.45, 0.97);
  if (c.juke > 0) p *= TUNE.juke;
  if (t.eng >= 0) p *= TUNE.arm;
  t.cd = 0.9;
  if (rnd() < p) return true;
  release(pl, t); t.stun = 0.85; t.dive = 0; c.slow = 0.6; c.stumble = 0.6; pl.brk = (pl.brk || 0) + 1; pl.ev.push({ e: 'miss' });
  return false;
}

function contactStep(pl) {
  const b = pl.ball, c = carrier(pl); if (!c) return;
  b.x = c.x; b.y = c.y; b.z = 1;
  if (c.x < 0.5 || c.x > FW - 0.5) return endPlay(pl, { type: 'oob', c });
  if (c.side === 0 && c.y >= 100) return endPlay(pl, { type: 'td', c });
  if (c.side === 1 && c.y <= 0) return endPlay(pl, { type: 'td', c });
  const qbBack = c.key === 'QB' && pl.pass && !pl.thrown && c.y < pl.los;
  for (const t of c.side === 0 ? pl.D : pl.O) {
    if (t.stun > 0 || t.cd > 0) continue;
    if (dist(t, c) > (t.dive > 0 ? 1.75 : t.eng >= 0 ? 1.0 : 1.35)) continue;
    if (tryTackle(pl, t, c, qbBack && !pl.scr)) {
      const fum = c.side === 0 && rnd() < (qbBack ? TUNE.stripSack : 0.012);
      if (c.side === 0 && pl.kind === 'scrim' && rnd() < TUNE.fm) flag(pl, 'fm', 1, t, c.x, c.y);
      return endPlay(pl, { type: qbBack ? 'sack' : 'tackle', c, by: t, fum });
    }
  }
}

function switchDef(pl) {
  const b = pl.ball, tx = b.st === 'air' ? b.tx : b.x, ty = b.st === 'air' ? b.ty : b.y; let best = null, bd = 1e9;
  for (const e of pl.D) { if (e.stun > 0.3 || e.i === pl.user) continue; const dd = Math.hypot(e.x - tx, e.y - ty) + (e.eng >= 0 ? 6 : 0); if (dd < bd) { bd = dd; best = e; } }
  if (best) pl.user = best.i;
}

function snap(pl) { pl.live = true; pl.ev.push({ e: 'snap' }); }

function stepPlay(pl, dt, inp) {
  if (!pl.live || pl.dead) return;
  pl.t += dt; const b = pl.ball;
  for (const p of pl.P) {
    if (p.stun > 0) p.stun -= dt; if (p.free > 0) p.free -= dt; if (p.cd > 0) p.cd -= dt; if (p.juke > 0) p.juke -= dt; if (p.jcd > 0) p.jcd -= dt;
    if (p.slow > 0) p.slow -= dt; if (p.stumble > 0) p.stumble -= dt; if (p.fresh > 0) p.fresh -= dt; if (p.dbl > 0) p.dbl -= dt; if (p.jump > 0) p.jump -= dt;
    if (p.dive > 0) { p.dive -= dt; if (p.dive <= 0) { p.stun = 0.7; p.vx = p.vy = 0; } }
    if (p.rt) { p.h.push([p.x, p.y, p.vx, p.vy]); if (p.h.length > 50) p.h.shift(); }
  }
  if (pl.kind === 'scrim' && !pl.pass && !pl.run && pl.t >= pl.oc.run.t) { b.c = pl.K.R.i; pl.run = true; pl.pt = pl.t; pl.ev.push({ e: 'handoff' }); }
  if (b.st === 'air') {
    b.ft += dt; const u = Math.min(1, b.ft / b.T);
    b.x = b.sx + (b.tx - b.sx) * u; b.y = b.sy + (b.ty - b.sy) * u; b.z = 4 * b.h * u * (1 - u) + 1.2;
    if (u >= 1) { resolveArrival(pl); if (pl.dead) return; }
    else if (!b.kick && pl.air && pl.t - pl.air.t0 > 0.22 && pl.t - pl.air.t0 < 0.7) { // a hit on the passer after the ball is gone
      const qb = pl.K.QB;
      for (const d of pl.D) { if (d.rtp || d.stun > 0 || d.eng >= 0 || dist(d, qb) > 1.3) continue; d.rtp = true; if (rnd() < (d.dive > 0 ? 0.85 : TUNE.rtp)) { flag(pl, 'rtp', 1, d, qb.x, qb.y); qb.stun = 1.2; pl.ev.push({ e: 'miss' }); } }
    }
  }
  const c = carrier(pl);
  if (pl.userSide === 0) pl.user = c && c.side === 0 ? c.i : b.st === 'air' && b.rec >= 0 ? b.rec : -1;
  else if (pl.userSide === 1) {
    if (c && c.side === 1) pl.user = c.i;
    else if ((inp && inp.b) || pl.user < 0 || pl.P[pl.user].stun > 0.3) switchDef(pl);
  }
  offenseStep(pl, dt, inp); defenseStep(pl, dt, inp); engageStep(pl, dt);
  for (const p of pl.P) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.an += Math.hypot(p.vx, p.vy) * dt;
    if (p !== c) p.x = clamp(p.x, 0.8, FW - 0.8);
    p.y = clamp(p.y, -9.6, 109.6);
  }
  contactStep(pl);
  if (!pl.dead && pl.t > 30) endPlay(pl, { type: 'tackle', c: c || pl.P[0] });
}

// ===== game rules: downs, clock, scoring, CPU coaching =====
const TUNE = { rush: 0.22, minEng: 0.6, shed: 0.2, nearShed: 0.5, int: 0.09, stripSack: 0.06, tkl: 0.78, juke: 0.6, aiJuke: 1.5, lag: 0.34, arm: 0.3, fwd: 2.0, gainW: 0.14, bar: 3.7, catchSlow: 0.45, fs: 0.006, offs: 0.006, hold: 0.009, dpi: 0.14, rtp: 0.03, fm: 0.006, bib: 0.008, lev: 0.9, wear: 0.1, trail: 0.05 };
const mkStats = () => ({ pa: 0, pc: 0, py: 0, ra: 0, ry: 0, sk: 0, to: 0, fd: 0, plays: 0, pen: 0, peny: 0 });
const pick = (arr, w) => { let s = 0; for (const x of w) s += x; let r = rnd() * s; for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; } return arr[arr.length - 1]; };
const ORD = ['', '1ST', '2ND', '3RD', '4TH'];

function newGame(o) {
  const first = rnd() < 0.5 ? 0 : 1;
  return { score: [0, 0], poss: first, ydl: 25, down: 1, togo: 10, qtr: 1, clock: o.qlen, qlen: o.qlen, user: o.user,
    stats: [mkStats(), mkStats()], over: false, ot: false, bx: MID, first, next: { k: 'ko', rec: first }, drives: [] };
}
function firstDown(G, ydl) { G.ydl = clamp(Math.round(ydl), 1, 99); G.down = 1; G.togo = Math.min(10, 100 - G.ydl); }
function flip(G, ydl, x) { G.poss = 1 - G.poss; G.bx = clamp(FW - (x == null ? MID : x), 23.6, 29.7); firstDown(G, ydl); }
function runoff(G, stop) { if (!stop) G.clock -= (G.qtr === 2 || G.qtr >= 4) && G.clock < 60 ? 6 : 12; if (G.clock < 0) G.clock = 0; }
const fgDist = (G) => Math.round(100 - G.ydl + 17);
const fgRange = (k) => 43 + k.pow * 0.13;
function kickProb(k, d) { return d > 45 + k.pow * 0.15 ? 0.02 : clamp(1.02 - Math.max(0, d - 18) * 0.012 * (1.9 - k.skl / 99), 0.03, 0.99); }

// ---- penalties ----
const PEN = { fs: 'FALSE START', offs: 'OFFSIDE', hold: 'HOLDING', dpi: 'PASS INTERFERENCE', rtp: 'ROUGHING THE PASSER', fm: 'FACE MASK', bib: 'ILLEGAL BLOCK IN THE BACK' };
const halfTo = (n, room) => Math.min(n, Math.max(1, Math.floor(room / 2))); // half the distance near a goal line
const culprit = (f) => (f.by ? ` (#${f.by.r.num} ${f.by.r.n})` : '');
const charge = (G, team, yds) => { G.stats[team].pen++; G.stats[team].peny += yds; };
// Roll for a dead-ball foul as the teams get set. Returns an outcome (and moves the ball) or null.
function preSnapFoul(G, pl) {
  const rush = pl.D.filter((d) => d.job.t === 'rush'), r = rnd(), hot = rush.length >= 5 ? 1.7 : 1, y0 = G.ydl, o = G.poss;
  if (r < TUNE.fs * hot) {
    const by = pl.K[['LT', 'LG', 'RG', 'RT', 'T'][(rnd() * 5) | 0]], f = { type: 'fs', side: 0, by, x: by.x, y: by.y }; pl.flags.push(f);
    G.ydl = Math.max(1, y0 - halfTo(5, y0)); G.togo += y0 - G.ydl; charge(G, o, y0 - G.ydl);
    return { text: `FALSE START, OFFENSE${culprit(f)} — ${y0 - G.ydl} YARDS, STILL ${ORD[G.down]} DOWN`, banner: 'FALSE START', tone: 'flag' };
  }
  if (r < (TUNE.fs + TUNE.offs) * hot) {
    const by = rush[(rnd() * rush.length) | 0], f = { type: 'offs', side: 1, by, x: by.x, y: by.y }; pl.flags.push(f);
    const g = halfTo(5, 100 - y0); charge(G, 1 - o, g);
    if (g >= G.togo) { G.stats[o].fd++; firstDown(G, y0 + g); } else { G.ydl = y0 + g; G.togo -= g; }
    return { text: `OFFSIDE, DEFENSE${culprit(f)} — ${g} YARDS${G.down === 1 && G.togo === Math.min(10, 100 - G.ydl) ? ', FIRST DOWN' : ''}`, banner: 'OFFSIDE', tone: 'flag' };
  }
  return null;
}
// A flag on a live play: the other team takes whichever outcome suits it. Returns the outcome if accepted, null if declined.
function enforce(G, pl, f) {
  const r = pl.res, o = G.poss, y0 = G.ydl, turnover = !!pl.int || !!r.fum, offTD = r.type === 'td' && !pl.int && r.c && r.c.side === 0;
  const endY = (r.type === 'tackle' || r.type === 'oob') && r.c && r.c.side === 0 ? clamp(Math.round(r.y), 1, 99) : y0;
  if (f.type === 'hold') { // on the offense: ten yards and do it over, unless the defense likes the play as it stands
    const failed = turnover || r.type === 'sack' || r.y <= 0 || (G.down >= 3 && endY - y0 < G.togo);
    if (failed && !offTD) return null;
    G.ydl = Math.max(1, y0 - halfTo(10, y0)); G.togo += y0 - G.ydl; charge(G, o, y0 - G.ydl);
    return { text: `HOLDING, OFFENSE${culprit(f)} — ${y0 - G.ydl} YARDS, REPLAY ${ORD[G.down]} DOWN`, banner: 'HOLDING', tone: 'flag' };
  }
  if (offTD) return null; // on the defense, but the touchdown stands
  let spot, how;
  if (f.type === 'dpi') { spot = clamp(Math.round(f.y), y0 + 1, 99); how = `BALL AT THE SPOT, ${spot - y0} YARDS`; }
  else { const base = turnover || r.type !== 'tackle' && r.type !== 'oob' ? y0 : Math.max(endY, y0), g = halfTo(15, 100 - base); spot = Math.min(99, base + g); how = `${g} YARDS`; }
  charge(G, 1 - o, spot - Math.max(endY, y0) > 0 ? Math.min(spot - y0, f.type === 'dpi' ? spot - y0 : 15) : 0); G.stats[o].fd++; firstDown(G, spot);
  return { text: `${PEN[f.type]}, DEFENSE${culprit(f)} — ${how}, AUTOMATIC FIRST DOWN`, banner: PEN[f.type], tone: 'flag' };
}

// Apply a finished scrimmage play. Returns { text, banner, tone } for the presentation layer.
function applyScrim(G, pl) {
  const r = pl.res, o = G.poss, d = 1 - o, S = G.stats[o], los = pl.los, QB = pl.K.QB.r.n, cn = r.c ? r.c.r.n : '';
  const gain = Math.round(r.y - los), thrown = pl.thrown && !pl.ball.away;
  let text = '', banner = '', tone = '', stop = false;
  const fo = pl.flags.find((f) => f.side === 0), fdf = pl.flags.find((f) => f.side === 1), fl = fo || fdf;
  if (fo && fdf) { runoff(G, true); return { text: `OFFSETTING PENALTIES: ${PEN[fo.type]} AND ${PEN[fdf.type]} — REPLAY ${ORD[G.down]} DOWN`, banner: 'OFFSETTING FOULS', tone: 'flag' }; }
  if (fl) { const pen = enforce(G, pl, fl); if (pen) { runoff(G, true); return pen; } }
  S.plays++; if (pl.thrown) S.pa++;
  const scoreTD = (team) => { G.score[team] += 6; G.next = { k: 'pat', team }; banner = 'TOUCHDOWN!'; tone = 'td'; stop = true; };
  if (pl.int) {
    S.to++; stop = true; tone = 'to'; banner = 'INTERCEPTION!'; text = `${QB} PICKED OFF BY ${pl.int.r.n}`;
    if (r.type === 'td') { text += ' — PICK SIX!'; G.poss = d; scoreTD(d); banner = 'PICK SIX!'; }
    else flip(G, r.type === 'tb' || r.y >= 100 ? 20 : 100 - r.y, r.x);
  } else if (r.type === 'inc') {
    stop = true; text = r.away ? `${QB} THROWS IT AWAY` : r.swat && r.by ? `INCOMPLETE — BROKEN UP BY ${r.by.r.n}` : `${QB} PASS INCOMPLETE`;
  } else {
    if (r.type === 'sack') { G.stats[d].sk++; text = `${QB} SACKED BY ${r.by.r.n} FOR -${Math.max(0, -gain)}`; banner = 'SACK!'; tone = 'hit'; }
    else if (pl.caught) { S.pc++; S.py += gain; text = `${QB} TO ${cn} FOR ${gain}`; }
    else { S.ra++; S.ry += gain; text = gain >= 0 ? `${cn} RUNS FOR ${gain}` : `${cn} STOPPED FOR A LOSS OF ${-gain}`; }
    if (r.type === 'oob') stop = true;
    if (r.type === 'td') { scoreTD(o); text += ' — TOUCHDOWN!'; }
    else if (r.fum) { S.to++; stop = true; tone = 'to'; banner = 'FUMBLE!'; text = `${cn} FUMBLES — ${r.by.r.n} RECOVERS`; flip(G, clamp(100 - r.y, 1, 99), r.x); }
    else if (r.y <= 0) { G.score[d] += 2; G.next = { k: 'ko', rec: d }; banner = 'SAFETY!'; tone = 'to'; stop = true; text += ' — SAFETY'; }
    else {
      const ny = clamp(Math.round(r.y), 1, 99), g = ny - G.ydl; G.bx = clamp(r.x, 23.6, 29.7);
      if (g >= G.togo) { S.fd++; firstDown(G, ny); if (gain >= 20) { banner = 'BIG PLAY!'; tone = 'big'; } else banner = 'FIRST DOWN'; }
      else if (G.down === 4) { stop = true; tone = 'to'; banner = 'TURNOVER ON DOWNS'; flip(G, 100 - ny, r.x); }
      else { G.down++; G.togo -= g; G.ydl = ny; }
    }
  }
  if (r.type === 'inc') { if (G.down === 4) { tone = 'to'; banner = 'TURNOVER ON DOWNS'; flip(G, 100 - G.ydl, G.bx); } else G.down++; }
  runoff(G, stop);
  if (fl) text += ` — ${PEN[fl.type]} DECLINED`;
  return { text, banner, tone };
}

function applyKick(G, pl) {
  const r = pl.res, kr = r.c ? r.c.r.n : ''; let text, banner = '', tone = '';
  const f = pl.flags.find((q) => q.side === 0);
  if (f && !r.fum) { // illegal block on the return: ten yards back from the foul or the end of the run, whichever is worse
    const base = Math.min(r.type === 'td' ? 100 : r.y, f.y), ny = Math.max(1, Math.round(base - halfTo(10, base))); charge(G, G.poss, Math.round(base - ny));
    firstDown(G, ny); G.bx = clamp(r.x, 23.6, 29.7); G.next = { k: 'call' };
    return { text: `${r.type === 'td' ? 'TOUCHDOWN COMES BACK' : 'RETURN COMES BACK'} — ${PEN.bib}${culprit(f)}, BALL AT THE ${ny}`, banner: 'FLAG ON THE RETURN', tone: 'flag' };
  }
  if (r.type === 'td') { G.score[G.poss] += 6; G.next = { k: 'pat', team: G.poss }; text = `${kr} TAKES IT ALL THE WAY!`; banner = 'TOUCHDOWN!'; tone = 'td'; }
  else if (r.fum) { text = `${kr} FUMBLES THE RETURN — ${r.by.r.n} RECOVERS`; banner = 'FUMBLE!'; tone = 'to'; flip(G, clamp(100 - r.y, 1, 99), r.x); G.next = { k: 'call' }; }
  else { firstDown(G, Math.max(r.y, 1)); G.bx = clamp(r.x, 23.6, 29.7); text = `${kr} RETURNS IT TO THE ${G.ydl}`; G.next = { k: 'call' }; if (r.y > 45) { banner = 'BIG RETURN!'; tone = 'big'; } }
  return { text, banner, tone };
}
function applyPAT(G, team, good) { if (good) G.score[team]++; G.next = { k: 'ko', rec: 1 - team }; return { text: good ? 'EXTRA POINT IS GOOD' : 'EXTRA POINT NO GOOD', banner: '', tone: good ? 'good' : 'bad' }; }
function applyFG(G, good) {
  const d = fgDist(G), k = TEAMS[G.poss].k.n; G.clock = Math.max(0, G.clock - 5);
  if (good) { G.score[G.poss] += 3; G.next = { k: 'ko', rec: 1 - G.poss }; return { text: `${k} ${d}-YARD FIELD GOAL IS GOOD`, banner: 'IT’S GOOD!', tone: 'good' }; }
  flip(G, Math.max(20, 100 - (G.ydl - 7))); G.next = { k: 'call' };
  return { text: `${k} MISSES FROM ${d}`, banner: 'NO GOOD', tone: 'bad' };
}
function applyPunt(G) {
  const net = Math.round(36 + rnd() * 16), land = G.ydl + net, tb = land >= 100; G.clock = Math.max(0, G.clock - 8);
  flip(G, tb ? 20 : clamp(100 - land, 1, 99)); G.next = { k: 'call' };
  return { text: tb ? 'PUNT INTO THE END ZONE — TOUCHBACK' : `PUNT ${net} YARDS, FAIR CATCH`, banner: '', tone: '' };
}

// Call after every play. Returns 'qtr' | 'half' | 'ot' | 'final' | null.
function advance(G) {
  if (G.ot && G.score[0] !== G.score[1]) { G.over = true; G.next = { k: 'end' }; return 'final'; }
  if (G.clock > 0 || G.next.k === 'pat') return null;
  if (G.qtr === 2) { G.qtr = 3; G.clock = G.qlen; G.next = { k: 'ko', rec: 1 - G.first }; return 'half'; }
  if (G.qtr >= 4) {
    if (G.score[0] !== G.score[1]) { G.over = true; G.next = { k: 'end' }; return 'final'; }
    G.ot = true; G.qtr++; G.clock = G.qlen; if (G.qtr === 5) G.next = { k: 'ko', rec: rnd() < 0.5 ? 0 : 1 }; return 'ot';
  }
  G.qtr++; G.clock = G.qlen; return 'qtr';
}

function cpuOff(G) {
  const t = TEAMS[G.poss], tr = t.tr, lead = G.score[G.poss] - G.score[1 - G.poss], late = G.qtr >= 4 && G.clock < 75;
  const fd = fgDist(G), inRange = fd <= fgRange(t.k);
  if (inRange && G.clock <= 7 && (G.qtr === 2 || (G.qtr >= 4 && lead <= 0 && lead >= -3))) return { k: 'fg' };
  if (G.down === 4) {
    const must = (late && lead < 0 && (lead < -3 || !inRange)) || (G.ot && !inRange && G.ydl > 50);
    if (!must) {
      if (inRange) { if (!(G.togo <= 1 && G.ydl > 92 && lead < 0)) return { k: 'fg' }; }
      else if (!(G.togo <= 1 && G.ydl >= 55)) return { k: 'punt' };
    }
  }
  const w = { r: tr.wRun, q: tr.w.q, m: tr.w.m, d: tr.w.d };
  if (G.togo <= 2) { w.r *= 2.2; w.d *= 0.4; }
  if (G.togo >= 8 && G.down > 1) w.r *= 0.55;
  if (G.down >= 3 && G.togo >= 5) { w.r *= 0.25; if (G.togo > 8) w.q *= 0.5; }
  if (G.ydl > 88) { w.d *= 0.25; w.m *= 0.7; }
  if (late && lead < 0) w.r *= 0.2;
  if (G.qtr >= 4 && lead > 0) w.r *= 2;
  return { k: 'play', play: pick(t.plays, t.plays.map((p) => w[p.d])) };
}
// Ben Johnson's motion shows the coverage before the snap: a CPU offense with that trait checks out of a bad look.
function audible(off, play, dc) {
  if (!off.tr.motion || rnd() > 0.65) return play;
  const deep = dc.a.filter((e) => e[4] === 'deep').length, alt = (d) => { const c = off.plays.filter((p) => p.d === d); return c[(rnd() * c.length) | 0] || play; };
  if (play.type === 'run' && dc.run === 1) return alt(rnd() < 0.5 ? 'q' : 'd');
  if (play.d === 'd' && deep >= 2) return alt(rnd() < 0.5 ? 'q' : 'm');
  if (play.type === 'pass' && dc.run < 0.45 && deep >= 2 && rnd() < 0.5) return alt('r');
  return play;
}
function cpuDef(G) {
  const t = TEAMS[1 - G.poss], w = t.tr.dw.slice();
  t.dcalls.forEach((c, i) => { if (c.run === 1) w[i] *= G.togo <= 2 ? 2.6 : G.togo >= 8 ? 0.35 : 1; });
  return pick(t.dcalls, w);
}
const situation = (G) => `${ORD[G.down]} & ${G.ydl + G.togo >= 100 ? 'GOAL' : G.togo}`;
const ballOn = (G) => (G.ydl === 50 ? '50' : G.ydl < 50 ? `${TEAMS[G.poss].abbr} ${G.ydl}` : `${TEAMS[1 - G.poss].abbr} ${100 - G.ydl}`);
