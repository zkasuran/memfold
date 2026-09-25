import { detectInstalled } from '@memfold/adapters'
// SPDX-License-Identifier: FSL-1.1-ALv2
import { type SecretFinding, maskSecret, scanSecrets } from '@memfold/core'
import { type ResolveOptions, resolveStore } from '../store'
import { log, pc } from '../ui'

export type DoctorOptions = ResolveOptions

export interface DoctorLeak {
  id: string
  findings: SecretFinding[]
}

export interface DoctorReport {
  dbPath: string
  activeCount: number
  totalCount: number
  vectorEnabled: boolean
  detected: string[]
  leaks: DoctorLeak[]
  env: Record<string, string | undefined>
}

const ENV_KEYS = [
  'MEMFOLD_DB',
  'MEMFOLD_NODE_ID',
  'MEMFOLD_PORT',
  'MEMFOLD_HOST',
  'MEMFOLD_TOKEN',
  'XDG_DATA_HOME',
] as const

/** Report store health: path, record counts, detected tools, secret leaks, and the env in use. */
export async function doctorAction(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const resolved = resolveStore(opts)
  try {
    const activeCount = await resolved.store.count()
    const all = await resolved.store.all({})
    const adapters = await detectInstalled(resolved.root)

    const leaks: DoctorLeak[] = []
    for (const rec of all) {
      const findings = scanSecrets(rec.body)
      if (findings.length > 0) leaks.push({ id: rec.id, findings })
    }

    const env: Record<string, string | undefined> = {}
    for (const key of ENV_KEYS) {
      const value = process.env[key]
      env[key] = key === 'MEMFOLD_TOKEN' && value ? '[set]' : value
    }

    log(pc.bold('memfold doctor'))
    log(`  store    ${pc.cyan(resolved.dbPath)}`)
    log(`  scope    ${resolved.global ? 'global (~/.memfold)' : 'project'}`)
    log(`  node id  ${resolved.nodeId}`)
    log(`  records  ${activeCount} active / ${all.length} total`)
    log(`  vectors  ${resolved.store.vectorEnabled ? pc.green('on') : pc.dim('off')}`)
    log(
      `  tools    ${
        adapters.length > 0
          ? adapters.map((a) => a.displayName).join(', ')
          : pc.dim('none detected')
      }`,
    )
    log('  env')
    for (const key of ENV_KEYS) log(`    ${key}=${env[key] ?? pc.dim('unset')}`)

    if (leaks.length === 0) {
      log(`  secrets  ${pc.green('none detected')}`)
    } else {
      log(`  secrets  ${pc.red(`${leaks.length} record(s) with possible leaks`)}`)
      for (const leak of leaks) {
        const kinds = leak.findings.map((f) => `${f.kind} (${maskSecret(f.match)})`).join(', ')
        log(`    ${pc.bold(leak.id)}  ${kinds}`)
      }
    }

    return {
      dbPath: resolved.dbPath,
      activeCount,
      totalCount: all.length,
      vectorEnabled: resolved.store.vectorEnabled,
      detected: adapters.map((a) => a.id),
      leaks,
      env,
    }
  } finally {
    await resolved.close()
  }
}
