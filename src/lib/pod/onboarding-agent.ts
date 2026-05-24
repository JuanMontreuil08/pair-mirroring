// Onboarding agent — fires once per user after they connect their Wallbit key.
// Pulls portfolio data, sends 3-question DM, synthesizes profile into user_profiles.
// Uses claude-haiku (light model) — this is simple Q&A, not proposal analysis.

import Anthropic from '@anthropic-ai/sdk'
import Supermemory from 'supermemory'
import { bot } from '@/lib/telegram/bot'
import { supabase } from '@/lib/supabase'
import { getCheckingBalance, getStocksPortfolio, getTransactions, SECTOR_MAP } from '@/lib/wallbit/client'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const memory = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY })

const HAIKU = 'claude-haiku-4-5-20251001'

// Entry point — called from connect/route.ts via setImmediate
export async function runOnboardingAgent(telegramUserId: number, wallbitApiKey: string) {
  console.log(`[onboarding] starting for user ${telegramUserId}`)

  // Skip if already onboarded (user joining a second pod)
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('onboarding_completed')
    .eq('telegram_user_id', telegramUserId)
    .single()

  if (existing?.onboarding_completed) return

  // Pull Wallbit data — tolerate empty accounts
  const wallbitData = await fetchWallbitData(wallbitApiKey)

  // Save initial profile row
  await supabase.from('user_profiles').upsert({
    telegram_user_id: telegramUserId,
    profile: { wallbit: wallbitData, self_reported: {} },
    onboarding_completed: false,
  }, { onConflict: 'telegram_user_id' })

  console.log(`[onboarding] wallbit data quality: ${wallbitData.data_quality}, holdings: ${wallbitData.symbols.join(', ') || 'none'}`)

  // Send 3-question DM
  await sendOnboardingQuestions(telegramUserId, wallbitData)
}

async function fetchWallbitData(apiKey: string) {
  let balance = null
  let stocks = null
  let transactions = null

  try { balance = await getCheckingBalance(apiKey); console.log('[onboarding] balance:', JSON.stringify(balance)) } catch (e) { console.warn('[onboarding] balance failed:', e) }
  try { stocks = await getStocksPortfolio(apiKey); console.log('[onboarding] stocks:', JSON.stringify(stocks)) } catch (e) { console.warn('[onboarding] stocks failed:', e) }
  try { transactions = await getTransactions(apiKey); console.log('[onboarding] transactions:', JSON.stringify(transactions)) } catch (e) { console.warn('[onboarding] transactions failed:', e) }

  // GET /balance/checking → { data: [{ currency, balance }] }
  const cashBalance: number = (balance?.data ?? [])
    .find((d: any) => d.currency === 'USD')?.balance ?? 0

  // GET /balance/stocks → { data: [{ symbol, shares }] }
  // No price data available — we work with symbols and shares only
  const positions: Array<{ symbol: string; shares: number }> = stocks?.data ?? []

  // GET /transactions → { data: { data: [...], count, pages } }
  const txCount: number = transactions?.data?.count ?? transactions?.data?.data?.length ?? 0

  const symbols = positions.map((p) => p.symbol)
  const sectors = symbols.map((s) => SECTOR_MAP[s] ?? 'other')
  const sectorSet = [...new Set(sectors)]

  const dataQuality = positions.length === 0 && txCount === 0
    ? 'empty'
    : positions.length < 3
    ? 'sparse'
    : 'rich'

  return {
    cash_balance: cashBalance,
    holdings: positions,          // [{ symbol, shares }]
    symbols,                      // ["NVDA", "VTI", ...]
    sectors: sectorSet,           // ["tech", "etf-broad", ...]
    transaction_count: txCount,
    data_quality: dataQuality,
  }
}

async function sendOnboardingQuestions(telegramUserId: number, wallbitData: any) {
  const holdingsMsg = wallbitData.data_quality !== 'empty'
    ? ` — tenés ${wallbitData.holdings.length} posición${wallbitData.holdings.length !== 1 ? 'es' : ''}`
    : ''

  await bot.telegram.sendMessage(
    telegramUserId,
    `📊 Analicé tu cuenta Wallbit${holdingsMsg}.\n\n3 preguntas rápidas para que tu agente te represente bien en las negociaciones:`
  )

  await bot.telegram.sendMessage(telegramUserId, '1️⃣ Si tu inversión cae 20%, ¿qué harías?', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🔴 Vendo todo', callback_data: 'ob:risk:conservative' },
        { text: '🟡 Espero', callback_data: 'ob:risk:moderate' },
        { text: '🟢 Compro más', callback_data: 'ob:risk:aggressive' },
      ]],
    },
  })

  await bot.telegram.sendMessage(telegramUserId, '2️⃣ ¿Cuál es tu objetivo principal?', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🛡 Preservar capital', callback_data: 'ob:objective:preserve' },
        { text: '📈 Crecer largo plazo', callback_data: 'ob:objective:growth' },
        { text: '💰 Máximo retorno', callback_data: 'ob:objective:income' },
      ]],
    },
  })

  await bot.telegram.sendMessage(telegramUserId, '3️⃣ ¿En cuánto tiempo necesitarías este dinero?', {
    reply_markup: {
      inline_keyboard: [[
        { text: '< 1 año', callback_data: 'ob:horizon:short' },
        { text: '1–5 años', callback_data: 'ob:horizon:medium' },
        { text: '> 5 años', callback_data: 'ob:horizon:long' },
      ]],
    },
  })
}

