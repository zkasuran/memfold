// SPDX-License-Identifier: FSL-1.1-ALv2
import pc from 'picocolors'

/** Write one line to stdout (the human-facing channel). */
export function log(msg = ''): void {
  process.stdout.write(`${msg}\n`)
}

/** Write one line to stderr (diagnostics and errors). */
export function errline(msg: string): void {
  process.stderr.write(`${msg}\n`)
}

/** Collapse whitespace and clip `text` to a single short preview line. */
export function firstLine(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export { pc }
