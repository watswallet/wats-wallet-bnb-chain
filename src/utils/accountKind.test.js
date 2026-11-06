import { describe, it, expect } from 'vitest'
import supported_chains from '../data/supported_chains.json'
import {
    accountKindsOf,
    accountHasTon,
    accountHasEvm,
    accountHasSolana,
    chainsForAccount,
    accountSupportsChain,
    accountShowsEvmRow,
} from './accountKind'

const TON = { chainId: -239, name: 'TON' }
const TON_TESTNET = { chainId: -3, name: 'TON Testnet' }
const ETH = { chainId: 1, name: 'Ethereum' }
const BNB = { chainId: 56, name: 'BNB Smart Chain' }
const SOLANA = { chainId: 'solana-mainnet', name: 'Solana', vm: 'solana' }
const ALL = [ETH, BNB, SOLANA, TON, TON_TESTNET]

const hd = { type: 'hd', index: 0 }
const tonAccount = { type: 'ton' }
const imported = { type: 'imported' }
const privateKey = { type: 'privateKey' }

describe('accountKindsOf — bir hesap artik BIRDEN COK aileye ait', () => {
    it('hd hesap ucunu de destekler', () => {
        expect(accountKindsOf(hd)).toEqual(['evm', 'solana', 'ton'])
    })

    // ESKI/LEGACY kayit. Bu hesabi artik hicbir sey olusturmuyor: Y1 butonu
    // iptal etti, Y2'nin ice aktarilan hesabi buildHybridTonAccount uzerinden
    // type:'hd' doguyor. Kalan kayitlarda `account.address` bir TON adresidir
    // ve kasasi 'tonMnemonic' -- icinde EVM anahtari YOK.
    it('eski ton hesabi YALNIZCA TON destekler', () => {
        expect(accountKindsOf(tonAccount)).toEqual(['ton'])
    })

    // Tek secp256k1 anahtarindan ed25519 TURETILEMEZ.
    it('ozel anahtar hesabi yalnizca EVM', () => {
        expect(accountKindsOf(imported)).toEqual(['evm'])
        expect(accountKindsOf(privateKey)).toEqual(['evm'])
    })

    // FAIL-OPEN: acilista active_account bir an bos olabiliyor; o anda kilidi
    // uygulamak butun aglari kapatirdi.
    it('bilinmeyen hesap null doner', () => {
        expect(accountKindsOf(undefined)).toBeNull()
        expect(accountKindsOf({})).toBeNull()
        expect(accountKindsOf({ type: 'gelecekte-eklenecek' })).toBeNull()
    })
})

describe('accountHasTon / accountHasEvm', () => {
    it('hd hesabin artik TON u VAR', () => {
        expect(accountHasTon(hd)).toBe(true)
    })

    it('eski ton hesabinin EVM i YOK', () => {
        expect(accountHasEvm(tonAccount)).toBe(false)
    })

    it('eski ton hesabinin TON u VAR', () => {
        expect(accountHasTon(tonAccount)).toBe(true)
    })

    it('ozel anahtar hesabinin TON u YOK', () => {
        expect(accountHasTon(privateKey)).toBe(false)
        expect(accountHasEvm(privateKey)).toBe(true)
    })

    it('bilinmeyen hesap ikisinde de false — kume yok demek "var" demek degil', () => {
        expect(accountHasTon(undefined)).toBe(false)
        expect(accountHasEvm(undefined)).toBe(false)
    })
})

describe('accountSupportsChain — Solana ACIKCA kumede', () => {
    it('hd hesap her ucunu de destekler', () => {
        expect(accountSupportsChain(hd, ETH)).toBe(true)
        expect(accountSupportsChain(hd, SOLANA)).toBe(true)
        expect(accountSupportsChain(hd, TON)).toBe(true)
        expect(accountSupportsChain(hd, TON_TESTNET)).toBe(true)
    })

    it('ozel anahtar hesabi Solana ve TON u DESTEKLEMEZ', () => {
        expect(accountSupportsChain(privateKey, ETH)).toBe(true)
        expect(accountSupportsChain(privateKey, SOLANA)).toBe(false)
        expect(accountSupportsChain(privateKey, TON)).toBe(false)
    })

    it('bilinmeyen hesapta fail-open', () => {
        expect(accountSupportsChain(undefined, TON)).toBe(true)
        expect(accountSupportsChain(undefined, SOLANA)).toBe(true)
    })

    // Bilinmeyen ZINCIR de engellenmez: 'sayi degil' zincirin var olmadigini
    // kanitlamaz ve gecerli bir kayitla gelen kullaniciyi kilitlerdi.
    it('bilinmeyen zincirde fail-open', () => {
        expect(accountSupportsChain(hd, null)).toBe(true)
        expect(accountSupportsChain(privateKey, { chainId: 'bilinmeyen-zincir' })).toBe(true)
    })
})