// Called from webhook/route.ts when a user clicks an onboarding button
export async function handleOnboardingCallback(
  telegramUserId: number,
  callbackData: string,
  callbackQueryId: string
) {
  const [, field, value] = callbackData.split(':')

  const { data: row } = await supabase
    .from('user_profiles')
    .select('profile')
    .eq('telegram_user_id', telegramUserId)
    .single()

  if (!row) return

  const profile = row.profile
  const selfReported = { ...(profile.self_reported ?? {}), [field]: value }
  const updatedProfile = { ...profile, self_reported: selfReported }

  await supabase
    .from('user_profiles')
    .update({ profile: updatedProfile })
    .eq('telegram_user_id', telegramUserId)

  await bot.telegram.answerCbQuery(callbackQueryId, '✅ Guardado')

  // All 3 answered → finalize (guard against duplicate Telegram retries)
  if (selfReported.risk && selfReported.objective && selfReported.horizon) {
    const { data: check } = await supabase
      .from('user_profiles')
      .select('onboarding_completed')
      .eq('telegram_user_id', telegramUserId)
      .single()

    if (!check?.onboarding_completed) {
      await finalizeProfile(telegramUserId, updatedProfile)
    }
  }
}

async function finalizeProfile(telegramUserId: number, profile: any) {
  const { self_reported, wallbit } = profile

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 512,
    tools: [{
      name: 'save_profile',
      description: 'Save the synthesized investor profile',
      input_schema: {
        type: 'object' as const,
        properties: {
          risk_profile: { type: 'string', enum: ['conservative', 'moderate', 'aggressive'] },
          investment_horizon: { type: 'string', enum: ['short', 'medium', 'long'] },
          investment_objective: { type: 'string', enum: ['preserve', 'growth', 'income'] },
          portfolio_style: { type: 'string', enum: ['concentrated', 'diversified', 'cash-heavy', 'unknown'] },
          inferred_signals: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['risk_profile', 'investment_horizon', 'investment_objective', 'portfolio_style', 'inferred_signals', 'summary'],
      },
    }],
    tool_choice: { type: 'tool', name: 'save_profile' },
    messages: [{
      role: 'user',
      content: `Synthesize this LATAM investor profile.

Self-reported:
- Risk reaction to -20%: ${self_reported.risk} (conservative=sell, moderate=hold, aggressive=buy-more)
- Objective: ${self_reported.objective} (preserve=capital preservation, growth=long-term growth, income=max return)
- Horizon: ${self_reported.horizon} (short=<1yr, medium=1-5yr, long=>5yr)

Wallbit portfolio:
- Cash balance (USD): ${wallbit?.cash_balance ?? 0}
- Holdings: ${JSON.stringify(wallbit?.holdings ?? [])}
- Sectors present: ${(wallbit?.sectors ?? []).join(', ') || 'none'}
- Transaction count: ${wallbit?.transaction_count ?? 0}
- Data quality: ${wallbit?.data_quality ?? 'empty'}

inferred_signals: short English tags e.g. "tech-concentrated", "low-cash", "long-horizon", "diversified".
summary: 1 sentence in Spanish describing this investor for negotiation context.`,
    }],
  })

  const toolInput = (response.content[0] as any).input

  const finalProfile = { ...profile, ...toolInput }

  await supabase
    .from('user_profiles')
    .update({
      profile: finalProfile,
      onboarding_completed: true,
      profile_built_at: new Date().toISOString(),
    })
    .eq('telegram_user_id', telegramUserId)

  // Push to Supermemory — seed for orchestrator's memory context.
  // entityContext tells Supermemory what to extract and index from this entry.
  await (memory as any).add({
    content: `Investor profile: ${toolInput.summary}. Risk tolerance: ${toolInput.risk_profile}. Investment horizon: ${toolInput.investment_horizon}. Objective: ${toolInput.investment_objective}. Portfolio style: ${toolInput.portfolio_style}. Behavioral signals: ${toolInput.inferred_signals.join(', ')}. Holdings: ${JSON.stringify(wallbit?.holdings ?? [])}. Cash balance: $${wallbit?.cash_balance ?? 0}.`,
    containerTags: [`user_${telegramUserId}`],
    entityContext: 'LATAM investor profile for a group investment pod. Extract: risk tolerance, investment horizon, portfolio concentration, behavioral signals, and asset preferences. These facts should shape future investment proposal recommendations for this user.',
    metadata: { memory_type: 'investor_profile' },
    customId: `profile_${telegramUserId}`,
  })

  await bot.telegram.sendMessage(
    telegramUserId,
    `✅ ¡Perfil listo!\n\n${toolInput.summary}\n\nCuando alguien en el grupo proponga una operación, tu agente va a negociar en tu nombre y te avisará acá.`
  )
}
