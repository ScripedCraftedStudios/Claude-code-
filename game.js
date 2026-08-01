/* ============================================================================
   HARROW'S END — a small town keeps its harvest
   First-person survival horror. October 1986. The fog came at 3 AM.
   Renderer lives in engine.js; this is the camera, the guns, and the night.
   ========================================================================== */
'use strict';

/* ------------------------------- CANVAS ---------------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, DPR = 1;

// Low internal render resolution, upscaled — cheap AND it looks like film.
let RW = 0, RH = 0;
let fbCanvas = document.createElement('canvas');
let fbCtx = fbCanvas.getContext('2d');
let fbImage = null, fb = null;
let zbuf = null;
let flashX = null, flashY = null;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  VW = window.innerWidth; VH = window.innerHeight;
  canvas.width = Math.floor(VW * DPR); canvas.height = Math.floor(VH * DPR);
  canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';

  RW = clamp(Math.round(VW / 1.9), 400, 820);
  RH = clamp(Math.round(RW * VH / VW), 220, 540);
  fbCanvas.width = RW; fbCanvas.height = RH;
  fbImage = fbCtx.createImageData(RW, RH);
  fb = new Uint32Array(fbImage.data.buffer);
  zbuf = new Float32Array(RW);
  flashX = new Float32Array(RW);
  flashY = new Float32Array(RH);
  for (let x = 0; x < RW; x++) {
    const t = Math.abs(x - RW / 2) / (RW / 2);
    flashX[x] = Math.pow(clamp(1 - t * 1.28, 0, 1), 1.7);
  }
  buildVignette();
}
window.addEventListener('resize', resize);

/* ------------------------------- INPUT ----------------------------------- */
const keys = {};
const mouse = { down: false, locked: false };

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  initAudio();
  handleKeyPress(e.code);
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('mousedown', e => {
  initAudio();
  if (game.state === 'title') { startRun(); return; }
  if (game.state === 'play' && !game.paused && !mouse.locked) { requestLock(); return; }
  if (e.button === 0) mouse.down = true;
  if (e.button === 2) player.adsHeld = true;
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) mouse.down = false;
  if (e.button === 2) player.adsHeld = false;
});
window.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  mouse.locked = document.pointerLockElement === canvas;
  // Losing the mouse pauses — but never mid-death or mid-chapter-change,
  // or the death sequence would freeze behind the pause card.
  if (!mouse.locked && game.state === 'play' && !player.dead && !game.chapterDone) {
    game.paused = true; mouse.down = false;
  }
});
document.addEventListener('mousemove', e => {
  if (!mouse.locked || game.state !== 'play' || game.paused) return;
  const zoom = currentFov() / FOV;
  player.dir -= e.movementX * 0.0022 * game.sensitivity * zoom;
  player.pitch = clamp(player.pitch - e.movementY * 1.6 * game.sensitivity * zoom, -RH * 0.42, RH * 0.42);
});
function requestLock() { try { canvas.requestPointerLock(); } catch (err) {} }

window.addEventListener('blur', () => { if (game.state === 'play') game.paused = true; });
window.addEventListener('wheel', e => {
  if (game.state !== 'play' || game.paused) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  let w = player.weapon;
  for (let i = 0; i < 3; i++) {
    w = (w + dir + player.weapons.length) % player.weapons.length;
    if (player.weapons[w].owned) break;
  }
  switchWeapon(w);
}, { passive: true });

function handleKeyPress(code) {
  if (code === 'KeyM') { audio.muted = !audio.muted; if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.5; }
  if (code === 'KeyF') { try { document.documentElement.requestFullscreen(); } catch (e) {} }

  if (game.state === 'title') { if (code === 'Enter' || code === 'Space') startRun(); }
  else if (game.state === 'card') { if ((code === 'Enter' || code === 'Space') && game.card.t > 1.2) finishCard(); }
  else if (game.state === 'play') {
    if (code === 'Escape') { game.paused = true; if (mouse.locked) document.exitPointerLock(); }
    else if (code === 'KeyP') { game.paused = !game.paused; if (game.paused && mouse.locked) document.exitPointerLock(); else requestLock(); }
    else if (game.paused && (code === 'Enter' || code === 'Space')) { game.paused = false; requestLock(); }
    else if (!game.paused) {
      if (code === 'KeyR') startReload();
      if (code === 'Digit1') switchWeapon(0);
      if (code === 'Digit2') switchWeapon(1);
      if (code === 'Digit3') switchWeapon(2);
      if (code === 'Digit4') switchWeapon(3);
    }
  }
  else if (game.state === 'dead') { if ((code === 'Enter' || code === 'Space') && game.stateT > 1.5) retryChapter(); }
  else if (game.state === 'win') { if ((code === 'Enter' || code === 'Space') && game.stateT > 2) startNightmare(); }
}

/* ------------------------------- AUDIO ----------------------------------- */
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
    const len = audio.ctx.sampleRate * 2;
    audio.noiseBuf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const d = audio.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    startAmbience();
  } catch (e) { /* the town stays silent */ }
}
function noiseSource() { const s = audio.ctx.createBufferSource(); s.buffer = audio.noiseBuf; s.loop = true; return s; }

function startAmbience() {
  if (!audio.ctx || audio.droneOn) return;
  audio.droneOn = true;
  const t = audio.ctx.currentTime;
  const g = audio.ctx.createGain(); g.gain.value = 0.05;
  const lp = audio.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 190;
  const o1 = audio.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 54;
  const o2 = audio.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.7;
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(audio.master);
  o1.start(t); o2.start(t);
  const lfo = audio.ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = audio.ctx.createGain(); lfoG.gain.value = 0.025;
  lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start(t);
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
// Distance attenuation for anything happening out in the fog
function atten(x, y) {
  const d = Math.hypot(x - player.x, y - player.y);
  return clamp(1 - d / 26, 0.05, 1);
}

function sfxShot(big) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const n = noiseSource();
  const f = audio.ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(big ? 3600 : 2800, t);
  f.frequency.exponentialRampToValueAtTime(180, t + (big ? 0.34 : 0.19));
  const g = sfxGain(big ? 0.85 : 0.6, t, 0.004, big ? 0.4 : 0.22);
  n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.6);
  const o = audio.ctx.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(big ? 160 : 220, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.11);
  const og = sfxGain(0.3, t, 0.002, 0.13);
  o.connect(og); o.start(t); o.stop(t + 0.2);
}
function sfxSquelch(heavy, x, y) {
  if (!audio.ctx) return;
  const a = (x === undefined) ? 1 : atten(x, y);
  const t = audio.ctx.currentTime;
  const n = noiseSource();
  const f = audio.ctx.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.setValueAtTime(rand(300, 600), t);
  f.frequency.exponentialRampToValueAtTime(rand(90, 150), t + 0.16);
  f.Q.value = 1.6;
  const g = sfxGain((heavy ? 0.55 : 0.3) * a, t, 0.005, heavy ? 0.3 : 0.16);
  n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.45);
  if (heavy) {
    const o = audio.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.2);
    const og = sfxGain(0.35 * a, t, 0.004, 0.22);
    o.connect(og); o.start(t); o.stop(t + 0.3);
  }
}
function sfxGrowl(pitch, x, y) {
  if (!audio.ctx) return;
  const at = (x === undefined) ? 0.8 : atten(x, y);
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator(); o.type = 'sawtooth';
  const base = pitch || rand(55, 90);
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(base * rand(0.6, 0.85), t + 0.5);
  const f = audio.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  const wob = audio.ctx.createOscillator(); wob.frequency.value = rand(9, 16);
  const wobG = audio.ctx.createGain(); wobG.gain.value = base * 0.25;
  wob.connect(wobG); wobG.connect(o.frequency);
  const g = sfxGain(0.17 * at, t, 0.08, 0.55);
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
  n.connect(f); f.connect(g); n.start(t); n.stop(t + 2.8);
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
  n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.2);
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
function sfxFootstep() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const n = noiseSource();
  const f = audio.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = rand(400, 900);
  const g = sfxGain(0.07, t, 0.004, 0.07);
  n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.15);
}

/* ------------------------------ GAME STATE -------------------------------- */
const game = {
  state: 'title', stateT: 0, paused: false,
  time: 0, timeScale: 1, slowmoT: 0,
  chapter: 0, quotaLeft: 0,
  kills: 0, gibs: 0, shots: 0, runTime: 0,
  card: null, endless: false, nightmareLevel: 0,
  lightning: 0, nextLightning: rand(8, 20),
  hint: 0, fadeOut: 0, chapterDone: false,
  heartbeatT: 0, growlT: rand(3, 7),
  sensitivity: 1, lampFlicker: 1, muzzleLight: 0
};

const player = {
  x: 28.5, y: 32.5, dir: -Math.PI / 2, pitch: 0, r: 0.24,
  hp: 100, maxHp: 100, stamina: 100, staminaWait: 0,
  speed: 2.6, sprintSpeed: 4.0,
  weapon: 0, fireCd: 0, reloadT: 0, reloading: false,
  swing: 0, hurtFlash: 0, dead: false, deadT: 0, deadFall: 0,
  bob: 0, bobAmt: 0, moving: 0, stepT: 0,
  kick: 0, kickX: 0, sway: 0, acidT: 0,
  ads: 0, adsHeld: false, boltT: 0,
  weapons: [
    { name: "DAD'S COLT", type: 'revolver', owned: true, dmg: 34, rate: 0.34, mag: 6, ammo: 6, reserve: 42, reload: 1.6, spread: 0.02, pellets: 1, range: 26 },
    { name: "BARLOW'S 12-GAUGE", type: 'shotgun', owned: false, dmg: 15, rate: 0.85, mag: 6, ammo: 0, reserve: 0, reload: 0.55, spread: 0.13, pellets: 9, range: 14 },
    { name: "DAD'S DEER RIFLE", type: 'rifle', owned: false, dmg: 130, rate: 1.15, mag: 5, ammo: 0, reserve: 0, reload: 2.4, spread: 0.006, pellets: 1, range: 60, scoped: true, adsFov: 0.19 },
    { name: 'FIRE AXE', type: 'axe', owned: true, dmg: 90, rate: 0.55, range: 1.5, arc: 1.5 }
  ]
};

const enemies = [];
const particles = [];   // blood motes & sparks (3D billboards)
const gibs = [];        // chunks with gravity
const pickups = [];
const acidPools = [];
const screenSplats = [];
const tracers = [];     // brief bullet streaks
let boss = null;
let multiKill = { t: 0, n: 0 };
let damageDirs = [];    // directional hit indicators

/* ------------------------------ CHAPTERS ---------------------------------- */
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
    num: 'CHAPTER THREE', title: 'WHAT THE DRAINS KEEP', quota: 30, fog: 0.86, maxAlive: 12, interval: 1.5,
    types: [['shambler', 0.55], ['crawler', 0.3], ['bloater', 0.15]],
    text: "The drains had been whispering all summer. Old Tom Gedney said the town was built on something's mouth, and everyone laughed and bought him another beer.\n\nNobody laughed at Old Tom anymore. Some of the things coming up now were swollen with what they'd swallowed."
  },
  {
    num: 'CHAPTER FOUR', title: 'THE CONGREGATION', quota: 42, fog: 0.8, maxAlive: 16, interval: 1.05,
    types: [['shambler', 0.5], ['crawler', 0.34], ['bloater', 0.16]],
    text: "They came all at once then, shoulder to shoulder down Main Street like a congregation let out of some terrible church. The fog parted for them. It was polite that way.\n\nDana counted her shells and thought about her father's voice: 'Stand your ground, kiddo. A town is worth standing for.'"
  },
  {
    num: 'CHAPTER FIVE', title: 'THE HARVEST MAN', quota: Infinity, fog: 0.76, maxAlive: 5, interval: 4.5, boss: true,
    types: [['crawler', 0.6], ['shambler', 0.4]],
    text: "And behind them all, taller than the streetlights, wearing a smile with too many teeth in it and none of them kind, the Harvest Man came up Main Street to collect what Harrow's End owed.\n\nEvery small town keeps a harvest. Tonight the harvest fought back."
  }
];

const EPILOGUE = "The fog lifted at dawn, the way it always does.\n\nThe town would bury its dead, repaint its doors, and never speak of it again. That's the thing about small towns in Maine. They keep their secrets.\n\nAnd their secrets keep them.";

/* -------------------------------- FLOW ------------------------------------ */
function startRun() {
  game.kills = 0; game.gibs = 0; game.shots = 0; game.runTime = 0;
  game.endless = false; game.nightmareLevel = 0;
  buildMap();
  resetPlayer(true);
  showCard(0);
}

function resetPlayer(full) {
  player.x = 28.5; player.y = 32.5; player.dir = -Math.PI / 2; player.pitch = 0;
  player.hp = player.maxHp; player.stamina = 100;
  player.dead = false; player.deadT = 0; player.deadFall = 0; player.hurtFlash = 0;
  player.reloading = false; player.fireCd = 0; player.swing = 0; player.kick = 0;
  screenSplats.length = 0; damageDirs.length = 0;
  player.ads = 0; player.adsHeld = false; player.boltT = 0;
  const [w0, w1, w2] = player.weapons;
  if (full) {
    player.weapon = 0;
    w0.owned = true; w0.ammo = 6; w0.reserve = 42;
    w1.owned = false; w1.ammo = 0; w1.reserve = 0;
    w2.owned = false; w2.ammo = 0; w2.reserve = 0;
  } else {
    w0.ammo = w0.mag; w0.reserve = Math.max(w0.reserve, 30);
    if (w1.owned) { w1.ammo = w1.mag; w1.reserve = Math.max(w1.reserve, 10); }
    if (w2.owned) { w2.ammo = w2.mag; w2.reserve = Math.max(w2.reserve, 8); }
  }
}

