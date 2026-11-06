import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeStorage } from '../../test-utils/fakeStorage'
import {
    saveQuoteRecord, loadQuoteRecord, listOrders, upsertOrder, updateOrder, orderPhase, isOpenOrder,
    pickOrderState, refundEligibility, refreshOpenOrders, clearRefund, patchQuoteRecord, ORDERS_KEY, ORDER_HORIZON_MS,
} from './privateOrderStore'

const SIGNER = '0x' + 'ab'.repeat(20)
const T = '0x' + '01'.repeat(32)

// Gercek chrome.storage gibi KOPYA doner/saklar (yerinde degistirme hatalari gizlenmez).
const memStorage = (initial = {}) => fakeStorage(initial)

let local
beforeEach(() => {
    local = memStorage()
    globalThis.chrome = { storage: { local } }
})
afterEach(() => {
    // chrome.storage JSON benzeri deger saklar; structuredClone BigInt'i sessizce kabul eder (B:M6).
    // Depoya BigInt yazan bir yol burada patlar.
    expect(() => JSON.stringify(local.data)).not.toThrow()
    expect(JSON.parse(JSON.stringify(local.data))).toEqual(local.data)
    delete globalThis.chrome
    vi.restoreAllMocks()
})

describe('teklif kaydi (session)', () => {
    it('kaydeder, ticket ile bulur, 30 dk\'dan eskileri temizler', async () => {
        const session = memStorage()
        await saveQuoteRecord(session, { quote: { ticket: 'eski' }, sourceAccountKey: 'a' }, 0)
        await saveQuoteRecord(session, { quote: { ticket: T }, sourceAccountKey: 'a' }, 31 * 60 * 1000)
        const LATER = 31 * 60 * 1000
        expect(await loadQuoteRecord(session, T, LATER)).toMatchObject({ sourceAccountKey: 'a' })
        expect(await loadQuoteRecord(session, 'eski', LATER)).toBe(null)
        expect(await loadQuoteRecord(session, undefined, LATER)).toBe(null)
    })

    // T24 M2-m6: sunucu expiresAt'i pinlenmez; kayit yasi tek basina yurutmeyi kapatir.
    describe('kayit yasi (T24 M2-m6)', () => {
        const TTL = 30 * 60 * 1000
        it('QUOTE_TTL_MS den eski kayit bulunmaz (sunucu expiresAt i ileri olsa da), taze kayit bulunur', async () => {
            const session = memStorage()
            const farFuture = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600
            await saveQuoteRecord(session, { quote: { ticket: T, expiresAt: farFuture }, sourceAccountKey: 'a' }, 1000)
            expect(await loadQuoteRecord(session, T, 1000 + TTL - 1)).toMatchObject({ sourceAccountKey: 'a' })
            expect(await loadQuoteRecord(session, T, 1000 + TTL)).toBe(null)
            expect(await loadQuoteRecord(session, T, 1000 + TTL + 1)).toBe(null)
        })

        it('createdAt eksik ya da sayi degilse fail-closed: bulunmaz', async () => {
            const session = memStorage()
            await session.set({ private_quotes: {
                a: { quote: { ticket: 'a' } }, b: { quote: { ticket: 'b' }, createdAt: 'simdi' }, c: { quote: { ticket: 'c' }, createdAt: null },
            } })
            for (const t of ['a', 'b', 'c']) expect(await loadQuoteRecord(session, t)).toBe(null)
        })

        it('varsayilan saat gercek saattir', async () => {
            const session = memStorage()
            await saveQuoteRecord(session, { quote: { ticket: T }, sourceAccountKey: 'a' })
            expect(await loadQuoteRecord(session, T)).toMatchObject({ sourceAccountKey: 'a' })
        })
    })

    it('miras alinan ozellikler kayit sayilmaz', async () => {
        const session = memStorage()
        await saveQuoteRecord(session, { quote: { ticket: 'a' }, sourceAccountKey: 'x' })
        for (const t of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            expect(await loadQuoteRecord(session, t)).toBe(null)
        }
    })

    it('__proto__ / miras adli ticket kaydi prototipi bozmaz, OZ ozellik olarak yazilir', async () => {
        const session = memStorage()
        await saveQuoteRecord(session, { quote: { ticket: 'normal' }, sourceAccountKey: 'x' })
        for (const t of ['__proto__', 'constructor', 'toString']) {
            await saveQuoteRecord(session, { quote: { ticket: t }, sourceAccountKey: 'zararli' })
        }
        const saved = session.data.private_quotes
        for (const t of ['__proto__', 'constructor', 'toString']) {
            expect(Object.prototype.hasOwnProperty.call(saved, t)).toBe(true)
            expect(await loadQuoteRecord(session, t)).toMatchObject({ sourceAccountKey: 'zararli' })
        }
        // Prototip degismedi: kayit olmayan adlar hala bulunmaz, diger kayit duruyor.
        expect(Object.getPrototypeOf(saved)).toBe(Object.prototype)
        expect(Object.keys(saved).sort()).toEqual(['__proto__', 'constructor', 'normal', 'toString'])
        expect(await loadQuoteRecord(session, 'normal')).toMatchObject({ sourceAccountKey: 'x' })
        expect(await loadQuoteRecord(session, 'hasOwnProperty')).toBe(null)
    })

    it('es zamanli iki kayit birbirini ezmez', async () => {
        const session = memStorage()
        await Promise.all([
            saveQuoteRecord(session, { quote: { ticket: 'a' }, sourceAccountKey: 'x' }),
            saveQuoteRecord(session, { quote: { ticket: 'b' }, sourceAccountKey: 'x' }),
        ])
        expect(await loadQuoteRecord(session, 'a')).not.toBe(null)
        expect(await loadQuoteRecord(session, 'b')).not.toBe(null)
    })

    it('bir kaydin hatasi sonraki kayitlari tikamaz', async () => {
        const session = memStorage()
        // quote yok -> record.quote.ticket TypeError
        await expect(saveQuoteRecord(session, {})).rejects.toThrow()
        await saveQuoteRecord(session, { quote: { ticket: 'a' }, sourceAccountKey: 'x' })
        expect(await loadQuoteRecord(session, 'a')).not.toBe(null)
    })

    // T5 M4: ticket depo anahtaridir; bos ya da dizge olmayan deger '' / 'undefined' adli kayit yazardi.
    it('bos ya da dizge olmayan ticket reddedilir ve depoya hicbir sey yazilmaz', async () => {
        const session = memStorage()
        for (const ticket of ['', undefined, null, 42, {}, ['a']]) {
            await expect(saveQuoteRecord(session, { quote: { ticket }, sourceAccountKey: 'x' }), String(ticket)).rejects.toThrow('PRIVATE_UNSUPPORTED')
        }
        expect(session.set).not.toHaveBeenCalled()
        expect(await loadQuoteRecord(session, '')).toBe(null)
        expect(await loadQuoteRecord(session, 'undefined')).toBe(null)
    })
})

