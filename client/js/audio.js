/* client/js/audio.js — tiny synth SFX + BGM loop. No audio assets needed except bgm.ogg */
export function createAudio() {
  let ctx = null;
  let muted = false;
  const bgmSrc = (globalThis.SUNNY_DATA && SUNNY_DATA['assets/bgm.ogg']) || 'assets/bgm.ogg';
  const bgm = new Audio(bgmSrc);
  bgm.loop = true;
  bgm.volume = 0.32;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur = 0.12, type = 'sine', vol = 0.22, slide = 0) {
    if (muted) return;
    try {
      const a = ac(), o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start(); o.stop(a.currentTime + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
  function noise(dur = 0.2, vol = 0.15) {
    if (muted) return;
    try {
      const a = ac();
      const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = a.createBufferSource(); src.buffer = buf;
      const g = a.createGain(); g.gain.value = vol;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      src.connect(f).connect(g).connect(a.destination);
      src.start();
    } catch (e) { /* ignore */ }
  }

  const SFX = {
    till: () => tone(95, 0.14, 'square', 0.2, -40),
    plant: () => tone(420, 0.1, 'sine', 0.22, 220),
    water: () => noise(0.28, 0.18),
    harvest: () => { tone(660, 0.1, 'sine', 0.2); setTimeout(() => tone(880, 0.14, 'sine', 0.2), 90); },
    coin: () => { tone(880, 0.08, 'square', 0.12); setTimeout(() => tone(1320, 0.12, 'square', 0.12), 70); },
    pickup: () => tone(520, 0.09, 'triangle', 0.2, 180),
    buy: () => { tone(700, 0.08, 'triangle', 0.18); setTimeout(() => tone(1050, 0.1, 'triangle', 0.18), 80); },
    deny: () => tone(160, 0.16, 'sawtooth', 0.14, -40),
    ui: () => tone(600, 0.05, 'sine', 0.1),
  };

  return {
    play(name) { (SFX[name] || SFX.ui)(); },
    startBgm() {
      if (muted) return;
      bgm.play().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      bgm.muted = muted;
      if (!muted) bgm.play().catch(() => {});
      return muted;
    },
    get muted() { return muted; },
    unlock() { try { ac(); } catch (e) {} },
  };
}
