import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ToastProvider } from './components/ToastProvider'
import { startNativeSelfDevelopmentAutostart } from './services/nativeSelfDevelopmentAutostartService'
import MarketingLandingPage from './components/MarketingLandingPage'

const CRASH_LOG_KEY = 'alphonso_crash_log_v1';
const MAX_CRASH_ENTRIES = 20;

function recordCrash(type, message, stack) {
  try {
    const entry = { type, message, stack, ts: new Date().toISOString(), ua: navigator.userAgent };
    const raw = localStorage.getItem(CRASH_LOG_KEY);
    const log = raw ? JSON.parse(raw) : [];
    log.push(entry);
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(log.slice(-MAX_CRASH_ENTRIES)));
  } catch { /* ignore write failures */ }
}

window.addEventListener('error', (e) => recordCrash('uncaught', e.message, e.error?.stack || ''));
window.addEventListener('unhandledrejection', (e) => recordCrash('promise', String(e.reason), e.reason?.stack || ''));

class BootBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    window.__ALPHONSO_BOOT_ERROR__?.(
      error?.message || 'Alphonso failed to render.',
      error?.stack || ''
    )
  }

  render() {
    if (this.state.hasError) {
      return null
    }
    return this.props.children
  }
}

const runNativeProofAttempt = async (attempt = 1) => {
  const result = await startNativeSelfDevelopmentAutostart()
  if (result?.cycle || ['ready', 'recorded', 'running', 'blocked'].includes(result?.state)) {
    return
  }
  if (attempt < 12) {
    window.setTimeout(() => {
      void runNativeProofAttempt(attempt + 1)
    }, 3000)
  }
}

window.setTimeout(() => {
  void runNativeProofAttempt()
}, 1000)

const root = ReactDOM.createRoot(document.getElementById('root'))
const pathname = window.location.pathname.toLowerCase();
const isMarketingPage = pathname === '/website' || pathname === '/landing';

root.render(
  <React.StrictMode>
    <BootBoundary>
      {isMarketingPage ? (
        <MarketingLandingPage />
      ) : (
        <ToastProvider>
          <App />
        </ToastProvider>
      )}
    </BootBoundary>
  </React.StrictMode>,
)
