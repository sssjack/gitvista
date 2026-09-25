import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class AppBoundary extends React.Component<{ children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <main style={{ padding: 48, background: '#16181d', color: '#e4e6ec', height: '100vh', fontFamily: 'Segoe UI, sans-serif' }}><h1>Something went wrong</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>Reload</button></main>;
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<AppBoundary><App /></AppBoundary>);
