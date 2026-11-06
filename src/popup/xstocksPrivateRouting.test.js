// xStocks Al / Sat EKRANI gizli modda KAPALI (sahip karari 2026-10-16: CoW emri Gizli adresi CoW'a IP ile gosterir).
// Iki katman: (1) App.vue ekrani gizli modda hic BAGLAMAZ; (2) gizli mod BASKA bir panelden (uiSync) acilirsa bu panel Al / Sat
// ekraninda kalmaz, eve doner (privatePageGuard.js, privacyRouting.test.js'teki gizli ekran korumasinin tersi).
// Giris dugmesi: TokenXStock.privateMode.ssr.test.js; Hisseler sekmesi: HomeXStocks.privateMode.ssr.test.js; arka plan kapisi:
// privacyGate.test.js ve background.cowPrivacy.test.js.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nextTick, watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { cryptoStore } from '../store/crypto'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { leavePrivatePagesWhenOff, leaveStockPagesWhenOn, STOCK_PAGES } from './privatePageGuard'
import { yorumsuz } from '../test-utils/kaynakTarama'

const app = yorumsuz(readFileSync(fileURLToPath(new URL('./App.vue', import.meta.url)), 'utf8'))

describe('App.vue: Al / Sat ekrani gizli modda baglanmaz', () => {
    it('StockTrade yalniz gizli mod kapaliyken baglanir (main: bayraga bakmaz; Dilim 0c G5)', () => {
        const route = app.match(/<StockTrade\b[^>]*>/)
        expect(route, 'StockTrade rotasi bulunamadi').not.toBeNull()
        expect(route[0]).toContain(`!privacy.active && page.currentPage === 'stock_trade'`)
        expect(app.split('<StockTrade').length - 1).toBe(1)
    })

    it('izleyici AYRI bir satirdir, yalniz DEGISIMDE calisir ve gizli ekran izleyicisine dokunmaz', () => {
        const yeni = /watch\(\(\) => privacy\.active, \(on\) => leaveStockPagesWhenOn\(on, page, crypto\)\)/.exec(app)
        expect(yeni).not.toBeNull()
        expect(app.slice(yeni.index, yeni.index + yeni[0].length + 40)).not.toMatch(/immediate|flush:\s*'sync'/)
        // privacyRouting.test.js'in kilitledigi mevcut izleyici AYNEN durur.
        expect(app).toMatch(/watch\(\(\) => privacy\.active, \(on\) => leavePrivatePagesWhenOff\(on, page\)\)/)
    })
})

