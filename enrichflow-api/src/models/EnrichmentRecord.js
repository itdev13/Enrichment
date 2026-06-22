const mongoose = require('mongoose');

/**
 * Audit log of every enrichment run — powers billing reconciliation, dedupe/caching, and
 * a per-location usage dashboard.
 */
const enrichmentRecordSchema = new mongoose.Schema(
  {
    locationId: { type: String, index: true },
    companyId: { type: String, index: true },
    contactId: { type: String, index: true },

    input: mongoose.Schema.Types.Mixed,
    data: mongoose.Schema.Types.Mixed,

    matched: Boolean,
    credits: { type: Number, default: 0 },
    creditBreakdown: mongoose.Schema.Types.Mixed,
    tiers: [String],
    fieldsFound: [String],
    attempts: mongoose.Schema.Types.Mixed,

    charged: { type: Boolean, default: false },
    writtenToGhl: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('EnrichmentRecord', enrichmentRecordSchema);
