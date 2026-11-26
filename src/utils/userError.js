// EVM gonderim/okuma hatasini kullaniciya gorunecek i18n ANAHTARINA cevirir.
// Hicbir dal ham hata metnini dondurmez. AG sinifi BELIRSIZ bir durumdur
// ('basarisiz' DEMEZ): istek karsiya ulasmis olabilir.
export const USER_ERROR_KEYS = Object.freeze({
    insufficient: 'send.insufficientBalance',
    rejected: 'send.errors.userRejected',
    network: 'send.errors.network',
    failed: 'send.confirmTransaction.txFailed',
})

const NETWORK_CODES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'])
const NETWORK_MESSAGE = /network error|nonetwork|network_error|timeout|timed out/i

export function isNetworkError(err) {
    if (!err || typeof err !== 'object') return false
    if (NETWORK_CODES.has(err.code)) return true
    return typeof err.message === 'string' && NETWORK_MESSAGE.test(err.message)
}

export function userErrorKey(err) {
    if (err && typeof err === 'object') {
        if (err.code === 'INSUFFICIENT_FUNDS') return USER_ERROR_KEYS.insufficient
        if (err.code === 'ACTION_REJECTED') return USER_ERROR_KEYS.rejected
        if (isNetworkError(err)) return USER_ERROR_KEYS.network
    }
    return USER_ERROR_KEYS.failed
}
