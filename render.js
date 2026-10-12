'use strict';
// render.js — the 3D stadium view (Three.js r128). Reads the play object from sim.js; never changes it.
//
// Slim by design:
//  • no shadow maps: every player and the ball gets a flat blob shadow (one instanced mesh, one draw call)
//  • all 22 players are drawn with one InstancedMesh per body part (16 draw calls instead of ~480)
//  • every static stadium piece of the same material is merged into one geometry (about 20 draw calls)
//  • the picture never drops below 1.5× device pixels; effects go before resolution
// The scene is lit by a sun (directional) and a sky (hemisphere) light only.

const R3 = { ok: false, W: 1, H: 1, pair: '' };
const W3 = (x) => x - MID, Z3 = (y) => 50 - y; // sim yards -> world (offense attacks -Z)
const FONT_D = "'Big Shoulders Display', Impact, 'Arial Narrow', sans-serif";
const SUN = [-0.72, 0.52, -0.46];
const r3col = (c) => new THREE.Color(c).convertSRGBToLinear(); // material colours are authored in sRGB

function r3init(canvas) {
  const T = window.THREE; if (!T) return false;
  let rn; try { rn = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { return false; }
  rn.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_STEPS[0])); rn.outputEncoding = T.sRGBEncoding;
  const scene = new T.Scene(); scene.fog = new T.Fog(r3col(0xf3cda6), 170, 560);
  Object.assign(R3, { T, rn, scene, camera: new T.PerspectiveCamera(55, 1, 1, 1500), ok: true, m4: new T.Matrix4(), col: new T.Color() });
  r3sky(); r3field(); r3stadium(); r3actors(); r3fx();
  if (document.fonts && document.fonts.load) document.fonts.load("900 40px 'Big Shoulders Display'").then(() => { R3.pair = ''; r3jumbo(R3.jtxt || ['MONSTROSITY BOWL', '']); }).catch(() => {});
  return true;
}
function r3canvasTex(w, h, paint, opts) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
  const t = new R3.T.CanvasTexture(c); t.encoding = R3.T.sRGBEncoding; Object.assign(t, opts || {}); return t;
}
// Merge indexed geometries (position/normal/uv) that were already moved into place: one draw call per material.
function r3merge(geos) {
  const T = R3.T; let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += n; io += gi.length; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3)); out.setAttribute('uv', new T.BufferAttribute(uv, 2)); out.setIndex(new T.BufferAttribute(idx, 1));
  return out;
}
// A box already placed in the world (position, optional euler rotation), ready for r3merge.
function r3box(w, h, d, x, y, z, rx, ry, rz) {
  const g = new R3.T.BoxGeometry(w, h, d); if (rx || ry || rz) g.rotateX(rx || 0), g.rotateY(ry || 0), g.rotateZ(rz || 0); g.translate(x, y, z); return g;
}

