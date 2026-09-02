// EN/TR sozluklerinin GENEL butunlugu.
//
// KOK NEDEN (Task 17 brief): sendErrors.test.js Solana gonderim hata haritasindaki
// anahtarlarin iki dilde de var oldugunu kilitliyor ama SADECE o haritayi kapsiyor.
// Uygulamanin geri kalani (bridge/swap/settings/onboarding/history/...) icin boyle bir
// kilit YOKTU: en.json/tr.json birbirinden kayabilir, bir anahtar bos string olarak
// kalabilir ya da kotu bir birlestirme (merge) bir DEGER yerine ham "send.errors.foo"
// gibi bir anahtar YOLU birakabilirdi -- hicbiri mevcut test setinde YAKALANMAZDI.
//
// Bu dosya UC ayri kaymayi TUM uygulama icin kilitler:
//   1) iki dosya ANAHTAR KUMESI olarak ES olmali (biri digerinde eksikse defect)
//   2) hicbir DEGER bos string olmamali (anahtar var ama gorunmez -- "eksik ceviri"den
//      kullaniciya AYIRT EDILEMEZ ama var/yok kontrolune GORUNMEZ)
//   3) hicbir DEGER ham bir anahtar yolu (orn. "send.errors.foo") olarak KALMAMALI --
//      bu, kotu bir merge'un birakacagi iz
//   4) (best-effort) bilesenlerin/util'lerin KULLANDIGI her STATIK $t/t anahtari HER
//      IKI dilde de bulunmali
//
// SINIR (4) icin: bu tarama yalniz KAYNAKTA DOGRUDAN yazili string literal anahtarlari
// yakalar -- $t(/t( cagrisinin AYNI parantez icinde bir ternary DALI olarak gecen
// literal'leri de yakalar (orn. `t(x === 'a' ? 'foo.bar' : 'foo.baz')`, Send.vue'nun
// assetChainNotice / Swap.vue'nun tokenNotice kartlari boyle yazili). Ama DEGISKEN ya da
// obje-alani ile cozulen anahtarlari (`t(link.labelKey)`, `t(atsDecision.i18nKey)`,
// `t(resolveSolanaSendError(...))`, `t(poisonSourceKey)`, `t(reasonKey)`) VE template
// literal ile kurulan anahtarlari (`` t(`history.categories.${key}`) ``) YAKALAYAMAZ --
// bunlarin deger alani derleme zamaninda degil CALISMA ZAMANINDA (bir degisken, bir API
// sonucu) belli olur. Bu cagri yerleri Task 17 sirasinda kaynagina kadar TEK TEK elle
// izlendi (bkz. asagidaki KNOWN_DYNAMIC_KEYS ve yanindaki not); ileride bu cagrilardan
// biri baska bir anahtara DEGISTIRILIRSE bu test bunu YAKALAMAZ -- yalniz kod incelemesi
// yakalar. KNOWN_DYNAMIC_KEYS listesi en azindan su an BILINEN dinamik anahtar kumesinin
// kendisini iki dilde kilitli tutar.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', '..')

const en = JSON.parse(readFileSync(join(here, 'en.json'), 'utf8'))
const tr = JSON.parse(readFileSync(join(here, 'tr.json'), 'utf8'))

function flatten(obj, prefix = '') {
    return Object.entries(obj).flatMap(([k, v]) => {
        const path = prefix ? `${prefix}.${k}` : k
        return v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, path) : [[path, v]]
    })
}

const enFlat = new Map(flatten(en))
const trFlat = new Map(flatten(tr))

describe('en.json / tr.json anahtar kumesi ES', () => {
    it('en de olup tr de olmayan anahtar YOK', () => {
        const missing = [...enFlat.keys()].filter((k) => !trFlat.has(k))
        expect(missing).toEqual([])
    })

    it('tr de olup en de olmayan anahtar YOK', () => {
        const missing = [...trFlat.keys()].filter((k) => !enFlat.has(k))
        expect(missing).toEqual([])
    })
})

describe('en.json / tr.json degerleri BOS DEGIL', () => {
    for (const [locale, flat] of [['en', enFlat], ['tr', trFlat]]) {
        it(`${locale}.json icinde bos string deger YOK`, () => {
            const empties = [...flat.entries()]
                .filter(([, v]) => typeof v === 'string' && v.trim() === '')
                .map(([k]) => k)
            expect(empties).toEqual([])
        })
    }
})

