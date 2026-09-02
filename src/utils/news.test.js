import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    pickText, normalizeNewsItem, normalizeNews, visibleNews, isRecent,
    readDismissedNews, dismissNewsItem, readNewsCache, writeNewsCache,
    NEWS_DISMISSED_KEY, NEWS_CACHE_KEY,
} from './news'

describe('pickText — dil secimi', () => {
    it('duz dize her dilde aynen doner', () => {
        expect(pickText('ATS v2', 'tr')).toBe('ATS v2')
    })

    it('istenen dili secer', () => {
        expect(pickText({ tr: 'Merhaba', en: 'Hello' }, 'tr')).toBe('Merhaba')
        expect(pickText({ tr: 'Merhaba', en: 'Hello' }, 'en')).toBe('Hello')
    })

    it('istenen dil yoksa en\'e duser', () => {
        expect(pickText({ en: 'Hello' }, 'tr')).toBe('Hello')
    })

    it('en de yoksa nesnedeki ILK dolu degere duser — bos kart "bozuk" gorunur', () => {
        expect(pickText({ de: 'Hallo' }, 'tr')).toBe('Hallo')
    })

    it('bos/bosluklu deger dolu sayilmaz, sonrakine gecer', () => {
        expect(pickText({ tr: '   ', en: 'Hello' }, 'tr')).toBe('Hello')
    })

    it('alan yok/gecersizse bos dize', () => {
        expect(pickText(undefined, 'tr')).toBe('')
        expect(pickText(null, 'tr')).toBe('')
        expect(pickText(42, 'tr')).toBe('')
    })
})

describe('normalizeNewsItem — zorunlu alanlar', () => {
    const ok = { id: 'a', title: { tr: 'Baslik', en: 'Title' }, body: { tr: 'Govde', en: 'Body' }, date: '2026-09-01', accent: 'blue' }

    it('tam kayit oldugu gibi doner', () => {
        expect(normalizeNewsItem(ok, 'tr')).toEqual({
            id: 'a', title: 'Baslik', body: 'Govde', date: '2026-09-01', accent: 'blue',
        })
    })

    it('id yoksa kayit ELENIR — kapatma id\'ye yaziliyor', () => {
        expect(normalizeNewsItem({ ...ok, id: undefined }, 'tr')).toBeNull()
        expect(normalizeNewsItem({ ...ok, id: '   ' }, 'tr')).toBeNull()
    })

    it('baslik cozulemezse kayit ELENIR', () => {
        expect(normalizeNewsItem({ ...ok, title: {} }, 'tr')).toBeNull()
        expect(normalizeNewsItem({ ...ok, title: undefined }, 'tr')).toBeNull()
    })

    it('govde opsiyonel — eksikse bos dize', () => {
        expect(normalizeNewsItem({ ...ok, body: undefined }, 'tr').body).toBe('')
    })

    it('bicimi bozuk tarih null olur, kayit ELENMEZ', () => {
        expect(normalizeNewsItem({ ...ok, date: '01.09.2026' }, 'tr').date).toBeNull()
        expect(normalizeNewsItem({ ...ok, date: undefined }, 'tr').date).toBeNull()
    })

    it('bilinmeyen vurgu rengi varsayilana duser — Tailwind o sinifi derlememis olur', () => {
        expect(normalizeNewsItem({ ...ok, accent: 'fuchsia' }, 'tr').accent).toBe('indigo')
        expect(normalizeNewsItem({ ...ok, accent: undefined }, 'tr').accent).toBe('indigo')
    })

    it('nesne olmayan girdi null', () => {
        expect(normalizeNewsItem(null, 'tr')).toBeNull()
        expect(normalizeNewsItem('haber', 'tr')).toBeNull()
    })
})

describe('normalizeNews — govde bicimleri', () => {
    const item = (id) => ({ id, title: { tr: 'B' + id, en: 'T' + id } })

    it('{ news: [...] } govdesini okur', () => {
        expect(normalizeNews({ news: [item('a'), item('b')] }, 'tr').map((x) => x.id)).toEqual(['a', 'b'])
    })

    it('ciplak diziyi de okur — gomulu varsayilan listenin bicimi bu', () => {
        expect(normalizeNews([item('a')], 'tr').map((x) => x.id)).toEqual(['a'])
    })

    it('beklenmedik govde COKMEZ, bos dizi doner', () => {
        expect(normalizeNews(null, 'tr')).toEqual([])
        expect(normalizeNews({ success: false }, 'tr')).toEqual([])
        expect(normalizeNews('bozuk', 'tr')).toEqual([])
    })

    it('gecersiz kayitlari atar, gecerlileri KORUR', () => {
        const out = normalizeNews({ news: [item('a'), { title: 'id yok' }, null, item('b')] }, 'tr')
        expect(out.map((x) => x.id)).toEqual(['a', 'b'])
    })

    it('ayni id tekrar gelirse ILKI kazanir', () => {
        const out = normalizeNews({ news: [item('a'), item('a')] }, 'tr')
        expect(out).toHaveLength(1)
    })

    it('makul bir tavan uygular', () => {
        const many = Array.from({ length: 50 }, (_, i) => item('n' + i))
        expect(normalizeNews({ news: many }, 'tr').length).toBeLessThanOrEqual(12)
    })
})

