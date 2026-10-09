// TonConnect onayindan SONRAKI hatanin dapp'e nasil donecegi (B1). Saf: chrome
// yok, firlatmaz.
//
// Uc sinif:
//   gonderildi  -> imzali bir sey aga/relayer'a cikti: islem yine de islenebilir,
//                  kod 0 (send-transaction.md: broadcast sonrasi hata 0).
//   dogrulama   -> istek imza aninda gecersiz: kod 1 (BAD_REQUEST).
//   diger       -> hicbir imza cuzdandan cikmadi ve kosul gecebilir: dapp'e
//                  yanit YOK, kullanici tekrar deneyebilir ya da reddeder (300).

// Imza aninda yakalanan istek hatalari. Mesajlar dapp'e gider (Ingilizce).
const DOGRULAMA_METNI = {
    TON_DAPP_REQUEST_EXPIRED: 'Request expired',
    TON_DAPP_VALID_UNTIL_INVALID: 'valid_until must be a uint32 unix time in seconds',
    TON_DAPP_FROM_MISMATCH: 'Requested from address does not match the connected account',
    TON_ADDRESS_INVALID: 'Message address must be a valid user-friendly address',
}

export const TON_DAPP_DOGRULAMA = new Set(Object.keys(DOGRULAMA_METNI))

const RELAY_BOC_YOK = 'TON_DAPP_RELAY_NO_BOC'

/**
 * @param {string} errorCode tonDappSend'in urettigi kod (tonSendErrorCode)
 * @param {{sent?: boolean}} [opts] imzali govde aga/relayer'a cikti mi
 * @returns {{terminal: boolean, code: (0|1|null), message: (string|null)}}
 */
export function tonDappSendFailure(errorCode, { sent = false } = {}) {
    // BoC'suz relay yaniti /relay DONDUKTEN sonra olusur: bayrak eksik olsa da
    // gonderilmis sayilir.
    if (sent || errorCode === RELAY_BOC_YOK) {
        return {
            terminal: true,
            code: 0,
            message: errorCode === RELAY_BOC_YOK
                ? 'Transaction was sent but its BoC is unavailable'
                : 'Sending failed after signing; the transaction may still be processed',
        }
    }
    if (TON_DAPP_DOGRULAMA.has(errorCode)) {
        return { terminal: true, code: 1, message: DOGRULAMA_METNI[errorCode] }
    }
    return { terminal: false, code: null, message: null }
}

/**
 * Yayin (sendBoc) KESIN reddedildi mi? 4xx: proxy istegi kendi katmaninda
 * durdurdu (oran limiti 429, beyaz liste 403, govde siniri 413) ve toncenter'a
 * hic iletmedi; ust akis hatalarini 502'ye cevirdigi icin (server
 * tonController) 4xx oradan gelemez. 5xx ve yanitsiz hata (ag, zaman asimi)
 * BELIRSIZ kalir. solana/sendErrors.js isAmbiguousBroadcastError ile AYNI ayrim.
 * @param {unknown} error TonClient.sendFile hatasi (AxiosError: response.status)
 * @returns {boolean}
 */
export function tonBroadcastRefused(error) {
    const status = error?.response?.status
    return Number.isInteger(status) && status >= 400 && status <= 499
}

/**
 * signData/ton_proof: imza yereldir, her hata dapp'e hemen doner.
 * @param {Error|null|undefined} error
 * @returns {{code: (0|1), message: string}}
 */
export function tonDappSignFailure(error) {
    const kod = error?.message
    if (TON_DAPP_DOGRULAMA.has(kod)) return { code: 1, message: DOGRULAMA_METNI[kod] }
    // signData kurucusunun hatalari (tonSignDataSchemes.js, hepsi BAD_REQUEST).
    if (error?.tonConnectCode === 1) return { code: 1, message: String(kod || 'Bad request') }
    return { code: 0, message: 'The wallet could not sign the request' }
}
