# Research: building a CLI on Effect.TS 4.0

Status: findings
Date: 2026-08-15
Scope: does `@effect/cli` work on Effect 4.0 beta, and if not, what replaces it

## Summary (the answer to the gating question)

**`@effect/cli` has no release compatible with the Effect 4.0 beta line. Do not
plan around it.** Every one of the 450 published `@effect/cli` versions is on the
`0.x` line, and the newest (`0.77.0`) peer-depends on `effect: ^3.22.1`. There is
no `beta` or `rc` dist-tag for it.

**But this does not block the migration, because CLI functionality moved into the
Effect 4.0 core.** `effect@4.0.0-beta.107` ships a first-class
`effect/unstable/cli` namespace — twelve modules, ~17,000 lines of source, an
official worked example inside the package, and generated `--help`. It is the
supported way to build a CLI on 4.0, and it needs no extra dependency beyond the
`effect` and `@effect/platform-node` the reference project already pins.

The reference project at `/Users/P026886/coding/scratch-board` does not use
`@effect/cli` because it does not need to: it has no argument parsing to speak of
(see question 4 — its `cli.ts` is not an Effect program at all). Its absence from
that project is not evidence about 4.0 compatibility either way.

I verified the recommended approach end to end by building and running a small
ServiceNow-shaped CLI in `/tmp/effect-probe` against `effect@4.0.0-beta.107`, on
Node v24.13.0, with no build step. Commands, subcommands, typed flags,
`--help`, `--version`, env-var config, `.env` config, service layers,
resource finalizers, and custom process exit codes all work. Nothing in the repo
was touched.

There is one non-obvious trap that will bite this project specifically, and it is
the most actionable finding after the two above: **Effect's default logger writes
to stdout, and `runMain`'s error report goes through it.** A CLI whose contract
is "print JSON to stdout" will emit log lines and error dumps into that JSON
stream unless you redirect them. The fix is in question 3.

One more scheduling fact worth knowing before pinning: **the 4.0 beta line has
already moved to release candidates.** `effect@4.0.0-rc.109` was published
2026-08-14, one day before this research. See question 6.

## Question 1: Is there an `@effect/cli` compatible with Effect `4.0.0-beta.x`?

No. This is verified from the npm registry directly.

`npm view @effect/cli versions --json` returns 450 versions. Filtering for
anything not on the `0.x` line returns nothing:

```
$ npm view @effect/cli versions --json | tr -d ' ",[]' | grep -v '^$' | grep -vE '^0\.'
(no output)
```

The newest version and its peer requirements:

```
$ npm view @effect/cli@latest version peerDependencies --json
{
  "version": "0.77.0",
  "peerDependencies": {
    "@effect/platform": "^0.97.1",
    "@effect/printer": "^0.51.0",
    "@effect/printer-ansi": "^0.51.0",
    "effect": "^3.22.1"
  }
}
```

`effect: ^3.22.1` cannot be satisfied by `4.0.0-beta.107`. Installing both would
either fail peer resolution or leave you running `@effect/cli` against a major
version it was never built for — and 4.0 renamed and relocated large parts of the
core, so this is not a cosmetic mismatch.

The dist-tags confirm there is no prerelease channel for it:

```
$ npm view @effect/cli dist-tags --json
{
  "snapshot": "0.0.0-snapshot-6ebc752baf28354006ca2a0ae783a5bccf5de9ad",
  "latest": "0.77.0"
}
```

Compare `effect`'s own dist-tags, which do have prerelease channels:

```
$ npm view effect dist-tags --json
{ "rc": "4.0.0-rc.109", "snapshot": "0.0.0-snapshot-...", "beta": "4.0.0-beta.107", "latest": "3.22.1" }
```

That lone `snapshot` tag on `@effect/cli` is a red herring. Its peer dependencies
include `@effect/schema`, a package that was folded into core long ago, so the
snapshot is stale build output rather than evidence of current support:

```
$ npm view @effect/cli@0.0.0-snapshot-6ebc752... peerDependencies --json
{ "effect": "^0.0.0-snapshot-...", "@effect/schema": "^0.0.0-snapshot-...", ... }
```

Two further pieces of corroboration:

- **Release timing.** `@effect/cli@0.77.0` was published 2026-07-30T04:29:11Z and
  `effect@3.22.1` at 2026-07-30T04:29:21Z — ten seconds apart, i.e. the same
  monorepo release. `@effect/cli` rides the 3.x train, not the 4.0 one.
  (`npm view @effect/cli time --json`, `npm view effect time --json`.)
- **The package is gone from the 4.0 source tree.** On the Effect monorepo `main`
  branch, `packages/cli/package.json` returns HTTP 404, while
  `packages/effect/src/unstable/cli/index.ts` returns HTTP 200. The standalone
  package was removed and its functionality absorbed into core.
  (Fetched `https://raw.githubusercontent.com/Effect-TS/effect/main/packages/cli/package.json`
  → 404, and `.../packages/effect/src/unstable/cli/index.ts` → 200.)

So `@effect/cli` is a 3.x artifact. Treat it as unavailable for this project and
do not add it to `package.json`.

## Question 2: Did CLI functionality move into `effect/unstable/*`?

