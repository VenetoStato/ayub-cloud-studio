// AYUB CLOUD STUDIO — bootstrap
import { S, connect, onChange, trackList, addTrack, addClip, putNotes, act, uid, setLocalParamHook, replacePresetFx } from './state.js'
import { E, initAudio, resumeAudio, syncGraph, syncClips, applyLocal, exportMix, play, stop, startRecording, stopRecording, playheadBeat, outLatency } from './audio/engine.js'
import { INSTRUMENTS, PRESETS, presetFx } from './audio/instruments.js'
import { UI, selectTrack } from './ui/ui.js'
import { $, h, menu, toast, hhmm } from './ui/util.js'
import { C, tc, setTheme, initTheme, onTheme, THEMES } from './ui/theme.js'
import { startMascots, stopMascots } from './ui/mascots.js'
import { initArrange, draw as drawArr, drawPlay as drawArrPlay, renderHeads, clipKeys } from './ui/arrange.js'
import { initRoll, draw as drawRoll, drawPlay as drawRollPlay, renderRollBar, rollKeys } from './ui/pianoroll.js'
import { renderDevices, refreshKnobs, drawDisplays, updateLive } from './ui/devices.js'
import { renderMixer, drawMeters } from './ui/mixer.js'
import { initKbd, drawKbd, initMidi, pcKeyDown, pcKeyUp } from './ui/keyboard.js'

const me = await fetch('/api/me').then(r => r.ok ? r.json() : null)
if (!me) { location.href = '/login'; throw new Error('login') }
initTheme()
// telefono/tablet: vai alla versione mobile (tastiera touch, drum, voce). ?desktop=1 per forzare il computer
{
  const q = new URLSearchParams(location.search)
  if (!q.has('desktop') && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820) { location.replace('/mobile.html' + location.search); await new Promise(() => {}) }
}
// sfarfallio CRT: costa ridisegni a tutto schermo, quindi spento di default
if (localStorage.getItem('ayub_flicker') !== '1') document.body.classList.remove('flicker')


// ---------------------------------------------------------------- schermata progetti
async function projectScreen () {
  const list = await fetch('/api/projects').then(r => r.json())
  const scr = h('div', { class: 'screen' }, h('div', { class: 'box frame' },
    h('h1', {}, 'INTERFACE 2037'),
    h('div', { class: 'dim', style: { marginBottom: '18px', letterSpacing: '.3em', fontSize: '11px' } }, `OPERATORE ${me.name} · SELEZIONA PROGETTO`),
    h('div', { class: 'plist' }, ...list.map(p => h('div', { class: 'p', onclick: () => { location.href = '/?p=' + p.id } },
      h('span', {}, '> ' + p.name), h('small', {}, `DI ${p.by} · ${new Date(p.updated).toLocaleString('it-IT')}`)))),
    !list.length ? h('div', { class: 'dim', style: { padding: '10px 6px' } }, 'NESSUN PROGETTO IN ARCHIVIO.') : null,
    h('div', { style: { marginTop: '18px', display: 'flex', gap: '8px' } },
      h('button', { onclick: async () => { const name = prompt('Nome del nuovo progetto', 'NUOVO BRANO'); if (!name) return; const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.toUpperCase() }) }).then(r => r.json()); location.href = `/?p=${r.id}&new=1` } }, '+ NUOVO PROGETTO'),
      h('button', { onclick: logout }, 'ESCI'))))
  document.body.append(scr)
}
async function logout () { await fetch('/api/logout', { method: 'POST' }); location.href = '/login' }

