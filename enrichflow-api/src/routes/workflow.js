const express = require('express');
const router = express.Router();
const { runEnrichment } = require('../services/enrichRunner');
const { ALL_FIELDS } = require('../enrichment/fields');
const logger = require('../utils/logger');

/**
 * "Enrich Contact" custom workflow action.
 *
 * In the GHL Marketplace app you register a Workflow Action whose execution webhook points at
 * POST /api/workflow/enrich/execute. When a workflow runs the action, GHL sends the location +
 * contact context here; we enrich, write fields back to the contact, charge the wallet, and
 * return the enriched values so later workflow steps can branch on them.
 *
 * GHL's exact payload shape varies by action version, so we extract identifiers defensively.
 */

/** Pull locationId / contactId out of whatever shape GHL sends. */
function extractIds(body = {}) {
  const locationId =
    body.locationId || body.location_id || body.location?.id || body.meta?.locationId || null;
  const contactId =
    body.contactId || body.contact_id || body.contact?.id || body.meta?.contactId || null;
  return { locationId, contactId };
}

/**
 * POST /api/workflow/enrich/execute
 * Executed by GHL when the workflow action runs.
 */
router.post('/enrich/execute', async (req, res) => {
  const { locationId, contactId } = extractIds(req.body);
  logger.info('⚙️  Workflow action: enrich', { locationId, contactId });

  if (!locationId || !contactId) {
    return res.status(400).json({ success: false, error: 'Missing locationId/contactId in workflow payload' });
  }

  try {
    const result = await runEnrichment({ locationId, contactId, writeBack: true });

    // Flat output map so workflow steps downstream can reference each field.
    return res.json({
      success: true,
      matched: result.matched,
      creditsUsed: result.credits,
      ...result.data
    });
  } catch (err) {
    logger.error('Workflow enrich failed', { message: err.message });
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/workflow/enrich/fields
 * Returns the output fields this action can produce (for the action's config UI / docs).
 */
router.get('/enrich/fields', (req, res) => {
  res.json({
    success: true,
    outputs: ALL_FIELDS.map((key) => ({ key, label: humanize(key) }))
  });
});

const humanize = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

module.exports = router;
