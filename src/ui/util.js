import { C } from './theme.js'
// helper UI: manopole, menu, toast, canvas HiDPI
export const $ = (s, r = document) => r.querySelector(s)
export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const k in attrs) {
    if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k])
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k])
    else if (k === 'class') e.className = attrs[k]
    else if (k === 'html') e.innerHTML = attrs[k]
    else e.setAttribute(k, attrs[k])
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c))
  return e
}

export function toast (msg, ms = 2200) {
  const t = $('#toast'); t.textContent = '> ' + msg; t.style.display = 'block'
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.display = 'none' }, ms)
}

export function fitCanvas (cv) {
  const r = cv.getBoundingClientRect(); const d = devicePixelRatio || 1
  const w = Math.max(1, Math.round(r.width * d)); const hh = Math.max(1, Math.round(r.height * d))
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh }
  const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0)
  return { g, w: r.width, h: r.height }
}

let openMenu = null
export function menu (x, y, items) {
  closeMenu()
  const m = h('div', { class: 'menu' })
  for (const it of items) {
    if (it === '-') m.append(h('div', { class: 'sep' }))
    else if (it.header) m.append(h('div', { class: 'h' }, it.header))
    else if (it.code) m.append(h('div', { class: 'h code', title: 'clicca per copiare', onclick: (e) => { e.stopPropagation(); navigator.clipboard?.writeText(it.code); toast('COPIATO') } }, it.code))
    else m.append(h('div', { onclick: (e) => { e.stopPropagation(); closeMenu(); it.do() } }, it.label))
  }
  document.body.append(m)
  const r = m.getBoundingClientRect()
  m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'
  m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px'
  openMenu = m
  setTimeout(() => addEventListener('mousedown', onDoc), 0)
}
function onDoc (e) { if (openMenu && !openMenu.contains(e.target)) closeMenu() }
export function closeMenu () { openMenu?.remove(); openMenu = null; removeEventListener('mousedown', onDoc) }

// manopola: spec {label,min,max,def,unit,scale,options}; get() -> valore; set(v)
export function knob (spec, get, set, opts = {}) {
  const { label, min, max, def, unit = '', scale = 'lin', options, step } = spec
  const el = h('div', { class: 'knob', title: label })
  const lab = h('div', { class: 'l' }, label)
  const val = h('div', { class: 'v' })
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', 38); svg.setAttribute('height', 34)
  const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e }
  const A0 = Math.PI * 0.75; const A1 = Math.PI * 2.25; const R = 14; const cx = 19; const cy = 19
  const arc = (a, b) => { const p = (a) => [cx + R * Math.cos(a), cy + R * Math.sin(a)]; const [x0, y0] = p(a); const [x1, y1] = p(b); return `M${x0} ${y0} A${R} ${R} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x1} ${y1}` }
  mk('path', { d: arc(A0, A1), stroke: C.knobTrack, 'stroke-width': 3, fill: 'none' })
  const act = mk('path', { stroke: C.fg, 'stroke-width': 3, fill: 'none', style: C.glow ? `filter:drop-shadow(0 0 3px ${C.fg})` : '' })
  const modp = mk('path', { stroke: C.cyan, 'stroke-width': 2, fill: 'none', style: C.glow ? `filter:drop-shadow(0 0 3px ${C.cyan})` : '' })
  const tick = mk('line', { stroke: C.amber, 'stroke-width': 2 })
  mk('circle', { cx, cy, r: 8, fill: 'none', stroke: C.line, 'stroke-width': 1 })
  el.append(lab, svg, val)
  const toN = (v) => scale === 'log' ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)
  const fromN = (n) => { n = Math.max(0, Math.min(1, n)); let v = scale === 'log' ? min * Math.pow(max / min, n) : min + n * (max - min); if (options || step) v = Math.round(v / (step || 1)) * (step || 1); return v }
  const fmt = (v) => {
    if (options) return options[Math.round(v)] ?? v
    if (opts.fmt) return opts.fmt(v)
    const a = Math.abs(v)
    const s = unit === 'Hz' && a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 1 : 2) + 'k' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
    return s + (unit && !(unit === 'Hz' && a >= 1000) ? unit : unit === 'Hz' ? 'Hz' : '')
  }
  const draw = () => {
    const v = get() ?? def; const n = toN(v); const a = A0 + n * (A1 - A0)
    act.setAttribute('d', n > 0.002 ? arc(A0, Math.max(A0 + 0.01, a)) : '')
    tick.setAttribute('x1', cx + 4 * Math.cos(a)); tick.setAttribute('y1', cy + 4 * Math.sin(a))
    tick.setAttribute('x2', cx + 11 * Math.cos(a)); tick.setAttribute('y2', cy + 11 * Math.sin(a))
    val.textContent = fmt(v)
    drawMod()
  }
  // anello di modulazione (azzurro): opts.mod() -> offset normalizzato, oppure {abs: valore normalizzato assoluto}
  let lastM = null
  const drawMod = () => {
    if (!opts.mod) return
    const m = opts.mod()
    const key = m == null ? null : typeof m === 'object' ? 'a' + m.abs.toFixed(3) : m.toFixed(3)
    if (key === lastM) return
    lastM = key
    if (m == null || (typeof m === 'number' && Math.abs(m) < 0.002)) { modp.setAttribute('d', ''); el.classList.remove('mod'); return }
    const n = toN(get() ?? def)
    const n2 = Math.max(0, Math.min(1, typeof m === 'object' ? m.abs : n + m))
    const a = A0 + Math.min(n, n2) * (A1 - A0); const b = A0 + Math.max(n, n2) * (A1 - A0)
    const R2 = R - 4; const p = (x) => [cx + R2 * Math.cos(x), cy + R2 * Math.sin(x)]
    const [x0, y0] = p(a); const [x1, y1] = p(Math.max(a + 0.02, b))
    modp.setAttribute('d', `M${x0} ${y0} A${R2} ${R2} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x1} ${y1}`)
    el.classList.add('mod')
  }
  el.drawMod = drawMod
  let sy, sn
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); sy = e.clientY; sn = toN(get() ?? def)
    const mv = (ev) => { const d = (sy - ev.clientY) / (ev.shiftKey ? 800 : 160); const v = fromN(sn + d); set(v); draw() }
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up)
  })
  el.addEventListener('dblclick', () => { set(def); draw() })
  el.addEventListener('wheel', (e) => { e.preventDefault(); const n = toN(get() ?? def) - Math.sign(e.deltaY) * (options ? 1 / (max - min) : 0.02); set(fromN(n)); draw() }, { passive: false })
  el.draw = draw; draw()
  return el
}

export const noteName = (p) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][p % 12] + (Math.floor(p / 12) - 1)
export const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12)
export const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'ORA' : s < 3600 ? Math.floor(s / 60) + 'M' : s < 86400 ? Math.floor(s / 3600) + 'H' : Math.floor(s / 86400) + 'G' }
export const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
