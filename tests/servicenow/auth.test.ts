import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Cause, Effect, Exit, Layer, Option, Redacted, Runtime } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";

import {
  AliasFlag,
  assertInstanceAllowed,
  decideAliasSelection,
  isInsideSdkRefreshWindow,
  makeTokenSourceLayer,
  parseCanonicalHostname,
  setBlockedHostnames,
  TokenSource,
  YesFlag,
  type AuthSdk,
} from "#src/servicenow/auth.ts";
import { SnClient, snClientLayer } from "#src/servicenow/client.ts";
import {
  aliasConfirmLayer,
  type AliasConfirm as AliasConfirmType,
} from "#src/servicenow/confirm.ts";
import { SnAuthError, SnGuardError } from "#src/servicenow/errors.ts";

setBlockedHostnames(new Set(["blocked.service-now.com", "blocked-uat.service-now.com"]));
const oauth = (
  expiresAt: number,
  accessToken = "cached",
  alias = "dev",
  instanceUrl = "https://x.service-now.com",
) => ({
  alias,
  isDefault: alias === "dev",
  creds: {
    type: "oauth" as const,
    instanceUrl,
    access_token: accessToken,
    token_type: "Bearer",
    refresh_token: "r",
    expires_at: expiresAt,
  },
});

const baseSdk = (overrides: Partial<AuthSdk> & Pick<AuthSdk, "getStored">): AuthSdk => ({
  refreshAccessToken: async () => {
    throw new Error("should not refresh");
  },
  storeCredentials: async () => {
    throw new Error("should not store");
  },
  fetchCredentials: async () => new Map(),
  updateDefaultCredential: async () => {},
  removeCredentials: async () => {},
  ...overrides,
});

const aliasLayer = (value: Option.Option<string>) => Layer.succeed(AliasFlag, value);

const fetchLayer = (impl: typeof fetch): Layer.Layer<HttpClient.HttpClient> =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, impl)));

interface StoredCredentials {
  creds?: { access_token: string; instanceUrl?: string };
}

interface SeenAlias {
  alias?: string;
}

