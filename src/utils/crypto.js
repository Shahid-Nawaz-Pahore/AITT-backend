const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateRandomToken(len = 48) {
  return crypto.randomBytes(len).toString('hex');
}

module.exports = { hashPassword, verifyPassword, generateRandomToken };