Yes — verified against the published artifact, not a blog post.

I installed the package into a scratch directory outside the repo
(`/tmp/effect-probe`, `npm install effect@4.0.0-beta.107 @effect/platform-node@4.0.0-beta.107`)
and read its exports map. The full set of `unstable/*` namespaces the package
actually ships:

```
$ node -p "Object.keys(require('./package.json').exports).join('\n')"
./package.json
.
./testing
./unstable/ai
./unstable/cli
./unstable/cluster
./unstable/devtools
./unstable/encoding
./unstable/eventlog
./unstable/http
./unstable/httpapi
./unstable/observability
./unstable/persistence
./unstable/process
./unstable/reactivity
./unstable/rpc
./unstable/schema
./unstable/socket
./unstable/sql
./unstable/workflow
./unstable/workers
./*
./internal/*
./unstable/cli/internal/*
./unstable/cluster/internal/*
./index
./*/index
```

`./unstable/cli` is there, and it is substantial enough to have its own
`./unstable/cli/internal/*` export carve-out. The modules it contains
(`/tmp/effect-probe/node_modules/effect/src/unstable/cli/`, line counts from
`wc -l`):

| Module | Lines | Role |
| --- | --- | --- |
| `Command.ts` | 3104 | commands, subcommands, handlers, `run` |
| `Prompt.ts` | 3940 | interactive prompts |
| `Param.ts` | 3163 | shared machinery behind flags and arguments |
| `Flag.ts` | 2107 | `--flag` constructors and combinators |
| `Argument.ts` | 1569 | positional argument constructors |
| `Primitive.ts` | 992 | primitive value parsers |
| `CliError.ts` | 628 | tagged parse/validation errors |
| `CliOutput.ts` | 593 | output formatter |
| `HelpDoc.ts` | 331 | help document model |
| `GlobalFlag.ts` | 312 | built-in global flags |
| `Completions.ts` | 123 | shell completion generation |
| `CliConfig.ts` | 85 | CLI-level configuration |
| `index.ts` | 65 | barrel |

That is ~17,000 lines, which is a real port of `@effect/cli` rather than a stub.
The barrel confirms the public surface, and every module carries `@since 4.0.0`
(`/tmp/effect-probe/node_modules/effect/src/unstable/cli/index.ts:1-66`).

The namespace is not newly added and not experimental-in-name-only: it is present
in the exports map of every 4.0 release I sampled — `4.0.0-beta.1` (published
2026-02-18), `beta.50`, `beta.90`, `beta.100`, `beta.107`, and `rc.109`
(`npm view effect@<v> exports --json | grep -c "unstable/cli"` returned a match
for all six).

Two authoritative in-package sources document it, which matters because
effect.website has no 4.0 CLI documentation yet (see open questions):

- The package ships its own agent instructions,
  `/tmp/effect-probe/node_modules/effect/AGENTS.md:350-358`, with a
  "Building CLI applications" section that says: *"Use the `effect/unstable/cli`
  modules to build CLI applications."*
- It ships a runnable official example,
  `/tmp/effect-probe/node_modules/effect/ai-docs/src/70_cli/10_basics.ts`, which
  is the basis of the snippets in question 3.

Finally, an important practical detail: **the exports map resolves to compiled
JavaScript, not TypeScript source.**

```
$ node -p "JSON.stringify(require('./package.json').exports['./unstable/cli'])"
"./dist/unstable/cli/index.js"
```

The `src/*.ts` files are shipped for source-map and reading purposes only. This
is what makes question 5 straightforward.

## Question 3: The recommended way to build a CLI on Effect 4.0 beta

Everything below is either copied from the official in-package example or
verified by running it. Where I ran it, I give the command and output.

### Declaring commands and subcommands

From the official example
(`/tmp/effect-probe/node_modules/effect/ai-docs/src/70_cli/10_basics.ts:7-30`,
`:127-136`), lightly trimmed:

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

// Flags can be declared outside a command and reused.
const workspace = Flag.string("workspace").pipe(
  Flag.withAlias("w"),
  Flag.withDescription("Workspace to operate on"),
  Flag.withDefault("personal")
)

