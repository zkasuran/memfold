// SPDX-License-Identifier: Apache-2.0

import type { Scope } from '@memfold/core'
import { type MemfoldLike, findActiveByDedup } from '../common'

export interface MemfoldChatStoreOptions {
  /** memfold scope chat snapshots are written under. Default `'session'`. */
  scope?: Scope
  /** dedup-key prefix that namespaces chat records. Default `'chat'`. */
  namespace?: string
}

/**
 * Chat-message persistence for the Vercel AI SDK, backed by memfold. It stores a thread's message
 * list as one episodic record keyed by `threadId`, which is exactly the `loadChat` / `saveChat`
 * snapshot pattern the AI SDK documents. `TMessage` is left generic so any message shape works
 * (e.g. `UIMessage`) without importing the `ai` package.
 *
 * Wire it into a stream-completion callback:
 *   `onFinish: ({ messages }) => store.saveMessages(threadId, messages)`  // AI SDK v5
 *   `onEnd:    ({ messages }) => store.saveChat({ chatId: threadId, messages })`  // current docs
 */
export class MemfoldChatStore<TMessage = unknown> {
  private readonly scope: Scope
  private readonly namespace: string

  constructor(
    private readonly backend: MemfoldLike,
    opts: MemfoldChatStoreOptions = {},
  ) {
    this.scope = opts.scope ?? 'session'
    this.namespace = opts.namespace ?? 'chat'
  }

  private dedup(threadId: string): string {
    return `${this.namespace}/${threadId}`
  }

  /** Load the stored messages for a thread, or an empty list if the thread is new. */
  async loadMessages(threadId: string): Promise<TMessage[]> {
    const rec = await findActiveByDedup(this.backend, this.dedup(threadId), this.scope)
    return rec ? (JSON.parse(rec.body) as TMessage[]) : []
  }

  /** Replace the stored messages for a thread with `messages`. */
  async saveMessages(threadId: string, messages: TMessage[]): Promise<void> {
    const dedup = this.dedup(threadId)
    const existing = await findActiveByDedup(this.backend, dedup, this.scope)
    if (existing) await this.backend.forget(existing.id)
    await this.backend.add({
      type: 'episodic',
      scope: this.scope,
      scope_path: threadId,
      dedup_key: dedup,
      title: `chat ${threadId}`,
      tags: ['chat', threadId],
      body: JSON.stringify(messages),
      provenance: { source: 'agent', session_id: threadId },
    })
  }

  /** Alias matching the Vercel AI SDK `loadChat(id)` name. */
  loadChat(id: string): Promise<TMessage[]> {
    return this.loadMessages(id)
  }

  /** Alias matching the Vercel AI SDK `saveChat({ chatId, messages })` name. */
  saveChat(args: { chatId: string; messages: TMessage[] }): Promise<void> {
    return this.saveMessages(args.chatId, args.messages)
  }
}

/** Convenience factory for {@link MemfoldChatStore}. */
export function createMemfoldChatStore<TMessage = unknown>(
  backend: MemfoldLike,
  opts?: MemfoldChatStoreOptions,
): MemfoldChatStore<TMessage> {
  return new MemfoldChatStore<TMessage>(backend, opts)
}
