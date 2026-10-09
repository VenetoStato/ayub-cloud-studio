// Strumenti: WAVE e GRANULAR (XSYNTH su AudioWorklet, vedi xsynth.js), FM, PIANO (Salamander), DRUMS (kit + 808 sintetico)
import { WaveX, GranX, WAVE_DEFAULTS, GRAN_DEFAULTS, WAVE_PRESETS, GRAN_PRESETS } from './xsynth.js'

const mtof = (p) => 440 * Math.pow(2, (p - 69) / 12)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

let noiseBuf = null
function noise (ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}
const curveCache = new Map()
function driveCurve (amt) {
  const k = Math.round(amt * 50)
  if (!curveCache.has(k)) {
    const c = new Float32Array(1024); const a = 1 + k * 0.6
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * a) / Math.tanh(a) }
    curveCache.set(k, c)
  }
  return curveCache.get(k)
}

function adsr (param, t, peak, a, d, s, floor = 0) {
  param.cancelScheduledValues(t)
  param.setValueAtTime(floor, t)
  param.linearRampToValueAtTime(peak, t + Math.max(0.002, a))
  param.setTargetAtTime(floor + (peak - floor) * s, t + Math.max(0.002, a), Math.max(0.005, d) / 3)
}
function release (param, t, r, floor = 0) {
  // cancelAndHoldAtTime mantiene il valore corrente: niente click
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else { param.cancelScheduledValues(t) }
  param.setTargetAtTime(floor, t, Math.max(0.005, r) / 4)
}

// ---------------------------------------------------------------- base polifonica
class Poly {
  constructor (ctx, out, params, defaults) {
    this.ctx = ctx; this.out = out
    this.p = { ...defaults, ...params }
    this.voices = [] // {pitch, end, nodes, stop(t)}
    this.max = 24
  }
  set (params) { Object.assign(this.p, params); this.live?.() }
  noteOn (pitch, vel = 0.8, t = this.ctx.currentTime) {
    // stessa nota già attiva -> chiudila
    for (const v of this.voices) if (v.pitch === pitch && !v.released) this._rel(v, t)
    if (this.voices.length >= this.max) { const v = this.voices.shift(); v.kill(t) }
    const v = this.voice(pitch, vel, t); v.pitch = pitch
    this.voices.push(v)
  }
  noteOff (pitch, t = this.ctx.currentTime) {
    for (const v of this.voices) if (v.pitch === pitch && !v.released) this._rel(v, t)
  }
  _rel (v, t) {
    v.released = true
    const end = v.release(t)
    setTimeout(() => { v.kill(this.ctx.currentTime); this.voices = this.voices.filter(x => x !== v) }, Math.max(0, (end - this.ctx.currentTime) * 1000 + 50))
  }
  allOff () { const t = this.ctx.currentTime; for (const v of this.voices) v.kill(t); this.voices = [] }
  dispose () { this.allOff() }
}

