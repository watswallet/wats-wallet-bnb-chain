import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GERI BUTONU TIKLANMIYOR.
//
// Bu ekranlarda icerik blogu `-mt-10` ile YUKARI cekiliyor - baslik seridi
// yarisaydam (`bg-white/80 backdrop-blur-md`) ve icerigin ONUNDEN gecmesi
// tasarlanmis bir gorunum. Ama iki blok da `z-10` ve KARDES: esit z-index'te
// DOM'da sonra gelen uste boyanir, yani icerik basligin uzerini kapatiyor.
//
// Geri butonunun kendi `z-40`'i BUNU COZMEZ: baslik `relative z-10` oldugu icin
// KENDI yiginlama baglamini acar ve icerideki z-40 yalnizca o kabin ICINDE
// gecerlidir. Ayni tuzak NetworkScopePill.vue'nun bas yorumunda da yazili.
//
// Gorunurde hicbir sey ters degil - binen alan icerigin BOS ust kismi (icerik
// `justify-center`). Bu yuzden ekran dogru gorunuyor ama okun buyuk bolumu
// tiklanmiyor: tiklama, ustteki gorunmez bloga gidiyor.
//
// DOM testi yazilamiyor (bu repoda jsdom/@vue/test-utils yok, vitest environment
// 'node'); bu yuzden kosul KAYNAK METINDEN olculuyor - deponun swapWiring /
// assetRouteWiring dosyalarindaki ayni desen.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Ayni duzeni paylasan TUM ekranlar. Biri duzeltilip digerleri unutulursa hata
// "duzeltildi" sanilir - kullanici baska bir ekranda ayni seyi yasar.
const SCREENS = [
    ['../components/settings/accounts/ShowTonKey.vue'],
    ['../components/settings/accounts/ShowPhrases.vue'],
    ['../components/settings/accounts/ShowPrivateKey.vue'],
    ['../components/settings/security/UnlockVault.vue'],
]

const zOf = (src, pattern) => {
    const m = src.match(pattern)
    return m ? Number(m[1]) : null
}

describe('geri butonu tiklanabilir kalir - baslik icerigin USTUNDE', () => {
    it.each(SCREENS)('%s baslik seridi icerik blogundan YUKSEK z-index e sahip', (rel) => {
        const src = read(rel)

        const header = zOf(src, /backdrop-blur-md z-(\d+)/)
        const content = zOf(src, /relative -mt-10 z-(\d+)/)

        expect(header, `${rel}: baslik z-index bulunamadi`).not.toBeNull()
        expect(content, `${rel}: icerik z-index bulunamadi`).not.toBeNull()
        expect(header, rel).toBeGreaterThan(content)
    })

    // Ustteki iddia, `-mt-10` kaldirilarak da saglanabilirdi ve o BASKA bir
    // duzeltme olurdu (gorunum degisir: icerik artik basligin altindan
    // baslamaz). Ortusmenin DEVAM ETTIGINI dogruluyoruz ki test, gercekten
    // katman sirasini olctugunu bilsin.
    it.each(SCREENS)('%s ortusen duzen KORUNUR - duzeltme katman sirasindan gelir', (rel) => {
        expect(read(rel), rel).toContain('-mt-10')
    })

    // Geri butonu bu ekranlarda ortak `Back` bilesenidir. Biri onu elle yazilmis
    // bir butona cevirirse yukaridaki iddialar hala gecer ama buton yine
    // baslikta olmayabilir.
    it.each(SCREENS)('%s geri butonu baslik seridinin ICINDE', (rel) => {
        const src = read(rel)
        const headerStart = src.indexOf('backdrop-blur-md z-')
        const headerEnd = src.indexOf('</div>', headerStart)

        expect(headerStart, `${rel}: baslik seridi bulunamadi`).toBeGreaterThan(-1)
        expect(src.slice(headerStart, headerEnd), rel).toContain('<Back')
    })
})
