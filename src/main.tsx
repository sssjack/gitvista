import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class AppBoundary extends React.Component<{ children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <main style={{ padding: 48, background: '#11151d', color: '#e5e7eb', height: '100vh', fontFamily: 'Segoe UI, sans-serif' }}><h1>界面遇到了问题</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>重新加载</button></main>;
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<AppBoundary><App /></AppBoundary>);
