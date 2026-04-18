'use strict';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

const MIN_SIM_DIMENSION = 256;
const MAX_SIM_DIMENSION = 2048;
const SIM_RESOLUTION_SCALE = 0.5;
const GROUP_COUNT = 16;
const PARTICLE_PERCENTAGE = 0.02;
const BASE_ROTATION_ANGLE_DEG = 45;
const DECAY = 0.002;
const MIN_SENSOR_ANGLE_DEG = 5;
const MAX_SENSOR_ANGLE_DEG = 120;
const MIN_SENSOR_RANGE = 0.002;
const MAX_SENSOR_RANGE = 0.06;
const MIN_STEP_SIZE = 0.0002;
const MAX_STEP_SIZE = 0.008;
const STEP_KEY_DELTA = 0.001;
const MIN_MOVEMENT_THRESHOLD = 1e-8;

let sensorAngleDeg = 45;
let sensorOffsetDistance = 0.01;
let stepSize = 0.001;

let mouseXNorm = 0.5;
let mouseYNorm = 0.5;

let simWidth = 0;
let simHeight = 0;
let numberOfParticles = 0;
let particles = new Float32Array(0);
let trail = new Float32Array(0);
let nextTrail = new Float32Array(0);

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

function trailSample(xNorm, yNorm) {
  const x = clampInt(xNorm * (simWidth - 1), 0, simWidth - 1);
  const y = clampInt(yNorm * (simHeight - 1), 0, simHeight - 1);
  return trail[y * simWidth + x];
}

function setTrail(xNorm, yNorm, value) {
  const x = clampInt(xNorm * (simWidth - 1), 0, simWidth - 1);
  const y = clampInt(yNorm * (simHeight - 1), 0, simHeight - 1);
  trail[y * simWidth + x] = value;
}

function initializeParticles() {
  for (let i = 0; i < numberOfParticles; i++) {
    const base = i * 3;
    const x = Math.random();
    const y = Math.random();
    particles[base] = x;
    particles[base + 1] = y;
    particles[base + 2] = Math.atan2(0.5 - y, 0.5 - x);
  }
}

function resetSimulation(width, height) {
  simWidth = width;
  simHeight = height;
  simCanvas.width = simWidth;
  simCanvas.height = simHeight;

  numberOfParticles = Math.max(
    GROUP_COUNT,
    Math.floor(simWidth * simHeight * PARTICLE_PERCENTAGE)
  );
  particles = new Float32Array(numberOfParticles * 3);
  trail = new Float32Array(simWidth * simHeight);
  nextTrail = new Float32Array(simWidth * simHeight);
  imageData = simCtx.createImageData(simWidth, simHeight);
  imagePixels = imageData.data;
  initializeParticles();
}

function updateControlsFromMouse() {
  sensorAngleDeg = MIN_SENSOR_ANGLE_DEG + (1 - mouseYNorm) * (MAX_SENSOR_ANGLE_DEG - MIN_SENSOR_ANGLE_DEG);
  sensorOffsetDistance = MIN_SENSOR_RANGE + mouseXNorm * (MAX_SENSOR_RANGE - MIN_SENSOR_RANGE);
}

function updateParticles() {
  const sensorAngle = (sensorAngleDeg * Math.PI) / 180;
  const rotationAngle = (BASE_ROTATION_ANGLE_DEG * Math.PI) / 180;

  for (let i = 0; i < numberOfParticles; i++) {
    const base = i * 3;
    let x = particles[base];
    let y = particles[base + 1];
    let angle = particles[base + 2];

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
      setTrail(nx, ny, 1);
    }
  }
}

function updateTrail() {
  const width = simWidth;
  const height = simHeight;
  for (let y = 0; y < height; y++) {
    const yMinus = y > 0 ? y - 1 : y;
    const yPlus = y < height - 1 ? y + 1 : y;

    for (let x = 0; x < width; x++) {
      const xMinus = x > 0 ? x - 1 : x;
      const xPlus = x < width - 1 ? x + 1 : x;

      const idx = y * width + x;
      let value = trail[idx];
      value += trail[yMinus * width + xMinus];
      value += trail[yMinus * width + x];
      value += trail[yMinus * width + xPlus];
      value += trail[y * width + xMinus];
      value += trail[y * width + xPlus];
      value += trail[yPlus * width + xMinus];
      value += trail[yPlus * width + x];
      value += trail[yPlus * width + xPlus];

      value = (value / 9) * (1 - DECAY);
      nextTrail[idx] = value;
    }
  }

  const swap = trail;
  trail = nextTrail;
  nextTrail = swap;
}

function drawTrail() {
  const pixels = imagePixels;
  const len = trail.length;

  for (let i = 0; i < len; i++) {
    const v = clamp(trail[i], 0, 1);
    const c = Math.floor(v * 255);
    const p = i * 4;
    pixels[p] = c;
    pixels[p + 1] = c;
    pixels[p + 2] = c;
    pixels[p + 3] = 255;
  }

  simCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(simCanvas, 0, 0, canvas.width, canvas.height);
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
  mouseXNorm = clamp((clientX - rect.left) / rect.width, 0, 1);
  mouseYNorm = clamp((clientY - rect.top) / rect.height, 0, 1);
}

canvas.addEventListener('mousemove', (e) => {
  onPointerMove(e.clientX, e.clientY);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') {
    stepSize = clamp(stepSize - STEP_KEY_DELTA, MIN_STEP_SIZE, MAX_STEP_SIZE);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    stepSize = clamp(stepSize + STEP_KEY_DELTA, MIN_STEP_SIZE, MAX_STEP_SIZE);
    e.preventDefault();
  }
});

window.addEventListener('resize', resizeCanvas);

function frame() {
  updateControlsFromMouse();
  updateParticles();
  updateTrail();
  drawTrail();
  requestAnimationFrame(frame);
}

resizeCanvas();
frame();
