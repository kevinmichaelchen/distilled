import { describe, expect, test } from "bun:test";
import * as Core from "../src/index.ts";
import * as API from "../src/api.ts";
import * as ProtocolHttp from "../src/protocol-http.ts";
import * as Trait from "../src/trait.ts";

describe("public core", () => {
  test("exports the protocol architecture from the root", () => {
    expect(Core.API.make).toBe(API.make);
    expect(Core.ProtocolHttp.buildRequest).toBe(ProtocolHttp.buildRequest);
    expect(Core.Trait.Http).toBe(Trait.Http);
    expect(typeof API.Protocol).toBe("function");
  });

  test("supports every OpenAPI HTTP method", () => {
    const methods: Trait.HttpTrait["method"][] = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
      "TRACE",
    ];
    expect(methods).toHaveLength(8);
  });
});
