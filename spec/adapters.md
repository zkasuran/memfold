# memfold adapter matrix

An adapter connects one tool to the memfold store two ways: it **reads** the tool's native rules,
memory and config into Memory Records and it **compiles** records back into the tool's native files in
the format and location that tool actually loads. This page is the reference for adapter authors. It is
grounded in the per-tool research in `research/01-06`.

## The shape of the problem

`AGENTS.md` is the convergence point. It is a plain-markdown file, no frontmatter, no schema, read by
Codex, Cursor, Copilot, Gemini CLI, Cline, Roo, Kilo, opencode, Amp, Goose, Warp, Zed, Junie and many
more. It is stewarded by the Agentic AI Foundation under the Linux Foundation. Compiling a clean
`AGENTS.md` is the single write that reaches the most tools and the floor every adapter should reach.
Claude Code is the notable exception: its native file is `CLAUDE.md` and it ignores `AGENTS.md` by
default when a `CLAUDE.md` is present.

Each tool exposes up to three surfaces with different fidelity:

- **Instruction files** (prose markdown): easy to read, easy but lossy to write, the portable layer.
- **Structured config** (JSON, JSONC, TOML, YAML): high fidelity both ways, but comment-lossy with naive
  serializers, so edit surgically.
- **Auto memory** (tool-authored stores): mostly opaque, sometimes not a file at all. Read-mostly and
  never the primary write target.

## Rules for every adapter

- **Own a managed block, do not clobber hand-written prose.** When writing into a file a human also
  edits (`AGENTS.md`, `CLAUDE.md`), confine generated content to a region delimited by stable HTML
  comment markers (for example `<!-- memfold:begin -->` and `<!-- memfold:end -->`) and rewrite only
  between them. HTML comments render invisibly and are ignored by every reader.
- **Do not add YAML frontmatter to `AGENTS.md`.** The standard is explicitly frontmatter-free and some
  readers inject the file verbatim, so stray frontmatter surfaces as literal text. Carry metadata in
  the HTML-comment markers instead.
- **Extension and casing matter.** Cursor project rules MUST be `.mdc`; a `.md` in `.cursor/rules` is
  silently ignored. Warp requires the filename in all caps (`AGENTS.md`).
- **Respect size caps.** Codex caps the concatenated instruction chain at 32 KiB, Windsurf caps rule
  files (about 6,000 global and 12,000 per workspace file), Claude Code skips a `CLAUDE.md` over 4 MiB
  and drops `MEMORY.md` past 200 lines or 25 KB. All truncate silently, so a large record set must be
  split or summarized.
- **Preserve what you do not understand.** Keep unknown frontmatter keys and existing config keys on
  write. Merge into config files, never overwrite them (they hold other settings and sometimes secrets).
- **The secret gate applies on write.** Every compiled file passes the gate (protocol section 5) before
  it touches disk, because these files are committed.
- **Precedence models differ.** Some tools concatenate every file found, some take the first match per
  category, some let a local file override a global one. Emitting the same content everywhere is safe;
  relying on a tool's override behavior is not portable.
- **Memory stores are read-mostly.** Tool auto-memory (Claude Code auto memory, Cursor and Windsurf
  memories, Codex and Qwen memories) is tool-owned and may be rewritten or garbage-collected. Read it
  for inspection, do not treat it as a durable write target.

## Primary tools