function showCard(chapterIdx) {
  game.chapter = chapterIdx;
  game.state = 'card'; game.stateT = 0;
  if (mouse.locked) document.exitPointerLock();
  const ch = CHAPTERS[chapterIdx];
  game.card = { t: 0, num: ch.num, title: ch.title, text: ch.text, chars: 0 };
  sfxStinger();
}

function finishCard() {
  const ch = CHAPTERS[game.chapter];
  game.state = 'play'; game.stateT = 0; game.paused = false;
  game.quotaLeft = ch.quota;
  game.chapterDone = false; game.fadeOut = 0;
  enemies.length = 0; pickups.length = 0; acidPools.length = 0; tracers.length = 0;
  boss = null;
  director.timer = 1.2;
  if (game.chapter === 0 && !game.endless) game.hint = 10;
  dropSupplies();
  if (game.chapter === 1 && !player.weapons[1].owned) {
    spawnPickup(player.x + rand(-1.5, 1.5), player.y + rand(1, 2.5), 'shotgun');
  }
  if (game.chapter === 2 && !player.weapons[2].owned) {
    spawnPickup(player.x + rand(-1.5, 1.5), player.y + rand(1, 2.5), 'rifle');
  }
  if (ch.boss) spawnBoss();
  requestLock();
}

function dropSupplies() {
  for (let i = 0; i < 2; i++) spawnPickup(player.x + rand(-2.5, 2.5), player.y + rand(-2.5, 2.5), pick(['ammoR', 'ammoS', 'ammoF']));
  spawnPickup(player.x + rand(-2.5, 2.5), player.y + rand(-2.5, 2.5), 'medkit');
}

function chapterComplete() { game.chapterDone = true; game.fadeOut = 0; }

function retryChapter() {
  buildMap();
  resetPlayer(false);
  enemies.length = 0; particles.length = 0; gibs.length = 0; tracers.length = 0;
  if (game.endless) startNightmare();
  else showCard(game.chapter);
}

function startNightmare() {
  game.endless = true; game.nightmareLevel = 0;
  game.kills = 0; game.gibs = 0; game.shots = 0; game.runTime = 0;
  buildMap();
  resetPlayer(false);
  const w1 = player.weapons[1], w2 = player.weapons[2];
  w1.owned = true; w1.ammo = 6; w1.reserve = Math.max(w1.reserve, 16);
  w2.owned = true; w2.ammo = 5; w2.reserve = Math.max(w2.reserve, 12);
  game.state = 'card'; game.stateT = 0;
  if (mouse.locked) document.exitPointerLock();
  game.chapter = 3;
  game.card = {
    t: 0, num: 'NIGHTMARE SHIFT', title: 'NO DAWN COMES',
    text: "There is another Harrow's End, under the one you saved. In that town the fog never lifts and the drains never empty.\n\nHold Main Street as long as you can. It only ends one way. It always did.",
    chars: 0
  };
  sfxStinger();
}

/* ------------------------------ SPAWNING ---------------------------------- */
const director = { timer: 2 };

function pickSpawnPoint() {
  const pts = [];
  for (const d of drains) pts.push({ x: d.x, y: d.y, drain: true });
  for (const e of edgeSpawns) pts.push({ x: e.x, y: e.y, drain: false });
  const good = pts.filter(p => {
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    return d > 6 && d < 26;
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
    type, x, y, vx: 0, vy: 0, spawnT: fromDrain ? 0 : 1,
    attackCd: rand(0.4, 1), hitFlash: 0, frame: rand(4), lungeT: 0,
    wanderA: rand(TAU), wanderT: 0, blocked: false, seed: rand(TAU)
  };
  if (type === 'shambler') {
    e.hp = 60; e.maxHp = 60; e.r = 0.3; e.speed = rand(0.85, 1.25); e.dmg = 12;
    e.height = 0.62; e.tone = 0xff28232c;
  } else if (type === 'crawler') {
    e.hp = 40; e.maxHp = 40; e.r = 0.26; e.speed = rand(2.1, 2.7); e.dmg = 9;
    e.height = 0.3; e.tone = 0xff282f33;
  } else if (type === 'bloater') {
    e.hp = 230; e.maxHp = 230; e.r = 0.42; e.speed = rand(0.55, 0.75); e.dmg = 24;
    e.height = 0.72; e.tone = 0xff30443a;
  }
  if (game.endless) {
    const s = 1 + game.nightmareLevel * 0.06;
    e.hp *= s; e.maxHp *= s;
    e.speed *= Math.min(1.35, 1 + game.nightmareLevel * 0.02);
  }
  enemies.push(e);
  if (fromDrain) {
    bloodSpray(x, y, 0.15, 10, 1);
    if (Math.random() < 0.5) sfxGrowl(undefined, x, y);
  }
  return e;
}

function spawnBoss() {
  boss = {
    type: 'boss', x: 28.5, y: 9.5, r: 0.62, hp: 3400, maxHp: 3400,
    vx: 0, vy: 0, speed: 1.5, state: 'walk', stateT: 0, frame: 0,
    attackCd: 2, chargeDX: 0, chargeDY: 0, staggerT: 0, phase: 0,
    hitFlash: 0, spawnT: 0, blocked: false, height: 2.0, tone: 0xff100e14
  };
  game.lightning = 0.45;
  sfxThunder(); sfxRoar();
}

function spawnPickup(x, y, kind) {
  x = clamp(x, 2.5, MAP_W - 2.5); y = clamp(y, 2.5, MAP_H - 2.5);
  let tries = 0;
  while (isSolid(Math.floor(x), Math.floor(y)) && tries++ < 24) {
    x = clamp(x + rand(-1.5, 1.5), 2.5, MAP_W - 2.5);
    y = clamp(y + rand(-1.5, 1.5), 2.5, MAP_H - 2.5);
  }
  if (isSolid(Math.floor(x), Math.floor(y))) { x = player.x; y = player.y; }
  pickups.push({ x, y, kind, bob: rand(TAU) });
}

/* -------------------------------- GORE ------------------------------------ */
function bloodSpray(x, y, z, n, spread) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 420) break;
    const a = rand(TAU), sp = rand(0.6, 4.5) * (spread || 1);
    particles.push({
      kind: 'blood', x, y, z: z + rand(0, 0.35),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(1.2, 4.6),
      life: rand(0.5, 1.3), size: rand(0.008, 0.022),
      color: pick([0xff0b0d52, 0xff10125e, 0xff080a3e, 0xff121468])
    });
  }
}
function bloodSprayDir(x, y, z, dx, dy, n) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 420) break;
    const a = Math.atan2(dy, dx) + rand(-0.7, 0.7);
    const sp = rand(1.5, 6);
    particles.push({
      kind: 'blood', x, y, z: z + rand(-0.1, 0.2),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.5, 3.4),
      life: rand(0.4, 1.1), size: rand(0.008, 0.024),
      color: pick([0xff0b0d52, 0xff10125e, 0xff080a3e, 0xff121468])
    });
  }
}
function spawnGibs(x, y, z, n) {
  for (let i = 0; i < n; i++) {
    if (gibs.length > 70) break;
    const a = rand(TAU), sp = rand(1.5, 6.5);
    const bone = Math.random() < 0.22;
    gibs.push({
      x, y, z: z + rand(0, 0.4),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(2, 6.5),
      size: bone ? rand(0.03, 0.055) : rand(0.03, 0.075),
      color: bone ? 0xff8fa3ad : pick([0xff0d0a52, 0xff0e0a48, 0xff161660, 0xff17193f]),
      bounces: 0
    });
  }
}
function sparks(x, y, z, n) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 420) break;
    const a = rand(TAU);
    particles.push({
      kind: 'spark', x, y, z,
      vx: Math.cos(a) * rand(0.5, 2.5), vy: Math.sin(a) * rand(0.5, 2.5), vz: rand(0.5, 2.5),
      life: rand(0.08, 0.22), size: 0.02, color: 0xff8ab9e0
    });
  }
}
function addScreenSplat() {
  screenSplats.push({
    x: rand(VW * 0.12, VW * 0.88), y: rand(VH * 0.12, VH * 0.88),
    size: rand(90, 230), rot: rand(TAU), alpha: rand(0.35, 0.6)
  });
  if (screenSplats.length > 8) screenSplats.shift();
}

/* ------------------------------- COMBAT ----------------------------------- */
function switchWeapon(i) {
  const w = player.weapons[i];
  if (!w || !w.owned || i === player.weapon) return;
  player.weapon = i; player.reloading = false; player.reloadT = 0;
  sfxReload();
}
function startReload() {
  const w = player.weapons[player.weapon];
  if (w.type === 'axe' || player.reloading) return;
  if (w.ammo >= w.mag || w.reserve <= 0) return;
  player.reloading = true; player.reloadT = w.reload;
  sfxReload();
}

// Ray vs enemy cylinder — returns the nearest hit before the wall
function rayHitEnemy(px, py, dx, dy, maxT) {
  let best = null, bestT = maxT;
  const list = boss ? enemies.concat([boss]) : enemies;
  for (const e of list) {
    if (e.hp <= 0 || e.spawnT < 0.4) continue;
    const ex = e.x - px, ey = e.y - py;
    const t = ex * dx + ey * dy;                 // projection onto the ray
    if (t < 0 || t > bestT) continue;
    const perp = Math.abs(ex * dy - ey * dx);    // distance from the ray line
    if (perp > e.r) continue;
    bestT = t; best = e;
  }
  return best ? { e: best, t: bestT } : null;
}

function tryFire() {
  const w = player.weapons[player.weapon];
  if (player.fireCd > 0) return;
  if (w.type === 'rifle' && player.boltT > 0.35) return;

  if (w.type === 'axe') {
    player.fireCd = w.rate;
    player.swing = 0.34;
    sfxSwing();
    let hit = false;
    const list = boss ? enemies.concat([boss]) : enemies;
    for (const e of list) {
      if (e.hp <= 0) continue;
      const dx = e.x - player.x, dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d > w.range + e.r) continue;
      if (Math.abs(angDiff(player.dir, Math.atan2(dy, dx))) > w.arc / 2) continue;
      hit = true;
      damageEnemy(e, w.dmg, dx / d, dy / d, true);
    }
    if (hit) { player.kick = 0.5; addShake(0.3); }
    return;
  }

  if (player.reloading) {
    if (w.type === 'shotgun' && w.ammo > 0) { player.reloading = false; player.reloadT = 0; }
    else return;
  }
  if (w.ammo <= 0) {
    sfxClick(); player.fireCd = 0.3;
    if (w.reserve > 0) startReload();
    return;
  }

  w.ammo--; game.shots++;
  player.fireCd = w.rate;
  const big = w.type === 'shotgun';
  const rifle = w.type === 'rifle';
  const aimed = easeAds(player.ads);
  player.kick = big ? 1 : rifle ? 0.9 : 0.55;
  player.kickX = rand(-0.4, 0.4) * (1 - aimed * 0.7);
  player.pitch = clamp(player.pitch + (big ? 16 : rifle ? 13 : 6) * (1 - aimed * 0.45), -RH * 0.42, RH * 0.42);
  game.muzzleLight = big ? 0.14 : rifle ? 0.15 : 0.09;
  sfxShot(big || rifle);
  addShake((big ? 0.5 : rifle ? 0.45 : 0.26) * (1 - aimed * 0.35));
  if (rifle) player.boltT = 0.75;             // work the bolt before the next round

  // Sights tighten the group; hip fire throws it wide.
  const spread = w.spread * (1 - 0.82 * aimed);

  for (let i = 0; i < w.pellets; i++) {
    const a = player.dir + rand(-spread, spread);
    const dx = Math.cos(a), dy = Math.sin(a);
    const wallT = rayWallDist(player.x, player.y, dx, dy, w.range);
    let travelled = 0, dmg = w.dmg, punched = 0;
    // The rifle drives straight through a body and keeps going.
    while (true) {
      const hit = rayHitEnemy(player.x + dx * travelled, player.y + dy * travelled,
                              dx, dy, Math.min(wallT, w.range) - travelled);
      if (!hit) break;
      damageEnemy(hit.e, dmg, dx, dy, false);
      if (!rifle || punched >= 2) { travelled += hit.t; break; }
      punched++;
      dmg *= 0.6;
      travelled += hit.t + (hit.e.r + 0.05);
      if (travelled >= Math.min(wallT, w.range)) break;
    }
    if (punched === 0 && travelled === 0 && wallT < w.range) {
      const hx = player.x + dx * wallT, hy = player.y + dy * wallT;
      sparks(hx, hy, 0.5 + rand(-0.2, 0.3), 2);
    }
    if (i === 0 || big) {
      const len = travelled > 0 ? travelled : Math.min(wallT, w.range);
      tracers.push({ x: player.x, y: player.y, dx, dy, len, life: rifle ? 0.09 : 0.06 });
    }
  }
}

