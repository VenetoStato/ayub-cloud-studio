// Lato main-thread di XSYNTH: nodo AudioWorklet, gestione asset (wavetable via Worker, sorgenti granulari), preset.
import workletUrl from './synth.worklet.js?url'
import { S } from '../state.js'

export const WT_NAMES = ['basic', 'pwm', 'sync', 'fm', 'fold', 'vocal', 'digital', 'hyper', 'organ', 'metal', 'growl', 'chip']
export const MOD_SOURCES = ['off', 'lfo1', 'lfo2', 'env2', 'env3', 'vel', 'note', 'mod', 'mac1', 'mac2', 'mac3', 'mac4', 'rand', 'bend']
export const MOD_DESTS = ['off', 'posA', 'posB', 'warpA', 'warpB', 'pitchA', 'pitchB', 'lvlA', 'lvlB', 'cut', 'res', 'drive', 'det', 'pan', 'amp', 'sub', 'noise', 'gpos', 'gsize', 'gdens', 'gspray', 'gpitch', 'lfo1rate', 'lfo2rate', 'fine']
export const WARPS = ['off', 'sync', 'bend', 'pwm', 'mirror', 'fm', 'quant', 'asym']
export const FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch', 'ladder', 'comb', 'off']
export const SYNC_DIVS = ['1/16', '1/8T', '1/8', '3/16', '1/4', '3/8', '1/2', '1 BAR', '2 BAR', '4 BAR']
export const GRAIN_BUILTINS = { 'builtin:coro': 'CORO', 'builtin:vetro': 'VETRO', 'builtin:pad': 'PAD SAW', 'builtin:vento': 'VENTO', 'builtin:piano': 'PIANO C4' }

const COMMON = {
  fType: 'lowpass', fSlope: 24, fCut: 6000, fRes: 1, fEnv: 1800, fVel: 0.4, fKey: 0, drive: 0,
  aA: 0.004, aD: 0.3, aS: 0.85, aR: 0.25, fA: 0.005, fD: 0.35, fS: 0.4, fR: 0.4, e3A: 0.01, e3D: 0.5, e3S: 0, e3R: 0.5,
  lfo1Rate: 3, lfo1Shape: 'sine', lfo1Sync: 0, lfo1Div: 4, lfo1Retrig: 0, lfoTarget: 'cutoff', lfoDepth: 0,
  lfo2Rate: 0.5, lfo2Shape: 'triangle', lfo2Sync: 0, lfo2Div: 7, lfo2Retrig: 0,
  mac1: 0, mac2: 0, mac3: 0, mac4: 0,
  voiceMode: 'poly', poly: 8, glide: 0, bendRange: 2, pan: 0, gain: 0.5,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].flatMap(i => [['m' + i + 'Src', 'off'], ['m' + i + 'Dst', 'off'], ['m' + i + 'Amt', 0]])),
  // la rotella di modulazione della tastiera apre il filtro (slot 8, modificabile in MATRICE)
  m7Src: 'mod', m7Dst: 'cut', m7Amt: 0.35,
  hq: 1, drift: 3
}
export const WAVE_DEFAULTS = {
  ...COMMON,
  o1On: 1, o1Table: 'basic', o1Pos: 0.66, o1Oct: 0, o1Semi: 0, o1Fine: 0, o1Uni: 3, o1Det: 18, o1Blend: 0.75, o1Width: 0.8, o1Pan: 0, o1Lvl: 0.8, o1Warp: 'off', o1WarpAmt: 0,
  o2On: 0, o2Table: 'basic', o2Pos: 1, o2Oct: 0, o2Semi: 0, o2Fine: 7, o2Uni: 1, o2Det: 10, o2Blend: 0.75, o2Width: 0.8, o2Pan: 0, o2Lvl: 0.5, o2Warp: 'off', o2WarpAmt: 0,
  subLvl: 0, subOct: 0, subShape: 'sine', noiseLvl: 0, noiseColor: 0.5, rndPhase: 1, retrigPhase: 0
}
export const GRAN_DEFAULTS = {
  ...COMMON, fCut: 14000, fEnv: 0, fSlope: 12, aA: 0.25, aD: 0.5, aS: 0.9, aR: 1.5,
  gSrc: 'builtin:coro', gPos: 0.3, gSize: 120, gDens: 20, gSpray: 0.1, gPitch: 0, gDetune: 10, gWidth: 0.7, gRev: 0, gWin: 0.5, gScan: 0, gFreeze: 0, gKey: 1
}
const M = (i, s, d, a) => ({ ['m' + i + 'Src']: s, ['m' + i + 'Dst']: d, ['m' + i + 'Amt']: a })

