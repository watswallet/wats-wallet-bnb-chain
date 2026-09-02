import { ethers } from "ethers"
import { isNativeAsset } from "./nativeAsset"

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)"
]

// 🛠️ YENİ: Bilimsel gösterimleri (1e-9) ve fazla ondalıkları temizleyen yardımcı fonksiyon
function toFixedString(amount, decimals = 18) {
  let str = String(amount).toLowerCase();
  
  // Eğer bilimsel gösterimse (örn: 1e-9), düz string'e çevir
  if (str.includes('e')) {
    // max 20 decimal Web3 için genellikle yeterlidir
    str = Number(str).toFixed(20); 
  }

  // Ondalık kısmı tokenin desteklediği max limite göre kes (yuvarlama yapmadan)
  const [integer, fraction] = str.split('.');
  if (!fraction) return integer;

  const safeFraction = fraction.slice(0, decimals);
  return safeFraction ? `${integer}.${safeFraction}` : integer;
}


export async function buildTransaction({
  provider,
  from,
  to,
  amount,   // string: "0.01", "1e-9", vb. olabilir
  asset,    // null = native, address = ERC20
  data = "0x" // Varsayılan data Empty olmalı!
}) {

  // '0x0' ve 0xEeee... da native demek: bunlar ERC20 sanilirsa Contract('0x0').decimals()
  // reject eder ve gonderim hicbir hata gostermeden olur.
  const isNative = isNativeAsset(asset)

  // KONTRAT ADRESINI EIP-55'e NORMALIZE ET.
  //
  // 2026-08-09'da Ethereum'da bir ATS gonderimi "Invalid parameter." ile dustu: token
  // adresi uzak listeden `0x20bE3d...F750dEC1c8` diye geliyordu ve bu dizginin EIP-55
  // checksum'i TUTMUYORDU (dogrusu ...f750...). Adresin BAYTLARI dogru, yalniz harf
  // kasasi yanlis. ethers'in Contract'i buna hos gorulu davranip decimals()'i okuyor,
  // ama ABI kodlayicisi (execute(address dest,...) / transfer(address,...)) getAddress
  // ile REDDEDIYOR — yani cuzdan tokeni listeliyor, bakiyesini gosteriyor, ama gonderim
  // aninda opak bir hatayla patliyordu.
  //
  // Kucuk harfe dusurup yeniden checksum'lamak BURADA guvenli: bu adres kullanicinin
  // ELLE YAZDIGI bir sey degil, listeden secilen ve zincirde zaten okunmus bir kontrat.
  // Checksum'in korudugu sey transkripsiyon hatasidir ve o koruma ALICI adresinde
  // duruyor (Send.vue `ethers.isAddress` ile dogruluyor; oraya bozuk checksum GECEMEZ).
  const assetAddress = (!isNative && typeof asset === 'string' && ethers.isHexString(asset, 20))
    ? ethers.getAddress(asset.toLowerCase())
    : asset

  // 🔵 NATIVE TRANSFER (ETH, BNB, MATIC vs.)
  if (isNative) {
    // Native tokenlar standart 18 decimal kullanır
    const safeAmount = toFixedString(amount, 18)
    const value = ethers.parseEther(safeAmount)

    return {
      from,
      to,
      value,
      data // Dapp'ten gelen işlem verisi (data) varsa onu kullan
    }
  }

  // 🟣 HAM KONTRAT ÇAĞRISI (dapp): calldata varsa `asset` bir ERC20 değil, çağrılan
  // kontrattır. transfer() encode etmeye çalışma ve value'yu 0'a düşürme — dapp'in
  // istediği native value (ücretli mint, WETH deposit, swapExactETHForTokens) burada
  // taşınmazsa payable çağrı zincirde revert eder.
  if (data && data !== "0x") {
    return {
      from,
      to: to || assetAddress,
      value: ethers.parseEther(toFixedString(amount, 18)),
      data
    }
  }

  // 🔴 ERC20 TRANSFER
  const erc20 = new ethers.Contract(assetAddress, ERC20_ABI, provider)
  
  // Kontrattan decimal değerini okuyoruz
  const decimals = await erc20.decimals()

  // 🌟 ÇÖZÜM: Miktarı tokenin decimal'ine göre güvenli formata çeviriyoruz
  const safeAmount = toFixedString(amount, Number(decimals))
  const parsedAmount = ethers.parseUnits(safeAmount, decimals)

  const encodedData = erc20.interface.encodeFunctionData("transfer", [
    to,
    parsedAmount
  ])

  return {
    from,
    to: assetAddress,   // kontrata gidiyor (EIP-55 normalize)
    value: 0n,   // Not: ethers v6'da 0 yerine 0n (BigInt) kullanmak daha sağlıklıdır
    data: (data && data !== "0x") ? data : encodedData
  }
}