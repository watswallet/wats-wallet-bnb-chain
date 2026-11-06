import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// SSR'da onUnmounted hic calismaz: temizleme testi icin kaydedilen geri cagrilar tutulur (T18 M4).
const hooks = vi.hoisted(() => ({ unmounted: [] }))
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch, onUnmounted: (fn) => { hooks.unmounted.push(fn) } }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { pageStore } from '../../store/pageStore'
import PrivateOrders from './PrivateOrders.vue'

afterEach(() => { delete globalThis.chrome; hooks.unmounted.length = 0 })

const OUT = '0x' + 'cd'.repeat(20)

// reply: PRIVATE_ORDERS ve PRIVATE_REFUND cevaplarini ezmek icin (throw edebilir).
function mount(orders, { ordersReply, refundReply, locale = 'en' } = {}) {
    const stub = installChromeStub({})
    const sent = []
    stub.setSendMessage(async (msg) => {
        sent.push(msg)
        if (msg.type === 'PRIVATE_ORDERS') return ordersReply ? ordersReply(msg) : { success: true, orders }
        if (msg.type === 'PRIVATE_REFUND') return refundReply ? refundReply(msg) : { success: true, hash: '0xr' }
        return { success: true }
    })
    const app = createApp(PrivateOrders)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    const captured = captureInstance(app, 'PrivateOrders')
    return { app, captured, sent }
}

describe('PrivateOrders', () => {
    it('bos liste metni', async () => {
        expect(await render(mount([]).app)).toContain('No private transactions yet.')
    })

    it('faz etiketini ve iade dugmesini gosterir; iade ticket ile gider', async () => {
        const { app, captured, sent } = mount([
            { ticket: '0xa', createdAt: 1, phase: 'problem', payoutUsdc: '25.0', outputAsset: 'USDC', expectedAmount: '25.0', outputAddress: OUT, refundable: true },
            { ticket: '0xb', createdAt: 2, phase: 'done', payoutUsdc: '10.0', outputAsset: 'USDC', expectedAmount: '10.0', outputAddress: OUT, refundable: false },
        ])
        const html = await render(app)
        expect(html).toContain('Needs attention')
        expect(html).toContain('Completed')
        expect(html.match(/>Refund</g)?.length).toBe(1)
        await captured.instance.setupState.refund('0xa')
        expect(sent).toContainEqual({ type: 'PRIVATE_REFUND', message: { ticket: '0xa' } })
    })

    it('satir varliga duyarli: USDC teslimi tutari, BNB teslimi beklenen BNB yi gosterir', async () => {
        const { app } = mount([
            { ticket: '0xa', createdAt: 1, phase: 'processing', payoutUsdc: '25.0', outputAsset: 'USDC', expectedAmount: '25.0', outputAddress: OUT, refundable: false },
            { ticket: '0xb', createdAt: 2, phase: 'processing', payoutUsdc: '25.0', outputAsset: 'BNB', expectedAmount: '0.0405', estimated: true, outputAddress: OUT, refundable: false },
        ])
        const html = await render(app)
        expect(html).toContain('25.0 USDC')
        expect(html).toContain('~0.0405 BNB')
        // BNB siparisi yanlislikla "25.0 USDC" diye gorunmez: USDC tutari yalniz USDC satirinda.
        expect(html.match(/25\.0 USDC/g)).toHaveLength(1)
    })

    it('BNB teslimi beklenen tutar yoksa yalniz varlik adini gosterir (USDC tutari sizmaz)', async () => {
        const { app } = mount([
            { ticket: '0xb', createdAt: 2, phase: 'processing', payoutUsdc: '25.0', outputAsset: 'BNB', expectedAmount: null, estimated: true, outputAddress: OUT, refundable: false },
        ])
        const html = await render(app)
        expect(html).toContain('BNB')
        expect(html).not.toContain('25.0')
    })

    it('eksik alanli siparis (outputAddress, createdAt yok) cokmez', async () => {
        const { app } = mount([{ ticket: '0xz', phase: 'pending' }])
        const html = await render(app)
        expect(html).toContain('Deposit sent, awaiting confirmation')
    })

    it('bilinmeyen faz ham haliyle yazilir, anahtar yolu gorunmez', async () => {
        const { app } = mount([{ ticket: '0xw', createdAt: 1, phase: 'weird', payoutUsdc: '5', outputAddress: OUT, refundable: false }])
        const html = await render(app)
        expect(html).toContain('weird')
        expect(html).not.toContain('privacy.orders.phase')
        expect(html).not.toContain('privacy.orders')
    })

    it('liste istegi atar veya hata cevabi verirse genel hata metni ve Tekrar dene; bos liste metni YOK', async () => {
        for (const ordersReply of [async () => { throw new Error('Extension context invalidated') }, async () => ({ success: false })]) {
            const { app, captured } = mount([], { ordersReply })
            const html = await render(app)
            expect(captured.instance.setupState.error).toBe('Something went wrong. Try again.')
            expect(html).toContain('Something went wrong. Try again.')
            expect(html).toContain('>Retry<')
            expect(html).not.toContain('No private transactions yet.')
        }
    })

    it('liste hatasinda bilinmeyen kod ham gosterilmez', async () => {
        const { app, captured } = mount([], { ordersReply: async () => ({ success: false, error: 'TypeError: x is undefined' }) })
        await render(app)
        expect(captured.instance.setupState.error).toBe('Something went wrong. Try again.')
    })

    it('liste payload i dizi degilse bos liste olur', async () => {
        const { app, captured } = mount([], { ordersReply: async () => ({ success: true, orders: { x: 1 } }) })
        const html = await render(app)
        expect(captured.instance.setupState.orders).toEqual([])
        expect(html).toContain('No private transactions yet.')
    })

    it('iade reddedilirse eslenmis hata gosterilir, busy kalkar, liste yeniden istenir', async () => {
        const { app, captured, sent } = mount([], { refundReply: async () => ({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' }) })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.error).toBe("A refund isn't possible for this transfer yet.")
        expect(s.busy).toBe(false)
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDERS')).toHaveLength(2)
    })

    // Sahip karari 2026-10-30: iadenin ag ucreti ATS ile odenir. ATS yetmezse ekran ne kadar gerektigini soyler, hata DEGIL ozel kutu cizer ve
    // siparis iade edilebilir kalir; ATS Al dugmesi yalniz ucreti Gizli Hesap oduyorsa (Gonder siparisi) sunulur.
    it('iade ATS yetersiz (Gonder siparisi): gereken yukari, bakiye asagi yuvarlanir; hata metni yok; ATS Al sunulur', async () => {
        const { app, captured, sent } = mount([], {
            refundReply: async () => ({ success: false, error: 'PRIVATE_INSUFFICIENT_ATS', atsNeeded: 24.871, atsBalance: 3.999, payerPrivate: true }),
        })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.refundAtsShort).toEqual({ needed: 24.871, balance: 3.999, payerPrivate: true })
        expect(s.refundAtsShortText).toBe('The refund fee is paid in ATS. You need at least 24.88 ATS; your balance is 3.99 ATS.')
        expect(s.error).toBe('')
        expect(s.busy).toBe(false)
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDERS')).toHaveLength(2)
    })

    it('iade ATS yetersiz (Para yukle siparisi): ucreti NORMAL hesap oder, metin bunu soyler; bilinmeyen deger tire', async () => {
        const { app, captured } = mount([], {
            refundReply: async () => ({ success: false, error: 'PRIVATE_INSUFFICIENT_ATS', atsNeeded: 24.87, atsBalance: null, payerPrivate: false }),
        })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.refundAtsShort.payerPrivate).toBe(false)
        expect(s.refundAtsShortText).toBe("The refund fee is paid from your regular account's ATS balance. Your regular account needs at least 24.87 ATS; its balance is \u2014 ATS.")
    })

    it('ATS yetersizlik kutusu bir sonraki iade tiklamasinda silinir', async () => {
        let n = 0
        const { app, captured } = mount([], {
            refundReply: async () => (++n === 1 ? { success: false, error: 'PRIVATE_INSUFFICIENT_ATS', atsNeeded: 24.87, atsBalance: 1, payerPrivate: true } : { success: true, hash: '0xr' }),
        })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.refundAtsShort).not.toBeNull()
        await s.refund('0xa')
        expect(s.refundAtsShort).toBeNull()
    })

    it('sablon: ATS Al dugmesi yalniz payerPrivate iken cizilir (Para yukle iadesinde Gizli Hesap\'a ATS aldirilmaz)', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./PrivateOrders.vue', import.meta.url)), 'utf8')
        expect(kaynak).toMatch(/<AtsBuyButton v-if="refundAtsShort\.payerPrivate"\s*\/>/)
    })

    it('kutu ATS yetersizligi disindaki iade hatalarinda cizilmez (eslenmis hata metni kalir)', async () => {
        const { app, captured } = mount([], { refundReply: async () => ({ success: false, error: 'PRIVATE_ATS_UNAVAILABLE' }) })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.refundAtsShort).toBeNull()
        expect(s.error).toBe("The network fee can't be paid in ATS right now. Try again later.")
    })

    // T25 U:I-1: cevap kaybi ya da belirsiz yayin = iade GONDERILMIS OLABILIR: hata degil not, liste yeniden okunur.
    // T25 M5: kullanici zaten Gizli islemler ekraninda: "Gizli islemlere bak" demez, durumun burada guncellenecegini soyler.
    const MAYBE_SENT = 'The refund may have been sent. Its status will update here once the network confirms it.'
    it('belirsiz iade notu kullaniciyi zaten icinde oldugu sayfaya yollamaz (iki dilde)', () => {
        const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/en.json', import.meta.url)), 'utf8'))
        const tr = JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/tr.json', import.meta.url)), 'utf8'))
        expect(en.privacy.errors.PRIVATE_REFUND_UNCONFIRMED).toBe(MAYBE_SENT)
        expect(en.privacy.errors.PRIVATE_REFUND_UNCONFIRMED).not.toMatch(/check private transactions/i)
        expect(tr.privacy.errors.PRIVATE_REFUND_UNCONFIRMED).not.toMatch(/Gizli işlemlerim/)
        expect(tr.privacy.errors.PRIVATE_REFUND_UNCONFIRMED).not.toBe(en.privacy.errors.PRIVATE_REFUND_UNCONFIRMED)
    })
    it.each([
        ['istek firlatir (servis calisani yeniden basliyor)', async () => { throw new Error('boom') }],
        ['cevap yok (undefined)', async () => undefined],
        ['arka plan PRIVATE_REFUND_UNCONFIRMED der', async () => ({ success: false, error: 'PRIVATE_REFUND_UNCONFIRMED', txHash: '0x' + 'ab'.repeat(32) })],
    ])('iade: %s -> "gonderilmis olabilir" notu, hata yok, busy kalkar, liste yeniden istenir', async (_ad, refundReply) => {
        const { app, captured, sent } = mount([], { refundReply })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.notice).toBe(MAYBE_SENT)
        expect(s.error).toBe('')
        expect(s.busy).toBe(false)
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDERS')).toHaveLength(2)
    })

    it('iade kesin reddedilirse (PRIVATE_FAILED) not DEGIL hata gosterilir', async () => {
        const { app, captured } = mount([], { refundReply: async () => ({ success: false, error: 'PRIVATE_FAILED' }) })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.error).toBe('Something went wrong. Try again.')
        expect(s.notice).toBe('')
    })

    it('basarili iade eski "gonderilmis olabilir" notunu siler', async () => {
        let n = 0
        const { app, captured } = mount([], { refundReply: async () => (++n === 1 ? null : { success: true, hash: '0xr' }) })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.notice).toBe(MAYBE_SENT)
        await s.refund('0xa')
        expect(s.notice).toBe('')
    })

    it('iade devam ederken ikinci iade istegi gonderilmez', async () => {
        let release
        const gate = new Promise((r) => { release = r })
        const { app, captured, sent } = mount([], { refundReply: async () => { await gate; return { success: true, hash: '0xr' } } })
        await render(app)
        const s = captured.instance.setupState
        const first = s.refund('0xa')
        await s.refund('0xa')
        release()
        await first
        expect(sent.filter((m) => m.type === 'PRIVATE_REFUND')).toHaveLength(1)
    })
})

