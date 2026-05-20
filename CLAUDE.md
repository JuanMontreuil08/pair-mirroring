# CLAUDE.md — Pair Mirroring

## What this is

Pair Mirroring is an AI investment club that lives inside a Telegram group. 3-10 LATAM remote workers connect their individual Wallbit accounts. A per-member Claude agent analyzes each portfolio privately, mediates trade proposals in DMs, and posts only the final consensus to the group.

Built for the Wallbit hackathon. MVP scope: Axes 3 (Telegram-native), 4 (individual Wallbit context), 5 (private negotiation).

## gstack

- Use `/browse` for all web browsing tasks
- Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`

## Documentation
- Product spec (7 axes, demo flow): /docs/podwealth-spec.md
- Approved design doc (architecture, personas, build order): /docs/design.md
- Engineering plan (data model, day-by-day, failure modes): /docs/engineering-plan.md

## Stack
- Framework: Next.js 14 (App Router) + TypeScript
- Bot: Telegraf (Telegram Bot API)
- DB + Auth: Supabase
- AI agents: Anthropic Claude API (claude-sonnet-4-6) via @anthropic-ai/sdk
- Portfolio data: Wallbit read-only API

## Wallbit API

Base URL: `https://api.wallbit.io`

All requests require `X-API-Key` header:
```bash
curl -H "X-API-Key: $WALLBIT_API_KEY" https://api.wallbit.io/api/public/v1/balance/checking
```

### Available Endpoints (read-only — no trade execution)

**Balance**
- `GET /api/public/v1/balance/checking` - Cash balance
- `GET /api/public/v1/balance/stocks` - Investment portfolio (positions)

**Transactions**
- `GET /api/public/v1/transactions` - Transaction history (pagination + filters)

**Assets**
- `GET /api/public/v1/assets` - List available stocks/ETFs
- `GET /api/public/v1/assets/{symbol}` - Asset details (sector classification — check if field exists)

**Note:** POST /trades is NOT available. Trade execution is simulated in the demo.

### Error Codes
- `401` - Invalid/missing API key
- `403` - Insufficient permissions
- `412` - KYC incomplete or account locked
- `422` - Validation error
- `429` - Rate limited (check Retry-After header, use exponential backoff)

## Environment Variables
```
TELEGRAM_BOT_TOKEN          ← from @BotFather
ANTHROPIC_API_KEY           ← Claude API for per-member agents
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AES_KEY                     ← 32-byte hex string for encrypting Wallbit API keys
NEXTAUTH_URL                ← base URL (e.g. https://your-ngrok-url.ngrok.io)
```

## Folder structure
```
src/
  app/
    api/
      telegram/webhook/route.ts   ← Telegram webhook (instant 200 + background)
      pod/connect/route.ts        ← Magic link: save encrypted Wallbit key
  lib/
    wallbit/client.ts             ← Wallbit read API wrapper
    telegram/bot.ts               ← Telegraf init + export
    telegram/handlers/
      propose.ts                  ← /propose TICKER AMOUNT command
      vote.ts                     ← ✅ ❌ ⚙️ inline keyboard callbacks
      dm.ts                       ← send personalized DM per member
    pod/
      agent.ts                    ← per-member Claude call → AgentDecision
      orchestrator.ts             ← Promise.all + consensus logic
      negotiation.ts              ← state machine: round tracking
supabase/
  migrations/
    001_pod_schema.sql            ← pods, pod_members, proposals, proposal_votes
docs/
  podwealth-spec.md               ← 7 axes + demo flow
  design.md                       ← approved design doc
  engineering-plan.md             ← data model, day-by-day, failure modes
```

## Architecture

```
Telegram msg → POST /api/telegram/webhook (200 immediately)
               ↓ setImmediate (background)
   Parse: chat_id, user_id, text/callback_data
               ↓
           Supabase (state)
   pods | pod_members | proposals | proposal_votes
               ↓
   Action router:
     /propose → create proposal → Promise.all(member agents) → send DMs
     vote     → record vote → check consensus → group message or next DM
```

**Key decisions:**
- Instant 200 ACK on webhook — Telegram times out at 5s, agents take ~3s
- Promise.all for parallel per-member agents — not OpenClaw (unknown setup time)
- AES-256 encryption for Wallbit API keys before storing in Supabase
- Max 3 negotiation rounds — deadlock → "No se llegó a un acuerdo"
- Idempotency: UNIQUE(proposal_id, member_id, round) prevents duplicate votes

## Mock Data (if real Wallbit keys unavailable)
| Persona | Portfolio | Cash | Archetype |
|---|---|---|---|
| Marcos (BA) | 60% NVDA, 20% VTI, 20% AAPL | $1,200 | Tech concentrated |
| María (CDMX) | 40% VEU, 30% VTI, 20% BND, 10% NVDA | $300 | International diversifier |
| Juan (SP) | 50% NVDA, 25% MSFT, 25% AMZN | $3,400 | Big tech |

María's profile always triggers the counterproposal (diversified → rejects NVDA → proposes QQQ).

## Per-member agent output contract
```json
{
  "member_id": "string",
  "decision": "approve" | "reject" | "counteroffer",
  "counteroffer": { "symbol": "string", "amount": number } | null,
  "reasoning": "string",
  "risk_flags": ["string"]
}
```

## Code standards
- TypeScript strict throughout
- Wallbit API keys: encrypted at rest, decrypted only inside wallbit/client.ts, never logged
- Webhook handler is thin: parse → 200 → setImmediate. Zero business logic in route.ts
- Agents are stateless: agent.ts takes input, returns AgentDecision. Orchestrator writes to DB
- Sector classification: call /assets/{symbol} first, fall back to hardcoded map for top 50 tickers
- Never expose individual member balances in group chat — only % changes and directional info

## Working relationship
- Push back on ideas when you have a better approach — cite reasoning
- Ask for clarification rather than making assumptions
- Never guess about Wallbit API behavior — check the docs or ask
- Code and UI always in English

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
