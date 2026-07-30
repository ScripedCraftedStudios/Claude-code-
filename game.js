/* ============================================================================
   HARROW'S END — a small town keeps its harvest
   A cinematic small-town survival horror. October 1986. The fog came at 3 AM.
   Pure canvas + WebAudio. No dependencies. No mercy.
   ========================================================================== */
'use strict';

/* ============================== CANVAS ================================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  VW = window.innerWidth;
  VH = window.innerHeight;
  canvas.width = Math.floor(VW * DPR);
  canvas.height = Math.floor(VH * DPR);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  buildVignette();
  darkC.width = VW; darkC.height = VH;
}
window.addEventListener('resize', resize);

/* ============================== UTILS ==================================== */
const TAU = Math.PI * 2;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

/* ============================== INPUT ==================================== */
const keys = {};
const mouse = { x: 0, y: 0, down: false };

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  initAudio();
  handleKeyPress(e.code);
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', e => {
  if (e.button === 0) mouse.down = true;
  initAudio();
  if (game.state === 'title') startRun();
});
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('blur', () => { if (game.state === 'play') game.paused = true; });

function handleKeyPress(code) {
  if (code === 'KeyM') { audio.muted = !audio.muted; if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.5; }
  if (code === 'KeyF') { try { document.documentElement.requestFullscreen(); } catch (e) {} }

  if (game.state === 'title' && (code === 'Enter' || code === 'Space')) startRun();
  else if (game.state === 'card' && (code === 'Enter' || code === 'Space')) {
    if (game.card.t > 1.2) finishCard();
  }
  else if (game.state === 'play') {
    if (code === 'Escape' || code === 'KeyP') game.paused = !game.paused;
    if (!game.paused) {
      if (code === 'KeyR') startReload();
      if (code === 'Digit1') switchWeapon(0);
      if (code === 'Digit2') switchWeapon(1);
      if (code === 'Digit3') switchWeapon(2);
    }
  }
  else if (game.state === 'dead' && (code === 'Enter' || code === 'Space')) {
    if (game.stateT > 1.5) retryChapter();
  }
  else if (game.state === 'win' && (code === 'Enter' || code === 'Space')) {
    if (game.stateT > 2) startNightmare();
  }
}
window.addEventListener('wheel', e => {
  if (game.state !== 'play' || game.paused) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  let w = player.weapon;
  for (let i = 0; i < 3; i++) {
    w = (w + dir + player.weapons.length) % player.weapons.length;
    if (player.weapons[w].owned) break;
  }
  switchWeapon(w);
});

/* ============================== AUDIO ==================================== */
const audio = { ctx: null, master: null, muted: false, noiseBuf: null, droneOn: false };

function initAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.5;
    audio.master.connect(audio.ctx.destination);
    // Reusable noise buffer
    const len = audio.ctx.sampleRate * 2;
    audio.noiseBuf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const d = audio.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    startAmbience();
  } catch (e) { /* audio unavailable — the town stays silent */ }
}

function noiseSource() {
  const s = audio.ctx.createBufferSource();
  s.buffer = audio.noiseBuf; s.loop = true;
  return s;
}

function startAmbience() {
  if (!audio.ctx || audio.droneOn) return;
  audio.droneOn = true;
  const t = audio.ctx.currentTime;
  // Low dread drone: two detuned saws through a dark lowpass
  const g = audio.ctx.createGain(); g.gain.value = 0.05;
  const lp = audio.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 190;
  const o1 = audio.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 54;
  const o2 = audio.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.7;
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(audio.master);
  o1.start(t); o2.start(t);
  // Breathing swell on the drone
  const lfo = audio.ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = audio.ctx.createGain(); lfoG.gain.value = 0.025;
  lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start(t);
  // Wind: filtered noise, slowly wandering
  const wn = noiseSource();
  const bp = audio.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
  const wg = audio.ctx.createGain(); wg.gain.value = 0.045;
  const wlfo = audio.ctx.createOscillator(); wlfo.frequency.value = 0.11;
  const wlfoG = audio.ctx.createGain(); wlfoG.gain.value = 260;
  wlfo.connect(wlfoG); wlfoG.connect(bp.frequency);
  wn.connect(bp); bp.connect(wg); wg.connect(audio.master);
  wn.start(t); wlfo.start(t);
}

function sfxGain(v, t0, a, d) {
  const g = audio.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0011), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
  g.connect(audio.master);
  return g;
}

function sfxShot(big) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const n = noiseSource();
  const f = audio.ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(big ? 3600 : 2800, t);
  f.frequency.exponentialRampToValueAtTime(180, t + (big ? 0.34 : 0.19));
  const g = sfxGain(big ? 0.85 : 0.6, t, 0.004, big ? 0.4 : 0.22);
  n.connect(f); f.connect(g);
  n.start(t); n.stop(t + 0.6);
  const o = audio.ctx.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(big ? 160 : 220, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.11);
  const og = sfxGain(0.3, t, 0.002, 0.13);
  o.connect(og); o.start(t); o.stop(t + 0.2);
}

function sfxSquelch(heavy) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const n = noiseSource();
  const f = audio.ctx.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.setValueAtTime(rand(300, 600), t);
  f.frequency.exponentialRampToValueAtTime(rand(90, 150), t + 0.16);
  f.Q.value = 1.6;
  const g = sfxGain(heavy ? 0.55 : 0.3, t, 0.005, heavy ? 0.3 : 0.16);
  n.connect(f); f.connect(g);
  n.start(t); n.stop(t + 0.45);
  if (heavy) {
    const o = audio.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.2);
    const og = sfxGain(0.35, t, 0.004, 0.22);
    o.connect(og); o.start(t); o.stop(t + 0.3);
  }
}

function sfxGrowl(pitch) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator(); o.type = 'sawtooth';
  const base = pitch || rand(55, 90);
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(base * rand(0.6, 0.85), t + 0.5);
  const f = audio.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  const wob = audio.ctx.createOscillator(); wob.frequency.value = rand(9, 16);
  const wobG = audio.ctx.createGain(); wobG.gain.value = base * 0.25;
  wob.connect(wobG); wobG.connect(o.frequency);
  const g = sfxGain(0.16, t, 0.08, 0.55);
  o.connect(f); f.connect(g);
  o.start(t); o.stop(t + 0.75); wob.start(t); wob.stop(t + 0.75);
}

function sfxStinger() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  [660, 699, 741, 220].forEach((fr, i) => {
    const o = audio.ctx.createOscillator();
    o.type = i === 3 ? 'sine' : 'sawtooth';
    o.frequency.setValueAtTime(fr, t);
    if (i < 3) o.frequency.linearRampToValueAtTime(fr * 1.04, t + 1.8);
    const g = sfxGain(i === 3 ? 0.4 : 0.07, t, i === 3 ? 0.01 : 0.4, 1.8);
    o.connect(g); o.start(t); o.stop(t + 2.4);
  });
}

function sfxThunder() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const n = noiseSource();
  const f = audio.ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(60, t + 2.2);
  const g = sfxGain(0.5, t, 0.06, 2.4);
  n.connect(f); f.connect(g);
  n.start(t); n.stop(t + 2.8);
}

function sfxHeartbeat() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  [0, 0.18].forEach((off, i) => {
    const o = audio.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(i === 0 ? 62 : 55, t + off);
    o.frequency.exponentialRampToValueAtTime(30, t + off + 0.12);
    const g = sfxGain(i === 0 ? 0.5 : 0.35, t + off, 0.008, 0.14);
    o.connect(g); o.start(t + off); o.stop(t + off + 0.2);
  });
}

function sfxClick() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1900;
  const g = sfxGain(0.09, t, 0.002, 0.03);
  o.connect(g); o.start(t); o.stop(t + 0.05);
}

function sfxReload() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  [0, 0.12].forEach(off => {
    const o = audio.ctx.createOscillator(); o.type = 'square'; o.frequency.value = rand(700, 1100);
    const g = sfxGain(0.12, t + off, 0.003, 0.05);
    o.connect(g); o.start(t + off); o.stop(t + off + 0.08);
  });
}

function sfxPickup() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(420, t);
  o.frequency.linearRampToValueAtTime(640, t + 0.09);
  const g = sfxGain(0.2, t, 0.008, 0.14);
  o.connect(g); o.start(t); o.stop(t + 0.2);
}

function sfxSwing() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const n = noiseSource();
  const f = audio.ctx.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.setValueAtTime(500, t);
  f.frequency.exponentialRampToValueAtTime(2200, t + 0.1);
  f.Q.value = 2;
  const g = sfxGain(0.25, t, 0.01, 0.12);
  n.connect(f); f.connect(g);
  n.start(t); n.stop(t + 0.2);
}

function sfxRoar() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  [40, 47, 61].forEach(fr => {
    const o = audio.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(fr * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(fr, t + 1.2);
    const wob = audio.ctx.createOscillator(); wob.frequency.value = rand(7, 12);
    const wobG = audio.ctx.createGain(); wobG.gain.value = fr * 0.3;
    wob.connect(wobG); wobG.connect(o.frequency);
    const f = audio.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = sfxGain(0.22, t, 0.05, 1.5);
    o.connect(f); f.connect(g);
    o.start(t); o.stop(t + 1.8); wob.start(t); wob.stop(t + 1.8);
  });
}

/* ============================== WORLD ==================================== */
const WORLD_W = 3200, WORLD_H = 2400;
const groundC = document.createElement('canvas');
const decalC = document.createElement('canvas');
groundC.width = WORLD_W; groundC.height = WORLD_H;
decalC.width = WORLD_W; decalC.height = WORLD_H;
const gctx = groundC.getContext('2d');
const dctx = decalC.getContext('2d');

const darkC = document.createElement('canvas');
const darkCtx = darkC.getContext('2d');

const grainC = document.createElement('canvas');
grainC.width = 160; grainC.height = 100;
const grainCtx = grainC.getContext('2d');
let grainFrame = 0;

let vignetteC = null;
function buildVignette() {
  vignetteC = document.createElement('canvas');
  vignetteC.width = VW; vignetteC.height = VH;
  const vc = vignetteC.getContext('2d');
  const g = vc.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.32, VW / 2, VH / 2, Math.max(VW, VH) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.62)');
  vc.fillStyle = g;
  vc.fillRect(0, 0, VW, VH);
}

// Fog puff sprite
const fogSprite = document.createElement('canvas');
fogSprite.width = 256; fogSprite.height = 256;
{
  const fc = fogSprite.getContext('2d');
  const g = fc.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(185,196,214,0.55)');
  g.addColorStop(0.6, 'rgba(170,182,202,0.22)');
  g.addColorStop(1, 'rgba(160,172,195,0)');
  fc.fillStyle = g;
  fc.fillRect(0, 0, 256, 256);
}

// Screen blood splat sprite (for player damage overlay)
const splatSprite = document.createElement('canvas');
splatSprite.width = 200; splatSprite.height = 200;
{
  const sc = splatSprite.getContext('2d');
  sc.fillStyle = '#5e0a0d';
  for (let i = 0; i < 26; i++) {
    const a = rand(TAU), r = rand(10, 75), s = rand(3, i < 4 ? 40 : 14);
    sc.globalAlpha = rand(0.5, 0.95);
    sc.beginPath();
    sc.ellipse(100 + Math.cos(a) * r * 0.6, 100 + Math.sin(a) * r * 0.6, s, s * rand(0.6, 1), rand(TAU), 0, TAU);
    sc.fill();
  }
}

const colliders = [];   // {x,y,w,h} rects
const treeColliders = []; // {x,y,r}
const lamps = [];       // {x,y,phase,dying}
const drains = [];      // spawn points {x,y}
const buildings = [];   // visual info
const props = [];       // misc drawables sorted with entities {x,y,baseY,draw}
const fogPuffs = [];
const edgeSpawns = [];

const ROAD_Y = 1200, ROAD_HW = 130;   // main street horizontal
const ROAD_X = 1600, ROAD_VW = 110;   // cross street vertical

function buildWorld() {
  colliders.length = 0; treeColliders.length = 0; lamps.length = 0;
  drains.length = 0; buildings.length = 0; props.length = 0; fogPuffs.length = 0;
  edgeSpawns.length = 0;
  dctx.clearRect(0, 0, WORLD_W, WORLD_H);
  paintGround();
  placeTown();
  for (let i = 0; i < 60; i++) {
    fogPuffs.push({
      x: rand(WORLD_W), y: rand(WORLD_H),
      vx: rand(6, 20), size: rand(160, 420), alpha: rand(0.10, 0.3), wob: rand(TAU)
    });
  }
}

