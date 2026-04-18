'use strict';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const stats = document.getElementById('stats');

const MIN_SIM_DIMENSION = 256;
const MAX_SIM_DIMENSION = 2048;
const SIM_RESOLUTION_SCALE = 0.5;
const GROUP_COUNT = 16;
const PARTICLE_PERCENTAGE = 0.02;
const BASE_ROTATION_ANGLE_DEG = 45;
const DECAY = 0.002;
const TEMP_DECAY = 0.01;
const MIN_SENSOR_ANGLE_DEG = 5;
const MAX_SENSOR_ANGLE_DEG = 120;
const MIN_SENSOR_RANGE = 0.002;
const MAX_SENSOR_RANGE = 0.06;
const MIN_STEP_SIZE = 0.0002;
const MAX_STEP_SIZE = 0.008;
const MIN_MOVEMENT_THRESHOLD = 1e-8;

const BASE_SPAWN_COUNT = 12;
const MAX_SPAWN_COUNT = 120;
const SPAWN_SPEED_SCALE = 10000;
const CELL_SPAWN_RADIUS = 0.014;
const BASE_CELL_TEMPERATURE = 0.15;
const MAX_CELL_TEMPERATURE = 1;
const CELL_TEMP_BLEND = 0.18;
const CELL_TEMP_COOLING = 0.01;
const NEIGHBOR_SAMPLE_OFFSET = 0.0045;

const COLOR_ISOLATED = { r: 255, g: 140, b: 0 };
const COLOR_NEIGHBOR = { r: 255, g: 255, b: 255 };
const COLOR_DEEP_BLUE = { r: 16, g: 36, b: 120 };
const COLOR_MAX = { r: 148, g: 177, b: 255 };
const DENSITY_VISIBILITY_GAIN = 1.8;
const MIN_DENSITY_VISIBLE = 0.01;

let sensorAngleDeg = 45;
let sensorOffsetDistance = 0.01;
let stepSize = 0.001;

let mouseXNorm = 0.5;
let mouseYNorm = 0.5;

const pointer = {
  xNorm: 0.5,
  yNorm: 0.5,
  prevXNorm: 0.5,
  prevYNorm: 0.5,
  moved: false,
  active: false
};
let activeTouchId = -1;

let simWidth = 0;
let simHeight = 0;
let maxParticles = 0;
let activeParticles = 0;
let particles = new Float32Array(0);
let particleTemperatures = new Float32Array(0);
let trail = new Float32Array(0);
let nextTrail = new Float32Array(0);
let temperatureTrail = new Float32Array(0);
let nextTemperatureTrail = new Float32Array(0);
let relativeMaxTemperature = 0;

let imageData;
let imagePixels;
const simCanvas = document.createElement('canvas');
const simCtx = simCanvas.getContext('2d', { alpha: false });

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function saturate(v) {
  return clamp(v, 0, 1);
}

function clampInt(v, min, max) {
  return Math.floor(clamp(v, min, max));
}

