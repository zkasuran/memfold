// SPDX-License-Identifier: FSL-1.1-ALv2
import type { MemoryRecord, MemoryType, Scope } from '@memfold/core'
import { type ResolveOptions, resolveStore } from '../store'
import { firstLine, log, pc } from '../ui'

export interface ListOptions extends ResolveOptions {
  scope?: string
  type?: string
}

/** List active records, optionally filtered by scope and type. */
export async function listAction(opts: ListOptions = {}): Promise<MemoryRecord[]> {
  const resolved = resolveStore(opts)
  try {
    const records = await resolved.store.all({
      scope: opts.scope as Scope | undefined,
      type: opts.type as MemoryType | undefined,
      status: 'active',
    })
    if (records.length === 0) {
      log(pc.dim('no memories stored yet'))
    }
    for (const rec of records) {
      const label = rec.title ?? firstLine(rec.body)
      const meta = pc.dim(`${rec.type}/${rec.scope}`)
      log(`${pc.bold(rec.id)}  ${meta}  ${label}`)
    }
    return records
  } finally {
    await resolved.close()
  }
}
