const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const OAuthToken = require('../models/OAuthToken');
const subscriptionService = require('../services/subscriptionService');
const database = require('../config/database');
const logger = require('../utils/logger');

/**
 * GHL app lifecycle webhooks (POST to /api/webhooks/enrichflow).
 *
 * Three separate webhook types registered in the marketplace:
 *   AppInstall   → type: INSTALL      — user installs, subscription created
 *   AppUninstall → type: UNINSTALL    — user uninstalls, subscription canceled
 *   AppUpdate    → type: APP_UPDATE   — new app version published (no billing impact)
 *
 * Additional billing events:
 *   SaaSPlanCreate → type: SAAS_PLAN_CREATE / SUBSCRIPTION_CREATED
 *   PlanChange     → type: PLAN_CHANGE — user upgraded/downgraded plan
 */
router.post('/enrichflow', async (req, res) => {
  const data = req.body || {};
  const { type, appId, companyId, locationId } = data;

  logger.info('📥 Webhook received', { type, appId, companyId, locationId });

  // Always acknowledge quickly — GHL retries on non-2xx
  if (!type || !appId) {
    return res.status(400).json({ success: false, error: 'Missing required fields: type, appId' });
  }

  if (!database.isConnected()) {
    logger.warn('Webhook received but database disabled — acknowledging without persistence');
    return res.status(200).json({ success: true, persisted: false });
  }

  try {
    switch (type) {
      // ── AppInstall ──────────────────────────────────────────────────────────
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
        await subscriptionService.activate({
          locationId,
          companyId,
          appId,
          planId: data.planId,
          trial: data.trial,
          raw: data
        });
        logger.info('✅ App installed — subscription activated', { locationId, planId: data.planId });
        break;
      }

      // ── AppUninstall ────────────────────────────────────────────────────────
      case 'UNINSTALL': {
        await Installation.findOneAndUpdate(
          locationId ? { appId, locationId } : { appId, companyId },
          { status: 'uninstalled', uninstalledAt: new Date() }
        );
        await subscriptionService.setStatus({ locationId, companyId }, 'canceled', data);
        await OAuthToken.deleteMany(locationId ? { locationId } : { companyId });
        logger.info('🗑️ App uninstalled — subscription canceled', { locationId, companyId });
        break;
      }

      // ── AppUpdate ───────────────────────────────────────────────────────────
      case 'APP_UPDATE': {
        // New version of the app published — no billing or subscription impact.
        logger.info('🔄 App version updated', { appId, version: data.version });
        break;
      }

      // ── PlanChange ──────────────────────────────────────────────────────────
      case 'PLAN_CHANGE': {
        await subscriptionService.activate({
          locationId,
          companyId,
          appId,
          planId: data.newPlanId || data.planId,
          status: 'active',
          raw: data
        });
        logger.info('🔁 Plan changed', { locationId, companyId, newPlanId: data.newPlanId || data.planId });
        break;
      }

      // ── SaaSPlanCreate ──────────────────────────────────────────────────────
      case 'SAAS_PLAN_CREATE':
      case 'SUBSCRIPTION_CREATED': {
        await subscriptionService.activate({
          locationId,
          companyId,
          appId,
          planId: data.planId,
          trial: data.trial,
          status: 'active',
          raw: data
        });
        logger.info('💳 SaaS plan created', { locationId, planId: data.planId });
        break;
      }

      default:
        logger.info('ℹ️ Unhandled webhook type — acknowledged', { type });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Webhook processing error', { message: err.message, type });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
