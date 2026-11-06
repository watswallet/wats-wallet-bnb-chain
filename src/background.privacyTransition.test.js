import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// Gizli mod GECISLERI (giris / cikis) ve onay sonucu kanali -- GERCEK dagitici uzerinden.
//   A-C1  bekleyen onay pencereleri gecisle iptal edilir; onay sonucu kanali kapidan gecer
//   A-I3  gizli modda sitelerin gordugu zincir DONDURULUR, cikista tek uzlastirma yollanir
//   A-M1  duyuru KIMLIKLE karar verir (bayragi dusmus Gizli Hesap da duyurulmaz)
//   A-M9  bayrak kapali acilista depoda kalan Gizli Hesap'a otomatik cikis

// Giris, gercek setPrivacyMode yerine bu sahte ile yapilir (kasa acma / HD turetme bu
// testin konusu degil); cikis GERCEK setPrivacyMode'dur. `girisSahte` null ise gercek calisir.
let girisSahte = null
vi.mock('./utils/privacy/privacyMode', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        setPrivacyMode: (enabled, deps) => (enabled && girisSahte ? girisSahte(enabled, deps) : actual.setPrivacyMode(enabled, deps)),
    }
})

// rejectPendingForOrigin cagrilari (gecis iptali ile ikinci, izin-kaybi iptali cakismasin: "cift iptal" kilidi).
// Hesap degisimi uygulayicisinin bagimliliklari sarilir; gercek islev AYNEN calisir, yalniz cagrilar kaydedilir.
// (dappFunctions modulunun kendisi SARILMAZ: bellek ici pendingRequests Map'i modul durumudur.)
const { rejectCalls } = vi.hoisted(() => ({ rejectCalls: [] }))
vi.mock('./utils/dappAccountApply', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        applyAccountSwitchToDapps: (switchArgs, deps) => actual.applyAccountSwitchToDapps(switchArgs, {
            ...deps,
            rejectPendingForOrigin: (...args) => {
                rejectCalls.push(args)
                return deps.rejectPendingForOrigin(...args)
            },
        }),
    }
})

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const B = { key: 'b-1', address: '0x' + 'ef'.repeat(20), type: 'hd' }
const SITE_TAB = { id: 3, url: 'https://site.example/app' }
const DAPP_SENDER = { url: 'https://site.example/app', origin: 'https://site.example', tab: { id: 3, url: 'https://site.example/app' } }
const YABANCI_SENDER = { url: 'https://yabanci.example/', origin: 'https://yabanci.example', tab: { id: 5, url: 'https://yabanci.example/' } }
const ETH = { chainId: 1, name: 'Ethereum' }
const BSC = { chainId: 56, name: 'BNB Smart Chain' }
const BASE = { chainId: 8453, name: 'Base' }
const POLYGON = { chainId: 137, name: 'Polygon' }
const TON = { chainId: -239, kind: 'ton', name: 'TON' }
// Yalniz-EVM genel hesap (tek ozel anahtar): TON agini desteklemez, geri yukleme ona yazamaz.
const IMPORTED = { key: 'i-1', address: '0x' + 'dd'.repeat(20), type: 'imported' }
const FROZEN = 'privacy_frozen_network'

let bg, localStore, sessionStore
const callHandler = (...args) => bg.call(...args)

async function boot({ flag = 'true', active = A, extra = {}, tabs, emit = false } = {}) {
    localStore = {
        active_account: active,
        vaults: [{ type: 'hd', accounts: [A, B], privateAccount: GIZLI }],
        currentNetwork: ETH,
        privacy_mode: { lastPublicAccountKey: 'a-1', introSeen: true },
        dapps: { 'site.example': { accounts: [A.address], chainId: '0x1' } },
        solana_dapps: {},
        ...extra,
    }
    sessionStore = {}
    bg = await bootBackground({ privacyFlag: flag, localStore, sessionStore, ...(tabs ? { tabs } : {}), emitStorageChanges: emit })
    await sakinles()
    chrome.tabs.sendMessage.mockClear()
}

const sakinles = () => new Promise((resolve) => setTimeout(resolve, 20))

// Gizli moda giris: aktif hesap Gizli Hesap olur (isteyen agi de cevirebilir), duyuru yapilir.
function girisSahtesiKur({ network } = {}) {
    girisSahte = async (_enabled, deps) => {
        await chrome.storage.local.set({ active_account: GIZLI, ...(network ? { currentNetwork: network } : {}) })
        await deps.announce(GIZLI)
        return { enabled: true, account: GIZLI }
    }
}

const olaylar = (method) => chrome.tabs.sendMessage.mock.calls.map((c) => c[1]).filter((m) => m.method === method)

beforeEach(() => {
    girisSahte = null
    rejectCalls.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    await sakinles()
    teardownBackground()
    vi.restoreAllMocks()
})

