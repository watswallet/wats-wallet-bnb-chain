// BULGU 1 (merge engelleyici) — TON'da miktar + ucret payi hicbir yerde bakiyeye
// karsi dogrulanmiyordu. Gonderim modu PAY_GAS_SEPARATELY | IGNORE_ERRORS: tum
// bakiyeyi yazan kullanicida (amount === balance) zincirde compute fazi calisir
// (seqno ARTAR), action fazi ucreti karsilayamaz, mesaj SESSIZCE duser — aliciya
// hicbir sey gitmez, ucret yanar, cuzdan yine de "basarili" gosterirdi (waitForSeqno
// yalniz seqno degisimine bakar).
//
// NEDEN kaynak-metin kilidi: bu depoda bilesen (mount) testi YOK (bkz.
// assetRouteWiring.test.js'in ayni gerekcesi). Saf mantik (tonSendAmountFits)
// tonSend.test.js'te tam kapsamli test edilir; burada kilitlenen sey Send.vue ve
// ConfirmTransaction.vue'nun o fonksiyonu GERCEKTEN cagirdigi ve sonucu dogru
// degiskene/mesaja bagladigidir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const SEND = read('components/Send.vue')
const CONFIRM = read('components/ConfirmTransaction.vue')

/**
 * `anchor` iceren satirdan baslar, kapanisi SATIR BASINDA olan ilk `}` satirinda biter.
 * YORUMLAR ATILIR (assetRouteWiring.test.js ile AYNI desen — bkz. oradaki gerekce).
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

describe('(1) Send.vue: TON miktar dogrulamasi ucret payini kapsar', () => {
    it('tonSendAmountFits gercekten import edilir ve TON dalinda cagrilir', () => {
        expect(SEND).toMatch(/import\s*\{\s*TON_FEE_RESERVE,\s*tonSendAmountFits\s*\}\s*from\s*['"]\.\.\/utils\/ton\/tonSend['"]/)

        const fn = block(SEND, 'watch(amount, new_amount => {', /^\}\)/)
        expect(fn).toMatch(/if\s*\(isTonNetwork\.value\)\s*\{/)
        expect(fn).toMatch(/tonSendAmountFits\(\s*\{\s*amount:\s*new_amount,\s*balance:\s*balance\.value\s*\}\s*\)/)
        expect(fn).toMatch(/isValidAmount\.value\s*=\s*fits/)
    })

    it('EVM dali DOKUNULMADAN kaldi: hala yalniz `amount > balance`', () => {
        // Koordinatorun istegi: "EVM'in kendi kapisi var, ona dokunma." Eski satir
        // AYNEN korunuyor — regresyon bu testi kirar.
        const fn = block(SEND, 'watch(amount, new_amount => {', /^\}\)/)
        const elseIdx = fn.indexOf('} else {')
        expect(elseIdx, 'EVM else govdesi bulunamadi').toBeGreaterThan(-1)
        const evmElseBody = fn.slice(elseIdx)
        expect(evmElseBody).toMatch(/if\s*\(Number\(new_amount\)\s*>\s*Number\(balance\.value\)\)\s*isValidAmount\.value\s*=\s*false/)
        expect(evmElseBody).toMatch(/else\s+isValidAmount\.value\s*=\s*true/)
        expect(evmElseBody).toMatch(/insufficientForFee\.value\s*=\s*false/)
    })

    it('yetersiz-ucret mesaji "yetersiz bakiye" mesajindan AYRI gosterilir', () => {
        expect(SEND).toMatch(/insufficientForFee\s*&&\s*amount"[\s\S]{0,40}send\.insufficientForFee/)
        expect(SEND).toMatch(/send\.insufficientForFee/)
    })

    it('i18n anahtari iki dilde de DOLU', () => {
        for (const locale of ['tr', 'en']) {
            const dict = JSON.parse(read(`i18n/locales/${locale}.json`))
            expect(typeof dict.send.insufficientForFee, locale).toBe('string')
            expect(dict.send.insufficientForFee.length, locale).toBeGreaterThan(0)
        }
    })
})

describe('(2) ConfirmTransaction.vue: TON icin de bakiye/ucret kapisi VAR (eskiden yoktu)', () => {
    it('TON kolunda artik checkEvmGasAndBalance DEGIL, checkTonFeeSufficiency cagrilir', () => {
        const fn = block(CONFIRM, 'onMounted(async', /^\}\)/)
        expect(fn).toMatch(/if\s*\(isTonNetwork\.value\)\s*\{\s*\n\s*await checkTonFeeSufficiency\(\)/)
        // Eski hal REGRESYONU: TON kolunda checkEvmGasAndBalance cagrilirsa ethers
        // JsonRpcProvider(null) ile patlar (network.rpc TON'da null).
        const tonBranch = fn.match(/if\s*\(isTonNetwork\.value\)\s*\{([\s\S]*?)\}\s*else\s*\{/)
        expect(tonBranch, 'TON dali bulunamadi').toBeTruthy()
        expect(tonBranch[1]).not.toMatch(/checkEvmGasAndBalance/)
    })

    it('checkTonFeeSufficiency bakiyeleri OKUR, karari YAZMAZ', () => {
        const fn = block(CONFIRM, 'async function checkTonFeeSufficiency')
        // Gorev 1 (ag bazli TON adres onbellegi) sonrasi cagri opts alir; kilit
        // active_account'un hala DOGRU parametre oldugunu, testnet bayraginin da
        // GECTIGINI dogrular.
        expect(fn).toMatch(/ensureTonAddress\(\s*active_account\s*,\s*\{\s*testnet:/)
        expect(fn).toMatch(/getTonBalance\(client,\s*tonAddress\)/)

        // 2026-09-14: KARAR BU FONKSIYONDAN CIKARILDI. Sebep olculdu -- fonksiyon
        // onMounted'ta `tonFee.load`tan ONCE kosuyor, yani calistigi anda
        // `sendWithTonRelay` HER ZAMAN false. Karari orada yazmak, role modunu
        // HIC goremeyen bir kontrol demekti. Ham bakiyeler ref'e yazilir, karar
        // `tonInsufficient` computed'ine birakilir.
        expect(fn, 'karar hala okuma fonksiyonunda').not.toMatch(/=\s*!tonSendAmountFits\(/)
        expect(fn, 'karar hala okuma fonksiyonunda').not.toMatch(/=\s*!jettonSendFits\(/)
        expect(fn).toMatch(/tonBalanceOkunan\.value\s*=\s*tonBalance/)
        expect(fn).toMatch(/tonJettonBalanceOkunan\.value\s*=\s*jettonBalance/)
    })

    it('tonInsufficient: native/jetton AYRI kapilar, ve IKISI DE role farkindadir', () => {
        const fn = block(CONFIRM, 'const tonInsufficient = computed', /^\}\)/)
        expect(fn.length, 'tonInsufficient bulunamadi').toBeGreaterThan(0)

        // GOREV 13'TEN BERI GECERLI: kontrol jetton/native diye DALLANIR. Jettonda
        // miktar ve ucret AYRI varliklardir; ikisini ayni bakiyeden dusmek yanlis
        // hesaptir.
        expect(fn).toMatch(/!tonSendAmountFits\(/)
        expect(fn).toMatch(/!jettonSendFits\(/)

        // Native dal jetton kapisina, jetton dali native kapisina DUSMEMELI.
        const jettonBranch = fn.slice(fn.indexOf('if (isTonJetton.value) {'), fn.indexOf('return !tonSendAmountFits'))
        expect(jettonBranch.length).toBeGreaterThan(0)
        expect(jettonBranch).not.toContain('tonSendAmountFits')

        // ASIL YENI DEGISMEZ (paymaster cevabi 2026-09-14, bolum 5): role modunda
        // IKI pay da rolecinin cebinden cikar -- jetton'un ilisik TON'u ve duz
        // TON'un ihtiyat payi. Kullanicidan istenirse, hic TON'u olmayan bir
        // kullanici ekranda ATS ucret kartini gorurken "Yetersiz Bakiye" ile
        // kilitlenir; gasless'in amiral gemisi senaryosu tam olarak budur.
        expect(fn).toMatch(/attach:\s*sendWithTonRelay\.value\s*\?\s*0\s*:\s*JETTON_ATTACH_TON/)
        expect(fn).toMatch(/reserve:\s*sendWithTonRelay\.value\s*\?\s*0\s*:\s*TON_FEE_RESERVE/)

        // AMA GONDERILEN TUTAR ROLE MODUNDA DA KULLANICIDAN CIKAR: paylar sifirlanir,
        // bakiye kontrolunun KENDISI kalir -- okunan bakiye iki kapiya da GIRER.
        expect(fn).toMatch(/balance:\s*tonBalance/)
        expect(fn).toMatch(/tonBalance,/)
    })

    it('bakiye/ucret okumasi PATLARSA fail-closed: gonderim ENGELLI kalir', () => {
        const fn = block(CONFIRM, 'async function checkTonFeeSufficiency')
        const catchBody = fn.match(/catch\s*\(e\)\s*\{([^{}]*)\}/)
        expect(catchBody, 'catch govdesi bulunamadi').toBeTruthy()
        expect(catchBody[1]).toMatch(/tonBalanceOkunamadi\.value\s*=\s*true/)
        // Bayragi kaldirmak YETMEZ: karari veren yer de onu OKUMALI. Iki uctan
        // kilitlenmezse bayrak yazilir ama hicbir sey yapmaz.
        const karar = block(CONFIRM, 'const tonInsufficient = computed', /^\}\)/)
        expect(karar).toMatch(/if\s*\(tonBalanceOkunamadi\.value\)\s*return true/)
    })

    it('Onayla dugmesi mevcut feeBlocked telinden gecer (yeni bir UI dali EKLENMEDI)', () => {
        // `nativeBalanceShort` TEK okuma noktasidir: sablondaki "yetersiz ag ucreti"
        // karti, feeBlocked (Onayla'yi kilitleyen computed) ve confirmLabel UCU DE
        // onu okur. Ucu ayri kaynaga baglanirsa buton kapali kalirken kartin
        // cizilmedigi (ya da tersi) bir durum dogar.
        expect(CONFIRM).toMatch(/const feeBlocked = computed/)
        expect(CONFIRM).toMatch(/nativeBalanceShort\.value\s*&&\s*!gasToken\.value/)
        // Kart AYNI kaynagi okumaya devam ediyor. Tam metin SABITLENMIYOR: v-if'e
        // 2026-09-15'te `!tonFeeBlocked` eklendi (bloklayici bir ucret karari ekranda
        // sebebi zaten anlatirken ikinci bir kirmizi kart cizilmesin - "TON alin"
        // yanlis yonlendirmeydi, eksik olan ATS'ti). O kapi bu testin konusu DEGIL;
        // buradaki iddia "kart `nativeBalanceShort`u okur" ve o korunuyor.
        expect(CONFIRM).toMatch(/v-if="!isAtsTransfer &&[^"]*nativeBalanceShort && !gasToken"/)

        // EVM KOLU DOKUNULMADI: TON disinda hala AYNI `insufficientGas` ref'i okunur,
        // yani checkEvmGasAndBalance'in yazdigi deger degismeden gecer.
        expect(CONFIRM).toContain(
            'const nativeBalanceShort = computed(() => isTonNetwork.value ? tonInsufficient.value : insufficientGas.value)')
    })

    it('EVM kolu (else) DOKUNULMADAN kaldi', () => {
        const fn = block(CONFIRM, 'onMounted(async', /^\}\)/)
        expect(fn).toMatch(/\}\s*else\s*\{\s*\n\s*await checkEvmGasAndBalance\(\)/)
    })
})

// BULGU 3 — imza oncesi SON ekranda "Gonderen" satiri eskiden KOSULSUZ
// `shortenAddress(user.address)` (EVM 0x) yaziyordu. Gonderim gercekten dogru
// TON cuzdanindan yapiliyor (arka plan SEND_TON_TRANSACTION'da active_account'in
// TON turevi ile imzalar) — fon kaybi YOK — ama en kritik ekranda "TON'da 0x
// gorunmez" kuralinin en gorunur ihlaliydi.
describe('(3) ConfirmTransaction.vue: "Gonderen" TON da 0x e GERI DUSMEZ', () => {
    it('useDisplayAddress.js:pickDisplayAddress Header/Receive ile AYNI desende kullanilir', () => {
        expect(CONFIRM).toMatch(/import\s*\{\s*pickDisplayAddress\s*\}\s*from\s*['"]\.\.\/composables\/useDisplayAddress['"]/)
        expect(CONFIRM).toMatch(/const fromAddress = computed\(\(\) => pickDisplayAddress\(\{/)
    })

    it('sablonda artik kosulsuz shortenAddress(user.address) YOK; fromAddress kullanilir', () => {
        expect(CONFIRM).not.toMatch(/\{\{\s*shortenAddress\(user\.address\)\s*\}\}/)
        expect(CONFIRM).toMatch(/\{\{\s*fromAddress\s*\?\s*shortenAddress\(fromAddress\)\s*:\s*\$t\('send\.confirmTransaction\.preparingAddress'\)\s*\}\}/)
    })

    it('checkTonFeeSufficiency cozdugu TON adresini tonFromAddress a da yazar (ikinci turetme YOK)', () => {
        const fn = block(CONFIRM, 'async function checkTonFeeSufficiency')
        expect(fn).toMatch(/tonFromAddress\.value\s*=\s*tonAddress/)
    })

    it('i18n anahtari iki dilde de DOLU', () => {
        for (const locale of ['tr', 'en']) {
            const dict = JSON.parse(read(`i18n/locales/${locale}.json`))
            expect(typeof dict.send.confirmTransaction.preparingAddress, locale).toBe('string')
            expect(dict.send.confirmTransaction.preparingAddress.length, locale).toBeGreaterThan(0)
        }
    })
})
