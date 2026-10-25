import { describe, expect, it } from 'vitest'
import { AppError } from '../../../../shared/ipc-error'
import {
  decryptSecret,
  ENCRYPTED_SECRET_PREFIX,
  encryptSecret,
  maskSecret,
  maskSecretMetadata,
  type SafeStorageLike,
} from './dictation-secrets'

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from(`enc_${plain}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const str = encrypted.toString('utf8')
      if (!str.startsWith('enc_')) {
        throw new Error('Decryption failed: invalid payload')
      }
      return str.slice('enc_'.length)
    },
  }
}

describe('dictation-secrets', () => {
  describe('encryptSecret', () => {
    it('encrypts secret with enc:v1: prefix when safeStorage is available', () => {
      const storage = fakeSafeStorage(true)
      const secret = 'sk-test-secret-12345'
      const encrypted = encryptSecret(secret, storage)

      expect(encrypted).toMatch(/^enc:v1:[A-Za-z0-9+/=]+$/)
      expect(encrypted).not.toContain(secret)
    })

    it('returns empty string for empty or whitespace-only input', () => {
      const storage = fakeSafeStorage(true)
      expect(encryptSecret('', storage)).toBe('')
      expect(encryptSecret('   ', storage)).toBe('')
    })

    it('returns value unchanged if already encrypted with enc:v1:', () => {
      const storage = fakeSafeStorage(true)
      const alreadyEncrypted = 'enc:v1:dGVzdA=='
      expect(encryptSecret(alreadyEncrypted, storage)).toBe(alreadyEncrypted)
    })

    it('throws actionable AppError when safeStorage is unavailable or cannot encrypt', () => {
      const unavailableStorage = fakeSafeStorage(false)
      expect(() => encryptSecret('my-secret', unavailableStorage)).toThrowError(AppError)
      expect(() => encryptSecret('my-secret', unavailableStorage)).toThrowError(
        /safeStorage.*unavailable/i,
      )

      expect(() => encryptSecret('my-secret', undefined)).toThrowError(AppError)
    })
  })

  describe('decryptSecret', () => {
    it('decrypts encrypted secret back to original plaintext', () => {
      const storage = fakeSafeStorage(true)
      const secret = 'sk-eleven-labs-api-key-987'
      const encrypted = encryptSecret(secret, storage)

      const decrypted = decryptSecret(encrypted, storage)
      expect(decrypted).toBe(secret)
    })

    it('returns empty string for empty input', () => {
      const storage = fakeSafeStorage(true)
      expect(decryptSecret('', storage)).toBe('')
      expect(decryptSecret(null as unknown as string, storage)).toBe('')
    })

    it('returns unencrypted string as-is for legacy plaintext compatibility', () => {
      const storage = fakeSafeStorage(true)
      const legacySecret = 'legacy-plain-key'
      expect(decryptSecret(legacySecret, storage)).toBe(legacySecret)
    })

    it('throws actionable AppError when safeStorage is unavailable for encrypted ciphertext', () => {
      const storage = fakeSafeStorage(true)
      const encrypted = encryptSecret('secret-token', storage)

      const unavailableStorage = fakeSafeStorage(false)
      expect(() => decryptSecret(encrypted, unavailableStorage)).toThrowError(AppError)
      expect(() => decryptSecret(encrypted, unavailableStorage)).toThrowError(
        /cannot decrypt.*safeStorage.*unavailable/i,
      )
    })

    it('throws actionable AppError when decryption fails due to corrupted ciphertext', () => {
      const storage = fakeSafeStorage(true)
      const corruptCiphertext = `${ENCRYPTED_SECRET_PREFIX}${Buffer.from('corrupted_not_enc').toString('base64')}`

      expect(() => decryptSecret(corruptCiphertext, storage)).toThrowError(AppError)
      expect(() => decryptSecret(corruptCiphertext, storage)).toThrowError(/failed to decrypt/i)
    })
  })

  describe('maskSecret / maskSecretMetadata', () => {
    it('returns not configured for empty or null secrets', () => {
      expect(maskSecret('')).toEqual({ configured: false, lastFour: '', valid: false })
      expect(maskSecret(null)).toEqual({ configured: false, lastFour: '', valid: false })
      expect(maskSecret(undefined)).toEqual({ configured: false, lastFour: '', valid: false })
    })

    it('returns last four characters of decrypted/plaintext secret without leaking rest', () => {
      const meta = maskSecret('sk-1234567890abcdef')
      expect(meta).toEqual({ configured: true, lastFour: 'cdef', valid: true })
    })

    it('handles short secrets safely', () => {
      const meta = maskSecret('abc')
      expect(meta).toEqual({ configured: true, lastFour: 'abc', valid: true })
    })

    it('maskSecretMetadata decrypts ciphertext and masks correctly', () => {
      const storage = fakeSafeStorage(true)
      const encrypted = encryptSecret('openrouter-secret-key-5432', storage)

      const meta = maskSecretMetadata(encrypted, storage)
      expect(meta).toEqual({ configured: true, lastFour: '5432', valid: true })
    })

    it('maskSecretMetadata reports invalid when decryption fails', () => {
      const storage = fakeSafeStorage(true)
      const corruptCiphertext = `${ENCRYPTED_SECRET_PREFIX}${Buffer.from('corrupt').toString('base64')}`

      const meta = maskSecretMetadata(corruptCiphertext, storage)
      expect(meta).toEqual({ configured: true, lastFour: '', valid: false })
    })
  })
})
