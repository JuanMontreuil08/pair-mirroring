// Orchestrator — runs when a /propose arrives.
// Fetches all pod members, queries Supermemory per member, calls agent.ts in parallel,
// saves votes to Supabase, pushes negotiation memory to Supermemory, triggers DMs.

import Supermemory from 'supermemory'
import { supabase } from '@/lib/supabase'
import { decrypt } from '@/lib/crypto'
import { runProposalAgent } from '@/lib/pod/agent'
import { sendDecisionDM } from '@/lib/telegram/handlers/dm'
import { getAsset, getAssetsByCategory } from '@/lib/wallbit/client'
import { getStockNews, formatNewsForPrompt } from '@/lib/perplexity/client'

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

  // Fetch stock info once — any member's key works, assets are not user-specific
  const firstKey = members[0]?.wallbit_api_key_encrypted
    ? decrypt(members[0].wallbit_api_key_encrypted)
    : null
  let stockInfo: Record<string, any> | null = null
  if (firstKey) {
    try {
      console.log(`[wallbit] fetching asset info for ${proposal.symbol}...`)
      const asset = await getAsset(firstKey, proposal.symbol)
      // Wallbit wraps all responses in a `data` key
      stockInfo = asset?.data ?? null
      console.log(`[wallbit] ${proposal.symbol} → name: ${stockInfo?.name}, price: $${stockInfo?.price}, sector: ${stockInfo?.sector}, market_cap: $${stockInfo?.market_cap_m}M, has_description: ${!!(stockInfo?.description_es ?? stockInfo?.description)}`)
    } catch (err) {
      console.warn(`[wallbit] failed to fetch asset info for ${proposal.symbol}:`, err)
    }
  }

  // Fetch news once — shared across all members (same ticker, same context)
  let newsContext = 'No recent news available.'
  try {
    console.log(`[perplexity] fetching news for ${proposal.symbol}...`)
    const news = await getStockNews(proposal.symbol, 7)
    newsContext = formatNewsForPrompt(news)
    console.log(`[perplexity] ${proposal.symbol} → ${news.length} articles fetched`)
  } catch (err) {
    console.warn(`[perplexity] news fetch failed for ${proposal.symbol}:`, err)
  }

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

      // Fetch real Wallbit tickers in the member's preferred category for counteroffer grounding
      let availableAlternatives: string[] = []
      const preferredCategory = profile?.self_reported?.preferred_category
      if (preferredCategory && firstKey) {
        try {
          const assetsRes = await getAssetsByCategory(firstKey, preferredCategory, 5)
          const assets: Array<{ symbol: string }> = assetsRes?.data ?? []
          availableAlternatives = assets
            .map((a) => a.symbol)
            .filter((s) => s && s !== proposal.symbol)
          console.log(`[orchestrator] alternatives for user ${member.telegram_user_id} (${preferredCategory}): ${availableAlternatives.join(', ')}`)
        } catch (err) {
          console.warn(`[orchestrator] failed to fetch alternatives for category ${preferredCategory}:`, err)
        }
      }

      console.log(`[orchestrator] running agent for user ${member.telegram_user_id}`)

      const decision = await runProposalAgent(
        {
          telegramUserId: member.telegram_user_id,
          profile,
          memoryContext,
          stockInfo,
          availableAlternatives,
          newsContext,
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

  // Save agent recommendations — vote stays null until user confirms via button tap
  await Promise.all(
    agentResults.map(async ({ member, decision }) => {
      console.log(`[orchestrator] agent recommendation for user ${member.telegram_user_id}: ${decision.decision}${decision.counteroffer ? ` → ${decision.counteroffer.symbol} $${decision.counteroffer.amount}` : ''}`)
      const { error } = await supabase
        .from('proposal_votes')
        .upsert({
          proposal_id: proposal.id,
          member_id: member.id,
          round: proposal.round,
          vote: null,                          // null until user taps — prevents false consensus
          agent_vote: decision.decision,
          counteroffer_symbol: decision.counteroffer?.symbol ?? null,
          counteroffer_amount: decision.counteroffer?.amount ?? null,
          reason: decision.reasoning,
        }, { onConflict: 'proposal_id,member_id,round' })

      if (error) console.error('[orchestrator] agent vote save error:', error)
    })
  )

  // Supermemory is written in vote.ts after user confirms — not here.
  // That way each entry captures both the agent recommendation AND the user's actual decision.

  // Fetch previous round votes so the DM can remind users what they chose before
  const previousVoteMap: Record<string, string> = {}
  if (proposal.round > 1) {
    const { data: prevVotes } = await supabase
      .from('proposal_votes')
      .select('member_id, vote')
      .eq('proposal_id', proposal.id)
      .eq('round', proposal.round - 1)
      .not('vote', 'is', null)

    for (const v of prevVotes ?? []) {
      previousVoteMap[v.member_id] = v.vote
    }
  }

  // Send personalized DM to each member
  await Promise.all(
    agentResults.map(({ member, decision }) =>
      sendDecisionDM({
        telegramUserId: member.telegram_user_id,
        proposal,
        decision,
        stockInfo,
        previousVote: previousVoteMap[member.id] ?? null,
      }).catch((err) => console.warn(`[orchestrator] DM failed for user ${member.telegram_user_id}:`, err))
    )
  )

  console.log(`[orchestrator] done — ${agentResults.length} agents ran, agent votes saved (waiting for user confirmation), DMs sent`)
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
