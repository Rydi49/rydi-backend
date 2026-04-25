/**
 * RYDI Admin Seeder
 * 
 * Run this ONCE after deploying your backend to create the first admin user.
 * 
 * HOW TO USE:
 * 1. SSH into your Render server (or run locally with your MONGO_URI set)
 * 2. node scripts/seedAdmin.js
 * 
 * This creates an admin account with:
 *   Email:    admin@rydi.ca
 *   Password: RydiAdmin2026!
 * 
 * CHANGE THE PASSWORD IMMEDIATELY after first login.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');
const User = require('../models/User');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@rydi.ca';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'RydiAdmin2026!';
const ADMIN_FIRST = process.env.ADMIN_FIRST || 'RYDI';
const ADMIN_LAST = process.env.ADMIN_LAST || 'Admin';

async function seedAdmin() {
  try {
    await connectDB();

    const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
    if (existing) {
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        await existing.save();
        console.log(`Updated existing user ${ADMIN_EMAIL} to admin role.`);
      } else {
        console.log(`Admin user ${ADMIN_EMAIL} already exists.`);
      }
      process.exit(0);
    }

    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const admin = await User.create({
      email: ADMIN_EMAIL.toLowerCase(),
      password: hashed,
      firstName: ADMIN_FIRST,
      lastName: ADMIN_LAST,
      role: 'admin',
      rating: 5.0,
      trips: 0,
      responseTime: '< 1 hour',
      lastLogin: new Date()
    });

    console.log('====================================');
    console.log('  RYDI ADMIN USER CREATED');
    console.log('====================================');
    console.log(`Email:    ${ADMIN_EMAIL}`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
    console.log(`Role:     ${admin.role}`);
    console.log('');
    console.log('LOG IN at https://rydi.ca/login');
    console.log('THEN go to https://rydi.ca/admin');
    console.log('');
    console.log('CHANGE THE PASSWORD IMMEDIATELY!');
    console.log('====================================');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seedAdmin();
