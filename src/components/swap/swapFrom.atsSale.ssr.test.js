//
// swapFrom "Select Token" listesi, ATS SATIN ALMA modu: hedef ATS + BSC + satis yolu acik (Swap.vue saleRoute).
//
// Bu cifte yalniz USDT, USDC ve BNB odeme tokenidir; baska bir kaynak satis yolunu hic acmaz ve ekran
// "ATS'yi USDT, USDC veya BNB ile alabilirsin" ipucuna duser. Liste eskiden genel haliyle aciliyordu
// (ice aktarilanlar + sunucu listesi + ag kapsami): odeme tokeni olmayan satirlar, baska zincire goturen
// satirlar ve bakiyesi yalniz ice aktarilanlar icin okundugundan sunucudan gelen USDT/USDC elde tutulsa
// da "0.00" gorunuyordu.
//
// Beklenen: tam olarak BNB, USDT, USDC (bu sirayla, hepsi BSC); sunucu listesi ISTENMEZ, ice aktarilanlar
// KARISMAZ, ag kapsami secicisi YOK ve saklanan kapsam yok sayilir, uc satirin bakiyesi okunur. Hedef ATS
// degilse (ATS SATISI dahil), baska zincirdeyse ya da satis yolu kapaliysa liste ESKISI GIBI.
//
// USD karsiligi: her satir genel listedeki "$" satirini (bakiye x fiyat) gosterir. Fiyatlar genel listenin
// kullandigi /getTokensDataById ucundan TEK istekle gelir; satirlari ve bakiyeleri BEKLETMEZ (fiyat yavassa
// ya da hic gelmezse satirlar yalniz "$" satirsiz kalir) ve gec gelen cevap baska bir listeye veri yazmaz.
import { describe, it, expect, vi, afterEach } from 'vitest'

// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Satis bayragi: atsSaleRoute.js bayragi bu modulden okur (bkz. utils/atsSaleRoute.test.js ile ayni desen).
const satis = vi.hoisted(() => ({ acik: true }))
vi.mock('../../utils/atsSaleConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    isAtsSaleLive: () => satis.acik,
}))

const useTokenBalanceMock = vi.fn()
vi.mock('../../composables/useTokenBalance', () => ({
    useTokenBalance: (...a) => useTokenBalanceMock(...a),
}))
const axiosPost = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: vi.fn() } }))
// selectToken bunu yalniz BASKA zincirdeki bir token icin cagirir; BSC satirlarinda cagrilmadigi olculur.
const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../../utils/applyNetworkChange', () => ({
    applyNetworkChange: (...a) => applyNetworkChangeMock(...a),
}))

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { popupStore } from '../../store/popup'
import { tokenScopeStore } from '../../store/tokenScope'
import { balanceKey } from '../../utils/tokenScope'
import { ALL_NETWORKS } from '../../utils/networkFilter'
import { isAtsSaleRoute } from '../../utils/atsSaleRoute'
// GERCEK yapilandirma: yukaridaki mock yalniz isAtsSaleLive'i degistirir, odeme tokenleri aynen gelir.
import { ATS_SALE_PAY_TOKENS } from '../../utils/atsSaleConfig'
import SwapFrom from './swapFrom.vue'
import supported_chains from '../../data/supported_chains.json'
import en from '../../i18n/locales/en.json'
import { BSTOCKS } from '../../data/bStocks'

const BSC = supported_chains.find((c) => c.chainId === 56)
const ETH = supported_chains.find((c) => c.chainId === 1)
const SPCXB = BSTOCKS.find((t) => t.symbol === 'SPCXB')
const ZERO = '0x0000000000000000000000000000000000000000'
const ATS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const USD1 = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const HESAP = '0xAbCdEf0000000000000000000000000000000001'
const img = { thumb: 't', small: 's', large: 'l' }

