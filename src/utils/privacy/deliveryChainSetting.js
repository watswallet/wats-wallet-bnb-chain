import { DELIVERY_CHAINS, DELIVERY_CHAIN_IDS, canonicalChainId, parseDeliveryChains, checkDeliveryLists } from './deliveryChains'
import { hasPrivateSendSource } from './privateBridgedSources'

// GIZLI MOD TESLIM AGI AYARI (gizli-mod cok-ag spec 4.2, K3, P15): iki derleme listesi.
//   VITE_PRIVATE_SEND_CHAINS  Gonder  : teslim agi olarak secilebilen aglar (giris sarti: fonlu yerel coin teslimi, K2)
//   VITE_PRIVATE_FUND_CHAINS  Para yukle: Gonder listesinin altkumesi; her agin en az bir Gonder kaynagi olmali (1.10 teslim degismezi)
// Degisken yok ya da bos -> o ekran icin HICBIR ag acik degil (BSC dahil, fail-closed). Kapali ag secicide GIZLIDIR ve arka
// planda reddedilir (PRIVATE_CHAIN_CLOSED). Bu modul ortami (import.meta.env) okur; saf tablo ve ayristirici deliveryChains.js'tedir
// (yapilandirma dosyasi onu import eder, bunu edemez). Ortam CAGRI ANINDA okunur: Vite `import.meta.env.VITE_ADI` yazimini
// derlemede metin sabitine cevirir (dinamik anahtar uretimde undefined olurdu), testler vi.stubEnv ile degistirir.
//
// Para yukle degismezleri (checkDeliveryLists) calisma zamaninda da denetlenir: ihlalde Para yukle listesi BOS sayilir
// (fail-closed). Teslim degismezi (1.10): Para yuklede her agin en az bir Gonder kaynagi olmali (hasPrivateSendSource, SDK'siz),
// cunku Gizli Hesap'a teslim edilen varlik yalniz Gonder ile cikabilir. ATS satisi bayragi artik burada okunmaz.
//
// Ekran, teslimin NEREYE dustugunden turetilir, mesajdan degil (kural 6): kaynak Gizli Hesap VE alici baska bir adres ise 'send', degilse 'fund' (genel hesaptan Para yukle ve Gizli Hesap'tan kendine Takas/Kopru). Bu modul yalniz "hangi ekran" bilgisini alir;
// turetmeyi cagiran yapar (arka plan: deliveryScreenOf; arayuz: PrivateTransfer, swap ve bridge kiplerinde 'fund').
function listsFromEnv() {
    const send = parseDeliveryChains(import.meta.env.VITE_PRIVATE_SEND_CHAINS).ids
    const fund = parseDeliveryChains(import.meta.env.VITE_PRIVATE_FUND_CHAINS).ids
    const sendSources = DELIVERY_CHAIN_IDS.filter(hasPrivateSendSource)
    return { send, fund: checkDeliveryLists(send, fund, sendSources).length === 0 ? fund : [] }
}

// Ekranda acik aglarin tablo satirlari, tablo sirasiyla (secici sirasi).
export function openDeliveryChains(screen) {
    const lists = listsFromEnv()
    const ids = screen === 'send' ? lists.send : screen === 'fund' ? lists.fund : []
    return DELIVERY_CHAINS.filter((c) => ids.includes(c.chainId))
}

export function isDeliveryChainOpen(screen, chainId) {
    const id = canonicalChainId(chainId)
    return id !== null && openDeliveryChains(screen).some((c) => c.chainId === id)
}

// Varsayilan ag: tablo sirasindaki ilk acik ag (BSC ilk satir oldugundan BSC aciksa BSC); hicbiri acik degilse null.
export function defaultDeliveryChain(screen) {
    return openDeliveryChains(screen)[0]?.chainId ?? null
}
