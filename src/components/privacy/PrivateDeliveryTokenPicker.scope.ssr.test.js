import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const api = vi.hoisted(() => ({ post: null }))
vi.mock('axios', () => ({ default: { post: (...a) => api.post(...a) } }))

import { getAddress } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { setLocalLogosOnly } from '../../utils/tokenLogo'
import PrivateDeliveryTokenPicker from './PrivateDeliveryTokenPicker.vue'

// Ag kapsam cipleri (sade ekran plani T10, K2/sT19): secici acik agin listesini ag cipleriyle degistirir. Liste istegi
// ag basina (10 agin listesi tek istekte birlestirilmez), varsayilan sayfa ag basina onbellekli, ice aktarilanlar
// kapsam agin kovasindan, secim olayi kapsam agin kimligini tasir (PF-C3).
const BSC = { chainId: 56, name: 'BNB Smart Chain', logo: '/chains/56.png' }
const BASE = { chainId: 8453, name: 'Base', logo: '/chains/8453.png' }
const ARB = { chainId: 42161, name: 'Arbitrum One', logo: '/chains/42161.png' }
const CAKE = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
const BASE_USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
// Gizli modda logosuz satir gosterilmez: fixture tokenlari PAKETLI (ag, adres) ciftleridir (public/tokens).
const AERO = getAddress('0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf')
const XYZ = getAddress('0x00f8da33734feb9b946fec2228c25072d2e2e41f')
const BX = getAddress('0x940181a94a35a4569e4529a3cdfb74e38fd98631')
const BSC_REMOTE = [{ address: CAKE.toLowerCase(), symbol: 'CAKE', name: 'PancakeSwap', decimals: 18 }]
const BASE_REMOTE = [
    { address: BASE_USDC.toLowerCase(), symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: AERO, symbol: 'AERO', name: 'Aerodrome', decimals: 18 },
]

afterEach(() => { delete globalThis.chrome; setLocalLogosOnly(false) })

function mount({ chains, chainId = 56, post } = {}) {
    installChromeStub({
        active_account: { key: 'g-1' },
        imported_tokens: { 'g-1': {
            56: [{ address: XYZ, symbol: 'XYZ', name: 'Xyz Token', decimals: 9 }],
            8453: [{ address: BX, symbol: 'BX', name: 'Base Token', decimals: 8 }],
        } },
    })
    const calls = []
    api.post = post || (async (url, body) => {
        calls.push(body)
        return { data: { tokens: body.chainId === 8453 ? BASE_REMOTE : BSC_REMOTE } }
    })
    const events = { select: [], logos: [] }
    const props = { chainId, nativeEnabled: true, selected: null, onSelect: (t, logo) => { events.select.push(t); events.logos.push(logo) }, onClose: () => {} }
    if (chains) props.chains = chains
    const app = createApp(PrivateDeliveryTokenPicker, { props })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'PrivateDeliveryTokenPicker')
    return { app, captured, calls, events }
}

