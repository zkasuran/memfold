import { randomBytes } from 'node:crypto'
import { monotonicFactory } from 'ulidx'

/** Monotonic ULID generator (sortable, collision-resistant). */
export const ulid = monotonicFactory()

export function newId(): string {
  return ulid()
}

/** Short stable per-machine node id used inside HLC stamps. */
export function newNodeId(): string {
  return randomBytes(4).toString('hex')
}