function r3sky() {
  const { T, scene } = R3;
  const sky = r3canvasTex(8, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#1f5fd0'); gr.addColorStop(0.3, '#4f9be6'); gr.addColorStop(0.44, '#a9d3ee'); gr.addColorStop(0.5, '#f3cda6'); gr.addColorStop(1, '#f3cda6'); g.fillStyle = gr; g.fillRect(0, 0, 8, 256); });
  scene.add(new T.Mesh(new T.SphereGeometry(1300, 24, 16), new T.MeshBasicMaterial({ map: sky, side: T.BackSide, fog: false, depthWrite: false })));
  const glow = r3canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.18, 'rgba(255,225,160,.75)'); gr.addColorStop(0.5, 'rgba(255,190,110,.18)'); gr.addColorStop(1, 'rgba(255,180,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const sp = new T.Sprite(new T.SpriteMaterial({ map: glow, blending: T.AdditiveBlending, fog: false, depthWrite: false })); sp.position.set(SUN[0] * 1100, SUN[1] * 1100 * 0.55, SUN[2] * 1100); sp.scale.set(620, 620, 1); scene.add(sp);
  scene.add(new T.HemisphereLight(r3col(0xcfe4ff), r3col(0x5a8a4c), 0.95));
  const sun = (R3.sun = new T.DirectionalLight(r3col(0xffe0b2), 1.5)); sun.position.set(SUN[0] * 230, SUN[1] * 230, SUN[2] * 230); scene.add(sun);
}

function r3field() {
  const { T, scene, rn } = R3;
  // Grass, numbers, end zones and logos live in a texture: 2048×4096 on high-DPI screens so the numbers stay sharp, else 1024×2048.
  const big = (window.devicePixelRatio || 1) >= 2 && rn.capabilities.maxTextureSize >= 4096;
  R3.fcv = document.createElement('canvas'); R3.fcv.width = big ? 2048 : 1024; R3.fcv.height = big ? 4096 : 2048;
  R3.ftex = new T.CanvasTexture(R3.fcv); R3.ftex.encoding = T.sRGBEncoding; R3.ftex.anisotropy = rn.capabilities.getMaxAnisotropy();
  const f = new T.Mesh(new T.PlaneGeometry(70, 136), new T.MeshLambertMaterial({ map: R3.ftex })); f.rotation.x = -Math.PI / 2; scene.add(f);
  // The painted lines are geometry, not texels: one merged mesh of thin quads that the multisampling keeps crisp at any distance.
  const Q = [], quad = (x0, y0, x1, y1) => { const g = new T.PlaneGeometry(x1 - x0, y1 - y0); g.rotateX(-Math.PI / 2); g.translate(W3((x0 + x1) / 2), 0, Z3((y0 + y1) / 2)); Q.push(g); };
  quad(-1.1, -11.1, 0, 111.1); quad(FW, -11.1, FW + 1.1, 111.1); quad(-1.1, 110, FW + 1.1, 111.1); quad(-1.1, -11.1, FW + 1.1, -10); // boundary
  quad(0, -0.16, FW, 0.16); quad(0, 99.84, FW, 100.16); // goal lines
  for (let y = 1; y < 100; y++) {
    if (y % 5 === 0) quad(0, y - 0.07, FW, y + 0.07);
    else for (const hx of [23.58, 29.08, 0.4, FW - 1.05]) quad(hx, y - 0.05, hx + 0.67, y + 0.05);
  }
  const lines = new T.Mesh(r3merge(Q), new T.MeshBasicMaterial({ color: 0xf4f8f2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  lines.position.y = 0.012; scene.add(lines);
  const line = (col, op) => { const m = new T.Mesh(new T.PlaneGeometry(FW, 0.45), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.visible = false; scene.add(m); return m; };
  R3.los = line(0x2f7bff, 0.8); R3.fd = line(0xffc42e, 0.95);
}
// Paint grass, numbers, end zones and logo into the field texture. off = team attacking up-screen.
function r3paint(off, def) {
  const Wt = R3.fcv.width, Ht = R3.fcv.height, g = R3.fcv.getContext('2d'), sx = Wt / 70, sy = Ht / 136, X = (x) => (x + 8.335) * sx, Y = (y) => (118 - y) * sy;
  const rect = (x0, y0, x1, y1) => g.fillRect(X(x0), Y(y1), (x1 - x0) * sx, (y1 - y0) * sy);
  g.fillStyle = '#27603a'; g.fillRect(0, 0, Wt, Ht);
  for (let y = 0; y < 100; y += 5) { g.fillStyle = (y / 5) & 1 ? '#3f9f47' : '#368f3f'; rect(0, y, FW, y + 5); }
  g.fillStyle = def.col.ez; rect(0, 100, FW, 110); g.fillStyle = off.col.ez; rect(0, -10, FW, 0);
  let s = 7; const rr = () => ((s = (s * 16807) % 2147483647) / 2147483647), k = Wt / 1024;
  for (let i = 0; i < 6000 * k * k; i++) { g.fillStyle = rr() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,40,10,.05)'; g.fillRect(rr() * Wt, rr() * Ht, 1.5 * k, (5 + rr() * 6) * k); }
  const sh = g.createRadialGradient(Wt / 2, Ht / 2, 100 * k, Wt / 2, Ht / 2, 1150 * k); sh.addColorStop(0, 'rgba(255,255,220,.10)'); sh.addColorStop(1, 'rgba(0,30,20,.22)'); g.fillStyle = sh; g.fillRect(0, 0, Wt, Ht);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let y = 10; y <= 90; y += 10) for (const side of [-1, 1]) { // numbers read from the near sideline
    const n = String(y <= 50 ? y : 100 - y); g.save(); g.translate(X(side < 0 ? 11 : FW - 11), Y(y)); g.rotate((side * -Math.PI) / 2);
    g.font = `800 ${3.1 * sx}px ${FONT_D}`; g.fillStyle = 'rgba(255,255,255,.9)'; g.fillText(n[0], -1.25 * sy, 0); g.fillText(n[1], 1.25 * sy, 0); g.restore();
  }
  for (const [t, y] of [[def, 105], [off, -5]]) { // end-zone wordmarks, stretched to fill
    g.save(); g.translate(X(MID), Y(y) + 4); g.font = `900 ${7 * sy}px ${FONT_D}`; const w = g.measureText(t.name).width; g.scale(Math.min(1.6, (44 * sx) / w), 1);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillText(t.name, 3, 5); g.fillStyle = t.col.ezt; g.fillText(t.name, 0, 0); g.restore();
  }
  g.save(); g.translate(X(MID), Y(50)); g.fillStyle = 'rgba(10,20,50,.88)'; g.beginPath(); g.ellipse(0, 0, 6.2 * sx, 6.2 * sy, 0, 0, 7); g.fill();
  g.strokeStyle = '#ffc42e'; g.lineWidth = 6; g.beginPath(); g.ellipse(0, 0, 5.4 * sx, 5.4 * sy, 0, 0, 7); g.stroke();
  g.fillStyle = '#ffc42e'; g.font = `italic 900 ${6.4 * sy}px ${FONT_D}`; g.fillText('MB', 0, 6); g.restore();
  for (const [t, x0] of [[off, -6.6], [def, FW + 2.4]]) { g.fillStyle = t.col.ez; rect(x0, 30, x0 + 4.2, 70); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3; g.strokeRect(X(x0), Y(70), 4.2 * sx, 40 * sy); }
  R3.ftex.needsUpdate = true;
  if (R3.bench) [off, def].forEach((t, sd) => { // the benches wear the colours of the team on that sideline
    const B = R3.bench, c = R3.col;
    for (let i = 0; i < 12; i++) { B.body.setColorAt(sd * 12 + i, c.set(r3col(t.col.jersey))); B.head.setColorAt(sd * 12 + i, c.set(r3col(t.col.helmet))); }
    B.body.instanceColor.needsUpdate = B.head.instanceColor.needsUpdate = true;
  });
}

function r3stadium() {
  const { T, scene } = R3, L = (c) => new T.MeshLambertMaterial({ color: r3col(c) });
  const parts = { navy: [], gold: [], dark: [], conc: [], lamp: [], city: [], post: [], py: [] };
  const box = (k, w, h, d, x, y, z, rx, ry, rz) => parts[k].push(r3box(w, h, d, x, y, z, rx, ry, rz));
  const ground = new T.Mesh(new T.PlaneGeometry(4000, 4000), L(0x7d9a78)); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; scene.add(ground);
  for (const s of [-1, 1]) { // field wall with a gold cap
    box('navy', 1, 2.6, 139, s * 35.6, 1.3, 0); box('gold', 1.1, 0.3, 139, s * 35.6, 2.75, 0);
    box('navy', 72.2, 2.6, 1, 0, 1.3, s * 68.6); box('gold', 72.2, 0.3, 1.1, 0, 2.75, s * 68.6);
  }
  // fans: one shared texture of jittered coloured dots, repeated per tier
  R3.crowd = r3canvasTex(256, 128, (g) => {
    g.fillStyle = '#1c2340'; g.fillRect(0, 0, 256, 128); let s = 11; const rr = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pal = ['#ff8a1f', '#1d2f6f', '#d62839', '#f4f4f4', '#ffc42e', '#6fb4ea', '#8a93ad', '#f4f4f4', '#ff8a1f', '#d62839'];
    for (let y = 4; y < 128; y += 9) for (let x = 2; x < 256; x += 7) { if (rr() < 0.08) continue; const jx = x + rr() * 2; g.fillStyle = pal[(rr() * pal.length) | 0]; g.fillRect(jx, y + 3, 5, 5); g.fillStyle = 'rgba(240,215,190,.9)'; g.fillRect(jx + 1, y, 3, 3); }
  }, { wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping });
  R3.crowd.repeat.set(1, 1); const crowdM = new T.MeshLambertMaterial({ map: R3.crowd }), tiers = [];
  const tier = (w, h, d, x, y, z, rx, rz, ru, rv) => { // a raked slab of fans with its own uv repeat baked in
    const g = r3box(w, h, d, x, y, z, rx, 0, rz), uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i += 2) { uv[i] *= ru; uv[i + 1] *= rv; } tiers.push(g);
  };
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) { // three raked tiers on every side
    const off = 42.5 + k * 11, y = 5.4 + k * 7.6;
    tier(12.6, 1, 162 + k * 22, s * off, y, 0, 0, s * 0.6, 1.6, 14 + k * 2); box('navy', 11, y, 162 + k * 22, s * (off + 1.2), y / 2 - 1.6, 0);
    tier(96 + k * 22, 1, 12.6, 0, y, s * (off + 33), -s * 0.6, 0, 9 + k * 2, 1.6); box('navy', 96 + k * 22, y, 11, 0, y / 2 - 1.6, s * (off + 34.2));
  }
  scene.add(new T.Mesh(r3merge(tiers), crowdM));
  for (const s of [-1, 1]) { box('dark', 4, 2.2, 214, s * 71.5, 26.5, 0); box('gold', 4.2, 0.5, 214, s * 71.5, 27.9, 0); box('dark', 146, 2.2, 4, 0, 26.5, s * 105); box('gold', 146, 0.5, 4.2, 0, 27.9, s * 105); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { // light towers, lamp heads turned toward midfield
    box('conc', 2.2, 74, 2.2, sx * 78, 37, sz * 112); const ry = Math.atan2(sx * 76, sz * 110);
    box('dark', 20, 9, 1.2, sx * 76, 76, sz * 110, -0.45, ry, 0); box('lamp', 18, 7, 0.4, sx * 75.4, 76, sz * 109.4, -0.45, ry, 0);
  }
  // jumbotron behind the far end zone
  R3.jcv = document.createElement('canvas'); R3.jcv.width = 512; R3.jcv.height = 224; R3.jtex = new T.CanvasTexture(R3.jcv); R3.jtex.encoding = T.sRGBEncoding;
  box('dark', 50, 23, 2.4, 0, 46, -116); box('gold', 52, 1, 3, 0, 58, -116); box('conc', 3, 36, 2, -16, 18, -117); box('conc', 3, 36, 2, 16, 18, -117);
  const scr = new T.Mesh(new T.PlaneGeometry(47, 20.5), new T.MeshBasicMaterial({ map: R3.jtex, fog: false })); scr.position.set(0, 46, -114.7); scene.add(scr);
  let s = 5; const rr = () => ((s = (s * 16807) % 2147483647) / 2147483647); // hazy skyline
  for (let i = 0; i < 46; i++) { const a = rr() * 6.283, r = 330 + rr() * 150, h = 30 + rr() * 110 * (rr() < 0.25 ? 1.6 : 1); box('city', 16 + rr() * 22, h, 16 + rr() * 22, Math.cos(a) * r, h / 2, Math.sin(a) * r); }
  const cyl = (r, h, x, y, z, rz) => { const c = new T.CylinderGeometry(r, r, h, 8); if (rz) c.rotateZ(Math.PI / 2); c.translate(x, y, z); parts.post.push(c); }; // goalposts
  for (const z of [-60, 60]) { cyl(0.22, 3.4, 0, 1.7, z + Math.sign(z) * 1.2); cyl(0.2, 6.17, 0, 3.4, z, 1); cyl(0.16, 10, -3.08, 8.4, z); cyl(0.16, 10, 3.08, 8.4, z); }
  for (const z of [-50, 50, -60, 60]) for (const x of [-MID, MID]) box('py', 0.35, 0.9, 0.35, x, 0.45, z); // pylons
  const MAT = { navy: L(0x121b3a), gold: L(0xffc42e), dark: L(0x0b1126), conc: L(0x9aa6c0), lamp: new T.MeshBasicMaterial({ color: 0xfff4c9, fog: false }), city: L(0x8fa3c4), post: L(0xffd23f), py: L(0xff7a1a) };
  for (const k in parts) if (parts[k].length) scene.add(new T.Mesh(r3merge(parts[k]), MAT[k]));
  // benches: a dozen players standing on each sideline, two instanced meshes recoloured when the teams change ends
  const body = new T.InstancedMesh(new T.BoxGeometry(1, 2.3, 0.6), new T.MeshLambertMaterial({ color: 0xffffff }), 24), head = new T.InstancedMesh(new T.SphereGeometry(0.5, 10, 8), new T.MeshLambertMaterial({ color: 0xffffff }), 24);
  const m4 = R3.m4;
  for (const sd of [0, 1]) for (let i = 0; i < 12; i++) {
    const x = (sd ? 1 : -1) * (MID + 4.6 + (i % 2) * 1.5), z = -15 + i * 2.7, n = sd * 12 + i;
    body.setMatrixAt(n, m4.makeTranslation(x, 1.15, z)); head.setMatrixAt(n, m4.makeTranslation(x, 2.75, z)); body.setColorAt(n, R3.col.set(0x14161c)); head.setColorAt(n, R3.col.set(0x14161c));
  }
  scene.add(body, head); R3.bench = { body, head };
  // down markers on the near sideline
  const stickM = L(0xff7a1a), mkStick = () => { const g = new T.Mesh(r3merge([r3box(0.24, 5, 0.24, 0, 2.5, 0), r3box(1.1, 1.1, 0.12, 0, 5.2, 0)]), stickM); g.position.x = -MID - 1.6; g.visible = false; scene.add(g); return g; };
  R3.stick = [mkStick(), mkStick()];
  r3jumbo(['MONSTROSITY BOWL', '']);
}
// Jumbotron: [headline, subline]
function r3jumbo(t) {
  R3.jtxt = t; const g = R3.jcv.getContext('2d'); g.fillStyle = '#0a1124'; g.fillRect(0, 0, 512, 224);
  const gr = g.createLinearGradient(0, 0, 512, 0); gr.addColorStop(0, '#ff8a1f'); gr.addColorStop(0.5, '#ffc42e'); gr.addColorStop(1, '#ff4d5e'); g.fillStyle = gr; g.fillRect(0, 0, 512, 14); g.fillRect(0, 210, 512, 14);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.font = `italic 900 ${t[1] ? 92 : 78}px ${FONT_D}`; let w = g.measureText(t[0]).width; g.save(); g.translate(256, t[1] ? 92 : 112); g.scale(Math.min(1, 470 / w), 1); g.fillText(t[0], 0, 0); g.restore();
  if (t[1]) { g.fillStyle = '#ffc42e'; g.font = `800 44px ${FONT_D}`; w = g.measureText(t[1]).width; g.save(); g.translate(256, 172); g.scale(Math.min(1, 470 / w), 1); g.fillText(t[1], 0, 0); g.restore(); }
  R3.jtex.needsUpdate = true;
}

// ===== players, ball, markers =====
// Each player is a tiny Object3D rig (never drawn). Every frame the rig is posed, then each body part's world matrix is
// copied into that part's InstancedMesh. Colours come from the team: one setColorAt per part when a figure changes team.
const PART = [ // [name, geometry key, colour key]
  ['hip', 'hip', 'pants'], ['torso', 'torso', 'jersey'], ['pads', 'pads', 'jersey'], ['helm', 'helm', 'helmet'], ['mask', 'mask', 'dark'],
  ['stripe', 'stripe', 'stripe'], ['trim', 'trim', 'fore'], ['band', 'band', 'fore'],
  ['legL', 'leg', 'pants'], ['shoeL', 'shoe', 'dark'], ['legR', 'leg', 'pants'], ['shoeR', 'shoe', 'dark'],
  ['armL', 'arm', 'jersey'], ['foreL', 'fore', 'fore'], ['armR', 'arm', 'jersey'], ['foreR', 'fore', 'fore']];
function r3actors() {
  const { T, scene } = R3, B = (w, h, d, ty, tz) => { const g = new T.BoxGeometry(w, h, d); g.translate(0, ty || 0, tz || 0); return g; };
  const geo = { leg: B(0.32, 0.98, 0.34, -0.49), shoe: B(0.31, 0.15, 0.5, -1.02, -0.08), hip: B(0.76, 0.26, 0.44),
    torso: B(0.8, 0.68, 0.48), pads: B(1.18, 0.36, 0.6), arm: B(0.25, 0.46, 0.27, -0.2), fore: B(0.21, 0.4, 0.23, -0.61),
    helm: new T.SphereGeometry(0.41, 14, 10), mask: B(0.36, 0.2, 0.16), stripe: B(0.1, 0.06, 0.76), trim: B(1.2, 0.1, 0.2), band: B(0.82, 0.12, 0.5) };
  R3.cols = TEAMS.map((t) => ({ jersey: r3col(t.col.jersey), pants: r3col(t.col.pants), fore: r3col(t.col.helmet), helmet: r3col(t.col.helmet), stripe: r3col(t.col.stripe || '#ffffff'), dark: r3col(0x14161c) }));
  R3.inst = PART.map(([name, gk, ck]) => {
    const mat = gk === 'helm' ? new T.MeshPhongMaterial({ color: 0xffffff, shininess: 80, specular: 0x444444 }) : new T.MeshLambertMaterial({ color: 0xffffff });
    const m = new T.InstancedMesh(geo[gk], mat, 22); m.frustumCulled = false;
    for (let i = 0; i < 22; i++) m.setColorAt(i, R3.cols[0].dark); // allocate the colour buffer while count is still 22
    m.count = 0; scene.add(m); return { m, ck };
  });
  const mk = () => { // the rig: groups only
    const g = new T.Object3D(), body = new T.Object3D(); g.rotation.order = 'YXZ'; g.scale.setScalar(1.36); g.add(body);
    const node = (x, y, z, parent) => { const o = new T.Object3D(); o.position.set(x, y, z); (parent || body).add(o); return o; };
    const legL = node(-0.21, 1.1, 0), legR = node(0.21, 1.1, 0), armL = node(-0.7, 1.98, 0), armR = node(0.7, 1.98, 0);
    const P = { hip: node(0, 1.1, 0), torso: node(0, 1.5, 0), pads: node(0, 1.92, 0), helm: node(0, 2.42, 0), mask: node(0, 2.33, -0.37), stripe: node(0, 2.8, 0), trim: node(0, 2.08, 0), band: node(0, 1.2, 0),
      legL, shoeL: legL, legR, shoeR: legR, armL, foreL: armL, armR, foreR: armR };
    return { g, body, legL, legR, armL, armR, P, yaw: 0, pitch: 0, team: -1 };
  };
  R3.figs = []; for (let i = 0; i < 22; i++) R3.figs.push(mk());
  // blob shadows: players (22) + ball (1)
  const sh = new T.InstancedMesh(new T.CircleGeometry(1, 18), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }), 23); sh.frustumCulled = false; sh.count = 0; scene.add(sh); R3.shadow = sh;
  const bg = new T.SphereGeometry(0.27, 12, 8); bg.scale(1, 1, 1.7);
  R3.ball = new T.Mesh(bg, new T.MeshLambertMaterial({ color: r3col(0x8a4b1f) })); R3.ball.visible = false;
  const lace = new T.Mesh(new T.BoxGeometry(0.07, 0.05, 0.36), new T.MeshBasicMaterial({ color: 0xffffff })); lace.position.y = 0.26; R3.ball.add(lace); scene.add(R3.ball);
  const flat = (g, col) => { const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthWrite: false, side: T.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.visible = false; scene.add(m); return m; };
  R3.ring = flat(new T.RingGeometry(0.95, 1.25, 32), 0xffc42e); R3.land = flat(new T.RingGeometry(0.85, 1.2, 32), 0xffffff);
  R3.cone = new T.Mesh(new T.ConeGeometry(0.42, 0.7, 4), new T.MeshBasicMaterial({ color: 0xffc42e })); R3.cone.rotation.x = Math.PI; R3.cone.visible = false; scene.add(R3.cone);
  R3.flagM = new T.Mesh(new T.BoxGeometry(0.8, 0.14, 0.8), new T.MeshBasicMaterial({ color: 0xffd400 })); R3.flagM.visible = false; R3.flagT = 0; scene.add(R3.flagM);
  R3.v = new T.Vector3(); R3.ray = new T.Raycaster(); R3.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
}

function r3players(view, dt) {
  const pl = view.pl, F = R3.figs, I = R3.inst, m4 = R3.m4, sh = R3.shadow;
  if (!pl) { for (const it of I) it.m.count = 0; sh.count = 0; return; }
  const P = pl.P, c = pl.live ? carrier(pl) : null, b = pl.ball, res = pl.dead ? pl.res : null, k = Math.min(1, dt * 12);
  let n = 0, recolor = false;
  for (let i = 0; i < F.length; i++) {
    const f = F[i], p = P[i]; if (!p) break;
    const team = (p.side === 0 ? pl.off : pl.def).id;
    if (f.team !== team) { f.team = team; recolor = true; const C = R3.cols[team]; I.forEach((it) => it.m.setColorAt(i, C[it.ck])); }
    f.g.position.set(W3(p.x), 0, Z3(p.y));
    const sp = pl.live ? Math.hypot(p.vx, p.vy) : 0, amp = clamp(sp / 5.5, 0, 1);
    let ty = p.side === 0 ? 0 : Math.PI;
    if (pl.live && p.eng >= 0) { const o = P[p.eng]; ty = Math.atan2(-(o.x - p.x), o.y - p.y); } else if (sp > 0.7) ty = Math.atan2(-p.vx, p.vy);
    let d = ty - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); f.yaw += d * k;
    f.g.rotation.y = f.yaw + (p.juke > 0 ? (1 - p.juke / 0.3) * 6.283 : 0);
    const cele = res && res.type === 'td' && res.c && res.c.side === p.side, hero = cele && res.c === p;
    const down = (pl.live && p.stun > 0.15) || (res && (res.type === 'tackle' || res.type === 'sack') && (res.c === p || res.by === p));
    const stance = !pl.live && !pl.dead && pl.kind === 'scrim' && !pl.frozen && Math.abs(p.y - pl.los) < 1.5;
    const tp = down ? -1.5 : p.dive > 0 ? -1.2 : stance ? -0.42 : -0.26 * amp;
    f.pitch += (tp - f.pitch) * Math.min(1, dt * (down || p.dive > 0 ? 16 : 9)); f.body.rotation.x = f.pitch;
    let lift = Math.abs(Math.sin(p.an * 1.9)) * 0.07 * amp;
    if (p.jump > 0) lift += Math.sin(Math.PI * (1 - p.jump / 0.45)) * 1.0;
    if (hero) lift += Math.abs(Math.sin(view.t * 9)) * 0.55;
    f.body.position.y = down ? 0.28 : lift;
    const sw = Math.sin(p.an * 1.9) * amp * 0.95; let aL = -sw * 0.8, aR = sw * 0.8;
    f.legL.rotation.x = down ? 0 : sw; f.legR.rotation.x = down ? 0 : -sw;
    if (cele || p.jump > 0) aL = aR = -2.85;
    else if (down) aL = aR = -2.6;
    else if (pl.live && p.eng >= 0) aL = aR = -1.4;
    else if (c === p) { aR = -1.15; if (pl.rel && p.key === 'QB') aR = -2.75; }
    else if (pl.live && b.st === 'air' && !b.kick && b.rec === p.i && b.T - b.ft < 0.4) aL = aR = -2.5;
    else if (pl.live && p.key === 'QB' && pl.air && pl.t - pl.air.t0 < 0.3) aR = -0.7;
    else if (stance) aL = aR = 0.5;
    f.armL.rotation.x += (aL - f.armL.rotation.x) * Math.min(1, dt * 18); f.armR.rotation.x += (aR - f.armR.rotation.x) * Math.min(1, dt * 18);
    f.g.updateMatrixWorld(true);
    for (let q = 0; q < PART.length; q++) I[q].m.setMatrixAt(i, f.P[PART[q][0]].matrixWorld);
    const r = down ? 1.6 : 0.95 - Math.min(0.5, lift * 0.3); // blob shadow: a stretched disc that shrinks as he leaves the ground
    sh.setMatrixAt(i, m4.makeRotationX(-Math.PI / 2).setPosition(f.g.position.x, 0.02, f.g.position.z).scale(R3.v.set(r, r * (down ? 0.7 : 1.15), 1)));
    n++;
  }
  for (const it of I) { it.m.count = n; it.m.instanceMatrix.needsUpdate = true; if (recolor) it.m.instanceColor.needsUpdate = true; }
  sh.count = n; sh.instanceMatrix.needsUpdate = true;
}

