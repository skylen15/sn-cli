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
  readonly sdk: Pick<
    AuthSdk,
    "fetchCredentials" | "storeCredentials" | "updateDefaultCredential" | "removeCredentials"
  > & {
    readonly loginOAuth: (instanceUrl: string) => Promise<OauthCreds | undefined>;
    readonly updateDefaultCredential: (alias: string) => Promise<void>;
    readonly removeCredentials: (alias: string) => Promise<void>;
  };
  readonly store: Map<string, AliasPreview>;
  readonly updateCalls: Array<string>;
};

const createMockSdk = (options?: {
  readonly existing?: ReadonlyMap<string, AliasPreview>;
  readonly updateError?: Error;
}): MockSdk => {
  const store = new Map<string, AliasPreview>(options?.existing ?? []);
  const updateCalls: Array<string> = [];

  const sdk: MockSdk["sdk"] = {
    fetchCredentials: async () => store,
    loginOAuth: async () => undefined,
    storeCredentials: async () => {},
    removeCredentials: async () => {},
    updateDefaultCredential: async (alias) => {
      if (options?.updateError) {
        throw options.updateError;
      }
      updateCalls.push(alias);
      for (const [key, val] of store.entries()) {
        store.set(key, { ...val, isDefault: key === alias });
      }
    },
  };

  return { sdk, store, updateCalls };
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

describe("auth use", () => {
  it("is discoverable from auth group and leaf help", () => {
    const group = spawnSync(process.execPath, [CLI, "auth", "--help"], {
      encoding: "utf8",
    });
    assert.equal(group.status, 0, group.stderr);
    assert.match(group.stdout, /\buse\b/);

    const leaf = spawnSync(process.execPath, [CLI, "auth", "use", "--help"], {
      encoding: "utf8",
    });
    assert.equal(leaf.status, 0, leaf.stderr);
    assert.match(leaf.stdout, /default/i);
    assert.match(leaf.stdout, /alias/i);
  });

  it("sets an existing allowed OAuth Alias as default and emits compact JSON", async () => {
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
        [
          "test",
          {
            isDefault: true,
            instanceUrl: "https://test12345.service-now.com",
            type: "oauth",
          },
        ],
      ]),
    });

    const exit = await run(["auth", "use", "dev"], mock.sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "dev",
        instanceUrl: "https://dev12345.service-now.com",
        isDefault: true,
      },
    ]);
    assert.deepEqual(mock.updateCalls, ["dev"]);
    assert.equal(mock.store.get("dev")?.isDefault, true);
    assert.equal(mock.store.get("test")?.isDefault, false);
  });

  it("succeeds when designating an alias that is already default", async () => {
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

    const exit = await run(["auth", "use", "dev"], mock.sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "dev",
        instanceUrl: "https://dev12345.service-now.com",
        isDefault: true,
      },
    ]);
    assert.deepEqual(mock.updateCalls, ["dev"]);
  });

  it("rejects unknown Alias with SnAuthError exit 3 and lists available aliases", async () => {
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

    const exit = await run(["auth", "use", "nonexistent"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /Unknown Now SDK alias "nonexistent"/);
    assert.match(error.message, /Available aliases: dev \(default\)/);
    assert.deepEqual(writes, []);
    assert.equal(mock.updateCalls.length, 0);
  });

  it("rejects Basic Alias without changing default", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk({
      existing: new Map([
        [
          "legacy",
          {
            isDefault: false,
            instanceUrl: "https://dev12345.service-now.com",
            type: "basic",
          },
        ],
      ]),
    });

    const exit = await run(["auth", "use", "legacy"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /not an OAuth alias/i);
    assert.deepEqual(writes, []);
    assert.equal(mock.updateCalls.length, 0);
  });

  it("rejects Blocked Instance Alias with SnGuardError exit 9 without changing default", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk({
      existing: new Map([
        [
          "prod",
          {
            isDefault: false,
            instanceUrl: "https://blocked.service-now.com",
            type: "oauth",
          },
        ],
      ]),
    });

    const exit = await run(["auth", "use", "prod"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnGuardError);
    assert.equal(error[Runtime.errorExitCode], 9);
    assert.match(error.message, /blocked by policy; no request was sent/);
    assert.deepEqual(writes, []);
    assert.equal(mock.updateCalls.length, 0);
  });

  it("rejects malformed instance URL with SnAuthError exit 3", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk({
      existing: new Map([
        [
          "corrupt",
          {
            isDefault: false,
            instanceUrl: "not-a-url",
            type: "oauth",
          },
        ],
      ]),
    });

    const exit = await run(["auth", "use", "corrupt"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /Malformed instance URL/i);
    assert.deepEqual(writes, []);
    assert.equal(mock.updateCalls.length, 0);
  });

  it("maps keychain update failures to SnAuthError exit 3", async () => {
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
      updateError: new Error("keychain lock timeout"),
    });

    const exit = await run(["auth", "use", "dev"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /keychain lock timeout/);
    assert.deepEqual(writes, []);
  });
});
