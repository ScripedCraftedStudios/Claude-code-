/* ============================================================================
   HARROW'S END — first-person engine
   Raycasting renderer: textured walls (DDA), floor casting with persistent
   blood decals, billboard sprites, baked lightmap, distance fog, flashlight.
   World units are CELLS: 1 cell = one wall block = one wall-height.
   ========================================================================== */
'use strict';

/* ------------------------------- CONSTANTS ------------------------------- */
const MAP_W = 56, MAP_H = 56;
const DEC_PER_CELL = 24;                    // blood-decal texels per cell
const DEC_W = MAP_W * DEC_PER_CELL, DEC_H = MAP_H * DEC_PER_CELL;
const LM_PER_CELL = 4;                      // lightmap samples per cell
const LM_W = MAP_W * LM_PER_CELL, LM_H = MAP_H * LM_PER_CELL;
const TEX = 64;                             // texture size
const FOV = 0.72;                           // camera plane half-width

// Wall tile ids
const W_NONE = 0, W_BRICK = 1, W_SIDING = 2, W_STONE = 3, W_CORN = 4,
      W_BOARD = 5, W_PLASTER = 6, W_DOORFRAME = 7;
// Floor tile ids
const F_GRASS = 0, F_ASPHALT = 1, F_WALK = 2, F_WOOD = 3, F_DIRT = 4;

const TAU = Math.PI * 2;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

/* ------------------------------- WORLD DATA ------------------------------ */
const walls = new Uint8Array(MAP_W * MAP_H);
const floors = new Uint8Array(MAP_W * MAP_H);
const decals = new Uint32Array(DEC_W * DEC_H);   // ABGR, alpha 0 = clean
const lightmap = new Uint8Array(LM_W * LM_H);    // baked warm light

const wallAt = (cx, cy) => (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) ? W_CORN : walls[cy * MAP_W + cx];
const floorAt = (cx, cy) => (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) ? F_GRASS : floors[cy * MAP_W + cx];
const isSolid = (cx, cy) => wallAt(cx, cy) !== W_NONE;

/* ------------------------------- TEXTURES -------------------------------- */
// Each texture is a Uint32Array of TEX*TEX ABGR pixels.
const wallTex = [];
const floorTex = [];

function makeTexCanvas() {
  const c = document.createElement('canvas');
  c.width = TEX; c.height = TEX;
  return [c, c.getContext('2d')];
}
function texToArray(c) {
  const d = c.getContext('2d').getImageData(0, 0, TEX, TEX).data;
  const out = new Uint32Array(TEX * TEX);
  const v = new Uint8Array(out.buffer);
  v.set(d);
  return out;
}
function noiseOverlay(x, n, amt, colors) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = pick(colors);
    x.globalAlpha = rand(0.15, amt);
    x.fillRect(rand(TEX), rand(TEX), rand(1, 5), rand(1, 5));
  }
  x.globalAlpha = 1;
}
function grimeStreaks(x, n, color) {
  x.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    x.globalAlpha = rand(0.05, 0.22);
    x.lineWidth = rand(1, 4);
    const sx = rand(TEX);
    x.beginPath();
    x.moveTo(sx, 0);
    x.lineTo(sx + rand(-4, 4), rand(TEX * 0.4, TEX));
    x.stroke();
  }
  x.globalAlpha = 1;
}

