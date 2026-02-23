/**
 * IPC Handlers: Background Agents & Audio Transcription
 */
const { ipcMain } = require('electron');
const https = require('https');

function register(ctx) {
  // ─── Background Agents (Multi-Agent) ─────────────────────────────
  const backgroundAgents = new Map();
  let nextAgentId = 1;

  ipcMain.handle('agent-spawn', async (_, task, agentContext) => {
    const id = nextAgentId++;
    let cancelled = false;

    const agent = {
      id, task, status: 'running', result: null, error: null,
      startedAt: Date.now(),
      cancel: () => { cancelled = true; },
    };
    backgroundAgents.set(id, agent);

    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('agent-status', { id, status: 'running', task });
    }

    (async () => {
      try {
        const context = {
          projectPath: agentContext?.projectPath,
          params: { temperature: 0.3, maxTokens: 8192, topP: 0.9, topK: 20, repeatPenalty: 1.1, seed: -1 },
          maxIterations: agentContext?.maxIterations || 20,
          autoMode: true,
        };

        const configured = ctx.cloudLLM.getConfiguredProviders();
        if (configured.length > 0) {
          const p = configured[0];
          context.cloudProvider = p.provider;
          context.cloudModel = p.models?.[0]?.id;
        }

        let resultText = '';

        if (context.cloudProvider && context.cloudModel) {
          const cloudResult = await ctx.cloudLLM.generate(
            `You are a background AI agent working on a specific task. Complete the following task thoroughly:\n\n${task}`,
            {
              provider: context.cloudProvider,
              model: context.cloudModel,
              maxTokens: context.params.maxTokens,
              temperature: context.params.temperature,
            }
          );
          resultText = cloudResult?.text || 'No response generated.';
        } else if (ctx.llmEngine.getStatus().state === 'ready') {
          const prompt = `You are a background AI agent. Complete this task:\n\n${task}`;
          resultText = await ctx.llmEngine.generate(prompt, context.params);
        } else {
          throw new Error('No AI model available for background agent');
        }

        if (cancelled) {
          agent.status = 'cancelled';
        } else {
          agent.status = 'completed';
          agent.result = resultText;
        }
      } catch (e) {
        agent.status = 'error';
        agent.error = e.message;
      }

      const w = ctx.getMainWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send('agent-status', {
          id, status: agent.status, task,
          result: agent.result, error: agent.error, completedAt: Date.now(),
        });
      }
    })();

    return { success: true, id };
  });

  ipcMain.handle('agent-cancel', (_, agentId) => {
    const agent = backgroundAgents.get(agentId);
    if (agent) { agent.cancel(); agent.status = 'cancelled'; return { success: true }; }
    return { success: false, error: 'Agent not found' };
  });

  ipcMain.handle('agent-get-result', (_, agentId) => {
    const agent = backgroundAgents.get(agentId);
    if (agent) return { success: true, id: agent.id, status: agent.status, task: agent.task, result: agent.result, error: agent.error };
    return { success: false, error: 'Agent not found' };
  });

  ipcMain.handle('agent-list', () => {
    const agents = [];
    for (const [, agent] of backgroundAgents) {
      agents.push({ id: agent.id, task: agent.task, status: agent.status, startedAt: agent.startedAt });
    }
    return { agents };
  });

  // ─── Audio Transcription (Groq Whisper) ─────────────────────────────
  ipcMain.handle('transcribe-audio', async (_, audioBase64) => {
    try {
      const groqKey = ctx.cloudLLM.apiKeys?.groq;
      if (!groqKey) {
        return { success: false, error: 'No Groq API key configured for speech transcription.' };
      }
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const boundary = '----guIDEAudioBoundary' + Date.now();

      const parts = [];
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`);
      parts.push(audioBuffer);
      parts.push('\r\n');
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`);
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`);
      parts.push(`--${boundary}--\r\n`);

      const bodyParts = parts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
      const body = Buffer.concat(bodyParts);

      return new Promise((resolve) => {
        const req = https.request({
          hostname: 'api.groq.com', port: 443,
          path: '/openai/v1/audio/transcriptions', method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.text) resolve({ success: true, text: json.text });
              else if (json.error) resolve({ success: false, error: json.error.message || 'Transcription failed' });
              else resolve({ success: false, error: 'No transcription returned' });
            } catch (_) {
              resolve({ success: false, error: `Failed to parse response: ${data.substring(0, 200)}` });
            }
          });
        });
        req.on('error', (e) => resolve({ success: false, error: e.message }));
        req.setTimeout(30000, () => { req.destroy(); resolve({ success: false, error: 'Transcription request timed out' }); });
        req.write(body);
        req.end();
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