// ---------------------------------------------------------------- avvio
async function boot (projectId, isNew) {
  const lines = ['INTERFACE 2037 READY FOR INQUIRY', `OPERATORE: ${me.name}`, 'COLLEGAMENTO AL NUCLEO CONDIVISO...']
  const pre = h('div', { id: 'boot' })
  const go = h('button', { style: { marginTop: '20px', fontSize: '20px', fontFamily: 'var(--big)', display: 'none' } }, '[ INVIO ] INIZIALIZZA AUDIO')
  const scr = h('div', { class: 'screen' }, h('div', { class: 'box frame' }, pre, go))
  document.body.append(scr)
  const type = async (s) => { for (const ch of s) { pre.textContent += ch; await new Promise(r => setTimeout(r, 8)) } pre.textContent += '\n' }
  for (const l of lines) await type('> ' + l)
  await connect(projectId, me.name)
  const projects = await fetch('/api/projects').then(r => r.json())
  const pm = projects.find(p => p.id === projectId)
  await type(`> PROGETTO: ${pm?.name || projectId}`)
  await type(`> TRACCE: ${S.tracks.length} · CLIP: ${S.clips.size} · OPERATORI ONLINE: ${new Set([...S.awareness.getStates().values()].map(s => s.user?.name).filter(Boolean)).size}`)
  await initAudio()
  await type('> MOTORE AUDIO PRONTO. LATENZA RICHIESTA: INTERATTIVA')
  go.style.display = 'block'; go.focus()
  await new Promise(r => { go.onclick = r; addEventListener('keydown', function k (e) { if (e.key === 'Enter') { removeEventListener('keydown', k); r() } }) })
  await resumeAudio()
  scr.remove()
  $('#app').style.display = 'grid'
  $('#projName').textContent = pm?.name || ''
  document.title = `${pm?.name || 'PROGETTO'} // INTERFACE 2037`
  if (S.tracks.length === 0 && S.log.length === 0) seed() // progetto mai toccato: brano demo
  if (!S.project.get('bpm')) act(null, () => S.project.set('bpm', 120))
  // una volta sola per traccia: i progetti nati prima dei preset con effetti ricevono la catena del loro preset
  const old = trackList().filter(t => t.get('kind') === 'inst' && !t.get('fxInit') && t.get('fx').length === 0)
  if (old.length) act(`catene effetti dei preset su ${old.length} tracce`, () => { for (const t of old) { const i = t.get('instrument'); replacePresetFx(t, presetFx(i.get('type'), i.get('preset'))); t.set('fxInit', true) } })
  history.replaceState(null, '', '/?p=' + projectId)
  start()
}

function seed () {
  const d = addTrack({ name: 'DRUMS', instrument: 'drums', preset: '808 SYNTH', params: { ...INSTRUMENTS.drums.defaults } , fx: presetFx('drums', '808 SYNTH') })
  const b = addTrack({ name: 'BASSO', instrument: 'wave', preset: 'NEURO REESE', params: { ...INSTRUMENTS.wave.defaults, ...PRESETS.wave['NEURO REESE'] } , fx: presetFx('wave', 'NEURO REESE') })
  const p = addTrack({ name: 'PAD', instrument: 'wave', preset: 'EVOLVING PAD', params: { ...INSTRUMENTS.wave.defaults, ...PRESETS.wave['EVOLVING PAD'] } , fx: presetFx('wave', 'EVOLVING PAD') })
  addTrack({ name: 'NUVOLA', instrument: 'gran', preset: 'NUVOLA CORO', params: { ...INSTRUMENTS.gran.defaults, ...PRESETS.gran['NUVOLA CORO'] } , fx: presetFx('gran', 'NUVOLA CORO') })
  addTrack({ name: 'PIANO', instrument: 'piano', preset: 'GRAN CODA', params: { ...INSTRUMENTS.piano.defaults } , fx: presetFx('piano', 'GRAN CODA') })
  addTrack({ kind: 'audio', name: 'SAX' })
  const dc = addClip(d, 0, 16, { name: 'BEAT' })
  const dn = []
  for (let bar = 0; bar < 4; bar++) {
    for (let i = 0; i < 16; i++) {
      const t = bar * 4 + i / 4
      if (i % 4 === 0) dn.push({ id: uid(), p: 36, t, d: 0.25, v: 0.95 })
      if (i === 4 || i === 12) dn.push({ id: uid(), p: 38, t, d: 0.25, v: 0.85 })
      if (i % 2 === 0) dn.push({ id: uid(), p: 42, t, d: 0.25, v: i % 4 === 2 ? 0.8 : 0.5 })
      if (bar === 3 && i === 14) dn.push({ id: uid(), p: 46, t, d: 0.5, v: 0.7 })
    }
  }
  putNotes(dc, dn, 'pattern batteria iniziale')
  const roots = [45, 41, 36, 43] // A F C G
  const bc = addClip(b, 0, 16, { name: 'BASSLINE' })
  putNotes(bc, roots.flatMap((r, i) => [{ id: uid(), p: r, t: i * 4, d: 1.5, v: 0.9 }, { id: uid(), p: r, t: i * 4 + 2, d: 0.5, v: 0.7 }, { id: uid(), p: r + 12, t: i * 4 + 3, d: 0.5, v: 0.6 }]), 'linea di basso iniziale')
  const pc = addClip(p, 0, 16, { name: 'ACCORDI' })
  const chords = [[57, 60, 64], [53, 57, 60], [52, 55, 60], [50, 55, 59]]
  putNotes(pc, chords.flatMap((c, i) => c.map(n => ({ id: uid(), p: n, t: i * 4, d: 3.9, v: 0.7 }))), 'accordi iniziali')
  act(null, () => S.project.set('bpm', 120))
  E.loop = { on: true, start: 0, end: 16 }
}

