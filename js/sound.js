/*
 * Sound effects, synthesised with the Web Audio API (no audio files, no music).
 * Browsers only allow audio after a tap, so the context is created/resumed on the
 * first touch or key press.
 *
 * iPhone: Web Audio is normally silenced by the ring/silent switch. We ask for the
 * "playback" audio session (Safari 17+), and on older iOS loop a silent <audio> element,
 * which has the same effect. Either way the game is audible like a video would be; use
 * the in-game mute button to silence it.
 */
(function (BN) {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let htmlAudio = null;
  const VOL = 1.875; // overall loudness (2.5 reduced by 25%); a compressor keeps peaks from distorting
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SILENT_WAV = 'data:audio/wav;base64,UklGRsQPAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAPAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
  try { muted = localStorage.getItem('bn.muted') === '1'; } catch (e) { /* storage unavailable */ }

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.1;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // Browsers only let audio start inside a real user gesture. On touch screens that is the
  // finger lifting (touchend / pointerup / click), not touching down, so listen to all of
  // them. Safari also needs a sound to actually be played during that gesture, so a silent
  // one-sample buffer is played each time the context is (re)started.
  function unlock() {
    if (!init()) return;
    // Older iOS: a playing <audio> element switches the page to the media audio session,
    // so the silent switch no longer mutes Web Audio.
    if (isIOS && !navigator.audioSession && !htmlAudio) {
      try {
        htmlAudio = new Audio(SILENT_WAV);
        htmlAudio.loop = true;
        htmlAudio.setAttribute('playsinline', '');
        const pr = htmlAudio.play();
        if (pr && pr.catch) pr.catch(() => { htmlAudio = null; });
      } catch (e) { htmlAudio = null; }
    }
    if (ctx.state !== 'running') {
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
      if (ctx.resume) ctx.resume().catch(() => {});
    }
  }
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown']
    .forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
  // iOS suspends audio when the page goes to the background; the next tap restarts it.

  // One oscillator note with a quick attack and exponential decay.
  function tone({ type = 'square', f = 440, f2 = null, t = 0, dur = 0.08, vol = 0.2 }) {
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.min(1, vol * VOL), now + 0.005);
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
    g.gain.setValueAtTime(Math.min(1, vol * VOL), now);
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
    test:   () => [523, 659, 784].forEach((f, i) => tone({ type: 'square', f, t: i * 0.12, dur: 0.14, vol: 0.2 })),
    start:  () => { tone({ type: 'square', f: 392, dur: 0.1, vol: 0.1 }); tone({ type: 'square', f: 784, t: 0.12, dur: 0.15, vol: 0.12 }); },
  };

  function play(name, arg, force = false) {
    if ((muted && !force) || !SFX[name] || !init() || ctx.state !== 'running') return;
    try { SFX[name](arg); } catch (e) { /* never let audio break the game */ }
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('bn.muted', muted ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  }

  // For the lobby's "Test sound" button: what the phone's audio is doing.
  function status() {
    const parts = [];
    if (!(window.AudioContext || window.webkitAudioContext)) return 'This browser has no Web Audio support.';
    parts.push('audio ' + (ctx ? ctx.state : 'not started'));
    if (navigator.audioSession) parts.push('session ' + navigator.audioSession.type);
    else if (isIOS) parts.push('silent-switch bypass ' + (htmlAudio && !htmlAudio.paused ? 'on' : 'off'));
    parts.push(muted ? 'game sound OFF' : 'game sound on');
    return parts.join(' · ');
  }

  BN.sound = { play, unlock, setMuted, status, get muted() { return muted; }, _ctx: () => ctx };
})(window.BN);
