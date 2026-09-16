import { Context, Effect, Layer, Option, Redacted, Schema, SynchronizedRef } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpMethod from "effect/unstable/http/HttpMethod";

import { TokenSource, tokenSourceLayer } from "./auth.ts";
import { SnAuthError, SnGuardError, SnRequestError } from "./errors.ts";

/** Access token plus the instance it authenticates against. */
export interface Token {
  instanceUrl: string;
  accessToken: Redacted.Redacted<string>;
  /** Unix seconds; present when the credential source exposes it. */
  expiresAt?: number;
}

/** Optional verb/body for requests on the same seam as GET. */
export interface RequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * Single seam for all ServiceNow HTTP access. Owns the token cache, the
 * conditional 401 refresh-and-retry-once, and non-2xx error parsing.
 * See docs/adr/0001-servicenow-client-seam.md.
 */
export class SnClient extends Context.Service<
  SnClient,
  {
    readonly request: (
      path: string,
      params?: Record<string, string>,
      options?: RequestOptions,
    ) => Effect.Effect<Schema.Json, SnRequestError | SnAuthError | SnGuardError>;
  }
>()("sn/servicenow/SnClient") {}

const ServiceNowErrorMessageBody = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
  }),
});

const ServiceNowErrorDetailBody = Schema.Struct({
  error: Schema.Struct({
    detail: Schema.NullOr(Schema.String),
  }),
});

const parseSnError = Effect.fn("SnClient.parseSnError")(function* (response: {
  readonly status: number;
  readonly json: Effect.Effect<unknown, unknown>;
}) {
  const body = yield* response.json.pipe(Effect.orElseSucceed(() => null));
  const message = Option.getOrUndefined(
    Schema.decodeUnknownOption(ServiceNowErrorMessageBody)(body),
  )?.error.message;
  const detail =
    Option.getOrUndefined(Schema.decodeUnknownOption(ServiceNowErrorDetailBody)(body))?.error
      .detail ?? undefined;
  const errorMessage =
    message ?? detail ?? `ServiceNow request failed with status ${response.status}`;
  if (detail === undefined) {
    return new SnRequestError({
      message: errorMessage,
      status: response.status,
    });
  }
  return new SnRequestError({
    message: errorMessage,
    detail,
    status: response.status,
  });
});

const makeAuthedClient = (
  base: HttpClient.HttpClient,
  tokenRef: SynchronizedRef.SynchronizedRef<Token | null>,
  tokens: TokenSource["Service"],
) => {
  const ensureToken = Effect.fn("SnClient.ensureToken")(function* () {
    return yield* SynchronizedRef.updateAndGetEffect(tokenRef, (cached) =>
      cached !== null
        ? Effect.succeed(cached)
        : tokens.get().pipe(Effect.map((t): Token | null => t)),
    ).pipe(
      Effect.flatMap((token) =>
        token !== null
          ? Effect.succeed(token)
          : new SnAuthError({ message: "Token source returned no token" }),
      ),
    );
  });

  const withBearer = (token: Token) =>
    base.pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(token.instanceUrl)),
      HttpClient.mapRequest(HttpClientRequest.bearerToken(token.accessToken)),
      HttpClient.mapRequest(HttpClientRequest.acceptJson),
    );

  const send = Effect.fn("SnClient.send")(function* (
    token: Token,
    path: string,
    params: Record<string, string> | undefined,
    options: RequestOptions | undefined,
  ) {
    const rawMethod = options?.method ?? "GET";
    if (!HttpMethod.isHttpMethod(rawMethod)) {
      return yield* new SnRequestError({
        message: `Unsupported HTTP method: ${rawMethod}`,
      });
    }
    let request = HttpClientRequest.make(rawMethod)(path);
    if (params && Object.keys(params).length > 0) {
      request = HttpClientRequest.setUrlParams(request, params);
    }
    if (options?.body !== undefined) {
      request = yield* HttpClientRequest.bodyJson(request, options.body).pipe(
        Effect.mapError(
          (cause) =>
            new SnRequestError({
              message: `Failed to encode request body: ${String(cause)}`,
            }),
        ),
      );
    }

    return yield* withBearer(token)
      .execute(request)
      .pipe(
        Effect.mapError(
          (cause) =>
            new SnRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        ),
      );
  });

  const refreshToken = Effect.fn("SnClient.refreshToken")(function* (previous: Token) {
    const next = yield* SynchronizedRef.updateAndGetEffect(tokenRef, () =>
      tokens.get().pipe(Effect.map((t): Token | null => t)),
    ).pipe(
      Effect.flatMap((token) =>
        token !== null
          ? Effect.succeed(token)
          : new SnAuthError({
              message: "Token source returned no token during refresh",
            }),
      ),
    );
    if (Redacted.value(next.accessToken) === Redacted.value(previous.accessToken)) {
      return yield* new SnAuthError({
        message:
          "ServiceNow rejected the token (401) but it is not expired, so it was probably revoked. Recreate the Alias with `sn auth remove <alias>` and `sn auth add <https-origin> --alias <alias>`.",
        hint: "Run `sn auth remove <alias>`, then `sn auth add <https-origin> --alias <alias>`.",
      });
    }
    return next;
  });

  const request = Effect.fn("SnClient.request")(function* (
    path: string,
    params?: Record<string, string>,
    options?: RequestOptions,
  ) {
    let token = yield* ensureToken();
    let response = yield* send(token, path, params, options);

    if (response.status === 401) {
      token = yield* refreshToken(token);
      response = yield* send(token, path, params, options);
      if (response.status === 401) {
        return yield* new SnAuthError({
          message:
            "ServiceNow rejected the credentials after a token refresh (401). Recreate the Alias with `sn auth remove <alias>` and `sn auth add <https-origin> --alias <alias>`.",
          hint: "Run `sn auth remove <alias>`, then `sn auth add <https-origin> --alias <alias>`.",
        });
      }
    }

    if (response.status < 200 || response.status >= 300) {
      const error = yield* parseSnError(response);
      return yield* error;
    }

    if (response.status === 204) {
      return null;
    }

    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
      Effect.mapError(
        (cause) =>
          new SnRequestError({
            message: `Failed to parse ServiceNow JSON: ${String(cause)}`,
            status: response.status,
          }),
      ),
    );
  });

  return SnClient.of({ request });
};

/** SnClient layer requiring a TokenSource and HttpClient. */
export const snClientLayer: Layer.Layer<SnClient, never, TokenSource | HttpClient.HttpClient> =
  Layer.effect(
    SnClient,
    Effect.gen(function* () {
      const tokens = yield* TokenSource;
      const base = yield* HttpClient.HttpClient;
      const tokenRef = yield* SynchronizedRef.make<Token | null>(null);
      return makeAuthedClient(base, tokenRef, tokens);
    }),
  );

/** Live SnClient with FetchHttpClient and the live TokenSource. */
export const snClientLive = snClientLayer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(tokenSourceLayer),
);