function paintGround() {
  // Dead october grass
  gctx.fillStyle = '#161d13';
  gctx.fillRect(0, 0, WORLD_W, WORLD_H);
  for (let i = 0; i < 9000; i++) {
    gctx.fillStyle = pick(['#121810', '#1b2317', '#1e2415', '#141b11']);
    gctx.fillRect(rand(WORLD_W), rand(WORLD_H), rand(2, 6), rand(2, 6));
  }
  // Fallen leaves
  for (let i = 0; i < 900; i++) {
    gctx.fillStyle = pick(['#4a3417', '#57320f', '#3d2c12', '#5e4318']);
    gctx.globalAlpha = rand(0.3, 0.8);
    gctx.beginPath();
    gctx.ellipse(rand(WORLD_W), rand(WORLD_H), rand(2, 5), rand(1, 3), rand(TAU), 0, TAU);
    gctx.fill();
  }
  gctx.globalAlpha = 1;

  // Cornfields on east & west fringes — rows of stalks
  [[0, 340], [WORLD_W - 340, WORLD_W]].forEach(([x0, x1]) => {
    for (let x = x0 + 20; x < x1 - 10; x += 26) {
      for (let y = 40; y < WORLD_H - 40; y += 18) {
        if (Math.abs(y - ROAD_Y) < ROAD_HW + 60) continue;
        gctx.strokeStyle = pick(['#57511f', '#4a4419', '#635a24']);
        gctx.globalAlpha = rand(0.5, 0.9);
        gctx.lineWidth = rand(1.5, 3);
        gctx.beginPath();
        const wx = x + rand(-6, 6), wy = y + rand(-5, 5);
        gctx.moveTo(wx, wy + 8);
        gctx.lineTo(wx + rand(-4, 4), wy - rand(6, 14));
        gctx.stroke();
      }
    }
  });
  gctx.globalAlpha = 1;

  // Roads
  const paintRoad = (x, y, w, h) => {
    gctx.fillStyle = '#1f2126';
    gctx.fillRect(x, y, w, h);
    for (let i = 0; i < (w * h) / 900; i++) {
      gctx.fillStyle = pick(['#24262c', '#1a1c21', '#26282e']);
      gctx.fillRect(x + rand(w), y + rand(h), rand(2, 7), rand(2, 7));
    }
  };
  paintRoad(0, ROAD_Y - ROAD_HW, WORLD_W, ROAD_HW * 2);
  paintRoad(ROAD_X - ROAD_VW, 0, ROAD_VW * 2, WORLD_H);

  // Sidewalks
  gctx.fillStyle = '#33363c';
  gctx.fillRect(0, ROAD_Y - ROAD_HW - 42, WORLD_W, 42);
  gctx.fillRect(0, ROAD_Y + ROAD_HW, WORLD_W, 42);
  gctx.fillRect(ROAD_X - ROAD_VW - 42, 0, 42, WORLD_H);
  gctx.fillRect(ROAD_X + ROAD_VW, 0, 42, WORLD_H);
  // Sidewalk seams
  gctx.strokeStyle = 'rgba(0,0,0,0.35)'; gctx.lineWidth = 2;
  for (let x = 0; x < WORLD_W; x += 90) {
    gctx.beginPath(); gctx.moveTo(x, ROAD_Y - ROAD_HW - 42); gctx.lineTo(x, ROAD_Y - ROAD_HW); gctx.stroke();
    gctx.beginPath(); gctx.moveTo(x, ROAD_Y + ROAD_HW); gctx.lineTo(x, ROAD_Y + ROAD_HW + 42); gctx.stroke();
  }
  for (let y = 0; y < WORLD_H; y += 90) {
    gctx.beginPath(); gctx.moveTo(ROAD_X - ROAD_VW - 42, y); gctx.lineTo(ROAD_X - ROAD_VW, y); gctx.stroke();
    gctx.beginPath(); gctx.moveTo(ROAD_X + ROAD_VW, y); gctx.lineTo(ROAD_X + ROAD_VW + 42, y); gctx.stroke();
  }

  // Faded center lines
  gctx.fillStyle = 'rgba(160,150,80,0.4)';
  for (let x = 20; x < WORLD_W; x += 80) {
    if (Math.abs(x - ROAD_X) < ROAD_VW + 20) continue;
    gctx.fillRect(x, ROAD_Y - 4, 42, 8);
  }
  for (let y = 20; y < WORLD_H; y += 80) {
    if (Math.abs(y - ROAD_Y) < ROAD_HW + 20) continue;
    gctx.fillRect(ROAD_X - 4, y, 8, 42);
  }

  // Cracks & oil stains
  gctx.strokeStyle = 'rgba(0,0,0,0.45)';
  for (let i = 0; i < 40; i++) {
    const onH = Math.random() < 0.6;
    let cx = onH ? rand(WORLD_W) : ROAD_X + rand(-ROAD_VW, ROAD_VW);
    let cy = onH ? ROAD_Y + rand(-ROAD_HW, ROAD_HW) : rand(WORLD_H);
    gctx.lineWidth = rand(1, 2.5);
    gctx.beginPath(); gctx.moveTo(cx, cy);
    for (let s = 0; s < 6; s++) { cx += rand(-30, 30); cy += rand(-30, 30); gctx.lineTo(cx, cy); }
    gctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    gctx.fillStyle = 'rgba(5,5,8,0.5)';
    const ox = rand(WORLD_W), oy = ROAD_Y + rand(-ROAD_HW + 20, ROAD_HW - 20);
    gctx.beginPath(); gctx.ellipse(ox, oy, rand(15, 45), rand(10, 25), rand(TAU), 0, TAU); gctx.fill();
  }
}

function addBuilding(x, y, w, h, name, sign) {
  colliders.push({ x, y, w, h });
  buildings.push({ x, y, w, h, name, sign, windows: makeWindows(w, h) });
  props.push({ x, y, baseY: y + h, kind: 'building', b: buildings[buildings.length - 1] });
}
function makeWindows(w, h) {
  const out = [];
  const cols = Math.max(1, Math.floor(w / 90)), rows = Math.max(1, Math.floor(h / 110));
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if (Math.random() < 0.45) continue;
    out.push({
      x: (c + 0.5) * (w / cols) - 14, y: (r + 0.5) * (h / rows) - 16,
      lit: Math.random() < 0.22, flicker: Math.random() < 0.3, phase: rand(TAU)
    });
  }
  return out;
}

function placeTown() {
  // North side of Main Street
  addBuilding(420, 760, 320, 280, "BARLOW'S GROCERY", true);
  addBuilding(820, 800, 260, 240, 'PHARMACY', true);
  addBuilding(1160, 770, 300, 270, 'MAINE DINER', true);
  addBuilding(1780, 780, 340, 260, 'HARDWARE', true);
  addBuilding(2220, 750, 300, 290, 'BOOKS & NEWS', true);
  addBuilding(2620, 800, 280, 240, 'BARBER', true);
  // South side
  addBuilding(460, 1380, 300, 260, 'LAUNDROMAT', true);
  addBuilding(880, 1400, 320, 280, 'TOWN HALL', true);
  addBuilding(1280, 1390, 260, 250, 'POST OFFICE', true);
  addBuilding(1800, 1400, 320, 270, "GEDNEY'S TAVERN", true);
  addBuilding(2240, 1380, 300, 300, 'SHERIFF', true);
  addBuilding(2640, 1420, 280, 240, 'MOTEL', true);
  // Church at the top of the cross street
  addBuilding(1440, 120, 320, 300, 'FIRST CHURCH', false);
  buildings[buildings.length - 1].church = true;
  // Scattered houses
  addBuilding(500, 240, 260, 200, '', false);
  addBuilding(980, 200, 240, 220, '', false);
  addBuilding(2100, 220, 260, 210, '', false);
  addBuilding(2560, 260, 240, 200, '', false);
  addBuilding(560, 1880, 260, 220, '', false);
  addBuilding(1060, 1920, 240, 200, '', false);
  addBuilding(1900, 1900, 260, 220, '', false);
  addBuilding(2420, 1880, 250, 210, '', false);

  // Trees
  const treeSpots = [
    [380, 560], [760, 620], [1620, 560], [2020, 600], [2480, 560], [2900, 700],
    [400, 1720], [860, 1760], [1420, 1780], [2100, 1740], [2760, 1720],
    [700, 2100], [1500, 2160], [2200, 2120], [2820, 2060],
    [900, 480], [1900, 480], [2800, 400], [420, 2000]
  ];
  treeSpots.forEach(([x, y]) => {
    if (insideAnyCollider(x, y, 60)) return;
    treeColliders.push({ x, y, r: 20 });
    props.push({ x, y, baseY: y + 14, kind: 'tree', seed: rand(TAU), size: rand(38, 60) });
  });

  // Abandoned cars on Main Street
  const carSpots = [
    [640, ROAD_Y - 70, 0], [1340, ROAD_Y + 66, Math.PI], [1980, ROAD_Y - 62, 0.1],
    [2460, ROAD_Y + 72, Math.PI - 0.08], [ROAD_X - 60, 620, Math.PI / 2], [ROAD_X + 58, 1780, -Math.PI / 2]
  ];
  carSpots.forEach(([x, y, a]) => {
    const w = 110, h = 52;
    colliders.push({ x: x - w / 2, y: y - h / 2, w, h });
    props.push({ x, y, baseY: y + h / 2, kind: 'car', a, tone: pick(['#3a3c48', '#4a3038', '#32424a', '#46442e']) });
  });

  // Street lamps
  for (let x = 300; x < WORLD_W - 200; x += 380) {
    lamps.push({ x, y: ROAD_Y - ROAD_HW - 60, phase: rand(TAU), dying: Math.random() < 0.3 });
    lamps.push({ x: x + 190, y: ROAD_Y + ROAD_HW + 60, phase: rand(TAU), dying: Math.random() < 0.3 });
  }
  for (let y = 340; y < WORLD_H - 200; y += 420) {
    if (Math.abs(y - ROAD_Y) < 200) continue;
    lamps.push({ x: ROAD_X - ROAD_VW - 60, y, phase: rand(TAU), dying: Math.random() < 0.3 });
  }
  lamps.forEach(l => props.push({ x: l.x, y: l.y, baseY: l.y + 6, kind: 'lamp', l }));

  // Sewer drains — where they come from
  [[900, ROAD_Y + 90], [1350, ROAD_Y - 95], [2050, ROAD_Y + 95], [2550, ROAD_Y - 90],
   [ROAD_X + 70, 700], [ROAD_X - 70, 1800]].forEach(([x, y]) => {
    drains.push({ x, y, pulse: rand(TAU) });
    gctx.fillStyle = '#0c0d10';
    gctx.beginPath(); gctx.ellipse(x, y, 26, 16, 0, 0, TAU); gctx.fill();
    gctx.strokeStyle = '#3c4046'; gctx.lineWidth = 3;
    gctx.beginPath(); gctx.ellipse(x, y, 26, 16, 0, 0, TAU); gctx.stroke();
    gctx.strokeStyle = '#26282e'; gctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      gctx.beginPath(); gctx.moveTo(x + i * 8, y - 12); gctx.lineTo(x + i * 8, y + 12); gctx.stroke();
    }
  });

  // Missing posters on lamp posts
  lamps.forEach(l => {
    if (Math.random() < 0.35) props.push({ x: l.x + 14, y: l.y + 2, baseY: l.y + 5, kind: 'poster' });
  });

  // Fire hydrants
  [[760, ROAD_Y - ROAD_HW - 24], [2320, ROAD_Y + ROAD_HW + 26]].forEach(([x, y]) => {
    props.push({ x, y, baseY: y + 8, kind: 'hydrant' });
  });

  // Edge spawn points (road mouths + field edges)
  edgeSpawns.push(
    { x: 60, y: ROAD_Y }, { x: WORLD_W - 60, y: ROAD_Y },
    { x: ROAD_X, y: 60 }, { x: ROAD_X, y: WORLD_H - 60 },
    { x: 200, y: 500 }, { x: WORLD_W - 200, y: 600 },
    { x: 260, y: 1900 }, { x: WORLD_W - 240, y: 1850 }
  );
}

function insideAnyCollider(x, y, pad) {
  pad = pad || 0;
  for (const c of colliders) {
    if (x > c.x - pad && x < c.x + c.w + pad && y > c.y - pad && y < c.y + c.h + pad) return true;
  }
  return false;
}

function resolveCircle(e) {
  // Rect colliders
  for (const c of colliders) {
    const nx = clamp(e.x, c.x, c.x + c.w);
    const ny = clamp(e.y, c.y, c.y + c.h);
    const dx = e.x - nx, dy = e.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < e.r * e.r) {
      const d = Math.sqrt(d2) || 0.001;
      const push = (e.r - d) / d;
      e.x += dx * push; e.y += dy * push;
      e.blocked = true;
    }
  }
  // Tree trunks
  for (const t of treeColliders) {
    const dx = e.x - t.x, dy = e.y - t.y;
    const rr = e.r + t.r;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      e.x += dx / d * (rr - d); e.y += dy / d * (rr - d);
      e.blocked = true;
    }
  }
  e.x = clamp(e.x, 30, WORLD_W - 30);
  e.y = clamp(e.y, 30, WORLD_H - 30);
}

/* ============================== GAME STATE =============================== */
const game = {
  state: 'title', stateT: 0, paused: false,
  time: 0, timeScale: 1, slowmoT: 0,
  chapter: 0, quotaLeft: 0,
  kills: 0, gibs: 0, shots: 0, runTime: 0,
  card: null, endless: false, nightmareLevel: 0,
  lightning: 0, nextLightning: rand(8, 20),
  hint: 0, fadeOut: 0, chapterDone: false,
  balloon: null, nextBalloon: rand(30, 70),
  heartbeatT: 0, growlT: rand(3, 7)
};

const cam = { x: 0, y: 0, trauma: 0 };

const player = {
  x: ROAD_X - 40, y: ROAD_Y + 40, r: 13, aim: 0,
  hp: 100, maxHp: 100, stamina: 100, staminaWait: 0,
  speed: 220, sprint: 335,
  weapon: 0, fireCd: 0, reloadT: 0, reloading: false,
  swing: 0, hurtFlash: 0, dead: false, deadT: 0,
  moving: 0, walkPhase: 0, muzzle: 0,
  weapons: [
    { name: "DAD'S COLT", type: 'revolver', owned: true, dmg: 34, rate: 0.34, mag: 6, ammo: 6, reserve: 42, reload: 1.6, spread: 0.035, knock: 140, pellets: 1 },
    { name: "BARLOW'S 12-GAUGE", type: 'shotgun', owned: false, dmg: 13, rate: 0.85, mag: 6, ammo: 0, reserve: 0, reload: 0.55, spread: 0.24, knock: 320, pellets: 8 },
    { name: 'FIRE AXE', type: 'axe', owned: true, dmg: 85, rate: 0.55, range: 82, arc: 2.3, knock: 380 }
  ]
};

const enemies = [];
const bullets = [];
const particles = [];
const gibs = [];
const pickups = [];
const acidPools = [];
const screenSplats = [];
const glowPoints = [];
let boss = null;
let multiKill = { t: 0, n: 0 };

