
/**
 * Test utilities — helpers for creating mock req/res/next, models, transactions,
 * and utility functions commonly used across unit tests.
 */

/**
 * Create a mock Express `res` object with chainable .status(), .json(), etc.
 */
export function createMockRes(options: Record<string, any> = {}): any {
  const res: any = {
    statusCode: 200,
    headers: {},
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    locals: {},
    ...options,
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

/**
 * Create a mock Express `req` object.
 */
export function createMockReq(overrides: Record<string, any> = {}): any {
  const req: any = {
    body: {},
    query: {},
    params: {},
    user: null,
    headers: {},
    ip: "127.0.0.1",
    ...overrides,
  };
  return req;
}

/**
 * Create a mock `next` function for Express middleware tests.
 */
export function createMockNext(): jest.Mock {
  const next = jest.fn();
  return next;
}

/**
 * Create a mock Sequelize model with common methods.
 */
export function createMockModel(overrides: Record<string, any> = {}): any {
  return {
    findOne: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    count: jest.fn(),
    ...overrides,
  };
}

/**
 * Create a mock Sequelize transaction object.
 */
export function createMockTransaction(): any {
  const mockTransaction: any = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  return mockTransaction;
}

/**
 * Wait for a specified number of milliseconds.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock function that always rejects with the given error.
 */
export function mockThrow(error: Error): jest.Mock {
  return jest.fn().mockRejectedValue(error);
}

/**
 * Create a mock function that always resolves with the given value.
 */
export function mockResolve(value: any): jest.Mock {
  return jest.fn().mockResolvedValue(value);
}
