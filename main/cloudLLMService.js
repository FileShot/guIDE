/**
 * guIDE Cloud LLM Service — Multi-provider cloud API integration
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * 26 providers: OpenAI, Anthropic, Google, xAI, OpenRouter, Cerebras, SambaNova,
 * Groq, Together, Fireworks, NVIDIA, Cohere, Mistral, HuggingFace, Cloudflare,
 * Perplexity, DeepSeek, AI21, DeepInfra, Hyperbolic, Novita, Moonshot, Upstage,
 * Lepton, APIFreeLLM, GraySoft.  Plus local Ollama.
 */
'use strict';

const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 6, timeout: 60000 });

// ─── Provider endpoint map ────────────────────────────────────────────────────
const ENDPOINTS = {
  graysoft:    { host: 'pocket.graysoft.dev',             path: '/api/v1/chat/completions' },
  openai:      { host: 'api.openai.com',                  path: '/v1/chat/completions' },
  anthropic:   { host: 'api.anthropic.com',               path: '/v1/messages' },
  google:      { host: 'generativelanguage.googleapis.com', path: '/v1beta/openai/chat/completions' },
  xai:         { host: 'api.x.ai',                        path: '/v1/chat/completions' },
  groq:        { host: 'api.groq.com',                    path: '/openai/v1/chat/completions' },
  openrouter:  { host: 'openrouter.ai',                   path: '/api/v1/chat/completions' },
  apifreellm:  { host: 'apifreellm.com',                  path: '/api/v1/chat' },
  cerebras:    { host: 'api.cerebras.ai',                 path: '/v1/chat/completions' },
  sambanova:   { host: 'api.sambanova.ai',                path: '/v1/chat/completions' },
  together:    { host: 'api.together.xyz',                path: '/v1/chat/completions' },
  fireworks:   { host: 'api.fireworks.ai',                path: '/inference/v1/chat/completions' },
  nvidia:      { host: 'integrate.api.nvidia.com',        path: '/v1/chat/completions' },
  cohere:      { host: 'api.cohere.ai',                   path: '/compatibility/v1/chat/completions' },
  mistral:     { host: 'api.mistral.ai',                  path: '/v1/chat/completions' },
  huggingface: { host: 'router.huggingface.co',           path: '/v1/chat/completions' },
  // cloudflare path requires account ID — resolved at call time
  cloudflare:  { host: 'api.cloudflare.com',              path: null },
  perplexity:  { host: 'api.perplexity.ai',               path: '/chat/completions' },
  deepseek:    { host: 'api.deepseek.com',                path: '/v1/chat/completions' },
  ai21:        { host: 'api.ai21.com',                    path: '/studio/v1/chat/completions' },
  deepinfra:   { host: 'api.deepinfra.com',               path: '/v1/openai/chat/completions' },
  hyperbolic:  { host: 'api.hyperbolic.xyz',              path: '/v1/chat/completions' },
  novita:      { host: 'api.novita.ai',                   path: '/v3/openai/chat/completions' },
  moonshot:    { host: 'api.moonshot.cn',                  path: '/v1/chat/completions' },
  upstage:     { host: 'api.upstage.ai',                  path: '/v1/chat/completions' },
  lepton:      { host: 'emc.lepton.run',                  path: '/api/v1/chat/completions' },
};

// ─── Provider labels ──────────────────────────────────────────────────────────
const PROVIDER_LABELS = {
  graysoft: 'GraySoft Cloud', openai: 'OpenAI', anthropic: 'Anthropic',
  google: 'Google Gemini', xai: 'xAI Grok', openrouter: 'OpenRouter',
  groq: 'Groq', apifreellm: 'APIFreeLLM', cerebras: 'Cerebras',
  sambanova: 'SambaNova', together: 'Together AI', fireworks: 'Fireworks AI',
  nvidia: 'NVIDIA NIM', cohere: 'Cohere', mistral: 'Mistral AI',
  huggingface: 'Hugging Face', cloudflare: 'Cloudflare Workers AI',
  perplexity: 'Perplexity', deepseek: 'DeepSeek', ai21: 'AI21 Labs',
  deepinfra: 'DeepInfra', hyperbolic: 'Hyperbolic', novita: 'Novita AI',
  moonshot: 'Moonshot AI', upstage: 'Upstage', lepton: 'Lepton AI',
  ollama: 'Ollama (Local)',
};

