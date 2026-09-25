// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { exists, globFiles, readIfExists, stripFrontmatter } from '../fsutil'
import { markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'

const ID = 'cline'

/**
 * Cline reads rules from `.clinerules/` (a directory of markdown files, or a
 * single `.clinerules` file) and `.cline/rules/`. The only meaningful
 * frontmatter field is `paths`; a rule without it is always active, which is
 * what we want for compiled memory, so we write a plain `.clinerules/memfold.md`
 * with no frontmatter.
 */
export const clineAdapter: Adapter = {
  id: ID,
  displayName: 'Cline',

  async detect(root: string): Promise<boolean> {
    return (
      (await exists(join(root, '.clinerules'))) || (await exists(join(root, '.cline', 'rules')))
    )
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = []
    // `.clinerules` as a single file (readIfExists returns null when it is a dir).
    const single = await readIfExists(join(root, '.clinerules'))
    if (single) records.push(...markdownToRecords(stripFrontmatter(single), ID))
    for (const file of await globFiles(['.clinerules/**/*.md', '.cline/rules/**/*.md'], root)) {
      const text = await readIfExists(file)
      if (text) records.push(...markdownToRecords(stripFrontmatter(text), ID))
    }
    return records
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes, title: 'Project memory' })
    return [
      {
        path: join(opts.root, '.clinerules', 'memfold.md'),
        contents: `${body}\n`,
      },
    ]
  },
}
