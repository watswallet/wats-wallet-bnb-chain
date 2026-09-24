// TON ucret akisinin YONETMENI: sirayi bilen TEK dosya (design bolum 5, gorev 6 brief'i
// adim 1-11).
//
// Bu dosya kendi basina hicbir guvenlik/HTTP/depolama karari URETMEZ - bes modulun her biri
// (T1-T5) zaten kendi isini yapiyor; burasi yalniz onlari, kullanicinin parasini koruyan
// SIRADA cagirir. Iki sira kurali pazarlik disi (brief):
//   dogrulama (6) HER IKI imzadan (7,8) ONCE  - reddettigimiz bir govdeyi zaten imzalamis
//                                                olmayalim.
//   makbuz (9) relay'den (10) ONCE, DISKE     - relay tam o anda SW'i olduruyorsa, diskte
//                                                yazili olmayan bir ucret hicbir zaman
//                                                kurtarilamaz.
//
// UCUNCU SIRA KURALI (gorev 10) CAGIRANDA: basarida makbuzu BU DOSYA SILMEZ. Once islem
// durumu 'success' yazilir, SONRA makbuz silinir - ters sirada SW aradan olurse islem
// 'processing'te makbuzsuz kalir, ki bu yetim taramasinin imzasidir ve ucreti alinmis bir
// islemi "ucret alinmadi" diye etiketler. Bu dosya `{ status, settlementKey }` dondurup
// karari cagirana birakir.
//
// Gercek imzalayanlar `signers` ile ENJEKTE edilir: boylece bu dosyanin sirasi gercek bir
// kasa acilmadan olculebilir - kasa acan bir yonetmen sira icin test edilemezdi ve sira bu
// dosyanin var olma sebebidir. Cagiran (background.js:tonRelayExecute) o fonksiyonlari
// gercek ed25519/secp256k1 anahtarlariyla doldurur.
import { Address } from '@ton/core'
import { findVaultForAccount } from '../deriveAccount'
import { accountHasEvm } from '../accountKind'
import { readTonFeeStatus, tonFeeRelayActive } from './tonFeeStatus'
import { tonFeeQuote, tonFeeRelay } from './tonFeeClient'
import { verifyTonQuote } from './tonQuoteVerify'
import { settlementDispositionFor } from './tonFeeBlocker'
import { withKeepAlive } from './swKeepAlive'
import {
    saveTonSettlement,
    updateTonSettlement,
    clearTonSettlement,
    hasUnsettledTonFee,
    loadAllTonSettlements,
    tonSettlementKey,
} from './tonFeeSettlement'
import { TON_FEE_DOMAIN, TON_FEE_AUTH_TYPES } from './tonFeeConfig'

export class TonRelayerError extends Error {
    constructor(code) {
        super(code)
        this.name = 'TonRelayerError'
        this.code = code
    }
}

function fail(code) {
    throw new TonRelayerError(code)
}

// `findVaultForAccount` SAFTIR (chrome/crypto'ya dokunmaz, gercek sirri ACMAZ) - burada tek
// soru "bu hesap icin BSC tarafinda imzalayacak bir kasa var mi". Gercek imza zaten
// `signers.evmSignTypedData` uzerinden, bu dosyanin disinda gelir; bu fonksiyon anahtar
// gormez, yalniz varligi olcer.
// DISA ACIK (gorev 10 inceleme turu 1): arayuz de AYNI yuklemi sorabilmeli. TON'a
// kilitli bir hesapta relay secenegini GONDERIM ANINDA reddetmek, kullaniciyi
// donebilecegi bir secenegi olmayan bir cikmaza sokuyordu - karar ekranda, kart
// cizilmeden once verilmeli. Iki ayri "EVM anahtari var mi" mantigi yazilsaydi
// kacinilmaz sekilde ayrisirlardi: arayuz secenegi gosterir, arka plan reddederdi.
//
// HESAP TURU KAPISI 2026-09-05'te BURADAN KALKMISTI (tasarim belgesi §2.1):
// yerel bir EVM-uyumlu-turler kumesi vardi, o `accountHasEvm`in ikinci bir
// yazimiydi ve "tek ayirt edici `account.type`" cumlesini YANLIS kiliyordu.
// Tek kaynak `utils/accountKind.js`: yeni bir hesap turu oraya eklendiginde
// bu dosya da otomatik olarak dogru cevabi verir.
//
// DUZELTME (2026-09-10, inceleme turu 2): bir onceki tur burada dogrudan
// `account?.type === 'ton'` kontrolu vardi -- accountKind.js'teki bir spec
// olcum hatasina dayaniyordu ("ice aktarilan TON hesabinin da EVM'i var"
// sanilmisti). Olculdu: yanlisti. `type:'ton'` artik hicbir akis URETMIYOR,
// kalan kayitlarin GERCEKTEN BSC'de imzalayacak bir anahtari yok
// (accountKindsOf duzeltildi). `accountHasEvm` bu yuzden dogru soruyu
// soruyor VE fail-closed'i dogrudan tip kontrolunden DAHA IYI koruyor:
// bilinmeyen turde `false` doner. Dogrudan tip kontrolu bilinmeyen tipi
// yanlislikla "relay secenegi sunulabilir" sayardi.
export function evmVaultResolvable(vaults, account) {
    if (!accountHasEvm(account)) return false
    return !!findVaultForAccount(vaults, account)
}

