import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { importTokenError, importTokenErrorKey } from '../utils/importTokenError'

const src = readFileSync(new URL('./ImportToken.vue', import.meta.url), 'utf8')

describe('ImportToken hata metni', () => {
    it('ham ag/RPC metni anahtara donusur, sizmaz', () => {
        expect(importTokenErrorKey(new Error('could not detect network (event="noNetwork")'))).toBe('importToken.custom.errorFetchFailed')
        expect(importTokenErrorKey({ code: 'NETWORK_ERROR', message: 'Network Error' })).toBe('importToken.custom.errorFetchFailed')
        expect(importTokenErrorKey(null)).toBe('importToken.custom.errorFetchFailed')
    })
    it('kendi hatalari korunur', () => {
        expect(importTokenErrorKey(importTokenError('importToken.custom.errorNotContract'))).toBe('importToken.custom.errorNotContract')
        expect(importTokenErrorKey(importTokenError('importToken.custom.errorNotErc20'))).toBe('importToken.custom.errorNotErc20')
    })
    it('baska ad alanindan anahtar kabul edilmez', () => {
        expect(importTokenErrorKey({ i18nKey: 'send.errors.x' })).toBe('importToken.custom.errorFetchFailed')
    })
    it('ImportToken.vue errorMessage a error.message atamaz', () => {
        expect(src).not.toMatch(/errorMessage\.value\s*=\s*error\.message/)
        expect(src).not.toMatch(/new Error\(t\(/)
        expect(src.match(/importTokenErrorKey\(error\)/g)?.length).toBe(2)
    })
})
