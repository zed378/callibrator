/**
 * Mock for uuid module
 * uuid@14.x is ESM-only, so we mock it for Jest CommonJS tests
 */
module.exports = {
  v4: jest.fn(() => "12345678-1234-1234-1234-123456789012"),
};
