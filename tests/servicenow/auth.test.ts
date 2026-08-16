import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Cause, Effect, Exit, Layer, Option, Redacted } from "effect";

import {
  AliasFlag,
  formatDotEnvAnnouncement,
  isInsideSdkRefreshWindow,
  makeTokenSourceLayer,
  TokenSource,
  type AuthSdk,
} from "#src/servicenow/auth.ts";
import type { ResolvedConfig } from "#src/servicenow/config.ts";
import { SnAuthError } from "#src/servicenow/errors.ts";

const oauth = (expiresAt: number, accessToken = "cached", alias = "dev") => ({
  alias,
  isDefault: alias === "dev",
  creds: {
    type: "oauth" as const,
    instanceUrl: "https://x.service-now.com",
    access_token: accessToken,
    token_type: "Bearer",
    refresh_token: "r",
    expires_at: expiresAt,
  },
});

const baseSdk = (
  overrides: Partial<AuthSdk> & Pick<AuthSdk, "getStored">,
): AuthSdk => ({
  refreshAccessToken: async () => {
    throw new Error("should not refresh");
  },
  storeCredentials: async () => {
    throw new Error("should not store");
  },
  fetchCredentials: async () => new Map(),
  getClientCredentialsToken: async () => {
    throw new Error("should not mint client_credentials token");
  },
  ...overrides,
});

const aliasLayer = (value: Option.Option<string>) =>
  Layer.succeed(AliasFlag, value);

const runGet = (
  sdk: AuthSdk,
  config?: ResolvedConfig,
  alias: Option.Option<string> = Option.none(),
) =>
  Effect.runPromiseExit(
    Effect.flatMap(TokenSource, (t) => t.get()).pipe(
      Effect.provide(makeTokenSourceLayer(sdk, config)),
      Effect.provide(aliasLayer(alias)),
    ),
  );

const squashAuth = (exit: Exit.Exit<unknown, unknown>): SnAuthError => {
  assert.ok(Exit.isFailure(exit));
  const error = Exit.match(exit, {
    onSuccess: () => {
      throw new Error("expected failure");
    },
    onFailure: (cause) => Cause.squash(cause),
  });
  assert.ok(error instanceof SnAuthError);
  return error;
};

