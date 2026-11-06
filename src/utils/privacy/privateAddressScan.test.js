import { describe, it, expect } from 'vitest'
import { containsPrivateAddress, payloadTouchesPrivate } from './privateAddressScan'

const GIZLI = '0x' + 'cd12'.repeat(10)
const bare = GIZLI.slice(2)
const A = '0x' + 'ab'.repeat(20)
const pad = (hex) => hex.padStart(64, '0')

describe('containsPrivateAddress -- tek metin', () => {
    it('duz adres (0x li, 0x siz, buyuk/kucuk harf)', () => {
        expect(containsPrivateAddress(GIZLI, GIZLI)).toBe(true)
        expect(containsPrivateAddress(bare, GIZLI)).toBe(true)
        expect(containsPrivateAddress('0x' + bare.toUpperCase(), GIZLI)).toBe(true)
        expect(containsPrivateAddress('0X' + bare.toUpperCase(), GIZLI.toUpperCase())).toBe(true)
    })
    it('32 bayt sola dolgulu ABI penceresi ve cagri verisinin HERHANGI bir konumu', () => {
        const router = '0x38ed1739' + pad(bare) + pad('1') + pad('a0')
        expect(containsPrivateAddress(router, GIZLI)).toBe(true)
        // dolgusuz (paketlenmis) konum, 4 bayt selector sonrasi
        expect(containsPrivateAddress('0xdeadbeef' + bare + '00'.repeat(8), GIZLI)).toBe(true)
        expect(containsPrivateAddress('0xdeadbeef' + bare.toUpperCase() + '00', GIZLI)).toBe(true)
    })
    it('Gizli adresi icermeyen normal veri gecer', () => {
        expect(containsPrivateAddress(A, GIZLI)).toBe(false)
        expect(containsPrivateAddress('0xa9059cbb' + pad(A.slice(2)) + pad('5'), GIZLI)).toBe(false)
        expect(containsPrivateAddress('0x', GIZLI)).toBe(false)
        expect(containsPrivateAddress('', GIZLI)).toBe(false)
    })
    it('bos / gecersiz Gizli adres asla eslesme saymaz', () => {
        for (const bad of [null, undefined, '', '0x', '0x1234', 'zz'.repeat(20)]) {
            expect(containsPrivateAddress(GIZLI, bad)).toBe(false)
        }
    })
    it('metin icine gomulu adres (personal_sign hex kodlu UTF-8)', () => {
        const text = 'Send funds to ' + GIZLI + ' please'
        const hex = '0x' + Buffer.from(text, 'utf8').toString('hex')
        expect(containsPrivateAddress(text, GIZLI)).toBe(true)
        expect(containsPrivateAddress(hex, GIZLI)).toBe(true)
        expect(containsPrivateAddress(hex.toUpperCase().replace('0X', '0x'), GIZLI)).toBe(true)
        const harmless = '0x' + Buffer.from('hello world', 'utf8').toString('hex')
        expect(containsPrivateAddress(harmless, GIZLI)).toBe(false)
    })
    it('uint160 ondalik (typed data sayi alani)', () => {
        const dec = BigInt(GIZLI).toString()
        expect(containsPrivateAddress(`{"v":"${dec}"}`, GIZLI)).toBe(true)
    })
})

describe('payloadTouchesPrivate -- ic ice parametreler', () => {
    it('tx nesnesi: to, data, accessList', () => {
        expect(payloadTouchesPrivate([{ to: GIZLI, value: '0x1' }], GIZLI)).toBe(true)
        expect(payloadTouchesPrivate([{ to: A, data: '0xabcd' + pad(bare) }], GIZLI)).toBe(true)
        expect(payloadTouchesPrivate([{ to: A, accessList: [{ address: GIZLI.toUpperCase().replace('0X', '0x'), storageKeys: [] }] }], GIZLI)).toBe(true)
    })
    it('typed data nesne ve JSON metin; permit spender/to/recipient', () => {
        const td = { types: {}, primaryType: 'Permit', domain: { name: 'X' }, message: { owner: A, spender: GIZLI, value: '1' } }
        expect(payloadTouchesPrivate([A, td], GIZLI)).toBe(true)
        expect(payloadTouchesPrivate([A, JSON.stringify(td)], GIZLI)).toBe(true)
        const td2 = { message: { owner: A, spender: A, value: '1' } }
        expect(payloadTouchesPrivate([A, td2], GIZLI)).toBe(false)
        expect(payloadTouchesPrivate([A, JSON.stringify(td2)], GIZLI)).toBe(false)
    })
    it('personal_sign: mesaj ve adres', () => {
        expect(payloadTouchesPrivate(['0x' + Buffer.from('hi ' + GIZLI, 'utf8').toString('hex'), A], GIZLI)).toBe(true)
        expect(payloadTouchesPrivate(['0x68656c6c6f', A], GIZLI)).toBe(false)
    })
    it('wallet_sendCalls bicimi: calls[].to / data', () => {
        expect(payloadTouchesPrivate([{ version: '1.0', calls: [{ to: A }, { to: A, data: '0x11' + pad(bare) }] }], GIZLI)).toBe(true)
        expect(payloadTouchesPrivate([{ version: '1.0', calls: [{ to: A }] }], GIZLI)).toBe(false)
    })
    it('dongusel / cok derin / garip girdi cokmez', () => {
        const a = { x: 1 }
        a.self = a
        expect(() => payloadTouchesPrivate([a], GIZLI)).not.toThrow()
        expect(payloadTouchesPrivate([a], GIZLI)).toBe(false)
        expect(payloadTouchesPrivate(undefined, GIZLI)).toBe(false)
        expect(payloadTouchesPrivate([null, 5, true, 10n], GIZLI)).toBe(false)
        let deep = { to: GIZLI }
        for (let i = 0; i < 30; i++) deep = { n: deep }
        // cok derin ic ice gomme adresi SAKLAYAMAZ (yigin tabanli tarama, derinlik siniri yok)
        expect(payloadTouchesPrivate([deep], GIZLI)).toBe(true)
    })
})
