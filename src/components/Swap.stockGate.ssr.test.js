// KOK NEDEN / KAPATILAN HATA (spec 5.2, 5.11, 6.4; RF1): Swap ekrani hisse CIKTISINDA kapi aynasini gostermezse ya da
// kapi kapaliyken teklif istemeye / ana sayfaya donmeye devam ederse kullanici "takas gitti" sanar:
//  (1) kapi CIKTI tokenina bakar (Sat ve hisse olmayan cikti kapiyi HIC sormaz); kapi kapaliyken miktar girdisi ve yuzde
//      cipleri pasif; ana CTA etiketi nedeni soyler (sahip karari D3); K32: beyan yok, kapali kapida dugme HER ZAMAN PASIF,
//      etiket KISA nedeni soyler ve tiklama hicbir sey yapmaz (sayfa degismez, SWAP / SWAP_QUOTE gitmez);
//  (2) getSwapData / refreshAtsOpFee kapi kapaliyken ag istegi ATMAZ (acikken atar: pozitif bekci);
//  (3) arka plan kapisi SWAP'i `queued` yazmadan reddederse ({ error: 'STOCK_GATE:<NEDEN>' }) ekran ana sayfaya
//      GITMEZ, bant yeniden sorulur; baska yanitlarda bugunku kosulsuz ana sayfa korunur;
//  (4) RF1: hisse olmayan cikti secilince eski bir kapi karari ekrani KILITLEMEZ (ihracci kaynagi cikti tokenini izler,
//      hisse olmayan ciktida mesaj yok).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu kapi aynasi: gercek bakiye / kotasyon / TON agina ihtiyac yok (SwapBStock.ssr.test.js ile AYNI mock seti).
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))
// ATS dolar fiyati canli ag istegi atmasin (SwapRecvBalance.ssr.test.js ile AYNI mock).
vi.mock('../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return { useUsdPrice: () => ({ price: ref(null), loadById: async () => {} }) }
})
vi.mock('../utils/ton/tonIdentity', () => ({
    ensureTonAddress: async () => 'UQTestTonAddress000000000000000000000000000000',
}))
vi.mock('../composables/useTonFee', async () => {
    const { ref } = await import('vue')
    return {
        useTonFee: () => ({
            atsMaxFee: ref(null), atsMaxFeeRaw: ref(null), relayActive: ref(false), statusUnreadable: ref(false),
            ready: ref(false), decision: ref(null), quote: ref(null), budget: ref(null),
            loading: ref(false), onboarding: ref(false), error: ref(null),
            load: async () => {}, stop: () => {}, runOnboarding: async () => {},
        }),
    }
})