/* ============================== CHAPTERS ================================= */
const CHAPTERS = [
  {
    num: 'CHAPTER ONE', title: 'THE FOG COMES', quota: 14, fog: 1.0, maxAlive: 6, interval: 2.3,
    types: [['shambler', 1]],
    text: "October 12th, 1986. The fog rolled off Miller's Pond at 3:11 AM, thick as wet wool. By 3:15 the phones were dead. By 3:20 the screaming started.\n\nSheriff Dana Pruitt loaded the revolver her father left her, picked up the flashlight, and stepped out onto Main Street."
  },
  {
    num: 'CHAPTER TWO', title: 'THE CRAWLING KIND', quota: 22, fog: 0.92, maxAlive: 9, interval: 1.8,
    types: [['shambler', 0.68], ['crawler', 0.32]],
    text: "They used to be neighbors. Ed from the hardware store. The Kowalski twins. Now they moved wrong — low to the ground, fast, like things remembering how to be animals.\n\nSomebody had left Barlow's twelve-gauge in a duffel bag on the sidewalk. Dana didn't ask questions anymore."
  },
  {
    num: 'CHAPTER THREE', title: 'WHAT THE DRAINS KEEP', quota: 30, fog: 0.85, maxAlive: 12, interval: 1.5,
    types: [['shambler', 0.55], ['crawler', 0.3], ['bloater', 0.15]],
    text: "The drains had been whispering all summer. Old Tom Gedney said the town was built on something's mouth, and everyone laughed and bought him another beer.\n\nNobody laughed at Old Tom anymore. Some of the things coming up now were swollen with what they'd swallowed."
  },
  {
    num: 'CHAPTER FOUR', title: 'THE CONGREGATION', quota: 42, fog: 0.8, maxAlive: 17, interval: 1.0,
    types: [['shambler', 0.5], ['crawler', 0.34], ['bloater', 0.16]],
    text: "They came all at once then, shoulder to shoulder down Main Street like a congregation let out of some terrible church. The fog parted for them. It was polite that way.\n\nDana counted her shells and thought about her father's voice: 'Stand your ground, kiddo. A town is worth standing for.'"
  },
  {
    num: 'CHAPTER FIVE', title: 'THE HARVEST MAN', quota: Infinity, fog: 0.75, maxAlive: 5, interval: 4.5, boss: true,
    types: [['crawler', 0.6], ['shambler', 0.4]],
    text: "And behind them all, taller than the streetlights, wearing a smile with too many teeth in it and none of them kind, the Harvest Man came up Main Street to collect what Harrow's End owed.\n\nEvery small town keeps a harvest. Tonight the harvest fought back."
  }
];

const EPILOGUE = "The fog lifted at dawn, the way it always does.\n\nThe town would bury its dead, repaint its doors, and never speak of it again. That's the thing about small towns in Maine. They keep their secrets.\n\nAnd their secrets keep them.";

/* ============================== FLOW ===================================== */
function startRun() {
  game.kills = 0; game.gibs = 0; game.shots = 0; game.runTime = 0;
  game.endless = false; game.nightmareLevel = 0;
  resetPlayer(true);
  buildWorld();
  showCard(0);
}

function resetPlayer(full) {
  player.x = ROAD_X - 40; player.y = ROAD_Y + 40;
  player.hp = player.maxHp; player.stamina = 100;
  player.dead = false; player.deadT = 0; player.hurtFlash = 0;
  player.reloading = false; player.fireCd = 0; player.swing = 0;
  if (full) {
    player.weapon = 0;
    player.weapons[0].owned = true; player.weapons[0].ammo = 6; player.weapons[0].reserve = 42;
    player.weapons[1].owned = false; player.weapons[1].ammo = 0; player.weapons[1].reserve = 0;
  } else {
    const w0 = player.weapons[0];
    w0.ammo = w0.mag; w0.reserve = Math.max(w0.reserve, 30);
    const w1 = player.weapons[1];
    if (w1.owned) { w1.ammo = w1.mag; w1.reserve = Math.max(w1.reserve, 10); }
  }
}

function showCard(chapterIdx) {
  game.chapter = chapterIdx;
  game.state = 'card'; game.stateT = 0;
  const ch = CHAPTERS[chapterIdx];
  game.card = { t: 0, num: ch.num, title: ch.title, text: ch.text, chars: 0 };
  sfxStinger();
}

function finishCard() {
  const ch = CHAPTERS[game.chapter];
  game.state = 'play'; game.stateT = 0; game.paused = false;
  game.quotaLeft = ch.quota;
  game.chapterDone = false; game.fadeOut = 0;
  enemies.length = 0; bullets.length = 0; pickups.length = 0; acidPools.length = 0;
  boss = null;
  director.timer = 1.2;
  if (game.chapter === 0 && !game.endless) game.hint = 9;
  // Supply drop near the player
  dropSupplies();
  if (game.chapter === 1 && !player.weapons[1].owned) {
    spawnPickup(player.x + rand(-80, 80), player.y + rand(60, 120), 'shotgun');
  }
  if (ch.boss) spawnBoss();
}

function dropSupplies() {
  for (let i = 0; i < 2; i++) spawnPickup(player.x + rand(-140, 140), player.y + rand(-140, 140), Math.random() < 0.5 ? 'ammoR' : 'ammoS');
  spawnPickup(player.x + rand(-140, 140), player.y + rand(-140, 140), 'medkit');
}

function chapterComplete() {
  game.chapterDone = true;
  game.fadeOut = 0;
}

function retryChapter() {
  resetPlayer(false);
  buildWorld();
  enemies.length = 0; bullets.length = 0; particles.length = 0; gibs.length = 0;
  if (game.endless) startNightmare();
  else showCard(game.chapter);
}

function startNightmare() {
  game.endless = true; game.nightmareLevel = 0;
  game.kills = 0; game.gibs = 0; game.shots = 0; game.runTime = 0;
  resetPlayer(false);
  player.weapons[1].owned = true;
  player.weapons[1].ammo = 6; player.weapons[1].reserve = Math.max(player.weapons[1].reserve, 16);
  buildWorld();
  game.state = 'card'; game.stateT = 0;
  game.chapter = 3; // congregation-tier spawn table, scaled up over time
  game.card = {
    t: 0, num: 'NIGHTMARE SHIFT', title: 'NO DAWN COMES',
    text: "There is another Harrow's End, under the one you saved. In that town the fog never lifts and the drains never empty.\n\nHold Main Street as long as you can. It only ends one way. It always did.",
    chars: 0
  };
  sfxStinger();
}

/* ============================== SPAWNING ================================= */
const director = { timer: 2 };

function pickSpawnPoint() {
  const pts = [];
  for (const d of drains) pts.push({ x: d.x, y: d.y, drain: true });
  for (const e of edgeSpawns) pts.push({ x: e.x, y: e.y, drain: false });
  const good = pts.filter(p => {
    const d = dist(p.x, p.y, player.x, player.y);
    return d > 380 && d < 1100;
  });
  return pick(good.length ? good : pts);
}

function pickType(types) {
  let r = Math.random(), acc = 0;
  for (const [t, w] of types) { acc += w; if (r <= acc) return t; }
  return types[0][0];
}

function spawnEnemy(type, x, y, fromDrain) {
  const e = {
    type, x, y, vx: 0, vy: 0,
    spawnT: fromDrain ? 0 : 1,
    attackCd: rand(0.4, 1), hitFlash: 0, wanderA: rand(TAU), wanderT: 0,
    lungeT: 0, blocked: false, seed: rand(TAU), stainSeed: rand(1000)
  };
  if (type === 'shambler') {
    e.hp = 60; e.maxHp = 60; e.r = 13; e.speed = rand(52, 78); e.dmg = 12;
    e.tone = pick(['#2c2833', '#332a28', '#28302e', '#31292f']);
  } else if (type === 'crawler') {
    e.hp = 40; e.maxHp = 40; e.r = 11; e.speed = rand(150, 190); e.dmg = 9;
    e.tone = pick(['#332f28', '#2c3328', '#38302a']);
  } else if (type === 'bloater') {
    e.hp = 220; e.maxHp = 220; e.r = 22; e.speed = rand(36, 48); e.dmg = 24;
    e.tone = '#3a4430';
  }
  if (game.endless) {
    const s = 1 + game.nightmareLevel * 0.06;
    e.hp *= s; e.maxHp *= s; e.speed *= Math.min(1.35, 1 + game.nightmareLevel * 0.02);
  }
  enemies.push(e);
  if (fromDrain) {
    spawnBloodBurst(x, y, rand(TAU), 8, 0.6);
    if (Math.random() < 0.5) sfxGrowl();
  }
  return e;
}

function spawnBoss() {
  boss = {
    type: 'boss', x: ROAD_X, y: 300, r: 34, hp: 3200, maxHp: 3200,
    vx: 0, vy: 0, speed: 88, state: 'walk', stateT: 0,
    attackCd: 2, chargeDir: 0, staggerT: 0, phase: 0,
    hitFlash: 0, seed: rand(TAU), spawnT: 0, blocked: false
  };
  game.lightning = 0.4;
  sfxThunder(); sfxRoar();
  cam.trauma = Math.min(1, cam.trauma + 0.6);
}

function spawnPickup(x, y, kind) {
  x = clamp(x, 60, WORLD_W - 60); y = clamp(y, 60, WORLD_H - 60);
  let tries = 0;
  while (insideAnyCollider(x, y, 20) && tries++ < 12) { x += rand(-90, 90); y += rand(-90, 90); }
  pickups.push({ x, y, kind, bob: rand(TAU) });
}

/* ============================== GORE ===================================== */
const BLOOD_COLORS = ['#7a1013', '#8f1418', '#5e0a0d', '#a01a1a', '#6b0f12'];

function spawnBloodBurst(x, y, dir, n, spread) {
  spread = spread === undefined ? 0.9 : spread;
  for (let i = 0; i < n; i++) {
    if (particles.length > 700) break;
    const a = dir + rand(-spread, spread);
    const sp = rand(40, 340);
    particles.push({
      kind: 'blood', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      z: rand(2, 14), vz: rand(30, 130),
      life: rand(0.3, 0.9), size: rand(1.5, 4.5),
      color: pick(BLOOD_COLORS)
    });
  }
}

function spawnBrass(x, y, dir) {
  if (particles.length > 700) return;
  const a = dir + Math.PI / 2 + rand(-0.4, 0.4);
  particles.push({
    kind: 'brass', x, y,
    vx: Math.cos(a) * rand(60, 130), vy: Math.sin(a) * rand(60, 130),
    z: 10, vz: rand(80, 150), life: 1.2, size: 2.4, color: '#b99b46'
  });
}

function spawnGibs(x, y, dir, n) {
  for (let i = 0; i < n; i++) {
    if (gibs.length > 90) break;
    const a = dir + rand(-1.3, 1.3);
    const sp = rand(80, 380);
    const kind = Math.random() < 0.22 ? 'bone' : 'chunk';
    gibs.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      z: rand(4, 18), vz: rand(90, 260),
      rot: rand(TAU), vrot: rand(-9, 9),
      size: kind === 'bone' ? rand(5, 9) : rand(3.5, 8),
      kind, color: kind === 'bone' ? '#cfc4ad' : pick(['#7a1013', '#651014', '#8a2020', '#57231f'])
    });
  }
}

function stampPool(x, y, r) {
  dctx.save();
  dctx.translate(x, y);
  for (let i = 0; i < 7; i++) {
    dctx.fillStyle = pick(BLOOD_COLORS);
    dctx.globalAlpha = rand(0.35, 0.7);
    const a = rand(TAU), d = rand(0, r * 0.5);
    dctx.beginPath();
    dctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, rand(r * 0.4, r), rand(r * 0.25, r * 0.6), rand(TAU), 0, TAU);
    dctx.fill();
  }
  dctx.restore();
}

function stampSplat(x, y, size) {
  dctx.fillStyle = pick(BLOOD_COLORS);
  dctx.globalAlpha = rand(0.4, 0.85);
  dctx.beginPath();
  dctx.ellipse(x, y, size * rand(0.7, 1.4), size * rand(0.5, 1), rand(TAU), 0, TAU);
  dctx.fill();
  dctx.globalAlpha = 1;
}

function stampCorpse(e, dir) {
  const a = dir + rand(-0.5, 0.5);
  stampPool(e.x, e.y, e.r * rand(1.6, 2.4));
  dctx.save();
  dctx.translate(e.x, e.y);
  dctx.rotate(a);
  // Sprawled body
  dctx.fillStyle = e.tone || '#2c2833';
  dctx.globalAlpha = 0.95;
  dctx.beginPath();
  dctx.ellipse(0, 0, e.r * 1.5, e.r * 0.75, 0, 0, TAU);
  dctx.fill();
  // Limbs flung out
  dctx.strokeStyle = e.tone || '#2c2833';
  dctx.lineWidth = 4.5; dctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const la = rand(TAU), ll = e.r * rand(0.9, 1.5);
    dctx.beginPath(); dctx.moveTo(rand(-4, 4), rand(-4, 4));
    dctx.lineTo(Math.cos(la) * ll, Math.sin(la) * ll); dctx.stroke();
  }
  // Pale head
  dctx.fillStyle = '#9aa08e';
  dctx.beginPath();
  dctx.arc(e.r * 1.35, rand(-4, 4), e.r * 0.45, 0, TAU);
  dctx.fill();
  dctx.restore();
  dctx.globalAlpha = 1;
}

function stampGib(g) {
  dctx.save();
  dctx.translate(g.x, g.y);
  dctx.rotate(g.rot);
  dctx.globalAlpha = 0.9;
  dctx.fillStyle = g.color;
  if (g.kind === 'bone') {
    dctx.fillRect(-g.size, -g.size * 0.22, g.size * 2, g.size * 0.44);
    dctx.beginPath(); dctx.arc(-g.size, 0, g.size * 0.3, 0, TAU); dctx.fill();
    dctx.beginPath(); dctx.arc(g.size, 0, g.size * 0.3, 0, TAU); dctx.fill();
  } else {
    dctx.beginPath();
    dctx.moveTo(-g.size, 0);
    dctx.lineTo(-g.size * 0.2, -g.size * 0.9);
    dctx.lineTo(g.size, -g.size * 0.15);
    dctx.lineTo(g.size * 0.4, g.size * 0.8);
    dctx.closePath(); dctx.fill();
  }
  dctx.restore();
  dctx.globalAlpha = 1;
  stampSplat(g.x + rand(-4, 4), g.y + rand(-4, 4), g.size * 1.2);
}