describe('A-C1: gecis bekleyen onay pencerelerini iptal eder', () => {
    it('Genel modda acik CONNECT popup\'i + gizli moda giris: sayfa 4001 "User closed the window." alir, dapps degismez', async () => {
        await boot()
        const dappsOnce = structuredClone(localStore.dapps)
        const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe('CONNECT')

        girisSahtesiKur()
        const giris = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(giris.success).toBe(true)

        expect(await bekleyen).toEqual({ error: { code: 4001, message: 'User closed the window.' } })
        expect(localStore.dapps).toEqual(dappsOnce)
        expect(localStore.current_request).toBeUndefined()
        expect(chrome.windows.remove).toHaveBeenCalledWith(1)
    })

    it('eski popup\'in "Baglan" dugmesi gecisten sonra SONUC UYGULAMAZ: istek zaten iptal edildi', async () => {
        await boot()
        const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        const istekId = localStore.current_request.id

        girisSahtesiKur()
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect((await bekleyen).error.message).toBe('User closed the window.')

        // Popup hala acik kalmis gibi: Baglan'a basar (ConnectDapp.connect() eski surumu).
        await callHandler({ type: 'CONNECT_WALLET_SUCCESS', requestId: istekId, status: 'success', data: { result: [GIZLI.address] } })
        expect(localStore.dapps['yabanci.example']).toBeUndefined()
    })

    it('gizli moddan CIKIS da bekleyen istekleri iptal eder', async () => {
        await boot({ active: GIZLI })
        const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe('PRIVACY_BLOCKED')

        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(cikis.success).toBe(true)
        expect(localStore.active_account.key).toBe('a-1')
        expect(await bekleyen).toEqual({ error: { code: 4001, message: 'User closed the window.' } })
        expect(localStore.current_request).toBeUndefined()
    })

    it('mod DEGISMEZSE (zaten gizli / zaten normal) bekleyen istege dokunulmaz', async () => {
        // Tutarli gizli durum: donmus kayit VAR (acilis onarimi kayitsiz Gizli Hesap'a snapshot yazardi).
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH } })
        const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        let bitti = false
        bekleyen.then(() => { bitti = true })

        girisSahte = async () => ({ enabled: true, account: GIZLI }) // zaten gizli: yazma yok
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        await sakinles()
        expect(bitti).toBe(false)
        expect(localStore.current_request.type).toBe('PRIVACY_BLOCKED')
        // Zaten gizli bir giris istegi kaydi yeniden yazmaz / silmez.
        expect(localStore[FROZEN]).toEqual(ETH)

        for (const fn of bg.listeners.onRemoved) fn(1)
        await bekleyen
    })

    it('giris basarisiz olursa bekleyen istege dokunulmaz ve donmus zincir kaydi birakilmaz', async () => {
        await boot()
        const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        let bitti = false
        bekleyen.then(() => { bitti = true })

        girisSahte = async () => { throw new Error('WALLET_LOCKED') }
        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(res).toEqual({ success: false, error: 'WALLET_LOCKED' })
        await sakinles()
        expect(bitti).toBe(false)
        expect(localStore[FROZEN]).toBeUndefined()

        for (const fn of bg.listeners.onRemoved) fn(1)
        await bekleyen
    })
})

describe('A-C1: onay sonucu kanali kapidan gecer', () => {
    // Eski surum ConnectDapp.connect(): dapps kaydini kendisi yazar, sonra SUCCESS yollar.
    async function bekleyenConnect() {
        const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        return { bekleyen, istekId: localStore.current_request.id }
    }

    it('gizli modda Gizli Hesap adresi tasiyan CONNECT_WALLET_SUCCESS: sayfa 4001 alir, dapps temizlenir', async () => {
        await boot()
        const { bekleyen, istekId } = await bekleyenConnect()
        // Gecisin TAMAMLANMASINDAN ONCEKI pencere ya da servis calisani yeniden baslamasi:
        // aktif hesap Gizli Hesap oldu ama bekleyen istek iptal edilmedi.
        localStore.active_account = GIZLI
        localStore.dapps['yabanci.example'] = { accounts: [GIZLI.address], chainId: '0x1' }

        await callHandler({ type: 'CONNECT_WALLET_SUCCESS', requestId: istekId, status: 'success', data: { result: [GIZLI.address] } })

        expect(await bekleyen).toEqual({ error: { code: 4001, message: 'User rejected the connection' } })
        expect(localStore.dapps['yabanci.example']).toBeUndefined()
        expect(localStore.dapps['site.example']).toEqual({ accounts: [A.address], chainId: '0x1' })
    })

    it('aktif hesap genel olsa bile sonuc Gizli Hesap adresi tasiyorsa ret olur', async () => {
        await boot()
        const { bekleyen, istekId } = await bekleyenConnect()
        localStore.dapps['site.example'] = { accounts: [A.address, GIZLI.address.slice(2)], chainId: '0x1' }

        await callHandler({ type: 'CONNECT_WALLET_SUCCESS', requestId: istekId, status: 'success', data: { result: [GIZLI.address] } })

        expect((await bekleyen).error.code).toBe(4001)
        // Gizli Hesap adresi kayittan CIKARILIR, genel hesap kalir.
        expect(localStore.dapps['site.example'].accounts).toEqual([A.address])
    })

    it('SIGN_MESSAGE_SUCCESS / SEND_TX_SUCCESS gizli modda ekranin normal retine cevrilir', async () => {
        await boot({ active: GIZLI, extra: { dapps: { 'site.example': { accounts: [A.address] } } } })
        for (const [tip, ad, mesaj] of [
            ['SIGN_MESSAGE', 'SIGN_MESSAGE_SUCCESS', 'Sign Request cancelled by user.'],
            ['SEND_TX', 'SEND_TX_SUCCESS', 'Transaction cancelled by user.'],
        ]) {
            const istekId = 'bekleyen-' + tip
            let cevap
            const kayit = new Promise((resolve) => { cevap = resolve })
            // Bekleyen kaydi GERCEK yoldan kurmak yerine popup kaydini disk uzerinden simule et.
            const dappFunctions = await import('./utils/dappFunctions')
            dappFunctions.pendingRequests.set(istekId, { sendResponse: cevap, windowId: 1 })
            localStore.current_request = { id: istekId, type: tip }
            await callHandler({ type: ad, requestId: istekId, status: 'success', data: { result: '0xdeadbeef' } })
            expect(await kayit).toEqual({ error: { code: 4001, message: mesaj } })
        }
    })

    it('normal modda temiz bir SUCCESS AYNEN gecer (kapi araya girmez)', async () => {
        await boot()
        const { bekleyen, istekId } = await bekleyenConnect()
        await callHandler({ type: 'CONNECT_WALLET_SUCCESS', requestId: istekId, status: 'success', data: { result: [A.address] } })
        expect(await bekleyen).toEqual({ result: [A.address] })
    })

    it('CONNECT_WALLET_REJECTED gizli modda da gecer ("Gizli moddasin" popup\'i bununla reddeder)', async () => {
        await boot({ active: GIZLI })
        const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        await callHandler({
            type: 'CONNECT_WALLET_REJECTED', requestId: localStore.current_request.id, status: 'error',
            error: { code: 4001, message: 'User rejected the connection' },
        })
        expect((await bekleyen).error).toEqual({ code: 4001, message: 'User rejected the connection' })
    })

    it('depo okunamazsa SUCCESS FAIL-CLOSED: sayfa ret alir', async () => {
        await boot()
        const { bekleyen, istekId } = await bekleyenConnect()
        chrome.storage.local.get.mockRejectedValueOnce(new Error('disk'))
        await callHandler({ type: 'CONNECT_WALLET_SUCCESS', requestId: istekId, status: 'success', data: { result: [A.address] } })
        expect((await bekleyen).error.code).toBe(4001)
    })
})

