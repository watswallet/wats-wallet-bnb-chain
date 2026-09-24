// Swap ekraninda TOKENIZE HISSE ROZETI.
//
// Hisseler ayri bir sekmede kesfediliyor ama TAKAS ekraninda bStock'lar
// siradan BEP-20 tokenleriyle AYNI listede, ayni gorunumde duruyordu: sembol
// ("GOOGLB") disinda hicbir isaret yoktu. Bu ekran bStock'larin gercekten
// islem gordugu TEK yer (kopru kapali, bkz. bridgeBstocks.test.js) -- yani
// "bu bir hisse sertifikasi" bilgisinin en cok gerektigi yer de burasi.
//
// ROZETIN ZINCIR KAYNAGI bu dosyanin ASIL konusu:
//   - Swap.vue ve swapTo.vue  -> AKTIF AG (network.currentNetwork?.chainId)
//   - swapFrom.vue            -> TOKENIN KENDI chainId'si
// Ayrim keyfi degil. Takas TEK ZINCIRLI: swapFrom'un `selectToken`i baska
// zincirdeki bir tokeni secerken ONCE agi o zincire ceviriyor, SONRA inToken'i
// yaziyor -- yani secilmis token her zaman aktif agin tokenidir. Buna karsilik
// swapFrom'un LISTESI gercekten cok zincirli (satirda zincir logosu var), ve
// swapTo'nun satirlarinda chainId ALANI HIC YOK (anahtar sadece token.address).
// Kaynagi karistirmak iki yonde de sessiz bozulur: swapTo'ya token.chainId
// gecirmek rozeti HIC gostermez, swapFrom'a aktif agi gecirmek BASKA zincirdeki
// bir tokeni hisse gibi ETIKETLER.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu -- hoisting, bilesen import edilmeden ONCE).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu YALNIZCA rozet gorunurlugu: gercek bakiye/kotasyon aginin
// hicbirine ihtiyaci yok (Swap.ssr.test.js ile AYNI gerekce ve AYNI mock seti).
const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === BSTOCKS_CHAIN_ID)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const AAPLB = BSTOCKS.find((t) => t.symbol === 'AAPLB')

// AYNI zincirde (56) ama katalogda OLMAYAN bir adres -- bStock OLMAYAN BSC
// tokeni (TokenBStock.ssr.test.js ile ayni ornek).
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'

// ROZETIN BIREBIR IZI -- `title` VE GORUNEN ETIKET birlikte.
//
// Once yalniz `title="Tokenized stock"` sayiliyordu. O marker YANLIS SEYI
// olcuyordu: title `token.bStockBadge` anahtarindan, kullanicinin OKUDUGU
// etiket ise `swap.stockTag` anahtarindan geliyor. Govdeyi ({{ $t('swap.stockTag') }})
// tamamen silseniz rozet BOS bir <span> olarak render edilir ve eski marker
// yine 1 sayardi -- yani "rozet gorunuyor" iddiasi gorunmeyen bir rozetle de
// yesil kalirdi. Marker artik kullanicinin gordugu metni ZORUNLU kiliyor.
const ROZET_RE = /title="Tokenized stock"[^>]*>Stock<\/span>/g
const rozetSayisi = (html) => (html.match(ROZET_RE) || []).length

const tokenRecord = (over = {}) => ({
    name: 'Alphabet',
    symbol: 'googlb',
    address: GOOGLB.address,
    decimals: 18,
    chainId: BSTOCKS_CHAIN_ID,
    image: { thumb: '', large: '' },
    ...over,
})

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
})

function setup(chainRecord, { inToken = null, outToken = null } = {}) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })

    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord
    pageStore().currentPage = 'swap'

    const crypto = cryptoStore()
    if (inToken) crypto.swap.inToken = inToken
    if (outToken) crypto.swap.outToken = outToken

    return { app }
}