function r3ball(view) {
  const pl = view.pl, ball = R3.ball, kb = view.kb, sh = R3.shadow; let x, y, h, fly = false;
  if (kb) { x = kb.x; y = kb.y; h = kb.z + 0.3; fly = true; }
  else if (!pl) { ball.visible = false; return; }
  else {
    const b = pl.ball, c = pl.live ? carrier(pl) : pl.dead && pl.res && pl.res.c ? pl.res.c : null;
    if (b.st === 'air') { x = b.x; y = b.y; h = b.z + 0.3; fly = true; }
    else if (c && (pl.live || pl.dead)) { const f = R3.figs[c.i], a = f.yaw; x = c.x + Math.cos(a) * 0.55 - Math.sin(a) * 0.3; y = c.y + Math.sin(a) * 0.55 + Math.cos(a) * 0.3; h = pl.dead ? 0.5 : 2.1; }
    else if (pl.kind === 'scrim') { x = pl.bx; y = pl.dead ? b.y : pl.los; if (pl.dead) x = b.x; h = 0.32; }
    else { ball.visible = false; return; }
  }
  const nx = W3(x), nz = Z3(y); ball.visible = true;
  if (fly) { // nose along the flight path, spiralling, with a short white trail; its shadow shrinks with height
    const dx = nx - ball.position.x, dy = h - ball.position.y, dz = nz - ball.position.z, m = dx * dx + dy * dy + dz * dz;
    ball.position.set(nx, h, nz);
    if (m > 1e-5 && m < 400) { ball.lookAt(nx + dx, h + dy, nz + dz); ball.rotateZ(view.t * 24); }
    if (!view.paused) r3emit(nx, h, nz, 0, 0, 0, 0.3, 0.6, 1, 1, 1, 0, 0.55);
    const r = Math.max(0.15, 0.45 - h * 0.012), i = sh.count; sh.setMatrixAt(i, R3.m4.makeRotationX(-Math.PI / 2).setPosition(nx, 0.025, nz).scale(R3.v.set(r, r, 1))); sh.count = i + 1; sh.instanceMatrix.needsUpdate = true;
  } else { ball.position.set(nx, h, nz); ball.rotation.set(0, 0, 0); }
}

