const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const hud = document.getElementById('hud');
const lapValue = document.getElementById('lapValue');
const timeValue = document.getElementById('timeValue');
const coinValue = document.getElementById('coinValue');
const speedValue = document.getElementById('speedValue');
const boostValue = document.getElementById('boostValue');
const shieldValue = document.getElementById('shieldValue');

const countdownOverlay = document.getElementById('countdownOverlay');
const toast = document.getElementById('toast');
const startScreen = document.getElementById('startScreen');
const resultScreen = document.getElementById('resultScreen');
const touchControls = document.getElementById('touchControls');

const playButton = document.getElementById('playButton');
const soundToggleButton = document.getElementById('soundToggleButton');
const resultPlayButton = document.getElementById('resultPlayButton');
const homeButton = document.getElementById('homeButton');

const bestTimeValue = document.getElementById('bestTimeValue');
const totalCoinsValue = document.getElementById('totalCoinsValue');

const resultTime = document.getElementById('resultTime');
const resultBestTime = document.getElementById('resultBestTime');
const resultCoins = document.getElementById('resultCoins');
const resultPowerups = document.getElementById('resultPowerups');
const resultCollisions = document.getElementById('resultCollisions');
const resultRecord = document.getElementById('resultRecord');
const newBestMarker = document.getElementById('newBestMarker');

const TAU = Math.PI * 2;
const track = {
  cx: canvas.width / 2,
  cy: canvas.height / 2,
  innerRadius: 118,
  outerRadius: 220,
  roadWidth: 102,
  startAngle: -Math.PI / 2,
};

const controls = {
  left: false,
  right: false,
  accelerate: false,
  brake: false,
};

const state = {
  mode: 'start',
  countdown: 3,
  raceTime: 0,
  raceStartedAt: 0,
  bestTime: Number(localStorage.getItem('autoRallyBestTime')) || Infinity,
  totalCoinsSaved: Number(localStorage.getItem('autoRallyTotalCoins')) || 0,
  soundOn: localStorage.getItem('autoRallySound') !== 'off',
  currentRaceCoins: 0,
  powerupsCollected: 0,
  collisions: 0,
  boostTimer: 0,
  shieldCharges: 0,
  shieldFlash: 0,
  collisionCooldown: 0,
  trail: [],
  particles: [],
  toastTimer: 0,
  trackProgress: 0,
  lapsCompleted: 0,
  activeLap: 1,
  angularTravel: 0,
  lastTrackAngle: 0,
  car: null,
  coins: [],
  obstacles: [],
  powerups: [],
  lastTimestamp: 0,
  audioCtx: null,
  engineOsc: null,
  engineGain: null,
  audioUnlocked: false,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function shortestAngleDelta(current, previous) {
  let delta = current - previous;
  while (delta > Math.PI) {
    delta -= TAU;
  }
  while (delta < -Math.PI) {
    delta += TAU;
  }
  return delta;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function setToast(text, duration = 1.2) {
  toast.textContent = text;
  toast.classList.remove('hidden');
  state.toastTimer = duration;
}

function updateStartSummary() {
  const bestTime = state.bestTime === Infinity ? '--:--' : formatTime(state.bestTime);
  bestTimeValue.textContent = bestTime;
  totalCoinsValue.textContent = state.totalCoinsSaved;
}

function ensureAudio() {
  if (state.audioUnlocked) {
    if (state.soundOn) {
      state.audioCtx.resume();
    }
    return;
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    return;
  }

  state.audioCtx = new AudioCtor();
  state.engineGain = state.audioCtx.createGain();
  state.engineGain.gain.value = 0.0001;
  state.engineGain.connect(state.audioCtx.destination);

  state.engineOsc = state.audioCtx.createOscillator();
  state.engineOsc.type = 'sawtooth';
  state.engineOsc.frequency.value = 90;
  state.engineOsc.connect(state.engineGain);
  state.engineOsc.start();

  state.audioUnlocked = true;
  if (!state.soundOn) {
    state.engineGain.gain.value = 0;
  }
}

function toggleSound() {
  state.soundOn = !state.soundOn;
  localStorage.setItem('autoRallySound', state.soundOn ? 'on' : 'off');
  soundToggleButton.textContent = `Sound: ${state.soundOn ? 'ON' : 'OFF'}`;

  if (state.audioCtx && state.engineGain) {
    state.engineGain.gain.value = state.soundOn ? 0.0001 : 0;
  }
}

function playTone({ frequency = 440, duration = 0.12, type = 'sine', volume = 0.08, slideTo = null }) {
  if (!state.soundOn || !state.audioCtx) {
    return;
  }

  const osc = state.audioCtx.createOscillator();
  const gain = state.audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, state.audioCtx.currentTime);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), state.audioCtx.currentTime + duration);
  }
  gain.gain.setValueAtTime(0.0001, state.audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, state.audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, state.audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(state.audioCtx.destination);
  osc.start();
  osc.stop(state.audioCtx.currentTime + duration + 0.04);
}

