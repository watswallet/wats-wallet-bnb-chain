// TON ucret ARAYUZ kablolamasi - kaynak metninden kilitlenir (Task 8, spec 8-9).
//
// NEDEN KAYNAK METNI: depoda jsdom YOK (vitest environment 'node'), Vue SFC'leri
// mount edilemez. Kardes kablolama testleri (tonFeeBackgroundWiring,
// jettonHomeWiring) ayni yolu izliyor.
//
// IKI TUZAK, IKISI DE BU PLANDA YASANDI (bkz. tonFeeBackgroundWiring.test.js basi):
//   1) YORUM TUZAGI - naif bir toContain, dizeyi yalnizca bir YORUMDA tasiyan
//      dosyada da yesil kalir. Asagidaki butun iddialar YORUMLARI SIYRILMIS
//      kaynak uzerinde calisir.
//   2) YOKLUKLA SAGLANAN IDDIA - `not.toContain(...)` butun ozellik silinince de
//      GECER. Her "yok" iddiasi, yaninda "olmasi gereken VAR" iddiasiyla gelir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { TON_FEE_I18N_KEYS } from './tonFeeBlocker'
// SINIRI GECEN HER ALAN IKI UCTAN DA KILITLENIR (bu planda `evmCapable` ile
// olculen kural). `meta.tonFeeState` arka plan ile arayuz arasinda gecen bir
// alan ve adlari TEK yerde yasiyor: tonFeeRecovery.js'in kendi yorumu bunu
// soyluyor. Bu dosya ONCEDEN 'unresolved'/'not-charged'/'recovering' dizelerini
// ELLE TEKRARLIYORDU - yani sabitin DEGERI degistiginde uretici (tonFeeRecovery)
// ve tuketici (TransactionStatus.vue) ayrisir, HER IKI suit de YESIL kalir ve
// kurtarma kartlarinin hepsi bos cizilirdi. Artik iddialar sabitten TURUYOR.
import { TON_FEE_TX_STATES } from './tonFeeRecovery'
// 2026-09-15: gaz engelinin KURALI saf katmanda. Bu dosya kablolamayi kilitler,
// davranisi ise dogrudan o katmandan olcer - metin eslesmesi bir zamanlama yarisini
// yapisal olarak yakalayamaz (bkz. tonSwapGasNeed.test.js).
import { tonSwapGasBlocked } from './tonSwapGasNeed'

const read = (relPath) => readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')

const TR = JSON.parse(read('../../i18n/locales/tr.json'))
const EN = JSON.parse(read('../../i18n/locales/en.json'))

function stripComments(src) {
    // Vue SFC'lerdeki HTML yorumlarini (<!-- ... -->) ve <script> icindeki
    // // yorumlarini kaldirir - tonFeeBackgroundWiring.test.js'teki AYNI tuzak.
    return src.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
}

const CONFIRM_TX_RAW = read('../../components/ConfirmTransaction.vue')
const SWAP_RAW = read('../../components/Swap.vue')
const TX_STATUS_RAW = read('../../components/TransactionStatus.vue')
// TON'un UCUNCU ucret karti burada (TonConnect dapp onayi).
const TON_SEND_TX = stripComments(read('../../components/dapp/TonSendTx.vue'))

const CONFIRM_TX = stripComments(CONFIRM_TX_RAW)
const SWAP = stripComments(SWAP_RAW)
// UCRET KARTININ GOVDESI ARTIK BURADA. Bes ekranin yedi ayri ATS ucret karti tek
// bilesende toplandi; ekranlarda yalnizca `<AtsFeeCard ...>` cagrisi ve slot
// icerikleri kaldi. Bu dosyadaki iddialarin bir kismi kartin METNINI, bir kismi
// ekranin KABLOLAMASINI olcuyor -- ikisi artik AYRI dosyalarda aranmali.
const KART = stripComments(read('../../components/AtsFeeCard.vue'))
// Eksik-bakiye bolumu 2026-09-13'te paylasilan bir bilesene tasindi: ayni bolum UC
// yerde ciziliyor (ATS ucret karti, TON ucret karti, ve ucret karti hic yokken kendi
// basina). Bolumun kurallari artik BURADA olculur.
const SHORTFALL = stripComments(read('../../components/AtsShortfallNote.vue'))
const TX_STATUS = stripComments(TX_STATUS_RAW)

// Kurtarmanin arayuze soyledigi UC durum - dizeler DEGIL, sabitin KENDISI.
const { notCharged: NOT_CHARGED, unresolved: UNRESOLVED, recovering: RECOVERING } = TON_FEE_TX_STATES

function get(obj, dotted) {
    return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

describe('i18n parite - TON_FEE_I18N_KEYS (Ruling 2)', () => {
    // Task 8 KENDI listesini KURMAZ: tonFeeBlocker.js'in TEK kaynaginda yasayan
    // kumeyi gezer. Iki liste elle kopyalanirsa kacinilmaz sekilde ayrisir ve
    // kullanici ham anahtar adi gorur.
    it.each([['tr', TR], ['en', EN]])('%s: TON_FEE_I18N_KEYS in HEPSI tanimli', (lang, dict) => {
        for (const key of TON_FEE_I18N_KEYS) {
            const val = get(dict, key)
            expect(val, `${lang}: ${key} yok`).toBeTruthy()
        }
    })

    // Islem karti + ucret karti metinleri (spec 8) - Task 8'in KENDI eklemesi
    // gereken 4 anahtar, TON_FEE_I18N_KEYS'in DISINDA (bu kume yalniz engel
    // mesajlarini kapsar).
    it.each([
        ['tr', TR], ['en', EN],
    ])('%s: tonFeeNoRefund/tonFeePaidOnBsc/tonFeeUnresolved/tonFeeNotCharged tanimli', (lang, dict) => {
        for (const key of [
            'send.confirmTransaction.tonFeeNoRefund',
            'send.confirmTransaction.tonFeePaidOnBsc',
            'send.confirmTransaction.tonFeeUnresolved',
            'send.confirmTransaction.tonFeeNotCharged',
        ]) {
            expect(get(dict, key), `${lang}: ${key} yok`).toBeTruthy()
        }
    })
})

// --- kucuk yardimcilar (tonFeeBackgroundWiring.test.js'teki AYNI desen) ----

// `marker`den itibaren `len` karakterlik bir pencere - VAR OLMA iddiasi ile
// birlikte gelir (yoklukla saglanan iddia tuzagi, dosya basi notu 2).
function sliceFrom(src, marker, len) {
    const idx = src.indexOf(marker)
    expect(idx, `"${marker}" bulunamadi`).toBeGreaterThan(-1)
    return src.slice(idx, idx + len)
}

// Bir bildirimin KENDISI - sabit uzunluklu pencere DEGIL. `sliceFrom(..., N)` ile
// yazilan bir OLUMSUZ iddia (`not.toMatch`) kirilgan: pencere komsu satirlara
// tastiginda DOGRU kod uzerinde duser, kisa kaldiginda ise disarida kalan bir
// gerilemeyi KACIRIR. Olculdu: `hideNativeTonFeeCard` icin dislanan dize
// pencerenin bitiminden yalnizca ALTI karakter otedeydi - araya eklenecek tek bir
// yorum satiri testi dogru kod uzerinde kirardi, pencereyi genisletmek ise tam da
// dislamak istedigi gecisi yutardi. Ikisinin arasinda dogru cevap pencere degil
// SINIR: bildirim satirin sonunda biter.
function statementAt(src, marker) {
    const idx = src.indexOf(marker)
    expect(idx, `"${marker}" bulunamadi`).toBeGreaterThan(-1)
    const end = src.indexOf('\n', idx)
    return end === -1 ? src.slice(idx) : src.slice(idx, end)
}

function windowAround(src, needle, before = 400, after = 200) {
    const idx = src.indexOf(needle)
    expect(idx, `"${needle}" bulunamadi`).toBeGreaterThan(-1)
    return src.slice(Math.max(0, idx - before), idx + after)
}

function blockBetween(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker)
    expect(start, `"${startMarker}" bulunamadi`).toBeGreaterThan(-1)
    const end = src.indexOf(endMarker, start + startMarker.length)
    expect(end, `"${endMarker}" bulunamadi`).toBeGreaterThan(-1)
    return src.slice(start, end)
}

// Iki isaret ARASINDAKI pencere - dosya genelinde indexOf ile olcmek, ayni
// dizgenin baska bir yerdeki gecisini yanlislikla yakalar.
const sliceBetween = (src, basIm, sonIm) => {
    const b = src.indexOf(basIm)
    expect(b, `"${basIm}" bulunamadi`).toBeGreaterThan(-1)
    const e = src.indexOf(sonIm, b)
    expect(e, `"${sonIm}" bulunamadi`).toBeGreaterThan(-1)
    return src.slice(b, e)
}

