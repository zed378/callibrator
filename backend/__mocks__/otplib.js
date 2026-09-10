const authenticator = {
  generateSecret: () => "mock-secret",
  keyuri: () => "otpauth://mock",
  check: () => true,
};

module.exports = {
  authenticator,
};
