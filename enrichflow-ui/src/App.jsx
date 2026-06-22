import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import SingleEnrich from './components/SingleEnrich.jsx';
import BulkEnrich from './components/BulkEnrich.jsx';
import UsageDashboard from './components/UsageDashboard.jsx';

// GHL injects the active sub-account id into the iframe URL (?locationId=...).
// For local dev we also accept a manual value and remember it in localStorage.
function resolveLocationId() {
  const fromUrl = new URLSearchParams(window.location.search).get('locationId');
  if (fromUrl) {
    localStorage.setItem('ef_locationId', fromUrl);
    return fromUrl;
  }
  return localStorage.getItem('ef_locationId') || '';
}

// Production SSO: ask the GHL parent window for the encrypted session context, then have the
// backend decrypt it with the app Shared Secret. Resolves the active locationId automatically
// (no "Set location" needed) when the page is embedded inside the CRM.
function requestSsoUserData(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (window.parent === window) return resolve(null); // not embedded (standalone/local)

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
  const [tab, setTab] = useState('single');
  const [connected, setConnected] = useState(null); // null = unknown
  const [sub, setSub] = useState(null);

  // On mount inside GHL, resolve locationId from the encrypted SSO context if the URL didn't carry it.
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
      return;
    }
    api.status(locationId).then((r) => setConnected(!!r.connected)).catch(() => setConnected(false));
    api.subscription(locationId).then(setSub).catch(() => setSub(null));
  }, [locationId]);

  // Mandatory plan: when required and not entitled, enrichment is blocked (preview still allowed).
  const subBlocked = !!(sub && sub.required && !sub.entitled);

  const promptLocation = () => {
    const v = window.prompt('Enter an Account ID (sub-account id) for testing:', locationId);
    if (v) {
      localStorage.setItem('ef_locationId', v.trim());
      setLocationId(v.trim());
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
              <code onClick={promptLocation} title="Click to change account">{locationId}</code>
            </>
          ) : (
            <a className="loc-set" onClick={promptLocation}>Set account</a>
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
        <span className="dot" />
        <span>Connected to your CRM. Enrichment will read &amp; write this sub-account's contacts.</span>
      </div>
    );
  }
  return (
    <div className="banner warn">
      <span className="dot" />
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
        <span className="dot" />
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
      <span className="dot" />
      <span>
        {sub.plan?.name || 'Plan'} active — {sub.remainingIncluded ?? 0} of {sub.includedCredits ?? 0} included
        credits left this month. Overage billed per credit.
      </span>
    </div>
  );
}
