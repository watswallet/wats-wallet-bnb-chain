// KOK NEDEN / KAPATILAN HATA (spec 5.3, 5.11, 6.4): Kopru ekrani bStocks HEDEFLI alimlarda kapi aynasini gostermezse ya da
// kapi kapaliyken teklif istemeye / "gonderim basarisiz" kartini basmaya devam ederse kullanici ne oldugunu anlamaz:
//  (1) kapi ALINACAK tokenin HEDEF zincirine bakar (aktif ag DEGIL): Ethereum'dan BSC'ye hisse alirken sorulur, BSC'den
//      Ethereum'a ayni adresi tasiyan tokene giderken sorulmaz;
//  (2) kapi kapaliyken miktar girdisi ve yuzde cipleri pasif, isValid() false; ana CTA etiketi nedeni soyler (sahip karari
//      D3); K32: beyan yok, kapali kapida dugme HER ZAMAN PASIF, etiket KISA nedeni soyler ve tiklama hicbir sey yapmaz;
//  (3) getBridgeData / refreshAtsOpFee kapi kapaliyken ag istegi ATMAZ (acikken atar: pozitif bekci);
//  (4) arka plan kapisi BRIDGE'i `queued` yazmadan reddederse ({ success:false, error:'STOCK_GATE:<NEDEN>' }) genel
//      `bridgeError` karti CIKMAZ, bant yeniden sorulur; baska hatalarda bugunku karti korunur.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))
// ATS dolar fiyati canli ag istegi atmasin (SwapRecvBalance.ssr.test.js ile AYNI mock).
vi.mock('../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return { useUsdPrice: () => ({ price: ref(null), loadById: async () => {} }) }
})

// bridgeTo.vue listeyi LI.FI'den (axios.get) ve fiyatlari bizim sunucudan (axios.post) okur: ikisi de saplanir.
vi.mock('axios', () => ({
    default: {
        get: vi.fn(async () => ({ status: 200, data: { tokens: {} } })),
        post: vi.fn(async () => ({ status: 200, data: { tokens: [] } })),
    },
}))

