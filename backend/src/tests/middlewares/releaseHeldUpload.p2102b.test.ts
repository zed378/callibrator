/**
 * P21-02b — `releaseHeldUpload`: a held upload is removed from the quarantine when the response
 * ends (finish, or the client going away), once; a request without a file passes straight on; a
 * file outside the quarantine is refused by the S-17 guard.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { releaseHeldUpload } from "../../middlewares/releaseHeldUpload.middleware";
import { quarantinePath } from "../../utils/upload.util";

const waitGone = async (file: string): Promise<void> => {
  for (let i = 0; i < 50 && fs.existsSync(file); i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("releaseHeldUpload", () => {
  it("removes the quarantined file when the response finishes, and once only", async () => {
    fs.mkdirSync(quarantinePath(), { recursive: true });
    const file = path.join(quarantinePath(), `p2102b-${String(Math.random()).slice(2)}.jpg`);
    fs.writeFileSync(file, "x");
    // The removal's completion callback is awaited, not raced: polling for the file alone let the
    // test end before the callback ran, and the coverage run counted it as never called (CI, 139b9c4).
    const realRm = fs.rm.bind(fs);
    let done: () => void = () => undefined;
    const removed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const rm = jest.spyOn(fs, "rm").mockImplementation(((target: fs.PathLike, options: fs.RmOptions, callback: fs.NoParamCallback) => {
      realRm(target, options, (err) => {
        callback(err);
        done();
      });
    }));
    try {
      const res = new EventEmitter();
      const next = jest.fn<undefined, []>();
      releaseHeldUpload({ file: { path: file } } as unknown as Request, res as unknown as Response, next);
      expect([next.mock.calls.length, fs.existsSync(file)]).toEqual([1, true]);
      res.emit("finish");
      res.emit("close");
      await removed;
      await waitGone(file);
      expect([fs.existsSync(file), rm.mock.calls.length]).toEqual([false, 1]);
    } finally {
      rm.mockRestore();
    }
  });

  it("a request without a file passes on; a file outside the quarantine is refused (500)", () => {
    const next = jest.fn<undefined, []>();
    releaseHeldUpload({} as unknown as Request, new EventEmitter() as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(() => {
      releaseHeldUpload({ file: { path: path.join(os.tmpdir(), "elsewhere.jpg") } } as unknown as Request, new EventEmitter() as unknown as Response, next);
    }).toThrow("Refusing to promote a file that is not in quarantine");
  });
});
