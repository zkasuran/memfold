// SPDX-License-Identifier: FSL-1.1-ALv2
import { tick } from '@memfold/core'
import { type ResolveOptions, resolveStore } from '../store'
import { log, pc } from '../ui'

export type ForgetOptions = ResolveOptions

/** Tombstone a record by id so it stops surfacing in reads. */
export async function forgetAction(
  id: string,
  opts: ForgetOptions = {},
): Promise<{ forgotten: boolean; id: string }> {
  const resolved = resolveStore(opts)
  try {
    const existing = await resolved.store.get(id)
    if (!existing) {
      log(pc.dim(`no record with id ${id}`))
      return { forgotten: false, id }
    }
    await resolved.store.tombstone(id, tick(resolved.hlc))
    log(`${pc.yellow('forgot')} ${pc.bold(id)}`)
    return { forgotten: true, id }
  } finally {
    await resolved.close()
  }
}
