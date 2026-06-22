import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function BulkEnrich({ locationId, connected, subBlocked }) {
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState(null); // { done, total, credits }
  const [statusById, setStatusById] = useState({});

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const r = await api.contacts({ locationId, limit: 25, query });
      setContacts(r.contacts);
      setSelected({});
      setStatusById({});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connected && locationId) load();
  }, [connected, locationId]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const allChecked = contacts.length > 0 && contacts.every((c) => selected[c.id]);
  const toggleAll = () => {
    if (allChecked) setSelected({});
    else setSelected(Object.fromEntries(contacts.map((c) => [c.id, true])));
  };

  const ids = contacts.filter((c) => selected[c.id]).map((c) => c.id);

  const runBulk = async () => {
    setProgress({ done: 0, total: ids.length, credits: 0 });
    let credits = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setStatusById((s) => ({ ...s, [id]: 'running' }));
      try {
        const r = await api.enrich({ locationId, contactId: id, writeBack: true });
        credits += r.credits || 0;
        setStatusById((s) => ({ ...s, [id]: r.matched ? 'matched' : 'no_match' }));
      } catch {
        setStatusById((s) => ({ ...s, [id]: 'error' }));
      }
      setProgress({ done: i + 1, total: ids.length, credits });
    }
  };

  if (!connected) {
    return (
      <div className="card">
        <h2>Bulk enrich</h2>
        <p className="empty">Connect this account to your CRM to list and enrich contacts in bulk.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Bulk enrich</h2>
      <p className="sub">Select contacts and enrich them in one pass. Each enriched contact is written back and charged.</p>

      <div className="btn-row" style={{ marginBottom: 14 }}>
        <input
          className="field"
          style={{ flex: 1, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8 }}
          placeholder="Search contacts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button className="btn ghost" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Search'}
        </button>
        <button className="btn" onClick={runBulk} disabled={!ids.length || subBlocked || (progress && progress.done < progress.total)}>
          Enrich {ids.length || ''}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {progress && (
        <div className="banner ok" style={{ marginBottom: 12 }}>
          <span className="dot" />
          <span>
            {progress.done}/{progress.total} processed · {progress.credits} credits used
            {progress.done === progress.total ? ' · done' : '…'}
          </span>
        </div>
      )}

      {contacts.length === 0 ? (
        <p className="empty">{loading ? 'Loading…' : 'No contacts found.'}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell"><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th className="tiny">Status</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="checkbox-cell"><input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id)} /></td>
                <td>{c.name || <span className="muted">—</span>}</td>
                <td>{c.email || <span className="muted">—</span>}</td>
                <td>{c.company || <span className="muted">—</span>}</td>
                <td className="tiny"><StatusTag status={statusById[c.id]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusTag({ status }) {
  if (!status) return <span className="muted">—</span>;
  if (status === 'running') return <span className="spinner" style={{ borderTopColor: 'var(--primary)', borderColor: '#ddd' }} />;
  if (status === 'matched') return <span className="tag green">enriched</span>;
  if (status === 'no_match') return <span className="tag gray">no match</span>;
  return <span className="tag gray" style={{ color: 'var(--red)' }}>error</span>;
}