function updateEngineSound() {
  if (!state.audioCtx || !state.engineOsc || !state.engineGain) {
    return;
  }

  const car = state.car;
  const gainTarget = state.soundOn && state.mode !== 'start' ? 0.04 + Math.abs(car.speed) / 900 : 0;
  state.engineGain.gain.setTargetAtTime(gainTarget, state.audioCtx.currentTime, 0.05);
  const freqTarget = 90 + Math.abs(car.speed) * 1.6 + (state.boostTimer > 0 ? 40 : 0);
  state.engineOsc.frequency.setTargetAtTime(freqTarget, state.audioCtx.currentTime, 0.08);
}

function createCar() {
  const roadCenterRadius = (track.innerRadius + track.outerRadius) / 2;
  const startAngle = track.startAngle;
  return {
      angle: startAngle,
      laneOffset: 0,
      x: track.cx + Math.cos(startAngle) * roadCenterRadius,
      y: track.cy + Math.sin(startAngle) * roadCenterRadius,
      heading: startAngle + Math.PI / 2,
      speed: 0,
      radius: 18,
      maxSpeed: 155,
      acceleration: 118,
      braking: 180,
      turnRate: 2.4,
      drift: 0,
  };
}

function spawnCoins() {
  const coins = [];
  const count = 18;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU + (i % 2) * 0.46;
    const radius = 140 + ((i * 17) % 70);
    const x = track.cx + Math.cos(angle) * radius;
    const y = track.cy + Math.sin(angle) * radius;
    coins.push({ x, y, collected: false, radius: 10, pulse: Math.random() * TAU });
  }
  state.coins = coins;
}

function spawnObstacles() {
  const patterns = [
    { type: 'cone', x: track.cx + 130, y: track.cy - 80, radius: 16 },
    { type: 'barrier', x: track.cx - 80, y: track.cy + 110, radius: 18 },
    { type: 'oil', x: track.cx + 30, y: track.cy + 200, radius: 18 },
    { type: 'pothole', x: track.cx - 170, y: track.cy - 40, radius: 17 },
    { type: 'car', x: track.cx + 180, y: track.cy + 30, radius: 20 },
    { type: 'cone', x: track.cx - 110, y: track.cy - 160, radius: 16 },
    { type: 'barrier', x: track.cx + 170, y: track.cy - 170, radius: 18 },
  ];
  state.obstacles = patterns;
}

function spawnPowerUps() {
  state.powerups = [
    { type: 'boost', x: track.cx + 20, y: track.cy - 195, radius: 16, active: true },
    { type: 'shield', x: track.cx - 185, y: track.cy + 5, radius: 16, active: true },
    { type: 'boost', x: track.cx + 190, y: track.cy + 170, radius: 16, active: true },
  ];
}

