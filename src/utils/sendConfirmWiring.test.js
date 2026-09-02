// Send.vue / ConfirmTransaction.vue'nun Solana teline dair davranislarindan
// PURE MODULLERE cikarilamayanlari — kaynak uzerinden kilitlenir.
//
// KOK NEDEN (kod incelemesi, Task 12 1. tur): "88 dosya / 1287 test yesil"
// raporlanirken Send.vue/ConfirmTransaction.vue'nun KENDI dosyalarinda hicbir
// test yoktu — butun guvenlik-kritik satirlar (kira zinciri, blockReason
// kapisi, base58 kucultme yasagi, ATA ek-maliyet satiri, `res.result` guvenli
// okuma, RECIPIENT_NOT_WALLET dali, gonderenin rentExemptLamports'u) YESIL
// kalarak silinebilir/degistirilebilirdi. Bu depoda component mount-test
// harness'i yok (bkz. assetRouteWiring.test.js, selectNetworkWiring.test.js);
// asagidaki testler AYNI kaynak-tarama teknigini kullanir. Hesaplanabilir olan
// (MAX zinciri) sendMax.js/sendMax.test.js'e cikarildi — bu dosya yalniz
// GERCEKTEN .vue'dan cikamayan telleri pinliyor.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')

const SEND = read('../components/Send.vue')
const CONFIRM = read('../components/ConfirmTransaction.vue')

/**
 * `anchor` iceren satirdan baslar, kapanisi SATIR BASINDA olan ilk `}` satirinda
 * biter. YORUMLAR ATILIR: aksi halde kilit SAHTE olur (bkz. assetRouteWiring.test.js) —
 * bir dal aramasi, dalin KENDISI silinmis olsa bile ustundeki aciklama satirina
 * uyup yesil kalir.
 */
const block = (source, anchor, closer = /^\}/) => {
    const lines = source.split(/\r?\n/)
    const start = lines.findIndex((l) => l.includes(anchor))
    if (start < 0) return ''
    const end = lines.findIndex((l, i) => i > start && closer.test(l))
    return lines.slice(start, end < 0 ? undefined : end)
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join(String.fromCharCode(10))
}

describe('Send.vue — ice aktarilmis hesap kapisi GERCEKTEN kilitler', () => {
    it('isFormValid blockReason.value iken false doner', () => {
        const fn = block(SEND, 'const isFormValid =')
        expect(fn).toMatch(/if\s*\(\s*blockReason\.value\s*\)\s*return false/)
    })

    it('engel karti template de var (v-if="blockReason")', () => {
        expect(SEND).toMatch(/v-if="blockReason"/)
        expect(SEND).toContain('send.solanaUnsupportedAccount')
    })
})

