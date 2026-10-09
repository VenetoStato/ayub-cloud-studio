// AYUB XSYNTH — AudioWorklet (thread audio). Due motori nello stesso processore:
//   mode 'wave': wavetable stile Serum (2 osc con morph continuo, warp, unison 16, sub, noise, filtri SVF/ladder/comb,
//                3 inviluppi, 2 LFO, matrice di modulazione 8 slot, mono/legato/glide)
//   mode 'gran': granulare (sorgente audio, posizione/size/densità/spray/pitch/reverse/scan) + stessa catena filtro/amp/mod
// Nessun import: il file è autonomo. Nessuna allocazione dentro process().

const TS = 2048; const TMASK = TS - 1; const FR = 16
const MIPS = [512, 256, 128, 64, 32, 16, 8, 4, 2, 1]
const MAXV = 16; const MAXU = 16; const MAXG = 48; const BLOCK = 128
const mtof = (p) => 440 * Math.pow(2, (p - 69) / 12)
const clamp = (x, a, b) => x < a ? a : x > b ? b : x
const ftanh = (x) => { if (x > 3) return 1; if (x < -3) return -1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2) }

const SOURCES = ['off', 'lfo1', 'lfo2', 'env2', 'env3', 'vel', 'note', 'mod', 'mac1', 'mac2', 'mac3', 'mac4', 'rand', 'bend']
const DESTS = ['off', 'posA', 'posB', 'warpA', 'warpB', 'pitchA', 'pitchB', 'lvlA', 'lvlB', 'cut', 'res', 'drive', 'det', 'pan', 'amp', 'sub', 'noise', 'gpos', 'gsize', 'gdens', 'gspray', 'gpitch', 'lfo1rate', 'lfo2rate', 'fine']
const D = Object.fromEntries(DESTS.map((d, i) => [d, i]))
const SYNC_DIV = [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16] // beat per ciclo
const WARP = { off: 0, sync: 1, bend: 2, pwm: 3, mirror: 4, fm: 5, quant: 6, asym: 7 }

// filtro di decimazione per l'oversampling 2x: passa-basso FIR 47 tap (Blackman), taglio 20.5 kHz a 96 kHz
const DN = 47
const HB = (() => {
  const M = (DN - 1) / 2; const fc = 20500 / 96000; const h = new Float32Array(DN); let s = 0
  for (let k = 0; k < DN; k++) {
    const x = k - M; const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x)
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * k / (DN - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (DN - 1))
    h[k] = sinc * w; s += h[k]
  }
  for (let k = 0; k < DN; k++) h[k] /= s
  return h
})()
// x: nn campioni a 2x -> out: nn/2 campioni; hist: ultimi DN-1 campioni del blocco precedente
function decimate (x, nn, out, hist) {
  const H1 = DN - 1
  for (let i = 0, m = nn >> 1; i < m; i++) {
    const c = 2 * i + 1; let acc = 0
    for (let k = 0; k < DN; k++) { const idx = c - k; acc += HB[k] * (idx >= 0 ? x[idx] : hist[H1 + idx]) }
    out[i] = acc
  }
  for (let k = 0; k < H1; k++) hist[k] = x[nn - H1 + k]
}

function makeVoice () {
  return {
    on: false, gate: false, note: 60, vel: 0.8, age: 0, rnd: 0,
    pitch: 60, target: 60, glide: 0,
    phA: new Float64Array(MAXU), phB: new Float64Array(MAXU), phSub: 0, nz: 0,
    env: [{ s: 0, v: 0 }, { s: 0, v: 0 }, { s: 0, v: 0 }],
    lfoPh: [0, 0], lfoV: [0, 0], lfoSH: [0, 0],
    // filtro stereo: 2 stadi SVF per canale, ladder 4 poli per canale, comb
    s1: new Float64Array(8), lad: new Float64Array(8), cutSm: 1000,
    comb: [new Float32Array(4096), new Float32Array(4096)], cw: 0,
    // granulare
    grains: Array.from({ length: MAXG }, () => ({ on: false, pos: 0, inc: 0, len: 1, age: 0, gl: 0, gr: 0 })),
    gNext: 0, scan: 0,
    mod: new Float32Array(DESTS.length),
    drift: 0, uRnd: new Float32Array(MAXU), dc: new Float64Array(4), hb: [new Float32Array(DN - 1), new Float32Array(DN - 1)]
  }
}

