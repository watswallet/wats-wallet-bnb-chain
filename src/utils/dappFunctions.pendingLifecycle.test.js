import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

// T8 / N7: onay penceresi acma kisiti (T4a) bu dosyada GERCEK zamandan bagimsiz
// kilinir; cagri sozlesmesi `dappFunctions.authz.test.js`te sinanir.
vi.mock('./approvalThrottle', () => ({ checkApprovalThrottle: vi.fn(() => ({ ok: true })), noteApprovalRejected: vi.fn() }))

/**
 * Bekleyen dapp isteginin yasam dongusu (guvenlik taramasi duzeltmeleri):
 *
 * 1) YARIS: current_request, onay penceresi mutex'i (isOpeningWindow)
 *    alinmadan ONCE diske yaziliyordu. Pencere acilirken gelen ikinci istek
 *    ilkinin kaydini eziyor ama kendisi reddediliyordu: acilan pencere B'nin
 *    verisini gosterip A'nin id'siyle eslesmeyen bir istek yurutuyordu.
 *
 * 2) OLU KAYIT: resolvePendingRequest yalniz bellek ici pendingRequests
 *    Map'inde olan id'ler icin temizlik yapiyordu. MV3 service worker her
 *    yeniden basladiginda Map BOSALIR ama diskteki current_request kalir;
 *    kullanicinin Reddet'i hicbir sey silmiyor ve popup sonsuza dek ayni olu
 *    onay ekranina aciliyordu.
 */

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const GRANTED = '0xAbCdEf0000000000000000000000000000000001'

let localStore
let dapp
// Modulun KENDI pencere-kapanma dinleyicisi (dappFunctions.js modul kapsaminda
// kaydeder); testler kullanicinin X'e basmasini bununla taklit eder.
let onRemovedListener

function installChromeStub() {
    onRemovedListener = null
    globalThis.chrome = {
        windows: {
            onRemoved: { addListener: (fn) => { onRemovedListener = fn } },
            create: vi.fn(async () => ({ id: 7 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 7 })),
            remove: vi.fn(async () => {}),
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { delete localStore[k] }),
            },
        },
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p },
    }
}

const sender = {
    origin: 'https://dapp.example',
    url: 'https://dapp.example/app',
    tab: { url: 'https://dapp.example/app', favIconUrl: '' },
}

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k1', address: GRANTED, name: 'Hesap 1' },
        dapps: { 'dapp.example': { accounts: [GRANTED], chainId: '0x1' } },
    }
    installChromeStub()
    dapp = await import('./dappFunctions')
})

describe('yaris: pencere acilirken gelen ikinci istek ILKININ kaydini EZEMEZ', () => {
    it('B reddedilir ve diskte A\'nin istegi kalir; acilan pencere A\'yi gosterir', async () => {
        // Pencere olusumu elle serbest birakilana kadar ASKIDA tutulur.
        let releaseCreate
        chrome.windows.create = vi.fn(() => new Promise((res) => { releaseCreate = res }))

        const respA = vi.fn()
        const respB = vi.fn()

        const pA = dapp.signMessageDapp({ params: ['msgA', GRANTED] }, sender, respA)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalled())

        // A pencereyi acarken B gelir: mutex onu reddetmeli VE diske dokundurtmamali.
        await dapp.signMessageDapp({ params: ['msgB', GRANTED] }, sender, respB)

        expect(respB).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4001 }) })
        expect(localStore.current_request.messageToSign).toBe('msgA')

        releaseCreate({ id: 7 })
        await pA

        // Tutarlilik: diskteki kayit, bekleyen istekle AYNI id'yi tasir.
        expect(respA).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.has(localStore.current_request.id)).toBe(true)
    })
})

describe('olu kayit: service worker yeniden basladiktan sonra Reddet kaydi TEMIZLER', () => {
    it('id Map\'te olmasa da diskteki AYNI id\'li current_request silinir', async () => {
        // SW yeniden basladi: Map bos, diskte kayit duruyor.
        localStore.current_request = { type: 'SEND_TX', id: 'ghost-1' }

        await dapp.resolvePendingRequest({ requestId: 'ghost-1', status: 'error', error: { code: 4001, message: 'Transaction cancelled by user.' } })

        expect(localStore.current_request).toBeUndefined()
    })

    it('FARKLI id\'li guncel kayit ise DOKUNULMAZ', async () => {
        localStore.current_request = { type: 'SEND_TX', id: 'guncel-2' }

        await dapp.resolvePendingRequest({ requestId: 'ghost-1', status: 'error' })

        expect(localStore.current_request).toEqual({ type: 'SEND_TX', id: 'guncel-2' })
    })

    it('normal yol degismedi: Map\'teki istek yanitlanir, kayit silinir (regresyon)', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('id-1', { sendResponse: respond, windowId: 3 })
        localStore.current_request = { type: 'SIGN_MESSAGE', id: 'id-1' }

        await dapp.resolvePendingRequest({ requestId: 'id-1', status: 'success', data: { result: '0xsig' } })

        expect(respond).toHaveBeenCalledWith({ result: '0xsig' })
        expect(dapp.pendingRequests.size).toBe(0)
        expect(localStore.current_request).toBeUndefined()
    })
})

