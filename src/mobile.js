// AYUB STUDIO — versione mobile: tastiera touch, drum machine con step sequencer, registratore voce.
// Stesso progetto condiviso del desktop: tutto quello che registri qui arriva agli altri, firmato col tuo nome.
import { S, connect, onChange, trackList, trackById, addTrack, addClip, putNotes, delNotes, deleteClip, act, uid, setLocalParamHook, others, setInstrument } from './state.js'
import { E, initAudio, resumeAudio, syncGraph, syncClips, applyLocal, play, stop, seek, startRecording, stopRecording, playheadBeat, liveOn, liveOff, armInput } from './audio/engine.js'
import { INSTRUMENTS, PRESETS, presetFx, DRUM_LABELS } from './audio/instruments.js'
import { C, initTheme, tc, font, alpha } from './ui/theme.js'
import { $, h, toast, fitCanvas, isBlack, noteName, menu, hhmm } from './ui/util.js'

initTheme()
const me = await fetch('/api/me').then(r => r.ok ? r.json() : null)
if (!me) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('login') }

const M = { mode: 'keys', track: null, oct: 4, sustain: false, velTouch: true, pad: 36, withBase: true, recStart: 0 }
const params = new URLSearchParams(location.search)
const pid = params.get('p')

function start () {
  window.AYUB = { E, S, M }
  setLocalParamHook((local, key, val) => applyLocal(local, key, val))
  syncGraph(); syncClips()
  onChange((what) => {
    if (what.includes('tracks') || what.includes('project')) { syncGraph(S.dirtyAll ? null : new Set(S.dirtyTracks)); S.dirtyTracks.clear(); S.dirtyAll = false; renderTracks() }
    if (what.includes('clips')) { syncClips(); if (M.mode === 'drums') renderSteps(); if (M.mode === 'voice') renderTakes() }
    if (what.includes('project')) $('#mBpm').value = S.project.get('bpm')
  })
  $('#mBpm').value = S.project.get('bpm') || 120
  $('#mBpm').onchange = (e) => { const v = Math.max(40, Math.min(240, +e.target.value || 120)); act(`BPM → ${v} (mobile)`, () => S.project.set('bpm', v)) }
  $('#mPlay').onclick = () => { E.playing ? stop() : play(); ui() }
  $('#mStop').onclick = () => { stop(); ui() }
  $('#mRec').onclick = toggleRec
  $('#mMetro').onclick = () => { E.metro = !E.metro; ui() }
  $('#mMenu').onclick = (e) => menu(e.clientX - 220, e.clientY + 10, [
    { header: `OPERATORE ${me.name}` },
    { label: 'ANNULLA MIA ULTIMA MODIFICA', do: () => S.undo.undo() },
    { label: 'ALTRI PROGETTI', do: () => { location.href = '/mobile.html' } },
    { label: 'VERSIONE COMPUTER', do: () => { location.href = '/?desktop=1&p=' + pid } }
  ])
  document.querySelectorAll('#mModes button').forEach(b => { b.onclick = () => setMode(b.dataset.m) })
  E.metro = false
  setMode('keys')
  requestAnimationFrame(loop)
  addEventListener('resize', () => render())
}

function ui () {
  $('#mPlay').classList.toggle('on', E.playing)
  $('#mRec').classList.toggle('on', E.recording)
  $('#mMetro').classList.toggle('on', E.metro)
  if (M.mode === 'voice') renderVoiceState()
}
async function toggleRec () {
  if (E.recording) { stopRecording(); if (E.playing) stop(); ui(); return }
  if (!M.track) return toast('SCEGLI UNA TRACCIA')
  E.armed = M.track; E.sel = M.track
  const err = await startRecording(); if (err) toast(err)
  M.recStart = performance.now(); ui()
}