// useStockGate: arayuz durumunu kontrol etmek icin sahtelenir; `useReal` true iken GERCEK hook calisir (RF1 mesaj sayimi).
// `getters`: Swap'in hook'a verdigi ihracci kaynagi (cikti tokenini reaktif izlemeli).
const { gateMock } = vi.hoisted(() => ({ gateMock: { scenario: null, issuerCalls: [], getters: [], refresh: null, useReal: false } }))
vi.mock('../composables/useStockGate', async (importOriginal) => {
    const actual = await importOriginal()
    const { ref } = await import('vue')
    const IDLE = { state: 'idle', reason: null, ipCountry: null }
    return {
        ...actual,
        useStockGate: (source, opts) => {
            if (gateMock.useReal) return actual.useStockGate(source, opts)
            gateMock.getters.push(source)
            const issuer = (typeof source === 'function' ? source() : source) ?? null
            gateMock.issuerCalls.push(issuer)
            const s = issuer ? gateMock.scenario : IDLE
            return {
                state: ref(s.state), reason: ref(s.reason), ipCountry: ref(s.ipCountry),
                allowed: ref(actual.gateAllows(s.state)), refresh: gateMock.refresh,
            }
        },
    }
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { disposeStockEligibilityStore, getStockEligibilityStore } from '../composables/useStockEligibility'
import { yorumsuz, blokGovdesi } from '../test-utils/kaynakTarama'
import { yorumsuzHtml, butonlar, devreDisi } from '../test-utils/ssrHtmlYardimcilari'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { NO_ROUTE_ERROR } from '../utils/swapRoutes'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { RETIRED_BSTOCKS } from '../data/bStocksRetired'
import { RETIRED_XSTOCKS } from '../data/xStocksRetired'
import { GATE_CTA_LOCK_REASONS } from '../utils/stockGate/gateCta'

const here = dirname(fileURLToPath(import.meta.url))
const KAYNAK = readFileSync(join(here, 'Swap.vue'), 'utf8')

const BSC_CHAIN = supported_chains.find((c) => c.chainId === BSTOCKS_CHAIN_ID)
const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'

const KACIS = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }
const esc = (s) => String(s).replace(/["&'<>]/g, (c) => KACIS[c])

const tokenKaydi = (over = {}) => ({
    name: 'Alphabet', symbol: 'googlb', address: GOOGLB.address, decimals: 18, chainId: BSTOCKS_CHAIN_ID,
    image: { thumb: '', large: '' }, ...over,
})
const HISSE = () => tokenKaydi()
const USDT = () => tokenKaydi({ name: 'Tether USD', symbol: 'usdt', address: USDT_BSC })

const S = (state, reason, over = {}) => ({ state, reason, ipCountry: null, ...over })
// K32: karar yalniz IP ulkesine bakar; senaryolar kararin GERCEKTEN urettigi nedenlerle kurulur (olu nedenler yok).
const SENARYO = {
    ok: S('ok', null),
    warn: S('warn', null),
    checking: S('checking', null),
    blocked: S('blocked', 'IP_COUNTRY_ISSUER', { ipCountry: 'TR' }),
    precaution: S('blocked', 'IP_COUNTRY_PRECAUTION', { ipCountry: 'DE' }),
    unknown: S('blocked', 'COUNTRY_UNKNOWN'),
    killSwitch: S('blocked', 'KILL_SWITCH'),
    error: S('error', 'CHECK_FAILED'),
}
// Kapali (miktar / teklif / ana CTA kilitli) tum senaryolar. Bant `data-stock-gate` degeri senaryonun `state` alanidir.
const KILITLI = ['checking', 'blocked', 'precaution', 'unknown', 'killSwitch', 'error']
const ACIK = ['ok', 'warn']
// Kararin urettigi kilit nedenleri (decide.js); gateCta.js listesindeki olu adlar yalniz gateCta.test.js'te sinanir.
const CANLI_NEDENLER = ['KILL_SWITCH', 'IP_COUNTRY_ISSUER', 'IP_COUNTRY_PRECAUTION', 'COUNTRY_UNKNOWN']
// D3 (sahip karari 2026-10-16, spec 6.3): ana CTA etiketi nedeni soyler ve K32 sonrasi kapali kapida HER ZAMAN PASIFTIR.
const CTA = {
    checking: 'stockGate.cta.checking',
    blocked: 'stockGate.cta.IP_COUNTRY_ISSUER',
    precaution: 'stockGate.cta.IP_COUNTRY_PRECAUTION',
    unknown: 'stockGate.cta.COUNTRY_UNKNOWN',
    killSwitch: 'stockGate.cta.KILL_SWITCH',
    error: 'stockGate.cta.CHECK_FAILED',
}
// Kapi etiketlerinin hepsi: kapi acikken ya da cikti hisse degilken ana CTA bunlardan HICBIRINI yazmaz.
const kapiEtiketleri = (t) => [
    ...GATE_CTA_LOCK_REASONS.map((r) => t(`stockGate.cta.${r}`)), t('stockGate.cta.checking'),
]

let stub
let mesajlar
let yanit
let eligibility // GERCEK kanca testi: STOCK_GATE_STATUS yaniti (installChromeStub eligibility secenegi); undefined -> varsayilan OK/OK
beforeEach(() => {
    eligibility = undefined
    disposeStockEligibilityStore()
    gateMock.scenario = SENARYO.ok
    gateMock.issuerCalls = []
    gateMock.getters = []
    gateMock.useReal = false
    gateMock.refresh = vi.fn(async () => {})
    mesajlar = []
    yanit = async () => ({ error: 'yapilandirilmadi' })
})
afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    disposeStockEligibilityStore()
    delete globalThis.chrome
})

async function ekran({ inToken = USDT(), outToken = null, ilkDurum } = {}) {
    stub = installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    }, { eligibility })
    stub.setSendMessage(async (m) => { mesajlar.push(m); return yanit(m) })
    const app = createApp(Swap)
    app.use(createTestPinia())
    const i18n = createTestI18n('en')
    app.use(i18n)
    networkStore().currentNetwork = BSC_CHAIN
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    if (inToken) crypto.swap.inToken = inToken
    if (outToken) crypto.swap.outToken = outToken
    const holder = captureInstance(app, 'Swap', ilkDurum)
    const html = yorumsuzHtml(await render(app))
    return { html, holder, i18n, crypto, t: (k, p) => esc(i18n.global.t(k, p ?? {})) }
}

const miktarGirdisi = (html) => ({ nitelikler: (html.match(/<input\b[^>]*placeholder="0"[^>]*>/) || [''])[0] })
const maxDugmesi = (html) => butonlar(html).find((b) => b.metin === 'MAX')
const anaCta = (html) => butonlar(html).find((b) => b.nitelikler.includes('rounded-2xl font-bold text-base tracking-wide'))
const turler = (tur) => mesajlar.filter((m) => m?.type === tur)

