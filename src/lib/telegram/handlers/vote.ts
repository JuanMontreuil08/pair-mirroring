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

  if (proposal.status !== 'negotiating') {
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

  // Read agent recommendation — stored in agent_vote, separate from user's vote
  const { data: existingVote } = await supabase
    .from('proposal_votes')
    .select('agent_vote, counteroffer_symbol, counteroffer_amount, reason')
    .eq('proposal_id', proposalId)
    .eq('member_id', member.id)
    .eq('round', proposal.round)
    .single()

  const agentRecommendation = existingVote?.agent_vote
  console.log(`[vote] user ${telegramUserId} confirmed: ${choice} (agent had recommended: ${agentRecommendation ?? 'unknown'})`)

  // Save user's confirmed choice — vote column only set here, never by orchestrator
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

    if (choice === 'reject') {
      // Defer Supermemory event log until user provides rejection reason.
      // rejection-reason.ts will write the complete entry including their explanation.
      const { data: profileRow } = await supabase
        .from('user_profiles')
        .select('profile')
        .eq('telegram_user_id', telegramUserId)
        .single()

      await supabase
        .from('user_profiles')
        .update({
          profile: {
            ...(profileRow?.profile ?? {}),
            pending_rejection: {
              proposal_id: proposalId,
              member_id: member.id,
              round: proposal.round,
              symbol: proposal.symbol,
              amount: proposal.total_amount_usd,
              agent_recommendation: agentRecommendation,
              counteroffer_line: counterofferLine,
              agent_reasoning: existingVote?.reason ?? 'none',
              custom_id: `negotiation_${proposal.id}_${member.id}_round_${proposal.round}`,
            },
          },
        })
        .eq('telegram_user_id', telegramUserId)

      await bot.telegram.sendMessage(
        telegramUserId,
        `¿Por qué rechazás esta propuesta? Escribí tu motivo y tu agente lo tendrá en cuenta en futuras negociaciones.`
      )
    } else {
      // approve / counteroffer — write event log immediately
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

    // Rolling behavioral summary — always update immediately regardless of choice
    updateBehaviorSummary(telegramUserId, member.id, proposal, choice, agentRecommendation)
      .catch((err) => console.warn('[vote] behavior summary update failed:', err))
  }

  // Consensus check — only ever triggered by a user tap, never by the agent
  await checkConsensus(proposalId, proposal.pod_id, proposal.round)
}

async function updateBehaviorSummary(
  telegramUserId: number,
  _memberId: string,
  proposal: { symbol: string; total_amount_usd: number },
  userChoice: string,
  agentRecommendation: string
) {
  const { data: row } = await supabase
    .from('user_profiles')
    .select('profile')
    .eq('telegram_user_id', telegramUserId)
    .single()

  const profile = row?.profile ?? {}
  const stats = profile.behavior_stats ?? { total: 0, approved: 0, rejected: 0, counteroffered: 0, overrides: 0 }

  stats.total++
  if (userChoice === 'approve') stats.approved++
  else if (userChoice === 'reject') stats.rejected++
  else stats.counteroffered++
  if (agentRecommendation !== userChoice) stats.overrides++

  const overrideRate = Math.round((stats.overrides / stats.total) * 100)

  await supabase
    .from('user_profiles')
    .update({ profile: { ...profile, behavior_stats: stats } })
    .eq('telegram_user_id', telegramUserId)

  const interpretation =
    overrideRate > 50
      ? 'User frequently overrides agent — actual risk tolerance likely differs from self-reported profile. Weight behavior over stated preferences.'
      : overrideRate > 0
      ? 'User occasionally overrides agent — use as a calibration signal.'
      : 'User consistently agrees with agent — profile is well-calibrated.'

  const lastVote =
    agentRecommendation !== userChoice
      ? `Latest override: agent said "${agentRecommendation}" on ${proposal.symbol} $${proposal.total_amount_usd}, user chose "${userChoice}".`
      : `Latest agreement: both chose "${userChoice}" on ${proposal.symbol} $${proposal.total_amount_usd}.`

  await (memory as any).add({
    content: `BEHAVIORAL SUMMARY — user ${telegramUserId}\nVoting pattern: ${stats.approved} approve, ${stats.rejected} reject, ${stats.counteroffered} counteroffer out of ${stats.total} total.\nOverride rate: ${overrideRate}%.\n${lastVote}\nInterpretation: ${interpretation}`,
    containerTags: [`user_${telegramUserId}`],
    metadata: { memory_type: 'behavioral_summary' },
    customId: `behavior_summary_${telegramUserId}`,
  })
}