class XSynth extends AudioWorkletProcessor {
  constructor (opts) {
    super()
    this.mode = opts.processorOptions?.mode || 'wave'
    this.p = {}
    this.tables = new Map() // id -> mips
    this.src = null; this.srcId = null; this.srcs = new Map()
    this.voices = Array.from({ length: MAXV }, makeVoice)
    this.queue = []
    this.cc = { mod: 0, bend: 0 }
    this.bpm = 120
    this.glob = [0, 0] // fasi LFO globali
    this.bufA = [new Float32Array(BLOCK * 2), new Float32Array(BLOCK * 2)]
    this.bufB = [new Float32Array(BLOCK * 2), new Float32Array(BLOCK * 2)]
    this.fmBuf = new Float32Array(BLOCK * 2)
    this.os = [new Float32Array(BLOCK * 2), new Float32Array(BLOCK * 2)]
    this.mix = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
    this.uGain = new Float32Array(MAXU * 2); this.uRatio = new Float32Array(MAXU)
    this.asked = new Set(); this.lastVoice = null; this.reportT = 0; this.counter = 0
    this.port.onmessage = (e) => this.msg(e.data)
  }

  msg (m) {
    switch (m.t) {
      case 'params': Object.assign(this.p, m.p); this.pickSrc(); this.checkAssets(); break
      case 'on': case 'off': this.queue.push(m); break
      case 'cc': if (m.cc === 1) this.cc.mod = m.v; break
      case 'bend': this.cc.bend = m.v; break
      case 'tempo': this.bpm = m.bpm; break
      case 'alloff': for (const v of this.voices) { v.on = false; v.gate = false } this.queue = []; break
      case 'table': this.tables.set(m.id, m.mips); this.asked.delete(m.id); break
      case 'src': this.srcs.set(m.id, { data: m.data, sr: m.sr }); this.asked.delete(m.id); this.pickSrc(); break
    }
  }
  pickSrc () { const s = this.srcs.get(this.p.gSrc); this.src = s || null; this.srcId = s ? this.p.gSrc : null }
  checkAssets () {
    if (this.mode === 'wave') {
      for (const k of ['o1Table', 'o2Table']) { const id = this.p[k]; if (id && !this.tables.has(id) && !this.asked.has(id)) { this.asked.add(id); this.port.postMessage({ t: 'need', kind: 'table', id }) } }
    } else {
      const id = this.p.gSrc
      if (id && !this.srcs.has(id) && !this.asked.has(id)) { this.asked.add(id); this.port.postMessage({ t: 'need', kind: 'src', id }) }
    }
  }

  // ---------------------------------------------------------------- voci
  noteOn (note, vel) {
    const p = this.p; const mono = p.voiceMode === 'mono' || p.voiceMode === 'legato'
    let v = null
    if (mono) {
      v = this.voices[0]
      const legato = p.voiceMode === 'legato' && v.on && v.gate
      v.target = note; v.note = note; v.vel = vel
      if (!v.on || p.glide <= 0) v.pitch = note
      v.gate = true
      if (legato) return
      this.trig(v, !v.on)
      return
    }
    const max = clamp(Math.round(p.poly || 8), 1, MAXV)
    for (let i = 0; i < max; i++) if (!this.voices[i].on) { v = this.voices[i]; break }
    if (!v) { // ruba: prima le rilasciate più vecchie, poi le più vecchie
      let best = -1; let bi = 0
      for (let i = 0; i < max; i++) { const c = this.voices[i]; const score = c.age + (c.gate ? 0 : 1e9); if (score > best) { best = score; bi = i } }
      v = this.voices[bi]
    }
    const fresh = !v.on
    v.note = note; v.target = note; v.pitch = note; v.vel = vel; v.gate = true
    this.trig(v, fresh)
  }
  trig (v, fresh) {
    const p = this.p
    v.on = true; v.age = 0; v.rnd = Math.random() * 2 - 1
    if (fresh) { v.drift = (Math.random() * 2 - 1) * 0.5; v.dc.fill(0); v.hb[0].fill(0); v.hb[1].fill(0) }
    for (let u = 0; u < MAXU; u++) v.uRnd[u] = (Math.random() * 2 - 1) * 0.18
    for (const e of v.env) { e.s = 1; if (fresh) e.v = 0 }
    if (fresh || p.retrigPhase) {
      for (let u = 0; u < MAXU; u++) { v.phA[u] = p.rndPhase ? Math.random() : (u * 0.618) % 1; v.phB[u] = p.rndPhase ? Math.random() : (u * 0.382) % 1 }
      v.s1.fill(0); v.lad.fill(0); v.comb[0].fill(0); v.comb[1].fill(0)
    }
    for (let l = 0; l < 2; l++) if (p['lfo' + (l + 1) + 'Retrig']) v.lfoPh[l] = 0
    v.gNext = 0; v.scan = 0
    for (const g of v.grains) if (fresh) g.on = false
    v.cutSm = p.fCut
  }
  noteOff (note) {
    for (const v of this.voices) if (v.on && v.gate && v.note === note) {
      if ((this.p.voiceMode === 'mono' || this.p.voiceMode === 'legato')) { v.gate = false; for (const e of v.env) e.s = 4 } else { v.gate = false; for (const e of v.env) e.s = 4 }
    }
  }