// Depo: ATS, BNB ve sahip olunan hisse. USDT/USDC BILEREK ice aktarilmamis: sunucu listesinde YALNIZ USDT var,
// USDC ise hicbir listede yok -- ikisinin de satirinin ve bakiyesinin gelmesi satis moduna ait.
const STORED = () => [
    { name: 'Alltoscan', symbol: 'ATS', address: ATS, decimals: 18, coingecko_id: 'alltoscan', image: img },
    { name: 'BNB', symbol: 'BNB', address: ZERO, decimals: 18, coingecko_id: 'binancecoin', image: img },
    { name: SPCXB.name, symbol: 'SPCXB', address: SPCXB.address, decimals: 18, coingecko_id: SPCXB.coingecko_id, image: img },
]
const SERVER = () => [
    { address: '0x0', chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'binancecoin', symbol: 'BNB', name: 'BNB', decimals: 18, image: img, native: true },
    { address: SPCXB.address.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: SPCXB.coingecko_id, symbol: 'SPCXB', name: SPCXB.name, decimals: 18, image: img },
    { address: USD1.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'usd1-wlfi', symbol: 'USD1', name: 'USD1', decimals: 18, image: img },
    { address: USDT.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'tether', symbol: 'USDT', name: 'Tether USD', decimals: 18, image: img },
    { address: ATS.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'alltoscan', symbol: 'ATS', name: 'Alltoscan', decimals: 18, image: img },
]
// Zincirdeki bakiyeler (kucuk harf adres). BNB hem '0x0' hem ZeroAddress ile sorulabilir.
const BAKIYE = { '0x0': 0.008354, [ZERO]: 0.008354, [USDT.toLowerCase()]: 12.5, [USDC.toLowerCase()]: 3.25 }

// openAtsPurchase (useAtsPurchase.js) ATS_SALE_OUT_RECORD ile ayni sekil: "ATS Al" sonrasi hedef boyle.
const OUT_ATS = { name: 'Alltoscan', symbol: 'ats', address: ATS, decimals: 18, chainId: 56 }
// ATS SATISI yonu: hedef USDT (kaynak ATS). Satis modu KAPALI kalmali.
const OUT_USDT = { name: 'Tether USD', symbol: 'usdt', address: USDT, decimals: 18, chainId: 56 }

const BNB_KEY = '56_0x0'
const USDT_KEY = '56_' + USDT.toLowerCase()
const USDC_KEY = '56_' + USDC.toLowerCase()
const SATIS_LISTESI = [BNB_KEY, USDT_KEY, USDC_KEY]

afterEach(() => {
    delete globalThis.chrome
    satis.acik = true
    useTokenBalanceMock.mockReset()
    axiosPost.mockReset()
    applyNetworkChangeMock.mockClear()
})

// `okunamayan`: bakiye okumasi REDDEDILEN token adresleri (RPC yanit vermedi).
// `fiyatCevabi`: /getTokensDataById cevabini degistirir ((govde) => cevap | Promise; varsayilan: her kimlige priceUSD 1).
// `bakiyeBekle`: her bakiye okumasi bu soz cozulunceye kadar bekler (() => Promise): bakiye ile fiyat arasindaki
// SIRAYI mikro gorev sayisina birakmadan testin belirlemesi icin.
//
// `kur` cizimi BASLATMAZ: ara durumu (istekler havadayken) incelemesi gereken testler `render(app)`i kendisi
// cagirir; digerleri `mount` kullanir.
function kur({ outToken, chain = BSC, live = true, scope, okunamayan = [], fiyatCevabi, bakiyeBekle } = {}) {
    satis.acik = live
    installChromeStub({
        currentNetwork: chain,
        active_account: { address: HESAP, key: 'acc1' },
        imported_tokens: { acc1: { 56: STORED() } },
    })
    useTokenBalanceMock.mockImplementation(async (_w, a) => {
        const adres = String(a).toLowerCase()
        if (bakiyeBekle) await bakiyeBekle()
        if (okunamayan.some((x) => x.toLowerCase() === adres)) throw new Error('rpc yanit vermedi')
        return BAKIYE[adres] ?? 0
    })
    axiosPost.mockImplementation(async (url, body) => {
        if (url.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: SERVER() } }
        if (url.endsWith('/getTokensDataById')) {
            if (fiyatCevabi) return fiyatCevabi(body)
            return { status: 200, data: { success: true, tokens: (body.ids || []).map((id) => ({ coingecko_id: id, market_data: { priceUSD: 1 } })) } }
        }
        throw new Error('beklenmeyen url ' + url)
    })

    const app = createApp(SwapFrom)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = chain
    network.rpc = chain.rpc[0].url
    cryptoStore().swap.outToken = outToken
    if (scope !== undefined) tokenScopeStore().setFilter(scope)

    const holder = captureInstance(app, 'swapFrom')
    // Ag kapsami secicisi render edildiyse ornegi yakalanir, edilmediyse null kalir.
    const pill = captureInstance(app, 'NetworkScopePill')
    return { app, holder, pill }
}

