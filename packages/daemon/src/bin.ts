#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
import { serve } from '@hono/node-server'
import { SqliteStore, makeHlcState, newNodeId } from '@memfold/core'
import { createApp } from './app'
import { OpLog } from './oplog'

const dbPath = process.env.MEMFOLD_DB ?? 'memfold.db'
const port = Number(process.env.MEMFOLD_PORT ?? 7077)
const host = process.env.MEMFOLD_HOST ?? '127.0.0.1'
const token = process.env.MEMFOLD_TOKEN
const oplogPath =
  process.env.MEMFOLD_OPLOG ??
  (dbPath === ':memory:' ? 'memfold.oplog.jsonl' : `${dbPath}.oplog.jsonl`)

const store = new SqliteStore(dbPath)
const hlc = makeHlcState(newNodeId())
const oplog = new OpLog(oplogPath)
const app = createApp(store, { hlc, token, oplog })

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const auth = token
    ? 'bearer token required'
    : 'UNAUTHENTICATED — anyone who can reach this port has full read/write access; set MEMFOLD_TOKEN to require a bearer token'
  console.log(
    `memfold-daemon listening on http://${info.address}:${info.port} (db=${dbPath}, oplog=${oplogPath}, vector=${store.vectorEnabled}, auth: ${auth})`,
  )
})
