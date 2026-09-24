import raw from './supported_chains.json'
import { SOLANA_ENABLED } from '../utils/featureFlags'

// Cuzdanin DESTEKLEDIGI zincir kayitlari — JSON'un YERINE gecen tek giris.
//
// JSON'u DOGRUDAN import etmeyin. Solana kaydinin listede olup olmamasi bir
// derleme karari (SOLANA_ENABLED) ve JSON kosullu import EDILEMEZ; bu modul o
// karari tek yerde uygular. Kayit listeden dustugunde `chainVm` Solana'yi hic
// gormez, `getNetworkByChainId` cozemez ve butun Solana arayuz dallari — ag
// secici, kapsam pili, varlik listeleri, explorer — kendiliginden olur.
//
// Filtre `vm === 'solana'` uzerinden: kaydin kimligi ('solana-mainnet') degisebilir
// ama VM alani zincirin tipini soyleyen alandir (bkz. utils/vm.js).
export default SOLANA_ENABLED ? raw : raw.filter((c) => c.vm !== 'solana')
