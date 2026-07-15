import { Data } from "effect";

export class HttpRequestError extends Data.TaggedError("HttpRequestError")<{
  readonly method: string;
  readonly url: string;
  readonly cause: unknown;
}> {}

export class HttpResponseError extends Data.TaggedError("HttpResponseError")<{
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}> {}

export class ResponseDecodeError extends Data.TaggedError("ResponseDecodeError")<{
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly cause: unknown;
}> {}

export type DistilledError =
  | HttpRequestError
  | HttpResponseError
  | ResponseDecodeError;
