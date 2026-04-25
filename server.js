const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
require('dotenv').config();

const connectDB = require('./config/db');
const mongoose = require('mongoose');
const User = require('./models/User');
const Bike = require('./models/Bike');
const Booking = require('./models/Booking');
const Review = require('./models/Review');
const Verification = require('./models/Verification');

const app = express();
const PORT = process.env.PORT || 10000;

// JWT_SECRET is required — server fails if not set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server will not start.');
  process.exit(1);
}

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'builtby.sc@outlook.com';

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

// Middleware
app.use(helmet());
// CORS: allow multiple origins for production + local testing simultaneously
const ALLOWED_ORIGINS = [
  'https://rydi.ca',
  'https://www.rydi.ca',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(apiLimiter);
app.use(express.json({ limit: '10mb' }));

// Input sanitization — trim all strings, strip < >
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim().replace(/[<>]/g, '');
      }
    });
  }
  if (req.query && typeof req.query === 'object') {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key].trim().replace(/[<>]/g, '');
      }
    });
  }
  next();
});

// Connect to MongoDB
connectDB();

// ============ EMAIL SERVICE ============
const emailService = {
  async send({ to, subject, html, text }) {
    if (SENDGRID_API_KEY) {
      try {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(SENDGRID_API_KEY);
        await sgMail.send({
          to,
          from: ADMIN_EMAIL,
          subject,
          text: text || subject,
          html: html || text || subject,
        });
        console.log('Email sent via SendGrid to:', to);
        return { success: true };
      } catch (err) {
        console.error('SendGrid error:', err.message);
      }
    }
    console.log('\n========== EMAIL ==========');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('===========================\n');
    return { success: true, mock: true };
  },

  async bookingRequested({ to, renterName, bikeName, dates, total }) {
    return this.send({
      to,
      subject: `New Booking Request: ${bikeName}`,
      text: `Hi,\n\n${renterName} has requested to book your ${bikeName} for ${dates}.\nTotal: $${total}\n\nPlease log in to approve or decline.\n\n- RYDI Team`,
    });
  },

  async bookingStatusUpdate({ to, bikeName, status, ownerMessage }) {
    const statusText = status === 'confirmed' ? 'APPROVED' : status === 'rejected' ? 'DECLINED' : status.toUpperCase();
    return this.send({
      to,
      subject: `Booking ${statusText}: ${bikeName}`,
      text: `Hi,\n\nYour booking for ${bikeName} has been ${statusText}.${ownerMessage ? '\n\nMessage from owner: ' + ownerMessage : ''}\n\nLog in to view details.\n\n- RYDI Team`,
    });
  },

  async bookingReminder({ to, bikeName, pickupDate }) {
    return this.send({
      to,
      subject: `Reminder: Pickup tomorrow for ${bikeName}`,
      text: `Hi,\n\nYour pickup for ${bikeName} is scheduled for ${pickupDate}.\n\nMake sure to bring:\n- Valid Class 6 license\n- Government ID\n- Credit card for deposit\n- Your riding gear\n\nSafe rides!\n- RYDI Team`,
    });
  },

  async verificationStatus({ to, status }) {
    const statusText = status === 'verified' ? 'APPROVED' : 'DECLINED';
    return this.send({
      to,
      subject: `ID Verification ${statusText}`,
      text: `Hi,\n\nYour ID verification has been ${statusText}.\n${status === 'verified' ? 'You can now book motorcycles on RYDI!' : 'Please contact support for more information.'}\n\n- RYDI Team`,
    });
  },
};

// ============ AUTH MIDDLEWARE ============
function protect(req, res, next) {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

async function resolveUser(req, res, next) {
  try {
    if (!isValidObjectId(req.user.id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });
    req.userDoc = user;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'User not found' });
  }
}

function adminOnly(req, res, next) {
  if (req.userDoc && req.userDoc.role === 'admin') next();
  else res.status(403).json({ success: false, message: 'Admin access required' });
}

// ============ OBJECTID VALIDATION HELPER ============
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function getUserVerificationStatus(userId) {
  const ver = await Verification.findOne({ userId }).sort({ submittedAt: -1 });
  return ver ? ver.status : 'unsubmitted';
}

// ============ HELPER FUNCTIONS ============
function formatUserResponse(user, verificationStatus) {
  return {
    _id: user._id.toString(),
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    rating: user.rating,
    trips: user.trips,
    responseTime: user.responseTime,
    verificationStatus: verificationStatus || 'unsubmitted',
    createdAt: user.createdAt
  };
}

async function getBikeWithStats(bike) {
  const bikeId = bike._id ? bike._id.toString() : bike._id;
  const reviews = await Review.find({ bikeId });
  const avgRating = reviews.length > 0
    ? parseFloat((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1))
    : 0;
  return {
    ...bike.toJSON(),
    avgRating,
    totalTrips: reviews.length,
    reviewCount: reviews.length
  };
}

async function getUserVerificationStatus(userId) {
  const ver = await Verification.findOne({ userId: userId.toString() }).sort({ submittedAt: -1 });
  return ver ? ver.status : 'unsubmitted';
}

