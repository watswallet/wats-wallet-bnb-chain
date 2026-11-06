import { isPrivateIdentity, privateContextFrom } from './privacyGate'

// DAPP'LERIN GORDUGU ZINCIR, gizli modda DONDURULUR (A-I3). Gizli modda yapilan ag
// secimleri (swap / kopru ekranlarinda zincir degistirmek) sitelere ne chainChanged
// olarak gitmeli ne eth_chainId ile okunabilmeli: yoksa Gizli Hesap'in zincir
// hareketleri, Genel hesaba bagli her sitenin zaman damgali bir yan kanali olurdu.
//
// Gizli moda GIRERKEN sitelerin o an gordugu ag (currentNetwork kaydinin tamami ya da
// ag yoksa null) chrome.storage'a yazilir; servis calisani yeniden baslasa da kalir.
// Cikista (P5, SP2 spec 4.9) bu ag, hesap gecisiyle AYNI yazimda canli ag olarak geri
// yuklenir; geri yuklenemezse canli agla karsilastirilip tek bir uzlastirma olayi
// yollanir. Kayit en sonda silinir.
//
// Donmus kayit, sitelere SON BILDIRILEN agdir ve cikis uzlastirmasi bitip silinene dek
// gecerlidir: hesap turune bakilmaz. Boylece hesabi mesajsiz yazan bir yuzeyin yazimi ile
// onarimin ag geri yazimi arasindaki pencerede siteler son gizli agi ogrenmez. Eski
// kural ("yalniz Gizli Hesap iken") bu pencereyi acik birakirdi; onun kaygisi (yarim
// kalmis bir cikis kaydi Genel modda bayat ag gostermesin) kayit silinemezse suruyor:
// onu healPrivacyTransitionState (background.js) acilista ve her active_account
// degisiminde yeniden dener.
export const FROZEN_NETWORK_KEY = 'privacy_frozen_network'

export async function readPrivacyView(storage = chrome.storage.local) {
    const stored = await storage.get(['active_account', 'vaults', 'currentNetwork', FROZEN_NETWORK_KEY])
    const ctx = privateContextFrom(stored.vaults)
    const frozen = stored[FROZEN_NETWORK_KEY]
    return {
        activeAccount: stored.active_account || null,
        currentNetwork: stored.currentNetwork,
        isPrivate: isPrivateIdentity(stored.active_account, ctx),
        // `null` gecerli bir donmus deger (girerken hicbir ag kaydi yoktu); `undefined` = kayit yok.
        frozen: frozen === undefined ? undefined : frozen,
    }
}

// Sitelerin (eth_chainId, "zaten o zincirdeyiz" cevabi) gormesi gereken ag. Kayit varsa
// (`null` dahil: girerken ag kaydi yoktu, siteler "ag yok" gorur) hesap turune bakmadan
// kayit; yoksa canli ag.
export async function dappVisibleNetwork(storage = chrome.storage.local) {
    const view = await readPrivacyView(storage)
    if (view.frozen !== undefined) return view.frozen || undefined
    return view.currentNetwork
}
