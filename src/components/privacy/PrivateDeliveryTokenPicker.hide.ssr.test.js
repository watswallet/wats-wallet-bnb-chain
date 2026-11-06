import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const api = vi.hoisted(() => ({ post: null }))
vi.mock('axios', () => ({ default: { post: (...a) => api.post(...a) } }))

import { getAddress } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import PrivateDeliveryTokenPicker from './PrivateDeliveryTokenPicker.vue'

// GIZLI MODDA LOGOSUZ SATIR GOSTERILMEZ (sahip karari 2026-11-03): teslim token secicisi HER kipte (Gonder, Para yukle, Takas, Kopru), ice aktarilan
// ve sunucu (arama dahil) satirlari icin ayni testi (hasPrivateLogo) uygular; gri yer tutucu cizilmez. Test girdisinin "logolu" kismi PAKETLI
// (ag, adres) ciftleridir; "logosuz" olanlar paketsiz rastgele adreslerdir.
const LINK = getAddress('0x514910771af9ca656af840dff83e8264ecf986ca') // Ethereum, paketli
const NOLOGO = getAddress('0x' + '42'.repeat(20))
const NOLOGO_IMPORTED = getAddress('0x' + '43'.repeat(20))
const NOLOGO_SEARCH = getAddress('0x' + '44'.repeat(20))
const USDT = getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')
const REMOTE = [
    { address: LINK, symbol: 'LINK', name: 'Chainlink', decimals: 18, image: { large: 'https://img.example/link.png' } },
    { address: USDT, symbol: 'USDT', name: 'Tether', decimals: 6, image: { large: 'https://img.example/usdt.png' } },
    { address: NOLOGO, symbol: 'NOLOGO', name: 'Logosuz', decimals: 18, image: { large: 'https://img.example/nologo.png' } },
]

afterEach(() => { delete globalThis.chrome })

function mount({ mode = 'send', chainId = 1, remote = REMOTE, search } = {}) {
    installChromeStub({
        active_account: { key: 'g-1' },
        imported_tokens: { 'g-1': { 1: [{ address: NOLOGO_IMPORTED, symbol: 'IMPNOLOGO', name: 'Iceri logosuz', decimals: 18 }, { address: getAddress('0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3'), symbol: 'IMPLOGO', name: 'Iceri logolu', decimals: 18 }] } },
    })
    api.post = async (url, body) => ({ data: { tokens: body.search ? (search ?? []) : remote } })
    const app = createApp(PrivateDeliveryTokenPicker, { props: { chainId, mode, nativeEnabled: true, selected: null, onSelect: () => {}, onClose: () => {} } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'PrivateDeliveryTokenPicker')
    return { app, captured }
}
const semboller = (html) => [...html.matchAll(/<span class="block text-sm font-bold truncate">([^<]*)<\/span>/g)].map((m) => m[1])

describe('teslim token secicisi: logosuz satir hicbir kipte cizilmez', () => {
    it.each(['send', 'fund', 'swap', 'bridge'])('%s: sunucu satiri NOLOGO ve ice aktarilan IMPNOLOGO gizli; gri yer tutucu yok', async (mode) => {
        const { app } = mount({ mode })
        const html = await render(app)
        const s = semboller(html)
        expect(s, mode).not.toContain('NOLOGO')
        expect(s, mode).not.toContain('IMPNOLOGO')
        expect(html, mode).not.toContain('/default-token.png')
        expect(s, mode).toEqual(expect.arrayContaining(['ETH', 'USDC', 'USDT']))
    })

    it('Gonder: logolu ice aktarilan ve logolu sunucu satiri GORUNUR (yalniz logosuzlar elenir)', async () => {
        const s = semboller(await render(mount({ mode: 'send' }).app))
        expect(s).toEqual(expect.arrayContaining(['LINK', 'IMPLOGO']))
    })

    it('Para yukle / Takas / Kopru: kipin kendi suzmesi duruyor (logolu ama teslim edilemeyen LINK ve IMPLOGO yine yok)', async () => {
        for (const mode of ['fund', 'swap', 'bridge']) {
            const s = semboller(await render(mount({ mode }).app))
            expect(s, mode).not.toContain('LINK')
            expect(s, mode).not.toContain('IMPLOGO')
        }
    })

    it('sunucu aramasi sonucu da suzulur: logosuz arama sonucu cizilmez, logolu olan gorunur', async () => {
        const { app, captured } = mount({ mode: 'send', search: [{ address: NOLOGO_SEARCH, symbol: 'SEARCHNO', name: 'Aranan logosuz', decimals: 18 }, REMOTE[0]] })
        await render(app)
        const s = captured.instance.setupState
        s.search = 'lin'
        await s.loadRemote('lin')
        const symbols = s.tokens.map((t) => t.symbol)
        expect(symbols).not.toContain('SEARCHNO')
        expect(symbols).toContain('LINK')
    })

    it('hic logolu sonuc kalmazsa "Token bulunamadi" metni cikar (bos liste cokmez)', async () => {
        const { app, captured } = mount({ mode: 'send', search: [{ address: NOLOGO_SEARCH, symbol: 'SEARCHNO', name: 'Aranan', decimals: 18 }] })
        await render(app)
        const s = captured.instance.setupState
        s.search = 'zzz'
        await s.loadRemote('zzz')
        expect(s.tokens).toEqual([])
    })

    it('kaynak: filtre TEK ortak testten (hasPrivateLogo), satirlar select icin yine { chainId, address, symbol, decimals } yayar', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateDeliveryTokenPicker.vue', import.meta.url)), 'utf8'))
        expect(kaynak).toMatch(/hasPrivateLogo\(\{ chainId: scopeChainId\.value, address: t\.address, symbol: t\.symbol \}\)/)
        const transfer = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTransfer.vue', import.meta.url)), 'utf8'))
        expect(transfer).toMatch(/sourcePairs\(sourceChains\.value\)\.filter\(\(p\) => hasPrivateLogo\(\{ chainId: p\.chainId, symbol: p\.asset \}\)\)/)
    })
})
