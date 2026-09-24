/**
 * Pre-write secret / PII gate. Memory and compiled rules files are committed and shared, so
 * they are exactly the wrong place for a credential. A fast regex + entropy prefilter runs on
 * every write; `gitleaks`/`secretlint` can layer on as an opt-in deep scan (see spec).
 */
export interface SecretFinding {
  kind: string
  index: number
  match: string
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['aws-access-key-id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['openai-key', /\bsk-[A-Za-z0-9]{20,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
]

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let e = 0
  for (const n of freq.values()) {
    const p = n / s.length
    e -= p * Math.log2(p)
  }
  return e
}

/** Return every secret-shaped finding in `text`. Empty array = clean. */
export function scanSecrets(text: string): SecretFinding[] {
  const found: SecretFinding[] = []
  for (const [kind, re] of SECRET_PATTERNS) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      found.push({ kind, index: m.index ?? 0, match: m[0] })
    }
  }
  // High-entropy long tokens the named patterns miss.
  for (const m of text.matchAll(/\b[A-Za-z0-9+/_-]{32,}\b/g)) {
    const tok = m[0]
    if (shannonEntropy(tok) >= 4.0 && !found.some((f) => f.index === (m.index ?? 0))) {
      found.push({ kind: 'high-entropy-string', index: m.index ?? 0, match: tok })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

export function maskSecret(s: string): string {
  if (s.length <= 8) return '****'
  return `${s.slice(0, 3)}…${s.slice(-2)} [redacted ${s.length} chars]`
}

/** Thrown by the store when a write contains a secret and the gate is set to block. */
export class SecretLeakError extends Error {
  constructor(readonly findings: SecretFinding[]) {
    super(
      `memfold: refusing to write — ${findings.length} secret(s) detected: ${findings
        .map((f) => `${f.kind} (${maskSecret(f.match)})`)
        .join(', ')}`,
    )
    this.name = 'SecretLeakError'
  }
}
