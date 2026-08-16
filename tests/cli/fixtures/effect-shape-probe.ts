#!/usr/bin/env node
// A throwaway CLI exercising every Effect 4.0 shape the later tickets build on
// — nested subcommands, shared root flags, a service layer with a finalizer,
// Config with a Redacted secret from .env, a tagged error carrying its own
// exit code, and the stdout/stderr split. A version bump that breaks any of
// them fails here instead of somewhere deep inside a ServiceNow command.
//
// The runtime tail below duplicates src/cli.ts on purpose. Sharing it would
// make the probe assert that the entrypoint agrees with itself; copying it
// keeps the probe an independent statement of the shape Effect must support.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Cause,
  Config,
  ConfigProvider,
  Console,
  Context,
  Effect,
  Layer,
  Logger,
  Redacted,
  Runtime,
  Schema,
} from "effect";
import { Command, Flag } from "effect/unstable/cli";

class ProbeError extends Schema.TaggedError<ProbeError>()("ProbeError", {
  detail: Schema.String,
}) {
  readonly [Runtime.errorExitCode] = 7;
}

class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (name: string) => Effect.Effect<string, ProbeError> }
>()("probe/Greeter") {
  static readonly layer = Layer.effect(
    Greeter,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Console.error("probe released"));
      yield* Console.error("probe acquired");
      return Greeter.of({
        greet: (name) =>
          name === "boom"
            ? Effect.fail(new ProbeError({ detail: "asked to fail" }))
            : Effect.succeed(`hello ${name}`),
      });
    }),
  );
}

const probeSecret = Config.redacted("PROBE_SECRET").pipe(
  Config.withDefault(Redacted.make("unset")),
);

const greet = Command.make(
  "greet",
  { name: Flag.string("name") },
  Effect.fn(function* ({ name }) {
    const greeter = yield* Greeter;
    const greeting = yield* greeter.greet(name);
    const secret = yield* probeSecret;
    yield* Console.log(
      JSON.stringify({
        greeting,
        secret: String(secret),
        revealed: Redacted.value(secret),
      }),
    );
  }),
);

const explode = Command.make("explode", {}, () => Effect.die("kaboom"));

const probe = Command.make("probe").pipe(
  Command.withDescription("Effect 4.0 shape probe"),
  Command.withSharedFlags({
    tag: Flag.string("tag").pipe(Flag.withDefault("")),
  }),
);

const alpha = Command.make(
  "alpha",
  {},
  Effect.fn(function* () {
    const root = yield* probe;
    yield* Console.log(JSON.stringify({ leaf: "alpha", tag: root.tag }));
  }),
).pipe(Command.withDescription("Alpha leaf"));

const beta = Command.make(
  "beta",
  {},
  Effect.fn(function* () {
    const root = yield* probe;
    yield* Console.log(JSON.stringify({ leaf: "beta", tag: root.tag }));
  }),
).pipe(Command.withDescription("Beta leaf"));

const bundle = Command.make("bundle").pipe(
  Command.withDescription("Nested group for dispatch proof"),
  Command.withSubcommands([alpha, beta]),
);

probe.pipe(
  Command.withSubcommands([greet, explode, bundle]),
  Command.provide(Greeter.layer),
  Command.run({ version: "0.0.0-probe" }),
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause) ||
    !Runtime.getErrorReported(Cause.squash(cause))
      ? Effect.void
      : Console.error(Cause.pretty(cause)),
  ),
  Effect.provide(ConfigProvider.layerAdd(ConfigProvider.fromDotEnv())),
  Effect.provide(NodeServices.layer),
  Effect.provideService(Logger.LogToStderr, true),
  (effect) => NodeRuntime.runMain(effect, { disableErrorReporting: true }),
);
