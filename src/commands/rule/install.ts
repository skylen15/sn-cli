import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Console, Effect, FileSystem } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { SnLocalError } from "#src/servicenow/errors.ts";

const RULE_FILE = "sn-cli.mdc";

/** Per-Platform on-disk layout under the target root (glossary: Platform). */
const PLATFORM_DIR = {
  cursor: [".cursor", "rules"],
} as const;

type Platform = keyof typeof PLATFORM_DIR;

// SAFETY: PLATFORM_DIR has at least one key; Flag.choice needs a non-empty tuple.
const PLATFORMS = Object.keys(PLATFORM_DIR) as [Platform, ...Array<Platform>];

/** Package root: three levels up from this leaf (`src/commands/rule/`). */
const packageRoot = fileURLToPath(new URL("../../..", import.meta.url));

const sourceRulePath = join(packageRoot, ".cursor", "rules", RULE_FILE);

/** Git toplevel for `cwd`, or `undefined` when not inside a work tree. */
const gitRoot = (cwd: string): string | undefined => {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }
  const root = result.stdout.trim();
  return root.length > 0 ? root : undefined;
};

const install = Command.make(
  "install",
  {
    platform: Flag.choice("platform", PLATFORMS).pipe(
      Flag.withDefault("cursor" as const),
      Flag.withDescription(
        "Platform whose rules directory receives the Rule (default: cursor → .cursor/rules/)",
      ),
    ),
    force: Flag.boolean("force").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Overwrite an existing sn-cli.mdc in the target Platform rules directory",
      ),
    ),
  },
  Effect.fn("rule.install")(function* ({ platform, force }) {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.realPath(process.cwd());
    const found = gitRoot(cwd);
    const root = found !== undefined ? yield* fs.realPath(found) : undefined;
    const targetRoot = root ?? cwd;
    if (root === undefined) {
      yield* Console.error(`not a git repo; installing into cwd ${cwd}`);
    }

    const destDir = join(targetRoot, ...PLATFORM_DIR[platform]);
    const destPath = join(destDir, RULE_FILE);

    if (!(yield* fs.exists(sourceRulePath))) {
      return yield* new SnLocalError({
        message: `shipped rule missing: ${sourceRulePath}`,
      });
    }

    if ((yield* fs.exists(destPath)) && !force) {
      return yield* new SnLocalError({
        message: `already exists: ${destPath} (pass --force to overwrite)`,
        hint: `Run \`sn rule install --platform ${platform} --force\` to overwrite the existing Rule.`,
      });
    }

    yield* fs.makeDirectory(destDir, { recursive: true });
    const body = yield* fs.readFileString(sourceRulePath);
    yield* fs.writeFileString(destPath, body);
    yield* emitJson({ path: destPath });
  }),
).pipe(
  Command.withDescription(
    "Install the shipped sn-cli Rule into this repo for a Platform (local filesystem only; outside the Instance Guard)",
  ),
);

export { install };