function buildTextures() {
  // --- BRICK storefront ---
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#2a1c18'; x.fillRect(0, 0, TEX, TEX);
    const bh = 8, bw = 16;
    for (let row = 0; row < TEX / bh; row++) {
      const off = (row % 2) * (bw / 2);
      for (let col = -1; col < TEX / bw + 1; col++) {
        x.fillStyle = pick(['#4a2b22', '#553127', '#40251e', '#5c372a', '#452a20']);
        x.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
    noiseOverlay(x, 220, 0.35, ['#1c110d', '#5e392c', '#2f1d16']);
    grimeStreaks(x, 10, '#140c09');
    wallTex[W_BRICK] = texToArray(c);
  }
  // --- CLAPBOARD siding ---
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#39392f'; x.fillRect(0, 0, TEX, TEX);
    for (let y = 0; y < TEX; y += 7) {
      x.fillStyle = pick(['#454539', '#3d3d33', '#4b4b3d', '#35352c']);
      x.fillRect(0, y, TEX, 6);
      x.fillStyle = 'rgba(0,0,0,0.45)';
      x.fillRect(0, y + 6, TEX, 1);
    }
    // peeling paint
    for (let i = 0; i < 26; i++) {
      x.fillStyle = 'rgba(22,20,16,0.5)';
      x.beginPath();
      x.ellipse(rand(TEX), rand(TEX), rand(2, 7), rand(2, 5), rand(TAU), 0, TAU);
      x.fill();
    }
    noiseOverlay(x, 160, 0.3, ['#20201a', '#51513f']);
    grimeStreaks(x, 8, '#12120e');
    wallTex[W_SIDING] = texToArray(c);
  }
  // --- CHURCH stone ---
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#26262a'; x.fillRect(0, 0, TEX, TEX);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      x.fillStyle = pick(['#3b3b40', '#434349', '#333338', '#4a4a50']);
      x.fillRect(col * 16 + 1, row * 16 + 1, 14, 14);
      x.fillStyle = 'rgba(255,255,255,0.04)';
      x.fillRect(col * 16 + 1, row * 16 + 1, 14, 2);
    }
    noiseOverlay(x, 240, 0.3, ['#1c1c20', '#52525a']);
    wallTex[W_STONE] = texToArray(c);
  }
  // --- CORN / field edge ---
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#141a10'; x.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 120; i++) {
      x.strokeStyle = pick(['#3f4a1e', '#4d5522', '#333c18', '#595f28']);
      x.globalAlpha = rand(0.4, 0.95);
      x.lineWidth = rand(1, 3);
      const sx = rand(TEX);
      x.beginPath();
      x.moveTo(sx, TEX);
      x.quadraticCurveTo(sx + rand(-6, 6), TEX / 2, sx + rand(-10, 10), rand(-4, TEX * 0.25));
      x.stroke();
    }
    x.globalAlpha = 1;
    noiseOverlay(x, 120, 0.25, ['#0d1209', '#4a5222']);
    wallTex[W_CORN] = texToArray(c);
  }
  // --- BOARDED window ---
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#0c0c0f'; x.fillRect(0, 0, TEX, TEX);
    x.fillStyle = '#2e2119'; x.fillRect(2, 2, TEX - 4, TEX - 4);
    x.fillStyle = '#08080a'; x.fillRect(7, 7, TEX - 14, TEX - 14);
    for (let i = 0; i < 5; i++) {
      const y = 8 + i * 11 + rand(-2, 2);
      x.save();
      x.translate(TEX / 2, y);
      x.rotate(rand(-0.08, 0.08));
      x.fillStyle = pick(['#4a3520', '#553d26', '#40311d']);
      x.fillRect(-TEX / 2 - 4, -4, TEX + 8, 9);
      x.fillStyle = 'rgba(0,0,0,0.35)';
      x.fillRect(-TEX / 2 - 4, 3, TEX + 8, 2);
      x.restore();
    }
    noiseOverlay(x, 100, 0.3, ['#1a130c', '#5b432a']);
    wallTex[W_BOARD] = texToArray(c);
  }
  // --- INTERIOR plaster (with old blood) ---
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#4a4438'; x.fillRect(0, 0, TEX, TEX);
    noiseOverlay(x, 300, 0.4, ['#3d382e', '#565044', '#332f27']);
    // cracks
    x.strokeStyle = 'rgba(20,18,14,0.6)'; x.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let cx = rand(TEX), cy = rand(TEX);
      x.beginPath(); x.moveTo(cx, cy);
      for (let s = 0; s < 5; s++) { cx += rand(-10, 10); cy += rand(-10, 10); x.lineTo(cx, cy); }
      x.stroke();
    }
    // dried spatter
    for (let i = 0; i < 14; i++) {
      x.fillStyle = pick(['#5e0a0d', '#4a0b0e', '#6b0f12']);
      x.globalAlpha = rand(0.25, 0.6);
      x.beginPath();
      x.ellipse(rand(TEX), rand(TEX), rand(1, 5), rand(1, 4), rand(TAU), 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
    wallTex[W_PLASTER] = texToArray(c);
  }
  // --- DOORFRAME (dark opening, used as a solid but distinct block) ---
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#1a1512'; x.fillRect(0, 0, TEX, TEX);
    x.fillStyle = '#2e2219'; x.fillRect(0, 0, 8, TEX); x.fillRect(TEX - 8, 0, 8, TEX);
    x.fillStyle = '#2e2219'; x.fillRect(0, 0, TEX, 8);
    x.fillStyle = '#050506'; x.fillRect(9, 9, TEX - 18, TEX - 9);
    noiseOverlay(x, 80, 0.25, ['#120e0a', '#3a2b1d']);
    wallTex[W_DOORFRAME] = texToArray(c);
  }

  // --------------------------- FLOORS ---------------------------
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#151b12'; x.fillRect(0, 0, TEX, TEX);
    noiseOverlay(x, 500, 0.5, ['#111709', '#1d2416', '#232a17', '#0f1410']);
    for (let i = 0; i < 40; i++) {   // dead leaves
      x.fillStyle = pick(['#4a3417', '#57320f', '#3d2c12']);
      x.globalAlpha = rand(0.3, 0.8);
      x.beginPath();
      x.ellipse(rand(TEX), rand(TEX), rand(1.5, 4), rand(1, 2.5), rand(TAU), 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
    floorTex[F_GRASS] = texToArray(c);
  }
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#1e2025'; x.fillRect(0, 0, TEX, TEX);
    noiseOverlay(x, 600, 0.45, ['#191b20', '#24262c', '#2a2c33', '#151619']);
    x.strokeStyle = 'rgba(8,8,10,0.7)';
    for (let i = 0; i < 6; i++) {   // cracks
      let cx = rand(TEX), cy = rand(TEX);
      x.lineWidth = rand(0.6, 1.6);
      x.beginPath(); x.moveTo(cx, cy);
      for (let s = 0; s < 4; s++) { cx += rand(-14, 14); cy += rand(-14, 14); x.lineTo(cx, cy); }
      x.stroke();
    }
    floorTex[F_ASPHALT] = texToArray(c);
  }
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#33363c'; x.fillRect(0, 0, TEX, TEX);
    noiseOverlay(x, 420, 0.35, ['#2e3137', '#3a3d44', '#42454c']);
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2;
    x.strokeRect(0, 0, TEX, TEX);
    x.beginPath(); x.moveTo(0, TEX / 2); x.lineTo(TEX, TEX / 2); x.stroke();
    floorTex[F_WALK] = texToArray(c);
  }
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#2f2417'; x.fillRect(0, 0, TEX, TEX);
    for (let y = 0; y < TEX; y += 11) {
      x.fillStyle = pick(['#3a2c1b', '#332715', '#42331f', '#2b2113']);
      x.fillRect(0, y, TEX, 10);
      x.fillStyle = 'rgba(0,0,0,0.5)';
      x.fillRect(0, y + 10, TEX, 1);
    }
    noiseOverlay(x, 260, 0.3, ['#241a10', '#4a3820']);
    floorTex[F_WOOD] = texToArray(c);
  }
  {
    const [c, x] = makeTexCanvas();
    x.fillStyle = '#241d15'; x.fillRect(0, 0, TEX, TEX);
    noiseOverlay(x, 520, 0.45, ['#1e1810', '#2c2419', '#332a1d']);
    floorTex[F_DIRT] = texToArray(c);
  }
}

/* ------------------------------- MAP BUILD ------------------------------- */
const drains = [];       // spawn points (cell coords, center)
const edgeSpawns = [];
const lamps = [];        // {x,y} cell coords — baked into lightmap + billboards
const litWindows = [];
const buildingSigns = [];

function setWall(cx, cy, t) { if (cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H) walls[cy * MAP_W + cx] = t; }
function setFloor(cx, cy, t) { if (cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H) floors[cy * MAP_W + cx] = t; }
function fillFloor(x0, y0, x1, y1, t) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setFloor(x, y, t);
}
function fillWall(x0, y0, x1, y1, t) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setWall(x, y, t);
}

// A building: solid perimeter, optional hollow interior with a doorway
function building(x0, y0, x1, y1, tex, opts) {
  opts = opts || {};
  fillWall(x0, y0, x1, y1, tex);
  if (opts.hollow) {
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
      setWall(x, y, W_NONE);
      setFloor(x, y, opts.floor === undefined ? F_WOOD : opts.floor);
    }
    // doorway on the given side
    const d = opts.door || 'S';
    const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
    if (d === 'S') { setWall(mx, y1, W_NONE); setFloor(mx, y1, F_WOOD); }
    if (d === 'N') { setWall(mx, y0, W_NONE); setFloor(mx, y0, F_WOOD); }
    if (d === 'W') { setWall(x0, my, W_NONE); setFloor(x0, my, F_WOOD); }
    if (d === 'E') { setWall(x1, my, W_NONE); setFloor(x1, my, F_WOOD); }
  }
  // Scatter boarded windows along the facade
  for (let x = x0 + 1; x < x1; x++) {
    if (Math.random() < 0.35) { if (wallAt(x, y1) === tex) setWall(x, y1, W_BOARD); }
    if (Math.random() < 0.25) { if (wallAt(x, y0) === tex) setWall(x, y0, W_BOARD); }
  }
  if (opts.sign) buildingSigns.push({ x: (x0 + x1 + 1) / 2, y: y1 + 0.02, text: opts.sign });
}