const runGet = (
  sdk: AuthSdk,
  options: {
    alias?: Option.Option<string>;
    yes?: boolean;
    confirm?: AliasConfirmType;
  } = {},
) =>
  Effect.runPromiseExit(
    Effect.flatMap(TokenSource, (t) => t.get()).pipe(
      Effect.provide(makeTokenSourceLayer(sdk)),
      Effect.provide(aliasLayer(options.alias ?? Option.none())),
      Effect.provide(Layer.succeed(YesFlag, options.yes ?? false)),
      Effect.provide(
        aliasConfirmLayer(
          options.confirm ?? {
            isTTY: false,
            readLine: Effect.succeed(""),
            writePrompt: () => Effect.void,
          },
        ),
      ),
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

const squashGuard = (exit: Exit.Exit<unknown, unknown>): SnGuardError => {
  assert.ok(Exit.isFailure(exit));
  const error = Exit.match(exit, {
    onSuccess: () => {
      throw new Error("expected failure");
    },
    onFailure: (cause) => Cause.squash(cause),
  });
  assert.ok(error instanceof SnGuardError);
  return error;
};

describe("parseCanonicalHostname and assertInstanceAllowed", () => {
  it("extracts canonical lowercase hostname with trailing dots removed", async () => {
    const exit1 = await Effect.runPromiseExit(
      parseCanonicalHostname("https://BLOCKED.service-now.com./"),
    );
    assert.ok(Exit.isSuccess(exit1));
    assert.equal(exit1.value, "blocked.service-now.com");

    const exit2 = await Effect.runPromiseExit(
      parseCanonicalHostname(
        "https://blocked-uat.service-now.com:8443/api/now/table/incident?sysparm_limit=1#hash",
      ),
    );
    assert.ok(Exit.isSuccess(exit2));
    assert.equal(exit2.value, "blocked-uat.service-now.com");
  });

  it("fails with SnAuthError exit code 3 on malformed URLs", async () => {
    const malformed = ["not-a-valid-url", "mailto:user@example.com", "http://"];
    for (const url of malformed) {
      const exit = await Effect.runPromiseExit(parseCanonicalHostname(url));
      const error = squashAuth(exit);
      assert.equal(error[Runtime.errorExitCode], 3);
      assert.match(error.message, /Malformed instance URL/i);
    }
  });

  it("assertInstanceAllowed rejects Blocked Instances with SnGuardError exit code 9", async () => {
    const exit = await Effect.runPromiseExit(
      assertInstanceAllowed("https://BLOCKED.service-now.com"),
    );
    const error = squashGuard(exit);
    assert.equal(error[Runtime.errorExitCode], 9);
    assert.match(error.message, /blocked\.service-now\.com/);
    assert.match(error.message, /no request was sent/i);
    assert.equal(error.hint, "Select an Alias for a non-blocked instance with `--alias <alias>`.");
  });
});

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
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /refresh died/);
    assert.match(error.message, /re-authenticate/i);
    assert.match(error.message, /sn auth add https:\/\/x\.service-now\.com --alias dev/);
    assert.equal(
      error.hint,
      "Run: sn auth remove 'dev'. Then run: sn auth add 'https://x.service-now.com' --alias 'dev'.",
    );
  });

  it("persists a successful refresh inside the window", async () => {
    const stored: StoredCredentials = {};
    const exit = await runGet(
      baseSdk({
        getStored: async () => oauth(Math.floor(Date.now() / 1000) + 60, "stale"),
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

describe("TokenSource Instance Guard", () => {
  it("rejects blocked.service-now.com before refresh with SnGuardError exit code 9", async () => {
    let refreshCalls = 0;
    const exit = await runGet(
      baseSdk({
        getStored: async () =>
          oauth(
            Math.floor(Date.now() / 1000) + 60,
            "cached",
            "prod",
            "https://blocked.service-now.com",
          ),
        refreshAccessToken: async () => {
          refreshCalls++;
          throw new Error("should never attempt refresh for blocked instance");
        },
      }),
    );

    const error = squashGuard(exit);
    assert.equal(error[Runtime.errorExitCode], 9);
    assert.match(error.message, /blocked\.service-now\.com/);
    assert.match(error.message, /no request was sent/i);
    assert.equal(refreshCalls, 0);
  });

  it("rejects blocked-uat.service-now.com before refresh with SnGuardError exit code 9", async () => {
    let refreshCalls = 0;
    const exit = await runGet(
      baseSdk({
        getStored: async () =>
          oauth(
            Math.floor(Date.now() / 1000) + 60,
            "cached",
            "uat",
            "https://blocked-uat.service-now.com",
          ),
        refreshAccessToken: async () => {
          refreshCalls++;
          throw new Error("should never attempt refresh for blocked instance");
        },
      }),
    );

    const error = squashGuard(exit);
    assert.equal(error[Runtime.errorExitCode], 9);
    assert.match(error.message, /blocked-uat\.service-now\.com/);
    assert.match(error.message, /no request was sent/i);
    assert.equal(refreshCalls, 0);
  });

  it("ignores case, trailing dots, ports, paths, and query parameters when matching Blocked Instances", async () => {
    const urls = [
      "https://BLOCKED.service-now.com",
      "https://blocked.service-now.com.",
      "https://blocked-uat.service-now.com:8443/api/now/table/incident?query=active=true",
    ];

    for (const url of urls) {
      const exit = await runGet(
        baseSdk({
          getStored: async () =>
            oauth(Math.floor(Date.now() / 1000) + 3600, "cached", "target", url),
        }),
      );

      const error = squashGuard(exit);
      assert.equal(error[Runtime.errorExitCode], 9);
      assert.match(error.message, /no request was sent/i);
    }
  });

  it("permits sibling and subdomain near-matches", async () => {
    const allowedUrls = [
      "https://blocked.service-now.com.au",
      "https://sub.blocked.service-now.com",
      "https://blocked-dev.service-now.com",
      "https://dev12345.service-now.com",
    ];

    for (const url of allowedUrls) {
      const exit = await runGet(
        baseSdk({
          getStored: async () =>
            oauth(Math.floor(Date.now() / 1000) + 3600, "valid-token", "allowed", url),
        }),
      );

      assert.ok(Exit.isSuccess(exit), `Expected ${url} to be allowed`);
      assert.equal(exit.value.instanceUrl, url);
    }
  });

  it("fails with SnAuthError exit code 3 when stored instance URL is malformed", async () => {
    const exit = await runGet(
      baseSdk({
        getStored: async () =>
          oauth(Math.floor(Date.now() / 1000) + 3600, "token", "bad-url", "not-a-valid-url"),
      }),
    );

    const error = squashAuth(exit);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /Malformed instance URL/i);
  });

  it("re-checks refreshed token before returning or storing", async () => {
    let storeCalls = 0;
    const exit = await runGet(
      baseSdk({
        getStored: async () =>
          oauth(
            Math.floor(Date.now() / 1000) + 60,
            "stale",
            "sneak",
            "https://allowed-dev.service-now.com",
          ),
        refreshAccessToken: async () => ({
          access_token: "refreshed-sneak",
          instanceUrl: "https://blocked.service-now.com",
          expires_at: Math.floor(Date.now() / 1000) + 1800,
        }),
        storeCredentials: async () => {
          storeCalls++;
        },
      }),
    );

    const error = squashGuard(exit);
    assert.equal(error[Runtime.errorExitCode], 9);
    assert.match(error.message, /blocked\.service-now\.com/);
    assert.match(error.message, /no request was sent/i);
    assert.equal(storeCalls, 0);
  });

  it("proves blocked paths make zero HTTP calls through the SnClient seam", async () => {
    let httpCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      httpCalls++;
      throw new Error("HTTP request should never be sent for blocked instance");
    };

    const sdk = baseSdk({
      getStored: async () =>
        oauth(
          Math.floor(Date.now() / 1000) + 3600,
          "cached",
          "prod",
          "https://blocked.service-now.com",
        ),
    });

    const exit = await Effect.gen(function* () {
      const client = yield* SnClient;
      return yield* client.request("/api/now/table/incident");
    }).pipe(
      Effect.provide(snClientLayer),
      Effect.provide(makeTokenSourceLayer(sdk)),
      Effect.provide(aliasLayer(Option.some("prod"))),
      Effect.provide(fetchLayer(fetchImpl)),
      Effect.runPromiseExit,
    );

    const error = squashGuard(exit);
    assert.equal(error[Runtime.errorExitCode], 9);
    assert.equal(httpCalls, 0);
  });
});

describe("TokenSource alias resolution", () => {
  it("resolves explicit --alias flag", async () => {
    const seen: SeenAlias = {};
    const exit = await runGet(
      baseSdk({
        getStored: async (alias) => {
          seen.alias = alias;
          return oauth(Math.floor(Date.now() / 1000) + 3600, "tok", alias ?? "default");
        },
      }),
      { alias: Option.some("from-flag") },
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.alias, "from-flag");
  });

  it("resolves SDK default when --alias flag is omitted", async () => {
    const seen: SeenAlias = {};
    const exit = await runGet(
      baseSdk({
        getStored: async (alias) => {
          seen.alias = alias;
          return oauth(Math.floor(Date.now() / 1000) + 3600, "tok", "default-alias");
        },
      }),
      { alias: Option.none() },
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.alias, undefined);
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
      { alias: Option.some("missing") },
    );

    const error = squashAuth(exit);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /Unknown Now SDK alias "missing"/);
    assert.match(error.message, /pdi \(default\)/);
    assert.match(error.message, /dev/);
    assert.match(error.message, /sn auth add/);
  });

  it("fails and reports available aliases when default was removed and implicit use is attempted", async () => {
    const exit = await runGet(
      baseSdk({
        getStored: async (alias) => {
          if (alias === undefined) {
            return undefined;
          }
          return undefined;
        },
        fetchCredentials: async () =>
          new Map([
            [
              "sandbox",
              {
                isDefault: false,
                instanceUrl: "https://sandbox.service-now.com",
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
      { alias: Option.none() },
    );

    const error = squashAuth(exit);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /No default Now SDK alias is set/);
    assert.match(error.message, /Available aliases: sandbox, dev/);
    assert.match(error.message, /sn auth add/);
    assert.doesNotMatch(error.message, /pnpm now-sdk:auth|now-sdk auth --add/);
  });

  it("fails with SnAuthError when stored Alias is not OAuth", async () => {
    const exit = await runGet(
      baseSdk({
        getStored: async (alias) => ({
          alias: alias ?? "basic-alias",
          isDefault: true,
          creds: { type: "basic" as const },
        }),
      }),
      { alias: Option.some("basic-alias") },
    );

    const error = squashAuth(exit);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /not OAuth/i);
    assert.match(error.message, /sn auth remove basic-alias/);
  });
});

describe("decideAliasSelection pure decision matrix", () => {
  it("explicit --alias always yields explicit regardless of TTY or yes", () => {
    const cases: Array<{ isTTY: boolean; yes: boolean }> = [
      { isTTY: true, yes: false },
      { isTTY: true, yes: true },
      { isTTY: false, yes: false },
      { isTTY: false, yes: true },
    ];

    for (const c of cases) {
      const decision = decideAliasSelection({
        explicitAlias: Option.some("my-alias"),
        ...c,
      });
      assert.deepEqual(decision, { _tag: "explicit", alias: "my-alias" });
    }
  });

  it("default alias in TTY prompts when yes is false", () => {
    assert.deepEqual(
      decideAliasSelection({
        explicitAlias: Option.none(),
        isTTY: true,
        yes: false,
      }),
      { _tag: "prompt" },
    );
  });

  it("default alias in TTY proceeds when yes is true", () => {
    assert.deepEqual(
      decideAliasSelection({
        explicitAlias: Option.none(),
        isTTY: true,
        yes: true,
      }),
      { _tag: "proceed" },
    );
  });

  it("default alias in non-TTY announces regardless of yes", () => {
    assert.deepEqual(
      decideAliasSelection({
        explicitAlias: Option.none(),
        isTTY: false,
        yes: false,
      }),
      { _tag: "announce" },
    );
    assert.deepEqual(
      decideAliasSelection({
        explicitAlias: Option.none(),
        isTTY: false,
        yes: true,
      }),
      { _tag: "announce" },
    );
  });
});

describe("TokenSource safe SDK default selection I/O", () => {
  const sdkWithDefault = baseSdk({
    getStored: async (alias) =>
      oauth(
        Math.floor(Date.now() / 1000) + 3600,
        "token-123",
        alias ?? "dev-default",
        "https://dev12345.service-now.com",
      ),
  });

  it("TTY invocation without --alias prompts and accepts 'y'", async () => {
    const prompts: string[] = [];
    const exit = await runGet(sdkWithDefault, {
      alias: Option.none(),
      yes: false,
      confirm: {
        isTTY: true,
        readLine: Effect.succeed("y"),
        writePrompt: (p) =>
          Effect.sync(() => {
            prompts.push(p);
          }),
      },
    });

    assert.ok(Exit.isSuccess(exit));
    assert.equal(exit.value.instanceUrl, "https://dev12345.service-now.com");
    assert.equal(prompts.length, 1);
    assert.match(prompts[0] ?? "", /dev-default/);
    assert.match(prompts[0] ?? "", /dev12345\.service-now\.com/);
  });

  it("TTY invocation accepts a normalized 'yes'", async () => {
    const exit = await runGet(sdkWithDefault, {
      alias: Option.none(),
      yes: false,
      confirm: {
        isTTY: true,
        readLine: Effect.succeed("YES "),
        writePrompt: () => Effect.void,
      },
    });

    assert.ok(Exit.isSuccess(exit));
  });

  it("TTY invocation without --alias rejects non-yes input with SnAuthError exit code 3 without refreshing", async () => {
    let refreshCalls = 0;
    const sdk = baseSdk({
      getStored: async (alias) =>
        oauth(
          Math.floor(Date.now() / 1000) + 60, // inside refresh window
          "token-123",
          alias ?? "dev-default",
          "https://dev12345.service-now.com",
        ),
      refreshAccessToken: async () => {
        refreshCalls++;
        return { access_token: "new-token" };
      },
    });

    const prompts: string[] = [];
    const exit = await runGet(sdk, {
      alias: Option.none(),
      yes: false,
      confirm: {
        isTTY: true,
        readLine: Effect.succeed("no"),
        writePrompt: (p) =>
          Effect.sync(() => {
            prompts.push(p);
          }),
      },
    });

    const error = squashAuth(exit);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /confirmation not accepted/i);
    assert.match(error.message, /--alias <alias>/);
    assert.equal(prompts.length, 1);
    assert.equal(refreshCalls, 0);
  });

  it("explicit --alias on TTY skips the default-Alias confirmation prompt", async () => {
    let promptCalls = 0;
    const exit = await runGet(sdkWithDefault, {
      alias: Option.some("custom-alias"),
      yes: false,
      confirm: {
        isTTY: true,
        readLine: Effect.succeed("n"), // would reject if prompted
        writePrompt: () =>
          Effect.sync(() => {
            promptCalls++;
          }),
      },
    });

    assert.ok(Exit.isSuccess(exit));
    assert.equal(promptCalls, 0);
  });

  it("TTY invocation without --alias rejects empty Enter key with SnAuthError exit code 3", async () => {
    const exit = await runGet(sdkWithDefault, {
      alias: Option.none(),
      yes: false,
      confirm: {
        isTTY: true,
        readLine: Effect.succeed(""),
        writePrompt: () => Effect.void,
      },
    });

    const error = squashAuth(exit);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /confirmation not accepted/i);
  });

  it("global --yes skips default-Alias confirmation in TTY", async () => {
    let promptCalls = 0;
    const exit = await runGet(sdkWithDefault, {
      alias: Option.none(),
      yes: true,
      confirm: {
        isTTY: true,
        readLine: Effect.succeed("n"), // would reject if asked
        writePrompt: () =>
          Effect.sync(() => {
            promptCalls++;
          }),
      },
    });

    assert.ok(Exit.isSuccess(exit));
    assert.equal(promptCalls, 0);
  });

  it("non-TTY invocation uses default Alias after announcing on stderr", async () => {
    const announcements: string[] = [];
    const exit = await runGet(sdkWithDefault, {
      alias: Option.none(),
      yes: false,
      confirm: {
        isTTY: false,
        readLine: Effect.succeed(""),
        writePrompt: (p) =>
          Effect.sync(() => {
            announcements.push(p);
          }),
      },
    });

    assert.ok(Exit.isSuccess(exit));
    assert.equal(announcements.length, 1);
    assert.match(announcements[0] ?? "", /dev-default/);
    assert.match(announcements[0] ?? "", /dev12345\.service-now\.com/);
  });

  it("explicit --alias remains subject to Instance Guard", async () => {
    const blockedSdk = baseSdk({
      getStored: async (alias) =>
        oauth(
          Math.floor(Date.now() / 1000) + 3600,
          "tok",
          alias ?? "blocked",
          "https://blocked.service-now.com",
        ),
    });

    const exit = await runGet(blockedSdk, {
      alias: Option.some("prod"),
      yes: true,
      confirm: {
        isTTY: true,
        readLine: Effect.succeed("y"),
        writePrompt: () => Effect.void,
      },
    });

    const error = squashGuard(exit);
    assert.equal(error[Runtime.errorExitCode], 9);
    assert.match(error.message, /blocked\.service-now\.com/);
  });
});
