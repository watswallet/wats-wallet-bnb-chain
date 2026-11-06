// StockChainPicker -- hisse sayfasi ag secici. Cok agda cipler, tek agda sade etiket.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, createTestI18n } from '../../test-utils/ssrRender.js'
import { companyRows } from '../../utils/stocks/stockCompanies'
import StockChainPicker from './StockChainPicker.vue'
import { chainLogo } from '../../utils/chainLogo'

const rows = (u, issuer) => companyRows(u, { xstocksEnabled: true }).filter((r) => r.issuer === issuer)
const clean = (h) => h.replace(/<!--[\s\S]*?-->/g, '')
async function html(props, locale = 'en') {
    return clean(await render(createApp(StockChainPicker, { props, use: [createTestI18n(locale)] })))
}
const SRC = readFileSync(fileURLToPath(new URL('./StockChainPicker.vue', import.meta.url)), 'utf8')
const multi = () => ['TSLA', 'NVDA', 'AMZN', 'MSFT', 'CRCL', 'MSTR', 'SPY'].find((u) => rows(u, 'xstocks').length > 1)

describe('StockChainPicker.vue', () => {
    it('cok agli xStocks: her ag icin bir cip, secili olan aria-pressed=true', async () => {
        const r = rows(multi(), 'xstocks')
        const out = await html({ rows: r, selected: r[0].chainId })
        expect(out.match(/data-stock-chain-chip=/g)).toHaveLength(r.length)
        expect(out).toContain(`data-stock-chain-chip="${r[0].chainId}" aria-pressed="true"`)
        expect(out).toContain(`data-stock-chain-chip="${r[1].chainId}" aria-pressed="false"`)
        expect(out).not.toContain('data-stock-chain-label')
    })

    it('bStocks (tek ag): chip yok, sade "Network: BNB..." etiketi', async () => {
        const r = rows('TSLA', 'bstocks')
        const out = await html({ rows: r, selected: 56 })
        expect(out).not.toContain('data-stock-chain-chip')
        expect(out).toContain('data-stock-chain-label')
        expect(out).toMatch(/Network: /)
    })

    it('cok agda her cipte ag logosu; tek agda etiket logosu (src chainLogo, alt ag adi)', async () => {
        const r = rows(multi(), 'xstocks')
        const out = await html({ rows: r, selected: r[0].chainId })
        for (const row of r) expect(out).toContain(`src="${chainLogo(row.chainId)}"`)
        expect(out.match(/<img/g)).toHaveLength(r.length)
        const one = await html({ rows: rows('TSLA', 'bstocks'), selected: 56 })
        expect(one.match(/<img/g)).toHaveLength(1)
        expect(one).toContain(`src="${chainLogo(56)}"`)
        expect(one).toContain('alt="BNB Smart Chain"')
    })

    it('tr etiketi "Ag:" ile baslar', async () => {
        const out = await html({ rows: rows('TSLA', 'bstocks'), selected: 56 }, 'tr')
        expect(out).toMatch(/Ağ: /)
    })

    it('bos satirlar -> DOM te yok', async () => {
        const out = await html({ rows: [], selected: null })
        expect(out).not.toContain('data-stock-chain')
    })

    it('kaynak: chip pick olayi yayar, applyNetworkChange kullanmaz', () => {
        expect(SRC).toContain("$emit('pick'")
        expect(SRC).not.toContain('applyNetworkChange')
    })
})