function buildMap() {
  walls.fill(W_NONE);
  floors.fill(F_GRASS);
  decals.fill(0);
  lightmap.fill(0);
  drains.length = 0; edgeSpawns.length = 0; lamps.length = 0;
  litWindows.length = 0; buildingSigns.length = 0;

  // Border of corn
  for (let x = 0; x < MAP_W; x++) { setWall(x, 0, W_CORN); setWall(x, 1, W_CORN); setWall(x, MAP_H - 1, W_CORN); setWall(x, MAP_H - 2, W_CORN); }
  for (let y = 0; y < MAP_H; y++) { setWall(0, y, W_CORN); setWall(1, y, W_CORN); setWall(MAP_W - 1, y, W_CORN); setWall(MAP_W - 2, y, W_CORN); }

  // Main Street (E-W) and Church Street (N-S)
  const MSy0 = 26, MSy1 = 31;
  const CSx0 = 26, CSx1 = 30;
  fillFloor(2, MSy0, MAP_W - 3, MSy1, F_ASPHALT);
  fillFloor(2, MSy0 - 1, MAP_W - 3, MSy0 - 1, F_WALK);
  fillFloor(2, MSy1 + 1, MAP_W - 3, MSy1 + 1, F_WALK);
  fillFloor(CSx0, 2, CSx1, MAP_H - 3, F_ASPHALT);
  fillFloor(CSx0 - 1, 2, CSx0 - 1, MAP_H - 3, F_WALK);
  fillFloor(CSx1 + 1, 2, CSx1 + 1, MAP_H - 3, F_WALK);

  // ---- North side of Main Street ----
  building(4, 18, 11, 24, W_BRICK, { hollow: true, door: 'S', sign: "CARRIGAN'S GROCERY" });
  building(13, 19, 19, 24, W_SIDING, { sign: 'PHARMACY' });
  building(21, 17, 25, 24, W_BRICK, { hollow: true, door: 'S', sign: 'MAINE DINER' });
  building(32, 18, 38, 24, W_SIDING, { sign: 'HARDWARE' });
  building(40, 17, 46, 24, W_BRICK, { hollow: true, door: 'S', sign: 'BOOKS & NEWS' });
  building(48, 19, 52, 24, W_SIDING, { sign: 'BARBER' });
  // ---- South side ----
  building(4, 33, 10, 39, W_SIDING, { sign: 'LAUNDROMAT' });
  building(12, 33, 19, 40, W_STONE, { hollow: true, door: 'N', sign: 'TOWN HALL' });
  building(21, 33, 25, 39, W_BRICK, { sign: 'POST OFFICE' });
  building(32, 33, 38, 40, W_BRICK, { hollow: true, door: 'N', sign: "THE ANCHOR TAVERN" });
  building(40, 33, 46, 39, W_STONE, { sign: 'SHERIFF' });
  building(48, 33, 52, 39, W_SIDING, { sign: 'MOTEL' });
  // ---- Church at the north end of Church Street ----
  building(24, 5, 32, 13, W_STONE, { hollow: true, door: 'S' });
  buildingSigns.push({ x: 28.5, y: 13.02, text: 'FIRST CHURCH' });
  // ---- Outlying houses ----
  building(6, 6, 11, 11, W_SIDING, {});
  building(15, 7, 20, 12, W_SIDING, {});
  building(36, 6, 41, 11, W_SIDING, {});
  building(45, 7, 50, 12, W_SIDING, {});
  building(6, 45, 11, 50, W_SIDING, {});
  building(15, 44, 20, 49, W_SIDING, {});
  building(36, 45, 41, 50, W_SIDING, {});
  building(45, 44, 50, 49, W_SIDING, {});

  // Paths of dirt from the street to the outlying houses
  fillFloor(8, 12, 8, 25, F_DIRT);
  fillFloor(38, 12, 38, 25, F_DIRT);
  fillFloor(8, 32, 8, 45, F_DIRT);
  fillFloor(38, 32, 38, 45, F_DIRT);

  // Street lamps along Main + Church street
  for (let x = 6; x < MAP_W - 4; x += 7) {
    lamps.push({ x: x + 0.5, y: MSy0 - 0.6, phase: rand(TAU), dying: Math.random() < 0.35 });
    lamps.push({ x: x + 3.5, y: MSy1 + 1.6, phase: rand(TAU), dying: Math.random() < 0.35 });
  }
  for (let y = 6; y < MAP_H - 4; y += 8) {
    if (y > MSy0 - 4 && y < MSy1 + 4) continue;
    lamps.push({ x: CSx0 - 0.6, y: y + 0.5, phase: rand(TAU), dying: Math.random() < 0.3 });
  }

  // Sewer drains — where the Hollowed come up
  [[9, MSy1 + 0.5], [17, MSy0 + 0.5], [24, MSy1 + 0.5], [34, MSy0 + 0.5],
   [43, MSy1 + 0.5], [50, MSy0 + 0.5], [CSx0 + 0.5, 16], [CSx1 - 0.5, 40]].forEach(([x, y]) => {
    drains.push({ x: x + 0.5, y: y, pulse: rand(TAU) });
  });

  // Edge spawns — road mouths and the fields
  edgeSpawns.push(
    { x: 3.5, y: 28.5 }, { x: MAP_W - 4.5, y: 28.5 },
    { x: 28, y: 3.5 }, { x: 28, y: MAP_H - 4.5 },
    { x: 8, y: 28.5 }, { x: 48, y: 28.5 },
    { x: 28, y: 16 }, { x: 28, y: 42 }
  );

  paintPermanentDecals(MSy0, MSy1, CSx0, CSx1);
  bakeLightmap();
}

// Road markings, drain grates and old stains live in the decal layer
function paintPermanentDecals(MSy0, MSy1, CSx0, CSx1) {
  const midY = (MSy0 + MSy1 + 1) / 2, midX = (CSx0 + CSx1 + 1) / 2;
  for (let x = 3; x < MAP_W - 3; x += 1.6) {
    if (x > CSx0 - 1 && x < CSx1 + 2) continue;
    decalRect(x, midY - 0.06, 0.9, 0.12, 0xff4a8ea8, 0.5);   // faded yellow (ABGR)
  }
  for (let y = 3; y < MAP_H - 3; y += 1.6) {
    if (y > MSy0 - 1 && y < MSy1 + 2) continue;
    decalRect(midX - 0.06, y, 0.12, 0.9, 0xff4a8ea8, 0.5);
  }
  for (const d of drains) {
    decalEllipse(d.x, d.y, 0.34, 0.24, 0xff100c0a, 0.95);
    for (let i = -2; i <= 2; i++) decalRect(d.x + i * 0.11, d.y - 0.2, 0.045, 0.4, 0xff2a2622, 0.9);
  }
  // Old, dried stains: the town has done this before
  for (let i = 0; i < 90; i++) {
    const x = rand(3, MAP_W - 3), y = rand(3, MAP_H - 3);
    if (isSolid(Math.floor(x), Math.floor(y))) continue;
    decalEllipse(x, y, rand(0.1, 0.5), rand(0.08, 0.4), 0xff0d0a2e, rand(0.15, 0.4));
  }
}

