import React, { useState, useEffect, useRef } from 'react';
import { Share2, Copy, Send, Wifi, WifiOff, UserPlus } from 'lucide-react';
import type { CollabPeer, CollabEvent } from '@/types/electron';

interface CollabPanelProps {
  currentFile?: string;
  currentContent?: string;
}

export const CollabPanel: React.FC<CollabPanelProps> = ({ currentFile, currentContent }) => {
  const [tab, setTab] = useState<'session' | 'chat'>('session');
  const [role, setRole] = useState<'host' | 'client' | null>(null);
  const [available, setAvailable] = useState(true);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [messages, setMessages] = useState<{ username: string; message: string; time: string; color?: string }[]>([]);
  const [sessionInfo, setSessionInfo] = useState<any>(null);

  // Host form
  const [username, setUsername] = useState('Host');
  const [hosting, setHosting] = useState(false);

  // Join form
  const [joinHost, setJoinHost] = useState('');
  const [joinPort, setJoinPort] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinUsername, setJoinUsername] = useState('Guest');
  const [joining, setJoining] = useState(false);

  // Chat
  const [chatMsg, setChatMsg] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [error, setError] = useState('');

  useEffect(() => {
    const api = window.electronAPI;
    api.collabAvailable().then(r => setAvailable(r.available));
    api.collabGetSession().then(r => {
      if (r.success && r.role) {
        setRole(r.role);
        if (r.peers) setPeers(r.peers);
        if (r.session) setSessionInfo(r.session);
      }
    });

    const cleanup = api.onCollabEvent((event: CollabEvent) => {
      switch (event.type) {
        case 'peer-joined':
          if (event.peerId && event.username && event.color) {
            setPeers(prev => [...prev.filter(p => p.id !== event.peerId), { id: event.peerId!, username: event.username!, color: event.color!, cursor: { line: 1, column: 1 } }]);
          }
          break;
        case 'peer-left':
          setPeers(prev => prev.filter(p => p.id !== event.peerId));
          break;
        case 'cursor':
          if (event.peerId && event.cursor) {
            setPeers(prev => prev.map(p => p.id === event.peerId ? { ...p, cursor: event.cursor! } : p));
          }
          break;
        case 'chat':
          if (event.username && event.message) {
            setMessages(prev => [...prev, {
              username: event.username!,
              message: event.message!,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              color: peers.find(p => p.username === event.username)?.color,
            }]);
          }
          break;
        case 'disconnected':
          setRole(null);
          setPeers([]);
          setSessionInfo(null);
          break;
      }
    });

    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleHost = async () => {
    setHosting(true);
    setError('');
    const result = await window.electronAPI.collabHost({
      filePath: currentFile,
      content: currentContent || '',
      username,
    });
    setHosting(false);
    if (result.success) {
      setRole('host');
      setSessionInfo(result);
    } else {
      setError(result.error || 'Failed to start');
    }
  };

  const handleStopHost = async () => {
    await window.electronAPI.collabStopHost();
    setRole(null);
    setPeers([]);
    setSessionInfo(null);
  };

  const handleJoin = async () => {
    setJoining(true);
    setError('');
    const result = await window.electronAPI.collabJoin({
      host: joinHost,
      port: parseInt(joinPort),
      password: joinPassword,
      username: joinUsername,
    });
    setJoining(false);
    if (result.success) {
      setRole('client');
      if (result.peers) setPeers(result.peers);
    } else {
      setError(result.error || 'Failed to join');
    }
  };

  const handleLeave = async () => {
    await window.electronAPI.collabLeave();
    setRole(null);
    setPeers([]);
    setSessionInfo(null);
  };

  const handleSendChat = async () => {
    if (!chatMsg.trim()) return;
    await window.electronAPI.collabSendChat(chatMsg);
    setChatMsg('');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!available) {
    return (
      <div className="p-4 text-center">
        <WifiOff size={32} className="mx-auto mb-2 opacity-50" style={{ color: 'var(--theme-foreground-muted)' }} />
        <p className="text-[12px]" style={{ color: 'var(--theme-foreground-muted)' }}>WebSocket module not available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Status bar */}
      {role && (
        <div className="px-3 py-1.5 flex items-center justify-between" style={{ backgroundColor: role === 'host' ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)', borderBottom: '1px solid var(--theme-border)' }}>
          <span className="flex items-center gap-1.5 text-[11px]">
            <Wifi size={12} className={role === 'host' ? 'text-green-400' : 'text-blue-400'} />
            {role === 'host' ? 'Hosting' : 'Connected'} · {peers.length} peer{peers.length !== 1 ? 's' : ''}
          </span>
          <button onClick={role === 'host' ? handleStopHost : handleLeave} className="text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-error, #f44336)', color: '#fff' }}>
            {role === 'host' ? 'Stop' : 'Leave'}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--theme-border)' }}>
        <button onClick={() => setTab('session')} className="flex-1 px-2 py-1.5 text-[11px] transition-colors"
          style={{ color: tab === 'session' ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)', borderBottom: tab === 'session' ? '2px solid var(--theme-accent)' : '2px solid transparent' }}>
          Session
        </button>
        <button onClick={() => setTab('chat')} className="flex-1 px-2 py-1.5 text-[11px] transition-colors relative"
          style={{ color: tab === 'chat' ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)', borderBottom: tab === 'chat' ? '2px solid var(--theme-accent)' : '2px solid transparent' }}>
          Chat {messages.length > 0 && <span className="ml-1 px-1 rounded-full text-[9px] bg-blue-500 text-white">{messages.length}</span>}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {/* Session Tab */}
        {tab === 'session' && (
          <div className="space-y-3">
            {/* Not in session */}
            {!role && (
              <>
                {/* Host section */}
                <div className="p-3 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)', border: '1px solid var(--theme-border)' }}>
                  <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--theme-foreground-muted)' }}>Host a Session</div>
                  <input placeholder="Your name" value={username} onChange={e => setUsername(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px] outline-none mb-2" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                  <button onClick={handleHost} disabled={hosting} className="w-full px-3 py-1.5 rounded text-[12px] font-medium disabled:opacity-50" style={{ backgroundColor: '#22c55e', color: '#fff' }}>
                    <Share2 size={12} className="inline mr-1.5" />{hosting ? 'Starting...' : 'Start Session'}
                  </button>
                </div>

                {/* Join section */}
                <div className="p-3 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)', border: '1px solid var(--theme-border)' }}>
                  <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--theme-foreground-muted)' }}>Join a Session</div>
                  <input placeholder="Your name" value={joinUsername} onChange={e => setJoinUsername(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px] outline-none mb-1.5" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                  <div className="flex gap-1.5 mb-1.5">
                    <input placeholder="Host IP" value={joinHost} onChange={e => setJoinHost(e.target.value)} className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                    <input placeholder="Port" value={joinPort} onChange={e => setJoinPort(e.target.value)} className="w-16 px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                  </div>
                  <input placeholder="Password" value={joinPassword} onChange={e => setJoinPassword(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px] outline-none mb-2" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                  <button onClick={handleJoin} disabled={joining || !joinHost || !joinPort || !joinPassword} className="w-full px-3 py-1.5 rounded text-[12px] font-medium disabled:opacity-50" style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}>
                    <UserPlus size={12} className="inline mr-1.5" />{joining ? 'Joining...' : 'Join Session'}
                  </button>
                </div>

                {error && <div className="text-[11px] p-2 rounded" style={{ backgroundColor: 'rgba(255,0,0,0.1)', color: '#f44336' }}>{error}</div>}
              </>
            )}

            {/* Active session info */}
            {role === 'host' && sessionInfo && (
              <div className="space-y-3">
                <div className="p-3 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)', border: '1px solid var(--theme-border)' }}>
                  <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--theme-foreground-muted)' }}>Share These Details</div>
                  <div className="space-y-1.5">
                    {sessionInfo.localIPs?.map((ip: string) => (
                      <div key={ip} className="flex items-center justify-between px-2 py-1 rounded" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)' }}>
                        <span className="font-mono text-[11px]">{ip}:{sessionInfo.port}</span>
                        <button onClick={() => copyToClipboard(`${ip}:${sessionInfo.port}`)} className="opacity-50 hover:opacity-100"><Copy size={11} /></button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-2 py-1 rounded" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)' }}>
                      <span className="font-mono text-[11px]">Password: {sessionInfo.password}</span>
                      <button onClick={() => copyToClipboard(sessionInfo.password)} className="opacity-50 hover:opacity-100"><Copy size={11} /></button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Peers list */}
            {role && peers.length > 0 && (
              <div className="p-3 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)', border: '1px solid var(--theme-border)' }}>
                <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--theme-foreground-muted)' }}>Connected Peers</div>
                {peers.map(peer => (
                  <div key={peer.id} className="flex items-center gap-2 px-2 py-1.5 rounded mb-1" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)' }}>
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: peer.color }} />
                    <span className="flex-1">{peer.username}</span>
                    {peer.cursor && <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>Ln {peer.cursor.line}, Col {peer.cursor.column}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chat Tab */}
        {tab === 'chat' && (
          <div className="flex flex-col h-full">
            {!role ? (
              <p className="text-center py-8" style={{ color: 'var(--theme-foreground-muted)' }}>Join or host a session to chat</p>
            ) : (
              <>
                <div className="flex-1 overflow-auto space-y-2 mb-2 min-h-[200px]">
                  {messages.length === 0 && <p className="text-center py-4 text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>No messages yet</p>}
                  {messages.map((msg, i) => (
                    <div key={i} className="px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium" style={{ color: msg.color || 'var(--theme-accent)' }}>{msg.username}</span>
                        <span className="text-[9px]" style={{ color: 'var(--theme-foreground-muted)' }}>{msg.time}</span>
                      </div>
                      <p className="text-[12px] mt-0.5">{msg.message}</p>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex gap-1">
                  <input value={chatMsg} onChange={e => setChatMsg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSendChat(); }}
                    placeholder="Type a message..." className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
                  <button onClick={handleSendChat} className="px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}><Send size={14} /></button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
