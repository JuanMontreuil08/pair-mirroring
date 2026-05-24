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
  stockInfo: Record<string, any> | null
  previousVote: string | null
}

export async function sendDecisionDM({ telegramUserId, proposal, decision, stockInfo, previousVote }: SendDecisionDMParams) {
  const decisionEmoji = decision.decision === 'approve' ? '✅' : decision.decision === 'reject' ? '❌' : '⚙️'
  const decisionLabel = decision.decision === 'approve' ? 'Aprobar' : decision.decision === 'reject' ? 'Rechazar' : 'Contraoferta'

  const counterofferNote = decision.counteroffer
    ? `\n💡 Mi contraoferta: $${decision.counteroffer.amount} de ${decision.counteroffer.symbol}`
    : ''

  const stockBlock = stockInfo
    ? `\n📊 *${stockInfo.name ?? proposal.symbol}*` +
      (stockInfo.price != null ? ` · $${stockInfo.price}` : '') +
      (stockInfo.sector ? ` · ${stockInfo.sector}` : '') +
      (stockInfo.market_cap_m ? ` · Cap: $${stockInfo.market_cap_m}M` : '') +
      (stockInfo.country ? ` · ${stockInfo.country}` : '') +
      (stockInfo.ceo ? `\nCEO: ${stockInfo.ceo}` : '') +
      (stockInfo.employees ? ` · Empleados: ${stockInfo.employees}` : '') +
      (stockInfo.dividend?.yield != null ? ` · Dividendo: ${stockInfo.dividend.yield}%` : '') +
      (stockInfo.description_es ?? stockInfo.description
        ? `\n_${stockInfo.description_es ?? stockInfo.description}_`
        : '') +
      '\n'
    : ''

  const previousVoteLabels: Record<string, string> = {
    approve: '✅ aprobaste',
    reject: '❌ rechazaste',
    counteroffer: '⚙️ enviaste una contraoferta',
  }
  const previousVoteNote = previousVote
    ? `\n_En la ronda anterior ${previousVoteLabels[previousVote] ?? previousVote}. Como no hubo consenso, se abre una nueva ronda._\n`
    : ''

  const text =
    `📋 *Propuesta:* comprar $${proposal.total_amount_usd} de ${proposal.symbol} (ronda ${proposal.round})\n` +
    previousVoteNote +
    stockBlock +
    `\n${decisionEmoji} *Mi recomendación:* ${decisionLabel}\n\n` +
    `💬 ${decision.reasoning}` +
    counterofferNote +
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
