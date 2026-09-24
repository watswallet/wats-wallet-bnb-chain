// buildTransferPlan.js / address.js / background.js'in Solana gonderim yolunda
// firlattigi HER hata adini bir i18n anahtarina esler — saf katman, AG YOK.
//
// TABLO'DA OLMAYAN bir kod ham sabit olarak (ornegin "AMOUNT_TOO_LARGE" yazan
// kirmizi bir kutu) EKRANA CIKMAZ: resolveSolanaSendError bilinmeyen her kodu
// jenerik bir mesaja dusurur. Ama bu, TABLO'nun eksik kalabilecegi anlamina
// GELMEZ — sendErrors.test.js buildTransferPlan.js VE address.js kaynagindaki
// her `throw new Error('...')` adini toplayip HER birinin burada ACIKCA bir
// anahtari oldugunu ayrica kilitler; jenerik dususe guvenerek gecemez.
const K = (name) => `send.errors.${name}`

export const SOLANA_SEND_ERRORS = {
    // buildTransferPlan.js (sekiz ad) + address.js (INVALID_SOLANA_ADDRESS) —
    // tam dokuzlu liste sendErrors.test.js'te kilitli.
    INVALID_SOLANA_ADDRESS: K('invalidSolanaAddress'),
    // Adres alaninin KENDI kirmizi uyarisiyla (Send.vue) AYNI metin: ikisi de
    // "bu bir cuzdan adresi degil, fonlar geri alinamaz" diyor.
    RECIPIENT_NOT_WALLET: 'send.recipientNotWallet',
    SELF_TRANSFER: K('selfTransfer'),
    AMOUNT_NOT_POSITIVE: K('amountNotPositive'),
    AMOUNT_EXCEEDS_PRECISION: K('amountExceedsPrecision'),
    AMOUNT_TOO_LARGE: K('amountTooLarge'),
    BLOCKHASH_REQUIRED: K('blockhashRequired'),
    ATA_RENT_REQUIRED: K('ataRentRequired'),
    // Kullanicinin kendi secebilecegi bir deger degil (SOL'un ondaligi sabit);
    // gorulmesi bir kod hatasi isareti, jenerik mesaj yeterli.
    INVALID_SOL_DECIMALS: K('generic'),

    // background.js / sendSolanaTransfer (Task 11) katmani.
    WALLET_LOCKED: K('walletLocked'),
    // Engel karti (Send.vue sendBlockReason) ile AYNI metin.
    SOLANA_UNSUPPORTED_ACCOUNT: 'send.solanaUnsupportedAccount',
    DERIVED_ADDRESS_MISMATCH: K('generic'),
    NO_ACTIVE_ACCOUNT: K('generic'),
    VAULT_NOT_FOUND: K('generic'),
    FORBIDDEN_ORIGIN: K('generic'),
    SOLANA_RPC_TIMEOUT: K('rpcTimeout'),
    SOLANA_SEND_FAILED: K('generic'),

    // send.js'in prepareTransferContext'i (Task 8/11): ayni AG DURUMU
    // sorunlarinin (blockhash/kira/ATA kirasi okunamadi) FARKLI adlarla
    // yeniden yazilmis hali — kullaniciya ayni anlami tasirlar.
    BLOCKHASH_UNAVAILABLE: K('blockhashRequired'),
    // Send.vue'nun "Maks" ipucuyla (feeUnavailable) AYNI metin: ikisi de
    // "ucret/kira bilgisi alinamadi" diyor.
    RENT_EXEMPTION_UNAVAILABLE: 'send.feeUnavailable',
    ATA_RENT_UNAVAILABLE: K('ataRentRequired'),

    // --- Solana dapp baglayicisi (spec 3.6) ---
    //
    // Bu on uc kod, dapp'in promise'ine `data.code` olarak DA gider ama
    // KULLANICIYA hicbiri ham gosterilmez: uc onay ekrani da hata metnini bu
    // tablodan cozer. Jenerik dususe BIRAKILMAZLAR -- her biri kullanicinin
    // yapabilecegi FARKLI bir seye isaret ediyor ("siteden yeni islem iste",
    // "bu bir mesaj degil, islem"), tek bir "islem gonderilemedi" metni bu
    // ayrimi yok ederdi.
    TX_DESERIALIZE_FAILED: K('txDeserializeFailed'),
    UNSUPPORTED_TX_VERSION: K('unsupportedTxVersion'),
    SOLANA_DAPP_FROM_MISMATCH: K('dappFromMismatch'),
    SOLANA_NOT_A_SIGNER: K('notASigner'),
    SOLANA_MISSING_COSIGNER: K('missingCosigner'),
    // Kor imzalama saldirisi (parseDappTransaction.js looksLikeTransaction).
    SOLANA_MESSAGE_LOOKS_LIKE_TX: K('messageLooksLikeTx'),
    SOLANA_MESSAGE_TOO_LARGE: K('messageTooLarge'),
    SOLANA_WRONG_CLUSTER: K('wrongCluster'),
    SOLANA_BLOCKHASH_EXPIRED: K('blockhashExpired'),
    SOLANA_TOO_MANY_TRANSACTIONS: K('tooManyTransactions'),
    // Gonderim yolundaki SOLANA_UNSUPPORTED_ACCOUNT ile AYNI durum, farkli ad
    // (dapp sozlesmesindeki ad budur): metin de AYNI olmali, ikinci bir ceviri
    // yazmak iki metnin zamanla ayrismasi demektir.
    SOLANA_ACCOUNT_UNSUPPORTED: 'send.solanaUnsupportedAccount',
    SOLANA_SIGNIN_DOMAIN_MISMATCH: K('signInDomainMismatch'),
    SOLANA_SIGNIN_ADDRESS_MISMATCH: K('signInAddressMismatch'),
}

