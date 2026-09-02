// Varlik kaydi <-> aktif zincir siniflandirmasi.
//
// Bu karar IKI kapiyi birden besliyor (Takas ve Gonder). Gonder tarafi kesin
// sebepte islemi DURDURUYOR, yani buradaki bir yanlis pozitif CALISAN bir gonderimi
// oldurur; yanlis negatif ise yabanci zincir adresini gecirir. Iki yon de test edilir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { classifyAssetChain, isCertainMismatch } from './assetChain'
import { SOLANA_CHAIN_ID } from './solana/constants'

const here = dirname(fileURLToPath(import.meta.url))

// Canli olculmus kanonik kayit sekli: /getTokenDataById chainId ve decimals
// DONDURMUYOR, `address` alani tokenin ANA zincirindeki adres.
const CANONICAL_USDT = { coingecko_id: 'tether', chain: 'ethereum', address: '0xdac17f958d2ee523a2206206994597c13d831ec7' }
const CANONICAL_ETH = { coingecko_id: 'ethereum', chain: 'ethereum', address: '0x0000000000000000000000000000000000000000' }
const CANONICAL_BNB = { coingecko_id: 'binancecoin', chain: 'binance-smart-chain', address: '0x0000000000000000000000000000000000000000' }

describe('chainId VARSA tek belirleyici odur', () => {
    it('ayni zincir -> temiz', () => {
        expect(classifyAssetChain({ chainId: 137, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }, 137)).toBeNull()
    })

    it('farkli zincir -> KESIN chain-mismatch', () => {
        const r = classifyAssetChain({ chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, 137)
        expect(r).toBe('chain-mismatch')
        expect(isCertainMismatch(r)).toBe(true)
    })

    it("dizgi chainId de sayilir ('137' === 137)", () => {
        expect(classifyAssetChain({ chainId: '137', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }, 137)).toBeNull()
    })

    // chainId varsa slug'a HIC bakilmaz: Home satiri Polygon USDT'yi kanonik
    // 'ethereum' slug'iyla tasiyor ve dogru olan satirdir.
    it('chainId tutuyorsa celisen slug KARARI DEGISTIRMEZ', () => {
        expect(classifyAssetChain({ ...CANONICAL_USDT, chainId: 137, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }, 137)).toBeNull()
    })
})

describe('chainId YOKSA: native maskesi KESIN', () => {
    it('ETH kaydi Base te muaf (ayni native, farkli zincir)', () => {
        expect(classifyAssetChain(CANONICAL_ETH, 8453)).toBeNull()
    })

    it('ETH kaydi Polygon da KESIN yanlis', () => {
        expect(classifyAssetChain(CANONICAL_ETH, 137)).toBe('chain-mismatch')
    })

    it('BNB kaydi BSC te muaf', () => {
        expect(classifyAssetChain(CANONICAL_BNB, 56)).toBeNull()
    })

    it('hicbir zincirin native i olmayan varlik -> foreign-asset', () => {
        const r = classifyAssetChain({ coingecko_id: 'bitcoin', address: '0x0' }, 137)
        expect(r).toBe('foreign-asset')
        expect(isCertainMismatch(r)).toBe(true)
    })

    it('native gorunumlu ama id siz kayit -> muaf (bilinmiyor yalan soylemez)', () => {
        expect(classifyAssetChain({ address: '0x0' }, 137)).toBeNull()
    })
})

describe('chainId YOKSA: ERC-20 slug u SUPHE uretir, KESINLIK degil', () => {
    // Ayni adres birden cok zincirde gecerli olabiliyor (depoda olculdu: 50 tokenin
    // 7'si). Kesin davranmak CALISAN bir gonderimi oldururdu.
    it('baska bir desteklenen zincirin slug u -> chain-suspect, KESIN DEGIL', () => {
        const r = classifyAssetChain(CANONICAL_USDT, 137)
        expect(r).toBe('chain-suspect')
        expect(isCertainMismatch(r)).toBe(false)
    })

    it('slug aktif zinciri gosteriyorsa temiz', () => {
        expect(classifyAssetChain(CANONICAL_USDT, 1)).toBeNull()
    })

    it('slug HIC yoksa muaf', () => {
        expect(classifyAssetChain({ address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, 137)).toBeNull()
    })

    it('taninmayan slug + EVM adres -> BILEREK muaf', () => {
        expect(classifyAssetChain({ chain: 'avalanche', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, 137)).toBeNull()
    })

    // 'sui' taninmayan bir slug (chainIdForSlug null doner) — senaryo (taninmayan
    // slug + EVM olmayan adres) budur.
    it('taninmayan slug + EVM OLMAYAN adres -> foreign-asset', () => {
        expect(classifyAssetChain({ chain: 'sui', address: '0x2::sui::SUI' }, 137)).toBe('foreign-asset')
    })
})

describe('chainId YOKSA: Solana slug u -> KESIN (SUPHE degil)', () => {
    // Review bulgusu: 'solana' artik TANINAN bir slug (chainIdForSlug 'solana-mainnet'
    // doner), yani yukaridaki "taninmayan slug" testinin kapsami disina cikti. Ama bu
    // SUPHE'ye degil KESIN'e dusmeli: bir Solana adresi (base58) EVM aktif zincirde
    // FIZIKSEN gecerli olamaz — iki EVM zincirinin paylastigi "ayni ADRES baska
    // zincirde de gecerli olabilir" belirsizligi burada YOK. Bu satir Send.vue'daki
    // KESIN blok (isCertainMismatch) ile korunuyor; 'chain-suspect' donseydi kirmizi
    // blok amber uyariya duser ve kullanici SPL token kaydiyla EVM zincirinde
    // Gonder'e basabilirdi.
    it('Solana slug lu kayit EVM aktifken KESIN yabanci', () => {
        const r = classifyAssetChain({ chain: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }, 137)
        expect(r).toBe('foreign-asset')
        expect(isCertainMismatch(r)).toBe(true)
    })
})

describe('aktif zincir Solana ise de calisir (Number() artik yok)', () => {
    // Eskiden `active = Number(chainId)` Solana icin NaN uretiyordu ve
    // `!Number.isFinite(active)` erken null donuyordu — Solana aktifken bu kapi
    // EVM tokenleri DAHIL her seyi sessizce muaf sayiyordu. Asagidaki uc test
    // (chainId etiketli / native maske / slug) o bosluk kapandiginda "iki yonlu"
    // calistigini kilitler.
    it('EVM chainId etiketli kayit Solana aktifken KESIN mismatch', () => {
        const r = classifyAssetChain({ chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, SOLANA_CHAIN_ID)
        expect(r).toBe('chain-mismatch')
        expect(isCertainMismatch(r)).toBe(true)
    })

    it('ETH native maskesi Solana aktifken KESIN mismatch (sahibi degil)', () => {
        const r = classifyAssetChain(CANONICAL_ETH, SOLANA_CHAIN_ID)
        expect(r).toBe('chain-mismatch')
        expect(isCertainMismatch(r)).toBe(true)
    })

    it('EVM slug lu kayit Solana aktifken KESIN yabanci (VM farkli)', () => {
        const r = classifyAssetChain(CANONICAL_USDT, SOLANA_CHAIN_ID)
        expect(r).toBe('foreign-asset')
        expect(isCertainMismatch(r)).toBe(true)
    })
})

// TASK 16a: kaydin KENDI chainId'si 'solana-mainnet' oldugunda.
//
// Eskiden `!Number.isFinite(Number(raw))` bu kayitlari "chainId'si yok" yoluna
// sokuyordu: kayit kimligini ACIKCA soyluyorken karar slug/native tahminine
// birakiliyordu. useSolanaAssets satirlarinda `chain` slug'i da YOK, yani her SPL
// kaydi icin "bilmiyorum -> muaf" doner ve Gonder kapisi Solana kayitlarina
// karsi TAMAMEN korumasiz kalirdi.
describe('kaydin KENDI chainId si METIN oldugunda (Solana) BELIRLEYICIDIR', () => {
    const SPL = { chainId: SOLANA_CHAIN_ID, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
    const SOL_NATIVE = { chainId: SOLANA_CHAIN_ID, address: 'native', coingecko_id: 'solana' }

    it('Solana kaydi Solana aktifken GECERLI', () => {
        expect(classifyAssetChain(SPL, SOLANA_CHAIN_ID)).toBeNull()
        expect(classifyAssetChain(SOL_NATIVE, SOLANA_CHAIN_ID)).toBeNull()
    })

    it('Solana kaydi EVM aktifken KESIN mismatch', () => {
        const r = classifyAssetChain(SPL, 137)
        expect(r).toBe('chain-mismatch')
        expect(isCertainMismatch(r)).toBe(true)
    })

    // 'native' isaretcisi isNativeAsset'in tanidigi bir maske DEGIL; eski yolda
    // slug'i da olmadigi icin sessizce muaf (null) donuyordu.
    it('native SOL kaydi EVM aktifken de KESIN mismatch', () => {
        expect(classifyAssetChain(SOL_NATIVE, 1)).toBe('chain-mismatch')
    })

    // EVM REGRESYONU: sayiya cevrilemeyen ve DESTEKLENEN hicbir zincire denk
    // gelmeyen degerler eski (muaf) yolunda BIRAKILDI -- bugun calisan, chainId
    // alani bozuk/eksik EVM akislarini kilitlememek icin (swapTokenState T11/T23).
    it('cozulemeyen METIN chainId eski muafiyet yolunda kalir', () => {
        expect(classifyAssetChain({ chainId: 'abc', address: '0xabc' }, 137)).toBeNull()
        expect(classifyAssetChain({ chainId: NaN, address: '0xabc' }, 137)).toBeNull()
    })
})

describe('karar verilemeyen girdiler HICBIR SEYI ENGELLEMEZ', () => {
    it('token null -> null', () => {
        expect(classifyAssetChain(null, 137)).toBeNull()
        expect(classifyAssetChain(undefined, 137)).toBeNull()
    })

    // Aktif zincir okunamiyorken engellemek, ag deposu gec yuklendiginde Gonder
    // dugmesini sebepsiz kilitlerdi.
    it('aktif zincir okunamiyor -> null', () => {
        expect(classifyAssetChain({ chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, undefined)).toBeNull()
        expect(classifyAssetChain({ chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, null)).toBeNull()
    })

    it('girdi nesnesi ASLA degistirilmez', () => {
        const token = { ...CANONICAL_USDT }
        const snapshot = JSON.stringify(token)
        classifyAssetChain(token, 137)
        expect(JSON.stringify(token)).toBe(snapshot)
    })
})

describe('isCertainMismatch', () => {
    it('yalniz chain-mismatch ve foreign-asset KESINDIR', () => {
        expect(isCertainMismatch('chain-mismatch')).toBe(true)
        expect(isCertainMismatch('foreign-asset')).toBe(true)
        expect(isCertainMismatch('chain-suspect')).toBe(false)
        expect(isCertainMismatch(null)).toBe(false)
    })
})

describe('SAF KATMAN', () => {
    // Siniflandirma buradan Gonder kapisina bagli; ag/depo sizmasi ekrani kilitleyebilir.
    it('assetChain.js ag, depo ve istemci ADI TASIMAZ', () => {
        const src = readFileSync(join(here, 'assetChain.js'), 'utf8')
        for (const forbidden of ['axios', 'config.api', 'chrome.', 'fetch(', 'pinia', '../store']) {
            expect(src, forbidden).not.toContain(forbidden)
        }
    })
})
