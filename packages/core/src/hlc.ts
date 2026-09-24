/**
 * Hybrid Logical Clock (HLC). Serialized as `wallMs:counter:nodeId`, zero-padded so
 * lexical order equals causal order. Used for deterministic last-writer-wins merge of
 * scalar fields across machines and back-ends (git, CRDT, libsql) — see spec/protocol.md.
 */
export interface HlcState {
  wallMs: number
  counter: number
  nodeId: string
}

export function makeHlcState(nodeId: string): HlcState {
  return { wallMs: 0, counter: 0, nodeId }
}

function format(s: HlcState): string {
  return `${s.wallMs.toString().padStart(15, '0')}:${s.counter.toString().padStart(6, '0')}:${s.nodeId}`
}

export function parseHlc(hlc: string): { wallMs: number; counter: number; nodeId: string } {
  const parts = hlc.split(':')
  return {
    wallMs: Number(parts[0] ?? 0),
    counter: Number(parts[1] ?? 0),
    nodeId: parts.slice(2).join(':'),
  }
}

/** Advance the clock for a local event. Mutates and returns the new stamp. */
export function tick(state: HlcState, nowMs: number = Date.now()): string {
  if (nowMs > state.wallMs) {
    state.wallMs = nowMs
    state.counter = 0
  } else {
    state.counter += 1
  }
  return format(state)
}

/** Merge a received remote stamp into local state (returns the updated local stamp). */
export function receive(state: HlcState, remote: string, nowMs: number = Date.now()): string {
  const r = parseHlc(remote)
  const maxWall = Math.max(state.wallMs, r.wallMs, nowMs)
  if (maxWall === state.wallMs && maxWall === r.wallMs) {
    state.counter = Math.max(state.counter, r.counter) + 1
  } else if (maxWall === state.wallMs) {
    state.counter += 1
  } else if (maxWall === r.wallMs) {
    state.counter = r.counter + 1
  } else {
    state.counter = 0
  }
  state.wallMs = maxWall
  return format(state)
}

/** Total order over HLC stamps: negative if a<b, 0 if equal, positive if a>b. */
export function compareHlc(a: string, b: string): number {
  const pa = parseHlc(a)
  const pb = parseHlc(b)
  if (pa.wallMs !== pb.wallMs) return pa.wallMs - pb.wallMs
  if (pa.counter !== pb.counter) return pa.counter - pb.counter
  return pa.nodeId < pb.nodeId ? -1 : pa.nodeId > pb.nodeId ? 1 : 0
}
