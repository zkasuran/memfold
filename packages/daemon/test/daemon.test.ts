// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore, makeHlcState, newNodeId } from '@memfold/core'
import type { MemoryRecord, SearchHit } from '@memfold/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { OpLog } from '../src/oplog'

const json = (input: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
})

describe('daemon api', () => {
  let store: SqliteStore
  let app: ReturnType<typeof createApp>
  let dir: string
  let oplog: OpLog

  beforeEach(() => {
    store = new SqliteStore(':memory:')
    dir = mkdtempSync(join(tmpdir(), 'memfold-daemon-'))
    oplog = new OpLog(join(dir, 'oplog.jsonl'))
    app = createApp(store, { hlc: makeHlcState(newNodeId()), oplog })
  })

  afterEach(async () => {
    await store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports status, vector flag and count on /health', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; vectorEnabled: boolean; count: number }
    expect(body.status).toBe('ok')
    expect(typeof body.vectorEnabled).toBe('boolean')
    expect(body.count).toBe(0)
  })

  it('creates, reads, searches, patches and tombstones a memory', async () => {
    const create = await app.request(
      '/memories',
      json({
        type: 'fact',
        scope: 'project',
        body: 'The deployment pipeline runs on Kubernetes with a blue-green rollout',
        provenance: { source: 'user' },
        tags: ['ops'],
      }),
    )
    expect(create.status).toBe(201)
    const rec = (await create.json()) as MemoryRecord
    expect(rec.id).toBeTruthy()
    expect(rec.type).toBe('fact')
    expect(rec.status).toBe('active')

    const got = await app.request(`/memories/${rec.id}`)
    expect(got.status).toBe(200)
    expect(((await got.json()) as MemoryRecord).id).toBe(rec.id)

    const search = await app.request('/search', json({ query: 'kubernetes deployment' }))
    expect(search.status).toBe(200)
    const hits = (await search.json()) as SearchHit[]
    expect(hits.some((h) => h.record.id === rec.id)).toBe(true)

    const patch = await app.request(`/memories/${rec.id}`, {
      ...json({ salience: 0.9 }),
      method: 'PATCH',
    })
    expect(patch.status).toBe(200)
    const patched = (await patch.json()) as MemoryRecord
    expect(patched.id).toBe(rec.id)
    expect(patched.salience).toBe(0.9)
    expect(patched.supersedes).toBe(rec.rev)

    const del = await app.request(`/memories/${rec.id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)

    const gone = await app.request(`/memories/${rec.id}`)
    expect(gone.status).toBe(404)

    const entries = oplog.all()
    expect(entries.map((e) => e.kind)).toEqual(['upsert', 'upsert', 'tombstone'])
    expect(entries[2]?.id).toBe(rec.id)
  })

  it('rejects an invalid create body with 400', async () => {
    const res = await app.request('/memories', json({ scope: 'project', body: 'no type' }))
    expect(res.status).toBe(400)
  })
})

describe('daemon auth', () => {
  it('requires a bearer token on protected routes but leaves /health open', async () => {
    const store = new SqliteStore(':memory:')
    const app = createApp(store, { hlc: makeHlcState(newNodeId()), token: 'secret-token' })

    expect((await app.request('/health')).status).toBe(200)
    expect((await app.request('/memories')).status).toBe(401)
    const ok = await app.request('/memories', {
      headers: { Authorization: 'Bearer secret-token' },
    })
    expect(ok.status).toBe(200)

    await store.close()
  })
})
