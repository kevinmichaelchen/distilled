import { describe, expect, test } from "bun:test";
import { buildUrl } from "../src/client";

describe("buildUrl", () => {
  test("encodes path parameters and repeated query parameters", () => {
    const url = buildUrl(
      "https://example.atlassian.net",
      "/rest/api/3/issue/{issueIdOrKey}",
      { issueIdOrKey: "ABC 123" },
      { expand: ["names", "schema"], notifyUsers: false },
    );
    expect(url.toString()).toBe(
      "https://example.atlassian.net/rest/api/3/issue/ABC%20123?expand=names&expand=schema&notifyUsers=false",
    );
  });
});
