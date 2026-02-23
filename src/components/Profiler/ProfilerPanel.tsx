import React, { useState, useCallback } from 'react';
import { Play, Clock, Cpu, Zap, AlertTriangle, Activity, Square } from 'lucide-react';

interface ProfileEntry {
  function: string;
  file: string;
  line: number;
  calls: number;
  totalTime: number;
  cumTime: number;
}

interface TimingRun {
  iteration: number;
  duration: number;
  exitCode: number;
}

type TabId = 'profile' | 'timing' | 'memory';

export const ProfilerPanel: React.FC<{ rootPath: string; currentFile: string }> = ({ rootPath, currentFile }) => {
  const [tab, setTab] = useState<TabId>('profile');
  const [scriptPath, setScriptPath] = useState('');
  const [command, setCommand] = useState('');
  const [iterations, setIterations] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [profileResult, setProfileResult] = useState<any>(null);
  const [timingResult, setTimingResult] = useState<any>(null);
  const [memoryResult, setMemoryResult] = useState<any>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [error, setError] = useState('');

  const api = (window as any).electronAPI;

  // Auto-fill with current file
  const handleUseCurrentFile = useCallback(() => {
    if (currentFile) setScriptPath(currentFile);
  }, [currentFile]);

  const runProfile = useCallback(async () => {
    if (!scriptPath.trim()) return;
    setIsRunning(true);
    setError('');
    setProfileResult(null);
    setAiAnalysis(null);
    try {
      const isPython = scriptPath.endsWith('.py') || scriptPath.endsWith('.pyw');
      const result = isPython
        ? await api.profilerRunPython({ scriptPath, cwd: rootPath })
        : await api.profilerRunNode({ scriptPath, cwd: rootPath });

      if (result.success) {
        setProfileResult(result);
      } else {
        setError(result.error || 'Profiling failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsRunning(false);
    }
  }, [scriptPath, rootPath, api]);

  const runTiming = useCallback(async () => {
    if (!command.trim()) return;
    setIsRunning(true);
    setError('');
    setTimingResult(null);
    try {
      const result = await api.profilerTimeCommand({ command, cwd: rootPath, iterations });
      if (result.success) {
        setTimingResult(result);
      } else {
        setError(result.error || 'Timing failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsRunning(false);
    }
  }, [command, rootPath, iterations, api]);

  const getMemorySnapshot = useCallback(async () => {
    setIsRunning(true);
    setError('');
    try {
      const result = await api.profilerMemorySnapshot();
      if (result.success) {
        setMemoryResult(result);
      } else {
        setError(result.error || 'Memory snapshot failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsRunning(false);
    }
  }, [api]);

  const runAiAnalysis = useCallback(async () => {
    if (!profileResult?.profile) return;
    setIsRunning(true);
    try {
      const result = await api.profilerAiAnalyze({
        profileData: profileResult.profile,
        scriptPath: profileResult.scriptPath,
      });
      if (result.success) {
        setAiAnalysis(result.analysis || result.rawAnalysis);
      }
    } catch { /* ignore */ }
    finally { setIsRunning(false); }
  }, [profileResult, api]);

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'profile', label: 'Profile', icon: Activity },
    { id: 'timing', label: 'Timing', icon: Clock },
    { id: 'memory', label: 'Memory', icon: Cpu },
  ];

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: 'var(--theme-sidebar-border)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] transition-colors"
            style={{
              color: tab === t.id ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)',
              borderBottom: tab === t.id ? '2px solid var(--theme-accent)' : '2px solid transparent',
            }}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Error display */}
        {error && (
          <div className="p-2 rounded text-[11px] flex items-center gap-2" style={{ backgroundColor: 'rgba(255,80,80,0.15)', color: '#ff5050' }}>
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        {/* ── Profile Tab ── */}
        {tab === 'profile' && (
          <>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--theme-foreground-muted)' }}>Script to Profile</label>
              <div className="flex gap-1">
                <input
                  className="flex-1 text-[12px] p-1.5 rounded border outline-none"
                  style={{ backgroundColor: 'var(--theme-input-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-foreground)' }}
                  placeholder="path/to/script.js or .py"
                  value={scriptPath}
                  onChange={e => setScriptPath(e.target.value)}
                />
                {currentFile && (
                  <button
                    className="px-2 text-[10px] rounded"
                    style={{ backgroundColor: 'var(--theme-button-bg)', color: 'var(--theme-button-fg)' }}
                    onClick={handleUseCurrentFile}
                    title="Use current file"
                  >
                    Current
                  </button>
                )}
              </div>
            </div>
            <button
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded text-[12px] transition-colors"
              style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
              onClick={runProfile}
              disabled={isRunning || !scriptPath.trim()}
            >
              {isRunning ? <><Square size={12} /> Profiling...</> : <><Play size={12} /> Run Profiler</>}
            </button>

            {/* Profile Results */}
            {profileResult && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>Duration</div>
                    <div className="text-[14px] font-bold" style={{ color: 'var(--theme-accent)' }}>
                      {typeof profileResult.duration === 'number' ? `${Math.round(profileResult.duration)}ms` : 'N/A'}
                    </div>
                  </div>
                  <div className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>Exit Code</div>
                    <div className="text-[14px] font-bold" style={{ color: profileResult.exitCode === 0 ? '#4ec9b0' : '#ff5050' }}>
                      {profileResult.exitCode ?? 'N/A'}
                    </div>
                  </div>
                  <div className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>Runtime</div>
                    <div className="text-[14px] font-bold">{profileResult.runtime || 'node'}</div>
                  </div>
                </div>

                {/* Hot Functions */}
                {profileResult.profile?.entries && (
                  <div>
                    <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--theme-foreground-muted)' }}>Hot Functions (by cumulative time)</div>
                    <div className="space-y-1 max-h-[300px] overflow-auto">
                      {profileResult.profile.entries.slice(0, 20).map((entry: ProfileEntry, i: number) => (
                        <div key={i} className="p-1.5 rounded flex items-start gap-2" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                          <span className="text-[10px] font-mono w-[18px] flex-shrink-0" style={{ color: i < 3 ? '#ff5050' : 'var(--theme-foreground-muted)' }}>
                            #{i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="font-mono truncate" style={{ color: '#4fc1ff' }}>{entry.function}</div>
                            <div className="text-[10px] truncate" style={{ color: 'var(--theme-foreground-muted)' }}>
                              {entry.file}:{entry.line} — {entry.calls} calls
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="font-mono" style={{ color: entry.cumTime > 0.1 ? '#ff5050' : '#4ec9b0' }}>
                              {entry.cumTime.toFixed(4)}s
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                              {entry.totalTime.toFixed(4)}s self
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stdout/Stderr */}
                {profileResult.stdout && (
                  <div>
                    <div className="text-[10px] mb-1" style={{ color: 'var(--theme-foreground-muted)' }}>Output</div>
                    <pre className="text-[10px] font-mono p-2 rounded max-h-[100px] overflow-auto" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>{profileResult.stdout}</pre>
                  </div>
                )}

                {/* AI Analysis button */}
                {profileResult.profile && (
                  <button
                    className="w-full flex items-center justify-center gap-2 py-1.5 rounded text-[11px]"
                    style={{ backgroundColor: 'rgba(78,201,176,0.15)', color: '#4ec9b0', border: '1px solid rgba(78,201,176,0.3)' }}
                    onClick={runAiAnalysis}
                    disabled={isRunning}
                  >
                    <Zap size={12} />
                    {isRunning ? 'Analyzing...' : 'AI Analyze Bottlenecks'}
                  </button>
                )}

                {/* AI Analysis Results */}
                {aiAnalysis && (
                  <div className="space-y-2">
                    {typeof aiAnalysis === 'string' ? (
                      <pre className="text-[11px] font-mono p-2 rounded whitespace-pre-wrap max-h-[300px] overflow-auto" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>{aiAnalysis}</pre>
                    ) : (
                      <>
                        <div className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                          <div className="text-[11px] font-semibold mb-1">Summary</div>
                          <div className="text-[11px]">{aiAnalysis.summary}</div>
                          {aiAnalysis.complexity && (
                            <div className="mt-1 text-[10px]" style={{ color: 'var(--theme-accent)' }}>Complexity: {aiAnalysis.complexity}</div>
                          )}
                        </div>
                        {aiAnalysis.hotspots?.length > 0 && (
                          <div>
                            <div className="text-[11px] font-semibold mb-1">Hotspots</div>
                            {aiAnalysis.hotspots.map((h: any, i: number) => (
                              <div key={i} className="p-1.5 rounded mb-1 flex items-center gap-2" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${h.impact === 'high' ? 'bg-red-900/50 text-red-400' : h.impact === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-blue-900/50 text-blue-400'}`}>{h.impact}</span>
                                <div className="flex-1">
                                  <div className="font-mono text-[11px]" style={{ color: '#4fc1ff' }}>{h.function}</div>
                                  <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>{h.issue}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {aiAnalysis.recommendations?.length > 0 && (
                          <div>
                            <div className="text-[11px] font-semibold mb-1">Recommendations</div>
                            {aiAnalysis.recommendations.map((r: any, i: number) => (
                              <div key={i} className="p-1.5 rounded mb-1" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${r.priority === 'high' ? 'bg-red-900/50 text-red-400' : r.priority === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-blue-900/50 text-blue-400'}`}>{r.priority}</span>
                                  <span className="text-[11px] font-semibold">{r.title}</span>
                                </div>
                                <div className="text-[10px] mt-1" style={{ color: 'var(--theme-foreground-muted)' }}>{r.description}</div>
                                {r.estimatedImprovement && <div className="text-[10px] mt-0.5" style={{ color: '#4ec9b0' }}>Estimated improvement: {r.estimatedImprovement}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Timing Tab ── */}
        {tab === 'timing' && (
          <>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--theme-foreground-muted)' }}>Command to Benchmark</label>
              <input
                className="w-full text-[12px] p-1.5 rounded border outline-none font-mono"
                style={{ backgroundColor: 'var(--theme-input-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-foreground)' }}
                placeholder="node script.js / python script.py / npm test"
                value={command}
                onChange={e => setCommand(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>Iterations:</label>
              <input
                type="number"
                className="w-[60px] text-[12px] p-1 rounded border outline-none text-center"
                style={{ backgroundColor: 'var(--theme-input-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-foreground)' }}
                value={iterations}
                onChange={e => setIterations(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                min={1}
                max={20}
              />
            </div>
            <button
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded text-[12px]"
              style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
              onClick={runTiming}
              disabled={isRunning || !command.trim()}
            >
              {isRunning ? <><Clock size={12} /> Running...</> : <><Clock size={12} /> Run Benchmark</>}
            </button>

            {timingResult && (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Min', value: `${timingResult.summary.min}ms`, color: '#4ec9b0' },
                    { label: 'Max', value: `${timingResult.summary.max}ms`, color: '#ff5050' },
                    { label: 'Avg', value: `${timingResult.summary.avg}ms`, color: 'var(--theme-accent)' },
                    { label: 'Median', value: `${timingResult.summary.median}ms`, color: '#dcdcaa' },
                  ].map(s => (
                    <div key={s.label} className="p-2 rounded text-center" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                      <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>{s.label}</div>
                      <div className="text-[13px] font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Individual runs */}
                <div className="space-y-1">
                  {timingResult.timings.map((t: TimingRun) => (
                    <div key={t.iteration} className="flex items-center gap-2 p-1 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                      <span className="text-[10px] w-[20px]" style={{ color: 'var(--theme-foreground-muted)' }}>#{t.iteration}</span>
                      <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (t.duration / timingResult.summary.max) * 100)}%`,
                            backgroundColor: t.duration <= timingResult.summary.avg ? '#4ec9b0' : '#dcdcaa',
                          }}
                        />
                      </div>
                      <span className="text-[11px] font-mono w-[60px] text-right" style={{ color: t.exitCode === 0 ? 'var(--theme-foreground)' : '#ff5050' }}>
                        {t.duration}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Memory Tab ── */}
        {tab === 'memory' && (
          <>
            <button
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded text-[12px]"
              style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
              onClick={getMemorySnapshot}
              disabled={isRunning}
            >
              <Cpu size={12} />
              {isRunning ? 'Taking Snapshot...' : 'Take Memory Snapshot'}
            </button>

            {memoryResult && (
              <div className="space-y-3">
                {/* Process memory */}
                <div>
                  <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--theme-foreground-muted)' }}>Process Memory</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'RSS', value: `${memoryResult.process?.rssMB ?? 0} MB` },
                      { label: 'Heap Used', value: `${memoryResult.process?.heapUsedMB ?? 0} MB` },
                      { label: 'Heap Total', value: `${memoryResult.process?.heapTotalMB ?? 0} MB` },
                      { label: 'External', value: `${Math.round((memoryResult.process?.external ?? 0) / 1024 / 1024 * 10) / 10} MB` },
                    ].map(m => (
                      <div key={m.label} className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                        <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>{m.label}</div>
                        <div className="text-[13px] font-bold font-mono" style={{ color: 'var(--theme-accent)' }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Heap usage bar */}
                  {memoryResult.process && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] mb-0.5" style={{ color: 'var(--theme-foreground-muted)' }}>
                        <span>Heap Usage</span>
                        <span>{Math.round((memoryResult.process.heapUsed / memoryResult.process.heapTotal) * 100)}%</span>
                      </div>
                      <div className="h-[8px] rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(memoryResult.process.heapUsed / memoryResult.process.heapTotal) * 100}%`,
                            backgroundColor: (memoryResult.process.heapUsed / memoryResult.process.heapTotal) > 0.8 ? '#ff5050' : '#4ec9b0',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* System memory */}
                <div>
                  <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--theme-foreground-muted)' }}>System Memory</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                      <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>Total</div>
                      <div className="text-[13px] font-bold font-mono">{memoryResult.system?.totalGB ?? 0} GB</div>
                    </div>
                    <div className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                      <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>Free</div>
                      <div className="text-[13px] font-bold font-mono" style={{ color: '#4ec9b0' }}>{memoryResult.system?.freeGB ?? 0} GB</div>
                    </div>
                    <div className="p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
                      <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>Used</div>
                      <div className="text-[13px] font-bold font-mono" style={{ color: (memoryResult.system?.usedPercent ?? 0) > 80 ? '#ff5050' : 'var(--theme-foreground)' }}>
                        {memoryResult.system?.usedPercent ?? 0}%
                      </div>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="h-[8px] rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${memoryResult.system?.usedPercent ?? 0}%`,
                          backgroundColor: (memoryResult.system?.usedPercent ?? 0) > 80 ? '#ff5050' : '#4ec9b0',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* System info */}
                <div className="text-[10px] space-y-0.5" style={{ color: 'var(--theme-foreground-muted)' }}>
                  <div>Node: {memoryResult.nodeVersion} | CPUs: {memoryResult.cpuCount} | Uptime: {Math.round((memoryResult.uptime ?? 0) / 60)}min</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
