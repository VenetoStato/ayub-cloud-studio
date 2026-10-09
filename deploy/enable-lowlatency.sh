#!/usr/bin/env bash
# Abilita la modalità a bassa latenza di Ayub Studio. Da lanciare UNA volta con sudo:
#   sudo bash ~/Music/Ayub/cloud/deploy/enable-lowlatency.sh
# 1) profilo AppArmor per il Chromium dello studio (stesso schema del profilo ufficiale di Google Chrome:
#    Ubuntu 24.04 blocca i browser non installati dal sistema senza un profilo con "userns")
# 2) collega l'accesso MIDI (ALSA) a Firefox snap
set -euo pipefail
[ "$EUID" -eq 0 ] || { echo "Lancialo con sudo: sudo bash $0"; exit 1; }
U="${SUDO_USER:-$USER}"; H="$(getent passwd "$U" | cut -d: -f6)"
cat > /etc/apparmor.d/ayub-studio-chromium <<PROF
# Ayub Studio: Chromium di Playwright usato come finestra studio a bassa latenza
abi <abi/4.0>,
include <tunables/global>

profile ayub-studio-chromium $H/.cache/ms-playwright/chromium-*/chrome-linux64/chrome flags=(unconfined) {
  userns,
  include if exists <local/ayub-studio-chromium>
}
PROF
apparmor_parser -r /etc/apparmor.d/ayub-studio-chromium
echo ">> profilo AppArmor installato"
if snap list firefox >/dev/null 2>&1; then snap connect firefox:alsa && echo ">> MIDI collegato a Firefox (riavvia Firefox)"; fi
echo ">> fatto. Ora apri 'Ayub Studio' dal menu applicazioni o lancia ~/Music/Ayub/cloud-studio.sh"
