// SPDX-License-Identifier: FSL-1.1-ALv2
import { detectInstalled } from '@memfold/adapters'
import { type ResolveOptions, resolveStore } from '../store'
import { log, pc } from '../ui'

export type InitOptions = ResolveOptions

export interface InitResult {
  dbPath: string
  dir: string
  global: boolean
  detected: string[]
}

/** Create the store directory, open it, detect installed tools, and print a summary. */
export async function initAction(opts: InitOptions = {}): Promise<InitResult> {
  const resolved = resolveStore(opts)
  try {
    const adapters = await detectInstalled(resolved.root)
    const detected = adapters.map((a) => a.id)
    log(pc.bold('memfold initialised'))
    log(`  store    ${pc.cyan(resolved.dbPath)}`)
    log(`  scope    ${resolved.global ? 'global (~/.memfold)' : 'project'}`)
    log(`  node id  ${resolved.nodeId}`)
    log(`  vectors  ${resolved.store.vectorEnabled ? pc.green('on') : pc.dim('off')}`)
    if (adapters.length > 0) {
      log(`  tools    ${adapters.map((a) => pc.green(a.displayName)).join(', ')}`)
    } else {
      log(`  tools    ${pc.dim('none detected')}`)
    }
    return { dbPath: resolved.dbPath, dir: resolved.dir, global: resolved.global, detected }
  } finally {
    await resolved.close()
  }
}
