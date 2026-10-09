// Generatore di wavetable band-limited (mipmap per ottava). Usato nel Web Worker, mai nel thread audio.
export const TS = 2048 // campioni per frame
export const FR = 16 // frame per tabella
export const MIPS = [512, 256, 128, 64, 32, 16, 8, 4, 2, 1] // armoniche massime per livello

const TWO_PI = Math.PI * 2
const frac = (x) => x - Math.floor(x)

// definizioni: harm(f, n) = ampiezza seno dell'armonica n (dominio frequenza)
//              wave(f, ph) = campione nel tempo (verrà analizzato e band-limitato)
export const TABLE_DEFS = {
  basic: { label: 'BASIC SHAPES', harm: (f, n) => { // sine -> tri -> saw -> square
    const sine = n === 1 ? 1 : 0
    const tri = n % 2 ? (8 / (Math.PI * Math.PI)) / (n * n) * (((n - 1) / 2) % 2 ? -1 : 1) : 0
    const saw = 2 / (Math.PI * n) * (n % 2 ? 1 : -1)
    const sq = n % 2 ? 4 / (Math.PI * n) : 0
    const seg = f * 3; const i = Math.min(2, Math.floor(seg)); const x = seg - i
    const s = [sine, tri, saw, sq]; return s[i] * (1 - x) + s[i + 1] * x
  } },
  pwm: { label: 'PULSE WIDTH', harm: (f, n) => { const w = 0.5 - f * 0.47; return 2 * Math.sin(Math.PI * n * w) / (Math.PI * n) } },
  sync: { label: 'HARD SYNC', wave: (f, ph) => frac(ph * (1 + f * 7)) * 2 - 1 },
  fm: { label: 'FM SWEEP', wave: (f, ph) => Math.sin(TWO_PI * ph + f * 7 * Math.sin(TWO_PI * ph * 2)) },
  fold: { label: 'WAVEFOLDER', wave: (f, ph) => { let x = Math.sin(TWO_PI * ph) * (1 + f * 6); for (let k = 0; k < 6; k++) { if (x > 1) x = 2 - x; else if (x < -1) x = -2 - x } return x } },
  vocal: { label: 'VOCAL FORMANT', harm: (f, n) => { // a -> e -> i -> o -> u
    const V = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]]
    const s = f * 4; const i = Math.min(3, Math.floor(s)); const x = s - i
    const F = V[i].map((v, k) => v * (1 - x) + V[i + 1][k] * x)
    const hz = n * 110 // spettro pensato per A2: le formanti si spostano con l'altezza, come una voce
    const g = (c, w) => Math.exp(-((hz - c) ** 2) / (2 * w * w))
    return (1 / Math.sqrt(n)) * (0.04 + g(F[0], 90) * 1.6 + g(F[1], 130) * 1.0 + g(F[2], 180) * 0.6)
  } },
  digital: { label: 'DIGITAL GRIT', harm: (f, n) => Math.abs(Math.sin(n * (1.3 + f * 9.7))) * Math.pow(n, -0.65) * (Math.cos(n * f * 3.1) > -0.2 ? 1 : -1) },
  hyper: { label: 'HYPERSAW', harm: (f, n) => Math.pow(n, -(1.6 - f * 1.25)) * (n % 2 ? 1 : 1 - f * 0.9) },
  organ: { label: 'DRAWBAR ORGAN', harm: (f, n) => { const bars = [1, 2, 3, 4, 6, 8, 10, 12, 16]; const k = bars.indexOf(n); return k < 0 ? 0 : Math.pow(0.65, k * (1 - f)) * (k <= Math.round(f * 8) ? 1 : 0.12) } },
  metal: { label: 'METAL', harm: (f, n) => { const r = (n * 7919 % 97) / 97; return (r > 0.6 - f * 0.45 ? 1 : 0) * Math.pow(n, -0.55) } },
  growl: { label: 'GROWL', wave: (f, ph) => { const m = Math.sin(TWO_PI * ph * 3) * (0.5 + f * 4); return Math.tanh(Math.sin(TWO_PI * ph + m) * (1 + f * 3)) } },
  chip: { label: 'CHIPTUNE', wave: (f, ph) => { const steps = Math.round(2 + (1 - f) * 14); const w = 0.125 + f * 0.375; return Math.round((ph < w ? 1 : -1) * steps * Math.sin(TWO_PI * ph * 0.5 + 0.3) ) / steps } }
}
export const TABLE_NAMES = Object.keys(TABLE_DEFS)

