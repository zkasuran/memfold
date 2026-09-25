// SPDX-License-Identifier: Apache-2.0

import { makeHlcState, newRecord } from '@memfold/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemfoldClient, MemfoldHttpError } from '../src/client'
import { Memfold } from '../src/embedded'
import { MemfoldLangGraphStore } from '../src/frameworks/langgraph-store'
import { MemfoldChatStore } from '../src/frameworks/vercel-ai'

describe('Memfold (embedded)', () => {
  it('add then search returns the record', async () => {
    const mf = new Memfold()
    const rec = await mf.add({
      type: 'preference',
      scope: 'global',
      body: 'The user prefers dark mode in the editor',
    })
    expect(rec.id).toBeTruthy()
    expect(rec.body).toContain('dark mode')

    const hits = await mf.search('dark mode')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.record.id).toBe(rec.id)

    expect((await mf.get(rec.id))?.id).toBe(rec.id)
    await mf.close()
  })
})

describe('MemfoldLangGraphStore', () => {
  it('put/get/search round-trip, then update and delete', async () => {
    const mf = new Memfold()
    const store = new MemfoldLangGraphStore(mf)

    await store.put(['users', 'u1'], 'pref', { food: 'sushi', note: 'likes salmon nigiri' })

    const item = await store.get(['users', 'u1'], 'pref')
    expect(item?.namespace).toEqual(['users', 'u1'])
    expect(item?.key).toBe('pref')
    expect(item?.value).toEqual({ food: 'sushi', note: 'likes salmon nigiri' })

    const results = await store.search(['users'], { query: 'salmon' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.value).toMatchObject({ food: 'sushi' })

    await store.put(['users', 'u1'], 'pref', { food: 'ramen' })
    expect((await store.get(['users', 'u1'], 'pref'))?.value).toEqual({ food: 'ramen' })

    await store.delete(['users', 'u1'], 'pref')
    expect(await store.get(['users', 'u1'], 'pref')).toBeNull()
    await mf.close()
  })
})

describe('MemfoldChatStore (vercel-ai)', () => {
  it('saves and loads chat messages by thread, overwriting on re-save', async () => {
    const mf = new Memfold()
    const store = new MemfoldChatStore(mf)

    expect(await store.loadMessages('t1')).toEqual([])
    const msgs = [
      { id: 'm1', role: 'user', content: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello' },
    ]
    await store.saveMessages('t1', msgs)
    expect(await store.loadMessages('t1')).toEqual(msgs)

    await store.saveChat({ chatId: 't1', messages: [{ id: 'm3', role: 'user', content: 'bye' }] })
    expect(await store.loadMessages('t1')).toHaveLength(1)
    await mf.close()
  })
})

describe('MemfoldClient (remote, stubbed fetch)', () => {
  const hlc = makeHlcState('test')
  const fakeRecord = (body: string) =>
    newRecord({ type: 'fact', scope: 'project', body, provenance: { source: 'user' } }, hlc)

  let lastReq: {
    url: string
    method: string
    headers: Record<string, string>
    body: unknown
  } | null = null

  type Route = { body?: unknown; status?: number; statusText?: string }
  function installFetch(routes: (url: string, method: string, body: unknown) => Route) {
    const impl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      lastReq = { url, method, headers: (init?.headers ?? {}) as Record<string, string>, body }
      const r = routes(url, method, body)
      return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
        status: r.status ?? 200,
        statusText: r.statusText ?? 'OK',
      })
    }
    vi.stubGlobal('fetch', impl)
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    lastReq = null
  })

  it('add() posts a NewRecordInput with a default provenance and bearer token', async () => {
    const rec = fakeRecord('remote fact about widgets')
    installFetch((url, method) =>
      method === 'POST' && url.endsWith('/memories') ? { body: rec } : { status: 404 },
    )
    const client = new MemfoldClient({ baseUrl: 'http://daemon.test', token: 'sekret' })
    const out = await client.add({
      type: 'fact',
      scope: 'project',
      body: 'remote fact about widgets',
    })

    expect(out.id).toBe(rec.id)
    expect(out.body).toBe('remote fact about widgets')
    expect(lastReq?.url).toBe('http://daemon.test/memories')
    expect(lastReq?.headers.authorization).toBe('Bearer sekret')
    expect(lastReq?.body).toMatchObject({
      type: 'fact',
      scope: 'project',
      provenance: { source: 'agent' },
    })
  })

  it('search() posts the query and parses SearchHit[]', async () => {
    const rec = fakeRecord('widgets are blue')
    const hit = { record: rec, score: 0.42, via: ['fts'] }
    installFetch((url, method) =>
      method === 'POST' && url.endsWith('/search') ? { body: [hit] } : { status: 404 },
    )
    const client = new MemfoldClient({ baseUrl: 'http://daemon.test/' })
    const hits = await client.search('widgets', { limit: 5, scope: 'project' })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.record.id).toBe(rec.id)
    expect(hits[0]?.score).toBe(0.42)
    expect(hits[0]?.via).toEqual(['fts'])
    expect(lastReq?.body).toMatchObject({ query: 'widgets', limit: 5, scope: 'project' })
  })

  it('get() maps 404 to null and throws MemfoldHttpError on other errors', async () => {
    installFetch((url) => {
      if (url.endsWith('/memories/boom')) return { status: 500, statusText: 'Server Error' }
      return { status: 404, statusText: 'Not Found' }
    })
    const client = new MemfoldClient({ baseUrl: 'http://daemon.test' })
    expect(await client.get('missing')).toBeNull()
    await expect(client.get('boom')).rejects.toBeInstanceOf(MemfoldHttpError)
  })
})