// ---------------------------------------------------------------- app
let sigDev = ''; let sigMix = ''
function start () {
  window.AYUB = { E, S, UI } // aggancio per diagnostica/test
  initArrange(); initRoll(); initKbd(); initMidi()
  E.onTick = () => drawArr()
  $('#bpm').value = S.project.get('bpm') || 120
  $('#bpm').onchange = (e) => { const v = Math.max(40, Math.min(240, +e.target.value || 120)); act(`BPM → ${v}`, () => S.project.set('bpm', v)) }
  $('#bPlay').onclick = () => E.playing ? stop() : play()
  $('#bStop').onclick = () => stop()
  $('#bRec').onclick = toggleRec
  $('#bLoop').onclick = () => { E.loop.on = !E.loop.on; ui() }
  $('#bMetro').onclick = () => { E.metro = !E.metro; ui() }
  $('#bAdd').onclick = (e) => menu(e.clientX, e.clientY + 10, [
    { header: 'STRUMENTI' },
    ...Object.entries(PRESETS).flatMap(([ty, ps]) => [{ header: INSTRUMENTS[ty].label }, ...Object.keys(ps).map(pn => ({ label: '  ' + pn, do: () => newInst(ty, pn) }))]),
    '-', { label: '+ TRACCIA AUDIO (VOCE / SAX / CHITARRA)', do: () => selectTrack(addTrack({ kind: 'audio', name: 'AUDIO ' + (trackList().length + 1) })) }
  ])
  $('#bShare').onclick = share
  $('#bMenu').onclick = (e) => menu(e.clientX - 200, e.clientY + 10, [
    { label: 'CONDIVIDI LINK PROGETTO', do: share },
    { label: 'APRI VERSIONE MOBILE (TOUCH)', do: () => { location.href = '/mobile.html' + location.search } },
    { label: 'ESPORTA MIX (WAV)', do: doExport },
    { header: `OPERATORE ${me.name}` },
    { label: 'ANNULLA MIA ULTIMA MODIFICA (CTRL+Z)', do: () => S.undo.undo() },
    { label: 'RIPRISTINA (CTRL+SHIFT+Z)', do: () => S.undo.redo() },
    { header: 'TEMA GRAFICO' },
    ...Object.entries(THEMES).map(([k, t]) => ({ label: (C.name === k ? '● ' : '○ ') + t.label, do: () => setTheme(k) })),
    '-',
    { label: 'EFFETTO SFARFALLIO CRT ON/OFF', do: () => { document.body.classList.toggle('flicker'); localStorage.setItem('ayub_flicker', document.body.classList.contains('flicker') ? '1' : '0') } },
    { label: 'INFO LATENZA', do: () => toast(`USCITA ${(outLatency() * 1000).toFixed(1)} MS · BUFFER ${(E.ctx.baseLatency * 1000).toFixed(1)} MS · SR ${E.ctx.sampleRate}`, 5000) },
    '-', { label: 'ALTRI PROGETTI', do: () => { location.href = '/' } },
    { label: 'ESCI', do: logout }
  ])
  document.querySelectorAll('#tabs button').forEach(b => { b.onclick = () => setTab(b.dataset.t) })
  addEventListener('ayub:openclip', () => setTab('roll'))
  // splitter
  $('#splitter').onpointerdown = (e) => {
    const s = e.target; s.setPointerCapture(e.pointerId); const y0 = e.clientY; const h0 = $('#bottom').offsetHeight
    s.onpointermove = (ev) => { document.documentElement.style.setProperty('--bottom', Math.max(140, Math.min(innerHeight - 260, h0 - (ev.clientY - y0))) + 'px') }
    s.onpointerup = () => { s.onpointermove = null }
  }
  addEventListener('mouseup', (e) => { if (e.target.closest?.('button')) e.target.closest('button').blur() })
  addEventListener('keydown', onKey); addEventListener('keyup', (e) => { if (!typing(e)) pcKeyUp(e) })
  setLocalParamHook((local, key, val) => applyLocal(local, key, val))
  const applyTheme = () => {
    if (C.name === 'ponpon') startMascots(() => playheadBeat(), () => E.playing); else stopMascots()
    sigDev = sigMix = ''; update(['ui']); drawArr(); drawRoll()
  }
  onTheme(applyTheme); applyTheme()
  checkVersion(); setInterval(checkVersion, 30000)
  UI.redraw.add(() => update(['ui']))
  onChange(update)
  if (trackList()[0]) selectTrack(trackList()[0].get('id'))
  syncGraph(); syncClips(); update(['ui']); ui()
  requestAnimationFrame(loop)
}

