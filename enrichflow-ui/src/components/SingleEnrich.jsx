import React, { useState } from 'react';
import { api } from '../api.js';
import EnrichResult from './EnrichResult.jsx';

export default function SingleEnrich({ locationId, connected, subBlocked }) {
  const [mode, setMode] = useState('details'); // 'details' | 'contact'
  const [form, setForm] = useState({ email: '', phone: '', fullName: '', company: '', companyDomain: '' });
  const [contactId, setContactId] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const run = async (kind) => {
    setError('');
    setResult(null);
    setBusy(kind);
    try {
      if (mode === 'contact') {
        const r = await api.enrich({ locationId, contactId: contactId.trim(), writeBack: true });
        setResult(r);
      } else {
        const input = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
        if (!Object.keys(input).length) throw new Error('Enter at least an email, phone, or a name + company.');
        const r = kind === 'preview' ? await api.preview(input) : await api.enrich({ input });
        setResult({ ...r, preview: kind === 'preview' });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card">
      <h2>Enrich a contact</h2>
      <p className="sub">Preview runs against the mock/provider waterfall with no charge. Enriching a CRM contact writes fields back and charges credits.</p>

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={mode === 'details' ? 'active' : ''} onClick={() => setMode('details')}>By details</button>
        <button className={mode === 'contact' ? 'active' : ''} onClick={() => setMode('contact')}>By Contact ID</button>
      </div>

      {mode === 'details' ? (
        <>
          <div className="row">
            <div className="field">
              <label>Email</label>
              <input value={form.email} onChange={set('email')} placeholder="jane.doe@acme.io" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone} onChange={set('phone')} placeholder="+14155550123" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Full name</label>
              <input value={form.fullName} onChange={set('fullName')} placeholder="Jane Doe" />
            </div>
            <div className="field">
              <label>Company</label>
              <input value={form.company} onChange={set('company')} placeholder="Acme" />
            </div>
          </div>
          <div className="field">
            <label>Company domain</label>
            <input value={form.companyDomain} onChange={set('companyDomain')} placeholder="acme.io" />
          </div>
          <div className="btn-row">
            <button className="btn ghost" disabled={!!busy} onClick={() => run('preview')}>
              {busy === 'preview' ? <span className="spinner" /> : 'Preview (no charge)'}
            </button>
            <button className="btn" disabled={!!busy || subBlocked} onClick={() => run('enrich')}>
              {busy === 'enrich' ? <span className="spinner" /> : 'Enrich'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>Contact ID</label>
            <input value={contactId} onChange={(e) => setContactId(e.target.value)} placeholder="e.g. ocQHyuzHvysMo5N5VsXc" />
          </div>
          {!connected && <p className="muted" style={{ fontSize: 12 }}>This account isn't connected — connect via OAuth first.</p>}
          {subBlocked && <p className="muted" style={{ fontSize: 12 }}>An active subscription is required to enrich.</p>}
          <div className="btn-row">
            <button className="btn" disabled={!!busy || !connected || !contactId.trim() || subBlocked} onClick={() => run('enrich')}>
              {busy === 'enrich' ? <span className="spinner" /> : 'Enrich & write back'}
            </button>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <EnrichResult result={result} />
    </div>
  );
}