// AYNI cuzdanin EQ.../UQ.., bounce eden/etmeyen birden fazla GECERLI yazimi var. Quote'a bir
// yazim, makbuza baska bir yazim gidip biri digeriyle aranirsa, kayit "bulunamaz" ve odenmis
// ucret KALICI OLARAK kaybolur (T5 incelemesinin bulgusu - tonSettlementKey tonWallet'i
// normallestirmiyor). Bu yuzden TEK bir bicim burada, TEK yerde sabitlenir; asagida quote
// govdesine VE makbuza AYNI degisken verilir - ne biri ne digeri kendi basina yeni bir
// tonWallet dizesi turetir.
function canonicalTonWallet(raw) {
    return Address.parse(String(raw)).toString({ bounceable: false })
}

// MV3 service worker'inde `Buffer` global DEGIL ama bu depoda (bkz. tonAccount.js) polyfill
// ile kullaniliyor - ed25519 imzalayici (signers.tonSign) ham bayt istiyor, hex string degil.
function actionHashBuffer(hex) {
    return Buffer.from(String(hex ?? '').replace(/^0x/i, ''), 'hex')
}

// signers.tonSign ham bayt DONER (Buffer/Uint8Array, brief'in kendi arayuz notu). Bu deger
// TEK yerde, TEK kez '0x' onekli hex string'e cevrilir - hem /relay govdesine hem diskteki
// makbuza GIDECEK deger budur. Cevrilmeseydi JSON.stringify bir Buffer'i
// {"type":"Buffer","data":[...]} olarak yazardi: /relay govdesinde kardesi
// `feeAuthSignature` ('0x...' string) ile TUTARSIZ bir sekil olusur, ve chrome.storage.local
// de ayni nesneyi diske yazar - kilitliyken calismasi GEREKEN kurtarma (Task 7) diskten
// bayt degil bir nesne okur (review bulgusu 2).
function toHexSignature(rawSignature) {
    return '0x' + Buffer.from(rawSignature).toString('hex')
}

// EYLEM KAPISI. Sunucunun OLCULEN sozlesmesinde (design 2.2) `kind` yalniz 'ton' ve
// 'jetton'; TANIMADIGI bir alani da REDDEDER (`actions[0].amountNano bilinmiyor`).
// Buradan gecen her eylem, verifyTonQuote'un govdede karsiligini DOGRULAYABILDIGI bir
// eylem olmali - dogrulanamayan bir turu sessizce gecirmek, kapiyi atlatan bir yol acar.
//
// TON TAKASI HALA GECMEZ, ama SEBEBI DEGISTI (2026-09-15). Eskiden parseJettonBody
// DOLU bir forward_payload'da kosulsuz duserdi; artik dusmuyor - hash'ini disari
// veriyor. Takasi kapali tutan sey simdi V5: karsilastirilan hucre BIZIM kurdugumuz
// YORUM hucresidir, yani bir DEX yonlendirici yuku hicbir niyetle eslesemez. Ayrica
// sunucunun anlamsal eylem listesi de takasi hala ifade edemiyor (forwardTonNano /
// forwardPayloadBoc alanlari bu kumelerde YOK).
//
// BOS ya da DIZI-OLMAYAN `actions` da AYNI kapidan gecmeli: `Array.isArray(actions) ?
// actions : []` gibi bir "yumusatma" bos diziye duser, dongu HIC calismaz ve "sorun yok"
// sanilir. Bu bosluk zararsiz degil - verifyTonQuote'un V5'i de intent.actions=[]'i
// payload.messages.length===0 ile ESLESTIRIR, yani SIFIR eylemli bir W5 govdesi HER
// kontrolden gecer, iki imza uretilir ve relay hicbir sey yapmayan bir govde icin ~18 ATS
// tahsil eder (review bulgusu 1). Bu yuzden dizi-olmayan/bos `actions` de FIRLATIR.
const doluAlan = (v) => v !== undefined && v !== null && String(v).trim() !== ''

