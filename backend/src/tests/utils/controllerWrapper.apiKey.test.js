/**
 * API-key deny-by-default at the controller boundary (A-03)
 *
 * Only `dynamicAccess` reads an API key's scopes. Every other gate treated a
 * key as an ordinary authenticated principal, so a key scoped to
 * `warehouse:read` reached any handler behind a gate of another kind — or
 * behind `auth` alone. These cases cover the chokepoint that refuses it.
 */

const { asyncHandler, asyncHandlerWithMapping } = require("../../utils/controllerWrapper.util");

const makeRes = () => {
  const res = { statusCode: null, body: null, headersSent: false };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    res.headersSent = true;
    return res;
  });
  return res;
};

describe("asyncHandler — API-key authorization (A-03)", () => {
  it("refuses an API key that no gate authorized", async () => {
    const controller = jest.fn();
    const res = makeRes();
    const req = { user: { isApiKey: true, apiKeyScopes: ["warehouse:read"] } };

    await asyncHandler(controller)(req, res, jest.fn());

    expect(controller).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      status: 403,
      message: "This API key is not authorized for this endpoint",
    });
  });

  it("runs the controller when a gate authorized the key", async () => {
    const controller = jest.fn();
    const res = makeRes();
    const req = { user: { isApiKey: true }, apiKeyAuthorized: true };

    await asyncHandler(controller)(req, res, jest.fn());

    expect(controller).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it("does not affect an ordinary user principal", async () => {
    const controller = jest.fn();
    const res = makeRes();

    await asyncHandler(controller)({ user: { id: "u1", role: { name: "USER" } } }, res, jest.fn());

    expect(controller).toHaveBeenCalled();
  });

  it("does not affect an unauthenticated request (auth answers that)", async () => {
    const controller = jest.fn();
    const res = makeRes();

    await asyncHandler(controller)({}, res, jest.fn());

    expect(controller).toHaveBeenCalled();
  });

  it("tolerates being called with no request object", async () => {
    const controller = jest.fn();
    const res = makeRes();

    await asyncHandler(controller)(undefined, res, jest.fn());

    expect(controller).toHaveBeenCalled();
  });
});

describe("asyncHandlerWithMapping — API-key authorization (A-03)", () => {
  it("refuses an API key that no gate authorized", async () => {
    const controller = jest.fn();
    const res = makeRes();

    await asyncHandlerWithMapping(controller, {})({ user: { isApiKey: true } }, res, jest.fn());

    expect(controller).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("runs the controller when a gate authorized the key", async () => {
    const controller = jest.fn().mockResolvedValue(undefined);
    const res = makeRes();

    await asyncHandlerWithMapping(controller, {})(
      { user: { isApiKey: true }, apiKeyAuthorized: true },
      res,
      jest.fn(),
    );

    expect(controller).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });
});