function damageEnemy(e, dmg, dx, dy, melee) {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  e.hitFlash = 0.12;
  const isBoss = e === boss;
  const knock = (melee ? 0.9 : 0.45) * (isBoss ? 0.05 : 1);
  e.vx += dx * knock * 6; e.vy += dy * knock * 6;
  const z = (e.height || 0.6) * rand(0.4, 0.9);
  bloodSprayDir(e.x, e.y, z, -dx, -dy, melee ? 20 : 12);
  bloodSplat(e.x + dx * rand(0.1, 0.5), e.y + dy * rand(0.1, 0.5), rand(0.05, 0.14));
  sfxSquelch(false, e.x, e.y);
  if (e.hp <= 0) { if (isBoss) killBoss(dx, dy); else killEnemy(e, dx, dy, dmg, melee); }
}

function killEnemy(e, dx, dy, dmg, melee) {
  game.kills++;
  if (!CHAPTERS[game.chapter].boss || game.endless) game.quotaLeft--;
  sfxSquelch(true, e.x, e.y);
  const gib = melee || dmg > 45 || e.type === 'bloater' || Math.random() < 0.3;

  if (e.type === 'bloater') {
    bloodSpray(e.x, e.y, 0.5, 70, 1.6);
    spawnGibs(e.x, e.y, 0.5, 16);
    bloodPool(e.x, e.y, 1.1);
    acidPools.push({ x: e.x, y: e.y, r: 1.5, life: 7 });
    game.gibs++;
    addShake(0.6);
    const pd = Math.hypot(player.x - e.x, player.y - e.y);
    if (pd < 1.9) hurtPlayer(18, Math.atan2(player.y - e.y, player.x - e.x));
    for (const o of enemies) {
      if (o !== e && o.hp > 0) {
        const d = Math.hypot(o.x - e.x, o.y - e.y);
        if (d < 1.8 && d > 0.01) damageEnemy(o, 60, (o.x - e.x) / d, (o.y - e.y) / d, false);
      }
    }
  } else if (gib) {
    bloodSpray(e.x, e.y, e.height * 0.6, 42, 1.2);
    spawnGibs(e.x, e.y, e.height * 0.5, randInt(7, 11));
    bloodPool(e.x, e.y, 0.75);
    game.gibs++;
  } else {
    bloodSprayDir(e.x, e.y, e.height * 0.6, dx, dy, 22);
    corpseStamp(e.x, e.y, e.tone);
  }

  multiKill.t = 0.7; multiKill.n++;
  if (multiKill.n >= 3) { game.slowmoT = 0.5; multiKill.n = 0; }

  const r = Math.random();
  if (r < 0.13) spawnPickup(e.x, e.y, 'ammoR');
  else if (r < 0.23 && player.weapons[1].owned) spawnPickup(e.x, e.y, 'ammoS');
  else if (r < 0.30 && player.weapons[2].owned) spawnPickup(e.x, e.y, 'ammoF');
  else if (r < 0.37) spawnPickup(e.x, e.y, 'medkit');

  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
}

function killBoss(dx, dy) {
  game.kills++;
  sfxRoar(); sfxThunder();
  game.slowmoT = 1.8; game.lightning = 0.5;
  addShake(1);
  bloodSpray(boss.x, boss.y, 1.0, 140, 2.2);
  spawnGibs(boss.x, boss.y, 1.0, 26);
  bloodPool(boss.x, boss.y, 2.4);
  for (let i = 0; i < 10; i++) bloodPool(boss.x + rand(-3, 3), boss.y + rand(-3, 3), rand(0.4, 1.2));
  game.gibs++;
  boss = null;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    bloodSpray(e.x, e.y, e.height * 0.5, 24, 1.4);
    bloodPool(e.x, e.y, 0.7);
    enemies.splice(i, 1);
  }
  game.quotaLeft = 0;
  chapterComplete();
}

function hurtPlayer(dmg, dirAngle) {
  if (player.dead || player.hurtFlash > 0.25) return;
  player.hp -= dmg;
  player.hurtFlash = 0.45;
  addShake(0.55);
  addScreenSplat();
  damageDirs.push({ a: dirAngle, t: 1.2 });
  sfxSquelch(false, player.x, player.y);
  bloodSplat(player.x + rand(-0.3, 0.3), player.y + rand(-0.3, 0.3), rand(0.06, 0.16));
  if (player.hp <= 0) {
    player.hp = 0; player.dead = true; player.deadT = 0;
    game.slowmoT = 1.6;
    bloodPool(player.x, player.y, 0.9);
    sfxHeartbeat();
    if (mouse.locked) document.exitPointerLock();
  }
}

/* --------------------------------- ADS ------------------------------------ */
// Hip fire is fast and loose; the sights are slow, steady and accurate.
function scopedWeapon() {
  const w = player.weapons[player.weapon];
  return !!(w && w.scoped);
}
function canAds() {
  const w = player.weapons[player.weapon];
  return !!(w && w.type !== 'axe');
}
function adsFovTarget() {
  const w = player.weapons[player.weapon];
  return (w && w.adsFov) ? w.adsFov : FOV * 0.62;
}
function currentFov() {
  return lerp(FOV, adsFovTarget(), easeAds(player.ads));
}
// Ease so the scope snaps up and settles instead of sliding linearly.
function easeAds(t) { return t * t * (3 - 2 * t); }

/* ------------------------------- CAMERA ----------------------------------- */
const cam = { trauma: 0, shakeX: 0, shakeY: 0, shakeR: 0 };
function addShake(v) { cam.trauma = Math.min(1, cam.trauma + v); }

/* ------------------------------- UPDATE ----------------------------------- */
function update(dt) {
  game.time += dt;
  game.stateT += dt;
  game.lampFlicker = 0.82 + 0.18 * Math.sin(game.time * 2.3) * Math.sin(game.time * 7.1);

  if (game.state === 'card') {
    game.card.t += dt;
    const target = Math.floor(Math.max(0, game.card.t - 1.4) * 42);
    if (target > game.card.chars && game.card.chars < game.card.text.length) {
      game.card.chars = Math.min(target, game.card.text.length);
      if (game.card.chars % 3 === 0) sfxClick();
    }
    if (game.card.t > 15) finishCard();
    return;
  }
  if (game.state === 'title') { updateAmbient(dt); return; }
  if (game.paused) return;

  if (game.slowmoT > 0) { game.slowmoT -= dt; game.timeScale = lerp(game.timeScale, 0.28, 0.3); }
  else game.timeScale = lerp(game.timeScale, 1, 0.12);
  const sdt = dt * game.timeScale;
  game.runTime += sdt;
  if (multiKill.t > 0) { multiKill.t -= sdt; if (multiKill.t <= 0) multiKill.n = 0; }
  if (game.hint > 0) game.hint -= sdt;
  if (game.muzzleLight > 0) game.muzzleLight = Math.max(0, game.muzzleLight - dt * 0.9);

  updateAmbient(dt);

  if (game.state === 'play') {
    if (!player.dead) updatePlayer(sdt);
    else {
      player.deadT += dt;
      player.deadFall = Math.min(1, player.deadFall + dt * 1.4);
      if (player.deadT > 2.4) { game.state = 'dead'; game.stateT = 0; }
    }
    updateDirector(sdt);
    updateEnemies(sdt);
    if (boss) updateBoss(sdt);
    updatePickups(sdt);

    if (!game.chapterDone && !CHAPTERS[game.chapter].boss && game.quotaLeft <= 0 && enemies.length === 0) chapterComplete();
    if (game.chapterDone) {
      game.fadeOut += dt;
      if (game.fadeOut > 2.4) {
        if (game.endless) { game.fadeOut = 0; game.chapterDone = false; }
        else if (game.chapter >= CHAPTERS.length - 1) { game.state = 'win'; game.stateT = 0; if (mouse.locked) document.exitPointerLock(); }
        else showCard(game.chapter + 1);
      }
    }
    if (game.endless) {
      const lvl = Math.floor(game.runTime / 30);
      if (lvl > game.nightmareLevel) { game.nightmareLevel = lvl; sfxGrowl(45); }
    }
  }

  updateParticles(sdt);
  updateGibs(sdt);
  for (let i = tracers.length - 1; i >= 0; i--) { tracers[i].life -= dt; if (tracers[i].life <= 0) tracers.splice(i, 1); }
  for (let i = damageDirs.length - 1; i >= 0; i--) { damageDirs[i].t -= dt; if (damageDirs[i].t <= 0) damageDirs.splice(i, 1); }
  for (let i = acidPools.length - 1; i >= 0; i--) { acidPools[i].life -= sdt; if (acidPools[i].life <= 0) acidPools.splice(i, 1); }

  // camera trauma
  cam.trauma = Math.max(0, cam.trauma - dt * 1.8);
  const tt = cam.trauma * cam.trauma;
  cam.shakeX = rand(-1, 1) * tt * 14;
  cam.shakeY = rand(-1, 1) * tt * 14;
  cam.shakeR = rand(-1, 1) * tt * 0.035;

  if (!player.dead && player.hp < 35) {
    game.heartbeatT -= dt;
    if (game.heartbeatT <= 0) { sfxHeartbeat(); game.heartbeatT = lerp(0.55, 1.0, player.hp / 35); }
  }
  game.growlT -= dt;
  if (game.growlT <= 0) {
    game.growlT = rand(4, 10);
    if (enemies.length > 0 && Math.random() < 0.7) {
      const e = pick(enemies);
      sfxGrowl(undefined, e.x, e.y);
    }
  }
}

function updateAmbient(dt) {
  if (game.lightning > 0) game.lightning -= dt;
  game.nextLightning -= dt;
  if (game.nextLightning <= 0) {
    game.nextLightning = rand(18, 40);
    game.lightning = rand(0.25, 0.5);
    sfxThunder();
  }
}

// Slide-along-walls collision for a circle
function moveCircle(o, dx, dy) {
  const r = o.r;
  let nx = o.x + dx;
  if (!isSolid(Math.floor(nx + Math.sign(dx) * r), Math.floor(o.y)) &&
      !isSolid(Math.floor(nx + Math.sign(dx) * r), Math.floor(o.y - r * 0.7)) &&
      !isSolid(Math.floor(nx + Math.sign(dx) * r), Math.floor(o.y + r * 0.7))) o.x = nx;
  else o.blocked = true;
  let ny = o.y + dy;
  if (!isSolid(Math.floor(o.x), Math.floor(ny + Math.sign(dy) * r)) &&
      !isSolid(Math.floor(o.x - r * 0.7), Math.floor(ny + Math.sign(dy) * r)) &&
      !isSolid(Math.floor(o.x + r * 0.7), Math.floor(ny + Math.sign(dy) * r))) o.y = ny;
  else o.blocked = true;
  o.x = clamp(o.x, 1.3, MAP_W - 1.3);
  o.y = clamp(o.y, 1.3, MAP_H - 1.3);
}

function updatePlayer(dt) {
  // Keyboard turning fallback (and for anyone who hates mouselook)
  if (keys['ArrowLeft']) player.dir -= 2.4 * dt;
  if (keys['ArrowRight']) player.dir += 2.4 * dt;
  if (keys['ArrowUp']) player.pitch = clamp(player.pitch + 160 * dt, -RH * 0.42, RH * 0.42);
  if (keys['ArrowDown']) player.pitch = clamp(player.pitch - 160 * dt, -RH * 0.42, RH * 0.42);
  player.pitch *= Math.pow(0.55, dt);   // settles back to level

  let fwd = 0, strafe = 0;
  if (keys['KeyW']) fwd += 1;
  if (keys['KeyS']) fwd -= 1;
  if (keys['KeyD']) strafe += 1;
  if (keys['KeyA']) strafe -= 1;
  const mag = Math.hypot(fwd, strafe);
  const sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && player.stamina > 1 && fwd > 0;
  if (sprinting) { player.stamina = Math.max(0, player.stamina - 30 * dt); player.staminaWait = 0.8; }
  else {
    player.staminaWait -= dt;
    if (player.staminaWait <= 0) player.stamina = Math.min(100, player.stamina + 22 * dt);
  }

  const spd = (sprinting ? player.sprintSpeed : player.speed) * (1 - 0.45 * easeAds(player.ads));
  if (mag > 0) {
    const c = Math.cos(player.dir), s = Math.sin(player.dir);
    const dx = (c * fwd - s * strafe) / mag * spd * dt;
    const dy = (s * fwd + c * strafe) / mag * spd * dt;
    player.blocked = false;
    moveCircle(player, dx, dy);
    player.moving = sprinting ? 2 : 1;
    player.bob += dt * (sprinting ? 13 : 8.5);
    player.bobAmt = lerp(player.bobAmt, (sprinting ? 1.5 : 1) * (1 - 0.7 * easeAds(player.ads)), 0.1);
    player.stepT -= dt * (sprinting ? 2.4 : 1.7);
    if (player.stepT <= 0) { player.stepT = 1; sfxFootstep(); }
  } else {
    player.moving = 0;
    player.bobAmt = lerp(player.bobAmt, 0.18, 0.08);
    player.bob += dt * 1.6;
  }

  // Knockback
  if (player.vx || player.vy) {
    moveCircle(player, player.vx * dt, player.vy * dt);
    player.vx *= Math.pow(0.001, dt); player.vy *= Math.pow(0.001, dt);
    if (Math.abs(player.vx) < 0.02) player.vx = 0;
    if (Math.abs(player.vy) < 0.02) player.vy = 0;
  }

  // Raise / lower the sights
  const wantAds = player.adsHeld && canAds() && !player.reloading;
  player.ads = clamp(player.ads + (wantAds ? dt * 6.5 : -dt * 8), 0, 1);
  if (player.boltT > 0) player.boltT -= dt;

  if (player.fireCd > 0) player.fireCd -= dt;
  if (player.swing > 0) player.swing -= dt;
  if (player.hurtFlash > 0) player.hurtFlash -= dt;
  player.kick = Math.max(0, player.kick - dt * 4.5);
  player.kickX *= Math.pow(0.02, dt);
  player.sway = lerp(player.sway, player.moving ? Math.sin(player.bob) * 0.5 : 0, 0.12);

  if (player.reloading) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) {
      const w = player.weapons[player.weapon];
      if (w.type === 'shotgun') {
        if (w.reserve > 0 && w.ammo < w.mag) { w.ammo++; w.reserve--; sfxReload(); }
        if (w.reserve > 0 && w.ammo < w.mag) player.reloadT = w.reload;
        else player.reloading = false;
      } else {
        const need = Math.min(w.mag - w.ammo, w.reserve);
        w.ammo += need; w.reserve -= need;
        player.reloading = false; sfxReload();
      }
    }
  }
  if (mouse.down && mouse.locked) tryFire();

  for (const a of acidPools) {
    if (Math.hypot(player.x - a.x, player.y - a.y) < a.r) {
      player.acidT += dt;
      if (player.acidT > 0.5) { player.acidT = 0; hurtPlayer(7, rand(TAU)); }
    }
  }
}