describe('Swap (SSR) -- kapi bandi ve pasiflestirme (hisse CIKTISI)', () => {
    it.each(KILITLI)('kapi %s: bant gorunur, miktar girdisi + MAX PASIF, sebep stock-gate', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { html, holder } = await ekran({ outToken: HISSE() })
        expect(html).toContain(`data-stock-gate="${SENARYO[durum].state}"`)
        expect(devreDisi(miktarGirdisi(html))).toBe(true)
        expect(devreDisi(maxDugmesi(html))).toBe(true)
        expect(holder.instance.setupState.blockReason).toBe('stock-gate')
        expect(holder.instance.setupState.stockGateOpen).toBe(false)
    })

    // D3: ana CTA etiketi nedeni soyler; K32 sonrasi kapali kapida dugme HER ZAMAN PASIFTIR (etkin eylem kipi yok).
    it.each(KILITLI)('kapi %s: ana CTA PASIF ve etiketi nedeni soyler (D3, K32)', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { html, holder, t } = await ekran({ outToken: HISSE() })
        const cta = anaCta(html)
        expect(cta.metin).toBe(t(CTA[durum]))
        expect(devreDisi(cta)).toBe(true)
        expect(holder.instance.setupState.gateCta.mode).toBe('locked')
        expect(holder.instance.setupState.isValid()).toBe(false)
    })

    it.each(CANLI_NEDENLER)('engelli %s: ana CTA PASIF ve etiketi stockGate.cta.%s (her canli neden icin KISA etiket)', async (neden) => {
        gateMock.scenario = S('blocked', neden, { ipCountry: 'TR' })
        const { html, t } = await ekran({ outToken: HISSE() })
        const cta = anaCta(html)
        expect(devreDisi(cta)).toBe(true)
        expect(cta.metin).toBe(t(`stockGate.cta.${neden}`))
    })

    // K32: kapali kapida tiklama bir sey yapmaz. Sayfa degismez, depoya yazilmaz, SWAP / SWAP_QUOTE / STATUS disinda mesaj gitmez.
    it.each(KILITLI)('kapi %s: kapali kapida ana CTA tiklamasi hicbir sey degistirmez (currentPage, veri, mesaj)', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { holder, crypto } = await ekran({ outToken: HISSE(), inToken: USDT() })
        const once = { giris: crypto.swap.inToken, cikis: crypto.swap.outToken }
        expect(pageStore().currentPage).toBe('swap') // render sayfayi DEGISTIRMEZ
        expect(pageStore().data).toBeNull()
        const mesajOnce = mesajlar.length
        await holder.instance.setupState.onPrimary()
        expect(pageStore().currentPage).toBe('swap')
        expect(pageStore().data).toBeNull()
        expect(crypto.swap.inToken).toBe(once.giris)
        expect(crypto.swap.outToken).toBe(once.cikis)
        expect(mesajlar.length).toBe(mesajOnce)
        expect(turler('SWAP')).toEqual([])
        expect(turler('SWAP_QUOTE')).toEqual([])
        expect(gateMock.refresh).not.toHaveBeenCalled()
    })

    it.each(['idle', 'checking', 'ok', 'warn', 'blocked', 'error'])(
        'kip ile kapi kumesi tutarli: gateCta.mode open <=> stockGateOpen (durum %s)', async (durum) => {
            gateMock.scenario = S(durum, durum === 'blocked' ? 'IP_COUNTRY_ISSUER' : null)
            const { holder } = await ekran({ outToken: HISSE() })
            const s = holder.instance.setupState
            expect(s.gateCta.mode === 'open').toBe(s.stockGateOpen)
        })

    it.each(ACIK)('kapi %s: bant (hatirlatma) gorunur ama miktar / MAX PASIF DEGIL, sebep stock-gate DEGIL, CTA kapi etiketi yazmaz', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { html, holder, t } = await ekran({ outToken: HISSE() })
        expect(html).toContain(`data-stock-gate="${durum}"`)
        expect(devreDisi(miktarGirdisi(html))).toBe(false)
        expect(devreDisi(maxDugmesi(html))).toBe(false)
        expect(kapiEtiketleri(t)).not.toContain(anaCta(html).metin)
        expect(holder.instance.setupState.gateCta).toEqual({ mode: 'open', labelKey: null })
        expect(holder.instance.setupState.blockReason).not.toBe('stock-gate')
        expect(holder.instance.setupState.stockGateOpen).toBe(true)
    })

    it('engelli bant nedenini gosterir (IP_COUNTRY_ISSUER)', async () => {
        gateMock.scenario = SENARYO.blocked
        const { html } = await ekran({ outToken: HISSE() })
        expect(html).toContain('data-stock-gate-reason="IP_COUNTRY_ISSUER"')
    })

    it('bant, teklif kartindan (swap.exchangeRate) ONCE ve alinan kutusundan SONRA gelir', async () => {
        gateMock.scenario = SENARYO.blocked
        const { html } = await ekran({ outToken: HISSE() })
        const bant = html.indexOf('data-stock-gate="blocked"')
        const aliciKutusu = html.indexOf('GOOGLB')
        expect(bant).toBeGreaterThan(-1)
        expect(bant).toBeGreaterThan(aliciKutusu)
    })
})

