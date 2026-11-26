import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const LOCALES = ['tr', 'en', 'es', 'pt-BR', 'ru', 'zh-CN', 'vi', 'id', 'ko', 'ja', 'de', 'fr']
const dir = path.resolve(__dirname, '../../i18n/locales')

describe('CreateAccount backup_error ham hata metni gostermez', () => {
    it('kaynak error.message gecirmez', () => {
        const src = fs.readFileSync(path.resolve(__dirname, 'CreateAccount.vue'), 'utf8')
        expect(src).not.toMatch(/backup_error'\s*,\s*\{/)
    })
    for (const l of LOCALES) {
        it(`${l}: backup_error yer tutucusuz ve dolu`, () => {
            const j = JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8'))
            const v = j.settings.createAccount.backup_error
            expect(typeof v).toBe('string')
            expect(v.length).toBeGreaterThan(4)
            expect(v).not.toContain('{msg}')
        })
    }
})
