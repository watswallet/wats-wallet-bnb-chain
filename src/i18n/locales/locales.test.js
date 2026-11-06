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
import { SOLANA_SEND_ERRORS } from '../../utils/solana/sendErrors'
import { RED_FLAG_INSTRUCTIONS } from '../../utils/solana/decodeInstructions'
import { COW_ERROR } from '../../utils/cow/errors'
import { ENGINE_ERROR } from '../../utils/stocks/engines/errors'
import { LOCK_REASON } from '../../utils/cow/config'

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

// HESAP-AG KAPISI ARTIK CIFT YONLU (utils/accountKind.js: accountSupportsChain).
// Ayni uyari hem "TON hesabi Ethereum'a gecemez" hem "EVM hesabi TON'a gecemez"
// durumunda gosteriliyor. TON'u ADIYLA anan bir metin ikinci durumda duz bir
// YALANDIR: kullanicinin hesabi TON hesabi DEGILDIR.
// KULLANICIYA GOSTERILEN METINDE UCUNCU TARAF CUZDAN MARKASI GECMEZ.
//
// Kullanici karari (2026-09-11): arayuzde rakip cuzdan adi anilmasin. Metinler
// "TON cuzdani" gibi jenerik ifadelerle yeniden yazildi. Kilit BURADA cunku
// kacak bir tek metin bile SESSIZCE geri gelir: gorunur metinlerin tamami bu iki
// dosyada yasiyor ve `i18n/index.js` `fallbackLocale: 'en'` ile calisiyor --
// yani bir anahtari yalnizca tr.json'da duzeltmek yetmez, ayni anahtar en.json'da
// kalirsa Turkce arayuz sessizce INGILIZCE (ve markali) metne duser.
//
// KOD YORUMLARI KAPSAM DISI: markanin nicin oyle ele alindigini anlatan yorumlar
// (tonAccount.js, tonMamMnemonic.js, TonKey.vue ...) kullaniciya gorunmez ve
// SILINMEZ -- onlar kararin gerekcesini tasiyor.
describe('ceviri DEGERLERINDE ucuncu taraf cuzdan markasi YOK', () => {
    const YASAKLI = ['tonkeeper']

    it.each([['en', enFlat], ['tr', trFlat]])('%s.json temiz', (_lang, flat) => {
        const kacaklar = []
        for (const [key, value] of flat) {
            if (typeof value !== 'string') continue
            const dusuk = value.toLowerCase()
            for (const marka of YASAKLI) {
                if (dusuk.includes(marka)) kacaklar.push(`${key}: ${value}`)
            }
        }
        expect(kacaklar).toEqual([])
    })

    // EMNIYET KEMERI: yukaridaki test, `flatten` bozulup bos Map dondurse de
    // YESIL kalirdi. Taramanin gercekten metin gordugunu ayrica kanitla.
    it('tarama gercekten calisiyor (bos kume degil)', () => {
        expect(enFlat.size).toBeGreaterThan(100)
        expect(trFlat.size).toBe(enFlat.size)
    })
})

