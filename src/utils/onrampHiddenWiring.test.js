import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ONRAMP_ENABLED } from './onrampConfig'

// MOONPAY EKRANDA GIZLI.
//
// Kredi karti akisi (BuyToken.vue) ekrana TEK bir yerden cikiyordu: Token.vue'daki
// "Al" dugmesi. Kod duruyor, yalnizca ulasilamiyor.

const SRC = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const TOKEN = codeOnly(read('components/Token.vue'))

// client/src altindaki TUM kaynak dosyalar (testler haric).
const sourceFiles = (dir = SRC, out = []) => {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) { sourceFiles(full, out); continue }
        if (!/\.(js|vue)$/.test(name) || name.includes('.test.')) continue
        out.push(full)
    }
    return out
}

describe('bayrak', () => {
    // "Kapi var" testi bayrak ACIKKEN de yesil kalir; karari kilitleyen yer burasi.
    it('onramp KAPALI', () => {
        expect(ONRAMP_ENABLED).toBe(false)
    })
})

describe('Al dugmesi', () => {
    it('kapisinda ONRAMP_ENABLED var', () => {
        expect(TOKEN).toContain('v-if="features.buy && ONRAMP_ENABLED"')
        expect(TOKEN).toContain("import { ONRAMP_ENABLED } from '../utils/onrampConfig'")
    })

    // MEVCUT kapilar KORUNUYOR. Bu dugme bir kez zaten yanlislikla kosulsuz
    // birakildi (bkz. Token.vue'daki BULGU 2 / F8 yorumu) ve o kapilari olcen
    // uc test (assetRouteWiring, jettonTokenWiring, tonFlowWiring) onun icin
    // yazildi. Yeni kapi onlarin YERINE degil, USTUNE geldi.
    it('zincir kapilari yerinde duruyor', () => {
        const at = TOKEN.indexOf('v-if="features.buy && ONRAMP_ENABLED"')
        expect(at).toBeGreaterThan(-1)
        expect(TOKEN.slice(at, at + 400)).toContain('v-if="!isTonAsset" @click="selectReceive"')
    })
})

describe('MoonPay ekranina baska yol YOK', () => {
    // ASIL DEGISMEZ: ileride biri Ana ekrana bir "Al" dugmesi eklerse akis
    // sessizce geri acilir ve kapali bayrak hicbir sey ifade etmez.
    it("'buy_token' yalnizca Token.vue ve App.vue da geciyor", () => {
        // YORUMLAR ATILIR: aranan sey bir KOD YOLU, bir aciklama degil.
        // (onrampConfig.js akisi yorumunda anlatiyor - o bir yol degil.)
        const hits = sourceFiles()
            .filter((f) => codeOnly(readFileSync(f, 'utf8')).includes('buy_token'))
            .map((f) => path.relative(SRC, f).replace(/\\/g, '/'))

        // Once VARLIK: dosyalar bulunamazsa dizi bos gecer ve test anlamsizca
        // yesil kalirdi.
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.sort()).toEqual(['components/Token.vue', 'popup/App.vue'])
    })

    it('Token.vue da buy_token a giden tek yer selectReceive', () => {
        expect(TOKEN.split("page.currentPage = 'buy_token'")).toHaveLength(2)
        const at = TOKEN.indexOf("page.currentPage = 'buy_token'")
        const fnAt = TOKEN.lastIndexOf('const ', at)
        expect(TOKEN.slice(fnAt, at)).toContain('selectReceive')
    })
})
