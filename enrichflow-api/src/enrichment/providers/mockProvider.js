const BaseProvider = require('./baseProvider');

/**
 * Deterministic fake provider for LOCAL TESTING — no network, no cost, no API key.
 * Generates plausible data derived from the input so the same input always yields the same output.
 *
 * Behavior knobs (so you can exercise the waterfall + credit logic):
 *   - email containing "nomatch"  -> returns no match
 *   - email containing "nophone"  -> returns everything except phone (fallback provider can fill it)
 */
class MockProvider extends BaseProvider {
  constructor() {
    super('mock');
  }

  async enrich(input) {
    const email = (input.email || '').toLowerCase();
    const name = input.fullName || [input.firstName, input.lastName].filter(Boolean).join(' ') || 'Jordan Smith';
    const domain = input.companyDomain || (email.includes('@') ? email.split('@')[1] : 'acme.io');

    if (email.includes('nomatch')) return this.empty();

    const data = {
      company: input.company || titleize(domain.split('.')[0]),
      companyDomain: domain,
      jobTitle: 'Head of Growth',
      linkedinUrl: `https://www.linkedin.com/in/${slug(name)}`,
      industry: 'Software',
      companySize: '51-200',
      location: 'Austin, TX, USA',
      workEmail: input.email || `${slug(name, '.')}@${domain}`
    };

    if (!email.includes('nophone')) {
      data.mobilePhone = '+1 512-555-0142';
    }

    return { provider: this.name, matched: true, data, raw: { note: 'mock data' } };
  }
}

const slug = (s, sep = '-') => String(s).trim().toLowerCase().replace(/\s+/g, sep);
const titleize = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

module.exports = new MockProvider();
