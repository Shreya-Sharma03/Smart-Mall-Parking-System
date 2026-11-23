/**
 * adminAuth middleware – protects routes that should only be accessed by the
 * logged‑in admin. The session is created by the /api/admin/login endpoint.
 *
 * If `req.session?.isAdmin` is truthy the request is allowed to continue.
 * Otherwise a 401 JSON response is sent.
 */
module.exports = function adminAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Admin authentication required' });
};