/**
 * B1: TON gonderimi onaylandiktan sonra dapp'in yaniti ARKA PLANA aittir.
 *
 * Eskiden pencere kapanisi (onRemoved) ve yeni bir istek (closeExistingWindow)
 * gonderim SURERKEN de dapp'e 4001 (-> 300 "kullanici reddetti") veriyordu;
 * islem ise zincire gidiyordu. Isleme baglanan (committed) kayit artik bu iki
 * yoldan yanitlanmaz; yaniti arka plan verir (BOC, kod 0/1) ya da kaydi
 * birakir ve ertelenen 4001 o an gider.
 */
describe('B1: isleme baglanan (committed) TON istegi', () => {
    // Her create cagrisi AYRI bir pencere: degistirme testleri eski ve yeni
    // pencereyi ayirt edebilmeli.
    function ardisikPencereler() {
        let sonraki = 10
        chrome.windows.create = vi.fn(async () => ({ id: sonraki++ }))
    }

    async function tonIstegiAc(id = 'ton-1') {
        const yanit = vi.fn()
        await dapp.openApprovalWindow(id, yanit, { type: 'TON_SEND_TX', id })
        return yanit
    }

    it('commitPendingRequest bir kez true, sonra false; yoksa false', async () => {
        await tonIstegiAc()
        expect(dapp.commitPendingRequest('ton-1')).toBe(true)
        expect(dapp.commitPendingRequest('ton-1')).toBe(false)
        expect(dapp.commitPendingRequest('yok')).toBe(false)
    })

    it('yanitlanmis (answered) kayit commit edilemez', async () => {
        await tonIstegiAc()
        await dapp.answerPendingRequest('ton-1', { error: { code: 1, message: 'x' }, id: '7' }, { keepWindow: true })
        expect(dapp.commitPendingRequest('ton-1')).toBe(false)
    })

    it('isPendingRequestOpen: bekleyen true; committed, answered ya da yoksa false', async () => {
        await tonIstegiAc('a')
        expect(dapp.isPendingRequestOpen('a')).toBe(true)
        dapp.commitPendingRequest('a')
        expect(dapp.isPendingRequestOpen('a')).toBe(false)
        expect(dapp.isPendingRequestOpen('yok')).toBe(false)
    })

    // Reddin metni buna bagli: kayit YOKSA hicbir deneme baslamadi; isleniyor ya
    // da yanitlandiysa baska bir deneme imzalayip gondermis olabilir.
    it('pendingRequestState: yok, bekliyor, isleniyor, yanitlandi AYRI', async () => {
        expect(dapp.pendingRequestState('yok')).toBe('gone')
        await tonIstegiAc('a')
        expect(dapp.pendingRequestState('a')).toBe('open')
        dapp.commitPendingRequest('a')
        expect(dapp.pendingRequestState('a')).toBe('committed')
        await dapp.answerPendingRequest('a', { error: { code: 0, message: 'x' }, id: '7' }, { keepWindow: true })
        expect(dapp.pendingRequestState('a')).toBe('answered')
    })

    it('pencere kapanirsa dapp e HICBIR SEY gitmez, kayit kalir, current_request silinir', async () => {
        const yanit = await tonIstegiAc()
        expect(dapp.commitPendingRequest('ton-1')).toBe(true)

        onRemovedListener(7)

        expect(yanit).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.has('ton-1')).toBe(true)
        expect(dapp.pendingRequests.get('ton-1').windowId).toBeNull()
        await vi.waitFor(() => expect(localStore.current_request).toBeUndefined())
    })

    it('kapanistan sonra arka planin yaniti (BOC) dapp e gider, pencere kapatilmaz', async () => {
        const yanit = await tonIstegiAc()
        dapp.commitPendingRequest('ton-1')
        onRemovedListener(7)
        chrome.windows.remove.mockClear()

        const sonuc = await dapp.answerPendingRequest('ton-1', { result: 'te6BOC', id: '7' })

        expect(sonuc).toBe(true)
        expect(yanit).toHaveBeenCalledTimes(1)
        expect(yanit).toHaveBeenCalledWith({ result: { result: 'te6BOC', id: '7' } })
        expect(dapp.pendingRequests.has('ton-1')).toBe(false)
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })

    it('kapanistan sonra birakilirsa (yeniden denenebilir hata) ertelenen 4001 o an gider', async () => {
        const yanit = await tonIstegiAc()
        dapp.commitPendingRequest('ton-1')
        onRemovedListener(7)

        dapp.releasePendingRequest('ton-1')

        expect(yanit).toHaveBeenCalledTimes(1)
        expect(yanit).toHaveBeenCalledWith({ error: { code: 4001, message: 'User closed the window.' } })
        expect(dapp.pendingRequests.has('ton-1')).toBe(false)
    })

    it('pencere acikken birakilirsa yanit YOK; kayit yeniden reddedilebilir (300)', async () => {
        const yanit = await tonIstegiAc()
        dapp.commitPendingRequest('ton-1')

        dapp.releasePendingRequest('ton-1')
        expect(yanit).not.toHaveBeenCalled()
        expect(dapp.isPendingRequestOpen('ton-1')).toBe(true)

        const red = { result: { error: { code: 300, message: 'User rejected the request' }, id: '7' } }
        await dapp.resolvePendingRequest({ requestId: 'ton-1', status: 'success', data: red })
        expect(yanit).toHaveBeenCalledWith({ result: red.result })
    })

    it('yeni istek pencereyi degistirirse committed kayda 4001 GITMEZ', async () => {
        ardisikPencereler()
        const yanit = await tonIstegiAc('ton-1')
        dapp.commitPendingRequest('ton-1')

        await dapp.openApprovalWindow('evm-2', vi.fn(), { type: 'SEND_TX', id: 'evm-2' })

        expect(yanit).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.get('ton-1').windowId).toBeNull()
    })

    // F2: gec gelen yanit YENI pencereyi kapatip YENI istegin kaydini silmemeli.
    it('degistirmeden sonra gelen yanit YENI pencereye ve YENI current_request e DOKUNMAZ', async () => {
        ardisikPencereler()
        const yanit = await tonIstegiAc('ton-1')
        dapp.commitPendingRequest('ton-1')
        const yeniYanit = vi.fn()
        await dapp.openApprovalWindow('evm-2', yeniYanit, { type: 'SEND_TX', id: 'evm-2' })
        chrome.windows.remove.mockClear()

        await dapp.answerPendingRequest('ton-1', { result: 'te6BOC', id: '7' })

        expect(yanit).toHaveBeenCalledWith({ result: { result: 'te6BOC', id: '7' } })
        expect(localStore.current_request).toEqual({ type: 'SEND_TX', id: 'evm-2' })
        expect(chrome.windows.remove).not.toHaveBeenCalled()
        expect(yeniYanit).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.has('evm-2')).toBe(true)
    })

    it('degistirmeden sonra birakilirsa ertelenen 4001 "replaced" gider', async () => {
        ardisikPencereler()
        const yanit = await tonIstegiAc('ton-1')
        dapp.commitPendingRequest('ton-1')
        await dapp.openApprovalWindow('evm-2', vi.fn(), { type: 'SEND_TX', id: 'evm-2' })

        dapp.releasePendingRequest('ton-1')

        expect(yanit).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request replaced by a new one.' } })
    })

    // F4: ikinci yuzey (eylem popup'i) gonderim surerken Reddet'e basabilir.
    it('ekranin yaniti (SEND_TX_SUCCESS) committed kayitta YUTULUR', async () => {
        const yanit = await tonIstegiAc()
        localStore.current_request = { type: 'TON_SEND_TX', id: 'ton-1' }
        dapp.commitPendingRequest('ton-1')
        chrome.windows.remove.mockClear()

        await dapp.resolvePendingRequest({ requestId: 'ton-1', status: 'success', data: { result: { error: { code: 300 }, id: '7' } } })

        expect(yanit).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.has('ton-1')).toBe(true)
        expect(localStore.current_request).toEqual({ type: 'TON_SEND_TX', id: 'ton-1' })
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })

    it('answerPendingRequest kayit yoksa false doner', async () => {
        expect(await dapp.answerPendingRequest('yok', { result: 'x' })).toBe(false)
    })
})

