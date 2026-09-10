/**
 * Tests for test.utils.js utilities
 */

const {
  createMockRes,
  createMockReq,
  createMockNext,
  createMockModel,
  createMockTransaction,
  wait,
  mockThrow,
  mockResolve,
} = require("../test.utils");

describe("createMockRes", () => {
  it("should return an object with mock methods", () => {
    const res = createMockRes();

    expect(res.status).toBeDefined();
    expect(res.json).toBeDefined();
    expect(res.send).toBeDefined();
    expect(res.set).toBeDefined();
    expect(res.end).toBeDefined();
  });

  it("should chain method calls", () => {
    const res = createMockRes();

    res.status(200).json({ success: true });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe("createMockReq", () => {
  it("should return an object with default properties", () => {
    const req = createMockReq();

    expect(req.body).toEqual({});
    expect(req.query).toEqual({});
    expect(req.params).toEqual({});
    expect(req.user).toBeNull();
    expect(req.ip).toBe("127.0.0.1");
  });

  it("should accept custom properties", () => {
    const req = createMockReq({
      body: { username: "test" },
      user: { id: 1 },
    });

    expect(req.body).toEqual({ username: "test" });
    expect(req.user).toEqual({ id: 1 });
  });
});

describe("createMockNext", () => {
  it("should return a mock function", () => {
    const next = createMockNext();

    expect(typeof next).toBe("function");
    expect(next).toBeDefined();
    expect(next.mock).toBeDefined();
  });

  it("should track calls", () => {
    const next = createMockNext();

    next();
    next(new Error("Test error"));

    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe("createMockModel", () => {
  it("should return an object with default mock methods", () => {
    const model = createMockModel();

    expect(model.findOne).toBeDefined();
    expect(model.findAndCountAll).toBeDefined();
    expect(model.findByPk).toBeDefined();
    expect(model.create).toBeDefined();
    expect(model.update).toBeDefined();
    expect(model.destroy).toBeDefined();
  });

  it("should allow overriding default methods", () => {
    const mockFn = jest.fn().mockResolvedValue({ id: 1, name: "test" });
    const model = createMockModel({ findByPk: mockFn });

    expect(model.findByPk).toBe(mockFn);
  });
});

describe("createMockTransaction", () => {
  it("should return an object with commit and rollback methods", () => {
    const transaction = createMockTransaction();

    expect(transaction.commit).toBeDefined();
    expect(transaction.rollback).toBeDefined();
  });

  it("should resolve commit and rollback", async () => {
    const transaction = createMockTransaction();

    await transaction.commit();
    await transaction.rollback();

    expect(transaction.commit).toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalled();
  });
});

describe("wait", () => {
  it("should resolve after the specified time", async () => {
    const start = Date.now();
    await wait(10);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(5);
  });

  it("should resolve immediately with 0ms", async () => {
    const start = Date.now();
    await wait(0);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});

describe("mockThrow", () => {
  it("should return a mock that rejects with the error", async () => {
    const error = new Error("Test error");
    const mock = mockThrow(error);

    await expect(mock()).rejects.toThrow("Test error");
  });
});

describe("mockResolve", () => {
  it("should return a mock that resolves with the value", async () => {
    const value = { data: "test" };
    const mock = mockResolve(value);

    const result = await mock();
    expect(result).toEqual(value);
  });
});
