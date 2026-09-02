// Token.vue'nun ILK BOYAMASI -- grafik alaninin "yukleniyor" durumu.
//
// KOK NEDEN (kod incelemesi, Bulgu A): `displayToken` satir kaydindan turedigi
// icin ILK BOYAMADAN itibaren DOLUDUR (normal durum budur: kullanici Home'da bir
// satira basarak gelir). `v-else-if="!displayToken"` bu yuzden HIC calismiyor ve
// kullanici, `/getTokenDataById` daha yanit vermeden "Bu token icin fiyat gecmisi
// yok." okuyordu -- gecici bir ag hatasi da KESIN bir yokluk gibi gorunuyordu.
// Bu, F1 duzeltmesinin URETTIGI, EVM ve Solana'yi AYNI SEKILDE etkileyen bir
// gerilemeydi.
//
// BU DOSYA 'vue' MOCK'U KULLANMAZ -- ve bu KASITLIDIR. Diger SSR dosyalari
// `onMounted`i `onServerPrefetch`e esitliyor, yani render TAMAMLANMIS bir veri
// cekiminden SONRA olusuyor. Burada tam tersi gerekiyor: SSR'da mount kancalari
// HIC calismaz, dolayisiyla bu render GERCEK ILK BOYAMADIR (istek daha
// baslamamis, `loaded` hala false). Ariza tam olarak o anda gorunuyor.
import { describe, it, expect, afterEach, vi } from 'vitest'

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'

// Cekim hic baslamayacak ama modul yine de cozulecek.
vi.mock('axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const LOADING = 'Chart Loading'
const NO_DATA = 'No price history for this token.'

afterEach(() => { delete globalThis.chrome })

function firstPaint(chainRecord, selectedRef, tokenId) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })

    const app = createApp(Token, { props: { id: tokenId } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    networkStore().currentNetwork = chainRecord
    cryptoStore().selected_token_ref = selectedRef

    return app
}

describe('Token.vue (SSR, ILK BOYAMA) -- yukleniyor durumu ULASILABILIR (Bulgu A)', () => {
    it('Solana satiri: istek bitmeden "yukleniyor" gosterilir, "gecmis yok" DEGIL', async () => {
        const app = firstPaint(SOLANA_CHAIN, { id: null, chainId: 'solana-mainnet', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 }, null)
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        // Arizanin olculdugu tam durum: kayit YOK ama displayToken DOLU.
        expect(captured.instance.setupState.token).toBeNull()
        expect(captured.instance.setupState.displayToken).not.toBeNull()
        expect(captured.instance.setupState.loaded).toBe(false)

        expect(html).toContain(LOADING)
        expect(html).not.toContain(NO_DATA)
    })

    // AYNI ariza EVM'de de vardi: satir kaydi EVM'de de displayToken'i doldurur.
    it('EVM satiri: ilk boyamada "yukleniyor" gosterilir', async () => {
        const app = firstPaint(ETH_CHAIN, { id: 'usd-coin', chainId: 1, address: '0x0', decimals: 6 }, 'usd-coin')
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.loaded).toBe(false)
        expect(html).toContain(LOADING)
        expect(html).not.toContain(NO_DATA)
    })

    // Satir kaydi HIC yokken de (displayToken null) sonuc AYNI olmali: bayrak
    // artik tek belirleyici.
    it('satir kaydi olmadan da ilk boyama "yukleniyor"', async () => {
        const app = firstPaint(ETH_CHAIN, null, 'usd-coin')
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.displayToken).toBeNull()
        expect(html).toContain(LOADING)
        expect(html).not.toContain(NO_DATA)
    })
})
