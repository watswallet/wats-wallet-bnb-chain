// Hisse logolari: cerceve (w-10 h-10) ayni kalir, ic logo cerceveyi ~%90 doldurur (w-9 h-9); Home ve StockTrade tutarli.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const TRADE = read('./StockTrade.vue')
const HOME = read('../Home.vue')

const imgTag = (src, needle) => {
    const i = src.indexOf(needle)
    // Logo ya <img> ya da TokenAvatar bileseni (gizli mod logo cozucusu) olabilir.
    const bas = Math.max(src.lastIndexOf('<img', i), src.lastIndexOf('<TokenAvatar', i))
    return src.slice(bas, src.indexOf('>', i))
}

describe('hisse logosu boyutu', () => {
    it('StockTrade: cerceve w-10 h-10, logo w-9 h-9', () => {
        expect(imgTag(TRADE, 'data-stock-logo ')).toMatch(/class="rounded-full w-9 h-9"/)
        expect(TRADE).toMatch(/relative min-w-10 h-10 rounded-full bg-slate-100/)
    })
    it('Home Hisseler satiri: cerceve w-10 h-10, logo w-9 h-9', () => {
        expect(imgTag(HOME, ':alt="stock.name"')).toMatch(/class="rounded-full w-9 h-9"/)
        expect(HOME).toMatch(/relative min-w-10 h-10 rounded-full bg-slate-100/)
    })
})