describe('visibleNews — kapatilanlar', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    it('kapatilan id elenir', () => {
        expect(visibleNews(items, ['b']).map((x) => x.id)).toEqual(['a', 'c'])
    })

    it('Set de kabul edilir', () => {
        expect(visibleNews(items, new Set(['a', 'c'])).map((x) => x.id)).toEqual(['b'])
    })

    it('kapatma listesi yoksa hepsi gorunur', () => {
        expect(visibleNews(items, undefined)).toHaveLength(3)
        expect(visibleNews(items, null)).toHaveLength(3)
    })

    it('hepsi kapatilmissa bos dizi — serit hic cizilmez', () => {
        expect(visibleNews(items, ['a', 'b', 'c'])).toEqual([])
    })
})

describe('isRecent — YENI rozeti', () => {
    const NOW = Date.parse('2026-09-10T12:00:00Z')

    it('son 14 gun icindeki kayit yeni', () => {
        expect(isRecent('2026-09-01', NOW)).toBe(true)
    })

    it('14 gunden eski kayit yeni DEGIL', () => {
        expect(isRecent('2026-08-01', NOW)).toBe(false)
    })

    it('gelecek tarihli kayit yeni sayilir — yayin tarihi ileri alinmis olabilir', () => {
        expect(isRecent('2026-12-01', NOW)).toBe(true)
    })

    it('tarihsiz kayit rozet ALMAZ — bilinmeyeni "yeni" saymak sahte sinyal uretir', () => {
        expect(isRecent(null, NOW)).toBe(false)
        expect(isRecent('01.09.2026', NOW)).toBe(false)
    })

    it('gun esigi disaridan verilebilir', () => {
        expect(isRecent('2026-09-01', NOW, 5)).toBe(false)
        expect(isRecent('2026-09-01', NOW, 30)).toBe(true)
    })
})

// --- kalici durum -----------------------------------------------------------------------

describe('kapatma listesi ve onbellek — chrome.storage', () => {
    let store

    beforeEach(() => {
        store = {}
        globalThis.chrome = {
            storage: {
                local: {
                    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]])),
                    set: async (obj) => { Object.assign(store, obj) },
                },
            },
        }
    })

    afterEach(() => { delete globalThis.chrome })

    it('kapatilan id saklanir ve geri okunur', async () => {
        expect(await readDismissedNews()).toEqual([])
        expect(await dismissNewsItem('a')).toEqual(['a'])
        expect(await readDismissedNews()).toEqual(['a'])
    })

    it('ayni id iki kez kapatilinca liste buyumez', async () => {
        await dismissNewsItem('a')
        expect(await dismissNewsItem('a')).toEqual(['a'])
    })

    it('bozuk kayit COKMEZ, bos liste doner', async () => {
        store[NEWS_DISMISSED_KEY] = 'bozuk'
        expect(await readDismissedNews()).toEqual([])
    })

    it('depo patlarsa kart GIZLENMEZ — bos liste doner', async () => {
        globalThis.chrome.storage.local.get = async () => { throw new Error('depo yok') }
        expect(await readDismissedNews()).toEqual([])
    })

    it('chrome yokken (SSR/test baglami) sessizce bos doner', async () => {
        delete globalThis.chrome
        expect(await readDismissedNews()).toEqual([])
        expect(await readNewsCache()).toBeNull()
        await expect(writeNewsCache([{ id: 'a' }])).resolves.toBeUndefined()
    })

    it('onbellek HAM kaydi saklar — dil secimi OKUMA aninda yapilmali', async () => {
        const raw = [{ id: 'a', title: { tr: 'Baslik', en: 'Title' } }]
        await writeNewsCache(raw)
        expect(await readNewsCache()).toEqual(raw)
        expect(normalizeNews(await readNewsCache(), 'en')[0].title).toBe('Title')
    })

    it('bozuk onbellek null doner — cagiran varsayilana duser', async () => {
        store[NEWS_CACHE_KEY] = { news: 'dizi degil' }
        expect(await readNewsCache()).toBeNull()
    })

    it('tavan asilinca EN ESKI kayit dusurulur', async () => {
        store[NEWS_DISMISSED_KEY] = Array.from({ length: 100 }, (_, i) => 'n' + i)
        const next = await dismissNewsItem('yeni')
        expect(next).toHaveLength(100)
        expect(next[0]).toBe('n1')
        expect(next[99]).toBe('yeni')
    })
})