// ---------------------------------------------------------------- FM (2 operatori + feedback-ish)
export const FM_DEFAULTS = {
  ratio: 1, index: 2.5, idxDecay: 0.8, idxSus: 0.15, ratio2: 14, index2: 0.4, idx2Decay: 0.15,
  tone: 9000, aA: 0.002, aD: 1.4, aS: 0.25, aR: 0.6, detune: 4, gain: 0.45
}
export class FMSynth extends Poly {
  constructor (ctx, out, params) { super(ctx, out, params, FM_DEFAULTS) }
  voice (pitch, vel, t) {
    const ctx = this.ctx; const p = this.p; const f = mtof(pitch)
    const car = ctx.createOscillator(); const car2 = ctx.createOscillator()
    const mod = ctx.createOscillator(); const mod2 = ctx.createOscillator()
    const mg = ctx.createGain(); const mg2 = ctx.createGain()
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.tone; lp.Q.value = 0.5
    const amp = ctx.createGain(); amp.gain.value = 0
    car.frequency.value = f; car2.frequency.value = f; car2.detune.value = p.detune
    mod.frequency.value = f * p.ratio; mod2.frequency.value = f * p.ratio2
    mod.connect(mg); mod2.connect(mg2)
    for (const c of [car, car2]) { mg.connect(c.frequency); mg2.connect(c.frequency); c.connect(lp) }
    lp.connect(amp); amp.connect(this.out)
    const iv = f * p.index * (0.5 + vel); const iv2 = f * p.index2 * (0.3 + vel)
    adsr(mg.gain, t, iv, 0.001, p.idxDecay, p.idxSus)
    adsr(mg2.gain, t, iv2, 0.001, p.idx2Decay, 0)
    adsr(amp.gain, t, p.gain * (0.3 + 0.7 * vel) * 0.6, p.aA, p.aD, p.aS)
    const oscs = [car, car2, mod, mod2]; oscs.forEach(o => o.start(t))
    const nodes = [mg, mg2, lp, amp]
    return {
      release (rt) { release(amp.gain, rt, p.aR); return rt + p.aR * 1.2 + 0.05 },
      kill (kt) {
        amp.gain.cancelScheduledValues(kt); amp.gain.setTargetAtTime(0, kt, 0.004)
        const at = Math.max(kt, ctx.currentTime) + 0.03
        oscs.forEach(o => { try { o.stop(at) } catch {} })
        setTimeout(() => [...oscs, ...nodes].forEach(n => n.disconnect()), (at - ctx.currentTime) * 1000 + 100)
      }
    }
  }
}

// ---------------------------------------------------------------- sampler generico
const bufCache = new Map()
export function loadBuffer (ctx, url) {
  if (!bufCache.has(url)) {
    bufCache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer() }).then(b => ctx.decodeAudioData(b)).catch(e => { console.warn(e); bufCache.delete(url); return null }))
  }
  return bufCache.get(url)
}

const PIANO_NOTES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8']
const NOTE_IDX = { C: 0, Ds: 3, Fs: 6, A: 9 }
const nameToMidi = (n) => { const m = n.match(/^([A-Z]s?)(\d)$/); return 12 * (+m[2] + 1) + NOTE_IDX[m[1]] }

export const PIANO_DEFAULTS = { tone: 12000, aR: 0.9, velCurve: 0.6, tune: 0, gain: 0.8 }
export class Piano extends Poly {
  constructor (ctx, out, params) {
    super(ctx, out, params, PIANO_DEFAULTS)
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 0.4; this.lp.connect(out)
    this.samples = [] // {midi, buf}
    this.ready = Promise.all(PIANO_NOTES.map(n => loadBuffer(ctx, `/samples/piano/${n}.mp3`).then(buf => buf && this.samples.push({ midi: nameToMidi(n), buf }))))
    this.live()
  }
  live () { this.lp.frequency.setTargetAtTime(this.p.tone, this.ctx.currentTime, 0.02) }
  voice (pitch, vel, t) {
    const ctx = this.ctx; const p = this.p
    let best = null
    for (const s of this.samples) if (!best || Math.abs(s.midi - pitch) < Math.abs(best.midi - pitch)) best = s
    const src = ctx.createBufferSource(); const amp = ctx.createGain()
    if (best) { src.buffer = best.buf; src.playbackRate.value = Math.pow(2, (pitch - best.midi + p.tune / 100) / 12) }
    const g = Math.pow(vel, 1 + p.velCurve) * p.gain * 1.4
    amp.gain.setValueAtTime(g, t)
    src.connect(amp); amp.connect(this.lp); src.start(t)
    return {
      release (rt) { release(amp.gain, rt, p.aR); return rt + p.aR * 1.2 + 0.05 },
      kill (kt) { amp.gain.cancelScheduledValues(kt); amp.gain.setTargetAtTime(0, kt, 0.004); try { src.stop(Math.max(kt, ctx.currentTime) + 0.03) } catch {} setTimeout(() => { src.disconnect(); amp.disconnect() }, 200) }
    }
  }
}

