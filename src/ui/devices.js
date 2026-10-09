// Pannello device: strumento della traccia + catena effetti.
// I synth XWAVE/GRANULAR hanno schede stile Serum, display animati e anelli di modulazione in tempo reale.
import { C, alpha, tc, glow, font } from './theme.js'
import { S, trackById, setParam, getParam, setInstrument, addFx, removeFx, act } from '../state.js'
import { INSTRUMENTS, PRESETS, KITS, presetFx } from '../audio/instruments.js'
import { WT_NAMES, MOD_SOURCES, MOD_DESTS, WARPS, FILTERS, SYNC_DIVS, GRAIN_BUILTINS, tableCache, getTable, sourceCache, getSource } from '../audio/xsynth.js'
import { TS, FR } from '../audio/wavetables.js'
import { FX, fxDefaults } from '../audio/effects.js'
import { E, listInputs, armInput } from '../audio/engine.js'
import { UI } from './ui.js'
import { $, h, knob, menu, toast, fitCanvas } from './util.js'

const DEST_LABEL = { off: '—', posA: 'WT POS A', posB: 'WT POS B', warpA: 'WARP A', warpB: 'WARP B', pitchA: 'PITCH A', pitchB: 'PITCH B', lvlA: 'LEVEL A', lvlB: 'LEVEL B', cut: 'CUTOFF', res: 'RESON.', drive: 'DRIVE', det: 'DETUNE', pan: 'PAN', amp: 'AMP', sub: 'SUB', noise: 'NOISE', gpos: 'GRAIN POS', gsize: 'GRAIN SIZE', gdens: 'DENSITÀ', gspray: 'SPRAY', gpitch: 'GRAIN PITCH', lfo1rate: 'LFO1 RATE', lfo2rate: 'LFO2 RATE', fine: 'FINE (VIBRATO)' }
const SRC_LABEL = { off: '—', lfo1: 'LFO 1', lfo2: 'LFO 2', env2: 'ENV 2', env3: 'ENV 3', vel: 'VELOCITY', note: 'NOTA', mod: 'MOD WHEEL', mac1: 'MACRO 1', mac2: 'MACRO 2', mac3: 'MACRO 3', mac4: 'MACRO 4', rand: 'RANDOM', bend: 'PITCH BEND' }
const WAVE_ONLY = new Set(['posA', 'posB', 'warpA', 'warpB', 'pitchA', 'pitchB', 'lvlA', 'lvlB', 'det', 'sub', 'noise', 'fine'])
const GRAN_ONLY = new Set(['gpos', 'gsize', 'gdens', 'gspray', 'gpitch'])

// schemi semplici per FM / PIANO / DRUMS
const SCHEMA = {
  fm: [
    { t: 'OPERATORE 1', k: [['ratio', 'RATIO', 0.5, 16, 1, '', 'lin', null, 0.5], ['index', 'INDEX', 0, 10, 2.5], ['idxDecay', 'DECAY', 0.01, 5, 0.8, 's', 'log'], ['idxSus', 'SUSTAIN', 0, 1, 0.15]] },
    { t: 'OPERATORE 2', k: [['ratio2', 'RATIO', 0.5, 20, 14, '', 'lin', null, 0.5], ['index2', 'INDEX', 0, 5, 0.4], ['idx2Decay', 'DECAY', 0.01, 5, 0.15, 's', 'log']] },
    { t: 'CARRIER', k: [['detune', 'DETUNE', 0, 30, 4, 'ct'], ['tone', 'TONO', 200, 18000, 9000, 'Hz', 'log']] },
    { t: 'ENV AMP', env: 'a', k: [['aA', 'A', 0.001, 5, 0.002, 's', 'log'], ['aD', 'D', 0.01, 6, 1.4, 's', 'log'], ['aS', 'S', 0, 1, 0.25], ['aR', 'R', 0.01, 8, 0.6, 's', 'log'], ['gain', 'VOLUME', 0, 1, 0.45]] }
  ],
  piano: [{ t: 'PIANO', k: [['tone', 'TONO', 500, 18000, 12000, 'Hz', 'log'], ['aR', 'RELEASE', 0.05, 4, 0.9, 's', 'log'], ['velCurve', 'VEL CURVE', 0, 1.5, 0.6], ['tune', 'TUNE', -50, 50, 0, 'ct'], ['gain', 'VOLUME', 0, 1.5, 0.8]] }],
  drums: [{ t: 'KIT', sel: [['kit', KITS]], k: [['tune', 'TUNE', -12, 12, 0, 'st'], ['decay', 'DECAY', 0.2, 2, 1], ['kickLvl', 'KICK', 0, 1.5, 1], ['snareLvl', 'SNARE', 0, 1.5, 0.8], ['hatLvl', 'HATS', 0, 1.5, 0.6], ['gain', 'VOLUME', 0, 1.5, 0.8]] }]
}
function prettyKey (k) {
  const m = k.match(/^m(\d)(Src|Dst)$/); if (m) return `MATRICE ${+m[1] + 1} ${m[2] === 'Src' ? 'SORGENTE' : 'DESTINAZIONE'}`
  return ({ o1Table: 'OSC A TABELLA', o2Table: 'OSC B TABELLA', o1Warp: 'OSC A WARP', o2Warp: 'OSC B WARP', fType: 'FILTRO', fSlope: 'PENDENZA', subShape: 'SUB FORMA', gSrc: 'SORGENTE', voiceMode: 'MODO VOCE', lfoTarget: 'LFO1 ROUTING', lfo1Shape: 'LFO1 FORMA', lfo2Shape: 'LFO2 FORMA' })[k] || k
}
const spec = (a) => ({ label: a[1], min: a[2], max: a[3], def: a[4], unit: a[5] || '', scale: a[6] || 'lin', options: a[7] || null, step: a[8] || null })
let knobs = []
let ctx = null // contesto del device strumento corrente

