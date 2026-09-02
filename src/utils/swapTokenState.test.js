// Swap ekraninin girdi tokeni ile AKTIF ZINCIR arasindaki uzlasma.
//
// Bugunku davranis: token cozulemeyince `crypto.swap.inToken` sessizce `undefined`
// kaliyor, buton bosaliyor ama bakiye satiri yine bir sayi gosteriyor
// (useTokenBalance `undefined` adresi NATIVE sayiyor). Kullanici "token yok ama
// bakiye var" goruyor. Sessiz basarisizlik KABUL EDILMEZ: sebep adlandirilir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { reconcileSwapToken } from './swapTokenState'
import { buildNativeToken } from './nativeToken'
import supported_chains from '../data/supported_chains.json'
import { chainVm } from './vm'
import { SOLANA_CHAIN_ID } from './solana/constants'

describe('reconcileSwapToken', () => {
    // T8
    it('token yoksa aktif zincirin native i ile TOHUMLANIR', () => {
        const { token, reason } = reconcileSwapToken(null, 137)
        expect(reason).toBe('seeded')
        expect(token.symbol).toBe('POL')
        expect(token.address).toBe('0x0')
        expect(token.chainId).toBe(137)
    })

    it('undefined de tohumlanir (findToken bugun tam olarak bunu donuyordu)', () => {
        const { token, reason } = reconcileSwapToken(undefined, 1)
        expect(reason).toBe('seeded')
        expect(token.symbol).toBe('ETH')
    })

    // T9 — baska zincirin tokeni: swap TEK ZINCIRDE calisir.
    it('baska zincirin tokeni chain-mismatch verir', () => {
        const out = reconcileSwapToken({ chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, 137)
        expect(out.reason).toBe('chain-mismatch')
        expect(out.token).toBeNull()
    })

    // T10 — kullanicinin secimi tohum tarafindan ASLA ezilmez.
    it('ayni zincirin tokeni AYNI REFERANSLA korunur', () => {
        const token = { chainId: 137, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' }
        const out = reconcileSwapToken(token, 137)
        expect(out.reason).toBeNull()
        expect(out.token).toBe(token)
    })

    // T11 — C1 KILIDI. Token.vue:234 selectSwap kaydi `/getTokenDataById`'den geliyor
    // ve chainId TASIMIYOR. `Number(undefined) !== 137` her zaman mismatch verirdi:
    // bugun CALISAN "Home -> token -> Takas" yolu kirilirdi.
    // chainId BILINMIYOR demek YANLIS demek DEGILDIR.
    it('chainId tasimayan kayit oldugu gibi kabul edilir', () => {
        const token = { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC' }
        const out = reconcileSwapToken(token, 137)
        expect(out.reason).toBeNull()
        expect(out.token).toBe(token)
    })

    it('bos/cozulemez chainId de mismatch SAYILMAZ', () => {
        for (const raw of [null, undefined, '', 'abc', NaN]) {
            const token = { chainId: raw, address: '0xabc' }
            const out = reconcileSwapToken(token, 137)
            expect(out.reason, `chainId=${String(raw)}`).toBeNull()
            expect(out.token).toBe(token)
        }
    })

    it('metin chainId sayiyla ayni zincir sayilir', () => {
        const token = { chainId: '137', address: '0xabc' }
        expect(reconcileSwapToken(token, 137).reason).toBeNull()
    })

    // T12
    it('desteklenmeyen zincirde unsupported-chain doner (ekran cokmez)', () => {
        const out = reconcileSwapToken({ chainId: 999999 }, 999999)
        expect(out.reason).toBe('unsupported-chain')
        expect(out.token).toBeNull()

        expect(reconcileSwapToken(null, undefined).reason).toBe('unsupported-chain')
    })
})

// ---------------------------------------------------------------------------
// KAYITTA `chainId` YOKKEN ZINCIR KIMLIGI
//
// Bildirilen kor nokta: Home ("Tum Aglar") -> BSC'deki CAKE satiri -> Token.vue
// `/getTokenDataById` HAM Mongo kaydini yaziyor ve o kayitta `chainId` YOK
// (sema tasimiyor). Muafiyet devreye giriyor, BSC tokeni Polygon ekranina
// giriyor: bakiye 0.0000, teklif hata karti, SEBEP EKRANDA YOK.
//
// Kayitta ayirt edecek veri ZATEN VAR: `chain` = CoinGecko asset platform slug'i.
// Muafiyet KALDIRILMIYOR, DARALTILIYOR: yalnizca "sahibi olan BASKA zinciri
// ADIYLA gosterebiliyorum" hallerinde uyusmazlik denir. Geri kalan her sey
// (slug yok / taninmayan slug + EVM adres) AYNEN gecer — yanlis pozitif calisan
// bir akisi oldurur ve en agir olcut odur.
// ---------------------------------------------------------------------------
describe('reconcileSwapToken — chainId YOKKEN slug ile kimlik', () => {
    // T13 — bildirilen vakanin ta kendisi.
    // KESIN DEGIL, SUPHELI — ve suphe tokeni DUSURMEZ. Slug kaydin ANA zincirini
    // soyler; ayni ADRESIN baska bir desteklenen zincirde de gecerli olmasi yaygin
    // (depoda olculdu: 50 tokenin 7'si birden fazla desteklenen zincirde AYNI adresi
    // tasiyor — USDe 1/10/56/5000/42161, WETH 10 ve 8453). Ayirt edecek alan
    // `contractAddresses` CANLI KAYITTA BOS (olculdu: 'ethena-usde' -> 0 anahtar).
    it('yabanci ama DESTEKLENEN slug SUPHEDIR: uyarilir, token DUSURULMEZ', () => {
        const token = {
            coingecko_id: 'pancakeswap-token',
            chain: 'binance-smart-chain',
            address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
        }
        const out = reconcileSwapToken(token, 137)
        expect(out.reason).toBe('chain-suspect')
        expect(out.token).toBe(token)
    })

    // Yanlis yakalamanin BEDELI olculur: ayni adresi paylasan cok zincirli token
    // (USDe 0x5d3a1ff2… 1 ve 56'da AYNI) artik SILINMIYOR — yalnizca uyariliyor.
    it('ayni adresi paylasan cok zincirli token SILINMEZ', () => {
        const token = {
            coingecko_id: 'ethena-usde',
            chain: 'ethereum',
            address: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34',
        }
        const out = reconcileSwapToken(token, 56)
        expect(out.token).toBe(token)
    })

    // T14 — POL/MATIC: kayit Polygon varligini anlatir ama adres ETHEREUM'daki
    // ERC-20'dir. Polygon'da o adres YOK; bugun bakiye 0 gorunuyordu.
    it('native varligin BASKA zincirdeki ERC-20 kaydi uyusmazliktir', () => {
        const out = reconcileSwapToken({
            coingecko_id: 'polygon-ecosystem-token',
            chain: 'ethereum',
            address: '0x455e53cbb86018ac2b8092fdcd39d8444affc3f6',
        }, 137)
        // Slug dali: SUPHE. (Native maskesi dali KESIN kalir — asagidaki testler.)
        expect(out.reason).toBe('chain-suspect')
        expect(out.token).not.toBeNull()
    })

    // T15 — REGRESYON KAPISI: Home varsayilanlari (Tether@1 gibi) ayni zincirdedir
    // ve kullanicinin secimi tohum tarafindan ASLA ezilmez.
    it('ayni zincirin slug u AYNI REFERANSLA gecer', () => {
        const usdc = { chain: 'polygon-pos', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' }
        const a = reconcileSwapToken(usdc, 137)
        expect(a.reason).toBeNull()
        expect(a.token).toBe(usdc)

        const usdt = { chain: 'ethereum', address: '0xdac17f958d2ee523a2206206994597c13d831ec7' }
        const b = reconcileSwapToken(usdt, 1)
        expect(b.reason).toBeNull()
        expect(b.token).toBe(usdt)
    })

    // T16 — BILEREK MUAF. Taninmayan slug + EVM bicimli adres: alias yazimi
    // ('polygon', 'optimism') AKTIF zinciri gosteriyor OLABILIR. Kapatmak tek
    // yanlis pozitif vektorunu acardi; en agir olcut geregi acilmiyor.
    it('taninmayan ya da alias slug + EVM adres muaf kalir', () => {
        for (const chain of ['avalanche', 'zksync', 'polygon', 'optimism', 'bsc', 'arbitrum']) {
            const token = { chain, address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' }
            const out = reconcileSwapToken(token, 137)
            expect(out.reason, chain).toBeNull()
            expect(out.token).toBe(token)
        }
    })

    // T17 — ZORUNLU MUAFIYET: ETH dort zincirin native'i. Base'de ETH kaydini
    // oldurmek bugun CALISAN bir akisi kirardi.
    it('native ETH kaydi sahibi oldugu HER zincirde yasar', () => {
        for (const chainId of [1, 10, 8453, 42161]) {
            const token = { coingecko_id: 'ethereum', chain: 'ethereum', address: '0x0000000000000000000000000000000000000000' }
            const out = reconcileSwapToken(token, chainId)
            expect(out.reason, String(chainId)).toBeNull()
            expect(out.token).toBe(token)
        }
    })

    // T18
    it('ayni native kayit SAHIBI OLMADIGI zincirde uyusmazliktir', () => {
        const out = reconcileSwapToken({
            coingecko_id: 'ethereum', chain: 'ethereum', address: '0x0000000000000000000000000000000000000000',
        }, 137)
        expect(out.reason).toBe('chain-mismatch')
        expect(out.token).toBeNull()
    })

    // T19 — SESSIZ YANLIS VARLIK. `address:'0x0'` -> isNativeAsset true -> bugun
    // ekranda "BTC" etiketiyle AKTIF ZINCIRIN native bakiyesi (BNB) gosteriliyor
    // ve native BNB takasi kuruluyor. ERISILEBILIR: ImportToken ile BSC'de BTCB
    // iceri aktarilir -> findToken('Bitcoin','BTC') -> coingecko_id:'bitcoin'.
    it('hicbir zincirin native i OLMAYAN varlik maskesi oldurulur', () => {
        const out = reconcileSwapToken({
            coingecko_id: 'bitcoin', chain: 'bitcoin', address: '0x0000000000000000000000000000000000000000',
        }, 56)
        expect(out.reason).toBe('foreign-asset')
        expect(out.token).toBeNull()
    })

    // T20 — kimligi HIC yoksa "bilmiyorum" demektir; muafiyet yonune duser.
    it('native adres ama coingecko_id YOKSA muaf kalir', () => {
        const token = { chain: 'bitcoin', address: '0x0' }
        const out = reconcileSwapToken(token, 56)
        expect(out.reason).toBeNull()
        expect(out.token).toBe(token)
    })

    // T21 — adres EVM bicimi bile degil: aktif zincirde kullanilmasi FIZIKSEN
    // imkansiz. Burada "bilmiyorum" demek bir yalan olurdu.
    //
    // 'solana' artik TANINAN bir slug (chainIdForSlug 'solana-mainnet' doner) ama
    // sonuc yine 'foreign-asset' — assetChain.js'teki capraz-VM kontrolu (chainVm
    // farkliysa KESIN) 'chain-suspect'e degil buraya duser. Bu satir BILEREK geri
    // eklendi: 'sui' ile degistirilip silinmisti, oysa tam olarak bu senaryonun
    // (Solana varligi EVM aktif zincirde) canli kanitiydi — assetChain.test.js'teki
    // "Solana slug lu kayit EVM aktifken KESIN yabanci" testiyle AYNI kok neden.
    it('EVM bicimi olmayan adres + taninmayan/Solana slug yabanci varliktir', () => {
        const cases = [
            { chain: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
            { chain: 'sui', address: '0x2::sui::SUI' },
            { chain: 'osmosis', address: 'ibc/C78F65E1' },
            { chain: 'tron', address: 'TUPM7K8REVzD2UdV4R5fe5M8XbnR2DdoJ6' },
        ]
        for (const token of cases) {
            const out = reconcileSwapToken(token, 137)
            expect(out.reason, token.chain).toBe('foreign-asset')
            expect(out.token).toBeNull()
        }
    })

    // T22 — `chainId` VARSA TEK BELIRLEYICIDIR, slug'a BAKILMAZ. Canli vaka:
    // ImportToken.vue ad+sembol ile arayip kayda YANLIS `chain` ('ethereum'),
    // DOGRU `address` (BSC UNI 0xBf5140...) yaziyor. "chainId VEYA chain" kurali
    // o calisan akisi oldururdu.
    it('chainId varsa slug yok sayilir', () => {
        const bscUni = { chainId: 56, chain: 'ethereum', address: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1' }
        const out = reconcileSwapToken(bscUni, 56)
        expect(out.reason).toBeNull()
        expect(out.token).toBe(bscUni)

        expect(reconcileSwapToken({ chainId: 1, chain: 'polygon-pos' }, 137).reason).toBe('chain-mismatch')
    })

    // T23 — MEVCUT TESTLERIN HAYATTA KALMA KOSULU: slug tasimayan kayitlarda
    // bugunku muafiyet BIREBIR korunur.
    it('slug u OLMAYAN kayit aynen gecer', () => {
        const cases = [
            { address: '0xabc' },
            { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC' },
            { chainId: 'abc', address: '0xabc' },
        ]
        for (const token of cases) {
            const out = reconcileSwapToken(token, 137)
            expect(out.reason, JSON.stringify(token)).toBeNull()
            expect(out.token).toBe(token)
        }
    })

    // T24 — kendi tohumumuz kendi kapimizdan gecemezse kural dongu uretir.
    it('buildNativeToken ciktisi HER zincirde temiz gecer', () => {
        // buildNativeToken Solana icin henuz bir seed uretmiyor (bkz.
        // nativeToken.test.js) — Solana bakiyesi Task 9'a kadar ele alinmiyor.
        for (const chain of supported_chains.filter((c) => chainVm(c) === 'evm')) {
            const seed = buildNativeToken(chain.chainId)
            const out = reconcileSwapToken(seed, chain.chainId)
            expect(out.reason, chain.chainSlug).toBeNull()
            expect(out.token).toBe(seed)
        }
    })

    // Review Bulgu 4: EVM filtresinin karsiligi — Solana aktifken buildNativeToken
    // null dondugu icin reconcileSwapToken'in kendi "cozulemedi" dalina (T12 ile
    // AYNI kapi) dustugunu kilitler; kasitli disleme unutmayla karistirilmasin.
    it('Solana aktifken unsupported-chain doner (buildNativeToken henuz seed uretmiyor)', () => {
        expect(reconcileSwapToken(null, SOLANA_CHAIN_ID).reason).toBe('unsupported-chain')
    })

    // T25 — SIRA BAGLAYICI: yeni dal `unsupported-chain`'i EZEMEZ.
    it('desteklenmeyen zincir yeni daldan ONCE karar verir', () => {
        const out = reconcileSwapToken({ chain: 'ethereum', address: '0xabc' }, 999999)
        expect(out.reason).toBe('unsupported-chain')
        expect(out.token).toBeNull()
    })

    // T26 — SAF KATMAN: girdi nesnesi ASLA degistirilmez.
    it('girdi tokeni mutasyona ugramaz', () => {
        const cases = [
            { coingecko_id: 'pancakeswap-token', chain: 'binance-smart-chain', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82' },
            { coingecko_id: 'bitcoin', chain: 'bitcoin', address: '0x0000000000000000000000000000000000000000' },
            { chain: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
        ]
        for (const token of cases) {
            const before = structuredClone(token)
            reconcileSwapToken(token, 137)
            expect(token).toEqual(before)
        }
    })

    // T27 — `ethers` YASAK DEGIL: native placeholder kumesi nativeAsset.js'te
    // BILEREK merkezilestirilmis, elle kopyalamak ayrisma demek. Yasak olan
    // ag ve store.
    it('swapTokenState.js ag ya da store import ETMEZ', () => {
        const here = dirname(fileURLToPath(import.meta.url))
        const src = readFileSync(join(here, 'swapTokenState.js'), 'utf8')
        for (const forbidden of ['axios', 'config.api', 'chrome.', 'fetch(', 'pinia', '../store']) {
            expect(src, forbidden).not.toContain(forbidden)
        }
    })
})
