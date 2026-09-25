// SPDX-License-Identifier: Apache-2.0

// Core types and the managed-block helpers.
export type { Adapter, CompiledFile, CompileOptions } from './types'
export {
  MANAGED_BEGIN,
  MANAGED_END,
  wrapManagedBlock,
  extractManagedBody,
  mergeManagedBlock,
} from './types'

// Rendering: records to markdown, the secret gate, frontmatter, and the reader.
export type { RenderOptions } from './render'
export {
  DEFAULT_SKIP_TYPES,
  recordsToMarkdown,
  renderMemory,
  frontmatter,
  markdownToRecords,
} from './render'

// Registry and compile pipeline.
export { ALL_ADAPTERS, getAdapter, detectInstalled } from './registry'
export { compileAll, writeCompiled } from './compile'

// Individual adapters.
export { agentsMdAdapter } from './adapters/agents-md'
export { claudeAdapter } from './adapters/claude'
export { cursorAdapter } from './adapters/cursor'
export { windsurfAdapter } from './adapters/windsurf'
export { copilotAdapter } from './adapters/copilot'
export { geminiAdapter } from './adapters/gemini'
export { clineAdapter } from './adapters/cline'
export { aiderAdapter } from './adapters/aider'