  // inviluppo ADSR, passo dt; stadi: 0 off, 1 attack, 2 decay, 3 sustain, 4 release
  envStep (e, a, d, s, r, dt) {
    switch (e.s) {
      case 1: e.v += dt / Math.max(0.0005, a); if (e.v >= 1) { e.v = 1; e.s = 2 } break
      case 2: e.v = s + (e.v - s) * Math.exp(-dt * 4.6 / Math.max(0.001, d)); if (Math.abs(e.v - s) < 1e-4) { e.v = s; e.s = 3 } break
      case 3: e.v = s; break
      case 4: e.v *= Math.exp(-dt * 4.6 / Math.max(0.001, r)); if (e.v < 1e-4) { e.v = 0; e.s = 0 } break
    }
    return e.v
  }
  lfoVal (v, l, ph) {
    const shape = this.p['lfo' + (l + 1) + 'Shape'] || 'sine'
    switch (shape) {
      case 'triangle': return 1 - 4 * Math.abs(ph - 0.5)
      case 'sawtooth': return 2 * ph - 1
      case 'ramp': return 1 - 2 * ph
      case 'square': return ph < 0.5 ? 1 : -1
      case 'sh': return v.lfoSH[l]
      default: return Math.sin(2 * Math.PI * ph)
    }
  }

  // ---------------------------------------------------------------- render
  process (inputs, outputs) {
    const out = outputs[0]; const L = out[0]; const R = out[1] || out[0]
    const n = L.length
    const now = currentTime; const sr = sampleRate; const end = now + n / sr
    // eventi: per semplicità a granularità di blocco (128 campioni = 2.7 ms), in ordine temporale
    if (this.queue.length) {
      this.queue.sort((a, b) => a.time - b.time)
      while (this.queue.length && this.queue[0].time < end) {
        const ev = this.queue.shift()
        if (ev.t === 'on') this.noteOn(ev.p, ev.v); else this.noteOff(ev.p)
      }
    }
    L.fill(0); if (R !== L) R.fill(0)
    const p = this.p
    if (!p.gain && p.gain !== 0) return true
    const dt = n / sr
    // LFO globali
    for (let l = 0; l < 2; l++) this.glob[l] = (this.glob[l] + this.lfoRate(l, 0) * dt) % 1
    let any = false
    for (const v of this.voices) {
      if (!v.on) continue
      any = true; this.lastVoice = v
      this.renderVoice(v, n, dt, sr)
      const mL = this.mix[0]; const mR = this.mix[1]
      for (let i = 0; i < n; i++) { L[i] += mL[i]; R[i] += mR[i] }
      v.age += n
    }
    if (any) for (let i = 0; i < n; i++) { L[i] = ftanh(L[i]); if (R !== L) R[i] = ftanh(R[i]) }
    // telemetria per l'interfaccia (~30 Hz): modulazioni e granuli dell'ultima voce
    this.counter += n
    if (this.counter > sr / 30) {
      this.counter = 0
      const v = this.lastVoice
      if (v && v.on) {
        const gr = []
        if (this.mode === 'gran' && this.src) for (const g of v.grains) if (g.on) gr.push(g.pos / this.src.data.length)
        this.port.postMessage({ t: 'tele', mod: Array.from(v.mod), posA: v.posA, posB: v.posB, gpos: v.gposEff, gr, env: v.env[0].v })
      } else if (this.lastVoice) { this.port.postMessage({ t: 'tele', idle: true }); this.lastVoice = null }
    }
    return true
  }

