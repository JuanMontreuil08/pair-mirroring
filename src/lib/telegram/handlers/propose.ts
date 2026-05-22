// Handles /propose TICKER AMOUNT in the group chat.
// Validates the proposer is a pod member, creates the proposal row, calls orchestrator.

import { bot } from '@/lib/telegram/bot'
import { supabase } from '@/lib/supabase'
import { runOrchestrator } from '@/lib/pod/orchestrator'

interface HandleProposeParams {
  chatId: number
  userId: number
  text: string
}

export async function handlePropose({ chatId, userId, text }: HandleProposeParams) {
  // Parse: /propose NVDA 300
  const parts = text.trim().split(/\s+/)
  if (parts.length < 3) {
    await bot.telegram.sendMessage(chatId, '⚠️ Formato: /propose TICKER MONTO\nEjemplo: /propose NVDA 300')
    return
  }

  const symbol = parts[1].toUpperCase()
  const amount = parseFloat(parts[2])

  if (isNaN(amount) || amount <= 0) {
    await bot.telegram.sendMessage(chatId, '⚠️ El monto debe ser un número positivo.\nEjemplo: /propose NVDA 300')
    return
  }

  // Get pod for this group
  const { data: pod } = await supabase
    .from('pods')
    .select('id')
    .eq('telegram_group_id', chatId)
    .single()

  if (!pod) {
    await bot.telegram.sendMessage(chatId, '⚠️ No hay un pod activo en este grupo. Usá /pair-mirroring para crear uno.')
    return
  }

  // Validate proposer is a pod member
  const { data: proposerMember } = await supabase
    .from('pod_members')
    .select('id')
    .eq('pod_id', pod.id)
    .eq('telegram_user_id', userId)
    .single()

  if (!proposerMember) {
    await bot.telegram.sendMessage(chatId, '⚠️ Solo los miembros del pod pueden proponer operaciones.')
    return
  }

  // Check all members are onboarded
  const { data: members } = await supabase
    .from('pod_members')
    .select('telegram_user_id')
    .eq('pod_id', pod.id)

  if (!members || members.length < 2) {
    await bot.telegram.sendMessage(chatId, '⚠️ El pod necesita al menos 2 miembros conectados.')
    return
  }

  const memberIds = members.map((m) => m.telegram_user_id)

  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('telegram_user_id, onboarding_completed')
    .in('telegram_user_id', memberIds)

  const notOnboarded = memberIds.filter(
    (id) => !profiles?.find((p) => p.telegram_user_id === id && p.onboarding_completed)
  )

  if (notOnboarded.length > 0) {
    await bot.telegram.sendMessage(
      chatId,
      `⏳ Esperando que ${notOnboarded.length} miembro${notOnboarded.length > 1 ? 's' : ''} complete${notOnboarded.length > 1 ? 'n' : ''} el onboarding antes de proponer.`
    )
    return
  }

  // Create proposal
  const { data: proposal, error } = await supabase
    .from('proposals')
    .insert({
      pod_id: pod.id,
      proposer_id: proposerMember.id,
      symbol,
      total_amount_usd: amount,
      status: 'negotiating',
      round: 1,
    })
    .select()
    .single()

  if (error || !proposal) {
    console.error('Failed to create proposal:', error)
    await bot.telegram.sendMessage(chatId, '❌ Error al crear la propuesta. Intentá de nuevo.')
    return
  }

  // Announce in group
  await bot.telegram.sendMessage(
    chatId,
    `📨 Propuesta recibida: comprar $${amount} de ${symbol}\n\nConsultando a cada miembro... Los resultados llegan en segundos.`
  )

  // Run orchestrator in background — agents take a few seconds
  setImmediate(() => {
    runOrchestrator({ proposal, podId: pod.id, chatId }).catch((err) =>
      console.error('Orchestrator error:', err)
    )
  })
}