function r3markers(view) {
  const pl = view.pl, t = view.t;
  R3.los.visible = view.los != null; if (view.los != null) R3.los.position.z = Z3(view.los);
  R3.fd.visible = view.fd != null && view.fd < 100; if (R3.fd.visible) R3.fd.position.z = Z3(view.fd);
  R3.stick[0].visible = R3.los.visible; R3.stick[0].position.z = R3.los.position.z; R3.stick[1].visible = R3.fd.visible; R3.stick[1].position.z = R3.fd.position.z;
  const u = view.userOn && pl && pl.user >= 0 ? pl.P[pl.user] : null;
  R3.ring.visible = R3.cone.visible = !!u;
  if (u) { const s = 1 + Math.sin(t * 7) * 0.08; R3.ring.position.set(W3(u.x), 0.07, Z3(u.y)); R3.ring.scale.set(s, s, 1); R3.cone.position.set(W3(u.x), 5 + Math.sin(t * 6) * 0.18, Z3(u.y)); R3.cone.rotation.y = t * 3; }
  if (!view.flag) R3.flagM.visible = false; else if (R3.flagM.visible) { const u = clamp(1 - R3.flagT / 0.55, 0, 1); R3.flagM.position.y = 0.1 + Math.sin(Math.PI * u) * 3.4; R3.flagM.rotation.set(u < 1 ? t * 14 : 0, u < 1 ? t * 9 : 0.6, 0); }
  const b = pl && pl.live ? pl.ball : null, air = b && b.st === 'air' && !b.kick && !b.away;
  R3.land.visible = !!air; if (air) { const s = 1.5 - 0.7 * clamp(b.ft / b.T, 0, 1) + Math.sin(t * 14) * 0.05; R3.land.position.set(W3(b.tx), 0.08, Z3(b.ty)); R3.land.scale.set(s, s, 1); }
}
// world -> stage pixels (call after render)
function r3project(x, y, h) { const v = R3.v.set(W3(x), h, Z3(y)).project(R3.camera); return [(v.x * 0.5 + 0.5) * R3.W, (-v.y * 0.5 + 0.5) * R3.H, v.z < 1]; }
// stage pixels -> sim yards on the turf
function r3pick(px, py) {
  R3.ray.setFromCamera({ x: (px / R3.W) * 2 - 1, y: -(py / R3.H) * 2 + 1 }, R3.camera);
  const hit = R3.ray.ray.intersectPlane(R3.plane, R3.v); return hit ? { x: hit.x + MID, y: 50 - hit.z } : null;
}

