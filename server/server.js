// AYUB CLOUD STUDIO — server: auth, progetti, sync realtime (Yjs), audio storage
import express from 'express'
import cookieParser from 'cookie-parser'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { createMidiBridge, isLocalRequest } from './midibridge.js'

const require = createRequire(import.meta.url)
const Y = require('yjs') // stessa istanza CJS usata da y-websocket/bin/utils
const { setupWSConnection, setPersistence } = require('y-websocket/bin/utils')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data')
const PROJ = path.join(DATA, 'projects')
const AUDIO = path.join(DATA, 'audio')
for (const d of [DATA, PROJ, AUDIO]) fs.mkdirSync(d, { recursive: true })

const PORT = +process.env.PORT || 8790
// password: variabile STUDIO_PASSWORD, oppure il file DATA_DIR/password (mai nel codice: il repository è pubblico)
const pwFile = path.join(DATA, 'password')
if (!process.env.STUDIO_PASSWORD && !fs.existsSync(pwFile)) {
  fs.writeFileSync(pwFile, crypto.randomBytes(9).toString('base64url') + '\n', { mode: 0o600 })
  console.log('Nessuna password impostata: ne ho generata una in ' + pwFile)
}
const PASSWORD = process.env.STUDIO_PASSWORD || fs.readFileSync(pwFile, 'utf8').trim()
const PROD = process.env.NODE_ENV === 'production'
const secretFile = path.join(DATA, 'secret')
if (!process.env.SESSION_SECRET && !fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'))
const SECRET = process.env.SESSION_SECRET || fs.readFileSync(secretFile, 'utf8')

// ---------- persistenza Yjs su file ----------
const safeId = (s) => /^[a-z0-9-]{1,64}$/.test(s)
const projFile = (id) => path.join(PROJ, id + '.ydoc')
const metaFile = path.join(PROJ, 'index.json')
const readMeta = () => { try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')) } catch { return [] } }
const writeMeta = (m) => fs.writeFileSync(metaFile, JSON.stringify(m, null, 1))

const saveTimers = new Map()
function saveDoc (name, doc) {
  const tmp = projFile(name) + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(Y.encodeStateAsUpdate(doc)))
  fs.renameSync(tmp, projFile(name))
}
setPersistence({
  bindState: async (name, doc) => {
    if (fs.existsSync(projFile(name))) Y.applyUpdate(doc, fs.readFileSync(projFile(name)))
    // salvataggio a raffica: al massimo ogni 800 ms anche con modifiche continue (mai rinviato all'infinito)
    doc.on('update', () => {
      if (saveTimers.get(name)) return
      saveTimers.set(name, setTimeout(() => {
        saveTimers.delete(name)
        saveDoc(name, doc)
        const m = readMeta(); const p = m.find(x => x.id === name)
        if (p) { p.updated = Date.now(); writeMeta(m) }
      }, 800))
    })
  },
  writeState: async (name, doc) => { saveDoc(name, doc) }
})

// ---------- app ----------
const app = express()
// dietro Caddy (rete docker) / cloudflared (localhost): req.secure e req.ip corretti.
// Si fidano solo proxy su indirizzi locali/privati, cosi' un client esposto direttamente
// non puo' falsificare X-Forwarded-For per aggirare il limite sui tentativi di login.
// Override con TRUST_PROXY (es. "1" se il proxy e' su un IP pubblico).
const TP = process.env.TRUST_PROXY
app.set('trust proxy', TP ? (/^\d+$/.test(TP) ? +TP : TP) : 'loopback, linklocal, uniquelocal')
app.disable('x-powered-by')

// header di sicurezza di base (niente CSP: romperebbe Google Fonts / HMR di vite)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  next()
})

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'))

app.use(cookieParser(SECRET))
app.use(express.json({ limit: '1mb' }))

const userOf = (req) => req.signedCookies?.ayub_op || null
// solo percorsi relativi interni: "/..." ma non "//..." ne' "/\..."
const safeNext = (s) => (typeof s === 'string' && /^\/(?![\/\\])/.test(s) && !/[\r\n]/.test(s)) ? s : '/'

// ---------- anti brute-force sul login (in memoria, per IP) ----------
const MAX_FAILS = 8
const FAIL_WINDOW = 15 * 60 * 1000
const fails = new Map() // ip -> { n, first }
const failState = (ip) => {
  const f = fails.get(ip)
  if (f && Date.now() - f.first > FAIL_WINDOW) { fails.delete(ip); return null }
  return f || null
}
setInterval(() => { for (const ip of fails.keys()) failState(ip) }, 60 * 1000).unref()