describe('siparis kaydi', () => {
    it('upsert ekler ve gunceller', async () => {
        await upsertOrder({ ticket: T, status: 'AWAITING_DEPOSIT', depositTxHash: '0xh' })
        await upsertOrder({ ticket: T, status: 'OPEN' })
        const list = await listOrders()
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({ ticket: T, status: 'OPEN', depositTxHash: '0xh' })
        expect(local.data[ORDERS_KEY]).toHaveLength(1)
    })

    // T24: ham imzali bayt YAPISKAN degildir: hash ile birlikte yazilir, makbuz/terminal durumda null ile silinir.
    it('rawDepositTx hash ile ayni kayitta yazilir ve updateOrder ile null yapilabilir (yapiskan degil)', async () => {
        await upsertOrder({ ticket: T, depositTxHash: '0x' + 'dd'.repeat(32), rawDepositTx: '0x02aa', status: 'AWAITING_DEPOSIT' })
        expect((await listOrders())[0]).toMatchObject({ depositTxHash: '0x' + 'dd'.repeat(32), rawDepositTx: '0x02aa' })
        expect(await updateOrder(T, { rawDepositTx: null })).toBe(true)
        const [o] = await listOrders()
        expect(o.rawDepositTx).toBeNull()
        expect(o.depositTxHash).toBe('0x' + 'dd'.repeat(32))
    })

    it('yapiskan alanlar (refund/deposit/accessToken) null ile ezilmez', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', depositTxHash: '0xh', refundTxHash: '0xr', status: 'FAILED' })
        await upsertOrder({ ticket: T, accessToken: undefined, depositTxHash: null, refundTxHash: null, status: 'FAILED' })
        const [o] = await listOrders()
        expect(o).toMatchObject({ accessToken: 'tok', depositTxHash: '0xh', refundTxHash: '0xr' })
    })

    it('yapiskan alan gercek yeni degerle degisebilir', async () => {
        await upsertOrder({ ticket: T, depositTxHash: '0xeski' })
        await upsertOrder({ ticket: T, depositTxHash: '0xyeni' })
        expect((await listOrders())[0].depositTxHash).toBe('0xyeni')
    })
})

describe('updateOrder (araya girmeyen guncelleme)', () => {
    it('var olan kaydi yamalar, baska alanlara dokunmaz ve true doner', async () => {
        await upsertOrder({ ticket: T, status: 'AWAITING_DEPOSIT', depositTxHash: '0xh', accessToken: 'tok' })
        expect(await updateOrder(T, { depositFailed: true, status: 'ABORTED' })).toBe(true)
        expect(await listOrders()).toEqual([{ ticket: T, status: 'ABORTED', depositTxHash: '0xh', accessToken: 'tok', depositFailed: true }])
    })

    it('kayit yoksa KAYIT OLUSTURMAZ, hic yazmaz ve false doner', async () => {
        expect(await updateOrder(T, { depositFailed: true })).toBe(false)
        expect(local.data[ORDERS_KEY]).toBeUndefined()
        await upsertOrder({ ticket: '0x' + '02'.repeat(32), status: 'OPEN' })
        expect(await updateOrder(T, { depositFailed: true })).toBe(false)
        expect(await listOrders()).toHaveLength(1)
    })

    it('yapiskan alanlari (hash/accessToken/refund) bos yamayla silmez', async () => {
        await upsertOrder({ ticket: T, depositTxHash: '0xh', refundTxHash: '0xr', accessToken: 'tok' })
        await updateOrder(T, { depositTxHash: null, refundTxHash: null, accessToken: undefined, depositFailed: true })
        expect((await listOrders())[0]).toMatchObject({ depositTxHash: '0xh', refundTxHash: '0xr', accessToken: 'tok', depositFailed: true })
    })

    it('gecersiz ticket ya da yama sessizce false doner', async () => {
        await upsertOrder({ ticket: T, status: 'OPEN' })
        expect(await updateOrder(undefined, { a: 1 })).toBe(false)
        expect(await updateOrder(T, null)).toBe(false)
        expect((await listOrders())[0]).toEqual({ ticket: T, status: 'OPEN' })
    })
})

