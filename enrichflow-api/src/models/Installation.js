const mongoose = require('mongoose');

/**
 * One row per app install (location or company level). Tracks install/uninstall lifecycle.
 */
const installationSchema = new mongoose.Schema(
  {
    appId: { type: String, index: true },
    companyId: { type: String, index: true },
    locationId: { type: String, index: true },
    userId: String,
    companyName: String,

    status: { type: String, enum: ['active', 'uninstalled'], default: 'active', index: true },
    installedAt: Date,
    uninstalledAt: Date,

    rawWebhookData: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

module.exports = mongoose.model('Installation', installationSchema);