// ============ SEED DATA ============
async function seedData() {
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = await User.create({
      email: 'builtby.sc@outlook.com',
      password: adminPassword,
      firstName: 'Shayne',
      lastName: 'Chassie',
      role: 'admin',
      rating: 5.0,
      trips: 56,
      responseTime: '< 1 hour',
      verificationStatus: 'verified'
    });

    const ownerPassword = await bcrypt.hash('owner123', 10);
    const owner = await User.create({
      email: 'jennifer@rydi.ca',
      password: ownerPassword,
      firstName: 'Jennifer',
      lastName: 'Bray',
      role: 'owner',
      rating: 5.0,
      trips: 38,
      responseTime: '< 2 hours',
      verificationStatus: 'verified'
    });

    const riderPassword = await bcrypt.hash('rider123', 10);
    const rider = await User.create({
      email: 'rider@example.com',
      password: riderPassword,
      firstName: 'James',
      lastName: 'Tremblay',
      role: 'rider',
      rating: 4.9,
      trips: 12,
      responseTime: '< 1 hour',
      verificationStatus: 'verified'
    });

    const bikes = await Bike.create([
      {
        make: 'Kawasaki', model: 'KLE 500', year: 2024, dailyRate: 85,
        location: 'Vancouver, BC', category: 'Adventure',
        description: 'Perfect adventure bike for exploring BC backroads. Versatile on-road and off-road capability.',
        engineSize: '498cc', seatHeight: '845mm', weight: '181kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike1.jpg'], ownerId: admin._id.toString(), ownerName: 'Shayne C.', ownerEmail: admin.email,
        features: ['ABS', 'Luggage Rack', 'Hand Guards', 'Engine Guards', 'Skid Plate'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 25,
        verified: true, lat: 49.2827, lng: -123.1207
      },
      {
        make: 'KTM', model: '990 Duke', year: 2024, dailyRate: 120,
        location: 'Vancouver, BC', category: 'Street',
        description: 'Powerful street bike with aggressive styling. Thrilling performance for urban and canyon riding.',
        engineSize: '947cc', seatHeight: '825mm', weight: '179kg', transmission: '6-speed', minExperience: 'Advanced',
        images: ['/images/bike2.jpg'], ownerId: admin._id.toString(), ownerName: 'Shayne C.', ownerEmail: admin.email,
        features: ['ABS', 'Traction Control', 'Quickshifter', 'LED Lights', 'Ride Modes'],
        status: 'approved', isAvailable: true, delivery: false, deliveryFee: 0,
        verified: true, lat: 49.2827, lng: -123.1207
      },
      {
        make: 'BMW', model: 'F 450 GS', year: 2024, dailyRate: 95,
        location: 'Langley, BC', category: 'Adventure',
        description: 'Lightweight adventure bike perfect for BC backroads. Premium German engineering.',
        engineSize: '450cc', seatHeight: '830mm', weight: '175kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike3.jpg'], ownerId: owner._id.toString(), ownerName: 'Jennifer B.', ownerEmail: owner.email,
        features: ['ABS', 'Ride Modes', 'Heated Grips', 'GPS Mount', 'Luggage System'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 30,
        verified: true, lat: 49.1042, lng: -122.6604
      },
      {
        make: 'Honda', model: 'NX500', year: 2024, dailyRate: 75,
        location: 'Chilliwack, BC', category: 'Touring',
        description: 'Versatile all-rounder ideal for touring the Fraser Valley. Comfortable and fuel-efficient.',
        engineSize: '471cc', seatHeight: '830mm', weight: '196kg', transmission: '6-speed', minExperience: 'Beginner+',
        images: ['/images/bike4.jpg'], ownerId: owner._id.toString(), ownerName: 'Jennifer B.', ownerEmail: owner.email,
        features: ['ABS', 'Windshield', 'USB Charging', 'Side Bags', 'Heated Grips'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 20,
        verified: true, lat: 49.1579, lng: -121.9515
      },
      {
        make: 'Yamaha', model: 'Tenere 700', year: 2025, dailyRate: 110,
        location: 'Squamish, BC', category: 'Adventure',
        description: 'The ultimate BC adventure bike. Purpose-built for exploring Sea to Sky Highway.',
        engineSize: '689cc', seatHeight: '875mm', weight: '205kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike5.jpg'], ownerId: admin._id.toString(), ownerName: 'Shayne C.', ownerEmail: admin.email,
        features: ['ABS', 'Traction Control', 'Skid Plate', 'Hand Guards', 'Luggage System', 'Heated Grips'],
        status: 'approved', isAvailable: true, delivery: false, deliveryFee: 0,
        verified: true, lat: 49.7016, lng: -123.1558
      },
      {
        make: 'Triumph', model: 'Tiger 900 GT', year: 2024, dailyRate: 130,
        location: 'Victoria, BC', category: 'Touring',
        description: 'Premium touring adventure bike. Explore Vancouver Island in comfort and style.',
        engineSize: '888cc', seatHeight: '810mm', weight: '214kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike6.jpg'], ownerId: owner._id.toString(), ownerName: 'Jennifer B.', ownerEmail: owner.email,
        features: ['ABS', 'Cruise Control', 'Heated Grips/Seat', 'Panniers', 'TFT Display', 'Windshield'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 35,
        verified: true, lat: 48.4284, lng: -123.3656
      }
    ]);

    await Review.create([
      { bikeId: bikes[0]._id.toString(), bikeName: '2024 Kawasaki KLE 500', ownerId: bikes[0].ownerId, renterId: rider._id.toString(), renterName: 'James T.', rating: 5, comment: 'Fantastic bike for the Sea to Sky trip! Owner was very accommodating and the bike was in perfect condition. Highly recommend!' },
      { bikeId: bikes[0]._id.toString(), bikeName: '2024 Kawasaki KLE 500', ownerId: bikes[0].ownerId, renterId: rider._id.toString(), renterName: 'Maria S.', rating: 5, comment: 'Great adventure bike. Took it through the Fraser Valley and had zero issues. Smooth ride and well maintained.' },
      { bikeId: bikes[2]._id.toString(), bikeName: '2024 BMW F 450 GS', ownerId: bikes[2].ownerId, renterId: rider._id.toString(), renterName: 'David L.', rating: 4, comment: 'Awesome BMW! Perfect for the backroads around Langley. Would definitely rent again.' },
      { bikeId: bikes[4]._id.toString(), bikeName: '2025 Yamaha Tenere 700', ownerId: bikes[4].ownerId, renterId: rider._id.toString(), renterName: 'Priya K.', rating: 5, comment: 'The Tenere is a dream machine for BC. Took it to Whistler and the handling was incredible.' }
    ]);

    await Booking.create({
      bikeId: bikes[0]._id.toString(),
      bikeName: bikes[0].year + ' ' + bikes[0].make + ' ' + bikes[0].model,
      bikeImage: bikes[0].images[0],
      renter: rider._id.toString(),
      renterName: rider.firstName + ' ' + rider.lastName,
      renterEmail: rider.email,
      owner: admin._id.toString(),
      ownerName: admin.firstName + ' ' + admin.lastName,
      startDate: '2026-03-10',
      endDate: '2026-03-14',
      days: 4,
      status: 'completed',
      totalPrice: 395,
      protectionTier: 'standard',
      protectionCost: 120,
      protectionName: 'Standard Protection',
      protectionDeposit: 1500,
      serviceFee: 34,
      tax: 47,
      deposit: 1500,
      deliveryOption: 'pickup',
      riderMessage: 'Excited for the Sea to Sky trip!',
      completedAt: '2026-03-14T18:00:00Z'
    });

    console.log('Seed complete!');
    console.log('Admin: builtby.sc@outlook.com / admin123');
    console.log('Owner: jennifer@rydi.ca / owner123');
    console.log('Rider: rider@example.com / rider123');
  }
}

