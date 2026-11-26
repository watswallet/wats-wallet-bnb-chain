// Token ekleme dogrulama hatalarini kullaniciya gorunecek i18n anahtarina cevirir.
// Yalniz bilesenin KENDI urettigi hatalar (i18nKey tasiyan) ozel metin alir; ham
// ethers/RPC metni ASLA dondurulmez. Bu bir okuma akisidir (para gonderimi degil):
// ag hatasi dahil her bilinmeyen hata "bilgi alinamadi" metnine gider.
export const IMPORT_FETCH_FAILED_KEY = 'importToken.custom.errorFetchFailed'

export function importTokenError(key) {
    return Object.assign(new Error(key), { i18nKey: key })
}

export function importTokenErrorKey(err) {
    const key = err && typeof err === 'object' ? err.i18nKey : null
    return typeof key === 'string' && key.startsWith('importToken.custom.') ? key : IMPORT_FETCH_FAILED_KEY
}
