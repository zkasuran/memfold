// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import type { MemoryRecord } from '@memfold/core'
import { exists, globFiles, readIfExists, stripFrontmatter } from '../fsutil'
import { frontmatter, markdownToRecords, renderMemory } from '../render'
import type { Adapter, CompileOptions, CompiledFile } from '../types'

const ID = 'windsurf'

/**
 * Windsurf/Cascade workspace rules live in `.windsurf/rules/*.md` with a
 * `trigger` frontmatter field. We emit `trigger: always_on`. Windsurf silently
 * truncates rule files past its character cap, so we cap defensively at the
 * smaller (6k) portable limit rather than let content vanish.
 */
const WINDSURF_CAP = 6000

function capText(text: string, limit: number): string {
  if (text.length <= limit) return text
  const note = '\n\n<!-- memfold: content truncated for the Windsurf character cap -->\n'
  const slice = text.slice(0, Math.max(0, limit - note.length))
  const nl = slice.lastIndexOf('\n')
  return `${nl > 0 ? slice.slice(0, nl) : slice}${note}`
}

export const windsurfAdapter: Adapter = {
  id: ID,
  displayName: 'Windsurf',

  async detect(root: string): Promise<boolean> {
    return (
      (await exists(join(root, '.windsurf', 'rules'))) ||
      (await exists(join(root, '.windsurfrules'))) ||
      (await exists(join(root, '.windsurf')))
    )
  },

  async read(root: string): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = []
    for (const file of await globFiles(['.windsurf/rules/**/*.md'], root)) {
      const text = await readIfExists(file)
      if (text) records.push(...markdownToRecords(stripFrontmatter(text), ID))
    }
    const legacy = await readIfExists(join(root, '.windsurfrules'))
    if (legacy) records.push(...markdownToRecords(legacy, ID))
    return records
  },

  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[] {
    const body = renderMemory(records, { skipTypes: opts.skipTypes })
    const fm = frontmatter({
      trigger: 'always_on',
      description: 'Project memory compiled by memfold',
    })
    return [
      {
        path: join(opts.root, '.windsurf', 'rules', 'memfold.md'),
        contents: capText(`${fm}\n\n${body}\n`, WINDSURF_CAP),
      },
    ]
  },
}