describe('A-C1 (4): hesap listeleri Gizli Hesap adresini asla dondurmez', () => {
    // Kirli kayit SW baslangicindan SONRA yazilir: acilistaki scrubPrivateFromDapps() onu temizleyemez,
    // boylece dappFunctions.js'teki OKUYUCU duzeyindeki Gizli Hesap suzgecleri sinanir.
    const KIRLI = () => ({ accounts: [GIZLI.address, A.address], chainId: '0x1' })

    it('eth_accounts: kayda yazilmis Gizli Hesap adresi suzulur', async () => {
        await boot()
        localStore.dapps['site.example'] = KIRLI()
        expect(await callHandler({ method: 'eth_accounts' }, DAPP_SENDER)).toEqual({ result: [A.address] })
    })

    it('eth_requestAccounts hizli yolu Gizli Hesap adresini dondurmez, pencere acmaz', async () => {
        await boot()
        localStore.dapps['site.example'] = KIRLI()
        expect(await callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)).toEqual({ result: [A.address] })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('personal_sign from=GIZLI: kirli kayit hak sayilmaz, 4100, pencere yok', async () => {
        await boot()
        localStore.dapps['site.example'] = KIRLI()
        const r = await callHandler({ method: 'personal_sign', params: ['0x68656c6c6f', GIZLI.address] }, DAPP_SENDER)
        expect(r.error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('eth_sendTransaction from=GIZLI: kirli kayit hak sayilmaz, 4100, pencere yok', async () => {
        await boot()
        localStore.dapps['site.example'] = KIRLI()
        const r = await callHandler({ method: 'eth_sendTransaction', params: [{ from: GIZLI.address, to: B.address, value: '0x1' }] }, DAPP_SENDER)
        expect(r.error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })
})

describe('A-I3 / A-M7: gizli modda dapp-gorunur zincir dondurulur', () => {
    const chainChanged = () => olaylar('chainChanged')

    it('girerken ag kaydi alinir; girisin KENDI ag degisimi duyurulmaz', async () => {
        await boot()
        girisSahtesiKur({ network: BSC })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(localStore.currentNetwork).toEqual(BSC)
        expect(chainChanged()).toEqual([])
        expect(olaylar('connect')).toEqual([])
        // Siteler hala Ethereum goruyor.
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x1' })
    })

    it('gizli modda ag degisimi sitelere yayinlanmaz, dapps[*].chainId degismez, eth_chainId donmus kalir', async () => {
        await boot()
        girisSahtesiKur({ network: BSC })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        chrome.tabs.sendMessage.mockClear()

        // Swap / kopru ekraninda zincir secimi: UI once currentNetwork'u yazar, sonra CHAIN_CHANGED yollar.
        localStore.currentNetwork = POLYGON
        const cevap = await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })
        expect(cevap.success).toBe(true)

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x1' })
    })

    it('"zaten o zincirdeyiz" cevabi (wallet_switchEthereumChain) donmus zincire bakar', async () => {
        await boot()
        girisSahtesiKur({ network: BSC })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        // Canli ag BSC; siteler Ethereum goruyor: 0x1 istegi "zaten oradayiz" (null), 0x38 popup.
        expect(await callHandler({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }, YABANCI_SENDER)).toEqual({ result: null })
        const bekleyen = callHandler({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        for (const fn of bg.listeners.onRemoved) fn(1)
        await bekleyen
    })

    it('donmus kayit yoksa gizli modda yine de YAYIN YAPILMAZ (fail-closed)', async () => {
        await boot({ active: GIZLI })
        localStore.currentNetwork = POLYGON
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
    })

    // P5 (spec 4.9): eskiden burada tek uzlastirma chainChanged (0x89) beklenirdi, yani son gizli ag
    // genel sitelere gorunurdu. Artik giris oncesi ag geri yazilir ve sitelere hicbir olay gitmez.
    it('P5: cikista canli zincir donmus zincirden FARKLIYSA donmus ag GERI YAZILIR, sitelere olay gitmez', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON, last_evm_chain_id: 137 } })
        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(res.success).toBe(true)
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(localStore.last_evm_chain_id).toBe(1)
        expect(chainChanged()).toEqual([])
        // EVM -> EVM: connect da yollanmaz; dapps[*].chainId hic degismez.
        expect(olaylar('connect')).toEqual([])
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
        expect(localStore[FROZEN]).toBeUndefined()
    })

    it('cikista canli zincir donmus zincirle AYNIYSA hicbir sey yollanmaz', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: ETH } })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(chainChanged()).toEqual([])
        expect(olaylar('connect')).toEqual([])
        expect(localStore[FROZEN]).toBeUndefined()
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
    })

    // P5: TON'dayken girilen, hesap TON'u destekliyorsa (HD hesap) cikista TON geri yazilir. Siteler girisin
    // oncesinde de sonrasinda da "bagli degil" gordugu icin hicbir olay (connect dahil) gitmez.
    it('P5: TON\'dayken girilir, HD hesaba donunce TON geri yazilir; connect da chainChanged de gitmez (A-M7)', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: TON, currentNetwork: BSC } })
        // Siteler TON'dayken "disconnect" almisti (oturum bayragi).
        sessionStore.evmProviderDisconnected = true
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(localStore.currentNetwork).toEqual(TON)
        expect(olaylar('connect')).toEqual([])
        expect(chainChanged()).toEqual([])
        expect(sessionStore.evmProviderDisconnected).toBe(true)
    })

    // Geri yukleme KOSULU saglanmazsa (cikis hesabi TON'u desteklemiyor) bugunku uzlastirma surer.
    it('KONTROL: donmus ag TON ama cikis hesabi yalniz-EVM ise geri yazim yok; once connect, sonra chainChanged (A-M7 eski yol)', async () => {
        await boot({
            active: GIZLI,
            extra: {
                [FROZEN]: TON, currentNetwork: BSC,
                vaults: [{ type: 'hd', accounts: [IMPORTED], privateAccount: GIZLI }],
                privacy_mode: { lastPublicAccountKey: 'i-1', introSeen: true },
            },
        })
        sessionStore.evmProviderDisconnected = true
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(localStore.active_account.key).toBe('i-1')
        expect(localStore.currentNetwork).toEqual(BSC)
        expect(olaylar('connect')).toEqual([expect.objectContaining({ result: { chainId: '0x38' } })])
        expect(chainChanged()).toEqual([expect.objectContaining({ result: '0x38' })])
        expect(sessionStore.evmProviderDisconnected).toBe(false)
    })

    it('donmus kayit yoksa cikista uzlastirma YOK (sitelerin ne gordugu bilinemez)', async () => {
        await boot({ active: GIZLI, extra: { currentNetwork: POLYGON } })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(chainChanged()).toEqual([])
    })

    // P5: donmus kayit artik hesap turune bakmadan siteler icin gecerlidir (frozenNetwork.js); Genel modda
    // bayat kalan kaydi SW acilisindaki onarim siler. Silindikten sonra Genel mod eskisi gibi calisir.
    it('Genel modda CHAIN_CHANGED eskisi gibi yayinlanir (bayat donmus kaydi acilis onarimi siler)', async () => {
        await boot({ extra: { [FROZEN]: ETH } })
        expect(localStore[FROZEN]).toBeUndefined()
        localStore.currentNetwork = POLYGON
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })
        expect(chainChanged()).toEqual([expect.objectContaining({ result: '0x89' })])
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x89' })
    })
})

