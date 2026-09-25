// SPDX-License-Identifier: Apache-2.0
import {
  type HlcState,
  type MemoryRecord,
  type MemoryType,
  SecretLeakError,
  makeHlcState,
  newRecord,
  scanSecrets,
} from '@memfold/core'
import { stringify as yamlStringify } from 'yaml'

/** Types that are recall-only and never compiled into rules files by default. */
export const DEFAULT_SKIP_TYPES: MemoryType[] = ['episodic', 'task']

const TYPE_HEADING: Record<MemoryType, string> = {
  convention: 'Conventions',
  preference: 'Preferences',
  decision: 'Decisions',
  fact: 'Facts',
  entity: 'Entities',
  episodic: 'Episodes',
  task: 'Tasks',
}

/** Section order, rules-shaped types first. */
const TYPE_ORDER: MemoryType[] = [
  'convention',
  'preference',
  'decision',
  'fact',
  'entity',
  'episodic',
  'task',
]

const HEADING_TO_TYPE: Record<string, MemoryType> = {
  conventions: 'convention',
  convention: 'convention',
  preferences: 'preference',
  preference: 'preference',
  decisions: 'decision',
  decision: 'decision',
  facts: 'fact',
  fact: 'fact',
  entities: 'entity',
  entity: 'entity',
  episodes: 'episodic',
  episodic: 'episodic',
  tasks: 'task',
  task: 'task',
}

export interface RenderOptions {
  skipTypes?: MemoryType[]
  title?: string
}

function bulletText(rec: MemoryRecord): string {
  const text = (rec.summary ?? rec.body ?? '').replace(/\s+/g, ' ').trim()
  return rec.title ? `**${rec.title}**: ${text}` : text
}

/**
 * Render active records to clean markdown, grouped into a `## Heading` section
 * per type and ordered by salience within a section. Episodic and task records
 * are skipped by default (recall-only).
 */
export function recordsToMarkdown(records: MemoryRecord[], opts: RenderOptions = {}): string {
  const skip = new Set(opts.skipTypes ?? DEFAULT_SKIP_TYPES)
  const active = records.filter((r) => r.status === 'active' && !skip.has(r.type))
  const sections: string[] = []
  if (opts.title) sections.push(`# ${opts.title}`)
  for (const type of TYPE_ORDER) {
    if (skip.has(type)) continue
    const group = active.filter((r) => r.type === type).sort((a, b) => b.salience - a.salience)
    if (group.length === 0) continue
    const bullets = group.map((r) => `- ${bulletText(r)}`).join('\n')
    sections.push(`## ${TYPE_HEADING[type]}\n${bullets}`)
  }
  if (sections.filter((s) => s.startsWith('## ')).length === 0) {
    sections.push('_No project memory recorded yet._')
  }
  return sections.join('\n\n').trim()
}

/**
 * Render records and run the secret gate on the result. Throws `SecretLeakError`
 * if a record would leak a credential into a compiled file. Every adapter routes
 * its record rendering through here.
 */
export function renderMemory(records: MemoryRecord[], opts: RenderOptions = {}): string {
  const md = recordsToMarkdown(records, opts)
  const findings = scanSecrets(md)
  if (findings.length > 0) throw new SecretLeakError(findings)
  return md
}

/** YAML frontmatter block, delimited by `---`, with no trailing newline. */
export function frontmatter(data: Record<string, unknown>): string {
  const yaml = yamlStringify(data).trimEnd()
  return `---\n${yaml}\n---`
}

function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').trim()
}

function makeImported(text: string, type: MemoryType, tool: string, hlc: HlcState): MemoryRecord {
  return newRecord(
    {
      type,
      scope: 'project',
      body: text,
      summary: text,
      provenance: { source: 'import', tool },
    },
    hlc,
  )
}

/**
 * Best-effort parse of a markdown rules/memory body into records: one record per
 * bullet, typed by the nearest `## Heading` when it names a known type, else
 * `convention`. A body with no bullets becomes a single convention record.
 */
export function markdownToRecords(md: string, tool: string): MemoryRecord[] {
  const hlc = makeHlcState('import')
  const records: MemoryRecord[] = []
  const headingRe = /^#{1,6}\s+(.+?)\s*$/
  const bulletRe = /^\s*[-*]\s+(.+)$/
  let currentType: MemoryType = 'convention'
  let sawBullet = false
  for (const line of md.split(/\r?\n/)) {
    const h = headingRe.exec(line)
    if (h) {
      const key = (h[1] ?? '').toLowerCase().replace(/[^a-z]/g, '')
      currentType = HEADING_TO_TYPE[key] ?? currentType
      continue
    }
    const b = bulletRe.exec(line)
    if (b) {
      const text = stripInline(b[1] ?? '')
      if (text) {
        records.push(makeImported(text, currentType, tool, hlc))
        sawBullet = true
      }
    }
  }
  if (!sawBullet) {
    const body = md.trim()
    if (body) records.push(makeImported(body, 'convention', tool, hlc))
  }
  return records
}