const SIN = new Float32Array(TS); const COS = new Float32Array(TS)
for (let i = 0; i < TS; i++) { SIN[i] = Math.sin(TWO_PI * i / TS); COS[i] = Math.cos(TWO_PI * i / TS) }

// analisi (DFT troncata) di un ciclo di TS campioni -> coefficienti a(sin), b(cos)
function analyse (x) {
  const H = MIPS[0]; const a = new Float32Array(H + 1); const b = new Float32Array(H + 1)
  for (let n = 1; n <= H; n++) {
    let sa = 0; let sb = 0
    for (let i = 0, k = 0; i < TS; i++, k = (k + n) & (TS - 1)) { sa += x[i] * SIN[k]; sb += x[i] * COS[k] }
    a[n] = sa * 2 / TS; b[n] = sb * 2 / TS
  }
  return { a, b }
}
// sintesi additiva di un frame limitato a H armoniche
function synth (a, b, H, out, off) {
  for (let i = 0; i < TS; i++) out[off + i] = 0
  for (let n = 1; n <= H; n++) {
    const an = a[n]; const bn = b ? b[n] : 0
    if (Math.abs(an) < 1e-6 && Math.abs(bn) < 1e-6) continue
    for (let i = 0, k = 0; i < TS; i++, k = (k + n) & (TS - 1)) out[off + i] += an * SIN[k] + bn * COS[k]
  }
}

// frames: array di FR coppie {a,b}; ritorna {mips: Float32Array[MIPS.length] (FR*TS ciascuno), preview}
function buildFromSpectra (spectra) {
  const mips = MIPS.map(() => new Float32Array(FR * TS))
  const gains = []
  for (let f = 0; f < FR; f++) {
    synth(spectra[f].a, spectra[f].b, MIPS[0], mips[0], f * TS)
    let mx = 1e-9; for (let i = 0; i < TS; i++) mx = Math.max(mx, Math.abs(mips[0][f * TS + i]))
    gains[f] = 1 / mx
    for (let i = 0; i < TS; i++) mips[0][f * TS + i] *= gains[f]
  }
  for (let m = 1; m < MIPS.length; m++) {
    for (let f = 0; f < FR; f++) {
      synth(spectra[f].a, spectra[f].b, MIPS[m], mips[m], f * TS)
      for (let i = 0; i < TS; i++) mips[m][f * TS + i] *= gains[f]
    }
  }
  return { mips }
}

export function buildTable (name) {
  const def = TABLE_DEFS[name] || TABLE_DEFS.basic
  const spectra = []
  for (let f = 0; f < FR; f++) {
    const fp = f / (FR - 1)
    if (def.harm) {
      const a = new Float32Array(MIPS[0] + 1)
      for (let n = 1; n <= MIPS[0]; n++) a[n] = def.harm(fp, n)
      spectra.push({ a, b: null })
    } else {
      const x = new Float32Array(TS)
      for (let i = 0; i < TS; i++) x[i] = def.wave(fp, i / TS)
      spectra.push(analyse(x))
    }
  }
  return buildFromSpectra(spectra)
}

// wavetable da un file audio qualsiasi (stile "import" di Serum): FR frame da TS campioni presi lungo il file
export function buildFromAudio (data) {
  const spectra = []
  const span = Math.max(0, data.length - TS)
  for (let f = 0; f < FR; f++) {
    const start = Math.floor(span * f / (FR - 1))
    const x = new Float32Array(TS)
    for (let i = 0; i < TS; i++) x[i] = data[start + i] || 0
    // finestra di raccordo ai bordi: evita il click di ciclo
    for (let i = 0; i < 64; i++) { const w = i / 64; x[i] = x[i] * w + x[TS - 64 + i] * (1 - w) }
    let dc = 0; for (let i = 0; i < TS; i++) dc += x[i]; dc /= TS; for (let i = 0; i < TS; i++) x[i] -= dc
    spectra.push(analyse(x))
  }
  return buildFromSpectra(spectra)
}
