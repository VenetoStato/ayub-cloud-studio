// Piano roll: editing note della clip selezionata. Note colorate per autore.
import { C, alpha, tc, glow, font } from './theme.js'
import { S, trackById, putNotes, delNotes, moveClip, colorFor, uid } from '../state.js'
import { E, playheadBeat, liveOn, liveOff } from '../audio/engine.js'
import { UI } from './ui.js'
import { DRUM_LABELS } from '../audio/instruments.js'
import { $, h, fitCanvas, noteName, isBlack, hhmm } from './util.js'

const R = { pxb: 80, rowh: 13, sx: 0, sy: 0, kw: 54, velh: 56, sel: new Set(), drag: null, hover: null, lastLen: 0.25, view: null }
const cv = () => $('#rollCv')
const clip = () => UI.selClip && S.clips.get(UI.selClip)

export function initRoll () {
  const c = cv()
  c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp)
  c.addEventListener('contextmenu', (e) => e.preventDefault())
  c.addEventListener('dblclick', (e) => {
    const cl = clip(); const hit = noteAt(e.offsetX, e.offsetY)
    if (cl && hit) { delNotes(cl.get('id'), [hit.n.id], `- nota ${noteName(hit.n.p)} in ${cl.get('name')}`); R.sel.delete(hit.n.id); draw() }
  })
  c.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) { const b = (e.offsetX - R.kw + R.sx) / R.pxb; R.pxb = Math.max(15, Math.min(600, R.pxb * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); R.sx = Math.max(0, b * R.pxb - (e.offsetX - R.kw)) } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) R.sx = Math.max(0, R.sx + (e.deltaX || e.deltaY))
    else R.sy = Math.max(0, Math.min(128 * R.rowh - 100, R.sy + e.deltaY))
    draw()
  }, { passive: false })
  new ResizeObserver(() => draw()).observe(c)
}

export function renderRollBar () {
  const bar = $('#rollBar'); bar.innerHTML = ''
  const c = clip()
  if (!c || c.get('kind') !== 'midi') { bar.append(h('span', { class: 'dim' }, 'SELEZIONA UNA CLIP MIDI (DOPPIO CLICK SU UNA TRACCIA STRUMENTO PER CREARLA)')); return }
  const grids = [[1, '1/4'], [0.5, '1/8'], [0.25, '1/16'], [0.125, '1/32'], [1 / 3, '1/4T'], [1 / 6, '1/8T']]
  bar.append(
    h('span', { class: 'amb' }, c.get('name')),
    h('span', { class: 'dim' }, `DI ${c.get('author')} · ULTIMA MOD ${c.get('by')} ${hhmm(c.get('at'))}`),
    h('span', {}, 'GRIGLIA'),
    h('select', { onchange: (e) => { UI.grid = +e.target.value; draw() } }, ...grids.map(([v, l]) => { const o = h('option', { value: v }, l); if (Math.abs(v - UI.grid) < 1e-6) o.selected = true; return o })),
    h('span', {}, 'LUNGH.'),
    h('input', { type: 'number', value: c.get('len') / 4, min: 0.25, step: 0.25, style: { width: '50px' }, onchange: (e) => moveClip(c.get('id'), { len: Math.max(0.25, +e.target.value) * 4 }, `lunghezza clip ${c.get('name')} = ${e.target.value} battute`) }), h('span', { class: 'dim' }, 'BATT.'),
    h('button', { onclick: quantize, title: 'Quantizza note selezionate (o tutte)' }, 'QUANTIZZA'),
    h('button', { onclick: () => transpose(12) }, '+8VA'), h('button', { onclick: () => transpose(-12) }, '-8VA'),
    h('span', { class: 'dim', style: { marginLeft: 'auto' } }, 'CLICK = NOTA · TRASCINA = SPOSTA · BORDO = LUNGH. · DX/DOPPIO = CANCELLA · SHIFT = MULTI')
  )
  // centra la vista sulle note la prima volta
  if (R.view !== c.get('id')) {
    R.view = c.get('id'); R.sel.clear(); R.sx = 0
    const ns = [...c.get('notes').values()]
    const tr = trackById(c.get('track'))
    const mid = ns.length ? ns.reduce((a, n) => a + n.p, 0) / ns.length : tr?.get('instrument')?.get('type') === 'drums' ? 42 : 60
    R.sy = Math.max(0, (127 - mid) * R.rowh - 120)
    const w = cv().clientWidth - R.kw; if (w > 0) R.pxb = Math.max(20, Math.min(200, w / Math.max(4, c.get('len'))))
  }
}