describe('faz ve aciklik', () => {
    it.each([
        [{ status: 'AWAITING_DEPOSIT' }, 'pending', true],
        [{ status: 'OPEN' }, 'processing', true],
        [{ status: 'CLAIM_READY' }, 'processing', true],
        [{ status: 'COMPLETED' }, 'done', false],
        [{ status: 'FAILED' }, 'problem', false],
        [{ status: 'ABORTED' }, 'problem', false],
        [{ status: 'DROPPED' }, 'problem', false],
        [{ status: 'DROPPED', depositTxHash: '0xh' }, 'pending', true],
        [{ status: 'FAILED', refundTxHash: '0xr' }, 'refunded', false],
    ])('%o -> %s, acik=%s', (order, faz, acik) => {
        expect(orderPhase(order)).toBe(faz)
        expect(isOpenOrder(order)).toBe(acik)
    })
})

describe('tek siniflandirici: ufuk, depositFailed, yapiskanlik', () => {
    // Gercek epoch milisaniye gibi gorunmeli (isOpenOrder yalniz > 1e12 degerlerini saat sayar).
    const NOW = 1.8e12
    const fresh = NOW - 60 * 1000
    const old = NOW - ORDER_HORIZON_MS - 1
    const exact = NOW - ORDER_HORIZON_MS

    it('ufuk 72 saattir', () => {
        expect(ORDER_HORIZON_MS).toBe(72 * 60 * 60 * 1000)
    })

    it.each([
        // depositFailed durumdan BAGIMSIZ terminal ve 'problem' (T14 M2).
        [{ status: 'AWAITING_DEPOSIT', depositFailed: true, createdAt: fresh }, 'problem', false],
        [{ status: 'OPEN', depositFailed: true, createdAt: fresh }, 'problem', false],
        [{ status: 'DROPPED', depositTxHash: '0xh', depositFailed: true, createdAt: fresh }, 'problem', false],
        [{ status: 'ABORTED', depositFailed: true }, 'problem', false],
        // 72 saati asan terminal olmayan her durum kapanir: 'problem', yoklanmaz, rozette yok.
        [{ status: 'AWAITING_DEPOSIT', depositTxHash: '0xh', createdAt: old }, 'problem', false],
        [{ status: 'DROPPED', depositTxHash: '0xh', createdAt: old }, 'problem', false],
        [{ status: 'OPEN', depositTxHash: '0xh', createdAt: old }, 'problem', false],
        [{ status: 'FULFILLING', depositTxHash: '0xh', createdAt: old }, 'problem', false],
        [{ status: 'CLAIM_READY', createdAt: old }, 'problem', false],
        // Ufuk icinde acik kalir; DROPPED + hash canlanabilir.
        [{ status: 'DROPPED', depositTxHash: '0xh', createdAt: fresh }, 'pending', true],
        [{ status: 'AWAITING_DEPOSIT', depositTxHash: '0xh', createdAt: exact }, 'pending', true],
        [{ status: 'OPEN', createdAt: fresh }, 'processing', true],
        // Terminal durumlar yaslarindan bagimsiz eski anlamini korur.
        [{ status: 'COMPLETED', createdAt: old }, 'done', false],
        [{ status: 'FAILED', createdAt: old }, 'problem', false],
        [{ status: 'FAILED', createdAt: fresh }, 'problem', false],
        [{ status: 'DROPPED', createdAt: fresh }, 'problem', false],
        // Iade kaydi her seyin ustunde: yasli siparis bile 'refunded' kalir.
        [{ status: 'FAILED', refundTxHash: '0xr', createdAt: old }, 'refunded', false],
        // createdAt yoksa ya da sayi degilse yas bilinmez: kapatilmaz.
        [{ status: 'AWAITING_DEPOSIT', depositTxHash: '0xh' }, 'pending', true],
        [{ status: 'AWAITING_DEPOSIT', depositTxHash: '0xh', createdAt: 'dun' }, 'pending', true],
    ])('%o -> %s, acik=%s', (order, faz, acik) => {
        expect(orderPhase(order, NOW)).toBe(faz)
        expect(isOpenOrder(order, NOW)).toBe(acik)
    })

    it('bozuk girdi (null/ilkel) acik sayilmaz', () => {
        for (const bad of [null, undefined, 'x', 5]) {
            expect(isOpenOrder(bad, NOW)).toBe(false)
            expect(orderPhase(bad, NOW)).toBe('problem')
        }
    })

    // T16 M2: orders.filter(isOpenOrder) ikinci argumana dizi INDEKSINI verir; now sanilsaydi ufuk kapanirdi.
    it('filter/some ile dogrudan gecilince indeks saat sanilmaz: 72 saat ufku uygulanir', () => {
        const eskiAcik = { ticket: 'a', status: 'OPEN', createdAt: Date.now() - ORDER_HORIZON_MS - 5000 }
        const tazeAcik = { ticket: 'b', status: 'OPEN', createdAt: Date.now() - 1000 }
        const orders = [eskiAcik, tazeAcik]
        expect(orders.filter(isOpenOrder).map((o) => o.ticket)).toEqual(['b'])
        expect(orders.some(isOpenOrder)).toBe(true)
        expect([eskiAcik].some(isOpenOrder)).toBe(false)
        expect(orders.map(orderPhase)).toEqual(['problem', 'processing'])
    })

    it('now yalniz epoch milisaniye gibi sonlu sayi ise kullanilir; digerleri gercek saate duser', () => {
        const eski = { status: 'OPEN', createdAt: Date.now() - ORDER_HORIZON_MS - 5000 }
        for (const bad of [0, 1, 7, -5, 1e11, NaN, Infinity, '1800000000000', null, {}, []]) {
            expect(isOpenOrder(eski, bad)).toBe(false)
            expect(orderPhase(eski, bad)).toBe('problem')
        }
        // Gecerli now gercekten kullanilir (gecmis bir saatte ayni kayit hala acik).
        expect(isOpenOrder(eski, eski.createdAt + 1000)).toBe(true)
        expect(orderPhase(eski, eski.createdAt + 1000)).toBe('processing')
    })

    it('now verilmezse gercek saat kullanilir', () => {
        expect(isOpenOrder({ status: 'OPEN', createdAt: Date.now() })).toBe(true)
        expect(isOpenOrder({ status: 'OPEN', createdAt: Date.now() - ORDER_HORIZON_MS - 5000 })).toBe(false)
    })

    // ATS'te belirsiz yatirma AWAITING_DEPOSIT kalir; SilentSwap kapatmazsa ufuk kapatir (T15).
    it('belirsiz ATS yatirmasi (AWAITING_DEPOSIT + hash) ufuk gelince kapanir', () => {
        const o = { status: 'AWAITING_DEPOSIT', depositTxHash: '0xats', gas: 'ats', createdAt: fresh }
        expect(isOpenOrder(o, NOW)).toBe(true)
        expect(isOpenOrder({ ...o, createdAt: old }, NOW)).toBe(false)
        expect(orderPhase({ ...o, createdAt: old }, NOW)).toBe('problem')
    })

    it('depositFailed yapiskandir: bayat AWAITING_DEPOSIT yazimlari onu silmez, siparis terminal kalir', async () => {
        await upsertOrder({ ticket: T, status: 'AWAITING_DEPOSIT', depositTxHash: '0xh', createdAt: Date.now() })
        await updateOrder(T, { depositFailed: true, status: 'ABORTED' })
        // Yoklama kayit okunurken baslamisti: eski anlik goruntuyle geri doner.
        await upsertOrder({ ticket: T, status: 'AWAITING_DEPOSIT', depositFailed: false, updatedAt: 5 })
        await updateOrder(T, { status: 'AWAITING_DEPOSIT', depositFailed: undefined })
        const [o] = await listOrders()
        expect(o.depositFailed).toBe(true)
        expect(isOpenOrder(o)).toBe(false)
        expect(orderPhase(o)).toBe('problem')
    })

    it('yoklama sirasinda yazilan depositFailed, donen AWAITING_DEPOSIT yanitiyla ezilmez ve siparis yoklanmaz', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'AWAITING_DEPOSIT', depositTxHash: '0xh', createdAt: Date.now() })
        const client = {
            getOrder: vi.fn(async () => {
                await updateOrder(T, { depositFailed: true, status: 'ABORTED' })
                return { status: 'AWAITING_DEPOSIT', signer: SIGNER, recipients: [] }
            }),
        }
        const list = await refreshOpenOrders({ client })
        expect(list[0].depositFailed).toBe(true)
        expect(isOpenOrder(list[0])).toBe(false)
        expect(orderPhase(list[0])).toBe('problem')
        // Sonraki tur bu siparisi yoklamaz.
        await refreshOpenOrders({ client })
        expect(client.getOrder).toHaveBeenCalledTimes(1)
    })
})

