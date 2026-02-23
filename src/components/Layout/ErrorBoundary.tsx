import React, { Component, ErrorInfo } from 'react';
import { RefreshCw, AlertTriangle, Copy, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  copied: boolean;
}

/**
 * Global error boundary — catches unhandled React render errors
 * and shows a recovery UI instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRecover = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const text = [
      `Error: ${error?.message || 'Unknown error'}`,
      `Stack: ${error?.stack || 'No stack trace'}`,
      `Component Stack: ${errorInfo?.componentStack || 'N/A'}`,
    ].join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => {});
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo, showDetails, copied } = this.state;

    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ backgroundColor: '#1e1e1e', color: '#cccccc' }}>
        <div className="max-w-[520px] w-full mx-4 rounded-lg p-6" style={{ backgroundColor: '#252526', border: '1px solid #3c3c3c' }}>
          {/* Icon + Title */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#4e1e1e' }}>
              <AlertTriangle size={20} style={{ color: '#f48771' }} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: '#e5e5e5' }}>Something went wrong</h2>
              <p className="text-[12px]" style={{ color: '#858585' }}>
                {this.props.fallbackMessage || 'guIDE encountered an unexpected error'}
              </p>
            </div>
          </div>

          {/* Error message */}
          <div className="rounded px-3 py-2 mb-4 text-[12px] font-mono" style={{ backgroundColor: '#1e1e1e', color: '#f48771', border: '1px solid #3c3c3c' }}>
            {error?.message || 'Unknown error'}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={this.handleRecover}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-colors"
              style={{ backgroundColor: '#0e639c', color: '#ffffff' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1177bb')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0e639c')}
            >
              <RefreshCw size={13} />
              Try to Recover
            </button>
            <button
              onClick={this.handleReload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] transition-colors"
              style={{ backgroundColor: '#3c3c3c', color: '#cccccc' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4c4c4c')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3c3c3c')}
            >
              Reload App
            </button>
            <button
              onClick={this.handleCopyError}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] transition-colors"
              style={{ backgroundColor: '#3c3c3c', color: '#cccccc' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4c4c4c')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3c3c3c')}
            >
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy Error'}
            </button>
          </div>

          {/* Expandable details */}
          <button
            onClick={() => this.setState({ showDetails: !showDetails })}
            className="flex items-center gap-1 text-[11px] mb-2"
            style={{ color: '#858585', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Technical Details
          </button>
          {showDetails && (
            <pre
              className="text-[10px] rounded p-3 overflow-auto"
              style={{
                backgroundColor: '#1e1e1e',
                color: '#858585',
                border: '1px solid #3c3c3c',
                maxHeight: '200px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {error?.stack || 'No stack trace available'}
              {errorInfo?.componentStack && `\n\nComponent Stack:${errorInfo.componentStack}`}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
