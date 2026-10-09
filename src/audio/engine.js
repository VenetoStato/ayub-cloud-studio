// Motore audio: grafo tracce, scheduler look-ahead, metronomo, registrazione audio/MIDI.
// L'audio gira sempre LOCALE nel browser di ogni operatore (latenza minima); il cloud sincronizza solo i dati.
import * as Tone from 'tone'
import { INSTRUMENTS, loadBuffer } from './instruments.js'
import { loadXSynth } from './xsynth.js'
import { makeFx } from './effects.js'
import { S, trackList, trackById, addClip, putNotes, moveClip, uid } from '../state.js'

export const E = {
  ctx: null, tracks: new Map(), master: null, masterMeter: null,
  playing: false, recording: false, metro: true, loop: { on: false, start: 0, end: 16 },
  pos: 0, // beat corrente (fermo)
  marks: [], // [{time, beat}] per il playhead
  sources: new Set(), sel: null, armed: null,
  latencyMs: +(localStorage.getItem('ayub_inlat') ?? 6), // latenza ingresso stimata (calibrabile)
  audioBufs: new Map(), peaks: new Map(), onTick: null, inputStream: null, liveNotes: new Map()
}

export async function initAudio () {
  // AudioContext nativo (non il wrapper di Tone): serve per AudioWorklet e per la latenza minima
  const raw = new AudioContext({ latencyHint: 0 }) // 0 = il minimo che il sistema concede
  // Firefox: AudioListener senza positionX/forwardX/... -> Tone.js va in errore. Non usiamo audio 3D: parametri fittizi.
  const L = raw.listener
  for (const k of ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) {
    if (!(L[k] instanceof AudioParam)) { const cs = raw.createConstantSource(); Object.defineProperty(L, k, { value: cs.offset, configurable: true }) }
  }
  const ctx = new Tone.Context({ context: raw, lookAhead: 0, updateInterval: 0.01 })
  Tone.setContext(ctx)
  E.ctx = raw
  E.master = new Tone.Channel({ volume: 0 })
  // bus master: compressore "colla" morbido (2:1, attacco lento) prima del limiter
  E.glue = new Tone.Compressor({ threshold: -14, ratio: 2, attack: 0.03, release: 0.25, knee: 8 })
  E.limiter = new Tone.Limiter(-0.3)
  E.masterMeter = new Tone.Meter({ channels: 2, smoothing: 0.7 })
  E.master.chain(E.glue, E.limiter, Tone.getDestination())
  E.limiter.connect(E.masterMeter)
  E.click = new Tone.Gain(0.5).toDestination()
  await loadXSynth(raw)
}
export async function resumeAudio () { if (E.ctx.state !== 'running') await E.ctx.resume() }

export const bpm = () => S.project?.get('bpm') || 120
export const spb = () => 60 / bpm()
export const outLatency = () => (E.ctx.outputLatency || 0) + (E.ctx.baseLatency || 0)

