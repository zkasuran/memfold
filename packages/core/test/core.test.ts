import { afterEach, describe, expect, it } from 'vitest'
import { HashEmbedder } from '../src/embeddings'
import { newRecord } from '../src/factory'
import { compareHlc, makeHlcState, tick } from '../src/hlc'
import { parseRecord, serializeRecord } from '../src/record'
import { scanSecrets } from '../src/secrets'
import { SqliteStore } from '../src/sqlite-store'

describe('record', () => {
  it('round-trips through frontmatter serialization', () => {
    const hlc = makeHlcState('test')
    const rec = newRecord(
      {
        type: 'preference',
        scope: 'project',
        scope_path: '/repo',
        body: 'Use tabs, width 4.',
        provenance: { source: 'user' },
        tags: ['style'],
      },
      hlc,
    )
    expect(parseRecord(serializeRecord(rec))).toEqual(rec)
  })
})

describe('hlc', () => {
  it('is monotonic and totally ordered', () => {
    const s = makeHlcState('n1')
    const a = tick(s, 1000)
    const b = tick(s, 1000)
    const c = tick(s, 2000)
    expect(compareHlc(a, b)).toBeLessThan(0)
    expect(compareHlc(b, c)).toBeLessThan(0)
    expect(compareHlc(c, a)).toBeGreaterThan(0)
  })
})

describe('secrets', () => {
  it('flags an AWS key and a private key block', () => {
    const kinds = scanSecrets('key AKIAIOSFODNN7EXAMPLE and -----BEGIN PRIVATE KEY-----').map(
      (x) => x.kind,
    )
    expect(kinds).toContain('aws-access-key-id')
    expect(kinds).toContain('private-key-block')
  })
  it('passes clean prose', () => {
    expect(scanSecrets('just some normal notes about the project')).toHaveLength(0)
  })
})

describe('store', () => {
  let store: SqliteStore
  afterEach(async () => {
    await store?.close()
  })

  it('inserts and retrieves the most relevant record', async () => {
    store = new SqliteStore(':memory:', { embedder: new HashEmbedder(64) })
    const hlc = makeHlcState('n1')
    const a = newRecord(
      {
        type: 'convention',
        scope: 'project',
        body: 'Always run the linter before committing.',
        provenance: { source: 'user' },
      },
      hlc,
    )
    const b = newRecord(
      {
        type: 'fact',
        scope: 'project',
        body: 'The database is Postgres 16 on port 5432.',
        provenance: { source: 'user' },
      },
      hlc,
    )
    await store.upsert(a)
    await store.upsert(b)
    expect(await store.count()).toBe(2)
    const hits = await store.search('database postgres port')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.record.id).toBe(b.id)
  })

  it('tombstoned records drop out of active search', async () => {
    store = new SqliteStore(':memory:', { embedder: new HashEmbedder(64) })
    const hlc = makeHlcState('n1')
    const a = newRecord(
      {
        type: 'fact',
        scope: 'project',
        body: 'ephemeral note about caching',
        provenance: { source: 'user' },
      },
      hlc,
    )
    await store.upsert(a)
    await store.tombstone(a.id, tick(hlc))
    expect(await store.count()).toBe(0)
    const hits = await store.search('caching')
    expect(hits.find((h) => h.record.id === a.id)).toBeUndefined()
  })
})
