const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('sanity check', () => {
  expect(true).toBe(true);
});


let mongoServer;

module.exports = {
  async connect() {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { dbName: 'testdb' });
  },
  async closeDatabase() {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (mongoServer) await mongoServer.stop();
  },
  async clearDatabase() {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
};
