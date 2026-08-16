import { Console, Context, Effect, Layer } from "effect";

/**
 * Single stdout writer for command results. Handlers produce a value and hand
 * it to {@link emitJson} / {@link emitText}; the entrypoint provides the live
 * layer. Tests substitute a capturing layer — no fake Stdio required.
 */
export class Emit extends Context.Service<
  Emit,
  {
    readonly json: (value: unknown) => Effect.Effect<void>;
    readonly text: (value: string) => Effect.Effect<void>;
  }
>()("sn/Emit") {}

/** Hand a structured command result to the Emit service (compact JSON). */
export const emitJson = (value: unknown): Effect.Effect<void, never, Emit> =>
  Effect.flatMap(Emit, (emit) => emit.json(value));

/** Hand a human-readable summary to the Emit service (raw text on stdout). */
export const emitText = (value: string): Effect.Effect<void, never, Emit> =>
  Effect.flatMap(Emit, (emit) => emit.text(value));

/** Live Emit: compact JSON or raw text on stdout. */
export const emitLive = Layer.succeed(
  Emit,
  Emit.of({
    json: (value) => Console.log(JSON.stringify(value)),
    text: (value) => Console.log(value),
  }),
);

/** Test Emit: push values into `writes` instead of printing. */
export const emitCapture = (writes: Array<unknown>): Layer.Layer<Emit> =>
  Layer.succeed(
    Emit,
    Emit.of({
      json: (value) =>
        Effect.sync(() => {
          writes.push(value);
        }),
      text: (value) =>
        Effect.sync(() => {
          writes.push(value);
        }),
    }),
  );
