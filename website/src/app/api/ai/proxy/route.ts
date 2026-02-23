/**
 * guIDE AI Proxy — Server-side request forwarding with plan-based daily quotas.
 *
 * All bundled-key API calls from the desktop app route through here so that
 * per-user quotas are enforced server-side instead of trusting the client.
 *
 * Auth modes:
 *   - Bearer JWT      → identifies user, applies plan quota (free 30/day, pro 500/day, unlimited ∞)
 *   - No auth header  → anonymous, identified by IP, 30 requests/day
 *
 * Provider keys are stored server-side as env vars:
 *   PROXY_GROQ_KEY, PROXY_CEREBRAS_KEY, PROXY_SAMBANOVA_KEY,
 *   PROXY_GOOGLE_KEY, PROXY_OPENROUTER_KEY
 *
 * Copyright (c) 2025-2026 Brendan Gray. All Rights Reserved.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getLicenseByUserId } from '@/lib/db';
import { getClientIp } from '@/lib/rateLimit';

// ─── Daily quota limits per plan ─────────────────────────────────────────────
const PLAN_DAILY_LIMITS: Record<string, number> = {
  unlimited:  Infinity,
  developer:  Infinity,
  pro:        500,
  standard:   500, // legacy one-time purchase = same as pro
  free:       30,
  anonymous:  30,
};

// ─── In-memory daily usage counter ───────────────────────────────────────────
// Key: `userId:<id>` or `ip:<address>` → usage entry
interface UsageEntry { date: string; count: number; }
const dailyUsage = new Map<string, UsageEntry>();

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function checkAndBumpQuota(quotaKey: string, limit: number): { allowed: boolean; count: number } {
  const today = getTodayDate();
  const entry = dailyUsage.get(quotaKey);
  if (!entry || entry.date !== today) {
    dailyUsage.set(quotaKey, { date: today, count: 1 });
    return { allowed: true, count: 1 };
  }
  if (limit !== Infinity && entry.count >= limit) {
    return { allowed: false, count: entry.count };
  }
  entry.count++;
  return { allowed: true, count: entry.count };
}

// ─── Provider endpoints ───────────────────────────────────────────────────────
interface ProviderConfig {
  host: string;
  path: string;
  envKey: string;
}

const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  groq:       { host: 'api.groq.com',                        path: '/openai/v1/chat/completions',               envKey: 'PROXY_GROQ_KEY' },
  cerebras:   { host: 'api.cerebras.ai',                     path: '/v1/chat/completions',                      envKey: 'PROXY_CEREBRAS_KEY' },
  sambanova:  { host: 'api.sambanova.ai',                    path: '/v1/chat/completions',                      envKey: 'PROXY_SAMBANOVA_KEY' },
  google:     { host: 'generativelanguage.googleapis.com',   path: '/v1beta/openai/chat/completions',           envKey: 'PROXY_GOOGLE_KEY' },
  openrouter: { host: 'openrouter.ai',                       path: '/api/v1/chat/completions',                  envKey: 'PROXY_OPENROUTER_KEY' },
};

// ─── Request body shape ───────────────────────────────────────────────────────
interface ProxyRequest {
  provider: string;
  model: string;
  messages: { role: string; content: string }[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export async function POST(req: NextRequest) {
  // ── 1. Parse request body ──────────────────────────────────────────────────
  let body: ProxyRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { provider, model, messages, systemPrompt, maxTokens = 2048, temperature = 0.7, stream = true } = body;

  if (!provider || !model || !messages?.length) {
    return NextResponse.json({ error: 'provider, model, and messages are required' }, { status: 400 });
  }

  // ── 2. Validate provider ───────────────────────────────────────────────────
  const pConfig = PROVIDER_CONFIG[provider];
  if (!pConfig) {
    return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  const providerKey = process.env[pConfig.envKey];
  if (!providerKey) {
    console.error(`[Proxy] Missing env var ${pConfig.envKey}`);
    return NextResponse.json({ error: 'Provider not available — server misconfiguration' }, { status: 503 });
  }

  // ── 3. Auth and quota check ────────────────────────────────────────────────
  let quotaKey: string;
  let plan: string = 'anonymous';

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired session token' }, { status: 401 });
    }
    // Look up license for plan
    const license = getLicenseByUserId(payload.userId);
    plan = license?.plan ?? 'free';
    quotaKey = `userId:${payload.userId}`;
  } else {
    // Anonymous user — identify by IP
    const ip = getClientIp(req);
    quotaKey = `ip:${ip}`;
    plan = 'anonymous';
  }

  const limit = PLAN_DAILY_LIMITS[plan] ?? PLAN_DAILY_LIMITS.free;
  const quota = checkAndBumpQuota(quotaKey, limit);

  if (!quota.allowed) {
    const planLabel = plan === 'anonymous' ? 'anonymous users' : `the ${plan} plan`;
    const upgradeMsg = plan === 'pro' || plan === 'standard'
      ? 'Upgrade to Unlimited at graysoft.dev/account for unlimited daily messages.'
      : plan === 'anonymous' || plan === 'free'
        ? 'Sign in and upgrade to Pro (500/day) or Unlimited at graysoft.dev/account.'
        : '';
    return NextResponse.json({
      error: `quota_exceeded`,
      message: `Daily limit reached for ${planLabel} (${limit} messages/day). ${upgradeMsg}`.trim(),
      limit,
      used: quota.count,
    }, { status: 429 });
  }

  // ── 4. Build upstream request ─────────────────────────────────────────────
  const upstreamMessages = [];
  if (systemPrompt) {
    upstreamMessages.push({ role: 'system', content: systemPrompt });
  }
  upstreamMessages.push(...messages);

  const upstreamBody = JSON.stringify({
    model,
    messages: upstreamMessages,
    max_tokens: maxTokens,
    temperature,
    stream,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${providerKey}`,
    'User-Agent': 'guIDE/2.1.1',
  };

  // OpenRouter requires these headers
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://graysoft.dev';
    headers['X-Title'] = 'guIDE';
  }

  // ── 5. Forward and stream response ────────────────────────────────────────
  const upstreamUrl = `https://${pConfig.host}${pConfig.path}`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: upstreamBody,
    });

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => 'unknown error');
      console.error(`[Proxy] ${provider} returned ${upstreamRes.status}: ${errText.slice(0, 200)}`);

      if (upstreamRes.status === 429) {
        return NextResponse.json({ error: 'provider_rate_limited', message: `${provider} is rate limited server-side. Try again shortly.` }, { status: 429 });
      }
      return NextResponse.json({ error: 'upstream_error', message: `${provider} error: ${upstreamRes.status}` }, { status: 502 });
    }

    if (stream && upstreamRes.body) {
      // Pipe the SSE stream directly to the client
      return new NextResponse(upstreamRes.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          'X-Proxy-Plan': plan,
          'X-Proxy-Used': String(quota.count),
          'X-Proxy-Limit': limit === Infinity ? 'unlimited' : String(limit),
        },
      });
    }

    // Non-streaming: forward JSON response
    const json = await upstreamRes.json();
    return NextResponse.json(json, {
      headers: {
        'X-Proxy-Plan': plan,
        'X-Proxy-Used': String(quota.count),
        'X-Proxy-Limit': limit === Infinity ? 'unlimited' : String(limit),
      },
    });

  } catch (e: any) {
    console.error('[Proxy] Fetch error:', e.message);
    return NextResponse.json({ error: 'network_error', message: `Failed to reach ${provider}: ${e.message}` }, { status: 503 });
  }
}
