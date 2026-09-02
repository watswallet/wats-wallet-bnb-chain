// SAF KATMANI EKRANA BAGLAYAN TELLER — kaynak uzerinden kilitlenir.
//
// NEDEN BOYLE BIR TEST: bu depoda bilesen (mount) testi YOK (bkz. jettonHistoryWiring.test.js
// bas yorumu, ayni gerekce burada da gecerli).
//
// K1 (MERGE ENGELI): Token.vue'de bir JETTON satirinin "Gonder" dugmesi eskiden HER ZAMAN
// gorunuyordu ve tikladiginda NATIVE TON gonderiyordu - `isTonAsset` yalnizca SATIRIN
// ZINCIRINE bakiyor, ayni zincirdeki NATIVE TON ile bir JETTON satirini AYIRT ETMIYORDU.
// Asagidaki testler, (a) Gonder dugmesinin (butun eylem satirinin) jetton satirinda
// GERCEKTEN gizlendigini ve (b) native TON bakiyesinin (getTonBalance) jetton satirinda
// HIC CAGRILMADIGINI kaynaktan dogrular.
//
// UYARI - YORUM TUZAGI: naif bir `toContain` kontrolu SADECE bir aciklama yorumunda
// gecen bir kelimeyle de yesil kalabilir (bkz. jettonHomeWiring.test.js'in O3 duzeltmesi -
// bu depoda bu tuzaga daha once tam olarak dusulmustu). Bunu onlemek icin kaynaktan hem
// `//` hem `<!-- -->` yorumlari ATILIR, testler yorumsuz metin uzerinde calisir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TOKEN_RAW = readFileSync(fileURLToPath(new URL('../../components/Token.vue', import.meta.url)), 'utf8')

const stripComments = (src) => src
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join(String.fromCharCode(10))

const TOKEN = stripComments(TOKEN_RAW)

