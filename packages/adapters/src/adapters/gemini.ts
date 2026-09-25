// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { exists, readIfExists } from '../fsutil'
import { markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'
import { extractManagedBody, wrapManagedBlock } from '../types'

const ID = 'gemini'

/**
 * Gemini CLI. Default context file is GEMINI.md (plain markdown, concatenated
 * across the hierarchy). Compiled as a managed block so a hand-authored
 * GEMINI.md keeps its own content. (Gemini CLI can also be pointed at AGENTS.md
 * via `context.fileName`; that shared file is handled by the AGENTS.md adapter.)
 */
export const geminiAdapter: Adapter = {
  id: ID,
  displayName: 'Gemini CLI',

  async detect(root: string): Promise<boolean> {
    return (await exists(join(root, 'GEMINI.md'))) || (await exists(join(root, '.gemini')))
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const text = await readIfExists(join(root, 'GEMINI.md'))
    if (!text) return []
    return markdownToRecords(extractManagedBody(text) ?? text, ID)
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes, title: 'Project memory' })
    return [
      {
        path: join(opts.root, 'GEMINI.md'),
        contents: `${wrapManagedBlock(body)}\n`,
        managed: true,
      },
    ]
  },
}