// ---------------------------------------------------------------- tracce (filtrate per modalità)
function wanted (t) {
  if (M.mode === 'voice') return t.get('kind') === 'audio'
  if (M.mode === 'drums') return t.get('instrument')?.get('type') === 'drums'
  return t.get('kind') === 'inst' && t.get('instrument')?.get('type') !== 'drums'
}
function renderTracks () {
  const nav = $('#mTracks'); nav.innerHTML = ''
  const list = trackList().filter(wanted)
  if (!list.find(t => t.get('id') === M.track)) M.track = list[0]?.get('id') || null
  E.sel = M.track
  for (const t of list) {
    const inst = t.get('instrument')
    nav.append(h('button', { class: t.get('id') === M.track ? 'on' : '', style: { '--tc': t.get('color') }, onclick: () => { M.track = t.get('id'); E.sel = M.track; renderTracks(); render() } },
      t.get('name'), h('small', {}, inst ? (inst.get('preset') || inst.get('type')).toUpperCase() : 'AUDIO')))
  }
  const add = M.mode === 'voice' ? ['audio', 'VOCE'] : M.mode === 'drums' ? ['drums', '808 SYNTH'] : ['wave', 'SERUM SUPERSAW']
  nav.append(h('button', { onclick: () => {
    const name = (M.mode === 'voice' ? 'VOCE ' : M.mode === 'drums' ? 'DRUM ' : 'SYNTH ') + me.name.slice(0, 6)
    M.track = add[0] === 'audio' ? addTrack({ kind: 'audio', name }) : addTrack({ name, instrument: add[0], preset: add[1], params: { ...INSTRUMENTS[add[0]].defaults, ...(PRESETS[add[0]][add[1]] || {}) }, fx: presetFx(add[0], add[1]) })
    renderTracks(); render()
  } }, '+ ' + (M.mode === 'voice' ? 'TRACCIA VOCE' : M.mode === 'drums' ? 'DRUM' : 'SYNTH')))
}
function setMode (m) {
  M.mode = m
  document.querySelectorAll('#mModes button').forEach(b => b.classList.toggle('on', b.dataset.m === m))
  renderTracks(); render()
}
function render () {
  const body = $('#mBody'); body.innerHTML = ''
  if (M.mode === 'keys') renderKeys(body)
  else if (M.mode === 'drums') renderDrums(body)
  else renderVoice(body)
}

