// Gunluk kullanim istatistigi ping'i: kapilar ve kalicilik.
//
// KOK NEDEN: bu kod bir CUZDANIN icinde calisiyor; "kullanici kapatti ama yine de
// gitti" veya "gizli hesapta gitti" tipi hatalar guven kaybi demek ve kullanici
// tarafindan GORUNMEZ -- yalniz test yakalar. Bu yuzden her kapi icin ayri bir
// "istek GITMEDI" iddiasi var.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    ANALYTICS_ENABLED_KEY, ANALYTICS_STATE_KEY,
    utcDay, pingLocale, shouldPing, setAnalyticsEnabled, readAnalyticsEnabled, runAnalyticsPing,
    countAction, ANALYTICS_COUNTS_KEY,
} from './analyticsPing'

// Varsayilan: kullanici KABUL etmis (analytics_enabled=true); karar-yok senaryosu icin
// `kabul: false` verilir (onay modeli: kayit yok = KAPALI).
function fakeStorage(initial = {}, { kabul = true } = {}) {
    const data = { ...(kabul ? { analytics_enabled: true } : {}), ...initial }
    return {
        data,
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (obj) => { Object.assign(data, obj) },
        remove: async (key) => { delete data[key] },
    }
}

const NOW = new Date('2026-10-15T12:00:00Z')
const ID = '3f2b8c1e-5a7d-4e9a-8b6c-1d2e3f4a5b6c'
const base = (over = {}) => ({ storage: fakeStorage(), post: vi.fn().mockResolvedValue({}), version: '1.9.1', locale: 'en', now: NOW, makeId: () => ID, ...over })

describe('shouldPing', () => {
    const ok = { enabled: true, privateMode: false, lastPingDay: '2026-10-14', today: '2026-10-15' }
    it('kabul edildi (true) -> true', () => expect(shouldPing(ok)).toBe(true))
    it('KARAR YOK (kayit yok) = KAPALI -> false', () => expect(shouldPing({ ...ok, enabled: undefined })).toBe(false))
    it('bozuk deger (true degil) -> false', () => expect(shouldPing({ ...ok, enabled: 'true' })).toBe(false))
    it('kapali -> false', () => expect(shouldPing({ ...ok, enabled: false })).toBe(false))
    it('gizli mod -> false', () => expect(shouldPing({ ...ok, privateMode: true })).toBe(false))
    it('bugun zaten gonderildi -> false', () => expect(shouldPing({ ...ok, lastPingDay: '2026-10-15' })).toBe(false))
})

describe('pingLocale / utcDay', () => {
    it('gecerli yerel adi gecirir', () => expect(pingLocale('en-US')).toBe('en-US'))
    it('gecersiz/bos -> en', () => {
        expect(pingLocale(undefined)).toBe('en')
        expect(pingLocale('x'.repeat(40))).toBe('en')
    })
    it('UTC gunu', () => expect(utcDay(new Date('2026-10-15T23:59:59Z'))).toBe('2026-10-15'))
})

describe('karar verilmeden (analytics_enabled kayitsiz) hicbir sey olmaz', () => {
    it('ping gitmez, kimlik uretilmez, depoya yazilmaz', async () => {
        const o = base({ storage: fakeStorage({}, { kabul: false }) })
        const r = await runAnalyticsPing(o)
        expect(r).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.storage.data).toEqual({})
    })
    it('countAction sayac yazmaz', async () => {
        const storage = fakeStorage({}, { kabul: false })
        expect(await countAction({ storage, kind: 'transfer' })).toBe(false)
        expect(storage.data).toEqual({})
    })
    it('readAnalyticsEnabled kayitsizken false, kabulde true', async () => {
        expect(await readAnalyticsEnabled(fakeStorage({}, { kabul: false }))).toBe(false)
        expect(await readAnalyticsEnabled(fakeStorage())).toBe(true)
    })
})