app.post('/api/login', (req, res) => {
  const ip = req.ip
  const f = failState(ip)
  if (f && f.n >= MAX_FAILS) {
    const min = Math.max(1, Math.ceil((f.first + FAIL_WINDOW - Date.now()) / 60000))
    res.setHeader('Retry-After', String(min * 60))
    return res.status(429).json({ error: `TROPPI TENTATIVI. RIPROVA TRA ${min} MINUT${min === 1 ? 'O' : 'I'}.` })
  }
  const { name, password } = req.body || {}
  const n = String(name || '').trim().slice(0, 24)
  if (!n) return res.status(401).json({ error: 'NOME OPERATORE MANCANTE.' })
  if (typeof password !== 'string' || password !== PASSWORD) {
    if (f) f.n++; else fails.set(ip, { n: 1, first: Date.now() })
    return res.status(401).json({ error: 'ACCESSO NEGATO. CODICE NON VALIDO.' })
  }
  fails.delete(ip)
  res.cookie('ayub_op', n, {
    signed: true, httpOnly: true, sameSite: 'lax',
    secure: req.secure,
    maxAge: 1000 * 60 * 60 * 24 * 30
  })
  res.json({ ok: true, name: n })
})
app.post('/api/logout', (req, res) => { res.clearCookie('ayub_op', { httpOnly: true, sameSite: 'lax', secure: req.secure }); res.json({ ok: true }) })

app.get('/login', (req, res) => {
  // gia' loggato: vai direttamente alla destinazione
  if (userOf(req)) return res.redirect(safeNext(req.query.next))
  res.sendFile(path.join(ROOT, 'server', 'login.html'))
})

// tutto quello che segue richiede login
app.use((req, res, next) => {
  if (userOf(req)) return next()
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'login richiesto' })
  if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
    const target = safeNext(req.originalUrl)
    return res.redirect(target === '/' ? '/login' : '/login?next=' + encodeURIComponent(target))
  }
  // asset di vite/dev: lascia passare solo in dev (non contengono dati)
  if (!PROD) return next()
  res.status(401).end()
})

app.get('/m', (req, res) => res.redirect('/mobile.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')))
app.get('/api/me', (req, res) => res.json({ name: userOf(req), local: isLocalRequest(req) }))
// versione del frontend servito: il client confronta e propone di ricaricare
app.get('/api/version', (req, res) => {
  if (!PROD) return res.json({ v: 'dev' })
  try { const m = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8').match(/assets\/index-[^"]+\.js/); res.json({ v: m ? m[0] : '?' }) } catch { res.json({ v: '?' }) }
})

app.get('/api/projects', (req, res) => res.json(readMeta().sort((a, b) => b.updated - a.updated)))
app.post('/api/projects', (req, res) => {
  const name = String(req.body?.name || 'Senza titolo').slice(0, 60)
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + crypto.randomBytes(3).toString('hex')
  const m = readMeta()
  m.push({ id, name, by: userOf(req), created: Date.now(), updated: Date.now() })
  writeMeta(m)
  res.json({ id })
})

app.post('/api/audio', express.raw({ type: () => true, limit: '300mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'file vuoto' })
  const id = crypto.randomBytes(8).toString('hex')
  fs.writeFileSync(path.join(AUDIO, id + '.wav'), req.body)
  res.json({ id })
})
app.get('/api/audio/:id', (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.id)) return res.status(400).end()
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.sendFile(path.join(AUDIO, req.params.id + '.wav'))
})

const server = http.createServer(app)

// ---------- websocket Yjs ----------
const wss = new WebSocketServer({ noServer: true })
wss.on('connection', (ws, req, docName) => setupWSConnection(ws, req, { docName }))
const midiWss = process.env.MIDI_BRIDGE === '0' ? null : createMidiBridge()
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/midi')) {
    // ponte MIDI: solo dal browser di questo PC e con login valido
    const fk = { headers: req.headers }; cookieParser(SECRET)(fk, {}, () => {})
    if (!midiWss || !isLocalRequest(req) || !fk.signedCookies?.ayub_op) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return }
    midiWss.handleUpgrade(req, socket, head, (ws) => midiWss.emit('connection', ws, req))
    return
  }
  const m = req.url.match(/^\/yjs\/([a-z0-9-]+)/)
  if (!m) return // HMR di vite gestisce i suoi upgrade
  // verifica cookie firmato
  const fake = { headers: req.headers }
  cookieParser(SECRET)(fake, {}, () => {})
  if (!fake.signedCookies?.ayub_op || !safeId(m[1]) || !readMeta().some(p => p.id === m[1])) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, m[1]))
})

if (PROD) {
  app.use(express.static(path.join(ROOT, 'dist')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' })
  app.use(vite.middlewares)
}

server.listen(PORT, () => console.log(`AYUB CLOUD STUDIO  ->  http://localhost:${PORT}   (${PROD ? 'prod' : 'dev'})`))
