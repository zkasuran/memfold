// SPDX-License-Identifier: FSL-1.1-ALv2
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { MemoryRecord } from '@memfold/core'

/**
 * One durable operation in the append-only log. `upsert` carries the full record it wrote;
 * `tombstone` carries the id it retired. `hlc` is the stamp the op was applied under and `at`
 * is the wall-clock ISO time it was written. This log is the git-syncable source of truth; the
 * SQLite database is a projection that can be rebuilt by replaying every entry in order.
 */
export interface OpLogEntry {
  kind: 'upsert' | 'tombstone'
  record?: MemoryRecord
  id?: string
  hlc: string
  at: string
}

/**
 * Append-only JSONL writer. Every op is one JSON object on its own line, flushed to disk with
 * an fsync so a crash cannot leave a half-written record. Reads replay the whole file in order.
 */
export class OpLog {
  readonly path: string

  constructor(path: string) {
    this.path = path
    const dir = dirname(path)
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
  }

  /** Append one op as a single JSONL line and fsync it before returning. */
  append(op: OpLogEntry): void {
    const line = `${JSON.stringify(op)}\n`
    const fd = openSync(this.path, 'a')
    try {
      writeSync(fd, line)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }

  /** Read the whole log back in write order. Blank lines are skipped. */
  all(): OpLogEntry[] {
    if (!existsSync(this.path)) return []
    const text = readFileSync(this.path, 'utf8')
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as OpLogEntry)
  }
}