export const WAVE_PRESETS = {
  'SERUM SUPERSAW': { o1Uni: 16, o1Det: 38, o1Blend: 0.8, o1Width: 1, o2On: 1, o2Oct: 1, o2Pos: 0.66, o2Uni: 9, o2Det: 25, o2Lvl: 0.35, subLvl: 0.2, fSlope: 12, fCut: 9000, fRes: 0.7, fEnv: 1200, fD: 0.4, fS: 0.6, aA: 0.01, aD: 0.5, aS: 0.85, aR: 0.45 },
  'WOBBLE BASS': { o1Table: 'growl', o1Pos: 0.3, o1Oct: -1, o1Uni: 2, o1Det: 8, o1Warp: 'fm', o1WarpAmt: 0.2, o2On: 1, o2Pos: 0.66, o2Oct: -1, o2Fine: 0, o2Lvl: 0.5, subLvl: 0.6, fType: 'ladder', fCut: 300, fRes: 5, fEnv: 0, drive: 0.5, lfo1Sync: 1, lfo1Div: 2, ...M(0, 'lfo1', 'cut', 0.5), ...M(1, 'lfo1', 'posA', 0.4), voiceMode: 'mono', glide: 0.03, aS: 1, aR: 0.1, gain: 0.55 },
  'NEURO REESE': { o1Table: 'digital', o1Pos: 0.5, o1Oct: -1, o1Uni: 4, o1Det: 22, o1Warp: 'sync', o1WarpAmt: 0.3, o2On: 1, o2Table: 'hyper', o2Pos: 0.7, o2Oct: -1, o2Fine: 14, o2Uni: 3, o2Lvl: 0.6, subLvl: 0.5, fCut: 700, fRes: 2, fEnv: 900, drive: 0.6, e3A: 0.01, e3D: 0.6, e3S: 0.2, ...M(0, 'env3', 'warpA', 0.5), lfo2Rate: 0.3, ...M(1, 'lfo2', 'posA', 0.3), voiceMode: 'mono', glide: 0.05, aS: 1, aR: 0.12, gain: 0.5 },
  'VOX MORPH': { o1Table: 'vocal', o1Pos: 0, o1Uni: 5, o1Det: 12, fSlope: 12, fCut: 5000, fEnv: 300, lfo1Rate: 0.25, lfo1Shape: 'triangle', ...M(0, 'lfo1', 'posA', 1), lfo2Rate: 5.5, ...M(1, 'lfo2', 'fine', 0.15), aA: 0.08, aS: 0.9, aR: 0.6 },
  'PLUCK DIGI': { o1Table: 'digital', o1Pos: 0.3, o1Uni: 3, o1Det: 10, o2On: 1, o2Oct: 1, o2Pos: 0.66, o2Lvl: 0.3, fCut: 350, fRes: 3, fEnv: 5600, fD: 0.2, fS: 0, fR: 0.25, aA: 0.002, aD: 0.45, aS: 0, aR: 0.35 },
  'ACID LADDER': { o1Pos: 0.66, o1Uni: 1, fType: 'ladder', fCut: 300, fRes: 7.5, fEnv: 4800, fD: 0.18, fS: 0.1, drive: 0.4, voiceMode: 'legato', glide: 0.06, aS: 1, aR: 0.08 },
  'COMB PLUCK': { o1Pos: 0.9, o1Uni: 1, noiseLvl: 0.35, noiseColor: 0.8, fType: 'comb', fCut: 261.6, fRes: 18, fKey: 1, fEnv: 0, aA: 0.002, aD: 0.9, aS: 0, aR: 0.6 },
  'EVOLVING PAD': { o1Table: 'fm', o1Pos: 0.2, o1Uni: 7, o1Det: 15, o1Blend: 0.6, o2On: 1, o2Table: 'vocal', o2Pos: 0.5, o2Uni: 5, o2Lvl: 0.5, noiseLvl: 0.05, lfo1Rate: 0.07, ...M(0, 'lfo1', 'posA', 0.6), lfo2Rate: 0.11, ...M(1, 'lfo2', 'posB', 0.5), fSlope: 12, fCut: 2500, fEnv: 600, aA: 1.5, aD: 2, aS: 0.85, aR: 3 },
  'SYNC LEAD': { o1Table: 'sync', o1Pos: 0.3, o1Uni: 3, o1Det: 10, e3A: 0.005, e3D: 0.4, e3S: 0.1, ...M(0, 'env3', 'posA', 0.6), voiceMode: 'mono', glide: 0.04, fSlope: 12, fCut: 7000, fEnv: 1500, aS: 0.9 },
  'SUB 808': { o1Pos: 0, o1Oct: -1, o1Uni: 1, drive: 0.35, fCut: 3000, fEnv: 0, e3A: 0.001, e3D: 0.08, e3S: 0, ...M(0, 'env3', 'pitchA', 0.08), aD: 1.2, aS: 0.3, aR: 0.4, voiceMode: 'mono', gain: 0.75 },
  'HYPER KEYS': { o1Table: 'hyper', o1Pos: 0.4, o1Uni: 2, o1Det: 6, o2On: 1, o2Table: 'organ', o2Pos: 0.6, o2Oct: 1, o2Lvl: 0.3, fCut: 3500, fEnv: 2000, fD: 0.6, fS: 0.3, aD: 1.2, aS: 0.4, aR: 0.6 },
  'CHIP ARP': { o1Table: 'chip', o1Pos: 0.5, o1Uni: 1, fType: 'off', aA: 0.001, aD: 0.2, aS: 0.6, aR: 0.1 },
  'WAVEFOLD BASS': { o1Table: 'fold', o1Pos: 0.2, o1Oct: -1, o1Uni: 1, fA: 0.005, fD: 0.3, fS: 0.1, ...M(0, 'env2', 'posA', 0.7), fCut: 2000, fRes: 1.5, fEnv: 800, voiceMode: 'mono', aS: 1, aR: 0.1 },
  'METAL BELLS': { o1Table: 'metal', o1Pos: 0.5, o1Uni: 2, o1Det: 4, o2On: 1, o2Table: 'fm', o2Pos: 0.7, o2Oct: 1, o2Lvl: 0.3, fType: 'highpass', fSlope: 12, fCut: 300, fEnv: 0, aD: 2, aS: 0, aR: 2 },
  // classici analogici e generi moderni
  'JUNO PAD': { o1Table: 'pwm', o1Pos: 0.4, o1Uni: 2, o1Det: 6, subLvl: 0.3, fCut: 1800, fRes: 1.2, fEnv: 900, fA: 0.4, fD: 1.2, fS: 0.6, aA: 0.5, aD: 1, aS: 0.85, aR: 1.5, lfo1Rate: 0.6, ...M(0, 'lfo1', 'posA', 0.3), drift: 5 },
  'PROPHET BRASS': { o1Pos: 0.66, o1Uni: 2, o1Det: 7, o2On: 1, o2Pos: 0.66, o2Fine: -8, o2Lvl: 0.7, fCut: 700, fRes: 1.5, fEnv: 3800, fA: 0.06, fD: 0.5, fS: 0.35, aA: 0.04, aS: 0.85, aR: 0.4, drift: 5 },
  'OBX STAB': { o1Pos: 0.66, o1Uni: 3, o1Det: 12, o2On: 1, o2Table: 'pwm', o2Pos: 0.2, o2Oct: 1, o2Lvl: 0.5, fSlope: 12, fCut: 1200, fEnv: 4200, fD: 0.25, fS: 0.15, aD: 0.4, aS: 0.3, aR: 0.2 },
  'TRANCE LEAD': { o1Table: 'hyper', o1Pos: 0.8, o1Uni: 9, o1Det: 28, o2On: 1, o2Pos: 0.66, o2Oct: 1, o2Uni: 5, o2Det: 18, o2Lvl: 0.4, fSlope: 12, fCut: 8000, fEnv: 600, aA: 0.005, aS: 0.9, aR: 0.35, lfo2Rate: 5.5, ...M(0, 'lfo2', 'fine', 0.1) },
  'HOOVER': { o1Table: 'pwm', o1Pos: 0.8, o1Uni: 7, o1Det: 45, o1Blend: 0.9, o2On: 1, o2Pos: 0.66, o2Oct: -1, o2Lvl: 0.6, voiceMode: 'mono', glide: 0.12, e3A: 0.001, e3D: 0.25, e3S: 0, ...M(0, 'env3', 'pitchA', -0.08), fSlope: 12, fCut: 5000, fEnv: 500, aS: 0.9, aR: 0.3 },
  'FUTURE CHORD': { o1Pos: 0.66, o1Uni: 9, o1Det: 30, o2On: 1, o2Pos: 0.66, o2Oct: 1, o2Uni: 7, o2Lvl: 0.4, fSlope: 12, fCut: 6000, fEnv: 1500, fD: 0.4, fS: 0.5, lfo1Sync: 1, lfo1Div: 4, lfo1Shape: 'ramp', lfo1Retrig: 0, ...M(0, 'lfo1', 'amp', -0.6), aA: 0.01, aS: 0.9, aR: 0.4 },
  'DUBSTEP GROWL': { o1Table: 'growl', o1Pos: 0.6, o1Oct: -1, o1Uni: 2, o1Det: 6, o1Warp: 'fm', o1WarpAmt: 0.4, o2On: 1, o2Table: 'digital', o2Pos: 0.5, o2Oct: -1, o2Lvl: 0.5, subLvl: 0.5, fType: 'ladder', fCut: 600, fRes: 6, fEnv: 0, drive: 0.7, lfo1Sync: 1, lfo1Div: 2, ...M(0, 'lfo1', 'cut', 0.6), ...M(1, 'lfo1', 'posA', 0.5), ...M(2, 'lfo1', 'warpA', 0.3), voiceMode: 'mono', glide: 0.02, aS: 1, aR: 0.1, gain: 0.5 },
  'LO-FI KEYS': { o1Pos: 0.2, o1Uni: 2, o1Det: 6, o2On: 1, o2Table: 'organ', o2Pos: 0.3, o2Lvl: 0.3, fSlope: 12, fCut: 2500, fEnv: 800, fD: 0.8, fS: 0.3, aD: 1.4, aS: 0.3, aR: 0.5, drift: 9 },
  'STRINGS ENSEMBLE': { o1Pos: 0.66, o1Uni: 7, o1Det: 16, o2On: 1, o2Table: 'pwm', o2Pos: 0.3, o2Uni: 5, o2Det: 12, o2Lvl: 0.6, fSlope: 12, fCut: 3000, fEnv: 300, aA: 0.35, aD: 1, aS: 0.9, aR: 1.2, lfo2Rate: 5, ...M(0, 'lfo2', 'fine', 0.08) },
  'HOUSE PLUCK': { o1Pos: 0.66, o1Uni: 3, o1Det: 10, fCut: 300, fRes: 2, fEnv: 4800, fD: 0.15, fS: 0, fR: 0.2, aD: 0.3, aS: 0, aR: 0.25 },
  'RHODES WAVE': { o1Table: 'fm', o1Pos: 0.15, o1Uni: 1, o2On: 1, o2Pos: 0, o2Oct: 1, o2Lvl: 0.2, fSlope: 12, fCut: 4000, fEnv: 1200, fD: 0.8, fS: 0.2, aD: 2, aS: 0.3, aR: 0.6, lfoTarget: 'amp', lfoDepth: 600, lfo1Rate: 4.5 }
}
export const GRAN_PRESETS = {
  'NUVOLA CORO': { gSrc: 'builtin:coro', gPos: 0.4, gSize: 180, gDens: 30, gSpray: 0.3, gScan: 0.05, gWidth: 0.9, aA: 0.6, aR: 2, fCut: 9000 },
  'VETRO SHIMMER': { gSrc: 'builtin:vetro', gSize: 80, gDens: 45, gPitch: 12, gDetune: 8, gRev: 0.3, gSpray: 0.4, lfo1Rate: 0.1, ...M(0, 'lfo1', 'gpos', 0.2), aA: 0.3, aR: 2.5 },
  'PIANO STRETCH': { gSrc: 'builtin:piano', gPos: 0.12, gSize: 220, gDens: 22, gSpray: 0.05, gScan: 0.02, aA: 0.4, aR: 2 },
  'VENTO': { gSrc: 'builtin:vento', gKey: 0, gSize: 300, gDens: 15, gSpray: 0.8, fType: 'bandpass', fSlope: 12, fCut: 900, fRes: 1.4, gain: 0.8, lfo1Rate: 0.08, ...M(0, 'lfo1', 'cut', 0.3), aA: 1, aR: 3 },
  'GLITCH STUTTER': { gSrc: 'builtin:pad', gSize: 25, gDens: 60, gSpray: 0.02, gRev: 0.5, lfo1Sync: 1, lfo1Div: 0, lfo1Shape: 'sh', ...M(0, 'lfo1', 'gpos', 0.3), aA: 0.005, aR: 0.2 },
  'TAKE GRANULARE': { gSrc: 'take:last', gPos: 0.2, gSize: 140, gDens: 28, gSpray: 0.15, gKey: 0, aA: 0.3, aR: 1.5 }
}