function updateDirector(dt) {
  const ch = CHAPTERS[game.chapter];
  let maxAlive = ch.maxAlive, interval = ch.interval;
  if (game.endless) {
    maxAlive = Math.min(24, ch.maxAlive + game.nightmareLevel * 2);
    interval = Math.max(0.45, ch.interval - game.nightmareLevel * 0.08);
  }
  const remaining = game.endless ? Infinity : game.quotaLeft - enemies.length;
  director.timer -= dt;
  if (director.timer <= 0 && enemies.length < maxAlive && remaining > 0 && !game.chapterDone) {
    director.timer = interval * rand(0.7, 1.3);
    const p = pickSpawnPoint();
    spawnEnemy(pickType(ch.types), p.x + rand(-0.2, 0.2), p.y + rand(-0.2, 0.2), p.drain);
  }
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.spawnT < 1) { e.spawnT += dt * 1.5; continue; }
    e.attackCd -= dt;
    e.frame = (e.frame + dt * (e.type === 'crawler' ? 11 : 5)) % 4;

    const dx = player.x - e.x, dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    let sp = e.speed;

    if (e.type === 'crawler') {
      if (e.lungeT > 0) { e.lungeT -= dt; sp = e.speed * 2.1; }
      else if (d < 5 && d > 1.4 && e.attackCd <= 0 && Math.random() < dt * 2) {
        e.lungeT = 0.4; sfxGrowl(120, e.x, e.y);
      }
    }

    e.wanderT -= dt;
    if (e.blocked && e.wanderT <= 0) {
      e.wanderA = Math.atan2(dy, dx) + pick([-1, 1]) * rand(0.7, 1.5);
      e.wanderT = rand(0.4, 0.9);
    }
    e.blocked = false;
    const steer = e.wanderT > 0 ? e.wanderA : Math.atan2(dy, dx);
    if (!player.dead) moveCircle(e, Math.cos(steer) * sp * dt, Math.sin(steer) * sp * dt);

    moveCircle(e, e.vx * dt, e.vy * dt);
    e.vx *= Math.pow(0.0005, dt); e.vy *= Math.pow(0.0005, dt);

    // separation
    for (let j = i - 1; j >= 0; j--) {
      const o = enemies[j];
      const ox = e.x - o.x, oy = e.y - o.y;
      const dd = Math.hypot(ox, oy), rr = e.r + o.r;
      if (dd < rr && dd > 0.001) {
        const push = (rr - dd) / 2;
        e.x += ox / dd * push; e.y += oy / dd * push;
        o.x -= ox / dd * push; o.y -= oy / dd * push;
      }
    }

    if (!player.dead && d < e.r + player.r + 0.32 && e.attackCd <= 0) {
      e.attackCd = e.type === 'crawler' ? 0.8 : 1.1;
      hurtPlayer(e.dmg, Math.atan2(-dy, -dx));
    }
  }
}

function updateBoss(dt) {
  const b = boss;
  if (b.hitFlash > 0) b.hitFlash -= dt;
  if (b.spawnT < 1) { b.spawnT += dt * 0.6; return; }
  b.stateT += dt;
  b.frame = (b.frame + dt * 4) % 4;
  const dx = player.x - b.x, dy = player.y - b.y;
  const d = Math.hypot(dx, dy) || 0.001;

  const frac = b.hp / b.maxHp;
  const phase = frac < 0.33 ? 2 : frac < 0.66 ? 1 : 0;
  if (phase > b.phase) {
    b.phase = phase; sfxRoar(); game.lightning = 0.35;
    b.state = 'summon'; b.stateT = 0;
  }
  if (b.staggerT > 0) { b.staggerT -= dt; return; }

  switch (b.state) {
    case 'walk': {
      if (!player.dead) moveCircle(b, dx / d * b.speed * dt, dy / d * b.speed * dt);
      b.attackCd -= dt;
      if (d < 2.2 && b.attackCd <= 0) { b.state = 'swipe'; b.stateT = 0; }
      else if (b.attackCd <= 0 && d > 5) {
        b.state = Math.random() < (0.42 + b.phase * 0.15) ? 'chargePrep' : 'summon';
        b.stateT = 0;
      }
      break;
    }
    case 'swipe': {
      if (b.stateT > 0.45) {
        if (!player.dead && Math.hypot(player.x - b.x, player.y - b.y) < 3) {
          hurtPlayer(30, Math.atan2(b.y - player.y, b.x - player.x));
        }
        addShake(0.35);
        b.state = 'walk'; b.stateT = 0; b.attackCd = 1.4 - b.phase * 0.3;
      }
      break;
    }
    case 'chargePrep': {
      if (b.stateT > 0.7) {
        b.chargeDX = dx / d; b.chargeDY = dy / d;
        b.state = 'charge'; b.stateT = 0; sfxRoar();
      }
      break;
    }
    case 'charge': {
      b.blocked = false;
      moveCircle(b, b.chargeDX * 8.5 * dt, b.chargeDY * 8.5 * dt);
      if (!player.dead && Math.hypot(player.x - b.x, player.y - b.y) < b.r + player.r + 0.3) {
        hurtPlayer(34, Math.atan2(-b.chargeDY, -b.chargeDX));
        b.state = 'walk'; b.stateT = 0; b.attackCd = 2;
      } else if (b.blocked) {
        b.staggerT = 1.8;
        b.state = 'walk'; b.stateT = 0; b.attackCd = 2.2;
        addShake(1); sfxThunder();
        bloodSpray(b.x, b.y, 1.2, 14, 1);
      } else if (b.stateT > 1.5) { b.state = 'walk'; b.stateT = 0; b.attackCd = 1.5; }
      break;
    }
    case 'summon': {
      if (b.stateT > 0.9) {
        const n = 2 + b.phase;
        for (let k = 0; k < n; k++) {
          const a = rand(TAU), rr = rand(1.5, 3);
          let sx = clamp(b.x + Math.cos(a) * rr, 2, MAP_W - 2);
          let sy = clamp(b.y + Math.sin(a) * rr, 2, MAP_H - 2);
          if (isSolid(Math.floor(sx), Math.floor(sy))) { sx = b.x; sy = b.y; }
          spawnEnemy(Math.random() < 0.6 ? 'crawler' : 'shambler', sx, sy, true);
        }
        b.state = 'walk'; b.stateT = 0; b.attackCd = 3 - b.phase * 0.5;
      }
      break;
    }
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.bob += dt * 3;
    if (player.dead) continue;
    if (Math.hypot(p.x - player.x, p.y - player.y) < 0.7) {
      const wR = player.weapons[0], wS = player.weapons[1], wF = player.weapons[2];
      if (p.kind === 'medkit') {
        if (player.hp >= player.maxHp) continue;
        player.hp = Math.min(player.maxHp, player.hp + 35);
      } else if (p.kind === 'ammoR') wR.reserve = Math.min(120, wR.reserve + 12);
      else if (p.kind === 'ammoS') { if (!wS.owned) continue; wS.reserve = Math.min(60, wS.reserve + 5); }
      else if (p.kind === 'ammoF') { if (!wF.owned) continue; wF.reserve = Math.min(40, wF.reserve + 4); }
      else if (p.kind === 'shotgun') { wS.owned = true; wS.ammo = 6; wS.reserve = 12; player.weapon = 1; }
      else if (p.kind === 'rifle') { wF.owned = true; wF.ammo = 5; wF.reserve = 15; player.weapon = 2; }
      sfxPickup();
      pickups.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vz -= 9.5 * dt;
    p.vx *= Math.pow(0.35, dt); p.vy *= Math.pow(0.35, dt);
    if (p.z <= 0 || p.life <= 0) {
      if (p.kind === 'blood' && p.z <= 0) bloodSplat(p.x, p.y, rand(0.03, 0.11));
      particles.splice(i, 1);
    }
  }
}

function updateGibs(dt) {
  for (let i = gibs.length - 1; i >= 0; i--) {
    const g = gibs[i];
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    g.vz -= 11 * dt;
    if (g.z <= 0) {
      g.z = 0;
      if (g.vz < -1.4 && g.bounces < 2) {
        g.vz = -g.vz * 0.35; g.bounces++;
        bloodSplat(g.x, g.y, g.size * 3);
        if (Math.random() < 0.4) sfxSquelch(false, g.x, g.y);
      } else {
        bloodSplat(g.x, g.y, g.size * 3.5);
        decalEllipse(g.x, g.y, g.size * 1.6, g.size * 1.2, g.color, 0.9);
        gibs.splice(i, 1);
        continue;
      }
    }
    g.vx *= Math.pow(0.25, dt); g.vy *= Math.pow(0.25, dt);
    if (g.z < 0.1 && Math.hypot(g.vx, g.vy) > 1 && Math.random() < dt * 20) bloodSplat(g.x, g.y, g.size * 2);
  }
}

/* =============================== RENDERING ================================ */
const FOG_R = 14, FOG_G = 18, FOG_B = 26;

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (game.state === 'title') { renderTitle(); return; }
  if (game.state === 'card') { renderCard(); return; }

  renderWorld();

  // Upscale the world into the display canvas, with shake
  ctx.save();
  ctx.translate(VW / 2 + cam.shakeX, VH / 2 + cam.shakeY);
  ctx.rotate(cam.shakeR);
  const os = 1.06;   // slight overscan so shake never shows the edge
  ctx.drawImage(fbCanvas, -VW / 2 * os, -VH / 2 * os, VW * os, VH * os);
  ctx.restore();

  drawViewmodel();
  renderGrade();
  renderHUD();
  renderLetterbox();

  if (game.state === 'dead') renderDeath();
  if (game.state === 'win') renderWin();
  if (game.paused && game.state === 'play') renderPause();
}

