const express = require('express');
const router = express.Router();
const subscriptionService = require('../services/subscriptionService');
const logger = require('../utils/logger');

/**
 * GET /api/subscription/status?locationId=...
 * Entitlement + plan + monthly included-credit usage for the dashboard / gating.
 */
router.get('/status', async (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });
  try {
    const status = await subscriptionService.getStatus(locationId);
    return res.json({ success: true, ...status });
  } catch (err) {
    logger.error('Subscription status failed', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/subscription/dev-activate  { locationId, companyId? }
 * Local-testing helper — simulates the INSTALL/subscription-active state so you can exercise the
 * mandatory-subscription gate without a live GHL install. Disabled in production.
 */
router.post('/dev-activate', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'Disabled in production' });
  }
  const { locationId, companyId } = req.body || {};
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });
  try {
    const sub = await subscriptionService.activate({ locationId, companyId, status: 'active' });
    return res.json({ success: true, subscription: sub });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
