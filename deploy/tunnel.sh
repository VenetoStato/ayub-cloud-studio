#!/usr/bin/env bash
# =============================================================================
#  ATTENZIONE: questo script ESPONE PUBBLICAMENTE SU INTERNET lo studio che gira
#  su questo PC (http://localhost:8790) tramite un Cloudflare quick tunnel.
#  Chiunque abbia il link vede la pagina di login: l'unica protezione e' la
#  password (STUDIO_PASSWORD). Usa una password robusta, non lasciare il tunnel
#  acceso quando non serve, e chiudilo con Ctrl+C.
# =============================================================================
#  Uso:  ./deploy/tunnel.sh            (porta 8790)
#        PORT=8795 ./deploy/tunnel.sh
#  Il link https://<nome-a-caso>.trycloudflare.com compare nel log qui sotto e
#  CAMBIA ogni volta che rilanci lo script.
set -euo pipefail

PORT="${PORT:-8790}"
BIN_DIR="$HOME/.local/bin"
CF="$(command -v cloudflared || true)"

if [ -z "$CF" ]; then
  CF="$BIN_DIR/cloudflared"
  if [ ! -x "$CF" ]; then
    case "$(uname -m)" in
      x86_64|amd64) ARCH=amd64 ;;
      aarch64|arm64) ARCH=arm64 ;;
      armv7l|armv6l) ARCH=arm ;;
      *) echo "Architettura non supportata: $(uname -m)" >&2; exit 1 ;;
    esac
    echo ">> scarico cloudflared ($ARCH) in $BIN_DIR ..."
    mkdir -p "$BIN_DIR"
    curl -fL --progress-bar -o "$CF.tmp" \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH"
    chmod +x "$CF.tmp" && mv "$CF.tmp" "$CF"
  fi
fi

if ! curl -fsS "http://localhost:$PORT/healthz" >/dev/null 2>&1; then
  echo "!! lo studio non risponde su http://localhost:$PORT — avvialo prima (~/Music/Ayub/cloud-studio.sh)" >&2
  exit 1
fi

echo ">> apro il tunnel verso http://localhost:$PORT  (Ctrl+C per chiudere)"
echo ">> cerca la riga con https://....trycloudflare.com e condividi quel link + la password"
exec "$CF" tunnel --no-autoupdate --url "http://localhost:$PORT"
