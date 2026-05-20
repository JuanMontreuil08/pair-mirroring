import { Telegraf } from 'telegraf'

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required')
}

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
