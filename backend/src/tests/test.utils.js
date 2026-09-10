/**
 * Test Utilities
 *
 * Shared helpers for writing consistent tests across the codebase.
 */

/**
 * Create a mock Express response object
 * @returns {Object} Mock res object with stubbed methods
 */
const createMockRes = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    locals: {},
  };
  return res;
};

/**
 * Create a mock Express request object
 * @param {Object} options - Request properties to override
 * @returns {Object} Mock req object
 */
const createMockReq = (options = {}) => {
  const req = {
    body: {},
    query: {},
    params: {},
    user: null,
    headers: {
      authorization: null,
      "x-forwarded-for": "127.0.0.1",
    },
    ip: "127.0.0.1",
    requestId: "test-request-id",
    ...options,
  };
  return req;
};

/**
 * Create a mock Express next function
 * @returns {jest.Mock} Mock next function
 */
const createMockNext = () => {
  const next = jest.fn();
  return next;
};

/**
 * Create a mock Sequelize model
 * @param {Object} options - Model methods to stub
 * @returns {Object} Mock model
 */
const createMockModel = (options = {}) => {
  const defaults = {
    findOne: jest.fn().mockResolvedValue(null),
    findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    findByPk: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    bulkCreate: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue([1]),
    destroy: jest.fn().mockResolvedValue(1),
    count: jest.fn().mockResolvedValue(0),
  };
  return { ...defaults, ...options };
};

/**
 * Create a mock Sequelize transaction
 * @returns {Object} Mock transaction
 */
const createMockTransaction = () => {
  return {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
};

/**
 * Create a mock Sequelize transaction for useOptions
 * @returns {Object} Mock transaction with toObject
 */
const createMockTransactionWithOptions = () => {
  const transaction = createMockTransaction();
  return {
    ...transaction,
    toObject: jest.fn().mockReturnValue(transaction),
  };
};

/**
 * Wait for async operations to complete
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock a function that should throw
 * @param {Function} fn - Function to mock
 * @param {Error} error - Error to throw
 * @returns {jest.Mock}
 */
const mockThrow = (error) => {
  return jest.fn().mockRejectedValue(error);
};

/**
 * Mock a function that should resolve
 * @param {*} value - Value to resolve with
 * @returns {jest.Mock}
 */
const mockResolve = (value) => {
  return jest.fn().mockResolvedValue(value);
};

/**
 * Mock a function that should resolve with a value and then throw
 * @param {*} value - First resolve value
 * @param {Error} error - Error to throw on second call
 * @returns {jest.Mock}
 */
const mockResolveThenThrow = (value, error) => {
  return jest.fn().mockImplementation(() => {
    if (mockResolveThenThrow.callCount === 0) {
      mockResolveThenThrow.callCount++;
      return Promise.resolve(value);
    }
    mockResolveThenThrow.callCount++;
    return Promise.reject(error);
  });
};

mockResolveThenThrow.callCount = 0;

module.exports = {
  createMockRes,
  createMockReq,
  createMockNext,
  createMockModel,
  createMockTransaction,
  createMockTransactionWithOptions,
  wait,
  mockThrow,
  mockResolve,
  mockResolveThenThrow,
};