describe('clearRefund (iade kaydini yapiskanligi asarak temizler)', () => {
    it('refundTxHash ve state.refundTxHash null olur, refundFailed:true yazilir, baska alanlar kalir', async () => {
        await upsertOrder({
            ticket: T, status: 'FAILED', depositTxHash: '0xh', accessToken: 'tok', refundTxHash: '0xr',
            refundConfirmed: false, state: { status: 'FAILED', refundTxHash: '0xr', gateway: SIGNER },
        })
        expect(await clearRefund(T)).toBe(true)
        const [o] = await listOrders()
        expect(o).toMatchObject({
            ticket: T, status: 'FAILED', depositTxHash: '0xh', accessToken: 'tok', refundTxHash: null,
            refundFailed: true, refundConfirmed: false, state: { status: 'FAILED', refundTxHash: null, gateway: SIGNER },
        })
        expect(orderPhase(o)).toBe('problem')
    })

    // T16 M7: geri alinan iadenin hash'i tanilama icin kendi alaninda kalir.
    it('geri alinan iade hash i lastFailedRefundTxHash alaninda saklanir', async () => {
        await upsertOrder({ ticket: T, status: 'FAILED', refundTxHash: '0xr', state: { status: 'FAILED', refundTxHash: '0xr' } })
        await clearRefund(T)
        const [o] = await listOrders()
        expect(o.refundTxHash).toBeNull()
        expect(o.state.refundTxHash).toBeNull()
        expect(o.lastFailedRefundTxHash).toBe('0xr')
    })

    it('hash siz ikinci temizleme onceki tanilama hash ini silmez; yeni iade basarisizsa uzerine yazar', async () => {
        await upsertOrder({ ticket: T, status: 'FAILED', refundTxHash: '0xr1' })
        await clearRefund(T)
        await clearRefund(T)
        expect((await listOrders())[0].lastFailedRefundTxHash).toBe('0xr1')
        await upsertOrder({ ticket: T, refundTxHash: '0xr2', refundFailed: false })
        await clearRefund(T)
        expect((await listOrders())[0].lastFailedRefundTxHash).toBe('0xr2')
    })

    // T21 M1: temizle-ve-karsilastir. Makbuzu sorgulanan hash kayittakiyle ayni degilse hicbir sey yazilmaz.
    describe('beklenen hash ile temizle-ve-karsilastir (T21 M1)', () => {
        it('kayit AYNI hash i tasiyorsa temizler', async () => {
            await upsertOrder({ ticket: T, status: 'FAILED', refundTxHash: '0xr1', state: { status: 'FAILED', refundTxHash: '0xr1' } })
            expect(await clearRefund(T, '0xr1')).toBe(true)
            expect((await listOrders())[0]).toMatchObject({ refundTxHash: null, refundFailed: true, lastFailedRefundTxHash: '0xr1' })
        })

        it('kayit BASKA bir hash tasiyorsa (yeniden gonderilmis iade) hicbir sey yazmaz ve false doner', async () => {
            await upsertOrder({ ticket: T, status: 'FAILED', refundTxHash: '0xr2', refundFailed: false, state: { status: 'FAILED', refundTxHash: '0xr2' } })
            const setSpy = vi.spyOn(local, 'set')
            expect(await clearRefund(T, '0xr1')).toBe(false)
            expect(setSpy).not.toHaveBeenCalled()
            expect((await listOrders())[0]).toMatchObject({ refundTxHash: '0xr2', refundFailed: false, state: { refundTxHash: '0xr2' } })
            expect((await listOrders())[0].lastFailedRefundTxHash).toBeUndefined()
        })

        it('kayit hash tasimiyorsa (zaten temizlenmis ya da yazilamamis) zararsiz temizlenir', async () => {
            await upsertOrder({ ticket: T, status: 'FAILED', refundTxHash: '0xr1' })
            await clearRefund(T)
            expect(await clearRefund(T, '0xr1')).toBe(true)
            expect((await listOrders())[0]).toMatchObject({ refundTxHash: null, refundFailed: true, lastFailedRefundTxHash: '0xr1' })
        })
    })

    it('kayit yoksa hic yazmaz ve false doner; gecersiz ticket false', async () => {
        expect(await clearRefund(T)).toBe(false)
        expect(await clearRefund(undefined)).toBe(false)
        expect(local.data[ORDERS_KEY]).toBeUndefined()
    })

    it('state yoksa (null) da calisir', async () => {
        await upsertOrder({ ticket: T, status: 'OPEN', refundTxHash: '0xr', state: null })
        await clearRefund(T)
        expect((await listOrders())[0]).toMatchObject({ refundTxHash: null, refundFailed: true, state: null })
    })

    it('yeni iade yazilinca (upsert) refundFailed:false ile yeniden isaretlenebilir', async () => {
        await upsertOrder({ ticket: T, status: 'OPEN', refundTxHash: '0xr' })
        await clearRefund(T)
        await upsertOrder({ ticket: T, refundTxHash: '0xr2', refundFailed: false })
        expect((await listOrders())[0]).toMatchObject({ refundTxHash: '0xr2', refundFailed: false })
    })
})

