// ConnectDapp.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (§8 R4c): bu ekranin BUGUNKU tek korumasi
// `tonBlocked = !hexChainIdFor(currentNetwork)` -- bir AG kontrolu, hesap
// kontrolu DEGIL. Diskte duran bir CONNECT istegi uzerinden
// handleConnectWallet'tan BAGIMSIZ erisilebiliyor (popup/App.vue dogrudan
// yonlendiriyor), yani arka plandaki kapi bu yolu kapsamiyor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// applyNetworkChange GERCEK haliyle pinia deposunu, RPC yoklamasini ve alert()i
// tetikler. Burada sorulan soru "ag degisimi calisiyor mu" DEGIL (o sorunun
// kendi testi var: utils/applyNetworkChange.test.js), "ekran ag degisiminden
// SONRA dogru sey yapiyor mu".
vi.mock('../../utils/applyNetworkChange', () => ({ applyNetworkChange: vi.fn(async () => true) }))

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// ConnectDapp.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagiriyor; o satir import ANINDA
// calisir, installChromeStub ise ancak test govdesinde. vi.hoisted olmadan
// import "chrome is not defined" ile patlar (ayni tuzak:
// utils/dappFunctions.tonGate.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { applyNetworkChange } from '../../utils/applyNetworkChange'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import ConnectDapp from './ConnectDapp.vue'

const EVM_ADRES = '0xAaaa000000000000000000000000000000000001'
const TON_UQ = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'

const EVM_HESAP = { key: 'acc-evm', type: 'hd', name: 'Hesap A', address: EVM_ADRES }
const TON_HESAP = { key: 'acc-ton', type: 'ton', name: 'TON 1', address: TON_UQ, tonAddress: TON_UQ }

const ETH_AGI = { chainId: 1, name: 'Ethereum' }
const TON_AGI = { chainId: -239, kind: 'ton', name: 'TON' }

