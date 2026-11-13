// Islem sayaclari (counts): ping govdesi, cikarma, kuyruk ve kapilar.
//
// KOK NEDEN: sayac bir CUZDANIN icinde calisiyor ve govdeye yeni bir alan ekliyor.
// "Kapaliyken artti", "gizli hesapta artti", "ping cikarmasi araya giren artisi
// ezdi" tipi hatalar gorunmez; yalniz test yakalar. Fazla sayim kabul edilmez,
// eksik sayim kabul edilir.
import { describe, it, expect, vi } from 'vitest'
import {
    ANALYTICS_ENABLED_KEY, ANALYTICS_STATE_KEY, ANALYTICS_COUNTS_KEY,
    countAction, setAnalyticsEnabled, runAnalyticsPing,
} from './analyticsPing'

// Varsayilan: kullanici KABUL etmis (onay modeli: kayit yok = KAPALI).
function fakeStorage(initial = {}) {
    const data = { analytics_enabled: true, ...initial }
    return {
        data,
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (obj) => { Object.assign(data, obj) },
        remove: async (key) => { for (const k of [].concat(key)) delete data[k] },
    }
}
const slow = (storage) => {
    const get = storage.get
    storage.get = async (k) => { const r = await get(k); await new Promise((res) => setTimeout(res, 1)); return r }
    return storage
}

const NOW = new Date('2026-10-15T12:00:00Z')
const DAY2 = new Date('2026-10-16T01:00:00Z')
const ID = '3f2b8c1e-5a7d-4e9a-8b6c-1d2e3f4a5b6c'
const base = (over = {}) => ({ storage: fakeStorage(), post: vi.fn().mockResolvedValue({}), version: '1.9.1', locale: 'en', now: NOW, makeId: () => ID, ...over })
const withCounts = (counts, extra = {}) => fakeStorage({ [ANALYTICS_COUNTS_KEY]: counts, ...extra })
const httpError = (status) => Object.assign(new Error('http ' + status), { response: { status } })

