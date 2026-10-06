/**
 * P8-01 (ADR-086 Amendment 1) — an in-memory stand-in for `services/storage`,
 * for the unit tests of the services that keep files (attachments, the public
 * image class, backups, GDPR exports).
 *
 * The KEY rules are the real ones: `buildKey`, `assertKeyForTenant` and
 * `scopePrefix` come from `services/storage/keys`, so a service that builds a
 * key for the wrong tenant, or reads another tenant's key, fails here exactly
 * as it would against a real driver (403 from the guard). Only the bytes are
 * fake: they live in a Map. The live proof against SeaweedFS is
 * `scripts/storage/p801-app-path-check.ts`.
 *
 *   jest.mock("../../services/storage", () =>
 *     require("../fixtures/fakeStorage").createFakeStorage());
 *   const storage = require("../../services/storage");
 *   storage.__objects  // Map<key, { body, contentType, modifiedAt }>
 */
import { Readable } from "stream";
import keys from "../../services/storage/keys";

/** One stored object. */
export interface FakeObject {
  body: Buffer;
  contentType: string | null;
  modifiedAt: Date;
}

/** The scoped surface the services call (a subset of ScopedStorage). */
export interface FakeScoped {
  tenantId: string | null;
  provider: string;
  buildKey(input: { domain: string; name: string }): string;
  put(key: unknown, body: Buffer | Readable, options?: { contentType?: string | null }): Promise<{ key: string; size: number }>;
  get(key: unknown, range?: { start: number; end: number } | null): Promise<Readable>;
  stat(key: unknown): Promise<{ key: string; size: number; modifiedAt: Date; etag: null; contentType: string | null }>;
  exists(key: unknown): Promise<boolean>;
  delete(key: unknown): Promise<{ key: string; deleted: true }>;
  list(domain?: string | null): Promise<{ keys: string[] }>;
}

/** The module double. */
export interface FakeStorageModule {
  getTenantStorage: jest.Mock<Promise<FakeScoped>, [string | null | undefined]>;
  getGlobalStorage: jest.Mock<Promise<FakeScoped>, []>;
  keys: typeof keys;
  __objects: Map<string, FakeObject>;
  __failNext: { put: Error | null; delete: Error | null };
  __reset(): void;
}

/** An error shaped like AppError (status + message), without importing it. */
const statusError = (status: number, message: string): Error => Object.assign(new Error(message), { status });

/** Run `fn` asynchronously, as a driver answers: a throw is a rejection. */
const later = <T>(fn: () => T): Promise<T> => Promise.resolve().then(fn);

/** Read a Buffer or a stream (a real one or an event-emitter double) to a Buffer. */
const collect = (body: Buffer | Readable): Promise<Buffer> => {
  if (Buffer.isBuffer(body)) {return Promise.resolve(body);}
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    body.on("end", () => { resolve(Buffer.concat(chunks)); });
    body.on("error", reject);
  });
};

export const createFakeStorage = (): FakeStorageModule => {
  const objects = new Map<string, FakeObject>();
  const failNext: { put: Error | null; delete: Error | null } = { put: null, delete: null };

  const scopedFor = (tenantId: string | null): FakeScoped => {
    const guard = (key: unknown): string => keys.assertKeyForTenant(key, tenantId);
    return {
      tenantId,
      provider: "fake",
      buildKey: ({ domain, name }) => keys.buildKey({ tenantId, domain, name }),
      put: jest.fn(async (key: unknown, body: Buffer | Readable, options: { contentType?: string | null } = {}) => {
        const k = guard(key);
        if (failNext.put) {
          const err = failNext.put;
          failNext.put = null;
          throw err;
        }
        const buffer = await collect(body);
        objects.set(k, { body: buffer, contentType: options.contentType ?? null, modifiedAt: new Date() });
        return { key: k, size: buffer.length };
      }),
      get: jest.fn((key: unknown, range?: { start: number; end: number } | null) => later(() => {
        const object = objects.get(guard(key));
        if (!object) {throw statusError(410, "Stored object is no longer available");}
        const bytes = range ? object.body.subarray(range.start, range.end + 1) : object.body;
        return Readable.from([bytes]);
      })),
      stat: jest.fn((key: unknown) => later(() => {
        const k = guard(key);
        const object = objects.get(k);
        if (!object) {throw statusError(404, "Stored object not found");}
        return { key: k, size: object.body.length, modifiedAt: object.modifiedAt, etag: null, contentType: object.contentType };
      })),
      exists: jest.fn((key: unknown) => later(() => objects.has(guard(key)))),
      delete: jest.fn((key: unknown) => later(() => {
        const k = guard(key);
        if (failNext.delete) {
          const err = failNext.delete;
          failNext.delete = null;
          throw err;
        }
        objects.delete(k);
        return { key: k, deleted: true as const };
      })),
      list: jest.fn((domain: string | null = null) => later(() => {
        const prefix = keys.scopePrefix(tenantId, domain);
        return { keys: [...objects.keys()].filter((k) => k.startsWith(prefix)) };
      })),
    };
  };

  return {
    getTenantStorage: jest.fn((tenantId: string | null | undefined) => later(() => {
      if (!tenantId) {throw statusError(500, "getTenantStorage requires a tenantId");}
      return scopedFor(tenantId);
    })),
    getGlobalStorage: jest.fn(() => later(() => scopedFor(null))),
    keys,
    __objects: objects,
    __failNext: failNext,
    __reset: () => {
      objects.clear();
      failNext.put = null;
      failNext.delete = null;
    },
  };
};
