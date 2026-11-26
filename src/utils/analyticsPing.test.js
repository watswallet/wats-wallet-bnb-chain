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
    cleanCounts, subtractCounts, COUNT_KINDS, OLD_COUNT_KINDS, SCREEN_KEYS, NETWORK_KEYS,
    consentLevel, readAnalyticsConsentState, readAnalyticsDecided, ANALYTICS_CONSENT_VERSION, ANALYTICS_CONSENT_VERSION_KEY,
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

// Yeni onay duzeyi (surum 2): yeni gruplar bu depoyla sayilir ve gonderilir.
const fakeNew = (initial = {}) => fakeStorage({ analytics_consent_version: 2, ...initial })

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

describe('gruplar: listeler, cleanCounts, subtractCounts', () => {
    it('cleanCounts: grup basina kapali liste', () => {
        expect(cleanCounts({ open: 2, bogus: 3, screens: { send: 1, evil: 2 }, networks: { eth: 0, bsc: 1 } }))
            .toEqual({ open: 2, screens: { send: 1 }, networks: { bsc: 1 } })
    })
    it('cleanCounts: 10000 siniri, kesirli/negatif/dize atlanir', () => {
        expect(cleanCounts({ open: 99999, unlock: 1.5, swap: -1, bridge: '3', screens: { send: 20000, swap: -1, bridge: 2.5, token: '1' }, networks: { eth: 'x' } }))
            .toEqual({ open: 10000, screens: { send: 10000 } })
    })
    it('cleanCounts: bozuk grup yalniz kendini dusurur', () => {
        expect(cleanCounts({ open: 1, screens: 'x', networks: { eth: 2 } })).toEqual({ open: 1, networks: { eth: 2 } })
    })
    it('subtractCounts grup grup: bos grup ve sifir anahtar silinir', () => {
        const cur = { open: 3, unlock: 1, screens: { send: 2, swap: 1 }, networks: { eth: 1 } }
        const taken = { open: 3, screens: { send: 1, swap: 1 }, networks: { eth: 1 } }
        expect(subtractCounts(cur, taken)).toEqual({ unlock: 1, screens: { send: 1 } })
    })
})

describe('parti tum gruplari tasir', () => {
    const grouped = { open: 1, screens: { send: 2 }, networks: { eth: 1 } }
    it('pendingBatch tum gruplari tasir ve govde alanlari ayrisir', async () => {
        const o = base({ storage: fakeNew({ [ANALYTICS_COUNTS_KEY]: grouped }) })
        await runAnalyticsPing(o)
        expect(o.post).toHaveBeenCalledWith({ installId: ID, version: '1.9.1', locale: 'en', counts: { open: 1 }, screens: { send: 2 }, networks: { eth: 1 } })
    })
    it('hepsi bos -> govde yalniz uc alan', async () => {
        const o = base({ storage: fakeNew({ [ANALYTICS_COUNTS_KEY]: { screens: {}, networks: {} } }) })
        await runAnalyticsPing(o)
        expect(o.post.mock.calls[0][0]).toEqual({ installId: ID, version: '1.9.1', locale: 'en' })
    })
    it('yalniz gruplar varsa counts alani yok', async () => {
        const o = base({ storage: fakeNew({ [ANALYTICS_COUNTS_KEY]: { screens: { send: 1 } } }) })
        await runAnalyticsPing(o)
        expect(o.post.mock.calls[0][0]).toEqual({ installId: ID, version: '1.9.1', locale: 'en', screens: { send: 1 } })
    })
    it('basarisiz gonderim sonrasi yeniden deneme AYNI goruntuyu yollar (araya gelen artis girmez)', async () => {
        const storage = fakeNew({ [ANALYTICS_COUNTS_KEY]: grouped })
        await runAnalyticsPing({ ...base({ storage }), post: vi.fn().mockRejectedValue(new Error('ag')) })
        await countAction({ storage, kind: 'open' })
        storage.data[ANALYTICS_COUNTS_KEY].screens.send = 5
        const ok = vi.fn().mockResolvedValue({})
        await runAnalyticsPing({ ...base({ storage }), post: ok, now: new Date(NOW.getTime() + 31 * 60 * 1000) })
        expect(ok.mock.calls[0][0]).toEqual({ installId: ID, version: '1.9.1', locale: 'en', counts: { open: 1 }, screens: { send: 2 }, networks: { eth: 1 } })
    })
    it('basarida yalniz gonderilen goruntu grup grup cikarilir, aradaki artis (screens dahil) kalir', async () => {
        const storage = fakeNew({ [ANALYTICS_COUNTS_KEY]: grouped })
        const post = vi.fn(async () => {
            storage.data[ANALYTICS_COUNTS_KEY] = { open: 2, screens: { send: 3, swap: 1 }, networks: { eth: 1 } }
        })
        await runAnalyticsPing({ ...base({ storage }), post })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ open: 1, screens: { send: 1, swap: 1 } })
    })
    it('UTC gun degisimi: eski parti atilir, goruntusu sayactan cikarilir (screens/networks dahil), cift sayim yok', async () => {
        const storage = fakeNew({ [ANALYTICS_COUNTS_KEY]: grouped })
        await runAnalyticsPing({ ...base({ storage }), post: vi.fn().mockRejectedValue(new Error('ag')) })
        storage.data[ANALYTICS_COUNTS_KEY] = { open: 2, screens: { send: 3 }, networks: { eth: 1, bsc: 1 } }
        const ok = vi.fn().mockResolvedValue({})
        await runAnalyticsPing({ ...base({ storage }), post: ok, now: new Date('2026-10-16T12:00:00Z') })
        expect(ok.mock.calls[0][0]).toEqual({ installId: ID, version: '1.9.1', locale: 'en', counts: { open: 1 }, screens: { send: 1 }, networks: { bsc: 1 } })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({})
    })
    it('kapatinca (forget) hepsi silinir', async () => {
        const storage = fakeNew({ [ANALYTICS_COUNTS_KEY]: grouped })
        await setAnalyticsEnabled(storage, false)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
    })
    it('countAction gruplari korur', async () => {
        const storage = fakeNew({ [ANALYTICS_COUNTS_KEY]: grouped })
        await countAction({ storage, kind: 'unlock' })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ ...grouped, unlock: 1 })
    })
})