// ---------------------------------------------------------------- TASTIERA touch
const touches = new Map() // pointerId -> nota
let kgeo = []; let kcv = null; let kdirty = true
function renderKeys (body) {
  const t = M.track && trackById(M.track)
  const instName = t?.get('instrument') ? (t.get('instrument').get('preset') || t.get('instrument').get('type')) : '—'
  const presets = t?.get('instrument') ? Object.keys(PRESETS[t.get('instrument').get('type')] || {}) : []
  const sel = h('select', { onchange: (e) => { const ty = t.get('instrument').get('type'); const pr = e.target.value; setInstrument(M.track, ty, { ...INSTRUMENTS[ty].defaults, ...PRESETS[ty][pr] }, pr, presetFx(ty, pr)) } },
    ...presets.map(p => { const o = h('option', { value: p }, p); if (p === instName) o.selected = true; return o }))
  kcv = h('canvas')
  const panel = h('div', { class: 'kpanel' },
    h('div', { class: 'kbar' },
      h('button', { onclick: () => { M.oct = Math.max(0, M.oct - 1); kdirty = true; octLbl.textContent = 'C' + (M.oct) } }, '◀ OTT'),
      (octLbl = h('span', { class: 'amb' }, 'C' + M.oct)),
      h('button', { onclick: () => { M.oct = Math.min(7, M.oct + 1); kdirty = true; octLbl.textContent = 'C' + (M.oct) } }, 'OTT ▶'),
      h('button', { class: M.sustain ? 'on' : '', onclick: (e) => { M.sustain = !M.sustain; e.target.classList.toggle('on', M.sustain); if (!M.sustain) releaseSustained() } }, 'SUSTAIN'),
      h('button', { class: M.velTouch ? 'on' : '', title: 'Velocity in base a dove tocchi il tasto', onclick: (e) => { M.velTouch = !M.velTouch; e.target.classList.toggle('on', M.velTouch) } }, 'VEL'),
      sel),
    h('div', { class: 'kwrap' }, kcv))
  body.append(panel)
  kcv.addEventListener('pointerdown', kDown); kcv.addEventListener('pointermove', kMove)
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) kcv.addEventListener(ev, kUp)
  kdirty = true
}
let octLbl = null
const sustained = new Set()
function releaseSustained () { for (const p of sustained) liveOff(M.track, p); sustained.clear(); kdirty = true }
function keyAt (x, y) {
  for (const k of kgeo) if (k.b && x >= k.x && x <= k.x + k.w && y <= k.h) return k
  for (const k of kgeo) if (!k.b && x >= k.x && x <= k.x + k.w) return k
  return null
}
function velOf (k, y) { if (!M.velTouch) return 0.8; const hgt = k.b ? k.h : kcv.clientHeight; return Math.max(0.15, Math.min(1, 0.25 + 0.75 * (y / hgt))) }
function kDown (e) {
  e.preventDefault(); try { kcv.setPointerCapture(e.pointerId) } catch {}
  const r = kcv.getBoundingClientRect(); const k = keyAt(e.clientX - r.left, e.clientY - r.top); if (!k || !M.track) return
  touches.set(e.pointerId, k.p); sustained.delete(k.p)
  liveOn(M.track, k.p, velOf(k, e.clientY - r.top)); share(); kdirty = true
}
function kMove (e) {
  if (!touches.has(e.pointerId)) return
  const r = kcv.getBoundingClientRect(); const k = keyAt(e.clientX - r.left, e.clientY - r.top)
  const prev = touches.get(e.pointerId)
  if (k && k.p !== prev) { // glissando
    touches.set(e.pointerId, k.p); off(prev); liveOn(M.track, k.p, velOf(k, e.clientY - r.top)); share(); kdirty = true
  }
}
function kUp (e) { const p = touches.get(e.pointerId); if (p == null) return; touches.delete(e.pointerId); off(p); share(); kdirty = true }
function off (p) { if ([...touches.values()].includes(p)) return; if (M.sustain) sustained.add(p); else liveOff(M.track, p) }
let shareT = 0
function share () { clearTimeout(shareT); shareT = setTimeout(() => S.awareness.setLocalStateField('keys', [...E.liveNotes.keys()]), 30) }
function drawKeys () {
  if (!kcv || !kcv.isConnected) return
  const { g, w, h: H } = fitCanvas(kcv)
  const span = w > 700 ? 24 : w > 420 ? 17 : 12 // tasti bianchi visibili in base alla larghezza
  const lo = 12 * (M.oct + 1)
  const whites = []; for (let p = lo; whites.length < span; p++) if (!isBlack(p)) whites.push(p)
  const ww = w / whites.length; kgeo = []
  const live = new Set(E.liveNotes.keys()); const sus = sustained
  const remote = new Map(); for (const [, s] of others()) if (s.keys) for (const p of s.keys) remote.set(p, tc(s.user.color))
  g.fillStyle = C.bg; g.fillRect(0, 0, w, H)
  whites.forEach((p, i) => {
    const x = i * ww; kgeo.push({ p, x, w: ww, b: false })
    const on = live.has(p) || sus.has(p)
    g.fillStyle = on ? C.fg : remote.get(p) || C.keyW; g.fillRect(x + 1, 0, ww - 2, H - 2)
    g.strokeStyle = C.line; g.strokeRect(x + 1.5, 0.5, ww - 3, H - 3)
    if (p % 12 === 0) { g.fillStyle = on ? C.ink : C.text; g.font = font(12); g.fillText(noteName(p), x + 5, H - 10) }
  })
  for (let i = 0; i < whites.length - 1; i++) {
    const p = whites[i] + 1; if (!isBlack(p)) continue
    const x = (i + 1) * ww - ww * 0.3; const bw = ww * 0.6; const bh = H * 0.6
    kgeo.push({ p, x, w: bw, h: bh, b: true })
    const on = live.has(p) || sus.has(p)
    g.fillStyle = on ? C.fg : remote.get(p) || C.keyB; g.fillRect(x, 0, bw, bh); g.strokeStyle = C.keyBLine; g.strokeRect(x + 0.5, 0.5, bw - 1, bh - 1)
  }
}

