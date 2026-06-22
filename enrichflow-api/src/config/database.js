const mongoose = require('mongoose');
const logger = require('../utils/logger');

let connected = false;

/**
 * Connect to MongoDB. A database is REQUIRED — there is no in-memory fallback.
 * If MONGODB_URI is missing or the connection fails, the process exits so misconfiguration
 * is caught immediately instead of silently disabling persistence.
 */
async function connect() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error('❌ MONGODB_URI is not set. A MongoDB connection is required.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    connected = true;
    logger.info('✅ MongoDB connected');
    return true;
  } catch (error) {
    logger.error('❌ MongoDB connection failed:', { message: error.message });
    process.exit(1);
  }
}

function isConnected() {
  return connected && mongoose.connection.readyState === 1;
}

module.exports = { connect, isConnected };