describe('Token.vue jetton satirinda Gonder kapisi ve native bakiye okumasi (K1)', () => {
    it('isTonJetton, SATIRIN ZINCIRINE degil NATIVE/JETTON ayrimina bakar - isTonAsset TEK BASINA yetersizdi', () => {
        expect(TOKEN).toMatch(/isTonJetton\s*=\s*computed\(\(\)\s*=>\s*isTonAsset\.value\s*&&\s*token\.value\?\.address\s*!==\s*NATIVE_TOKEN_ADDRESS\)/)
    })

    // K1 KAPISI ARTIK YOK ve bu DOGRU. Kapi, gonderme akisi jettonlar icin
    // baglanmadigi donemde konulmustu: Gonder duğmesi jetton satirinda sessizce
    // NATIVE TON gonderiyordu. Akis Gorev 11/12/13'te baglandi (Send.vue jetton
    // bakiyesini ayri okur, ConfirmTransaction.vue SEND_TON_JETTON'a gider, arka
    // planda dort kapi calisir), yani duğmenin gizli kalmasi icin sebep kalmadi.
    //
    // Ama kapinin KALKMASI test edilmeden birakilamaz: eylem satirinin jetton
    // satirinda gorunur olmasi, ancak gonderim gercekten jetton aksiyonuna
    // gidiyorsa guvenlidir. O baglanti jettonSendWiring.test.js'te dogrulaniyor.
    it('Gonder dugmesi JETTON satirinda artik gorunur - akis baglandi', () => {
        const classIdx = TOKEN.indexOf('flex justify-center gap-9 px-5 mb-8')
        expect(classIdx).toBeGreaterThan(-1)

        const tagStart = TOKEN.lastIndexOf('<div', classIdx)
        const tagEnd = TOKEN.indexOf('>', classIdx)
        const openTag = TOKEN.slice(tagStart, tagEnd + 1)
        expect(openTag).not.toContain('isTonJetton')

        const sendBtnIdx = TOKEN.indexOf('@click="selectSend"')
        expect(sendBtnIdx).toBeGreaterThan(tagEnd)
    })

    // Bu test uc dugmeyi TEK kefeye koyuyordu ("TON'da hepsi kapali") ve o kefe yanlisti:
    // uc dugme AYNI cevabi veriyordu ama AYRI sebeplerle. TON takasi acilinca sebepler
    // ayrilti, kefe ayrilmadigi icin Takas dugmesi gereksiz yere kapali kaldi.
    //
    // Kopru: chainKind.js tablosu "hayir" diyor (LI.FI EVM disi zincir tasimiyor).
    // Takas: ayni tablo artik "evet" diyor (STON.fi) - dugme TON'da GORUNMELI.
    // Ikisi de tabloyu okur; cevaplari farkli olsa bile KAYNAKLARI ayni.
    it('Takas ve Kopru dugmeleri akis tablosuna baglidir, varlik tipine degil', () => {
        for (const [handler, flag] of [['selectSwap', 'canSwap'], ['selectBridge', 'canBridge']]) {
            const idx = TOKEN.indexOf(`@click="${handler}"`)
            expect(idx, handler).toBeGreaterThan(-1)
            const attrs = TOKEN.slice(TOKEN.lastIndexOf('<button', idx), idx)
            expect(attrs, handler).toContain(`v-if="${flag}"`)
            expect(attrs, handler).not.toContain('isTonAsset')
        }
    })

    // "Al" AYRI kefede ve TON'da kapali KALIYOR: o dugme BuyToken.vue'yu, yani MoonPay
    // kredi karti akisini acar. MoonPay TON kapsam disi (spec §8) ve bu bir ZINCIR AKISI
    // degil SAGLAYICI kapsami - FLOW tablosunda karsiligi yok, olmasi da gerekmiyor.
    // Gonder acildi, Takas acildi diye bunun da acilmadigi ayrica dogrulanir.
    it('Al (BuyToken/MoonPay) TON varliginda YINE gizli', () => {
        const idx = TOKEN.indexOf('@click="selectReceive"')
        expect(idx).toBeGreaterThan(-1)
        expect(TOKEN.slice(TOKEN.lastIndexOf('<button', idx), idx)).toContain('v-if="!isTonAsset"')
    })

    // Bu testin ADI degisti ama KORUDUGU SEY AYNI ve degismedi: jetton satirinda
    // native TON bakiyesi okunup jetton sembolu altinda gosterilemez - o BASKA bir
    // varligin bakiyesidir. Degisen tek sey, eskiden yalnizca `balanceError`
    // isaretlenirken artik GERCEK jetton bakiyesinin okunmasi.
    it('jetton satirinda NATIVE TON bakiyesi (getTonBalance) HIC OKUNMAZ - gercek jetton bakiyesi okunur', () => {
        const ifIdx = TOKEN.indexOf('if (isTonJetton.value) {')
        expect(ifIdx).toBeGreaterThan(-1)

        const elseIdx = TOKEN.indexOf('} else {', ifIdx)
        expect(elseIdx).toBeGreaterThan(ifIdx)

        // isTonJetton true dalinda getTonBalance HIC gecmemeli - yalniz balanceError
        // isaretlenir (sablon bunu gorup "—" basar, balance/usdBalance 0'da kalir).
        const jettonBranch = TOKEN.slice(ifIdx, elseIdx)
        expect(jettonBranch).not.toContain('getTonBalance')

        // Artik gercek jetton bakiyesi okunuyor (Gorev 13). Hata yolu KORUNUYOR:
        // getJettonBalance hicbir hatayi 0'a cevirmez, yakalanip balanceError
        // isaretlenir ve sablon "0" DEGIL "—" basar.
        expect(jettonBranch).toContain('getJettonWalletAddress({')
        expect(jettonBranch).toContain('getJettonBalance({')
        expect(jettonBranch).toContain('balanceError.value = true')

        // getTonBalance YALNIZCA else (native) dalinda cagrilir.
        const getTonBalanceIdx = TOKEN.indexOf('getTonBalance(', elseIdx)
        expect(getTonBalanceIdx).toBeGreaterThan(elseIdx)
    })
})
