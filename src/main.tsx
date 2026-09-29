import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main style={{ padding: 40 }}>
        <h1>页面遇到了问题</h1>
        <p>{this.state.error}</p>
        <p>已保存的本地工作区仍保留。刷新后重新打开。</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