// P5 (spec 4.9): gizli moddan cikista GIRIS ONCESI ag geri yuklenir. Geri yazim hesap gecisiyle AYNI
// storage.set icindedir ve donmus kayit varken siteler onu gorur: son gizli ag genel sitelere hicbir
// zaman gorunmez, chainChanged gitmez.
describe('P5: cikista giris oncesi ag geri yuklenir', () => {
    const chainChanged = () => olaylar('chainChanged')
    const BASE_SITELERI = () => ({ 'site.example': { accounts: [A.address], chainId: '0x2105' } })

    it('Base\'de girilir, Polygon\'a gecilir, cikilir: ag Base, last_evm_chain_id Base, siteler ve dapps Base\'te kalir, olay yok', async () => {
        await boot({ emit: true, tabs: [SITE_TAB], extra: { currentNetwork: BASE, last_evm_chain_id: 8453, dapps: BASE_SITELERI() } })
        girisSahtesiKur()
        expect((await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })).success).toBe(true)
        expect(localStore[FROZEN]).toEqual(BASE)

        // Gizli oturumda ag secimi: arayuz once currentNetwork ve last_evm_chain_id'yi yazar, sonra CHAIN_CHANGED yollar.
        localStore.currentNetwork = POLYGON
        localStore.last_evm_chain_id = 137
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x2105' })
        chrome.tabs.sendMessage.mockClear()

        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        await sakinles()
        expect(cikis.success).toBe(true)
        expect(localStore.active_account.key).toBe('a-1')
        expect(localStore.currentNetwork).toEqual(BASE)
        expect(localStore.last_evm_chain_id).toBe(8453)
        expect(localStore[FROZEN]).toBeUndefined()
        expect(localStore.dapps['site.example'].chainId).toBe('0x2105')
        expect(chainChanged()).toEqual([])
        expect(olaylar('connect')).toEqual([])
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x2105' })
        expect(await callHandler({ method: 'net_version' }, DAPP_SENDER)).toEqual({ result: '8453' })
    })

    it('active_account ve currentNetwork TEK storage.set icindedir; ag icin ayri bir yazim yok', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON, last_evm_chain_id: 137 } })
        chrome.storage.local.set.mockClear()
        expect((await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })).success).toBe(true)
        const yazimlar = chrome.storage.local.set.mock.calls.map((c) => c[0])
        const hesapYazimlari = yazimlar.filter((y) => 'active_account' in y)
        expect(hesapYazimlari).toHaveLength(1)
        expect(hesapYazimlari[0].currentNetwork).toEqual(ETH)
        expect(hesapYazimlari[0].last_evm_chain_id).toBe(1)
        expect(yazimlar.filter((y) => !('active_account' in y) && ('currentNetwork' in y || 'last_evm_chain_id' in y))).toEqual([])
    })

    it('hesap yazildiktan HEMEN sonra (cikisin geri kalani calismadan) okunan eth_chainId donmus agi verir, son gizli agi degil', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        const gercekSet = chrome.storage.local.set.getMockImplementation()
        let anlik = null
        chrome.storage.local.set.mockImplementation(async (nesne) => {
            await gercekSet(nesne)
            if ('active_account' in nesne) anlik = await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)
        })
        expect((await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })).success).toBe(true)
        expect(anlik).toEqual({ result: '0x1' })
    })

    // Cift tik / ardisik gecis: gecisler sirayla (runPrivacyTransition) uygulanir. Girisin snapshot'i, cikisin
    // geri yazdigi agdan alinmali; cikis hala yarimken alinsaydi son gizli ag "sitelerin gordugu ag" olurdu.
    it('hizli cikis ve hemen ardindan giris: yeni donmus kayit GERI YUKLENEN agdir, son gizli ag degil', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        girisSahtesiKur()
        const [cikis, giris] = await Promise.all([
            callHandler({ type: 'PRIVACY_MODE_SET', enabled: false }),
            callHandler({ type: 'PRIVACY_MODE_SET', enabled: true }),
        ])
        await sakinles()
        expect(cikis.success).toBe(true)
        expect(giris.success).toBe(true)
        expect(localStore.active_account.key).toBe('g-1')
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x1' })
        expect(chainChanged()).toEqual([])
    })

    it('KONTROL: donmus zincir paketli listede yoksa geri yazim yok; bugunku tek uzlastirma chainChanged calisir', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: { chainId: 99999, name: 'Kaldirilmis ag' }, currentNetwork: POLYGON } })
        expect((await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })).success).toBe(true)
        expect(localStore.currentNetwork).toEqual(POLYGON)
        expect(chainChanged()).toEqual([expect.objectContaining({ result: '0x89' })])
        expect(localStore[FROZEN]).toBeUndefined()
    })

    it('KONTROL: girerken ag kaydi yoktuysa (null) geri yazim yok; canli ag icin bugunku uzlastirma calisir', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: null, currentNetwork: POLYGON } })
        expect((await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })).success).toBe(true)
        expect(localStore.currentNetwork).toEqual(POLYGON)
        expect(chainChanged()).toEqual([expect.objectContaining({ result: '0x89' })])
        expect(localStore[FROZEN]).toBeUndefined()
    })
})

