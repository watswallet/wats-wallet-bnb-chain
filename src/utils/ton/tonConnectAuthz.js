// TON dapp oturumlari: yetki cozme ve depo sekli -- saf katman.
//
// Neden `dapps` DEGIL de AYRI bir `ton_dapps`: notifyConnectedDapps (background.js)
// `dapps` kaydini gezip BUTUN hostname'lere EIP-1193 olayi yayinliyor. TON kayitlari
// oraya girseydi TON dapp'lerine anlamsiz chainChanged/accountsChanged giderdi.
//
// AG YOK, chrome YOK.
//
// Oturum sekli:
// { address, publicKey, walletStateInit, accountKey, chain, manifest, connectedAt }
//
// walletStateInit: ton_addr yaniti tasinilan base64. Henuz zincirlenmemis bir
// cuzdan icin islem insa etmek icin dapp'in ihtiyaci var.

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

/**
 * Bir origin'in isteyebilecegi TON oturumu; yetki yoksa null.
 *
 * `requestedFrom` verilmezse oturumun KENDI adresi kullanilir -- o anki AKTIF
 * hesaba DUSULMEZ. TonConnect'te accountsChanged yok; oturum baglandigi adrese
 * sabittir (tasarim belgesi bolum 7.1) ve aktif hesap dapp'in hic gormedigi biri olabilir.
 */
export function grantedTonSession(tonDapps, hostname, requestedFrom) {
    const session = tonDapps?.[hostname]
    if (!session || typeof session !== 'object' || !session.address) return null
    if (requestedFrom === undefined || requestedFrom === null || requestedFrom === '') return session
    return norm(session.address) === norm(requestedFrom) ? session : null
}

export function putTonSession(tonDapps, hostname, session) {
    return { ...(tonDapps || {}), [hostname]: session }
}

export function removeTonSession(tonDapps, hostname) {
    const next = { ...(tonDapps || {}) }
    delete next[hostname]
    return next
}

/**
 * Bagli hesabi ARTIK VAR OLMAYAN oturumlarin hostname'leri.
 *
 * `accountKeys` bos ya da gecersizse BOS dizi doner -- "bilmiyorum" ile "hicbir
 * hesap yok" ayni sey degil ve ikincisini varsaymak kullanicinin butun dapp
 * baglantilarini geri alinamaz sekilde silerdi.
 */
export function orphanTonHostnames(tonDapps, accountKeys) {
    if (!Array.isArray(accountKeys) || accountKeys.length === 0) return []
    const bilinen = new Set(accountKeys.map(norm))
    return Object.entries(tonDapps || {})
        .filter(([, s]) => s && s.accountKey && !bilinen.has(norm(s.accountKey)))
        .map(([hostname]) => hostname)
}
