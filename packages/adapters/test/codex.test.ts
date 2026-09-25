// SPDX-License-Identifier: Apache-2.0
import { makeHlcState, newRecord } from '@memfold/core'
import { describe, expect, it } from 'vitest'
import { codexAdapter } from '../src/adapters/codex'

describe('codex adapter', () => {
  const hlc = makeHlcState('t')
  const global = newRecord(
    {
      type: 'preference',
      scope: 'global',
      body: 'Prefer TypeScript over JavaScript',
      provenance: { source: 'user' },
    },
    hlc,
  )
  const project = newRecord(
    { type: 'fact', scope: 'project', body: 'This repo uses pnpm', provenance: { source: 'user' } },
    hlc,
  )

  it('compiles only global-scope records to the ~/.codex/AGENTS.md file', () => {
    const files = codexAdapter.compile([global, project], { root: '/tmp/x' })
    expect(files).toHaveLength(1)
    expect(files[0]?.path.endsWith('/.codex/AGENTS.md')).toBe(true)
    expect(files[0]?.contents).toContain('Prefer TypeScript over JavaScript')
    expect(files[0]?.contents).not.toContain('This repo uses pnpm')
    expect(files[0]?.contents).toContain('memfold:begin')
  })

  it('emits nothing when there are no global-scope records', () => {
    expect(codexAdapter.compile([project], { root: '/tmp/x' })).toHaveLength(0)
  })
})
