# AYUB CLOUD STUDIO — come condividerlo con la band

Il server è uno solo (`node server/server.js`, porta 8790): serve l'app, il login,
la sincronizzazione in tempo reale (websocket `/yjs/...`) e le registrazioni audio.
Tutti i dati stanno nella cartella `data/` (progetti + file WAV).

Variabili d'ambiente utili:

| variabile | default | a cosa serve |
|---|---|---|
| `STUDIO_PASSWORD` | (nessuno: se manca, ne viene generata una in `data/password`) | codice di accesso condiviso |
| `SESSION_SECRET` | file `data/secret` | firma dei cookie di sessione |
| `PORT` | `8790` | porta HTTP |
| `DATA_DIR` | `./data` | dove salvare progetti e audio |

Controllo rapido: `curl http://localhost:8790/healthz` → `ok`.

---

## a) Uso locale

```bash
~/Music/Ayub/cloud-studio.sh
```

Imposta la Scarlett come uscita, compila il frontend se manca `dist/`, avvia il
server in produzione e apre http://localhost:8790. Su `localhost` microfono e
MIDI funzionano anche senza HTTPS.

## b) Condividere subito dal proprio PC (Cloudflare Tunnel)

```bash
~/Music/Ayub/cloud-studio.sh          # lo studio deve essere già acceso
~/Music/Ayub/cloud/deploy/tunnel.sh   # Ctrl+C per chiudere
```

La prima volta scarica `cloudflared` in `~/.local/bin`. Nel log compare un link
`https://<qualcosa>.trycloudflare.com`: mandalo alla band insieme alla password.

- **Il link cambia ogni volta** che rilanci il tunnel.
- **Il PC deve restare acceso** (e lo studio avviato) finché gli altri lavorano.
- Il link è **HTTPS**, quindi microfono e MIDI funzionano anche per chi è a casa sua.
- ⚠ Il PC è raggiungibile da chiunque abbia il link: la protezione è solo la
  password. Prima di condividere metti una password seria:
  `STUDIO_PASSWORD=... NODE_ENV=production node server/server.js`.
  Dopo 8 tentativi sbagliati in 15 minuti un IP viene bloccato temporaneamente.

## c) Server sempre acceso: VPS (consigliato)

Un VPS piccolo basta, es. **Hetzner CX22** (~4-5 €/mese, 2 vCPU, 4 GB RAM, 40 GB disco).

1. **DNS**: crea un record `A` (es. `studio.tuodominio.it`) → IP del VPS.
2. **Docker** sul VPS (Debian/Ubuntu):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Copia il progetto** (senza `node_modules`, `dist`, `data`):
   ```bash
   rsync -av --exclude node_modules --exclude dist --exclude data \
     ~/Music/Ayub/cloud/ root@IP_DEL_VPS:/opt/ayub-cloud/
   ```
   (per portarti dietro i progetti esistenti copia anche `data/`.)
4. **Configura**:
   ```bash
   cd /opt/ayub-cloud
   cp .env.example .env
   nano .env        # DOMAIN, STUDIO_PASSWORD, SESSION_SECRET (openssl rand -hex 32)
   ```
5. **Avvia**:
   ```bash
   docker compose up -d
   docker compose logs -f
   ```
   Caddy ottiene da solo il certificato HTTPS: apri `https://studio.tuodominio.it`.
   Le porte 80 e 443 devono essere aperte nel firewall del VPS.

Aggiornare: ricopia i file e `docker compose up -d --build`.

**Backup** = la cartella `/opt/ayub-cloud/data/` (progetti `.ydoc`, `index.json`,
audio `.wav`). Ad esempio dal tuo PC:
`rsync -av root@IP_DEL_VPS:/opt/ayub-cloud/data/ ~/backup-ayub/`

Senza docker: c'è un esempio di unit systemd in `deploy/ayub-studio.service`
(serve comunque un reverse proxy HTTPS davanti, es. Caddy).

## d) Perché non Vercel (piano Hobby)

Lo studio ha bisogno di un processo sempre acceso con **websocket persistenti**
(la sincronizzazione in tempo reale tra i membri) e di un **disco persistente** per
progetti e registrazioni. Le funzioni serverless di Vercel sono effimere, non
tengono aperti websocket di lunga durata e non hanno un filesystem che sopravviva
tra una richiesta e l'altra: servirebbero servizi esterni (database, storage,
realtime) e il progetto andrebbe riscritto. Un VPS da 5 € fa tutto da solo.

## e) Come invitare la band

1. Apri il progetto e premi **CONDIVIDI**: copia il link del progetto
   (tipo `https://.../?p=nome-progetto-a1b2c3`).
2. Manda il link **e la password** (meglio su un canale diverso).
3. Chi apre il link arriva al login, inserisce **il proprio nome** e la password,
   e viene riportato direttamente su quel progetto.
4. Ogni modifica è etichettata con il nome di chi l'ha fatta.

Browser consigliati: **Chrome** o **Firefox** (desktop). Microfono e MIDI
richiedono **HTTPS** quando non si è su `localhost` (tunnel e VPS con Caddy lo sono).