// ---------------------------------------------------------------- DRUM MACHINE
const PADS = [49, 51, 46, 42, 48, 45, 41, 44, 39, 37, 40, 56, 36, 38, 35, 57]
const PAD_NAME = { ...DRUM_LABELS, 35: 'KICK 2', 40: 'SNARE 2', 57: 'CRASH 2' }
let stepEls = []; let padEls = new Map()
function renderDrums (body) {
  const t = M.track && trackById(M.track)
  if (!t) { body.append(h('div', { class: 'vpanel' }, h('div', { class: 'vwarn' }, 'Nessuna traccia batteria: crea "+ DRUM" qui sopra.'))); return }
  M.bar = Math.floor(Math.max(0, playheadBeat()) / 4) * 4
  const pads = h('div', { class: 'pads' })
  padEls = new Map()
  for (const p of PADS) {
    const el = h('div', { class: 'pad' + (p === M.pad ? ' sel' : '') }, PAD_NAME[p] || noteName(p), h('i', {}, p))
    const hit = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(); const v = Math.max(0.25, Math.min(1, 0.35 + 0.65 * ((e.clientY - r.top) / r.height)))
      liveOn(M.track, p, v); setTimeout(() => liveOff(M.track, p), 120)
      el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 90)
      if (M.pad !== p) { M.pad = p; padEls.forEach((x, k) => x.classList.toggle('sel', k === p)); renderSteps() }
    }
    el.addEventListener('pointerdown', hit)
    padEls.set(p, el); pads.append(el)
  }
  const steps = h('div', { class: 'steps' })
  stepEls = []
  for (let i = 0; i < 16; i++) {
    const s = h('div', { class: 'step' + (i % 4 === 0 ? ' q' : '') })
    s.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleStep(i) })
    stepEls.push(s); steps.append(s)
  }
  body.append(h('div', { class: 'dpanel' },
    h('div', { class: 'dinfo' }, h('button', { onclick: () => { M.bar = Math.max(0, M.bar - 4); renderSteps() } }, '◀'), h('span', { id: 'dInfo', style: { flex: 1 } }, ''), h('button', { onclick: () => { M.bar += 4; renderSteps() } }, '▶'), h('button', { onclick: () => clearPad() }, 'SVUOTA')),
    pads, steps))
  renderSteps()
}
// battuta di lavoro dello step sequencer: quella sotto il cursore
const workBar = () => M.bar
function patternClip (create) {
  const bar = workBar()
  for (const c of S.clips.values()) if (c.get('track') === M.track && c.get('kind') === 'midi' && c.get('start') <= bar && c.get('start') + c.get('len') > bar) return c
  if (!create) return null
  const id = addClip(M.track, bar, 4, { name: 'PATTERN ' + me.name }); return S.clips.get(id)
}
function stepNotes (c) {
  const res = new Array(16).fill(null)
  if (!c) return res
  const off = workBar() - c.get('start')
  for (const n of c.get('notes').values()) {
    if (n.p !== M.pad) continue
    const i = Math.round((n.t - off) * 4); if (i >= 0 && i < 16 && Math.abs((n.t - off) * 4 - i) < 0.2) res[i] = n
  }
  return res
}
function toggleStep (i) {
  const c = patternClip(true); const cur = stepNotes(c)[i]
  const off = workBar() - c.get('start')
  if (cur) delNotes(c.get('id'), [cur.id], `- step ${i + 1} ${PAD_NAME[M.pad]} (mobile)`)
  else { putNotes(c.get('id'), [{ id: uid(), p: M.pad, t: off + i / 4, d: 0.25, v: 0.85 }], `+ step ${i + 1} ${PAD_NAME[M.pad]} (mobile)`); liveOn(M.track, M.pad, 0.85); setTimeout(() => liveOff(M.track, M.pad), 100) }
}
function clearPad () {
  const c = patternClip(false); if (!c) return
  const ids = stepNotes(c).filter(Boolean).map(n => n.id)
  if (ids.length) delNotes(c.get('id'), ids, `svuota ${PAD_NAME[M.pad]} (mobile)`)
}
function renderSteps () {
  if (!stepEls.length || !stepEls[0].isConnected) return
  const c = patternClip(false); const st = stepNotes(c)
  st.forEach((n, i) => stepEls[i].classList.toggle('on', !!n))
  const info = document.getElementById('dInfo')
  if (info) info.textContent = `${PAD_NAME[M.pad] || M.pad} · BATTUTA ${workBar() / 4 + 1}` + (c ? ` · CLIP DI ${c.get('author')}` : ' · TOCCA UNO STEP PER CREARE IL PATTERN')
}
let lastStep = -1
function drawSteps () {
  if (!stepEls.length || !stepEls[0].isConnected) return
  const b = playheadBeat(); const s = E.playing && b >= M.bar && b < M.bar + 4 ? Math.floor((b - M.bar) * 4) : -1
  if (s !== lastStep) { stepEls.forEach((el, i) => el.classList.toggle('now', i === s)); lastStep = s }
}

