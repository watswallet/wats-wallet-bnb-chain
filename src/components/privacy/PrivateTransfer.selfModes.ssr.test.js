import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
// Asagidaki sahteler bileseni gecmis, itibar ve bakiye yardimcilarindan yalitir (gercek ag/RPC istegi yok). Bu dosyada sahtelerden YALNIZ
// loadTrusted gozlemcisi (trustedCalls) iddiaya girer; gecmis, itibar ve bakiye sahtelerinin kendisi uzerinde iddia KURULMAZ.
// Istek duzeyindeki kilitler (/wallet/history ve /wallet/reputation istegi yok, bakiye okuyucusu) privateRequestInventory.ssr.test.js icindedir.
vi.mock('../../utils/historyRecipients', () => ({ fetchHistoryCounterparties: vi.fn(async () => []) }))
// loadTrusted'in acilista cagrilip cagrilmadigini (ve hangi agla) gozlemek icin gercek kompozitin ustune ince bir gozlemci: Gonder cagirir,
// swap, bridge ve fund CAGIRMAZ ("acilista loadTrusted" testi). Gecmis sorgusu Gizli Hesapta ZATEN atlandigindan fetchHistoryCounterparties
// bu bilgiyi gostermez, bu yuzden cagri dogrudan sayilir. Davranis aynen gercek loadTrusted'e gecer.
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
// Kaynak bakiyesi zincirden okur: SSR testlerinde gercek RPC YOK (X14). Bu sahte YALNIZ yalitir (bakiye hep null); balanceCalls girdileri
// kaydeder ama bu dosyada iddiaya girmez (bakiye okuyucusunun girdi kilitleri privateRequestInventory.ssr.test.js icindedir).
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

// ATS Al dugmesi: satis yolu sabit "canli" (useAtsPurchase sahtesi), PRIVATE_ATS_SALE bayragi testten surulur (AtsBuyButton.ssr.test.js deseni). Bayrak KAPALI iken
// bilesen dugme yerine privacy.atsSale.blocked satirini cizer; bayrak ACIK ise "Buy ATS" dugmesi.
const satis = vi.hoisted(() => ({ flag: false }))
vi.mock('../../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return satis.flag },
}))
vi.mock('../../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: true, open: async () => true }),
}))

// Koprulu kaynaklar (Relay Depository) Takas icin gerekir: bu dosyada varsayilan ACIK. sendSources teslim degismezi ihlalini taklit eder
// (null = gercek tablo). silentswapConfig MOCK'LANMAZ: gercek PRIVATE_DEST_NATIVE (true) gecerlidir.
const flags = vi.hoisted(() => ({ bridged: true, sendSources: null }))
vi.mock('../../utils/privacy/privateBridgedSources', async (importOriginal) => {
    const real = await importOriginal()
    return {
        ...real,
        get PRIVATE_BRIDGED_SOURCES() { return flags.bridged },
        hasPrivateSendSource: (id) => (flags.sendSources === null ? real.hasPrivateSendSource(id) : flags.sendSources.includes(id)),
    }
})

import { getAddress } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { shortenAddress } from '../../utils/shortenAddress'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama.js'
import { yorumsuzHtml } from '../../test-utils/ssrHtmlYardimcilari.js'
import { privacyStore } from '../../store/privacy'
import { pageStore } from '../../store/pageStore'
import { nativeTokenOf, usdcTokenOf, USDC_LOGO } from '../../utils/privacy/deliveryTokens'
import { deliveryChainOf } from '../../utils/privacy/deliveryChains'
import { selfDeliveryTokenOf } from '../../utils/privacy/selfRoutes'
import { privateFundDeliverable } from '../../utils/privacy/silentswapConfig'
import { sourceAssetAddress } from '../../utils/privacy/sourceAssets'
import { localTokenLogoPath } from '../../utils/privacy/localTokenLogos'
import { setLocalLogosOnly } from '../../utils/tokenLogo'
import { chainLogo } from '../../utils/chainLogo'
import { resolveAtsBlocker } from '../../utils/atsBlocker'
import PrivateTransfer from './PrivateTransfer.vue'

const GIZLI = '0x' + 'cd'.repeat(20)
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), name: 'Hesap 1', type: 'hd' }
const STRANGER = '0x' + '7'.repeat(40)
const SUMMARY = { ticket: '0xt', payoutUsdc: '25.0', totalUsdc: '25.25', serviceFeeUsdc: '0.175', integratorFeeUsdc: '0.075', integratorAddress: '0x' + '99'.repeat(20), expiresAtMs: Date.now() + 600000, expectedFulfillmentMs: 90000, recipient: GIZLI, recipientChainId: 56, sourceInput: { amount: '25250000000000000000', asset: 'USDC', decimals: 18, chainId: 56 },
    // Teslim ozeti HER ZAMAN dolu gelir (C1 Task 8): ag, sembol ve ondalik secimden; ekran eksik ozeti PRIVATE_QUOTE_MISMATCH ile reddeder.
    dest: { chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '24650000000000000000', minDestAmount: '24000000000000000000', quoteUsd: null } }
const ATS_READY = { success: true, transferFee: 19.7, symbol: 'ATS', atsBalance: 100, opCount: 1, ready: true, nextSteps: [], commissionAts: '0', commissionAtsHuman: 0, commissionRegion: 'local', maxAtsSellRaw: '97' }

// Dort kipin ekran rotasi: onay sonrasi yonlendirme yalniz kullanici hala kendi ekranindaysa yapilir.
const PAGE_OF = { fund: 'private_fund', send: 'private_send', swap: 'private_swap', bridge: 'private_bridge' }

beforeEach(() => { vi.clearAllMocks(); flags.bridged = true; flags.sendSources = null; satis.flag = false })
afterEach(() => { delete globalThis.chrome; vi.unstubAllEnvs(); setLocalLogosOnly(false) })

// SSR'da izleyiciler (watch) render'dan sonra TETIKLENMEZ; yalniz `immediate` ilk
// calisma olur. useAddressSecurity'nin ilk itibar kontrolu asenkron biter -- bitmeden
// `blocked` true kalir ve send modunda teklif istenmez.
const flush = () => new Promise((r) => setTimeout(r, 0))

