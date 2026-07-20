'use strict';

const BPM = 128;
const SPB = 60 / BPM;
const S16 = SPB / 4;
const S8 = SPB / 2;
const MASTER_GAIN = 0.72;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const VOICE_PITCH_SEMITONES = Object.freeze([5, 0, -5]);
const VOICE_PITCH_RATES = Object.freeze(VOICE_PITCH_SEMITONES.map(semitones => Math.pow(2, semitones / 12)));

const stage = document.getElementById('stage');
const fxCanvas = document.getElementById('fx');
const fx = fxCanvas.getContext('2d');
const cat = document.getElementById('cat');
const catInner = document.getElementById('cat-inner');
const overlay = document.getElementById('overlay');
const topbar = document.getElementById('topbar');
const flashLayer = document.getElementById('flash');
const musicToggle = document.getElementById('music-toggle');
const sfxToggle = document.getElementById('sfx-toggle');
const sampleElements = Object.freeze({
  ha: document.getElementById('sample-ha'),
  ji: document.getElementById('sample-ji'),
  mi: document.getElementById('sample-mi'),
});
const sampleDataPromises = Object.freeze(Object.fromEntries(
  Object.entries(sampleElements).map(([name, element]) => [
    name,
    fetch(element.src)
      .then(response => response.ok ? response.arrayBuffer() : null)
      .catch(() => null),
  ])
));

let ctx = null;
let master = null;
let bgmBus = null;
let sfxBus = null;
let noiseBuffer = null;
const voiceBuffers = {};
let voiceBufferPromise = null;
let started = false;
let bgmMuted = false;
let sfxMuted = false;
let schedulerTimer = 0;
let transportStart = 0;
let nextNoteTime = 0;
let stepCount = 0;
let lastFrame = 0;
let beatPulse = 0;
let mouthTimer = 0;
let controlsTimer = 0;
let holding = false;
let catBounce = 0;
let catBounceVelocity = 0;
let jelly = 0;
let hissActive = false;
let hissPop = 0;
let hissPopVelocity = 0;
const activeVoiceMedia = new Set();
const activeVoiceSources = new Set();

const inputQueue = [];
const inputTimers = new Set();
const pointers = new Map();
let inputSerial = 0;
let lastCommittedInputTime = -Infinity;

const colors = {
  paper: '#f5f1ea',
  ink: '#262523',
  orange: '#e87922',
  coral: '#ef5d52',
  teal: '#159f92',
  blue: '#4775d1',
};
const accentColors = [colors.orange, colors.coral, colors.teal, colors.blue];
const voiceNames = [
  { key: 'ha', label: '哈' },
  { key: 'ji', label: '基' },
  { key: 'mi', label: '米' },
];
const fallbackHz = { ha: 261.63, ji: 329.63, mi: 392 };
const chords = [
  { bass: 65.41, notes: [261.63, 329.63, 392.00] },
  { bass: 49.00, notes: [196.00, 246.94, 293.66] },
  { bass: 55.00, notes: [220.00, 261.63, 329.63] },
  { bass: 43.65, notes: [174.61, 220.00, 261.63] },
];

let cols = 3;
let rows = 3;
let zones = [];

function nowVisual() { return performance.now() / 1000; }

function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  bgmBus = ctx.createGain();
  sfxBus = ctx.createGain();
  bgmBus.gain.value = 1;
  sfxBus.gain.value = 1;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 20;
  compressor.ratio.value = 5;
  compressor.attack.value = .004;
  compressor.release.value = .18;
  bgmBus.connect(master);
  sfxBus.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.destination);

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  loadVoiceBuffers();
}

function loadVoiceBuffers() {
  if (!ctx || voiceBufferPromise) return;
  voiceBufferPromise = Promise.all(Object.keys(sampleElements).map(name =>
    sampleDataPromises[name]
      .then(data => {
        if (!data) throw new Error(`${name} 采样加载失败`);
        return ctx.decodeAudioData(data.slice(0));
      })
      .then(buffer => { voiceBuffers[name] = buffer; })
  ))
    .then(() => { stage.dataset.audioEngine = 'web-audio'; })
    .catch(() => {
      stage.dataset.audioEngine = 'media-fallback';
      voiceBufferPromise = null;
    });
}

