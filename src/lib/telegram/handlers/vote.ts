// Handles vote:${proposal_id}:approve|reject|counteroffer callbacks from DM buttons.
// Agent recommendation is already in DB — user tap is the authoritative vote.
// If user overrides agent, disagreement is logged to Supermemory for future rounds.

import Supermemory from 'supermemory'
import { supabase } from '@/lib/supabase'
import { bot } from '@/lib/telegram/bot'
import { checkConsensus } from '@/lib/pod/negotiation'

const memory = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY })

export async function handleVoteCallback(
  telegramUserId: number,
  callbackData: string,
  callbackQueryId: string
) {
  const [, proposalId, choice] = callbackData.split(':')

  if (!proposalId || !['approve', 'reject', 'counteroffer'].includes(choice)) return

  // Get proposal
  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, pod_id, symbol, total_amount_usd, round, status')
    .eq('id', proposalId)
    .single()

  if (!proposal) {
    await bot.telegram.answerCbQuery(callbackQueryId, 'Propuesta no encontrada.')
    return
  }

  if (proposal.status !== 'pending') {
    await bot.telegram.answerCbQuery(callbackQueryId, 'Esta propuesta ya fue resuelta.')
    return
  }

  // Resolve this user's pod_member id
  const { data: member } = await supabase
    .from('pod_members')
    .select('id')
    .eq('pod_id', proposal.pod_id)
    .eq('telegram_user_id', telegramUserId)
    .single()

  if (!member) {
    await bot.telegram.answerCbQuery(callbackQueryId, 'No eres miembro de este pod.')
    return
  }

  // Read agent recommendation before overwriting — needed for override detection
  const { data: existingVote } = await supabase
    .from('proposal_votes')
    .select('vote, counteroffer_symbol, counteroffer_amount, reason')
    .eq('proposal_id', proposalId)
    .eq('member_id', member.id)
    .eq('round', proposal.round)
    .single()

  const agentRecommendation = existingVote?.vote

  // Save user's actual choice — overwrites agent recommendation
  const { error } = await supabase
    .from('proposal_votes')
    .update({ vote: choice })
    .eq('proposal_id', proposalId)
    .eq('member_id', member.id)
    .eq('round', proposal.round)

  if (error) {
    console.error('[vote] failed to save vote:', error)
    await bot.telegram.answerCbQuery(callbackQueryId, 'Error al guardar tu voto.')
    return
  }

  const labels: Record<string, string> = {
    approve: '✅ Aprobaste la propuesta',
    reject: '❌ Rechazaste la propuesta',
    counteroffer: '⚙️ Enviaste una contraoferta',
  }

  await bot.telegram.answerCbQuery(callbackQueryId, labels[choice])

  // Write one coherent memory entry combining agent recommendation + user decision.
  // Written here (after user taps) so both sides are captured together.
  // customId prevents duplicate entries if Telegram retries the callback.
  if (agentRecommendation) {
    const agreed = agentRecommendation === choice
    const counterofferLine = existingVote?.counteroffer_symbol
      ? `\nSuggested alternative: ${existingVote.counteroffer_symbol} $${existingVote.counteroffer_amount}`
      : ''
    const outcomeNote = agreed
      ? `User agreed — confirmed agent recommendation.`
      : `User disagreed — chose "${choice}" over agent's "${agentRecommendation}". Adjust future recommendations to reflect this preference.`

    memory
      .add({
        content: `NEGOTIATION DECISION — ${proposal.symbol} $${proposal.total_amount_usd} (round ${proposal.round})\n\nAGENT RECOMMENDATION: ${agentRecommendation}${counterofferLine}\nReasoning: ${existingVote?.reason ?? 'none'}\n\nUSER DECISION: ${choice}\nOutcome: ${outcomeNote}`,
        containerTags: [`user_${telegramUserId}`],
        metadata: {
          memory_type: 'negotiation_decision',
          symbol: proposal.symbol,
          round: String(proposal.round),
          agent_recommendation: agentRecommendation,
          user_decision: choice,
          agreed: String(agreed),
        },
        customId: `negotiation_${proposal.id}_${member.id}_round_${proposal.round}`,
      } as any)
      .catch((err) => console.warn('[vote] supermemory vote log failed:', err))
  }

  // Consensus check — only ever triggered by a user tap, never by the agent
  await checkConsensus(proposalId, proposal.pod_id, proposal.round)
}
