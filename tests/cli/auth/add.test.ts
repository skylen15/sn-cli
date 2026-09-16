import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import { auth } from "#src/commands/auth.ts";
import { emitCapture } from "#src/emit.ts";
import { sn as snRoot } from "#src/root.ts";
import {
  makeAliasInventoryLayer,
  setBlockedHostnames,
  type AliasPreview,
  type AuthSdk,
  type OauthCreds,
} from "#src/servicenow/auth.ts";
import { SnAuthError, SnGuardError } from "#src/servicenow/errors.ts";

setBlockedHostnames(new Set(["blocked.service-now.com", "blocked-uat.service-now.com"]));
const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));

type MockSdk = {
  readonly sdk: Pick<AuthSdk, "fetchCredentials"> &
    Required<
      Pick<
        AuthSdk,
        "loginOAuth" | "storeCredentials" | "updateDefaultCredential" | "removeCredentials"
      >
    >;
  readonly loginCalls: Array<string>;
  readonly storeCalls: Array<{
    alias: string;
    instanceUrl: string;
    isDefault: boolean;
  }>;
};

const createMockSdk = (options?: {
  readonly existing?: ReadonlyMap<string, AliasPreview>;
  readonly loginResult?:
    | {
        access_token: string;
        expires_at: number;
        token_type?: string;
        refresh_token?: string;
      }
    | undefined;
}): MockSdk => {
  const loginCalls: Array<string> = [];
  const storeCalls: Array<{
    alias: string;
    instanceUrl: string;
    isDefault: boolean;
  }> = [];

  const sdk: MockSdk["sdk"] = {
    fetchCredentials: async () => options?.existing ?? new Map(),
    loginOAuth: async (instanceUrl) => {
      loginCalls.push(instanceUrl);
      if (options?.loginResult === undefined && options && "loginResult" in options) {
        return undefined;
      }
      return {
        type: "oauth",
        instanceUrl,
        access_token: options?.loginResult?.access_token ?? "test-access-token",
        token_type: options?.loginResult?.token_type ?? "Bearer",
        refresh_token: options?.loginResult?.refresh_token ?? "test-refresh-token",
        expires_at: options?.loginResult?.expires_at ?? 9999999999,
      };
    },
    storeCredentials: async (alias, creds, isDefault) => {
      storeCalls.push({ alias, instanceUrl: creds.instanceUrl, isDefault });
    },
    updateDefaultCredential: async () => {},
    removeCredentials: async () => {},
  };

  return { sdk, loginCalls, storeCalls };
};

const run = (args: ReadonlyArray<string>, sdk: MockSdk["sdk"], writes: Array<unknown>) =>
  Effect.runPromiseExit(
    Command.runWith(
      snRoot.pipe(
        Command.withSubcommands([
          auth.pipe(
            Command.provide(Layer.merge(makeAliasInventoryLayer(sdk), emitCapture(writes))),
          ),
        ]),
      ),
      { version: "0.0.0-test", renderErrors: false },
    )(args).pipe(Effect.provide(NodeServices.layer)),
  );

