// Headless smoke test: boots the page in Chromium with software WebGL, plays a CPU-vs-CPU stretch at high speed,
// exercises the Film Room (ask, answer, parse pasted notes, import/export, game-break cadence) and takes screenshots.
// Usage: node test/smoke.mjs   (expects the repo root as cwd; serves it on a local port)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd(), PORT = 8765 + Math.floor(Math.random() * 1000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''), f = join(ROOT, p === '/' ? 'index.html' : p);
  try { const b = await readFile(f); res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(b); } catch (e) { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fails = [], log = (...a) => console.log('·', ...a), ok = (cond, msg) => { if (cond) log('ok', msg); else { fails.push(msg); console.log('FAIL', msg); } };
const errors = [];
// Offline runners: THREE_LOCAL=/path/to/three.min.js serves the library in place of the CDN; Google Fonts are stubbed.
const THREE_LOCAL = process.env.THREE_LOCAL || '/tmp/claude-0/-home-user-Claude/4fdb8513-8b9c-5a88-9818-a7e4a91d41b5/scratchpad/vendor/three.min.js';
const offline = async (pg) => {
  try { await readFile(THREE_LOCAL); await pg.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ path: THREE_LOCAL, contentType: 'text/javascript' })); } catch (e) {}
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
};
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
await offline(page);
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mb && window.__mb.r3, null, { timeout: 15000 });
await page.waitForTimeout(1200);

const boot = await page.evaluate(() => { const R = __mb.r3(); return { ok: R.ok, calls: R.rn ? R.rn.info.render.calls : -1, tris: R.rn ? R.rn.info.render.triangles : -1, decks: typeof DECKS !== 'undefined' ? DECKS.map((d) => d.id + ':' + d.cards.length).join(',') : 'none', ph: __mb.ph() }; });
ok(boot.ok, 'WebGL renderer started');
log('draw calls on the title screen:', boot.calls, 'triangles:', boot.tris, 'decks:', boot.decks, 'phase:', boot.ph);
ok(boot.calls > 0 && boot.calls < 80, `title scene draws in under 80 calls (${boot.calls})`);
await page.screenshot({ path: 'test/shot-title.png' });

// ---- a CPU vs CPU stretch at 12x speed: kickoffs, drives, scoring, no errors ----
await page.evaluate(() => { __mb.Study.settings().when = 'off'; __mb.Study.settings().timer = 0; __mb.start(-1); window.__mb.speed = 12; });
const t0 = Date.now(); let st = null;
while (Date.now() - t0 < 60000) {
  await page.waitForTimeout(1500);
  st = await page.evaluate(() => { const G = __mb.G(); return G ? { plays: G.stats[0].plays + G.stats[1].plays, score: G.score.slice(), qtr: G.qtr, clock: Math.round(G.clock), ph: __mb.ph(), over: G.over } : null; });
  if (st && (st.plays >= 40 || st.over)) break;
}
log('after the stretch:', JSON.stringify(st));
ok(st && st.plays >= 12, `at least 12 scrimmage plays ran (${st && st.plays}; software GL bounds this)`);
const live = await page.evaluate(() => { const R = __mb.r3(); return { calls: R.rn.info.render.calls, prog: R.rn.info.programs.length }; });
log('draw calls mid-game:', live.calls, 'shader programs:', live.prog);
ok(live.calls < 90, `in-game frame draws in under 90 calls (${live.calls})`);
await page.screenshot({ path: 'test/shot-game.png' });

// ---- Film Room: parsing ----
const parse = await page.evaluate(async () => {
  const S = __mb.Study, out = {};
  const r1 = await S.make('mitochondria | powerhouse of the cell\nribosome | makes proteins\nnucleus | holds the DNA\nvacuole | storage bubble\nchloroplast | photosynthesis happens here', 'Bio pairs', () => {});
  out.pairs = { n: r1.deck.cards.length, types: r1.deck.cards.map((c) => c.type).join(''), note: r1.note };
  const r2 = await S.make('Q: What is sup A?\nA: the least upper bound of A\nQ: Name the theorem: every bounded sequence has a convergent subsequence\nA: Bolzano–Weierstrass', 'QA', () => {});
  out.qa = { n: r2.deck.cards.length, q0: r2.deck.cards[0].q, a0: r2.deck.cards[0].a };
  let note = ''; const r3 = await S.make('The Weierstrass M-test gives uniform convergence of a series of functions when the terms are bounded by a convergent series of constants. Uniform limits of continuous functions are continuous on the whole interval. Riemann rearranged a conditionally convergent series to any real sum.', 'Free text', (s) => (note = s));
  out.free = { n: r3.deck.cards.length, made: r3.deck.made, note: r3.note };
  out.match = [S.matches({ a: 'Bolzano–Weierstrass', alt: [] }, 'bolzano weierstrass'), S.matches({ a: 'Bolzano–Weierstrass', alt: [] }, 'bolzano-wierstrass'), S.matches({ a: '1/2', alt: ['0.5'] }, '0.50'), S.matches({ a: 'the Cantor set', alt: [] }, 'cantor set'), S.matches({ a: 'Paris', alt: [] }, 'London')];
  const json = S.exportJSON(); const r4 = S.importJSON(JSON.parse(json)); out.imp = r4 && r4.note;
  out.decks = S.allDecks().map((d) => d.name + ':' + d.cards.length);
  return out;
});
log('parse results:', JSON.stringify(parse));
ok(parse.pairs.n === 10 && parse.pairs.types.includes('mc'), 'term | definition lines make recall + multiple-choice cards');
ok(parse.qa.n === 2 && /sup A/.test(parse.qa.q0), 'Q:/A: pairs parse in question order');
ok(parse.free.made === 'cloze' && parse.free.n >= 2, `free text offline falls back to fill-in-the-blank (${parse.free.n} cards)`);
ok(parse.match.join() === 'true,true,true,true,false', `answer matching: accents, typos, numbers, articles (${parse.match.join()})`);
ok(/Imported/.test(parse.imp || ''), 'export → import round trip');

