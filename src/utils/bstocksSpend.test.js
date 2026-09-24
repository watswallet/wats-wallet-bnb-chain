import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ethers } from 'ethers'
import { applyUiMultiplier, rawFromUiAmount, UI_MULTIPLIER_ONE } from './bstocks'
import { BSTOCK_MULTIPLIER_ERROR, readUiMultiplier, toRawSpendAmount } from './bstocksSpend'
import { buildTransaction } from './buildTransaction'
import { clampToDecimals } from './swapValidation'
import { percentAmount } from './sendPercent'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')
const SWAP_VUE = read('components/Swap.vue')
const SEND_VUE = read('components/Send.vue')

// GOOGLB'nin 2026-09-18'deki gercek zincir degeri.
const MUL = 1000478058978107511n

const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const FROM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

const abiCoder = ethers.AbiCoder.defaultAbiCoder()

// decimals() -> 18, uiMultiplier() -> `mul` donduren minimal sahte provider.
// Selector'a gore dallanir; baska bir cagri gelirse test patlar ki sessizce
// yanlis veri donmesin.
const SEL_DECIMALS = ethers.id('decimals()').slice(0, 10)
const SEL_UI_MULTIPLIER = ethers.id('uiMultiplier()').slice(0, 10)

const sahteProvider = (mul, { uiMultiplierReverts = false } = {}) => ({
    resolveName: async (n) => n,
    call: async (tx) => {
        const sel = (tx.data || '').slice(0, 10)
        if (sel === SEL_DECIMALS) return abiCoder.encode(['uint8'], [18])
        if (sel === SEL_UI_MULTIPLIER) {
            if (uiMultiplierReverts) throw new Error('execution reverted')
            return abiCoder.encode(['uint256'], [mul])
        }
        throw new Error(`beklenmeyen cagri: ${sel}`)
    },
})

describe('BIRIM SINIRI - MAX dugmesi ham bakiyeyi asmaz', () => {
  it('duz parseUnits ham bakiyeyi ASAR (duzeltilmeden onceki hata)', () => {
    // Bu test kusuru BELGELIYOR: UI bakiyesi hama cevrilmeden gonderilirse
    // zincirdeki bakiyeden BUYUK bir miktar istenir ve islem duser.
    const hamBakiye = 10n ** 18n
    const uiBakiye = applyUiMultiplier(hamBakiye, MUL)
    const duzParse = ethers.parseUnits(ethers.formatUnits(uiBakiye, 18), 18)

    expect(duzParse > hamBakiye).toBe(true)
  })

  it('rawFromUiAmount ile MAX tam olarak ham bakiyeye esitlenir', () => {
    const hamBakiye = 10n ** 18n
    const uiBakiye = applyUiMultiplier(hamBakiye, MUL)
    const gonderilecek = rawFromUiAmount(uiBakiye, MUL)

    expect(gonderilecek <= hamBakiye).toBe(true)
    expect(gonderilecek).toBe(hamBakiye)
  })

  it('carpan 1e18 iken hicbir sey degismez (bStock olmayan tokenler)', () => {
    const ham = 123456789n
    expect(rawFromUiAmount(applyUiMultiplier(ham, UI_MULTIPLIER_ONE), UI_MULTIPLIER_ONE)).toBe(ham)
  })

  it('bolunme olceginde MAX hala guvenli (4:1)', () => {
    const hamBakiye = 10n ** 18n
    const mul = 4n * UI_MULTIPLIER_ONE
    const gonderilecek = rawFromUiAmount(applyUiMultiplier(hamBakiye, mul), mul)
    expect(gonderilecek <= hamBakiye).toBe(true)
  })
})