function wrap01(v) {
  if (v < 0) return v + 1;
  if (v > 1) return v - 1;
  return v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function trailSample(xNorm, yNorm) {
  const x = clampInt(xNorm * (simWidth - 1), 0, simWidth - 1);
  const y = clampInt(yNorm * (simHeight - 1), 0, simHeight - 1);
  return trail[y * simWidth + x];
}

function addTrail(xNorm, yNorm, value) {
  const x = clampInt(xNorm * (simWidth - 1), 0, simWidth - 1);
  const y = clampInt(yNorm * (simHeight - 1), 0, simHeight - 1);
  const idx = y * simWidth + x;
  trail[idx] = Math.max(trail[idx], value);
}

function addTemperature(xNorm, yNorm, value) {
  const x = clampInt(xNorm * (simWidth - 1), 0, simWidth - 1);
  const y = clampInt(yNorm * (simHeight - 1), 0, simHeight - 1);
  temperatureTrail[y * simWidth + x] += value;
}

function sampleNeighborSignal(xNorm, yNorm) {
  const o = NEIGHBOR_SAMPLE_OFFSET;
  const s1 = trailSample(wrap01(xNorm + o), yNorm);
  const s2 = trailSample(wrap01(xNorm - o), yNorm);
  const s3 = trailSample(xNorm, wrap01(yNorm + o));
  const s4 = trailSample(xNorm, wrap01(yNorm - o));
  return (s1 + s2 + s3 + s4) * 0.25;
}

function resetSimulation(width, height) {
  simWidth = width;
  simHeight = height;
  simCanvas.width = simWidth;
  simCanvas.height = simHeight;

  maxParticles = Math.max(
    GROUP_COUNT,
    Math.floor(simWidth * simHeight * PARTICLE_PERCENTAGE)
  );

  activeParticles = 0;
  particles = new Float32Array(maxParticles * 3);
  particleTemperatures = new Float32Array(maxParticles);
  trail = new Float32Array(simWidth * simHeight);
  nextTrail = new Float32Array(simWidth * simHeight);
  temperatureTrail = new Float32Array(simWidth * simHeight);
  nextTemperatureTrail = new Float32Array(simWidth * simHeight);
  relativeMaxTemperature = 0;

  imageData = simCtx.createImageData(simWidth, simHeight);
  imagePixels = imageData.data;
}

function spawnCellsAt(xNorm, yNorm, count, heatBoost = 0) {
  if (maxParticles === 0) return;

  for (let i = 0; i < count; i++) {
    const slot = activeParticles < maxParticles
      ? activeParticles++
      : Math.floor(Math.random() * maxParticles);

    const base = slot * 3;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * CELL_SPAWN_RADIUS;
    const px = saturate(xNorm + Math.cos(angle) * radius);
    const py = saturate(yNorm + Math.sin(angle) * radius);

    particles[base] = px;
    particles[base + 1] = py;
    particles[base + 2] = Math.random() * Math.PI * 2;

    const temp = clamp(BASE_CELL_TEMPERATURE + heatBoost, 0, MAX_CELL_TEMPERATURE);
    particleTemperatures[slot] = temp;

    addTrail(px, py, 1);
    addTemperature(px, py, temp);
  }
}

function updateControlsFromMouse() {
  sensorAngleDeg = MIN_SENSOR_ANGLE_DEG + (1 - mouseYNorm) * (MAX_SENSOR_ANGLE_DEG - MIN_SENSOR_ANGLE_DEG);
  sensorOffsetDistance = MIN_SENSOR_RANGE + mouseXNorm * (MAX_SENSOR_RANGE - MIN_SENSOR_RANGE);
}

function updateParticles() {
  const sensorAngle = (sensorAngleDeg * Math.PI) / 180;
  const rotationAngle = (BASE_ROTATION_ANGLE_DEG * Math.PI) / 180;

  for (let i = 0; i < activeParticles; i++) {
    const base = i * 3;
    let x = particles[base];
    let y = particles[base + 1];
    let angle = particles[base + 2];

    const neighborSignal = sampleNeighborSignal(x, y);
    const targetTemp = clamp(neighborSignal * 1.25, 0, MAX_CELL_TEMPERATURE);
    let cellTemp = particleTemperatures[i];
    cellTemp = clamp(
      cellTemp * (1 - CELL_TEMP_COOLING) + targetTemp * CELL_TEMP_BLEND,
      0,
      MAX_CELL_TEMPERATURE
    );
    particleTemperatures[i] = cellTemp;

    const fx = wrap01(x + Math.cos(angle) * sensorOffsetDistance);
    const fy = wrap01(y + Math.sin(angle) * sensorOffsetDistance);

    const flx = wrap01(x + Math.cos(angle + sensorAngle) * sensorOffsetDistance);
    const fly = wrap01(y + Math.sin(angle + sensorAngle) * sensorOffsetDistance);

    const frx = wrap01(x + Math.cos(angle - sensorAngle) * sensorOffsetDistance);
    const fry = wrap01(y + Math.sin(angle - sensorAngle) * sensorOffsetDistance);

    const f = trailSample(fx, fy);
    const fl = trailSample(flx, fly);
    const fr = trailSample(frx, fry);

    if (f > fl && f > fr) {
      angle -= rotationAngle;
    } else if (f < fl && f < fr) {
      angle += (Math.random() < 0.5 ? -1 : 1) * rotationAngle;
    } else if (fl < fr) {
      angle -= rotationAngle;
    } else if (fr < fl) {
      angle += rotationAngle;
    }

    let nx = x + Math.cos(angle) * stepSize;
    let ny = y + Math.sin(angle) * stepSize;

    const dx = nx - 0.5;
    const dy = ny - 0.5;
    const outsideCircle = dx * dx + dy * dy > 0.25;

    if (outsideCircle) {
      angle += (Math.random() < 0.5 ? -1 : 1) * rotationAngle;
      nx = x;
      ny = y;
    }

    nx = saturate(nx);
    ny = saturate(ny);

    particles[base] = nx;
    particles[base + 1] = ny;
    particles[base + 2] = angle;

    if ((nx - x) * (nx - x) + (ny - y) * (ny - y) > MIN_MOVEMENT_THRESHOLD) {
      addTrail(nx, ny, 1);
      addTemperature(nx, ny, cellTemp);
    }
  }
}

function updateTrail() {
  const width = simWidth;
  const height = simHeight;
  let maxTemp = 0;

  for (let y = 0; y < height; y++) {
    const yMinus = y > 0 ? y - 1 : y;
    const yPlus = y < height - 1 ? y + 1 : y;

    for (let x = 0; x < width; x++) {
      const xMinus = x > 0 ? x - 1 : x;
      const xPlus = x < width - 1 ? x + 1 : x;

      const idx = y * width + x;

      let trailValue = trail[idx];
      trailValue += trail[yMinus * width + xMinus];
      trailValue += trail[yMinus * width + x];
      trailValue += trail[yMinus * width + xPlus];
      trailValue += trail[y * width + xMinus];
      trailValue += trail[y * width + xPlus];
      trailValue += trail[yPlus * width + xMinus];
      trailValue += trail[yPlus * width + x];
      trailValue += trail[yPlus * width + xPlus];
      trailValue = (trailValue / 9) * (1 - DECAY);
      nextTrail[idx] = trailValue;

      let tempValue = temperatureTrail[idx];
      tempValue += temperatureTrail[yMinus * width + xMinus];
      tempValue += temperatureTrail[yMinus * width + x];
      tempValue += temperatureTrail[yMinus * width + xPlus];
      tempValue += temperatureTrail[y * width + xMinus];
      tempValue += temperatureTrail[y * width + xPlus];
      tempValue += temperatureTrail[yPlus * width + xMinus];
      tempValue += temperatureTrail[yPlus * width + x];
      tempValue += temperatureTrail[yPlus * width + xPlus];
      tempValue = (tempValue / 9) * (1 - TEMP_DECAY);
      nextTemperatureTrail[idx] = tempValue;

      if (tempValue > maxTemp) {
        maxTemp = tempValue;
      }
    }
  }

  let swap = trail;
  trail = nextTrail;
  nextTrail = swap;

  swap = temperatureTrail;
  temperatureTrail = nextTemperatureTrail;
  nextTemperatureTrail = swap;

  relativeMaxTemperature = maxTemp;
}

function mapTemperatureToColor(tempNorm) {
  if (tempNorm <= 0.35) {
    const t = tempNorm / 0.35;
    return {
      r: lerp(COLOR_ISOLATED.r, COLOR_NEIGHBOR.r, t),
      g: lerp(COLOR_ISOLATED.g, COLOR_NEIGHBOR.g, t),
      b: lerp(COLOR_ISOLATED.b, COLOR_NEIGHBOR.b, t)
    };
  }

  if (tempNorm <= 0.8) {
    const t = (tempNorm - 0.35) / 0.45;
    return {
      r: lerp(COLOR_NEIGHBOR.r, COLOR_DEEP_BLUE.r, t),
      g: lerp(COLOR_NEIGHBOR.g, COLOR_DEEP_BLUE.g, t),
      b: lerp(COLOR_NEIGHBOR.b, COLOR_DEEP_BLUE.b, t)
    };
  }

  const t = (tempNorm - 0.8) / 0.2;
  return {
    r: lerp(COLOR_DEEP_BLUE.r, COLOR_MAX.r, t),
    g: lerp(COLOR_DEEP_BLUE.g, COLOR_MAX.g, t),
    b: lerp(COLOR_DEEP_BLUE.b, COLOR_MAX.b, t)
  };
}

function drawTrail() {
  const pixels = imagePixels;
  const len = trail.length;

  for (let i = 0; i < len; i++) {
    const density = clamp(trail[i], 0, 1);
    const temp = temperatureTrail[i];
    const p = i * 4;

    if (density < MIN_DENSITY_VISIBLE && temp <= 1e-6) {
      pixels[p] = 0;
      pixels[p + 1] = 0;
      pixels[p + 2] = 0;
      pixels[p + 3] = 255;
      continue;
    }

    const normalizedTemp = relativeMaxTemperature > 1e-8
      ? clamp(temp / relativeMaxTemperature, 0, 1)
      : 0;

    const baseColor = mapTemperatureToColor(normalizedTemp);
    const intensity = saturate((density - MIN_DENSITY_VISIBLE) * DENSITY_VISIBILITY_GAIN);

    pixels[p] = Math.floor(baseColor.r * intensity);
    pixels[p + 1] = Math.floor(baseColor.g * intensity);
    pixels[p + 2] = Math.floor(baseColor.b * intensity);
    pixels[p + 3] = 255;
  }

  simCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(simCanvas, 0, 0, canvas.width, canvas.height);
}

function updateStats() {
  if (!stats) return;
  stats.textContent =
    `cells ${activeParticles}/${maxParticles}  ` +
    `sensor ${sensorAngleDeg.toFixed(1)}°  ` +
    `range ${sensorOffsetDistance.toFixed(4)}  ` +
    `step ${stepSize.toFixed(4)}  ` +
    `tempMax ${relativeMaxTemperature.toFixed(4)}`;
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = false;
  }

  const minScale = Math.max(MIN_SIM_DIMENSION / width, MIN_SIM_DIMENSION / height);
  const maxScale = Math.min(MAX_SIM_DIMENSION / width, MAX_SIM_DIMENSION / height);
  const simScale = Math.max(minScale, Math.min(maxScale, SIM_RESOLUTION_SCALE));
  const targetSimWidth = clampInt(width * simScale, MIN_SIM_DIMENSION, MAX_SIM_DIMENSION);
  const targetSimHeight = clampInt(height * simScale, MIN_SIM_DIMENSION, MAX_SIM_DIMENSION);
  if (targetSimWidth !== simWidth || targetSimHeight !== simHeight) {
    resetSimulation(targetSimWidth, targetSimHeight);
  }
}