export function renderDevices () {
  const root = $('#devices'); root.innerHTML = ''; knobs = []; ctx = null
  const t = UI.selTrack && trackById(UI.selTrack)
  $('#tabInfo').textContent = t ? `TRACCIA ${t.get('name')}` : ''
  if (!t) { root.append(h('div', { class: 'dim', style: { padding: '20px' } }, '> SELEZIONA UNA TRACCIA')); return }
  if (t.get('kind') === 'inst') {
    const type = t.get('instrument').get('type')
    root.append(type === 'wave' || type === 'gran' ? xDevice(t) : instDevice(t))
  } else root.append(audioInDevice(t))
  for (const f of t.get('fx').toArray()) root.append(fxDevice(t, f))
  root.append(h('button', { class: 'adddev', onclick: (e) => menu(e.clientX, e.clientY - 300, [{ header: 'AGGIUNGI EFFETTO' }, ...Object.entries(FX).map(([k, v]) => ({ label: v.label, do: () => addFx(t.get('id'), k, fxDefaults(k)) }))]) }, '+ EFFETTO'))
  drawDisplays()
}
export function refreshKnobs () { for (const k of knobs) k.draw(); drawDisplays() }

// chiamata ~30 volte al secondo: anelli di modulazione + display animati
export function updateLive () {
  if (!ctx || UI.tab !== 'devices') return
  const tn = E.tracks.get(ctx.trackId); const tele = tn?.inst?.tele
  if (tele === ctx.lastTele && !ctx.hadTele) return
  ctx.hadTele = !!tele; ctx.lastTele = tele
  for (const k of knobs) k.drawMod?.()
  drawDisplays(true)
}

function presetSelect (t) {
  const inst = t.get('instrument'); const type = inst.get('type')
  return h('select', { onchange: (e) => { const [ty, pr] = e.target.value.split('|'); setInstrument(t.get('id'), ty, { ...INSTRUMENTS[ty].defaults, ...(PRESETS[ty]?.[pr] || {}) }, pr, presetFx(ty, pr)) } },
    ...Object.entries(PRESETS).map(([ty, ps]) => h('optgroup', { label: INSTRUMENTS[ty].label }, ...Object.keys(ps).map(pn => { const o = h('option', { value: ty + '|' + pn }, pn); if (ty === type && inst.get('preset') === pn) o.selected = true; return o }))))
}