function renderWorld() {
  const dirX = Math.cos(player.dir), dirY = Math.sin(player.dir);
  const fov = currentFov();
  const planeX = -dirY * fov, planeY = dirX * fov;

  // Eye height & head bob (in wall-height units, 0.5 = eye level)
  const bobY = Math.sin(player.bob * 2) * 1.6 * player.bobAmt + player.kick * 5;
  const deadDrop = player.dead ? player.deadFall * RH * 0.22 : 0;
  const horizon = Math.floor(RH / 2 + player.pitch + bobY - deadDrop);
  const posZ = 0.5 * RH;                 // camera height in pixels

  const fogLevel = CHAPTERS[game.chapter] ? CHAPTERS[game.chapter].fog : 1;
  const lightning = clamp(game.lightning / 0.5, 0, 1);
  // Glass gathers a little light of its own.
  const aimT = easeAds(player.ads);
  const ambient = 0.085 + lightning * 0.42 + game.muzzleLight + aimT * 0.05;
  const flashPower = 1.7 + game.muzzleLight * 4;
  // The beam covers a fixed angle of the WORLD, so zooming in spreads it across
  // more of the screen. Rebuild the horizontal falloff whenever the zoom moves.
  const zoom = FOV / fov;
  const BEAM_HALF = 0.44;
  for (let x = 0; x < RW; x++) {
    const camX = 2 * x / RW - 1;
    const ang = Math.atan(camX * fov);
    flashX[x] = Math.pow(clamp(1 - Math.abs(ang) / BEAM_HALF, 0, 1), 1.7);
  }
  // Fog closes in during the early chapters; glass cuts through a little of it.
  const fogDist = (15 - fogLevel * 6.5) * (1 + player.ads * (scopedWeapon() ? 1.5 : 0.35));

  // Vertical flashlight falloff — same angular reasoning as the horizontal LUT
  const vSpan = RH * 0.55 * zoom;
  for (let y = 0; y < RH; y++) {
    const t = Math.abs(y - (horizon + RH * 0.06 * zoom)) / vSpan;
    flashY[y] = Math.pow(clamp(1 - t, 0, 1), 1.5);
  }

  // ---------- SKY (above the horizon): night fog, lightning-lit ----------
  for (let y = 0; y < Math.min(horizon, RH); y++) {
    if (y < 0) continue;
    const t = clamp(y / Math.max(1, horizon), 0, 1);
    const glow = 0.25 + t * 0.75;
    let r = (FOG_R * glow + lightning * 120) | 0;
    let g = (FOG_G * glow + lightning * 130) | 0;
    let b = (FOG_B * glow + lightning * 150) | 0;
    const c = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
    fb.fill(c, y * RW, y * RW + RW);
  }

  // ---------- FLOOR CASTING ----------
  // The inner loop runs once per floor pixel, so everything here is hoisted,
  // bit-truncated and branch-light on purpose.
  const rayX0 = dirX - planeX, rayY0 = dirY - planeY;
  const rayX1 = dirX + planeX, rayY1 = dirY + planeY;
  const fogFill = 0xff000000 | (FOG_B << 16) | (FOG_G << 8) | FOG_R;
  const flick = game.lampFlicker;
  const px0 = player.x, py0 = player.y;
  const _floors = floors, _decals = decals, _lightmap = lightmap, _flashX = flashX;
  const decLen = _decals.length, lmLen = _lightmap.length;

  for (let y = Math.max(0, horizon + 1); y < RH; y++) {
    const p = y - horizon;
    const rowDist = posZ / p;
    // Past the fog wall there is nothing to draw but fog.
    if (rowDist >= fogDist) { fb.fill(fogFill, y * RW, y * RW + RW); continue; }

    const stepX = rowDist * (rayX1 - rayX0) / RW;
    const stepY = rowDist * (rayY1 - rayY0) / RW;
    let fx = px0 + rowDist * rayX0;
    let fy = py0 + rowDist * rayY0;

    const fog = rowDist / fogDist;
    const fogW = fog * fog;
    const invFog = 1 - fogW;
    const fogRw = FOG_R * fogW, fogGw = FOG_G * fogW, fogBw = FOG_B * fogW;
    const distLight = 1 / (1 + rowDist * rowDist * 0.055);
    const fyLight = flashY[y] * flashPower * distLight;
    const lampMul = flick * distLight * 2.4 / 255;
    const rowIdx = y * RW;

    for (let x = 0; x < RW; x++) {
      const cx = fx | 0, cy = fy | 0;
      const ci = cy * MAP_W + cx;
      const ft = floorTex[(ci >= 0 && ci < _floors.length) ? _floors[ci] : F_GRASS];
      const c = ft[((((fy - cy) * TEX) | 0) & 63) * TEX + ((((fx - cx) * TEX) | 0) & 63)];
      let r = c & 0xff, g = (c >>> 8) & 0xff, b = (c >>> 16) & 0xff;

      // Persistent blood
      const dIdx = ((fy * DEC_PER_CELL) | 0) * DEC_W + ((fx * DEC_PER_CELL) | 0);
      if (dIdx >= 0 && dIdx < decLen) {
        const dc = _decals[dIdx];
        if (dc > 0xffffff) {           // any alpha at all
          const da = (dc >>> 24) * 0.00392, ida = 1 - da;
          r = r * ida + (dc & 0xff) * da;
          g = g * ida + ((dc >>> 8) & 0xff) * da;
          b = b * ida + ((dc >>> 16) & 0xff) * da;
        }
      }

      const li = ((fy * LM_PER_CELL) | 0) * LM_W + ((fx * LM_PER_CELL) | 0);
      const lamp = (li >= 0 && li < lmLen ? _lightmap[li] : 0) * lampMul;
      const light = ambient + _flashX[x] * fyLight + lamp;
      // Cold night grade folded straight into the light — a full-screen
      // composite pass for this cost more than the whole raycaster.
      r = r * light * 0.95 + lamp * 26;
      g = g * light * 0.99 + lamp * 16;
      b = b * light * 1.08 + lamp * 2;

      r = r * invFog + fogRw;
      g = g * invFog + fogGw;
      b = b * invFog + fogBw;
      if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;

      fb[rowIdx + x] = 0xff000000 | (b << 16) | (g << 8) | r;
      fx += stepX; fy += stepY;
    }
  }

  // ---------- WALLS (DDA per column) ----------
  for (let x = 0; x < RW; x++) {
    const camX = 2 * x / RW - 1;
    const rdX = dirX + planeX * camX, rdY = dirY + planeY * camX;
    let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
    const dDistX = Math.abs(1 / (rdX || 1e-9)), dDistY = Math.abs(1 / (rdY || 1e-9));
    let stepX, stepY, sideDistX, sideDistY;
    if (rdX < 0) { stepX = -1; sideDistX = (player.x - mapX) * dDistX; }
    else { stepX = 1; sideDistX = (mapX + 1 - player.x) * dDistX; }
    if (rdY < 0) { stepY = -1; sideDistY = (player.y - mapY) * dDistY; }
    else { stepY = 1; sideDistY = (mapY + 1 - player.y) * dDistY; }

    let side = 0, tile = 0, steps = 0;
    while (steps++ < 96) {
      if (sideDistX < sideDistY) { sideDistX += dDistX; mapX += stepX; side = 0; }
      else { sideDistY += dDistY; mapY += stepY; side = 1; }
      tile = wallAt(mapX, mapY);
      if (tile !== W_NONE) break;
    }
    const perp = side === 0 ? (sideDistX - dDistX) : (sideDistY - dDistY);
    zbuf[x] = perp;
    if (tile === W_NONE || perp > 46) continue;

    const lineH = Math.round(RH / perp);
    let drawStart = -lineH / 2 + horizon;
    let drawEnd = lineH / 2 + horizon;
    const y0 = Math.max(0, Math.ceil(drawStart)), y1 = Math.min(RH - 1, Math.floor(drawEnd));
    if (y1 < y0) continue;

    // Texture column
    let wallX = side === 0 ? player.y + perp * rdY : player.x + perp * rdX;
    wallX -= Math.floor(wallX);
    let texX = (wallX * TEX) | 0;
    if ((side === 0 && rdX > 0) || (side === 1 && rdY < 0)) texX = TEX - texX - 1;
    const tex = wallTex[tile] || wallTex[W_BRICK];

    const fog = clamp(perp / fogDist, 0, 1);
    const fogW = fog * fog;
    const invFogW = 1 - fogW;
    const fogRw2 = FOG_R * fogW, fogGw2 = FOG_G * fogW, fogBw2 = FOG_B * fogW;
    const distLight = 1 / (1 + perp * perp * 0.05);
    const sideDim = side === 1 ? 0.68 : 1;
    // Wall lightmap sample (a touch inside the wall face)
    const lx = clamp(Math.floor((mapX + 0.5) * LM_PER_CELL), 0, LM_W - 1);
    const ly = clamp(Math.floor((mapY + 0.5) * LM_PER_CELL), 0, LM_H - 1);
    const lampW = (lightmap[ly * LM_W + lx] / 255) * game.lampFlicker * distLight * 1.8;
    const fxl = flashX[x] * flashPower * distLight;

    const step = TEX / lineH;
    let texPos = (y0 - horizon + lineH / 2) * step;
    for (let y = y0; y <= y1; y++) {
      const texY = texPos & 63;
      texPos += step;
      const c = tex[texY * TEX + texX];
      let r = (c & 0xff) * sideDim, g = ((c >>> 8) & 0xff) * sideDim, b = ((c >>> 16) & 0xff) * sideDim;
      const light = ambient + fxl * flashY[y] + lampW;
      r *= light * 0.95; g *= light * 0.99; b *= light * 1.08;
      if (lampW > 0.01) { r += lampW * 24; g += lampW * 14; b += lampW * 2; }
      r = r * invFogW + fogRw2;
      g = g * invFogW + fogGw2;
      b = b * invFogW + fogBw2;
      if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      fb[y * RW + x] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }

  // ---------- SPRITES ----------
  const list = [];
  for (const e of enemies) list.push({ o: e, kind: 'enemy' });
  if (boss) list.push({ o: boss, kind: 'boss' });
  for (const p of pickups) list.push({ o: p, kind: 'pickup' });
  for (const g of gibs) list.push({ o: g, kind: 'gib' });
  for (const p of particles) list.push({ o: p, kind: 'particle' });
  for (const l of lamps) list.push({ o: l, kind: 'lamp' });
  for (const a of acidPools) list.push({ o: a, kind: 'acid' });
  for (const t of tracers) list.push({ o: t, kind: 'tracer' });
  for (const s of list) s.d = (s.o.x - player.x) * (s.o.x - player.x) + (s.o.y - player.y) * (s.o.y - player.y);
  list.sort((a, b) => b.d - a.d);

  const invDet = 1 / (planeX * dirY - dirX * planeY);
  for (const s of list) {
    const o = s.o;
    const spx = o.x - player.x, spy = o.y - player.y;
    const transX = invDet * (dirY * spx - dirX * spy);
    const transY = invDet * (-planeY * spx + planeX * spy);   // depth
    if (transY < 0.12) continue;
    const screenX = Math.floor((RW / 2) * (1 + transX / transY));
    const fog = clamp(transY / fogDist, 0, 1);
    const fogW = fog * fog;
    const distLight = 1 / (1 + transY * transY * 0.05);
    const lx = clamp(Math.floor(o.x * LM_PER_CELL), 0, LM_W - 1);
    const ly = clamp(Math.floor(o.y * LM_PER_CELL), 0, LM_H - 1);
    const lampL = (lightmap[ly * LM_W + lx] / 255) * game.lampFlicker * distLight * 2.2;
    const beam = (screenX >= 0 && screenX < RW ? flashX[screenX] : 0) * flashPower * distLight;

    if (s.kind === 'enemy' || s.kind === 'boss') {
      const isBoss = s.kind === 'boss';
      const frames = isBoss ? (o.state === 'swipe' || o.state === 'chargePrep' ? [SPR.bossSwipe] : SPR.boss) : SPR[o.type];
      const spr = frames[Math.floor(o.frame) % frames.length];
      const em = clamp(o.spawnT, 0, 1);
      const hgt = o.height * em;
      drawSprite(spr, transX, transY, hgt, 0, ambient + beam * flashY[clamp(Math.floor(horizon + RH * 0.05), 0, RH - 1)] + lampL,
        fogW, o.hitFlash > 0 ? 0.85 : 0, em, horizon, posZ);
    } else if (s.kind === 'pickup') {
      const spr = o.kind === 'medkit' ? SPR.medkit : o.kind === 'ammoR' ? SPR.ammoR :
                  o.kind === 'ammoS' ? SPR.ammoS : o.kind === 'ammoF' ? SPR.ammoF :
                  o.kind === 'rifle' ? SPR.riflePickup : SPR.shotgunPickup;
      const bob = Math.sin(o.bob) * 0.04;
      drawSprite(spr, transX, transY, 0.16, 0.06 + bob, Math.max(0.55, ambient + beam + lampL), fogW * 0.6, 0, 1, horizon, posZ);
    } else if (s.kind === 'lamp') {
      drawSprite(SPR.lamp, transX, transY, 0.26, 0.82, game.lampFlicker * (o.dying && Math.sin(game.time * 3 + o.phase) < -0.5 ? 0.06 : 1.7),
        fogW * 0.3, 0, 1, horizon, posZ);
    } else if (s.kind === 'gib') {
      drawBlock(transX, transY, o.z, o.size, o.color, Math.min(1.3, ambient + beam + lampL), fogW, horizon, posZ);
    } else if (s.kind === 'particle') {
      const l = o.kind === 'spark' ? 3 : Math.min(1.15, ambient + beam + lampL);
      drawBlock(transX, transY, o.z, o.size, o.color, l, fogW * 0.8, horizon, posZ);
    } else if (s.kind === 'acid') {
      drawAcid(transX, transY, o, horizon, posZ, fogW);
    } else if (s.kind === 'tracer') {
      drawTracer(o, dirX, dirY, planeX, planeY, invDet, horizon, posZ);
    }
  }

  applyFilmGrain();
  fbCtx.putImageData(fbImage, 0, 0);
}

// 16mm grain, added in the framebuffer from a fixed noise table.
// Doing this as a full-screen 'overlay' composite instead cost ~14ms a frame.
const NOISE_BITS = 16, NOISE_N = 1 << NOISE_BITS, NOISE_MASK = NOISE_N - 1;
const noiseTab = new Int8Array(NOISE_N);
for (let i = 0; i < NOISE_N; i++) noiseTab[i] = (Math.random() * 2 - 1) * 40;

function applyFilmGrain() {
  const n = fb.length;
  const off = (Math.random() * NOISE_N) | 0;
  for (let i = 0; i < n; i++) {
    const c = fb[i];
    // Grain rides on the image: heavy in the midtones, almost gone in the blacks.
    const g0 = (c >>> 8) & 0xff;
    const v = (noiseTab[(i + off) & NOISE_MASK] * (18 + g0)) >> 8;
    let r = (c & 0xff) + v, g = ((c >>> 8) & 0xff) + v, b = ((c >>> 16) & 0xff) + v;
    if (r < 0) r = 0; else if (r > 255) r = 255;
    if (g < 0) g = 0; else if (g > 255) g = 255;
    if (b < 0) b = 0; else if (b > 255) b = 255;
    fb[i] = 0xff000000 | (b << 16) | (g << 8) | r;
  }
}

// Billboard a sprite. height = world height in wall units; lift = height off the floor.
function drawSprite(spr, transX, transY, height, lift, light, fogW, whiteFlash, alphaScale, horizon, posZ) {
  const scale = (RH / transY);
  const sh = Math.round(height * scale);
  const sw = Math.round(sh * (spr.w / spr.h));
  if (sw <= 0 || sh <= 0) return;
  const screenX = Math.floor((RW / 2) * (1 + transX / transY));
  const bottom = Math.floor(horizon + posZ / transY - lift * scale);
  const top = bottom - sh;
  const x0 = Math.max(0, screenX - (sw >> 1)), x1 = Math.min(RW - 1, screenX + (sw >> 1));
  const y0 = Math.max(0, top), y1 = Math.min(RH - 1, bottom);
  const lr = clamp(light, 0, 3);

  for (let x = x0; x <= x1; x++) {
    if (transY >= zbuf[x]) continue;
    const tx = Math.floor((x - (screenX - (sw >> 1))) * spr.w / sw);
    if (tx < 0 || tx >= spr.w) continue;
    for (let y = y0; y <= y1; y++) {
      const ty = Math.floor((y - top) * spr.h / sh);
      if (ty < 0 || ty >= spr.h) continue;
      const c = spr.px[ty * spr.w + tx];
      const a = (c >>> 24) / 255;
      if (a < 0.35) continue;
      let r = (c & 0xff) * lr * 0.95, g = ((c >>> 8) & 0xff) * lr * 0.99, b = ((c >>> 16) & 0xff) * lr * 1.08;
      if (whiteFlash > 0) { r = lerp(r, 255, whiteFlash); g = lerp(g, 255, whiteFlash); b = lerp(b, 255, whiteFlash); }
      r = r * (1 - fogW) + FOG_R * fogW;
      g = g * (1 - fogW) + FOG_G * fogW;
      b = b * (1 - fogW) + FOG_B * fogW;
      if (alphaScale < 1) {
        const dst = fb[y * RW + x];
        r = lerp(dst & 0xff, r, alphaScale);
        g = lerp((dst >>> 8) & 0xff, g, alphaScale);
        b = lerp((dst >>> 16) & 0xff, b, alphaScale);
      }
      fb[y * RW + x] = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
    }
  }
}

// A small solid billboard cube — gibs, blood motes, sparks
function drawBlock(transX, transY, z, size, color, light, fogW, horizon, posZ) {
  const scale = RH / transY;
  const s = Math.max(1, Math.round(size * scale));
  const screenX = Math.floor((RW / 2) * (1 + transX / transY));
  const bottom = Math.floor(horizon + posZ / transY - z * scale);
  const x0 = Math.max(0, screenX - (s >> 1)), x1 = Math.min(RW - 1, screenX + (s >> 1));
  const y0 = Math.max(0, bottom - s), y1 = Math.min(RH - 1, bottom);
  const lr = clamp(light, 0, 3);
  let r = (color & 0xff) * lr, g = ((color >>> 8) & 0xff) * lr, b = ((color >>> 16) & 0xff) * lr;
  r = r * (1 - fogW) + FOG_R * fogW;
  g = g * (1 - fogW) + FOG_G * fogW;
  b = b * (1 - fogW) + FOG_B * fogW;
  const c = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
  for (let x = x0; x <= x1; x++) {
    if (transY >= zbuf[x]) continue;
    for (let y = y0; y <= y1; y++) fb[y * RW + x] = c;
  }
}

function drawAcid(transX, transY, a, horizon, posZ, fogW) {
  // A sickly glow on the ground where the bloater came apart
  const scale = RH / transY;
  const s = Math.max(2, Math.round(a.r * scale * 1.4));
  const screenX = Math.floor((RW / 2) * (1 + transX / transY));
  const bottom = Math.floor(horizon + posZ / transY);
  const alpha = clamp(a.life / 7, 0, 1) * 0.5;
  const x0 = Math.max(0, screenX - s), x1 = Math.min(RW - 1, screenX + s);
  const y0 = Math.max(0, bottom - (s >> 2)), y1 = Math.min(RH - 1, bottom + (s >> 3));
  for (let x = x0; x <= x1; x++) {
    if (transY >= zbuf[x]) continue;
    for (let y = y0; y <= y1; y++) {
      const dst = fb[y * RW + x];
      const r = lerp(dst & 0xff, 150, alpha * 0.5);
      const g = lerp((dst >>> 8) & 0xff, 210, alpha * 0.7);
      const b = lerp((dst >>> 16) & 0xff, 70, alpha * 0.4);
      fb[y * RW + x] = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
    }
  }
}

function drawTracer(t, dirX, dirY, planeX, planeY, invDet, horizon, posZ) {
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const wx = t.x + t.dx * t.len * f, wy = t.y + t.dy * t.len * f;
    const spx = wx - player.x, spy = wy - player.y;
    const tX = invDet * (dirY * spx - dirX * spy);
    const tY = invDet * (-planeY * spx + planeX * spy);
    if (tY < 0.2) continue;
    drawBlock(tX, tY, 0.5, 0.02, 0xff9fd8ff, 3, 0, horizon, posZ);
  }
}

