import React, { useEffect, useRef, useState } from 'react';
import { Cloud, RefreshCw, ShieldCheck, LogIn, LogOut, AlertTriangle, Check } from 'lucide-react';
import { loginToSyncApi, syncSnapshot, resolveSyncConflict } from './syncClient.mjs';
import { getPendingSaleTransactions } from './transactionLedger.mjs';
import StaffAccountsPanel from './StaffAccountsPanel.jsx';

const CONFLICTS_KEY = 'malik-syncConflicts';

export default function CloudSyncPanel() {
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('malik-syncBaseUrl') || 'http://127.0.0.1:8787');
  const [username, setUsername] = useState(() => localStorage.getItem('malik-syncUsername') || '');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('malik-syncSession') || 'null'); } catch { return null; }
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pendingSales, setPendingSales] = useState(() => getPendingSaleTransactions(localStorage));
  function refreshPendingSales() {
    setPendingSales(getPendingSaleTransactions(localStorage));
  }
  const [conflicts, setConflicts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CONFLICTS_KEY) || '[]'); } catch { return []; }
  });

  async function runSync({ automatic = false } = {}) {
    if (!session || busyRef.current || !navigator.onLine) return;
    busyRef.current = true;
    setBusy(true);
    if (!automatic) { setError(''); setStatus('Checking server changes and uploading local changes…'); }
    try {
      const result = await syncSnapshot({ baseUrl: session.baseUrl, token: session.token, storage: localStorage, role: session.user.role });
      const latest = (() => { try { return JSON.parse(localStorage.getItem(CONFLICTS_KEY) || '[]'); } catch { return []; } })();
      setConflicts(latest);
      refreshPendingSales();
      setStatus(result.conflicts
        ? 'Sync completed with ' + result.conflicts + ' conflict(s). Choose which version to keep below.'
        : 'Sync complete. Uploaded ' + result.uploaded + ' changes and downloaded ' + result.downloaded + '.');
      if (!automatic) setError('');
    } catch (e) {
      if (!automatic) { setError(e?.message || 'Sync failed. Local data is retained.'); setStatus(''); }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const refreshFromBackground = () => {
      try { setConflicts(JSON.parse(localStorage.getItem(CONFLICTS_KEY) || '[]')); } catch { setConflicts([]); }
      refreshPendingSales();
      const lastError = localStorage.getItem('malik-syncLastError');
      if (lastError) { setError(lastError); setStatus('Background sync needs attention.'); }
      else if (localStorage.getItem('malik-syncLastSuccess')) { setError(''); }
    };
    window.addEventListener('malik-sync-updated', refreshFromBackground);
    return () => window.removeEventListener('malik-sync-updated', refreshFromBackground);
  }, []);

  async function connect(event) {
    event.preventDefault();
    setBusy(true); busyRef.current = true; setError(''); setStatus('');
    try {
      const next = await loginToSyncApi(baseUrl, username, password);
      localStorage.setItem('malik-syncBaseUrl', next.baseUrl);
      localStorage.setItem('malik-syncUsername', username.trim());
      localStorage.setItem('malik-syncSession', JSON.stringify(next));
      setBaseUrl(next.baseUrl); setSession(next); setPassword('');
      setStatus('Connected as ' + next.user.name + '. Background sync runs every 30 seconds while the app is open and online.');
      window.dispatchEvent(new Event('malik-sync-session-changed'));
    } catch (e) { setError(e?.message || 'Could not connect to the sync server.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function chooseConflict(conflict, choice) {
    try {
      resolveSyncConflict(localStorage, conflict.id, choice, session.user.role);
      setConflicts(JSON.parse(localStorage.getItem(CONFLICTS_KEY) || '[]'));
      setStatus(choice === 'local'
        ? 'Kept this computer’s version. It will upload on the next sync.'
        : 'Kept the server version on this computer.');
      setError('');
    } catch (e) { setError(e?.message || 'Could not resolve conflict.'); }
  }

  function disconnect() {
    localStorage.removeItem('malik-syncSession');
    setSession(null); window.dispatchEvent(new Event('malik-sync-session-changed')); setStatus('Disconnected. Local POS data remains on this device.');
    setError('');
  }

  return <div className="panel settings-panel cloud-sync-panel">
    <div className="panel-head"><div><h2><Cloud size={18} style={{verticalAlign:'middle',marginRight:8}}/>Multi-computer sync</h2><p>Connect this register to your private Malik POS API.</p></div><ShieldCheck size={19}/></div>
    <div className="settings-note"><ShieldCheck size={17}/><div><b>Automatic retry and conflict review enabled</b><p>Changes are checked every 30 seconds while the app is open and the computer is online, including when you leave Settings. Pending changes remain local after network failures. Keep regular backups; this is not yet a production-grade offline POS database.</p></div></div>
    {!session ? <form onSubmit={connect}>
      <label className="field-label">SYNC API URL</label>
      <input className="form-input" type="url" required value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://your-private-pos-api.example.com"/>
      <label className="field-label">STAFF USERNAME</label>
      <input className="form-input" required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="API staff username"/>
      <label className="field-label">PASSWORD</label>
      <input className="form-input" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="API staff password"/>
      <button className="btn btn-primary full-btn" type="submit" disabled={busy}><LogIn size={16}/>{busy?'Connecting…':'Connect to server'}</button>
    </form> : <>
      <div className="stock-row"><div className="stock-row-info"><b>{session.user.name}</b><small>{session.user.role} · {session.user.locationId}</small></div><span className="status-pill status-good">Connected</span></div>
      <label className="field-label">SERVER</label><p className="settings-description">{session.baseUrl}</p>
      <button className="btn btn-primary full-btn" onClick={()=>runSync()} disabled={busy}><RefreshCw size={16}/>{busy?'Syncing…':'Sync now'}</button>
      {pendingSales.length>0&&<div className="sync-conflicts" role="status">
        <h3><AlertTriangle size={17} style={{verticalAlign:'middle',marginRight:6}}/>Shared sales need retry ({pendingSales.length})</h3>
        <p className="settings-description">These requests lost a reliable server response. Their original payloads are saved on this register. Open the matching pending order and retry its payment to safely replay the same request; do not create a replacement order.</p>
        {pendingSales.map(sale=><div className="settings-note" key={sale.orderId}>
          <div><b>{sale.orderId}</b><p>{sale.itemCount} item line(s) · {sale.total.toLocaleString(undefined,{maximumFractionDigits:2})} tendered · {sale.occurredAt?new Date(sale.occurredAt).toLocaleString():'time unavailable'}</p></div>
        </div>)}
        <button className="btn btn-secondary full-btn" onClick={refreshPendingSales}>Refresh pending sale status</button>
      </div>}
      <button className="btn btn-secondary full-btn" onClick={()=>window.location.reload()} disabled={busy}>Reload register after sync</button>
      <button className="btn btn-secondary full-btn" onClick={disconnect} disabled={busy}><LogOut size={16}/> Disconnect</button>
    </>}
    {status&&<p className="settings-description" role="status">{status}</p>}
    {error&&<p className="settings-description" role="alert" style={{color:'var(--danger,#b42318)'}}>{error}</p>}
    {conflicts.length>0&&<div className="sync-conflicts">
      <h3><AlertTriangle size={17} style={{verticalAlign:'middle',marginRight:6}}/>Conflicts need your choice ({conflicts.length})</h3>
      <p className="settings-description">The same record changed locally and on the server. Select the version to keep; this choice applies to that record only.</p>
      {conflicts.map(conflict=><div className="settings-note" key={conflict.id}>
        <div style={{width:'100%'}}>
          <b>{conflict.entity} · {conflict.recordId}</b>
          <p><b>This computer:</b> <code>{JSON.stringify(conflict.local ?? '(deleted)').slice(0,180)}</code></p>
          <p><b>Server:</b> <code>{JSON.stringify(conflict.remote ?? '(deleted)').slice(0,180)}</code></p>
          <button className="btn btn-secondary" onClick={()=>chooseConflict(conflict,'local')}><Check size={14}/> Keep this computer</button>{' '}
          <button className="btn btn-secondary" onClick={()=>chooseConflict(conflict,'remote')}><Check size={14}/> Keep server</button>
        </div>
      </div>)}
    </div>}
    {session?.user?.role === 'admin' && <StaffAccountsPanel baseUrl={session.baseUrl} token={session.token} />}
  </div>;
}
