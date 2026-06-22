/**
 * Provider interface. Every enrichment provider implements enrich(input) and returns a
 * normalized result. Inputs are best-effort identifiers we know about the person/company.
 *
 * @typedef {Object} EnrichInput
 * @property {string} [email]
 * @property {string} [phone]
 * @property {string} [firstName]
 * @property {string} [lastName]
 * @property {string} [fullName]
 * @property {string} [company]
 * @property {string} [companyDomain]
 * @property {string} [linkedinUrl]
 *
 * @typedef {Object} EnrichResult
 * @property {string}  provider          - provider name
 * @property {boolean} matched           - whether the provider found anything
 * @property {object}  data              - canonical fields (see enrichment/fields.js)
 * @property {object}  [raw]             - raw provider payload (for debugging)
 */
class BaseProvider {
  constructor(name) {
    this.name = name;
  }

  /** @param {EnrichInput} input @returns {Promise<EnrichResult>} */
  // eslint-disable-next-line no-unused-vars
  async enrich(input) {
    throw new Error(`${this.name}: enrich() not implemented`);
  }

  /**
   * Whether this provider can do anything useful with the given identifiers. Used by the
   * smart router to skip providers that would just waste a call (e.g. an email finder when the
   * contact already has an email). Default: always attempt.
   * @param {EnrichInput} input @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  canMatch(input) {
    return true;
  }

  empty() {
    return { provider: this.name, matched: false, data: {}, raw: null };
  }
}

module.exports = BaseProvider;