// ------------------------------------------------------------ sync grafo <-> Yjs
// dirty: Set di id traccia da risincronizzare, oppure null = tutte
let lastBpm = 0
export function syncGraph (dirty = null) {
  const seen = new Set()
  const b = bpm()
  if (b !== lastBpm) { lastBpm = b; Tone.getTransport().bpm.value = b; for (const tn of E.tracks.values()) tn.inst?.tempo?.(b) }
  for (const t of trackList()) {
    const id = t.get('id'); seen.add(id)
    if (dirty && !dirty.has(id) && E.tracks.has(id)) continue
    let tn = E.tracks.get(id)
    if (!tn) {
      tn = { id, input: new Tone.Gain(), channel: new Tone.Channel(), meter: new Tone.Meter({ smoothing: 0.75 }), fx: [], fxSig: '', instSig: '', inst: null }
      tn.input.connect(tn.channel); tn.channel.connect(E.master); tn.channel.connect(tn.meter)
      E.tracks.set(id, tn)
    }
    // strumento
    const inst = t.get('instrument')
    if (inst) {
      const type = inst.get('type'); const params = inst.get('params').toJSON()
      const sig = type + ':' + (inst._item ? inst._item.id.client + '.' + inst._item.id.clock : '') // nuova Y.Map = nuovo strumento
      if (sig !== tn.instSig) {
        tn.inst?.dispose(); tn.instOut?.disconnect()
        tn.instOut = E.ctx.createGain(); Tone.connect(tn.instOut, tn.input)
        const def = INSTRUMENTS[type] || INSTRUMENTS.wave
        tn.inst = new def.cls(E.ctx, tn.instOut, params); tn.instSig = sig
        tn.inst.tempo?.(b)
      } else tn.inst.set(params)
    }
    // catena effetti
    const fxArr = t.get('fx').toArray()
    const fxSig = fxArr.map(f => f.get('id') + (f.get('on') ? '1' : '0')).join(',')
    if (fxSig !== tn.fxSig) {
      tn.input.disconnect(); tn.fx.forEach(f => f.dispose()); tn.fx = []
      let prev = tn.input
      for (const f of fxArr) {
        if (!f.get('on')) continue
        const node = makeFx(f.get('type'), f.get('params').toJSON()); node.id = f.get('id')
        prev.connect(node.input); prev = node.output; tn.fx.push(node)
      }
      prev.connect(tn.channel); tn.fxSig = fxSig
    } else {
      for (const node of tn.fx) {
        const f = fxArr.find(x => x.get('id') === node.id)
        const p = f.get('params').toJSON(); const last = node.last || {}
        for (const k in p) if (p[k] !== last[k]) node.set(k, p[k])
        node.last = p
      }
    }
    tn.channel.volume.value = t.get('vol'); tn.channel.pan.value = t.get('pan')
    tn.channel.mute = !!t.get('mute'); tn.channel.solo = !!t.get('solo')
    tn.kind = t.get('kind')
  }
  for (const [id, tn] of E.tracks) {
    if (seen.has(id)) continue
    tn.inst?.dispose(); tn.fx.forEach(f => f.dispose()); tn.input.dispose(); tn.channel.dispose(); tn.meter.dispose()
    E.tracks.delete(id)
  }
}
export function syncClips () {
  for (const c of S.clips.values()) if (c.get('kind') === 'audio' && c.get('file')) getAudio(c.get('file'))
}
// applica subito un parametro al suono (prima che la modifica faccia il giro su Yjs)
export function applyLocal (local, key, value) {
  const tn = E.tracks.get(local.track); if (!tn) return
  if (local.chan) { if (key === 'vol') tn.channel.volume.value = value; else if (key === 'pan') tn.channel.pan.value = value; return }
  if (!local.fx) { tn.inst?.set({ [key]: value }); return }
  const node = tn.fx.find(f => f.id === local.fx)
  if (node) { node.set(key, value); node.last = { ...(node.last || {}), [key]: value } }
}
export function liveCC (trackId, cc, v) { E.tracks.get(trackId)?.inst?.cc?.(cc, v) }
export function liveBend (trackId, v) { E.tracks.get(trackId)?.inst?.bend?.(v) }

export function getAudio (file) {
  if (!E.audioBufs.has(file)) {
    E.audioBufs.set(file, loadBuffer(E.ctx, '/api/audio/' + file).then(b => { if (b) E.peaks.set(file, computePeaks(b)); E.onTick?.(true); return b }))
  }
  return E.audioBufs.get(file)
}
function computePeaks (buf, per = 256) {
  const d = buf.getChannelData(0); const d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d
  const n = Math.ceil(d.length / per); const out = new Float32Array(n)
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * per, e = Math.min(d.length, j + per); j < e; j++) m = Math.max(m, Math.abs(d[j]), Math.abs(d2[j])); out[i] = m }
  return { data: out, per, sr: buf.sampleRate, dur: buf.duration }
}

// ------------------------------------------------------------ live play
export function liveOn (trackId, pitch, vel) {
  const tn = E.tracks.get(trackId); if (!tn?.inst) return
  tn.inst.noteOn(pitch, vel, E.ctx.currentTime)
  E.liveNotes.set(pitch, { trackId, vel, beat: E.playing ? beatAtTime(E.ctx.currentTime - outLatency()) : null })
  if (E.recording && E.playing && E.recClip && trackId === E.recTrack) E.recPending.set(pitch, E.liveNotes.get(pitch))
}
export function liveOff (trackId, pitch) {
  const tn = E.tracks.get(trackId); tn?.inst?.noteOff(pitch, E.ctx.currentTime)
  E.liveNotes.delete(pitch)
  const p = E.recPending?.get(pitch)
  if (p && E.recClip) {
    E.recPending.delete(pitch)
    commitRecNote(pitch, p, beatAtTime(E.ctx.currentTime - outLatency()))
  }
}

// ------------------------------------------------------------ trasporto
const LOOKAHEAD = 0.1; const TICK = 15
let timer = null; let nextBeat = 0; let nextTime = 0; let segStart = true

