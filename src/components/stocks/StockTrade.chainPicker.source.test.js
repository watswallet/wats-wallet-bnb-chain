// StockTrade -- ag secici baglantisi: secim teklifi gecersiz kilar, bakiyeyi yeniler, cuzdan agini degistirmez.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('./StockTrade.vue', import.meta.url)), 'utf8')

describe('StockTrade.vue -- ag secici', () => {
    it('ihracci seciciyle ayni yerde StockChainPicker, pickChain a bagli', () => {
        expect(SRC).toContain("import StockChainPicker from './StockChainPicker.vue'")
        expect(SRC).toMatch(/<StockChainPicker[^>]*:rows="issuerSwitch\.chainRows"[^>]*:selected="issuerSwitch\.chain"[^>]*@pick="issuerSwitch\.pickChain"/)
    })

    it('ag degisimi ayni sifirlama yolundan gecer: eski teklif gecersiz, bakiye yenilenir', () => {
        const fn = SRC.slice(SRC.indexOf('function onIssuerSwitched()'), SRC.indexOf('// Hesap degisince adim kapanir'))
        expect(fn).toContain('quote.invalidate()')
        expect(fn).toContain('loadBalance()')
        expect(fn).toContain("amount.value = ''")
    })

    it('applyNetworkChange yok', () => {
        expect(SRC).not.toContain('applyNetworkChange')
    })
})