// Hesap degisiminin EVM yayini (WalletConnect 1.8.3 birlesmesi) TEK tetikleyiciden gider:
// active_account icin chrome.storage.onChanged (handleActiveAccountChanged -> applyAccountSwitchToDapps).
// ACCOUNT_CHANGED artik EVM yaymaz. Bu testler onChanged'i oldValue/newValue ile gercek chrome gibi atesler.
async function hesapDegisti(eski, yeni) {
    localStore.active_account = yeni
    for (const fn of bg.listeners.onChanged) fn({ active_account: { oldValue: eski, newValue: yeni } }, 'local')
    await sakinles()
}

describe('A-M1: hesap duyurusu KIMLIKLE karar verir', () => {
    it('onChanged: bayragi dusmus ama Gizli Hesap adresini tasiyan aktif hesap duyurulmaz; yalniz accountsChanged([]) gider, kayit degismez', async () => {
        await boot({ tabs: [SITE_TAB] })
        await hesapDegisti(A, { key: 'x-9', type: 'hd', address: GIZLI.address })
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [] })])
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls)).not.toContain(GIZLI.address)
        expect(localStore.dapps['site.example'].accounts).toEqual([A.address])
    })

    it('onChanged: ayni key ile bayraksiz Gizli Hesap kopyasi da duyurulmaz', async () => {
        await boot({ tabs: [SITE_TAB] })
        await hesapDegisti(A, { key: GIZLI.key, type: 'hd', address: B.address })
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [] })])
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls)).not.toContain(B.address)
        expect(localStore.dapps['site.example'].accounts).toEqual([A.address])
    })

    it('Gizli Hesap tan genel hesaba donus: hibeli site yeni listeyi alir', async () => {
        await boot({ active: GIZLI, tabs: [SITE_TAB], extra: { dapps: { 'site.example': { accounts: [A.address, B.address], chainId: '0x1' } } } })
        await hesapDegisti(GIZLI, B)
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [B.address, A.address] })])
    })

    it('genel hesap duyurulmaya devam eder (hibeyi izleyen site yeni hesabi alir)', async () => {
        await boot({ tabs: [SITE_TAB] })
        await hesapDegisti(A, B)
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [B.address] })])
        expect(localStore.dapps['site.example'].accounts).toEqual([B.address])
    })

    it('ACCOUNT_CHANGED mesaji EVM accountsChanged YAYMAZ (cift bildirim onlemi)', async () => {
        await boot({ tabs: [SITE_TAB] })
        await callHandler({ type: 'ACCOUNT_CHANGED' })
        expect(olaylar('accountsChanged')).toEqual([])
    })

    it('PRIVACY_MODE_SET girisi: active_account yazimi onChanged ile sitelere TEK accountsChanged([]) ulastirir, Gizli adres sizmaz', async () => {
        await boot({ emit: true, tabs: [SITE_TAB] })
        girisSahtesiKur()
        const giris = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        await sakinles()
        expect(giris.success).toBe(true)
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [] })])
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls)).not.toContain(GIZLI.address)
        expect(localStore.dapps['site.example'].accounts).toEqual([A.address])
    })

    it('PRIVACY_MODE_SET cikisi: onChanged ile hibeli site genel hesabin listesini TEK kez alir', async () => {
        await boot({ active: GIZLI, emit: true, tabs: [SITE_TAB], extra: { [FROZEN]: ETH } })
        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        await sakinles()
        expect(cikis.success).toBe(true)
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [A.address] })])
        expect(localStore.dapps['site.example'].accounts).toEqual([A.address])
    })
})

