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

    it('checkTonFeeSufficiency tonSendAmountFits sonucunu insufficientGas a yazar', () => {
        const fn = block(CONFIRM, 'async function checkTonFeeSufficiency')
        // Gorev 1 (ag bazli TON adres onbellegi) sonrasi cagri opts alir; kilit
        // active_account'un hala DOGRU parametre oldugunu, testnet bayraginin da
        // GECTIGINI dogrular.
        expect(fn).toMatch(/ensureTonAddress\(\s*active_account\s*,\s*\{\s*testnet:/)
        expect(fn).toMatch(/getTonBalance\(client,\s*tonAddress\)/)

        // GOREV 13 SONRASI: kontrol jetton/native diye DALLANIYOR. Native dal
        // aynen korunuyor (tonSendAmountFits), jetton dali AYRI bir kapiya
        // (jettonSendFits) gidiyor - jettonda miktar ve ucret AYRI varliklardir
        // ve ikisini ayni bakiyeden dusmek yanlis hesaptir.
        expect(fn).toMatch(/insufficientGas\.value\s*=\s*!tonSendAmountFits\(/)
        expect(fn).toMatch(/insufficientGas\.value\s*=\s*!jettonSendFits\(/)

        // Native dal jetton kapisina, jetton dali native kapisina DUSMEMELI.
        const jettonBranch = fn.slice(fn.indexOf('if (isTonJetton.value) {'), fn.indexOf('} else {'))
        expect(jettonBranch.length).toBeGreaterThan(0)
        expect(jettonBranch).not.toContain('tonSendAmountFits')
    })

    it('bakiye/ucret okumasi PATLARSA fail-closed: insufficientGas true kalir', () => {
        const fn = block(CONFIRM, 'async function checkTonFeeSufficiency')
        const catchBody = fn.match(/catch\s*\(e\)\s*\{([^{}]*)\}/)
        expect(catchBody, 'catch govdesi bulunamadi').toBeTruthy()
        expect(catchBody[1]).toMatch(/insufficientGas\.value\s*=\s*true/)
    })

    it('Onayla dugmesi mevcut feeBlocked/insufficientGas telinden gecer (yeni bir UI dali EKLENMEDI)', () => {
        // insufficientGas EVM'in de kullandigi AYNI degisken; sablondaki "yetersiz ag
        // ucreti" karti (v-if="!isAtsTransfer && insufficientGas && !gasToken") ve
        // feeBlocked (Onayla'yi kilitleyen computed) TON icin de degismeden calisir.
        expect(CONFIRM).toMatch(/const feeBlocked = computed/)
        expect(CONFIRM).toMatch(/insufficientGas\.value\s*&&\s*!gasToken\.value/)
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
