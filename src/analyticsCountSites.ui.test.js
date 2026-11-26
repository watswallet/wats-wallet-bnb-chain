// Arayuz tarafi ekran sayim noktalarinin YERLESIMINI kilitler (kaynak taramasi).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8')
// Eslesen satirdan sonraki ilk satir basi "}" a kadar (fonksiyon govdesi)
const body = (src, startRe) => {
    const i = src.search(startRe)
    expect(i).toBeGreaterThan(-1)
    const rest = src.slice(i)
    return rest.slice(0, rest.search(/\r?\n\}/))
}

describe('ekran sayim noktalari', () => {
    const app = read('popup/App.vue')
    const home = read('components/Home.vue')
    const ats = read('composables/useAtsPurchase.js')

    it('App.vue watch(() => page.currentPage ... immediate yok', () => {
        const line = app.split('\n').find((l) => l.includes('countScreen(yeni)'))
        expect(line).toBeTruthy()
        expect(line).toMatch(/^watch\(\(\) => page\.currentPage/)
        expect(line).not.toMatch(/immediate/)
    })

    it('Home.vue homeStocks yalniz openStocksTab icinde, homeActivity yalniz sekmeSec(activity) dalinda sayilir; sekmeSec govdesinde homeStocks yok', () => {
        expect(home.match(/key: 'homeStocks'/g)).toHaveLength(1)
        expect(home.match(/key: 'homeActivity'/g)).toHaveLength(1)
        expect(body(home, /const openStocksTab = /)).toContain("key: 'homeStocks'")
        const sekme = body(home, /const sekmeSec = /)
        expect(sekme).not.toContain('homeStocks')
        // Gizli modda mesaj yollanmaz: sayim satiri privacy kapisini tasir (Gecmis sekmesi gizli modda da gorunur).
        expect(sekme).toMatch(/if \(sekme === 'activity' && privacy\.active !== true\) requestAnalyticsCount\('screen', \{ key: 'homeActivity' \}\)/)
        // `privacy` Home.vue'de privacyStore()'un kendisidir.
        expect(home).toMatch(/\nconst privacy = privacyStore\(\)\r?\n/)
        // Hisseler sekmesi gizli modda hic cizilmez: openStocksTab'a gizli modda ulasilamaz.
        expect(home).toMatch(/v-if="stocksTabVisible"\s*\r?\n\s*@click="openStocksTab"/)
        expect(home).toMatch(/const stocksTabVisible = computed\(\(\) => stocksAvailable\.value && !privacy\.active\)/)
    })

    it('onMounted/hatirlanan sekme (page.homeTab) geri yuklemesi sayim cagirmaz (onMounted openStocksTab cagirmaz)', () => {
        // Yorumlar (ornegin "openStocksTab yalnizca tiklamayla kosar") atilir: yalniz kod taranir
        const m = body(home, /onMounted\(async \(\) => \{/).replace(/\/\/.*/g, '')
        expect(m).not.toContain('openStocksTab')
        expect(m).not.toContain('requestAnalyticsCount')
        expect(m).not.toContain('sekmeSec(')
    })

    it('sekme baslangic/geri yukleme (activeTab = ref(page.homeTab)) sayim cagirmaz', () => {
        const line = home.split('\n').find((l) => l.includes('const activeTab = ref(page.homeTab)'))
        expect(line).toBeTruthy()
        expect(line).not.toContain('requestAnalyticsCount')
        // sekmeSec yalniz sablon tiklamalarindan ve openStocksTab'dan cagrilir (programatik baska yol yok)
        const script = home.slice(home.indexOf('<script'))
        expect(script.match(/sekmeSec\(/g)).toHaveLength(2) // tanim + openStocksTab
    })

    it('useAtsPurchase: atsBuy sayimi return true oncesinde, yalniz basarili yolda', () => {
        expect(ats.match(/key: 'atsBuy'/g)).toHaveLength(1)
        const fn = body(ats, /export async function openAtsPurchase\(/)
        const iCount = fn.indexOf("key: 'atsBuy'")
        const iRet = fn.lastIndexOf('return true')
        expect(iCount).toBeGreaterThan(-1)
        expect(iCount).toBeLessThan(iRet)
        expect(fn.slice(iCount, iRet)).not.toMatch(/return false/)
        expect(fn).toMatch(/getSurface\(\)/)
        // Gizli modda mesaj yollanmaz: sayim satiri privacy kapisini tasir (App.vue izleyicisiyle ayni kapi).
        const line = fn.split('\n').find((l) => l.includes("key: 'atsBuy'"))
        expect(line).toMatch(/privacyStore\(\)\.active !== true/)
    })

    it('Send/Swap/Bridge bilesenleri kendi baslarina sayim cagirmaz (tek nokta App.vue)', () => {
        for (const f of ['Send.vue', 'Swap.vue', 'Bridge.vue', 'stocks/StockTrade.vue', 'Token.vue', 'stocks/StockDetail.vue']) {
            expect(read(`components/${f}`), f).not.toMatch(/requestAnalyticsCount\('screen'/)
        }
    })
})
