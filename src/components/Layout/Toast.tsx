/**
 * Toast notification system — singleton, no context required.
 * Any file can call: import { toast } from '@/components/Layout/Toast';
 *                    toast('Message', 'success');
 */
import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  exiting: boolean;
}

// Global event bus — works without React context
const TOAST_EVENT = 'guide-toast';
let _toastIdCounter = 0;

export function toast(message: string, type: ToastType = 'info') {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, type } }));
}

const ICONS: Record<ToastType, React.FC<{ size: number }>> = {
  success: ({ size }) => <CheckCircle size={size} />,
  error: ({ size }) => <XCircle size={size} />,
  warning: ({ size }) => <AlertTriangle size={size} />,
  info: ({ size }) => <Info size={size} />,
};

const COLORS: Record<ToastType, { border: string; icon: string; bg: string }> = {
  success: { border: '#89d185', icon: '#89d185', bg: '#1e2e1e' },
  error:   { border: '#f48771', icon: '#f48771', bg: '#2e1e1e' },
  warning: { border: '#dcdcaa', icon: '#dcdcaa', bg: '#2e2e1a' },
  info:    { border: '#007acc', icon: '#007acc', bg: '#1a1e2e' },
};

const DISMISS_MS = 4000;
const EXIT_MS = 280;

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, type } = (e as CustomEvent).detail as { message: string; type: ToastType };
      const id = ++_toastIdCounter;
      setToasts(prev => [...prev, { id, message, type, exiting: false }]);

      // Start exit animation before removing
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id));
        }, EXIT_MS);
      }, DISMISS_MS);
    };

    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  const dismiss = (id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), EXIT_MS);
  };

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '48px',
        right: '16px',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map(t => {
        const c = COLORS[t.type];
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: '6px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              minWidth: '240px',
              maxWidth: '360px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              pointerEvents: 'all',
              opacity: t.exiting ? 0 : 1,
              transform: t.exiting ? 'translateX(20px)' : 'translateX(0)',
              transition: `opacity ${EXIT_MS}ms ease, transform ${EXIT_MS}ms ease`,
            }}
          >
            <span style={{ color: c.icon, flexShrink: 0 }}>
              <Icon size={14} />
            </span>
            <span style={{ color: '#cccccc', fontSize: '12px', flex: 1, lineHeight: '1.4' }}>
              {t.message}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              style={{ color: '#858585', background: 'none', border: 'none', cursor: 'pointer', padding: '0', flexShrink: 0, display: 'flex', alignItems: 'center' }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
