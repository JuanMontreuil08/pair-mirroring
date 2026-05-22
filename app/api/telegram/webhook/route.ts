import { NextRequest, NextResponse } from 'next/server'
import { handlePairMirroring } from '@/lib/telegram/handlers/pair-mirroring'
import { handlePropose } from '@/lib/telegram/handlers/propose'
import { handleOnboardingCallback } from '@/lib/pod/onboarding-agent'

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
    }
  } catch (err) {
    console.error('Webhook processing error:', err)
  }
}