// ------------------------------------------------------------ asset
let worker = null; let wid = 0; const pending = new Map()
const tables = new Map() // id -> Promise<mips>
export const tableCache = new Map() // id -> mips (risolte, per il display)
function work (msg) {
  if (!worker) {
    worker = new Worker(new URL('./wt.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); e.data.error ? p.rej(e.data.error) : p.res(e.data.mips) }
  }
  const id = ++wid
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, ...msg }, msg.data ? [msg.data.buffer] : []) })
}
let ctxRef = null
async function decodeMono (url) {
  const buf = await fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer() }).then(b => ctxRef.decodeAudioData(b))
  const d = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] += x[i] / buf.numberOfChannels }
  return { data: d, sr: buf.sampleRate }
}
export function getTable (id) {
  if (!tables.has(id)) {
    const pr = (id.startsWith('user:') ? decodeMono('/api/audio/' + id.slice(5)).then(({ data }) => work({ kind: 'audio', data })) : work({ kind: 'builtin', name: id }))
      .then(m => { tableCache.set(id, m); return m })
    pr.catch(() => tables.delete(id))
    tables.set(id, pr)
  }
  return tables.get(id)
}

const sources = new Map()
export const sourceCache = new Map()
export function getSource (id) {
  let key = id
  if (id === 'take:last') { const c = [...S.clips.values()].filter(c => c.get('kind') === 'audio' && c.get('file')).sort((a, b) => b.get('at') - a.get('at'))[0]; key = c ? 'audio:' + c.get('file') : 'builtin:coro' }
  if (!sources.has(key)) {
    let pr
    if (key === 'builtin:piano') pr = decodeMono('/samples/piano/C4.mp3')
    else if (key.startsWith('builtin:')) pr = Promise.resolve(genSource(key.slice(8), ctxRef.sampleRate))
    else if (key.startsWith('audio:')) pr = decodeMono('/api/audio/' + key.slice(6))
    else pr = Promise.resolve(genSource('coro', ctxRef.sampleRate))
    pr = pr.then(s => { sourceCache.set(key, s); sourceCache.set(id, s); return s })
    pr.catch(() => sources.delete(key))
    sources.set(key, pr)
  }
  return sources.get(key).then(s => { sourceCache.set(id, s); return s })
}

