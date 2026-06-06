import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { postAnomaly, readDaemonCredentials } from "./anomaly-capture.js";

const creds = { base_url: "http://127.0.0.1:7373", token: "secret-token" };
const fakeGet = (store: Record<string, unknown>) => async (key: string) => ({ [key]: store[key] });

describe("readDaemonCredentials", () => {
  it("reads the paired daemon credentials from storage", async () => {
    const result = await readDaemonCredentials(fakeGet({ "loupe:v1:daemon": creds }));
    assert.deepEqual(result, creds);
  });

  it("returns undefined when unpaired or malformed", async () => {
    assert.equal(await readDaemonCredentials(fakeGet({})), undefined);
    assert.equal(await readDaemonCredentials(fakeGet({ "loupe:v1:daemon": { base_url: "x" } })), undefined);
    assert.equal(await readDaemonCredentials(fakeGet({ "loupe:v1:daemon": { base_url: "", token: "t" } })), undefined);
  });
});

describe("postAnomaly", () => {
  const report = { schema_version: 1, source: "manual", summary: "wrong pin", breadcrumbs: [], env: {} };

  it("POSTs with the bearer token and returns the created id", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const result = await postAnomaly(
      async (url, init) => {
        calls.push({ url, init });
        return Response.json({ anomaly: { id: "anomaly-1" } });
      },
      creds,
      report,
    );

    assert.deepEqual(result, { ok: true, id: "anomaly-1" });
    assert.equal(calls[0]?.url, "http://127.0.0.1:7373/v1/anomalies");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer secret-token");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), report);
  });

  it("returns an error on a non-ok response without throwing", async () => {
    const result = await postAnomaly(async () => new Response("nope", { status: 500 }), creds, report);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /500/);
  });

  it("returns an error when the fetch throws", async () => {
    const result = await postAnomaly(async () => {
      throw new Error("network down");
    }, creds, report);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /network down/);
  });
});
