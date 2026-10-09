// Web Worker: costruisce le wavetable fuori dal thread UI e dal thread audio
import { buildTable, buildFromAudio } from './wavetables.js'

self.onmessage = (e) => {
  const { id, kind, name, data } = e.data
  try {
    const t = kind === 'audio' ? buildFromAudio(data) : buildTable(name)
    self.postMessage({ id, mips: t.mips }, t.mips.map(m => m.buffer))
  } catch (err) { self.postMessage({ id, error: String(err) }) }
}