  lfoRate (l, modAmt) {
    const p = this.p; const k = 'lfo' + (l + 1)
    let r = p[k + 'Sync'] ? (this.bpm / 60) / SYNC_DIV[clamp(Math.round(p[k + 'Div'] ?? 4), 0, SYNC_DIV.length - 1)] : (p[k + 'Rate'] ?? 1)
    if (modAmt) r *= Math.pow(2, modAmt * 4)
    return r
  }

  renderVoice (v, n, dt, sr) {
    const p = this.p
    // ---- inviluppi (blocco)
    const env1Start = v.env[0].v
    const env1 = this.envStep(v.env[0], p.aA, p.aD, p.aS, p.aR, dt)
    const env2 = this.envStep(v.env[1], p.fA ?? 0.005, p.fD ?? 0.35, p.fS ?? 0.4, p.fR ?? 0.4, dt)
    const env3 = this.envStep(v.env[2], p.e3A ?? 0.01, p.e3D ?? 0.5, p.e3S ?? 0, p.e3R ?? 0.5, dt)
    if (v.env[0].s === 0 && !v.gate) { v.on = false; this.mix[0].fill(0); this.mix[1].fill(0); return }
    // ---- glide
    if (p.glide > 0 && v.pitch !== v.target) { const k = Math.exp(-dt * 4.6 / p.glide); v.pitch = v.target + (v.pitch - v.target) * k; if (Math.abs(v.pitch - v.target) < 0.001) v.pitch = v.target } else v.pitch = v.target
    // ---- sorgenti di modulazione
    const mod = v.mod; mod.fill(0)
    const srcv = this._srcv || (this._srcv = new Float32Array(SOURCES.length))
    for (let l = 0; l < 2; l++) {
      const k = 'lfo' + (l + 1)
      let ph
      if (p[k + 'Retrig']) { v.lfoPh[l] = (v.lfoPh[l] + this.lfoRate(l, mod[D[k + 'rate']]) * dt); if (v.lfoPh[l] >= 1) { v.lfoPh[l] %= 1; v.lfoSH[l] = Math.random() * 2 - 1 } ph = v.lfoPh[l] } else { ph = this.glob[l]; if (ph < v.lfoPh[l]) v.lfoSH[l] = Math.random() * 2 - 1; v.lfoPh[l] = ph }
      srcv[1 + l] = this.lfoVal(v, l, ph)
    }
    srcv[3] = env2; srcv[4] = env3; srcv[5] = v.vel; srcv[6] = (v.note - 60) / 24; srcv[7] = this.cc.mod
    srcv[8] = p.mac1 || 0; srcv[9] = p.mac2 || 0; srcv[10] = p.mac3 || 0; srcv[11] = p.mac4 || 0; srcv[12] = v.rnd; srcv[13] = this.cc.bend
    for (let s = 0; s < 8; s++) {
      const si = SOURCES.indexOf(p['m' + s + 'Src']); const di = D[p['m' + s + 'Dst']]
      if (si > 0 && di > 0) mod[di] += srcv[si] * (p['m' + s + 'Amt'] || 0)
    }
    // LFO1 "rapido" (compatibilità + uso comune)
    const lfo1 = srcv[1]
    const ld = p.lfoDepth || 0; const lt = p.lfoTarget
    const fVel = p.fVel ?? 0.4
    let cutCents = (p.fEnv || 0) * env2 * (1 - fVel + fVel * v.vel)
    let pitchCents = (this.cc.bend * (p.bendRange ?? 2)) * 100
    let ampMod = 0
    if (ld) {
      if (lt === 'cutoff') cutCents += lfo1 * ld
      else if (lt === 'pitch') pitchCents += lfo1 * ld / 40
      else if (lt === 'amp') ampMod -= (lfo1 * 0.5 + 0.5) * ld / 4800
      else if (lt === 'posA') mod[D.posA] += lfo1 * ld / 4800
      else if (lt === 'posB') mod[D.posB] += lfo1 * ld / 4800
    }
    // ---- sorgente sonora
    // wave: oscillatori, warp, drive e filtro girano a 2x (oversampling) e poi si decima con un halfband
    const OS = this.mode === 'wave' && p.hq !== 0 ? 2 : 1
    const nn = n * OS; const srr = sr * OS
    let mL = OS === 2 ? this.os[0] : this.mix[0]; let mR = OS === 2 ? this.os[1] : this.mix[1]
    mL.fill(0, 0, nn); mR.fill(0, 0, nn)
    v.drift = clamp(v.drift + (Math.random() * 2 - 1) * 0.06, -1, 1)
    const basePitch = v.pitch + pitchCents / 100 + v.drift * (p.drift ?? 3) / 100
    if (this.mode === 'gran') this.renderGrains(v, n, sr, basePitch, mod, mL, mR)
    else this.renderOscs(v, nn, srr, basePitch, mod, mL, mR)
    // ---- filtro
    const fType = p.fType || 'lowpass'
    if (fType !== 'off') {
      const kt = (p.fKey || 0) * (v.note - 60) * 100
      const cutTarget = clamp((p.fCut || 6000) * Math.pow(2, (cutCents + kt) / 1200 + mod[D.cut] * 6), 20, Math.min(20000, srr * 0.45))
      const c0 = v.cutSm; const c1 = cutTarget; v.cutSm = cutTarget
      const Q = clamp((p.fRes || 0.7) * Math.pow(2, mod[D.res] * 2), 0.1, 30)
      const drive = clamp((p.drive || 0) + mod[D.drive], 0, 1)
      const dg = 1 + drive * 10; const dn = 1 / ftanh(dg) // normalizza
      if (drive > 0.001) for (let i = 0; i < nn; i++) { mL[i] = ftanh(mL[i] * dg) * dn * 0.9; mR[i] = ftanh(mR[i] * dg) * dn * 0.9 }
      this.filter(v, fType, p.fSlope === 24, c0, c1, Q, nn, srr, mL, mR)
    }
    if (OS === 2) { decimate(mL, nn, this.mix[0], v.hb[0]); decimate(mR, nn, this.mix[1], v.hb[1]); mL = this.mix[0]; mR = this.mix[1] }
    // ---- dc blocker (warp e drive producono offset)
    { const dc = v.dc; for (let i = 0; i < n; i++) { const xl = mL[i]; const yl = xl - dc[0] + 0.9993 * dc[1]; dc[0] = xl; dc[1] = yl; mL[i] = yl; const xr = mR[i]; const yr = xr - dc[2] + 0.9993 * dc[3]; dc[2] = xr; dc[3] = yr; mR[i] = yr } }
    // ---- amp
    const pan = clamp((p.pan || 0) + mod[D.pan], -1, 1)
    const pl = Math.cos((pan + 1) * Math.PI / 4) * 1.414; const pr = Math.sin((pan + 1) * Math.PI / 4) * 1.414
    const amp = clamp(p.gain * (0.25 + 0.75 * v.vel) * (1 + mod[D.amp] + ampMod), 0, 2)
    // inviluppo interpolato nel blocco (niente zipper)
    for (let i = 0; i < n; i++) {
      const e = env1Start + (env1 - env1Start) * (i / n)
      const g = e * e * amp // curva quadratica: attacchi più naturali
      mL[i] *= g * pl; mR[i] *= g * pr
    }
  }

