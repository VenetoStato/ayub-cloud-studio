#!/bin/sh
# Scarica i campioni audio (non inclusi nel repository):
#  - pianoforte "Salamander Grand Piano" di Alexander Holm (CC-BY 3.0), versione mp3 di Tone.js
#  - kit di batteria da tonejs.github.io/audio/drum-samples
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/public/samples"
BASE=https://tonejs.github.io/audio
get () { mkdir -p "$(dirname "$2")"; [ -s "$2" ] && return 0; if command -v curl >/dev/null; then curl -fsSL -o "$2" "$1"; else wget -q -O "$2" "$1"; fi; }
for n in A0 C1 Ds1 Fs1 A1 C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6 Ds6 Fs6 A6 C7 Ds7 Fs7 A7 C8; do
  get "$BASE/salamander/$n.mp3" "$DIR/piano/$n.mp3"
done
for k in CR78 LINN acoustic-kit Techno 4OP-FM; do
  for s in kick snare hihat tom1 tom2 tom3; do get "$BASE/drum-samples/$k/$s.mp3" "$DIR/kits/$k/$s.mp3"; done
done
echo "campioni pronti in $DIR"