describe('B1.6: yanit verilip pencere ACIK birakilir (keepWindow)', () => {
    async function tonIstegiAc(id = 'ton-1') {
        const yanit = vi.fn()
        await dapp.openApprovalWindow(id, yanit, { type: 'TON_SEND_TX', id })
        return yanit
    }

    // F1: current_request silinirse App.vue onay ekranini ana sayfaya cevirir
    // ve kullanici hatayi okuyamaz.
    it('dapp yanitlanir; kayit, current_request ve pencere KALIR', async () => {
        const yanit = await tonIstegiAc()
        chrome.windows.remove.mockClear()

        await dapp.answerPendingRequest('ton-1', { error: { code: 1, message: 'Request expired' }, id: '7' }, { keepWindow: true })

        expect(yanit).toHaveBeenCalledWith({ result: { error: { code: 1, message: 'Request expired' }, id: '7' } })
        expect(dapp.pendingRequests.has('ton-1')).toBe(true)
        expect(localStore.current_request).toEqual({ type: 'TON_SEND_TX', id: 'ton-1' })
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })

    it('sonra pencere kapaninca kayit ve current_request silinir, IKINCI yanit gitmez', async () => {
        const yanit = await tonIstegiAc()
        await dapp.answerPendingRequest('ton-1', { error: { code: 1, message: 'x' }, id: '7' }, { keepWindow: true })

        onRemovedListener(7)

        expect(yanit).toHaveBeenCalledTimes(1)
        expect(dapp.pendingRequests.has('ton-1')).toBe(false)
        await vi.waitFor(() => expect(localStore.current_request).toBeUndefined())
    })

    it('yanitlanmis kayda ekranin Reddet i IKINCI yanit vermez, pencereyi kapatir', async () => {
        const yanit = await tonIstegiAc()
        await dapp.answerPendingRequest('ton-1', { error: { code: 0, message: 'x' }, id: '7' }, { keepWindow: true })
        chrome.windows.remove.mockClear()

        await dapp.resolvePendingRequest({ requestId: 'ton-1', status: 'success', data: { result: { error: { code: 300 }, id: '7' } } })

        expect(yanit).toHaveBeenCalledTimes(1)
        expect(dapp.pendingRequests.has('ton-1')).toBe(false)
        expect(chrome.windows.remove).toHaveBeenCalledWith(7)
    })

    it('yanitlanmis kayit yeni istekle degistirilince IKINCI yanit gitmez', async () => {
        const yanit = await tonIstegiAc()
        await dapp.answerPendingRequest('ton-1', { error: { code: 0, message: 'x' }, id: '7' }, { keepWindow: true })

        await dapp.openApprovalWindow('evm-2', vi.fn(), { type: 'SEND_TX', id: 'evm-2' })

        expect(yanit).toHaveBeenCalledTimes(1)
        expect(dapp.pendingRequests.has('ton-1')).toBe(false)
    })

    it('yanitlanmis kayda ikinci answerPendingRequest false doner, yanit gitmez', async () => {
        const yanit = await tonIstegiAc()
        await dapp.answerPendingRequest('ton-1', { error: { code: 0, message: 'x' }, id: '7' }, { keepWindow: true })

        expect(await dapp.answerPendingRequest('ton-1', { result: 'y' }, { keepWindow: true })).toBe(false)
        expect(yanit).toHaveBeenCalledTimes(1)
    })

    // Sonuc current_request'e de yazilir: bu istegi sonradan acan her TON ekrani
    // (or. eylem popup'i) Onayla/Reddet ile degil, dogrudan Kapat-yalniz ve
    // GERCEK metinle acilir.
    const SONUC = { error: 'TON_SEND_FAILED', code: 0 }

    it('outcome verilirse sonuc current_request.answered olarak yazilir', async () => {
        await tonIstegiAc()

        await dapp.answerPendingRequest('ton-1', { error: { code: 0, message: 'x' }, id: '7' }, { keepWindow: true, outcome: SONUC })

        expect(localStore.current_request).toEqual({ type: 'TON_SEND_TX', id: 'ton-1', answered: SONUC })
    })

    it('outcome BASKA bir istegin current_request ine yazilmaz', async () => {
        await tonIstegiAc()
        localStore.current_request = { type: 'SEND_TX', id: 'evm-2' }

        await dapp.answerPendingRequest('ton-1', { error: { code: 0, message: 'x' }, id: '7' }, { keepWindow: true, outcome: SONUC })

        expect(localStore.current_request).toEqual({ type: 'SEND_TX', id: 'evm-2' })
    })

    // Islem surerken pencere kapandi: kayit penceresiz, current_request silindi.
    // Sonuc onu DIRILTMEMELI (popup olu bir ekrana acilirdi).
    it('pencere tutulamadiysa outcome yazilmaz, silinmis kayit dirilmez', async () => {
        await tonIstegiAc()
        dapp.commitPendingRequest('ton-1')
        onRemovedListener(7)
        await vi.waitFor(() => expect(localStore.current_request).toBeUndefined())

        await dapp.answerPendingRequest('ton-1', { error: { code: 0, message: 'x' }, id: '7' }, { keepWindow: true, outcome: SONUC })

        expect(localStore.current_request).toBeUndefined()
    })

    it('keepWindow VERILMEZSE varsayilan degismez: kayit, current_request ve pencere gider', async () => {
        const yanit = await tonIstegiAc()
        chrome.windows.remove.mockClear()

        await dapp.answerPendingRequest('ton-1', { result: 'te6BOC', id: '7' })

        expect(yanit).toHaveBeenCalledWith({ result: { result: 'te6BOC', id: '7' } })
        expect(dapp.pendingRequests.has('ton-1')).toBe(false)
        expect(localStore.current_request).toBeUndefined()
        expect(chrome.windows.remove).toHaveBeenCalledWith(7)
    })
})