const chipButtons = (html) => [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map((m) => ({ pressed: m[1], inner: m[2] }))
const imgSrcs = (html) => [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)].map((m) => m[1])
const rowOf = (html, symbol) => html.split('<li').find((p) => p.includes(`>${symbol}<`)) || ''
const yerelYol = (d) => typeof d === 'string' && d.startsWith('/') && !d.startsWith('//')
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('PrivateDeliveryTokenPicker -- ag kapsam cipleri', () => {
    it('chains verilmezse eski davranis: cip satiri yok', async () => {
        const html = await render(mount().app)
        expect(chipButtons(html)).toHaveLength(0)
        expect(html).not.toContain('aria-pressed')
        expect(html).not.toContain('data-testid="scope-chips"')
    })

    it('chains = [BSC, Base]: iki cip; baslangic chainId cipi aria-pressed=true, digeri false; logo ve ad var', async () => {
        const html = await render(mount({ chains: [BSC, BASE] }).app)
        const chips = chipButtons(html)
        expect(chips).toHaveLength(2)
        expect(chips[0].pressed).toBe('true')
        expect(chips[0].inner).toContain('BNB Smart Chain')
        expect(chips[0].inner).toContain('src="/chains/56.png"')
        expect(chips[1].pressed).toBe('false')
        expect(chips[1].inner).toContain('Base')
        expect(chips[1].inner).toContain('src="/chains/8453.png"')
    })

    it('baslangic chainId listenin ikinci aginda ise o cip basili', async () => {
        const html = await render(mount({ chains: [BSC, BASE], chainId: 8453, post: async (u, b) => ({ data: { tokens: BASE_REMOTE } }) }).app)
        const chips = chipButtons(html)
        expect(chips.map((c) => c.pressed)).toEqual(['false', 'true'])
    })

    it('cip satiri yatay kaymaz: flex-wrap var, overflow-x-auto yok', async () => {
        const html = await render(mount({ chains: [BSC, BASE] }).app)
        const m = html.match(/<div[^>]*data-testid="scope-chips"[^>]*>/)
        expect(m).not.toBeNull()
        expect(m[0]).toContain('flex-wrap')
        expect(m[0]).not.toContain('overflow-x-auto')
    })

    it('tek aglik chains: cip satiri yok', async () => {
        const html = await render(mount({ chains: [BSC] }).app)
        expect(chipButtons(html)).toHaveLength(0)
        expect(html).not.toContain('aria-pressed')
    })

    it('selectScope(8453): istek Base chainId ve slug ile gider; liste Base tokenlarina doner; BSC satirlari kalkar; arama temizlenir', async () => {
        const { app, captured, calls } = mount({ chains: [BSC, BASE] })
        await render(app)
        const s = captured.instance.setupState
        expect(calls).toEqual([{ chain: 'binance-smart-chain', chainId: 56, skip: 0, limit: 100 }])
        s.search = 'ca'
        await s.selectScope(8453)
        expect(calls).toHaveLength(2)
        expect(calls[1]).toEqual({ chain: 'base', chainId: 8453, skip: 0, limit: 100 })
        expect(s.scopeChainId).toBe(8453)
        expect(s.search).toBe('')
        expect(s.tokens.map((t) => t.symbol)).toEqual(['ETH', 'USDC', 'BX', 'AERO'])
    })

    it('ayni aga ikinci gecis ag istegi atmaz (ag basina onbellek); eski aga donus da onbellekten', async () => {
        const { app, captured, calls } = mount({ chains: [BSC, BASE] })
        await render(app)
        const s = captured.instance.setupState
        await s.selectScope(8453)
        expect(calls).toHaveLength(2)
        await s.selectScope(56)
        expect(calls).toHaveLength(2)
        expect(s.tokens.map((t) => t.symbol)).toEqual(['BNB', 'USDC', 'ATS', 'XYZ', 'CAKE'])
        await s.selectScope(8453)
        expect(calls).toHaveLength(2)
        expect(s.tokens.map((t) => t.symbol)).toContain('AERO')
        expect(s.loading).toBe(false)
    })

    it('yavas eski ag yaniti yeni agin listesini ezmez (requestSeq)', async () => {
        let releaseBase
        const calls = []
        const { app, captured } = mount({ chains: [BSC, BASE, ARB], post: (url, body) => {
            calls.push(body.chainId)
            if (body.chainId === 8453) return new Promise((r) => { releaseBase = () => r({ data: { tokens: BASE_REMOTE } }) })
            return Promise.resolve({ data: { tokens: body.chainId === 42161 ? [{ address: getAddress('0x539bde0d7dbd336b79148aa742883198bbf60342'), symbol: 'ARBT', name: 'Arb Tok', decimals: 18 }] : BSC_REMOTE } })
        } })
        await render(app)
        const s = captured.instance.setupState
        const yavas = s.selectScope(8453)
        await flush()
        await s.selectScope(42161)
        expect(s.tokens.map((t) => t.symbol)).toContain('ARBT')
        releaseBase()
        await yavas
        await flush()
        expect(s.scopeChainId).toBe(42161)
        expect(s.tokens.map((t) => t.symbol)).toContain('ARBT')
        expect(s.tokens.map((t) => t.symbol)).not.toContain('AERO')
        expect(s.loading).toBe(false)
        expect(calls).toEqual([56, 8453, 42161])
    })

    it('secim kapsam agin kimligini yayar: baslangic prop 56 olsa bile Base kapsaminda chainId 8453', async () => {
        const { app, captured, events } = mount({ chains: [BSC, BASE] })
        await render(app)
        const s = captured.instance.setupState
        await s.selectScope(8453)
        s.choose(s.tokens.find((t) => t.symbol === 'USDC'))
        s.choose({ ...s.tokens.find((t) => t.symbol === 'AERO'), chainId: 56 })
        expect(events.select).toEqual([
            { chainId: 8453, address: BASE_USDC, symbol: 'USDC', decimals: 6 },
            { chainId: 8453, address: AERO, symbol: 'AERO', decimals: 18 },
        ])
    })

    it('ice aktarilan tokenler yalniz kapsam agin kovasindan listelenir', async () => {
        const { app, captured } = mount({ chains: [BSC, BASE] })
        const html = await render(app)
        expect(html).toContain('>XYZ<')
        expect(html).not.toContain('>BX<')
        const s = captured.instance.setupState
        await s.selectScope(8453)
        const semboller = s.tokens.map((t) => t.symbol)
        expect(semboller).toContain('BX')
        expect(semboller).not.toContain('XYZ')
        await s.selectScope(56)
        expect(s.tokens.map((t) => t.symbol)).toContain('XYZ')
        expect(s.tokens.map((t) => t.symbol)).not.toContain('BX')
    })

    it('her satirda kapsam aginin yerel rozeti: ana logodan SONRA gelir ve yerel yoldur', async () => {
        const html = await render(mount({ chains: [BSC, BASE] }).app)
        const cake = rowOf(html, 'CAKE')
        const srcs = imgSrcs(cake)
        expect(srcs).toHaveLength(2)
        expect(srcs[1]).toBe('/chains/56.png')
        // BNB satirinin ilk gorseli yine ana logodur.
        expect(imgSrcs(rowOf(html, 'BNB'))[0]).toBe('/chains/56.png')
    })

    it('gizli modda butun gorseller yerel (cipler ve rozetler dahil)', async () => {
        setLocalLogosOnly(true)
        const html = await render(mount({ chains: [BSC, BASE] }).app)
        const srcs = imgSrcs(html)
        expect(srcs.length).toBeGreaterThanOrEqual(6)
        for (const src of srcs) expect(yerelYol(src), src).toBe(true)
        expect(html).not.toContain('http')
    })

    it('cip satiri kaynak kilidi: cipler tiklamada selectScope cagirir', async () => {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')
        const kaynak = readFileSync(fileURLToPath(new URL('./PrivateDeliveryTokenPicker.vue', import.meta.url)), 'utf8')
        expect(kaynak).toMatch(/@click="selectScope\(c\.chainId\)"/)
        expect(kaynak).toContain('v-if="chains.length > 1"')
    })
})
