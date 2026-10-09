// Vista arrangement: righello, corsie, clip (MIDI + audio), loop, playhead, presenza altri operatori
import { C, alpha, tc, glow, font, trk } from './theme.js'
import { S, others, trackList, trackById, addClip, moveClip, deleteClip, duplicateClip, setTrack, deleteTrack, colorFor } from '../state.js'
import { E, playheadBeat, seek, setMonitor, armInput } from '../audio/engine.js'
import { UI, selectTrack, selectClip } from './ui.js'
import { $, h, fitCanvas, menu, toast, ago } from './util.js'

const cv = () => $('#arrCv')
let drag = null; let hover = null

export function initArrange () {
  const c = cv()
  c.addEventListener('pointerdown', onDown)
  c.addEventListener('pointermove', onMove)
  c.addEventListener('pointerup', onUp)
  c.addEventListener('dblclick', onDbl)
  c.addEventListener('contextmenu', onCtx)
  c.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const x = e.offsetX; const beat = (x + UI.sx) / UI.pxb
      UI.pxb = Math.max(4, Math.min(240, UI.pxb * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      UI.sx = Math.max(0, beat * UI.pxb - x)
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) UI.sx = Math.max(0, UI.sx + (e.deltaX || e.deltaY))
    else UI.sy = Math.max(0, Math.min(Math.max(0, trackList().length * UI.rowh - c.clientHeight + UI.ruler + 40), UI.sy + e.deltaY))
    draw(); syncHeads()
  }, { passive: false })
  $('#heads').addEventListener('wheel', (e) => { e.preventDefault(); UI.sy = Math.max(0, UI.sy + e.deltaY); syncHeads(); draw() }, { passive: false })
  new ResizeObserver(() => draw()).observe(c)
}

// ---------------- geometria
const bx = (b) => b * UI.pxb - UI.sx
const xb = (x) => (x + UI.sx) / UI.pxb
const rowY = (i) => UI.ruler + i * UI.rowh - UI.sy
const rowAt = (y) => Math.floor((y - UI.ruler + UI.sy) / UI.rowh)
const snap = (b, e) => e?.altKey ? b : Math.round(b / snapQ()) * snapQ()
const snapQ = () => UI.pxb > 60 ? 0.25 : UI.pxb > 20 ? 1 : 4

function clipAt (x, y) {
  const tl = trackList(); const r = rowAt(y); const t = tl[r]; if (!t) return null
  const b = xb(x)
  for (const c of S.clips.values()) {
    if (c.get('track') !== t.get('id')) continue
    if (b >= c.get('start') && b <= c.get('start') + c.get('len')) {
      const edge = bx(c.get('start') + c.get('len')) - x < 7
      return { c, edge }
    }
  }
  return null
}

