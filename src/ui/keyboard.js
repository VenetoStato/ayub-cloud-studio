// Tastiera visuale + tastiera del computer + Web MIDI. Mostra anche cosa suonano gli altri operatori.
import { C, alpha, tc, glow, font } from './theme.js'
import { S, trackById, others } from '../state.js'
import { E, liveOn, liveOff, liveCC, liveBend } from '../audio/engine.js'
import { UI } from './ui.js'
import { $, fitCanvas, isBlack, noteName, toast, menu } from './util.js'

const LO = 36; const HI = 96 // C2..C7
const held = new Map() // sorgente+pitch -> trackId
let sustain = false; const sustained = new Set()
const target = () => E.armed && trackById(E.armed)?.get('kind') === 'inst' ? E.armed : UI.selTrack

export function noteOn (src, p, v) {
  const tid = target(); if (!tid || trackById(tid)?.get('kind') !== 'inst') return
  const key = src + p
  if (held.has(key)) return
  held.set(key, tid); sustained.delete(p)
  liveOn(tid, p, v); share()
}
export function noteOff (src, p) {
  const key = src + p; const tid = held.get(key); if (!tid) return
  held.delete(key)
  if (sustain && src === 'midi') { sustained.add(p + '|' + tid); return }
  liveOff(tid, p); share()
}
function pedal (on) {
  sustain = on
  if (!on) { for (const s of sustained) { const [p, tid] = s.split('|'); liveOff(tid, +p) } sustained.clear(); share() }
}
let shareT = 0
function share () {
  clearTimeout(shareT)
  shareT = setTimeout(() => S.awareness.setLocalStateField('keys', [...E.liveNotes.keys()]), 30)
}

// ---------------- tastiera pc (layout Ableton)
const MAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 }
export function pcKeyDown (e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  const k = e.key.toLowerCase()
  if (k === 'z') { UI.kOct = Math.max(0, UI.kOct - 1); upd(); return true }
  if (k === 'x') { UI.kOct = Math.min(8, UI.kOct + 1); upd(); return true }
  if (k === 'c') { UI.kVel = Math.max(1, UI.kVel - 20); upd(); return true }
  if (k === 'v') { UI.kVel = Math.min(127, UI.kVel + 20); upd(); return true }
  if (k in MAP) { if (!e.repeat) noteOn('pc', 12 * (UI.kOct + 1) + MAP[k], UI.kVel / 127); return true }
  return false
}
export function pcKeyUp (e) {
  const k = e.key.toLowerCase()
  if (k in MAP) { for (let o = 0; o <= 9; o++) noteOff('pc', 12 * (o + 1) + MAP[k]); return true }
  return false
}
function upd () { $('#kOct').textContent = UI.kOct; $('#kVel').textContent = UI.kVel }

// ---------------- MIDI: Web MIDI del browser + ponte dal server (tastiere collegate a questo PC)
const midiSt = { web: [], bridge: [], err: null, access: null }
// con più schede aperte risponde solo l'ultima usata (niente note doppie)
const tabId = Math.random().toString(36).slice(2)
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('ayub-midi') : null
let activeTab = true
const claim = () => { activeTab = true; bc?.postMessage(tabId) }
if (bc) bc.onmessage = (e) => { if (e.data !== tabId) activeTab = false }
addEventListener('focus', claim); addEventListener('pointerdown', claim); claim()

function midiStatus () {
  const st = $('#midiSt'); const all = [...new Set([...midiSt.web, ...midiSt.bridge])]
  st.textContent = all.length ? 'MIDI: ' + all.map(n => n.toUpperCase().replace(/ MIDI \d+$/, '').slice(0, 18)).join(', ') + (midiSt.web.length ? '' : ' (PONTE)') : midiSt.err ? 'MIDI: ' + midiSt.err : 'MIDI: NESSUN DEVICE'
  st.className = all.length ? '' : 'dim'
  st.style.cursor = 'pointer'; st.title = 'Clicca per la diagnostica MIDI'
}
export async function initMidi () {
  $('#midiSt').onclick = midiHelp
  await requestWebMidi()
  connectBridge()
  midiStatus()
}
async function requestWebMidi () {
  if (!navigator.requestMIDIAccess) { midiSt.err = 'BROWSER SENZA WEB MIDI'; return }
  try {
    const acc = await navigator.requestMIDIAccess()
    midiSt.access = acc
    const bind = () => {
      const ins = [...acc.inputs.values()]
      ins.forEach(i => { i.onmidimessage = (m) => onMidi(m, 'web') })
      midiSt.web = ins.map(i => i.name); midiStatus()
    }
    acc.onstatechange = (e) => { bind(); if (e.port.type === 'input') toast(`MIDI ${e.port.name} ${e.port.state === 'connected' ? 'CONNESSO' : 'SCOLLEGATO'}`) }
    bind(); midiSt.err = null
  } catch (e) { midiSt.err = 'PERMESSO NEGATO' }
}
let bridgeWs = null
function connectBridge () {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return // il ponte esiste solo sul PC dello studio
  const ws = new WebSocket(`ws://${location.host}/midi`)
  bridgeWs = ws
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.t === 'devices') {
      const prev = midiSt.bridge.join(); midiSt.bridge = m.devices; midiStatus()
      if (m.devices.join() !== prev && m.devices.length) toast('MIDI ' + m.devices.join(', ').toUpperCase() + ' COLLEGATA')
    } else if (m.t === 'midi' && !midiSt.web.length) onMidi({ data: m.d }, 'bridge') // se il browser vede già il MIDI, il ponte tace
  }
  ws.onclose = () => { if (bridgeWs === ws) setTimeout(connectBridge, 3000) }
}
function midiHelp (e) {
  const all = [...new Set([...midiSt.web, ...midiSt.bridge])]
  const ff = /firefox/i.test(navigator.userAgent)
  menu(e.clientX, e.clientY + 12, [
    { header: 'DIAGNOSTICA MIDI' },
    { header: 'BROWSER: ' + (midiSt.web.length ? midiSt.web.join(', ') : midiSt.err || 'NESSUN DEVICE') },
    { header: 'PONTE DAL PC: ' + (midiSt.bridge.length ? midiSt.bridge.join(', ') : ['localhost', '127.0.0.1'].includes(location.hostname) ? 'NESSUN DEVICE' : 'SOLO SUL PC DELLO STUDIO') },
    '-',
    { label: 'RIPROVA / RICHIEDI PERMESSO MIDI', do: async () => { await requestWebMidi(); midiStatus(); toast(all.length ? 'MIDI OK' : 'NESSUN DEVICE TROVATO') } },
    ...(ff && !midiSt.web.length ? [{ header: 'FIREFOX SNAP: NEL TERMINALE ESEGUI' }, { code: 'sudo snap connect firefox:alsa' }, { header: 'POI RIAVVIA FIREFOX E ACCETTA IL PERMESSO' }] : []),
    { header: 'LA TASTIERA SUONA LA TRACCIA SELEZIONATA (O QUELLA ARMATA ●)' }
  ])
}
function onMidi (m) {
  if (!activeTab) return
  const [s, d1, d2] = m.data; const cmd = s & 0xf0
  if (cmd === 0x90 && d2 > 0) noteOn('midi', d1, d2 / 127)
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff('midi', d1)
  else if (cmd === 0xb0 && d1 === 64) pedal(d2 >= 64)
  else if (cmd === 0xb0 && d1 === 1) { const t = target(); if (t) liveCC(t, 1, d2 / 127) }
  else if (cmd === 0xe0) { const t = target(); if (t) liveBend(t, ((d2 << 7 | d1) - 8192) / 8192) }
  else if (cmd === 0xb0 && (d1 === 123 || d1 === 120)) { for (const k of [...held.keys()]) noteOff('midi', +k.replace('midi', '')) }
}