// KOK NEDEN (kod incelemesi, 2. tur, Bulgu G): Bulgu 1'in duzeltmesi (iki
// watcher'i TEK'e birlestirmek) DOGRU ama HICBIR TEST onu tutmuyordu — koordinator
// birlestirmeyi orijinal iki-watcher bicimine geri aldi ve tam suite 91/1323
// YESIL KALDI. Asagidaki testler TAM OLARAK bu geri-donusu YAKALAR: watcher'in
// TEK oldugunu (validateRecipient TEK cagri noktasi), TAZE `check.valid`
// kullandigini ve eskiyen/izlenmeyen `validAddress.value`'yu bir KOSUL olarak
// OKUMADIGINI dogrudan kaynaktan kilitler.
describe('Send.vue — adres dogrulama + ucret baglami TEK watcher da (Bulgu 1 kalici)', () => {
    const fn = block(SEND, 'watch([to, vm, mint]')

    it('watcher TAZE validateRecipient sonucunu (check.valid) kullanir', () => {
        expect(fn).toMatch(/validateRecipient\(/)
        expect(fn).toMatch(/check\.valid/)
    })

    it('watcher ESKIYEN/izlenmeyen validAddress.value i bir KOSUL olarak OKUMAZ', () => {
        // Buglu bicim TAM OLARAK buydu: `if (vm.value !== 'solana' || !validAddress.value)`.
        // `validAddress.value = check.valid` bir ATAMADIR, bu regex'e YAKALANMAZ —
        // yalniz KOSUL icindeki okuma (`if (...validAddress.value...)`) aranir.
        expect(fn).not.toMatch(/if\s*\([^)]*validAddress\.value/)
        expect(fn).not.toMatch(/!validAddress\.value/)
    })

    it('validateRecipient TUM Send.vue da TEK bir yerden cagrilir (iki ayri watcher YOK)', () => {
        // Iki watcher'a geri donulurse (biri validateRecipient cagirip validAddress'i
        // YAZAR, digeri onu okur) bu sayi degismez (hala 1) AMA yukaridaki iki test
        // farkli bir watcher'i (adres-dogrulama watcher'ini, ucret watcher'ini DEGIL)
        // yakalayabilir. Bu sayim, TEK watcher'in KENDISININ dogrulamayi yaptigini
        // (baska bir watcher'a devretmedigini) emniyet altina alir.
        const count = (SEND.match(/validateRecipient\(/g) || []).length
        expect(count).toBe(1)
    })
})

// KOK NEDEN (kod incelemesi, 3. tur, Bulgu J): birlestirilmis watcher (Bulgu 1/G)
// ASENKRON'dur ve token'siz calisirsa `to` HIZLICA degistiginde (yapistir-duzelt-
// yapistir) A adresi icin baslayan bir `prepareTransferContext` cagrisi B
// adresi icin baslayan cagridan GEC donup A'nin (artik B icin GECERSIZ) baglamini
// `solanaFee`'ye yazabilir. Duzeltme `Home.vue`'nun `currentRequestId` deseniyle
// AYNI bir uretim-token'i (`solanaFeeRequestId`). BU KILIT reviewer'in Bulgu G'de
// bulduguyla AYNI bosluk turunu kapatir: uc guard satiri da SILINSE davranis
// testsiz kalirdi (tam suite yesil kalirdi) — asagidaki testler onlari kaynaktan
// dogrudan pinliyor. Yaris durumunun KENDISI (gercekte iki cagrinin sirasi
// degisince ne olur) component-mount harness'i olmadigi icin AYRICA
// olculmuyor — yalniz KORUMA SATIRLARININ VARLIGI kilitleniyor (bkz. rapor).
describe('Send.vue — ucret watcher SIRA-DISI (yaris) yazmaya karsi korumali (Bulgu J)', () => {
    const fn = block(SEND, 'watch([to, vm, mint]')

    it('watcher CALISMA basina bir requestId uretir', () => {
        expect(fn).toMatch(/const requestId = \+\+solanaFeeRequestId/)
    })

    it('HER await noktasindan SONRA requestId yeniden kontrol edilir (storage.get + basari + hata)', () => {
        // UC ayri await noktasi var: chrome.storage.local.get, prepareTransferContext'in
        // basarili donusu, ve onun catch'i. Herhangi biri kontrolsuz birakilirsa, o
        // noktadan GEC donen ESKI bir cagri YENI aliciya ait olmayan bir baglami
        // (ozellikle ATA-var-mi bilgisini) solanaFee'ye YAZABILIR.
        const guards = (fn.match(/requestId !== solanaFeeRequestId/g) || []).length
        expect(guards).toBeGreaterThanOrEqual(3)
    })
})

// KOD INCELEMESI (Task 13, kritik 3): loadTrusted'a EVM `.address` gecirilmis,
// dogru (solanaAddress) deger 10 satir SONRA cozulmustu — Send ekraninda
// Solana'nin guvenilir listesi TAMAMEN bosdu (accounts/saved/sent zaten
// baska nedenlerle bos, gecmis kaynagi da bu yuzden hic beslenmiyordu) ve
// /solana/history'ye GECERSIZ (0x...) bir adresle gidiliyordu. Bu dal SILINSE
// (ya da eski EVM-only haline geri donse) tam suite yesil kalirdi.
describe('Send.vue — Solana da loadTrusted DOGRU kimlikle cagrilir (Kritik 3)', () => {
    const fn = block(SEND, 'onMounted(async() => {')

    it('solanaAddress, loadTrusted CAGRILMADAN ONCE cozulur', () => {
        const solanaAddrIndex = fn.indexOf("solanaAddress = active_account?.solanaAddress")
        const loadTrustedIndex = fn.indexOf('await loadTrusted(')
        expect(solanaAddrIndex).toBeGreaterThan(-1)
        expect(loadTrustedIndex).toBeGreaterThan(-1)
        expect(solanaAddrIndex).toBeLessThan(loadTrustedIndex)
    })

    it("loadTrusted'in myAddress'i Solana'da solanaAddress kullanir, EVM .address DEGIL", () => {
        expect(fn).toMatch(/myAddress:\s*vm\.value === 'solana' \? solanaAddress : active_account\?\.address/)
    })
})

describe('Send.vue — base58 adres HICBIR ZAMAN kucultulmez', () => {
    it('confirm() solana dalinda adres oldugu gibi gecer, .toLowerCase() UYGULANMAZ', () => {
        const fn = block(SEND, 'const confirm =')
        expect(fn).toMatch(/to:\s*to\.value,/)
        expect(fn).not.toMatch(/to\.value\.toLowerCase\(\)/)
    })

    it('isSelfSend Solana da case-sensitive karsilastirir', () => {
        const fn = block(SEND, 'const isSelfSend =')
        expect(fn).toMatch(/if\s*\(vm\.value === 'solana'\)\s*return to\.value === activeAddress\.value/)
    })
})

describe('Send.vue — "Maks" TEK, SAF hesaplamaya devreder (kendi icinde YENIDEN YAZMAZ)', () => {
    it('solanaFee baslangic degeri null (brief ornegindeki riskli varsayilan nesnesi DEGIL)', () => {
        expect(SEND).toMatch(/const solanaFee = ref\(null\)/)
    })

    // ANKRAJ GUNCELLENDI (origin/main birlesmesi): bu iddia BIRLESME ONCESI bir
    // gercege dayaniyordu -- Send.vue'da ayri bir "Maks" dugmesi ve onun `setMax`
    // fonksiyonu vardi. origin/main o dugmeyi yuzde cipleriyle DEGISTIRDI (MAX =
    // %100) ve `setMax`i kaldirdi; sendAmountWiring.test.js ayri bir MAX yolunun
    // GERI GELMEMESINI ayrica kilitliyor. Kilidin KENDISI (SAF fonksiyona devir +
    // kira formulunun burada YENIDEN yazilmamis olmasi) aynen korunuyor, yalnizca
    // hangi fonksiyonun icinde arandigi bugunku tek yola (setPercent) tasindi.
    it('yuzde/MAX yolu computeSolanaMaxAmount e devreder, kira formulunu KENDI SATIRINDA tutmaz', () => {
        const fn = block(SEND, 'const setPercent =')
        expect(fn).toMatch(/computeSolanaMaxAmount\(\s*\{\s*mint:\s*mint\.value,\s*balance:\s*balance\.value,\s*solanaFee:\s*solanaFee\.value\s*\}\s*\)/)
        // rentExemptLamports HESAPLAMASI artik sendMax.js'te (unit test'li); burada
        // ELLE bir kira/ucret formulu YENIDEN yazilmis olmamali — yazilirsa
        // sendMax.js'in disinda, testsiz ikinci bir (potansiyel olarak sifir-kiraya
        // dusen) yol acilmis demektir.
        expect(fn).not.toMatch(/rentExemptLamports/)
    })

    it('solanaMaxDisabled isSolanaMaxDisabled e devreder', () => {
        const fn = block(SEND, 'const solanaMaxDisabled =')
        expect(fn).toMatch(/isSolanaMaxDisabled\(\s*\{\s*mint:\s*mint\.value,\s*solanaFee:\s*solanaFee\.value\s*\}\s*\)/)
    })
})

// KOK NEDEN (kod incelemesi, 3. tur, Bulgu H): MAX ipucu bir hata KODU tasiyorsa
// onu DOGRUDAN `resolveSolanaSendError`e veriyordu; ham bir offline/DNS fetch
// reddi (`TypeError: Failed to fetch`) TABLO'da yoktur ve jenerik "Islem
// gonderilemedi" metnine duser — gonderim HENUZ baslamadan bu metnin gorunmesi
// yaniltici. `isKnownSolanaSendError` kapisi olmadan da (fonksiyonun kendisi
// unit test'li olsa bile) bu CAGRI NOKTASI hicbir sey tarafindan tutulmuyordu;
// kapi SILINSE tam suite yesil kalirdi (reviewer'in bulgusu).
describe('Send.vue — MAX ipucu bilinmeyen kodu feeUnavailable a dusurur (Bulgu H)', () => {
    it('MAX ipucu ONCE isKnownSolanaSendError ile kodun TANINIP TANINMADIGINA bakar', () => {
        expect(SEND).toMatch(/solanaFeeErrorCode\s*&&\s*isKnownSolanaSendError\(solanaFeeErrorCode\)/)
    })
})

// KOK NEDEN (kod incelemesi, 3. tur, Bulgu K): RECIPIENT_NOT_WALLET disindaki
// HER adres hatasi (Solana'da bicimsel gecersiz bir adres DAHIL) tek
// `send.invalidAddress`e (Ingilizce/Turkce EVM metni) dusuyordu; kullanici
// Solana'dayken bile. `send.errors.invalidSolanaAddress` her iki dilde de
// vardi (Bulgu 2) ama hicbir template dali onu KULLANMIYORDU. Bu dal SILINSE
// (tek `invalidAddress`e COKELTILSE) tam suite yine yesil kalirdi.
describe('Send.vue — Solana da bicimsel gecersiz adres KENDI mesajini gosterir (Bulgu K)', () => {
    it('template addressReason === INVALID_SOLANA_ADDRESS icin ayri bir dal tasir', () => {
        expect(SEND).toMatch(/addressReason === 'INVALID_SOLANA_ADDRESS'/)
        expect(SEND).toContain('send.errors.invalidSolanaAddress')
    })
})

describe('Send.vue — RECIPIENT_NOT_WALLET AYRI mesajla gosterilir (tek "invalidAddress"e COKMEZ)', () => {
    it('template dali addressReason a gore ayrisir', () => {
        expect(SEND).toMatch(/addressReason === 'RECIPIENT_NOT_WALLET'/)
        expect(SEND).toContain('send.recipientNotWallet')
    })
})

describe('ConfirmTransaction.vue — SOLANA_SEND yaniti guvenli okunur', () => {
    it('res.result OPTIONAL CHAINING ile dogrulanir, ciplak res.result.signature DEGIL', () => {
        const fn = block(CONFIRM, 'async function sendSolana', /^\}/)
        expect(fn).toMatch(/!res\?\.result\?\.signature/)
        expect(fn).not.toMatch(/!res\.result\.signature/)
    })
})

describe('ConfirmTransaction.vue — ATA ek-maliyet satiri SILINMEDI', () => {
    it('template recipientAtaExists === false kosuluyla ayri bir v-if satiri gosterir', () => {
        // `v-if="..."` OZELLIKLE aranir: aksi halde satir SILINSE bile dosyadaki bir
        // JS yorumunun (solanaContext'i aciklayan) ayni ifadeyi tasimasi teste
        // sahte-yesil verirdi.
        expect(CONFIRM).toMatch(/v-if="vm === 'solana' && solanaContext && solanaContext\.recipientAtaExists === false"/)
        expect(CONFIRM).toContain('send.confirmTransaction.ataRent')
    })
})

describe('ConfirmTransaction.vue — "yetersiz bakiye" hesabi GONDERENIN kira minimumunu da kapsar', () => {
    it('onMounted solana dalinda totalNeeded ctx.rentExemptLamports i icerir', () => {
        const fn = block(CONFIRM, 'if (vm.value === \'solana\') {', /^\s{4}\}$/)
        expect(fn).toMatch(/ctx\.rentExemptLamports/)
    })
})

describe('ConfirmTransaction.vue — ag hatasi "Yetersiz Bakiye" olarak YANLIS ETIKETLENMEZ', () => {
    it('onMounted solana catch blogu solanaSendError i sendErrors uzerinden doldurur', () => {
        const fn = block(CONFIRM, 'if (vm.value === \'solana\') {', /^\s{4}\}$/)
        expect(fn).toMatch(/catch\s*\(e\)\s*\{[\s\S]*solanaSendError\.value\s*=\s*t\(resolveSolanaSendError\(e\?\.message\)/)
    })
})
