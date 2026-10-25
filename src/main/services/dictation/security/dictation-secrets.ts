import { AppError } from '../../../../shared/ipc-error'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export const ENCRYPTED_SECRET_PREFIX = 'enc:v1:'

export interface SecretMetadata {
  configured: boolean
  lastFour: string
  valid: boolean
}

/**
 * Encrypts a plaintext secret using Electron safeStorage at rest with the 'enc:v1:' prefix.
 * Throws an actionable AppError if safeStorage is unavailable or cannot encrypt.
 */
export function encryptSecret(plainText: string, safeStorage?: SafeStorageLike): string {
  if (!plainText || plainText.trim().length === 0) {
    return ''
  }

  if (plainText.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    return plainText
  }

  if (!safeStorage?.isEncryptionAvailable()) {
    throw new AppError(
      'validation',
      'Cannot encrypt secret: OS keychain encryption (safeStorage) is unavailable on this system.',
    )
  }

  try {
    const buffer = safeStorage.encryptString(plainText)
    return `${ENCRYPTED_SECRET_PREFIX}${buffer.toString('base64')}`
  } catch {
    throw new AppError('validation', 'Failed to encrypt secret with the OS keychain (safeStorage).')
  }
}

/**
 * Decrypts a secret stored with the 'enc:v1:' prefix using Electron safeStorage.
 * Unencrypted strings are returned as-is for legacy backwards compatibility.
 * Throws an actionable AppError if safeStorage is unavailable or decryption fails.
 */
export function decryptSecret(cipherText: string, safeStorage?: SafeStorageLike): string {
  if (!cipherText || cipherText.trim().length === 0) {
    return ''
  }

  if (!cipherText.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    return cipherText
  }

  if (!safeStorage?.isEncryptionAvailable()) {
    throw new AppError(
      'validation',
      'Cannot decrypt secret: safeStorage is unavailable on this system.',
    )
  }

  try {
    const base64Data = cipherText.slice(ENCRYPTED_SECRET_PREFIX.length)
    const buffer = Buffer.from(base64Data, 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    throw new AppError('validation', 'Failed to decrypt secret with the OS keychain (safeStorage).')
  }
}

/**
 * Produces a safe metadata mask from a plaintext or decrypted secret value.
 * Never leaks the full secret to the caller or renderer.
 */
export function maskSecret(
  plainOrDecryptedSecret: string | null | undefined,
  valid = true,
): SecretMetadata {
  if (!plainOrDecryptedSecret || plainOrDecryptedSecret.trim().length === 0) {
    return { configured: false, lastFour: '', valid: false }
  }

  const trimmed = plainOrDecryptedSecret.trim()
  const lastFour = trimmed.length <= 4 ? trimmed : trimmed.slice(-4)
  return { configured: true, lastFour, valid }
}

/**
 * Safely extracts metadata from a secret string (which may be encrypted with enc:v1:).
 * Decrypts in memory only to compute lastFour, without exposing the plaintext.
 */
export function maskSecretMetadata(
  secret: string | null | undefined,
  safeStorage?: SafeStorageLike,
): SecretMetadata {
  if (!secret || secret.trim().length === 0) {
    return { configured: false, lastFour: '', valid: false }
  }

  if (secret.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    if (!safeStorage?.isEncryptionAvailable()) {
      return { configured: true, lastFour: '', valid: false }
    }
    try {
      const decrypted = decryptSecret(secret, safeStorage)
      return maskSecret(decrypted, true)
    } catch {
      return { configured: true, lastFour: '', valid: false }
    }
  }

  return maskSecret(secret, true)
}
