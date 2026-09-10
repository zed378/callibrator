jest.mock("../../services/storageSettings.service", () => ({
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
  clearSettings: jest.fn(),
  testConnection: jest.fn(),
  getUsage: jest.fn(),
}));
jest.mock("../../services/storage", () => ({
  openSignedObject: jest.fn(),
}));
jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, meta, message });
  }),
}));

const { EventEmitter } = require("events");
const settingsService = require("../../services/storageSettings.service");
const storage = require("../../services/storage");
const controller = require("../../controllers/storage.controller");
const { success } = require("../../utils/response.util");

const TENANT = "tenant-1";
let req, res, next;

beforeEach(() => {
  jest.clearAllMocks();
  req = { query: {}, params: {}, body: {}, user: { id: "u1", tenantId: TENANT } };
  res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
    headersSent: false,
  };
  next = jest.fn();
});

describe("storage.controller — settings", () => {
  it("getSettings returns the tenant view", async () => {
    settingsService.getSettings.mockResolvedValue({ provider: "s3" });
    await controller.getSettings(req, res, next);
    expect(settingsService.getSettings).toHaveBeenCalledWith(TENANT);
    expect(success).toHaveBeenCalledWith(
      res,
      { provider: "s3" },
      null,
      "Storage settings retrieved",
      200,
    );
  });

  it("updateSettings passes the body through", async () => {
    req.body = { provider: "s3", bucket: "b" };
    settingsService.updateSettings.mockResolvedValue({ provider: "s3" });
    await controller.updateSettings(req, res, next);
    expect(settingsService.updateSettings).toHaveBeenCalledWith(TENANT, req.body);
    expect(success).toHaveBeenCalledWith(
      res,
      { provider: "s3" },
      null,
      "Storage settings updated",
      200,
    );
  });

  it("clearSettings reverts to default", async () => {
    settingsService.clearSettings.mockResolvedValue({ provider: "default" });
    await controller.clearSettings(req, res, next);
    expect(settingsService.clearSettings).toHaveBeenCalledWith(TENANT);
  });

  it("testConnection reports health", async () => {
    settingsService.testConnection.mockResolvedValue({ ok: true });
    await controller.testConnection(req, res, next);
    expect(success).toHaveBeenCalledWith(
      res,
      { ok: true },
      null,
      "Storage connection tested",
      200,
    );
  });

  it("getUsage reports usage", async () => {
    settingsService.getUsage.mockResolvedValue({ bytes: 10 });
    await controller.getUsage(req, res, next);
    expect(success).toHaveBeenCalledWith(
      res,
      { bytes: 10 },
      null,
      "Storage usage retrieved",
      200,
    );
  });

  it("forwards a service error to next()", async () => {
    settingsService.getSettings.mockRejectedValue(new Error("boom"));
    await controller.getSettings(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });
});

describe("storage.controller — getObject (public stream)", () => {
  const makeStream = () => {
    const s = new EventEmitter();
    s.pipe = jest.fn();
    return s;
  };

  it("streams the object with hardened headers", async () => {
    const stream = makeStream();
    req.query = { key: "t/tenant-1/attachments/a.pdf", token: "tok" };
    storage.openSignedObject.mockResolvedValue({
      stream,
      meta: { contentType: "application/pdf", size: 1234 },
    });

    await controller.getObject(req, res, next);

    expect(storage.openSignedObject).toHaveBeenCalledWith(
      "t/tenant-1/attachments/a.pdf",
      "tok",
    );
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Length", 1234);
    // Never render inline — force download, block MIME sniffing (stored-XSS).
    expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", "attachment");
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it("omits Content-Type/Length when the driver reports none (S3 head gaps)", async () => {
    const stream = makeStream();
    req.query = { key: "global/branding/logo.png", token: "tok" };
    storage.openSignedObject.mockResolvedValue({
      stream,
      meta: { contentType: null, size: null },
    });
    await controller.getObject(req, res, next);
    expect(res.setHeader).not.toHaveBeenCalledWith("Content-Type", expect.anything());
    expect(res.setHeader).not.toHaveBeenCalledWith("Content-Length", expect.anything());
  });

  it("410s when the object vanishes before headers are sent", async () => {
    const stream = makeStream();
    req.query = { key: "t/tenant-1/attachments/a.pdf", token: "tok" };
    storage.openSignedObject.mockResolvedValue({ stream, meta: {} });
    await controller.getObject(req, res, next);

    stream.emit("error", new Error("gone"));
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.end).toHaveBeenCalled();
  });

  it("destroys the connection when the object vanishes mid-stream", async () => {
    const stream = makeStream();
    res.headersSent = true;
    req.query = { key: "t/tenant-1/attachments/a.pdf", token: "tok" };
    storage.openSignedObject.mockResolvedValue({ stream, meta: {} });
    await controller.getObject(req, res, next);

    stream.emit("error", new Error("gone"));
    expect(res.destroy).toHaveBeenCalled();
  });

  it("forwards a rejected token to next() (403 from the service)", async () => {
    req.query = { key: "t/tenant-1/attachments/a.pdf", token: "bad" };
    storage.openSignedObject.mockRejectedValue(
      Object.assign(new Error("Invalid or expired download link"), { status: 403 }),
    );
    await controller.getObject(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});
