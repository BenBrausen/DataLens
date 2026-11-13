// Civic Charts export: PNG stills, video (MP4 when the browser can encode it, else WebM),
// and voiceover audio (recorded or uploaded) mixed into the video track.
(function (PS) {
  // Inside a claude.ai artifact, downloads go through the viewer-confirmed `downloads`
  // capability; everywhere else, a normal browser download.
  async function download(blob, name) {
    const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) {
      try { await dl.save({ filename: name, data: blob }); return; }
      catch (e) { if (e?.code === 'declined') return; if (!['unavailable', 'not_granted', 'capability_disabled'].includes(e?.code)) throw new Error(e?.message || 'Save failed'); }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // Every export passes through here, so this is where exports are counted.
  PS.download = (blob, name) => {
    const n = String(name), kind = /-slides\.pptx$/.test(n) ? 'slides' : /-brief\.pdf$/.test(n) ? 'brief' : /carousel\.pdf$/.test(n) ? 'carousel'
      : /\.csv$/.test(n) ? 'data_csv' : /\.srt$/.test(n) ? 'captions' : /\.png$/.test(n) ? 'image' : /\.(mp4|webm)$/.test(n) ? 'video' : /\.json$/.test(n) ? 'project' : 'other';
    PS.track?.('export', { export_kind: kind, file_type: n.split('.').pop() });
    return download(blob, name);
  };
  // "U.S. Unemployment Rate" -> "us-unemployment-rate": drop periods and apostrophes before dashing.
  PS.slug = s => String(s).toLowerCase().replace(/[.'’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'civic-charts';

  PS.exportPNG = (renderer, name) => new Promise(res => renderer.canvas.toBlob(b => { download(b, name + '.png'); res(); }, 'image/png'));

  PS.videoMime = () => {
    const c = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null;
  };

  // Plays the timeline in real time into a MediaRecorder. Real-time capture keeps audio
  // in sync; the tab must stay visible while it runs (browsers throttle hidden tabs).
  PS.exportVideo = async function ({ renderer, duration, audioBuffer, onProgress, signal }) {
    const mime = PS.videoMime();
    if (!mime) throw new Error('This browser cannot record video. Use Chrome, Edge or Safari 17+.');
    const fps = 30;
    const stream = renderer.canvas.captureStream(fps);
    let actx, src;
    if (audioBuffer) {
      actx = new AudioContext();
      const dest = actx.createMediaStreamDestination();
      src = actx.createBufferSource(); src.buffer = audioBuffer; src.connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => (rec.onstop = res));
    renderer.draw(0);
    rec.start(250);
    if (src) src.start();
    const t0 = performance.now(), total = duration * 1000;
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) { reject(new Error('Export cancelled')); return; }
        const p = Math.min(1, (performance.now() - t0) / total);
        renderer.draw(p);
        onProgress?.(p);
        if (p < 1) requestAnimationFrame(tick); else setTimeout(resolve, 400);
      };
      requestAnimationFrame(tick);
    }).finally(() => { rec.state !== 'inactive' && rec.stop(); src?.stop?.(); });
    await done;
    actx?.close();
    stream.getTracks().forEach(t => t.stop());
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
  };

  // ---------- voiceover ----------
  PS.voices = () => (window.speechSynthesis ? speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)) : []);
  PS.speak = function (text, { voice, duration } = {}) {
    if (!window.speechSynthesis) return null;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = PS.voices().find(v => v.name === voice); if (v) u.voice = v;
    // ~2.6 words/sec at rate 1. Speed up (within reason) to fit the chosen duration.
    const words = text.split(/\s+/).length;
    u.rate = PS.clamp(words / 2.6 / (duration * 0.92), 0.85, 1.35);
    speechSynthesis.speak(u);
    return u;
  };
  PS.stopSpeaking = () => window.speechSynthesis?.cancel();
  PS.scriptSeconds = text => text.split(/\s+/).filter(Boolean).length / 2.6;

  // ---------- AI voice (Google Cloud Text-to-Speech, through our Worker) ----------
  // The Google key lives only in the Cloudflare Worker (worker/proxy.js) as a secret. The site
  // asks the Worker whether voices are on, gets a Turnstile bot check if one is configured,
  // then sends the script and gets MP3 audio back.
  PS.TTS_VOICES = [
    ['en-US-Chirp3-HD-Charon', 'Charon (calm, low)'],
    ['en-US-Chirp3-HD-Kore', 'Kore (clear, warm)'],
    ['en-US-Chirp3-HD-Puck', 'Puck (upbeat)'],
    ['en-US-Chirp3-HD-Aoede', 'Aoede (bright)'],
  ];
  PS.TTS_MAX = 1000;
  let ttsStatus;
  PS.ttsStatus = () => (ttsStatus ||= fetch(`${PS.API_BASE}api/tts/status`).then(r => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false })));
  function loadScript(src) {
    return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Could not load the bot check.')); document.head.appendChild(s); });
  }
  async function turnstileToken(sitekey) {
    await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    const el = document.createElement('div'); el.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:50'; document.body.appendChild(el);
    try {
      return await new Promise((res, rej) => {
        const id = window.turnstile.render(el, { sitekey, appearance: 'interaction-only', callback: res, 'error-callback': () => rej(new Error('The bot check failed. Try again.')), 'timeout-callback': () => rej(new Error('The bot check timed out. Try again.')) });
        setTimeout(() => { try { window.turnstile.remove(id); } catch { } rej(new Error('The bot check timed out. Try again.')); }, 60000);
      });
    } finally { setTimeout(() => el.remove(), 500); }
  }
  PS.aiVoice = async function (text, voice) {
    const st = await PS.ttsStatus();
    if (!st.enabled) throw new Error('AI voices aren\'t turned on for this site yet.');
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Write a script first.');
    if (clean.length > PS.TTS_MAX) throw new Error(`The script is ${clean.length} characters; AI voices take up to ${PS.TTS_MAX}. Shorten it.`);
    const token = st.sitekey ? await turnstileToken(st.sitekey) : '';
    const r = await fetch(`${PS.API_BASE}api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean, voice, token }) });
    if (!r.ok) { let msg = ''; try { msg = (await r.json()).error; } catch { } throw new Error(msg || `The voice service answered ${r.status}. Try again later.`); }
    return PS.decodeAudio(await r.blob());
  };

  PS.decodeAudio = async blob => {
    const ctx = new AudioContext();
    try { return await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close(); }
  };

  PS.recordMic = async function (duration, onStart) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => (rec.onstop = res));
    rec.start();
    onStart?.();
    await new Promise(r => setTimeout(r, duration * 1000));
    rec.stop(); await done;
    stream.getTracks().forEach(t => t.stop());
    return new Blob(chunks, { type: rec.mimeType });
  };
})(window.PS);