function addScreenSplat() {
  screenSplats.push({
    x: rand(VW * 0.1, VW * 0.9), y: rand(VH * 0.1, VH * 0.9),
    size: rand(70, 190), rot: rand(TAU), alpha: rand(0.35, 0.55)
  });
  if (screenSplats.length > 8) screenSplats.shift();
}

/* ============================== COMBAT =================================== */
function switchWeapon(i) {
  if (!player.weapons[i] || !player.weapons[i].owned || i === player.weapon) return;
  player.weapon = i; player.reloading = false; player.reloadT = 0;
  sfxReload();
}

function startReload() {
  const w = player.weapons[player.weapon];
  if (w.type === 'axe' || player.reloading) return;
  if (w.ammo >= w.mag || w.reserve <= 0) return;
  player.reloading = true;
  player.reloadT = w.reload;
  sfxReload();
}

function tryFire() {
  const w = player.weapons[player.weapon];
  if (player.fireCd > 0) return;

  if (w.type === 'axe') {
    player.fireCd = w.rate;
    player.swing = 0.22;
    sfxSwing();
    let hitAny = false;
    const targets = boss ? enemies.concat([boss]) : enemies;
    for (const e of targets) {
      if (e.hp <= 0) continue;
      const d = dist(player.x, player.y, e.x, e.y);
      if (d < w.range + e.r && Math.abs(angDiff(player.aim, angleTo(player.x, player.y, e.x, e.y))) < w.arc / 2) {
        hitAny = true;
        damageEnemy(e, w.dmg, angleTo(player.x, player.y, e.x, e.y), w.knock, true);
      }
    }
    if (hitAny) cam.trauma = Math.min(1, cam.trauma + 0.25);
    return;
  }

  if (player.reloading) {
    // Pumping shells one at a time — firing interrupts the reload
    if (w.type === 'shotgun' && w.ammo > 0) { player.reloading = false; player.reloadT = 0; }
    else return;
  }
  if (w.ammo <= 0) {
    sfxClick();
    player.fireCd = 0.3;
    if (w.reserve > 0) startReload();
    return;
  }

  w.ammo--;
  game.shots++;
  player.fireCd = w.rate;
  player.muzzle = 0.07;
  const big = w.type === 'shotgun';
  sfxShot(big);
  cam.trauma = Math.min(1, cam.trauma + (big ? 0.45 : 0.22));
  const mx = player.x + Math.cos(player.aim) * 20;
  const my = player.y + Math.sin(player.aim) * 20;
  spawnBrass(mx, my, player.aim);
  for (let i = 0; i < w.pellets; i++) {
    const a = player.aim + rand(-w.spread, w.spread);
    bullets.push({
      x: mx, y: my,
      vx: Math.cos(a) * 1250, vy: Math.sin(a) * 1250,
      dmg: w.dmg, knock: w.knock, life: 0.7, shotgun: big
    });
  }
  // Recoil
  player.x -= Math.cos(player.aim) * (big ? 6 : 2.5);
  player.y -= Math.sin(player.aim) * (big ? 6 : 2.5);
}

function damageEnemy(e, dmg, dir, knock, melee) {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  e.hitFlash = 0.12;
  const isBoss = e === boss;
  const staggerScale = isBoss ? 0.06 : 1;
  e.vx += Math.cos(dir) * knock * staggerScale * (melee ? 1.4 : 1);
  e.vy += Math.sin(dir) * knock * staggerScale * (melee ? 1.4 : 1);
  spawnBloodBurst(e.x + Math.cos(dir) * e.r * 0.5, e.y + Math.sin(dir) * e.r * 0.5, dir, melee ? 14 : 9, 0.7);
  stampSplat(e.x + Math.cos(dir) * rand(10, 40), e.y + Math.sin(dir) * rand(10, 40), rand(3, 8));
  sfxSquelch(false);
  if (e.hp <= 0) {
    if (isBoss) killBoss(dir);
    else killEnemy(e, dir, dmg, melee);
  }
}

function killEnemy(e, dir, overkillDmg, melee) {
  game.kills++;
  if (!CHAPTERS[game.chapter].boss || game.endless) game.quotaLeft--;
  const gib = melee || overkillDmg > 45 || e.type === 'bloater' || Math.random() < 0.25;
  sfxSquelch(true);
  cam.trauma = Math.min(1, cam.trauma + 0.15);

  if (e.type === 'bloater') {
    // Detonation: gore fountain + acid
    spawnBloodBurst(e.x, e.y, dir, 60, Math.PI);
    spawnGibs(e.x, e.y, dir, 14);
    stampPool(e.x, e.y, e.r * 3);
    acidPools.push({ x: e.x, y: e.y, r: 60, life: 7 });
    game.gibs++;
    cam.trauma = Math.min(1, cam.trauma + 0.4);
    const pd = dist(player.x, player.y, e.x, e.y);
    if (pd < 90) hurtPlayer(18, angleTo(e.x, e.y, player.x, player.y));
    for (const o of enemies) {
      if (o !== e && o.hp > 0 && dist(o.x, o.y, e.x, e.y) < 80) damageEnemy(o, 60, angleTo(e.x, e.y, o.x, o.y), 200, false);
    }
  } else if (gib) {
    spawnBloodBurst(e.x, e.y, dir, 34, Math.PI);
    spawnGibs(e.x, e.y, dir, randInt(6, 10));
    stampPool(e.x, e.y, e.r * 2.2);
    game.gibs++;
  } else {
    spawnBloodBurst(e.x, e.y, dir, 18, 0.9);
    stampCorpse(e, dir);
  }

  // Multi-kill slow-mo — the money shot
  multiKill.t = 0.6; multiKill.n++;
  if (multiKill.n >= 3) { game.slowmoT = 0.45; multiKill.n = 0; }

  // Drops
  const r = Math.random();
  if (r < 0.14) spawnPickup(e.x, e.y, 'ammoR');
  else if (r < 0.26 && player.weapons[1].owned) spawnPickup(e.x, e.y, 'ammoS');
  else if (r < 0.33) spawnPickup(e.x, e.y, 'medkit');

  enemies.splice(enemies.indexOf(e), 1);
}

function killBoss(dir) {
  game.kills++;
  sfxRoar(); sfxThunder();
  game.slowmoT = 1.6;
  cam.trauma = 1;
  game.lightning = 0.5;
  // Apocalyptic gore fountain
  spawnBloodBurst(boss.x, boss.y, dir, 120, Math.PI);
  spawnGibs(boss.x, boss.y, dir, 24);
  stampPool(boss.x, boss.y, 110);
  for (let i = 0; i < 8; i++) stampPool(boss.x + rand(-130, 130), boss.y + rand(-130, 130), rand(20, 55));
  game.gibs++;
  boss = null;
  // Clear the stragglers in a wave of viscera
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    spawnBloodBurst(e.x, e.y, rand(TAU), 20, Math.PI);
    stampPool(e.x, e.y, e.r * 2);
    enemies.splice(i, 1);
  }
  game.quotaLeft = 0;
  chapterComplete();
}

function hurtPlayer(dmg, dir) {
  if (player.dead || player.hurtFlash > 0.25) return;
  player.hp -= dmg;
  player.hurtFlash = 0.45;
  cam.trauma = Math.min(1, cam.trauma + 0.5);
  addScreenSplat();
  spawnBloodBurst(player.x, player.y, dir, 10, 0.8);
  stampSplat(player.x + rand(-10, 10), player.y + rand(-10, 10), rand(4, 9));
  sfxSquelch(false);
  player.vx = Math.cos(dir) * 180; player.vy = Math.sin(dir) * 180;
  if (player.hp <= 0) {
    player.hp = 0; player.dead = true; player.deadT = 0;
    game.slowmoT = 1.4;
    stampPool(player.x, player.y, 40);
    sfxHeartbeat();
  }
}

/* ============================== UPDATE =================================== */
function update(dt) {
  game.time += dt;
  game.stateT += dt;

  if (game.state === 'card') {
    game.card.t += dt;
    const targetChars = Math.floor(Math.max(0, game.card.t - 1.4) * 42);
    if (targetChars > game.card.chars && game.card.chars < game.card.text.length) {
      game.card.chars = Math.min(targetChars, game.card.text.length);
      if (game.card.chars % 3 === 0) sfxClick();
    }
    if (game.card.t > 14) finishCard();
    return;
  }

  if (game.state !== 'play' && game.state !== 'dead' && game.state !== 'win') {
    updateAmbientFx(dt);
    return;
  }
  if (game.paused) return;

  // Slow-motion — the camera lingers on carnage
  if (game.slowmoT > 0) { game.slowmoT -= dt; game.timeScale = lerp(game.timeScale, 0.25, 0.3); }
  else game.timeScale = lerp(game.timeScale, 1, 0.12);
  const sdt = dt * game.timeScale;
  game.runTime += sdt;
  if (multiKill.t > 0) { multiKill.t -= sdt; if (multiKill.t <= 0) multiKill.n = 0; }
  if (game.hint > 0) game.hint -= sdt;

  updateAmbientFx(dt);
  if (game.state === 'play') {
    if (!player.dead) updatePlayer(sdt);
    else {
      player.deadT += dt;
      if (player.deadT > 2.2) { game.state = 'dead'; game.stateT = 0; }
    }
    updateDirector(sdt);
    updateEnemies(sdt);
    if (boss) updateBoss(sdt);
    updateBullets(sdt);
    updatePickups(sdt);

    // Chapter progress
    if (!game.chapterDone && !CHAPTERS[game.chapter].boss && game.quotaLeft <= 0 && enemies.length === 0) {
      chapterComplete();
    }
    if (game.chapterDone) {
      game.fadeOut += dt;
      if (game.fadeOut > 2.2) {
        if (game.endless) { game.fadeOut = 0; game.chapterDone = false; }
        else if (game.chapter >= CHAPTERS.length - 1) { game.state = 'win'; game.stateT = 0; }
        else showCard(game.chapter + 1);
      }
    }

    // Endless difficulty creep
    if (game.endless) {
      const lvl = Math.floor(game.runTime / 30);
      if (lvl > game.nightmareLevel) {
        game.nightmareLevel = lvl;
        sfxGrowl(45);
      }
    }
  }
  updateParticles(sdt);
  updateGore(sdt);
  updateCamera(dt);

  // Heartbeat when near death
  if (!player.dead && player.hp < 35) {
    game.heartbeatT -= dt;
    if (game.heartbeatT <= 0) { sfxHeartbeat(); game.heartbeatT = lerp(0.55, 1.0, player.hp / 35); }
  }
  // Ambient growls from the dark
  game.growlT -= dt;
  if (game.growlT <= 0) {
    game.growlT = rand(4, 10);
    if (enemies.length > 0 && Math.random() < 0.7) sfxGrowl();
  }
}

function updateAmbientFx(dt) {
  // Fog drift
  for (const f of fogPuffs) {
    f.x += f.vx * dt;
    f.wob += dt * 0.3;
    if (f.x > WORLD_W + 300) f.x = -300;
  }
  // Lightning storm
  if (game.lightning > 0) game.lightning -= dt;
  game.nextLightning -= dt;
  if (game.nextLightning <= 0) {
    game.nextLightning = rand(18, 40);
    game.lightning = rand(0.25, 0.5);
    sfxThunder();
  }
  // The red balloon drifts through, now and then
  if (game.balloon) {
    game.balloon.x += game.balloon.vx * dt;
    game.balloon.y += Math.sin(game.time * 0.8) * 12 * dt;
    if (game.balloon.x > WORLD_W + 100 || game.balloon.popped) game.balloon = null;
  } else {
    game.nextBalloon -= dt;
    if (game.nextBalloon <= 0) {
      game.nextBalloon = rand(50, 110);
      game.balloon = { x: -60, y: rand(500, WORLD_H - 500), vx: rand(28, 45), popped: false };
    }
  }
}

function updatePlayer(dt) {
  // Aim
  player.aim = Math.atan2(mouse.y - toScreenY(player.y), mouse.x - toScreenX(player.x));

  // Movement
  let mx = 0, my = 0;
  if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) my += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  const mag = Math.hypot(mx, my);
  const sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && player.stamina > 1 && mag > 0;
  if (sprinting) { player.stamina = Math.max(0, player.stamina - 30 * dt); player.staminaWait = 0.8; }
  else {
    player.staminaWait -= dt;
    if (player.staminaWait <= 0) player.stamina = Math.min(100, player.stamina + 22 * dt);
  }
  const spd = sprinting ? player.sprint : player.speed;
  if (mag > 0) {
    player.x += (mx / mag) * spd * dt;
    player.y += (my / mag) * spd * dt;
    player.moving = sprinting ? 2 : 1;
    player.walkPhase += dt * (sprinting ? 13 : 9);
  } else player.moving = 0;

  // Knockback decay
  if (player.vx || player.vy) {
    player.x += (player.vx || 0) * dt; player.y += (player.vy || 0) * dt;
    player.vx = (player.vx || 0) * Math.pow(0.001, dt); player.vy = (player.vy || 0) * Math.pow(0.001, dt);
    if (Math.abs(player.vx) < 1) player.vx = 0;
    if (Math.abs(player.vy) < 1) player.vy = 0;
  }
  resolveCircle(player);

  // Weapons
  if (player.fireCd > 0) player.fireCd -= dt;
  if (player.swing > 0) player.swing -= dt;
  if (player.muzzle > 0) player.muzzle -= dt;
  if (player.hurtFlash > 0) player.hurtFlash -= dt;
  if (player.reloading) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) {
      const w = player.weapons[player.weapon];
      if (w.type === 'shotgun') {
        // One shell at a time
        if (w.reserve > 0 && w.ammo < w.mag) { w.ammo++; w.reserve--; sfxReload(); }
        if (w.reserve > 0 && w.ammo < w.mag) player.reloadT = w.reload;
        else player.reloading = false;
      } else {
        const need = Math.min(w.mag - w.ammo, w.reserve);
        w.ammo += need; w.reserve -= need;
        player.reloading = false;
        sfxReload();
      }
    }
  }
  if (mouse.down) tryFire();

  // Acid pools burn
  for (const a of acidPools) {
    if (dist(player.x, player.y, a.x, a.y) < a.r) {
      player.acidT = (player.acidT || 0) + dt;
      if (player.acidT > 0.5) { player.acidT = 0; hurtPlayer(7, rand(TAU)); }
    }
  }
}

