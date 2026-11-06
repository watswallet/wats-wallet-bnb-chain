// StockTrade -- piyasa kapaliyken xStocks pasif (kullanici karari 2026-10-24): kablolama taramasi.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('./StockTrade.vue', import.meta.url)), 'utf8')

describe('StockTrade.vue -- piyasa kilidi kablolamasi', () => {
    it('secici kilidi alir; piyasa durumu kaynagi marketStatus', () => {
        expect(SRC).toContain(':lock="issuerSwitch.xLock"')
        expect(SRC).toMatch(/useIssuerSwitch\(\{[^}]*market: \(\) => market\.value/)
        expect(SRC).toContain('fetchMarketStatus(')
    })

    it('kapali + Al sekmesi: teklif istenmez (quoteEnabled), mevcut kapali mesaji; Sat etkilenmez', () => {
        expect(SRC).toMatch(/const quoteEnabled = computed\([^\n]*!marketBlocked\.value/)
        expect(SRC).toMatch(/marketBlocked\.value \? 'lock-MARKET_CLOSED'/)
        expect(SRC).toMatch(/if \(marketBlocked\.value\) return lockLine\(\{ lockReason: 'MARKET_CLOSED'/)
    })

    it('kilit yalniz Al yonunde: marketBlocked side buy ile kosullu', () => {
        expect(SRC).toMatch(/const marketBlocked = computed\(\(\) => issuerSwitch\.blocked && side\.value === 'buy'\)/)
    })

    it('hata/belirsiz durumda market null: kilit yok', () => {
        expect(SRC).toMatch(/catch \{ next = null \}/)
    })
})