const isDrum = () => { const c = clip(); return c && trackById(c.get('track'))?.get('instrument')?.get('type') === 'drums' }
const nx = (b) => R.kw + b * R.pxb - R.sx
const ny = (p) => (127 - p) * R.rowh - R.sy
const bAt = (x) => (x - R.kw + R.sx) / R.pxb
const pAt = (y) => 127 - Math.floor((y + R.sy) / R.rowh)
const snapB = (b, e) => e?.altKey ? b : Math.floor(b / UI.grid + 1e-6) * UI.grid
const roundB = (b, e) => e?.altKey ? b : Math.round(b / UI.grid) * UI.grid

function noteAt (x, y) {
  const c = clip(); if (!c) return null
  const b = bAt(x); const p = pAt(y)
  for (const n of c.get('notes').values()) {
    if (n.p === p && b >= n.t && b <= n.t + n.d) return { n, edge: nx(n.t + n.d) - x < 6 }
  }
  return null
}

function onDown (e) {
  const c = clip(); if (!c || c.get('kind') !== 'midi') return
  const x = e.offsetX; const y = e.offsetY; const H = cv().clientHeight
  cv().setPointerCapture(e.pointerId)
  const tid = c.get('track')
  if (y > H - R.velh) { R.drag = { mode: 'vel' }; velAt(x, y); return }
  if (x < R.kw) { const p = pAt(y); liveOn(tid, p, 0.8); R.drag = { mode: 'key', p, tid }; return }
  const hit = noteAt(x, y)
  if (e.button === 2) { if (hit) { delNotes(c.get('id'), [hit.n.id], `- nota ${noteName(hit.n.p)} in ${c.get('name')}`); R.sel.delete(hit.n.id) } draw(); return }
  if (hit) {
    if (e.shiftKey) { R.sel.has(hit.n.id) ? R.sel.delete(hit.n.id) : R.sel.add(hit.n.id) } else if (!R.sel.has(hit.n.id)) { R.sel.clear(); R.sel.add(hit.n.id) }
    const notes = c.get('notes')
    R.drag = { mode: hit.edge ? 'len' : 'move', x0: x, y0: y, orig: [...R.sel].map(id => notes.get(id)).filter(Boolean), moved: false, key: hit.n }
    if (!hit.edge) { liveOn(tid, hit.n.p, hit.n.v); R.drag.prev = { tid, p: hit.n.p } }
  } else {
    if (!e.shiftKey) R.sel.clear()
    const n = { id: uid(), p: pAt(y), t: snapB(bAt(x), e), d: R.lastLen, v: UI.kVel / 127 }
    if (n.t < 0 || n.t >= c.get('len')) return
    putNotes(c.get('id'), [n], `+ nota ${noteName(n.p)} in ${c.get('name')}`)
    R.sel.clear(); R.sel.add(n.id)
    liveOn(tid, n.p, n.v); R.drag = { mode: 'len', x0: x, y0: y, orig: [{ ...n, by: S.me.name }], moved: false, key: n, prev: { tid, p: n.p }, created: true }
  }
  draw()
}
function onMove (e) {
  const x = e.offsetX; const y = e.offsetY
  if (!R.drag) {
    const hit = noteAt(x, y)
    cv().style.cursor = x < R.kw ? 'pointer' : hit ? (hit.edge ? 'ew-resize' : 'move') : 'crosshair'
    const hv = hit?.n.id || null; if (hv !== R.hover) { R.hover = hv; draw() }
    return
  }
  const d = R.drag
  if (d.mode === 'vel') { velAt(x, y); return }
  if (d.mode === 'key') return
  if (Math.abs(x - d.x0) + Math.abs(y - d.y0) > 2) d.moved = true
  const db = (x - d.x0) / R.pxb; const dp = Math.round((d.y0 - y) / R.rowh)
  if (d.mode === 'move') {
    d.preview = d.orig.map(n => ({ ...n, t: Math.max(0, roundB(n.t + db, e)), p: Math.max(0, Math.min(127, n.p + dp)) }))
    const kp = d.preview.find(n => n.id === d.key.id)
    if (kp && d.prev && kp.p !== d.prev.p) { liveOff(d.prev.tid, d.prev.p); liveOn(d.prev.tid, kp.p, kp.v); d.prev.p = kp.p }
  } else d.preview = d.orig.map(n => ({ ...n, d: Math.max(UI.grid / 2, roundB(n.d + db, e) || UI.grid) }))
  draw()
}
function onUp () {
  const d = R.drag; R.drag = null
  if (!d) return
  if (d.prev) liveOff(d.prev.tid, d.prev.p)
  if (d.mode === 'key') liveOff(d.tid, d.p)
  if (d.mode === 'vel' && d.changed) { const c = clip(); putNotes(c.get('id'), d.changed, `velocity ${d.changed.length} note in ${c.get('name')}`) }
  if (d.preview && d.moved) {
    const c = clip()
    const what = d.mode === 'move' ? 'sposta' : 'lunghezza'
    putNotes(c.get('id'), d.preview, `${what} ${d.preview.length > 1 ? d.preview.length + ' note' : 'nota ' + noteName(d.preview[0].p)} in ${c.get('name')}`)
    if (d.mode === 'len') R.lastLen = d.preview[0].d
  }
  draw()
}
function velAt (x, y) {
  const c = clip(); const H = cv().clientHeight
  const v = Math.max(0.05, Math.min(1, (H - y) / (R.velh - 6)))
  const b = bAt(x)
  const notes = [...c.get('notes').values()].filter(n => Math.abs(nx(n.t) - x) < 6 || (b >= n.t && b <= n.t + Math.min(n.d, UI.grid)))
  if (!notes.length) return
  R.drag.changed = R.drag.changed || []
  for (const n of notes) { const nn = { ...n, v }; R.drag.changed = R.drag.changed.filter(z => z.id !== n.id).concat(nn) }
  draw()
}

