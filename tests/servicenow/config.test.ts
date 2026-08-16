import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { NodeFileSystem } from "@effect/platform-node";
import { Cause, ConfigProvider, Effect, Exit, Option, Redacted } from "effect";

import { findDotEnv, resolveConfig } from "#src/servicenow/config.ts";
import { SnAuthError } from "#src/servicenow/errors.ts";

const touchEnv = async (dir: string, body = "SN_AUTH_TYPE=now-sdk\n") => {
  await writeFile(path.join(dir, ".env"), body, "utf8");
};

const runResolve = (
  startDir: string,
  homeDir: string,
  env: Record<string, string> = {},
) =>
  Effect.runPromiseExit(
    resolveConfig({ startDir, homeDir }).pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

describe("findDotEnv", () => {
  it("finds a .env in an ancestor from a nested working directory", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const project = path.join(home, "project");
    const nested = path.join(project, "a", "b");
    await mkdir(nested, { recursive: true });
    await touchEnv(project);

    assert.equal(findDotEnv(nested, home), path.join(project, ".env"));
  });

  it("prefers the nearest .env when several ancestors have one", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const project = path.join(home, "project");
    const nested = path.join(project, "nested");
    await mkdir(nested, { recursive: true });
    await touchEnv(home, "SN_AUTH_TYPE=now-sdk\nSN_MARK=home\n");
    await touchEnv(project, "SN_AUTH_TYPE=now-sdk\nSN_MARK=project\n");

    assert.equal(findDotEnv(nested, home), path.join(project, ".env"));
  });

  it("accepts a .env at $HOME inclusive", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const nested = path.join(home, "a", "b");
    await mkdir(nested, { recursive: true });
    await touchEnv(home);

    assert.equal(findDotEnv(nested, home), path.join(home, ".env"));
  });

  it("never reads a .env above $HOME", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sn-root-"));
    const home = path.join(root, "home");
    const outside = path.join(root, "outside", "proj");
    await mkdir(home, { recursive: true });
    await mkdir(outside, { recursive: true });
    await touchEnv(root, "SN_AUTH_TYPE=now-sdk\nSN_MARK=above-home\n");

    assert.equal(findDotEnv(outside, home), undefined);
  });
});

describe("resolveConfig", () => {
  it("returns the default Alias path when no config exists anywhere", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const start = path.join(home, "proj");
    await mkdir(start, { recursive: true });

    const exit = await runResolve(start, home, {});
    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value, {
      origin: { _tag: "none" },
      mode: "now-sdk",
      alias: Option.none(),
    });
  });

  it("honours SN_AUTH_ALIAS with no other config", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const start = path.join(home, "proj");
    await mkdir(start, { recursive: true });

    const exit = await runResolve(start, home, { SN_AUTH_ALIAS: "dev" });
    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value, {
      origin: { _tag: "none" },
      mode: "now-sdk",
      alias: Option.some("dev"),
    });
  });

  it("loads now-sdk mode from a discovered .env", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const project = path.join(home, "project");
    const nested = path.join(project, "nested");
    await mkdir(nested, { recursive: true });
    await touchEnv(project, "SN_AUTH_TYPE=now-sdk\nSN_AUTH_ALIAS=from-file\n");

    const exit = await runResolve(nested, home, {});
    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value, {
      origin: { _tag: "dotenv", path: path.join(project, ".env") },
      mode: "now-sdk",
      alias: Option.some("from-file"),
    });
  });

  it("allows a .env that only pins SN_AUTH_ALIAS without SN_AUTH_TYPE", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const project = path.join(home, "project");
    await mkdir(project, { recursive: true });
    await touchEnv(project, "SN_AUTH_ALIAS=from-file\n");

    const exit = await runResolve(project, home, {});
    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value, {
      origin: { _tag: "dotenv", path: path.join(project, ".env") },
      mode: "now-sdk",
      alias: Option.some("from-file"),
    });
  });

  it("lets real environment variables override .env entries", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const project = path.join(home, "project");
    await mkdir(project, { recursive: true });
    await touchEnv(
      project,
      [
        "SN_AUTH_TYPE=client_credentials",
        "SN_INSTANCE_URL=https://from-file.service-now.com",
        "SN_CLIENT_ID=file-id",
        "SN_CLIENT_SECRET=file-secret",
      ].join("\n") + "\n",
    );

    const exit = await runResolve(project, home, {
      SN_INSTANCE_URL: "https://from-env.service-now.com",
      SN_CLIENT_SECRET: "env-secret",
    });
    assert.ok(Exit.isSuccess(exit));
    const cfg = exit.value;
    assert.equal(cfg.mode, "client_credentials");
    if (cfg.mode !== "client_credentials") {
      return;
    }
    assert.equal(cfg.origin._tag, "dotenv");
    assert.equal(cfg.instanceUrl, "https://from-env.service-now.com");
    assert.equal(cfg.clientId, "file-id");
    assert.equal(Redacted.value(cfg.clientSecret), "env-secret");
    assert.equal(String(cfg.clientSecret), "<redacted>");
  });

  it("errors when credential keys are present without SN_AUTH_TYPE", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const project = path.join(home, "project");
    await mkdir(project, { recursive: true });
    await touchEnv(
      project,
      [
        "SN_INSTANCE_URL=https://x.service-now.com",
        "SN_CLIENT_ID=id",
        "SN_CLIENT_SECRET=secret",
      ].join("\n") + "\n",
    );

    const exit = await runResolve(project, home, {});
    assert.ok(Exit.isFailure(exit));
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    });
    assert.ok(error instanceof SnAuthError);
    assert.match(error.message, /SN_AUTH_TYPE/);
    assert.doesNotMatch(error.message, /secret/);
  });

  it("treats env-only SN_AUTH_TYPE as config without announcing a file", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "sn-home-"));
    const start = path.join(home, "proj");
    await mkdir(start, { recursive: true });

    const exit = await runResolve(start, home, {
      SN_AUTH_TYPE: "now-sdk",
      SN_AUTH_ALIAS: "ci",
    });
    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value, {
      origin: { _tag: "env" },
      mode: "now-sdk",
      alias: Option.some("ci"),
    });
  });
});