function resetRace() {
  state.mode = 'countdown';
  state.countdown = 3.2;
  state.raceTime = 0;
  state.raceStartedAt = 0;
  state.currentRaceCoins = 0;
  state.powerupsCollected = 0;
  state.collisions = 0;
  state.boostTimer = 0;
  state.shieldCharges = 0;
  state.shieldFlash = 0;
  state.collisionCooldown = 0;
  state.trackProgress = 0;
  state.angularTravel = 0;
  state.lapsCompleted = 0;
  state.activeLap = 1;
  state.toastTimer = 0;
  state.car = createCar();
  state.lastTrackAngle = normalizeAngle(Math.atan2(state.car.y - track.cy, state.car.x - track.cx) - track.startAngle);
  spawnCoins();
  spawnObstacles();
  spawnPowerUps();
  hud.classList.remove('hidden');
  touchControls.classList.remove('hidden');
  countdownOverlay.classList.remove('hidden');
  countdownOverlay.textContent = '3';
  toast.classList.add('hidden');
  updateHud();
}

function startGame() {
  ensureAudio();
  resetRace();
  startScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');
  newBestMarker.classList.add('hidden');
}

function returnHome() {
  state.mode = 'start';
  startScreen.classList.remove('hidden');
  resultScreen.classList.add('hidden');
  hud.classList.add('hidden');
  touchControls.classList.add('hidden');
  countdownOverlay.classList.add('hidden');
  toast.classList.add('hidden');
  updateStartSummary();
}

function updateHud() {
  lapValue.textContent = `${Math.min(state.lapsCompleted + 1, 3)}/3`;
  timeValue.textContent = formatTime(state.raceTime);
  coinValue.textContent = state.currentRaceCoins;
  speedValue.textContent = `${Math.round(Math.abs(state.car.speed))}`;
  boostValue.textContent = state.boostTimer > 0 ? `${state.boostTimer.toFixed(1)}s` : 'OFF';
  shieldValue.textContent = state.shieldCharges > 0 ? 'READY' : 'OFF';
}