describe('yeni anahtarlar GERCEKTEN kullaniliyor (JSON dolu ama olu kod olmasin)', () => {
    it('tonFeeNoRefund/tonFeePaidOnBsc/tonFeeBurnsWarning ConfirmTransaction.vue da referans aliniyor', () => {
        // ANAHTARLAR EKRAN + KART BIRLIKTE arandi: iade ve "BSC'den alinir" satirlarinin
        // ANAHTARI ekranin karari (prop olarak geciyor), yanma uyarisinin anahtari ise
        // kartta sabit ve ekran yalnizca GORUNURLUGUNU soyluyor. Olculen sey degismedi:
        // "JSON'da duran anahtar gercekten cizilen bir satira baglaniyor mu".
        for (const key of ['tonFeeNoRefund', 'tonFeePaidOnBsc', 'tonFeeBurnsWarning']) {
            expect(CONFIRM_TX + KART, `ConfirmTransaction.vue/AtsFeeCard.vue: ${key} yok`).toContain(key)
        }
        // Ekranin KENDI kablolamasi ayrica olculur: kart anahtari tasisa da ekran
        // gorunurlugu gecirmezse uyari HIC cizilmez.
        expect(CONFIRM_TX, 'ConfirmTransaction.vue: yanma uyarisi kartta kablolanmamis').toContain('burns-warning')
    })

    // IDDIA TERSINE DONDU (2026-09-15), KAYBOLMADI.
    //
    // Eskiden bu test kartin YOKLUGUNU olcuyordu ve gerekcesi de yazilidi:
    // "takas relay yolunu HIC kullanamaz". Iki dayanagi vardi ve IKISI DE
    // olculup curutuldu:
    //   - Sunucunun jetton eylemi `forwardTonNano` + `forwardPayloadBoc` tasiyor
    //     (ayirt edici olcum: ayni turda `gasTonNano` ve uydurma bir alan
    //     "is unknown" ile REDDEDILDI, bunlar gecti).
    //   - Dogrulama kapisi acilabiliyordu: parseJettonBody dolu forward_payload'da
    //     artik dusmuyor, hash'ini disari veriyor ve V5 onu niyetteki yukle
    //     BIREBIR karsilastiriyor.
    //
    // ESKI TEHLIKE: ulasilamaz olu isaretleme. YENI TEHLIKE onun AYNASI: kart
    // cizilir ama BESLENMEZ (`tonFee.load` hala teklif alanlari olmadan
    // cagrilir) -- yani `atsMaxFee` yine null kalir ve kullanici odemesi
    // gerekmeyen GRAM ucretini oder. Bu yuzden olculen sey kartin VARLIGI degil,
    // BESLENDIGI.
    it('Swap.vue: TON ucret karti VAR ve GERCEKTEN besleniyor', () => {
        // (a) Kart ve metinleri. Metinler artik AtsFeeCard.vue'da; ekranda aranan sey
        //     kartin CAGRILDIGI ve dogru beslendigi.
        for (const key of ['tonFeeNoRefund', 'tonFeePaidOnBsc', 'tonFeeBurnsWarning', 'atsMaxFee']) {
            expect(SWAP + KART, `Swap.vue/AtsFeeCard.vue: ${key} yok - kart eksik`).toContain(key)
        }
        // Takasta yanma uyarisi KOSULSUZ gecerli (sendMode 3 ile fonlanamayan eylem
        // atlanir, islem "basarili" sayilir, ucret kesilmistir ve takas OLMAMISTIR).
        expect(SWAP, 'Swap.vue: yanma uyarisi kartta kablolanmamis').toContain('burns-warning')
        // (b) Engel karti KALDI: bir /status kesintisi bu ekranda hala soylenmeli.
        expect(SWAP, 'Swap.vue: useTonFee tumden kopmus').toContain('const tonFee = useTonFee()')
        expect(SWAP, 'Swap.vue: TON engel karti gitmis').toContain('tonFeeDecisionActive')
        // (c) ASIL OLCUM: teklif GERCEK alanlarla isteniyor. Bunlar olmadan
        //     useTonFee /quote'a HIC gitmez ve kart olu isaretlemeye geri doner.
        expect(SWAP, 'Swap.vue: tonPublicKey teklife girmiyor').toContain('tonPublicKey: resp.tonPublicKey')
        expect(SWAP, 'Swap.vue: eylem teklife girmiyor').toContain('actions: [resp.action]')
        // (d) Eylem ARKA PLANDAN geliyor - bilesen kendi kuramaz (SDK + zincir +
        //     kasa gerekir) ve kursaydi onizleme ile gonderim AYRISABILIRDI.
        expect(SWAP, "Swap.vue: role eylemi arka plandan istenmiyor").toContain("type: 'TON_SWAP_FEE_ACTION'")
        // (e) ROUTER BEYAZ LISTE KAPISI istemci tarafinda: listede olmayan bir
        //     router'da role teklifine HIC gidilmez.
        expect(SWAP, 'Swap.vue: router beyaz liste kapisi yok').toContain('tonRouterListesi()')
        // (f) GONDERIM MODU kartla AYNI kosula bagli: fiyati gorunmemis bir
        //     ucret onaylatilamaz.
        expect(SWAP, 'Swap.vue: role modu gonderime baglanmamis').toContain('message.payWithTonFee = true')
        expect(SWAP, 'Swap.vue: onaylanan ucret gonderilmiyor').toContain('message.approvedAtsFee = tonFee.atsMaxFeeRaw.value')
    })

    // CANLI KUSUR (2026-09-17): her TON takasi "islem govdesi dogrulanamadi" ile
    // dusuyordu. Swap.vue, dogrulamanin (tonQuoteVerify V10) UST SINIRI olarak
    // `tonFee.atsMaxFee`i gonderiyordu -- o alan EKRAN icin bicimlenmis ondalik
    // bir dizedir ("20.746887966804980152"), V10 ise HAM WEI bekler ve asBigInt
    // ondalik noktayi reddeder. Sonuc: TON_QUOTE_FEE_ABOVE_APPROVED, imza YOK.
    //
    // AYRI `it`: yukaridaki kart testi cok sey olcuyor ve ilk dusen iddiada
    // durur; bu kabloyu ona iliştirmek, kart markup'i tasindiginda kusurun
    // korumasiz kalmasi demekti.
    it('Swap.vue V10 ust sinirini HAM WEI alanindan okur, ekran dizesinden DEGIL', () => {
        expect(SWAP, 'Swap.vue: onaylanan ucret ham wei alanindan gelmiyor')
            .toContain('message.approvedAtsFee = tonFee.atsMaxFeeRaw.value')
        // Ekranin alani protokole GIRMEZ.
        expect(SWAP, 'Swap.vue: ekran dizesi V10 ust siniri olarak gonderiliyor')
            .not.toContain('approvedAtsFee = tonFee.atsMaxFee.value')
    })

    // UCRET PAYI ROLE FARKINDA OLMALI.
    //
    // Saf katman kapiyi acabilir ama Swap.vue onu BESLEMEZSE hicbir sey degismez
    // -- bayrak kapiya GECIRILMELI. Gecirilmezse ekran gazsiz bir takasta bile
    // 0.6 GRAM ayirir ve yuzde tuslari 0 uretir.
    it('swapReserve role bayragini kapiya GECIRIYOR', () => {
        const blok = sliceFrom(SWAP, 'const swapReserve = async () => {', 400)
        expect(blok, 'role bayragi ucret payi kapisina gecmiyor')
            .toContain('payWithTonRelay: payWithTonFee.value')
    })

    // KART CIZILEBILIR OLMAK ICIN TEKLIFE BAGLI TAZELENMELI.
    //
    // GERCEK BIR BOSLUKTU: `refreshTonFee` yalniz mount ve ag degisiminde
    // cagriliyordu ve o anlarda ortada TEKLIF YOK - role eylemi teklikten
    // turedigi icin (router, yuk, forward payi orada) kurulamiyor, `atsMaxFee`
    // null kaliyor ve kart HIC cizilmiyordu. Yani kart eklenmis ama olu
    // isaretleme olarak kalmis olurdu: eski tehlikenin tam aynasi.
    it('role ucreti TEKLIF gelince tazeleniyor', () => {
        const blok = sliceBetween(SWAP, 'swapData.value = data.data', 'estimatedGasFee')
        expect(blok, 'teklif cozuldugunde ucret onizlemesi tazelenmiyor')
            .toContain('refreshTonFee()')
    })

    it('tonFeeUnresolved/tonFeeNotCharged/tonFeeVerifying/tonFeeUnresolvedBadge TransactionStatus.vue da kullanilir', () => {
        for (const key of ['tonFeeUnresolved', 'tonFeeNotCharged', 'tonFeeVerifying', 'tonFeeUnresolvedBadge']) {
            expect(TX_STATUS, `TransactionStatus.vue: ${key} yok`).toContain(key)
        }
    })
})

describe('"ucret yanar" uyarisi priceImpact e bagli DEGIL (spec 8)', () => {
    // Akis: Swap evet, Jetton evet, duz TON transfer hayir - gorunurluk kosulu
    // `payWithTonFee && (isSwap || isJetton)`, ASLA `priceImpact` degil (ucret
    // dusuk fiyat etkisinde de yaniyor).
    it('ConfirmTransaction.vue: uyari payWithTonFee+isTonJetton ile gorunur, priceImpact ADI GECMEZ', () => {
        // ISARET DEGISTI: uyarinin METNI artik AtsFeeCard.vue'da, GORUNURLUK KOSULU
        // ekranda `burns-warning` prop'unda. Olculen sey ayni: kosul
        // `payWithTonFee && isTonJetton`, ASLA `priceImpact` degil.
        const w = windowAround(CONFIRM_TX, 'burns-warning')
        expect(w).toContain('payWithTonFee')
        expect(w).toContain('isTonJetton')
        expect(w).not.toMatch(/priceImpact/)
    })
})

describe('Rule 3 (spec 8): relay modunda TON_FEE_RESERVE satiri gizlenir', () => {
    // KOSUL `!sendWithTonRelay` (inceleme turu 1, onemli 4) - Rule 3'un NIYETI
    // ("relay modunda ihtiyat payi satiri gizlenir") AYNEN korunur, olcum
    // SIKILASIR. Cipilak `!payWithTonFee` sessiz bir yol birakiyordu: useTonFee
    // teklif alanlari eksikken /quote'a HIC gitmez ve `decision`i null birakir -
    // engel karti da cizilmez. O durumda ATS karti gizli (atsMaxFee null), bu
    // satir gizli (payWithTonFee true), engel yok ve gonderim self-pay'e duserek
    // kullanicidan TON aliyordu: ekranda HICBIR ucret gorunmeden.
    it('ConfirmTransaction.vue: TON_FEE_RESERVE satiri !sendWithTonRelay kosulunun ALTINDA', () => {
        const idx = CONFIRM_TX.indexOf('TON_FEE_RESERVE')
        expect(idx).toBeGreaterThan(-1)
        const before = CONFIRM_TX.slice(Math.max(0, idx - 400), idx)
        expect(before).toMatch(/!sendWithTonRelay/)
        // Zayiflatma yonu: eski cipilak kosul GERI GELMEMIS olmali.
        expect(before).not.toMatch(/!payWithTonFee/)
    })

    // Ayni bosluk `hideNativeTonFeeCard` uzerinden de acilabiliyordu: o degisken
    // TUM native ucret kartini gizliyor.
    it('ConfirmTransaction.vue: hideNativeTonFeeCard da sendWithTonRelay e bagli', () => {
        // BILDIRIMIN KENDISI olculur (bkz. statementAt): sabit pencere, hemen
        // altindaki aciklamada gecen `payWithTonFee.value`a alti karakter kala
        // bitiyordu - araya bir yorum satiri girse test DOGRU kod uzerinde duserdi.
        const def = statementAt(CONFIRM_TX, 'const hideNativeTonFeeCard = computed(')
        expect(def).toContain('sendWithTonRelay.value')
        expect(def).not.toMatch(/payWithTonFee\.value/)
    })
})

