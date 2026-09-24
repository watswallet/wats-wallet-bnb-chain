// TON gonderim yolunun firlattigi HER ham kodu bir i18n anahtarina esler -- saf
// katman, AG YOK. solana/sendErrors.js ile AYNI sozlesme.
//
// KOK NEDEN: bu tablo eskiden background.js'te yasiyordu ve degerleri SABIT TURKCE
// cumlelerdi. Arka plan servis calisani dil bilmez: ingilizce arayuzdeki bir
// kullanici TON hatalarini TURKCE okuyordu. (Aynanin oteki yuzu -- EVM kolunun
// sabit INGILIZCE cumleleri -- utils/txErrors.js ile kapatildi.)
//
// TABLO'DA OLMAYAN bir kod ham sabit olarak ("TON_SEED_INVALID" yazan kirmizi bir
// satir) EKRANA CIKMAZ: resolveTonSendError bilinmeyen her kodu jenerik anahtara
// dusurur. Ama bu, TABLO'nun eksik kalabilecegi anlamina GELMEZ --
// tonBackgroundKeyPair.test.js utils/ton/** altinda firlatilan HER kod adini
// toplayip her birinin burada ACIKCA bir anahtari oldugunu kilitler; jenerik
// dususe guvenerek gecemez.
const K = (name) => `send.tonErrors.${name}`

export const TON_SEND_ERRORS = {
    // --- background.js in KENDI firlattiklari + ortak kimlik/kasa kapilari ---
    'Unsupported chain': K('unsupportedChain'),
    'TON_TX_ALREADY_PENDING': K('txAlreadyPending'),
    'Wallet locked. Please enter your password.': K('walletLocked'),
    'TON_ADDRESS_INVALID': K('addressInvalid'),
    'TON_ADDRESS_IS_EVM': K('addressIsEvm'),
    'TON_ADDRESS_WRONG_NETWORK': K('addressWrongNetwork'),
    'TON_AMOUNT_INVALID': K('amountInvalid'),
    'TON_INDEX_INVALID': K('indexInvalid'),
    'TON_SEED_INVALID': K('seedInvalid'),
    'TON_SECRET_MISSING': K('secretMissing'),
    'TON_SECRET_KIND_INVALID': K('secretKindInvalid'),
    'TON_SECRET_KIND_MISMATCH': K('secretKindMismatch'),
    'TON_SECRET_KIND_DEPRECATED': K('secretKindDeprecated'),
    'TON_VAULT_TYPE_INVALID': K('vaultTypeInvalid'),
    'TON_SECRET_KIND_MISSING': K('secretKindMissing'),
    'TON_MNEMONIC_INVALID': K('mnemonicInvalid'),
    'TON_MNEMONIC_DERIVE_EXHAUSTED': K('mnemonicDeriveExhausted'),
    'TON_ACCOUNT_REQUIRED': K('accountRequired'),
    'TON_ADDRESS_MISMATCH': K('addressMismatch'),
    'ACCOUNT_VAULT_NOT_FOUND': K('accountVaultNotFound'),
    'IMPORTED_SECRET_NOT_FOUND': K('importedSecretNotFound'),
    'TON_ACCOUNT_NO_EVM_KEY': K('accountNoEvmKey'),
    'TON_VAULT_NOT_FOUND': K('vaultNotFound'),
    'TON_API_BASE_MISSING': K('apiBaseMissing'),

    // --- JETTON YOLU ---
    'JETTON_DECIMALS_MISSING': K('jettonDecimalsMissing'),
    'JETTON_DECIMALS_INVALID': K('jettonDecimalsInvalid'),
    'JETTON_FORWARD_TON_ZERO': K('jettonBuildFailed'),
    'JETTON_AMOUNT_INVALID': K('amountInvalid'),
    'JETTON_AMOUNT_PRECISION': K('jettonAmountPrecision'),
    'JETTON_RESPONSE_DESTINATION_MISSING': K('jettonBuildFailed'),
    'JETTON_RECIPIENT_IS_JETTON_WALLET': K('jettonRecipientIsJettonWallet'),
    'JETTON_RECIPIENT_CHECK_FAILED': K('jettonRecipientCheckFailed'),
    'JETTON_INSUFFICIENT_BALANCE': K('jettonInsufficientBalance'),
    'JETTON_INSUFFICIENT_TON': K('jettonInsufficientTon'),

    // --- RELAY YOLU (TON ucret sponsorlugu) ---
    'TON_RELAY_UNAVAILABLE': K('relayUnavailable'),
    'TON_RELAY_NO_EVM_VAULT': K('relayNoEvmVault'),
    'TON_RELAY_PENDING_SETTLEMENT': K('relayPendingSettlement'),
    'TON_RELAY_UNSUPPORTED_ACTION': K('relayUnsupportedAction'),
    'TON_RELAY_NO_RECEIPT_STORE': K('relayNoReceiptStore'),

    // --- SENTETIK KODLAR: hicbir yerde FIRLATILMAZ, background.js uretir ---
    // Taninmayan her sey buraya duser (beyaz liste disi istisna metinleri dahil).
    'TON_SEND_FAILED': K('generic'),
    // tonQuoteVerify reddi: on alti ayri kodun HEPSI bu tek koda toplanir.
    'TON_QUOTE_VERIFY_FAILED': K('quoteVerifyFailed'),

    // --- TONCONNECT DAPP YOLU ---
    'TON_DAPP_FROM_MISMATCH': K('dappFromMismatch'),
    'TON_DAPP_VALID_UNTIL_INVALID': K('dappValidUntilInvalid'),
    'TON_DAPP_REQUEST_EXPIRED': K('dappRequestExpired'),
    'TON_DAPP_RELAY_NO_BOC': K('dappRelayNoBoc'),
}

/**
 * Ham koddan i18n anahtarina. Bilinmeyen/bos kod jenerik anahtara duser -- ekrana
 * ASLA ham kod cikmaz.
 */
export function resolveTonSendError(code) {
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(TON_SEND_ERRORS, code)) {
        return TON_SEND_ERRORS[code]
    }
    return K('generic')
}

/**
 * Kod TABLO'da var mi? Cagiran taraf, taninmayan bir kodu jenerige DUSURMEK yerine
 * HAM gostermek isteyebilir -- TonConnect IMZA yolu boyle calisir: yeni/beklenmeyen
 * bir kodu gizlemek, kullaniciyi sebepsiz birakir (background.js'teki cagri yerinin
 * bas yorumu ayni karari anlatiyor).
 */
export function isKnownTonSendError(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(TON_SEND_ERRORS, code)
}

/**
 * Ekranda gosterilecek metin icin anahtar SECIMI: taninan kod cevrilir, taninmayan
 * kod HAM haliyle geri doner (cevrilecek bir sey yok). Donen degerin bir i18n
 * anahtari mi yoksa hazir metin mi oldugunu cagiran taraf `isKnownTonSendError` ile
 * bilir -- bu yuzden iki islev ayri tutuldu.
 */
export function tonSendErrorText(code, t) {
    return isKnownTonSendError(code) ? t(TON_SEND_ERRORS[code]) : (code || t(K('generic')))
}
