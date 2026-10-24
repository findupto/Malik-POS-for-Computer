import React, { useState } from 'react';
import { Cloud, RefreshCw, ShieldCheck, LogIn, LogOut } from 'lucide-react';
import { loginToSyncApi, syncSnapshot } from './syncClient.mjs';

export default function CloudSyncPanel() {
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('malik-syncBaseUrl') || 'http://127.0.0.1:8787');
  const [username, setUsername] = useState(() => localStorage.getItem('malik-syncUsername') || '');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('malik-syncSession') || 'null'); } catch { return null; }
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function connect(event) {
    event.preventDefault();
    setBusy(true); setError(''); setStatus('');
    try {
      const next = await loginToSyncApi(baseUrl, username, password);
      localStorage.setItem('malik-syncBaseUrl', next.baseUrl);
      localStorage.setItem('malik-syncUsername', username.trim());
      localStorage.setItem('malik-syncSession', JSON.stringify(next));
      setBaseUrl(next.baseUrl); setSession(next); setPassword('');
      setStatus('Connected as ' + next.user.name + ' (' + next.user.role + ').');
    } catch (e) { setError(e?.message || 'Could not connect to the sync server.'); }
    finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setError(''); setStatus('Downloading server changes, then uploading local records…');
    try {
      const result = await syncSnapshot({ baseUrl: session.baseUrl, token: session.token, storage: localStorage, role: session.user.role });
      setStatus('Sync finished. Uploaded ' + result.uploaded + ' events; downloaded ' + result.downloaded + '. Reload this register to apply changes to the open screen.');
    } catch (e) { setError(e?.message || 'Sync failed. Your local data has not been cleared.'); setStatus(''); }
    finally { setBusy(false); }
  }

  function disconnect() {
    localStorage.removeItem('malik-syncSession');
    setSession(null); setStatus('Disconnected from cloud sync. Local POS data remains on this device.');
    setError('');
  }

  return <div className="panel settings-panel cloud-sync-panel">
    <div className="panel-head"><div><h2><Cloud size={18} style={{verticalAlign:'middle',marginRight:8}}/>Multi-computer sync</h2><p>Connect this register to your private Malik POS API.</p></div><ShieldCheck size={19}/></div>
    <div className="settings-note"><ShieldCheck size={17}/><div><b>Local-first, early sync implementation</b><p>Local data remains available. Sync is manual; conflicting edits are not yet reviewed automatically. Back up the database before using across live registers.</p></div></div>
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
      <button className="btn btn-primary full-btn" onClick={syncNow} disabled={busy}><RefreshCw size={16}/>{busy?'Syncing…':'Sync now'}</button>
      <button className="btn btn-secondary full-btn" onClick={()=>window.location.reload()} disabled={busy}>Reload register after sync</button>
      <button className="btn btn-secondary full-btn" onClick={disconnect} disabled={busy}><LogOut size={16}/> Disconnect</button>
    </>}
    {status&&<p className="settings-description" role="status">{status}</p>}
    {error&&<p className="settings-description" role="alert" style={{color:'var(--danger,#b42318)'}}>{error}</p>}
  </div>;
}
