const axios = require('axios');
const BaseProvider = require('./baseProvider');

/**
 * Prospeo — budget-first primary provider (~$0.01/match range).
 * Email Finder: POST https://api.prospeo.io/email-finder  (header: X-KEY)
 *
 * NOTE: endpoint/field mapping should be re-verified against live API responses before
 * production. Until PROSPEO_API_KEY is set, this provider reports "not configured".
 */
class ProspeoProvider extends BaseProvider {
  constructor() {
    super('prospeo');
    this.apiKey = process.env.PROSPEO_API_KEY;
    this.baseURL = 'https://api.prospeo.io';
  }

  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Prospeo is an email FINDER — it only adds value when we DON'T already have an email and we
   * have a name + company domain to search with. If an email is already known, skip it.
   */
  canMatch(input) {
    const fullName = input.fullName || [input.firstName, input.lastName].filter(Boolean).join(' ');
    return !input.email && !!fullName && !!input.companyDomain;
  }

  async enrich(input) {
    if (!this.isConfigured()) {
      const err = new Error('Prospeo not configured (set PROSPEO_API_KEY)');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }

    const fullName = input.fullName || [input.firstName, input.lastName].filter(Boolean).join(' ');
    const domain = input.companyDomain || (input.email?.includes('@') ? input.email.split('@')[1] : null);
    if (!fullName || !domain) return this.empty();

    const { data } = await axios.post(
      `${this.baseURL}/email-finder`,
      { full_name: fullName, company: domain },
      { headers: { 'Content-Type': 'application/json', 'X-KEY': this.apiKey }, timeout: 15000 }
    );

    const r = data?.response || {};
    if (!r.email) return this.empty();

    return {
      provider: this.name,
      matched: true,
      data: {
        workEmail: r.email,
        company: r.company_name || input.company,
        companyDomain: domain,
        jobTitle: r.job_title,
        linkedinUrl: r.linkedin_url
      },
      raw: data
    };
  }
}

module.exports = new ProspeoProvider();