/* ------------------------------- VIEWMODEL -------------------------------- */
function drawViewmodel() {
  if (player.dead || game.state !== 'play') return;
  const w = player.weapons[player.weapon];
  const bar = Math.min(70, VH * 0.085);
  const a = easeAds(player.ads);
  const s = Math.min(VW / 1280, VH / 800) * 1.35 * (1 + a * 0.12);
  const bobX = Math.sin(player.bob) * 16 * player.bobAmt;
  const bobY = Math.abs(Math.cos(player.bob)) * 12 * player.bobAmt;
  const kick = player.kick;

  // Hip: low and to the right. Sighted: dead centre, up at eye level.
  const hipX = VW * 0.72, hipY = VH - bar - 4;
  const aimX = VW / 2 + (w.type === 'shotgun' ? -27 : -21) * s;
  const aimY = VH / 2 + (w.type === 'shotgun' ? 300 : 236) * s;
  const ox = lerp(hipX, aimX, a) + bobX * (1 - a * 0.8) + player.kickX * 26 * (1 - a * 0.7);
  const oy = lerp(hipY, aimY, a) + bobY * (1 - a * 0.8);

  // A scope fills the frame, so the gun body is dropped once the glass is up.
  const hideForScope = w.scoped && a > 0.72;
  if (!hideForScope) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    if (w.type === 'revolver') drawRevolver(kick, a);
    else if (w.type === 'shotgun') drawShotgun(kick, a);
    else if (w.type === 'rifle') drawRifle(kick, a);
    else drawAxe();
    ctx.restore();
  }

  if (hideForScope) drawScopeOverlay(a);

  // Muzzle flash lights the whole frame from the barrel
  if (game.muzzleLight > 0.02 && w.type !== 'axe') {
    const mx = ox + (w.type === 'shotgun' ? 27 : w.type === 'rifle' ? 24 : 21) * s;
    const my = oy - (w.type === 'shotgun' ? 320 : w.type === 'rifle' ? 372 : 240) * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(mx, my, 8, mx, my, VW * 0.55);
    const a = game.muzzleLight * 3.2;
    g.addColorStop(0, `rgba(255,225,160,${clamp(a, 0, 0.9)})`);
    g.addColorStop(0.25, `rgba(255,190,100,${clamp(a * 0.4, 0, 0.4)})`);
    g.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }
}

// Guns are drawn looking down them: origin at the bottom of the frame,
// barrel receding up-screen toward the crosshair.
function drawRevolver(kick, aimed) {
  aimed = aimed || 0;
  ctx.save();
  ctx.rotate((-0.05 - kick * 0.13) * (1 - aimed));
  ctx.translate(0, kick * 34);

  // gloved hand wrapped round the grip
  ctx.fillStyle = '#2b2f24';
  ctx.beginPath(); ctx.roundRect(-16, -34, 74, 96, 18); ctx.fill();
  ctx.fillStyle = '#232619';
  ctx.beginPath(); ctx.roundRect(-6, -18, 58, 26, 10); ctx.fill();
  ctx.strokeStyle = '#171a12'; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(-10, 4 + i * 15); ctx.lineTo(46, 1 + i * 15); ctx.stroke();
  }
  // grip
  ctx.fillStyle = '#3a2a18';
  ctx.beginPath(); ctx.roundRect(-2, -46, 40, 66, 8); ctx.fill();
  ctx.fillStyle = '#2b1f12';
  ctx.beginPath(); ctx.roundRect(4, -40, 12, 54, 5); ctx.fill();
  // frame + trigger guard
  ctx.fillStyle = '#43474e';
  ctx.beginPath(); ctx.roundRect(-6, -86, 52, 44, 6); ctx.fill();
  ctx.strokeStyle = '#3a3e44'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(16, -40, 15, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  // cylinder
  ctx.fillStyle = '#565c65';
  ctx.beginPath(); ctx.roundRect(-8, -118, 56, 40, 8); ctx.fill();
  ctx.fillStyle = '#24272c';
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(2 + i * 18, -98, 5.5, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#6a717b';
  ctx.fillRect(-8, -118, 56, 5);
  // barrel
  ctx.fillStyle = '#3d4147';
  ctx.beginPath(); ctx.roundRect(6, -226, 30, 112, 5); ctx.fill();
  ctx.fillStyle = '#4d525a';
  ctx.fillRect(6, -226, 8, 112);
  ctx.fillStyle = '#0d0f12';
  ctx.beginPath(); ctx.ellipse(21, -226, 8, 5, 0, 0, TAU); ctx.fill();
  // rear notch and front blade — line them up
  ctx.fillStyle = '#23262b';
  ctx.fillRect(-4, -128, 48, 12);
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(16, -132, 8, 12);
  ctx.fillStyle = '#2b2e33';
  ctx.fillRect(14, -246, 12, 22);          // front blade
  if (aimed > 0.5) {
    ctx.fillStyle = `rgba(230,90,60,${(aimed - 0.5) * 2})`;
    ctx.fillRect(17.5, -244, 5, 8);        // painted tip catches the light
  }

  if (game.muzzleLight > 0.03) muzzleBurst(21, -228, 52);
  ctx.restore();
}

// A ragged star of burning powder, re-torn every frame it is alive.
function muzzleBurst(x, y, r) {
  const pts = 11;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rand(TAU));
  ctx.fillStyle = 'rgba(255,226,150,0.92)';
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = i / (pts * 2) * TAU;
    const rr = (i % 2 ? r * rand(0.28, 0.5) : r * rand(0.72, 1.25));
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 1.15;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,248,214,0.95)';
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU;
    const rr = r * (i % 2 ? 0.2 : 0.42) * rand(0.85, 1.15);
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawShotgun(kick, aimed) {
  aimed = aimed || 0;
  const pump = player.reloading ? Math.abs(Math.sin(game.time * 11)) * 46 : 0;
  ctx.save();
  ctx.rotate((-0.04 - kick * 0.1) * (1 - aimed));
  ctx.translate(0, kick * 46);

  // stock running back to the shoulder
  ctx.fillStyle = '#3d2c17';
  ctx.beginPath(); ctx.roundRect(10, -40, 62, 130, 12); ctx.fill();
  ctx.fillStyle = '#2f2213';
  ctx.beginPath(); ctx.roundRect(22, -20, 38, 96, 8); ctx.fill();
  // receiver
  ctx.fillStyle = '#43474e';
  ctx.beginPath(); ctx.roundRect(2, -128, 74, 92, 7); ctx.fill();
  ctx.fillStyle = '#53585f';
  ctx.fillRect(2, -128, 12, 92);
  ctx.fillStyle = '#2b2e33';
  ctx.beginPath(); ctx.roundRect(16, -46, 44, 12, 4); ctx.fill();
  // shell port
  ctx.fillStyle = '#16181c';
  ctx.beginPath(); ctx.roundRect(54, -104, 18, 26, 4); ctx.fill();

  // barrel + magazine tube
  ctx.fillStyle = '#3d4147';
  ctx.beginPath(); ctx.roundRect(10, -300, 34, 176, 6); ctx.fill();
  ctx.fillStyle = '#4d525a';
  ctx.fillRect(10, -300, 9, 176);
  ctx.fillStyle = '#34383e';
  ctx.beginPath(); ctx.roundRect(46, -280, 22, 156, 6); ctx.fill();

  // pump forend, worked between shells
  ctx.fillStyle = '#4a3520';
  ctx.beginPath(); ctx.roundRect(4, -252 + pump, 68, 62, 9); ctx.fill();
  ctx.fillStyle = '#3a2917';
  for (let i = 0; i < 6; i++) ctx.fillRect(8, -244 + pump + i * 9, 60, 4);
  // hand on the pump
  ctx.fillStyle = '#2b2f24';
  ctx.beginPath(); ctx.roundRect(-14, -236 + pump, 62, 58, 16); ctx.fill();
  ctx.strokeStyle = '#1a1c14'; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(-10, -222 + pump + i * 14); ctx.lineTo(42, -224 + pump + i * 14); ctx.stroke();
  }
  ctx.fillStyle = '#0d0f12';
  ctx.beginPath(); ctx.ellipse(27, -300, 12, 6, 0, 0, TAU); ctx.fill();
  // brass bead on the rib
  ctx.fillStyle = aimed > 0.5 ? '#e8c96a' : '#8a7a45';
  ctx.beginPath(); ctx.arc(27, -292, 5.5, 0, TAU); ctx.fill();

  if (game.muzzleLight > 0.03) muzzleBurst(27, -302, 82);
  ctx.restore();
}

