const express = require('express');
const router = express.Router();
const enrichmentService = require('../enrichment/enrichmentService');
const { runEnrichment } = require('../services/enrichRunner');
const logger = require('../utils/logger');

/** Optional per-request provider override (handy for testing real providers selectively). */
function pickProviders(body = {}) {
  const opts = {};
  if (body.primary) opts.primary = body.primary;
  if (body.fallback) opts.fallback = body.fallback;
  return opts;
}

/**
 * POST /api/enrich/preview
 * Dry run — enrich and return data + credits WITHOUT charging or writing back.
 * Local mode: pass { input: { email, fullName, company, companyDomain } } and no GHL is needed.
 */
router.post('/preview', async (req, res) => {
  try {
    const input = req.body?.input;
    if (!input || typeof input !== 'object') {
      return res.status(400).json({ success: false, error: 'Provide an "input" object (email/fullName/company/companyDomain)' });
    }
    const result = await enrichmentService.enrich(input, pickProviders(req.body));
    return res.json({ success: true, preview: true, ...result });
  } catch (err) {
    logger.error('Preview enrichment failed', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/enrich
 * Full enrichment. Two modes:
 *   - GHL mode:   { locationId, contactId, writeBack? }  -> fetch contact, enrich, optionally write back + charge
 *   - Local mode: { input: {...} }                        -> enrich raw input, no GHL required
 */
router.post('/', async (req, res) => {
  try {
    const { locationId, contactId, writeBack = true } = req.body || {};
    const result = await runEnrichment({
      locationId,
      contactId,
      writeBack,
      input: req.body?.input,
      ...pickProviders(req.body)
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Enrichment failed', { message: err.response?.data?.message || err.message });
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
