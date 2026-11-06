// Ozel anahtar ice aktarma ekraninin (ImportPrivate.vue) girdiyi siniflandirmasi.
//
// NEDEN: TON anahtar ekrani (TonKey.vue) ed25519 gizli anahtarini 64 BAYT = 128 hex
// olarak verir (`keyPair.secretKey`, tohum + acik anahtar). Ice aktarma ekrani
// yalnizca 64 hex EVM anahtarini taniyordu: kullanici TON anahtarini yapistirinca
// "Hesabi Ekle" hicbir aciklama olmadan pasif kaliyordu (2026-10-14, canli rapor).
// Ham TON anahtari ice aktarilamaz (kasa tipi yok); ekran onu TANIYIP kullaniciyi
// kurtarma ifadesine yonlendirmeli.
import { describe, it, expect } from 'vitest'
import { keyPairFromSeed } from '@ton/crypto'
import { classifyPrivateKeyInput } from './privateKeyInput'

const EVM_KEY = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
// GERCEK bir TON disa aktarimi: tonExport.js'in yaptigi gibi secretKey -> hex.
const TON_SECRET_HEX = Buffer.from(keyPairFromSeed(Buffer.alloc(32, 7)).secretKey).toString('hex')

describe('classifyPrivateKeyInput', () => {
    it('64 hex karakteri EVM anahtari sayar', () => {
        expect(classifyPrivateKeyInput(EVM_KEY)).toBe('evm')
    })

    it('0x onekli ve bosluklu EVM anahtarini da EVM sayar', () => {
        expect(classifyPrivateKeyInput(`  0x${EVM_KEY}\n`)).toBe('evm')
    })

    it('TON anahtar ekraninin verdigi 128 hex anahtari TON sayar', () => {
        expect(TON_SECRET_HEX).toHaveLength(128)
        expect(classifyPrivateKeyInput(TON_SECRET_HEX)).toBe('tonSecretKey')
    })

    it('0x onekli 128 hex anahtari da TON sayar', () => {
        expect(classifyPrivateKeyInput(`0x${TON_SECRET_HEX}`)).toBe('tonSecretKey')
    })

    it('bos, kisa, uzun ya da hex olmayan girdiye null doner', () => {
        expect(classifyPrivateKeyInput('')).toBeNull()
        expect(classifyPrivateKeyInput(undefined)).toBeNull()
        expect(classifyPrivateKeyInput(EVM_KEY.slice(1))).toBeNull()
        expect(classifyPrivateKeyInput(EVM_KEY + 'a')).toBeNull()
        expect(classifyPrivateKeyInput(EVM_KEY.slice(1) + 'z')).toBeNull()
        expect(classifyPrivateKeyInput(TON_SECRET_HEX.slice(2))).toBeNull()
    })
})