async function mount(secenekler) {
    const { app, holder, pill } = kur(secenekler)
    const html = await render(app)
    return { html, pill, state: holder.instance.setupState }
}

const keys = (state) => state.displayedTokens.map((t) => balanceKey(t.chainId, t.address))
const istekler = (son) => axiosPost.mock.calls.filter(([url]) => url.endsWith(son))
// Ag kapsami secicisi render EDILDI mi (captureInstance render edilmeyen bilesen icin null birakir). Bilesen ornegini
// dogrudan `toBeNull` ile karsilastirmak, basarisizlikta butun ornegi ekrana dokerdi.
const pillGorunuyor = (pill) => pill.instance !== null
// Satirin EKRANDA yazan bakiyesi: sembolu tasiyan satirin sag sutunundaki ilk hucre (satir yoksa null).
const bakiyeMetni = (html, sembol) => {
    const satir = html.split('<button').find((parca) => parca.includes('>' + sembol + '</p>'))
    const m = satir && satir.match(/pl-2"><p class="[^"]*">\s*([^<]*?)\s*<\/p>/)
    return m ? m[1] : null
}
// Satirin EKRANDA yazan "$" satiri (USD karsiligi): bakiyenin hemen altindaki ikinci hucre. Satirda yoksa null
// (sablondaki v-if kapaliyken ikinci <p> hic cizilmez, yerine bir yorum dugumu kalir).
const dolarMetni = (html, sembol) => {
    const satir = html.split('<button').find((parca) => parca.includes('>' + sembol + '</p>'))
    const m = satir && satir.match(/pl-2"><p class="[^"]*">[^<]*<\/p><p class="[^"]*">\s*([^<]*?)\s*<\/p>/)
    return m ? m[1] : null
}
// Satirlarin yuklenmis piyasa fiyati (priceUSD), liste sirasiyla; fiyati gelmemis satir icin undefined.
const fiyatlari = (state) => state.displayedTokens.map((t) => t.market?.priceUSD)

const bekle = (ms = 0) => new Promise((r) => setTimeout(r, ms))
// Disaridan cozulen soz: bir istegi testin istedigi ANDA cevaplamak (ya da hic cevaplamamak) icin.
const ertelenmis = () => {
    let cozum
    const promise = new Promise((r) => { cozum = r })
    return { promise, cozum }
}
// Soz `ms` icinde bitti mi? Bitmediyse testin zaman asimina (15 sn) takilmadan aciklayici mesajla dusebilmek icin.
const bittiMi = (promise, ms = 3000) => {
    let zamanlayici
    const sinir = new Promise((r) => { zamanlayici = setTimeout(() => r(false), ms) })
    return Promise.race([promise.then(() => true), sinir]).finally(() => clearTimeout(zamanlayici))
}

// /getTokensDataById cevabi (sunucu belgelerinin `{ coingecko_id, market_data: { priceUSD } }` sekli).
// Tabloda olmayan kimlik cevapta YOKTUR (sunucuda kayitsiz token boyle doner).
const fiyatCevap = (tablo, ids) => ({
    status: 200,
    data: {
        success: true,
        tokens: ids.filter((id) => id in tablo).map((id) => ({ coingecko_id: id, market_data: { priceUSD: tablo[id] } })),
    },
})
const fiyatlar = (tablo) => async (govde) => fiyatCevap(tablo, govde.ids)

// Odeme tokenlerinin test fiyatlari (USD). Bilerek AYRI degerler: bir satira baska tokenin fiyati yazilirsa gorunur.
const ODEME_KIMLIKLERI = ['binancecoin', 'tether', 'usd-coin']
const FIYAT = { binancecoin: 600, tether: 1.001, 'usd-coin': 0.999 }

describe('swapFrom: ATS satin alma modu (hedef ATS, BSC, satis yolu acik)', () => {
    it('liste TAM OLARAK BNB, USDT, USDC -- bu sirayla, hepsi BSC', async () => {
        const { state } = await mount({ outToken: { ...OUT_ATS } })

        expect(keys(state)).toEqual(SATIS_LISTESI)
    })

    it('sunucu token listesi ISTENMEZ', async () => {
        await mount({ outToken: { ...OUT_ATS } })

        expect(istekler('/getChainTokens')).toEqual([])
    })

    it('ag kapsami secicisi ve "baska zincirden token secmek agi tasir" ipucu YOK', async () => {
        const { html, pill } = await mount({ outToken: { ...OUT_ATS } })

        expect(pillGorunuyor(pill), 'NetworkScopePill render edildi').toBe(false)
        expect(html).not.toContain(en.swap.scopeHint)
    })

    // Kapsam oturum ici bir store'dan gelir (Home'da secilmis olabilir); bu modda hicbir etkisi olmamali.
    it.each([
        ['Tum Aglar', ALL_NETWORKS],
        ['baska zincir (Ethereum)', 1],
    ])('saklanan kapsam yok sayilir: %s', async (_ad, scope) => {
        const { state } = await mount({ outToken: { ...OUT_ATS }, scope })

        expect(keys(state)).toEqual(SATIS_LISTESI)
        expect(istekler('/getChainTokens')).toEqual([])
    })

    // Mod bilesen YASARKEN degisebilir (hedef/ag degisir, kapsam izleyicisi loadTokens'i yeniden calistirir):
    // genel listeden kalan ice aktarilanlar (ATS, SPCXB ...) satis listesine SIZMAMALI.
    it('ayni bilesende genel listeden satis moduna gecilince eski ice aktarilan satirlar KALMAZ', async () => {
        const { state } = await mount({ outToken: null })
        // Kontrol: genel liste gercekten ice aktarilanlari tasiyordu (bos gecmis testi anlamsiz kilardi).
        expect(keys(state)).toContain('56_' + ATS.toLowerCase())
        expect(keys(state)).toContain('56_' + SPCXB.address.toLowerCase())

        cryptoStore().swap.outToken = { ...OUT_ATS }
        await state.loadTokens()

        expect(keys(state)).toEqual(SATIS_LISTESI)
    })

    // Uyelik YAPILANDIRMAYA kilitli: ATS_SALE_PAY_TOKENS'a token eklenir/cikarilirsa secici de ayni KUMEyi
    // gostermeli (sira kilitli degil: gosterim sirasi swapFrom.vue'daki SALE_PAY_SYMBOLS). Aksi halde Swap.vue'nun
    // satis yolunu actigi bir kaynak listede bulunmaz ya da listedeki bir satir satis yolunu acmaz.
    it('satir sembolleri ATS_SALE_PAY_TOKENS ile ayni KUME', async () => {
        const { state } = await mount({ outToken: { ...OUT_ATS } })

        const satirlar = state.displayedTokens.map((t) => t.symbol.toUpperCase()).sort()
        expect(satirlar).toEqual(ATS_SALE_PAY_TOKENS.map((p) => p.symbol).sort())
    })

    it('arama yalniz bu uc satir icinde suzer', async () => {
        const { state } = await mount({ outToken: { ...OUT_ATS } })

        state.searchQuery = 'usd'
        expect(keys(state)).toEqual([USDT_KEY, USDC_KEY])
        state.searchQuery = 'bnb'
        expect(keys(state)).toEqual([BNB_KEY])
        // Sunucu listesinde olan ama odeme tokeni olmayan bir token bulunmaz.
        state.searchQuery = 'usd1'
        expect(keys(state)).toEqual([])
    })

    it('uc satirin bakiyesi okunur: elde tutulan USDT/USDC "0.00" gorunmez', async () => {
        const { html } = await mount({ outToken: { ...OUT_ATS } })

        expect(bakiyeMetni(html, 'BNB')).toBe('0.008354')
        expect(bakiyeMetni(html, 'USDT')).toBe('12.500000')
        expect(bakiyeMetni(html, 'USDC')).toBe('3.250000')
        // Okuma hesabin adresiyle, BSC'nin RPC'sinden ve zincir kimligiyle yapilir.
        for (const adres of ['0x0', USDT, USDC]) {
            expect(useTokenBalanceMock).toHaveBeenCalledWith(HESAP, adres, BSC.rpc[0].url, 56)
        }
    })

    // RPC yanit vermezse o satir listeden DUSMEZ, "0.00" gorunur; kardes satirlarin bakiyesi etkilenmez
    // (okunamayan = 0 sayilir, readBalances'in token basina yakalamasi).
    it('okunamayan bakiye satiri DUSURMEZ: satir kalir, 0.00 gorunur, kardesler etkilenmez', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const { html, state } = await mount({ outToken: { ...OUT_ATS }, okunamayan: [USDT] })

            expect(keys(state)).toEqual(SATIS_LISTESI)
            expect(bakiyeMetni(html, 'USDT')).toBe('0.00')
            expect(state.tokenBalances[USDT_KEY]).toBe(0)
            expect(bakiyeMetni(html, 'BNB')).toBe('0.008354')
            expect(bakiyeMetni(html, 'USDC')).toBe('3.250000')
            // Reddetme yolu gercekten calisti.
            expect(hata).toHaveBeenCalled()
        } finally {
            hata.mockRestore()
        }
    })

    // Secici ile Swap.vue AYNI kapiyi paylasir: listedeki her satir kaynak secilince `saleRoute` (isAtsSaleRoute)
    // acilmali; yoksa kullanici listeden bir token secer ve satis yolu yerine ipucu / "rota yok" gorur.
    it('listedeki her satir kaynak secilince satis yolu ACILIR (Swap.vue saleRoute ile ayni kapi)', async () => {
        const { state } = await mount({ outToken: { ...OUT_ATS } })
        const satirlar = [...state.displayedTokens]
        // Kontrol: bos listede dongu hicbir sey olcmezdi.
        expect(satirlar).toHaveLength(3)

        for (const satir of satirlar) {
            await state.selectToken(satir)
            expect(isAtsSaleRoute({
                chainId: networkStore().currentNetwork?.chainId,
                inTokenAddress: cryptoStore().swap.inToken?.address,
                outTokenAddress: cryptoStore().swap.outToken?.address,
            }), satir.symbol).toBe(true)
        }
    })

    // USDC: yalniz bu modda listede olan satir (genel listede hic yoktu).
    it('satir secimi BSC token secmek gibidir: inToken yazilir, secici kapanir, ag degismez', async () => {
        const { state } = await mount({ outToken: { ...OUT_ATS } })
        const popups = popupStore()
        popups.swap_from = true
        const usdc = state.displayedTokens.find((t) => t.symbol.toUpperCase() === 'USDC')
        expect(usdc, 'USDC satiri listede').toBeDefined()

        await state.selectToken(usdc)

        expect(cryptoStore().swap.inToken.address.toLowerCase()).toBe(USDC.toLowerCase())
        expect(cryptoStore().swap.inToken.chainId).toBe(56)
        expect(popups.swap_from).toBe(false)
        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(56)
    })
})