describe('Swap (SSR) -- hisse OLMAYAN cikti ve Sat: kapi HIC sorulmaz', () => {
    it('cikti hisse degil: bant yok, girdi / MAX acik, ihracci kaynagi null, refresh yok, STATUS mesaji yok', async () => {
        gateMock.scenario = SENARYO.blocked // sorulsaydi kilitlerdi: sorulmamali
        const { html, holder, t } = await ekran({ outToken: USDT(), inToken: HISSE() })
        expect(html).not.toContain('data-stock-gate=')
        expect(devreDisi(miktarGirdisi(html))).toBe(false)
        expect(devreDisi(maxDugmesi(html))).toBe(false)
        expect(kapiEtiketleri(t)).not.toContain(anaCta(html).metin)
        expect(holder.instance.setupState.outStock).toBeNull()
        expect(holder.instance.setupState.blockReason).not.toBe('stock-gate')
        expect(gateMock.issuerCalls.at(-1)).toBeNull()
        expect(gateMock.refresh).not.toHaveBeenCalled()
        expect(turler('STOCK_GATE_STATUS')).toEqual([])
    })

    it('cikti secilmemis: bant yok, kapi acik', async () => {
        const { html, holder } = await ekran({ outToken: null })
        expect(html).not.toContain('data-stock-gate=')
        expect(holder.instance.setupState.stockGateOpen).toBe(true)
    })
})

describe('Swap (SSR) -- RF1: hisse olmayan cikti secilince eski karar ekrani kilitlemez', () => {
    it('ihracci kaynagi CIKTI tokenini reaktif izler: hisse -> bstocks, USDT -> null', async () => {
        gateMock.scenario = SENARYO.blocked
        const { holder, crypto } = await ekran({ outToken: HISSE() })
        const kaynak = gateMock.getters.at(-1)
        expect(typeof kaynak).toBe('function')
        expect(kaynak()).toBe('bstocks')
        crypto.swap.outToken = USDT()
        expect(kaynak()).toBeNull()
        expect(holder.instance.setupState.outStock).toBeNull()
        crypto.swap.outToken = HISSE()
        expect(kaynak()).toBe('bstocks')
    })

    it('ters cevirme: hisse Verilen tarafa gecince (Sat) kaynak null olur; yeniden cevirince bstocks', async () => {
        gateMock.scenario = SENARYO.blocked
        const { holder } = await ekran({ inToken: USDT(), outToken: HISSE() })
        const kaynak = gateMock.getters.at(-1)
        expect(kaynak()).toBe('bstocks')
        holder.instance.setupState.reverse()
        expect(kaynak()).toBeNull()
        // K34: Odenen artik hisse; reverse() uygunluk bilinmeden cevirmez (yukleme = gizli). SSR'da izleyici calismadigindan
        // tarayicidaki 'abonelik acildi, yanit geldi' adimi elle yapilir (varsayilan yanit: iki ihracci da OK).
        await getStockEligibilityStore().acquire()
        holder.instance.setupState.reverse()
        expect(kaynak()).toBe('bstocks')
    })

    it('GERCEK hook: hisse cikti tek govdesiz STATUS sorar (iki ihracci tek yanitta); hisse olmayan cikti HIC sormaz ve bant yok', async () => {
        gateMock.useReal = true
        // STATUS yaniti installChromeStub'in eligibility islevinden gelir (setSendMessage STATUS'u gormez): mesaj sayilir ve yanitlanir.
        eligibility = (m) => {
            mesajlar.push(m)
            return {
                bstocks: { decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' },
                xstocks: { decision: 'OK', reason: 'OK', ipCountry: null },
            }
        }
        const hisse = await ekran({ outToken: HISSE() })
        expect(turler('STOCK_GATE_STATUS')).toEqual([{ type: 'STOCK_GATE_STATUS' }])
        // STATUS yaniti render'dan once gelir (onMounted await'leri): bant 'checking'den yanitin durumuna gecmistir ve
        // ana CTA kilitlidir. Uctan uca: arka plan yaniti -> hook -> bant -> pasif CTA.
        expect(hisse.html).toContain('data-stock-gate="blocked"')
        expect(hisse.html).toContain('data-stock-gate-reason="IP_COUNTRY_ISSUER"')
        expect(devreDisi(anaCta(hisse.html))).toBe(true)
        expect(anaCta(hisse.html).metin).toBe(hisse.t('stockGate.cta.IP_COUNTRY_ISSUER'))
        expect(hisse.holder.instance.setupState.blockReason).toBe('stock-gate')

        mesajlar = []
        const diger = await ekran({ outToken: USDT() })
        expect(turler('STOCK_GATE_STATUS')).toEqual([])
        expect(diger.html).not.toContain('data-stock-gate=')
        expect(diger.holder.instance.setupState.blockReason).not.toBe('stock-gate')
        expect(kapiEtiketleri(diger.t)).not.toContain(anaCta(diger.html).metin)
    })
})

describe('Swap -- teklif ve ATS ucret teklifi kapi kapaliyken ISTENMEZ', () => {
    const miktarYaz = (i) => { i.setupState.inTokenAmount = '1' }

    it('pozitif bekci: kapi ACIKKEN getSwapData SWAP_QUOTE gonderir', async () => {
        gateMock.scenario = SENARYO.ok
        yanit = async () => ({ error: NO_ROUTE_ERROR })
        const { holder } = await ekran({ outToken: HISSE(), ilkDurum: miktarYaz })
        await holder.instance.setupState.getSwapData()
        expect(turler('SWAP_QUOTE')).toHaveLength(1)
        expect(holder.instance.setupState.quoteError).toBe('route')
    })

    it.each(KILITLI)('kapi %s: getSwapData HICBIR SWAP_QUOTE gondermez, teklif temizlenir, yukleme kapanir', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { holder } = await ekran({ outToken: HISSE(), ilkDurum: miktarYaz })
        holder.instance.setupState.swapData = { expectedOutput: '1', exchangeRate: '1' }
        await holder.instance.setupState.getSwapData()
        expect(turler('SWAP_QUOTE')).toEqual([])
        expect(holder.instance.setupState.swapData).toBeNull()
        expect(holder.instance.setupState.swapLoading).toBe(false)
        expect(holder.instance.setupState.quoteError).toBeNull()
    })

    it('pozitif bekci: kapi ACIKKEN (BSC = ATS zinciri) refreshAtsOpFee ATS_SWAP_FEE_QUOTE gonderir', async () => {
        gateMock.scenario = SENARYO.ok
        yanit = async () => ({ success: false, error: 'x' })
        const { holder } = await ekran({ outToken: HISSE(), ilkDurum: miktarYaz })
        await holder.instance.setupState.refreshAtsOpFee()
        expect(turler('ATS_SWAP_FEE_QUOTE')).toHaveLength(1)
    })

    it.each(KILITLI)('kapi %s: refreshAtsOpFee ATS_SWAP_FEE_QUOTE gondermez', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { holder } = await ekran({ outToken: HISSE(), ilkDurum: miktarYaz })
        await holder.instance.setupState.refreshAtsOpFee()
        expect(turler('ATS_SWAP_FEE_QUOTE')).toEqual([])
    })

    it('P12: teklif yanitinda kapi sentineli (yaris) -> genel hata karti YOK, console.error YOK, bant yeniden sorulur', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        gateMock.scenario = SENARYO.ok
        yanit = async () => ({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        const { holder } = await ekran({ outToken: HISSE(), ilkDurum: miktarYaz })
        await holder.instance.setupState.getSwapData()
        expect(gateMock.refresh).toHaveBeenCalledTimes(1)
        expect(holder.instance.setupState.quoteError).toBeNull()
        expect(holder.instance.setupState.swapData).toBeNull()
        expect(hata).not.toHaveBeenCalled()
    })

    it('kontrol: tanimadigimiz hata bugunku gibi unknown karti + console.error uretir, kapi yeniden sorulmaz', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        yanit = async () => ({ error: 'bilinmeyen motor hatasi' })
        const { holder } = await ekran({ outToken: HISSE(), ilkDurum: miktarYaz })
        await holder.instance.setupState.getSwapData()
        expect(holder.instance.setupState.quoteError).toBe('unknown')
        expect(hata).toHaveBeenCalled()
        expect(gateMock.refresh).not.toHaveBeenCalled()
    })
})