  // --------------------------------------------- oscillatori wavetable
  renderOscs (v, n, sr, basePitch, mod, mL, mR) {
    const p = this.p
    const B = this.renderOsc(v, 'o2', v.phB, n, sr, basePitch, mod[D.posB], mod[D.warpB], mod[D.pitchB], mod[D.lvlB], mod, null, this.bufB)
    v.posB = this._lastPos
    const fm = this.fmBuf
    if (B) for (let i = 0; i < n; i++) fm[i] = (this.bufB[0][i] + this.bufB[1][i]) * 0.5
    const A = this.renderOsc(v, 'o1', v.phA, n, sr, basePitch, mod[D.posA], mod[D.warpA], mod[D.pitchA], mod[D.lvlA], mod, B ? fm : null, this.bufA)
    v.posA = this._lastPos
    if (A) for (let i = 0; i < n; i++) { mL[i] += this.bufA[0][i]; mR[i] += this.bufA[1][i] }
    if (B) for (let i = 0; i < n; i++) { mL[i] += this.bufB[0][i]; mR[i] += this.bufB[1][i] }
    // sub + noise
    const subL = clamp((p.subLvl || 0) + mod[D.sub], 0, 1)
    if (subL > 0) {
      const f = mtof(basePitch - 12 + (p.subOct || 0) * 12) / sr; const tri = p.subShape === 'triangle'
      let ph = v.phSub
      for (let i = 0; i < n; i++) { ph += f; if (ph >= 1) ph -= 1; const s = (tri ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(2 * Math.PI * ph)) * subL; mL[i] += s; mR[i] += s }
      v.phSub = ph
    }
    const nzL = clamp((p.noiseLvl || 0) + mod[D.noise], 0, 1)
    if (nzL > 0) {
      const col = p.noiseColor ?? 0.5; let z = v.nz
      for (let i = 0; i < n; i++) { z += (Math.random() * 2 - 1 - z) * (0.05 + col * 0.95); mL[i] += z * nzL * 0.6; mR[i] += (Math.random() * 2 - 1) * nzL * 0.15 + z * nzL * 0.45 }
      v.nz = z
    }
  }

