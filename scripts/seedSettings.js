/**
 * RYDI Settings Seeder
 * 
 * Run this ONCE after deploying your backend to create the platform settings document.
 * 
 * HOW TO USE:
 * 1. SSH into your Render server (or run locally with MONGO_URI set)
 * 2. node scripts/seedSettings.js
 */

require('dotenv').config();
const connectDB = require('../config/db');
const Settings = require('../models/Settings');

async function seedSettings() {
  try {
    await connectDB();
    
    // Singleton pattern — only one settings document ever
    let settings = await Settings.findOne();
    if (settings) {
      console.log('Settings already exist. Current values:');
      console.log('  Platform Fee:', settings.platformFeePercent + '%');
      console.log('  Tax Rate:', settings.taxRatePercent + '%');
      console.log('  Verification Required:', settings.verificationRequired);
      console.log('  Manual Listing Approval:', settings.manualListingApproval);
      console.log('  Email Notifications:', settings.emailNotificationsEnabled);
      console.log('  Standard Protection Daily: $' + settings.protectionStandardDaily);
      console.log('  Premium Protection Daily: $' + settings.protectionPremiumDaily);
      console.log('  Basic Deposit: $' + settings.depositBasic);
      console.log('  Standard Deposit: $' + settings.depositStandard);
      console.log('  Premium Deposit: $' + settings.depositPremium);
      console.log('  Full Refund Hours:', settings.cancellationFullRefundHours);
      console.log('  Partial Refund Hours:', settings.cancellationPartialRefundHours);
      console.log('  Partial Refund %:', settings.cancellationPartialRefundPercent + '%');
      console.log('  Late Return Fee/Hour: $' + settings.lateReturnFeePerHour);
      console.log('\nGo to your admin panel (/admin) → Settings tab to change these values.');
    } else {
      settings = await Settings.create({});
      console.log('Platform settings created with defaults:');
      console.log('  Platform Fee: 10%');
      console.log('  Tax Rate: 12%');
      console.log('  Standard Protection: $30/day');
      console.log('  Premium Protection: $55/day');
      console.log('  Basic Deposit: $2,500');
      console.log('  Standard Deposit: $1,500');
      console.log('  Premium Deposit: $750');
      console.log('\nGo to your admin panel (/admin) → Settings tab to change these values.');
    }
    process.exit(0);
  } catch (err) {
    console.error('Settings seed failed:', err.message);
    process.exit(1);
  }
}

seedSettings();