function onDown (e) {
  const x = e.offsetX; const y = e.offsetY
  cv().setPointerCapture(e.pointerId)
  if (y < UI.ruler) {
    if (e.shiftKey) { const b = snap(xb(x)); drag = { mode: 'loop', a: b }; E.loop = { on: true, start: b, end: b + 4 }; $('#bLoop').classList.add('on') } else { seek(Math.max(0, snap(xb(x)))); drag = { mode: 'scrub' } }
    draw(); return
  }
  const hit = clipAt(x, y)
  const t = trackList()[rowAt(y)]
  if (t) selectTrack(t.get('id'))
  if (hit) {
    selectClip(hit.c.get('id'))
    if (hit.c.get('kind') === 'midi') window.dispatchEvent(new CustomEvent('ayub:openclip'))
    drag = { mode: hit.edge ? 'len' : 'move', id: hit.c.get('id'), x0: x, y0: y, start: hit.c.get('start'), len: hit.c.get('len'), track: hit.c.get('track'), moved: false }
  } else selectClip(null)
  draw()
}
function onMove (e) {
  const x = e.offsetX; const y = e.offsetY
  if (!drag) {
    const hit = y > UI.ruler && clipAt(x, y)
    cv().style.cursor = hit ? (hit.edge ? 'ew-resize' : 'grab') : y < UI.ruler ? 'pointer' : 'default'
    const nh = hit ? hit.c.get('id') : null
    if (nh !== hover) { hover = nh; draw() }
    return
  }
  if (drag.mode === 'scrub') { seek(Math.max(0, snap(xb(x)))); return }
  if (drag.mode === 'loop') {
    const b = snap(xb(x)); E.loop.start = Math.min(drag.a, b); E.loop.end = Math.max(drag.a, b) || drag.a + 4
    if (E.loop.end - E.loop.start < 0.25) E.loop.end = E.loop.start + 4
    draw(); return
  }
  const db = (x - drag.x0) / UI.pxb
  if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 3) drag.moved = true
  if (!drag.moved) return
  if (drag.mode === 'move') {
    drag.nstart = Math.max(0, snap(drag.start + db, e))
    const t = trackList()[rowAt(y)]; const src = trackById(drag.track)
    drag.ntrack = t && t.get('kind') === src.get('kind') ? t.get('id') : drag.track
  } else drag.nlen = Math.max(snapQ() / 4, snap(drag.len + db, e) || snapQ())
  draw()
}
function onUp () {
  if (drag && drag.moved) {
    const c = S.clips.get(drag.id)
    if (c && drag.mode === 'move') moveClip(drag.id, { start: drag.nstart, track: drag.ntrack }, `sposta clip ${c.get('name')} → ${(drag.nstart / 4 + 1).toFixed(2)}`)
    if (c && drag.mode === 'len') moveClip(drag.id, { len: drag.nlen }, `lunghezza clip ${c.get('name')} = ${drag.nlen} beat`)
  }
  drag = null; draw()
}
function onDbl (e) {
  if (e.offsetY < UI.ruler) return
  const hit = clipAt(e.offsetX, e.offsetY); if (hit) return
  const t = trackList()[rowAt(e.offsetY)]; if (!t) return
  if (t.get('kind') !== 'inst') return toast('LE TRACCE AUDIO SI REGISTRANO CON ● REC')
  const b = Math.floor(xb(e.offsetX) / 4) * 4
  const id = addClip(t.get('id'), b, 4)
  selectClip(id); window.dispatchEvent(new CustomEvent('ayub:openclip'))
}
function onCtx (e) {
  e.preventDefault()
  const hit = clipAt(e.offsetX, e.offsetY)
  if (hit) {
    const id = hit.c.get('id')
    menu(e.clientX, e.clientY, [
      { header: `CLIP · DI ${hit.c.get('author')} · MOD. ${hit.c.get('by')} ${ago(hit.c.get('at'))}` },
      { label: 'DUPLICA (CTRL+D)', do: () => selectClip(duplicateClip(id)) },
      { label: 'RINOMINA', do: () => { const n = prompt('Nome clip', hit.c.get('name')); if (n) moveClip(id, { name: n.toUpperCase() }, `rinomina clip → ${n}`) } },
      ...(hit.c.get('kind') === 'audio' ? [{ label: 'GAIN +3 DB', do: () => moveClip(id, { gain: (hit.c.get('gain') || 0) + 3 }, 'gain clip +3') }, { label: 'GAIN -3 DB', do: () => moveClip(id, { gain: (hit.c.get('gain') || 0) - 3 }, 'gain clip -3') }] : []),
      '-', { label: 'ELIMINA', do: () => deleteClip(id) }
    ])
  }
}

export function clipKeys (e) {
  if (!UI.selClip) return false
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteClip(UI.selClip); selectClip(null); return true }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); selectClip(duplicateClip(UI.selClip)); return true }
  return false
}

