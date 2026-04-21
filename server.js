const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'rydi-secret-key-change-me';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'builtby.sc@outlook.com';

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://rydi.ca', 'https://www.rydi.ca', 'https://polite-sawine-a3ca46.netlify.app', 'https://ehva2oenha7q4.kimi.show'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// ============ PERSISTENT JSON DATABASE ============
const DB_PATH = path.join(__dirname, 'db.json');

let db = {
  users: [],
  bikes: [],
  bookings: [],
  reviews: [],
  verifications: [],
  nextId: 1,
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      db = { ...db, ...data };
      console.log('Database loaded from disk:', DB_PATH);
    }
  } catch (err) {
    console.error('Failed to load DB, using empty:', err.message);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Failed to save DB:', err.message);
  }
}

// Auto-save every 30 seconds
setInterval(saveDB, 30000);

// ============ EMAIL SERVICE ============
const emailService = {
  async send({ to, subject, html, text }) {
    // If SendGrid API key is configured, use it
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
        // Fall through to console log
      }
    }
    // Fallback: log to console
    console.log('\n========== EMAIL ==========');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Text:', text || html || subject);
    console.log('===========================\n');
    return { success: true, mock: true };
  },

  async bookingRequested({ to, renterName, bikeName, dates, total }) {
    return this.send({
      to,
      subject: `New Booking Request: ${bikeName}`,
      text: `Hi there,\n\n${renterName} has requested to book your ${bikeName} for ${dates}.\nTotal: $${total}\n\nPlease log in to approve or decline.\n\n- RYDI Team`,
    });
  },

  async bookingStatusUpdate({ to, bikeName, status, ownerMessage }) {
    const statusText = status === 'confirmed' ? 'APPROVED' : status === 'rejected' ? 'DECLINED' : status.toUpperCase();
    return this.send({
      to,
      subject: `Booking ${statusText}: ${bikeName}`,
      text: `Hi there,\n\nYour booking for ${bikeName} has been ${statusText}.${ownerMessage ? '\n\nMessage from owner: ' + ownerMessage : ''}\n\nLog in to view details.\n\n- RYDI Team`,
    });
  },

  async bookingReminder({ to, bikeName, pickupDate }) {
    return this.send({
      to,
      subject: `Reminder: Pickup tomorrow for ${bikeName}`,
      text: `Hi there,\n\nThis is a reminder that your pickup for ${bikeName} is scheduled for ${pickupDate}.\n\nMake sure to bring:\n- Valid Class 6 license\n- Government ID\n- Credit card for deposit\n- Your riding gear\n\nSafe rides!\n- RYDI Team`,
    });
  },

  async verificationStatus({ to, status }) {
    const statusText = status === 'verified' ? 'APPROVED' : 'DECLINED';
    return this.send({
      to,
      subject: `ID Verification ${statusText}`,
      text: `Hi there,\n\nYour ID verification has been ${statusText}.\n${status === 'verified' ? 'You can now book motorcycles on RYDI!' : 'Please contact support for more information.'}\n\n- RYDI Team`,
    });
  },
};

// ============ ID GENERATOR ============
function genId(prefix) {
  return `${prefix}_${Date.now()}_${db.nextId++}`;
}

// ============ AUTH MIDDLEWARE ============
function protect(req, res, next) {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = db.users.find(u => u._id === decoded.id);
    if (!req.user) return res.status(401).json({ success: false, message: 'User not found' });
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') next();
  else res.status(403).json({ success: false, message: 'Admin access required' });
}

// ============ HELPER FUNCTIONS ============
function getBikeWithStats(bike) {
  const bikeReviews = db.reviews.filter(r => r.bikeId === bike._id);
  const avgRating = bikeReviews.length > 0
    ? (bikeReviews.reduce((sum, r) => sum + r.rating, 0) / bikeReviews.length).toFixed(1)
    : (bike.rating || 0);
  const totalTrips = bikeReviews.length;
  return { ...bike, avgRating: parseFloat(avgRating), totalTrips, reviewCount: bikeReviews.length };
}

