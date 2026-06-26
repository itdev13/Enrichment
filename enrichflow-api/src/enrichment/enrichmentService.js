const logger = require('../utils/logger');
const { computeCredits, ALL_FIELDS } = require('./fields');

const providers = {
  mock: require('./providers/mockProvider'),
  prospeo: require('./providers/prospeoProvider'),
  pdl: require('./providers/pdlProvider')
};

function resolveProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider "${name}". Available: ${Object.keys(providers).join(', ')}`);
  return p;
}

/** True once every canonical field has a value (nothing left for the fallback to add). */
function isComplete(data) {
  return ALL_FIELDS.every((f) => data[f] != null && data[f] !== '');
}

/** Ordered, de-duplicated provider chain from config (or explicit per-request override). */
function buildChain(opts) {
  const primary = opts.primary || process.env.ENRICH_PRIMARY || 'mock';
  const fallback = opts.fallback || process.env.ENRICH_FALLBACK || null;
  const chain = [primary];
  if (fallback && fallback !== primary) chain.push(fallback);
  return chain;
}

/** Fold identifiers discovered by an earlier provider back into the input for the next one. */
function foldIdentifiers(input, merged) {
  return {
    ...input,
    email: input.email || merged.workEmail,
    phone: input.phone || merged.mobilePhone || merged.phone,
    linkedinUrl: input.linkedinUrl || merged.linkedinUrl,
    company: input.company || merged.company,
    companyDomain: input.companyDomain || merged.companyDomain
  };
}

/**
 * Identifier-aware waterfall enrichment.
 *
 * Runs the configured provider chain in order, but SKIPS any provider that can't do anything
 * useful with the identifiers at hand (provider.canMatch) — e.g. the email-finder is skipped
 * when an email already exists. Identifiers found by one provider are folded forward so the
 * next provider can use them (e.g. Prospeo finds the email, then PDL enriches with it).
 *
 * Credits are computed from the FINAL merged result (you pay for what you get).
 *
 * @param {object} input         identifiers (email/phone/name/company/domain/linkedin)
 * @param {object} [opts]
 * @param {string} [opts.primary]    provider name (defaults to ENRICH_PRIMARY)
 * @param {string} [opts.fallback]   provider name (defaults to ENRICH_FALLBACK)
 * @param {boolean}[opts.force]      run the chain in order without canMatch skipping (explicit testing)
 */
async function enrich(input, opts = {}) {
  // Explicit per-request provider override forces the chain (used for testing a single provider).
  const force = opts.force || !!(opts.primary || opts.fallback);
  const chain = buildChain(opts);

  logger.info('🔍 Enrichment started', {
    chain,
    identifiers: Object.keys(input).filter(k => input[k])
  });

  const merged = {};
  const attempts = [];
  let workingInput = { ...input };

  for (const name of chain) {
    if (isComplete(merged)) {
      logger.info(`⏭️ [${name}] skipped — data already complete`);
      break;
    }

    const provider = resolveProvider(name);
    if (!force && typeof provider.canMatch === 'function' && !provider.canMatch(workingInput)) {
      logger.info(`⏭️ [${name}] skipped — no usable identifier`);
      attempts.push({ provider: name, status: 'skipped', reason: 'no_usable_identifier' });
      continue;
    }

    logger.info(`🌐 [${name}] calling provider...`);
    await runProvider(name, workingInput, merged, attempts);
    const last = attempts[attempts.length - 1];
    logger.info(`${last?.status === 'matched' ? '✅' : '❌'} [${name}] result: ${last?.status}`, {
      fieldsFound: last?.fieldsFound || [],
      error: last?.error || undefined
    });
    workingInput = foldIdentifiers(workingInput, merged);
  }

  const credits = computeCredits(merged);
  const matched = credits.fieldsFound.length > 0;

  logger.info('🏁 Enrichment complete', {
    matched,
    credits: credits.credits,
    tiers: credits.tiers,
    fieldsFound: credits.fieldsFound,
    providers: attempts.map((a) => `${a.provider}:${a.status}`).join(',')
  });

  return {
    matched,
    data: merged,
    credits: credits.credits,
    creditBreakdown: credits.breakdown,
    tiers: credits.tiers,
    fieldsFound: credits.fieldsFound,
    attempts
  };
}

async function runProvider(name, input, merged, attempts) {
  const provider = resolveProvider(name);
  try {
    const result = await provider.enrich(input);
    // Fill only fields the merged result doesn't already have (primary wins ties).
    if (result.matched && result.data) {
      for (const [k, v] of Object.entries(result.data)) {
        if ((merged[k] == null || merged[k] === '') && v != null && v !== '') merged[k] = v;
      }
    }
    attempts.push({ provider: name, status: result.matched ? 'matched' : 'no_match' });
  } catch (error) {
    logger.warn(`Provider "${name}" failed`, { code: error.code, message: error.message });
    attempts.push({ provider: name, status: 'error', error: error.message, code: error.code });
  }
}

module.exports = { enrich, resolveProvider, providers };
