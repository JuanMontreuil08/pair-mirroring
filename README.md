# Pair Mirroring

**An AI investment club that lives in your Telegram group.**

3–10 LATAM remote workers connect their individual Wallbit accounts. A per-member Claude agent analyzes each portfolio privately, mediates trade proposals in DMs, and posts only the final consensus to the group.

Built for the [Wallbit Hackathon](https://wallbit.io).

---

## Demo

**[Watch the demo on LinkedIn](https://www.linkedin.com/posts/juan-montreuil_wallbit-yc-w23-api-challenge-built-ugcPost-7465230327511216129-iBci/)** — full negotiation flow: `/propose NVDA 300` → private per-member AI analysis → María counters with QQQ → consensus posted to group.

---

## The problem

LATAM remote workers already use Wallbit for their US investments. They already have Telegram groups where they talk about money informally. But when it comes to investing together, the existing tools don't work:

- **Investment clubs** (bivio, myICLUB) are 2005-era accounting tools with no mobile UX
- **Hedge.io** is US-only, requires a new brokerage account, forces equal amounts, and has no AI
- **Social investing apps** don't support Wallbit

Pair Mirroring fills that gap — no new app, no pooled capital, no equal-amount requirement. Your Wallbit account stays yours.

---

## How it works

### 1. Connect once via DM
The bot sends each member a magic link in a private DM. Tap → authorize your Wallbit account → done. Your API key is AES-256 encrypted at rest and never exposed to other members.

### 2. Propose a trade in the group
```
Marcos: /propose NVDA 300
Bot: Propuesta recibida: NVDA $300 total.
     Split proporcional: Marcos $150 / María $90 / Juan $60.
     Cada uno recibe análisis privado ahora...
```

### 3. Private AI negotiation per member
Each member gets a personalized DM simultaneously. The agent knows their full Wallbit portfolio — not just the pod slice.

```
→ Marcos DM:  "Ya tenés 18% en tech. Esto te lleva a 26%. ¿Aprobás? ✅ ❌ ⚙️"
→ María DM:   "Tu cash baja a $140. P/E actual: 67x vs histórico 45x. ¿Aprobás? ✅ ❌ ⚙️"
→ Juan DM:    "Tu tech exposure es solo 4% — trade hace sentido para tu perfil. ✅ ❌ ⚙️"
```

María votes ❌. The agent asks why. María says tech concentration. The agent proposes a counteroffer: QQQ instead of NVDA. Marcos and Juan get the counteroffer in DM. Both say ✅.

### 4. Consensus posted to the group
```
✅ Acuerdo del pod: QQQ
   Marcos: $150 | María: $90 | Juan: $60
   [Ejecutar (simulado)] [Cancelar]
```

The group chat stays clean. No one sees anyone else's balance or reasoning. Only the outcome surfaces publicly.

---

## Architecture


```
src/
  app/
    api/
      telegram/webhook/route.ts   ← Instant 200 + background processing
      pod/connect/route.ts        ← Magic link: save encrypted Wallbit key
      waitlist/route.ts           ← Waitlist signups
    connect/page.tsx              ← Wallbit connection UI
    page.tsx                      ← Landing page
  lib/
    wallbit/client.ts             ← Wallbit read API wrapper
    crypto.ts                     ← AES-256 key encryption/decryption
    telegram/bot.ts               ← Telegraf init + export
    telegram/handlers/
      propose.ts                  ← /propose TICKER AMOUNT command
      vote.ts                     ← ✅ ❌ ⚙️ inline keyboard callbacks
      dm.ts                       ← Personalized DM per member
      pair-mirroring.ts           ← /pair-mirroring session dashboard
      rejection-reason.ts         ← Follow-up when member votes ❌
    pod/
      agent.ts                    ← Per-member Claude call → AgentDecision
      orchestrator.ts             ← Promise.all + consensus logic
      negotiation.ts              ← State machine: round tracking
      onboarding-agent.ts         ← Builds member profile on Wallbit connect
    perplexity/client.ts          ← Market news context for agents
supabase/
  migrations/
    001_pod_schema.sql            ← pods, pod_members, proposals, proposal_votes
ui/
  showcase.html                   ← Self-contained demo animation (no build step)
```

**Key decisions:**
- Instant 200 ACK on webhook — Telegram times out at 5s, agents take ~3s
- `Promise.all` for parallel per-member agents — not sequential
- AES-256 encryption for Wallbit API keys before storing in Supabase
- Max 3 negotiation rounds — deadlock → "No se llegó a un acuerdo"
- `UNIQUE(proposal_id, member_id, round)` prevents duplicate votes on webhook retries

---

## Data model

```sql
pods            -- one per Telegram group
pod_members     -- one per user per pod, stores encrypted Wallbit key + built profile
proposals       -- one per /propose command, tracks round and status
proposal_votes  -- one per member per round (approve | reject | counteroffer)
```

Proposal lifecycle: `pending → negotiating → approved | rejected | expired`

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript |
| Bot | Telegraf (Telegram Bot API) |
| DB + Auth | Supabase |
| AI agents | Anthropic Claude (`claude-sonnet-4-6`) via `@anthropic-ai/sdk` |
| Market context | Perplexity Sonar API |
| Portfolio data | Wallbit read-only API |
| Encryption | AES-256 (Node.js `crypto`) |

---

## Local setup

### Prerequisites
- Node.js 18+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com)
- A [Wallbit](https://wallbit.io) account + API key (for testing)
- [ngrok](https://ngrok.com) or similar to expose localhost for the Telegram webhook

### 1. Clone and install

```bash
git clone https://github.com/JuanMontreuil08/pair-mirroring.git
cd pair-mirroring
npm install
```

### 2. Set environment variables

```env
TELEGRAM_BOT_TOKEN=          # from @BotFather
ANTHROPIC_API_KEY=           # Claude API
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AES_KEY=                     # 32-byte hex string (openssl rand -hex 32)
NEXTAUTH_URL=                # your ngrok URL, e.g. https://abc123.ngrok.io
```

### 3. Run the database migration

```bash
# In your Supabase dashboard, run:
supabase/migrations/001_pod_schema.sql
```

### 4. Start the dev server

```bash
npm run dev
```

### 5. Register the Telegram webhook

```bash
# Replace with your ngrok URL and bot token
curl -F "url=https://YOUR_NGROK_URL/api/telegram/webhook" \
     "https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook"
```

### 6. Add the bot to a Telegram group and onboard the pod

1. Add the bot to a Telegram group.
2. **Each member DMs the bot `/start` first** — Telegram requires this before the bot can send anyone a private message.
3. In the group, call `/pair-mirroring @member1 @member2 @member3`. The bot sends each mentioned member a magic link via DM.
4. Each member clicks the link and pastes their Wallbit API key on the connect page. The key is encrypted before storage and never passes through Telegram.
5. Once everyone is connected, use `/propose TICKER AMOUNT` in the group to kick off a negotiation.

---

## Demo personas (mock data)

If you don't have real Wallbit keys, the agents fall back to these hardcoded personas:

| Persona | Portfolio | Cash | Archetype |
|---|---|---|---|
| Marcos (Buenos Aires) | 60% NVDA, 20% VTI, 20% AAPL | $1,200 | Tech concentrated |
| María (CDMX) | 40% VEU, 30% VTI, 20% BND, 10% NVDA | $300 | International diversifier |
| Juan (São Paulo) | 50% NVDA, 25% MSFT, 25% AMZN | $3,400 | Big tech |

María's profile always triggers the counterproposal — her diversified holdings make NVDA a poor fit, which surfaces the negotiation flow.

---

## Showcase UI

`ui/showcase.html` is a self-contained kinetic animation of the full pod flow — no build step, open directly in a browser. Useful for pitching or embedding in a demo.

---

## Wallbit API

Base URL: `https://api.wallbit.io`

All requests require the `X-API-Key` header. The endpoints used:

```
GET /api/public/v1/balance/checking   → cash balance
GET /api/public/v1/balance/stocks     → portfolio positions
GET /api/public/v1/transactions       → transaction history
GET /api/public/v1/assets/{symbol}    → sector classification
```

Trade execution (`POST /trades`) is not available — trades are simulated in the demo.

---

## Agent output contract

Each per-member Claude agent returns:

```json
{
  "member_id": "string",
  "decision": "approve" | "reject" | "counteroffer",
  "counteroffer": { "symbol": "string", "amount": number } | null,
  "reasoning": "string",
  "risk_flags": ["string"]
}
```

The orchestrator aggregates all decisions and either posts consensus to the group or starts a new negotiation round.

---

## License

MIT