// TANIDIGIMIZ ALANLARIN TAMAMI. `quoteAction` eylemi bu listeden yeniden kurdugu icin
// listede OLMAYAN bir alan /quote'a HIC gitmez: sunucu onsuz bir govde kurar ve V5 o
// govdeyi "niyetle birebir" diye DOGRULAR. Yani sessiz dusurme, dogrulamanin
// goremedigi bir NIYET SAPMASIDIR ve bedeli somut - memosuz bir borsa yatirimi KAYIP
// sayilir (bkz. jettonTransfer.js kapi 1). Bu yuzden bilinmeyen alan yok sayilmaz,
// FIRLATIR; yorum destegi geldiginde de kazara bir alanin beyaz listeden sizmasiyla
// degil, BILEREK gelir.
// `comment` 2026-09-14'te duz TON'a, 2026-09-15'te JETTON'a EKLENDI. Once ikisinde de
// yoktu ve eksikligi bir VARSAYIMA dayaniyordu: "sunucunun anlamsal eylem
// sozlesmesinde yorum alani YOK". Varsayim YANLISTI -- `kind:'ton'` ilk gunden beri
// bir `comment` alani tasiyor. Jetton icin de AYIRT EDICI bir olcum yapildi
// (2026-09-15, canli sunucu): ayni istege eklenen `comment` KABUL, `gasTonNano`
// REDDEDILDI ("actions[0].gasTonNano is unknown") -- yani kapi gercekten ayirt
// ediyor ve kabul bir yanilsama degil. Notlu gonderimi rolede yasaklayan kisit
// bizim tarafimizda, olculmemis bir inanctan ibaretti.
//
// HER IKI KEZ DE ONCE DOGRULAMA ACILDI, SONRA ALAN. tonQuoteVerify V5 yorum
// hucresini KENDI kurup hash'ini karsilastiriyor: duz TON'da govdenin kendisiyle
// (`bodyHash`), jettonda TEP-74 forward_payload'iyla (`forwardPayloadHash`). Alani
// dogrulamadan eklemek, bu dosyanin var olma sebebini (dogrulanamayani gecirmemek)
// ihlal ederdi.
const TON_ACTION_KEYS = new Set(['kind', 'to', 'amountNano', 'comment'])
// `forwardTonNano` ve `forwardPayloadBoc` 2026-09-15'te EKLENDI - TON TAKASINI
// gazsiz yapan iki alan. Jetton->jetton takas, TEP-74 govdesinde router'a giden
// bir transferdir: `to` router, yuk ise DEX'in swap talimatidir. Ikisi de AYIRT
// EDICI bir olcumle dogrulandi (ayni turda `gasTonNano` ve uydurma bir alan
// "is unknown" ile REDDEDILDI, bunlar gecti).
const JETTON_ACTION_KEYS = new Set([
    'kind', 'to', 'amount', 'jettonMaster', 'jettonWallet', 'comment',
    'forwardTonNano', 'forwardPayloadBoc',
])
// `raw` 2026-09-14'te EKLENDI -- TonConnect dapp mesajlarini ifade etmenin TEK yolu.
// `ton`/`jetton` ANLAMSAL turlerdir (ne oldugunu biliriz); `raw` ise HAM bir govde
// tasir ve ne yaptigini BILMEYIZ. Bu yuzden iki ek kural:
//   - `payloadBoc` VARSA hedef sunucunun router beyaz listesinde olmali (sunucu
//     zorluyor: ton-payload-not-allowed). Bu kapinin ISTEMCI yarisi cagiranda
//     (TonSendTx.vue) -- kullaniciya odeyemeyecegi bir ucret GOSTERMEMEK icin.
//   - `stateInit` YOK ve olmayacak: sunucu reddediyor, cunku var olan her kontratin
//     adresi kendi ilk StateInit'inin hash'idir; alan relayer'in TON'unu beyaz liste
//     disina akitabilirdi.
const RAW_ACTION_KEYS = new Set(['kind', 'to', 'amountNano', 'payloadBoc', 'gasTonNano', 'bounce'])

