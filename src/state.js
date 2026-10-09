// Stato condiviso del progetto (Yjs). Ogni scrittura è firmata: by = operatore, at = timestamp.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export const COLORS = ['#7dff9a', '#ffb340', '#5ce1ff', '#ff6ad5', '#fff36a', '#ff7a4a', '#b18cff', '#6affd8']
export const uid = () => Math.random().toString(36).slice(2, 10)

export const S = {
  me: { name: '?', color: COLORS[0] }, dirtyTracks: new Set(), dirtyAll: true,
  doc: null, provider: null, awareness: null,
  project: null, tracks: null, clips: null, log: null, undo: null,
  listeners: new Set()
}

export function colorFor (name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

export function connect (projectId, me) {
  S.me = { name: me, color: colorFor(me) }
  const doc = new Y.Doc()
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const provider = new WebsocketProvider(`${proto}://${location.host}/yjs`, projectId, doc)
  S.doc = doc; S.provider = provider; S.awareness = provider.awareness
  S.project = doc.getMap('project')
  S.tracks = doc.getArray('tracks') // Y.Map per traccia
  S.clips = doc.getMap('clips') // id -> Y.Map
  S.log = doc.getArray('log')
  S.awareness.setLocalStateField('user', S.me)
  S.undo = new Y.UndoManager([S.tracks, S.clips, S.project], { trackedOrigins: new Set([S.me.name]), captureTimeout: 400 })
  // eventi tipizzati: chi ascolta sa COSA è cambiato e ridisegna solo quello
  S.tracks.observeDeep((evs) => {
    for (const e of evs) {
      if (e.target === S.tracks) { S.dirtyAll = true; continue }
      const idx = e.path[0]; const t = typeof idx === 'number' ? S.tracks.get(idx) : null
      if (t) S.dirtyTracks.add(t.get('id')); else S.dirtyAll = true
    }
    emit('tracks')
  })
  S.clips.observeDeep(() => emit('clips'))
  S.log.observe(() => emit('log'))
  S.project.observe(() => emit('project'))
  S.awareness.on('change', ({ added, removed, updated }) => {
    // ignora i miei aggiornamenti (playhead, tasti): li disegno già in locale
    const others = [...added, ...removed, ...updated].some(c => c !== doc.clientID)
    if (others) emit('presence')
  })
  return new Promise((resolve) => provider.once('synced', () => resolve()))
}

let raf = 0
const pending = new Set()
function emit (what = 'doc') {
  pending.add(what)
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; const p = [...pending]; pending.clear(); S.listeners.forEach(f => f(p)) })
}
export const onChange = (f) => S.listeners.add(f)
// altri operatori (esclude me stesso anche se ho più schede aperte con lo stesso nome)
export const others = () => [...S.awareness.getStates().entries()].filter(([c, s]) => c !== S.doc.clientID && s.user && s.user.name !== S.me.name)
export const refresh = () => emit('ui')

// transazione firmata + voce nel registro
export function act (msg, fn) {
  S.doc.transact(() => {
    fn()
    if (msg) {
      S.log.push([{ who: S.me.name, color: S.me.color, msg, at: Date.now() }])
      if (S.log.length > 400) S.log.delete(0, S.log.length - 400)
    }
  }, S.me.name)
  S.undo?.stopCapturing() // ogni azione discreta = un passo di annulla (le manopole invece si accorpano)
}
export const stamp = (m) => { m.set('by', S.me.name); m.set('at', Date.now()) }

// ---------- tracce ----------
export const trackList = () => S.tracks.toArray()
export const trackById = (id) => S.tracks.toArray().find(t => t.get('id') === id)
export const trackIndex = (id) => S.tracks.toArray().findIndex(t => t.get('id') === id)

