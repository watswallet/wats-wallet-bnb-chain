// EKRAN LISTESI -- "App.vue'nun <Transition>'i hangi bilesenleri barindiriyor"
// sorusunun TEK yeri.
//
// NEDEN ELLE LISTE DEGIL: bu listeyi tuketen kilitler (bkz.
// components/screenSetupPageWrite.ssr.test.js ve components/screenDeadlockShapes.test.js)
// bir SINIF hatayi -- bir ekranin setup/render SIRASINDA `currentPage` yazip
// `<Transition mode="out-in">`i kalici olarak kilitlemesini -- kapatiyor. Elle
// yazilmis bir liste o kilidi SESSIZCE gevsetir: yarin eklenen ekran listede
// olmadigi icin kilit onu hic gormez ve suite yesil kalir. Liste bu yuzden
// App.vue'nun KENDISINDEN cikarilir; yeni bir ekran eklendigi anda kapsama
// kendiliginden girer.
//
// YORUM KORLUGU: kaynak `yorumsuz()`ten gecirilir. App.vue'da yorum satirina
// alinmis bir ekran (`<!-- <SelectPhrase ... /> -->`) GERCEK bir ekran DEGILDIR
// ve listeye girmemelidir -- yoksa var olmayan bir sayfa icin render denenir.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from './kaynakTarama.js'

const BURASI = dirname(fileURLToPath(import.meta.url))
export const APP_VUE = resolve(BURASI, '../popup/App.vue')

// Vite'in kok-mutlak glob'u: anahtar bicimi bu modulun NEREDE durduguna
// bagli DEGIL, yani dosyayi tasimak kilidi sessizce bozmaz.
const VUE_MODULLERI = import.meta.glob('/src/**/*.vue')

/** `<script setup>` icindeki `import Ad from '...'` eslemesi. */
function importHaritasi(kaynak) {
    const harita = new Map()
    const re = /^import\s+([A-Z][A-Za-z0-9]*)\s+from\s+'([^']+)'/gm
    let m
    while ((m = re.exec(kaynak))) harita.set(m[1], m[2])
    return harita
}

/** `popup/` koreline gore yazilmis goreli yolu `/src/...` anahtarina cevirir. */
function globAnahtari(goreliYol) {
    const parcalar = ('popup/' + goreliYol).split('/')
    const yigin = []
    for (const p of parcalar) {
        if (p === '..') yigin.pop()
        else if (p !== '.' && p !== '') yigin.push(p)
    }
    return '/src/' + yigin.join('/')
}

/**
 * `<Transition>` blogunun BARINDIRDIGI ekranlar.
 *
 * @returns {{tag:string, page:string, anahtar:string, dosya:string}[]}
 *   `tag` bilesen etiketi, `page` onu goruntuleyen `currentPage` degeri,
 *   `anahtar` `yukle()` icin glob anahtari, `dosya` diskteki mutlak yol.
 */
export function ekranListesi() {
    const kaynak = readFileSync(APP_VUE, 'utf8')
    const kod = yorumsuz(kaynak)

    const bas = kod.indexOf('<Transition')
    const son = kod.indexOf('</Transition>')
    if (bas === -1 || son === -1 || son < bas) {
        throw new Error('ekranListesi: App.vue icinde <Transition> blogu bulunamadi -- sablon degistiyse bu tarayici da guncellenmeli')
    }
    const blok = kod.slice(bas, son)

    const eslesmeler = []
    const re = /<([A-Z][A-Za-z0-9]*)\b[^>]*?v-if="[^"]*?page\.currentPage === '([^']+)'/g
    let m
    while ((m = re.exec(blok))) eslesmeler.push({ tag: m[1], page: m[2] })

    // TARAYICI KORLUGUNE KARSI SAYIM. Yukaridaki regex `v-if`e ve tek tirnaga
    // bagli; birisi yarin `v-else-if` ya da farkli bir yazim kullanirsa ekran
    // SESSIZCE listeden duserdi -- yani kilit bir ekrani kaybettigini hic
    // soylemeden zayiflardi. Blokta gecen `page.currentPage ===` sayisi ile
    // yakalanan eslesme sayisi ayni olmak ZORUNDA.
    const gecisSayisi = (blok.match(/page\.currentPage ===/g) || []).length
    if (gecisSayisi !== eslesmeler.length) {
        throw new Error(
            `ekranListesi: <Transition> icinde ${gecisSayisi} adet 'page.currentPage ===' var ama ` +
            `yalnizca ${eslesmeler.length} ekran yakalandi. Sablonda tanimadigim bir yazim var ` +
            `(v-else-if? cift tirnak?) -- tarayiciyi guncelleyin, aksi halde o ekran hicbir kilide girmez.`
        )
    }

    const importlar = importHaritasi(kaynak)
    const gorulen = new Set()
    const liste = []
    for (const { tag, page } of eslesmeler) {
        if (gorulen.has(tag)) continue
        gorulen.add(tag)
        const goreli = importlar.get(tag)
        if (!goreli) throw new Error(`ekranListesi: <${tag}> sablonda var ama App.vue'da import edilmemis`)
        const anahtar = globAnahtari(goreli)
        liste.push({ tag, page, anahtar, dosya: resolve(BURASI, '..', anahtar.replace('/src/', '')) })
    }
    return liste
}

/** Ekran bilesenini (glob anahtariyla) yukler. */
export async function ekranYukle(anahtar) {
    const yukleyici = VUE_MODULLERI[anahtar]
    if (!yukleyici) throw new Error(`ekranYukle: ${anahtar} glob sonucunda yok`)
    return (await yukleyici()).default
}