// Bolt-action deer rifle: walnut stock, blued barrel, glass on top.
function drawRifle(kick, aimed) {
  aimed = aimed || 0;
  const bolt = clamp(player.boltT / 0.75, 0, 1);
  const cycle = Math.sin(bolt * Math.PI);
  ctx.save();
  ctx.rotate((-0.05 - kick * 0.12) * (1 - aimed));
  ctx.translate(0, kick * 40);

  // stock and comb
  ctx.fillStyle = '#4a3018';
  ctx.beginPath(); ctx.roundRect(6, -60, 64, 150, 14); ctx.fill();
  ctx.fillStyle = '#3a2412';
  ctx.beginPath(); ctx.roundRect(18, -30, 40, 112, 9); ctx.fill();
  ctx.fillStyle = '#5c3c1e';
  ctx.beginPath(); ctx.roundRect(2, -150, 58, 96, 10); ctx.fill();
  // checkering on the grip
  ctx.strokeStyle = 'rgba(30,18,8,0.55)'; ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(14 + i * 7, -14); ctx.lineTo(30 + i * 7, 40); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(46 + i * 7, -14); ctx.lineTo(30 + i * 7, 40); ctx.stroke();
  }
  // receiver
  ctx.fillStyle = '#33373d';
  ctx.beginPath(); ctx.roundRect(6, -226, 52, 84, 6); ctx.fill();
  ctx.fillStyle = '#42474e';
  ctx.fillRect(6, -226, 10, 84);
  // bolt handle, thrown back and returned after a shot
  ctx.save();
  ctx.translate(56 + cycle * 26, -186 + cycle * 34);
  ctx.rotate(cycle * 0.7);
  ctx.fillStyle = '#4c525a';
  ctx.beginPath(); ctx.roundRect(0, -7, 40, 14, 6); ctx.fill();
  ctx.beginPath(); ctx.arc(40, 0, 10, 0, TAU); ctx.fill();
  ctx.restore();
  // barrel
  ctx.fillStyle = '#3a3e44';
  ctx.beginPath(); ctx.roundRect(14, -372, 32, 150, 6); ctx.fill();
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(14, -372, 9, 150);
  ctx.fillStyle = '#0d0f12';
  ctx.beginPath(); ctx.ellipse(30, -372, 11, 6, 0, 0, TAU); ctx.fill();
  // scope tube and rings
  ctx.fillStyle = '#1c1f24';
  ctx.beginPath(); ctx.roundRect(8, -340, 48, 132, 10); ctx.fill();
  ctx.fillStyle = '#2a2e35';
  ctx.beginPath(); ctx.roundRect(2, -318, 60, 26, 6); ctx.fill();
  ctx.beginPath(); ctx.roundRect(2, -246, 60, 26, 6); ctx.fill();
  ctx.fillStyle = '#0a0c0f';
  ctx.beginPath(); ctx.ellipse(32, -340, 24, 11, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(120,190,200,0.35)';
  ctx.beginPath(); ctx.ellipse(32, -340, 18, 8, 0, 0, TAU); ctx.fill();
  // forend
  ctx.fillStyle = '#4a3018';
  ctx.beginPath(); ctx.roundRect(8, -300 + 0, 46, 84, 10); ctx.fill();
  // support hand
  ctx.fillStyle = '#2b2f24';
  ctx.beginPath(); ctx.roundRect(-14, -272, 60, 58, 16); ctx.fill();
  ctx.strokeStyle = '#1a1c14'; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(-10, -258 + i * 14); ctx.lineTo(40, -260 + i * 14); ctx.stroke();
  }
  if (game.muzzleLight > 0.03) muzzleBurst(30, -374, 74);
  ctx.restore();
}

function drawAxe() {
  // Rests over the right shoulder, then comes down across the frame.
  const sw = clamp(player.swing / 0.34, 0, 1);
  const chop = Math.sin(sw * Math.PI);
  ctx.save();
  ctx.rotate(0.42 - chop * 1.7);
  ctx.translate(chop * -60, chop * 90);

  // haft running down out of frame
  ctx.fillStyle = '#4a3520';
  ctx.beginPath(); ctx.roundRect(-15, -230, 30, 300, 9); ctx.fill();
  ctx.fillStyle = '#3a2917';
  for (let i = 0; i < 6; i++) ctx.fillRect(-15, -30 + i * 17, 30, 5);
  // both hands on the haft
  ctx.fillStyle = '#2b2f24';
  ctx.beginPath(); ctx.roundRect(-30, -34, 60, 52, 16); ctx.fill();
  ctx.fillStyle = '#232619';
  ctx.beginPath(); ctx.roundRect(-28, 26, 56, 48, 15); ctx.fill();
  ctx.strokeStyle = '#1a1c14'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-24, -14); ctx.lineTo(24, -14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-22, 46); ctx.lineTo(22, 46); ctx.stroke();

  // collar and head
  ctx.fillStyle = '#20242a';
  ctx.beginPath(); ctx.roundRect(-19, -238, 38, 24, 4); ctx.fill();
  ctx.fillStyle = '#7d1b16';
  ctx.beginPath();
  ctx.moveTo(-14, -234); ctx.lineTo(-94, -262); ctx.lineTo(-104, -202); ctx.lineTo(-14, -190);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5d1410';
  ctx.beginPath();
  ctx.moveTo(-14, -212); ctx.lineTo(-101, -220); ctx.lineTo(-104, -202); ctx.lineTo(-14, -190);
  ctx.closePath(); ctx.fill();
  // honed edge
  ctx.fillStyle = '#c2c7cf';
  ctx.beginPath();
  ctx.moveTo(-84, -260); ctx.lineTo(-101, -250); ctx.lineTo(-108, -204); ctx.lineTo(-92, -198);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8e949c';
  ctx.beginPath();
  ctx.moveTo(-84, -260); ctx.lineTo(-93, -255); ctx.lineTo(-100, -206); ctx.lineTo(-92, -198);
  ctx.closePath(); ctx.fill();
  // it never gets clean
  ctx.fillStyle = 'rgba(90,14,17,0.9)';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.ellipse(-34 - i * 8, -230 + Math.sin(i * 1.7) * 17, 4 + (i % 3), 7, 0.4, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(90,14,17,0.75)'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-48, -196); ctx.lineTo(-42, -150); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-20, -188); ctx.lineTo(-16, -140); ctx.stroke();
  ctx.restore();
}

// Looking through the glass: everything outside the tube goes black.
function drawScopeOverlay(a) {
  const cx = VW / 2, cy = VH / 2;
  const R = Math.min(VW, VH) * 0.37;
  // The scope drifts a little with breathing and settles when you hold still.
  const sway = (1 - 0.65 * (player.moving ? 0 : 1));
  const dx = Math.sin(game.time * 1.7) * 5 * sway + Math.sin(game.time * 0.9) * 3;
  const dy = Math.cos(game.time * 1.3) * 4 * sway + player.kick * 30;
  const ox = cx + dx, oy = cy + dy;

  ctx.save();
  ctx.globalAlpha = clamp((a - 0.72) / 0.28, 0, 1);

  // scope body — everything outside the tube
  ctx.beginPath();
  ctx.rect(0, 0, VW, VH);
  ctx.arc(ox, oy, R, 0, TAU, true);
  ctx.fillStyle = '#000';
  ctx.fill();

  // eye-relief shadow around the inside of the tube
  const g = ctx.createRadialGradient(ox, oy, R * 0.74, ox, oy, R);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ox, oy, R, 0, TAU); ctx.fill();

  // a breath of glass glare across the top-left
  const gl = ctx.createLinearGradient(ox - R, oy - R, ox + R * 0.3, oy + R * 0.4);
  gl.addColorStop(0, 'rgba(150,210,220,0.10)');
  gl.addColorStop(0.5, 'rgba(150,210,220,0.02)');
  gl.addColorStop(1, 'rgba(150,210,220,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(ox, oy, R, 0, TAU); ctx.fill();

  // tube rim
  ctx.strokeStyle = 'rgba(20,22,26,0.95)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(ox, oy, R + 3, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,96,105,0.45)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(ox, oy, R - 1, 0, TAU); ctx.stroke();

  // ---- duplex reticle ----
  ctx.save();
  ctx.beginPath(); ctx.arc(ox, oy, R - 2, 0, TAU); ctx.clip();
  const thin = 1.8, thick = 5;
  ctx.strokeStyle = 'rgba(10,10,12,0.95)';
  // heavy outer posts
  ctx.lineWidth = thick;
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([px, py]) => {
    ctx.beginPath();
    ctx.moveTo(ox + px * R, oy + py * R);
    ctx.lineTo(ox + px * R * 0.42, oy + py * R * 0.42);
    ctx.stroke();
  });
  // fine crosshair with a gap at the centre
  ctx.lineWidth = thin;
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([px, py]) => {
    ctx.beginPath();
    ctx.moveTo(ox + px * R * 0.44, oy + py * R * 0.44);
    ctx.lineTo(ox + px * R * 0.045, oy + py * R * 0.045);
    ctx.stroke();
  });
  // mil ticks down the vertical for holdover
  ctx.lineWidth = 1.4;
  for (let i = 1; i <= 4; i++) {
    const ty = oy + R * 0.1 * i;
    const len = i % 2 === 0 ? 9 : 5;
    ctx.beginPath(); ctx.moveTo(ox - len, ty); ctx.lineTo(ox + len, ty); ctx.stroke();
  }
  for (let i = 1; i <= 3; i++) {
    const tx = ox + R * 0.12 * i;
    ctx.beginPath(); ctx.moveTo(tx, oy - 4); ctx.lineTo(tx, oy + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox - R * 0.12 * i, oy - 4); ctx.lineTo(ox - R * 0.12 * i, oy + 4); ctx.stroke();
  }
  // A dull red glow on the inner cross so it reads against the dark
  ctx.strokeStyle = 'rgba(196,44,38,0.85)';
  ctx.lineWidth = 1.5;
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([px, py]) => {
    ctx.beginPath();
    ctx.moveTo(ox + px * R * 0.2, oy + py * R * 0.2);
    ctx.lineTo(ox + px * R * 0.045, oy + py * R * 0.045);
    ctx.stroke();
  });
  ctx.fillStyle = 'rgba(226,60,48,0.95)';
  ctx.beginPath(); ctx.arc(ox, oy, 1.9, 0, TAU); ctx.fill();
  ctx.shadowColor = 'rgba(226,60,48,0.7)'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(ox, oy, 1.2, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
  ctx.restore();
}

/* --------------------------- GRADE & OVERLAYS ----------------------------- */
const grainC = document.createElement('canvas');
grainC.width = 180; grainC.height = 110;
const grainCtx = grainC.getContext('2d');
let grainFrame = 0;
let vignetteC = null;

function buildVignette() {
  vignetteC = document.createElement('canvas');
  vignetteC.width = VW; vignetteC.height = VH;
  const vc = vignetteC.getContext('2d');
  const g = vc.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.68)');
  vc.fillStyle = g;
  vc.fillRect(0, 0, VW, VH);
}

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

function renderGrain() {
  grainFrame++;
  if (grainFrame % 2 === 0) {
    const img = grainCtx.createImageData(180, 110);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    grainCtx.putImageData(img, 0, 0);
  }
  // Menus and story cards have no framebuffer to grain, so they get a plain
  // alpha blend — 'overlay' here is far too expensive to run every frame.
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.drawImage(grainC, 0, 0, VW, VH);
  ctx.restore();
}

function renderGrade() {
  // The cold grade and the grain both live in the framebuffer now; only the
  // vignette and the wet-lens effects are worth a full-resolution pass.
  ctx.drawImage(vignetteC, 0, 0);

  if (player.hurtFlash > 0) {
    ctx.fillStyle = `rgba(140,10,14,${player.hurtFlash * 0.4})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  if (player.hp < 35 && !player.dead) {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5);
    ctx.fillStyle = `rgba(90,6,10,${0.14 + 0.12 * pulse * (1 - player.hp / 35)})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  for (let i = screenSplats.length - 1; i >= 0; i--) {
    const s = screenSplats[i];
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(s.rot);
    ctx.globalAlpha = s.alpha;
    ctx.drawImage(splatSprite, -s.size / 2, -s.size / 2, s.size, s.size);
    ctx.restore();
    s.alpha -= 0.0016;
    if (s.alpha <= 0) screenSplats.splice(i, 1);
  }
  ctx.globalAlpha = 1;

  if (game.chapterDone) {
    ctx.fillStyle = `rgba(0,0,0,${clamp(game.fadeOut / 2.2, 0, 1)})`;
    ctx.fillRect(0, 0, VW, VH);
  }
}

function renderLetterbox() {
  const bar = Math.min(70, VH * 0.085);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VW, bar);
  ctx.fillRect(0, VH - bar, VW, bar);
}

