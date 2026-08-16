import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Console, Effect, FileSystem } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { SnLocalError } from "#src/servicenow/errors.ts";

const START_MARKER = "<!-- sn-cli rule:start -->";
const END_MARKER = "<!-- sn-cli rule:end -->";
const CURSOR_FRONTMATTER = `---
description: Live ServiceNow via \`sn\` — instance schema/data/code; reads free, create/update/delete and Background Script run need approve
alwaysApply: true
---`;
const CURSOR_PERMISSION =
  'Every `sn` Shell call uses `required_permissions: ["all"]` (instance network + OS keychain). That is separate from human approve below.';

const packageRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourceRulePath = join(packageRoot, "rules", "sn-cli.md");

type Platform = "cursor" | "general" | "claude";

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

const destination = (root: string, platform: Platform): string => {
  switch (platform) {
    case "cursor":
      return join(root, ".cursor", "rules", "sn-cli.mdc");
    case "general":
      return join(root, "AGENTS.md");
    case "claude":
      return join(root, "CLAUDE.md");
  }
};

const cursorRule = (core: string): string => {
  const withPermission = core.replace(
    "\n\n## Reads",
    `\n\n${CURSOR_PERMISSION}\n\n## Reads`,
  );
  return `${CURSOR_FRONTMATTER}\n\n${withPermission.trimEnd()}\n`;
};

const markdownSection = (core: string, newline: string): string => {
  const body = core.trim().replace(/^# /, "## ").replaceAll("\n", newline);
  return `${START_MARKER}${newline}${body}${newline}${END_MARKER}`;
};

const occurrences = (body: string, value: string): number =>
  body.split(value).length - 1;

const installMarkdown = (
  existing: string,
  core: string,
  force: boolean,
  path: string,
): { readonly body: string; readonly changed: boolean } | SnLocalError => {
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const startCount = occurrences(existing, START_MARKER);
  const endCount = occurrences(existing, END_MARKER);
  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);

  if (
    startCount !== endCount ||
    startCount > 1 ||
    (startCount === 1 && end < start)
  ) {
    return new SnLocalError({
      message: `malformed sn-cli rule markers: ${path}`,
    });
  }

  const section = markdownSection(core, newline);
  if (startCount === 0) {
    const prefix = existing.replace(/(?:\r\n|\n|\r)*$/, "");
    const separator = prefix.length === 0 ? "" : newline.repeat(2);
    return { body: `${prefix}${separator}${section}${newline}`, changed: true };
  }

  const after = end + END_MARKER.length;
  const current = existing.slice(start, after);
  if (current === section) {
    const normalized = `${existing.replace(/(?:\r\n|\n|\r)*$/, "")}${newline}`;
    return { body: normalized, changed: normalized !== existing };
  }
  if (!force) {
    return new SnLocalError({
      message: `installed rule differs: ${path} (pass --force to overwrite)`,
    });
  }

  const replaced = `${existing.slice(0, start)}${section}${existing.slice(after)}`;
  return {
    body: `${replaced.replace(/(?:\r\n|\n|\r)*$/, "")}${newline}`,
    changed: true,
  };
};

/** Install the shipped Rule for one platform at the repository root. */
const install = Command.make(
  "install",
  {
    platform: Flag.choice("platform", ["cursor", "general", "claude"]).pipe(
      Flag.withDefault("general" as const),
      Flag.withDescription("Rule platform to install (default: general)"),
    ),
    force: Flag.boolean("force").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Replace an installed rule that differs"),
    ),
  },
  Effect.fn("rule.install")(
    function* ({ platform, force }) {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.realPath(process.cwd());
      const found = gitRoot(cwd);
      const root = found === undefined ? undefined : yield* fs.realPath(found);
      const targetRoot = root ?? cwd;
      if (root === undefined) {
        yield* Console.error(`not a git repo; installing into cwd ${cwd}`);
      }

      if (!(yield* fs.exists(sourceRulePath))) {
        return yield* new SnLocalError({
          message: `shipped rule missing: ${sourceRulePath}`,
        });
      }

      const core = yield* fs.readFileString(sourceRulePath);
      const destPath = destination(targetRoot, platform);
      const exists = yield* fs.exists(destPath);

      if (platform === "cursor") {
        const desired = cursorRule(core);
        if (exists) {
          const current = yield* fs.readFileString(destPath);
          if (current !== desired && !force) {
            return yield* new SnLocalError({
              message: `installed rule differs: ${destPath} (pass --force to overwrite)`,
            });
          }
          if (current === desired) {
            return yield* emitJson({ path: destPath });
          }
        }
        yield* fs.makeDirectory(join(targetRoot, ".cursor", "rules"), {
          recursive: true,
        });
        yield* fs.writeFileString(destPath, desired);
        return yield* emitJson({ path: destPath });
      }

      const existing = exists ? yield* fs.readFileString(destPath) : "";
      const result = installMarkdown(existing, core, force, destPath);
      if (result instanceof SnLocalError) {
        return yield* result;
      }
      if (result.changed) {
        yield* fs.writeFileString(destPath, result.body);
      }
      return yield* emitJson({ path: destPath });
    },
    Effect.mapError((error) =>
      error instanceof SnLocalError
        ? error
        : new SnLocalError({
            message: `local rule installation failed: ${String(error)}`,
          }),
    ),
  ),
).pipe(
  Command.withDescription(
    "Install the shipped sn rule into this repo's agent instructions",
  ),
);

export { install };
