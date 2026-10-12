const mongoose = require('mongoose');
let connection;
async function deliveryDb() {
  const uri = process.env.DELIVERY_CENTER_MONGO_URI;
  if (!uri) throw new Error('DELIVERY_CENTER_MONGO_URI is required for cross-platform message history');
  if (!connection) connection = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000 });
  await connection.asPromise();
  return connection.db;
}
async function close() { if (connection) { await connection.close(); connection = undefined; } }
module.exports = { deliveryDb, close };
