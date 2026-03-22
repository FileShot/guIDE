/**
 * guIDE — AI-Powered Offline IDE
 * Performance Profiler & Diagnostics Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');

// Active profiling sessions
const sessions = new Map();
let nextSessionId = 1;

function register(ctx) {

  // ── Profile a Node.js script ──
  ipcMain.handle('profiler-run-node', async (_, params) => {
    try {
      const { scriptPath, args = [], cwd } = params;
      const absScript = path.resolve(scriptPath);
      if (!fs.existsSync(absScript)) {
        return { success: false, error: `Script not found: ${absScript}` };
      }

      const sessionId = nextSessionId++;
      const workDir = cwd || path.dirname(absScript);
      const logFile = path.join(os.tmpdir(), `guide-prof-${sessionId}.log`);

      return new Promise((resolve) => {
        const startTime = Date.now();
        // Use --prof to generate V8 profiler output, --cpu-prof for CPU profile
        const child = spawn(process.execPath.replace(/electron[^/\\]*$/i, 'node').replace(/electron\.exe$/i, 'node.exe'),
          ['--cpu-prof', '--cpu-prof-dir', os.tmpdir(), absScript, ...args],
          { cwd: workDir, timeout: 60000, env: { ...process.env, NODE_ENV: 'production' } }
        );

        // Fallback: use plain node from PATH
        let usePathNode = false;
        child.on('error', () => { usePathNode = true; });

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => { stdout += d.toString(); });
        child.stderr?.on('data', (d) => { stderr += d.toString(); });

        child.on('close', (code) => {
          const duration = Date.now() - startTime;

          if (usePathNode) {
            // Fallback: run with node from PATH and measure timing
            const startFb = Date.now();
            exec(`node "${absScript}" ${args.map(a => `"${a}"`).join(' ')}`, { cwd: workDir, timeout: 60000 }, (err, fbOut, fbErr) => {
              const fbDuration = Date.now() - startFb;
              resolve({
                success: true,
                sessionId,
                scriptPath: absScript,
                duration: fbDuration,
                exitCode: err ? err.code || 1 : 0,
                stdout: (fbOut || '').slice(0, 5000),
                stderr: (fbErr || '').slice(0, 2000),
                profile: null,
                message: 'Profiled with timing only (V8 CPU profiler not available in this environment)',
              });
            });
            return;
          }

          // Look for .cpuprofile files
          let profileData = null;
          try {
            const tmpFiles = fs.readdirSync(os.tmpdir());
            const cpuProfile = tmpFiles
              .filter(f => f.endsWith('.cpuprofile'))
              .map(f => ({ name: f, path: path.join(os.tmpdir(), f), time: fs.statSync(path.join(os.tmpdir(), f)).mtimeMs }))
              .sort((a, b) => b.time - a.time)[0];
            if (cpuProfile) {
              const raw = fs.readFileSync(cpuProfile.path, 'utf-8');
              profileData = JSON.parse(raw);
              fs.unlinkSync(cpuProfile.path); // cleanup
            }
          } catch { /* ignore */ }

          resolve({
            success: true,
            sessionId,
            scriptPath: absScript,
            duration,
            exitCode: code,
            stdout: stdout.slice(0, 5000),
            stderr: stderr.slice(0, 2000),
            profile: profileData,
          });
        });

        sessions.set(sessionId, { child, startTime, scriptPath: absScript });
        setTimeout(() => { if (sessions.has(sessionId)) { child.kill(); sessions.delete(sessionId); } }, 65000);
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Profile a Python script (cProfile) ──
  ipcMain.handle('profiler-run-python', async (_, params) => {
    try {
      const { scriptPath, args = [], cwd } = params;
      const absScript = path.resolve(scriptPath);
      if (!fs.existsSync(absScript)) {
        return { success: false, error: `Script not found: ${absScript}` };
      }

      const workDir = cwd || path.dirname(absScript);
      const sessionId = nextSessionId++;
      const profileOut = path.join(os.tmpdir(), `guide-pyprof-${sessionId}.txt`);

      // Run with cProfile, output stats to file
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      const cProfileScript = `
import cProfile, pstats, io, sys, json, time
start = time.time()
pr = cProfile.Profile()
pr.enable()
exec(open(r"${absScript.replace(/\\/g, '\\\\')}").read())
pr.disable()
duration = time.time() - start
s = io.StringIO()
ps = pstats.Stats(pr, stream=s)
ps.sort_stats('cumulative')
ps.print_stats(50)
stats_text = s.getvalue()
# Also generate simplified JSON
entries = []
for (fn_info, (cc, nc, tt, ct, callers)) in pr.stats.items():
    entries.append({
        "file": fn_info[0], "line": fn_info[1], "function": fn_info[2],
        "calls": nc, "totalTime": round(tt, 6), "cumTime": round(ct, 6)
    })
entries.sort(key=lambda x: x["cumTime"], reverse=True)
result = {"duration": round(duration, 4), "stats": stats_text, "entries": entries[:100]}
print("__PROFILE_JSON__")
print(json.dumps(result))
`;
      return new Promise((resolve) => {
        const startTime = Date.now();
        const child = exec(`${pyCmd} -c "${cProfileScript.replace(/"/g, '\\"')}"`,
          { cwd: workDir, timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => {
            const duration = Date.now() - startTime;
            let profile = null;
            try {
              const jsonMarker = stdout.indexOf('__PROFILE_JSON__');
              if (jsonMarker !== -1) {
                const jsonStr = stdout.slice(jsonMarker + '__PROFILE_JSON__'.length).trim();
                profile = JSON.parse(jsonStr);
                stdout = stdout.slice(0, jsonMarker);
              }
            } catch { /* ignore */ }

            resolve({
              success: true,
              sessionId,
              scriptPath: absScript,
              runtime: 'python',
              duration: profile?.duration ? profile.duration * 1000 : duration,
              exitCode: err ? err.code || 1 : 0,
              stdout: (stdout || '').slice(0, 5000),
              stderr: (stderr || '').slice(0, 2000),
              profile,
            });
          }
        );
        sessions.set(sessionId, { child, startTime, scriptPath: absScript });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Quick timing benchmark (any command) ──
  ipcMain.handle('profiler-time-command', async (_, params) => {
    try {
      const { command, cwd, iterations = 1 } = params;
      const workDir = cwd || ctx.currentProjectPath || os.homedir();
      const runs = Math.min(Math.max(iterations, 1), 20);
      const timings = [];

      for (let i = 0; i < runs; i++) {
        const start = Date.now();
        await new Promise((resolve) => {
          exec(command, { cwd: workDir, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
            timings.push({
              iteration: i + 1,
              duration: Date.now() - start,
              exitCode: err ? err.code || 1 : 0,
              stdout: (stdout || '').slice(0, 1000),
              stderr: (stderr || '').slice(0, 500),
            });
            resolve(null);
          });
        });
      }

      const durations = timings.map(t => t.duration);
      return {
        success: true,
        command,
        iterations: runs,
        timings,
        summary: {
          min: Math.min(...durations),
          max: Math.max(...durations),
          avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
          median: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)],
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Get memory snapshot (Node.js process info) ──
  ipcMain.handle('profiler-memory-snapshot', async () => {
    try {
      const mem = process.memoryUsage();
      const sysMem = {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
      };
      return {
        success: true,
        process: {
          rss: mem.rss,
          heapTotal: mem.heapTotal,
          heapUsed: mem.heapUsed,
          external: mem.external,
          arrayBuffers: mem.arrayBuffers || 0,
          rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
        },
        system: {
          totalGB: Math.round(sysMem.total / 1024 / 1024 / 1024 * 10) / 10,
          freeGB: Math.round(sysMem.free / 1024 / 1024 / 1024 * 10) / 10,
          usedPercent: Math.round((sysMem.used / sysMem.total) * 100),
        },
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        cpuCount: os.cpus().length,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── AI analysis of profiling results ──
  ipcMain.handle('profiler-ai-analyze', async (_, params) => {
    try {
      const { profileData, scriptPath, cloudProvider, cloudModel } = params;

      let profileSummary = '';
      if (profileData?.entries) {
        // Python cProfile entries
        const top = profileData.entries.slice(0, 20);
        profileSummary = top.map(e =>
          `${e.function} (${e.file}:${e.line}) — ${e.calls} calls, ${e.cumTime}s cumulative, ${e.totalTime}s total`
        ).join('\n');
      } else if (profileData?.nodes) {
        // V8 CPU profile
        const nodes = profileData.nodes.slice(0, 30);
        profileSummary = nodes.map(n =>
          `${n.callFrame?.functionName || '(anonymous)'} (${n.callFrame?.url || ''}:${n.callFrame?.lineNumber || 0}) — ${n.hitCount || 0} samples`
        ).join('\n');
      } else if (typeof profileData === 'string') {
        profileSummary = profileData.slice(0, 5000);
      } else {
        profileSummary = JSON.stringify(profileData).slice(0, 5000);
      }

      const prompt = `You are a performance optimization expert. Analyze these profiling results and provide actionable recommendations.

Script: ${scriptPath || 'unknown'}

Profile Data:
${profileSummary}

Provide your analysis as a JSON object with:
- "summary": One-paragraph overview of performance characteristics
- "hotspots": Array of { "function": string, "issue": string, "impact": "high"|"medium"|"low" }
- "recommendations": Array of { "title": string, "description": string, "priority": "high"|"medium"|"low", "estimatedImprovement": string }
- "complexity": Overall time complexity assessment (e.g., "O(n log n)")

Return ONLY the JSON object. No markdown.`;

      let analysisText = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 3000 });
          analysisText = result.text || '';
        } catch { /* fall through */ }
      }
      if (!analysisText && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(prompt, { maxTokens: 3000 });
          analysisText = result.text || '';
        } catch { /* ignore */ }
      }

      if (!analysisText) return { success: false, error: 'No LLM available for analysis' };

      let analysis = null;
      try {
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
      } catch {
        return { success: true, analysis: null, rawAnalysis: analysisText };
      }

      return { success: true, analysis, rawAnalysis: analysisText };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Cancel a running profiling session ──
  ipcMain.handle('profiler-cancel', async (_, sessionId) => {
    try {
      const session = sessions.get(sessionId);
      if (!session) return { success: false, error: 'Session not found' };
      session.child.kill();
      sessions.delete(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── List active profiling sessions ──
  ipcMain.handle('profiler-list-sessions', async () => {
    const list = [];
    for (const [id, session] of sessions) {
      list.push({
        id,
        scriptPath: session.scriptPath,
        startTime: session.startTime,
        elapsed: Date.now() - session.startTime,
      });
    }
    return { success: true, sessions: list };
  });
}

module.exports = { register };
