// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { readIfExists } from '../fsutil'
import { markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'
import { extractManagedBody, wrapManagedBlock } from '../types'

const ID = 'agents-md'

/**
 * AGENTS.md at the repo root: freeform markdown, no frontmatter, read natively
 * by Codex, Cursor, Copilot, Zed, Gemini CLI (via setting), and most of the long
 * tail. The one high-leverage portable target. Written as a managed block so a
 * hand-authored AGENTS.md keeps its own prose.
 */
export const agentsMdAdapter: Adapter = {
  id: ID,
  displayName: 'AGENTS.md',

  async detect(root: string): Promise<boolean> {
    return readIfExists(join(root, 'AGENTS.md')).then((t) => t !== null)
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const text = await readIfExists(join(root, 'AGENTS.md'))
    if (!text) return []
    return markdownToRecords(extractManagedBody(text) ?? text, ID)
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes, title: 'Project memory' })
    return [
      {
        path: join(opts.root, 'AGENTS.md'),
        contents: `${wrapManagedBlock(body)}\n`,
        managed: true,
      },
    ]
  },
}