describe('Swap -- SWAP yaniti kapi retse ana sayfaya GITMEZ (spec 5.11)', () => {
    it('kapi sentineli: true doner, bant yeniden sorulur, sayfa swap te KALIR', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        const { holder } = await ekran({ outToken: HISSE() })
        const reddedildi = await holder.instance.setupState.rejectedByStockGate({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(reddedildi).toBe(true)
        expect(gateMock.refresh).toHaveBeenCalledTimes(1)
        expect(pageStore().currentPage).toBe('swap')
        vi.clearAllTimers()
    })

    it('bilinmeyen kapi nedeni de (STOCK_GATE:BOGUS) kapi retsayilir: ham metin ekrana cikmaz', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        const { holder } = await ekran({ outToken: HISSE() })
        expect(await holder.instance.setupState.rejectedByStockGate({ error: 'STOCK_GATE:BOGUS' })).toBe(true)
        vi.clearAllTimers()
    })

    it.each([
        ['basari', { success: true }],
        ['baska hata', { error: 'Swap failed' }],
        ['undefined', undefined],
        ['null', null],
        ['kucuk harf onek', { error: 'stock_gate:IP_COUNTRY_ISSUER' }],
        ['dize olmayan hata', { error: 5 }],
        ['onek icerikte', { error: 'x STOCK_GATE:IP_COUNTRY_ISSUER' }],
    ])('%s: false doner (bugunku kosulsuz ana sayfa yolu), refresh yok', async (_ad, resp) => {
        const { holder } = await ekran({ outToken: HISSE() })
        expect(await holder.instance.setupState.rejectedByStockGate(resp)).toBe(false)
        expect(gateMock.refresh).not.toHaveBeenCalled()
    })
})