describe('readUiMultiplier - carpan ISLEM ANINDA zincirden okunur', () => {
    it('bStock icin zincirdeki degeri dondurur', async () => {
        const mul = await readUiMultiplier(sahteProvider(MUL), BSTOCKS_CHAIN_ID, GOOGLB.address)
        expect(mul).toBe(MUL)
    })

    it('bStock OLMAYAN token icin zincire HIC SORULMAZ, 1e18 doner', async () => {
        // `call` beklenmeyen selector'da firlatiyor; patlamamasi cagrinin hic
        // yapilmadiginin kaniti.
        const patlayan = { resolveName: async (n) => n, call: async () => { throw new Error('cagrilmamaliydi') } }
        expect(await readUiMultiplier(patlayan, BSTOCKS_CHAIN_ID, USDT)).toBe(UI_MULTIPLIER_ONE)
    })

    it('BASKA ZINCIRDE ayni adres icin de 1e18 doner', async () => {
        const patlayan = { resolveName: async (n) => n, call: async () => { throw new Error('cagrilmamaliydi') } }
        expect(await readUiMultiplier(patlayan, 1, GOOGLB.address)).toBe(UI_MULTIPLIER_ONE)
    })

    // DUSUM YONU TERSINE CEVRILDI (inceleme bulgusu I-2). Sessizce 1e18'e dusmek,
    // gosterim ZATEN carpanliyken MAX'i ham bakiyenin uzerine cikarir (revert, bosa
    // yanan gaz) ya da MAX altinda SESSIZCE FAZLA gonderir. Artik DURUYOR.
    it('uiMultiplier() revert ederse FIRLATIR (sessizce 1e18 DEGIL)', async () => {
        await expect(readUiMultiplier(sahteProvider(MUL, { uiMultiplierReverts: true }), BSTOCKS_CHAIN_ID, GOOGLB.address))
            .rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })

    // Gecici bir RPC hatasi da ayni yoldan gecer - asil tehlikeli vaka bu, cunku
    // kontrat saglamken de olabilir.
    it('gecici RPC hatasinda da FIRLATIR', async () => {
        const kopuk = { resolveName: async (n) => n, call: async () => { throw new Error('ETIMEDOUT') } }
        await expect(readUiMultiplier(kopuk, BSTOCKS_CHAIN_ID, GOOGLB.address))
            .rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })

    // Sifir ya da anlamsiz bir carpan bolmede patlardi / miktari ucurur. Okuma
    // "basarili" gorunse bile carpan yine BILINMIYOR demektir.
    it('zincir 0 dondurse FIRLATIR', async () => {
        await expect(readUiMultiplier(sahteProvider(0n), BSTOCKS_CHAIN_ID, GOOGLB.address))
            .rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })

    // bStock OLMAYAN tokende davranis DEGISMEDI: zincire sorulmuyor, firlatmiyor.
    it('bStock olmayan tokende carpan okumasi patlasa bile FIRLATMAZ', async () => {
        const kopuk = { resolveName: async (n) => n, call: async () => { throw new Error('ETIMEDOUT') } }
        expect(await readUiMultiplier(kopuk, BSTOCKS_CHAIN_ID, USDT)).toBe(UI_MULTIPLIER_ONE)
    })
})

describe('toRawSpendAmount - ekrandaki UI miktari zincire HAM gider', () => {
    it('bStock miktari carpana gore kucultulur', async () => {
        const uiMiktar = applyUiMultiplier(10n ** 18n, MUL)
        const ham = await toRawSpendAmount({
            provider: sahteProvider(MUL), chainId: BSTOCKS_CHAIN_ID, tokenAddress: GOOGLB.address, parsedAmount: uiMiktar,
        })
        expect(ham).toBe(10n ** 18n)
    })

    it('bStock olmayan token miktari AYNEN gecer', async () => {
        const patlayan = { resolveName: async (n) => n, call: async () => { throw new Error('cagrilmamaliydi') } }
        const ham = await toRawSpendAmount({
            provider: patlayan, chainId: BSTOCKS_CHAIN_ID, tokenAddress: USDT, parsedAmount: 12345n,
        })
        expect(ham).toBe(12345n)
    })
})

