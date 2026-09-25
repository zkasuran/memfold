// SPDX-License-Identifier: FSL-1.1-ALv2
import type { MemoryType, Scope, SearchHit } from '@memfold/core'
import { type ResolveOptions, resolveStore } from '../store'
import { firstLine, log, pc } from '../ui'

export interface SearchOptions extends ResolveOptions {
  limit?: string | number
  scope?: string
  type?: string
}

/** Hybrid keyword + vector search over the store, printing ranked hits. */
export async function searchAction(
  queryParts: string[],
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const query = queryParts.join(' ').trim()
  if (!query) throw new Error('memfold: nothing to search for (empty query)')

  const resolved = resolveStore(opts)
  try {
    const limit = opts.limit === undefined ? undefined : Number(opts.limit)
    const hits = await resolved.store.search(query, {
      limit,
      scope: opts.scope as Scope | undefined,
      types: opts.type ? [opts.type as MemoryType] : undefined,
    })
    if (hits.length === 0) {
      log(pc.dim(`no memories match "${query}"`))
    }
    for (const hit of hits) {
      const label = hit.record.title ?? firstLine(hit.record.body)
      const score = pc.yellow(hit.score.toFixed(3))
      const meta = pc.dim(`${hit.record.type}/${hit.record.scope}`)
      log(`${score}  ${meta}  ${pc.bold(hit.record.id)}  ${label}`)
    }
    return hits
  } finally {
    await resolved.close()
  }
}
