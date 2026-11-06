// History.vue (SSR) -- GIZLI MOD (gizli-mod cok-ag spec 4.7 satir 8 ve 22, "Aktivite sekmesi"):
//   1) Moralis'in verdigi uzak gorsel URL'leri (`to_address_entity_logo`, `token_logo`) ozel modda CIZILMEZ; mevcut
//      v-if/else yedekleri (durum simgesi, sembol metni) devreye girer;
//   2) sunucunun gecmis vermedigi aglarda (100, 42220, 5000, 25; teslim tablosunda olmayan 43114 dahil, PF-DD1)
//      `/wallet/history` CAGRILMAZ: liste yerel bekleyen kartlarla sinirli kalir ve kisa not cikar; desteklenen
//      aglarda istek eskisi gibi gider;
//   3) grafit karari (kullanici, 2026-10-26): takas satirinin durum dairesi giden islemle ayni notr rozeti alir.
// Normal modda hepsi eskisi gibi: her iddianin bir KONTROL cifti vardir (yoksa "yok" iddiasi bos gecerdi).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn(async () => ({ data: { history: [] } }))
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import History from './History.vue'
import supported_chains from '../data/supported_chains.json'

const chain = (id) => supported_chains.find((c) => c.chainId === id)
// supported_chains.json'da olmayan ag icin (43114) en kucuk ag kaydi.
const agOf = (id) => chain(id) ?? { chainId: id, name: `Chain ${id}`, rpc: [{ url: 'https://rpc.example' }] }
const ETH = chain(1)
const BSC = chain(56)
const GNOSIS = chain(100)

const ME = '0xCcccCccc00000000000000000000000000000003'
const REMOTE_ENTITY = 'https://cdn.example/entity-logo.png'
const REMOTE_SEND = 'https://cdn.example/send-token.png'
const REMOTE_RECEIVE = 'https://cdn.example/receive-token.png'

const gorunurMetin = (html) => html.replace(/<[^>]*>/g, ' ')
const imgKaynaklari = (html) => [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])
const uzakMi = (src) => /^(https?:)?\/\//.test(src)

const apiSatiri = {
    hash: '0x' + 'aa'.repeat(32), chainId: 56, from_address: ME, to_address: '0x' + '11'.repeat(20),
    category: 'send', receipt_status: '1', block_timestamp: new Date().toISOString(),
    to_address_entity_logo: REMOTE_ENTITY, native_transfers: [], erc20_transfers: [],
}
const takasSatiri = {
    hash: '0x' + 'bb'.repeat(32), chainId: 56, from_address: ME, to_address: '0x' + '22'.repeat(20),
    category: 'token swap', receipt_status: '1', block_timestamp: new Date().toISOString(),
    native_transfers: [],
    erc20_transfers: [
        { direction: 'send', token_symbol: 'CAKE', token_logo: REMOTE_SEND, value_formatted: '1.5', log_index: 1 },
        { direction: 'receive', token_symbol: 'USDT', token_logo: REMOTE_RECEIVE, value_formatted: '2', log_index: 2 },
    ],
}
const bekleyen = {
    hash: '0x' + 'cc'.repeat(32), chainId: 100, from_address: ME, to_address: '0x' + '33'.repeat(20),
    category: 'send', receipt_status: 'pending', value: '1', block_timestamp: new Date().toISOString(),
}

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockReset()
    axiosPostMock.mockImplementation(async () => ({ data: { history: [] } }))
    delete globalThis.chrome
})