// ---------------------------------------------------------------- XWAVE / GRANULAR
function xDevice (t) {
  const inst = t.get('instrument'); const type = inst.get('type'); const params = inst.get('params')
  const def = INSTRUMENTS[type]; const D = def.defaults
  const tid = t.get('id')
  ctx = { trackId: tid, type, params }
  const get = (k) => getParam(params, k) ?? D[k]
  const set = (k, v, lab) => setParam(params, k, v, `${t.get('name')}: ${lab || k}`, { track: tid })
  const tele = () => E.tracks.get(tid)?.inst?.tele
  const modOf = (dest, scale = 1) => () => { const m = tele()?.mod; if (!m) return null; return m[MOD_DESTS.indexOf(dest)] * scale }
  const K = (key, label, min, max, o = {}) => {
    const k = knob({ label, min, max, def: D[key], unit: o.unit || '', scale: o.log ? 'log' : 'lin', step: o.step, options: o.options }, () => get(key), (v) => set(key, v, label), { mod: o.mod, fmt: o.fmt })
    knobs.push(k); return k
  }
  const SEL = (key, opts, labels = {}, after) => h('select', { style: { fontSize: '10px' }, onchange: (e) => { const v = isNaN(+e.target.value) || e.target.value === '' ? e.target.value : +e.target.value; set(key, v, prettyKey(key) + ' → ' + String(labels[v] ?? v).toUpperCase()); after?.(); drawDisplays() } },
    ...opts.map(o => { const op = h('option', { value: o }, String(labels[o] ?? o).toUpperCase()); if (get(key) == o) op.selected = true; return op }))
  const TOG = (key, label, after) => { const b = h('button', { class: get(key) ? 'on' : '', style: { padding: '0 5px', fontSize: '9px' }, onclick: () => { set(key, get(key) ? 0 : 1, label); b.classList.toggle('on'); after?.() } }, label); return b }
  const box = (title, head, ...rows) => h('div', { class: 'grp2' }, h('div', { class: 't' }, title, ...(head || [])), ...rows)
  const row = (...k) => h('div', { class: 'row' }, ...k)
  const env = (pre, A, Dk, Sk, Rk) => { const c = h('canvas', { class: 'wt', style: { width: '170px', height: '38px' } }); c._env = { get, keys: [A, Dk, Sk, Rk] }; return c }

  const tabs = type === 'wave' ? [['osc', 'OSC'], ['filt', 'FILTRO · ENV'], ['lfo', 'LFO · VOCE'], ['mtx', 'MATRICE']] : [['osc', 'GRANI'], ['filt', 'FILTRO · ENV'], ['lfo', 'LFO · VOCE'], ['mtx', 'MATRICE']]
  const cur = UI.devTab || 'osc'
  const body = h('div', { class: 'body' })

  if (cur === 'osc' && type === 'wave') {
    for (const [k, name, pd, wd, ld] of [['o1', 'OSC A', 'posA', 'warpA', 'lvlA'], ['o2', 'OSC B', 'posB', 'warpB', 'lvlB']]) {
      const table = get(k + 'Table')
      const opts = [...WT_NAMES]; if (table.startsWith('user:')) opts.push(table)
      const wt = h('canvas', { class: 'wt', style: { width: '240px', height: '86px' }, title: 'Trascina qui un file audio per creare una wavetable' }); wt._wt = { k, get, tele, pd }
      dropFile(wt, (id) => set(k + 'Table', 'user:' + id, name + ' wavetable importata'))
      body.append(box(name, [TOG(k + 'On', 'ON'), SEL(k + 'Table', opts, Object.fromEntries(opts.filter(o => o.startsWith('user:')).map(o => [o, 'USER WAV']))),
        h('button', { style: { padding: '0 5px', fontSize: '9px' }, title: 'Importa un WAV/MP3 come wavetable (16 frame)', onclick: () => pickFile((id) => set(k + 'Table', 'user:' + id, name + ' wavetable importata')) }, 'IMPORTA')],
      wt,
      row(K(k + 'Pos', 'WT POS', 0, 1, { mod: () => { const tl = tele(); return tl?.[k === 'o1' ? 'posA' : 'posB'] != null ? { abs: tl[k === 'o1' ? 'posA' : 'posB'] } : null } }),
        h('div', { class: 'knob', style: { cursor: 'default' } }, h('div', { class: 'l' }, 'WARP'), SEL(k + 'Warp', WARPS)), K(k + 'WarpAmt', 'WARP AMT', 0, 1, { mod: modOf(wd) }),
        K(k + 'Lvl', 'LEVEL', 0, 1, { mod: modOf(ld) }), K(k + 'Pan', 'PAN', -1, 1)),
      row(K(k + 'Oct', 'OCT', -3, 3, { step: 1 }), K(k + 'Semi', 'SEMI', -12, 12, { step: 1 }), K(k + 'Fine', 'FINE', -100, 100, { unit: 'ct' }),
        K(k + 'Uni', 'UNISON', 1, 16, { step: 1 }), K(k + 'Det', 'DETUNE', 0, 100, { unit: 'ct', mod: modOf('det', 0.3) }), K(k + 'Blend', 'BLEND', 0, 1), K(k + 'Width', 'WIDTH', 0, 1))))
    }
    body.append(box('SUB / NOISE', [SEL('subShape', ['sine', 'triangle'])],
      row(K('subLvl', 'SUB', 0, 1, { mod: modOf('sub') }), K('subOct', 'SUB OCT', -1, 1, { step: 1 })),
      row(K('noiseLvl', 'NOISE', 0, 1, { mod: modOf('noise') }), K('noiseColor', 'COLORE', 0, 1))))
  }
  if (cur === 'osc' && type === 'gran') {
    const src = get('gSrc')
    const opts = [...Object.keys(GRAIN_BUILTINS), 'take:last']
    const labels = { ...GRAIN_BUILTINS, 'take:last': 'ULTIMA TAKE' }
    for (const c of S.clips.values()) if (c.get('kind') === 'audio' && c.get('file')) { const id = 'audio:' + c.get('file'); if (!opts.includes(id)) { opts.push(id); labels[id] = 'TAKE ' + c.get('name') + ' (' + c.get('author') + ')' } }
    if (!opts.includes(src)) { opts.push(src); labels[src] = 'FILE CARICATO' }
    const cv = h('canvas', { class: 'wt', style: { width: '460px', height: '96px' }, title: 'Trascina qui un file audio come sorgente' }); cv._gran = { get, tele }
    dropFile(cv, (id) => set('gSrc', 'audio:' + id, 'sorgente granulare caricata'))
    body.append(box('SORGENTE', [SEL('gSrc', opts, labels), h('button', { style: { padding: '0 5px', fontSize: '9px' }, onclick: () => pickFile((id) => set('gSrc', 'audio:' + id, 'sorgente granulare caricata')) }, 'CARICA FILE'), TOG('gFreeze', 'FREEZE'), TOG('gKey', 'KEYTRACK')],
      cv,
      row(K('gPos', 'POSIZIONE', 0, 1, { mod: () => { const tl = tele(); return tl?.gpos != null ? { abs: tl.gpos } : null } }), K('gScan', 'SCAN', -1, 1),
        K('gSize', 'SIZE', 5, 2000, { log: true, unit: 'ms', mod: modOf('gsize', 0.4) }), K('gDens', 'DENSITÀ', 0.5, 200, { log: true, unit: '/s', mod: modOf('gdens', 0.3) }),
        K('gSpray', 'SPRAY', 0, 1, { mod: modOf('gspray') }), K('gWin', 'FINESTRA', 0, 1)),
      row(K('gPitch', 'PITCH', -24, 24, { step: 1, unit: 'st', mod: modOf('gpitch', 0.5) }), K('gDetune', 'DETUNE', 0, 100, { unit: 'ct' }), K('gWidth', 'STEREO', 0, 1), K('gRev', 'REVERSE', 0, 1))))
  }
  if (cur === 'filt') {
    body.append(box('FILTRO', [SEL('fType', FILTERS), SEL('fSlope', [12, 24])],
      row(K('fCut', 'CUTOFF', 20, 20000, { log: true, unit: 'Hz', mod: modOf('cut', 0.6) }), K('fRes', 'RESON.', 0.1, 20, { mod: modOf('res', 0.3) }), K('drive', 'DRIVE', 0, 1, { mod: modOf('drive') })),
      row(K('fEnv', 'ENV AMT', -4800, 7200, { unit: 'ct' }), K('fVel', 'VEL>FLT', 0, 1), K('fKey', 'KEY TRK', 0, 1))))
    body.append(box('ENV 1 · AMP', null, env('a', 'aA', 'aD', 'aS', 'aR'), row(K('aA', 'A', 0.001, 8, { log: true, unit: 's' }), K('aD', 'D', 0.01, 8, { log: true, unit: 's' }), K('aS', 'S', 0, 1), K('aR', 'R', 0.01, 10, { log: true, unit: 's' })), row(K('gain', 'VOLUME', 0, 1, { mod: modOf('amp', 0.5) }))))
    body.append(box('ENV 2 · FILTRO', null, env('f', 'fA', 'fD', 'fS', 'fR'), row(K('fA', 'A', 0.001, 8, { log: true, unit: 's' }), K('fD', 'D', 0.01, 8, { log: true, unit: 's' }), K('fS', 'S', 0, 1), K('fR', 'R', 0.01, 10, { log: true, unit: 's' }))))
    body.append(box('ENV 3 · MOD', null, env('e3', 'e3A', 'e3D', 'e3S', 'e3R'), row(K('e3A', 'A', 0.001, 8, { log: true, unit: 's' }), K('e3D', 'D', 0.01, 8, { log: true, unit: 's' }), K('e3S', 'S', 0, 1), K('e3R', 'R', 0.01, 10, { log: true, unit: 's' }))))
  }
  if (cur === 'lfo') {
    for (const l of [1, 2]) {
      const k = 'lfo' + l
      const rate = get(k + 'Sync') ? K(k + 'Div', 'DIV', 0, SYNC_DIVS.length - 1, { options: SYNC_DIVS }) : K(k + 'Rate', 'RATE', 0.02, 30, { log: true, unit: 'Hz', mod: modOf(k + 'rate', 0.25) })
      const lc = h('canvas', { class: 'wt', style: { width: '150px', height: '38px' } }); lc._lfo = { get, k }
      const extra = l === 1 ? [h('div', { class: 't', style: { marginTop: '4px' } }, 'ROUTING RAPIDO', SEL('lfoTarget', ['cutoff', 'pitch', 'amp', 'posA', 'posB'], { posA: 'WT POS A', posB: 'WT POS B' })), row(K('lfoDepth', 'DEPTH', 0, 4800))] : []
      body.append(box('LFO ' + l, [SEL(k + 'Shape', ['sine', 'triangle', 'sawtooth', 'ramp', 'square', 'sh'], { sh: 'S&H' }), TOG(k + 'Sync', 'SYNC', () => renderDevices()), TOG(k + 'Retrig', 'RETRIG')], lc, row(rate), ...extra))
    }
    body.append(box('MACRO', null, row(K('mac1', 'MACRO 1', 0, 1), K('mac2', 'MACRO 2', 0, 1)), row(K('mac3', 'MACRO 3', 0, 1), K('mac4', 'MACRO 4', 0, 1))))
    body.append(box('VOCE', [SEL('voiceMode', ['poly', 'mono', 'legato'])],
      row(K('poly', 'POLIFONIA', 1, 16, { step: 1 }), K('glide', 'GLIDE', 0, 1, { unit: 's' })),
      row(K('bendRange', 'BEND', 0, 24, { step: 1, unit: 'st' }), K('pan', 'PAN', -1, 1, { mod: modOf('pan') }))))
  }
  if (cur === 'mtx') {
    const dests = MOD_DESTS.filter(d => type === 'wave' ? !GRAN_ONLY.has(d) : !WAVE_ONLY.has(d))
    const cols = [h('div', { class: 'grp2' }, h('div', { class: 't' }, 'SORGENTE → DESTINAZIONE · QUANTITÀ')), h('div', { class: 'grp2' }, h('div', { class: 't' }, ' '))]
    for (let i = 0; i < 8; i++) {
      const r = h('div', { class: 'row', style: { alignItems: 'center', gap: '6px' } },
        h('span', { class: 'dim', style: { width: '14px' } }, i + 1),
        SEL('m' + i + 'Src', MOD_SOURCES, SRC_LABEL), h('span', { class: 'amb' }, '→'), SEL('m' + i + 'Dst', dests, DEST_LABEL),
        K('m' + i + 'Amt', 'AMT ' + (i + 1), -1, 1))
      cols[i < 4 ? 0 : 1].append(r)
    }
    body.append(...cols)
    body.append(h('div', { class: 'grp2', style: { maxWidth: '230px', textTransform: 'none', fontSize: '10px', color: 'var(--dim)' } },
      'Esempi: LFO 1 → WT POS A per il "morph" della tabella; ENV 3 → WARP A per gli attacchi aggressivi; MOD WHEEL → CUTOFF per aprire il filtro dalla rotella; VELOCITY → AMP per la dinamica. Gli anelli azzurri sulle manopole mostrano la modulazione mentre suoni.'))
  }

  return h('div', { class: 'dev frame' },
    h('div', { class: 'dh' }, h('b', {}, def.label), presetSelect(t),
      ...tabs.map(([k, l]) => h('button', { class: cur === k ? 'on' : '', style: { padding: '0 8px', fontSize: '10px' }, onclick: () => { UI.devTab = k; renderDevices() } }, l)),
      h('span', { class: 'dim', style: { fontSize: '9px', marginLeft: 'auto' } }, `MOD: ${params.get('__by') || t.get('by')}`)),
    body)
}

