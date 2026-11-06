// Birlesme (origin/main e470ca1 + xStocks Faz 1-2 + gizli mod): ana ekran sekme satiri Varliklar, Hisseler,
// Aktiviteler, Gizli islemler sirasindadir ve gorunen sekme IKI dususu de korur. e470ca1 Aktiviteler'i
// Hisseler'in ARKASINA tasidi; dal Gizli islemler sekmesini satirin SONUNA ekledi; xStocks stockGroups'u
// getirdi ve gorunenSekme'yi yeniden yazdi. Cakisma cozumunde bir sekme dusebilir, kopyalanabilir, sira
// bozulabilir ya da iki dususten biri kaybolabilir. SSR testleri sirayi olcmez: kaynak-sekil kilidi
// (yorumsuz taranir: iddia yalnizca KOD ile saglanir).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const kaynak = yorumsuz(readFileSync(join(here, 'Home.vue'), 'utf8'))

// Sekme dugmelerinin tiklama baglari, satirdaki beklenen sirayla.
const SEKMELER = [
    ['Varliklar', `@click="sekmeSec('assets')"`],
    ['Hisseler', '@click="openStocksTab"'],
    ['Aktiviteler', `@click="sekmeSec('activity')"`],
    ['Gizli islemler', `@click="sekmeSec('private')"`],
]

describe('Home.vue: sekme satiri (main e470ca1 + xStocks + gizli mod birlesimi)', () => {
    it('dort sekme dugmesinin her biri TEK kez gecer', () => {
        for (const [ad, bag] of SEKMELER) {
            expect(kaynak.split(bag).length - 1, ad).toBe(1)
        }
    })

    it('sira: Varliklar, Hisseler, Aktiviteler, Gizli islemler', () => {
        const yerler = SEKMELER.map(([, bag]) => kaynak.indexOf(bag))
        expect(yerler.every((y) => y > -1)).toBe(true)
        expect(yerler).toEqual([...yerler].sort((a, b) => a - b))
    })

    it('gorunenSekme iki dususu de korur: hesap hicbir hisse zincirini tutamiyorsa Varliklar, mod kapaliyken Gizli islemler -> Varliklar', () => {
        expect(kaynak.split('const gorunenSekme = computed(').length - 1).toBe(1)
        const bas = kaynak.indexOf('const gorunenSekme = computed(')
        const govde = kaynak.slice(bas, kaynak.indexOf('\n})', bas) + 3)
        expect(govde).toContain(`activeTab.value === 'stocks' && !stocksTabVisible.value`)
        expect(govde).toContain(`activeTab.value === 'private' && !privacy.active`)
    })

    it('Hisseler sekmesi gizli modda gorunmez (P13): stocksTabVisible = stocksAvailable && !privacy.active, dugme ona baglidir', () => {
        expect(kaynak.split('const stocksTabVisible = computed(').length - 1).toBe(1)
        expect(kaynak).toContain('const stocksTabVisible = computed(() => stocksAvailable.value && !privacy.active)')
        expect(kaynak).toMatch(/v-if="stocksTabVisible"\s+@click="openStocksTab"/)
    })

    it('hisse gruplari (main) tek tanimlidir ve sekmenin gorunurlugu onlardan gelir', () => {
        expect(kaynak.split('const stockGroups = computed(').length - 1).toBe(1)
        expect(kaynak.split('const stocksAvailable = computed(').length - 1).toBe(1)
        expect(kaynak).toContain('const stocksAvailable = computed(() => stockGroups.value.length > 0)')
    })
})
