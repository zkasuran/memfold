// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type MemoryRecord, makeHlcState, newRecord } from '@memfold/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentsMdAdapter } from '../src/adapters/agents-md'
import { cursorAdapter } from '../src/adapters/cursor'
import { compileAll, writeCompiled } from '../src/compile'
import { detectInstalled } from '../src/registry'
import { MANAGED_BEGIN, mergeManagedBlock } from '../src/types'

function sampleRecords(): MemoryRecord[] {
  const hlc = makeHlcState('test')
  return [
    newRecord(
      {
        type: 'convention',
        scope: 'project',
        body: 'Always run the linter before committing.',
        provenance: { source: 'user' },
      },
      hlc,
    ),
    newRecord(
      {
        type: 'fact',
        scope: 'project',
        body: 'The database is Postgres 16 on port 5432.',
        provenance: { source: 'user' },
      },
      hlc,
    ),
    // Episodic records are recall-only and must not reach compiled files.
    newRecord(
      {
        type: 'episodic',
        scope: 'session',
        body: 'User asked about caching at 3pm.',
        provenance: { source: 'agent' },
      },
      hlc,
    ),
  ]
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memfold-adapters-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('AGENTS.md round trip', () => {
  it('compiles records to a managed block and reads them back', async () => {
    const files = agentsMdAdapter.compile(sampleRecords(), { root })
    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe(join(root, 'AGENTS.md'))
    expect(files[0]?.contents).toContain(MANAGED_BEGIN)

    await writeCompiled(files)
    const back = await agentsMdAdapter.read(root)

    expect(back).toHaveLength(2) // episodic dropped
    const bodies = back.map((r) => r.body)
    expect(bodies).toContain('Always run the linter before committing.')
    expect(bodies).toContain('The database is Postgres 16 on port 5432.')
    expect(bodies.some((b) => b.includes('caching'))).toBe(false)
    expect(back.every((r) => r.provenance.source === 'import')).toBe(true)
    expect(back.every((r) => r.provenance.tool === 'agents-md')).toBe(true)
  })
})

describe('Cursor .mdc round trip', () => {
  it('writes .cursor/rules/memfold.mdc with frontmatter and reads it back', async () => {
    const files = cursorAdapter.compile(sampleRecords(), { root })
    expect(files[0]?.path).toBe(join(root, '.cursor', 'rules', 'memfold.mdc'))
    expect(files[0]?.contents).toContain('alwaysApply: true')

    await writeCompiled(files)
    const onDisk = await readFile(join(root, '.cursor', 'rules', 'memfold.mdc'), 'utf8')
    expect(onDisk.startsWith('---')).toBe(true)

    const back = await cursorAdapter.read(root)
    const bodies = back.map((r) => r.body)
    expect(bodies).toContain('Always run the linter before committing.')
    expect(bodies).toContain('The database is Postgres 16 on port 5432.')
  })
})

describe('managed-block merge', () => {
  it('preserves text around the block and replaces the block body', () => {
    const existing = [
      '# My handbook',
      '',
      'Above the block.',
      '',
      `${MANAGED_BEGIN}`,
      'stale generated content',
      '<!-- memfold:end -->',
      '',
      'Below the block.',
      '',
    ].join('\n')

    const merged = mergeManagedBlock(existing, '## Conventions\n- New rule.')
    expect(merged).toContain('Above the block.')
    expect(merged).toContain('Below the block.')
    expect(merged).toContain('- New rule.')
    expect(merged).not.toContain('stale generated content')
  })

  it('appends a block when the file has none', () => {
    const merged = mergeManagedBlock('# Existing file\n', 'body text')
    expect(merged).toContain('# Existing file')
    expect(merged).toContain(MANAGED_BEGIN)
    expect(merged).toContain('body text')
  })

  it('preserves the managed block on a second write to disk', async () => {
    const path = join(root, 'AGENTS.md')
    await writeCompiled(agentsMdAdapter.compile(sampleRecords(), { root }))
    // Add hand-authored text after the block, then recompile.
    const withEdit = `${await readFile(path, 'utf8')}\n## Hand notes\n- Keep me.\n`
    await writeCompiled([{ path, contents: withEdit, managed: false }])
    await writeCompiled(agentsMdAdapter.compile(sampleRecords(), { root }))

    const final = await readFile(path, 'utf8')
    expect(final).toContain('Keep me.')
    expect(final).toContain('The database is Postgres 16 on port 5432.')
  })
})

describe('secret gate', () => {
  const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

  it('throws when a record would leak a secret into a compiled file', () => {
    const hlc = makeHlcState('test')
    const leaky = newRecord(
      {
        type: 'fact',
        scope: 'project',
        body: `Deploy key is ${AWS_KEY} do not remove`,
        provenance: { source: 'user' },
      },
      hlc,
    )
    expect(() => agentsMdAdapter.compile([leaky], { root })).toThrow(/secret/i)
  })

  it('refuses to write a file whose contents contain a secret', async () => {
    await expect(
      writeCompiled([{ path: join(root, 'leak.md'), contents: `token ${AWS_KEY}` }]),
    ).rejects.toThrow(/secret/i)
  })
})

describe('detection and compileAll', () => {
  it('detects only configured tools and compiles across them', async () => {
    await writeCompiled(cursorAdapter.compile(sampleRecords(), { root }))
    const installed = await detectInstalled(root)
    const ids = installed.map((a) => a.id)
    expect(ids).toContain('cursor')
    expect(ids).not.toContain('gemini')

    const files = compileAll(sampleRecords(), installed, root)
    expect(files.length).toBeGreaterThan(0)
  })
})
