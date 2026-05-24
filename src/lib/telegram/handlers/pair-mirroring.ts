import { supabase } from '@/lib/supabase'
import { bot } from '@/lib/telegram/bot'
import crypto from 'crypto'

interface HandlePairMirroringParams {
  message: any
  chatId: number
  userId: number
  text: string
}

// Extract all mentioned members from entities — handles both:
// - mention: @username (user id resolved via getChatMember)
// - text_mention: user without a username (user id embedded directly in entity)
interface MentionedMember {
  userId: number       // 0 means needs resolving via @username
  displayName: string  // @username or first name
  username?: string    // only for mention type
}

function extractMembers(message: any, text: string): MentionedMember[] {
  const entities: any[] = message.entities ?? []
  const members: MentionedMember[] = []

  for (const entity of entities) {
    if (entity.type === 'mention') {
      const username = text.slice(entity.offset + 1, entity.offset + entity.length)
      members.push({ userId: 0, displayName: `@${username}`, username })
    } else if (entity.type === 'text_mention') {
      const firstName = entity.user?.first_name ?? 'miembro'
      members.push({ userId: entity.user.id, displayName: firstName })
    }
  }

  return members
}

export async function handlePairMirroring({
  message,
  chatId,
  userId,
  text,
}: HandlePairMirroringParams) {
  const members = extractMembers(message, text)

  if (members.length < 1) {
    await bot.telegram.sendMessage(
      chatId,
      '⚠️ Menciona a los miembros del pod:\n/pair-mirroring @marcos @maria @juan'
    )
    return
  }

  // Get or create the pod for this group
  const pod = await getOrCreatePod(chatId)

  // Resolve all user IDs first so we know the exact intended set
  const resolvedMembers: Array<{ userId: number; displayName: string }> = []
  for (const member of members) {
    let resolvedId = member.userId
    if (resolvedId === 0 && member.username) {
      if (member.username === message.from?.username) {
        resolvedId = message.from.id
      } else {
        try {
          const { data: cached } = await supabase
            .from('user_profiles')
            .select('telegram_user_id')
            .filter('profile->>username', 'eq', member.username)
            .single()

          if (cached?.telegram_user_id) {
            resolvedId = cached.telegram_user_id
          } else {
            resolvedMembers.push({ userId: 0, displayName: member.displayName })
            continue
          }
        } catch {
          resolvedMembers.push({ userId: 0, displayName: member.displayName })
          continue
        }
      }
    }
    resolvedMembers.push({ userId: resolvedId, displayName: member.displayName })
  }

  const intendedIds = resolvedMembers.filter((m) => m.userId !== 0).map((m) => m.userId)

  // Remove pod_members and magic_tokens that belong to users NOT in this command.
  // This ensures previous session data doesn't pollute the count.
  if (intendedIds.length > 0) {
    await supabase
      .from('pod_members')
      .delete()
      .eq('pod_id', pod.id)
      .not('telegram_user_id', 'in', `(${intendedIds.join(',')})`)

    await supabase
      .from('magic_tokens')
      .delete()
      .eq('pod_id', pod.id)
      .not('telegram_user_id', 'in', `(${intendedIds.join(',')})`)
  }

  // Check which users are already connected
  const { data: existingMembers } = await supabase
    .from('pod_members')
    .select('telegram_user_id')
    .eq('pod_id', pod.id)

  const connectedIds = new Set((existingMembers ?? []).map((m: any) => m.telegram_user_id))

  // Send magic links (user IDs already resolved above)
  const statusLines = await Promise.all(
    resolvedMembers.map(async (member) => {
      if (member.userId === 0) {
        return `├ ${member.displayName}  ❓ no encontrado en el grupo`
      }

      if (connectedIds.has(member.userId)) {
        return `├ ${member.displayName}  ✅ conectado`
      }

      await sendMagicLink(pod.id, member.userId, chatId, member.displayName)
      return `├ ${member.displayName}  🔗 invitación enviada`
    })
  )

  const connected = statusLines.filter((l) => l.includes('✅')).length
  const total = resolvedMembers.length

  const statusText =
    connected === total
      ? `✅ Pod listo — ${connected}/${total} conectados\n\nEscriban /propose TICKER MONTO para empezar`
      : `⏳ Configurando pod... ${connected}/${total}\n\n${statusLines.join('\n')}\n\nCada miembro recibirá un link privado para conectar su cuenta Wallbit.`

  const sent = await bot.telegram.sendMessage(chatId, statusText)

  // Save the message id so connect route can edit it later
  await supabase
    .from('pods')
    .update({ status_message_id: sent.message_id })
    .eq('id', pod.id)
}

async function getOrCreatePod(telegramGroupId: number) {
  const { data: existing } = await supabase
    .from('pods')
    .select('*')
    .eq('telegram_group_id', telegramGroupId)
    .single()

  if (existing) return existing

  const { data: created, error } = await supabase
    .from('pods')
    .insert({ telegram_group_id: telegramGroupId })
    .select()
    .single()

  if (error || !created) throw new Error('Failed to create pod')
  return created
}

async function sendMagicLink(
  podId: string,
  telegramUserId: number,
  telegramGroupId: number,
  username: string
) {
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  await supabase.from('magic_tokens').insert({
    token,
    telegram_user_id: telegramUserId,
    telegram_group_id: telegramGroupId,
    pod_id: podId,
    expires_at: expiresAt,
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const link = `${appUrl}/connect?token=${token}`

  try {
    await bot.telegram.sendMessage(
      telegramUserId,
      `Hola ${username}! 👋\n\nPara unirte al pod de inversión, conecta tu cuenta Wallbit de forma segura:\n\n🔗 ${link}\n\n⏱ Este link expira en 15 minutos.\n\nTu API key nunca pasará por Telegram — va directo a nuestro servidor encriptado.`
    )
  } catch (err: any) {
    console.warn(`Could not DM ${username} — ${err?.message ?? err}`)
  }
}