// ===== camera rig, particles, frame =====
const C3 = { x: 0, y: 0, z: 0, d: 150, pitch: 0.4, yaw: 0, fov: 55, shake: 0, g: null };
function r3camera(view, dt) {
  const cam = R3.camera, asp = R3.W / R3.H, port = asp < 0.95, pl = view.pl;
  let g = { x: 0, y: 0, z: 0, d: 0, pitch: port ? 0.66 : 0.5, yaw: 0, fov: port ? 62 : 44, rate: 4 }, w = 46, k = port ? 21 : 10, hold = false;
  if (view.title) Object.assign(g, { yaw: view.t * 0.07 + 0.6, d: port ? 96 : 74, pitch: 0.42, y: 2, fov: port ? 60 : 46, rate: 2 }), (k = 0), (w = 0); // slow orbit inside the bowl
  else if (view.kick) { const zb = Z3(view.kick.y0), zg = Z3(110); Object.assign(g, { x: W3(view.kick.x) * 0.5, y: port ? 10 : 6, z: (zb + zg) / 2, d: Math.abs(zb - zg) / 2 + (port ? 34 : 20), pitch: 0.2, rate: 3 }); k = 0; w = 0; }
  else if (pl) {
    const b = pl.ball, c = pl.live ? carrier(pl) : null;
    if (view.hero >= 0) { const p = pl.P[view.hero]; Object.assign(g, { x: W3(p.x), y: 1.8, z: Z3(p.y), d: port ? 22 : 16, pitch: 0.2, yaw: C3.yaw + dt * 0.5, fov: 50, rate: 3 }); k = 0; w = 0; }
    else if (pl.dead) hold = true;
    else if (pl.kind === 'ko' && (b.st === 'air' || !pl.live)) { g.x = W3(b.x) * 0.5; g.z = Z3(pl.live ? b.y : 62); w = 46; k = 4; }
    else if (b.st === 'air') { const u = clamp(b.ft / b.T, 0, 1) ** 0.7; g.x = W3(b.sx + (b.tx - b.sx) * u); g.z = Z3(b.sy + (b.ty - b.sy) * u); w = 36; k = port ? 14 : 7; g.rate = 6; }
    else if (c && (pl.run || c.side === 1)) { // ball carrier: push in and lead him, broadcast style
      const dir = c.side === 0 ? 1 : -1; g.x = W3(c.x + clamp(c.vx, -4, 4) * 0.6); g.z = Z3(c.y + dir * 2); w = port ? 25 : 34; k = dir > 0 ? (port ? 13 : 7) : -3;
      g.pitch = port ? 0.64 : 0.42; g.yaw = clamp(c.vx * 0.012, -0.1, 0.1); g.rate = 6.5; if (view.turbo) g.fov += 7;
    } else { g.x = W3(pl.bx); g.z = Z3(pl.los); w = 39; if (view.sheet) k = port ? -9 : 0; } // play-call sheet is up: lift the formation into the open part of the screen
  } else if (view.G) { g.x = W3(view.G.bx); g.z = Z3(view.G.ydl); w = 50; g.pitch = port ? 0.82 : 0.6; k = 8; }
  if (hold && C3.g) g = C3.g;
  else {
    if (w) { g.x = clamp(g.x, -12, 12); g.d = w / (2 * Math.tan((g.fov * Math.PI) / 360) * asp) + k * Math.cos(g.pitch); g.z -= k; }
    C3.g = g;
  }
  const far = Math.hypot(g.x - C3.x, g.z - C3.z) > 34 || view.cut, a = far ? 1 : 1 - Math.exp(-g.rate * dt);
  for (const key of ['x', 'y', 'z', 'd', 'pitch', 'fov']) C3[key] += (g[key] - C3[key]) * a;
  let dy = g.yaw - C3.yaw; if (!view.title && view.hero < 0) dy = Math.atan2(Math.sin(dy), Math.cos(dy)); C3.yaw += dy * (far ? 1 : 1 - Math.exp(-3 * dt));
  C3.shake *= Math.exp(-7 * dt);
  const cp = Math.cos(C3.pitch), s = C3.shake;
  cam.position.set(C3.x + C3.d * Math.sin(C3.yaw) * cp + (Math.random() - 0.5) * s, Math.max(2.5, C3.y + C3.d * Math.sin(C3.pitch) + (Math.random() - 0.5) * s), C3.z + C3.d * Math.cos(C3.yaw) * cp);
  cam.lookAt(C3.x, C3.y, C3.z);
  if (Math.abs(cam.fov - C3.fov) > 0.05 || cam.aspect !== asp) { cam.fov = C3.fov; cam.aspect = asp; cam.updateProjectionMatrix(); }
}

