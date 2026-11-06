import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const api = vi.hoisted(() => ({ post: null }))
vi.mock('axios', () => ({ default: { post: (...a) => api.post(...a) } }))

import { getAddress } from 'ethers'
import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { ATS_CHAINS } from '../../utils/atsConfig'
import PrivateDeliveryTokenPicker from './PrivateDeliveryTokenPicker.vue'

// GIZLI HESAP'A TESLIM DEGISMEZI (1.10, sahip karari 2026-10-30): Gizli Hesap'a teslim edilen varlik yalniz Gonder ile cikabilir. Ag ucreti
// ATS ile odenir, yerel coin gaz istisnasi YOKTUR. Para yukle, Takas ve Kopru modlarinda secici yalniz o agdaki Gonder kaynagi varliklarini
// listeler (yerel coin yalniz kendisi Gonder kaynagiysa); Gonder modunda (alici dis adres) suzme YOK, mevcut davranis.
const USDT_ETH = getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')
const DAI_ETH = getAddress('0x6B175474E89094C44Da98b954EedeAC495271d0F')
// Gizli modda logosuz satir gosterilmez: "rastgele" sunucu/ice aktarilan tokenlari PAKETLI (ag, adres) ciftleridir ki kipin kendi suzmesi sinansin
// (logosuz bir token zaten hicbir kipte listelenmez; o kural PrivateDeliveryTokenPicker.hide.ssr.test.js'te).
const RASTGELE = getAddress('0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3') // Ethereum, paketli
const RASTGELE_BSC = getAddress('0x0782b6d8c4551b9760e74c0545a9bcd90bdc41e5') // BSC, paketli
const ATS = ATS_CHAINS[56].token

afterEach(() => { delete globalThis.chrome })

function mount(props, remote, imported = []) {
    installChromeStub({ active_account: { key: 'g-1' }, imported_tokens: { 'g-1': { [String(props.chainId)]: imported } } })
    api.post = async () => ({ data: { tokens: remote } })
    const app = createApp(PrivateDeliveryTokenPicker, { props: { nativeEnabled: true, selected: null, onSelect: () => {}, onClose: () => {}, ...props } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    return app
}
const semboller = (html) => [...html.matchAll(/<span class="block text-sm font-bold truncate">([^<]*)<\/span>/g)].map((m) => m[1])

describe.each(['fund', 'swap', 'bridge'])('PrivateDeliveryTokenPicker mode=%s: yalniz Gonder kaynagi varliklari (yerel coin istisnasi yok)', (mode) => {
    const REMOTE_ETH = [
        { address: USDT_ETH, symbol: 'USDT', name: 'Tether', decimals: 6 },
        { address: DAI_ETH, symbol: 'DAI', name: 'Dai', decimals: 18 },
        { address: RASTGELE, symbol: 'RAND', name: 'Rastgele', decimals: 18 },
    ]
    const IMPORTED_ETH = [{ address: getAddress('0x514910771af9ca656af840dff83e8264ecf986ca'), symbol: 'IMP', name: 'Iceri', decimals: 18 }]

    it('Ethereum: ETH, USDC, USDT, DAI listelenir; rastgele sunucu tokeni ve ice aktarilan token listelenmez', async () => {
        const html = await render(mount({ chainId: 1, mode }, REMOTE_ETH, IMPORTED_ETH))
        expect(semboller(html).sort()).toEqual(['DAI', 'ETH', 'USDC', 'USDT'])
    })

    it('BSC: yalniz USDC; BNB (Gonder kaynagi degil, gaz ATS ile odenir) ve ATS listelenmez', async () => {
        const html = await render(mount({ chainId: 56, mode }, [{ address: ATS.address, symbol: ATS.symbol, name: 'ATS', decimals: ATS.decimals }]))
        expect(semboller(html)).toEqual(['USDC'])
    })

    it('Polygon: POL Gonder kaynagi olmadigi icin listelenmez; yalniz USDC', async () => {
        const html = await render(mount({ chainId: 137, mode }, []))
        expect(semboller(html)).toEqual(['USDC'])
    })

    it.each([[100, 'xDAI'], [42220, 'CELO'], [5000, 'MNT'], [25, 'CRO']])('%s: yerel coin (%s) Gonder kaynagi degil, listelenmez', async (chainId, yerel) => {
        const html = await render(mount({ chainId, mode }, []))
        expect(semboller(html)).toEqual(['USDC'])
        expect(semboller(html)).not.toContain(yerel)
    })

    it(`${mode} modunda sunucu listesindeki rastgele token hicbir sekilde listelenmez`, async () => {
        const html = await render(mount({ chainId: 1, mode }, REMOTE_ETH))
        expect(semboller(html)).not.toContain('RAND')
    })
})

describe('PrivateDeliveryTokenPicker mode=send ya da mode yok: suzme YOK (alici dis adres, mevcut davranis)', () => {
    const REMOTE = [{ address: RASTGELE_BSC, symbol: 'RAND', name: 'Rastgele', decimals: 18 }]
    it.each([['send'], [undefined]])('mode=%s: BSC listesinde ATS ve sunucu tokeni durur', async (mode) => {
        const html = await render(mount({ chainId: 56, ...(mode ? { mode } : {}) }, REMOTE))
        const s = semboller(html)
        expect(s).toEqual(expect.arrayContaining(['BNB', 'USDC', ATS.symbol, 'RAND']))
    })
})