// ---------------------------------------------------------------- DRUMS
export const KITS = ['808 SYNTH', 'acoustic-kit', 'LINN', 'CR78', 'Techno', '4OP-FM']
export const DRUM_MAP = { 36: 'kick', 35: 'kick', 37: 'rim', 38: 'snare', 40: 'snare', 39: 'clap', 42: 'hihat', 44: 'hihat', 46: 'ohat', 41: 'tom3', 43: 'tom3', 45: 'tom2', 47: 'tom2', 48: 'tom1', 50: 'tom1', 49: 'crash', 57: 'crash', 51: 'ride', 56: 'cowbell' }
export const DRUM_LABELS = { 36: 'KICK', 37: 'RIM', 38: 'SNARE', 39: 'CLAP', 42: 'HAT CL', 44: 'HAT PD', 46: 'HAT OP', 41: 'TOM L', 45: 'TOM M', 48: 'TOM H', 49: 'CRASH', 51: 'RIDE', 56: 'COWBELL' }
export const DRUM_DEFAULTS = { kit: '808 SYNTH', tune: 0, decay: 1, kickLvl: 1, snareLvl: 0.8, hatLvl: 0.6, gain: 0.8 }

export class Drums {
  constructor (ctx, out, params) {
    this.ctx = ctx; this.out = out; this.p = { ...DRUM_DEFAULTS, ...params }; this.bufs = {}; this.openHat = null
    this.loadKit()
  }
  loadKit () {
    this.bufs = {}; const kit = this.p.kit; this._kit = kit
    if (kit === '808 SYNTH') return
    for (const s of ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3']) loadBuffer(this.ctx, `/samples/kits/${kit}/${s}.mp3`).then(b => { if (this._kit === kit) this.bufs[s] = b })
  }
  set (params) { const k = this.p.kit; Object.assign(this.p, params); if (this.p.kit !== k) this.loadKit() }
  noteOff () {}
  allOff () {}
  dispose () {}
  noteOn (pitch, vel = 0.8, t = this.ctx.currentTime) {
    const name = DRUM_MAP[pitch]; if (!name) return
    const ctx = this.ctx; const p = this.p
    const lvl = (name === 'kick' ? p.kickLvl : name === 'snare' || name === 'clap' || name === 'rim' ? p.snareLvl : /hat|ride|crash/.test(name) ? p.hatLvl : 1) * p.gain * (0.2 + 0.8 * vel)
    const out = ctx.createGain(); out.gain.value = lvl; out.connect(this.out)
    setTimeout(() => out.disconnect(), (t - ctx.currentTime + 3) * 1000)
    if (name === 'hihat' && this.openHat) { const g = this.openHat; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.01); this.openHat = null }
    const sb = this.bufs[name]
    if (sb) {
      const s = ctx.createBufferSource(); s.buffer = sb; s.playbackRate.value = Math.pow(2, p.tune / 12)
      const g = ctx.createGain(); s.connect(g); g.connect(out)
      if (p.decay < 1) g.gain.setTargetAtTime(0, t + 0.02, 0.05 + p.decay * 0.3)
      s.start(t); return
    }
    SYN[name]?.(ctx, out, t, p)
    if (name === 'ohat') this.openHat = out
  }
}
// motori sintetici 808/909-like
const tuneF = (p, f) => f * Math.pow(2, p.tune / 12)
function env (ctx, t, peak, dec, a = 0.001) { const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, dec / 4); return g }
function nz (ctx, t, dur) { const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.start(t, Math.random()); s.stop(t + dur); return s }
function metal (ctx, t, dur, p) {
  const sum = ctx.createGain(); sum.gain.value = 0.25
  for (const f of [263, 400, 421, 474, 587, 845]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = tuneF(p, f * 1.9); o.connect(sum); o.start(t); o.stop(t + dur) } // rapporti della 808
  return sum
}
const SYN = {
  kick (ctx, out, t, p) {
    // corpo: sinusoide con inviluppo di pitch a due stadi (punch + coda), saturazione morbida
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(tuneF(p, 190), t); o.frequency.exponentialRampToValueAtTime(tuneF(p, 62), t + 0.035); o.frequency.exponentialRampToValueAtTime(tuneF(p, 46), t + 0.35)
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.15, t + 0.002)
    g.gain.setValueAtTime(1.15, t + 0.02); g.gain.setTargetAtTime(0, t + 0.02, 0.16 * p.decay)
    const sh = ctx.createWaveShaper(); sh.curve = driveCurve(0.25)
    o.connect(sh); sh.connect(g); g.connect(out); o.start(t); o.stop(t + 2)
    // click d'attacco
    const c = nz(ctx, t, 0.006); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500
    const cg = env(ctx, t, 0.35, 0.004); c.connect(hp); hp.connect(cg); cg.connect(out)
  },
  snare (ctx, out, t, p) {
    // due toni di corpo + rumore con filtro passa-banda: attacco secco e coda "frizzante"
    for (const [f, a, d] of [[185, 0.55, 0.07], [330, 0.3, 0.05]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(tuneF(p, f * 1.25), t); o.frequency.exponentialRampToValueAtTime(tuneF(p, f), t + 0.02)
      const g = env(ctx, t, a, d * p.decay); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.5)
    }
    const n = nz(ctx, t, 0.6); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 0.6
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200
    const ng = env(ctx, t, 0.75, 0.2 * p.decay); n.connect(bp); bp.connect(hp); hp.connect(ng); ng.connect(out)
  },
  clap (ctx, out, t, p) {
    const n = nz(ctx, t, 0.6); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = tuneF(p, 1100); bp.Q.value = 0.9
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t)
    for (const d of [0, 0.011, 0.022]) { g.gain.setValueAtTime(1, t + d); g.gain.setTargetAtTime(0.1, t + d, 0.003) }
    g.gain.setValueAtTime(0.8, t + 0.031); g.gain.setTargetAtTime(0, t + 0.031, 0.06 * p.decay)
    n.connect(bp); bp.connect(g); g.connect(out)
  },
  rim (ctx, out, t, p) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = tuneF(p, 1700); const g = env(ctx, t, 0.6, 0.02); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.1) },
  hihat (ctx, out, t, p) { hat(ctx, out, t, p, 0.05) },
  ohat (ctx, out, t, p) { hat(ctx, out, t, p, 0.45) },
  ride (ctx, out, t, p) { hat(ctx, out, t, p, 1.2, 5000, 0.5) },
  crash (ctx, out, t, p) {
    hat(ctx, out, t, p, 1.6, 5000, 0.7)
    const n = nz(ctx, t, 2); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000; const g = env(ctx, t, 0.35, 1.4 * p.decay); n.connect(hp); hp.connect(g); g.connect(out)
  },
  cowbell (ctx, out, t, p) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = tuneF(p, 800); bp.Q.value = 3
    const g = env(ctx, t, 0.8, 0.25 * p.decay)
    for (const f of [540, 800]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = tuneF(p, f); o.connect(bp); o.start(t); o.stop(t + 0.6) }
    bp.connect(g); g.connect(out)
  },
  tom1 (ctx, out, t, p) { tom(ctx, out, t, p, 220) },
  tom2 (ctx, out, t, p) { tom(ctx, out, t, p, 160) },
  tom3 (ctx, out, t, p) { tom(ctx, out, t, p, 110) }
}
function hat (ctx, out, t, p, dec, hpf = 7000, lvl = 0.6) {
  const m = metal(ctx, t, dec * 2 + 0.1, p); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpf
  const g = env(ctx, t, lvl, dec * p.decay); m.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out)
}
function tom (ctx, out, t, p, f) {
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(tuneF(p, f * 1.6), t); o.frequency.exponentialRampToValueAtTime(tuneF(p, f), t + 0.06)
  const g = env(ctx, t, 0.8, 0.4 * p.decay); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1)
}

