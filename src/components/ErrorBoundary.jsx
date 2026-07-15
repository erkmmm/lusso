import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Route-level error boundary.
 *
 * Without this, a render error on ANY page (e.g. a data-shape race while a
 * record is mid-hydration, or a bad payload from a realtime update) unmounts
 * the whole React tree — the screen goes blank and the only way out is a manual
 * refresh. That's the "sometimes a page doesn't open until I refresh" symptom.
 *
 * This wraps the page content (the <Outlet/>) but NOT the surrounding chrome, so:
 *   - a page crash shows a friendly retry panel instead of a blank screen,
 *   - the sidebar / nav stay usable, and
 *   - navigating to another route RESETS the boundary (the resetKey is the
 *     pathname), so the user recovers by just tapping another page — no refresh.
 */
class Boundary extends Component {
  state = { error: null, key: undefined };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    // New route → clear any prior error and track the new key.
    if (props.resetKey !== state.key) {
      return { error: null, key: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, info) {
    // Surface it for debugging; the app keeps working.
    console.error('[app] page render error caught by boundary:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-20 gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle size={22} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800">This page hit a snag</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-xs">
              Your data is safe. Tap another page in the menu, or reload to try again.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw size={15} /> Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