function assertOnlyKnownKeys(action, izinli) {
    for (const alan of Object.keys(action)) {
        if (!izinli.has(alan)) fail('TON_RELAY_UNSUPPORTED_ACTION')
    }
}

function assertSupportedActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) fail('TON_RELAY_UNSUPPORTED_ACTION')
    for (const a of actions) {
        if (!doluAlan(a?.to)) fail('TON_RELAY_UNSUPPORTED_ACTION')
        if (a?.kind === 'ton') {
            assertOnlyKnownKeys(a, TON_ACTION_KEYS)
            if (!doluAlan(a.amountNano)) fail('TON_RELAY_UNSUPPORTED_ACTION')
        } else if (a?.kind === 'raw') {
            assertOnlyKnownKeys(a, RAW_ACTION_KEYS)
            // `doluAlan` DEGIL: raw'da "0" GECERLI bir tutardir ve dapp mesajlarinin
            // cok yaygin sekli tam olarak budur (0 TON + yuk). `kind:'ton'` sifiri
            // reddetmeye devam eder -- orada "sifir TON gonder" anlamsizdir.
            if (!/^\d+$/.test(String(a.amountNano ?? ''))) fail('TON_RELAY_UNSUPPORTED_ACTION')
            // Yuk VARSA gaz payi ZORUNLU (sunucu kurali): hedef kontratin gazini
            // relayer fonlar. Yuk yoksa gaz payi ANLAMSIZ ve gonderilmez.
            if (doluAlan(a.payloadBoc)) {
                if (!/^\d+$/.test(String(a.gasTonNano ?? ''))) fail('TON_RELAY_UNSUPPORTED_ACTION')
            } else if (a.gasTonNano !== undefined) {
                fail('TON_RELAY_UNSUPPORTED_ACTION')
            }
        } else if (a?.kind === 'jetton') {
            assertOnlyKnownKeys(a, JETTON_ACTION_KEYS)
            if (!doluAlan(a.amount)) fail('TON_RELAY_UNSUPPORTED_ACTION')
            if (!doluAlan(a.jettonMaster)) fail('TON_RELAY_UNSUPPORTED_ACTION')
            // `jettonWallet` GONDERENIN kendi jetton cuzdanidir ve HANGI tokenin
            // gittigini belirleyen tek alandir (govdedeki dis hedef odur). Zincirden
            // turer (jettonAddress.js), saf dogrulayici HESAPLAYAMAZ - cagiran tasimazsa
            // gonderilen token dogrulanamaz ve kapali tarafa duseriz.
            if (!doluAlan(a.jettonWallet)) fail('TON_RELAY_UNSUPPORTED_ACTION')
            // AYNI SLOT: TEP-74'te forward_payload TEKTIR. Sunucu da birlikte
            // gonderilmesini reddediyor ("comment and forwardPayloadBoc cannot be
            // given together"). Istemci ONCE duser - sunucunun reddedecegi bir
            // istegi gondermek, kullaniciya odeyemeyecegi bir ucret gosterme
            // riskidir.
            if (doluAlan(a.comment) && doluAlan(a.forwardPayloadBoc)) fail('TON_RELAY_UNSUPPORTED_ACTION')
            // YUK VARSA FORWARD PAYI ZORUNLU ve POZITIF. Sunucunun varsayilani
            // 1 nanoton ve o bir DEX cagrisini FONLAMAZ: swap router'da gazsiz
            // kalir, zincirde SESSIZCE duser -- ucret ise coktan alinmistir.
            // Sozlesme (ss04) alt siniri acikca bize birakiyor: "Backend alt sinir
            // dayatmaz; DEX'in istedigi duzeye siz cikarin".
            if (doluAlan(a.forwardPayloadBoc) && !doluAlan(a.forwardTonNano)) {
                fail('TON_RELAY_UNSUPPORTED_ACTION')
            }
            // Bicim her durumda denetlenir: `String(undefined)` sunucuya
            // 'undefined' gonderirdi, negatif/ondalikli deger ise sunucuda
            // "must be a positive integer string" ile duserdi.
            if (a.forwardTonNano !== undefined) {
                if (!/^\d+$/.test(String(a.forwardTonNano ?? ''))) fail('TON_RELAY_UNSUPPORTED_ACTION')
                if (BigInt(a.forwardTonNano) <= 0n) fail('TON_RELAY_UNSUPPORTED_ACTION')
            }
        } else {
            fail('TON_RELAY_UNSUPPORTED_ACTION')
        }
    }
}

