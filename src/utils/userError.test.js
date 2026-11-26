import { describe, it, expect } from 'vitest'
import { userErrorKey, isNetworkError, USER_ERROR_KEYS } from './userError'

describe('userErrorKey', () => {
    it('yetersiz bakiye kodu yetersiz bakiye anahtarina gider', () => {
        expect(userErrorKey({ code: 'INSUFFICIENT_FUNDS', message: 'insufficient funds for gas' }))
            .toBe('send.insufficientBalance')
    })
    it('kullanici reddi reddedildi anahtarina gider', () => {
        expect(userErrorKey({ code: 'ACTION_REJECTED' })).toBe('send.errors.userRejected')
    })
    it.each([
        [{ code: 'NETWORK_ERROR' }],
        [{ code: 'TIMEOUT' }],
        [{ code: 'ERR_NETWORK' }],
        [{ message: 'Network Error' }],
        [{ message: 'noNetwork' }],
        [{ message: 'could not detect network (event="noNetwork", code=NETWORK_ERROR)' }],
        [new Error('Network Error')],
    ])('ag hatasi belirsiz anahtara gider: %j', (err) => {
        expect(userErrorKey(err)).toBe('send.errors.network')
        expect(isNetworkError(err)).toBe(true)
        expect(userErrorKey(err)).not.toBe('send.confirmTransaction.txFailed')
    })
    it('bilinmeyen hata txFailed olur, ham metin donmez', () => {
        const key = userErrorKey(new Error('Request failed with status code 500 at https://rpc.x'))
        expect(key).toBe('send.confirmTransaction.txFailed')
        expect(userErrorKey(null)).toBe('send.confirmTransaction.txFailed')
        expect(userErrorKey('ham metin')).toBe('send.confirmTransaction.txFailed')
    })
    it('donen her deger bilinen anahtar kumesinde', () => {
        for (const e of [{ code: 'INSUFFICIENT_FUNDS' }, { code: 'ACTION_REJECTED' }, { code: 'TIMEOUT' }, {}, null]) {
            expect(Object.values(USER_ERROR_KEYS)).toContain(userErrorKey(e))
        }
    })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

describe('userError anahtarlari 12 dilde', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../i18n/locales')
    const langs = ['tr', 'en', 'es', 'pt-BR', 'ru', 'zh-CN', 'vi', 'id', 'ko', 'ja', 'de', 'fr']
    const get = (o, k) => k.split('.').reduce((a, p) => a?.[p], o)
    it.each(langs)('%s', (l) => {
        const json = JSON.parse(readFileSync(path.join(dir, `${l}.json`), 'utf8'))
        for (const k of Object.values(USER_ERROR_KEYS)) {
            expect(typeof get(json, k), `${l}:${k}`).toBe('string')
        }
    })
})
