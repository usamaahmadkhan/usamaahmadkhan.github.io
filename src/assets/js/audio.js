/* ==========================================================================
   Generative ambient drone — V2-C. Web Audio API only, no audio file, no
   licensing question. Dynamically imported on first toggle (site.js), so
   this module costs nothing on a normal page load.

   Signal chain: 3 detuned oscillators -> lowpass filter (slow LFO-swept
   cutoff, so the tone drifts instead of looping) -> convolution reverb
   (impulse response generated from decaying noise, no file) -> master gain.
   ========================================================================== */

let ctx = null;
let masterGain = null;
let filterNode = null;

function buildImpulse(context, seconds = 4, decay = 3) {
  const rate = context.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = context.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return impulse;
}

export function initAudio() {
  if (ctx) return ctx;

  ctx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = ctx.createGain();
  masterGain.gain.value = 0;

  filterNode = ctx.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = 400;
  filterNode.Q.value = 0.6;

  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulse(ctx);

  // Root, a fifth above, and an octave above — a few cents of detune per
  // voice is what makes the beating/evolving texture rather than a static hum
  const voices = [
    { freq: 55, type: 'sine' },
    { freq: 82.4, type: 'triangle' },
    { freq: 110, type: 'sine' },
  ];

  voices.forEach(({ freq, type }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq + (Math.random() * 2 - 1) * 0.6;
    osc.connect(filterNode);
    osc.start();
  });

  // Slow LFO sweeping the filter cutoff — ~20s per cycle, so the tone drifts
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 180;
  lfo.connect(lfoDepth);
  lfoDepth.connect(filterNode.frequency);
  lfo.start();

  filterNode.connect(convolver);
  convolver.connect(masterGain);
  masterGain.connect(ctx.destination);

  return ctx;
}

export function setVolume(fraction, immediate = false) {
  if (!masterGain) return;
  const target = Math.max(0, Math.min(1, fraction));
  if (immediate) {
    masterGain.gain.value = target;
  } else {
    // 1.5s ramp — cutting a drone dead produces an audible click, ramping isn't optional
    masterGain.gain.setTargetAtTime(target, ctx.currentTime, 1.5);
  }
}

export function suspend() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
