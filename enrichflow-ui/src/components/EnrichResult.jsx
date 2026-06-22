import React from 'react';

const FIELD_LABELS = {
  workEmail: 'Work email',
  phone: 'Phone',
  mobilePhone: 'Mobile phone',
  company: 'Company',
  companyDomain: 'Company domain',
  jobTitle: 'Job title',
  linkedinUrl: 'LinkedIn',
  industry: 'Industry',
  companySize: 'Company size',
  location: 'Location'
};

export default function EnrichResult({ result }) {
  if (!result) return null;
  const { matched, data = {}, credits, tiers = [], billing, writtenToGhl, preview } = result;

  if (!matched) {
    return (
      <div className="result">
        <p className="muted">No match found for this contact — no credits charged.</p>
      </div>
    );
  }

  return (
    <div className="result">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="credits-badge">⚡ {credits} credit{credits === 1 ? '' : 's'}</span>
        <div className="chips">
          {tiers.map((t) => <span key={t} className="chip">{t}</span>)}
        </div>
      </div>

      <div className="kv">
        {Object.entries(data).map(([k, v]) => (
          <React.Fragment key={k}>
            <span className="k">{FIELD_LABELS[k] || k}</span>
            <span className="v">{renderValue(k, v)}</span>
          </React.Fragment>
        ))}
      </div>

      <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        {preview
          ? 'Preview only — nothing was written or charged.'
          : `${writtenToGhl ? 'Written back to the contact. ' : ''}${billingLabel(billing)}`}
      </p>
    </div>
  );
}

function renderValue(key, v) {
  if (key === 'linkedinUrl' && v) return <a href={v} target="_blank" rel="noreferrer">{v}</a>;
  return String(v);
}

function billingLabel(billing) {
  if (!billing) return '';
  if (billing.charged) return `Charged $${billing.amount} to the agency wallet.`;
  if (billing.skipped === 'billing_disabled') return `Billing disabled — would charge $${billing.amount}.`;
  if (billing.skipped) return `Not charged (${billing.skipped}) — est. $${billing.amount}.`;
  return `Est. $${billing.amount}.`;
}