// carica un file audio sul server (condiviso con tutti) e restituisce l'id
async function uploadFile (file) {
  toast('CARICAMENTO ' + file.name.toUpperCase() + '...')
  const r = await fetch('/api/audio', { method: 'POST', body: file }).then(r => r.json())
  toast('FILE CARICATO')
  return r.id
}
function pickFile (cb) {
  const i = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' } })
  i.onchange = async () => { if (i.files[0]) cb(await uploadFile(i.files[0])); i.remove() }
  document.body.append(i); i.click()
}
function dropFile (el, cb) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.style.borderColor = C.amber })
  el.addEventListener('dragleave', () => { el.style.borderColor = '' })
  el.addEventListener('drop', async (e) => { e.preventDefault(); el.style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f) cb(await uploadFile(f)) })
}

// ---------------------------------------------------------------- display
const peaksCache = new Map()
export function drawDisplays (liveOnly = false) {
  for (const c of document.querySelectorAll('#devices canvas.wt')) {
    if (liveOnly && !c._wt && !c._gran) continue
    const { g, w, h: H } = fitCanvas(c)
    g.fillStyle = C.panel; g.fillRect(0, 0, w, H)
    if (c._wt) drawWT(c, g, w, H)
    else if (c._gran) drawGran(c, g, w, H)
    else if (c._env) {
      const [A, Dk, Sk, Rk] = c._env.keys.map(k => c._env.get(k))
      const tot = A + Dk + 0.4 + Rk; const sx = (t) => 4 + (t / tot) * (w - 8); const sy = (v) => H - 4 - v * (H - 8)
      g.strokeStyle = C.fg; g.beginPath(); g.moveTo(sx(0), sy(0)); g.lineTo(sx(A), sy(1)); g.lineTo(sx(A + Dk), sy(Sk)); g.lineTo(sx(A + Dk + 0.4), sy(Sk)); g.lineTo(sx(tot), sy(0)); g.stroke()
    } else if (c._lfo) {
      const shape = c._lfo.get(c._lfo.k + 'Shape')
      g.strokeStyle = C.fg; g.beginPath()
      let sh = 0
      for (let i = 0; i <= 120; i++) {
        const ph = (i / 120 * 2) % 1
        if (shape === 'sh' && i % 15 === 0) sh = Math.sin(i * 12.9898) * 0.9
        const v = shape === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : shape === 'sawtooth' ? 2 * ph - 1 : shape === 'ramp' ? 1 - 2 * ph : shape === 'square' ? (ph < 0.5 ? 1 : -1) : shape === 'sh' ? sh : Math.sin(2 * Math.PI * ph)
        const x = 4 + i / 120 * (w - 8); const y = H / 2 - v * (H / 2 - 5); i ? g.lineTo(x, y) : g.moveTo(x, y)
      }
      g.stroke()
    }
  }
}
function drawWT (c, g, w, H) {
  const { k, get, tele } = c._wt
  const table = get(k + 'Table'); const on = get(k + 'On')
  const mips = tableCache.get(table)
  if (!mips) { g.fillStyle = C.dim; g.font = font(11); g.fillText('CALCOLO WAVETABLE...', 8, 20); getTable(table).then(() => drawDisplays()); return }
  const T = mips[0]; const tl = tele()
  const pos = tl && tl[k === 'o1' ? 'posA' : 'posB'] != null ? tl[k === 'o1' ? 'posA' : 'posB'] : get(k + 'Pos')
  const P = 96; const sw = w - 62; const hh = H - 34
  const frameAt = (fp, i) => { const f = fp * (FR - 1); const f0 = Math.min(FR - 2, Math.floor(f)); const fr = f - f0; const s = Math.floor(i / P * TS); return T[f0 * TS + s] * (1 - fr) + T[(f0 + 1) * TS + s] * fr }
  for (let f = FR - 1; f >= 0; f--) {
    const ox = 6 + f * 3.4; const oy = H - 8 - f * 1.6
    g.strokeStyle = alpha(C.text, 0.12 + 0.18 * (1 - Math.abs(f / (FR - 1) - pos))); g.beginPath()
    for (let i = 0; i < P; i++) { const x = ox + (i / (P - 1)) * sw; const y = oy - (T[f * TS + Math.floor(i / P * TS)] * 0.5 + 0.5) * hh; i ? g.lineTo(x, y) : g.moveTo(x, y) }
    g.stroke()
  }
  const f = pos * (FR - 1); const ox = 6 + f * 3.4; const oy = H - 8 - f * 1.6
  g.strokeStyle = on ? C.fg : C.dim; g.lineWidth = 1.8; g.shadowColor = C.fg; g.shadowBlur = on ? glow(7) : 0; g.beginPath()
  for (let i = 0; i < P; i++) { const x = ox + (i / (P - 1)) * sw; const y = oy - (frameAt(pos, i) * 0.5 + 0.5) * hh; i ? g.lineTo(x, y) : g.moveTo(x, y) }
  g.stroke(); g.shadowBlur = 0; g.lineWidth = 1
  g.fillStyle = C.amber; g.font = font(10)
  g.fillText((table.startsWith('user:') ? 'USER WAV' : table.toUpperCase()) + ' · ' + Math.round(pos * 100) + '%' + (get(k + 'Warp') !== 'off' ? ' · WARP ' + get(k + 'Warp').toUpperCase() : ''), 5, 11)
}
function drawGran (c, g, w, H) {
  const { get, tele } = c._gran
  const id = get('gSrc'); const src = sourceCache.get(id)
  if (!src) { g.fillStyle = C.dim; g.font = font(11); g.fillText('CARICAMENTO SORGENTE...', 8, 20); getSource(id).then(() => drawDisplays()).catch(() => {}); return }
  let pk = peaksCache.get(src)
  if (!pk) { pk = new Float32Array(300); const per = Math.floor(src.data.length / 300); for (let i = 0; i < 300; i++) { let m = 0; for (let j = i * per; j < (i + 1) * per; j++) m = Math.max(m, Math.abs(src.data[j])); pk[i] = m } peaksCache.set(src, pk) }
  const mid = H / 2
  g.strokeStyle = C.line; g.beginPath()
  for (let i = 0; i < 300; i++) { const x = (i / 300) * w; g.moveTo(x, mid - pk[i] * mid * 0.9); g.lineTo(x, mid + pk[i] * mid * 0.9) }
  g.stroke()
  const tl = tele()
  const pos = tl?.gpos ?? get('gPos'); const spray = get('gSpray')
  g.fillStyle = alpha(C.amber, .12); g.fillRect((pos - spray * 0.25) * w, 0, spray * 0.5 * w, H)
  g.strokeStyle = C.amber; g.beginPath(); g.moveTo(pos * w, 0); g.lineTo(pos * w, H); g.stroke()
  if (tl?.gr) { g.fillStyle = C.cyan; for (const p of tl.gr) { g.beginPath(); g.arc(p * w, mid + (Math.sin(p * 9e3) * 0.6) * mid, 2.5, 0, 7); g.fill() } }
  g.fillStyle = C.amber; g.font = font(10); g.fillText(`${(src.data.length / src.sr).toFixed(1)}s · POS ${Math.round(pos * 100)}% · ${tl?.gr?.length || 0} GRANI`, 5, 11)
}

