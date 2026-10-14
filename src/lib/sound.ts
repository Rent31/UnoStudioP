// Tiny Web Audio synth for game sound effects. No asset files needed.

export type SoundKind =
  | "play" | "draw" | "uno" | "flip" | "reverse" | "skip" | "wild"
  | "win" | "join" | "catch" | "eliminate" | "deal" | "error" | "click"
  | "shuffle" | "stack" | "roulette";

let ctx: AudioContext | null = null;
let enabled = true;

let bus: GainNode | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function out(c: AudioContext): AudioNode {
  return bus ?? c.destination;
}

export function initSoundPref() {
  try {
    const v = localStorage.getItem("uno-sound");
    enabled = v !== "off";
  } catch {}
}

export function soundEnabled() { return enabled; }
export function setSoundEnabled(v: boolean) {
  enabled = v;
  try { localStorage.setItem("uno-sound", v ? "on" : "off"); } catch {}
}

let noiseCache: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseCache) return noiseCache;
  const len = Math.floor(c.sampleRate * 1.2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = buf;
  return buf;
}

interface ToneOpts { f: number; f2?: number; d: number; type?: OscillatorType; g?: number; t?: number }
function tone(o: ToneOpts) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + (o.t ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t0 + o.d);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(o.g ?? 0.12, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.d);
  osc.connect(gain).connect(out(c));
  osc.start(t0); osc.stop(t0 + o.d + 0.02);
}

interface NoiseOpts { d: number; t?: number; g?: number; hp?: number; lp?: number; sweep?: number }
function noise(o: NoiseOpts) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + (o.t ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const flt = c.createBiquadFilter();
  flt.type = "bandpass";
  flt.frequency.setValueAtTime(o.lp ?? 1200, t0);
  if (o.sweep) flt.frequency.exponentialRampToValueAtTime(o.sweep, t0 + o.d);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(o.g ?? 0.1, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.d);
  src.connect(flt).connect(gain).connect(out(c));
  src.start(t0); src.stop(t0 + o.d + 0.05);
}

// Identical effects fired within this window collapse into one.
const lastAt = new Map<SoundKind, number>();
const DEDUPE_MS = 110;

export function playSound(kind: SoundKind) {
  if (!enabled) return;
  const t = typeof performance !== "undefined" ? performance.now() : Date.now();
  const prev = lastAt.get(kind) ?? -1e9;
  if (t - prev < DEDUPE_MS) return;
  lastAt.set(kind, t);
  try {
    switch (kind) {
      case "play":
        noise({ d: 0.09, g: 0.16, lp: 900, sweep: 300 });
        tone({ f: 240, f2: 120, d: 0.09, type: "square", g: 0.05 });
        break;
      case "stack":
        noise({ d: 0.1, g: 0.16, lp: 700, sweep: 240 });
        tone({ f: 180, f2: 90, d: 0.12, type: "square", g: 0.06 });
        tone({ f: 90, f2: 60, d: 0.14, type: "sine", g: 0.08, t: 0.05 });
        break;
      case "draw":
        noise({ d: 0.07, g: 0.11, lp: 600, sweep: 200 });
        tone({ f: 150, f2: 90, d: 0.08, type: "triangle", g: 0.07 });
        break;
      case "shuffle":
        for (let i = 0; i < 5; i++) noise({ d: 0.05, t: i * 0.055, g: 0.09, lp: 1400 - i * 150 });
        break;
      case "deal":
        for (let i = 0; i < 3; i++) noise({ d: 0.05, t: i * 0.07, g: 0.1, lp: 1500, sweep: 700 });
        break;
      case "uno":
        tone({ f: 660, d: 0.09, type: "square", g: 0.09 });
        tone({ f: 880, d: 0.14, type: "square", g: 0.09, t: 0.1 });
        break;
      case "catch":
        tone({ f: 220, f2: 110, d: 0.22, type: "sawtooth", g: 0.1 });
        tone({ f: 165, f2: 82, d: 0.24, type: "square", g: 0.06, t: 0.02 });
        break;
      case "flip":
        noise({ d: 0.34, g: 0.14, lp: 500, sweep: 3800 });
        tone({ f: 180, f2: 620, d: 0.28, type: "triangle", g: 0.06 });
        break;
      case "reverse":
        tone({ f: 420, d: 0.08, type: "square", g: 0.08 });
        tone({ f: 260, d: 0.12, type: "square", g: 0.08, t: 0.09 });
        break;
      case "skip":
        tone({ f: 520, d: 0.07, type: "square", g: 0.09 });
        tone({ f: 390, d: 0.05, type: "square", g: 0.05, t: 0.07 });
        break;
      case "wild":
        tone({ f: 523, d: 0.1, type: "triangle", g: 0.08 });
        tone({ f: 659, d: 0.1, type: "triangle", g: 0.08, t: 0.08 });
        tone({ f: 784, d: 0.16, type: "triangle", g: 0.09, t: 0.16 });
        break;
      case "roulette":
        for (let i = 0; i < 6; i++) tone({ f: 300 + i * 90, d: 0.05, type: "square", g: 0.05, t: i * 0.05 });
        noise({ d: 0.2, t: 0.3, g: 0.08, lp: 1000, sweep: 300 });
        break;
      case "eliminate":
        tone({ f: 320, f2: 60, d: 0.5, type: "sawtooth", g: 0.1 });
        noise({ d: 0.4, g: 0.06, lp: 300 });
        break;
      case "win":
        [523, 659, 784, 1046].forEach((f, i) => tone({ f, d: 0.18, type: "triangle", g: 0.1, t: i * 0.11 }));
        tone({ f: 1318, d: 0.4, type: "triangle", g: 0.08, t: 0.46 });
        break;
      case "join":
        tone({ f: 520, d: 0.06, type: "sine", g: 0.08 });
        tone({ f: 700, d: 0.09, type: "sine", g: 0.08, t: 0.07 });
        break;
      case "click":
        tone({ f: 900, d: 0.03, type: "square", g: 0.04 });
        break;
      case "error":
        tone({ f: 130, d: 0.16, type: "square", g: 0.08 });
        break;
    }
  } catch {}
}

// Map a server event type to a sound
export function eventSound(type: string): SoundKind | null {
  switch (type) {
    case "play": return "play";
    case "stack": return "stack";
    case "draw": return "draw";
    case "deal": return "deal";
    case "shuffle": return "shuffle";
    case "pass": return "click";
    case "uno": return "uno";
    case "catch": return "catch";
    case "flip": return "flip";
    case "reverse": return "reverse";
    case "skip": return "skip";
    case "wild": return "wild";
    case "roulette": return "roulette";
    case "swap": return "shuffle";
    case "eliminate": return "eliminate";
    case "roundOver": return "win";
    case "gameOver": return "win";
    case "challenge": return "catch";
    case "join": return "join";
    case "leave": return "click";
    case "start": return "deal";
    case "kick": return "eliminate";
    case "flex": return "click";
    case "jump": return "stack";
    case "timer": return "error";
    case "mercy": return "shuffle";
    default: return null;
  }
}
