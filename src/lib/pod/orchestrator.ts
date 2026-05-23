// Orchestrator — runs when a /propose arrives.
// Fetches all pod members, queries Supermemory per member, calls agent.ts in parallel,
// saves votes to Supabase, pushes negotiation memory to Supermemory, triggers DMs.

import Supermemory from 'supermemory'
import { supabase } from '@/lib/supabase'
import { decrypt } from '@/lib/crypto'
import { runProposalAgent } from '@/lib/pod/agent'
import { sendDecisionDM } from '@/lib/telegram/handlers/dm'

const memory = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY })

interface OrchestratorParams {
  proposal: {
    id: string
    symbol: string
    total_amount_usd: number
    proposer_id: string
    round: number
  }
  podId: string
  chatId: number
}

export async function runOrchestrator({ proposal, podId, chatId }: OrchestratorParams) {
  console.log(`[orchestrator] starting for proposal ${proposal.id} — ${proposal.symbol} $${proposal.total_amount_usd}`)

  // Fetch all pod members with their encrypted keys
  const { data: members } = await supabase
    .from('pod_members')
    .select('id, telegram_user_id, wallbit_api_key_encrypted')
    .eq('pod_id', podId)

  if (!members || members.length === 0) {
    console.error('[orchestrator] no members found for pod', podId)
    return
  }

  // Fetch all user profiles
  const memberUserIds = members.map((m) => m.telegram_user_id)
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('telegram_user_id, profile')
    .in('telegram_user_id', memberUserIds)

  const profileMap = Object.fromEntries(
    (profiles ?? []).map((p) => [p.telegram_user_id, p.profile])
  )

  // Get proposer's telegram_user_id from pod_members
  const proposerMember = members.find((m) => m.id === proposal.proposer_id)
  const proposerUserId = proposerMember?.telegram_user_id ?? 0

  // Run all agents in parallel — one per member
  const agentResults = await Promise.all(
    members.map(async (member) => {
      const profile = profileMap[member.telegram_user_id] ?? {}

      // Query Supermemory for this member's negotiation history
      const memoryContext = await fetchMemoryContext(
        member.telegram_user_id,
        proposal.symbol,
        proposal.total_amount_usd
      )

      console.log(`[orchestrator] running agent for user ${member.telegram_user_id}`)

      const decision = await runProposalAgent(
        {
          telegramUserId: member.telegram_user_id,
          profile,
          memoryContext,
        },
        {
          symbol: proposal.symbol,
          amount: proposal.total_amount_usd,
          proposedBy: proposerUserId,
        }
      )

      return { member, decision }
    })
  )

  // Save votes to Supabase
  await Promise.all(
    agentResults.map(async ({ member, decision }) => {
      const { error } = await supabase
        .from('proposal_votes')
        .upsert({
          proposal_id: proposal.id,
          member_id: member.id,
          round: proposal.round,
          vote: decision.decision,
          counteroffer_symbol: decision.counteroffer?.symbol ?? null,
          counteroffer_amount: decision.counteroffer?.amount ?? null,
          reason: decision.reasoning,
        }, { onConflict: 'proposal_id,member_id,round' })

      if (error) console.error('[orchestrator] vote save error:', error)
    })
  )

  // Supermemory is written in vote.ts after user confirms — not here.
  // That way each entry captures both the agent recommendation AND the user's actual decision.

  // Send personalized DM to each member
  await Promise.all(
    agentResults.map(({ member, decision }) =>
      sendDecisionDM({
        telegramUserId: member.telegram_user_id,
        proposal,
        decision,
      }).catch((err) => console.warn(`[orchestrator] DM failed for user ${member.telegram_user_id}:`, err))
    )
  )

  console.log(`[orchestrator] done — ${agentResults.length} agents ran, votes saved, DMs sent`)
}

async function fetchMemoryContext(
  telegramUserId: number,
  symbol: string,
  amount: number
): Promise<string> {
  try {
    const profile = await memory.profile({
      containerTag: `user_${telegramUserId}`,
      q: `${symbol} $${amount} investment proposal`,
    })

    const lines = [
      ...(profile.profile?.static ?? []),
      ...(profile.profile?.dynamic ?? []),
      ...(profile.searchResults?.results ?? []).map((r: any) => r.memory),
    ].filter(Boolean)

    return lines.join('\n') || ''
  } catch (err) {
    console.warn(`[orchestrator] supermemory fetch failed for user ${telegramUserId}:`, err)
    return ''
  }
}
