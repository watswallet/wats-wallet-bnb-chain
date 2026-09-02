// Solana dapp oturumlari: yetki cozme ve depo sekli -- saf katman.
//
// Neden `dapps` DEGIL: notifyConnectedDapps (background.js) o kaydi gezip BUTUN
// hostname'lere EIP-1193 olayi yayinliyor; Solana kayitlari oraya girseydi Solana
// dapp'lerine anlamsiz chainChanged/accountsChanged giderdi. Neden `ton_dapps`
// DEGIL: o kayit TON sekillidir (walletStateInit, manifest, chain).
//
// AG YOK, chrome YOK.
//
// ANAHTAR TAM ORIGIN'dir (K5): 'https://app.example.com' -- sema ve port dahil.
// TON tarafi hostname ile anahtarliyor; burada onu KOPYALAMIYORUZ, cunku hostname
// ile anahtarlamak http:// ve her portu ayni yetki kovasina koyar.
//
// Oturum sekli:
// { address, publicKey, accountKey, cluster, appMeta, connectedAt }
//
// publicKey hex'tir ve YALNIZCA dahili kolayliktir; Wallet Standard sinirina asla
// bu bicimde cikmaz (sinirda 32 baytlik Uint8Array olur).
//
// BU DOSYADA norm() YOKTUR (K8). tonConnectAuthz.js'in trim+toLowerCase yardimcisi
// bilerek kopyalanmadi: base58'de buyuk/kucuk harf anlamlidir ve kucultmek
// birbirinden FARKLI iki Solana hesabini ayni sayardi.

/**
 * Bir origin'in isteyebilecegi Solana oturumu; yetki yoksa null.
 *
 * `requestedFrom` verilmezse (undefined/null) oturumun KENDI adresi kullanilir --
 * o anki AKTIF hesaba DUSULMEZ. Oturum baglandigi hesaba sabittir (K10) ve aktif
 * hesap dapp'in hic gormedigi biri olabilir.
 *
 * Adres karsilastirmasi TAM esitliktir; kirpma ya da harf donusumu YOK. Acikca
 * verilmis bos adresi ('') ile karsilasma basarisiz olur (null doner). Bunu TON'dan
 * ayiriyoruz cunku uygulamada dapp istek.address (ham veri) aktarir -- kotu amacli
 * bir sayfa address: '' gondererek yetki denetimini asabilir. Solana'da yetki tam
 * origin+adres cifti ile baglanir: bos adres hicbir seye eslesemez.
 */
export function grantedSolanaSession(solanaDapps, origin, requestedFrom) {
    const session = solanaDapps?.[origin]
    if (!session || typeof session !== 'object' || !session.address) return null
    if (requestedFrom === undefined || requestedFrom === null) return session
    return session.address === requestedFrom ? session : null
}

/**
 * Bir origin icin oturum kaydet; YENI nesne dondurur, girdi degismez.
 */
export function putSolanaSession(solanaDapps, origin, session) {
    return { ...(solanaDapps || {}), [origin]: session }
}

/**
 * Bir origin'in oturumunu sil; YENI nesne dondurur, girdi degismez.
 */
export function removeSolanaSession(solanaDapps, origin) {
    const next = { ...(solanaDapps || {}) }
    delete next[origin]
    return next
}

/**
 * Bagli hesabi ARTIK VAR OLMAYAN oturumlarin TAM ORIGIN'leri.
 *
 * `accountKeys` bos ya da gecersizse BOS dizi doner -- "bilmiyorum" ile "hicbir
 * hesap yok" ayni sey degil ve ikincisini varsaymak kullanicinin butun dapp
 * baglantilarini geri alinamaz sekilde silerdi.
 */
export function orphanSolanaOrigins(solanaDapps, accountKeys) {
    if (!Array.isArray(accountKeys) || accountKeys.length === 0) return []
    const bilinen = new Set(accountKeys.filter((k) => typeof k === 'string' && k !== ''))
    if (bilinen.size === 0) return []
    return Object.entries(solanaDapps || {})
        .filter(([, s]) => s && typeof s === 'object' && s.accountKey && !bilinen.has(s.accountKey))
        .map(([origin]) => origin)
}
