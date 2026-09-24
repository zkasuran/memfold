import BetterSqlite3, { type Database } from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { type Embedder, HashEmbedder } from './embeddings'
import { type MemoryRecord, MemoryRecordSchema } from './record'
import { finalScore, rrf, toFtsMatch } from './retrieval'
import type { AllOptions, MemoryStore, SearchHit, SearchOptions } from './store'

export interface SqliteStoreOptions {
  /** Embedding backend; defaults to the offline HashEmbedder. */
  embedder?: Embedder
  /** Disable the vector leg (keyword-only). Auto-disabled if sqlite-vec fails to load. */
  novec?: boolean
}

function blob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}

/** Local-first store: one SQLite file holding rows + FTS5 (BM25) + sqlite-vec (KNN). */
export class SqliteStore implements MemoryStore {
  private db: Database
  private embedder: Embedder
  private vecEnabled: boolean
  private dim: number

  constructor(path = ':memory:', opts: SqliteStoreOptions = {}) {
    this.embedder = opts.embedder ?? new HashEmbedder()
    this.dim = this.embedder.dim
    this.db = new BetterSqlite3(path)
    this.db.pragma('journal_mode = WAL')
    this.vecEnabled = false
    if (!opts.novec) {
      try {
        sqliteVec.load(this.db)
        this.vecEnabled = true
      } catch {
        this.vecEnabled = false
      }
    }
    this.init()
  }

  private init(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS memory (
         id TEXT PRIMARY KEY, rev TEXT, type TEXT, scope TEXT, scope_path TEXT,
         status TEXT, salience REAL, confidence REAL, dedup_key TEXT,
         content_hash TEXT, updated_at TEXT, hlc TEXT, json TEXT NOT NULL);
       CREATE INDEX IF NOT EXISTS memory_scope ON memory(scope, scope_path);
       CREATE INDEX IF NOT EXISTS memory_dedup ON memory(dedup_key);
       CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
         id UNINDEXED, body, title, summary, tokenize='porter unicode61');`,
    )
    if (this.vecEnabled) {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[${this.dim}]);`,
      )
    }
  }

  get vectorEnabled(): boolean {
    return this.vecEnabled
  }
  async upsert(rec: MemoryRecord): Promise<void> {
    const validated = MemoryRecordSchema.parse(rec)
    if (this.vecEnabled) {
      const [vec] = await this.embedder.embed([validated.body])
      const withMeta: MemoryRecord = {
        ...validated,
        embedding_model: this.embedder.model,
        embedding_dim: this.dim,
      }
      this.writeRow(withMeta, vec)
    } else {
      this.writeRow(validated, undefined)
    }
  }

  private writeRow(rec: MemoryRecord, vec?: Float32Array): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO memory
             (id,rev,type,scope,scope_path,status,salience,confidence,dedup_key,content_hash,updated_at,hlc,json)
           VALUES (@id,@rev,@type,@scope,@scope_path,@status,@salience,@confidence,@dedup_key,@content_hash,@updated_at,@hlc,@json)`,
        )
        .run({
          id: rec.id,
          rev: rec.rev,
          type: rec.type,
          scope: rec.scope,
          scope_path: rec.scope_path ?? null,
          status: rec.status,
          salience: rec.salience,
          confidence: rec.confidence,
          dedup_key: rec.dedup_key ?? null,
          content_hash: rec.content_hash,
          updated_at: rec.updated_at,
          hlc: rec.hlc,
          json: JSON.stringify(rec),
        })
      this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(rec.id)
      this.db
        .prepare('INSERT INTO memory_fts (id, body, title, summary) VALUES (?,?,?,?)')
        .run(rec.id, rec.body, rec.title ?? '', rec.summary ?? '')
      if (this.vecEnabled && vec) {
        this.db.prepare('DELETE FROM memory_vec WHERE id = ?').run(rec.id)
        this.db
          .prepare('INSERT INTO memory_vec (id, embedding) VALUES (?, ?)')
          .run(rec.id, blob(vec))
      }
    })
    tx()
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const row = this.db.prepare('SELECT json FROM memory WHERE id = ?').get(id) as
      | { json: string }
      | undefined
    return row ? (JSON.parse(row.json) as MemoryRecord) : null
  }

  async all(opts: AllOptions = {}): Promise<MemoryRecord[]> {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (opts.scope) {
      where.push('scope = @scope')
      params.scope = opts.scope
    }
    if (opts.scopePath) {
      where.push('scope_path = @scopePath')
      params.scopePath = opts.scopePath
    }
    if (opts.status) {
      where.push('status = @status')
      params.status = opts.status
    }
    if (opts.type) {
      where.push('type = @type')
      params.type = opts.type
    }
    const sql = `SELECT json FROM memory ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY updated_at DESC`
    const rows = this.db.prepare(sql).all(params) as Array<{ json: string }>
    return rows.map((r) => JSON.parse(r.json) as MemoryRecord)
  }
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const k = opts.candidateK ?? 50
    const limit = opts.limit ?? 10
    const legs: string[][] = []
    const viaOf = new Map<string, Set<'fts' | 'vec'>>()
    const mark = (id: string, leg: 'fts' | 'vec') => {
      const s = viaOf.get(id) ?? new Set<'fts' | 'vec'>()
      s.add(leg)
      viaOf.set(id, s)
    }

    const match = toFtsMatch(query)
    if (match) {
      const rows = this.db
        .prepare(
          'SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY bm25(memory_fts) LIMIT ?',
        )
        .all(match, k) as Array<{ id: string }>
      const ids = rows.map((r) => r.id)
      legs.push(ids)
      for (const id of ids) mark(id, 'fts')
    }

    if (this.vecEnabled) {
      const [qvec] = await this.embedder.embed([query])
      if (qvec) {
        const rows = this.db
          .prepare('SELECT id FROM memory_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?')
          .all(blob(qvec), k) as Array<{ id: string }>
        const ids = rows.map((r) => r.id)
        legs.push(ids)
        for (const id of ids) mark(id, 'vec')
      }
    }

    const fused = rrf(legs)
    const now = Date.now()
    const hits: SearchHit[] = []
    for (const [id, rrfScore] of fused) {
      const rec = await this.get(id)
      if (!rec) continue
      if (!opts.includeArchived && rec.status !== 'active') continue
      if (opts.scope && rec.scope !== opts.scope) continue
      if (opts.scopePath && rec.scope_path !== opts.scopePath) continue
      if (opts.types && !opts.types.includes(rec.type)) continue
      hits.push({
        record: rec,
        score: finalScore(rrfScore, rec, now),
        via: [...(viaOf.get(id) ?? [])],
      })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }

  async tombstone(id: string, hlc: string): Promise<void> {
    const rec = await this.get(id)
    if (!rec) return
    const dead: MemoryRecord = {
      ...rec,
      status: 'tombstone',
      hlc,
      updated_at: new Date().toISOString(),
    }
    this.db
      .prepare('UPDATE memory SET status = ?, hlc = ?, json = ? WHERE id = ?')
      .run('tombstone', hlc, JSON.stringify(dead), id)
    this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id)
    if (this.vecEnabled) this.db.prepare('DELETE FROM memory_vec WHERE id = ?').run(id)
  }

  async count(): Promise<number> {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM memory WHERE status = 'active'").get() as {
      n: number
    }
    return r.n
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
