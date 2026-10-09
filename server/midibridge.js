// Ponte MIDI locale: legge le tastiere collegate a QUESTO PC via ALSA (aseqdump) e le inoltra al browser.
// Serve quando il browser non vede il MIDI (es. Firefox snap senza permesso ALSA).
// Solo per connessioni locali: mai verso utenti remoti (tunnel/proxy).
import { spawn, execFile } from 'node:child_process'
import { WebSocketServer } from 'ws'

const SKIP = process.env.MIDI_THROUGH === '1' ? /^(System|PipeWire|Timer|Announce)/i : /^(System|Midi Through|PipeWire|Timer|Announce)/i
export function isLocalRequest (req) {
  const ip = req.socket.remoteAddress || ''
  const loop = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  const proxied = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip']
  const host = (req.headers.host || '').split(':')[0]
  return loop && !proxied && (host === 'localhost' || host === '127.0.0.1')
}

export function createMidiBridge () {
  const wss = new WebSocketServer({ noServer: true })
  const procs = new Map() // port -> {proc, name}
  let devices = []
  const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1) c.send(s) }

  function parse (name, line) {
    // " 24:0   Note on                 0, note 60, velocity 100"
    const m = line.match(/^\s*\d+:\d+\s+(Note on|Note off|Control change|Pitch bend|Channel aftertouch|Program change)\s+(\d+),\s*(.*)$/)
    if (!m) return
    const ch = +m[2] & 15; const rest = m[3]; const num = (k) => +((rest.match(new RegExp(k + ' (-?\\d+)')) || [])[1] || 0)
    let d = null
    switch (m[1]) {
      case 'Note on': d = [0x90 | ch, num('note'), num('velocity')]; break
      case 'Note off': d = [0x80 | ch, num('note'), num('velocity')]; break
      case 'Control change': d = [0xb0 | ch, num('controller'), num('value')]; break
      case 'Pitch bend': { const v = num('value') + 8192; d = [0xe0 | ch, v & 127, (v >> 7) & 127]; break }
      case 'Channel aftertouch': d = [0xd0 | ch, num('value')]; break
      case 'Program change': d = [0xc0 | ch, num('program')]; break
    }
    if (d) broadcast({ t: 'midi', dev: name, d })
  }

  function scan () {
    execFile('aseqdump', ['-l'], { timeout: 3000 }, (err, out) => {
      if (err) return
      const found = []
      for (const line of out.split('\n').slice(1)) {
        const m = line.match(/^\s*(\d+:\d+)\s+(.+?)\s{2,}(.+)$/)
        if (m && !SKIP.test(m[2])) found.push({ port: m[1], name: m[2].trim() })
      }
      for (const f of found) {
        if (procs.has(f.port)) continue
        const p = spawn('aseqdump', ['-p', f.port], { stdio: ['ignore', 'pipe', 'ignore'] })
        let buf = ''
        p.stdout.on('data', (chunk) => { buf += chunk; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) parse(f.name, l) })
        p.on('exit', () => { procs.delete(f.port); update() })
        procs.set(f.port, { proc: p, name: f.name })
      }
      for (const [port, v] of procs) if (!found.some(f => f.port === port)) { v.proc.kill(); procs.delete(port) }
      update()
    })
  }
  function update () {
    const names = [...procs.values()].map(v => v.name)
    if (names.join() !== devices.join()) { devices = names; broadcast({ t: 'devices', devices }) }
  }
  scan(); setInterval(scan, 4000)
  wss.on('connection', (ws) => ws.send(JSON.stringify({ t: 'devices', devices })))
  process.on('exit', () => { for (const v of procs.values()) v.proc.kill() })
  return wss
}