// A root command that shares flags with every subcommand.
const tasks = Command.make("tasks").pipe(
  Command.withSharedFlags({
    workspace,
    verbose: Flag.boolean("verbose").pipe(Flag.withAlias("v"))
  }),
  Command.withDescription("Track and manage tasks")
)
```

A subcommand pairs a name, an input record of flags/arguments, and a handler.
Note how the handler reads the parent command's parsed input by yielding the
parent command value — that is the mechanism for shared/global options
(`10_basics.ts:32-61`):

```ts
const create = Command.make(
  "create",
  {
    title: Argument.string("title").pipe(Argument.withDescription("Task title")),
    priority: Flag.choice("priority", ["low", "normal", "high"]).pipe(
      Flag.withDefault("normal")
    )
  },
  Effect.fn(function* ({ title, priority }) {
    // Subcommands read parent input by yielding the parent command.
    const root = yield* tasks
    yield* Console.log(`Created "${title}" in ${root.workspace} (${priority})`)
  })
).pipe(
  Command.withDescription("Create a task"),
  Command.withExamples([
    { command: `tasks create "Ship 4.0" --priority high`, description: "..." }
  ])
)
```

Composition and launch (`10_basics.ts:127-136`):

```ts
tasks.pipe(
  Command.withSubcommands([create, list]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
```

The `Command` combinators available in beta.107 (from
`grep -nE "^export const" .../unstable/cli/Command.ts`): `make`, `withHandler`,
`withSubcommands`, `withSharedFlags`, `withGlobalFlags`, `withDescription`,
`withShortDescription`, `withAlias`, `unlisted`, `annotate`, `annotateMerge`,
`withExamples`, `provide`, `provideSync`, `provideEffect`, `provideEffectDiscard`,
`wizard`, `run`, `runWith`.

`Command.runWith` takes an explicit `Array<string>` of arguments instead of
reading them from the `Stdio` service, which is the hook for testing a command
without spawning a process (`Command.ts:2749-2753`, `:2968`).

**Relevant to this repo's conventions:** snake_case command and flag names work
verbatim, so the ten tool names and the `sysparm_*` parameters carry over without
translation. Verified:

```
$ node probe-names.ts query_table --sysparm_limit 3
{"limit":3}
[exit=0]

$ node probe-names.ts query_table --help
USAGE
  sn query_table [flags]

FLAGS
  --sysparm_limit integer
  --sysparm_query string
```

### Typed flags and arguments, and how they relate to `Schema`

Flags and arguments are built from `Primitive` parsers, **not** from `Schema` by
default. `Schema` is an opt-in refinement layered on top. This is worth being
precise about, because it differs from how `Tool.make` consumes `Schema` directly
in the MCP plan (`.scratch/effect-migration/PRD.md:53`).

Built-in `Flag` constructors (`Flag.ts`): `string`, `boolean`, `integer`, `float`,
`date`, `choice`, `choiceWithValue`, `path`, `file`, `directory`, `redacted`,
`fileText`, `fileParse`, `fileSchema`, `keyValuePair`, `none`.

`Argument` has the same shape minus the flag-only ones, plus `variadic` for
"one or more positional values" (`Argument.ts:571`).

Combinators on both: `withDescription`, `withDefault`, `withMetavar`, `optional`,
`map`, `mapEffect`, `mapTryCatch`, `filter`, `filterMap`, `orElse`, `atLeast`,
`atMost`, `between`, `withSchema`, `withFallbackConfig`, `withFallbackPrompt`.
`Flag` additionally has `withAlias` and `withHidden`.

The three `Schema` touchpoints are:

1. `Flag.withSchema` / `Argument.withSchema` — validate and transform a parsed
   value through a `Schema` codec. From the JSDoc at `Flag.ts:1988-2025`:

```ts
import { Schema } from "effect"

const isEmail = Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
const EmailSchema = Schema.String.pipe(Schema.check(isEmail))

const email = Flag.string("email").pipe(Flag.withSchema(EmailSchema))
```

   It also handles structured values decoded from a string, e.g.
   `Schema.Struct({...}).pipe(Schema.fromJsonString)` (`Flag.ts:2010-2017`).

2. `Flag.fileSchema(name, schema, options)` — read a file and decode it as JSON,
   YAML, or TOML into a `Schema` type (`Flag.ts:373-392`):

```ts
const ConfigSchema = Schema.Struct({ port: Schema.Number, host: Schema.String })
const config = Flag.fileSchema("config", ConfigSchema, { format: "json" })
```

3. `Config` is itself Schema-backed in 4.0 — `Config.Boolean`, `Config.Port`,
   `Config.LogLevel` are exported as `Schema` values for use with
   `Config.schema(...)` (`Config.ts:1247`, `:1270`, `:1290`).

For the ten ServiceNow commands, the practical reading is: use the `Flag`/
`Argument` primitives for ordinary inputs, and reach for `withSchema` only where
you need a constraint the primitives do not express.

### `--help` generation

Generated automatically from the command tree, descriptions, and examples; no
wiring required. Verified against my probe:

```
$ node probe-cli.ts --help
DESCRIPTION
  ServiceNow CLI probe

USAGE
  sn <subcommand> [flags]

FLAGS
  --instance string    ServiceNow instance host

GLOBAL FLAGS
  --help, -h                          Show help information
  --version, -v                       Show version information
  --wizard                            Start wizard mode for a command
  --completions <bash|zsh|fish|sh>    Print shell completion script
  --log-level <all|trace|...|none>    Sets the minimum log level

SUBCOMMANDS
  query-table    Query a ServiceNow table
[exit=0]
```

Five global flags come for free, including `--log-level` and shell completions.
`--version` uses the string passed to `Command.run({ version })`:

```
$ node probe-cli.ts --version
sn v0.1.0
[exit=0]
```

Help goes to **stdout** and exits **0** when explicitly requested. When help is
shown because of a parse failure, the exit code is **1** — the `ShowHelp` error
carries a conditional exit code (`CliError.ts:614-628`):

```ts
export class ShowHelp extends Schema.TaggedError<ShowHelp>(...)("ShowHelp", {
  commandPath: Schema.Array(Schema.String),
  errors: Schema.Array(NonShowHelpErrors)
}) {
  override readonly [Runtime.errorExitCode] = this.errors.length ? 1 : 0
  override readonly [Runtime.errorReported] = false
}
```

### Exit codes, and how a tagged error maps to a non-zero exit

The mechanism is `Runtime.defaultTeardown` plus a `Runtime.errorExitCode` symbol
that any error can carry. From `Runtime.ts:74-115`:

```ts
// - `0` for successful completion.
// - `130` for interruption-only failures.
// - The squashed error's errorExitCode value for other failures when present.
// - `1` for other failures.
export const defaultTeardown: Teardown = (exit, onExit) => {
  if (Exit.isSuccess(exit)) return onExit(0)
  if (Cause.hasInterruptsOnly(exit.cause)) return onExit(130)
  return onExit(getErrorExitCode(Cause.squash(exit.cause)))
}
```

`errorExitCode` is declared as an optional symbol property on the global `Error`
interface (`Runtime.ts:226-228`), so a tagged error opts in by declaring it as a
class field. Verified working with `Schema.TaggedError`:

```ts
export class SnApiError extends Schema.TaggedError<SnApiError>()("SnApiError", {
  status: Schema.Number,
  detail: Schema.String
}) {
  readonly [Runtime.errorExitCode] = 4
}
```

Observed exit codes from my probe runs:

| Situation | Exit code | Verified by |
| --- | --- | --- |
| Success | 0 | `node probe-service2.ts --table incident` |
| `--help`, `--version` | 0 | `node probe-cli.ts --help` |
| Tagged error with `errorExitCode = 4` | 4 | `node probe-service2.ts --table bad` |
| Tagged error with `errorExitCode = 7` | 7 | `node probe-cli.ts ... --fail` |
| Missing required flag | 1 | `node probe-cli.ts query-table incident` |
| Unrecognized flag | 1 | `node probe-cli.ts ... --nope` |
| Unknown subcommand | 1 | `node probe-cli.ts --instance x bogus` |
| Invalid value for typed flag | 1 | `... --sysparm_limit abc` |
| Missing required `Config` value | 1 | `node probe-config3.ts` with env unset |
| Interruption only (not exercised) | 130 | `Runtime.ts:113` (read, not run) |

This is a genuinely good fit for the migration: each ServiceNow failure mode can
get a distinct, documented exit code by declaring one field on its tagged error,
with no `process.exit` calls anywhere.

### Reading configuration and environment variables via `Config`

`Config` works inside a command handler with no extra setup —
`NodeServices.layer` supplies the environment-backed `ConfigProvider`. Verified:

```
$ SN_INSTANCE=dev123 SN_AUTH_TYPE=now-sdk SN_CLIENT_SECRET=hunter2 SN_TABLE=incident node probe-config3.ts
{"instance":"dev123","authType":"now-sdk","secretToString":"<redacted>","secretValue":"hunter2","table":"incident"}
[exit=0]
```

The code that produced it, which is a plausible shape for this repo's auth config:

```ts
import { Config, Redacted } from "effect"

const SnConfig = Config.all({
  instance: Config.nonEmptyString("SN_INSTANCE"),
  authType: Config.literals(["now-sdk", "client_credentials"], "SN_AUTH_TYPE"),
  secret: Config.redacted("SN_CLIENT_SECRET").pipe(
    Config.withDefault(Redacted.make("none"))
  )
})

// inside a handler:
const cfg = yield* SnConfig
```

`Config.redacted` gives real redaction — `String(secret)` prints `<redacted>`
while `Redacted.value(secret)` returns the plaintext, as the output above shows.
That is worth adopting for `SN_CLIENT_SECRET`.

**Caution on the `Config` API surface.** It is not the Effect 3.x API and not
what I guessed from memory. The constructors are `export function` declarations,
so grepping for `export const` misses them; runtime introspection is the reliable
way to enumerate them:

```
$ node --input-type=module -e "import * as Config from 'effect/Config'; console.log(Object.keys(Config).sort().join(' '))"
Array Boolean ConfigError FalseValues LogLevel Port Record TrueValues all boolean
date duration fail finite int isConfig literal literals logLevel map mapOrFail
nested nonEmptyString number option orElse port redacted schema string succeed
unwrap url withDefault
```

I got three signatures wrong on first attempt (`Config.String` instead of
`Config.string`; `Config.literals([...])("NAME")` instead of
`Config.literals([...], "NAME")`; `ServiceMap` instead of `Context`). Budget for
checking each API against the installed package rather than recalling it.

Two integrations worth knowing:

**Flags can fall back to config**, which is exactly the "flag or env var" ergonomic
a CLI wants (`Flag.ts:853-871`):

```ts
const verbose = Flag.boolean("verbose").pipe(
  Flag.withFallbackConfig(Config.boolean("VERBOSE"))
)
```

Verified — with the flag absent, the value came from the environment:

```
$ SN_INSTANCE=env-instance node probe-cli.ts query-table incident
{"instance":"env-instance","table":"incident","limit":10}
```

**`.env` files are supported natively**, no `dotenv` dependency. This repo already
requires a real `.env` in the root (`AGENTS.md`, "Calling tools headless"), so
this replaces that plumbing. `ConfigProvider.fromDotEnv` and
`ConfigProvider.fromDir` exist at `ConfigProvider.ts:1459` and `:1530`. Verified,
including precedence:

```ts
const DotEnvLayer = ConfigProvider.layerAdd(
  ConfigProvider.fromDotEnv({ path: ".env" })
)
```

```
$ node probe-dotenv.ts                          # values from .env
{"instance":"dotenv-instance","table":"change_request"}
$ SN_INSTANCE=env-wins node probe-dotenv.ts     # real env overrides .env
{"instance":"env-wins","table":"change_request"}
```

Real environment variables win over `.env` entries, which is the conventional and
desirable precedence.

### Writing to stdout and stderr — read this before designing output

`Console.log` writes to stdout and `Console.error` to stderr, and the CLI runner
uses both deliberately: help documents go to stdout via `Console.log`, while
parse-error details go to stderr via `Console.error` (`Command.ts:2671-2691`).
Verified on a missing-flag run: 856 bytes of help on stdout, 43 bytes of error on
stderr.

**The trap:** Effect's default logger writes via `console.log`, i.e. **stdout**,
and `runMain`'s automatic error reporting is a log call. So an unhandled tagged
error dumps onto stdout, mixed into whatever data you were printing. Verified —
with streams captured separately, the failure report landed entirely on stdout and
stderr was empty:

```
$ node probe-cli.ts --instance x query-table incident --fail >out.txt 2>err.txt
[exit=7]
--- STDOUT ---
[20:22:44.852] ERROR (#2): SnApiError: ServiceNow returned 403
    at ...
--- STDERR ---
(empty)
```

For a CLI whose commands print JSON, this corrupts the output contract. The old
MCP design already had the equivalent rule — "Logs go to stderr (stdout is the MCP
channel)" (`.scratch/effect-migration/PRD.md:56`) — and it carries over unchanged,
only now stdout is the data channel rather than the protocol channel.

`Logger.LogToStderr` exists for precisely this, and its own documentation names the
use case: *"Use to route built-in logger output to stderr while keeping stdout
reserved for protocol messages or data output"* (`Logger.ts:164-185`).

But providing it alone is **not sufficient**, and this is the subtle part. `runMain`
wraps your effect from the outside:

```ts
// Runtime.ts:207-215
const fiber = options?.disableErrorReporting === true
  ? Effect.runFork(effect)
  : Effect.runFork(
      Effect.tapCause(effect, (cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void
        const isReported = getErrorReported(Cause.squash(cause))
        return isReported ? Effect.logError(cause) : Effect.void
      })
    )
```

That `Effect.logError` runs *outside* any context you provided to `effect`, so it
reads the default `LogToStderr` (`false`) regardless. I confirmed this: adding
`Effect.provideService(Logger.LogToStderr, true)` inside the pipeline left the
error report on stdout.

The combination that does work — verified — is to disable the built-in reporting
and render the cause yourself inside the provided scope:

```ts
Command.run(cmd, { version: "0.1.0" }).pipe(
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause) ? Effect.void : Console.error(Cause.pretty(cause))
  ),
  Effect.provide(NodeServices.layer),
  Effect.provideService(Logger.LogToStderr, true),
  (effect) => NodeRuntime.runMain(effect, { disableErrorReporting: true })
)
```

Result — stdout carries only data, everything diagnostic is on stderr, and the
custom exit code survives:

```
$ node probe-stderr2.ts >o1.txt 2>e1.txt          # success
[exit=0]
--STDOUT--  {"ok":true}
--STDERR--  [20:24:51.027] INFO (#2): about to work

$ node probe-stderr2.ts --fail >o2.txt 2>e2.txt   # failure
[exit=7]
--STDOUT (0 bytes)--
--STDERR--
[20:24:51.429] INFO (#2): about to work
SnApiError: ServiceNow returned 403
    at ...
```

There is also a `renderErrors` option on `Command.run` for when "the host
application owns error rendering" (`Command.ts:2701-2705`), which I did not
exercise; it may allow a tidier version of the above.

## Question 4: How a CLI entrypoint gets launched

### The idiomatic 4.0 pattern

`Command.run(...)` produces an ordinary `Effect` that completes. You provide the
platform services and hand it to `NodeRuntime.runMain`. From the official example
(`ai-docs/src/70_cli/10_basics.ts:127-136`):

```ts
tasks.pipe(
  Command.withSubcommands([create, list]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
```

`NodeServices.layer` is the "services for the platform you are targeting" bundle
(the example's own comment at `:132-134`) and supplies `FileSystem`, `Path`,
`Stdio`, `Terminal`, and the environment `ConfigProvider` that `Config` needs.

`runMain` "installs SIGINT / SIGTERM handlers and interrupts running fibers for
graceful shutdown" and sets the exit code from the `Exit`
(`ai-docs/src/01_effect/06_running/10_run-main.ts:22-23`;
`@effect/platform-node/src/NodeRuntime.ts` doc comment).

### `Layer.launch` is the wrong tool here

The MCP plan used `Layer.provide([...])` + `Layer.launch` + `NodeRuntime.runMain`
(`.scratch/effect-migration/PRD.md:47`, `:56`). **Do not carry `Layer.launch`
across to the CLI.** Its documented purpose is the opposite shape of process:

> `Layer.launch` converts the layer into a long-running `Effect<never>`. This
> entrypoint pattern works well when the whole app is represented as layers (for
> example: HTTP server + background workers).
>
> — `ai-docs/src/01_effect/06_running/20_layer-launch.ts:22-26`

An `Effect<never>` never completes, which is right for a stdio MCP server that
must stay up and wrong for a CLI that must run one command and exit. `Command.run`
already gives you a completing effect; `runMain` already owns signals, teardown,
and exit codes. Keep `Layer.launch` out of it.

Service layers still compose normally. Verified: `Command.provide(SnClient.layer)`
attaches a service to a command, and its finalizers run before the process exits
in both the success and failure paths.

```ts
export class SnClient extends Context.Service<SnClient, {
  query(table: string): Effect.Effect<string, SnApiError>
}>()("sn/SnClient") {
  static readonly layer = Layer.effect(SnClient, Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.logInfo("SnClient released"))
    yield* Effect.logInfo("SnClient acquired")
    return SnClient.of({ query: (table) => /* ... */ })
  }))
}

const cmd = Command.make("sn", { table: Flag.string("table") }, handler)
  .pipe(Command.provide(SnClient.layer))
```

```
$ node probe-service2.ts --table incident
[exit=0]  stdout: rows from incident
          stderr: SnClient acquired / SnClient released

$ node probe-service2.ts --table bad
[exit=4]  stdout: (empty)
          stderr: SnClient acquired / SnClient released / SnApiError: ...
```

The `Context.Service` shape above is taken from the official services example
(`ai-docs/src/01_effect/03_services/01_service.ts:13-38`), which also confirms
`Schema.TaggedError<Self>()("Tag", fields)` as the tagged-error form
(`:40-42`). Note the empty `()` before the tag name — I initially wrote it with a
type-string argument and it did not compile.

### What the reference project actually does — an important correction

The task brief describes `/Users/P026886/coding/scratch-board` as "a working
Effect 4.0 beta CLI on this machine." That is not accurate, and it matters,
because it means that project offers no precedent for the CLI entrypoint question.

`/Users/P026886/coding/scratch-board/src/cli.ts` **does not use Effect at all.**
It is a plain Node script: `async function main()`, `process.argv[2]`,
`process.stderr.write`, `process.exitCode = 1`, and hand-written `SIGINT`/
`SIGTERM` handlers (`cli.ts:6-40`, `:53-58`). There is no import from `effect` in
the file, and `Command`, `Flag`, and `runMain` appear nowhere in the project.

Where that project does use Effect is one layer down, in the server it starts.
`src/server.ts` builds a `Layer` graph and drives it with `ManagedRuntime`
(`server.ts:29-59`):

```ts
const runtime = ManagedRuntime.make(BoardServer)
const address = await runtime.runPromise(
  Effect.map(HttpServer.HttpServer, (server) => server.address)
)
```

`ManagedRuntime` is the bridge for embedding Effect inside an
otherwise-promise-based program — a reasonable choice there, since that CLI is a
thin launcher for a long-running HTTP server with a browser-opening side effect.

Two conclusions for this migration:

1. **Do not copy scratch-board's entrypoint.** It is the hand-written `main()` and
   manual signal handling that the PRD explicitly wants to stop doing
   (`.scratch/effect-migration/PRD.md:56`). Use `Command.run` + `runMain` instead.
2. **`@effect/cli`'s absence from scratch-board's `package.json` carries no
   information** about 4.0 compatibility. That project parses one optional
   positional argument; it never needed a CLI framework.

The one thing worth borrowing is its packaging, which is confirmed to work:
`"bin": { "scratchboard": "./src/cli.ts" }` pointing at a `.ts` file with a
`#!/usr/bin/env node` shebang, `"type": "module"`, and no build step
(`scratch-board/package.json:6-15`, `cli.ts:1`).

## Question 5: Does this type-strip cleanly under Node 24?

Yes, on both halves of the question, and the dependency half is not even a
question.

**The dependency is never type-stripped.** As established in question 2, the
exports map resolves `effect/unstable/cli` to `./dist/unstable/cli/index.js` —
compiled JavaScript. Node never parses Effect's TypeScript. Whatever syntax
Effect's own source uses is irrelevant to type-stripping. The PRD's note that this
needs verifying (`.scratch/effect-migration/PRD.md:57`) can be closed: the concern
does not apply.

**My own CLI code strips cleanly.** Every probe in this document ran as
`node <file>.ts` on Node v24.13.0 with no build step, no loader, and no
`--experimental-strip-types` flag. That includes the constructs the migration will
lean on:

- `Context.Service<Self, Interface>()("id")` class definitions
- `Schema.TaggedError<Self>()("Tag", { ... })` class definitions
- a computed class field, `readonly [Runtime.errorExitCode] = 4`
- `static readonly layer = Layer.effect(...)` inside a class body
- generator handlers via `Effect.fn(function* () { ... })`
- deep imports from `effect/unstable/cli`

All of these are class fields and class expressions, which type-stripping handles.
None of them require the constructs Node cannot strip: no `enum`, no `namespace`,
no decorators, no constructor parameter properties.

I confirmed this statically as well, by type-checking the probes with
TypeScript 5.9.3 under `erasableSyntaxOnly: true` — the flag whose entire job is
to reject syntax that type-stripping cannot erase:

```
$ ./node_modules/.bin/tsc -p tsconfig.json
CLEAN: 0 errors, no erasableSyntaxOnly violations
```

(The tsconfig used `strict`, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`,
`module`/`moduleResolution: nodenext`, `allowImportingTsExtensions`, and
`rewriteRelativeImportExtensions`, over five probe files.)

**Recommendation.** Add `"erasableSyntaxOnly": true` to the new repo's tsconfig.
The current repo does not set it (`tsconfig.json:2-16`), which means today nothing
stops someone writing an `enum` that type-checks and then fails at runtime under
`node file.ts`. Turning it on converts that runtime failure into a compile error
and makes the no-build setup enforceable rather than merely conventional. The
existing `rewriteRelativeImportExtensions` and `allowImportingTsExtensions`
settings (`tsconfig.json:9-10`) already do the right thing and should carry over.

So the reference project's no-build setup is viable, and the `bin` pointing at a
`.ts` entrypoint works. The one caveat is distribution-shaped rather than
correctness-shaped: a `bin` that is a `.ts` file requires the consumer to be on a
Node with type-stripping (the reference sets `"engines": { "node": ">=22.18" }`,
`scratch-board/package.json:10-12`). For a local tool used on this machine that is
fine; the PRD's plan to keep a `tsc` build for distribution remains the right
hedge (`.scratch/effect-migration/PRD.md:57`).

## Question 6: Version pinning and churn risk

### What to pin together

Pin `effect` and `@effect/platform-node` to the **same exact version**, with no
caret. They are released in lockstep and the platform package's peer range names
the core version:

```
$ npm view @effect/platform-node@4.0.0-beta.107 peerDependencies dependencies --json
{
  "peerDependencies": { "effect": "^4.0.0-beta.107", "ioredis": ">=5.7.0 <6.0.0" },
  "dependencies": { "mime": "^4.1.0", "undici": "^8.7.0",
                    "@effect/platform-node-shared": "^4.0.0-beta.107" }
}
```

Note that `^4.0.0-beta.107` is a *caret on a prerelease*, which under npm semver
resolves to `>=4.0.0-beta.107 <5.0.0`. That range happily admits `4.0.0-rc.109`
and every future 4.0 prerelease. So the peer range will not protect you from a
mismatched upgrade — only exact pins in `package.json` will. This is what ADR 0006
already concluded ("Pin exact beta versions ... so a stray `npm install` can't
pull an incompatible beta",
`.scratch/effect-migration/new-repo/docs/adr/0006-effect-4-beta-pin.md:25-26`);
the finding here is that the reasoning applies to the CLI surface too, and that
`@effect/cli` must simply not appear in the dependency list.

The concrete recommendation, matching what scratch-board already pins:

```
"effect": "4.0.0-beta.107",
"@effect/platform-node": "4.0.0-beta.107"
```

`@effect/platform-node`'s `latest` tag is `0.108.1` (the 3.x line), so a bare
`npm install @effect/platform-node` will install the wrong major. Always name the
version or the `beta`/`rc` tag.

### The beta line has moved to RC

This is the timing fact most likely to affect the plan:

| Version | Published |
| --- | --- |
| `effect@4.0.0-beta.1` | 2026-02-18 |
| `effect@4.0.0-beta.90` | 2026-06-25 |
| `effect@4.0.0-beta.100` | 2026-07-21 |
| `effect@4.0.0-beta.107` | 2026-08-10 |
| `effect@4.0.0-rc.109` | 2026-08-14 |

(`npm view effect time --json`.) An `rc` tag exists for both `effect` and
`@effect/platform-node`, published one day before this research. If the rewrite is
starting now, it is worth an explicit decision whether to start on `rc.109`
rather than `beta.107` — starting on the RC line means one fewer forced migration
before 4.0 final. I did not runtime-test `rc.109`, only diffed its source
(see open questions).

### Has the CLI surface been churning?

Mostly stable, with real but small breaking changes. I diffed the actual published
sources by unpacking tarballs (`npm pack effect@<version>`) into `/tmp/cli-churn`.

Module inventory of `effect/unstable/cli`:

| Version | Modules |
| --- | --- |
| `beta.90` | 12 (no `CliConfig.ts`) |
| `beta.100` | 13 |
| `beta.107` | 13 |
| `rc.109` | 13 |

`CliConfig.ts` was added between `beta.90` and `beta.100`; the inventory has been
stable since.

Export-level diffs on the three modules that matter most:

- **`Flag`**: identical between `beta.100` and `rc.109`.
- **`Argument`**: identical between `beta.100` and `rc.109`.
- **`Command`**, `beta.90` → `beta.107`: `wizard` added, and
  `withHidden` **renamed to** `unlisted`. Pinpointing the rename by counting
  declarations per version:

```
4.0.0-beta.90    withHidden=1 unlisted=0
4.0.0-beta.100   withHidden=1 unlisted=0
4.0.0-beta.107   withHidden=0 unlisted=1
4.0.0-rc.109     withHidden=0 unlisted=1
```

So the CLI surface saw exactly one breaking rename across roughly two months of
betas, in a combinator this project is unlikely to use. `Command.run`,
`Command.make`, `withSubcommands`, `withSharedFlags`, and `provide` — the load-
bearing entrypoint API — were unchanged across every version I compared. On the
specific question asked: **the CLI and entrypoint surface has been stable, not
churning.**

The wider 4.0 surface is a different matter. Between `beta.107` and `rc.109`,
`@effect/platform-node` swapped its `ioredis` peer for `redis` and appears to have
dropped the `@effect/platform-node-shared` dependency (compare the two
`npm view ... peerDependencies` outputs above). And as noted in question 3, the
`Config` and service-definition APIs are different enough from both Effect 3.x and
from my priors that three of my first attempts failed. ADR 0006's consequence —
"re-verify the surfaces against the changelog and the reference implementation"
after any bump — should be kept, with the target list changed from
`McpServer`/`Tool`/`Toolkit` to `Command`/`Flag`/`Argument`/`Config`.

### Practical mitigation

The cheapest insurance is the check the AGENTS.md already asks for, made concrete:
after any version bump, run one smoke command that exercises `--help`, a success
path, and a deliberately failing path, and assert the three exit codes. That
single check catches an entrypoint rename, a flag-constructor rename, and an
exit-code regression at once, and it is the sort of runnable check the repo's
conventions call for.

## Open questions and what I could not verify

- **Official documentation on effect.website for the 4.0 CLI: not found.** I did
  not locate a 4.0 CLI page. The one docs page I fetched
  (`https://effect.website/docs/additional-resources/effect-vs-fp-ts/`) is 3.x-era
  content and mentions no `unstable` namespaces. I did not exhaustively crawl the
  site, so I cannot say the page does not exist — only that I did not find one and
  did not rely on it. Everything in this document is instead sourced from the
  published package (its `AGENTS.md`, `ai-docs/` examples, and `src/` JSDoc) and
  the monorepo `main` branch, which are equally primary and version-exact. If
  `unstable` means "documented in-package, not yet on the docs site," expect the
  website to lag.
- **No CHANGELOG in the npm tarball.** `ls` on the unpacked `rc.109` package shows
  only `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `README.md`, `ai-docs`, `dist`,
  `package.json`, `src`. My churn analysis is therefore a source diff between
  published versions rather than a reading of release notes. A changelog may exist
  in the GitHub repo; I did not retrieve it, and GitHub raw requests via `curl`
  were rate-limited (HTTP 403) during this session, which limited how much of the
  repo I could sample.
- **`rc.109` was not runtime-tested.** I compared its `unstable/cli` sources and
  exports against `beta.107` and found them near-identical, but every execution in
  this document ran on `beta.107`. Before adopting the RC line, re-run the smoke
  check.
- **Untested parts of the CLI surface.** I did not exercise `Prompt` (interactive
  prompts), `Completions` (shell completion output), `Command.wizard` /
  `--wizard`, `CliConfig`, `CliOutput.Formatter` customization, or the
  `renderErrors` option on `Command.run`. Each is documented in the source but
  unverified here. `renderErrors` in particular may offer a cleaner solution to
  the stdout/stderr problem than the `disableErrorReporting` workaround I verified.
- **Interruption exit code 130 was not exercised.** It is documented at
  `Runtime.ts:76-85` and `:113`; I read the code but did not send a signal.
- **Whether `Logger.LogToStderr` can be set globally** rather than worked around.
  I established that providing it inside the pipeline does not affect `runMain`'s
  own error report, and found a working alternative, but I did not find a
  documented way to change the default for the root fiber. There may be one.
- **How the ten existing tools' argument shapes map onto flags in detail.** I
  verified that snake_case names and `sysparm_*` flags work, but I did not read
  each tool's current zod schema and design its flag set. That is a design task
  for the migration issues, not a research finding.
- **Naming convention decision left open.** Effect's own example uses kebab-case
  command names with a `Command.withAlias` shorthand (`10_basics.ts:113`), while
  this repo's tools are snake_case and its convention rule keeps ServiceNow-facing
  names snake_case verbatim (`AGENTS.md`, Conventions). Both work. Whether
  `query_table` or `query-table` is the command name — and whether the other is an
  alias — is a decision, not a fact I can look up.

## Reproducing this

Scratch installs used for this research, all outside the repo:

- `/tmp/effect-probe` — `effect@4.0.0-beta.107`, `@effect/platform-node@4.0.0-beta.107`,
  `typescript@5.9.3`; probe files `probe-cli.ts`, `probe-stderr2.ts`,
  `probe-config3.ts`, `probe-dotenv.ts`, `probe-service2.ts`, `probe-names.ts`.
- `/tmp/cli-churn` — unpacked tarballs of `effect@4.0.0-beta.90`, `beta.100`,
  and `rc.109` for source diffing.

Nothing in `/Users/P026886/coding/demo/mcp-server` was installed, modified, or
added to; no `package.json`, lockfile, or `node_modules` in the repo was touched.
Node v24.13.0.
