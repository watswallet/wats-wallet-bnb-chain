// B2: ag/hesap uyusmazligi UYARI penceresi -- arka plan tarafi (utils/tonAlert.js).
//
// Pencere onay penceresi DEGILDIR: openApprovalWindow'dan gecmez (bekleyen bir
// onayi 300'le iptal ederdi), pendingRequests'e ve current_request'e dokunmaz.
// Sayfa spam'ine karsi: ayni anda tek pencere, host basina 10 sn'de bir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SAYFA_URL = 'chrome-extension://x/src/popup/index.html#alert'

// Bir makro gorev: zincirdeki (sahte, hemen cozulen) chrome cagrilarinin hepsi biter.
const bosalt = () => new Promise((r) => setTimeout(r, 0))

function kurChrome({ depo = {}, pencereler = [], sonOdak = { width: 1200, left: 0, top: 0 } } = {}) {
    const store = { ...depo }
    // id -> { id, tabs }
    const acik = new Map(pencereler.map((w) => [w.id, w]))
    let sonId = 100
    let odak = sonOdak
    const kaldirmaDinleyicileri = []
    const yazilanAnahtarlar = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => { yazilanAnahtarlar.push(...Object.keys(obj)); Object.assign(store, obj) },
                remove: async (k) => { for (const a of (Array.isArray(k) ? k : [k])) delete store[a] },
            },
        },
        windows: {
            create: vi.fn(async (opts) => {
                const id = ++sonId
                acik.set(id, { id, tabs: [{ url: opts.url }] })
                return { id }
            }),
            get: vi.fn(async (id, opts) => {
                const w = acik.get(id)
                if (!w) throw new Error(`No window with id: ${id}.`)
                return opts?.populate ? w : { id }
            }),
            update: vi.fn(async () => ({})),
            remove: vi.fn(async () => {}),
            getLastFocused: async () => odak,
            onRemoved: { addListener: (fn) => kaldirmaDinleyicileri.push(fn) },
        },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return {
        store,
        acik,
        yazilanAnahtarlar,
        // Son odaklanan pencere (uyari onun sag ust kosesine yerlesir).
        odakla: (w) => { odak = w },
        // Kullanici pencereyi X ile kapatti: Chrome onRemoved'i atar.
        kapat: async (id) => {
            acik.delete(id)
            for (const fn of kaldirmaDinleyicileri) fn(id)
            await bosalt()
        },
    }
}

const AG = { kind: 'network', hostname: 'app.dedust.io', appName: 'DeDust', requested: '-3', expected: '-239' }
const FROM = {
    kind: 'from', hostname: 'b.example', appName: 'B',
    requested: '0:9999999999999999999999999999999999999999999999999999999999999999',
    expected: '0:1111111111111111111111111111111111111111111111111111111111111111',
    network: '-239',
}

let tonAlert
async function yukle() {
    tonAlert = await import('./tonAlert.js')
    return tonAlert
}

beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete globalThis.chrome
})

describe('showTonAlert -- pencere', () => {
    it('ilk uyari ton_alert yazar ve #alert rotasinda TEK pencere acar', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()

        await showTonAlert(AG)

        expect(chrome.windows.create).toHaveBeenCalledTimes(1)
        const secenek = chrome.windows.create.mock.calls[0][0]
        expect(secenek.url).toBe(SAYFA_URL)
        expect(secenek.type).toBe('popup')
        expect(secenek.focused).toBe(true)
        expect(secenek.width).toBe(360)
        const id = [...c.acik.keys()][0]
        expect(c.store.ton_alert).toMatchObject({
            kind: 'network', hostname: 'app.dedust.io', appName: 'DeDust',
            requested: '-3', expected: '-239', windowId: id,
        })
        expect(typeof c.store.ton_alert.id).toBe('string')
        expect(c.store.ton_alert.createdAt).toBe(Date.now())
    })

    it('pencere acikken BASKA host: yeni pencere yok, kayit guncellenir, pencere odaklanir', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()

        await showTonAlert(AG)
        const id = c.store.ton_alert.windowId
        const ilkKimlik = c.store.ton_alert.id
        await showTonAlert(FROM)

        expect(chrome.windows.create).toHaveBeenCalledTimes(1)
        expect(c.store.ton_alert).toMatchObject({ kind: 'from', hostname: 'b.example', windowId: id, network: '-239' })
        expect(c.store.ton_alert.id).not.toBe(ilkKimlik)
        expect(chrome.windows.update).toHaveBeenCalledWith(id, { focused: true })
    })

    it('es zamanli iki uyumsuzluk TEK pencere acar', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()

        await Promise.all([showTonAlert(AG), showTonAlert(FROM)])

        expect(chrome.windows.create).toHaveBeenCalledTimes(1)
        expect(c.store.ton_alert.hostname).toBe('b.example')
        expect(c.store.ton_alert.windowId).toBe([...c.acik.keys()][0])
    })

    it('pencere acilamazsa reddetmez; sonraki uyari yine denenir', async () => {
        kurChrome()
        const { showTonAlert } = await yukle()
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        chrome.windows.create.mockRejectedValueOnce(new Error('pencere yok'))

        await expect(showTonAlert(AG)).resolves.toBeUndefined()
        expect(log).toHaveBeenCalled()

        await showTonAlert(FROM)
        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
    })

    it('bilinmeyen kind icin pencere ACILMAZ', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()

        await showTonAlert({ ...AG, kind: 'switch' })

        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(c.store.ton_alert).toBeUndefined()
    })
})

