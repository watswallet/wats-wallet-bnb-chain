// BIRIM SINIRI - HARCAMA TARAFI.
//
// bStocks BEP-677 "Scaled UI Amount" uyguluyor: ham bakiyeler degismez, yalnizca
// okunabilir gosterim etkilenir (uiAmount = raw * uiMultiplier / 1e18). Yani
// GORUNEN bakiye UI birimindedir ama transfer/approve/swap HAM birimde calisir.
//
// useTokenBalance artik bStock'ta balanceOfUI okuyor; MAX dugmesi de o sayiyi
// yaziyor. Ekrandaki sayi parseUnits'ten gecirilip DOGRUDAN zincire verilseydi
// istenen miktar ham bakiyeden BUYUK olur ve islem DUSERDI. Bu dosya o cevrimi
// tek yerde tutuyor: buildTransaction.js (gonderim) ve swap.js (takas) ayni
// fonksiyonu cagiriyor, boylece biri duzelip digeri geride kalamaz.
//
// KOPRU BU DOSYAYI KULLANMAZ - BILEREK. bStocks kopru yolundan TAMAMEN DISLANDI
// (bridge.js `bridgeQuote` kapisi + bridgeFrom.vue secici filtresi), cunku
// spec'e gore LI.FI bu tokenlere rota bulamiyor. Cevrilecek bir harcama yolu
// olmadigi icin gosterim/harcama birim asimetrisi de olusamaz.
//
// CARPAN ONBELLEKLENMEZ: ihracci onu degistirebilir (temettu yeniden yatirimi,
// hisse bolunmesi) ve bayat bir carpanla hesaplanan miktar yine ham bakiyeyi
// asabilir. Her islemde zincirden taze okunur.

import { ethers } from 'ethers'
import { isBStock, rawFromUiAmount, UI_MULTIPLIER_ONE } from './bstocks'

const UI_MULTIPLIER_ABI = ['function uiMultiplier() view returns (uint256)']

// Tasinabilir hata. swapRoutes.js'teki LIQUIDITY_GATE_ERROR / NO_ROUTE_ERROR ile ayni
// desen: sabit, greplenebilir bir metin; cagiran taraf `includes` ile tanir.
export const BSTOCK_MULTIPLIER_ERROR = 'Tokenized stock multiplier unavailable'

// Zincirden carpani okur. bStock DEGILSE zincire HIC SORULMAZ (gereksiz eth_call
// ve her gonderime eklenen gecikme yok) ve 1e18 doner.
//
// bStock ISE ve carpan okunamiyorsa FIRLATIR - sessizce 1e18'e DUSMEZ.
//
// DUSUM YONU BILEREK TERSINE CEVRILDI (inceleme bulgusu I-2). Ilk yazimda gerekce
// "en kotu ihtimalle duzeltme oncesi davranis" idi; bu ARTIK GECERLI DEGIL, cunku
// ekranda gosterilen bakiye ZATEN carpanli (useTokenBalance balanceOfUI okuyor).
// Sessizce 1e18'e dusmek su iki sonucu verir:
//   - MAX'ta: istenen miktar ham bakiyeyi YUZDE OLCEGINDE asar, islem revert eder
//     ve kullanici bosuna gaz yakar.
//   - MAX altinda: kullanici yazdigindan SESSIZCE FAZLA gonderir.
// Gecici bir RPC hatasi bunlarin ikisini de tetikleyebilirdi. Durmak dogru: hicbir
// sey imzalanmaz, gaz yanmaz.
export async function readUiMultiplier(provider, chainId, tokenAddress) {
  if (!isBStock(chainId, tokenAddress)) return UI_MULTIPLIER_ONE

  let okunan
  try {
    const contract = new ethers.Contract(tokenAddress, UI_MULTIPLIER_ABI, provider)
    okunan = BigInt(await contract.uiMultiplier())
  } catch (e) {
    throw new Error(`${BSTOCK_MULTIPLIER_ERROR}: ${tokenAddress} (${e?.message || e})`)
  }

  // 0 bolmede patlardi; anlamsiz deger de miktari ucururdu. Okuma "basarili" gorunse
  // bile bu bir carpan DEGILDIR, yani yine bilinmiyor demektir.
  if (okunan <= 0n) {
    throw new Error(`${BSTOCK_MULTIPLIER_ERROR}: ${tokenAddress} (uiMultiplier=${okunan})`)
  }

  return okunan
}

// EKRANDAKI miktar (parseUnits'ten gecmis UI birimi) -> ZINCIRE giden HAM miktar.
//
// rawFromUiAmount tabana yuvarliyor ve applyUiMultiplier de tabana yuvarliyor;
// gidis-donus bu yuzden baslangictaki ham degeri SAF BIGINT yolunda ASLA asmaz
// (bstocks.test.js'te 2 milyon vakayla fuzz'landi).
//
// KESIN KONUSALIM: gercek boru hattinda bu garanti TAM DEGIL, cunku arada bir
// kayan nokta adimi var (useTokenBalance `Number(formatUnits(...))` donduruyor).
// Olculdu: asim en fazla birkac bin wei ve AYNI adim carpansiz duz ERC-20'lerde
// de var, yani bu commit'in urettigi bir sey degil. Buyuk olan tehlike -- carpan
// sapmasi, ~1e15 wei -- bu cevrimle kapaniyor (bkz. bstocksSpend.test.js).
export async function toRawSpendAmount({ provider, chainId, tokenAddress, parsedAmount }) {
  if (typeof parsedAmount !== 'bigint') return parsedAmount
  if (!isBStock(chainId, tokenAddress)) return parsedAmount

  const multiplier = await readUiMultiplier(provider, chainId, tokenAddress)
  return rawFromUiAmount(parsedAmount, multiplier)
}

// Cagiran chainId gecmediyse RPC UCUNUN kendisinden cozulur. Boylece chainId ile
// provider birbirini TUTMAK ZORUNDA kalir: yanlis zincirde bStock kolu acilamaz.
// Cozulemezse null doner ve kol ACILMAZ (eski davranis birebir korunur).
export async function chainIdOfProvider(provider) {
  try {
    const net = await provider?.getNetwork?.()
    return net?.chainId ?? null
  } catch {
    return null
  }
}