describe('TON kolu AYNI engel blogunu besliyor - yeni kart ACILMIYOR (Task 8 olcumu)', () => {
    // Olculmus taban (Task 8 ilk turu): ConfirmTransaction.vue:202,218 - TAM 2
    // kez ('run-onboarding' aciklama satiri + buton). ConfirmTransaction.vue'da
    // fiyat karti ve engel karti ZATEN ayriydi, bu sayi DEGISMEDI.
    it('ConfirmTransaction.vue: run-onboarding TAM 2 kez gecer', () => {
        const count = (CONFIRM_TX.match(/run-onboarding/g) || []).length
        expect(count).toBe(2)
    })

    // ROUND 1 REVIEW BULGU 1+4: Swap.vue'da ATS-EVM'in engeli (kendi fiyat
    // kartina EMBEDDED, degismedi) ile TON'un engeli (ARTIK AYRI bir kart,
    // fiyat hazir olmadan da gorunebilsin diye) birbirinden AYRILDI - ikisinin
    // de kendi aciklama+buton cifti var, TOPLAM 4. Bu, "TON icin yeni bir engel
    // TURU acildi" demek DEGIL: TEK bir engel TURU (feeDecision) iki FARKLI
    // konteynerde (ATS'in kendi karti / TON'un kendi karti) cizilir - asagidaki
    // "AYNI ifadeyle kapiliyor" testi bunu dogruluyor.
    it('Swap.vue: run-onboarding TAM 4 kez gecer (ATS-embedded 2 + TON-ayri 2)', () => {
        const count = (SWAP.match(/run-onboarding/g) || []).length
        expect(count).toBe(4)
    })

    // abort-unsafe icin YENI DAL YAZILMAZ: mesaj ('feeDecision.i18nKey', VAR olma
    // iddiasi asagida) butonsuz cizilir - bu yuzden `action === 'abort-unsafe'`
    // kodda HIC gecmemeli.
    //
    // GOREV 10, YUKUMLULUK 7: `severity === 'blocked'` ARTIK geciyor ama YALNIZ
    // RENK kuralinda - kirmiziyi hak eden tek aile odur; `transient`/`operator`
    // (bir /status ya da /quote aksakligi) CALISAN bir gonderimi durdurmuyor ve
    // kirmizi "engellendi" demek yanlisti. Iddia ESLENMIS ve tek bir sayiya
    // baglandi: 0 olursa (kural silinmis) DUSER, 2 olursa (blocked'a AYRI bir
    // dal/buton acilmis) yine DUSER.
    it("abort-unsafe icin AYRI dal YOK; 'blocked' YALNIZ renk kuralinda", () => {
        for (const [name, src] of [['ConfirmTransaction.vue', CONFIRM_TX], ['Swap.vue', SWAP]]) {
            expect(src, `${name}: feeDecision.i18nKey yok`).toContain('feeDecision.i18nKey')
            expect(src, `${name}: action === 'abort-unsafe' kosulu VAR`).not.toMatch(/action\s*===\s*['"]abort-unsafe['"]/)

            // (a) renk kurali GERCEKTEN var ve `:class` uzerinde
            expect(src, `${name}: blocked renk kurali yok`)
                .toMatch(/:class="feeDecision\.severity === 'blocked'/)
            // (b) baska hicbir yerde kosul DEGIL
            const kez = (src.match(/feeDecision\.severity === 'blocked'/g) || []).length
            expect(kez, `${name}: 'blocked' TAM 1 kez (renk) gecmeli`).toBe(1)
        }
    })

    // ESKI KURAL GERI GELMESIN: `feeDecision.severity === 'user' ? amber : red`
    // TERSINI yapiyordu - kirmizi olmamasi gereken TEK aile disindaki her sey
    // kirmiziydi. Yukaridaki sayim tek basina bunu yakalamaz (eski ternary
    // 'blocked'a hic dokunmadan geri konabilir).
    it("eski `severity === 'user' ? amber : red` kurali GERI GELMEMIS", () => {
        for (const [name, src] of [['ConfirmTransaction.vue', CONFIRM_TX], ['Swap.vue', SWAP]]) {
            expect(src, `${name}: eski renk kurali geri gelmis`)
                .not.toMatch(/:class="feeDecision\.severity === 'user'/)
        }
    })

    // ROUND 1 REVIEW BULGU 4 (kok neden + kablolama): iki ekran, TON engel
    // kartini AYNI ifadeyle kapiyor mu? Onceki tur `isTonNetwork` (Send, cipilak -
    // calisan bir self-pay'in yanina bile boyanirdi) ile `payWithAts ||
    // payWithTonFee` (Swap, cipilak payWithTonFee - bir /status kesintisinde
    // sessizce kaybolurdu) FARKLI ifadelerdi. Artik ikisi de TIPATIP AYNI
    // `tonFeeDecisionActive` degiskenini (isTonNetwork && (payWithTonFee ||
    // statusUnreadable)) kullaniyor - metin karsilastirmasi bunu birebir kilitler.
    it('Her iki ekran da TON engel kartini AYNI ifadeyle (tonFeeDecisionActive) kapiyor', () => {
        const FORMULA = 'isTonNetwork.value && (payWithTonFee.value || tonFee.statusUnreadable.value)'
        for (const [name, src] of [['ConfirmTransaction.vue', CONFIRM_TX], ['Swap.vue', SWAP]]) {
            // Tanim: `const tonFeeDecisionActive = computed(() => <FORMULA>)`
            const defIdx = src.indexOf('const tonFeeDecisionActive = computed(()')
            expect(defIdx, `${name}: tonFeeDecisionActive tanimi yok`).toBeGreaterThan(-1)
            const def = src.slice(defIdx, defIdx + 200)
            expect(def, `${name}: tonFeeDecisionActive formulu farkli`).toContain(FORMULA)

            // Kullanim: blocker kartinin v-if'i BU degiskene bagli.
            expect(src, `${name}: tonFeeDecisionActive engel kartinda kullanilmiyor`)
                .toMatch(/v-if="[^"]*tonFeeDecisionActive[^"]*feeDecision/)
        }

        // Ne cipilak isTonNetwork (Send'in ONCEKI hatasi - calisan bir self-pay'in
        // yanina bile blocker boyardi) ne de cipilak payWithAts||payWithTonFee
        // (Swap'in ONCEKI hatasi - bir /status kesintisinde sessizce kaybolurdu)
        // engel kartinin GATE'i olarak KALMAMALI.
        expect(CONFIRM_TX).not.toMatch(/v-if="\(isAtsTransfer \|\| isTonNetwork\)\s*&&\s*feeDecision/)
        expect(SWAP).not.toMatch(/v-if="payWithAts \|\| payWithTonFee"/)
    })
})

describe('Ucret karti kural 1/2 (spec 8): atsMaxFee dogrudan, "en fazla" YOK', () => {
    it('ConfirmTransaction.vue: TON karti VAR ve YALNIZ TAM kapiyla (atsMaxFee != null dahil) acilir', () => {
        // ROUND 2 REVIEW BULGU: onceki hali yalniz 'isTonNetwork && payWithTonFee'
        // ONEKINI ariyordu - kapinin sonundaki '&& tonFee.atsMaxFee.value != null'
        // cikarilsa (bulgu 1'in duzeltmesi GERI ALINSA) bile bu iddia GECIYORDU
        // (mutasyonla dogrulandi). Iki AYRI iddia: biri kart TAMAMEN SILINIRSE
        // duser, digeri yalniz KAPI zayiflatilirsa duser - ikisi ayni ANDA
        // yanlislikla 'yesil' KALAMAZ.
        //
        // VAR OLMA: bu dize YALNIZ TON ucret kartinin GOVDESINDE yasar (script
        // tarafinda degil) - kart TAMAMEN SILINIRSE bu iddia DUSER.
        expect(CONFIRM_TX, 'TON ucret karti (govde) bulunamadi').toContain('tonFeePaidOnBsc')

        // TAM KAPI: sondaki '&& tonFee.atsMaxFee.value != null' CIKARILIRSA
        // (Bulgu 1'in duzeltmesi geri alinirsa) bu iddia DUSER - onceki turun
        // ONEK-bazli blockBetween'i bunu YAKALAMIYORDU.
        const FULL_GATE = 'v-if="isTonNetwork && payWithTonFee && tonFee.atsMaxFee.value != null"'
        expect(CONFIRM_TX, 'TON ucret kartinin kapisi tam degil/zayiflatilmis').toContain(FULL_GATE)

        const card = blockBetween(CONFIRM_TX, FULL_GATE, 'isAtsTransfer && !isTonNetwork')
        expect(card).toContain('tonFee.atsMaxFee.value')
        expect(card).not.toContain('atsFeeUpTo')
    })
})

// ---------------------------------------------------------------------------
// ATSMAXFEE BIR TAVAN DEGIL, KESILECEK TAM TUTAR
//
// Sozlesme ss03 bunu acikca soyluyor: "/relay tam olarak bu kadar tahsil eder.
// EVM'deki 'kullanilmayan gaz iade edilir' semantigi TON'da YOKTUR. Kullaniciya
// 'en fazla' degil, 'bu kadar kesilecek' deyin."
//
// UC ROLE KARTI da tutari bir TAHMIN gibi etiketliyordu ('Tahmini Gaz Ucreti',
// 'Tahmini Ag Ucreti'). Yaninda "iade edilmez" yaziyor olmasi celiskiyi
// buyutuyordu: tahmin edilen ama iade edilmeyen bir ucret, kullanicinin
// bekleyecegi sey DEGIL.
//
// EVM KARTLARI DEGISMEZ ve bu ayrim onemli: orada 'en fazla' DOGRU, cunku
// kullanilmayan gaz gercekten iade ediliyor. Blanket bir degisiklik EVM
// ekranlarini YANLIS yapardi.
// ---------------------------------------------------------------------------
describe('TON role ucreti TAHMIN gibi etiketlenmiyor (sozlesme ss03)', () => {
    const TAHMIN_ANAHTARLARI = ['confirmTransaction.gasFee', 'tonConnect.estimatedFeeLabel']

    it('ConfirmTransaction.vue: TON role karti tahmin etiketi TASIMAZ', () => {
        const FULL_GATE = 'v-if="isTonNetwork && payWithTonFee && tonFee.atsMaxFee.value != null"'
        const card = blockBetween(CONFIRM_TX, FULL_GATE, 'isAtsTransfer && !isTonNetwork')
        for (const k of TAHMIN_ANAHTARLARI) {
            expect(card, `TON karti hala tahmin etiketi kullaniyor: ${k}`).not.toContain(k)
        }
        expect(card, 'kesin tutar etiketi yok').toContain('tonFeeExact')
    })

    it('Swap.vue: TON role karti tahmin etiketi TASIMAZ', () => {
        const card = blockBetween(SWAP,
            'v-if="isTonNetwork && payWithTonFee && tonFee.atsMaxFee.value != null"',
            'tonFeeDecisionActive')
        for (const k of TAHMIN_ANAHTARLARI) {
            expect(card, `Swap TON karti hala tahmin etiketi kullaniyor: ${k}`).not.toContain(k)
        }
        expect(card, 'kesin tutar etiketi yok').toContain('tonFeeExact')
    })

    it('TonSendTx.vue: ROLE karti kesin, SELF-PAY karti hala tahmin', () => {
        const role = blockBetween(TON_SEND_TX, 'v-if="sendWithTonRelay"', '<div v-else')
        expect(role, 'role karti hala tahmin etiketi kullaniyor')
            .not.toContain('estimatedFeeLabel')
        expect(role, 'kesin tutar etiketi yok').toContain('tonFeeExact')

        // SELF-PAY KARTI DEGISMEZ ve bu ESLENMIS IDDIA: orada gosterilen sey
        // GERCEKTEN bir tahmin (sabit ihtiyat payi TON_FEE_RESERVE, "≈" ile) --
        // onu da "kesin" yapmak yeni bir yalan olurdu. Sayi, etiketi iki kartta
        // birden degistiren bir sonraki turu yakalar.
        const kez = (TON_SEND_TX.match(/estimatedFeeLabel/g) || []).length
        expect(kez, 'self-pay karti da degistirilmis (ya da kart silinmis)').toBe(1)
    })

    // EVM KARTLARI KORUNUR. Bu iddia olmadan, "tahmin etiketini temizleyelim"
    // diyen bir sonraki tur EVM ekranlarini da degistirip YANLIS yapardi.
    it('EVM kartlari "en fazla" demeye DEVAM eder (orada iade VAR)', () => {
        // Niteleyicinin METNI kartta, GORUNURLUGU ekranda: EVM karti onu
        // `!isCrosschain` ile acar (ayni zincirde postOp kullanilmayan gazi IADE
        // EDER), capraz-zincirde kapatir. TON karti HIC acmaz.
        expect(KART, 'niteleyici kartta hic cizilmiyor').toContain('atsFeeUpTo')
        expect(CONFIRM_TX, 'EVM ATS karti "en fazla"yi kaybetmis').toContain(':show-up-to="!isCrosschain"')
    })
})

describe('Rule 4 (spec 8): quoteId/actionHash/seqno yalniz katlanir "Detaylar"da', () => {
    it('ConfirmTransaction.vue: bu alanlar tonFeeDetailsOpen kapisinin ARDINDA', () => {
        const idx = CONFIRM_TX.indexOf('quoteId: {{ tonFee.quote.value.quoteId }}')
        expect(idx).toBeGreaterThan(-1)
        const before = CONFIRM_TX.slice(Math.max(0, idx - 200), idx)
        expect(before).toMatch(/tonFeeDetailsOpen/)
    })
})

describe('Islem karti - Task 7 durumlari (spec 8 karar tablosu)', () => {
    it('"recovering": govde metni tonFeeVerifying', () => {
        // Tam `v-if=` oznitelik dizesi kullanilir - `indexOf` aksi halde rozet
        // ternary'sindeki (badge, asagida ayri test edilir) DAHA ONCEKI
        // eslesmeyi yakalardi.
        const chunk = sliceFrom(TX_STATUS, `v-if="tx.meta.tonFeeState === '${RECOVERING}'"`, 200)
        expect(chunk).toContain('tonFeeVerifying')
    })

    // ROUND 1 REVIEW BULGU 2: 'recovering' iken ne kart tonu (bar+rozet arka
    // plani) ne de rozet METNI "başarısız"a duşebilir - `tx.status` bu sirada
    // 'error' OLABILIR (onceki bir denemeden kalma) ve dokunulmadan birakilirsa
    // rozet "İŞLEM BAŞARISIZ" yazardi tam da kurtarma surerken.
    it('"recovering": kart tonu HER ZAMAN processing doner (tx.status NE OLURSA olsun)', () => {
        const body = blockBetween(TX_STATUS, 'function tonFeeTone', '\n}')
        // Dizeyle kurulan bir RegExp yerine SATIRIN kendisi olculur: hem kacis
        // dizisi tuzagi yok, hem de iddia daha dar - dosyanin baska bir yerindeki
        // `return 'processing'` bu dali "dogru" gostermemeli.
        const at = body.indexOf(`state === '${RECOVERING}'`)
        expect(at, 'recovering dali YOK').toBeGreaterThan(-1)
        const line = body.slice(at, body.indexOf('\n', at))
        expect(line, 'recovering dali processing DONDURMUYOR').toContain("return 'processing'")
    })

    it('"recovering": rozet METNI de processing e duser, tx.status a BAKILMAKSIZIN', () => {
        // Rozet ternary'sinde 'recovering' dali, cipilak `tx.status === 'error'`
        // dalindan ONCE gelmeli - yoksa status='error' + tonFeeState='recovering'
        // ikilisi "İşlem Başarısız" yazdirir.
        const idx = TX_STATUS.indexOf(`tx.meta.tonFeeState === '${RECOVERING}' ?`)
        expect(idx, 'rozet ternary inda recovering dali yok').toBeGreaterThan(-1)
        const failedIdx = TX_STATUS.indexOf("tx.status === 'error' ? \$t('transactionStatus.failed')")
        expect(failedIdx).toBeGreaterThan(-1)
        expect(idx).toBeLessThan(failedIdx)
    })

    it('"not-charged": govde metni tonFeeNotCharged referansi tasir', () => {
        expect(TX_STATUS).toContain(`v-else-if="tx.meta.tonFeeState === '${NOT_CHARGED}'">{{ $t('send.confirmTransaction.tonFeeNotCharged') }}`)
    })

    // ROUND 1 REVIEW BULGU 3: buton ONCEDEN "Tekrar dene" YAZIP kaydi SILIYORDU
    // (clearTransaction) - etiket eylemle CELISIYORDU. Etiket artik eylemle
    // UYUSUYOR: transactionStatus.dismiss ("Kapat"), atsQuoteRetry DEGIL.
    it('"not-charged": Kapat butonu (transactionStatus.dismiss) AYNI kart icinde, "Tekrar dene" ETIKETI YOK', () => {
        const chunk = sliceFrom(TX_STATUS, 'flex items-center gap-2 mt-1 pointer-events-auto', 700)
        expect(chunk).toContain(`tx.meta.tonFeeState === '${NOT_CHARGED}'`)
        expect(chunk).toContain("txStore.clearTransaction(tx.id)")
        expect(chunk).toContain("\$t('transactionStatus.dismiss')")
        expect(chunk).not.toContain('atsQuoteRetry')
    })

    it('"unresolved": govde metni tonFeeUnresolved + settlementId interpolasyonu tasir, "basarisiz" YOK', () => {
        const chunk = sliceFrom(TX_STATUS, "send.confirmTransaction.tonFeeUnresolved'", 250)
        expect(chunk).toContain('settlementId: tx.meta.settlementId')
        expect(chunk.toLowerCase()).not.toMatch(/başarısız|basarisiz/)
    })

    // ALSO FIX (round 1 review): settlementId YOKKEN interpolasyonu yine de
    // basmak "Destek kaydı:" yazip ARDINDAN hicbir sey gostermiyordu - Kopyala
    // butonuyla AYNI kosulla (tx.meta.settlementId varligi) korunmali.
    it('"unresolved": govde metni de settlementId varligiyla KAPILI (Kopyala butonuyla AYNI kosul)', () => {
        const idx = TX_STATUS.indexOf("send.confirmTransaction.tonFeeUnresolved'")
        expect(idx).toBeGreaterThan(-1)
        const before = TX_STATUS.slice(Math.max(0, idx - 200), idx)
        expect(before).toContain(`v-else-if="tx.meta.tonFeeState === '${UNRESOLVED}' && tx.meta.settlementId"`)
    })

    it('"unresolved": Kopyala butonu (settlementId varsa) AYNI kart icinde', () => {
        const chunk = sliceFrom(TX_STATUS, 'flex items-center gap-2 mt-1 pointer-events-auto', 900)
        expect(chunk).toContain(`tx.meta.tonFeeState === '${UNRESOLVED}'`)
        expect(chunk).toContain('copy(tx.meta.settlementId)')
    })

    // Badge (ust rozet) satiri AYRICA kontrol edilir: 'unresolved' iken rozet
    // METNI de genel `transactionStatus.failed` yerine `tonFeeUnresolvedBadge`e
    // duser - alttaki tx.status HALA 'processing' olsa bile kullaniciya
    // "Başarısız" YAZILMAZ.
    it('rozet: unresolved dalinda transactionStatus.failed KULLANILMAZ', () => {
        const marker = `tx.meta.tonFeeState === '${UNRESOLVED}' ? $t('transactionStatus.tonFeeUnresolvedBadge')`
        const chunk = sliceFrom(TX_STATUS, marker, marker.length + 10)
        expect(chunk).toContain('tonFeeUnresolvedBadge')
    })

    it('i18n govdeleri (tr+en) de "basarisiz"/"failed" kelimesini TASIMAZ (tonFeeUnresolved)', () => {
        const trText = get(TR, 'send.confirmTransaction.tonFeeUnresolved')
        const enText = get(EN, 'send.confirmTransaction.tonFeeUnresolved')
        expect(trText.toLowerCase()).not.toMatch(/başarısız|basarisiz/)
        expect(enText.toLowerCase()).not.toMatch(/\bfailed\b/)
    })

    it('kart tonu tonFeeState e gore ATS.status tan ONCE karar verir (sonsuz "isleniyor" onlenir)', () => {
        expect(TX_STATUS).toMatch(/function tonFeeTone/)
        const body = blockBetween(TX_STATUS, 'function tonFeeTone', '\n}')
        expect(body).toContain(`'${NOT_CHARGED}'`)
        expect(body).toContain(`'${UNRESOLVED}'`)
        expect(body).toContain(`'${RECOVERING}'`)
        expect(body).toContain("'error'")
        expect(body).toContain("'processing'")
    })
})

// ---------------------------------------------------------------------------
// GOREV 10 - ARAYUZ TARAFINDAKI TEL (inceleme turu 1, onemli 2).
//
// Gorev 10'un butun kablolama iddialari `background.js`/`messageGate.js` okuyordu:
// telin BIR UCU kilitliydi. `ConfirmTransaction.vue`'daki
// `payWithTonFee: sendWithTonRelay.value` satirini silmek ozelligi yeniden
// ULASILAMAZ yapiyordu - yani bu gorevin var olma sebebi olan durum geri geliyordu -
// ve suit TAMAMEN YESIL kaliyordu. Asagidaki iddialar o ucu kilitler.
//
// Her iddia ESLENMIS: biri SILINCE duser, digeri ZAYIFLATILINCA (sabit degere
// baglanma, arguman kurucusunun bosaltilmasi) duser.
// ---------------------------------------------------------------------------
describe('ConfirmTransaction.vue -> arka plan teli (gorev 10)', () => {
    it('relay alanlari HER IKI TON mesajina da giriyor', () => {
        // (a) alan demeti VAR ve gercek bir hesaplanmis degere bagli
        expect(CONFIRM_TX, 'tonRelayFields tanimi yok').toContain('const tonRelayFields = {')
        expect(CONFIRM_TX, 'payWithTonFee sendWithTonRelay ye bagli degil')
            .toContain('payWithTonFee: sendWithTonRelay.value')
        expect(CONFIRM_TX, 'approvedAtsFee gonderilmiyor')
            .toMatch(/approvedAtsFee: tonFee\.quote\.value\?\.sign\?\.feeAuth\?\.atsMaxFee/)

        // (b) demet GERCEKTEN iki mesaja da yayiliyor - jetton kolu unutulursa
        // T9'un kapattigi saldirinin hedefi olan yol yine ulasilamaz kalir.
        const kez = (CONFIRM_TX.match(/\.\.\.tonRelayFields,/g) || []).length
        expect(kez, 'tonRelayFields TAM 2 mesaja yayilmali (jetton + native)').toBe(2)
    })

    it('relay bayragi SABIT bir degere baglanmamis', () => {
        // `payWithTonFee: true` her gonderimi relay'e sokardi (TON ile odeme secenegi
        // olan kullaniciyi da, notlu gonderimi de). Zayiflatma yonu.
        expect(CONFIRM_TX).not.toMatch(/payWithTonFee:\s*(true|false)\b/)
    })

    it('sendWithTonRelay kullanicinin GORDUGU tutara bagli', () => {
        // Fiyat cozulmeden relay'e cikmak, kullanicinin hic gormedigi bir ucreti
        // onaylatmak olurdu; dogrulama (V10, approvedAtsFee) da kapali tarafa duserdi.
        const def = sliceFrom(CONFIRM_TX, 'const sendWithTonRelay = computed(', 260)
        expect(def).toContain('tonFee.atsMaxFee.value != null')
    })

    it('tonPublicKey arka plandan MESAJLA isteniyor (bilesen kasaya girmiyor)', () => {
        expect(CONFIRM_TX, 'TON_FEE_IDENTITY mesaji gonderilmiyor').toContain("type: 'TON_FEE_IDENTITY'")
        expect(CONFIRM_TX, 'yanit tonPublicKey e yazilmiyor').toContain('resp.tonPublicKey')
        // Bilesen kasadan KENDISI cozmeye kalkmamali.
        expect(CONFIRM_TX).not.toMatch(/tonIdentityForAccount|unlockVault|sessionMasterKeyJwk/)
    })

    it('tonFee.load HER cagri yerinde AYNI arguman kurucusunu kullanir', () => {
        // Iki cagri yeri (ilk yukleme + "Tekrar dene"); biri eski `{ sender, tonWallet }`
        // seklinde kalirsa o yol tutar GOSTEREMEZ ve fark hicbir yerde gorunmez.
        const cagri = (CONFIRM_TX.match(/tonFee\.load\(/g) || []).length
        const kurucu = (CONFIRM_TX.match(/tonFee\.load\(tonFeeLoadArgs\(\)\)/g) || []).length
        expect(cagri, 'tonFee.load hic cagrilmiyor').toBeGreaterThan(0)
        expect(kurucu, 'her tonFee.load cagrisi tonFeeLoadArgs() almali').toBe(cagri)

        // Kurucu GERCEKTEN teklif icin gereken iki alani tasiyor - bos bir nesne
        // dondurmek butun iddialari yesil birakip karti sessizce fiyatsiz yapardi.
        const args = sliceFrom(CONFIRM_TX, 'const tonFeeLoadArgs = () => ({', 260)
        expect(args).toContain('tonPublicKey: tonFeePublicKey.value')
        expect(args).toContain('actions:')
    })

    // Kimlik teklif ISTEMEDEN once alinmali: `useTonFee` tonPublicKey/actions
    // eksikse teklife HIC gitmez ve kart tutarsiz kalir.
    it('kimlik, ekran acilisindaki tonFee.load tan ONCE aliniyor', () => {
        // Pencere ile olculur, dosya genelinde indexOf ile DEGIL: "Tekrar dene"
        // butonunun kendi `tonFee.load` cagrisi dosyada daha ONCE geciyor ve genel
        // bir indexOf karsilastirmasi onu yakalayip yanlis olcerdi.
        const chunk = sliceFrom(CONFIRM_TX, 'await loadTonFeeIdentity()', 120)
        expect(chunk, 'kimlik alindiktan hemen SONRA tonFee.load gelmiyor')
            .toContain('await tonFee.load(tonFeeLoadArgs())')
    })
})

// ---------------------------------------------------------------------------
// UYGUNLUK KAPISI ARAYUZDE (inceleme turu 1, onemli 3).
//
// `assertRelayComment` GONDERIM aninda firlatiyordu: kullanici notunu yaziyor,
// onay ekraninda notu ve ATS ucret kartini goruyor, Gonder'e basiyor ve "notu
// kaldirin ya da TON ile odeyin" cevabini aliyordu - oysa ekranda oyle bir
// SECENEK YOK (relay/self-pay anahtari yok, mod bolgeden turuyor). Daha once
// calisan bir akis (memolu borsa yatirimi) cikmaza giriyordu.
//
// Karar artik ekranda, kart cizilmeden once veriliyor: notlu gonderim sessizce
// SELF-PAY'e duser ve TON_FEE_RESERVE satiri gorunur.
// ---------------------------------------------------------------------------
describe('relay UYGUNLUGU gonderimden ONCE karara baglaniyor (gorev 10)', () => {
    it('payWithTonFee, bolge kapisinin YANINDA uygunluk kapisini da tasiyor', () => {
        const def = sliceFrom(CONFIRM_TX, 'const payWithTonFee = computed(', 200)
        expect(def, 'bolge kapisi kaybolmus').toContain('tonFee.relayActive.value')
        expect(def, 'uygunluk kapisi yok').toContain('tonRelayEligible.value')
    })

    // MEMO KAPISI ONCE DARALDI (2026-09-14: duz TON), sonra TUMDEN KALKTI
    // (2026-09-15: jetton). Geriye kalan tek uygunluk kosulu EVM kasasi.
    it('uygunluk: EVM kasasi yoksa relay YOK', () => {
        const def = sliceFrom(CONFIRM_TX, 'const tonRelayEligible = computed(', 300)
        expect(def, 'EVM kasasi kapisi yok').toContain('tonFeeEvmCapable.value')
    })

    // BU TESTIN VAR OLMA SEBEBI TERSINE DONDU, KAYBOLMADI.
    //
    // Eskiden jetton+not eleniyordu, cunku arka plan o gonderimi firlatiyordu ve
    // ekranda ATS karti gostermek kullaniciyi donemeyecegi bir cikmaza sokardi.
    // 2026-09-15'te arka plan ARTIK FIRLATMIYOR - ve ayni cikmaz simdi TERS
    // yonden olusur: eleme DURURSA calisan bir gonderim gereksiz yere self-pay'e
    // duser, kullanici odemesi gerekmeyen TON ucretini oder. Kosul KALKMIS
    // OLMALI, bu yuzden YOKLUGU olculuyor.
    it('uygunluk: JETTON + not ARTIK elemiyor', () => {
        const def = sliceFrom(CONFIRM_TX, 'const tonRelayEligible = computed(', 300)
        expect(def, 'jetton not kapisi hala duruyor').not.toContain('crypto.tonComment')
    })

    // NOT ARTIK ENGEL DEGIL - AMA ONIZLEMEYE TASINMAK ZORUNDA.
    //
    // Kapiyi kaldirmak tek basina YENI bir sessiz hata acardi: onizleme notsuz bir
    // govde icin fiyatlanir, gonderim notlu bir govde ister ve V5 ikisini ayri
    // gorup REDDEDER. Kullanici fiyatini GORDUGU bir gonderimde "govde
    // dogrulanamadi" alir. Iki taraf AYNI alani AYNI adla tasimali.
    it('not onizleme niyetine de konuyor (onizleme = gonderim)', () => {
        const def = sliceFrom(CONFIRM_TX, 'const tonFeeActions = computed(', 1400)
        // IKI KOL DA: duz TON ve jetton. Biri tasiyip digeri tasimazsa, tasimayan
        // kolda onizleme notsuz bir govde icin fiyatlanir ve gonderim V5'te duser.
        const kez = (def.match(/comment: crypto\.tonComment/g) || []).length
        expect(kez, 'iki kol da notu tasimali (duz TON + jetton)').toBe(2)
    })

    it('EVM yetenegi arka plandan geliyor ve varsayilani GUVENLI taraf', () => {
        // Bilinmeyen durumda (mesaj dustu, kasa kilitli) relay secenegi
        // GOSTERILMEMELI - varsayilan false.
        expect(CONFIRM_TX).toContain('const tonFeeEvmCapable = ref(false)')
        expect(CONFIRM_TX).toContain('resp.evmCapable === true')
    })
})

// Canli olcum 2026-09-01: TON transferinde "Kurulum gerekli" karti CIZILIYOR ama
// "Onayla & Gonder" ACIK kaliyordu. Sebep: `feeBlocked` TON kolunda YALNIZ
// bakiyeye (`insufficientGas`) bakiyordu, ucret KARARINA hic bakmiyordu. Sonuc:
// kullanici kurulumu tamamlamadan gonderiyor, gonderim sessizce self-pay'e dusuyor
// ve gasless soylenmisken kullanicinin KENDI TON'u yaniyordu. EVM kolunda ayni
// durum ZATEN blokluydu (`atsBlocked` -> `!ready`); bu, o davranisin TON aynasi.
describe('TON: bloklayici ucret karari "Onayla & Gonder"i KILITLER (EVM aynasi)', () => {
    it('ConfirmTransaction.vue: tonFeeBlocked VAR ve karar+gorunurluk kapisina bagli', () => {
        const def = sliceFrom(CONFIRM_TX, 'const tonFeeBlocked = computed(', 260)
        // (a) YALNIZ TON relay kolunda - engel KARTIYLA birebir AYNI kapi. Cipilak
        //     `isTonNetwork` olsaydi calisan bir self-pay gonderimini de kilitlerdi.
        expect(def, 'tonFeeDecisionActive kapisi yok').toContain('tonFeeDecisionActive.value')
        // (b) GERCEKTEN bir karar olmali - null bir decision hicbir seyi bloklamaz
        expect(def, 'decision varlik kontrolu yok').toContain('feeDecision.value != null')
        // (c) 'internal' DISLANIR: o aile kartta da cizilmiyor (kartin v-if'i ile AYNI
        //     kural). Gorunmeyen bir sebeple kilitlenen buton = aciklamasiz olu buton.
        expect(def, "'internal' dislanmiyor").toMatch(/severity !== 'internal'/)
    })

    it('ConfirmTransaction.vue: feeBlocked TON kolunda tonFeeBlocked i OKUYOR', () => {
        const def = sliceFrom(CONFIRM_TX, 'const feeBlocked = computed(', 300)
        expect(def, 'feeBlocked tonFeeBlocked i okumuyor').toContain('tonFeeBlocked.value')
        // Gerileme koruması: EVM/ATS dali AYNEN duruyor (yeni kapi onu EZMEMELI).
        expect(def, 'ATS dali kaybolmus').toContain('atsBlocked.value')
    })

    it('Onayla dugmesinin :disabled i feeBlocked e bagli KALIYOR', () => {
        expect(CONFIRM_TX).toMatch(/:disabled="isSubmitting \|\| feeBlocked/)
    })

    it('ConfirmTransaction.vue: TON ucret blogunda buton metni "Yetersiz Bakiye" DEMEZ', () => {
        // 2026-08-10 dersinin TON tekrari: sebep bakiye DEGILKEN "Yetersiz Bakiye"
        // yazmak kullaniciyi olmayan bir sorunu cozmeye (daha fazla TON almaya) iter.
        // Non-ATS dal ESKIDEN cipilak `true` idi; artik gercek bakiye kosulunu olcer.
        const def = sliceFrom(CONFIRM_TX, 'const balanceIsTheReason = isAtsTransfer.value', 260)
        expect(def, 'non-ATS dal hala cipilak true').not.toMatch(/:\s*true\s*$/m)
        // 2026-09-14: degisken `nativeBalanceShort`a tasindi -- TON'da role
        // farkindaki `tonInsufficient`i, disinda EVM'in `insufficientGas`ini okur.
        expect(def, 'gercek bakiye kosulu yok').toContain('nativeBalanceShort.value')
    })
})

// 2026-09-01: bakiye yetmeyince ekranda YALNIZ "BSC aginda ATS gerekli" yaziyordu.
// KAC ATS gerektigi hicbir yerde yoktu. Artik ucret ("quote") kartiyla AYNI tasarimda,
// kahraman sayisi EKSIK MIKTAR olan bir kart ciziliyor.
describe('Eksik ATS karti - hata kabugu, kahraman sayi = eksik miktar', () => {
    it('ConfirmTransaction.vue: showAtsShortfall kapisi tam', () => {
        const def = sliceFrom(CONFIRM_TX, 'const showAtsShortfall = computed(', 320)
        // (a) YALNIZ ATS/TON kollarinda - duz native gonderimde ATS'nin rolu yok
        expect(def, 'kol kapisi yok').toContain('isAtsTransfer.value || tonFeeDecisionActive.value')
        // (b) YALNIZ sunucu "ATS satin al" dediginde
        expect(def, "buy-ats kapisi yok").toMatch(/action === 'buy-ats'/)
        // (c) SAYI YOKSA KART YOK - sayisiz bir "eksik bakiye" karti eskisinden iyi degil
        expect(def, 'sayi kontrolu yok').toContain('atsShortfall.value != null')
    })

    // Bolum bir donem NOTR (quote) kabuktaydi. Artik HATA tonunda: anlattigi sey bir
    // bilgi degil bir ENGEL -- o tutar tamamlanmadan gonderim olmuyor -- ve ekrandaki
    // diger yetersiz-bakiye kartlari (gaz, gas-tokeni) zaten kirmizi.
    //
    // OLCULEN SEY RENK TERCIHI DEGIL, PAYLASIM: bolum ekranda ZATEN VAR OLAN bir
    // kabugu kullanmali, kendine ozel bir gorunum uydurmamali.
    //
    // 2026-09-13: bolum artik varsayilan olarak UCRET KARTININ ICINDE duruyor (ayri
    // kart, ayni konuyu ekranda ikiye boluyordu) ve kendi kabugunu YALNIZ hicbir ucret
    // karti cizilmediginde takiyor. Iddia bu yuzden iki dali da olcer; degisen sadece
    // kabugun NE ZAMAN takildigi, paylasim kurali AYNEN duruyor.
    it('bolum ekranin HATA kabugunu kullanir (ayri bir gorsel dil acilmamis)', () => {
        const SHELL = 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3'
        expect(SHORTFALL, 'standalone dal hata kabugunu kullanmiyor').toContain(SHELL)

        // Kabuk GERCEKTEN paylasiliyor mu? Tek kullanim, "paylasilan kabuk"
        // iddiasini kendi kendini dogrulayan bir cumleye cevirirdi.
        const kez = CONFIRM_TX.split(SHELL).length - 1
        expect(kez, 'hata kabugu bu ekranda paylasilmiyor').toBeGreaterThan(1)

        // KART ICI DAL: paylasim kurali burada BASKA bir sekilde saglanir. Bolum bir
        // kartin icindeyken kendi zeminini SERMEZ -- kartin kendi ic ritmini (ucret
        // notlariyla ayni ince ayrac, ayni bosluk) kullanir. Dolu kirmizi bir blok
        // kartin dibine yapistiginda ekranin en sert ogesi oluyordu, ustelik anlattigi
        // sey bir felaket degil bir eksik. Uyari tonunu yalniz TIPOGRAFI tasir.
        expect(SHORTFALL, 'kart ici dal kartin ayracini kullanmiyor')
            .toContain('border-t border-slate-100 dark:border-white/5')
        // Aksan yine kirmizi ailesinde: yeni/ilgisiz bir renk ACILMAZ.
        expect(SHORTFALL, 'kart ici dal kirmizi ailesinin disina cikmis').toMatch(/text-rose-/)
    })

    // Quote karti kendi notr kabugunda KALMALI: eksik-bakiye kartini kirmiziya
    // almak, ucret kartini da kirmizi yapmak anlamina GELMEZ.
    it('quote karti notr kabugunda kalir', () => {
        // Kabuk artik paylasilan kartta ve BES ekranin tamami icin TEK: eksik-bakiye
        // bolumunu kirmiziya almak ucret kartini kirmiziya cevirmemeli.
        expect(KART, 'quote karti kabugu degismis')
            .toContain('bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2')
    })

    it('kehribar uyari bu kart cizilirken BASTIRILIR (ikisi ayni seyi soylemesin)', () => {
        expect(CONFIRM_TX, 'engel kartinda !showAtsShortfall kapisi yok')
            .toMatch(/feeDecision\.severity !== 'internal' && !showAtsShortfall/)
    })

    it('gereken tutarin kaynagi kola gore AYRISIR (TON budget / EVM requiredAts)', () => {
        const def = sliceFrom(CONFIRM_TX, 'const atsRequiredForShortfall = computed(', 240)
        // TON'da teklif HIC donmez (bakiye yok) -> tek sayi kaynagi /status budget
        expect(def, 'TON kolu budget okumuyor').toContain('atsRequiredFromBudget(tonFee.budget.value)')
        // EVM'de teklif ELDE -> mevcut requiredAts (ucret + ATS gonderiliyorsa tutar)
        expect(def, 'EVM kolu requiredAts okumuyor').toContain('requiredAts.value')
    })

    it('bakiye ZINCIRDEN okunur - budget.srcBalance KULLANILMAZ', () => {
        // /status chainId=56 sorgusunda srcBalance sabit "0" donuyor (canli olcum
        // 2026-09-01: hesapta 20 ATS varken). Ondan hesaplanan "eksik", kullaniciya
        // gerekenin TAMAMINI yukletirdi.
        const def = sliceFrom(CONFIRM_TX, 'const atsShortfall = computed(', 240)
        expect(def, 'bakiye zincir okumasindan gelmiyor').toContain('atsFuel.balance.value')
        expect(CONFIRM_TX, 'srcBalance ekrana sizmis').not.toContain('srcBalance')
        // Yoklukla saglanan iddia tuzagi: okuma GERCEKTEN kuruluyor mu?
        expect(CONFIRM_TX, 'atsFuel hic yuklenmiyor').toContain('atsFuel.load(user.address')
    })

    it.each([['tr', TR], ['en', EN]])('%s: eksik ATS karti anahtarlari tanimli', (lang, dict) => {
        for (const key of [
            'send.confirmTransaction.atsShortfallLabel',
            'send.confirmTransaction.atsShortfallBreakdown',
            'send.confirmTransaction.atsShortfallWhere',
        ]) {
            const val = get(dict, key)
            expect(val, `${lang}: ${key} yok`).toBeTruthy()
            // Anahtar bolumun KENDI dosyasinda aranir: metin ve duzen orada, tek
            // kaynakta. Ekranlarda aramak, bolumun ekranlara kopyalanmasini SART
            // kosardi -- yani duzeltilmesi gereken ayrisma tam olarak buydu.
            expect(SHORTFALL, `${key} kodda kullanilmiyor`).toContain(key.split('.').pop())
        }
        // Dokum satiri UC yer tutucuyu da tasimali - biri dusrse kullanici sayinin
        // nereden geldigini goremez.
        const b = get(dict, 'send.confirmTransaction.atsShortfallBreakdown')
        for (const ph of ['{required}', '{balance}', '{symbol}']) {
            expect(b, `${lang}: atsShortfallBreakdown ${ph} tasimiyor`).toContain(ph)
        }
    })
})

// Iki ekran AYNI bosluga sahipti ve AYNI ifadeyle kapanmali - "engel karti ayni
// ifadeyle kapiliyor" testinin (yukarida) buton karsiligi. Ayrisirlarsa biri
// gonderimi kilitler, digeri sessizce self-pay'e duser.
describe('tonFeeBlocked: iki ekran, TEK formul', () => {
    const FORMULA = "tonFeeDecisionActive.value && feeDecision.value != null && feeDecision.value.severity !== 'internal'"

    it('ConfirmTransaction.vue ve Swap.vue AYNI tonFeeBlocked formulunu kullanir', () => {
        for (const [name, src] of [['ConfirmTransaction.vue', CONFIRM_TX], ['Swap.vue', SWAP]]) {
            const def = sliceFrom(src, 'const tonFeeBlocked = computed(', 240)
            expect(def, `${name}: tonFeeBlocked formulu ayrismis`).toContain(FORMULA)
        }
    })

    it('Swap.vue: bayrak GERCEKTEN guard a gecer ve butonun metni vardir', () => {
        // Yoklukla saglanan iddia tuzagi: computed VAR ama kullanilmiyor olabilirdi.
        expect(SWAP, 'tonFeeBlocked swapBlockReason a gecmiyor').toContain('tonFeeBlocked: tonFeeBlocked.value')
        expect(SWAP, "'ton-fee-blocked' buton metni yok").toContain("blockReason === 'ton-fee-blocked'")
    })
})

// 2026-09-15: TAKAS EKRANI ROLE KOLUNU GORMUYORDU.
//
// Iki kusur ayni kokten: Swap.vue'nun "role gercekten odeyecek" diye bir ifadesi YOKTU
// (yalniz gonderim aninda, swap() icinde yerel bir uclu duruyordu). Sonuc:
//   (1) gaz yeterlilik hesabi gaz payini KOSULSUZ istiyor, GRAM->USDT role takasinda
//       "Yetersiz Bakiye (Gas)" karti ciziliyor ve dugme kilitleniyordu - oysa
//       prepareTonSwap (KAPI 6) kullanicidan SIFIR TON istiyor.
//   (2) eksik ATS yalniz TEK SATIR kuru bir metinle anlatiliyordu; Send ekrani ayni
//       durumda sayili bir bolum cizerken iki ekran farkli dil konusuyordu.
// Asagidaki iddialar ikisini de "iki ekran TEK formul" desenine baglar.
describe('sendWithTonRelay: iki ekran, TEK formul (takas kolu)', () => {
    const FORMULA = 'const sendWithTonRelay = computed(() => payWithTonFee.value && tonFee.atsMaxFee.value != null)'

    it('ConfirmTransaction.vue ve Swap.vue AYNI sendWithTonRelay ifadesini tasir', () => {
        for (const [name, src] of [['ConfirmTransaction.vue', CONFIRM_TX], ['Swap.vue', SWAP]]) {
            expect(src, `${name}: sendWithTonRelay ifadesi ayrismis`).toContain(FORMULA)
        }
    })

    // Takasin UCUNCU terimi Send'de YOK ve olmamali (orada bir takas eylemi yok).
    // Eylem kurulamadiysa gonderim self-pay'e duser, yani gazi KULLANICI oder -
    // kartin/hesabin kapisi bu yuzden bir adim daha siki olmak zorunda.
    it('Swap.vue: gaz kapisi eylem sartini da tasir (swapRelayPaysGas)', () => {
        const def = sliceFrom(SWAP, 'const swapRelayPaysGas = computed(', 160)
        expect(def, 'eylem sarti yok').toContain('sendWithTonRelay.value && tonSwapRelayAction.value != null')
    })

    // Onizleme ile gonderim AYNI degiskeni okumali: ikinci kez yazilan bir uclu,
    // birinin duzeltilip digerinin geride kalmasi demekti.
    it('gonderim de AYNI kapiyi okur (onizleme ile ayrisamaz)', () => {
        expect(SWAP, 'gonderim kendi uclusunu kuruyor').toContain('const roleyeCik = swapRelayPaysGas.value')
        // Kablolamanin geri kalani (imzalanan ust sinir) YERINDE mi?
        expect(SWAP).toContain('message.payWithTonFee = true')
        expect(SWAP).toContain('message.approvedAtsFee = tonFee.atsMaxFeeRaw.value')
    })
})

describe('Takas: role odeyecekken native gaz karti CIZILMEZ', () => {
    it('gaz karti role kolunu disliyor', () => {
        expect(SWAP, 'gaz kartinin v-if i role kolunu dislamiyor')
            .toMatch(/v-if="!payWithAts && !swapRelayPaysGas && !tonFeeBlocked && !insufficientBalance && insufficientGas/)
    })

    // TEK ENGEL, TEK MESAJ - IKI EKRANDA DA.
    //
    // Bloklayici bir ucret karari ekranda ZATEN sebebi anlatiyor ("29.1 ATS eksik").
    // Yanina bir de native kart cizmek yalnizca gurultu degil, YANLIS YONLENDIRME:
    // kullaniciya GRAM/TON almasini soyler, oysa o hicbir seyi acmaz. Buton sirasi
    // (swapBlockReason'da 'ton-fee-blocked', ConfirmTransaction'da `feeBlocked`)
    // ZATEN ucret kararini once okuyordu; ayrisan yalnizca EKRANDI.
    //
    // Iki ekran birlikte olculuyor: biri duzeltilip digeri geride kalirsa ayni
    // durumda farkli sayida kart cizilir - bu depoda tam olarak bu sinif ayrisma
    // yasandi (kullanici ekran goruntusu 2026-09-15).
    it('bloklayici ucret karari varken native kart CIZILMEZ - iki ekranda da', () => {
        expect(SWAP, 'takas: gaz karti ucret engelini dislamiyor')
            .toMatch(/v-if="[^"]*!tonFeeBlocked[^"]*insufficientGas/)
        expect(CONFIRM_TX, 'gonder: native kart ucret engelini dislamiyor')
            .toMatch(/v-if="!isAtsTransfer && !tonFeeBlocked && nativeBalanceShort/)
    })

    // ESLENMIS OLUMSUZ IDDIA: eski kapi `!payWithAts`a guveniyordu, ama isAtsChain TON
    // chainId'sini TANIMAZ - yani TON'da `payWithAts` HER ZAMAN false ve kapi role
    // kolunu HIC dislamiyordu. O hali geri gelirse burasi duser.
    it('eski (role korlerinden) kapi GERI GELMEMIS', () => {
        expect(SWAP, 'gaz karti yine role korlerinden bir kapida')
            .not.toMatch(/v-if="!payWithAts && !insufficientBalance && insufficientGas/)
    })

    // ASIL DUZELTME KARTIN v-if'I DEGIL HESAP: karti gizleyip `insufficientGas`i
    // oldugu gibi birakmak dugmeyi (swapGuard) kilitli birakirdi.
    it('hesap saf katmandan gelir ve role bayragini GECIRIR', () => {
        const cagri = sliceFrom(SWAP, 'const tonGasNeed = computed(', 260)
        expect(cagri, 'role bayragi hesaba gecmiyor').toContain('relayPaysGas: swapRelayPaysGas.value')
        // Olculer (satilan miktar + native ayrimi) teklif turunda yazilir; ikisi de
        // KAYBOLMAMALI - role acikken bile SATILAN native TON kullanicidan cikar.
        const olcum = sliceFrom(SWAP, 'const olculer = {', 280)
        expect(olcum, 'satilan miktar hesaptan dusmus').toContain('amount: inTokenAmount.value')
        expect(olcum, 'native girdi ayrimi kaybolmus').toContain('isNativeIn: isNativeAsset(')
        expect(cagri, 'olculer karara baglanmamis').toContain('...tonGasOlculeri.value')
    })

    // 2026-09-15 GERILEMESININ ASIL KILIDI: karar YAZILMAZ, TUREIR.
    //
    // Duz bir ref'e yazilan cevap, `swapRelayPaysGas` sonradan degistiginde (role
    // gec cozulur ya da coker) DONUYORDU: kart reaktif olarak kayboluyor/beliriyor
    // ama dugme eski cevapta kaliyordu. Iki yonu de kotu - biri aciklamasiz olu
    // dugme (A1), digeri TON'u olmayan kullaniciya YESIL dugme (A2, fail-open).
    it('gaz karari COMPUTED - role degisince kendini yeniler', () => {
        const def = sliceFrom(SWAP, 'const tonInsufficientGas = computed(', 400)
        expect(def, 'karar saf katmandan gelmiyor').toContain('tonSwapGasBlocked(')
        expect(def, 'okunamadi bayragi karara gecmiyor').toContain('unreadable: tonBalanceOkunamadi.value')
        // Ekranin TEK okuma noktasi da computed olmali; ref'e geri donulurse duser.
        expect(SWAP, 'insufficientGas yine duz bir ref')
            .not.toMatch(/const insufficientGas = ref\(/)
        expect(SWAP, 'tek okuma noktasi computed degil')
            .toContain('const insufficientGas = computed(')
    })

    // ILK TURDAKI ZAMANLAMA YARISI: `refreshTonFee` role bayragini kuran cagridir ve
    // gaz kontrolu ondan SONRA gelmek zorunda. Await'siz hali, mount sonrasi ILK
    // teklifte bayragi kesin olarak false okuyor ve role gazi odeyecekken "Yetersiz
    // Bakiye (Gas)" kartini ciziyordu.
    // BEKLEME VAR AMA SINIRLI. `refreshTonFee`nin zincirindeki dort ag cagrisinin
    // hicbirinde zamanasimi yok; cipilak bir `await` askida kalan tek bir fetch
    // yuzunden Takas dugmesini KALICI "teklif yukleniyor"da birakirdi. Iddia bu
    // yuzden iki uclu: (a) bekleme GERCEKTEN var - yoksa bayrak bir tur eski
    // okunur ve sikayetin konusu olan kirmizi kart yanip soner; (b) bekleme
    // SINIRLI - yoksa hang dugmeyi olu birakir.
    it('gaz kontrolunden ONCE role turu BEKLENIR - ama sinirli', () => {
        const blok = sliceBetween(SWAP, 'swapData.value = data.data', 'const olculer = {')
        expect(blok, 'role turu beklenmiyor (await yok)').toContain('await Promise.race([')
        expect(blok, 'beklenen sey refreshTonFee degil').toContain('refreshTonFee()')
        expect(blok, 'bekleme sinirsiz - hang dugmeyi olu birakir')
            .toContain('TON_FEE_PREVIEW_TIMEOUT_MS')
        const at = blok.indexOf('await Promise.race([')
        expect(blok.slice(at), 'await sonrasi tazelik kontrolu yok').toContain('if (isStale()) return')
    })

    // Sinir bir SAYI olmali ve makul bir ust sinirda durmali: cok buyuk bir deger
    // "sinir var" iddiasini kagit uzerinde birakirdi.
    it('onizleme zamanasimi tanimli ve makul', () => {
        const m = SWAP.match(/const TON_FEE_PREVIEW_TIMEOUT_MS = (\d+)/)
        expect(m, 'zamanasimi sabiti tanimli degil').not.toBeNull()
        expect(Number(m[1])).toBeGreaterThan(0)
        expect(Number(m[1]), 'sinir fiilen sinirsiz').toBeLessThanOrEqual(5000)
    })

    // BAYAT EYLEM BIR SONRAKI TURA SIZMAZ (A2'nin diger yarisi): eylem TEK bir
    // teklifi anlatir, yeni tur basladiginda eskisi gonderilecek seyi tarif etmez.
    it('refreshTonFee tur BASINDA eylemi sifirlar', () => {
        const blok = sliceFrom(SWAP, 'const refreshTonFee = async () => {', 200)
        expect(blok, 'tur basinda sifirlama yok').toContain('tonSwapRelayAction.value = null')
    })

    // FAIL-CLOSED KORUNUYOR: bakiye okunamazsa dugme KAPALI kalir.
    //
    // OLCU YERI DEGISTI, IDDIA SERTLESTI: okuyucu artik karar YAZMAZ, yalnizca
    // "okunamadi"yi bildirir; kilidi saf katman verir ve davranissal olarak
    // tonSwapGasNeed.test.js'te olculur. Metin eslesmesi yerine IKI UC de kilitli.
    it('bakiye okunamazsa hala fail-closed', () => {
        const at = SWAP.indexOf("console.error('TON bakiye kontrolu basarisiz:")
        expect(at, 'catch dali yok').toBeGreaterThan(-1)
        expect(SWAP.slice(at, at + 200), 'catch hatayi yutuyor').toContain('okunamadi = true')
        expect(SWAP, 'okunamadi bayragi ekrana baglanmamis').toContain('tonBalanceOkunamadi.value = okunamadi')
        // ...ve bilinmeyen bakiye GERCEKTEN kilitler (saf katman, DAVRANIS).
        expect(tonSwapGasBlocked({ need: 0.3, balance: null, unreadable: true })).toBe(true)
    })
})

// Send ekranindaki eksik-ATS bolumunun TAKAS AYNASI. Ayni bilesen, ayni utils, ayni
// adlar; ayrisirlarsa iki ekran ayni durumda farkli dil konusur (kusur 2).
describe('Takas: eksik ATS bolumu - Send ile ORTAK DIL', () => {
    it('Swap.vue paylasilan bileseni KULLANIR (kendi metnini yazmaz)', () => {
        expect(SWAP, 'AtsShortfallNote import edilmemis').toContain("import AtsShortfallNote from './AtsShortfallNote.vue'")
        expect(SWAP, 'bolum hic cizilmiyor').toContain('<AtsShortfallNote')
        // Metin ve duzen YALNIZ bilesende: ekran kendi kopyasini tutarsa biri
        // duzeltilip digeri geride kalir.
        expect(SWAP, 'kopya metin takas ekranina sizmis').not.toContain('atsShortfallBreakdown')
        expect(SWAP, 'kopya metin takas ekranina sizmis').not.toContain('atsShortfallWhere')
    })

    it('showAtsShortfall kapisi tam (Send ile ayni dort kosul)', () => {
        const def = sliceFrom(SWAP, 'const showAtsShortfall = computed(', 320)
        expect(def, 'kol kapisi yok').toContain('payWithAts.value || tonFeeDecisionActive.value')
        expect(def, 'buy-ats kapisi yok').toMatch(/action === 'buy-ats'/)
        expect(def, 'sayi kontrolu yok').toContain('atsShortfall.value != null')
    })

    it('gereken tutarin kaynagi kola gore AYRISIR (TON budget / takasin kendi ucreti)', () => {
        const def = sliceFrom(SWAP, 'const atsRequiredForShortfall = computed(', 240)
        // TON kolu Send ile BIREBIR ayni: bakiye yetmeyince teklif donmez, tek kaynak budget.
        expect(def, 'TON kolu budget okumuyor').toContain('atsRequiredFromBudget(tonFee.budget.value)')
        // EVM kolu takasa OZGU: useAtsOpFee `requiredAts` dondurmez, karsiligi totalAtsCost.
        expect(def, 'EVM kolu takasin kendi ucretini okumuyor').toContain('totalAtsCost.value')
    })

    it('bakiye ZINCIRDEN okunur - budget.srcBalance KULLANILMAZ', () => {
        const def = sliceFrom(SWAP, 'const atsShortfall = computed(', 240)
        expect(def, 'bakiye zincir okumasindan gelmiyor').toContain('atsFuel.balance.value')
        expect(SWAP, 'srcBalance ekrana sizmis').not.toContain('srcBalance')
        // Yoklukla saglanan iddia tuzagi: okuma GERCEKTEN kuruluyor mu?
        expect(SWAP, 'atsFuel hic yuklenmiyor').toContain('atsFuel.load(active_account.address')
    })

    it('kuru engel satirlari bu bolum cizilirken BASTIRILIR (ikisi ayni seyi soylemesin)', () => {
        // TON engel karti - ConfirmTransaction.vue'daki AYNI bastirma.
        expect(SWAP, 'TON engel kartinda !showAtsShortfall kapisi yok')
            .toMatch(/feeDecision\.severity !== 'internal' && !showAtsShortfall/)
        // ATS-EVM kartinin ic engel blogu.
        expect(SWAP, 'ATS engel blogunda !showAtsShortfall kapisi yok')
            .toMatch(/atsDecision\.severity !== 'internal' && !showAtsShortfall/)
    })

    it('kart yokken kendi kabugunu takar - kapi iki kartin TAM DEGILI', () => {
        const def = sliceFrom(SWAP, 'const shortfallStandalone = computed(', 160)
        expect(def, 'standalone kapisi iki karti da dislamiyor')
            .toContain('!payWithAts.value && !sendWithTonRelay.value')
        expect(SWAP, 'standalone dal hic cizilmiyor')
            .toMatch(/v-if="showAtsShortfall && shortfallStandalone"/)
    })
})