function updateDirector(dt) {
  const ch = CHAPTERS[game.chapter];
  let maxAlive = ch.maxAlive, interval = ch.interval;
  if (game.endless) {
    maxAlive = Math.min(26, ch.maxAlive + game.nightmareLevel * 2);
    interval = Math.max(0.4, ch.interval - game.nightmareLevel * 0.08);
  }
  // Don't overspawn past the quota
  const remainingToSpawn = game.endless ? Infinity : game.quotaLeft - enemies.length;
  director.timer -= dt;
  if (director.timer <= 0 && enemies.length < maxAlive && remainingToSpawn > 0 && !game.chapterDone) {
    director.timer = interval * rand(0.7, 1.3);
    const p = pickSpawnPoint();
    spawnEnemy(pickType(ch.types), p.x + rand(-20, 20), p.y + rand(-15, 15), p.drain);
  }
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.spawnT < 1) { e.spawnT += dt * 1.6; continue; }
    e.attackCd -= dt;

    const toPlayer = angleTo(e.x, e.y, player.x, player.y);
    const d = dist(e.x, e.y, player.x, player.y);
    let sp = e.speed;

    // Crawler lunge
    if (e.type === 'crawler') {
      if (e.lungeT > 0) { e.lungeT -= dt; sp = e.speed * 2.4; }
      else if (d < 170 && d > 60 && e.attackCd <= 0 && Math.random() < dt * 2.2) {
        e.lungeT = 0.35;
        sfxGrowl(120);
      }
    }

    // Steer toward player with wander when blocked
    e.wanderT -= dt;
    if (e.blocked && e.wanderT <= 0) {
      e.wanderA = toPlayer + pick([-1, 1]) * rand(0.8, 1.6);
      e.wanderT = rand(0.5, 1.1);
    }
    e.blocked = false;
    const steer = e.wanderT > 0 ? e.wanderA : toPlayer;
    if (!player.dead) {
      e.x += Math.cos(steer) * sp * dt;
      e.y += Math.sin(steer) * sp * dt;
    }

    // Knockback
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.vx *= Math.pow(0.0005, dt); e.vy *= Math.pow(0.0005, dt);

    // Separation
    for (let j = i - 1; j >= 0; j--) {
      const o = enemies[j];
      const dd = dist(e.x, e.y, o.x, o.y);
      const rr = e.r + o.r;
      if (dd < rr && dd > 0.001) {
        const push = (rr - dd) / 2;
        const a = angleTo(o.x, o.y, e.x, e.y);
        e.x += Math.cos(a) * push; e.y += Math.sin(a) * push;
        o.x -= Math.cos(a) * push; o.y -= Math.sin(a) * push;
      }
    }
    resolveCircle(e);

    // Attack
    if (!player.dead && d < e.r + player.r + 6 && e.attackCd <= 0) {
      e.attackCd = e.type === 'crawler' ? 0.8 : 1.1;
      hurtPlayer(e.dmg, toPlayer);
    }
  }
}

function updateBoss(dt) {
  const b = boss;
  if (b.hitFlash > 0) b.hitFlash -= dt;
  if (b.spawnT < 1) { b.spawnT += dt * 0.7; return; }
  b.stateT += dt;
  const toPlayer = angleTo(b.x, b.y, player.x, player.y);
  const d = dist(b.x, b.y, player.x, player.y);

  // Phase escalation
  const hpFrac = b.hp / b.maxHp;
  const newPhase = hpFrac < 0.33 ? 2 : hpFrac < 0.66 ? 1 : 0;
  if (newPhase > b.phase) {
    b.phase = newPhase;
    sfxRoar();
    game.lightning = 0.35;
    b.state = 'summon'; b.stateT = 0;
  }

  if (b.staggerT > 0) { b.staggerT -= dt; return; }

  switch (b.state) {
    case 'walk': {
      if (!player.dead) {
        b.x += Math.cos(toPlayer) * b.speed * dt;
        b.y += Math.sin(toPlayer) * b.speed * dt;
      }
      b.attackCd -= dt;
      if (d < 95 && b.attackCd <= 0) { b.state = 'swipe'; b.stateT = 0; }
      else if (b.attackCd <= 0 && d > 240) {
        b.state = Math.random() < (0.4 + b.phase * 0.15) ? 'chargePrep' : 'summon';
        b.stateT = 0;
      }
      break;
    }
    case 'swipe': {
      if (b.stateT > 0.45) {
        if (!player.dead && dist(b.x, b.y, player.x, player.y) < 120) {
          hurtPlayer(30, angleTo(b.x, b.y, player.x, player.y));
        }
        cam.trauma = Math.min(1, cam.trauma + 0.3);
        b.state = 'walk'; b.stateT = 0; b.attackCd = 1.4 - b.phase * 0.3;
      }
      break;
    }
    case 'chargePrep': {
      if (b.stateT > 0.7) {
        b.chargeDir = toPlayer;
        b.state = 'charge'; b.stateT = 0;
        sfxRoar();
      }
      break;
    }
    case 'charge': {
      b.blocked = false;
      b.x += Math.cos(b.chargeDir) * 430 * dt;
      b.y += Math.sin(b.chargeDir) * 430 * dt;
      resolveCircle(b);
      if (!player.dead && dist(b.x, b.y, player.x, player.y) < b.r + player.r + 6) {
        hurtPlayer(34, b.chargeDir);
        b.state = 'walk'; b.stateT = 0; b.attackCd = 2;
      } else if (b.blocked) {
        // Slammed into a building — stunned and vulnerable
        b.staggerT = 1.6;
        b.state = 'walk'; b.stateT = 0; b.attackCd = 2.2;
        cam.trauma = 1;
        sfxThunder();
        spawnBloodBurst(b.x, b.y, b.chargeDir + Math.PI, 10, 1);
      } else if (b.stateT > 1.4) { b.state = 'walk'; b.stateT = 0; b.attackCd = 1.5; }
      break;
    }
    case 'summon': {
      if (b.stateT > 0.9) {
        const n = 2 + b.phase;
        for (let k = 0; k < n; k++) {
          const a = rand(TAU);
          spawnEnemy(Math.random() < 0.6 ? 'crawler' : 'shambler',
            clamp(b.x + Math.cos(a) * rand(60, 130), 60, WORLD_W - 60),
            clamp(b.y + Math.sin(a) * rand(60, 130), 60, WORLD_H - 60), true);
        }
        b.state = 'walk'; b.stateT = 0; b.attackCd = 3 - b.phase * 0.5;
      }
      break;
    }
  }
  resolveCircle(b);
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }
    // Substep for collision reliability
    const steps = 3;
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      b.x += b.vx * dt / steps;
      b.y += b.vy * dt / steps;
      // Walls
      if (insideAnyCollider(b.x, b.y, 0) || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
        hit = true;
        for (let p = 0; p < 3; p++) {
          particles.push({
            kind: 'spark', x: b.x, y: b.y,
            vx: rand(-90, 90), vy: rand(-90, 90), z: 4, vz: rand(20, 60),
            life: rand(0.1, 0.25), size: 1.5, color: '#c9b98a'
          });
        }
        break;
      }
      // The balloon
      if (game.balloon && !game.balloon.popped && dist(b.x, b.y, game.balloon.x, game.balloon.y) < 16) {
        game.balloon.popped = true;
        sfxSquelch(false);
        spawnBloodBurst(game.balloon.x, game.balloon.y, rand(TAU), 12, Math.PI);
      }
      // Boss
      if (boss && dist(b.x, b.y, boss.x, boss.y) < boss.r) {
        hit = true;
        const dmgMul = boss.staggerT > 0 ? 2 : 1;
        damageEnemy(boss, b.dmg * dmgMul, Math.atan2(b.vy, b.vx), b.knock, false);
        break;
      }
      // Enemies
      for (const e of enemies) {
        if (e.hp <= 0 || e.spawnT < 0.5) continue;
        if (dist(b.x, b.y, e.x, e.y) < e.r + 2) {
          hit = true;
          damageEnemy(e, b.dmg, Math.atan2(b.vy, b.vx), b.knock, false);
          break;
        }
      }
    }
    if (hit) bullets.splice(i, 1);
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.bob += dt * 3;
    if (player.dead) continue;
    if (dist(p.x, p.y, player.x, player.y) < 30) {
      const wR = player.weapons[0], wS = player.weapons[1];
      if (p.kind === 'medkit') {
        if (player.hp >= player.maxHp) continue;
        player.hp = Math.min(player.maxHp, player.hp + 35);
      } else if (p.kind === 'ammoR') wR.reserve = Math.min(120, wR.reserve + 12);
      else if (p.kind === 'ammoS') { if (!wS.owned) continue; wS.reserve = Math.min(60, wS.reserve + 5); }
      else if (p.kind === 'shotgun') {
        wS.owned = true; wS.ammo = 6; wS.reserve = 12;
        player.weapon = 1;
      }
      sfxPickup();
      pickups.splice(i, 1);
    }
  }
  for (let i = acidPools.length - 1; i >= 0; i--) {
    acidPools[i].life -= dt;
    if (acidPools[i].life <= 0) acidPools.splice(i, 1);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vz -= 480 * dt; p.z += p.vz * dt;
    p.vx *= Math.pow(0.05, dt); p.vy *= Math.pow(0.05, dt);
    if (p.z <= 0 || p.life <= 0) {
      if (p.kind === 'blood') stampSplat(p.x, p.y, p.size * rand(1, 2.2));
      else if (p.kind === 'brass') {
        dctx.fillStyle = p.color; dctx.globalAlpha = 0.8;
        dctx.fillRect(p.x, p.y, 2.5, 1.5); dctx.globalAlpha = 1;
      }
      particles.splice(i, 1);
    }
  }
}

function updateGore(dt) {
  for (let i = gibs.length - 1; i >= 0; i--) {
    const g = gibs[i];
    g.x += g.vx * dt; g.y += g.vy * dt;
    g.rot += g.vrot * dt;
    g.vz -= 520 * dt; g.z += g.vz * dt;
    if (g.z <= 0) {
      g.z = 0;
      if (Math.abs(g.vz) > 60) {
        g.vz = -g.vz * 0.4; // bounce
        stampSplat(g.x, g.y, g.size);
        if (Math.random() < 0.5) sfxSquelch(false);
      } else {
        stampGib(g);
        gibs.splice(i, 1);
        continue;
      }
    }
    g.vx *= Math.pow(0.08, dt); g.vy *= Math.pow(0.08, dt);
    // Smear as it slides
    if (g.z < 3 && Math.hypot(g.vx, g.vy) > 40 && Math.random() < dt * 18) {
      stampSplat(g.x, g.y, g.size * 0.7);
    }
  }
}

function updateCamera(dt) {
  // Look-ahead toward the mouse
  const lookX = (mouse.x - VW / 2) * 0.18;
  const lookY = (mouse.y - VH / 2) * 0.18;
  const tx = player.x - VW / 2 + lookX;
  const ty = player.y - VH / 2 + lookY;
  cam.x = lerp(cam.x, tx, 1 - Math.pow(0.0001, dt));
  cam.y = lerp(cam.y, ty, 1 - Math.pow(0.0001, dt));
  cam.x = clamp(cam.x, 0, Math.max(0, WORLD_W - VW));
  cam.y = clamp(cam.y, 0, Math.max(0, WORLD_H - VH));
  cam.trauma = Math.max(0, cam.trauma - dt * 1.6);
}

const toScreenX = wx => wx - cam.x + shakeX();
const toScreenY = wy => wy - cam.y + shakeY();
let _shakeSeedX = 0, _shakeSeedY = 0;
function shakeX() { return _shakeSeedX; }
function shakeY() { return _shakeSeedY; }
function computeShake() {
  const s = cam.trauma * cam.trauma * 15;
  _shakeSeedX = rand(-s, s);
  _shakeSeedY = rand(-s, s);
}