function bakeLightmap() {
  // Static warm pools under the streetlamps, plus a faint glow inside doorways.
  for (const l of lamps) {
    const R = 5.5;
    const cx0 = Math.max(0, Math.floor((l.x - R) * LM_PER_CELL)), cx1 = Math.min(LM_W - 1, Math.ceil((l.x + R) * LM_PER_CELL));
    const cy0 = Math.max(0, Math.floor((l.y - R) * LM_PER_CELL)), cy1 = Math.min(LM_H - 1, Math.ceil((l.y + R) * LM_PER_CELL));
    for (let ly = cy0; ly <= cy1; ly++) {
      for (let lx = cx0; lx <= cx1; lx++) {
        const wx = (lx + 0.5) / LM_PER_CELL, wy = (ly + 0.5) / LM_PER_CELL;
        const d = Math.hypot(wx - l.x, wy - l.y);
        if (d > R) continue;
        // Blocked by a building? cheap check at the midpoint
        if (isSolid(Math.floor((wx + l.x) / 2), Math.floor((wy + l.y) / 2))) continue;
        const v = Math.pow(1 - d / R, 2) * 210;
        const i = ly * LM_W + lx;
        lightmap[i] = Math.min(255, lightmap[i] + v);
      }
    }
  }
}

/* ------------------------------ DECAL PAINTING --------------------------- */
// All decal writes are alpha-blended into the persistent floor layer.
function decalBlend(i, color, alpha) {
  const dst = decals[i];
  const da = (dst >>> 24) / 255;
  const sr = color & 0xff, sg = (color >>> 8) & 0xff, sb = (color >>> 16) & 0xff;
  const dr = dst & 0xff, dg = (dst >>> 8) & 0xff, db = (dst >>> 16) & 0xff;
  const oa = alpha + da * (1 - alpha);
  if (oa <= 0) return;
  const r = (sr * alpha + dr * da * (1 - alpha)) / oa;
  const g = (sg * alpha + dg * da * (1 - alpha)) / oa;
  const b = (sb * alpha + db * da * (1 - alpha)) / oa;
  decals[i] = ((Math.min(255, oa * 255) | 0) << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
}
function decalEllipse(wx, wy, rx, ry, color, alpha) {
  const x0 = Math.max(0, Math.floor((wx - rx) * DEC_PER_CELL)), x1 = Math.min(DEC_W - 1, Math.ceil((wx + rx) * DEC_PER_CELL));
  const y0 = Math.max(0, Math.floor((wy - ry) * DEC_PER_CELL)), y1 = Math.min(DEC_H - 1, Math.ceil((wy + ry) * DEC_PER_CELL));
  const cx = wx * DEC_PER_CELL, cy = wy * DEC_PER_CELL;
  const ax = rx * DEC_PER_CELL, ay = ry * DEC_PER_CELL;
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ay;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / ax;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      decalBlend(y * DEC_W + x, color, alpha * (1 - d2 * 0.35));
    }
  }
}
function decalRect(wx, wy, w, h, color, alpha) {
  const x0 = Math.max(0, Math.floor(wx * DEC_PER_CELL)), x1 = Math.min(DEC_W - 1, Math.ceil((wx + w) * DEC_PER_CELL));
  const y0 = Math.max(0, Math.floor(wy * DEC_PER_CELL)), y1 = Math.min(DEC_H - 1, Math.ceil((wy + h) * DEC_PER_CELL));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) decalBlend(y * DEC_W + x, color, alpha);
}

// Blood palette in ABGR
const BLOOD = [0xff0d107a, 0xff14188f, 0xff0a0d5e, 0xff1a1aa0, 0xff0f126b];
function bloodSplat(wx, wy, size, alpha) {
  const c = pick(BLOOD);
  decalEllipse(wx, wy, size * rand(0.7, 1.3), size * rand(0.6, 1.1), c, alpha === undefined ? rand(0.5, 0.9) : alpha);
}
function bloodPool(wx, wy, size) {
  for (let i = 0; i < 7; i++) {
    const a = rand(TAU), d = rand(0, size * 0.6);
    decalEllipse(wx + Math.cos(a) * d, wy + Math.sin(a) * d,
      size * rand(0.4, 1), size * rand(0.35, 0.9), pick(BLOOD), rand(0.5, 0.9));
  }
  // Spray flecks around the pool
  for (let i = 0; i < 14; i++) {
    const a = rand(TAU), d = rand(size * 0.6, size * 2.2);
    decalEllipse(wx + Math.cos(a) * d, wy + Math.sin(a) * d, rand(0.03, 0.1), rand(0.03, 0.09), pick(BLOOD), rand(0.4, 0.8));
  }
}
function corpseStamp(wx, wy, tone) {
  bloodPool(wx, wy, 0.5);
  const a = rand(TAU);
  // sprawled body
  decalEllipse(wx, wy, 0.34, 0.2, tone, 0.92);
  decalEllipse(wx + Math.cos(a) * 0.36, wy + Math.sin(a) * 0.36, 0.13, 0.13, 0xff8ea09a, 0.9);
  for (let i = 0; i < 4; i++) {
    const la = rand(TAU), ll = rand(0.2, 0.42);
    decalEllipse(wx + Math.cos(la) * ll, wy + Math.sin(la) * ll, 0.09, 0.07, tone, 0.85);
  }
}

/* ------------------------------ SPRITE ART ------------------------------- */
// Every creature is drawn procedurally into frames, then billboarded.
const SPR = {};

function makeSprite(w, h, drawFn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  drawFn(x, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const px = new Uint32Array(w * h);
  new Uint8Array(px.buffer).set(d);
  return { w, h, px };
}

function bloodStainsOn(x, w, h, n) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = pick(['#5e0a0d', '#7a1013', '#4a0b0e']);
    x.globalAlpha = rand(0.4, 0.85);
    x.beginPath();
    x.ellipse(rand(w * 0.25, w * 0.75), rand(h * 0.35, h * 0.85), rand(1, 4), rand(1, 5), rand(TAU), 0, TAU);
    x.fill();
  }
  x.globalAlpha = 1;
}

