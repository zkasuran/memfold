// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { exists, globFiles, readIfExists, stripFrontmatter } from '../fsutil'
import { frontmatter, markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'

const ID = 'cursor'

/**
 * Cursor Project Rules live in `.cursor/rules/*.mdc` (YAML frontmatter +
 * markdown). A plain `.md` there is silently ignored, so the extension MUST be
 * `.mdc`. We emit `alwaysApply: true` (the compiled memory always applies) and
 * omit `globs` to avoid the bare comma-separated-string gotcha. The legacy
 * `.cursorrules` blob is read for parity but not written fresh (deprecated).
 */
export const cursorAdapter: Adapter = {
  id: ID,
  displayName: 'Cursor',

  async detect(root: string): Promise<boolean> {
    return (
      (await exists(join(root, '.cursor', 'rules'))) ||
      (await exists(join(root, '.cursorrules'))) ||
      (await exists(join(root, '.cursor')))
    )
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = []
    for (const file of await globFiles(['.cursor/rules/**/*.mdc'], root)) {
      const text = await readIfExists(file)
      if (text) records.push(...markdownToRecords(stripFrontmatter(text), ID))
    }
    const legacy = await readIfExists(join(root, '.cursorrules'))
    if (legacy) records.push(...markdownToRecords(legacy, ID))
    return records
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes })
    const fm = frontmatter({
      description: 'Project memory compiled by memfold',
      alwaysApply: true,
    })
    return [
      {
        path: join(opts.root, '.cursor', 'rules', 'memfold.mdc'),
        contents: `${fm}\n\n${body}\n`,
      },
    ]
  },
}
