// stato UI locale (non condiviso)
import { S } from '../state.js'
import { E } from '../audio/engine.js'

export const UI = {
  pxb: 26, sx: 0, sy: 0, rowh: 64, ruler: 26,
  selTrack: null, selClip: null, tab: 'devices',
  grid: 0.25, kOct: 4, kVel: 100,
  remoteKeys: new Map(), // nome -> {color, keys:[]}
  redraw: new Set()
}
export function selectTrack (id) {
  UI.selTrack = id; E.sel = id
  S.awareness?.setLocalStateField('track', id)
  UI.redraw.forEach(f => f('sel'))
}
export function selectClip (id) {
  UI.selClip = id
  S.awareness?.setLocalStateField('clip', id)
  const c = id && S.clips.get(id)
  if (c) UI.selTrack = c.get('track'), E.sel = UI.selTrack
  UI.redraw.forEach(f => f('sel'))
}
