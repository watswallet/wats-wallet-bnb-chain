// Dapp'siz gonderim hatasi: ham err.message kullaniciya gosterilmez, cevrili anahtar gosterilir.
// Dapp'e giden -32603 / err.message (failDappSend) DEGISMEZ.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { userErrorKey } from '../utils/userError'

const src = readFileSync(new URL('./Dapp.vue', import.meta.url), 'utf8')

describe('Dapp.vue dapp-siz gonderim hatasi', () => {
    it('alert ham err.message gostermez', () => {
        expect(src).not.toMatch(/alert\(\s*err\.message/)
    })
    it('alert userErrorKey ile cevrilir', () => {
        expect(src).toMatch(/alert\(\s*t\(\s*userErrorKey\(err\)\s*\)\s*\)/)
    })
    it('ham ethers metni anahtara donusur, metin sizmaz', () => {
        const k = userErrorKey(new Error('could not coalesce error (error={ "code": -32000 })'))
        expect(k).toBe('send.confirmTransaction.txFailed')
    })
    it('dapp yolu hala err.message tasir', () => {
        const f = readFileSync(new URL('../utils/dappSendFlow.js', import.meta.url), 'utf8')
        expect(f).toMatch(/message: err\.message \|\| 'Internal error'/)
    })
})
