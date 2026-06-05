// Type + runtime bridge for src/ui/**. Resolves imports of "./schema.js" both
// in tests (tsx loads this → re-exports via the workspace package) and in the
// browser (dist/ui/schema.js is emitted from packages/shared/src/schema.ts by
// tsconfig.build-lib.json; this file is EXCLUDED from tsconfig.build.json).
export * from "@loupe-server/shared";