// useStockGate: arayuz durumunu kontrol etmek icin sahtelenir. `getters`: Kopru'nun hook'a verdigi ihracci kaynagi
// (HEDEF zincirdeki cikti tokenini reaktif izlemeli).
const { gateMock } = vi.hoisted(() => ({ gateMock: { scenario: null, issuerCalls: [], getters: [], refresh: null } }))
vi.mock('../composables/useStockGate', async (importOriginal) => {
    const actual = await importOriginal()
    const { ref } = await import('vue')
    const IDLE = { state: 'idle', reason: null, ipCountry: null }
    return {
        ...actual,
        useStockGate: (source) => {
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
import { yorumsuz, blokGovdesi } from '../test-utils/kaynakTarama'
import { yorumsuzHtml, butonlar, devreDisi } from '../test-utils/ssrHtmlYardimcilari'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Bridge from './Bridge.vue'
import supported_chains from '../data/supported_chains.json'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { RETIRED_BSTOCKS } from '../data/bStocksRetired'
import { RETIRED_XSTOCKS } from '../data/xStocksRetired'
import { GATE_CTA_LOCK_REASONS } from '../utils/stockGate/gateCta'

const here = dirname(fileURLToPath(import.meta.url))
const KAYNAK = readFileSync(join(here, 'Bridge.vue'), 'utf8')

const BSC_CHAIN = supported_chains.find((c) => c.chainId === BSTOCKS_CHAIN_ID)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'
const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

const KACIS = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }
const esc = (s) => String(s).replace(/["&'<>]/g, (c) => KACIS[c])

const token = (over = {}) => ({
    name: 'Tether USD', symbol: 'usdt', address: USDT_ETH, decimals: 6, image: { thumb: '', large: '' }, ...over,
})
const HISSE = () => token({ name: 'Alphabet', symbol: 'googlb', address: GOOGLB.address, decimals: 18 })
const USDT_HEDEF = () => token({ address: USDT_BSC, decimals: 18 })

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

let mesajlar
let yanit
beforeEach(() => {
    gateMock.scenario = SENARYO.ok
    gateMock.issuerCalls = []
    gateMock.getters = []
    gateMock.refresh = vi.fn(async () => {})
    mesajlar = []
    yanit = async () => ({ success: false, error: 'yapilandirilmadi' })
})
afterEach(() => {
    vi.restoreAllMocks()
    delete globalThis.chrome
})

// Varsayilan: Ethereum aktif, hedef BSC, alinacak token bir bStock (kapi sorulmasi gereken tek yapi).
async function ekran({ aktifAg = ETH_CHAIN, toChain = BSC_CHAIN, inToken = token(), outToken = HISSE(), ilkDurum } = {}) {
    const stub = installChromeStub({
        currentNetwork: aktifAg,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })
    stub.setSendMessage(async (m) => { mesajlar.push(m); return yanit(m) })
    const app = createApp(Bridge)
    app.use(createTestPinia())
    const i18n = createTestI18n('en')
    app.use(i18n)
    networkStore().currentNetwork = aktifAg
    pageStore().currentPage = 'bridge'
    const crypto = cryptoStore()
    crypto.bridge.inToken = inToken
    crypto.bridge.toChain = toChain
    crypto.bridge.outToken = outToken
    const holder = captureInstance(app, 'Bridge', ilkDurum)
    const html = yorumsuzHtml(await render(app))
    return { html, holder, i18n, crypto, t: (k, p) => esc(i18n.global.t(k, p ?? {})) }
}

const miktarGirdisi = (html) => ({ nitelikler: (html.match(/<input\b[^>]*placeholder="0"[^>]*>/) || [''])[0] })
const maxDugmesi = (html) => butonlar(html).find((b) => b.metin === 'MAX')
const anaCta = (html) => butonlar(html).find((b) => b.nitelikler.includes('rounded-2xl font-bold text-base tracking-wide'))
const turler = (tur) => mesajlar.filter((m) => m?.type === tur)
const teklifKaydi = () => ({
    transactionRequest: { to: '0x0000000000000000000000000000000000000001', data: '0x', value: '0' },
    action: {
        fromChainId: 1, toChainId: 56, fromAmount: '1000000',
        fromToken: { address: USDT_ETH, decimals: 6 }, toToken: { address: GOOGLB.address, decimals: 18 },
    },
    estimate: { toAmount: '1', approvalAddress: '0x0000000000000000000000000000000000000002' },
})

describe('Bridge (SSR) -- kapi bandi ve pasiflestirme (HEDEF zincirde hisse)', () => {
    it.each(KILITLI)('kapi %s: bant gorunur, miktar + MAX PASIF, isValid() false', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { html, holder } = await ekran()
        expect(html).toContain(`data-stock-gate="${SENARYO[durum].state}"`)
        expect(devreDisi(miktarGirdisi(html))).toBe(true)
        expect(devreDisi(maxDugmesi(html))).toBe(true)
        expect(holder.instance.setupState.isValid()).toBe(false)
        expect(holder.instance.setupState.stockGateOpen).toBe(false)
    })

    // D3: ana CTA etiketi nedeni soyler; K32 sonrasi kapali kapida dugme HER ZAMAN PASIFTIR (etkin eylem kipi yok).
    it.each(KILITLI)('kapi %s: ana CTA PASIF ve etiketi nedeni soyler (D3, K32)', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { html, holder, t } = await ekran()
        const cta = anaCta(html)
        expect(cta.metin).toBe(t(CTA[durum]))
        expect(devreDisi(cta)).toBe(true)
        expect(holder.instance.setupState.gateCta.mode).toBe('locked')
        expect(holder.instance.setupState.isValid()).toBe(false)
    })

    it.each(CANLI_NEDENLER)('engelli %s: ana CTA PASIF ve etiketi stockGate.cta.%s (her canli neden icin KISA etiket)', async (neden) => {
        gateMock.scenario = S('blocked', neden, { ipCountry: 'TR' })
        const { html, t } = await ekran()
        const cta = anaCta(html)
        expect(devreDisi(cta)).toBe(true)
        expect(cta.metin).toBe(t(`stockGate.cta.${neden}`))
    })

    // K32: kapali kapida tiklama bir sey yapmaz. Sayfa degismez, depoya yazilmaz, BRIDGE / BRIDGE_QUOTE gitmez.
    it.each(KILITLI)('kapi %s: kapali kapida ana CTA tiklamasi hicbir sey degistirmez (currentPage, veri, secili tokenlar, mesaj)', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { holder, crypto } = await ekran()
        const once = { giris: crypto.bridge.inToken, cikis: crypto.bridge.outToken, zincir: crypto.bridge.toChain }
        expect(pageStore().currentPage).toBe('bridge') // render sayfayi DEGISTIRMEZ
        expect(pageStore().data).toBeNull()
        const mesajOnce = mesajlar.length
        await holder.instance.setupState.onPrimary()
        expect(pageStore().currentPage).toBe('bridge')
        expect(pageStore().data).toBeNull()
        expect(crypto.bridge.inToken).toBe(once.giris)
        expect(crypto.bridge.outToken).toBe(once.cikis)
        expect(crypto.bridge.toChain).toBe(once.zincir)
        expect(mesajlar.length).toBe(mesajOnce)
        expect(turler('BRIDGE')).toEqual([])
        expect(turler('BRIDGE_QUOTE')).toEqual([])
        expect(gateMock.refresh).not.toHaveBeenCalled()
    })

    it.each(['idle', 'checking', 'ok', 'warn', 'blocked', 'error'])(
        'kip ile kapi kumesi tutarli: gateCta.mode open <=> stockGateOpen (durum %s)', async (durum) => {
            gateMock.scenario = S(durum, durum === 'blocked' ? 'IP_COUNTRY_ISSUER' : null)
            const { holder } = await ekran()
            const s = holder.instance.setupState
            expect(s.gateCta.mode === 'open').toBe(s.stockGateOpen)
        })

    it.each(ACIK)('kapi %s: bant (hatirlatma) gorunur ama miktar / MAX PASIF DEGIL, CTA kapi etiketi yazmaz', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { html, holder, t } = await ekran()
        expect(html).toContain(`data-stock-gate="${durum}"`)
        expect(devreDisi(miktarGirdisi(html))).toBe(false)
        expect(devreDisi(maxDugmesi(html))).toBe(false)
        expect(kapiEtiketleri(t)).not.toContain(anaCta(html).metin)
        expect(holder.instance.setupState.gateCta).toEqual({ mode: 'open', labelKey: null })
        expect(holder.instance.setupState.stockGateOpen).toBe(true)
    })

    it('engelli bant nedenini gosterir ve "Alici zincir" kutusundan SONRA, filtre seridinden ONCE gelir', async () => {
        gateMock.scenario = SENARYO.blocked
        const { html } = await ekran()
        expect(html).toContain('data-stock-gate-reason="IP_COUNTRY_ISSUER"')
        const bant = html.indexOf('data-stock-gate="blocked"')
        expect(bant).toBeGreaterThan(html.indexOf('GOOGLB'))
    })
})

describe('Bridge (SSR) -- anahtar HEDEF zincirdeki cikti tokenidir (aktif ag DEGIL)', () => {
    it('Ethereum aktif + BSC hedef + bStock: ihracci bstocks, bant var', async () => {
        gateMock.scenario = SENARYO.blocked
        const { html, holder } = await ekran({ aktifAg: ETH_CHAIN, toChain: BSC_CHAIN, outToken: HISSE() })
        expect(gateMock.issuerCalls.at(-1)).toBe('bstocks')
        expect(holder.instance.setupState.outStock).toMatchObject({ issuer: 'bstocks' })
        expect(html).toContain('data-stock-gate="blocked"')
    })

    it('BSC aktif + Ethereum hedef + AYNI adres: hisse DEGIL -> bant yok, kapi acik, ihracci null', async () => {
        gateMock.scenario = SENARYO.blocked // sorulsaydi kilitlerdi: sorulmamali
        const { html, holder, t } = await ekran({ aktifAg: BSC_CHAIN, toChain: ETH_CHAIN, inToken: USDT_HEDEF(), outToken: HISSE() })
        expect(gateMock.issuerCalls.at(-1)).toBeNull()
        expect(holder.instance.setupState.outStock).toBeNull()
        expect(html).not.toContain('data-stock-gate=')
        expect(devreDisi(miktarGirdisi(html))).toBe(false)
        expect(kapiEtiketleri(t)).not.toContain(anaCta(html).metin)
    })

    it('hedef BSC ama alinacak token hisse degil (USDT): bant yok, STATUS sorulmaz', async () => {
        const { html } = await ekran({ outToken: USDT_HEDEF() })
        expect(gateMock.issuerCalls.at(-1)).toBeNull()
        expect(html).not.toContain('data-stock-gate=')
        expect(gateMock.refresh).not.toHaveBeenCalled()
    })

    it('ihracci kaynagi reaktif: hedef zincir ya da token degisince yeniden hesaplanir', async () => {
        const { crypto } = await ekran()
        const kaynak = gateMock.getters.at(-1)
        expect(kaynak()).toBe('bstocks')
        crypto.bridge.toChain = ETH_CHAIN
        expect(kaynak()).toBeNull()
        crypto.bridge.toChain = BSC_CHAIN
        crypto.bridge.outToken = USDT_HEDEF()
        expect(kaynak()).toBeNull()
        crypto.bridge.outToken = HISSE()
        expect(kaynak()).toBe('bstocks')
    })

    it('hedef zincir secilmemis: bant yok, cokme yok', async () => {
        const { html } = await ekran({ toChain: null })
        expect(html).not.toContain('data-stock-gate=')
    })
})

describe('Bridge -- teklif ve ATS ucret teklifi kapi kapaliyken ISTENMEZ', () => {
    const miktarYaz = (i) => { i.setupState.amount = '1' }

    it('pozitif bekci: kapi ACIKKEN getBridgeData BRIDGE_QUOTE gonderir', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        gateMock.scenario = SENARYO.ok
        const { holder } = await ekran({ ilkDurum: miktarYaz })
        await holder.instance.setupState.getBridgeData()
        expect(turler('BRIDGE_QUOTE')).toHaveLength(1)
        expect(holder.instance.setupState.bridgeQuoteError).toBe(true)
    })

    it.each(KILITLI)('kapi %s: getBridgeData HICBIR BRIDGE_QUOTE gondermez, teklif temizlenir, yukleme kapanir', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { holder } = await ekran({ ilkDurum: miktarYaz })
        holder.instance.setupState.bridgeData = teklifKaydi()
        await holder.instance.setupState.getBridgeData()
        expect(turler('BRIDGE_QUOTE')).toEqual([])
        expect(holder.instance.setupState.bridgeData).toBeNull()
        expect(holder.instance.setupState.bridgeLoading).toBe(false)
        expect(holder.instance.setupState.bridgeQuoteError).toBe(false)
    })

    it('pozitif bekci: kapi ACIKKEN (Ethereum = ATS zinciri) refreshAtsOpFee ATS_BRIDGE_FEE_QUOTE gonderir', async () => {
        gateMock.scenario = SENARYO.ok
        yanit = async () => ({ success: false, error: 'x' })
        const { holder } = await ekran({ ilkDurum: (i) => { miktarYaz(i); i.setupState.bridgeData = teklifKaydi() } })
        await holder.instance.setupState.refreshAtsOpFee()
        expect(turler('ATS_BRIDGE_FEE_QUOTE')).toHaveLength(1)
    })

    it.each(KILITLI)('kapi %s: refreshAtsOpFee ATS_BRIDGE_FEE_QUOTE gondermez', async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const { holder } = await ekran({ ilkDurum: (i) => { miktarYaz(i); i.setupState.bridgeData = teklifKaydi() } })
        await holder.instance.setupState.refreshAtsOpFee()
        expect(turler('ATS_BRIDGE_FEE_QUOTE')).toEqual([])
    })

    it('P12: teklif yanitinda kapi sentineli (yaris) -> genel "teklif alinamadi" YOK, console.error YOK, bant yeniden sorulur', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        gateMock.scenario = SENARYO.ok
        yanit = async () => ({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        const { holder } = await ekran({ ilkDurum: miktarYaz })
        await holder.instance.setupState.getBridgeData()
        expect(gateMock.refresh).toHaveBeenCalledTimes(1)
        expect(holder.instance.setupState.bridgeQuoteError).toBe(false)
        expect(holder.instance.setupState.bridgeData).toBeNull()
        expect(hata).not.toHaveBeenCalled()
    })

    it('kontrol: baska hata bugunku gibi bridgeQuoteError + console.error uretir, kapi yeniden sorulmaz', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        yanit = async () => ({ success: false, error: 'No available quotes' })
        const { holder } = await ekran({ ilkDurum: miktarYaz })
        await holder.instance.setupState.getBridgeData()
        expect(holder.instance.setupState.bridgeQuoteError).toBe(true)
        expect(hata).toHaveBeenCalled()
        expect(gateMock.refresh).not.toHaveBeenCalled()
    })
})