describe('buildTransaction - bStock transferi HAM birime cevrilir', () => {
    const cozTransferMiktari = (data) => {
        const iface = new ethers.Interface(['function transfer(address to, uint256 amount)'])
        return iface.parseTransaction({ data }).args[1]
    }

    it('MAX: ekrandaki UI bakiyesi gonderilse bile ham bakiye ASILMAZ', async () => {
        // MAX dugmesinin yazdigi sey EKRANDAKI bakiyedir (useTokenBalance artik
        // balanceOfUI okuyor). Zincirdeki ham bakiye budur:
        const hamBakiye = 1234567890123456789n
        const uiBakiye = applyUiMultiplier(hamBakiye, MUL)
        const ekrandakiMetin = ethers.formatUnits(uiBakiye, 18)

        const tx = await buildTransaction({
            provider: sahteProvider(MUL),
            from: FROM, to: TO, amount: ekrandakiMetin,
            asset: GOOGLB.address, chainId: BSTOCKS_CHAIN_ID,
        })

        const gonderilen = cozTransferMiktari(tx.data)
        expect(gonderilen <= hamBakiye).toBe(true)
        // Duzeltmeden once gonderilen miktar UI bakiyesiydi, yani ham bakiyeden
        // BUYUKTU ve islem duserdi.
        expect(uiBakiye > hamBakiye).toBe(true)
    })

    it('bStock OLMAYAN token icin miktar DEGISMEZ', async () => {
        const tx = await buildTransaction({
            provider: sahteProvider(MUL),
            from: FROM, to: TO, amount: '12.5', asset: USDT, chainId: BSTOCKS_CHAIN_ID,
        })
        expect(cozTransferMiktari(tx.data)).toBe(ethers.parseUnits('12.5', 18))
    })

    it('chainId verilmezse provider.getNetwork()ten cozulur', async () => {
        const provider = { ...sahteProvider(MUL), getNetwork: async () => ({ chainId: BigInt(BSTOCKS_CHAIN_ID) }) }
        const tx = await buildTransaction({ provider, from: FROM, to: TO, amount: '1', asset: GOOGLB.address })

        expect(cozTransferMiktari(tx.data)).toBe(rawFromUiAmount(ethers.parseUnits('1', 18), MUL))
    })

    // Eski cagiranlar ne chainId geciyor ne de getNetwork tasiyan bir provider
    // veriyor; o yolda ESKI davranis birebir korunmali.
    it('chainId de getNetwork de yoksa miktar DEGISMEZ (geriye donuk guvenli)', async () => {
        const tx = await buildTransaction({
            provider: sahteProvider(MUL), from: FROM, to: TO, amount: '1', asset: GOOGLB.address,
        })
        expect(cozTransferMiktari(tx.data)).toBe(ethers.parseUnits('1', 18))
    })

    // I-2: carpan okunamiyorsa HICBIR SEY URETILMEZ. Eskiden miktar cevrilmeden
    // gecerdi; gosterim zaten carpanli oldugu icin bu, ham bakiyeyi asan (ya da
    // kullanicinin yazdigindan fazla olan) bir islem demekti.
    it('uiMultiplier() revert ederse ISLEM URETILMEZ (firlatir)', async () => {
        await expect(buildTransaction({
            provider: sahteProvider(MUL, { uiMultiplierReverts: true }),
            from: FROM, to: TO, amount: '1', asset: GOOGLB.address, chainId: BSTOCKS_CHAIN_ID,
        })).rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })
})