export function beatAtTime (time) {
  let m = E.marks[0]
  for (const k of E.marks) if (k.time <= time) m = k
  if (!m) return E.pos
  return m.beat + (time - m.time) / spb()
}
export function playheadBeat () {
  if (!E.playing) return E.pos
  return beatAtTime(E.ctx.currentTime - outLatency())
}

export async function play (fromBeat = E.pos) {
  if (E.playing) return
  await resumeAudio()
  E.playing = true
  nextBeat = fromBeat; nextTime = E.ctx.currentTime + 0.03; segStart = true
  E.marks = [{ time: nextTime, beat: nextBeat }]
  timer = setInterval(tick, TICK); tick()
}
export function stop () {
  if (!E.playing) { E.pos = E.loop.on ? E.loop.start : 0; E.onTick?.(true); return }
  if (E.recording) stopRecording()
  E.pos = Math.max(0, playheadBeat())
  E.playing = false; clearInterval(timer)
  for (const tn of E.tracks.values()) tn.inst?.allOff()
  for (const s of E.sources) { try { s.stop() } catch {} } E.sources.clear()
  E.onTick?.(true)
}
export function seek (beat) {
  const was = E.playing
  if (was) { E.recording = false; stop() }
  E.pos = Math.max(0, beat)
  if (was) play(E.pos)
  E.onTick?.(true)
}

function tick () {
  const now = E.ctx.currentTime
  const sp = spb()
  while (nextTime < now + LOOKAHEAD) {
    const win = 0.05 / sp // ~50ms in beat
    let end = nextBeat + win
    const loopOn = E.loop.on && !(E.recording && E.recAudio) && E.loop.end > E.loop.start
    if (loopOn && nextBeat < E.loop.end && end >= E.loop.end) {
      schedule(nextBeat, E.loop.end, nextTime, sp)
      nextTime += (E.loop.end - nextBeat) * sp
      nextBeat = E.loop.start; segStart = true
      E.marks.push({ time: nextTime, beat: nextBeat })
      if (E.recording && E.recClip) loopWrapRec()
      continue
    }
    schedule(nextBeat, end, nextTime, sp)
    nextTime += (end - nextBeat) * sp; nextBeat = end
  }
  if (E.marks.length > 8) E.marks = E.marks.slice(-8)
}

function schedule (b0, b1, t0, sp) {
  const at = (b) => t0 + (b - b0) * sp
  // metronomo
  if (E.metro) for (let b = Math.ceil(b0 - 1e-9); b < b1; b++) clickAt(at(b), b % 4 === 0)
  const first = segStart; segStart = false
  const anySolo = trackList().some(t => t.get('solo'))
  for (const c of S.clips.values()) {
    const tr = trackById(c.get('track')); if (!tr) continue
    if (tr.get('mute') || (anySolo && !tr.get('solo'))) continue
    const tn = E.tracks.get(tr.get('id')); if (!tn) continue
    const cs = c.get('start'); const ce = cs + c.get('len')
    if (ce <= b0 || cs >= b1) continue
    if (c.get('kind') === 'midi') {
      if (!tn.inst || !c.get('notes')) continue
      for (const n of c.get('notes').values()) {
        if (n.t >= c.get('len')) continue
        const nb = cs + n.t
        if (nb >= b0 && nb < b1) {
          const st = at(nb); const dur = Math.min(n.d, c.get('len') - n.t) * sp
          if (st < E.ctx.currentTime) E.late = (E.late || 0) + 1 // nota schedulata in ritardo (thread UI troppo occupato)
          tn.inst.noteOn(n.p, n.v, st)
          const off = st + Math.max(0.01, dur)
          setTimeout(() => { if (E.playing) tn.inst.noteOff(n.p, off) }, Math.max(0, (off - E.ctx.currentTime - 0.05) * 1000))
        }
      }
    } else if (c.get('file')) {
      const startsHere = cs >= b0 && cs < b1
      const inside = first && cs < b0 && ce > b0
      if (!startsHere && !inside) continue
      const buf = E.audioBufs.get(c.get('file'))
      buf?.then(b => {
        if (!b || !E.playing) return
        const src = E.ctx.createBufferSource(); src.buffer = b
        const g = E.ctx.createGain(); g.gain.value = Math.pow(10, (c.get('gain') || 0) / 20)
        src.connect(g); Tone.connect(g, tn.input)
        const off = (c.get('offset') || 0) + (inside ? (b0 - cs) * sp : 0)
        const when = inside ? at(b0) : at(cs)
        const dur = (ce - (inside ? b0 : cs)) * sp
        if (when < E.ctx.currentTime) return
        src.start(when, off, Math.max(0.01, dur))
        g.gain.setValueAtTime(g.gain.value, when + dur - 0.005); g.gain.linearRampToValueAtTime(0, when + dur)
        E.sources.add(src); src.onended = () => { E.sources.delete(src); g.disconnect() }
      })
    }
  }
}

