/**
 * Pure-local enrichment test — no GHL, no MongoDB, no API keys required.
 *
 *   npm run enrich:local
 *
 * Exercises the provider waterfall + tiered-credit accounting against the mock provider.
 * Override providers with env, e.g.:  ENRICH_PRIMARY=prospeo ENRICH_FALLBACK=pdl npm run enrich:local
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const enrichmentService = require('../src/enrichment/enrichmentService');

// Default to mock so the script works out-of-the-box.
process.env.ENRICH_PRIMARY = process.env.ENRICH_PRIMARY || 'mock';
process.env.ENRICH_FALLBACK = process.env.ENRICH_FALLBACK || 'mock';

const cases = [
  { label: 'Full match', input: { email: 'jane.doe@acme.io', fullName: 'Jane Doe', company: 'Acme' } },
  { label: 'No phone from primary (fallback fills)', input: { email: 'nophone@acme.io', fullName: 'No Phone' } },
  { label: 'No match', input: { email: 'nomatch@nowhere.io', fullName: 'Ghost User' } },
  { label: 'Company-only input', input: { fullName: 'Sam Patel', companyDomain: 'stripe.com' } }
];

(async () => {
  console.log(`\nEnrichFlow local test  (primary=${process.env.ENRICH_PRIMARY}, fallback=${process.env.ENRICH_FALLBACK})\n`);
  for (const c of cases) {
    const r = await enrichmentService.enrich(c.input);
    console.log('─'.repeat(70));
    console.log(`• ${c.label}`);
    console.log('  input:   ', JSON.stringify(c.input));
    console.log('  matched: ', r.matched, '| credits:', r.credits, '| tiers:', r.tiers.join(', ') || '(none)');
    console.log('  fields:  ', r.fieldsFound.join(', ') || '(none)');
    console.log('  attempts:', r.attempts.map((a) => `${a.provider}:${a.status}`).join(', '));
    if (r.matched) console.log('  data:    ', JSON.stringify(r.data));
  }
  console.log('─'.repeat(70));
  console.log('\nDone.\n');
  process.exit(0);
})().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
