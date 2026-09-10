/**
 * Test utilities — helpers for creating mock req/res/next, models, transactions,
 * and utility functions commonly used across unit tests.
 */

/**
 * Create a mock Express `res` object with chainable .status(), .json(), etc.
 * @param {Object} options - Optional custom properties
 * @returns {Object}
 */
function createMockRes(options = {}) {
  const res = {
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
  res.status.mockImplementation((code) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

/**
 * Create a mock Express `req` object.
 * @param {Object} overrides - Properties to override on the mock req
 * @returns {Object}
 */
function createMockReq(overrides = {}) {
  const req = {
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
 * @returns {Function}
 */
function createMockNext() {
  const next = jest.fn();
  return next;
}

/**
 * Create a mock Sequelize model with common methods.
 * @param {Object} overrides - Additional static methods to mock
 * @returns {Object}
 */
function createMockModel(overrides = {}) {
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
 * @returns {Object}
 */
function createMockTransaction() {
  const mockTransaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  return mockTransaction;
}

/**
 * Wait for a specified number of milliseconds.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock function that always rejects with the given error.
 * @param {Error} error - The error to reject with
 * @returns {Function}
 */
function mockThrow(error) {
  return jest.fn().mockRejectedValue(error);
}

/**
 * Create a mock function that always resolves with the given value.
 * @param {*} value - The value to resolve with
 * @returns {Function}
 */
function mockResolve(value) {
  return jest.fn().mockResolvedValue(value);
}

module.exports = {
  createMockRes,
  createMockReq,
  createMockNext,
  createMockModel,
  createMockTransaction,
  wait,
  mockThrow,
  mockResolve,
};
