/**
 * P9-18 (storage/s3.driver, four gates): the S3 driver addresses only
 * validated keys inside its configured prefix.
 *
 * Found by planted defects during the conversion. Two plants left every
 * storage suite green:
 * - skipping `normalizeKey` let a traversal key ("../other-tenant/x") or an
 *   empty key reach the bucket;
 * - listing with no prefix dropped the configured bucket prefix, so a
 *   "list everything" read the whole bucket rather than this store's part of
 *   it.
 * Both are how one tenant's store could address another's objects in a
 * shared bucket. The expected keys are written here by hand.
 */
const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const command = (type: string): jest.Mock =>
    jest.fn(function Command(this: { __type: string; input: unknown }, input: unknown) {
      this.__type = type;
      this.input = input;
    });
  return {
    S3Client: jest.fn(function S3Client(this: { send: jest.Mock }) {
      this.send = mockSend;
    }),
    PutObjectCommand: command("Put"),
    GetObjectCommand: command("Get"),
    HeadObjectCommand: command("Head"),
    DeleteObjectCommand: command("Delete"),
    ListObjectsV2Command: command("List"),
  };
});
jest.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: jest.fn() }));

interface Driver {
  get(key: unknown): Promise<unknown>;
  delete(key: unknown): Promise<unknown>;
  list(prefix?: string | null): Promise<unknown>;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const S3Driver = require("../../services/storage/s3.driver") as new (config: { bucket: string; prefix?: string }) => Driver;

const lastInput = (): Record<string, unknown> => {
  const calls = mockSend.mock.calls as [{ input: Record<string, unknown> }][];
  return (calls[calls.length - 1] as [{ input: Record<string, unknown> }])[0].input;
};

describe("s3 driver — keys stay validated and inside the prefix", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  it.each(["../t/other/x.pdf", "t/1/../../t/2/x.pdf", "", "t\\1\\x"])(
    "refuses the key %j before any request is sent",
    async (key) => {
      const driver = new S3Driver({ bucket: "shared", prefix: "store-a" });
      await expect(driver.get(key)).rejects.toMatchObject({ status: 400 });
      await expect(driver.delete(key)).rejects.toMatchObject({ status: 400 });
      expect(mockSend).not.toHaveBeenCalled();
    },
  );

  it("a valid key is sent under the configured prefix", async () => {
    const driver = new S3Driver({ bucket: "shared", prefix: "store-a/" });
    await driver.delete("t/1/attachments/a.pdf");
    expect(lastInput()).toEqual({ Bucket: "shared", Key: "store-a/t/1/attachments/a.pdf" });
  });

  it.each([undefined, null, ""])("listing everything (%j) stays inside the configured prefix", async (prefix) => {
    mockSend.mockResolvedValue({ Contents: [] });
    const driver = new S3Driver({ bucket: "shared", prefix: "store-a" });
    await driver.list(prefix);
    expect(lastInput()["Prefix"]).toBe("store-a/");
  });
});
