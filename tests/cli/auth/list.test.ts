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
  type AuthSdk,
  type OauthCreds,
} from "#src/servicenow/auth.ts";
import { SnAuthError } from "#src/servicenow/errors.ts";

setBlockedHostnames(new Set(["blocked.service-now.com", "blocked-uat.service-now.com"]));
const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));

const run = (
  args: ReadonlyArray<string>,
  sdk: Pick<AuthSdk, "fetchCredentials">,
  writes: Array<unknown>,
) => {
  const fullSdk: Pick<
    AuthSdk,
    "fetchCredentials" | "storeCredentials" | "updateDefaultCredential" | "removeCredentials"
  > & {
    readonly loginOAuth: (instanceUrl: string) => Promise<OauthCreds | undefined>;
    readonly updateDefaultCredential: (alias: string) => Promise<void>;
    readonly removeCredentials: (alias: string) => Promise<void>;
  } = {
    fetchCredentials: sdk.fetchCredentials,
    loginOAuth: async () => undefined,
    storeCredentials: async () => {},
    updateDefaultCredential: async () => {},
    removeCredentials: async () => {},
  };
  return Effect.runPromiseExit(
    Command.runWith(
      snRoot.pipe(
        Command.withSubcommands([
          auth.pipe(
            Command.provide(Layer.merge(makeAliasInventoryLayer(fullSdk), emitCapture(writes))),
          ),
        ]),
      ),
      { version: "0.0.0-test", renderErrors: false },
    )(["auth", ...args]).pipe(Effect.provide(NodeServices.layer)),
  );
};

describe("auth list", () => {
  it("is discoverable from auth group and leaf help", () => {
    const group = spawnSync(process.execPath, [CLI, "auth", "--help"], {
      encoding: "utf8",
    });
    assert.equal(group.status, 0, group.stderr);
    assert.match(group.stdout, /\blist\b/);

    const leaf = spawnSync(process.execPath, [CLI, "auth", "list", "--help"], {
      encoding: "utf8",
    });
    assert.equal(leaf.status, 0, leaf.stderr);
    assert.match(leaf.stdout, /without exposing credential material/);
  });

  it("returns only secret-free details for OAuth, Basic, allowed, and Blocked Aliases", async () => {
    const writes: unknown[] = [];
    const sdk = {
      fetchCredentials: async () =>
        new Map([
          [
            "dev",
            {
              isDefault: true,
              instanceUrl: "https://dev12345.service-now.com",
              type: "oauth",
              access_token: "must-not-leak",
              refresh_token: "must-not-leak",
            },
          ],
          [
            "legacy-basic",
            {
              isDefault: false,
              instanceUrl: "https://legacy.service-now.com",
              type: "basic",
              username: "must-not-leak",
              password: "must-not-leak",
            },
          ],
          [
            "production",
            {
              isDefault: false,
              instanceUrl: "https://BLOCKED.service-now.com./",
              type: "oauth",
              access_token: "must-not-leak",
            },
          ],
        ]),
    } satisfies Pick<AuthSdk, "fetchCredentials">;

    const exit = await run(["list"], sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      [
        {
          alias: "dev",
          instanceUrl: "https://dev12345.service-now.com",
          isDefault: true,
          type: "oauth",
          blocked: false,
        },
        {
          alias: "legacy-basic",
          instanceUrl: "https://legacy.service-now.com",
          isDefault: false,
          type: "basic",
          blocked: false,
        },
        {
          alias: "production",
          instanceUrl: "https://BLOCKED.service-now.com./",
          isDefault: false,
          type: "oauth",
          blocked: true,
        },
      ],
    ]);
  });

  it("returns an empty array without default selection, prompting, or instance services", async () => {
    const writes: unknown[] = [];
    const sdk = {
      fetchCredentials: async () => new Map(),
    } satisfies Pick<AuthSdk, "fetchCredentials">;

    // Only the local inventory adapter and output capture are provided. Adding
    // TokenSource, SnClient, or AliasConfirm I/O would make this run fail.
    const exit = await run(["list"], sdk, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [[]]);
  });

  it("maps keychain failures to SnAuthError and leaves output empty", async () => {
    const writes: unknown[] = [];
    const sdk = {
      fetchCredentials: async () => {
        throw new Error("keychain locked");
      },
    } satisfies Pick<AuthSdk, "fetchCredentials">;

    const exit = await run(["list"], sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /keychain locked/);
    assert.equal(error.hint, "Resolve keychain access, then retry the auth command.");
    assert.deepEqual(writes, []);
  });

  it("maps a malformed stored instance URL to SnAuthError and leaves output empty", async () => {
    const writes: unknown[] = [];
    const sdk = {
      fetchCredentials: async () =>
        new Map([
          [
            "broken",
            {
              isDefault: false,
              instanceUrl: "not a URL",
              type: "oauth",
            },
          ],
        ]),
    } satisfies Pick<AuthSdk, "fetchCredentials">;

    const exit = await run(["list"], sdk, writes);

    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof SnAuthError);
    assert.equal(error[Runtime.errorExitCode], 3);
    assert.match(error.message, /Malformed instance URL/);
    assert.deepEqual(writes, []);
  });
});
