/**
 * P9-18 (storage/local.driver): the fsync policy calls fsync.
 *
 * Found by a planted defect during the conversion. With the `handle.sync()`
 * call disabled, every suite stayed green. storage.local.test.js "fsyncs when
 * configured" checks only the written size, and a write that is never synced
 * has the same size. An unsynced write on an NFS client can be lost on a
 * server reboot even though it reported success, so this test watches the
 * file handle itself: sync is called once when the policy is on, never when
 * it is off, and before the handle is closed.
 */
import fsp from "fs/promises";
import os from "os";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the driver is a CommonJS `export =` class
const LocalDriver = require("../../services/storage/local.driver") as new (config: {
  root: string;
  fsync?: boolean;
  name?: string;
}) => { put: (key: string, body: Buffer) => Promise<unknown> };

const KEY = "t/tenant-1/attachments/report.pdf";

let base: string;
let root: string;
let events: string[];

beforeEach(async () => {
  base = await fsp.mkdtemp(path.join(os.tmpdir(), "storage-fsync-"));
  root = path.join(base, "root");
  await fsp.mkdir(root, { recursive: true });
  events = [];
  const realOpen = fsp.open.bind(fsp);
  jest.spyOn(fsp, "open").mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
    const handle = await realOpen(...args);
    const realSync = handle.sync.bind(handle);
    const realClose = handle.close.bind(handle);
    handle.sync = async () => {
      events.push("sync");
      return realSync();
    };
    handle.close = async () => {
      events.push("close");
      return realClose();
    };
    return handle;
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fsp.rm(base, { recursive: true, force: true });
});

describe("local driver — the fsync policy", () => {
  it("syncs the written file before closing it when fsync is on (NFS)", async () => {
    const nfs = new LocalDriver({ root, name: "nfs", fsync: true });
    await nfs.put(KEY, Buffer.from("durable"));
    expect(events).toEqual(["sync", "close"]);
  });

  it("does not sync when fsync is off (local)", async () => {
    const local = new LocalDriver({ root });
    await local.put(KEY, Buffer.from("fast"));
    expect(events).toEqual(["close"]);
  });
});
