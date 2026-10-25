import { describe, expect, it } from 'vitest'
import { DiffValidator } from './diff-validator'

describe('DiffValidator', () => {
  const validator = new DiffValidator()

  describe('Numbers, ports, and versions preservation', () => {
    it('accepts transcripts where numbers, ports, and versions are preserved', () => {
      const raw = 'server running on port 8080 with python 3.11 and 42 workers'
      const candidate = 'Server running on port 8080 with Python 3.11 and 42 workers.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('accepts normalized numbers with comma thousand separators', () => {
      const raw = 'we processed 10000 records'
      const candidate = 'We processed 10,000 records.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('rejects candidate when a number is modified', () => {
      const raw = 'connect to port 8080'
      const candidate = 'Connect to port 8081.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/number|numbers mismatch/i)
    })

    it('rejects candidate when a number is omitted', () => {
      const raw = 'release version 3.11 now'
      const candidate = 'Release version now.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/number/i)
    })

    it('rejects candidate when an unprompted number is introduced', () => {
      const raw = 'deploy the app'
      const candidate = 'Deploy the app on port 3000.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/number/i)
    })
  })

  describe('Negation words preservation (English and Polish)', () => {
    it('accepts transcripts where English negations are preserved', () => {
      const raw = 'do not restart the database server'
      const candidate = 'Do not restart the database server.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('accepts contraction expansion of English negations', () => {
      const raw = "don't restart the database"
      const candidate = 'Do not restart the database.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('rejects when English negation is removed (inverting meaning)', () => {
      const raw = 'do not delete the production database'
      const candidate = 'Delete the production database.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('rejects when English negation is introduced', () => {
      const raw = 'restart the web service'
      const candidate = 'Do not restart the web service.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('rejects when other English negations (never, none, neither) are removed', () => {
      expect(validator.validate('never run this query', 'Run this query.').valid).toBe(false)
      expect(validator.validate('none of the tests failed', 'All of the tests failed.').valid).toBe(
        false,
      )
      expect(validator.validate('neither foo nor bar worked', 'Foo and bar worked.').valid).toBe(
        false,
      )
    })

    it('accepts transcripts where Polish negations are preserved', () => {
      const raw = 'nie usuwaj tego pliku nigdy'
      const candidate = 'Nie usuwaj tego pliku nigdy.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('rejects when Polish negation (nie) is removed', () => {
      const raw = 'ten moduł nie działa poprawnie'
      const candidate = 'Ten moduł działa poprawnie.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('rejects when Polish negation is introduced', () => {
      const raw = 'włącz logowanie błędów'
      const candidate = 'Nie włączaj logowania błędów.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('handles Polish words with nie prefix (e.g. nielubiane, niepoprawne)', () => {
      const raw = 'to jest nielubiane rozwiązanie'
      const candidate = 'To jest nielubiane rozwiązanie.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })

      // Removed nie prefix
      const stripped = 'To jest lubiane rozwiązanie.'
      expect(validator.validate(raw, stripped).valid).toBe(false)
    })

    it('rejects when Polish negations (brak, żaden, ani) are removed', () => {
      expect(validator.validate('brak wolnego miejsca', 'Wolne miejsce.').valid).toBe(false)
      expect(
        validator.validate('żaden test nie przeszedł', 'Wszystkie testy przeszły.').valid,
      ).toBe(false)
      expect(
        validator.validate(
          'ani jeden pakiet nie został zainstalowany',
          'Pakiet został zainstalowany.',
        ).valid,
      ).toBe(false)
    })

    it('rejects candidate when duplicate English negations are dropped (frequency tracking)', () => {
      const raw = 'do not restart and do not stop the server'
      const candidate = 'Do not restart and stop the server.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('rejects candidate when duplicate English negations are introduced', () => {
      const raw = 'do not restart and stop the server'
      const candidate = 'Do not restart and do not stop the server.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('rejects candidate when duplicate Polish negations are dropped', () => {
      const raw = 'nie instaluj i nie uruchamiaj tego serwisu'
      const candidate = 'Nie instaluj i uruchamiaj tego serwisu.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('rejects candidate when duplicate Polish negations are introduced', () => {
      const raw = 'nie instaluj i uruchamiaj ten serwis'
      const candidate = 'Nie instaluj i nie uruchamiaj tego serwisu.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('allows removing Polish conversational particles (no to, no tak, no pewnie) as filler', () => {
      expect(validator.validate('no to zróbmy deploy', 'Zróbmy deploy.').valid).toBe(true)
      expect(validator.validate('no tak usuń ten plik', 'Usuń ten plik.').valid).toBe(true)
      expect(validator.validate('no pewnie to zadziała', 'Pewnie to zadziała.').valid).toBe(true)
      expect(validator.validate('no zróbmy to teraz', 'Zróbmy to teraz.').valid).toBe(true)
    })

    it('preserves Polish negation while dropping Polish filler particle', () => {
      const raw = 'no to nie usuwaj tego pliku'
      const validCandidate = 'Nie usuwaj tego pliku.'
      expect(validator.validate(raw, validCandidate)).toEqual({ valid: true })

      const invalidCandidate = 'Usuwaj ten plik.'
      const result = validator.validate(raw, invalidCandidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })

    it('rejects English transcript when English negation no is omitted', () => {
      const raw = 'there are no errors found in the logs'
      const candidate = 'There are errors found in the logs.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/negation/i)
    })
  })

  describe('Code tokens and backtick blocks preservation', () => {
    it('accepts code tokens preserved verbatim or wrapped in backticks', () => {
      const raw = 'call function getUserById with order_id'
      const candidate = 'Call function `getUserById` with `order_id`.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('accepts pre-existing backtick blocks', () => {
      const raw = 'run `pnpm install` in root'
      const candidate = 'Run `pnpm install` in the root directory.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('rejects candidate when camelCase identifier is altered', () => {
      const raw = 'update getUserProfile in auth service'
      const candidate = 'Update getUserData in auth service.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/code token/i)
    })

    it('rejects candidate when snake_case identifier is altered or removed', () => {
      const raw = 'check max_retry_count value'
      const candidate = 'Check maximum retry count value.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/code token/i)
    })

    it('rejects candidate when identifier is modified to a longer identifier containing it as substring', () => {
      const raw = 'call function getUser now'
      const candidate = 'Call function `getUserById` now.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/code token/i)
    })

    it('rejects candidate when snake_case identifier is modified to a longer identifier containing it', () => {
      const raw = 'update max_retries setting'
      const candidate = 'Update `max_retries_count` setting.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/code token/i)
    })
  })

  describe('URLs and file paths preservation', () => {
    it('accepts transcripts where URLs and file paths are preserved', () => {
      const raw = 'check https://api.openrouter.ai/v1 and file src/main/index.ts'
      const candidate = 'Check `https://api.openrouter.ai/v1` and file `src/main/index.ts`.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('accepts Windows file paths and Windows relative paths with backslashes', () => {
      const raw = 'open C:\\projects\\NeKode\\package.json and edit src\\main\\index.ts'
      const candidate = 'Open `C:\\projects\\NeKode\\package.json` and edit `src\\main\\index.ts`.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })

      // Normalized forward slashes in candidate are accepted
      const candidateNorm =
        'Open `C:\\projects\\NeKode\\package.json` and edit `src/main/index.ts`.'
      expect(validator.validate(raw, candidateNorm)).toEqual({ valid: true })
    })

    it('accepts extensionless directory paths', () => {
      const raw = 'look in src/main/services and src\\main\\utils directory'
      const candidate = 'Look in `src/main/services` and `src\\main\\utils` directory.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('rejects candidate when URL is modified', () => {
      const raw = 'visit https://example.com/api/v1'
      const candidate = 'Visit https://example.com/api/v2.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/url/i)
    })

    it('rejects candidate when an unprompted URL is added', () => {
      const raw = 'look at the documentation'
      const candidate = 'Look at the documentation at https://evil.com/phish.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/url/i)
    })

    it('rejects candidate when file path is modified', () => {
      const raw = 'edit src/main/services/dictation.ts'
      const candidate = 'Edit src/renderer/services/dictation.ts.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/file path|code token/i)
    })

    it('rejects candidate when an unprompted file path is injected (bidirectional validation)', () => {
      const raw = 'inspect the current project structure'
      const candidate = 'Inspect the current project structure in `src/main/secret-keys.ts`.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/file path/i)
    })

    it('rejects candidate when an unprompted extensionless directory path is injected', () => {
      const raw = 'check the frontend components'
      const candidate = 'Check the frontend components in `src/renderer/components`.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/file path/i)
    })

    it('rejects candidate when Windows relative path is altered', () => {
      const raw = 'edit src\\main\\index.ts'
      const candidate = 'Edit `src\\renderer\\index.ts`.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/file path|code token/i)
    })
  })

  describe('CLI flags preservation', () => {
    it('accepts transcripts where CLI flags are preserved', () => {
      const raw = 'run vitest with --coverage and -u'
      const candidate = 'Run `vitest` with `--coverage` and `-u`.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('rejects candidate when a CLI flag is removed', () => {
      const raw = 'execute rm with -rf on target'
      const candidate = 'Execute rm on target.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/cli flag/i)
    })

    it('rejects candidate when an unprompted CLI flag is introduced', () => {
      const raw = 'run cleanup script'
      const candidate = 'Run cleanup script with --force.'
      const result = validator.validate(raw, candidate)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/cli flag/i)
    })
  })

  describe('Benign text adjustments and edge cases', () => {
    it('allows punctuation and capitalization formatting', () => {
      const raw = 'hello world are you ready'
      const candidate = 'Hello, world! Are you ready?'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('allows removing filler words', () => {
      const raw = 'so um we should yyyy deploy this znaczy now'
      const candidate = 'So we should deploy this now.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('allows whitespace normalization', () => {
      const raw = 'line one   \n\n   line two'
      const candidate = 'Line one line two.'
      expect(validator.validate(raw, candidate)).toEqual({ valid: true })
    })

    it('handles empty strings gracefully', () => {
      expect(validator.validate('', '')).toEqual({ valid: true })
      expect(validator.validate('hello', '').valid).toBe(false)
    })
  })
})