function setBusMuted(bus, muted) {
  if (!bus || !ctx) return;
  const t = ctx.currentTime;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setTargetAtTime(muted ? 0 : 1, t, .015);
}

function updateMuteButton(button, muted, label) {
  button.classList.toggle('is-muted', muted);
  button.setAttribute('aria-pressed', String(muted));
  button.title = `${muted ? '打开' : '关闭'}${label}`;
}

function toggleMusic() {
  bgmMuted = !bgmMuted;
  setBusMuted(bgmBus, bgmMuted);
  updateMuteButton(musicToggle, bgmMuted, '音乐');
}

function toggleSfx() {
  sfxMuted = !sfxMuted;
  setBusMuted(sfxBus, sfxMuted);
  updateMuteButton(sfxToggle, sfxMuted, '音效');
  if (sfxMuted) {
    catInner.classList.remove('is-hissing');
    hissActive = false;
    for (const media of activeVoiceMedia) media.pause();
    activeVoiceMedia.clear();
    for (const source of activeVoiceSources) {
      try { source.stop(); } catch (_) { /* 已经结束的音源无需再次停止 */ }
    }
    activeVoiceSources.clear();
  }
}

function showControlsLater() {
  topbar.classList.add('is-hidden');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => topbar.classList.remove('is-hidden'), 1700);
}

function rampGain(gain, t, peak, duration) {
  gain.gain.setValueAtTime(.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
}

function playOsc(type, frequency, t, duration, peak, bus, endFrequency = frequency) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, t);
  if (endFrequency !== frequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
  rampGain(gain, t, peak, duration);
  oscillator.connect(gain);
  gain.connect(bus);
  oscillator.start(t);
  oscillator.stop(t + duration + .02);
}

function kick(t) {
  playOsc('sine', 150, t, .22, .46, bgmBus, 44);
}

function snare(t, volume = .25) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer;
  filter.type = 'bandpass';
  filter.frequency.value = 1850;
  filter.Q.value = .9;
  rampGain(gain, t, volume, .14);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bgmBus);
  source.start(t);
  source.stop(t + .16);
  playOsc('triangle', 220, t, .09, volume * .45, bgmBus);
}

function hat(t, volume, decay = .05) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer;
  filter.type = 'highpass';
  filter.frequency.value = 7200;
  rampGain(gain, t, volume, decay);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bgmBus);
  source.start(t);
  source.stop(t + decay + .02);
}

function chordStab(t, notes) {
  for (const frequency of notes) playOsc('sawtooth', frequency, t, .24, .035, bgmBus, frequency * .99);
}

function bass(t, frequency, volume) {
  playOsc('square', frequency * 2, t, S8 * .85, volume, bgmBus, frequency * 1.02);
}

function scheduleStep(step, t) {
  const bar = (step / 16) | 0;
  const position = step % 16;
  const chord = chords[bar];
  if (position % 4 === 0) kick(t);
  if (position === 4 || position === 12) snare(t);
  hat(t, position % 4 === 0 ? .16 : .08, position === 14 ? .11 : .045);
  if (position % 4 === 2) chordStab(t, chord.notes);
  if (position % 2 === 0) bass(t, chord.bass, position % 4 === 0 ? .12 : .08);
}

function quantize(unit = S8) {
  const current = nowVisual();
  const index = Math.ceil((current + .02 - transportStart) / unit);
  return Math.max(current, transportStart + index * unit);
}

function scheduler() {
  if (ctx.state === 'running') {
    const horizon = ctx.currentTime + .12;
    while (nextNoteTime < horizon) {
      scheduleStep(stepCount, nextNoteTime);
      nextNoteTime += S16;
      stepCount = (stepCount + 1) % 64;
    }
  }
  scheduleQueuedInputs(nowVisual() + .035);
}

