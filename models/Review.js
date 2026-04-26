const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  bikeId: { type: String, required: true, index: true },
  bikeName: { type: String, required: true },
  ownerId: { type: String, default: '' },
  bookingId: { type: String, default: '' },
  renterId: { type: String, required: true, index: true },
  renterName: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' }
}, {
  timestamps: true
});

reviewSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj._id = obj._id.toString();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Review', reviewSchema);
