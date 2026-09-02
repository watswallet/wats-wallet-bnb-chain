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

const CONFIRM_TX = stripComments(CONFIRM_TX_RAW)
const SWAP = stripComments(SWAP_RAW)
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

describe('yeni anahtarlar GERCEKTEN kullaniliyor (JSON dolu ama olu kod olmasin)', () => {
    it('tonFeeNoRefund/tonFeePaidOnBsc/tonFeeBurnsWarning ConfirmTransaction.vue da referans aliniyor', () => {
        for (const key of ['tonFeeNoRefund', 'tonFeePaidOnBsc', 'tonFeeBurnsWarning']) {
            expect(CONFIRM_TX, `ConfirmTransaction.vue: ${key} yok`).toContain(key)
        }
    })

    // SWAP.VUE'DA BU ANAHTARLAR OLMAMALI - ve bu, planin en son turunda olculen
    // bir gerilemenin duzeltmesi: Swap.vue'nun TON ucret karti ULASILAMAZDI.
    // Ekran `tonFee.load`u yalniz { sender, tonWallet } ile cagiriyor; useTonFee
    // `tonPublicKey`/`actions` olmadan /quote'a HIC gitmez, `atsMaxFee` kalici
    // olarak null kalir ve kartin kendi kapisi (`... && tonFee.atsMaxFee.value !=
    // null`) ASLA acilmaz. Kart, "iade edilmez" uyarisi ve kehribar "ucret yanar"
    // satiri olu isaretlemeydi; bu dosyanin eski iddialari o olu kodun metnini
    // dogruluyor ve YESIL kaliyordu.
    //
    // Kapiyi "duzeltmek" (eksik alanlari doldurmak) MUMKUN DEGIL: sunucunun
    // olculen eylem sozlesmesinde takas turu YOK ('swap'/'jetton-swap'/'dex'
    // reddediliyor) ve bir takas, dogrulamanin acamadigi dolu bir forward_payload
    // ister. Dogru duzeltme kartin OLMAMASI.
    //
    // ESLENMIS IDDIA (dosya basi notu 2): saf bir `not.toContain` Swap.vue tumden
    // silinse de gecerdi. Yanina, KALMASI GEREKEN seyin varlik iddiasi konur.
    it('Swap.vue: TON ucret karti YOK (ulasilamaz olu isaretlemeydi), engel karti KALDI', () => {
        for (const key of ['tonFeeNoRefund', 'tonFeePaidOnBsc', 'tonFeeBurnsWarning', 'atsMaxFee']) {
            expect(SWAP, `Swap.vue: ${key} geri gelmis - takas relay yolunu KULLANAMAZ`)
                .not.toContain(key)
        }
        // (a) ekran hala TON ucret durumunu okuyor - engel karti bunun uzerinde
        //     yasiyor ve bir /status kesintisi bu ekranda hala soylenmeli.
        expect(SWAP, 'Swap.vue: useTonFee tumden kopmus').toContain('const tonFee = useTonFee()')
        expect(SWAP, 'Swap.vue: TON engel karti da gitmis').toContain('tonFeeDecisionActive')
        // (b) `tonFee.load` teklif ALANLARI OLMADAN cagriliyor - alanlarin
        //     eklenmesi karti geri getirmenin ilk adimi olurdu.
        expect(SWAP, 'Swap.vue: teklif alanlari eklenmis').toContain(
            'tonFee.load({ sender: active_account.address, tonWallet })')
        expect(SWAP, 'Swap.vue: tonPublicKey teklife girmis').not.toContain('tonPublicKey')
        // (c) SEBEP dosyada YAZILI kalmali (yorumlar SIYRILMAMIS kaynakta) -
        //     yoksa kart "eksik" gorunur ve yeniden eklenir.
        expect(SWAP_RAW, 'kartin neden olmadigini anlatan not silinmis')
            .toContain('TAKAS RELAY YOLUNU HIC KULLANAMAZ')
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
        const w = windowAround(CONFIRM_TX, 'tonFeeBurnsWarning')
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

    it('uygunluk: NOT varsa relay YOK, EVM kasasi yoksa relay YOK', () => {
        const def = sliceFrom(CONFIRM_TX, 'const tonRelayEligible = computed(', 200)
        // (a) memo kapisi - `crypto.tonComment` gonderim govdesine giden AYNI alan
        expect(def, 'not (memo) kapisi yok').toContain('crypto.tonComment')
        // (b) EVM kasasi kapisi - arka plandan gelen yanit alani
        expect(def, 'EVM kasasi kapisi yok').toContain('tonFeeEvmCapable.value')
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
        expect(def, 'gercek bakiye kosulu yok').toContain('insufficientGas.value')
    })
})

// 2026-09-01: bakiye yetmeyince ekranda YALNIZ "BSC aginda ATS gerekli" yaziyordu.
// KAC ATS gerektigi hicbir yerde yoktu. Artik ucret ("quote") kartiyla AYNI tasarimda,
// kahraman sayisi EKSIK MIKTAR olan bir kart ciziliyor.
describe('Eksik ATS karti - quote tasarimi, kahraman sayi = eksik miktar', () => {
    it('ConfirmTransaction.vue: showAtsShortfall kapisi tam', () => {
        const def = sliceFrom(CONFIRM_TX, 'const showAtsShortfall = computed(', 320)
        // (a) YALNIZ ATS/TON kollarinda - duz native gonderimde ATS'nin rolu yok
        expect(def, 'kol kapisi yok').toContain('isAtsTransfer.value || tonFeeDecisionActive.value')
        // (b) YALNIZ sunucu "ATS satin al" dediginde
        expect(def, "buy-ats kapisi yok").toMatch(/action === 'buy-ats'/)
        // (c) SAYI YOKSA KART YOK - sayisiz bir "eksik bakiye" karti eskisinden iyi degil
        expect(def, 'sayi kontrolu yok').toContain('atsShortfall.value != null')
    })

    it('kart quote kartiyla AYNI kabugu kullanir (ayri bir gorsel dil acilmamis)', () => {
        const SHELL = 'bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2'
        const card = sliceFrom(CONFIRM_TX, 'v-if="showAtsShortfall"', 260)
        expect(card, 'eksik ATS karti quote kabugunu kullanmiyor').toContain(SHELL)
        // TON ucret karti da AYNI kabuk - ikisi birlikte degisir, ayri ayri degil.
        expect(CONFIRM_TX, 'quote karti kabugu degismis').toContain(SHELL)
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
            expect(CONFIRM_TX, `${key} kodda kullanilmiyor`).toContain(key.split('.').pop())
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