// ---------------- intestazioni tracce (DOM)
let headSig = ''
export function renderHeads () {
  const inner = $('#heads .inner')
  const pres = [...S.awareness.getStates().entries()].map(([c, s]) => c + ':' + (s.track || '') + (s.user?.name || '')).join()
  const sig = trackList().map(t => [t.get('id'), t.get('name'), t.get('mute'), t.get('solo'), t.get('by'), Math.floor((Date.now() - t.get('at')) / 60000), !!E.tracks.get(t.get('id'))?.mon].join('|')).join() + E.armed + pres
  if (sig === headSig) { for (const el of inner.children) el.classList.toggle('sel', el.dataset.id === UI.selTrack); syncHeads(); return }
  headSig = sig
  inner.innerHTML = ''
  for (const t of trackList()) {
    const id = t.get('id')
    const remote = [...new Map(others().filter(([, s]) => s.track === id).map(([, s]) => [s.user.name, s.user])).values()]
    const el = h('div', { 'data-id': id, class: 'th' + (UI.selTrack === id ? ' sel' : ''), style: { '--tc': trk(t.get('color')), height: UI.rowh + 'px' }, onmousedown: () => selectTrack(id) },
      h('div', { class: 'nm' },
        h('input', { value: t.get('name'), onchange: (e) => setTrack(id, 'name', e.target.value.toUpperCase(), `rinomina traccia → ${e.target.value}`), onmousedown: (e) => e.stopPropagation() }),
        h('span', { class: 'dim', style: { fontSize: '10px' } }, t.get('kind') === 'audio' ? 'AUDIO' : (t.get('instrument')?.get('type') || '').toUpperCase())),
      h('div', { class: 'meta' }, `DI ${t.get('author')} · MOD ${t.get('by')} ${ago(t.get('at'))}`, ...remote.map(u => h('span', { style: { color: tc(u.color), marginLeft: '6px' } }, '◆' + u.name))),
      h('div', { class: 'btns' },
        h('button', { class: t.get('mute') ? 'on amber' : 'amber', title: 'Mute', onclick: () => setTrack(id, 'mute', !t.get('mute'), `${t.get('name')} mute ${t.get('mute') ? 'OFF' : 'ON'}`) }, 'M'),
        h('button', { class: t.get('solo') ? 'on' : '', title: 'Solo', onclick: () => setTrack(id, 'solo', !t.get('solo'), `${t.get('name')} solo ${t.get('solo') ? 'OFF' : 'ON'}`) }, 'S'),
        h('button', { class: 'rec' + (E.armed === id ? ' on' : ''), title: 'Arma per registrazione', onclick: () => { E.armed = E.armed === id ? null : id; headSig = ''; renderHeads() } }, '●'),
        t.get('kind') === 'audio' ? h('button', { class: E.tracks.get(id)?.mon ? 'on' : '', title: 'Monitor ingresso (passa dagli effetti)', onclick: async () => { const err = await armInput(); if (err) return toast(err); setMonitor(id, !E.tracks.get(id)?.mon); headSig = ''; renderHeads() } }, 'MON') : null,
        h('button', { title: 'Elimina traccia', style: { marginLeft: 'auto' }, onclick: (e) => { e.stopPropagation(); if (confirm(`Eliminare la traccia ${t.get('name')} per TUTTI?`)) deleteTrack(id) } }, '✕')
      )
    )
    inner.append(el)
  }
  syncHeads()
}
function syncHeads () { $('#heads .inner').style.transform = `translateY(${-UI.sy}px)` }