describe('network.accountChainUnsupported hesap turunden BAGIMSIZ', () => {
    const KEY = 'network.accountChainUnsupported'

    for (const [locale, flat] of [['en', enFlat], ['tr', trFlat]]) {
        it(`${locale}.json metni TON u ADIYLA anmaz`, () => {
            expect(flat.get(KEY)).not.toMatch(/\bton\b/i)
        })

        it(`${locale}.json metni zincir adi yer tutucusunu ({name}) korur`, () => {
            expect(flat.get(KEY)).toContain('{name}')
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
    // ONEK KORUMASI. `t('dapps.solana.instruction_' + ad)` gibi bir cagride
    // tirnak icindeki metin bir anahtar DEGIL, bir BIRLESTIRME ONEKIDIR ve
    // sozlukte hicbir zaman tek basina bulunmaz -- ama keyLike'i GECER
    // ('dapps.solana.instruction_' desene uyar). Boyle bir onek yakalanirsa
    // asagidaki "her statik anahtar iki dilde var" testi, gercekte hicbir sey
    // eksik olmadigi halde SONSUZA DEK kirmizi kalir ve kimse duzeltemez.
    // `_` ya da `.` ile biten aday bu yuzden taramaya HIC girmez.
    const isStaticKey = (candidate) =>
        keyLike.test(candidate) && !candidate.endsWith('_') && !candidate.endsWith('.')
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
                if (isStaticKey(qm[2])) {
                    const rel = relative(SRC, file)
                    if (!usedKeys.has(qm[2])) usedKeys.set(qm[2], [])
                    const list = usedKeys.get(qm[2])
                    if (list.length < 3 && !list.includes(rel)) list.push(rel)
                }
            }
        }
    }

    it('birlestirme oneki gibi gorunen aday taramaya GIRMEZ', () => {
        expect(isStaticKey('dapps.solana.instruction_')).toBe(false)
        expect(isStaticKey('history.categories.')).toBe(false)
        expect(isStaticKey('dapps.tonConnect.title')).toBe(true)
    })

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
        // sendErrors.js'in dapp baglayicisi blogu (spec 3.6). Uc onay ekrani da
        // bu anahtarlari `t(resolveSolanaSendError(code))` ile cozer.
        'send.errors.txDeserializeFailed', 'send.errors.unsupportedTxVersion',
        'send.errors.dappFromMismatch', 'send.errors.notASigner',
        'send.errors.missingCosigner', 'send.errors.messageLooksLikeTx',
        'send.errors.messageTooLarge', 'send.errors.wrongCluster',
        'send.errors.blockhashExpired', 'send.errors.tooManyTransactions',
        'send.errors.signInDomainMismatch', 'send.errors.signInAddressMismatch',
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
        // Moralis'in donebildigi diger kategoriler + yerel bekleyen iskeletin
        // kategorileri (processTransaction.js: 'native send' / 'token send').
        // Bunlar EKSIKKEN ekranda ham anahtar yolu goruluyordu; History.vue artik
        // te() ile kontrol edip bilinmeyeni 'transaction'a dusuruyor, ama BILINEN
        // kume iki dilde de kilitli kalmali.
        'history.categories.approve', 'history.categories.bridge',
        'history.categories.native_send', 'history.categories.token_send',
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
        // tokenizedStocks.js ISSUER_INFO: Token.vue $t(xStockInfo.badgeKey / issuerKey)
        'token.bStockBadge', 'token.bStockIssuer',
        'token.xStockBadge', 'token.xStockIssuer',
        // xStocks Al/Sat (stockTrade.js / StockTrade.vue): degiskenle cozulen anahtarlar
        'stockTrade.lock.PRICE_PROTECTION_BUY', 'stockTrade.lock.PRICE_PROTECTION_SELL', 'stockTrade.lock.REFERENCE_MISSING',
        'stockTrade.lock.MARKET_CLOSED', 'stockTrade.lock.MARKET_CLOSED_NOTIME', 'stockTrade.lock.MARKET_UNKNOWN', 'stockTrade.quote.networkFeeLine', 'stockTrade.quote.feeWarning', 'stockTrade.quote.feeWarningBsc', 'stockTrade.hint.amountBelowFee', 'stockTrade.hint.amountMin', 'stockTrade.hint.amountMinNoUsd', 'stockTrade.hint.bscCheap',
        'stockTrade.notice.closed', 'stockTrade.notice.unknown',
        'stockTrade.btn.buy', 'stockTrade.btn.sell', 'stockTrade.btn.approveFirst', 'stockTrade.btn.enterAmount',
        'stockTrade.btn.loading', 'stockTrade.btn.insufficient', 'stockTrade.btn.locked', 'stockTrade.btn.unavailable',
        'stockTrade.btn.retry',
        'stockTrade.approval.none', 'stockTrade.approval.permit', 'stockTrade.approval.onchain', 'stockTrade.approval.unlimited',
        'stockTrade.status.steps.signed', 'stockTrade.status.steps.sent', 'stockTrade.status.steps.searching',
        'stockTrade.status.steps.settling', 'stockTrade.status.steps.done',
        'stockTrade.quote.estimate', 'stockTrade.quote.minimum', 'stockTrade.quote.pay', 'stockTrade.quote.sell',
        'stockTrade.quote.unitPrice', 'stockTrade.quote.reference', 'stockTrade.quote.gap', 'stockTrade.quote.fees',
        'stockTrade.quote.feeNetwork', 'stockTrade.quote.feeCow', 'stockTrade.quote.feeWats', 'stockTrade.quote.feeTotal',
        'stockTrade.quote.poweredBy', 'stockTrade.quote.loading', 'stockTrade.quote.refresh', 'stockTrade.quote.updated',
        // ATS islem ucreti (feeNotice.js feeNoticeOf -> t(notice.key)): anahtar calisma zamaninda secilir
        'stockTrade.atsFee.state.paying', 'stockTrade.atsFee.state.owedLocked', 'stockTrade.atsFee.state.balance',
        'stockTrade.atsFee.state.approval', 'stockTrade.atsFee.state.feeChanged', 'stockTrade.atsFee.state.stuck',
        'stockTrade.atsFee.state.unavailable', 'stockTrade.atsFee.state.paidPending', 'stockTrade.atsFee.state.refundSent',
        'stockTrade.atsFee.state.refundRejected',
        'stockTrade.atsFee.btn.buyAts', 'stockTrade.atsFee.btn.retry', 'stockTrade.atsFee.btn.prepare',
        'stockTrade.atsFee.btn.approve', 'stockTrade.atsFee.btn.decline', 'stockTrade.atsFee.btn.payNow',
    ]

    it('bilinen her dinamik anahtar en.json VE tr.json da var', () => {
        const missing = KNOWN_DYNAMIC_KEYS.filter((k) => !enFlat.has(k) || !trFlat.has(k))
        expect(missing).toEqual([])
    })

    // KOK NEDEN (spec 3.6): SOLANA_SEND_ERRORS tablosuna yeni bir kod
    // eklendiginde yukaridaki ELLE YAZILAN liste sessizce geride kalirdi --
    // tablodaki deger `t(resolveSolanaSendError(code))` ile CALISMA ZAMANINDA
    // cozuldugu icin statik tarama da onu gormez. Bu iddia listeyi tablonun
    // KENDISINE baglar: yeni bir kod eklenip listeye yazilmazsa burasi kizarir.
    it('SOLANA_SEND_ERRORS tablosunun HER degeri bilinen dinamik listede', () => {
        const bilinen = new Set(KNOWN_DYNAMIC_KEYS)
        const eksik = [...new Set(Object.values(SOLANA_SEND_ERRORS))].filter((k) => !bilinen.has(k))
        expect(eksik).toEqual([])
    })

    // xStocks Al/Sat: hata metni COW_ERROR kumesinden TURETILIR; Task 7 sonrasi eklenen kod metinsiz kalamaz.
    it('COW_ERROR kumesinin HER kodu icin stockTrade.error.<KOD> iki dilde var ve bos degil', () => {
        const eksik = Object.values(COW_ERROR).filter((kod) => {
            const key = `stockTrade.error.${kod}`
            return [enFlat, trFlat].some((m) => typeof m.get(key) !== 'string' || m.get(key).trim() === '')
        })
        expect(eksik).toEqual([])
    })

    // bStocks (pancake) motoru: ENGINE_ERROR kumesinin HER kodu icin metin (CoW ortak kodlari yukaridaki testte).
    it('ENGINE_ERROR kumesinin HER kodu icin stockTrade.error.<KOD> iki dilde var ve bos degil', () => {
        const eksik = Object.values(ENGINE_ERROR).concat('NETWORK_GENERIC').filter((kod) => {
            const key = `stockTrade.error.${kod}`
            return [enFlat, trFlat].some((m) => typeof m.get(key) !== 'string' || m.get(key).trim() === '')
        })
        expect(eksik).toEqual([])
    })

    it('bStocks hata metinlerinde CoW gecmez', () => {
        for (const kod of ['NETWORK_GENERIC', 'NO_ROUTE', 'MULTIPLIER_UNREADABLE', 'PRICE_IMPACT_HIGH', 'ATS_BLOCKED', 'SWAP_FAILED', 'CHAIN_UNSUPPORTED']) {
            for (const m of [enFlat, trFlat]) expect(m.get(`stockTrade.error.${kod}`)).not.toMatch(/cow/i)
        }
    })

    it('LOCK_REASON in HER degeri icin stockTrade.lock.<NEDEN> (PRICE_PROTECTION icin _BUY + _SELL) iki dilde var', () => {
        const anahtarlar = Object.values(LOCK_REASON).flatMap((neden) =>
            neden === 'PRICE_PROTECTION'
                ? ['stockTrade.lock.PRICE_PROTECTION_BUY', 'stockTrade.lock.PRICE_PROTECTION_SELL']
                : [`stockTrade.lock.${neden}`])
        const eksik = anahtarlar.filter((k) => !enFlat.get(k) || !trFlat.get(k))
        expect(eksik).toEqual([])
    })

    const yerTutucular = (m, k) => [...String(m.get(k)).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort()

    it('kilit metinleri beklenen yer tutucuyu iki dilde tasir', () => {
        for (const m of [trFlat, enFlat]) {
            expect(yerTutucular(m, 'stockTrade.lock.MARKET_CLOSED')).toEqual(['time'])
            expect(yerTutucular(m, 'stockTrade.lock.PRICE_PROTECTION_BUY')).toEqual(['pct'])
            expect(yerTutucular(m, 'stockTrade.lock.PRICE_PROTECTION_SELL')).toEqual(['pct'])
            expect(yerTutucular(m, 'stockTrade.quote.feeWarning')).toEqual(['pct'])
            expect(yerTutucular(m, 'stockTrade.quote.networkFeeLine')).toEqual(['fee', 'pct'])
        }
    })

    it('stockTrade altindaki HER anahtarin yer tutucu kumesi tr = en', () => {
        const anahtarlar = [...trFlat.keys()].filter((k) => k.startsWith('stockTrade.'))
        expect(anahtarlar.length).toBeGreaterThan(0)
        const farkli = anahtarlar.filter((k) => JSON.stringify(yerTutucular(trFlat, k)) !== JSON.stringify(yerTutucular(enFlat, k)))
        expect(farkli).toEqual([])
    })

    it('Powered by CoW Protocol ibaresi iki dilde AYNEN korunur', () => {
        expect(trFlat.get('stockTrade.quote.poweredBy')).toBe('Powered by CoW Protocol')
        expect(enFlat.get('stockTrade.quote.poweredBy')).toBe('Powered by CoW Protocol')
    })
})