// ---------------- disegno + mouse
let mouseP = null
export function initKbd () {
  const c = $('#kbdCv')
  c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); mouseP = keyAt(e.offsetX, e.offsetY); if (mouseP != null) noteOn('mouse', mouseP, Math.min(1, 0.4 + e.offsetY / c.clientHeight * 0.6)) })
  c.addEventListener('pointermove', (e) => { if (mouseP == null) return; const p = keyAt(e.offsetX, e.offsetY); if (p !== mouseP && p != null) { noteOff('mouse', mouseP); mouseP = p; noteOn('mouse', p, 0.7) } })
  c.addEventListener('pointerup', () => { if (mouseP != null) noteOff('mouse', mouseP); mouseP = null })
}
let geo = []
function keyAt (x, y) {
  for (const k of geo) if (k.b && x >= k.x && x <= k.x + k.w && y <= k.h) return k.p
  for (const k of geo) if (!k.b && x >= k.x && x <= k.x + k.w) return k.p
  return null
}
let kbdSig = ''
export function drawKbd () {
  const cvK = $('#kbdCv')
  const remoteSig = others().map(([, s]) => (s.keys || []).join('.') + s.user.color).join('|')
  const sig = C.name + [...E.liveNotes.keys()].join('.') + '/' + remoteSig + '/' + UI.kOct + '/' + target() + '/' + cvK.clientWidth + 'x' + cvK.clientHeight
  if (sig === kbdSig) return
  kbdSig = sig
  const { g, w, h: H } = fitCanvas(cvK)
  g.fillStyle = C.bg; g.fillRect(0, 0, w, H)
  const whites = []; for (let p = LO; p <= HI; p++) if (!isBlack(p)) whites.push(p)
  const ww = w / whites.length; geo = []
  const live = new Set(E.liveNotes.keys())
  const remote = new Map()
  for (const [, s] of others()) if (s.keys) for (const p of s.keys) remote.set(p, s.user.color)
  const kOctLo = 12 * (UI.kOct + 1)
  whites.forEach((p, i) => {
    const x = i * ww; geo.push({ p, x, w: ww, b: false })
    const on = live.has(p); const rc = remote.get(p)
    g.fillStyle = on ? C.fg : rc || C.keyW
    if (on || rc) { g.shadowColor = g.fillStyle; g.shadowBlur = glow(12) }
    g.fillRect(x + 1, 0, ww - 2, H - 2); g.shadowBlur = 0
    g.strokeStyle = C.line; g.strokeRect(x + 1.5, 0.5, ww - 3, H - 3)
    if (p >= kOctLo && p < kOctLo + 18) { g.fillStyle = C.amber; g.fillRect(x + 2, H - 5, ww - 4, 2) }
    if (p % 12 === 0) { g.fillStyle = on ? C.ink : C.text; g.font = font(10); g.fillText(noteName(p), x + 3, H - 9) }
  })
  for (let p = LO; p <= HI; p++) {
    if (!isBlack(p)) continue
    const wi = whites.indexOf(p - 1); const x = (wi + 1) * ww - ww * 0.3; const bw = ww * 0.6; const bh = H * 0.6
    geo.push({ p, x, w: bw, h: bh, b: true })
    const on = live.has(p); const rc = remote.get(p)
    g.fillStyle = on ? C.fg : rc || C.keyB
    g.fillRect(x, 0, bw, bh); g.strokeStyle = C.keyBLine; g.strokeRect(x + 0.5, 0.5, bw - 1, bh - 1)
  }
  const t = target() && trackById(target())
  $('#kTrack').textContent = t ? '→ ' + t.get('name') : '→ SELEZIONA TRACCIA'
}