// ---------------------------------------------------------------- registry + preset
export const INSTRUMENTS = {
  wave: { label: 'XWAVE // WAVETABLE', cls: WaveX, defaults: WAVE_DEFAULTS },
  gran: { label: 'GRANULAR // NUVOLA', cls: GranX, defaults: GRAN_DEFAULTS },
  fm: { label: 'FM-2 // OPERATORI', cls: FMSynth, defaults: FM_DEFAULTS },
  piano: { label: 'PIANO // GRAN CODA', cls: Piano, defaults: PIANO_DEFAULTS },
  drums: { label: 'DRUM RACK', cls: Drums, defaults: DRUM_DEFAULTS }
}

export const PRESETS = {
  wave: WAVE_PRESETS,
  gran: GRAN_PRESETS,
  fm: {
    'E.PIANO DX': {},
    'CAMPANA': { ratio: 3.5, index: 4, idxDecay: 2.5, idxSus: 0.1, index2: 0, aD: 3, aS: 0, aR: 2.5 },
    'FM BASS': { ratio: 1, index: 3.5, idxDecay: 0.18, idxSus: 0.1, index2: 0, aD: 0.6, aS: 0.6, aR: 0.12, tone: 3000, detune: 0, gain: 0.6 },
    'MARIMBA': { ratio: 4, index: 1.8, idxDecay: 0.08, idxSus: 0, index2: 0, aD: 0.45, aS: 0, aR: 0.3, detune: 0 },
    'GLASS PAD': { ratio: 2, index: 1.2, idxDecay: 2, idxSus: 0.6, ratio2: 7, index2: 0.3, idx2Decay: 3, aA: 0.6, aD: 2, aS: 0.8, aR: 2, detune: 9 }
  },
  piano: { 'GRAN CODA': {}, 'PIANO SCURO': { tone: 2500, aR: 1.4 }, 'PIANO PERCUSSIVO': { tone: 16000, velCurve: 0.2, aR: 0.4 } },
  drums: Object.fromEntries(KITS.map(k => [k.toUpperCase(), { kit: k }]))
}