// SOLANA DAPP CEVIRILERI -- TEK AD ALANI + IKI DILLI TAMLIK (spec 8/9).
//
// Mevcut testler UC seyi ZATEN olcuyor: anahtar kumesi esitligi, bos deger,
// ham anahtar yolu ve "bilesenin kullandigi statik anahtar iki dilde var mi".
// OLCMEDIKLERI sey AD ALANI DISIPLINI: `dapps.solanaConnect.title`,
// `dapps.solanaSignTx.title` ve `dapps.solana.title` UCU BIRDEN yesil gecer --
// her biri iki dilde de var oldugu surece. Spec 8 ise TEK ad alani sart
// kosuyor (dapps.tonConnect.* emsali). Bu blok o sarti kilitler.
//
// Gerekli anahtar listesi ELLE TUTULMAZ: dort dosyanin (uc onay ekrani +
// ayarlar/Dapps.vue) KAYNAGINDAN turetilir -- elle liste, ekran yeni bir
// anahtar ekledigi gun sessizce eskir.
describe('Solana dapp cevirileri TEK ad alaninda ve iki dilde TAM', () => {
    const SOLANA_SCREENS = [
        join(SRC, 'components', 'dapp', 'SolanaConnectApprove.vue'),
        join(SRC, 'components', 'dapp', 'SolanaSignTx.vue'),
        join(SRC, 'components', 'dapp', 'SolanaSignMessage.vue'),
        join(SRC, 'components', 'settings', 'Dapps.vue'),
    ]

    // REVIEW TURU 1 (S3): Dapps.vue TON+Solana PAYLASIMLI ayarlar
    // sayfasidir ve mesru sekilde baska ad alanlarindan (orn.
    // dapps.tonConnect.*, TON oturumlarini gostermek icin) anahtar
    // kullanabilir. Onay ekranlarinda (dapp/*) boyle bir kullanim TEK ad
    // alani ihlalidir; ayarlar ekraninda degildir -- asagidaki tarama bu
    // dosyayi ayirir.
    const AYARLAR_DIZINI = join(SRC, 'components', 'settings')

    // Ekran basina ayri kok ACILMAMALI (spec 8: TEK ad alani).
    const YASAK_KOKLER = ['solanaConnect', 'solanaSignTx', 'solanaSignMessage', 'solanaSignIn', 'solanaDapp']

    // REVIEW TURU 1 (S2c): `Array.prototype.find` yalnizca ILK eslesmeyi
    // dondururdu -- birden fazla yasak kok sizarsa geri kalanlari SESSIZCE
    // gizlerdi. `flatMap` + `filter` TUM sapmalari listeler.
    const yasakKokSapmalari = (locale, flat) =>
        YASAK_KOKLER.flatMap((root) =>
            [...flat.keys()].filter((k) => k.startsWith(`dapps.${root}.`)).map((k) => `${locale}: ${k}`)
        )

    // ONEK SUZGECI BU BLOGUN KENDI YARDIMCISIDIR ve adi BILEREK farklidir.
    // Gorev 21'in `isStaticKey`i (ve dayandigi `keyLike`) locales.test.js'te
    // `describe('bilesenlerin/util lerin kullandigi STATIK $t anahtarlari ...')`
    // GERI CAGRIMININ ICINDE bildiriliyor. Bir describe'in yerel `const`i
    // KARDES bir describe'dan GORUNMEZ: oradan cagirmak her kosuda
    // `ReferenceError: isStaticKey is not defined` verirdi. Ayni adi burada
    // yeniden bildirmek de dogru degil -- Gorev 21 yardimciyi ileride modul
    // kapsamina tasirsa iki bildirim carpisirdi.
    const solanaAnahtarGibi = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/
    const statikAnahtarMi = (aday) =>
        solanaAnahtarGibi.test(aday) && !aday.endsWith('_') && !aday.endsWith('.')

    // REVIEW TURU 1 (S2a): Gorev 21'in :152-162 KENDI-KENDINI-KONTROL
    // deseninin bu blok icin karsiligi -- suzgec gercekten oneki eliyor mu,
    // gercek anahtari geciriyor mu. Taramanin kendisi sessizce bozulursa
    // asagidaki testler YANLISLIKLA yesil kalabilirdi.
    it('statikAnahtarMi onekleri eler, gercek anahtari gecirir', () => {
        expect(statikAnahtarMi('dapps.solana.redFlag_')).toBe(false)
        expect(statikAnahtarMi('dapps.solana.siws.')).toBe(false)
        expect(statikAnahtarMi('dapps.solana.title')).toBe(true)
    })

    it('ayarlar bolum basligi IKI dilde de var', () => {
        expect(enFlat.has('settings.dapps.solana_section_title')).toBe(true)
        expect(trFlat.has('settings.dapps.solana_section_title')).toBe(true)
    })

    it('dapps.solana.claimedName IKI dilde de var (Gorev 54 tuketir)', () => {
        expect(enFlat.has('dapps.solana.claimedName')).toBe(true)
        expect(trFlat.has('dapps.solana.claimedName')).toBe(true)
    })

    it('dapps.solana ad alani IKI dilde de var, BOS degil ve anahtar kumeleri AYNI', () => {
        const enKeys = [...enFlat.keys()].filter((k) => k.startsWith('dapps.solana.')).sort()
        const trKeys = [...trFlat.keys()].filter((k) => k.startsWith('dapps.solana.')).sort()
        expect(enKeys.length).toBeGreaterThan(0)
        expect(enKeys).toEqual(trKeys)
    })

    it('dapps altinda ekran basina AYRI bir Solana koku YOK', () => {
        const sapmalar = [...yasakKokSapmalari('en', enFlat), ...yasakKokSapmalari('tr', trFlat)]
        expect(sapmalar).toEqual([])
    })

    // REVIEW TURU 1 (S2c): `yasakKokSapmalari` gercekten TUM sapmalari mi
    // listeliyor -- sentetik bir girdiyle dogrudan sinanir. YASAK_KOKLER'i
    // bosaltan (ya da suzgecin kendisini bozan) bir mutant bu iddiayi
    // KIRMIZI yapmali.
    it('yasakKokSapmalari sentetik girdide dogru sapmayi doner', () => {
        expect(yasakKokSapmalari('x', new Map([['dapps.solanaConnect.title', 'v']]))).toEqual([
            'x: dapps.solanaConnect.title',
        ])
    })

    // REVIEW TURU 1 (S1a): onek tamamlamasi `'dapps.solana.redFlag_' + ix.type`
    // (SolanaSignTx.vue) KAYNAGI RED_FLAG_INSTRUCTIONS'tir (SOLANA_SEND_ERRORS
    // ile ayni desen). Liste ELLE KOPYALANMAZ: yarin bu kumeye bir ad
    // eklenirse (decodeInstructions.js AuthorizeNonceAccount'u ADAY olarak
    // anar) bu test onu ANINDA yakalar -- aksi halde ekran o talimat icin
    // ham anahtar YOLUNU basardi.
    it('RED_FLAG_INSTRUCTIONS taki HER ad dapps.solana.redFlag_ altinda iki dilde', () => {
        expect(RED_FLAG_INSTRUCTIONS.size).toBeGreaterThan(0)
        for (const ad of RED_FLAG_INSTRUCTIONS) {
            expect(enFlat.has('dapps.solana.redFlag_' + ad), ad).toBe(true)
            expect(trFlat.has('dapps.solana.redFlag_' + ad), ad).toBe(true)
        }
    })

    // REVIEW TURU 1 (S1b): onek tamamlamasi `'dapps.solana.siws.' + alan.key`
    // (SolanaSignMessage.vue) KAYNAGI SIWS_ALANLARI dizisidir. Liste ELLE
    // KOPYALANMAZ -- KAYNAKTAN regex ile cikarilir, boylece dizi degisirse
    // (alan eklenir/silinir) bu test ANINDA tepki verir.
    it('SIWS_ALANLARI (SolanaSignMessage.vue KAYNAGINDAN) HER alan dapps.solana.siws altinda iki dilde', () => {
        const src = readFileSync(join(SRC, 'components', 'dapp', 'SolanaSignMessage.vue'), 'utf8')
        const dizi = src.match(/const SIWS_ALANLARI = \[([^\]]*)\]/)
        expect(dizi).not.toBeNull()
        const alanlar = [...dizi[1].matchAll(/'([^']+)'/g)].map((eslesme) => eslesme[1])
        expect(alanlar.length).toBe(12)
        for (const alan of alanlar) {
            expect(enFlat.has('dapps.solana.siws.' + alan), alan).toBe(true)
            expect(trFlat.has('dapps.solana.siws.' + alan), alan).toBe(true)
        }
    })

    it('Solana ekranlarinin kullandigi HER dapps.* anahtari dapps.solana. altinda VE iki dilde', () => {
        const dappsKeyRe = /['"](dapps\.[A-Za-z0-9_.]+)['"]/g
        const kullanilan = new Map() // anahtar -> dosya

        for (const file of SOLANA_SCREENS) {
            // S3: bu dosya ayarlar/Dapps.vue ise yalnizca dapps.solana.*
            // adaylari izlenir -- baska bir dapps.* koku (orn.
            // dapps.tonConnect.*) bu PAYLASIMLI ekranda mesrudur ve
            // "TEK ad alani disinda" diye YANLIS POZITIF vermemelidir.
            const sadeceSolana = file.startsWith(AYARLAR_DIZINI)
            const src = readFileSync(file, 'utf8')
            let m
            dappsKeyRe.lastIndex = 0
            while ((m = dappsKeyRe.exec(src))) {
                // ONEK KORUMASI (yukarida bu describe'in KENDI yardimcisi
                // olarak tanimlanan `statikAnahtarMi`):
                // `$t('dapps.solana.redFlag_' + ix.type)` ya da
                // `$t('dapps.solana.siws.' + alan.key)` gibi bir cagride
                // tirnak icindeki metin bir ANAHTAR DEGIL, birlestirme ONEGIDIR.
                // Filtre olmadan bu iki onek "en.json'da YOK" diye raporlanir ve
                // test SONSUZA KADAR kirmizi kalir: ikisi de literal anahtar
                // olarak var OLAMAZ.
                if (!statikAnahtarMi(m[1])) continue
                if (sadeceSolana && !m[1].startsWith('dapps.solana.')) continue
                if (!kullanilan.has(m[1])) kullanilan.set(m[1], relative(SRC, file))
            }
        }

        // REVIEW TURU 1 (S2b): emniyet kemeri -- regex/dosya yollari
        // bozulursa bu test 0 anahtarla SESSIZCE gecmesin (Gorev 21'in
        // :158-162 desenindeki emniyet kemeriyle AYNI amac).
        expect(kullanilan.size).toBeGreaterThan(0)

        const sapmalar = []
        for (const [key, file] of kullanilan) {
            if (!key.startsWith('dapps.solana.')) sapmalar.push(`${key} (${file}) -- TEK ad alani disinda`)
            else if (!enFlat.has(key)) sapmalar.push(`${key} (${file}) -- en.json'da YOK`)
            else if (!trFlat.has(key)) sapmalar.push(`${key} (${file}) -- tr.json'da YOK`)
        }
        expect(sapmalar).toEqual([])
    })
})

