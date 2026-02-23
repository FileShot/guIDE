import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, FolderOpen, File, Trash2, RefreshCw, Save, ChevronRight, ArrowLeft, Key } from 'lucide-react';
import type { SSHProfile, SSHFileItem } from '@/types/electron';

interface SSHPanelProps {
  onFileClick?: (content: string, name: string) => void;
}

export const SSHPanel: React.FC<SSHPanelProps> = ({ onFileClick }) => {
  const [tab, setTab] = useState<'connect' | 'browse' | 'terminal'>('connect');
  const [profiles, setProfiles] = useState<SSHProfile[]>([]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [connectedHost, setConnectedHost] = useState('');
  const [available, setAvailable] = useState(true);

  // Connection form
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [profileName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  // File browser
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<SSHFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);

  // Terminal
  const [command, setCommand] = useState('');
  const [termOutput, setTermOutput] = useState('');
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    api.sshAvailable().then(r => setAvailable(r.available));
    api.sshGetProfiles().then(r => { if (r.success && r.profiles) setProfiles(r.profiles); });
  }, []);

  const handleConnect = async (profile?: SSHProfile) => {
    setConnecting(true);
    setError('');
    const api = window.electronAPI;
    const params = profile
      ? { host: profile.host, port: profile.port || 22, username: profile.username, password: profile.password, privateKeyPath: profile.privateKeyPath, passphrase: profile.passphrase }
      : { host, port: parseInt(port) || 22, username, password, privateKeyPath: keyPath };

    const result = await api.sshConnect(params);
    setConnecting(false);
    if (result.success && result.connectionId) {
      setConnectionId(result.connectionId);
      setConnectedHost(`${params.username}@${params.host}`);
      setTab('browse');
      loadDir(result.connectionId, '/home/' + params.username);
    } else {
      setError(result.error || 'Connection failed');
    }
  };

  const handleDisconnect = async () => {
    if (connectionId) {
      await window.electronAPI.sshDisconnect(connectionId);
      setConnectionId(null);
      setConnectedHost('');
      setItems([]);
      setCurrentPath('/');
      setTab('connect');
    }
  };

  const loadDir = async (connId: string, dirPath: string) => {
    setLoading(true);
    const result = await window.electronAPI.sshListDir(connId, dirPath);
    setLoading(false);
    if (result.success && result.items) {
      setItems(result.items);
      setCurrentPath(dirPath);
    }
  };

  const navigateTo = (dirPath: string) => {
    if (!connectionId) return;
    setPathHistory(prev => [...prev, currentPath]);
    loadDir(connectionId, dirPath);
  };

  const goBack = () => {
    if (!connectionId || pathHistory.length === 0) return;
    const prev = pathHistory[pathHistory.length - 1];
    setPathHistory(h => h.slice(0, -1));
    loadDir(connectionId, prev);
  };

  const goUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  };

  const handleFileClick = async (item: SSHFileItem) => {
    if (!connectionId) return;
    if (item.type === 'directory') {
      navigateTo(currentPath === '/' ? '/' + item.name : currentPath + '/' + item.name);
    } else {
      const result = await window.electronAPI.sshReadFile(connectionId, currentPath + '/' + item.name);
      if (result.success && result.content) {
        onFileClick?.(result.content, item.name);
      }
    }
  };

  const handleSaveProfile = async () => {
    if (!host || !username) return;
    const result = await window.electronAPI.sshSaveProfile({
      name: profileName || `${username}@${host}`,
      host, port: parseInt(port) || 22, username, password, privateKeyPath: keyPath,
    });
    if (result.success && result.profiles) setProfiles(result.profiles);
  };

  const handleDeleteProfile = async (id: string) => {
    const result = await window.electronAPI.sshDeleteProfile(id);
    if (result.success && result.profiles) setProfiles(result.profiles);
  };

  const handleExec = async () => {
    if (!connectionId || !command.trim()) return;
    setExecuting(true);
    const result = await window.electronAPI.sshExec(connectionId, command);
    setExecuting(false);
    if (result.success) {
      setTermOutput(prev => prev + `$ ${command}\n${result.stdout || ''}${result.stderr ? '\n' + result.stderr : ''}\n`);
    } else {
      setTermOutput(prev => prev + `$ ${command}\nError: ${result.error}\n`);
    }
    setCommand('');
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (!available) {
    return (
      <div className="p-4 text-center">
        <WifiOff size={32} className="mx-auto mb-2 opacity-50" style={{ color: 'var(--theme-foreground-muted)' }} />
        <p className="text-[12px]" style={{ color: 'var(--theme-foreground-muted)' }}>SSH module not available. Install with: npm install ssh2</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Connection indicator */}
      {connectionId && (
        <div className="px-3 py-1.5 flex items-center justify-between" style={{ backgroundColor: 'var(--theme-selection)', borderBottom: '1px solid var(--theme-border)' }}>
          <span className="flex items-center gap-1.5">
            <Wifi size={12} className="text-green-400" /> {connectedHost}
          </span>
          <button onClick={handleDisconnect} className="text-[11px] px-2 py-0.5 rounded hover:opacity-80" style={{ backgroundColor: 'var(--theme-error, #f44336)', color: '#fff' }}>
            Disconnect
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--theme-border)' }}>
        {(['connect', 'browse', 'terminal'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className="flex-1 px-2 py-1.5 text-[11px] capitalize transition-colors"
            style={{ color: tab === t ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)', borderBottom: tab === t ? '2px solid var(--theme-accent)' : '2px solid transparent', backgroundColor: tab === t ? 'var(--theme-selection)' : 'transparent' }}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {/* Connect Tab */}
        {tab === 'connect' && (
          <div className="space-y-3">
            {/* Saved Profiles */}
            {profiles.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--theme-foreground-muted)' }}>Saved Profiles</div>
                {profiles.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-2 py-1.5 rounded mb-1 hover:opacity-90 cursor-pointer" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}>
                    <span onClick={() => handleConnect(p)} className="flex-1 truncate">{p.name || `${p.username}@${p.host}`}</span>
                    <button onClick={() => handleDeleteProfile(p.id)} className="opacity-50 hover:opacity-100 ml-1"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* New connection form */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold" style={{ color: 'var(--theme-foreground-muted)' }}>New Connection</div>
              <input placeholder="Host (e.g. 192.168.1.100)" value={host} onChange={e => setHost(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
              <div className="flex gap-2">
                <input placeholder="Port" value={port} onChange={e => setPort(e.target.value)} className="w-16 px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
              </div>
              <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
              <div className="flex items-center gap-1">
                <Key size={11} style={{ color: 'var(--theme-foreground-muted)' }} />
                <input placeholder="SSH Key Path (~/.ssh/id_rsa)" value={keyPath} onChange={e => setKeyPath(e.target.value)} className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleConnect()} disabled={connecting || !host || !username} className="flex-1 px-3 py-1.5 rounded text-[12px] font-medium disabled:opacity-50" style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}>
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
                <button onClick={handleSaveProfile} disabled={!host || !username} className="px-3 py-1.5 rounded text-[12px]" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)', color: 'var(--theme-foreground)' }} title="Save Profile">
                  <Save size={14} />
                </button>
              </div>
              {error && <div className="text-[11px] p-2 rounded" style={{ backgroundColor: 'rgba(255,0,0,0.1)', color: '#f44336' }}>{error}</div>}
            </div>
          </div>
        )}

        {/* Browse Tab */}
        {tab === 'browse' && (
          <div>
            {!connectionId ? (
              <p className="text-center py-8" style={{ color: 'var(--theme-foreground-muted)' }}>Connect to a server first</p>
            ) : (
              <>
                <div className="flex items-center gap-1 mb-2">
                  <button onClick={goBack} disabled={pathHistory.length === 0} className="p-1 rounded hover:opacity-80 disabled:opacity-30" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}><ArrowLeft size={12} /></button>
                  <button onClick={goUp} className="p-1 rounded hover:opacity-80" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}><ChevronRight size={12} /></button>
                  <div className="flex-1 px-2 py-1 rounded text-[11px] truncate font-mono" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)' }}>{currentPath}</div>
                  <button onClick={() => connectionId && loadDir(connectionId, currentPath)} className="p-1 rounded hover:opacity-80" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}><RefreshCw size={12} /></button>
                </div>
                {loading ? (
                  <div className="text-center py-4" style={{ color: 'var(--theme-foreground-muted)' }}>Loading...</div>
                ) : (
                  <div className="space-y-0.5">
                    {items.map((item, i) => (
                      <div key={i} onClick={() => handleFileClick(item)} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:opacity-90" style={{ backgroundColor: 'transparent' }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--theme-selection)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                        {item.type === 'directory' ? <FolderOpen size={14} className="text-yellow-500 flex-shrink-0" /> : <File size={14} className="flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }} />}
                        <span className="flex-1 truncate">{item.name}</span>
                        <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>{item.type === 'file' ? formatSize(item.size) : ''}</span>
                      </div>
                    ))}
                    {items.length === 0 && <p className="text-center py-4" style={{ color: 'var(--theme-foreground-muted)' }}>Empty directory</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Terminal Tab */}
        {tab === 'terminal' && (
          <div className="flex flex-col h-full">
            {!connectionId ? (
              <p className="text-center py-8" style={{ color: 'var(--theme-foreground-muted)' }}>Connect to a server first</p>
            ) : (
              <>
                <div className="flex-1 font-mono text-[11px] p-2 rounded mb-2 overflow-auto whitespace-pre-wrap min-h-[200px]" style={{ backgroundColor: '#0d1117', color: '#c9d1d9' }}>
                  {termOutput || 'Remote terminal ready. Type a command below.\n'}
                </div>
                <div className="flex gap-1">
                  <span className="py-1.5 text-[12px] font-mono" style={{ color: 'var(--theme-accent)' }}>$</span>
                  <input value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleExec(); }}
                    placeholder="Enter command..." disabled={executing} className="flex-1 px-2 py-1.5 rounded text-[12px] font-mono outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