// Creature art is drawn at base size then rendered at S× so it survives
// being three feet from the camera. Stains are generated once per creature
// and reused across frames — otherwise the blood crawls as they walk.
function makeSpriteS(w, h, S, drawFn) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * S); c.height = Math.round(h * S);
  const x = c.getContext('2d');
  x.scale(S, S);
  drawFn(x, w, h);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const px = new Uint32Array(c.width * c.height);
  new Uint8Array(px.buffer).set(d);
  return { w: c.width, h: c.height, px };
}

function makeStains(n, w, h, y0, y1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: rand(w * 0.25, w * 0.75), y: rand(h * y0, h * y1),
      rx: rand(1, 4), ry: rand(1, 5), rot: rand(TAU),
      a: rand(0.45, 0.9), c: pick(['#5e0a0d', '#7a1013', '#4a0b0e', '#3d0709'])
    });
  }
  return out;
}
function drawStains(x, stains) {
  for (const s of stains) {
    x.fillStyle = s.c; x.globalAlpha = s.a;
    x.beginPath(); x.ellipse(s.x, s.y, s.rx, s.ry, s.rot, 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
}
// A dead face: sunken sockets, a cold pinprick of shine, jaw hung open.
function deadFace(x, cx, cy, rx, ry, skin, openJaw) {
  x.fillStyle = skin;
  x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, TAU); x.fill();
  // hollow cheeks
  x.fillStyle = 'rgba(30,34,26,0.5)';
  x.beginPath(); x.ellipse(cx - rx * 0.62, cy + ry * 0.25, rx * 0.26, ry * 0.3, 0, 0, TAU); x.fill();
  x.beginPath(); x.ellipse(cx + rx * 0.62, cy + ry * 0.25, rx * 0.26, ry * 0.3, 0, 0, TAU); x.fill();
  // sockets
  x.fillStyle = '#0a0907';
  x.beginPath(); x.ellipse(cx - rx * 0.42, cy - ry * 0.18, rx * 0.28, ry * 0.26, 0, 0, TAU); x.fill();
  x.beginPath(); x.ellipse(cx + rx * 0.42, cy - ry * 0.18, rx * 0.28, ry * 0.26, 0, 0, TAU); x.fill();
  x.fillStyle = 'rgba(190,205,180,0.75)';
  x.beginPath(); x.arc(cx - rx * 0.4, cy - ry * 0.14, rx * 0.075, 0, TAU); x.fill();
  x.beginPath(); x.arc(cx + rx * 0.44, cy - ry * 0.14, rx * 0.075, 0, TAU); x.fill();
  // jaw
  x.fillStyle = '#120406';
  x.beginPath(); x.ellipse(cx, cy + ry * (openJaw ? 0.58 : 0.46), rx * (openJaw ? 0.36 : 0.22), ry * (openJaw ? 0.38 : 0.18), 0, 0, TAU); x.fill();
  x.fillStyle = '#b8ad8e';
  for (let t = -2; t <= 2; t++) {
    x.fillRect(cx + t * rx * 0.13 - rx * 0.03, cy + ry * (openJaw ? 0.3 : 0.36), rx * 0.06, ry * 0.12);
  }
  // what it has been eating, running down the chin
  x.fillStyle = 'rgba(74,8,11,0.8)';
  x.beginPath(); x.ellipse(cx, cy + ry * 0.8, rx * 0.2, ry * 0.14, 0, 0, TAU); x.fill();
  x.fillStyle = 'rgba(94,10,13,0.72)';
  x.fillRect(cx - rx * 0.09, cy + ry * 0.66, rx * 0.07, ry * 0.5);
  x.fillRect(cx + rx * 0.13, cy + ry * 0.7, rx * 0.055, ry * 0.36);
}

function buildSprites() {
  // ---------------- SHAMBLER: what's left of a neighbor ----------------
  SPR.shambler = [];
  {
    const stains = makeStains(9, 48, 76, 0.36, 0.86);
    for (let f = 0; f < 4; f++) {
      SPR.shambler.push(makeSpriteS(48, 76, 3, (x, w, h) => {
        const ph = f / 4 * TAU;
        const sway = Math.sin(ph) * 2.2, armUp = Math.sin(ph + 1) * 3;
        const cx = w / 2;
        // dragging legs
        x.strokeStyle = '#1d1b18'; x.lineWidth = 6.5; x.lineCap = 'round';
        x.beginPath(); x.moveTo(cx - 4, h - 28); x.lineTo(cx - 7 + sway, h - 2); x.stroke();
        x.beginPath(); x.moveTo(cx + 4, h - 28); x.lineTo(cx + 7 - sway, h - 2); x.stroke();
        // torn coat — broad shoulders so the head doesn't dominate
        x.fillStyle = '#2b2825';
        x.beginPath();
        x.moveTo(cx - 14, h - 50); x.lineTo(cx + 14, h - 50);
        x.lineTo(cx + 11, h - 24); x.lineTo(cx - 11, h - 24);
        x.closePath(); x.fill();
        x.fillStyle = '#211e1c';
        x.beginPath(); x.ellipse(cx, h - 50, 14, 4, 0, 0, TAU); x.fill();
        // torn-open front, ribs showing
        x.fillStyle = '#150c0c';
        x.beginPath(); x.ellipse(cx + 1, h - 38, 5, 7, 0.2, 0, TAU); x.fill();
        x.strokeStyle = 'rgba(190,180,150,0.5)'; x.lineWidth = 1;
        for (let r = 0; r < 3; r++) {
          x.beginPath(); x.moveTo(cx - 3, h - 42 + r * 4); x.lineTo(cx + 4, h - 41 + r * 4); x.stroke();
        }
        drawStains(x, stains);
        // arms: one reaching, one hanging broken
        x.strokeStyle = '#252220'; x.lineWidth = 5.5; x.lineCap = 'round';
        x.beginPath(); x.moveTo(cx - 10, h - 46); x.lineTo(cx - 18, h - 36 + armUp); x.lineTo(cx - 15, h - 24 + armUp); x.stroke();
        x.beginPath(); x.moveTo(cx + 10, h - 46); x.lineTo(cx + 16, h - 32 - armUp); x.lineTo(cx + 13, h - 18 - armUp); x.stroke();
        x.fillStyle = '#5c6446';
        x.beginPath(); x.ellipse(cx - 15, h - 22 + armUp, 3.2, 3.8, 0.3, 0, TAU); x.fill();
        x.beginPath(); x.ellipse(cx + 13, h - 16 - armUp, 3.2, 3.8, -0.3, 0, TAU); x.fill();
        // bloodied fingers
        x.strokeStyle = '#5e0a0d'; x.lineWidth = 1.2;
        for (let fg = -1; fg <= 1; fg++) {
          x.beginPath(); x.moveTo(cx - 15 + fg, h - 19 + armUp); x.lineTo(cx - 15 + fg * 1.6, h - 15 + armUp); x.stroke();
        }
        // neck + head at a wrong angle
        x.strokeStyle = '#6f7758'; x.lineWidth = 4;
        x.beginPath(); x.moveTo(cx, h - 50); x.lineTo(cx + sway * 0.5, h - 55); x.stroke();
        x.save();
        x.translate(cx + sway * 0.7, h - 60);
        x.rotate(sway * 0.06 - 0.08);
        deadFace(x, 0, 0, 6.4, 8, '#5f6a4a', true);
        // thin dead hair
        x.strokeStyle = 'rgba(20,18,14,0.75)'; x.lineWidth = 1;
        for (let i = -3; i <= 3; i++) {
          x.beginPath(); x.moveTo(i * 2, -8.5); x.lineTo(i * 2.6, -13 - Math.abs(i)); x.stroke();
        }
        x.restore();
      }));
    }
  }

  // ---------------- CRAWLER: learning to be an animal ----------------
  SPR.crawler = [];
  {
    const stains = makeStains(7, 56, 42, 0.4, 0.85);
    for (let f = 0; f < 4; f++) {
      SPR.crawler.push(makeSpriteS(56, 42, 3, (x, w, h) => {
        const sk = Math.sin(f / 4 * TAU) * 4;
        const cx = w / 2;
        x.strokeStyle = '#3d3930'; x.lineWidth = 4; x.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const side = i < 2 ? -1 : 1, off = (i % 2) * 9 - 4;
          const kx = cx + off + side * 3;
          x.beginPath();
          x.moveTo(kx, h - 16);
          x.lineTo(kx + side * (11 + sk * side), h - 24 - Math.abs(sk));
          x.lineTo(kx + side * (14 + sk * side), h - 2);
          x.stroke();
        }
        // splayed hands
        x.fillStyle = '#6e7557';
        for (let i = 0; i < 4; i++) {
          const side = i < 2 ? -1 : 1, off = (i % 2) * 9 - 4;
          const kx = cx + off + side * 3 + side * (14 + sk * side);
          x.beginPath(); x.ellipse(kx, h - 3, 3, 2.2, 0, 0, TAU); x.fill();
        }
        x.fillStyle = '#2e2a24';
        x.beginPath(); x.ellipse(cx, h - 15, 15, 8.5, 0, 0, TAU); x.fill();
        // spine ridge
        x.strokeStyle = '#4a4438'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(cx - 12, h - 19); x.lineTo(cx + 12, h - 18); x.stroke();
        drawStains(x, stains);
        // head low, jaw split wide
        x.save();
        x.translate(cx, h - 24 + sk * 0.3);
        x.fillStyle = '#7c8365';
        x.beginPath(); x.ellipse(0, 0, 8.5, 7, 0, 0, TAU); x.fill();
        x.fillStyle = '#0a0907';
        x.beginPath(); x.ellipse(-3.6, -1.6, 2.4, 2.2, 0, 0, TAU); x.fill();
        x.beginPath(); x.ellipse(3.6, -1.6, 2.4, 2.2, 0, 0, TAU); x.fill();
        x.fillStyle = 'rgba(215,225,190,0.8)';
        x.beginPath(); x.arc(-3.4, -1.4, 0.8, 0, TAU); x.fill();
        x.beginPath(); x.arc(3.8, -1.4, 0.8, 0, TAU); x.fill();
        // the jaw has split at the hinge
        x.fillStyle = '#12060a';
        x.beginPath();
        x.moveTo(-8, 2); x.lineTo(0, 4); x.lineTo(8, 2); x.lineTo(6, 12); x.lineTo(-6, 12);
        x.closePath(); x.fill();
        x.fillStyle = '#c8b78a';
        for (let t = -5; t <= 5; t += 2.3) {
          x.beginPath(); x.moveTo(t, 3); x.lineTo(t + 1, 9.5); x.lineTo(t + 2, 3); x.closePath(); x.fill();
        }
        x.strokeStyle = '#4a0b0e'; x.lineWidth = 2.6;
        x.beginPath(); x.moveTo(-7.6, 2); x.lineTo(-12, 9); x.stroke();
        x.beginPath(); x.moveTo(7.6, 2); x.lineTo(12, 9); x.stroke();
        // drooling
        x.strokeStyle = 'rgba(94,10,13,0.8)'; x.lineWidth = 1.4;
        x.beginPath(); x.moveTo(-1, 12); x.lineTo(-1.5, 17 + sk * 0.3); x.stroke();
        x.restore();
      }));
    }
  }

  // ---------------- BLOATER: swollen with what it swallowed ----------------
  SPR.bloater = [];
  {
    const stains = makeStains(8, 72, 78, 0.4, 0.8);
    for (let f = 0; f < 3; f++) {
      SPR.bloater.push(makeSpriteS(72, 78, 3, (x, w, h) => {
        const pulse = 1 + Math.sin(f / 3 * TAU) * 0.05;
        const cx = w / 2;
        x.strokeStyle = '#242b1f'; x.lineWidth = 8; x.lineCap = 'round';
        x.beginPath(); x.moveTo(cx - 9, h - 20); x.lineTo(cx - 13, h - 2); x.stroke();
        x.beginPath(); x.moveTo(cx + 9, h - 20); x.lineTo(cx + 13, h - 2); x.stroke();
        x.save();
        x.translate(cx, h - 38);
        x.scale(pulse, pulse);
        x.fillStyle = '#37412d';
        x.beginPath(); x.ellipse(0, 0, 27, 25, 0, 0, TAU); x.fill();
        // straining, translucent gut
        x.fillStyle = 'rgba(150,170,95,0.62)';
        x.beginPath(); x.ellipse(0, 5, 18, 16, 0, 0, TAU); x.fill();
        x.fillStyle = 'rgba(200,225,130,0.4)';
        x.beginPath(); x.ellipse(-5, 2, 9, 7.5, 0, 0, TAU); x.fill();
        // things inside it
        x.fillStyle = 'rgba(60,40,20,0.55)';
        x.beginPath(); x.ellipse(4, 7, 4, 6, 0.5, 0, TAU); x.fill();
        x.beginPath(); x.ellipse(-6, 9, 3, 4, -0.4, 0, TAU); x.fill();
        // seams about to give
        x.strokeStyle = '#6b0f12'; x.lineWidth = 2.6;
        for (let i = 0; i < 5; i++) {
          const a = i * 1.28;
          x.beginPath();
          x.moveTo(Math.cos(a) * 8, Math.sin(a) * 7);
          x.lineTo(Math.cos(a) * 21, Math.sin(a) * 19);
          x.stroke();
        }
        x.fillStyle = '#5e0a0d';
        for (let i = 0; i < 6; i++) {
          const a = i * 1.06;
          x.beginPath(); x.arc(Math.cos(a) * 16, Math.sin(a) * 14, 2.6 + (i % 3), 0, TAU); x.fill();
        }
        x.restore();
        drawStains(x, stains);
        // tiny head, half swallowed by the mass
        x.save();
        x.translate(cx, h - 64);
        deadFace(x, 0, 0, 8, 7.5, '#828a66', false);
        x.restore();
      }));
    }
  }

  // ---------------- THE HARVEST MAN ----------------
  const bossBody = (x, w, h, swing, swipe) => {
    const cx = w / 2;
    // long legs under the coat
    x.strokeStyle = '#141009'; x.lineWidth = 13; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx - 12, h - 70); x.lineTo(cx - 16 + swing * 0.5, h - 4); x.stroke();
    x.beginPath(); x.moveTo(cx + 12, h - 70); x.lineTo(cx + 16 - swing * 0.5, h - 4); x.stroke();
    // the coat
    x.fillStyle = '#191410';
    x.beginPath();
    x.moveTo(cx - 30, h - 60);
    x.quadraticCurveTo(cx - 40, h - 120, cx - 26, h - 150);
    x.lineTo(cx + 26, h - 150);
    x.quadraticCurveTo(cx + 40, h - 120, cx + 30, h - 60);
    x.quadraticCurveTo(cx, h - 48, cx - 30, h - 60);
    x.closePath(); x.fill();
    x.strokeStyle = '#241c14'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(cx - 10, h - 145); x.lineTo(cx - 13, h - 58); x.stroke();
    x.beginPath(); x.moveTo(cx + 10, h - 145); x.lineTo(cx + 13, h - 58); x.stroke();
  };
  const bossStains = makeStains(12, 150, 210, 0.35, 0.72);
  const bossStraw = [];
  for (let i = 0; i < 16; i++) bossStraw.push({ x: rand(-28, 28), dx: rand(-4, 4), len: rand(0, 8) });

  SPR.boss = [];
  for (let f = 0; f < 4; f++) {
    SPR.boss.push(makeSpriteS(150, 210, 2.5, (x, w, h) => {
      const swing = Math.sin(f / 4 * TAU) * 9;
      const cx = w / 2;
      bossBody(x, w, h, swing, false);
      x.strokeStyle = '#6e6248'; x.lineWidth = 1.6;
      for (const s of bossStraw) {
        x.beginPath(); x.moveTo(cx + s.x, h - 62); x.lineTo(cx + s.x + s.dx, h - 50 + s.len); x.stroke();
      }
      drawStains(x, bossStains);
      // too-long arms, tine fingers
      x.strokeStyle = '#191410'; x.lineWidth = 11; x.lineCap = 'round';
      x.beginPath(); x.moveTo(cx - 26, h - 142); x.lineTo(cx - 54, h - 100 + swing); x.lineTo(cx - 60, h - 44 + swing); x.stroke();
      x.beginPath(); x.moveTo(cx + 26, h - 142); x.lineTo(cx + 54, h - 100 - swing); x.lineTo(cx + 60, h - 44 - swing); x.stroke();
      x.strokeStyle = '#3d3324'; x.lineWidth = 3.4;
      for (let fg = -1; fg <= 1; fg++) {
        x.beginPath(); x.moveTo(cx - 60, h - 44 + swing); x.lineTo(cx - 64 + fg * 7, h - 20 + swing); x.stroke();
        x.beginPath(); x.moveTo(cx + 60, h - 44 - swing); x.lineTo(cx + 64 + fg * 7, h - 20 - swing); x.stroke();
      }
      bossHead(x, cx, h - 168, 1);
    }));
  }
  SPR.bossSwipe = makeSpriteS(150, 210, 2.5, (x, w, h) => {
    const cx = w / 2;
    bossBody(x, w, h, 0, true);
    x.strokeStyle = '#6e6248'; x.lineWidth = 1.6;
    for (const s of bossStraw) {
      x.beginPath(); x.moveTo(cx + s.x, h - 62); x.lineTo(cx + s.x + s.dx, h - 50 + s.len); x.stroke();
    }
    drawStains(x, bossStains);
    // arms flung wide, claws spread at the camera
    x.strokeStyle = '#191410'; x.lineWidth = 12; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx - 26, h - 142); x.lineTo(cx - 62, h - 152); x.lineTo(cx - 72, h - 178); x.stroke();
    x.beginPath(); x.moveTo(cx + 26, h - 142); x.lineTo(cx + 62, h - 152); x.lineTo(cx + 72, h - 178); x.stroke();
    x.strokeStyle = '#3d3324'; x.lineWidth = 4;
    for (let fg = -1; fg <= 1; fg++) {
      x.beginPath(); x.moveTo(cx - 72, h - 178); x.lineTo(cx - 80 + fg * 9, h - 200); x.stroke();
      x.beginPath(); x.moveTo(cx + 72, h - 178); x.lineTo(cx + 80 + fg * 9, h - 200); x.stroke();
    }
    bossHead(x, cx, h - 168, 2);
  });

  // ---------------- PICKUPS & LAMP ----------------
  SPR.medkit = makeSpriteS(28, 22, 3, (x, w, h) => {
    x.fillStyle = '#c8c9ce'; x.fillRect(2, 4, w - 4, h - 6);
    x.fillStyle = '#9a9ba0'; x.fillRect(2, 4, w - 4, 3);
    x.fillStyle = '#a01a1a';
    x.fillRect(w / 2 - 2.5, 8, 5, 11);
    x.fillRect(w / 2 - 7, 11.5, 14, 4);
    x.strokeStyle = '#5c5d61'; x.lineWidth = 1.5; x.strokeRect(2, 4, w - 4, h - 6);
  });
  SPR.ammoR = makeSpriteS(26, 18, 3, (x, w, h) => {
    x.fillStyle = '#6b5a30'; x.fillRect(2, 5, w - 4, h - 7);
    x.fillStyle = '#4c4021'; x.fillRect(2, 5, w - 4, 3);
    x.fillStyle = '#c9b061';
    for (let i = 0; i < 4; i++) x.fillRect(4 + i * 5, 8, 3, 7);
    x.fillStyle = '#8a7640';
    for (let i = 0; i < 4; i++) x.fillRect(4 + i * 5, 8, 3, 2);
  });
  SPR.ammoS = makeSpriteS(26, 18, 3, (x, w, h) => {
    x.fillStyle = '#37402c'; x.fillRect(2, 5, w - 4, h - 7);
    x.fillStyle = '#28301f'; x.fillRect(2, 5, w - 4, 3);
    for (let i = 0; i < 4; i++) {
      x.fillStyle = '#a03024'; x.fillRect(4 + i * 5, 7, 3.5, 8);
      x.fillStyle = '#c9b061'; x.fillRect(4 + i * 5, 13, 3.5, 2.5);
    }
  });
  SPR.shotgunPickup = makeSpriteS(46, 16, 3, (x, w, h) => {
    x.fillStyle = '#454a52'; x.fillRect(12, 6, 32, 4.5);
    x.fillStyle = '#2f3339'; x.fillRect(12, 10.5, 30, 2);
    x.fillStyle = '#3d2c17'; x.fillRect(2, 5, 13, 7);
    x.fillStyle = '#5c421f'; x.fillRect(16, 7.5, 9, 5);
  });
  SPR.ammoF = makeSpriteS(26, 18, 3, (x, w, h) => {
    x.fillStyle = '#4a3a22'; x.fillRect(2, 5, w - 4, h - 7);
    x.fillStyle = '#352a18'; x.fillRect(2, 5, w - 4, 3);
    for (let i = 0; i < 4; i++) {
      x.fillStyle = '#c9b061'; x.fillRect(4 + i * 5, 7, 3, 9);
      x.fillStyle = '#8f7a3e'; x.fillRect(4 + i * 5, 7, 3, 2.5);
    }
  });
  SPR.riflePickup = makeSpriteS(52, 18, 3, (x, w, h) => {
    x.fillStyle = '#3a3e44'; x.fillRect(16, 7, 34, 4);          // barrel
    x.fillStyle = '#4a3018'; x.fillRect(2, 6, 16, 8);           // stock
    x.fillStyle = '#33373d'; x.fillRect(16, 5, 12, 8);          // receiver
    x.fillStyle = '#1c1f24'; x.fillRect(18, 1.5, 18, 4.5);      // scope
    x.fillStyle = '#2a2e35'; x.fillRect(20, 0.5, 3, 6.5);
    x.fillStyle = '#2a2e35'; x.fillRect(31, 0.5, 3, 6.5);
    x.fillStyle = 'rgba(120,190,200,0.5)'; x.fillRect(34, 2.5, 2, 2.5);
  });
  SPR.lamp = makeSprite(24, 24, (x) => {
    const g = x.createRadialGradient(12, 12, 1, 12, 12, 12);
    g.addColorStop(0, 'rgba(255,232,180,1)');
    g.addColorStop(0.35, 'rgba(245,196,105,0.5)');
    g.addColorStop(1, 'rgba(240,190,100,0)');
    x.fillStyle = g; x.fillRect(0, 0, 24, 24);
  });
}

