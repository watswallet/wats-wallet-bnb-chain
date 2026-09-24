import supported_chains from './supportedChains'
import { chainSupportsFlow } from '../utils/chainKind'

// ARAMA icin tam liste. chainId cozumlemesi ASLA filtrelenmemeli; aksi halde dev build'de
// secilmis bir ag prod build'de cozulemez hale gelir.
export const ALL_CHAINS = supported_chains

// KULLANICIYA LISTELENEN aglar. Testnet'ler yalnizca dev build'de gorunur
// (vite: `npm run build:dev` -> MODE === 'development').
const isDevBuild = import.meta.env.MODE === 'development'
export const LISTED_CHAINS = supported_chains.filter((c) => isDevBuild || !c.testnet)

// Bir AKIS icin listelenecek aglar.
//
// Zincir secicilerinin sizinti agzi buydu: selectFromChain, selectToChains ve
// networksPopup LISTED_CHAINS'i FILTRESIZ listeliyordu ve TON mainnet o listede.
// Kullanici Kopru ekranindan iki tikla TON'a gecebiliyordu; ana ekrandaki `v-if`
// hicbir sey engellemiyordu.
//
// LISTED_CHAINS'ten TON'u TOPLUCA cikarmak YANLIS olurdu: ayni liste basliktaki ag
// secicide, kapsam pilinde ve varlik listelerinde de kullaniliyor ve TON'un oralarda
// GORUNMESI gerekiyor. Bu yuzden filtre akisa ozel; akis verilmezse liste aynen doner.
export function chainsForFlow(flow) {
    if (!flow) return LISTED_CHAINS
    return LISTED_CHAINS.filter((c) => chainSupportsFlow(c, flow))
}