describe('en.json / tr.json degerleri HAM ANAHTAR YOLU degil', () => {
    // Kotu bir merge/eslesme, DEGER alanina bir ceviriyi degil, ceviri anahtarinin
    // KENDISINI ("send.errors.foo" gibi) birakabilir. Boyle bir deger ekranda ham
    // haliyle gorunur ve dogal metinle (bosluk, noktalama, TR karakterler) KARISTIRILMAZ
    // -- alt cizgi/nokta ile ayrilmis, en az iki seviyeli, sadece kelime karakterlerinden
    // olusan bir string, gercek bir ceviri metni OLAMAZ.
    const rawKeyLike = /^[a-zA-Z]+(\.[a-zA-Z0-9_]+){2,}$/
    for (const [locale, flat] of [['en', enFlat], ['tr', trFlat]]) {
        it(`${locale}.json icinde ham anahtar yoluna benzeyen deger YOK`, () => {
            const suspects = [...flat.entries()]
                .filter(([, v]) => typeof v === 'string' && rawKeyLike.test(v.trim()))
                .map(([k, v]) => `${k} -> "${v}"`)
            expect(suspects).toEqual([])
        })
    }
})

describe('bilesenlerin/util lerin kullandigi STATIK $t anahtarlari iki dilde de var (best-effort)', () => {
    function walk(dir, out) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) walk(full, out)
            else if (entry.name.endsWith('.vue') || entry.name.endsWith('.js')) out.push(full)
        }
    }

    const roots = ['components', 'utils', 'composables'].map((r) => join(SRC, r))
    const files = []
    for (const root of roots) {
        try {
            if (statSync(root).isDirectory()) walk(root, files)
        } catch {
            // dizin yoksa atla
        }
    }

    // $t(/t( cagrisinin acilis parantezinden SONRAKI metni, bir sonraki ')' a kadar
    // (lazy) yakalar. Ic ice bir cagri varsa (orn. `t(resolveSolanaSendError(x), {...})`)
    // bu yakalama ilk ')' da (resolveSolanaSendError'un kapanisinda) durur -- o kesik
    // metinde zaten TIRNAKLI bir anahtar YOKTUR, yani yanlis pozitif URETMEZ, sadece o
    // cagriyi (dogru sekilde) "statik olarak cozulemeyen" biriktirmez.
    const callRe = /(?:\$t|(?<![\w$.])t)\(([\s\S]{0,400}?)\)/g
    const keyLike = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/
    const quoteRe = /(['"])((?:(?!\1)[^\\]|\\.)*)\1/g

    const usedKeys = new Map() // key -> [dosya, dosya, ...] (ilk birkac ornek)

    for (const file of files) {
        if (file.endsWith('.test.js')) continue
        const src = readFileSync(file, 'utf8')
        let m
        callRe.lastIndex = 0
        while ((m = callRe.exec(src))) {
            let qm
            quoteRe.lastIndex = 0
            while ((qm = quoteRe.exec(m[1]))) {
                if (keyLike.test(qm[2])) {
                    const rel = relative(SRC, file)
                    if (!usedKeys.has(qm[2])) usedKeys.set(qm[2], [])
                    const list = usedKeys.get(qm[2])
                    if (list.length < 3 && !list.includes(rel)) list.push(rel)
                }
            }
        }
    }

    it('en az bir kullanim anahtari BULUNDU (taramanin kendisi kirilmamis)', () => {
        // Emniyet kemeri: dosya yollari degisir/tarama bozulursa bu test 0 anahtarla
        // SESSIZCE gecmesin.
        expect(usedKeys.size).toBeGreaterThan(500)
    })

    it('kullanilan HER statik anahtar en.json VE tr.json da var', () => {
        const missing = []
        for (const [key, sampleFiles] of usedKeys) {
            const inEn = enFlat.has(key)
            const inTr = trFlat.has(key)
            if (!inEn || !inTr) {
                missing.push(`${key} (orn: ${sampleFiles.join(', ')}) -- en:${inEn} tr:${inTr}`)
            }
        }
        expect(missing).toEqual([])
    })
})

