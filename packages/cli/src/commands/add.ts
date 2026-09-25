// SPDX-License-Identifier: FSL-1.1-ALv2
import {
  MEMORY_TYPES,
  type MemoryType,
  SCOPES,
  type Scope,
  SecretLeakError,
  newRecord,
  scanSecrets,
} from '@memfold/core'
import { type ResolveOptions, resolveStore } from '../store'
import { log, pc } from '../ui'

export interface AddOptions extends ResolveOptions {
  type?: string
  scope?: string
  scopePath?: string
  title?: string
  tags?: string
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Store a new memory. Runs the secret gate on the text first and throws `SecretLeakError`
 * (nonzero exit at the CLI boundary) when a credential is found, so nothing is written.
 */
export async function addAction(
  textParts: string[],
  opts: AddOptions = {},
): Promise<{ id: string }> {
  const text = textParts.join(' ').trim()
  if (!text) throw new Error('memfold: nothing to remember (empty text)')

  const findings = scanSecrets(text)
  if (findings.length > 0) throw new SecretLeakError(findings)

  const type = (opts.type ?? 'fact') as MemoryType
  const scope = (opts.scope ?? 'project') as Scope
  if (!(MEMORY_TYPES as readonly string[]).includes(type)) {
    throw new Error(`memfold: unknown type '${type}' (one of: ${MEMORY_TYPES.join(', ')})`)
  }
  if (!(SCOPES as readonly string[]).includes(scope)) {
    throw new Error(`memfold: unknown scope '${scope}' (one of: ${SCOPES.join(', ')})`)
  }

  const resolved = resolveStore(opts)
  try {
    const rec = newRecord(
      {
        type,
        scope,
        body: text,
        title: opts.title ?? null,
        scope_path: opts.scopePath ?? null,
        tags: parseTags(opts.tags),
        provenance: { source: 'user', tool: 'memfold-cli' },
      },
      resolved.hlc,
    )
    await resolved.store.upsert(rec)
    log(`${pc.green('remembered')} ${pc.bold(rec.id)} ${pc.dim(`(${rec.type}/${rec.scope})`)}`)
    return { id: rec.id }
  } finally {
    await resolved.close()
  }
}
