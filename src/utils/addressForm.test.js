import { describe, it, expect } from 'vitest'
import { canonicalAddress, dedupeKey, isSameAddress } from './addressForm'

const EVM_MIXED = '0xAbCd000000000000000000000000000000000001'
const EVM_LOWER = EVM_MIXED.toLowerCase()
const SOL_A = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
// SOL_A ile YALNIZCA bas 4 karakterin harf kasasi farkli — gerisi birebir ayni.
const SOL_A_CASE_VARIANT = '9wzdXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

describe('canonicalAddress', () => {
    it('EVM adresini kucultur, form=evm doner', () => {
        expect(canonicalAddress(EVM_MIXED)).toEqual({ form: 'evm', key: EVM_LOWER, headOffset: 2 })
    })

    it('base58 adresini HARF KASASINI KORUYARAK doner, form=solana', () => {
        expect(canonicalAddress(SOL_A)).toEqual({ form: 'solana', key: SOL_A, headOffset: 0 })
    })

    it('gecersiz/bos girdide null doner', () => {
        expect(canonicalAddress(null)).toBe(null)
        expect(canonicalAddress(undefined)).toBe(null)
        expect(canonicalAddress('')).toBe(null)
        expect(canonicalAddress(123)).toBe(null)
        expect(canonicalAddress('0x123')).toBe(null)
    })

    it('bastaki/sondaki bosluk kabul edilir', () => {
        expect(canonicalAddress('  ' + EVM_MIXED + ' ')?.key).toBe(EVM_LOWER)
        expect(canonicalAddress('  ' + SOL_A + ' ')?.key).toBe(SOL_A)
    })

    // Base58 alfabesi yalnizca '0','O','I','l'i disliyor; hex'in alfabesi
    // (0-9a-f) bunlardan yalnizca '0'i kullanir. '0x' oneki DUSMUS 40 karakterlik
    // bir hex dize (icinde hic '0' yoksa) base58 ile de eslesir — Solana
    // sanilmamali, aksi halde EVM'deyken "bu agda itibar kontrolu yok" gibi
    // yanlis bir mesaj gorunur.
    it('0x oneki dusmus, sifirsiz 40 karakterlik hex dize NE EVM NE SOLANA sayilir', () => {
        const strippedEvm = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' // 40 char, '0' yok, [a-f] icinde
        expect(strippedEvm).toHaveLength(40)
        expect(canonicalAddress(strippedEvm)).toBe(null)
    })

    it('0x oneki OLUNCA ayni govde yine EVM olarak taninir', () => {
        expect(canonicalAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')?.form).toBe('evm')
    })

    it('gercek bir Solana adresi (hex-disi karakter tasir) bu korumadan ETKILENMEZ', () => {
        // SOL_A 40 karakter degil (44) VE hex-disi karakterler (W,z,X,g,Z,T,b,...)
        // tasiyor; guard yalnizca "40 karakter + TAMAMEN hex alfabesi" kesisimini hedefler.
        expect(canonicalAddress(SOL_A)?.form).toBe('solana')
    })
})

describe('dedupeKey', () => {
    it('form+key birlikte doner', () => {
        expect(dedupeKey(EVM_MIXED)).toBe(`evm:${EVM_LOWER}`)
        expect(dedupeKey(SOL_A)).toBe(`solana:${SOL_A}`)
    })

    it('gecersiz girdide null doner', () => {
        expect(dedupeKey('not-an-address')).toBe(null)
    })

    // BASE58 BUYUK/KUCUK HARF DUYARLIDIR: bu paylasilan uygulama kucultseydi, bu
    // gorevin (Task 13) kapattigi tuzak, onu kullanan HER dosyada yeniden acilirdi.
    it('yalnizca harf kasasi farkli iki base58 adresi FARKLI anahtar uretir', () => {
        expect(dedupeKey(SOL_A)).not.toBe(dedupeKey(SOL_A_CASE_VARIANT))
    })
})

describe('isSameAddress', () => {
    it('EVM: harf kasasi onemsiz', () => {
        expect(isSameAddress(EVM_MIXED, EVM_LOWER)).toBe(true)
    })

    it('base58: harf kasasi onemli, farkli kasa FARKLI adres sayilir', () => {
        expect(isSameAddress(SOL_A, SOL_A)).toBe(true)
        expect(isSameAddress(SOL_A, SOL_A_CASE_VARIANT)).toBe(false)
    })

    it('farkli bicimdeki adresler asla ayni sayilmaz', () => {
        expect(isSameAddress(EVM_MIXED, SOL_A)).toBe(false)
    })

    it('gecersiz girdide false doner', () => {
        expect(isSameAddress(null, EVM_MIXED)).toBe(false)
        expect(isSameAddress(EVM_MIXED, undefined)).toBe(false)
        expect(isSameAddress('0x123', '0x456')).toBe(false)
    })
})