describe('swapFrom: ATS satin alma modu -- odeme satirlarinin USD karsiligi ("$" satiri)', () => {
    it('fiyatlar TEK istekle istenir: uc odeme tokeninin kimlikleri; sunucu token listesi yine ISTENMEZ', async () => {
        await mount({ outToken: { ...OUT_ATS }, fiyatCevabi: fiyatlar(FIYAT) })

        const fiyatIstekleri = istekler('/getTokensDataById')
        expect(fiyatIstekleri).toHaveLength(1)
        expect(fiyatIstekleri[0][1]).toEqual({ ids: ['binancecoin', 'tether', 'usd-coin'] })
        expect(istekler('/getChainTokens')).toEqual([])
    })

    // "$" satiri = genel listedeki ile AYNI: bakiye x fiyat, iki ondalik; bakiyesi sifir olan satirda yok.
    it('her satir "$" satirini gosterir: bakiye x o tokenin fiyati, iki ondalik', async () => {
        // Bakiye okumasi bir macrotask surer; fiyat cevabi yalniz mikro gorevlerle islendigi icin satirlara ONCE girer
        // ve (tek seferlik) SSR ciktisina yansir.
        const { html } = await mount({ outToken: { ...OUT_ATS }, fiyatCevabi: fiyatlar(FIYAT), bakiyeBekle: () => bekle() })

        expect(dolarMetni(html, 'BNB')).toBe('$5.01') // 0.008354 x 600
        expect(dolarMetni(html, 'USDT')).toBe('$12.51') // 12.5 x 1.001
        expect(dolarMetni(html, 'USDC')).toBe('$3.25') // 3.25 x 0.999
    })

    it('bakiyesi sifir olan satir "$" gostermez (fiyat gelmis olsa da)', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {}) // okunamayan bakiye loglanir
        try {
            const { html } = await mount({ outToken: { ...OUT_ATS }, fiyatCevabi: fiyatlar(FIYAT), bakiyeBekle: () => bekle(), okunamayan: [USDT] })

            expect(dolarMetni(html, 'USDT')).toBeNull()
            expect(dolarMetni(html, 'BNB')).toBe('$5.01')
        } finally {
            hata.mockRestore()
        }
    })

    it('cevapta bir tokenin fiyati yoksa yalniz O satir "$" satirsiz kalir', async () => {
        const { html } = await mount({ outToken: { ...OUT_ATS }, fiyatCevabi: fiyatlar({ tether: 1.001 }), bakiyeBekle: () => bekle() })

        expect(dolarMetni(html, 'BNB')).toBeNull()
        expect(dolarMetni(html, 'USDT')).toBe('$12.51')
        expect(dolarMetni(html, 'USDC')).toBeNull()
    })

    // Sunucu/ag hatasi satirlari ve bakiyeleri DUSURMEZ: yalniz "$" satiri olmaz.
    it('fiyat istegi REDDEDILIRSE satirlar ve bakiyeler kalir, "$" satiri yok, hata firlamaz', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const { html, state } = await mount({
                outToken: { ...OUT_ATS },
                fiyatCevabi: async () => { throw new Error('ag yok') },
                bakiyeBekle: () => bekle(),
            })

            // Istek gercekten atildi ve reddedildi (bos gecmis testi anlamsiz kilardi).
            expect(istekler('/getTokensDataById')).toHaveLength(1)
            expect(hata).toHaveBeenCalled()
            expect(keys(state)).toEqual(SATIS_LISTESI)
            expect(bakiyeMetni(html, 'BNB')).toBe('0.008354')
            expect(bakiyeMetni(html, 'USDT')).toBe('12.500000')
            expect(bakiyeMetni(html, 'USDC')).toBe('3.250000')
            for (const sembol of ['BNB', 'USDT', 'USDC']) expect(dolarMetni(html, sembol), sembol).toBeNull()
            expect(state.loading).toBe(false)
        } finally {
            hata.mockRestore()
        }
    })

    it.each([
        ['bos token listesi', { status: 200, data: { success: true, tokens: [] } }],
        ['token listesi yok', { status: 200, data: { success: false } }],
        // Genel listedeki gibi yalniz 200 kabul edilir: govdede fiyat olsa bile 200 disi cevap islenmez.
        ['200 disi durum', { status: 500, data: { success: true, tokens: [{ coingecko_id: 'binancecoin', market_data: { priceUSD: 600 } }] } }],
        ['govde yok', { status: 200, data: null }],
        ['piyasa verisi yok / bos', {
            status: 200,
            data: { success: true, tokens: [{ coingecko_id: 'binancecoin' }, { coingecko_id: 'tether', market_data: null }, { coingecko_id: 'usd-coin', market_data: {} }] },
        }],
    ])('fiyat cevabi bozuk (%s): satirlar ve bakiyeler kalir, "$" satiri yok', async (_ad, cevap) => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {}) // bozuk cevap hata loglatabilir; gurultu olmasin
        try {
            const { html, state } = await mount({ outToken: { ...OUT_ATS }, fiyatCevabi: async () => cevap, bakiyeBekle: () => bekle() })

            expect(istekler('/getTokensDataById')).toHaveLength(1)
            expect(keys(state)).toEqual(SATIS_LISTESI)
            expect(bakiyeMetni(html, 'BNB')).toBe('0.008354')
            for (const sembol of ['BNB', 'USDT', 'USDC']) expect(dolarMetni(html, sembol), sembol).toBeNull()
        } finally {
            hata.mockRestore()
        }
    })

    // SIRA: satirlar ILK, sonra bakiyeler ve fiyatlar birbirinden BAGIMSIZ gelir. Ucu de havadayken liste hazirdir.
    it('satirlar fiyati da bakiyeyi de BEKLEMEZ: ikisi de cevapsizken uc satir ekranda', async () => {
        const fiyat = ertelenmis()
        const bakiye = ertelenmis()
        const { app, holder } = kur({ outToken: { ...OUT_ATS }, fiyatCevabi: () => fiyat.promise, bakiyeBekle: () => bakiye.promise })
        const cizim = render(app)
        try {
            await bekle()
            expect(holder.instance !== null, 'bilesen ornegi yakalandi').toBe(true)
            const state = holder.instance.setupState

            expect(keys(state)).toEqual(SATIS_LISTESI)
            expect(state.tokenBalances).toEqual({})
            expect(fiyatlari(state)).toEqual([undefined, undefined, undefined])
        } finally {
            fiyat.cozum(fiyatCevap({}, ODEME_KIMLIKLERI))
            bakiye.cozum()
        }
        await cizim
    })

    it('yavas fiyat istegi secici yuklemesini ve bakiyeleri BEKLETMEZ; cevap sonradan satirlara islenir', async () => {
        const fiyat = ertelenmis()
        const { app, holder } = kur({ outToken: { ...OUT_ATS }, fiyatCevabi: () => fiyat.promise })
        const cizim = render(app)
        try {
            // Fiyat cevabi HALA yok; bekleseydi cizim hic bitmezdi.
            expect(await bittiMi(cizim), 'secici fiyat cevabini BEKLEDI').toBe(true)
            const html = await cizim
            const state = holder.instance.setupState

            expect(istekler('/getTokensDataById')).toHaveLength(1) // istek atildi ve hala cevapsiz
            expect(keys(state)).toEqual(SATIS_LISTESI)
            expect(state.loading).toBe(false) // donen cark yok: yukleme bakiyeye bagli, fiyata degil
            expect(bakiyeMetni(html, 'BNB')).toBe('0.008354')
            expect(bakiyeMetni(html, 'USDT')).toBe('12.500000')
            expect(bakiyeMetni(html, 'USDC')).toBe('3.250000')
            for (const sembol of ['BNB', 'USDT', 'USDC']) expect(dolarMetni(html, sembol), sembol).toBeNull()

            // Cevap SONRADAN gelince ayni satirlara islenir.
            fiyat.cozum(fiyatCevap(FIYAT, ODEME_KIMLIKLERI))
            await bekle()
            expect(keys(state)).toEqual(SATIS_LISTESI)
            expect(fiyatlari(state)).toEqual([600, 1.001, 0.999])
        } finally {
            fiyat.cozum(fiyatCevap({}, ODEME_KIMLIKLERI)) // ilk cozum kazanir; yalniz asili kalan cizimi serbest birakir
        }
    })

    it('yavas bakiye okumasi fiyatlarin satirlara islenmesini BEKLETMEZ', async () => {
        const bakiye = ertelenmis()
        const { app, holder } = kur({ outToken: { ...OUT_ATS }, fiyatCevabi: fiyatlar(FIYAT), bakiyeBekle: () => bakiye.promise })
        const cizim = render(app)
        try {
            await bekle()
            const state = holder.instance.setupState

            expect(state.tokenBalances).toEqual({}) // bakiyeler HALA gelmedi
            expect(fiyatlari(state)).toEqual([600, 1.001, 0.999])
        } finally {
            bakiye.cozum()
        }
        await cizim
    })

    // GEC CEVAP: cevabi bekleyen tur bitmeden liste yeniden kurulursa (kapsam izleyicisi / hedef degisimi loadTokens'i
    // ayni bilesende yeniden calistirir) o eski cevap artik baska bir listeye aittir ve ona veri YAZMAMALI.
    it('ayni bilesende satis listesi yeniden kurulunca ESKI turun gec fiyat cevabi yeni satirlari EZMEZ', async () => {
        const eski = ertelenmis()
        let istek = 0
        const { state } = await mount({
            outToken: { ...OUT_ATS },
            // 1. istek (ilk tur) cevapsiz bekler; sonraki turlar fiyatlarini hemen alir.
            fiyatCevabi: (govde) => (++istek === 1 ? eski.promise : fiyatCevap(FIYAT, govde.ids)),
        })

        await state.loadTokens() // 2. tur: liste yeniden kurulur, fiyatlar hemen gelir
        await bekle()
        expect(fiyatlari(state)).toEqual([600, 1.001, 0.999])

        eski.cozum(fiyatCevap({ binancecoin: 1, tether: 1, 'usd-coin': 1 }, ODEME_KIMLIKLERI)) // ilk turun gec cevabi
        await bekle()

        expect(fiyatlari(state)).toEqual([600, 1.001, 0.999])
    })

    it('satis modundan genel listeye gecildikten sonra gelen gec fiyat cevabi genel listeye veri YAZMAZ', async () => {
        const eski = ertelenmis()
        let istek = 0
        const { state } = await mount({
            outToken: { ...OUT_ATS },
            // 1. istek satis listesininki (cevapsiz); genel listenin kendi istegi yalniz BNB icin fiyat dondurur.
            fiyatCevabi: (govde) => (++istek === 1 ? eski.promise : fiyatCevap({ binancecoin: 1 }, govde.ids)),
        })

        cryptoStore().swap.outToken = null // hedef degisti: liste genel birlesim olarak yeniden kurulur
        await state.loadTokens()
        const satir = (sembol) => state.displayedTokens.find((t) => t.symbol.toUpperCase() === sembol)
        // Kontrol: USDT genel listede, yalniz sunucudan gelen (ice aktarilmamis) satir olarak var.
        expect(satir('USDT'), 'USDT genel listede').toBeDefined()

        eski.cozum(fiyatCevap(FIYAT, ODEME_KIMLIKLERI)) // satis listesinin gec cevabi
        await bekle()

        // Genel listede yalniz ICE AKTARILAN satirlar piyasa verisi tasir: sunucu-yalniz USDT'ye satis fiyati yazilmamali.
        expect(satir('USDT').market).toBeUndefined()
        // Ice aktarilan BNB kendi (genel) istegiyle gelen fiyati korur; satis cevabindaki 600'u degil.
        expect(satir('BNB').market.priceUSD).toBe(1)
    })
})