describe('Swap.vue (SSR) -- tokenize hisse rozeti', () => {
    it('bStock VERILEN token secildiginde rozet render edilir', async () => {
        const { app } = setup(BSC_CHAIN, { inToken: tokenRecord() })
        const holder = captureInstance(app, 'Swap')
        const html = await render(app)

        expect(holder.instance.setupState.inTokenIsBStock).toBe(true)
        expect(rozetSayisi(html)).toBe(1)
        expect(html).toContain('GOOGLB')
    })

    it('bStock ALINAN token secildiginde rozet render edilir', async () => {
        const { app } = setup(BSC_CHAIN, { outToken: tokenRecord() })
        const holder = captureInstance(app, 'Swap')
        const html = await render(app)

        expect(holder.instance.setupState.outTokenIsBStock).toBe(true)
        expect(rozetSayisi(html)).toBe(1)
    })

    it('iki taraf da bStock ise IKI rozet cikar', async () => {
        const { app } = setup(BSC_CHAIN, {
            inToken: tokenRecord(),
            outToken: tokenRecord({ symbol: 'aaplb', name: 'Apple', address: AAPLB.address }),
        })
        const holder = captureInstance(app, 'Swap')
        const html = await render(app)

        expect(holder.instance.setupState.inTokenIsBStock).toBe(true)
        expect(holder.instance.setupState.outTokenIsBStock).toBe(true)
        expect(rozetSayisi(html)).toBe(2)
    })

    it('bStock OLMAYAN bir BSC tokeninde rozet YOK', async () => {
        const { app } = setup(BSC_CHAIN, {
            inToken: tokenRecord({ name: 'Tether USD', symbol: 'usdt', address: USDT_BSC }),
        })
        const holder = captureInstance(app, 'Swap')
        const html = await render(app)

        expect(holder.instance.setupState.inTokenIsBStock).toBe(false)
        expect(rozetSayisi(html)).toBe(0)
    })

    // KAPI AKTIF AGDA. bStock adresini TASIYAN ama zincir 1'de duran sahte bir
    // kayit rozet ALMAZ: `isBStock` zincir != 56'yi kendisi eler. Kaydin kendi
    // `chainId`'si de 1 verilir, aksi halde reconcileSwapToken tokeni
    // 'chain-mismatch' ile DUSURUR ve olculen sey rozet degil DUSME olurdu.
    it('AYNI adres Ethereum aktifken rozet ALMAZ', async () => {
        const { app } = setup(ETH_CHAIN, { inToken: tokenRecord({ chainId: 1 }) })
        const holder = captureInstance(app, 'Swap')
        const html = await render(app)

        expect(holder.instance.setupState.inTokenIsBStock).toBe(false)
        expect(rozetSayisi(html)).toBe(0)
    })
})

// ------------------------------------------------------------------
// LISTE POPUP'LARI: kaynak kilidi.
//
// swapFrom/swapTo popup'lari Swap.vue render'inda ACIK DEGIL (v-if popups.*),
// yani yukaridaki SSR testleri onlarin isaretlemesini HIC gormez. Rozetin
// ZINCIR KAYNAGI bu iki dosyada birbirinden FARKLI olmak zorunda oldugu icin
// (dosya basindaki gerekce) o secim burada ayrica kilitlenir.
//
// Iddialar `yorumsuz()` uzerinden kosar: aksi halde bu satirlari anlatan bir
// YORUM iddiayi tek basina yesil tutabilirdi.
const here = dirname(fileURLToPath(import.meta.url))
const kod = (rel) => yorumsuz(readFileSync(join(here, rel), 'utf8'))