function playSynthVoice(sample, tier, t) {
  const rate = VOICE_PITCH_RATES[tier] || 1;
  const frequency = fallbackHz[sample] * rate;
  playOsc('triangle', frequency, t, .28, .17, sfxBus, frequency * .88);
  playOsc('sine', frequency * 2, t + .012, .2, .045, sfxBus, frequency * 1.6);
}

function playRecordedVoice(sample, tier, t) {
  const rate = VOICE_PITCH_RATES[tier] || 1;
  const element = sampleElements[sample];
  const buffer = voiceBuffers[sample];
  stage.dataset.voice = sample;
  stage.dataset.pitchTier = String(tier);
  stage.dataset.pitchRate = rate.toFixed(6);
  if (buffer) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(rate, t);
    gain.gain.setValueAtTime(.88, t);
    source.connect(gain);
    gain.connect(sfxBus);
    source.onended = () => activeVoiceSources.delete(source);
    activeVoiceSources.add(source);
    source.start(t);
    return;
  }

  const delay = Math.max(0, (t - ctx.currentTime) * 1000);
  window.setTimeout(() => {
    if (sfxMuted) return;
    const media = element.cloneNode(true);
    media.volume = .9;
    media.preservesPitch = false;
    if ('webkitPreservesPitch' in media) media.webkitPreservesPitch = false;
    media.playbackRate = rate;
    try { media.currentTime = 0; } catch (_) { /* 元数据尚未就绪时从开头播放 */ }
    activeVoiceMedia.add(media);
    const stop = () => {
      media.pause();
      activeVoiceMedia.delete(media);
      media.remove();
    };
    media.addEventListener('ended', stop, { once: true });
    window.setTimeout(stop, Math.ceil(1400 / rate));
    const result = media.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        stop();
        playSynthVoice(sample, tier, ctx.currentTime);
      });
    }
  }, delay);
}

function playVoice(sample, tier, t) {
  if (sfxMuted) return;
  playRecordedVoice(sample, tier, t);
}

function buildGrid() {
  const rect = stage.getBoundingClientRect();
  const landscape = rect.width >= rect.height;
  cols = 3;
  rows = 3;
  zones = [];
  if (landscape) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const voice = voiceNames[row];
        zones.push({ sample: voice.key, label: voice.label, tier: col });
      }
    }
  } else {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const voice = voiceNames[col];
        zones.push({ sample: voice.key, label: voice.label, tier: row });
      }
    }
  }
}

function metrics() {
  const rect = stage.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height), left: rect.left, top: rect.top };
}

function zoneIndex(x, y) {
  const { width, height, left, top } = metrics();
  const col = Math.min(cols - 1, Math.max(0, Math.floor((x - left) / width * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y - top) / height * rows)));
  return row * cols + col;
}

function zonesAlongSegment(x0, y0, x1, y1) {
  const { width, height, left, top } = metrics();
  const dx = x1 - x0;
  const dy = y1 - y0;
  const times = [0, 1];
  if (Math.abs(dx) > 1e-7) {
    for (let col = 1; col < cols; col++) {
      const t = (left + width * col / cols - x0) / dx;
      if (t > 0 && t < 1) times.push(t);
    }
  }
  if (Math.abs(dy) > 1e-7) {
    for (let row = 1; row < rows; row++) {
      const t = (top + height * row / rows - y0) / dy;
      if (t > 0 && t < 1) times.push(t);
    }
  }
  times.sort((a, b) => a - b);
  const result = [];
  const add = (t) => {
    const zone = zoneIndex(x0 + dx * t, y0 + dy * t);
    if (result[result.length - 1] !== zone) result.push(zone);
  };
  add(0);
  for (let i = 1; i < times.length; i++) add((times[i - 1] + times[i]) / 2);
  add(1);
  return result;
}

function flashZone(zone) {
  const row = (zone / cols) | 0;
  const col = zone % cols;
  const element = document.createElement('div');
  element.className = 'flash';
  element.style.left = `calc(${col * 100 / cols}% + 5px)`;
  element.style.top = `calc(${row * 100 / rows}% + 5px)`;
  element.style.width = `calc(${100 / cols}% - 10px)`;
  element.style.height = `calc(${100 / rows}% - 10px)`;
  element.addEventListener('animationend', () => element.remove(), { once: true });
  flashLayer.appendChild(element);
}