// ─── Provider model catalogs ─────────────────────────────────────────────────
const PROVIDER_MODELS = {
  graysoft: [
    { id: 'graysoft-cloud', name: 'GraySoft Cloud AI' },
  ],
  openai: [
    { id: 'gpt-4.1', name: 'GPT-4.1 (Flagship)' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Fast)' },
  ],
  google: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Free)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Free)' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Free)' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite (Free)' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite (Free)' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview (Free)' },
  ],
  xai: [
    { id: 'grok-3', name: 'Grok 3' },
    { id: 'grok-3-mini', name: 'Grok 3 Mini' },
  ],
  openrouter: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)' },
    { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1 (Free)' },
  ],
  apifreellm: [
    { id: 'apifreellm', name: 'APIFreeLLM 200B+ (Free)' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Free, 12K TPM, Default)' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B (Free)' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (Free, 30K TPM)' },
    { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 131K (Free, Moonshot AI)' },
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Free)' },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Free, 1000 tps)' },
    { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B (Free)' },
    { id: 'groq/compound', name: 'Groq Compound (Agentic, Tools)' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Free, 14K RPM)' },
  ],
  cerebras: [
    { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Free, Default, 30 RPM/key)' },
    { id: 'llama3.1-8b', name: 'Llama 3.1 8B (Free, 30 RPM/key)' },
  ],
  sambanova: [
    { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (Free, Default)' },
    { id: 'DeepSeek-V3.1', name: 'DeepSeek V3.1 (Free)' },
    { id: 'DeepSeek-R1-0528', name: 'DeepSeek R1 Reasoning (Free)' },
    { id: 'Llama-4-Maverick-17B-128E-Instruct', name: 'Llama 4 Maverick 17B (Free)' },
    { id: 'Qwen3-32B', name: 'Qwen 3 32B (Free)' },
    { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Free)' },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo' },
    { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', name: 'Llama 3.1 405B Turbo' },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
    { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo' },
    { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', name: 'Mixtral 8x22B' },
    { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B' },
  ],
  fireworks: [
    { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B' },
    { id: 'accounts/fireworks/models/deepseek-r1', name: 'DeepSeek R1' },
    { id: 'accounts/fireworks/models/qwen2p5-72b-instruct', name: 'Qwen 2.5 72B' },
  ],
  nvidia: [
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (Free)' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Free)' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B (Free)' },
    { id: 'qwen/qwq-32b', name: 'QWQ 32B Reasoning (Free)' },
  ],
  cohere: [
    { id: 'command-a-03-2025', name: 'Command A (Free, Flagship)' },
    { id: 'command-r-plus', name: 'Command R+ (Free)' },
    { id: 'command-r', name: 'Command R (Free)' },
    { id: 'command-r7b-12-2024', name: 'Command R 7B (Free, Fast)' },
  ],
  mistral: [
    { id: 'mistral-small-latest', name: 'Mistral Small 3.2 (Free)' },
    { id: 'mistral-large-latest', name: 'Mistral Large 3 (Free)' },
    { id: 'magistral-medium-2509', name: 'Magistral Medium 1.2 (Reasoning)' },
    { id: 'magistral-small-2509', name: 'Magistral Small 1.2 (Reasoning)' },
    { id: 'ministral-8b-latest', name: 'Ministral 8B (Free, Fast)' },
    { id: 'devstral-small-latest', name: 'Devstral Small (Code Agents)' },
    { id: 'mistral-nemo', name: 'Mistral Nemo 12B (Free)' },
    { id: 'pixtral-12b-2409', name: 'Pixtral 12B Vision (Free)' },
  ],
  huggingface: [
    { id: 'deepseek-ai/DeepSeek-V3-0324', name: 'DeepSeek V3 (Free)' },
    { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B (Free)' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (Free)' },
    { id: 'mistralai/Mistral-Small-3.1-24B-Instruct-2503', name: 'Mistral Small 3.1 (Free)' },
  ],
  cloudflare: [
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (Free)' },
    { id: '@cf/qwen/qwq-32b', name: 'QWQ 32B Reasoning (Free)' },
    { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill 32B (Free)' },
    { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1 (Free)' },
    { id: '@cf/google/gemma-3-12b-it', name: 'Gemma 3 12B (Free)' },
  ],
  perplexity: [
    { id: 'sonar-pro', name: 'Sonar Pro (Web Search)' },
    { id: 'sonar', name: 'Sonar (Web Search, Fast)' },
    { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro' },
    { id: 'sonar-reasoning', name: 'Sonar Reasoning' },
    { id: 'r1-1776', name: 'R1-1776 (Offline, No Search)' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3 (Flagship)' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoning)' },
  ],
  ai21: [
    { id: 'jamba-2.5', name: 'Jamba 2.5 (256K context)' },
    { id: 'jamba-2.5-mini', name: 'Jamba 2.5 Mini (256K, Fast)' },
  ],
  deepinfra: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B' },
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 (Reasoning)' },
    { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B MoE' },
    { id: 'Qwen/QwQ-32B', name: 'QwQ 32B Reasoning' },
  ],
  hyperbolic: [
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 (Reasoning)' },
    { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B MoE' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B' },
  ],
  novita: [
    { id: 'deepseek/deepseek-v3-0324', name: 'DeepSeek V3' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Reasoning)' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
    { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B MoE' },
  ],
  moonshot: [
    { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K' },
    { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K' },
    { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K' },
    { id: 'kimi-k2', name: 'Kimi K2 (Agentic)' },
  ],
  upstage: [
    { id: 'solar-pro2', name: 'Solar Pro 2 (Flagship)' },
    { id: 'solar-mini-ja', name: 'Solar Mini' },
  ],
  lepton: [
    { id: 'llama3-3-70b', name: 'Llama 3.3 70B' },
    { id: 'deepseek-r1', name: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen3-235b', name: 'Qwen3 235B MoE' },
  ],
};

// ─── Context window limits (tokens) ──────────────────────────────────────────
const CONTEXT_LIMITS = {
  'gpt-4.1': 1047576, 'gpt-4.1-mini': 1047576,
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000,
  'claude-sonnet-4-20250514': 200000, 'claude-3-5-sonnet-20241022': 200000, 'claude-3-haiku-20240307': 200000,
  'gemini-2.5-pro': 1048576, 'gemini-2.5-flash': 1048576, 'gemini-2.0-flash': 1048576,
  'gemini-2.5-flash-lite': 1048576, 'gemini-2.0-flash-lite': 1048576, 'gemini-3-flash-preview': 1048576,
  'grok-3': 131072, 'grok-3-mini': 131072,
  'llama-3.3-70b-versatile': 32768, 'llama-3.1-8b-instant': 8192,
  'meta-llama/llama-4-maverick-17b-128e-instruct': 131072,
  'meta-llama/llama-4-scout-17b-16e-instruct': 131072,
  'moonshotai/kimi-k2-instruct': 131072,
  'openai/gpt-oss-120b': 32768, 'qwen/qwen3-32b': 32768,
  'gpt-oss-120b': 32768, 'llama3.1-8b': 8192,
  'DeepSeek-V3.2': 65536, 'DeepSeek-V3.1': 65536, 'Meta-Llama-3.3-70B-Instruct': 8192,
  'DeepSeek-R1-0528': 65536, 'Qwen3-235B': 32768, 'Qwen3-32B': 32768,
  'Llama-4-Maverick-17B-128E-Instruct': 131072, 'MiniMax-M2.5': 65536,
  'command-a-03-2025': 256000, 'command-r-plus': 128000, 'command-r': 128000, 'command-r7b-12-2024': 128000,
  'mistral-small-latest': 32768, 'mistral-large-latest': 131072,
  'ministral-8b-latest': 131072, 'mistral-nemo': 131072, 'pixtral-12b-2409': 131072,
  'sonar-pro': 127072, 'sonar': 127072, 'sonar-reasoning-pro': 127072,
  'sonar-reasoning': 127072, 'r1-1776': 128000,
  'deepseek-chat': 65536, 'deepseek-reasoner': 65536,
  'jamba-2.5': 262144, 'jamba-2.5-mini': 262144,
  'moonshot-v1-8k': 8192, 'moonshot-v1-32k': 32768, 'moonshot-v1-128k': 131072, 'kimi-k2': 131072,
  'solar-pro2': 32768, 'solar-mini-ja': 32768,
};

// ─── Vision-capable models per provider ──────────────────────────────────────
const VISION_MODELS = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-3-flash-preview'],
  xai: ['grok-3', 'grok-3-mini'],
  openrouter: ['google/gemini-2.0-flash-exp:free'],
  mistral: ['pixtral-12b-2409'],
};

// ─── Fallback order + preferred fallback models ──────────────────────────────
const FALLBACK_ORDER = ['sambanova', 'cerebras', 'google', 'nvidia', 'cohere', 'mistral',
  'huggingface', 'cloudflare', 'together', 'fireworks', 'openrouter', 'groq'];

const PREFERRED_FALLBACK_MODEL = {
  cerebras:   'gpt-oss-120b',
  sambanova:  'Meta-Llama-3.3-70B-Instruct',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  groq:       'llama-3.3-70b-versatile',
  google:     'gemini-2.5-flash',
};

// ─── Default RPM per-key estimates for free tiers ────────────────────────────
const DEFAULT_RPM = {
  groq: 30, cerebras: 30, sambanova: 10, google: 15,
  openrouter: 20, openai: 3, anthropic: 5, xai: 60,
};

// ─── Bundled key constants ───────────────────────────────────────────────────
const BUNDLED_PROVIDERS = new Set(['groq', 'cerebras', 'sambanova', 'google', 'openrouter']);

const BUNDLED_KEYS = {
  groq:       'PSkxBSo0Fg4QaREdEgstG21qajwdFi9jDR0+IzhpHAMAbTkoChQUHx4vEiMjaRIYMAoKAzIVDWI=',
  cerebras:   'OSkxdzRvNDwuNyNpNz8/OSMqIm8jMDwtLSMxaCwtPi1jLSxiOWI/OWMqLTIxbzQyKGM5NA==',
  sambanova:  'Ozs/Pj9tOG53bmxoP3duaWhqdztrbmx3bTg8OG0+az9jbmlr',
  google:     'GxMgOwkjGDAKAgwSYygiKCBoETssDz4wGxcVKw4WFR0MIxQoFhwD',
  openrouter: 'KTF3NSh3LGt3bm1rP2xjYzs8az4/O2JrOD8+ajs8bm5tOz5ibTg/bWJvY2pvPGlpb2lrPmlpbGJja21pOT5qbjloaTs4Pz48Pg==',
};

const CEREBRAS_POOL_KEYS = [
  'OSkxdzRvNDwuNyNpNz8/OSMqIm8jMDwtLSMxaCwtPi1jLSxiOWI/OWMqLTIxbzQyKGM5NA==',
  'OSkxd2gqNDQtPzdpLixiPDEsaShpYiMoaG8/aTI8b2NjaSNvLDRiI2w/NDRvLC40LCJibw==',
  'OSkxdy45PDwxMm4qLSJjKixoPDE0PjFuPi4saDciKi4qbC5sPzFvPD8uYzkyPyM0OWMyaA==',
  'OSkxdzdsaDwtYi0uPjJsPCJuPD8wMSoiOWIyLjQibCJoPDcuNz40YmI+I2JjaGkjLSMwPw==',
  'OSkxdzkyMTIyMCIqMDI0LippY2JpLjIoaGJvKDEwNG8jLWhvN25iLW8uIjFiPzQ+aCo3Yg==',
  'OSkxd2lsYyg/KGkyaT4wLigjbD5uP2g/LTc5aC4xOSpvMjk+LiI5LCoqKDAwYio3KmwyNA==',
  'OSkxdzwxLG4jaDcxMGJoMiwqPy0iPjkoOTkoKDRjYmJvIyowMGkib24wMi5ibDksaTxuLA==',
  'OSkxd2lpIm5oKDcxKGluaS1uPzdsOTRjPz4iLioxPDxuPzwsLmluPD8tY2MobGgyPzI5Nw==',
  'OSkxd2I0LjA+KGk+Py1pImIqLG8sOSI+Py1jNz9jMTciPD4iKDc3LSM5Ii4/Km8wMDwsaA==',
  'OSkxdzIyPzI0bjRvbzkuLT5sMWljPC40b2g8P25sLS0sbzdsN2IxIjEyPzk5MD83LC1sLg==',
  'OSkxd2w0MjkwYmhibigobDE+NzkwbCNuaCJjMiNsbGJuY2M/LmxjN28jPjw8Kj5jPGM5bg==',
  'OSkxdz4qPygyPiJiLG9uaS05MG5oIz5oby43LGk+Mmk3I2kjPmMuLGw0bGMxOTA5LG4tPw==',
  'OSkxdzlobzQ3PiwuOTQqN283Mi00KjIuKixjMj9pIippIzE+IjQtbGI3IzkjbD8uN28xIg==',
  'OSkxdzdubzxoLSosMWw8OSIxaCMtLjQ+MjEjPj5jbm4yLi5ubzJpYyosaCxoNDE+OS5jMg==',
  'OSkxd2gwKigiaD85LjwxPCguLCxpbC4wLi1jMihoaSIqaTQsPzI0aWg0PjkjP2IxOSJvIg==',
  'OSkxd2ljLDk3NCpsNGg8Yi0+YjIoPDxsPjE+LCIibCo0aCgtMSo3Yj8qPz8/PGNjIj43LQ==',
  'OSkxd29iPC40b2MsKCMxPy4yN24uYipub2wqLGkxYj8yLD8yPz4+bDxpaCM3Kj4sYywjOQ==',
  'OSkxdz5vMSJuMGw0MGw8MD4ybmhsaCM3MWxvLDktKm5uaDxpIio/OTliLG4wLGkwKmkxMg==',
  'OSkxd28qKiIuYiwtYiwtbmhpIjEiMGw3Yz4yPChvYjc+LipuaW40KCI+MTdpbyxjbyhiPw==',
  'OSkxd29oPj83bChubj4oP280MWwqLi0uMTFoLjFvMjw8P2gwIy4iLGIjYmNjbGlpbzAtaA==',
  'OSkxdz8taDkxLm4jbz9jLDluNy0wbDc5OWIyLGwwMm9jKDxvLG4iIypoPC03MSJjND9jMQ==',
];

const GROQ_POOL_KEYS = [
  'PSkxBSo0Fg4QaREdEgstG21qajwdFi9jDR0+IzhpHAMAbTkoChQUHx4vEiMjaRIYMAoKAzIVDWI=',
  'PSkxBTZjYhUuGRsRPh0DID5uKj4vMzUwDR0+IzhpHAMMHT0gOGMRKiseLDYQEzYDGCMTLWJqDCM=',
  'PSkxBT8oOW8oFRE+bwkCOTAtCRILPiIUDR0+IzhpHANiFjM3CQAdGxwpKykIEW0YPhYVLhUbNCg=',
  'PSkxBQ1vEBcLK2oUDAoiNgMfag5paTgzDR0+IzhpHAM9DBUiEA0ea2M0IDcuFAgvPiktMQpqbhg=',
  'PSkxBR4rODkuFSkCOABpaxIcHwsCbCovDR0+IzhpHAMWDG4gH20zC2gSaRQiaDgYIGozPTcPCSk=',
  'PSkxBQwiFG5qET0CIG0qEhcJEBkpCms0DR0+IzhpHAMACGgjNRlsLD0yLz41Am1iLSA2HmkWDyk=',
  'PSkxBWwADm0rHhxiEyArIBViKWoRbTUtDR0+IzhpHAM/PDQ9HgorGRU9PRANFQMNFQsebwkjDAM=',
];

// ─── Blocked OpenRouter model patterns ───────────────────────────────────────
const OPENROUTER_BLOCKED = [
  /\bnsfw\b/i, /\berp\b/i, /\brolep/i, /lumimaid/i, /noromaid/i,
  /mythomax/i, /psyfighter/i, /midnight-rose/i, /fimbulvetr/i,
];

// ─── Default system prompt for cloud AI ──────────────────────────────────────
const CLOUD_SYSTEM_PROMPT = 'You are guIDE Cloud AI, an AI coding assistant built into guIDE IDE. You have hundreds of billions of parameters. Be helpful, concise, and professional. If asked about your model size, parameter count, or underlying provider: you are guIDE Cloud AI with hundreds of billions of parameters — do not reveal specific provider names or model family names.';

// ─── Stream timeout constants ────────────────────────────────────────────────
const STREAM_TIMEOUT = 20000;
const IDLE_TIMEOUT = 10000;

// ═══════════════════════════════════════════════════════════════════════════════

class CloudLLMService extends EventEmitter {
  constructor() {
    super();

    // API keys — one slot per provider
    this.apiKeys = {
      graysoft: '', openai: '', anthropic: '', google: '', xai: '',
      openrouter: '', groq: '', apifreellm: '', cerebras: '', sambanova: '',
      together: '', fireworks: '', nvidia: '', cohere: '', mistral: '',
      huggingface: '', cloudflare: '', perplexity: '', deepseek: '', ai21: '',
      deepinfra: '', hyperbolic: '', novita: '', moonshot: '', upstage: '', lepton: '',
    };

    this.activeProvider = null;
    this.activeModel = 'llama3.1-8b';

    // OpenRouter live model catalog cache
    this._openRouterModelsCache = null;
    this._openRouterModelsFetchedAt = 0;

    // Rate limiting + cooldown tracking
    this._rateLimitedUntil = {};           // { provider: timestamp }
    this._keyPools = {};                   // { provider: [{ key, cooldownUntil }] }
    this._keyPoolIndex = {};               // Round-robin index per provider
    this._recent429Timestamps = [];        // Adaptive pacing
    this._requestTimestamps = {};          // { provider: [timestamp, ...] }
    this._providerRPMPerKey = {};          // Learned RPM per key
    this._defaultRPMPerKey = { ...DEFAULT_RPM };

    // Provider-specific state
    this._apifreellmLastRequest = 0;
    this._cloudflareAccountId = '';
    this._licenseManager = null;
    this._userOwnedProviders = new Set();

    // Ollama detection cache (lazy, 30s TTL)
    this._ollamaAvailable = null;
    this._ollamaModels = [];
    this._ollamaLastCheck = 0;

    this._seedBundledKeys();
  }

  // ─── License manager ────────────────────────────────────────────────────────

  setLicenseManager(lm) { this._licenseManager = lm; }

  // ─── Bundled key management ─────────────────────────────────────────────────

  _isBundledProvider(provider) {
    return BUNDLED_PROVIDERS.has(provider);
  }

  /**
   * Seed obfuscated bundled API keys for free-tier providers.
   * XOR deobfuscation — not security, just prevents casual scraping from source.
   */
  _seedBundledKeys() {
    const xorKey = 0x5A;
    const decode = (encoded) => Buffer.from(Buffer.from(encoded, 'base64').map(b => b ^ xorKey)).toString();

    try {
      for (const [provider, encoded] of Object.entries(BUNDLED_KEYS)) {
        if (!this.apiKeys[provider] || !this.apiKeys[provider].trim()) {
          this.apiKeys[provider] = decode(encoded);
        }
      }
      for (const encoded of CEREBRAS_POOL_KEYS) {
        this.addKeyToPool('cerebras', decode(encoded));
      }
      for (const encoded of GROQ_POOL_KEYS) {
        this.addKeyToPool('groq', decode(encoded));
      }
    } catch (e) {
      console.warn('[CloudLLM] Key seed error:', e.message);
    }
  }

  // ─── Request tracking + RPM pacing ──────────────────────────────────────────

  _recordRequest(provider) {
    if (!this._requestTimestamps[provider]) this._requestTimestamps[provider] = [];
    this._requestTimestamps[provider].push(Date.now());
  }

  _learnRPMFromHeaders(provider, headers) {
    if (!headers) return;
    const limitStr = headers['x-ratelimit-limit-requests']
      || headers['ratelimit-limit']
      || headers['x-ratelimit-limit-requests-minute'];
    if (!limitStr) return;

    const limit = parseInt(limitStr, 10);
    if (limit > 0 && limit < 10000) {
      const prev = this._providerRPMPerKey[provider];
      this._providerRPMPerKey[provider] = limit;
      if (prev !== limit) {
        console.log(`[CloudLLM] Learned ${provider} RPM/key = ${limit} (was ${prev || 'default'})`);
      }
    }
  }

  _getPerKeyRPM(provider) {
    return this._providerRPMPerKey[provider]
      || this._defaultRPMPerKey[provider]
      || 30;
  }

  /**
   * Sliding-window RPM pacer — returns ms to wait before the next request
   * to stay at 85% of the pool's combined RPM capacity.
   */
  getProactivePaceMs(provider) {
    const perKeyRPM = this._getPerKeyRPM(provider);
    const poolSize = this._keyPools[provider]?.length || 1;
    const totalRPM = perKeyRPM * poolSize;
    const targetRPM = totalRPM * 0.85;
    const minIntervalMs = 60000 / targetRPM;

    const stamps = this._requestTimestamps[provider] || [];
    const now = Date.now();
    const oneMinAgo = now - 60000;
    const recentStamps = stamps.filter(t => t > oneMinAgo);
    this._requestTimestamps[provider] = recentStamps;

    const recentCount = recentStamps.length;
    if (recentCount >= targetRPM) {
      const oldestRecent = recentStamps[0];
      const msUntilSlotFrees = (oldestRecent + 60000) - now;
      return Math.max(msUntilSlotFrees, minIntervalMs);
    }

    if (recentCount > 0) {
      const lastRequestMs = recentStamps[recentStamps.length - 1];
      const elapsed = now - lastRequestMs;
      if (elapsed < minIntervalMs) return minIntervalMs - elapsed;
    }

    return 0;
  }

  /**
   * Inter-tool delay based on recent 429 pressure.
   */
  getRecommendedPaceMs(provider) {
    const now = Date.now();
    this._recent429Timestamps = this._recent429Timestamps.filter(t => now - t < 120000);
    const recent429Count = this._recent429Timestamps.length;

    if (recent429Count === 0) return 0;
    if (recent429Count <= 2) return 2000;
    if (recent429Count <= 5) return 5000;
    return 10000;
  }

  // ─── API key management ─────────────────────────────────────────────────────

  setApiKey(provider, key) {
    if (provider === 'cloudflare' && key && key.includes(':')) {
      const [accountId, token] = key.split(':');
      this._cloudflareAccountId = accountId;
      this.apiKeys.cloudflare = token;
    } else {
      this.apiKeys[provider] = key || '';
    }
    if (key && key.trim()) {
      this._userOwnedProviders.add(provider);
    }
  }

  isUsingOwnKey(provider) {
    return this._userOwnedProviders.has(provider);
  }

  // ─── Key pool management ────────────────────────────────────────────────────

  addKeyToPool(provider, key) {
    if (!this._keyPools[provider]) this._keyPools[provider] = [];
    if (this._keyPools[provider].some(e => e.key === key)) return;
    this._keyPools[provider].push({ key, cooldownUntil: 0 });
    if (!this._keyPoolIndex[provider]) this._keyPoolIndex[provider] = 0;
    if (!this.apiKeys[provider] || !this.apiKeys[provider].trim()) {
      this.apiKeys[provider] = key;
    }
  }

  _getPoolKey(provider) {
    const pool = this._keyPools[provider];
    if (!pool || pool.length === 0) return null;

    const now = Date.now();
    const startIdx = this._keyPoolIndex[provider] || 0;

    for (let i = 0; i < pool.length; i++) {
      const idx = (startIdx + i) % pool.length;
      if (pool[idx].cooldownUntil <= now) {
        this._keyPoolIndex[provider] = (idx + 1) % pool.length;
        return pool[idx].key;
      }
    }

    // All keys on cooldown — return the one with earliest expiry
    let earliest = pool[0];
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].cooldownUntil < earliest.cooldownUntil) earliest = pool[i];
    }
    return earliest.key;
  }

  _cooldownPoolKey(provider, key, durationMs) {
    const pool = this._keyPools[provider];
    if (!pool) return;
    const entry = pool.find(e => e.key === key);
    if (entry) entry.cooldownUntil = Date.now() + durationMs;
  }

  getPoolStatus(provider) {
    const pool = this._keyPools[provider];
    if (!pool) return { total: 0, available: 0, onCooldown: 0 };
    const now = Date.now();
    const available = pool.filter(e => e.cooldownUntil <= now).length;
    return { total: pool.length, available, onCooldown: pool.length - available };
  }

  // ─── Provider catalog ───────────────────────────────────────────────────────

  getConfiguredProviders() {
    const providers = [];
    for (const [provider, key] of Object.entries(this.apiKeys)) {
      if (key && key.trim()) {
        providers.push({ provider, label: PROVIDER_LABELS[provider] || provider });
      }
    }
    if (this._ollamaAvailable) {
      providers.push({ provider: 'ollama', label: 'Ollama (Local)' });
    }
    return providers;
  }

  getAllProviders() {
    return Object.entries(PROVIDER_LABELS)
      .filter(([p]) => p !== 'ollama')
      .map(([provider, label]) => ({
        provider,
        label,
        hasKey: !!(this.apiKeys[provider] && this.apiKeys[provider].trim()),
        isFree: BUNDLED_PROVIDERS.has(provider),
      }));
  }

  _getProviderLabel(provider) {
    return PROVIDER_LABELS[provider] || provider;
  }

  _getProviderModels(provider) {
    return PROVIDER_MODELS[provider] || [];
  }

  _getEndpoint(provider) {
    const ep = ENDPOINTS[provider];
    if (!ep) return null;
    if (provider === 'cloudflare') {
      return {
        host: ep.host,
        path: `/client/v4/accounts/${this._cloudflareAccountId || 'ACCOUNT_ID'}/ai/v1/chat/completions`,
      };
    }
    return ep;
  }

  _supportsVision(provider, model) {
    if (provider === 'ollama') {
      return /llava|bakllava|qwen.*vl|minicpm.*v|moondream|internvl|cogvlm|-vl\b|\.vision\b|vision-/i.test(model);
    }
    const list = VISION_MODELS[provider] || [];
    return list.some(m => model.includes(m) || m.includes(model));
  }

  _getModelContextLimit(provider, model) {
    return CONTEXT_LIMITS[model] || 32768;
  }

  // ─── Ollama local LLM detection ─────────────────────────────────────────────

  async detectOllama() {
    const now = Date.now();
    if (this._ollamaLastCheck && now - this._ollamaLastCheck < 30000) {
      return this._ollamaAvailable;
    }

    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost', port: 11434, path: '/api/tags',
        method: 'GET', timeout: 3000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            this._ollamaModels = (parsed.models || []).map(m => ({
              id: m.name, name: m.name,
              size: m.size, modified: m.modified_at,
            }));
            this._ollamaAvailable = true;
          } catch {
            this._ollamaAvailable = false;
            this._ollamaModels = [];
          }
          this._ollamaLastCheck = Date.now();
          resolve(this._ollamaAvailable);
        });
      });
      req.on('error', () => {
        this._ollamaAvailable = false;
        this._ollamaModels = [];
        this._ollamaLastCheck = Date.now();
        resolve(false);
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  getOllamaModels() { return this._ollamaModels; }

  getOllamaVisionModels() {
    return this._ollamaModels.filter(m =>
      /llava|bakllava|qwen.*vl|minicpm.*v|moondream|internvl|cogvlm/i.test(m.id)
    );
  }

  // ─── OpenRouter live model catalog ──────────────────────────────────────────

  async fetchOpenRouterModels() {
    const now = Date.now();
    if (this._openRouterModelsCache && now - this._openRouterModelsFetchedAt < 600000) {
      return this._openRouterModelsCache;
    }

    return new Promise((resolve) => {
      const req = https.request({
        host: 'openrouter.ai', path: '/api/v1/models',
        method: 'GET', timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const models = (parsed.data || [])
              .filter(m => {
                if (m.id.includes('/image') || m.id.includes('/audio')) return false;
                if (OPENROUTER_BLOCKED.some(rx => rx.test(m.id) || rx.test(m.name || ''))) return false;
                return true;
              })
              .map(m => ({
                id: m.id,
                name: m.name || m.id,
                contextLength: m.context_length,
                pricing: m.pricing,
                isFree: m.pricing && parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0,
              }))
              .sort((a, b) => {
                if (a.isFree && !b.isFree) return -1;
                if (!a.isFree && b.isFree) return 1;
                return (a.name || '').localeCompare(b.name || '');
              });

            this._openRouterModelsCache = models;
            this._openRouterModelsFetchedAt = Date.now();
            resolve(models);
          } catch {
            resolve(this._openRouterModelsCache || PROVIDER_MODELS.openrouter);
          }
        });
      });
      req.on('error', () => resolve(this._openRouterModelsCache || PROVIDER_MODELS.openrouter));
      req.on('timeout', () => { req.destroy(); resolve(this._openRouterModelsCache || PROVIDER_MODELS.openrouter); });
      req.end();
    });
  }

  // ─── Context trimming ───────────────────────────────────────────────────────

  /**
   * Last-resort auto-trim: removes oldest messages to stay within the model's
   * hard context limit.  The ConversationSummarizer in agenticChat.js handles
   * intelligent summarization first — this only fires if summarised messages
   * still exceed the context window (e.g. user picks a tiny 8K model).
   */
  _trimToContextLimit(messages, provider, model, maxTokens) {
    const contextLimit = this._getModelContextLimit(provider, model);
    const reserveForOutput = maxTokens || 2048;
    const budgetChars = (contextLimit - reserveForOutput) * 3.5;
    if (budgetChars <= 0) return messages;

    let totalChars = 0;
    for (const m of messages) {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      totalChars += content.length;
    }
    if (totalChars <= budgetChars) return messages;

    const system = messages[0];
    const user = messages[messages.length - 1];
    const middle = messages.slice(1, -1);

    const systemLen = (typeof system.content === 'string' ? system.content : JSON.stringify(system.content)).length;
    const userLen = (typeof user.content === 'string' ? user.content : JSON.stringify(user.content)).length;
    let remaining = budgetChars - systemLen - userLen;

    const kept = [];
    for (let i = middle.length - 1; i >= 0; i--) {
      const content = typeof middle[i].content === 'string' ? middle[i].content : JSON.stringify(middle[i].content);
      if (remaining - content.length > 0) {
        kept.unshift(middle[i]);
        remaining -= content.length;
      } else {
        break;
      }
    }

    const trimmed = middle.length - kept.length;
    if (trimmed > 0) {
      console.log(`[CloudLLM] Auto-trimmed ${trimmed} oldest messages to fit ${model} context (${contextLimit} tokens)`);
    }
    return [system, ...kept, user];
  }

  // ─── Proxy routing ──────────────────────────────────────────────────────────

  /**
   * Route through the guIDE server proxy when using bundled keys + valid session.
   * Server enforces per-user daily quotas.  Falls back to direct if unreachable.
   */
  async _generateViaProxy(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, sessionToken) {
    const messages = [
      ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: prompt },
    ];

    const proxyBody = JSON.stringify({
      provider, model, messages, systemPrompt,
      maxTokens: options.maxTokens || 2048,
      temperature: options.temperature || 0.7,
      stream: !!onToken,
    });

    try {
      const result = await this._streamRequest(
        'graysoft.dev', '/api/ai/proxy', sessionToken, proxyBody,
        'openai', onToken, {}, onThinkingToken, provider
      );
      return { ...result, model, provider, viaProxy: true };
    } catch (err) {
      if (err.message && (err.message.includes('quota_exceeded') || err.message.includes('429'))) {
        const e = new Error(err.message);
        e.isQuotaError = true;
        throw e;
      }
      console.warn(`[CloudLLM] Proxy request failed for ${provider}, falling through to direct:`, err.message?.substring(0, 120));
      throw err;
    }
  }

  // ─── Main generate entry point ──────────────────────────────────────────────

  async generate(prompt, options = {}) {
    const provider = options.provider || this.activeProvider;
    const model = options.model || this.activeModel;
    const systemPrompt = options.systemPrompt || CLOUD_SYSTEM_PROMPT;
    const onToken = options.onToken;
    const onThinkingToken = options.onThinkingToken || null;
    const conversationHistory = options.conversationHistory || [];
    const images = options.images || [];
    const noFallback = options.noFallback || false;

    if (!provider || (!this.apiKeys[provider] && provider !== 'ollama')) {
      throw new Error(`No API key configured for ${provider}`);
    }

    // Ollama — local, no key needed
    if (provider === 'ollama') {
      return this._generateOllama(model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
    }

    // Proxy routing: authenticated + bundled key + no images + not skipped
    const sessionToken = this._licenseManager?.getSessionToken();
    if (sessionToken && this._isBundledProvider(provider) && !(images && images.length > 0) && !options.skipProxy) {
      try {
        return await this._generateViaProxy(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, sessionToken);
      } catch (err) {
        if (err.isQuotaError) throw err;
        console.warn('[CloudLLM] Proxy unreachable, using direct bundled key as fallback');
      }
    }

    // Vision check — warn if images sent to non-vision model
    if (images && images.length > 0 && !this._supportsVision(provider, model)) {
      if (onToken) {
        onToken(`\n\n*Note: ${model} does not support image input. Images will be ignored. Use a vision-capable model like GPT-4o, Claude Sonnet 4, or Gemini 2.5 for image analysis.*\n\n`);
      }
      options.images = [];
    }

    // Check provider cooldown
    const now = Date.now();
    let providerOnCooldown = false;
    if (this._rateLimitedUntil[provider] && this._rateLimitedUntil[provider] > now) {
      const pool = this._keyPools[provider];
      const hasAvailableKey = pool && pool.some(e => e.cooldownUntil <= now);
      if (hasAvailableKey) {
        console.log(`[CloudLLM] ${provider} provider cooldown but pool has available keys, retrying...`);
        delete this._rateLimitedUntil[provider];
      } else {
        providerOnCooldown = true;
        const waitSec = Math.ceil((this._rateLimitedUntil[provider] - now) / 1000);
        console.log(`[CloudLLM] ${provider} on cooldown for ${waitSec}s, switching seamlessly to next provider`);
      }
    }

    // Attempt generation (unless provider is fully on cooldown)
    if (!providerOnCooldown) {
      const result = await this._attemptWithPoolRotation(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images, noFallback);
      if (result) return result;
    }

    // Build and attempt fallback chain
    if (noFallback) {
      throw new Error(`Rate limited on all available providers. Please wait a minute and try again.`);
    }
    return this._attemptFallbackChain(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
  }

  /**
   * Attempt generation with key pool rotation on 429.
   * Returns the result, or null if all keys exhausted (caller should fallback).
   */
  async _attemptWithPoolRotation(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images, noFallback) {
    const proactivePace = this.getProactivePaceMs(provider);
    if (proactivePace > 0) {
      console.log(`[CloudLLM] Proactive pacing: waiting ${proactivePace}ms before ${provider} request (RPM budget management)`);
      await new Promise(r => setTimeout(r, proactivePace));
    }

    const pool = this._keyPools[provider];
    const maxRetries = pool ? pool.length : 1;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const attemptKey = this._getPoolKey(provider) || this.apiKeys[provider];
      if (!attemptKey) break;

      this._recordRequest(provider);

      try {
        return await this._executeGeneration(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images, attemptKey);
      } catch (err) {
        const msg = err.message || '';
        const msgLower = msg.toLowerCase();
        const is429 = msg.includes('429') || msg.includes('401') || msg.includes('413') || msgLower.includes('rate limit') || msgLower.includes('unauthorized') || msgLower.includes('too large') || msgLower.includes('tokens per minute');
        const is403 = !is429 && (msg.includes('403') || msgLower.includes('forbidden'));
        const is5xx = !is429 && !is403 && (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('ECONNRESET') || msgLower.includes('timeout'));

        if (is429) {
          this._recent429Timestamps.push(Date.now());
          this._cooldownPoolKey(provider, attemptKey, 60000);

          if (pool && pool.length > 1 && attempt < maxRetries - 1) {
            console.log(`[CloudLLM] 429 on ${provider} key ...${attemptKey.slice(-6)}, rotating (attempt ${attempt + 2}/${maxRetries})`);
            continue;
          }

          this._rateLimitedUntil[provider] = Date.now() + 60000;
          console.log(`[CloudLLM] 429 on ${provider} (all pool keys exhausted), cooldown for 60s`);

          if (noFallback) {
            const label = (this._isBundledProvider(provider) && !this.isUsingOwnKey(provider))
              ? 'guIDE Cloud AI'
              : this._getProviderLabel(provider);
            throw new Error(`${label} rate limited. Please wait a minute or try a different model.`);
          }
          return null; // Signal caller to use fallback chain
        }

        if (is403 || is5xx) {
          const cooldownMs = is403 ? 300000 : 60000;
          this._rateLimitedUntil[provider] = Date.now() + cooldownMs;
          console.log(`[CloudLLM] ${msg.substring(0, 80)} on ${provider}, cooldown ${cooldownMs / 1000}s, falling to fallback chain`);
          return null;
        }

        throw err; // Non-retryable error
      }
    }
    return null;
  }

  /**
   * Build and attempt the fallback chain when the primary provider fails.
   */
  async _attemptFallbackChain(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images) {
    const fallbackChain = [];
    const now = Date.now();

    // If Google, try other Gemini models first (rate limits are per-model)
    if (provider === 'google') {
      const altModels = (PROVIDER_MODELS.google || []).map(m => m.id).filter(m => m !== model);
      for (const altModel of altModels) {
        fallbackChain.push({ provider: 'google', model: altModel });
      }
    }

    // Other providers in priority order
    for (const p of FALLBACK_ORDER) {
      if (p === provider) continue;
      if (!this.apiKeys[p]) continue;
      if (this._rateLimitedUntil[p] && this._rateLimitedUntil[p] > now) continue;

      const pModel = PREFERRED_FALLBACK_MODEL[p] || (PROVIDER_MODELS[p] || [])[0]?.id;
      if (pModel) fallbackChain.push({ provider: p, model: pModel });
    }

    for (const fb of fallbackChain) {
      if (fb.provider !== 'google' && this._rateLimitedUntil[fb.provider] && this._rateLimitedUntil[fb.provider] > Date.now()) continue;

      console.log(`[CloudLLM] Falling back to ${fb.provider}/${fb.model}`);
      await new Promise(r => setTimeout(r, 0));

      try {
        const result = await this._executeGeneration(fb.provider, fb.model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
        result.fallbackUsed = { from: provider, to: fb.provider, model: fb.model };
        return result;
      } catch (fbErr) {
        const msg = fbErr.message || '';
        const msgLower = msg.toLowerCase();

        if (msg.includes('429') || msg.includes('413') || msgLower.includes('rate limit') || msgLower.includes('too large') || msgLower.includes('tokens per minute')) {
          this._rateLimitedUntil[fb.provider] = Date.now() + 60000;
          console.log(`[CloudLLM] Fallback ${fb.provider} also rate limited (cooldown 60s), trying next...`);
          continue;
        }
        if (msg.includes('403') || msgLower.includes('forbidden')) {
          this._rateLimitedUntil[fb.provider] = Date.now() + 300000;
          console.log(`[CloudLLM] Fallback ${fb.provider} 403 forbidden, cooldown 5min, trying next...`);
          continue;
        }
        if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msgLower.includes('timeout') || msg.includes('ECONNRESET')) {
          console.log(`[CloudLLM] Fallback ${fb.provider} transient error: ${msg.substring(0, 100)}, trying next...`);
          continue;
        }
        throw fbErr;
      }
    }

    throw new Error('Rate limited on all available providers. Please wait a minute and try again.');
  }

  // ─── Provider routing ───────────────────────────────────────────────────────

  _executeGeneration(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images = [], overrideKey = null) {
    if (provider === 'ollama') {
      return this._generateOllama(model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
    }

    const apiKey = overrideKey || this._getPoolKey(provider) || this.apiKeys[provider];
    if (!apiKey) throw new Error(`No API key configured for ${provider}`);

    if (provider === 'apifreellm') {
      return this._generateAPIFreeLLM(apiKey, systemPrompt, prompt, options, onToken, conversationHistory);
    }
    if (provider === 'anthropic') {
      return this._generateAnthropic(apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
    }

    // All other providers use OpenAI-compatible format
    return this._generateOpenAICompatible(provider, apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
  }

  // ─── OpenAI-compatible generation (24 providers) ────────────────────────────

  async _generateOpenAICompatible(provider, apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = []) {
    const endpoint = this._getEndpoint(provider);
    let messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
    ];

    if (images && images.length > 0) {
      const userContent = [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image_url',
          image_url: { url: img.data.startsWith('data:') ? img.data : `data:${img.mimeType || 'image/png'};base64,${img.data}` },
        })),
      ];
      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    messages = this._trimToContextLimit(messages, provider, model, options.maxTokens);

    const body = JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages,
      max_tokens: options.maxTokens || 2048,
      temperature: options.temperature || 0.7,
      stream: !!onToken,
    });

    if (onToken) {
      return this._streamRequest(endpoint.host, endpoint.path, apiKey, body, 'openai', onToken, {}, onThinkingToken, provider);
    }

    const data = await this._makeRequest(endpoint.host, endpoint.path, apiKey, body, {}, provider);
    try {
      const parsed = JSON.parse(data);
      return {
        text: parsed.choices?.[0]?.message?.content || '',
        model: parsed.model || model,
        tokensUsed: parsed.usage?.total_tokens || 0,
      };
    } catch {
      throw new Error(`Invalid JSON response from ${provider}: ${String(data).substring(0, 200)}`);
    }
  }

  // ─── Anthropic generation ───────────────────────────────────────────────────

  async _generateAnthropic(apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = []) {
    const endpoint = this._getEndpoint('anthropic');
    const messages = [
      ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
    ];

    if (images && images.length > 0) {
      const userContent = [
        ...images.map(img => {
          let base64Data = img.data;
          let mediaType = img.mimeType || 'image/png';
          if (base64Data.startsWith('data:')) {
            const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
            if (match) { mediaType = match[1]; base64Data = match[2]; }
          }
          return {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          };
        }),
        { type: 'text', text: prompt },
      ];
      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const body = JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: options.maxTokens || 2048,
      system: systemPrompt,
      messages,
      stream: !!onToken,
    });

    const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };

    if (onToken) {
      return this._streamRequest(endpoint.host, endpoint.path, apiKey, body, 'anthropic', onToken, headers, onThinkingToken, 'anthropic');
    }

    const data = await this._makeRequest(endpoint.host, endpoint.path, apiKey, body, headers, 'anthropic');
    try {
      const parsed = JSON.parse(data);
      const text = parsed.content?.map(b => b.text).join('') || '';
      return {
        text,
        model: parsed.model || model,
        tokensUsed: (parsed.usage?.input_tokens || 0) + (parsed.usage?.output_tokens || 0),
      };
    } catch {
      throw new Error(`Invalid JSON response from anthropic: ${String(data).substring(0, 200)}`);
    }
  }

  // ─── Ollama local generation (NDJSON streaming) ─────────────────────────────

  async _generateOllama(model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = []) {
    const maxTokens = options.maxTokens || 4096;
    const temperature = options.temperature ?? 0.7;

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const h of conversationHistory) messages.push({ role: h.role, content: h.content });

    const userMsg = { role: 'user', content: prompt };
    if (images && images.length > 0) {
      userMsg.images = images.map(img => {
        const src = typeof img === 'string' ? img : (img.data || img.dataUrl || '');
        const b64Match = src.match(/^data:[^;]+;base64,(.+)$/);
        return b64Match ? b64Match[1] : src;
      }).filter(Boolean);
    }
    messages.push(userMsg);

    const body = JSON.stringify({
      model, messages,
      stream: !!onToken,
      options: { temperature, num_predict: maxTokens },
    });

    return new Promise((resolve, reject) => {
      const postOptions = {
        hostname: 'localhost', port: 11434, path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000,
      };

      let fullText = '';
      const req = http.request(postOptions, (res) => {
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', c => errBody += c);
          res.on('end', () => reject(new Error(`Ollama ${res.statusCode}: ${errBody.substring(0, 200)}`)));
          return;
        }

        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              const token = obj?.message?.content || '';
              if (token) {
                fullText += token;
                if (onToken) onToken(token);
              }
              if (obj.done) {
                resolve({ text: fullText, model, provider: 'ollama', tokensUsed: Math.ceil(fullText.length / 4) });
              }
            } catch { /* skip malformed lines */ }
          }
        });
        res.on('end', () => {
          if (buf.trim()) {
            try {
              const obj = JSON.parse(buf);
              const token = obj?.message?.content || '';
              if (token) { fullText += token; if (onToken) onToken(token); }
            } catch { /* ignore */ }
          }
          resolve({ text: fullText, model, provider: 'ollama', tokensUsed: Math.ceil(fullText.length / 4) });
        });
        res.on('error', reject);
      });

      req.on('error', (err) => reject(new Error(`Ollama connection failed: ${err.message}. Is Ollama running? (ollama serve)`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Ollama request timed out after 120s')); });
      req.write(body);
      req.end();
    });
  }

  // ─── APIFreeLLM generation (custom non-OpenAI format) ───────────────────────

  async _generateAPIFreeLLM(apiKey, systemPrompt, prompt, options, onToken, conversationHistory = []) {
    const now = Date.now();
    const elapsed = now - this._apifreellmLastRequest;
    if (elapsed < 5000) {
      const waitMs = 5000 - elapsed;
      console.log(`[CloudLLM] APIFreeLLM throttle: waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    this._apifreellmLastRequest = Date.now();

    const endpoint = this._getEndpoint('apifreellm');
    let fullMessage = '';
    if (systemPrompt) fullMessage += `[System: ${systemPrompt}]\n\n`;
    for (const msg of conversationHistory) {
      fullMessage += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n\n`;
    }
    fullMessage += `User: ${prompt}`;

    const body = JSON.stringify({ message: fullMessage, model: 'apifreellm' });

    try {
      const data = await this._makeRequest(endpoint.host, endpoint.path, apiKey, body, {}, 'apifreellm');
      const parsed = JSON.parse(data);
      if (!parsed.success) throw new Error(parsed.error || 'APIFreeLLM returned an error');

      const text = parsed.response || '';
      if (onToken && text) {
        for (const word of text.split(' ')) onToken(word + ' ');
      }
      return { text, model: 'APIFreeLLM 200B+', tokensUsed: Math.ceil(text.length / 4) };
    } catch (error) {
      if (error.message && error.message.includes('429')) {
        throw new Error('APIFreeLLM rate limit — free tier allows 1 request every 5 seconds. Please wait and retry.');
      }
      throw error;
    }
  }

  // ─── HTTP request helpers ───────────────────────────────────────────────────

  _makeRequest(host, path, apiKey, body, extraHeaders = {}, provider = null) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      };
      if (apiKey && !extraHeaders['x-api-key']) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = https.request({ host, path, method: 'POST', headers, agent: keepAliveAgent }, (res) => {
        if (provider && res.statusCode < 400) {
          this._learnRPMFromHeaders(provider, res.headers);
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            this._rejectWithParsedError(reject, res.statusCode, data, provider || host);
          } else {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(20000, () => {
        req.destroy();
        reject(new Error(`Request timeout to ${host}. Try again or switch models.`));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * Parse an API error response and produce a clear error message.
   */
  _rejectWithParsedError(reject, statusCode, data, source) {
    let errMsg = `API error ${statusCode}: ${data.substring(0, 300)}`;
    try {
      const errObj = JSON.parse(data);
      const msg = errObj?.error?.message || errObj?.error || data.substring(0, 300);
      const code = errObj?.error?.code || statusCode;

      if (code !== 429) {
        console.error(`[CloudLLM] API error from ${source}: HTTP ${statusCode} / code=${code} — ${String(msg).substring(0, 200)}`);
      }

      if (code === 429) {
        errMsg = 'Rate limited (429). Free model quota exhausted. Try switching to a different model or wait a few minutes.';
      } else if (code === 404) {
        errMsg = 'Model not found (404). It may have been removed or renamed. Try a different model.';
      } else if (code === 400 && String(msg).toLowerCase().includes('decommission')) {
        errMsg = 'This model has been decommissioned. Please select a different model.';
      } else if (code === 400 && (String(msg).includes('not enabled') || String(msg).toLowerCase().includes('developer instruction'))) {
        errMsg = `Model error (400): ${msg}. This model doesn't support system prompts. Try a different model.`;
      } else {
        errMsg = `API error ${code}: ${msg}`;
      }
    } catch {
      console.error(`[CloudLLM] API error from ${source}: HTTP ${statusCode} — ${data.substring(0, 200)}`);
    }
    reject(new Error(errMsg));
  }

  _streamRequest(host, path, apiKey, body, format, onToken, extraHeaders = {}, onThinkingToken = null, provider = null) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      };
      if (apiKey && !extraHeaders['x-api-key']) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      let fullText = '';
      let firstDataTimer = null;
      let idleTimer = null;

      const clearTimers = () => {
        if (firstDataTimer) { clearTimeout(firstDataTimer); firstDataTimer = null; }
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      };

      const req = https.request({ host, path, method: 'POST', headers, agent: keepAliveAgent }, (res) => {
        if (provider && res.statusCode < 400) {
          this._learnRPMFromHeaders(provider, res.headers);
        }

        if (res.statusCode >= 400) {
          clearTimers();
          let errData = '';
          res.on('data', chunk => errData += chunk);
          res.on('end', () => {
            let errMsg = `API error ${res.statusCode}: ${errData.substring(0, 500)}`;
            try {
              const errObj = JSON.parse(errData);
              const msg = errObj?.error?.message || errObj?.error || errData.substring(0, 300);
              if (res.statusCode === 429) {
                errMsg = 'Rate limited (429). Pool rotation will handle this.';
              } else if (res.statusCode === 400) {
                const msgLower = String(msg).toLowerCase();
                if (msgLower.includes('decommission')) {
                  errMsg = 'This model has been decommissioned. Please select a different model.';
                } else if (msgLower.includes('not enabled') || msgLower.includes('developer instruction')) {
                  errMsg = "This model doesn't support system/developer prompts. Try a different model.";
                } else {
                  errMsg = `Model error (400): ${msg}`;
                }
              } else if (res.statusCode === 404) {
                errMsg = 'Model not found (404). It may have been removed or renamed. Try a different model.';
              } else {
                errMsg = `API error ${res.statusCode}: ${msg}`;
              }
            } catch { /* use default errMsg */ }
            reject(new Error(errMsg));
          });
          return;
        }

        let buffer = '';
        let gotFirstData = false;

        firstDataTimer = setTimeout(() => {
          console.error(`[CloudLLM] Stream timeout: no data received within ${STREAM_TIMEOUT / 1000}s from ${host}`);
          clearTimers();
          req.destroy();
          reject(new Error(`No response from ${host} within ${STREAM_TIMEOUT / 1000}s. The model may be overloaded. Try again or switch models.`));
        }, STREAM_TIMEOUT);

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            console.error(`[CloudLLM] Stream idle timeout: no data for ${IDLE_TIMEOUT / 1000}s from ${host}`);
            clearTimers();
            req.destroy();
            if (fullText) {
              resolve({ text: fullText, model: 'cloud', tokensUsed: fullText.length / 4 });
            } else {
              reject(new Error(`Stream stalled from ${host}. Try again or switch models.`));
            }
          }, IDLE_TIMEOUT);
        };

        res.on('data', (chunk) => {
          if (!gotFirstData) {
            gotFirstData = true;
            if (firstDataTimer) { clearTimeout(firstDataTimer); firstDataTimer = null; }
          }
          resetIdleTimer();

          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              let token = '';
              let thinkingToken = '';

              if (format === 'openai') {
                const delta = parsed.choices?.[0]?.delta;
                token = delta?.content || '';
                thinkingToken = delta?.reasoning_content || delta?.reasoning || '';
              } else if (format === 'anthropic') {
                if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'thinking') {
                  // Thinking block start — no content yet
                } else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta') {
                  thinkingToken = parsed.delta?.thinking || '';
                } else if (parsed.type === 'content_block_delta') {
                  token = parsed.delta?.text || '';
                }
              }

              if (thinkingToken && onThinkingToken) onThinkingToken(thinkingToken);
              if (token) {
                fullText += token;
                onToken(token);
              }
            } catch { /* skip malformed JSON */ }
          }
        });

        res.on('end', () => {
          clearTimers();
          resolve({ text: fullText, model: 'cloud', tokensUsed: fullText.length / 4 });
        });
      });

      req.on('error', (err) => {
        clearTimers();
        reject(err);
      });
      req.setTimeout(STREAM_TIMEOUT, () => {
        console.error(`[CloudLLM] Socket timeout from ${host}`);
        clearTimers();
        req.destroy();
        reject(new Error(`Connection timeout to ${host}. Try again or switch models.`));
      });
      req.write(body);
      req.end();
    });
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  getStatus() {
    const configured = this.getConfiguredProviders();
    return {
      hasKeys: configured.length > 0,
      providers: configured.map(p => p.provider),
      activeProvider: this.activeProvider,
      activeModel: this.activeModel,
    };
  }
}

module.exports = { CloudLLMService };