// ---------------------------------------------------------------- REGISTRATORE VOCE
let vMeter = null; let vTime = null; let vBtn = null
function renderVoice (body) {
  const secure = window.isSecureContext
  vBtn = h('button', { class: 'vbtn', onclick: voiceRec }, 'REC')
  vTime = h('div', { class: 'vtime' }, '00:00')
  vMeter = h('div'); const meter = h('div', { class: 'vmeter' }, vMeter)
  const t = M.track && trackById(M.track)
  body.append(h('div', { class: 'vpanel' },
    !secure ? h('div', { class: 'vwarn' }, 'Il microfono funziona solo in HTTPS: apri lo studio dal link https (tunnel o server), non dall\'indirizzo http della rete locale.') : null,
    !t ? h('div', { class: 'vwarn' }, 'Crea una "+ TRACCIA VOCE" qui sopra.') : null,
    vBtn, vTime, meter,
    h('div', { class: 'vopts' },
      h('button', { class: M.withBase ? 'on' : '', onclick: (e) => { M.withBase = !M.withBase; e.target.classList.toggle('on', M.withBase) } }, 'CON LA BASE'),
      h('button', { class: E.metro ? 'on' : '', onclick: (e) => { E.metro = !E.metro; e.target.classList.toggle('on', E.metro); ui() } }, 'METRONOMO'),
      h('button', { onclick: () => { seek(0); toast('DALL\'INIZIO') } }, '⏮ INIZIO')),
    h('div', { class: 'vtakes', id: 'vTakes' })))
  renderTakes(); renderVoiceState()
  armInput().then(err => { if (err) toast(err) })
}
async function voiceRec () {
  if (E.recording) { stopRecording(); stop(); ui(); toast('TAKE IN CARICAMENTO...'); return }
  if (!M.track) return toast('CREA UNA TRACCIA VOCE')
  E.armed = M.track; E.sel = M.track
  // senza base: registra a volume zero (il trasporto serve a posizionare la take)
  E.master.volume.value = M.withBase ? 0 : -Infinity
  const err = await startRecording(); if (err) { toast(err); E.master.volume.value = 0; return }
  M.recStart = performance.now(); ui()
}
function renderVoiceState () {
  if (!vBtn?.isConnected) return
  vBtn.classList.toggle('on', E.recording); vBtn.textContent = E.recording ? 'STOP' : 'REC'
  if (!E.recording) E.master.volume.value = 0
}
function renderTakes () {
  const box = document.getElementById('vTakes'); if (!box) return
  box.innerHTML = ''
  const takes = [...S.clips.values()].filter(c => c.get('kind') === 'audio' && c.get('track') === M.track).sort((a, b) => b.get('at') - a.get('at'))
  if (!takes.length) box.append(h('div', { class: 'dim', style: { textAlign: 'center' } }, 'NESSUNA TAKE SU QUESTA TRACCIA'))
  for (const c of takes) {
    const dur = c.get('len') * 60 / (S.project.get('bpm') || 120)
    box.append(h('div', { class: 'vtake' },
      h('span', {}, c.get('name'), h('small', {}, `${c.get('author')} · ${hhmm(c.get('at'))} · ${dur.toFixed(1)}s · BATT. ${(c.get('start') / 4 + 1).toFixed(1)}`)),
      h('button', { onclick: () => { seek(c.get('start')); play(); ui() } }, '▶'),
      c.get('author') === me.name ? h('button', { onclick: () => { if (confirm('Eliminare la take?')) deleteClip(c.get('id')) } }, '✕') : null))
  }
}