describe('showTonAlert -- host basina kisma', () => {
    it('ayni host 10 sn icinde hicbir sey yapmaz; 10 sn sonra yine pencere acar', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()
        const t0 = Date.now()

        await showTonAlert(AG)
        await c.kapat(c.store.ton_alert.windowId)
        expect(c.store.ton_alert).toBeUndefined()

        vi.setSystemTime(t0 + 9999)
        await showTonAlert(AG)
        expect(chrome.windows.create).toHaveBeenCalledTimes(1)
        expect(c.store.ton_alert).toBeUndefined()

        vi.setSystemTime(t0 + 10000)
        await showTonAlert(AG)
        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
        expect(c.store.ton_alert.hostname).toBe('app.dedust.io')
    })

    // Kisma pencereyi ONE de getirmez: sayfa odagi calamaz.
    it('ayni host 10 sn icinde acik pencereyi guncellemez ve odaklamaz', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()

        await showTonAlert(AG)
        const once = { ...c.store.ton_alert }
        vi.setSystemTime(Date.now() + 5000)
        await showTonAlert({ ...AG, requested: '-42' })

        expect(c.store.ton_alert).toEqual(once)
        expect(chrome.windows.update).not.toHaveBeenCalled()
    })
})

describe('showTonAlert -- temizlik ve kalicilik', () => {
    it('uyari penceresi kapaninca ton_alert silinir; BASKA pencere kapaninca kalir', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()

        await showTonAlert(AG)
        const id = c.store.ton_alert.windowId

        await c.kapat(999)
        expect(c.store.ton_alert).toBeDefined()

        await c.kapat(id)
        expect(c.store.ton_alert).toBeUndefined()
    })

    it('SW yeniden basladiktan sonra kayitli uyari penceresi yeniden kullanilir', async () => {
        const c = kurChrome({
            depo: { ton_alert: { id: 'eski', kind: 'network', hostname: 'x.example', windowId: 55 } },
            pencereler: [{ id: 55, tabs: [{ url: SAYFA_URL }] }],
        })
        const { showTonAlert } = await yukle()

        await showTonAlert(FROM)

        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(chrome.windows.update).toHaveBeenCalledWith(55, { focused: true })
        expect(c.store.ton_alert).toMatchObject({ hostname: 'b.example', windowId: 55 })
    })

    // Tarayici yeniden baslayinca pencere kimlikleri bastan sayilir: kayitta
    // kalan eski kimlik ALAKASIZ bir pencereye denk gelebilir. O pencere one
    // getirilirse uyari hic gorunmez.
    it('kayitli windowId BASKA bir sayfaya aitse yeniden kullanilmaz', async () => {
        const c = kurChrome({
            depo: { ton_alert: { id: 'eski', kind: 'network', hostname: 'x.example', windowId: 55 } },
            pencereler: [{ id: 55, tabs: [{ url: 'https://example.com/' }] }],
        })
        const { showTonAlert } = await yukle()

        await showTonAlert(FROM)

        expect(chrome.windows.create).toHaveBeenCalledTimes(1)
        expect(chrome.windows.update).not.toHaveBeenCalled()
        expect(c.store.ton_alert.windowId).not.toBe(55)
    })

    // Kullanici pencereyi acilir acilmaz Kapat'la kapatirsa sayfa kaydi siler;
    // arka plan onu windowId yazarken DIRILTMEMELI.
    it('kayit pencere acilirken silindiyse windowId icin yeniden YAZILMAZ', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()
        const asil = chrome.windows.create.getMockImplementation()
        chrome.windows.create.mockImplementationOnce(async (opts) => {
            const w = await asil(opts)
            delete c.store.ton_alert
            return w
        })

        await showTonAlert(AG)

        expect(c.store.ton_alert).toBeUndefined()
    })

    it('current_request yazmaz, onay penceresini kapatmaz, pendingRequests e dokunmaz', async () => {
        const c = kurChrome({ depo: { current_request: { type: 'SEND_TX', id: 'evm-1' } } })
        const { pendingRequests } = await import('./dappFunctions.js')
        const bekleyen = vi.fn()
        pendingRequests.set('evm-1', { sendResponse: bekleyen, windowId: 7 })
        const { showTonAlert } = await yukle()

        await showTonAlert(AG)

        expect(c.yazilanAnahtarlar).not.toContain('current_request')
        expect(c.store.current_request).toEqual({ type: 'SEND_TX', id: 'evm-1' })
        expect(chrome.windows.remove).not.toHaveBeenCalled()
        expect(pendingRequests.get('evm-1')).toEqual({ sendResponse: bekleyen, windowId: 7 })
        expect(bekleyen).not.toHaveBeenCalled()
    })
})

