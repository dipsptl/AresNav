// Synthesized NASA Mission Control audio cues via Web Audio API

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/** Crisp dual-tone orbital radar ping on waypoint clicks or site selection */
export function playRadarPing(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const harmonic = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(1280, now);
  osc.frequency.exponentialRampToValueAtTime(860, now + 0.18);

  harmonic.type = 'triangle';
  harmonic.frequency.setValueAtTime(1920, now);
  harmonic.frequency.exponentialRampToValueAtTime(1290, now + 0.16);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);

  osc.connect(gain);
  harmonic.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  harmonic.start(now);
  osc.stop(now + 0.26);
  harmonic.stop(now + 0.26);
}

/** Soft telemetry confirmation chirp on controls, HUD toggle, and Scout updates */
export function playTelemetryChirp(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(640, now);
  osc.frequency.setValueAtTime(960, now + 0.045);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.055, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.13);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.15);
}

/** Dramatic 3-pulse NASA spacecraft klaxon alarm for Solar Storm / Dust Alert */
export function playKlaxonAlarm(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const pulses = 3;
  const pulseInterval = 0.28;

  for (let i = 0; i < pulses; i++) {
    const start = now + i * pulseInterval;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    oscA.type = 'sawtooth';
    oscB.type = 'triangle';

    oscA.frequency.setValueAtTime(520, start);
    oscA.frequency.linearRampToValueAtTime(360, start + 0.21);

    oscB.frequency.setValueAtTime(660, start);
    oscB.frequency.linearRampToValueAtTime(440, start + 0.21);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, start);
    filter.frequency.exponentialRampToValueAtTime(750, start + 0.22);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.09, start + 0.02);
    gain.gain.setValueAtTime(0.08, start + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.24);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    oscA.start(start);
    oscB.start(start);
    oscA.stop(start + 0.25);
    oscB.stop(start + 0.25);
  }
}
