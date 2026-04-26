const mongoose = require('mongoose');

const bikeSchema = new mongoose.Schema({
  make: { type: String, required: true, trim: true },
  model: { type: String, required: true, trim: true },
  year: { type: Number, required: true },
  dailyRate: { type: Number, required: true },
  location: { type: String, required: true, trim: true },
  category: { type: String, required: true },
  description: { type: String, required: true, trim: true },
  engineSize: { type: String, default: '' },
  seatHeight: { type: String, default: '' },
  weight: { type: String, default: '' },
  transmission: { type: String, default: '6-speed' },
  minExperience: { type: String, default: 'Intermediate' },
  images: { type: [String], default: [] },
  features: { type: [String], default: [] },
  ownerId: { type: String, required: true },
  ownerName: { type: String, required: true },
  ownerEmail: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  isAvailable: { type: Boolean, default: false },
  delivery: { type: Boolean, default: false },
  deliveryFee: { type: Number, default: 0 },
  verified: { type: Boolean, default: false },
  lat: { type: Number, default: 49.2827 },
  lng: { type: Number, default: -123.1207 },
  reviewerNote: { type: String, default: '' }
}, {
  timestamps: true
});

// Indexes for performance
bikeSchema.index({ ownerId: 1 });
bikeSchema.index({ status: 1 });
bikeSchema.index({ isAvailable: 1 });
bikeSchema.index({ category: 1 });

bikeSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj._id = obj._id.toString();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Bike', bikeSchema);