// -----------------------------------------------------------------------------
// MAX DUGMESI: Swap.vue ve Send.vue'da DEGISIKLIK GEREKMEDIGININ KANITI
// -----------------------------------------------------------------------------
// Iddia: MAX ekrandaki (UI birimi) bakiyeyi yazmaya devam eder ve guvenlidir,
// cunku cevrim HARCAMA noktasinda yapiliyor. Bu blok iddiayi VARSAYMIYOR, gercek
// boru hattini bastan sona calistirip olcuyor:
//
//   useTokenBalance -> Number(formatUnits(balanceOfUI, 18))   (gorunen bakiye)
//   -> percentAmount({ percent: 1 })                          (MAX dugmesi)
//   -> clampToDecimals + parseUnits                           (harcama noktasi)
//   -> toRawSpendAmount                                        (BU COMMIT)
describe('MAX guvenligi - Swap.vue/Send.vue dokunulmadan', () => {
    const ONE = 10n ** 18n
    const maxYaz = (hamBakiye, mul) => {
        const uiBakiye = applyUiMultiplier(hamBakiye, mul)
        const gorunen = Number(ethers.formatUnits(uiBakiye, 18))       // useTokenBalance
        return { uiBakiye, metin: percentAmount({ balance: gorunen, reserve: 0, percent: 1, decimals: 18 }) }
    }
    const harca = async (metin, mul) => toRawSpendAmount({
        provider: sahteProvider(mul), chainId: BSTOCKS_CHAIN_ID, tokenAddress: GOOGLB.address,
        parsedAmount: ethers.parseUnits(clampToDecimals(metin, 18), 18),
    })

    it('SAF BIGINT: MAX ham bakiyeyi ASLA asmaz (kayan nokta yok)', async () => {
        for (const hamBakiye of [ONE, 1234567890123456789n, 7n, 999999999999999999999n]) {
            const istenen = await harca(ethers.formatUnits(applyUiMultiplier(hamBakiye, MUL), 18), MUL)
            expect(istenen <= hamBakiye).toBe(true)
        }
    })

    it('DUZELTILMEDEN ONCE: ayni MAX ham bakiyeyi ASARDI (islem duserdi)', () => {
        const hamBakiye = 1234567890123456789n
        const { metin } = maxYaz(hamBakiye, MUL)
        const cevrimsiz = ethers.parseUnits(clampToDecimals(metin, 18), 18)

        expect(cevrimsiz > hamBakiye).toBe(true)
        // Sapma yuzde olcegindedir - kayan nokta gurultusu DEGIL.
        expect(Number(cevrimsiz - hamBakiye) / Number(hamBakiye)).toBeGreaterThan(0.0004)
    })

    // Gercek boru hattinda `Number(formatUnits(...))` bir kayan nokta adimi
    // iceriyor ve yukari yuvarlayabiliyor. Bu adim BU COMMIT'TEN ONCE DE vardi ve
    // HER ERC-20'yi ayni sekilde etkiliyor (carpansiz token icin de olculdu,
    // asagidaki test). Buyuklugu ~1e8 wei, yani carpan sapmasindan (~1e15 wei)
    // yedi kat kucuk. Yani cevrim MAX'i BOZMUYOR, aksine olumcul hatayi
    // bugunku gurultu seviyesine indiriyor.
    const GURULTU_TAVANI = 10n ** 10n

    it('GERCEK BORU HATTI: MAX, ham bakiyeyi olcekli bir miktarda ASMAZ', async () => {
        for (const hamBakiye of [1234567890123456789n, 85892020440296506208488n, 352676498265204270061248n]) {
            const { metin } = maxYaz(hamBakiye, MUL)
            const istenen = await harca(metin, MUL)
            const fark = istenen > hamBakiye ? istenen - hamBakiye : 0n
            expect(fark).toBeLessThan(GURULTU_TAVANI)
        }
    })

    // 500 vakalik DETERMINISTIK tarama (sabit tohumlu LCG): tek tek secilmis
    // sayilar sansa dayanir, burada dagilim taraniyor.
    const tohumluHamlar = (adet) => {
        let seed = 42n
        const mask = (1n << 64n) - 1n
        const out = []
        while (out.length < adet) {
            seed = (seed * 6364136223846793005n + 1442695040888963407n) & mask
            const ham = seed % (10n ** 24n)
            if (ham > 0n) out.push(ham)
        }
        return out
    }

    it('TARAMA: 500 bakiyede de MAX olcekli bir miktarda ASMAZ', async () => {
        let enBuyukFark = 0n
        for (const hamBakiye of tohumluHamlar(500)) {
            const { metin } = maxYaz(hamBakiye, MUL)
            const istenen = await harca(metin, MUL)
            const fark = istenen > hamBakiye ? istenen - hamBakiye : 0n
            if (fark > enBuyukFark) enBuyukFark = fark
        }
        expect(enBuyukFark).toBeLessThan(GURULTU_TAVANI)
    })

    it('AYNI gurultu carpansiz duz ERC-20 de de var (bu commit uretmedi)', () => {
        // Karsilastirma noktasi: bStock olmayan bir token icin de
        // Number(formatUnits(raw)) -> parseUnits yolu ayni buyuklukte sapiyor.
        // Yani asagidaki "asan vaka sayisi > 0" beklentisi BU COMMIT'TEN BAGIMSIZ
        // bir gercegi kilitliyor: kayan nokta adimi ZATEN vardi.
        let asan = 0
        let enBuyuk = 0n
        for (const ham of tohumluHamlar(500)) {
            const gorunen = Number(ethers.formatUnits(ham, 18))
            const geri = ethers.parseUnits(clampToDecimals(percentAmount({ balance: gorunen, reserve: 0, percent: 1, decimals: 18 }), 18), 18)
            if (geri > ham) {
                asan++
                const fark = geri - ham
                if (fark > enBuyuk) enBuyuk = fark
            }
        }
        expect(asan).toBeGreaterThan(0)
        expect(enBuyuk).toBeLessThan(GURULTU_TAVANI)
    })

    it('BOLUNME olceginde (4:1) de MAX guvenli kalir', async () => {
        const hamBakiye = 1234567890123456789n
        const mul = 4n * UI_MULTIPLIER_ONE
        const { metin } = maxYaz(hamBakiye, mul)
        const istenen = await harca(metin, mul)
        const fark = istenen > hamBakiye ? istenen - hamBakiye : 0n
        expect(fark).toBeLessThan(GURULTU_TAVANI)
    })

    it('Swap.vue ve Send.vue MAX dallari cevrim YAPMAZ (degisiklik gerekmedi)', () => {
        // Cevrim harcama noktasinda oldugu icin ekranlar EKRANDAKI sayiyi yazmaya
        // devam eder: kullanici gordugu sayiyi gorur. Bu iki ekran ham/UI cevrimini
        // KENDISI yaparsa cevrim IKI KEZ uygulanir.
        //
        // KILIT DARALTILDI, TEHLIKE AYNI YERDE DURUYOR. Once "bstocks yolundan
        // HICBIR import" deniyordu; yasagin GEREKCESI ise MIKTAR cevrimidir.
        // isBStock bir KIMLIK yuklemi: bool doner, hicbir miktara dokunmaz ve
        // Swap ekranindaki "Hisse" rozeti icin gerekli (SwapBStock.ssr.test.js).
        // Bu yuzden artik import ADLARI sayiliyor: cevrim yardimcilarinin adlari
        // asagida ZATEN yasakli, isim listesi de readUiMultiplier, UI_MULTIPLIER_ONE
        // ve "import * as" gibi diger yollari kapatiyor.
        for (const [ad, src] of [['Swap.vue', SWAP_VUE], ['Send.vue', SEND_VUE]]) {
            expect(src).not.toMatch(/rawFromUiAmount|toRawSpendAmount|applyUiMultiplier/)

            const bstockImportlari = [...src.matchAll(/import\s+([^;\r\n]*?)\s+from\s+['"][^'"]*bstocks[^'"]*['"]/gi)]
                .map((m) => m[1].trim())
            // Send.vue bStocks'tan HALA TAMAMEN habersiz; Swap.vue YALNIZCA rozet
            // yuklemini taniyor.
            expect(bstockImportlari).toEqual(ad === 'Swap.vue' ? ['{ isBStock }'] : [])
        }
        // MAX hala harcanabilirin TA KENDISINI yaziyor (percentAmount, percent 1).
        expect(SWAP_VUE).toMatch(/percentAmount\(\{[\s\S]{0,200}?balance:\s*inBalance\.value/)
        expect(SEND_VUE).toMatch(/percentAmount\(\{[\s\S]{0,200}?balance:\s*balance\.value/)
    })
})

// -----------------------------------------------------------------------------
// TAKAS YOLU: buildSwapCalls router'a HAM miktar yaziyor mu?
// -----------------------------------------------------------------------------
// Mock'u degil KODU dogrulamak icin gercek MultiChainSwapManager kuruluyor;
// aga dokunan dort metot (swap.buildSwapCalls.test.js ile ayni desen) ve
// provider stub'lanir.
describe('buildSwapCalls - bStock girdisi HAM birime cevrilir', () => {
    const CIKIS = '0x2222222222222222222222222222222222222222'
    const ROUTER = '0x9999999999999999999999999999999999999999'
    const ALICI = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const V2_ROUTER_ABI = [
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
    ]

    const kurManager = async (girdi, mul) => {
        const { MultiChainSwapManager } = await import('./swap')
        const manager = new MultiChainSwapManager('0x' + '1'.repeat(64), BSTOCKS_CHAIN_ID)
        manager.isNativeToken = async () => false
        manager.getTokenDecimals = async () => 18
        manager.getWallet = () => ({ address: ALICI })
        manager.getProvider = () => sahteProvider(mul)
        manager.findBestDexRoute = async () => ({
            dex: { NAME: 'TestDexV2', VERSION: 2, ROUTER_ADDRESS: ROUTER, FEE: 25 },
            outputAmount: 10n ** 18n, fee: null, path: [girdi, CIKIS],
        })
        return manager
    }

    const amountInOf = (calls) => {
        const swapCall = calls[calls.length - 1]
        return new ethers.Interface(V2_ROUTER_ABI).parseTransaction({ data: swapCall.data }).args[0]
    }

    it('MAX: router a giden amountIn ham bakiyeyi ASMAZ', async () => {
        const hamBakiye = 1234567890123456789n
        const ekrandakiMetin = ethers.formatUnits(applyUiMultiplier(hamBakiye, MUL), 18)

        const manager = await kurManager(GOOGLB.address, MUL)
        const { calls } = await manager.buildSwapCalls(GOOGLB.address, CIKIS, ekrandakiMetin, '1')

        expect(amountInOf(calls) <= hamBakiye).toBe(true)
    })

    it('bStock OLMAYAN girdide amountIn DEGISMEZ', async () => {
        const DUZ = '0x1111111111111111111111111111111111111111'
        const manager = await kurManager(DUZ, MUL)
        const { calls } = await manager.buildSwapCalls(DUZ, CIKIS, '12.5', '1')

        expect(amountInOf(calls)).toBe(ethers.parseUnits('12.5', 18))
    })
})

// I-2'nin ASIL KANITI: carpan okunamadiginda HER harcama yolu duruyor mu?
// "Bir yerde sessizce gecmis" olmamali - dort giris noktasinin dordu de denendi.
describe('carpan okunamadiginda HICBIR harcama yolu ilerlemez', () => {
    const KOPUK = { resolveName: async (n) => n, call: async () => { throw new Error('ETIMEDOUT') } }
    const CIKIS = '0x2222222222222222222222222222222222222222'

    const kurManager = async () => {
        const { MultiChainSwapManager } = await import('./swap')
        const manager = new MultiChainSwapManager('0x' + '1'.repeat(64), BSTOCKS_CHAIN_ID)
        manager.isNativeToken = async () => false
        manager.getTokenDecimals = async () => 18
        manager.getWallet = () => ({ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
        manager.getProvider = () => KOPUK
        manager.findBestDexRoute = async () => { throw new Error('rotaya ULASILMAMALIYDI') }
        return manager
    }

    // decimals() CALISIYOR, yalniz uiMultiplier() patliyor: asil sinsi vaka bu.
    // Tumden kopuk bir RPC'de zaten decimals() firlatir ve gonderim eskiden de dururdu.
    it('buildTransaction (gonderim) durur', async () => {
        await expect(buildTransaction({
            provider: sahteProvider(MUL, { uiMultiplierReverts: true }),
            from: FROM, to: TO, amount: '1',
            asset: GOOGLB.address, chainId: BSTOCKS_CHAIN_ID,
        })).rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })

    it('buildSwapCalls (gasless takas) durur ve ROTA bile aranmaz', async () => {
        const manager = await kurManager()
        await expect(manager.buildSwapCalls(GOOGLB.address, CIKIS, '1', '1'))
            .rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })

    it('getExpectedOutput (teklif) durur', async () => {
        const manager = await kurManager()
        await expect(manager.getExpectedOutput(GOOGLB.address, CIKIS, '1', '1'))
            .rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })

    it('executeSwap (duz takas) durur: HICBIR SEY IMZALANMAZ', async () => {
        const manager = await kurManager()
        manager.getTokenSymbol = async () => 'GOOGLB'
        manager.getTokenBalance = async () => { throw new Error('bakiyeye ULASILMAMALIYDI') }
        await expect(manager.executeSwap(GOOGLB.address, CIKIS, '1', '1'))
            .rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
    })
})
