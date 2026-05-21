import { NextRequest, NextResponse } from 'next/server'
import { handlePairMirroring } from '@/lib/telegram/handlers/pair-mirroring'

export async function POST(req: NextRequest) {
  // Return 200 immediately — Telegram times out at 5s, agents take longer
  const update = await req.json()
  setImmediate(() => processUpdate(update))
  return NextResponse.json({ ok: true })
}

async function processUpdate(update: any) {
  try {
    const message = update.message
    if (!message?.text) return

    const text: string = message.text
    const chatId: number = message.chat.id
    const userId: number = message.from.id

    // Route commands
    if (text.startsWith('/pair-mirroring')) {
      await handlePairMirroring({ message, chatId, userId, text })
    }
  } catch (err) {
    console.error('Webhook processing error:', err)
  }
}
