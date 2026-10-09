// Temi grafici: ALIEN (terminale Nostromo), MINIMAL (grigio tortora), PON PON (kawaii con mascotte)
export const THEMES = {
  alien: {
    label: 'ALIEN · NOSTROMO', dark: true, glow: true, font: '"Share Tech Mono"', big: 'VT323',
    bg: '#020604', bg2: '#030a06', bg3: '#05120a', rowB: '#030a06', g1: '#0b2615', g2: '#123b22', g3: '#1f5a33',
    line: '#2b7a45', text: '#57c97a', dim: '#2f7a4a', fg: '#8affa8', amber: '#ffb340', red: '#ff4a3d', cyan: '#5ce1ff',
    panel: '#010402', keyW: '#0a1f12', keyW2: '#0d2a17', keyB: '#020604', keyBLine: '#57c97a', ink: '#020604', sel: '#ffffff',
    knobTrack: '#1a4a2a', shade: 'rgba(0,0,0,.55)',
    title: 'INTERFACE 2037', sub: 'AYUB AUDIO SYSTEMS · MULTI-OP SEQ', empty: '> NESSUNA TRACCIA. PREMI "+ TRACCIA" PER INIZIARE_'
  },
  minimal: {
    label: 'MINIMAL · GRIGIO TORTORA', dark: false, glow: false, font: 'Inter', big: 'Inter',
    bg: '#efebe6', bg2: '#e6e1db', bg3: '#f4f1ed', rowB: '#e9e4de', g1: '#e2dcd5', g2: '#d3cbc2', g3: '#b9afa5',
    line: '#a89d92', text: '#6d625a', dim: '#9a8f86', fg: '#5b4f47', amber: '#b07d4f', red: '#c0533f', cyan: '#4f8a8c',
    panel: '#f6f3ef', keyW: '#fbf9f6', keyW2: '#f7f4f0', keyB: '#5c534c', keyBLine: '#5c534c', ink: '#2f2925', sel: '#2f2925',
    knobTrack: '#d8d1c9', shade: 'rgba(90,80,70,.10)',
    title: 'Ayub Studio', sub: 'sessione condivisa', empty: 'Nessuna traccia — premi "+ TRACCIA" per iniziare'
  },
  ponpon: {
    label: 'PON PON ☆ KAWAII', dark: false, glow: true, font: '"M PLUS Rounded 1c"', big: 'Fredoka',
    bg: '#fff4fa', bg2: '#ffe6f2', bg3: '#fffafc', rowB: '#fdeef6', g1: '#fbe1ee', g2: '#f6c9de', g3: '#ef9fc4',
    line: '#f08cbc', text: '#b04a85', dim: '#d58ab1', fg: '#ff4fa3', amber: '#20b2aa', red: '#ff3b6b', cyan: '#7a5cff',
    panel: '#ffffff', keyW: '#ffffff', keyW2: '#fff7fb', keyB: '#5a2d5c', keyBLine: '#5a2d5c', ink: '#4a1f47', sel: '#4a1f47',
    knobTrack: '#fbd3e6', shade: 'rgba(255,190,225,.40)',
    title: 'AYUB ☆ PON PON', sub: '♪ kawaii multi-player studio ♪', empty: '♡ nessuna traccia! premi "+ TRACCIA" ♡'
  }
}
export const C = { name: 'alien', ...THEMES.alien }

export function alpha (hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
// colori autore (neon) leggibili anche sui temi chiari
export function tc (hex) {
  if (C.dark || !hex || hex[0] !== '#') return hex
  const n = parseInt(hex.slice(1), 16); const k = C.name === 'ponpon' ? 0.62 : 0.5
  const r = Math.round((n >> 16) * k); const g = Math.round(((n >> 8) & 255) * k); const b = Math.round((n & 255) * k)
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}
export const glow = (px) => C.glow ? px : 0
export const font = (px, big) => `${px}px ${big ? C.big : C.font}, ${C.dark ? 'monospace' : 'sans-serif'}`
// colori traccia: nel tema minimal attenuati verso il tortora
export function trk (hex) {
  if (C.name !== 'minimal' || !hex || hex[0] !== '#') return hex
  const n = parseInt(hex.slice(1), 16); const t = [0xc9, 0xbf, 0xb4]; const k = 0.55
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * (1 - k) + t[i] * k))
  return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)
}

const listeners = new Set()
export const onTheme = (f) => listeners.add(f)
export function setTheme (name) {
  if (!THEMES[name]) name = 'alien'
  Object.assign(C, THEMES[name], { name })
  document.documentElement.dataset.theme = name
  try { localStorage.setItem('ayub_theme', name) } catch {}
  const t = document.querySelector('header .logo b'); if (t) t.textContent = C.title
  const s = document.querySelector('header .logo span'); if (s) s.textContent = C.sub
  listeners.forEach(f => f(name))
}
export function initTheme () {
  // quando i font web finiscono di caricare, ridisegna i canvas
  document.fonts?.addEventListener?.('loadingdone', () => listeners.forEach(f => f(C.name)))
  let n = 'alien'; try { n = localStorage.getItem('ayub_theme') || 'alien' } catch {}
  setTheme(n)
}