// /quote govdesi eylem eylem KURULUR, `actions` oldugu gibi gecirilmez. Iki sebep:
//   1. `jettonWallet` yalniz ISTEMCININ dogrulama girdisidir; sunucu tanimadigi alani
//      reddettigi icin gonderilmesi istegi tumden dusururdu.
//   2. Tutar bigint olabilir ve JSON.stringify bigint'te FIRLATIR - istek ag katmanina
//      hic ulasmadan patlardi. Tutar TEK yerde dizgeye cevrilir.
// BOS YORUM GONDERILMEZ ve normalizasyon TEK YERDE. `buildTonTransfer` /
// `buildJettonTransferBody` de bos notu govdeye koymuyor -- alani bos dizeyle
// gondermek sunucuya BOS bir yorum hucresi kurdurabilir ve o zaman dogrulamanin
// bekledigi hash (null) ile gelen hash (bos hucre) AYRISIR: GECERLI bir gonderim
// reddedilirdi. Iki kol (ton/jetton) AYNI dizeyi uretmek ZORUNDA, cunku V5 her
// ikisinde de bu dizeden kurulan hucrenin hash'ini karsilastiriyor; iki kopya
// zamanla ayrisirdi. `trim()` cagiranin uyguladigi normalizasyonla AYNI.
const relayComment = (a) => (typeof a?.comment === 'string' ? a.comment.trim() : '')

function quoteAction(a) {
    if (a.kind === 'jetton') {
        const jetton = { kind: 'jetton', jettonMaster: String(a.jettonMaster), to: String(a.to), amount: String(a.amount) }
        const jNot = relayComment(a)
        if (jNot) jetton.comment = jNot
        // TAKAS ALANLARI. Kapilar yukarida: yuk varsa pay ZORUNLU, yorumla
        // BIRLIKTE olamaz. Burada yalniz tasinirlar - tutar TEK yerde dizgeye
        // cevrilir (bigint'te JSON.stringify FIRLATIR).
        if (doluAlan(a.forwardPayloadBoc)) jetton.forwardPayloadBoc = String(a.forwardPayloadBoc)
        if (doluAlan(a.forwardTonNano)) jetton.forwardTonNano = String(a.forwardTonNano)
        return jetton
    }
    if (a.kind === 'raw') {
        // `bounce` NIYETTEN gelir ve HER ZAMAN acikca gonderilir. Sunucunun
        // varsayilani "yuk varsa true" -- ayni degeri uretir, ama varsayilana
        // guvenmek degerin sunucuda degismesiyle sessizce ayrisirdi. Dogrulama da
        // bu alani karsilastiriyor (V5), yani gonderilmezse karsilastirma bos
        // olurdu.
        const raw = { kind: 'raw', to: String(a.to), amountNano: String(a.amountNano), bounce: !!a.bounce }
        if (doluAlan(a.payloadBoc)) {
            raw.payloadBoc = String(a.payloadBoc)
            raw.gasTonNano = String(a.gasTonNano)
        }
        return raw
    }
    const ton = { kind: 'ton', to: String(a.to), amountNano: String(a.amountNano) }
    const not = relayComment(a)
    if (not) ton.comment = not
    return ton
}

