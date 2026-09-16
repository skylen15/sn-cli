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
  type AliasPreview,
  type AuthSdk,
  type OauthCreds,
} from "#src/servicenow/auth.ts";
import { SnAuthError } from "#src/servicenow/errors.ts";

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
  readonly removeCalls: Array<string>;
};

const createMockSdk = (options?: {
  readonly existing?: ReadonlyMap<string, AliasPreview>;
  readonly removeError?: Error;
}): MockSdk => {
  const store = new Map<string, AliasPreview>(options?.existing ?? []);
  const removeCalls: Array<string> = [];

  const sdk: MockSdk["sdk"] = {
    fetchCredentials: async () => store,
    loginOAuth: async () => undefined,
    storeCredentials: async () => {},
    updateDefaultCredential: async () => {},
    removeCredentials: async (alias) => {
      if (options?.removeError) {
        throw options.removeError;
      }
      removeCalls.push(alias);
      store.delete(alias);
    },
  };

  return { sdk, store, removeCalls };
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

describe("auth remove", () => {
  it("is discoverable from auth group and leaf help", () => {
    const group = spawnSync(process.execPath, [CLI, "auth", "--help"], {
      encoding: "utf8",
    });
    assert.equal(group.status, 0, group.stderr);
    assert.match(group.stdout, /\bremove\b/);

    const leaf = spawnSync(process.execPath, [CLI, "auth", "remove", "--help"], {
      encoding: "utf8",
    });
    assert.equal(leaf.status, 0, leaf.stderr);
    assert.match(leaf.stdout, /remove/i);
    assert.match(leaf.stdout, /alias/i);
  });

  it("removes an allowed OAuth Alias and emits compact JSON", async () => {
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

    const exit = await run(["auth", "remove", "dev"], mock.sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "dev",
        removed: true,
      },
    ]);
    assert.deepEqual(mock.removeCalls, ["dev"]);
    assert.equal(mock.store.has("dev"), false);
  });

  it("removes a Blocked Instance Alias without error", async () => {
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

    const exit = await run(["auth", "remove", "prod"], mock.sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "prod",
        removed: true,
      },
    ]);
    assert.deepEqual(mock.removeCalls, ["prod"]);
  });

  it("removes a legacy Basic Alias without error", async () => {
    const writes: unknown[] = [];
    const mock = createMockSdk({
      existing: new Map([
        [
          "legacy-basic",
          {
            isDefault: false,
            instanceUrl: "https://dev12345.service-now.com",
            type: "basic",
          },
        ],
      ]),
    });

    const exit = await run(["auth", "remove", "legacy-basic"], mock.sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "legacy-basic",
        removed: true,
      },
    ]);
    assert.deepEqual(mock.removeCalls, ["legacy-basic"]);
  });

  it("removes the default Alias without setting another Alias as default", async () => {
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
        [
          "sandbox",
          {
            isDefault: false,
            instanceUrl: "https://sandbox12345.service-now.com",
            type: "oauth",
          },
        ],
      ]),
    });

    const exit = await run(["auth", "remove", "dev"], mock.sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        alias: "dev",
        removed: true,
      },
    ]);
    assert.deepEqual(mock.removeCalls, ["dev"]);
    assert.equal(mock.store.has("dev"), false);
    assert.equal(mock.store.get("sandbox")?.isDefault, false);
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

    const exit = await run(["auth", "remove", "nonexistent"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /Unknown Now SDK alias "nonexistent"/);
    assert.match(error.message, /Available aliases: dev \(default\)/);
    assert.deepEqual(writes, []);
    assert.equal(mock.removeCalls.length, 0);
  });

  it("maps keychain removal failures to SnAuthError exit 3", async () => {
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
      removeError: new Error("keychain lock timeout"),
    });

    const exit = await run(["auth", "remove", "dev"], mock.sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /keychain lock timeout/);
    assert.equal(
      error.hint,
      "Run `sn auth list` to verify whether the Alias remains before retrying: sn auth remove 'dev'.",
    );
    assert.deepEqual(writes, []);
  });
});