function removeQueuedSample(sample) {
  for (let i = inputQueue.length - 1; i >= 0; i--) {
    if (inputQueue[i].sample !== sample) continue;
    const state = pointers.get(inputQueue[i].pointerId);
    if (state && state.pendingId === inputQueue[i].id) state.pendingId = null;
    inputQueue.splice(i, 1);
  }
}

function reflowQueue() {
  let when = Math.max(quantize(), lastCommittedInputTime + S8);
  for (const entry of inputQueue) {
    entry.when = when;
    when += S8;
  }
}

function enqueueActivation(zone, pointerId) {
  const target = zones[zone];
  if (!target) return null;
  showControlsLater();
  removeQueuedSample(target.sample);
  const entry = {
    id: ++inputSerial,
    zone,
    pointerId,
    sample: target.sample,
    tier: target.tier,
    when: 0,
  };
  inputQueue.push(entry);
  reflowQueue();
  flashZone(zone);
  return entry;
}

function visualAt(zone, when) {
  const delay = Math.max(0, (when - nowVisual()) * 1000);
  const timer = setTimeout(() => {
    inputTimers.delete(timer);
    if (!sfxMuted) {
      hissActive = true;
      catInner.classList.add('is-hissing');
      clearTimeout(mouthTimer);
      mouthTimer = setTimeout(() => {
        hissActive = false;
        catInner.classList.remove('is-hissing');
      }, 460);
    }
    catBounceVelocity = Math.min(9, catBounceVelocity + 4.7);
    hissPopVelocity = Math.min(9, hissPopVelocity + 5.2);
    spawnEffect(zone, nowVisual());
  }, delay);
  inputTimers.add(timer);
}

function playQueuedInput(entry) {
  const audioWhen = ctx.currentTime + Math.max(0, entry.when - nowVisual());
  playVoice(entry.sample, entry.tier, audioWhen);
  visualAt(entry.zone, entry.when);
  const state = pointers.get(entry.pointerId);
  if (state && state.pendingId === entry.id) state.pendingId = null;
}

function scheduleQueuedInputs(horizon) {
  while (inputQueue.length && inputQueue[0].when < horizon) {
    const entry = inputQueue.shift();
    lastCommittedInputTime = entry.when;
    playQueuedInput(entry);
  }
}

function cancelPointerQueue(pointerId) {
  for (let i = inputQueue.length - 1; i >= 0; i--) {
    if (inputQueue[i].pointerId === pointerId) inputQueue.splice(i, 1);
  }
  reflowQueue();
}

function clearVisualTimers() {
  for (const timer of inputTimers) clearTimeout(timer);
  inputTimers.clear();
}

