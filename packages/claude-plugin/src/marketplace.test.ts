import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMarketplaceManifest } from "./marketplace.js";

const validManifest = {
  name: "loupe-plugins",
  owner: {
    name: "Loupe",
  },
  plugins: [
    {
      name: "loupe",
      description: "Read DOM marks placed in the browser as precise frontend tasks.",
      source: {
        source: "git-subdir",
        url: "https://github.com/loupe-dev/loupe",
        path: "packages/claude-plugin",
        ref: "main",
      },
    },
  ],
};
const validPlugin = validManifest.plugins[0]!;

describe("marketplace manifest validation", () => {
  it("accepts the PRD marketplace manifest shape", () => {
    assert.deepEqual(validateMarketplaceManifest(validManifest), { ok: true });
  });

  it("accepts a plugin entry without description", () => {
    const pluginWithoutDescription = { name: validPlugin.name, source: validPlugin.source };

    assert.deepEqual(
      validateMarketplaceManifest({
        ...validManifest,
        plugins: [pluginWithoutDescription],
      }),
      { ok: true },
    );
  });

  it("rejects an empty plugin description when present", () => {
    const result = validateMarketplaceManifest({
      ...validManifest,
      plugins: [
        {
          ...validPlugin,
          description: "",
        },
      ],
    });

    assertInvalid(result);
    assert.deepEqual(result.errors, ["manifest.plugins[0].description must be a non-empty string"]);
  });

  it("rejects forbidden plugin entry top-level source aliases", () => {
    const result = validateMarketplaceManifest({
      ...validManifest,
      plugins: [
        {
          ...validPlugin,
          repositoryUrl: "https://github.com/loupe-dev/loupe",
          ref: "main",
          path: "packages/claude-plugin",
          type: "git",
          subdirectory: "packages/claude-plugin",
        },
      ],
    });

    assertInvalid(result);
    assert.deepEqual(result.errors, [
      "manifest.plugins[0].repositoryUrl is not allowed; use manifest.plugins[0].source instead",
      "manifest.plugins[0].ref is not allowed; use manifest.plugins[0].source instead",
      "manifest.plugins[0].path is not allowed; use manifest.plugins[0].source instead",
      "manifest.plugins[0].type is not allowed; use manifest.plugins[0].source instead",
      "manifest.plugins[0].subdirectory is not allowed; use manifest.plugins[0].source instead",
    ]);
  });

  it("rejects missing required source fields", () => {
    const result = validateMarketplaceManifest({
      ...validManifest,
      plugins: [
        {
          ...validPlugin,
          source: {
            source: "git-subdir",
          },
        },
      ],
    });

    assertInvalid(result);
    assert.deepEqual(result.errors, [
      "manifest.plugins[0].source.url must be a non-empty string",
      "manifest.plugins[0].source.path must be a non-empty string",
      "manifest.plugins[0].source.ref must be a non-empty string",
    ]);
  });

  it("rejects non-git-subdir sources", () => {
    const result = validateMarketplaceManifest({
      ...validManifest,
      plugins: [
        {
          ...validPlugin,
          source: {
            ...validPlugin.source,
            source: "git",
          },
        },
      ],
    });

    assertInvalid(result);
    assert.deepEqual(result.errors, ["manifest.plugins[0].source.source must be \"git-subdir\""]);
  });
});

function assertInvalid(result: ReturnType<typeof validateMarketplaceManifest>): asserts result is { ok: false; errors: string[] } {
  assert.equal(result.ok, false);
}