describe('PrivateOrders -- son inceleme dalgasi (Task 18)', () => {
    const tick = () => new Promise((r) => setTimeout(r, 0))
    const ROW = { ticket: '0xa', createdAt: 1, phase: 'processing', payoutUsdc: '25.0', outputAsset: 'USDC', expectedAmount: '25.0', outputAddress: OUT, refundable: false }

    it('U-I1 ilk cevaptan once yukleniyor durumu: loading true, loaded false, bos metin cizilmez', async () => {
        let serbest
        const bekle = new Promise((r) => { serbest = r })
        const { app, captured } = mount([], { ordersReply: async () => { await bekle; return { success: true, orders: [] } } })
        const p = render(app)
        await tick()
        const s = captured.instance.setupState
        expect(s.loading).toBe(true)
        expect(s.loaded).toBe(false)
        serbest()
        const html = await p
        expect(s.loaded).toBe(true)
        expect(s.loading).toBe(false)
        expect(html).toContain('No private transactions yet.')
        expect(html).not.toContain('Loading...')
    })

    it('U-I1 sablon: bos metin yalniz loaded && !error && !orders.length iken, yukleniyor loading && !loaded iken', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateOrders.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toContain('v-if="loading && !loaded"')
        expect(kaynak).toContain('v-else-if="loaded && !error && !orders.length"')
    })

    it('U-I1 basarisiz yenilemede son iyi satirlar korunur, hata eklenir; Tekrar dene hatayi temizler', async () => {
        let n = 0
        const { app, captured } = mount([], { ordersReply: async () => (++n === 1 ? { success: true, orders: [ROW] } : n === 2 ? { success: false } : { success: true, orders: [ROW, { ...ROW, ticket: '0xb' }] }) })
        await render(app)
        const s = captured.instance.setupState
        expect(s.orders).toHaveLength(1)
        await s.load()
        expect(s.orders).toHaveLength(1)
        expect(s.error).toBe('Something went wrong. Try again.')
        await s.retry()
        expect(s.error).toBe('')
        expect(s.orders).toHaveLength(2)
    })

    it('U-I1 yenileme: 20 sn aralikli zamanlayici onMounted ta kurulur, onUnmounted ta temizlenir', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateOrders.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toContain('const REFRESH_MS = 20000')
        expect(kaynak).toContain('setInterval(')
        expect(kaynak).toContain('REFRESH_MS')
        expect(kaynak).toContain('onUnmounted')
        expect(kaynak).toContain('clearInterval(refreshTimer)')
        const govde = kaynak.slice(kaynak.indexOf('onMounted('))
        expect(govde.indexOf('setInterval')).toBeGreaterThan(-1)
        expect(govde.indexOf('setInterval')).toBeLessThan(govde.indexOf('return load()'))
    })

    it('U-I1 ust uste binen yuklemelerde SON istegin cevabi kazanir', async () => {
        const gates = []
        const { app, captured } = mount([], { ordersReply: () => new Promise((r) => gates.push(r)) })
        const p = render(app)
        await tick()
        const s = captured.instance.setupState
        const ikinci = s.load()
        await tick()
        // eski (ilk) istek yeni cevaptan SONRA gelir: listeyi ezmemeli
        gates[1]({ success: true, orders: [{ ...ROW, ticket: '0xyeni' }] })
        await ikinci
        gates[0]({ success: true, orders: [{ ...ROW, ticket: '0xeski' }] })
        await p
        expect(s.orders.map((o) => o.ticket)).toEqual(['0xyeni'])
    })

    it('U-M4 pending metni: yatirma gonderildi, onay bekleniyor', async () => {
        const html = await render(mount([{ ...ROW, phase: 'pending' }]).app)
        expect(html).toContain('Deposit sent, awaiting confirmation')
        expect(html).not.toContain('Waiting for deposit')
    })

    it('U-M4 yalniz sure dolunca ACILACAK iade "sureden sonra" ipucu tasir; iadesi acik olan ve problem olmayan tasimaz', async () => {
        const html = await render(mount([
            { ...ROW, ticket: '0x1', phase: 'problem', refundable: false, refundOpensLater: true },
            { ...ROW, ticket: '0x2', phase: 'problem', refundable: true },
            { ...ROW, ticket: '0x3', phase: 'done', refundable: false },
        ]).app)
        expect(html.match(/A refund opens after the order expires\./g)).toHaveLength(1)
        expect(html.match(/>Refund</g)).toHaveLength(1)
        expect(html).not.toContain('This order couldn&#39;t be completed')
    })

    // T18 M6: ipucu NEDENE gore; gerceklesmeyecek vaat yazilmaz.
    describe('T18 M6 ipucu nedene gore', () => {
        const NEUTRAL = 'This order couldn&#39;t be completed. Check again later or contact support.'
        const OPENS = 'A refund opens after the order expires.'
        const NOT_SENT = 'The deposit didn&#39;t go through. The transfer amount didn&#39;t leave your account (a network fee may apply).'
        // T25 M5: belirsiz yayin da refundPending olur: "gonderildi" DEGIL, "iletildi, agi bekliyor" (gonderildigi kesin degil).
        const REFUND_PENDING = 'Refund submitted, waiting for the network.'
        const REFUND_UNKNOWN = 'Refund status unknown. Contact support.'
        const REFUND_FAILED = 'The last refund failed; you can try again.'

        it.each([
            ['depositFailed', { depositFailed: true, refundOpensLater: false }, NOT_SENT],
            // T25 U:M-7: iade hash'i kayitliyken faz 'refunded' olur ama makbuz yoksa "onay bekleniyor" yazilir.
            ['iade gonderildi, makbuz yok', { phase: 'refunded', refundPending: true }, REFUND_PENDING],
            // 24 saat sorgu ufku asildi: sonsuza dek "bekleniyor" yazilmaz, destege yonlendirilir (refundStatusUnknown onceliklidir).
            ['iade makbuzsuz ve sorgu ufku asildi', { phase: 'refunded', refundPending: true, refundStatusUnknown: true }, REFUND_UNKNOWN],
            ['son iade basarisiz, Iade yeniden acik', { refundable: true, refundFailed: true }, REFUND_FAILED],
            ['FAILED, suresi ileride (iade acilacak)', { refundOpensLater: true }, OPENS],
            ['ABORTED / yatirma sorunu yok (iade acilmaz)', { refundOpensLater: false }, NEUTRAL],
            ['kayitli durum yok / 72 saatle kapandi (alan yok)', {}, NEUTRAL],
        ])('%s', async (_ad, over, expected) => {
            const html = await render(mount([{ ...ROW, phase: 'problem', refundable: false, ...over }]).app)
            expect(html).toContain(expected)
            for (const other of [NEUTRAL, OPENS, NOT_SENT, REFUND_PENDING, REFUND_FAILED, REFUND_UNKNOWN].filter((x) => x !== expected)) expect(html).not.toContain(other)
        })

        it('refundFailed ama iade artik kapaliysa (ornek: sure bilgisi yok) "tekrar deneyebilirsin" VAADI yazilmaz', async () => {
            const html = await render(mount([{ ...ROW, phase: 'problem', refundable: false, refundFailed: true, refundOpensLater: false }]).app)
            expect(html).not.toContain(REFUND_FAILED)
        })

        it('iade tamamlandiysa (onayli) hicbir iade ipucu yazilmaz', async () => {
            const html = await render(mount([{ ...ROW, phase: 'refunded', refundable: false, refundPending: false, refundFailed: false }]).app)
            expect(html).toContain('Refunded')
            for (const x of [REFUND_PENDING, REFUND_FAILED, NOT_SENT, NEUTRAL, OPENS, REFUND_UNKNOWN]) expect(html).not.toContain(x)
        })

        it('yeni ipucu anahtari iki dilde de var', () => {
            const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/en.json', import.meta.url)), 'utf8'))
            const tr = JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/tr.json', import.meta.url)), 'utf8'))
            expect(en.privacy.orders.hintUnfinished).toBeTruthy()
            expect(tr.privacy.orders.hintUnfinished).toBeTruthy()
            expect(tr.privacy.orders.hintUnfinished).not.toBe(en.privacy.orders.hintUnfinished)
            for (const k of ['hintRefundPending', 'hintRefundUnknown', 'hintRefundFailed', 'hintNotSent']) {
                expect(en.privacy.orders[k], k).toBeTruthy()
                expect(tr.privacy.orders[k], k).toBeTruthy()
                expect(tr.privacy.orders[k], k).not.toBe(en.privacy.orders[k])
            }
        })
    })

    // T18 M3: Tekrar dene eski liste hatasini siler; iade hatasi sonraki iade tiklamasina kadar kalir.
    describe('T18 M3 hata omru', () => {
        it('Tekrar dene yukleme surerken eski liste hatasini siler (Yukleniyor ile kirmizi hata birlikte gorunmez)', async () => {
            let n = 0
            let release
            const gate = new Promise((r) => { release = r })
            const { app, captured } = mount([], { ordersReply: async () => { if (++n === 1) return { success: false }; await gate; return { success: true, orders: [ROW] } } })
            await render(app)
            const s = captured.instance.setupState
            expect(s.loadError).toBe('Something went wrong. Try again.')
            const retrying = s.retry()
            expect(s.loadError).toBe('')
            expect(s.error).toBe('')
            expect(s.loaded).toBe(false)
            expect(s.loading).toBe(true)
            release()
            await retrying
            expect(s.orders).toHaveLength(1)
            expect(s.error).toBe('')
        })

        it('Tekrar dene yine basarisiz olursa yeni hata yazilir', async () => {
            const { app, captured } = mount([], { ordersReply: async () => ({ success: false }) })
            await render(app)
            const s = captured.instance.setupState
            await s.retry()
            expect(s.loadError).toBe('Something went wrong. Try again.')
        })

        it('iade hatasi basarili yuklemelerde (20 sn tazeleme dahil) KALIR, sonraki Iade tiklamasinda silinir', async () => {
            let refunds = 0
            const { app, captured } = mount([ROW], { refundReply: async () => (++refunds === 1 ? { success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' } : { success: true, hash: '0xr' }) })
            await render(app)
            const s = captured.instance.setupState
            await s.refund('0xa')
            expect(s.error).toBe("A refund isn't possible for this transfer yet.")
            // Sonraki basarili periyodik yukleme iade hatasini silmez.
            await s.load()
            expect(s.loadError).toBe('')
            expect(s.error).toBe("A refund isn't possible for this transfer yet.")
            // Sonraki Iade tiklamasi onu siler (basariliysa hata kalmaz).
            await s.refund('0xa')
            expect(s.error).toBe('')
        })
    })

    // T18 M4: 20 sn tazeleme, `!busy` kosulu ve temizleme DAVRANIS olarak olculur (kaynak taramasi degil).
    describe('T18 M4 periyodik tazeleme', () => {
        let intervals
        beforeEach(() => {
            intervals = { set: vi.fn((fn, ms) => { intervals.fn = fn; intervals.ms = ms; return 42 }), clear: vi.fn() }
            globalThis.window = { setInterval: intervals.set, clearInterval: intervals.clear }
        })
        afterEach(() => { delete globalThis.window })

        it('20 sn aralikla kurulur; tikta yukleme istenir; busy iken ATLANIR; onUnmounted ta bir kez temizlenir', async () => {
            const { app, captured, sent } = mount([ROW])
            await render(app)
            const s = captured.instance.setupState
            expect(intervals.set).toHaveBeenCalledTimes(1)
            expect(intervals.ms).toBe(20000)
            const loads = () => sent.filter((m) => m.type === 'PRIVATE_ORDERS').length
            expect(loads()).toBe(1)

            // Bosta: tik yukleme baslatir.
            intervals.fn()
            await tick()
            expect(loads()).toBe(2)

            // Iade surerken (busy): tik yukleme BASLATMAZ.
            s.busy = true
            intervals.fn()
            await tick()
            expect(loads()).toBe(2)
            s.busy = false
            intervals.fn()
            await tick()
            expect(loads()).toBe(3)

            // Temizleme: zamanlayici kimligiyle bir kez; ikinci cagri tekrar temizlemez.
            expect(hooks.unmounted).toHaveLength(1)
            hooks.unmounted[0]()
            expect(intervals.clear).toHaveBeenCalledTimes(1)
            expect(intervals.clear).toHaveBeenCalledWith(42)
            hooks.unmounted[0]()
            expect(intervals.clear).toHaveBeenCalledTimes(1)
        })

        it('window yoksa (SSR/test) zamanlayici kurulmaz ve temizleme hata atmaz', async () => {
            delete globalThis.window
            const { app } = mount([ROW])
            await render(app)
            expect(intervals.set).not.toHaveBeenCalled()
            expect(() => hooks.unmounted[0]()).not.toThrow()
            expect(intervals.clear).not.toHaveBeenCalled()
        })
    })

    it('U-M4 depositFailed kaydi "gonderilmedi, para cikmadi" der, iade ipucu vermez', async () => {
        const html = await render(mount([{ ...ROW, phase: 'problem', refundable: false, depositFailed: true }]).app)
        expect(html).toContain('The deposit didn&#39;t go through. The transfer amount didn&#39;t leave your account (a network fee may apply).')
        expect(html).not.toContain('A refund opens after')
    })

    it('U-M4 iade reddedilip ardindan yukleme de basarisiz olursa iade hatasi gorunur kalir', async () => {
        let n = 0
        const { app, captured } = mount([], {
            ordersReply: async () => (++n === 1 ? { success: true, orders: [ROW] } : { success: false }),
            refundReply: async () => ({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' }),
        })
        await render(app)
        const s = captured.instance.setupState
        await s.refund('0xa')
        expect(s.error).toBe("A refund isn't possible for this transfer yet.")
        expect(s.loadError).toBe('Something went wrong. Try again.')
    })

    it('dest li USDC teslimi tahmindir: "~" ve 6 ondalik, tam deger title ta; dest siz eski USDC kesin', async () => {
        const html = await render(mount([{ ...ROW, outputAsset: 'USDC', expectedAmount: '24.650051486357324334', estimated: true }]).app)
        expect(html).toContain('~24.650051 USDC')
        expect(html).toContain('title="24.650051486357324334 USDC"')
        const eski = await render(mount([{ ...ROW, outputAsset: 'USDC', expectedAmount: '25.0', estimated: false }]).app)
        expect(eski).toContain('25.0 USDC')
        expect(eski).not.toContain('~25.0')
    })

    it('secilen token satiri kendi semboluyle: "~" ve 6 ondalik (CAKE), tam deger title ta', async () => {
        const html = await render(mount([{ ...ROW, outputAsset: 'CAKE', expectedAmount: '6.555238737484223626', estimated: true }]).app)
        expect(html).toContain('~6.555238 CAKE')
        expect(html).toContain('title="6.555238737484223626 CAKE"')
        expect(html).not.toContain('USDC')
    })

    it('U-M9 BNB tutari 6 ondalikla kisaltilir, tam deger title ta kalir', async () => {
        const html = await render(mount([{ ...ROW, outputAsset: 'BNB', expectedAmount: '0.040512345678901234', estimated: true }]).app)
        expect(html).toContain('~0.040512 BNB')
        expect(html).not.toContain('~0.040512345678901234')
        expect(html).toContain('title="0.040512345678901234 BNB"')
    })

    // Teslim varligi yok, bos ya da dizge degilse satir USDC'ye DUSMEZ (K4/D5, FU8 ile ayni sozlesme).
    it('FU7 outputAsset yok, bos ya da dizge degilse satir USDC gostermez (yedek yok)', async () => {
        for (const bozuk of [undefined, '', null, 7, {}, ['CAKE']]) {
            const row = { ...ROW, ticket: '0xz', expectedAmount: '25.0' }
            if (bozuk === undefined) delete row.outputAsset
            else row.outputAsset = bozuk
            const html = await render(mount([row]).app)
            expect(html, String(bozuk)).not.toContain('USDC')
        }
    })

    // Cok agli teslim (gizli-mod cok-ag spec 4.8): ag rozeti deliveryChainId'den; "tahmin" yalniz estimated bayragindan.
    describe('teslim agi rozeti ve tahmin bayragi', () => {
        const badge = (html) => (html.match(/data-testid="delivery-badge"[^>]*>(?:<img[^>]*>)?([^<]*)</) || [])[1]

        it('deliveryChainId tablodaki aga denkse yerel logo ve ad cizilir (Base, BSC)', async () => {
            const html = await render(mount([
                { ...ROW, ticket: '0xa', deliveryChainId: 8453 },
                { ...ROW, ticket: '0xb', deliveryChainId: 56 },
            ]).app)
            expect(html).toContain('/chains/8453.png')
            expect(html).toContain('/chains/56.png')
            expect(html.match(/data-testid="delivery-badge"/g)).toHaveLength(2)
            expect(html).toContain('>Base<')
            expect(html).toContain('BNB Smart Chain')
        })

        it('deliveryChainId null, yok ya da tabloda olmayan deger ise rozet CIZILMEZ ve ag uydurulmaz', async () => {
            for (const deger of [null, undefined, 99999, '8453.5', 'abc']) {
                const row = { ...ROW, ticket: '0xz', deliveryChainId: deger }
                const html = await render(mount([row]).app)
                expect(html, String(deger)).not.toContain('delivery-badge')
                expect(html, String(deger)).not.toContain('BNB Smart Chain')
            }
        })

        it('rozet satirin tutar satirindan sonra gelir', async () => {
            const html = await render(mount([{ ...ROW, deliveryChainId: 8453 }]).app)
            expect(html.indexOf('25.0 USDC')).toBeGreaterThan(-1)
            expect(html.indexOf('delivery-badge')).toBeGreaterThan(html.indexOf('25.0 USDC'))
            expect(badge(html)).toBe('Base')
        })

        it('tahmin YALNIZ estimated bayragindan gelir: BNB sembolu tek basina "~" uretmez, ETH tahmini "~" ile yazilir', async () => {
            const kesin = await render(mount([{ ...ROW, outputAsset: 'BNB', expectedAmount: '0.04', estimated: false }]).app)
            expect(kesin).toContain('0.04 BNB')
            expect(kesin).not.toContain('~0.04')
            const tahmin = await render(mount([{ ...ROW, outputAsset: 'ETH', expectedAmount: '0.006153854783951967', estimated: true }]).app)
            expect(tahmin).toContain('~0.006153 ETH')
            expect(tahmin).toContain('title="0.006153854783951967 ETH"')
        })
    })

    it('aktarma ekraninin biraktigi not gosterilir ve bir kez tuketilir; bilinmeyen anahtar yok sayilir', async () => {
        const a = mount([ROW])
        pageStore().ordersNotice = 'privacy.orders.unconfirmedNotice'
        const html = await render(a.app)
        expect(html).toContain('We couldn&#39;t confirm the transfer. Check this list before trying again.')
        expect(pageStore().ordersNotice).toBeNull()

        const b = mount([ROW])
        pageStore().ordersNotice = 'privacy.baska.anahtar'
        const html2 = await render(b.app)
        expect(html2).not.toContain('privacy.baska.anahtar')
        expect(pageStore().ordersNotice).toBeNull()
    })

    // K4/D5: teslimi okunamayan satir (bozuk surum-2 dest, bilinmeyen surum, asset/decimals eksik) varlik ve tutari
    // bilmez; orderDelivery outputAsset/expectedAmount null verir. USDC ya da payoutUsdc ile cizilmez.
    it('FU8 teslimi okunamayan satir (outputAsset null) USDC yazmaz, payoutUsdc tutarini da gostermez', async () => {
        const row = { ...ROW, ticket: '0xk', outputAsset: null, expectedAmount: null, estimated: true, payoutUsdc: '25.0' }
        const html = await render(mount([row]).app)
        expect(html).not.toContain('USDC')
        expect(html).not.toContain('25.0')
    })
})

// Grafit karari (kullanici, 2026-10-26): gizli mod notr "grafit" dilinde; bu ekran yalniz gizli modda cizilir. Iade dugmesi
// amber zemin + beyaz yaziydi: 2.15:1 (WCAG AA 4.5:1'in altinda, iki temada) ve gri ekrandaki tek renkli dolu dugme. Home'daki
// Gonder'in murekkebini alir; kirmizi renk "Sorunlu" faz etiketinde kalir (FAILED siparis: iadesi acik ve sorunlu).
describe('PrivateOrders -- grafit dili: Iade dugmesi murekkep', () => {
    const IADE_SATIRI = { ticket: '0xa', createdAt: 1, phase: 'problem', payoutUsdc: '25.0', outputAsset: 'USDC', expectedAmount: '25.0', outputAddress: OUT, refundable: true }
    // Sablon yorumlari SSR ciktisina girer: once atilir. Dugme metninden bulunur (nitelik sirasina bagli kalmaz).
    const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const iadeEtiketi = (html) => yorumsuzHtml(html).match(/<button\b[^>]*>Refund<\/button>/)?.[0] ?? ''
    const siniflari = (etiket) => (etiket.match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    const DEVRE_DISI = /\sdisabled[\s>=]/

    it('Iade dugmesi Home Gonder ile ayni murekkep: acikta zinc-950 + beyaz yazi, koyuda zinc-200 + zinc-950 yazi; amber yok', async () => {
        const s = siniflari(iadeEtiketi(await render(mount([IADE_SATIRI]).app)))
        expect(s).toEqual(expect.arrayContaining(['bg-zinc-950', 'text-white', 'hover:bg-zinc-800', 'dark:bg-zinc-200', 'dark:text-zinc-950', 'dark:hover:bg-zinc-300']))
        expect(s.join(' ')).not.toMatch(/amber/)
    })

    it('Iade dugmesinde klavye odagi gorunur: iki temada focus-visible cerceve', async () => {
        const s = siniflari(iadeEtiketi(await render(mount([IADE_SATIRI]).app)))
        expect(s).toEqual(expect.arrayContaining(['focus-visible:outline-2', 'focus-visible:outline-offset-2', 'focus-visible:outline-zinc-950', 'dark:focus-visible:outline-zinc-200']))
    })

    it('KONTROL: iade surerken dugme devre disi ve sonuk, bostayken etkin', async () => {
        const bosta = iadeEtiketi(await render(mount([IADE_SATIRI]).app))
        expect(bosta).toContain('>Refund<')
        expect(bosta).not.toMatch(DEVRE_DISI)

        const { app } = mount([IADE_SATIRI])
        captureInstance(app, 'PrivateOrders', (instance) => { instance.setupState.busy = true })
        const mesgul = iadeEtiketi(await render(app))
        expect(mesgul).toMatch(DEVRE_DISI)
        expect(siniflari(mesgul)).toContain('disabled:opacity-60')
    })

    it('KONTROL: iadesi acik sorunlu satirda kirmizi "Sorunlu" (Needs attention) faz etiketi kalir', async () => {
        const html = yorumsuzHtml(await render(mount([IADE_SATIRI]).app))
        const etiket = html.match(/<span\b[^>]*>Needs attention<\/span>/)?.[0] ?? ''
        expect(siniflari(etiket)).toEqual(expect.arrayContaining(['text-red-600', 'dark:text-red-400']))
    })
})

// Durum simgeleri: her faz etiketinin onunde susludur (aria-hidden) kucuk bir simge. Pending/processing donen halka
// (motion-safe: hareket tercihi "azalt" ise donmez), done onay isareti, problem uyari dairesi, refunded geri oku.
// Sablon yorumlari SSR ciktisina girer: yorumlar atilir, simge <svg data-phase-icon="..."> etiketinden okunur.
describe('PrivateOrders -- durum simgeleri', () => {
    const SATIR = { ticket: '0xa', createdAt: 1, phase: 'processing', payoutUsdc: '25.0', outputAsset: 'USDC', expectedAmount: '25.0', outputAddress: OUT, refundable: false }
    const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const simgeler = (html) => [...yorumsuzHtml(html).matchAll(/<svg\b[^>]*\bdata-phase-icon="([^"]*)"[^>]*>/g)].map((m) => ({ ad: m[1], etiket: m[0] }))
    const siniflari = (etiket) => (etiket.match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    async function simgesi(phase, over = {}) {
        const s = simgeler(await render(mount([{ ...SATIR, phase, ...over }]).app))
        expect(s).toHaveLength(1)
        return s[0]
    }

    // Durum etiketi KISA (satir sarmaz): bekleyen yatirmanin uzun cumlesi kartin altinda ipucu satiridir (asagida "kisa durum" blogu).
    it.each([['pending', 'Confirming'], ['processing', 'In progress']])('%s: donen halka, motion-safe; kisa durum metni', async (phase, metin) => {
        const html = await render(mount([{ ...SATIR, phase }]).app)
        const [s] = simgeler(html)
        expect(s.ad).toBe('spinner')
        expect(siniflari(s.etiket)).toEqual(expect.arrayContaining(['motion-safe:animate-spin', 'w-3.5', 'h-3.5']))
        expect(s.etiket).toContain('aria-hidden="true"')
        // Halka (iz) + yay: iki parca; dolu halka (uyari) yok.
        expect(yorumsuzHtml(html)).toContain('stroke-opacity="0.25"')
        expect(yorumsuzHtml(html)).toMatch(new RegExp(`<span[^>]*>${metin}</span>`))
    })

    it('done: onay isareti, donen halka yok; bir kez cizilir (po-draw svg te); metin degismez', async () => {
        const html = await render(mount([{ ...SATIR, phase: 'done' }]).app)
        const [s] = simgeler(html)
        expect(s.ad).toBe('check')
        expect(s.etiket).not.toContain('animate-spin')
        expect(s.etiket).toContain('aria-hidden="true"')
        expect(siniflari(s.etiket)).toContain('po-draw')
        expect(yorumsuzHtml(html)).toContain('d="M5 13l4 4L19 7"')
        expect(yorumsuzHtml(html)).toMatch(/<span[^>]*>Completed<\/span>/)
    })

    it('problem: uyari dairesi, static (donmez, cizilerek gelmez); metin degismez', async () => {
        const html = await render(mount([{ ...SATIR, phase: 'problem' }]).app)
        const [s] = simgeler(html)
        expect(s.ad).toBe('alert')
        expect(s.etiket).not.toContain('animate-spin')
        expect(s.etiket).toContain('aria-hidden="true"')
        expect(siniflari(s.etiket)).not.toContain('po-draw')
        expect(yorumsuzHtml(html)).toMatch(/<span[^>]*>Needs attention<\/span>/)
    })

    it('refunded: geri oku, static; metin degismez', async () => {
        const html = await render(mount([{ ...SATIR, phase: 'refunded' }]).app)
        const [s] = simgeler(html)
        expect(s.ad).toBe('undo')
        expect(s.etiket).not.toContain('animate-spin')
        expect(s.etiket).toContain('aria-hidden="true"')
        expect(siniflari(s.etiket)).not.toContain('po-draw')
        expect(yorumsuzHtml(html)).toMatch(/<span[^>]*>Refunded<\/span>/)
    })

    it('bilinmeyen faz pending gibi donen halka olur; ham etiket yazilir', async () => {
        const html = await render(mount([{ ...SATIR, phase: 'weird' }]).app)
        const [s] = simgeler(html)
        expect(s.ad).toBe('spinner')
        expect(siniflari(s.etiket)).toContain('motion-safe:animate-spin')
        expect(yorumsuzHtml(html)).toMatch(/<span[^>]*>weird<\/span>/)
    })

    it('simge metinle ayni renkte (currentColor + faz sinifi); her kartta tam bir simge', async () => {
        const { app } = mount([
            { ...SATIR, ticket: '0x1', phase: 'processing' },
            { ...SATIR, ticket: '0x2', phase: 'done' },
            { ...SATIR, ticket: '0x3', phase: 'problem' },
            { ...SATIR, ticket: '0x4', phase: 'refunded' },
        ])
        const s = simgeler(await render(app))
        expect(s.map((x) => x.ad)).toEqual(['spinner', 'check', 'alert', 'undo'])
        const renk = (x) => siniflari(x.etiket).filter((c) => /^(dark:)?text-(slate|zinc|indigo|emerald|red|amber)-/.test(c))
        expect(renk(s[0])).toEqual(['text-indigo-600', 'dark:text-indigo-400'])
        expect(renk(s[1])).toEqual(['text-emerald-600', 'dark:text-emerald-400'])
        expect(renk(s[2])).toEqual(['text-red-600', 'dark:text-red-400'])
        expect(renk(s[3])).toEqual(['text-amber-600', 'dark:text-amber-400'])
        for (const x of s) expect(x.etiket).toContain('stroke="currentColor"')
    })

    it('hareket tercihi azaltilmissa cizim animasyonu uygulanmaz: .po-draw kurali yalniz no-preference blogunda', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./PrivateOrders.vue', import.meta.url)), 'utf8')
        const stil = kaynak.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
        const disi = stil.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, '')
        expect(stil).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.po-draw path[\s\S]*animation:/)
        expect(disi).not.toMatch(/\.po-draw[^{]*\{/)
        // Soluk-gradyan-parlama-golge yok (grafit dili).
        expect(stil).not.toMatch(/gradient|shadow|blur|glow/i)
    })
})

// Islem turu ve yonu: arka plan satira `kind` (send / fund / swap / bridge / null), `sourceAsset`, `counterpartName` ve
// `counterpartAddress` koyar (orderKind.js). Tur biliniyorsa ust satir turu yazar, tutar + teslim agi ikinci, "ne nereye gitti" ucuncu
// satira iner (tarih sagda kalir). Tur yoksa kart ESKI haliyle cizilir (tutar ust satirda, ag rozeti, adres + tarih).
describe('PrivateOrders -- islem turu ve yonu', () => {
    const WATS = '0x80B0fa700545984aF65dF8116aD329aF7952E73F'
    const KAYNAK = '0x' + '12'.repeat(20)
    const KART = {
        ticket: '0xk', createdAt: new Date(2026, 9, 3, 12, 56).getTime(), phase: 'done', payoutUsdc: '11.934759', outputAsset: 'USDC',
        expectedAmount: '11.934759', estimated: true, deliveryChainId: 56, sourceChainId: 56, outputAddress: WATS, refundable: false,
    }
    // Her tur icin arka planin dondurecegi alanlar ve iki dilde beklenen metinler.
    const TURLER = {
        gonder: { alanlar: { kind: 'send', sourceAsset: 'USDC', counterpartName: 'Wats 1', counterpartAddress: WATS }, en: ['Private send', 'To Wats 1 · 0x80B0...E73F'], tr: ['Gizli gönderim', 'Alıcı: Wats 1 · 0x80B0...E73F'] },
        gonderYabanci: { alanlar: { kind: 'send', sourceAsset: 'USDC', counterpartName: null, counterpartAddress: WATS }, en: ['Private send', 'To 0x80B0...E73F'], tr: ['Gizli gönderim', 'Alıcı: 0x80B0...E73F'] },
        yukle: { alanlar: { kind: 'fund', sourceAsset: 'USDC', counterpartName: 'Wats 1', counterpartAddress: KAYNAK, outputAddress: '0x' + 'cd'.repeat(20) }, en: ['Add funds', 'From Wats 1'], tr: ['Gizli Hesaba yükleme', 'Kaynak: Wats 1'] },
        yukleAdsiz: { alanlar: { kind: 'fund', sourceAsset: 'USDC', counterpartName: null, counterpartAddress: KAYNAK, outputAddress: '0x' + 'cd'.repeat(20) }, en: ['Add funds', 'From 0x1212...1212'], tr: ['Gizli Hesaba yükleme', 'Kaynak: 0x1212...1212'] },
        takas: { alanlar: { kind: 'swap', sourceAsset: 'USDC', counterpartName: null, counterpartAddress: null, outputAsset: 'USDT' }, en: ['Private swap', 'USDC → USDT'], tr: ['Gizli takas', 'USDC → USDT'] },
        kopru: { alanlar: { kind: 'bridge', sourceAsset: 'ETH', counterpartName: null, counterpartAddress: null, sourceChainId: 1, deliveryChainId: 8453 }, en: ['Private bridge', 'ETH · Ethereum → Base'], tr: ['Gizli köprü', 'ETH · Ethereum → Base'] },
        kopruVarliksiz: { alanlar: { kind: 'bridge', sourceAsset: null, counterpartName: null, counterpartAddress: null, sourceChainId: 56, deliveryChainId: 8453 }, en: ['Private bridge', 'BNB Smart Chain → Base'], tr: ['Gizli köprü', 'BNB Smart Chain → Base'] },
    }
    const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const parca = (html, id) => (yorumsuzHtml(html).match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`)) || [])[1]
    const kartHtml = (html) => yorumsuzHtml(html).match(/<article\b[\s\S]*?<\/article>/)?.[0] ?? ''
    const siniflari = (etiket) => (etiket.match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    const goster = async (over, locale = 'en') => render(mount([{ ...KART, ...over }], { locale }).app)

    describe.each([['en', 'Completed'], ['tr', 'Tamamlandı']])('%s', (locale, durum) => {
        it.each(Object.entries(TURLER))('%s: baslik, tutar + ag, yon satiri, durum ve tarih', async (_ad, tur) => {
            const html = await goster(tur.alanlar, locale)
            const [baslik, yon] = tur[locale]
            expect(parca(html, 'order-kind')).toBe(baslik)
            expect(parca(html, 'order-detail')).toBe(yon)
            // Tutar ikinci satirda, teslim agi onun yaninda; durum metni (simgeli) degismedi.
            expect(parca(html, 'order-amount')).toBe(`~11.934759 ${tur.alanlar.outputAsset ?? 'USDC'}`)
            expect(yorumsuzHtml(html)).toContain('data-testid="delivery-badge"')
            expect(yorumsuzHtml(html)).toMatch(new RegExp(`<span[^>]*>${durum}</span>`))
            expect(yorumsuzHtml(html)).toContain('data-phase-icon="check"')
            // Ham anahtar yolu cizilmez.
            expect(html).not.toContain('privacy.orders')
        })
    })

    it('satir sirasi: baslik, durum, tutar, ag rozeti, yon, tarih (tarih yon satirinin sagindadir)', async () => {
        const html = yorumsuzHtml(await goster(TURLER.gonder.alanlar))
        const sira = ['order-kind', 'Completed', 'order-amount', 'delivery-badge', 'order-detail', 'Oct 3']
            .map((parca2) => html.indexOf(parca2))
        expect(sira.every((i) => i > -1), JSON.stringify(sira)).toBe(true)
        expect(sira).toEqual([...sira].sort((a, b) => a - b))
        // Tutar ve rozet AYNI satirda (ayni kapsayici), yon ve tarih ayni satirda.
        const tutarSatiri = html.match(/<div class="flex items-center gap-2 min-w-0 whitespace-nowrap"[^>]*>(?:(?!<\/div>)[\s\S])*<\/div>/)?.[0] ?? ''
        expect(tutarSatiri).toContain('data-testid="order-amount"')
        expect(tutarSatiri).toContain('data-testid="delivery-badge"')
        const yonSatiri = html.match(/<div class="flex justify-between gap-3 text-\[11px\][^"]*"[^>]*>(?:(?!<\/div>)[\s\S])*<\/div>/)?.[0] ?? ''
        expect(yonSatiri).toContain('data-testid="order-detail"')
        expect(yonSatiri).toMatch(/Oct 3/)
    })

    it('yon metni uzun adla tasmaz sarilir; tarih kisalmaz ve sarilmaz', async () => {
        const html = await goster({ ...TURLER.gonder.alanlar, counterpartName: 'Cok uzun bir hesap adi '.repeat(4).trim() })
        const detay = yorumsuzHtml(html).match(/<span[^>]*data-testid="order-detail"[^>]*>/)[0]
        expect(siniflari(detay)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']))
        const tarih = yorumsuzHtml(html).match(/<span[^>]*>Oct 3[^<]*<\/span>/)?.[0] ?? ''
        expect(siniflari(tarih)).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']))
    })

    it('tur yoksa kart ESKI haliyle cizilir: kind null, undefined ya da bilinmeyen deger ile alansiz satir AYNI HTML', async () => {
        const alansiz = kartHtml(await goster({}))
        for (const kind of [null, undefined, 'bilinmeyen', 'constructor', 5, '']) {
            const html = await goster({ kind, sourceAsset: 'USDC', counterpartName: 'Wats 1', counterpartAddress: WATS })
            expect(kartHtml(html), String(kind)).toBe(alansiz)
            expect(html, String(kind)).not.toContain('order-kind')
            expect(html, String(kind)).not.toContain('order-detail')
        }
        // Eski kart: tutar ust satirda (kalin), rozet tutar satirindan sonra ve kendi satirinda, adres + tarih son satirda.
        expect(alansiz).toMatch(/<span class="font-bold min-w-0 truncate"[^>]*>~11\.934759 USDC<\/span>/)
        expect(alansiz).toMatch(/data-testid="delivery-badge" class="inline-flex items-center gap-1\.5 self-start/)
        expect(alansiz).toMatch(/<span[^>]*>0x80B0\.\.\.E73F<\/span>/)
        expect(alansiz).not.toContain('order-amount')
    })

    it('eksik veri bos yon metni verir, satir cokmez ve tarih yerinde kalir (yoksa tahmin yazilmaz)', async () => {
        const vakalar = [
            ['gonder, adres yok', { kind: 'send', counterpartAddress: null, outputAddress: undefined }],
            ['yukle, kaynak yok', { kind: 'fund', counterpartName: null, counterpartAddress: null }],
            ['takas, kaynak varlik yok', { kind: 'swap', sourceAsset: null }],
            ['takas, teslim varligi yok', { kind: 'swap', sourceAsset: 'USDC', outputAsset: null }],
            ['kopru, kaynak zincir okunamiyor', { kind: 'bridge', sourceChainId: 'abc', deliveryChainId: 8453 }],
            ['kopru, teslim agi yok', { kind: 'bridge', sourceChainId: 1, deliveryChainId: null }],
        ]
        for (const [ad, over] of vakalar) {
            const html = await goster(over)
            expect(parca(html, 'order-detail'), ad).toBe('')
            expect(parca(html, 'order-kind'), ad).toMatch(/^(Private send|Add funds|Private swap|Private bridge)$/)
            expect(yorumsuzHtml(html), ad).toContain('Oct 3')
        }
    })

    it('Para yukle: Gizli Hesap adresi (teslim adresi) karsi taraf diye ASLA yazilmaz; gonderide ise teslim adresine dusulur', async () => {
        const gizli = '0x' + 'cd'.repeat(20)
        const yukle = await goster({ kind: 'fund', counterpartName: null, counterpartAddress: null, outputAddress: gizli })
        expect(parca(yukle, 'order-detail')).toBe('')
        expect(yorumsuzHtml(yukle)).not.toContain('0xcdcd...cdcd')
        const gonder = await goster({ kind: 'send', counterpartName: null, counterpartAddress: null, outputAddress: WATS })
        expect(parca(gonder, 'order-detail')).toBe('To 0x80B0...E73F')
    })

    it('yabanci adrese ad yazilmaz: ad yalniz arka planin counterpartName alanindan gelir', async () => {
        const html = await goster({ kind: 'send', counterpartName: null, counterpartAddress: WATS })
        expect(parca(html, 'order-detail')).toBe('To 0x80B0...E73F')
        expect(html).not.toContain('Wats')
    })

    it('Iade dugmesi, ipucu ve faz simgesi tur ile birlikte aynen durur', async () => {
        const html = yorumsuzHtml(await goster({ ...TURLER.gonder.alanlar, phase: 'problem', refundable: true }))
        expect(html).toMatch(/<button\b[^>]*>Refund<\/button>/)
        expect(html).toContain('data-phase-icon="alert"')
        expect(html).toMatch(/<span[^>]*>Needs attention<\/span>/)
        const ipucu = yorumsuzHtml(await goster({ ...TURLER.yukle.alanlar, phase: 'problem', refundable: false, refundOpensLater: true }))
        expect(ipucu).toContain('A refund opens after the order expires.')
        const gonderilmedi = yorumsuzHtml(await goster({ ...TURLER.kopru.alanlar, phase: 'problem', refundable: false, depositFailed: true }))
        // Kesme isareti SSR cikti dizgesinde &#39; olarak kacirilir: cumlenin kesmeden onceki kismi aranir.
        expect(gonderilmedi).toContain('The deposit didn')
    })

    it('grafit dili: tur duzeninde gradyan, golge, parlama ve bulaniklik sinifi yok; renk yalniz durum metninde ve simgesinde', async () => {
        for (const tur of Object.values(TURLER)) {
            const kart = kartHtml(await goster(tur.alanlar))
            expect(kart).not.toMatch(/gradient|shadow|blur|glow|\bring-|violet|backdrop/)
        }
        // Baslik, tutar ve yon satiri renkli sinif tasimaz: renk yalniz faz sinifindan (done: emerald) gelir.
        const kart = kartHtml(await goster(TURLER.gonder.alanlar))
        for (const id of ['order-kind', 'order-amount', 'order-detail']) {
            const etiket = kart.match(new RegExp(`<span[^>]*data-testid="${id}"[^>]*>`))[0]
            expect(siniflari(etiket).join(' '), id).not.toMatch(/emerald|red-|amber|indigo|violet/)
        }
        expect(kart.match(/emerald-600/g)).toHaveLength(2) // simge + durum metni
    })
})

// Kisa durum, tek satir tutar, teslim tokeni logosu (sahip duzeltmesi: gercek Turkce ekranda uzun "Yatirma gonderildi, onay bekleniyor"
// iki satira sarip tutari da iki satira sikistiriyor, donen halka kartin ortasinda yuzuyordu).
describe('PrivateOrders -- kisa durum, tek satir tutar ve token logosu', () => {
    const WATS = '0x80B0fa700545984aF65dF8116aD329aF7952E73F'
    const SATIR = {
        ticket: '0xs', createdAt: new Date(2026, 9, 3, 12, 56).getTime(), phase: 'done', payoutUsdc: '16.613576', outputAsset: 'USDC',
        expectedAmount: '16.613576', estimated: true, deliveryChainId: 56, sourceChainId: 56, outputAddress: WATS, refundable: false,
        kind: 'send', sourceAsset: 'USDC', counterpartName: 'Wats 1', counterpartAddress: WATS,
    }
    const KISA = {
        en: { pending: 'Confirming', processing: 'In progress', done: 'Completed', problem: 'Needs attention', refunded: 'Refunded' },
        tr: { pending: 'Onaylanıyor', processing: 'İşleniyor', done: 'Tamamlandı', problem: 'Sorunlu', refunded: 'İade edildi' },
    }
    const UZUN = { en: 'Deposit sent, awaiting confirmation', tr: 'Yatırma gönderildi, onay bekleniyor' }
    const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const siniflari = (etiket) => (etiket.match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    const goster = async (over, locale = 'en') => yorumsuzHtml(await render(mount([{ ...SATIR, ...over }], { locale }).app))
    // Durum grubu: simge + etiket (data-testid="order-status").
    const grup = (html) => html.match(/<span[^>]*data-testid="order-status"[^>]*>(?:(?!<\/span><\/span>)[\s\S])*<\/span><\/span>/)?.[0] ?? ''
    const etiketi = (html) => (grup(html).match(/<\/svg><span[^>]*>([^<]*)<\/span><\/span>$/) || [])[1]
    const ipuclari = (html) => [...html.matchAll(/<p class="text-\[11px\] text-slate-500 dark:text-zinc-400"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1])

    describe.each([['en'], ['tr']])('%s', (locale) => {
        it.each(['pending', 'processing', 'done', 'problem', 'refunded'])('%s: durum grubu simge + KISA etiket, sarmaz ve kisalmaz; simge metnin hemen yaninda', async (phase) => {
            for (const kind of ['send', null]) {
                const html = await goster({ phase, kind }, locale)
                expect(etiketi(html), `${phase}/${kind}`).toBe(KISA[locale][phase])
                const etiket = grup(html).match(/^<span[^>]*>/)[0]
                expect(siniflari(etiket)).toEqual(expect.arrayContaining(['inline-flex', 'items-center', 'shrink-0', 'whitespace-nowrap']))
                // Simge ile etiket arasinda baska oge yok: `</svg><span` bitisik.
                expect(grup(html)).toMatch(/<svg[^>]*aria-hidden="true"[\s\S]*<\/svg><span/)
                // Durum grubunun metni kisa: uzun cumle grubun icinde ASLA yer almaz.
                expect(grup(html)).not.toContain(UZUN[locale])
            }
        })

        it('bekleyen yatirma: uzun cumle kartin altinda soluk ipucu satiri (iki duzende de); bilgi kaybolmaz', async () => {
            for (const kind of ['send', 'fund', 'swap', 'bridge', null]) {
                const html = await goster({ phase: 'pending', kind }, locale)
                expect(ipuclari(html), String(kind)).toEqual([UZUN[locale]])
                // Ipucu satiri tarih satirindan SONRA gelir (kartin en altinda, Iade dugmesinden once).
                const tarih = new Date(SATIR.createdAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                expect(html.indexOf(tarih), `${kind} tarih`).toBeGreaterThan(-1)
                expect(html.indexOf(UZUN[locale]), String(kind)).toBeGreaterThan(html.indexOf(tarih))
            }
        })
    })

    it('ipucu yalniz bekleyen yatirmada: tamamlanan, islenen ve iadeli satir uzun cumleyi yazmaz; baska ipucu varsa o onceliklidir', async () => {
        for (const phase of ['processing', 'done', 'refunded']) expect(ipuclari(await goster({ phase })), phase).toEqual([])
        // depositFailed baska bir ipucu verir: tek ipucu (ikisi birden degil).
        const gonderilmedi = await goster({ phase: 'pending', depositFailed: true })
        expect(ipuclari(gonderilmedi)).toHaveLength(1)
        expect(ipuclari(gonderilmedi)[0]).toContain("The deposit didn")
        expect(gonderilmedi).not.toContain('Deposit sent, awaiting confirmation')
    })

    it('en kotu durum (gercek Turkce, bekleyen, uzun tutar): baslik, durum, tutar ve ag tek satir; hicbiri sarmaz', async () => {
        const html = await goster({ phase: 'pending', expectedAmount: '16613576.613576', payoutUsdc: '16613576.613576' }, 'tr')
        expect(etiketi(html)).toBe('Onaylanıyor')
        const baslik = html.match(/<span[^>]*data-testid="order-kind"[^>]*>/)[0]
        expect(siniflari(baslik)).toEqual(expect.arrayContaining(['font-bold', 'min-w-0', 'truncate']))
        const tutar = html.match(/<span[^>]*data-testid="order-amount"[^>]*>([^<]*)<\/span>/)
        expect(siniflari(tutar[0])).toEqual(expect.arrayContaining(['tabular-nums', 'truncate', 'min-w-0']))
        // Tam deger title'da (kesilirse okunabilsin).
        expect(tutar[0]).toContain('title="16613576.613576 USDC"')
        const satir = html.match(/<div class="flex items-center gap-2 min-w-0 whitespace-nowrap"/)
        expect(satir).not.toBeNull()
        // Ag adi once kisalir: tutardan once kucuk olur ve truncate tasir; tutar ile logo kisalmaz onceligi alir.
        const ag = html.match(/<span class="flex items-baseline gap-1 min-w-0 shrink-\[4\][^"]*"/)
        expect(ag).not.toBeNull()
        expect(html).toMatch(/data-testid="delivery-badge"[^>]*class="truncate"|class="truncate"[^>]*data-testid="delivery-badge"/)
        // Uzun cumle yalniz ipucunda (tek <p>), durum grubunda degil.
        expect(ipuclari(html)).toEqual(['Yatırma gönderildi, onay bekleniyor'])
    })

    it('kopru yon satiri: kaynak varlik oneki yalniz satira sigarsa eklenir (uzun ag adi cifti iki satira tasmaz)', async () => {
        const detay = async (over, locale = 'en') => (await goster({ kind: 'bridge', counterpartName: null, counterpartAddress: null, ...over }, locale)).match(/data-testid="order-detail"[^>]*>([^<]*)</)[1]
        expect(await detay({ sourceChainId: 56, deliveryChainId: 8453 })).toBe('USDC · BNB Smart Chain → Base')
        // 42161 -> 56: varlik oneki ile 37 karakter (tarihle birlikte sigmaz): yalniz ag rotasi.
        expect(await detay({ sourceChainId: 42161, deliveryChainId: 56 })).toBe('Arbitrum One → BNB Smart Chain')
        expect(await detay({ sourceChainId: 42161, deliveryChainId: 56 }, 'tr')).toBe('Arbitrum One → BNB Smart Chain')
        // Kaynak varlik hic yoksa yine yalniz ag rotasi.
        expect(await detay({ sourceChainId: 1, deliveryChainId: 8453, sourceAsset: null })).toBe('Ethereum → Base')
    })

    it('eski kart (tur yok): tutar da sarmaz (truncate), durum grubu kisa ve sabit', async () => {
        const html = await goster({ kind: null, phase: 'pending' }, 'tr')
        const tutar = html.match(/<span class="font-bold min-w-0 truncate"[^>]*>~16\.613576 USDC<\/span>/)
        expect(tutar).not.toBeNull()
        expect(etiketi(html)).toBe('Onaylanıyor')
    })

    describe('teslim tokeni logosu (PrivateTokenLogo, 20 px) tutarin solunda', () => {
        const logolar = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => ({ src: m[0].match(/\bsrc="([^"]*)"/)?.[1], etiket: m[0] }))
        const logoBolumu = (html) => html.match(/data-testid="order-token-logo"[\s\S]*?<\/span>/)?.[0] ?? ''

        it('USDC: paketli USDC logosu + ag rozeti; 20 px boyut ve 12 px rozet; tutardan ONCE gelir', async () => {
            const html = await goster({})
            const bolum = logoBolumu(html)
            const imgs = logolar(bolum)
            expect(imgs.map((i) => i.src)).toEqual(['/usdc.png', '/chains/56.png'])
            expect(imgs[0].etiket).toMatch(/class="w-5 h-5 rounded-full/)
            expect(imgs[1].etiket).toMatch(/class="absolute [^"]*w-3 h-3 rounded-full/)
            expect(html.indexOf('data-testid="order-token-logo"')).toBeLessThan(html.indexOf('data-testid="order-amount"'))
            // Ag adi yazi olarak yaninda kalir.
            expect(html).toMatch(/data-testid="delivery-badge"[^>]*>BNB Smart Chain</)
        })

        it('yerel coin COININ logosu (ag yalniz rozette); paketli dosyasi olan token yerel logosu; sembol yedegi (DAI, USDT); xDAI, ATS; cozulemeyen yedek simge', async () => {
            const bolum = async (over) => logolar(logoBolumu(await goster(over)))
            const src = async (over) => (await bolum(over))[0].src
            // Base'te ETH: buyuk logo ETH (Ethereum elmasi), Base logosu yalniz kucuk rozette.
            const eth = await bolum({ outputAsset: 'ETH', deliveryChainId: 8453, expectedAmount: '0.004312' })
            expect(eth.map((i) => i.src)).toEqual(['/chains/1.png', '/chains/8453.png'])
            expect(await src({ outputAsset: 'ETH', deliveryChainId: 42161 })).toBe('/chains/1.png')
            expect(await src({ outputAsset: 'ETH', deliveryChainId: 10 })).toBe('/chains/1.png')
            expect(await src({ outputAsset: 'BNB', deliveryChainId: 56 })).toBe('/chains/56.png')
            expect(await src({ outputAsset: 'USDT', deliveryChainId: 1 })).toBe('/tokens/1/0xdac17f958d2ee523a2206206994597c13d831ec7.png')
            // BSC USDT'nin adres tabanli dosyasi yok: sembolun paketli (Ethereum USDT) logosu, yedek simge degil.
            const usdt = await bolum({ outputAsset: 'USDT', deliveryChainId: 56, expectedAmount: '14.82' })
            expect(usdt.map((i) => i.src)).toEqual(['/tokens/1/0xdac17f958d2ee523a2206206994597c13d831ec7.png', '/chains/56.png'])
            // DAI (Ethereum) paketli kendi dosyasi, Base'te de ayni tokenin logosu; xDAI Gnosis baykusu degil kendi logosu; ATS /ats.png.
            expect(await src({ outputAsset: 'DAI', deliveryChainId: 1 })).toBe('/tokens/1/0x6b175474e89094c44da98b954eedeac495271d0f.png')
            expect((await bolum({ outputAsset: 'DAI', deliveryChainId: 8453 })).map((i) => i.src)).toEqual(['/tokens/1/0x6b175474e89094c44da98b954eedeac495271d0f.png', '/chains/8453.png'])
            expect((await bolum({ outputAsset: 'XDAI', deliveryChainId: 100 })).map((i) => i.src)).toEqual(['/tokens/100/0x0000000000000000000000000000000000000000.png', '/chains/100.png'])
            expect(await src({ outputAsset: 'ATS', deliveryChainId: 56 })).toBe('/ats.png')
            // Gercekten bilinmeyen token (CAKE: kayit defterinde ve paketli adres tablosunda sembolle bulunmaz) yedek simge; rozet yine agin logosu.
            expect(await src({ outputAsset: 'CAKE', deliveryChainId: 56 })).toBe('/default-token.png')
        })

        it('logo hicbir zaman uzak adres degildir; yuklenemezse onerror ile yedek simge (PrivateTokenLogo)', async () => {
            const html = await goster({ outputAsset: 'CAKE' })
            for (const img of logolar(logoBolumu(html))) expect(img.src).toMatch(/^\//)
            expect(logoBolumu(html)).toContain('referrerpolicy="no-referrer"')
        })

        it('ag okunamiyorsa rozet yok (logo yine cizilir); teslim varligi yoksa logo hic cizilmez', async () => {
            const agsiz = await goster({ deliveryChainId: null })
            expect(logolar(logoBolumu(agsiz)).map((i) => i.src)).toEqual(['/usdc.png'])
            expect(agsiz).not.toContain('delivery-badge')
            const varliksiz = await goster({ outputAsset: null, expectedAmount: null })
            expect(varliksiz).not.toContain('order-token-logo')
            expect(varliksiz).toMatch(/data-testid="order-amount"[^>]*>—</)
        })

        it('eski kart (tur yok) logo cizmez ve ag rozeti kendi satirinda (yerel ag logosu + ad) kalir', async () => {
            const html = await goster({ kind: null })
            expect(html).not.toContain('order-token-logo')
            expect(html).toMatch(/data-testid="delivery-badge" class="inline-flex[^"]*self-start/)
        })
    })
})
