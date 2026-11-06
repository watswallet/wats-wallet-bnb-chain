// BD2 -- acilista ara gorunum OLMADAN dogrudan secili para birimi.
//
// Bu dosya KAYNAK KILIDI DEGIL: `bootstrapWalletUi` GERCEKTEN calistirilir. Vue uygulamasi
// (createApp) ve para birimi deposu sahte; olculen sey SIRA: mount, deponun DISK okumasi
// bitmeden (sinir icinde) olmaz; sinir asilirsa olur; ag yenilemesi hic beklenmez.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.hoisted(() => {
    globalThis.document = {
        querySelector: () => null,
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        addEventListener: () => {},
        removeEventListener: () => {},
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
    }
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

const mocks = vi.hoisted(() => ({ mount: vi.fn(), init: vi.fn() }))

vi.mock('vue', async (importOriginal) => ({
    ...(await importOriginal()),
    createApp: () => ({ use() { return this }, mount: mocks.mount }),
}))
vi.mock('../store/currency', () => ({ currencyStore: () => ({ init: mocks.init }) }))
vi.mock('../utils/uiSync', () => ({ installUiSync: () => () => {} }))
vi.mock('../utils/popupPort', () => ({ connectPopupPort: () => {} }))

import { bootstrapWalletUi, waitAtMost, CURRENCY_INIT_WAIT_MS } from './bootstrap'
import { SURFACE_ALERT, SURFACE_PANEL, SURFACE_POPUP } from '../utils/uiSurface'

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

beforeEach(() => {
    vi.useFakeTimers()
    mocks.mount.mockReset()
    mocks.init.mockReset()
    globalThis.chrome = {
        runtime: { onMessage: { addListener: () => {} } },
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})
afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

describe('waitAtMost', () => {
    it('sinir 500 ms', () => {
        expect(CURRENCY_INIT_WAIT_MS).toBe(500)
    })

    it('promise sinirdan once bitince hemen cozulur ve zamanlayici temizlenir', async () => {
        const d = deferred()
        let bitti = false
        void waitAtMost(d.promise, 500).then(() => { bitti = true })
        await vi.advanceTimersByTimeAsync(10)
        expect(bitti).toBe(false)
        d.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(bitti).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('promise asilmazsa sinirda cozulur (promise bitmeden)', async () => {
        const d = deferred()
        let bitti = false
        void waitAtMost(d.promise, 500).then(() => { bitti = true })
        await vi.advanceTimersByTimeAsync(499)
        expect(bitti).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(bitti).toBe(true)
    })

    it('promise reddederse de cozulur (reddetmez)', async () => {
        await expect(waitAtMost(Promise.reject(new Error('x')), 500)).resolves.toBeUndefined()
    })
})

describe('bootstrapWalletUi: mount para birimi diskini bekler', () => {
    it('disk okumasi bitmeden (sinir icinde) mount OLMAZ; bitince olur', async () => {
        const disk = deferred()
        mocks.init.mockReturnValue(disk.promise)

        const sonuc = bootstrapWalletUi({ surface: SURFACE_POPUP })
        expect(sonuc.surface).toBe(SURFACE_POPUP) // donus degeri senkron kalir

        await vi.advanceTimersByTimeAsync(499)
        expect(mocks.mount).not.toHaveBeenCalled()

        disk.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
        expect(mocks.mount).toHaveBeenCalledWith('#app')
    })

    it('panelde de ayni: disk bitmeden mount yok', async () => {
        const disk = deferred()
        mocks.init.mockReturnValue(disk.promise)
        bootstrapWalletUi({ surface: SURFACE_PANEL })
        await vi.advanceTimersByTimeAsync(100)
        expect(mocks.mount).not.toHaveBeenCalled()
        disk.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
    })

    it('500 ms asilirsa mount DEVAM EDER (init arkada biter)', async () => {
        const disk = deferred() // hic bitmiyor
        mocks.init.mockReturnValue(disk.promise)
        bootstrapWalletUi({ surface: SURFACE_POPUP })

        await vi.advanceTimersByTimeAsync(499)
        expect(mocks.mount).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(mocks.mount).toHaveBeenCalledTimes(1)

        disk.resolve() // gec bitis ikinci mount yapmaz
        await vi.advanceTimersByTimeAsync(0)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
    })

    it('init reddederse mount yine de olur', async () => {
        mocks.init.mockReturnValue(Promise.reject(new Error('disk')))
        bootstrapWalletUi({ surface: SURFACE_POPUP })
        await vi.advanceTimersByTimeAsync(0)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
    })

    it('ag yenilemesi BEKLENMEZ: init disk bitince cozulur, sonsuz ag istegi mount\'u tutmaz', async () => {
        // Gercek depo init'i agi `void` baslatip disk bitince cozulur; burada ayni sozlesme:
        // init cozulur, arkada hic bitmeyen bir "ag" suruyor.
        const ag = deferred()
        mocks.init.mockImplementation(async () => { void ag.promise })
        bootstrapWalletUi({ surface: SURFACE_POPUP })
        await vi.advanceTimersByTimeAsync(0)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
    })

    it('uyari yuzeyi: init CAGRILMAZ ve mount beklemeden hemen olur (davranis degismedi)', () => {
        bootstrapWalletUi({ surface: SURFACE_ALERT })
        expect(mocks.init).not.toHaveBeenCalled()
        expect(mocks.mount).toHaveBeenCalledTimes(1) // senkron, zamanlayici ilerletilmedi
    })
})
