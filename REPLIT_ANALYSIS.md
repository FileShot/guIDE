# Replit Competitive Analysis & guIDE Pricing Strategy

## Replit Overview (Feb 2026)

### Pricing Tiers
| Plan | Price | Key Features |
|------|-------|--------------|
| **Starter** | Free | Free daily Agent credits, limited intelligence, publish 1 app |
| **Core** | $20/mo (annual) | $25 monthly credits, latest models, publish+host apps, autonomous long builds, 5 collaborators |
| **Pro** (NEW Feb 20, 2026) | $100/mo | Tiered credit discounts, priority support, 15 builders, 28-day data retention |
| **Enterprise** | Custom | SSO, custom viewer seats, security compliance |

### Agent 3 Features (What We Can Steal)
1. **Fast Build vs Full Build** — Quick ~3-5 min prototypes vs. 10+ min comprehensive autonomous builds. User toggles via ⚡ icon. *We should offer this too.*
2. **Plan Mode** — Agent creates implementation plan before coding. User reviews/iterates before approving build. *Our TODO system already does this, but we should make it more prominent.*
3. **App Testing** — Agent self-tests using a real browser, navigating the app like a user. Provides video replays. *We already have this (browser_navigate + screenshot) — we're actually ahead here.*
4. **Max Autonomy (Beta)** — Agent works up to 200 minutes unsupervised with long task lists. *We already have MAX_ITERATIONS=999999 — we're ahead.*
5. **Agents & Automations** — Build Slack bots, Telegram bots, timed automations. *Not directly applicable to our desktop IDE, but cloud version could support this.*
6. **Checkpoints/Rollbacks** — Snapshot entire workspace state, rollback if Agent breaks things. *We have git_commit/git_diff but not automatic checkpoints. This is a GAP.*
7. **Effort-Based Pricing** — Pay based on task complexity, not flat rate. Simple requests cost less. *Interesting but complex. Our $2.99/mo flat rate is simpler and more attractive.*
8. **File Attachments + URL Import + Screenshots** — Users can drag files, paste URLs, include screenshots in prompts. *We support images via vision models but could improve URL import.*

### Replit Weaknesses We Can Exploit
- **Expensive**: $20/mo minimum for any real usage, credits run out fast. Agent builds can cost $5+ each. Pro is $100/mo.
- **Cloud-only**: Everything runs in their cloud. No offline capability, no local models, no data privacy.
- **No desktop IDE**: Browser-only. Can't work with local files, local git repos, or existing dev environments.
- **Vendor lock-in**: Your code lives on Replit. If you stop paying, deployment goes down.
- **Credit anxiety**: Users constantly worry about running out of credits. Their blog literally says "Less credit anxiety" is a priority — meaning it was a problem.
- **No local models**: Can't run Llama, Qwen, etc. locally. Always depends on cloud AI.

### What Replit Does Better Than Us (Gaps to Close)
1. **One-click deployment** — Build → Deploy → Live URL in seconds. We don't have hosting.
2. **Checkpoints with full rollback** — Automatic snapshots at each agent step. Very useful for vibe coders.
3. **Real-time collaboration** — Multiple users editing same project. Our desktop IDE is single-user.
4. **Mobile app** — Build on the go. We don't have this.
5. **Database integration** — Built-in databases, object storage. Our users manage their own.
6. **Progress tab** — Visual timeline of Agent's actions with file links. Our terminal output is less visual.

---

## guIDE Pricing Strategy

### Philosophy
**Give the tool away free. Charge for the fuel.**

Replit charges $20-100/mo for access. We undercut them dramatically at $2.99/mo while offering MORE: a full desktop IDE + local model support + cloud API access.

### Tier Structure

#### Desktop IDE — FREE Forever
- Full-featured offline IDE (editor, terminal, git, browser, all tools)
- Local model support (Llama, Qwen, etc. via node-llama-cpp) — no internet required
- All agentic capabilities with local models
- Unlimited usage, no credits, no limits
- *Value prop: "VS Code + Copilot, but free and offline-capable"*

#### Cloud API Access — $2.99/month
- Access to cloud models (Cerebras, OpenAI, Anthropic, Google, etc.)
- Faster, smarter responses than local models
- Vision capabilities (screenshot analysis)
- Web search integration
- *How it works: API keys are server-side, user just pays subscription*

#### Web Version (pocket.graysoft.dev) — Freemium
- **Free tier**: Limited usage (enough to start a project and feel invested)
  - Suggestion: 50 messages/day or 30 minutes of agent time
  - After limit: prompt to subscribe
  - Key insight: Let them invest enough to create something they don't want to abandon
- **Paid tier**: $2.99/month for unlimited cloud model access

### Why $2.99/mo Works
1. **Impulse buy territory** — Less than a coffee. No decision friction.
2. **Undercuts everyone** — Replit Core: $20/mo. GitHub Copilot: $10/mo. Cursor: $20/mo. We're 85% cheaper.
3. **Volume play** — At scale, many $2.99 subs > fewer $20 subs. Lower churn.
4. **Free tier hooks them** — They build something, feel invested, $2.99 feels trivial to continue.
5. **API costs covered** — Cerebras free tier is generous. At $2.99/user/mo, we're profitable even at moderate usage.

### Free Tier Conversion Strategy
1. **Let them build** — First session is unrestricted. Let them create a project.
2. **Show the clock** — After X messages or Y minutes, show a gentle banner: "You've used 80% of your free tier today"
3. **Hit the wall** — When limit reached: "You've built something great! Continue for $2.99/month — less than a coffee."
4. **Sunk cost psychology** — They've already invested time creating files, writing code. Abandoning feels like losing work.
5. **Easy upgrade** — One-click subscribe, instant continuation. No interruption to flow.

### Implementation Needs
- [ ] License/subscription system for cloud API access
- [ ] Usage metering (messages per day or agent time)
- [ ] Payment integration (Stripe)
- [ ] Free tier limits in both web and desktop versions
- [ ] Graceful degradation: when cloud limit hit, offer local models as fallback
