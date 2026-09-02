// SAF KATMANI EKRANA BAGLAYAN TELLER — kaynak uzerinden kilitlenir.
//
// NEDEN BOYLE BIR TEST: bu depoda bilesen (mount) testi YOK (bkz. swapWiring.test.js
// bas yorumu, ayni gerekce burada da gecerli). History.vue'nun /ton/history'ye
// `jettonWallets` esleme alanini gonderdigini ve satirlarda jetton sembolunu
// gosterdigini kilitleyen tek yer burasi.
//
// UYARI - YORUM TUZAGI: naif bir `toContain` kontrolu SADECE bir aciklama yorumunda
// gecen bir kelimeyle de yesil kalabilir (bu depoda daha once tam olarak bu sekilde
// bir test kendi yorumuyla yanlislikla tetiklenmisti). Bunu onlemek icin asagida
// kaynaktan hem `//` hem `<!-- -->` yorumlari ATILIR, testler yorumsuz metin
// uzerinde calisir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HISTORY_RAW = readFileSync(fileURLToPath(new URL('../../components/History.vue', import.meta.url)), 'utf8')

const stripComments = (src) => src
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join(String.fromCharCode(10))

const HISTORY = stripComments(HISTORY_RAW)

describe('gecmiste jetton satirlari', () => {
    it('jetton sembolu gosterilir - hepsi TON diye etiketlenmez', () => {
        expect(HISTORY).toContain('jettonSymbol')
    })

    it('kurasyonlu jetton listesini kullanir (Home.vue ile AYNI desen)', () => {
        expect(HISTORY).toContain('jettonsFromTokens')
    })

    it('jetton cuzdan adresini ONBELLEKLI turetici ile bulur, elle cevirmez', () => {
        expect(HISTORY).toContain('getJettonWalletAddress')
    })

    it('eslemeyi /ton/history istegine EKLER - eklenmezse sunucu jetton satiri uretmez', () => {
        // Sadece bir yerde gecmesi yetmez: gercekten istek govdesine tasindigini
        // dogrulamak icin axios.post cagrisinin gorunur oldugu bloku ariyoruz.
        expect(HISTORY).toMatch(/\/ton\/history[\s\S]{0,200}jettonWallets/)
    })

    it('bakiyeleri PARALEL okur - bir jettonun adres hatasi digerlerini bloklamaz', () => {
        expect(HISTORY).toContain('allSettled')
    })

    it('sunucudan zaten ondalikli gelen miktara TEKRAR ondalik uygulamaz', () => {
        // decimals yalnizca esleme govdesine ({symbol, decimals}) yazilir; miktar
        // uzerinde 10**decimals gibi ikinci bir bolme YAPILMAZ.
        expect(HISTORY).not.toMatch(/10\s*\*\*\s*jetton\.decimals/)
        expect(HISTORY).not.toMatch(/Math\.pow\(10,\s*jetton\.decimals\)/)
    })
})
