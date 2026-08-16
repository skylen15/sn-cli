import { createRequire } from "node:module";
import { homedir } from "node:os";

import {
  ConfigProvider,
  Console,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
} from "effect";
import { NodeFileSystem } from "@effect/platform-node";

import type { Token } from "./client.ts";
import { type ResolvedConfig, resolveConfig } from "./config.ts";
import { SnAuthError } from "./errors.ts";

/** Seconds before recorded expiry at which the Now SDK attempts a refresh. */
export const SDK_REFRESH_WINDOW_SECONDS = 15 * 60;

/** True when `expiresAt` is inside the Now SDK's refresh window (or already past). */
export const isInsideSdkRefreshWindow = (
  expiresAt: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean => expiresAt - nowSeconds <= SDK_REFRESH_WINDOW_SECONDS;

type OauthCreds = {
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

type StoredDefault =
  StoredOauth | { alias: string; isDefault: boolean; creds: { type: "basic" } };

/** Secret-free Alias summary from the Now SDK keychain. */
export type AliasPreview = {
  readonly isDefault: boolean;
  readonly instanceUrl: string;
  readonly type: string;
};

/** Testable seam over the Now SDK auth / OAuth modules (ADR 0006). */
export type AuthSdk = {
  readonly getStored: (
    alias: string | undefined,
  ) => Promise<StoredDefault | undefined>;
  readonly refreshAccessToken: (
    creds: OauthCreds,
  ) => Promise<Partial<OauthCreds> | undefined>;
  readonly storeCredentials: (
    alias: string,
    creds: OauthCreds,
    isDefault: boolean,
  ) => Promise<void>;
  readonly fetchCredentials: () => Promise<ReadonlyMap<string, AliasPreview>>;
  readonly getClientCredentialsToken: (
    instanceUrl: string,
    clientId: string,
    clientSecret: string,
  ) => Promise<{
    access_token: string;
    token_type: string;
    refresh_token: string;
    expires_at: number;
  }>;
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
  storeCredentials: (
    alias: string,
    authInfo: OauthCreds,
    isDefault: boolean,
  ) => Promise<void>;
  fetchCredentials: () => Promise<
    Map<string, { isDefault: boolean; instanceUrl: string; type: string }>
  >;
};
// SAFETY: same deep-import boundary as sdkAuth (ADR 0006).
const sdkOauth = require("@servicenow/sdk-cli/dist/auth/OAuth/index.js") as {
  refreshAccessToken: (
    creds: OauthCreds,
  ) => Promise<Partial<OauthCreds> | undefined>;
};
// SAFETY: same deep-import boundary as sdkAuth (ADR 0006).
const sdkClientCredentials =
  require("@servicenow/sdk-cli/dist/auth/OAuth/ClientCredentials.js") as {
    getClientCredentialsToken: (
      instanceUrl: string,
      clientId: string,
      clientSecret: string,
    ) => Promise<{
      access_token: string;
      token_type: string;
      refresh_token: string;
      expires_at: number;
    }>;
  };
// SAFETY: KeyChain is the SDK's own store wrapper; we only call getPassword
// (ADR 0006). Used so named-Alias reads never go through getCredentials.
const { KeyChain } =
  require("@servicenow/sdk-cli/dist/auth/keychain/index.js") as {
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
    const { instanceUrl, access_token, expires_at, token_type, refresh_token } =
      stored.creds;
    // ponytail: SDK oauth blobs are partial in the .d.ts; ceiling is a
    // malformed keychain entry. Upgrade: Schema decode before use.
    if (
      instanceUrl === undefined ||
      access_token === undefined ||
      expires_at === undefined
    ) {
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

const readNamedFromKeychain = async (
  alias: string,
): Promise<StoredDefault | undefined> => {
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

const liveSdk: AuthSdk = {
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
  storeCredentials: (alias, creds, isDefault) =>
    sdkAuth.storeCredentials(alias, creds, isDefault),
  fetchCredentials: () => sdkAuth.fetchCredentials(),
  getClientCredentialsToken: (instanceUrl, clientId, clientSecret) =>
    sdkClientCredentials.getClientCredentialsToken(
      instanceUrl,
      clientId,
      clientSecret,
    ),
};

/** Optional `--alias` from the CLI; wins over `SN_AUTH_ALIAS`. */
export const AliasFlag: Context.Reference<Option.Option<string>> =
  Context.Reference("sn/AliasFlag", {
    defaultValue: () => Option.none(),
  });

/** One-line stderr trust notice for a discovered `.env` (ADR 0005). */
export const formatDotEnvAnnouncement = (
  dotenvPath: string,
  instanceUrl: string,
): string => {
  let host = instanceUrl;
  try {
    host = new URL(instanceUrl).host;
  } catch {
    // ponytail: keep the raw string if instanceUrl isn't a URL
  }
  return `Using config from ${dotenvPath} (instance ${host})`;
};

/**
 * Resolves the current access token from the active auth mode (ADR 0005).
 *
 * Pre-flights Now SDK `expires_at` and, when inside the refresh window, calls
 * `refreshAccessToken` ourselves under try/catch so a failed refresh becomes
 * a tagged error instead of whatever the SDK does in its catch path
 * (ADR 0001 amendment / ADR 0007).
 */
export class TokenSource extends Context.Service<
  TokenSource,
  {
    readonly get: () => Effect.Effect<Token, SnAuthError>;
  }
>()("sn/servicenow/TokenSource") {}

const defaultConfig: ResolvedConfig = {
  origin: { _tag: "none" },
  mode: "now-sdk",
  alias: Option.none(),
};

const formatAliasList = (
  aliases: ReadonlyMap<string, AliasPreview>,
): string => {
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

const unresolvedAliasError = Effect.fn("unresolvedAliasError")(function* (
  sdk: AuthSdk,
  wanted: string | undefined,
) {
  const available = yield* Effect.tryPromise({
    try: () => sdk.fetchCredentials(),
    catch: (cause) =>
      new SnAuthError({
        message: `Failed to list Now SDK aliases: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
  const wantedText =
    wanted === undefined
      ? "No default Now SDK alias is set"
      : `Unknown Now SDK alias "${wanted}"`;
  return yield* new SnAuthError({
    message: `${wantedText}. Available aliases: ${formatAliasList(available)}. Create one with \`pnpm now-sdk:auth\` (or \`now-sdk auth --add <instance>\`).`,
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
      message: `Alias "${stored.alias}" is not OAuth. Re-run \`pnpm now-sdk:auth\`.`,
    });
  }

  const { creds, alias: storedAlias, isDefault } = stored;

  if (!isInsideSdkRefreshWindow(creds.expires_at)) {
    return toToken(creds.instanceUrl, creds.access_token, creds.expires_at);
  }

  const newTokens = yield* Effect.tryPromise({
    try: () => sdk.refreshAccessToken(creds),
    catch: (cause) =>
      new SnAuthError({
        message: `Token refresh failed for alias "${storedAlias}": ${cause instanceof Error ? cause.message : String(cause)}. Re-authenticate with \`pnpm now-sdk:auth\`.`,
      }),
  });

  if (!newTokens?.access_token) {
    return yield* new SnAuthError({
      message: `Token for alias "${storedAlias}" is inside the refresh window but could not be renewed. Re-authenticate with \`pnpm now-sdk:auth\`.`,
    });
  }

  const updated: OauthCreds = { ...creds, ...newTokens, type: "oauth" };
  yield* Effect.tryPromise({
    try: () => sdk.storeCredentials(storedAlias, updated, isDefault),
    catch: (cause) =>
      new SnAuthError({
        message: `Refreshed token but failed to persist it for alias "${storedAlias}": ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

  return toToken(updated.instanceUrl, updated.access_token, updated.expires_at);
});

const getClientCredentialsToken = Effect.fn("getClientCredentialsToken")(
  function* (
    sdk: AuthSdk,
    config: Extract<ResolvedConfig, { mode: "client_credentials" }>,
  ) {
    const tokens = yield* Effect.tryPromise({
      try: () =>
        sdk.getClientCredentialsToken(
          config.instanceUrl,
          config.clientId,
          Redacted.value(config.clientSecret),
        ),
      catch: (cause) => {
        const raw = cause instanceof Error ? cause.message : String(cause);
        // Never echo the secret if a server reflected it into the error body.
        const message = raw.includes(Redacted.value(config.clientSecret))
          ? raw.split(Redacted.value(config.clientSecret)).join("<redacted>")
          : raw;
        return new SnAuthError({
          message: `OAuth client_credentials token request failed: ${message}`,
        });
      },
    });

    return toToken(config.instanceUrl, tokens.access_token, tokens.expires_at);
  },
);

const pickAlias = (
  config: ResolvedConfig,
  flag: Option.Option<string>,
): string | undefined => {
  if (Option.isSome(flag)) {
    return flag.value;
  }
  if (config.mode === "now-sdk" && Option.isSome(config.alias)) {
    return config.alias.value;
  }
  return undefined;
};

const makeGetToken = (sdk: AuthSdk, config: ResolvedConfig) => {
  let announced = false;
  return Effect.fn("TokenSource.get")(function* () {
    const aliasFlag = yield* AliasFlag;
    let token: Token;

    if (config.mode === "client_credentials") {
      token = yield* getClientCredentialsToken(sdk, config);
    } else {
      token = yield* getNowSdkToken(sdk, pickAlias(config, aliasFlag));
    }

    if (!announced && config.origin._tag === "dotenv") {
      announced = true;
      yield* Console.error(
        formatDotEnvAnnouncement(config.origin.path, token.instanceUrl),
      );
    }

    return token;
  });
};

/** Build a TokenSource layer from an AuthSdk and resolved config (tests). */
export const makeTokenSourceLayer = (
  sdk: AuthSdk,
  config: ResolvedConfig = defaultConfig,
): Layer.Layer<TokenSource> =>
  Layer.succeed(
    TokenSource,
    TokenSource.of({ get: () => makeGetToken(sdk, config)() }),
  );

const mapConfigFailure = (cause: unknown): SnAuthError => {
  if (cause instanceof SnAuthError) {
    return cause;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new SnAuthError({
    message: `Failed to resolve config: ${message}`,
  });
};

/** Live token source: resolve config from cwd, then serve tokens. */
export const tokenSourceLayer: Layer.Layer<TokenSource, SnAuthError> =
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* resolveConfig({
        startDir: process.cwd(),
        homeDir: process.env.HOME ?? homedir(),
      }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
        Effect.mapError(mapConfigFailure),
      );
      return makeTokenSourceLayer(liveSdk, config);
    }),
  );
