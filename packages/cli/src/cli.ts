#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Command } from 'commander'
import { addAction } from './commands/add'
import { compileAction } from './commands/compile'
import { doctorAction } from './commands/doctor'
import { forgetAction } from './commands/forget'
import { importAction } from './commands/import'
import { initAction } from './commands/init'
import { listAction } from './commands/list'
import { mcpAction } from './commands/mcp'
import { searchAction } from './commands/search'
import { serveAction } from './commands/serve'
import { syncAction } from './commands/sync'
import { pc } from './ui'

const program = new Command()

program
  .name('memfold')
  .description('One common memory for every AI coding tool and agent framework.')
  .version('0.1.0')

const globalFlag = ['--global', 'use the global ~/.memfold store'] as const
const withCwd = <T extends object>(opts: T): T & { cwd: string } => ({
  ...opts,
  cwd: process.cwd(),
})

program
  .command('init')
  .description('create the store and detect installed tools')
  .option(...globalFlag)
  .action(async (opts) => {
    await initAction(withCwd(opts))
  })

program
  .command('add')
  .alias('remember')
  .description('store a new memory')
  .argument('<text...>', 'the memory text')
  .option('--type <type>', 'record type', 'fact')
  .option('--scope <scope>', 'visibility scope', 'project')
  .option('--scope-path <path>', 'path the scope is anchored to')
  .option('--title <title>', 'short human label')
  .option('--tags <list>', 'comma-separated tags')
  .option(...globalFlag)
  .action(async (text: string[], opts) => {
    await addAction(text, withCwd(opts))
  })

program
  .command('search')
  .alias('recall')
  .description('search stored memory')
  .argument('<query...>', 'the search query')
  .option('--limit <n>', 'maximum hits')
  .option('--scope <scope>', 'restrict to a scope')
  .option('--type <type>', 'restrict to a type')
  .option(...globalFlag)
  .action(async (query: string[], opts) => {
    await searchAction(query, withCwd(opts))
  })

program
  .command('list')
  .description('list stored records')
  .option('--scope <scope>', 'restrict to a scope')
  .option('--type <type>', 'restrict to a type')
  .option(...globalFlag)
  .action(async (opts) => {
    await listAction(withCwd(opts))
  })

program
  .command('forget')
  .description('tombstone a record by id')
  .argument('<id>', 'the record id')
  .option(...globalFlag)
  .action(async (id: string, opts) => {
    await forgetAction(id, withCwd(opts))
  })

program
  .command('compile')
  .description('compile the store out to each tool native file')
  .option('--targets <ids>', 'comma-separated adapter ids')
  .option('--all', 'compile to every known adapter')
  .option('--dry-run', 'report without writing files')
  .option(...globalFlag)
  .action(async (opts) => {
    await compileAction(withCwd(opts))
  })

program
  .command('import')
  .description('import native tool files into the store')
  .option('--from <toolId>', 'a single adapter id to import from')
  .option(...globalFlag)
  .action(async (opts) => {
    await importAction(withCwd(opts))
  })

program
  .command('sync')
  .description('import from detected tools then compile back out to them')
  .option(...globalFlag)
  .action(async (opts) => {
    await syncAction(withCwd(opts))
  })

program
  .command('serve')
  .description('start the local HTTP daemon')
  .option('--port <n>', 'port to listen on', '7077')
  .option('--host <host>', 'bind address', '127.0.0.1')
  .option('--token <token>', 'require this bearer token')
  .option(...globalFlag)
  .action(async (opts) => {
    await serveAction(withCwd(opts))
  })

program
  .command('mcp')
  .description('serve the store to MCP clients over stdio')
  .option(...globalFlag)
  .action(async (opts) => {
    await mcpAction(withCwd(opts))
  })

program
  .command('doctor')
  .description('report store health, detected tools, and secret leaks')
  .option(...globalFlag)
  .action(async (opts) => {
    await doctorAction(withCwd(opts))
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${pc.red('error')} ${msg}\n`)
  process.exit(1)
})
