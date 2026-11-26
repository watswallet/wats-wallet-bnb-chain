// mintDisplay.js -- onay ekraninda bir mint'in GOSTERIM etiketi. SAF katman (ag yok, chrome yok).
//
// Etiket kaynagi YALNIZ iki yerdir (Constraint 27): istemci kurasyonlu tablosu ve native wSOL.
// Simulasyonun/dapp'in soyledigi sembol ASLA kullanilmaz.
//
// wSOL (native mint) kurasyonlu tabloya EKLENMEZ (tablo sunucu dosyasiyla esit kilitli); bu
// yuzden gosterim katmaninda ozel durumdur. Native mint adresi sabittir ve 9 decimals'tir:
// decimals 9 degilse (bozuk/celisen veri) etiket VERILMEZ.
import { NATIVE_MINT_ADDRESS, SOL_DECIMALS } from './constants'
import { curatedMintInfo } from '../../data/solanaCuratedMints'

export const WSOL_SYMBOL = 'wSOL'

/** @returns {string|null} dogrulanmis etiket (kurasyonlu sembol ya da 'wSOL'); yoksa null. */
export function mintDisplaySymbol(mint, decimals) {
    if (mint === NATIVE_MINT_ADDRESS) return decimals === SOL_DECIMALS ? WSOL_SYMBOL : null
    const cur = curatedMintInfo(mint)
    return cur !== null && cur.decimals === decimals ? cur.symbol : null
}
