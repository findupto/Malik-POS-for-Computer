import React, { useCallback, useEffect, useState } from 'react';
import { UserRoundCog, RefreshCw, UserPlus, KeyRound, UserCheck, UserX } from 'lucide-react';

export default function StaffAccountsPanel({ baseUrl, token }) {
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({ username: '', displayName: '', role: 'cashier', password: '' });
  const [resetTarget, setResetTarget] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(baseUrl.replace(/\/+$/,'') + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Staff account request failed.');
    return data;
  }, [baseUrl, token]);

  const loadUsers = useCallback(async () => {
    setBusy(true); setError('');
    try { const data = await request('/api/admin/users'); setUsers(data.users || []); }
    catch (e) { setError(e.message || 'Could not load staff accounts.'); }
    finally { setBusy(false); }
  }, [request]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function createUser(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await request('/api/admin/users', { method: 'POST', body: JSON.stringify(draft) });
      setDraft({ username: '', displayName: '', role: 'cashier', password: '' });
      setMessage('Staff account created.'); await loadUsers();
    } catch (e) { setError(e.message || 'Could not create staff account.'); }
    finally { setBusy(false); }
  }

  async function toggleUser(user) {
    setBusy(true); setError(''); setMessage('');
    try {
      await request('/api/admin/users/' + encodeURIComponent(user.id) + '/' + (user.active ? 'deactivate' : 'activate'), { method: 'POST', body: '{}' });
      setMessage(user.active ? 'Staff account deactivated.' : 'Staff account activated.'); await loadUsers();
    } catch (e) { setError(e.message || 'Could not update staff account.'); }
    finally { setBusy(false); }
  }

  async function savePassword(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await request('/api/admin/users/' + encodeURIComponent(resetTarget) + '/reset-password', { method: 'POST', body: JSON.stringify({ password: resetPassword }) });
      setResetTarget(''); setResetPassword(''); setMessage('Password reset. That user must sign in again.');
    } catch (e) { setError(e.message || 'Could not reset password.'); }
    finally { setBusy(false); }
  }

  return <div className="panel settings-panel staff-accounts-panel">
    <div className="panel-head"><div><h2><UserRoundCog size={18} style={{verticalAlign:'middle',marginRight:8}}/>Staff accounts</h2><p>Create accounts, change access and reset passwords for this location.</p></div><button className="btn btn-secondary" type="button" onClick={loadUsers} disabled={busy}><RefreshCw size={15}/> Refresh</button></div>
    <form onSubmit={createUser}>
      <div className="form-two">
        <div><label className="field-label">USERNAME</label><input className="form-input" required minLength={3} maxLength={64} pattern="[a-zA-Z0-9._-]+" value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value})} autoComplete="off" /></div>
        <div><label className="field-label">DISPLAY NAME</label><input className="form-input" required maxLength={100} value={draft.displayName} onChange={e=>setDraft({...draft,displayName:e.target.value})} /></div>
      </div>
      <div className="form-two">
        <div><label className="field-label">ROLE</label><select className="form-input" value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value})}><option value="cashier">Cashier</option><option value="manager">Manager</option><option value="admin">Administrator</option></select></div>
        <div><label className="field-label">TEMPORARY PASSWORD (MINIMUM 12 CHARACTERS)</label><input className="form-input" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})} /></div>
      </div>
      <button className="btn btn-primary full-btn" type="submit" disabled={busy}><UserPlus size={16}/> Create staff account</button>
    </form>
    {message&&<p className="settings-description" role="status">{message}</p>}
    {error&&<p className="settings-description" role="alert" style={{color:'var(--danger,#b42318)'}}>{error}</p>}
    <div className="responsive-table"><table><thead><tr><th>STAFF</th><th>ROLE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
      {users.map(user=><tr key={user.id}><td><b>{user.display_name}</b><small style={{display:'block'}}>{user.username}</small></td><td>{user.role}</td><td>{user.active?'Active':'Inactive'}</td><td><div className="toolbar-right"><button className="btn btn-secondary" type="button" onClick={()=>{setResetTarget(user.id);setResetPassword('')}} disabled={busy}><KeyRound size={14}/> Reset password</button><button className="btn btn-secondary" type="button" onClick={()=>toggleUser(user)} disabled={busy}><>{user.active?<UserX size={14}/>:<UserCheck size={14}/>} {user.active?'Deactivate':'Activate'}</></button></div></td></tr>)}
      {!users.length&&<tr><td colSpan="4">{busy?'Loading staff accounts…':'No staff accounts found.'}</td></tr>}
    </tbody></table></div>
    {resetTarget&&<form className="settings-note" onSubmit={savePassword}><div style={{width:'100%'}}><b>Reset password</b><label className="field-label">NEW PASSWORD (MINIMUM 12 CHARACTERS)</label><input className="form-input" type="password" minLength={12} maxLength={1024} required autoComplete="new-password" value={resetPassword} onChange={e=>setResetPassword(e.target.value)}/><div className="modal-actions"><button className="btn btn-secondary" type="button" onClick={()=>{setResetTarget('');setResetPassword('')}}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy}>Save password</button></div></div></form>}
  </div>;
}
