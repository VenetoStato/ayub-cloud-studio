// Mascotte del tema PON PON: due personaggi chibi originali (MIKA e RORO) che girano per lo schermo
// e ballano a tempo quando il brano suona. Solo grafica: pointer-events disattivati, non bloccano mai i click.

const SKIN = '#ffe4d2'
function face (eye) {
  return `
  <g class="blink"><ellipse cx="40" cy="46" rx="5.5" ry="7" fill="${eye}"/><ellipse cx="60" cy="46" rx="5.5" ry="7" fill="${eye}"/>
  <circle cx="38.3" cy="43.5" r="2.2" fill="#fff"/><circle cx="58.3" cy="43.5" r="2.2" fill="#fff"/><circle cx="41.5" cy="49" r="1" fill="#fff"/><circle cx="61.5" cy="49" r="1" fill="#fff"/></g>
  <ellipse cx="33" cy="55" rx="5" ry="2.6" fill="#ff9fc4" opacity=".7"/><ellipse cx="67" cy="55" rx="5" ry="2.6" fill="#ff9fc4" opacity=".7"/>
  <path d="M46 57 Q50 61 54 57" stroke="#a3345d" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
}
const star = (x, y, c) => `<path transform="translate(${x} ${y}) scale(.55)" d="M0-10 L3-3 L10-3 L4.5 1.5 L6.5 9 L0 4.5 L-6.5 9 L-4.5 1.5 L-10-3 L-3-3Z" fill="${c}" stroke="#fff" stroke-width="1.5"/>`

// MIKA: codini lunghi acqua, mollette a stella, top bianco con bordo acqua, gonna blu notte
const MIKA = `<svg viewBox="0 0 100 135" width="W" height="H">
  <g class="tail l" style="transform-origin:24px 34px"><path d="M24 30 C4 46 6 80 12 118 C14 126 22 126 22 116 C20 86 22 58 30 40Z" fill="#2fbfb4"/><path d="M15 60 C13 80 15 98 17 112" stroke="#7fe8df" stroke-width="2" fill="none"/></g>
  <g class="tail r" style="transform-origin:76px 34px"><path d="M76 30 C96 46 94 80 88 118 C86 126 78 126 78 116 C80 86 78 58 70 40Z" fill="#2fbfb4"/><path d="M85 60 C87 80 85 98 83 112" stroke="#7fe8df" stroke-width="2" fill="none"/></g>
  <path d="M38 92 L34 116 L44 116 L46 94Z M62 92 L66 116 L56 116 L54 94Z" fill="${SKIN}"/>
  <rect x="31" y="113" width="14" height="9" rx="4" fill="#2a8f88"/><rect x="55" y="113" width="14" height="9" rx="4" fill="#2a8f88"/>
  <path d="M34 72 L66 72 L70 96 L30 96Z" fill="#30365a"/>
  <path d="M36 66 L64 66 L66 82 L34 82Z" fill="#f4f7f8"/><path d="M42 66 L50 74 L58 66" fill="none" stroke="#2fbfb4" stroke-width="3"/>
  <g class="arm" style="transform-origin:66px 70px"><path d="M64 68 Q78 60 80 50" stroke="${SKIN}" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="80" cy="49" r="4" fill="${SKIN}"/></g>
  <path d="M36 70 Q26 80 28 88" stroke="${SKIN}" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="50" cy="44" r="26" fill="${SKIN}"/>
  <path d="M24 46 C22 22 38 12 50 12 C64 12 80 22 76 46 C74 36 70 30 66 28 L62 38 L56 28 L50 38 L44 28 L38 38 L34 29 C30 32 26 38 24 46Z" fill="#2fbfb4"/>
  ${face('#1f6f75')}
  ${star(27, 30, '#ffd23f')}${star(73, 30, '#ffd23f')}
</svg>`

// RORO: capelli rossi con due boccoli a spirale, basco bordeaux, top nero con bordo rosso, gonna rossa
const drill = (x) => `<g><circle cx="${x}" cy="62" r="8" fill="#e0344b"/><circle cx="${x}" cy="74" r="7" fill="#e84a5f"/><circle cx="${x}" cy="85" r="6" fill="#e0344b"/><circle cx="${x}" cy="94" r="4.5" fill="#e84a5f"/>
  <path d="M${x - 6} 60 Q${x} 66 ${x + 6} 60 M${x - 5} 72 Q${x} 78 ${x + 5} 72 M${x - 4} 83 Q${x} 88 ${x + 4} 83" stroke="#ff8a9a" stroke-width="1.4" fill="none"/></g>`
const RORO = `<svg viewBox="0 0 100 135" width="W" height="H">
  <g class="tail l" style="transform-origin:22px 50px">${drill(20)}</g>
  <g class="tail r" style="transform-origin:78px 50px">${drill(80)}</g>
  <path d="M38 92 L35 116 L45 116 L46 94Z M62 92 L65 116 L55 116 L54 94Z" fill="${SKIN}"/>
  <rect x="32" y="113" width="14" height="9" rx="4" fill="#3a1b2a"/><rect x="54" y="113" width="14" height="9" rx="4" fill="#3a1b2a"/>
  <path d="M34 74 L66 74 L71 97 L29 97Z" fill="#e0344b"/><path d="M30 94 L70 94" stroke="#fff" stroke-width="2" stroke-dasharray="3 3"/>
  <path d="M36 66 L64 66 L66 80 L34 80Z" fill="#2b2433"/><path d="M36 66 L64 66" stroke="#e0344b" stroke-width="3"/>
  <g class="arm" style="transform-origin:34px 70px"><path d="M36 68 Q22 60 20 50" stroke="${SKIN}" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="20" cy="49" r="4" fill="${SKIN}"/></g>
  <path d="M64 70 Q74 80 72 88" stroke="${SKIN}" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="50" cy="44" r="26" fill="${SKIN}"/>
  <path d="M24 50 C20 24 36 13 50 13 C66 13 82 24 76 50 C74 40 68 32 62 30 C60 36 54 38 48 34 C44 38 36 38 33 32 C28 36 25 42 24 50Z" fill="#e0344b"/>
  <ellipse cx="58" cy="17" rx="20" ry="7" fill="#9e1630" transform="rotate(12 58 17)"/><circle cx="62" cy="9" r="3" fill="#9e1630"/>
  ${face('#8a1d2e')}
</svg>`

let layer = null; let raf = 0; let sprites = []; let lastT = 0; let lastBeat = -1
export function startMascots (getBeat, isPlaying) {
  if (layer) return
  layer = document.createElement('div'); layer.id = 'mascots'; document.body.append(layer)
  const defs = [[MIKA, 112], [RORO, 108], [MIKA, 72], [RORO, 70]]
  sprites = defs.map(([svg, hgt], i) => {
    const el = document.createElement('div'); el.className = 'm'
    el.innerHTML = svg.replace('width="W"', `width="${hgt * 100 / 135}"`).replace('height="H"', `height="${hgt}"`)
    layer.append(el)
    const s = { el, w: hgt * 100 / 135, h: hgt, x: 80 + Math.random() * (innerWidth - 240), y: 80 + Math.random() * (innerHeight - 260), tx: 0, ty: 0, pause: Math.random() * 2, dir: 1, ph: Math.random() * 6, hop: 0 }
    pick(s); return s
  })
  const loop = (t) => {
    raf = requestAnimationFrame(loop)
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t
    const playing = isPlaying(); const beat = getBeat()
    const onBeat = playing && Math.floor(beat) !== lastBeat
    if (playing) lastBeat = Math.floor(beat)
    for (const s of sprites) {
      if (s.pause > 0) s.pause -= dt
      else {
        const dx = s.tx - s.x; const dy = s.ty - s.y; const d = Math.hypot(dx, dy)
        const sp = (playing ? 70 : 38) * (s.h > 90 ? 1 : 1.3)
        if (d < 4) { pick(s); if (Math.random() < 0.4) s.pause = 1 + Math.random() * 3 } else { s.x += dx / d * sp * dt; s.y += dy / d * sp * dt; if (Math.abs(dx) > 2) s.dir = dx > 0 ? 1 : -1 }
      }
      if (onBeat) { s.hop = 1; if (Math.random() < 0.18) spark(s) }
      s.hop = Math.max(0, s.hop - dt * 3.2)
      const bob = playing ? -Math.sin(s.hop * Math.PI) * 14 : Math.sin(t / 380 + s.ph) * 3
      const squash = playing ? 1 - Math.sin(s.hop * Math.PI) * -0.06 : 1
      s.el.style.transform = `translate(${s.x}px,${s.y + bob}px) scale(${s.dir * (2 - squash)},${squash})`
      if (!playing && Math.random() < dt * 0.05) spark(s)
    }
  }
  raf = requestAnimationFrame(loop)
}
function pick (s) { s.tx = 20 + Math.random() * (innerWidth - s.w - 40); s.ty = 60 + Math.random() * (innerHeight - s.h - 80) }
function spark (s) {
  const e = document.createElement('div'); e.className = 'fx'
  e.textContent = ['♪', '♡', '★', '♫', '✿'][Math.floor(Math.random() * 5)]
  e.style.left = (s.x + s.w * (0.2 + Math.random() * 0.6)) + 'px'; e.style.top = (s.y - 6) + 'px'
  e.style.color = ['#ff5fa2', '#20b2aa', '#ffb000', '#7a5cff'][Math.floor(Math.random() * 4)]
  layer.append(e); setTimeout(() => e.remove(), 3300)
}
export function stopMascots () { cancelAnimationFrame(raf); raf = 0; layer?.remove(); layer = null; sprites = [] }