| Tool | Native path(s) | Format | Precedence / load behavior | memfold read/write notes |
|---|---|---|---|---|
| **Claude Code** | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `~/.claude/CLAUDE.md`, `.claude/rules/*.md`, managed policy path; native `AGENTS.md` since v2.1.277 | Markdown, no schema. `.claude/rules` markdown whose only read frontmatter key is `paths` (glob). `@path` imports expand at launch, max 4 hops | All files concatenated, never overridden, ordered root to cwd, local after shared, managed then user then project. `AGENTS.md` read only when no `CLAUDE.md` at or above cwd (default mode). Advisory, not enforced. HTML comments stripped on load | Read: compute the loaded set (walk tree, expand imports, apply `claudeMdExcludes`, honor the AGENTS/CLAUDE decision), not one file. Write: drive it via `AGENTS.md` or a managed block in the project `CLAUDE.md`; use `CLAUDE.local.md` for personal. Read raw to keep HTML comments. Do not write managed or symlinked files. Auto memory under `~/.claude/projects/<project>/memory/` is read-mostly |
| **Codex / AGENTS.md** | `AGENTS.md` (root and nested per dir), global `~/.codex/AGENTS.md`, `AGENTS.override.md`; config `~/.codex/config.toml` and trusted `.codex/config.toml` | Freeform markdown, no frontmatter, no schema. Config is TOML | Reads the root-down chain and concatenates, closer files override by position. `AGENTS.override.md` supersedes a sibling `AGENTS.md`. 32 KiB cap (`project_doc_max_bytes`), silent truncation. Project config only read when the project is trusted | Read: raw markdown chain, record each file path and depth to reproduce order. Write: plain `AGENTS.md` managed block, keep under the cap or split across nested files. Use `codex mcp add` for MCP rather than hand-editing TOML and route machine-local keys to user config |
| **Cursor** | `.cursor/rules/*.mdc` (and nested), legacy `.cursorrules`, `AGENTS.md`; User and Team rules live in app or cloud; MCP `.cursor/mcp.json` | `.mdc` is YAML frontmatter (`description`, `globs`, `alwaysApply`) plus markdown body. `.cursorrules` and `AGENTS.md` are plain | Team then Project then User; all applicable rules merge, earlier sources win conflicts. Activation mode is implied by which frontmatter fields are set (Always, Auto Attached, Agent Requested, Manual). A plain `.md` in `.cursor/rules` is silently ignored. Multi-folder workspaces load only the first folder alphabetically | Read: parse `.mdc` frontmatter, derive the mode from the field combination, treat `globs` as a bare comma-separated string. Write: `.mdc` only, one rule per file, emit only the fields the intended mode needs. Memories have no file or API, so they are not addressable |
| **Windsurf / Cascade** | `.windsurf/rules/*.md`, `global_rules.md` at `~/.codeium/windsurf/memories/`, legacy `.windsurfrules`, OS system-rule dirs; newer builds also `.devin/rules`; MCP `~/.codeium/windsurf/mcp_config.json` | Markdown plus frontmatter `trigger` (always_on, glob, model_decision, manual), `description`, `globs` | Discovery covers the workspace, subdirs and parents up to the git root, deduped by shortest relative path. Caps about 6,000 chars global and 12,000 per workspace file, silent truncation | Read: map `trigger` modes 1:1 with Cursor activation modes. Write: one file per rule, set `trigger` explicitly, enforce the caps and split oversized rules. `global_rules.md` is a single always-on file. Cascade memories are auto-managed, read-only in practice |
| **GitHub Copilot** | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.github/prompts/*.prompt.md`; personal and org instructions in the GitHub UI | Repo-wide file is plain markdown, no frontmatter. `*.instructions.md` is YAML frontmatter (`applyTo` glob, `description`, `name`, `excludeAgent`) plus markdown | On GitHub.com Chat: Personal then Repository (path-specific then repo-wide) then Org, all additive. VS Code docs warn not to depend on file order because merge differs by harness. A path file and the repo-wide file both apply when both match | Read: the repo-wide file plus every `*.instructions.md` with its `applyTo`. Write: the repo-wide file as a managed block and per-path `*.instructions.md` with `applyTo` compiled from `dir`-scoped records. Personal and org instructions are UI or cloud state, not file-addressable |
| **Gemini CLI** | `GEMINI.md` (global `~/.gemini/GEMINI.md`, project, subdir); filename configurable via `context.fileName` in `.gemini/settings.json`; MCP in `settings.json` | Plain markdown, `@path` imports expand inline | All found files concatenated and sent every prompt, deeper and more specific effectively overrides; a footer shows the loaded count | Read: the concatenated hierarchy. Write: `GEMINI.md` or set `context.fileName` to include a shared `AGENTS.md` and write that one file for the whole Gemini and Qwen family. Its dynamic memory is just file edits |
| **Cline** | `.clinerules/` (a file or a dir of `*.md`) and `.cline/rules/`; global `~/Documents/Cline/Rules`, `~/.cline/rules`; reads `~/.agents/AGENTS.md` and detects `AGENTS.md`, `.cursorrules`, `.windsurfrules`; `memory-bank/`; MCP `~/.cline/mcp.json` | Markdown plus optional frontmatter whose only key is `paths` (glob array). No frontmatter means always active, `paths: []` means disabled | Non-conditional rules always in the prompt. Workspace and global combine, workspace wins. Two gates: a manual toggle and automatic `paths` matching | Read: both rule dirs plus the globals, parse `paths`. Write: markdown into `.clinerules/`, set conditionality with a `paths` block, high fidelity. Preserve `paths: []` as a real disabled state. Invalid YAML fails open, so do not reformat a user's frontmatter into invalidity |
| **Aider** | No auto rules dir. `CONVENTIONS.md` (any name) loaded through `.aider.conf.yml` `read:` or `--read`; config `.aider.conf.yml` searched in home, git root, cwd | Plain markdown conventions. Config is YAML | Nothing is auto-loaded by convention. The only durable auto-load is a `read:` entry in the config. `--restore-chat-history` defaults to false | Read: `read:` and `file:` entries from the config. Write: emit `CONVENTIONS.md` and register it by merging `read: [CONVENTIONS.md]` into `.aider.conf.yml`, preserving other keys (the file may hold api keys). No MCP client, so a daemon must reach Aider through files. Anything richer than always-on prose is lossy |

## Long tail

Version-sensitive rows are flagged. Confirm paths against the installed version before relying on them.

| Tool | Native path(s) | Format and load behavior | memfold read/write note |
|---|---|---|---|
| **Roo Code** | `.roo/rules/` (recursive, alphabetical), fallback `.roorules`; mode rules `.roo/rules-{slug}/`; global `~/.roo/rules/`; `AGENTS.md` (fallback `AGENT.md`) | Markdown concatenated; reads all applicable dirs, project wins over global; modes in `.roomodes` or `custom_modes.yaml`. No `paths` conditionality | Write the directory form `.roo/rules/`, one file per concern, so a single `.roorules` is never clobbered. Mode writes override rather than merge, so treat them as high caution |
| **Kilo Code** | Current `kilo.jsonc` with an `instructions:` glob array pointing at `.kilo/rules/**`; legacy `.kilocode/rules/**` still auto-read; memory bank deprecated toward `AGENTS.md` (version-sensitive) | JSONC config (comments legal, use a tolerant parser); rule bodies markdown | Detect `kilo.jsonc` versus `.kilocode/` at runtime. Write `.kilo/rules/*.md` referenced from `kilo.jsonc` or `AGENTS.md` |
| **opencode** | `AGENTS.md` (root), global `~/.config/opencode/AGENTS.md`, `CLAUDE.md` fallback; config `opencode.json` or `.jsonc` with an `instructions` glob array | First match wins per category. Config merges per key | Add the compiled file to the `instructions` array rather than overwriting `AGENTS.md`. This is the cleanest indirection point in the long tail |
| **Amp** | `AGENTS.md` (fallback `AGENT.md` then `CLAUDE.md`), global `~/.config/amp/AGENTS.md`, system dirs | Markdown concatenated, workspace guidance before personal and repo. `@`-mention imports with optional `globs` frontmatter | Write a plain `AGENTS.md` managed block. Amp will offer to generate or update one |
| **Goose** | `AGENTS.md` then `.goosehints` (set by `CONTEXT_FILE_NAMES`), global `~/.config/goose/.goosehints` | Markdown concatenated, local overrides global. A separate Memory MCP extension is distinct from hints | Write `AGENTS.md` or `.goosehints`. Detect `CONTEXT_FILE_NAMES` so you do not write a file the tool was told to ignore |
| **Qwen Code** | `QWEN.md` (global `~/.qwen/QWEN.md`, project, `.qwen/QWEN.local.md`); reads `AGENTS.md`; auto memory under `~/.qwen/projects/<project>/memory/` | Markdown concatenated, the local file loads after the shared one. `@path` imports. A `/dream` cleanup can rewrite the auto-memory store | Write `QWEN.md` or a shared `AGENTS.md`. Avoid the auto-memory folder, its cleanup pass can overwrite a foreign writer |
| **Amazon Q** | `.amazonq/rules/**/*.md` (auto-loaded), profiles and context via `/context`; MCP `~/.aws/amazonq/mcp.json` and `.amazonq/mcp.json` | Markdown, scanned at load, applied by a prose Priority convention that is not machine-enforced | Write `.amazonq/rules/*.md`. Do not rely on the Priority prose for deterministic precedence |
| **Augment** | `.augment/rules/` (workspace root only, recursive), user `~/.augment/rules/`, legacy `.augment-guidelines` | Markdown plus frontmatter `type` (always_apply, agent_requested, manual). Only `AGENTS.md` and `CLAUDE.md` are discovered up-tree | Write `.augment/rules/*.md` with the right `type`. Rules load only from the workspace root, not subdirs |
| **Warp** | `AGENTS.md` (must be all caps), legacy `WARP.md` (wins if both exist), subdir files; Global Rules live in Warp Drive (cloud) | Sub-directory file then root then Global Rules | Write an all-caps `AGENTS.md`. Global Rules are cloud state, not file-addressable |
| **Zed** | First match from a fixed name list (`.rules` through `AGENTS.md` through `GEMINI.md`); one file wins. No in-file scoping | Single always-on instruction file. The old Rules Library is deprecated in favor of Skills | Write `AGENTS.md`, which is on Zed's list and portable |
| **Continue** | `.continue/rules/*.md` plus a `rules:` block in `config.yaml`; global `~/.continue`, workspace `.continue/` | Markdown plus frontmatter `name`, `globs`, `regex`, `description`, `alwaysApply` | Write `.continue/rules/*.md` with frontmatter mapped from record scope and tags |
| **JetBrains (AI Assistant, Junie)** | AI Assistant `.aiassistant/rules/*.md` (rule type stored in IDE UI, not the file); Junie `.junie/AGENTS.md`, root `AGENTS.md`, `.junie/rules/*.md`, `.junie/guidelines.md`, global `~/.junie/AGENTS.md` | Markdown. Junie discovery is layered, project overrides global | Write `AGENTS.md` for portability or `.junie/rules/`. Do not expect the AI Assistant rule type to survive in the file, it lives in UI metadata |
| **Replit** | `replit.md` (project root only, auto-detected and auto-generated); Custom Instructions are cloud state | Markdown, read every request | Write `replit.md`. Subdir files are not detected |
| **Charm Crush** | Context file (default historically `CRUSH.md`) set by `initialize-as` and added via `context-path`; config is an executable Bash `crushrc` or legacy JSON (version-sensitive) | Markdown context file. `crushrc` is run at load | Write the markdown context file and register it with `context-path`. Never generate `crushrc` body, it executes as Bash |
| **Trae** | `.trae/rules/project_rules.md`; user rules in settings (unverified path) | Markdown, injected as context, `@`-references supported | Write `.trae/rules/project_rules.md`. Path is secondary-sourced, verify against the build |
| **Void** | Legacy single `.voidrules`; a directory `.void/rules/` is proposed but unmerged | Markdown. Most rule state lives in app settings | Write `.voidrules`, low confidence. Re-verify against the running build |
| **Codebuff / Freebuff** | `AGENTS.md` then `CLAUDE.md` per directory, plus `~/.AGENTS.md` and `~/.CLAUDE.md`; legacy `knowledge.md` is dropped | Markdown, per-directory priority | Write `AGENTS.md`. Do not write `knowledge.md`, current builds no longer read it |
| **Sourcegraph Cody** | No first-party markdown rules or memory file. Historical custom commands in `.vscode/cody.json`. Partially wound down | JSON custom commands (historical) | Low priority. Sourcegraph's forward agent is Amp, which uses `AGENTS.md` |

## AGENTS.md and the CLAUDE.md decision

`AGENTS.md` is the one file most of the ecosystem already reads, so a memfold store should always
compile a clean `AGENTS.md` at the repo root and one per package where records are `dir`-scoped, since
the nearest file wins. Because the standard forbids frontmatter, carry any memfold metadata in HTML
comment markers, never in YAML at the top of the file.

Claude Code is the exception that shapes the compile strategy. By default it reads `CLAUDE.md` and
ignores `AGENTS.md` when both exist at or above the working directory and creating a `CLAUDE.local.md`
silently turns `AGENTS.md` off too. So an adapter targeting a repo that Claude Code will visit has three
workable options, in order of preference:

1. Set Claude Code's `Project instructions` mode to `claude-md-and-agents-md`, so both load and keep
   the shared content in `AGENTS.md`.
2. Leave a one-line `CLAUDE.md` that imports the shared file with `@AGENTS.md`.
3. Compile the shared content directly into a managed block in `CLAUDE.md` as well as `AGENTS.md`,
   accepting the duplication that memfold otherwise exists to remove.

The compiler decides per repo based on which tools are in use and which Claude Code version is
installed (native `AGENTS.md` needs v2.1.277 or later).

## Compile precedence, in short

The resolver (protocol section 2) produces one ordered active set. The compiler then projects that set
into each tool's precedence model: concatenate-all tools (Claude Code, Codex, Gemini, Qwen, Goose, Amp)
get the set in resolver order; first-match tools (opencode) get a single combined file; scoped-rule
tools (Cursor, Windsurf, Continue, Copilot path files) get `dir`-scoped records emitted as per-path
rules with the tool's own glob or trigger field. Emitting the same content everywhere is always safe.
Relying on a tool's own override behavior to pick a winner is not portable, which is why memfold
resolves the winner itself before it compiles.

---

SPDX-License-Identifier: Apache-2.0
