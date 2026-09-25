// SPDX-License-Identifier: FSL-1.1-ALv2
import { serve } from '@hono/node-server'
import { OpLog, createApp } from '@memfold/daemon'
import { type ResolveOptions, resolveStore } from '../store'
import { errline, log, pc } from '../ui'

export interface ServeOptions extends ResolveOptions {
  port?: string | number
  host?: string
  token?: string
}

export interface ServeHandle {
  url: string
  authenticated: boolean
  close(): Promise<void>
}

/**
 * Start the local HTTP daemon over the resolved store. Without `--token` the server is
 * unauthenticated: anyone who can reach the port has full read and write access, so it binds
 * to loopback by default and prints a clear warning.
 */
export async function serveAction(opts: ServeOptions = {}): Promise<ServeHandle> {
  const resolved = resolveStore(opts)
  const port = Number(opts.port ?? 7077)
  const host = opts.host ?? '127.0.0.1'
  const token = opts.token
  const oplog = new OpLog(`${resolved.dbPath}.oplog.jsonl`)
  const app = createApp(resolved.store, { hlc: resolved.hlc, token, oplog })

  const server = serve({ fetch: app.fetch, port, hostname: host })
  const url = `http://${host}:${port}`

  log(`${pc.bold('memfold daemon')} ${pc.cyan(url)}`)
  log(`  store  ${resolved.dbPath}`)
  if (token) {
    log(`  auth   ${pc.green('on')} (bearer token required)`)
  } else {
    log(`  auth   ${pc.red('off')}`)
    errline(
      pc.yellow(
        'warning: unauthenticated. Anyone who can reach this port has full read/write access. Pass --token to require a bearer token before exposing it beyond loopback.',
      ),
    )
  }

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await resolved.close()
  }

  const shutdown = () => {
    void close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return { url, authenticated: Boolean(token), close }
}
