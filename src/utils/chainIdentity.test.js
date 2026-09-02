// Zincir KIMLIGI sozlugu — slug ve native coingecko_id ile chainId cozumleme.
//
// NEDEN AYRI TEST DOSYASI: bu sozluge ileride "alias da kabul edelim" diye ekleme
// yapmak isteyen biri KENDI testine carpsin, uzlasma fonksiyonuna degil. Alias
// BILEREK yok: alias kabul etmek yanlis pozitif yuzeyini acar ve calisan bir akisi
// oldurur. Bilinmeyen -> null -> muafiyet, yani her eksiklik GUVENLI yone duser.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chainIdForSlug, isResolvableChainId, nativeOwnerChainIds } from './chainIdentity'
import { SOLANA_CHAIN_ID } from './solana/constants'
import supported_chains from '../data/supported_chains.json'

describe('chainIdForSlug', () => {
    // C1 — chainId kaydin KENDI TIPINDE gelir: EVM icin sayi, Solana icin metin
    // (bkz. vm.js / solana/constants.js). Number() ile zorlanirsa Solana NaN olur.
    it('her desteklenen zincirin slug u KENDI id sine cozulur', () => {
        for (const chain of supported_chains) {
            const expected = typeof chain.chainId === 'string' ? chain.chainId : Number(chain.chainId)
            expect(chainIdForSlug(chain.chainSlug), chain.chainSlug).toBe(expected)
        }
        // 10 EVM zincir + Solana + TON x2 = 13. Sayi IKI daldan da geliyor: Solana
        // dali 11, TON dali 12 bekliyordu -- ikisi de kendi eklemesini sayiyordu.
        // Bu sabit BILEREK burada: yeni bir zincir eklemek isteyen once bu testi
        // gorsun, cunku zincir sayisi degistiginde kimlik sozlugunun (slug, native
        // coingecko id) da guncellendigini kanitlamak gerekiyor.
        expect(supported_chains.length).toBe(13)
    })

    // C2 — alias YOK: "polygon" ile "polygon-pos" ayni sey DEGIL. Alias kabul etseydik
    // bir yazim hatasi kullanicinin tokenini oldururdu; bilinmeyen null doner ve
    // uzlasma fonksiyonu muafiyet yonune duser.
    //
    // 'solana' BILEREK bu listede yok: Solana artik desteklenen bir zincir, yani
    // slug'u taninir (bkz. yukaridaki C1 ve solanaChainRecord.test.js).
    it('alias, kisaltma ve bilinmeyen girdiler null doner', () => {
        const unknown = ['polygon', 'optimism', 'op-mainnet', 'bsc', 'bnb-smart-chain', 'eth',
            'gnosis', 'gnosis-chain', 'arbitrum', 'bitcoin', '', ' ', null, undefined, 137, {}]
        for (const slug of unknown) {
            expect(chainIdForSlug(slug), String(slug)).toBeNull()
        }
    })

    // C3 — kayitlardaki bosluk/buyuk harf sapmasi bir zincir farki DEGILDIR.
    it('bosluk ve buyuk harf normalize edilir', () => {
        expect(chainIdForSlug(' Polygon-POS ')).toBe(137)
        expect(chainIdForSlug('BINANCE-SMART-CHAIN')).toBe(56)
        expect(chainIdForSlug('  Base ')).toBe(8453)
    })
})

describe('nativeOwnerChainIds', () => {
    // C4 — ETH ayni anda 1/10/8453/42161'in native'i. Slug TEK dogru cevabi veremez;
    // bu yuzden kume dondurulur. Kume olmasaydi Base'de ETH kaydi "yabanci" sayilirdi.
    it('bir native varligin SAHIBI oldugu tum zincirleri verir', () => {
        expect(nativeOwnerChainIds('ethereum')).toEqual([1, 10, 8453, 42161])
        expect(nativeOwnerChainIds('polygon-ecosystem-token')).toEqual([137])
        expect(nativeOwnerChainIds('binancecoin')).toEqual([56])
        expect(nativeOwnerChainIds('celo')).toEqual([42220])
        expect(nativeOwnerChainIds(' ETHEREUM ')).toEqual([1, 10, 8453, 42161])
    })

    // C5 — 'solana' BILEREK bu listede yok: Solana zincirinin kendi native'i
    // (nativeCoingeckoId='solana') artik kayitli, bkz. solanaChainRecord.test.js.
    it('hicbir zincirin native i olmayan id bos dizi doner', () => {
        for (const id of ['bitcoin', 'avalanche-2', 'matic-network', '', ' ', null, undefined, 137]) {
            expect(nativeOwnerChainIds(id), String(id)).toEqual([])
        }
    })
})

// Bu olcut IKI cagirani birden besliyor (assetChain.js'in `raw` kolu ve
// Token.vue). Ayrisirlarsa AYNI kayit bir ekranda gecerli, otekinde gecersiz
// sayilir -- kod incelemesi Bulgu 4 tam olarak buydu.
describe('isResolvableChainId', () => {
    it('BOS degerler kimlik SAYILMAZ', () => {
        for (const v of [null, undefined, '']) {
            expect(isResolvableChainId(v), String(v)).toBe(false)
        }
    })

    it('sayiya cevrilebilen her deger kimliktir -- DESTEKLENMEYEN olsa bile', () => {
        expect(isResolvableChainId(1)).toBe(true)
        expect(isResolvableChainId('137')).toBe(true)
        // 999999 desteklenmiyor ama kayit bir kimlik BEYAN ediyor: cagiran onu
        // "eslesmiyor" diye ele alabilmeli (Token.vue akisi DURDURUR).
        expect(isResolvableChainId(999999)).toBe(true)
    })

    it('DESTEKLENEN metin kimlik (Solana) kimliktir', () => {
        expect(isResolvableChainId(SOLANA_CHAIN_ID)).toBe(true)
    })

    // KRITIK DAL: bunu kimlik saymak, bugun CALISAN (chainId alani bozuk/eksik)
    // EVM akislarini kilitlerdi -- bkz. swapTokenState.test.js T11/T23.
    it('cozulemeyen metinler kimlik SAYILMAZ', () => {
        expect(isResolvableChainId('abc')).toBe(false)
        expect(isResolvableChainId('sui')).toBe(false)
        expect(isResolvableChainId(NaN)).toBe(false)
    })

    // Number(true) === 1, Number([]) === 0: bunlar chainId DEGILDIR ama olcut
    // BILEREK gevsek -- gercek cagri noktalarinda boyle degerler yok ve daha
    // sikilastirmak bugunku EVM davranisini degistirirdi. Kayit altina alinir.
    it('mevcut gevseklik KAYIT ALTINDA: boolean/dizi sayiya cevrilebilir sayilir', () => {
        expect(isResolvableChainId(true)).toBe(true)
        expect(isResolvableChainId([])).toBe(true)
    })
})

describe('saflik', () => {
    // C6 — AG YOK. Bu dosya bir karar sozlugu; ag/store gelirse uzlasma fonksiyonu
    // da kirlenir ve saf test edilebilirligi biter.
    it('chainIdentity.js ag ya da store import ETMEZ', () => {
        const here = dirname(fileURLToPath(import.meta.url))
        const src = readFileSync(join(here, 'chainIdentity.js'), 'utf8')
        for (const forbidden of ['axios', 'config.api', 'chrome.', 'fetch(', 'pinia', '../store']) {
            expect(src, forbidden).not.toContain(forbidden)
        }
    })
})