let fxWidth = 0;
let fxHeight = 0;
let effects = [];
const effectTypes = ['rings', 'burst', 'orbit', 'wave', 'cross', 'spark'];

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxWidth = Math.max(1, rect.width);
  fxHeight = Math.max(1, rect.height);
  fxCanvas.width = Math.round(fxWidth * dpr);
  fxCanvas.height = Math.round(fxHeight * dpr);
  fxCanvas.style.width = `${fxWidth}px`;
  fxCanvas.style.height = `${fxHeight}px`;
  fx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildEffect(zone) {
  const random = rng((zone + 1) * 7919 + Math.floor(Math.random() * 100000));
  const type = effectTypes[zone % effectTypes.length];
  const min = Math.min(fxWidth, fxHeight);
  const instance = {
    type,
    t0: nowVisual(),
    outAt: 0,
    rot: random() * Math.PI * 2,
    dir: random() > .5 ? 1 : -1,
    shapes: [],
    cx: fxWidth / 2,
    cy: fxHeight / 2,
  };
  if (type === 'rings') {
    for (let i = 0; i < 7; i++) instance.shapes.push({ radius: min * (.09 + random() * .37), delay: i * .045, color: accentColors[i % accentColors.length] });
  } else if (type === 'burst') {
    for (let i = 0; i < 20; i++) instance.shapes.push({ angle: random() * Math.PI * 2, length: min * (.25 + random() * .35), size: min * (.01 + random() * .02), delay: random() * .12, color: accentColors[(random() * accentColors.length) | 0] });
  } else if (type === 'orbit') {
    for (let i = 0; i < 12; i++) instance.shapes.push({ angle: i / 12 * Math.PI * 2, radius: min * (.16 + random() * .22), size: min * (.018 + random() * .03), speed: (random() + .35) * instance.dir, color: accentColors[i % accentColors.length] });
  } else if (type === 'wave') {
    for (let i = 0; i < 4; i++) instance.shapes.push({ y: fxHeight * (.2 + i * .2), amp: min * (.025 + random() * .03), width: fxWidth * (.3 + random() * .35), delay: i * .07, color: accentColors[i % accentColors.length] });
  } else if (type === 'cross') {
    instance.size = min * (.55 + random() * .2);
    instance.thickness = min * (.08 + random() * .035);
    instance.color = accentColors[(random() * accentColors.length) | 0];
  } else {
    for (let i = 0; i < 30; i++) instance.shapes.push({ x: fxWidth * (.04 + random() * .92), y: fxHeight * (.04 + random() * .92), size: min * (.01 + random() * .025), rot: random() * Math.PI, color: accentColors[(random() * accentColors.length) | 0], delay: random() * .22 });
  }
  return instance;
}

function spawnEffect(zone, when) {
  const now = nowVisual();
  for (const effect of effects) if (!effect.outAt) effect.outAt = now;
  const instance = buildEffect(zone);
  instance.t0 = Math.min(when, now + .05);
  effects.push(instance);
  while (effects.length > 6) effects.shift();
}

function ease(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function drawEffect(instance, t, fade) {
  const cx = instance.cx;
  const cy = instance.cy;
  const min = Math.min(fxWidth, fxHeight);
  if (instance.type === 'rings') {
    instance.shapes.forEach((shape, i) => {
      const k = ease((t - shape.delay) / .55);
      if (!k) return;
      fx.globalAlpha = fade * (.9 - k * .3);
      fx.strokeStyle = shape.color;
      fx.lineWidth = 5 + beatPulse * 7;
      fx.beginPath();
      fx.arc(cx, cy, shape.radius * k + beatPulse * min * .012, 0, Math.PI * 2);
      fx.stroke();
    });
  } else if (instance.type === 'burst') {
    instance.shapes.forEach((shape) => {
      const k = ease((t - shape.delay) / .5);
      if (!k) return;
      const radius = shape.length * k;
      fx.globalAlpha = fade;
      fx.fillStyle = shape.color;
      fx.beginPath();
      fx.arc(cx + Math.cos(shape.angle) * radius, cy + Math.sin(shape.angle) * radius, shape.size * (1 + beatPulse * .5), 0, Math.PI * 2);
      fx.fill();
    });
  } else if (instance.type === 'orbit') {
    instance.shapes.forEach((shape) => {
      const angle = shape.angle + t * shape.speed;
      const radius = shape.radius * (1 + beatPulse * .08);
      fx.globalAlpha = fade;
      fx.fillStyle = shape.color;
      fx.fillRect(cx + Math.cos(angle) * radius - shape.size / 2, cy + Math.sin(angle) * radius - shape.size / 2, shape.size, shape.size);
    });
    fx.globalAlpha = fade;
    fx.fillStyle = colors.orange;
    fx.beginPath();
    fx.arc(cx, cy, min * (.04 + beatPulse * .012), 0, Math.PI * 2);
    fx.fill();
  } else if (instance.type === 'wave') {
    instance.shapes.forEach((shape) => {
      const k = ease((t - shape.delay) / .6);
      if (!k) return;
      fx.globalAlpha = fade * .72;
      fx.strokeStyle = shape.color;
      fx.lineWidth = min * (.025 + beatPulse * .008);
      fx.beginPath();
      for (let x = -40; x <= fxWidth + 40; x += 14) {
        const y = shape.y + Math.sin(x / shape.width * Math.PI * 2 + t * 2) * shape.amp * (1 + beatPulse * .25);
        if (x === -40) fx.moveTo(x + (1 - k) * fxWidth * .7, y);
        else fx.lineTo(x + (1 - k) * fxWidth * .7, y);
      }
      fx.stroke();
    });
  } else if (instance.type === 'cross') {
    const k = 1 - Math.pow(1 - Math.min(1, t / .58), 3);
    fx.save();
    fx.translate(cx, cy);
    fx.rotate(instance.rot + t * .18 * instance.dir);
    fx.globalAlpha = fade;
    fx.fillStyle = instance.color;
    const size = instance.size * k;
    const thickness = instance.thickness * (1 + beatPulse * .12);
    fx.fillRect(-size, -thickness / 2, size * 2, thickness);
    fx.fillRect(-thickness / 2, -size, thickness, size * 2);
    fx.restore();
  } else {
    instance.shapes.forEach((shape) => {
      const k = ease((t - shape.delay) / .35);
      if (!k) return;
      fx.save();
      fx.translate(shape.x, shape.y + Math.sin(t * 2 + shape.x) * 5);
      fx.rotate(shape.rot + t * instance.dir);
      fx.globalAlpha = fade;
      fx.fillStyle = shape.color;
      fx.fillRect(-shape.size * k, -shape.size * k, shape.size * 2 * k, shape.size * 2 * k);
      fx.restore();
    });
  }
  fx.globalAlpha = 1;
}

function drawEffects(now) {
  fx.clearRect(0, 0, fxWidth, fxHeight);
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    if (effect.outAt && now - effect.outAt > .42) {
      effects.splice(i, 1);
      continue;
    }
    const t = now - effect.t0;
    if (t < 0) continue;
    const fade = effect.outAt ? 1 - ease((now - effect.outAt) / .42) : 1;
    drawEffect(effect, t, fade);
  }
}

