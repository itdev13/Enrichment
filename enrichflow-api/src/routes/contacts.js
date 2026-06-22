const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const logger = require('../utils/logger');

/**
 * GET /api/contacts?locationId=...&limit=&query=&startAfterId=&startAfter=
 * Lists GHL contacts for the bulk-enrich picker in the UI. Requires a connected location.
 */
router.get('/', async (req, res) => {
  const { locationId, limit, query, startAfterId, startAfter } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });

  try {
    const result = await ghlService.searchContacts(locationId, {
      limit: Math.min(parseInt(limit, 10) || 20, 100),
      query,
      startAfterId,
      startAfter
    });

    return res.json({
      success: true,
      total: result.total,
      contacts: result.contacts.map((c) => ({
        id: c.id,
        name: c.contactName || c.name || [c.firstName, c.lastName].filter(Boolean).join(' '),
        email: c.email || '',
        phone: c.phone || '',
        company: c.companyName || '',
        website: c.website || ''
      })),
      meta: result.meta
    });
  } catch (err) {
    logger.error('List contacts failed', { message: err.response?.data?.message || err.message });
    return res.status(err.status || err.response?.status || 500).json({
      success: false,
      error: err.response?.data?.message || err.message
    });
  }
});

module.exports = router;