describe('runAnalyticsPing', () => {
    it('ilk calisma: kimlik uretir, govdede YALNIZ 3 alan, durumu kaydeder', async () => {
        const o = base()
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: true })
        expect(o.post).toHaveBeenCalledTimes(1)
        expect(o.post).toHaveBeenCalledWith({ installId: ID, version: '1.9.1', locale: 'en' })
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toEqual({ installId: ID, lastPingDay: '2026-10-15' })
    })

    it('ayni gun ikinci cagri istek ATMAZ', async () => {
        const o = base()
        await runAnalyticsPing(o)
        const r = await runAnalyticsPing(o)
        expect(r).toEqual({ sent: false })
        expect(o.post).toHaveBeenCalledTimes(1)
    })

    it('ertesi gun ayni kimlikle tekrar gonderir', async () => {
        const o = base()
        await runAnalyticsPing(o)
        await runAnalyticsPing({ ...o, now: new Date('2026-10-16T01:00:00Z'), makeId: () => 'degismemeli' })
        expect(o.post).toHaveBeenCalledTimes(2)
        expect(o.post.mock.calls[1][0].installId).toBe(ID)
    })

    it('kapaliyken istek GITMEZ ve kimlik uretilmez', async () => {
        const o = base({ storage: fakeStorage({ [ANALYTICS_ENABLED_KEY]: false }) })
        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('gizli hesap aktifken istek GITMEZ ve kimlik uretilmez', async () => {
        const o = base({ storage: fakeStorage({ active_account: { private: true } }) })
        expect(await runAnalyticsPing(o)).toEqual({ sent: false })
        expect(o.post).not.toHaveBeenCalled()
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('ag hatasinda FIRLATMAZ, lastPingDay ilerlemez, kimlik ve deneme ani kalici', async () => {
        const o = base({ post: vi.fn().mockRejectedValue(new Error('offline')) })
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: false, error: true })
        expect(o.storage.data[ANALYTICS_STATE_KEY].installId).toBe(ID)
        expect(o.storage.data[ANALYTICS_STATE_KEY].lastPingDay).toBeUndefined()
        expect(o.storage.data[ANALYTICS_STATE_KEY].lastAttemptAt).toBe(NOW.getTime())

        // 30 dk dolunca ayni kimlikle yeniden gonderir.
        o.post.mockResolvedValue({})
        const again = await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 31 * 60 * 1000), makeId: () => 'degismemeli' })
        expect(again).toEqual({ sent: true })
        expect(o.post).toHaveBeenLastCalledWith({ installId: ID, version: '1.9.1', locale: 'en' })
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toEqual({ installId: ID, lastPingDay: '2026-10-15' })
    })

    it('ag hatasindan sonra 30 dk dolmadan yeniden DENEMEZ (SW dakikada bir dogsa bile)', async () => {
        const o = base({ post: vi.fn().mockRejectedValue(new Error('offline')) })
        await runAnalyticsPing(o)

        const again = await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 10 * 60 * 1000) })
        expect(again).toEqual({ sent: false })
        expect(o.post).toHaveBeenCalledTimes(1)
    })

    it('gonderim SIRASINDA kapatilirsa kimlik geri yazilmaz ve durum silinir', async () => {
        const storage = fakeStorage()
        // Kullanici ping YOLDAYKEN ayarlardan kapatir (setAnalyticsEnabled(false) ile
        // ayni etki): tercih kapanir ve gonderim oncesi yazilan durum silinir.
        const post = vi.fn().mockImplementation(async () => {
            storage.data[ANALYTICS_ENABLED_KEY] = false
            delete storage.data[ANALYTICS_STATE_KEY]
        })
        const r = await runAnalyticsPing(base({ storage, post }))

        expect(r).toEqual({ sent: true })
        expect(post).toHaveBeenCalledTimes(1)
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('gonderim SIRASINDA kapatilir VE gonderim ag hatasiyla biterse de durum silinir', async () => {
        const storage = fakeStorage()
        // Kullanici ping yoldayken kapatir, gonderim de basarisiz olur: kapatma kimligi
        // silmisti ama gonderim oncesi yazim onu geri getirmisti; catch dalinda da
        // kapali kontrolu yapilmazsa kimlik kapali kullanicida kalirdi.
        const post = vi.fn().mockImplementation(async () => {
            storage.data[ANALYTICS_ENABLED_KEY] = false
            delete storage.data[ANALYTICS_STATE_KEY]
            throw new Error('offline')
        })
        const r = await runAnalyticsPing(base({ storage, post }))

        expect(r).toEqual({ sent: false, error: true })
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('lastAttemptAt gelecekteyse (saat geri alinmis) bekleme UYGULANMAZ, ping gider', async () => {
        const o = base({ storage: fakeStorage({ [ANALYTICS_STATE_KEY]: { installId: ID, lastAttemptAt: NOW.getTime() + 60 * 60 * 1000 } }) })
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: true })
        expect(o.post).toHaveBeenCalledTimes(1)
        expect(o.post).toHaveBeenCalledWith({ installId: ID, version: '1.9.1', locale: 'en' })
    })

    // Kalici 4xx: sozlesme kaymasi / uc kaldirilmis olabilir; tum filo 30 dk'da bir
    // vurmasin diye 24 saat beklenir. Gecici hatalar (yanitsiz, 5xx, 408, 429) 30 dk.
    const HOUR = 60 * 60 * 1000
    const httpError = (status) => Object.assign(new Error('http ' + status), { response: { status } })

    it('kalici 4xx (400): permanent doner, retryNotBefore = simdi + 24 saat, kimlik ve gun korunur', async () => {
        const o = base({
            storage: fakeStorage({ [ANALYTICS_STATE_KEY]: { installId: ID, lastPingDay: '2026-10-14' } }),
            post: vi.fn().mockRejectedValue(httpError(400)),
        })
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: false, error: true, permanent: true })
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toEqual({
            installId: ID,
            lastPingDay: '2026-10-14',
            lastAttemptAt: NOW.getTime(),
            retryNotBefore: NOW.getTime() + 24 * HOUR,
        })
    })

    it('kalici ret sonrasi 23 saat dolmadan istek GITMEZ', async () => {
        const o = base({ post: vi.fn().mockRejectedValue(httpError(403)) })
        await runAnalyticsPing(o)

        const again = await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 23 * HOUR) })
        expect(again).toEqual({ sent: false })
        expect(o.post).toHaveBeenCalledTimes(1)
    })

    it('kalici ret sonrasi 24 saat + 1 dk gecince istek GIDER', async () => {
        const o = base({ post: vi.fn().mockRejectedValue(httpError(404)) })
        await runAnalyticsPing(o)

        o.post.mockResolvedValue({})
        const again = await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 24 * HOUR + 60 * 1000) })
        expect(again).toEqual({ sent: true })
        expect(o.post).toHaveBeenCalledTimes(2)
    })

    it.each([429, 408, 503])('gecici hata (%i): permanent YOK, 30 dk davranisi', async (status) => {
        const o = base({ post: vi.fn().mockRejectedValue(httpError(status)) })
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: false, error: true })
        expect(o.storage.data[ANALYTICS_STATE_KEY].retryNotBefore).toBeUndefined()

        expect(await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 10 * 60 * 1000) })).toEqual({ sent: false })
        o.post.mockResolvedValue({})
        expect(await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 31 * 60 * 1000) })).toEqual({ sent: true })
    })

    it('yanitsiz hata (ag yok): permanent YOK, 30 dk davranisi', async () => {
        const o = base({ post: vi.fn().mockRejectedValue(new Error('Network Error')) })
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: false, error: true })
        expect(o.storage.data[ANALYTICS_STATE_KEY].retryNotBefore).toBeUndefined()
        expect(await runAnalyticsPing({ ...o, now: new Date(NOW.getTime() + 10 * 60 * 1000) })).toEqual({ sent: false })
    })

    it('retryNotBefore 48 saat ilerideyse (saat geri alinmis) yok sayilir ve istek gider', async () => {
        const o = base({ storage: fakeStorage({ [ANALYTICS_STATE_KEY]: { installId: ID, retryNotBefore: NOW.getTime() + 48 * HOUR } }) })
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: true })
        expect(o.post).toHaveBeenCalledTimes(1)
    })

    it('basarida retryNotBefore temizlenir', async () => {
        const o = base({ storage: fakeStorage({ [ANALYTICS_STATE_KEY]: { installId: ID, retryNotBefore: NOW.getTime() - 1000 } }) })
        const r = await runAnalyticsPing(o)

        expect(r).toEqual({ sent: true })
        expect(o.storage.data[ANALYTICS_STATE_KEY]).toEqual({ installId: ID, lastPingDay: '2026-10-15' })
    })

    it('kalici 4xx (403) + gonderim sirasinda kapatma: durum silinir, permanent yok', async () => {
        const storage = fakeStorage()
        const post = vi.fn().mockImplementation(async () => {
            storage.data[ANALYTICS_ENABLED_KEY] = false
            delete storage.data[ANALYTICS_STATE_KEY]
            throw httpError(403)
        })
        const r = await runAnalyticsPing(base({ storage, post }))

        expect(r).toEqual({ sent: false, error: true })
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('bozuk durum kaydi (dize) coker degil, yeni kimlik uretir', async () => {
        const o = base({ storage: fakeStorage({ [ANALYTICS_STATE_KEY]: 'bozuk' }) })
        expect(await runAnalyticsPing(o)).toEqual({ sent: true })
    })
})