describe('A-M9: bayrak KAPALI acilista depoda kalan Gizli Hesap', () => {
    it('acilista son genel hesaba doner, giris oncesi agi geri yazar, duyurur, donmus kaydi siler; dapp istegi bunu BEKLER', async () => {
        // boot() acilistan sonra bekler; burada ilk istegi bekleyen kapi sinanir.
        localStore = {
            active_account: GIZLI,
            vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }],
            currentNetwork: BSC,
            privacy_mode: { lastPublicAccountKey: 'a-1', introSeen: true },
            dapps: { 'site.example': { accounts: [A.address], chainId: '0x1' } },
            solana_dapps: {},
            [FROZEN]: ETH,
        }
        sessionStore = {}
        bg = await bootBackground({ privacyFlag: 'false', localStore, sessionStore, tabs: [SITE_TAB], emitStorageChanges: true })

        // Cikis bitmeden gelen istek: genel hesabin listesi doner (Gizli Hesap'inki DEGIL, [] de degil).
        const liste = await callHandler({ method: 'eth_accounts' }, DAPP_SENDER)
        expect(liste).toEqual({ result: [A.address] })
        expect(localStore.active_account.key).toBe('a-1')
        expect(localStore[FROZEN]).toBeUndefined()
        // accountsChanged, active_account onChanged'inin eszamansiz sonucudur: P5 sonrasi cikis chainChanged
        // yayini yapmadigi icin artik daha erken biter, olaylarin yerlesmesi beklenir.
        await sakinles()
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [A.address] })])
        // Siteler Ethereum goruyordu, canli ag BSC idi: P5 giris oncesi agi (Ethereum) geri yazar, olay gitmez.
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
    })

    it('depoda Gizli Hesap yoksa acilista hicbir sey yazilmaz ve istekler normal calisir', async () => {
        await boot({ flag: 'false' })
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(await callHandler({ method: 'eth_accounts' }, DAPP_SENDER)).toEqual({ result: [A.address] })
    })

    it('cikis MUMKUN DEGILSE (genel hesap yok) dapp istekleri "bagli degil" cevabini alir, popup acilmaz', async () => {
        localStore = {
            active_account: GIZLI,
            vaults: [{ type: 'hd', accounts: [], privateAccount: GIZLI }],
            currentNetwork: ETH,
            privacy_mode: { lastPublicAccountKey: null, introSeen: true },
            dapps: { 'site.example': { accounts: [A.address], chainId: '0x1' } },
            solana_dapps: {},
        }
        sessionStore = {}
        bg = await bootBackground({ privacyFlag: 'false', localStore, sessionStore })

        expect(await callHandler({ method: 'eth_accounts' }, DAPP_SENDER)).toEqual({ result: [] })
        expect((await callHandler({ method: 'personal_sign', params: ['0x68', A.address] }, DAPP_SENDER)).error.code).toBe(4100)
        expect((await callHandler({ method: 'eth_sendTransaction', params: [{ from: A.address, to: A.address }] }, DAPP_SENDER)).error.code).toBe(4100)
        expect((await callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)).error).toEqual({ code: 4001, message: 'User rejected the connection' })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        // Gizli Hesap'in adresi hicbir yerden sizmaz.
        expect(localStore.active_account.key).toBe('g-1')
    })
})

// --- Duzeltme turu 1 (birlesme incelemesi) ---------------------------------------------------

const TYPED = JSON.stringify({
    types: { EIP712Domain: [{ name: 'name', type: 'string' }], Mail: [{ name: 'c', type: 'string' }] },
    primaryType: 'Mail', domain: { name: 'x' }, message: { c: 'hi' },
})
const AGREGATOR_TAB = { id: 4, url: 'https://aggregator.example/' } // dapp.example bunun iframe'inde: ust cerceve hostname'i baska
const DAPP_IFRAME = { dapps: { 'dapp.example': { accounts: [A.address], chainId: '0x1' } } }
const TON_HESAP = { key: 't-1', type: 'ton', address: 'UQ' + 'A'.repeat(46) }

