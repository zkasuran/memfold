# Adapters

An adapter reads one AI coding tool's native rules and memory files into the canonical store, and
compiles the store back out to that tool's native format. `@memfold/adapters` (Apache-2.0) ships eight
of them. The normative per-tool matrix is in [`../spec/adapters.md`](../spec/adapters.md); this page is
the working reference and shows the API.

## What an adapter does

Each adapter implements a small interface:

- `detect(root)` reports whether the tool is configured in the repo.
- `read(root)` parses the tool's native files into records. Reads are best-effort: every imported
  record gets `provenance.source = import` and `provenance.tool = <adapter id>`.
- `compile(records, opts)` renders active records to the tool's native files, returning the absolute
  path and contents of each.

Records are always built through `@memfold/core`, never by hand.

## The matrix

| id | Tool | Primary compile target | Also reads | Merge |
|---|---|---|---|---|
| `agents-md` | AGENTS.md | `AGENTS.md` | `AGENTS.md` | managed block |
| `claude-code` | Claude Code | `CLAUDE.md` | `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md` | managed block |
| `cursor` | Cursor | `.cursor/rules/memfold.mdc` | `.cursor/rules/*.mdc`, legacy `.cursorrules` | owned file |
| `windsurf` | Windsurf | `.windsurf/rules/memfold.md` | `.windsurf/rules/*.md`, legacy `.windsurfrules` | owned file |
| `copilot` | GitHub Copilot | `.github/copilot-instructions.md` | that file, `.github/instructions/**/*.instructions.md` | managed block |
| `gemini` | Gemini CLI | `GEMINI.md` | `GEMINI.md` | managed block |
| `cline` | Cline | `.clinerules/memfold.md` | `.clinerules/**/*.md`, `.cline/rules/**/*.md` | owned file |
| `aider` | Aider | `CONVENTIONS.md` plus a `read:` entry in `.aider.conf.yml` | `CONVENTIONS.md` | managed block, config merged |

Notes on specific tools:

- **Claude Code** reads `CLAUDE.md` and ignores `AGENTS.md` when both exist, so `CLAUDE.md` is the
  reliable target. The Cursor `.mdc` file carries a `description` and `alwaysApply: true`, and the
  extension must be `.mdc` or Cursor drops it.
- **Windsurf** rule files are capped, so the compiled block is trimmed to fit.
- **Aider** discovers conventions through a `read:` entry in `.aider.conf.yml`, so the adapter ensures
  that entry exists and writes the memory to `CONVENTIONS.md`. The config file is merged, never
  overwritten, and its secret scan is skipped because it may legitimately hold the user's own key.

## Managed blocks

Files a user also hand-edits are written inside a fenced region:

```
<!-- memfold:begin -->
... generated memory ...
<!-- memfold:end -->
```

`mergeManagedBlock(existing, generated)` replaces only the content between the markers and leaves the
rest of the file untouched. If no block is present it is appended. If the file does not exist the block
becomes the whole file. Dedicated memfold files (Cursor `.mdc`, Windsurf `.md`, Cline `.md`) carry no
hand-written prose, so they are owned in full and overwritten.

## Rendering

`recordsToMarkdown` groups active records into a `## Heading` section per type (Conventions,
Preferences, Decisions, Facts, Entities), ordered by salience within a section, using each record's
`summary` or `body`. Episodic and task records are skipped by default because they are recall-only.
`renderMemory` wraps that with the secret gate: it scans the rendered output and throws
`SecretLeakError` before any credential can reach a compiled file. `writeCompiled` runs the same scan
again on every file it writes.

## Usage

```ts
import { detectInstalled, compileAll, writeCompiled, getAdapter } from '@memfold/adapters'

const root = process.cwd()

// Compile the store out to every detected tool.
const adapters = await detectInstalled(root)
const files = compileAll(records, adapters, root)
await writeCompiled(files)

// Import an existing tool's files into records.
const cursor = getAdapter('cursor')
const imported = cursor ? await cursor.read(root) : []
```

`compileAll` returns the planned files without writing, so you can preview them (this is what a
`--dry-run` compile shows). `writeCompiled` creates parent directories, merges managed blocks and
refuses to write any file that trips the secret scanner.

## Known limits

- Extraction on read is heuristic (bullets under headings), not a schema. A round trip preserves the
  text, not per-tool activation metadata.
- `.aider.conf.yml` is re-serialised through YAML on merge, so inline comments in that file are not
  preserved.
- Opaque or cloud-side tool memory (Cursor Memories, Windsurf Cascade Memories, Warp Drive) is out of
  scope. The file-based rules surface is the portable layer.