/**
 * TON ucret akisinin yonetmeni. Sira gorev 6 brief'indeki 11 adimla BIREBIR: hicbir adim
 * atlanmaz, hicbiri yer degistirmez. `signers` gercek imzalayanlarin YERINE gecen enjekte
 * edilmis fonksiyonlardir; bu fonksiyonun KENDISI hicbir ozel/master anahtari ACMAZ - yalniz
 * `vaults`/`account` uzerinden BSC tarafinda imzalayacak bir kasanin VAR OLUP olmadigina
 * bakar (adim 3).
 *
 * @param {object} args
 * @param {object} args.account  aktif hesap (EVM adresi `account.address`'te)
 * @param {object[]} args.vaults  tum kasalar (yalniz varlik kontrolu icin, adim 3)
 * @param {CryptoKey} [args.masterKey]  BURADA KULLANILMAZ - gercek imza `signers` uzerinden
 *   gelir; parametre yalniz cagiranin arayuzuyle simetri icin kabul edilir.
 * @param {Array<{kind:'ton', to:string, amountNano:string|bigint, comment?:string}
 *          |{kind:'jetton', to:string, amount:string|bigint, jettonMaster:string,
 *            jettonWallet:string, comment?:string, forwardTonNano?:string|bigint,
 *            forwardPayloadBoc?:string}>} args.actions
 *   `jettonWallet` GONDERENIN kendi jetton cuzdanidir: /quote govdesine GITMEZ, yalniz
 *   verifyTonQuote'un "hangi token" dogrulamasinin girdisidir.
 * @param {object} args.intent  verifyTonQuote'un beklegi sekil (tonWallet, tonPublicKey,
 *   seqno, now, ...) - `actions`/`approvedAtsFee` BURADA tekrar edilmez, asagida tek
 *   kaynaktan (parametreler) eklenir.
 * @param {bigint|string} args.approvedAtsFee  kullanicinin onayladigi ust sinir
 * @param {string} [args.txId]  makbuza yazilir; kurtarma/arayuz bu islemle eslestirir
 * @param {{tonSign: Function, evmSignTypedData: Function}} args.signers
 * @returns {Promise<object>} /relay yaniti + `settlementKey` + `status`
 *   ('sent' = govde DOLU bir 2xx, cagiran islem durumunu 'success' yazip SONRA makbuzu
 *   silebilir; 'unconfirmed' = bos/null 2xx, BELIRSIZ - cagiran ne durum yazar ne siler,
 *   karari kurtarma verir)
 * @throws {TonRelayerError} TON_RELAY_UNAVAILABLE | TON_RELAY_NO_EVM_VAULT |
 *   TON_RELAY_PENDING_SETTLEMENT | TON_RELAY_UNSUPPORTED_ACTION | TON_RELAY_NO_RECEIPT_STORE
 * @throws {import('./tonQuoteVerify').TonQuoteVerifyError} dogrulama (adim 6) duserse
 * @throws {import('./tonFeeClient').TonFeeError} /quote veya /relay HTTP/kod hatasi
 */
