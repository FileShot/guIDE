import React, { useState, useEffect, useCallback } from 'react';
import {
  Server, Plus, Trash2, RefreshCw, ChevronDown, ChevronRight,
  Circle, AlertCircle, Wrench, Terminal, Globe, Sparkles, X,
} from 'lucide-react';

interface MCPServer {
  id: string;
  name: string;
  type: 'built-in' | 'stdio' | 'sse';
  status: 'running' | 'stopped' | 'starting' | 'error';
  toolCount: number;
  tools: { name: string; description: string }[];
  command?: string;
  url?: string;
  error?: string | null;
}

export const MCPServerPanel: React.FC = () => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set(['built-in']));
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'stdio' | 'sse'>('stdio');
  const [newCommand, setNewCommand] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const loadServers = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.mcpListServers) return;
    try {
      const result = await api.mcpListServers();
      setServers(result || []);
    } catch (e) {
      console.error('Failed to load MCP servers:', e);
    }
  }, []);

  useEffect(() => {
    loadServers();
    const api = window.electronAPI;
    if (api?.onMcpServerStatus) {
      api.onMcpServerStatus(() => loadServers());
    }
  }, [loadServers]);

  const toggleServer = (id: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    const api = window.electronAPI;
    if (!api?.mcpAddServer || !newName.trim()) return;
    setLoading(true);
    try {
      await api.mcpAddServer({
        name: newName.trim(),
        type: newType,
        command: newType === 'stdio' ? newCommand.trim() : undefined,
        url: newType === 'sse' ? newUrl.trim() : undefined,
      });
      setShowAddForm(false);
      setNewName('');
      setNewCommand('');
      setNewUrl('');
      await loadServers();
    } catch (e) {
      console.error('Failed to add server:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    const api = window.electronAPI;
    if (!api?.mcpRemoveServer) return;
    await api.mcpRemoveServer(id);
    await loadServers();
  };

  const handleRestart = async (id: string) => {
    const api = window.electronAPI;
    if (!api?.mcpRestartServer) return;
    await api.mcpRestartServer(id);
    await loadServers();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-400';
      case 'starting': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-[#858585]';
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Circle size={8} className="fill-green-400 text-green-400" />;
      case 'starting': return <RefreshCw size={10} className="text-yellow-400 animate-spin" />;
      case 'error': return <AlertCircle size={10} className="text-red-400" />;
      default: return <Circle size={8} className="text-[#858585]" />;
    }
  };

  return (
    <div className="flex flex-col h-full text-[13px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2d2e]">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-[#858585]" />
          <span className="text-[#cccccc] font-medium">MCP Servers</span>
          <span className="text-[10px] text-[#858585] bg-[#3c3c3c] px-1.5 rounded-full">{servers.length}</span>
        </div>
        <button
          className="p-1 rounded hover:bg-[#3c3c3c] text-[#858585] hover:text-white"
          onClick={() => setShowAddForm(!showAddForm)}
          title="Add External MCP Server"
        >
          {showAddForm ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {/* Add Server Form */}
      {showAddForm && (
        <div className="px-3 py-2 border-b border-[#2a2d2e] bg-[#1e1e1e] flex flex-col gap-2">
          <input
            className="bg-[#3c3c3c] text-[#cccccc] text-[12px] px-2 py-1 rounded outline-none border border-[#3c3c3c] focus:border-[#007acc]"
            placeholder="Server name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className={`flex-1 px-2 py-1 rounded text-[11px] ${newType === 'stdio' ? 'bg-[#007acc] text-white' : 'bg-[#3c3c3c] text-[#858585] hover:text-white'}`}
              onClick={() => setNewType('stdio')}
            >
              <Terminal size={10} className="inline mr-1" />stdio
            </button>
            <button
              className={`flex-1 px-2 py-1 rounded text-[11px] ${newType === 'sse' ? 'bg-[#007acc] text-white' : 'bg-[#3c3c3c] text-[#858585] hover:text-white'}`}
              onClick={() => setNewType('sse')}
            >
              <Globe size={10} className="inline mr-1" />SSE
            </button>
          </div>
          {newType === 'stdio' ? (
            <input
              className="bg-[#3c3c3c] text-[#cccccc] text-[12px] px-2 py-1 rounded outline-none border border-[#3c3c3c] focus:border-[#007acc]"
              placeholder="Command (e.g. npx -y @modelcontextprotocol/server-fs)"
              value={newCommand}
              onChange={e => setNewCommand(e.target.value)}
            />
          ) : (
            <input
              className="bg-[#3c3c3c] text-[#cccccc] text-[12px] px-2 py-1 rounded outline-none border border-[#3c3c3c] focus:border-[#007acc]"
              placeholder="Server URL (e.g. http://localhost:3001/sse)"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
            />
          )}
          <button
            className="bg-[#007acc] text-white text-[12px] px-3 py-1 rounded hover:bg-[#0062a3] disabled:opacity-50"
            onClick={handleAdd}
            disabled={loading || !newName.trim() || (newType === 'stdio' ? !newCommand.trim() : !newUrl.trim())}
          >
            {loading ? 'Adding...' : 'Add Server'}
          </button>
        </div>
      )}

      {/* Server List */}
      <div className="flex-1 overflow-auto">
        {servers.map(server => (
          <div key={server.id} className="border-b border-[#2a2d2e]">
            {/* Server header */}
            <div
              className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-[#2a2d2e]"
              onClick={() => toggleServer(server.id)}
            >
              {expandedServers.has(server.id)
                ? <ChevronDown size={14} className="text-[#858585] flex-shrink-0" />
                : <ChevronRight size={14} className="text-[#858585] flex-shrink-0" />
              }
              {statusIcon(server.status)}
              {server.type === 'built-in'
                ? <Sparkles size={13} className="text-[#7c3aed] flex-shrink-0" />
                : server.type === 'stdio'
                ? <Terminal size={13} className="text-[#858585] flex-shrink-0" />
                : <Globe size={13} className="text-[#858585] flex-shrink-0" />
              }
              <span className="truncate text-[#cccccc] flex-1">{server.name}</span>
              <span className={`text-[10px] ${statusColor(server.status)} flex-shrink-0`}>{server.status}</span>
              <span className="text-[10px] text-[#858585] bg-[#3c3c3c] px-1 rounded-full flex-shrink-0 ml-1">{server.toolCount}</span>

              {server.type !== 'built-in' && (
                <div className="flex items-center gap-0.5 ml-1 flex-shrink-0">
                  <button
                    className="p-0.5 rounded hover:bg-[#3c3c3c] text-[#858585] hover:text-white"
                    onClick={e => { e.stopPropagation(); handleRestart(server.id); }}
                    title="Restart"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    className="p-0.5 rounded hover:bg-[#3c3c3c] text-[#858585] hover:text-red-400"
                    onClick={e => { e.stopPropagation(); handleRemove(server.id); }}
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Server details */}
            {expandedServers.has(server.id) && (
              <div className="pl-[28px] pr-2 pb-2">
                {/* Connection info */}
                {server.command && (
                  <div className="text-[11px] text-[#858585] mb-1 font-mono truncate" title={server.command}>
                    $ {server.command}
                  </div>
                )}
                {server.url && (
                  <div className="text-[11px] text-[#858585] mb-1 font-mono truncate" title={server.url}>
                    {server.url}
                  </div>
                )}
                {server.error && (
                  <div className="text-[11px] text-red-400 mb-1">
                    <AlertCircle size={10} className="inline mr-1" />
                    {server.error}
                  </div>
                )}

                {/* Tools list */}
                {server.tools.length > 0 && (
                  <div className="mt-1">
                    <div className="text-[10px] text-[#858585] uppercase tracking-wider mb-0.5">Tools</div>
                    <div className="flex flex-col gap-0.5 max-h-[200px] overflow-auto">
                      {server.tools.map(tool => (
                        <div
                          key={tool.name}
                          className="flex items-start gap-1.5 py-0.5 px-1 rounded hover:bg-[#3c3c3c]"
                          title={tool.description}
                        >
                          <Wrench size={10} className="text-[#858585] mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[11px] text-[#cccccc] font-mono truncate">{tool.name}</div>
                            <div className="text-[10px] text-[#858585] truncate">{tool.description}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {servers.length === 0 && (
          <div className="px-4 py-6 text-center text-[#858585] text-[12px]">
            <Server size={24} className="mx-auto mb-2 opacity-50" />
            No MCP servers configured
          </div>
        )}
      </div>
    </div>
  );
};
