const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  bikeId: { type: String, required: true },
  bikeName: { type: String, required: true },
  bikeImage: { type: String, default: '/images/placeholder-bike.jpg' },
  renter: { type: String, required: true },
  renterName: { type: String, required: true },
  renterEmail: { type: String, required: true },
  owner: { type: String, required: true },
  ownerName: { type: String, default: '' },
  ownerEmail: { type: String, default: '' },
  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  days: { type: Number, default: 1 },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'rejected'], default: 'pending' },
  totalPrice: { type: Number, default: 0 },
  protectionTier: { type: String, default: 'basic' },
  protectionName: { type: String, default: 'Basic Protection' },
  protectionCost: { type: Number, default: 0 },
  protectionDeposit: { type: Number, default: 2500 },
  serviceFee: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  deposit: { type: Number, default: 2500 },
  deliveryOption: { type: String, default: 'pickup' },
  riderMessage: { type: String, default: '' },
  ownerMessage: { type: String, default: '' },
  completedAt: { type: String, default: '' }
}, {
  timestamps: true
});

bookingSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj._id = obj._id.toString();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Booking', bookingSchema);
