const mongoose = require('mongoose');

/**
 * Stores GHL OAuth tokens. Mirrors the proven ConvoVault shape:
 *  - tokenType 'company'  -> agency-level token (can mint location tokens)
 *  - tokenType 'location' -> sub-account token used for contact API calls
 */
const oauthTokenSchema = new mongoose.Schema(
  {
    locationId: { type: String, index: true },
    companyId: { type: String, index: true },
    tokenType: { type: String, enum: ['location', 'company'], required: true },

    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },

    // Captured at install for support / win-back.
    userId: String,
    installerEmail: String,
    installerName: String,
    locationName: String,

    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

oauthTokenSchema.index({ locationId: 1, tokenType: 1 });
oauthTokenSchema.index({ companyId: 1, tokenType: 1 });

// Refresh when within 1 hour of expiry.
oauthTokenSchema.methods.needsRefresh = function needsRefresh() {
  return this.expiresAt.getTime() - Date.now() < 60 * 60 * 1000;
};

oauthTokenSchema.statics.findActiveToken = function findActiveToken(locationId) {
  return this.findOne({ locationId, tokenType: 'location', isActive: true });
};

module.exports = mongoose.model('OAuthToken', oauthTokenSchema);