function updateCat(dt, now) {
  const phase = started ? ((now - transportStart) / SPB) : 0;
  const beat = started ? ((phase % 1) + 1) % 1 : 1;
  beatPulse = REDUCED_MOTION ? 0 : Math.pow(1 - beat, 3.5);
  const sway = started ? Math.sin(phase * Math.PI) : 0;
  catBounceVelocity += (-catBounce) * 270 * dt;
  catBounceVelocity *= Math.exp(-14 * dt);
  catBounce += catBounceVelocity * dt;
  if (REDUCED_MOTION) {
    hissPop = hissActive ? 1 : 0;
    hissPopVelocity = 0;
  } else {
    const popTarget = hissActive ? 1 : 0;
    hissPopVelocity += (popTarget - hissPop) * 320 * dt;
    hissPopVelocity *= Math.exp(-13 * dt);
    hissPopVelocity = Math.max(-10, Math.min(10, hissPopVelocity));
    hissPop += hissPopVelocity * dt;
    hissPop = Math.max(-.12, Math.min(1.35, hissPop));
  }
  const holdTarget = pointers.size ? 1 : 0;
  jelly += (holdTarget - jelly) * (1 - Math.exp(-dt / (pointers.size ? .8 : .18)));
  const x = REDUCED_MOTION ? 0 : sway * 3.5;
  const y = -beatPulse * 8 - catBounce * 7;
  cat.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${(sway * 1.6).toFixed(2)}deg) scale(${(1 + beatPulse * .045).toFixed(4)}, ${(1 - beatPulse * .032).toFixed(4)})`;
  const jx = REDUCED_MOTION ? 0 : Math.sin(now * 124) * pointers.size * 2.2 * jelly;
  const jy = REDUCED_MOTION ? 0 : Math.cos(now * 137) * pointers.size * 1.8 * jelly;
  const popScale = 1 + .22 * hissPop;
  const holdScale = 1 + .1 * jelly;
  catInner.style.transform = `translate(${jx.toFixed(2)}px, ${jy.toFixed(2)}px) rotate(${(-3.5 * hissPop).toFixed(2)}deg) scale(${(popScale * holdScale).toFixed(4)})`;
  catInner.style.filter = pointers.size ? `hue-rotate(${(-12 * jelly).toFixed(1)}deg) saturate(${(1 + .25 * jelly).toFixed(2)})` : '';
}

function frame() {
  requestAnimationFrame(frame);
  const now = nowVisual();
  const dt = Math.min(.05, Math.max(.001, now - lastFrame || .016));
  lastFrame = now;
  updateCat(dt, now);
  drawEffects(now);
}

function tryActivate(pointerId, x, y, state) {
  if (!state) {
    state = { zone: -1, pendingId: null, lastX: x, lastY: y, repeatTimer: 0 };
    pointers.set(pointerId, state);
  }
  for (const zone of zonesAlongSegment(state.lastX, state.lastY, x, y)) {
    if (zone === state.zone) continue;
    state.zone = zone;
    const entry = enqueueActivation(zone, pointerId);
    if (entry) state.pendingId = entry.id;
  }
  state.lastX = x;
  state.lastY = y;
  return state;
}

function releasePointer(event, cancel = false) {
  const state = pointers.get(event.pointerId);
  if (state?.repeatTimer) clearInterval(state.repeatTimer);
  if (cancel) cancelPointerQueue(event.pointerId);
  pointers.delete(event.pointerId);
  if (!pointers.size) showControlsLater();
  try {
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  } catch (_) { /* 浏览器可能已经自动释放 */ }
}

async function start() {
  if (started) return;
  started = true;
  overlay.classList.add('is-hidden');
  topbar.classList.remove('is-hidden');
  initAudio();
  transportStart = nowVisual() + .12;
  nextNoteTime = ctx.currentTime + .12;
  stepCount = 0;
  schedulerTimer = window.setInterval(scheduler, 25);
  ctx.resume().then(() => {
    nextNoteTime = ctx.currentTime + .04;
  }).catch(() => { /* 某些浏览器会延迟音频解锁，但视觉仍可运行 */ });
}

async function triggerKeyboardZone(zone) {
  if (zone < 0 || zone >= zones.length) return;
  if (!started) await start();
  enqueueActivation(zone, `keyboard-${zone}`);
  showControlsLater();
}

overlay.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  start();
});
overlay.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') start();
});

for (const button of [musicToggle, sfxToggle]) {
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => event.stopPropagation());
}
musicToggle.addEventListener('click', toggleMusic);
sfxToggle.addEventListener('click', toggleSfx);

stage.addEventListener('pointerdown', async (event) => {
  if (event.target.closest('button')) return;
  event.preventDefault();
  if (!started) await start();
  try { stage.setPointerCapture(event.pointerId); } catch (_) { /* 可选能力 */ }
  const state = tryActivate(event.pointerId, event.clientX, event.clientY, null);
  state.repeatTimer = window.setInterval(() => {
    if (state.zone < 0 || !pointers.has(event.pointerId)) return;
    const entry = enqueueActivation(state.zone, event.pointerId);
    if (entry) state.pendingId = entry.id;
  }, 420);
  showControlsLater();
}, { passive: false });

stage.addEventListener('pointermove', (event) => {
  const state = pointers.get(event.pointerId);
  if (!state || !started) return;
  event.preventDefault();
  tryActivate(event.pointerId, event.clientX, event.clientY, state);
}, { passive: false });

window.addEventListener('pointerup', (event) => releasePointer(event, false));
window.addEventListener('pointercancel', (event) => releasePointer(event, true));
window.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const zone = Number(event.key) - 1;
  if (!Number.isInteger(zone) || zone < 0 || zone > 8) return;
  event.preventDefault();
  triggerKeyboardZone(zone);
});
window.addEventListener('blur', () => {
  for (const state of pointers.values()) if (state.repeatTimer) clearInterval(state.repeatTimer);
  pointers.clear();
  inputQueue.length = 0;
  clearVisualTimers();
});
window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('resize', () => { resizeCanvas(); buildGrid(); });

buildGrid();
resizeCanvas();
updateMuteButton(musicToggle, false, '音乐');
updateMuteButton(sfxToggle, false, '音效');
requestAnimationFrame(frame);