// The burlap head, its stitched grin, and those amber eyes
function bossHead(x, cx, cy, mode) {
  x.fillStyle = '#6e6248';
  x.beginPath(); x.ellipse(cx, cy, 24, 27, 0, 0, TAU); x.fill();
  // sackcloth weave
  x.strokeStyle = 'rgba(45,38,24,0.35)'; x.lineWidth = 0.8;
  for (let i = -20; i <= 20; i += 5) {
    x.beginPath(); x.moveTo(cx + i, cy - 24); x.lineTo(cx + i, cy + 24); x.stroke();
  }
  x.strokeStyle = '#3a3020'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(cx - 16, cy - 18); x.lineTo(cx + 16, cy - 15); x.stroke();
  for (let s = -14; s <= 14; s += 5) {
    x.beginPath(); x.moveTo(cx + s, cy - 22); x.lineTo(cx + s + 2, cy - 12); x.stroke();
  }
  if (mode === 2) {
    // jaw unhinged for the swipe
    x.fillStyle = '#170a06';
    x.beginPath(); x.ellipse(cx, cy + 9, 15, 19, 0, 0, TAU); x.fill();
    x.strokeStyle = '#c8bfa4'; x.lineWidth = 2.4;
    for (let tx = -12; tx <= 12; tx += 3.4) {
      x.beginPath(); x.moveTo(cx + tx, cy - 8); x.lineTo(cx + tx, cy); x.stroke();
      x.beginPath(); x.moveTo(cx + tx, cy + 23); x.lineTo(cx + tx, cy + 16); x.stroke();
    }
  } else {
    x.strokeStyle = '#170a06'; x.lineWidth = 5;
    x.beginPath(); x.arc(cx, cy + 2, 17, 0.12 * Math.PI, 0.88 * Math.PI); x.stroke();
    x.strokeStyle = '#c8bfa4'; x.lineWidth = 2.2;
    for (let tx = -13; tx <= 13; tx += 3) {
      const ty = cy + 2 + Math.sqrt(Math.max(0, 289 - tx * tx)) * 0.92;
      x.beginPath(); x.moveTo(cx + tx, ty - 4); x.lineTo(cx + tx, ty + 4); x.stroke();
    }
  }
  x.fillStyle = '#0a0806';
  x.beginPath(); x.ellipse(cx - 9, cy - 6, 7, 6, 0, 0, TAU); x.fill();
  x.beginPath(); x.ellipse(cx + 9, cy - 6, 7, 6, 0, 0, TAU); x.fill();
  x.fillStyle = '#e8a13c';
  x.beginPath(); x.arc(cx - 9, cy - 6, 4.4, 0, TAU); x.fill();
  x.beginPath(); x.arc(cx + 9, cy - 6, 4.4, 0, TAU); x.fill();
  x.fillStyle = '#fff0c0';
  x.beginPath(); x.arc(cx - 9, cy - 6, 1.8, 0, TAU); x.fill();
  x.beginPath(); x.arc(cx + 9, cy - 6, 1.8, 0, TAU); x.fill();
  // wide-brim hat
  x.fillStyle = '#0e0b08';
  x.beginPath(); x.ellipse(cx, cy - 18, 38, 9, 0, 0, TAU); x.fill();
  x.beginPath(); x.ellipse(cx, cy - 29, 19, 14, 0, 0, TAU); x.fill();
}

/* --------------------------- RAYCAST HELPERS ----------------------------- */
// Distance to the first solid wall along a ray (used by hitscan weapons).
function rayWallDist(px, py, dx, dy, maxDist) {
  let mapX = Math.floor(px), mapY = Math.floor(py);
  const deltaX = Math.abs(1 / (dx || 1e-9)), deltaY = Math.abs(1 / (dy || 1e-9));
  let stepX, stepY, sideX, sideY;
  if (dx < 0) { stepX = -1; sideX = (px - mapX) * deltaX; }
  else { stepX = 1; sideX = (mapX + 1 - px) * deltaX; }
  if (dy < 0) { stepY = -1; sideY = (py - mapY) * deltaY; }
  else { stepY = 1; sideY = (mapY + 1 - py) * deltaY; }
  let side = 0;
  for (let i = 0; i < 128; i++) {
    if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
    else { sideY += deltaY; mapY += stepY; side = 1; }
    if (isSolid(mapX, mapY)) {
      const d = side === 0 ? (sideX - deltaX) : (sideY - deltaY);
      return d;
    }
    if ((side === 0 ? sideX : sideY) > maxDist) break;
  }
  return maxDist;
}
