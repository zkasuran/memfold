// SPDX-License-Identifier: Apache-2.0
import type { MemoryRecord, MemoryType } from '@memfold/core'

/** One file the compiler wants on disk. `path` is absolute. */
export interface CompiledFile {
  path: string
  contents: string
  /**
   * When true, `writeCompiled` merges the managed block into an existing file
   * instead of overwriting it, so hand-authored text around the block survives.
   */
  managed?: boolean
  /**
   * When false, `writeCompiled` skips the secret scan for this file. Used only
   * for surgically merged user config (e.g. `.aider.conf.yml`) that carries no
   * memory content but may legitimately hold the user's own API key.
   */
  secretScan?: boolean
}

export interface CompileOptions {
  /** Absolute repo root that compiled paths resolve against. */
  root: string
  /** Record types to leave out of compiled files. Default: episodic + task. */
  skipTypes?: MemoryType[]
}

/**
 * A tool adapter. `read` ingests a tool's native rules/memory files into
 * records (best-effort, provenance.source = 'import'); `compile` renders the
 * canonical store back out to that tool's native format.
 */
export interface Adapter {
  /** Stable id, also used as provenance.tool on read (e.g. 'claude-code'). */
  id: string
  displayName: string
  /** Is this tool configured in the repo at `root`? */
  detect(root: string): Promise<boolean>
  /** Parse native files under `root` into records. */
  read(root: string): Promise<MemoryRecord[]>
  /** Render records to this tool's native file(s). */
  compile(records: MemoryRecord[], opts: CompileOptions): CompiledFile[]
}

/**
 * Stable markers that fence memfold-generated content inside a hand-authored
 * file. Everything outside the pair is preserved on rewrite.
 */
export const MANAGED_BEGIN = '<!-- memfold:begin -->'
export const MANAGED_END = '<!-- memfold:end -->'

const MANAGED_BLOCK_RE = /<!--\s*memfold:begin\s*-->[\s\S]*?<!--\s*memfold:end\s*-->/
const MANAGED_BODY_RE = /<!--\s*memfold:begin\s*-->\r?\n?([\s\S]*?)\r?\n?<!--\s*memfold:end\s*-->/

/** Fence `body` between the managed markers. */
export function wrapManagedBlock(body: string): string {
  return `${MANAGED_BEGIN}\n${body.trim()}\n${MANAGED_END}`
}

/** Return the content between the managed markers, or null if there is none. */
export function extractManagedBody(text: string): string | null {
  const m = MANAGED_BODY_RE.exec(text)
  return m ? (m[1] ?? '').trim() : null
}

/**
 * Insert or refresh the managed block in `existing`, preserving all surrounding
 * text. If no block is present it is appended; if `existing` is empty the block
 * becomes the whole file. `generatedBody` is the inner content, without markers.
 */
export function mergeManagedBlock(existing: string, generatedBody: string): string {
  const block = wrapManagedBlock(generatedBody)
  if (MANAGED_BLOCK_RE.test(existing)) {
    return existing.replace(MANAGED_BLOCK_RE, block)
  }
  const head = existing.replace(/\s+$/, '')
  if (head.length === 0) return `${block}\n`
  return `${head}\n\n${block}\n`
}
