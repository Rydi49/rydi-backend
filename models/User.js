const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['rider', 'owner', 'admin'],
    default: 'rider'
  },
  rating: {
    type: Number,
    default: 0
  },
  trips: {
    type: Number,
    default: 0
  },
  responseTime: {
    type: String,
    default: '< 1 hour'
  },
  verificationStatus: {
    type: String,
    enum: ['unsubmitted', 'pending', 'verified', 'rejected'],
    default: 'unsubmitted'
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
