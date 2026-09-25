<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->

# memfold

One common memory for every AI coding tool and agent framework. `memfold` keeps a single local
store of your facts, preferences, decisions, and conventions, then compiles that store out to each
tool's own native file (AGENTS.md, CLAUDE.md, Cursor rules, Copilot instructions, and more) so every
assistant reads the same memory.

## Install

```bash
pnpm add -g memfold
# or run without installing
pnpm dlx memfold init
```

The store lives in `.memfold/memory.db` at your project root, or in `~/.memfold/memory.db` with
`--global`. A `node.json` file beside the database holds the machine identity and hybrid logical
clock so writes stay ordered across runs and machines.

## Commands

| Command | What it does |
|---|---|
| `memfold init [--global]` | Create the store and list the AI tools detected in the repo. |
| `memfold add <text...>` (alias `remember`) | Store a memory. `--type`, `--scope`, `--scope-path`, `--title`, `--tags`. Refuses text that contains a secret. |
| `memfold search <query...>` (alias `recall`) | Ranked hybrid keyword and vector search. `--limit`, `--scope`, `--type`. |
| `memfold list` | List active records. `--scope`, `--type`. |
| `memfold forget <id>` | Tombstone a record so it stops surfacing. |
| `memfold compile` | Compile the store out to each tool's native file. `--targets <ids>`, `--all`, `--dry-run`. |
| `memfold import` | Read native tool files back into the store. `--from <toolId>`. |
| `memfold sync` | Round-trip: import from detected tools, then compile back out to them. |
| `memfold serve` | Start the local HTTP daemon. `--port`, `--host`, `--token`. |
| `memfold mcp` | Serve the store to MCP clients over stdio. |
| `memfold doctor` | Report store path, record counts, detected tools, the env in use, and any secret leaks. |

Every store-touching command also accepts `--global` to target `~/.memfold`.

## The headline: compile once, feed every tool

```bash
memfold add "We deploy with pnpm ship, never npm" --type convention
memfold add "Prefer small pure functions" --type convention
memfold compile --all
```

`compile` renders the canonical store into each adapter's native format in a single pass. Files that
support hand-authored prose (AGENTS.md, CLAUDE.md) receive a fenced `memfold:begin`/`memfold:end`
managed block, so your own text around the block is preserved on rewrite.

## Security

`add` runs a secret and PII gate over the text and refuses to store anything that looks like a
credential (AWS keys, GitHub tokens, private key blocks, high-entropy strings, and more). The same
gate runs on every file `compile` would write, and `doctor` scans stored bodies after the fact.

`memfold serve` is **unauthenticated unless you pass `--token`**. Without a token, anyone who can
reach the port has full read and write access, so it binds to `127.0.0.1` by default and prints a
warning. Set a token before exposing it beyond loopback.

## License

FSL-1.1-ALv2. See `LICENSE`.