describe("auth add", () => {
  it("is discoverable from auth group and leaf help", () => {
    const group = spawnSync(process.execPath, [CLI, "auth", "--help"], {
      encoding: "utf8",
    });
    assert.equal(group.status, 0, group.stderr);
    assert.match(group.stdout, /\badd\b/);

    const leaf = spawnSync(process.execPath, [CLI, "auth", "add", "--help"], {
      encoding: "utf8",
    });
    assert.equal(leaf.status, 0, leaf.stderr);
    assert.match(leaf.stdout, /OAuth Alias/i);
    assert.match(leaf.stdout, /instance-url/);
    assert.match(leaf.stdout, /--alias/);
  });

  it("adds the first Alias as default and emits compact JSON", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();

    const exit = await run(
      ["auth", "add", "https://dev12345.service-now.com/", "--alias", "dev"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "dev",
        instanceUrl: "https://dev12345.service-now.com",
        isDefault: true,
      },
    ]);
    assert.deepEqual(mock.loginCalls, ["https://dev12345.service-now.com"]);
    assert.deepEqual(mock.storeCalls, [
      {
        alias: "dev",
        instanceUrl: "https://dev12345.service-now.com",
        isDefault: true,
      },
    ]);
  });

  it("preserves the existing default when adding a later Alias", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk({
      existing: new Map([
        [
          "dev",
          {
            isDefault: true,
            instanceUrl: "https://dev12345.service-now.com",
            type: "oauth",
          },
        ],
      ]),
    });

    const exit = await run(
      ["auth", "add", "https://sandbox12345.service-now.com", "--alias", "sandbox"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "sandbox",
        instanceUrl: "https://sandbox12345.service-now.com",
        isDefault: false,
      },
    ]);
    assert.deepEqual(mock.loginCalls, ["https://sandbox12345.service-now.com"]);
    assert.deepEqual(mock.storeCalls, [
      {
        alias: "sandbox",
        instanceUrl: "https://sandbox12345.service-now.com",
        isDefault: false,
      },
    ]);
  });

  it("designates as default when existing Aliases have no default", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk({
      existing: new Map([
        [
          "dev",
          {
            isDefault: false,
            instanceUrl: "https://dev12345.service-now.com",
            type: "oauth",
          },
        ],
      ]),
    });

    const exit = await run(
      ["auth", "add", "https://sandbox12345.service-now.com", "--alias", "sandbox"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "sandbox",
        instanceUrl: "https://sandbox12345.service-now.com",
        isDefault: true,
      },
    ]);
    assert.deepEqual(mock.storeCalls, [
      {
        alias: "sandbox",
        instanceUrl: "https://sandbox12345.service-now.com",
        isDefault: true,
      },
    ]);
  });

  it("rejects non-HTTPS URLs before OAuth or keychain writes", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();

    const exit = await run(
      ["auth", "add", "http://dev12345.service-now.com", "--alias", "dev"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /HTTPS scheme/i);
    assert.deepEqual(writes, []);
    assert.equal(mock.loginCalls.length, 0);
    assert.equal(mock.storeCalls.length, 0);
  });

  it("rejects URLs with credentials before OAuth or keychain writes", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();

    const exit = await run(
      ["auth", "add", "https://admin:secret@dev12345.service-now.com", "--alias", "dev"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /credentials/i);
    assert.deepEqual(writes, []);
    assert.equal(mock.loginCalls.length, 0);
    assert.equal(mock.storeCalls.length, 0);
  });

  it("rejects URLs with non-root paths before OAuth or keychain writes", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();

    const exit = await run(
      ["auth", "add", "https://dev12345.service-now.com/api/now/table", "--alias", "dev"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /path/i);
    assert.deepEqual(writes, []);
    assert.equal(mock.loginCalls.length, 0);
    assert.equal(mock.storeCalls.length, 0);
  });

  it("rejects URLs with query or fragment before OAuth or keychain writes", async () => {
    const writesQuery: unknown[] = [];
    const mockQuery = createMockSdk();

    const exitQuery = await run(
      ["auth", "add", "https://dev12345.service-now.com?foo=bar", "--alias", "dev"],
      mockQuery.sdk,
      writesQuery,
    );

    assert.ok(Exit.isFailure(exitQuery));
    const errorQuery = Cause.squash(exitQuery.cause);
    assert.ok(errorQuery instanceof SnAuthError);
    assert.match(errorQuery.message, /query/i);
    assert.equal(mockQuery.loginCalls.length, 0);

    const writesHash: unknown[] = [];
    const mockHash = createMockSdk();

    const exitHash = await run(
      ["auth", "add", "https://dev12345.service-now.com#section", "--alias", "dev"],
      mockHash.sdk,
      writesHash,
    );

    assert.ok(Exit.isFailure(exitHash));
    const errorHash = Cause.squash(exitHash.cause);
    assert.ok(errorHash instanceof SnAuthError);
    assert.match(errorHash.message, /fragment/i);
    assert.equal(mockHash.loginCalls.length, 0);
  });

  it("rejects malformed URLs before OAuth or keychain writes", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();

    const exit = await run(["auth", "add", "not-a-valid-url", "--alias", "dev"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /malformed/i);
    assert.deepEqual(writes, []);
    assert.equal(mock.loginCalls.length, 0);
    assert.equal(mock.storeCalls.length, 0);
  });

  it("rejects Blocked Instances before OAuth or keychain writes with SnGuardError exit 9", async () => {
    for (const blockedUrl of [
      "https://blocked.service-now.com",
      "https://BLOCKED.service-now.com./",
      "https://blocked-uat.service-now.com/",
    ]) {
      const writes: unknown[] = [];
      const mock = createMockSdk();
      const exit = await run(["auth", "add", blockedUrl, "--alias", "blocked"], mock.sdk, writes);

      assert.ok(Exit.isFailure(exit), `expected failure for ${blockedUrl}`);
      const error = Cause.squash(exit.cause);
      assert.ok(error instanceof SnGuardError);
      assert.equal(error[Runtime.errorExitCode], 9);
      assert.match(error.message, /blocked by policy; no request was sent/);
      assert.equal(error.hint, "Choose a non-blocked ServiceNow instance origin.");
      assert.deepEqual(writes, []);
      assert.equal(mock.loginCalls.length, 0);
      assert.equal(mock.storeCalls.length, 0);
    }
  });

  it("rejects an existing Alias with remediation guidance before OAuth", async () => {
    for (const { alias, hint } of [
      {
        alias: "dev",
        hint: "Run: sn auth remove 'dev'. Then retry: sn auth add 'https://other.service-now.com' --alias 'dev'.",
      },
      {
        alias: "dev'`; echo pwn",
        hint: "Run: sn auth remove 'dev'\\''`; echo pwn'. Then retry: sn auth add 'https://other.service-now.com' --alias 'dev'\\''`; echo pwn'.",
      },
    ]) {
      const writes: unknown[] = [];
      const mock = createMockSdk({
        existing: new Map([
          [
            alias,
            {
              isDefault: true,
              instanceUrl: "https://dev12345.service-now.com",
              type: "oauth",
            },
          ],
        ]),
      });

      const exit = await run(
        ["auth", "add", "https://other.service-now.com", "--alias", alias],
        mock.sdk,
        writes,
      );

      assert.ok(Exit.isFailure(exit));
      const error = Cause.squash(exit.cause);
      assert.ok(error instanceof SnAuthError);
      assert.equal(error[Runtime.errorExitCode], 3);
      assert.equal(
        error.message,
        `Alias "${alias}" already exists. Run \`sn auth remove ${alias}\` before retrying.`,
      );
      assert.equal(error.hint, hint);
      assert.deepEqual(writes, []);
      assert.equal(mock.loginCalls.length, 0);
      assert.equal(mock.storeCalls.length, 0);
    }
  });

  it("rejects missing or empty --alias before OAuth", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();

    const exitMissing = await run(
      ["auth", "add", "https://dev12345.service-now.com"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isFailure(exitMissing));
    const errorMissing = Cause.squash(exitMissing.cause);
    assert.ok(errorMissing instanceof SnAuthError);
    assert.equal(errorMissing[Runtime.errorExitCode], 3);
    assert.match(errorMissing.message, /alias/i);
    assert.equal(mock.loginCalls.length, 0);

    const exitEmpty = await run(
      ["auth", "add", "https://dev12345.service-now.com", "--alias", "   "],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isFailure(exitEmpty));
    const errorEmpty = Cause.squash(exitEmpty.cause);
    assert.ok(errorEmpty instanceof SnAuthError);
    assert.equal(errorEmpty[Runtime.errorExitCode], 3);
    assert.equal(mock.loginCalls.length, 0);
  });

  it("handles OAuth login cancellation or failure by returning SnAuthError exit 3 with empty stdout", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk({ loginResult: undefined });

    const exit = await run(
      ["auth", "add", "https://dev12345.service-now.com", "--alias", "dev"],
      mock.sdk,
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /OAuth login failed or was cancelled/);
    assert.deepEqual(writes, []);
    assert.equal(mock.loginCalls.length, 1);
    assert.equal(mock.storeCalls.length, 0);
  });

  it("handles OAuth login rejection by returning SnAuthError exit 3 with empty stdout", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();
    const rejectingSdk: MockSdk["sdk"] = {
      ...mock.sdk,
      loginOAuth: async () => {
        throw new Error("network reset during OAuth");
      },
    };

    const exit = await run(
      ["auth", "add", "https://dev12345.service-now.com", "--alias", "dev"],
      rejectingSdk,
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /OAuth login failed for.*network reset/);
    assert.deepEqual(writes, []);
  });

  it("handles storeCredentials rejection by returning SnAuthError exit 3 with empty stdout", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk();
    const failingStoreSdk: MockSdk["sdk"] = {
      ...mock.sdk,
      storeCredentials: async () => {
        throw new Error("keychain lock timeout");
      },
    };

    const exit = await run(
      ["auth", "add", "https://dev12345.service-now.com", "--alias", "dev"],
      failingStoreSdk,
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /Failed to store credentials.*keychain lock/);
    assert.equal(
      error.hint,
      "Run `sn auth list` to verify whether the Alias was stored before retrying: sn auth add 'https://dev12345.service-now.com' --alias 'dev'.",
    );
    assert.deepEqual(writes, []);
  });
});