describe("I1: EVM'siz hedefe gecis (gizli mod / yalniz-TON hesap) accountsChanged([]) i TUM bagli sitelere duyurur", () => {
    it('girisi: ust cerceve sekmesi OLMAYAN (iframe) bagli site TEK accountsChanged([]) alir, kayit degismez', async () => {
        await boot({ emit: true, tabs: [AGREGATOR_TAB], extra: DAPP_IFRAME })
        girisSahtesiKur()
        const giris = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        await sakinles()
        expect(giris.success).toBe(true)
        const olay = olaylar('accountsChanged')
        expect(olay).toHaveLength(1)
        expect(olay[0].result).toEqual([])
        expect(olay[0].hostnames).toEqual(['dapp.example'])
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls)).not.toContain(GIZLI.address)
        expect(localStore.dapps['dapp.example'].accounts).toEqual([A.address])
    })

    it('ust cerceve sekmesi olan site de TEK olay alir (kume birlesimi olayi cogaltmaz)', async () => {
        await boot({ emit: true, tabs: [SITE_TAB] })
        girisSahtesiKur()
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        await sakinles()
        const olay = olaylar('accountsChanged')
        expect(olay).toHaveLength(1)
        expect(olay[0].hostnames).toEqual(['site.example'])
    })

    it('yalniz-TON hesaba gecis de iframe icindeki bagli siteye accountsChanged([]) ulastirir', async () => {
        await boot({ tabs: [AGREGATOR_TAB], extra: DAPP_IFRAME })
        await hesapDegisti(A, TON_HESAP)
        const olay = olaylar('accountsChanged')
        expect(olay).toHaveLength(1)
        expect(olay[0].result).toEqual([])
        expect(olay[0].hostnames).toEqual(['dapp.example'])
        expect(localStore.dapps['dapp.example'].accounts).toEqual([A.address])
    })

    it('EVM -> EVM gecisinde acik-sekme suzgeci KORUNUR: iframe icindeki uyuyan sitenin kaydina ve bildirimine dokunulmaz', async () => {
        await boot({ tabs: [AGREGATOR_TAB], extra: DAPP_IFRAME })
        await hesapDegisti(A, B)
        expect(olaylar('accountsChanged')).toEqual([])
        expect(localStore.dapps['dapp.example'].accounts).toEqual([A.address])
    })

    it('cikis: iframe icindeki site genel hesabin listesini ALMAZ (davranis degismedi), acik sekmeli site alir', async () => {
        await boot({
            active: GIZLI, emit: true, tabs: [AGREGATOR_TAB, SITE_TAB],
            extra: { [FROZEN]: ETH, dapps: { ...DAPP_IFRAME.dapps, 'site.example': { accounts: [A.address], chainId: '0x1' } } },
        })
        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        await sakinles()
        expect(cikis.success).toBe(true)
        const olay = olaylar('accountsChanged').filter((m) => m.hostnames.length > 0)
        expect(olay.length).toBeGreaterThan(0)
        for (const m of olay) {
            expect(m.hostnames).toContain('site.example')
            expect(m.hostnames).not.toContain('dapp.example')
            expect(m.result).toEqual([A.address])
        }
    })
})

describe('I2: Gizli Hesap adresi kirli bir kayittan hicbir okuyucuya ulasmaz', () => {
    const KIRLI = { accounts: [GIZLI.address, A.address], chainId: '0x1' }

    it('wallet_getPermissions (genel mod): izin listesi Gizli Hesap adresini tasimaz ve kayit temizlenir', async () => {
        await boot()
        localStore.dapps['site.example'] = structuredClone(KIRLI)
        const res = await callHandler({ method: 'wallet_getPermissions' }, DAPP_SENDER)
        expect(JSON.stringify(res).toLowerCase()).not.toContain(GIZLI.address.toLowerCase())
        expect(JSON.stringify(res)).toContain(A.address)
        expect(localStore.dapps['site.example'].accounts).toEqual([A.address])
    })

    it('genel A -> B gecisi: kirli kayit [GIZLI, B] sitelere Gizli adres tasiyan accountsChanged GONDERMEZ, kayit temizlenir', async () => {
        await boot({ tabs: [SITE_TAB] })
        localStore.dapps['site.example'] = { accounts: [GIZLI.address, B.address], chainId: '0x1' }
        await hesapDegisti(A, B)
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls).toLowerCase()).not.toContain(GIZLI.address.toLowerCase())
        for (const m of olaylar('accountsChanged')) expect(m.result).toEqual([B.address])
        expect(localStore.dapps['site.example'].accounts).toEqual([B.address])
    })

    it('R5/T28: temizlik BASARISIZ olsa da gecis DUSMEZ: hibe yazimi, bekleyen onay reti ve bildirim olur; hicbir yukte Gizli adres yok', async () => {
        // Yalniz TEMIZLIK yazimi (ilk set) duser; sonraki yazimlar calisir. Kirli [GIZLI, B] kaydi ve ayri bir
        // takip eden site ([A]) var: eski kod gecisi komple atlardi (hibe yazilmaz, ret yok); simdi gecis surer,
        // yalniz yukler Gizli adresten suzulur.
        const SITE2_TAB = { id: 6, url: 'https://takip.example/p' }
        await boot({ tabs: [SITE_TAB, SITE2_TAB] })
        localStore.dapps['site.example'] = { accounts: [GIZLI.address, B.address], chainId: '0x1', followActive: false }
        localStore.dapps['takip.example'] = { accounts: [A.address], chainId: '0x1', origin: 'https://takip.example' }
        chrome.storage.local.set.mockRejectedValueOnce(new Error('depo yazilamadi'))
        console.error.mockClear()
        rejectCalls.length = 0
        await hesapDegisti(A, B)
        expect(localStore.dapps['takip.example'].accounts).toEqual([B.address])
        expect(localStore.dapps['site.example'].accounts).toEqual([B.address])
        expect(rejectCalls.map((c) => c[0])).toContain('https://takip.example')
        const sonuclar = olaylar('accountsChanged').map((m) => m.result)
        expect(sonuclar.length).toBeGreaterThan(0)
        for (const r of sonuclar) expect(r).toEqual([B.address])
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls).toLowerCase()).not.toContain(GIZLI.address.toLowerCase())
        expect(JSON.stringify(localStore.dapps).toLowerCase()).not.toContain(GIZLI.address.toLowerCase())
        expect(console.error.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('dapps temizligi basarisiz')
    })

    it('T28: temizlik basarisizken Gizli moda GIRIS: accountsChanged [] yine gider, Gizli adres sizmaz', async () => {
        await boot({ emit: true, tabs: [SITE_TAB] })
        localStore.dapps['site.example'] = { accounts: [GIZLI.address, A.address], chainId: '0x1' }
        girisSahtesiKur()
        // Yalniz `dapps` (temizlik) yazimi bir kez duser; giris yazimlari (active_account vb.) calisir.
        const orijinalSet = chrome.storage.local.set.getMockImplementation()
        let dustu = false
        chrome.storage.local.set.mockImplementation(async (nesne) => {
            if (!dustu && nesne && 'dapps' in nesne) { dustu = true; throw new Error('depo yazilamadi') }
            return orijinalSet(nesne)
        })
        const giris = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        await sakinles()
        expect(dustu).toBe(true)
        expect(giris.success).toBe(true)
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [] })])
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls).toLowerCase()).not.toContain(GIZLI.address.toLowerCase())
    })

    it('SW acilisi: depoda kalmis kirli kayit bir kez temizlenir; temizse hicbir sey yazilmaz', async () => {
        await boot({ extra: { dapps: { 'site.example': { accounts: [GIZLI.address, A.address], chainId: '0x1' }, 'yalniz.example': { accounts: [GIZLI.address] } } } })
        expect(localStore.dapps['site.example'].accounts).toEqual([A.address])
        expect(localStore.dapps['yalniz.example']).toBeUndefined()
        teardownBackground()
        await boot()
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
    })

    it('eth_signTypedData_v4: signWith Gizli Hesap adresi (kirli kayit) hibe sayilmaz, 4100, pencere acilmaz', async () => {
        await boot()
        localStore.dapps['site.example'] = structuredClone(KIRLI)
        const res = await callHandler({ method: 'eth_signTypedData_v4', params: [GIZLI.address, TYPED] }, DAPP_SENDER)
        expect(res.error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })
})

