// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { exists, readIfExists } from '../fsutil'
import { markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'
import { extractManagedBody, wrapManagedBlock } from '../types'

const ID = 'aider'
const CONVENTIONS = 'CONVENTIONS.md'

/**
 * Aider auto-loads nothing by convention: the only durable hook is a `read:`
 * entry in `.aider.conf.yml`. So we write the memory to CONVENTIONS.md (a
 * managed block) and ensure the config points at it. The config is merged, never
 * overwritten, because it may hold the user's model choice and API key; that
 * file is exempt from the secret scan for the same reason (its memory content
 * lives in CONVENTIONS.md, which is scanned).
 */
export const aiderAdapter: Adapter = {
  id: ID,
  displayName: 'Aider',

  async detect(root: string): Promise<boolean> {
    return (await exists(join(root, '.aider.conf.yml'))) || (await exists(join(root, CONVENTIONS)))
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const text = await readIfExists(join(root, CONVENTIONS))
    if (!text) return []
    return markdownToRecords(extractManagedBody(text) ?? text, ID)
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes, title: 'Project conventions' })
    const files: CompiledFile[] = [
      {
        path: join(opts.root, CONVENTIONS),
        contents: `${wrapManagedBlock(body)}\n`,
        managed: true,
      },
    ]
    const conf = ensureReadEntry(join(opts.root, '.aider.conf.yml'), CONVENTIONS)
    if (conf !== null) {
      files.push({ path: join(opts.root, '.aider.conf.yml'), contents: conf, secretScan: false })
    }
    return files
  },
}

/**
 * Return `.aider.conf.yml` content with `entry` present in its `read:` list, or
 * null if it is already there (nothing to write). Preserves existing keys.
 */
function ensureReadEntry(confPath: string, entry: string): string | null {
  let data: Record<string, unknown> = {}
  const existed = existsSync(confPath)
  if (existed) {
    const parsed: unknown = yamlParse(readFileSync(confPath, 'utf8'))
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  }
  const cur = data.read
  const list = Array.isArray(cur) ? [...cur] : cur == null ? [] : [cur]
  if (list.includes(entry)) return null
  list.push(entry)
  data.read = list
  const header = existed ? '' : '# Managed by memfold: load the compiled conventions file.\n'
  return `${header}${yamlStringify(data).trimEnd()}\n`
}
