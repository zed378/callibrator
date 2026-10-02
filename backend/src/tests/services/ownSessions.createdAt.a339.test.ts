/**
 * A-339 — GET /api/v1/sessions/mine never answered a session's `createdAt`.
 *
 * `ownSessions.service#listOwnSessions` selected `created_at` by its COLUMN
 * name and read `row.created_at`. A Sequelize instance defines accessors only
 * for model ATTRIBUTES (the Session timestamp attribute is `createdAt`;
 * `underscored: true` renames only the column), so `row.created_at` was
 * `undefined` and the key was dropped from the JSON. The Q-08 suite mocked
 * plain objects carrying `created_at`, the shape no query returns.
 *
 * Here the rows are built by the REAL Session model exactly as `findAll` builds
 * them (`bulkBuild(…, { raw: true })`), keyed by the attributes the service
 * requests — what PostgreSQL returns for that SELECT. Fail-before: `createdAt`
 * was undefined.
 */
import models from "../../models";
import ownSessions from "../../services/ownSessions.service";
import type { UserId } from "../../types/ids";

const CREATED = new Date("2026-09-24T08:00:00Z");
const USER = "a3390000-0000-4000-8000-000000000001" as UserId;
const SESSION = "a3390000-0000-4000-8000-000000000002";

/** The database's value for a requested attribute (by attribute name or column name). */
const COLUMN_VALUES: Record<string, unknown> = {
  id: SESSION,
  ip_address: "203.0.113.4",
  user_agent: "Mozilla/5.0",
  device: null,
  auth_method: "password",
  impersonator_id: null,
  created_at: CREATED,
  createdAt: CREATED,
  last_activity_at: null,
  expired_at: new Date("2099-01-01T00:00:00Z"),
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-339 — /sessions/mine carries each session's creation time", () => {
  it("answers createdAt from a row built the way findAll builds it", async () => {
    const { Sessions } = models;
    jest.spyOn(Sessions, "findAll").mockImplementation(((options: { attributes: string[] }) => {
      const raw = Object.fromEntries(options.attributes.map((a) => [a, COLUMN_VALUES[a]]));
      // Raw column/attribute values, as a SELECT returns them (not creation attributes).
      // bulkBuild's typing wants creation attributes; a raw row is what the SELECT returned.
      const build = Sessions.bulkBuild.bind(Sessions) as (rows: object[], options: object) => unknown;
      return Promise.resolve(build([raw], { raw: true, isNewRecord: false }));
    }) as unknown as typeof Sessions.findAll);

    const result = await ownSessions.listOwnSessions(USER, SESSION);
    const [first] = result.data;
    expect(first?.createdAt).toEqual(CREATED);
    expect(first?.current).toBe(true);
  });
});