// providerInfo: PRIVATE_PROVIDER_INFO cevabi. undefined -> ekran bos `{ success: true }` alir (info yok -> null); nesne -> { success: true, info }.
// Bu mesaj `sent` listesine GIRMEZ (indeksli iddialar teklif/siparis sirasini okur): ayri `infoSent` listesinde tutulur.
// ats: ATS_PRIVATE_FEE_QUOTE cevabi. undefined -> hazir ucret (ATS_READY); nesne ya da (msg) => cevap. Bu mesaj da `sent` e GIRMEZ:
// `atsSent` listesinde tutulur; `timeline` teklif/siparis/ucret mesajlarinin SIRASINI yazar (ucret girdisi 'ATS:<ticket>').
function mount(mode, { reply, accounts = [A], active = true, providerInfo, ats } = {}) {
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
        // denetimi (quoteDeliveryOk) agi, sembolu ve ondaligi istekle karsilastirir.
        if (msg.type === 'PRIVATE_QUOTE') {
            const t = msg.message.outputToken
            return { success: true, quote: { ...SUMMARY, recipient: msg.message.outputAddress, recipientChainId: t.chainId, dest: { ...SUMMARY.dest, chainId: t.chainId, asset: t.symbol, decimals: t.decimals } } }
        }
        if (msg.type === 'PRIVATE_ORDER') return { success: true, ticket: '0xt', hash: '0xh' }
        return { success: true }
    })
    const app = createApp(PrivateTransfer, { props: { mode } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    Object.assign(privacyStore(), { active, privateAddress: GIZLI, privateAccountKey: 'g-1' })
    // Kullanici bu ekrandadir: onay sonrasi yonlendirme yalniz hala burada ise yapilir (U-M6).
    pageStore().currentPage = PAGE_OF[mode]
    pageStore().ordersNotice = null
    const captured = captureInstance(app, 'PrivateTransfer')
    return { app, captured, sent, infoSent, atsSent, timeline, stub }
}

async function ready(mode, opts) {
    const m = mount(mode, opts)
    await render(m.app)
    await flush()
    return { ...m, s: m.captured.instance.setupState }
}

// Otomatik teklif: "Teklif al" dugmesi yok; teklif zamanlayicidan gelir. Bu yardimci bir ayrik girdi bildirir ve sahte saati
// teklif bitene (ready/error/rateWait/expired/idle) kadar ilerletir. Yalniz kendi cagrisi suresince sahte zamanlayici kurar.
async function quoteAl(s) {
    vi.useFakeTimers()
    try {
        s.onQuoteInput('discrete')
        for (let i = 0; i < 200 && ['waiting', 'quoting'].includes(s.phase); i++) await vi.advanceTimersByTimeAsync(400)
    } finally {
        vi.useRealTimers()
    }
    // Teklif sonrasi ATS ucret yaniti birkac mikro gorev sonra yerlesir: gercek zamanlayicida bir tur beklenir.
    await flush()
}

// Girdiyi (kur) render'dan ONCE setupState'e yazar, HTML'i ve canli setupState'i doner.
async function goster(mode, kur = () => {}, opts) {
    const m = mount(mode, opts)
    captureInstance(m.app, 'PrivateTransfer', (inst) => kur(inst.setupState))
    const html = await render(m.app)
    return { ...m, html, s: m.captured.instance.setupState }
}

const etiket = (html, testid) => {
    const i = html.indexOf(`data-testid="${testid}"`)
    expect(i, testid).toBeGreaterThan(-1)
    return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
}
const var_ = (html, testid) => html.includes(`data-testid="${testid}"`)
// Cipin ANA logosu: cip dugmesinin ilk <img> src degeri (zincir rozeti ikinci <img>'dir). Sablon yorumlari atilir.
const cipLogosu = (html, testid) => {
    const temiz = yorumsuzHtml(html)
    const i = temiz.indexOf(`data-testid="${testid}"`)
    expect(i, testid).toBeGreaterThan(-1)
    const img = temiz.slice(i).match(/<img[^>]*\ssrc="([^"]*)"/)
    expect(img, testid).not.toBeNull()
    return img[1]
}
const EN_JSON = JSON.parse(readFileSync(fileURLToPath(new URL('../../i18n/locales/en.json', import.meta.url)), 'utf8'))
const EN = (anahtar) => EN_JSON.privacy.transfer[anahtar]

