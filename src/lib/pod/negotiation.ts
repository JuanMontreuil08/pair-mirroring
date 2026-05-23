// Negotiation state machine — called from vote.ts after every user tap.
// Checks if all members have voted, then: consensus → approve, no consensus → next round, round 3 → deadlock.

import { supabase } from '@/lib/supabase'
import { bot } from '@/lib/telegram/bot'
import { runOrchestrator } from '@/lib/pod/orchestrator'

const MAX_ROUNDS = 3

export async function checkConsensus(proposalId: string, podId: string, round: number) {
  // Get all pod members
  const { data: members } = await supabase
    .from('pod_members')
    .select('id')
    .eq('pod_id', podId)

  if (!members || members.length === 0) return

  // Get votes for this round
  const { data: votes } = await supabase
    .from('proposal_votes')
    .select('vote, member_id')
    .eq('proposal_id', proposalId)
    .eq('round', round)

  // Wait until every member has tapped a button
  if (!votes || votes.length < members.length) {
    console.log(`[negotiation] waiting — ${votes?.length ?? 0}/${members.length} voted (round ${round})`)
    return
  }

  // Get proposal + group chat id via join
  const { data: proposal } = await supabase
    .from('proposals')
    .select('*, pods(telegram_group_id)')
    .eq('id', proposalId)
    .single()

  if (!proposal) return

  const chatId = (proposal as any).pods?.telegram_group_id

  const allApprove = votes.every((v) => v.vote === 'approve')

  if (allApprove) {
    await supabase
      .from('proposals')
      .update({ status: 'approved', resolved_at: new Date().toISOString() })
      .eq('id', proposalId)

    await bot.telegram.sendMessage(
      chatId,
      `✅ *Consenso alcanzado*\n\nComprar $${proposal.total_amount_usd} de ${proposal.symbol}\n\nTodos los miembros aprobaron. ¡A invertir!`,
      { parse_mode: 'Markdown' }
    )
    console.log(`[negotiation] approved — ${proposal.symbol} $${proposal.total_amount_usd}`)
    return
  }

  if (round >= MAX_ROUNDS) {
    await supabase
      .from('proposals')
      .update({ status: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', proposalId)

    const summary = votes
      .map((v) => `• ${v.vote}`)
      .join('\n')

    await bot.telegram.sendMessage(
      chatId,
      `❌ *No se llegó a un acuerdo*\n\nLa propuesta de ${proposal.symbol} se cerró tras ${MAX_ROUNDS} rondas.\n\nVotos finales:\n${summary}`,
      { parse_mode: 'Markdown' }
    )
    console.log(`[negotiation] deadlock after ${MAX_ROUNDS} rounds — ${proposal.symbol}`)
    return
  }

  // No consensus yet — start next round
  const newRound = round + 1

  await supabase
    .from('proposals')
    .update({ round: newRound })
    .eq('id', proposalId)

  const summary = votes
    .map((v) => (v.vote === 'counteroffer' ? '⚙️ contraoferta' : v.vote === 'approve' ? '✅ aprobó' : '❌ rechazó'))
    .join(' · ')

  await bot.telegram.sendMessage(
    chatId,
    `🔄 *Ronda ${newRound} de negociación*\n\nRonda ${round}: ${summary}\n\nLos agentes re-evalúan con el contexto actualizado...`,
    { parse_mode: 'Markdown' }
  )

  console.log(`[negotiation] starting round ${newRound} for proposal ${proposalId}`)

  await runOrchestrator({
    proposal: {
      id: proposal.id,
      symbol: proposal.symbol,
      total_amount_usd: proposal.total_amount_usd,
      proposer_id: proposal.proposer_id,
      round: newRound,
    },
    podId,
    chatId,
  })
}
