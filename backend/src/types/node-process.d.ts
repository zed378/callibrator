/**
 * Runtime additions to Node's `process` object (ADR-087).
 *
 * A declaration file: it emits nothing, and neither the babel-jest transform
 * nor `scripts/build-dist.ts` ever reads it. Only the type-check does.
 */
export {};

declare global {
  namespace NodeJS {
    interface Process {
      /** Set by @yao-pkg/pkg inside a packaged binary; absent otherwise (utils/packaged.util.ts). */
      pkg?: unknown;
    }
  }
}