describe('Bridge -- BRIDGE yaniti kapi retse genel "gonderim basarisiz" karti CIKMAZ', () => {
    it('kapi sentineli: true doner, bridgeError false, bant yeniden sorulur, sayfa bridge te kalir', async () => {
        const { holder } = await ekran()
        holder.instance.setupState.bridgeError = true
        const reddedildi = await holder.instance.setupState.rejectedByStockGate({ success: false, error: 'STOCK_GATE:CHECK_FAILED' })
        expect(reddedildi).toBe(true)
        expect(holder.instance.setupState.bridgeError).toBe(false)
        expect(gateMock.refresh).toHaveBeenCalledTimes(1)
        expect(pageStore().currentPage).toBe('bridge')
    })

    it.each([
        ['basari', { success: true }],
        ['baska hata', { success: false, error: 'bridge failed' }],
        ['undefined', undefined],
        ['null', null],
        ['kucuk harf onek', { success: false, error: 'stock_gate:IP_COUNTRY_ISSUER' }],
        ['dize olmayan hata', { success: false, error: 5 }],
    ])('%s: false doner (bugunku yol), refresh yok, bridgeError dokunulmaz', async (_ad, resp) => {
        const { holder } = await ekran()
        holder.instance.setupState.bridgeError = true
        expect(await holder.instance.setupState.rejectedByStockGate(resp)).toBe(false)
        expect(gateMock.refresh).not.toHaveBeenCalled()
        expect(holder.instance.setupState.bridgeError).toBe(true)
    })
})