export async function executeTonViaRelayer({ account, vaults, actions, intent, approvedAtsFee, txId, signers }) {
    // Eylem kapisi diger her seyden once: desteklenmeyen ya da eksik alanli bir eylem
    // bosuna bir /status+/quote turu atmadan hemen firlamali.
    assertSupportedActions(actions)

    const tonWallet = canonicalTonWallet(intent?.tonWallet)
    const payer = account?.address

    // 1. Taze durum - onbellek DEGIL (force:true): bu akisin BASLAYIP baslamayacagina karar
    // veriyoruz, 30sn'lik bayat bir "acik" yaniti burada yeterli guvence degil.
    const status = await readTonFeeStatus({ sender: payer, force: true })
    // 2. Bolge/oran kapaliysa quote'a bile GIDILMEZ.
    if (!tonFeeRelayActive(status)) fail('TON_RELAY_UNAVAILABLE')
    // 3. TON'a kilitli hesapta ATS'i BSC'de imzalayacak bir EVM anahtari yok.
    if (!evmVaultResolvable(vaults, account)) fail('TON_RELAY_NO_EVM_VAULT')
    // 4. Cozulmemis bir makbuz varken IKINCI kez odetmeyiz - kilit MODDAN BAGIMSIZ (design 6).
    const settlements = await loadAllTonSettlements()
    if (hasUnsettledTonFee(settlements)) fail('TON_RELAY_PENDING_SETTLEMENT')

    // 5. Sunucu W5 govdesini KENDI kurar (design bolum 3) - biz yalniz ANLAMSAL niyeti
    // (kind/to/tutar) yolluyoruz, hazir bir govde uretmiyoruz.
    const quote = await tonFeeQuote({
        tonWallet, tonPublicKey: intent?.tonPublicKey, payer,
        actions: actions.map(quoteAction),
    })

    // 6. IMZADAN ONCE, HER IKISINDEN once: `actions`/`approvedAtsFee` burada TEK KEZ eklenir
    // (yukarida `intent`in kendisinde tasinmiyorlar) - iki ayri kopya olsaydi biri
    // guncellenip digeri unutulabilirdi.
    verifyTonQuote(quote, { ...intent, tonWallet, actions, approvedAtsFee })

    const feeAuth = quote?.sign?.feeAuth ?? {}

    // 7. IMZA A - ed25519, "bu eylemleri ben istedim". Ham baytlar HEMEN hex'e cevrilir
    // (bkz. toHexSignature) - asagida bu deger hem /relay govdesine hem makbuza gider ve
    // ikisi de JSON uzerinden tasinir/saklanir.
    const signature = toHexSignature(await signers.tonSign(actionHashBuffer(feeAuth.actionHash)))
    // 8. IMZA B - secp256k1, "bu ucreti odemeye raziyim". Domain/types sunucunun gonderdigi
    // NESNE degil, BIZIM sabitimiz (TON_FEE_DOMAIN/TON_FEE_AUTH_TYPES) - adim 6'daki V9 zaten
    // ikisinin AYNI oldugunu dogruladi, ama ele gecirilmis bir domain'i imzalamak yerine
    // kendi sabitimize korukorune guvenmek bu dosyayi o sinifin disinda tutar.
    const feeAuthSignature = await signers.evmSignTypedData(TON_FEE_DOMAIN, TON_FEE_AUTH_TYPES, feeAuth)

    // 9. RELAY'DEN ONCE, DISKE: relay tam bu anda SW'i oldururse, diskte yazili olmayan bir
    // ucretin kurtarma yolu da olmaz (design bolum 5, B8). `tonWallet` BURADA da kanonik
    // - asagidaki anahtar hesaplamasiyla AYNI degisken, farkli bir tonWallet TURETILMEZ.
    const saved = await saveTonSettlement({
        tonWallet,
        actionHash: feeAuth.actionHash,
        quoteId: quote.quoteId,
        payloadBoc: quote.payloadBoc,
        signature,
        feeAuthSignature,
        atsFee: quote.atsFee,
        seqno: feeAuth.seqno,
        deadline: feeAuth.deadline,
        phase: 'relay-inflight',
        txId,
    })
    // Review bulgusu 4: saveTonSettlement `false` donerse (depo yok, kota asimi, IO hatasi)
    // yazma sessizce ATLANMIS demektir. Bunu gormezden gelip relay'e devam etmek, tam da bu
    // siranin onlemeye calistigi seyi yeniden acar: ucret alinir, diskte HICBIR kanit kalmaz.
    // Bu yuzden relay'e HIC gidilmez - "kaydedemiyorsak tahsil de etmeyiz".
    if (!saved) fail('TON_RELAY_NO_RECEIPT_STORE')
    // Guncelleme/silme icin AYNI anahtar - `quote.sign.feeAuth.tonWallet` (sunucunun
    // ECHO'ladigi yazim) DEGIL, yukaridaki kanonik `tonWallet`. Ikisi ayrissaydi (sunucu
    // farkli bir yazimla dondursun ya da donmesin), save ile update/clear FARKLI bir kayda
    // yazar ve 'relay-inflight' kaydi kalici olarak asilmis kalirdi.
    const settlementKey = tonSettlementKey({ tonWallet, actionHash: feeAuth.actionHash })

    // 10. Tahsilat + gonderim TEK istekte.
    //
    // withKeepAlive: ASIL service worker olum penceresi BURASI - makbuz diske indi,
    // ATS tahsil ediliyor ve biz yaniti bekliyoruz. Kurtarmadaki tekrar denemesi
    // (tonFeeRecovery.js:attemptRelay) bu sarmalayiciyi bastan beri kullaniyordu; ILK
    // cagrinin sarmalanmamis kalmasi, en genis pencereyi acikta birakiyordu.
    // Sarmalayici bir HEURISTIKTIR, garanti degil (bkz. swKeepAlive.js) - asil savunma
    // yukaridaki 9. adim. Kapsami BILEREK dar: yalniz relay: /quote ve iki imza
    // (cogu yerel is) icin SW'i ayakta tutmaya calismak, korudugumuz seyi bulaniklastirir.
    let response
    try {
        response = await withKeepAlive(() => tonFeeRelay({ quoteId: quote.quoteId, signature, feeAuthSignature }))
    } catch (err) {
        // 11 (hata yolu). Sonuc esemesi KENDIMIZ VERMEYIZ - settlementDispositionFor'a
        // soruyoruz (T3); hata siniflandirmasi (kullaniciya ne gosterilecegi) da bu dosyanin
        // isi degil, cagiranin resolveTonFeeBlocker'idir.
        const disposition = settlementDispositionFor({ httpStatus: err?.httpStatus, code: err?.code })
        if (disposition === 'clear') {
            await clearTonSettlement(settlementKey)
        } else if (disposition === 'keep-settled') {
            // `receipt` DISKE yazilir ama HICBIR ISTEGE KONMAZ. Bugunku isi DESTEK VE
            // TESHIS: ucretin alindigina dair diskteki kanit. Kurtarmanin tekrari
            // (tonFeeRecovery.retryRelay) ILK cagriyla BIREBIR ayni govdeyi gonderir.
            // Gondermemek bilincli: /relay govdesinin `quoteId` disindaki alan adlari
            // HENUZ OLCULMEDI (tasarim bolum 10 R1) ve sunucu tanimadigi bir alanda
            // istegin TAMAMINI reddediyor - uydurulmus bir ad, ucreti zaten alinmis bir
            // kaydin son tekrar hakkini yakardi. Alan adi olculdugunde gonderim TEK
            // yerde (tonFeeClient.tonFeeRelay) acilir.
            await updateTonSettlement(settlementKey, {
                phase: 'collected',
                receipt: err?.receipt ?? null,
                settlementId: err?.settlementId ?? null,
            })
        }
        // 'keep': kayit DOKUNULMADAN relay-inflight'ta kalir - Task 7'nin kurtarmasi zincirden
        // dogrulayip karar verir (design bolum 6). Sessizce silmek odenmis bir ucretin tek
        // kanitini yok eder.
        throw err
    }

    // 11 (basari yolu). settlementDispositionFor'un sozlesmesinde 200 icin bir dal YOK -
    // o fonksiyon yalniz HATA govdesini (`code`/`httpStatus`) siniflandirir (bkz. T3 testleri,
    // `httpStatus:200` hic sinanmaz).
    //
    // ASIMETRIK RISK KURALI (review bulgusu 3): /relay'in tam yanit govdesi HENUZ olculmedi
    // (design 10 R1). Firlatmayan ama BOS/null donen bir 2xx GERCEKTEN belirsizdir - byle bir
    // govdeyi "basarili" sayip makbuzu SILMEK, alinmis bir ucretin TEK kanitini KALICI olarak
    // yok edebilir; oysa GEREKENDEN FAZLA saklamak kendi kendini iyilestirir (Task 7'nin
    // kurtarmasi zincirden actionHash'i dogrulayip zaten basariliysa siler). Bu yuzden yalniz
    // govde DOLU bir nesneyse (sunucu gercekten bir sey donduyse) silinir; bos/null/
    // ayristirilamayan govdede kayit relay-inflight'ta BIRAKILIR.
    //
    // GECICI (provisional): /relay yanit sekli olculunce (design 10 R1) bu kontrol
    // kesinlesmis bir alana (ornegin `success:true`) baglanabilir - su an elimizdeki tek
    // guvenilir sinyal govdenin bos olup olmadigi.
    const relayConfirmedWithBody = response !== null && typeof response === 'object' && Object.keys(response).length > 0

    // MAKBUZ BURADA SILINMEZ (gorev 10, yukumluluk 2). Eskiden silinirdi ve islem
    // durumunu cagiran SONRA yazardi; service worker tam o bosluktan olurse islem
    // 'processing'te MAKBUZSUZ kalir - bu, yetim taramasinin (tonFeeRecovery.js,
    // scanOrphanTxs) imzasinin ta kendisidir ve ucreti GERCEKTEN alinmis bir islemi
    // "ucret alinmadi" diye etiketler. Bayat bir makbuz kurtarilabilir (kurtarma
    // zincirden dogrulayip siler); yanlis etiketlenmis bir islem YALANDIR ve
    // 'unresolved' terminal oldugu icin duzelmez. Bu yuzden sira tersine cevrildi:
    // cagiran once `updateTxStatus(..., 'success')` yazar, SONRA `clearTonSettlement`.
    // Ayni sira kurtarmanin tek 'success' dalinda da var (confirmOnChain).
    //
    // `status` SPREAD'DEN SONRA yazilir: sunucunun govdesinde ayni adda bir alan
    // gelirse bizim karar alanimiz onun altinda kalmamali - cagiran silme kararini
    // buna bakarak veriyor.
    //
    // 'unconfirmed': asimetrik risk kurali (review bulgusu 3) korunur - bos/null bir
    // 2xx GERCEKTEN belirsizdir; kararin kendisi degil, yalnizca YERI degisti. Cagiran
    // bu durumda ne 'success' yazar ne de makbuzu siler; kurtarma karar verir.
    return { ...response, settlementKey, status: relayConfirmedWithBody ? 'sent' : 'unconfirmed' }
}