describe('listeler sunucuyla ESIT', () => {
    it('COUNT_KINDS / SCREEN_KEYS / NETWORK_KEYS sira dahil ayni', () => {
        const src = readFileSync(fileURLToPath(new URL('../../../server/utils/analytics.js', import.meta.url)), 'utf8')
        const parse = (name) => {
            const m = src.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'))
            return m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')).filter(Boolean)
        }
        expect(COUNT_KINDS).toEqual(parse('COUNT_KINDS'))
        expect(SCREEN_KEYS).toEqual(parse('SCREEN_KEYS'))
        expect(NETWORK_KEYS).toEqual(parse('NETWORK_KEYS'))
        expect(OLD_COUNT_KINDS).toEqual(COUNT_KINDS.slice(0, 5))
    })
})

describe('consentLevel', () => {
    it('enabled yok -> none', () => expect(consentLevel({})).toBe('none'))
    it('false -> none', () => expect(consentLevel({ analytics_enabled: false, analytics_consent_version: 2 })).toBe('none'))
    it('true, surum yok -> old', () => expect(consentLevel({ analytics_enabled: true })).toBe('old'))
    it('true, surum 1 -> old', () => expect(consentLevel({ analytics_enabled: true, analytics_consent_version: 1 })).toBe('old'))
    it('true, surum 2 -> new', () => expect(consentLevel({ analytics_enabled: true, analytics_consent_version: 2 })).toBe('new'))
    it('surum dize "2" -> old', () => expect(consentLevel({ analytics_enabled: true, analytics_consent_version: '2' })).toBe('old'))
})

describe('readAnalyticsConsentState', () => {
    const st = (d) => fakeStorage(d, { kabul: false })
    it('dort durum', async () => {
        expect(await readAnalyticsConsentState(st({}))).toBe('undecided')
        expect(await readAnalyticsConsentState(st({ analytics_enabled: 'x' }))).toBe('undecided')
        expect(await readAnalyticsConsentState(st({ analytics_enabled: false }))).toBe('declined')
        expect(await readAnalyticsConsentState(st({ analytics_enabled: true }))).toBe('reconsent')
        expect(await readAnalyticsConsentState(st({ analytics_enabled: true, analytics_consent_version: 2 }))).toBe('accepted')
    })
    it('eski false (surumlu/surumsuz) popup acmaz: declined', async () => {
        expect(await readAnalyticsConsentState(st({ analytics_enabled: false }))).toBe('declined')
        expect(await readAnalyticsConsentState(st({ analytics_enabled: false, analytics_consent_version: 1 }))).toBe('declined')
        expect(await readAnalyticsDecided(st({ analytics_enabled: false }))).toBe(true)
    })
    it('readAnalyticsDecided: reconsent ve undecided -> false, accepted -> true', async () => {
        expect(await readAnalyticsDecided(st({ analytics_enabled: true }))).toBe(false)
        expect(await readAnalyticsDecided(st({}))).toBe(false)
        expect(await readAnalyticsDecided(st({ analytics_enabled: true, analytics_consent_version: 2 }))).toBe(true)
    })
})

