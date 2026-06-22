const logger = require('../utils/logger');
const database = require('../config/database');

/**
 * Mandatory recurring subscription for EnrichFlow.
 *
 * Plan is env-configured. GHL collects the recurring fee (set as the app's subscription price in
 * the marketplace dashboard); this service mirrors entitlement status and meters the monthly
 * "included credits" allowance. Enrichment in GHL mode is BLOCKED unless the location has an
 * entitled (active/trialing) subscription — controlled by SUBSCRIPTION_REQUIRED.
 */

function defaultPlan() {
  return {
    name: process.env.PLAN_NAME || 'Starter',
    priceUsd: Number(process.env.PLAN_PRICE_USD || 29),
    includedCredits: Number(process.env.PLAN_INCLUDED_CREDITS || 300)
  };
}

/**
 * GHL only sends a `planId` — WE map it to the credit allowance / display price.
 * Optional PLANS_JSON env lets you define multiple tiers, e.g.
 *   PLANS_JSON='{"66a...starter":{"name":"Starter","priceUsd":29,"includedCredits":300},
 *                "66a...growth":{"name":"Growth","priceUsd":99,"includedCredits":1500}}'
 * Unknown / missing planIds fall back to the single default plan.
 */
function planCatalog() {
  try {
    return process.env.PLANS_JSON ? JSON.parse(process.env.PLANS_JSON) : {};
  } catch {
    logger.warn('PLANS_JSON is not valid JSON — ignoring; using default plan');
    return {};
  }
}

function planForId(planId) {
  const catalog = planCatalog();
  if (planId && catalog[planId]) return { ...catalog[planId] };
  return defaultPlan();
}

// Back-compat alias used by getStatus/dev paths.
function plan() {
  return defaultPlan();
}

function isRequired() {
  // Default ON (mandatory). Set SUBSCRIPTION_REQUIRED=false to disable for local testing.
  return String(process.env.SUBSCRIPTION_REQUIRED ?? 'true').toLowerCase() !== 'false';
}

function addOneMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/** Roll the billing period forward and zero the allowance if the period has ended. */
function rollPeriodIfNeeded(sub) {
  if (!sub.currentPeriodEnd) return sub;
  let changed = false;
  while (sub.currentPeriodEnd && Date.now() > sub.currentPeriodEnd.getTime()) {
    sub.currentPeriodStart = sub.currentPeriodEnd;
    sub.currentPeriodEnd = addOneMonth(sub.currentPeriodEnd);
    sub.creditsUsedThisPeriod = 0;
    changed = true;
  }
  return changed ? sub : sub;
}

class SubscriptionService {
  plan() {
    return plan();
  }

  isRequired() {
    return isRequired();
  }

  /**
   * Activate (or renew/upgrade) a subscription — called from the INSTALL / PLAN_CHANGE webhooks.
   * @param {object} opts
   * @param {string} [opts.planId]  GHL plan id (maps to our credit allowance)
   * @param {object} [opts.trial]   GHL trial object { onTrial, trialDuration, trialStartDate }
   * @param {string} [opts.status]  override status (defaults derived from trial)
   */
  async activate({ locationId, companyId, appId, planId, trial, status, raw } = {}) {
    if (!database.isConnected()) return null;
    const Subscription = require('../models/Subscription');
    const p = planForId(planId);
    const now = new Date();

    // Trial → status 'trialing', period ends at trialStart + trialDuration days.
    let resolvedStatus = status;
    let periodEnd;
    if (!resolvedStatus && trial?.onTrial) {
      resolvedStatus = 'trialing';
      const start = trial.trialStartDate ? new Date(trial.trialStartDate) : now;
      periodEnd = new Date(start.getTime() + (Number(trial.trialDuration) || 0) * 24 * 60 * 60 * 1000);
    }
    if (!resolvedStatus) resolvedStatus = 'active';

    const existing = await Subscription.findOne(locationId ? { locationId } : { companyId });
    const periodStart = existing?.currentPeriodStart || now;
    if (!periodEnd) {
      periodEnd = existing?.currentPeriodEnd && existing.currentPeriodEnd > now
        ? existing.currentPeriodEnd
        : addOneMonth(now);
    }

    return Subscription.findOneAndUpdate(
      locationId ? { locationId } : { companyId },
      {
        locationId,
        companyId,
        appId,
        planId,
        planName: p.name,
        priceUsd: p.priceUsd,
        includedCredits: p.includedCredits,
        status: resolvedStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        ...(raw ? { rawWebhookData: raw } : {})
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async setStatus({ locationId, companyId }, status, raw) {
    if (!database.isConnected()) return null;
    const Subscription = require('../models/Subscription');
    const update = { status, ...(raw ? { rawWebhookData: raw } : {}) };
    if (status === 'canceled') update.canceledAt = new Date();
    return Subscription.findOneAndUpdate(locationId ? { locationId } : { companyId }, update, { new: true });
  }

  /** Current subscription for a location, with lazy period roll-over. */
  async getStatus(locationId) {
    if (!database.isConnected()) {
      return { entitled: !isRequired(), status: 'unknown', dbDisabled: true, plan: plan() };
    }
    const Subscription = require('../models/Subscription');
    let sub = await Subscription.findOne({ locationId });
    if (!sub) {
      return { entitled: !isRequired(), status: 'none', plan: plan(), required: isRequired() };
    }
    rollPeriodIfNeeded(sub);
    await sub.save();

    return {
      entitled: isRequired() ? sub.isEntitled() : true,
      required: isRequired(),
      status: sub.status,
      plan: { name: sub.planName, priceUsd: sub.priceUsd, includedCredits: sub.includedCredits },
      includedCredits: sub.includedCredits,
      creditsUsedThisPeriod: sub.creditsUsedThisPeriod,
      remainingIncluded: sub.remainingIncluded(),
      currentPeriodEnd: sub.currentPeriodEnd
    };
  }

  /**
   * Throw 402 if a subscription is required but the location isn't entitled.
   * No-op when SUBSCRIPTION_REQUIRED=false (local testing).
   */
  async ensureEntitled(locationId) {
    if (!isRequired()) return;
    const status = await this.getStatus(locationId);
    if (!status.entitled) {
      const err = new Error('An active EnrichFlow subscription is required for this location.');
      err.status = 402;
      err.code = 'SUBSCRIPTION_REQUIRED';
      throw err;
    }
  }

  /**
   * Consume the monthly included-credit allowance before pay-as-you-go.
   * @returns {{ coveredByPlan: number, overage: number }}
   */
  async consumeIncluded(locationId, credits) {
    if (!database.isConnected() || credits <= 0) return { coveredByPlan: 0, overage: credits };
    const Subscription = require('../models/Subscription');
    const sub = await Subscription.findOne({ locationId });
    if (!sub) return { coveredByPlan: 0, overage: credits };

    rollPeriodIfNeeded(sub);
    const remaining = sub.remainingIncluded();
    const coveredByPlan = Math.min(remaining, credits);
    const overage = credits - coveredByPlan;

    sub.creditsUsedThisPeriod = (sub.creditsUsedThisPeriod || 0) + coveredByPlan;
    await sub.save();

    logger.info('Included credits consumed', { locationId, credits, coveredByPlan, overage });
    return { coveredByPlan, overage };
  }
}

module.exports = new SubscriptionService();