describe('Bridge -- isValid() ve bridge(): diger TUM kosullar saglanmisken kapi tek basina belirler', () => {
    // Tam gecerli durum: tutar, teklif, ATS kolu hazir, bakiye yeterli. (Tum EVM aglari ATS zinciridir: payWithAts true.)
    const hazirla = (i) => {
        i.setupState.amount = '1'
        i.setupState.bridgeData = teklifKaydi()
        i.setupState.atsReady = true
        i.setupState.insufficientBalance = false
    }
    const hazirEkran = async (durum) => {
        gateMock.scenario = SENARYO[durum]
        const e = await ekran()
        hazirla(e.holder.instance)
        return e
    }

    it.each([
        ['ok', true], ['warn', true], ['checking', false], ['blocked', false], ['precaution', false],
        ['unknown', false], ['killSwitch', false], ['error', false],
    ])(
        'isValid() kapi %s iken %s', async (durum, beklenen) => {
            const { holder } = await hazirEkran(durum)
            expect(holder.instance.setupState.isValid()).toBe(beklenen)
        })

    it('pozitif bekci: kapi ACIKKEN bridge() BRIDGE gonderir; kapi sentineli yanitinda genel kart CIKMAZ, bant yeniden sorulur', async () => {
        yanit = async () => ({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        const { holder } = await hazirEkran('ok')
        await holder.instance.setupState.bridge()
        expect(turler('BRIDGE')).toHaveLength(1)
        expect(holder.instance.setupState.bridgeError).toBe(false)
        expect(gateMock.refresh).toHaveBeenCalledTimes(1)
        expect(pageStore().currentPage).toBe('bridge')
    })

    it('kontrol: baska hata bugunku gibi bridgeError uretir ve kapi yeniden sorulmaz', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        yanit = async () => ({ success: false, error: 'bridge failed' })
        const { holder } = await hazirEkran('ok')
        await holder.instance.setupState.bridge()
        expect(turler('BRIDGE')).toHaveLength(1)
        expect(holder.instance.setupState.bridgeError).toBe(true)
        expect(gateMock.refresh).not.toHaveBeenCalled()
    })

    it('pozitif bekci: kapi ACIKKEN ana dugme onPrimary() bridge() calistirir (BRIDGE gider, sayfa bridge te kalir)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        yanit = async () => ({ success: false, error: 'bridge failed' })
        const { holder } = await hazirEkran('ok')
        await holder.instance.setupState.onPrimary()
        expect(turler('BRIDGE')).toHaveLength(1)
        expect(pageStore().currentPage).toBe('bridge')
    })

    it.each(KILITLI)('kapi %s: bridge() HICBIR BRIDGE gondermez (buton disabled olmasa bile)', async (durum) => {
        const { holder } = await hazirEkran(durum)
        await holder.instance.setupState.bridge()
        expect(turler('BRIDGE')).toEqual([])
        expect(holder.instance.setupState.loading).toBe(false)
    })
})

