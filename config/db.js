const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error('FATAL: MONGO_URI environment variable is not set.');
    console.error('Get your connection string from MongoDB Atlas and add it as MONGO_URI in Render Environment.');
    process.exit(1);
  }

  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      console.log('MongoDB connected successfully');

      // Handle disconnects after initial connection — auto-retry
      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected. Will retry...');
      });

      mongoose.connection.on('error', (err) => {
        console.error('MongoDB runtime error:', err.message);
      });

      return; // Success — exit the retry loop
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s, 32s
        console.log(`Retrying in ${backoff / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        console.error('All MongoDB connection attempts exhausted. Server shutting down.');
        process.exit(1);
      }
    }
  }
};

module.exports = connectDB;