// EVM/Solana bayrak TASIMAZ: davranislari birebir eskisi gibi kalmali.
describe('regresyon: EVM bekleyen istek', () => {
    it('pencere kapaninca dapp 4001 "User closed the window." alir, kayit silinir', async () => {
        const yanit = vi.fn()
        const p = dapp.signMessageDapp({ params: ['msg', GRANTED] }, sender, yanit)
        await p
        const id = localStore.current_request.id
        expect(dapp.pendingRequests.has(id)).toBe(true)

        onRemovedListener(7)

        expect(yanit).toHaveBeenCalledWith({ error: { code: 4001, message: 'User closed the window.' } })
        expect(dapp.pendingRequests.has(id)).toBe(false)
        await vi.waitFor(() => expect(localStore.current_request).toBeUndefined())
    })

    it('yeni istek gelince eski istek 4001 "Request replaced by a new one." alir', async () => {
        const ilk = vi.fn()
        await dapp.signMessageDapp({ params: ['msgA', GRANTED] }, sender, ilk)

        await dapp.signMessageDapp({ params: ['msgB', GRANTED] }, sender, vi.fn())

        expect(ilk).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request replaced by a new one.' } })
    })

    it('ekranin onayi yanitlar, pencereyi kapatir, current_request i siler', async () => {
        const yanit = vi.fn()
        await dapp.signMessageDapp({ params: ['msg', GRANTED] }, sender, yanit)
        const id = localStore.current_request.id
        chrome.windows.remove.mockClear()

        await dapp.resolvePendingRequest({ requestId: id, status: 'success', data: { result: '0xsig' } })

        expect(yanit).toHaveBeenCalledWith({ result: '0xsig' })
        expect(localStore.current_request).toBeUndefined()
        expect(chrome.windows.remove).toHaveBeenCalledWith(7)
    })
})