function updateRace(dt) {
  const car = state.car;
  const roadCenterRadius = (track.innerRadius + track.outerRadius) / 2;

  const steerInput = (controls.left ? -1 : 0) + (controls.right ? 1 : 0);
  if (steerInput !== 0) {
    car.laneOffset += steerInput * car.turnRate * 32 * dt * (0.5 + Math.abs(car.speed) / 160);
    car.laneOffset = clamp(car.laneOffset, -(track.roadWidth / 2 - 20), track.roadWidth / 2 - 20);
  }

  if (controls.accelerate) {
    car.speed += car.acceleration * dt;
  }
  if (controls.brake) {
    car.speed -= car.braking * dt;
  }

  if (!controls.accelerate && !controls.brake) {
    car.speed *= 0.985;
  }

  if (state.boostTimer > 0) {
    car.speed += 48 * dt;
    state.boostTimer = Math.max(0, state.boostTimer - dt);
  }

  car.speed = clamp(car.speed, -60, car.maxSpeed + (state.boostTimer > 0 ? 55 : 0));
  car.angle += (car.speed / roadCenterRadius) * dt;
  car.heading = car.angle + Math.PI / 2;

  const trackRadius = roadCenterRadius + car.laneOffset;
  car.x = track.cx + Math.cos(car.angle) * trackRadius;
  car.y = track.cy + Math.sin(car.angle) * trackRadius;

  if (Math.abs(car.laneOffset) > track.roadWidth / 2 - 8) {
    car.speed *= 0.9;
  }

  state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);

  state.angularTravel += Math.max(0, car.speed) / roadCenterRadius * dt;
  if (state.lapsCompleted < 3 && state.angularTravel >= (state.lapsCompleted + 1) * TAU) {
    state.lapsCompleted += 1;
    if (state.lapsCompleted >= 3) {
      finishRace();
      return;
    }
    setToast(`Lap ${state.lapsCompleted}/3 complete`, 1.4);
    playTone({ frequency: 540, duration: 0.18, type: 'triangle', volume: 0.07, slideTo: 710 });
  }

  if (Math.abs(car.speed) > 18) {
    const dx = Math.cos(car.heading);
    const dy = Math.sin(car.heading);
    state.trail.push({ x: car.x - dx * 12, y: car.y - dy * 12, life: 0.5, radius: 12 });
    if (state.trail.length > 14) {
      state.trail.shift();
    }
  }

  for (let i = state.trail.length - 1; i >= 0; i -= 1) {
    const piece = state.trail[i];
    piece.life -= dt;
    if (piece.life <= 0) {
      state.trail.splice(i, 1);
    }
  }

  for (const coin of state.coins) {
    if (coin.collected) continue;
    if (Math.hypot(car.x - coin.x, car.y - coin.y) < car.radius + coin.radius + 2) {
      coin.collected = true;
      state.currentRaceCoins += 1;
      state.particles.push({ x: coin.x, y: coin.y, color: '#ffe36b', life: 0.6, vx: 0, vy: 0 });
      playTone({ frequency: 760, duration: 0.14, type: 'triangle', volume: 0.06, slideTo: 440 });
    }
  }

  for (const obstacle of state.obstacles) {
    if (Math.hypot(car.x - obstacle.x, car.y - obstacle.y) < car.radius + obstacle.radius + 4) {
      if (state.collisionCooldown > 0) {
        continue;
      }
      state.collisionCooldown = 0.8;
      if (state.shieldCharges > 0) {
        state.shieldCharges = 0;
        state.shieldFlash = 0.7;
        playTone({ frequency: 260, duration: 0.14, type: 'square', volume: 0.05, slideTo: 150 });
        setToast('Shield saved you!', 1.2);
      } else {
        car.speed *= 0.55;
        state.collisions += 1;
        playTone({ frequency: 160, duration: 0.2, type: 'sawtooth', volume: 0.08, slideTo: 60 });
        setToast('Impact!', 0.8);
      }
      const pushAngle = Math.atan2(car.y - obstacle.y, car.x - obstacle.x);
      car.x = obstacle.x + Math.cos(pushAngle) * (obstacle.radius + car.radius + 8);
      car.y = obstacle.y + Math.sin(pushAngle) * (obstacle.radius + car.radius + 8);
    }
  }

  for (const powerup of state.powerups) {
    if (!powerup.active) continue;
    if (Math.hypot(car.x - powerup.x, car.y - powerup.y) < car.radius + powerup.radius + 3) {
      powerup.active = false;
      state.powerupsCollected += 1;
      if (powerup.type === 'boost') {
        state.boostTimer = 4.2;
        setToast('Speed Boost!', 1.3);
        playTone({ frequency: 560, duration: 0.18, type: 'triangle', volume: 0.08, slideTo: 740 });
      } else {
        state.shieldCharges = 1;
        setToast('Shield Ready', 1.2);
        playTone({ frequency: 420, duration: 0.24, type: 'sine', volume: 0.06, slideTo: 620 });
      }
    }
  }

  if (state.shieldFlash > 0) {
    state.shieldFlash = Math.max(0, state.shieldFlash - dt);
  }

  if (state.toastTimer > 0) {
    state.toastTimer = Math.max(0, state.toastTimer - dt);
    if (state.toastTimer === 0) {
      toast.classList.add('hidden');
    }
  }

  state.raceTime = (performance.now() - state.raceStartedAt) / 1000;
  updateHud();
}

