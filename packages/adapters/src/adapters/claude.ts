// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { exists, globFiles, readIfExists, stripFrontmatter } from '../fsutil'
import { markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'
import { extractManagedBody, wrapManagedBlock } from '../types'

const ID = 'claude-code'

/**
 * Claude Code. Native file is CLAUDE.md (concatenated, never overridden), split
 * across `.claude/rules/*.md` whose only read frontmatter field is `paths`.
 * AGENTS.md is read only when no CLAUDE.md exists at or above cwd, so writing
 * CLAUDE.md is the reliable target here. Read pulls from CLAUDE.md,
 * `.claude/CLAUDE.md`, and every `.claude/rules/*.md` (frontmatter stripped).
 */
export const claudeAdapter: Adapter = {
  id: ID,
  displayName: 'Claude Code',

  async detect(root: string): Promise<boolean> {
    return (
      (await exists(join(root, 'CLAUDE.md'))) ||
      (await exists(join(root, '.claude', 'CLAUDE.md'))) ||
      (await exists(join(root, '.claude', 'rules')))
    )
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = []
    for (const rel of ['CLAUDE.md', join('.claude', 'CLAUDE.md')]) {
      const text = await readIfExists(join(root, rel))
      if (text) records.push(...markdownToRecords(extractManagedBody(text) ?? text, ID))
    }
    const ruleFiles = await globFiles(['.claude/rules/**/*.md'], root)
    for (const file of ruleFiles) {
      const text = await readIfExists(file)
      if (text) records.push(...markdownToRecords(stripFrontmatter(text), ID))
    }
    return records
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes, title: 'Project memory' })
    return [
      {
        path: join(opts.root, 'CLAUDE.md'),
        contents: `${wrapManagedBlock(body)}\n`,
        managed: true,
      },
    ]
  },
}
