const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Cache the connection across invocations so serverless (Vercel) doesn't open a
// new pool per request. `global` survives within a warm function instance; a
// cold start rebuilds it. Harmless for a long-running `node` process (connects
// once). Jest sandboxes `global` per test file, so this never leaks across tests.
let cached = global.__mongooseConn;
if (!cached) cached = global.__mongooseConn = { conn: null, promise: null };

const connectDB = async () => {
  if (cached.conn) return cached.conn;
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  mongoose.set('strictQuery', true);
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, { dbName: 'soroban_compliance', maxPoolSize: 5, serverSelectionTimeoutMS: 8000 })
      .then((m) => {
        logger.info('MongoDB connected');
        return m;
      });
  }
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // allow the next call to retry a failed connect
    throw err;
  }
  return cached.conn;
};

module.exports = connectDB;