function finishRace() {
  state.mode = 'finished';
  state.raceTime = (performance.now() - state.raceStartedAt) / 1000;
  const oldBest = state.bestTime;
  const didBeatBest = Number.isFinite(state.bestTime) && state.raceTime < state.bestTime;

  if (Number.isFinite(oldBest) && state.raceTime < oldBest) {
    state.bestTime = state.raceTime;
    localStorage.setItem('autoRallyBestTime', String(state.bestTime));
  } else if (!Number.isFinite(oldBest)) {
    state.bestTime = state.raceTime;
    localStorage.setItem('autoRallyBestTime', String(state.bestTime));
  }

  state.totalCoinsSaved += state.currentRaceCoins;
  localStorage.setItem('autoRallyTotalCoins', String(state.totalCoinsSaved));
  updateStartSummary();

  resultTime.textContent = formatTime(state.raceTime);
  resultBestTime.textContent = formatTime(state.bestTime);
  resultCoins.textContent = state.currentRaceCoins;
  resultPowerups.textContent = state.powerupsCollected;
  resultCollisions.textContent = state.collisions;
  resultRecord.textContent = didBeatBest || (!Number.isFinite(oldBest)) ? 'YES' : 'NO';

  if (didBeatBest || (!Number.isFinite(oldBest))) {
    newBestMarker.classList.remove('hidden');
  } else {
    newBestMarker.classList.add('hidden');
  }

  if (state.soundOn) {
    playTone({ frequency: 760, duration: 0.16, type: 'triangle', volume: 0.08, slideTo: 980 });
    setTimeout(() => playTone({ frequency: 980, duration: 0.22, type: 'sine', volume: 0.08, slideTo: 1220 }), 120);
  }

  hud.classList.add('hidden');
  touchControls.classList.add('hidden');
  countdownOverlay.classList.add('hidden');
  resultScreen.classList.remove('hidden');
}

function updateCountdown(dt) {
  state.countdown -= dt;
  const visibleValue = Math.ceil(state.countdown);
  if (state.countdown <= 0) {
    state.mode = 'play';
    state.raceStartedAt = performance.now();
    countdownOverlay.classList.add('hidden');
    hud.classList.remove('hidden');
    playTone({ frequency: 300, duration: 0.12, type: 'square', volume: 0.05, slideTo: 500 });
    return;
  }

  countdownOverlay.textContent = visibleValue > 0 ? String(visibleValue) : 'GO!';
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const particle = state.particles[i];
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (particle.life <= 0) {
      state.particles.splice(i, 1);
    }
  }
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#7ed0ff');
  sky.addColorStop(0.35, '#bfeeff');
  sky.addColorStop(0.36, '#80d56a');
  sky.addColorStop(1, '#3d9d46');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 18; i += 1) {
    const x = (i * 32 + (canvas.width / 2)) % (canvas.width + 120) - 60;
    const y = 40 + (i % 5) * 15;
    ctx.fillStyle = '#7dd464';
    ctx.fillRect(x, y, 8, 18);
    ctx.beginPath();
    ctx.arc(x + 4, y, 16, 0, TAU);
    ctx.fillStyle = '#5dbf49';
    ctx.fill();
  }

  ctx.fillStyle = '#537b47';
  ctx.fillRect(0, canvas.height - 110, canvas.width, 120);
}

