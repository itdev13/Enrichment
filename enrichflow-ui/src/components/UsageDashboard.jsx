import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function UsageDashboard({ locationId, sub }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .usage(locationId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [locationId]);

  if (!locationId) return <div className="card"><h2>Usage</h2><p className="empty">Set an account to view usage.</p></div>;
  if (loading) return <div className="card"><h2>Usage</h2><p className="empty">Loading…</p></div>;
  if (error) return <div className="card"><h2>Usage</h2><p className="error">{error}</p></div>;

  const s = data?.summary || {};
  const recent = data?.recent || [];

  return (
    <>
      {data?.dbDisabled && (
        <div className="banner warn"><span className="dot" /><span>Database disabled — usage stats are not being recorded. Set MONGODB_URI to enable history.</span></div>
      )}

      <PlanCard sub={sub} />


      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Total Runs" value={s.totalRuns ?? 0} />
        <Stat label="Matched" value={s.matched ?? 0} />
        <Stat label="Credits Used" value={s.creditsUsed ?? 0} />
        <Stat label="Est. Spend" value={`$${(s.estSpendUsd ?? 0).toFixed(2)}`} />
      </div>

      <div className="card">
        <h2>Recent Enrichments</h2>
        <p className="sub">Last 10 runs for this account.</p>
        {recent.length === 0 ? (
          <p className="empty">No enrichments yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th className="tiny">Result</th>
                <th className="tiny">Credits used</th>
                <th className="tiny">Written to CRM</th>
                <th className="tiny">Date</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const email = r.contactEmail || r.input?.email;
                const displayName = r.contactName || email || '—';
                const showEmail = r.contactName && email;
                return (
                  <tr key={r._id}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13.5 }}>{displayName}</div>
                      {showEmail && (
                        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 1 }}>{email}</div>
                      )}
                      {r.contactId && (
                        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 1, fontFamily: 'monospace' }}>{r.contactId}</div>
                      )}
                    </td>
                    <td className="tiny">{r.matched ? <span className="tag green">Matched</span> : <span className="tag gray">No match</span>}</td>
                    <td className="tiny" style={{ fontWeight: 600 }}>{r.credits}</td>
                    <td className="tiny">{r.writtenToGhl ? <span className="tag green">Yes</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td className="tiny muted">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function PlanCard({ sub }) {
  if (!sub || !sub.plan) return null;
  const used = sub.creditsUsedThisPeriod ?? 0;
  const included = sub.includedCredits ?? sub.plan.includedCredits ?? 0;
  const remaining = sub.remainingIncluded ?? Math.max(0, included - used);
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const active = sub.entitled;

  const isTrial = sub.status === 'trialing';
  const daysLeft = sub.currentPeriodEnd
    ? Math.max(0, Math.ceil((new Date(sub.currentPeriodEnd) - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <h2 style={{ margin: 0 }}>{sub.plan.name} · ${sub.plan.priceUsd}/mo</h2>
          {isTrial && (
            <span style={{ fontSize: 11.5, color: 'var(--amber)', fontWeight: 600, marginTop: 3, display: 'block' }}>
              Free trial — {daysLeft !== null ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'limited time'}
            </span>
          )}
        </div>
        <span className={`tag ${isTrial ? 'gray' : active ? 'green' : 'gray'}`} style={isTrial ? { background: '#fffbeb', color: 'var(--amber)' } : {}}>
          {isTrial ? 'Trial' : sub.status || (active ? 'Active' : 'Inactive')}
        </span>
      </div>
      <p className="sub" style={{ marginBottom: 12 }}>
        {isTrial
          ? `${included} trial credits included. Upgrade to a paid plan for full access.`
          : `Included credits reset monthly. Overage billed at $${sub.plan.overageRateUsd ?? '0.03'}/credit.`}
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
        <span className="muted">{used} / {included} credits used</span>
        <span className="muted" style={{ fontWeight: 600, color: remaining < 10 ? 'var(--red)' : 'inherit' }}>{remaining} left</span>
      </div>
      <div style={{ height: 8, background: '#eef0f6', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? 'var(--amber)' : 'var(--primary)', transition: 'width 0.3s ease' }} />
      </div>
      {!isTrial && sub.currentPeriodEnd && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