// sorgenti granulari sintetizzate (radice C4 = 261.6 Hz)
function biquadBP (x, f, q, sr) {
  const w = 2 * Math.PI * f / sr; const al = Math.sin(w) / (2 * q); const a0 = 1 + al
  const b0 = al / a0; const b2 = -al / a0; const a1 = -2 * Math.cos(w) / a0; const a2 = (1 - al) / a0
  const y = new Float32Array(x.length); let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0
  for (let i = 0; i < x.length; i++) { const o = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = o; y[i] = o }
  return y
}
function norm (d) { let m = 1e-9; for (const v of d) m = Math.max(m, Math.abs(v)); for (let i = 0; i < d.length; i++) d[i] *= 0.9 / m; return d }
function genSource (kind, sr) {
  const N = Math.floor(sr * 4); const d = new Float32Array(N); const C4 = 261.63
  if (kind === 'coro') {
    const notes = [C4 / 2, C4, C4 * 1.26, C4 * 1.498]
    const saw = new Float32Array(N)
    notes.forEach((f, k) => { let ph = Math.random(); for (let i = 0; i < N; i++) { const vib = 1 + 0.006 * Math.sin(2 * Math.PI * (5 + k * 0.3) * i / sr + k); ph += f * vib / sr; ph -= Math.floor(ph); saw[i] += (2 * ph - 1) * 0.25 } })
    const F = [[730, 8], [1090, 10], [2440, 12]]
    for (const [f, q] of F) { const y = biquadBP(saw, f, q, sr); for (let i = 0; i < N; i++) d[i] += y[i] }
    for (let i = 0; i < N; i++) d[i] *= Math.min(1, i / (sr * 0.3), (N - i) / (sr * 0.3))
  } else if (kind === 'vetro') {
    const notes = [C4, C4 * 1.5, C4 * 2, C4 * 1.26 * 2, C4 * 3]
    notes.forEach((f, k) => { const st = Math.floor(k * sr * 0.7); for (const [r, a] of [[1, 1], [2.76, 0.5], [5.4, 0.3], [8.93, 0.15]]) for (let i = st; i < N; i++) { const t = (i - st) / sr; d[i] += Math.sin(2 * Math.PI * f * r * t) * a * Math.exp(-t * (1.5 + r * 0.4)) * 0.3 } })
  } else if (kind === 'pad') {
    const notes = [C4 / 2, C4 * 0.749, C4, C4 * 1.189]
    notes.forEach((f) => { for (let u = 0; u < 5; u++) { const fr = f * Math.pow(2, (u - 2) * 0.12 / 12); let ph = Math.random(); for (let i = 0; i < N; i++) { ph += fr / sr; ph -= Math.floor(ph); d[i] += (2 * ph - 1) * 0.06 } } })
    let lp = 0; for (let i = 0; i < N; i++) { const c = 0.02 + 0.15 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.4 * i / sr)); lp += (d[i] - lp) * c; d[i] = lp }
  } else { // vento
    const n = new Float32Array(N); for (let i = 0; i < N; i++) n[i] = Math.random() * 2 - 1
    let a = 0; let b = 0; for (let i = 0; i < N; i++) { const f = 0.01 + 0.06 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.3 * i / sr)); a += (n[i] - a) * f; b += (a - b) * f; d[i] = b }
  }
  return { data: norm(d), sr }
}

