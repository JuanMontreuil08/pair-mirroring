import { NextRequest, NextResponse } from 'next/server'
import { handlePairMirroring } from '@/lib/telegram/handlers/pair-mirroring'
import { handlePropose } from '@/lib/telegram/handlers/propose'
import { handleOnboardingCallback } from '@/lib/pod/onboarding-agent'
import { handleVoteCallback } from '@/lib/telegram/handlers/vote'
import { handleRejectionReason } from '@/lib/telegram/handlers/rejection-reason'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  // Return 200 immediately — Telegram times out at 5s, agents take longer
  const update = await req.json()
  setImmediate(() => processUpdate(update))
  return NextResponse.json({ ok: true })
}

async function processUpdate(update: any) {
  try {
    // Handle inline keyboard callbacks
    if (update.callback_query) {
      const query = update.callback_query
      const userId: number = query.from.id
      const data: string = query.data ?? ''

      if (data.startsWith('ob:')) {
        await handleOnboardingCallback(userId, data, query.id)
      } else if (data.startsWith('vote:')) {
        await handleVoteCallback(userId, data, query.id)
      }
      return
    }

    // Handle text messages
    const message = update.message
    if (!message?.text) return

    const text: string = message.text
    const chatId: number = message.chat.id
    const userId: number = message.from.id

    if (text.startsWith('/pair-mirroring')) {
      await handlePairMirroring({ message, chatId, userId, text })
    } else if (text.startsWith('/propose')) {
      await handlePropose({ chatId, userId, text })
    } else if (text === '/start') {
      // Cache user ID + username so pair-mirroring can resolve @mentions
      await cacheUserIdentity(userId, message.from?.username)
    } else if (message.chat.type === 'private' && !text.startsWith('/')) {
      // Free-text DM — could be a rejection reason
      await handleRejectionReason(userId, text)
    }
  } catch (err) {
    console.error('Webhook processing error:', err)
  }
}

async function cacheUserIdentity(telegramUserId: number, username?: string) {
  if (!username) return
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('profile')
    .eq('telegram_user_id', telegramUserId)
    .single()

  if (existing) {
    await supabase
      .from('user_profiles')
      .update({ profile: { ...existing.profile, username } })
      .eq('telegram_user_id', telegramUserId)
  } else {
    await supabase
      .from('user_profiles')
      .insert({ telegram_user_id: telegramUserId, profile: { username }, onboarding_completed: false })
  }
}
