import { privateContextFrom, sameAddress } from './privacyGate'
import { accountByKey } from './privateAccount'
import { privateOrderDelivery } from './orderDelivery'
import { canonicalChainId } from './deliveryChains'
import { flattenVaultAccounts } from '../knownRecipients'

// GIZLI ISLEMLER SATIRININ "NE ISLEMDI" PROJEKSIYONU. Siparis kaydi islemin turunu ve yonunu acikca tasimaz; tur, kayittaki
// adreslerden ve kasadaki kayitli Gizli Hesap'tan turetilir (deliveryScreenOf ile AYNI kural, ama kaynak hesabin KAYITTAKI
// anahtarindan: ekran bilgisi mesajdan degil kasadan gelir):
//   - cikti adresi Gizli Hesap DEGIL                         -> 'send'   (Gizli Gonder: teslim baska bir adrese gider)
//   - cikti Gizli Hesap, kaynak hesap Gizli Hesap DEGIL      -> 'fund'   (Para yukle: genel hesaptan Gizli Hesap'a)
//   - ikisi de Gizli Hesap, kaynak zinciri = teslim zinciri  -> 'swap'   (kendine takas)
//   - ikisi de Gizli Hesap, zincirler farkli                 -> 'bridge' (kendine kopru)
// Okunamayan her sey null verir (arayuz eski satiri aynen cizer): bozuk/eksik cikti adresi, kasada kayitli Gizli Hesap yok
// (tur ayirt edilemez), kaynak hesap kasada bulunamadi (fund mu swap mi bilinmez), kaynak ya da teslim zinciri okunamadi (swap mi
// bridge mi bilinmez). Saf islev: ag yok, depo yok; arka plan ve testler ayni islevi kullanir.
//
// Karsi tarafin adi YALNIZ kullanicinin KENDI hesaplarindan gelir (kasadaki normal hesaplar): 'send' icin alicinin hesap adi,
// 'fund' icin kaynak hesabin adi. Yabanci bir adres icin ad ASLA uretilmez (counterpartName null); adres defteri okunmaz.
// counterpartAddress: 'send' icin alici adres, 'fund' icin kaynak hesabin adresi; 'swap'/'bridge' icin null (karsi taraf yok).
// sourceAsset: kaydin ozetindeki kaynak varlik (sourceInput.asset; teklif aninda istege sabitlenmis bir degerdir); yoksa null.

// sameAddress ile AYNI cesitlilik: harf boyutu ve 0x/0X oneki duyarsiz, 40 onaltilik hane (baska bicim adres sayilmaz).
const ADDRESS_RE = /^(0x)?[0-9a-f]{40}$/i
const isAddress = (a) => typeof a === 'string' && ADDRESS_RE.test(a)
const SYMBOL_RE = /^[A-Za-z0-9._$-]{1,20}$/

function sourceAssetOf(order) {
    const asset = order?.summary?.sourceInput?.asset
    return typeof asset === 'string' && SYMBOL_RE.test(asset) ? asset : null
}

const nameOf = (account) => (typeof account?.name === 'string' && account.name.trim() !== '' ? account.name.trim() : null)

// Kasadaki NORMAL hesaplardan adresi eslesen (harf boyutu ve 0x oneki duyarsiz) ilkinin adi; yoksa null.
function ownAccountName(vaults, address) {
    const hit = flattenVaultAccounts(vaults).find((account) => sameAddress(account.address, address))
    return nameOf(hit)
}

export function privateOrderKind(order, vaults) {
    const sourceAsset = sourceAssetOf(order)
    const none = { kind: null, sourceAsset, counterpartName: null, counterpartAddress: null }
    try {
        const privateAddress = privateContextFrom(vaults).privateAddress
        const output = order?.outputAddress
        if (!isAddress(privateAddress) || !isAddress(output)) return none
        if (!sameAddress(output, privateAddress)) {
            return { kind: 'send', sourceAsset, counterpartName: ownAccountName(vaults, output), counterpartAddress: output }
        }
        const source = accountByKey(vaults, order.sourceAccountKey)
        if (!isAddress(source?.address)) return none
        if (!sameAddress(source.address, privateAddress)) {
            return { kind: 'fund', sourceAsset, counterpartName: nameOf(source), counterpartAddress: source.address }
        }
        const sourceChain = canonicalChainId(order.sourceChainId)
        const deliveryChain = privateOrderDelivery(order).deliveryChainId
        if (sourceChain === null || deliveryChain === null) return none
        return { kind: sourceChain === deliveryChain ? 'swap' : 'bridge', sourceAsset, counterpartName: null, counterpartAddress: null }
    } catch {
        return none
    }
}