// ------------------------------------------------------------ istanza
let moduleReady = null
export function loadXSynth (ctx) { ctxRef = ctx; moduleReady = moduleReady || ctx.audioWorklet.addModule(workletUrl); return moduleReady }

export class XSynth {
  constructor (ctx, out, params, mode = 'wave') {
    this.ctx = ctx; this.mode = mode
    this.p = { ...(mode === 'gran' ? GRAN_DEFAULTS : WAVE_DEFAULTS), ...params }
    // compatibilità con i progetti creati con il vecchio WAVE
    if (params.lfoRate != null && params.lfo1Rate == null) this.p.lfo1Rate = params.lfoRate
    if (params.lfoShape && !params.lfo1Shape) this.p.lfo1Shape = params.lfoShape
    if (params.spread != null && params.o1Width == null) { this.p.o1Width = params.spread; this.p.o2Width = params.spread }
    this.node = new AudioWorkletNode(ctx, 'ayub-xsynth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { mode } })
    this.node.connect(out)
    this.tele = null
    this.node.port.onmessage = (e) => this.onMsg(e.data)
    // telefoni/tablet: niente oversampling (meno CPU e batteria)
    this.lowPower = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    this.node.port.postMessage({ t: 'params', p: this.lowPower ? { ...this.p, hq: 0 } : this.p })
  }
  onMsg (m) {
    if (m.t === 'tele') { this.tele = m.idle ? null : m; this.teleT = performance.now() } else if (m.t === 'need') {
      if (m.kind === 'table') getTable(m.id).then(mips => this.node.port.postMessage({ t: 'table', id: m.id, mips })).catch(e => console.warn('wavetable', m.id, e))
      else getSource(m.id).then(s => this.node.port.postMessage({ t: 'src', id: m.id, data: s.data, sr: s.sr })).catch(e => console.warn('sorgente', m.id, e))
    }
  }
  set (params) {
    const ch = {}
    for (const k in params) if (this.p[k] !== params[k]) { ch[k] = params[k]; this.p[k] = params[k] }
    if (this.lowPower && 'hq' in ch) ch.hq = 0
    if (Object.keys(ch).length) this.node.port.postMessage({ t: 'params', p: ch })
  }
  noteOn (p, v = 0.8, t) { this.node.port.postMessage({ t: 'on', p, v, time: t ?? this.ctx.currentTime }) }
  noteOff (p, t) { this.node.port.postMessage({ t: 'off', p, time: t ?? this.ctx.currentTime }) }
  allOff () { this.node.port.postMessage({ t: 'alloff' }) }
  cc (cc, v) { this.node.port.postMessage({ t: 'cc', cc, v }) }
  bend (v) { this.node.port.postMessage({ t: 'bend', v }) }
  tempo (bpm) { this.node.port.postMessage({ t: 'tempo', bpm }) }
  dispose () { this.allOff(); this.node.disconnect(); this.node.port.onmessage = null }
}
export class WaveX extends XSynth { constructor (ctx, out, params) { super(ctx, out, params, 'wave') } }
export class GranX extends XSynth { constructor (ctx, out, params) { super(ctx, out, params, 'gran') } }