describe('bozuk depo girdileri (B:M5)', () => {
    const BOZUK = [null, 5, 'x', [], { status: 'OPEN' }, { ticket: 7 }]
    const withStored = (list) => {
        local = memStorage({ [ORDERS_KEY]: list })
        globalThis.chrome = { storage: { local } }
    }

    it('listOrders yalniz dizge ticket tasiyan duz nesneleri tutar', async () => {
        withStored([...BOZUK, { ticket: T, status: 'OPEN' }])
        expect(await listOrders()).toEqual([{ ticket: T, status: 'OPEN' }])
    })

    it('upsertOrder bozuk girdi varken de yazar (kayit yolu atmaz)', async () => {
        withStored([null, 5, { ticket: T, status: 'OPEN' }])
        await upsertOrder({ ticket: T, status: 'FAILED' })
        await upsertOrder({ ticket: '0x' + '02'.repeat(32), status: 'OPEN' })
        const list = await listOrders()
        expect(list.map((o) => o.ticket)).toEqual(['0x' + '02'.repeat(32), T])
        expect(list.find((o) => o.ticket === T).status).toBe('FAILED')
    })

    it('updateOrder ve clearRefund bozuk girdi varken atmaz', async () => {
        withStored([null, 'x', { ticket: T, status: 'OPEN', refundTxHash: '0xr' }])
        expect(await updateOrder(T, { depositFailed: true })).toBe(true)
        expect(await clearRefund(T)).toBe(true)
        expect((await listOrders())[0]).toMatchObject({ depositFailed: true, refundTxHash: null })
    })
})

