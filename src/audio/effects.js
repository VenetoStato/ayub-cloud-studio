// Effetti (Tone.js). Ogni effetto: { node(s), set(k,v) } + schema parametri per la UI.
import * as Tone from 'tone'

// p: [key, label, min, max, default, unit, scale('lin'|'log'), options?]
export const FX = {
  eq: {
    label: 'EQ 3', params: [['low', 'LOW', -24, 12, 0, 'dB'], ['mid', 'MID', -24, 12, 0, 'dB'], ['high', 'HIGH', -24, 12, 0, 'dB'], ['lowF', 'LO FREQ', 60, 800, 250, 'Hz', 'log'], ['highF', 'HI FREQ', 1500, 12000, 3500, 'Hz', 'log']],
    make: () => new Tone.EQ3(),
    set: (n, k, v) => { if (k === 'lowF') n.lowFrequency.value = v; else if (k === 'highF') n.highFrequency.value = v; else n[k].value = v }
  },
  comp: {
    label: 'COMPRESSORE', params: [['threshold', 'THRESH', -60, 0, -18, 'dB'], ['ratio', 'RATIO', 1, 20, 4, ':1'], ['attack', 'ATTACK', 0.001, 0.3, 0.01, 's', 'log'], ['release', 'RELEASE', 0.02, 1, 0.15, 's', 'log'], ['makeup', 'MAKEUP', 0, 24, 3, 'dB']],
    make: () => { const c = new Tone.Compressor(); const g = new Tone.Gain(); c.connect(g); return { input: c, output: g, c, g } },
    set: (n, k, v) => { if (k === 'makeup') n.g.gain.value = Tone.dbToGain(v); else n.c[k].value = v }
  },
  reverb: {
    label: 'RIVERBERO', params: [['decay', 'DECAY', 0.3, 12, 2.8, 's', 'log'], ['preDelay', 'PRE-DLY', 0, 0.2, 0.02, 's'], ['wet', 'DRY/WET', 0, 1, 0.3, '']],
    make: () => new Tone.Reverb({ decay: 2.8 }),
    set: (n, k, v) => {
      if (k === 'wet') n.wet.value = v
      else { n[k] = v; clearTimeout(n._t); n._t = setTimeout(() => n.generate(), 250) }
    }
  },
  delay: {
    label: 'DELAY', params: [['time', 'TEMPO', 0, 5, 2, '', 'lin', ['1/16', '1/8', '1/8.', '1/4', '1/4.', '1/2']], ['feedback', 'FEEDBACK', 0, 0.95, 0.35, ''], ['pingpong', 'PING-PONG', 0, 1, 1, '', 'lin', ['NO', 'SI']], ['tone', 'TONO', 500, 16000, 5000, 'Hz', 'log'], ['wet', 'DRY/WET', 0, 1, 0.25, '']],
    make: () => {
      const pp = new Tone.PingPongDelay('8n', 0.35); const fd = new Tone.FeedbackDelay('8n', 0.35)
      const inp = new Tone.Gain(); const out = new Tone.Filter(5000, 'lowpass')
      inp.connect(pp); inp.connect(fd); pp.connect(out); fd.connect(out)
      return { input: inp, output: out, pp, fd, out, mode: 1 }
    },
    set: (n, k, v) => {
      const tm = ['16n', '8n', '8n.', '4n', '4n.', '2n']
      if (k === 'time') { n.pp.delayTime.value = tm[Math.round(v)]; n.fd.delayTime.value = tm[Math.round(v)] } else if (k === 'feedback') { n.pp.feedback.value = v; n.fd.feedback.value = v } else if (k === 'tone') n.out.frequency.value = v
      else if (k === 'pingpong') { n.mode = Math.round(v); apply(n) } else if (k === 'wet') { n.w = v; apply(n) }
      function apply (n) { n.pp.wet.value = n.mode ? (n.w ?? 0.25) : 0; n.fd.wet.value = n.mode ? 0 : (n.w ?? 0.25) }
    }
  },
  chorus: {
    label: 'CHORUS', params: [['frequency', 'RATE', 0.05, 8, 1.5, 'Hz', 'log'], ['depth', 'DEPTH', 0, 1, 0.6, ''], ['delayTime', 'DELAY', 2, 20, 3.5, 'ms'], ['spread', 'SPREAD', 0, 180, 180, '°'], ['wet', 'DRY/WET', 0, 1, 0.5, '']],
    make: () => new Tone.Chorus(1.5, 3.5, 0.6).start(),
    set: (n, k, v) => { if (k === 'frequency' || k === 'wet') n[k].value = v; else n[k] = v }
  },
  phaser: {
    label: 'PHASER', params: [['frequency', 'RATE', 0.05, 8, 0.5, 'Hz', 'log'], ['octaves', 'OTTAVE', 1, 6, 3, ''], ['baseFrequency', 'BASE', 100, 2000, 350, 'Hz', 'log'], ['Q', 'RISON.', 0.5, 20, 10, ''], ['wet', 'DRY/WET', 0, 1, 0.5, '']],
    make: () => new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350 }),
    set: (n, k, v) => { if (k === 'octaves' || k === 'baseFrequency') n[k] = v; else n[k].value = v }
  },
  dist: {
    label: 'SATURATORE', params: [['distortion', 'DRIVE', 0, 1, 0.4, ''], ['tone', 'TONO', 800, 18000, 8000, 'Hz', 'log'], ['out', 'OUTPUT', -24, 6, -4, 'dB'], ['wet', 'DRY/WET', 0, 1, 1, '']],
    make: () => { const d = new Tone.Distortion({ distortion: 0.4, oversample: '2x' }); const f = new Tone.Filter(8000, 'lowpass'); const g = new Tone.Gain(Tone.dbToGain(-4)); d.connect(f); f.connect(g); return { input: d, output: g, d, f, g } },
    set: (n, k, v) => { if (k === 'distortion') n.d.distortion = v; else if (k === 'wet') n.d.wet.value = v; else if (k === 'tone') n.f.frequency.value = v; else n.g.gain.value = Tone.dbToGain(v) }
  },
  filter: {
    label: 'FILTRO', params: [['frequency', 'CUTOFF', 20, 20000, 2000, 'Hz', 'log'], ['Q', 'RESON.', 0.1, 18, 1, ''], ['type', 'TIPO', 0, 2, 0, '', 'lin', ['LP', 'HP', 'BP']], ['rolloff', 'PENDENZA', 0, 2, 1, '', 'lin', ['12', '24', '48']]],
    make: () => new Tone.Filter({ frequency: 2000, rolloff: -24 }),
    set: (n, k, v) => {
      if (k === 'type') n.type = ['lowpass', 'highpass', 'bandpass'][Math.round(v)]
      else if (k === 'rolloff') n.rolloff = [-12, -24, -48][Math.round(v)]
      else n[k].value = v
    }
  },
  autofilter: {
    label: 'AUTO FILTER', params: [['frequency', 'RATE', 0.05, 16, 1, 'Hz', 'log'], ['depth', 'DEPTH', 0, 1, 0.8, ''], ['baseFrequency', 'BASE', 40, 2000, 200, 'Hz', 'log'], ['octaves', 'OTTAVE', 0.5, 7, 3.5, ''], ['wet', 'DRY/WET', 0, 1, 1, '']],
    make: () => new Tone.AutoFilter({ frequency: 1, baseFrequency: 200, octaves: 3.5 }).start(),
    set: (n, k, v) => { if (k === 'baseFrequency' || k === 'octaves') n[k] = v; else n[k].value = v }
  },
  crusher: {
    label: 'BITCRUSHER', params: [['bits', 'BITS', 1, 16, 6, ''], ['wet', 'DRY/WET', 0, 1, 0.6, '']],
    make: () => new Tone.BitCrusher(6),
    set: (n, k, v) => { if (k === 'bits') n.bits.value = Math.round(v); else n.wet.value = v }
  },
  widener: {
    label: 'STEREO WIDTH', params: [['width', 'WIDTH', 0, 1, 0.7, '']],
    make: () => new Tone.StereoWidener(0.7),
    set: (n, k, v) => { n.width.value = v }
  },
  tremolo: {
    label: 'TREMOLO/PAN', params: [['frequency', 'RATE', 0.1, 16, 4, 'Hz', 'log'], ['depth', 'DEPTH', 0, 1, 0.6, ''], ['spread', 'STEREO', 0, 180, 90, '°'], ['wet', 'DRY/WET', 0, 1, 1, '']],
    make: () => new Tone.Tremolo(4, 0.6).start(),
    set: (n, k, v) => { if (k === 'spread') n.spread = v; else n[k].value = v }
  },
  limiter: {
    label: 'LIMITER', params: [['threshold', 'CEILING', -24, 0, -1, 'dB'], ['gain', 'GAIN', 0, 18, 0, 'dB']],
    make: () => { const g = new Tone.Gain(); const l = new Tone.Limiter(-1); g.connect(l); return { input: g, output: l, g, l } },
    set: (n, k, v) => { if (k === 'gain') n.g.gain.value = Tone.dbToGain(v); else n.l.threshold.value = v }
  }
}

export const fxDefaults = (type) => Object.fromEntries(FX[type].params.map(p => [p[0], p[4]]))

export function makeFx (type, params) {
  const def = FX[type]
  const n = def.make()
  const node = { type, n, input: n.input || n, output: n.output || n }
  node.set = (k, v) => { try { def.set(n, k, v) } catch (e) { console.warn('fx', type, k, e) } }
  for (const [k, v] of Object.entries({ ...fxDefaults(type), ...params })) node.set(k, v)
  // wrapper {input, output, ...}: chiudi i nodi interni; nodo Tone singolo: dispose diretto
  // (mai iterare le proprietà di un nodo Tone: contiene .context e lo chiuderebbe)
  node.dispose = () => {
    if (typeof n.dispose === 'function') n.dispose()
    else for (const x of Object.values(n)) if (x && x.name && typeof x.dispose === 'function' && x !== x.context) x.dispose()
  }
  return node
}
