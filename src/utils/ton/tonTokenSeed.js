// Hesabin token haritasina TON native satirini ekler.
//
// Ana ekran listesi `imported_tokens[account.key][chainId]` uzerinden kuruluyor ve
// CAPRAZ ZINCIR (tum aglarin tokenlari bir arada). TON satiri buraya girmezse
// kullanicinin TON bakiyesi hicbir yerde gorunmez.
//
// Girdi YERINDE degistirilmez: cagiran taraf `changed` false ise diske yazmaz.
import { buildNativeToken, NATIVE_TOKEN_ADDRESS } from '../nativeToken'
import { TON_MAINNET_ID } from '../chainKind'

const KEY = String(TON_MAINNET_ID)

const nativeRowIndex = (rows) => rows.findIndex(
    (row) => row && (row.address === NATIVE_TOKEN_ADDRESS || row.native === true)
)

export function ensureTonNativeToken(byChain) {
    const source = byChain && typeof byChain === 'object' ? byChain : {}
    const existing = source[KEY]

    const native = buildNativeToken(TON_MAINNET_ID)
    if (!native) return { changed: false, byChain: source }

    // GORUNEN AD TAZELEME.
    //
    // Satir diske BIR KEZ yaziliyor ve `imported_tokens` icin baska hicbir yerde
    // goc/onarim yok, yani eski bir satir SONSUZA KADAR kaliyordu. TON agini
    // adlandirma degisikliginden (adc23c1, 2026-09-15) once bir kez acmis her
    // kullanicinin diskinde hala { symbol: 'TON', name: 'Toncoin' } duruyor ve
    // Home.vue o nesneyi DOGRUDAN basiyor -- kod tarafi tamamen GRAM'a gectigi
    // halde ana ekranda "TON" goruluyordu.
    //
    // Yalnizca NATIVE satirin iki gorunur alani yazilir: kullanicinin elle
    // ekledigi jettonlar ayni kovada yasiyor ve liste yeniden kurulursa SESSIZCE
    // silinirlerdi. Adres, chainId, coingecko_id ve depolama anahtari DEGISMEZ.
    if (Array.isArray(existing) && existing.length > 0) {
        const i = nativeRowIndex(existing)
        if (i < 0) return { changed: false, byChain: source }

        const current = existing[i]
        if (current.symbol === native.symbol && current.name === native.name) {
            return { changed: false, byChain: source }
        }

        const next = existing.slice()
        next[i] = { ...current, symbol: native.symbol, name: native.name }

        return { changed: true, byChain: { ...source, [KEY]: next } }
    }

    // Ana ekran satiri `coingecko_id` bekliyor (getTokensDataById govdesi) ve
    // `id` alanini SearchTokens kullaniyor; buildNativeToken ikisini de saglamaz.
    const row = { ...native, id: native.coingecko_id }

    return { changed: true, byChain: { ...source, [KEY]: [row] } }
}
