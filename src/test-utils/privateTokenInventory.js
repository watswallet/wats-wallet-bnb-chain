// GIZLI MODUN GOSTEREBILECEGI TUM (ag, token) CIFTLERI: logo kilidinin (utils/privacy/privateTokenLogo.guard.test.js) ENVANTERI.
//
// Liste ELLE YAZILMAZ: ekranlarin kendi kod yollarindan turetilir, bu yuzden yeni bir token (yeni ag, yeni kaynak varlik, yeni Depository satiri,
// yeni teslim tokeni) bu envantere kendiliginden girer ve logosu yoksa kilit kirmizi olur.
//   kaynak ciftleri      sourcePairs(LISTED_CHAINS) (Gonder / Para yukle kaynak secicisi) + Depository tablosunun TAMAMI (bayrak kapali olsa da)
//   teslim tokenleri     her teslim agi icin buildDeliveryTokenList (Gonder: yerel coin, USDC, BSC'de ATS) ve Para yukle / Takas / Kopru
//                        icin selfDeliverableAssets (USDT, DAI, ETH ... SDK kayit adresiyle)
//   takas / kopru hedefi selfSwapTargets / selfBridgeTargets
//   siparis kartlari     teslim agi + sembol (kayit adres tasimaz)
//   Home tohumu          privateSeedRows + her agin privateNativeRow'u
// ORTAM: selfRoutes Para yukle listesini CAGRI ANINDA ortamdan okur; cagiran (test) VITE_PRIVATE_FUND_CHAINS / VITE_PRIVATE_SEND_CHAINS'i
// tum teslim aglariyla vi.stubEnv ile kurmus olmali.
import { getAssetOnChain } from '@silentswap/sdk'
import { LISTED_CHAINS } from '../data/chains'
import { DELIVERY_CHAINS } from '../utils/privacy/deliveryChains'
import { buildDeliveryTokenList } from '../utils/privacy/deliveryTokens'
import { bridgedDepositoryFor } from '../utils/privacy/privateBridgedSources'
import { sourcePairs } from '../utils/privacy/sourceAssets'
import { selfBridgeTargets, selfDeliverableAssets, selfDeliveryTokenOf, selfSwapTargets } from '../utils/privacy/selfRoutes'
import { privateSeedRows, privateNativeRow } from '../utils/privacy/privateDefaultTokens'

export const ZERO = '0x0000000000000000000000000000000000000000'
const STABLES = ['USDC', 'USDT', 'DAI']

export function privateTokenInventory() {
    const byKey = new Map()
    const add = (chainId, address, symbol, surface) => {
        const id = Number(chainId)
        const addr = typeof address === 'string' ? address.toLowerCase() : null
        const key = `${id}:${addr ?? 'sym:' + symbol}`
        let e = byKey.get(key)
        if (!e) {
            const chain = DELIVERY_CHAINS.find((c) => c.chainId === id)
            e = { key, chainId: id, chainName: chain?.name ?? LISTED_CHAINS.find((c) => Number(c.chainId) === id)?.name ?? String(id), address: addr, symbol, surfaces: new Set() }
            byKey.set(key, e)
        }
        e.surfaces.add(surface)
        return e
    }
    const registryAddress = (chainId, symbol) => getAssetOnChain(symbol, chainId)?.address ?? null

    // 1) Kaynak ciftleri: ekrandaki liste + Depository tablosunun tamami (PRIVATE_BRIDGED_SOURCES kapaliyken de logo hazir olsun).
    for (const p of sourcePairs(LISTED_CHAINS)) add(p.chainId, registryAddress(p.chainId, p.asset), p.asset, 'source')
    for (const chain of DELIVERY_CHAINS) {
        for (const s of [...STABLES, chain.nativeSymbol]) {
            if (bridgedDepositoryFor(chain.chainId, s) === null) continue
            const address = registryAddress(chain.chainId, s)
            if (address) add(chain.chainId, address, s, 'source')
        }
    }

    // 2) Teslim tokenleri. Gonder: acik liste (yerel coin acik, sunucu/ice aktarilan satirlari sonsuz oldugundan yalniz sabit satirlar).
    for (const chain of DELIVERY_CHAINS) {
        for (const t of buildDeliveryTokenList({ chainId: chain.chainId, nativeEnabled: true })) add(t.chainId, t.address, t.symbol, 'delivery-send')
        // Para yukle / Takas / Kopru: o agdaki Gonder kaynagi varliklari.
        for (const symbol of selfDeliverableAssets(chain.chainId)) {
            const t = selfDeliveryTokenOf(chain.chainId, symbol)
            for (const mode of ['fund', 'swap', 'bridge']) add(t.chainId, t.address, t.symbol, `delivery-${mode}`)
        }
    }
    // 3) Takas ve Kopru hedefleri.
    for (const p of sourcePairs(LISTED_CHAINS)) {
        for (const symbol of selfSwapTargets(p.chainId, p.asset)) {
            const t = selfDeliveryTokenOf(p.chainId, symbol)
            if (t) add(t.chainId, t.address, t.symbol, 'swap-target')
        }
    }
    for (const chain of DELIVERY_CHAINS) {
        for (const targetChainId of selfBridgeTargets(chain.chainId)) {
            for (const symbol of selfDeliverableAssets(targetChainId)) {
                const t = selfDeliveryTokenOf(targetChainId, symbol)
                if (t) add(t.chainId, t.address, t.symbol, 'bridge-target')
            }
        }
    }
    // 4) Siparis kartlari: kayit yalniz teslim agi + sembol tasir (adres yok); ayni semboller + yerel coin + her aga ETH (kopru) + BSC ATS.
    const orderSymbols = new Set(['USDC', 'USDT', 'DAI', 'ETH', 'ATS'])
    for (const chain of DELIVERY_CHAINS) orderSymbols.add(chain.nativeSymbol)
    for (const chain of DELIVERY_CHAINS) {
        for (const symbol of orderSymbols) {
            // Yalniz o agda gercekten teslim edilebilen semboller kart uretir; ATS yalniz BSC'de.
            const deliverable = symbol === 'USDC' || symbol === chain.nativeSymbol
                || selfDeliverableAssets(chain.chainId).includes(symbol)
                || (symbol === 'ATS' && chain.chainId === 56)
            if (deliverable) add(chain.chainId, null, symbol, 'order-card')
        }
    }
    // 5) Home tohumu ve yerel coin satiri (gizli hesabin ana ekrani).
    for (const row of privateSeedRows()) add(56, row.address === '0x0' ? ZERO : row.address, row.symbol, 'home-seed')
    for (const chain of DELIVERY_CHAINS) {
        const row = privateNativeRow(chain.chainId)
        if (row) add(chain.chainId, ZERO, row.symbol, 'home-native')
    }
    return [...byKey.values()].map((e) => ({ ...e, surfaces: [...e.surfaces].sort() }))
        .sort((a, b) => a.chainId - b.chainId || String(a.address).localeCompare(String(b.address)) || a.symbol.localeCompare(b.symbol))
}
