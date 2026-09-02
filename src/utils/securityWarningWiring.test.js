// SecurityWarning.vue'nun "bu agda itibar kontrolu yok" bildirimi PURE bir
// module cikarilamaz (dogrudan template + prop okuma) — kaynak uzerinden
// kilitlenir. Bu depoda component mount-test harness'i yok (bkz.
// sendConfirmWiring.test.js, assetRouteWiring.test.js); asagidaki testler AYNI
// kaynak-tarama teknigini kullanir.
//
// KOK NEDEN: reputation.value.unsupported dogru hesaplaniyor olsa bile onu
// GOSTEREN hicbir sey olmazsa (ya da yanlis kosula baglanirsa) kullanicinin
// deneyimi sessiz-temiz davranisla AYNIDIR — bu, Task 13'un tam kapatmaya
// calistigi seydir. `vite build` yalniz dosyanin AYRISTIGINI kanitlar,
// bildirimin DOGRU KOSULDA ciktigini kanitlamaz; bu dosya onu kilitler.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')

const SRC = read('../components/SecurityWarning.vue')

// HTML yorumlari ATILIR: aksi halde dalin KENDISI silinse/degistirilse bile
// ustundeki aciklama satiri anchor'i tasiyip teste SAHTE-YESIL verebilir.
const withoutComments = SRC.replace(/<!--[\s\S]*?-->/g, '')

// `anchor`i iceren satirdan baslar, ayni girinti seviyesindeki ilk `</div>`
// satirinda (dahil) biter. Bu blokta ic ice baska bir `<div>` olmadigi icin
// (yalnizca `<svg>`/`<span>`) ilk `</div>` DOGRU kapanistir.
function divBlock(source, anchor) {
    const lines = source.split(/\r?\n/)
    const start = lines.findIndex((l) => l.includes(anchor))
    if (start < 0) return ''
    const end = lines.findIndex((l, i) => i > start && l.trim() === '</div>')
    return lines.slice(start, end < 0 ? undefined : end + 1).join(String.fromCharCode(10))
}

describe('SecurityWarning.vue — "bu agda itibar kontrolu yok" bildirimi', () => {
    const fn = divBlock(withoutComments, 'reputation?.unsupported')

    it('bildirim karti GERCEKTEN var ve unsupported durumuna gore dallanir', () => {
        expect(fn).not.toBe('')
        expect(fn).toMatch(/v-if="[^"]*reputation\?\.unsupported[^"]*"/)
    })

    it('bildirim checking bittiginde de gorunur (severity kartinin aksine onay kutusu YOK)', () => {
        // 'unsupported' bir tehdit degil, bir bilgi eksikligi: onay kutusuyla
        // "kapatilan" bir kapi olsaydi, bu bir ENGEL gibi davranirdi.
        expect(fn).toMatch(/!checking/)
        expect(fn).not.toMatch(/type="checkbox"/)
    })

    it('bildirim send.reputationUnsupported anahtarini kullanir (baska bir anahtara SESSIZCE kaymaz)', () => {
        expect(fn).toContain("$t('send.reputationUnsupported')")
    })
})

describe('send.reputationUnsupported — locale anahtari GERCEKTEN tanimli', () => {
    // Round 2 hatasi: anahtar template de kullaniliyordu ama HICBIR locale
    // dosyasinda YOKTU — vue-i18n boyle bir durumda ham anahtari ya da bos bir
    // metni gosterir, kullanici hicbir sey OKUYAMAZDI.
    const tr = JSON.parse(read('../i18n/locales/tr.json'))
    const en = JSON.parse(read('../i18n/locales/en.json'))

    it('tr.json da tanimli ve bos degil', () => {
        expect(typeof tr.send?.reputationUnsupported).toBe('string')
        expect(tr.send.reputationUnsupported.length).toBeGreaterThan(0)
    })

    it('en.json da tanimli ve bos degil', () => {
        expect(typeof en.send?.reputationUnsupported).toBe('string')
        expect(en.send.reputationUnsupported.length).toBeGreaterThan(0)
    })

    // Ifade "kontrol edildi, sorun yok" OKUNAMAMALI — aksi halde bildirimin
    // KENDISI, kapatmaya calistigimiz sessiz-temiz yanilsamasini yeniden uretir.
    it('ifade "temiz/sorun yok" degil, KONTROL EDILMEDIGINI soyluyor', () => {
        expect(tr.send.reputationUnsupported.toLowerCase()).not.toMatch(/temiz|sorun yok|guvenli/)
        expect(en.send.reputationUnsupported.toLowerCase()).not.toMatch(/\bclean\b|no issues|safe/)
    })
})
