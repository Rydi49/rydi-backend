const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'rydi-secret-key-change-me';

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://rydi.ca', 'https://www.rydi.ca', 'https://polite-sawine-a3ca46.netlify.app'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// In-memory storage
const users = [];
const bikes = [];
const bookings = [];

// Seed data
async function seedData() {
  // Admin user (Shayne)
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = {
    _id: 'admin_' + Date.now(),
    email: 'builtby.sc@outlook.com',
    password: adminPassword,
    firstName: 'Shayne',
    lastName: 'Chassie',
    role: 'admin',
    rating: 5.0,
    trips: 56,
    responseTime: '< 1 hour',
    createdAt: new Date().toISOString()
  };
  users.push(admin);

  // Owner user (Jennifer)
  const ownerPassword = await bcrypt.hash('owner123', 10);
  const owner = {
    _id: 'owner_' + Date.now(),
    email: 'jennifer@rydi.ca',
    password: ownerPassword,
    firstName: 'Jennifer',
    lastName: 'Bray',
    role: 'owner',
    rating: 5.0,
    trips: 38,
    responseTime: '< 2 hours',
    createdAt: new Date().toISOString()
  };
  users.push(owner);

  // Demo bikes
  bikes.push(
    {
      _id: 'bike_1', make: 'Kawasaki', model: 'KLE 500', year: 2024, dailyRate: 85,
      location: 'Vancouver, BC', category: 'Adventure',
      description: 'Perfect adventure bike for exploring BC backroads. Versatile on-road and off-road capability with comfortable ergonomics for long rides.',
      engineSize: '498cc', seatHeight: '845mm', weight: '181kg', transmission: '6-speed', minExperience: 'Intermediate',
      images: ['/images/bike1.jpg'], owner: admin, features: ['ABS', 'Luggage Rack', 'Hand Guards', 'Engine Guards', 'Skid Plate'],
      isAvailable: true, delivery: true, deliveryFee: 25
    },
    {
      _id: 'bike_2', make: 'KTM', model: '990 Duke', year: 2024, dailyRate: 120,
      location: 'Vancouver, BC', category: 'Street',
      description: 'Powerful street bike with aggressive styling. The 990 Duke delivers thrilling performance for urban and canyon riding.',
      engineSize: '947cc', seatHeight: '825mm', weight: '179kg', transmission: '6-speed', minExperience: 'Advanced',
      images: ['/images/bike2.jpg'], owner: admin, features: ['ABS', 'Traction Control', 'Quickshifter', 'LED Lights', 'Ride Modes'],
      isAvailable: true, delivery: false, deliveryFee: 0
    },
    {
      _id: 'bike_3', make: 'BMW', model: 'F 450 GS', year: 2024, dailyRate: 95,
      location: 'Langley, BC', category: 'Adventure',
      description: 'Lightweight adventure bike perfect for BC backroads. Nimble handling with premium German engineering and reliability.',
      engineSize: '450cc', seatHeight: '830mm', weight: '175kg', transmission: '6-speed', minExperience: 'Intermediate',
      images: ['/images/bike3.jpg'], owner: owner, features: ['ABS', 'Ride Modes', 'Heated Grips', 'GPS Mount', 'Luggage System'],
      isAvailable: true, delivery: true, deliveryFee: 30
    },
    {
      _id: 'bike_4', make: 'Honda', model: 'NX500', year: 2024, dailyRate: 75,
      location: 'Chilliwack, BC', category: 'Touring',
      description: 'Versatile all-rounder ideal for touring the Fraser Valley and beyond. Comfortable, reliable, and fuel-efficient.',
      engineSize: '471cc', seatHeight: '830mm', weight: '196kg', transmission: '6-speed', minExperience: 'Beginner+',
      images: ['/images/bike4.jpg'], owner: owner, features: ['ABS', 'Windshield', 'USB Charging', 'Side Bags', 'Heated Grips'],
      isAvailable: true, delivery: true, deliveryFee: 20
    },
    {
      _id: 'bike_5', make: 'Yamaha', model: 'Tenere 700', year: 2025, dailyRate: 110,
      location: 'Squamish, BC', category: 'Adventure',
      description: 'The ultimate BC adventure bike. Purpose-built for exploring Sea to Sky Highway and beyond.',
      engineSize: '689cc', seatHeight: '875mm', weight: '205kg', transmission: '6-speed', minExperience: 'Intermediate',
      images: ['/images/bike5.jpg'], owner: admin, features: ['ABS', 'Traction Control', 'Skid Plate', 'Hand Guards', 'Luggage System', 'Heated Grips'],
      isAvailable: true, delivery: false, deliveryFee: 0
    },
    {
      _id: 'bike_6', make: 'Triumph', model: 'Tiger 900 GT', year: 2024, dailyRate: 130,
      location: 'Victoria, BC', category: 'Touring',
      description: 'Premium touring adventure bike. Explore Vancouver Island in comfort and style with full touring amenities.',
      engineSize: '888cc', seatHeight: '810mm', weight: '214kg', transmission: '6-speed', minExperience: 'Intermediate',
      images: ['/images/bike6.jpg'], owner: owner, features: ['ABS', 'Cruise Control', 'Heated Grips/Seat', 'Panniers', 'TFT Display', 'Windshield'],
      isAvailable: true, delivery: true, deliveryFee: 35
    }
  );

  console.log('Seed complete!');
  console.log('Admin: builtby.sc@outlook.com / admin123');
  console.log('Owner: jennifer@rydi.ca / owner123');
}

