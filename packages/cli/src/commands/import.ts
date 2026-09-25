// SPDX-License-Identifier: FSL-1.1-ALv2
import { type Adapter, detectInstalled, getAdapter } from '@memfold/adapters'
import { type ResolveOptions, resolveStore } from '../store'
import { log, pc } from '../ui'

export interface ImportOptions extends ResolveOptions {
  /** A single adapter id to import from. Default: every detected tool. */
  from?: string
}

export interface ImportResult {
  perTool: Array<{ tool: string; count: number }>
  total: number
}

/** Read each tool's native rules/memory files into records and upsert them into the store. */
export async function importAction(opts: ImportOptions = {}): Promise<ImportResult> {
  const resolved = resolveStore(opts)
  try {
    let adapters: Adapter[]
    if (opts.from) {
      const adapter = getAdapter(opts.from)
      if (!adapter) throw new Error(`memfold: unknown tool '${opts.from}'`)
      adapters = [adapter]
    } else {
      adapters = await detectInstalled(resolved.root)
    }

    const perTool: Array<{ tool: string; count: number }> = []
    let total = 0
    for (const adapter of adapters) {
      const records = await adapter.read(resolved.root)
      for (const rec of records) await resolved.store.upsert(rec)
      perTool.push({ tool: adapter.id, count: records.length })
      total += records.length
    }

    if (adapters.length === 0) {
      log(pc.dim('no tools detected to import from'))
    } else {
      log(pc.bold(`imported ${total} record(s)`))
      for (const t of perTool) log(`  ${pc.green(t.tool)}  ${t.count}`)
    }

    return { perTool, total }
  } finally {
    await resolved.close()
  }
}