// ---------------- disegno canvas
// disegno a due strati: statico (griglia, clip, righello) in cache + overlay (playhead) ogni fotogramma
let layer = null; let LW = 0; let LH = 0
export function draw () {
  const main = fitCanvas(cv())
  const d = devicePixelRatio || 1
  if (!layer) layer = document.createElement('canvas')
  if (layer.width !== cv().width || layer.height !== cv().height) { layer.width = cv().width; layer.height = cv().height }
  const g = layer.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0)
  const w = main.w; const H = main.h; LW = w; LH = H
  paintStatic(g, w, H)
  drawPlay()
}
export function drawPlay () {
  if (!layer) return draw()
  const c = cv(); const g = c.getContext('2d')
  if (c.width !== layer.width || c.height !== layer.height) return draw()
  const d = devicePixelRatio || 1
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(layer, 0, 0); g.setTransform(d, 0, 0, d, 0, 0)
  paintOverlay(g, LW, LH)
}
function paintOverlay (g, w, H) {
  // playhead remoti
  for (const [, s] of others()) {
    if (s.ph == null) continue
    const x = bx(s.ph); g.strokeStyle = tc(s.user.color); g.setLineDash([3, 4]); g.globalAlpha = 0.6
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.setLineDash([]); g.globalAlpha = 1
    g.fillStyle = tc(s.user.color); g.font = font(10); g.fillText(s.user.name, x + 3, UI.ruler + 10)
  }
  // playhead
  const px = Math.round(bx(playheadBeat())) + 0.5
  g.strokeStyle = E.recording ? C.red : C.fg; g.shadowColor = g.strokeStyle; g.shadowBlur = glow(8)
  g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.shadowBlur = 0
  g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 7); g.fill()
}
function paintStatic (g, w, H) {
  g.fillStyle = C.bg; g.fillRect(0, 0, w, H)
  const tl = trackList()
  // griglia
  const b0 = Math.floor(xb(0)); const b1 = Math.ceil(xb(w))
  const step = UI.pxb < 6 ? 16 : UI.pxb < 14 ? 4 : 1
  for (let b = Math.floor(b0 / step) * step; b <= b1; b += step) {
    const x = Math.round(bx(b)) + 0.5
    g.strokeStyle = b % 16 === 0 ? C.g3 : b % 4 === 0 ? C.g2 : C.g1
    g.beginPath(); g.moveTo(x, UI.ruler); g.lineTo(x, H); g.stroke()
  }
  // righe tracce
  tl.forEach((t, i) => {
    const y = rowY(i)
    if (t.get('id') === UI.selTrack) { g.fillStyle = alpha(C.fg, .04); g.fillRect(0, y, w, UI.rowh) }
    g.strokeStyle = C.g2; g.beginPath(); g.moveTo(0, y + UI.rowh + 0.5); g.lineTo(w, y + UI.rowh + 0.5); g.stroke()
  })
  // loop
  if (E.loop.on) {
    const x0 = bx(E.loop.start); const x1 = bx(E.loop.end)
    g.fillStyle = alpha(C.amber, .05); g.fillRect(x0, UI.ruler, x1 - x0, H)
  }
  // clip
  const remoteSel = new Map()
  for (const [, s] of others()) if (s.clip) remoteSel.set(s.clip, s.user)
  for (const c of S.clips.values()) {
    const i = tl.findIndex(t => t.get('id') === c.get('track')); if (i < 0) continue
    let start = c.get('start'); let len = c.get('len'); let row = i
    if (drag?.moved && drag.id === c.get('id')) {
      if (drag.mode === 'move') { start = drag.nstart; row = tl.findIndex(t => t.get('id') === drag.ntrack) } else len = drag.nlen
    }
    const x = bx(start); const cw = len * UI.pxb; const y = rowY(row) + 3; const ch = UI.rowh - 6
    if (x > w || x + cw < 0 || y > H || y + ch < UI.ruler) continue
    drawClip(g, c, tl[row], x, y, cw, ch, c.get('id') === UI.selClip, remoteSel.get(c.get('id')))
  }
  // righello
  g.fillStyle = C.bg2; g.fillRect(0, 0, w, UI.ruler)
  g.strokeStyle = C.line; g.beginPath(); g.moveTo(0, UI.ruler - 0.5); g.lineTo(w, UI.ruler - 0.5); g.stroke()
  g.font = font(12); g.fillStyle = C.text
  const lab = UI.pxb < 6 ? 16 : UI.pxb < 14 ? 8 : 4
  for (let b = Math.floor(b0 / lab) * lab; b <= b1; b += lab) {
    const x = bx(b); g.fillRect(x, UI.ruler - 8, 1, 8); g.fillText(String(b / 4 + 1), x + 3, 14)
  }
  if (E.loop.on) {
    const x0 = bx(E.loop.start); const x1 = bx(E.loop.end)
    g.fillStyle = C.amber; g.fillRect(x0, UI.ruler - 5, x1 - x0, 4)
    g.fillRect(x0, 2, 1, UI.ruler - 4); g.fillRect(x1 - 1, 2, 1, UI.ruler - 4)
  }
  if (!tl.length) {
    g.fillStyle = C.text; g.font = font(22, true); g.fillText(C.empty, 30, UI.ruler + 50)
  }
}