describe('takas listelerinde rozetin ZINCIR KAYNAGI', () => {
    it('swapFrom TOKENIN KENDI chainId sini kullanir (liste cok zincirli)', () => {
        const src = kod('swap/swapFrom.vue')

        expect(src).toMatch(/import\s*\{\s*isBStock\s*\}\s*from\s*'\.\.\/\.\.\/utils\/bstocks'/)
        expect(src).toContain('v-if="isBStock(token.chainId, token.address)"')
        expect(src).toContain("{{ $t('swap.stockTag') }}")
        // Aktif agi kullanmak BASKA zincirdeki tokeni hisse gibi etiketlerdi.
        expect(src).not.toContain('isBStock(network.currentNetwork?.chainId')
    })

    it('swapTo AKTIF AGI kullanir (satirlarda chainId alani yok)', () => {
        const src = kod('swap/swapTo.vue')

        expect(src).toMatch(/import\s*\{\s*isBStock\s*\}\s*from\s*'\.\.\/\.\.\/utils\/bstocks'/)
        // Iki liste var (ice aktarilanlar + tumu); IKISINDE de rozet olmali.
        const kullanim = src.split('v-if="isBStock(network.currentNetwork?.chainId, token.address)"').length - 1
        expect(kullanim).toBe(2)
        expect(src.split("{{ $t('swap.stockTag') }}").length - 1).toBe(2)
        // `importedTokens` satirlarinda chainId ALANI yok (ImportToken.vue yalniz
        // `chain` yaziyor) -- orada token.chainId undefined kalir ve rozet HIC cikmaz.
        expect(src).not.toContain('isBStock(token.chainId')
    })

    it('Swap.vue rozeti AKTIF AGA baglar, tokenin alanina DEGIL', () => {
        const src = kod('Swap.vue')

        expect(src).toContain('isBStock(network.currentNetwork?.chainId, crypto.swap.inToken?.address)')
        expect(src).toContain('isBStock(network.currentNetwork?.chainId, crypto.swap.outToken?.address)')
        expect(src).not.toContain('isBStock(crypto.swap.inToken?.chainId')
        expect(src).not.toContain('isBStock(crypto.swap.outToken?.chainId')
        expect(src).toContain("{{ $t('swap.stockTag') }}")
    })
})

// ------------------------------------------------------------------
// YERLESIM KILIDI: rozet SECICI BUTONUN ICINDE OLAMAZ.
//
// Ilk surumde rozet butonun icindeydi ve URUNU BOZUYORDU. Buton `shrink-0` ve
// miktar alaniyla AYNI `flex ... gap-4` satirini paylasiyor; popup 360px'e
// SABIT kilitli (popup/style.css). Olculdu (headless Chrome + gercek dist CSS,
// 290px satir): buton 144.2 -> 193.8px, miktar alani 130 -> 80px. Miktar
// `truncate` tasidigi icin kotasyonun urettigi HER deger ucnokta ile
// kesiliyordu -- "0.5000" 92px, "12.3456" 108px, "1234.5678" 142px; sigan tek
// dize '0.00' YER TUTUCUSUYDU, yani kullanici ancak kotasyon YOKKEN tam sayi
// goruyordu. Onayladigi sayi bu.
//
// Etiket satirinda maliyet SIFIR: miktar alani rozetsiz tabanla birebir ayni.
// Rozeti "sembolun yanina" geri tasimak istenirse once olcum tekrarlanmali.
describe('rozet secici butonun ICINDE olmamali (yerlesim)', () => {
    const butonGovdesi = (src, tetikleyici) => {
        const bas = src.indexOf(tetikleyici)
        expect(bas).toBeGreaterThan(-1)
        const son = src.indexOf('</button>', bas)
        expect(son).toBeGreaterThan(bas)
        return src.slice(bas, son)
    }

    it('verilen ve alinan token butonlarinin govdesinde rozet YOK', () => {
        const src = kod('Swap.vue')

        for (const tetikleyici of ['popups.swap_from = true', 'popups.swap_to = true']) {
            expect(butonGovdesi(src, tetikleyici)).not.toContain('swap.stockTag')
        }
    })

    it('rozet yine de ekranda -- etiket satirinda duruyor', () => {
        const src = kod('Swap.vue')

        // Kilit "rozeti sil" diye okunmasin: iki rozet de HALA kaynakta.
        expect(src.split("{{ $t('swap.stockTag') }}").length - 1).toBe(2)
    })
})

// Kisa etiket HER IKI dilde de var olmali: locales.test.js statik $t taramasi
// bunu zaten kapsiyor ama oradaki tarama "en/tr ES mi" sorusunu sorar, DEGERIN
// kisa kalmasini sormaz. Rozet dar bir butonun icinde duruyor.
describe('swap.stockTag etiketi', () => {
    it('iki dilde de var ve KISA', () => {
        const en = JSON.parse(readFileSync(join(here, '..', 'i18n/locales/en.json'), 'utf8'))
        const tr = JSON.parse(readFileSync(join(here, '..', 'i18n/locales/tr.json'), 'utf8'))

        expect(en.swap.stockTag).toBeTruthy()
        expect(tr.swap.stockTag).toBeTruthy()
        expect(en.swap.stockTag.length).toBeLessThanOrEqual(10)
        expect(tr.swap.stockTag.length).toBeLessThanOrEqual(10)
    })
})
