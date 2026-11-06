import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import supported_chains from '../../data/supported_chains.json'
import { integratorIdFrom, PAYOUT_CHAIN_ID, PRIVATE_ORDER_ATS, PRIVATE_DEST_NATIVE, privateAssetsFor, privateSourceAssetOf, privateSourceChains, privateSourceSupported } from './silentswapConfig'
import { getAssetOnChain } from '@silentswap/sdk'

const BSC = supported_chains.find((c) => c.chainId === 56)

const oku = (ad) => readFileSync(fileURLToPath(new URL(ad, import.meta.url)), 'utf8')

// Bir kapi yardimcisinin imza parametre listesini kaynaktan okur (varsayilan deger parametre metninde KALIR).
function kapiParametreleri(kaynak, ad) {
    const oneki = `export function ${ad}(`
    const bas = kaynak.indexOf(oneki)
    expect(bas, `${ad} imzasi bulunamadi`).toBeGreaterThan(-1)
    const liste = kaynak.slice(bas + oneki.length, kaynak.indexOf(')', bas))
    return liste.split(',').map((p) => p.trim()).filter(Boolean)
}

// PRIVATE_BRIDGED_SOURCES tek dikis ihlalleri: bos dizi = temiz. Suslu parantez icinde yeni satir olabilir ([^}] satir
// sonunu da kapsar) ve noktalar kacirilir.
function tekDikisIhlalleri(configKaynak, silentswapKaynak) {
    const ihlal = []
    if (/export\s*\{[^}]*\bPRIVATE_BRIDGED_SOURCES\b/.test(configKaynak)) ihlal.push('config sabiti yeniden disa aktarir')
    if (!/import\s*\{\s*PRIVATE_BRIDGED_SOURCES\s*\}\s*from\s*'\.\/privateBridgedSources'/.test(configKaynak)) ihlal.push('config sabiti privateBridgedSources.js disindan alir')
    if (!/import\s*\{\s*PRIVATE_BRIDGED_SOURCES\s*\}\s*from\s*'\.\/privateBridgedSources'/.test(silentswapKaynak)) ihlal.push('silentswap.js sabiti privateBridgedSources.js disindan alir')
    if (/import\s*\{[^}]*\bPRIVATE_BRIDGED_SOURCES\b[^}]*\}\s*from\s*'\.\/silentswapConfig'/.test(silentswapKaynak)) ihlal.push('silentswap.js sabiti silentswapConfig uzerinden alir')
    return ihlal
}

// Sabit PRIVATE_BRIDGED_SOURCES kendi modulundedir (privateBridgedSources.js): kapi yardimcilari onu ORADAN okur,
// testler yalniz bu modul mock'u uzerinden acar (yardimcilarin imzasinda test deligi yoktur, T23 M1).
const flags = vi.hoisted(() => ({ bridged: false }))
vi.mock('./privateBridgedSources', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_BRIDGED_SOURCES() { return flags.bridged },
}))
beforeEach(() => { flags.bridged = false })

