const express = require('express');
const router = express.Router();
const database = require('../config/database');
const logger = require('../utils/logger');

/**
 * GET /api/analytics/usage?locationId=...
 * Summary stats for the dashboard: total runs, matches, credits used, est. spend, recent runs.
 */
router.get('/usage', async (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });

  if (!database.isConnected()) {
    return res.json({
      success: true,
      dbDisabled: true,
      summary: { totalRuns: 0, matched: 0, creditsUsed: 0, estSpendUsd: 0 },
      recent: []
    });
  }

  try {
    const EnrichmentRecord = require('../models/EnrichmentRecord');
    const creditPrice = Number(process.env.CREDIT_PRICE_USD || 0.05);

    const [agg] = await EnrichmentRecord.aggregate([
      { $match: { locationId } },
      {
        $group: {
          _id: null,
          totalRuns: { $sum: 1 },
          matched: { $sum: { $cond: ['$matched', 1, 0] } },
          creditsUsed: { $sum: '$credits' }
        }
      }
    ]);

    const recent = await EnrichmentRecord.find({ locationId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('contactId contactName contactEmail matched credits tiers writtenToGhl charged createdAt')
      .lean();

    const creditsUsed = agg?.creditsUsed || 0;
    return res.json({
      success: true,
      summary: {
        totalRuns: agg?.totalRuns || 0,
        matched: agg?.matched || 0,
        creditsUsed,
        estSpendUsd: Number((creditsUsed * creditPrice).toFixed(2))
      },
      recent
    });
  } catch (err) {
    logger.error('Usage analytics failed', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