describe("TokenSource pre-flight", () => {
  it("treats tokens more than 15 minutes from expiry as outside the refresh window", () => {
    const now = 1_700_000_000;
    assert.equal(isInsideSdkRefreshWindow(now + 15 * 60 + 1, now), false);
    assert.equal(isInsideSdkRefreshWindow(now + 15 * 60, now), true);
    assert.equal(isInsideSdkRefreshWindow(now - 1, now), true);
  });

  it("returns the stored token without refreshing outside the window", async () => {
    let refreshCalls = 0;
    const exit = await runGet(
      baseSdk({
        getStored: async () => oauth(Math.floor(Date.now() / 1000) + 60 * 60),
        refreshAccessToken: async () => {
          refreshCalls++;
          throw new Error("should not refresh");
        },
      }),
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(Redacted.value(exit.value.accessToken), "cached");
    assert.equal(refreshCalls, 0);
  });

  it("refreshes inside the window and maps failure to SnAuthError", async () => {
    const exit = await runGet(
      baseSdk({
        getStored: async () => oauth(Math.floor(Date.now() / 1000) + 60),
        refreshAccessToken: async () => {
          throw new Error("refresh died");
        },
        storeCredentials: async () => undefined,
      }),
    );

    const error = squashAuth(exit);
    assert.match(error.message, /refresh died/);
    assert.match(error.message, /re-authenticate/i);
  });

  it("persists a successful refresh inside the window", async () => {
    const stored: { creds?: { access_token: string } } = {};
    const exit = await runGet(
      baseSdk({
        getStored: async () =>
          oauth(Math.floor(Date.now() / 1000) + 60, "stale"),
        refreshAccessToken: async () => ({
          access_token: "fresh",
          expires_at: Math.floor(Date.now() / 1000) + 1800,
        }),
        storeCredentials: async (_alias, creds) => {
          stored.creds = creds;
        },
      }),
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(Redacted.value(exit.value.accessToken), "fresh");
    assert.equal(stored.creds?.access_token, "fresh");
  });
});

describe("TokenSource alias and modes", () => {
  it("prefers --alias over SN_AUTH_ALIAS from config", async () => {
    const seen: { alias?: string } = {};
    const config: ResolvedConfig = {
      origin: { _tag: "env" },
      mode: "now-sdk",
      alias: Option.some("from-env"),
    };
    const exit = await runGet(
      baseSdk({
        getStored: async (alias) => {
          seen.alias = alias;
          return oauth(
            Math.floor(Date.now() / 1000) + 3600,
            "tok",
            alias ?? "default",
          );
        },
      }),
      config,
      Option.some("from-flag"),
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.alias, "from-flag");
  });

  it("lists available aliases when the Alias cannot be resolved", async () => {
    const exit = await runGet(
      baseSdk({
        getStored: async () => undefined,
        fetchCredentials: async () =>
          new Map([
            [
              "pdi",
              {
                isDefault: true,
                instanceUrl: "https://pdi.service-now.com",
                type: "oauth",
              },
            ],
            [
              "dev",
              {
                isDefault: false,
                instanceUrl: "https://dev.service-now.com",
                type: "oauth",
              },
            ],
          ]),
      }),
      undefined,
      Option.some("missing"),
    );

    const error = squashAuth(exit);
    assert.match(error.message, /Unknown Now SDK alias "missing"/);
    assert.match(error.message, /pdi \(default\)/);
    assert.match(error.message, /dev/);
    assert.match(error.message, /now-sdk:auth|auth --add/);
  });

  it("mints a client_credentials token without touching the Alias store", async () => {
    const config: ResolvedConfig = {
      origin: { _tag: "env" },
      mode: "client_credentials",
      instanceUrl: "https://cc.service-now.com",
      clientId: "id",
      clientSecret: Redacted.make("super-secret"),
    };
    const exit = await runGet(
      baseSdk({
        getStored: async () => {
          throw new Error("should not read Alias store");
        },
        getClientCredentialsToken: async (url, id, secret) => {
          assert.equal(url, "https://cc.service-now.com");
          assert.equal(id, "id");
          assert.equal(secret, "super-secret");
          return {
            access_token: "cc-tok",
            token_type: "Bearer",
            refresh_token: "",
            expires_at: Math.floor(Date.now() / 1000) + 1800,
          };
        },
      }),
      config,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(Redacted.value(exit.value.accessToken), "cc-tok");
    assert.equal(exit.value.instanceUrl, "https://cc.service-now.com");
  });

  it("keeps the client secret out of client_credentials error messages", async () => {
    const config: ResolvedConfig = {
      origin: { _tag: "env" },
      mode: "client_credentials",
      instanceUrl: "https://cc.service-now.com",
      clientId: "id",
      clientSecret: Redacted.make("super-secret"),
    };
    const exit = await runGet(
      baseSdk({
        getStored: async () => undefined,
        getClientCredentialsToken: async () => {
          throw new Error("server echoed super-secret in the body");
        },
      }),
      config,
    );

    const error = squashAuth(exit);
    assert.doesNotMatch(error.message, /super-secret/);
    assert.match(error.message, /<redacted>/);
  });
});

describe("formatDotEnvAnnouncement", () => {
  it("names the file path and instance host, never a secret", () => {
    assert.equal(
      formatDotEnvAnnouncement(
        "/Users/me/proj/.env",
        "https://dev123.service-now.com",
      ),
      "Using config from /Users/me/proj/.env (instance dev123.service-now.com)",
    );
  });
});