/* ============================== RENDER =================================== */
function render() {
  computeShake();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, VW, VH);

  if (game.state === 'title') { renderTitle(); return; }
  if (game.state === 'card') { renderCard(); return; }

  glowPoints.length = 0;

  // --- WORLD PASS ---
  ctx.save();
  ctx.translate(-cam.x + _shakeSeedX, -cam.y + _shakeSeedY);
  ctx.drawImage(groundC, 0, 0);
  ctx.drawImage(decalC, 0, 0);

  // Acid pools glow faintly
  for (const a of acidPools) {
    ctx.fillStyle = `rgba(140,190,60,${0.18 * Math.min(1, a.life)})`;
    ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(190,230,90,${0.1 * Math.min(1, a.life)})`;
    ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r * 0.6, a.r * 0.42, 0, 0, TAU); ctx.fill();
  }

  // Shadows
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  const shadowFor = (x, y, r) => { ctx.beginPath(); ctx.ellipse(x, y + 4, r * 1.1, r * 0.5, 0, 0, TAU); ctx.fill(); };
  if (!player.dead) shadowFor(player.x, player.y, player.r);
  for (const e of enemies) if (e.spawnT >= 0.4) shadowFor(e.x, e.y, e.r * e.spawnT);
  if (boss) shadowFor(boss.x, boss.y, boss.r * 1.3);

  // Sortable draw list: props + entities by baseY
  const drawList = [];
  for (const p of props) drawList.push(p);
  for (const e of enemies) drawList.push({ baseY: e.y + e.r, kind: 'enemy', e });
  if (!player.dead) drawList.push({ baseY: player.y + player.r, kind: 'player' });
  else drawList.push({ baseY: player.y + player.r, kind: 'playerDead' });
  if (boss) drawList.push({ baseY: boss.y + boss.r, kind: 'boss' });
  for (const p of pickups) drawList.push({ baseY: p.y + 8, kind: 'pickup', p });
  drawList.sort((a, b) => a.baseY - b.baseY);
  for (const d of drawList) drawThing(d);

  // Bullets
  ctx.strokeStyle = 'rgba(255,235,180,0.85)';
  ctx.lineWidth = 2;
  for (const b of bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.014, b.y - b.vy * 0.014);
    ctx.stroke();
  }

  // Airborne particles & gibs
  for (const p of particles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = clamp(p.life * 3, 0, 1);
    ctx.beginPath();
    ctx.arc(p.x, p.y - p.z, p.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const g of gibs) drawGib(g);

  // The balloon
  if (game.balloon && !game.balloon.popped) {
    const bl = game.balloon;
    ctx.strokeStyle = 'rgba(200,200,200,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bl.x, bl.y + 12); ctx.lineTo(bl.x - 4, bl.y + 34); ctx.stroke();
    ctx.fillStyle = '#a3121a';
    ctx.beginPath(); ctx.ellipse(bl.x, bl.y, 10, 12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(bl.x - 3, bl.y - 4, 3, 4, 0, 0, TAU); ctx.fill();
    glowPoints.push({ x: bl.x, y: bl.y, r: 20, color: 'rgba(160,20,26,0.5)' });
  }

  // Fog — world-space drifting banks
  const fogLevel = CHAPTERS[game.chapter] ? CHAPTERS[game.chapter].fog : 1;
  for (const f of fogPuffs) {
    const sx = f.x - cam.x, sy = f.y - cam.y;
    if (sx < -450 || sx > VW + 450 || sy < -450 || sy > VH + 450) continue;
    ctx.globalAlpha = f.alpha * fogLevel * (0.8 + 0.2 * Math.sin(f.wob));
    ctx.drawImage(fogSprite, f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // --- LIGHTING PASS ---
  renderLighting();

  // Glow points shine through the dark (eyes, balloon)
  for (const g of glowPoints) {
    const sx = g.x - cam.x + _shakeSeedX, sy = g.y - cam.y + _shakeSeedY;
    if (sx < -50 || sx > VW + 50 || sy < -50 || sy > VH + 50) continue;
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, g.r);
    gr.addColorStop(0, g.color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(sx - g.r, sy - g.r, g.r * 2, g.r * 2);
  }

  // --- GRADE & GRAIN ---
  ctx.fillStyle = 'rgba(16,24,48,0.14)';
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillRect(0, 0, VW, VH);
  ctx.globalCompositeOperation = 'source-over';
  renderGrain();
  ctx.drawImage(vignetteC, 0, 0);

  // Player damage: red pulse + blood on the lens
  if (player.hurtFlash > 0) {
    ctx.fillStyle = `rgba(140,10,14,${player.hurtFlash * 0.4})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  const lowHp = player.hp < 35 && !player.dead;
  if (lowHp) {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5);
    ctx.fillStyle = `rgba(90,6,10,${0.16 + 0.12 * pulse * (1 - player.hp / 35)})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  for (const s of screenSplats) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.globalAlpha = s.alpha;
    ctx.drawImage(splatSprite, -s.size / 2, -s.size / 2, s.size, s.size);
    ctx.restore();
    s.alpha -= 0.0018;
  }
  for (let i = screenSplats.length - 1; i >= 0; i--) if (screenSplats[i].alpha <= 0) screenSplats.splice(i, 1);
  ctx.globalAlpha = 1;

  // Chapter-end fade
  if (game.chapterDone) {
    ctx.fillStyle = `rgba(0,0,0,${clamp(game.fadeOut / 2, 0, 1)})`;
    ctx.fillRect(0, 0, VW, VH);
  }

  renderHUD();
  renderLetterbox();

  if (game.state === 'dead') renderDeath();
  if (game.state === 'win') renderWin();
  if (game.paused && game.state === 'play') renderPause();
}

function drawThing(d) {
  switch (d.kind) {
    case 'building': drawBuilding(d.b); break;
    case 'tree': drawTree(d); break;
    case 'car': drawCar(d); break;
    case 'lamp': drawLamp(d); break;
    case 'poster': drawPoster(d); break;
    case 'hydrant': drawHydrant(d); break;
    case 'enemy': drawEnemy(d.e); break;
    case 'player': drawPlayer(); break;
    case 'playerDead': drawPlayerDead(); break;
    case 'boss': drawBoss(); break;
    case 'pickup': drawPickup(d); break;
  }
}

function drawBuilding(b) {
  // Main block
  ctx.fillStyle = '#15161c';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  // Facade strip at street level
  ctx.fillStyle = '#1d1f27';
  ctx.fillRect(b.x, b.y + b.h - 34, b.w, 34);
  // Roof edge highlight
  ctx.strokeStyle = 'rgba(120,130,160,0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
  // Windows
  for (const w of b.windows) {
    let lit = w.lit;
    if (w.flicker && lit) lit = Math.sin(game.time * rand(8, 12) + w.phase) > -0.6;
    ctx.fillStyle = lit ? 'rgba(230,180,90,0.75)' : '#0b0c10';
    ctx.fillRect(b.x + w.x, b.y + w.y, 28, 32);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x + w.x, b.y + w.y, 28, 32);
    ctx.beginPath();
    ctx.moveTo(b.x + w.x + 14, b.y + w.y); ctx.lineTo(b.x + w.x + 14, b.y + w.y + 32);
    ctx.moveTo(b.x + w.x, b.y + w.y + 16); ctx.lineTo(b.x + w.x + 28, b.y + w.y + 16);
    ctx.stroke();
  }
  // Steeple for the church
  if (b.church) {
    ctx.fillStyle = '#101117';
    ctx.beginPath();
    ctx.moveTo(b.x + b.w / 2 - 30, b.y);
    ctx.lineTo(b.x + b.w / 2, b.y - 90);
    ctx.lineTo(b.x + b.w / 2 + 30, b.y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(150,150,170,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w / 2, b.y - 90); ctx.lineTo(b.x + b.w / 2, b.y - 108);
    ctx.moveTo(b.x + b.w / 2 - 7, b.y - 101); ctx.lineTo(b.x + b.w / 2 + 7, b.y - 101);
    ctx.stroke();
  }
  // Sign
  if (b.sign && b.name) {
    ctx.fillStyle = '#22242e';
    const sw = ctx.measureText(b.name).width;
    ctx.font = 'bold 13px Georgia, serif';
    const tw = ctx.measureText(b.name).width + 20;
    ctx.fillRect(b.x + b.w / 2 - tw / 2, b.y + b.h - 62, tw, 22);
    ctx.fillStyle = 'rgba(215,190,140,0.75)';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, b.x + b.w / 2, b.y + b.h - 46);
    ctx.textAlign = 'left';
  }
}

function drawTree(t) {
  ctx.fillStyle = '#20160f';
  ctx.fillRect(t.x - 4, t.y - 10, 8, 22);
  const s = t.size;
  const sway = Math.sin(game.time * 0.7 + t.seed) * 3;
  ctx.fillStyle = '#141d12';
  ctx.beginPath(); ctx.arc(t.x + sway, t.y - s * 0.7, s * 0.6, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(t.x - s * 0.35 + sway, t.y - s * 0.4, s * 0.45, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(t.x + s * 0.35 + sway, t.y - s * 0.45, s * 0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(30,44,26,0.5)';
  ctx.beginPath(); ctx.arc(t.x + sway * 1.2, t.y - s * 0.75, s * 0.35, 0, TAU); ctx.fill();
}

function drawCar(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  ctx.fillStyle = c.tone;
  ctx.beginPath();
  ctx.roundRect(-55, -26, 110, 52, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(10,12,16,0.9)';
  ctx.beginPath();
  ctx.roundRect(-28, -20, 56, 40, 6);
  ctx.fill();
  // Busted windshield
  ctx.strokeStyle = 'rgba(180,190,210,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(18, -12); ctx.lineTo(26, 0); ctx.lineTo(17, 10);
  ctx.moveTo(22, -6); ctx.lineTo(14, 2);
  ctx.stroke();
  ctx.restore();
}

function drawLamp(d) {
  const l = d.l;
  ctx.fillStyle = '#101116';
  ctx.fillRect(l.x - 3, l.y - 78, 6, 84);
  ctx.beginPath(); ctx.arc(l.x, l.y + 4, 7, 0, TAU); ctx.fill();
  const on = lampIntensity(l) > 0.15;
  ctx.fillStyle = on ? 'rgba(240,200,120,0.9)' : '#1c1d24';
  ctx.beginPath(); ctx.arc(l.x, l.y - 80, 8, 0, TAU); ctx.fill();
}

function lampIntensity(l) {
  let v = 0.75 + 0.25 * Math.sin(game.time * 9 + l.phase);
  if (l.dying) {
    const cyc = Math.sin(game.time * 0.9 + l.phase) + Math.sin(game.time * 3.7 + l.phase * 2);
    if (cyc < -0.4) v = 0.02;
  }
  return v;
}

function drawPoster(d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(0.06);
  ctx.fillStyle = 'rgba(215,208,190,0.85)';
  ctx.fillRect(-8, -26, 16, 22);
  ctx.fillStyle = 'rgba(40,40,45,0.9)';
  ctx.fillRect(-6, -24, 12, 3);
  ctx.fillRect(-5, -18, 10, 8);
  ctx.fillRect(-6, -8, 12, 1.5);
  ctx.restore();
}

function drawHydrant(d) {
  ctx.fillStyle = '#5e1a14';
  ctx.beginPath();
  ctx.roundRect(d.x - 6, d.y - 14, 12, 20, 4);
  ctx.fill();
  ctx.beginPath(); ctx.arc(d.x, d.y - 14, 5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#40120e';
  ctx.fillRect(d.x - 9, d.y - 6, 18, 4);
}

function drawPickup(d) {
  const p = d.p;
  const bobY = Math.sin(p.bob) * 3;
  const y = p.y + bobY;
  glowPoints.push({ x: p.x, y: p.y, r: 34, color: p.kind === 'medkit' ? 'rgba(200,60,60,0.35)' : 'rgba(200,180,110,0.3)' });
  ctx.save();
  ctx.translate(p.x, y);
  if (p.kind === 'medkit') {
    ctx.fillStyle = '#c8c9ce';
    ctx.fillRect(-9, -7, 18, 14);
    ctx.fillStyle = '#a01a1a';
    ctx.fillRect(-2, -5, 4, 10);
    ctx.fillRect(-6, -1.5, 12, 3);
  } else if (p.kind === 'ammoR') {
    ctx.fillStyle = '#6b5a30';
    ctx.fillRect(-8, -5, 16, 10);
    ctx.fillStyle = '#c9b061';
    for (let i = -1; i <= 1; i++) ctx.fillRect(i * 4 - 1, -3, 2.5, 6);
  } else if (p.kind === 'ammoS') {
    ctx.fillStyle = '#37402c';
    ctx.fillRect(-8, -5, 16, 10);
    ctx.fillStyle = '#a03024';
    for (let i = -1; i <= 1; i++) ctx.fillRect(i * 4.4 - 1.4, -3.4, 3, 7);
  } else if (p.kind === 'shotgun') {
    ctx.rotate(-0.5);
    ctx.fillStyle = '#3d2c17';
    ctx.fillRect(-16, -2.5, 14, 5);
    ctx.fillStyle = '#454a52';
    ctx.fillRect(-4, -2, 20, 4);
    ctx.rotate(0.5);
    ctx.fillStyle = 'rgba(220,200,150,0.8)';
    ctx.font = '10px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('12-GAUGE', 0, -12);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawPlayer() {
  const p = player;
  ctx.save();
  ctx.translate(p.x, p.y);
  const bob = p.moving ? Math.sin(p.walkPhase) * 1.6 : 0;
  // Feet shuffle
  if (p.moving) {
    ctx.fillStyle = '#14151a';
    const fs = Math.sin(p.walkPhase) * 6;
    ctx.beginPath(); ctx.ellipse(-4, 8 + fs * 0.4, 3.5, 2.5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 8 - fs * 0.4, 3.5, 2.5, 0, 0, TAU); ctx.fill();
  }
  ctx.translate(0, bob * 0.4);
  // Body — sheriff's jacket
  ctx.fillStyle = '#2b2f24';
  ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  // Arms + weapon toward aim
  ctx.save();
  ctx.rotate(p.aim + (p.swing > 0 ? Math.sin(p.swing * 30) * 0.9 : 0));
  ctx.strokeStyle = '#242820'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(2, -7); ctx.lineTo(15, -2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2, 7); ctx.lineTo(15, 2); ctx.stroke();
  const w = p.weapons[p.weapon];
  if (w.type === 'revolver') {
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(12, -2, 12, 4);
    ctx.fillStyle = '#2a1d10';
    ctx.fillRect(9, -1, 5, 5);
  } else if (w.type === 'shotgun') {
    ctx.fillStyle = '#454a52';
    ctx.fillRect(10, -2.2, 22, 4.4);
    ctx.fillStyle = '#3d2c17';
    ctx.fillRect(2, -2, 10, 5);
  } else {
    ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(26, 0); ctx.stroke();
    ctx.fillStyle = '#7d1b16';
    ctx.beginPath();
    ctx.moveTo(24, -8); ctx.lineTo(32, -1); ctx.lineTo(24, 2); ctx.closePath(); ctx.fill();
  }
  // Muzzle flash
  if (p.muzzle > 0 && w.type !== 'axe') {
    ctx.fillStyle = 'rgba(255,220,130,0.95)';
    const ml = w.type === 'shotgun' ? 34 : 22;
    ctx.beginPath();
    ctx.moveTo(w.type === 'shotgun' ? 32 : 24, 0);
    ctx.lineTo(ml + 14, -7); ctx.lineTo(ml + 20, 0); ctx.lineTo(ml + 14, 7);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // Hat
  ctx.fillStyle = '#57452a';
  ctx.beginPath(); ctx.arc(0, -2, 10, 0, TAU); ctx.fill();
  ctx.fillStyle = '#6b5433';
  ctx.beginPath(); ctx.arc(0, -2, 6, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawPlayerDead() {
  ctx.save();
  ctx.translate(player.x, player.y);
  const t = clamp(player.deadT / 0.8, 0, 1);
  ctx.rotate(t * 1.5);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2b2f24';
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 9, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#57452a';
  ctx.beginPath(); ctx.arc(14, 4, 8, 0, TAU); ctx.fill();
  ctx.restore();
  if (Math.random() < 0.3 && player.deadT < 1.5) {
    stampSplat(player.x + rand(-16, 16), player.y + rand(-16, 16), rand(3, 8));
  }
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const em = e.spawnT < 1 ? e.spawnT : 1;
  ctx.scale(em, em);
  ctx.globalAlpha = 0.4 + em * 0.6;
  const flash = e.hitFlash > 0;
  const facing = angleTo(e.x, e.y, player.x, player.y);

  if (e.type === 'crawler') {
    const skitter = Math.sin(game.time * 22 + e.seed) * 3;
    ctx.rotate(facing);
    // Splayed limbs like something learning to be a spider
    ctx.strokeStyle = flash ? '#cfd4da' : '#494436';
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? -1 : 1;
      const off = (i % 2) * 8 - 4;
      ctx.beginPath();
      ctx.moveTo(off, 0);
      ctx.lineTo(off - 6, side * (12 + skitter * side));
      ctx.lineTo(off + 2, side * (17 + skitter * side));
      ctx.stroke();
    }
    ctx.fillStyle = flash ? '#e8ecf0' : e.tone;
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 8, 0, 0, TAU); ctx.fill();
    // Head raised, jaw split open
    ctx.fillStyle = flash ? '#fff' : '#8e9480';
    ctx.beginPath(); ctx.arc(11, 0, 6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3d0a0c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(13, -2); ctx.lineTo(19, -5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(13, 2); ctx.lineTo(19, 5); ctx.stroke();
    glowPoints.push({ x: e.x + Math.cos(facing) * 11, y: e.y + Math.sin(facing) * 11, r: 9, color: 'rgba(200,210,170,0.5)' });
  } else if (e.type === 'bloater') {
    const pulse = 1 + Math.sin(game.time * 3 + e.seed) * 0.06;
    ctx.fillStyle = flash ? '#e8ecf0' : e.tone;
    ctx.beginPath(); ctx.ellipse(0, 0, 22 * pulse, 19 * pulse, 0, 0, TAU); ctx.fill();
    // Distended glistening belly
    ctx.fillStyle = flash ? '#fff' : 'rgba(140,160,90,0.55)';
    ctx.beginPath(); ctx.ellipse(0, 3, 14 * pulse, 11 * pulse, 0, 0, TAU); ctx.fill();
    // Seeping wounds
    ctx.fillStyle = '#5e0a0d';
    for (let i = 0; i < 3; i++) {
      const wa = e.seed + i * 2.1;
      ctx.beginPath(); ctx.arc(Math.cos(wa) * 12, Math.sin(wa) * 10, 3, 0, TAU); ctx.fill();
    }
    // Small head sunk into the mass
    ctx.fillStyle = flash ? '#fff' : '#99a084';
    ctx.beginPath();
    ctx.arc(Math.cos(facing) * 14, Math.sin(facing) * 12, 7, 0, TAU);
    ctx.fill();
    glowPoints.push({ x: e.x + Math.cos(facing) * 14, y: e.y + Math.sin(facing) * 12, r: 10, color: 'rgba(190,210,140,0.45)' });
  } else {
    // Shambler — what's left of a neighbor
    const lurch = Math.sin(game.time * 7 + e.seed) * 2;
    ctx.rotate(facing);
    // Dragging arms
    ctx.strokeStyle = flash ? '#cfd4da' : '#3c3830';
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(12 + lurch, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(14 - lurch, 11); ctx.stroke();
    ctx.fillStyle = flash ? '#e8ecf0' : e.tone;
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 10, 0, 0, TAU); ctx.fill();
    // Old blood down the front
    ctx.fillStyle = 'rgba(90,12,14,0.65)';
    ctx.beginPath(); ctx.ellipse(5, (e.stainSeed % 7) - 3, 5, 3.5, 0.4, 0, TAU); ctx.fill();
    // Head tilted wrong
    ctx.fillStyle = flash ? '#fff' : '#99a084';
    ctx.beginPath(); ctx.arc(9, lurch * 0.8, 7, 0, TAU); ctx.fill();
    // Slack mouth
    ctx.fillStyle = '#1c0507';
    ctx.beginPath(); ctx.ellipse(13, lurch * 0.8 + 1, 2.5, 1.6, 0, 0, TAU); ctx.fill();
    glowPoints.push({ x: e.x + Math.cos(facing) * 9, y: e.y + Math.sin(facing) * 9, r: 8, color: 'rgba(210,215,190,0.45)' });
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBoss() {
  const b = boss;
  ctx.save();
  ctx.translate(b.x, b.y);
  const em = clamp(b.spawnT, 0, 1);
  ctx.scale(em, em);
  ctx.globalAlpha = 0.3 + em * 0.7;
  const sway = Math.sin(game.time * 1.7 + b.seed) * 0.06;
  ctx.rotate(sway);
  const flash = b.hitFlash > 0;
  const stag = b.staggerT > 0;
  const prep = b.state === 'chargePrep' ? Math.sin(game.time * 40) * 2 : 0;
  ctx.translate(prep, 0);

  // Long coat body — a scarecrow the size of a streetlight
  ctx.fillStyle = flash ? '#d8dce2' : '#191410';
  ctx.beginPath();
  ctx.moveTo(-24, 30);
  ctx.quadraticCurveTo(-30, -10, -14, -34);
  ctx.lineTo(14, -34);
  ctx.quadraticCurveTo(30, -10, 24, 30);
  ctx.quadraticCurveTo(0, 40, -24, 30);
  ctx.closePath(); ctx.fill();
  // Coat flaps
  ctx.strokeStyle = flash ? '#fff' : '#241c14';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-8, -20); ctx.lineTo(-10, 26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, -20); ctx.lineTo(10, 26); ctx.stroke();
  // Too-long arms ending in tine fingers
  const armSwing = Math.sin(game.time * 2.2 + b.seed) * 6;
  ctx.strokeStyle = flash ? '#d8dce2' : '#191410';
  ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(-44, 4 + armSwing); ctx.lineTo(-50, 30 + armSwing); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, -20); ctx.lineTo(44, 4 - armSwing); ctx.lineTo(50, 30 - armSwing); ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let f = -1; f <= 1; f++) {
    ctx.beginPath(); ctx.moveTo(-50, 30 + armSwing); ctx.lineTo(-54 + f * 4, 44 + armSwing); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(50, 30 - armSwing); ctx.lineTo(54 + f * 4, 44 - armSwing); ctx.stroke();
  }
  // Burlap head with a stitched grin
  ctx.fillStyle = flash ? '#fff' : (stag ? '#8a7d5e' : '#6e6248');
  ctx.beginPath(); ctx.ellipse(0, -46, 16, 18, 0, 0, TAU); ctx.fill();
  // Stitching
  ctx.strokeStyle = '#3a3020'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-10, -58); ctx.lineTo(10, -56); ctx.stroke();
  for (let s = -8; s <= 8; s += 4) {
    ctx.beginPath(); ctx.moveTo(s, -60); ctx.lineTo(s + 1, -54); ctx.stroke();
  }
  // The grin — too wide, too many teeth
  ctx.strokeStyle = '#170a06'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, -44, 11, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.strokeStyle = '#c8bfa4'; ctx.lineWidth = 1.6;
  for (let tx = -8; tx <= 8; tx += 2.2) {
    const ty = -44 + Math.sqrt(Math.max(0, 121 - tx * tx)) * 0.9;
    ctx.beginPath(); ctx.moveTo(tx, ty - 2.4); ctx.lineTo(tx, ty + 2.4); ctx.stroke();
  }
  // Amber eyes
  ctx.fillStyle = '#e8a13c';
  ctx.beginPath(); ctx.arc(-6, -50, 2.8, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(6, -50, 2.8, 0, TAU); ctx.fill();
  // Wide-brim hat
  ctx.fillStyle = flash ? '#eee' : '#0e0b08';
  ctx.beginPath(); ctx.ellipse(0, -58, 24, 7, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, -64, 12, 9, 0, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  glowPoints.push({ x: b.x - 6, y: b.y - 50, r: 14, color: 'rgba(232,161,60,0.7)' });
  glowPoints.push({ x: b.x + 6, y: b.y - 50, r: 14, color: 'rgba(232,161,60,0.7)' });
}

function drawGib(g) {
  ctx.save();
  ctx.translate(g.x, g.y - g.z);
  ctx.rotate(g.rot);
  ctx.fillStyle = g.color;
  if (g.kind === 'bone') {
    ctx.fillRect(-g.size, -g.size * 0.22, g.size * 2, g.size * 0.44);
    ctx.beginPath(); ctx.arc(-g.size, 0, g.size * 0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(g.size, 0, g.size * 0.3, 0, TAU); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(-g.size, 0);
    ctx.lineTo(-g.size * 0.2, -g.size * 0.9);
    ctx.lineTo(g.size, -g.size * 0.15);
    ctx.lineTo(g.size * 0.4, g.size * 0.8);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* --------------------------- LIGHTING ----------------------------------- */
function renderLighting() {
  const dk = darkCtx;
  dk.clearRect(0, 0, VW, VH);
  let darkness = 0.895;
  if (game.lightning > 0) darkness = lerp(0.35, 0.895, 1 - clamp(game.lightning / 0.5, 0, 1));
  dk.fillStyle = `rgba(4,6,14,${darkness})`;
  dk.fillRect(0, 0, VW, VH);
  dk.globalCompositeOperation = 'destination-out';

  const px = player.x - cam.x + _shakeSeedX;
  const py = player.y - cam.y + _shakeSeedY;

  if (!player.dead) {
    // Flashlight cone
    const flick = 0.88 + 0.12 * Math.sin(game.time * 17) * Math.sin(game.time * 5.3);
    const coneLen = 470;
    const half = 0.4;
    const g = dk.createRadialGradient(px, py, 18, px, py, coneLen);
    g.addColorStop(0, `rgba(0,0,0,${0.96 * flick})`);
    g.addColorStop(0.65, `rgba(0,0,0,${0.6 * flick})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dk.fillStyle = g;
    dk.beginPath();
    dk.moveTo(px, py);
    dk.arc(px, py, coneLen, player.aim - half, player.aim + half);
    dk.closePath();
    dk.fill();
    // Personal glow
    const pg = dk.createRadialGradient(px, py, 4, px, py, 110);
    pg.addColorStop(0, 'rgba(0,0,0,0.85)');
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    dk.fillStyle = pg;
    dk.beginPath(); dk.arc(px, py, 110, 0, TAU); dk.fill();
    // Muzzle flash lights up the street
    if (player.muzzle > 0) {
      const mg = dk.createRadialGradient(px, py, 10, px, py, 300);
      mg.addColorStop(0, 'rgba(0,0,0,0.95)');
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      dk.fillStyle = mg;
      dk.beginPath(); dk.arc(px, py, 300, 0, TAU); dk.fill();
    }
  }

  // Street lamps
  for (const l of lamps) {
    const lx = l.x - cam.x + _shakeSeedX, ly = l.y - 80 - cam.y + _shakeSeedY;
    if (lx < -220 || lx > VW + 220 || ly < -220 || ly > VH + 220) continue;
    const inten = lampIntensity(l);
    if (inten < 0.05) continue;
    const lg = dk.createRadialGradient(lx, ly, 6, lx, ly, 165);
    lg.addColorStop(0, `rgba(0,0,0,${0.75 * inten})`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    dk.fillStyle = lg;
    dk.beginPath(); dk.arc(lx, ly, 165, 0, TAU); dk.fill();
  }

  // Lit windows spill a little light
  for (const b of buildings) {
    for (const w of b.windows) {
      if (!w.lit) continue;
      const wx = b.x + w.x + 14 - cam.x, wy = b.y + w.y + 40 - cam.y;
      if (wx < -100 || wx > VW + 100 || wy < -100 || wy > VH + 100) continue;
      const wg = dk.createRadialGradient(wx, wy, 2, wx, wy, 55);
      wg.addColorStop(0, 'rgba(0,0,0,0.4)');
      wg.addColorStop(1, 'rgba(0,0,0,0)');
      dk.fillStyle = wg;
      dk.beginPath(); dk.arc(wx, wy, 55, 0, TAU); dk.fill();
    }
  }

  dk.globalCompositeOperation = 'source-over';
  ctx.drawImage(darkC, 0, 0);

  // Warm flashlight tint inside the cone
  if (!player.dead) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.25;
    const wg = ctx.createRadialGradient(px, py, 20, px, py, 420);
    wg.addColorStop(0, 'rgba(255,214,150,0.8)');
    wg.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 420, player.aim - 0.4, player.aim + 0.4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Lightning white flash
  if (game.lightning > 0.35) {
    ctx.fillStyle = `rgba(220,228,255,${(game.lightning - 0.35) * 1.4})`;
    ctx.fillRect(0, 0, VW, VH);
  }
}

