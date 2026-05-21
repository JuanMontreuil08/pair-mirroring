import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { encrypt } from '@/lib/crypto'
import { bot } from '@/lib/telegram/bot'

export async function POST(req: NextRequest) {
  const { token, wallbitApiKey } = await req.json()

  if (!token || !wallbitApiKey) {
    return NextResponse.json({ error: 'Missing token or API key' }, { status: 400 })
  }

  // Look up the token
  const { data: magicToken, error } = await supabase
    .from('magic_tokens')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !magicToken) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 })
  }

  // Encrypt the API key and store the member
  const encrypted = encrypt(wallbitApiKey)

  // Upsert pod member
  const { error: memberError } = await supabase
    .from('pod_members')
    .upsert({
      pod_id: magicToken.pod_id,
      telegram_user_id: magicToken.telegram_user_id,
      wallbit_api_key_encrypted: encrypted,
    }, { onConflict: 'pod_id,telegram_user_id' })

  if (memberError) {
    console.error('Failed to save pod member:', memberError)
    return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 })
  }

  // Mark token as used
  await supabase
    .from('magic_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', magicToken.id)

  // Update the group status message
  await updateGroupStatus(magicToken.pod_id, magicToken.telegram_group_id)

  return NextResponse.json({ ok: true })
}

async function updateGroupStatus(podId: string, groupChatId: number) {
  try {
    // Count connected members
    const { data: members } = await supabase
      .from('pod_members')
      .select('telegram_user_id')
      .eq('pod_id', podId)

    // Count expected members from pending tokens (to know the total)
    const { data: allTokens } = await supabase
      .from('magic_tokens')
      .select('telegram_user_id')
      .eq('pod_id', podId)

    const connected = members?.length ?? 0
    const total = allTokens
      ? new Set(allTokens.map((t: any) => t.telegram_user_id)).size
      : connected

    const allDone = connected >= total

    const text = allDone
      ? `✅ Pod listo — ${connected}/${total} conectados\n\nEscriban /propose TICKER MONTO para empezar`
      : `⏳ Conectando pod... ${connected}/${total}\n\nEsperando que los demás conecten su cuenta Wallbit.`

    // Get the pod to find the status message id
    const { data: pod } = await supabase
      .from('pods')
      .select('status_message_id')
      .eq('id', podId)
      .single()

    if (pod?.status_message_id) {
      await bot.telegram.editMessageText(groupChatId, pod.status_message_id, undefined, text)
    }
  } catch (err) {
    console.error('Failed to update group status:', err)
  }
}
