// SPDX-License-Identifier: Apache-2.0
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type MemoryRecord, SecretLeakError, scanSecrets } from '@memfold/core'
import { readIfExists } from './fsutil'
import type { Adapter, CompiledFile } from './types'
import { extractManagedBody, mergeManagedBlock } from './types'

/** Compile `records` across `adapters`, returning every file they would write. */
export function compileAll(
  records: MemoryRecord[],
  adapters: Adapter[],
  root: string,
): CompiledFile[] {
  return adapters.flatMap((a) => a.compile(records, { root }))
}

/**
 * Write compiled files to disk. Creates parent directories, merges managed
 * blocks into existing files (preserving hand-authored text), and refuses to
 * write any file whose content trips the secret scanner.
 */
export async function writeCompiled(files: CompiledFile[]): Promise<void> {
  for (const file of files) {
    if (file.secretScan !== false) {
      const findings = scanSecrets(file.contents)
      if (findings.length > 0) throw new SecretLeakError(findings)
    }
    let out = file.contents
    if (file.managed) {
      const prev = await readIfExists(file.path)
      if (prev !== null) {
        out = mergeManagedBlock(prev, extractManagedBody(file.contents) ?? file.contents)
      }
    }
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, out, 'utf8')
  }
}