function onPointerMove(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  pointer.prevXNorm = pointer.xNorm;
  pointer.prevYNorm = pointer.yNorm;

  pointer.xNorm = clamp((clientX - rect.left) / rect.width, 0, 1);
  pointer.yNorm = clamp((clientY - rect.top) / rect.height, 0, 1);
  pointer.moved = true;

  mouseXNorm = pointer.xNorm;
  mouseYNorm = pointer.yNorm;
}

function processInteraction() {
  if (!pointer.active || !pointer.moved) return;

  const speed = Math.hypot(pointer.xNorm - pointer.prevXNorm, pointer.yNorm - pointer.prevYNorm);
  const spawnCount = clampInt(
    BASE_SPAWN_COUNT + speed * SPAWN_SPEED_SCALE,
    BASE_SPAWN_COUNT,
    MAX_SPAWN_COUNT
  );
  const heatBoost = clamp(speed * 24, 0, 0.85);

  spawnCellsAt(pointer.xNorm, pointer.yNorm, spawnCount, heatBoost);
  pointer.moved = false;
}

canvas.addEventListener('mousemove', (e) => {
  onPointerMove(e.clientX, e.clientY);
});

canvas.addEventListener('mouseenter', (e) => {
  pointer.active = true;
  onPointerMove(e.clientX, e.clientY);
});