// ============ AUTH ============
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password min 6 chars' });
    }
    if (firstName.length > 50 || lastName.length > 50) {
      return res.status(400).json({ success: false, message: 'Name fields max 50 characters' });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    // SECURITY: Never allow 'admin' role from public signup. Only 'rider' or 'owner'.
    const sanitizedRole = role === 'owner' ? 'owner' : 'rider';
    const user = await User.create({
      email: email.toLowerCase(),
      password: hashed,
      firstName,
      lastName,
      role: sanitizedRole
    });
    const token = jwt.sign({ id: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({
      success: true,
      data: { token, user: formatUserResponse(user, 'unsubmitted') }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    user.lastLogin = new Date();
    await user.save();
    const verStatus = await getUserVerificationStatus(user._id.toString());
    const token = jwt.sign({ id: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true,
      data: { token, user: formatUserResponse(user, verStatus) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/auth/me', protect, resolveUser, async (req, res) => {
  const verStatus = await getUserVerificationStatus(req.userDoc._id.toString());
  res.json({ success: true, data: formatUserResponse(req.userDoc, verStatus) });
});

// ============ VERIFICATION ============
app.post('/api/verifications', protect, resolveUser, async (req, res) => {
  try {
    const { licenseImage, selfieImage, icbcImage } = req.body;
    const userRole = req.userDoc.role || 'rider';

    // All users need license + selfie
    if (!licenseImage || !selfieImage) {
      return res.status(400).json({ success: false, message: 'Driver\'s license and selfie are both required' });
    }

    // Owners MUST upload ICBC insurance card to list bikes
    // Riders do NOT need ICBC insurance — they only rent
    if (userRole === 'owner' && !icbcImage) {
      return res.status(400).json({ success: false, message: 'ICBC insurance card is required for owners to list bikes' });
    }

    // Max 5MB per base64 image (~6.6MB raw string)
    const MAX_IMAGE_SIZE = 5_000_000;
    if (licenseImage.length > MAX_IMAGE_SIZE) {
      return res.status(413).json({ success: false, message: 'License image exceeds 5MB limit. Please compress or crop.' });
    }
    if (selfieImage.length > MAX_IMAGE_SIZE) {
      return res.status(413).json({ success: false, message: 'Selfie image exceeds 5MB limit. Please compress or crop.' });
    }
    if (icbcImage && icbcImage.length > MAX_IMAGE_SIZE) {
      return res.status(413).json({ success: false, message: 'ICBC card image exceeds 5MB limit. Please compress or crop.' });
    }

    await Verification.updateMany({ userId: req.userDoc._id.toString() }, { status: 'rejected' });
    const verification = await Verification.create({
      userId: req.userDoc._id.toString(),
      userName: req.userDoc.firstName + ' ' + req.userDoc.lastName,
      userEmail: req.userDoc.email,
      userRole: userRole,
      licenseImage,
      selfieImage,
      icbcImage: userRole === 'owner' ? icbcImage : '',
      status: 'pending'
    });

    const msg = userRole === 'owner'
      ? 'Owner verification submitted for review. You can list bikes once approved.'
      : 'ID verification submitted for review.';
    res.status(201).json({ success: true, message: msg, data: verification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/verifications/my', protect, resolveUser, async (req, res) => {
  try {
    const verification = await Verification.findOne({ userId: req.userDoc._id.toString() }).sort({ submittedAt: -1 });
    res.json({ success: true, data: verification || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/verifications', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    const pending = await Verification.find({ status: 'pending' }).sort({ submittedAt: -1 });
    res.json({ success: true, count: pending.length, data: pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/verifications/:id/status', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid verification ID format' });
    }
    const verification = await Verification.findById(req.params.id);
    if (!verification) return res.status(404).json({ success: false, message: 'Verification not found' });
    verification.status = req.body.status;
    verification.reviewerNote = req.body.reviewerNote || '';
    verification.reviewedAt = new Date().toISOString();
    await verification.save();
    emailService.verificationStatus({
      to: verification.userEmail,
      status: req.body.status,
      note: req.body.reviewerNote
    });
    res.json({ success: true, message: 'Verification ' + req.body.status, data: verification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ BIKES / LISTINGS ============

app.get('/api/bikes', async (req, res) => {
  try {
    const { category, location, search } = req.query;
    let query = { status: 'approved', isAvailable: true };
    if (category) query.category = category;
    if (location) query.location = { $regex: location, $options: 'i' };
    let bikes = await Bike.find(query);
    if (search) {
      const s = search.toLowerCase();
      bikes = bikes.filter(b =>
        b.make.toLowerCase().includes(s) ||
        b.model.toLowerCase().includes(s) ||
        b.description.toLowerCase().includes(s)
      );
    }
    const bikesWithStats = await Promise.all(bikes.map(b => getBikeWithStats(b)));
    res.json({ success: true, count: bikesWithStats.length, data: bikesWithStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/bikes/:id', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    const bike = await Bike.findById(req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    const reviews = await Review.find({ bikeId: req.params.id }).sort({ createdAt: -1 });
    const bikeWithStats = await getBikeWithStats(bike);
    res.json({ success: true, data: { ...bikeWithStats, reviews } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/bikes', protect, resolveUser, async (req, res) => {
  try {
    if (req.userDoc.role !== 'owner' && req.userDoc.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only owners can list bikes' });
    }
    const bike = await Bike.create({
      ...req.body,
      ownerId: req.userDoc._id.toString(),
      ownerName: req.userDoc.firstName + ' ' + req.userDoc.lastName[0] + '.',
      ownerEmail: req.userDoc.email,
      status: 'pending',
      isAvailable: false,
      verified: false
    });
    res.status(201).json({ success: true, message: 'Listing submitted for review', data: bike });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/bikes/my-bikes', protect, resolveUser, async (req, res) => {
  try {
    const myBikes = await Bike.find({ ownerId: req.userDoc._id.toString() });
    const bikesWithStats = await Promise.all(myBikes.map(b => getBikeWithStats(b)));
    res.json({ success: true, count: bikesWithStats.length, data: bikesWithStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/bikes/:id', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    const bike = await Bike.findById(req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    if (bike.ownerId !== req.userDoc._id.toString() && req.userDoc.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    Object.assign(bike, req.body);
    await bike.save();
    res.json({ success: true, data: bike });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/bikes/:id', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    const bike = await Bike.findById(req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    if (bike.ownerId !== req.userDoc._id.toString() && req.userDoc.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    await Bike.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Listing deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ REVIEWS ============

app.post('/api/reviews', protect, resolveUser, async (req, res) => {
  try {
    const { bikeId, bookingId, rating, comment } = req.body;
    if (!bikeId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Bike ID and rating (1-5) required' });
    }
    const booking = await Booking.findOne({
      bikeId,
      renter: req.userDoc._id.toString(),
      status: 'completed'
    });
    if (!booking) {
      return res.status(403).json({ success: false, message: 'You can only review bikes after a completed booking' });
    }
    const existing = await Review.findOne({ bikeId, renterId: req.userDoc._id.toString() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already reviewed this bike' });
    }
    if (!isValidObjectId(bikeId)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    const bike = await Bike.findById(bikeId);
    const review = await Review.create({
      bikeId,
      bikeName: bike ? `${bike.year} ${bike.make} ${bike.model}` : 'Unknown Bike',
      ownerId: bike?.ownerId || '',
      bookingId: bookingId || booking._id.toString(),
      renterId: req.userDoc._id.toString(),
      renterName: req.userDoc.firstName + ' ' + req.userDoc.lastName[0] + '.',
      rating,
      comment: comment || ''
    });
    req.userDoc.trips = (req.userDoc.trips || 0) + 1;
    await req.userDoc.save();
    res.status(201).json({ success: true, data: review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/reviews/bike/:bikeId', async (req, res) => {
  try {
    const reviews = await Review.find({ bikeId: req.params.bikeId }).sort({ createdAt: -1 });
    res.json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/reviews/owner/:ownerId', async (req, res) => {
  try {
    const reviews = await Review.find({ ownerId: req.params.ownerId }).sort({ createdAt: -1 });
    res.json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ BOOKINGS ============

app.post('/api/bookings', protect, resolveUser, async (req, res) => {
  try {
    const { bikeId, startDate, endDate, protectionTier, riderMessage, totalPrice, deliveryOption } = req.body;

    const sDate = new Date(startDate);
    const eDate = new Date(endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    if (sDate < now) {
      return res.status(400).json({ success: false, message: 'Pickup date cannot be in the past' });
    }
    if (eDate <= sDate) {
      return res.status(400).json({ success: false, message: 'Return date must be after pickup date' });
    }
    if (riderMessage && riderMessage.length > 500) {
      return res.status(400).json({ success: false, message: 'Rider message max 500 characters' });
    }

    // Check verification
    const verification = await Verification.findOne({
      userId: req.userDoc._id.toString(),
      status: 'verified'
    });
    if (!verification && req.userDoc.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You must be verified to book a motorcycle. Please submit your ID verification.' });
    }

    if (!isValidObjectId(bikeId)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    const bike = await Bike.findById(bikeId);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    if (!bike.isAvailable || bike.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Bike is not available for booking' });
    }

    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    const basePrice = bike.dailyRate * days;

    const tierConfig = {
      basic: { name: 'Basic Protection', dailyPrice: 0, deposit: 2500 },
      standard: { name: 'Standard Protection', dailyPrice: 30, deposit: 1500 },
      premium: { name: 'Premium Protection', dailyPrice: 55, deposit: 750 },
    };
    const tier = tierConfig[protectionTier] || tierConfig.basic;
    const protCost = tier.dailyPrice * days;
    const serviceFee = Math.round(basePrice * 0.10);
    const subtotal = basePrice + protCost + serviceFee;
    const tax = Math.round(subtotal * 0.12);
    const total = totalPrice || (subtotal + tax);

    const booking = await Booking.create({
      bikeId,
      bikeName: bike.year + ' ' + bike.make + ' ' + bike.model,
      bikeImage: bike.images?.[0] || '/images/placeholder-bike.jpg',
      renter: req.userDoc._id.toString(),
      renterName: req.userDoc.firstName + ' ' + req.userDoc.lastName,
      renterEmail: req.userDoc.email,
      owner: bike.ownerId,
      ownerName: bike.ownerName,
      ownerEmail: bike.ownerEmail,
      startDate,
      endDate,
      days,
      status: req.body.status || 'pending',
      totalPrice: total,
      protectionTier: protectionTier || 'basic',
      protectionName: tier.name,
      protectionCost: protCost,
      protectionDeposit: tier.deposit,
      serviceFee,
      tax,
      deposit: tier.deposit,
      deliveryOption: deliveryOption || 'pickup',
      riderMessage: riderMessage || ''
    });

    emailService.bookingRequested({
      to: bike.ownerEmail,
      renterName: booking.renterName,
      bikeName: booking.bikeName,
      dates: `${startDate} to ${endDate}`,
      total: booking.totalPrice
    });

    res.status(201).json({ success: true, message: 'Booking request sent to owner', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/bookings/my-bookings', protect, resolveUser, async (req, res) => {
  try {
    const myBookings = await Booking.find({ renter: req.userDoc._id.toString() }).sort({ createdAt: -1 });
    const enriched = await Promise.all(myBookings.map(async b => {
      const hasReview = await Review.findOne({ bookingId: b._id.toString(), renterId: req.userDoc._id.toString() });
      return { ...b.toJSON(), canReview: b.status === 'completed' && !hasReview, hasReview: !!hasReview };
    }));
    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/bookings/owner-bookings', protect, resolveUser, async (req, res) => {
  try {
    const myBikes = await Bike.find({ ownerId: req.userDoc._id.toString() });
    const myBikeIds = myBikes.map(b => b._id.toString());
    const ownerBookings = await Booking.find({ bikeId: { $in: myBikeIds } }).sort({ createdAt: -1 });
    res.json({ success: true, count: ownerBookings.length, data: ownerBookings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/bookings/:id/status', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.owner !== req.userDoc._id.toString() && req.userDoc.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    booking.status = req.body.status;
    if (req.body.ownerMessage) booking.ownerMessage = req.body.ownerMessage;
    if (req.body.status === 'completed') booking.completedAt = new Date().toISOString();
    await booking.save();
    emailService.bookingStatusUpdate({
      to: booking.renterEmail,
      bikeName: booking.bikeName,
      status: req.body.status,
      ownerMessage: req.body.ownerMessage
    });
    res.json({ success: true, message: 'Booking ' + req.body.status, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/bookings/:id/payment-success', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.renter !== req.userDoc._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not your booking' });
    }
    booking.status = 'pending';
    await booking.save();
    res.json({ success: true, message: 'Payment confirmed. Booking request sent to owner.', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ DIGITAL SIGNATURE & INSPECTION ============

// Submit digital signature and accept liability waiver
app.post('/api/bookings/:id/signature', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.renter !== req.userDoc._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const { signature } = req.body;
    if (!signature || signature.length < 3) {
      return res.status(400).json({ success: false, message: 'Full name signature is required' });
    }
    booking.signature = signature;
    booking.waiverAccepted = true;
    booking.waiverAcceptedAt = new Date().toISOString();
    await booking.save();
    res.json({ success: true, message: 'Liability waiver signed', data: { signature, acceptedAt: booking.waiverAcceptedAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Upload pickup inspection photos
app.post('/api/bookings/:id/pickup-photos', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.renter !== req.userDoc._id.toString() && booking.owner !== req.userDoc._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const { photos, odometer, tireTread } = req.body;
    if (!photos || photos.length < 4) {
      return res.status(400).json({ success: false, message: 'At least 4 photos required (front, back, left, right)' });
    }
    booking.pickupPhotos = photos;
    booking.pickupOdometer = odometer || 0;
    booking.pickupTireTread = tireTread || '';
    await booking.save();
    res.json({ success: true, message: 'Pickup inspection photos uploaded', data: booking.pickupPhotos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Confirm pickup (both parties)
app.put('/api/bookings/:id/pickup-confirm', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.renter !== req.userDoc._id.toString() && booking.owner !== req.userDoc._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    booking.pickupConfirmed = true;
    booking.pickupConfirmedAt = new Date().toISOString();
    await booking.save();
    res.json({ success: true, message: 'Pickup confirmed', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Upload return inspection photos
app.post('/api/bookings/:id/return-photos', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.renter !== req.userDoc._id.toString() && booking.owner !== req.userDoc._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const { photos, odometer, tireTread } = req.body;
    if (!photos || photos.length < 4) {
      return res.status(400).json({ success: false, message: 'At least 4 photos required (front, back, left, right)' });
    }
    booking.returnPhotos = photos;
    booking.returnOdometer = odometer || 0;
    booking.returnTireTread = tireTread || '';
    await booking.save();
    res.json({ success: true, message: 'Return inspection photos uploaded', data: booking.returnPhotos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Confirm return
app.put('/api/bookings/:id/return-confirm', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.renter !== req.userDoc._id.toString() && booking.owner !== req.userDoc._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    booking.returnConfirmed = true;
    booking.returnConfirmedAt = new Date().toISOString();
    booking.status = 'completed';
    booking.completedAt = new Date().toISOString();
    await booking.save();
    res.json({ success: true, message: 'Return confirmed. Ride completed!', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Report damage
app.post('/api/bookings/:id/damage', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.owner !== req.userDoc._id.toString() && req.userDoc.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the owner can report damage' });
    }
    const { description, photos, amount } = req.body;
    booking.damageReported = true;
    booking.damageDescription = description || '';
    booking.damagePhotos = photos || [];
    booking.damageAmount = amount || 0;
    await booking.save();
    res.json({ success: true, message: 'Damage report filed', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Cancel booking with policy
app.post('/api/bookings/:id/cancel', protect, resolveUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID format' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.renter !== req.userDoc._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Booking cannot be cancelled' });
    }
    
    // Cancellation policy calculation
    const now = new Date();
    const start = new Date(booking.startDate);
    const hoursUntil = Math.ceil((start - now) / (1000 * 60 * 60));
    
    let refundPercent = 0;
    let cancellationFee = 0;
    
    if (hoursUntil >= 48) {
      refundPercent = 100; // Full refund
      cancellationFee = 0;
    } else if (hoursUntil >= 24) {
      refundPercent = 50; // 50% refund
      cancellationFee = booking.totalPrice * 0.5;
    } else {
      refundPercent = 0; // No refund
      cancellationFee = booking.totalPrice;
    }
    
    const refundAmount = Math.round(booking.totalPrice * (refundPercent / 100));
    
    booking.status = 'cancelled';
    booking.cancelledAt = new Date().toISOString();
    booking.cancellationReason = req.body.reason || 'Cancelled by rider';
    booking.refundAmount = refundAmount;
    booking.cancellationFee = cancellationFee;
    await booking.save();
    
    res.json({ 
      success: true, 
      message: `Booking cancelled. ${refundPercent}% refund ($${refundAmount}).`,
      data: { refundAmount, cancellationFee, refundPercent, hoursUntil }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/contact', apiLimiter, async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message max 2000 characters' });
    }
    await emailService.send({
      to: ADMIN_EMAIL,
      subject: `Contact Form: ${subject}`,
      text: `From: ${name} <${email}>\n\n${message}`,
    });
    res.json({ success: true, message: 'Message sent. We will respond within 24 hours.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
  }
});

// ============ GOOGLE MAPS PROXY ============
app.get('/api/maps/geocode', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ success: false, message: 'Address required' });
    // Privacy: add ~500m random jitter to coordinates before booking
    const jitter = 0.0045;
    function jitterCoords(loc) {
      return {
        lat: loc.lat + (Math.random() * jitter * 2 - jitter),
        lng: loc.lng + (Math.random() * jitter * 2 - jitter)
      };
    }
    if (!GOOGLE_MAPS_API_KEY) {
      const bcCoords = {
        'vancouver': { lat: 49.2827, lng: -123.1207 },
        'langley': { lat: 49.1042, lng: -122.6604 },
        'chilliwack': { lat: 49.1579, lng: -121.9515 },
        'squamish': { lat: 49.7016, lng: -123.1558 },
        'victoria': { lat: 48.4284, lng: -123.3656 },
        'kelowna': { lat: 49.8801, lng: -119.4436 },
        'kamloops': { lat: 50.6745, lng: -120.3273 },
        'whistler': { lat: 50.1163, lng: -122.9574 },
      };
      const key = Object.keys(bcCoords).find(k => address.toLowerCase().includes(k));
      if (key) return res.json({ success: true, data: jitterCoords(bcCoords[key]), mock: true });
      return res.json({ success: true, data: jitterCoords({ lat: 49.2827, lng: -123.1207 }), mock: true });
    }
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`);
    const data = await response.json();
    if (data.results && data.results[0]) {
      const loc = data.results[0].geometry.location;
      res.json({ success: true, data: jitterCoords(loc), exact: false });
    } else {
      res.status(404).json({ success: false, message: 'Location not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ OWNER DASHBOARD STATS ============
app.get('/api/owner/stats', protect, resolveUser, async (req, res) => {
  try {
    const myBikes = await Bike.find({ ownerId: req.userDoc._id.toString() });
    const myBikeIds = myBikes.map(b => b._id.toString());
    const myBookings = await Booking.find({ bikeId: { $in: myBikeIds } });
    const confirmedBookings = myBookings.filter(b => b.status === 'confirmed' || b.status === 'completed');
    const totalEarnings = confirmedBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const completedTrips = myBookings.filter(b => b.status === 'completed').length;
    const approvalRate = myBookings.length > 0
      ? Math.round((confirmedBookings.length / myBookings.length) * 100)
      : 0;
    const bikesWithStats = await Promise.all(myBikes.map(b => getBikeWithStats(b)));
    res.json({
      success: true,
      data: {
        totalListings: myBikes.length,
        liveListings: myBikes.filter(b => b.status === 'approved').length,
        pendingListings: myBikes.filter(b => b.status === 'pending').length,
        totalBookings: myBookings.length,
        pendingBookings: myBookings.filter(b => b.status === 'pending').length,
        confirmedBookings: confirmedBookings.length,
        completedTrips,
        totalEarnings,
        approvalRate,
        myBikes: bikesWithStats
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ ADMIN ============

app.get('/api/admin/stats', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    const [totalUsers, totalBikes, liveListings, pendingListings, totalBookings, pendingBookings, totalRevenue, pendingVerifications, totalReviews] = await Promise.all([
      User.countDocuments(),
      Bike.countDocuments(),
      Bike.countDocuments({ status: 'approved' }),
      Bike.countDocuments({ status: 'pending' }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'pending' }),
      Booking.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$totalPrice' } } }]),
      Verification.countDocuments({ status: 'pending' }),
      Review.countDocuments()
    ]);
    res.json({
      success: true,
      data: {
        totalUsers,
        totalBikes,
        liveListings,
        pendingListings,
        totalBookings,
        pendingBookings,
        totalRevenue: totalRevenue[0]?.total || 0,
        pendingVerifications,
        totalReviews,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/users', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}, '-password -__v');
    const verifications = await Verification.find({}).sort({ submittedAt: -1 });
    const verMap = {};
    verifications.forEach(v => {
      if (!verMap[v.userId] || new Date(v.submittedAt) > new Date(verMap[v.userId].submittedAt)) {
        verMap[v.userId] = v;
      }
    });
    const enriched = users.map(u => ({
      ...u.toObject(),
      verificationStatus: verMap[u._id.toString()]?.status || 'unsubmitted'
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/bookings', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json({ success: true, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/pending-listings', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    const pending = await Bike.find({ status: 'pending' });
    res.json({ success: true, count: pending.length, data: pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/bikes', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    const bikes = await Bike.find();
    const bikesWithStats = await Promise.all(bikes.map(b => getBikeWithStats(b)));
    res.json({ success: true, data: bikesWithStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/listings/:id/status', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    const bike = await Bike.findById(req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Listing not found' });
    bike.status = req.body.status;
    bike.isAvailable = req.body.status === 'approved';
    bike.verified = req.body.status === 'approved';
    if (req.body.reviewerNote) bike.reviewerNote = req.body.reviewerNote;
    await bike.save();
    res.json({ success: true, message: 'Listing ' + req.body.status, data: bike });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin-only: create another admin user
app.post('/api/admin/create-admin', protect, resolveUser, adminOnly, async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password min 6 chars' });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const admin = await User.create({
      email: email.toLowerCase(),
      password: hashed,
      firstName,
      lastName,
      role: 'admin',
      rating: 5.0,
      trips: 0,
      responseTime: '< 1 hour'
    });
    res.status(201).json({
      success: true,
      message: 'Admin user created',
      data: { email: admin.email, firstName: admin.firstName, lastName: admin.lastName, role: admin.role }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ STRIPE PAYMENTS ============

app.post('/api/payments/create-intent', protect, resolveUser, async (req, res) => {
  try {
    // SECURITY: Frontend sends ONLY booking details, NOT amount.
    // Backend calculates the total price server-side — frontend can never manipulate pricing.
    const { bikeId, startDate, endDate, protectionTier = 'basic', currency = 'cad', bookingId } = req.body;

    // --- Input validation ---
    if (!bikeId || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'bikeId, startDate, and endDate are required' });
    }
    const sDate = new Date(startDate);
    const eDate = new Date(endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    if (sDate < now) {
      return res.status(400).json({ success: false, message: 'Pickup date cannot be in the past' });
    }
    if (eDate <= sDate) {
      return res.status(400).json({ success: false, message: 'Return date must be after pickup date' });
    }

    // --- Stripe configuration check ---
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(500).json({ success: false, message: 'Payment provider is not configured. Contact support.' });
    }
    if (!stripeKey.startsWith('sk_test_') && !stripeKey.startsWith('sk_live_')) {
      return res.status(500).json({ success: false, message: 'Invalid payment provider configuration. Contact support.' });
    }

    // --- Bike lookup ---
    if (!isValidObjectId(bikeId)) {
      return res.status(400).json({ success: false, message: 'Invalid bike ID format' });
    }
    const bike = await Bike.findById(bikeId);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    if (!bike.isAvailable || bike.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'This bike is not available for booking' });
    }

    // --- ID verification gate (riders must be verified to pay) ---
    const verification = await Verification.findOne({ userId: req.userDoc._id.toString(), status: 'verified' });
    if (!verification) {
      return res.status(403).json({
        success: false,
        message: 'Your ID verification is not yet approved. Complete verification under your profile before booking.'
      });
    }

    // --- Server-side price calculation (frontend cannot control this) ---
    const days = Math.max(1, Math.ceil((eDate - sDate) / (1000 * 60 * 60 * 24)));
    const basePrice = bike.dailyRate * days;

    const tierConfig = {
      basic: { name: 'Basic Protection', dailyPrice: 0, deposit: 2500 },
      standard: { name: 'Standard Protection', dailyPrice: 30, deposit: 1500 },
      premium: { name: 'Premium Protection', dailyPrice: 55, deposit: 750 },
    };
    const tier = tierConfig[protectionTier] || tierConfig.basic;
    const protCost = tier.dailyPrice * days;
    const serviceFee = Math.round(basePrice * 0.10);
    const subtotal = basePrice + protCost + serviceFee;
    const tax = Math.round(subtotal * 0.12);
    const total = subtotal + tax;

    // --- Create Stripe PaymentIntent ---
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100), // cents
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `RYDI booking: ${bike.year} ${bike.make} ${bike.model} (${days} days)`,
      metadata: {
        bikeId: bikeId,
        bikeName: bike.year + ' ' + bike.make + ' ' + bike.model,
        renterId: req.userDoc._id.toString(),
        renterEmail: req.userDoc.email,
        platform: 'rydi.ca',
        bookingId: bookingId || ''
      }
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: total,
      currency: currency.toUpperCase(),
      pricing: { days, basePrice, protCost, serviceFee, tax, total, tierName: tier.name, deposit: tier.deposit }
    });
  } catch (err) {
    console.error('Stripe PaymentIntent error:', err.message);
    // Never leak Stripe internal error details to the client
    const safeMessage = err.type === 'StripeAuthenticationError'
      ? 'Payment provider authentication failed. Contact support.'
      : 'Payment processing failed. Please try again or contact support.';
    res.status(500).json({ success: false, message: safeMessage });
  }
});

app.get('/api/payments/config', (req, res) => {
  res.json({
    success: true,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
  });
});

// ============ HEALTH ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '3.3.0' });
});

app.get('/', (req, res) => {
  res.json({
    message: 'RYDI API v3.3 - Role-based verification + production Stripe',
    version: '3.3.0',
    features: ['Auth', 'Bikes', 'Bookings', 'Reviews', 'Role-based Verifications', 'Owner Dashboard', 'Admin Panel', 'Email Notifications', 'Google Maps', 'Stripe Payments', 'Contact Form'],
    endpoints: ['/api/auth', '/api/bikes', '/api/bookings', '/api/reviews', '/api/verifications', '/api/owner/stats', '/api/admin', '/api/payments', '/api/contact']
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Server error' });
});

// Start — connect DB then seed
connectDB().then(async () => {
  await seedData();
  app.listen(PORT, () => {
    console.log(`RYDI Backend v3.3 (MongoDB + Role-based verification) running on port ${PORT}`);
  });
});
