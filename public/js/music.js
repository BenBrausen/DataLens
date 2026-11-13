// Civic Charts music: original background music composed in the browser for each video.
// Nothing is sampled or licensed, so no Content ID system can claim it, and every track is
// exactly as long as the video. Three moods (laid back, energetic, building), seeded so the
// same chart gets the same music. Rendered offline with Web Audio, then mixed under any
// voiceover with automatic ducking (PS.soundtrack).
(function (PS) {
  const SR = 44100;
  PS.MOODS = [
    ['none', 'None'],
    ['chill', 'Laid back'],
    ['energetic', 'Energetic'],
    ['build', 'Building'],
  ];
  const MOOD_NAME = Object.fromEntries(PS.MOODS);
  PS.moodName = m => MOOD_NAME[m] || m;

  // Small seeded random generator, so one chart always gets the same music.
  function rng(seed) {
    let a = 0; for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hz = midi => 440 * 2 ** ((midi - 69) / 12);

  // Chords are scale degrees from the key's root, as semitone stacks.
  const MAJ7 = [0, 4, 7, 11], MIN7 = [0, 3, 7, 10], ADD9 = [0, 4, 7, 14], MIN9 = [0, 3, 7, 14], SUS2 = [0, 2, 7, 12], MAJ = [0, 4, 7, 12], MIN = [0, 3, 7, 12];
  const STYLE = {
    // Lo-fi feel: slow, soft, warm chords and a gentle pulse.
    chill: { bpm: [74, 84], keys: [57, 58, 60, 62], prog: [[[0, MAJ7], [9, MIN7], [5, MAJ7], [7, ADD9]], [[0, ADD9], [4, MIN7], [9, MIN9], [5, MAJ7]], [[2, MIN9], [7, ADD9], [0, MAJ7], [9, MIN7]]],
      barsPerChord: 1, cutoff: 1400, drums: 'soft', arp: false, keysNotes: true },
    // Bright and driving.
    energetic: { bpm: [112, 122], keys: [55, 57, 59, 60], prog: [[[9, MIN], [5, MAJ], [0, MAJ], [7, MAJ]], [[0, MAJ], [7, MAJ], [9, MIN], [5, MAJ]], [[5, MAJ], [0, MAJ], [7, SUS2], [9, MIN]]],
      barsPerChord: 1, cutoff: 3200, drums: 'full', arp: true, keysNotes: false },
    // Starts sparse and swells to the chart's reveal, then settles.
    build: { bpm: [92, 100], keys: [57, 59, 60, 62], prog: [[[0, MIN], [8, MAJ], [3, MAJ], [10, MAJ]], [[0, MIN9], [5, MIN7], [8, MAJ7], [10, SUS2]]],
      barsPerChord: 1, cutoff: 2200, drums: 'build', arp: true, keysNotes: false },
  };

  function impulse(ctx, seconds, decay, rand) {
    const len = Math.floor(SR * seconds), buf = ctx.createBuffer(2, len, SR);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * (1 - i / len) ** decay; }
    return buf;
  }
  function noiseBuffer(ctx, rand) {
    const buf = ctx.createBuffer(1, SR, SR), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    return buf;
  }

  // Renders `duration` seconds of music for `mood`. `revealAt` (seconds) is where the chart's
  // story lands; the building mood peaks there.
  PS.makeMusic = async function ({ mood, duration, seed = 'civic', revealAt }) {
    const st = STYLE[mood]; if (!st) return null;
    const rand = rng(seed + '|' + mood);
    const pick = a => a[Math.floor(rand() * a.length)];
    const bpm = Math.round(st.bpm[0] + rand() * (st.bpm[1] - st.bpm[0])), beat = 60 / bpm, bar = beat * 4;
    const key = pick(st.keys), prog = pick(st.prog);
    const len = Math.ceil((duration + 0.2) * SR);
    const ctx = new OfflineAudioContext(2, len, SR);
    const reveal = Math.min(duration - 1, revealAt ?? duration * 0.72);
    const end = duration;

    // Master chain: gentle compression, overall fade-in and fade-out.
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    const master = ctx.createGain(); master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(1, 0.6);
    master.gain.setValueAtTime(1, Math.max(0.7, end - 1.6)); master.gain.linearRampToValueAtTime(0, end);
    comp.connect(master).connect(ctx.destination);
    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 2.6, 2.4, rand);
    const verbGain = ctx.createGain(); verbGain.gain.value = mood === 'chill' ? 0.32 : 0.22; verb.connect(verbGain).connect(comp);
    const bus = (dry = 1, wet = 0.5) => { const g = ctx.createGain(); g.gain.value = dry; g.connect(comp); const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(verb); return g; };
    const noise = noiseBuffer(ctx, rand);

    // How intense the track is at time t (0..1). Building ramps to the reveal; others hold.
    const intensity = t => (mood !== 'build' ? 1 : t < reveal ? 0.15 + 0.85 * (t / reveal) ** 1.6 : t < reveal + bar * 2 ? 1 : 0.7);

    // ---- pad: detuned saws through a low-pass filter ----
    const padBus = bus(0.16, 0.6);
    const chordAt = i => prog[Math.floor(i / st.barsPerChord) % prog.length];
    const nBars = Math.ceil(end / bar);
    for (let b = 0; b < nBars; b++) {
      const t0 = b * bar, t1 = Math.min(end + 0.2, t0 + bar * 1.02);
      const [deg, shape] = chordAt(b), root = key + deg - (deg > 6 ? 12 : 0);
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
      const cut = st.cutoff * (0.45 + 0.55 * intensity(t0));
      filt.frequency.setValueAtTime(cut * 0.7, t0); filt.frequency.linearRampToValueAtTime(cut, t0 + bar * 0.5); filt.Q.value = 0.7;
      const env = ctx.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(1, t0 + Math.min(0.5, bar * 0.2)); env.gain.setValueAtTime(1, t1 - 0.12); env.gain.linearRampToValueAtTime(0, t1);
      filt.connect(env).connect(padBus);
      for (const iv of shape) for (const det of [-7, 6]) {
        const o = ctx.createOscillator(); o.type = mood === 'chill' ? 'triangle' : 'sawtooth';
        o.frequency.value = hz(root + iv); o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = 0.22 / shape.length;
        o.connect(g).connect(filt); o.start(t0); o.stop(t1 + 0.05);
      }
    }

    // ---- bass: root on the beat (energetic) or held (others) ----
    const bassBus = bus(mood === 'energetic' ? 0.34 : 0.22, 0.05);
    for (let b = 0; b < nBars; b++) {
      const t0 = b * bar, [deg] = chordAt(b), note = key + deg - 24 - (deg > 6 ? 12 : 0);
      const hits = mood === 'energetic' ? [0, 1, 2, 3].map(k => t0 + k * beat) : mood === 'build' && intensity(t0) > 0.55 ? [t0, t0 + beat * 2] : [t0];
      for (const t of hits) {
        if (t >= end) continue;
        const dur = mood === 'energetic' ? beat * 0.85 : Math.min(bar, end - t) * (hits.length > 1 ? 0.5 : 0.95);
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(note);
        const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = hz(note + 12);
        const g = ctx.createGain(), g2 = ctx.createGain(); g2.gain.value = 0.18;
        const v = intensity(t);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.02);
        // Energetic: short punchy notes. Others: a held note that eases off slightly, so the
        // level doesn't pump bar to bar.
        if (mood === 'energetic') g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        else { g.gain.linearRampToValueAtTime(v * 0.75, t + dur * 0.6); g.gain.linearRampToValueAtTime(v * 0.6, t + dur - 0.08); g.gain.linearRampToValueAtTime(0, t + dur); }
        o.connect(g); o2.connect(g2).connect(g); g.connect(bassBus);
        o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
      }
    }

    // ---- drums ----
    const drumBus = bus(0.5, 0.06);
    const kick = (t, v = 1) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.35);
    };
    const hiss = (t, dur, freq, type, v) => {
      const s = ctx.createBufferSource(); s.buffer = noise; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(drumBus); s.start(t, rand() * 0.5); s.stop(t + dur + 0.02);
    };
    for (let b = 0; b < nBars; b++) for (let k = 0; k < 8; k++) {
      const t = b * bar + k * beat / 2; if (t >= end - 0.3) continue;
      const i = intensity(t), on = k % 2 === 0;
      if (st.drums === 'soft') {
        if (k === 0 || k === 5) kick(t, 0.55);
        if (k === 4) hiss(t, 0.18, 1800, 'bandpass', 0.18);
        hiss(t + (k % 2 ? beat * 0.06 : 0), 0.05, 7000, 'highpass', on ? 0.05 : 0.03); // lazy swung hats
      } else if (st.drums === 'full') {
        if (on) kick(t, 0.9);
        if (k === 2 || k === 6) hiss(t, 0.16, 2000, 'bandpass', 0.32);
        hiss(t, 0.04, 8000, 'highpass', on ? 0.05 : 0.09);
      } else { // build: hats arrive first, then kick, then snare near the reveal
        if (i > 0.35) hiss(t, 0.04, 8000, 'highpass', 0.06 * i);
        if (i > 0.5 && on) kick(t, 0.8 * i);
        if (i > 0.75 && (k === 2 || k === 6)) hiss(t, 0.16, 2000, 'bandpass', 0.3 * i);
      }
    }
    // Building: a noise riser and a cymbal-like swell into the reveal.
    if (mood === 'build' && reveal > 3) {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(400, reveal - 2.5); f.frequency.exponentialRampToValueAtTime(6000, reveal);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, reveal - 2.5); g.gain.linearRampToValueAtTime(0.16, reveal - 0.05); g.gain.linearRampToValueAtTime(0, reveal + 0.05);
      s.connect(f).connect(g).connect(bus(1, 0.4)); s.start(reveal - 2.5); s.stop(reveal + 0.1);
      kick(reveal, 1); hiss(reveal, 1.6, 5000, 'highpass', 0.12);
    }

    // ---- melody: plucked arpeggio (energetic, build) or sparse electric-piano notes (chill) ----
    const leadBus = bus(0.1, 0.5);
    const pluck = (t, midi, dur, v, type = 'triangle') => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(midi);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(leadBus); o.start(t); o.stop(t + dur + 0.05);
    };
    for (let b = 0; b < nBars; b++) {
      const t0 = b * bar, [deg, shape] = chordAt(b), root = key + deg + 12 - (deg > 6 ? 12 : 0);
      if (st.arp) {
        for (let k = 0; k < 8; k++) {
          const t = t0 + k * beat / 2, i = intensity(t); if (t >= end - 0.4 || (mood === 'build' && i < 0.45)) continue;
          pluck(t, root + shape[[0, 1, 2, 1, 3, 2, 1, 2][k] % shape.length], beat * 0.9, 0.5 * i);
        }
      } else if (st.keysNotes) {
        for (let k = 0; k < 4; k++) {
          const t = t0 + k * beat; if (t >= end - 0.6 || rand() < 0.45) continue;
          pluck(Math.max(0, t + (rand() - 0.5) * 0.04), root + pick(shape) + (rand() < 0.3 ? 12 : 0), beat * 1.8, 0.42, 'sine');
        }
      }
    }

    const out = await ctx.startRendering();
    normalize(out, 0.7);
    return out;
  };

  function normalize(buf, target) {
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
    if (!peak) return;
    const k = target / peak;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= k; }
  }

  // Where speech is happening in a voice track: [start, end] spans in seconds, from the
  // loudness in 50 ms windows, with short gaps bridged so the music doesn't pump between words.
  PS.speechSpans = function (voice) {
    const d = voice.getChannelData(0), win = Math.floor(voice.sampleRate * 0.05), rms = [];
    for (let i = 0; i < d.length; i += win) { let s = 0; const n = Math.min(win, d.length - i); for (let j = 0; j < n; j++) s += d[i + j] ** 2; rms.push(Math.sqrt(s / n)); }
    const peak = Math.max(...rms, 1e-6), thr = Math.max(0.01, peak * 0.08), spans = [];
    let cur = null;
    rms.forEach((r, k) => {
      const t = k * 0.05;
      if (r > thr) { if (cur && t - cur[1] <= 0.45) cur[1] = t + 0.05; else { cur = [t, t + 0.05]; spans.push(cur); } }
    });
    return spans;
  };

  // Final audio for a video: music under the voice, ducked to ~15% while words are spoken.
  // Returns an AudioBuffer (or null when there's neither music nor voice).
  const musicCache = new Map();
  PS.soundtrack = async function ({ voice, mood, duration, seed, revealAt }) {
    const wantMusic = mood && mood !== 'none' && STYLE[mood];
    if (!wantMusic) return voice || null;
    const length = Math.max(duration, voice ? voice.duration : 0);
    const k = `${mood}|${length.toFixed(2)}|${seed}|${(revealAt ?? -1).toFixed(2)}`;
    if (!musicCache.has(k)) { if (musicCache.size > 6) musicCache.clear(); musicCache.set(k, PS.makeMusic({ mood, duration: length, seed, revealAt })); }
    const music = await musicCache.get(k);
    const ctx = new OfflineAudioContext(2, Math.ceil(length * SR), SR);
    const m = ctx.createBufferSource(); m.buffer = music;
    const mg = ctx.createGain();
    const FULL = voice ? 0.55 : 0.8, DUCK = 0.12;
    mg.gain.setValueAtTime(FULL, 0);
    if (voice) {
      // Duck a little before each phrase and recover after it.
      for (const [a, b] of PS.speechSpans(voice)) {
        mg.gain.setTargetAtTime(DUCK, Math.max(0, a - 0.15), 0.06);
        mg.gain.setTargetAtTime(FULL, b + 0.2, 0.35);
      }
      const v = ctx.createBufferSource(); v.buffer = voice; v.connect(ctx.destination); v.start(0);
    }
    m.connect(mg).connect(ctx.destination); m.start(0);
    const out = await ctx.startRendering();
    normalize(out, 0.89);
    return out;
  };
})(window.PS);