describe('I3: gecis iptali -- gercek PRIVACY_MODE_SET + gercek onChanged', () => {
    const KAPANDI = { error: { code: 4001, message: 'User closed the window.' } }
    // Sayfaya donen cevaplari SAYMAK icin sendResponse'u dogrudan veriyoruz.
    function sayacliCagri(message, sender) {
        const respond = vi.fn()
        bg.listeners.onMessage[0](message, sender, respond)
        return respond
    }
    const TYPED_ISTEK = { method: 'eth_signTypedData_v4', params: [A.address, TYPED] }

    it.each([
        ['CONNECT', { method: 'eth_requestAccounts' }, YABANCI_SENDER],
        ['SIGN_TYPED_DATA', TYPED_ISTEK, DAPP_SENDER],
    ])('bekleyen %s: giriste sayfa TAM BIR KEZ KAPANDI alir, pencere bir kez kapanir, rejectPendingForOrigin cagrilmaz', async (tip, mesaj, sender) => {
        await boot({ emit: true })
        const respond = sayacliCagri(mesaj, sender)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe(tip)
        const istekId = localStore.current_request.id
        chrome.windows.remove.mockClear()

        girisSahtesiKur()
        const giris = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        await sakinles()

        expect(giris.success).toBe(true)
        expect(respond).toHaveBeenCalledTimes(1)
        expect(respond).toHaveBeenCalledWith(KAPANDI)
        expect(chrome.windows.remove).toHaveBeenCalledTimes(1)
        expect(chrome.windows.remove).toHaveBeenCalledWith(1)
        expect(rejectCalls).toEqual([])
        expect(localStore.current_request).toBeUndefined()
        // Onay ekrani hala acik kalmis gibi: "Imzala" gecis sonrasi islenmez, sayfaya ikinci cevap gitmez.
        if (tip === 'SIGN_TYPED_DATA') {
            const onay = await callHandler({ type: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: istekId, expectedDigest: '0x00', account: GIZLI } })
            expect(onay.success).not.toBe(true)
            expect(respond).toHaveBeenCalledTimes(1)
        }
    })

    it('cikis: depodan kalan bekleyen typed-data penceresi de TAM BIR KEZ iptal edilir', async () => {
        await boot({ emit: true })
        const respond = sayacliCagri(TYPED_ISTEK, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe('SIGN_TYPED_DATA')
        chrome.windows.remove.mockClear()

        // Giris yarim kalmis gibi: aktif hesap Gizli Hesap + donmus kayit yazildi, bekleyen istek iptal EDILMEDI.
        localStore.active_account = GIZLI
        localStore[FROZEN] = ETH
        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        await sakinles()

        expect(cikis.success).toBe(true)
        expect(localStore.active_account.key).toBe('a-1')
        expect(respond).toHaveBeenCalledTimes(1)
        expect(respond).toHaveBeenCalledWith(KAPANDI)
        expect(chrome.windows.remove).toHaveBeenCalledTimes(1)
        expect(localStore.current_request).toBeUndefined()
    })
})