describe('silentswapConfig', () => {
    it('integratorId yalniz int_ + 24 kucuk alfasayisal', () => {
        expect(integratorIdFrom('int_0123456789abcdef01234567')).toBe('int_0123456789abcdef01234567')
        expect(integratorIdFrom('int_0123456789ABCDEF01234567')).toBeUndefined()
        expect(integratorIdFrom('')).toBeUndefined()
        expect(integratorIdFrom(undefined)).toBeUndefined()
    })

    it('integratorId: yanlis uzunluk, onek eksik ve dizge olmayan degerler reddedilir', () => {
        expect(integratorIdFrom('int_0123456789abcdef0123456')).toBeUndefined() // 23
        expect(integratorIdFrom('int_0123456789abcdef012345678')).toBeUndefined() // 25
        expect(integratorIdFrom('0123456789abcdef01234567')).toBeUndefined()
        expect(integratorIdFrom('xxx_0123456789abcdef01234567')).toBeUndefined()
        expect(integratorIdFrom(' int_0123456789abcdef01234567')).toBeUndefined()
        expect(integratorIdFrom(null)).toBeUndefined()
        expect(integratorIdFrom(12345)).toBeUndefined()
        expect(integratorIdFrom({})).toBeUndefined()
        expect(integratorIdFrom(['int_0123456789abcdef01234567'])).toBeUndefined()
    })

    it('odeme zinciri BSC', () => {
        expect(PAYOUT_CHAIN_ID).toBe(56)
    })

    it('ATS yatirma ACIK (K7, spec 2026-10-28); native hedef S3 ile, koprulu kaynaklar Relay Depository tablosuyla ACIK', async () => {
        // Bu sabitleri acan gorev (S3: native hedef, S2: ATS yatirma, Depository izin listesi: koprulu
        // kaynaklar) bu iddiayi AYNI commit'te degistirir. S3 2026-10-10 GECTI (silentswapConfig.js notu);
        // koprulu kaynaklar 2026-10-26'da Depository tablosu ve calldata pinleriyle acildi (privateBridgedSources.js);
        // ATS yatirma 2026-10-29'da acildi (K7: ag ucreti her iki modda ATS; canli dogrulama L1-L9 bekliyor).
        expect(PRIVATE_ORDER_ATS).toBe(true)
        expect(PRIVATE_DEST_NATIVE).toBe(true)
        // Koprulu sabit dosya duzeyinde mock'lanir (kapi testleri icin); kilit GERCEK degeri okur (T26 I1).
        const real = await vi.importActual('./privateBridgedSources')
        expect(real.PRIVATE_BRIDGED_SOURCES).toBe(true)
    })

    it('koprulu kaynaklar kapaliyken BSC yalniz USDC sunar (USDT ve BNB sunulmaz)', () => {
        expect(privateAssetsFor(BSC)).toEqual(['USDC'])
    })

    it('koprulu kaynaklar kapaliyken Ethereum gibi dogrudan olmayan zincirin varligi yoktur', () => {
        const eth = supported_chains.find((c) => c.chainId === 1)
        expect(privateAssetsFor(eth)).toEqual([])
        expect(privateAssetsFor(null)).toEqual([])
    })

    it('koprulu kaynaklar kapaliyken kaynak zincir listesi yalniz BSC', () => {
        const ids = privateSourceChains(supported_chains).map((c) => c.chainId)
        expect(ids).toEqual([56])
        expect(ids).not.toContain(-239)
        expect(ids).not.toContain('solana-mainnet')
    })
})

describe('privateSourceSupported', () => {
    it('yalniz dogrudan rota (BSC + USDC) kabul edilir (sayi ya da sayisal dizge)', () => {
        expect(privateSourceSupported(56, 'USDC')).toBe(true)
        expect(privateSourceSupported('56', 'USDC')).toBe(true)
    })

    it('koprulu kaynaklar kapaliyken SDK listesindeki diger zincir/varliklar da reddedilir', () => {
        expect(privateSourceSupported('56', 'BNB')).toBe(false)
        expect(privateSourceSupported(56, 'USDT')).toBe(false)
        expect(privateSourceSupported(56, 'DAI')).toBe(false)
        expect(privateSourceSupported(1, 'USDC')).toBe(false)
        expect(privateSourceSupported(1, 'USDT')).toBe(false)
        expect(privateSourceSupported(1, 'ETH')).toBe(false)
    })

    it('kaynak listesinde olmayan zincir reddedilir (TON, Solana, bilinmeyen, bicim disi)', () => {
        for (const id of [-239, 999999, 0, NaN, undefined, null, 'solana-mainnet', 'abc', 1.5]) {
            expect(privateSourceSupported(id, 'USDC'), String(id)).toBe(false)
        }
    })

    it('kurasyonlu olmayan varlik ya da o zincirde dagitilmamis varlik reddedilir', () => {
        expect(privateSourceSupported(56, 'SHIB')).toBe(false)
        expect(privateSourceSupported(1, 'BNB')).toBe(false)
        expect(privateSourceSupported(56, 'usdc')).toBe(false)
        expect(privateSourceSupported(56, '__proto__')).toBe(false)
        expect(privateSourceSupported(56, 'constructor')).toBe(false)
        expect(privateSourceSupported(56, '')).toBe(false)
        expect(privateSourceSupported(56, undefined)).toBe(false)
        expect(privateSourceSupported(56, 42)).toBe(false)
    })
})

