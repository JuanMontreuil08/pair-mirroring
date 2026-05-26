import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const { name, email, message } = await req.json()

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Nombre y email son requeridos' }, { status: 400 })
  }

  const supabase = createClient(url, key)
  const { error } = await supabase
    .from('waitlist')
    .insert({ name: name.trim(), email: email.trim(), message: message?.trim() || null })

  if (error) {
    console.error('[waitlist]', error.message)
    return NextResponse.json({ error: 'No se pudo guardar. Intenta de nuevo.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