describe('Al / Sat ekranina giden her yol STOCK_PAGES icinde', () => {
    // Yeni bir xStocks ekrani (stock_*) eklenip rotaya baglanir da korunacaklar listesine yazilmazsa test kirilir.
    // Tarama src/ in TAMAMINI gezer (bilesen, composable, util, popup, store...): sayfa baska bir yerden de degistirilebilir
    // ve desen `page.` onekine baglanmaz (`pageStore().currentPage = ...`, nesne baglaminda `currentPage: ...`); `===`
    // karsilastirmalari eslesmez. Testler ve test-utils/ disarida.
    it('src/ altinda currentPage a atanan her stock_* sayfasi STOCK_PAGES te ve App.vue da baglidir', () => {
        const kok = fileURLToPath(new URL('../', import.meta.url))
        const atananlar = new Map()
        for (const dosya of readdirSync(kok, { recursive: true }).map((p) => String(p).replace(/\\/g, '/'))) {
            if (!/\.(?:vue|js|ts)$/.test(dosya) || /\.test\.(?:js|ts)$/.test(dosya) || dosya.startsWith('test-utils/')) continue
            // Ham metin taranir (yorum temizlenmez): yorumdaki bir atama yalniz testi KATILASTIRIR, bir atamayi gizleyemez.
            const kod = readFileSync(kok + dosya, 'utf8')
            for (const m of kod.matchAll(/\bcurrentPage\s*[:=]\s*['"](stock_[a-z_]+)['"]/g)) atananlar.set(m[1], dosya)
        }
        // Olumlu iddia: tarama Token.vue'daki atamayi gercekten buldu (yoksa asagidaki esitlikler bos kumeyle de gecerdi).
        expect([...atananlar.keys()]).toEqual(['stock_trade'])
        // Giris dugmesi Token.vue'dan StockDetail.vue'ya tasindi (main 2a8acd4); StockDetail yalniz isStockPage arkasinda baglanir.
        expect(atananlar.get('stock_trade')).toBe('components/stocks/StockDetail.vue')
        expect([...STOCK_PAGES].sort()).toEqual([...atananlar.keys()].sort())
        for (const sayfa of STOCK_PAGES) expect(app).toContain(`page.currentPage === '${sayfa}'`)
    })

    it('hisse detayi (token sayfasi + hisse ref) gizli modda isStockPage ile KAPALI: tek kaynak stockEntryForRef(privateMode)', () => {
        expect(app).toContain('stockEntryForRef(crypto.selected_token_ref, { privateMode: privacy.active })')
        expect(app).toMatch(/<StockDetail v-if="page\.currentPage === 'token' && isStockPage"/)
    })
})

describe('leaveStockPagesWhenOn: hisse detayi acikken gizli mod acilirsa panel eve doner (G5)', () => {
    const HISSE_REF = { chainId: BSTOCKS_CHAIN_ID, address: BSTOCKS[0].address }

    it('GERCEK store ve watch ile: token + hisse ref -> home; hissesiz ref ve baska ekranda kalinir; mod kapaninca dokunulmaz', async () => {
        setActivePinia(createPinia())
        const privacy = privacyStore()
        const page = pageStore()
        const crypto = cryptoStore()
        const stop = watch(() => privacy.active, (on) => leaveStockPagesWhenOn(on, page, crypto))
        try {
            page.currentPage = 'token'
            crypto.selected_token_ref = HISSE_REF
            privacy.active = true
            await nextTick()
            expect(page.currentPage).toBe('home')
            privacy.active = false
            await nextTick()

            // Hissesiz token: siradan Token ekraninda kalir.
            page.currentPage = 'token'
            crypto.selected_token_ref = { chainId: 1, address: '0x0000000000000000000000000000000000000001' }
            privacy.active = true
            await nextTick()
            expect(page.currentPage).toBe('token')
            privacy.active = false
            await nextTick()

            // Mod KAPANIRKEN dokunulmaz.
            page.currentPage = 'token'
            crypto.selected_token_ref = HISSE_REF
            await nextTick()
            expect(page.currentPage).toBe('token')
        } finally {
            stop()
        }
    })

    it('crypto verilmezse (eski cagri) token sayfasina dokunmaz; stock_trade yine eve doner', () => {
        const tokenPage = { currentPage: 'token' }
        leaveStockPagesWhenOn(true, tokenPage)
        expect(tokenPage.currentPage).toBe('token')
        const trade = { currentPage: 'stock_trade' }
        leaveStockPagesWhenOn(true, trade)
        expect(trade.currentPage).toBe('home')
    })
})

describe('leaveStockPagesWhenOn: gizli mod acilinca Al / Sat ekranindaki panel eve doner', () => {
    it('GERCEK store ve Vue watch ile: stock_trade -> home; baska ekranda kalinir; mod kapaninca dokunulmaz', async () => {
        setActivePinia(createPinia())
        const privacy = privacyStore()
        const page = pageStore()
        const stop = watch(() => privacy.active, (on) => leaveStockPagesWhenOn(on, page, cryptoStore()))
        try {
            for (const sayfa of STOCK_PAGES) {
                page.currentPage = sayfa
                privacy.active = true
                await nextTick()
                expect(page.currentPage, sayfa).toBe('home')
                privacy.active = false
                await nextTick()
            }
            // Baska ekranda kalinir: gizli mod acilinca her ekran eve zorlanmaz.
            page.currentPage = 'settings'
            privacy.active = true
            await nextTick()
            expect(page.currentPage).toBe('settings')
            // Mod KAPANIRKEN dokunulmaz (gizli moddayken zaten Al / Sat ekranina girilemez).
            privacy.active = false
            page.currentPage = 'stock_trade'
            await nextTick()
            expect(page.currentPage).toBe('stock_trade')
        } finally {
            stop()
        }
    })

    it('gizli ekran korumasi (mod KAPANINCA) etkilenmez: private_send eve doner, stock_trade yerinde kalir', () => {
        const page = { currentPage: 'private_send', ordersNotice: 'x' }
        leavePrivatePagesWhenOff(false, page)
        expect(page.currentPage).toBe('home')
        const stok = { currentPage: 'stock_trade', ordersNotice: null }
        leavePrivatePagesWhenOff(false, stok)
        expect(stok.currentPage).toBe('stock_trade')
    })
})
