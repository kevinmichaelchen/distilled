import { Context, Effect, Layer } from "effect";
import {
  HttpRequestError,
  HttpResponseError,
  ResponseDecodeError,
  type DistilledError,
} from "./errors";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface RequestDescriptor {
  readonly method: HttpMethod;
  readonly path: string;
  readonly pathParams?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

export interface DistilledClientService {
  readonly request: <A>(
    descriptor: RequestDescriptor,
  ) => Effect.Effect<A, DistilledError>;
}

export class DistilledClient extends Context.Tag("@kevinmichaelchen/distilled/Client")<
  DistilledClient,
  DistilledClientService
>() {}

export interface FetchClientOptions {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

const appendQueryValue = (url: URL, key: string, value: unknown): void => {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(url, key, item);
    return;
  }
  url.searchParams.append(key, String(value));
};

export const buildUrl = (
  baseUrl: string,
  path: string,
  pathParams: Readonly<Record<string, unknown>> = {},
  query: Readonly<Record<string, unknown>> = {},
): URL => {
  const resolvedPath = path.replaceAll(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = pathParams[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter: ${name}`);
    }
    return encodeURIComponent(String(value));
  });
  const url = new URL(resolvedPath.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  for (const [key, value] of Object.entries(query)) appendQueryValue(url, key, value);
  return url;
};

const decodeBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("json") ? JSON.parse(text) : text;
};

export const makeFetchClient = (options: FetchClientOptions): DistilledClientService => {
  const fetch = options.fetch ?? globalThis.fetch;
  return {
    request: <A>(descriptor: RequestDescriptor) =>
      Effect.tryPromise({
        try: async () => {
          const url = buildUrl(
            options.baseUrl,
            descriptor.path,
            descriptor.pathParams,
            descriptor.query,
          );
          const headers = new Headers(options.headers);
          for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
            if (value !== undefined && value !== null) headers.set(key, String(value));
          }
          let body: BodyInit | undefined;
          if (descriptor.body !== undefined) {
            headers.set("content-type", "application/json");
            body = JSON.stringify(descriptor.body);
          }

          let response: Response;
          try {
            response = await fetch(url, {
              method: descriptor.method,
              headers,
              ...(body === undefined ? {} : { body }),
            });
          } catch (cause) {
            throw new HttpRequestError({
              method: descriptor.method,
              url: url.toString(),
              cause,
            });
          }

          let decoded: unknown;
          try {
            decoded = await decodeBody(response);
          } catch (cause) {
            throw new ResponseDecodeError({
              method: descriptor.method,
              url: url.toString(),
              status: response.status,
              cause,
            });
          }

          if (!response.ok) {
            throw new HttpResponseError({
              method: descriptor.method,
              url: url.toString(),
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              body: decoded,
            });
          }
          return decoded as A;
        },
        catch: (cause) =>
          cause instanceof HttpRequestError ||
          cause instanceof HttpResponseError ||
          cause instanceof ResponseDecodeError
            ? cause
            : new HttpRequestError({
                method: descriptor.method,
                url: `${options.baseUrl}${descriptor.path}`,
                cause,
              }),
      }),
  };
};

export const fetchClientLayer = (options: FetchClientOptions) =>
  Layer.succeed(DistilledClient, makeFetchClient(options));
