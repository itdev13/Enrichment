import { useEffect, useState } from 'react';
import { api } from './api.js';
import SingleEnrich from './components/SingleEnrich.jsx';
import BulkEnrich from './components/BulkEnrich.jsx';
import UsageDashboard from './components/UsageDashboard.jsx';

function resolveLocationId() {
  const fromUrl = new URLSearchParams(window.location.search).get('locationId');
  if (fromUrl) {
    localStorage.setItem('ef_locationId', fromUrl);
    return fromUrl;
  }
  return localStorage.getItem('ef_locationId') || '';
}

function requestSsoUserData(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (window.parent === window) return resolve(null);

    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      resolve(val);
    };

    const handler = ({ data }) => {
      if (data && data.message === 'REQUEST_USER_DATA_RESPONSE') {
        finish(data.payload || null);
      }
    };

    window.addEventListener('message', handler);
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
    setTimeout(() => finish(null), timeoutMs);
  });
}

const TABS = [
  { id: 'single', label: 'Enrich a contact' },
  { id: 'bulk', label: 'Bulk enrich' },
  { id: 'usage', label: 'Usage' }
];

export default function App() {
  const [locationId, setLocationId] = useState(resolveLocationId);
  const [locationName, setLocationName] = useState('');
  const [tab, setTab] = useState('single');
  const [connected, setConnected] = useState(null);
  const [sub, setSub] = useState(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('locationId')) return;
    let cancelled = false;
    (async () => {
      const encrypted = await requestSsoUserData();
      if (!encrypted || cancelled) return;
      try {
        const data = await api.decryptUserData(encrypted);
        if (!cancelled && data.locationId) {
          localStorage.setItem('ef_locationId', data.locationId);
          setLocationId(data.locationId);
        }
      } catch {
        /* fall back to URL/localStorage/manual entry */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!locationId) {
      setConnected(false);
      setSub(null);
      setLocationName('');
      return;
    }
    api.status(locationId)
      .then((r) => {
        setConnected(!!r.connected);
        if (r.locationName) setLocationName(r.locationName);
      })
      .catch(() => setConnected(false));
    api.subscription(locationId).then(setSub).catch(() => setSub(null));
  }, [locationId]);

  const subBlocked = !!(sub && sub.required && !sub.entitled);

  const promptLocation = () => {
    const v = window.prompt('Enter an Account ID (sub-account id) for testing:', locationId);
    if (v) {
      localStorage.setItem('ef_locationId', v.trim());
      setLocationId(v.trim());
      setLocationName('');
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img className="logo" src={`${import.meta.env.BASE_URL}assets/icon.png`} alt="EnrichFlow" />
          <div>
            <h1>EnrichFlow</h1>
            <p>Fill in emails, phones &amp; firmographics for your contacts</p>
          </div>
        </div>
        <div className="loc">
          {locationId ? (
            <>
              <span className="loc-label">Account</span>
              <div
                className="loc-name"
                onClick={promptLocation}
                title={locationId}
              >
                {locationName || locationId}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </div>
            </>
          ) : (
            <button className="loc-set" onClick={promptLocation}>Set account</button>
          )}
        </div>
      </header>

      <ConnectBanner connected={connected} locationId={locationId} onSetLocation={promptLocation} />
      <SubscriptionBanner sub={sub} blocked={subBlocked} />

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'single' && <SingleEnrich locationId={locationId} connected={connected} subBlocked={subBlocked} />}
      {tab === 'bulk' && <BulkEnrich locationId={locationId} connected={connected} subBlocked={subBlocked} />}
      {tab === 'usage' && <UsageDashboard locationId={locationId} sub={sub} />}
    </div>
  );
}

function ConnectBanner({ connected, locationId, onSetLocation }) {
  if (connected === null) return null;
  if (connected) {
    return (
      <div className="banner ok">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>Connected to your CRM. Enrichment will read &amp; write this sub-account's contacts.</span>
      </div>
    );
  }
  return (
    <div className="banner warn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>
        Not connected.{' '}
        {locationId ? (
          <>
            Install EnrichFlow on this account via{' '}
            <a href={api.authorizeUrl()} target="_blank" rel="noreferrer">OAuth</a>.{' '}
          </>
        ) : (
          <>
            <a onClick={onSetLocation} style={{ cursor: 'pointer' }}>Set an account</a> to begin.{' '}
          </>
        )}
        You can still try <strong>Preview</strong> in local mode below.
      </span>
    </div>
  );
}

function SubscriptionBanner({ sub, blocked }) {
  if (!sub || !sub.required) return null;
  if (blocked) {
    return (
      <div className="banner warn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>
          <strong>Subscription required.</strong> EnrichFlow is a paid plan
          {sub.plan ? ` ($${sub.plan.priceUsd}/mo, ${sub.plan.includedCredits} credits included)` : ''}.
          Activate your subscription to enrich contacts. Preview still works.
        </span>
      </div>
    );
  }
  return (
    <div className="banner ok">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
      <span>
        {sub.plan?.name || 'Plan'} active — {sub.remainingIncluded ?? 0} of {sub.includedCredits ?? 0} included
        credits left this month. Overage billed per credit.
      </span>
    </div>
  );
}