describe('PrivateTransfer swap/bridge modlari I: adresleme, odeyen, zincirler, gecis (Task 5)', () => {
    const h1 = (html) => yorumsuzHtml(html).match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]
    const ENYOL = (yol) => yol.split('.').reduce((o, k) => o[k], EN_JSON)
    const USDT_ETH = { chainId: 1, address: getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'), symbol: 'USDT', decimals: 6 }
    // Kaynak cifti ve cikti ACIKCA yazilir (R24): baslangic cifti Task 6'da degisir, bu dosyadaki testler ondan etkilenmez.
    const KUR = {
        swap: (s) => { s.chainId = 1; s.asset = 'USDC'; s.outputToken = USDT_ETH },
        bridge: (s) => { s.chainId = 56; s.asset = 'USDC'; s.outputToken = nativeTokenOf(1) },
    }
    const orders = (sent) => sent.filter((x) => x.type === 'PRIVATE_ORDER')
    const quoteler = (sent) => sent.filter((x) => x.type === 'PRIVATE_QUOTE')
    // PRIVATE_ORDER cevabini ezen testler icin varsayilan teklif cevabinin aynisi.
    const quoteOk = (m) => ({
        success: true,
        quote: {
            ...SUMMARY,
            recipient: m.message.outputAddress,
            recipientChainId: m.message.outputToken.chainId,
            dest: { ...SUMMARY.dest, chainId: m.message.outputToken.chainId, asset: m.message.outputToken.symbol, decimals: m.message.outputToken.decimals },
        },
    })
    const DUGME = 'Buy ATS'
    const BLOCKED = 'ATS purchases are not available in private mode'
    const SETUP_FUND = 'Finish the ATS setup outside private mode, then come back.'
    const SETUP_SEND = 'Your Private Account needs a quick ATS setup. You can do it right here.'
    // Teklifi ve etkin ucret yuvasini render ONCESI kurar (SSR'da izleyici yok). over: fee, balance, ready, decision, error, prepaid.
    const atsKur = (over = {}) => (s) => {
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
    // Swap/bridge icin ortak akis girdisi: hazir ekran, acik kaynak + cikti, tutar, teklif.
    async function teklifli(mode, opts) {
        const r = await ready(mode, opts)
        KUR[mode](r.s)
        r.s.amount = '25'
        await quoteAl(r.s)
        expect(r.s.quote).toBeTruthy()
        return r
    }

    describe('baslik ve adresleme', () => {
        it('baslik: swap ve bridge kendi baslik anahtarini gosterir; fund ve send basliklari degismez', async () => {
            const basliklar = []
            for (const [mode, key] of [['fund', 'fundTitle'], ['send', 'sendTitle'], ['swap', 'swapTitle'], ['bridge', 'bridgeTitle']]) {
                const { html } = await goster(mode, KUR[mode])
                expect(typeof EN(key), key).toBe('string')
                expect(EN(key), key).not.toBe('')
                expect(h1(html), mode).toBe(EN(key))
                basliklar.push(EN(key))
            }
            expect(EN('swapTitle')).toBe('Private swap')
            expect(EN('bridgeTitle')).toBe('Private bridge')
            expect(new Set(basliklar).size).toBe(4)
        })

        it('adresleme: swap ve bridge "toPrivate" etiketini ve kisa Gizli adresi gosterir, Alici etiketi yok; send tersi', async () => {
            for (const mode of ['swap', 'bridge']) {
                const { html } = await goster(mode, KUR[mode])
                expect(html, mode).toContain('>' + EN('toPrivate') + '<')
                expect(html, mode).toContain(shortenAddress(GIZLI))
                expect(html, mode).not.toContain('>' + EN('recipient') + '<')
            }
            // Pozitif kontrol: send alici etiketini cizer, Gizli adres satiri ve toPrivate etiketi yok.
            const send = await goster('send')
            expect(send.html).toContain('>' + EN('recipient') + '<')
            expect(send.html).not.toContain('>' + EN('toPrivate') + '<')
            expect(send.html).not.toContain(shortenAddress(GIZLI))
        })

        it('adresleme: privacy.active kapaliyken kisa Gizli adres satiri gizli, etiket kalir (swap, bridge: "toPrivate"; fund: Gizli Hesap karesinin adi)', async () => {
            for (const mode of ['swap', 'bridge']) {
                const { html } = await goster(mode, undefined, { active: false })
                expect(html, mode).toContain('>' + EN('toPrivate') + '<')
                expect(html, mode).not.toContain(shortenAddress(GIZLI))
            }
            // Para yukle (F1) kart degil: "toPrivate" etiketi yerine Gizli Hesap karesi (ad kalir, kisa adres gizlenir).
            const fund = await goster('fund', undefined, { active: false })
            expect(fund.html).toContain('>' + EN('privateAccountName') + '<')
            expect(fund.html).not.toContain('>' + EN('toPrivate') + '<')
            expect(fund.html).not.toContain(shortenAddress(GIZLI))
        })

        it('adresleme: swap ve bridge alici girdisi, yapistir dugmesi, same-account, recipient-note ve SecurityWarning cizmez; send hepsini cizer', async () => {
            const kurA = (s) => { s.onPickToken(nativeTokenOf(8453)); s.securityChecking = true }
            const kurB = (s) => { s.recipient = GIZLI }
            for (const mode of ['swap', 'bridge']) {
                const { html } = await goster(mode, (s) => { KUR[mode](s); kurA(s); kurB(s) })
                for (const id of ['recipient-input', 'paste-button', 'recipient-note', 'same-account']) expect(var_(html, id), `${mode} ${id}`).toBe(false)
                expect(html, mode).not.toContain(ENYOL('send.reputation.checking'))
            }
            // Pozitif kontrol: ayni girdiler send'de hepsini cizdirir.
            const a = await goster('send', kurA)
            for (const id of ['recipient-input', 'paste-button', 'recipient-note']) expect(var_(a.html, id), `send ${id}`).toBe(true)
            expect(a.html).toContain(ENYOL('send.reputation.checking'))
            const b = await goster('send', kurB)
            expect(var_(b.html, 'same-account')).toBe(true)
        })

        it('outputAddress: swap ve bridge her zaman Gizli Hesap, yazilan recipient yok sayilir; send recipient\'i izler', async () => {
            for (const mode of ['swap', 'bridge']) {
                const { s } = await ready(mode)
                KUR[mode](s)
                s.recipient = STRANGER
                expect(s.outputAddress, mode).toBe(GIZLI)
                expect(s.sourceAccountKey, mode).toBe('g-1')
            }
            const send = await ready('send')
            send.s.recipient = STRANGER
            expect(send.s.outputAddress).toBe(STRANGER)
            const fund = await ready('fund')
            fund.s.recipient = STRANGER
            expect(fund.s.outputAddress).toBe(GIZLI)
        })

        it('acilista loadTrusted: swap, bridge ve fund CAGIRMAZ, send cagirir (pozitif kontrol)', async () => {
            // Pozitif kontrol ONCE: Gonder acilista guvenilir listeyi ilk teslim agiyla (BSC) yukler; gozlemci gercekten cagriyi gorur.
            await ready('send')
            expect(trustedCalls).toHaveBeenCalledTimes(1)
            expect(trustedCalls).toHaveBeenCalledWith({ chainId: 56 })
            trustedCalls.mockClear()
            for (const mode of ['swap', 'bridge', 'fund']) {
                await ready(mode)
                expect(trustedCalls, mode).not.toHaveBeenCalled()
            }
        })
    })

    describe('teslim aglari ve kaynak listesi', () => {
        it('deliveryChains: swap yalniz secili kaynak agin tablo satiri, bridge kaynak disindaki acik aglarin tablo satirlari', async () => {
            const swap = await ready('swap')
            KUR.swap(swap.s)
            swap.s.chainId = 137
            expect(swap.s.deliveryChains.map((c) => c.chainId)).toEqual([137])
            for (const row of swap.s.deliveryChains) {
                expect(row).toEqual(deliveryChainOf(row.chainId))
                expect(Object.keys(row)).toEqual(expect.arrayContaining(['chainId', 'name', 'logo']))
            }

            const bridge = await ready('bridge')
            KUR.bridge(bridge.s)
            expect(bridge.s.deliveryChains.map((c) => c.chainId)).toEqual([1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
            for (const row of bridge.s.deliveryChains) {
                expect(row).toEqual(deliveryChainOf(row.chainId))
                expect(Object.keys(row)).toEqual(expect.arrayContaining(['chainId', 'name', 'logo']))
            }
            bridge.s.chainId = 1
            bridge.s.asset = 'USDC'
            expect(bridge.s.deliveryChains.map((c) => c.chainId)).toEqual([56, 8453, 42161, 10, 137, 100, 42220, 5000, 25])

            // Pozitif kontrol: send tum Gonder listesini verir (kaynaga bagli degil).
            const send = await ready('send')
            expect(send.s.deliveryChains.map((c) => c.chainId)).toEqual([56, 1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
        })

        it('deliveryChains: swap ve bridge Para yukle (FUND) listesini okur, Gonder (SEND) listesini degil', async () => {
            // SEND listesi vitest varsayilaninda genis kalir: SEND okuyan bir uygulama 9 / 1 / 1 satir verirdi.
            vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56,8453')
            const bridge = await ready('bridge')
            KUR.bridge(bridge.s)
            expect(bridge.s.deliveryChains.map((c) => c.chainId)).toEqual([8453])
            const swapBase = await ready('swap')
            KUR.swap(swapBase.s)
            swapBase.s.chainId = 8453
            expect(swapBase.s.deliveryChains.map((c) => c.chainId)).toEqual([8453])
            const swapEth = await ready('swap')
            KUR.swap(swapEth.s)
            swapEth.s.chainId = 1
            expect(swapEth.s.deliveryChains.map((c) => c.chainId)).toEqual([])
        })

        it('no-chain-open: bridge\'de tek FUND agi kaynagin kendisi ise liste bos, not gorunur, teklif istenmez', async () => {
            vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
            const g = await goster('bridge', KUR.bridge)
            expect(g.s.deliveryChains).toEqual([])
            expect(g.html).toContain('data-testid="no-chain-open"')
            expect(g.html).toContain('No delivery network is open in this version.')
            expect(g.html).not.toContain('data-testid="delivery-chip"')
            g.s.amount = '25'
            expect(g.s.quoteEligible).toBe(false)
            await quoteAl(g.s)
            expect(quoteler(g.sent)).toHaveLength(0)

            // KONTROL: ortam varsayilana donunce ayni ekran not gostermez ve uygun girdiyle teklif ister.
            vi.unstubAllEnvs()
            const c = await goster('bridge', KUR.bridge)
            expect(var_(c.html, 'no-chain-open')).toBe(false)
            expect(c.s.deliveryChains).toHaveLength(9)
            c.s.amount = '25'
            expect(c.s.quoteEligible).toBe(true)
        })

        it('no-chain-open: swap\'ta secili kaynak ag FUND listesinde yoksa liste bos, not gorunur, teklif istenmez', async () => {
            const kurBase = (s) => { KUR.swap(s); s.chainId = 8453; s.asset = 'USDC'; s.outputToken = nativeTokenOf(8453) }
            vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
            const g = await goster('swap', kurBase)
            expect(g.s.deliveryChains).toEqual([])
            expect(g.html).toContain('data-testid="no-chain-open"')
            g.s.amount = '25'
            expect(g.s.quoteEligible).toBe(false)
            await quoteAl(g.s)
            expect(quoteler(g.sent)).toHaveLength(0)

            // KONTROL: Base FUND listesine girince ayni durum tek satirlik liste ve uygun teklif verir.
            vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56,8453')
            const c = await goster('swap', kurBase)
            expect(c.s.deliveryChains.map((x) => x.chainId)).toEqual([8453])
            expect(var_(c.html, 'no-chain-open')).toBe(false)
            c.s.amount = '25'
            expect(c.s.quoteEligible).toBe(true)
        })

        it('no-chain-open: SEND ve FUND listeleri bos ise swap ve bridge not gosterir, cip ve tahmini tutar yok, teklif yok', async () => {
            vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '')
            vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
            for (const mode of ['swap', 'bridge']) {
                const { html, s, sent } = await goster(mode, KUR[mode])
                expect(var_(html, 'no-chain-open'), mode).toBe(true)
                for (const id of ['delivery-chip', 'estimate', 'calc-pill']) expect(var_(html, id), `${mode} ${id}`).toBe(false)
                s.amount = '25'
                expect(s.quoteEligible, mode).toBe(false)
                await quoteAl(s)
                expect(s.phase, mode).toBe('idle')
                expect(quoteler(sent), mode).toHaveLength(0)
            }
            // KONTROL: varsayilan ortamda ayni iki ekran not gostermez.
            vi.unstubAllEnvs()
            for (const mode of ['swap', 'bridge']) {
                const { html } = await goster(mode, KUR[mode])
                expect(var_(html, 'no-chain-open'), mode).toBe(false)
            }
        })

        it('no-chain-open: FUND degismezi ihlali (flags.sendSources = [56]) swap ve bridge icin listeyi bosaltir', async () => {
            flags.sendSources = [56]
            for (const mode of ['swap', 'bridge']) {
                const { html, s } = await goster(mode, KUR[mode])
                expect(s.deliveryChains, mode).toEqual([])
                expect(var_(html, 'no-chain-open'), mode).toBe(true)
            }
            // KONTROL: tablo gercekken ayni ekranlar bos olmayan liste verir.
            flags.sendSources = null
            for (const mode of ['swap', 'bridge']) {
                const { html, s } = await goster(mode, KUR[mode])
                expect(s.deliveryChains.length, mode).toBeGreaterThan(0)
                expect(var_(html, 'no-chain-open'), mode).toBe(false)
            }
        })

        it('kaynak listesi: swap yalniz Takas aglarini (14 cift), bridge ve send tum Gonder aglarini (19 cift) sunar', async () => {
            const swap = (await ready('swap')).s
            const bridge = (await ready('bridge')).s
            const send = (await ready('send')).s
            expect(swap.sourceChains.map((c) => Number(c.chainId))).toEqual([1, 10, 8453, 42161, 137])
            expect(swap.sourcePairList).toHaveLength(14)
            expect(bridge.sourcePairList).toHaveLength(19)
            expect(send.sourcePairList).toHaveLength(19)
            for (const id of [56, 100, 42220, 5000, 25]) expect(swap.sourcePairList.some((p) => Number(p.chainId) === id), String(id)).toBe(false)
            expect(swap.sourcePairList.map((p) => p.key)).toContain('1:USDC')
        })
    })

    describe('odeyen Gizli Hesap', () => {
        it('odeyen: ATS kisa kutusunda swap ve bridge baglanti uyarisini cizer, fund cizmez', async () => {
            for (const mode of ['fund', 'send', 'swap', 'bridge']) {
                const { html, s } = await goster(mode, (x) => { KUR[mode]?.(x); atsKur({ balance: 0 })(x) })
                expect(s.atsState, mode).toBe('short')
                expect(var_(html, 'ats-short-box'), `${mode} kutu`).toBe(true)
                expect(var_(html, 'private-ats-link-warning'), `${mode} uyari`).toBe(mode !== 'fund')
            }
        })

        it('odeyen: satis bayragi acikken swap ve bridge "Buy ATS" dugmesi, kapaliyken privacy.atsSale.blocked metni; fund her zaman blocked', async () => {
            const kur = (mode) => (x) => { KUR[mode]?.(x); atsKur({ balance: 0 })(x) }
            satis.flag = true
            for (const mode of ['swap', 'bridge', 'send']) {
                const { html } = await goster(mode, kur(mode))
                expect(html, mode).toContain(DUGME)
                expect(html, mode).not.toContain(BLOCKED)
            }
            const fund = await goster('fund', kur('fund'))
            expect(fund.html).toContain(BLOCKED)
            expect(fund.html).not.toContain(DUGME)
            satis.flag = false
            for (const mode of ['swap', 'bridge']) {
                const { html } = await goster(mode, kur(mode))
                expect(html, mode).toContain(BLOCKED)
                expect(html, mode).not.toContain(DUGME)
            }
        })

        it('odeyen: kurulum notu swap ve bridge icin atsSetupSend metnini gosterir, fund icin atsSetupFund', async () => {
            const decision = resolveAtsBlocker('src-allowance-missing')
            for (const mode of ['swap', 'bridge']) {
                const { html } = await goster(mode, (x) => { KUR[mode](x); atsKur({ ready: false, decision })(x) })
                expect(var_(html, 'ats-setup-note'), mode).toBe(true)
                expect(html, mode).toContain(SETUP_SEND)
                expect(html, mode).not.toContain(SETUP_FUND)
            }
            const fund = await goster('fund', atsKur({ ready: false, decision }))
            expect(var_(fund.html, 'ats-setup-note')).toBe(true)
            expect(fund.html).toContain(SETUP_FUND)
            expect(fund.html).not.toContain(SETUP_SEND)
        })

        it('PrivateFeeCard\'a :mode="mode" gecilir (kaynak)', () => {
            const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
            expect(kod).toMatch(/<PrivateFeeCard\s+:mode="mode"/)
        })

        it('"?" dugmesi swap ve bridge\'de var, aria-label "How does it work?" ve infoOpen baslangicta kapali', async () => {
            for (const mode of ['swap', 'bridge']) {
                const { html, s } = await goster(mode, KUR[mode])
                const tag = etiket(html, 'info-button')
                expect(tag, mode).toMatch(/^<button/)
                expect(tag, mode).toContain(`aria-label="${EN('howTitle')}"`)
                expect(s.infoOpen, mode).toBe(false)
            }
        })
    })

    describe('teslim tokeni deliverable suzgeci', () => {
        it('defaultTokenOn: swap ve bridge\'de yerel coin Gonder kaynagi degilse agin USDC\'sine doner; send\'de yerel coin kalir', async () => {
            for (const mode of ['swap', 'bridge', 'fund']) {
                const { s } = await ready(mode)
                expect(s.defaultTokenOn(137), mode).toEqual(usdcTokenOf(137))
                expect(s.defaultTokenOn(100), mode).toEqual(usdcTokenOf(100))
                // Ethereum'da ETH bir Gonder kaynagidir: yerel coin kalir.
                expect(s.defaultTokenOn(1), mode).toEqual(nativeTokenOf(1))
                expect(s.defaultTokenOn(56), mode).toEqual(usdcTokenOf(56))
            }
            // Pozitif kontrol: Gonder'de (alici dis adres) suzme yok, POL kalir.
            const send = await ready('send')
            expect(send.s.defaultTokenOn(137)).toEqual(nativeTokenOf(137))
        })

        it('deliveryChainId kurucusu: bridge\'de Polygon secilince USDC, send\'de POL', async () => {
            const bridge = await ready('bridge')
            KUR.bridge(bridge.s)
            bridge.s.deliveryChainId = 137
            expect(bridge.s.outputToken).toEqual(usdcTokenOf(137))
            const send = await ready('send')
            send.s.deliveryChainId = 137
            expect(send.s.outputToken).toEqual(nativeTokenOf(137))
        })
    })

    describe('onaydan sonra Gizli islemlere gecis', () => {
        it('onay: PRIVATE_QUOTE alicisi Gizli Hesap, PRIVATE_ORDER yalniz { ticket, gas: \'ats\', atsQuoted }, ekran Gizli islemlere gecer', async () => {
            const BEKLENEN = {
                swap: { sourceChainId: 1, outputToken: { chainId: 1, symbol: 'USDT' } },
                bridge: { sourceChainId: 56, outputToken: { chainId: 1, symbol: 'ETH' } },
            }
            for (const mode of ['swap', 'bridge']) {
                const { s, sent } = await teklifli(mode)
                expect(sent[0], mode).toMatchObject({
                    type: 'PRIVATE_QUOTE',
                    message: { sourceAccountKey: 'g-1', outputAddress: GIZLI, payoutUsdc: '25', sourceChainId: BEKLENEN[mode].sourceChainId, sourceAsset: 'USDC', outputToken: BEKLENEN[mode].outputToken },
                })
                await s.confirm()
                expect(sent[1], mode).toEqual({ type: 'PRIVATE_ORDER', message: { ticket: '0xt', gas: 'ats', atsQuoted: { transferFee: 19.7, commissionFee: 0 } } })
                expect(pageStore().currentPage, mode).toBe('home')
                expect(pageStore().homeTab, mode).toBe('private')
                expect(pageStore().ordersNotice, mode).toBeNull()
                expect(s.quote, mode).toBeNull()
                expect(s.error, mode).toBe('')
            }
        })

        it('onay: swap ve bridge alici kaydi (sent_recipients) yazmaz; send yazar (pozitif kontrol)', async () => {
            for (const mode of ['swap', 'bridge']) {
                const { s, sent, stub } = await teklifli(mode)
                await s.confirm()
                expect(orders(sent), mode).toHaveLength(1)
                expect(stub.localStore.sent_recipients, mode).toBeUndefined()
            }
            // Pozitif kontrol: Gonder ayni akista aliciyi gizli tarafa yazar.
            const send = await ready('send')
            send.s.recipient = STRANGER
            send.s.amount = '12'
            await quoteAl(send.s)
            expect(send.s.quote).toBeTruthy()
            await send.s.confirm()
            expect(send.stub.localStore.sent_recipients).toHaveLength(1)
            expect(send.stub.localStore.sent_recipients[0]).toMatchObject({ address: STRANGER, private: true })
        })

        it('onay: swap ve bridge imported_tokens\'a dokunmaz (FU11 ikizi)', async () => {
            for (const mode of ['swap', 'bridge']) {
                const { s, sent, stub } = await ready(mode)
                stub.localStore.imported_tokens = { 'g-1': { 1: [], 56: [] }, 'a-1': { 56: [] } }
                const onceki = JSON.stringify(stub.localStore.imported_tokens)
                KUR[mode](s)
                s.amount = '25'
                await quoteAl(s)
                expect(s.quote, mode).toBeTruthy()
                await s.confirm()
                expect(JSON.stringify(stub.localStore.imported_tokens), mode).toBe(onceki)
                expect(orders(sent), mode).toHaveLength(1)
                expect(pageStore().currentPage, mode).toBe('home')
            }
        })

        it('onay: PRIVATE_ORDER cevapsiz (sendMessage firlatir) swap ve bridge icin notla Gizli islemlere gider, ayni bilet tekrar gitmez', async () => {
            const reply = async (m) => { if (m.type === 'PRIVATE_QUOTE') return quoteOk(m); throw new Error('sw yeniden basliyor') }
            for (const mode of ['swap', 'bridge']) {
                const { s, sent } = await teklifli(mode, { reply })
                await s.confirm()
                expect(pageStore().currentPage, mode).toBe('home')
                expect(pageStore().homeTab, mode).toBe('private')
                expect(pageStore().ordersNotice, mode).toBe('privacy.orders.unconfirmedNotice')
                expect(s.error, mode).toBe('')
                expect(s.busy, mode).toBe(false)
                expect(s.quote, mode).toBeNull()
                await s.confirm()
                expect(orders(sent), mode).toHaveLength(1)
            }
        })

        it('onay: kullanici baska ekrandaysa ZORLA donulmez; ekranin rotasi moda ozgudur', async () => {
            // Baska ekranda: siparis gider, sayfa yerinde kalir.
            for (const mode of ['swap', 'bridge']) {
                const { s, sent } = await teklifli(mode)
                pageStore().currentPage = 'settings'
                await s.confirm()
                expect(orders(sent), mode).toHaveLength(1)
                expect(pageStore().currentPage, mode).toBe('settings')
            }
            // Rota moda ozgudur: swap ekrani bridge rotasinda, bridge ekrani swap rotasinda ZORLA gecis yapmaz.
            for (const [mode, baska] of [['swap', 'private_bridge'], ['bridge', 'private_swap']]) {
                const { s, sent } = await teklifli(mode)
                pageStore().currentPage = baska
                await s.confirm()
                expect(orders(sent), mode).toHaveLength(1)
                expect(pageStore().currentPage, mode).toBe(baska)
            }
        })
    })
})

// TAKAS/KOPRU II (Task 6): baslangic cifti (defaultSelfSource), teslim tokenini kaynaga baglayan TEK islev (fitDeliveryToSource), quoteEligible
// arka kapilari ve Takas'ta ayni-varlik korumasi. SSR'da izleyici yok: kaynak secimi s.onPickSourcePair('<ag>:<varlik>') ile taklit edilir;
// capture geri cagrisi setup'tan SONRA calisir, orada yazilan durum fitDeliveryToSource'u yeniden calistirmaz.
describe('Takas/Kopru: baslangic cifti, teslim baglama ve ayni-varlik korumasi', () => {
    afterEach(() => { vi.unstubAllEnvs() })
    const STRANGER_ADR = '0x' + '7'.repeat(40)
    const CAKE = { chainId: 56, address: getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'), symbol: 'CAKE', decimals: 18 }
    const USDCE_137 = { chainId: 137, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 }
    const notVar = (html, id) => !yorumsuzHtml(html).includes('data-testid="' + id + '"')
    const kotas = (sent) => sent.filter((m) => m.type === 'PRIVATE_QUOTE')
    const sec = (s) => Number(s.chainId)

    // ilk boyama
    it('swap: ilk boyamada kaynak Ethereum USDC, teslim ayni agda USDT, not ve no-chain-open yok', async () => {
        const { html, s } = await goster('swap')
        expect(s.startPair).toEqual({ chainId: 1, asset: 'USDC' })
        expect([s.chainId, s.asset]).toEqual([1, 'USDC'])
        expect(s.outputToken).toEqual(selfDeliveryTokenOf(1, 'USDT'))
        expect(s.outputToken.chainId).toBe(1)
        expect(s.outputToken.symbol).toBe('USDT')
        expect(privateFundDeliverable(s.outputToken)).toBe(true)
        expect(s.routeOk).toBe(true)
        expect(s.sameAsSource).toBe(false)
        expect(s.deliveryChains.map((c) => c.chainId)).toEqual([1])
        expect(notVar(html, 'same-asset-note')).toBe(true)
        expect(notVar(html, 'no-chain-open')).toBe(true)
    })

    it('bridge: ilk boyamada kaynak BSC USDC, teslim Ethereum yerel ETH, teslim aglari kaynagi icermez', async () => {
        const { html, s } = await goster('bridge')
        expect(s.startPair).toEqual({ chainId: 56, asset: 'USDC' })
        expect([s.chainId, s.asset]).toEqual([56, 'USDC'])
        expect(s.outputToken).toEqual(nativeTokenOf(1))
        expect(s.outputToken.chainId).not.toBe(sec(s))
        expect(s.routeOk).toBe(true)
        expect(s.deliveryChains.map((c) => c.chainId)).not.toContain(56)
        expect(notVar(html, 'no-chain-open')).toBe(true)
    })

    it('fund ve send: baslangic cifti BSC USDC ve teslim BSC USDC kalir', async () => {
        for (const mode of ['fund', 'send']) {
            const { s } = await goster(mode)
            expect([s.chainId, s.asset], mode).toEqual([56, 'USDC'])
            expect(s.outputToken, mode).toEqual(usdcTokenOf(56))
        }
    })

    // teslim cipinin logosu (TEK cozucu privateTokenLogo: paketlenmis yerel logo (chainId, adres) ile bulunur, uzak logo asla istenmez; yerel logo anahtarindan bagimsiz)
    it('swap: varsayilan Takas teslimi (Ethereum USDT) paketlenmis USDT logosunu gosterir, gri yer tutucuyu degil', async () => {
        const PAKETLI_USDT = '/tokens/1/0xdac17f958d2ee523a2206206994597c13d831ec7.png'
        const { html, s } = await goster('swap')
        expect(s.outputToken).toEqual(selfDeliveryTokenOf(1, 'USDT'))
        // Beklenen yol modulden de turetilir: sabit dizge ile modul ayrisirsa test hangisinin yanlis oldugunu soyler.
        expect(localTokenLogoPath(s.outputToken.chainId, s.outputToken.address)).toBe(PAKETLI_USDT)
        expect(cipLogosu(html, 'delivery-chip')).toBe(PAKETLI_USDT)

        // Ikinci paketli ornek: Polygon USDC kaynagi secilince teslim Polygon USDT olur, onun da paketlenmis logosu vardir.
        const polygon = await ready('swap')
        polygon.s.onPickSourcePair('137:USDC')
        expect(polygon.s.outputToken).toEqual(selfDeliveryTokenOf(137, 'USDT'))
        expect(localTokenLogoPath(137, polygon.s.outputToken.address)).toBe('/tokens/137/0xc2132d05d31c914a87c6611c10748aeb04b58e8f.png')
        expect(polygon.s.outputLogoSrc).toBe('/tokens/137/0xc2132d05d31c914a87c6611c10748aeb04b58e8f.png')

        // Yerel logo anahtari acik olsa da ayni yol: gizli bilesen logoyu anahtara bakmadan paketli dosyadan alir.
        setLocalLogosOnly(true)
        const acik = await goster('swap')
        expect(cipLogosu(acik.html, 'delivery-chip')).toBe(PAKETLI_USDT)
    })

    it('fund, send ve bridge: yerel logo modunda teslim cipi USDC / USDC / yerel coin logosunda kalir (degismedi)', async () => {
        setLocalLogosOnly(true)
        for (const mode of ['fund', 'send']) {
            const { html } = await goster(mode)
            expect(cipLogosu(html, 'delivery-chip'), mode).toBe(USDC_LOGO)
        }
        const bridge = await goster('bridge')
        expect(bridge.s.outputToken).toEqual(nativeTokenOf(1))
        expect(cipLogosu(bridge.html, 'delivery-chip')).toBe(chainLogo(1, null))
    })

    // swap: kaynak secimi teslimi baglar
    it('swap: Polygon USDC kaynak secilince teslim Polygon USDT olur', async () => {
        const { s } = await ready('swap')
        s.onPickSourcePair('137:USDC')
        expect(s.outputToken).toEqual(selfDeliveryTokenOf(137, 'USDT'))
        expect(s.outputToken.chainId).toBe(137)
        expect(s.outputToken.symbol).toBe('USDT')
        expect(s.routeOk).toBe(true)
    })

    it('swap: Base ETH kaynak secilince teslim Base USDC olur', async () => {
        const { s } = await ready('swap')
        s.onPickSourcePair('8453:ETH')
        expect(s.outputToken).toEqual(usdcTokenOf(8453))
        expect(s.sameAsSource).toBe(false)
    })

    it('swap: teslim kaynak varligin kendisi olacaksa ayni agdaki ilk hedefe doner', async () => {
        const { s } = await ready('swap')
        s.onPickSourcePair('1:USDT')
        expect(s.outputToken).toEqual(selfDeliveryTokenOf(1, 'USDC'))
        expect(s.sameAsSource).toBe(false)
        s.outputToken = nativeTokenOf(1)
        s.onPickSourcePair('1:ETH')
        expect(s.outputToken).toEqual(selfDeliveryTokenOf(1, 'USDC'))
    })

    it('swap: ayni agda gecerli kullanici secimi kaynak varligi degisince korunur', async () => {
        const { s } = await ready('swap')
        const dai = selfDeliveryTokenOf(1, 'DAI')
        s.onPickToken(dai)
        const onceki = s.outputToken
        s.onPickSourcePair('1:ETH')
        expect(s.outputToken).toBe(onceki)
        expect(s.outputToken.symbol).toBe('DAI')
        s.onPickSourcePair('1:USDC')
        expect(s.outputToken).toBe(onceki)
    })

    it('swap: baska agdaki kullanici secimi yeni kaynak agina gore yenilenir', async () => {
        const { s } = await ready('swap')
        s.onPickToken(selfDeliveryTokenOf(1, 'DAI'))
        s.onPickSourcePair('137:USDC')
        expect(s.outputToken).toEqual(selfDeliveryTokenOf(137, 'USDT'))
    })

    it('swap: butun kaynak ciftlerinde teslim ayni agda, kaynaktan farkli ve teslim edilebilir', async () => {
        const { s } = await ready('swap')
        const anahtarlar = s.sourcePairOptions.map((o) => o.key)
        expect(anahtarlar).toHaveLength(14)
        for (const key of anahtarlar) {
            s.onPickSourcePair(key)
            expect(Number(s.outputToken.chainId) === Number(s.chainId), key).toBe(true)
            expect(s.routeOk, key).toBe(true)
            expect(s.sameAsSource, key).toBe(false)
            expect(privateFundDeliverable(s.outputToken), key).toBe(true)
        }
    })

    // bridge: kaynak secimi teslimi baglar
    it('bridge: butun kaynak ciftlerinde teslim kaynak agindan farkli, acik ve teslim edilebilir', async () => {
        const { s } = await ready('bridge')
        const anahtarlar = s.sourcePairOptions.map((o) => o.key)
        expect(anahtarlar).toHaveLength(19)
        for (const key of anahtarlar) {
            s.onPickSourcePair(key)
            expect(Number(s.outputToken.chainId) !== Number(s.chainId), key).toBe(true)
            expect(s.routeOk, key).toBe(true)
            expect(privateFundDeliverable(s.outputToken), key).toBe(true)
            expect(s.sameAsSource, key).toBe(false)
        }
    })

    it('bridge: teslim kaynak agina denk gelince bir sonraki acik aga tasinir', async () => {
        const { s } = await ready('bridge')
        // Baslangic hali (56:USDC -> yerel ETH@1) ACIKCA yazilir: yer tutucu cikti zaten BSC USDC oldugundan test aksi halde bos gecerdi.
        s.outputToken = nativeTokenOf(1)
        s.onPickSourcePair('1:ETH')
        expect(s.outputToken).toEqual(usdcTokenOf(56))
        expect(s.deliveryChains.map((c) => c.chainId)).toContain(s.outputToken.chainId)
    })

    it('bridge: ayni agda varlik degisikligi gecerli kullanici secimini korur', async () => {
        const { s } = await ready('bridge')
        s.onPickSourcePair('1:USDC')
        s.onPickToken(usdcTokenOf(8453))
        const onceki = s.outputToken
        s.onPickSourcePair('1:ETH')
        expect(s.outputToken).toBe(onceki)
        expect(s.outputToken.chainId).toBe(8453)
    })

    it('bridge: acik teslim agi kalmayinca teslim degismez ve no-chain-open gorunur', async () => {
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        const { html, s } = await goster('bridge')
        expect(s.deliveryChains).toEqual([])
        expect(yorumsuzHtml(html)).toContain('data-testid="no-chain-open"')
        expect(s.outputToken).toEqual(usdcTokenOf(56))
        const onceki = s.outputToken
        s.onPickSourcePair('56:USDC')
        expect(s.outputToken).toBe(onceki)
        s.amount = '15'
        expect(s.quoteEligible).toBe(false)
    })

    // fund ve send: kaynak secimi teslimi degistirmez
    it('fund ve send: kaynak cifti secimi teslim tokenini degistirmez', async () => {
        expect(flags.bridged).toBe(true)
        for (const mode of ['fund', 'send']) {
            const { s } = await ready(mode)
            const onceki = s.outputToken
            const hedef = s.sourcePairOptions.find((o) => o.key !== '56:USDC')
            expect(hedef, mode).toBeTruthy()
            s.onPickSourcePair(hedef.key)
            expect(s.outputToken, mode).toBe(onceki)
        }
    })

    // quoteEligible arka kapilari (yalniz swap ve bridge)
    it('swap: eski BSC teslimi (kaynak 1:ETH) teklifi engeller', async () => {
        const { s, sent } = await goster('swap', (x) => { x.chainId = 1; x.asset = 'ETH'; x.outputToken = usdcTokenOf(56) })
        s.amount = '15'
        expect(s.routeOk).toBe(false)
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(kotas(sent)).toHaveLength(0)
    })

    it('bridge: teslim kaynak agindaysa teklif istenmez', async () => {
        const { s, sent } = await goster('bridge', (x) => { x.outputToken = usdcTokenOf(56) })
        expect([s.chainId, s.asset]).toEqual([56, 'USDC'])
        s.amount = '15'
        expect(s.routeOk).toBe(false)
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(kotas(sent)).toHaveLength(0)
    })

    it('swap ve bridge: teslim edilemeyen token (Polygon POL) teklifi engeller, fund ve send engellemez', async () => {
        const swap = await goster('swap', (x) => { x.chainId = 137; x.asset = 'USDC'; x.outputToken = nativeTokenOf(137) })
        swap.s.amount = '15'
        expect(swap.s.routeOk).toBe(true)
        expect(privateFundDeliverable(swap.s.outputToken)).toBe(false)
        expect(swap.s.quoteEligible).toBe(false)
        await quoteAl(swap.s)
        expect(kotas(swap.sent)).toHaveLength(0)

        const bridge = await goster('bridge', (x) => { x.outputToken = nativeTokenOf(137) })
        bridge.s.amount = '15'
        expect(bridge.s.routeOk).toBe(true)
        expect(privateFundDeliverable(bridge.s.outputToken)).toBe(false)
        expect(bridge.s.quoteEligible).toBe(false)
        await quoteAl(bridge.s)
        expect(kotas(bridge.sent)).toHaveLength(0)

        // Pozitif kontrol (FU11): Para yukle ve Gonder'de teslim edilemeyen/kaynak olmayan token teklifi ENGELLEMEZ.
        for (const mode of ['fund', 'send']) {
            const { s } = await ready(mode)
            if (mode === 'send') s.recipient = STRANGER_ADR
            s.onPickToken(CAKE)
            s.amount = mode === 'send' ? '12' : '25'
            expect(s.quoteEligible, mode).toBe(true)
        }
    })

    it('swap ve bridge: oturmus varsayilan durumda tutar girilince teklif uygundur ve PRIVATE_QUOTE gider', async () => {
        const BEKLENEN = {
            swap: { sourceChainId: 1, sourceAsset: 'USDC', outputChainId: 1, outputSymbol: 'USDT' },
            bridge: { sourceChainId: 56, sourceAsset: 'USDC', outputChainId: 1, outputSymbol: 'ETH' },
        }
        for (const mode of ['swap', 'bridge']) {
            const { s, sent } = await ready(mode)
            s.amount = '15'
            expect(s.quoteEligible, mode).toBe(true)
            await quoteAl(s)
            const q = kotas(sent)
            expect(q, mode).toHaveLength(1)
            const b = BEKLENEN[mode]
            expect(q[0].message.outputAddress, mode).toBe(GIZLI)
            expect(q[0].message.sourceAccountKey, mode).toBe('g-1')
            expect(q[0].message.sourceChainId, mode).toBe(b.sourceChainId)
            expect(q[0].message.sourceAsset, mode).toBe(b.sourceAsset)
            expect(q[0].message.outputToken.chainId, mode).toBe(b.outputChainId)
            expect(q[0].message.outputToken.symbol, mode).toBe(b.outputSymbol)
        }
    })

    // ayni-varlik korumasi (yalniz Takas, kimlik = zincir + adres)
    it('swap: ayni sozlesme baska liste sembolu altinda da ayni varlik sayilir ve engellenir', async () => {
        const { html, s, sent } = await goster('swap', (x) => {
            x.chainId = 137
            x.asset = 'USDT'
            x.outputToken = { chainId: 137, address: sourceAssetAddress(137, 'USDT'), symbol: 'USDT0', decimals: 6 }
        })
        expect(privateFundDeliverable(s.outputToken)).toBe(true)
        expect(s.sameAsSource).toBe(true)
        expect(yorumsuzHtml(html)).toContain('data-testid="same-asset-note"')
        expect(yorumsuzHtml(html)).toContain(EN('sameAssetNote'))
        s.amount = '15'
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(kotas(sent)).toHaveLength(0)
    })

    it('swap: teslim adresi kucuk harfli ya da buyuk harfli (checksum degil) yazilsa da ayni varlik sayilir ve engellenir (R6)', async () => {
        // Kimlik karsilastirmasi kucuk harfe indirilerek yapilir: secici /getChainTokens listesindeki adresi sunucunun yazimiyla verir (checksum olmak zorunda degil).
        const kaynak = usdcTokenOf(1)
        const kucuk = { ...kaynak, address: kaynak.address.toLowerCase() }
        const buyuk = { ...kaynak, address: '0x' + kaynak.address.slice(2).toUpperCase() }
        // Olumlu kontrol: iki yazim da checksum yazimindan gercekten FARKLI (aksi halde test bos gecerdi).
        expect(kucuk.address).not.toBe(kaynak.address)
        expect(buyuk.address).not.toBe(kaynak.address)
        expect(kucuk.address).not.toBe(buyuk.address)
        for (const cikti of [kucuk, buyuk]) {
            const { s, sent } = await goster('swap', (x) => { x.chainId = 1; x.asset = 'USDC'; x.outputToken = cikti })
            expect(s.sameAsSource, cikti.address).toBe(true)
            s.amount = '15'
            expect(s.quoteEligible, cikti.address).toBe(false)
            await quoteAl(s)
            expect(kotas(sent), cikti.address).toHaveLength(0)
        }
    })

    it('swap: ayni sembol baska adreste ayni varlik degildir ama teslim edilemez oldugu icin yine engellenir', async () => {
        const { html, s, sent } = await goster('swap', (x) => { x.chainId = 137; x.asset = 'USDC'; x.outputToken = USDCE_137 })
        expect(s.sameAsSource).toBe(false)
        expect(notVar(html, 'same-asset-note')).toBe(true)
        expect(privateFundDeliverable(s.outputToken)).toBe(false)
        s.amount = '15'
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(kotas(sent)).toHaveLength(0)
    })

    it('swap: yerel coin ayni varlik: kaynak 1:ETH ve teslim yerel ETH engellenir', async () => {
        const { html, s, sent } = await goster('swap', (x) => { x.chainId = 1; x.asset = 'ETH'; x.outputToken = nativeTokenOf(1) })
        expect(s.sameAsSource).toBe(true)
        expect(yorumsuzHtml(html)).toContain('data-testid="same-asset-note"')
        s.amount = '15'
        expect(s.quoteEligible).toBe(false)
        await quoteAl(s)
        expect(kotas(sent)).toHaveLength(0)
    })

    it('swap: zincir kimligi dizge olsa da (s.chainId = \'1\') ayni varlik engellenir', async () => {
        const { s } = await goster('swap', (x) => { x.chainId = '1'; x.asset = 'ETH'; x.outputToken = nativeTokenOf(1) })
        expect(s.sameAsSource).toBe(true)
        s.amount = '15'
        expect(s.quoteEligible).toBe(false)
    })

    it('swap: kullanici kaynak varligi teslim olarak secince not cikar ve teklif gitmez, baska teslim secince gider', async () => {
        const a = await goster('swap', (x) => { x.onPickToken(usdcTokenOf(1)) })
        expect(a.s.sameAsSource).toBe(true)
        expect(yorumsuzHtml(a.html)).toContain('data-testid="same-asset-note"')
        a.s.amount = '15'
        await quoteAl(a.s)
        expect(kotas(a.sent)).toHaveLength(0)

        // Ikiz: ayni akis, kullanici baska bir teslim tokeni secince teklif gider.
        const b = await ready('swap')
        b.s.onPickToken(usdcTokenOf(1))
        b.s.onPickToken(selfDeliveryTokenOf(1, 'USDT'))
        b.s.amount = '15'
        await quoteAl(b.s)
        expect(kotas(b.sent)).toHaveLength(1)
    })

    it('bridge: ayni-varlik notu hic cikmaz (ayni sembol baska agda ve ayni ag dahil)', async () => {
        const a = await goster('bridge', (x) => { x.outputToken = usdcTokenOf(1) })
        expect(a.s.sameAsSource).toBe(false)
        expect(notVar(a.html, 'same-asset-note')).toBe(true)
        const b = await goster('bridge', (x) => { x.outputToken = usdcTokenOf(56) })
        expect(b.s.sameAsSource).toBe(false)
        expect(notVar(b.html, 'same-asset-note')).toBe(true)
        b.s.amount = '15'
        expect(b.s.quoteEligible).toBe(false)
    })

    it('fund ve send: ayni-varlik notu yok ve varsayilan teklif uygun', async () => {
        const fund = await goster('fund')
        expect(notVar(fund.html, 'same-asset-note')).toBe(true)
        fund.s.amount = '25'
        expect(fund.s.quoteEligible).toBe(true)
        const send = await goster('send', (x) => { x.recipient = STRANGER_ADR })
        expect(notVar(send.html, 'same-asset-note')).toBe(true)
        send.s.amount = '12'
        expect(send.s.quoteEligible).toBe(true)
    })

    // varsayilan durumda gezinme
    it.each(['swap', 'bridge'])('swap ve bridge: baslangic durumunda tutar girip onaylayinca Gizli islemlere gidilir', async (mode) => {
        const { s, sent } = await ready(mode)
        s.amount = '25'
        await quoteAl(s)
        expect(s.quote, mode).toBeTruthy()
        await s.confirm()
        expect(pageStore().currentPage, mode).toBe('home')
        expect(pageStore().homeTab, mode).toBe('private')
        expect(sent.filter((m) => m.type === 'PRIVATE_ORDER'), mode).toHaveLength(1)
    })

    // fitDeliveryToSource: gecerlilik teriminin ve aday-yok yolunun kilitleri
    it('swap: ayni agda teslim edilemeyen teslim (Polygon POL) yeni kaynak secilince teslim edilebilir hedefe cekilir', async () => {
        const { s } = await ready('swap')
        s.onPickSourcePair('137:USDC')
        s.outputToken = nativeTokenOf(137)
        expect(s.routeOk).toBe(true)
        expect(s.sameAsSource).toBe(false)
        expect(privateFundDeliverable(s.outputToken)).toBe(false)
        s.onPickSourcePair('137:USDT')
        expect(s.outputToken).toEqual(selfDeliveryTokenOf(137, 'USDC'))
        expect(privateFundDeliverable(s.outputToken)).toBe(true)
    })

    it('bridge: baska agdaki teslim edilemeyen teslim (Polygon POL) yeni kaynak secilince ilk acik agin varsayilanina cekilir', async () => {
        const { s } = await ready('bridge')
        s.outputToken = nativeTokenOf(137)
        expect(s.routeOk).toBe(true)
        expect(privateFundDeliverable(s.outputToken)).toBe(false)
        s.onPickSourcePair('1:USDC')
        expect(s.outputToken).toEqual(usdcTokenOf(56))
    })

    it('swap: Takas hedefi yoksa (Para yukle listesi yalniz 56) teslim degismez, ayni-varlik notu cikar, teklif istenmez', async () => {
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        const { html, s } = await goster('swap')
        expect([s.chainId, s.asset]).toEqual([56, 'USDC'])
        expect(s.outputToken).toEqual(usdcTokenOf(56))
        expect(s.sameAsSource).toBe(true)
        expect(yorumsuzHtml(html)).toContain('data-testid="same-asset-note"')
        s.amount = '15'
        expect(s.quoteEligible).toBe(false)
    })
})

// Token sayfasindan gelen bir kerelik on secim (Task 8): MOUNT() Pinia'yi kurar, bu yuzden deger mount()'tan SONRA yazilir;
// once yazilsaydi atilan bir Pinia'ya gider ve "alan null" iddialari bos yere gecerdi.
describe("Token on secimi: pageStore().privateSwapSource (setup'ta tuketilir)", () => {
    async function onSecimleAc(mode, seed, opts) {
        const m = mount(mode, opts)
        pageStore().privateSwapSource = seed
        await render(m.app)
        await flush()
        return { ...m, s: m.captured.instance.setupState }
    }
    const SIFIR_ADRES = '0x0000000000000000000000000000000000000000'

    it('swap: gecerli on secim {137,USDC} kaynagi kurar, cikti ayni agda ve alan null a doner', async () => {
        const { s } = await onSecimleAc('swap', { chainId: 137, asset: 'USDC' })
        expect(s.chainId).toBe(137)
        expect(s.asset).toBe('USDC')
        expect(s.sourceKeyPair).toBe('137:USDC')
        expect(s.outputToken.chainId).toBe(137)
        expect(s.outputToken.symbol).toBe('USDT')
        expect(s.deliveryChains.map((c) => c.chainId)).toEqual([137])
        expect(pageStore().privateSwapSource).toBeNull()
    })

    it('swap: Base USDC {8453,USDC} on secimi ETH cikti verir (Base teslim varliklari USDC ve ETH)', async () => {
        const { s } = await onSecimleAc('swap', { chainId: 8453, asset: 'USDC' })
        expect(s.chainId).toBe(8453)
        expect(s.asset).toBe('USDC')
        expect(s.outputToken.chainId).toBe(8453)
        expect(s.outputToken.symbol).toBe('ETH')
        expect(s.outputToken.address).toBe(SIFIR_ADRES)
        expect(s.sameAsSource).toBe(false)
        expect(s.deliveryChains.map((c) => c.chainId)).toEqual([8453])
        expect(pageStore().privateSwapSource).toBeNull()
    })

    it('swap: {1,ETH} on secimi: cikti 1 aginda ve kaynakla ayni degil (sifir adres degil)', async () => {
        const { s } = await onSecimleAc('swap', { chainId: 1, asset: 'ETH' })
        expect(s.sourceKeyPair).toBe('1:ETH')
        expect(s.outputToken.chainId).toBe(1)
        expect(s.outputToken.address.toLowerCase()).not.toBe(SIFIR_ADRES)
        expect(s.sameAsSource).toBe(false)
        expect(pageStore().privateSwapSource).toBeNull()
    })

    it('bridge: gecerli on secim {1,ETH} kaynagi kurar, cikti baska agda', async () => {
        const { s } = await onSecimleAc('bridge', { chainId: 1, asset: 'ETH' })
        expect(s.sourceKeyPair).toBe('1:ETH')
        expect(s.outputToken.chainId).not.toBe(1)
        const ids = s.deliveryChains.map((c) => c.chainId)
        expect(ids).not.toContain(1)
        expect(ids).toContain(s.outputToken.chainId)
        expect(pageStore().privateSwapSource).toBeNull()
    })

    it('bridge: Takas cifti olmayan {100,USDC} de gecerlidir (Kopru tum kaynak ciftlerini kabul eder)', async () => {
        const { s } = await onSecimleAc('bridge', { chainId: 100, asset: 'USDC' })
        expect(s.sourceKeyPair).toBe('100:USDC')
        expect(s.outputToken.chainId).not.toBe(100)
        expect(pageStore().privateSwapSource).toBeNull()
    })

    it.each([[100], [56]])('swap: Takas cifti olmayan {%i,USDC} reddedilir: ilk gecerli Takas cifti (1:USDC), alan null', async (chainId) => {
        const { s } = await onSecimleAc('swap', { chainId, asset: 'USDC' })
        expect(s.sourceKeyPair).toBe('1:USDC')
        expect(s.outputToken.chainId).toBe(1)
        expect(s.outputToken.symbol).toBe('USDT')
        expect(pageStore().privateSwapSource).toBeNull()
    })

    describe.each([['swap', '1:USDC'], ['bridge', '56:USDC']])('%s on secim dogrulamasi', (mode, varsayilan) => {
        it.each([
            ['yabanci ag ve varlik', { chainId: 999, asset: 'FOO' }],
            ['bilinmeyen ag, bilinen varlik', { chainId: 999, asset: 'USDC' }],
            ['kucuk harfli varlik (kanonik degil)', { chainId: 137, asset: 'usdc' }],
            ['varlik yok', { chainId: 137 }],
            ['nesne degil', '1:USDC'],
        ])(mode + ': gecersiz on secim (%s) modun varsayilanini birakir ve alani temizler', async (_ad, seed) => {
            const { s } = await onSecimleAc(mode, seed)
            const [zincir, varlik] = varsayilan.split(':')
            expect(s.sourceKeyPair).toBe(varsayilan)
            expect(s.chainId).toBe(Number(zincir))
            expect(s.asset).toBe(varlik)
            expect(pageStore().privateSwapSource).toBeNull()
        })
    })

    it("koprulu kaynaklar kapaliyken (flags.bridged=false) on secim yok sayilir, varsayilan BSC USDC, alan yine temizlenir", async () => {
        flags.bridged = false
        for (const mode of ['swap', 'bridge']) {
            const { s } = await onSecimleAc(mode, { chainId: 137, asset: 'USDC' })
            expect(s.chainId, mode).toBe(56)
            expect(s.asset, mode).toBe('USDC')
            expect(pageStore().privateSwapSource, mode).toBeNull()
        }
    })

    it.each([['fund'], ['send']])('%s: privateSwapSource a dokunulmaz (ne okunur ne temizlenir)', async (mode) => {
        const { s } = await onSecimleAc(mode, { chainId: 137, asset: 'USDC' })
        expect(pageStore().privateSwapSource).toEqual({ chainId: 137, asset: 'USDC' })
        expect(s.chainId).toBe(56)
        expect(s.asset).toBe('USDC')
    })

    it("kaynak: on secim setup'ta okunur ve temizlenir, onMounted'ta degil", () => {
        const ham = readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8')
        const kod = yorumsuz(ham)
        expect(kod).toMatch(/const startPair = takeSelfSource\(\)/)
        const govde = blokGovdesi(ham, /function takeSelfSource\(\)/)
        expect(govde).not.toBeNull()
        expect(govde).toContain('page.privateSwapSource = null')
        expect(govde).toContain('defaultSelfSource(props.mode)')
        expect(govde).toContain('selfSourceChains(props.mode, LISTED_CHAINS)')
        const mounted = blokGovdesi(ham, /onMounted\(/)
        expect(mounted).not.toBeNull()
        expect(mounted).toContain('loadProviderInfo()')
        expect(mounted).not.toContain('privateSwapSource')
    })
})
