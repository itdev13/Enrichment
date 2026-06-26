const axios = require('axios');
const BaseProvider = require('./baseProvider');

/**
 * People Data Labs — premium fallback (used for phone numbers and misses the primary can't fill).
 * Person Enrich: GET https://api.peopledatalabs.com/v5/person/enrich
 *
 * NOTE: field mapping should be re-verified against live responses before production.
 * Until PDL_API_KEY is set, this provider reports "not configured".
 */
class PDLProvider extends BaseProvider {
  constructor() {
    super('pdl');
    this.apiKey = process.env.PDL_API_KEY;
    this.baseURL = 'https://api.peopledatalabs.com/v5';
  }

  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * PDL can match on any strong identifier (email / phone / linkedin) or a name + company.
   */
  canMatch(input) {
    return !!(
      input.email ||
      input.phone ||
      input.linkedinUrl ||
      (input.fullName && (input.company || input.companyDomain))
    );
  }

  async enrich(input) {
    if (!this.isConfigured()) {
      const err = new Error('PDL not configured (set PDL_API_KEY)');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }

    const params = { min_likelihood: 6 };
    if (input.email) params.email = input.email;
    if (input.phone) params.phone = input.phone; // reverse phone lookup
    if (input.fullName) params.name = input.fullName;
    if (input.companyDomain || input.company) params.company = input.companyDomain || input.company;
    if (input.linkedinUrl) params.profile = input.linkedinUrl;

    let res;
    try {
      res = await axios.get(`${this.baseURL}/person/enrich`, {
        params,
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 15000
      });
      console.log("response: ", JSON.parse(res));
    } catch (error) {
      console.log("error: ", JSON.parse(error));

      // PDL returns 404 when no person matches — treat as a clean "no match", not an error.
      if (error.response?.status === 404) return this.empty();
      throw error;
    }

    const p = res.data?.data || {};

    // PDL masks PII on free/limited plans by returning the boolean `true` instead of the value
    // (e.g. mobile_phone: true). Accept ONLY real string/number values — never a masked boolean —
    // otherwise we'd bill for (and write back) data we don't actually have.
    const str = (v) => {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
      return undefined;
    };
    const firstStr = (v) => {
      if (Array.isArray(v)) {
        for (const item of v) {
          const s = item && typeof item === 'object'
            ? str(item.address || item.number || item.E164 || item.local_number)
            : str(item);
          if (s) return s;
        }
        return undefined;
      }
      return str(v);
    };

    const workEmail = str(p.work_email) || firstStr(p.emails);
    const mobilePhone = firstStr(p.mobile_phone) || firstStr(p.phone_numbers);
    const linkedin = str(p.linkedin_url);

    const data = {
      workEmail,
      mobilePhone,
      company: str(p.job_company_name),
      companyDomain: str(p.job_company_website),
      jobTitle: str(p.job_title),
      linkedinUrl: linkedin ? (linkedin.startsWith('http') ? linkedin : `https://${linkedin}`) : undefined,
      industry: str(p.job_company_industry),
      companySize: str(p.job_company_size),
      location: str(p.location_name)
    };

    // Only count it as a match if at least one usable (unmasked) field came back.
    const matched = Object.values(data).some((v) => v != null && v !== '');

    return { provider: this.name, matched, data, raw: res.data };
  }
}

module.exports = new PDLProvider();