describe('chainsForAccount', () => {
    it('hd hesapta liste DEGISMEZ ve AYNI referans doner', () => {
        expect(chainsForAccount(hd, ALL)).toBe(ALL)
    })

    it('ozel anahtar hesabinda Solana ve TON elenir', () => {
        expect(chainsForAccount(privateKey, ALL)).toEqual([ETH, BNB])
    })

    it('bilinmeyen hesapta liste FILTRESIZ doner', () => {
        expect(chainsForAccount(undefined, ALL)).toBe(ALL)
    })
})

// GORUNUM sorusu IMZALAMA sorusundan AYRI (final inceleme bulgusu, 2026-09-11).
// Receive.vue bu soruyu `accountHasEvm` ile soruyordu; `type` alani olmayan eski
// bir kayitta o fonksiyon fail-closed davranip `false` donuyor, EVM satiri tumden
// kalkiyor ve kullanici kendi alis adresini goremiyordu -- ayni hesap icin
// Header.vue adresi GOSTERIRKEN. Bu blok o celiskiyi kilitler.
describe('accountShowsEvmRow -- GORUNUM sorusu, fail-open', () => {
    it('type alani OLMAYAN eski kayitta satir GORUNUR', () => {
        expect(accountShowsEvmRow({ key: 'k-old', address: '0x1111111111111111111111111111111111111111' })).toBe(true)
    })

    it('bilinmeyen turde satir GORUNUR', () => {
        expect(accountShowsEvmRow({ type: 'gelecekte-eklenen-tur' })).toBe(true)
    })

    it('acilista (hesap null) satir AYAKTA kalir', () => {
        expect(accountShowsEvmRow(null)).toBe(true)
        expect(accountShowsEvmRow(undefined)).toBe(true)
    })

    // Eski/legacy type:'ton' kaydinda `account.address` bir TON adresidir;
    // EVM satirinda gostermek YANLIS ADRES olurdu.
    it('eski legacy type:ton kaydinda satir GIZLENIR', () => {
        expect(accountShowsEvmRow({ type: 'ton', address: 'UQtest' })).toBe(false)
    })

    it('bilinen EVM turlerinde satir GORUNUR', () => {
        expect(accountShowsEvmRow({ type: 'hd' })).toBe(true)
        expect(accountShowsEvmRow({ type: 'imported' })).toBe(true)
        expect(accountShowsEvmRow({ type: 'privateKey' })).toBe(true)
    })
})

describe('gizli hesap (spec 5.3)', () => {
    const gizli = { type: 'hd', private: true, address: '0x' + '1'.repeat(40) }

    it('yalniz evm ailesini tasir -- type hd olsa bile', () => {
        expect(accountKindsOf(gizli)).toEqual(['evm'])
        expect(accountHasEvm(gizli)).toBe(true)
    })

    it('TON ve Solana zincirlerini desteklemez', () => {
        expect(accountSupportsChain(gizli, 56)).toBe(true)
        expect(accountSupportsChain(gizli, -239)).toBe(false)
        expect(accountSupportsChain(gizli, 'solana-mainnet')).toBe(false)
    })

    // `private` satiri accountKindsOf'ta `type`tan ONCE gelmeli: aksi halde TON/Solana
    // turetme genel hesap 0'in kimligini Gizli Hesap icin dondurur ve iki hesap baglanir.
    it('TON ve Solana ailesi YOK, zincir listesi yalniz EVM (gercek supported_chains)', () => {
        expect(accountHasTon(gizli)).toBe(false)
        expect(accountHasSolana(gizli)).toBe(false)
        const zincirler = chainsForAccount(gizli, supported_chains)
        expect(zincirler.length).toBeGreaterThan(0)
        expect(zincirler.some((c) => c.chainId === 56)).toBe(true)
        expect(zincirler.every((c) => accountSupportsChain(gizli, c))).toBe(true)
        expect(zincirler.some((c) => c.chainId === -239 || c.chainId === 'solana-mainnet')).toBe(false)
        expect(zincirler.length).toBeLessThan(supported_chains.length)
    })
})
