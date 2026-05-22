// Sends a personalized DM to each pod member with the agent's decision.
// Inline keyboard: ✅ approve | ❌ reject | ⚙️ counteroffer

import { bot } from '@/lib/telegram/bot'
import { AgentDecision } from '@/lib/pod/agent'

interface SendDecisionDMParams {
  telegramUserId: number
  proposal: {
    id: string
    symbol: string
    total_amount_usd: number
    round: number
  }
  decision: AgentDecision
}

export async function sendDecisionDM({ telegramUserId, proposal, decision }: SendDecisionDMParams) {
  const decisionEmoji = decision.decision === 'approve' ? '✅' : decision.decision === 'reject' ? '❌' : '⚙️'
  const decisionLabel = decision.decision === 'approve' ? 'Aprobar' : decision.decision === 'reject' ? 'Rechazar' : 'Contraoferta'

  const counterofferNote = decision.counteroffer
    ? `\n💡 Mi contraoferta: $${decision.counteroffer.amount} de ${decision.counteroffer.symbol}`
    : ''

  const riskNote = decision.risk_flags.length > 0
    ? `\n⚠️ Riesgos: ${decision.risk_flags.join(', ')}`
    : ''

  const text =
    `📋 *Propuesta:* comprar $${proposal.total_amount_usd} de ${proposal.symbol} (ronda ${proposal.round})\n\n` +
    `${decisionEmoji} *Mi recomendación:* ${decisionLabel}\n\n` +
    `💬 ${decision.reasoning}` +
    counterofferNote +
    riskNote +
    `\n\n¿Confirmás tu voto?`

  await bot.telegram.sendMessage(telegramUserId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Aprobar', callback_data: `vote:${proposal.id}:approve` },
        { text: '❌ Rechazar', callback_data: `vote:${proposal.id}:reject` },
        { text: '⚙️ Contraoferta', callback_data: `vote:${proposal.id}:counteroffer` },
      ]],
    },
  })
}