describe('refundEligibility (SDK kurallarinin kopyasi)', () => {
    const now = 2000000000
    const ok = {
        status: 'FAILED', sourceChainKind: 'evm', gateway: '0x' + '11'.repeat(20), expirationUnix: now - 10,
        signer: SIGNER, fulfilledOnchain: false, refundTxHash: null,
        recipients: [{ status: 'FAILED', recipientTxHash: null }],
    }

    it('tum kosullar saglaninca ok', () => {
        expect(refundEligibility(ok, SIGNER.toUpperCase().replace('0X', '0x'), now)).toEqual({ ok: true })
    })

    it.each([
        [{ status: 'COMPLETED' }, 'status'],
        [{ expirationUnix: now + 10 }, 'not-expired'],
        [{ expirationUnix: now }, 'not-expired'],
        [{ expirationUnix: 'abc' }, 'not-expired'],
        [{ expirationUnix: NaN }, 'missing-fields'],
        [{ signer: '0x' + '22'.repeat(20) }, 'signer'],
        [{ refundTxHash: '0xr' }, 'settled'],
        [{ fulfilledOnchain: true }, 'settled'],
        [{ sourceChainKind: 'ton' }, 'not-evm'],
        [{ gateway: null }, 'missing-fields'],
        [{ recipients: [{ status: 'FULFILLING', recipientTxHash: null }] }, 'recipient-in-flight'],
        [{ recipients: [{ status: 'FAILED', recipientTxHash: '0xp' }] }, 'recipient-in-flight'],
    ])('%o -> %s', (over, reason) => {
        expect(refundEligibility({ ...ok, ...over }, SIGNER, now)).toEqual({ ok: false, reason })
    })

    // nowSec SANIYE olmali; eksik/NaN/milisaniye gelirse iade ACILMAZ (fail-closed).
    it.each([
        ['eksik', undefined],
        ['null', null],
        ['NaN', NaN],
        ['metin', 'abc'],
        ['milisaniye', Date.now()],
    ])('nowSec %s -> not-expired', (_ad, bad) => {
        expect(refundEligibility(ok, SIGNER, bad)).toEqual({ ok: false, reason: 'not-expired' })
    })
})

