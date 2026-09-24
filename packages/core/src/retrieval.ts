import type { MemoryRecord } from './record'

/**
 * Reciprocal Rank Fusion. Each leg is an ordered list of ids (best first). Returns a map of
 * id -> fused score. k=60 is the standard constant; no cross-leg score normalization needed.
 */
export function rrf(legs: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>()
  for (const leg of legs) {
    leg.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1))
    })
  }
  return scores
}

/** Recency multiplier from a record's decay half-life. Pinned or no half-life => 1.0. */
export function recencyFactor(rec: MemoryRecord, nowMs: number): number {
  if (rec.decay?.pinned) return 1
  const hl = rec.decay?.half_life_days
  if (!hl || hl <= 0) return 1
  const ref = Date.parse(rec.last_accessed_at ?? rec.updated_at)
  if (Number.isNaN(ref)) return 1
  const ageDays = Math.max(0, (nowMs - ref) / 86_400_000)
  return 0.5 ** (ageDays / hl)
}

/** Blended retrieval score: fusion × importance × recency × confidence. */
export function finalScore(rrfScore: number, rec: MemoryRecord, nowMs: number): number {
  return rrfScore * (0.5 + 0.5 * rec.salience) * recencyFactor(rec, nowMs) * rec.confidence
}

/** Turn free text into a safe FTS5 MATCH expression (OR of quoted unicode tokens). */
export function toFtsMatch(query: string): string {
  const toks = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  if (toks.length === 0) return ''
  return toks.map((t) => `"${t}"`).join(' OR ')
}
