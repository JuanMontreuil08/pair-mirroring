import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!url || !serviceKey) {
  throw new Error('Missing Supabase env vars')
}

// Service role client — bypasses RLS, used only server-side
export const supabase = createClient(url, serviceKey)