function getUserVerificationStatus(userId) {
  const verification = db.verifications.find(v => v.userId === userId);
  return verification ? verification.status : 'unsubmitted';
}

// ============ SEED DATA ============
async function seedData() {
  if (db.users.length === 0) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = {
      _id: genId('user'),
      email: 'builtby.sc@outlook.com',
      password: adminPassword,
      firstName: 'Shayne',
      lastName: 'Chassie',
      role: 'admin',
      rating: 5.0,
      trips: 56,
      responseTime: '< 1 hour',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString()
    };
    db.users.push(admin);

    const ownerPassword = await bcrypt.hash('owner123', 10);
    const owner = {
      _id: genId('user'),
      email: 'jennifer@rydi.ca',
      password: ownerPassword,
      firstName: 'Jennifer',
      lastName: 'Bray',
      role: 'owner',
      rating: 5.0,
      trips: 38,
      responseTime: '< 2 hours',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString()
    };
    db.users.push(owner);

    const riderPassword = await bcrypt.hash('rider123', 10);
    const rider = {
      _id: genId('user'),
      email: 'rider@example.com',
      password: riderPassword,
      firstName: 'James',
      lastName: 'Tremblay',
      role: 'rider',
      rating: 4.9,
      trips: 12,
      responseTime: '< 1 hour',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString()
    };
    db.users.push(rider);

    // Seed bikes
    db.bikes.push(
      {
        _id: genId('bike'), make: 'Kawasaki', model: 'KLE 500', year: 2024, dailyRate: 85,
        location: 'Vancouver, BC', category: 'Adventure',
        description: 'Perfect adventure bike for exploring BC backroads. Versatile on-road and off-road capability.',
        engineSize: '498cc', seatHeight: '845mm', weight: '181kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike1.jpg'], ownerId: admin._id, ownerName: 'Shayne C.', ownerEmail: admin.email,
        features: ['ABS', 'Luggage Rack', 'Hand Guards', 'Engine Guards', 'Skid Plate'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 25,
        verified: true, lat: 49.2827, lng: -123.1207, createdAt: new Date().toISOString()
      },
      {
        _id: genId('bike'), make: 'KTM', model: '990 Duke', year: 2024, dailyRate: 120,
        location: 'Vancouver, BC', category: 'Street',
        description: 'Powerful street bike with aggressive styling. Thrilling performance for urban and canyon riding.',
        engineSize: '947cc', seatHeight: '825mm', weight: '179kg', transmission: '6-speed', minExperience: 'Advanced',
        images: ['/images/bike2.jpg'], ownerId: admin._id, ownerName: 'Shayne C.', ownerEmail: admin.email,
        features: ['ABS', 'Traction Control', 'Quickshifter', 'LED Lights', 'Ride Modes'],
        status: 'approved', isAvailable: true, delivery: false, deliveryFee: 0,
        verified: true, lat: 49.2827, lng: -123.1207, createdAt: new Date().toISOString()
      },
      {
        _id: genId('bike'), make: 'BMW', model: 'F 450 GS', year: 2024, dailyRate: 95,
        location: 'Langley, BC', category: 'Adventure',
        description: 'Lightweight adventure bike perfect for BC backroads. Premium German engineering.',
        engineSize: '450cc', seatHeight: '830mm', weight: '175kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike3.jpg'], ownerId: owner._id, ownerName: 'Jennifer B.', ownerEmail: owner.email,
        features: ['ABS', 'Ride Modes', 'Heated Grips', 'GPS Mount', 'Luggage System'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 30,
        verified: true, lat: 49.1042, lng: -122.6604, createdAt: new Date().toISOString()
      },
      {
        _id: genId('bike'), make: 'Honda', model: 'NX500', year: 2024, dailyRate: 75,
        location: 'Chilliwack, BC', category: 'Touring',
        description: 'Versatile all-rounder ideal for touring the Fraser Valley. Comfortable and fuel-efficient.',
        engineSize: '471cc', seatHeight: '830mm', weight: '196kg', transmission: '6-speed', minExperience: 'Beginner+',
        images: ['/images/bike4.jpg'], ownerId: owner._id, ownerName: 'Jennifer B.', ownerEmail: owner.email,
        features: ['ABS', 'Windshield', 'USB Charging', 'Side Bags', 'Heated Grips'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 20,
        verified: true, lat: 49.1579, lng: -121.9515, createdAt: new Date().toISOString()
      },
      {
        _id: genId('bike'), make: 'Yamaha', model: 'Tenere 700', year: 2025, dailyRate: 110,
        location: 'Squamish, BC', category: 'Adventure',
        description: 'The ultimate BC adventure bike. Purpose-built for exploring Sea to Sky Highway.',
        engineSize: '689cc', seatHeight: '875mm', weight: '205kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike5.jpg'], ownerId: admin._id, ownerName: 'Shayne C.', ownerEmail: admin.email,
        features: ['ABS', 'Traction Control', 'Skid Plate', 'Hand Guards', 'Luggage System', 'Heated Grips'],
        status: 'approved', isAvailable: true, delivery: false, deliveryFee: 0,
        verified: true, lat: 49.7016, lng: -123.1558, createdAt: new Date().toISOString()
      },
      {
        _id: genId('bike'), make: 'Triumph', model: 'Tiger 900 GT', year: 2024, dailyRate: 130,
        location: 'Victoria, BC', category: 'Touring',
        description: 'Premium touring adventure bike. Explore Vancouver Island in comfort and style.',
        engineSize: '888cc', seatHeight: '810mm', weight: '214kg', transmission: '6-speed', minExperience: 'Intermediate',
        images: ['/images/bike6.jpg'], ownerId: owner._id, ownerName: 'Jennifer B.', ownerEmail: owner.email,
        features: ['ABS', 'Cruise Control', 'Heated Grips/Seat', 'Panniers', 'TFT Display', 'Windshield'],
        status: 'approved', isAvailable: true, delivery: true, deliveryFee: 35,
        verified: true, lat: 48.4284, lng: -123.3656, createdAt: new Date().toISOString()
      }
    );

    // Seed sample reviews
    db.reviews.push(
      { _id: genId('review'), bikeId: db.bikes[0]._id, bikeName: '2024 Kawasaki KLE 500', ownerId: db.bikes[0].ownerId, renterId: rider._id, renterName: 'James T.', rating: 5, comment: 'Fantastic bike for the Sea to Sky trip! Owner was very accommodating and the bike was in perfect condition. Highly recommend!', createdAt: '2026-03-15T10:00:00Z' },
      { _id: genId('review'), bikeId: db.bikes[0]._id, bikeName: '2024 Kawasaki KLE 500', ownerId: db.bikes[0].ownerId, renterId: genId('user'), renterName: 'Maria S.', rating: 5, comment: 'Great adventure bike. Took it through the Fraser Valley and had zero issues. Smooth ride and well maintained.', createdAt: '2026-03-20T14:30:00Z' },
      { _id: genId('review'), bikeId: db.bikes[2]._id, bikeName: '2024 BMW F 450 GS', ownerId: db.bikes[2].ownerId, renterId: rider._id, renterName: 'David L.', rating: 4, comment: 'Awesome BMW! Perfect for the backroads around Langley. Would definitely rent again.', createdAt: '2026-04-01T09:15:00Z' },
      { _id: genId('review'), bikeId: db.bikes[4]._id, bikeName: '2025 Yamaha Tenere 700', ownerId: db.bikes[4].ownerId, renterId: genId('user'), renterName: 'Priya K.', rating: 5, comment: 'The Tenere is a dream machine for BC. Took it to Whistler and the handling was incredible. Owner was super helpful with route suggestions!', createdAt: '2026-04-05T16:45:00Z' }
    );

    // Seed sample booking
    db.bookings.push({
      _id: genId('booking'),
      bikeId: db.bikes[0]._id,
      bikeName: db.bikes[0].year + ' ' + db.bikes[0].make + ' ' + db.bikes[0].model,
      renter: rider._id,
      renterName: rider.firstName + ' ' + rider.lastName,
      renterEmail: rider.email,
      owner: admin._id,
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
      createdAt: '2026-02-28T08:00:00Z',
      completedAt: '2026-03-14T18:00:00Z'
    });

    saveDB();
    console.log('Seed complete!');
    console.log('Admin: builtby.sc@outlook.com / admin123');
    console.log('Owner: jennifer@rydi.ca / owner123');
    console.log('Rider: rider@example.com / rider123');
  }
}