// Auth middleware
function protect(req, res, next) {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = users.find(u => u._id === decoded.id);
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

// ========== AUTH ROUTES ==========

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password min 6 chars' });
    }
    if (users.find(u => u.email === email.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    
    const hashed = await bcrypt.hash(password, 10);
    const user = {
      _id: 'user_' + Date.now(),
      email: email.toLowerCase(),
      password: hashed,
      firstName,
      lastName,
      role: role || 'rider',
      rating: 0,
      trips: 0,
      responseTime: '< 1 hour',
      createdAt: new Date().toISOString()
    };
    users.push(user);
    
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.status(201).json({
      success: true,
      data: {
        token,
        user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email.toLowerCase());
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      success: true,
      data: {
        token,
        user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get me
app.get('/api/auth/me', protect, (req, res) => {
  const { password, ...userWithoutPassword } = req.user;
  res.json({ success: true, data: userWithoutPassword });
});

// ========== BIKES ROUTES ==========

// Get all bikes
app.get('/api/bikes', (req, res) => {
  const { category, location, search } = req.query;
  let result = bikes.filter(b => b.isAvailable);
  
  if (category) result = result.filter(b => b.category === category);
  if (location) result = result.filter(b => b.location.toLowerCase().includes(location.toLowerCase()));
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(b => 
      b.make.toLowerCase().includes(s) || 
      b.model.toLowerCase().includes(s) ||
      b.description.toLowerCase().includes(s)
    );
  }
  
  // Format owner data
  result = result.map(b => ({
    ...b,
    owner: { name: b.owner.firstName + ' ' + b.owner.lastName[0] + '.', rating: b.owner.rating, trips: b.owner.trips }
  }));
  
  res.json({ success: true, count: result.length, data: result });
});

// Get single bike
app.get('/api/bikes/:id', (req, res) => {
  const bike = bikes.find(b => b._id === req.params.id);
  if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
  
  const bikeWithOwner = {
    ...bike,
    owner: { name: bike.owner.firstName + ' ' + bike.owner.lastName[0] + '.', rating: bike.owner.rating, trips: bike.owner.trips, responseTime: bike.owner.responseTime }
  };
  
  res.json({ success: true, data: bikeWithOwner });
});

// Create bike
app.post('/api/bikes', protect, (req, res) => {
  const bike = {
    _id: 'bike_' + Date.now(),
    ...req.body,
    owner: req.user,
    isAvailable: true,
    createdAt: new Date().toISOString()
  };
  bikes.push(bike);
  res.status(201).json({ success: true, data: bike });
});

// Update bike
app.put('/api/bikes/:id', protect, (req, res) => {
  const idx = bikes.findIndex(b => b._id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
  
  const bike = bikes[idx];
  if (bike.owner._id !== req.user._id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  
  bikes[idx] = { ...bike, ...req.body, _id: bike._id };
  res.json({ success: true, data: bikes[idx] });
});

// Delete bike
app.delete('/api/bikes/:id', protect, (req, res) => {
  const idx = bikes.findIndex(b => b._id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
  
  if (bikes[idx].owner._id !== req.user._id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  
  bikes.splice(idx, 1);
  res.json({ success: true, message: 'Deleted' });
});

// ========== BOOKINGS ROUTES ==========

// Create booking
app.post('/api/bookings', protect, (req, res) => {
  try {
    const { bikeId, startDate, endDate, protectionTier, riderMessage } = req.body;
    const bike = bikes.find(b => b._id === bikeId);
    if (!bike) return res.status(404).json({ success: false, message: 'Bike not found' });
    
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    const basePrice = bike.dailyRate * days;
    const protCost = protectionTier === 'standard' ? 30 * days : protectionTier === 'premium' ? 55 * days : 0;
    const serviceFee = Math.round(basePrice * 0.10);
    const tax = Math.round((basePrice + protCost + serviceFee) * 0.12);
    const total = basePrice + protCost + serviceFee + tax;
    const deposit = protectionTier === 'premium' ? 750 : protectionTier === 'standard' ? 1500 : 2500;
    
    const booking = {
      _id: 'booking_' + Date.now(),
      bikeId,
      bikeName: bike.year + ' ' + bike.make + ' ' + bike.model,
      renter: req.user._id,
      renterName: req.user.firstName + ' ' + req.user.lastName,
      owner: bike.owner._id,
      startDate,
      endDate,
      status: 'pending',
      totalPrice: total,
      protectionTier: protectionTier || 'basic',
      protectionCost: protCost,
      serviceFee,
      tax,
      deposit,
      riderMessage,
      createdAt: new Date().toISOString()
    };
    bookings.push(booking);
    
    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get my bookings
app.get('/api/bookings/my-bookings', protect, (req, res) => {
  const myBookings = bookings.filter(b => b.renter === req.user._id || b.renter === req.user._id.toString());
  res.json({ success: true, data: myBookings });
});

// Get owner bookings
app.get('/api/bookings/owner-bookings', protect, (req, res) => {
  const ownerBookings = bookings.filter(b => b.owner === req.user._id || b.owner === req.user._id.toString());
  res.json({ success: true, data: ownerBookings });
});

// Update booking status
app.put('/api/bookings/:id/status', protect, (req, res) => {
  const booking = bookings.find(b => b._id === req.params.id);
  if (!booking) return res.status(404).json({ success: false, message: 'Not found' });
  
  if (booking.owner !== req.user._id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  
  booking.status = req.body.status;
  if (req.body.ownerMessage) booking.ownerMessage = req.body.ownerMessage;
  res.json({ success: true, data: booking });
});

// ========== ADMIN ROUTES ==========

// Stats
app.get('/api/admin/stats', protect, adminOnly, (req, res) => {
  const revenue = bookings.filter(b => b.status === 'completed').reduce((a, b) => a + b.totalPrice, 0);
  res.json({
    success: true,
    data: {
      totalUsers: users.length,
      totalBikes: bikes.length,
      totalBookings: bookings.length,
      pendingBookings: bookings.filter(b => b.status === 'pending').length,
      totalRevenue: revenue
    }
  });
});

// Get all users
app.get('/api/admin/users', protect, adminOnly, (req, res) => {
  const usersWithoutPasswords = users.map(u => {
    const { password, ...rest } = u;
    return rest;
  });
  res.json({ success: true, data: usersWithoutPasswords });
});

// Get all bookings
app.get('/api/admin/bookings', protect, adminOnly, (req, res) => {
  res.json({ success: true, data: bookings });
});

// Approve/reject bike
app.put('/api/admin/bikes/:id/approve', protect, adminOnly, (req, res) => {
  const bike = bikes.find(b => b._id === req.params.id);
  if (!bike) return res.status(404).json({ success: false, message: 'Not found' });
  bike.isAvailable = req.body.isAvailable;
  res.json({ success: true, data: bike });
});

// ========== HEALTH CHECK ==========

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ message: 'RYDI API', version: '1.0.0', endpoints: ['/api/auth', '/api/bikes', '/api/bookings', '/api/admin'] });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Server error' });
});

// Start
seedData().then(() => {
  app.listen(PORT, () => {
    console.log(`RYDI Backend running on port ${PORT}`);
  });
});
