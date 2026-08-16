import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Layer, Option } from "effect";
import { Command } from "effect/unstable/cli";

import { sn } from "#src/cli.ts";
import { emitCapture } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";

const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));

const spawn = (args: ReadonlyArray<string>) => {
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { encoding: "utf8" },
  );
  return { stdout, stderr, code: status };
};

const run = (
  args: ReadonlyArray<string>,
  clientLayer: Layer.Layer<SnClient>,
  writes: Array<unknown>,
) =>
  Effect.runPromiseExit(
    Command.runWith(
      sn.pipe(Command.provide(Layer.merge(clientLayer, emitCapture(writes)))),
      { version: "0.0.0-test", renderErrors: false },
    )(args).pipe(Effect.provide(NodeServices.layer)),
  );

const stubCapturingAlias = (): {
  layer: Layer.Layer<SnClient>;
  seen: { alias?: Option.Option<string> };
} => {
  const seen: { alias?: Option.Option<string> } = {};
  return {
    seen,
    layer: Layer.succeed(
      SnClient,
      SnClient.of({
        request: Effect.fn("stub.request")(function* () {
          seen.alias = yield* AliasFlag;
          return { result: [] };
        }),
        token: () => Effect.die("SnClient.token unused in stub"),
      }),
    ),
  };
};

describe("script group", () => {
  it("prints the group's help and exits 0 when invoked with no leaf", () => {
    const { stdout, code } = spawn(["script"]);
    assert.equal(code, 0);
    assert.match(stdout, /USAGE/);
    assert.match(stdout, /sn script/);
  });

  it("lists the group's leaves in group help and the group in root help", () => {
    const group = spawn(["script", "--help"]);
    assert.equal(group.code, 0);
    assert.match(group.stdout, /\brun\b/);
    assert.match(group.stdout, /\bsearch\b/);

    const root = spawn(["--help"]);
    assert.equal(root.code, 0);
    assert.match(root.stdout, /\bscript\b/);
  });

  it("propagates the root Alias flag to a leaf before and after the group name", async () => {
    const before = stubCapturingAlias();
    const beforeExit = await run(
      ["--alias", "before", "script", "search", "hello"],
      before.layer,
      [],
    );
    assert.ok(Exit.isSuccess(beforeExit));
    assert.deepEqual(before.seen.alias, Option.some("before"));

    const after = stubCapturingAlias();
    const afterExit = await run(
      ["script", "--alias", "after", "search", "hello"],
      after.layer,
      [],
    );
    assert.ok(Exit.isSuccess(afterExit));
    assert.deepEqual(after.seen.alias, Option.some("after"));
  });

  it("exits non-zero with an explanation for each retired flat name", () => {
    for (const name of ["run-background-script", "search-code"] as const) {
      const { stdout, stderr, code } = spawn([name, "gs.print(1);"]);
      assert.notEqual(code, 0, `${name} should fail`);
      assert.match(stderr, new RegExp(`Unknown subcommand "${name}"`));
      // ponytail: Effect's ShowHelp also Console.logs help on stdout for
      // unknown subcommands — same as any unknown flat name today. ADR 0007
      // empty-stdout for parse errors needs a Command.run change, not grouping.
      assert.equal(stdout.includes('"result"'), false);
    }
  });
});
