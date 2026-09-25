// SPDX-License-Identifier: Apache-2.0
import { MEMORY_TYPES, SCOPES, newRecord, tick } from '@memfold/core'
import type { HlcState, MemoryRecord, MemoryStore, NewRecordInput, SearchHit } from '@memfold/core'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

/** Options for {@link createMemfoldMcpServer}. */
export interface CreateMemfoldMcpServerOptions {
  /** Hybrid logical clock used to stamp new records and tombstones. */
  hlc: HlcState
  /** Node identity recorded as the write author. Defaults to the HLC node id. */
  nodeId?: string
  /**
   * Register the `memory://` resources (progressive enhancement). Reads are always
   * available as tools, so tool-only clients keep full functionality with this off.
   * Default: true.
   */
  resources?: boolean
}

const typeEnum = z.enum(MEMORY_TYPES)
const scopeEnum = z.enum(SCOPES)

/** Wrap any JSON-serialisable payload as a single compact text content block. */
function text(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

/** Compact, list-friendly projection of a record. */
function summarize(rec: MemoryRecord) {
  return {
    id: rec.id,
    type: rec.type,
    scope: rec.scope,
    scope_path: rec.scope_path ?? undefined,
    title: rec.title ?? undefined,
    summary: rec.summary ?? undefined,
    tags: rec.tags,
    status: rec.status,
    updated_at: rec.updated_at,
  }
}

/** A search hit projected to the ranked fields a caller needs. */
function hitView(hit: SearchHit) {
  return { ...summarize(hit.record), score: Number(hit.score.toFixed(6)), via: hit.via }
}

/**
 * Build an MCP server that exposes a memfold {@link MemoryStore} to any MCP client.
 *
 * Every read and write is a tool, the one primitive every MCP client implements. The
 * `memory://` resources mirror the read tools for the clients that also read resources,
 * so tool-only clients keep the full surface.
 */
export function createMemfoldMcpServer(
  store: MemoryStore,
  opts: CreateMemfoldMcpServerOptions,
): McpServer {
  const { hlc } = opts
  const author = opts.nodeId ?? hlc.nodeId
  const server = new McpServer({ name: 'memfold', version: '0.1.0' })

  server.registerTool(
    'memory_search',
    {
      title: 'Search memory',
      description:
        'Hybrid keyword and semantic search over stored memory. Returns ranked hits with id, type, scope, title/summary and score.',
      inputSchema: {
        query: z.string().min(1).describe('Natural-language or keyword query'),
        limit: z.number().int().positive().max(100).optional().describe('Max hits (default 10)'),
        scope: scopeEnum.optional().describe('Restrict to one scope'),
        types: z.array(typeEnum).optional().describe('Restrict to these record types'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit, scope, types }) => {
      const hits = await store.search(query, { limit, scope, types })
      return text(hits.map(hitView))
    },
  )

  server.registerTool(
    'memory_write',
    {
      title: 'Write memory',
      description:
        'Store a new memory record and return its id. Choose scope and type so the memory can be found and re-used later.',
      inputSchema: {
        type: typeEnum.describe('Record type'),
        scope: scopeEnum.describe('Visibility scope'),
        body: z.string().min(1).describe('The memory content'),
        title: z.string().optional().describe('Short human label'),
        tags: z.array(z.string()).optional().describe('Free-form tags'),
        scope_path: z
          .string()
          .optional()
          .describe('Path the scope is anchored to: project root, dir, or session id'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ type, scope, body, title, tags, scope_path }) => {
      const input: NewRecordInput = {
        type,
        scope,
        body,
        title: title ?? null,
        tags: tags ?? [],
        scope_path: scope_path ?? null,
        provenance: { source: 'agent', tool: 'memfold-mcp', author },
      }
      const rec = newRecord(input, hlc)
      await store.upsert(rec)
      return text({ id: rec.id, rev: rec.rev, type: rec.type, scope: rec.scope })
    },
  )

  server.registerTool(
    'memory_get',
    {
      title: 'Get memory',
      description: 'Fetch a single memory record by id.',
      inputSchema: { id: z.string().min(1).describe('Record id') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const rec = await store.get(id)
      return rec ? text(rec) : text({ found: false, id })
    },
  )

  server.registerTool(
    'memory_list',
    {
      title: 'List memory',
      description: 'List active memory records, optionally filtered by scope and type.',
      inputSchema: {
        scope: scopeEnum.optional().describe('Restrict to one scope'),
        type: typeEnum.optional().describe('Restrict to one type'),
        limit: z.number().int().positive().max(500).optional().describe('Max records'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ scope, type, limit }) => {
      const recs = await store.all({ scope, type, status: 'active' })
      const items = (typeof limit === 'number' ? recs.slice(0, limit) : recs).map(summarize)
      return text({ count: items.length, items })
    },
  )

  server.registerTool(
    'memory_forget',
    {
      title: 'Forget memory',
      description:
        'Tombstone a memory record so it stops surfacing in reads. Returns whether it existed.',
      inputSchema: { id: z.string().min(1).describe('Record id to forget') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const existing = await store.get(id)
      if (!existing) return text({ forgotten: false, id })
      await store.tombstone(id, tick(hlc))
      return text({ forgotten: true, id })
    },
  )

  if (opts.resources !== false) registerResources(server, store)

  return server
}

/** Progressive enhancement: mirror the read surface as `memory://` resources. */
function registerResources(server: McpServer, store: MemoryStore): void {
  server.registerResource(
    'memory-index',
    'memory://index',
    {
      title: 'Memory index',
      description: 'JSON list of all active memory records.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const items = (await store.all({ status: 'active' })).map(summarize)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ count: items.length, items }),
          },
        ],
      }
    },
  )

  server.registerResource(
    'memory-record',
    new ResourceTemplate('memory://record/{id}', {
      list: async () => ({
        resources: (await store.all({ status: 'active' })).map((rec) => ({
          uri: `memory://record/${rec.id}`,
          name: rec.title ?? rec.id,
          description: rec.summary ?? undefined,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Memory record',
      description: 'A single memory record as JSON, addressed by id.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const raw = variables.id
      const id = Array.isArray(raw) ? raw[0] : raw
      const rec = id ? await store.get(id) : null
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(rec ?? { error: 'not_found', id: id ?? null }),
          },
        ],
      }
    },
  )
}
