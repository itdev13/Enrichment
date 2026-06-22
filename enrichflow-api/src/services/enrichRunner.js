const enrichmentService = require('../enrichment/enrichmentService');
const { toGhlContactUpdate } = require('../enrichment/fields');
const ghlService = require('./ghlService');
const billingService = require('./billingService');
const subscriptionService = require('./subscriptionService');
const database = require('../config/database');
const logger = require('../utils/logger');

/** Build enrichment input from a GHL contact object. */
function inputFromContact(contact) {
  return {
    email: contact.email,
    phone: contact.phone, // used as a reverse-lookup match key when no email/name is present
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    company: contact.companyName,
    companyDomain: contact.website
  };
}

/**
 * One enrichment run, shared by the REST API and the workflow action.
 *
 * @param {object} opts
 * @param {string} [opts.locationId]
 * @param {string} [opts.contactId]   when set with locationId -> GHL mode (fetch + write-back)
 * @param {object} [opts.input]       raw identifiers (local mode, no GHL needed)
 * @param {boolean}[opts.writeBack=true]
 * @param {string} [opts.primary] @param {string} [opts.fallback]
 * @returns {Promise<object>} full result incl. data, credits, billing, recordId
 */
async function runEnrichment(opts = {}) {
  const { locationId, contactId, writeBack = true, primary, fallback } = opts;
  let input = opts.input;
  let contact = null;

  // Mandatory subscription gate (GHL mode only; no-op when SUBSCRIPTION_REQUIRED=false).
  if (locationId) {
    await subscriptionService.ensureEntitled(locationId);
  }

  if (contactId && locationId) {
    if (!database.isConnected()) {
      const err = new Error('Database not configured — cannot use GHL mode. Pass "input" instead.');
      err.status = 503;
      throw err;
    }
    contact = await ghlService.getContact(locationId, contactId);
    input = inputFromContact(contact);
  }

  if (!input) {
    const err = new Error('Provide either { locationId, contactId } or { input }');
    err.status = 400;
    throw err;
  }

  const result = await enrichmentService.enrich(input, { primary, fallback });

  // Write enriched fields back to the GHL contact.
  let writtenToGhl = false;
  if (writeBack && contactId && locationId && result.matched) {
    const update = toGhlContactUpdate(result.data);
    if (Object.keys(update).length) {
      await ghlService.updateContact(locationId, contactId, update);
      writtenToGhl = true;
    }
  }

  // Billing: monthly plan covers "included" credits first; only the overage hits the wallet.
  let billing = { charged: false, amount: billingService.priceFor(result.credits), credits: result.credits };
  if (locationId && result.credits > 0) {
    const { coveredByPlan, overage } = await subscriptionService.consumeIncluded(locationId, result.credits);
    if (overage > 0) {
      const wallet = await chargeForRun({ locationId, credits: overage, contactId });
      billing = { ...wallet, credits: result.credits, coveredByPlan, overageCredits: overage };
    } else {
      billing = {
        charged: false,
        credits: result.credits,
        coveredByPlan,
        overageCredits: 0,
        amount: 0,
        skipped: 'covered_by_plan'
      };
    }
  }

  // Persist audit record.
  let recordId = null;
  if (database.isConnected()) {
    const EnrichmentRecord = require('../models/EnrichmentRecord');
    const doc = await EnrichmentRecord.create({
      locationId,
      companyId: contact?.companyId,
      contactId,
      contactName: contact ? (contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null) : null,
      contactEmail: contact?.email || null,
      input,
      data: result.data,
      matched: result.matched,
      credits: result.credits,
      creditBreakdown: result.creditBreakdown,
      tiers: result.tiers,
      fieldsFound: result.fieldsFound,
      attempts: result.attempts,
      writtenToGhl,
      charged: billing.charged
    });
    recordId = doc._id;
  }

  return { recordId, writtenToGhl, billing, ...result };
}

async function chargeForRun({ locationId, credits, contactId }) {
  const fallback = { charged: false, amount: billingService.priceFor(credits), credits };
  if (!database.isConnected()) return { ...fallback, skipped: 'no_database' };
  try {
    const OAuthToken = require('../models/OAuthToken');
    const tokenDoc = await OAuthToken.findOne({ locationId, isActive: true });
    if (!tokenDoc?.companyId) return { ...fallback, skipped: 'no_company' };

    const accessToken = await ghlService.getValidToken(locationId);
    if (billingService.isEnabled()) await billingService.hasFunds(tokenDoc.companyId, accessToken);

    return await billingService.chargeCredits({
      companyId: tokenDoc.companyId,
      locationId,
      accessToken,
      credits,
      eventId: `${contactId || 'manual'}_${Date.now()}`,
      description: `EnrichFlow enrichment (${credits} credits)`
    });
  } catch (error) {
    logger.error('Billing for enrichment run failed (non-fatal)', { message: error.message });
    return { ...fallback, error: error.message };
  }
}

module.exports = { runEnrichment, inputFromContact };