// ---------------------------------------------------------------- FM / PIANO / DRUMS
function instDevice (t) {
  const inst = t.get('instrument'); const type = inst.get('type'); const params = inst.get('params')
  const def = INSTRUMENTS[type]; const tid = t.get('id')
  const get = (k) => getParam(params, k) ?? def.defaults[k]
  const set = (k, v, lab) => setParam(params, k, v, `${t.get('name')}: ${def.label.split(' ')[0]} ${lab}`, { track: tid })
  return h('div', { class: 'dev frame' },
    h('div', { class: 'dh' }, h('b', {}, def.label), presetSelect(t), h('span', { class: 'dim', style: { fontSize: '9px' } }, `MOD: ${params.get('__by') || t.get('by')}`)),
    h('div', { class: 'body' }, ...(SCHEMA[type] || []).map(gr => group(gr, get, set))))
}
function group (gr, get, set) {
  const row = h('div', { class: 'row' })
  for (const a of gr.k) { const k = knob(spec(a), () => get(a[0]), (v) => set(a[0], v, a[1])); knobs.push(k); row.append(k) }
  const head = h('div', { class: 't' }, gr.t)
  for (const [k, opts] of gr.sel || []) {
    head.append(h('select', { style: { fontSize: '10px' }, onchange: (e) => { const v = isNaN(+e.target.value) ? e.target.value : +e.target.value; set(k, v, k) } }, ...opts.map(o => { const op = h('option', { value: o }, String(o).toUpperCase()); if (get(k) == o) op.selected = true; return op })))
  }
  const box = h('div', { class: 'grp2' }, head)
  if (gr.env) { const c = h('canvas', { class: 'wt', style: { width: '160px', height: '36px' } }); c._env = { get, keys: ['aA', 'aD', 'aS', 'aR'] }; box.append(c) }
  box.append(row)
  return box
}

