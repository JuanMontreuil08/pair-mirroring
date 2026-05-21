import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.AES_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('AES_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

// Scramble a Wallbit API key before storing it in Supabase
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Stored format: iv:authTag:ciphertext (all hex, colon-separated)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

// Recover the original API key from the stored scrambled string
export function decrypt(stored: string): string {
  const key = getKey()
  const parts = stored.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format — expected iv:authTag:ciphertext')
  }

  const [ivHex, authTagHex, encryptedHex] = parts
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}
