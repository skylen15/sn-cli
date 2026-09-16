import { createRequire } from "node:module";

import { Context, Effect, Layer, Option, Redacted } from "effect";

import { getBlockedInstances } from "#src/config.ts";

import type { Token } from "./client.ts";
import { AliasConfirm } from "./confirm.ts";
import { SnAuthError, SnGuardError } from "./errors.ts";

let customBlockedHostnames: ReadonlySet<string> | null = null;

/** Set an in-memory override for blocked hostnames (useful for tests). */
export const setBlockedHostnames = (hostnames: ReadonlySet<string> | null): void => {
  customBlockedHostnames = hostnames;
};

/** Blocked Instance hostnames loaded from configuration or test override (ADR 0017). */
export const getBlockedHostnames = (): ReadonlySet<string> =>
  customBlockedHostnames ?? getBlockedInstances();

export const BLOCKED_INSTANCES: ReadonlySet<string> = getBlockedHostnames();
const INSTANCE_ORIGIN_HINT =
  "Use an HTTPS ServiceNow instance origin with no credentials, path, query string, or fragment.";

const shellArg = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Parse instance URL to canonical lowercase hostname with trailing dots removed. */
export const parseCanonicalHostname = (rawUrl: string): Effect.Effect<string, SnAuthError> => {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname) {
      return Effect.fail(
        new SnAuthError({
          message: `Malformed instance URL "${rawUrl}": missing hostname`,
          hint: INSTANCE_ORIGIN_HINT,
        }),
      );
    }
    const canonical = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    return Effect.succeed(canonical);
  } catch {
    return Effect.fail(
      new SnAuthError({
        message: `Malformed instance URL "${rawUrl}"`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }
};

const isBlockedHostname = (hostname: string): boolean => getBlockedHostnames().has(hostname);
/** Report whether an instance URL names an exact Blocked Instance. */
export const isInstanceBlocked = (rawUrl: string): Effect.Effect<boolean, SnAuthError> =>
  Effect.map(parseCanonicalHostname(rawUrl), isBlockedHostname);

/** Parse and canonicalize an HTTPS instance origin; rejects paths, query, fragment, credentials, and non-HTTPS. */
export const parseInstanceOrigin = (
  rawUrl: string,
): Effect.Effect<{ readonly canonicalOrigin: string; readonly hostname: string }, SnAuthError> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return Effect.fail(
      new SnAuthError({
        message: `Malformed instance URL "${rawUrl}"`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }

  const hostname = parsed.hostname?.toLowerCase().replace(/\.+$/, "");
  if (!hostname) {
    return Effect.fail(
      new SnAuthError({
        message: `Malformed instance URL "${rawUrl}": missing hostname`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }

  if (parsed.protocol !== "https:") {
    return Effect.fail(
      new SnAuthError({
        message: `Instance URL must use HTTPS scheme: "${rawUrl}"`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }

  if (parsed.username || parsed.password) {
    return Effect.fail(
      new SnAuthError({
        message: `Instance URL must not contain credentials: "${rawUrl}"`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return Effect.fail(
      new SnAuthError({
        message: `Instance URL must not contain a path: "${rawUrl}"`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }

  if (parsed.search) {
    return Effect.fail(
      new SnAuthError({
        message: `Instance URL must not contain a query string: "${rawUrl}"`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }

  if (parsed.hash) {
    return Effect.fail(
      new SnAuthError({
        message: `Instance URL must not contain a fragment: "${rawUrl}"`,
        hint: INSTANCE_ORIGIN_HINT,
      }),
    );
  }

  const port = parsed.port ? `:${parsed.port}` : "";
  return Effect.succeed({
    canonicalOrigin: `https://${hostname}${port}`,
    hostname,
  });
};

/** Ensure instance URL is well-formed and not a Blocked Instance (ADR 0017). */
export const assertInstanceAllowed = (
  rawUrl: string,
): Effect.Effect<string, SnAuthError | SnGuardError> =>
  Effect.gen(function* () {
    const hostname = yield* parseCanonicalHostname(rawUrl);
    if (isBlockedHostname(hostname)) {
      return yield* new SnGuardError({
        message: `Instance "${hostname}" is blocked by policy; no request was sent.`,
        hint: "Select an Alias for a non-blocked instance with `--alias <alias>`.",
      });
    }
    return hostname;
  });

/** Seconds before recorded expiry at which the Now SDK attempts a refresh. */
export const SDK_REFRESH_WINDOW_SECONDS = 15 * 60;

/** True when `expiresAt` is inside the Now SDK's refresh window (or already past). */
export const isInsideSdkRefreshWindow = (
  expiresAt: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean => expiresAt - nowSeconds <= SDK_REFRESH_WINDOW_SECONDS;

export type OauthCreds = {
  type: "oauth";
  instanceUrl: string;
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_at: number;
};

type StoredOauth = {
  alias: string;
  isDefault: boolean;
  creds: OauthCreds;
};

type StoredDefault = StoredOauth | { alias: string; isDefault: boolean; creds: { type: "basic" } };

/** Secret-free Alias summary from the Now SDK keychain. */
export type AliasPreview = {
  readonly isDefault: boolean;
  readonly instanceUrl: string;
  readonly type: string;
};

/** Testable seam over the Now SDK auth / OAuth modules (ADR 0006). */
export type AuthSdk = {
  readonly getStored: (alias: string | undefined) => Promise<StoredDefault | undefined>;
  readonly refreshAccessToken: (creds: OauthCreds) => Promise<Partial<OauthCreds> | undefined>;
  readonly storeCredentials: (
    alias: string,
    creds: OauthCreds,
    isDefault: boolean,
  ) => Promise<void>;
  readonly fetchCredentials: () => Promise<ReadonlyMap<string, AliasPreview>>;
  readonly loginOAuth?: (instanceUrl: string) => Promise<OauthCreds | undefined>;
  readonly updateDefaultCredential?: (alias: string) => Promise<void>;
  readonly removeCredentials?: (alias: string) => Promise<void>;
};

// Deep import via createRequire so tsc never follows the package's .d.ts into
// @servicenow/sdk-core source (verbatimModuleSyntax + CJS). See ADR 0006.
const require = createRequire(import.meta.url);
// SAFETY: unsupported deep import into SDK build output (ADR 0006); shape is
// pinned by the exact @servicenow/sdk-cli version and checked at call sites.
const sdkAuth = require("@servicenow/sdk-cli/dist/auth/index.js") as {
  getDefaultCredentials: () => Promise<
    | {
        alias: string;
        isDefault: boolean;
        creds: {
          type: string;
          instanceUrl?: string;
          access_token?: string;
          token_type?: string;
          refresh_token?: string;
          expires_at?: number;
        };
      }
    | undefined
  >;
  storeCredentials: (alias: string, authInfo: OauthCreds, isDefault: boolean) => Promise<void>;
  fetchCredentials: () => Promise<
    Map<string, { isDefault: boolean; instanceUrl: string; type: string }>
  >;
  updateDefaultCredential: (alias: string) => Promise<void>;
  removeCredentials: (alias: string) => Promise<void>;
};
// SAFETY: same deep-import boundary as sdkAuth (ADR 0006).
const sdkOauth = require("@servicenow/sdk-cli/dist/auth/OAuth/index.js") as {
  refreshAccessToken: (creds: OauthCreds) => Promise<Partial<OauthCreds> | undefined>;
  getOAuthTokens: (host: string) => Promise<
    | {
        access_token: string;
        token_type?: string;
        refresh_token?: string;
        expires_at: number;
      }
    | undefined
  >;
};
// SAFETY: KeyChain is the SDK's own store wrapper; we only call getPassword
// (ADR 0006). Used so named-Alias reads never go through getCredentials.
const { KeyChain } = require("@servicenow/sdk-cli/dist/auth/keychain/index.js") as {
  KeyChain: new (service: string) => {
    getPassword: () => Promise<string | null>;
  };
};
const keyChain = new KeyChain("ServiceNow");

type SdkStoredCreds = {
  type: string;
  instanceUrl?: string;
  access_token?: string;
  token_type?: string;
  refresh_token?: string;
  expires_at?: number;
};

const mapOauth = (stored: {
  alias: string;
  isDefault: boolean;
  creds: SdkStoredCreds;
}): StoredDefault => {
  if (stored.creds.type === "oauth") {
    const { instanceUrl, access_token, expires_at, token_type, refresh_token } = stored.creds;
    // ponytail: SDK oauth blobs are partial in the .d.ts; ceiling is a
    // malformed keychain entry. Upgrade: Schema decode before use.
    if (instanceUrl === undefined || access_token === undefined || expires_at === undefined) {
      throw new Error(
        `Malformed OAuth credential for alias "${stored.alias}": missing instanceUrl, access_token, or expires_at`,
      );
    }
    return {
      alias: stored.alias,
      isDefault: stored.isDefault,
      creds: {
        type: "oauth",
        instanceUrl,
        access_token,
        token_type,
        refresh_token,
        expires_at,
      },
    };
  }
  return {
    alias: stored.alias,
    isDefault: stored.isDefault,
    creds: { type: "basic" as const },
  };
};

const readNamedFromKeychain = async (alias: string): Promise<StoredDefault | undefined> => {
  const raw = await keyChain.getPassword();
  if (!raw) {
    return undefined;
  }
  // SAFETY: keychain JSON is owned by @servicenow/sdk-cli (ADR 0006); we only
  // index by alias and pass the entry through mapOauth.
  const keyStore = JSON.parse(raw) as Record<
    string,
    { alias: string; isDefault: boolean; creds: SdkStoredCreds }
  >;
  const stored = keyStore[alias];
  return stored ? mapOauth(stored) : undefined;
};

const liveSdk: AuthSdk & {
  readonly loginOAuth: (instanceUrl: string) => Promise<OauthCreds | undefined>;
  readonly updateDefaultCredential: (alias: string) => Promise<void>;
  readonly removeCredentials: (alias: string) => Promise<void>;
} = {
  getStored: async (alias) => {
    if (!alias) {
      const stored = await sdkAuth.getDefaultCredentials();
      return stored ? mapOauth(stored) : undefined;
    }
    // Never call SDK getCredentials for a named Alias: it refreshes inside the
    // window and its failure path can kill the process. Read the store the same
    // way getDefaultCredentials does, then pre-flight in getNowSdkToken.
    return readNamedFromKeychain(alias);
  },
  refreshAccessToken: (creds) => sdkOauth.refreshAccessToken(creds),
  storeCredentials: (alias, creds, isDefault) => sdkAuth.storeCredentials(alias, creds, isDefault),
  fetchCredentials: () => sdkAuth.fetchCredentials(),
  updateDefaultCredential: (alias) => sdkAuth.updateDefaultCredential(alias),
  removeCredentials: (alias) => sdkAuth.removeCredentials(alias),
  loginOAuth: async (instanceUrl) => {
    // ponytail: stdout and console.log redirection to stderr is a process-global intercept for the duration of the Now SDK OAuth flow; ceiling: races concurrent background stdout writers and misses handles captured by dependencies prior to this call; upgrade path: patch or replace @servicenow/sdk-cli OAuth flow with native loopback listener.
    // Redirect stdout writes and console.log to stderr during Now SDK OAuth so
    // prompt, browser URLs, and logger output never corrupt the compact JSON output contract (ADR 0018).
    const originalStdoutWrite = process.stdout.write;
    const originalConsoleLog = console.log;
    // SAFETY: redirecting stdout.write to stderr.write preserves stream compatibility while keeping stdout clean for JSON output
    process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => console.error(...args);

    try {
      const tokens = await sdkOauth.getOAuthTokens(instanceUrl);
      if (!tokens?.access_token) {
        return undefined;
      }
      return {
        type: "oauth",
        instanceUrl,
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
      };
    } finally {
      process.stdout.write = originalStdoutWrite;
      console.log = originalConsoleLog;
    }
  },
};

/** Secret-free local Alias inventory item. */
export type AliasInventoryEntry = {
  readonly alias: string;
  readonly instanceUrl: string;
  readonly isDefault: boolean;
  readonly type: string;
  readonly blocked: boolean;
};

/** Result of adding a new Now SDK OAuth Alias (Issue 04). */
export type AddedAlias = {
  readonly alias: string;
  readonly instanceUrl: string;
  readonly isDefault: boolean;
};

/** Result of designating a Now SDK OAuth Alias as default (Issue 05). */
export type UsedAlias = {
  readonly alias: string;
  readonly instanceUrl: string;
  readonly isDefault: boolean;
};

/** Result of removing a Now SDK Alias from the keychain (Issue 05). */
export type RemovedAlias = {
  readonly alias: string;
  readonly removed: boolean;
};

const formatAliasList = (aliases: ReadonlyMap<string, AliasPreview>): string => {
  if (aliases.size === 0) {
    return "(none configured)";
  }
  return [...aliases.entries()]
    .map(([name, preview]) => {
      const mark = preview.isDefault ? " (default)" : "";
      return `${name}${mark}`;
    })
    .join(", ");
};

const fetchAliasPreviews = Effect.fn("fetchAliasPreviews")(function* (
  sdk: Pick<AuthSdk, "fetchCredentials">,
) {
  return yield* Effect.tryPromise({
    try: () => sdk.fetchCredentials(),
    catch: (cause) =>
      new SnAuthError({
        message: `Failed to list Now SDK aliases: ${cause instanceof Error ? cause.message : String(cause)}`,
        hint: "Resolve keychain access, then retry the auth command.",
      }),
  });
});

/** Local, secret-free view and management of Now SDK Aliases. */
export class AliasInventory extends Context.Service<
  AliasInventory,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<AliasInventoryEntry>, SnAuthError>;
    readonly add: (options: {
      readonly instanceUrl: string;
      readonly alias: string;
    }) => Effect.Effect<AddedAlias, SnAuthError | SnGuardError>;
    readonly use: (alias: string) => Effect.Effect<UsedAlias, SnAuthError | SnGuardError>;
    readonly remove: (alias: string) => Effect.Effect<RemovedAlias, SnAuthError>;
  }
>()("sn/servicenow/AliasInventory") {}

/** Build an Alias inventory layer from the Now SDK adapter (tests). */
export const makeAliasInventoryLayer = (
  sdk: Pick<AuthSdk, "fetchCredentials" | "storeCredentials"> & {
    readonly loginOAuth: (instanceUrl: string) => Promise<OauthCreds | undefined>;
    readonly updateDefaultCredential: (alias: string) => Promise<void>;
    readonly removeCredentials: (alias: string) => Promise<void>;
  },
): Layer.Layer<AliasInventory> =>
  Layer.succeed(
    AliasInventory,
    AliasInventory.of({
      list: Effect.fn("AliasInventory.list")(function* () {
        const aliases = yield* fetchAliasPreviews(sdk);
        return yield* Effect.forEach(
          aliases,
          Effect.fn("AliasInventory.list.entry")(function* ([alias, preview]) {
            return {
              alias,
              instanceUrl: preview.instanceUrl,
              isDefault: preview.isDefault,
              type: preview.type,
              blocked: yield* isInstanceBlocked(preview.instanceUrl),
            };
          }),
        );
      }),
      use: Effect.fn("AliasInventory.use")(function* (rawAlias) {
        if (!rawAlias || rawAlias.trim().length === 0) {
          return yield* new SnAuthError({
            message: "Alias name must not be empty.",
            hint: "Run `sn auth use <alias>` with a non-empty Alias name.",
          });
        }
        const alias = rawAlias.trim();

        const existing = yield* fetchAliasPreviews(sdk);
        const preview = existing.get(alias);
        if (!preview) {
          return yield* new SnAuthError({
            message: `Unknown Now SDK alias "${alias}". Available aliases: ${formatAliasList(existing)}.`,
            hint: "Run `sn auth list`, then select an existing Alias with `sn auth use <alias>`.",
          });
        }

        if (preview.type !== "oauth") {
          return yield* new SnAuthError({
            message: `Alias "${alias}" is not an OAuth alias (found "${preview.type}"). Only OAuth aliases may be used as default.`,
            hint: `Run: sn auth remove ${shellArg(alias)}. Then recreate it with: sn auth add <https-origin> --alias ${shellArg(alias)}.`,
          });
        }

        yield* assertInstanceAllowed(preview.instanceUrl);

        yield* Effect.tryPromise({
          try: () => sdk.updateDefaultCredential(alias),
          catch: (cause) =>
            new SnAuthError({
              message: `Failed to set alias "${alias}" as default: ${cause instanceof Error ? cause.message : String(cause)}`,
              hint: `Resolve keychain access, then retry: sn auth use ${shellArg(alias)}.`,
            }),
        });

        return {
          alias,
          instanceUrl: preview.instanceUrl,
          isDefault: true,
        };
      }),
      remove: Effect.fn("AliasInventory.remove")(function* (rawAlias) {
        if (!rawAlias || rawAlias.trim().length === 0) {
          return yield* new SnAuthError({
            message: "Alias name must not be empty.",
            hint: "Run `sn auth remove <alias>` with a non-empty Alias name.",
          });
        }
        const alias = rawAlias.trim();

        const existing = yield* fetchAliasPreviews(sdk);
        if (!existing.has(alias)) {
          return yield* new SnAuthError({
            message: `Unknown Now SDK alias "${alias}". Available aliases: ${formatAliasList(existing)}.`,
            hint: "Run `sn auth list`, then remove an existing Alias with `sn auth remove <alias>`.",
          });
        }

        yield* Effect.tryPromise({
          try: () => sdk.removeCredentials(alias),
          catch: (cause) =>
            new SnAuthError({
              message: `Failed to remove credentials for alias "${alias}": ${cause instanceof Error ? cause.message : String(cause)}`,
              hint: `Run \`sn auth list\` to verify whether the Alias remains before retrying: sn auth remove ${shellArg(alias)}.`,
            }),
        });

        return {
          alias,
          removed: true,
        };
      }),
      add: Effect.fn("AliasInventory.add")(function* ({ instanceUrl, alias }) {
        if (!alias || alias.trim().length === 0) {
          return yield* new SnAuthError({
            message: "Alias name must not be empty.",
            hint: "Run `sn auth add <https-origin> --alias <name>` with a non-empty Alias name.",
          });
        }
        const trimmedAlias = alias.trim();

        // Validate and parse explicit HTTPS origin before OAuth or keychain access (Issue 04)
        const { canonicalOrigin, hostname } = yield* parseInstanceOrigin(instanceUrl);

        // Instance Guard check: reject Blocked Instances before OAuth or network access (ADR 0017)
        if (isBlockedHostname(hostname)) {
          return yield* new SnGuardError({
            message: `Instance "${hostname}" is blocked by policy; no request was sent.`,
            hint: "Choose a non-blocked ServiceNow instance origin.",
          });
        }

        // Check if alias already exists; never overwrite
        const existing = yield* fetchAliasPreviews(sdk);
        if (existing.has(trimmedAlias)) {
          return yield* new SnAuthError({
            message: `Alias "${trimmedAlias}" already exists. Run \`sn auth remove ${trimmedAlias}\` before retrying.`,
            hint: `Run: sn auth remove ${shellArg(trimmedAlias)}. Then retry: sn auth add ${shellArg(canonicalOrigin)} --alias ${shellArg(trimmedAlias)}.`,
          });
        }

        // Preserve existing default if one is already designated; otherwise this becomes default (Issue 04)
        const hasDefault = Array.from(existing.values()).some((preview) => preview.isDefault);
        const isDefault = !hasDefault;

        const { loginOAuth, storeCredentials } = sdk;

        const creds = yield* Effect.tryPromise({
          try: () => loginOAuth(canonicalOrigin),
          catch: (cause) =>
            new SnAuthError({
              message: `OAuth login failed for "${canonicalOrigin}": ${cause instanceof Error ? cause.message : String(cause)}`,
              hint: `Retry to restart browser authentication: sn auth add ${shellArg(canonicalOrigin)} --alias ${shellArg(trimmedAlias)}.`,
            }),
        });

        if (!creds) {
          return yield* new SnAuthError({
            message: `OAuth login failed or was cancelled for "${canonicalOrigin}".`,
            hint: `Retry to restart browser authentication: sn auth add ${shellArg(canonicalOrigin)} --alias ${shellArg(trimmedAlias)}.`,
          });
        }

        yield* Effect.tryPromise({
          try: () => storeCredentials(trimmedAlias, creds, isDefault),
          catch: (cause) =>
            new SnAuthError({
              message: `Failed to store credentials for alias "${trimmedAlias}": ${cause instanceof Error ? cause.message : String(cause)}`,
              hint: `Run \`sn auth list\` to verify whether the Alias was stored before retrying: sn auth add ${shellArg(canonicalOrigin)} --alias ${shellArg(trimmedAlias)}.`,
            }),
        });

        return {
          alias: trimmedAlias,
          instanceUrl: canonicalOrigin,
          isDefault,
        };
      }),
    }),
  );

/** Live Alias inventory backed by the machine keychain. */
export const aliasInventoryLayer: Layer.Layer<AliasInventory> = makeAliasInventoryLayer(liveSdk);

/** Optional `--alias` from the CLI (overrides SDK default). */
export const AliasFlag: Context.Reference<Option.Option<string>> = Context.Reference(
  "sn/AliasFlag",
  {
    defaultValue: () => Option.none(),
  },
);

/** Global `--yes` / `-y` flag (skips default-Alias confirmation). */
export const YesFlag: Context.Reference<boolean> = Context.Reference("sn/YesFlag", {
  defaultValue: () => false,
});

/** Pure decision tags for default-Alias selection. */
export type AliasSelectionDecision =
  | { readonly _tag: "explicit"; readonly alias: string }
  | { readonly _tag: "proceed" }
  | { readonly _tag: "prompt" }
  | { readonly _tag: "announce" };

/**
 * Pure policy for default-Alias selection (ADR 0018 / Issue 02).
 *
 * Matrix:
 * - Explicit `--alias` -> use that alias directly (no prompt/announce).
 * - Default alias in TTY -> prompt on stderr unless `--yes` is set.
 * - Default alias in non-TTY -> announce on stderr and proceed.
 */
export const decideAliasSelection = (input: {
  readonly explicitAlias: Option.Option<string>;
  readonly isTTY: boolean;
  readonly yes: boolean;
}): AliasSelectionDecision => {
  if (Option.isSome(input.explicitAlias)) {
    return { _tag: "explicit", alias: input.explicitAlias.value };
  }
  if (input.isTTY) {
    return input.yes ? { _tag: "proceed" } : { _tag: "prompt" };
  }
  return { _tag: "announce" };
};

/** Provide auth context (alias and yes) to a client effect. */
export const withAuth =
  (options: { readonly alias: Option.Option<string>; readonly yes: boolean }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.provideService(AliasFlag, options.alias),
      Effect.provideService(YesFlag, options.yes),
    );

/**
 * Resolves the current access token from Now SDK OAuth Aliases (ADR 0018).
 *
 * Enforces Instance Guard before token refresh and network access (ADR 0017).
 * Pre-flights Now SDK `expires_at` and, when inside the refresh window, calls
 * `refreshAccessToken` under try/catch so a failed refresh becomes a tagged
 * error instead of whatever the SDK does in its catch path (ADR 0001 / ADR 0007).
 */
export class TokenSource extends Context.Service<
  TokenSource,
  {
    readonly get: () => Effect.Effect<Token, SnAuthError | SnGuardError>;
  }
>()("sn/servicenow/TokenSource") {}

const unresolvedAliasError = Effect.fn("unresolvedAliasError")(function* (
  sdk: AuthSdk,
  wanted: string | undefined,
) {
  const available = yield* fetchAliasPreviews(sdk);
  const wantedText =
    wanted === undefined ? "No default Now SDK alias is set" : `Unknown Now SDK alias "${wanted}"`;
  return yield* new SnAuthError({
    message: `${wantedText}. Available aliases: ${formatAliasList(available)}. Create one with \`sn auth add <https-origin> --alias <name>\`.`,
    hint: "Run `sn auth list`; select an Alias with `--alias <alias>` or create one with `sn auth add <https-origin> --alias <name>`.",
  });
});

const toToken = (instanceUrl: string, accessToken: string, expiresAt: number) =>
  ({
    instanceUrl,
    accessToken: Redacted.make(accessToken),
    expiresAt,
  }) satisfies Token;

const getNowSdkToken = Effect.fn("getNowSdkToken")(function* (
  sdk: AuthSdk,
  alias: string | undefined,
  decision: AliasSelectionDecision,
  confirm: typeof AliasConfirm.Service,
) {
  const stored = yield* Effect.tryPromise({
    try: () => sdk.getStored(alias),
    catch: (cause) =>
      new SnAuthError({
        message: `Failed to read Now SDK credentials: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

  if (!stored) {
    return yield* unresolvedAliasError(sdk, alias);
  }

  if (stored.creds.type !== "oauth") {
    return yield* new SnAuthError({
      message: `Alias "${stored.alias}" is not OAuth. Run \`sn auth remove ${stored.alias}\`, then recreate it with \`sn auth add <https-origin> --alias ${stored.alias}\`.`,
      hint: `Run: sn auth remove ${shellArg(stored.alias)}. Then run: sn auth add <https-origin> --alias ${shellArg(stored.alias)}.`,
    });
  }

  const { creds, alias: storedAlias, isDefault } = stored;

  // Pre-refresh Instance Guard check: reject before refresh or any network access (ADR 0017)
  const hostname = yield* assertInstanceAllowed(creds.instanceUrl);

  if (decision._tag === "prompt") {
    yield* confirm.writePrompt(
      `Using default Now SDK alias "${storedAlias}" (${hostname}). Continue? [y/N] `,
    );
    const answer = (yield* confirm.readLine).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      return yield* new SnAuthError({
        message: `Default Now SDK alias "${storedAlias}" confirmation not accepted. Specify an explicit target with \`--alias <alias>\`.`,
        hint: "Specify the target explicitly with `--alias <alias>`.",
      });
    }
  } else if (decision._tag === "announce") {
    yield* confirm.writePrompt(`Using default Now SDK alias "${storedAlias}" (${hostname})`);
  }

  if (!isInsideSdkRefreshWindow(creds.expires_at)) {
    return toToken(creds.instanceUrl, creds.access_token, creds.expires_at);
  }

  const newTokens = yield* Effect.tryPromise({
    try: () => sdk.refreshAccessToken(creds),
    catch: (cause) =>
      new SnAuthError({
        message: `Token refresh failed for alias "${storedAlias}": ${cause instanceof Error ? cause.message : String(cause)}. Re-authenticate: run \`sn auth remove ${storedAlias}\`, then \`sn auth add https://${hostname} --alias ${storedAlias}\`.`,
        hint: `Run: sn auth remove ${shellArg(storedAlias)}. Then run: sn auth add ${shellArg(`https://${hostname}`)} --alias ${shellArg(storedAlias)}.`,
      }),
  });

  if (!newTokens?.access_token) {
    return yield* new SnAuthError({
      message: `Token for alias "${storedAlias}" is inside the refresh window but could not be renewed. Re-authenticate: run \`sn auth remove ${storedAlias}\`, then \`sn auth add https://${hostname} --alias ${storedAlias}\`.`,
      hint: `Run: sn auth remove ${shellArg(storedAlias)}. Then run: sn auth add ${shellArg(`https://${hostname}`)} --alias ${shellArg(storedAlias)}.`,
    });
  }

  const updated: OauthCreds = { ...creds, ...newTokens, type: "oauth" };

  // Post-refresh Instance Guard check: verify refreshed instance URL before persisting or returning
  yield* assertInstanceAllowed(updated.instanceUrl);

  yield* Effect.tryPromise({
    try: () => sdk.storeCredentials(storedAlias, updated, isDefault),
    catch: (cause) =>
      new SnAuthError({
        message: `Refreshed token but failed to persist it for alias "${storedAlias}": ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

  return toToken(updated.instanceUrl, updated.access_token, updated.expires_at);
});

const makeGetToken = (sdk: AuthSdk) =>
  Effect.fn("TokenSource.get")(function* () {
    const aliasFlag = yield* AliasFlag;
    const yes = yield* YesFlag;
    const confirm = yield* AliasConfirm;

    const decision = decideAliasSelection({
      explicitAlias: aliasFlag,
      isTTY: confirm.isTTY,
      yes,
    });

    const wantedAlias = decision._tag === "explicit" ? decision.alias : undefined;
    const token = yield* getNowSdkToken(sdk, wantedAlias, decision, confirm);
    // Postcondition check: ensure the returned token is never for a Blocked Instance
    yield* assertInstanceAllowed(token.instanceUrl);
    return token;
  });

/** Build a TokenSource layer from an AuthSdk (tests). */
export const makeTokenSourceLayer = (sdk: AuthSdk): Layer.Layer<TokenSource> =>
  Layer.succeed(TokenSource, TokenSource.of({ get: () => makeGetToken(sdk)() }));

/** Live token source: serve tokens via liveSdk. */
export const tokenSourceLayer: Layer.Layer<TokenSource> = makeTokenSourceLayer(liveSdk);
