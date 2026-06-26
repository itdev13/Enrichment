const mongoose = require('mongoose');

/**
 * One subscription per install (location-level; company-level for agency installs).
 *
 * EnrichFlow uses a MANDATORY recurring plan: installing the app requires an active subscription.
 * The recurring charge itself is collected by GoHighLevel (configured as the app's subscription
 * price in the marketplace dashboard); this record mirrors that status and tracks the monthly
 * "included credits" allowance that's consumed before any pay-as-you-go wallet overage.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    locationId: { type: String, index: true },
    companyId: { type: String, index: true },
    appId: String,

    planId: { type: String, index: true }, // GHL marketplace plan id from the install/plan-change webhook
    planName: { type: String, default: 'Starter' },
    priceUsd: { type: Number, default: 0 },

    // active/trialing => entitled to use the app. past_due/canceled/inactive => blocked.
    status: {
      type: String,
      enum: ['active', 'trialing', 'past_due', 'canceled', 'inactive'],
      default: 'inactive',
      index: true
    },

    includedCredits: { type: Number, default: 0 }, // monthly allowance
    overageRateUsd: { type: Number, default: null }, // per-credit overage rate for this plan
    creditsUsedThisPeriod: { type: Number, default: 0 },

    currentPeriodStart: Date,
    currentPeriodEnd: Date,

    canceledAt: Date,
    rawWebhookData: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

subscriptionSchema.index({ locationId: 1, status: 1 });

subscriptionSchema.methods.isEntitled = function isEntitled() {
  return this.status === 'active' || this.status === 'trialing';
};

subscriptionSchema.methods.remainingIncluded = function remainingIncluded() {
  return Math.max(0, (this.includedCredits || 0) - (this.creditsUsedThisPeriod || 0));
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
