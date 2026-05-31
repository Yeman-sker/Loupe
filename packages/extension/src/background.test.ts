import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide_origin_authorization, request_origin_authorization } from "./background.js";

describe("background origin authorization", () => {
  it("returns denied authorization result when permission request is declined", async () => {
    const requested: string[][] = [];

    const decision = await request_origin_authorization(
      { origin: "https://app.example.test" },
      {},
      async () => false,
      async (origins) => {
        requested.push([...origins]);
        return false;
      },
    );

    assert.deepEqual(requested, [["https://app.example.test/*"]]);
    assert.deepEqual(decision, {
      ok: true,
      authorized: false,
      origin: "https://app.example.test",
      origin_pattern: "https://app.example.test/*",
      error: "Origin permission request was denied",
    });
  });

  it("returns successful request result using the origin permission pattern", async () => {
    const requested: string[][] = [];

    const decision = await request_origin_authorization(
      {},
      { tab: { url: "http://localhost:5173/dashboard" } },
      async () => false,
      async (origins) => {
        requested.push([...origins]);
        return true;
      },
    );

    assert.deepEqual(requested, [["http://localhost:5173/*"]]);
    assert.deepEqual(decision, {
      ok: true,
      authorized: true,
      origin: "http://localhost:5173",
      origin_pattern: "http://localhost:5173/*",
    });
  });

  it("rejects unsupported origins before probing or requesting permissions", async () => {
    let contains_count = 0;
    let request_count = 0;

    const decision = await request_origin_authorization(
      { origin: "chrome://extensions" },
      {},
      async () => {
        contains_count += 1;
        return true;
      },
      async () => {
        request_count += 1;
        return true;
      },
    );

    assert.equal(contains_count, 0);
    assert.equal(request_count, 0);
    assert.deepEqual(decision, {
      ok: false,
      authorized: false,
      origin: "chrome://extensions",
      error: "Unsupported page origin: chrome://extensions",
    });
  });

  it("propagates permission request failure messages", async () => {
    const decision = await request_origin_authorization(
      { origin: "https://app.example.test" },
      {},
      async () => false,
      async () => {
        throw new Error("User gesture required");
      },
    );

    assert.deepEqual(decision, {
      ok: false,
      authorized: false,
      origin: "https://app.example.test",
      error: "User gesture required",
    });
  });

  it("returns missing origin result without probing permissions", async () => {
    let contains_count = 0;

    const decision = await decide_origin_authorization({}, {}, async () => {
      contains_count += 1;
      return true;
    });

    assert.equal(contains_count, 0);
    assert.deepEqual(decision, { ok: false, authorized: false, error: "No page origin available" });
  });

  it("returns already authorized result without requesting permissions", async () => {
    let request_count = 0;

    const decision = await request_origin_authorization(
      { origin: "https://app.example.test" },
      {},
      async () => true,
      async () => {
        request_count += 1;
        return false;
      },
    );

    assert.equal(request_count, 0);
    assert.deepEqual(decision, {
      ok: true,
      authorized: true,
      origin: "https://app.example.test",
      origin_pattern: "https://app.example.test/*",
    });
  });
});
