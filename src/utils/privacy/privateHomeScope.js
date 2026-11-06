// GIZLI MODDA ANA EKRANIN SORGU KUMESI (gizli-mod cok-ag spec 4.7 "Home sorgu kumesi", E7) -- saf katman.
//
// Gizli Hesap aktifken Home YALNIZ SECILI AGI (S) sorgular: bakiye turu S'nin kendi ilk RPC'sine gider, baska aglarin
// kovalari sorgulanmaz (Gizli adres ve IP, gosterilmeyen verinin pesinden 10 RPC'ye dagilmasin). "Tum aglar" gorunumu
// ozel modda yoktur (store/tokenScope.js ham 'all' degerini etkin agin kimligine okur).
//
// Bu modul AG YOK, DEPO YOK, chrome YOK: yalnizca verilen satirlari / kovayi okur. Home.vue kararlari buradan alir ki
// ayni kural testte dogrudan olculebilsin.
import { isNativeAsset } from '../nativeAsset'
import { isSameChainId } from '../vm'
import { ALL_NETWORKS } from '../networkFilter'
import { normalizeBucketChainId } from '../homeTokenBucket'
import { privateNativeRow } from './privateDefaultTokens'
import { hasPrivateLogo } from './privateTokenLogo'

/**
 * Kapsam degerinden S: SAYI olan EVM zincir kimligi, yoksa null.
 * 'all' (etkin ag cozulemedi), metin kimlik (Solana) ve sayi olmayan her sey null: Gizli Hesap EVM-yalnizdir ve
 * bilinmeyen kapsam icin ag sorgulamak yerine HIC sorgulanmaz (fail-closed).
 */
export function privateScopeChainId(scopeFilter) {
    if (scopeFilter === ALL_NETWORKS || scopeFilter === null || scopeFilter === undefined) return null
    const id = normalizeBucketChainId(scopeFilter)
    return typeof id === 'number' ? id : null
}

/** Satirlardan yalniz `chainId` zincirinde olanlar (kimlik karsilastirmasi isSameChainId: 56 ile '56' ayni). */
export function rowsOfChain(rows, chainId) {
    if (chainId === null || chainId === undefined || !Array.isArray(rows)) return []
    return rows.filter((row) => isSameChainId(row?.chainId, chainId))
}

/**
 * S'nin yerel coin satiri listede YOKSA eklenmis kopya doner (varsa ayni dizi). Esleme `isNativeAsset` ile:
 * sunucu satirlari sifir adres, uretici '0x0' kullanir. Boylece Base'e gelen ETH, kovada satiri olmasa da gorunur.
 */
export function withScopeNativeRow(rows, chainId) {
    const list = Array.isArray(rows) ? rows : []
    if (chainId === null || chainId === undefined) return list
    const has = list.some((row) => isSameChainId(row?.chainId, chainId) && isNativeAsset(row?.address))
    if (has) return list
    const native = privateNativeRow(chainId)
    return native ? [...list, { ...native, amount: 0 }] : list
}

// Bakiye kaydi (user.tokenBalances[...]) KESIN sifir mi? Okunamayan (error), henuz yuklenmemis (kayit ya da tutar yok) ve sifir olmayan bakiye
// "sifir degil" sayilir: para gizlenmesin diye belirsizlik her zaman GORUNUR kalma yonundedir.
function isKnownZeroBalance(entry) {
    if (!entry || entry.error) return false
    const amount = entry.amount
    if (typeof amount === 'number') return amount === 0
    return typeof amount === 'string' && amount.trim() !== '' && Number(amount) === 0
}

/**
 * HOME'DA LOGOSUZ + SIFIR BAKIYELI SATIRLARI GIZLER (sahip karari 2026-11-03). Gizli modda logosu olmayan token (hasPrivateLogo) secicilerde yoktur;
 * Home bir secici degil MALVARLIGI listesidir: bakiyesi olan (ya da bakiyesi bilinmeyen/okunamayan) bir token logosuz olsa da GORUNUR kalir, aksi halde
 * para kayboldu gibi gorunurdu. Yalniz KESIN sifir bakiyeli logosuz satir (kullanicinin ice aktardigi ama hic tutmadigi token) gizlenir.
 * `balanceOf(satir)` bakiye kaydini (ya da undefined) doner. Girdiyi degistirmez.
 */
export function hideLogolessZeroRows(rows, balanceOf) {
    if (!Array.isArray(rows)) return []
    return rows.filter((row) => hasPrivateLogo({ chainId: row?.chainId, address: row?.address, symbol: row?.symbol })
        || !isKnownZeroBalance(typeof balanceOf === 'function' ? balanceOf(row) : undefined))
}

const symbolOf = (row) => String(row?.symbol ?? '').toUpperCase()
const addressOf = (row) => String(row?.address ?? '').toLowerCase()

/**
 * Ozel mod satir sirasi: yerel coin once, sonra sembol A-Z (yerel ayardan bagimsiz kod birimi karsilastirmasi),
 * esitlikte adres. USD yokken bakiye siralamasi anlamsizdir (spec 4.7).
 */
export function comparePrivateRows(a, b) {
    const nativeA = isNativeAsset(a?.address)
    const nativeB = isNativeAsset(b?.address)
    if (nativeA !== nativeB) return nativeA ? -1 : 1
    const symbolA = symbolOf(a)
    const symbolB = symbolOf(b)
    if (symbolA !== symbolB) return symbolA < symbolB ? -1 : 1
    const addressA = addressOf(a)
    const addressB = addressOf(b)
    if (addressA === addressB) return 0
    return addressA < addressB ? -1 : 1
}
