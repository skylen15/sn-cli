import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Cause, Deferred, Effect, Exit, Fiber, Layer, Redacted, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";

import { TokenSource } from "#src/servicenow/auth.ts";
import { SnClient, snClientLayer, type Token } from "#src/servicenow/client.ts";
import { SnAuthError, SnRequestError } from "#src/servicenow/errors.ts";

const ok = (body: Schema.Json) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const fail = (status: number, body: Schema.Json = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const tok = (accessToken: string): Token => ({
  instanceUrl: "https://x.service-now.com",
  accessToken: Redacted.make(accessToken),
});

const tokenSource = (
  tokens: ReadonlyArray<Token>,
  calls: { n: number },
): Layer.Layer<TokenSource> => {
  let i = 0;
  return Layer.succeed(
    TokenSource,
    TokenSource.of({
      get: () =>
        Effect.sync(() => {
          calls.n++;
          const index = Math.min(i++, tokens.length - 1);
          const token = tokens[index];
          if (token === undefined) {
            throw new Error("tokenSource fixture exhausted");
          }
          return token;
        }),
    }),
  );
};

const fetchLayer = (impl: typeof fetch): Layer.Layer<HttpClient.HttpClient> =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, impl)));

const run = <A, E>(
  tokens: ReadonlyArray<Token>,
  fetchImpl: typeof fetch,
  body: Effect.Effect<A, E, SnClient>,
  calls = { n: 0 },
) =>
  body.pipe(
    Effect.provide(snClientLayer),
    Effect.provide(tokenSource(tokens, calls)),
    Effect.provide(fetchLayer(fetchImpl)),
    Effect.runPromiseExit,
  );

interface SeenRequest {
  url?: string;
  auth?: string | null;
}

describe("SnClient auth seam", () => {
  it("sends bearer token and returns the parsed body", async () => {
    const seen: SeenRequest = {};
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.url = String(url);
      seen.auth = new Headers(init?.headers).get("authorization");
      return ok({ result: [{ number: "INC001" }] });
    };

    const exit = await run(
      [tok("tok1")],
      fetchImpl,
      Effect.gen(function* () {
        const client = yield* SnClient;
        return yield* client.request("/api/now/table/incident", {
          sysparm_limit: "1",
        });
      }),
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value, { result: [{ number: "INC001" }] });
    assert.equal(seen.url, "https://x.service-now.com/api/now/table/incident?sysparm_limit=1");
    assert.equal(seen.auth, "Bearer tok1");
  });

  it("retries once on 401 when the token source returns a different token", async () => {
    const used: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      used.push(auth);
      return auth === "Bearer fresh" ? ok({ result: [] }) : fail(401);
    };

    const calls = { n: 0 };
    const exit = await run(
      [tok("stale"), tok("fresh")],
      fetchImpl,
      Effect.gen(function* () {
        const client = yield* SnClient;
        return yield* client.request("/api/now/table/incident");
      }),
      calls,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value, { result: [] });
    assert.deepEqual(used, ["Bearer stale", "Bearer fresh"]);
    assert.equal(calls.n, 2);
  });

  it("fails immediately when a 401 refresh returns the same token", async () => {
    const fetchImpl: typeof fetch = async () => fail(401);
    const calls = { n: 0 };

    const exit = await run(
      [tok("same"), tok("same")],
      fetchImpl,
      Effect.gen(function* () {
        const client = yield* SnClient;
        return yield* client.request("/api/now/table/incident");
      }),
      calls,
    );

    assert.ok(Exit.isFailure(exit));
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    });
    assert.ok(error instanceof SnAuthError);
    assert.match(error.message, /probably revoked/i);
    assert.match(error.message, /sn auth remove/);
    assert.equal(
      error.hint,
      "Run `sn auth remove <alias>`, then `sn auth add <https-origin> --alias <alias>`.",
    );
    assert.equal(calls.n, 2, "initial token + one refresh attempt");
  });

  it("keeps a valid error message when detail is null", async () => {
    const exit = await run(
      [tok("tok1")],
      async () => fail(403, { error: { message: "Access denied", detail: null } }),
      Effect.gen(function* () {
        const client = yield* SnClient;
        return yield* client.request("/api/now/table/incident");
      }),
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnRequestError);
    assert.equal(error.message, "Access denied");
    assert.equal(error.detail, undefined);
    assert.equal(error.status, 403);
    assert.equal(error.hint, undefined);
  });

  it("keeps a valid error detail when message is malformed", async () => {
    const exit = await run(
      [tok("tok1")],
      async () => fail(500, { error: { message: 42, detail: "Specific failure" } }),
      Effect.gen(function* () {
        const client = yield* SnClient;
        return yield* client.request("/api/now/table/incident");
      }),
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnRequestError);
    assert.equal(error.message, "Specific failure");
    assert.equal(error.detail, "Specific failure");
    assert.equal(error.status, 500);
  });

  it("collapses concurrent missing-token callers into one refresh", async () => {
    const calls = { n: 0 };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const slowTokens = Layer.succeed(
          TokenSource,
          TokenSource.of({
            get: () =>
              Effect.gen(function* () {
                calls.n++;
                yield* Deferred.await(gate);
                return tok("shared");
              }),
          }),
        );

        const fetchImpl: typeof fetch = async () => ok({ result: [] });

        const body = Effect.gen(function* () {
          const client = yield* SnClient;
          return yield* Effect.all(
            [
              client.request("/api/now/table/incident"),
              client.request("/api/now/table/incident"),
              client.request("/api/now/table/incident"),
            ],
            { concurrency: "unbounded" },
          );
        }).pipe(
          Effect.provide(snClientLayer),
          Effect.provide(slowTokens),
          Effect.provide(fetchLayer(fetchImpl)),
        );

        const fiber = yield* Effect.forkChild(body);
        yield* Effect.sleep("30 millis");
        assert.equal(calls.n, 1, "only one refresh in flight while gated");
        yield* Deferred.succeed(gate, undefined);
        return yield* Fiber.join(fiber);
      }),
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(calls.n, 1);
  });
});
