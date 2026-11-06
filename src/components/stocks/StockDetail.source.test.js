// T8: StockDetail eylemleri KAYNAK TARAMASIYLA kilitli (@click baglari SSR'de gorunmez).
// Yorumlar silinir; yoksa yorumdaki eski kod eslesir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = readFileSync(resolve(HERE, 'StockDetail.vue'), 'utf8')
const src = yorumsuz(RAW)
const STORE = yorumsuz(readFileSync(resolve(HERE, '../../store/pageStore.js'), 'utf8'))

const tag = (attr) => {
    const m = src.match(new RegExp(`<button[^>]*${attr}[^>]*>`))
    return m ? m[0] : ''
}
const order = (body, ...parts) => {
    const idx = parts.map((p) => body.search(p))
    expect(idx.every((i) => i >= 0), `eksik parca: ${parts} @ ${idx}`).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
}

describe('StockDetail.vue -- @click baglari', () => {
    it('Al ve Sat selectTrade ile baglidir', () => {
        expect(tag('data-stock-buy')).toContain(`@click="selectTrade('buy')"`)
        expect(tag('data-stock-sell')).toContain(`@click="selectTrade('sell')"`)
    })

    it('Gonder selectSend, Yatir selectDeposit (B1: ensureChain ONCE)', () => {
        expect(tag('data-stock-send')).toContain('@click="selectSend"')
        expect(tag('data-stock-deposit')).toContain('@click="selectDeposit"')
    })

    it('Kopru / Takas / MoonPay eylemi YOK', () => {
        for (const w of ['selectBridge', 'selectSwap', 'selectReceive', 'token.bridge', 'buy_token', "'bridge'", "'swap'", 'onramp']) {
            expect(src, w).not.toContain(w)
        }
        expect(src).not.toMatch(/currentPage\s*=\s*'(bridge|swap|buy_token)'/)
    })
})

describe('StockDetail.vue -- ensureChain', () => {
    const body = blokGovdesi(RAW, /const ensureChain = async \([^)]*\) =>/)

    it('Token.vue ile ayni olcut: isSameChainId, ALL_CHAINS, applyNetworkChange', () => {
        expect(body).not.toBeNull()
        expect(body).toContain('isSameChainId')
        expect(body).toContain('ALL_CHAINS.find')
        expect(body).toContain('applyNetworkChange(')
    })

    it('zincir bilinmiyorsa false doner (akis durur)', () => {
        expect(body).toMatch(/if \(!chain\) return false/)
    })

    it('applyNetworkChange sonucu aynen doner (basarisizsa false)', () => {
        expect(body).toMatch(/return (await )?applyNetworkChange\(/)
    })
})

describe('StockDetail.vue -- selectTrade (Al / Sat)', () => {
    const body = blokGovdesi(RAW, /const selectTrade = async \(side\) =>/)

    // Kullanici karari (2026-10-23): Al/Sat cuzdanin aktif agini DEGISTIRMEZ; islem hissenin zincirinde
    // (selected_token_ref.chainId) yapilir. Gonder / Yatir ensureChain'i korur (asagida).
    it('tradeSide -> stock_trade; ag degisimi YOK (ensureChain / applyNetworkChange cagrilmaz)', () => {
        expect(body).not.toBeNull()
        order(body, /page\.tradeSide\s*=\s*side/, /page\.currentPage\s*=\s*'stock_trade'/)
        expect(body).not.toContain('ensureChain')
        expect(body).not.toContain('applyNetworkChange')
    })

    it('Sat pozisyon yokken calismaz (canSell kapisi), side yalniz buy|sell', () => {
        expect(body).toMatch(/side\s*===\s*'sell'\s*&&\s*!sellEnabled\.value/)
        expect(body).toMatch(/side\s*!==\s*'buy'\s*&&\s*side\s*!==\s*'sell'/)
    })

    it('ust uste dokunus korumasi', () => {
        expect(body).toMatch(/if \(acting\.value\) return/)
        expect(body).toContain('acting.value = true')
        expect(body).toContain('acting.value = false')
    })
})

describe('StockDetail.vue -- selectSend (Gonder)', () => {
    const body = blokGovdesi(RAW, /const selectSend = async \(\) =>/)

    it('ensureChain ONCE, crypto.sendAsset SONRA, sonra send sayfasi', () => {
        expect(body).not.toBeNull()
        order(body, /await ensureChain\(/, /crypto\.sendAsset\s*=/, /page\.currentPage\s*=\s*'send'/)
    })

    it('kayit sendAssetFor ile kurulur (satir kimligi + market), entry yoksa cikar', () => {
        expect(body).toContain('sendAssetFor(')
        expect(body).toMatch(/if \(!entry\.value\) return/)
        expect(body).toContain('crypto.selected_token_ref')
    })

    it('ensureChain basarisizsa sendAsset yazilmaz', () => {
        expect(body).toMatch(/if \(!await ensureChain\([^)]*\)\) return/)
    })
})

describe('StockDetail.vue -- Yatir', () => {
    it('Receive popup bu sayfada cizilir (yalniz Home.vue cizdiginden gorunmezdi)', () => {
        expect(src).toMatch(/<Receive v-if="popups\.receive"/)
        expect(src).toMatch(/import Receive from '\.\.\/popups\/Receive\.vue'/)
        expect(src).toMatch(/popupStore\(\)/)
    })

    // B1: Receive adresi AKTIF AGDAN turetir; bayrak kapaliyken Home.openStock ag degistirmez.
    // Solana/TON aktifken bStock (BSC) detayindan Yatir yanlis ag adresi gosterirdi.
    const body = blokGovdesi(RAW, /const selectDeposit = async \(\) =>/)

    it('yatir: ensureChain ONCE, popups.receive SONRA; entry yoksa cikar', () => {
        expect(body).not.toBeNull()
        expect(body).toMatch(/if \(!entry\.value\) return/)
        order(body, /await ensureChain\(/, /popups\.receive\s*=\s*true/)
    })

    it('ensureChain basarisizsa Receive acilmaz; ust uste dokunus korumasi var', () => {
        expect(body).toMatch(/if \(!await ensureChain\([^)]*\)\) return/)
        expect(body).toMatch(/if \(acting\.value\) return/)
    })
})

describe('pageStore.tradeSide', () => {
    it('null ile baslar ve store disari verir', () => {
        expect(STORE).toMatch(/const tradeSide = ref\(null\)/)
        expect(STORE).toMatch(/return \{[^}]*\btradeSide\b[^}]*\}/)
    })
})
