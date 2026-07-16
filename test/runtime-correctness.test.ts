import { describe, expect, test } from "bun:test";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as S from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as API from "../src/api.ts";
import * as Category from "../src/category.ts";
import * as Pagination from "../src/pagination.ts";
import { buildOutput, buildRequest } from "../src/protocol-http.ts";
import { capped, type Policy } from "../src/retry.ts";
import * as T from "../src/trait.ts";

describe("runtime correctness", () => {
  test("category catchers are reusable and do not mutate captured arguments", () => {
    const failure = {
      message: "unauthorized",
      [Category.categoriesKey]: { [Category.AuthError]: true },
    };
    const catcher = Category.catchErrors(Category.AuthError, () =>
      Effect.succeed("handled"),
    );
    expect(Effect.runSync(catcher(Effect.fail(failure)))).toBe("handled");
    expect(Effect.runSync(catcher(Effect.fail(failure)))).toBe("handled");
  });

  test("capped uses the supplied maximum", () => {
    const step = Effect.runSync(
      Schedule.toStep(
        Schedule.exponential("10 seconds").pipe(capped(Duration.seconds(1))),
      ),
    );
    const [, delay] = Effect.runSync(step(0, undefined));
    expect(Duration.toMillis(delay)).toBe(1_000);
  });

  test("schedule-only retry policies retry operations", () => {
    const Input = S.Struct({}).pipe(T.Http({ method: "GET", uri: "/" }));
    const Output = S.String;
    let attempts = 0;
    const protocol = Layer.succeed(
      API.Protocol,
      API.Protocol.of({
        encode: () =>
          Effect.succeed(HttpClientRequest.get("https://example.test")),
        decode: () =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts < 3
              ? Effect.fail("retry")
              : Effect.succeed("ok");
          }) as Effect.Effect<unknown>,
      }),
    );
    class Retry extends Context.Service<Retry, Policy>()("TestRetry") {}
    const client = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response("ok")),
      ),
    );
    const operation = API.make(() => ({
      input: Input,
      output: Output,
      protocol,
      retry: Retry,
    }));

    const result = Effect.runSync(
      operation({}).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(Retry, { schedule: Schedule.recurs(2) }),
      ),
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("cursor and token pagination stop on repeated continuations", () => {
    let cursorCalls = 0;
    const cursorPages = Effect.runSync(
      Stream.runCollect(
        Pagination.paginateCursor(
          () =>
            Effect.sync(() => ({
              items: [++cursorCalls],
              next: "same-cursor",
            })),
          {},
          {
            mode: "cursor",
            inputToken: "cursor",
            outputToken: "next",
            items: "items",
          },
        ),
      ),
    );
    expect(cursorPages).toHaveLength(2);
    expect(cursorCalls).toBe(2);

    let tokenCalls = 0;
    const tokenPages = Effect.runSync(
      Stream.runCollect(
        Pagination.paginateToken(
          () =>
            Effect.sync(() => ({
              items: [++tokenCalls],
              next: "same-token",
            })),
          {},
          {
            mode: "token",
            inputToken: "token",
            outputToken: "next",
            items: "items",
          },
        ),
      ),
    );
    expect(tokenPages).toHaveLength(2);
    expect(tokenCalls).toBe(2);
  });

  test("HTTP helpers unwrap and wrap Redacted schema members", () => {
    const Input = S.Struct({
      apiKey: S.Redacted(S.String),
    }).pipe(T.Http({ method: "POST", uri: "/tokens" }));
    const request = buildRequest({
      input: { apiKey: Redacted.make("secret") },
      inputAst: Input.ast,
      baseUrl: "https://example.test",
    });
    expect(
      new TextDecoder().decode(
        (request.body as { body: Uint8Array }).body,
      ),
    ).toBe(
      '{"apiKey":"secret"}',
    );

    const Output = S.Struct({ apiKey: S.Redacted(S.String) });
    const output = buildOutput({
      value: { apiKey: "secret" },
      outputAst: Output.ast,
    }) as { apiKey: Redacted.Redacted<string> };
    expect(Redacted.isRedacted(output.apiKey)).toBe(true);
    expect(Redacted.value(output.apiKey)).toBe("secret");
  });
});