function quantize () {
  const c = clip(); if (!c) return
  const ns = [...c.get('notes').values()].filter(n => !R.sel.size || R.sel.has(n.id))
  putNotes(c.get('id'), ns.map(n => ({ ...n, t: Math.round(n.t / UI.grid) * UI.grid })), `quantizza ${ns.length} note in ${c.get('name')}`)
}
function transpose (k) {
  const c = clip(); if (!c) return
  const ns = [...c.get('notes').values()].filter(n => !R.sel.size || R.sel.has(n.id))
  putNotes(c.get('id'), ns.map(n => ({ ...n, p: Math.max(0, Math.min(127, n.p + k)) })), `traspone ${ns.length} note ${k > 0 ? '+' : ''}${k}`)
}
export function rollKeys (e) {
  const c = clip(); if (!c || UI.tab !== 'roll') return false
  const notes = c.get('notes')
  if ((e.key === 'Delete' || e.key === 'Backspace') && R.sel.size) { delNotes(c.get('id'), [...R.sel], `- ${R.sel.size} note in ${c.get('name')}`); R.sel.clear(); return true }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); R.sel = new Set(notes.keys()); draw(); return true }
  const arrows = { ArrowUp: [0, e.shiftKey ? 12 : 1], ArrowDown: [0, e.shiftKey ? -12 : -1], ArrowLeft: [-UI.grid, 0], ArrowRight: [UI.grid, 0] }
  if (arrows[e.key] && R.sel.size) {
    e.preventDefault(); const [dt, dp] = arrows[e.key]
    putNotes(c.get('id'), [...R.sel].map(id => notes.get(id)).filter(Boolean).map(n => ({ ...n, t: Math.max(0, n.t + dt), p: n.p + dp })), `sposta ${R.sel.size} note`)
    return true
  }
  return false
}

