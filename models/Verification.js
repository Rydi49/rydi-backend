const mongoose = require('mongoose');

const verificationSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  userRole: { type: String, enum: ['rider', 'owner', 'admin'], default: 'rider' },
  licenseImage: { type: String, required: true },
  selfieImage: { type: String, required: true },
  icbcImage: { type: String, default: '' }, // Required for owners, empty for riders
  status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  reviewerNote: { type: String, default: '' },
  reviewedAt: { type: String, default: '' }
}, {
  timestamps: { createdAt: 'submittedAt', updatedAt: false }
});

verificationSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj._id = obj._id.toString();
  obj.submittedAt = obj.submittedAt || obj.createdAt;
  delete obj.__v;
  delete obj.createdAt;
  return obj;
};

module.exports = mongoose.model('Verification', verificationSchema);
