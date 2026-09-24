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

// SOLANA (§4.6): TOPLAM dort yonlendirme noktasi + uc import + uc template girdisi
// var. Yalnizca switch'ler guncellenirse `page.currentPage = 'solana_connect'`
// hicbir v-if ile eslesmez ve kullanici BOS BIR PENCERE gorur -- hicbir hata,
// hicbir log. Dorduncu nokta (eve donus dizisi) atlanirsa da istek cozuldukten
// SONRA ekran Solana onay ekraninda ASILI kalir.
describe('App.vue -- Solana onay ekranlari yonlendirmesi', () => {
    const YOLLAR = [
        ['SOLANA_CONNECT', 'solana_connect', 'SolanaConnectApprove'],
        ['SOLANA_SIGN_TX', 'solana_sign_tx', 'SolanaSignTx'],
        ['SOLANA_SIGN_MESSAGE', 'solana_sign_message', 'SolanaSignMessage'],
    ]

    it('1. nokta: kilitsiz dalda uc tip de kendi sayfasina yonlenir', () => {
        const fn = block(APP, 'if(response.unlocked)', /^\s*\}\s*else\s*\{/)
        for (const [tip, sayfa] of YOLLAR) {
            expect(fn).toMatch(new RegExp(`case '${tip}':\\s*page\\.currentPage = '${sayfa}'`))
        }
    })

    it('2. nokta: kilitli dalda uc tip de page.redirect ile kuyruga alinir', () => {
        const fn = block(APP, 'Wallet is locked', /page\.currentPage = 'welcome'/)
        for (const [tip, sayfa] of YOLLAR) {
            expect(fn).toMatch(new RegExp(`case '${tip}':\\s*page\\.redirect = '${sayfa}'`))
        }
    })

    it('3. nokta: canli current_request yazimini dinleyen switch uc tipi de tanir', () => {
        const fn = block(APP, 'chrome.storage.onChanged.addListener', /^\s*\}\)\s*$/)
        for (const [tip, sayfa] of YOLLAR) {
            expect(fn).toMatch(new RegExp(`case '${tip}': page\\.currentPage = '${sayfa}'`))
        }
    })

    it('4. nokta: istek cozuldugunde eve donen sayfa listesi uc ekrani da kapsar', () => {
        const fn = block(APP, 'chrome.storage.onChanged.addListener', /^\s*\}\)\s*$/)
        const dizi = fn.match(/\[([^\]]*)\]\.includes\(page\.currentPage\)/)
        expect(dizi).not.toBeNull()
        for (const [, sayfa] of YOLLAR) expect(dizi[1]).toContain(`'${sayfa}'`)
    })

    // YONLENDIRME tablosu (1-4. noktalar) BURADA tamamlanir: duz bir dizge
    // eslemesidir, karsiligi olmayan bir sayfa adi zararsizdir, ve tabloyu
    // parca parca eklemek dorduncu noktanin (eve donus dizisi) unutulmasina
    // yol acan tam olarak o desendir.
    //
    // IMPORT ve TEMPLATE girdisi OYLE DEGILDIR: var olmayan bir .vue dosyasini
    // import etmek M1'de DERLEMEYI KIRAR. Her ekran kendi milestone'unda
    // baglanir (SolanaSignMessage M2, SolanaSignTx M3) ve bu test o turlarda
    // kendi satiriyla genisletilir.
    it('bagli ekran import edilir VE template de kendi v-if girdisini alir', () => {
        expect(APP).toContain("import SolanaConnectApprove from '../components/dapp/SolanaConnectApprove.vue'")
        expect(APP).toContain(`<SolanaConnectApprove v-if="page.currentPage === 'solana_connect'"`)
    })

    // M2'nin ekledigi ekran. Yonlendirme M1'de kuruldu; RENDER yolu burada.
    it('SolanaSignMessage import edilir VE template de kendi v-if girdisini alir', () => {
        expect(APP).toContain("import SolanaSignMessage from '../components/dapp/SolanaSignMessage.vue'")
        expect(APP).toContain(`<SolanaSignMessage v-if="page.currentPage === 'solana_sign_message'"`)
    })

    // M3'un ekledigi ekran. Yonlendirme zaten M1'de kuruldu; eksik olan RENDER
    // yoluydu. Ikisi ayri turlarda ciktigi icin ayri iddia: bir sonraki tur bu
    // satiri silmeden gecerse ekran sessizce BOS pencereye doner.
    it('SolanaSignTx import edilir VE template de kendi v-if girdisini alir', () => {
        expect(APP).toContain("import SolanaSignTx from '../components/dapp/SolanaSignTx.vue'")
        expect(APP).toContain(`<SolanaSignTx v-if="page.currentPage === 'solana_sign_tx'"`)
    })
})

// EVM AG DEGISTIRME (EIP-3326, 2026-09-11). Yukaridaki Solana blogunun AYNISI
// ve AYNI sebeple ayri yazildi: `YOLLAR` listeleri ELLE tutuluyor, kaynaktan
// turetilmiyor. Yani yeni bir tip eklenip dort noktadan biri unutulursa
// Solana'nin testi bunu YAKALAMAZ -- yesil takim hicbir sey kanitlamaz.
// Ozellikle 4. nokta (eve donus dizisi): unutulursa istek cozuldukten SONRA
// ekran onay ekraninda ASILI kalir, hicbir hata, hicbir log.
describe('App.vue -- EVM ag degistirme onay ekrani yonlendirmesi', () => {
    const TIP = 'SWITCH_CHAIN'
    const SAYFA = 'switch_chain'

    it('1. nokta: kilitsiz dalda kendi sayfasina yonlenir', () => {
        const fn = block(APP, 'if(response.unlocked)', /^\s*\}\s*else\s*\{/)
        expect(fn).toMatch(/case 'SWITCH_CHAIN':\s*page\.currentPage = 'switch_chain'/)
    })

    it('2. nokta: kilitli dalda page.redirect ile kuyruga alinir', () => {
        const fn = block(APP, 'Wallet is locked', /page\.currentPage = 'welcome'/)
        expect(fn).toMatch(/case 'SWITCH_CHAIN':\s*page\.redirect = 'switch_chain'/)
    })

    it('3. nokta: canli current_request yazimini dinleyen switch tanir', () => {
        const fn = block(APP, 'chrome.storage.onChanged.addListener', /^\s*\}\)\s*$/)
        expect(fn).toMatch(/case 'SWITCH_CHAIN': page\.currentPage = 'switch_chain'/)
    })

    it('4. nokta: istek cozuldugunde eve donen sayfa listesi bu ekrani da kapsar', () => {
        const fn = block(APP, 'chrome.storage.onChanged.addListener', /^\s*\}\)\s*$/)
        const dizi = fn.match(/\[([^\]]*)\]\.includes\(page\.currentPage\)/)
        expect(dizi).not.toBeNull()
        expect(dizi[1]).toContain(`'${SAYFA}'`)
    })

    it('import edilir VE template kendi v-if girdisini alir', () => {
        expect(APP).toContain("import SwitchChain from '../components/dapp/SwitchChain.vue'")
        expect(APP).toContain(`<SwitchChain v-if="page.currentPage === 'switch_chain'"`)
    })
})