export function addTrack ({ kind = 'inst', name, instrument = 'wave', preset = null, params = {}, fx = [] } = {}) {
  const t = new Y.Map()
  const id = uid()
  act(`+ traccia ${name}`, () => {
    t.set('id', id); t.set('name', name); t.set('kind', kind)
    t.set('color', COLORS[(S.tracks.length + 2) % COLORS.length])
    t.set('vol', -6); t.set('pan', 0); t.set('mute', false); t.set('solo', false)
    t.set('author', S.me.name); stamp(t)
    if (kind === 'inst') {
      const inst = new Y.Map(); inst.set('type', instrument); inst.set('preset', preset)
      const p = new Y.Map(); for (const k in params) p.set(k, params[k])
      inst.set('params', p); t.set('instrument', inst)
    } else {
      t.set('input', 0) // 0 = ingresso 1, 1 = ingresso 2, 2 = 1+2
    }
    const fa = new Y.Array(); t.set('fx', fa); t.set('fxInit', true)
    fa.push(fx.map(([type, ps]) => fxMap(type, ps, true)))
    S.tracks.push([t])
  })
  return id
}
export function deleteTrack (id) {
  const i = trackIndex(id); if (i < 0) return
  const name = S.tracks.get(i).get('name')
  act(`- traccia ${name}`, () => {
    for (const [cid, c] of S.clips) if (c.get('track') === id) S.clips.delete(cid)
    S.tracks.delete(i, 1)
  })
}
export function setTrack (id, key, val, msg) {
  const t = trackById(id); if (!t) return
  act(msg, () => { t.set(key, val); stamp(t) })
}
function fxMap (type, params, fromPreset) {
  const f = new Y.Map(); f.set('id', uid()); f.set('type', type); f.set('on', true)
  const p = new Y.Map(); for (const k in params) p.set(k, params[k])
  f.set('params', p); f.set('by', S.me.name); if (fromPreset) f.set('preset', true)
  return f
}
// sostituisce gli effetti arrivati col preset precedente (quelli aggiunti a mano restano)
export function replacePresetFx (t, fx) {
  const arr = t.get('fx')
  for (let i = arr.length - 1; i >= 0; i--) if (arr.get(i).get('preset')) arr.delete(i, 1)
  arr.insert(0, fx.map(([type, ps]) => fxMap(type, ps, true)))
}
export function setInstrument (id, type, params, preset, fx) {
  const t = trackById(id); if (!t) return
  act(`${t.get('name')}: strumento ${type}${preset ? ' / ' + preset : ''}`, () => {
    if (fx) { replacePresetFx(t, fx); t.set('fxInit', true) }
    const inst = new Y.Map(); inst.set('type', type); inst.set('preset', preset || null)
    const p = new Y.Map(); for (const k in params) p.set(k, params[k])
    inst.set('params', p); t.set('instrument', inst); stamp(t)
  })
}
// manopole/fader: il suono cambia subito (local), la scrittura su Yjs è raggruppata a 1 per fotogramma
const pendingParams = new Map() // ymap -> {key: val}
let flushRaf = 0
export let onLocalParam = null
export const setLocalParamHook = (f) => { onLocalParam = f }
export function setParam (ymap, key, val, label, local) {
  if (local) onLocalParam?.(local, key, val)
  if (!pendingParams.has(ymap)) pendingParams.set(ymap, {})
  pendingParams.get(ymap)[key] = val
  if (!flushRaf) flushRaf = requestAnimationFrame(flushParams)
  logThrottled(label)
}
function flushParams () {
  flushRaf = 0
  const items = [...pendingParams]; pendingParams.clear()
  S.doc.transact(() => { for (const [m, kv] of items) { for (const k in kv) m.set(k, kv[k]); m.set('__by', S.me.name) } }, S.me.name)
}
export const getParam = (ymap, key) => pendingParams.get(ymap)?.[key] ?? ymap.get(key)
const lastLog = new Map()
function logThrottled (label) {
  if (!label) return
  const now = Date.now()
  if (now - (lastLog.get(label) || 0) < 3000) return
  lastLog.set(label, now)
  act(label, () => {})
}

export function addFx (trackId, type, params) {
  const t = trackById(trackId)
  act(`${t.get('name')}: + ${type}`, () => {
    const f = new Y.Map(); f.set('id', uid()); f.set('type', type); f.set('on', true)
    const p = new Y.Map(); for (const k in params) p.set(k, params[k])
    f.set('params', p); f.set('by', S.me.name)
    t.get('fx').push([f])
  })
}
export function removeFx (trackId, fxId) {
  const t = trackById(trackId); const arr = t.get('fx')
  const i = arr.toArray().findIndex(f => f.get('id') === fxId)
  if (i >= 0) act(`${t.get('name')}: - ${arr.get(i).get('type')}`, () => arr.delete(i, 1))
}

// ---------- clip ----------
export function addClip (trackId, start, len, extra = {}) {
  const c = new Y.Map(); const id = uid()
  const t = trackById(trackId)
  act(`+ clip su ${t.get('name')} @${(start / 4 + 1).toFixed(1)}`, () => {
    c.set('id', id); c.set('track', trackId); c.set('start', start); c.set('len', len)
    const kind = t.get('kind') === 'audio' ? 'audio' : 'midi' // nota: get() su Y.Map non ancora integrata dà undefined
    c.set('kind', kind)
    c.set('name', extra.name || t.get('name'))
    c.set('author', S.me.name); stamp(c)
    if (kind === 'midi') c.set('notes', new Y.Map())
    for (const k in extra) if (k !== 'name') c.set(k, extra[k])
    S.clips.set(id, c)
  })
  return id
}
export function moveClip (id, fields, msg) {
  const c = S.clips.get(id); if (!c) return
  act(msg, () => { for (const k in fields) c.set(k, fields[k]); stamp(c) })
}
export function deleteClip (id) {
  const c = S.clips.get(id); if (!c) return
  act(`- clip ${c.get('name')}`, () => S.clips.delete(id))
}
export function duplicateClip (id) {
  const c = S.clips.get(id); if (!c) return
  const nid = uid(); const n = new Y.Map()
  act(`duplica clip ${c.get('name')}`, () => {
    for (const [k, v] of c) if (k !== 'notes') n.set(k, v)
    n.set('id', nid); n.set('start', c.get('start') + c.get('len')); n.set('author', S.me.name); stamp(n)
    if (c.get('notes')) { const nn = new Y.Map(); for (const [k, v] of c.get('notes')) nn.set(k, { ...v }); n.set('notes', nn) }
    S.clips.set(nid, n)
  })
  return nid
}
// note: {p: pitch, t: beat nel clip, d: durata, v: velocity 0..1, by}
export function putNotes (clipId, notes, msg) {
  const c = S.clips.get(clipId); if (!c) return
  act(msg, () => { const m = c.get('notes'); for (const n of notes) m.set(n.id, { ...n, by: S.me.name, at: Date.now() }); stamp(c) })
}
export function delNotes (clipId, ids, msg) {
  const c = S.clips.get(clipId); if (!c) return
  act(msg, () => { const m = c.get('notes'); for (const id of ids) m.delete(id); stamp(c) })
}
export const clipsOfTrack = (tid) => [...S.clips.values()].filter(c => c.get('track') === tid)
