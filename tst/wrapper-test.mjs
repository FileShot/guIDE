/**
 * wrapper-test.mjs — Empirically test ALL chat wrappers on a given GGUF model.
 *
 * Usage:
 *   node tst/wrapper-test.mjs                             (tests Llama 3.2 3B)
 *   node tst/wrapper-test.mjs D:\models\qwen2.5-1.5b-instruct-q8_0.gguf
 *
 * Tests every available wrapper with:
 *   - The short "chat" system prompt (what failing models get)
 *   - The full "general" system prompt with tool schema (what working 0.6B gets)
 *
 * Prints the COMPLETE raw response. You read it. You decide if it's coherent.
 */

import {
  getLlama, LlamaChat,
  JinjaTemplateChatWrapper,
  Llama3_2LightweightChatWrapper,
  Llama3_1ChatWrapper,
  Llama3ChatWrapper,
  Llama2ChatWrapper,
  QwenChatWrapper,
  MistralChatWrapper,
  ChatMLChatWrapper,
  DeepSeekChatWrapper,
  GemmaChatWrapper,
  FalconChatWrapper,
  HarmonyChatWrapper,
  GeneralChatWrapper,
} from 'node-llama-cpp';

// ── Config ───────────────────────────────────────────────────────────────────
const MODEL_PATH = process.argv[2] || 'D:\\models\\Llama-3.2-3B-Instruct-Q4_K_S.gguf';
const MAX_TOKENS         = 120;   // Standard test — enough to see real output
const MAX_TOKENS_PROD    = 512;   // Production uses 4096 — cap at 512 to avoid runaway
const CONTEXT_SIZE_TEST  = 4096;
const CONTEXT_SIZE_PROD  = 6144;  // Production value

// Production sampling — exact values from llmEngine.js defaultParams
const SAMPLING = {
  temperature: 0.5,
  topP: 0.9,
  topK: 20,
  repeatPenalty: {
    penalty: 1.15,
    frequencyPenalty: 0,
    presencePenalty: 0,
    lastTokensPenaltyCount: 128,
  },
};

// ── System prompts ────────────────────────────────────────────────────────────
// SHORT — what failing models get in chat taskType (185 chars in logs)
const CHAT_SYSTEM = `You are guIDE, an AI assistant built into a desktop IDE by Brendan Gray.
Answer questions, help with code and concepts, and have normal conversations.
Be concise, direct, and helpful.

`;

// GENERAL — what the working 0.6B gets (with full tool schema)
const GENERAL_SYSTEM = `You are guIDE, an AI assistant in a desktop IDE by Brendan Gray.
You help with coding, files, web browsing, and questions.
Use your tools when tasks require action. For conversation or knowledge questions, just answer directly.

## Tool format
\`\`\`json
{"tool":"tool_name","params":{"key":"value"}}
\`\`\`

## Rules
- Call tools to take action -- don't just describe what you would do.
- write_file to create or save code. Never paste file contents into chat as text.
- edit_file (oldText/newText) to modify files. read_file first to get exact text.
- Real data only -- use web_search or browser_navigate for live info. Never invent URLs.
- Tool fails: try a different approach. Windows/PowerShell for terminal commands.
- Never tell the user to run a command yourself -- use your tools to do it directly.
- Keep responses concise. Acknowledge briefly before tools, confirm briefly after.`;

// ── Test cases ────────────────────────────────────────────────────────────────
// prod:true → uses contextSize=6144, maxTokens=512, budgets:{thoughtTokens:0}
const TEST_CASES = [
  { label: 'CHAT system + "hi"',                    system: CHAT_SYSTEM,    user: 'hi',           prod: false },
  { label: 'CHAT system + "hi" [PRODUCTION params]', system: CHAT_SYSTEM,    user: 'hi',           prod: true  },
  { label: 'GENERAL system + "hi"',                 system: GENERAL_SYSTEM, user: 'hi',           prod: false },
  { label: 'CHAT system + math',                    system: CHAT_SYSTEM,    user: 'What is 2+2?', prod: false },
];