// ---- Film Room: ask, answer, continue ----
await page.evaluate(() => { __mb.title(); });
await page.waitForTimeout(300);
const asked = await page.evaluate(() => __mb.Study.ask());
ok(asked, 'a question opens from the title screen');
await page.waitForTimeout(200);
await page.screenshot({ path: 'test/shot-quiz.png' });
const kind = await page.evaluate(() => (document.querySelector('#quiz .choice') ? 'mc' : 'short'));
if (kind === 'mc') await page.click('#quiz .choice'); else { await page.fill('#qzIn', 'x'); await page.press('#qzIn', 'Enter'); }
await page.waitForTimeout(200);
const fb = await page.evaluate(() => ({ fb: !!document.querySelector('#quiz .qz-fb'), answered: __mb.Study.stats().answered, open: __mb.Study.open }));
ok(fb.fb && fb.answered >= 1 && fb.open, `answering shows feedback and records progress (${kind})`);
await page.click('#qzGo');
const closed = await page.evaluate(() => ({ hidden: document.getElementById('quiz').hidden, open: __mb.Study.open }));
ok(closed.hidden && !closed.open, 'continue closes the sheet');

// ---- game-break cadence: every play ----
await page.evaluate(() => { const s = __mb.Study.settings(); s.when = 'plays'; s.every = 1; __mb.start(-1); window.__mb.speed = 12; });
let broke = false; const t1 = Date.now();
while (Date.now() - t1 < 30000) { await page.waitForTimeout(400); if (await page.evaluate(() => __mb.Study.open)) { broke = true; break; } }
ok(broke, 'the coach stops the game between plays when cadence is "every play"');
const pausedPlays = await page.evaluate(() => __mb.G().stats[0].plays + __mb.G().stats[1].plays);
await page.waitForTimeout(1500);
const stillPlays = await page.evaluate(() => __mb.G().stats[0].plays + __mb.G().stats[1].plays);
ok(stillPlays === pausedPlays, 'the game waits while the question is open');
await page.screenshot({ path: 'test/shot-break.png' });
// answer it and make sure the game resumes
const kind2 = await page.evaluate(() => (document.querySelector('#quiz .choice') ? 'mc' : 'short'));
if (kind2 === 'mc') await page.click('#quiz .choice'); else { await page.fill('#qzIn', 'x'); await page.press('#qzIn', 'Enter'); }
await page.waitForTimeout(200); await page.click('#qzGo');
await page.waitForTimeout(2500);
const resumed = await page.evaluate(() => ({ open: __mb.Study.open, ph: __mb.ph(), momo: __mb.MOMO.lvl.slice(), boost: BOOST.ms.slice() }));
ok(!resumed.open && resumed.ph !== 'post', `game resumes after the answer (phase ${resumed.ph}, momentum ${resumed.momo}, boost ${resumed.boost})`);

// ---- phone layout ----
const phone = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await offline(phone); phone.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
await phone.goto(base, { waitUntil: 'load' }); await phone.waitForFunction(() => window.__mb && window.__mb.r3()); await phone.waitForTimeout(800);
await phone.screenshot({ path: 'test/shot-phone-title.png' });
await phone.evaluate(() => __mb.film()); await phone.waitForTimeout(300);
const wide = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
ok(!wide, 'no horizontal overflow on a 390px phone (Film Room screen)');
await phone.screenshot({ path: 'test/shot-phone-film.png', fullPage: false });
await phone.evaluate(() => { __mb.title(); __mb.Study.ask(); }); await phone.waitForTimeout(300);
await phone.screenshot({ path: 'test/shot-phone-quiz.png' });

const realErrors = errors.filter((e) => !/favicon|fonts.googleapis|net::ERR|GPU stall|SwiftShader|ANGLE|Automatic fallback|AudioContext/i.test(e));
ok(realErrors.length === 0, `no console errors (${realErrors.length})`);
for (const e of realErrors.slice(0, 10)) console.log('   ', e);
await browser.close(); server.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
