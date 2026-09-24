import { createHash } from 'node:crypto'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { z } from 'zod'

export const MEMORY_TYPES = [
  'fact',
  'preference',
  'decision',
  'convention',
  'episodic',
  'task',
  'entity',
] as const
export const SCOPES = ['global', 'project', 'dir', 'session'] as const
export const STATUSES = ['active', 'archived', 'tombstone'] as const

export const ProvenanceSchema = z.object({
  source: z.enum(['user', 'agent', 'tool', 'import', 'consolidation']),
  tool: z.string().nullish(),
  session_id: z.string().nullish(),
  author: z.string().nullish(),
  model: z.string().nullish(),
  cite: z.string().nullish(),
})
export type Provenance = z.infer<typeof ProvenanceSchema>

export const DecaySchema = z.object({
  half_life_days: z.number().nullish(),
  ttl_at: z.string().nullish(),
  pinned: z.boolean().default(false),
})

export const RedactionSchema = z.object({
  span: z.tuple([z.number(), z.number()]),
  kind: z.string(),
})

export const MemoryRecordSchema = z.object({
  id: z.string(),
  rev: z.string(),
  schema_version: z.literal(1).default(1),
  type: z.enum(MEMORY_TYPES),
  scope: z.enum(SCOPES),
  scope_path: z.string().nullish(),
  title: z.string().nullish(),
  body: z.string(),
  summary: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  dedup_key: z.string().nullish(),
  content_hash: z.string(),
  embedding_model: z.string().nullish(),
  embedding_dim: z.number().int().nullish(),
  provenance: ProvenanceSchema,
  salience: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(1),
  decay: DecaySchema.default({ pinned: false }),
  created_at: z.string(),
  updated_at: z.string(),
  last_accessed_at: z.string().nullish(),
  access_count: z.number().int().min(0).default(0),
  supersedes: z.string().nullish(),
  superseded_by: z.string().nullish(),
  status: z.enum(STATUSES).default('active'),
  links: z.array(z.string()).default([]),
  hlc: z.string(),
  sensitivity: z.enum(['public', 'internal', 'redacted']).default('public'),
  redactions: z.array(RedactionSchema).default([]),
})

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>
export type MemoryType = (typeof MEMORY_TYPES)[number]
export type Scope = (typeof SCOPES)[number]

/** Deterministic content hash used for dedup and version identity. */
export function contentHash(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/** Serialize a record to `YAML frontmatter + markdown body` (git-diffable, human-editable). */
export function serializeRecord(rec: MemoryRecord): string {
  const { body, ...meta } = rec
  const fm = yamlStringify(meta).trimEnd()
  return `---\n${fm}\n---\n\n${body.trimEnd()}\n`
}

/** Parse a `frontmatter + body` document back into a validated record. */
export function parseRecord(text: string): MemoryRecord {
  const m = FRONTMATTER.exec(text)
  if (!m) throw new Error('memfold: record is missing YAML frontmatter')
  const meta = (yamlParse(m[1] ?? '') as Record<string, unknown>) ?? {}
  const body = (m[2] ?? '').trim()
  return MemoryRecordSchema.parse({ ...meta, body })
}