let clickBuf = null
function clickAt (time, accent) {
  if (!clickBuf) {
    clickBuf = E.ctx.createBuffer(1, 0.03 * E.ctx.sampleRate, E.ctx.sampleRate)
    const d = clickBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / E.ctx.sampleRate * 2 * Math.PI * 1800) * Math.exp(-i / (0.004 * E.ctx.sampleRate))
  }
  const s = E.ctx.createBufferSource(); s.buffer = clickBuf; s.playbackRate.value = accent ? 1.4 : 1
  const g = E.ctx.createGain(); g.gain.value = accent ? 0.5 : 0.3
  s.connect(g); Tone.connect(g, E.click); s.start(time)
}

// ------------------------------------------------------------ registrazione
export async function startRecording () {
  const tr = trackById(E.armed || E.sel); if (!tr) return 'Seleziona o arma una traccia (●) prima di registrare'
  await resumeAudio()
  E.recTrack = tr.get('id'); E.recPending = new Map()
  const startBeat = E.playing ? playheadBeat() : E.pos
  if (tr.get('kind') === 'inst') {
    E.recAudio = false
    let cs = Math.floor(startBeat / 4) * 4; let len = 4
    if (E.loop.on) { cs = E.loop.start; len = E.loop.end - E.loop.start }
    E.recClip = addClip(E.recTrack, cs, len, { name: 'REC ' + S.me.name })
    E.recClipStart = cs
  } else {
    E.recAudio = true
    const err = await armInput(); if (err) return err
    E.recChunks = []; E.recFirst = null
    E.recNode.port.postMessage(true)
    E.recClip = null
  }
  E.recording = true
  if (!E.playing) await play(E.pos)
  E.recPlayStart = E.marks[0]
  return null
}
export function stopRecording () {
  if (!E.recording) return
  E.recording = false
  if (E.recAudio) finishAudioRec()
  else {
    const now = beatAtTime(E.ctx.currentTime - outLatency())
    for (const [p, n] of E.recPending) commitRecNote(p, n, now)
    E.recPending.clear()
  }
  E.recClip = null
}
function commitRecNote (pitch, n, endBeat) {
  const c = S.clips.get(E.recClip); if (!c || n.beat == null) return
  const cs = c.get('start')
  let t = n.beat - cs; let d = endBeat - n.beat
  if (d <= 0) d += E.loop.end - E.loop.start // nota a cavallo del loop
  if (t < 0) t = 0
  if (!E.loop.on && t + d > c.get('len')) moveClip(E.recClip, { len: Math.ceil((t + d) / 4) * 4 })
  putNotes(E.recClip, [{ id: uid(), p: pitch, t, d: Math.max(0.05, d), v: n.vel }], null)
}
function loopWrapRec () {}

