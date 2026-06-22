/**
 * Canonical enrichment output shape + tiered-credit accounting.
 *
 * Pricing model (from the EnrichFlow plan): customers are charged in CREDITS, not per-call,
 * so expensive data (verified phone) costs more than cheap data (firmographics). This keeps a
 * healthy markup over provider COGS regardless of which fields come back.
 *
 *   basic data found (company / title / linkedin / location)  -> 1 credit (charged once)
 *   verified work email found                                  -> +1 credit
 *   verified mobile/direct phone found                         -> +5 credits
 *
 * A "full contact" (basic + email + phone) therefore lands around ~7 credits.
 */

// Fields grouped by credit tier. The first non-empty field in a tier "activates" that tier's charge.
const TIERS = {
  basic: {
    credits: 1,
    fields: ['company', 'jobTitle', 'linkedinUrl', 'location', 'industry', 'companyDomain', 'companySize']
  },
  email: {
    credits: 1,
    fields: ['workEmail']
  },
  phone: {
    credits: 5,
    fields: ['phone', 'mobilePhone']
  }
};

// Flat list of every canonical field EnrichFlow can return.
const ALL_FIELDS = Object.values(TIERS).flatMap((t) => t.fields);

/**
 * Given an enriched-data object, compute which tiers were satisfied and the total credits.
 * @returns {{ credits: number, tiers: string[], fieldsFound: string[], breakdown: object }}
 */
function computeCredits(data = {}) {
  const fieldsFound = ALL_FIELDS.filter((f) => data[f] != null && data[f] !== '');
  const tiers = [];
  const breakdown = {};
  let credits = 0;

  for (const [tier, def] of Object.entries(TIERS)) {
    const hit = def.fields.some((f) => fieldsFound.includes(f));
    if (hit) {
      tiers.push(tier);
      breakdown[tier] = def.credits;
      credits += def.credits;
    }
  }

  return { credits, tiers, fieldsFound, breakdown };
}

/** Map our canonical fields onto a GHL contact update payload. */
function toGhlContactUpdate(data = {}) {
  const update = {};
  if (data.workEmail) update.email = data.workEmail;
  if (data.phone || data.mobilePhone) update.phone = data.phone || data.mobilePhone;
  if (data.company) update.companyName = data.company;

  // Everything else goes to custom fields (keys are placeholders until mapped in GHL).
  const customFields = [];
  const cf = (key, value) => value && customFields.push({ key, field_value: value });
  cf('enrichflow_job_title', data.jobTitle);
  cf('enrichflow_linkedin_url', data.linkedinUrl);
  cf('enrichflow_industry', data.industry);
  cf('enrichflow_company_domain', data.companyDomain);
  cf('enrichflow_company_size', data.companySize);
  cf('enrichflow_location', data.location);
  if (customFields.length) update.customFields = customFields;

  return update;
}

module.exports = { TIERS, ALL_FIELDS, computeCredits, toGhlContactUpdate };
