// Mixer: strisce canale con meter, fader, pan, M/S
import { C, alpha, tc, glow, font } from './theme.js'
import { trackList, setParam, setTrack } from '../state.js'
import { E } from '../audio/engine.js'
import { UI, selectTrack } from './ui.js'
import { $, h, knob, fitCanvas } from './util.js'

let meters = []
export function renderMixer () {
  const root = $('#mixer'); root.innerHTML = ''; meters = []
  for (const t of trackList()) {
    const id = t.get('id')
    const db = h('div', { class: 'db' }, t.get('vol').toFixed(1) + ' dB')
    const fader = h('input', { type: 'range', min: -60, max: 6, step: 0.1, value: t.get('vol'), oninput: (e) => { setParamTrack(t, 'vol', +e.target.value); db.textContent = (+e.target.value).toFixed(1) + ' dB' }, ondblclick: (e) => { e.target.value = 0; setParamTrack(t, 'vol', 0) } })
    const m = h('canvas', {}); meters.push({ cv: m, get: () => E.tracks.get(id)?.meter })
    const pan = knob({ label: 'PAN', min: -1, max: 1, def: 0 }, () => t.get('pan'), (v) => setParamTrack(t, 'pan', v), { fmt: (v) => Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100) })
    root.append(h('div', { 'data-id': id, class: 'strip' + (UI.selTrack === id ? ' frame' : ''), style: { '--tc': t.get('color') }, onmousedown: () => selectTrack(id) },
      h('div', { class: 'n' }, t.get('name')), pan,
      h('div', { class: 'fz' }, fader, m), db,
      h('div', { class: 'b' },
        h('button', { class: 'amber' + (t.get('mute') ? ' on' : ''), onclick: () => setParamTrack(t, 'mute', !t.get('mute'), true) }, 'M'),
        h('button', { class: t.get('solo') ? 'on' : '', onclick: () => setParamTrack(t, 'solo', !t.get('solo'), true) }, 'S')),
      h('div', { class: 'dim', style: { fontSize: '9px' } }, '◆' + t.get('by'))))
  }
  const mdb = h('div', { class: 'db' }, '0.0 dB')
  const mm = h('canvas', {}); meters.push({ cv: mm, get: () => E.masterMeter, stereo: true })
  root.append(h('div', { class: 'strip frame', style: { '--tc': C.amber } }, h('div', { class: 'n' }, 'MASTER'),
    h('div', { class: 'fz' }, h('input', { type: 'range', min: -60, max: 6, step: 0.1, value: E.master.volume.value, oninput: (e) => { E.master.volume.value = +e.target.value; mdb.textContent = (+e.target.value).toFixed(1) + ' dB' } }), mm), mdb,
    h('div', { class: 'dim', style: { fontSize: '9px' } }, 'LIMITER -0.5')))
}
export function drawMeters () {
  if (UI.tab !== 'mixer') return
  for (const m of meters) {
    const mt = m.get(); if (!mt) continue
    let v = mt.getValue(); if (Array.isArray(v)) v = Math.max(...v)
    const { g, w, h: H } = fitCanvas(m.cv)
    g.fillStyle = C.panel; g.fillRect(0, 0, w, H)
    const n = Math.max(0, Math.min(1, (v + 60) / 66)); const segs = 24
    for (let i = 0; i < segs; i++) {
      const on = i / segs < n; const y = H - (i + 1) * (H / segs)
      g.fillStyle = on ? (i > segs - 3 ? C.red : i > segs - 7 ? C.amber : C.fg) : C.g1
      g.fillRect(1, y + 1, w - 2, H / segs - 2)
    }
  }
}
function setParamTrack (t, k, v, discrete) {
  if (discrete) return setTrack(t.get('id'), k, v, `${t.get('name')} ${k} ${v ? 'ON' : 'OFF'}`)
  setParam(t, k, v, `${t.get('name')}: ${k === 'vol' ? 'volume' : 'pan'}`, { track: t.get('id'), chan: true })
}
