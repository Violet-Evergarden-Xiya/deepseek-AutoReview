/**
 * Self-contained copy of the harness client-bundle preset
 * (packages/client/tsdown.client.ts) minus the CSS-module plugin this package
 * does not use. Emits the __ModuleLoader__ closure artifact: the bundle calls
 * window.__ModuleLoader__.load({ id, factory }) and resolves platform
 * externals through the injected require (the loader module table).
 */
import type { UserConfig } from 'tsdown'

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Store-engine exemption, resolved natively by the lazy module table. */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** Externals resolved from the loader module table: platform seeds plus the exemption. */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/** Vendored framework libraries with no cross-plugin runtime identity. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
/** Wire/type layers a client bundle may inline. */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/
/** Generated descriptor/codec contributions with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/
/** Workspace mode removes a falsey entry instead of building. */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

interface ClientBundleOptions {
  /** Emit the Node-side artifacts during the Host pass instead of the Client pass. */
  readonly hostPhase?: boolean
  /** Additional Node-side configs emitted alongside the package library. */
  readonly companions?: readonly UserConfig[]
  /** Overrides for the package's primary Node-side library config. */
  readonly lib?: UserConfig
}

type BuildFace = 'host' | 'client' | undefined

type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

function clientLibraryConfig(id: string, libEntry: readonly string[], overrides: UserConfig = {}): UserConfig {
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The harness supplies the @deepseek-ai packages; never bundle them.
    deps: { neverBundle: [/^@deepseek-ai\//] },
    ...overrides,
  }
}

function clientConfig(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    // Browser bundle lands next to the node half (single lib/ artifact dir;
    // the entryFileNames pin keeps it exactly lib/client.js).
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    // Browser bundles inline node-idiom deps; provide the env substitutions
    // Vite would normally seed.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    // A require() the table cannot answer is a guaranteed runtime throw, so
    // the rule is the table list itself: no opinion for table entries,
    // bundle everything else.
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [{
      // Bundle purity gate (build-time mirror of the module-edge rules):
      // platform seed entries stay external, inline-safe wire layers inline,
      // and every other @deepseek-ai value import is a build error.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        if (VENDORED_LIBRARY.test(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services',
        )
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/**
 * Build the tsdown config for this plugin package: the node-half lib build
 * plus the browser client bundle. A package-level tsdown.config.ts REPLACES
 * the root workspace layout, so the lib half must be restated here.
 * @param id - plugin id (package name), stamped into the loader handoff.
 * @param libEntry - node-half entries (lib/types outputs).
 * @param options - phase placement and config overrides.
 * @returns ENV-selected tsdown config for the current build face.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry, options.lib)
  return ({ env }) => {
    const face = buildFace(env?.DSH_BUILD_FACE)
    const client = clientConfig(id, face === undefined ? 'src/client/index.ts' : 'lib/types/client/index.js')
    const node = [lib, ...(options.companions ?? [])]
    if (face === 'host') return options.hostPhase === true ? node : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') return options.hostPhase === true ? [client] : [...node, client]
    return [...node, client]
  }
}
