const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Billing — converts enrichment CREDITS into a GoHighLevel Marketplace wallet charge.
 *
 * Mirrors the production ConvoVault flow: check wallet funds, then POST a usage charge to
 * /marketplace/billing/charges. Everything is gated by BILLING_ENABLED so local/mock testing
 * never moves money. The credit -> dollar conversion is a single retail knob (CREDIT_PRICE_USD).
 */

const CREDIT_PRICE_USD = Number(process.env.CREDIT_PRICE_USD || 0.05); // retail $/credit
const METER_ID = process.env.GHL_METER_ID || '';
const APP_ID = process.env.GHL_APP_ID || '';

class BillingService {
  constructor() {
    this.baseURL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
  }

  isEnabled() {
    return String(process.env.BILLING_ENABLED).toLowerCase() === 'true';
  }

  /** Dollar amount for a credit count. */
  priceFor(credits) {
    return Number((credits * CREDIT_PRICE_USD).toFixed(4));
  }

  /** Check the agency wallet has funds (skips when billing disabled). */
  async hasFunds(companyId, accessToken) {
    if (!this.isEnabled()) return true;
    try {
      const { data } = await axios.get(`${this.baseURL}/marketplace/billing/charges/has-funds`, {
        headers: { Authorization: `Bearer ${accessToken}`, Version: '2021-07-28' },
        params: { companyId }
      });
      return data.hasFunds === true;
    } catch (error) {
      logger.error('hasFunds check failed', { message: error.response?.data || error.message });
      throw new Error('Unable to verify wallet balance');
    }
  }

  /**
   * Charge the wallet for an enrichment run.
   * @returns {{ charged: boolean, amount: number, credits: number, chargeId?: string, skipped?: string }}
   */
  async chargeCredits({ companyId, locationId, accessToken, credits, eventId, description }) {
    const amount = this.priceFor(credits);

    if (credits <= 0) return { charged: false, amount: 0, credits, skipped: 'zero_credits' };

    if (!this.isEnabled()) {
      logger.info('Billing disabled — skipping charge', { credits, amount, locationId });
      return { charged: false, amount, credits, skipped: 'billing_disabled' };
    }

    if (!METER_ID || !APP_ID) {
      logger.warn('Billing enabled but GHL_METER_ID / GHL_APP_ID not set — skipping charge');
      return { charged: false, amount, credits, skipped: 'meter_not_configured' };
    }

    try {
      const { data } = await axios.post(
        `${this.baseURL}/marketplace/billing/charges`,
        {
          companyId,
          meterId: METER_ID,
          units: credits,
          price: CREDIT_PRICE_USD,
          appId: APP_ID,
          eventId,
          locationId,
          description: description || `EnrichFlow enrichment (${credits} credits)`
        },
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Version: '2021-07-28' } }
      );

      const chargeId = data.chargeId || data.id || data._id;
      logger.info('✅ Wallet charged', { credits, amount, chargeId, locationId });
      return { charged: true, amount, credits, chargeId };
    } catch (error) {
      logger.error('Wallet charge failed', { message: error.response?.data || error.message });
      throw new Error(error.response?.data?.message || 'Payment failed. Check wallet balance.');
    }
  }
}

module.exports = new BillingService();