describe('privateSourceAssetOf', () => {
    const zincir = (id) => supported_chains.find((c) => c.chainId === id)
    const BSC_USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
    const POLY_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
    const POLY_USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
    const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    const ETH_DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
    const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
    const ZERO = '0x0000000000000000000000000000000000000000'
    const PLACEHOLDER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

    it('BSC USDC: kayit adresi (checksum), kucuk harf ve bosluklu yazim "USDC" doner (koprulu kaynaklar kapali)', () => {
        flags.bridged = false
        expect(privateSourceAssetOf(zincir(56), BSC_USDC)).toBe('USDC')
        expect(privateSourceAssetOf(zincir(56), BSC_USDC.toLowerCase())).toBe('USDC')
        expect(privateSourceAssetOf(zincir(56), ` ${BSC_USDC} `)).toBe('USDC')
    })

    it('BSC: kayitta olmayan adres, yerel coin ve baska agin USDC adresi null', () => {
        flags.bridged = false
        expect(privateSourceAssetOf(zincir(56), '0x' + '12'.repeat(20))).toBeNull()
        expect(privateSourceAssetOf(zincir(56), ZERO)).toBeNull()
        expect(privateSourceAssetOf(zincir(56), BASE_USDC)).toBeNull()
        expect(privateSourceAssetOf(zincir(56), ETH_USDC)).toBeNull()
        flags.bridged = true
        expect(privateSourceAssetOf(zincir(56), ZERO)).toBeNull()
        expect(privateSourceAssetOf(zincir(56), BASE_USDC)).toBeNull()
        expect(privateSourceAssetOf(zincir(56), ETH_USDC)).toBeNull()
    })

    it('koprulu kaynaklar kapaliyken yalniz BSC USDC eslesir', () => {
        flags.bridged = false
        expect(privateSourceAssetOf(zincir(1), ETH_USDC)).toBeNull()
        expect(privateSourceAssetOf(zincir(8453), ZERO)).toBeNull()
        expect(privateSourceAssetOf(zincir(42161), ARB_USDC)).toBeNull()
        expect(privateSourceAssetOf(zincir(56), BSC_USDC)).toBe('USDC')
    })

    it('Polygon: kayit USDC "USDC" doner, USDC.e null, yerel POL null', () => {
        flags.bridged = true
        expect(privateSourceAssetOf(zincir(137), POLY_USDC)).toBe('USDC')
        expect(privateSourceAssetOf(zincir(137), POLY_USDC.toLowerCase())).toBe('USDC')
        expect(privateSourceAssetOf(zincir(137), POLY_USDC_E)).toBeNull()
        expect(privateSourceAssetOf(zincir(137), ZERO)).toBeNull()
    })

    it('baska agin USDC adresi bu agda null', () => {
        flags.bridged = true
        expect(privateSourceAssetOf(zincir(42161), ETH_USDC)).toBeNull()
        expect(privateSourceAssetOf(zincir(8453), ARB_USDC)).toBeNull()
        expect(privateSourceAssetOf(zincir(42161), ARB_USDC)).toBe('USDC')
    })

    it('yerel coin: 0x0, sifir adres ve 0xEeee... yerel coini ETH olan aglarda "ETH", BSC ve Polygon\'da null', () => {
        flags.bridged = true
        const yerel = ['0x0', ZERO, PLACEHOLDER, PLACEHOLDER.toLowerCase(), ` ${ZERO} `]
        for (const id of [42161, 8453]) {
            for (const a of yerel) expect(privateSourceAssetOf(zincir(id), a), `${id} ${a}`).toBe('ETH')
        }
        for (const id of [56, 137]) {
            for (const a of yerel) expect(privateSourceAssetOf(zincir(id), a), `${id} ${a}`).toBeNull()
        }
    })

    it('sifir olmayan adreste ETH adiyla ERC-20 null', () => {
        flags.bridged = true
        expect(privateSourceAssetOf(zincir(8453), '0x' + '21'.repeat(20))).toBeNull()
        expect(privateSourceAssetOf(zincir(8453), BASE_USDC)).toBe('USDC')
    })

    it('adres yok ya da dizge degil: null (bos adres yerel coin sayilmaz)', () => {
        flags.bridged = true
        expect(privateSourceAssetOf(zincir(42161), ZERO)).toBe('ETH')
        for (const v of [null, undefined, '', '   ', 42, 0, true, {}, []]) {
            expect(privateSourceAssetOf(zincir(42161), v), JSON.stringify(v) ?? String(v)).toBeNull()
        }
    })

    it('zincir kaydi yok ya da kaynak degil: null', () => {
        flags.bridged = true
        expect(privateSourceAssetOf(zincir(56), BSC_USDC)).toBe('USDC')
        const yok = [undefined, null, { chainId: 999999, nativeCurrency: { symbol: 'ETH' } }, zincir(-239), zincir('solana-mainnet')]
        for (const c of yok) expect(privateSourceAssetOf(c, BSC_USDC)).toBeNull()
    })

    it('Ethereum: USDT ve DAI adresleri kendi sembolunu, yerel coin ETH doner (privateAssetsFor sirasi)', () => {
        flags.bridged = true
        expect(privateSourceAssetOf(zincir(1), ETH_USDC)).toBe('USDC')
        expect(privateSourceAssetOf(zincir(1), ETH_USDT)).toBe('USDT')
        expect(privateSourceAssetOf(zincir(1), ETH_DAI)).toBe('DAI')
        expect(privateSourceAssetOf(zincir(1), ZERO)).toBe('ETH')
    })

    it('tur donusu: her kaynak zincirin her kaynak varliginin kayit adresi kendi sembolune doner', () => {
        flags.bridged = true
        let sayac = 0
        for (const c of privateSourceChains(supported_chains)) {
            for (const a of privateAssetsFor(c)) {
                const adres = getAssetOnChain(a, c.chainId).address
                expect(privateSourceAssetOf(c, adres), `${c.chainId} ${a}`).toBe(a)
                expect(privateSourceAssetOf(c, adres.toLowerCase()), `${c.chainId} ${a} kucuk`).toBe(a)
                sayac += 1
            }
        }
        expect(sayac).toBe(19)
    })

    it('imza: iki parametre, varsayilan deger yok', () => {
        expect(kapiParametreleri(oku('./silentswapConfig.js'), 'privateSourceAssetOf')).toEqual(['chain', 'address'])
    })

    it('privateSourceSupported ile ayri sorumluluk: sembol ESIT ama adres farkli token kaynak sayilmaz', () => {
        flags.bridged = true
        expect(privateSourceSupported(137, 'USDC')).toBe(true)
        expect(privateSourceAssetOf(zincir(137), POLY_USDC_E)).toBeNull()
    })
})