  renderOsc (v, k, ph, n, sr, basePitch, posMod, warpMod, pitchMod, lvlMod, mod, fm, buf) {
    const p = this.p
    const oL = buf[0]; const oR = buf[1]; oL.fill(0); oR.fill(0)
    if (!p[k + 'On']) return false
    const lvl = clamp((p[k + 'Lvl'] ?? 0.7) + lvlMod, 0, 1.5)
    if (lvl <= 0) return false
    const mips = this.tables.get(p[k + 'Table'])
    if (!mips) return false
    const pitch = basePitch + (p[k + 'Oct'] || 0) * 12 + (p[k + 'Semi'] || 0) + ((p[k + 'Fine'] || 0) + mod[D.fine] * 100) / 100 + pitchMod * 24
    const freq = mtof(pitch)
    const nu = clamp(Math.round(p[k + 'Uni'] || 1), 1, MAXU)
    const det = clamp((p[k + 'Det'] || 0) * (1 + mod[D.det]), 0, 200) // cents (± ai voci esterne)
    const blend = p[k + 'Blend'] ?? 0.75; const width = p[k + 'Width'] ?? (p.spread ?? 0.8)
    const opan = p[k + 'Pan'] || 0
    // guadagni e rapporti per voce unison
    let norm = 0
    for (let u = 0; u < nu; u++) {
      const sp = nu === 1 ? 0 : (u / (nu - 1)) * 2 - 1
      this.uRatio[u] = Math.pow(2, (sp + (nu > 2 ? v.uRnd[u] : 0)) * det / 1200)
      const w = nu === 1 ? 1 : Math.abs(sp) < 0.34 ? 1 - blend * 0.5 : 0.5 + blend * 0.5
      const pn = clamp(sp * width + opan, -1, 1)
      this.uGain[u * 2] = w * Math.cos((pn + 1) * Math.PI / 4); this.uGain[u * 2 + 1] = w * Math.sin((pn + 1) * Math.PI / 4)
      norm += w * w
    }
    const g = lvl / Math.sqrt(norm) * 0.8
    // mip: armoniche consentite per la voce più acuta
    const wmode = WARP[p[k + 'Warp'] || 'off'] || 0; const wamt = clamp((p[k + 'WarpAmt'] || 0) + warpMod, 0, 1)
    const wf = wmode === 1 ? 1 + wamt * 7 : wmode === 2 || wmode === 7 ? 1 + wamt * 4 : wmode === 3 ? 1 + wamt * 6 : wmode === 4 ? 1 + wamt * 2 : wmode === 5 ? 1 + wamt * 3 : 1
    const maxH = (sampleRate * 0.46) / (freq * this.uRatio[nu - 1] * wf)
    let m = 0; while (m < MIPS.length - 1 && MIPS[m] > maxH) m++
    const T = mips[m]
    const pos = clamp((p[k + 'Pos'] ?? 0) + posMod, 0, 1); this._lastPos = pos
    const fpos = pos * (FR - 1); const f0 = Math.min(FR - 2, Math.floor(fpos)); const ff = fpos - f0
    const o0 = f0 * TS; const o1 = o0 + TS
    const wm = WARP[p[k + 'Warp'] || 'off'] || 0
    const wa = clamp((p[k + 'WarpAmt'] || 0) + warpMod, 0, 1)
    const inc0 = freq / sr
    for (let u = 0; u < nu; u++) {
      const inc = inc0 * this.uRatio[u]; const gl = this.uGain[u * 2] * g; const gr = this.uGain[u * 2 + 1] * g
      let x = ph[u]
      for (let i = 0; i < n; i++) {
        x += inc; if (x >= 1) x -= 1
        let q = x
        if (wm) {
          switch (wm) {
            case 1: q = (x * (1 + wa * 7)) % 1; break // sync
            case 2: { const e = Math.pow(2, (wa - 0.5) * 4); q = Math.pow(x, e); break } // bend
            case 3: { const w = 0.5 - wa * 0.48; q = x < w ? x / (2 * w) : 0.5 + (x - w) / (2 * (1 - w)); break } // pwm (squeeze)
            case 4: q = x < 0.5 ? x * (1 + wa) : 1 - (1 - x) * (1 + wa); q = q - Math.floor(q); break // mirror-ish
            case 5: if (fm) { q = x + fm[i] * wa * 1.5; q -= Math.floor(q) } break // FM da B
            case 6: { const st = Math.pow(2, 1 + (1 - wa) * 9); q = Math.floor(x * st) / st; break } // quantize
            case 7: q = 1 - Math.pow(1 - x, 1 + wa * 6); break // asym (phase distortion)
          }
        }
        const idx = q * TS; const i0 = idx | 0; const fr = idx - i0; const i1 = (i0 + 1) & TMASK; const j0 = i0 & TMASK
        const a0 = T[o0 + j0]; const a1 = T[o0 + i1]; const b0 = T[o1 + j0]; const b1 = T[o1 + i1]
        const sa = a0 + (a1 - a0) * fr; const sb = b0 + (b1 - b0) * fr
        const s = sa + (sb - sa) * ff
        oL[i] += s * gl; oR[i] += s * gr
      }
      ph[u] = x
    }
    return true
  }

