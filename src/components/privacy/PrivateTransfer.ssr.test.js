import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
// Gizli Hesap'in gecmisi/itibari sunucumuza ve GoPlus'a ASLA gitmemeli (Plan 1 C-I5):
// ag cagrilari sahtelenir ve cagrilmadiklari kilitlenir.
vi.mock('../../utils/historyRecipients', () => ({ fetchHistoryCounterparties: vi.fn(async () => []) }))
// Gonder acilisinda loadTrusted'in hangi agla cagrildigini gozlemek icin gercek kompozitin ustune ince bir gozlemci (gecmis sorgusu
// Gizli Hesapta ZATEN atlandigindan fetchHistoryCounterparties bu bilgiyi gostermez). Davranis aynen gercek loadTrusted'e gecer.
const trustedCalls = vi.hoisted(() => vi.fn())
vi.mock('../../composables/useAddressSecurity', async (importOriginal) => {
    const real = await importOriginal()
    return {
        ...real,
        useAddressSecurity: (...args) => {
            const r = real.useAddressSecurity(...args)
            return { ...r, loadTrusted: (...a) => { trustedCalls(...a); return r.loadTrusted(...a) } }
        },
    }
})
vi.mock('../../utils/addressReputation', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchReputation: vi.fn(async () => ({ severity: null, flags: [], sources: [] })),
}))
// Kaynak bakiyesi (Task 8) zincirden okur: SSR testlerinde gercek RPC YOK (X14). Bakiye setupState'ten surulur
// (captureInstance geri cagrisinda `s.balance = 10`); girdiler balanceCalls'ta gozlenir.
const balanceCalls = vi.hoisted(() => vi.fn())
vi.mock('../../composables/usePrivateSourceBalance', async () => {
    const { ref } = await import('vue')
    return {
        usePrivateSourceBalance: (args) => {
            balanceCalls(args)
            return { balance: ref(null), loading: ref(false), refresh: vi.fn() }
        },
    }
})

// ATS Al dugmesi (Task 19): satis yolu "canli" ve PRIVATE_ATS_SALE bayragi testten surulur (AtsBuyButton.ssr.test.js deseni). Gizli modda bayrak KAPALI iken
// bilesen dugme yerine privacy.atsSale.blocked satirini cizer; bayrak ACIK ise "Buy ATS" dugmesi. Tiklama sayilir (X19: varsayilan eylem).
const satis = vi.hoisted(() => ({ live: true, flag: false, open: vi.fn(async () => true) }))
vi.mock('../../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return satis.flag },
}))
vi.mock('../../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: satis.live, open: satis.open }),
}))

// Koprulu kaynaklar da uretimde KAPALI (PRIVATE_BRIDGED_SOURCES=false): sabit kendi modulundedir
// (privateBridgedSources.js); kapi yardimcilari onu oradan okur, ilgili testler o modulu mock'layip acik durumu taklit eder.
const flags = vi.hoisted(() => ({ bridged: false, native: false, sendSources: null }))
vi.mock('../../utils/privacy/privateBridgedSources', async (importOriginal) => {
    const real = await importOriginal()
    return {
        ...real,
        get PRIVATE_BRIDGED_SOURCES() { return flags.bridged },
        // Teslim degismezi (1.10): hangi aglarin Gonder kaynagi oldugu testin elindedir (null = gercek tablo).
        hasPrivateSendSource: (id) => (flags.sendSources === null ? real.hasPrivateSendSource(id) : flags.sendSources.includes(id)),
    }
})
vi.mock('../../utils/privacy/silentswapConfig', async (importOriginal) => {
    const real = await importOriginal()
    return {
        ...real,
        // Uretimde S3 ile ACIK (2026-10-10); testler gaz notu dallarini ayri ayri sinamak icin kapali baslatir.
        get PRIVATE_DEST_NATIVE() { return flags.native },
    }
})

import { getAddress, isAddress } from 'ethers'
import { defineComponent, h, ref, watch } from 'vue'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { useAddressSecurity } from '../../composables/useAddressSecurity'
import { shortenAddress } from '../../utils/shortenAddress'
import { yorumsuz, cagriGovdesi } from '../../test-utils/kaynakTarama.js'
import { privacyStore } from '../../store/privacy'
import { pageStore } from '../../store/pageStore'
import { fetchHistoryCounterparties } from '../../utils/historyRecipients'
import { fetchReputation } from '../../utils/addressReputation'
import { PAYOUT_CHAIN_ID, MIN_PAYOUT_USDC } from '../../utils/privacy/silentswapConfig'
import { QUOTE_MIN_REMAINING_MS } from '../../utils/privacy/privateConstants'
import { DISCRETE_DEBOUNCE_MS, QUOTE_COOLDOWN_MS } from '../../utils/privacy/quoteScheduler'
import { percentChipAmount } from '../../utils/privacy/feeBreakdown'
import { resolveAtsBlocker } from '../../utils/atsBlocker'
import { privacyDecision } from '../../utils/privacy/privacyGate'
import PrivateTransfer from './PrivateTransfer.vue'

const GIZLI = '0x' + 'cd'.repeat(20)
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), name: 'Hesap 1', type: 'hd' }
const LEGACY_TON = { key: 't-1', address: 'EQ' + 'x'.repeat(46), name: 'Eski TON', type: 'ton' }
// A.address ile ayni bas/son 4 karakter, farkli orta: zehirli ikiz.
const LOOKALIKE = '0x' + 'abab' + '1'.repeat(32) + 'abab'
const STRANGER = '0x' + '7'.repeat(40)
const USDC_TOKEN = { chainId: 56, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 }
const CAKE_TOKEN = { chainId: 56, address: getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'), symbol: 'CAKE', decimals: 18 }
const SUMMARY = { ticket: '0xt', payoutUsdc: '25.0', totalUsdc: '25.25', serviceFeeUsdc: '0.175', integratorFeeUsdc: '0.075', integratorAddress: '0x' + '99'.repeat(20), expiresAtMs: Date.now() + 600000, expectedFulfillmentMs: 90000, recipient: GIZLI, recipientChainId: 56, sourceInput: { amount: '25250000000000000000', asset: 'USDC', decimals: 18, chainId: 56 },
    // Teslim ozeti HER ZAMAN dolu gelir (C1 Task 8): ag, sembol ve ondalik secimden; ekran eksik ozeti PRIVATE_QUOTE_MISMATCH ile reddeder.
    dest: { chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '24650000000000000000', minDestAmount: '24000000000000000000', quoteUsd: null } }

beforeEach(() => { vi.clearAllMocks(); flags.bridged = false; flags.native = false; flags.sendSources = null; satis.live = true; satis.flag = false })
afterEach(() => { delete globalThis.chrome })

// SSR'da izleyiciler (watch) render'dan sonra TETIKLENMEZ; yalniz `immediate` ilk
// calisma olur. useAddressSecurity'nin ilk itibar kontrolu asenkron biter -- bitmeden
// `blocked` true kalir ve send modunda teklif istenmez.
const flush = () => new Promise((r) => setTimeout(r, 0))

// providerInfo: PRIVATE_PROVIDER_INFO cevabi. undefined -> ekran bos `{ success: true }` alir (info yok -> null); nesne -> { success: true, info }.
// Bu mesaj `sent` listesine GIRMEZ (indeksli iddialar teklif/siparis sirasini okur): ayri `infoSent` listesinde tutulur.
// ats: ATS_PRIVATE_FEE_QUOTE cevabi (Task 18, X7). undefined -> hazir ucret (ATS_READY); nesne ya da (msg) => cevap. Bu mesaj da `sent` e GIRMEZ:
// `atsSent` listesinde tutulur; `timeline` teklif/siparis/ucret mesajlarinin SIRASINI yazar (ucret girdisi 'ATS:<ticket>').
const ATS_READY = { success: true, transferFee: 19.7, symbol: 'ATS', atsBalance: 100, opCount: 1, ready: true, nextSteps: [], commissionAts: '0', commissionAtsHuman: 0, commissionRegion: 'local', maxAtsSellRaw: '97' }
function mount(mode, { reply, accounts = [A], active = true, providerInfo, ats, locale = 'en' } = {}) {
    const stub = installChromeStub({
        vaults: [{ accounts, privateAccount: { key: 'g-1', address: GIZLI, private: true, type: 'hd', name: 'Private Account' } }],
        privacy_mode: { lastPublicAccountKey: 'a-1' },
        // Gizli moddayiz: aktif hesap Gizli Hesap (loadTrusted uzak gecmisi bu kayda bakarak atlar).
        active_account: { key: 'g-1', address: GIZLI, private: true },
    })
    const sent = []
    const infoSent = []
    const atsSent = []
    const timeline = []
    stub.setSendMessage(async (msg) => {
        if (msg.type === 'PRIVATE_PROVIDER_INFO') {
            infoSent.push(msg)
            if (providerInfo === 'throw') throw new Error('sw yeniden basliyor')
            if (providerInfo !== undefined) return providerInfo
            return { success: true }
        }
        if (msg.type === 'ATS_PRIVATE_FEE_QUOTE') {
            atsSent.push(msg)
            timeline.push('ATS:' + msg.message.ticket)
            return typeof ats === 'function' ? ats(msg) : (ats ?? ATS_READY)
        }
        sent.push(msg)
        timeline.push(msg.type)
        if (reply) return reply(msg)
        // Varsayilan teklif cevabi istegin teslim tokenine gore kurulur (arka plan agi, sembolu ve ondaligi secimden yazar): ekran eslesme
        // denetimi (quoteDeliveryOk) agi, sembolu ve ondaligi istekle karsilastirir; sabit bir USDC ozeti baska token secen testlerde
        // (CAKE secimi gibi) yersiz PRIVATE_QUOTE_MISMATCH uretirdi.
        if (msg.type === 'PRIVATE_QUOTE') {
            const t = msg.message.outputToken
            return { success: true, quote: { ...SUMMARY, recipient: msg.message.outputAddress, recipientChainId: t.chainId, dest: { ...SUMMARY.dest, chainId: t.chainId, asset: t.symbol, decimals: t.decimals } } }
        }
        if (msg.type === 'PRIVATE_ORDER') return { success: true, ticket: '0xt', hash: '0xh' }
        return { success: true }
    })
    const app = createApp(PrivateTransfer, { props: { mode } })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    Object.assign(privacyStore(), { active, privateAddress: GIZLI, privateAccountKey: 'g-1' })
    // Kullanici bu ekrandadir: onay sonrasi yonlendirme yalniz hala burada ise yapilir (U-M6).
    pageStore().currentPage = mode === 'fund' ? 'private_fund' : 'private_send'
    pageStore().ordersNotice = null
    const captured = captureInstance(app, 'PrivateTransfer')
    return { app, captured, sent, infoSent, atsSent, timeline, stub }
}

// Teklifi dogrudan setupState'e yazan cizim testleri icin etkin ATS ucret yuvasini hazir kurar (Task 18: onay dugmesi ucrete de bagli).
const atsHazirla = (s, ticket = SUMMARY.ticket) => {
    const f = s.feeSlots[0]
    f.atsFee.value = 19.7
    f.ready.value = true
    f.atsBalance.value = 100
    s.atsTicket = ticket
}

async function ready(mode, opts) {
    const m = mount(mode, opts)
    await render(m.app)
    await flush()
    return { ...m, s: m.captured.instance.setupState }
}

// Otomatik teklif (Task 15): "Teklif al" dugmesi yok; teklif zamanlayicidan gelir. Bu yardimci bir ayrik girdi bildirir ve sahte saati
// teklif bitene (ready/error/rateWait/expired/idle) kadar ilerletir. Yalniz kendi cagrisi suresince sahte zamanlayici kurar: testin
// geri kalani gercek zamanlayicida (ready/flush) kalir. Ucustaki cevabi disaridan bekleten testler bunu KULLANMAZ.
async function quoteAl(s) {
    vi.useFakeTimers()
    try {
        s.onQuoteInput('discrete')
        for (let i = 0; i < 200 && ['waiting', 'quoting'].includes(s.phase); i++) await vi.advanceTimersByTimeAsync(400)
    } finally {
        vi.useRealTimers()
    }
    // Teklif sonrasi ATS ucret yaniti (Task 18) birkac mikro gorev sonra yerlesir: gercek zamanlayicida bir tur beklenir.
    await flush()
}

describe('PrivateTransfer', () => {
    it('fund: Gizli Hesap\'a teklif ister, sonra yalniz ticket ile siparis verir', async () => {
        const { s, sent, stub } = await ready('fund')
        s.amount = '25'
        await quoteAl(s)
        expect(sent[0]).toMatchObject({ type: 'PRIVATE_QUOTE', message: { sourceAccountKey: 'a-1', outputAddress: GIZLI, payoutUsdc: '25', sourceChainId: 56, sourceAsset: 'USDC' } })
        await s.confirm()
        expect(sent[1]).toEqual({ type: 'PRIVATE_ORDER', message: { ticket: '0xt', gas: 'ats', atsQuoted: { transferFee: 19.7, commissionFee: 0 } } })
        expect(pageStore().currentPage).toBe('home')
        expect(pageStore().homeTab).toBe('private')
        // aktarma alici kaydi YAZMAZ
        expect(stub.localStore.sent_recipients).toBeUndefined()
    })

    it('fund: dest iceren teklif ozeti degismeden saklanir', async () => {
        // Sembol ve ondalik istekteki token'la (varsayilan BSC USDC, 18) esit olmali: ekran eslesme denetimi (quoteDeliveryOk) aksi halde reddeder.
        const dest = { chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '40500000000000000', minDestAmount: '39000000000000000', quoteUsd: null }
        const { s } = await ready('fund', { reply: async () => ({ success: true, quote: { ...SUMMARY, dest } }) })
        s.amount = '25'
        await quoteAl(s)
        expect(s.quote.dest).toEqual(dest)
    })

    it('fund: kaynak listesi eski TON hesabini icermez', async () => {
        const { s } = await ready('fund', { accounts: [LEGACY_TON, A] })
        expect(s.publicAccounts.map((a) => a.key)).toEqual(['a-1'])
        expect(s.sourceKey).toBe('a-1')
    })

    it('send: kaynak Gizli Hesap, alici yazilan adres; gecmis ve itibar sorgusu YOK', async () => {
        const { s, sent } = await ready('send')
        s.recipient = STRANGER
        s.amount = '12'
        await quoteAl(s)
        expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message).toMatchObject({ sourceAccountKey: 'g-1', outputAddress: STRANGER })
        // C-I5: Gizli Hesap adresi uzak gecmise / itibar servisine gitmez.
        expect(fetchHistoryCounterparties).not.toHaveBeenCalled()
    })

    it('send: alici Gizli Hesap ise teklif istenmez', async () => {
        const { s, sent } = await ready('send')
        s.recipient = GIZLI
        s.amount = '12'
        expect(s.privateRecipient).toBe(true)
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE')).toHaveLength(0)
    })

    it('send: basarili gonderim aliciyi gizli tarafa (private: true) yazar', async () => {
        const { s, stub } = await ready('send')
        s.recipient = STRANGER
        s.amount = '12'
        await quoteAl(s)
        await s.confirm()
        expect(stub.localStore.sent_recipients).toHaveLength(1)
        expect(stub.localStore.sent_recipients[0]).toMatchObject({ address: STRANGER, private: true })
    })

    it('send: zehirli ikiz uyarisi cikmis alici KAYDEDILMEZ', async () => {
        const { s, stub } = await ready('send')
        s.recipient = LOOKALIKE
        expect(s.poisonMatch).toBeTruthy()
        s.poisonAcknowledged = true
        s.amount = '12'
        await quoteAl(s)
        expect(s.quote).toBeTruthy()
        await s.confirm()
        expect(stub.localStore.sent_recipients).toBeUndefined()
    })

    it('send: itibar bayragi almis alici KAYDEDILMEZ', async () => {
        const { s, stub } = await ready('send')
        s.recipient = STRANGER
        s.reputation = { severity: 'warn', flags: ['x'], sources: [] }
        s.reputationAcknowledged = true
        s.amount = '12'
        await quoteAl(s)
        expect(s.quote).toBeTruthy()
        await s.confirm()
        expect(stub.localStore.sent_recipients).toBeUndefined()
    })

    it('send: siparis reddedilirse alici kaydedilmez', async () => {
        const { s, stub } = await ready('send', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress } } : { success: false, error: 'PRIVATE_INSUFFICIENT_BALANCE' }) })
        s.recipient = STRANGER
        s.amount = '12'
        await quoteAl(s)
        await s.confirm()
        expect(s.error).toBe('Not enough balance for this amount.')
        expect(stub.localStore.sent_recipients).toBeUndefined()
    })

    it('10 USDC altinda teklif istenmez', async () => {
        const { s, sent } = await ready('fund')
        s.amount = '9'
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE')).toHaveLength(0)
    })

    it('bilinen hata kodu cevrilmis metinle, bilinmeyen kod PRIVATE_FAILED metniyle gosterilir', async () => {
        const a = await ready('fund', { reply: async () => ({ success: false, error: 'PRIVATE_MIN_AMOUNT' }) })
        a.s.amount = '25'
        await quoteAl(a.s)
        expect(a.s.error).toBe(`Minimum amount is ${MIN_PAYOUT_USDC} USDC.`)
        expect(a.s.quote).toBeNull()

        for (const kod of ['PRIVATE_CHECK_FAILED', 'raw exception text', undefined]) {
            const b = await ready('fund', { reply: async () => ({ success: false, error: kod }) })
            b.s.amount = '25'
            await quoteAl(b.s)
            expect(b.s.error).toBe('Something went wrong. Try again.')
        }
    })

    it('teklif: sendMessage firlatirsa PRIVATE_FAILED metni, busy false, teklif yok, faz error', async () => {
        const { s } = await ready('fund', { reply: async () => { throw new Error('ag yok') } })
        s.amount = '25'
        await quoteAl(s)
        expect(s.error).toBe('Something went wrong. Try again.')
        expect(s.busy).toBe(false)
        expect(s.quote).toBeNull()
        expect(s.phase).toBe('error')
    })

    it('U-I4 confirm: cevap yoksa (sendMessage firlatti) notla Gizli islemlere gidilir, busy false, teklif kapanir, ayni bilet tekrar gitmez', async () => {
        const { s, sent } = await ready('fund', { reply: async (m) => { if (m.type === 'PRIVATE_QUOTE') return { success: true, quote: SUMMARY }; throw new Error('sw yeniden basliyor') } })
        s.amount = '25'
        await quoteAl(s)
        await s.confirm()
        expect(pageStore().currentPage).toBe('home')
        expect(pageStore().homeTab).toBe('private')
        expect(pageStore().ordersNotice).toBe('privacy.orders.unconfirmedNotice')
        expect(s.error).toBe('')
        expect(s.busy).toBe(false)
        expect(s.quote).toBeNull()
        await s.confirm()
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER')).toHaveLength(1)
    })

    it('suresi dolmus teklif gonderilmez (5 sn tiklamasini beklemeden)', async () => {
        const { s, sent } = await ready('fund', { reply: async () => ({ success: true, quote: { ...SUMMARY, expiresAtMs: Date.now() - 1000 } }) })
        s.amount = '25'
        await quoteAl(s)
        await s.confirm()
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER')).toHaveLength(0)
        // Task 16: dolmus teklifte onay retryQuote() cagirir; planlanan zamanlayici sonraki testlere sizmasin.
        s.scheduler.dispose()
    })

    it('I1 send: teklif beklenirken alici degisirse cevap atilir, teklif kurulmaz', async () => {
        let serbest
        const bekle = new Promise((r) => { serbest = r })
        const { s } = await ready('send', { reply: async (m) => { await bekle; return { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress } } } })
        s.recipient = STRANGER
        s.amount = '12'
        vi.useFakeTimers()
        try {
            s.onQuoteInput('discrete')
            await vi.advanceTimersByTimeAsync(DISCRETE_DEBOUNCE_MS)
            expect(s.phase).toBe('quoting')
            // Istek ucustayken alici degisir (izleyicinin yaptigi gibi yeni girdi bildirilir): eski cevap teklif KURMAZ.
            s.recipient = '0x' + '8'.repeat(40)
            s.onQuoteInput('discrete')
            serbest()
            await vi.advanceTimersByTimeAsync(1)
            expect(s.quote).toBeNull()
            expect(s.busy).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('I1 fund: teklif beklenirken kaynak hesap degisirse cevap atilir', async () => {
        let serbest
        const bekle = new Promise((r) => { serbest = r })
        const B = { key: 'b-2', address: '0x' + 'ef'.repeat(20), name: 'Hesap 2', type: 'hd' }
        const { s } = await ready('fund', { accounts: [A, B], reply: async () => { await bekle; return { success: true, quote: SUMMARY } } })
        s.amount = '25'
        vi.useFakeTimers()
        try {
            s.onQuoteInput('discrete')
            await vi.advanceTimersByTimeAsync(DISCRETE_DEBOUNCE_MS)
            expect(s.phase).toBe('quoting')
            s.sourceKey = 'b-2'
            s.onQuoteInput('discrete')
            serbest()
            await vi.advanceTimersByTimeAsync(1)
            expect(s.quote).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })

    it('I1 send: kabul edilen teklifte alici ve kaydedilen alici teklifin kendisinden gelir (harf boyu farki serbest)', async () => {
        // U-M11: teklifin alicisi istenen adresle ayni OLMALI; yalniz buyuk/kucuk harf farki kabul edilir.
        const TEKLIF_ALICISI = '0x' + '5E'.repeat(20)
        const ISTENEN = '0x' + '5e'.repeat(20)
        const { s, stub } = await ready('send', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: true, quote: { ...SUMMARY, recipient: TEKLIF_ALICISI } } : { success: true }) })
        s.recipient = ISTENEN
        s.amount = '12'
        await quoteAl(s)
        expect(s.quote.recipient).toBe(TEKLIF_ALICISI)
        await s.confirm()
        expect(stub.localStore.sent_recipients[0]).toMatchObject({ address: TEKLIF_ALICISI, private: true })
    })

    it('U-M11 send: teklifin alicisi istenen adresten FARKLIYSA teklif kurulmaz ve onay verilmez', async () => {
        const BASKA = '0x' + '5'.repeat(40)
        const { s, sent } = await ready('send', { reply: async () => ({ success: true, quote: { ...SUMMARY, recipient: BASKA } }) })
        s.recipient = STRANGER
        s.amount = '12'
        await quoteAl(s)
        expect(s.quote).toBeNull()
        expect(s.error).toBe("The quote didn't match your request and was discarded.")
        await s.confirm()
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER')).toHaveLength(0)
    })

    it('I2 send: onay kutusu teklif sonrasi geri alinirsa confirm siparis vermez', async () => {
        const { s, sent } = await ready('send')
        s.recipient = LOOKALIKE
        s.poisonAcknowledged = true
        s.amount = '12'
        await quoteAl(s)
        expect(s.quote).toBeTruthy()
        s.poisonAcknowledged = false
        expect(s.securityBlocked).toBe(true)
        await s.confirm()
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER')).toHaveLength(0)
        expect(s.busy).toBe(false)
    })

    it('zamanlayici ilk await ten ONCE kurulur ve onUnmounted ta temizlenir', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toContain('onUnmounted')
        expect(kaynak).toContain('clearInterval(expiryTimer)')
        const govde = kaynak.slice(kaynak.indexOf('onMounted(async'))
        const setIdx = govde.indexOf('setInterval')
        const awaitIdx = govde.indexOf('await')
        expect(setIdx).toBeGreaterThan(-1)
        expect(setIdx).toBeLessThan(awaitIdx)
    })
})

// ----------------------------------------------------------------------------------------------------------------
// Sade ekran, Task 18: ag ucreti ATS ile ZORUNLU (gas: 'ats' sabit), Ucretler karti baglanir, PrivateReviewCard silindi
// (K6, K7, sT2, sT8, sT15, PD7). Ucret teklifi mount() taklidinde `atsSent` listesine yazilir (`sent` indeksleri bozulmasin).
// ----------------------------------------------------------------------------------------------------------------
describe('PrivateTransfer -- ag ucreti ATS zorunlu; Ucretler karti (Task 18)', () => {
    const orders = (sent) => sent.filter((x) => x.type === 'PRIVATE_ORDER')
    const kaynak = () => yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const kapali = (html) => /\sdisabled(=|\s|>)/.test(etiket(html, 'confirm-button'))
    const faz = (phase) => (s) => { s.schedState = { phase, seq: 1, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false } }
    // Render oncesi (yakalama aninda) etkin ucret yuvasini dolduran yardimci: teklifi dogrudan kurarak render eden testler icin.
    const atsOk = (s, ticket = SUMMARY.ticket, over = {}) => {
        const f = s.feeSlots[0]
        f.atsFee.value = over.fee ?? 19.7
        f.ready.value = over.ready ?? true
        f.atsBalance.value = over.balance ?? 100
        s.atsTicket = ticket
    }
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { ...m, html, s: m.captured.instance.setupState }
    }
    async function teklifli(mode = 'fund', opts = {}) {
        const r = await ready(mode, opts)
        if (mode === 'send') r.s.recipient = STRANGER
        r.s.amount = mode === 'send' ? '12' : '25'
        await quoteAl(r.s)
        expect(r.s.quote).toBeTruthy()
        return r
    }

    it('K7: teklif oncesi hic ATS ucret teklifi yok; teklif sonrasi TAM bir ATS_PRIVATE_FEE_QUOTE ve yuku yalniz { ticket } (fund ve send)', async () => {
        for (const mode of ['fund', 'send']) {
            const r = await ready(mode)
            if (mode === 'send') r.s.recipient = STRANGER
            r.s.amount = mode === 'send' ? '12' : '25'
            expect(r.atsSent, mode).toEqual([])
            await quoteAl(r.s)
            expect(r.atsSent, mode).toEqual([{ type: 'ATS_PRIVATE_FEE_QUOTE', message: { ticket: '0xt' } }])
            expect(Object.keys(r.atsSent[0].message), mode).toEqual(['ticket'])
        }
    })

    it('fund: ucret teklifi PRIVATE_QUOTE yanitindaki ticket ile gider; yukte hesap adresi ya da anahtari YOK', async () => {
        const reply = async (m) => (m.type === 'PRIVATE_QUOTE'
            ? { success: true, quote: { ...SUMMARY, ticket: '0xabc123', recipient: m.message.outputAddress } }
            : { success: true })
        const r = await teklifli('fund', { reply })
        expect(r.s.sourceKey).toBe('a-1')
        expect(r.atsSent).toEqual([{ type: 'ATS_PRIVATE_FEE_QUOTE', message: { ticket: '0xabc123' } }])
        const yuk = JSON.stringify(r.atsSent)
        expect(yuk).not.toContain(A.address)
        expect(yuk).not.toContain('a-1')
        expect(yuk).not.toContain(GIZLI)
    })

    it('sT15: PRIVATE_ORDER mesaji tam { ticket, gas: ats, atsQuoted } ve gonderilen hicbir mesajda native gecmez (fund ve send)', async () => {
        for (const mode of ['fund', 'send']) {
            const r = await teklifli(mode)
            await r.s.confirm()
            expect(orders(r.sent), mode).toEqual([{ type: 'PRIVATE_ORDER', message: { ticket: '0xt', gas: 'ats', atsQuoted: { transferFee: 19.7, commissionFee: 0 } } }])
            expect(JSON.stringify([...r.sent, ...r.atsSent, ...r.infoSent]), mode).not.toContain('native')
        }
    })

    it('komisyon varsa atsQuoted.commissionFee komisyonu tasir', async () => {
        const r = await teklifli('fund', { ats: { ...ATS_READY, commissionAts: '300000000000000000', commissionAtsHuman: 0.3 } })
        await r.s.confirm()
        expect(orders(r.sent)[0].message.atsQuoted).toEqual({ transferFee: 19.7, commissionFee: 0.3 })
    })

    describe('onay dugmesi ve ATS sinirlari (Review Focus 5)', () => {
        it('ucret yuklenirken kapali; yanit gelince acilir', async () => {
            let serbest
            const bekle = new Promise((r) => { serbest = r })
            const r = await teklifli('fund', { ats: async () => { await bekle; return ATS_READY } })
            expect(r.s.atsLoading).toBe(true)
            expect(r.s.atsBlocked).toBe(true)
            await r.s.confirm()
            expect(orders(r.sent)).toHaveLength(0)
            expect(r.s.phase).toBe('ready')
            serbest()
            await flush()
            expect(r.s.atsLoading).toBe(false)
            expect(r.s.atsBlocked).toBe(false)
        })

        it('ready:false iken kapali, siparis gitmez', async () => {
            const r = await teklifli('fund', { ats: { ...ATS_READY, ready: false } })
            expect(r.s.atsBlocked).toBe(true)
            await r.s.confirm()
            expect(orders(r.sent)).toHaveLength(0)
            expect(r.s.busy).toBe(false)
        })

        it('bakiye < ucret iken kapali; bakiye ucrete TAM esitken ACIK', async () => {
            const az = await teklifli('fund', { ats: { ...ATS_READY, atsBalance: 19 } })
            expect(az.s.atsFeeInsufficient).toBe(true)
            expect(az.s.atsBlocked).toBe(true)
            await az.s.confirm()
            expect(orders(az.sent)).toHaveLength(0)

            const esit = await teklifli('fund', { ats: { ...ATS_READY, atsBalance: 19.7 } })
            expect(esit.s.atsBalance).toBe(esit.s.atsFee)
            expect(esit.s.atsFeeInsufficient).toBe(false)
            expect(esit.s.atsBlocked).toBe(false)
            await esit.s.confirm()
            expect(orders(esit.sent)).toHaveLength(1)
        })

        it('bootstrap (opCount 2, bootstrapFee): bakiye yalniz ilk ucrete yetiyorken kapali, toplama yetince acik', async () => {
            const bootstrap = { ...ATS_READY, opCount: 2, bootstrapFee: 5 }
            const yetmez = await teklifli('fund', { ats: { ...bootstrap, atsBalance: 19.7 } })
            expect(yetmez.s.totalAtsCost).toBeCloseTo(24.7, 6)
            expect(yetmez.s.atsFeeInsufficient).toBe(true)
            expect(yetmez.s.atsBlocked).toBe(true)
            await yetmez.s.confirm()
            expect(orders(yetmez.sent)).toHaveLength(0)

            const yeter = await teklifli('fund', { ats: { ...bootstrap, atsBalance: 24.7 } })
            expect(yeter.s.atsBlocked).toBe(false)
            await yeter.s.confirm()
            expect(orders(yeter.sent)).toHaveLength(1)
        })

        it('ucret alinamadiysa (bundler hatasi) kapali ve siparis gitmez', async () => {
            const r = await teklifli('fund', { ats: { success: false, error: 'bundler down', httpStatus: 503 } })
            expect(r.s.atsBlocked).toBe(true)
            await r.s.confirm()
            expect(orders(r.sent)).toHaveLength(0)
            expect(r.s.busy).toBe(false)
        })

        it('ucret baska bir tekliften (atsTicket != quote.ticket) ise kapali', async () => {
            const r = await teklifli('fund')
            expect(r.s.atsBlocked).toBe(false)
            r.s.atsTicket = '0xbaska'
            expect(r.s.atsBlocked).toBe(true)
            await r.s.confirm()
            expect(orders(r.sent)).toHaveLength(0)
        })

        it('gec gelen ESKI ticket ucret yaniti yeni ucreti ezmez', async () => {
            let serbest
            const bekle = new Promise((r) => { serbest = r })
            const ats = async (m) => {
                if (m.message.ticket === '0xt') { await bekle; return { ...ATS_READY, transferFee: 99 } }
                return { ...ATS_READY, transferFee: 20.5 }
            }
            const r = await teklifli('fund', { ats })
            expect(r.s.atsLoading).toBe(true)
            // Ekran baska bir teklife gecti: ayni yuva yeni ticket ile yuklenir.
            r.s.quote = { ...r.s.quote, ticket: '0xyeni' }
            r.s.refreshAtsFee()
            await flush()
            expect(r.s.atsFee).toBe(20.5)
            expect(r.s.atsTicket).toBe('0xyeni')
            serbest()
            await flush()
            expect(r.s.atsFee).toBe(20.5)
            expect(r.s.atsBlocked).toBe(false)
        })

        it('girdi degisince (invalidateQuote) iki ucret yuvasi ve atsTicket sifirlanir', async () => {
            const r = await teklifli('fund')
            expect(r.s.atsFee).toBe(19.7)
            r.s.invalidateQuote()
            expect(r.s.atsFee).toBeNull()
            expect(r.s.atsTicket).toBeNull()
            expect(r.s.feeSlots.map((f) => f.atsFee.value)).toEqual([null, null])
        })

        it('sablon: onay dugmesi atsBlocked, payKnown, payExceedsBalance ve securityBlocked ile kapanir', () => {
            expect(kaynak()).toMatch(/:disabled="busy \|\| !quote \|\| phase !== 'ready' \|\| atsBlocked \|\| !payKnown \|\| payExceedsBalance \|\| \(mode === 'send' && securityBlocked\)"/)
        })
    })

    describe('ATS durumu (atsState) ve Ucretler karti', () => {
        it('teklif yok: idle; hazir: ready ve ag ucreti satiri sayiyi yazar', async () => {
            const bos = await goster('fund')
            expect(bos.s.atsState).toBe('idle')
            const r = await teklifli('fund')
            expect(r.s.atsState).toBe('ready')
            const g = await goster('fund', (s) => { s.quote = SUMMARY; s.quoteSourceChainId = 56; s.quoteSourceAsset = 'USDC'; atsOk(s); faz('ready')(s) })
            expect(g.s.atsState).toBe('ready')
            expect(g.html).toMatch(/data-testid="fee-network"[^]*?19\.7[^]*?ATS/)
        })

        it('bakiye yetmiyor: short; hata: error; baska karar: blocked; satin al karari: short', async () => {
            const kisa = await teklifli('fund', { ats: { ...ATS_READY, atsBalance: 5 } })
            expect(kisa.s.atsState).toBe('short')
            const hata = await teklifli('fund', { ats: { success: false, error: 'bundler down' } })
            expect(hata.s.atsState).toBe('error')
            const gecici = await teklifli('fund', { ats: { success: false, error: 'bundler down', httpStatus: 503 } })
            expect(gecici.s.atsState).toBe('blocked')
            const engelli = await teklifli('fund', { ats: { ...ATS_READY, ready: false, blocker: 'paymaster-paused' } })
            expect(engelli.s.atsState).toBe('blocked')
            const alis = await teklifli('fund', { ats: { ...ATS_READY, ready: false, atsBalance: 50, blocker: 'balance-missing' } })
            expect(alis.s.atsState).toBe('short')
        })

        it('fee-card HER durumda var (teklif yokken de); from/sourceNetwork satirlari ve recipient-check karti YOK', async () => {
            for (const mode of ['fund', 'send']) {
                const bos = await goster(mode)
                expect(bos.html, mode).toContain('data-testid="fee-card"')
                const g = await goster(mode, (s) => { s.quote = SUMMARY; s.quoteSourceChainId = 56; s.quoteSourceAsset = 'USDC'; atsOk(s); faz('ready')(s) })
                expect(g.html, mode).toContain('data-testid="fee-card"')
                expect(g.html, mode).toContain('data-testid="fee-service"')
                expect(g.html, mode).not.toContain('Source network')
                expect(g.html, mode).not.toContain('data-testid="recipient-check"')
                expect(g.html, mode).not.toContain('data-testid="delivered-share"')
            }
        })

        it('teklif oncesi tahmin: gecerli tutar ve feeBps ile "≈" satiri; 12 alti tutarda tahmin yok, kirmizi hata tutarin altinda (amount-min), kartta kirmizi dipnot yok', async () => {
            const info = { providerInfo: { success: true, info: { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true } } }
            const kur = (tutar) => (s) => { s.amount = tutar; s.providerInfo = { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true } }
            const g = await goster('fund', kur('100'), info)
            expect(g.html).toMatch(/data-testid="fee-service"[^]*?≈ 1 USDC/)
            const alti = await goster('fund', kur('5'), info)
            expect(alti.html).not.toContain('≈')
            // Kirmizi dipnot kalkti: dipnot yalniz Ayrinti'dadir (kapaliyken hic cizilmez); hata amount-min satiridir.
            expect(alti.html).not.toContain('data-testid="fee-note-service"')
            expect(etiket(alti.html, 'amount-min')).toContain('text-red-600 dark:text-red-400')
            expect(alti.html.slice(alti.html.indexOf('data-testid="fee-card"'), alti.html.indexOf('data-testid="confirm-button"'))).not.toContain('text-red-')
        })

        it('kaynak: PrivateFeeCard tum prop lariyla baglanir (fee-bps, payout-text, min-usdc, below-min, ats, dest-is-usdc)', () => {
            const kod = kaynak()
            expect(kod).toContain('<PrivateFeeCard')
            for (const p of [':mode="mode"', ':quote="quote"', ':dest-is-usdc="quoteDestIsUsdc"', ':fee-bps=', ':payout-text=', ':min-usdc="effectiveMin"', ':below-min=', ':ats=']) expect(kod, p).toContain(p)
            expect(kod).toMatch(/:fee-bps="providerInfo\?\.feeBps \?\? null"/)
        })
    })

    describe('pay-line (K10, X13, X14)', () => {
        const KOPRULU = (asset, amount, chainId) => ({ ...SUMMARY, sourceInput: { amount, asset, decimals: 6, chainId } })
        const kur = (chainId, asset, quote) => (s) => {
            s.chainId = chainId
            s.asset = asset
            s.quote = quote
            s.quoteSourceChainId = chainId
            s.quoteSourceAsset = asset
            atsOk(s)
            faz('ready')(s)
        }

        it('BSC USDC (dogrudan rota): teklif varsa pay-line VAR ve quote.amount (brut, 25.25) gosterir; teklif yokken yok (I1)', async () => {
            const g = await goster('fund', kur(56, 'USDC', SUMMARY))
            expect(g.s.payLineShown).toBe(true)
            expect(g.html).toMatch(/data-testid="pay-line"[^]*?You pay[^]*?25\.25 USDC/)
            // Para yukle (F1): pay-line "En az" satirinin sagindadir (ml-auto), teslim dugmesinden SONRA ve ucret kartindan ONCE; eski kart sabitleri (mt-1, rozetten once) yok.
            expect(etiket(g.html, 'pay-line')).toContain('ml-auto')
            expect(etiket(g.html, 'pay-line')).not.toContain('mt-1')
            expect(g.html.indexOf('data-testid="amount-input"')).toBeLessThan(g.html.indexOf('data-testid="pay-line"'))
            expect(g.html.indexOf('data-testid="delivery-chip"')).toBeLessThan(g.html.indexOf('data-testid="pay-line"'))
            expect(g.html.indexOf('data-testid="pay-line"')).toBeLessThan(g.html.indexOf('data-testid="fee-card"'))
            // Takas (eski kart) AYNEN: pay-line ust kutudan sonra, kartin icinde ve rozetten once, mt-1.
            const swap = await goster('swap', kur(56, 'USDC', SUMMARY))
            expect(etiket(swap.html, 'pay-line')).toContain('mt-1')
            expect(swap.html.indexOf('data-testid="amount-input"')).toBeLessThan(swap.html.indexOf('data-testid="pay-line"'))
            expect(swap.html.indexOf('data-testid="pay-line"')).toBeLessThan(swap.html.indexOf('data-testid="private-badge"'))
            expect((await goster('fund')).html).not.toContain('data-testid="pay-line"')
            const send = await goster('send', kur(56, 'USDC', SUMMARY))
            expect(send.html).toMatch(/data-testid="pay-line"[^]*?You pay[^]*?25\.25 USDC/)
        })

        it('ust kutu etiketi tarafsiz "Amount" (swap.pay "Pay" degil): yazilan tutar odenen tutar degildir (I1)', async () => {
            const g = await goster('fund', kur(56, 'USDC', SUMMARY))
            expect(g.html).toMatch(/>Amount<\/span>[^]*?data-testid="balance"/)
            expect(g.html).not.toMatch(/>Pay<\/span>/)
            const kod = kaynak()
            expect(kod).not.toContain("$t('swap.pay')")
            expect(kod).toContain("$t('privacy.transfer.amountLabel')")
        })

        it('koprulu Base USDC ve Ethereum USDT: pay-line var, "You pay" ve payAmountLabel metni; kartin icinde, ust kutudan sonra ve rozetten once', async () => {
            flags.bridged = true
            const base = await goster('fund', kur(8453, 'USDC', KOPRULU('USDC', '25250000', 8453)))
            expect(base.html).toContain('data-testid="pay-line"')
            expect(base.html).toMatch(/data-testid="pay-line"[^]*?You pay[^]*?25\.25 USDC/)
            expect(base.html.indexOf('data-testid="amount-input"')).toBeLessThan(base.html.indexOf('data-testid="pay-line"'))
            // Para yukle (F1): rozet Tutar satirinda (pay-line'dan ONCE), pay-line teslim dugmesinden sonra.
            expect(base.html.indexOf('data-testid="private-badge"')).toBeLessThan(base.html.indexOf('data-testid="pay-line"'))
            expect(base.html.indexOf('data-testid="delivery-chip"')).toBeLessThan(base.html.indexOf('data-testid="pay-line"'))
            // Takas (eski kart) AYNEN: pay-line kartin icinde, ust kutudan sonra ve rozetten once.
            const takas = await goster('swap', kur(8453, 'USDC', KOPRULU('USDC', '25250000', 8453)))
            expect(takas.html).toMatch(/data-testid="pay-line"[^]*?You pay[^]*?25\.25 USDC/)
            expect(takas.html.indexOf('data-testid="amount-input"')).toBeLessThan(takas.html.indexOf('data-testid="pay-line"'))
            expect(takas.html.indexOf('data-testid="pay-line"')).toBeLessThan(takas.html.indexOf('data-testid="private-badge"'))
            const usdt = await goster('fund', kur(1, 'USDT', KOPRULU('USDT', '25250000', 1)))
            expect(usdt.html).toMatch(/data-testid="pay-line"[^]*?You pay[^]*?25\.25 USDT/)
        })

        it('payKnown=false: payUnknown metni ("Yeni teklif al" demez) ve onay kapali', async () => {
            flags.bridged = true
            const g = await goster('fund', kur(1, 'USDC', { ...SUMMARY, sourceInput: null }))
            expect(g.s.payKnown).toBe(false)
            expect(g.html).toMatch(/data-testid="pay-line"[^]*?The amount you pay could not be confirmed/)
            expect(g.html).not.toContain('Get a new quote')
            expect(kapali(g.html)).toBe(true)
            const ok = await goster('fund', kur(1, 'USDC', KOPRULU('USDC', '25250000', 1)))
            expect(kapali(ok.html)).toBe(false)
        })

        it('payExceedsBalance: etiketteki varlik kaynak varlikla ayni ve sayi bakiyeyi asiyorsa balance kirmizi ve onay kapali; bakiye yetince degil', async () => {
            flags.bridged = true
            const q = KOPRULU('USDT', '25250000', 1)
            const asan = await goster('fund', (s) => { kur(1, 'USDT', q)(s); s.balance = 20 })
            expect(asan.s.payExceedsBalance).toBe(true)
            expect(etiket(asan.html, 'balance')).toContain('text-red-500')
            expect(kapali(asan.html)).toBe(true)
            const yeten = await goster('fund', (s) => { kur(1, 'USDT', q)(s); s.balance = 30 })
            expect(yeten.s.payExceedsBalance).toBe(false)
            expect(etiket(yeten.html, 'balance')).not.toContain('text-red-500')
            expect(kapali(yeten.html)).toBe(false)
            const tam = await goster('fund', (s) => { kur(1, 'USDT', q)(s); s.balance = 25.25 })
            expect(tam.s.payExceedsBalance).toBe(false)
            const bilinmiyor = await goster('fund', kur(1, 'USDT', q))
            expect(bilinmiyor.s.payExceedsBalance).toBe(false)
        })

        it('payExceedsBalance dogrudan BSC USDC rotasinda da toplam (totalUsdc) bakiyeyi asinca onayi kapatir; kirmizi toplam pay-line da gorunur (I1)', async () => {
            const g = await goster('fund', (s) => { kur(56, 'USDC', SUMMARY)(s); s.balance = 25 })
            expect(g.s.payExceedsBalance).toBe(true)
            expect(kapali(g.html)).toBe(true)
            expect(etiket(g.html, 'balance')).toContain('text-red-500')
            expect(g.html).toMatch(/data-testid="pay-line"[^]*?text-red-500[^]*?25\.25 USDC/)
            const yeten = await goster('fund', (s) => { kur(56, 'USDC', SUMMARY)(s); s.balance = 25.25 })
            expect(yeten.s.payExceedsBalance).toBe(false)
            expect(yeten.html).toMatch(/data-testid="pay-line"[^]*?25\.25 USDC/)
            expect(yeten.html.slice(yeten.html.indexOf('data-testid="pay-line"'), yeten.html.indexOf('data-testid="private-badge"'))).not.toContain('text-red-500')
        })

        it('payKnown=false dogrudan BSC USDC rotasinda da payUnknown metni ve onay kapali', async () => {
            const g = await goster('fund', kur(56, 'USDC', { ...SUMMARY, sourceInput: null, totalUsdc: undefined }))
            expect(g.s.payKnown).toBe(false)
            expect(g.html).toMatch(/data-testid="pay-line"[^]*?The amount you pay could not be confirmed/)
            expect(kapali(g.html)).toBe(true)
        })
    })

    describe('kaldirilanlar (sT15, K7)', () => {
        it('setupState.gas yok; ATS secim dugmeleri, gaz notlari, ats-exit-note ve eski kartlar cizilmez', async () => {
            for (const mode of ['fund', 'send']) {
                const g = await goster(mode, (s) => { s.quote = SUMMARY; s.quoteSourceChainId = 56; s.quoteSourceAsset = 'USDC'; atsOk(s); faz('ready')(s) })
                expect(g.s.gas, mode).toBeUndefined()
                expect(g.html, mode).not.toContain('Pay fee with native token')
                expect(g.html, mode).not.toContain('Pay fee with ATS')
                expect(g.html, mode).not.toContain('Network fee (ATS)')
                expect(g.html, mode).not.toContain('native token to pay network fees')
                expect(g.html, mode).not.toContain('needs a little BNB')
                expect(g.html, mode).not.toContain('data-testid="ats-exit-note"')
                expect(g.html, mode).not.toContain('aria-pressed')
            }
        })

        it('kaynak taramasi: atsAvailable, gasNoteOnly, PRIVATE_ORDER_ATS, isAtsChain, AtsFeeCard ve PrivateReviewCard yok; gas yalniz "ats" sabiti', () => {
            const kod = kaynak()
            for (const yasak of ['atsAvailable', 'gasNoteOnly', 'PRIVATE_ORDER_ATS', 'isAtsChain', 'AtsFeeCard', 'PrivateReviewCard', 'atsExitNote', 'gasHint', 'gasNote', "'native'", 'quoteSourceLabel', 'quoteSourceAddress', 'sourceChainLogo', 'deliveryChainLogo', 'watch([quote, gas]']) expect(kod, yasak).not.toContain(yasak)
            expect(kod).toContain("gas: 'ats'")
        })

        it('PrivateReviewCard dosyalari silindi', () => {
            for (const f of ['PrivateReviewCard.vue', 'PrivateReviewCard.ssr.test.js']) expect(existsSync(fileURLToPath(new URL(`./${f}`, import.meta.url))), f).toBe(false)
        })
    })
})

describe('PrivateTransfer -- son inceleme dalgasi (Task 18)', () => {
    const orders = (sent) => sent.filter((x) => x.type === 'PRIVATE_ORDER')
    const quoteReply = (over = {}) => async (m) => (m.type === 'PRIVATE_QUOTE'
        ? { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress, ...over } }
        : { success: true })

    it('C-I5 gecmis korumasi: myAddress verilse bile gonderen Gizli Hesapsa uzak gecmis sorgulanmaz', async () => {
        const { s } = await ready('send')
        // Koruma yalniz "myAddress verilmiyor" olgusuna dayanmaz: verilse de aktif hesap Gizli Hesapsa sorgu yok.
        await s.loadTrusted({ chainId: PAYOUT_CHAIN_ID, myAddress: GIZLI })
        expect(fetchHistoryCounterparties).not.toHaveBeenCalled()
        // Kontrol: gonderen Gizli Hesap OLMASAYDI ayni cagri sorgu yapardi (test anlamsiz yesil degil).
        globalThis.chrome.storage.local.get = async () => ({ vaults: [], active_account: { key: 'a-1', address: A.address } })
        await s.loadTrusted({ chainId: PAYOUT_CHAIN_ID, myAddress: A.address })
        expect(fetchHistoryCounterparties).toHaveBeenCalledTimes(1)
    })

    it('C-I5 itibar: Gizli Hesap adresi itibar servisine gitmez, yabanci adres gider (kontrol)', async () => {
        installChromeStub({ active_account: { key: 'g-1', address: GIZLI, private: true } })
        const run = async (value) => {
            const Harness = defineComponent({
                setup() {
                    useAddressSecurity(ref(value), ref('https://api.test'), { privateAddress: ref(GIZLI) })
                    return () => h('div')
                },
            })
            await render(createApp(Harness))
            await flush()
        }
        await run(GIZLI)
        expect(fetchReputation).not.toHaveBeenCalled()
        await run(STRANGER)
        expect(fetchReputation).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(fetchReputation.mock.calls[0])).not.toContain(GIZLI)
    })

    describe('U-I5 tutar girdisi', () => {
        it('virgullu ondalik kabul edilir ve istek NOKTALI gider', async () => {
            const { s, sent } = await ready('fund')
            s.amount = '12,5'
            expect(s.amountInvalid).toBe(false)
            expect(s.quoteEligible).toBe(true)
            await quoteAl(s)
            expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message.payoutUsdc).toBe('12.5')
        })

        it('kanonik olmayan bicimler (viem parseUnits un KABUL ettikleri 10., .5, -12 ve 19+ ondalik dahil) teklif istemez ve gecersiz sayilir', async () => {
            for (const bad of ['1e1', '0x10', '10.1234567890123456789', '1,000.5', '10.', '.5', '12,5,1', '-12']) {
                const { s, sent } = await ready('fund')
                s.amount = bad
                expect(s.quoteEligible, bad).toBe(false)
                expect(s.amountInvalid, bad).toBe(true)
                await quoteAl(s)
                expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE'), bad).toHaveLength(0)
            }
        })

        it('18 ondalik sinirda gecerli; bos alan gecersiz sayilmaz (ipucu yok)', async () => {
            const { s } = await ready('fund')
            s.amount = '12.123456789012345678'
            expect(s.quoteEligible).toBe(true)
            expect(s.amountInvalid).toBe(false)
            s.amount = ''
            expect(s.amountInvalid).toBe(false)
        })

        it('gecersiz tutar ipucu kaynakta yalniz amountInvalid kosuluyla cizilir', () => {
            const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
            expect(kaynak).toMatch(/v-if="amountInvalid"[^>]*>\{\{ \$t\('privacy\.transfer\.amountInvalid'\) \}\}/)
        })
    })

    it('U-M7 asgari tutar tek sabitten: hata metni ve teklif kapisi MIN_PAYOUT_USDC ile yazilir', async () => {
        // Tutar ipucu (amountHint) Task 12 ile kalkti; "En az" satiri Task 13'te gelir ve onun testi orada.
        const a = await ready('fund', { reply: async () => ({ success: false, error: 'PRIVATE_MIN_AMOUNT' }) })
        a.s.amount = '25'
        await quoteAl(a.s)
        expect(a.s.error).toBe(`Minimum amount is ${MIN_PAYOUT_USDC} USDC.`)
        const b = await ready('fund')
        b.s.amount = String(MIN_PAYOUT_USDC - 0.5)
        expect(b.s.quoteEligible).toBe(false)
        b.s.amount = String(MIN_PAYOUT_USDC)
        expect(b.s.quoteEligible).toBe(true)
    })

    describe('U-I4 confirm sonuclari', () => {
        const withOrderReply = (reply) => async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: true, quote: SUMMARY } : reply(m))

        it('PRIVATE_ORDER_IN_PROGRESS ve PRIVATE_DEPOSIT_UNCONFIRMED Gizli islemlere goturur (ilgili metin not olur)', async () => {
            for (const kod of ['PRIVATE_ORDER_IN_PROGRESS', 'PRIVATE_DEPOSIT_UNCONFIRMED']) {
                const { s } = await ready('fund', { reply: withOrderReply(() => ({ success: false, error: kod })) })
                s.amount = '25'
                await quoteAl(s)
                await s.confirm()
                expect(pageStore().currentPage, kod).toBe('home')
                expect(pageStore().homeTab, kod).toBe('private')
                expect(pageStore().ordersNotice, kod).toBe(`privacy.errors.${kod}`)
                expect(s.quote, kod).toBeNull()
            }
        })

        it('teklif/destek ve diger hatalarda mesaj gosterilir VE teklif kapanir; tuketilmis bilet tekrar gonderilmez', async () => {
            for (const kod of ['PRIVATE_QUOTE_EXPIRED', 'PRIVATE_QUOTE_NOT_FOUND', 'PRIVATE_UNSUPPORTED', 'PRIVATE_INSUFFICIENT_BALANCE', 'bilinmeyen kod']) {
                const { s, sent } = await ready('fund', { reply: withOrderReply(() => ({ success: false, error: kod })) })
                s.amount = '25'
                await quoteAl(s)
                await s.confirm()
                expect(s.error, kod).not.toBe('')
                expect(s.quote, kod).toBeNull()
                expect(pageStore().currentPage, kod).toBe('private_fund')
                await s.confirm()
                expect(orders(sent), kod).toHaveLength(1)
            }
        })

        it('U-M6 yanit gelince kullanici baska ekrana gectiyse oraya ZORLA donulmez', async () => {
            const { s } = await ready('fund')
            s.amount = '25'
            await quoteAl(s)
            pageStore().currentPage = 'settings'
            await s.confirm()
            expect(pageStore().currentPage).toBe('settings')
        })
    })

    it('U-M1 siparis beklenirken itibar bayragi kalksa da alici kaydi bekleme ONCESI duruma gore karar verir', async () => {
        let serbest
        const bekle = new Promise((r) => { serbest = r })
        const { s, stub } = await ready('send', { reply: async (m) => {
            if (m.type === 'PRIVATE_QUOTE') return { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress } }
            await bekle
            return { success: true }
        } })
        s.recipient = STRANGER
        s.reputation = { severity: 'warn', flags: ['x'], sources: [] }
        s.reputationAcknowledged = true
        s.amount = '12'
        await quoteAl(s)
        const p = s.confirm()
        s.reputation = { severity: null, flags: [], sources: [] }
        serbest()
        await p
        expect(stub.localStore.sent_recipients).toBeUndefined()
    })

    it('U-M2 girdi degisince teklif VE eski hata temizlenir (izleyici invalidateQuote a bagli)', async () => {
        const { s } = await ready('fund')
        s.amount = '25'
        await quoteAl(s)
        s.error = 'Minimum amount is 10 USDC.'
        s.invalidateQuote()
        expect(s.quote).toBeNull()
        expect(s.error).toBe('')
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        // Task 15: eski toplu izleyici kalkti; tek izleyici girdi degisimini zamanlayiciya bildirir (invalidateQuote onQuoteInput icinde).
        expect(kaynak).not.toContain('watch([sourceKey, recipient, chainId, asset, amount, outputToken], invalidateQuote)')
        expect(kaynak).toMatch(/function onQuoteInput\(kind\) \{\s*invalidateQuote\(\)\s*scheduler\.input\(kind, quoteEligible\.value\)/)
    })

    it('U-M8 confirm kabul edilen tekliften sonra degisen girdiyle gonderilmez (istek anahtari yeniden dogrulanir)', async () => {
        const a = await ready('fund')
        a.s.amount = '25'
        await quoteAl(a.s)
        a.s.amount = '30'
        await a.s.confirm()
        expect(orders(a.sent)).toHaveLength(0)
        expect(a.s.quote).toBeNull()

        const b = await ready('send')
        b.s.recipient = STRANGER
        b.s.amount = '12'
        await quoteAl(b.s)
        b.s.recipient = '0x' + '8'.repeat(40)
        await b.s.confirm()
        expect(orders(b.sent)).toHaveLength(0)
        expect(b.s.quote).toBeNull()
    })

    it('T9 M1 bitis zamani olmayan teklif SURESI DOLMUS sayilir ve gonderilmez (fail-closed)', async () => {
        for (const expiresAtMs of [undefined, null, 0, NaN]) {
            const { s, sent } = await ready('fund', { reply: quoteReply({ expiresAtMs, recipient: GIZLI }) })
            s.amount = '25'
            await quoteAl(s)
            expect(s.quote).toBeTruthy()
            expect(s.expired, String(expiresAtMs)).toBe(true)
            await s.confirm()
            expect(orders(sent), String(expiresAtMs)).toHaveLength(0)
            s.scheduler.dispose() // Task 16: onay retryQuote() planlar; zamanlayici sizmasin
        }
    })

    describe('U-I2 odeyecegin tutari', () => {
        it('sourceInput yok + dogrudan rota (BSC USDC): totalUsdc ile devam eder', async () => {
            const { s, sent } = await ready('fund', { reply: quoteReply({ sourceInput: null, recipient: GIZLI }) })
            s.amount = '25'
            await quoteAl(s)
            expect(s.payKnown).toBe(true)
            await s.confirm()
            expect(orders(sent)).toHaveLength(1)
        })

        // C:C1 / M2-I2: koprulu kaynaklar kapali; secimler arka planin kapisiyla AYNI yardimcilardan gelir.
        it('koprulu kaynaklar kapaliyken kaynak zincir yalniz BSC, varlik yalniz USDC (Ethereum secilemez)', async () => {
            const { s } = await ready('fund', { reply: quoteReply({ recipient: GIZLI }) })
            expect(s.sourceChains.map((c) => Number(c.chainId))).toEqual([56])
            expect(s.assets).toEqual(['USDC'])
            s.chainId = 1
            expect(s.chain).toBeNull()
            expect(s.assets).toEqual([])
        })

        // Koprulu kaynaklar ACIK (uretim degeri, 2026-10-26): secimler yalniz Relay Depository tablosundan gelir; BSC'de USDT/BNB
        // (yonlendirici rotasi) ve Polygon'da POL/DAI sunulmaz.
        it('koprulu kaynaklar acikken Depository zincirleri ve varliklari sunulur; BSC yalniz USDC', async () => {
            flags.bridged = true
            const { s } = await ready('fund', { reply: quoteReply({ recipient: GIZLI }) })
            expect(s.sourceChains.map((c) => Number(c.chainId))).toEqual(expect.arrayContaining([56, 1, 42161, 8453, 10, 137]))
            expect(s.assets).toEqual(['USDC'])
            s.chainId = 1
            expect(s.assets).toEqual(['USDC', 'USDT', 'DAI', 'ETH'])
            s.chainId = 137
            expect(s.assets).toEqual(['USDC', 'USDT'])
        })

        it('sourceInput yok + kopruli rota: tutar bilinmiyor, onay kapali ve gonderilmez', async () => {
            flags.bridged = true
            const { s, sent } = await ready('fund', { reply: quoteReply({ sourceInput: null, recipient: GIZLI }) })
            s.chainId = 1
            s.amount = '25'
            expect(s.chain).toBeTruthy()
            await quoteAl(s)
            expect(s.quote).toBeTruthy()
            expect(s.payKnown).toBe(false)
            await s.confirm()
            expect(orders(sent)).toHaveLength(0)
            expect(s.busy).toBe(false)
        })

        it('kaynak zincir/varlik teklif aninda DONDURULUR: sonradan secilen zincir kari degistirmez', async () => {
            const { s } = await ready('fund', { reply: quoteReply({ sourceInput: null, recipient: GIZLI }) })
            s.amount = '25'
            await quoteAl(s)
            expect(s.quoteSourceChainId).toBe(56)
            expect(s.quoteSourceAsset).toBe('USDC')
            s.chainId = 1
            expect(s.quoteSourceChainId).toBe(56)
            expect(s.payKnown).toBe(true)
        })

        it('onay dugmesi payKnown a, odeme-bilinmiyor metni (pay-line) !payKnown a baglidir', () => {
            const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
            expect(kaynak).toMatch(/@click="confirm"[^>]*:disabled="[^"]*!payKnown/)
            expect(kaynak).toMatch(/<template v-else>[^]*?privacy\.transfer\.payUnknown/)
            expect(kaynak).toContain('v-if="payLineShown"')
            expect(kaynak).toMatch(/const payLineShown = computed\(\(\) => !!quote\.value\)/)
            expect(kaynak).not.toContain('payDirect')
        })
    })

    describe('U-I3 / A:I-4 gorunurluk (gaz notlari Task 18 ile kalkti)', () => {
        it('gaz notu ve BNB ipucu hicbir kipte cizilmez; teslim cipi (S3 acikken de) var', async () => {
            for (const native of [false, true]) {
                flags.native = native
                for (const mode of ['fund', 'send']) {
                    const html = await render(mount(mode).app)
                    expect(html, mode).not.toContain('native token to pay network fees')
                    expect(html, mode).not.toContain('needs a little BNB')
                    expect(html, mode).toContain('data-testid="delivery-chip"')
                }
            }
        })

        // Gorunurluk notu (A:I-4) "?" sayfasinda (PrivateInfoSheet, Teleport): ekranin kendi govdesinde "Nasil calisir?" karti YOK.
        it('A:I-4 "Nasil calisir" karti ekranda yok; metin "?" sayfasinda (PrivateInfoSheet testleri kapsar)', async () => {
            for (const mode of ['fund', 'send']) {
                const html = await render(mount(mode).app)
                expect(html, mode).not.toContain('How it works')
                expect(html, mode).not.toContain('This payment is visible on-chain')
                expect(html, mode).toContain('data-testid="info-button"')
            }
            const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
            expect(kaynak).toContain('<PrivateInfoSheet')
        })

        it('fund basligi ne yapildigini soyler', async () => {
            expect(await render(mount('fund').app)).toContain('Add funds to Private Account')
        })

        it('U-I3 gizli mod kapaliyken Gizli Hesap adresi ekranda cizilmez', async () => {
            const kisa = shortenAddress(GIZLI)
            expect(await render(mount('fund', { active: true }).app)).toContain(kisa)
            expect(await render(mount('fund', { active: false }).app)).not.toContain(kisa)
        })
    })
})

// Task 22: T18 M1 (cevapsiz dinleyici), M2 (odeme bilinmiyorsa Teklif al), M5 (tek sifirlama).
describe('PrivateTransfer -- son temizlik (Task 22)', () => {
    const orders = (sent) => sent.filter((x) => x.type === 'PRIVATE_ORDER')
    // Teklif cevabi + PRIVATE_ORDER icin verilen cevap (undefined dahil).
    const replyWith = (orderReply, over = {}) => async (m) => {
        if (m.type === 'PRIVATE_QUOTE') return { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress, ...over } }
        return orderReply
    }
    // Onay dugmesi kapali mi (sablondaki disabled ifadesinin teklif/faz/odeme kismi; ATS bu testlerde native).
    const confirmKapali = (s) => s.busy || !s.quote || s.phase !== 'ready' || s.atsBlocked || !s.payKnown
    const quoted = async (orderReply, over) => {
        const r = await ready('fund', { reply: replyWith(orderReply, over) })
        r.s.amount = '25'
        await quoteAl(r.s)
        expect(r.s.quote).toBeTruthy()
        return r
    }
    const expectContextCleared = (s) => {
        expect(s.quote).toBeNull()
        expect(s.quoteKey).toBe('')
        expect(s.quoteSourceChainId).toBeNull()
        expect(s.quoteSourceAsset).toBeNull()
    }

    it('M1 PRIVATE_ORDER cevabi undefined (dinleyici cevap vermedi): TypeError YOK, null ile ayni yol (notla Gizli islemlere, teklif kapanir)', async () => {
        const { s, sent } = await quoted(undefined)
        await expect(s.confirm()).resolves.toBeUndefined()
        expect(orders(sent)).toHaveLength(1)
        expect(pageStore().currentPage).toBe('home')
        expect(pageStore().homeTab).toBe('private')
        expect(pageStore().ordersNotice).toBe('privacy.orders.unconfirmedNotice')
        expect(s.busy).toBe(false)
        expect(s.error).toBe('')
        expectContextCleared(s)
        // Ayni bilet tekrar gitmez.
        await s.confirm()
        expect(orders(sent)).toHaveLength(1)
    })

    it('M2 odeyecegin tutar bilinmiyorsa onay dugmesi kapali kalir; bilinirse acik, suresi dolunca yine kapali', async () => {
        // Bilinmeyen tutar: sourceInput yok + kopruli rota (BSC disi kaynak zincir).
        flags.bridged = true
        const bridged = await ready('fund', { reply: replyWith({ success: true }, { sourceInput: null }) })
        bridged.s.chainId = 1
        bridged.s.amount = '25'
        await quoteAl(bridged.s)
        expect(bridged.s.payKnown).toBe(false)
        expect(confirmKapali(bridged.s)).toBe(true)
        // Ayni girdiyle yeniden bildirim yeniden teklif ister (retry yolu).
        const before = bridged.sent.filter((m) => m.type === 'PRIVATE_QUOTE').length
        await quoteAl(bridged.s)
        expect(bridged.sent.filter((m) => m.type === 'PRIVATE_QUOTE')).toHaveLength(before + 1)

        const known = await quoted({ success: true })
        expect(known.s.payKnown).toBe(true)
        expect(confirmKapali(known.s)).toBe(false)
        known.s.nowMs = Date.now() + 3600000
        expect(known.s.expired).toBe(true)
    })

    it('M2 sablon: alt dugme TEK (confirm-button); !payKnown ve phase !== ready ile kapali, Teklif al dali yok', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).not.toContain('showGetQuote')
        expect(kaynak).toMatch(/@click="confirm"[^>]*data-testid="confirm-button"[^>]*:disabled="[^"]*!payKnown/)
        expect(kaynak).toMatch(/:disabled="[^"]*phase !== 'ready'/)
    })

    it('M5 basarisiz cevapta TUM kabul edilmis teklif baglami sifirlanir (tek invalidateQuote)', async () => {
        const { s } = await quoted({ success: false, error: 'PRIVATE_QUOTE_EXPIRED' })
        expect(s.quoteSourceChainId).toBe(56)
        await s.confirm()
        expectContextCleared(s)
        expect(s.error).not.toBe('')
    })

    it('M5 Gizli islemlere yonlendiren kodda da baglam sifirlanir; girdi degisimi (invalidateQuote) de hepsini sifirlar', async () => {
        const a = await quoted({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        await a.s.confirm()
        expectContextCleared(a.s)
        expect(pageStore().currentPage).toBe('home')
        expect(pageStore().homeTab).toBe('private')

        const b = await quoted({ success: true })
        expect(b.s.quoteSourceChainId).toBe(56)
        b.s.invalidateQuote()
        expectContextCleared(b.s)
    })
})

describe('PrivateTransfer -- T25 arayuz kalintilari', () => {
    const orders = (sent) => sent.filter((x) => x.type === 'PRIVATE_ORDER')
    const quoteReplyWith = (over = {}, orderReply = { success: true, ticket: '0xt', hash: '0xh' }) => async (m) => {
        if (m.type === 'PRIVATE_QUOTE') return { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress, ...over } }
        return orderReply
    }
    const quoted = async (over, orderReply) => {
        const r = await ready('fund', { reply: quoteReplyWith(over, orderReply) })
        r.s.amount = '25'
        await quoteAl(r.s)
        expect(r.s.quote).toBeTruthy()
        return r
    }
    const source = () => yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))

    // U:M-1: basarida teklif, sayfa degismeden HEMEN once kapanir (0.25 sn'lik cikis animasyonunda eski DOM
    // ayni ticket icin ikinci onay tetikleyemesin).
    it('U-M1 basarida teklif goToOrders ten ONCE kapanir ve ayni bilet ikinci kez gitmez', async () => {
        const { s } = await quoted()
        const seen = []
        const stop = watch(() => pageStore().currentPage, (p) => seen.push({ p, quote: s.quote, key: s.quoteKey }), { flush: 'sync' })
        try {
            await s.confirm()
        } finally {
            stop()
        }
        expect(seen).toEqual([{ p: 'home', quote: null, key: '' }])
    })

    it('U-M1 basarili onaydan sonra ikinci confirm hicbir siparis gondermez', async () => {
        const { s, sent } = await quoted()
        await s.confirm()
        expect(orders(sent)).toHaveLength(1)
        await s.confirm()
        expect(orders(sent)).toHaveLength(1)
        expect(s.quote).toBeNull()
    })

    // U:M-5: yurutucu bitisten 20 sn once reddeder; ekran da o kadar erken "Teklif al"a doner.
    describe('U-M5 etkin gecerlilik', () => {
        it('yurutucunun payi 20 sn (export edilen sabit)', () => {
            expect(QUOTE_MIN_REMAINING_MS).toBe(20000)
        })

        it('bitise payin icinde kalan teklif suresi dolmus sayilir; faz expired, onay kapali ve gonderilmez', async () => {
            const { s, sent } = await quoted({ expiresAtMs: Date.now() + QUOTE_MIN_REMAINING_MS - 1000 })
            expect(s.expired).toBe(true)
            expect(s.phase).toBe('expired')
            await s.confirm()
            expect(orders(sent)).toHaveLength(0)
            // Task 16: dolmus teklifte onay retryQuote() cagirir (yeni teklif planlanir); zamanlayici testten sonra sizmasin.
            expect(s.phase).toBe('waiting')
            s.scheduler.dispose()
        })

        it('pay disinda kalan teklif gecerli: onay sunulur ve gider', async () => {
            const { s, sent } = await quoted({ expiresAtMs: Date.now() + QUOTE_MIN_REMAINING_MS + 60000 })
            expect(s.expired).toBe(false)
            expect(s.phase).toBe('ready')
            await s.confirm()
            expect(orders(sent)).toHaveLength(1)
        })

        it('sinirda: kalan sure tam pay kadarsa suresi dolmus sayilir (yurutucu `<=` ile reddeder)', async () => {
            const { s } = await quoted()
            const t0 = 1_700_000_000_000
            s.quote.expiresAtMs = t0 + QUOTE_MIN_REMAINING_MS
            s.nowMs = t0
            expect(s.expired).toBe(true)
            s.nowMs = t0 - 1
            expect(s.expired).toBe(false)
        })
    })

    // U:M-6 (Task 15): alt dugme tek; etiket yalniz siparis gonderilirken (busy) degisir. Teklif ucustayken busy DEGIL faz 'quoting' olur.
    it('U-M6 alt dugme etiketi busy ye baglidir (sending / confirm); eski Teklif al etiketi sablonda yok', () => {
        expect(source()).toMatch(/data-testid="confirm-button"[^>]*>\{\{ busy \? \$t\('privacy\.transfer\.sending'\) : \(mode === 'fund' \? \$t\('privacy\.transfer\.fundConfirm'\) : \$t\('privacy\.transfer\.confirm'\)\) \}\}/)
        expect(source()).not.toMatch(/privacy\.transfer\.(getQuote|gettingQuote)/)
    })

    it('U-M6 teklif istegi ucustayken faz quoting, busy false; cevap gelince ready', async () => {
        let release
        const gate = new Promise((r) => { release = r })
        const { s } = await ready('fund', { reply: async (m) => { await gate; return { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress } } } })
        s.amount = '25'
        vi.useFakeTimers()
        try {
            s.onQuoteInput('discrete')
            await vi.advanceTimersByTimeAsync(DISCRETE_DEBOUNCE_MS)
            expect(s.phase).toBe('quoting')
            expect(s.busy).toBe(false)
            release()
            await vi.advanceTimersByTimeAsync(1)
            expect(s.phase).toBe('ready')
            expect(s.busy).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    // U:M-8b: "Odeyecegin" karari CANLI formdan degil, teklif aninda dondurulmus kaynaktan beslenir (kart kalkti, Task 18: payLabel).
    it('U-M8b odeyecegin etiketi dondurulmus teklif alanlarindan gelir, canli chainId/asset ten degil (metin kilidi)', () => {
        const kaynak = source()
        expect(kaynak).toMatch(/payAmountLabel\(quote\.value, \{ chainId: quoteSourceChainId\.value, asset: quoteSourceAsset\.value \}\)/)
        expect(kaynak).not.toMatch(/payAmountLabel\([^)]*chainId: chainId\.value|payAmountLabel\([^)]*asset: asset\.value/)
    })
})

// Alt proje 1 (spec 2026-10-10 teslim tokenleri): iki modda da alicinin alacagi token secilir.
describe('PrivateTransfer -- teslim tokeni secici', () => {
    it('varsayilan USDC: fund ve send isteginde outputToken BSC USDC', async () => {
        for (const mode of ['fund', 'send']) {
            const { s, sent } = await ready(mode)
            if (mode === 'send') s.recipient = STRANGER
            s.amount = '25'
            await quoteAl(s)
            expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message.outputToken, mode).toEqual(USDC_TOKEN)
        }
    })

    it('secici dugmesi iki modda da gorunur; secilen token (CAKE) istege gider ve panel kapanir', async () => {
        for (const mode of ['fund', 'send']) {
            const html = await render(mount(mode).app)
            expect(html, mode).toContain('data-testid="delivery-chip"')
        }
        const { s, sent } = await ready('send')
        s.recipient = STRANGER
        s.amount = '12'
        s.pickerOpen = true
        s.onPickToken(CAKE_TOKEN)
        expect(s.pickerOpen).toBe(false)
        await quoteAl(s)
        expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message.outputToken).toEqual(CAKE_TOKEN)
    })

    // Review Focus 3: teklif USDC icin alindiysa token degisince ayni teklif onaylanmaz.
    it('teklif sonrasi token degisirse onay gonderilmez ve teklif kapanir', async () => {
        const { s, sent } = await ready('fund')
        s.amount = '25'
        await quoteAl(s)
        expect(s.quote).not.toBeNull()
        s.onPickToken(CAKE_TOKEN)
        await s.confirm()
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER')).toHaveLength(0)
        expect(s.quote).toBeNull()
    })

    // Kontrol F6: ayni token yeniden secilince nesne degismez; gecerli teklif atilmaz, panel kapanir.
    it('mevcut tokenin farkli harf boyutuyla yeniden secilmesi nesneyi degistirmez ve paneli kapatir', async () => {
        const { s } = await ready('fund')
        const onceki = s.outputToken
        s.pickerOpen = true
        s.onPickToken({ ...USDC_TOKEN, address: USDC_TOKEN.address.toLowerCase() })
        expect(s.outputToken).toBe(onceki)
        expect(s.pickerOpen).toBe(false)
    })

    // Cilalama P2: dugme secili tokenin logosunu ve sembolunu gosterir; logo istek seklinden AYRI tutulur.
    it('teslim cipi secilen tokenin logosunu ve sembolunu gosterir; istek sekli degismez', async () => {
        const trigger = (html) => html.slice(html.indexOf('data-testid="delivery-chip"'), html.indexOf('</button>', html.indexOf('data-testid="delivery-chip"')))
        const { app, s } = await ready('fund')
        // Varsayilan USDC: yerel USDC logosu + sembol
        let html = await render(app)
        expect(trigger(html)).toMatch(/<img[^>]*src="\/usdc\.png"/)
        expect(trigger(html)).toContain('>USDC</span>')
        expect(trigger(html)).toContain('>BNB Smart Chain</span>')
        // Logo TEK cozucudan (privateTokenLogo): CAKE paketli (chainId, adres) dosyasi; uzak adres hicbir kosulda kullanilmaz.
        s.onPickToken(CAKE_TOKEN)
        expect(s.outputLogoSrc).toBe('/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png')
        expect(s.outputToken).toEqual(CAKE_TOKEN)
        expect(Object.keys(s.outputToken).sort()).toEqual(['address', 'chainId', 'decimals', 'symbol'])
        // Yerel coin her zaman COININ logosu (BNB 56, ETH Base = ETH elmasi, Base logosu degil).
        s.onPickToken({ chainId: 56, address: '0x0000000000000000000000000000000000000000', symbol: 'BNB', decimals: 18 })
        expect(s.outputLogoSrc).toBe('/chains/56.png')
        s.onPickToken({ chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 })
        expect(s.outputLogoSrc).toBe('/chains/1.png')
        // Gercekten bilinmeyen token (paketli logosu yok, kayit defterinde dogrulanamaz) yer tutucu
        s.onPickToken({ ...CAKE_TOKEN, address: getAddress('0x' + '42'.repeat(20)) })
        expect(s.outputLogoSrc).toBe('/default-token.png')
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        // Logo yedegi (onerror) cipin kendisindedir; ekranin yerel onLogoError kopyasi kalmadi.
        expect(kaynak).toContain(':logo="outputLogoSrc"')
        expect(kaynak).not.toContain('onLogoError')
    })

    it('secili token teslim cipinde render edilir (CAKE secilince sembol ve logo)', async () => {
        // Yazma, instance yakalandigi anda (serverPrefetch) yapilmali: render sonrasi yeni instance olusur.
        const { app } = mount('fund')
        captureInstance(app, 'PrivateTransfer', (inst) => inst.setupState.onPickToken(CAKE_TOKEN))
        const html = await render(app)
        const i = html.indexOf('data-testid="delivery-chip"')
        const tetik = html.slice(i, html.indexOf('</button>', i))
        expect(tetik).toContain('src="/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png"')
        expect(tetik).toContain('>CAKE</span>')
    })

    // Cok agli teslim (gizli-mod cok-ag spec 4.8): token kimligi (chainId, adres); istek chainId tasir.
    it('Base ETH secimi: istek chainId 8453 tasir ve dugme ETH logosunu gosterir (Base logosu yalniz rozette)', async () => {
        const BASE_ETH = { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 }
        const { s, sent } = await ready('send')
        s.recipient = STRANGER
        s.amount = '12'
        s.onPickToken(BASE_ETH)
        expect(s.outputLogoSrc).toBe('/chains/1.png')
        expect(s.outputBadge).toBe('/chains/8453.png')
        await quoteAl(s)
        expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message.outputToken).toEqual(BASE_ETH)
    })

    it('ayni adres baska agda baska tokendir: ag farkliysa secim degisir, eski teklif onaylanmaz ve kapanir', async () => {
        const { s, sent } = await ready('fund')
        s.amount = '25'
        await quoteAl(s)
        expect(s.quote).not.toBeNull()
        const onceki = s.outputToken
        s.onPickToken({ chainId: 8453, address: USDC_TOKEN.address, symbol: 'USDC', decimals: 6 })
        expect(s.outputToken).not.toBe(onceki)
        expect(s.outputToken.chainId).toBe(8453)
        await s.confirm()
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER')).toHaveLength(0)
        expect(s.quote).toBeNull()
    })
})

// Son inceleme U (FU1, FU6, FU8, FU10, FU11): baglanti kilidi, hata gorunurlugu, erisilebilirlik, teslim tokeninin gorunurlugu.
describe('PrivateTransfer -- teslim tokeni secici, son inceleme U', () => {
    const kaynakOku = (yol) => yorumsuz(readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8'))
    const SEEDED = () => ({
        'g-1': { 1: [], 56: [{ name: 'ATS', symbol: 'ATS', decimals: 18, address: '0x' + 'a7'.repeat(20), image: {}, coingecko_id: 'ats' }] },
        'a-1': { 56: [] },
    })

    // FU1: dugme paneli acar; panele native bayragi, secili token, secim ve kapatma baglanir.
    it('FU1 kaynak kilidi: teslim cipi paneli acar, panel dogru baglanir (chains = acik teslim aglari)', () => {
        const kaynak = kaynakOku('./PrivateTransfer.vue')
        expect(kaynak).toContain('@click="pickerOpen = true"')
        expect(kaynak).toContain('<PrivateDeliveryTokenPicker v-if="pickerOpen" :chain-id="outputToken.chainId" :chains="deliveryChains" :mode="mode" :native-enabled="PRIVATE_DEST_NATIVE" :selected="outputToken" @select="onPickToken" @close="closePicker" />')
        expect(kaynak).toMatch(/function closePicker\(\) \{\s*pickerOpen\.value = false/)
        expect(kaynak).toMatch(/function onPickToken\(token\) \{[\s\S]*?closePicker\(\)/)
    })

    // FU10: pi-sheet gecisi global (PrivacyIntro.vue unscoped) ve .pi-backdrop/.pi-panel sinifini ister; panel ikisini tasir.
    it('FU10 panel PrivacyIntro ile ayni alt sayfa gecisine sarilir ve gecisin hedefledigi siniflari tasir', () => {
        expect(kaynakOku('./PrivateTransfer.vue')).toContain('<Transition name="pi-sheet" :duration="{ enter: 380, leave: 240 }">')
        const panel = kaynakOku('./PrivateDeliveryTokenPicker.vue')
        expect(panel).toMatch(/class="pi-backdrop /)
        expect(panel).toMatch(/class="pi-panel /)
    })

    // FU8: teslim cipi bir iletisim kutusu acar (dugme, aria-haspopup); adi icindeki sembol + ag adidir; kapaninca odak cipe doner.
    it('FU8 teslim cipi aria-haspopup tasiyan bir dugmedir; adi sembol ve ag adi', async () => {
        const html = await render(mount('fund').app)
        const i = html.indexOf('data-testid="delivery-chip"')
        const chip = html.slice(html.lastIndexOf('<', i), html.indexOf('</button>', i))
        expect(chip).toMatch(/^<button/)
        expect(chip).toContain('aria-haspopup="dialog"')
        expect(chip).toContain('>USDC</span>')
        expect(chip).toContain('>BNB Smart Chain</span>')
    })

    it('FU8 panel kapaninca (secimle ya da kapatarak) odak dugmeye doner; dugme yoksa (SSR) sessiz', async () => {
        const { s } = await ready('fund')
        await s.closePicker()
        const focus = vi.fn()
        s.deliveryTrigger = { $el: { focus } }
        s.pickerOpen = true
        await s.closePicker()
        expect(s.pickerOpen).toBe(false)
        expect(focus).toHaveBeenCalledTimes(1)
        s.pickerOpen = true
        s.onPickToken(CAKE_TOKEN)
        await flush()
        expect(s.pickerOpen).toBe(false)
        expect(focus).toHaveBeenCalledTimes(2)
        s.deliveryTrigger = { }
        await s.closePicker()
        s.deliveryTrigger = { $el: { } }
        await s.closePicker()
    })

    // FU6: hata satiri gorunur alana getirilir; izleyici SSR'da calismadigi icin kaynak kilidi + dogrudan cagri.
    it('FU6 hata satiri scrollIntoView ile gorunur alana getirilir (yoksa sessiz)', async () => {
        const { s } = await ready('fund')
        const scrollIntoView = vi.fn()
        s.errorEl = { scrollIntoView }
        await s.revealError()
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
        s.errorEl = {}
        await s.revealError()
        s.errorEl = null
        await s.revealError()
        const kaynak = kaynakOku('./PrivateTransfer.vue')
        expect(kaynak).toContain('watch(error, (msg) => { if (msg) revealError() })')
        // Task 15: TEK hata satiri (eski <p v-if="error"> kalkti); gorunurluk shownError uzerinden.
        expect(kaynak).toMatch(/v-if="shownError[^"]*" ref="errorEl"/)
    })

    // FU11 (E13): teslim edilen token'in Gizli Hesabin listesine yazimi ARKA PLANA tasindi (runPrivateOrder -> recordDeposit, yalniz
    // Para yukle'de). Popup 10 sn'yi asan onay/yayin sirasinda kapanirsa buradaki yazim hic olmazdi; iki yazici da olsaydi cift
    // satir riski dogardi.
    describe('FU11 teslim tokeni satirini popup YAZMAZ (tek yazici arka plan, E13)', () => {
        it('fund ve send: basarili siparisten sonra imported_tokens hic degismez, ekran Gizli islemlere gecer', async () => {
            for (const mode of ['fund', 'send']) {
                const { s, stub } = await ready(mode)
                stub.localStore.imported_tokens = SEEDED()
                const onceki = JSON.stringify(stub.localStore.imported_tokens)
                if (mode === 'send') s.recipient = STRANGER
                s.onPickToken(CAKE_TOKEN)
                s.amount = '25'
                await quoteAl(s)
                await s.confirm()
                expect(JSON.stringify(stub.localStore.imported_tokens), mode).toBe(onceki)
                expect(pageStore().currentPage, mode).toBe('home')
            }
        })

        it('kaynak kilidi: bilesen teslim yazicisini ice aktarmaz ve imported_tokens a dokunmaz', () => {
            const kaynak = kaynakOku('./PrivateTransfer.vue')
            expect(kaynak).not.toContain('deliveredTokenBucket')
            expect(kaynak).not.toContain('addDeliveredTokenToPrivateBucket')
            expect(kaynak).not.toContain('imported_tokens')
        })
    })
})

// Para yukle ekrani: kaynak hesap Kimden hapi, kaynak (ag, varlik) cifti token cipi (sade ekran, Task 12). Yerel <select> yok.
describe('PrivateTransfer -- logolu acilir listeler', () => {
    const B = { key: 'b-2', address: '0x' + 'cd'.repeat(20), name: 'Hesap 2', type: 'hd' }
    const slice = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        const start = html.lastIndexOf('<', i)
        const tag = html.slice(start, start + 6)
        const end = tag.startsWith('<button') ? html.indexOf('</button>', i) : html.indexOf('</div>', i)
        return html.slice(start, end)
    }

    it('yerel <select> kalmadi (fund ve send)', async () => {
        for (const mode of ['fund', 'send']) {
            const { app } = await ready(mode, { accounts: [A, B] })
            const html = await render(app)
            expect(html, mode).not.toContain('<select')
            expect(html, mode).not.toContain('<option')
        }
    })

    it('Kimden hapi: iki hesapla dugme, yerel kimlik ikonu + ad + kisa adres, ok isareti', async () => {
        const { app } = await ready('fund', { accounts: [A, B] })
        const html = await render(app)
        const t = slice(html, 'from-pill')
        expect(t).toMatch(/^<button/)
        expect(t).toContain('aria-haspopup="dialog"')
        expect(t).toMatch(/<img[^>]*src="data:image\/svg\+xml/)
        expect(t).toContain('From: Hesap 1')
        expect(t).toContain(shortenAddress(A.address))
        expect(t).toContain('<svg')
    })

    it('tek hesap: Kimden hapi dugmesiz ve oksuz; Gizli Hesap kisa adresi alt kutuda durur', async () => {
        const { app } = await ready('fund')
        const html = await render(app)
        const t = slice(html, 'from-pill')
        expect(t).not.toMatch(/^<button/)
        expect(t).not.toContain('<svg')
        expect(html).toContain(shortenAddress(GIZLI))
    })

    it('kaynak cipi tek secenekte: logolu, dugmesiz, oksuz (BSC USDC, ag rozeti)', async () => {
        const { app } = await ready('fund')
        const html = await render(app)
        const chip = slice(html, 'source-chip')
        expect(chip).not.toMatch(/^<button/)
        expect(chip).not.toContain('<svg')
        expect(chip).toMatch(/<img[^>]*src="\/usdc\.png"/)
        expect(chip).toMatch(/<img[^>]*src="\/chains\/56\.png"/)
        expect(chip).toContain('>USDC</span>')
        expect(chip).toContain('>BNB Smart Chain</span>')
    })

    it('tutar girdisi: text + decimal, ondalik virgul kabul edilir; eski sonek ve ipucu yok (fund: sola dayali buyuk yazi, swap: kartta sagda 3xl)', async () => {
        for (const mode of ['fund', 'swap']) {
            const { app } = await ready(mode)
            const html = await render(app)
            const tag = html.slice(html.lastIndexOf('<', html.indexOf('data-testid="amount-input"')), html.indexOf('>', html.indexOf('data-testid="amount-input"')))
            expect(tag, mode).toMatch(/^<input/)
            expect(tag, mode).toContain('type="text"')
            expect(tag, mode).toContain('inputmode="decimal"')
            if (mode === 'fund') {
                expect(tag).toContain('min-w-0 h-11 font-bold text-left bg-transparent')
                expect(tag).toContain('text-4xl')
                expect(tag).not.toContain('text-right')
            } else expect(tag).toMatch(/class="[^"]*text-3xl font-bold text-right bg-transparent/)
            expect(html, mode).not.toContain('data-testid="amount-suffix"')
            expect(html, mode).not.toContain('The SilentSwap fee is taken from this amount.')
        }
    })

    it('teslim tokeni USDC varsayilaninda yerel USDC logosu; baska token secilirse o tokenin paketli logosu', async () => {
        const { s } = await ready('fund')
        expect(s.outputLogoSrc).toBe('/usdc.png')
        s.onPickToken(CAKE_TOKEN)
        expect(s.outputLogoSrc).toBe('/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png')
    })

    it('logolar: teslim tokeni cipte, kaynak ve teslim agi rozetleri yerel yollarla (teklif karti kalkti, Task 18)', async () => {
        const { app } = mount('fund', { accounts: [A, B] })
        captureInstance(app, 'PrivateTransfer', (inst) => {
            const st = inst.setupState
            st.onPickToken(CAKE_TOKEN)
            st.quote = { ...SUMMARY, dest: { chainId: 56, asset: 'CAKE', decimals: 18, expectedDestAmount: '6347040414609909068', minDestAmount: '6157898610254533777', quoteUsd: null } }
            st.quoteSourceChainId = 56
            st.quoteSourceAsset = 'USDC'
        })
        const html = await render(app)
        // Teslim tokeni logosu yalniz teslim cipinde (eski teklif karti kalkti); ag rozetleri kaynak cipinde ve teslim cipinde.
        expect(html.split('src="/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png"').length - 1).toBe(1)
        expect(html.split('src="/chains/56.png"').length - 1).toBeGreaterThanOrEqual(2)
    })

    it('kaynak kilidi: hesap Kimden hapi + secici, (ag, varlik) cifti birlesik secici, yerel select yok', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).not.toContain('<select')
        // Logolu alan bileseni (Task 13) tamamen kalkti: teslim agi + teslim varligi tek cipte. Hicbir alan v-model ile baglanmaz.
        expect(kaynak).not.toContain('<PrivateOption' + 'Field')
        expect(kaynak).not.toContain('v-model="deliveryChainId"')
        expect(kaynak).not.toContain('v-model="sourceKey"')
        expect(kaynak).not.toContain('v-model="chainId"')
        expect(kaynak).not.toContain('v-model="asset"')
        expect(kaynak).toContain('<PrivateAssetPicker')
        expect(kaynak).toContain('<PrivateAssetChip')
        expect(kaynak).toContain('<PrivateOptionSheet')
    })
})

// Cok agli teslim (gizli-mod cok-ag spec 4.8): Teslim agi alani, varsayilan ag ve varlik, kapali-ag notu, teklif eslesme denetimleri,
// `limitUsdc` metinleri ve 2 sn'lik "Teklif al" kapanmasi.
describe('PrivateTransfer -- teslim agi alani (SP2)', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

    const BASE_ETH = { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 }
    const BASE_USDC_TOKEN = { chainId: 8453, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 }
    // Teklif cevabi istegin teslim agina gore kurulur: recipientChainId ve dest.chainId secilen agdir.
    const cevap = (m, over = {}) => ({
        ...SUMMARY,
        recipient: m.message.outputAddress,
        recipientChainId: m.message.outputToken.chainId,
        dest: { ...SUMMARY.dest, chainId: m.message.outputToken.chainId, asset: m.message.outputToken.symbol, decimals: m.message.outputToken.decimals },
        ...over,
    })
    const quoteReply = (make = cevap) => async (m) => {
        if (m.type === 'PRIVATE_QUOTE') return { success: true, quote: make(m) }
        if (m.type === 'PRIVATE_ORDER') return { success: true, ticket: '0xt', hash: '0xh' }
        return { success: true }
    }
    const slice = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        const start = html.lastIndexOf('<', i)
        const end = html.slice(start, start + 7).startsWith('<button') ? html.indexOf('</button>', i) : html.indexOf('</div>', i)
        return html.slice(start, end)
    }

    it('alan sirasi: fund (F1): hesap kareleri, rozet, tutar, kaynak cipi, bakiye, teslim cipi, tahmin, En az, ucret karti; swap (kart): tutar alani, rozet, teslim cipi, tahmini tutar; send (duzen A): tutar, kaynak hapi, bakiye, alici rozeti, alici girdisi, teslim cipi, tahmini tutar, En az; eski Teslim agi / Teslim varligi alanlari yok', async () => {
        const SIRA = {
            fund: ['from-pill', 'private-tile', 'private-badge', 'amount-input', 'source-chip', 'balance', 'delivery-chip', 'estimate', 'min-eta', 'fee-card'],
            swap: ['amount-input', 'private-badge', 'delivery-chip', 'estimate'],
            send: ['amount-input', 'source-chip', 'balance', 'private-badge', 'recipient-input', 'paste-button', 'delivery-chip', 'estimate', 'min-eta', 'fee-card'],
        }
        for (const mode of ['fund', 'swap', 'send']) {
            const { app } = await ready(mode)
            const html = await render(app)
            const sira = SIRA[mode].map((id) => html.indexOf(`data-testid="${id}"`))
            expect(sira.every((i) => i > -1), mode).toBe(true)
            expect(sira, mode).toEqual([...sira].sort((a, b) => a - b))
            expect(new Set(sira).size, mode).toBe(SIRA[mode].length)
            expect(html, mode).not.toContain('Delivery network')
            expect(html, mode).not.toContain('Deliver as')
            expect(html, mode).not.toContain('data-testid="delivery-chain"')
            expect(html, mode).not.toContain('data-testid="delivery-token"')
        }
    })

    it('Para yukle: tek acik ag (BSC) ve Gonder: on ag; iki modda da teslim cipi etkilesimli (token secimi icin), picker\'a giden liste moda gore', async () => {
        // Test ortami Para yukle'yi on ag acar (F, E/F-3); magaza gibi yalniz BSC'ye daralir.
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        const fund = await ready('fund')
        const fundHtml = slice(await render(fund.app), 'delivery-chip')
        expect(fundHtml).toMatch(/^<button/)
        expect(fundHtml).toContain('aria-haspopup="dialog"')
        expect(fundHtml).toMatch(/<img[^>]*src="\/chains\/56\.png"/)
        expect(fundHtml).toContain('>BNB Smart Chain</span>')
        expect(fund.s.deliveryChains.map((c) => c.chainId)).toEqual([56])

        const send = await ready('send')
        const sendHtml = slice(await render(send.app), 'delivery-chip')
        expect(sendHtml).toMatch(/^<button/)
        expect(sendHtml).toContain('aria-haspopup="dialog"')
        expect(send.s.deliveryChains.map((c) => c.chainId)).toEqual([56, 1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
    })

    // 1.10 teslim degismezi: Para yukle'deki her agin Gonder kaynagi varsa on ag acilir (ATS satisi bayragina bagli degil); test ortami on ag verir, secici Gonder gibi calisir.
    it('Para yukle: on ag acikken (test ortami) teslim cipi etkilesimlidir ve BSC varsayilandir; ATS satisi bayragi kapaliyken de on ag acik, Gonder kaynagi olmayan ag listeyi BOS yapar', async () => {
        const fund = await ready('fund')
        expect(fund.s.deliveryChains.map((c) => c.chainId)).toEqual([56, 1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
        expect(slice(await render(fund.app), 'delivery-chip')).toMatch(/^<button/)
        expect(fund.s.outputToken).toEqual(USDC_TOKEN)
        // ATS satisi bayragi kapaliyken (uretim) Para yukle AYNEN acik kalir: genislik Gonder kaynagina baglidir, bayraga degil.
        vi.stubEnv('VITE_PRIVATE_ATS_SALE', 'false')
        const uretimGibi = await ready('fund')
        expect(uretimGibi.s.deliveryChains.map((c) => c.chainId)).toEqual([56, 1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
        expect(await render(uretimGibi.app)).not.toContain('data-testid="no-chain-open"')
        // Gonder kaynagi olmayan ag Para yukle listesinde olamaz: liste calisma zamaninda BOS sayilir (ekran "ag acik degil" notunu gosterir).
        // (Yalniz Para yukle'deki aglarin kaynagi aranir; burada Ethereum listeden cikarilmis gibi degil, kaynagi olmayan ag EKLENMIS gibi taklit edilir.)
        flags.sendSources = [56]
        const kapali = await ready('fund')
        expect(kapali.s.deliveryChains).toEqual([])
        expect(await render(kapali.app)).toContain('data-testid="no-chain-open"')
        flags.sendSources = null
    })

    it('varsayilan ag BSC ve varligi USDC; yerel teslim acikken de (P1: BSC varsayilani USDC)', async () => {
        for (const native of [false, true]) {
            flags.native = native
            const { s } = await ready('send')
            expect(s.outputToken, String(native)).toEqual(USDC_TOKEN)
        }
    })

    it('liste daraldiysa varsayilan ag ilk acik ag olur: yerel teslim aciksa o agin yerel coini, kapaliysa USDC; gecmis ilk agla yuklenir', async () => {
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '8453,42161')
        flags.native = true
        expect((await ready('send')).s.outputToken).toEqual(BASE_ETH)
        // Gonder acilisinda guvenilir adres listesi ilk teslim agiyla yuklenir (PF-D6): BSC sabiti degil, daralan listenin ilk agi.
        expect(trustedCalls).toHaveBeenLastCalledWith({ chainId: 8453 })
        flags.native = false
        expect((await ready('send')).s.outputToken).toEqual(BASE_USDC_TOKEN)
        expect(trustedCalls).toHaveBeenLastCalledWith({ chainId: 8453 })
    })

    it('Para yukle: yerel teslim aciksa da varsayilan token YALNIZ teslim edilebilir olandir (ETH aglarinda ETH, POL/xDAI/CELO/MNT/CRO aglarinda USDC); Gonder ekraninda yerel coin kalir', async () => {
        flags.native = true
        flags.bridged = true
        const fund = (await ready('fund')).s
        for (const id of [1, 8453, 42161, 10]) {
            fund.deliveryChainId = id
            expect(fund.outputToken.address, String(id)).toBe('0x0000000000000000000000000000000000000000')
        }
        for (const id of [137, 100, 42220, 5000, 25]) {
            fund.deliveryChainId = id
            expect(fund.outputToken.symbol, String(id)).toBe('USDC')
            expect(fund.outputToken.chainId).toBe(id)
        }
        const send = (await ready('send')).s
        send.deliveryChainId = 137
        expect(send.outputToken.symbol).toBe('POL')
    })

    it('ag degisince token o agin varsayilan varligina doner (logo yeni tokenden) ve eski teklif onaylanmaz', async () => {
        const { s, sent } = await ready('send', { reply: quoteReply() })
        s.recipient = STRANGER
        s.amount = '12'
        s.onPickToken(CAKE_TOKEN)
        await quoteAl(s)
        expect(s.quote).not.toBeNull()
        s.deliveryChainId = 8453
        expect(s.outputToken).toEqual(BASE_USDC_TOKEN)
        expect(s.outputLogoSrc).toBe('/usdc.png')
        await s.confirm()
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER')).toHaveLength(0)
        expect(s.quote).toBeNull()
        // Yerel teslim aciksa Base / Arbitrum varsayilani o agin yerel coinidir (P1); ayni ag yeniden secilince nesne degismez.
        flags.native = true
        s.deliveryChainId = 42161
        expect(s.outputToken).toEqual({ chainId: 42161, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 })
        const onceki = s.outputToken
        s.deliveryChainId = 42161
        expect(s.outputToken).toBe(onceki)
    })

    it('Base teslimli akis: istek chainId 8453 tasir, teklif kabul edilir, siparis yalniz ticket ile gider', async () => {
        const { s, sent } = await ready('send', { reply: quoteReply() })
        s.recipient = STRANGER
        s.amount = '12'
        s.deliveryChainId = 8453
        await quoteAl(s)
        expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message.outputToken).toEqual(BASE_USDC_TOKEN)
        expect(s.quote.dest.chainId).toBe(8453)
        await s.confirm()
        expect(sent.find((m) => m.type === 'PRIVATE_ORDER').message).toEqual({ ticket: '0xt', gas: 'ats', atsQuoted: { transferFee: 19.7, commissionFee: 0 } })
    })

    it('teklif ozeti secimle uyusmazsa kart cizilmez ve PRIVATE_QUOTE_MISMATCH gosterilir', async () => {
        const bozuklar = [
            ['recipientChainId farkli', (m) => cevap(m, { recipientChainId: 56 })],
            ['dest.chainId farkli', (m) => cevap(m, { dest: { ...cevap(m).dest, chainId: 56 } })],
            ['dest.asset yok', (m) => cevap(m, { dest: { ...cevap(m).dest, asset: undefined } })],
            ['dest.asset bos', (m) => cevap(m, { dest: { ...cevap(m).dest, asset: '' } })],
            ['dest.decimals yok', (m) => cevap(m, { dest: { ...cevap(m).dest, decimals: undefined } })],
            ['dest.decimals kesirli', (m) => cevap(m, { dest: { ...cevap(m).dest, decimals: 6.5 } })],
            // Sembol ve ondalik istekle (Base USDC: 'USDC', 6) esit olmali: arka plan hatasi yanlis ondalikla tutar cizdirmesin.
            ['dest.asset istekten farkli', (m) => cevap(m, { dest: { ...cevap(m).dest, asset: 'DAI' } })],
            ['dest.decimals istekten farkli', (m) => cevap(m, { dest: { ...cevap(m).dest, decimals: 18 } })],
            ['dest yok', (m) => cevap(m, { dest: null })],
        ]
        for (const [ad, make] of bozuklar) {
            const { s } = await ready('send', { reply: quoteReply(make) })
            s.recipient = STRANGER
            s.amount = '12'
            s.deliveryChainId = 8453
            await quoteAl(s)
            expect(s.quote, ad).toBeNull()
            expect(s.error, ad).toBe("The quote didn't match your request and was discarded.")
        }
    })

    it('limitUsdc metinleri: en az {min} (arka planin siniri, yoksa yerlesik 12), en cok {max}; yoksa mevcut genel metin; yeni kodlar', async () => {
        const dene = async (res) => {
            const { s } = await ready('fund', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? res : { success: true }) })
            s.amount = '25'
            await quoteAl(s)
            return s.error
        }
        expect(await dene({ success: false, error: 'PRIVATE_MIN_AMOUNT', limitUsdc: '20' })).toBe('Minimum amount is 20 USDC.')
        expect(await dene({ success: false, error: 'PRIVATE_MIN_AMOUNT' })).toBe('Minimum amount is 12 USDC.')
        expect(await dene({ success: false, error: 'PRIVATE_MAX_AMOUNT', limitUsdc: '20010' })).toBe('Maximum amount is 20010 USDC.')
        expect(await dene({ success: false, error: 'PRIVATE_MAX_AMOUNT' })).toBe("This amount is above SilentSwap's limit.")
        expect(await dene({ success: false, error: 'PRIVATE_RATE_LIMITED' })).toBe('Too many quotes requested. Wait a moment and try again.')
        expect(await dene({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })).toBe('Delivery to this network is closed right now.')
        // C1 inceleme karari: limitUsdc kanonik ondalik dizge degilse (sunucudan gelen serbest metin dahil) ekranda GOSTERILMEZ;
        // genel metne dusulur. Sayi tipi, bilimsel gosterim, bos ve etiket iceren degerler dahil.
        for (const bozuk of ['abc', '1e9', '-5', '20.', ' 20', '<b>20</b>', '', 20, null]) {
            expect(await dene({ success: false, error: 'PRIVATE_MIN_AMOUNT', limitUsdc: bozuk }), `min ${String(bozuk)}`).toBe('Minimum amount is 12 USDC.')
            expect(await dene({ success: false, error: 'PRIVATE_MAX_AMOUNT', limitUsdc: bozuk }), `max ${String(bozuk)}`).toBe("This amount is above SilentSwap's limit.")
        }
    })

    it('yerel soguma kopyasi kalmadi: cooling, startCooldown, QUOTE_COOLDOWN_MS ve getQuote ekranda yok (soguma zamanlayicida)', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).not.toMatch(/\bcooling\b|startCooldown|QUOTE_COOLDOWN_MS|\bgetQuote\b/)
    })

    it('hic teslim agi acik degil: cip yerine not, tahmini tutar ve secici yok, teklif uygun degil ve istek gitmez', async () => {
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '')
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
        for (const mode of ['fund', 'send']) {
            const { app, s, sent } = await ready(mode)
            const html = await render(app)
            expect(html, mode).toContain('No delivery network is open in this version.')
            expect(html, mode).toContain('data-testid="no-chain-open"')
            expect(html, mode).not.toContain('data-testid="delivery-chip"')
            expect(html, mode).not.toContain('data-testid="estimate"')
            expect(html, mode).not.toContain('data-testid="calc-pill"')
            expect(html, mode).not.toContain('data-testid="min-eta"')
            if (mode === 'send') s.recipient = STRANGER
            s.amount = '25'
            expect(s.quoteEligible, mode).toBe(false)
            await quoteAl(s)
            expect(s.phase, mode).toBe('idle')
            expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE'), mode).toHaveLength(0)
        }
    })

    it('teklif aninda teslim tokeni TABLO USDC si ise bayrak donar, baska token ve gecersiz kilma bayragi sifirlar', async () => {
        const { s } = await ready('send', { reply: quoteReply() })
        s.recipient = STRANGER
        s.amount = '12'
        s.deliveryChainId = 8453
        await quoteAl(s)
        expect(s.quoteDestIsUsdc).toBe(true)
        await s.confirm()
        // confirm() teklifi tuketti (ya da gecersiz kildi): bayrak sifirlanir.
        expect(s.quoteDestIsUsdc).toBe(false)
        s.onPickToken(CAKE_TOKEN)
        await quoteAl(s)
        expect(s.quote).not.toBeNull()
        expect(s.quoteDestIsUsdc).toBe(false)
    })

    it('"?" sayfasina giden teslim agi adi tablodan ({chain}); metin PrivateInfoSheet testlerinde', async () => {
        const fund = await ready('fund')
        expect(fund.s.deliveryChainName).toBe('BNB Smart Chain')
        const send = await ready('send')
        send.s.deliveryChainId = 8453
        expect(send.s.deliveryChainName).toBe('Base')
    })
})

// Gonder cikis karti ve teklif karti baglantilari (gizli-mod cok-ag spec 4.8, P6, E20); klasik kopru kacisinin kaldirildigi kaynak kilidi (Task 4).
describe('PrivateTransfer -- Gonder cikis karti ve teklif karti baglantilari (SP2)', () => {
    const BASE_USDC_DEST = { chainId: 8453, asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', minDestAmount: '14346647', quoteUsd: null }
    const baseQuote = (dest = BASE_USDC_DEST) => ({ ...SUMMARY, totalUsdc: '15.0', payoutUsdc: '14.85', recipientChainId: 8453, dest })
    // Kart state'ini yakalama ani (serverPrefetch) yazilir: render sonrasi yeni instance olusur.
    function cardHtml(mode, set) {
        const { app } = mount(mode)
        captureInstance(app, 'PrivateTransfer', (inst) => {
            const st = inst.setupState
            st.quoteSourceChainId = 56
            st.quoteSourceAsset = 'USDC'
            set(st)
        })
        return render(app)
    }

    it('klasik kopru kacisi YOK (bayraktan bagimsiz kaynak kilidi): govdede bridge-link yok, kaynak secicisinde showBridge/@bridge yok, openBridge/onBridgeFromPicker yok, klasik kopru/takas sayfasina gecis yok; eski cikis karti ve exitGas metni yok', async () => {
        const send = await render((await ready('send')).app)
        expect(send).not.toContain('data-testid="bridge-link"')
        expect(send).not.toContain('Asset not listed?')
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        for (const iz of ['show-bridge', '@bridge', 'openBridge', 'onBridgeFromPicker', 'cryptoStore', 'networkStore']) expect(kaynak, iz).not.toContain(iz)
        const KLASIK_GECIS = /currentPage\s*=\s*['"`](?:swap|bridge)['"`]/
        expect(kaynak).not.toMatch(KLASIK_GECIS)
        // Regex kendini dogrular (kilit bos kalmasin); private_swap / private_bridge sayfa kimlikleri serbesttir.
        expect("page.currentPage = 'bridge'").toMatch(KLASIK_GECIS)
        expect('page.currentPage = "swap"').toMatch(KLASIK_GECIS)
        expect("page.currentPage = 'private_bridge'").not.toMatch(KLASIK_GECIS)
        expect("page.currentPage = 'private_swap'").not.toMatch(KLASIK_GECIS)
        // Olumlu kontroller: kaynak gercek bilesen (goToOrders gezintisi) ve secici hala bagli.
        expect(kaynak).toMatch(/currentPage\s*=\s*'home'/)
        expect(kaynak).toMatch(/<PrivateAssetPicker v-if="sourcePickerOpen"[^>]*@select="onPickSourcePair"[^>]*@close="closeSourcePicker"/)
        expect(send).not.toContain('data-testid="exit-card"')
        expect(send).not.toContain('data-testid="exit-bridge"')
        expect(send).not.toContain('Moving value out of another network')
        expect(send).not.toContain('The network you pay from needs a little of its native coin for the network fee')
        const fund = await render((await ready('fund')).app)
        expect(fund).not.toContain('data-testid="bridge-link"')
        expect(fund).not.toContain('data-testid="exit-card"')
        expect(fund).not.toContain('Moving value out of another network')
    })

    it('baska agdaki alici notu (Task 14): teklif VARKEN de YOKKEN de Gonder + Base secimiyle tek kez (ag adi Base); BSC secimi ve Para yukle de yok', async () => {
        const base = await cardHtml('send', (st) => { st.deliveryChainId = 8453; st.quote = baseQuote() })
        expect(base).toContain('Make sure the recipient uses this address on Base.')
        expect(base.split('Make sure the recipient').length - 1).toBe(1)
        const bsc = await cardHtml('send', (st) => { st.quote = baseQuote({ ...BASE_USDC_DEST, chainId: 56 }) })
        expect(bsc).not.toContain('Make sure the recipient')
        const fund = await cardHtml('fund', (st) => { st.deliveryChainId = 8453; st.quote = baseQuote() })
        expect(fund).not.toContain('Make sure the recipient')
    })

    it('teslim payi satiri: tablo USDC si (bayrak true) teklifin tutarlarindan %98.6; ayni sembollu ama tablo USDC si olmayan token "dogrulanamadi" der', async () => {
        const tablo = await cardHtml('send', (st) => { st.deliveryChainId = 8453; st.quote = baseQuote(); st.quoteDestIsUsdc = true })
        expect(tablo).toContain('Delivered value')
        expect(tablo).toContain('98.6%')
        const taklit = await cardHtml('send', (st) => { st.deliveryChainId = 8453; st.quote = baseQuote(); st.quoteDestIsUsdc = false })
        expect(taklit).not.toContain('98.6%')
        expect(taklit).toContain('The delivered value couldn&#39;t be verified.')
    })

})

// ---- ATS-ONCE KARTI KALDIRILDI (2026-10-28, kullanici karari; gizli-mod cok-ag spec D16 / PF-F1 GERI ALINDI) ----
// Para yukle + teslim agi BSC disi iken ekran artik Gizli Hesap'in ATS bakiyesini OKUMAZ: amber "Once ATS satin al" karti, "ATS bakiyesi
// okunamadi / Tekrar dene" satiri ve "Teklif al" kilidi yoktur. ATS kontrolu islem aninda (Takas/Kopru ATS ucret karti) yapilir.
// Yalniz kapidan bagimsiz tek satir bilgi notu ('ats-exit-note') kalmistir.
describe('PrivateTransfer -- ATS-once karti YOK', () => {
    const ATS_MESAJLARI = (sent) => sent.filter((m) => m.type === 'ATS_FUEL_BALANCE')
    const KIMLIKLER = ['ats-first-card', 'ats-first-unknown', 'ats-first-note', 'ats-first-buy', 'ats-first-retry', 'ats-first-warning', 'ats-first-notice']
    const yok = (out, ...idler) => { for (const id of idler) expect(out, id).not.toContain(`data-testid="${id}"`) }
    // Varsayilan teklif cevabi (istegin teslim tokenine gore); ATS bakiye mesajina her cevap "sifir bakiye" ya da hata olabilir.
    const yanit = (atsCevabi) => async (m) => {
        if (m.type === 'ATS_FUEL_BALANCE') return atsCevabi(m)
        if (m.type === 'PRIVATE_QUOTE') {
            const t = m.message.outputToken
            return { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress, recipientChainId: t.chainId, dest: { ...SUMMARY.dest, chainId: t.chainId, asset: t.symbol, decimals: t.decimals } } }
        }
        return { success: true }
    }
    async function html(mod, ag) {
        const { app } = mount(mod)
        captureInstance(app, 'PrivateTransfer', (inst) => { inst.setupState.deliveryChainId = ag })
        return render(app)
    }

    it('Para yukle + BSC disi ag (Base): ATS bakiyesi hic sorulmaz; kart, okunamadi satiri ve dugmeler yok; Teklif al acik', async () => {
        const r = await ready('fund', { reply: yanit(() => ({ success: true, balance: '0' })) })
        r.s.deliveryChainId = 8453
        await flush()
        r.s.amount = '15'
        expect(ATS_MESAJLARI(r.sent)).toEqual([])
        expect(r.s.quoteEligible).toBe(true)
        yok(await html('fund', 8453), ...KIMLIKLER)
    })

    it('Teklif al ATS bakiyesine bagli degildir: bakiye sifir, okunamaz ya da hata olsa da PRIVATE_QUOTE gider ve ATS mesaji hic gonderilmez', async () => {
        for (const cevap of [{ success: true, balance: '0' }, { success: false, error: 'rpc down' }, { success: true }, { success: true, balance: '99.999999999999999999' }]) {
            const r = await ready('fund', { reply: yanit(() => cevap) })
            r.s.deliveryChainId = 8453
            await flush()
            r.s.amount = '15'
            expect(r.s.quoteEligible, JSON.stringify(cevap)).toBe(true)
            await quoteAl(r.s)
            const istek = r.sent.find((m) => m.type === 'PRIVATE_QUOTE')
            expect(istek.message.outputToken.chainId).toBe(8453)
            expect(r.s.quote).toBeTruthy()
            expect(ATS_MESAJLARI(r.sent), JSON.stringify(cevap)).toEqual([])
        }
    })

    it('ag degisimi (Base -> Arbitrum -> BSC) ATS okumasi tetiklemez', async () => {
        const r = await ready('fund', { reply: yanit(() => ({ success: true, balance: '0' })) })
        for (const ag of [8453, 42161, 56]) {
            r.s.deliveryChainId = ag
            await flush()
        }
        expect(ATS_MESAJLARI(r.sent)).toEqual([])
    })

    it('bilgi notu (ats-exit-note) ARTIK cizilmez: ag ucreti her zaman ATS ve Ucretler kartinda (Task 18)', async () => {
        for (const [mod, ag] of [['fund', 8453], ['fund', 56], ['send', 8453]]) {
            const out = await html(mod, ag)
            yok(out, 'ats-exit-note')
            expect(out).not.toContain('Moving value out of another network costs ATS.')
        }
    })

    it('kaynak: PrivateTransfer.vue ATS-once kapisina, usePrivateAtsGate e ve PRIVATE_ATS_FIRST kodlarina dokunmaz; ATS bakiyesi mesaji gonderilmez', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).not.toMatch(/usePrivateAtsGate|atsFirst|ats-first|PRIVATE_ATS_FIRST|PRIVATE_ATS_FIRST_MIN_ATS|retryAtsGate|ATS_FUEL_BALANCE|useAtsPurchase/)
    })

    it('kaldirilan kart metinleri iki dilde de yok; baglanti uyarisi (Takas/Kopru) KALDI; bilgi notu (atsNote) Task 24te silindi', () => {
        for (const dil of ['en', 'tr']) {
            const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../../i18n/locales/${dil}.json`, import.meta.url)), 'utf8'))
            for (const k of ['atsFirstTitle', 'atsFirstDesc', 'atsFirstAction', 'atsUnknown', 'atsRetry']) expect(j.privacy.transfer[k], `${dil}.${k}`).toBeUndefined()
            expect(j.privacy.errors.PRIVATE_ATS_FIRST, dil).toBeUndefined()
            expect(typeof j.privacy.transfer.atsLinkWarning, dil).toBe('string')
            expect(j.privacy.transfer.atsNote, dil).toBeUndefined()
        }
    })
})

// ----------------------------------------------------------------------------------------------------------------
// Sade ekran, Task 12: kart kabugu, ust kutu, rozet, Kimden hapi ve "?" (K1, K3, K4, K10, sT8, sT9, sT13, sT20).
// SSR'da izleyiciler render'dan sonra calismaz: durum captureInstance geri cagrisinda (render oncesi) yazilir.
// ----------------------------------------------------------------------------------------------------------------
describe('PrivateTransfer -- sade ust kart (Task 12)', () => {
    const B2 = { key: 'b-2', address: '0x' + 'cd'.repeat(20), name: 'Hesap 2', type: 'hd' }
    // Girdiyi render'dan ONCE kurar, HTML'i ve canli setupState'i doner.
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { html, s: m.captured.instance.setupState }
    }
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const EN = (anahtar) => JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/en.json', import.meta.url)), 'utf8')).privacy.transfer[anahtar]

    it('(a) fund: Kimden hapi var, send: yok; tek hesapta <button degil, iki hesapta <button', async () => {
        const tek = await goster('fund')
        expect(var_(tek.html, 'from-pill')).toBe(true)
        expect(etiket(tek.html, 'from-pill')).not.toMatch(/^<button/)
        const cift = await goster('fund', () => {}, { accounts: [A, B2] })
        expect(etiket(cift.html, 'from-pill')).toMatch(/^<button/)
        const send = await goster('send')
        expect(var_(send.html, 'from-pill')).toBe(false)
    })

    it('(a2) Kimden hapi metni: ad + kisa adres; iki hesapta panel setupState ile acilip secimle kaynak hesap degisir', async () => {
        const { html, s } = await goster('fund', () => {}, { accounts: [A, B2] })
        expect(html).toContain('From: Hesap 1 · ' + shortenAddress(A.address))
        expect(s.fromOpen).toBe(false)
        s.fromOpen = true
        s.onPickFrom('b-2')
        expect(s.sourceKey).toBe('b-2')
        expect(s.fromOpen).toBe(false)
    })

    it('(b) "?" dugmesi iki modda var; aria-label "Nasil calisir"; infoOpen baslangicta kapali', async () => {
        for (const mode of ['fund', 'send']) {
            const { html, s } = await goster(mode)
            const tag = etiket(html, 'info-button')
            expect(tag, mode).toMatch(/^<button/)
            expect(tag, mode).toContain(`aria-label="${EN('howTitle')}"`)
            expect(s.infoOpen, mode).toBe(false)
        }
    })

    it('(c) rozet: <span>, rolsuz; swap: kart ayracinda pointer-events-none hap; fund (Tutar satiri) ve send (Alici satiri): sade not (hap ve ayrac YOK); ters cevir dugmesi yok', async () => {
        for (const mode of ['swap', 'fund', 'send']) {
            const { html } = await goster(mode)
            const tag = etiket(html, 'private-badge')
            expect(tag, mode).toMatch(/^<span/)
            expect(tag, mode).not.toContain('role=')
            if (mode === 'swap') {
                // Takas/Kopru (eski kart): ayracta pointer-events-none hap.
                expect(tag, mode).toContain('pointer-events-none')
                expect(tag, mode).toContain('rounded-xl bg-slate-50 dark:bg-[#18181b] border-2 border-white dark:border-[#131315] px-2.5 py-0.5 text-[10.5px]')
            } else {
                // Para yukle (F1, Tutar satirinda) ve Gonder (duzen A, Alici satirinda): kart ayraci ve hap kalkti; sade, kenarliksiz 10.5 px not.
                expect(tag, mode).toContain('inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-zinc-500')
                expect(tag, mode).not.toContain('pointer-events-none')
                expect(tag, mode).not.toContain('rounded-xl')
                expect(tag, mode).not.toContain('border-2')
            }
            const bas = html.indexOf('data-testid="private-badge"')
            expect(html.slice(bas, html.indexOf('</span>', bas))).toContain('Private via SilentSwap')
            expect(html.split('data-testid="private-badge"').length - 1, mode).toBe(1)
            expect(html, mode).not.toContain('swap-reverse')
            expect(html, mode).not.toMatch(/reverse/i)
        }
    })

    it('(d) yuzde cipleri: bakiyesi bilinen USDC de uc cip; USDT/yerel varlikta ve bakiye null iken yok', async () => {
        const bilinen = await goster('fund', (s) => { s.balance = 10 })
        for (const id of ['percent-25', 'percent-50', 'percent-max']) expect(var_(bilinen.html, id), id).toBe(true)
        expect(bilinen.html.slice(bilinen.html.indexOf('data-testid="percent-25"'))).toContain('25%')
        expect(bilinen.html).toContain('MAX')
        for (const varlik of ['USDT', 'ETH', 'BNB']) {
            const o = await goster('fund', (s) => { s.balance = 10; s.asset = varlik })
            for (const id of ['percent-25', 'percent-50', 'percent-max']) expect(var_(o.html, id), varlik + id).toBe(false)
        }
        const bilinmeyen = await goster('fund')
        for (const id of ['percent-25', 'percent-50', 'percent-max']) expect(var_(bilinmeyen.html, id), 'null ' + id).toBe(false)
    })

    it('(d2) setPercent: tutari percentChipAmount ile yazar (SilentSwap ucreti ustune eklenir: yedek %1), bakiyeyi asmaz; bakiye null iken dokunmaz', async () => {
        const { s } = await goster('fund', (st) => { st.balance = 10 })
        s.setPercent(0.25)
        expect(s.amount).toBe(percentChipAmount(10, 0.25, 100))
        expect(s.amount).toBe('2.475247')
        s.setPercent(0.5)
        expect(s.amount).toBe('4.950495')
        s.setPercent(1)
        expect(s.amount).toBe('9.90099')
        s.balance = 0.1234567891
        s.setPercent(1)
        expect(s.amount).toBe('0.122233')
        expect(Number(s.amount) * 1.01).toBeLessThanOrEqual(0.1234567891)
        s.balance = null
        s.amount = '7'
        s.setPercent(0.5)
        expect(s.amount).toBe('7')
    })

    it('(d3) bakiye satiri: bilinmiyorsa "—", biliniyorsa 4 ondalik; bakiye okumasi {address, chain, asset} ile kurulur', async () => {
        const bilinmeyen = await goster('fund')
        const bas = bilinmeyen.html.indexOf('data-testid="balance"')
        expect(bilinmeyen.html.slice(bas, bilinmeyen.html.indexOf('</span>', bas))).toContain('Balance: \u2014')
        const bilinen = await goster('fund', (s) => { s.balance = 12.5 })
        expect(bilinen.html).toContain('Balance: 12.5000')
        const son = balanceCalls.mock.calls.at(-1)[0]
        expect(Object.keys(son).sort()).toEqual(['address', 'asset', 'chain'])
    })

    it('(e) USDC disinda "USDC degerinde" ibaresi var, USDC de yok', async () => {
        const usdc = await goster('fund')
        expect(var_(usdc.html, 'usdc-value-note')).toBe(false)
        const usdt = await goster('fund', (s) => { s.asset = 'USDT' })
        expect(var_(usdt.html, 'usdc-value-note')).toBe(true)
        expect(usdt.html).toContain('Enter the amount in USDC. You pay the equivalent in USDT.')
    })

    it('(f) bakiye asimi (USDC, 10 / 25): bakiye ve tutar kirmizi; X14: USDC disinda bakiye kirmizi olmaz', async () => {
        const asim = await goster('fund', (s) => { s.balance = 10; s.amount = '25' })
        expect(etiket(asim.html, 'balance')).toContain('text-red-500')
        expect(etiket(asim.html, 'amount-input')).toContain('text-red-500')
        const yeterli = await goster('fund', (s) => { s.balance = 100; s.amount = '12' })
        expect(etiket(yeterli.html, 'balance')).not.toContain('text-red-500')
        expect(etiket(yeterli.html, 'amount-input')).not.toContain('text-red-500')
        const usdt = await goster('fund', (s) => { s.balance = 10; s.amount = '25'; s.asset = 'USDT' })
        expect(etiket(usdt.html, 'balance')).not.toContain('text-red-500')
    })

    it('(g) alt kutu iskeleti: swap: "Gizli Hesabina" + kisa Gizli adres (kart); fund: Gizli Hesap karesi (ad + kisa adres, "toPrivate" yok); send: Alici etiketi', async () => {
        const swap = await goster('swap')
        expect(swap.html).toContain(EN('toPrivate'))
        expect(swap.html).toContain(shortenAddress(GIZLI))
        const fund = await goster('fund')
        expect(fund.html).toContain('>' + EN('privateAccountName') + '<')
        expect(fund.html).toContain(shortenAddress(GIZLI))
        expect(fund.html).not.toContain(EN('toPrivate'))
        const send = await goster('send')
        expect(send.html).toContain(EN('recipient'))
        expect(send.html).not.toContain(EN('toPrivate'))
    })

    it('(h) tutar uc durumlari: amount-error yalniz kanonik olmayan tutarda gorunur', async () => {
        for (const gecersiz of ['12.0000000000000000001', '1e3', '12,', ',5']) {
            const { html } = await goster('fund', (s) => { s.amount = gecersiz })
            expect(var_(html, 'amount-error'), gecersiz).toBe(true)
            expect(etiket(html, 'amount-input'), gecersiz).toContain('text-red-500')
        }
        for (const gecerli of ['12,5', '0012', '12', '']) {
            const { html } = await goster('fund', (s) => { s.amount = gecerli })
            expect(var_(html, 'amount-error'), JSON.stringify(gecerli)).toBe(false)
        }
    })

    it('(h2) virgullu tutar kanonik noktaya cevrilir ve teklif istegine o gider', async () => {
        const { s, sent } = await ready('fund')
        s.amount = '12,5'
        expect(s.quoteEligible).toBe(true)
        await quoteAl(s)
        expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message.payoutUsdc).toBe('12.5')
    })

    it('(i) hicbir src uzak degil; "≈ $" yok (iki modda, ust kutu dolu)', async () => {
        for (const mode of ['fund', 'send']) {
            const { html } = await goster(mode, (s) => { s.balance = 10; s.asset = 'USDT' })
            for (const [, src] of html.matchAll(/\ssrc="([^"]*)"/g)) expect(src, mode).not.toMatch(/^(https?:)?\/\//)
            expect(html, mode).not.toContain('≈ $')
        }
    })

    it('(j) alt dugme kapsayicisi (px-4 pb-4) kaydirma kutusunun DISINDA; govde sinifi birebir', async () => {
        for (const mode of ['fund', 'send']) {
            const { html } = await goster(mode)
            const govde = 'overflow-y-auto custom-scrollbar px-4 pt-2 pb-2 flex flex-col gap-2'
            const bas = html.indexOf(govde)
            expect(bas, mode).toBeGreaterThan(-1)
            const basDiv = html.lastIndexOf('<div', bas)
            let derinlik = 0
            let bitis = -1
            for (const m of html.slice(basDiv).matchAll(/<div\b|<\/div>/g)) {
                derinlik += m[0] === '</div>' ? -1 : 1
                if (derinlik === 0) { bitis = basDiv + m.index + m[0].length; break }
            }
            expect(bitis, mode).toBeGreaterThan(basDiv)
            const alt = html.indexOf('class="px-4 pb-4', bitis)
            expect(alt, mode).toBeGreaterThan(-1)
            // Dugme kapsayicisi govdenin icinde degil: govde kapandiktan SONRA gelir ve kendisi kaydirmaz.
            expect(html.slice(html.lastIndexOf('<', alt), html.indexOf('>', alt))).not.toContain('overflow-y-auto')
            expect(html.slice(basDiv, bitis)).not.toContain('class="px-4 pb-4')
        }
    })

    it('(k) kaynak cipi: bridged acikken etkilesimli; onPickSourcePair cift olarak chainId + asset yazar; secici secenekleri yerel logo', async () => {
        flags.bridged = true
        const { html, s } = await goster('fund')
        expect(etiket(html, 'source-chip')).toMatch(/^<button/)
        expect(s.sourcePickerOpen).toBe(false)
        const hedef = s.sourcePairOptions.find((o) => o.key !== '56:USDC')
        expect(hedef).toBeTruthy()
        s.sourcePickerOpen = true
        s.onPickSourcePair(hedef.key)
        expect(`${s.chainId}:${s.asset}`).toBe(hedef.key)
        expect(s.sourcePickerOpen).toBe(false)
        for (const o of s.sourcePairOptions) {
            expect(o.logo, o.key).toMatch(/^\//)
            expect(o.badge, o.key).toMatch(/^\//)
        }
        // Bilinmeyen anahtar secimi bozmaz.
        const once = `${s.chainId}:${s.asset}`
        s.onPickSourcePair('999999:XYZ')
        expect(`${s.chainId}:${s.asset}`).toBe(once)
    })

    it('(l) ust kutu kaynak bakiyesini kaynak hesabin adresiyle okur: send icin Gizli adres', async () => {
        await goster('send')
        expect(balanceCalls).toHaveBeenCalled()
        const { address } = balanceCalls.mock.calls.at(-1)[0]
        expect(address.value).toBe(GIZLI)
    })

    it('(m) kart kabugu: Takas ana karti sinif kumesi; pay-line ust kutudan sonra kartin icinde (Task 18)', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
        expect(kaynak).toContain('relative w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-3xl p-3 shadow-md dark:shadow-xl')
        expect(kaynak).toContain('data-testid="pay-line"')
        // X9: components/privacy altindaki satir ici SVG xmlns tasimaz.
        expect(kaynak).not.toContain('xmlns')
    })
})
// Task 13: alt kutu = teslim cipi (teslim agi + teslim varligi tek cipte), tahmini teslim tutari ve "En az" satiri.
describe('PrivateTransfer -- alt kutu: teslim cipi, tahmini tutar ve En az satiri (Task 13)', () => {
    afterEach(() => { vi.unstubAllEnvs() })
    const BASE_ETH = { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 }
    // X15: SUMMARY.expectedFulfillmentMs 90000 (~2 dk); "3 dk" testi icin bu blokta 180000 kurulur.
    const TEKLIF = { ...SUMMARY, expectedFulfillmentMs: 180000 }
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { html, s: m.captured.instance.setupState }
    }
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    // Elemanin ic metni: etiketten kapanisa kadar, ic etiketler soyulur.
    const metin = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        const bas = html.indexOf('>', i) + 1
        return html.slice(bas, html.indexOf('</', bas)).replace(/<[^>]*>/g, '').trim()
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const parca = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        const bas = html.lastIndexOf('<', i)
        return html.slice(bas, html.indexOf('</button>', i))
    }

    it('(a) delivery-chip: sembol, ag adi ve yerel rozet; hasDeliveryChain yoksa cip YOK, no-chain-open var ve teklif istenmez', async () => {
        for (const mode of ['fund', 'send']) {
            const { html } = await goster(mode)
            const chip = parca(html, 'delivery-chip')
            expect(chip, mode).toContain('>USDC</span>')
            expect(chip, mode).toContain('>BNB Smart Chain</span>')
            expect(chip, mode).toMatch(/<img[^>]*src="\/usdc\.png"/)
            expect(chip, mode).toMatch(/<img[^>]*src="\/chains\/56\.png"/)
            expect(var_(html, 'no-chain-open'), mode).toBe(false)
        }
        // Base ETH secilince cip ag adini ve yerel rozeti tasir.
        const base = await goster('send', (s) => s.onPickToken(BASE_ETH, 'https://img/uzak-eth.png'))
        const chip = parca(base.html, 'delivery-chip')
        expect(chip).toContain('>ETH</span>')
        expect(chip).toContain('>Base</span>')
        expect(chip).toMatch(/<img[^>]*src="\/chains\/8453\.png"/)
        expect(chip).not.toContain('uzak-eth')

        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '')
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
        for (const mode of ['fund', 'send']) {
            const { app, s, sent } = await ready(mode)
            const html = await render(app)
            expect(var_(html, 'delivery-chip'), mode).toBe(false)
            expect(var_(html, 'no-chain-open'), mode).toBe(true)
            expect(s.quoteEligible, mode).toBe(false)
            expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE'), mode).toHaveLength(0)
        }
    })

    it('(b) estimate (Takas/Kopru karti): teklif yokken "—", teklifle "~24.65"; text-slate-800, salt okunur, truncate, boyut kademeleri', async () => {
        const bos = await goster('swap')
        expect(metin(bos.html, 'estimate')).toBe('\u2014')
        expect(var_(bos.html, 'calc-pill')).toBe(false)
        const dolu = await goster('swap', (s) => { s.quote = TEKLIF })
        expect(metin(dolu.html, 'estimate')).toBe('~24.65')
        const tag = etiket(dolu.html, 'estimate')
        expect(tag).toContain('text-slate-800')
        expect(tag).toContain('dark:text-zinc-200')
        expect(tag).toContain('truncate')
        expect(tag).toContain('text-3xl')
        expect(tag).not.toContain('<input')
        expect(tag).toContain('title="24.65"')
        // 360 px'te ~105 px: 5 karakter text-3xl, 6-8 karakter text-xl, 9+ text-base (V1).
        const bes = await goster('swap', (s) => { s.quote = { ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '100500000000000000000' } } })
        expect(metin(bes.html, 'estimate')).toBe('~100.5')
        expect(etiket(bes.html, 'estimate')).toContain('text-3xl')
        const alti = await goster('swap', (s) => { s.quote = { ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '1500000000000000000000' } } })
        expect(metin(alti.html, 'estimate')).toBe('~1500.0')
        expect(etiket(alti.html, 'estimate')).toContain('text-xl')
        expect(etiket(alti.html, 'estimate')).not.toContain('text-3xl')
        const yedi = await goster('swap', (s) => { s.quote = { ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '12300000000000000' } } })
        expect(metin(yedi.html, 'estimate')).toBe('~0.0123')
        expect(etiket(yedi.html, 'estimate')).toContain('text-xl')
        const uzun = await goster('swap', (s) => { s.quote = { ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '123456789123400000000000000' } } })
        expect(metin(uzun.html, 'estimate')).toBe('~123456789.1234')
        expect(etiket(uzun.html, 'estimate')).toContain('text-base')
        expect(etiket(uzun.html, 'estimate')).not.toContain('text-3xl')
        expect(etiket(uzun.html, 'estimate')).not.toContain('text-xl')
        // Bozuk ham tutar "~" ile yarim yazilmaz.
        const bozuk = await goster('swap', (s) => { s.quote = { ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: 'abc' } } })
        expect(metin(bozuk.html, 'estimate')).toBe('\u2014')
    })

    it('(b2) min-eta: teklif yokken bos; "En az 24 USDC · ~3 min"; sure bilinmiyorsa "En az 24 USDC" (minOnly)', async () => {
        const bos = await goster('send')
        expect(metin(bos.html, 'min-eta')).toBe('')
        const dolu = await goster('send', (s) => { s.quote = TEKLIF })
        expect(metin(dolu.html, 'min-eta')).toBe('At least 24.0 USDC \u00b7 ~3 min')
        // 90000 ms (SUMMARY) -> 2 dk; n en az 1.
        const iki = await goster('send', (s) => { s.quote = SUMMARY })
        expect(metin(iki.html, 'min-eta')).toBe('At least 24.0 USDC \u00b7 ~2 min')
        const kisa = await goster('send', (s) => { s.quote = { ...TEKLIF, expectedFulfillmentMs: 1000 } })
        expect(metin(kisa.html, 'min-eta')).toBe('At least 24.0 USDC \u00b7 ~1 min')
        for (const yok of [undefined, null, 0, -5, 'x', NaN]) {
            const r = await goster('send', (s) => { s.quote = { ...TEKLIF, expectedFulfillmentMs: yok } })
            expect(metin(r.html, 'min-eta'), String(yok)).toBe('At least 24.0 USDC')
        }
        // Sembol ve en az tutar teklifin dest alanindan (secili tokenden degil).
        const baska = await goster('send', (s) => { s.quote = { ...TEKLIF, dest: { chainId: 8453, asset: 'ETH', decimals: 18, expectedDestAmount: '6000000000000000', minDestAmount: '5000000000000000', quoteUsd: null } } })
        expect(metin(baska.html, 'min-eta')).toBe('At least 0.005 ETH \u00b7 ~3 min')
    })

    it('(b3) uygun girdi + faz waiting/quoting + teklif yok: calc-pill ("Hesaplaniyor") gorunur, estimate metni YOK; teklif varken pil cikmaz', async () => {
        vi.useFakeTimers()
        try {
            // Fund'da kaynak hesap onMounted'ta secilir; yakalama aninda elle verilir. onQuoteInput fazi waiting yapar (gercek izleyici SSR'da calismaz).
            const uygun = (s) => { s.sourceKey = 'a-1'; s.amount = '25'; s.onQuoteInput('discrete') }
            const pil = await goster('fund', uygun)
            expect(pil.s.phase).toBe('waiting')
            expect(var_(pil.html, 'calc-pill')).toBe(true)
            expect(var_(pil.html, 'estimate')).toBe(false)
            expect(parca(pil.html, 'calc-pill')).toContain('Calculating...')
            const teklifli = await goster('fund', (s) => { uygun(s); s.quote = TEKLIF })
            expect(var_(teklifli.html, 'calc-pill')).toBe(false)
            expect(metin(teklifli.html, 'estimate')).toBe('~24.65')
            const rahat = await goster('fund')
            expect(var_(rahat.html, 'calc-pill')).toBe(false)
            // Uygun degilken (12 altinda) faz idle: pil yok.
            const dusuk = await goster('fund', (s) => { s.sourceKey = 'a-1'; s.amount = '5'; s.onQuoteInput('discrete') })
            expect(dusuk.s.phase).toBe('idle')
            expect(var_(dusuk.html, 'calc-pill')).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('(c) picker\'a giden chains: fund ve send listeyi suzmez (openDeliveryChains(mode)); swap ve bridge Para yukle (FUND) satirlarindan secilir', async () => {
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56,8453')
        const fund = await ready('fund')
        const send = await ready('send')
        expect(fund.s.deliveryChains.map((c) => c.chainId)).toEqual([56, 8453])
        expect(send.s.deliveryChains.map((c) => c.chainId)).toEqual([56, 1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
        for (const c of [...fund.s.deliveryChains, ...send.s.deliveryChains]) expect(Object.keys(c)).toEqual(expect.arrayContaining(['chainId', 'name', 'logo']))
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toContain(':chains="deliveryChains"')
        // Tek mod anahtari: swap/bridge FUND satirlarindan, kalan modlar (fund, send) openDeliveryChains(props.mode) ile; SEND listesi ASLA literal degil.
        const govde = cagriGovdesi(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'), /const deliveryChains = computed\(/)
        expect(govde).not.toBeNull()
        expect(govde).toContain("props.mode === 'swap'")
        expect(govde).toContain("props.mode === 'bridge'")
        expect(govde).toContain("openDeliveryChains('fund')")
        expect(govde).toContain('return openDeliveryChains(props.mode)')
        expect(govde).not.toContain("openDeliveryChains('send')")
    })

    it('(d) onPickToken({ chainId: 8453, ... }) outputToken.chainId yi 8453 yapar ve deliveryChainName Base olur; ag cipi (selectScope) outputToken i DEGISTIRMEZ', async () => {
        const { s } = await ready('send')
        const onceki = s.outputToken
        expect(s.deliveryChainName).toBe('BNB Smart Chain')
        s.onPickToken({ chainId: 8453, address: BASE_ETH.address, symbol: 'ETH', decimals: 18 })
        expect(s.outputToken.chainId).toBe(8453)
        expect(s.outputToken).not.toBe(onceki)
        expect(s.deliveryChainName).toBe('Base')
        // Secici yalniz token secilince select yayar: ag cipi (selectScope) listeyi cevirir, emit etmez (secici testleri secim olayini kilitler).
        const secici = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateDeliveryTokenPicker.vue', import.meta.url)), 'utf8'))
        const govde = secici.slice(secici.indexOf('async function selectScope'), secici.indexOf('\n}', secici.indexOf('async function selectScope')))
        expect(govde).not.toContain('emit(')
        // Ekran ag secimini YALNIZ onPickToken ten alir: deliveryChainId kurucusu secici olayina bagli degil.
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toContain('@select="onPickToken"')
        expect(kaynak).not.toMatch(/@select="[^"]*deliveryChainId/)
    })

    it('(e) tek acik teslim aginda cip etkilesimli kalir (token secimi), ag cipi satiri yalniz secicide ve >1 aglada', async () => {
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '56')
        for (const mode of ['send']) {
            const { html, s } = await goster(mode)
            expect(s.deliveryChains.map((c) => c.chainId)).toEqual([56])
            expect(parca(html, 'delivery-chip')).toMatch(/^<button/)
            expect(parca(html, 'delivery-chip')).toContain('aria-haspopup="dialog"')
        }
        const secici = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateDeliveryTokenPicker.vue', import.meta.url)), 'utf8'))
        expect(secici).toContain('v-if="chains.length > 1"')
    })

    it('(f) hicbir src uzak degil, "≈ $" yok (teklifli ve teklifsiz, iki modda); secili token uzak logo getirse bile', async () => {
        for (const mode of ['fund', 'send']) {
            for (const teklif of [false, true]) {
                const { html } = await goster(mode, (s) => {
                    s.onPickToken(BASE_ETH, 'https://img/uzak-eth.png')
                    if (teklif) s.quote = { ...TEKLIF, dest: { chainId: 8453, asset: 'ETH', decimals: 18, expectedDestAmount: '6000000000000000', minDestAmount: '5000000000000000', quoteUsd: 12.3 } }
                })
                for (const [, src] of html.matchAll(/\ssrc="([^"]*)"/g)) expect(src, `${mode} ${teklif}`).not.toMatch(/^(https?:)?\/\//)
                expect(html, mode).not.toContain('≈ $')
            }
        }
    })

    it('(g) PrivateOption + Field bileseni ve testi silindi, hicbir yerde ice aktarilmaz; PrivateOptionSheet (Kimden paneli) kalir', () => {
        const dir = fileURLToPath(new URL('.', import.meta.url))
        const eski = 'PrivateOption' + 'Field'
        expect(existsSync(dir + eski + '.vue')).toBe(false)
        expect(existsSync(dir + eski + '.ssr.test.js')).toBe(false)
        expect(existsSync(dir + 'PrivateOptionSheet.vue')).toBe(true)
        const src = fileURLToPath(new URL('../../', import.meta.url))
        const gez = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? gez(d + e.name + '/') : [d + e.name]))
        const kullanan = gez(src).filter((f) => /\.(vue|js|json)$/.test(f)).filter((f) => readFileSync(f, 'utf8').includes(eski))
        expect(kullanan).toEqual([])
    })

    it('(h) kaynak: alt kutu teslim cipi PrivateAssetChip ile, eski Teslim agi/Teslim varligi alanlari ve yerel kopyalar kalkti', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toContain('testid="delivery-chip"')
        expect(kaynak).not.toContain('deliveryChainOptions')
        expect(kaynak).not.toContain('delivery-token')
        expect(kaynak).not.toContain("privacy.transfer.outputAsset")
        expect(kaynak).not.toContain("privacy.transfer.deliveryNetwork")
        expect(kaynak).toContain('const deliveryChainId = computed({')
        expect(kaynak).toContain('const deliveryChainName = computed(')
        // X9: satir ici SVG xmlns tasimaz.
        expect(kaynak).not.toContain('xmlns')
    })
})

describe('PrivateTransfer -- alici kutusu, amber not ve kopru baglantisinin yoklugu (Task 14)', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { html, s: m.captured.instance.setupState, sent: m.sent }
    }
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const EN = (yol) => yol.split('.').reduce((o, k) => o[k], JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/en.json', import.meta.url)), 'utf8')))
    const SAHTE_PANO = (readText) => vi.stubGlobal('navigator', { clipboard: { readText } })
    // Gecerli, harfli bir adres: checksum'li, tamami kucuk harfli ve checksum'u BOZUK (tek harfin boyu cevrilmis) uc bicim.
    const HARFLI = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
    const KUCUK = HARFLI.toLowerCase()
    const BOZUK = (() => {
        const govde = HARFLI.slice(2)
        const i = govde.search(/[a-fA-F]/)
        const c = govde[i]
        return '0x' + govde.slice(0, i) + (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) + govde.slice(i + 1)
    })()

    it('send: alici kutusu kartsiz duzende "Recipient" etiketi ile teslim ozeti ARASINDA; mono girdi (placeholder 0x..., spellcheck kapali), "Paste" dugmesi; eski bagimsiz girdi yok', async () => {
        const { html } = await goster('send')
        const girdi = etiket(html, 'recipient-input')
        expect(girdi).toMatch(/^<input/)
        expect(girdi).toContain('font-mono')
        expect(girdi).toContain('placeholder="0x..."')
        expect(girdi).toContain('spellcheck="false"')
        const dugme = etiket(html, 'paste-button')
        expect(dugme).toMatch(/^<button/)
        expect(html).toContain('>Paste<')
        // Girdi ve dugme teslim ozetinden (delivery-chip) ve "En az" satirindan once, "Recipient" etiketinden sonra.
        const kartSonu = html.indexOf('data-testid="min-eta"')
        const ozetIdx = html.indexOf('data-testid="delivery-chip"')
        const girdiIdx = html.indexOf('data-testid="recipient-input"')
        expect(girdiIdx).toBeGreaterThan(html.indexOf('>Recipient<'))
        expect(girdiIdx).toBeLessThan(ozetIdx)
        expect(girdiIdx).toBeLessThan(kartSonu)
        expect(html.indexOf('data-testid="paste-button"')).toBeGreaterThan(girdiIdx)
        expect(html.indexOf('data-testid="paste-button"')).toBeLessThan(ozetIdx)
        // Kart yok: girdi bir kartin (rounded-3xl) icinde degil.
        expect(html).not.toContain('rounded-3xl')
        // Eski bagimsiz girdi (kartin altinda "Recipient address" etiketli) kalkti.
        expect(html).not.toContain('Recipient address')
    })

    it('fund: recipient-input, paste-button, bridge-link, recipient-note, same-account hic cizilmez (Base teslim secili olsa da)', async () => {
        const { html } = await goster('fund', (s) => { s.deliveryChainId = 8453 })
        for (const id of ['recipient-input', 'paste-button', 'bridge-link', 'recipient-note', 'same-account']) expect(var_(html, id), id).toBe(false)
    })

    it('pasteRecipient: pano degeri KIRPILMIS yazilir (bas/son bosluk ve satir sonu)', async () => {
        const { s } = await goster('send')
        SAHTE_PANO(vi.fn(async () => ' ' + HARFLI + '\n'))
        await s.pasteRecipient()
        expect(s.recipient).toBe(HARFLI)
        expect(s.error).toBe('')
    })

    it('pasteRecipient: bos pano alani degistirmez; onceki hata temizlenir', async () => {
        const { s } = await goster('send')
        s.recipient = STRANGER
        s.error = 'eski hata'
        SAHTE_PANO(vi.fn(async () => '  \n'))
        await s.pasteRecipient()
        expect(s.recipient).toBe(STRANGER)
        expect(s.error).toBe('')
    })

    it('pasteRecipient: pano reddedilirse (izin yok) alan degismez ve hata send.pasteFailed metnidir', async () => {
        const { s } = await goster('send')
        s.recipient = STRANGER
        SAHTE_PANO(vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError') }))
        await s.pasteRecipient()
        expect(s.recipient).toBe(STRANGER)
        expect(s.error).toBe(EN('send.pasteFailed'))
    })

    it('pasteRecipient: navigator.clipboard hic yoksa da sessiz kalmaz (pasteFailed)', async () => {
        const { s } = await goster('send')
        vi.stubGlobal('navigator', {})
        await s.pasteRecipient()
        expect(s.error).toBe(EN('send.pasteFailed'))
    })

    it('amber alici notu teklif YOKKEN de Base teslim seciliyken var; BSC secilince yok', async () => {
        const base = await goster('send', (s) => { s.deliveryChainId = 8453 })
        expect(base.s.quote).toBeNull()
        expect(var_(base.html, 'recipient-note')).toBe(true)
        expect(base.html).toContain('Make sure the recipient uses this address on Base.')
        expect(etiket(base.html, 'recipient-note')).toContain('amber')
        const bsc = await goster('send')
        expect(var_(bsc.html, 'recipient-note')).toBe(false)
        expect(bsc.html).not.toContain('Make sure the recipient')
    })

    it('same-account: alici Gizli Hesap adresinin KUCUK, BUYUK ve checksum harfli biciminde cikar; baska adreste cikmaz', async () => {
        for (const bicim of [GIZLI, '0x' + GIZLI.slice(2).toUpperCase(), getAddress(GIZLI), ' ' + GIZLI + ' ']) {
            const { html, s } = await goster('send', (st) => { st.recipient = bicim })
            expect(s.privateRecipient, bicim).toBe(true)
            expect(var_(html, 'same-account'), bicim).toBe(true)
            expect(html, bicim).toContain(EN('privacy.transfer.sameAccount').replace("'", '&#39;'))
            expect(etiket(html, 'same-account'), bicim).toContain('red')
        }
        const baska = await goster('send', (st) => { st.recipient = STRANGER })
        expect(var_(baska.html, 'same-account')).toBe(false)
    })

    it('X18 -- checksum\'u BOZUK karisik harfli adres: teklif uygun degil ve istek GITMEZ', async () => {
        expect(BOZUK).not.toBe(HARFLI)
        const { s, sent } = await ready('send')
        s.recipient = BOZUK
        s.amount = '12'
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE')).toHaveLength(0)
    })

    it('X18 -- tamami kucuk harfli gecerli adres ve dogru checksum\'lu adres: teklif uygun, istek aliciyi OLDUGU GIBI tasir', async () => {
        for (const adres of [KUCUK, HARFLI]) {
            const { s, sent } = await ready('send')
            s.recipient = adres
            s.amount = '12'
            expect(s.quoteEligible, adres).toBe(true)
            await quoteAl(s)
            expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message.outputAddress, adres).toBe(adres)
        }
    })

    it('X18 -- alici Gizli Hesap\'in kendisi (farkli harf boyu): teklif uygun degil ve istek GITMEZ', async () => {
        const { s, sent } = await ready('send')
        s.recipient = getAddress(GIZLI)
        s.amount = '12'
        expect(s.privateRecipient).toBe(true)
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE')).toHaveLength(0)
    })

    it('SIRA: kartin altinda amber not, SecurityWarning, Ucretler karti; kopru baglantisi govdede yok (HTML indeks sirasi)', async () => {
        const { html } = await goster('send', (s) => { s.deliveryChainId = 8453; s.securityChecking = true })
        const not = html.indexOf('data-testid="recipient-note"')
        const guvenlik = html.indexOf(EN('send.reputation.checking'))
        const ucretler = html.indexOf('data-testid="fee-card"')
        expect(not).toBeGreaterThan(-1)
        expect(guvenlik).toBeGreaterThan(not)
        expect(ucretler).toBeGreaterThan(guvenlik)
        expect(html).not.toContain('data-testid="bridge-link"')
        expect(html.indexOf('data-testid="min-eta"')).toBeLessThan(not)
    })

    it('kaynak: alici girdisi v-model.trim; eski exit-card/exitGas yok, SecurityWarning tek kez', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toContain('v-model.trim="recipient"')
        expect(kaynak).not.toContain('exit-card')
        expect(kaynak).not.toContain('privacy.transfer.exitTitle')
        expect(kaynak).not.toContain('privacy.transfer.exitBody')
        expect(kaynak).not.toContain('privacy.transfer.exitGas')
        expect(kaynak.split('<SecurityWarning').length - 1).toBe(1)
        expect(kaynak).not.toContain('xmlns')
    })
})

// ----------------------------------------------------------------------------------------------------------------
// Sade ekran, Task 15: otomatik teklif bagi; "Teklif al" dugmesi kalkti (K9, sT7, sT11, spec Bolum 6).
// Zamanlayici testleri sahte saatle calisir: ekran (ready) GERCEK zamanlayicida kurulur, sonra vi.useFakeTimers() acilir.
// ----------------------------------------------------------------------------------------------------------------
describe('PrivateTransfer -- otomatik teklif (Task 15)', () => {
    afterEach(() => { vi.useRealTimers() })

    const kaynak = () => yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
    const teklifler = (sent) => sent.filter((m) => m.type === 'PRIVATE_QUOTE')
    const adim = (ms) => vi.advanceTimersByTimeAsync(ms)
    const INFO = (over = {}) => ({ success: true, info: { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true, ...over } })
    // Girdiyi render'dan ONCE kurar (yakalama aninda); HTML ve canli setupState doner.
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { ...m, html, s: m.captured.instance.setupState }
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const govde = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.indexOf('>', i) + 1, html.indexOf('</', i))
    }
    // Zamanlayici anlik goruntusunu elle kurar (yalniz cizim testleri): gercek zamanlayici degismez.
    const faz = (phase, ek = {}) => (s) => { s.schedState = { phase, seq: 1, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false, ...ek } }

    describe('quoteEligible tablosu (Review Focus 3)', () => {
        it('fund: kanonik olmayan ya da 12 altindaki tutarlar uygun degil', async () => {
            const { s } = await ready('fund')
            for (const bad of ['', '   ', '11.99', 'abc', '12.', '12,', ',5', '1e3', '12.0000000000000000001']) {
                s.amount = bad
                expect(s.quoteEligible, JSON.stringify(bad)).toBe(false)
            }
        })

        it('fund: 12, 12,5 ve 0012 uygun', async () => {
            const { s } = await ready('fund')
            for (const good of ['12', '12,5', '0012']) {
                s.amount = good
                expect(s.quoteEligible, good).toBe(true)
            }
        })

        it('send: gecersiz alici, Gizli Hesap\'in kendisi (buyuk harfli dahil) ve yanlis checksum uygun degil; kucuk harfli gecerli adres uygun (X18)', async () => {
            const { s } = await ready('send')
            s.amount = '12'
            s.recipient = STRANGER
            expect(s.quoteEligible).toBe(true)
            for (const bad of ['', '0x123', '0x' + 'g'.repeat(40), GIZLI, '0x' + 'CD'.repeat(20)]) {
                s.recipient = bad
                expect(s.quoteEligible, bad).toBe(false)
            }
            const cs = getAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')
            const yanlis = '0x' + cs.slice(2).split('').map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('')
            expect(isAddress(yanlis)).toBe(false)
            s.recipient = yanlis
            expect(s.quoteEligible).toBe(false)
            s.recipient = cs.toLowerCase()
            expect(s.quoteEligible).toBe(true)
            s.recipient = cs
            expect(s.quoteEligible).toBe(true)
        })

        it('send: securityBlocked true iken de uygun (K9); engel yalniz onayi kapatir', async () => {
            const { s } = await ready('send')
            s.recipient = LOOKALIKE
            s.amount = '12'
            expect(s.securityBlocked).toBe(true)
            expect(s.quoteEligible).toBe(true)
            const kod = kaynak()
            expect(kod).toMatch(/:disabled="[^"]*mode === 'send' && securityBlocked/)
        })

        it('USDC odemede tutar > bakiye uygun degil; USDT odemede bakiye karsilastirilmaz', async () => {
            flags.bridged = true
            const { s } = await ready('fund')
            s.balance = 10
            s.amount = '12'
            expect(s.quoteEligible).toBe(false)
            // SilentSwap ucreti ustune eklenir (I2): 12 USDC odeme icin 12.12 gerekir; yedek oran %1.
            s.balance = 12
            expect(s.quoteEligible).toBe(false)
            s.balance = 12.12
            expect(s.quoteEligible).toBe(true)
            s.chainId = 1
            s.asset = 'USDT'
            s.balance = 10
            expect(s.quoteEligible).toBe(true)
        })

        it('providerInfo: available=false uygun degil; minUsdc yukseltme yonunde izlenir (15: 14 degil, 15 evet); yanit yoksa 12 gecerli', async () => {
            const a = await ready('fund', { providerInfo: INFO({ available: false }) })
            a.s.amount = '25'
            expect(a.s.providerInfo.available).toBe(false)
            expect(a.s.quoteEligible).toBe(false)

            const b = await ready('fund', { providerInfo: INFO({ minUsdc: 15 }) })
            b.s.amount = '14'
            expect(b.s.quoteEligible).toBe(false)
            b.s.amount = '15'
            expect(b.s.quoteEligible).toBe(true)

            const c = await ready('fund')
            expect(c.s.providerInfo).toBeNull()
            c.s.amount = '12'
            expect(c.s.quoteEligible).toBe(true)

            // Dusuk sunucu degeri en azi indirmez (yalniz yukseltme).
            const d = await ready('fund', { providerInfo: INFO({ minUsdc: 5 }) })
            d.s.amount = '11'
            expect(d.s.quoteEligible).toBe(false)
        })
    })

    describe('PRIVATE_PROVIDER_INFO yuklemesi', () => {
        it('acilista TAM bir kez istenir ve tekliften sonra yinelenmez; bos yanit ekrani engellemez', async () => {
            const { s, infoSent, sent } = await ready('fund')
            expect(infoSent).toHaveLength(1)
            expect(infoSent[0].type).toBe('PRIVATE_PROVIDER_INFO')
            s.amount = '25'
            await quoteAl(s)
            await quoteAl(s)
            expect(infoSent).toHaveLength(1)
            expect(teklifler(sent).length).toBeGreaterThan(0)
            expect(s.providerInfo).toBeNull()
        })

        it('yanit bozuk / basarisiz / mesaj firlatirsa providerInfo null, ekran calisir', async () => {
            for (const providerInfo of [{ success: false }, { success: true, info: 'x' }, { success: true, info: null }, null, 'throw']) {
                const { s, sent } = await ready('fund', { providerInfo })
                expect(s.providerInfo, JSON.stringify(providerInfo)).toBeNull()
                s.amount = '25'
                await quoteAl(s)
                expect(teklifler(sent), JSON.stringify(providerInfo)).toHaveLength(1)
                expect(s.quote).toBeTruthy()
            }
        })

        it('gecerli yanit yalniz dort alani saklar (feeBps, minUsdc, maxUsdc, available)', async () => {
            const { s } = await ready('fund', { providerInfo: { success: true, info: { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true, ticket: '0xsizinti' } } })
            expect(s.providerInfo).toEqual({ feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true })
        })
    })

    describe('zamanlama (800 / 300 ms, uygun degilken istek yok)', () => {
        it('tutar yazimi: 799 ms hicbir istek yok, 800 ms TAM bir istek ve yuk requestInputs() ile birebir', async () => {
            const { s, sent } = await ready('fund')
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('amount')
            await adim(799)
            expect(teklifler(sent)).toHaveLength(0)
            expect(s.phase).toBe('waiting')
            await adim(1)
            expect(teklifler(sent)).toHaveLength(1)
            expect(teklifler(sent)[0].message).toEqual(s.requestInputs())
            expect(teklifler(sent)[0].message.payoutUsdc).toBe('25')
            await adim(5000)
            expect(teklifler(sent)).toHaveLength(1)
            expect(s.phase).toBe('ready')
        })

        it('ayrik girdi 300 ms: 299 ms yok, 300 ms bir istek', async () => {
            const { s, sent } = await ready('fund')
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('discrete')
            await adim(299)
            expect(teklifler(sent)).toHaveLength(0)
            await adim(1)
            expect(teklifler(sent)).toHaveLength(1)
        })

        it("tutar '2' sonra 300 ms icinde '25' ve '12' sonra '125': tek istek", async () => {
            for (const [ilk, son] of [['2', '25'], ['12', '125']]) {
                const { s, sent } = await ready('fund')
                vi.useFakeTimers()
                s.amount = ilk
                s.onQuoteInput('amount')
                await adim(200)
                s.amount = son
                s.onQuoteInput('amount')
                await adim(5000)
                expect(teklifler(sent), ilk + '>' + son).toHaveLength(1)
                expect(teklifler(sent)[0].message.payoutUsdc).toBe(son)
                vi.useRealTimers()
            }
        })

        it("uygun degilken ('11') 5 sn ilerlese de istek yok, faz idle", async () => {
            const { s, sent } = await ready('fund')
            vi.useFakeTimers()
            s.amount = '11'
            s.onQuoteInput('amount')
            s.onQuoteInput('discrete')
            await adim(5000)
            expect(teklifler(sent)).toHaveLength(0)
            expect(s.phase).toBe('idle')
        })

        it('send: alici karakter karakter yazilir; gecerli olana dek istek yok, gecerli olunca 300 ms sonra bir istek', async () => {
            const { s, sent } = await ready('send')
            vi.useFakeTimers()
            s.amount = '12'
            for (let n = 0; n < STRANGER.length; n++) {
                s.recipient = STRANGER.slice(0, n)
                s.onQuoteInput('discrete')
                await adim(50)
            }
            await adim(5000)
            expect(teklifler(sent)).toHaveLength(0)
            s.recipient = STRANGER
            s.onQuoteInput('discrete')
            await adim(299)
            expect(teklifler(sent)).toHaveLength(0)
            await adim(1)
            expect(teklifler(sent)).toHaveLength(1)
            expect(teklifler(sent)[0].message.outputAddress).toBe(STRANGER)
        })
    })

    describe('izleyici girdisi (kullanici anahtari, tur secimi)', () => {
        it('userKey bakiye/providerInfo/gecersiz alici degisimlerinden etkilenmez; tutar ve gecerli girdilerle degisir', async () => {
            const { s } = await ready('send')
            s.amount = '12'
            s.recipient = STRANGER
            const k0 = s.userKey
            s.balance = 99
            s.providerInfo = { feeBps: 100, minUsdc: 20, maxUsdc: 1, available: true }
            expect(s.userKey).toBe(k0)
            s.recipient = STRANGER.slice(0, 20)
            const gecersiz = s.userKey
            s.recipient = STRANGER.slice(0, 21)
            expect(s.userKey).toBe(gecersiz)
            s.recipient = STRANGER
            expect(s.userKey).toBe(k0)
            s.recipient = '0x' + '8'.repeat(40)
            expect(s.userKey).not.toBe(k0)
            s.recipient = STRANGER
            s.onPickToken(CAKE_TOKEN)
            expect(s.userKey).not.toBe(k0)
        })

        it("onInputWatch: yalniz tutar (uygunluk dondugunde de) 'amount' 800 ms; kullanici anahtari ya da yalniz uygunluk degisirse 'discrete' 300 ms", async () => {
            const { s, sent } = await ready('fund')
            const durum = (amount, key, eligible) => ({ amount, key, eligible })
            // '2' -> '25': uygunluk dondu ama degisen yalniz tutar: 800 ms.
            vi.useFakeTimers()
            s.amount = '25'
            s.onInputWatch(durum('25', 'K', true), durum('2', 'K', false))
            await adim(799)
            expect(teklifler(sent)).toHaveLength(0)
            await adim(1)
            expect(teklifler(sent)).toHaveLength(1)
            vi.useRealTimers()
            // Kullanici anahtari degisti: 300 ms.
            const b = await ready('fund')
            vi.useFakeTimers()
            b.s.amount = '25'
            b.s.onInputWatch(durum('25', 'K2', true), durum('25', 'K', true))
            await adim(299)
            expect(teklifler(b.sent)).toHaveLength(0)
            await adim(1)
            expect(teklifler(b.sent)).toHaveLength(1)
            vi.useRealTimers()
            // Yalniz uygunluk degisti (bakiye/saglayici bilgisi geldi): 300 ms.
            const c = await ready('fund')
            vi.useFakeTimers()
            c.s.amount = '25'
            c.s.onInputWatch(durum('25', 'K', true), durum('25', 'K', false))
            await adim(300)
            expect(teklifler(c.sent)).toHaveLength(1)
        })

        it('kaynak: tek izleyici onInputWatch u cagirir; onQuoteInput(amount) ve (discrete) kaynakta var; eski toplu izleyici yok', () => {
            const kod = kaynak()
            expect(kod).toContain("onQuoteInput('amount')")
            expect(kod).toContain("onQuoteInput('discrete')")
            expect(kod).toMatch(/watch\(\(\) => \(\{[^}]*amount[^}]*\}\), onInputWatch\)/)
            expect(kod).not.toMatch(/watch\(\[[^\]]*\], invalidateQuote\)/)
        })
    })

    describe('Review Focus 1: ucustaki eski cevap teklif kurmaz', () => {
        // Her PRIVATE_QUOTE istegi ayri bir kapida bekler; kapi acilinca o istegin KENDI girdisine uygun teklif doner.
        function kapili() {
            const kapilar = []
            const reply = async (m) => {
                if (m.type !== 'PRIVATE_QUOTE') return { success: true }
                const n = kapilar.length
                await new Promise((r) => kapilar.push(r))
                const t = m.message.outputToken
                return { success: true, quote: { ...SUMMARY, ticket: '0xt' + (n + 1), recipient: m.message.outputAddress, recipientChainId: t.chainId, dest: { ...SUMMARY.dest, chainId: t.chainId, asset: t.symbol, decimals: t.decimals } } }
            }
            return { kapilar, reply }
        }

        it('ucustayken tutar degisir: ilk cevap teklif KURMAZ, ikinci cevap kurar ve quoteKey ikinciyle esit', async () => {
            const { kapilar, reply } = kapili()
            const { s, sent } = await ready('fund', { reply })
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('amount')
            await adim(800)
            expect(teklifler(sent)).toHaveLength(1)
            s.amount = '30'
            s.onQuoteInput('amount')
            kapilar[0]()
            await adim(1)
            expect(s.quote).toBeNull()
            expect(teklifler(sent)).toHaveLength(1)
            await adim(5000)
            expect(teklifler(sent)).toHaveLength(2)
            expect(teklifler(sent)[1].message.payoutUsdc).toBe('30')
            kapilar[1]()
            await adim(1)
            expect(s.quote.ticket).toBe('0xt2')
            expect(s.quoteKey).toBe(JSON.stringify(teklifler(sent)[1].message))
            expect(s.quoteKey).toBe(JSON.stringify(s.requestInputs()))
            expect(s.phase).toBe('ready')
        })

        it('yanit gelmeden alici degisince eski teklif kurulmaz', async () => {
            const { kapilar, reply } = kapili()
            const { s, sent } = await ready('send', { reply })
            vi.useFakeTimers()
            s.amount = '12'
            s.recipient = STRANGER
            s.onQuoteInput('discrete')
            await adim(300)
            expect(teklifler(sent)).toHaveLength(1)
            s.recipient = '0x' + '8'.repeat(40)
            s.onQuoteInput('discrete')
            kapilar[0]()
            await adim(1)
            expect(s.quote).toBeNull()
            await adim(5000)
            expect(teklifler(sent)).toHaveLength(2)
            kapilar[1]()
            await adim(1)
            expect(s.quote.recipient).toBe('0x' + '8'.repeat(40))
        })

        it('girdi degisti ama zamanlayiciya bildirilmedi (seq guncel): iki denetimli yanit yine atilir, ekran yeniden dener ve guncel girdiyle kurar', async () => {
            const { kapilar, reply } = kapili()
            const { s, sent } = await ready('fund', { reply })
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('discrete')
            await adim(300)
            s.amount = '30'
            kapilar[0]()
            await adim(1)
            expect(s.quote).toBeNull()
            expect(s.phase).toBe('waiting')
            await adim(5000)
            expect(teklifler(sent)).toHaveLength(2)
            expect(teklifler(sent)[1].message.payoutUsdc).toBe('30')
            kapilar[1]()
            await adim(1)
            expect(s.quoteKey).toBe(JSON.stringify(s.requestInputs()))
        })
    })

    describe('I2: SilentSwap ucreti tutarin USTUNE eklenir; uygunluk, kirmizi bakiye ve cipler amount x (1 + feeBps/10000) ile', () => {
        it('MAX cipi: bakiye 15.15, feeBps 100 -> 15 (bakiye asilmaz); yuzde cipleri de ucrete bolunur; providerInfo yoksa yedek %1', async () => {
            const a = await ready('fund', { providerInfo: INFO({ feeBps: 100 }) })
            a.s.balance = 15.15
            a.s.setPercent(1)
            expect(a.s.amount).toBe('15')
            expect(a.s.quoteEligible).toBe(true)
            const b = await ready('fund')
            b.s.balance = 15.15
            b.s.setPercent(1)
            expect(b.s.amount).toBe('15')
            const c = await ready('fund', { providerInfo: INFO({ feeBps: 50 }) })
            c.s.balance = 15.075
            c.s.setPercent(1)
            expect(c.s.amount).toBe('15')
            const d = await ready('fund')
            d.s.balance = 10
            d.s.setPercent(0.5)
            expect(d.s.amount).toBe('4.950495')
            d.s.setPercent(1)
            expect(d.s.amount).toBe('9.90099')
            expect(Number(d.s.amount) * 1.01).toBeLessThanOrEqual(10)
        })

        it('tutar 15, bakiye 15.10 -> uygun degil ve bakiye kirmizi; bakiye 15.15 -> uygun; feeBps providerInfo den gelir (200 -> 15.15 yetmez)', async () => {
            const a = await ready('fund')
            a.s.amount = '15'
            a.s.balance = 15.1
            expect(a.s.quoteEligible).toBe(false)
            expect(a.s.balanceRed).toBe(true)
            a.s.balance = 15.15
            expect(a.s.quoteEligible).toBe(true)
            expect(a.s.balanceRed).toBe(false)
            const b = await ready('fund', { providerInfo: INFO({ feeBps: 200 }) })
            b.s.amount = '15'
            b.s.balance = 15.15
            expect(b.s.quoteEligible).toBe(false)
            expect(b.s.balanceRed).toBe(true)
            b.s.balance = 15.3
            expect(b.s.quoteEligible).toBe(true)
        })

        it('USDT odemede bakiye karsilastirmasi yok (tutar USDC degerinde); kaynak yedek feeBps i balanceFeeBps ile alir', async () => {
            flags.bridged = true
            const a = await ready('fund')
            a.s.chainId = 1
            a.s.asset = 'USDT'
            a.s.amount = '15'
            a.s.balance = 15.1
            expect(a.s.balanceRed).toBe(false)
            expect(a.s.quoteEligible).toBe(true)
            expect(kaynak()).toContain('balanceFeeBps(providerInfo.value)')
        })
    })

    describe('I1: yenileme cevabi sure bittikten sonra gelirse yeni teklif kurulmaz', () => {
        const teklifCevabi = (kapi) => {
            let n = 0
            return async (m) => {
                if (m.type !== 'PRIVATE_QUOTE') return { success: true }
                const k = ++n
                if (kapi && k === 2) await kapi
                const t = m.message.outputToken
                return { success: true, quote: { ...SUMMARY, ticket: '0xt' + k, expiresAtMs: Date.now() + 60000, recipient: m.message.outputAddress, recipientChainId: t.chainId, dest: { ...SUMMARY.dest, chainId: t.chainId, asset: t.symbol, decimals: t.decimals } } }
            }
        }

        it('hazir -> yenileme ucusta -> endMs gecti (expired) -> cevap gelir: eski teklif kalir, faz expired', async () => {
            let release
            const kapi = new Promise((r) => { release = r })
            const { s, sent } = await ready('fund', { reply: teklifCevabi(kapi) })
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('discrete')
            await adim(300)
            expect(s.phase).toBe('ready')
            expect(s.quote.ticket).toBe('0xt1')
            const eskiKey = s.quoteKey
            // endMs = teklif + 60 sn - 20 sn; yenileme endMs - 8 sn de baslar ve kapida bekler.
            await adim(33000)
            expect(teklifler(sent)).toHaveLength(2)
            expect(s.refreshing).toBe(true)
            await adim(10000)
            expect(s.phase).toBe('expired')
            release()
            await adim(1)
            expect(s.phase).toBe('expired')
            expect(s.quote.ticket).toBe('0xt1')
            expect(s.quoteKey).toBe(eskiKey)
        })

        it('yenileme zamaninda biterse yeni teklif kurulur (olumlu yol bozulmaz)', async () => {
            const { s } = await ready('fund', { reply: teklifCevabi(null) })
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('discrete')
            await adim(300)
            await adim(33000)
            expect(s.phase).toBe('ready')
            expect(s.quote.ticket).toBe('0xt2')
        })
    })

    describe('hata ve hiz siniri', () => {
        it('PRIVATE_MIN_AMOUNT + limitUsdc 15: faz error, hata metni 15 icerir, 10 sn sonra yeni istek YOK; retryQuote soguma sonrasi istek atar', async () => {
            const { s, sent } = await ready('fund', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: false, error: 'PRIVATE_MIN_AMOUNT', limitUsdc: '15' } : { success: true }) })
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('amount')
            await adim(800)
            expect(s.phase).toBe('error')
            expect(s.error).toContain('15')
            expect(s.error).toBe('Minimum amount is 15 USDC.')
            await adim(10000)
            expect(teklifler(sent)).toHaveLength(1)
            // Basarisizlik aninin hemen ardindan yeniden dene: 2 sn sogumadan once istek gitmez.
            s.retryQuote()
            expect(s.error).toBe('')
            expect(s.phase).toBe('waiting')
            await adim(0)
            expect(teklifler(sent)).toHaveLength(2)
        })

        it('retryQuote soguma suresine uyar: hatadan hemen sonra cagrilirsa en erken 2 sn sonra istek gider', async () => {
            const { s, sent } = await ready('fund', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: false, error: 'PRIVATE_FAILED' } : { success: true }) })
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('discrete')
            await adim(300)
            expect(s.phase).toBe('error')
            expect(teklifler(sent)).toHaveLength(1)
            s.retryQuote()
            await adim(QUOTE_COOLDOWN_MS - 1)
            expect(teklifler(sent)).toHaveLength(1)
            await adim(1)
            expect(teklifler(sent)).toHaveLength(2)
        })

        it('PRIVATE_RATE_LIMITED: faz rateWait, 5 sn icinde ikinci istek YOK, 5 sn sonra ikinci istek', async () => {
            const { s, sent } = await ready('fund', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: false, error: 'PRIVATE_RATE_LIMITED' } : { success: true }) })
            vi.useFakeTimers()
            s.amount = '25'
            s.onQuoteInput('discrete')
            await adim(300)
            expect(s.phase).toBe('rateWait')
            expect(teklifler(sent)).toHaveLength(1)
            await adim(4999)
            expect(teklifler(sent)).toHaveLength(1)
            await adim(1)
            expect(teklifler(sent)).toHaveLength(2)
        })

        it('alici uyusmazligi ve quoteDeliveryOk hatasi: PRIVATE_QUOTE_MISMATCH metni, teklif yok, faz error', async () => {
            const MISMATCH = "The quote didn't match your request and was discarded."
            const a = await ready('send', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: true, quote: { ...SUMMARY, recipient: '0x' + '5'.repeat(40) } } : { success: true }) })
            a.s.recipient = STRANGER
            a.s.amount = '12'
            await quoteAl(a.s)
            expect(a.s.quote).toBeNull()
            expect(a.s.error).toBe(MISMATCH)
            expect(a.s.phase).toBe('error')
            const b = await ready('fund', { reply: async (m) => (m.type === 'PRIVATE_QUOTE' ? { success: true, quote: { ...SUMMARY, recipient: m.message.outputAddress, dest: { ...SUMMARY.dest, asset: 'DAI' } } } : { success: true }) })
            b.s.amount = '25'
            await quoteAl(b.s)
            expect(b.s.quote).toBeNull()
            expect(b.s.error).toBe(MISMATCH)
            expect(b.s.phase).toBe('error')
        })
    })

    describe('sablon', () => {
        it('"Teklif al" metni ve getQuote dugmesi YOK; confirm-button var ve teklif gelene dek disabled; etiket "Confirm and send"', async () => {
            for (const mode of ['fund', 'send']) {
                const { html } = await goster(mode)
                expect(html, mode).not.toContain('Get quote')
                expect(html, mode).not.toContain('Getting quote')
                expect(var_(html, 'confirm-button'), mode).toBe(true)
                expect(etiket(html, 'confirm-button'), mode).toMatch(/\sdisabled(=|\s|>)/)
                // Para yukle'de etiket "Add funds" (fundConfirm), Gonder'de "Confirm and send".
                expect(govde(html, 'confirm-button'), mode).toBe(mode === 'fund' ? 'Add funds' : 'Confirm and send')
            }
        })

        it('confirm-button yalniz teklif + faz ready + odeme bilinir iken acilir', async () => {
            const hazir = (s) => { s.quote = SUMMARY; s.quoteSourceChainId = 56; s.quoteSourceAsset = 'USDC'; atsHazirla(s) }
            const acik = await goster('fund', (s) => { hazir(s); faz('ready')(s) })
            expect(etiket(acik.html, 'confirm-button')).not.toMatch(/\sdisabled(=|\s|>)/)
            for (const f of ['waiting', 'quoting', 'expired', 'error', 'idle']) {
                const k = await goster('fund', (s) => { hazir(s); faz(f)(s) })
                expect(etiket(k.html, 'confirm-button'), f).toMatch(/\sdisabled(=|\s|>)/)
            }
        })

        it('hata satiri: phase error -> quote-error + quote-retry; locked -> quote-error var, quote-retry yok; rateWait -> quote-rate-wait', async () => {
            const hatali = (f) => (s) => { s.error = 'Boom text'; faz(f)(s) }
            const e = await goster('fund', hatali('error'))
            expect(var_(e.html, 'quote-error')).toBe(true)
            expect(govde(e.html, 'quote-error')).toBe('Boom text')
            expect(var_(e.html, 'quote-retry')).toBe(true)
            expect(govde(e.html, 'quote-retry')).toBe('Retry')
            expect(var_(e.html, 'quote-rate-wait')).toBe(false)

            // Faz error ama hata metni yok (ardisik stale tukendi): genel metin + Tekrar dene yine gorunur.
            const bos = await goster('fund', faz('error'))
            expect(govde(bos.html, 'quote-error')).toBe('Something went wrong. Try again.')
            expect(var_(bos.html, 'quote-retry')).toBe(true)

            const l = await goster('fund', hatali('locked'))
            expect(var_(l.html, 'quote-error')).toBe(true)
            expect(var_(l.html, 'quote-retry')).toBe(false)

            const r = await goster('fund', (s) => { s.error = 'Too many quotes requested. Wait a moment and try again.'; faz('rateWait', { errorCode: 'PRIVATE_RATE_LIMITED' })(s) })
            expect(var_(r.html, 'quote-rate-wait')).toBe(true)
            expect(govde(r.html, 'quote-rate-wait')).toBe('Too many quotes requested; retrying shortly.')
            expect(var_(r.html, 'quote-retry')).toBe(false)
            expect(var_(r.html, 'quote-error')).toBe(false)

            const hic = await goster('fund')
            for (const id of ['quote-error', 'quote-retry', 'quote-rate-wait']) expect(var_(hic.html, id), id).toBe(false)
        })

        it('X21 providerInfo.available=false: hata satirinda PRIVATE_PROVIDER_DOWN metni (ekran sessizce kapanmaz)', async () => {
            // Acilista yuklenen yanit yakalama aninda yazilan degeri ezer: ayni degeri yanit olarak da ver (yaris yok).
            const r = await goster('fund', (s) => { s.providerInfo = { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: false } }, { providerInfo: INFO({ available: false }) })
            expect(var_(r.html, 'quote-error')).toBe(true)
            expect(govde(r.html, 'quote-error')).toBe("SilentSwap can't be reached right now. Try again later.".replace("'", '&#39;'))
            const acik = await goster('fund', (s) => { s.providerInfo = { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true } }, { providerInfo: INFO() })
            expect(var_(acik.html, 'quote-error')).toBe(false)
        })

        it('kaynak: getQuote, cooling, startCooldown yok; scheduler dispose edilir; eski legacy hata satiri yok', () => {
            const kod = kaynak()
            expect(kod).not.toMatch(/\bgetQuote\b|\bcooling\b|startCooldown|showGetQuote/)
            expect(kod).toContain('createQuoteScheduler')
            expect(kod).toContain('scheduler.dispose()')
            expect(kod).not.toMatch(/<p v-if="error"/)
            expect(kod).toContain("isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden'")
        })
    })
})

// Teklif yasam dongusu (Task 16): onay (stop/lock/fail), on yenileme, sure doldu, kilit. Zamanlayici cekirdegi quoteScheduler.test.js'te;
// burada ekranin ona baglanisi sinanir (SSR'da izleyici calismaz: girdiler onQuoteInput ile bildirilir, sahte saat ilerletilir).
describe('PrivateTransfer -- teklif yasam dongusu (Task 16)', () => {
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

    const kaynak = () => yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
    const teklifler = (sent) => sent.filter((m) => m.type === 'PRIVATE_QUOTE')
    const siparisler = (sent) => sent.filter((m) => m.type === 'PRIVATE_ORDER')
    const adim = (ms) => vi.advanceTimersByTimeAsync(ms)
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const govde = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.indexOf('>', i) + 1, html.indexOf('</', i))
    }
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { ...m, html, s: m.captured.instance.setupState }
    }
    const faz = (phase, ek = {}) => (s) => { s.schedState = { phase, seq: 1, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false, ...ek } }

    // Teklif cevabi: k. teklif ticket '0xt<k>', omru `life` ms (etkin bitis = omur - 20 sn). gates[k] o teklifin cevabini bekletir, fail[k] hata verir,
    // order siparis cevabini belirler (null donerse ekran "cevap yok" yolunu izler).
    const cevap = ({ life = 60000, gates = {}, fail = {}, order } = {}) => {
        let n = 0
        return async (m) => {
            if (m.type === 'PRIVATE_ORDER') return order ? order(m) : { success: true, ticket: '0xt', hash: '0xh' }
            if (m.type !== 'PRIVATE_QUOTE') return { success: true }
            const k = ++n
            if (gates[k]) await gates[k]
            if (fail[k]) return { success: false, error: 'PRIVATE_FAILED' }
            const t = m.message.outputToken
            return { success: true, quote: { ...SUMMARY, ticket: '0xt' + k, expiresAtMs: Date.now() + life, recipient: m.message.outputAddress, recipientChainId: t.chainId, dest: { ...SUMMARY.dest, chainId: t.chainId, asset: t.symbol, decimals: t.decimals } } }
        }
    }
    // Fund, 25 USDC: ilk teklif sahte saatin 300. ms'sinde gelir (etkin bitis = +life - 20 sn, on yenileme bitisten 8 sn once).
    async function hazir(opts = {}) {
        const m = await ready('fund', { reply: cevap(opts), ats: opts.ats })
        vi.useFakeTimers()
        m.s.amount = '25'
        m.s.onQuoteInput('discrete')
        await adim(300)
        return m
    }
    const kapi = () => { let release; const promise = new Promise((r) => { release = r }); return { promise, release } }

    describe('kilit (sT12)', () => {
        const BELIRSIZ = [
            ['PRIVATE_DEPOSIT_UNCONFIRMED', () => ({ success: false, error: 'PRIVATE_DEPOSIT_UNCONFIRMED' })],
            ['PRIVATE_DEPOSIT_UNTRACKED', () => ({ success: false, error: 'PRIVATE_DEPOSIT_UNTRACKED' })],
            ['cevap yok (null)', () => null],
        ]
        for (const [ad, order] of BELIRSIZ) {
            it(`${ad}: kilit, 60 sn icinde yeni teklif YOK; yalniz girdi degisimi (tutar) kilidi acar`, async () => {
                const { s, sent } = await hazir({ order })
                expect(s.phase).toBe('ready')
                await s.confirm()
                expect(s.scheduler.snapshot().phase).toBe('locked')
                expect(s.phase).toBe('locked')
                expect(s.quote).toBeNull()
                const n = teklifler(sent).length
                await adim(60000)
                expect(teklifler(sent)).toHaveLength(n)
                expect(s.phase).toBe('locked')
                s.amount = '26'
                s.onQuoteInput('amount')
                await adim(799)
                expect(teklifler(sent)).toHaveLength(n)
                await adim(1)
                expect(teklifler(sent)).toHaveLength(n + 1)
                expect(s.phase).toBe('ready')
            })
        }

        it('PRIVATE_DEPOSIT_UNTRACKED: metin hata alaninda YERINDE, Gizli islemlere gidilmez (sayfa ve not degismez)', async () => {
            const { s } = await hazir({ order: () => ({ success: false, error: 'PRIVATE_DEPOSIT_UNTRACKED' }) })
            await s.confirm()
            expect(s.error).toBe("The transfer may have been sent but can't be tracked. Don't retry; check the source account's activity.")
            expect(pageStore().currentPage).toBe('private_fund')
            expect(pageStore().ordersNotice).toBeNull()
            expect(pageStore().homeTab).not.toBe('private')
            // locked fazda hata satiri gorunur, "Tekrar dene" yok
            const g = await goster('fund', (x) => { x.error = 'Boom'; faz('locked')(x) })
            expect(var_(g.html, 'quote-error')).toBe(true)
            expect(var_(g.html, 'quote-retry')).toBe(false)
        })

        // S1 (X4): goToOrders ekran baska sayfadayken no-op; kilitli ekran metinsiz kalmasin, tek hata satirinda belirsizlik metni gorunsun.
        for (const [ad, order, metin] of [
            ['PRIVATE_DEPOSIT_UNCONFIRMED', () => ({ success: false, error: 'PRIVATE_DEPOSIT_UNCONFIRMED' }), 'The transfer may have been sent. Check Private transactions before trying again.'],
            ['PRIVATE_ORDER_IN_PROGRESS', () => ({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' }), 'This transfer was already sent.'],
            ['cevap yok (null)', () => null, "We couldn't confirm the transfer. Check this list before trying again."],
        ]) {
            it(`${ad}: goToOrders no-op iken kilitli ekranda hata satiri metni yazili`, async () => {
                const { s } = await hazir({ order })
                pageStore().currentPage = 'settings'
                await s.confirm()
                expect(pageStore().currentPage).toBe('settings')
                expect(s.phase).toBe('locked')
                expect(s.error).toBe(metin)
            })
        }

        it('PRIVATE_DEPOSIT_UNCONFIRMED hala Gizli islemlere yonlendirir', async () => {
            const { s } = await hazir({ order: () => ({ success: false, error: 'PRIVATE_DEPOSIT_UNCONFIRMED' }) })
            await s.confirm()
            expect(pageStore().currentPage).toBe('home')
            expect(pageStore().homeTab).toBe('private')
            expect(pageStore().ordersNotice).toBe('privacy.errors.PRIVATE_DEPOSIT_UNCONFIRMED')
        })

        it('kaynak: UNTRACKED GO_TO_ORDERS_CODES icinde DEGIL; UNCONFIRMED ve IN_PROGRESS icinde', () => {
            const kod = kaynak()
            const kume = kod.slice(kod.indexOf('const GO_TO_ORDERS_CODES'), kod.indexOf('\n', kod.indexOf('const GO_TO_ORDERS_CODES')))
            expect(kume).toContain('PRIVATE_ORDER_IN_PROGRESS')
            expect(kume).toContain('PRIVATE_DEPOSIT_UNCONFIRMED')
            expect(kume).not.toContain('PRIVATE_DEPOSIT_UNTRACKED')
        })
    })

    describe('basarisiz onay', () => {
        it('PRIVATE_INSUFFICIENT_BALANCE: teklif null, hata metni, faz error, 30 sn otomatik istek YOK; retryQuote ile yeni teklif', async () => {
            const { s, sent } = await hazir({ order: () => ({ success: false, error: 'PRIVATE_INSUFFICIENT_BALANCE' }) })
            await s.confirm()
            expect(s.quote).toBeNull()
            expect(s.error).toBe('Not enough balance for this amount.')
            expect(s.phase).toBe('error')
            await adim(30000)
            expect(teklifler(sent)).toHaveLength(1)
            s.retryQuote()
            await adim(0)
            expect(teklifler(sent)).toHaveLength(2)
            expect(s.phase).toBe('ready')
            expect(s.quote.ticket).toBe('0xt2')
            expect(s.error).toBe('')
            // "Tekrar dene" (quote-retry) faz error iken cizilir (yeni render yeni chrome taklidi kurar: en sonda)
            const g = await goster('fund', (x) => { x.error = 'Not enough balance for this amount.'; faz('error')(x) })
            expect(var_(g.html, 'quote-retry')).toBe(true)
        })

        it('basarili onay: zamanlayici durur (stopped), Gizli islemlere gidilir, yeni teklif istenmez', async () => {
            const { s, sent } = await hazir()
            await s.confirm()
            expect(siparisler(sent)).toHaveLength(1)
            expect(pageStore().currentPage).toBe('home')
            expect(s.phase).toBe('stopped')
            await adim(60000)
            expect(teklifler(sent)).toHaveLength(1)
        })
    })

    describe('on yenileme (sT11)', () => {
        it('etkin bitis t0+40 sn: t0+32 sn de AYNI girdilerle ikinci teklif; yeni ticket, ayni quoteKey, dugme acik kalir', async () => {
            const g = kapi()
            const { s, sent } = await hazir({ gates: { 2: g.promise } })
            const key = s.quoteKey
            expect(s.schedState.endMs - Date.now()).toBe(40000)
            await adim(31999)
            expect(teklifler(sent)).toHaveLength(1)
            await adim(1)
            expect(teklifler(sent)).toHaveLength(2)
            expect(teklifler(sent)[1].message).toEqual(teklifler(sent)[0].message)
            // yenileme ucustayken eski teklif yerinde, faz ready (dugme acik)
            expect(s.refreshing).toBe(true)
            expect(s.phase).toBe('ready')
            expect(s.quote.ticket).toBe('0xt1')
            g.release()
            await adim(0)
            expect(s.quote.ticket).toBe('0xt2')
            expect(s.quoteKey).toBe(key)
            expect(s.phase).toBe('ready')
            expect(s.refreshing).toBe(false)
            expect(s.error).toBe('')
        })

        it('yenileme basarisizsa eski teklif etkin bitise dek yerinde; bitiste faz expired, ikinci PRIVATE_PROVIDER_INFO, hata satiri YOK', async () => {
            const { s, sent, infoSent } = await hazir({ fail: { 2: true } })
            expect(infoSent).toHaveLength(1)
            await adim(32000)
            expect(teklifler(sent)).toHaveLength(2)
            expect(s.phase).toBe('ready')
            expect(s.quote.ticket).toBe('0xt1')
            expect(s.error).toBe('')
            const kalan = s.schedState.endMs - Date.now()
            await adim(kalan - 1)
            expect(s.phase).toBe('ready')
            expect(infoSent).toHaveLength(1)
            await adim(1)
            expect(s.phase).toBe('expired')
            expect(s.quote.ticket).toBe('0xt1')
            expect(infoSent).toHaveLength(2)
            // sonraki yayinlarda yeniden istenmez; yeni girdiye dek istek de yok
            await adim(60000)
            expect(infoSent).toHaveLength(2)
            expect(teklifler(sent)).toHaveLength(2)
        })

        it('onay sirasinda yenileme (Review Focus 1): siparis ESKI ticket ile gider, gecikmis yenileme cevabi quote u DEGISTIRMEZ', async () => {
            const refresh = kapi()
            const siparis = kapi()
            const { s, sent } = await hazir({ gates: { 2: refresh.promise }, order: async () => { await siparis.promise; return { success: true, ticket: '0xt', hash: '0xh' } } })
            await adim(32000)
            expect(teklifler(sent)).toHaveLength(2)
            expect(s.refreshing).toBe(true)
            const p = s.confirm()
            await adim(0)
            expect(siparisler(sent)).toHaveLength(1)
            expect(siparisler(sent)[0].message.ticket).toBe('0xt1')
            expect(s.phase).toBe('stopped')
            refresh.release()
            await adim(0)
            expect(s.quote.ticket).toBe('0xt1')
            expect(s.phase).toBe('stopped')
            siparis.release()
            await p
            expect(pageStore().currentPage).toBe('home')
        })

        it('en cok 5 otomatik yenileme; touch (pointerdown) sayaci sifirlar ve yenileme yeniden planlanir', async () => {
            const { s, sent } = await hazir()
            for (let i = 0; i < 5; i++) await adim(32000)
            expect(teklifler(sent)).toHaveLength(6)
            expect(s.schedState.autoRefreshes).toBe(5)
            await adim(20000)
            expect(teklifler(sent)).toHaveLength(6)
            expect(s.phase).toBe('ready')
            // touch sayaci sifirlar ve yenilemeyi hemen yeniden planlar: sayac yeniden 1'den baslar (5 degil)
            s.scheduler.touch()
            expect(s.schedState.autoRefreshes).toBe(1)
            const bekle = s.schedState.endMs - 8000 - Date.now()
            await adim(bekle - 1)
            expect(teklifler(sent)).toHaveLength(6)
            await adim(1)
            expect(teklifler(sent)).toHaveLength(7)
        })
    })

    // PD7 (Task 18): on yenilemede yeni ticket'in ATS ucreti BOSTAKI yuvada hazirlanir; ekran yeni ucret gelene dek eski teklifi ve eski ucreti
    // gosterir (dugme acik), ucret hazir olunca teklif + ucret TEK adimda degisir; ucret basarisizsa eski teklif ve eski ucret yerinde kalir.
    describe('on yenileme ve ATS ucreti (PD7)', () => {
        const ucretCevabi = (kapilar = {}, hatalar = {}) => async (m) => {
            const t = m.message.ticket
            if (kapilar[t]) await kapilar[t]
            if (hatalar[t]) return { success: false, error: 'bundler down' }
            return { success: true, transferFee: t === '0xt1' ? 19.7 : 20.5, symbol: 'ATS', atsBalance: 100, opCount: 1, ready: true, nextSteps: [], commissionAts: '0', commissionAtsHuman: 0, commissionRegion: 'local' }
        }

        it('yeni ticket in ucreti yenileme yanitindan SONRA ve takas ONCESI gider; o sirada quote/atsTicket eski, dugme acik; ucret hazir olunca ikisi AYNI anda yeni', async () => {
            const g = kapi()
            const { s, timeline, atsSent } = await hazir({ ats: ucretCevabi({ '0xt2': g.promise }) })
            expect(timeline).toEqual(['PRIVATE_QUOTE', 'ATS:0xt1'])
            expect(s.atsTicket).toBe('0xt1')
            expect(s.atsFee).toBe(19.7)
            expect(s.activeSlot).toBe(0)
            await adim(32000)
            // Yenileme yaniti geldi, yeni ticket in ucreti istendi ama ucret cevabi bekleniyor.
            expect(timeline).toEqual(['PRIVATE_QUOTE', 'ATS:0xt1', 'PRIVATE_QUOTE', 'ATS:0xt2'])
            expect(atsSent[1].message).toEqual({ ticket: '0xt2' })
            expect(s.quote.ticket).toBe('0xt1')
            expect(s.atsTicket).toBe('0xt1')
            expect(s.atsFee).toBe(19.7)
            expect(s.atsBlocked).toBe(false)
            expect(s.refreshing).toBe(true)
            // Eski ticket ile onay bu sirada gecerlidir (dugme acik).
            g.release()
            await adim(0)
            expect(s.quote.ticket).toBe('0xt2')
            expect(s.atsTicket).toBe('0xt2')
            expect(s.atsFee).toBe(20.5)
            expect(s.activeSlot).toBe(1)
            expect(s.feeSlots[0].atsFee.value).toBeNull()
            expect(s.atsBlocked).toBe(false)
            expect(s.refreshing).toBe(false)
            expect(s.phase).toBe('ready')
        })

        it('ucret beklenirken onay (M1): eski ticket ve eski ucretle gider; gec gelen yeni ucret takas yapmaz', async () => {
            const g = kapi()
            const { s, sent } = await hazir({ ats: ucretCevabi({ '0xt2': g.promise }) })
            await adim(32000)
            expect(s.refreshing).toBe(true)
            expect(s.atsBlocked).toBe(false)
            await s.confirm()
            expect(siparisler(sent)).toEqual([{ type: 'PRIVATE_ORDER', message: { ticket: '0xt1', gas: 'ats', atsQuoted: { transferFee: 19.7, commissionFee: 0 } } }])
            g.release()
            await adim(0)
            expect(siparisler(sent)).toHaveLength(1)
            expect(s.quote?.ticket ?? '0xt1').toBe('0xt1')
        })

        it('bostaki yuvanin ucreti basarisizsa eski teklif ve eski ucret yerinde; PRIVATE_ORDER eski ticket ve eski ucretle gider', async () => {
            const { s, sent } = await hazir({ ats: ucretCevabi({}, { '0xt2': true }) })
            await adim(32000)
            expect(teklifler(sent)).toHaveLength(2)
            expect(s.quote.ticket).toBe('0xt1')
            expect(s.atsTicket).toBe('0xt1')
            expect(s.atsFee).toBe(19.7)
            expect(s.activeSlot).toBe(0)
            expect(s.atsBlocked).toBe(false)
            expect(s.error).toBe('')
            expect(s.feeSlots[1].atsFee.value).toBeNull()
            await s.confirm()
            expect(siparisler(sent)).toEqual([{ type: 'PRIVATE_ORDER', message: { ticket: '0xt1', gas: 'ats', atsQuoted: { transferFee: 19.7, commissionFee: 0 } } }])
        })

        it('bostaki yuvanin ucreti hazir degil (ready:false) ise de takas yapilmaz', async () => {
            const ats = async (m) => ({ success: true, transferFee: 20.5, symbol: 'ATS', atsBalance: 100, opCount: 1, ready: m.message.ticket === '0xt1', nextSteps: [], commissionAts: '0', commissionAtsHuman: 0 })
            const { s } = await hazir({ ats })
            await adim(32000)
            expect(s.quote.ticket).toBe('0xt1')
            expect(s.atsTicket).toBe('0xt1')
            expect(s.activeSlot).toBe(0)
        })

        it('ucret beklenirken girdi degisirse (Review Focus 1) yeni teklif/ucret KURULMAZ: quote, atsTicket ve yuvalar sifir', async () => {
            const g = kapi()
            const { s } = await hazir({ ats: ucretCevabi({ '0xt2': g.promise }) })
            await adim(32000)
            expect(s.refreshing).toBe(true)
            s.amount = '30'
            s.onQuoteInput('amount')
            g.release()
            await adim(0)
            expect(s.quote).toBeNull()
            expect(s.atsTicket).toBeNull()
            expect(s.feeSlots.map((f) => f.atsFee.value)).toEqual([null, null])
        })

        it('ucret beklenirken sure dolarsa (refreshing kapandi) gec gelen ucret yeni teklif kurmaz', async () => {
            const g = kapi()
            const { s } = await hazir({ ats: ucretCevabi({ '0xt2': g.promise }) })
            await adim(32000)
            expect(s.refreshing).toBe(true)
            await adim(s.schedState.endMs - Date.now())
            expect(s.phase).toBe('expired')
            g.release()
            await adim(0)
            expect(s.quote.ticket).toBe('0xt1')
            expect(s.atsTicket).toBe('0xt1')
        })
    })

    describe('saat kaymasi ve gizli sayfa (Review Focus 2)', () => {
        for (const [ad, life] of [['gecmis bitis', -5000], ['gecersiz bitis (NaN)', NaN], ['bitis payin icinde', 10000]]) {
            it(`${ad}: faz expired, toplam PRIVATE_QUOTE 1 (dongu yok)`, async () => {
                const { s, sent } = await hazir({ life })
                expect(s.phase).toBe('expired')
                expect(s.quote).not.toBeNull()
                await adim(120000)
                expect(teklifler(sent)).toHaveLength(1)
                expect(s.phase).toBe('expired')
            })
        }

        function sahteBelge(baslangic) {
            const durum = { vis: baslangic, dinleyiciler: [] }
            vi.stubGlobal('document', {
                get visibilityState() { return durum.vis },
                addEventListener: vi.fn((tur, fn) => { durum.dinleyiciler.push([tur, fn]) }),
                removeEventListener: vi.fn(),
            })
            return durum
        }

        it('sayfa gizliyken on yenileme istenmez; bitiste expired', async () => {
            const belge = sahteBelge('hidden')
            const { s, sent } = await hazir()
            expect(belge.dinleyiciler.some(([tur]) => tur === 'visibilitychange')).toBe(true)
            await adim(39000)
            expect(teklifler(sent)).toHaveLength(1)
            expect(s.phase).toBe('ready')
            await adim(2000)
            expect(teklifler(sent)).toHaveLength(1)
            expect(s.phase).toBe('expired')
        })

        it('onVisibility: gizlenince plan duser, gorunur olunca (bitis oncesi) on yenileme yeniden planlanir', async () => {
            const belge = sahteBelge('visible')
            const { s, sent } = await hazir()
            belge.vis = 'hidden'
            s.onVisibility()
            await adim(33000)
            expect(teklifler(sent)).toHaveLength(1)
            belge.vis = 'visible'
            s.onVisibility()
            await adim(0)
            expect(teklifler(sent)).toHaveLength(2)
            expect(s.phase).toBe('ready')
        })
    })

    describe('onay on denetimleri (X17)', () => {
        it('suresi dolmus teklif gonderilmez; retryQuote cagrilir ve yeni teklif istenir', async () => {
            const { s, sent } = await hazir()
            s.quote.expiresAtMs = Date.now() + 1000
            await s.confirm()
            expect(siparisler(sent)).toHaveLength(0)
            expect(s.phase).toBe('waiting')
            await adim(QUOTE_COOLDOWN_MS)
            expect(teklifler(sent)).toHaveLength(2)
            expect(s.quote.ticket).toBe('0xt2')
        })

        it('ATS ucreti hazir degilken confirm erken doner: zamanlayici DURMAZ (stop gonderimden hemen once)', async () => {
            const { s, sent } = await hazir()
            s.feeSlots[0].ready.value = false
            expect(s.atsBlocked).toBe(true)
            await s.confirm()
            expect(siparisler(sent)).toHaveLength(0)
            expect(s.phase).toBe('ready')
            expect(s.busy).toBe(false)
        })

        it('kaynak: scheduler.stop() PRIVATE_ORDER gonderiminden ONCE ve atsBlocked / payExceedsBalance denetiminden SONRA', () => {
            const kod = kaynak()
            const govde = kod.slice(kod.indexOf('async function confirm()'))
            const iAts = govde.indexOf('if (payExceedsBalance.value || atsBlocked.value) return')
            const iStop = govde.indexOf('scheduler.stop()')
            const iSend = govde.indexOf("send('PRIVATE_ORDER'")
            expect(iAts).toBeGreaterThan(-1)
            expect(iStop).toBeGreaterThan(iAts)
            expect(iSend).toBeGreaterThan(iStop)
            expect(govde.match(/scheduler\.stop\(\)/g)).toHaveLength(1)
        })
    })

    describe('sablon', () => {
        const hazirTeklif = (s) => { s.quote = SUMMARY; s.quoteSourceChainId = 56; s.quoteSourceAsset = 'USDC'; atsHazirla(s) }

        it('phase expired: sayilar yerinde, dugme kapali, quote-expired + quote-refresh', async () => {
            const g = await goster('fund', (s) => { hazirTeklif(s); faz('expired')(s) })
            expect(var_(g.html, 'quote-expired')).toBe(true)
            expect(govde(g.html, 'quote-expired')).toBe('The quote has expired.')
            expect(var_(g.html, 'quote-refresh')).toBe(true)
            expect(govde(g.html, 'quote-refresh')).toBe('Refresh quote')
            expect(govde(g.html, 'estimate')).toContain('24.65')
            expect(etiket(g.html, 'confirm-button')).toMatch(/\sdisabled(=|\s|>)/)
        })

        it('expired disinda quote-expired ve quote-refresh cizilmez; eski "Get a new one" metni yok', async () => {
            for (const f of ['idle', 'waiting', 'quoting', 'ready', 'error', 'locked', 'stopped']) {
                const g = await goster('fund', (s) => { hazirTeklif(s); faz(f)(s) })
                expect(var_(g.html, 'quote-expired'), f).toBe(false)
                expect(var_(g.html, 'quote-refresh'), f).toBe(false)
                expect(g.html, f).not.toContain('Get a new one')
            }
        })

        it('on yenileme sirasinda kucuk metin cikar ve dugme ACIK kalir', async () => {
            const g = await goster('fund', (s) => { hazirTeklif(s); faz('ready', { refreshing: true })(s) })
            expect(var_(g.html, 'quote-refreshing')).toBe(true)
            expect(govde(g.html, 'quote-refreshing')).toBe('Refreshing quote…')
            expect(etiket(g.html, 'confirm-button')).not.toMatch(/\sdisabled(=|\s|>)/)
            const d = await goster('fund', (s) => { hazirTeklif(s); faz('ready')(s) })
            expect(var_(d.html, 'quote-refreshing')).toBe(false)
        })

        it('kaynak: kok ogede pointerdown.passive -> scheduler.touch(); visibilitychange dinleyicisi guvenli eklenir/kaldirilir; watch(phase) YOK', () => {
            const kod = kaynak()
            expect(kod).toContain('@pointerdown.passive="scheduler.touch()"')
            expect(kod).toContain("if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)")
            expect(kod).toContain("if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)")
            expect(kod).toMatch(/function onVisibility\(\) \{\s*scheduler\.visibilityChanged\(\)/)
            expect(kod).not.toMatch(/watch\(\s*phase/)
            expect(kod).not.toMatch(/watch\(\(\) => phase/)
            expect(kod).toContain("snapshot.phase === 'expired' && prevPhase !== 'expired'")
        })
    })
})

// ----------------------------------------------------------------------------------------------------------------
// Sade ekran, Task 19: ATS yetersiz, kurulum ve hata durumlari (K8, sT10, sT14, spec 5.8 ve 7.3). Hicbir durum onay dugmesini yanlislikla acmaz;
// Para yukle'de Gizli Hesap'a ATS aldiran dugme/baglanti HICBIR kosulda cizilmez (PRIVATE_ATS_SALE acik olsa da).
// ----------------------------------------------------------------------------------------------------------------
describe('PrivateTransfer -- ATS yetersiz, kurulum ve hata durumlari (Task 19)', () => {
    const orders = (sent) => sent.filter((x) => x.type === 'PRIVATE_ORDER')
    const kaynak = () => yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const kapali = (html) => /\sdisabled(=|\s|>)/.test(etiket(html, 'confirm-button'))
    // fee-network satirinin govdesi (bir sonraki data-testid ya da ats-extra bolumune kadar).
    const ag = (html) => {
        const i = html.indexOf('data-testid="fee-network"')
        expect(i).toBeGreaterThan(-1)
        return html.slice(i, html.indexOf('data-testid="fee-detail-toggle"', i))
    }
    const DUGME = 'Buy ATS'
    const BLOCKED = 'ATS purchases are not available in private mode'
    const SETUP_FUND = 'Finish the ATS setup outside private mode, then come back.'
    const SETUP_SEND = 'Your Private Account needs a quick ATS setup. You can do it right here.'
    // Teklifi ve etkin ucret yuvasini render ONCESI kurar (SSR'da izleyici yok). over: fee, balance, ready, decision, error, prepaid.
    const kur = (over = {}) => (s) => {
        s.quote = SUMMARY
        s.quoteSourceChainId = 56
        s.quoteSourceAsset = 'USDC'
        const f = s.feeSlots[0]
        f.atsFee.value = 'fee' in over ? over.fee : 19.7
        f.ready.value = over.ready ?? true
        f.atsBalance.value = over.balance ?? 100
        if (over.decision !== undefined) f.decision.value = over.decision
        if (over.error !== undefined) f.error.value = over.error
        if (over.prepaid !== undefined) f.prepaid.value = over.prepaid
        s.atsTicket = SUMMARY.ticket
        s.schedState = { phase: 'ready', seq: 1, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false }
    }
    async function goster(mode, over, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(over)(inst.setupState))
        const html = await render(m.app)
        return { ...m, html, s: m.captured.instance.setupState }
    }
    async function teklifli(mode = 'fund', opts = {}) {
        const r = await ready(mode, opts)
        if (mode === 'send') r.s.recipient = STRANGER
        r.s.amount = mode === 'send' ? '12' : '25'
        await quoteAl(r.s)
        expect(r.s.quote).toBeTruthy()
        return r
    }

    describe('hazir: kutu ve not yok, dugme acik', () => {
        it('fund ve send: ats-short-box, ats-setup-note, ats-error-box yok; onay dugmesi acik', async () => {
            for (const mode of ['fund', 'send']) {
                const g = await goster(mode)
                expect(g.s.atsState, mode).toBe('ready')
                for (const id of ['ats-short-box', 'ats-setup-note', 'ats-decision-desc', 'ats-error-box', 'ats-retry', 'private-ats-link-warning']) expect(var_(g.html, id), `${mode} ${id}`).toBe(false)
                expect(g.html, mode).not.toContain(DUGME)
                expect(kapali(g.html), mode).toBe(false)
            }
        })
    })

    describe('Gonder: ATS yetersiz', () => {
        it('fee-network kirmizi "19.7 ATS required", kutuda "bakiyen 0 ATS", baglanti uyarisi var, onay kapali', async () => {
            const g = await goster('send', { balance: 0 })
            expect(g.s.atsState).toBe('short')
            expect(g.s.atsShort).toBe(true)
            expect(ag(g.html)).toContain('19.7 ATS required')
            expect(ag(g.html)).toMatch(/text-red-600[^>]*>19\.7 ATS required/)
            expect(var_(g.html, 'ats-short-box')).toBe(true)
            expect(g.html).toContain('Not enough ATS · your balance is 0 ATS')
            expect(var_(g.html, 'private-ats-link-warning')).toBe(true)
            expect(kapali(g.html)).toBe(true)
        })

        it('bakiye kismen var: kutuda gercek bakiye (fmt) yazar', async () => {
            const g = await goster('send', { balance: 5.5 })
            expect(g.html).toContain('Not enough ATS · your balance is 5.5 ATS')
        })

        it('AtsBuyButton cizilir: bayrak KAPALIyken privacy.atsSale.blocked metni (dugme yok), bayrak ACIKken "Buy ATS" dugmesi', async () => {
            satis.flag = false
            const kapaliBayrak = await goster('send', { balance: 0 })
            expect(kapaliBayrak.html).toContain(BLOCKED)
            expect(kapaliBayrak.html).not.toContain(DUGME)
            satis.flag = true
            const acikBayrak = await goster('send', { balance: 0 })
            expect(acikBayrak.html).toContain(DUGME)
            expect(acikBayrak.html).not.toContain(BLOCKED)
            expect(kapali(acikBayrak.html)).toBe(true)
        })

        it('satis yolu canli degilse (live false) AtsBuyButton hicbir sey cizmez; kutu ve baglanti uyarisi kalir', async () => {
            satis.live = false
            const g = await goster('send', { balance: 0 })
            expect(g.html).not.toContain(DUGME)
            expect(g.html).not.toContain(BLOCKED)
            expect(var_(g.html, 'ats-short-box')).toBe(true)
            expect(var_(g.html, 'private-ats-link-warning')).toBe(true)
        })

        it('sunucu karari "ATS al" (bakiye yeterli gorunse de): kutu ve baglanti uyarisi var', async () => {
            const g = await goster('send', { balance: 100, ready: false, decision: resolveAtsBlocker('balance-missing') })
            expect(g.s.atsState).toBe('short')
            expect(var_(g.html, 'ats-short-box')).toBe(true)
            expect(var_(g.html, 'private-ats-link-warning')).toBe(true)
            expect(kapali(g.html)).toBe(true)
        })

        it('buy-ats karari sayisiz (ucret bilinmiyor): fee-network kirmizi "—", kutu var, dugme kapali', async () => {
            const g = await goster('send', { fee: null, balance: 0, ready: false, decision: resolveAtsBlocker('src-balance-missing') })
            expect(g.s.atsState).toBe('short')
            expect(g.s.feeAts.required).toBeNull()
            expect(g.s.feeAts.message).toBeNull()
            expect(ag(g.html)).toMatch(/text-red-600[^>]*>—</)
            expect(var_(g.html, 'ats-short-box')).toBe(true)
            expect(kapali(g.html)).toBe(true)
        })
    })

    describe('Para yukle: ATS yetersiz (sT10, PD9, Review Focus 5)', () => {
        it('kutu var, privacy.atsSale.blocked var; baglanti uyarisi, AtsBuyButton ve "Buy ATS" YOK; onay kapali', async () => {
            const g = await goster('fund', { balance: 0 })
            expect(g.s.atsState).toBe('short')
            expect(var_(g.html, 'ats-short-box')).toBe(true)
            expect(g.html).toContain('Not enough ATS · your balance is 0 ATS')
            expect(g.html).toContain(BLOCKED)
            expect(var_(g.html, 'private-ats-link-warning')).toBe(false)
            expect(g.html).not.toContain(DUGME)
            expect(kapali(g.html)).toBe(true)
        })

        it('PRIVATE_ATS_SALE ACIKken de: dugme/baglanti yok, blocked satiri HER ZAMAN var (tek kez)', async () => {
            satis.flag = true
            satis.live = true
            const g = await goster('fund', { balance: 0 })
            expect(g.html).toContain(BLOCKED)
            expect(g.html.split(BLOCKED)).toHaveLength(2)
            expect(g.html).not.toContain(DUGME)
            expect(var_(g.html, 'private-ats-link-warning')).toBe(false)
            expect(g.html).not.toContain('<button type="button" class="px-3 py-1.5')
        })

        it('buy-ats karari (sunucu): fund yine ayni: yalniz blocked satiri', async () => {
            satis.flag = true
            const g = await goster('fund', { balance: 100, ready: false, decision: resolveAtsBlocker('balance-missing') })
            expect(var_(g.html, 'ats-short-box')).toBe(true)
            expect(g.html).toContain(BLOCKED)
            expect(g.html).not.toContain(DUGME)
            expect(var_(g.html, 'private-ats-link-warning')).toBe(false)
        })
    })

    describe('kurulum gerekli (run-onboarding)', () => {
        it('karar metni satirda; send: atsSetupSend + kurulum dugmesi, fund: atsSetupFund ve dugme YOK; ATS al dugmesi yok; onay kapali', async () => {
            const decision = resolveAtsBlocker('src-allowance-missing')
            const send = await goster('send', { ready: false, decision })
            expect(send.s.atsState).toBe('blocked')
            expect(ag(send.html)).toContain('One-time setup required')
            expect(etiket(send.html, 'ats-setup-note')).toBeTruthy()
            expect(send.html).toContain(SETUP_SEND)
            expect(send.html).not.toContain(SETUP_FUND)
            expect(var_(send.html, 'ats-setup-run')).toBe(true)
            expect(send.html).toContain('Start setup')
            const fund = await goster('fund', { ready: false, decision })
            expect(ag(fund.html)).toContain('One-time setup required')
            expect(fund.html).toContain(SETUP_FUND)
            expect(fund.html).not.toContain(SETUP_SEND)
            expect(var_(fund.html, 'ats-setup-run')).toBe(false)
            expect(fund.html).not.toContain('Start setup')
            for (const g of [send, fund]) {
                expect(g.html).not.toContain(DUGME)
                expect(var_(g.html, 'ats-short-box')).toBe(false)
                expect(var_(g.html, 'ats-retry')).toBe(false)
                expect(var_(g.html, 'private-ats-link-warning')).toBe(false)
                expect(kapali(g.html)).toBe(true)
            }
        })

        it('src-allowance-low da (butce dusuk) kurulum notu gosterir', async () => {
            const g = await goster('fund', { ready: false, decision: resolveAtsBlocker('src-allowance-low') })
            expect(var_(g.html, 'ats-setup-note')).toBe(true)
            expect(kapali(g.html)).toBe(true)
        })
    })

    // ATS kurulumu ekranin kendisinde (Task 4). Kimin odedigi ve kurulumun nerede yapilabilecegi (kanit):
    //  - Gonder, Takas, Kopru: odeyen Gizli Hesap (aktif hesap). Kapi ATS_RUN_ONBOARDING'i gizli modda Gizli Hesap imzaciyla gecirir (asagidaki kapi testi);
    //    Takas'in ATS karti gizli modda cizilmez (Swap.vue: saleOnlyMode = privacy.active), yani eski "Takas ekranindaki ATS karti" yonlendirmesi bir cikmazdi.
    //    Kurulum bu ekranda: ayni useAtsOpFee.runOnboarding -> ATS_RUN_ONBOARDING, sonra ucret yeniden yuklenir.
    //  - Para yukle: odeyen NORMAL hesap; kapi gizli modda onu PRIVATE_SIGNER_MUST_BE_PRIVATE ile reddeder: dugme YOK, "gizli moddan cikip tamamla" notu.
    describe('kurulum dugmesi (Task 4)', () => {
        const KURULUM = resolveAtsBlocker('src-allowance-missing')
        const BUTCE = resolveAtsBlocker('src-allowance-low')
        const KURULUM_ATS = { ready: false, decision: KURULUM }
        const ODEYEN_GIZLI = ['send', 'swap', 'bridge']
        const onboardingMesajlari = (g) => g.sent.filter((m) => m.type === 'ATS_RUN_ONBOARDING')
        const dugmeMetni = (html) => {
            const i = html.indexOf('data-testid="ats-setup-run"')
            expect(i).toBeGreaterThan(-1)
            return html.slice(html.indexOf('>', i) + 1, html.indexOf('</button>', i)).trim()
        }
        const metinOf = (html, testid) => {
            const i = html.indexOf(`data-testid="${testid}"`)
            expect(i, testid).toBeGreaterThan(-1)
            const bas = html.indexOf('>', i) + 1
            return html.slice(bas, html.indexOf('</', bas)).replace(/<[^>]*>/g, '').trim()
        }
        // Render oncesi ek durum (setupBusy / setupFailed / ucret yuvasi yukleniyor) yazan goster.
        async function gosterEk(mode, over, opts, ek) {
            const m = mount(mode, opts)
            captureInstance(m.app, 'PrivateTransfer', (inst) => { kur(over)(inst.setupState); ek(inst.setupState) })
            const html = await render(m.app)
            return { ...m, html, s: m.captured.instance.setupState }
        }

        it('kapi kaniti: ATS_RUN_ONBOARDING gizli modda Gizli Hesap imzaciyla gecer (Gonder/Takas/Kopru), normal hesap imzaciyla PRIVATE_SIGNER_MUST_BE_PRIVATE (Para yukle)', () => {
            const baglam = { activeAccount: { key: 'g-1', address: GIZLI, private: true }, privateAddress: GIZLI, privateAccount: { key: 'g-1', address: GIZLI, private: true }, chainKind: 'evm' }
            expect(privacyDecision('ATS_RUN_ONBOARDING', { ...baglam, signer: { key: 'g-1', address: GIZLI, private: true } })).toBeNull()
            expect(privacyDecision('ATS_RUN_ONBOARDING', { ...baglam, signer: { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' } })).toEqual({ block: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
        })

        it('kaynak: Takas ekraninin ATS karti gizli modda cizilmez (saleOnlyMode = privacy.active); kurulum dugmesi yalniz Para yukle disindaki kiplerde', () => {
            const swap = yorumsuz(readFileSync(fileURLToPath(new URL('../Swap.vue', import.meta.url)), 'utf8'))
            expect(swap).toContain('const saleOnlyMode = computed(() => privacy.active)')
            expect(swap).toMatch(/v-if="payWithAts && !saleRoute && !saleOnlyMode"/)
            const kod = kaynak()
            expect(kod).toMatch(/async function runAtsSetup\(\) \{\s*if \(props\.mode === 'fund' \|\| setupBusy\.value \|\| !quote\.value\) return/)
            expect(kod).toContain('slot.value.runOnboarding({ chainId: Number(quoteSourceChainId.value ?? chainId.value), address: privacy.privateAddress })')
            expect(kod).toMatch(/<template v-if="mode !== 'fund'">\s*<button type="button" data-testid="ats-setup-run"/)
        })

        it('Gonder, Takas, Kopru: kurulum gerekli -> not + "Start setup" dugmesi (etkin), karar metni satirda, onay kapali; Para yukle: not var, dugme yok', async () => {
            for (const mode of ODEYEN_GIZLI) {
                const g = await goster(mode, KURULUM_ATS)
                expect(g.s.atsState, mode).toBe('blocked')
                expect(g.s.atsSetupNeeded, mode).toBe(true)
                expect(g.html, mode).toContain(SETUP_SEND)
                expect(g.html, mode).not.toContain(SETUP_FUND)
                expect(etiket(g.html, 'ats-setup-run'), mode).toMatch(/^<button type="button"/)
                expect(etiket(g.html, 'ats-setup-run'), mode).not.toMatch(/\sdisabled(=|\s|>)/)
                expect(dugmeMetni(g.html), mode).toBe('Start setup')
                expect(var_(g.html, 'ats-setup-error'), mode).toBe(false)
                expect(ag(g.html), mode).toContain('One-time setup required')
                expect(kapali(g.html), mode).toBe(true)
                // Not, dugmenin ustunde; ikisi de ucret satirinin altinda ve onay dugmesinin ustunde.
                const not = g.html.indexOf('data-testid="ats-setup-note"')
                expect(not, mode).toBeGreaterThan(g.html.indexOf('data-testid="fee-network"'))
                expect(not, mode).toBeLessThan(g.html.indexOf('data-testid="ats-setup-run"'))
                expect(g.html.indexOf('data-testid="ats-setup-run"'), mode).toBeLessThan(g.html.indexOf('data-testid="confirm-button"'))
            }
            const fund = await goster('fund', KURULUM_ATS)
            expect(fund.s.atsSetupNeeded).toBe(true)
            expect(fund.html).toContain(SETUP_FUND)
            expect(var_(fund.html, 'ats-setup-note')).toBe(true)
            expect(var_(fund.html, 'ats-setup-run')).toBe(false)
            expect(var_(fund.html, 'ats-setup-error')).toBe(false)
        })

        it('butce dusuk (src-allowance-low) ve yetersiz ATS ile birlikte kurulum (short) de ayni dugmeyi gosterir; Para yukle gostermez', async () => {
            for (const over of [{ ready: false, decision: BUTCE }, { ready: false, decision: KURULUM, balance: 0 }]) {
                for (const mode of ODEYEN_GIZLI) {
                    const g = await goster(mode, over)
                    expect(var_(g.html, 'ats-setup-run'), `${mode} ${over.decision.i18nKey}`).toBe(true)
                    expect(kapali(g.html), mode).toBe(true)
                }
                const fund = await goster('fund', over)
                expect(var_(fund.html, 'ats-setup-run')).toBe(false)
                expect(var_(fund.html, 'ats-setup-note')).toBe(true)
            }
            const kisa = await goster('send', { ready: false, decision: KURULUM, balance: 0 })
            expect(kisa.s.atsState).toBe('short')
            expect(var_(kisa.html, 'ats-short-box')).toBe(true)
        })

        it('kurulum gerekmeyen durumlarda not ve dugme yok (hazir, operator karari, ATS al, ucret hatasi): dort kipte', async () => {
            const durumlar = [
                {},
                { ready: false, decision: resolveAtsBlocker('paymaster-paused') },
                { ready: false, decision: resolveAtsBlocker('onboarding-steps-missing') },
                { ready: false, decision: resolveAtsBlocker('balance-missing') },
                { ready: false, decision: resolveAtsBlocker('foreign-delegation') },
                { ready: false, fee: null, error: 'teklif alinamadi' },
            ]
            for (const over of durumlar) {
                for (const mode of [...ODEYEN_GIZLI, 'fund']) {
                    const g = await goster(mode, over)
                    expect(var_(g.html, 'ats-setup-run'), `${mode} ${JSON.stringify(over.decision?.i18nKey ?? over)}`).toBe(false)
                    expect(var_(g.html, 'ats-setup-note'), mode).toBe(false)
                }
            }
        })

        it('calisiyor (setupBusy): ucret yuvasi loading, ama not kalir; dugme kapali ve "Setting up…"; hata satiri yok; Para yukle\'de dugme hic yok', async () => {
            const calisiyor = (s) => { s.feeSlots[0].loading.value = true; s.setupBusy = true }
            for (const mode of ODEYEN_GIZLI) {
                const b = await gosterEk(mode, KURULUM_ATS, undefined, calisiyor)
                expect(b.s.atsState, mode).toBe('loading')
                expect(b.s.atsSetupNeeded, mode).toBe(false)
                expect(b.html, mode).toContain(SETUP_SEND)
                expect(etiket(b.html, 'ats-setup-run'), mode).toMatch(/\sdisabled(=|\s|>)/)
                expect(dugmeMetni(b.html), mode).toBe('Setting up…')
                expect(var_(b.html, 'ats-setup-error'), mode).toBe(false)
                expect(kapali(b.html), mode).toBe(true)
            }
            const fund = await gosterEk('fund', KURULUM_ATS, undefined, calisiyor)
            expect(var_(fund.html, 'ats-setup-run')).toBe(false)
        })

        it('basarisiz (setupFailed): hata satiri (kirmizi) + "Retry", dugme etkin; not kalir; Para yukle\'de hicbiri yok', async () => {
            const basarisiz = (s) => { s.setupFailed = true }
            for (const mode of ODEYEN_GIZLI) {
                const g = await gosterEk(mode, KURULUM_ATS, undefined, basarisiz)
                expect(g.html, mode).toContain(SETUP_SEND)
                expect(metinOf(g.html, 'ats-setup-error'), mode).toBe('The setup did not finish.')
                expect(etiket(g.html, 'ats-setup-error'), mode).toContain('text-red-600 dark:text-red-400')
                expect(etiket(g.html, 'ats-setup-run'), mode).not.toMatch(/\sdisabled(=|\s|>)/)
                expect(dugmeMetni(g.html), mode).toBe('Retry')
            }
            const fund = await gosterEk('fund', KURULUM_ATS, undefined, basarisiz)
            expect(var_(fund.html, 'ats-setup-error')).toBe(false)
            expect(var_(fund.html, 'ats-setup-run')).toBe(false)
        })

        it('Turkce: not, dugme (Kurulumu başlat / Kurulum yapılıyor… / Tekrar dene) ve hata metni gercek Turkce; Ingilizce sizmaz', async () => {
            const tr = JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/tr.json', import.meta.url)), 'utf8'))
            expect(tr.privacy.transfer.atsSetupSend).toBe('Gizli Hesabın için kısa bir ATS kurulumu gerekiyor. Buradan yapabilirsin.')
            const bos = await goster('send', KURULUM_ATS, { locale: 'tr' })
            expect(bos.html).toContain(tr.privacy.transfer.atsSetupSend)
            expect(bos.html).not.toContain(SETUP_SEND)
            expect(dugmeMetni(bos.html)).toBe('Kurulumu başlat')
            const calisiyor = await gosterEk('swap', KURULUM_ATS, { locale: 'tr' }, (s) => { s.feeSlots[0].loading.value = true; s.setupBusy = true })
            expect(dugmeMetni(calisiyor.html)).toBe('Kurulum yapılıyor…')
            const basarisiz = await gosterEk('bridge', KURULUM_ATS, { locale: 'tr' }, (s) => { s.setupFailed = true })
            expect(metinOf(basarisiz.html, 'ats-setup-error')).toBe('Kurulum tamamlanamadı.')
            expect(dugmeMetni(basarisiz.html)).toBe('Tekrar dene')
            const fund = await goster('fund', KURULUM_ATS, { locale: 'tr' })
            expect(fund.html).toContain('ATS kurulumunu gizli moddan çıkıp tamamla, sonra buraya dön.')
            expect(var_(fund.html, 'ats-setup-run')).toBe(false)
            for (const g of [bos, calisiyor, basarisiz]) expect(g.html).not.toContain('Start setup')
        })

        it('dugmeye basinca (Gonder/Takas/Kopru): ayni ATS_RUN_ONBOARDING (yalniz { chainId, address }), sonra ucret { ticket } ile yeniden yuklenir; basarida ucret hazir olur, hata yok', async () => {
            for (const mode of ODEYEN_GIZLI) {
                let kuruldu = false
                const g = await goster(mode, KURULUM_ATS, {
                    reply: (m) => {
                        if (m.type === 'ATS_RUN_ONBOARDING') { kuruldu = true; return { success: true, steps: [{ txHash: '0x1' }] } }
                        return { success: true }
                    },
                    ats: () => (kuruldu ? ATS_READY : { ...ATS_READY, ready: false, blocker: 'src-allowance-missing' }),
                })
                await g.s.runAtsSetup()
                await flush()
                const gonderilen = onboardingMesajlari(g)
                expect(gonderilen, mode).toHaveLength(1)
                expect(gonderilen[0].message, mode).toEqual({ chainId: 56, address: GIZLI })
                // Sirasi: once kurulum, sonra ucret yeniden (yalniz ticket).
                expect(g.atsSent.map((x) => x.message), mode).toEqual([{ ticket: SUMMARY.ticket }])
                expect(g.timeline.indexOf('ATS_RUN_ONBOARDING'), mode).toBeLessThan(g.timeline.indexOf('ATS:' + SUMMARY.ticket))
                expect(g.s.setupBusy, mode).toBe(false)
                expect(g.s.setupFailed, mode).toBe(false)
                expect(g.s.atsState, mode).toBe('ready')
                expect(g.s.atsSetupNeeded, mode).toBe(false)
            }
        })

        it('basarisizlik: success:false, sendMessage firlatmasi ve cevapsiz hepsi setupFailed; ucret yeniden YUKLENMEZ; karar korunur, tekrar denenebilir', async () => {
            const cevaplar = [
                () => ({ success: false, error: 'gunluk kota doldu', code: 'quota' }),
                () => { throw new Error('sw yeniden basliyor') },
                () => undefined,
            ]
            for (const cevap of cevaplar) {
                const g = await goster('send', KURULUM_ATS, { reply: (m) => (m.type === 'ATS_RUN_ONBOARDING' ? cevap() : { success: true }) })
                await g.s.runAtsSetup()
                await flush()
                expect(onboardingMesajlari(g)).toHaveLength(1)
                expect(g.s.setupFailed).toBe(true)
                expect(g.s.setupBusy).toBe(false)
                expect(g.atsSent).toEqual([])
                // Karar korunur (kurulum hala gerekli): dugme geri gelir.
                expect(g.s.atsSetupNeeded).toBe(true)
                // Tekrar deneme hatayi temizler ve yine tek mesaj yollar.
                await g.s.runAtsSetup()
                expect(onboardingMesajlari(g)).toHaveLength(2)
            }
        })

        it('calisirken ikinci tiklama yok sayilir (tek ATS_RUN_ONBOARDING); bitince busy kalkar', async () => {
            let birak
            const bekle = new Promise((r) => { birak = r })
            const g = await goster('swap', KURULUM_ATS, {
                reply: async (m) => {
                    if (m.type === 'ATS_RUN_ONBOARDING') await bekle
                    return { success: true }
                },
            })
            const ilk = g.s.runAtsSetup()
            await flush()
            expect(g.s.setupBusy).toBe(true)
            expect(g.s.feeSlots[0].loading.value).toBe(true)
            await g.s.runAtsSetup()
            await g.s.runAtsSetup()
            expect(onboardingMesajlari(g)).toHaveLength(1)
            birak()
            await ilk
            await flush()
            expect(g.s.setupBusy).toBe(false)
        })

        it('Para yukle: runAtsSetup HICBIR sey gondermez (odeyen normal hesap, kapi gizli modda reddeder); Gonder\'de teklif yokken de gondermez', async () => {
            const fund = await goster('fund', KURULUM_ATS)
            await fund.s.runAtsSetup()
            await flush()
            expect(onboardingMesajlari(fund)).toEqual([])
            expect(fund.atsSent).toEqual([])
            expect(fund.s.setupBusy).toBe(false)
            expect(fund.s.setupFailed).toBe(false)
            const teklifsiz = await gosterEk('send', KURULUM_ATS, undefined, (s) => { s.quote = null })
            await teklifsiz.s.runAtsSetup()
            expect(onboardingMesajlari(teklifsiz)).toEqual([])
        })

        it('yeni girdi (teklif gecersiz) eski basarisizligi temizler: invalidateQuote -> setupFailed false', async () => {
            const g = await goster('send', KURULUM_ATS)
            g.s.setupFailed = true
            g.s.invalidateQuote()
            expect(g.s.setupFailed).toBe(false)
        })
    })

    describe('operator / gecici kararlar', () => {
        it('paymaster-paused: karar metni satirda, ats-setup-note ve kutu yok, onay kapali (fund ve send)', async () => {
            for (const mode of ['fund', 'send']) {
                const g = await goster(mode, { ready: false, decision: resolveAtsBlocker('paymaster-paused') })
                expect(g.s.atsState, mode).toBe('blocked')
                expect(ag(g.html), mode).toContain('This network is currently unavailable')
                expect(var_(g.html, 'ats-setup-note'), mode).toBe(false)
                expect(var_(g.html, 'ats-short-box'), mode).toBe(false)
                expect(var_(g.html, 'ats-error-box'), mode).toBe(false)
                expect(g.html, mode).not.toContain(DUGME)
                expect(kapali(g.html), mode).toBe(true)
            }
        })

        it('aciklamasi olan karar (onboarding-steps-missing): karar metni + aciklama; kurulum notu yok', async () => {
            const g = await goster('send', { ready: false, decision: resolveAtsBlocker('onboarding-steps-missing') })
            expect(ag(g.html)).toContain('Setup cannot start right now')
            expect(var_(g.html, 'ats-decision-desc')).toBe(true)
            expect(g.html).toContain('The server did not return the setup steps')
            expect(var_(g.html, 'ats-setup-note')).toBe(false)
            expect(kapali(g.html)).toBe(true)
        })

        it('rate-stale, remote-not-ready, foreign-delegation: karar metni, onay kapali', async () => {
            for (const kod of ['rate-stale', 'remote-not-ready', 'foreign-delegation']) {
                const d = resolveAtsBlocker(kod)
                const g = await goster('fund', { ready: false, decision: d })
                expect(g.s.atsState, kod).toBe('blocked')
                expect(ag(g.html), kod).toContain(g.s.feeAts.message)
                expect(kapali(g.html), kod).toBe(true)
            }
        })
    })

    describe('ucret alinamadi (error)', () => {
        it('atsError (karar yok): kirmizi kart, atsQuoteFailedTitle ve Desc, ats-retry; onay kapali', async () => {
            for (const mode of ['fund', 'send']) {
                const g = await goster(mode, { fee: null, ready: false, error: 'bundler down' })
                expect(g.s.atsState, mode).toBe('error')
                expect(var_(g.html, 'ats-error-box'), mode).toBe(true)
                expect(g.html, mode).toContain('Could not calculate fee')
                expect(g.html, mode).toContain('Network fee could not be fetched. Please try again.')
                expect(var_(g.html, 'ats-retry'), mode).toBe(true)
                expect(var_(g.html, 'ats-short-box'), mode).toBe(false)
                expect(kapali(g.html), mode).toBe(true)
            }
        })

        it('ic karar (quote-lock-required), hata alani bos: ayni kart ve ats-retry', async () => {
            const g = await goster('fund', { ready: true, decision: resolveAtsBlocker('quote-lock-required') })
            expect(g.s.atsState).toBe('error')
            expect(var_(g.html, 'ats-error-box')).toBe(true)
            expect(var_(g.html, 'ats-retry')).toBe(true)
            expect(g.html).not.toContain('A temporary problem occurred')
            expect(kapali(g.html)).toBe(true)
        })

        it('agir rota (PRIVATE_UNSUPPORTED): kendi metni, ats-retry YOK (yeniden denemek degistirmez); onay kapali', async () => {
            const g = await goster('send', { fee: null, ready: false, error: 'PRIVATE_UNSUPPORTED' })
            expect(g.s.atsState).toBe('error')
            expect(var_(g.html, 'ats-error-box')).toBe(true)
            expect(g.html).toContain(g.s.errorText('PRIVATE_UNSUPPORTED').replace(/'/g, '&#39;'))
            expect(var_(g.html, 'ats-retry')).toBe(false)
            expect(g.html).not.toContain('Could not calculate fee')
            expect(kapali(g.html)).toBe(true)
        })

        it('ats-retry baglantisi YALNIZ refreshAtsFee a baglidir (kaynak)', () => {
            expect(kaynak()).toMatch(/data-testid="ats-retry" @click="refreshAtsFee"/)
        })

        it('refreshAtsFee() yalniz ATS_PRIVATE_FEE_QUOTE gonderir; PRIVATE_QUOTE GONDERMEZ; ucret yeniden hazir olur ve onay acilir', async () => {
            let n = 0
            const ats = () => (++n === 1 ? { success: false, error: 'bundler down' } : ATS_READY)
            const r = await teklifli('fund', { ats })
            expect(r.s.atsState).toBe('error')
            expect(r.s.atsBlocked).toBe(true)
            const quotes = r.sent.filter((m) => m.type === 'PRIVATE_QUOTE').length
            expect(quotes).toBe(1)
            expect(r.atsSent).toHaveLength(1)
            r.s.refreshAtsFee()
            await flush()
            expect(r.atsSent).toHaveLength(2)
            expect(r.atsSent[1]).toEqual({ type: 'ATS_PRIVATE_FEE_QUOTE', message: { ticket: '0xt' } })
            expect(r.sent.filter((m) => m.type === 'PRIVATE_QUOTE')).toHaveLength(quotes)
            expect(r.s.atsState).toBe('ready')
            expect(r.s.atsBlocked).toBe(false)
            expect(r.s.quote.ticket).toBe('0xt')
        })
    })

    describe('akis: hicbir durum onayi yanlislikla acmaz (ATS_PRIVATE_FEE_QUOTE sahtesi)', () => {
        const durumlar = {
            'yetersiz': [{ ...ATS_READY, atsBalance: 0 }, 'short'],
            'ATS al karari, sayisiz': [{ success: true, ready: false, atsBalance: 0, blocker: 'src-balance-missing' }, 'short'],
            'kurulum': [{ ...ATS_READY, ready: false, blocker: 'src-allowance-missing' }, 'blocked'],
            'operator': [{ ...ATS_READY, ready: false, blocker: 'paymaster-paused' }, 'blocked'],
            'hata': [{ success: false, error: 'bundler down' }, 'error'],
            'agir rota': [{ success: false, error: 'PRIVATE_UNSUPPORTED' }, 'error'],
        }
        for (const [ad, [ats, durum]] of Object.entries(durumlar)) {
            it(`${ad}: atsState ${durum}, atsBlocked true, confirm() siparis gondermez (fund ve send)`, async () => {
                for (const mode of ['fund', 'send']) {
                    const r = await teklifli(mode, { ats })
                    expect(r.s.atsState, `${mode} ${ad}`).toBe(durum)
                    expect(r.s.atsBlocked, `${mode} ${ad}`).toBe(true)
                    await r.s.confirm()
                    expect(orders(r.sent), `${mode} ${ad}`).toHaveLength(0)
                    expect(r.s.busy).toBe(false)
                }
            })
        }

        it('buy-ats karari sayisiz: feeAts.required null (fee-network "—")', async () => {
            const r = await teklifli('send', { ats: durumlar['ATS al karari, sayisiz'][0] })
            expect(r.s.feeAts.required).toBeNull()
            expect(r.s.feeAts.state).toBe('short')
        })

        it('atsPrepaid: onceki odeme notu (fee-card ready + prepaid)', async () => {
            const g = await goster('fund', { prepaid: { nonce: '1' } })
            expect(g.s.atsState).toBe('ready')
            expect(g.s.feeAts.prepaid).toBe(true)
            expect(g.html).toContain('Covered by your earlier payment')
            const r = await teklifli('fund', { ats: { ...ATS_READY, prepaid: { nonce: '1' } } })
            expect(r.s.feeAts.prepaid).toBe(true)
            expect(r.s.atsBlocked).toBe(false)
        })
    })

    describe('sablon ve kaynak kilitleri', () => {
        it('AtsBuyButton TEK cagri yeri ve mode !== fund dalinin icinde; Para yukle dalinda cagri yok (X9, sT10)', () => {
            const kod = kaynak()
            const kez = kod.match(/<AtsBuyButton\b/g) || []
            expect(kez).toHaveLength(1)
            const i = kod.indexOf('<AtsBuyButton')
            const once = kod.slice(0, i)
            const dal = once.lastIndexOf('v-if="mode !== \'fund\'"')
            expect(dal).toBeGreaterThan(-1)
            // Dal ile cagri arasinda baska bir v-else (fund dali) ya da kapanmis kapsayici yok.
            expect(kod.slice(dal, i)).not.toContain('v-else')
            expect(kod.slice(dal, i)).not.toContain('</div>')
            expect(kod.match(/<PrivateAtsLinkWarning\b/g) || []).toHaveLength(1)
        })

        it('kaynak: satirda satin alma eylemi yok; useAtsPurchase ve sessiz native yedek yok; atsLinkWarn privacyActive mode !== fund a baglidir', () => {
            const kod = kaynak()
            expect(kod).not.toContain('useAtsPurchase')
            expect(kod).not.toContain('startAtsOnboarding')
            expect(kod).toMatch(/privacyActive: props\.mode !== 'fund'/)
            expect(kod).toMatch(/payWithAts: true/)
        })

        it('kaynak: SVG xmlns tasimaz (X9) ve yeni metin anahtarlari kullanilir', () => {
            const kod = kaynak()
            expect(kod).not.toContain('xmlns')
            for (const k of ['privacy.transfer.atsShort', 'privacy.transfer.atsSetupSend', 'privacy.transfer.atsSetupFund', 'privacy.atsSale.blocked']) expect(kod, k).toContain(k)
        })
    })
})

// ----------------------------------------------------------------------------------------------------------------
// Gonder: kartsiz "buyuk tutar" duzeni (sahip karari A). Ortada dev tutar, altinda kucuk kaynak hapi, bakiye + yuzde cipleri; Alici satiri (sagda
// "SilentSwap ile gizli" notu); TEK dugme olan teslim ozeti ("Recipient receives" ... "Change"); altinda "En az" (sol) ve "Odeyecegin" (sag).
// Para yukle, Takas ve Kopru eski Takas kartinda KALIR: bu blok onlarin degismedigini de kilitler.
// ----------------------------------------------------------------------------------------------------------------
describe('PrivateTransfer -- Gonder: buyuk tutar duzeni (A)', () => {
    afterEach(() => { vi.unstubAllEnvs() })
    const TEKLIF = { ...SUMMARY, expectedFulfillmentMs: 180000 }
    const KART = 'relative w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-3xl p-3 shadow-md dark:shadow-xl'
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { html, s: m.captured.instance.setupState }
    }
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const yer = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return i
    }
    const metin = (html, testid) => {
        const bas = html.indexOf('>', yer(html, testid)) + 1
        return html.slice(bas, html.indexOf('</', bas)).replace(/<[^>]*>/g, '').trim()
    }
    // Teslim ozeti dugmesi: acilis etiketinden kapanisina kadar.
    const dugme = (html) => {
        const i = yer(html, 'delivery-chip')
        return html.slice(html.lastIndexOf('<button', i), html.indexOf('</button>', i) + '</button>'.length)
    }
    const faz = (phase) => (s) => { s.schedState = { phase, seq: 1, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false } }
    // Teklifi render oncesi kurar: dogrudan BSC USDC rotasi (pay-line toplam 25.25 USDC).
    const teklifli = (quote = TEKLIF, ek = () => {}) => (s) => {
        s.recipient = STRANGER
        s.amount = '25'
        s.quote = quote
        s.quoteSourceChainId = 56
        s.quoteSourceAsset = 'USDC'
        atsHazirla(s)
        faz('ready')(s)
        ek(s)
    }
    const kaynakOku = () => readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

    it('kart YOK: Gonder ve Para yukle kartsiz (rounded-3xl ve kart golgesi yok); Takas ve Kopru eski karti, eski cipleri ve eski rozeti AYNEN tasir', async () => {
        for (const mode of ['send', 'fund']) {
            const { html } = await goster(mode)
            expect(html, mode).not.toContain('rounded-3xl')
            expect(html, mode).not.toContain('shadow-md dark:shadow-xl')
            expect(html, mode).not.toContain(KART)
        }
        for (const mode of ['swap', 'bridge']) {
            const { html } = await goster(mode)
            expect(html, mode).toContain(KART)
            // Eski kart: sagda kucuk yazi tutar, iki tam cip (teslim cipi dahil), ayrac rozeti, "Amount" etiketi.
            expect(etiket(html, 'amount-input'), mode).toMatch(/class="[^"]*text-3xl font-bold text-right bg-transparent/)
            expect(html, mode).not.toContain('text-5xl')
            expect(etiket(html, 'delivery-chip'), mode).toContain('flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] px-3 py-2 rounded-xl')
            expect(etiket(html, 'source-chip'), mode).toContain('px-3 py-2 rounded-xl')
            expect(etiket(html, 'private-badge'), mode).toContain('pointer-events-none')
            expect(html, mode).toContain('>Amount<')
            // Gonder'e ve Para yukle'ye ozgu parcalar bu modlarda YOK.
            for (const id of ['recipient-input', 'paste-button', 'same-account', 'private-tile', 'from-pill']) expect(var_(html, id), `${mode} ${id}`).toBe(false)
            expect(html, mode).not.toContain('Recipient receives')
            expect(html, mode).not.toContain('>Change')
            expect(html, mode).not.toContain('Arrives as')
        }
    })

    it('sira: tutar girdisi -> kaynak hapi -> bakiye -> alici girdisi -> teslim cipi -> tahmin -> En az -> Odeyecegin -> ucret karti; hepsi tek sutunda', async () => {
        const { html } = await goster('send', teklifli())
        const sira = ['amount-input', 'source-chip', 'balance', 'recipient-input', 'delivery-chip', 'estimate', 'min-eta', 'pay-line', 'fee-card'].map((id) => yer(html, id))
        expect(sira).toEqual([...sira].sort((a, b) => a - b))
        expect(new Set(sira).size).toBe(sira.length)
    })

    it('kaynak hapi: kompakt (rounded-full, 20 px logo, sembol ve ag adi tek satirda); tek secenekte etkilesimsiz grup, kaynak coklu iken dugme + ok', async () => {
        const tek = await goster('send')
        const grup = etiket(tek.html, 'source-chip')
        expect(grup).toMatch(/^<div/)
        expect(grup).toContain('role="group"')
        expect(grup).toContain('inline-flex items-center gap-2 max-w-full rounded-full')
        expect(grup).not.toContain('rounded-xl')
        const parca = tek.html.slice(yer(tek.html, 'source-chip'), yer(tek.html, 'balance'))
        expect(parca).toContain('w-5 h-5')
        expect(parca).toContain('w-3 h-3')
        expect(parca).toContain('>USDC</span>')
        expect(parca).toContain('>BNB Smart Chain</span>')
        expect(parca).not.toContain('<svg')
        flags.bridged = true
        const cok = await goster('send')
        const dgm = etiket(cok.html, 'source-chip')
        expect(dgm).toMatch(/^<button/)
        expect(dgm).toContain('aria-haspopup="dialog"')
        expect(dgm).toContain('rounded-full')
        const cokParca = cok.html.slice(yer(cok.html, 'source-chip'), yer(cok.html, 'balance'))
        expect(cokParca).toContain('<svg')
        expect(cokParca).toContain('w-3.5 h-3.5')
    })

    it('USDC disi kaynakta "USDC degerinde" notu hapin hemen altinda ve bakiyeden once; USDC iken yok', async () => {
        const eth = await goster('send', (s) => { s.chainId = 1; s.asset = 'ETH' })
        expect(var_(eth.html, 'usdc-value-note')).toBe(true)
        expect(yer(eth.html, 'source-chip')).toBeLessThan(yer(eth.html, 'usdc-value-note'))
        expect(yer(eth.html, 'usdc-value-note')).toBeLessThan(yer(eth.html, 'balance'))
        expect(eth.html).toContain('Enter the amount in USDC. You pay the equivalent in ETH.')
        expect(var_((await goster('send')).html, 'usdc-value-note')).toBe(false)
    })

    it('bakiye ve yuzde cipleri tutarin ALTINDA, Alici satirindan once; USDC + bilinen bakiyede uc cip, baska varlikta ve bilinmeyen bakiyede yok; bakiye asiminda kirmizi', async () => {
        const bilinen = await goster('send', (s) => { s.balance = 10 })
        const sira = ['amount-input', 'source-chip', 'balance', 'percent-25', 'percent-50', 'percent-max'].map((id) => yer(bilinen.html, id))
        expect(sira).toEqual([...sira].sort((a, b) => a - b))
        expect(yer(bilinen.html, 'percent-max')).toBeLessThan(yer(bilinen.html, 'recipient-input'))
        expect(bilinen.html.slice(yer(bilinen.html, 'percent-25'))).toContain('25%')
        expect(bilinen.html).toContain('MAX')
        // Cipler hero blogunun icinde ortalanir.
        expect(bilinen.html.slice(bilinen.html.lastIndexOf('<div', yer(bilinen.html, 'balance')), yer(bilinen.html, 'balance'))).toContain('justify-center')
        for (const kur of [(s) => { s.balance = 10; s.chainId = 1; s.asset = 'ETH' }, () => {}]) {
            const g = await goster('send', kur)
            for (const id of ['percent-25', 'percent-50', 'percent-max']) expect(var_(g.html, id), id).toBe(false)
        }
        const asim = await goster('send', (s) => { s.balance = 10; s.amount = '25' })
        expect(etiket(asim.html, 'balance')).toContain('text-red-500')
        expect(etiket(asim.html, 'amount-input')).toContain('text-red-500')
        const yeterli = await goster('send', (s) => { s.balance = 100; s.amount = '12' })
        expect(etiket(yeterli.html, 'balance')).not.toContain('text-red-500')
        expect(etiket(yeterli.html, 'amount-input')).not.toContain('text-red-500')
        expect(etiket(yeterli.html, 'amount-input')).toContain('text-slate-900 dark:text-white')
    })

    it('hero tutar: ortali, sabit yukseklik (h-14), sagda hizali eski girdi degil; giris ozellikleri ayni (text, decimal, spellcheck kapali, "0" ipucu)', async () => {
        const { html } = await goster('send')
        const tag = etiket(html, 'amount-input')
        expect(tag).toMatch(/^<input/)
        expect(tag).toContain('type="text"')
        expect(tag).toContain('inputmode="decimal"')
        expect(tag).toContain('spellcheck="false"')
        expect(tag).toContain('placeholder="0"')
        expect(tag).toContain('min-w-0 h-14 font-bold text-center bg-transparent')
        expect(tag).toContain('text-5xl')
        expect(tag).not.toContain('text-right')
        expect(tag).not.toContain('text-3xl')
        // Girdi, kaynak hapindan ONCE; kendi satirinda (birim icin taban cizgisi satiri, ortali) ve ortalanmis sutunun icinde.
        const satir = html.lastIndexOf('<div', yer(html, 'amount-input'))
        expect(html.slice(satir, yer(html, 'amount-input'))).toContain('w-full min-w-0 flex items-baseline justify-center')
        expect(html.slice(html.lastIndexOf('<div', satir - 1), satir)).toContain('flex flex-col items-center')
        expect(tag).toContain('w-full')
        expect(var_(html, 'amount-unit')).toBe(false)
    })

    it('hero tutar boyut adimlari: <=9 karakter text-5xl, 10-12 text-4xl, 13-15 text-3xl, 16-20 text-2xl, 21+ text-xl (en uzun tutar bile 360 px\'te tasmaz)', async () => {
        const ADIM = [['', 'text-5xl'], ['0', 'text-5xl'], ['12', 'text-5xl'], ['123456789', 'text-5xl'], ['1234567890', 'text-4xl'], ['123456789012', 'text-4xl'],
            ['1234567890123', 'text-3xl'], ['123456789012345', 'text-3xl'], ['1234567890123456', 'text-2xl'], ['12345678901234567890', 'text-2xl'],
            ['123456789012345678901', 'text-xl'], ['1234.123456789012345678', 'text-xl']]
        const TUM = ['text-5xl', 'text-4xl', 'text-3xl', 'text-2xl', 'text-xl']
        for (const [tutar, sinif] of ADIM) {
            const g = await goster('send', (s) => { s.amount = tutar })
            const tag = etiket(g.html, 'amount-input')
            expect(g.s.heroAmountClass, JSON.stringify(tutar)).toBe(sinif)
            expect(tag, JSON.stringify(tutar)).toContain(sinif)
            for (const baska of TUM.filter((c) => c !== sinif)) expect(tag, `${tutar} ${baska}`).not.toMatch(new RegExp(`\\b${baska}\\b`))
        }
        // Boyut yalniz uzunluga bagli: virgullu tutar da sayilir.
        expect((await goster('send', (s) => { s.amount = '1234567,89' })).s.heroAmountClass).toBe('text-4xl')
    })

    it('amount-error: yalniz kanonik olmayan tutarda, ortali kirmizi satir; bakiye satirindan sonra, Alici satirindan once', async () => {
        for (const gecersiz of ['12.0000000000000000001', '1e3', '12,', ',5']) {
            const { html } = await goster('send', (s) => { s.amount = gecersiz })
            expect(var_(html, 'amount-error'), gecersiz).toBe(true)
            expect(etiket(html, 'amount-input'), gecersiz).toContain('text-red-500')
            expect(etiket(html, 'amount-error'), gecersiz).toContain('text-center')
            expect(etiket(html, 'amount-error'), gecersiz).toContain('text-red-600 dark:text-red-400')
            expect(yer(html, 'balance'), gecersiz).toBeLessThan(yer(html, 'amount-error'))
            expect(yer(html, 'amount-error'), gecersiz).toBeLessThan(yer(html, 'recipient-input'))
        }
        for (const gecerli of ['12,5', '0012', '12', '']) {
            expect(var_((await goster('send', (s) => { s.amount = gecerli })).html, 'amount-error'), JSON.stringify(gecerli)).toBe(false)
        }
    })

    it('Alici satiri: etiket solda, "SilentSwap ile gizli" notu (private-badge) AYNI satirda sagda; girdi ve Yapistir kutusu satirin altinda', async () => {
        const { html } = await goster('send')
        const etiketIdx = html.indexOf('>Recipient<')
        expect(etiketIdx).toBeGreaterThan(-1)
        const rozetIdx = yer(html, 'private-badge')
        const girdiIdx = yer(html, 'recipient-input')
        expect(etiketIdx).toBeLessThan(rozetIdx)
        expect(rozetIdx).toBeLessThan(girdiIdx)
        // Etiket ile rozet arasinda girdi/dugme yok: ayni satir. Satir justify-between.
        const satir = html.slice(html.lastIndexOf('<div', etiketIdx), rozetIdx)
        expect(satir).toContain('justify-between')
        expect(satir).not.toContain('<input')
        expect(satir).not.toContain('<button')
        // Rozetin metni ve kalkan simgesi; "Recipient receives" etiketiyle karismaz.
        const bas = html.indexOf('data-testid="private-badge"')
        expect(html.slice(bas, html.indexOf('</span>', bas))).toContain('Private via SilentSwap')
        expect(html.slice(bas, html.indexOf('</span>', bas))).toContain('<svg')
        // Girdi kutusu: mono, Yapistir dugmesi ayni kutuda.
        const kutu = html.slice(html.lastIndexOf('<div', girdiIdx), yer(html, 'paste-button'))
        expect(kutu).toContain('rounded-xl')
        expect(etiket(html, 'recipient-input')).toContain('font-mono')
        // Rozet kart ayraci degil: yatay cizgi ve ortalama sinifi yok.
        expect(etiket(html, 'private-badge')).not.toContain('absolute')
        expect(html.slice(bas - 200, bas)).not.toContain('border-t border-slate-100')
    })

    it('same-account uyarisi: girdinin altinda, teslim ozetinin ustunde; baska adreste yok', async () => {
        const { html } = await goster('send', (s) => { s.recipient = GIZLI })
        expect(var_(html, 'same-account')).toBe(true)
        expect(yer(html, 'recipient-input')).toBeLessThan(yer(html, 'same-account'))
        expect(yer(html, 'same-account')).toBeLessThan(yer(html, 'delivery-chip'))
        expect(etiket(html, 'same-account')).toContain('text-red-600 dark:text-red-400')
        expect(var_((await goster('send', (s) => { s.recipient = STRANGER })).html, 'same-account')).toBe(false)
    })

    it('teslim ozeti TEK dugme: delivery-chip <button>, icinde etiket, logo + rozet, tahmin, sembol, ag adi ve "Change"; En az ve Odeyecegin dugmenin DISINDA', async () => {
        const { html } = await goster('send', teklifli())
        const acilis = etiket(html, 'delivery-chip')
        expect(acilis).toMatch(/^<button/)
        expect(acilis).toContain('type="button"')
        expect(acilis).toContain('aria-haspopup="dialog"')
        expect(acilis).toContain('w-full')
        expect(acilis).toContain('cursor-pointer')
        const d = dugme(html)
        expect(d).toContain('Recipient receives')
        const imgler = [...d.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])
        expect(imgler).toEqual(['/usdc.png', '/chains/56.png'])
        expect(d).toContain('data-testid="estimate"')
        expect(metin(html, 'estimate')).toBe('~24.65')
        expect(d).toContain('>USDC</span>')
        expect(d).toContain('>BNB Smart Chain</span>')
        expect(d).toMatch(/Change\s*<svg/)
        // Sirasi: etiket, logo, tahmin, sembol, ag adi, Change.
        const kesit = ['Recipient receives', '<img', 'data-testid="estimate"', '>USDC</span>', '>BNB Smart Chain</span>', 'Change'].map((p) => d.indexOf(p))
        expect(kesit).toEqual([...kesit].sort((a, b) => a - b))
        expect(new Set(kesit).size).toBe(kesit.length)
        // Dugmenin disinda kalanlar.
        for (const id of ['min-eta', 'pay-line', 'recipient-input', 'source-chip']) expect(d, id).not.toContain(`data-testid="${id}"`)
        expect(html.indexOf('</button>', yer(html, 'delivery-chip'))).toBeLessThan(yer(html, 'min-eta'))
        expect(html.split('data-testid="delivery-chip"').length - 1).toBe(1)
    })

    it('teslim ozeti dugmesi kaynakta pickerOpen i acar ve ref=deliveryTrigger tasir (kapaninca odak buraya doner)', () => {
        const kaynak = yorumsuz(kaynakOku())
        expect(kaynak).toMatch(/<button\s+ref="deliveryTrigger"\s+type="button"\s+aria-haspopup="dialog"\s+data-testid="delivery-chip"\s+@click="pickerOpen = true"/)
        // Kartin teslim cipi ve Para yukle'nin teslim satiri da ayni durumu acar (uc yer, her biri tam bir kez).
        expect(kaynak.split('pickerOpen = true').length - 1).toBe(3)
    })

    it('tahmin: teklif yokken "—" soluk, teklifle "~24.65" koyu; sembol hep yaninda; sabit kucuk boyut (kart kademeleri YOK), truncate, title tam deger', async () => {
        const bos = await goster('send')
        expect(metin(bos.html, 'estimate')).toBe('—')
        expect(var_(bos.html, 'calc-pill')).toBe(false)
        expect(etiket(bos.html, 'estimate')).not.toContain('title=')
        expect(dugme(bos.html)).toContain('>USDC</span>')
        expect(dugme(bos.html)).toContain('text-slate-400 dark:text-zinc-600')
        const dolu = await goster('send', teklifli())
        const tag = etiket(dolu.html, 'estimate')
        expect(tag).toContain('truncate')
        expect(tag).toContain('tabular-nums')
        expect(tag).toContain('title="24.65"')
        expect(dugme(dolu.html)).toContain('text-slate-900 dark:text-white')
        expect(dugme(dolu.html)).not.toContain('text-slate-400 dark:text-zinc-600')
        expect(dugme(dolu.html)).toContain('text-sm')
        for (const kademe of ['text-3xl', 'text-xl', 'text-base']) expect(dugme(dolu.html), kademe).not.toContain(kademe)
        // Uzun deger ayni tek satir; cok kucuk deger "~" almaz; bozuk ham tutar tire.
        const uzun = await goster('send', teklifli({ ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '123456789123400000000000000' } }))
        expect(metin(uzun.html, 'estimate')).toBe('~123456789.1234')
        expect(etiket(uzun.html, 'estimate')).toContain('title="123456789.1234"')
        const kucuk = await goster('send', teklifli({ ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '1' } }))
        expect(metin(kucuk.html, 'estimate')).toBe('&lt;0.000001')
        const bozuk = await goster('send', teklifli({ ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: 'abc' } }))
        expect(metin(bozuk.html, 'estimate')).toBe('—')
    })

    it('baska teslim tokeni (Base ETH): logo + yerel rozet, sembol ve ag adi dugmede; uzak logo kullanilmaz', async () => {
        const BASE_ETH = { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 }
        const { html } = await goster('send', (s) => s.onPickToken(BASE_ETH, 'https://img/uzak-eth.png'))
        const d = dugme(html)
        expect(d).toContain('>ETH</span>')
        expect(d).toContain('>Base</span>')
        expect(d).toMatch(/<img[^>]*src="\/chains\/8453\.png"/)
        expect(d).not.toContain('uzak-eth')
        expect(d).toContain('Recipient receives')
    })

    it('hesaplaniyor: calc-pill AYNI dugmenin icinde, tahminin yerinde; estimate yok; etiket, ag adi ve Change yerinde', async () => {
        vi.useFakeTimers()
        try {
            const pil = await goster('send', (s) => { s.recipient = STRANGER; s.amount = '25'; s.onQuoteInput('discrete') })
            expect(pil.s.phase).toBe('waiting')
            expect(var_(pil.html, 'calc-pill')).toBe(true)
            expect(var_(pil.html, 'estimate')).toBe(false)
            const d = dugme(pil.html)
            expect(d).toContain('data-testid="calc-pill"')
            expect(d).toContain('Calculating...')
            expect(d).toContain('animate-spin')
            expect(d).toContain('Recipient receives')
            expect(d).toContain('>BNB Smart Chain</span>')
            expect(d).toContain('Change')
            expect(d).toMatch(/<img[^>]*src="\/usdc\.png"/)
            const teklifliHtml = await goster('send', (s) => { s.recipient = STRANGER; s.amount = '25'; s.onQuoteInput('discrete'); s.quote = TEKLIF })
            expect(var_(teklifliHtml.html, 'calc-pill')).toBe(false)
            expect(metin(teklifliHtml.html, 'estimate')).toBe('~24.65')
        } finally {
            vi.useRealTimers()
        }
    })

    it('min-eta: teslim dugmesinin hemen altinda, solda; teklif yokken bos ama yer tutar (min-h-4)', async () => {
        const bos = await goster('send')
        expect(metin(bos.html, 'min-eta')).toBe('')
        const satirBos = bos.html.slice(bos.html.lastIndexOf('<div', yer(bos.html, 'min-eta')), yer(bos.html, 'min-eta'))
        expect(satirBos).toContain('min-h-4')
        expect(satirBos).toContain('justify-between')
        expect(var_(bos.html, 'pay-line')).toBe(false)
        const dolu = await goster('send', teklifli())
        expect(metin(dolu.html, 'min-eta')).toBe('At least 24.0 USDC · ~3 min')
        expect(etiket(dolu.html, 'min-eta')).toContain('text-slate-500')
    })

    it('pay-line: teklif yokken yok; teklifle min-eta ile AYNI satirda sagda, teslim dugmesinden SONRA, ucret kartindan ONCE, dugmenin ve rozetin disinda; "You pay" + toplam', async () => {
        const { html, s } = await goster('send', teklifli(SUMMARY))
        expect(s.payLineShown).toBe(true)
        expect(html).toMatch(/data-testid="pay-line"[^]*?You pay[^]*?25\.25 USDC/)
        const satir = html.slice(html.lastIndexOf('<div', yer(html, 'min-eta')), yer(html, 'pay-line') + 400)
        expect(satir).toContain('flex-wrap')
        expect(satir).toContain('justify-between')
        expect(etiket(html, 'pay-line')).toContain('ml-auto')
        // Eski yerlesim (rozetten ONCE, tutar girdisinin hemen altinda) degil: rozet ve girdi yukarida, pay-line teslim ozetinden sonra.
        expect(yer(html, 'private-badge')).toBeLessThan(yer(html, 'pay-line'))
        expect(yer(html, 'amount-input')).toBeLessThan(yer(html, 'pay-line'))
        expect(html.indexOf('</button>', yer(html, 'delivery-chip'))).toBeLessThan(yer(html, 'pay-line'))
        expect(yer(html, 'min-eta')).toBeLessThan(yer(html, 'pay-line'))
        expect(yer(html, 'pay-line')).toBeLessThan(yer(html, 'fee-card'))
        expect(dugme(html)).not.toContain('pay-line')
        expect(etiket(html, 'pay-line')).not.toContain('mt-1')
        // Kirmizi degil (bakiye bilinmiyor / yeterli).
        expect(html.slice(yer(html, 'pay-line'), yer(html, 'fee-card'))).not.toContain('text-red-500')
        expect(var_((await goster('send')).html, 'pay-line')).toBe(false)
    })

    it('pay-line kirmizi durumlari: toplam bakiyeyi asinca kirmizi (bakiye de, onay dugmesi kapali); odeme bilinmiyorsa payUnknown kirmizi metni', async () => {
        const kapali = (html) => /\sdisabled(=|\s|>)/.test(etiket(html, 'confirm-button'))
        const asan = await goster('send', teklifli(SUMMARY, (s) => { s.balance = 25 }))
        expect(asan.s.payExceedsBalance).toBe(true)
        expect(asan.html).toMatch(/data-testid="pay-line"[^]*?text-red-500[^]*?25\.25 USDC/)
        expect(etiket(asan.html, 'balance')).toContain('text-red-500')
        expect(kapali(asan.html)).toBe(true)
        const yeten = await goster('send', teklifli(SUMMARY, (s) => { s.balance = 25.25 }))
        expect(yeten.s.payExceedsBalance).toBe(false)
        expect(yeten.html.slice(yer(yeten.html, 'pay-line'), yer(yeten.html, 'fee-card'))).not.toContain('text-red-500')
        const bilinmiyor = await goster('send', teklifli({ ...SUMMARY, totalUsdc: null }))
        expect(bilinmiyor.s.payKnown).toBe(false)
        expect(bilinmiyor.html).toMatch(/data-testid="pay-line"[^]*?The amount you pay could not be confirmed/)
        expect(bilinmiyor.html.slice(yer(bilinmiyor.html, 'pay-line'), yer(bilinmiyor.html, 'fee-card'))).toContain('text-red-600 dark:text-red-400')
        expect(kapali(bilinmiyor.html)).toBe(true)
    })

    it('teslim agi acik degilse: dugme, tahmin, En az ve Odeyecegin yerine amber not (kartsiz)', async () => {
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '')
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
        const { html } = await goster('send')
        expect(var_(html, 'no-chain-open')).toBe(true)
        expect(etiket(html, 'no-chain-open')).toContain('bg-amber-50')
        for (const id of ['delivery-chip', 'estimate', 'calc-pill', 'min-eta', 'pay-line']) expect(var_(html, id), id).toBe(false)
        expect(html).not.toContain('Recipient receives')
        expect(html).not.toContain('rounded-3xl')
        // Alici girdisi ve tutar yine var.
        expect(var_(html, 'recipient-input')).toBe(true)
        expect(var_(html, 'amount-input')).toBe(true)
        expect(yer(html, 'recipient-input')).toBeLessThan(yer(html, 'no-chain-open'))
    })

    it('kart altindaki SIRA degismedi: amber alici notu ve Ucretler karti Gonder blogunun ALTINDA', async () => {
        const { html } = await goster('send', (s) => { s.deliveryChainId = 8453 })
        expect(var_(html, 'recipient-note')).toBe(true)
        expect(yer(html, 'min-eta')).toBeLessThan(yer(html, 'recipient-note'))
        expect(yer(html, 'recipient-note')).toBeLessThan(yer(html, 'fee-card'))
    })

    it('kaynak kilidi: Gonder blogu <template v-if="mode === \'send\'">, Para yukle blogu onun v-else-if i, eski kart (Takas, Kopru) en sonda v-else; girdi, yuzde cipleri ve rozet her dalda ayni baglantilarla', () => {
        const kaynak = kaynakOku()
        const sablon = yorumsuz(kaynak.slice(0, kaynak.indexOf('<script setup>')))
        expect(sablon.split(`<template v-if="mode === 'send'">`).length - 1).toBe(1)
        // Zincir: send -> fund -> kart. Para yukle blogu Gonder blogunun, eski kart Para yukle blogunun HEMEN ardindan gelir (arada baska kardes yok).
        expect(sablon.split(`<template v-else-if="mode === 'fund'">`).length - 1).toBe(1)
        expect(sablon.indexOf(`<template v-if="mode === 'send'">`)).toBeLessThan(sablon.indexOf(`<template v-else-if="mode === 'fund'">`))
        expect(sablon).toMatch(/<\/template>\s*<template v-else-if="mode === 'fund'">/)
        expect(sablon).toMatch(/<\/template>\s*<div v-else class="relative w-full bg-white dark:bg-\[#131315\] border border-slate-200 dark:border-white\/5 rounded-3xl p-3 shadow-md dark:shadow-xl/)
        // Ortak girdi ve davranislar uc dalda da (Gonder + Para yukle + kart): tutar, yuzde cipleri, rozet, kaynak hapi, bakiye.
        expect(sablon.split('v-model.trim="amount"').length - 1).toBe(3)
        expect(sablon.split('@click="setPercent(p)"').length - 1).toBe(3)
        expect(sablon.split('data-testid="private-badge"').length - 1).toBe(3)
        expect(sablon.split('data-testid="balance"').length - 1).toBe(3)
        expect(sablon.split('testid="source-chip"').length - 1).toBe(3)
        expect(sablon.split('data-testid="usdc-value-note"').length - 1).toBe(3)
        expect(sablon.split('data-testid="amount-error"').length - 1).toBe(3)
        expect(sablon.split('data-testid="pay-line"').length - 1).toBe(3)
        expect(sablon.split('data-testid="min-eta"').length - 1).toBe(3)
        expect(sablon.split('data-testid="no-chain-open"').length - 1).toBe(3)
        // Yalniz Gonder'de olanlar tam bir kez.
        for (const id of ['recipient-input', 'paste-button', 'same-account']) expect(sablon.split(`data-testid="${id}"`).length - 1, id).toBe(1)
        // Kompakt hap yalniz Gonder'in kaynak cipinde.
        expect(sablon.split(/\bcompact\b/).length - 1).toBe(1)
        // Tahmin metni tek hesaplanir (kart, Gonder ve Para yukle ayni computed'i okur).
        expect(sablon.split('estimateLabel').length - 1).toBe(3)
    })

    it('"Recipient receives" ve "Change" metinleri iki dilde var ve kaynakta anahtarla okunur', () => {
        const dil = (ad) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../i18n/locales/${ad}.json`, import.meta.url)), 'utf8')).privacy.transfer
        expect(dil('en').recipientReceives).toBe('Recipient receives')
        expect(dil('en').change).toBe('Change')
        expect(dil('tr').recipientReceives).toBe('Alıcıya ulaşan')
        expect(dil('tr').change).toBe('Değiştir')
        const kod = yorumsuz(kaynakOku())
        expect(kod).toContain("$t('privacy.transfer.recipientReceives')")
        expect(kod).toContain("$t('privacy.transfer.change')")
    })

    it('closePicker: Gonder tetikleyicisi duz <button> (kendisi odaklanir); kartta cip bileseni ($el) da calisir', async () => {
        const { s } = await goster('send')
        const focus = vi.fn()
        s.deliveryTrigger = { focus }
        s.pickerOpen = true
        await s.closePicker()
        expect(s.pickerOpen).toBe(false)
        expect(focus).toHaveBeenCalledTimes(1)
        const cipFocus = vi.fn()
        s.deliveryTrigger = { $el: { focus: cipFocus } }
        await s.closePicker()
        expect(cipFocus).toHaveBeenCalledTimes(1)
        expect(focus).toHaveBeenCalledTimes(1)
        s.deliveryTrigger = null
        await s.closePicker()
    })

    it('davranis ayni: alici + tutar yazinca teklif istenir; teslim tokeni degisince yeni tokenle yeniden istenir', async () => {
        const { s, sent } = await ready('send')
        s.recipient = STRANGER
        s.amount = '25'
        await quoteAl(s)
        expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message).toMatchObject({ outputAddress: STRANGER, payoutUsdc: '25' })
        expect(s.quote).not.toBeNull()
        s.onPickToken(CAKE_TOKEN)
        await quoteAl(s)
        expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE').at(-1).message.outputToken.symbol).toBe('CAKE')
    })
})

// ----------------------------------------------------------------------------------------------------------------
// Para yukle: "Hesaplar arasi" duzeni (sahip karari F1). Ustte iki ince cizgili kare (sol: kaynak hesap = eski Kimden hapi, sag: Gizli Hesap) ve aralarinda ok;
// altta sola dayali buyuk tutar + sagda kaynak cipi, bakiye + yuzde cipleri; tek dugme olan "Arrives as ~14.85 USDC · BNB Smart Chain" satiri; altinda "En az" (sol)
// ve "Odeyecegin" (sag). Takas ve Kopru eski kartta, Gonder (A) buyuk tutar duzeninde KALIR: bu blok onlarin degismedigini de kilitler.
// ----------------------------------------------------------------------------------------------------------------
describe('PrivateTransfer -- Para yukle: hesaplar arasi duzeni (F1)', () => {
    afterEach(() => { vi.unstubAllEnvs() })
    const B2 = { key: 'b-2', address: '0x' + '12'.repeat(20), name: 'Hesap 2', type: 'hd' }
    const IKI = { accounts: [A, B2] }
    const TEKLIF = { ...SUMMARY, expectedFulfillmentMs: 180000 }
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { html, s: m.captured.instance.setupState }
    }
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const yer = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return i
    }
    const metin = (html, testid) => {
        const bas = html.indexOf('>', yer(html, testid)) + 1
        return html.slice(bas, html.indexOf('</', bas)).replace(/<[^>]*>/g, '').trim()
    }
    // Teslim satiri dugmesi: acilis etiketinden kapanisina kadar. i18n-t sablon yuvasini SSR'da <!--[--> ... <!--]--> parca isaretleriyle sarar: icerik taramasi icin atilir.
    const dugme = (html) => {
        const i = yer(html, 'delivery-chip')
        return html.slice(html.lastIndexOf('<button', i), html.indexOf('</button>', i) + '</button>'.length).replace(/<!--\[-->|<!--\]-->/g, '')
    }
    const faz = (phase) => (s) => { s.schedState = { phase, seq: 1, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false } }
    // Teklifi render oncesi kurar: dogrudan BSC USDC rotasi (pay-line toplam 25.25 USDC, tahmin ~24.65 USDC).
    const teklifli = (quote = TEKLIF, ek = () => {}) => (s) => {
        s.sourceKey = 'a-1'
        s.amount = '25'
        s.quote = quote
        s.quoteSourceChainId = 56
        s.quoteSourceAsset = 'USDC'
        atsHazirla(s)
        faz('ready')(s)
        ek(s)
    }
    const kaynakOku = () => readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const fundBlogu = () => {
        const kaynak = kaynakOku()
        const sablon = kaynak.slice(0, kaynak.indexOf('<script setup>'))
        const bas = sablon.indexOf(`<template v-else-if="mode === 'fund'">`)
        const son = sablon.indexOf('<div v-else class="relative w-full bg-white', bas)
        expect(bas).toBeGreaterThan(-1)
        expect(son).toBeGreaterThan(bas)
        return yorumsuz(sablon.slice(bas, son))
    }

    it('hesap kareleri (cok hesap): sol kare kaynak hesap <button> (etkilesimli, ok, aria-label), ortada ok, sagda Gizli Hesap karesi; ucu tek ince cizgili satirda', async () => {
        const { html } = await goster('fund', () => {}, IKI)
        const kaynak = etiket(html, 'from-pill')
        expect(kaynak).toMatch(/^<button/)
        expect(kaynak).toContain('type="button"')
        expect(kaynak).toContain('aria-haspopup="dialog"')
        expect(kaynak).toContain('cursor-pointer')
        expect(kaynak).toContain(`aria-label="From: Hesap 1 · ${shortenAddress(A.address)}"`)
        expect(kaynak).toContain('rounded-xl border border-slate-200 dark:border-white/10')
        const sol = html.slice(html.lastIndexOf('<button', yer(html, 'from-pill')), html.indexOf('</button>', yer(html, 'from-pill')))
        expect(sol).toContain('<img')
        expect(sol).toContain('>Hesap 1</span>')
        expect(sol).toContain(`>${shortenAddress(A.address)}</span>`)
        expect(sol).toContain('<svg')
        // Sag kare: etkilesimsiz, kalkan isareti, ad ve kisa Gizli adres.
        const sag = etiket(html, 'private-tile')
        expect(sag).toMatch(/^<div/)
        expect(sag).toContain('rounded-xl border border-slate-200 dark:border-white/10')
        expect(sag).not.toContain('aria-haspopup')
        const sagParca = html.slice(yer(html, 'private-tile'), html.indexOf('</div>', html.indexOf(shortenAddress(GIZLI), yer(html, 'private-tile'))))
        expect(sagParca).toContain('<svg')
        expect(sagParca).toContain('>Private Account</span>')
        expect(sagParca).toContain(`>${shortenAddress(GIZLI)}</span>`)
        expect(sagParca).not.toContain('<button')
        // Ucu tek ince cizgili (grid) satirda, sirayla: kaynak kare, ok, Gizli Hesap karesi.
        const satir = html.slice(html.lastIndexOf('<div', html.lastIndexOf('<button', yer(html, 'from-pill'))), yer(html, 'private-tile'))
        expect(satir).toContain('grid grid-cols-[1fr_auto_1fr]')
        const ok = satir.indexOf('M5 12h14M13 6l6 6-6 6')
        expect(ok).toBeGreaterThan(satir.indexOf('</button>'))
        // Eski Kimden hapi (rounded-full, bg-slate-100) kalmadi.
        expect(kaynak).not.toContain('rounded-full')
        expect(html.slice(0, yer(html, 'amount-input'))).not.toContain('bg-slate-100 dark:bg-white/5 border border-transparent')
    })

    it('hesap kareleri (tek hesap): sol kare dugmesiz <div role=group> ve oksuz, ayni ad ve kisa adres; Gizli Hesap karesi ayni', async () => {
        const { html } = await goster('fund')
        const kaynak = etiket(html, 'from-pill')
        expect(kaynak).toMatch(/^<div/)
        expect(kaynak).toContain('role="group"')
        expect(kaynak).not.toContain('aria-haspopup')
        expect(kaynak).not.toContain('cursor-pointer')
        expect(kaynak).toContain(`aria-label="From: Hesap 1 · ${shortenAddress(A.address)}"`)
        const sol = html.slice(html.lastIndexOf('<div', yer(html, 'from-pill')), html.indexOf('</div>', yer(html, 'from-pill')))
        expect(sol).toContain('>Hesap 1</span>')
        expect(sol).toContain(`>${shortenAddress(A.address)}</span>`)
        expect(sol).not.toContain('<svg')
        expect(var_(html, 'private-tile')).toBe(true)
        expect(html).toContain('>Private Account</span>')
    })

    it('hesap kareleri: Gizli Hesap karesinin kisa adresi yalniz privacy.active iken; kaynak hesap yoksa kareler cizilmez; Gonder, Takas ve Kopru kare cizmez', async () => {
        const kapali = await goster('fund', () => {}, { active: false })
        expect(kapali.html).toContain('>Private Account</span>')
        expect(kapali.html).not.toContain(shortenAddress(GIZLI))
        for (const mode of ['send', 'swap', 'bridge']) {
            const { html } = await goster(mode)
            expect(var_(html, 'private-tile'), mode).toBe(false)
            expect(var_(html, 'from-pill'), mode).toBe(false)
        }
        // Yalniz eski TON hesabi: kaynak hesap listesi bos, kare yok (eski davranisla ayni).
        const bos = await goster('fund', () => {}, { accounts: [LEGACY_TON] })
        expect(var_(bos.html, 'from-pill')).toBe(false)
        expect(var_(bos.html, 'private-tile')).toBe(false)
    })

    it('kaynak hesap karesi: secim paneli ayni PrivateOptionSheet; secimle yalniz kaynak hesap degisir, aktif Gizli Hesap degismez', async () => {
        const { s } = await goster('fund', () => {}, IKI)
        expect(s.fromOpen).toBe(false)
        expect(s.fromInteractive).toBe(true)
        s.fromOpen = true
        s.onPickFrom('b-2')
        expect(s.sourceKey).toBe('b-2')
        expect(s.fromOpen).toBe(false)
        // Panel body'ye tasinir (SSR cikti dizgesine girmez): kaynak kilidi. Tek panel, kaynak hesap secici, kare tiklamasi onu acar.
        const kaynak = yorumsuz(kaynakOku())
        expect(kaynak).toContain('@click="fromInteractive && (fromOpen = true)"')
        expect(kaynak.split('<PrivateOptionSheet').length - 1).toBe(1)
        expect(kaynak).toContain(`:title="$t('privacy.transfer.fromAccount')" title-id="from-sheet-title"`)
        expect(kaynak).toContain('@select="onPickFrom" @close="closeFrom"')
    })

    it('sira: hesap kareleri -> tutar etiketi + rozet -> tutar girdisi -> kaynak cipi -> bakiye -> yuzde cipleri -> teslim satiri -> tahmin -> En az -> Odeyecegin -> ucret karti', async () => {
        const { html } = await goster('fund', teklifli(TEKLIF, (s) => { s.balance = 100 }), IKI)
        const kimlikler = ['from-pill', 'private-tile', 'private-badge', 'amount-input', 'source-chip', 'balance', 'percent-25', 'percent-50', 'percent-max', 'delivery-chip', 'estimate', 'min-eta', 'pay-line', 'fee-card']
        const sira = kimlikler.map((id) => yer(html, id))
        expect(sira).toEqual([...sira].sort((a, b) => a - b))
        expect(new Set(sira).size).toBe(sira.length)
        expect(html.indexOf('>Amount<')).toBeGreaterThan(yer(html, 'private-tile'))
        expect(html.indexOf('>Amount<')).toBeLessThan(yer(html, 'amount-input'))
    })

    it('tutar satiri: sola dayali girdi, SAGDA gercek kaynak cipi (ayni satir, Takas cipi olcusu); girdi alani ve giris ozellikleri ayni', async () => {
        const { html } = await goster('fund')
        const tag = etiket(html, 'amount-input')
        expect(tag).toMatch(/^<input/)
        expect(tag).toContain('type="text"')
        expect(tag).toContain('inputmode="decimal"')
        expect(tag).toContain('spellcheck="false"')
        expect(tag).toContain('placeholder="0"')
        expect(tag).toContain('min-w-0 h-11 font-bold text-left bg-transparent')
        expect(tag).not.toContain('text-center')
        expect(tag).not.toContain('text-right')
        // Girdi ve cip AYNI satirda: aralarinda yalniz birim kapsayicisinin kapanisi var (girdi + birim bir kapsayicida), cip girdiden sonra.
        expect(tag).toContain('w-full')
        expect(var_(html, 'amount-unit')).toBe(false)
        const chipBas = html.lastIndexOf('<', yer(html, 'source-chip'))
        const arada = html.slice(yer(html, 'amount-input'), chipBas)
        expect(arada.split('</div>').length - 1).toBe(1)
        expect(html.slice(html.lastIndexOf('<div', yer(html, 'amount-input')), yer(html, 'amount-input'))).toContain('min-w-0 flex-1 flex items-baseline')
        expect(chipBas).toBeGreaterThan(yer(html, 'amount-input'))
        // Cip: gercek (kompakt degil) kaynak cipi.
        const chip = etiket(html, 'source-chip')
        expect(chip).toContain('px-3 py-2 rounded-xl')
        expect(chip).not.toContain('rounded-full')
        expect(html.slice(chipBas, yer(html, 'balance'))).toContain('w-6 h-6')
        expect(html.slice(chipBas, yer(html, 'balance'))).toContain('>BNB Smart Chain</span>')
        expect(etiket(html, 'amount-input')).toContain('text-slate-900 dark:text-white')
    })

    it('tutar boyut adimlari: <=6 karakter text-4xl, 7 text-3xl, 8-9 text-2xl, 10-11 text-xl, 12 text-lg, 13-14 text-base, 15-16 text-sm, 17+ text-xs (en genis kaynak cipiyle bile tasmaz)', async () => {
        const ADIM = [['', 'text-4xl'], ['0', 'text-4xl'], ['123456', 'text-4xl'], ['1234567', 'text-3xl'], ['12345678', 'text-2xl'], ['123456789', 'text-2xl'],
            ['1234567890', 'text-xl'], ['12345678901', 'text-xl'], ['123456789012', 'text-lg'], ['1234567890123', 'text-base'], ['12345678901234', 'text-base'],
            ['123456789012345', 'text-sm'], ['1234567890123456', 'text-sm'], ['12345678901234567', 'text-xs'], ['1234.123456789012345678', 'text-xs']]
        const TUM = ['text-4xl', 'text-3xl', 'text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-xs']
        for (const [tutar, sinif] of ADIM) {
            const g = await goster('fund', (s) => { s.amount = tutar })
            const tag = etiket(g.html, 'amount-input')
            expect(g.s.fundAmountClass, JSON.stringify(tutar)).toBe(sinif)
            expect(tag, JSON.stringify(tutar)).toContain(sinif)
            for (const baska of TUM.filter((c) => c !== sinif)) expect(tag, `${tutar} ${baska}`).not.toMatch(new RegExp(`\\b${baska}\\b`))
        }
        // Boyut yalniz uzunluga bagli: virgullu tutar da sayilir; yazi kuculdukce girdi yuksekligi h-11 sabit kalir.
        expect((await goster('fund', (s) => { s.amount = '1234567,89' })).s.fundAmountClass).toBe('text-xl')
        expect(etiket((await goster('fund', (s) => { s.amount = '1234.123456789012345678' })).html, 'amount-input')).toContain('h-11')
    })

    it('bakiye solda, yuzde cipleri sagda ayni satir (justify-between); USDC + bilinen bakiyede uc cip, baska varlikta ve bilinmeyen bakiyede yok; bakiye asiminda kirmizi', async () => {
        const bilinen = await goster('fund', (s) => { s.balance = 10 })
        const satir = bilinen.html.slice(bilinen.html.lastIndexOf('<div', yer(bilinen.html, 'balance')), yer(bilinen.html, 'balance'))
        expect(satir).toContain('justify-between')
        expect(yer(bilinen.html, 'balance')).toBeLessThan(yer(bilinen.html, 'percent-25'))
        expect(yer(bilinen.html, 'percent-max')).toBeLessThan(yer(bilinen.html, 'delivery-chip'))
        expect(bilinen.html.slice(yer(bilinen.html, 'percent-25'))).toContain('25%')
        expect(bilinen.html).toContain('MAX')
        for (const kur of [(s) => { s.balance = 10; s.asset = 'USDT' }, () => {}]) {
            const g = await goster('fund', kur)
            for (const id of ['percent-25', 'percent-50', 'percent-max']) expect(var_(g.html, id), id).toBe(false)
        }
        const asim = await goster('fund', (s) => { s.balance = 10; s.amount = '25' })
        expect(etiket(asim.html, 'balance')).toContain('text-red-500')
        expect(etiket(asim.html, 'amount-input')).toContain('text-red-500')
        const yeterli = await goster('fund', (s) => { s.balance = 100; s.amount = '12' })
        expect(etiket(yeterli.html, 'balance')).not.toContain('text-red-500')
        expect(etiket(yeterli.html, 'amount-input')).not.toContain('text-red-500')
    })

    it('USDC disi kaynakta "USDC degerinde" notu girdi satirinin altinda ve bakiyeden once; USDC iken yok', async () => {
        flags.bridged = true
        const eth = await goster('fund', (s) => { s.chainId = 1; s.asset = 'ETH' })
        expect(var_(eth.html, 'usdc-value-note')).toBe(true)
        expect(eth.html).toContain('Enter the amount in USDC. You pay the equivalent in ETH.')
        expect(yer(eth.html, 'source-chip')).toBeLessThan(yer(eth.html, 'usdc-value-note'))
        expect(yer(eth.html, 'usdc-value-note')).toBeLessThan(yer(eth.html, 'balance'))
        expect(var_((await goster('fund')).html, 'usdc-value-note')).toBe(false)
    })

    it('amount-error: yalniz kanonik olmayan tutarda, bakiye satirindan sonra ve teslim satirindan once, kirmizi', async () => {
        for (const gecersiz of ['12.0000000000000000001', '1e3', '12,', ',5']) {
            const { html } = await goster('fund', (s) => { s.amount = gecersiz })
            expect(var_(html, 'amount-error'), gecersiz).toBe(true)
            expect(etiket(html, 'amount-input'), gecersiz).toContain('text-red-500')
            expect(etiket(html, 'amount-error'), gecersiz).toContain('text-red-600 dark:text-red-400')
            expect(yer(html, 'balance'), gecersiz).toBeLessThan(yer(html, 'amount-error'))
            expect(yer(html, 'amount-error'), gecersiz).toBeLessThan(yer(html, 'delivery-chip'))
        }
        for (const gecerli of ['12,5', '0012', '12', '']) {
            expect(var_((await goster('fund', (s) => { s.amount = gecerli })).html, 'amount-error'), JSON.stringify(gecerli)).toBe(false)
        }
    })

    it('"SilentSwap ile gizli" notu (private-badge): Tutar etiketiyle AYNI satirda sagda, tutar girdisinden once; sade (hap, ayrac, pointer-events yok); metin ve kalkan simgesi', async () => {
        const { html } = await goster('fund')
        const etiketIdx = html.indexOf('>Amount<')
        const rozetIdx = yer(html, 'private-badge')
        expect(etiketIdx).toBeGreaterThan(-1)
        expect(etiketIdx).toBeLessThan(rozetIdx)
        expect(rozetIdx).toBeLessThan(yer(html, 'amount-input'))
        const satir = html.slice(html.lastIndexOf('<div', etiketIdx), rozetIdx)
        expect(satir).toContain('justify-between')
        expect(satir).not.toContain('<input')
        expect(satir).not.toContain('<button')
        const tag = etiket(html, 'private-badge')
        expect(tag).toMatch(/^<span/)
        expect(tag).toContain('inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-zinc-500')
        for (const yasak of ['pointer-events-none', 'rounded-xl', 'border-2', 'absolute']) expect(tag, yasak).not.toContain(yasak)
        const bas = html.indexOf('data-testid="private-badge"')
        expect(html.slice(bas, html.indexOf('</span>', bas))).toContain('Private via SilentSwap')
        expect(html.slice(bas, html.indexOf('</span>', bas))).toContain('<svg')
        expect(html.split('data-testid="private-badge"').length - 1).toBe(1)
    })

    it('teslim satiri TEK dugme: tam genislik, ustunde ince cizgi, solda logo + yerel rozet, "Arrives as ~24.65 USDC · BNB Smart Chain", sagda belirgin ok; En az ve Odeyecegin dugmenin DISINDA', async () => {
        const { html } = await goster('fund', teklifli())
        const acilis = etiket(html, 'delivery-chip')
        expect(acilis).toMatch(/^<button/)
        expect(acilis).toContain('type="button"')
        expect(acilis).toContain('aria-haspopup="dialog"')
        expect(acilis).toContain('w-full')
        expect(acilis).toContain('cursor-pointer')
        // Ustunde ince cizgi (border-t) olan kapsayici, dugme tum genisligi kaplar ve 44 px'ten yuksek (logo 24 + dikey bosluk).
        const kapsayici = html.slice(html.lastIndexOf('<div', yer(html, 'delivery-chip')), yer(html, 'delivery-chip'))
        expect(kapsayici).toContain('border-t border-slate-200 dark:border-white/10')
        expect(acilis).toContain('pt-3 pb-2')
        const d = dugme(html)
        const imgler = [...d.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])
        expect(imgler).toEqual(['/usdc.png', '/chains/56.png'])
        expect(d).toMatch(/Arrives as\s*<span/)
        expect(d).toContain('data-testid="estimate"')
        expect(metin(html, 'estimate')).toBe('~24.65')
        expect(d).toContain('>USDC</span>')
        expect(d).toContain('>BNB Smart Chain</span>')
        // Sirasi: logo, cumle ("Arrives as"), tahmin, sembol, ag adi, ok (dugmenin SON svg si, belirgin: 20 px, -rotate-90).
        const kesit = ['<img', 'Arrives as', 'data-testid="estimate"', '>USDC</span>', '>BNB Smart Chain</span>', '<svg'].map((p) => d.indexOf(p))
        expect(kesit).toEqual([...kesit].sort((a, b) => a - b))
        expect(new Set(kesit).size).toBe(kesit.length)
        const ok = d.slice(d.lastIndexOf('<svg'))
        expect(ok).toContain('w-5 h-5 shrink-0 -rotate-90 text-slate-500 dark:text-zinc-400')
        expect(ok).toContain('aria-hidden="true"')
        for (const id of ['min-eta', 'pay-line', 'amount-input', 'source-chip', 'from-pill']) expect(d, id).not.toContain(`data-testid="${id}"`)
        expect(html.indexOf('</button>', yer(html, 'delivery-chip'))).toBeLessThan(yer(html, 'min-eta'))
        expect(html.split('data-testid="delivery-chip"').length - 1).toBe(1)
        // Eski iki cipli alt kutu (teslim cipi + sagda dev tahmin) kalmadi.
        expect(acilis).not.toContain('rounded-xl')
        expect(html).not.toContain('To your Private Account')
    })

    it('tahmin: teklif yokken "—" soluk (sembol ve ag yaninda), teklifle "~24.65" koyu; kart kademeleri YOK, title tam deger; cok kucuk deger "~" almaz; bozuk ham tutar tire', async () => {
        const bos = await goster('fund')
        expect(metin(bos.html, 'estimate')).toBe('—')
        expect(var_(bos.html, 'calc-pill')).toBe(false)
        expect(etiket(bos.html, 'estimate')).not.toContain('title=')
        expect(dugme(bos.html)).toContain('>USDC</span>')
        expect(dugme(bos.html)).toContain('text-slate-400 dark:text-zinc-600')
        const dolu = await goster('fund', teklifli())
        expect(etiket(dolu.html, 'estimate')).toContain('title="24.65"')
        expect(etiket(dolu.html, 'estimate')).toContain('tabular-nums')
        expect(dugme(dolu.html)).toContain('text-slate-900 dark:text-white')
        expect(dugme(dolu.html)).not.toContain('text-slate-400 dark:text-zinc-600')
        for (const kademe of ['text-3xl', 'text-xl', 'text-base', 'text-slate-800']) expect(dugme(dolu.html), kademe).not.toContain(kademe)
        const uzun = await goster('fund', teklifli({ ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '123456789123400000000000000' } }))
        expect(metin(uzun.html, 'estimate')).toBe('~123456789.1234')
        // Uzun deger ve ag adi satira sarar: dugme icerigi break-words tasir, ag adi bolunmez (whitespace-nowrap).
        expect(dugme(uzun.html)).toContain('flex-1 min-w-0 leading-snug break-words')
        expect(dugme(uzun.html)).toContain('<span class="whitespace-nowrap">BNB Smart Chain</span>')
        const kucuk = await goster('fund', teklifli({ ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: '1' } }))
        expect(metin(kucuk.html, 'estimate')).toBe('&lt;0.000001')
        const bozuk = await goster('fund', teklifli({ ...TEKLIF, dest: { ...TEKLIF.dest, expectedDestAmount: 'abc' } }))
        expect(metin(bozuk.html, 'estimate')).toBe('—')
    })

    it('baska teslim tokeni (Base ETH): logo + yerel rozet, sembol ve ag adi dugmede; uzak logo kullanilmaz', async () => {
        const BASE_ETH = { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 }
        const { html } = await goster('fund', (s) => s.onPickToken(BASE_ETH, 'https://img/uzak-eth.png'))
        const d = dugme(html)
        expect(d).toContain('>ETH</span>')
        expect(d).toContain('>Base</span>')
        expect(d).toMatch(/<img[^>]*src="\/chains\/8453\.png"/)
        expect(d).not.toContain('uzak-eth')
        expect(d).toMatch(/Arrives as\s*<span/)
    })

    it('hesaplaniyor: calc-pill AYNI dugmenin icinde, tahminin yerinde; "Arrives as" cumlesi ve estimate yok; ag adi ve ok yerinde; temiz halka donduruci (soluk halka + donen yay)', async () => {
        vi.useFakeTimers()
        try {
            const pil = await goster('fund', (s) => { s.sourceKey = 'a-1'; s.amount = '25'; s.onQuoteInput('discrete') })
            expect(pil.s.phase).toBe('waiting')
            expect(var_(pil.html, 'calc-pill')).toBe(true)
            expect(var_(pil.html, 'estimate')).toBe(false)
            const d = dugme(pil.html)
            expect(d).toContain('data-testid="calc-pill"')
            expect(d).toContain('Calculating...')
            expect(d).not.toContain('Arrives as')
            expect(d).toContain('>BNB Smart Chain</span>')
            expect(d).toMatch(/<img[^>]*src="\/usdc\.png"/)
            expect(d.slice(d.lastIndexOf('<svg'))).toContain('-rotate-90')
            // Donduruci: soluk tam halka (circle) + donen yay (path); tum svg animate-spin ile doner, tek basina "(" gibi yay kalintisi yok.
            const pilTag = d.slice(d.indexOf('data-testid="calc-pill"'), d.indexOf('Calculating...'))
            expect(pilTag).toContain('<circle')
            expect(pilTag).toContain('opacity="0.25"')
            expect(pilTag).toContain('animate-spin')
            expect(pilTag).toContain('<path')
            expect(pilTag.indexOf('<circle')).toBeLessThan(pilTag.indexOf('<path'))
            // Hesaplanirken min-eta bos ve pay-line yok; teklif gelince cumle geri gelir.
            expect(metin(pil.html, 'min-eta')).toBe('')
            expect(var_(pil.html, 'pay-line')).toBe(false)
            const teklifliHtml = await goster('fund', (s) => { s.sourceKey = 'a-1'; s.amount = '25'; s.onQuoteInput('discrete'); s.quote = TEKLIF })
            expect(var_(teklifliHtml.html, 'calc-pill')).toBe(false)
            expect(metin(teklifliHtml.html, 'estimate')).toBe('~24.65')
        } finally {
            vi.useRealTimers()
        }
    })

    it('min-eta teslim satirinin altinda solda (teklif yokken bos ama yer tutar), pay-line sagda; pay-line dugmenin ve rozetin disinda, ucret kartindan once', async () => {
        const bos = await goster('fund')
        expect(metin(bos.html, 'min-eta')).toBe('')
        const satirBos = bos.html.slice(bos.html.lastIndexOf('<div', yer(bos.html, 'min-eta')), yer(bos.html, 'min-eta'))
        expect(satirBos).toContain('min-h-4')
        expect(satirBos).toContain('justify-between')
        expect(var_(bos.html, 'pay-line')).toBe(false)
        const { html, s } = await goster('fund', teklifli(SUMMARY))
        expect(s.payLineShown).toBe(true)
        expect(metin(html, 'min-eta')).toBe('At least 24.0 USDC · ~2 min')
        expect(html).toMatch(/data-testid="pay-line"[^]*?You pay[^]*?25\.25 USDC/)
        expect(etiket(html, 'pay-line')).toContain('ml-auto')
        expect(html.indexOf('</button>', yer(html, 'delivery-chip'))).toBeLessThan(yer(html, 'min-eta'))
        expect(yer(html, 'min-eta')).toBeLessThan(yer(html, 'pay-line'))
        expect(yer(html, 'pay-line')).toBeLessThan(yer(html, 'fee-card'))
        expect(dugme(html)).not.toContain('pay-line')
        expect(html.slice(yer(html, 'pay-line'), yer(html, 'fee-card'))).not.toContain('text-red-500')
    })

    it('pay-line kirmizi durumlari: toplam bakiyeyi asinca kirmizi (bakiye de, onay dugmesi kapali); odeme bilinmiyorsa payUnknown kirmizi metni', async () => {
        const kapali = (html) => /\sdisabled(=|\s|>)/.test(etiket(html, 'confirm-button'))
        const asan = await goster('fund', teklifli(SUMMARY, (s) => { s.balance = 25 }))
        expect(asan.s.payExceedsBalance).toBe(true)
        expect(asan.html).toMatch(/data-testid="pay-line"[^]*?text-red-500[^]*?25\.25 USDC/)
        expect(etiket(asan.html, 'balance')).toContain('text-red-500')
        expect(kapali(asan.html)).toBe(true)
        const yeten = await goster('fund', teklifli(SUMMARY, (s) => { s.balance = 25.25 }))
        expect(yeten.s.payExceedsBalance).toBe(false)
        expect(yeten.html.slice(yer(yeten.html, 'pay-line'), yer(yeten.html, 'fee-card'))).not.toContain('text-red-500')
        expect(kapali(yeten.html)).toBe(false)
        const bilinmiyor = await goster('fund', teklifli({ ...SUMMARY, totalUsdc: null }))
        expect(bilinmiyor.s.payKnown).toBe(false)
        expect(bilinmiyor.html).toMatch(/data-testid="pay-line"[^]*?The amount you pay could not be confirmed/)
        expect(bilinmiyor.html.slice(yer(bilinmiyor.html, 'pay-line'), yer(bilinmiyor.html, 'fee-card'))).toContain('text-red-600 dark:text-red-400')
        expect(kapali(bilinmiyor.html)).toBe(true)
    })

    it('teslim agi acik degilse: dugme, tahmin, En az ve Odeyecegin yerine amber not; kareler, tutar ve ucret karti yerinde', async () => {
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '')
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
        const { html } = await goster('fund')
        expect(var_(html, 'no-chain-open')).toBe(true)
        expect(etiket(html, 'no-chain-open')).toContain('bg-amber-50')
        for (const id of ['delivery-chip', 'estimate', 'calc-pill', 'min-eta', 'pay-line']) expect(var_(html, id), id).toBe(false)
        expect(html).not.toContain('Arrives as')
        for (const id of ['from-pill', 'private-tile', 'amount-input', 'source-chip', 'balance', 'fee-card', 'confirm-button']) expect(var_(html, id), id).toBe(true)
        expect(yer(html, 'balance')).toBeLessThan(yer(html, 'no-chain-open'))
        expect(yer(html, 'no-chain-open')).toBeLessThan(yer(html, 'fee-card'))
    })

    it('onay dugmesi: Para yukle "Add funds" (fundConfirm), gonderilirken "Sending...", Gonder "Confirm and send"; teklif gelene dek kapali', async () => {
        const govde = (html) => {
            const bas = html.indexOf('>', yer(html, 'confirm-button')) + 1
            return html.slice(bas, html.indexOf('</button>', bas)).trim()
        }
        const fund = await goster('fund')
        expect(govde(fund.html)).toBe('Add funds')
        expect(etiket(fund.html, 'confirm-button')).toMatch(/\sdisabled(=|\s|>)/)
        expect(govde((await goster('fund', (s) => { s.busy = true })).html)).toBe('Sending...')
        expect(govde((await goster('send')).html)).toBe('Confirm and send')
        expect(govde((await goster('send', (s) => { s.busy = true })).html)).toBe('Sending...')
        expect(govde((await goster('swap')).html)).toBe('Confirm and send')
        expect(govde((await goster('bridge')).html)).toBe('Confirm and send')
        expect(fund.html).not.toContain('Confirm and send')
    })

    it('Turkce: cumle kalibi sozcuk sirasini tasir ("~24.65 USDC olarak gelir · BNB Smart Chain"), kare adi "Gizli Hesap", onay "Para yukle", hesaplanirken cumle yok', async () => {
        const { html } = await goster('fund', teklifli(), { ...IKI, locale: 'tr' })
        const d = dugme(html)
        expect(d).not.toContain('Arrives as')
        expect(d).toMatch(/>~24\.65<\/span> <span>USDC<\/span><\/span> olarak gelir<\/span>/)
        expect(d.indexOf('~24.65')).toBeLessThan(d.indexOf('olarak gelir'))
        expect(d.indexOf('olarak gelir')).toBeLessThan(d.indexOf('>BNB Smart Chain</span>'))
        expect(html).toContain('>Gizli Hesap</span>')
        expect(html).not.toContain('>Private Account</span>')
        expect(html).toContain('>Tutar<')
        const buton = html.slice(html.indexOf('>', yer(html, 'confirm-button')) + 1)
        expect(buton.slice(0, buton.indexOf('</button>')).trim()).toBe('Para yükle')
        vi.useFakeTimers()
        try {
            const pil = await goster('fund', (s) => { s.sourceKey = 'a-1'; s.amount = '25'; s.onQuoteInput('discrete') }, { ...IKI, locale: 'tr' })
            expect(dugme(pil.html)).toContain('Hesaplanıyor...')
            expect(dugme(pil.html)).not.toContain('olarak gelir')
        } finally {
            vi.useRealTimers()
        }
    })

    it('kaynak kilidi (Para yukle blogu): karti kullanmaz; tek teslim dugmesi i18n-t cumle kalibi + ref=deliveryTrigger + pickerOpen; tutar boyutu computed i; ayni baglantilar', () => {
        const blok = fundBlogu()
        expect(blok).not.toContain('rounded-3xl')
        expect(blok).not.toContain('shadow-md')
        expect(blok).not.toContain('PrivateAssetChip compact')
        expect(blok).toMatch(/<button\s+ref="deliveryTrigger"\s+type="button"\s+aria-haspopup="dialog"\s+data-testid="delivery-chip"\s+@click="pickerOpen = true"/)
        expect(blok).toMatch(/<i18n-t v-if="!calculating" keypath="privacy\.transfer\.arrivesAs" tag="span"/)
        expect(blok).toContain('<template #amount>')
        expect(blok).toContain(':class="[fundAmountClass, showUnit ?')
        expect(blok).toContain('v-model.trim="amount"')
        expect(blok).toContain('@click="setPercent(p)"')
        expect(blok).toContain('{{ estimateLabel }}')
        expect(blok).toContain('{{ payLabel }}')
        expect(blok).toContain('{{ minEtaText }}')
        // Alici girdisi, yapistir ve same-account Gonder'e ozgudur: Para yukle blogunda yok.
        for (const yasak of ['recipient-input', 'paste-button', 'same-account', 'private-tile']) expect(blok, yasak).not.toContain(yasak)
        // Kareler blok disinda (sablon basinda), yalniz Para yukle iken.
        const sablon = yorumsuz(kaynakOku().slice(0, kaynakOku().indexOf('<script setup>')))
        expect(sablon.split('data-testid="private-tile"').length - 1).toBe(1)
        expect(sablon.split('data-testid="from-pill"').length - 1).toBe(1)
        expect(sablon).toMatch(/<div v-if="mode === 'fund' && sourceAccount" class="shrink-0 grid grid-cols-\[1fr_auto_1fr\]/)
    })

    it('i18n: privateAccountName, arrivesAs ({amount} yer tutucusu) ve fundConfirm iki dilde; kaynakta anahtarla okunur', () => {
        const dil = (ad) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../i18n/locales/${ad}.json`, import.meta.url)), 'utf8')).privacy.transfer
        expect(dil('en').privateAccountName).toBe('Private Account')
        expect(dil('en').arrivesAs).toBe('Arrives as {amount}')
        expect(dil('en').fundConfirm).toBe('Add funds')
        expect(dil('tr').privateAccountName).toBe('Gizli Hesap')
        expect(dil('tr').arrivesAs).toBe('{amount} olarak gelir')
        expect(dil('tr').fundConfirm).toBe('Para yükle')
        for (const ad of ['en', 'tr']) expect(dil(ad).arrivesAs, ad).toContain('{amount}')
        const kod = yorumsuz(kaynakOku())
        expect(kod).toContain("$t('privacy.transfer.privateAccountName')")
        expect(kod).toContain("$t('privacy.transfer.fundConfirm')")
        expect(kod).toContain('keypath="privacy.transfer.arrivesAs"')
    })

    it('davranis ayni: kaynak hesap, tutar ve teslim tokeni teklif istegine gider; teslim tokeni degisince yeni tokenle yeniden istenir', async () => {
        const { s, sent } = await ready('fund')
        s.amount = '25'
        await quoteAl(s)
        expect(sent.find((m) => m.type === 'PRIVATE_QUOTE').message).toMatchObject({ sourceAccountKey: 'a-1', outputAddress: GIZLI, payoutUsdc: '25', sourceChainId: 56, sourceAsset: 'USDC' })
        s.onPickToken(CAKE_TOKEN)
        await quoteAl(s)
        expect(sent.filter((m) => m.type === 'PRIVATE_QUOTE').at(-1).message.outputToken.symbol).toBe('CAKE')
    })

    it('Gonder (A) ve Takas/Kopru bu degisiklikten etkilenmedi: Gonder hero tutar ve alici satirini, Takas ve Kopru eski karti tasir', async () => {
        const send = await goster('send')
        expect(etiket(send.html, 'amount-input')).toContain('h-14 font-bold text-center')
        expect(var_(send.html, 'recipient-input')).toBe(true)
        expect(send.html).toContain('Recipient receives')
        expect(var_(send.html, 'private-tile')).toBe(false)
        for (const mode of ['swap', 'bridge']) {
            const { html } = await goster(mode)
            expect(html, mode).toContain('relative w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-3xl p-3 shadow-md dark:shadow-xl')
            expect(etiket(html, 'amount-input'), mode).toMatch(/text-3xl font-bold text-right/)
            expect(html, mode).not.toContain('Arrives as')
        }
    })
})

// ----------------------------------------------------------------------------------------------------------------
// En az tutar hatasi (amount-min) ve USDC birimi: dort modda (Gonder A, Para yukle F1, Takas ve Kopru karti). Tutar HER ZAMAN USDC degerindedir; en az tutarin
// altindaki giris tutarin hemen altinda kirmizi hata satiri (amount-error ile ayni yer ve stil), kirmizi tutar ve ucret kartinda tire; USDC olmayan kaynakta tutarin
// yaninda "USDC" birimi, acik cumleli not ve kaynak varligiyla yazilan bakiye.
// ----------------------------------------------------------------------------------------------------------------
describe('PrivateTransfer -- en az tutar hatasi ve USDC birimi', () => {
    afterEach(() => { vi.unstubAllEnvs() })
    const B2 = { key: 'b-2', address: '0x' + '12'.repeat(20), name: 'Hesap 2', type: 'hd' }
    const IKI = { accounts: [A, B2] }
    async function goster(mode, kur = () => {}, opts) {
        const m = mount(mode, opts)
        captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
        const html = await render(m.app)
        return { html, s: m.captured.instance.setupState }
    }
    const etiket = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
    }
    const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
    const yer = (html, testid) => {
        const i = html.indexOf(`data-testid="${testid}"`)
        expect(i, testid).toBeGreaterThan(-1)
        return i
    }
    const metin = (html, testid) => {
        const bas = html.indexOf('>', yer(html, testid)) + 1
        return html.slice(bas, html.indexOf('</', bas)).replace(/<[^>]*>/g, '').trim()
    }
    // Ic ice satirlar (ucret karti): testid'li elemandan bir sonraki testid'ye kadar duz metin.
    const blok = (html, testid) => {
        const i = yer(html, testid)
        const son = html.indexOf('data-testid=', i + 10)
        return html.slice(html.indexOf('>', i) + 1, son < 0 ? undefined : son).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    }
    const faz = (phase) => (s) => { s.schedState = { phase, seq: 1, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false } }
    const kaynakOku = () => readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const AMOUNT_ERR_SINIF = 'text-[11px] font-medium text-red-600 dark:text-red-400'
    // Mod basina USDC ve USDC-disi kaynak kurulumlari (bridged kaynaklar acik: ETH/USDT kaynaklari ancak o zaman listede).
    const KUR = {
        send: { usdc: () => {}, diger: (s) => { s.chainId = 1; s.asset = 'ETH' } },
        fund: { usdc: (s) => { s.sourceKey = 'a-1' }, diger: (s) => { s.sourceKey = 'a-1'; s.chainId = 1; s.asset = 'ETH' } },
        swap: { usdc: () => {}, diger: (s) => { s.chainId = 1; s.asset = 'USDT' } },
        bridge: { usdc: () => {}, diger: (s) => { s.chainId = 1; s.asset = 'ETH' } },
    }
    const SEMBOL = { send: 'ETH', fund: 'ETH', swap: 'USDT', bridge: 'ETH' }
    const MODLAR = ['send', 'fund', 'swap', 'bridge']
    const kur = (mode, tur, ek = () => {}) => (s) => { KUR[mode][tur](s); ek(s) }
    const opts = (mode) => (mode === 'fund' ? IKI : undefined)
    const EN_DIL = (ad) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../i18n/locales/${ad}.json`, import.meta.url)), 'utf8')).privacy.transfer

    it('USDC kaynak, 11 (en az 12 altinda): dort modda amount-min "Enter at least 12 USDC." (hata amount-error ile AYNI stil), tutar kirmizi; 12 ve bos tutarda yok', async () => {
        for (const mode of MODLAR) {
            const g = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '11'; s.balance = 100 }), opts(mode))
            expect(g.s.belowMin, mode).toBe(true)
            expect(var_(g.html, 'amount-min'), mode).toBe(true)
            expect(metin(g.html, 'amount-min'), mode).toBe('Enter at least 12 USDC.')
            expect(etiket(g.html, 'amount-min'), mode).toMatch(/^<p/)
            expect(etiket(g.html, 'amount-min'), mode).toContain(AMOUNT_ERR_SINIF)
            // Tutar kirmizi (bakiye kirmizi DEGIL: yetiyor), eski tutar-gecersiz satiri yok.
            expect(etiket(g.html, 'amount-input'), mode).toContain('text-red-500 dark:text-red-400')
            expect(etiket(g.html, 'balance'), mode).not.toContain('text-red-500')
            expect(var_(g.html, 'amount-error'), mode).toBe(false)
            expect(var_(g.html, 'usdc-value-note'), mode).toBe(false)
            // Tutar girdisinin ve bakiye satirinin HEMEN altinda: teslim/ucret bolumunden once.
            expect(yer(g.html, 'amount-input'), mode).toBeLessThan(yer(g.html, 'amount-min'))
            expect(yer(g.html, 'balance'), mode).toBeLessThan(yer(g.html, 'amount-min'))
            expect(yer(g.html, 'amount-min'), mode).toBeLessThan(yer(g.html, 'fee-card'))
            if (mode !== 'swap' && mode !== 'bridge') expect(yer(g.html, 'amount-min'), mode).toBeLessThan(yer(g.html, 'delivery-chip'))
            for (const tamam of ['12', '12.5', '']) {
                const ok = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = tamam; s.balance = 100 }), opts(mode))
                expect(var_(ok.html, 'amount-min'), `${mode} ${JSON.stringify(tamam)}`).toBe(false)
                expect(etiket(ok.html, 'amount-input'), `${mode} ${JSON.stringify(tamam)}`).not.toContain('text-red-500')
            }
            // 0 ve gecersiz tutarda en az-hatasi degil: gecersizde yalniz amount-error.
            expect(var_((await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '0' }), opts(mode))).html, 'amount-min'), mode).toBe(false)
            const gecersiz = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '1x' }), opts(mode))
            expect(var_(gecersiz.html, 'amount-error'), mode).toBe(true)
            expect(var_(gecersiz.html, 'amount-min'), mode).toBe(false)
        }
    })

    it('USDC-disi kaynak (ETH/USDT), 11: dort modda amount-min "Enter at least 12 USDC worth." (belowMinValue), tutar kirmizi', async () => {
        flags.bridged = true
        for (const mode of MODLAR) {
            const g = await goster(mode, kur(mode, 'diger', (s) => { s.amount = '11'; s.balance = 5 }), opts(mode))
            expect(g.s.asset, mode).toBe(SEMBOL[mode])
            expect(var_(g.html, 'amount-min'), mode).toBe(true)
            expect(metin(g.html, 'amount-min'), mode).toBe('Enter at least 12 USDC worth.')
            expect(etiket(g.html, 'amount-min'), mode).toContain(AMOUNT_ERR_SINIF)
            expect(etiket(g.html, 'amount-input'), mode).toContain('text-red-500 dark:text-red-400')
            // USDC disinda bakiye kirmizi olmaz (tutar USDC degerinde, bakiye baska birimde).
            expect(etiket(g.html, 'balance'), mode).not.toContain('text-red-500')
            expect(yer(g.html, 'amount-input'), mode).toBeLessThan(yer(g.html, 'amount-min'))
            expect(yer(g.html, 'amount-min'), mode).toBeLessThan(yer(g.html, 'fee-card'))
            const ok = await goster(mode, kur(mode, 'diger', (s) => { s.amount = '12'; s.balance = 5 }), opts(mode))
            expect(var_(ok.html, 'amount-min'), mode).toBe(false)
            expect(etiket(ok.html, 'amount-input'), mode).not.toContain('text-red-500')
        }
    })

    it('Turkce: "En az 12 USDC gir." (USDC kaynak) ve "En az 12 USDC degerinde tutar gir." (USDC-disi); Ingilizce metin yok', async () => {
        flags.bridged = true
        for (const mode of MODLAR) {
            const usdc = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '11' }), { ...opts(mode), locale: 'tr' })
            expect(metin(usdc.html, 'amount-min'), mode).toBe('En az 12 USDC gir.')
            expect(usdc.html, mode).not.toContain('Enter at least')
            const diger = await goster(mode, kur(mode, 'diger', (s) => { s.amount = '11' }), { ...opts(mode), locale: 'tr' })
            expect(metin(diger.html, 'amount-min'), mode).toBe('En az 12 USDC değerinde tutar gir.')
            expect(diger.html, mode).not.toContain('Enter at least')
        }
        const dil = EN_DIL('tr')
        expect(dil.belowMin).toBe('En az {min} USDC gir.')
        expect(dil.belowMinValue).toBe('En az {min} USDC değerinde tutar gir.')
    })

    it('{min} etkin en az tutardir: sunucu daha yuksek en az bildirirse (20) metin o sayiyla; yerlesik 12 altina inmez', async () => {
        const BILGI = { providerInfo: { success: true, info: { feeBps: 100, minUsdc: 20, maxUsdc: 20010, available: true } } }
        const yuksek = (s) => { s.providerInfo = { feeBps: 100, minUsdc: 20, maxUsdc: 20010, available: true }; s.amount = '15' }
        for (const mode of ['send', 'fund']) {
            const g = await goster(mode, yuksek, { ...opts(mode), ...BILGI })
            expect(g.s.effectiveMin, mode).toBe(20)
            expect(metin(g.html, 'amount-min'), mode).toBe('Enter at least 20 USDC.')
        }
        const dusuk = await goster('send', (s) => { s.providerInfo = { feeBps: 100, minUsdc: 5, maxUsdc: 20010, available: true }; s.amount = '11' }, { providerInfo: { success: true, info: { feeBps: 100, minUsdc: 5, maxUsdc: 20010, available: true } } })
        expect(metin(dusuk.html, 'amount-min')).toBe('Enter at least 12 USDC.')
    })

    it('amount-min kaynakta: uc dalda da amount-error satirinin HEMEN ardindan v-else-if="belowMin" (ikisi birden cizilmez); amountRed belowMin i icerir; metin belowMinText ten', () => {
        const kod = yorumsuz(kaynakOku())
        const sablon = kod.slice(0, kod.indexOf('<script setup>'))
        expect(sablon.split('data-testid="amount-min"').length - 1).toBe(3)
        expect(sablon.split('data-testid="amount-error"').length - 1).toBe(3)
        expect(sablon.match(/<p v-if="amountInvalid" data-testid="amount-error"[^>]*>[^<]*<\/p>\s*<p v-else-if="belowMin" data-testid="amount-min"/g)).toHaveLength(3)
        expect(sablon.split('{{ belowMinText }}').length - 1).toBe(3)
        expect(kod).toContain('const amountRed = computed(() => amountInvalid.value || balanceRed.value || belowMin.value)')
        expect(kod).toMatch(/const belowMinText = computed\(\(\) => t\(asset\.value !== 'USDC' \? 'privacy\.transfer\.belowMinValue' : 'privacy\.transfer\.belowMin', \{ min: effectiveMin\.value \}\)\)/)
    })

    it('ucret karti: en az tutarin altinda KIRMIZI dipnot yok (dipnot yalniz Ayrinti de, gri); ag ucreti tire (hicbir sey hesaplanmiyor); servis ucreti tire; dort modda', async () => {
        flags.bridged = true
        for (const mode of MODLAR) {
            const g = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '11'; s.balance = 100 }), opts(mode))
            const kart = g.html.slice(g.html.indexOf('data-testid="fee-card"'), g.html.indexOf('data-testid="confirm-button"'))
            expect(kart, mode).not.toContain('text-red-')
            expect(kart, mode).not.toContain('data-testid="fee-note-service"')
            expect(kart, mode).not.toContain('Minimum 12 USDC')
            expect(blok(g.html, 'fee-service'), mode).toContain('—')
            const ag = blok(g.html, 'fee-network')
            expect(ag, mode).toContain('—')
            expect(ag, mode).not.toContain('calculating')
            // Ayni durum Turkce.
            const tr = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '11' }), { ...opts(mode), locale: 'tr' })
            expect(blok(tr.html, 'fee-network'), mode).not.toContain('hesaplan')
            expect(blok(tr.html, 'fee-network'), mode).toContain('—')
        }
    })

    it('ag ucreti satiri, dort modda: hicbir sey yuklenmiyorsa (tutar bos, en az altinda, gecerli ama teklif istenemez) TIRE; gercekten yuklenirken (teklif yolda, ATS ucreti yukleniyor) "calculating…"; hazirsa tutar', async () => {
        flags.bridged = true
        const uygun = (mode) => kur(mode, 'usdc', (s) => { s.amount = '25'; s.balance = 100; if (mode === 'send') s.recipient = STRANGER })
        const hazirTeklif = (s) => { s.quote = SUMMARY; s.quoteSourceChainId = 56; s.quoteSourceAsset = 'USDC'; atsHazirla(s) }
        for (const mode of MODLAR) {
            // Tutar BOS: ATS idle, teklif yok, yukleme yok -> tire (eskiden yalnizca "calculating…" idi).
            const bos = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = ''; s.balance = 100 }), opts(mode))
            expect(bos.s.atsState, mode).toBe('idle')
            expect(bos.s.calculating, mode).toBe(false)
            expect(blok(bos.html, 'fee-network'), mode).toContain('—')
            expect(blok(bos.html, 'fee-network'), mode).not.toContain('calculating')
            expect(blok(bos.html, 'fee-service'), mode).toContain('—')
            // Bos tutar, Turkce de tire (hesaplaniyor yok).
            const bosTr = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = ''; s.balance = 100 }), { ...opts(mode), locale: 'tr' })
            expect(blok(bosTr.html, 'fee-network'), mode).toContain('—')
            expect(blok(bosTr.html, 'fee-network'), mode).not.toContain('hesaplan')
            // En az altinda: tire.
            const alti = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '11'; s.balance = 100 }), opts(mode))
            expect(alti.s.belowMin, mode).toBe(true)
            expect(blok(alti.html, 'fee-network'), mode).toContain('—')
            expect(blok(alti.html, 'fee-network'), mode).not.toContain('calculating')
            // Gecerli tutar ama teklif istenemez (Gonder'de alici yok): hicbir sey hesaplanmiyor -> tire, "calculating…" degil.
            if (mode === 'send') {
                const aliciYok = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '25'; s.balance = 100 }))
                expect(aliciYok.s.quoteEligible).toBe(false)
                expect(blok(aliciYok.html, 'fee-network')).toContain('—')
                expect(blok(aliciYok.html, 'fee-network')).not.toContain('calculating')
            }
            // Gercek yukleme 1: uygun girdi, teklif bekleniyor/isteniyor, elde teklif yok -> "calculating…" (tire degil).
            for (const f of ['waiting', 'quoting']) {
                const yolda = await goster(mode, (s) => { uygun(mode)(s); faz(f)(s) }, opts(mode))
                expect(yolda.s.quoteEligible, `${mode} ${f}`).toBe(true)
                expect(yolda.s.calculating, `${mode} ${f}`).toBe(true)
                expect(yolda.s.atsState, `${mode} ${f}`).toBe('idle')
                expect(blok(yolda.html, 'fee-network'), `${mode} ${f}`).toContain('calculating')
                expect(blok(yolda.html, 'fee-network'), `${mode} ${f}`).not.toContain('—')
            }
            // Hiz siniri beklemesi ve hata: teklif yolda DEGIL -> tire.
            for (const f of ['rateWait', 'error']) {
                const durgun = await goster(mode, (s) => { uygun(mode)(s); faz(f)(s) }, opts(mode))
                expect(durgun.s.calculating, `${mode} ${f}`).toBe(false)
                expect(blok(durgun.html, 'fee-network'), `${mode} ${f}`).toContain('—')
                expect(blok(durgun.html, 'fee-network'), `${mode} ${f}`).not.toContain('calculating')
            }
            // Gercek yukleme 2: teklif var + ATS ucreti yukleniyor -> belowMin olsa bile "calculating…".
            const yukleniyor = await goster(mode, (s) => { kur(mode, 'usdc', (z) => { z.amount = '11' })(s); hazirTeklif(s); s.feeSlots[0].loading.value = true; faz('ready')(s) }, opts(mode))
            expect(yukleniyor.s.atsState, mode).toBe('loading')
            expect(blok(yukleniyor.html, 'fee-network'), mode).toContain('calculating')
            // Hazir ucret belowMin'den etkilenmez.
            const hazir = await goster(mode, (s) => { kur(mode, 'usdc', (z) => { z.amount = '11' })(s); hazirTeklif(s); faz('ready')(s) }, opts(mode))
            expect(hazir.s.atsState, mode).toBe('ready')
            expect(blok(hazir.html, 'fee-network'), mode).toContain('ATS')
            expect(blok(hazir.html, 'fee-network'), mode).not.toContain('calculating')
        }
    })

    it('Ayrinti acikken dipnot gri: feeNoteService (SilentSwap ucreti tutarin ustune eklenir. En az 12 USDC) her durumda, en az altinda da kirmizi degil', async () => {
        const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateFeeCard.vue', import.meta.url)), 'utf8'))
        expect(kod).toContain('<span data-testid="fee-note-service" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-500">')
        expect(kod.split('data-testid="fee-note-service"').length - 1).toBe(1)
        expect(kod).not.toContain('v-if="!belowMin" data-testid="fee-note-service"')
        expect(EN_DIL('en').feeNoteService).toBe('The SilentSwap fee is added on top of the amount. Minimum {min} USDC.')
    })

    it('USDC kaynakta birim yok: amount-unit ve usdc-value-note hicbir modda cizilmez; girdi tam genislik (w-full), bakiye yalniz sayi', async () => {
        for (const mode of MODLAR) {
            const g = await goster(mode, kur(mode, 'usdc', (s) => { s.amount = '15'; s.balance = 48.215 }), opts(mode))
            expect(var_(g.html, 'amount-unit'), mode).toBe(false)
            expect(var_(g.html, 'usdc-value-note'), mode).toBe(false)
            expect(g.html, mode).not.toContain('field-sizing-content')
            expect(etiket(g.html, 'amount-input'), mode).toContain('w-full')
            expect(metin(g.html, 'balance'), mode).toBe('Balance: 48.2150')
        }
    })

    it('USDC-disi kaynakta tutarin HEMEN ardindan "USDC" birimi (amount-unit): girdi ile ayni kapsayicida, hemen yanindaki kardes, soluk, aria-hidden; dort modda', async () => {
        flags.bridged = true
        for (const mode of MODLAR) {
            const g = await goster(mode, kur(mode, 'diger', (s) => { s.amount = '15'; s.balance = 0.0412 }), opts(mode))
            expect(var_(g.html, 'amount-unit'), mode).toBe(true)
            const birim = etiket(g.html, 'amount-unit')
            expect(birim, mode).toMatch(/^<span/)
            expect(birim, mode).toContain('aria-hidden="true"')
            expect(birim, mode).toContain('font-semibold text-slate-400 dark:text-zinc-500')
            expect(metin(g.html, 'amount-unit'), mode).toBe('USDC')
            // Hemen yanindaki kardes: girdi etiketinin kapanisindan sonra dogrudan birim span i.
            const temiz = g.html.replace(/<!--[\s\S]*?-->/g, '')
            const i = temiz.indexOf('data-testid="amount-input"')
            const girdiSonu = temiz.indexOf('>', i) + 1
            expect(temiz.slice(girdiSonu, girdiSonu + 40), mode).toMatch(/^<span /)
            expect(temiz.slice(girdiSonu, temiz.indexOf('data-testid="amount-unit"'))).not.toContain('<div')
            // Birim kirmizi olmaz (yalniz tutar kirmizilanir).
            expect(birim, mode).not.toContain('text-red')
        }
    })

    it('birimli girdi icerik kadar genisler (field-sizing-content, tasmaz: max-w-full + min-w-0) ve kapsayici taban cizgisine hizalar (Gonder ortali, Para yukle sola dayali)', async () => {
        flags.bridged = true
        const send = await goster('send', kur('send', 'diger', (s) => { s.amount = '15' }))
        const girdi = etiket(send.html, 'amount-input')
        expect(girdi).toContain('field-sizing-content max-w-full')
        expect(girdi).not.toMatch(/[\s"]w-full[\s"]/)
        expect(girdi).toContain('min-w-0')
        expect(girdi).toContain('h-14')
        const sarmal = send.html.slice(send.html.lastIndexOf('<div', yer(send.html, 'amount-input')), yer(send.html, 'amount-input'))
        expect(sarmal).toContain('w-full min-w-0 flex items-baseline justify-center')
        const fund = await goster('fund', kur('fund', 'diger', (s) => { s.amount = '15' }), IKI)
        const fGirdi = etiket(fund.html, 'amount-input')
        expect(fGirdi).toContain('field-sizing-content max-w-full')
        expect(fGirdi).not.toMatch(/[\s"]w-full[\s"]/)
        expect(fGirdi).toContain('h-11')
        expect(fund.html.slice(fund.html.lastIndexOf('<div', yer(fund.html, 'amount-input')), yer(fund.html, 'amount-input'))).toContain('min-w-0 flex-1 flex items-baseline')
        // Takas/Kopru kartinda girdi ayni (w-full text-right 3xl), birim sagda hizali tutarin arkasinda: negatif kenar bosluk + taban cizgisi payi.
        const swap = await goster('swap', kur('swap', 'diger', (s) => { s.amount = '15' }))
        expect(etiket(swap.html, 'amount-input')).toContain('w-full min-w-0 text-3xl font-bold text-right')
        const kartBirim = etiket(swap.html, 'amount-unit')
        expect(kartBirim).toContain('-ml-3 pt-2.5 shrink-0 text-base font-semibold')
    })

    it('bos tutarda da birim gorunur (placeholder "0" ile birlikte); tutar yazilinca ayni birim', async () => {
        flags.bridged = true
        for (const mode of ['send', 'fund']) {
            const bos = await goster(mode, kur(mode, 'diger'), opts(mode))
            expect(etiket(bos.html, 'amount-input'), mode).toContain('placeholder="0"')
            expect(var_(bos.html, 'amount-unit'), mode).toBe(true)
        }
    })

    it('Gonder birim kademeleri: birim tutardan bir kademe kucuk ve kademelerle birlikte kuculur (<=7 5xl/2xl, <=10 4xl/xl, <=13 3xl/lg, <=16 2xl/base, uzun xl/sm); USDC kaynakta eski kademeler', async () => {
        flags.bridged = true
        const ADIM = [['', 'text-5xl', 'text-2xl'], ['15', 'text-5xl', 'text-2xl'], ['1234567', 'text-5xl', 'text-2xl'], ['12345678', 'text-4xl', 'text-xl'], ['1234567890', 'text-4xl', 'text-xl'],
            ['12345678901', 'text-3xl', 'text-lg'], ['1234567890123', 'text-3xl', 'text-lg'], ['12345678901234', 'text-2xl', 'text-base'], ['1234567890123456', 'text-2xl', 'text-base'],
            ['12345678901234567', 'text-xl', 'text-sm'], ['1234.123456789012345678', 'text-xl', 'text-sm']]
        for (const [tutar, sayi, birim] of ADIM) {
            const g = await goster('send', kur('send', 'diger', (s) => { s.amount = tutar }))
            expect(g.s.heroAmountClass, JSON.stringify(tutar)).toBe(sayi)
            expect(g.s.heroUnitClass, JSON.stringify(tutar)).toBe(birim)
            expect(etiket(g.html, 'amount-input'), JSON.stringify(tutar)).toContain(sayi)
            expect(etiket(g.html, 'amount-unit'), JSON.stringify(tutar)).toContain(birim)
        }
        // USDC kaynak: birim sinifi yok, kademeler eski (<=9 5xl).
        const usdc = await goster('send', (s) => { s.amount = '123456789' })
        expect(usdc.s.heroAmountClass).toBe('text-5xl')
        expect(usdc.s.heroUnitClass ?? null).toBe(null)
        const usdc10 = await goster('send', (s) => { s.amount = '1234567890' })
        expect(usdc10.s.heroAmountClass).toBe('text-4xl')
    })

    it('Para yukle birim kademeleri: <=4 4xl/lg, <=5 3xl/base, <=7 2xl/sm, <=9 xl/sm, <=10 lg/xs, <=12 base/xs, <=13 sm/xs, uzun xs/xs; USDC kaynakta eski kademeler', async () => {
        flags.bridged = true
        const ADIM = [['', 'text-4xl', 'text-lg'], ['15', 'text-4xl', 'text-lg'], ['1234', 'text-4xl', 'text-lg'], ['12345', 'text-3xl', 'text-base'], ['123456', 'text-2xl', 'text-sm'],
            ['1234567', 'text-2xl', 'text-sm'], ['12345678', 'text-xl', 'text-sm'], ['123456789', 'text-xl', 'text-sm'], ['1234567890', 'text-lg', 'text-xs'],
            ['12345678901', 'text-base', 'text-xs'], ['123456789012', 'text-base', 'text-xs'], ['1234567890123', 'text-sm', 'text-xs'], ['12345678901234', 'text-xs', 'text-xs'], ['1234.123456789012345678', 'text-xs', 'text-xs']]
        for (const [tutar, sayi, birim] of ADIM) {
            const g = await goster('fund', kur('fund', 'diger', (s) => { s.amount = tutar }), IKI)
            expect(g.s.fundAmountClass, JSON.stringify(tutar)).toBe(sayi)
            expect(g.s.fundUnitClass, JSON.stringify(tutar)).toBe(birim)
            expect(etiket(g.html, 'amount-input'), JSON.stringify(tutar)).toContain(sayi)
            expect(etiket(g.html, 'amount-unit'), JSON.stringify(tutar)).toContain(birim)
        }
        const usdc = await goster('fund', kur('fund', 'usdc', (s) => { s.amount = '123456' }), IKI)
        expect(usdc.s.fundAmountClass).toBe('text-4xl')
        expect(usdc.s.fundUnitClass ?? null).toBe(null)
        expect((await goster('fund', kur('fund', 'usdc', (s) => { s.amount = '1234567' }), IKI)).s.fundAmountClass).toBe('text-3xl')
    })

    it('"in USDC value" notu acik cumleye dondu: "Enter the amount in USDC. You pay the equivalent in {asset}." (usdc-value-note), USDC-disi kaynakta dort modda, tr dahil; USDC kaynakta yok', async () => {
        flags.bridged = true
        for (const mode of MODLAR) {
            const en = await goster(mode, kur(mode, 'diger'), opts(mode))
            expect(metin(en.html, 'usdc-value-note'), mode).toBe(`Enter the amount in USDC. You pay the equivalent in ${SEMBOL[mode]}.`)
            expect(en.html, mode).not.toContain('in USDC value')
            const tr = await goster(mode, kur(mode, 'diger'), { ...opts(mode), locale: 'tr' })
            expect(metin(tr.html, 'usdc-value-note'), mode).toBe(`Tutarı USDC olarak gir. Karşılığı ${SEMBOL[mode]} olarak ödenir.`)
            expect(var_((await goster(mode, kur(mode, 'usdc'), opts(mode))).html, 'usdc-value-note'), mode).toBe(false)
        }
        expect(EN_DIL('en').usdcEntryNote).toBe('Enter the amount in USDC. You pay the equivalent in {asset}.')
        expect(EN_DIL('tr').usdcEntryNote).toBe('Tutarı USDC olarak gir. Karşılığı {asset} olarak ödenir.')
        expect(EN_DIL('en').usdcValue).toBeUndefined()
    })

    it('not yeri: Gonder ve Para yukle\'de kaynak cipinin altinda ve bakiyeden once; kartta tutar satirinin altinda (cip sutunu DAR kalir: not cipin yaninda sikismaz)', async () => {
        flags.bridged = true
        for (const mode of ['send', 'fund']) {
            const g = await goster(mode, kur(mode, 'diger'), opts(mode))
            expect(yer(g.html, 'source-chip'), mode).toBeLessThan(yer(g.html, 'usdc-value-note'))
            expect(yer(g.html, 'usdc-value-note'), mode).toBeLessThan(yer(g.html, 'balance'))
        }
        const kart = await goster('swap', kur('swap', 'diger', (s) => { s.amount = '11' }))
        const notIdx = yer(kart.html, 'usdc-value-note')
        expect(yer(kart.html, 'amount-input')).toBeLessThan(notIdx)
        expect(notIdx).toBeLessThan(yer(kart.html, 'amount-min'))
        // Not, cip sutununun (flex-col items-start gap-1 shrink-0) icinde degil.
        const sutun = kart.html.indexOf('flex flex-col items-start gap-1 shrink-0')
        const sutunSonu = kart.html.indexOf('</div>', sutun)
        expect(kart.html.slice(sutun, sutunSonu)).not.toContain('usdc-value-note')
    })

    it('bakiye kaynak varligiyla yazilir ("Balance: 0.0412 ETH" / tr "Bakiye: 0.0412 ETH"); USDC kaynakta yalniz sayi; bilinmeyen bakiyede tire (sembol yok); yuzde cipleri USDC-disinda yok', async () => {
        flags.bridged = true
        for (const mode of MODLAR) {
            const g = await goster(mode, kur(mode, 'diger', (s) => { s.balance = 0.0412 }), opts(mode))
            expect(metin(g.html, 'balance'), mode).toBe(`Balance: 0.0412 ${SEMBOL[mode]}`)
            for (const id of ['percent-25', 'percent-50', 'percent-max']) expect(var_(g.html, id), `${mode} ${id}`).toBe(false)
            const tr = await goster(mode, kur(mode, 'diger', (s) => { s.balance = 0.0412 }), { ...opts(mode), locale: 'tr' })
            expect(metin(tr.html, 'balance'), mode).toBe(`Bakiye: 0.0412 ${SEMBOL[mode]}`)
            const bilinmiyor = await goster(mode, kur(mode, 'diger'), opts(mode))
            expect(metin(bilinmiyor.html, 'balance'), mode).toBe('Balance: —')
            const usdc = await goster(mode, kur(mode, 'usdc', (s) => { s.balance = 12.5 }), opts(mode))
            expect(metin(usdc.html, 'balance'), mode).toBe('Balance: 12.5000')
        }
    })

    it('teklifli USDC-disi kaynak: "You pay" satiri kaynak varligiyla (0.00431 ETH), tahmin ve En az USDC; ekranda tutar ETH gibi yazilmaz', async () => {
        flags.bridged = true
        const teklifli = (s) => {
            s.chainId = 1; s.asset = 'ETH'; s.amount = '15'; s.balance = 0.0412
            s.quote = { ...SUMMARY, totalUsdc: '15.15', sourceInput: { amount: '4310000000000000', asset: 'ETH', decimals: 18, chainId: 1 }, expectedFulfillmentMs: 120000, dest: { chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '14850000000000000000', minDestAmount: '14760000000000000000', quoteUsd: null } }
            s.quoteSourceChainId = 1; s.quoteSourceAsset = 'ETH'
            atsHazirla(s); faz('ready')(s)
        }
        for (const mode of ['send', 'fund']) {
            const g = await goster(mode, (s) => { if (mode === 'fund') s.sourceKey = 'a-1'; teklifli(s) }, opts(mode))
            expect(g.s.payLabel, mode).toBe('0.00431 ETH')
            expect(blok(g.html, 'pay-line'), mode).toContain('You pay 0.00431 ETH')
            expect(metin(g.html, 'estimate'), mode).toBe('~14.85')
            expect(metin(g.html, 'min-eta'), mode).toBe('At least 14.76 USDC · ~2 min')
            expect(metin(g.html, 'amount-unit'), mode).toBe('USDC')
            expect(var_(g.html, 'amount-min'), mode).toBe(false)
        }
    })

    it('kaynak kilidi: birim, kademe tablolari ve bakiye etiketi tek yerde (showUnit, tierOf, HERO/FUND tablolari, balanceLabel); eski usdcValue anahtari kalmadi', () => {
        const kod = yorumsuz(kaynakOku())
        expect(kod).toContain("const showUnit = computed(() => asset.value !== 'USDC')")
        expect(kod).toContain('const balanceLabel = computed(')
        expect(kod).toContain('const tierOf = (tiers, n) =>')
        for (const t of ['HERO_TIERS', 'HERO_UNIT_TIERS', 'FUND_TIERS', 'FUND_UNIT_TIERS']) expect(kod, t).toContain(`const ${t} = [`)
        expect(kod.split(`{{ $t('privacy.transfer.usdcEntryNote', { asset }) }}`).length - 1).toBe(3)
        expect(kod.split('data-testid="amount-unit"').length - 1).toBe(3)
        expect(kod.split('{{ balanceLabel }}').length - 1).toBe(3)
        expect(kod).not.toContain('privacy.transfer.usdcValue')
    })
})