function newInst (ty, pn) {
  const n = trackList().filter(t => t.get('instrument')?.get('type') === ty).length + 1
  const name = (ty === 'wave' || ty === 'gran' ? pn.split(' ')[0] : ty.toUpperCase()) + (n > 1 ? ' ' + n : '')
  selectTrack(addTrack({ name, instrument: ty, preset: pn, params: { ...INSTRUMENTS[ty].defaults, ...PRESETS[ty][pn] }, fx: presetFx(ty, pn) }))
}
function setTab (t) {
  UI.tab = t
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t))
  document.querySelectorAll('#panel > div').forEach(d => d.classList.toggle('on', d.id === t))
  sigDev = sigMix = ''; renderAll(); drawRoll()
}

// aggiorna solo quello che è cambiato
function update (what) {
  const all = what.includes('ui')
  const tracks = all || what.includes('tracks'); const clips = all || what.includes('clips'); const pres = what.includes('presence')
  if (what.includes('tracks') || what.includes('project')) { syncGraph(S.dirtyAll ? null : new Set(S.dirtyTracks)); S.dirtyTracks.clear(); S.dirtyAll = false }
  if (clips) syncClips()
  if (all || what.includes('project')) $('#bpm').value = S.project.get('bpm') || 120
  if (tracks || pres) { if (!document.activeElement?.closest?.('#heads')) renderHeads() }
  if (tracks) renderPanels()
  if (clips || tracks) renderRollBar()
  if (all || what.includes('log')) renderLog()
  if (all || pres) renderOps()
  if (tracks || clips || pres || what.includes('project')) { drawArr(); drawRoll() }
}
function renderAll () { update(['ui']) }
function renderPanels () {
  // device: ricostruisci solo se cambia la struttura (altrimenti il drag delle manopole si interrompe)
  const t = UI.selTrack && trackList().find(x => x.get('id') === UI.selTrack)
  const inst = t?.get('instrument')
  const ip = inst?.get('params')
  const sd = UI.selTrack + '|' + (inst ? inst.get('type') + inst.get('preset') + (inst._item?.id.clock) + ['lfo1Sync', 'lfo2Sync', 'o1Table', 'o2Table', 'gSrc'].map(k => ip.get(k)).join() : '') + '|' + (t ? t.get('fx').toArray().map(f => f.get('id') + f.get('on')).join() : '') + '|' + (t?.get('input') ?? '')
  if (sd !== sigDev) { sigDev = sd; renderDevices(); drawDisplays() } else refreshKnobs()
  const sm = trackList().map(x => x.get('id') + x.get('name') + x.get('mute') + x.get('solo') + x.get('vol')).join()
  if (sm !== sigMix && UI.tab === 'mixer' && !document.activeElement?.closest?.('#mixer')) { sigMix = sm; renderMixer() }
  document.querySelectorAll('#mixer .strip[data-id]').forEach(el => el.classList.toggle('frame', el.dataset.id === UI.selTrack))
}
function renderLog () {
  const l = $('#log'); const items = S.log.toArray().slice(-120).reverse()
  const sig = items.length + (items[0]?.at || 0)
  if (l._sig === sig) return; l._sig = sig
  l.innerHTML = ''
  for (const it of items) l.append(h('div', {}, h('i', {}, hhmm(it.at)), h('span', {}, h('b', { style: { color: tc(it.color) } }, it.who), ' ', it.msg)))
}
function renderOps () {
  const o = $('#ops')
  // un chip per persona (stesso nome = stessa persona, anche con più schede)
  const people = new Map([[S.me.name, { u: S.me, n: 0 }]])
  for (const [, s] of S.awareness.getStates()) if (s.user) { const p = people.get(s.user.name) || { u: s.user, n: 0 }; p.n++; people.set(s.user.name, p) }
  const sig = [...people].map(([k, v]) => k + v.n).join()
  if (o._sig === sig) return; o._sig = sig
  o.innerHTML = ''
  for (const [name, p] of people) o.append(h('span', { class: 'op' + (name === S.me.name ? ' me' : ''), style: { color: tc(p.u.color) }, title: p.n > 1 ? `${p.n} finestre aperte` : '' }, name))
}
function ui () {
  $('#bPlay').classList.toggle('on', E.playing)
  $('#bRec').classList.toggle('on', E.recording)
  $('#bLoop').classList.toggle('on', E.loop.on)
  $('#bMetro').classList.toggle('on', E.metro)
}
async function toggleRec () {
  if (E.recording) { stopRecording(); ui(); return }
  const err = await startRecording(); if (err) toast(err)
  ui()
}

