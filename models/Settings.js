const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  // Platform fee charged on each booking (percentage, e.g. 10 = 10%)
  platformFeePercent: { type: Number, default: 10, min: 0, max: 50 },
  
  // Tax rate applied to subtotal (percentage, e.g. 12 = 12%)
  taxRatePercent: { type: Number, default: 12, min: 0, max: 30 },
  
  // Whether verification is required before booking
  verificationRequired: { type: Boolean, default: true },
  
  // Whether new bike listings require admin approval
  manualListingApproval: { type: Boolean, default: true },
  
  // Whether email notifications are enabled
  emailNotificationsEnabled: { type: Boolean, default: true },
  
  // Late return fee per hour
  lateReturnFeePerHour: { type: Number, default: 25, min: 0 },
  
  // Cancellation thresholds
  cancellationFullRefundHours: { type: Number, default: 48, min: 0 },
  cancellationPartialRefundHours: { type: Number, default: 24, min: 0 },
  cancellationPartialRefundPercent: { type: Number, default: 50, min: 0, max: 100 },
  
  // Deposit amounts by protection tier
  depositBasic: { type: Number, default: 2500, min: 0 },
  depositStandard: { type: Number, default: 1500, min: 0 },
  depositPremium: { type: Number, default: 750, min: 0 },
  
  // Daily protection prices
  protectionStandardDaily: { type: Number, default: 30, min: 0 },
  protectionPremiumDaily: { type: Number, default: 55, min: 0 },
  
  // Updated at
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: false,
  collection: 'settings'
});

// Singleton pattern — only one settings document ever
settingsSchema.statics.getSingleton = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('Settings', settingsSchema);
