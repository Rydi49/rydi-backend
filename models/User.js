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
  lastLogin: {
    type: Date
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
