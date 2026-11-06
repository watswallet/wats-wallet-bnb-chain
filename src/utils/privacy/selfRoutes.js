import { getAssetOnChain } from '@silentswap/sdk'
import { privateAssetsFor, privateSourceChains, PAYOUT_CHAIN_ID } from './silentswapConfig'
import { openDeliveryChains, isDeliveryChainOpen } from './deliveryChainSetting'
import { deliveryChainOf } from './deliveryChains'
import { nativeTokenOf, usdcTokenOf, normalizeDeliveryToken } from './deliveryTokens'
import { sourcePairs } from './sourceAssets'
import { LISTED_CHAINS } from '../../data/chains'

// GIZLI MOD KENDINE TAKAS / KOPRU ROTALARI: hangi aglarin, varliklarin ve teslim tokenlerinin sunuldugunun TEK kaynagi. Dugmelerin
// gorunurlugu, kaynak ve teslim secicileri, varsayilanlar ve Token on doldurmasi ayni tabloyu okur; arayuz ile arka plan siniri sapamaz.
// Saf modul, popup'tan guvenle yuklenir: silentswap.js ve privateOrderExec.js import EDILMEZ (privatePopupImports.test.js).
//
// Her liste Para yukle (FUND) listesidir: Gizli Hesap'tan kendine teslimin ekranini arka plan 'fund' turetir (deliveryScreenOf) ve
// ayni listeye bakar. 'send' listesi okunmaz. Ortam ve tablolar CAGRI ANINDA okunur; modul duzeyinde turetilmis sabit yoktur.
//
// Takas: Gonder kaynagi olan, FUND'da acik ve en az 2 teslim edilebilir varligi olan aglarda (BNB/ATS icin ayricalik yok).
// Kopru: kaynak cift herhangi bir Gonder kaynagidir; hedef, kaynaktan baska, FUND'da acik ve teslim edilebilir varligi olan ag.

// Bir agda kendine teslim edilebilen varliklar (privateAssetsFor sirasiyla); ag tabloda ya da FUND'da acik degilse bos.
// privateFundDeliverable ile ayni yapi: ag satirinin yerel coin sembolu kaynak varlik olabilir.
export function selfDeliverableAssets(chainId) {
    const row = deliveryChainOf(chainId)
    if (!row || !isDeliveryChainOpen('fund', row.chainId)) return []
    return privateAssetsFor({ chainId: row.chainId, nativeCurrency: { symbol: row.nativeSymbol } })
}

// Takas hedefleri: ayni agda kaynak varlik disindaki teslim edilebilir varliklar. Kaynak varlik listede degilse bos.
export function selfSwapTargets(chainId, asset) {
    const all = selfDeliverableAssets(chainId)
    if (typeof asset !== 'string' || !all.includes(asset)) return []
    return all.filter((s) => s !== asset)
}

// Kopru hedefleri: FUND'da acik, teslim edilebilir varligi olan, kaynaktan baska aglar (tablo sirasiyla). Kaynak agin FUND'da
// acik olmasi gerekmez (yalniz tabloda olmali); Gonder kaynagi olma sarti cagiranin kaynak listesinde aranir.
export function selfBridgeTargets(chainId) {
    const source = deliveryChainOf(chainId)
    if (!source) return []
    return openDeliveryChains('fund')
        .filter((c) => c.chainId !== source.chainId && selfDeliverableAssets(c.chainId).length > 0)
        .map((c) => c.chainId)
}

// Takas kaynak zincirleri: Gonder kaynagi zincirlerden en az 2 teslim edilebilir varligi olanlar (girdinin sirasi ve kayitlari korunur).
export function selfSwapSourceChains(chains) {
    return privateSourceChains(chains).filter((c) => selfDeliverableAssets(Number(c.chainId)).length >= 2)
}

// Kipe gore kaynak zincir listesi: swap = Takas kaynaklari, digerleri (bridge dahil) = tum Gonder kaynaklari.
export function selfSourceChains(mode, chains) {
    return mode === 'swap' ? selfSwapSourceChains(chains) : privateSourceChains(chains)
}

// Teslim tokeni (donmus tekil ya da SDK kaydindan normalize); teslim edilebilir degilse null. Sembol once teslim listesinde
// aranir, bu yuzden getAssetOnChain bos donmez ve normalizeDeliveryToken firlatmaz.
export function selfDeliveryTokenOf(chainId, symbol) {
    if (typeof symbol !== 'string' || !selfDeliverableAssets(chainId).includes(symbol)) return null
    const row = deliveryChainOf(chainId)
    if (symbol === 'USDC') return usdcTokenOf(row.chainId)
    if (symbol === row.nativeSymbol) return nativeTokenOf(row.chainId)
    const asset = getAssetOnChain(symbol, row.chainId)
    return normalizeDeliveryToken({ chainId: row.chainId, address: asset.address, symbol, decimals: asset.decimals })
}

// Kipin baslangic kaynagi: swap = ilk Takas cifti (bugun Ethereum USDC), digerleri ve bos Takas listesi = BSC USDC. Her cagrida yeni nesne.
export function defaultSelfSource(mode) {
    if (mode === 'swap') {
        const first = sourcePairs(selfSwapSourceChains(LISTED_CHAINS))[0]
        if (first) return { chainId: first.chainId, asset: first.asset }
    }
    return { chainId: PAYOUT_CHAIN_ID, asset: 'USDC' }
}
