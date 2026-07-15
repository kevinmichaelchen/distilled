import { describe, expect, test } from "bun:test";
import { makeAPI } from "../src/client.ts";

describe("Alchemy core facade", () => {
  test("pins the runtime entrypoint", () => {
    expect(typeof makeAPI).toBe("function");
  });
});
