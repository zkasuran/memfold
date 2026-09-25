// SPDX-License-Identifier: Apache-2.0
//
// memfold conformance suite.
//
// Loads conformance/vectors/index.json and, for every listed vector:
//   - parses the vector JSON and runs MemoryRecordSchema.safeParse
//   - asserts 'valid' vectors parse and 'invalid' vectors fail
//   - for 'valid' vectors, asserts serializeRecord -> parseRecord round-trips to an equal record
//
// A memfold-conformant Memory Record implementation must pass this suite.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MemoryRecordSchema, parseRecord, serializeRecord } from '@memfold/core'
import { describe, expect, it } from 'vitest'

const vectorsDir = fileURLToPath(new URL('./vectors/', import.meta.url))

interface IndexEntry {
  file: string
  expect: 'valid' | 'invalid'
  reason: string
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(vectorsDir + file, 'utf8'))
}

const index = readJson('index.json') as { vectors: IndexEntry[] }

describe('conformance index', () => {
  it('lists at least 8 vectors covering valid and invalid cases', () => {
    expect(index.vectors.length).toBeGreaterThanOrEqual(8)
    expect(index.vectors.some((v) => v.expect === 'valid')).toBe(true)
    expect(index.vectors.some((v) => v.expect === 'invalid')).toBe(true)
  })

  it('covers every memory type across the valid vectors', () => {
    const valid = index.vectors.filter((v) => v.expect === 'valid')
    const types = new Set(
      valid.map((v) => (readJson(v.file) as { type?: string }).type).filter(Boolean),
    )
    for (const t of MemoryRecordSchema.shape.type.options) {
      expect(types.has(t)).toBe(true)
    }
  })

  it('covers every scope across the valid vectors', () => {
    const valid = index.vectors.filter((v) => v.expect === 'valid')
    const scopes = new Set(
      valid.map((v) => (readJson(v.file) as { scope?: string }).scope).filter(Boolean),
    )
    for (const s of MemoryRecordSchema.shape.scope.options) {
      expect(scopes.has(s)).toBe(true)
    }
  })
})

describe('memory-record vectors', () => {
  for (const entry of index.vectors) {
    it(`${entry.file} -> ${entry.expect} (${entry.reason})`, () => {
      const raw = readJson(entry.file)
      const result = MemoryRecordSchema.safeParse(raw)

      if (entry.expect === 'valid') {
        if (!result.success) {
          throw new Error(
            `expected ${entry.file} to be valid but got: ${JSON.stringify(result.error.issues)}`,
          )
        }
        // Round-trip: on-disk serialization must be lossless for a validated record.
        const roundTripped = parseRecord(serializeRecord(result.data))
        expect(roundTripped).toEqual(result.data)
      } else {
        expect(result.success).toBe(false)
      }
    })
  }
})
