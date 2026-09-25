// SPDX-License-Identifier: FSL-1.1-ALv2
import {
  ALL_ADAPTERS,
  type Adapter,
  detectInstalled,
  getAdapter,
  writeCompiled,
} from '@memfold/adapters'
import { type ResolveOptions, resolveStore } from '../store'
import { log, pc } from '../ui'

export interface CompileOptions extends ResolveOptions {
  /** Comma-separated adapter ids to compile to. */
  targets?: string
  /** Compile to every known adapter. */
  all?: boolean
  /** Render and report without writing any file. */
  dryRun?: boolean
}

export interface CompileGroup {
  tool: string
  paths: string[]
}

export interface CompileResult {
  dryRun: boolean
  groups: CompileGroup[]
}

/** Resolve the adapter set from `--targets`, `--all`, or (default) the detected tools. */
async function selectAdapters(opts: CompileOptions, root: string): Promise<Adapter[]> {
  if (opts.targets) {
    return opts.targets
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((id) => {
        const adapter = getAdapter(id)
        if (!adapter) throw new Error(`memfold: unknown target '${id}'`)
        return adapter
      })
  }
  if (opts.all) return ALL_ADAPTERS
  return detectInstalled(root)
}

/**
 * Compile the active store out to each target tool's native file. This is the headline: one
 * canonical store rendered into every tool's own format in a single pass.
 */
export async function compileAction(opts: CompileOptions = {}): Promise<CompileResult> {
  const resolved = resolveStore(opts)
  try {
    const adapters = await selectAdapters(opts, resolved.root)
    const records = await resolved.store.all({ status: 'active' })
    const groups = adapters.map((adapter) => ({
      adapter,
      files: adapter.compile(records, { root: resolved.root }),
    }))
    const files = groups.flatMap((g) => g.files)

    if (!opts.dryRun) await writeCompiled(files)

    if (adapters.length === 0) {
      log(
        pc.dim(
          'no target tools (pass --targets <ids> or --all, or run from a repo with tools set up)',
        ),
      )
    } else {
      log(opts.dryRun ? pc.bold('compile (dry run)') : pc.bold('compiled'))
      for (const g of groups) {
        for (const f of g.files) {
          log(`  ${pc.green(g.adapter.displayName)}  ${pc.cyan(f.path)}`)
        }
      }
    }

    return {
      dryRun: Boolean(opts.dryRun),
      groups: groups.map((g) => ({ tool: g.adapter.id, paths: g.files.map((f) => f.path) })),
    }
  } finally {
    await resolved.close()
  }
}