const ISTEK = { type: 'CONNECT', id: 'req-evm-1', origin: 'https://app.uniswap.org', favicon: 'https://app.uniswap.org/f.ico' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    applyNetworkChange.mockReset()
    applyNetworkChange.mockImplementation(async () => true)
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup({ account = EVM_HESAP, currentNetwork = ETH_AGI, lastEvmChainId = undefined, dapps = {} } = {}) {
    const stub = installChromeStub({
        current_request: ISTEK,
        active_account: account,
        currentNetwork,
        last_evm_chain_id: lastEvmChainId,
        dapps,
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => { gonderilen.push(m); return {} })

    const app = createApp(ConnectDapp)
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'connect_dapp'

    return { app, stub, gonderilen }
}

describe('ConnectDapp.vue (SSR) -- hesap kapisi', () => {
    it('TON hesabi aktifken hesap uyarisi cizilir, hesap karti CIZILMEZ', async () => {
        const { app } = setup({ account: TON_HESAP })
        const holder = captureInstance(app, 'ConnectDapp')
        const html = await render(app)

        expect(holder.instance.setupState.hesapEngelli).toBe(true)
        expect(html).toContain('This account has no EVM address')
        // Ag uyarisi DEGIL: EVM agindayiz, sorun hesapta. Vue SSR metin
        // icindeki kesme isaretini `&#39;` olarak KACIRIR (renderToString,
        // escapeHtml) -- ham kesme isaretli bicim ("aren't") HICBIR ZAMAN
        // HTML'de gorunmez, bu yuzden `not.toContain` HER ZAMAN gecerdi
        // (bkz. :129'daki AYNI kacis notu). Kacistan BAGIMSIZ alt dize.
        expect(html).not.toContain('supported on TON')
        expect(html).not.toContain('Hesap A')
    })

    // ConnectDapp'in kendi `tonBlocked` emsali: soluk/kilitli bir dugme
    // birakilmaz, dugme TUMDEN kaldirilir.
    it('onay dugmesi devre disi DEGIL, HIC YOK', async () => {
        const { app } = setup({ account: TON_HESAP })
        const html = await render(app)
        expect(html).not.toContain('id="evm-connect-approve"')
    })

    it('connect() elle cagrilsa bile dapps kaydi YAZILMAZ, 4100 ile reddedilir', async () => {
        const { app, stub, gonderilen } = setup({ account: TON_HESAP })
        const holder = captureInstance(app, 'ConnectDapp')
        await render(app)

        await holder.instance.setupState.connect()

        expect(stub.localStore.dapps['app.uniswap.org']).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
        const red = gonderilen.find((m) => m.type === 'CONNECT_WALLET_REJECTED')
        expect(red.requestId).toBe('req-evm-1')
        expect(red.error.code).toBe(4100)
    })

    it('EVM hesabinda akis normal: kayit yazilir ve adres dondurulur', async () => {
        const { app, stub, gonderilen } = setup({ account: EVM_HESAP })
        const holder = captureInstance(app, 'ConnectDapp')
        const html = await render(app)

        expect(holder.instance.setupState.hesapEngelli).toBe(false)
        expect(html).toContain('id="evm-connect-approve"')

        await holder.instance.setupState.connect()

        expect(stub.localStore.dapps['app.uniswap.org'].accounts).toEqual([EVM_ADRES])
        const ok = gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')
        expect(ok.data.result).toEqual([EVM_ADRES])
    })

    // FIX 6 (kucuk bulgu, fix dalgasi): connect() TAZE okunan `active_account`
    // uzerinden kapiyi (`accountHasEvm`) kontrol ediyordu ama diske YAZARKEN
    // `profile.value.address` kullaniyordu -- `profile` yalnizca onMounted'da BIR
    // KEZ okunur. Bugun bu ikisi hep AYNI kaynaktan geldigi icin ERISILEMEZ, ama
    // kapinin var olma sebebi TAM OLARAK bu ikisinin SAPMASI durumu: kullanici bu
    // ekran acikken Header'dan BASKA bir hesaba gecerse profile.value BAYAT
    // kalirdi ve dapp kaydi o eski hesabin adresiyle acilirdi.
    it('connect() TAZE okunan active_account.address ile yazar, BAYAT profile.value ile DEGIL', async () => {
        const EVM_HESAP_2 = { key: 'acc-evm-2', type: 'hd', name: 'Hesap B', address: '0xBbbb000000000000000000000000000000000002' }
        const { app, stub } = setup({ account: EVM_HESAP })
        const holder = captureInstance(app, 'ConnectDapp')
        await render(app)

        // profile.value onMounted'da EVM_HESAP ile dolduruldu. Kullanici bu ekran
        // acikken Header'dan EVM_HESAP_2'ye gecti: disk artik o hesabi tasiyor.
        stub.localStore.active_account = EVM_HESAP_2

        await holder.instance.setupState.connect()

        expect(stub.localStore.dapps['app.uniswap.org'].accounts).toEqual([EVM_HESAP_2.address])
    })

    // Mevcut AG kapisi bozulmadan durmali: iki kapi iki AYRI soruya cevap
    // veriyor ve biri otekini kapsamiyor.
    it('TON agi secili iken AG uyarisi korunur (hesap EVM olsa bile)', async () => {
        const { app } = setup({ account: EVM_HESAP, currentNetwork: TON_AGI })
        const holder = captureInstance(app, 'ConnectDapp')
        const html = await render(app)

        expect(holder.instance.setupState.tonBlocked).toBe(true)
        // Vue SSR metin icindeki kesme isaretini `&#39;` olarak KACIRIR
        // (renderToString, escapeHtml): "aren't" yerine bu alt dizeyi ariyoruz.
        expect(html).toContain('supported on TON')
        expect(html).not.toContain('id="evm-connect-approve"')
    })
})


/**
 * EVM DISI AGDAN CIKIS YOLU.
 *
 * KOK NEDEN (kullanici bildirimi: "cuzdan en son gram aginda kalmissa dapp ile
 * evm'lere gecemiyor"): bu ekranin `tonBlocked` karti ULASILAMAZ olu koddu --
 * handleConnectWallet istegi onay penceresi ACILMADAN reddediyordu. Kapi artik
 * pencereyi aciyor, yani kart GERCEKTEN cizilir; ama tek basina bir uyari
 * kullaniciyi hala cikmazda birakir. Uyarinin YANINDA calisan bir cikis olmali.
 */
describe('ConnectDapp.vue (SSR) -- EVM disi agda CIKIS dugmesi', () => {
    it('TON aginda "aga gec ve baglan" dugmesi cizilir ve hedef agi ADIYLA soyler', async () => {
        const { app } = setup({ account: EVM_HESAP, currentNetwork: TON_AGI })
        const html = await render(app)

        expect(html).toContain('id="evm-switch-and-connect"')
        // Hedef ag ADIYLA yazilmali: "bir EVM agina gec" diyen bir dugme,
        // kullaniciya NEREYE gidecegini sormadan goturur.
        expect(html).toContain('Ethereum')
    })

    it('EVM aginda cikis dugmesi YOK (gosterecek bir cikis yok)', async () => {
        const { app } = setup({ account: EVM_HESAP, currentNetwork: ETH_AGI })
        const html = await render(app)

        expect(html).not.toContain('id="evm-switch-and-connect"')
    })

    // HESAP kapisi AG kapisindan ONCE gelir ve ag degistirmek onu COZMEZ:
    // EVM adresi olmayan bir hesap Ethereum'da da baglanamaz. Dugmeyi burada
    // gostermek, kullaniciyi hicbir seyi duzeltmeyen bir ag degisimine
    // goturur ve ardindan AYNI duvara carpar.
    it('hesap engelliyken cikis dugmesi YOK (ag degisimi bu sorunu cozmez)', async () => {
        const { app } = setup({ account: TON_HESAP, currentNetwork: TON_AGI })
        const html = await render(app)

        expect(html).not.toContain('id="evm-switch-and-connect"')
    })

    it('dugme once agi degistirir, SONRA baglanir', async () => {
        const { app, stub, gonderilen } = setup({ account: EVM_HESAP, currentNetwork: TON_AGI })
        const holder = captureInstance(app, 'ConnectDapp')
        await render(app)

        // Gercek ag degisimini taklit et: disk artik EVM tasiyor.
        applyNetworkChange.mockImplementation(async (chain) => {
            stub.localStore.currentNetwork = chain
            return true
        })

        await holder.instance.setupState.agaGecVeBaglan()

        expect(applyNetworkChange).toHaveBeenCalledTimes(1)
        expect(applyNetworkChange.mock.calls[0][0].chainId).toBe(1)
        expect(stub.localStore.dapps['app.uniswap.org'].accounts).toEqual([EVM_ADRES])
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeDefined()
    })

    // SwitchChain.vue'daki AYNI kural: applyNetworkChange'in DONUS DEGERI
    // "ag degisti mi" DEGIL "RPC erisilebilir mi" der. Tek durust kanit
    // diskin kendisidir -- degismediyse baglanma.
    it('ag GERCEKTEN degismediyse baglanma YAPILMAZ (dapps kaydi yazilmaz)', async () => {
        const { app, stub, gonderilen } = setup({ account: EVM_HESAP, currentNetwork: TON_AGI })
        const holder = captureInstance(app, 'ConnectDapp')
        await render(app)

        // Kapiya takilan bir gecis: fonksiyon donuyor ama disk TON'da kaliyor.
        applyNetworkChange.mockImplementation(async () => false)

        await holder.instance.setupState.agaGecVeBaglan()

        expect(stub.localStore.dapps['app.uniswap.org']).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
        // SESSIZ KALINMAZ ama ekran da KAPANMAZ: kullanici uyarida kalir ve
        // tekrar deneyebilir. Dapp'in istegi HALA bekliyor.
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_REJECTED')).toBeUndefined()
    })

    // BSC kullanicisini her seferinde Ethereum'a atmak, dapp'in hemen ardindan
    // `wallet_switchEthereumChain` gondermesine ve kullanicinin ARKA ARKAYA IKI
    // onay ekrani gormesine yol acardi.
    /**
     * AYRIM DURUMU -- "donus degeri okunmaz, DISK okunur" karari (ConnectDapp.vue).
     *
     * `applyNetworkChange`in FALSE'u IKI FARKLI sey demek olabilir:
     *   - hesap/akis kapisi reddetti  -> ag DEGISMEDI, baglanma
     *   - RPC erisilemez             -> ag DEGISTI, baglanma GEREKIR (baglanti
     *                                   zaten RPC'ye ihtiyac duymaz)
     * Donus degerine guvenen bir surum ikincisinde erken cikar ve dugme hicbir sey
     * yapmiyormus gibi gorunur -- turun duzeltmeye calistigi cikmazin ta kendisi.
     *
     * Bu ayrimi olcen bir test olmadan karar KORUMASIZDI: govdeyi
     * `const ok = await applyNetworkChange(...); if (!ok) return` haline getirmek
     * 13/13 YESIL birakiyordu.
     */
    it('applyNetworkChange FALSE donse de ag DEGISTIYSE baglanti KURULUR', async () => {
        const { app, stub, gonderilen } = setup({ account: EVM_HESAP, currentNetwork: TON_AGI })
        const holder = captureInstance(app, 'ConnectDapp')
        await render(app)

        // RPC erisilemez: ag DEGISTI ama fonksiyon false donuyor.
        applyNetworkChange.mockImplementation(async (chain) => {
            stub.localStore.currentNetwork = chain
            return false
        })

        await holder.instance.setupState.agaGecVeBaglan()

        expect(stub.localStore.dapps['app.uniswap.org'].accounts).toEqual([EVM_ADRES])
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeDefined()
    })

    it('hedef ag HATIRLANAN son EVM zinciridir, Ethereum varsayilani DEGIL', async () => {
        const { app } = setup({ account: EVM_HESAP, currentNetwork: TON_AGI, lastEvmChainId: 56 })
        const holder = captureInstance(app, 'ConnectDapp')
        const html = await render(app)

        expect(holder.instance.setupState.donusZinciri.chainId).toBe(56)
        expect(html).toContain('BNB Smart Chain')
    })

    // BU DAPP'IN KENDI ZINCIRI, cuzdanin global son EVM zincirini YENER.
    //
    // Yenmezse ariza sudur: kullanici TON'dayken Polygon dapp'ine baglanir,
    // cuzdan onu BSC'ye goturur, dapp hemen `wallet_switchEthereumChain`
    // gonderir ve kullanici ARKA ARKAYA IKINCI onay ekranini gorur. Cevap zaten
    // diskteydi -- `dapps[hostname].chainId` her baglantida ve her ag
    // degisiminde yaziliyor (ConnectDapp.connect, background.js) -- bu ekran
    // onu OKUMUYORDU. Sira karari utils/evmReturnChain.js'te, orada da test var.
    it('hedef ag BU DAPP in en son bagli oldugu zincirdir (global son EVM i yener)', async () => {
        const { app } = setup({
            account: EVM_HESAP,
            currentNetwork: TON_AGI,
            lastEvmChainId: 56,
            // Diskteki bicim HEX'tir (ConnectDapp.connect `hexChainIdFor` yaziyor).
            dapps: { 'app.uniswap.org': { accounts: [EVM_ADRES], chainId: '0x89' } },
        })
        const holder = captureInstance(app, 'ConnectDapp')
        const html = await render(app)

        expect(holder.instance.setupState.donusZinciri.chainId).toBe(137)
        expect(html).toContain('Polygon')
    })

    it('dapp kaydi YOKSA (ilk baglanti) eski sira aynen isler', async () => {
        const { app } = setup({
            account: EVM_HESAP,
            currentNetwork: TON_AGI,
            lastEvmChainId: 56,
            dapps: { 'baska-site.example': { accounts: [EVM_ADRES], chainId: '0x89' } },
        })
        const holder = captureInstance(app, 'ConnectDapp')
        await render(app)

        expect(holder.instance.setupState.donusZinciri.chainId).toBe(56)
    })

    // Hatirlanan deger DISKTE KALICI ve eski/bozuk olabilir. EVM disi bir kimlik
    // tasiyorsa dugme kullaniciyi cikmak istedigi agin ta kendisine goturur.
    it('hatirlanan kimlik EVM DEGILSE Ethereum a duser', async () => {
        const { app } = setup({ account: EVM_HESAP, currentNetwork: TON_AGI, lastEvmChainId: -239 })
        const holder = captureInstance(app, 'ConnectDapp')
        await render(app)

        expect(holder.instance.setupState.donusZinciri.chainId).toBe(1)
    })
})