// Kapali sabitte fazladan (eski bridgedOpen) bir arguman HICBIR sey acmaz: arka plan sinirindaki cagri
// kapiyi arguman vererek yeniden acamaz (T23 M1). Imzalar da tek/iki parametrelidir.
describe('kapali sabitte fazladan arguman kapiyi acmaz (T23 M1)', () => {
    it('privateSourceSupported / privateAssetsFor / privateSourceChains fazladan truthy arguman gormezden gelir', () => {
        expect(privateSourceSupported(1, 'USDT', true)).toBe(false)
        expect(privateSourceSupported(56, 'BNB', true)).toBe(false)
        expect(privateAssetsFor(BSC, true)).toEqual(['USDC'])
        expect(privateSourceChains(supported_chains, true).map((c) => c.chainId)).toEqual([56])
    })

    // Function.length VARSAYILANLI parametreleri saymaz: eski imzalar (..., bridgedOpen = PRIVATE_BRIDGED_SOURCES)
    // ayni length'e sahipti, yani length testi eski kodda da gecerdi (T26 M1). Bu yuzden KAYNAK taranir:
    // her kapi yardimcisinin parametre listesi birebir beklenen ad(lar)dir; varsayilan deger, ek parametre ya da
    // yayilim (...) eklenirse kirilir.
    it('imzalar: bridgedOpen deligi yok (kaynak taramasi; varsayilanli parametre de yakalanir)', () => {
        const kaynak = oku('./silentswapConfig.js')
        expect(kapiParametreleri(kaynak, 'privateSourceSupported')).toEqual(['chainId', 'asset'])
        expect(kapiParametreleri(kaynak, 'privateAssetsFor')).toEqual(['chain'])
        expect(kapiParametreleri(kaynak, 'privateSourceChains')).toEqual(['chains'])
    })

    // Duyarlilik kaniti (T27 M1): GERCEK tarama yardimcisi, eski imzayi geri ekleyen SENTETIK kaynakta calistirilir
    // ve ihlali yakalar; Function.length ayni imzayi kacirirdi.
    it('tarama bir varsayilanli parametreyi GERCEKTEN yakalar (duyarlilik kaniti)', () => {
        const sentetik = [
            'export function privateSourceSupported(chainId, asset) {}',
            'export function privateAssetsFor(chain, bridgedOpen = PRIVATE_BRIDGED_SOURCES) {}',
            'export function privateSourceChains(chains, ...rest) {}',
        ].join('\n')
        expect(kapiParametreleri(sentetik, 'privateSourceSupported')).toEqual(['chainId', 'asset'])
        expect(kapiParametreleri(sentetik, 'privateAssetsFor')).not.toEqual(['chain'])
        expect(kapiParametreleri(sentetik, 'privateAssetsFor')).toEqual(['chain', 'bridgedOpen = PRIVATE_BRIDGED_SOURCES'])
        expect(kapiParametreleri(sentetik, 'privateSourceChains')).not.toEqual(['chains'])
        const eskiFn = new Function('PRIVATE_BRIDGED_SOURCES', 'return function privateAssetsFor(chain, bridgedOpen = PRIVATE_BRIDGED_SOURCES) {}')(false)
        expect(eskiFn.length).toBe(1)
    })

    // TEK DIKIS (T26 M3): sabiti okuyan her yer privateBridgedSources.js'e baglidir; config yeniden disa aktarmaz.
    it('PRIVATE_BRIDGED_SOURCES tek modulden okunur (silentswapConfig yeniden disa aktarmaz, silentswap.js oradan alir)', () => {
        expect(tekDikisIhlalleri(oku('./silentswapConfig.js'), oku('./silentswap.js'))).toEqual([])
    })

    it('tek dikis taramasi tek satirli VE cok satirli yanlis kaynaklari GERCEKTEN yakalar (duyarlilik kaniti)', () => {
        const dogruConfig = "import { PRIVATE_BRIDGED_SOURCES } from './privateBridgedSources'\n"
        const dogruSwap = "import { PRIVATE_BRIDGED_SOURCES } from './privateBridgedSources'\n"
        expect(tekDikisIhlalleri(dogruConfig, dogruSwap)).toEqual([])
        // silentswap.js sabiti silentswapConfig'ten tek satirda alir
        expect(tekDikisIhlalleri(dogruConfig, "import { PRIVATE_BRIDGED_SOURCES } from './silentswapConfig'\n")).not.toEqual([])
        // ... ve ayni import suslu parantez icinde cok satira bolunmus
        const cokSatir = "import {\n    privateAssetsFor,\n    PRIVATE_BRIDGED_SOURCES,\n} from './silentswapConfig'\n"
        expect(tekDikisIhlalleri(dogruConfig, cokSatir)).not.toEqual([])
        // config sabiti yeniden disa aktarirsa (tek ve cok satir)
        expect(tekDikisIhlalleri(dogruConfig + "export { PRIVATE_BRIDGED_SOURCES }\n", dogruSwap)).not.toEqual([])
        expect(tekDikisIhlalleri(dogruConfig + "export {\n    PRIVATE_BRIDGED_SOURCES,\n}\n", dogruSwap)).not.toEqual([])
        // config sabiti kendi modulunden almazsa
        expect(tekDikisIhlalleri("const PRIVATE_BRIDGED_SOURCES = true\n", dogruSwap)).not.toEqual([])
        // alakasiz bir importta ayni ad gecmez: yanlis alarm yok
        expect(tekDikisIhlalleri(dogruConfig, dogruSwap + "import { privateAssetsFor } from './silentswapConfig'\n")).toEqual([])
    })
})

