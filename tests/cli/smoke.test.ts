import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pkg from "#package.json" with { type: "json" };

const fromHere = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

const CLI = fromHere("../../src/cli.ts");
const PROBE = fromHere("./fixtures/effect-shape-probe.ts");

const run = (
  script: string,
  args: ReadonlyArray<string>,
  options: { env?: Record<string, string>; cwd?: string } = {},
) => {
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    [script, ...args],
    {
      encoding: "utf8",
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    },
  );
  return { stdout, stderr, code: status };
};

describe("sn entrypoint", () => {
  it("prints usage on stdout and exits 0 for --help", () => {
    const { stdout, code } = run(CLI, ["--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /USAGE/);
    assert.match(stdout, /\bsn\b/);
  });

  it("lists exactly the five groups in root help", () => {
    const { stdout, code } = run(CLI, ["--help"]);
    assert.equal(code, 0);
    const section = stdout.split(/SUBCOMMANDS\n/)[1] ?? "";
    const names = [...section.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]);
    assert.deepEqual(names, ["table", "record", "batch", "script", "rule"]);
  });

  it("reports the package version on stdout and exits 0 for --version", () => {
    assert.equal(pkg.version, "3.0.0");
    const { stdout, code } = run(CLI, ["--version"]);
    assert.equal(code, 0);
    assert.ok(
      stdout.includes(pkg.version),
      `expected ${JSON.stringify(stdout)} to include ${pkg.version}`,
    );
  });

  // The half of "works from a directory outside this repo, after a global
  // link" that is ours rather than pnpm's: the bin target is executable, its
  // shebang runs it through type-stripping with no build, and it finds its own
  // package.json from any working directory.
  it("runs from its own shebang in an unrelated working directory", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "sn-cwd-"));
    const { stdout, status } = spawnSync(CLI, ["--version"], {
      encoding: "utf8",
      cwd: elsewhere,
    });
    assert.equal(status, 0);
    assert.ok(
      stdout.includes(pkg.version),
      `expected ${JSON.stringify(stdout)} to include ${pkg.version}`,
    );
  });

  // `pnpm add --global .` links the package rather than copying it, so the
  // entrypoint is reached through a symlinked path. Node resolves the link for
  // import.meta.url but leaves argv[1] as typed, which is what a hand-rolled
  // is-this-the-entrypoint comparison gets wrong: the guard silently goes
  // false and the CLI exits 0 having done nothing.
  it("runs when reached through a symlink, as a global install is", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-link-"));
    const link = join(dir, "sn");
    symlinkSync(fromHere("../.."), link);

    const { stdout, code } = run(join(link, "src", "cli.ts"), ["--version"]);
    assert.equal(code, 0);
    assert.ok(
      stdout.includes(pkg.version),
      `expected ${JSON.stringify(stdout)} to include ${pkg.version}`,
    );
  });

  it("prints help with a clean stderr when invoked bare", () => {
    const { stdout, stderr, code } = run(CLI, []);
    assert.equal(code, 0);
    assert.match(stdout, /USAGE/);
    assert.equal(stderr, "");
  });

  it("exits non-zero with an explanation on stderr for an unknown flag", () => {
    const { stderr, code } = run(CLI, ["--nope"]);
    assert.notEqual(code, 0);
    assert.notEqual(stderr.trim(), "");
  });
});

// ADR 0008 requires the pinned version to be confirmed running, not just
// resolving: rc.109 was only ever verified as far as its exports map. The probe
// is a throwaway CLI exercising the shapes the later tickets are built on.
describe(`effect ${pkg.dependencies.effect} shape probe`, () => {
  it("runs a subcommand off a service layer, data on stdout and lifecycle on stderr", () => {
    const { stdout, stderr, code } = run(PROBE, ["greet", "--name", "Barry"], {
      env: { PROBE_SECRET: "hunter2" },
    });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), {
      greeting: "hello Barry",
      secret: "<redacted>",
      revealed: "hunter2",
    });
    assert.match(stderr, /probe acquired/);
    assert.match(stderr, /probe released/);
  });

  it("maps a tagged error to its declared exit code with nothing on stdout", () => {
    const { stdout, stderr, code } = run(PROBE, ["greet", "--name", "boom"], {
      env: { PROBE_SECRET: "hunter2" },
    });
    assert.equal(code, 7);
    assert.equal(stdout, "");
    assert.match(stderr, /ProbeError/);
  });

  it("keeps an unhandled defect off stdout", () => {
    const { stdout, stderr, code } = run(PROBE, ["explode"], {
      env: { PROBE_SECRET: "hunter2" },
    });
    assert.notEqual(code, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /kaboom/);
  });

  it("reads a redacted secret from a .env file, overridden by the real environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-probe-"));
    writeFileSync(join(dir, ".env"), "PROBE_SECRET=from-dotenv\n");

    const fromFile = run(PROBE, ["greet", "--name", "Barry"], { cwd: dir });
    assert.equal(fromFile.code, 0);
    assert.equal(JSON.parse(fromFile.stdout).revealed, "from-dotenv");

    const fromEnv = run(PROBE, ["greet", "--name", "Barry"], {
      cwd: dir,
      env: { PROBE_SECRET: "from-env" },
    });
    assert.equal(fromEnv.code, 0);
    assert.equal(JSON.parse(fromEnv.stdout).revealed, "from-env");
  });

  // Nested dispatch: a two-level tree must actually run on the pinned release
  // before any real command is restructured around that assumption (ADR 0008).
  it("runs a leaf handler when invoked through its group", () => {
    const alpha = run(PROBE, ["bundle", "alpha"]);
    assert.equal(alpha.code, 0);
    assert.deepEqual(JSON.parse(alpha.stdout), { leaf: "alpha", tag: "" });

    const beta = run(PROBE, ["bundle", "beta"]);
    assert.equal(beta.code, 0);
    assert.deepEqual(JSON.parse(beta.stdout), { leaf: "beta", tag: "" });
  });

  it("propagates a root shared flag to the leaf before and after the group name", () => {
    const before = run(PROBE, ["--tag", "before", "bundle", "alpha"]);
    assert.equal(before.code, 0);
    assert.deepEqual(JSON.parse(before.stdout), {
      leaf: "alpha",
      tag: "before",
    });

    const after = run(PROBE, ["bundle", "--tag", "after", "alpha"]);
    assert.equal(after.code, 0);
    assert.deepEqual(JSON.parse(after.stdout), {
      leaf: "alpha",
      tag: "after",
    });
  });

  it("prints the group's help and exits 0 when the group is invoked with no leaf", () => {
    const { stdout, code } = run(PROBE, ["bundle"]);
    assert.equal(code, 0);
    assert.match(stdout, /USAGE/);
    assert.match(stdout, /probe bundle/);
  });

  it("lists the group's leaves in group help and the group in root help", () => {
    const group = run(PROBE, ["bundle", "--help"]);
    assert.equal(group.code, 0);
    assert.match(group.stdout, /\balpha\b/);
    assert.match(group.stdout, /\bbeta\b/);

    const root = run(PROBE, ["--help"]);
    assert.equal(root.code, 0);
    assert.match(root.stdout, /\bbundle\b/);
  });

  it("exits non-zero with an explanation on stderr for an unknown leaf under a valid group", () => {
    const { stderr, code } = run(PROBE, ["bundle", "nope"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /Unknown subcommand "nope" for "probe bundle"/);
    // ponytail: Effect's ShowHelp always Console.logs help, so parse errors
    // also put the help doc on stdout — same as a flat unknown subcommand.
    // Empty-stdout (ADR 0007) needs a Command.run change, not more nesting.
  });
});