describe('showTonAlert -- dapp verisi suzulur', () => {
    it('dizeler kirpilir (128, ad 64), dize olmayan deger null olur', async () => {
        const c = kurChrome()
        const { showTonAlert } = await yukle()

        await showTonAlert({ ...AG, requested: 'x'.repeat(500), appName: 'y'.repeat(200) })
        expect(c.store.ton_alert.requested).toHaveLength(128)
        expect(c.store.ton_alert.appName).toHaveLength(64)

        vi.setSystemTime(Date.now() + 10000)
        // Sayi -239 '-239' DIZESIYLE uyusmaz (opak kimlik); ekranda "TON
        // Mainnet istedi, cuzdan TON Mainnet'te" gibi celiskili bir metin cikmasin.
        await showTonAlert({ ...AG, requested: -239 })
        expect(c.store.ton_alert.requested).toBeNull()

        vi.setSystemTime(Date.now() + 10000)
        await showTonAlert({ ...FROM, hostname: AG.hostname, requested: { address: 'x' } })
        expect(c.store.ton_alert.requested).toBeNull()
    })
})

// Uyari, acik bir onay penceresiyle AYNI sag-ust capaya yerlesir. Boyu kisa
// olsaydi onayin alt seridi (Reddet / Onayla ve Gonder) acikta ve tiklanabilir
// kalirdi, ustu ise ortulurdu. Onay penceresi GERCEK openApprovalWindow ile
// acilir: iki boyuttan biri degisirse bu test kirmizi olur.
describe('showTonAlert -- acik onay penceresiyle geometri', () => {
    const TARAYICI = { id: 1, left: 100, top: 50, width: 1200, height: 900 }
    const dikdortgen = (o) => ({ left: o.left, top: o.top, width: o.width, height: o.height })
    const olusturulan = (sonek) => chrome.windows.create.mock.calls.map(([o]) => o).find((o) => o.url.endsWith(sonek))

    async function onayPenceresiAc() {
        const { openApprovalWindow } = await import('./dappFunctions.js')
        await openApprovalWindow('onay-1', vi.fn(), { type: 'TON_SEND_TX', id: 'onay-1' })
        return dikdortgen(olusturulan('#window'))
    }

    it('odak onay penceresindeyken uyari onu TAMAMEN ortler', async () => {
        const c = kurChrome({ sonOdak: TARAYICI })
        const onay = await onayPenceresiAc()
        // Onay penceresi focused:true acilir; son odak artik odur.
        c.odakla({ id: 101, ...onay })
        const { showTonAlert } = await yukle()

        await showTonAlert(AG)

        expect(dikdortgen(olusturulan('#alert'))).toEqual(onay)
    })

    it('kullanici tarayiciya donduyse de ayni dikdortgen', async () => {
        kurChrome({ sonOdak: TARAYICI })
        const onay = await onayPenceresiAc()
        const { showTonAlert } = await yukle()

        await showTonAlert(AG)

        expect(dikdortgen(olusturulan('#alert'))).toEqual(onay)
    })
})