export async function listInputs () {
  try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter(x => x.kind === 'audioinput') } catch { return [] }
}
let recReady = null
function ensureRec () {
  const code = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.b=[];this.n=0;this.port.onmessage=e=>{this.on=e.data}}
  process(i){const c=i[0];if(this.on&&c&&c.length){if(!this.n)this.t=currentTime;this.b.push([c[0].slice(0),(c[1]||c[0]).slice(0)]);this.n+=c[0].length;
  if(this.n>=4096){const L=new Float32Array(this.n),Rr=new Float32Array(this.n);let o=0;for(const[a,b]of this.b){L.set(a,o);Rr.set(b,o);o+=a.length}
  this.port.postMessage({t:this.t,L,R:Rr},[L.buffer,Rr.buffer]);this.b=[];this.n=0}}return true}}registerProcessor('rec',R)`
  recReady = recReady || E.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
  return recReady
}
export async function armInput () {
  if (E.recNode) return null
  try {
    const dev = localStorage.getItem('ayub_indev')
    E.inputStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: dev ? { exact: dev } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, latency: 0 }
    })
  } catch (e) { return 'Microfono non disponibile: ' + e.message }
  await ensureRec()
  E.inputSrc = E.ctx.createMediaStreamSource(E.inputStream)
  E.recNode = new AudioWorkletNode(E.ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' })
  E.inputSrc.connect(E.recNode)
  const z = E.ctx.createGain(); z.gain.value = 0; E.recNode.connect(z); z.connect(E.ctx.destination)
  E.recNode.port.onmessage = (e) => { if (!E.recording) return; if (E.recFirst == null) E.recFirst = e.data.t; E.recChunks.push(e.data) }
  E.inputMeter = new Tone.Meter({ smoothing: 0.6 }); Tone.connect(E.inputSrc, E.inputMeter)
  return null
}
export function setMonitor (trackId, on) {
  const tn = E.tracks.get(trackId); if (!tn || !E.inputSrc) return
  if (on) { tn.mon = E.ctx.createGain(); E.inputSrc.connect(tn.mon); Tone.connect(tn.mon, tn.input) } else if (tn.mon) { tn.mon.disconnect(); tn.mon = null }
}

async function finishAudioRec () {
  E.recNode.port.postMessage(false)
  const chunks = E.recChunks; E.recChunks = []
  if (!chunks.length) return
  const tr = trackById(E.recTrack); const inSel = tr.get('input') ?? 0
  const n = chunks.reduce((a, c) => a + c.L.length, 0)
  const L = new Float32Array(n); const R = new Float32Array(n); let o = 0
  for (const c of chunks) { L.set(c.L, o); R.set(c.R, o); o += c.L.length }
  const sr = E.ctx.sampleRate
  // compensazione: un campione catturato al tempo x corrisponde al beat a (x - latenza out - latenza in)
  const lat = outLatency() + E.latencyMs / 1000
  const startBeat = beatAtTime(chunks[0].t - lat)
  const chans = inSel === 2 ? [L, R] : [inSel === 1 ? R : L]
  const wav = encodeWav(chans, sr)
  const buf = E.ctx.createBuffer(chans.length, n, sr); chans.forEach((c, i) => buf.copyToChannel(c, i))
  const res = await fetch('/api/audio', { method: 'POST', body: wav }).then(r => r.json())
  E.audioBufs.set(res.id, Promise.resolve(buf)); E.peaks.set(res.id, computePeaks(buf))
  const beats = (n / sr) / spb()
  // se partita prima di 0, taglia
  const offset = startBeat < 0 ? -startBeat * spb() : 0
  addClip(E.recTrack, Math.max(0, startBeat), beats - Math.max(0, -startBeat), { file: res.id, offset, name: 'TAKE ' + S.me.name, gain: 0 })
}

function encodeWav (chans, sr) {
  const n = chans[0].length; const nc = chans.length; const bps = 3
  const buf = new ArrayBuffer(44 + n * nc * bps); const v = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * bps, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true)
  v.setUint32(28, sr * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, 24, true); w(36, 'data'); v.setUint32(40, n * nc * bps, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i])) * 8388607 | 0
      v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// ------------------------------------------------------------ export mix (rendering in tempo reale dal master)
export async function exportMix (onProgress) {
  let end = 0
  for (const c of S.clips.values()) end = Math.max(end, c.get('start') + c.get('len'))
  if (!end) return 'PROGETTO VUOTO'
  if (E.playing) stop()
  await resumeAudio(); await ensureRec()
  const tap = new AudioWorkletNode(E.ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' })
  E.limiter.connect(tap)
  const z = E.ctx.createGain(); z.gain.value = 0; tap.connect(z); z.connect(E.ctx.destination)
  const chunks = []; tap.port.onmessage = (e) => chunks.push(e.data)
  const save = { loop: E.loop.on, metro: E.metro }
  E.loop.on = false; E.metro = false
  tap.port.postMessage(true)
  E.pos = 0; await play(0)
  const t0 = E.ctx.currentTime; const dur = end * spb() + 2.5
  E.exporting = true
  while (E.ctx.currentTime - t0 < dur && E.exporting) { onProgress?.((E.ctx.currentTime - t0) / dur); await new Promise(r => setTimeout(r, 200)) }
  const aborted = !E.exporting; E.exporting = false
  tap.port.postMessage(false); stop(); E.loop.on = save.loop; E.metro = save.metro
  await new Promise(r => setTimeout(r, 150))
  tap.disconnect(); E.limiter.disconnect(tap)
  if (aborted) return 'EXPORT ANNULLATO'
  const n = chunks.reduce((a, c) => a + c.L.length, 0)
  const L = new Float32Array(n); const R = new Float32Array(n); let o = 0
  for (const c of chunks) { L.set(c.L, o); R.set(c.R, o); o += c.L.length }
  const blob = encodeWav([L, R], E.ctx.sampleRate)
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = ((S.project.get('name') || document.title.split(' //')[0] || 'mix').replace(/[^a-z0-9]+/gi, '_')) + '_mix.wav'
  document.body.append(a); a.click(); a.remove()
  return null
}
