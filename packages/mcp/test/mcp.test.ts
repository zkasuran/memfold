// SPDX-License-Identifier: Apache-2.0
import { SqliteStore, makeHlcState } from '@memfold/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemfoldMcpServer } from '../src/server'

/** Pull the single text block out of a tool result and parse its JSON payload. */
function payload<T>(res: unknown): T {
  const block = (res as CallToolResult).content?.[0]
  if (!block || block.type !== 'text') throw new Error('expected a text content block')
  return JSON.parse(block.text) as T
}

describe('@memfold/mcp server', () => {
  let store: SqliteStore
  let client: Client
  let server: ReturnType<typeof createMemfoldMcpServer>

  beforeEach(async () => {
    store = new SqliteStore(':memory:')
    server = createMemfoldMcpServer(store, { hlc: makeHlcState('test-node'), nodeId: 'test-node' })
    client = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  afterEach(async () => {
    await client.close()
    await server.close()
    await store.close()
  })

  it('exposes the five memory tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual([
      'memory_forget',
      'memory_get',
      'memory_list',
      'memory_search',
      'memory_write',
    ])
  })

  it('writes a memory and finds it via search', async () => {
    const written = payload<{ id: string }>(
      await client.callTool({
        name: 'memory_write',
        arguments: {
          type: 'convention',
          scope: 'project',
          body: 'The deploy command is pnpm ship',
          title: 'Deploy command',
        },
      }),
    )
    expect(written.id).toBeTruthy()

    const hits = payload<Array<{ id: string; score: number }>>(
      await client.callTool({ name: 'memory_search', arguments: { query: 'deploy command' } }),
    )
    expect(hits.some((h) => h.id === written.id)).toBe(true)
  })

  it('gets, lists and forgets a written record', async () => {
    const { id } = payload<{ id: string }>(
      await client.callTool({
        name: 'memory_write',
        arguments: { type: 'fact', scope: 'global', body: 'Water boils at 100C at sea level' },
      }),
    )

    const got = payload<{ id: string; body: string }>(
      await client.callTool({ name: 'memory_get', arguments: { id } }),
    )
    expect(got.body).toContain('boils')

    const listed = payload<{ count: number; items: Array<{ id: string }> }>(
      await client.callTool({ name: 'memory_list', arguments: { scope: 'global' } }),
    )
    expect(listed.items.some((r) => r.id === id)).toBe(true)

    const forgot = payload<{ forgotten: boolean }>(
      await client.callTool({ name: 'memory_forget', arguments: { id } }),
    )
    expect(forgot.forgotten).toBe(true)

    const afterList = payload<{ items: Array<{ id: string }> }>(
      await client.callTool({ name: 'memory_list', arguments: { scope: 'global' } }),
    )
    expect(afterList.items.some((r) => r.id === id)).toBe(false)
  })

  it('reads the memory://index resource', async () => {
    await client.callTool({
      name: 'memory_write',
      arguments: { type: 'fact', scope: 'session', body: 'the sky is blue' },
    })
    const res = await client.readResource({ uri: 'memory://index' })
    const first = res.contents[0] as { text?: string } | undefined
    expect(first).toBeDefined()
    const parsed = JSON.parse(String(first?.text)) as { count: number }
    expect(parsed.count).toBeGreaterThan(0)
  })
})
