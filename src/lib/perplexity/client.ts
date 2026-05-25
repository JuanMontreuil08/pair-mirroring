// Perplexity sonar client — fetches recent news for a stock ticker.
// Returns up to 5 items from the last 7 days by default.
// Called once per proposal (shared across all pod members).

export interface NewsItem {
  title: string
  source: string
  date: string
  summary: string
  url: string
}

function daysToRecencyFilter(days: number): string {
  if (days <= 1) return 'day'
  if (days <= 7) return 'week'
  if (days <= 30) return 'month'
  return 'year'
}

export async function getStockNews(ticker: string, days = 7): Promise<NewsItem[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) {
    console.warn('[perplexity] PERPLEXITY_API_KEY not set — skipping news fetch')
    return []
  }

  const recency = daysToRecencyFilter(days)

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        search_recency_filter: recency,
        messages: [
          {
            role: 'system',
            content:
              'You are a financial news assistant. Only return news that is specifically and directly about the requested stock ticker and company. Never include news about other companies.',
          },
          {
            role: 'user',
            content: `Find the 5 most important recent news articles specifically about $${ticker} stock. For each article include: title, publication date, source name, and a 1-2 sentence summary of why it matters to investors.`,
          },
        ],
      }),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.warn(`[perplexity] API error ${res.status} for ${ticker}`)
      return []
    }

    const json = await res.json()

    // Primary: structured search_results
    if (Array.isArray(json.search_results) && json.search_results.length > 0) {
      return json.search_results.slice(0, 5).map((item: any) => ({
        title: item.title ?? '',
        source: item.url ? new URL(item.url).hostname.replace('www.', '') : 'unknown',
        date: item.date ?? '',
        summary: item.snippet ?? '',
        url: item.url ?? '',
      }))
    }

    // Fallback: parse content text + citations
    const content: string = json.choices?.[0]?.message?.content ?? ''
    const citations: string[] = json.citations ?? []
    if (!content) return []

    // Build items from citation URLs paired with content lines
    return citations.slice(0, 5).map((url: string, i: number) => ({
      title: `${ticker} news #${i + 1}`,
      source: (() => { try { return new URL(url).hostname.replace('www.', '') } catch { return 'unknown' } })(),
      date: '',
      summary: content.split('\n').filter(Boolean)[i] ?? '',
      url,
    }))
  } catch (err) {
    console.warn(`[perplexity] fetch failed for ${ticker}:`, err)
    return []
  }
}

export function formatNewsForPrompt(news: NewsItem[]): string {
  if (news.length === 0) return 'No recent news available.'
  return news
    .map((item, i) => {
      const date = item.date ? ` (${item.date})` : ''
      const source = item.source ? ` — ${item.source}` : ''
      return `${i + 1}. ${item.title}${date}${source}\n   ${item.summary}`
    })
    .join('\n')
}