// ---------------------------------------------------------------- effetti
function fxDevice (t, f) {
  const type = f.get('type'); const def = FX[type]; const params = f.get('params')
  const get = (k) => getParam(params, k)
  const set = (k, v, lab) => setParam(params, k, v, `${t.get('name')}: ${def.label} ${lab}`, { track: t.get('id'), fx: f.get('id') })
  const row = h('div', { class: 'row' })
  for (const a of def.params) { const k = knob(spec(a), () => get(a[0]), (v) => set(a[0], v, a[1])); knobs.push(k); row.append(k) }
  return h('div', { class: 'dev frame' },
    h('div', { class: 'dh' },
      h('button', { class: f.get('on') ? 'on' : '', onclick: () => act(`${t.get('name')}: ${def.label} ${f.get('on') ? 'OFF' : 'ON'}`, () => f.set('on', !f.get('on'))) }, '⏻'),
      h('b', {}, def.label), h('span', { class: 'dim', style: { fontSize: '9px' } }, `DI ${f.get('by')}${params.get('__by') ? ' · MOD ' + params.get('__by') : ''}`),
      h('button', { class: 'x', onclick: () => removeFx(t.get('id'), f.get('id')) }, '✕')),
    h('div', { class: 'body' }, h('div', { class: 'grp2' }, row)))
}