const typing = (e) => /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range'
function onKey (e) {
  if (typing(e)) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? S.undo.redo() : S.undo.undo(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); S.undo.redo(); return }
  if (e.code === 'Space') { e.preventDefault(); E.playing ? stop() : play(); ui(); return }
  if (rollKeys(e)) { drawRoll(); return }
  if (clipKeys(e)) return
  if ((e.key === 'F9' || e.key.toLowerCase() === 'r') && !e.repeat) { toggleRec(); return }
  if (e.key.toLowerCase() === 'l' && e.shiftKey) { E.loop.on = !E.loop.on; ui(); return }
  if (e.key.toLowerCase() === 'm' && e.shiftKey) { E.metro = !E.metro; ui(); return }
  if (pcKeyDown(e)) e.preventDefault()
}

let lastPh = 0; let frame = 0
function loop () {
  requestAnimationFrame(loop)
  const b = playheadBeat()
  const bar = Math.floor(b / 4) + 1; const beat = Math.floor(b % 4) + 1; const six = Math.floor((b % 1) * 4) + 1
  $('#pos').textContent = `${String(bar).padStart(3, '0')}.${beat}.${six}`
  $('#status').textContent = S.provider.wsconnected ? 'LINK ●' : 'LINK ○ RICONNESSIONE...'
  $('#status').style.color = S.provider.wsconnected ? '' : C.red
  if (E.playing) { drawArrPlay(); if (UI.tab === 'roll') drawRollPlay() }
  drawMeters(); drawKbd()
  if (++frame % 2 === 0) updateLive()
  const now = performance.now()
  if (now - lastPh > 250) {
    lastPh = now
    const ph = E.playing ? Math.round(b * 100) / 100 : null
    if (S.awareness.getLocalState()?.ph !== ph) S.awareness.setLocalStateField('ph', ph)
    $('#lat').textContent = `LAT OUT ${(outLatency() * 1000).toFixed(0)}MS`
    ui()
  }
}

// avviso quando sul server c'è una versione nuova dello studio
let myVer = null
async function checkVersion () {
  try {
    const { v } = await fetch('/api/version').then(r => r.json())
    if (v === 'dev' || v === '?') return
    if (!myVer) myVer = [...document.scripts].map(x => x.src.match(/assets\/index-[^"]+\.js/)?.[0]).find(Boolean) || v
    if (v !== myVer && !document.getElementById('newver')) {
      const b = h('button', { id: 'newver', class: 'amber on', style: { position: 'fixed', top: '60px', right: '290px', zIndex: 70 }, onclick: () => location.reload() }, '↻ NUOVA VERSIONE — RICARICA')
      document.body.append(b)
    }
  } catch {}
}

function share () {
  const url = location.origin + '/?p=' + new URLSearchParams(location.search).get('p')
  navigator.clipboard?.writeText(url).then(() => toast('LINK COPIATO: ' + url, 5000), () => prompt('Copia il link del progetto:', url))
  if (!navigator.clipboard) prompt('Copia il link del progetto:', url)
}
async function doExport () {
  if (E.exporting) { E.exporting = false; return }
  toast('EXPORT IN CORSO: IL BRANO SUONA DALL\'INIZIO ALLA FINE...', 4000)
  const err = await exportMix((p) => { $('#status').textContent = 'EXPORT ' + Math.round(p * 100) + '%' })
  toast(err || 'MIX ESPORTATO (WAV 24 BIT)')
}

// avvio (in fondo al modulo: tutte le dichiarazioni sono già inizializzate)
const params = new URLSearchParams(location.search)
const pid = params.get('p')
if (!pid) await projectScreen()
else await boot(pid, params.get('new') === '1')
