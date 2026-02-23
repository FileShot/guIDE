# Pocket guIDE — Round 2 Benchmark: Complex Web Automation

## Test Parameters

| Parameter | Value |
|-----------|-------|
| **Task** | Navigate Domino's Pizza website, explore menus, find prices, fill forms, take screenshots, document findings |
| **Prompt** | "Go to dominos.com and navigate through the pizza ordering process. Browse the menu pages, find specialty pizzas and prices, explore customization options, and fill out any forms you encounter (delivery address, pizza builder, etc.) without actually placing an order. Document all your findings — page titles, menu items, prices, forms, and options — in a file called dominos-research.md. Take screenshots of key pages." |
| **Date** | 2025-07-22 |
| **Platform** | Pocket guIDE (pocket.graysoft.dev) |
| **Browser** | Chromium (headless, Playwright-managed) |

---

## Results Summary

| Model | Tools Used | Failed | Tokens | Output Size | Screenshots | Agent Plan | Rating |
|-------|-----------|--------|--------|-------------|-------------|------------|--------|
| **GPT-OSS 120B** | 56 | 3 | 1.4M | 4.1 KB (78 lines) | 6 actual PNGs | Yes (9 steps) | ★★★★★ |
| **Qwen 3 32B** | 11 | 4 | ~800K | ~2 KB | Referenced | Yes (9 steps) | ★★★★☆ |
| **ZAI GLM 4.7** | 24 | 3 | 714K | ~1.5 KB (40 lines) | None | No | ★★★☆☆ |
| **Qwen 3 235B** | 7 | 2 | 1.2M | ~1.5 KB | Placeholder refs | No | ★★½☆☆ |
| **Llama 3.3 70B** | 8 | 3 | 731K | ~0.8 KB (20 lines) | None | No | ★★☆☆☆ |
| **Llama 3.1 8B** | 48 | 8 | 1.1M | ~0.2 KB (4 lines) | None | No | ★☆☆☆☆ |

---

## Detailed Model Analysis

### 1. GPT-OSS 120B (Reasoning) — ★★★★★

**The clear winner.** Best output quality by a wide margin.

- **Tools**: 56 (3 failed) — highest tool count, but purposeful and systematic
- **Tokens**: 1.4M
- **Output**: 78-line professional Markdown document with full page-by-page documentation
- **Highlights**:
  - Created an **Agent Plan** (9 steps) before executing — showed strategic thinking
  - **6 actual screenshots** saved to `/workspace/screenshots/` (home, menu, pizza, specialty, build-your-own, customization)
  - **Specific prices** with size breakdowns: Personal $5.99, Small $9.99, Medium $12.99, Large $14.99
  - **Form details** documented at HTML level: radio buttons for size/crust/sauce/cheese, checkboxes for toppings, price per topping ($1.00 meat, $0.75 veggie), surcharges (Gluten-Free +$1.00)
  - **Complete specialty pizza list** with all toppings for each variety (11 pizzas)
  - **Multiple pages visited**: Home, Menu, Pizza, Specialty, Build Your Own, Deals, Store Locator, Careers, Contact
  - Clean formatting with URLs, titles, and cross-references to screenshots
- **Weaknesses**: Highest token consumption (1.4M), most tools used

---

### 2. Qwen 3 32B — ★★★★☆

**Best efficiency-to-quality ratio.** Strong structured output with minimal tool usage.

- **Tools**: 11 (4 failed) — very efficient
- **Tokens**: ~800K
- **Output**: Well-structured doc with real prices and step-by-step documentation
- **Highlights**:
  - Created a **9-step Agent Plan** before executing (like GPT-OSS)
  - **Real prices found**: Medium $10.99, specialty crusts $12.49, toppings $2.50-$3.00
  - Used **thinking chains** (`<think>` blocks) to reason about navigation strategy
  - Good balance of breadth (multiple pages) and depth (prices, options)
  - Most efficient model that still produced quality output
- **Weaknesses**: Some failed tools (4/11), screenshot references but not actual files, less detail than GPT-OSS

---

### 3. ZAI GLM 4.7 (Default) — ★★★☆☆

**Solid baseline performer.** Functional output with reasonable coverage.

- **Tools**: 24 (3 failed)
- **Tokens**: 714K — most token-efficient of all models
- **Output**: 40-line document with page titles, menu items, offers, and forms
- **Highlights**:
  - Found **Mix & Match Deal** at $6.99 each
  - **Filled a delivery address form** (123 Main Street, ZIP 10001) — only model to actually fill address fields
  - Documented offers, menu categories, and navigation structure
  - Consistent and reliable execution
- **Weaknesses**: No screenshots, no prices for individual pizzas, less depth than top performers

---

### 4. Qwen 3 235B (Preview) — ★★½☆☆

**Underwhelming for its size.** Generic output despite being the largest Qwen model.