function r3fx() {
  const { T, scene } = R3, N = 700, geo = new T.BufferGeometry(), f = (R3.fx = { N, n: 0, pos: new Float32Array(N * 3), col: new Float32Array(N * 4), size: new Float32Array(N), vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), grav: new Float32Array(N), a0: new Float32Array(N), flash: 0, rings: [], live: 0 });
  geo.setAttribute('position', new T.BufferAttribute(f.pos, 3)); geo.setAttribute('col', new T.BufferAttribute(f.col, 4)); geo.setAttribute('size', new T.BufferAttribute(f.size, 1));
  f.mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { sc: { value: 600 } },
    vertexShader: 'attribute vec4 col; attribute float size; varying vec4 vc; uniform float sc; void main(){ vc = col; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(size * sc / -mv.z, 46.0); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec4 vc; void main(){ vec2 p = gl_PointCoord - 0.5; float d = dot(p, p); if (d > 0.25) discard; gl_FragColor = vec4(vc.rgb, vc.a * smoothstep(0.25, 0.1, d)); }' });
  f.geo = geo; const pts = new T.Points(geo, f.mat); pts.frustumCulled = false; scene.add(pts); f.pts = pts;
  for (let i = 0; i < 8; i++) { const m = new T.Mesh(new T.RingGeometry(0.86, 1, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: T.DoubleSide })); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); f.rings.push({ m, t: 0, dur: 1, r0: 1, r1: 2 }); }
}
function r3emit(x, y, z, vx, vy, vz, life, size, r, g, b, grav, alpha) {
  const f = R3.fx, i = f.n++ % f.N; f.pos[i * 3] = x; f.pos[i * 3 + 1] = y; f.pos[i * 3 + 2] = z; f.vel[i * 3] = vx; f.vel[i * 3 + 1] = vy; f.vel[i * 3 + 2] = vz;
  f.life[i] = f.max[i] = life; f.size[i] = size; f.col[i * 4] = r; f.col[i * 4 + 1] = g; f.col[i * 4 + 2] = b; f.a0[i] = alpha == null ? 1 : alpha; f.grav[i] = grav; f.live++;
}
function r3ring(x, y, col, r0, r1, dur) { const f = R3.fx, r = f.rings.find((q) => q.t <= 0) || f.rings[0]; r.m.material.color.set(col); r.m.position.set(W3(x), 0.09, Z3(y)); Object.assign(r, { t: dur, dur, r0, r1 }); r.m.visible = true; }
const hex3 = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
// Named effects at a spot on the field (sim yards).
function r3burst(kind, x, y, team) {
  if (!R3.ok) return; const wx = W3(x), wz = Z3(y), R = Math.random;
  const spray = (n, sp, up, life, size, cols, grav, h) => { for (let i = 0; i < n; i++) { const a = R() * 6.283, v = sp * (0.4 + R() * 0.6), c = cols[(R() * cols.length) | 0]; r3emit(wx, h || 0.3, wz, Math.cos(a) * v, up * (0.4 + R() * 0.6), Math.sin(a) * v, life * (0.6 + R() * 0.4), size * (0.6 + R() * 0.5), c[0], c[1], c[2], grav); } };
  if (kind === 'hit') { spray(18, 5, 5, 0.7, 0.75, [[0.36, 0.66, 0.3], [0.78, 0.7, 0.5], [0.95, 0.95, 0.9]], 14); r3ring(x, y, 0xffffff, 0.8, 4.2, 0.4); C3.shake = Math.max(C3.shake, 1.3); }
  else if (kind === 'big') { spray(30, 7, 7, 0.9, 0.9, [[0.36, 0.66, 0.3], [1, 0.9, 0.6], [1, 1, 1]], 14); r3ring(x, y, 0xffc42e, 1, 6.5, 0.55); C3.shake = Math.max(C3.shake, 2.6); }
  else if (kind === 'catch') { spray(12, 4, 3, 0.45, 0.5, [[1, 0.77, 0.18], [1, 1, 1]], 6, 1.8); r3ring(x, y, 0xffc42e, 0.6, 3, 0.35); }
  else if (kind === 'juke') spray(8, 3.5, 2.5, 0.45, 0.6, [[0.36, 0.66, 0.3], [0.3, 0.55, 0.26]], 12);
  else if (kind === 'int') { spray(20, 6, 5, 0.7, 0.6, [[1, 0.35, 0.35], [1, 1, 1]], 8, 1.8); r3ring(x, y, 0xff5a5a, 0.8, 6, 0.6); C3.shake = Math.max(C3.shake, 1.6); }
  else if (kind === 'td') { // confetti in the scoring team's colors, flashbulbs in the stands
    const t = TEAMS[team].col, cols = [hex3(t.helmet), hex3(t.jersey), [1, 0.77, 0.18], [1, 1, 1]];
    for (let i = 0; i < 260; i++) { const c = cols[(R() * 4) | 0]; r3emit(wx + (R() - 0.5) * 34, 8 + R() * 16, wz + (R() - 0.5) * 30, (R() - 0.5) * 3, -1 - R() * 2, (R() - 0.5) * 3, 2.6 + R() * 2.4, 0.5 + R() * 0.5, c[0], c[1], c[2], 2.2); }
    r3ring(x, y, 0xffc42e, 1, 9, 0.9); R3.fx.flash = 3.2; C3.shake = Math.max(C3.shake, 1.2);
  } else if (kind === 'flash') R3.fx.flash = Math.max(R3.fx.flash, 1.4);
  else if (kind === 'flag') { spray(10, 3, 4, 0.6, 0.45, [[1, 0.83, 0]], 10, 1); R3.flagM.position.set(wx, 0.1, wz); R3.flagM.visible = true; R3.flagT = 0.55; }
  else if (kind === 'study') { spray(26, 5, 6, 0.9, 0.8, [[1, 0.77, 0.18], [1, 1, 1], [0.3, 0.6, 1]], 9, 1.5); r3ring(x, y, 0xffc42e, 1, 7, 0.7); R3.fx.flash = Math.max(R3.fx.flash, 1.2); }
}
function r3fxStep(dt) {
  const f = R3.fx, R = Math.random; if (R3.flagT > 0) R3.flagT -= dt;
  const hop = f.flash > 0 ? Math.abs(Math.sin(f.flash * 9)) * 0.03 : 0; if (hop || R3.hop) { R3.crowd.offset.y = hop; R3.hop = hop; } // the crowd jumps
  if (f.flash > 0) { f.flash -= dt; for (let i = 0; i < 4; i++) { const s = R() < 0.5 ? -1 : 1, k = R() * 30; if (R() < 0.62) r3emit(s * (40 + k), 5 + k * 0.68, (R() - 0.5) * 170, 0, 0, 0, 0.1 + R() * 0.08, 3.4, 1, 1, 0.95, 0); else r3emit((R() - 0.5) * 110, 5 + k * 0.68, s * (73 + k), 0, 0, 0, 0.1 + R() * 0.08, 3.4, 1, 1, 0.95, 0); } }
  if (f.live > 0) { // only touch the buffers while something is alive
    f.live = 0;
    for (let i = 0; i < f.N; i++) {
      if (f.life[i] <= 0) { f.col[i * 4 + 3] = 0; continue; }
      f.life[i] -= dt; f.vel[i * 3 + 1] -= f.grav[i] * dt; const j = i * 3;
      f.pos[j] += f.vel[j] * dt; f.pos[j + 1] += f.vel[j + 1] * dt; f.pos[j + 2] += f.vel[j + 2] * dt;
      if (f.pos[j + 1] < 0.08 && f.grav[i] > 0) { f.pos[j + 1] = 0.08; f.vel[j] *= 0.8; f.vel[j + 2] *= 0.8; f.vel[j + 1] = 0; }
      f.col[i * 4 + 3] = f.a0[i] * clamp((f.life[i] / f.max[i]) * 1.6, 0, 1); if (f.life[i] > 0) f.live++;
    }
    f.geo.attributes.position.needsUpdate = f.geo.attributes.col.needsUpdate = f.geo.attributes.size.needsUpdate = true;
    f.pts.visible = true;
  } else f.pts.visible = false;
  f.mat.uniforms.sc.value = (R3.H * R3.rn.getPixelRatio()) / (2 * Math.tan((R3.camera.fov * Math.PI) / 360));
  for (const r of f.rings) { if (r.t <= 0) continue; r.t -= dt; const u = 1 - Math.max(0, r.t) / r.dur, s = r.r0 + (r.r1 - r.r0) * (1 - (1 - u) * (1 - u)); r.m.scale.set(s, s, 1); r.m.material.opacity = 0.9 * (1 - u); if (r.t <= 0) r.m.visible = false; }
}