describe('ping govdesi counts', () => {
    it('counts yokken govde AYNEN eski uc alan, pendingBatch kurulmaz', async () => {
        const o = base()
        await runAnalyticsPing(o)
        expect(Object.keys(o.post.mock.calls[0][0])).toEqual(['installId', 'version', 'locale'])
        expect(o.storage.data[ANALYTICS_STATE_KEY].pendingBatch).toBeUndefined()
    })

    it('sifir anahtarlar gonderilmez; hepsi sifirsa counts alani HIC yok', async () => {
        const a = base({ storage: withCounts({ transfer: 0, swap: 0 }) })
        await runAnalyticsPing(a)
        expect('counts' in a.post.mock.calls[0][0]).toBe(false)
        expect(a.storage.data[ANALYTICS_STATE_KEY].pendingBatch).toBeUndefined()

        const b = base({ storage: withCounts({ transfer: 2, swap: 0 }) })
        await runAnalyticsPing(b)
        expect(b.post.mock.calls[0][0].counts).toEqual({ transfer: 2 })
    })

    it('bilinmeyen/bozuk anahtar ve degerler govdeye girmez; 10000 ustu kirpilir', async () => {
        const o = base({ storage: withCounts({ transfer: 1, adres: 5, swap: -1, bridge: 1.5, walletImport: '3', walletCreate: 20000 }) })
        await runAnalyticsPing(o)
        expect(o.post.mock.calls[0][0].counts).toEqual({ transfer: 1, walletCreate: 10000 })
    })

    it('basarida ANLIK DEGER cikarilir, gonderim sirasinda gelen artis korunur', async () => {
        const storage = withCounts({ transfer: 2, swap: 1 })
        const post = vi.fn().mockImplementation(async () => {
            storage.data[ANALYTICS_COUNTS_KEY] = { transfer: 3, swap: 1, bridge: 1 }
        })
        await runAnalyticsPing(base({ storage, post }))
        expect(post.mock.calls[0][0].counts).toEqual({ transfer: 2, swap: 1 })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ transfer: 1, bridge: 1 })
        expect(storage.data[ANALYTICS_STATE_KEY]).toEqual({ installId: ID, lastPingDay: '2026-10-15' })
    })

    it('hepsi cikarilinca sayac BOS NESNE olur (tek atomik yazim; silme ikinci adim olurdu)', async () => {
        const o = base({ storage: withCounts({ transfer: 2 }) })
        await runAnalyticsPing(o)
        expect(o.storage.data[ANALYTICS_COUNTS_KEY]).toEqual({})
    })

    it('ag hatasi: sayac DOKUNULMAZ, pendingBatch saklanir', async () => {
        const o = base({ storage: withCounts({ transfer: 2 }), post: vi.fn().mockRejectedValue(new Error('offline')) })
        await runAnalyticsPing(o)
        expect(o.storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ transfer: 2 })
        expect(o.storage.data[ANALYTICS_STATE_KEY].pendingBatch).toEqual({ day: '2026-10-15', counts: { transfer: 2 } })
    })

    it('ayni gun yeniden denemede AYNI goruntu gider (guncel sayac degil)', async () => {
        const o = base({ storage: withCounts({ transfer: 2 }), post: vi.fn().mockRejectedValue(new Error('offline')) })
        await runAnalyticsPing(o)
        o.storage.data[ANALYTICS_COUNTS_KEY] = { transfer: 5, swap: 1 }
        o.post.mockResolvedValue({})
        await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 31 * 60 * 1000) })
        expect(o.post.mock.calls[1][0].counts).toEqual({ transfer: 2 })
        expect(o.storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ transfer: 3, swap: 1 })
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toEqual({ installId: ID, lastPingDay: '2026-10-15' })
    })

    it('kalici 4xx: pendingBatch korunur, sayac dokunulmaz', async () => {
        const o = base({ storage: withCounts({ swap: 1 }), post: vi.fn().mockRejectedValue(httpError(400)) })
        await runAnalyticsPing(o)
        expect(o.storage.data[ANALYTICS_STATE_KEY].pendingBatch).toEqual({ day: '2026-10-15', counts: { swap: 1 } })
        expect(o.storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ swap: 1 })
    })

    it('UTC gunu degisince eski parti ATILIR, goruntusu sayactan cikarilir, yeni parti gonderilir', async () => {
        const o = base({ storage: withCounts({ transfer: 2 }), post: vi.fn().mockRejectedValue(new Error('offline')) })
        await runAnalyticsPing(o)
        o.storage.data[ANALYTICS_COUNTS_KEY] = { transfer: 3, bridge: 1 }
        o.post.mockResolvedValue({})
        await runAnalyticsPing({ ...o, now: DAY2 })
        expect(o.post.mock.calls[1][0].counts).toEqual({ transfer: 1, bridge: 1 })
        expect(o.storage.data[ANALYTICS_COUNTS_KEY]).toEqual({})
    })

    it('kapatinca sayac ve parti de SILINIR', async () => {
        const storage = withCounts({ transfer: 2 }, { [ANALYTICS_STATE_KEY]: { installId: ID, pendingBatch: { day: '2026-10-15', counts: { transfer: 2 } } } })
        await setAnalyticsEnabled(storage, false)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('gonderim sirasinda kapatilirsa sayac ve durum geri yazilmaz', async () => {
        const storage = withCounts({ transfer: 2 })
        const post = vi.fn().mockImplementation(async () => {
            storage.data[ANALYTICS_ENABLED_KEY] = false
            delete storage.data[ANALYTICS_STATE_KEY]
        })
        await runAnalyticsPing(base({ storage, post }))
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('gonderim sirasinda kapatilir ve ag hatasi olursa sayac da silinir', async () => {
        const storage = withCounts({ transfer: 2 })
        const post = vi.fn().mockImplementation(async () => {
            storage.data[ANALYTICS_ENABLED_KEY] = false
            throw new Error('offline')
        })
        await runAnalyticsPing(base({ storage, post }))
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('gizli hesapta istek gitmez', async () => {
        const o = base({ storage: withCounts({ transfer: 2 }, { active_account: { private: true } }) })
        await runAnalyticsPing(o)
        expect(o.post).not.toHaveBeenCalled()
    })
})

describe('countAction', () => {
    it('artirir, kaba basina 10000 sinirinda durur', async () => {
        const storage = fakeStorage()
        expect(await countAction({ storage, kind: 'transfer' })).toBe(true)
        await countAction({ storage, kind: 'transfer' })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ transfer: 2 })
        storage.data[ANALYTICS_COUNTS_KEY] = { transfer: 10000 }
        await countAction({ storage, kind: 'transfer' })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ transfer: 10000 })
    })

    it.each([
        ['derleme bayragi kapali', { buildEnabled: false }, {}],
        ['kullanici kapatmis', {}, { [ANALYTICS_ENABLED_KEY]: false }],
        ['gizli hesap', {}, { active_account: { private: true } }],
    ])('%s: HICBIR sey yazilmaz', async (_ad, opts, initial) => {
        const storage = fakeStorage(initial)
        const set = vi.spyOn(storage, 'set')
        expect(await countAction({ storage, kind: 'swap', ...opts })).toBe(false)
        expect(set).not.toHaveBeenCalled()
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
    })

    it('bilinmeyen kaba reddedilir', async () => {
        const storage = fakeStorage()
        expect(await countAction({ storage, kind: 'dapp' })).toBe(false)
        expect(await countAction({ storage, kind: undefined })).toBe(false)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
    })

    it('eszamanli cagrilar seri kuyruktan gecer: kayip artis yok', async () => {
        const storage = slow(fakeStorage())
        await Promise.all(Array.from({ length: 20 }, () => countAction({ storage, kind: 'swap' })))
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ swap: 20 })
    })

    it('ping cikarmasi ile eszamanli artis birbirini EZMEZ: gonderilen + kalan = toplam', async () => {
        const storage = slow(withCounts({ transfer: 2 }))
        const o = base({ storage })
        await Promise.all([
            runAnalyticsPing(o),
            countAction({ storage, kind: 'transfer' }),
            countAction({ storage, kind: 'bridge' }),
        ])
        const sent = o.post.mock.calls[0][0].counts || {}
        const left = storage.data[ANALYTICS_COUNTS_KEY] || {}
        expect((sent.transfer || 0) + (left.transfer || 0)).toBe(3)
        expect((sent.bridge || 0) + (left.bridge || 0)).toBe(1)
    })

    it('depolama hatasi FIRLATMAZ', async () => {
        const storage = fakeStorage()
        storage.get = async () => { throw new Error('boom') }
        await expect(countAction({ storage, kind: 'swap' })).resolves.toBe(false)
    })
})