describe('Bridge -- kaynak kilitleri', () => {
    const bridgeGovdesi = blokGovdesi(KAYNAK, /const bridge = async\(\) =>/) || ''
    const getBridgeDataGovdesi = blokGovdesi(KAYNAK, /const getBridgeData = async\(\) =>/) || ''
    const atsGovdesi = blokGovdesi(KAYNAK, /const refreshAtsOpFee = async \(\) =>/) || ''
    const isValidGovdesi = blokGovdesi(KAYNAK, /const isValid = \(\) =>/) || ''
    const sablon = yorumsuz(KAYNAK)

    it('bridge(): kapi denetimi `loading = true` ve ag istegindan ONCE; yanit OKUNUR ve kapi reddi basari dalindan ONCE', () => {
        const kapi = bridgeGovdesi.indexOf('if(!stockGateOpen.value) return')
        const yukleme = bridgeGovdesi.indexOf('loading.value = true')
        const gonder = bridgeGovdesi.indexOf("type: 'BRIDGE', message })")
        const red = bridgeGovdesi.indexOf('if(await rejectedByStockGate(resp)) return')
        const basari = bridgeGovdesi.indexOf('if(success || unverified) {')
        expect(kapi).toBeGreaterThan(-1)
        expect(kapi).toBeLessThan(yukleme)
        expect(yukleme).toBeLessThan(gonder)
        expect(red).toBeGreaterThan(gonder)
        expect(basari).toBeGreaterThan(red)
    })

    it('getBridgeData ve refreshAtsOpFee: kapi denetimi ilk ag istegindan ONCE; isValid kapiyi icerir', () => {
        expect(getBridgeDataGovdesi.indexOf('stockGateOpen.value')).toBeGreaterThan(-1)
        expect(getBridgeDataGovdesi.indexOf('stockGateOpen.value')).toBeLessThan(getBridgeDataGovdesi.indexOf('chrome.runtime.sendMessage'))
        expect(atsGovdesi.indexOf('stockGateOpen.value')).toBeGreaterThan(-1)
        expect(atsGovdesi.indexOf('stockGateOpen.value')).toBeLessThan(atsGovdesi.indexOf('loadAtsOpFee('))
        expect(isValidGovdesi).toContain('!stockGateOpen.value')
    })

    it('ATS "teklif alinamadi" karti STOCK_GATE kodunda cizilmez', () => {
        expect(sablon).toMatch(/atsError && atsErrorCode !== 'STOCK_GATE' && \(!atsDecision/)
    })

    it('bant HEDEF zincir kaynakli (sayfa gecisi prop u yok); aktif ag (network.currentNetwork) kullanilmaz', () => {
        expect(sablon).toMatch(/<StockGateBand v-if="outStock" :gate="stockGate" :issuer="outStock\.issuer" \/>/)
        // K42: arayuz aynasi arka planla AYNI aramayi kullanir (stockOutputIssuer: katalog + emekli); yalniz katalog bilen stockEntry geri gelmez.
        expect(sablon).toMatch(/stockOutputIssuer\(crypto\.bridge\.toChain\?\.chainId, crypto\.bridge\.outToken\?\.address\)/)
        expect(sablon).not.toMatch(/stockOutputIssuer\(network\./)
        expect(sablon).not.toMatch(/stockEntry\(/)
    })

    it('kapi derleme bayragina BAGLI DEGIL: Bridge.vue featureFlags import etmez', () => {
        expect(sablon).not.toContain('featureFlags')
    })

    it('ana CTA etiketi gateCtaOf ten gelir; tiklama onPrimary e bagli ve kapali kapida HER ZAMAN pasif (:disabled !isValid()); onPrimary yalniz bridge() calistirir (K32)', () => {
        expect(sablon).toMatch(/<span v-else-if="!stockGateOpen">\{\{ \$t\(gateCta\.labelKey\) \}\}/)
        expect(sablon).not.toContain('stockGate.cta.locked')
        expect(sablon).toContain('const gateCta = computed(() => gateCtaOf(stockGate))')
        expect(sablon).toContain('@click="onPrimary"')
        expect(sablon).toContain(':disabled="!isValid()"')
        expect(sablon).toContain(':class="isValid()')
        expect(sablon).not.toMatch(/\(isValid\(\) \|\|/)
        expect(sablon).toContain('const onPrimary = () => bridge()')
    })

    it('kaynakta openGate|gateActionCta|leavingForGate|stock_gate yok (beyan ekranina gidis yolu tamamen kalkti)', () => {
        expect(sablon).toContain('const gateCta = computed(() => gateCtaOf(stockGate))') // pozitif bekci: tarama gercek kaynagi goruyor
        expect(sablon).not.toMatch(/openGate|gateActionCta|leavingForGate|stock_gate|goToGate|return-page|returnPage/)
        expect(sablon).not.toContain("mode === 'action'")
    })
})

// K32: beyan ekranina gidis kalkti (R22'nin "form beyan ekraninda korunur" gerekcesi sona erdi). Bridge.vue onUnmounted ta
// crypto.bridge i TEMIZLEMEZ ve sayfa deposunu yazmaz; kapali kapida ana CTA tiklamasi da secili tokenlari ve hedef zinciri
// AYNEN birakir (yukaridaki "hicbir sey degistirmez" testi).
describe('Bridge -- onUnmounted: zamanlayici + dinleyici temizler; crypto.bridge i ve sayfa deposunu YAZMAZ', () => {
    const unmountKod = yorumsuz(blokGovdesi(KAYNAK, /onUnmounted\(\(\) =>\s*/) || '')

    it('onUnmounted: zamanlayici + dinleyici temizler, crypto.bridge i ve sayfa deposunu YAZMAZ', () => {
        expect(unmountKod).toContain('clearInterval(bridgeInterval)')
        expect(unmountKod).toContain('removeEventListener')
        expect(unmountKod).not.toMatch(/crypto\.bridge\.\w+\s*=[^=]/)
        expect(unmountKod).not.toMatch(/currentPage\s*=[^=]/)
        expect(unmountKod).not.toContain('leavingForGate')
    })

    it('Bridge currentPage e yalniz home yazar (basari donusu); baska sayfa yazimi yok', () => {
        const sablon = yorumsuz(KAYNAK)
        const yazimlar = [...sablon.matchAll(/currentPage\s*=[^=]\s*'?([\w]+)/g)].map((m) => m[1])
        expect(yazimlar.length).toBeGreaterThan(0)
        expect([...new Set(yazimlar)]).toEqual(['home'])
    })
})

// Emekli hisseler (K28, K42; main senkronu 22f4f686 denetimi, madde G): arayuz aynasi arka plan kapisiyla AYNI aramayi (stockOutputIssuer: katalog +
// emekli listeler) kullanir. Eskiden `stockEntry` (yalniz katalog) kullaniliyordu: hedef emekli bir bStock iken bant gorunmez, miktar acik kalir ve
// arka plan koprusunu reddederdi.
describe('Bridge (SSR) -- hedef emekli bStocks (BMNRB, FLNCB) ve emekli xStocks kapi aynasini AYNEN gosterir (K42)', () => {
    const emekli = (liste, sembol) => liste.find((r) => r.symbol === sembol).address
    const EMEKLILER = [
        ['BMNRB', 'bstocks', emekli(RETIRED_BSTOCKS, 'BMNRB')],
        ['FLNCB', 'bstocks', emekli(RETIRED_BSTOCKS, 'FLNCB')],
        ['PYPLx', 'xstocks', emekli(RETIRED_XSTOCKS, 'PYPLx')],
    ]

    it.each(EMEKLILER)('Ethereum aktif + BSC hedef + emekli %s: outStock ihraccisi %s, bant gorunur, miktar / ana CTA PASIF', async (sembol, ihracci, adres) => {
        gateMock.scenario = SENARYO.blocked
        const { html, holder } = await ekran({ aktifAg: ETH_CHAIN, toChain: BSC_CHAIN, outToken: token({ name: sembol, symbol: sembol.toLowerCase(), address: adres, decimals: 18 }) })
        expect(holder.instance.setupState.outStock).toEqual({ issuer: ihracci })
        expect(gateMock.issuerCalls.at(-1)).toBe(ihracci)
        expect(html).toContain('data-stock-gate="blocked"')
        expect(devreDisi(miktarGirdisi(html))).toBe(true)
        expect(devreDisi(anaCta(html))).toBe(true)
    })

    it('hedef zincir BSC DISI (Ethereum) ve AYNI emekli bStock adresi: bStocks yalniz BSC de vardir, hisse DEGIL -> bant yok, ihracci null', async () => {
        gateMock.scenario = SENARYO.blocked // sorulsaydi kilitlerdi: sorulmamali
        const { html, holder } = await ekran({ aktifAg: BSC_CHAIN, toChain: ETH_CHAIN, inToken: USDT_HEDEF(), outToken: token({ name: 'BMNRB', symbol: 'bmnrb', address: emekli(RETIRED_BSTOCKS, 'BMNRB'), decimals: 18 }) })
        expect(holder.instance.setupState.outStock).toBeNull()
        expect(html).not.toContain('data-stock-gate=')
        expect(gateMock.issuerCalls.at(-1)).toBeNull()
    })
})