describe('refreshOpenOrders', () => {
    // REVIEW FOCUS 3: SW yeniden baslasa da accessToken kayitta oldugu icin yoklama surer.
    it('yalniz acik siparisleri accessToken ile yoklar ve durumu yazar', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'AWAITING_DEPOSIT', depositTxHash: '0xh' })
        await upsertOrder({ ticket: 'bitti', status: 'COMPLETED' })
        const client = { getOrder: vi.fn(async () => ({ status: 'OPEN', signer: SIGNER, recipients: [{ status: 'PENDING' }] })) }
        const list = await refreshOpenOrders({ client })
        expect(client.getOrder).toHaveBeenCalledOnce()
        expect(client.getOrder).toHaveBeenCalledWith({ id: T, privacy: true, accessToken: 'tok' })
        expect(list.find((o) => o.ticket === T)).toMatchObject({ status: 'OPEN', state: { status: 'OPEN', signer: SIGNER } })
    })

    it('ag hatasinda kayit oldugu gibi kalir', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'OPEN' })
        const client = { getOrder: vi.fn(async () => { throw new TypeError('Failed to fetch') }) }
        const list = await refreshOpenOrders({ client })
        expect(list[0].status).toBe('OPEN')
    })

    it('getOrder nesne olmayan bir sey dondurunce saklanan durum bozulmaz', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'OPEN' })
        for (const garbage of [undefined, null, 'x']) {
            const client = { getOrder: vi.fn(async () => garbage) }
            const list = await refreshOpenOrders({ client })
            // Dongu bos gecmesin: yanit gercekten istendi (T3 M7).
            expect(client.getOrder).toHaveBeenCalledTimes(1)
            expect(list[0].status).toBe('OPEN')
            expect(list[0].state).toBeUndefined()
        }
    })

    // T3 M2: durumu dizge olmayan nesne yaniti, durumu bos alanlarla degistirmesin.
    it('status dizgesi olmayan nesne yaniti saklanan durumu bozmaz', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'OPEN', state: { status: 'OPEN', signer: SIGNER } })
        for (const garbage of [{}, { status: 5 }, { status: null, signer: SIGNER }, { error: 'x' }]) {
            const client = { getOrder: vi.fn(async () => garbage) }
            const list = await refreshOpenOrders({ client })
            expect(client.getOrder).toHaveBeenCalledTimes(1)
            expect(list[0]).toMatchObject({ status: 'OPEN', state: { status: 'OPEN', signer: SIGNER } })
        }
    })

    // T3 M3: yoklama yalniz var olan kaydi gunceller; sifirlama yarisinda kayit diriltmez.
    it('yoklama sirasinda depo silinirse kayit yeniden olusmaz', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'OPEN' })
        const client = {
            getOrder: vi.fn(async () => {
                delete local.data[ORDERS_KEY]
                return { status: 'OPEN', signer: SIGNER, recipients: [] }
            }),
        }
        const list = await refreshOpenOrders({ client })
        expect(list).toEqual([])
        expect(local.data[ORDERS_KEY]).toBeUndefined()
    })

    // T3 M6 / B:M5: ag hatasi sessiz, depo hatasi console.error ile gorunur.
    it('ag hatasi sessizce yutulur, depo yazim hatasi console.error ile bildirilir ve dongu surer', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {})
        const T2 = '0x' + '02'.repeat(32)
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'OPEN' })
        await upsertOrder({ ticket: T2, accessToken: 'tok2', status: 'OPEN' })
        const client = { getOrder: vi.fn(async () => { throw new TypeError('Failed to fetch') }) }
        await refreshOpenOrders({ client })
        expect(err).not.toHaveBeenCalled()

        const realSet = local.set.getMockImplementation()
        local.set.mockImplementation(async () => { throw new Error('depo yazilamadi') })
        const ok = { getOrder: vi.fn(async () => ({ status: 'FULFILLING', recipients: [] })) }
        await expect(refreshOpenOrders({ client: ok })).resolves.toBeDefined()
        expect(ok.getOrder).toHaveBeenCalledTimes(2)
        expect(err).toHaveBeenCalledTimes(2)
        local.set.mockImplementation(realSet)
    })

    it('depo okunamazsa (get reddeder) hata cagiriciya yayilir, sessizce yutulmaz', async () => {
        local.get.mockRejectedValue(new Error('depo okunamadi'))
        await expect(refreshOpenOrders({ client: { getOrder: vi.fn() } })).rejects.toThrow('depo okunamadi')
    })

    it('en fazla 3 getOrder ayni anda calisir ve hepsi yoklanir', async () => {
        for (let i = 0; i < 7; i++) await upsertOrder({ ticket: '0x' + String(i).repeat(64), accessToken: 't', status: 'OPEN' })
        let running = 0
        let peak = 0
        const client = {
            getOrder: vi.fn(async () => {
                running++
                peak = Math.max(peak, running)
                await new Promise((r) => setTimeout(r, 5))
                running--
                return { status: 'OPEN', recipients: [] }
            }),
        }
        await refreshOpenOrders({ client })
        expect(client.getOrder).toHaveBeenCalledTimes(7)
        expect(peak).toBe(3)
    })

    it('ufku asan siparis yoklanmaz', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'AWAITING_DEPOSIT', depositTxHash: '0xh', createdAt: Date.now() - ORDER_HORIZON_MS - 1000 })
        const client = { getOrder: vi.fn() }
        await refreshOpenOrders({ client })
        expect(client.getOrder).not.toHaveBeenCalled()
    })

    it('yoklama sirasinda yazilan refundTxHash eski anlik goruntuyle ezilmez', async () => {
        await upsertOrder({ ticket: T, accessToken: 'tok', status: 'OPEN' })
        const client = {
            getOrder: vi.fn(async () => {
                // Ag beklenirken iade gonderildi ve kaydedildi (Task 8 akisi).
                await upsertOrder({ ticket: T, refundTxHash: '0xr' })
                return { status: 'OPEN', signer: SIGNER, refundTxHash: null, recipients: [] }
            }),
        }
        const list = await refreshOpenOrders({ client })
        expect(list[0].refundTxHash).toBe('0xr')
    })

    it('pickOrderState BigInt ya da fazladan alan tasimaz', () => {
        const s = pickOrderState({ status: 'OPEN', signer: SIGNER, extra: 1n, recipients: [{ status: 'PENDING', payoutAmount: '1' }] })
        expect(JSON.parse(JSON.stringify(s))).toEqual(s)
        expect(s.extra).toBeUndefined()
    })
})

