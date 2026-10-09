# AYUB CLOUD STUDIO — INTERFACE 2037

DAW nel browser per suonare e registrare **insieme in tempo reale**, pensata per una band.
L'audio gira sul computer (o telefono) di ciascuno, quindi la latenza è quella della propria scheda audio;
il server sincronizza solo il progetto. Ogni modifica è firmata con il nome di chi l'ha fatta.

- **Collaborazione live** (Yjs): tracce, clip, note, effetti, registro modifiche, presenza, annulla solo le proprie modifiche
- **XWAVE**: synth wavetable stile Serum (morph, 8 warp, unison 16, filtri SVF/ladder/comb, 3 inviluppi, 2 LFO, matrice di modulazione, oversampling 2x), 25 preset con catene effetti
- **GRANULAR**: synth granulare su sorgenti incluse, take registrate o file caricati
- FM, pianoforte campionato, drum rack (808 sintetica + kit), 13 effetti, mixer, piano roll, export WAV
- **MIDI** via Web MIDI, più un ponte ALSA locale per i browser che non lo vedono
- **Mobile**: tastiera touch, drum machine con step sequencer, registratore voce
- Temi: ALIEN (terminale anni '70), MINIMAL (grigio tortora), PON PON (kawaii, con mascotte originali)

## Avvio locale

```sh
npm install
sh scripts/fetch-samples.sh      # campioni audio (non inclusi nel repo)
npx vite build
NODE_ENV=production node server/server.js   # http://localhost:8790
```

La password si imposta con `STUDIO_PASSWORD`; se manca, al primo avvio ne viene generata una in `data/password`.

Per pubblicarlo (tunnel Cloudflare, VPS con Docker + HTTPS automatico) vedi [DEPLOY.md](DEPLOY.md).

Campioni: Salamander Grand Piano di Alexander Holm (CC-BY 3.0) e kit di batteria di Tone.js, scaricati da `scripts/fetch-samples.sh`.