- **Tools**: 7 (2 failed) — fewest tools used
- **Tokens**: 1.2M — high token usage for low output
- **Output**: ~1.5 KB with page titles and category names but lacking depth
- **Highlights**:
  - Mentioned specific pizza names: "Create Your Own Pizza", "MeatZZa", "Honolulu Hawaiian"
  - Documented page titles and general categories
  - Fewest tool failures (2)
- **Weaknesses**: **No prices anywhere**, placeholder screenshot references (not actual files), very generic descriptions, poor token efficiency (1.2M tokens for minimal output), did not explore customization or forms

---

### 5. Llama 3.3 70B — ★★☆☆☆

**Minimal effort.** Acknowledged limitations but didn't push through them.

- **Tools**: 8 (3 failed)
- **Tokens**: 731K
- **Output**: 20-line document with basic page titles and a few prices
- **Highlights**:
  - Found **Medium Handmade Pan Pizza at $13.99**, toppings at $1.50
  - Honest about limitations — noted "some pages weren't navigated"
  - At least documented what it found accurately
- **Weaknesses**: Only 20 lines of output, didn't explore customization forms, no screenshots, gave up too early on navigation challenges, low page coverage

---

### 6. Llama 3.1 8B (Fast) — ★☆☆☆☆

**Failed the task.** High activity, near-zero useful output.

- **Tools**: 48 (8 failed) — second-highest tool count but wasteful
- **Tokens**: 1.1M — very poor efficiency
- **Output**: **4 lines** — just a "Task Completion" checklist
- **Highlights**:
  - None — the model **overwrote its own file multiple times**, losing accumulated content each time
  - High tool count (48) indicates frantic, uncoordinated activity
  - 8 failed tools — highest failure rate (17%)
- **Weaknesses**: Completely failed to produce useful documentation. Demonstrated inability to maintain state across tool calls. The file was rewritten from scratch multiple times, finally ending with a 4-line summary that contained no actual research data. Worst token efficiency of any model.

---

## Key Findings

### What Separates Good from Great
1. **Agent Planning**: Models that created an Agent Plan (GPT-OSS 120B, Qwen 3 32B) produced significantly better structured output
2. **Screenshot capture**: Only GPT-OSS 120B actually saved screenshot files — visual documentation is a differentiator
3. **Price specificity**: Top models found actual dollar amounts; weaker models only listed category names
4. **Form interaction**: Only ZAI GLM 4.7 filled address fields; GPT-OSS 120B documented form structure at HTML level
5. **File management**: Llama 3.1 8B's repeated file overwrites show that smaller models struggle with stateful multi-step workflows

### Tool Efficiency Rankings
| Model | Tools/KB Output | Assessment |
|-------|----------------|------------|
| Qwen 3 32B | ~5.5 | Most efficient |
| ZAI GLM 4.7 | ~16 | Good |
| Qwen 3 235B | ~4.7 | Efficient tools, poor output |
| Llama 3.3 70B | ~10 | Average |
| GPT-OSS 120B | ~13.7 | Justified by quality |
| Llama 3.1 8B | ~240 | Extremely wasteful |

### Token Efficiency Rankings
| Model | Tokens/KB Output | Assessment |
|-------|-----------------|------------|
| ZAI GLM 4.7 | ~476K/KB | Best |
| Llama 3.3 70B | ~914K/KB | Average |
| Qwen 3 32B | ~400K/KB | Excellent |
| GPT-OSS 120B | ~341K/KB | Best per KB |
| Qwen 3 235B | ~800K/KB | Poor |
| Llama 3.1 8B | ~5.5M/KB | Catastrophic |

---

## Combined Rankings (Round 1 + Round 2)

| Model | Round 1 (Web+Game) | Round 2 (Web Automation) | Overall |
|-------|-------------------|-------------------------|---------|
| **GPT-OSS 120B** | 2nd | 1st ★★★★★ | **1st** |
| **Qwen 3 32B** | 3rd | 2nd ★★★★☆ | **2nd** |
| **ZAI GLM 4.7** | 1st | 3rd ★★★☆☆ | **3rd** |
| **Qwen 3 235B** | 4th | 4th ★★½☆☆ | **4th** |
| **Llama 3.3 70B** | 5th | 5th ★★☆☆☆ | **5th** |
| **Llama 3.1 8B** | 6th | 6th ★☆☆☆☆ | **6th** |

### Analysis
- **GPT-OSS 120B** rises from 2nd to 1st overall — its reasoning capabilities shine on complex multi-step tasks
- **Qwen 3 32B** is the sleeper hit — excellent quality at lower cost, best efficiency-to-quality ratio
- **ZAI GLM 4.7** drops from 1st to 3rd — strong on creative tasks but less dominant on structured research
- **Qwen 3 235B** underperforms its size — the "preview" label may indicate it's not fully optimized
- **Llama models** consistently rank at the bottom for agentic web tasks — the 8B model in particular cannot handle stateful multi-step workflows

---

*Benchmark conducted on Pocket guIDE v2.0 using Groq cloud inference. All models used identical prompts and browser environment.*
