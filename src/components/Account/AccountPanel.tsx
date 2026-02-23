import React, { useState, useEffect, useCallback } from 'react';
import { UserCircle, Check, Shield, ExternalLink, LogOut, Key, Mail, Github } from 'lucide-react';
import type { LicenseStatus } from '@/types/electron';

export const AccountPanel: React.FC = () => {
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [tab, setTab] = useState<'signin' | 'key'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI?.licenseGetStatus?.();
      if (status) setLicenseStatus(status);
    } catch (_) {}
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const showMessage = (msg: string, duration = 4000) => {
    setMessage(msg);
    if (duration > 0) setTimeout(() => setMessage(''), duration);
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setLoading(true);
    showMessage(`Opening ${provider === 'google' ? 'Google' : 'GitHub'} sign-in...`, 0);
    try {
      const result = await window.electronAPI?.licenseOAuthSignIn?.(provider);
      if (result?.success) {
        setLicenseStatus({ isActivated: true, isAuthenticated: true, license: result.license, machineId: licenseStatus?.machineId || '' });
        showMessage('✓ Signed in!');
      } else if (result?.authenticated && result?.email) {
        setLicenseStatus({
          isActivated: false, isAuthenticated: true,
          license: { key: null, activatedAt: null, lastValidated: null, email: result.email, plan: 'free', expiresAt: null, authMethod: 'oauth' },
          machineId: licenseStatus?.machineId || '',
        });
        showMessage('✓ Signed in!');
      } else {
        showMessage(result?.error || 'Sign-in failed');
      }
    } catch (e: any) {
      showMessage(e.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    showMessage('Signing in...', 0);
    try {
      const result = await window.electronAPI?.licenseActivateWithAccount?.(email.trim(), password);
      if (result?.success) {
        setLicenseStatus({ isActivated: true, isAuthenticated: true, license: result.license, machineId: licenseStatus?.machineId || '' });
        setEmail('');
        setPassword('');
        showMessage('✓ Signed in!');
      } else {
        showMessage(result?.error || 'Sign in failed');
      }
    } catch (e: any) {
      showMessage(e.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyActivation = async () => {
    if (!licenseKey.trim()) return;
    setLoading(true);
    showMessage('Activating...', 0);
    try {
      const result = await window.electronAPI?.licenseActivate?.(licenseKey.trim());
      if (result?.success) {
        setLicenseStatus({ isActivated: true, isAuthenticated: true, license: result.license, machineId: licenseStatus?.machineId || '' });
        setLicenseKey('');
        showMessage('✓ Activated!');
      } else {
        showMessage(result?.error || 'Activation failed');
      }
    } catch (e: any) {
      showMessage(e.message || 'Activation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    try {
      await window.electronAPI?.licenseDeactivate?.();
      setLicenseStatus({ isActivated: false, isAuthenticated: false, license: null, machineId: licenseStatus?.machineId || '' });
      showMessage('Signed out');
    } catch (e: any) {
      showMessage(e.message || 'Sign out failed');
    }
  };

  // ── Signed in state ──
  if (licenseStatus?.isActivated) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-accent)', opacity: 0.9 }}>
            <UserCircle size={24} style={{ color: 'var(--theme-foreground)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium truncate" style={{ color: 'var(--theme-foreground)' }}>
              {licenseStatus.license?.email || 'Licensed User'}
            </p>
            <div className="flex items-center gap-1">
              <Check size={10} className="text-[#4ec9b0]" />
              <span className="text-[10px] text-[#4ec9b0]">License Active</span>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
          {licenseStatus.license?.plan && (
            <div className="flex justify-between">
              <span>Plan</span>
              <span className="capitalize" style={{ color: 'var(--theme-foreground)' }}>{licenseStatus.license.plan}</span>
            </div>
          )}
          {licenseStatus.license?.key && (
            <div className="flex justify-between">
              <span>Key</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--theme-foreground)' }}>{licenseStatus.license.key}</span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--theme-sidebar-border)' }}>
          <button
            onClick={() => window.electronAPI?.openExternal?.('https://graysoft.dev/account')}
            className="flex items-center gap-2 w-full px-3 py-2 text-[11px] rounded transition-colors hover:opacity-80"
            style={{ backgroundColor: 'var(--theme-activity-bar-active)', color: 'var(--theme-foreground)' }}
          >
            <ExternalLink size={12} /> Manage Account
          </button>
        </div>

        <div className="mt-auto pt-4">
          <button
            onClick={handleDeactivate}
            className="flex items-center gap-2 text-[10px] text-[#f44747] hover:text-[#ff6b6b] transition-colors cursor-pointer"
          >
            <LogOut size={10} /> Sign Out
          </button>
        </div>

        {message && (
          <p className={`text-[10px] mt-2 ${message.includes('✓') ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>{message}</p>
        )}
      </div>
    );
  }

  // ── Authenticated but no license (free user) ──
  if (licenseStatus?.isAuthenticated && !licenseStatus?.isActivated) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-accent)', opacity: 0.9 }}>
            <UserCircle size={24} style={{ color: 'var(--theme-foreground)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium truncate" style={{ color: 'var(--theme-foreground)' }}>
              {licenseStatus.license?.email || 'Signed In'}
            </p>
            <div className="flex items-center gap-1">
              <Shield size={10} style={{ color: 'var(--theme-foreground-muted)' }} />
              <span className="text-[10px] capitalize" style={{ color: 'var(--theme-foreground-muted)' }}>
                {licenseStatus.license?.plan || 'Free'} Plan
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-[11px] mb-4" style={{ color: 'var(--theme-foreground-muted)' }}>
          <div className="flex justify-between">
            <span>Status</span>
            <span className="text-[#4ec9b0]" style={{ color: 'var(--theme-foreground)' }}>Signed In</span>
          </div>
          <div className="flex justify-between">
            <span>Local AI</span>
            <span className="text-[#4ec9b0]">✓ Included</span>
          </div>
          <div className="flex justify-between">
            <span>Cloud AI</span>
            <span style={{ color: 'var(--theme-foreground-muted)' }}>Upgrade to unlock</span>
          </div>
        </div>

        <div className="p-3 rounded-md mb-3" style={{ backgroundColor: 'var(--theme-activity-bar)', border: '1px solid var(--theme-sidebar-border)' }}>
          <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--theme-foreground)' }}>
            Upgrade to Pro
          </p>
          <p className="text-[10px] mb-2" style={{ color: 'var(--theme-foreground-muted)' }}>
            Cloud AI models, web automation, unlimited conversations. $4.99/mo.
          </p>
          <button
            onClick={() => window.electronAPI?.openExternal?.('https://graysoft.dev/account')}
            className="w-full px-3 py-2 text-[11px] font-medium rounded transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
          >
            Get Pro →
          </button>
        </div>

        <div className="pt-2" style={{ borderTop: '1px solid var(--theme-sidebar-border)' }}>
          <button
            onClick={() => window.electronAPI?.openExternal?.('https://graysoft.dev/account')}
            className="flex items-center gap-2 w-full px-3 py-2 text-[11px] rounded transition-colors hover:opacity-80"
            style={{ backgroundColor: 'var(--theme-activity-bar-active)', color: 'var(--theme-foreground)' }}
          >
            <ExternalLink size={12} /> Manage Account
          </button>
        </div>

        <div className="mt-auto pt-4">
          <button
            onClick={handleDeactivate}
            className="flex items-center gap-2 text-[10px] text-[#f44747] hover:text-[#ff6b6b] transition-colors cursor-pointer"
          >
            <LogOut size={10} /> Sign Out
          </button>
        </div>

        {message && (
          <p className={`text-[10px] mt-2 ${message.includes('✓') ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>{message}</p>
        )}
      </div>
    );
  }

  // ── Sign in state ──
  return (
    <div className="flex flex-col h-full p-4">
      {/* Header */}
      <div className="text-center mb-5">
        <UserCircle size={36} className="mx-auto mb-2" style={{ color: 'var(--theme-foreground-muted)' }} />
        <p className="text-[12px] font-medium" style={{ color: 'var(--theme-foreground)' }}>Sign in to guIDE</p>
        <p className="text-[10px] mt-1" style={{ color: 'var(--theme-foreground-muted)' }}>
          Activate your license to unlock AI features
        </p>
      </div>

      {/* OAuth Buttons */}
      <div className="space-y-2 mb-3">
        <button
          onClick={() => handleOAuth('google')}
          disabled={loading}
          className="flex items-center justify-center gap-2 w-full px-3 py-2.5 text-[11px] font-medium rounded transition-all disabled:opacity-50"
          style={{ backgroundColor: 'var(--theme-activity-bar-active)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-sidebar-border)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>
        <button
          onClick={() => handleOAuth('github')}
          disabled={loading}
          className="flex items-center justify-center gap-2 w-full px-3 py-2.5 text-[11px] font-medium rounded transition-all disabled:opacity-50"
          style={{ backgroundColor: 'var(--theme-activity-bar-active)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-sidebar-border)' }}
        >
          <Github size={14} />
          Continue with GitHub
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2 my-2">
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--theme-sidebar-border)' }} />
        <span className="text-[9px] uppercase" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.5 }}>or</span>
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--theme-sidebar-border)' }} />
      </div>

      {/* Tab selector: Sign In / License Key */}
      <div className="flex rounded overflow-hidden mb-2" style={{ border: '1px solid var(--theme-sidebar-border)' }}>
        <button
          onClick={() => setTab('signin')}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium transition-colors"
          style={{
            backgroundColor: tab === 'signin' ? 'var(--theme-accent)' : 'transparent',
            color: tab === 'signin' ? '#fff' : 'var(--theme-foreground-muted)',
          }}
        >
          <Mail size={10} /> Email
        </button>
        <button
          onClick={() => setTab('key')}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium transition-colors"
          style={{
            backgroundColor: tab === 'key' ? 'var(--theme-accent)' : 'transparent',
            color: tab === 'key' ? '#fff' : 'var(--theme-foreground-muted)',
          }}
        >
          <Key size={10} /> License Key
        </button>
      </div>

      {tab === 'signin' ? (
        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded px-2.5 py-2 text-[11px] outline-none transition-colors"
            style={{ backgroundColor: 'var(--theme-activity-bar)', border: '1px solid var(--theme-sidebar-border)', color: 'var(--theme-foreground)' }}
            spellCheck={false}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded px-2.5 py-2 text-[11px] outline-none transition-colors"
            style={{ backgroundColor: 'var(--theme-activity-bar)', border: '1px solid var(--theme-sidebar-border)', color: 'var(--theme-foreground)' }}
            onKeyDown={(e) => e.key === 'Enter' && handleEmailSignIn()}
          />
          <button
            onClick={handleEmailSignIn}
            disabled={loading || !email.trim() || !password}
            className="w-full px-3 py-2 text-[11px] font-medium rounded transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
            placeholder="GUIDE-XXXX-XXXX-XXXX-XXXX"
            className="w-full rounded px-2.5 py-2 text-[11px] font-mono outline-none transition-colors"
            style={{ backgroundColor: 'var(--theme-activity-bar)', border: '1px solid var(--theme-sidebar-border)', color: 'var(--theme-foreground)' }}
            spellCheck={false}
            onKeyDown={(e) => e.key === 'Enter' && handleKeyActivation()}
          />
          <button
            onClick={handleKeyActivation}
            disabled={loading || !licenseKey.trim()}
            className="w-full px-3 py-2 text-[11px] font-medium rounded transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
          >
            {loading ? 'Activating...' : 'Activate'}
          </button>
        </div>
      )}

      {/* Message */}
      {message && (
        <p className={`text-[10px] mt-2 ${message.includes('✓') ? 'text-[#4ec9b0]' : message.includes('...') ? 'text-[#858585]' : 'text-[#f44747]'}`}>
          {message}
        </p>
      )}

      {/* Get a license link */}
      <div className="mt-auto pt-4">
        <button
          onClick={() => window.electronAPI?.openExternal?.('https://graysoft.dev/register')}
          className="text-[10px] transition-colors hover:underline"
          style={{ color: 'var(--theme-accent)' }}
        >
          Don't have an account? Create one →
        </button>
        <p className="text-[9px] mt-1.5" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.5 }}>
          Free plan includes local AI. Pro $4.99/mo for cloud AI.
        </p>
      </div>
    </div>
  );
};
