import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { Config, ConfigProvider, Effect, Option, type Redacted } from "effect";

import { SnAuthError } from "./errors.ts";

/** True when `dir` is a strict ancestor of `home` (i.e. above `$HOME`). */
const isAboveHome = (dir: string, home: string): boolean => {
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return home.startsWith(prefix);
};

/**
 * Walk up from `startDir` looking for `.env`, stopping at `homeDir` inclusive
 * and never reading a directory above it (ADR 0005). First match wins.
 */
export const findDotEnv = (
  startDir: string,
  homeDir: string,
): string | undefined => {
  const home = path.resolve(homeDir);
  let dir = path.resolve(startDir);

  for (;;) {
    if (isAboveHome(dir, home)) {
      return undefined;
    }

    const candidate = path.join(dir, ".env");
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }

    if (dir === home) {
      return undefined;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
};

/** Where the resolved auth config came from (drives `.env` stderr announce). */
export type ConfigOrigin =
  | { readonly _tag: "none" }
  | { readonly _tag: "env" }
  | { readonly _tag: "dotenv"; readonly path: string };

/** Typed auth config after `.env` walk + `SN_AUTH_TYPE` selection (ADR 0005). */
export type ResolvedConfig =
  | {
      readonly origin: ConfigOrigin;
      readonly mode: "now-sdk";
      readonly alias: Option.Option<string>;
    }
  | {
      readonly origin: Exclude<ConfigOrigin, { readonly _tag: "none" }>;
      readonly mode: "client_credentials";
      readonly instanceUrl: string;
      readonly clientId: string;
      readonly clientSecret: Redacted.Redacted<string>;
    };

const missingTypeMessage =
  'Config is present but SN_AUTH_TYPE is missing. Set SN_AUTH_TYPE to "now-sdk" or "client_credentials" — mode is never inferred from which keys are set.';

const readResolved = Effect.fn("readResolved")(function* (
  dotenvPath: string | undefined,
) {
  const authType = yield* Config.option(
    Config.literals(["now-sdk", "client_credentials"], "SN_AUTH_TYPE"),
  );
  const alias = yield* Config.option(Config.nonEmptyString("SN_AUTH_ALIAS"));
  const clientId = yield* Config.option(Config.nonEmptyString("SN_CLIENT_ID"));
  const clientSecret = yield* Config.option(
    Config.redacted("SN_CLIENT_SECRET"),
  );
  const instanceUrl = yield* Config.option(
    Config.nonEmptyString("SN_INSTANCE_URL"),
  );

  const hasCredentialKeys =
    Option.isSome(clientId) ||
    Option.isSome(clientSecret) ||
    Option.isSome(instanceUrl);

  // Auth "config" means a declared mode or credential keys — not merely that a
  // `.env` file exists (a file may only pin SN_AUTH_ALIAS).
  const configPresent = Option.isSome(authType) || hasCredentialKeys;

  if (!configPresent) {
    // Alias-only `.env` is still a discovered config source (ADR 0005 announce).
    return {
      origin:
        dotenvPath !== undefined && Option.isSome(alias)
          ? { _tag: "dotenv" as const, path: dotenvPath }
          : { _tag: "none" as const },
      mode: "now-sdk" as const,
      alias,
    } satisfies ResolvedConfig;
  }

  if (Option.isNone(authType)) {
    return yield* new SnAuthError({ message: missingTypeMessage });
  }

  const origin: Exclude<ConfigOrigin, { readonly _tag: "none" }> =
    dotenvPath !== undefined
      ? { _tag: "dotenv", path: dotenvPath }
      : { _tag: "env" };

  if (authType.value === "now-sdk") {
    return {
      origin,
      mode: "now-sdk" as const,
      alias,
    } satisfies ResolvedConfig;
  }

  if (Option.isNone(instanceUrl)) {
    return yield* new SnAuthError({
      message:
        "SN_AUTH_TYPE=client_credentials requires SN_INSTANCE_URL (e.g. https://example.service-now.com).",
    });
  }
  if (Option.isNone(clientId)) {
    return yield* new SnAuthError({
      message: "SN_AUTH_TYPE=client_credentials requires SN_CLIENT_ID.",
    });
  }
  if (Option.isNone(clientSecret)) {
    return yield* new SnAuthError({
      message: "SN_AUTH_TYPE=client_credentials requires SN_CLIENT_SECRET.",
    });
  }

  return {
    origin,
    mode: "client_credentials" as const,
    instanceUrl: instanceUrl.value,
    clientId: clientId.value,
    clientSecret: clientSecret.value,
  } satisfies ResolvedConfig;
});

/**
 * Resolve auth config from a starting directory: walk for `.env`, compose
 * `ConfigProvider.fromDotEnv` under the active provider (real env wins), and
 * return a typed config or a tagged auth error (ADR 0005).
 */
export const resolveConfig = Effect.fn("resolveConfig")(function* (options: {
  readonly startDir: string;
  readonly homeDir: string;
}) {
  const dotenvPath = findDotEnv(options.startDir, options.homeDir);
  const read = readResolved(dotenvPath);
  if (dotenvPath === undefined) {
    return yield* read;
  }
  return yield* read.pipe(
    Effect.provide(
      ConfigProvider.layerAdd(ConfigProvider.fromDotEnv({ path: dotenvPath })),
    ),
  );
});
