/*
 * Sound effects, synthesised with the Web Audio API (no audio files, no music).
 * Browsers only allow audio after a tap, so the context is created/resumed on the
 * first touch or key press. iPhones in silent mode stay silent, as expected.
 */
(function (BN) {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('bn.muted') === '1'; } catch (e) { /* storage unavailable */ }

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));

  // One oscillator note with a quick attack and exponential decay.
  function tone({ type = 'square', f = 440, f2 = null, t = 0, dur = 0.08, vol = 0.2 }) {
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  // Filtered noise burst, for thuds and whooshes.
  function noise({ t = 0, dur = 0.1, vol = 0.3, freq = 800, q = 1, type = 'lowpass' }) {
    const now = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(flt).connect(g).connect(master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  const SFX = {
    move:   () => tone({ type: 'square', f: 300, dur: 0.035, vol: 0.06 }),
    rotate: () => tone({ type: 'triangle', f: 520, f2: 780, dur: 0.06, vol: 0.14 }),
    soft:   () => tone({ type: 'square', f: 180, dur: 0.025, vol: 0.05 }),
    lock:   () => { noise({ dur: 0.07, vol: 0.25, freq: 600 }); tone({ type: 'sine', f: 140, f2: 80, dur: 0.08, vol: 0.2 }); },
    drop:   () => { noise({ dur: 0.12, vol: 0.35, freq: 2500, type: 'bandpass', q: 0.7 }); noise({ t: 0.03, dur: 0.12, vol: 0.4, freq: 500 }); tone({ type: 'sine', f: 110, f2: 55, t: 0.03, dur: 0.14, vol: 0.35 }); },
    clear:  n => {
      const notes = [523, 659, 784, 1047];
      for (let i = 0; i < n; i++) tone({ type: 'square', f: notes[i], t: i * 0.06, dur: 0.12, vol: 0.12 });
      if (n === 4) tone({ type: 'triangle', f: 1047, f2: 2093, t: 0.24, dur: 0.25, vol: 0.18 });
    },
    collect: () => { tone({ type: 'sine', f: 1319, t: 0.0, dur: 0.07, vol: 0.12 }); tone({ type: 'sine', f: 1760, t: 0.06, dur: 0.1, vol: 0.12 }); },
    zap:    () => tone({ type: 'sawtooth', f: 1200, f2: 180, dur: 0.18, vol: 0.12 }),
    hit:    () => { tone({ type: 'sawtooth', f: 160, f2: 60, dur: 0.25, vol: 0.2 }); noise({ dur: 0.15, vol: 0.2, freq: 300 }); },
    help:   () => { tone({ type: 'triangle', f: 660, t: 0, dur: 0.08, vol: 0.12 }); tone({ type: 'triangle', f: 990, t: 0.07, dur: 0.12, vol: 0.12 }); },
    chat:   () => tone({ type: 'sine', f: 880, dur: 0.09, vol: 0.08 }),
    dead:   () => [392, 330, 262, 196].forEach((f, i) => tone({ type: 'square', f, t: i * 0.13, dur: 0.16, vol: 0.12 })),
    win:    () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ type: 'square', f, t: i * 0.1, dur: i === 5 ? 0.35 : 0.12, vol: 0.12 })),
    start:  () => { tone({ type: 'square', f: 392, dur: 0.1, vol: 0.1 }); tone({ type: 'square', f: 784, t: 0.12, dur: 0.15, vol: 0.12 }); },
  };

  function play(name, arg) {
    if (muted || !SFX[name] || !init() || ctx.state !== 'running') return;
    try { SFX[name](arg); } catch (e) { /* never let audio break the game */ }
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('bn.muted', muted ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  }

  BN.sound = { play, unlock, setMuted, get muted() { return muted; } };
})(window.BN);