// Analitik bildirim karti + Tercihler metni: kullaniciya "ne gonderiliyor" diyen
// metin iki dilde de GERCEKTEN var olmali (statik tarama bunu zaten yakalar ama
// kartin anahtarlari bilesen yazilmadan once de kilitli dursun).
describe('analitik bildirim karti metinleri', () => {
    const anahtarlar = [
        'analyticsNotice.title', 'analyticsNotice.body', 'analyticsNotice.ok', 'analyticsNotice.turnOff',
        'settings.preferences.analytics', 'settings.preferences.analyticsDesc',
    ]
    it.each(anahtarlar)('%s iki dilde de dolu', (k) => {
        expect(typeof enFlat.get(k)).toBe('string')
        expect(enFlat.get(k).length).toBeGreaterThan(0)
        expect(typeof trFlat.get(k)).toBe('string')
        expect(trFlat.get(k).length).toBeGreaterThan(0)
    })

    // NEDEN: kalici rastgele kimlik "anonim" degil takma adlidir; metin bunu iddia etmesin.
    it('Tercihler basliginda anonim iddiasi yok', () => {
        expect(enFlat.get('settings.preferences.analytics')).not.toMatch(/anonym/i)
        expect(trFlat.get('settings.preferences.analytics')).not.toMatch(/anonim/i)
    })

    // NEDEN: sunucu IP'yi saklamaz ama bu istemci metninin soyleyecegi bir sey degil.
    it('IP iddiasi eklenmemis', () => {
        for (const k of anahtarlar) {
            expect(enFlat.get(k)).not.toMatch(/\bIP\b/)
            expect(trFlat.get(k)).not.toMatch(/\bIP\b/)
        }
    })

    it('tr metinleri -iniz hitabinda (sen/senin yok)', () => {
        for (const k of anahtarlar) expect(trFlat.get(k)).not.toMatch(/\b(senin|sana|sen)\b/i)
    })
})