// ============ AUTH ============
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password min 6 chars' });
    }
    if (db.users.find(u => u.email === email.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = {
      _id: genId('user'),
      email: email.toLowerCase(),
      password: hashed,
      firstName,
      lastName,
      role: role || 'rider',
      rating: 0,
      trips: 0,
      responseTime: '< 1 hour',
      verificationStatus: 'unsubmitted',
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    saveDB();
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({
      success: true,
      data: {
        token,
        user: { _id: user._id, id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, verificationStatus: user.verificationStatus }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.users.find(u => u.email === email.toLowerCase());
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    user.lastLogin = new Date();
    saveDB();
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true,
      data: {
        token,
        user: { _id: user._id, id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, verificationStatus: user.verificationStatus }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/auth/me', protect, (req, res) => {
  const { password, ...userWithoutPassword } = req.user;
  const verification = db.verifications.find(v => v.userId === req.user._id);
  res.json({
    success: true,
    data: {
      ...userWithoutPassword,
      verificationStatus: verification ? verification.status : req.user.verificationStatus || 'unsubmitted',
      verificationDetails: verification || null
    }
  });
});

// ============ VERIFICATION ============
app.post('/api/verifications', protect, (req, res) => {
  try {
    const { licenseImage, selfieImage } = req.body;
    if (!licenseImage || !selfieImage) {
      return res.status(400).json({ success: false, message: 'Both license and selfie images are required' });
    }
    // Remove any existing pending verification
    db.verifications = db.verifications.filter(v => v.userId !== req.user._id);
    const verification = {
      _id: genId('ver'),
      userId: req.user._id,
      userName: req.user.firstName + ' ' + req.user.lastName,
      userEmail: req.user.email,
      licenseImage,
      selfieImage,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewerNote: null,
    };
    db.verifications.push(verification);
    // Update user
    const user = db.users.find(u => u._id === req.user._id);
    if (user) user.verificationStatus = 'pending';
    saveDB();
    res.status(201).json({ success: true, message: 'Verification submitted for review', data: verification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/verifications/my', protect, (req, res) => {
  try {
    const verification = db.verifications.find(v => v.userId === req.user._id);
    res.json({ success: true, data: verification || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: get all pending verifications
app.get('/api/admin/verifications', protect, adminOnly, (req, res) => {
  try {
    const pending = db.verifications.filter(v => v.status === 'pending');
    res.json({ success: true, count: pending.length, data: pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: approve/reject verification
app.put('/api/admin/verifications/:id/status', protect, adminOnly, (req, res) => {
  try {
    const verification = db.verifications.find(v => v._id === req.params.id);
    if (!verification) return res.status(404).json({ success: false, message: 'Verification not found' });
    verification.status = req.body.status; // 'verified' or 'rejected'
    verification.reviewerNote = req.body.reviewerNote || null;
    verification.reviewedAt = new Date().toISOString();
    // Update user
    const user = db.users.find(u => u._id === verification.userId);
    if (user) {
      user.verificationStatus = req.body.status;
    }
    saveDB();
    // Send email notification
    emailService.verificationStatus({ to: verification.userEmail, status: req.body.status });
    res.json({ success: true, message: 'Verification ' + req.body.status, data: verification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ BIKES / LISTINGS ============

// Get all APPROVED bikes (public)
app.get('/api/bikes', (req, res) => {
  try {
    const { category, location, search } = req.query;
    let result = db.bikes.filter(b => b.status === 'approved' && b.isAvailable);
    if (category) result = result.filter(b => b.category === category);
    if (location) result = result.filter(b => b.location.toLowerCase().includes(location.toLowerCase()));
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(b => b.make.toLowerCase().includes(s) || b.model.toLowerCase().includes(s) || b.description.toLowerCase().includes(s));
    }
    // Add reviews/stats
    result = result.map(b => getBikeWithStats(b));
    res.json({ success: true, count: result.length, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get single bike (public)
app.get('/api/bikes/:id', (req, res) => {
  try {
    const bike = db.bikes.find(b => b._id === req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    // Get reviews for this bike
    const bikeReviews = db.reviews.filter(r => r.bikeId === bike._id);
    res.json({
      success: true,
      data: {
        ...getBikeWithStats(bike),
        reviews: bikeReviews
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Create bike listing (any authenticated user)
app.post('/api/bikes', protect, (req, res) => {
  try {
    const bike = {
      _id: genId('bike'),
      ...req.body,
      ownerId: req.user._id,
      ownerName: req.user.firstName + ' ' + req.user.lastName[0] + '.',
      ownerEmail: req.user.email,
      status: 'pending',
      isAvailable: false,
      verified: false,
      createdAt: new Date().toISOString()
    };
    db.bikes.push(bike);
    saveDB();
    res.status(201).json({ success: true, message: 'Listing submitted for review', data: bike });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Owner: Get MY bikes (all statuses)
app.get('/api/bikes/my-bikes', protect, (req, res) => {
  try {
    const myBikes = db.bikes.filter(b => b.ownerId === req.user._id);
    res.json({ success: true, count: myBikes.length, data: myBikes.map(b => getBikeWithStats(b)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Owner: Update my bike
app.put('/api/bikes/:id', protect, (req, res) => {
  try {
    const bike = db.bikes.find(b => b._id === req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    if (bike.ownerId !== req.user._id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    Object.assign(bike, req.body, { updatedAt: new Date().toISOString() });
    saveDB();
    res.json({ success: true, data: bike });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Owner: Delete my bike
app.delete('/api/bikes/:id', protect, (req, res) => {
  try {
    const bike = db.bikes.find(b => b._id === req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    if (bike.ownerId !== req.user._id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    db.bikes = db.bikes.filter(b => b._id !== req.params.id);
    saveDB();
    res.json({ success: true, message: 'Listing deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ REVIEWS ============

// Create review (renter only, after completed booking)
app.post('/api/reviews', protect, (req, res) => {
  try {
    const { bikeId, bookingId, rating, comment } = req.body;
    if (!bikeId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Bike ID and rating (1-5) required' });
    }
    // Verify user has a completed booking for this bike
    const booking = db.bookings.find(b =>
      b.bikeId === bikeId &&
      b.renter === req.user._id &&
      b.status === 'completed'
    );
    if (!booking) {
      return res.status(403).json({ success: false, message: 'You can only review bikes after a completed booking' });
    }
    // Check if already reviewed
    const existing = db.reviews.find(r => r.bikeId === bikeId && r.renterId === req.user._id);
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already reviewed this bike' });
    }
    const bike = db.bikes.find(b => b._id === bikeId);
    const review = {
      _id: genId('review'),
      bikeId,
      bikeName: bike ? `${bike.year} ${bike.make} ${bike.model}` : 'Unknown Bike',
      ownerId: bike?.ownerId || '',
      bookingId: bookingId || booking._id,
      renterId: req.user._id,
      renterName: req.user.firstName + ' ' + req.user.lastName[0] + '.',
      rating,
      comment: comment || '',
      createdAt: new Date().toISOString()
    };
    db.reviews.push(review);
    // Update user trips count
    const user = db.users.find(u => u._id === req.user._id);
    if (user) user.trips = (user.trips || 0) + 1;
    saveDB();
    res.status(201).json({ success: true, data: review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get reviews for a bike
app.get('/api/reviews/bike/:bikeId', (req, res) => {
  try {
    const reviews = db.reviews.filter(r => r.bikeId === req.params.bikeId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get reviews by owner
app.get('/api/reviews/owner/:ownerId', (req, res) => {
  try {
    const reviews = db.reviews.filter(r => r.ownerId === req.params.ownerId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ BOOKINGS ============

// Create booking
app.post('/api/bookings', protect, (req, res) => {
  try {
    const { bikeId, startDate, endDate, protectionTier, riderMessage, totalPrice, deliveryOption } = req.body;

    // Check verification
    const verification = db.verifications.find(v => v.userId === req.user._id && v.status === 'verified');
    if (!verification && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You must be verified to book a motorcycle. Please submit your ID verification.' });
    }

    const bike = db.bikes.find(b => b._id === bikeId);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    if (!bike.isAvailable || bike.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Bike is not available for booking' });
    }

    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    const basePrice = bike.dailyRate * days;

    // Protection tier logic
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

    const booking = {
      _id: genId('booking'),
      bikeId,
      bikeName: bike.year + ' ' + bike.make + ' ' + bike.model,
      bikeImage: bike.images?.[0] || '/images/placeholder-bike.jpg',
      renter: req.user._id,
      renterName: req.user.firstName + ' ' + req.user.lastName,
      renterEmail: req.user.email,
      owner: bike.ownerId,
      ownerName: bike.ownerName,
      ownerEmail: bike.ownerEmail,
      startDate,
      endDate,
      days,
      status: 'pending',
      totalPrice: total,
      // Protection tier details
      protectionTier: protectionTier || 'basic',
      protectionName: tier.name,
      protectionCost: protCost,
      protectionDeposit: tier.deposit,
      serviceFee,
      tax,
      deposit: tier.deposit,
      deliveryOption: deliveryOption || 'pickup',
      riderMessage: riderMessage || '',
      createdAt: new Date().toISOString()
    };
    db.bookings.push(booking);
    saveDB();

    // Send email to owner
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

// Get my bookings (renter)
app.get('/api/bookings/my-bookings', protect, (req, res) => {
  try {
    const myBookings = db.bookings.filter(b => b.renter === req.user._id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    // Add canReview flag
    const enriched = myBookings.map(b => {
      const hasReview = db.reviews.find(r => r.bookingId === b._id && r.renterId === req.user._id);
      return { ...b, canReview: b.status === 'completed' && !hasReview, hasReview: !!hasReview };
    });
    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get bookings for MY bikes (owner)
app.get('/api/bookings/owner-bookings', protect, (req, res) => {
  try {
    const ownerBookings = db.bookings.filter(b => b.owner === req.user._id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, count: ownerBookings.length, data: ownerBookings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update booking status (owner approves/rejects)
app.put('/api/bookings/:id/status', protect, (req, res) => {
  try {
    const booking = db.bookings.find(b => b._id === req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.owner !== req.user._id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    booking.status = req.body.status;
    if (req.body.ownerMessage) booking.ownerMessage = req.body.ownerMessage;
    if (req.body.status === 'completed') booking.completedAt = new Date().toISOString();
    saveDB();

    // Send email to renter
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

// ============ GOOGLE MAPS PROXY ============
app.get('/api/maps/geocode', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ success: false, message: 'Address required' });
    if (!GOOGLE_MAPS_API_KEY) {
      // Return approximate BC coordinates based on location name
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
      if (key) return res.json({ success: true, data: bcCoords[key], mock: true });
      return res.json({ success: true, data: { lat: 49.2827, lng: -123.1207 }, mock: true });
    }
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`);
    const data = await response.json();
    if (data.results && data.results[0]) {
      res.json({ success: true, data: data.results[0].geometry.location });
    } else {
      res.status(404).json({ success: false, message: 'Location not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ OWNER DASHBOARD STATS ============
app.get('/api/owner/stats', protect, (req, res) => {
  try {
    const myBikes = db.bikes.filter(b => b.ownerId === req.user._id);
    const myBikeIds = myBikes.map(b => b._id);
    const myBookings = db.bookings.filter(b => myBikeIds.includes(b.bikeId));
    const confirmedBookings = myBookings.filter(b => b.status === 'confirmed' || b.status === 'completed');
    const totalEarnings = confirmedBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const completedTrips = myBookings.filter(b => b.status === 'completed').length;
    const approvalRate = myBookings.length > 0
      ? Math.round((confirmedBookings.length / myBookings.length) * 100)
      : 0;

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
        myBikes: myBikes.map(b => getBikeWithStats(b))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ ADMIN ============

// Dashboard stats
app.get('/api/admin/stats', protect, adminOnly, (req, res) => {
  try {
    const pendingListings = db.bikes.filter(b => b.status === 'pending').length;
    const liveListings = db.bikes.filter(b => b.status === 'approved').length;
    const pendingBookings = db.bookings.filter(b => b.status === 'pending').length;
    const totalRevenue = db.bookings.filter(b => b.status === 'completed').reduce((a, b) => a + (b.totalPrice || 0), 0);
    const pendingVerifications = db.verifications.filter(v => v.status === 'pending').length;
    res.json({
      success: true,
      data: {
        totalUsers: db.users.length,
        totalBikes: db.bikes.length,
        liveListings,
        pendingListings,
        totalBookings: db.bookings.length,
        pendingBookings,
        totalRevenue,
        pendingVerifications,
        totalReviews: db.reviews.length,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get ALL users
app.get('/api/admin/users', protect, adminOnly, (req, res) => {
  try {
    const usersWithoutPasswords = db.users.map(u => {
      const { password, ...rest } = u;
      return { ...rest, verificationStatus: getUserVerificationStatus(u._id) };
    });
    res.json({ success: true, data: usersWithoutPasswords });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get ALL bookings (admin view)
app.get('/api/admin/bookings', protect, adminOnly, (req, res) => {
  try {
    res.json({ success: true, data: db.bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get pending listings (admin)
app.get('/api/admin/pending-listings', protect, adminOnly, (req, res) => {
  try {
    const pending = db.bikes.filter(b => b.status === 'pending');
    res.json({ success: true, count: pending.length, data: pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Approve/reject listing (admin)
app.put('/api/admin/listings/:id/status', protect, adminOnly, (req, res) => {
  try {
    const bike = db.bikes.find(b => b._id === req.params.id);
    if (!bike) return res.status(404).json({ success: false, message: 'Listing not found' });
    bike.status = req.body.status;
    bike.isAvailable = req.body.status === 'approved';
    bike.verified = req.body.status === 'approved';
    if (req.body.reviewerNote) bike.reviewerNote = req.body.reviewerNote;
    saveDB();
    res.json({ success: true, message: 'Listing ' + req.body.status, data: bike });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all bikes (admin view)
app.get('/api/admin/bikes', protect, adminOnly, (req, res) => {
  try {
    res.json({ success: true, data: db.bikes.map(b => getBikeWithStats(b)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ HEALTH ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '3.0.0' });
});

app.get('/', (req, res) => {
  res.json({
    message: 'RYDI API v3 - Production Marketplace',
    version: '3.0.0',
    features: ['Auth', 'Bikes', 'Bookings', 'Reviews', 'Verifications', 'Owner Dashboard', 'Admin Panel', 'Email Notifications', 'Google Maps'],
    endpoints: ['/api/auth', '/api/bikes', '/api/bookings', '/api/reviews', '/api/verifications', '/api/owner/stats', '/api/admin']
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Server error' });
});

// Start
loadDB();
seedData().then(() => {
  app.listen(PORT, () => {
    console.log(`RYDI Backend v3 running on port ${PORT}`);
    console.log(`Features: Persistent DB, Reviews, Verification, Email, Owner Dashboard`);
  });
});
