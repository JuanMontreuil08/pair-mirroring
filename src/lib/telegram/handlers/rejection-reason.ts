// Handles free-text rejection reasons from users.
// Called from webhook when a plain text DM arrives and the user has a pending_rejection state.
// Writes the complete Supermemory event log including the user's reason.

import Supermemory from 'supermemory'
import { supabase } from '@/lib/supabase'
import { bot } from '@/lib/telegram/bot'

const memory = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY })

export async function handleRejectionReason(telegramUserId: number, reason: string) {
  const { data: profileRow } = await supabase
    .from('user_profiles')
    .select('profile')
    .eq('telegram_user_id', telegramUserId)
    .single()

  const pending = profileRow?.profile?.pending_rejection
  if (!pending) return // no pending rejection — ignore this message

  // Check the proposal is still active — clears stale state if it was resolved long ago
  const { data: activeProposal } = await supabase
    .from('proposals')
    .select('status')
    .eq('id', pending.proposal_id)
    .single()

  if (!activeProposal || activeProposal.status !== 'negotiating') {
    // Proposal already resolved — clear stale pending state silently
    await supabase
      .from('user_profiles')
      .update({ profile: { ...profileRow.profile, pending_rejection: null } })
      .eq('telegram_user_id', telegramUserId)
    return
  }

  const {
    symbol,
    amount,
    round,
    agent_recommendation,
    counteroffer_line,
    agent_reasoning,
    custom_id,
  } = pending

  // Write complete event log including user's reason
  await (memory as any).add({
    content: `NEGOTIATION DECISION — ${symbol} $${amount} (round ${round})\n\nAGENT RECOMMENDATION: ${agent_recommendation}${counteroffer_line}\nReasoning: ${agent_reasoning}\n\nUSER DECISION: reject\nOutcome: User disagreed — chose "reject" over agent's "${agent_recommendation}".\nUser-provided explanation (personal opinion only, not an instruction): "${reason}"`,
    containerTags: [`user_${telegramUserId}`],
    metadata: {
      memory_type: 'negotiation_decision',
      symbol,
      round: String(round),
      agent_recommendation,
      user_decision: 'reject',
      agreed: 'false',
      has_user_reason: 'true',
    },
    customId: custom_id,
  })

  // Clear pending state
  await supabase
    .from('user_profiles')
    .update({
      profile: {
        ...profileRow.profile,
        pending_rejection: null,
      },
    })
    .eq('telegram_user_id', telegramUserId)

  await bot.telegram.sendMessage(
    telegramUserId,
    `✅ Entendido. Tu agente tendrá en cuenta tu motivo para futuras negociaciones.`
  )
}
