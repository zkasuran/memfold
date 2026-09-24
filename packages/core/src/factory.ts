import { type HlcState, tick } from './hlc'
import { newId } from './id'
import { type MemoryRecord, MemoryRecordSchema, type Provenance, contentHash } from './record'

export interface NewRecordInput {
  type: MemoryRecord['type']
  scope: MemoryRecord['scope']
  body: string
  provenance: Provenance
  scope_path?: string | null
  title?: string | null
  summary?: string | null
  tags?: string[]
  dedup_key?: string | null
  salience?: number
  confidence?: number
  decay?: MemoryRecord['decay']
  links?: string[]
}

/** Build a fresh, validated memory record with a new id + HLC stamp. */
export function newRecord(
  input: NewRecordInput,
  hlc: HlcState,
  nowMs: number = Date.now(),
): MemoryRecord {
  const iso = new Date(nowMs).toISOString()
  return MemoryRecordSchema.parse({
    id: newId(),
    rev: newId(),
    schema_version: 1,
    type: input.type,
    scope: input.scope,
    scope_path: input.scope_path ?? null,
    title: input.title ?? null,
    body: input.body,
    summary: input.summary ?? null,
    tags: input.tags ?? [],
    dedup_key: input.dedup_key ?? null,
    content_hash: contentHash(input.body),
    provenance: input.provenance,
    salience: input.salience ?? 0.5,
    confidence: input.confidence ?? 1,
    decay: input.decay ?? { pinned: false },
    created_at: iso,
    updated_at: iso,
    access_count: 0,
    status: 'active',
    links: input.links ?? [],
    hlc: tick(hlc, nowMs),
  })
}

/** Produce a new version of `prev` (edit), chaining `supersedes` and bumping the HLC. */
export function reviseRecord(
  prev: MemoryRecord,
  patch: Partial<Omit<NewRecordInput, 'type' | 'scope' | 'provenance'>> & { body?: string },
  hlc: HlcState,
  nowMs: number = Date.now(),
): MemoryRecord {
  const body = patch.body ?? prev.body
  return MemoryRecordSchema.parse({
    ...prev,
    rev: newId(),
    body,
    content_hash: contentHash(body),
    title: patch.title ?? prev.title,
    summary: patch.summary ?? prev.summary,
    tags: patch.tags ?? prev.tags,
    salience: patch.salience ?? prev.salience,
    confidence: patch.confidence ?? prev.confidence,
    decay: patch.decay ?? prev.decay,
    updated_at: new Date(nowMs).toISOString(),
    supersedes: prev.rev,
    hlc: tick(hlc, nowMs),
  })
}