// ---------------------------------------------------------------- ingresso audio
function audioInDevice (t) {
  const sel = h('select', { onchange: (e) => { localStorage.setItem('ayub_indev', e.target.value); toast('INGRESSO CAMBIATO — RICARICA LA PAGINA SE ERA GIÀ ATTIVO') } }, h('option', { value: '' }, 'DEFAULT'))
  listInputs().then(ds => { for (const d of ds) { const o = h('option', { value: d.deviceId }, (d.label || 'INGRESSO').toUpperCase()); if (localStorage.getItem('ayub_indev') === d.deviceId) o.selected = true; sel.append(o) } })
  const ch = h('select', { onchange: (e) => act(`${t.get('name')}: ingresso ${e.target.selectedOptions[0].text}`, () => t.set('input', +e.target.value)) },
    ...[['0', 'IN 1 (MONO)'], ['1', 'IN 2 (MONO)'], ['2', 'IN 1+2 (STEREO)']].map(([v, l]) => { const o = h('option', { value: v }, l); if (String(t.get('input') ?? 0) === v) o.selected = true; return o }))
  const lat = knob({ label: 'LAT IN', min: 0, max: 60, def: 6, unit: 'ms' }, () => E.latencyMs, (v) => { E.latencyMs = v; localStorage.setItem('ayub_inlat', v) })
  knobs.push(lat)
  return h('div', { class: 'dev frame' },
    h('div', { class: 'dh' }, h('b', {}, 'INGRESSO AUDIO')),
    h('div', { class: 'body' }, h('div', { class: 'grp2' },
      h('div', { class: 't' }, 'DISPOSITIVO'), sel, h('div', { class: 't' }, 'CANALE'), ch,
      h('button', { onclick: async () => { const e = await armInput(); toast(e || 'INGRESSO ATTIVO') } }, 'ATTIVA INGRESSO')),
    h('div', { class: 'grp2' }, h('div', { class: 't' }, 'COMPENSAZIONE'), h('div', { class: 'row' }, lat),
      h('div', { class: 'dim', style: { fontSize: '9px', maxWidth: '200px', textTransform: 'none' } }, 'Latenza ingresso stimata (ms). Le take vengono spostate indietro di uscita + questo valore. Se la take suona in ritardo, alza; se in anticipo, abbassa.'))))
}
