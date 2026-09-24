import { createHash } from 'node:crypto'

/** Pluggable embedding backend. Records store `embedding_model`/`embedding_dim` so a
 *  store can be re-embedded when the model changes. Implement this to swap in any model. */
export interface Embedder {
  readonly model: string
  readonly dim: number
  embed(texts: string[]): Promise<Float32Array[]>
}

/**
 * Deterministic, dependency-free embedder: hashes tokens into a fixed-dim bag then
 * L2-normalizes. Not semantic, but stable and offline — the default for tests and for
 * environments that cannot run a model. Swap in `createTransformersEmbedder` for real search.
 */
export class HashEmbedder implements Embedder {
  readonly model = 'hash-mock'
  constructor(readonly dim = 384) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.one(t))
  }

  private one(text: string): Float32Array {
    const v = new Float32Array(this.dim)
    for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      const h = createHash('sha1').update(tok).digest()
      for (let i = 0; i < 8; i++) {
        const idx = (((h[i * 2] ?? 0) << 8) | (h[i * 2 + 1] ?? 0)) % this.dim
        v[idx] = (v[idx] ?? 0) + 1
      }
    }
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm
    return v
  }
}

/** Real local embeddings via transformers.js (no API key). Lazily imported so `@memfold/core`
 *  installs without the heavy ONNX runtime; call this only when you want semantic search. */
export async function createTransformersEmbedder(
  model = 'Xenova/all-MiniLM-L6-v2',
  dim = 384,
): Promise<Embedder> {
  // Specifier held in a variable so this stays an optional, lazily-resolved dependency:
  // `@memfold/core` installs without the heavy ONNX runtime, and users opt in by installing it.
  const spec = '@huggingface/transformers'
  // biome-ignore lint/suspicious/noExplicitAny: dynamic optional dependency, untyped by design
  const mod: any = await import(spec).catch(() => {
    throw new Error(
      'memfold: install @huggingface/transformers to use local embeddings, or pass a custom Embedder',
    )
  })
  const pipe = await mod.pipeline('feature-extraction', model)
  return {
    model: model.split('/').pop() ?? model,
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const out = await pipe(texts, { pooling: 'mean', normalize: true })
      const rows = out.tolist() as number[][]
      return rows.map((r) => Float32Array.from(r))
    },
  }
}
