import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ISLEM KAYNAGI CUBUGU - UZUN ADRES TASIRMAMALI.
//
// Onay ekranlarinin tepesindeki cubuk dapp'in kaynagini ("İşlem Kaynağı") yazar.
// Adres uzunlugu bize ait DEGIL: dapp ne bildirdiyse o cizilir.
//
// `truncate` TEK BASINA YETMEZ ve bu tam olarak yasandi (Dapp.vue): bir flex
// ogesinin otomatik en kucuk genisligi icerigine gore hesaplanir, nowrap bir
// metnin min-content'i ise TAM genisligidir. Zincirdeki bir ara sarmalayici
// `min-w-0`/`overflow-hidden` tasimazsa kisaltma hic devreye giremez.
//
// OLCULDU (headless Chrome, 360px kap, 108 karakterlik dapp adresi):
//   sarmalayicida min-w-0 YOK -> cubuk 432px tasti, yontem rozeti sag kenarin
//                                431px disina cikti
//   min-w-0 VAR                -> tasma 0, rozet cubugun icinde
//
// IDDIA KODU DEGIL KURALI OLCER: tek bir sinifi aramak yerine, kisalan metne
// giden ANCESTOR ZINCIRININ tamami taranir. Araya yeni bir sarmalayici eklenirse
// (bu hatanin olus sekli buydu) test yine kirmizi olur.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const sinifi = (etiket) => {
    const m = etiket.match(/class="([^"]*)"/)
    return m ? m[1] : ''
}

// Satir satir `<div>` yigini tutar; kisalan URL metnine gelindiginde o andaki
// yigin, metnin ata zinciridir.
function urlAtaZinciri(src) {
    const satirlar = src.split('\n')
    const yigin = []
    for (const satir of satirlar) {
        const acilislar = satir.match(/<div\b[^>]*>/g) || []
        const kapanisSayisi = (satir.match(/<\/div>/g) || []).length

        // URL metni bu satirda: yigin su an tam olarak ata zinciri.
        if (/\{\{\s*url\s*\}\}/.test(satir)) return { bulundu: true, zincir: [...yigin], satir }

        for (const a of acilislar) yigin.push(sinifi(a))
        for (let i = 0; i < kapanisSayisi; i++) yigin.pop()
    }
    return { bulundu: false, zincir: [], satir: '' }
}

const esnekSatir = (c) => /(^|\s)flex(\s|$)/.test(c) && !/flex-col/.test(c)
const daralabilir = (c) => /min-w-0/.test(c) || /overflow-hidden/.test(c)

const EKRANLAR = [
    ['Dapp', read('./Dapp.vue')],
    ['ConfirmTransaction', read('./ConfirmTransaction.vue')],
]

describe.each(EKRANLAR)('%s - islem kaynagi cubugu', (_ad, SRC) => {
    const { bulundu, zincir, satir } = urlAtaZinciri(SRC)

    it('kaynak adresi kisaltilarak cizilir', () => {
        expect(bulundu).toBe(true)
        expect(satir).toMatch(/truncate/)
    })

    it('kisalan metne giden her esnek oge daralabilir', () => {
        // KURAL (CSS): satir yonlu bir flex kabinin cocugunun otomatik en kucuk
        // genisligi min-content'idir; nowrap metin bunu TAM genislige cikarir.
        // Yani koke giden yolda satir-flex kabinin cocugu olan HER ata
        // daralabilmeli -- biri bile daralamazsa kisaltma o noktada olur.
        const daralamayanlar = zincir
            .map((c, i) => ({ c, ebeveynEsnekSatir: i > 0 && esnekSatir(zincir[i - 1]) }))
            .filter((x) => x.ebeveynEsnekSatir && !daralabilir(x.c))
            .map((x) => x.c)

        expect(daralamayanlar).toEqual([])
        // Zincir gercekten bir flex satirdan geciyor olmali; yoksa iddia bos gecerdi.
        expect(zincir.some(esnekSatir)).toBe(true)
    })
})

describe('Dapp - yontem rozeti', () => {
    const SRC = read('./Dapp.vue')

    it('rozet kaynak metnini ezmez ve kendi metnini kisaltir', () => {
        // getMethodName eslesmeyen imzalarda zincirdeki fonksiyon adini OLDUGU
        // GIBI dondurur (uzunlugu sinirsiz), yani rozetin de bir tavani olmali.
        const rozet = SRC.split('\n').find((s) => /\{\{\s*contractMethodName\s*\}\}/.test(s))
        expect(rozet).toBeTruthy()

        const acilis = SRC.split('\n')
            .slice(0, SRC.split('\n').indexOf(rozet))
            .reverse()
            .find((s) => /<div\b[^>]*class="[^"]*"/.test(s))
        expect(acilis).toMatch(/shrink-0/)
        expect(acilis).toMatch(/truncate/)
        expect(acilis).toMatch(/max-w-/)
    })
})