function r3resize(w, h) { if (!R3.ok) return; R3.W = w; R3.H = h; R3.rn.setSize(w, h, false); }
// Quality levels are pixel-ratio caps: full device resolution first (up to 3×), easing down only if the frame rate cannot hold,
// and never below 1.5×: a blurry picture is worse than a dropped frame.
const DPR_STEPS = [3, 2.25, 1.75, 1.5];
function r3quality(l) { const dpr = window.devicePixelRatio || 1; R3.rn.setPixelRatio(Math.min(dpr, DPR_STEPS[clamp(DPR_STEPS.length - 1 - l, 0, DPR_STEPS.length - 1)])); R3.rn.setSize(R3.W, R3.H, false); }
// view: { pl, G, off, def, los, fd, t, userOn, kb, kick, title, hero, cut, paused, flag, sheet, turbo }
function r3frame(view, dt) {
  const key = view.off.id + '>' + view.def.id; if (key !== R3.pair) { R3.pair = key; r3paint(view.off, view.def); }
  r3players(view, dt); r3ball(view); r3markers(view); r3camera(view, dt); r3fxStep(dt);
  R3.sun.position.set(C3.x + SUN[0] * 230, SUN[1] * 230, C3.z + SUN[2] * 230); R3.sun.target.position.set(C3.x, 0, C3.z); R3.sun.target.updateMatrixWorld();
  R3.rn.render(R3.scene, R3.camera);
}
