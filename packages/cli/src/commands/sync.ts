// SPDX-License-Identifier: FSL-1.1-ALv2
import { detectInstalled, writeCompiled } from '@memfold/adapters'
import { type ResolveOptions, resolveStore } from '../store'
import { log, pc } from '../ui'

export type SyncOptions = ResolveOptions

export interface SyncResult {
  imported: number
  compiled: Array<{ tool: string; paths: string[] }>
}

/**
 * Round-trip: import from every detected tool into the store, then compile the merged store
 * back out to those same tools so each one ends up with the shared memory.
 */
export async function syncAction(opts: SyncOptions = {}): Promise<SyncResult> {
  const resolved = resolveStore(opts)
  try {
    const detected = await detectInstalled(resolved.root)
    if (detected.length === 0) {
      log(pc.dim('no tools detected to sync'))
      return { imported: 0, compiled: [] }
    }

    let imported = 0
    for (const adapter of detected) {
      const records = await adapter.read(resolved.root)
      for (const rec of records) await resolved.store.upsert(rec)
      imported += records.length
    }

    const records = await resolved.store.all({ status: 'active' })
    const groups = detected.map((adapter) => ({
      adapter,
      files: adapter.compile(records, { root: resolved.root }),
    }))
    await writeCompiled(groups.flatMap((g) => g.files))

    log(pc.bold(`synced ${detected.length} tool(s)`))
    log(`  imported ${imported} record(s)`)
    for (const g of groups) {
      for (const f of g.files) log(`  ${pc.green(g.adapter.displayName)}  ${pc.cyan(f.path)}`)
    }

    return {
      imported,
      compiled: groups.map((g) => ({ tool: g.adapter.id, paths: g.files.map((f) => f.path) })),
    }
  } finally {
    await resolved.close()
  }
}