// Hisse ekrani tohumu (T2): stockDetail.*, stockIssuer.*, home.stocksCertNote.
// Tuketen bilesenler (StockDetail, IssuerSwitch, Home) sonraki gorevlerde gelir.
describe('hisse ekrani i18n tohumu', () => {
    const DETAIL = ['positionTitle', 'positionAmount', 'noPosition', 'send', 'deposit', 'buy', 'sell',
        'infoTitle', 'infoIssuer', 'infoIsin', 'infoNetwork', 'infoContract', 'infoDecimals', 'copy', 'copied',
        'certNote', 'priceSource', 'range7', 'range30', 'range90', 'range365', 'marketOpen', 'marketClosed',
        'chartLoading', 'chartEmpty']
    const ISSUER = ['bstocks', 'xstocks', 'switchLabel']
    const keys = [
        ...DETAIL.map((k) => `stockDetail.${k}`),
        ...ISSUER.map((k) => `stockIssuer.${k}`),
        'home.stocksCertNote',
    ]

    it.each(keys)('%s iki dilde de dolu', (k) => {
        expect(typeof enFlat.get(k)).toBe('string')
        expect(typeof trFlat.get(k)).toBe('string')
        expect(enFlat.get(k).trim()).not.toBe('')
        expect(trFlat.get(k).trim()).not.toBe('')
    })

    it('aralik etiketleri TK8: 7/30/90/365 gun', () => {
        expect(trFlat.get('stockDetail.range7')).toBe('1H')
        expect(trFlat.get('stockDetail.range365')).toBe('1Y')
        expect(enFlat.get('stockDetail.range7')).toBe('1W')
    })

    it('Yatir / Deposit ikincil eylem etiketi (S6)', () => {
        expect(trFlat.get('stockDetail.deposit')).toBe('Yatır')
        expect(enFlat.get('stockDetail.deposit')).toBe('Deposit')
    })

    it('isimsiz sertifika uyarilarinda ihracci adi YOK (TK14)', () => {
        for (const flat of [enFlat, trFlat]) {
            for (const k of ['home.stocksCertNote', 'stockDetail.certNote']) {
                expect(flat.get(k)).not.toMatch(/btech|backed|holdings|jersey|adgm/i)
            }
        }
    })

    it('eski dipnot anahtarlari KALDIRILMADI (T5 tuketimi bitirir)', () => {
        for (const k of ['home.stocksIssuer', 'home.stocksIssuerXstocks', 'home.stocksPriceSource']) {
            expect(enFlat.has(k)).toBe(true)
            expect(trFlat.has(k)).toBe(true)
        }
    })

    it('yer tutuculari iki dilde ayni', () => {
        for (const k of ['stockDetail.positionAmount', 'stockDetail.priceSource']) {
            const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join()
            expect(ph(trFlat.get(k))).toBe(ph(enFlat.get(k)))
        }
    })
})
