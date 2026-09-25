// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addAction } from '../src/commands/add'
import { compileAction } from '../src/commands/compile'
import { doctorAction } from '../src/commands/doctor'
import { forgetAction } from '../src/commands/forget'
import { initAction } from '../src/commands/init'
import { listAction } from '../src/commands/list'
import { searchAction } from '../src/commands/search'

describe('memfold cli', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'memfold-cli-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('init creates a store', async () => {
    const result = await initAction({ cwd })
    expect(result.dbPath).toBe(join(cwd, '.memfold', 'memory.db'))
    expect(existsSync(result.dbPath)).toBe(true)
    expect(Array.isArray(result.detected)).toBe(true)
  })

  it('add then search returns the memory', async () => {
    await initAction({ cwd })
    const added = await addAction(['The', 'deploy', 'command', 'is', 'pnpm', 'ship'], {
      cwd,
      type: 'convention',
      title: 'Deploy command',
    })
    expect(added.id).toBeTruthy()

    const hits = await searchAction(['deploy'], { cwd })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.record.id).toBe(added.id)
    expect(hits[0]?.record.body).toContain('pnpm ship')
  })

  it('add refuses a fake AWS key', async () => {
    await initAction({ cwd })
    await expect(
      addAction(['my key is', 'AKIAIOSFODNN7EXAMPLE', 'do not store it'], { cwd }),
    ).rejects.toThrow(/secret/i)

    // Nothing was written.
    const records = await listAction({ cwd })
    expect(records.length).toBe(0)
  })

  it('compile writes an AGENTS.md containing a stored memory', async () => {
    await initAction({ cwd })
    await addAction(['Prefer', 'small', 'pure', 'functions'], { cwd, type: 'convention' })

    const result = await compileAction({ cwd, targets: 'agents-md' })
    expect(result.dryRun).toBe(false)
    const agentsPath = join(cwd, 'AGENTS.md')
    expect(result.groups.some((g) => g.paths.includes(agentsPath))).toBe(true)

    const contents = readFileSync(agentsPath, 'utf8')
    expect(contents).toContain('Prefer small pure functions')
    expect(contents).toContain('memfold:begin')
  })

  it('dry-run compile writes no file', async () => {
    await initAction({ cwd })
    await addAction(['Ship', 'behind', 'a', 'flag'], { cwd, type: 'decision' })
    await compileAction({ cwd, targets: 'agents-md', dryRun: true })
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false)
  })

  it('forget tombstones a record so it drops out of listings', async () => {
    await initAction({ cwd })
    const added = await addAction(['A transient note'], { cwd })
    expect((await listAction({ cwd })).length).toBe(1)

    const forgot = await forgetAction(added.id, { cwd })
    expect(forgot.forgotten).toBe(true)
    expect((await listAction({ cwd })).length).toBe(0)

    const missing = await forgetAction('does-not-exist', { cwd })
    expect(missing.forgotten).toBe(false)
  })

  it('doctor reports counts, tools, and no leaks on a clean store', async () => {
    await initAction({ cwd })
    await addAction(['Use conventional commits'], { cwd, type: 'convention' })
    const report = await doctorAction({ cwd })
    expect(report.activeCount).toBe(1)
    expect(report.leaks.length).toBe(0)
    expect(report.dbPath).toBe(join(cwd, '.memfold', 'memory.db'))
  })
})
