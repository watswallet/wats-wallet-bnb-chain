// popup/App.vue: F5 (kod incelemesi) tel testleri -- kaynak uzerinden (bkz.
// homeSolanaWiring.test.js / selectNetworkWiring.test.js AYNI gerekce: App.vue
// onlarca alt bilesen import ediyor, tam bir SSR render bunlarin HEPSINI
// mocklamayi gerektirir -- orantisiz bir maliyet bu tek yonlendirme kararini
// kilitlemek icin).
//
// KOK NEDEN: `current_request` diskte KALICI ve onu temizleyen tek yer
// (resolvePendingRequest) yalniz `pendingRequests` Map'inde bir kayit VARSA
// calisir -- bu Map bir MV3 service-worker yeniden baslatilmasinda BOSALIR.
// App.vue onceden SADECE `current_request.type`e bakarak Dapp.vue/ConnectDapp.vue/
// Sign.vue'ye yonlendiriyordu (chain kontrolu YOKTU); Dapp.vue TAMAMEN EVM'e ozel
// oldugu icin (guard'siz currentNetwork.rpc[0].url okur) bu, Solana aktifken
// bayat bir istekle TypeError'a duserdi.
//
// Karar KENDISI (isDappRequestStale) ayri, dogrudan mutasyon-duyarli testlerle
// dappRequestGuard.test.js'te kilitli; burasi App.vue'nun bu karari GERCEKTEN
// UC cagri noktasinda da kullandigini (chain kontrolsuz eski dallara donmedigini)
// dogrular.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const APP = readFileSync(join(here, '..', 'popup', 'App.vue'), 'utf8')

// YORUMLAR ATILIR: aksi halde kilit SAHTE olur (bkz. assetRouteWiring.test.js) --
// bu dosyanin kendi duzeltme yorumlari eski kod parcalarini METIN olarak
// icerebilir.
const block = (source, anchor, closer) => {
    const lines = source.split(/\r?\n/)
    const start = lines.findIndex((l) => l.includes(anchor))
    if (start < 0) return ''
    const end = lines.findIndex((l, i) => i > start && closer.test(l))
    return lines.slice(start, end < 0 ? undefined : end)
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join(String.fromCharCode(10))
}

describe('App.vue -- isDappRequestStale ICE ALINDI (Task 15 F5)', () => {
    it('saf karar dappRequestGuard.js tan import edilir', () => {
        expect(APP).toMatch(/import\s*\{\s*isDappRequestStale\s*\}\s*from\s*['"]\.\.\/utils\/dappRequestGuard['"]/)
    })

    it('KILITLI (unlocked) dalda current_request KARARSIZ islenmez: isDappRequestStale ile korunur', () => {
        const fn = block(APP, 'if(response.unlocked)', /^\s*\}\s*else\s*\{/)
        expect(fn).toMatch(/isDappRequestStale\(current_request,\s*currentNetwork\)/)
        // Eski, chain-korumasiz dal artik YOK: dogrudan current_request.type'a
        // bakan bir if/switch, guard'dan ONCE gelmemeli.
        const guardIdx = fn.indexOf('isDappRequestStale(')
        const switchIdx = fn.indexOf('switch (current_request.type)')
        expect(guardIdx).toBeGreaterThan(-1)
        expect(switchIdx).toBeGreaterThan(-1)
        expect(guardIdx).toBeLessThan(switchIdx)
        // Bayat oldugunda kayit TEMIZLENIR (bir sonraki acilista tekrar sormasin).
        expect(fn).toMatch(/isDappRequestStale\(current_request,\s*currentNetwork\)\)\s*\{\s*[\s\S]{0,80}chrome\.storage\.local\.remove\('current_request'\)/)
    })

    it('KILITLI (locked) dalda AYNI koruma page.redirect atamalarindan ONCE gelir', () => {
        const fn = block(APP, "Wallet is locked", /page\.currentPage = 'welcome'/)
        expect(fn).toMatch(/isDappRequestStale\(current_request,\s*currentNetwork\)/)
        const guardIdx = fn.indexOf('isDappRequestStale(')
        const switchIdx = fn.indexOf('switch (current_request.type)')
        expect(guardIdx).toBeGreaterThan(-1)
        expect(switchIdx).toBeGreaterThan(-1)
        expect(guardIdx).toBeLessThan(switchIdx)
    })

    // KOD INCELEMESI (turu 2, D): bu UCUNCU cagri noktasi digerlerinden FARKLI bir
    // kaynak okuyordu (`network.currentNetwork`). O ref'i dolduran
    // initializeCurrentNetwork() bekletilmeden baslatiliyor; hala `null`ken
    // evmOnlyFeatures(null).dapp `false` doner, yani dinleyici GECERLI bir istegi
    // "bayat" sayip SESSIZCE SILERDI (cokme yok, istek yok olur). Uc nokta da
    // DEPODAN okumak ZORUNDA.
    it('CANLI current_request yazimini dinleyen storage.onChanged DEPODAN okur, store ref inden DEGIL', () => {
        const fn = block(APP, 'chrome.storage.onChanged.addListener', /^\s*\}\)\s*$/)
        expect(fn).toMatch(/chrome\.storage\.local\.get\('currentNetwork'\)/)
        expect(fn).toMatch(/isDappRequestStale\(newVal,\s*storedNetwork\)/)
        // Eski, store-ref'e bakan bicim GERI GELMEMELI.
        expect(fn).not.toMatch(/isDappRequestStale\([^)]*network\.currentNetwork/)
        const guardIdx = fn.indexOf('isDappRequestStale(')
        const switchIdx = fn.indexOf("switch (newVal.type)")
        expect(guardIdx).toBeGreaterThan(-1)
        expect(switchIdx).toBeGreaterThan(-1)
        expect(guardIdx).toBeLessThan(switchIdx)
    })
})