// ---------------------------------------------------------------- loop
let lastPh = 0
function loop () {
  requestAnimationFrame(loop)
  const b = playheadBeat()
  $('#mPos').textContent = `${String(Math.floor(b / 4) + 1).padStart(3, '0')}.${Math.floor(b % 4) + 1}`
  if (M.mode === 'keys' && (kdirty || E.playing || others().length)) { drawKeys(); kdirty = false }
  if (M.mode === 'drums') drawSteps()
  if (M.mode === 'voice' && vMeter?.isConnected) {
    const v = E.inputMeter ? E.inputMeter.getValue() : -100
    vMeter.style.width = Math.max(0, Math.min(100, (v + 60) / 60 * 100)) + '%'
    if (E.recording) { const s = Math.floor((performance.now() - M.recStart) / 1000); vTime.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
  }
  const now = performance.now()
  if (now - lastPh > 300) { lastPh = now; ui(); const ph = E.playing ? Math.round(b * 100) / 100 : null; if (S.awareness.getLocalState()?.ph !== ph) S.awareness.setLocalStateField('ph', ph) }
}
void alpha

// ---------------------------------------------------------------- avvio
async function boot () {
if (!pid) {
  const list = await fetch('/api/projects').then(r => r.json())
  document.body.append(h('div', { class: 'mstart' }, h('div', { class: 'box frame' },
    h('h1', {}, C.name === 'alien' ? 'INTERFACE 2037' : C.title), h('div', { class: 'dim' }, `OPERATORE ${me.name} · SCEGLI IL PROGETTO`),
    ...list.map(p => h('div', { class: 'p', onclick: () => { location.href = '/mobile.html?p=' + p.id } }, h('span', {}, '> ' + p.name), h('small', { class: 'dim' }, p.by))),
    !list.length ? h('div', { class: 'dim', style: { padding: '10px 0' } }, 'NESSUN PROGETTO: CREALO DAL COMPUTER O QUI SOTTO.') : null,
    h('button', { class: 'go', onclick: async () => { const name = prompt('Nome del progetto', 'IDEA ' + new Date().toLocaleDateString('it-IT')); if (!name) return; const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.toUpperCase() }) }).then(r => r.json()); location.href = '/mobile.html?p=' + r.id } }, '+ NUOVO PROGETTO'),
    h('button', { style: { marginTop: '10px', width: '100%' }, onclick: () => { location.href = '/?desktop=1' } }, 'VERSIONE COMPUTER'))))
} else {
  const box = h('div', { class: 'box frame' }, h('h1', {}, C.name === 'alien' ? 'INTERFACE 2037' : C.title), h('div', { id: 'mBoot', class: 'dim' }, '> COLLEGAMENTO...'))
  const scr = h('div', { class: 'mstart' }, box); document.body.append(scr)
  await connect(pid, me.name)
  await initAudio()
  const pm = (await fetch('/api/projects').then(r => r.json())).find(p => p.id === pid)
  $('#mBoot').textContent = `> ${pm?.name || pid} · ${S.tracks.length} TRACCE`
  // iOS/Android: l'audio parte solo dopo un tocco
  await new Promise(r => box.append(h('button', { class: 'go', onclick: r }, 'TOCCA PER INIZIARE')))
  await resumeAudio()
  scr.remove(); $('#mapp').style.display = 'grid'; $('#mProj').textContent = pm?.name || ''
  if (!S.project.get('bpm')) act(null, () => S.project.set('bpm', 120))
  start()
}
}

// in fondo: tutte le variabili del modulo sono già inizializzate
await boot()