canvas.addEventListener('mouseleave', () => {
  pointer.active = false;
  pointer.moved = false;
});

canvas.addEventListener('mousedown', (e) => {
  pointer.active = true;
  onPointerMove(e.clientX, e.clientY);
  spawnCellsAt(pointer.xNorm, pointer.yNorm, MAX_SPAWN_COUNT, 0.65);
});

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.changedTouches[0];
  if (!touch) return;

  activeTouchId = touch.identifier;
  pointer.active = true;
  onPointerMove(touch.clientX, touch.clientY);
  spawnCellsAt(pointer.xNorm, pointer.yNorm, MAX_SPAWN_COUNT, 0.65);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    if (touch.identifier === activeTouchId) {
      onPointerMove(touch.clientX, touch.clientY);
      pointer.active = true;
      break;
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === activeTouchId) {
      activeTouchId = -1;
      pointer.active = false;
      pointer.moved = false;
      break;
    }
  }
});

canvas.addEventListener('touchcancel', (e) => {
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === activeTouchId) {
      activeTouchId = -1;
      pointer.active = false;
      pointer.moved = false;
      break;
    }
  }
});

window.addEventListener('resize', resizeCanvas);

function frame() {
  processInteraction();
  updateControlsFromMouse();
  stepSize = clamp(stepSize, MIN_STEP_SIZE, MAX_STEP_SIZE);
  updateParticles();
  updateTrail();
  drawTrail();
  updateStats();
  requestAnimationFrame(frame);
}

resizeCanvas();
frame();
