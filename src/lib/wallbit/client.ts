// Wallbit read-only API client
// Docs: see CLAUDE.md → Wallbit API section
// All endpoints: GET only. POST /trades is NOT available.

const WALLBIT_BASE = 'https://api.wallbit.io'

async function wallbitFetch(apiKey: string, path: string) {
  const res = await fetch(`${WALLBIT_BASE}${path}`, {
    headers: { 'X-API-Key': apiKey },
  })

  if (!res.ok) {
    throw new Error(`Wallbit API error ${res.status} on ${path}`)
  }

  return res.json()
}

export async function getCheckingBalance(apiKey: string) {
  return wallbitFetch(apiKey, '/api/public/v1/balance/checking')
}

export async function getStocksPortfolio(apiKey: string) {
  return wallbitFetch(apiKey, '/api/public/v1/balance/stocks')
}

export async function getTransactions(apiKey: string) {
  return wallbitFetch(apiKey, '/api/public/v1/transactions')
}

export async function getAsset(apiKey: string, symbol: string) {
  return wallbitFetch(apiKey, `/api/public/v1/assets/${symbol}`)
}

export async function getAssetsByCategory(apiKey: string, category: string, limit = 5) {
  return wallbitFetch(apiKey, `/api/public/v1/assets?category=${encodeURIComponent(category)}&limit=${limit}`)
}

// Sector classification fallback — used when /assets/{symbol} doesn't return sector
export const SECTOR_MAP: Record<string, string> = {
  NVDA: 'tech', MSFT: 'tech', AAPL: 'tech', AMZN: 'tech', GOOGL: 'tech',
  META: 'tech', AMD: 'tech', TSLA: 'tech', NFLX: 'tech', CRM: 'tech',
  VTI: 'etf-broad', VOO: 'etf-broad', SPY: 'etf-broad', QQQ: 'etf-tech',
  VEU: 'etf-international', VXUS: 'etf-international', EEM: 'etf-emerging',
  BND: 'bonds', AGG: 'bonds', TLT: 'bonds',
  GLD: 'commodities', SLV: 'commodities',
}