// Sabit ACIKKEN (uretim degeri) yalniz Relay Depository tablosundaki (zincir, varlik) ikilileri sunulur.
// Sabit modul mock'uyla degistirilir (flags.bridged), yardimcilara arguman verilmez.
describe('koprulu kaynaklar ACIK: yalniz Relay Depository tablosu', () => {
    beforeEach(() => { flags.bridged = true })
    afterEach(() => { flags.bridged = false })
    const zincir = (id) => supported_chains.find((c) => c.chainId === id)

    it('BSC yalniz USDC sunar: USDT, DAI ve BNB yonlendirici rotasidir, tabloda yok', () => {
        expect(privateAssetsFor(BSC)).toEqual(['USDC'])
        expect(privateSourceSupported(56, 'USDT')).toBe(false)
        expect(privateSourceSupported('56', 'BNB')).toBe(false)
        expect(privateSourceSupported(56, 'DAI')).toBe(false)
    })

    it('olculen Depository ikilileri sunulur; DAI ve POL yalniz Depository ye gittigi yerde', () => {
        expect(privateAssetsFor(zincir(1))).toEqual(['USDC', 'USDT', 'DAI', 'ETH'])
        expect(privateAssetsFor(zincir(42161))).toEqual(['USDC', 'USDT', 'ETH'])
        expect(privateAssetsFor(zincir(10))).toEqual(['USDC', 'USDT', 'ETH'])
        expect(privateAssetsFor(zincir(8453))).toEqual(['USDC', 'ETH'])
        expect(privateAssetsFor(zincir(137))).toEqual(['USDC', 'USDT'])
        for (const id of [100, 42220, 5000, 25]) expect(privateAssetsFor(zincir(id)), String(id)).toEqual(['USDC'])
        expect(privateSourceSupported(137, 'DAI')).toBe(false)
        expect(privateSourceSupported(137, 'POL')).toBe(false)
        expect(privateSourceSupported(8453, 'DAI')).toBe(false)
        expect(privateSourceSupported(1, 'DAI')).toBe(true)
        expect(privateSourceSupported('5000', 'USDC')).toBe(true)
    })

    it('kaynak zincir listesi: BSC ve Depository tablosundaki zincirler; TON ve Solana yok', () => {
        const ids = privateSourceChains(supported_chains).map((c) => c.chainId).sort((a, b) => a - b)
        expect(ids).toEqual([1, 10, 25, 56, 100, 137, 5000, 8453, 42161, 42220])
        expect(ids).not.toContain(-239)
        expect(ids).not.toContain('solana-mainnet')
    })

    it('acik olsa da SDK listesinde olmayan zincir ve kurasyonsuz varlik reddedilir', () => {
        expect(privateSourceSupported(999999, 'USDC')).toBe(false)
        expect(privateSourceSupported(56, 'SHIB')).toBe(false)
        expect(privateSourceSupported(1, 'BNB')).toBe(false)
        expect(privateSourceSupported(1, 'usdc')).toBe(false)
        expect(privateSourceSupported(56, '__proto__')).toBe(false)
        expect(privateSourceSupported(1, 'constructor')).toBe(false)
    })
})
