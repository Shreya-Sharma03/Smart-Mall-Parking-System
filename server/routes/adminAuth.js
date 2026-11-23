const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const adminAuth = require('../middleware/adminAuth');
const verifyCsrf = require('../middleware/verifyCsrf');

// Rate limiter: max 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/admin/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }

  // Compare against env vars (hash stored in ADMIN_PASSWORD_HASH)
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminEmail || !adminHash) {
    return res.status(500).json({ success: false, message: 'Admin credentials not configured' });
  }

  if (email !== adminEmail) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, adminHash);
  if (!match) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  // Regenerate session to avoid fixation
  req.session.regenerate(err => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Session error' });
    }
    req.session.isAdmin = true;
    // Generate CSRF token (32‑byte hex)
    const crypto = require('crypto');
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    return res.json({ success: true, csrfToken: req.session.csrfToken });
  });
});

// GET /api/admin/me – returns auth status (session alive)
router.get('/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ success: true, isAdmin: true, csrfToken: req.session.csrfToken });
  }
  return res.json({ success: false, isAdmin: false });
});

// POST /api/admin/logout
router.post('/logout', adminAuth, verifyCsrf, (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Logout failed' });
      }
      // clear cookie client‑side
      res.clearCookie('connect.sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
      return res.json({ success: true, message: 'Logged out' });
    });
  } else {
    return res.json({ success: true, message: 'Logged out' });
  }
});

module.exports = router;
