import { defineConfig } from 'vitest/config'

// Resolve @memfold/* to source so tests run without a build step and parallel package
// work never depends on another package's compiled dist.
const pkg = (name: string) => new URL(`./packages/${name}/src/index.ts`, import.meta.url).pathname

export default defineConfig({
  resolve: {
    alias: {
      '@memfold/core': pkg('core'),
      '@memfold/adapters': pkg('adapters'),
      '@memfold/daemon': pkg('daemon'),
      '@memfold/mcp': pkg('mcp'),
      '@memfold/sdk': pkg('sdk'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'conformance/**/*.test.ts'],
  },
})
