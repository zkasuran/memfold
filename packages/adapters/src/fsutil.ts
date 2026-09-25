// SPDX-License-Identifier: Apache-2.0
import { access, readFile } from 'node:fs/promises'
import fg from 'fast-glob'
import matter from 'gray-matter'

/** True if a path exists (file or directory). */
export async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Read a file, or null if it is absent or a directory. */
export async function readIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

/** Absolute paths of files matching any of `patterns`, rooted at `cwd`. */
export async function globFiles(patterns: string[], cwd: string): Promise<string[]> {
  return fg(patterns, { cwd, absolute: true, dot: true, onlyFiles: true })
}

/** Strip YAML frontmatter and return the markdown body. */
export function stripFrontmatter(text: string): string {
  return matter(text).content.trim()
}