describe('swapFrom: satis modu DISINDA liste ESKISI GIBI', () => {
    // Eski liste: ice aktarilanlar (ATS, BNB, SPCXB) + yalniz sunucuda olanlar (USD1); hedef (USDT) disarida.
    it('hedef ATS degil (ATS SATISI: hedef USDT): ice aktarilanlar + sunucu listesi, kapsam secicisi var', async () => {
        const { html, pill, state } = await mount({ outToken: { ...OUT_USDT } })

        expect(keys(state)).toEqual([
            '56_' + ATS.toLowerCase(),
            BNB_KEY,
            '56_' + SPCXB.address.toLowerCase(),
            '56_' + USD1.toLowerCase(),
        ])
        expect(istekler('/getChainTokens')).toHaveLength(1)
        expect(pillGorunuyor(pill), 'NetworkScopePill render EDILMEDI').toBe(true)
        expect(html).toContain(en.swap.scopeHint)
    })

    // Eski liste: ATS (hedef) disarida; BNB ve SPCXB TEK; sunucuda yalniz olanlar (USD1, USDT) sonda.
    it('satis yolu KAPALI (bayrak): hedef ATS olsa da liste eskisi gibi', async () => {
        const { html, pill, state } = await mount({ outToken: { ...OUT_ATS }, live: false })

        expect(keys(state)).toEqual([BNB_KEY, '56_' + SPCXB.address.toLowerCase(), '56_' + USD1.toLowerCase(), USDT_KEY])
        expect(istekler('/getChainTokens')).toHaveLength(1)
        expect(pillGorunuyor(pill), 'NetworkScopePill render EDILMEDI').toBe(true)
        expect(html).toContain(en.swap.scopeHint)
    })

    // Hedef adresi ATS ama ag BSC degil: satis yolu yok (Swap.vue saleRoute ile ayni zincir kaynagi).
    it('ag BSC degil: hedef adresi ATS olsa da liste eskisi gibi', async () => {
        const { pill } = await mount({ outToken: { ...OUT_ATS, chainId: 1 }, chain: ETH })

        expect(istekler('/getChainTokens')).toHaveLength(1)
        expect(pillGorunuyor(pill), 'NetworkScopePill render EDILMEDI').toBe(true)
    })

    // Genel listenin fiyat yolu: istek ICE AKTARILANLARIN kimlikleriyle bir kez, "$" satiri yalniz onlarda. Satis listesi
    // bu istegi paylasir (bkz. swapFrom.vue requestTokensData); bu test paylasimin genel listeyi degistirmedigini kilitler.
    it('genel liste: fiyat istegi ice aktarilanlarin kimlikleri, ice aktarilan BNB satiri "$" gosterir', async () => {
        const { html } = await mount({
            outToken: null,
            fiyatCevabi: fiyatlar({ ...FIYAT, alltoscan: 0.05, [SPCXB.coingecko_id]: 100 }),
        })

        const fiyatIstekleri = istekler('/getTokensDataById')
        expect(fiyatIstekleri).toHaveLength(1)
        expect(fiyatIstekleri[0][1]).toEqual({ ids: ['alltoscan', 'binancecoin', SPCXB.coingecko_id] })
        expect(istekler('/getChainTokens')).toHaveLength(1)
        expect(dolarMetni(html, 'BNB')).toBe('$5.01') // 0.008354 x 600
    })
})
