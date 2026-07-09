const bcrypt = require("bcrypt");
const crypto = require("crypto");

const SALT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// 6-digit numeric code for password reset, sent by email and never logged in plaintext.
function generateResetCode() {
  return String(crypto.randomInt(100000, 999999));
}

async function hashResetCode(code) {
  return bcrypt.hash(code, SALT_ROUNDS);
}

async function verifyResetCode(code, hash) {
  return bcrypt.compare(code, hash);
}

module.exports = { hashPassword, verifyPassword, generateResetCode, hashResetCode, verifyResetCode };
