// SPDX-License-Identifier: Apache-2.0
import { agentsMdAdapter } from './adapters/agents-md'
import { aiderAdapter } from './adapters/aider'
import { claudeAdapter } from './adapters/claude'
import { clineAdapter } from './adapters/cline'
import { codexAdapter } from './adapters/codex'
import { copilotAdapter } from './adapters/copilot'
import { cursorAdapter } from './adapters/cursor'
import { geminiAdapter } from './adapters/gemini'
import { windsurfAdapter } from './adapters/windsurf'
import type { Adapter } from './types'

/** Every adapter memfold knows how to read and compile. */
export const ALL_ADAPTERS: Adapter[] = [
  agentsMdAdapter,
  codexAdapter,
  claudeAdapter,
  cursorAdapter,
  windsurfAdapter,
  copilotAdapter,
  geminiAdapter,
  clineAdapter,
  aiderAdapter,
]

/** Look up an adapter by its id (e.g. 'claude-code'). */
export function getAdapter(id: string): Adapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id)
}

/** The adapters whose tool is actually configured under `root`. */
export async function detectInstalled(root: string): Promise<Adapter[]> {
  const hits = await Promise.all(
    ALL_ADAPTERS.map(async (a): Promise<Adapter | null> => ((await a.detect(root)) ? a : null)),
  )
  return hits.filter((a): a is Adapter => a !== null)
}