// ── Wrappers to test ──────────────────────────────────────────────────────────
// All wrappers available in node-llama-cpp — tested in this order.
// JinjaTemplateChatWrapper is first since it reads the model's own embedded template.
// NOTE: Llama3_2Lightweight has two variants:
//   (default)  — injects "Cutting Knowledge Date / Today Date" preamble (how the model was trained)
//   (null dates) — production config: preamble removed. May cause salad if model expects the preamble.
const buildWrappers = (jinjaTemplate, tokenizer) => [
  jinjaTemplate
    ? { name: 'JinjaTemplateChatWrapper',                             w: new JinjaTemplateChatWrapper({ template: jinjaTemplate, tokenizer }) }
    : null,
  { name: 'QwenChatWrapper',                                          w: new QwenChatWrapper() },
  { name: 'Llama3_2LightweightChatWrapper (default=with dates)',      w: new Llama3_2LightweightChatWrapper() },
  { name: 'Llama3_2LightweightChatWrapper (null dates — PRODUCTION)', w: new Llama3_2LightweightChatWrapper({ todayDate: null, cuttingKnowledgeDate: null }) },
  { name: 'Llama3_1ChatWrapper',                                      w: new Llama3_1ChatWrapper() },
  { name: 'Llama3ChatWrapper',                                        w: new Llama3ChatWrapper() },
  { name: 'Llama2ChatWrapper',                                        w: new Llama2ChatWrapper() },
  { name: 'MistralChatWrapper',                                       w: new MistralChatWrapper() },
  { name: 'ChatMLChatWrapper',                                        w: new ChatMLChatWrapper() },
  { name: 'DeepSeekChatWrapper',                                      w: new DeepSeekChatWrapper() },
  { name: 'GemmaChatWrapper',                                         w: new GemmaChatWrapper() },
  { name: 'HarmonyChatWrapper',                                       w: new HarmonyChatWrapper() },
  { name: 'FalconChatWrapper',                                        w: new FalconChatWrapper() },
  { name: 'GeneralChatWrapper',                                       w: new GeneralChatWrapper() },
].filter(Boolean);

// ── Single wrapper test ───────────────────────────────────────────────────────
async function runOne(model, wrapperEntry, systemPrompt, userMessage, useProdParams = false) {
  let ctx = null, seq = null, chat = null;
  const contextSize = CONTEXT_SIZE_TEST; // Always use 4096 — 6144 exceeds test VRAM
  const maxTokens   = useProdParams ? MAX_TOKENS_PROD   : MAX_TOKENS;
  try {
    ctx  = await model.createContext({ contextSize, flashAttention: useProdParams });
    seq  = ctx.getSequence();
    chat = new LlamaChat({ contextSequence: seq, chatWrapper: wrapperEntry.w });

    const history = [];
    if (systemPrompt) history.push({ type: 'system', text: systemPrompt });
    history.push({ type: 'user', text: userMessage });

    let text = '';
    const t0 = Date.now();
    const genOpts = {
      maxTokens,
      temperature: SAMPLING.temperature,
      topP: SAMPLING.topP,
      topK: SAMPLING.topK,
      repeatPenalty: SAMPLING.repeatPenalty,
      onResponseChunk: (chunk) => { if (chunk.text) text += chunk.text; },
    };
    if (useProdParams) {
      // Matches production generateStream call in llmEngine.js exactly
      genOpts.budgets = { thoughtTokens: 0 };
      genOpts.contextShift = { strategy: 'eraseFirstResponseAndKeepFirstSystem' };
    }
    await chat.generateResponse(history, genOpts);
    return { text: text.trim(), ms: Date.now() - t0 };
  } catch (e) {
    return { text: null, error: e.message.slice(0, 200) };
  } finally {
    try { chat?.dispose(); }    catch (_) {}
    try { await seq?.dispose(); } catch (_) {}
    try { await ctx?.dispose(); } catch (_) {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(80));
  console.log(`WRAPPER TEST  |  ${MODEL_PATH}`);
  console.log('='.repeat(80));

  const llama = await getLlama({ gpu: 'auto' });
  const model = await llama.loadModel({ modelPath: MODEL_PATH, gpuLayers: 'auto' });

  const jinjaTemplate = model.fileInfo?.metadata?.tokenizer?.chat_template ?? null;
  const arch          = model.fileInfo?.metadata?.general?.architecture   ?? 'unknown';
  console.log(`Arch: ${arch}`);
  console.log(`Jinja template in model: ${jinjaTemplate ? 'YES (' + jinjaTemplate.length + ' chars)' : 'NO'}`);
  console.log();

  const wrappers = buildWrappers(jinjaTemplate, model.tokenizer);

  for (const tc of TEST_CASES) {
    console.log('\n' + '='.repeat(80));
    console.log(`TEST: ${tc.label}`);
    console.log('='.repeat(80));

    for (const wEntry of wrappers) {
      console.log(`\n  ── ${wEntry.name} ──`);
      const result = await runOne(model, wEntry, tc.system, tc.user, tc.prod);
      if (result.error) {
        console.log(`  ERROR: ${result.error}`);
      } else if (!result.text) {
        console.log(`  EMPTY (${result.ms}ms)`);
      } else {
        // Print the FULL response — no truncation. You read it.
        console.log(`  (${result.ms}ms)`);
        console.log(`  >>>${result.text}<<<`);
      }
    }
  }

  await model.dispose();
  await llama.dispose();
  console.log('\n' + '='.repeat(80));
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