describe('setAnalyticsEnabled', () => {
    it('kapatinca kimligi SILER; yeniden acinca yeni kimlik gerekir', async () => {
        const storage = fakeStorage({ [ANALYTICS_STATE_KEY]: { installId: ID, lastPingDay: '2026-10-15' } })
        await setAnalyticsEnabled(storage, false)

        expect(storage.data[ANALYTICS_ENABLED_KEY]).toBe(false)
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
        expect(await readAnalyticsEnabled(storage)).toBe(false)

        await setAnalyticsEnabled(storage, true)
        expect(await readAnalyticsEnabled(storage)).toBe(true)
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('kayit yokken readAnalyticsEnabled true', async () => {
        expect(await readAnalyticsEnabled(fakeStorage())).toBe(true)
    })
})

describe('sunucu ile sozlesme', () => {
    // KOPYA MANTIK: istemci LOCALE regex'i sunucudakinin kopyasi. Biri degisip digeri
    // degismezse ping 400 ile REDDEDILIR ve istemci hatayi yuttugu icin kimse gormez.
    it('LOCALE regex sunucudakiyle AYNI', () => {
        const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const al = (kaynak) => kaynak.match(/^const LOCALE = (\/.*\/)\s*$/m)?.[1]
        const istemci = al(oku('./analyticsPing.js'))
        expect(istemci).toBeTruthy()
        expect(istemci).toBe(al(oku('../../../server/utils/analytics.js')))
    })
})

// --- Kesinti (service worker olumu) ve kapatma yarisi ---------------------------------
// Her yazim cagrisi (set/remove) bir "adim"dir. `olum` adiminda ve sonrasinda yazim
// firlatir: SW o adimdan once oldu. Veri kalici, kod yeniden baslar.
function olumluDepo(taban, olum) {
    const s = { ...taban } // ayni `data` nesnesini paylasir
    let adim = 0
    const gec = () => { if (adim++ >= olum) throw new Error('sw olu') }
    const { set, remove } = s
    s.set = async (o) => { gec(); return set(o) }
    s.remove = async (k) => { gec(); return remove(k) }
    return s
}
const toplam = (posts) => posts.reduce((a, c) => { for (const k of Object.keys(c)) a[k] = (a[k] || 0) + c[k]; return a }, {})
const GUN1 = new Date('2026-10-15T12:00:00Z')
const GUN2 = new Date('2026-10-16T12:00:00Z')
const GUN3 = new Date('2026-10-17T12:00:00Z')

describe('kesinti: fazla sayim yolu yok', () => {
    // Gercek sayilar: ust sinir. Gun degisimi senaryosunda aradaki artis ile 5/2, digerinde 3/1.
    const senaryolar = {
        'basari + gun degisimi': async (veri, olum, posts) => {
            // Gun 1: ag hatasi -> pendingBatch kalir. Gun 2: basari yolu, olum adimi olum.
            const hata = { storage: fakeStorage(veri), post: vi.fn().mockRejectedValue(new Error('ag')), version: '1', locale: 'en', now: GUN1, makeId: () => ID }
            await runAnalyticsPing(hata)
            const kalici = hata.storage.data
            kalici[ANALYTICS_COUNTS_KEY] = { transfer: 5, swap: 2 } // aradaki artis
            const post = async (b) => { if (b.counts) posts.push(b.counts) }
            const o = { storage: olumluDepo(hata.storage, olum), post, version: '1', locale: 'en', now: GUN2, makeId: () => ID }
            await runAnalyticsPing(o).catch(() => {})
            return kalici
        },
        'gun degisimi, yanit kayip': async (veri, olum, posts) => {
            // Gun 1: sunucu aldi (posts'a girer) ama yanit kayboldu. Aradaki artis YOK.
            const post1 = async (b) => { if (b.counts) posts.push(b.counts); throw new Error('yanit kayip') }
            const hata = { storage: fakeStorage(veri), post: post1, version: '1', locale: 'en', now: GUN1, makeId: () => ID }
            await runAnalyticsPing(hata)
            const post = async (b) => { if (b.counts) posts.push(b.counts) }
            await runAnalyticsPing({ storage: olumluDepo(hata.storage, olum), post, version: '1', locale: 'en', now: GUN2, makeId: () => ID }).catch(() => {})
            return hata.storage.data
        },
        'ayni gun basari': async (veri, olum, posts) => {
            const post = async (b) => { if (b.counts) posts.push(b.counts) }
            const ilk = fakeStorage(veri)
            // pendingBatch'i bugun icin kur (ag hatasi), sonra basari yolunu kes.
            await runAnalyticsPing({ storage: ilk, post: vi.fn().mockRejectedValue(new Error('ag')), version: '1', locale: 'en', now: GUN1, makeId: () => ID })
            const o = { storage: olumluDepo(ilk, olum), post, version: '1', locale: 'en', now: new Date(GUN1.getTime() + 3600e3), makeId: () => ID }
            await runAnalyticsPing(o).catch(() => {})
            return ilk.data
        },
    }
    for (const [ad, kos] of Object.entries(senaryolar)) {
        const ust = ad === 'basari + gun degisimi' ? { transfer: 5, swap: 2 } : { transfer: 3, swap: 1 }
        it(`${ad}: hangi adimda olursa olsun ayni sayi iki kez gitmez`, async () => {
            for (let olum = 0; olum <= 6; olum++) {
                const posts = []
                const veri = { [ANALYTICS_COUNTS_KEY]: { transfer: 3, swap: 1 } }
                const kalici = await kos(veri, olum, posts)
                // Yeniden baslayan SW: sonraki gunler normal calisir.
                const post = async (b) => { if (b.counts) posts.push(b.counts) }
                const dev = fakeStorage(kalici)
                for (const now of [GUN3, new Date(GUN3.getTime() + 86400e3)]) {
                    await runAnalyticsPing({ storage: dev, post, version: '1', locale: 'en', now, makeId: () => ID })
                }
                const t = toplam(posts)
                expect(t.transfer || 0, `olum=${olum}`).toBeLessThanOrEqual(ust.transfer)
                expect(t.swap || 0, `olum=${olum}`).toBeLessThanOrEqual(ust.swap)
            }
        })
    }
})

describe('kapatma yarisi', () => {
    it('kuyruktaki countAction kapatmadan SONRA sayac birakmaz', async () => {
        const storage = fakeStorage({ [ANALYTICS_COUNTS_KEY]: { swap: 1 }, analytics_state: { installId: ID } })
        const get = storage.get
        let kapi
        const bekler = new Promise((r) => { kapi = r })
        let ilk = true
        storage.get = async (k) => { const v = await get(k); if (ilk) { ilk = false; await bekler } return v }
        const sayim = countAction({ storage, kind: 'transfer' }) // enabled okundu (acik), yazim bekliyor
        await Promise.resolve()
        storage.set({ [ANALYTICS_ENABLED_KEY]: false }) // kullanici baska baglamdan kapatti
        const kapat = setAnalyticsEnabled(storage, false)
        kapi()
        await sayim; await kapat
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('ucustaki ping kapatmadan sonra basari yazimiyla kimlik/sayac geri getirmez', async () => {
        const storage = fakeStorage({ [ANALYTICS_COUNTS_KEY]: { swap: 2 } })
        let kapat
        const post = async () => { kapat = setAnalyticsEnabled(storage, false); await kapat }
        await runAnalyticsPing({ storage, post, version: '1', locale: 'en', now: NOW, makeId: () => ID })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })

    it('kapatma kontrolu ile basari yazimi arasina giren kapatma da temizlenir', async () => {
        const storage = fakeStorage({ [ANALYTICS_COUNTS_KEY]: { swap: 2 } })
        const get = storage.get
        let n = 0
        // Ping'in 3. okumasi (gonderim sonrasi kapatma kontrolu) sonrasinda kullanici kapatir.
        storage.get = async (k) => {
            const v = await get(k)
            if (++n === 3) { storage.data[ANALYTICS_ENABLED_KEY] = false; void setAnalyticsEnabled(storage, false) }
            return v
        }
        await runAnalyticsPing({ storage, post: async () => {}, version: '1', locale: 'en', now: NOW, makeId: () => ID })
        await new Promise((r) => setTimeout(r, 5))
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
    })
})
