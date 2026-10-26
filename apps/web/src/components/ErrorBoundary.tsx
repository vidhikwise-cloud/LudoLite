import { Component, type ErrorInfo, type ReactNode } from 'react';

import { LudoMark } from './Brand.js';

/**
 * Catches render errors so a bug in one screen does not leave the user
 * staring at a blank white page with no way forward.
 *
 * Offers a reload and a way back to the home screen, because a player who
 * crashed out of a match mostly wants to get back into it.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No analytics service is wired up yet; the console is what a developer
    // or a user sending a screenshot actually has access to.
    console.error('[ludo] render error', error, info.componentStack);
  }

  private reset = (): void => {
    // Clear the saved room: a corrupt room state is the most likely reason a
    // screen threw, and returning to it would just crash again.
    try {
      localStorage.removeItem('ludolite.roomId');
    } catch {
      // Storage can be unavailable in private mode; nothing to do.
    }
    window.location.href = '/';
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="shell">
        <div className="brandbar">
          <LudoMark />
          <b>LudoLite</b>
        </div>

        <div>
          <h1 className="screen-title">Something went wrong</h1>
          <p className="sub">
            The app hit an unexpected problem and stopped. Nothing was charged —
            this app does not take payments.
          </p>
        </div>

        <div className="btn-stack">
          <button type="button" className="btn btn-primary" onClick={this.reset}>
            Back to home
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
        </div>

        {import.meta.env.DEV ? (
          <pre className="blockers" style={{ whiteSpace: 'pre-wrap' }}>
            {error.message}
            {'\n\n'}
            {error.stack}
          </pre>
        ) : null}
      </div>
    );
  }
}
