const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const OAuthToken = require('../models/OAuthToken');
const SubscriptionTransaction = require('../models/SubscriptionTransaction');
const subscriptionService = require('../services/subscriptionService');
const ghlService = require('../services/ghlService');
const database = require('../config/database');
const logger = require('../utils/logger');
const ThrottleQueue = require('../utils/throttleQueue');

const tokenGenQueue = new ThrottleQueue({ name: 'proactive-token-gen', delayMs: 350 });

/** Resolve plan details from PLANS_JSON for recording subscription transactions. */
function resolvePlan(planId) {
  try {
    const catalog = process.env.PLANS_JSON ? JSON.parse(process.env.PLANS_JSON) : {};
    if (planId && catalog[planId]) return catalog[planId];
  } catch { /* ignore */ }
  return { name: process.env.PLAN_NAME || 'Starter', priceUsd: Number(process.env.PLAN_PRICE_USD || 29), includedCredits: Number(process.env.PLAN_INCLUDED_CREDITS || 1000) };
}

async function recordSubscriptionTx({ event, locationId, companyId, appId, planId, previousPlanId, periodStart, periodEnd, webhookType, rawData }) {
  try {
    const plan = resolvePlan(planId);
    const prev = previousPlanId ? resolvePlan(previousPlanId) : null;
    await SubscriptionTransaction.create({
      locationId, companyId, appId, event,
      planId: planId || null,
      planName: plan.name,
      priceUsd: plan.priceUsd,
      includedCredits: plan.includedCredits,
      previousPlanId: previousPlanId || null,
      previousPlanName: prev?.name || null,
      previousPriceUsd: prev?.priceUsd ?? null,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      webhookType,
      rawData
    });
    logger.info(`📝 SubscriptionTransaction recorded: ${event}`, { locationId, planId });
  } catch (e) {
    logger.warn('Failed to record subscription transaction (non-fatal)', { message: e.message });
  }
}

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
  logger.info('📦 Webhook payload', { payload: JSON.stringify(data) });

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
        const installedSub = await subscriptionService.activate({
          locationId,
          companyId,
          appId,
          planId: data.planId,
          trial: data.trial,
          raw: data
        });

        // Determine if this is a new install or a reactivation (was previously canceled)
        const hadPriorCancellation = installedSub?.canceledAt != null;
        await recordSubscriptionTx({
          event: hadPriorCancellation ? 'reactivation' : 'new_subscription',
          locationId, companyId, appId,
          planId: data.planId,
          periodStart: installedSub?.currentPeriodStart,
          periodEnd: installedSub?.currentPeriodEnd,
          webhookType: type,
          rawData: data
        });
        logger.info('✅ App installed — subscription activated', { locationId, planId: data.planId });

        // Proactively mint a location token from the company token so the UI
        // shows "Connected" immediately without waiting for a manual API call.
        if (locationId && companyId) {
          tokenGenQueue.push(async () => {
            try {
              const existing = await OAuthToken.findOne({ locationId, tokenType: 'location', isActive: true });
              if (existing) {
                logger.info('ℹ️ Location token already exists', { locationId });
                return;
              }
              const companyToken = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
              if (!companyToken) {
                logger.warn('⚠️ No company token found — skipping location token generation', { locationId });
                return;
              }
              logger.info('🔄 Generating location token from company token', { locationId, queueSize: tokenGenQueue.size() });
              const minted = await ghlService.getLocationTokenFromCompany(companyId, locationId);
              await OAuthToken.findOneAndUpdate(
                { locationId, tokenType: 'location' },
                {
                  locationId,
                  companyId,
                  tokenType: 'location',
                  accessToken: minted.accessToken,
                  refreshToken: minted.refreshToken,
                  expiresAt: new Date(Date.now() + minted.expiresIn * 1000),
                  isActive: true
                },
                { upsert: true, new: true }
              );
              logger.info('✅ Location token stored', { locationId });
            } catch (e) {
              logger.error('⚠️ Failed to generate location token (non-critical)', { locationId, message: e.message });
            }
          });
        }
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
        await recordSubscriptionTx({
          event: 'cancellation',
          locationId, companyId, appId,
          planId: null,
          webhookType: type,
          rawData: data
        });
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
        // GHL payload: { newPlanId, currentPlanId, ... }
        const newPlanId = data.newPlanId;
        const oldPlanId = data.currentPlanId || data.oldPlanId || data.previousPlanId || null;
        const changedSub = await subscriptionService.activate({
          locationId, companyId, appId,
          planId: newPlanId,
          status: 'active',
          raw: data
        });
        const newPlan = resolvePlan(newPlanId);
        const oldPlan = oldPlanId ? resolvePlan(oldPlanId) : null;
        const isUpgrade = oldPlan ? newPlan.priceUsd > oldPlan.priceUsd : true;
        await recordSubscriptionTx({
          event: isUpgrade ? 'upgrade' : 'downgrade',
          locationId, companyId, appId,
          planId: newPlanId,
          previousPlanId: oldPlanId,
          periodStart: changedSub?.currentPeriodStart,
          periodEnd: changedSub?.currentPeriodEnd,
          webhookType: type,
          rawData: data
        });
        logger.info('🔁 Plan changed', { locationId, companyId, newPlanId, oldPlanId });
        break;
      }

      // ── SaaSPlanCreate ──────────────────────────────────────────────────────
      // This fires when YOU create a new plan in the marketplace — NOT when a user subscribes.
      // No locationId. Just log it so you know to update PLANS_JSON with the new planId.
      case 'SaasPlanCreate':
      case 'SAAS_PLAN_CREATE': {
        const priceUsd = data.prices?.find(p => p.billingInterval === 'month' && p.active)?.amount;
        logger.info('📋 New SaaS plan created in marketplace — update PLANS_JSON', {
          planId: data.planId,
          title: data.title,
          priceUsd: priceUsd ? priceUsd / 100 : null,
          trialPeriod: data.trialPeriod,
          companyId
        });
        break;
      }

      // ── InvoicePaid / InvoicePartiallyPaid ──────────────────────────────────
      case 'InvoicePaid':
      case 'INVOICE_PAID':
      case 'InvoicePartiallyPaid':
      case 'INVOICE_PARTIALLY_PAID': {
        // altId = locationId, altType = 'location'
        const invoiceLocationId = data.altId || locationId;
        const invoiceId     = data._id || data.invoiceId;
        const amountPaid    = data.amountPaid ?? data.total ?? 0;
        const invoiceNumber = data.invoiceNumber || null;
        const currency      = data.currency || 'USD';
        const liveMode      = data.liveMode !== false;
        const payerEmail    = data.contactDetails?.email || null;
        const payerName     = data.contactDetails?.name || null;
        const invoiceDate   = data.issueDate ? new Date(data.issueDate) : new Date();

        // Look up the subscription to get plan context
        const Subscription = require('../models/Subscription');
        const sub = invoiceLocationId
          ? await Subscription.findOne({ locationId: invoiceLocationId })
          : null;

        const isPartial = type === 'InvoicePartiallyPaid' || type === 'INVOICE_PARTIALLY_PAID';

        // Upsert — idempotent if GHL retries the same invoice
        await SubscriptionTransaction.findOneAndUpdate(
          { invoiceId },
          {
            locationId: invoiceLocationId,
            companyId: sub?.companyId || companyId || null,
            appId,
            event: isPartial ? 'invoice_partially_paid' : 'invoice_paid',
            invoiceId,
            invoiceNumber,
            amountPaid,
            currency,
            invoiceStatus: data.status || (type.toLowerCase().includes('partial') ? 'partially_paid' : 'paid'),
            amountDue: data.amountDue ?? 0,
            liveMode,
            invoiceDate,
            planId:          sub?.planId   || null,
            planName:        sub?.planName || null,
            priceUsd:        sub?.priceUsd || 0,
            includedCredits: sub?.includedCredits || 0,
            periodStart:     sub?.currentPeriodStart || null,
            periodEnd:       sub?.currentPeriodEnd   || null,
            payerEmail,
            payerName,
            webhookType: type,
            rawData: data
          },
          { upsert: true, new: true }
        );

        logger.info('💰 Invoice payment recorded', {
          invoiceId, invoiceNumber, amountPaid,
          amountDue: data.amountDue ?? null,
          total: data.total ?? null,
          invoiceStatus: data.status,
          locationId: invoiceLocationId,
          liveMode,
          webhookType: type
        });
        logger.info('📄 Invoice raw payload', { payload: JSON.stringify(data) });
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
