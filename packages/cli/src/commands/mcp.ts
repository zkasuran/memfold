// SPDX-License-Identifier: FSL-1.1-ALv2
import { createMemfoldMcpServer } from '@memfold/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { type ResolveOptions, resolveStore } from '../store'
import { errline } from '../ui'

export type McpOptions = ResolveOptions

/**
 * Serve the resolved store to any MCP client over stdio. stdout is the JSON-RPC channel, so
 * every diagnostic goes to stderr.
 */
export async function mcpAction(opts: McpOptions = {}): Promise<void> {
  const resolved = resolveStore(opts)
  const server = createMemfoldMcpServer(resolved.store, {
    hlc: resolved.hlc,
    nodeId: resolved.nodeId,
  })

  const shutdown = async () => {
    await server.close().catch(() => {})
    await resolved.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await server.connect(new StdioServerTransport())
  errline(`memfold mcp: listening on stdio (db=${resolved.dbPath}, node=${resolved.nodeId})`)
}
