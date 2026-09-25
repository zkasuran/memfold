#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { SqliteStore, makeHlcState } from '@memfold/core'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMemfoldMcpServer } from './server'

/** Resolve the SQLite path: MEMFOLD_DB, else an XDG-style per-user data file. */
function resolveDbPath(): string {
  const explicit = process.env.MEMFOLD_DB
  if (explicit) return explicit
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'memfold', 'memory.db')
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath()
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })

  const nodeId = process.env.MEMFOLD_NODE_ID || hostname()
  const store = new SqliteStore(dbPath)
  const hlc = makeHlcState(nodeId)
  const server = createMemfoldMcpServer(store, { hlc, nodeId })

  const shutdown = async () => {
    await server.close().catch(() => {})
    await store.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await server.connect(new StdioServerTransport())
  // stdout is the JSON-RPC channel, so all diagnostics go to stderr.
  process.stderr.write(`memfold-mcp: listening on stdio (db=${dbPath}, node=${nodeId})\n`)
}

main().catch((err) => {
  process.stderr.write(`memfold-mcp: fatal ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