  // --------------------------------------------- granulare
  renderGrains (v, n, sr, basePitch, mod, mL, mR) {
    const p = this.p; const src = this.src
    if (!src) return
    const data = src.data; const len = data.length
    const dens = clamp((p.gDens ?? 20) * Math.pow(2, mod[D.gdens] * 3), 0.5, 200)
    const sizeS = clamp((p.gSize ?? 120) * Math.pow(2, mod[D.gsize] * 3), 5, 2000) / 1000
    const spray = clamp((p.gSpray ?? 0.05) + mod[D.gspray], 0, 1)
    const width = p.gWidth ?? 0.7; const revP = p.gRev ?? 0; const det = p.gDetune ?? 0
    const pitchSemi = (p.gKey === 0 ? 60 : basePitch) - 60 + (p.gPitch || 0) + mod[D.gpitch] * 24
    // scan: la posizione avanza nel tempo (giri al secondo sulla lunghezza del file)
    if (!p.gFreeze) v.scan += (p.gScan || 0) * 0.1 * n / sr
    let pos = (p.gPos ?? 0.3) + mod[D.gpos] + v.scan; pos -= Math.floor(pos)
    v.gposEff = pos
    const winShape = p.gWin ?? 0.5 // 0 = rettangolare morbida, 1 = gaussiana stretta
    for (let i = 0; i < n; i++) {
      if (--v.gNext <= 0) {
        v.gNext = (sr / dens) * (0.75 + Math.random() * 0.5)
        {
          let g = null; for (const c of v.grains) if (!c.on) { g = c; break }
          if (g) {
            const st = (pos + (Math.random() - 0.5) * spray * 0.5)
            const ratio = Math.pow(2, (pitchSemi + (Math.random() * 2 - 1) * det / 100) / 12) * (src.sr / sr)
            const rev = Math.random() < revP
            g.on = true; g.len = Math.max(16, Math.floor(sizeS * sr)); g.age = 0
            g.inc = rev ? -ratio : ratio
            g.pos = ((st - Math.floor(st)) * len)
            const pn = (Math.random() * 2 - 1) * width
            g.gl = Math.cos((pn + 1) * Math.PI / 4); g.gr = Math.sin((pn + 1) * Math.PI / 4)
          }
        }
      }
    }
    // somma granuli
    const amp = 0.6 / Math.sqrt(Math.max(1, dens * sizeS))
    for (const g of v.grains) {
      if (!g.on) continue
      for (let i = 0; i < n; i++) {
        if (g.age >= g.len) { g.on = false; break }
        let x = g.pos; x = x - Math.floor(x / len) * len
        const i0 = x | 0; const fr = x - i0; const s = data[i0] + ((data[(i0 + 1) % len]) - data[i0]) * fr
        const t = g.age / g.len
        // finestra tukey -> hann al variare di winShape
        const edge = 0.05 + winShape * 0.45
        const w = t < edge ? 0.5 - 0.5 * Math.cos(Math.PI * t / edge) : t > 1 - edge ? 0.5 - 0.5 * Math.cos(Math.PI * (1 - t) / edge) : 1
        const y = s * w * amp
        mL[i] += y * g.gl; mR[i] += y * g.gr
        g.pos += g.inc; g.age++
      }
    }
  }