/* --------------------------------- HUD ------------------------------------ */
function typeSet(size, mono, color) {
  ctx.font = `${mono ? '' : 'bold '}${size}px ${mono ? "'Courier New', monospace" : 'Georgia, serif'}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
}

function renderHUD() {
  if (game.state !== 'play') return;
  const bar = Math.min(70, VH * 0.085);
  ctx.save();

  // Crosshair — four faint ticks, opening up with recoil.
  // The sights replace it entirely once they are up.
  if (!player.dead && player.ads < 0.45) {
    ctx.globalAlpha = 1 - player.ads / 0.45;
    const cx = VW / 2, cy = VH / 2;
    const sp = 7 + player.kick * 22 + (player.moving ? 4 : 0);
    ctx.strokeStyle = 'rgba(220,215,200,0.5)';
    ctx.lineWidth = 1.5;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * sp, cy + dy * sp);
      ctx.lineTo(cx + dx * (sp + 6), cy + dy * (sp + 6));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(220,215,200,0.35)';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    ctx.globalAlpha = 1;
  }

  // Directional damage indicators
  for (const d of damageDirs) {
    const rel = angDiff(player.dir, d.a);
    ctx.save();
    ctx.translate(VW / 2, VH / 2);
    ctx.rotate(rel + Math.PI / 2);
    ctx.globalAlpha = clamp(d.t, 0, 1) * 0.75;
    ctx.strokeStyle = '#c0242c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(VW, VH) * 0.2, -0.45 - Math.PI / 2, 0.45 - Math.PI / 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Health
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
  ctx.fillStyle = 'rgba(120,130,140,0.25)';
  ctx.fillRect(hx, hy + 18, hw, 4);
  ctx.fillStyle = 'rgba(170,185,200,0.55)';
  ctx.fillRect(hx, hy + 18, hw * (player.stamina / 100), 4);

  // Weapon + ammo
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
    ctx.font = "13px 'Courier New', monospace";
    if (player.reloading) { ctx.fillStyle = '#c9a84c'; ctx.fillText('RELOADING…', VW - 36, VH - bar - 62); }
    else if (w.ammo === 0 && w.reserve === 0) { ctx.fillStyle = '#c0242c'; ctx.fillText('FIND AMMO', VW - 36, VH - bar - 62); }
    else if (w.type === 'rifle' && player.boltT > 0.35) { ctx.fillStyle = '#c9a84c'; ctx.fillText('WORKING THE BOLT', VW - 36, VH - bar - 62); }
    if (player.ads > 0.7 && w.scoped) {
      ctx.fillStyle = 'rgba(200,192,178,0.75)';
      ctx.fillText(`${(FOV / adsFovTarget()).toFixed(1)}x`, VW - 36, VH - bar - 82);
    }
  }

  // Objective line
  ctx.textAlign = 'center';
  ctx.font = "14px 'Courier New', monospace";
  ctx.fillStyle = 'rgba(200,192,178,0.8)';
  const ch = CHAPTERS[game.chapter];
  if (game.endless) {
    const mm = Math.floor(game.runTime / 60), ss = Math.floor(game.runTime % 60);
    ctx.fillText(`NIGHTMARE SHIFT — ${mm}:${ss < 10 ? '0' : ''}${ss} — ${game.kills} DOWN`, VW / 2, bar + 26);
  } else if (ch.boss) {
    if (boss) {
      const bw = Math.min(560, VW * 0.5), bx = VW / 2 - bw / 2, by = VH - bar - 34;
      ctx.font = 'bold 15px Georgia, serif';
      ctx.fillStyle = 'rgba(220,205,180,0.9)';
      ctx.fillText('T H E   H A R V E S T   M A N', VW / 2, by - 10);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 3, by - 3, bw + 6, 14);
      ctx.fillStyle = '#26090b'; ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = '#a01a1a'; ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxHp, 0, 1), 8);
      if (boss.staggerT > 0) {
        ctx.font = "13px 'Courier New', monospace";
        ctx.fillStyle = '#e8c96a';
        ctx.fillText('HE’S DOWN — HIT HIM', VW / 2, by + 26);
      }
    }
  } else {
    const left = isFinite(game.quotaLeft) ? Math.max(0, game.quotaLeft) : '∞';
    ctx.fillText(`THE HOLLOWED — ${left} REMAIN`, VW / 2, bar + 26);
  }

  ctx.textAlign = 'left';
  ctx.font = "12px 'Courier New', monospace";
  ctx.fillStyle = 'rgba(160,152,140,0.55)';
  ctx.fillText(game.endless ? 'NIGHTMARE SHIFT' : `${ch.num} — ${ch.title}`, 34, bar + 26);

  if (game.hint > 0) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = clamp(game.hint, 0, 1);
    ctx.font = "14px 'Courier New', monospace";
    ctx.fillStyle = 'rgba(220,212,195,0.85)';
    ctx.fillText('WASD move · mouse look · LEFT CLICK fire · RIGHT CLICK aim down sights · SHIFT run · R reload', VW / 2, VH - bar - 84);
    ctx.globalAlpha = 1;
  }

  // Pointer-lock prompt
  if (!mouse.locked && !game.paused && !player.dead) {
    ctx.textAlign = 'center';
    ctx.font = "16px 'Courier New', monospace";
    ctx.fillStyle = `rgba(220,210,190,${0.5 + 0.5 * Math.sin(game.time * 3)})`;
    ctx.fillText('CLICK TO TAKE THE FLASHLIGHT', VW / 2, VH * 0.62);
  }

  ctx.restore();
  ctx.textAlign = 'left';
}

/* ------------------------------ UI SCREENS -------------------------------- */
let titleDrips = [];
function renderTitle() {
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, VW, VH);
  const t = game.time;

  // Drifting fog bands
  for (let i = 0; i < 7; i++) {
    const y = (i * 137) % VH;
    const x = ((t * (12 + i * 5) + i * 400) % (VW + 900)) - 450;
    const g = ctx.createRadialGradient(x, y, 10, x, y, 320);
    g.addColorStop(0, 'rgba(120,132,155,0.10)');
    g.addColorStop(1, 'rgba(120,132,155,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 320, y - 320, 640, 640);
  }

  const flicker = Math.random() < 0.06 ? rand(0.5, 0.85) : 1;
  ctx.save();
  ctx.globalAlpha = clamp(t / 3, 0, 1) * flicker;
  typeSet(Math.min(28, VW * 0.024), true, 'rgba(150,150,160,0.7)');
  ctx.fillText('HARROW’S END, MAINE · POPULATION 1,406 · OCTOBER 1986', VW / 2, VH * 0.28);
  typeSet(Math.min(108, VW * 0.108), false, '#8a1216');
  ctx.shadowColor = '#4a0a0c'; ctx.shadowBlur = 30;
  ctx.fillText('HARROW’S END', VW / 2, VH * 0.45);
  ctx.shadowBlur = 0;
  typeSet(Math.min(22, VW * 0.02), false, 'rgba(190,180,170,0.85)');
  ctx.fillText('every small town keeps a harvest', VW / 2, VH * 0.52);
  if (t > 1.6 && Math.sin(t * 2.4) > -0.4) {
    typeSet(Math.min(24, VW * 0.021), true, 'rgba(220,210,190,0.9)');
    ctx.fillText('CLICK OR PRESS ENTER TO BEGIN THE LAST SHIFT', VW / 2, VH * 0.66);
  }
  typeSet(14, true, 'rgba(140,140,150,0.6)');
  ctx.fillText('WASD MOVE · MOUSE LOOK · LEFT CLICK FIRE · RIGHT CLICK AIM · SHIFT RUN · R RELOAD · M MUTE', VW / 2, VH * 0.75);
  typeSet(13, true, 'rgba(120,40,40,0.7)');
  ctx.fillText('contains considerable blood and guts', VW / 2, VH * 0.8);
  ctx.restore();

  if (Math.random() < 0.05 && titleDrips.length < 14) {
    titleDrips.push({ x: VW / 2 + rand(-VW * 0.16, VW * 0.16), y: VH * 0.46, v: rand(15, 55), len: rand(8, 26) });
  }
  ctx.strokeStyle = '#6b0f12'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (let i = titleDrips.length - 1; i >= 0; i--) {
    const d = titleDrips[i];
    d.y += d.v * 0.016;
    ctx.beginPath(); ctx.moveTo(d.x, d.y - d.len); ctx.lineTo(d.x, d.y); ctx.stroke();
    if (d.y > VH * 0.61) titleDrips.splice(i, 1);
  }

  renderGrain();
  ctx.drawImage(vignetteC, 0, 0);
  renderLetterbox();
  ctx.textAlign = 'left';
}

function typewriterBlock(text, x0, y0, maxWidth, lineH) {
  ctx.textAlign = 'left';
  let y = y0;
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth) { ctx.fillText(line, x0, y); y += lineH; line = word; }
      else line = test;
    }
    ctx.fillText(line, x0, y);
    y += lineH;
  }
  return y;
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

  ctx.font = `${Math.min(17, VW * 0.016)}px 'Courier New', monospace`;
  ctx.fillStyle = 'rgba(205,198,185,0.9)';
  const maxWidth = Math.min(680, VW * 0.7);
  typewriterBlock(c.text.slice(0, c.chars), VW / 2 - maxWidth / 2, VH * 0.47, maxWidth, 26);

  if (c.t > 2.5 && Math.sin(c.t * 2.5) > -0.3) {
    typeSet(15, true, 'rgba(180,170,160,0.7)');
    ctx.fillText('ENTER TO CONTINUE', VW / 2, VH * 0.85);
  }
  renderGrain();
  ctx.drawImage(vignetteC, 0, 0);
  renderLetterbox();
  ctx.textAlign = 'left';
}

function renderDeath() {
  ctx.fillStyle = `rgba(0,0,0,${clamp(game.stateT / 1.2, 0, 0.82)})`;
  ctx.fillRect(0, 0, VW, VH);
  if (game.stateT < 0.6) return;
  ctx.save();
  ctx.globalAlpha = clamp((game.stateT - 0.6) / 1, 0, 1);
  typeSet(Math.min(80, VW * 0.078), false, '#8a1216');
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
  const t = clamp(game.stateT / 5, 0, 1);
  ctx.fillStyle = `rgba(190,170,150,${t * 0.25})`;
  ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = `rgba(0,0,0,${clamp(game.stateT / 2, 0, 0.75)})`;
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.globalAlpha = clamp((game.stateT - 1) / 1.5, 0, 1);
  typeSet(Math.min(72, VW * 0.065), false, 'rgba(220,205,185,0.95)');
  ctx.fillText('DAWN', VW / 2, VH * 0.3);
  ctx.font = `${Math.min(16, VW * 0.015)}px 'Courier New', monospace`;
  ctx.fillStyle = 'rgba(205,198,185,0.9)';
  const maxWidth = Math.min(640, VW * 0.68);
  typewriterBlock(EPILOGUE.slice(0, Math.floor(Math.max(0, game.stateT - 2) * 40)), VW / 2 - maxWidth / 2, VH * 0.4, maxWidth, 24);
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
  ctx.fillStyle = 'rgba(0,0,0,0.74)';
  ctx.fillRect(0, 0, VW, VH);
  typeSet(Math.min(46, VW * 0.045), false, 'rgba(210,200,185,0.9)');
  ctx.fillText('— INTERMISSION —', VW / 2, VH * 0.36);
  typeSet(15, true, 'rgba(190,182,170,0.8)');
  ctx.fillText('WASD move · mouse look · SHIFT run · LEFT CLICK fire · RIGHT CLICK aim · R reload', VW / 2, VH * 0.47);
  ctx.fillText('1 colt · 2 shotgun · 3 deer rifle · 4 axe (or mouse wheel) · M mute · F fullscreen', VW / 2, VH * 0.52);
  ctx.fillText('arrow keys turn and look if you prefer', VW / 2, VH * 0.57);
  typeSet(18, true, 'rgba(220,210,190,0.9)');
  ctx.fillText('CLICK OR PRESS ENTER TO GO BACK OUT THERE', VW / 2, VH * 0.68);
  ctx.textAlign = 'left';
}

/* -------------------------------- LOOP ------------------------------------ */
let lastT = 0;
function frame(t) {
  const dt = Math.min(0.035, (t - lastT) / 1000 || 0.016);
  lastT = t;
  try {
    update(dt);
    render();
  } catch (err) {
    if (!frame.errLogged) { console.error(err); frame.errLogged = true; }
  }
  requestAnimationFrame(frame);
}

buildTextures();
buildSprites();
resize();
buildMap();
requestAnimationFrame(frame);