function drawTrack() {
  ctx.save();
  ctx.translate(track.cx, track.cy);

  ctx.beginPath();
  ctx.arc(0, 0, track.outerRadius + 70, 0, TAU);
  ctx.fillStyle = '#398b3d';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, track.outerRadius, 0, TAU);
  ctx.fillStyle = '#2b2f39';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, track.innerRadius, 0, TAU);
  ctx.fillStyle = '#7bcf57';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, track.outerRadius, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1c2028';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, track.innerRadius, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#224b24';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -track.outerRadius);
  ctx.lineTo(0, -track.innerRadius);
  ctx.strokeStyle = '#f4ec96';
  ctx.lineWidth = 6;
  ctx.stroke();

  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * TAU + 0.2;
    const x1 = Math.cos(angle) * (track.innerRadius + 16);
    const y1 = Math.sin(angle) * (track.innerRadius + 16);
    const x2 = Math.cos(angle) * (track.outerRadius - 16);
    const y2 = Math.sin(angle) * (track.outerRadius - 16);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * TAU + Math.PI / 16;
    const x = Math.cos(angle) * (track.outerRadius + 48);
    const y = Math.sin(angle) * (track.outerRadius + 48);
    ctx.fillStyle = '#5a4930';
    ctx.fillRect(x - 8, y - 14, 16, 28);
    ctx.fillStyle = '#2e9d54';
    ctx.beginPath();
    ctx.arc(x, y - 15, 18, 0, TAU);
    ctx.fill();
  }

  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * TAU + Math.PI / 10;
    const x = Math.cos(angle) * (track.innerRadius - 15);
    const y = Math.sin(angle) * (track.innerRadius - 15);
    const shopW = 18;
    const shopH = 24;
    ctx.fillStyle = '#e8c28d';
    ctx.fillRect(x - shopW / 2, y - shopH / 2, shopW, shopH);
    ctx.fillStyle = '#d88433';
    ctx.fillRect(x - shopW / 2 + 2, y - shopH / 2 + 4, shopW - 4, 8);
  }

  ctx.restore();
}

function drawCoins() {
  for (const coin of state.coins) {
    if (coin.collected) continue;
    const pulse = Math.sin(performance.now() / 200 + coin.pulse) * 4;
    ctx.save();
    ctx.translate(coin.x, coin.y + pulse);
    ctx.beginPath();
    ctx.arc(0, 0, coin.radius, 0, TAU);
    ctx.fillStyle = '#f8de50';
    ctx.fill();
    ctx.strokeStyle = '#cf9a1c';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, coin.radius * 0.4, 0, TAU);
    ctx.fillStyle = '#ffeaa5';
    ctx.fill();
    ctx.restore();
  }
}

function drawObstacles() {
  for (const obstacle of state.obstacles) {
    ctx.save();
    ctx.translate(obstacle.x, obstacle.y);
    if (obstacle.type === 'cone') {
      ctx.fillStyle = '#ff8f3f';
      ctx.beginPath();
      ctx.moveTo(-12, 16); ctx.lineTo(12, 16); ctx.lineTo(0, -14); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fdd7a2';
      ctx.fillRect(-3, 3, 6, 12);
    } else if (obstacle.type === 'barrier') {
      ctx.fillStyle = '#ee6a4d';
      ctx.fillRect(-22, -10, 44, 20);
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(-18, -6, 36, 4);
      ctx.fillRect(-18, 4, 36, 4);
    } else if (obstacle.type === 'oil') {
      ctx.fillStyle = '#1d2130';
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 12, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(-15, -8, 30, 16);
    } else if (obstacle.type === 'pothole') {
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#4b4b4b';
      ctx.fillRect(-6, -4, 12, 8);
    } else if (obstacle.type === 'car') {
      ctx.fillStyle = '#4ec9f5';
      ctx.fillRect(-16, -12, 32, 24);
      ctx.fillStyle = '#d7f7ff';
      ctx.fillRect(-8, -6, 16, 12);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-18, -7, 6, 14);
      ctx.fillRect(12, -7, 6, 14);
    }
    ctx.restore();
  }
}

function drawPowerUps() {
  for (const pu of state.powerups) {
    if (!pu.active) continue;
    const color = pu.type === 'boost' ? '#ff9b2f' : '#64d4ff';
    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.beginPath();
    ctx.arc(0, 0, pu.radius, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pu.type === 'boost' ? 'B' : 'S', 0, 1);
    ctx.restore();
  }
}