  // --------------------------------------------- filtri
  filter (v, type, slope24, c0, c1, Q, n, sr, mL, mR) {
    const st = v.s1
    if (type === 'ladder') {
      const r = clamp((Q - 0.5) / 8, 0, 1.08) * 4
      const lad = v.lad
      for (let i = 0; i < n; i++) {
        const fc = c0 + (c1 - c0) * (i / n)
        const g = 1 - Math.exp(-2 * Math.PI * fc / sr)
        for (let c = 0; c < 2; c++) {
          const o = c * 4; const inp = c ? mR[i] : mL[i]
          const x = ftanh(inp - r * lad[o + 3])
          lad[o] += g * (x - lad[o]); lad[o + 1] += g * (lad[o] - lad[o + 1]); lad[o + 2] += g * (lad[o + 1] - lad[o + 2]); lad[o + 3] += g * (lad[o + 2] - lad[o + 3])
          const y = lad[o + 3] * (1 + r * 0.5)
          if (c) mR[i] = y; else mL[i] = y
        }
      }
      return
    }
    if (type === 'comb') {
      const fb = clamp((Q - 0.1) / 20, 0, 0.97)
      for (let c = 0; c < 2; c++) {
        const buf = v.comb[c]; const sig = c ? mR : mL; let w = v.cw
        for (let i = 0; i < n; i++) {
          const fc = c0 + (c1 - c0) * (i / n)
          const d = clamp(sr / fc, 2, 4000)
          let rp = w - d; if (rp < 0) rp += 4096
          const r0 = rp | 0; const fr = rp - r0; const y = buf[r0] + (buf[(r0 + 1) & 4095] - buf[r0]) * fr
          const out = sig[i] + y * fb
          buf[w] = ftanh(out); w = (w + 1) & 4095
          sig[i] = out * (1 - fb * 0.5)
        }
        if (c === 1) v.cw = w
      }
      return
    }
    // SVF (Cytomic/Simper) — lowpass/highpass/bandpass/notch, 12 o 24 dB
    const k = 1 / Q; const stages = slope24 ? 2 : 1
    const mode = type === 'highpass' ? 1 : type === 'bandpass' ? 2 : type === 'notch' ? 3 : 0
    for (let i = 0; i < n; i++) {
      const fc = c0 + (c1 - c0) * (i / n)
      const g = Math.tan(Math.PI * fc / sr)
      const kk = stages === 2 ? Math.max(k, 0.2) * 1.2 : k
      const a1 = 1 / (1 + g * (g + kk)); const a2 = g * a1; const a3 = g * a2
      for (let c = 0; c < 2; c++) {
        let x = c ? mR[i] : mL[i]
        for (let s = 0; s < stages; s++) {
          const o = c * 4 + s * 2
          const v3 = x - st[o + 1]; const v1 = a1 * st[o] + a2 * v3; const v2 = st[o + 1] + a2 * st[o] + a3 * v3
          st[o] = 2 * v1 - st[o]; st[o + 1] = 2 * v2 - st[o + 1]
          x = mode === 0 ? v2 : mode === 1 ? x - kk * v1 - v2 : mode === 2 ? v1 * kk : x - kk * v1
        }
        if (c) mR[i] = x; else mL[i] = x
      }
    }
  }
}

registerProcessor('ayub-xsynth', XSynth)
