# @memfold/adapters

Read every AI coding tool's native rules and memory files into the canonical
memfold store, and compile that store back out to each tool's native format.

Licence: Apache-2.0.

## What an adapter does

Each adapter implements a small interface (`src/types.ts`):

- `detect(root)` reports whether the tool is configured in the repo.
- `read(root)` parses the tool's native files into `MemoryRecord[]`. Reads are
  best-effort: every imported record gets `provenance.source = 'import'` and
  `provenance.tool = <adapter id>`.
- `compile(records, opts)` renders active records to the tool's native file(s),
  returning `CompiledFile[]` (absolute `path` plus `contents`).

Records are always built through `@memfold/core` (`newRecord`), never by hand.

## Managed blocks

Files that a user also hand-edits (AGENTS.md, CLAUDE.md,
`.github/copilot-instructions.md`, GEMINI.md, CONVENTIONS.md) are written inside
a fenced region:

```
<!-- memfold:begin -->
... generated memory ...
<!-- memfold:end -->
```

`mergeManagedBlock(existing, generated)` replaces only the content between the
markers and leaves the rest of the file untouched. If no block is present it is
appended. Dedicated memfold files (Cursor `.mdc`, Windsurf `.md`, Cline `.md`)
are owned in full and overwritten.

## Rendering

`recordsToMarkdown` groups active records into a `## Heading` section per type,
ordered by salience, using `record.summary || record.body`. Episodic and task
records are skipped by default (recall-only). `renderMemory` wraps it with the
secret gate: it runs `scanSecrets` on the rendered output and throws
`SecretLeakError` before any credential can reach a compiled file. `writeCompiled`
runs the same scan again on every file it writes.

## Adapters

| id | tool | primary compile target | notes |
|---|---|---|---|
| `agents-md` | AGENTS.md | `AGENTS.md` | portable managed block |
| `claude-code` | Claude Code | `CLAUDE.md` | also reads `.claude/rules/*.md` (`paths` frontmatter); AGENTS.md is read only when no CLAUDE.md exists |
| `cursor` | Cursor | `.cursor/rules/memfold.mdc` | `description` + `alwaysApply: true`; extension must be `.mdc`; legacy `.cursorrules` read-only |
| `windsurf` | Windsurf | `.windsurf/rules/memfold.md` | `trigger: always_on`; capped at 6k chars |
| `copilot` | GitHub Copilot | `.github/copilot-instructions.md` | also reads `*.instructions.md` (`applyTo`) |
| `gemini` | Gemini CLI | `GEMINI.md` | managed block |
| `cline` | Cline | `.clinerules/memfold.md` | unconditional rule, no frontmatter |
| `aider` | Aider | `CONVENTIONS.md` + `.aider.conf.yml` | ensures a `read:` entry; config is merged, never overwritten |

## Usage

```ts
import { detectInstalled, compileAll, writeCompiled } from '@memfold/adapters'

const adapters = await detectInstalled(root)
const files = compileAll(records, adapters, root)
await writeCompiled(files) // creates dirs, merges managed blocks, blocks secrets
```

## Known limits

- Structured extraction on read is heuristic (bullets under headings), not a
  schema. Round-tripping preserves the text, not per-tool activation metadata.
- `.aider.conf.yml` merge re-serialises via YAML, so inline comments in that file
  are not preserved (a known aider caveat).
- Tool memory stores that are opaque or app/cloud state (Cursor Memories,
  Windsurf Cascade Memories, Warp Drive) are out of scope; the file-based rules
  surface is the portable layer.
