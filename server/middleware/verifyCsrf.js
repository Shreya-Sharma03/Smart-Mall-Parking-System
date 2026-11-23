/**
 * CSRF verification middleware for admin routes.
 * Expects the request to have a header `X-CSRF-Token` that matches
 * `req.session.csrfToken`. If missing or mismatched, responds with 403.
 */
module.exports = function verifyCsrf(req, res, next) {
  const token = req.get('X-CSRF-Token');
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ success: false, message: 'Invalid CSRF token' });
  }
  next();
};