describe('setAnalyticsEnabled surum', () => {
    it('setAnalyticsEnabled(true) TEK set: enabled + surum 2', async () => {
        const storage = fakeStorage({}, { kabul: false })
        const set = vi.spyOn(storage, 'set')
        await setAnalyticsEnabled(storage, true)
        expect(set).toHaveBeenCalledTimes(1)
        expect(set).toHaveBeenCalledWith({ analytics_enabled: true, analytics_consent_version: ANALYTICS_CONSENT_VERSION })
        expect(ANALYTICS_CONSENT_VERSION_KEY).toBe('analytics_consent_version')
    })
    it('false -> forget, surum anahtari kalir', async () => {
        const storage = fakeNew({ [ANALYTICS_STATE_KEY]: { installId: ID }, [ANALYTICS_COUNTS_KEY]: { open: 1 } })
        await setAnalyticsEnabled(storage, false)
        expect(storage.data.analytics_enabled).toBe(false)
        expect(storage.data.analytics_consent_version).toBe(2)
        expect(storage.data[ANALYTICS_STATE_KEY]).toBeUndefined()
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
    })
})

describe('countAction onay duzeyleri', () => {
    it('countAction new: open +1; screen send +1 screens.send; transfer+network eth ayni set', async () => {
        const storage = fakeNew()
        expect(await countAction({ storage, kind: 'open' })).toBe(true)
        expect(await countAction({ storage, kind: 'screen', screen: 'send' })).toBe(true)
        const set = vi.spyOn(storage, 'set')
        expect(await countAction({ storage, kind: 'transfer', network: 'eth' })).toBe(true)
        expect(set).toHaveBeenCalledTimes(1)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ open: 1, transfer: 1, screens: { send: 1 }, networks: { eth: 1 } })
    })
    it('network yalniz transfer/swap/bridge icin; failed kind ag yazmaz', async () => {
        const storage = fakeNew()
        await countAction({ storage, kind: 'transferFailed', network: 'eth' })
        await countAction({ storage, kind: 'swap', network: 'bsc' })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ transferFailed: 1, swap: 1, networks: { bsc: 1 } })
    })
    it('old duzey: transfer sayilir ama networks YAZILMAZ; yeni kind -> false ve depo degismez', async () => {
        const storage = fakeStorage()
        expect(await countAction({ storage, kind: 'transfer', network: 'eth' })).toBe(true)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ transfer: 1 })
        const before = JSON.stringify(storage.data)
        const set = vi.spyOn(storage, 'set')
        for (const a of [{ kind: 'open' }, { kind: 'unlock' }, { kind: 'transferFailed' }, { kind: 'screen', screen: 'send' }]) {
            expect(await countAction({ storage, ...a })).toBe(false)
        }
        expect(set).not.toHaveBeenCalled()
        expect(JSON.stringify(storage.data)).toBe(before)
    })
    it('none/gizli/bayrak kapali: hicbiri artmaz', async () => {
        const none = fakeStorage({ analytics_enabled: false, analytics_consent_version: 2 })
        expect(await countAction({ storage: none, kind: 'open' })).toBe(false)
        const priv = fakeNew({ active_account: { private: true } })
        expect(await countAction({ storage: priv, kind: 'open' })).toBe(false)
        const pm = fakeNew()
        expect(await countAction({ storage: pm, kind: 'open', privateMode: true })).toBe(false)
        expect(await countAction({ storage: pm, kind: 'open', buildEnabled: false })).toBe(false)
        expect(pm.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(priv.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
        expect(none.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
    })
    it('liste disi screen -> other, liste disi network -> other', async () => {
        const storage = fakeNew()
        await countAction({ storage, kind: 'screen', screen: 'private_x' })
        await countAction({ storage, kind: 'swap', network: 'zzz' })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ swap: 1, screens: { other: 1 }, networks: { other: 1 } })
    })
    it('screen anahtarsiz -> false', async () => {
        const storage = fakeNew()
        expect(await countAction({ storage, kind: 'screen' })).toBe(false)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toBeUndefined()
    })
    it('10000 siniri', async () => {
        const storage = fakeNew({ [ANALYTICS_COUNTS_KEY]: { open: 10000, screens: { send: 10000 }, networks: { eth: 10000 }, transfer: 10000 } })
        await countAction({ storage, kind: 'open' })
        await countAction({ storage, kind: 'screen', screen: 'send' })
        await countAction({ storage, kind: 'transfer', network: 'eth' })
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ open: 10000, transfer: 10000, screens: { send: 10000 }, networks: { eth: 10000 } })
    })
    it('kabul geriye donuk saymaz: old doneminde yeni grup yazilamadi', async () => {
        const storage = fakeStorage()
        await countAction({ storage, kind: 'open' })
        await countAction({ storage, kind: 'screen', screen: 'send' })
        await countAction({ storage, kind: 'swap', network: 'eth' })
        await setAnalyticsEnabled(storage, true)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ swap: 1 })
    })
})

