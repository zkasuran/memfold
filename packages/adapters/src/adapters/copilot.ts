// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { exists, globFiles, readIfExists, stripFrontmatter } from '../fsutil'
import { markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'
import { extractManagedBody, wrapManagedBlock } from '../types'

const ID = 'copilot'

/**
 * GitHub Copilot. Repo-wide instructions live in
 * `.github/copilot-instructions.md` (plain markdown, no frontmatter, auto
 * loaded). Path-scoped `.github/instructions/*.instructions.md` carry an
 * `applyTo` glob. We compile the repo-wide file as a managed block and read
 * both surfaces.
 */
export const copilotAdapter: Adapter = {
  id: ID,
  displayName: 'GitHub Copilot',

  async detect(root: string): Promise<boolean> {
    return (
      (await exists(join(root, '.github', 'copilot-instructions.md'))) ||
      (await exists(join(root, '.github', 'instructions'))) ||
      (await exists(join(root, '.github')))
    )
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = []
    const repoWide = await readIfExists(join(root, '.github', 'copilot-instructions.md'))
    if (repoWide) records.push(...markdownToRecords(extractManagedBody(repoWide) ?? repoWide, ID))
    for (const file of await globFiles(['.github/instructions/**/*.instructions.md'], root)) {
      const text = await readIfExists(file)
      if (text) records.push(...markdownToRecords(stripFrontmatter(text), ID))
    }
    return records
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes, title: 'Project memory' })
    return [
      {
        path: join(opts.root, '.github', 'copilot-instructions.md'),
        contents: `${wrapManagedBlock(body)}\n`,
        managed: true,
      },
    ]
  },
}