// T6: ATS ucret teklifinden sonra donmus artik izin degeri (atsAllowanceRaw) kayda yamalanir.
describe('patchQuoteRecord', () => {
    const TTL = 30 * 60 * 1000

    it('var olan alanlari korur, yama alanlarini ustune yazar ve createdAt i degistirmez', async () => {
        const session = memStorage()
        await saveQuoteRecord(session, { quote: { ticket: T }, sourceAccountKey: 'a', sourceChainId: 56, atsAllowanceRaw: null }, 1000)
        expect(await patchQuoteRecord(session, T, { atsAllowanceRaw: '5' }, 2000)).toBe(true)
        const rec = await loadQuoteRecord(session, T, 2000)
        expect(rec).toEqual({ quote: { ticket: T }, sourceAccountKey: 'a', sourceChainId: 56, atsAllowanceRaw: '5', createdAt: 1000 })
        // Ikinci yama oncekini korur, yalniz kendi alanini degistirir.
        expect(await patchQuoteRecord(session, T, { atsAllowanceRaw: '7', baska: 1 }, 2500)).toBe(true)
        expect(await loadQuoteRecord(session, T, 2500)).toMatchObject({ sourceAccountKey: 'a', atsAllowanceRaw: '7', baska: 1, createdAt: 1000 })
    })

    it('bilinmeyen ticket false doner ve hicbir sey yazmaz', async () => {
        const session = memStorage()
        await saveQuoteRecord(session, { quote: { ticket: T }, sourceAccountKey: 'a' }, 1000)
        session.set.mockClear()
        expect(await patchQuoteRecord(session, '0xyok', { atsAllowanceRaw: '5' }, 2000)).toBe(false)
        expect(await patchQuoteRecord(session, undefined, { atsAllowanceRaw: '5' }, 2000)).toBe(false)
        expect(await patchQuoteRecord(session, 'constructor', { atsAllowanceRaw: '5' }, 2000)).toBe(false)
        expect(await patchQuoteRecord(session, '__proto__', { atsAllowanceRaw: '5' }, 2000)).toBe(false)
        expect(session.set).not.toHaveBeenCalled()
        expect(await loadQuoteRecord(session, T, 2000)).not.toHaveProperty('atsAllowanceRaw')
    })

    it('30 dk den eski (ya da yasi bilinmeyen) kayit false doner ve yamalanmaz', async () => {
        const session = memStorage()
        await saveQuoteRecord(session, { quote: { ticket: T }, sourceAccountKey: 'a' }, 1000)
        session.set.mockClear()
        expect(await patchQuoteRecord(session, T, { atsAllowanceRaw: '5' }, 1000 + TTL)).toBe(false)
        expect(session.set).not.toHaveBeenCalled()
        expect(session.data.private_quotes[T]).not.toHaveProperty('atsAllowanceRaw')
        await session.set({ private_quotes: { yas: { quote: { ticket: 'yas' } } } })
        session.set.mockClear()
        expect(await patchQuoteRecord(session, 'yas', { atsAllowanceRaw: '5' }, 2000)).toBe(false)
        expect(session.set).not.toHaveBeenCalled()
    })

    it('es zamanli saveQuoteRecord ile okuma-degistirme-yazma kaybi yok (yavas depo)', async () => {
        const base = memStorage()
        // Her get bir tur bekler: kuyruk yoksa iki islem ayni eski haritayi okuyup birbirinin yazimini silerdi.
        const session = {
            get: async (k) => { const r = await base.get(k); await new Promise((res) => setTimeout(res, 5)); return r },
            set: (v) => base.set(v),
        }
        await saveQuoteRecord(session, { quote: { ticket: T }, sourceAccountKey: 'a' }, 1000)
        const T2 = '0x' + '02'.repeat(32)
        const T3 = '0x' + '03'.repeat(32)
        const sonuc = await Promise.all([
            saveQuoteRecord(session, { quote: { ticket: T2 }, sourceAccountKey: 'b' }, 1100),
            patchQuoteRecord(session, T, { atsAllowanceRaw: '9' }, 1200),
            saveQuoteRecord(session, { quote: { ticket: T3 }, sourceAccountKey: 'c' }, 1300),
            patchQuoteRecord(session, T2, { atsAllowanceRaw: '4' }, 1400),
        ])
        expect(sonuc[1]).toBe(true)
        expect(sonuc[3]).toBe(true)
        expect(base.data.private_quotes[T]).toMatchObject({ sourceAccountKey: 'a', atsAllowanceRaw: '9' })
        expect(base.data.private_quotes[T2]).toMatchObject({ sourceAccountKey: 'b', atsAllowanceRaw: '4' })
        expect(base.data.private_quotes[T3]).toMatchObject({ sourceAccountKey: 'c' })
    })

    it('bir kayit hatasi sonraki yamayi tikamaz', async () => {
        const session = memStorage()
        await saveQuoteRecord(session, { quote: { ticket: T }, sourceAccountKey: 'a' }, 1000)
        await expect(saveQuoteRecord(session, { quote: {} }, 1100)).rejects.toThrow('PRIVATE_UNSUPPORTED')
        expect(await patchQuoteRecord(session, T, { atsAllowanceRaw: '5' }, 1200)).toBe(true)
    })
})
