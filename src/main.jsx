import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerServiceWorker } from './lib/push'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Push-only worker (no fetch handler, so it can't serve a stale build). Deferred
// to after load so it never competes with the first paint.
window.addEventListener('load', () => { registerServiceWorker(); })