// -- T8 / hasPendingRequest --
describe('hasPendingRequest', () => {
    it('Map\'te olan id icin true, olmayan icin false', async () => {
        dapp.pendingRequests.set('var', { sendResponse: vi.fn(), windowId: 1 })

        expect(dapp.hasPendingRequest('var')).toBe(true)
        expect(dapp.hasPendingRequest('yok')).toBe(false)
        expect(dapp.hasPendingRequest(undefined)).toBe(false)
    })

    it('onay penceresi acilinca kayit `origin` ve `type` ile Map\'e girer', async () => {
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, sender, vi.fn())

        const id = localStore.current_request.id
        expect(dapp.hasPendingRequest(id)).toBe(true)
        expect(dapp.pendingRequests.get(id)).toMatchObject({ windowId: 7, origin: 'https://dapp.example', type: 'SIGN_MESSAGE' })
    })
})

// -- T8 / N7 (3): bekleyen IMZA istegini farkli-origin izinsiz istek EZEMEZ --
//
// Tiklama yarisi: kullanici A penceresinde Imzala'yi hedeflerken baglanmamis bir
// sayfa B penceresini ayni yerde acip A'yi oldurmesin. Yalniz imza/gonderim
// ekranlari korunur; CONNECT yeniden-yazimi ve ayni origin'in yenisinin eskisini
// 4001 ile ezmesi DEGISMEZ (React StrictMode cift eth_requestAccounts).
describe('bekleyen IMZA istegi ezme korumasi (N7, -32002)', () => {
    const senderFor = (origin) => ({ origin, url: origin + '/app', tab: { url: origin + '/app', favIconUrl: '' } })
    const EVIL = senderFor('https://evil.example')
    const WIDGET = senderFor('https://widget.example')

    beforeEach(() => {
        // widget.example de BAGLI (hibeli); evil.example hic baglanmadi.
        localStore.dapps['widget.example'] = { accounts: [GRANTED], chainId: '0x1' }
    })

    async function a_imzaIstegiBekliyor() {
        const respA = vi.fn()
        await dapp.signMessageDapp({ params: ['msgA', GRANTED] }, sender, respA)
        expect(chrome.windows.create).toHaveBeenCalledOnce()
        return respA
    }

    it('hibesiz FARKLI origin\'in CONNECT\'i -32002 alir; A\'nin penceresi ve kaydi YASAR', async () => {
        const respA = await a_imzaIstegiBekliyor()
        const idA = localStore.current_request.id

        const respEvil = vi.fn()
        await dapp.handleConnectWallet({}, EVIL, respEvil)

        expect(respEvil).toHaveBeenCalledWith({ error: { code: -32002, message: 'Request already pending' } })
        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(chrome.windows.remove).not.toHaveBeenCalled()
        expect(respA).not.toHaveBeenCalled()
        expect(localStore.current_request.id).toBe(idA)
        expect(localStore.current_request.messageToSign).toBe('msgA')
        expect(dapp.hasPendingRequest(idA)).toBe(true)
    })

    it('hibesiz FARKLI origin\'in wallet_switchEthereumChain\'i de -32002 alir', async () => {
        await a_imzaIstegiBekliyor()
        localStore.active_account = { ...localStore.active_account, type: 'hd' }

        const respEvil = vi.fn()
        await dapp.handleSwitchChain({ params: [{ chainId: '0x38' }] }, EVIL, respEvil)

        expect(respEvil).toHaveBeenCalledWith({ error: { code: -32002, message: 'Request already pending' } })
        expect(chrome.windows.create).toHaveBeenCalledOnce()
    })

    it('eth_sendTransaction bekliyorsa o da korunur', async () => {
        const respA = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: GRANTED, to: GRANTED, value: '0x0' }] }, sender, respA)
        const respEvil = vi.fn()
        await dapp.handleConnectWallet({}, EVIL, respEvil)

        expect(respEvil).toHaveBeenCalledWith({ error: expect.objectContaining({ code: -32002 }) })
        expect(respA).not.toHaveBeenCalled()
    })

    it('SIGN_TYPED_DATA bekliyorsa o da korunur (T9 isteklerinin tipi)', async () => {
        dapp.pendingRequests.set('typed-1', { sendResponse: vi.fn(), windowId: 7, origin: 'https://dapp.example', type: 'SIGN_TYPED_DATA' })
        const respEvil = vi.fn()
        await dapp.handleConnectWallet({}, EVIL, respEvil)

        expect(respEvil).toHaveBeenCalledWith({ error: expect.objectContaining({ code: -32002 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('HIBELI baska origin (widget.example) bekleyen istegi eskisi gibi 4001 ile EZER', async () => {
        const respA = await a_imzaIstegiBekliyor()

        const respWidget = vi.fn()
        await dapp.signMessageDapp({ params: ['msgW', GRANTED] }, WIDGET, respWidget)

        expect(respA).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request replaced by a new one.' } })
        expect(respWidget).not.toHaveBeenCalled()
        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
        expect(localStore.current_request.messageToSign).toBe('msgW')
    })

    it('AYNI origin\'in yenisi eskisini 4001 ile ezer (degismedi)', async () => {
        const respA = await a_imzaIstegiBekliyor()

        await dapp.signMessageDapp({ params: ['msgA2', GRANTED] }, sender, vi.fn())

        expect(respA).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request replaced by a new one.' } })
        expect(localStore.current_request.messageToSign).toBe('msgA2')
    })

    it('bekleyen istek CONNECT ise KORUNMAZ: baska origin onu eskisi gibi ezer', async () => {
        localStore.dapps = {}
        const respA = vi.fn()
        await dapp.handleConnectWallet({}, sender, respA)
        const respEvil = vi.fn()
        await dapp.handleConnectWallet({}, EVIL, respEvil)

        expect(respA).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request replaced by a new one.' } })
        expect(respEvil).not.toHaveBeenCalled()
        expect(localStore.current_request.origin).toBe('https://evil.example')
    })

    it('bekleyen istek cozuldukten sonra hibesiz origin\'in CONNECT\'i normal acilir', async () => {
        await a_imzaIstegiBekliyor()
        const idA = localStore.current_request.id
        await dapp.resolvePendingRequest({ requestId: idA, status: 'error', error: { code: 4001, message: 'x' } })

        const respEvil = vi.fn()
        await dapp.handleConnectWallet({}, EVIL, respEvil)

        expect(respEvil).not.toHaveBeenCalled()
        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
        expect(localStore.current_request.type).toBe('CONNECT')
    })

    it('"Unknown" gonderen "ayni origin" SAYILMAZ (iki cozulemeyen gonderen birbirini ezemez)', async () => {
        dapp.pendingRequests.set('typed-u', { sendResponse: vi.fn(), windowId: 7, origin: 'Unknown', type: 'SEND_TX' })
        const respU = vi.fn()
        await dapp.handleConnectWallet({}, { tab: {} }, respU)

        expect(respU).toHaveBeenCalledWith({ error: expect.objectContaining({ code: -32002 }) })
    })

    // 1.8.2 birlesimi: TON istekleri openApprovalWindow'u PAYLASIR (kayitlari da `origin`/`type`
    // tasir). Korunan imza ekranini hibesiz baska origin'in TON istegi de EZEMEZ. Dapp'e giden
    // `{error}` TON seridinde tonInjected.js'te bir TonConnect govdesine (kod 0) cevrilir
    // (kod okumasiyla goruldu, canli DOGRULANMADI); TON isleyicilerinin kendi hata yollari degismez.
    it('hibesiz FARKLI origin\'in TON_CONNECT\'i de -32002 alir; bekleyen imza YASAR', async () => {
        const respA = await a_imzaIstegiBekliyor()
        const idA = localStore.current_request.id

        const respTon = vi.fn()
        await dapp.openApprovalWindow('ton-x', respTon, { type: 'TON_CONNECT', id: 'ton-x', origin: 'https://evil.example' })

        expect(respTon).toHaveBeenCalledWith({ error: { code: -32002, message: 'Request already pending' } })
        expect(respA).not.toHaveBeenCalled()
        expect(dapp.hasPendingRequest(idA)).toBe(true)
        expect(dapp.hasPendingRequest('ton-x')).toBe(false)
        expect(chrome.windows.create).toHaveBeenCalledOnce()
    })

    it('hibe okunamazsa kapali-basarisiz: yeni istek reddedilir, bekleyen YASAR', async () => {
        await a_imzaIstegiBekliyor()
        const idA = localStore.current_request.id
        chrome.storage.local.get = vi.fn(async () => { throw new Error('storage down') })

        // Isleyicilerin kendi depo okumasi once patlardi; kapiyi DOGRUDAN sina.
        const respEvil = vi.fn()
        await dapp.openApprovalWindow('rid-evil', respEvil, { type: 'CONNECT', id: 'rid-evil', origin: 'https://evil.example' })

        expect(respEvil).toHaveBeenCalledWith({ error: expect.objectContaining({ code: -32002 }) })
        expect(dapp.hasPendingRequest(idA)).toBe(true)
        expect(chrome.windows.create).toHaveBeenCalledOnce()
    })
})

// -- T8 / N2: resolvePendingRequest hijyeni --
//
// `error: null` -> `typeof null === 'object'` oldugu icin dapp'e `{ error: null }`
// gidiyor, dapp `undefined` goruyordu. `status:'success'` + `data` yok ise
// `data.result` TypeError atip istegi ASKIDA birakiyordu. Dapp'e giden her hata
// nesnesi sayisal `code` tasimali.
describe('resolvePendingRequest hijyeni (N2)', () => {
    function bekleyenIstek() {
        const respond = vi.fn()
        dapp.pendingRequests.set('id-h', { sendResponse: respond, windowId: 3 })
        localStore.current_request = { type: 'SIGN_MESSAGE', id: 'id-h' }
        return respond
    }

    it('error: null -> -32603 (dapp `undefined` gormez)', async () => {
        const respond = bekleyenIstek()
        await dapp.resolvePendingRequest({ requestId: 'id-h', status: 'error', error: null })

        expect(respond).toHaveBeenCalledWith({ error: { code: -32603, message: expect.any(String) } })
        expect(dapp.pendingRequests.size).toBe(0)
        expect(localStore.current_request).toBeUndefined()
    })

    it('kodsuz hata NESNESI -> -32603 (mesaj korunur)', async () => {
        const respond = bekleyenIstek()
        await dapp.resolvePendingRequest({ requestId: 'id-h', status: 'error', error: { message: 'boom' } })

        expect(respond).toHaveBeenCalledWith({ error: { code: -32603, message: 'boom' } })
    })

    it('tamsayi kodlu hata nesnesi AYNEN gecer (4001 kullanici reddi)', async () => {
        const respond = bekleyenIstek()
        const error = { code: 4001, message: 'User rejected the request.' }
        await dapp.resolvePendingRequest({ requestId: 'id-h', status: 'error', error })

        expect(respond).toHaveBeenCalledWith({ error })
    })

    it('metin hata (eski ekranlar) 4001 olarak gecer; hata hic verilmezse varsayilan 4001', async () => {
        let respond = bekleyenIstek()
        await dapp.resolvePendingRequest({ requestId: 'id-h', status: 'error', error: 'nope' })
        expect(respond).toHaveBeenCalledWith({ error: { code: 4001, message: 'nope' } })

        respond = bekleyenIstek()
        await dapp.resolvePendingRequest({ requestId: 'id-h', status: 'error' })
        expect(respond).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request rejected by user' } })
    })

    it('success + `data` YOK -> firlatmaz, -32603 doner, istek ASKIDA kalmaz', async () => {
        const respond = bekleyenIstek()
        await expect(dapp.resolvePendingRequest({ requestId: 'id-h', status: 'success' })).resolves.toBeUndefined()

        expect(respond).toHaveBeenCalledWith({ error: { code: -32603, message: expect.any(String) } })
        expect(dapp.pendingRequests.size).toBe(0)
        expect(localStore.current_request).toBeUndefined()
    })

    it('success + `data.result` tanimsiz -> -32603 (dapp `undefined` ile cozulmez)', async () => {
        const respond = bekleyenIstek()
        await dapp.resolvePendingRequest({ requestId: 'id-h', status: 'success', data: {} })

        expect(respond).toHaveBeenCalledWith({ error: { code: -32603, message: expect.any(String) } })
    })

    it('success + `data.result: null` GECERLI sonuctur (wallet_switchEthereumChain)', async () => {
        const respond = bekleyenIstek()
        await dapp.resolvePendingRequest({ requestId: 'id-h', status: 'success', data: { result: null } })

        expect(respond).toHaveBeenCalledWith({ result: null })
    })
})

// -- T8 / N7 (2): ret sonrasi geri cekilme kablolamasi (T4a sozlesmesi) --
//
// `approvalThrottle.noteApprovalRejected(origin)` YALNIZ GERCEK kullanici retlerinde
// cagrilir: kullanicinin Reddet dugmesine basmasi (acik 4001) ya da onay penceresini
// KENDISININ kapatmasi. Cagirmayanlar: AYNI origin'in yeni isteginin eskisini 4001 ile
// EZMESI (dapp'in hizli yeniden denemesi kendi kendini engellemesin), programatik ret
// (izin kaybi), imza/pencere hatalari ve basari.
describe('geri cekilme kablolamasi: noteApprovalRejected YALNIZ gercek kullanici retlerinde', () => {
    const ORIGIN = 'https://dapp.example'

    async function yukle() {
        const listeners = []
        chrome.windows.onRemoved = { addListener: (fn) => listeners.push(fn) }
        vi.resetModules()
        dapp = await import('./dappFunctions')
        const { noteApprovalRejected } = await import('./approvalThrottle')
        noteApprovalRejected.mockReset()
        return { listeners, noteApprovalRejected }
    }

    async function bekleyenImza(respond = vi.fn()) {
        await dapp.signMessageDapp({ params: ['msg', GRANTED] }, sender, respond)
        return { respond, id: localStore.current_request.id }
    }

    it('Reddet dugmesi (acik 4001) -> noteApprovalRejected(origin) TEK kez', async () => {
        const { noteApprovalRejected } = await yukle()
        const { id } = await bekleyenImza()

        await dapp.resolvePendingRequest({ requestId: id, status: 'error', error: { code: 4001, message: 'User rejected the request.' } })

        expect(noteApprovalRejected).toHaveBeenCalledOnce()
        expect(noteApprovalRejected).toHaveBeenCalledWith(ORIGIN)
    })

    it('kullanici onay penceresini KENDISI kapatir (onRemoved) -> 4001 "User closed the window." + noteApprovalRejected(origin)', async () => {
        const { listeners, noteApprovalRejected } = await yukle()
        const { respond } = await bekleyenImza()

        for (const fn of listeners) fn(7)

        expect(respond).toHaveBeenCalledWith({ error: { code: 4001, message: 'User closed the window.' } })
        expect(noteApprovalRejected).toHaveBeenCalledOnce()
        expect(noteApprovalRejected).toHaveBeenCalledWith(ORIGIN)
    })

    it('pencere BASKA bir istegin penceresiyse (eslesen kayit yok) onRemoved cagirmaz', async () => {
        const { listeners, noteApprovalRejected } = await yukle()
        await bekleyenImza()

        for (const fn of listeners) fn(999)

        expect(noteApprovalRejected).not.toHaveBeenCalled()
    })

    it('cagirMAZ: basari, kodsuz/baska kodlu hata, metin hata, hata yok, null hata', async () => {
        const { noteApprovalRejected } = await yukle()
        const durumlar = [
            { status: 'success', data: { result: '0xsig' } },
            { status: 'error', error: { code: -32603, message: 'imza hatasi' } },
            { status: 'error', error: { code: 4100, message: 'izin yok' } },
            { status: 'error', error: { message: 'kodsuz' } },
            { status: 'error', error: 'metin hata' },
            { status: 'error' },
            { status: 'error', error: null },
        ]
        for (const durum of durumlar) {
            const { id } = await bekleyenImza()
            await dapp.resolvePendingRequest({ requestId: id, ...durum })
        }

        expect(noteApprovalRejected).not.toHaveBeenCalled()
    })

    it('cagirMAZ: AYNI origin\'in yeni istegi eskisini 4001 "Request replaced" ile EZER', async () => {
        const { noteApprovalRejected } = await yukle()
        const eski = await bekleyenImza()

        await dapp.signMessageDapp({ params: ['msg2', GRANTED] }, sender, vi.fn())

        expect(eski.respond).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request replaced by a new one.' } })
        expect(noteApprovalRejected).not.toHaveBeenCalled()
    })

    it('cagirMAZ: izin kaybi reddi (rejectPendingForOrigin) ve pencere acilamamasi', async () => {
        const { noteApprovalRejected } = await yukle()
        await bekleyenImza()
        await dapp.rejectPendingForOrigin('https://dapp.example', { code: 4100, message: 'x' })

        chrome.windows.create = vi.fn(async () => { throw new Error('boom') })
        const respond = vi.fn()
        await dapp.signMessageDapp({ params: ['msg3', GRANTED] }, sender, respond)
        expect(respond).toHaveBeenCalledWith({ error: expect.objectContaining({ code: -32603 }) })

        expect(noteApprovalRejected).not.toHaveBeenCalled()
    })

    it('cagirMAZ: onRemoved, kaydi ZATEN cozulmus pencere icin (cift sayim yok)', async () => {
        const { listeners, noteApprovalRejected } = await yukle()
        const { id } = await bekleyenImza()
        await dapp.resolvePendingRequest({ requestId: id, status: 'error', error: { code: 4001, message: 'x' } })
        expect(noteApprovalRejected).toHaveBeenCalledOnce()

        for (const fn of listeners) fn(7)

        expect(noteApprovalRejected).toHaveBeenCalledOnce()
    })

    // 1.8.2 birlesimi (B1): TON kayitlari da `origin` tasir. Gonderim surerken (committed) ya da dapp
    // yanitlandiktan sonra (answered) pencere kapanirsa dapp'e 4001 GITMEZ; bu yuzden sahte bir
    // "kullanici reddetti" geri cekilmesi de yazilmaz (kapali-basarisiz kilit).
    it('cagirMAZ: onRemoved, isleme baglanan (committed) kayit icin (4001 gitmez, yanit ertelenir)', async () => {
        const { listeners, noteApprovalRejected } = await yukle()
        const yanit = vi.fn()
        await dapp.openApprovalWindow('ton-1', yanit, { type: 'TON_SEND_TX', id: 'ton-1', origin: ORIGIN })
        expect(dapp.commitPendingRequest('ton-1')).toBe(true)

        for (const fn of listeners) fn(7)

        expect(yanit).not.toHaveBeenCalled()
        expect(noteApprovalRejected).not.toHaveBeenCalled()
    })

    it('cagirMAZ: onRemoved, zaten yanitlanmis (answered) kayit icin (ikinci yanit yok)', async () => {
        const { listeners, noteApprovalRejected } = await yukle()
        const yanit = vi.fn()
        await dapp.openApprovalWindow('ton-1', yanit, { type: 'TON_SEND_TX', id: 'ton-1', origin: ORIGIN })
        await dapp.answerPendingRequest('ton-1', { error: { code: 1, message: 'x' }, id: '7' }, { keepWindow: true })

        for (const fn of listeners) fn(7)

        expect(yanit).toHaveBeenCalledTimes(1)
        expect(noteApprovalRejected).not.toHaveBeenCalled()
    })

    it('`origin` alani olmayan eski kayit icin cagirMAZ (paylasilan "Unknown" kaydini kirletmesin)', async () => {
        const { noteApprovalRejected } = await yukle()
        dapp.pendingRequests.set('legacy', { sendResponse: vi.fn(), windowId: 3 })

        await dapp.resolvePendingRequest({ requestId: 'legacy', status: 'error', error: { code: 4001, message: 'x' } })

        expect(noteApprovalRejected).not.toHaveBeenCalled()
    })
})
