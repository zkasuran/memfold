// SPDX-License-Identifier: Apache-2.0
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { exists, readIfExists } from '../fsutil'
import { markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'
import { extractManagedBody, wrapManagedBlock } from '../types'

const ID = 'codex'

/** Codex reads the user-global instructions file at ~/.codex/AGENTS.md. */
function codexGlobalPath(): string {
  return join(homedir(), '.codex', 'AGENTS.md')
}

/**
 * OpenAI Codex CLI. Project memory reaches Codex through the repo `AGENTS.md`,
 * which the agents-md adapter already writes and Codex reads natively. This
 * adapter owns Codex's separate user-global file `~/.codex/AGENTS.md`, so it
 * carries only global-scope records and never fights the repo AGENTS.md.
 */
export const codexAdapter: Adapter = {
  id: ID,
  displayName: 'Codex (global)',

  async detect(): Promise<boolean> {
    return exists(join(homedir(), '.codex'))
  },

  async read(): Promise<MemoryRecord[]> {
    const text = await readIfExists(codexGlobalPath())
    if (!text) return []
    return markdownToRecords(extractManagedBody(text) ?? text, ID)
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const global = records.filter((r) => r.scope === 'global')
    if (global.length === 0) return []
    const body = renderMemory(global, { skipTypes: opts.skipTypes, title: 'Global memory' })
    return [{ path: codexGlobalPath(), contents: `${wrapManagedBlock(body)}\n`, managed: true }]
  },
}
