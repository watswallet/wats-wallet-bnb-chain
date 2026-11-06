import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const api = vi.hoisted(() => ({ post: null }))
vi.mock('axios', () => ({ default: { post: (...a) => api.post(...a) } }))

import { getAddress } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { setLocalLogosOnly, VARSAYILAN_TOKEN_LOGOSU } from '../../utils/tokenLogo'
import PrivateDeliveryTokenPicker from './PrivateDeliveryTokenPicker.vue'

// GIZLI MOD, LOGOLAR YEREL (gizli-mod cok-ag spec 4.7 "Logolar yerel (D6)" ve 5.1 `PrivateDeliveryTokenPicker` satiri):
// Gonder'in teslim tokeni secicisi sunucunun /getChainTokens listesini cizer ve her satirda uzak bir CDN adresi tasir.
// Hicbir satir uzak gorsel cizmemeli: secici logoyu TEK cozucudan (privateTokenLogo) alir, sunucu satirinin image/logoURI alanlari okunmaz
// (anahtar acik ya da kapali). Secim logo tasimaz; tetikleyici dugme ayni cozucuyu kendisi cagirir. Davranis sinanir: cizilen <img src>
// degerleri. Secicinin isaretlemesi (sinif, sira, ek rozet) sinanmaz: Dilim C seciciyi degistirmis olabilir.
const CAKE = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
const UZAK = [
    // Sunucu USDC satirinin logosu image.large ile gelir; secici sabit USDC satirina bunu doldurur.
    { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18, image: { large: 'https://img.example/usdc.png' } },
    { address: CAKE.toLowerCase(), symbol: 'CAKE', name: 'PancakeSwap', decimals: 18, logoURI: 'https://img.example/cake.png' },
    { address: getAddress('0x' + '66'.repeat(20)), symbol: 'PROTO', name: 'Protokol Goreli', decimals: 18, image: '//img.example/proto.png' },
    { address: getAddress('0x' + '77'.repeat(20)), symbol: 'BARE', name: 'Logosuz', decimals: 18 },
]
const UZAK_ANAHTAR = 'img.example'

afterEach(() => { delete globalThis.chrome })

// Yerel yol = ayni kaynaktan yol: `/` ile baslar, `//` (protokol-goreli) ile BASLAMAZ.
const yerelYol = (d) => typeof d === 'string' && d.startsWith('/') && !d.startsWith('//')
const imgSrcs = (html) => [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)].map((m) => m[1])
// Satirin ilk gorselinin src'si: sembolu iceren <li> parcasi (PrivateDeliveryTokenPicker.ssr.test.js ile ayni yardimci).
function srcOf(html, symbol) {
    const satir = html.split('<li').find((parca) => parca.includes(`>${symbol}<`)) || ''
    return imgSrcs(satir)[0]
}
// Anahtar yalniz bu cagri boyunca aciktir (modul duzeyindeki durum sonraki teste sizmasin).
async function ozelModda(fn) {
    setLocalLogosOnly(true)
    try { return await fn() } finally { setLocalLogosOnly(false) }
}

function mount() {
    installChromeStub({ active_account: { key: 'g-1' }, imported_tokens: {} })
    api.post = async () => ({ data: { tokens: UZAK } })
    const events = { logos: [] }
    const app = createApp(PrivateDeliveryTokenPicker, {
        // chainId: Dilim C'den sonra ZORUNLU prop (56 = BSC teslimi); ondan once ek ozellik olarak yok sayilir.
        props: { chainId: 56, nativeEnabled: true, selected: null, onSelect: (t, logo) => { events.logos.push(logo) }, onClose: () => {} },
    })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'PrivateDeliveryTokenPicker')
    return { app, captured, events }
}

describe('PrivateDeliveryTokenPicker -- ozel modda logolar yerel', () => {
    it('anahtar kapaliyken de sunucu satirlarinin uzak logolari CIZILMEZ (secici yalniz paketli logo kullanir)', async () => {
        const html = await render(mount().app)
        for (const src of imgSrcs(html)) expect(yerelYol(src), src).toBe(true)
        expect(html).not.toContain(UZAK_ANAHTAR)
    })

    it('anahtar aciksa her satirin logosu yerel yoldur: uzak logo yer tutucuya doner, yerel dosya korunur', async () => {
        const html = await ozelModda(async () => render(mount().app))
        const srcs = imgSrcs(html)
        expect(srcs.length).toBeGreaterThanOrEqual(5)
        for (const src of srcs) expect(yerelYol(src), src).toBe(true)
        expect(html).not.toContain(UZAK_ANAHTAR)
        // Yerel dosya korunur (her satir toptan yer tutucuya dusmez); yalniz uzak logo tasiyan satirlar duser.
        expect(srcOf(html, 'BNB')).toBe('/chains/56.png')
        // USDC: sunucu logo verse de (uzak adres) paketli USDC logosu, gri yer tutucu degil.
        expect(srcOf(html, 'USDC')).toBe('/usdc.png')
        // CAKE paketlenmis populer token (public/tokens): uzak logosu elenir, yerel dosyasi gosterilir. Paketsizler (PROTO, BARE) yer tutucuyla DEGIL hic cizilmez
        // (gizli modda logosuz satir yok, sahip karari 2026-11-03).
        expect(srcOf(html, 'CAKE')).toBe('/tokens/56/' + CAKE.toLowerCase() + '.png')
        for (const sembol of ['PROTO', 'BARE']) expect(html, sembol).not.toContain(`>${sembol}<`)
        expect(html).not.toContain(VARSAYILAN_TOKEN_LOGOSU)
    })

    it('secim logo tasimaz: yalniz { chainId, address, symbol, decimals } yayilir (tetikleyici dugme logoyu cozucuden alir)', async () => {
        const { app, captured, events } = mount()
        await render(app)
        const s = captured.instance.setupState
        for (const sembol of ['BNB', 'USDC', 'CAKE']) s.choose(s.tokens.find((t) => t.symbol === sembol))
        expect(events.logos).toEqual([undefined, undefined, undefined])
    })
})