let layer = null; let LW = 0; let LH = 0
export function draw () {
  if (UI.tab !== 'roll') return
  const main = fitCanvas(cv())
  const d = devicePixelRatio || 1
  if (!layer) layer = document.createElement('canvas')
  if (layer.width !== cv().width || layer.height !== cv().height) { layer.width = cv().width; layer.height = cv().height }
  const g = layer.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0)
  LW = main.w; LH = main.h
  paintStatic(g, LW, LH)
  drawPlay()
}
export function drawPlay () {
  if (UI.tab !== 'roll') return
  if (!layer) return draw()
  const cvs = cv(); const g = cvs.getContext('2d')
  if (cvs.width !== layer.width || cvs.height !== layer.height) return draw()
  const d = devicePixelRatio || 1
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(layer, 0, 0); g.setTransform(d, 0, 0, d, 0, 0)
  const c = clip(); if (!c || c.get('kind') !== 'midi') return
  const len = c.get('len'); const gh = LH - R.velh
  // playhead
  if (E.playing) {
    const ph = playheadBeat() - c.get('start')
    if (ph >= 0 && ph <= len) { const x = nx(ph); g.strokeStyle = C.fg; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, gh); g.stroke() }
  }
}
function paintStatic (g, w, H) {
  g.fillStyle = C.bg; g.fillRect(0, 0, w, H)
  const c = clip()
  if (!c || c.get('kind') !== 'midi') return
  const drum = isDrum()
  const gh = H - R.velh
  // righe
  const p0 = Math.max(0, pAt(gh)); const p1 = Math.min(127, pAt(0))
  for (let p = p0; p <= p1; p++) {
    const y = ny(p)
    g.fillStyle = isBlack(p) ? C.rowB : C.bg3; g.fillRect(R.kw, y, w, R.rowh)
    g.fillStyle = p % 12 === 0 ? C.g3 : C.g1; g.fillRect(R.kw, y + R.rowh - 1, w, 1)
  }
  // griglia
  const len = c.get('len')
  for (let b = 0; b <= len + 1e-6; b += UI.grid) {
    const x = Math.round(nx(b)) + 0.5; if (x < R.kw || x > w) continue
    const bar = Math.abs(b % 4) < 1e-6; const beat = Math.abs(b % 1) < 1e-6
    g.strokeStyle = bar ? C.line : beat ? C.g2 : C.g1
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, gh); g.stroke()
  }
  // fine clip
  const xe = nx(len); g.fillStyle = C.shade; g.fillRect(Math.max(R.kw, xe), 0, w, gh)
  g.fillStyle = C.amber; g.fillRect(xe, 0, 2, gh)
  // note
  const pv = R.drag?.preview && R.drag.moved ? new Map(R.drag.preview.map(n => [n.id, n])) : R.drag?.changed ? new Map(R.drag.changed.map(n => [n.id, n])) : new Map()
  const all = [...c.get('notes').values()].map(n => pv.get(n.id) || n)
  g.font = font(10)
  for (const n of all) {
    const x = nx(n.t); const y = ny(n.p); const nw = Math.max(3, n.d * R.pxb - 1)
    if (x > w || x + nw < R.kw || y > gh || y + R.rowh < 0) continue
    const col = tc(colorFor(n.by || '?')); const sel = R.sel.has(n.id)
    g.globalAlpha = 0.35 + 0.65 * n.v; g.fillStyle = col; g.fillRect(x, y + 1, nw, R.rowh - 2); g.globalAlpha = 1
    g.strokeStyle = sel ? C.sel : C.ink; g.lineWidth = sel ? 1.5 : 1; g.strokeRect(x + 0.5, y + 1.5, nw - 1, R.rowh - 3); g.lineWidth = 1
    if (nw > 34 && R.rowh >= 11) { g.fillStyle = C.ink; g.fillText(n.by ? n.by.slice(0, 3) : '', x + 3, y + R.rowh - 3) }
  }
  // tooltip
  if (R.hover && !R.drag) {
    const n = c.get('notes').get(R.hover)
    if (n) {
      const t = `${drum ? DRUM_LABELS[n.p] || noteName(n.p) : noteName(n.p)} · VEL ${Math.round(n.v * 127)} · DI ${n.by || '?'} ${n.at ? hhmm(n.at) : ''}`
      const x = Math.min(w - 260, nx(n.t)); const y = Math.max(14, ny(n.p) - 4)
      g.fillStyle = C.bg; g.fillRect(x, y - 12, g.measureText(t).width + 10, 15); g.strokeStyle = C.amber; g.strokeRect(x + 0.5, y - 11.5, g.measureText(t).width + 9, 14)
      g.fillStyle = C.amber; g.fillText(t, x + 5, y)
    }
  }
  // tastiera laterale
  const live = new Set(E.liveNotes.keys())
  for (let p = p0; p <= p1; p++) {
    const y = ny(p); const blk = isBlack(p)
    g.fillStyle = live.has(p) ? C.fg : blk ? C.keyB : C.keyW2
    g.fillRect(0, y, R.kw, R.rowh - 1)
    if (drum && DRUM_LABELS[p]) { g.fillStyle = live.has(p) ? C.ink : C.amber; g.fillText(DRUM_LABELS[p], 3, y + R.rowh - 3) } else if (p % 12 === 0) { g.fillStyle = live.has(p) ? C.ink : C.fg; g.fillText(noteName(p), 3, y + R.rowh - 3) }
  }
  g.fillStyle = C.line; g.fillRect(R.kw - 1, 0, 1, gh)
  // velocity lane
  g.fillStyle = C.bg2; g.fillRect(0, gh, w, R.velh); g.fillStyle = C.line; g.fillRect(0, gh, w, 1)
  g.fillStyle = C.text; g.fillText('VELOCITY', 4, gh + 14)
  for (const n of all) {
    const x = nx(n.t); if (x < R.kw || x > w) continue
    const vh = n.v * (R.velh - 8); g.fillStyle = tc(colorFor(n.by || '?'))
    g.fillRect(x, H - vh, 2, vh); g.fillRect(x - 2, H - vh, 6, 2)
  }
}
