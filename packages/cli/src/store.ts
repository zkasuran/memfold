// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { type HlcState, SqliteStore, makeHlcState, newNodeId } from '@memfold/core'

export interface ResolveOptions {
  /** Directory the resolution starts from. Defaults to `process.cwd()`. */
  cwd?: string
  /** Use the global `~/.memfold` store instead of the nearest project store. */
  global?: boolean
  /** Disable the vector search leg (keyword-only). */
  novec?: boolean
}

export interface ResolvedStore {
  store: SqliteStore
  hlc: HlcState
  nodeId: string
  /** The `.memfold` directory holding the database and node state. */
  dir: string
  /** SQLite database path inside `dir`. */
  dbPath: string
  /** Root the compiled tool files resolve against (the project root, or cwd when global). */
  root: string
  global: boolean
  /** Persist the current HLC state back to disk. */
  persist(): void
  /** Persist the HLC state and close the store. */
  close(): Promise<void>
}

const STORE_DIR = '.memfold'
const DB_FILE = 'memory.db'
const NODE_FILE = 'node.json'

interface NodeState {
  nodeId: string
  wallMs: number
  counter: number
}

/** Walk up from `start`, returning the first existing `.memfold` directory or null. */
function findProjectStoreDir(start: string): string | null {
  let cur = start
  while (true) {
    const candidate = join(cur, STORE_DIR)
    if (existsSync(candidate)) return candidate
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function loadNodeState(dir: string): NodeState {
  const file = join(dir, NODE_FILE)
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<NodeState>
      if (raw.nodeId) {
        return {
          nodeId: raw.nodeId,
          wallMs: typeof raw.wallMs === 'number' ? raw.wallMs : 0,
          counter: typeof raw.counter === 'number' ? raw.counter : 0,
        }
      }
    } catch {
      // Corrupt state file, fall through to a fresh identity.
    }
  }
  return { nodeId: newNodeId(), wallMs: 0, counter: 0 }
}

function saveNodeState(dir: string, hlc: HlcState): void {
  const state: NodeState = { nodeId: hlc.nodeId, wallMs: hlc.wallMs, counter: hlc.counter }
  writeFileSync(join(dir, NODE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Locate and open the memfold store. With `global`, uses `~/.memfold`. Otherwise it reuses the
 * nearest `.memfold` directory found by walking up from `cwd`, falling back to `cwd/.memfold`.
 * The node identity and HLC state persist in `node.json` so stamps keep advancing across runs.
 */
export function resolveStore(opts: ResolveOptions = {}): ResolvedStore {
  const cwd = opts.cwd ?? process.cwd()
  const global = opts.global ?? false
  const dir = global
    ? join(homedir(), STORE_DIR)
    : (findProjectStoreDir(cwd) ?? join(cwd, STORE_DIR))
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, DB_FILE)
  const root = global ? cwd : dirname(dir)

  const node = loadNodeState(dir)
  const hlc = makeHlcState(node.nodeId)
  hlc.wallMs = node.wallMs
  hlc.counter = node.counter

  const store = new SqliteStore(dbPath, { novec: opts.novec })

  return {
    store,
    hlc,
    nodeId: node.nodeId,
    dir,
    dbPath,
    root,
    global,
    persist() {
      saveNodeState(dir, hlc)
    },
    async close() {
      saveNodeState(dir, hlc)
      await store.close()
    },
  }
}