function drawCar() {
  const car = state.car;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading);

  if (state.shieldCharges > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, TAU);
    ctx.strokeStyle = 'rgba(95,208,255,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle = '#f7d73d';
  ctx.fillRect(-18, -12, 36, 24);
  ctx.fillStyle = '#2fb263';
  ctx.fillRect(-10, -14, 20, 10);
  ctx.fillStyle = '#e7f2ff';
  ctx.fillRect(-8, -8, 16, 10);
  ctx.fillStyle = '#1f2a35';
  ctx.fillRect(-18, -7, 5, 14);
  ctx.fillRect(13, -7, 5, 14);
  ctx.fillStyle = '#ffea9e';
  ctx.fillRect(15, -5, 7, 10);
  ctx.fillStyle = '#1b1e23';
  ctx.fillRect(-12, -17, 24, 5);
  ctx.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, particle.life * 1.5);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawTrail() {
  for (const piece of state.trail) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${piece.life * 1.4})`;
    ctx.arc(piece.x, piece.y, piece.radius * (0.25 + piece.life), 0, TAU);
    ctx.fill();
  }
}

function render() {
  drawBackground();
  drawTrack();
  drawPowerUps();
  drawCoins();
  drawObstacles();
  drawParticles();
  drawTrail();
  if (state.car) {
    drawCar();
  }

  if (state.shieldFlash > 0) {
    ctx.fillStyle = `rgba(110, 220, 255, ${state.shieldFlash * 0.35})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - (state.lastTimestamp || timestamp)) / 1000, 0.033);
  state.lastTimestamp = timestamp;

  if (state.mode === 'countdown') {
    updateCountdown(dt);
  }

  if (state.mode === 'play') {
    updateRace(dt);
  }

  updateParticles(dt);
  updateEngineSound();
  render();
  requestAnimationFrame(gameLoop);
}

function bindControls() {
  const keyMap = {
    ArrowLeft: 'left',
    a: 'left',
    A: 'left',
    ArrowRight: 'right',
    d: 'right',
    D: 'right',
    ArrowUp: 'accelerate',
    w: 'accelerate',
    W: 'accelerate',
    ArrowDown: 'brake',
    s: 'brake',
    S: 'brake',
  };

  document.addEventListener('keydown', (event) => {
    const key = keyMap[event.key];
    if (key) {
      event.preventDefault();
      controls[key] = true;
      if (state.mode === 'start') {
        ensureAudio();
      }
    }
  });

  document.addEventListener('keyup', (event) => {
    const key = keyMap[event.key];
    if (key) {
      event.preventDefault();
      controls[key] = false;
    }
  });

  document.querySelectorAll('[data-control]').forEach((button) => {
    const controlName = button.dataset.control;
    const addPress = (pressed) => {
      if (state.mode === 'start') {
        ensureAudio();
      }
      if (controlName === 'left' || controlName === 'right' || controlName === 'accelerate' || controlName === 'brake') {
        controls[controlName] = pressed;
      }
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      addPress(true);
    });
    button.addEventListener('pointerup', (event) => {
      event.preventDefault();
      addPress(false);
    });
    button.addEventListener('pointerleave', () => addPress(false));
    button.addEventListener('pointercancel', () => addPress(false));
  });
}

function initialize() {
  updateStartSummary();
  soundToggleButton.textContent = `Sound: ${state.soundOn ? 'ON' : 'OFF'}`;
  startScreen.classList.remove('hidden');
  resultScreen.classList.add('hidden');
  touchControls.classList.add('hidden');

  playButton.addEventListener('click', () => {
    ensureAudio();
    startGame();
  });

  resultPlayButton.addEventListener('click', () => {
    ensureAudio();
    startGame();
  });

  homeButton.addEventListener('click', () => {
    ensureAudio();
    returnHome();
  });

  soundToggleButton.addEventListener('click', () => {
    ensureAudio();
    toggleSound();
  });

  bindControls();
  resetRace();
  state.mode = 'start';
  startScreen.classList.remove('hidden');
  hud.classList.add('hidden');
  countdownOverlay.classList.add('hidden');
  updateHud();
  requestAnimationFrame(gameLoop);
}

initialize();