function renderGrain() {
  grainFrame++;
  if (grainFrame % 3 === 0) {
    const img = grainCtx.createImageData(160, 100);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    grainCtx.putImageData(img, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.085;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(grainC, 0, 0, VW, VH);
  ctx.imageSmoothingEnabled = true;
  ctx.restore();
}

function renderLetterbox() {
  const bar = Math.min(70, VH * 0.085);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VW, bar);
  ctx.fillRect(0, VH - bar, VW, bar);
}

/* --------------------------- UI SCREENS ---------------------------------- */
function typeSet(size, mono, color) {
  ctx.font = `${mono ? '' : 'bold '}${size}px ${mono ? "'Courier New', monospace" : 'Georgia, serif'}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
}

function renderTitle() {
  const t = game.time;
  // Slow fog behind the title
  for (const f of fogPuffs) {
    ctx.globalAlpha = f.alpha * 0.5;
    const fx = ((f.x + t * 8) % (VW + 600)) - 300;
    ctx.drawImage(fogSprite, fx, (f.y % VH) - f.size / 2, f.size, f.size);
  }
  ctx.globalAlpha = 1;

  const flicker = Math.random() < 0.06 ? rand(0.5, 0.85) : 1;
  ctx.save();
  ctx.globalAlpha = clamp(t / 3, 0, 1) * flicker;

  typeSet(Math.min(30, VW * 0.026), true, 'rgba(150,150,160,0.7)');
  ctx.fillText('HARROW’S END, MAINE · POPULATION 1,406 · OCTOBER 1986', VW / 2, VH * 0.3);

  typeSet(Math.min(110, VW * 0.11), false, '#8a1216');
  ctx.shadowColor = '#4a0a0c'; ctx.shadowBlur = 30;
  ctx.fillText('HARROW’S END', VW / 2, VH * 0.46);
  ctx.shadowBlur = 0;

  typeSet(Math.min(22, VW * 0.02), false, 'rgba(190,180,170,0.85)');
  ctx.fillText('every small town keeps a harvest', VW / 2, VH * 0.53);

  if (t > 2 && Math.sin(t * 2.4) > -0.4) {
    typeSet(Math.min(24, VW * 0.021), true, 'rgba(220,210,190,0.9)');
    ctx.fillText('PRESS ENTER TO BEGIN THE LAST SHIFT', VW / 2, VH * 0.68);
  }
  typeSet(14, true, 'rgba(140,140,150,0.6)');
  ctx.fillText('WASD MOVE · MOUSE AIM · CLICK FIRE · SHIFT SPRINT · R RELOAD · 1/2/3 WEAPONS · M MUTE', VW / 2, VH * 0.76);
  typeSet(13, true, 'rgba(120,40,40,0.7)');
  ctx.fillText('contains considerable blood and guts', VW / 2, VH * 0.81);
  ctx.restore();

  // Dripping blood from the title
  if (!renderTitle.drips) renderTitle.drips = [];
  if (Math.random() < 0.05 && renderTitle.drips.length < 14) {
    renderTitle.drips.push({ x: VW / 2 + rand(-VW * 0.16, VW * 0.16), y: VH * 0.47, v: rand(15, 55), len: rand(8, 26) });
  }
  ctx.strokeStyle = '#6b0f12'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (let i = renderTitle.drips.length - 1; i >= 0; i--) {
    const d = renderTitle.drips[i];
    d.y += d.v * 0.016;
    ctx.beginPath(); ctx.moveTo(d.x, d.y - d.len); ctx.lineTo(d.x, d.y); ctx.stroke();
    if (d.y > VH * 0.62) renderTitle.drips.splice(i, 1);
  }

  renderGrain();
  ctx.drawImage(vignetteC, 0, 0);
  renderLetterbox();
  ctx.textAlign = 'left';
}

function renderCard() {
  const c = game.card;
  ctx.fillStyle = '#040405';
  ctx.fillRect(0, 0, VW, VH);

  ctx.save();
  ctx.globalAlpha = clamp(c.t / 1.2, 0, 1);
  typeSet(Math.min(20, VW * 0.02), true, 'rgba(150,145,140,0.75)');
  ctx.fillText(c.num, VW / 2, VH * 0.3);
  typeSet(Math.min(54, VW * 0.05), false, '#a01a1a');
  ctx.shadowColor = '#4a0a0c'; ctx.shadowBlur = 22;
  ctx.fillText(c.title, VW / 2, VH * 0.38);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Typewriter narrative
  const shown = c.text.slice(0, c.chars);
  ctx.font = `${Math.min(17, VW * 0.016)}px 'Courier New', monospace`;
  ctx.fillStyle = 'rgba(205,198,185,0.9)';
  ctx.textAlign = 'left';
  const maxWidth = Math.min(680, VW * 0.7);
  const x0 = VW / 2 - maxWidth / 2;
  let y = VH * 0.47;
  for (const para of shown.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth) {
        ctx.fillText(line, x0, y);
        y += 26; line = word;
      } else line = test;
    }
    ctx.fillText(line, x0, y);
    y += 26;
  }
  // Blinking cursor
  if (c.chars < c.text.length && Math.sin(c.t * 10) > 0) {
    ctx.fillText('▌', x0 + ctx.measureText(shown.split('\n').pop()).width + 2, y - 26);
  }

  if (c.t > 2.5 && Math.sin(c.t * 2.5) > -0.3) {
    typeSet(15, true, 'rgba(180,170,160,0.7)');
    ctx.fillText('ENTER TO CONTINUE', VW / 2, VH * 0.85);
  }
  renderGrain();
  ctx.drawImage(vignetteC, 0, 0);
  renderLetterbox();
  ctx.textAlign = 'left';
}

function renderHUD() {
  const bar = Math.min(70, VH * 0.085);
  ctx.save();

  // Health — a strip of film soaked red
  const hw = 210, hx = 34, hy = VH - bar - 46;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(hx - 6, hy - 6, hw + 12, 26);
  ctx.fillStyle = '#26090b';
  ctx.fillRect(hx, hy, hw, 14);
  const hpFrac = clamp(player.hp / player.maxHp, 0, 1);
  ctx.fillStyle = hpFrac < 0.35 ? '#c0242c' : '#8a1216';
  ctx.fillRect(hx, hy, hw * hpFrac, 14);
  ctx.strokeStyle = 'rgba(200,190,170,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(hx, hy, hw, 14);
  ctx.font = "12px 'Courier New', monospace";
  ctx.fillStyle = 'rgba(210,200,185,0.85)';
  ctx.textAlign = 'left';
  ctx.fillText('SHERIFF PRUITT', hx, hy - 10);
  // Stamina wisp under health
  ctx.fillStyle = 'rgba(120,130,140,0.25)';
  ctx.fillRect(hx, hy + 18, hw, 4);
  ctx.fillStyle = 'rgba(170,185,200,0.55)';
  ctx.fillRect(hx, hy + 18, hw * (player.stamina / 100), 4);

  // Weapon & ammo
  const w = player.weapons[player.weapon];
  ctx.textAlign = 'right';
  ctx.font = "bold 15px 'Courier New', monospace";
  ctx.fillStyle = 'rgba(215,205,190,0.9)';
  ctx.fillText(w.name, VW - 36, VH - bar - 40);
  ctx.font = "bold 26px 'Courier New', monospace";
  if (w.type === 'axe') {
    ctx.fillStyle = 'rgba(190,180,165,0.75)';
    ctx.fillText('∞', VW - 36, VH - bar - 12);
  } else {
    ctx.fillStyle = w.ammo === 0 ? '#c0242c' : 'rgba(230,220,200,0.95)';
    ctx.fillText(`${w.ammo} | ${w.reserve}`, VW - 36, VH - bar - 12);
    if (player.reloading) {
      ctx.font = "13px 'Courier New', monospace";
      ctx.fillStyle = '#c9a84c';
      ctx.fillText('RELOADING…', VW - 36, VH - bar - 62);
    } else if (w.ammo === 0 && w.reserve === 0) {
      ctx.font = "13px 'Courier New', monospace";
      ctx.fillStyle = '#c0242c';
      ctx.fillText('FIND AMMO', VW - 36, VH - bar - 62);
    }
  }

  // Objective
  ctx.textAlign = 'center';
  ctx.font = "14px 'Courier New', monospace";
  ctx.fillStyle = 'rgba(200,192,178,0.8)';
  const ch = CHAPTERS[game.chapter];
  if (game.endless) {
    const mm = Math.floor(game.runTime / 60), ss = Math.floor(game.runTime % 60);
    ctx.fillText(`NIGHTMARE SHIFT — ${mm}:${ss < 10 ? '0' : ''}${ss} — ${game.kills} DOWN`, VW / 2, bar + 26);
  } else if (ch.boss) {
    if (boss) {
      // Boss health bar, cinema style
      const bw = Math.min(560, VW * 0.5), bx = VW / 2 - bw / 2, by = VH - bar - 34;
      ctx.font = "bold 15px Georgia, serif";
      ctx.fillStyle = 'rgba(220,205,180,0.9)';
      ctx.fillText('T H E   H A R V E S T   M A N', VW / 2, by - 10);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 3, by - 3, bw + 6, 14);
      ctx.fillStyle = '#26090b';
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = '#a01a1a';
      ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxHp, 0, 1), 8);
      if (boss.staggerT > 0) {
        ctx.font = "13px 'Courier New', monospace";
        ctx.fillStyle = '#e8c96a';
        ctx.fillText('HE’S DOWN — HIT HIM', VW / 2, by + 26);
      }
    }
  } else {
    ctx.fillText(`THE HOLLOWED — ${Math.max(0, game.quotaLeft)} REMAIN`, VW / 2, bar + 26);
  }

  // Chapter tag
  ctx.textAlign = 'left';
  ctx.font = "12px 'Courier New', monospace";
  ctx.fillStyle = 'rgba(160,152,140,0.55)';
  ctx.fillText(game.endless ? 'NIGHTMARE SHIFT' : `${ch.num} — ${ch.title}`, 34, bar + 26);

  // First-minutes hint
  if (game.hint > 0) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = clamp(game.hint, 0, 1);
    ctx.font = "14px 'Courier New', monospace";
    ctx.fillStyle = 'rgba(220,212,195,0.85)';
    ctx.fillText('WASD to move · mouse to aim · click to fire · SHIFT to run · R to reload', VW / 2, VH - bar - 80);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

function renderDeath() {
  ctx.fillStyle = `rgba(0,0,0,${clamp(game.stateT / 1.2, 0, 0.82)})`;
  ctx.fillRect(0, 0, VW, VH);
  if (game.stateT < 0.6) return;
  ctx.save();
  ctx.globalAlpha = clamp((game.stateT - 0.6) / 1, 0, 1);
  typeSet(Math.min(84, VW * 0.08), false, '#8a1216');
  ctx.shadowColor = '#4a0a0c'; ctx.shadowBlur = 26;
  ctx.fillText('THE TOWN TOOK HER', VW / 2, VH * 0.42);
  ctx.shadowBlur = 0;
  typeSet(16, true, 'rgba(200,192,178,0.85)');
  const mm = Math.floor(game.runTime / 60), ss = Math.floor(game.runTime % 60);
  ctx.fillText(`${game.kills} HOLLOWED PUT DOWN · ${game.gibs} TORN APART · ${mm}:${ss < 10 ? '0' : ''}${ss} SURVIVED`, VW / 2, VH * 0.52);
  if (game.stateT > 1.5 && Math.sin(game.stateT * 2.5) > -0.3) {
    typeSet(17, true, 'rgba(220,210,190,0.9)');
    ctx.fillText(game.endless ? 'ENTER — CLOCK BACK IN' : 'ENTER — DANA GETS BACK UP', VW / 2, VH * 0.64);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

function renderWin() {
  // Dawn breaks
  const t = clamp(game.stateT / 5, 0, 1);
  ctx.fillStyle = `rgba(190,170,150,${t * 0.25})`;
  ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = `rgba(0,0,0,${clamp(game.stateT / 2, 0, 0.75)})`;
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.globalAlpha = clamp((game.stateT - 1) / 1.5, 0, 1);
  typeSet(Math.min(72, VW * 0.065), false, 'rgba(220,205,185,0.95)');
  ctx.fillText('DAWN', VW / 2, VH * 0.3);

  // Typewriter epilogue
  const chars = Math.floor(Math.max(0, game.stateT - 2) * 40);
  const shown = EPILOGUE.slice(0, chars);
  ctx.font = `${Math.min(16, VW * 0.015)}px 'Courier New', monospace`;
  ctx.fillStyle = 'rgba(205,198,185,0.9)';
  ctx.textAlign = 'left';
  const maxWidth = Math.min(640, VW * 0.68);
  const x0 = VW / 2 - maxWidth / 2;
  let y = VH * 0.4;
  for (const para of shown.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth) { ctx.fillText(line, x0, y); y += 24; line = word; }
      else line = test;
    }
    ctx.fillText(line, x0, y); y += 24;
  }

  typeSet(15, true, 'rgba(200,190,175,0.8)');
  const mm = Math.floor(game.runTime / 60), ss = Math.floor(game.runTime % 60);
  ctx.fillText(`${game.kills} HOLLOWED PUT DOWN · ${game.gibs} TORN APART · SHIFT LENGTH ${mm}:${ss < 10 ? '0' : ''}${ss}`, VW / 2, VH * 0.78);
  if (game.stateT > 4 && Math.sin(game.stateT * 2.2) > -0.3) {
    typeSet(17, true, 'rgba(160,20,26,0.95)');
    ctx.fillText('ENTER — THERE IS ANOTHER HARROW’S END (NIGHTMARE SHIFT)', VW / 2, VH * 0.86);
  }
  ctx.restore();
  renderGrain();
  renderLetterbox();
  ctx.textAlign = 'left';
}

function renderPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, VW, VH);
  typeSet(Math.min(46, VW * 0.045), false, 'rgba(210,200,185,0.9)');
  ctx.fillText('— INTERMISSION —', VW / 2, VH * 0.4);
  typeSet(15, true, 'rgba(190,182,170,0.8)');
  ctx.fillText('WASD move · SHIFT sprint · mouse aim · click fire · R reload', VW / 2, VH * 0.5);
  ctx.fillText('1 colt · 2 shotgun · 3 axe (or mouse wheel) · M mute · F fullscreen', VW / 2, VH * 0.55);
  ctx.fillText('ESC or P to resume', VW / 2, VH * 0.63);
  ctx.textAlign = 'left';
}

/* ============================== LOOP ===================================== */
let lastT = 0;
function frame(t) {
  const dt = Math.min(0.035, (t - lastT) / 1000 || 0.016);
  lastT = t;
  try {
    update(dt);
    render();
  } catch (err) {
    // A horror game should never hard-crash the tab — log and keep breathing
    if (!frame.errLogged) { console.error(err); frame.errLogged = true; }
  }
  requestAnimationFrame(frame);
}

resize();
buildWorld();
requestAnimationFrame(frame);
