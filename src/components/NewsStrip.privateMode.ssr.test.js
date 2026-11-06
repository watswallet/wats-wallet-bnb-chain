// NewsStrip.vue (SSR) -- Gelismeler seridi GIZLI MODDA: gizli modda kapali ozellikleri (Hisseler sekmesi) anlatan duyurular
// cizilmez. Tanima YAPISAL: duyurunun `id`si (cevrilmis metin DEGIL). Normal mod AYNEN eskisi gibi (kontrol testi).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. NewsStrip.ssr.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosGetMock = vi.fn()
vi.mock('axios', () => ({ default: { get: (...args) => axiosGetMock(...args) } }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { privacyStore } from '../store/privacy'
import NewsStrip from './NewsStrip.vue'

const STOCK_ITEM = { id: 'bstocks-support', date: '2026-10-02', accent: 'emerald', title: { tr: 'Tokenize hisseler geldi', en: 'Tokenized stocks are here' }, body: { tr: 'Hisseler sekmesinden takas edin.', en: 'Swap from the new Stocks tab.' } }
const OTHER_ITEM = { id: 'ton-support', date: '2026-09-14', accent: 'blue', title: { tr: 'TON artik destekleniyor', en: 'TON is now supported' }, body: { tr: 'Ag listesinden secin.', en: 'Pick TON from the network list.' } }

const NORMAL = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const GIZLI = { address: '0x' + 'cd'.repeat(20), key: 'private-' + 'cd'.repeat(20), type: 'hd', private: true }

async function mount({ news, account, storeActive }) {
    installChromeStub({ active_account: account })
    const app = createApp(NewsStrip, { use: [createTestPinia(), createTestI18n('en')] })
    privacyStore().active = storeActive
    return render(app)
}

beforeEach(() => {
    axiosGetMock.mockReset()
})
afterEach(() => {
    delete globalThis.chrome
})

describe('NewsStrip (SSR) -- gizli mod', () => {
    it('normal modda hisse duyurusu CIZILIR (kontrol)', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [STOCK_ITEM, OTHER_ITEM] } })
        const html = await mount({ account: NORMAL, storeActive: false })
        expect(html).toContain('Tokenized stocks are here')
        expect(html).toContain('TON is now supported')
    })

    it('gizli modda hisse duyurusu CIZILMEZ, digerleri kalir', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [STOCK_ITEM, OTHER_ITEM] } })
        const html = await mount({ account: GIZLI, storeActive: true })
        expect(html).not.toContain('Tokenized stocks are here')
        expect(html).not.toContain('Stocks tab')
        expect(html).toContain('TON is now supported')
    })

    it('karar HESAP tabanli: aktif hesap Gizli, store henuz false ise de hisse duyurusu cizilmez', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [STOCK_ITEM, OTHER_ITEM] } })
        const html = await mount({ account: GIZLI, storeActive: false })
        expect(html).not.toContain('Tokenized stocks are here')
    })

    it('sunucu ulasilamazken gomulu yedek de gizli modda hisse duyurusunu gostermez', async () => {
        axiosGetMock.mockRejectedValue(new Error('down'))
        const html = await mount({ account: GIZLI, storeActive: true })
        expect(html).not.toContain('Tokenized stocks are here')
        expect(html).toContain('TON is now supported')
    })

    it('yalniz hisse duyurusu varsa gizli modda bolum HIC cizilmez (bos cerceve yok)', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [STOCK_ITEM] } })
        const html = await mount({ account: GIZLI, storeActive: true })
        expect(html).not.toContain('<section')
    })
})

// Grafit karari (kullanici, 2026-10-26): gizli modda serit renkli vurgu tasimaz (nokta, rozet, arkadaki isik, sayfa
// gostergesi). Karar listeyle ayni HESAP tabanli kural. Normal mod aynen (kontrol testi).
describe('NewsStrip (SSR) -- gizli modda vurgular notr', () => {
    const MOR_ITEM = { id: 'mor-duyuru', date: '2026-10-20', accent: 'purple', title: { tr: 'Mor duyuru', en: 'Purple news' } }
    const RENKLI = /\b(bg|text|border)-(indigo|violet|purple|fuchsia|blue|amber|emerald)-\d/

    it('KONTROL: normal modda renkli nokta, arkadaki isik ve indigo sayfa gostergesi cizilir', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [OTHER_ITEM, MOR_ITEM] } })
        const html = await mount({ account: NORMAL, storeActive: false })
        expect(html).toContain('bg-blue-500')
        expect(html).toContain('blur-2xl')
        expect(html).toContain('w-3.5 bg-indigo-500')
    })

    it('gizli modda renkli vurgu, mor ve arkadaki isik YOK', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [OTHER_ITEM, MOR_ITEM] } })
        const html = await mount({ account: GIZLI, storeActive: true })
        expect(html).toContain('TON is now supported')
        expect(html).toContain('Purple news')
        expect(html).not.toMatch(RENKLI)
        expect(html).not.toContain('blur-2xl')
    })

    it('karar HESAP tabanli: aktif hesap Gizli, store henuz false ise de vurgular notr', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [OTHER_ITEM, MOR_ITEM] } })
        const html = await mount({ account: GIZLI, storeActive: false })
        expect(html).not.toMatch(RENKLI)
    })
})
