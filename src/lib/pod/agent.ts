// Per-member proposal agent — stateless.
// Orchestrator calls this once per pod member when a proposal arrives.
// Uses claude-sonnet for proposal analysis (heavier reasoning than onboarding).
// Supermemory context is fetched by orchestrator and passed in — agent doesn't query it.

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SONNET = 'claude-sonnet-4-6'

export interface Proposal {
  symbol: string
  amount: number
  proposedBy: number // telegram_user_id of proposer
}

export interface UserContext {
  telegramUserId: number
  profile: any            // from user_profiles.profile (onboarding result)
  memoryContext: string   // from Supermemory — past negotiation patterns
}

export interface AgentDecision {
  member_id: number
  decision: 'approve' | 'reject' | 'counteroffer'
  counteroffer: { symbol: string; amount: number } | null
  reasoning: string
  risk_flags: string[]
}

export async function runProposalAgent(
  ctx: UserContext,
  proposal: Proposal
): Promise<AgentDecision> {
  const { profile, memoryContext, telegramUserId } = ctx
  const isOwnProposal = telegramUserId === proposal.proposedBy

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 1024,
    tools: [{
      name: 'submit_decision',
      description: 'Submit the investment decision for this proposal',
      input_schema: {
        type: 'object' as const,
        properties: {
          decision: {
            type: 'string',
            enum: ['approve', 'reject', 'counteroffer'],
            description: 'approve = support the proposal, reject = oppose it, counteroffer = propose an alternative',
          },
          counteroffer: {
            type: 'object',
            description: 'Only if decision is counteroffer',
            properties: {
              symbol: { type: 'string', description: 'Alternative ticker symbol' },
              amount: { type: 'number', description: 'Alternative amount in USD' },
            },
            required: ['symbol', 'amount'],
          },
          reasoning: {
            type: 'string',
            description: '1-2 sentences in Spanish explaining the decision from this investor\'s perspective',
          },
          risk_flags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short English tags for risks detected, e.g. "single-stock-concentration", "short-horizon-mismatch", "low-confidence-sparse-profile"',
          },
        },
        required: ['decision', 'reasoning', 'risk_flags'],
      },
    }],
    tool_choice: { type: 'tool', name: 'submit_decision' },
    messages: [{
      role: 'user',
      content: `You are an AI investment agent representing a LATAM investor in a group investment pod.
Your job: analyze the proposal and decide whether this investor would approve, reject, or counteroffer — based on their profile and history.

${isOwnProposal ? '⚠️ This investor made this proposal themselves. They should approve unless there is a serious self-identified risk.' : ''}

## Investor Profile
- Risk profile: ${profile?.risk_profile ?? 'unknown'}
- Investment horizon: ${profile?.investment_horizon ?? 'unknown'}
- Objective: ${profile?.investment_objective ?? 'unknown'}
- Portfolio style: ${profile?.portfolio_style ?? 'unknown'}
- Current holdings: ${JSON.stringify(profile?.wallbit?.holdings ?? [])}
- Sectors held: ${(profile?.wallbit?.sectors ?? []).join(', ') || 'none'}
- Cash balance (USD): ${profile?.wallbit?.cash_balance ?? 0}
- Inferred signals: ${(profile?.inferred_signals ?? []).join(', ') || 'none'}
- Profile summary: ${profile?.summary ?? 'No summary available'}
- Data quality: ${profile?.wallbit?.data_quality ?? 'empty'}

## Negotiation History (from memory)
${memoryContext || 'No previous negotiations recorded.'}

## Proposal
- Symbol: ${proposal.symbol}
- Amount: $${proposal.amount} USD

## Decision Rules
- conservative + short horizon → reject speculative single stocks, prefer broad ETFs
- aggressive + long horizon → more likely to approve growth stocks
- If portfolio already heavy in the proposed sector → flag concentration risk
- If data_quality is empty/sparse → add "low-confidence-sparse-profile" to risk_flags, lean toward approve unless clear mismatch
- counteroffer should be in the same asset class (stock→stock, ETF→ETF) with similar or lower amount
- reasoning must be in Spanish, 1-2 sentences, written as if the investor is speaking`,
    }],
  })

  const toolInput = (response.content[0] as any).input

  return {
    member_id: telegramUserId,
    decision: toolInput.decision,
    counteroffer: toolInput.counteroffer ?? null,
    reasoning: toolInput.reasoning,
    risk_flags: toolInput.risk_flags ?? [],
  }
}