describe('bilinen DINAMIK $t anahtarlari (degisken/template-literal ile cozulur, statik taramada YAKALANAMAZ)', () => {
    // Task 17 sirasinda kaynagina kadar elle izlenip dogrulanan dinamik cagri yerleri.
    // Bu liste otomatik URETILEMEZ (degeri calisma zamaninda belli olur) ama KENDISI
    // iki dilde kilitli tutulabilir -- ileride biri bu haritalardan bir anahtari
    // silerse (ekleme degil, mevcut bir anahtarin KALDIRILMASI) bu test kizarir.
    const KNOWN_DYNAMIC_KEYS = [
        // sendErrors.js SOLANA_SEND_ERRORS degerleri (ayrica sendErrors.test.js'te
        // kaynaktan TURETILEREK kilitli; burada sadece iki dilde var oldugu kontrol edilir)
        'send.errors.invalidSolanaAddress', 'send.recipientNotWallet', 'send.errors.selfTransfer',
        'send.errors.amountNotPositive', 'send.errors.amountExceedsPrecision', 'send.errors.amountTooLarge',
        'send.errors.blockhashRequired', 'send.errors.ataRentRequired', 'send.errors.generic',
        'send.errors.walletLocked', 'send.solanaUnsupportedAccount', 'send.errors.rpcTimeout',
        'send.feeUnavailable',
        // useAddressSecurity.js POISON_SOURCE_KEYS (SecurityWarning.vue: $t(poisonSourceKey))
        'send.poisoning.sourceAccount', 'send.poisoning.sourceSaved',
        'send.poisoning.sourceSent', 'send.poisoning.sourceHistory',
        // AtsFuelPill.vue reasonKey
        'header.fuel.notEnoughForOne', 'header.fuel.none',
        // atsBlocker.js i18nKey/i18nDescKey (Bridge/ConfirmTransaction/Swap.vue: atsDecision.i18nKey)
        'send.confirmTransaction.atsChainPaused', 'send.confirmTransaction.atsRemoteNotReady',
        'send.confirmTransaction.atsRateStale', 'send.confirmTransaction.atsForeignDelegation',
        'send.confirmTransaction.atsSrcBalanceMissing', 'send.confirmTransaction.atsBalanceMissing',
        'send.confirmTransaction.atsOnboardingNeeded', 'send.confirmTransaction.atsBudgetLow',
        'send.confirmTransaction.atsNativeValueTitle', 'send.confirmTransaction.atsNativeValueDesc',
        'send.confirmTransaction.atsRouteUnreadable', 'send.confirmTransaction.atsOnboardingUnavailable',
        'send.confirmTransaction.atsOnboardingUnavailableDesc', 'send.confirmTransaction.atsTemporary',
        'send.confirmTransaction.atsServerError',
        // Dapp.vue method map: t(`send.confirmTransaction.${key}`)
        'send.confirmTransaction.method_transfer', 'send.confirmTransaction.method_approve',
        'send.confirmTransaction.method_transferFrom', 'send.confirmTransaction.method_safeTransferFrom',
        'send.confirmTransaction.method_setApprovalForAll', 'send.confirmTransaction.method_mint',
        'send.confirmTransaction.method_swap', 'send.confirmTransaction.method_coinToToken',
        'send.confirmTransaction.method_tokenToCoin', 'send.confirmTransaction.method_multicall',
        'send.confirmTransaction.method_addLiquidity', 'send.confirmTransaction.method_removeLiquidity',
        'send.confirmTransaction.method_deposit', 'send.confirmTransaction.method_withdraw',
        'send.confirmTransaction.method_stake', 'send.confirmTransaction.method_unstake',
        'send.confirmTransaction.method_claim',
        // History.vue: t(`history.categories.${categoryKey}`) / ${tx.direction === 'out' ? 'send' : 'receive'}
        'history.categories.token_swap', 'history.categories.swap_detail', 'history.categories.send',
        'history.categories.receive', 'history.categories.transaction', 'history.categories.selfTransfer',
        // settings/About.vue: t(link.labelKey)
        'settings.about.link_website', 'settings.about.link_privacy', 'settings.about.link_terms',
        // SecurityWarning.vue flagLabel(): te() ile korunuyor (bilinmeyen bayrak ham
        // ad olarak duser, ekran KIRILMAZ) -- yine de bilinen tam kume burada kilitli.
        'send.reputation.flags.phishing_activities', 'send.reputation.flags.stealing_attack',
        'send.reputation.flags.blackmail_activities', 'send.reputation.flags.sanctioned',
        'send.reputation.flags.blacklist_doubt', 'send.reputation.flags.money_laundering',
        'send.reputation.flags.financial_crime', 'send.reputation.flags.cybercrime',
        'send.reputation.flags.darkweb_transactions', 'send.reputation.flags.fake_kyc',
        'send.reputation.flags.malicious_mining_activities', 'send.reputation.flags.mixer',
        'send.reputation.flags.honeypot_related_address', 'send.reputation.flags.fake_token',
        'send.reputation.flags.gas_abuse', 'send.reputation.flags.number_of_malicious_contracts_created',
    ]

    it('bilinen her dinamik anahtar en.json VE tr.json da var', () => {
        const missing = KNOWN_DYNAMIC_KEYS.filter((k) => !enFlat.has(k) || !trFlat.has(k))
        expect(missing).toEqual([])
    })
})