describe('runAnalyticsPing onay duzeyi (gonderim kapisi)', () => {
    const all = { transfer: 2, open: 3, transferFailed: 1, screens: { send: 2 }, networks: { eth: 1 } }
    it('old duzey: parti yeni gruplar icerse BILE govde yalniz uc alan + eski 5 anahtar', async () => {
        const storage = fakeStorage({
            [ANALYTICS_COUNTS_KEY]: all,
            [ANALYTICS_STATE_KEY]: { installId: ID, pendingBatch: { day: '2026-10-15', counts: all } },
        })
        const o = base({ storage })
        await runAnalyticsPing(o)
        expect(o.post).toHaveBeenCalledWith({ installId: ID, version: '1.9.1', locale: 'en', counts: { transfer: 2 } })
    })
    it('old: pendingBatch goruntusu de soyulmus yazilir (yeniden deneme yine yalniz eski)', async () => {
        const storage = fakeStorage({ [ANALYTICS_COUNTS_KEY]: all })
        await runAnalyticsPing({ ...base({ storage }), post: vi.fn().mockRejectedValue(new Error('ag')) })
        expect(storage.data[ANALYTICS_STATE_KEY].pendingBatch.counts).toEqual({ transfer: 2 })
    })
    it('old: eski pendingBatch (yalniz eski anahtarlar) oldugu gibi gider', async () => {
        const storage = fakeStorage({
            [ANALYTICS_COUNTS_KEY]: { transfer: 1, swap: 4 },
            [ANALYTICS_STATE_KEY]: { installId: ID, pendingBatch: { day: '2026-10-15', counts: { transfer: 1, swap: 2 } } },
        })
        const o = base({ storage })
        await runAnalyticsPing(o)
        expect(o.post.mock.calls[0][0]).toEqual({ installId: ID, version: '1.9.1', locale: 'en', counts: { transfer: 1, swap: 2 } })
    })
    it('old: gonderim sonrasi analytics_counts taki yeni gruplar DOKUNULMAZ kalir ve hic gonderilmez', async () => {
        const storage = fakeStorage({ [ANALYTICS_COUNTS_KEY]: all })
        const o = base({ storage })
        await runAnalyticsPing(o)
        expect(JSON.stringify(o.post.mock.calls[0][0])).not.toMatch(/open|screens|networks|Failed/)
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ open: 3, transferFailed: 1, screens: { send: 2 }, networks: { eth: 1 } })
    })
    it('old: gun degisiminde de yeni gruplar sayacta kalir', async () => {
        const storage = fakeStorage({ [ANALYTICS_COUNTS_KEY]: all })
        await runAnalyticsPing({ ...base({ storage }), post: vi.fn().mockRejectedValue(new Error('ag')) })
        const ok = vi.fn().mockResolvedValue({})
        await runAnalyticsPing({ ...base({ storage }), post: ok, now: new Date('2026-10-16T12:00:00Z') })
        expect(ok.mock.calls[0][0].counts).toBeUndefined()
        expect(storage.data[ANALYTICS_COUNTS_KEY]).toEqual({ open: 3, transferFailed: 1, screens: { send: 2 }, networks: { eth: 1 } })
    })
    it('new: tum gruplar gider', async () => {
        const o = base({ storage: fakeNew({ [ANALYTICS_COUNTS_KEY]: all }) })
        await runAnalyticsPing(o)
        expect(o.post).toHaveBeenCalledWith({ installId: ID, version: '1.9.1', locale: 'en', counts: { transfer: 2, open: 3, transferFailed: 1 }, screens: { send: 2 }, networks: { eth: 1 } })
    })
})
