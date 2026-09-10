const bcrypt = require("bcryptjs");

exports.hashPassword = async (password) => {
  return bcrypt.hash(password, 12);
};

exports.comparePassword = async (plain, hash) => {
  return bcrypt.compare(plain, hash);
};