// ---------------------------------------------------------------- catene effetti dei preset (come i preset di Serum con FX)
const FXP = {
  chorus: (wet = 0.35, depth = 0.45) => ['chorus', { frequency: 0.6, depth, delayTime: 3.5, spread: 180, wet }],
  verb: (decay = 2.5, wet = 0.22) => ['reverb', { decay, preDelay: 0.02, wet }],
  delay: (time = 2, wet = 0.18, feedback = 0.32, pingpong = 1) => ['delay', { time, feedback, pingpong, tone: 4500, wet }],
  sat: (distortion = 0.3, wet = 0.5) => ['dist', { distortion, tone: 8000, out: -3, wet }],
  comp: (threshold = -18, ratio = 3, makeup = 3) => ['comp', { threshold, ratio, attack: 0.008, release: 0.15, makeup }],
  eq: (low = 0, mid = 0, high = 0) => ['eq', { low, mid, high, lowF: 250, highF: 3500 }]
}
export const PRESET_FX = {
  wave: {
    'SERUM SUPERSAW': [FXP.chorus(0.3), FXP.delay(2, 0.16), FXP.verb(2.8, 0.22)],
    'WOBBLE BASS': [FXP.sat(0.35, 0.55), FXP.comp(-20, 4, 4), FXP.eq(2, -2, 1)],
    'NEURO REESE': [FXP.sat(0.25, 0.45), FXP.comp(-18, 4, 3)],
    'VOX MORPH': [FXP.chorus(0.3), FXP.delay(3, 0.14), FXP.verb(3.5, 0.3)],
    'PLUCK DIGI': [FXP.delay(2, 0.24, 0.35), FXP.verb(2.2, 0.2)],
    'ACID LADDER': [FXP.sat(0.3, 0.5), FXP.delay(0, 0.12, 0.25)],
    'COMB PLUCK': [FXP.delay(1, 0.15), FXP.verb(2.5, 0.25)],
    'EVOLVING PAD': [FXP.chorus(0.45, 0.6), FXP.verb(6, 0.4), FXP.eq(0, 0, -2)],
    'SYNC LEAD': [FXP.chorus(0.25), FXP.delay(2, 0.2), FXP.verb(2, 0.18)],
    'SUB 808': [FXP.sat(0.15, 0.4), FXP.comp(-16, 3, 2)],
    'HYPER KEYS': [FXP.chorus(0.3), FXP.verb(1.8, 0.2)],
    'CHIP ARP': [['crusher', { bits: 8, wet: 0.3 }], FXP.delay(0, 0.2, 0.3)],
    'WAVEFOLD BASS': [FXP.sat(0.2, 0.4), FXP.comp(-18, 4, 3)],
    'METAL BELLS': [FXP.delay(3, 0.2), FXP.verb(4, 0.35)],
    'JUNO PAD': [FXP.chorus(0.5, 0.6), FXP.verb(3, 0.25)],
    'PROPHET BRASS': [FXP.chorus(0.2), FXP.verb(2, 0.18)],
    'OBX STAB': [FXP.delay(2, 0.18), FXP.verb(1.8, 0.2)],
    'TRANCE LEAD': [FXP.delay(2, 0.22, 0.4), FXP.verb(3.5, 0.25)],
    'HOOVER': [FXP.chorus(0.4), FXP.sat(0.2, 0.4)],
    'FUTURE CHORD': [FXP.chorus(0.3), FXP.verb(2.5, 0.25)],
    'DUBSTEP GROWL': [FXP.sat(0.4, 0.5), FXP.comp(-20, 4, 4)],
    'LO-FI KEYS': [['crusher', { bits: 10, wet: 0.3 }], FXP.chorus(0.3), FXP.verb(1.5, 0.2)],
    'STRINGS ENSEMBLE': [FXP.chorus(0.5, 0.7), FXP.verb(3.5, 0.3)],
    'HOUSE PLUCK': [FXP.delay(2, 0.2), FXP.verb(1.6, 0.2)],
    'RHODES WAVE': [FXP.chorus(0.3), FXP.verb(1.8, 0.2)]
  },
  gran: {
    'NUVOLA CORO': [FXP.chorus(0.3), FXP.verb(5, 0.4)],
    'VETRO SHIMMER': [FXP.delay(3, 0.2, 0.4), FXP.verb(6, 0.45)],
    'PIANO STRETCH': [FXP.verb(4, 0.35)],
    'VENTO': [FXP.verb(6, 0.45)],
    'GLITCH STUTTER': [FXP.delay(0, 0.2, 0.3), FXP.verb(1.5, 0.15)],
    'TAKE GRANULARE': [FXP.verb(4, 0.35)]
  },
  fm: {
    'E.PIANO DX': [FXP.chorus(0.35, 0.35), FXP.verb(1.6, 0.18)],
    'CAMPANA': [FXP.verb(3.5, 0.3)],
    'FM BASS': [FXP.comp(-18, 3, 2)],
    'MARIMBA': [FXP.verb(1.4, 0.2)],
    'GLASS PAD': [FXP.chorus(0.4, 0.5), FXP.verb(5, 0.4)]
  },
  piano: { '*': [FXP.comp(-20, 2, 2), FXP.verb(2.2, 0.18)] },
  drums: { '*': [FXP.comp(-16, 3, 3), FXP.eq(2, 0, 1.5), FXP.verb(0.9, 0.08)] }
}
PRESET_FX.wave['REESE BASS'] = PRESET_FX.wave['NEURO REESE']; PRESET_FX.wave['WARM PAD'] = PRESET_FX.wave['EVOLVING PAD'] // preset del vecchio WAVE
export const presetFx = (type, preset) => (PRESET_FX[type]?.[preset] || PRESET_FX[type]?.['*'] || []).map(([t, p]) => [t, { ...p }])
