// SPDX-License-Identifier: FSL-1.1-ALv2
import {
  DecaySchema,
  MEMORY_TYPES,
  ProvenanceSchema,
  SCOPES,
  STATUSES,
  newRecord,
  reviseRecord,
  tick,
} from '@memfold/core'
import type { HlcState, MemoryStore } from '@memfold/core'
import { Hono } from 'hono'
import { z } from 'zod'
import type { OpLog } from './oplog'

export interface CreateAppOptions {
  /** Shared clock the whole daemon stamps writes with. */
  hlc: HlcState
  /** When set, every route except GET /health requires `Authorization: Bearer <token>`. */
  token?: string
  /** Optional append-only log; every upsert/tombstone is mirrored to it for git sync. */
  oplog?: OpLog
}

const NewRecordInputSchema = z.object({
  type: z.enum(MEMORY_TYPES),
  scope: z.enum(SCOPES),
  body: z.string(),
  provenance: ProvenanceSchema,
  scope_path: z.string().nullish(),
  title: z.string().nullish(),
  summary: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  dedup_key: z.string().nullish(),
  salience: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  decay: DecaySchema.optional(),
  links: z.array(z.string()).optional(),
})

const PatchSchema = z.object({
  body: z.string().optional(),
  title: z.string().nullish(),
  summary: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  salience: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  decay: DecaySchema.optional(),
  links: z.array(z.string()).optional(),
})

const ListQuerySchema = z.object({
  scope: z.enum(SCOPES).optional(),
  scopePath: z.string().optional(),
  type: z.enum(MEMORY_TYPES).optional(),
  status: z.enum(STATUSES).optional(),
})

const SearchSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().optional(),
  scope: z.enum(SCOPES).optional(),
  scopePath: z.string().optional(),
  types: z.array(z.enum(MEMORY_TYPES)).optional(),
})

/** SqliteStore exposes a `vectorEnabled` getter; the MemoryStore contract does not. Read it
 *  defensively so any store implementation still answers /health. */
function readVectorEnabled(store: MemoryStore): boolean {
  const v = (store as { vectorEnabled?: unknown }).vectorEnabled
  return typeof v === 'boolean' ? v : false
}

/** Build the daemon's Hono app over a MemoryStore. Stateless apart from `opts` and the store. */
export function createApp(store: MemoryStore, opts: CreateAppOptions): Hono {
  const app = new Hono()
  const now = () => new Date().toISOString()

  if (opts.token) {
    const expected = `Bearer ${opts.token}`
    app.use('*', async (c, next) => {
      if (c.req.path === '/health') return next()
      if (c.req.header('Authorization') !== expected) {
        return c.json({ error: 'unauthorized' }, 401)
      }
      return next()
    })
  }

  app.get('/health', async (c) =>
    c.json({ status: 'ok', vectorEnabled: readVectorEnabled(store), count: await store.count() }),
  )

  app.post('/memories', async (c) => {
    const parsed = NewRecordInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400)
    const rec = newRecord(parsed.data, opts.hlc)
    await store.upsert(rec)
    opts.oplog?.append({ kind: 'upsert', record: rec, id: rec.id, hlc: rec.hlc, at: now() })
    return c.json(rec, 201)
  })

  app.get('/memories', async (c) => {
    const parsed = ListQuerySchema.safeParse({
      scope: c.req.query('scope'),
      scopePath: c.req.query('scopePath'),
      type: c.req.query('type'),
      status: c.req.query('status'),
    })
    if (!parsed.success) return c.json({ error: 'invalid query', issues: parsed.error.issues }, 400)
    return c.json(await store.all(parsed.data))
  })

  app.get('/memories/:id', async (c) => {
    const rec = await store.get(c.req.param('id'))
    if (!rec || rec.status === 'tombstone') return c.json({ error: 'not found' }, 404)
    return c.json(rec)
  })

  app.patch('/memories/:id', async (c) => {
    const prev = await store.get(c.req.param('id'))
    if (!prev || prev.status === 'tombstone') return c.json({ error: 'not found' }, 404)
    const parsed = PatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400)
    const next = reviseRecord(prev, parsed.data, opts.hlc)
    await store.upsert(next)
    opts.oplog?.append({ kind: 'upsert', record: next, id: next.id, hlc: next.hlc, at: now() })
    return c.json(next, 200)
  })

  app.delete('/memories/:id', async (c) => {
    const id = c.req.param('id')
    const prev = await store.get(id)
    if (!prev || prev.status === 'tombstone') return c.json({ error: 'not found' }, 404)
    const hlc = tick(opts.hlc)
    await store.tombstone(id, hlc)
    opts.oplog?.append({ kind: 'tombstone', id, hlc, at: now() })
    return c.body(null, 204)
  })

  app.post('/search', async (c) => {
    const parsed = SearchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400)
    const { query, ...rest } = parsed.data
    return c.json(await store.search(query, rest))
  })

  return app
}