const RPC_HTTP_PREFIX = 'SOLANA_RPC_HTTP_'

/**
 * Yayin (sendTransaction) BELIRSIZ mi dustu?
 *
 * BELIRSIZ = "dugum islemi kabul etmis OLABILIR, yanit bize ulasmadi". Bu iki
 * durum, yayinin KESIN reddedildigi durumlardan (preflight hatasi, gecersiz
 * blockhash, yetersiz bakiye -- hepsi JSON-RPC 200 + `error` govdesiyle gelir)
 * TEMELDEN farklidir:
 *
 *   - SOLANA_RPC_TIMEOUT: istek 15 sn icinde yanitlanmadi. Proxy ile dugum
 *     arasindaki adim TAMAMLANMIS olabilir.
 *   - SOLANA_RPC_HTTP_5xx: proxy'nin kendi 502'si (ust akisa ulasilamadi ya da
 *     yanit ayristirilamadi) ya da saglayicinin 503'u. Ust akisa giden POST'un
 *     dugume ULASIP ULASMADIGINI buradan bilmek MUMKUN DEGIL.
 *
 * Bu ayrim para meselesidir: belirsiz bir dususu "gonderilemedi" olarak
 * gostermek kullaniciyi TEKRAR gondermeye iter, prepareTransferContext TAZE bir
 * blockhash alir ve FARKLI imzali IKINCI bir transfer zincire gider. Bkz.
 * background.js sendSolanaTransfer.
 *
 * 4xx BELIRSIZ DEGILDIR: istek proxy tarafindan (beyaz liste / oran limiti /
 * boyut siniri) REDDEDILMISTIR, dugume hic gitmemistir.
 *
 * @param {string|null|undefined} code
 * @returns {boolean}
 */
export function isAmbiguousBroadcastError(code) {
    if (typeof code !== 'string') return false
    if (code === 'SOLANA_RPC_TIMEOUT') return true
    if (!code.startsWith(RPC_HTTP_PREFIX)) return false

    const status = Number(code.slice(RPC_HTTP_PREFIX.length))
    return Number.isInteger(status) && status >= 500 && status <= 599
}

/**
 * Kod TABLO'da (ya da SOLANA_RPC_HTTP_<status> oneki ile) taniniyor mu?
 *
 * Cagiranlarin (Send.vue MAX ipucu) "bilinmeyen kod -> jenerik mesaj" dususunu
 * fark edip DAHA GUVENLI bir yedek metne (orn. feeUnavailable) dusebilmesi icin.
 * Ham bir offline/DNS fetch reddi (`TypeError: Failed to fetch` gibi) TABLO'da
 * YOKTUR ve RPC_HTTP_PREFIX ile de baslamaz — boyle bir mesaj jenerik "Islem
 * gonderilemedi" metnine duserdi, oysa bu asamada (gonderim HENUZ baslamadan,
 * yalniz ucret/kira baglami yuklenirken) "ag ucreti bilgisi alinamadi" cok
 * daha DOGRU bir aciklamadir.
 * @param {string|null|undefined} code
 * @returns {boolean}
 */
export function isKnownSolanaSendError(code) {
    if (typeof code !== 'string') return false
    if (Object.prototype.hasOwnProperty.call(SOLANA_SEND_ERRORS, code)) return true
    return code.startsWith(RPC_HTTP_PREFIX)
}

/**
 * Hata adini kullaniciya gosterilecek i18n anahtarina cevirir.
 * @param {string|null|undefined} code
 * @returns {string} i18n anahtari (TABLO disi/bilinmeyen kod -> jenerik anahtar)
 */
export function resolveSolanaSendError(code) {
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(SOLANA_SEND_ERRORS, code)) {
        return SOLANA_SEND_ERRORS[code]
    }
    // SOLANA_RPC_HTTP_<status>: background.js'in eklemesi durumlarina gore
    // dinamik uretilen bir kod, TABLO'ya sabit olarak yazilamaz.
    if (typeof code === 'string' && code.startsWith(RPC_HTTP_PREFIX)) return K('rpcTimeout')
    return K('generic')
}
