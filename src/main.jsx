import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('Malik POS interface failed to render:', error, info?.componentStack || '');
  }
  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: 32, display: 'grid', placeItems: 'center', background: '#f4f6f8', color: '#15231f', fontFamily: 'Segoe UI, Arial, sans-serif' }}>
          <section style={{ width: 'min(760px, 100%)', background: '#fff', border: '1px solid #e2e8e5', borderRadius: 18, padding: 28, boxSizing: 'border-box', boxShadow: '0 16px 50px rgba(16,24,39,.08)' }}>
            <div style={{ color: '#b7791f', fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>MALIK POS · RECOVERY</div>
            <h1 style={{ margin: '12px 0', fontSize: 26 }}>The interface could not start</h1>
            <p style={{ lineHeight: 1.6 }}>Malik POS caught an application error instead of showing a blank page. Copy the diagnostic below and send it to support so the exact problem can be fixed.</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto', padding: 14, borderRadius: 10, background: '#f3f5f4', fontSize: 12 }}>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
            <button onClick={() => window.location.reload()} style={{ cursor: 'pointer', border: 0, borderRadius: 9, padding: '11px 18px', background: '#145b46', color: '#fff', fontWeight: 700 }}>Restart Malik POS</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<AppErrorBoundary><React.StrictMode><App /></React.StrictMode></AppErrorBoundary>);
} else {
  document.body.innerHTML = '<main style="font-family:Segoe UI,Arial;padding:32px"><h1>Malik POS could not find its app root.</h1><p>Please reinstall the latest verified build and report this diagnostic.</p></main>';
}
