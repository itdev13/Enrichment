const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const OAuthToken = require('../models/OAuthToken');
const subscriptionService = require('../services/subscriptionService');
const database = require('../config/database');
const logger = require('../utils/logger');

/**
 * GHL app lifecycle webhooks (sent to the app's Default Webhook URL).
 *
 * Relevant event types for a PAID-SUBSCRIPTION app (GHL runs the billing; there is NO recurring
 * "charged" webhook — install presence is the entitlement signal):
 *   - INSTALL       -> subscription active (or trialing); starts the included-credit allowance
 *   - PLAN_CHANGE   -> user upgraded/downgraded; remap the plan (newPlanId)
 *   - UNINSTALL     -> cancelled OR auto-removed after 3 days of failed payment
 *   - APP_UPDATE    -> new app version (no billing impact)
 */
router.post('/enrichflow', async (req, res) => {
  const data = req.body || {};
  const { type, appId, companyId, locationId } = data;

  logger.info('📥 Webhook received', { type, appId, companyId, locationId });

  if (!type || !appId) {
    return res.status(400).json({ success: false, error: 'Missing required fields: type, appId' });
  }

  if (!database.isConnected()) {
    logger.warn('Webhook received but database disabled — acknowledging without persistence');
    return res.status(200).json({ success: true, persisted: false });
  }

  try {
    switch (type) {
      case 'INSTALL': {
        await Installation.findOneAndUpdate(
          locationId ? { appId, locationId } : { appId, companyId },
          {
            appId,
            companyId,
            locationId,
            userId: data.userId,
            companyName: data.companyName,
            status: 'active',
            installedAt: new Date(),
            rawWebhookData: data
          },
          { upsert: true, new: true }
        );
        // Paid plan: an INSTALL implies an active (or trialing) subscription. planId + trial come
        // straight from the payload; we map planId -> included-credit allowance.
        await subscriptionService.activate({
          locationId,
          companyId,
          appId,
          planId: data.planId,
          trial: data.trial,
          raw: data
        });
        break;
      }

      case 'PLAN_CHANGE': {
        // User switched plans — remap to the new plan (keeps entitlement active).
        await subscriptionService.activate({
          locationId,
          companyId,
          appId,
          planId: data.newPlanId || data.planId,
          status: 'active',
          raw: data
        });
        logger.info('Plan changed', { locationId, companyId, newPlanId: data.newPlanId });
        break;
      }

      case 'UNINSTALL': {
        await Installation.findOneAndUpdate(
          locationId ? { appId, locationId } : { appId, companyId },
          { status: 'uninstalled', uninstalledAt: new Date() }
        );
        await subscriptionService.setStatus({ locationId, companyId }, 'canceled', data);
        await OAuthToken.deleteMany(locationId ? { locationId } : { companyId });
        break;
      }

      case 'APP_UPDATE':
        logger.info('App updated to a new version (no billing impact)', { appId });
        break;

      default:
        logger.info('Unhandled webhook type (acknowledged)', { type });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Webhook processing error', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