function drawClip (g, c, t, x, y, w, hh, sel, remote) {
  const col = trk(t.get('color'))
  g.save(); g.beginPath(); g.rect(x, y, w, hh); g.clip()
  g.fillStyle = sel ? alpha(C.fg, .14) : alpha(C.fg, .05); g.fillRect(x, y, w, hh)
  g.fillStyle = col; g.globalAlpha = 0.85; g.fillRect(x, y, w, 13); g.globalAlpha = 1
  g.fillStyle = C.ink; g.font = font(11)
  g.fillText(`${c.get('name')}`, x + 4, y + 10)
  // tag autore (in alto a dx)
  const by = c.get('by'); const tag = '◆' + by
  const tw = g.measureText(tag).width
  if (w > tw + 60) { g.fillStyle = C.bg; g.fillRect(x + w - tw - 8, y + 1, tw + 6, 11); g.fillStyle = tc(colorFor(by)); g.fillText(tag, x + w - tw - 5, y + 10) }
  // contenuto
  const iy = y + 15; const ih = hh - 17
  if (c.get('kind') === 'midi') {
    const notes = [...(c.get('notes')?.values() || [])]
    if (notes.length) {
      let lo = 127; let hi = 0; for (const n of notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p) }
      lo -= 1; hi += 1; const rh = Math.max(1.5, Math.min(5, ih / (hi - lo + 1)))
      for (const n of notes) {
        if (n.t >= c.get('len')) continue
        g.fillStyle = tc(colorFor(n.by || by))
        const ny = iy + ih - ((n.p - lo) / (hi - lo + 1)) * ih - rh
        g.fillRect(x + n.t * UI.pxb, ny, Math.max(2, Math.min(n.d, c.get('len') - n.t) * UI.pxb - 1), rh)
      }
    }
  } else {
    const pk = E.peaks.get(c.get('file'))
    if (pk) {
      g.strokeStyle = col; g.beginPath()
      const spbv = 60 / (S.project.get('bpm') || 120)
      const off = c.get('offset') || 0; const gain = Math.pow(10, (c.get('gain') || 0) / 20)
      for (let px = 0; px < w; px++) {
        const sec = off + (px / UI.pxb) * spbv; const i = Math.floor(sec * pk.sr / pk.per)
        if (i >= pk.data.length) break
        const v = Math.min(1, pk.data[i] * gain) * ih / 2
        g.moveTo(x + px + 0.5, iy + ih / 2 - v); g.lineTo(x + px + 0.5, iy + ih / 2 + v)
      }
      g.stroke()
    } else { g.fillStyle = C.dim; g.fillText('CARICAMENTO...', x + 4, iy + 14) }
  }
  g.restore()
  g.strokeStyle = sel ? C.fg : col; g.lineWidth = sel ? 2 : 1
  g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1); g.lineWidth = 1
  if (remote) {
    g.strokeStyle = tc(remote.color); g.setLineDash([4, 3]); g.strokeRect(x - 1.5, y - 1.5, w + 3, hh + 3); g.setLineDash([])
    g.fillStyle = tc(remote.color); g.font = font(10); g.fillText('◆' + remote.name + ' QUI', x + 4, y + hh - 4)
  }
}