/** `gizli`: privacyStore().active (installPrivacySync'in yaptigi gibi). `secilen`: modal icin selectedTx. */
async function mountHistory({ gizli, ag = BSC, pending = [], secilen = null } = {}) {
    installChromeStub({ currentNetwork: ag, active_account: { address: ME }, pending_transactions: pending })
    const app = createApp(History, { props: { embedded: true } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ag
    privacyStore().active = gizli
    const captured = captureInstance(app, 'History', (instance) => {
        if (secilen) instance.setupState.selectedTx = secilen
    })
    const html = await render(app)
    return { html, state: captured.instance.setupState }
}

describe('History.vue (SSR) -- uzak gorseller (satir 22)', () => {
    it('KONTROL: normal modda liste satirinda varlik logosu uzak URL ile cizilir', async () => {
        axiosPostMock.mockResolvedValue({ data: { history: [apiSatiri] } })
        const { html } = await mountHistory({ gizli: false })
        expect(imgKaynaklari(html)).toContain(REMOTE_ENTITY)
    })

    it('KONTROL: normal modda takas ayrintisinda token logolari uzak URL ile cizilir', async () => {
        axiosPostMock.mockResolvedValue({ data: { history: [takasSatiri] } })
        const { html } = await mountHistory({ gizli: false, secilen: takasSatiri })
        expect(imgKaynaklari(html)).toEqual(expect.arrayContaining([REMOTE_SEND, REMOTE_RECEIVE]))
    })

    it('gizli modda liste satirinda uzak <img> YOK; durum simgesi yedegi cizilir', async () => {
        axiosPostMock.mockResolvedValue({ data: { history: [apiSatiri] } })
        const { html, state } = await mountHistory({ gizli: true })

        expect(state.transactions).toHaveLength(1)
        expect(imgKaynaklari(html).filter(uzakMi)).toEqual([])
        expect(html).not.toContain(REMOTE_ENTITY)
    })

    it('gizli modda takas ayrintisinda uzak <img> YOK; sembol metni yedegi cizilir', async () => {
        axiosPostMock.mockResolvedValue({ data: { history: [takasSatiri] } })
        const { html } = await mountHistory({ gizli: true, secilen: takasSatiri })

        expect(imgKaynaklari(html).filter(uzakMi)).toEqual([])
        expect(html).not.toContain(REMOTE_SEND)
        expect(html).not.toContain(REMOTE_RECEIVE)
        // Yedek: token logosu yerine sembol METNI.
        expect(gorunurMetin(html)).toContain('CAKE')
        expect(gorunurMetin(html)).toContain('USDT')
    })
})

describe('History.vue (SSR) -- desteklenmeyen aglarda istek yok (satir 8)', () => {
    it.each([100, 42220, 5000, 25, 43114])('gizli modda %s agi: /wallet/history CAGRILMAZ, not cikar, yerel bekleyen kart kalir', async (id) => {
        const { html, state } = await mountHistory({ gizli: true, ag: agOf(id), pending: [{ ...bekleyen, chainId: id }] })

        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(state.historyUnsupported).toBe(true)
        expect(state.historyError).toBeNull()
        expect(state.loading).toBe(false)
        expect(state.transactions).toHaveLength(1)
        expect(html).toContain('data-history-unsupported')
        // Kesme isareti SSR ciktisinda &#39; olur: metnin kesme isaretsiz kismi aranir (spec 4.8: "History isn't available for this network.").
        expect(gorunurMetin(html)).toContain('available for this network.')
        expect(gorunurMetin(html)).not.toContain('No transactions found')
    })

    it('gizli modda desteklenmeyen agda yerel kart yoksa da bos liste metni YERINE not cikar, hata ekrani cikmaz', async () => {
        const { html, state } = await mountHistory({ gizli: true, ag: GNOSIS })

        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(state.transactions).toHaveLength(0)
        expect(html).toContain('data-history-unsupported')
        expect(gorunurMetin(html)).not.toContain('No transactions found')
        expect(gorunurMetin(html)).not.toContain('Could not load history')
    })

    it('KONTROL: normal modda ayni ag (Gnosis) eskisi gibi sorulur ve not CIKMAZ', async () => {
        const { html, state } = await mountHistory({ gizli: false, ag: GNOSIS })

        expect(axiosPostMock).toHaveBeenCalledTimes(1)
        expect(axiosPostMock.mock.calls[0][0]).toContain('/wallet/history')
        expect(axiosPostMock.mock.calls[0][1]).toEqual({ address: ME, chainId: 100 })
        expect(state.historyUnsupported).toBe(false)
        expect(html).not.toContain('data-history-unsupported')
    })

    it('KONTROL: normal modda teslim tablosunda olmayan Avalanche (43114) da eskisi gibi sorulur', async () => {
        const { state } = await mountHistory({ gizli: false, ag: agOf(43114) })

        expect(axiosPostMock).toHaveBeenCalledTimes(1)
        expect(axiosPostMock.mock.calls[0][1]).toEqual({ address: ME, chainId: 43114 })
        expect(state.historyUnsupported).toBe(false)
    })

    it.each([1, 56, 8453, 42161, 137, 10])('gizli modda desteklenen %s agi: istek eskisi gibi gider ve not CIKMAZ', async (id) => {
        const { html, state } = await mountHistory({ gizli: true, ag: agOf(id) })

        expect(axiosPostMock).toHaveBeenCalledTimes(1)
        expect(axiosPostMock.mock.calls[0][1]).toEqual({ address: ME, chainId: id })
        expect(state.historyUnsupported).toBe(false)
        expect(html).not.toContain('data-history-unsupported')
    })

    it('ag degisince not sifirlanir: desteklenmeyen agdan desteklenen aga gecis istegi atar', async () => {
        const { state } = await mountHistory({ gizli: true, ag: GNOSIS })
        expect(state.historyUnsupported).toBe(true)

        networkStore().currentNetwork = ETH
        await state.fetchHistory()

        expect(state.historyUnsupported).toBe(false)
        expect(axiosPostMock).toHaveBeenCalledTimes(1)
        expect(axiosPostMock.mock.calls[0][1].chainId).toBe(1)
    })
})
// Dilim 0c G4 (origin/main birlesmesi): Faz 3 ucret satiri. `loadCowFees` yerel `source==='cow'` satiri varsa her
// yuklemede COW_FEE_STATUS gonderir; arka plan kapisi ozel modda bunu zaten reddeder (BLOCKED_IN_PRIVATE), ama
// mesaj hic gonderilmemeli (savunma, mod gecisi yarisina karsi). Normal modda main davranisi aynen surer.
describe('History.vue (SSR) -- COW_FEE_STATUS ozel modda gonderilmez (G4)', () => {
    const cowSatiri = {
        hash: '0x' + 'dd'.repeat(32), chainId: 56, from_address: ME, to_address: '0x' + '44'.repeat(20),
        category: 'send', receipt_status: 'pending', value: '1', block_timestamp: new Date().toISOString(),
        source: 'cow', cow_uid: '0x' + 'ab'.repeat(56),
    }
    const mesajTurleri = (send) => send.mock.calls.map((c) => c[0]?.type)

    async function mountCow({ gizli }) {
        const stub = installChromeStub({ currentNetwork: BSC, active_account: { address: ME }, pending_transactions: [cowSatiri] })
        const send = vi.fn(async () => ({ success: true, fees: [] }))
        stub.setSendMessage(send)
        const app = createApp(History, { props: { embedded: true } })
        app.use(createTestPinia())
        app.use(createTestI18n('en'))
        networkStore().currentNetwork = BSC
        privacyStore().active = gizli
        const captured = captureInstance(app, 'History')
        await render(app)
        return { send, state: captured.instance.setupState }
    }

    it('KONTROL: normal modda yerel cow satiri varsa COW_FEE_STATUS gonderilir', async () => {
        const { send } = await mountCow({ gizli: false })
        expect(mesajTurleri(send)).toContain('COW_FEE_STATUS')
    })

    it('gizli modda yerel cow satiri olsa da COW_FEE_STATUS GONDERILMEZ', async () => {
        const { send, state } = await mountCow({ gizli: true })
        expect(state.transactions.some((r) => r.source === 'cow')).toBe(true)
        expect(mesajTurleri(send)).not.toContain('COW_FEE_STATUS')
    })
})

// Grafit karari (kullanici, 2026-10-26): gizli modda hicbir sey mor gorunmez. Takas satirinin durum dairesi indigoydu
// (ROZET_INDIGO); merkezi esleme (style.css "GIZLI MOD MOR PALETI NOTRLESIR") onu griye cekince ne notr rozete ne renkli
// rozetlere benzeyen kopuk bir ucuncu gri kaliyordu. Gizli modda giden islemle AYNI notr rozeti alir; normal modda indigo.
describe('History.vue (SSR) -- takas satirinin durum dairesi gizli modda notr (grafit karari)', () => {
    // Sablon yorumlari SSR ciktisina girer: iddiayi yaniltmasin diye once atilir. Daire yerlesim siniflarindan bulunur
    // (SSR dinamik sinifi statikten ONCE yazar, sira guvenilmez): liste satirinda min-w-10 + h-10, modalda w-16 + h-16.
    const yorumsuz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const daireSiniflari = (html, isaretler) => [...yorumsuz(html).matchAll(/<div class="([^"]*)"/g)]
        .map((m) => m[1].split(/\s+/))
        .find((s) => ['rounded-full', ...isaretler].every((i) => s.includes(i))) ?? []
    const MOR = /\b(indigo|violet|purple|fuchsia)-\d/

    async function daireler(satir, gizli) {
        axiosPostMock.mockResolvedValue({ data: { history: [satir] } })
        const { html } = await mountHistory({ gizli, secilen: satir })
        return { liste: daireSiniflari(html, ['min-w-10', 'h-10']), modal: daireSiniflari(html, ['w-16', 'h-16']) }
    }

    it('KONTROL: normal modda takas satirinin durum dairesi indigo (liste ve ayrinti)', async () => {
        const { liste, modal } = await daireler(takasSatiri, false)
        expect(liste).toEqual(expect.arrayContaining(['bg-indigo-500/10', 'text-indigo-500', 'dark:text-indigo-400']))
        expect(modal).toEqual(expect.arrayContaining(['bg-indigo-500/10', 'text-indigo-500', 'dark:text-indigo-400', 'border-indigo-500/20']))
        expect(liste).not.toContain('bg-slate-100')
    })

    it('gizli modda takas satirinin durum dairesi giden islemle ayni notr rozet (liste ve ayrinti); mor ton yok', async () => {
        const takas = await daireler(takasSatiri, true)
        const giden = await daireler(apiSatiri, true)

        expect(takas.liste).toEqual(expect.arrayContaining(['bg-slate-100', 'text-slate-500', 'dark:bg-zinc-800', 'dark:text-zinc-400']))
        expect(takas.modal).toEqual(expect.arrayContaining(['bg-slate-100', 'text-slate-500', 'border-slate-200', 'dark:bg-zinc-800', 'dark:text-zinc-400', 'dark:border-zinc-700']))
        expect(takas.liste).toEqual(giden.liste)
        expect(takas.modal).toEqual(giden.modal)
        expect(takas.liste.join(' ')).not.toMatch(MOR)
        expect(takas.modal.join(' ')).not.toMatch(MOR)
    })
})