describe('Swap -- swap(): diger TUM kosullar saglanmisken kapi tek basina belirler', () => {
    // Tam gecerli durum: tutar, teklif, bakiye, ATS kolu hazir (BSC bir ATS zinciridir: payWithAts true).
    const hazirla = (i) => {
        i.setupState.inTokenAmount = '1'
        i.setupState.inBalance = 100
        i.setupState.swapData = { expectedOutput: '1', exchangeRate: '1' }
        i.setupState.atsReady = true
    }
    const hazirEkran = async (durum) => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        gateMock.scenario = SENARYO[durum]
        const e = await ekran({ outToken: HISSE() })
        hazirla(e.holder.instance)
        return e
    }

    it.each([
        ['ok', null], ['warn', null], ['checking', 'stock-gate'], ['blocked', 'stock-gate'], ['precaution', 'stock-gate'],
        ['unknown', 'stock-gate'], ['killSwitch', 'stock-gate'], ['error', 'stock-gate'],
    ])(
        'blockReason kapi %s iken %s', async (durum, beklenen) => {
            const { holder } = await hazirEkran(durum)
            expect(holder.instance.setupState.blockReason).toBe(beklenen)
            expect(holder.instance.setupState.isValid()).toBe(beklenen === null)
        })

    it('pozitif bekci: kapi ACIKKEN swap() SWAP gonderir; kapi sentineli yanitinda ana sayfaya GITMEZ, bant yeniden sorulur', async () => {
        yanit = async () => ({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        const { holder } = await hazirEkran('ok')
        await holder.instance.setupState.swap()
        expect(turler('SWAP')).toHaveLength(1)
        expect(pageStore().currentPage).toBe('swap')
        expect(gateMock.refresh).toHaveBeenCalledTimes(1)
        expect(holder.instance.setupState.loading).toBe(false)
        vi.clearAllTimers()
    })

    it('pozitif bekci: kapi ACIKKEN ana dugme onPrimary() swap() calistirir (SWAP gider, sayfa home a doner)', async () => {
        yanit = async () => ({ success: true })
        const { holder } = await hazirEkran('ok')
        await holder.instance.setupState.onPrimary()
        expect(turler('SWAP')).toHaveLength(1)
        expect(pageStore().currentPage).toBe('home')
        vi.clearAllTimers()
    })

    it.each([
        ['basari', { success: true }],
        ['baska hata', { error: 'Swap failed' }],
        ['undefined', undefined],
    ])('%s yanitinda bugunku KOSULSUZ ana sayfa donusu korunur, kapi yeniden sorulmaz', async (_ad, resp) => {
        yanit = async () => resp
        const { holder } = await hazirEkran('ok')
        await holder.instance.setupState.swap()
        expect(turler('SWAP')).toHaveLength(1)
        expect(pageStore().currentPage).toBe('home')
        expect(gateMock.refresh).not.toHaveBeenCalled()
        vi.clearAllTimers()
    })

    it.each(KILITLI)('kapi %s: swap() HICBIR SWAP gondermez, sayfa degismez', async (durum) => {
        const { holder } = await hazirEkran(durum)
        await holder.instance.setupState.swap()
        expect(turler('SWAP')).toEqual([])
        expect(pageStore().currentPage).toBe('swap')
        vi.clearAllTimers()
    })
})

describe('Swap -- kaynak kilitleri', () => {
    const swapGovdesi = blokGovdesi(KAYNAK, /const swap = async\(\) =>/) || ''
    const getSwapDataGovdesi = blokGovdesi(KAYNAK, /const getSwapData = async \(\) =>/) || ''
    const atsGovdesi = blokGovdesi(KAYNAK, /const refreshAtsOpFee = async \(\) =>/) || ''
    const sablon = yorumsuz(KAYNAK)

    it('swap(): SWAP yaniti OKUNUR ve kapi reddi kosulsuz home dan ONCE; kosulsuz home korunur', () => {
        expect(swapGovdesi).toContain("const swapResp = await chrome.runtime.sendMessage({ type: 'SWAP', message })")
        const gonder = swapGovdesi.indexOf("type: 'SWAP', message })")
        const red = swapGovdesi.indexOf('if (await rejectedByStockGate(swapResp)) return')
        const sonHome = swapGovdesi.lastIndexOf("pageStore().currentPage = 'home'")
        expect(gonder).toBeGreaterThan(-1)
        expect(red).toBeGreaterThan(gonder)
        expect(sonHome).toBeGreaterThan(red)
        // yanit okuma yalnizca kapi retsayiyor: ana sayfa donusu baska hicbir kosula baglanmadi
        const redSonu = red + 'if (await rejectedByStockGate(swapResp)) return'.length
        expect(swapGovdesi.slice(redSonu, sonHome)).not.toMatch(/\bif\s*\(/)
    })

    it('getSwapData ve refreshAtsOpFee: kapi denetimi ilk ag istegindan ONCE', () => {
        expect(getSwapDataGovdesi.indexOf('stockGateOpen.value')).toBeGreaterThan(-1)
        expect(getSwapDataGovdesi.indexOf('stockGateOpen.value')).toBeLessThan(getSwapDataGovdesi.indexOf('chrome.runtime.sendMessage'))
        expect(atsGovdesi.indexOf('stockGateOpen.value')).toBeGreaterThan(-1)
        expect(atsGovdesi.indexOf('stockGateOpen.value')).toBeLessThan(atsGovdesi.indexOf('loadAtsOpFee('))
    })

    it('ATS "teklif alinamadi" karti STOCK_GATE kodunda cizilmez (yaris: yanilticisi kart)', () => {
        expect(sablon).toMatch(/atsError && atsErrorCode !== 'STOCK_GATE' && \(!atsDecision/)
    })

    it('bant yalniz cikti hisseyse (sayfa gecisi prop u yok); useStockGate kaynagi cikti tokeni (girdi DEGIL)', () => {
        expect(sablon).toMatch(/<StockGateBand v-if="outStock" :gate="stockGate" :issuer="outStock\.issuer" \/>/)
        expect(sablon).toMatch(/useStockGate\(\(\) => outStock\.value\?\.issuer \?\? null\)/)
        // K42: arayuz aynasi arka planla AYNI aramayi kullanir (stockOutputIssuer: katalog + emekli); yalniz katalog bilen stockEntry geri gelmez.
        expect(sablon).toMatch(/stockOutputIssuer\(network\.currentNetwork\?\.chainId, crypto\.swap\.outToken\?\.address\)/)
        expect(sablon).not.toMatch(/stockEntry\(/)
    })

    it('swapBlockReason a stockGateBlocked tasinir; ana CTA etiketi gateCtaOf ten gelir (D3)', () => {
        expect(sablon).toContain('stockGateBlocked: !stockGateOpen.value')
        expect(sablon).toMatch(/blockReason === 'stock-gate'">\{\{ \$t\(gateCta\.labelKey\) \}\}/)
        expect(sablon).toContain('const gateCta = computed(() => gateCtaOf(stockGate))')
        expect(sablon).not.toContain('stockGate.cta.locked')
    })

    it('ana CTA: tiklama onPrimary e bagli ve kapali kapida HER ZAMAN pasif (:disabled !isValid()); onPrimary yalniz swap() calistirir (K32)', () => {
        expect(sablon).toContain('@click="onPrimary"')
        expect(sablon).toContain(':disabled="!isValid()"')
        expect(sablon).toContain(':class="isValid()')
        expect(sablon).not.toMatch(/\(isValid\(\) \|\|/)
        expect(sablon).toContain('const onPrimary = () => swap()')
    })

    it('kaynakta openGate|gateActionCta|leavingForGate|stock_gate yok (beyan ekranina gidis yolu tamamen kalkti)', () => {
        expect(sablon).toContain('const gateCta = computed(() => gateCtaOf(stockGate))') // pozitif bekci: tarama gercek kaynagi goruyor
        expect(sablon).not.toMatch(/openGate|gateActionCta|leavingForGate|stock_gate|goToGate|return-page|returnPage/)
        expect(sablon).not.toContain("mode === 'action'")
    })

    // Main (gizli mod ATS satisi, T28 M6): Swap.vue featureFlags'ten TEK ad alir, PRIVATE_ATS_SALE (gizli hesapta ATS ALIMI bayragi);
    // hisse kapisiyla ilgisi yoktur (ATS cikti tokeni hisse olamaz). Kapi hicbir hisse / kapi bayragina baglanmaz.
    it('kapi derleme bayragina BAGLI DEGIL: Swap.vue featureFlags ten yalniz PRIVATE_ATS_SALE alir; XSTOCKS_ENABLED / kapi bayragi adi gecmez', () => {
        const alinanlar = [...sablon.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*featureFlags'/g)]
            .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean))
        expect(alinanlar, 'pozitif bekci: featureFlags import i taranip okundu').toEqual(['PRIVATE_ATS_SALE'])
        expect(sablon).not.toMatch(/XSTOCKS_ENABLED|STOCK_GATE_ENABLED|ELIGIBILITY_ENABLED/)
    })
})

// K32: beyan ekranina gidis kalkti (R21'in "form beyan ekraninda korunur" gerekcesi sona erdi). Swap kaldirilirken secili
// tokenlar BUGUNKU gibi KOSULSUZ temizlenir; baska bir ekrana (eski stock_gate) gidis ayrimi yoktur.
// Bilesen bu ortamda unmount EDILEMEZ (DOM yok): kaynak kilidi okunur.
describe('Swap -- onUnmounted: secili tokenlar kosulsuz temizlenir, sayfa yazimi yalniz home (beyan ekrani ayrimi kalmadi)', () => {
    const sablon = yorumsuz(KAYNAK)
    const unmount = blokGovdesi(KAYNAK, /onUnmounted\(\(\) =>\s*/) || ''
    const unmountKod = yorumsuz(unmount)

    it('onUnmounted: crypto.swap.inToken ve outToken KOSULSUZ null a cekilir (leavingForGate kosulu yok)', () => {
        expect(unmountKod, 'onUnmounted govdesi bulunamadi').toContain('clearInterval(swapInterval)') // pozitif bekci
        expect(unmountKod).toMatch(/crypto\.swap\.inToken = null/)
        expect(unmountKod).toMatch(/crypto\.swap\.outToken = null/)
        expect(unmountKod).not.toMatch(/leavingForGate|\bif\s*\(\s*!/)
        expect(unmountKod.split('crypto.swap.inToken = null')).toHaveLength(2)
        expect(unmountKod.split('crypto.swap.outToken = null')).toHaveLength(2)
    })

    it('zamanlayici / dinleyici temizligi onUnmounted ta durur', () => {
        for (const ifade of ['clearInterval(swapInterval)', 'removeEventListener', 'clearTimeout(quoteDebounceTimer)', 'tonFee.stop()']) {
            expect(unmountKod.indexOf(ifade), ifade + ' yok').toBeGreaterThan(-1)
        }
    })

    it('Swap currentPage e yalniz home yazar; onUnmounted sayfa yazimi YAPMAZ', () => {
        const yazimlar = [...sablon.matchAll(/currentPage\s*=[^=]\s*'?([\w]+)/g)].map((m) => m[1])
        expect(yazimlar.length).toBeGreaterThan(0)
        expect([...new Set(yazimlar)]).toEqual(['home'])
        expect(unmountKod).not.toMatch(/currentPage\s*=[^=]/)
        expect(unmountKod).not.toContain('featureFlags')
    })
})

// Emekli hisseler (K28, K42; main senkronu 22f4f686 denetimi, madde G): arayuz aynasi arka plan kapisiyla AYNI aramayi (stockOutputIssuer: katalog +
// emekli listeler) kullanir. Eskiden `stockEntry` (yalniz katalog) kullaniliyordu: secili cikti emekli bir bStock iken bant gorunmez, miktar acik
// kalir ve arka plan alimi reddederdi (kullanici "takas gitti" sanirdi).
describe('Swap (SSR) -- emekli bStocks (BMNRB, FLNCB) ve emekli xStocks ciktisi kapi aynasini AYNEN gosterir (K42)', () => {
    const emekli = (liste, sembol) => liste.find((r) => r.symbol === sembol).address
    const EMEKLILER = [
        ['BMNRB', 'bstocks', emekli(RETIRED_BSTOCKS, 'BMNRB')],
        ['FLNCB', 'bstocks', emekli(RETIRED_BSTOCKS, 'FLNCB')],
        ['PYPLx', 'xstocks', emekli(RETIRED_XSTOCKS, 'PYPLx')],
    ]

    it.each(EMEKLILER)('cikti emekli %s: outStock ihraccisi %s, bant gorunur, miktar / MAX / ana CTA PASIF, kapi kaynagi ihracciyi sorar', async (sembol, ihracci, adres) => {
        gateMock.scenario = SENARYO.blocked
        const { html, holder } = await ekran({ outToken: tokenKaydi({ symbol: sembol.toLowerCase(), name: sembol, address: adres }) })
        expect(holder.instance.setupState.outStock).toEqual({ issuer: ihracci })
        expect(gateMock.issuerCalls.at(-1)).toBe(ihracci)
        expect(html).toContain('data-stock-gate="blocked"')
        expect(devreDisi(miktarGirdisi(html))).toBe(true)
        expect(devreDisi(maxDugmesi(html))).toBe(true)
        expect(devreDisi(anaCta(html))).toBe(true)
        expect(holder.instance.setupState.blockReason).toBe('stock-gate')
    })

    it('emekli bStock + kapi acik (ok): bant gorunur ama miktar PASIF DEGIL (katalog bStocks ile ayni davranis, ayri dislama yok)', async () => {
        gateMock.scenario = SENARYO.ok
        const { html, holder } = await ekran({ outToken: tokenKaydi({ symbol: 'bmnrb', name: 'BMNRB', address: emekli(RETIRED_BSTOCKS, 'BMNRB') }) })
        expect(html).toContain('data-stock-gate="ok"')
        expect(devreDisi(miktarGirdisi(html))).toBe(false)
        expect(holder.instance.setupState.stockGateOpen).toBe(true)
    })

    it('GIRDI tarafi (Sat) emekli bStock: kapi HIC sorulmaz; cikti hisse degilse bant yok', async () => {
        gateMock.scenario = SENARYO.blocked // sorulsaydi kilitlerdi: sorulmamali
        const { html, holder } = await ekran({ inToken: tokenKaydi({ symbol: 'bmnrb', name: 'BMNRB', address: emekli(RETIRED_BSTOCKS, 'BMNRB') }), outToken: USDT() })
        expect(holder.instance.setupState.outStock).toBeNull()
        expect(html).not.toContain('data-stock-gate=')
        expect(devreDisi(miktarGirdisi(html))).toBe(false)
        expect(gateMock.issuerCalls.at(-1)).toBeNull()
    })
})
