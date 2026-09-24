import { ethers } from "ethers"
import { isNativeAsset } from "../utils/nativeAsset"
import { isStillPending } from "../utils/pendingTransactions"
import { isBStock } from "../utils/bstocks"

// `chainId` DORDUNCU parametre olarak sonradan eklendi: fonksiyon hangi zincirde
// oldugunu BILMIYORDU (yalniz rpcUrl aliyordu) ve bStock kolu onsuz acilamaz.
// Verilmezse kol ACILMAZ, yani eski davranis aynen korunur.
export const useTokenBalance = async (walletAddress, tokenAddress, rpcUrl, chainId) => {
  const provider = new ethers.JsonRpcProvider(rpcUrl)

  try {
    const isNative = isNativeAsset(tokenAddress)
    let actualBalance = 0;

    // 1. ADIM: AĞDAN GERÇEK (ON-CHAIN) BAKİYEYİ ÇEK
    if (isNative) {
      const balance = await provider.getBalance(walletAddress)
      actualBalance = Number(ethers.formatEther(balance))
    } else {
      const code = await provider.getCode(tokenAddress)
      if (code === '0x') throw new Error('Bu adreste kontrat yok (yanlış ağ?)')

      // bStocks BEP-677 "Scaled UI Amount" uyguluyor: ham bakiyeler degismez,
      // yalnizca okunabilir gosterim etkilenir. Yani balanceOf carpani UYGULAMAZ
      // ve duz okuyan cuzdan bakiyeyi EKSIK gosterir. 2026-09-18'de 22 tokenin
      // 5'inde sapma vardi; bir hisse bolunmesinde (4:1) hata %300 olur.
      //
      // balanceOfUI TERCIH EDILDI (balanceOf * uiMultiplier / 1e18 yerine):
      // tek cagri, matematik zincirde, yuvarlama tartismasi yok.
      //
      // DIKKAT: burasi GOSTERIM yolu. Harcama yolu HAM birimde kalir ve
      // rawFromUiAmount ile cevrilir (buildTransaction.js, swap.js). Ikisini
      // karistirmak MAX'i her seferinde revert ettirir.
      const isScaled = isBStock(chainId, tokenAddress)
      const abi = [
        'function balanceOf(address) view returns (uint256)',
        'function balanceOfUI(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
      ]
      const contract = new ethers.Contract(tokenAddress, abi, provider)

      let raw
      if (isScaled) {
        try {
          raw = await contract.balanceOfUI(walletAddress)
        } catch {
          // Beacon yukseltmesi arayuzu kaldirirsa ham bakiyeye dus: eksik veri
          // yuzunden bakiyeyi GIZLEMEKTENSE zincirdeki degeri gostermek dogru.
          console.warn(`balanceOfUI cevap vermedi, balanceOf'a dusuluyor: ${tokenAddress}`)
          raw = await contract.balanceOf(walletAddress)
        }
      } else {
        raw = await contract.balanceOf(walletAddress)
      }

      let decimals = 18
      try {
        decimals = await contract.decimals()
      } catch {
        console.warn(`decimals() yok veya decode edilemedi: ${tokenAddress}`)
      }

      actualBalance = Number(ethers.formatUnits(raw, decimals))
    }

    // 2. ADIM: PENDING İŞLEMLERİ ÇEK VE "GÖLGE BAKİYE" (SHADOW BALANCE) DÜŞÜŞÜNÜ HESAPLA
    let pendingDeduction = 0;
    try {
      const { pending_transactions = [] } = await chrome.storage.local.get('pending_transactions');
      
      for (const tx of pending_transactions) {
        // 🔥 Yalnızca GERÇEKTEN bekleyen işlemler düşülür. Onaylanmış (receipt_status
        // '1'/'0') veya çözülemeyecek kadar eskimiş kayıtlar zincirdeki bakiyeye zaten
        // yansımıştır; düşülmeye devam edilirse bakiye kalıcı olarak eksik görünür.
        if (!isStillPending(tx)) continue;

        // İşlemi yapan kişi bizim cüzdanımız değilse atla (Başkası bize gönderiyorsa bakiyeyi önceden artırmayız, onaylanmasını bekleriz)
        if (tx.from_address.toLowerCase() !== walletAddress.toLowerCase()) continue;

        if (isNative) {
            // NATIVE SORGUSU (ETH/BNB):
            // 1. Gönderilen Native miktar varsa onu düş
            if (tx.value && tx.value !== "0") {
              pendingDeduction += Number(ethers.formatEther(tx.value));
            }
            // 2. 🔥 KRİTİK: İşlem ne olursa olsun (Approve, Swap, Token Send), Gas ücreti Native bakiyeden düşer!
            if (tx.transaction_fee) {
              pendingDeduction += Number(tx.transaction_fee);
            }
        } else {
            // ERC-20 SORGUSU (TOKEN):
            // Bu token'a ait herhangi bir "giden" transfer varsa bakiyeden düş.
            if (tx.erc20_transfers && Array.isArray(tx.erc20_transfers)) {
              // BIRIM TUTARLILIGI (2026-09-18'de dogrulandi): `value_formatted` burada
              // HER ZAMAN UI birimindedir, ham birim degil. Bunu yazan uc uretici de
              // (processTransaction.js: buildPendingSkeleton, buildSwapPendingSkeleton,
              // buildCrossChainPendingSkeleton) kullanicinin gordugu/yazdigi sayiyi
              // dogrudan yazar - sirasiyla crypto.transactionData.amount
              // (ConfirmTransaction.vue, SEND_TRANSACTION mesaji) ve amountHumanReadable
              // (swap.js). Ham cevrim (parseUnits / rawFromUiAmount) YALNIZCA calldata
              // icin buildTransaction.js ve swap.js icinde yapilir; bekleyen islem
              // kaydina hic girmez.
              //
              // Yukaridaki `actualBalance` de bStock'ta balanceOfUI'den geliyor, yani UI
              // biriminde. Iki taraf ayni birimde oldugu icin golge bakiye dusumu
              // bStock'ta da TUTARLI.
              //
              // NOT gelecekteki bakimciya: burada eskiden "BIRIM KARISIMI" iddia eden
              // yanlis bir yorum vardi. O notu "duzeltmeye" calisip degeri ham birime
              // cevirme - kusuru sen yaratirsin. Suphelenirsen once
              // processTransaction.js:6 (amountStr = msgData.amount) izini sur.
              for (const transfer of tx.erc20_transfers) {
                if (transfer.direction === "send" && transfer.token_address?.toLowerCase() === tokenAddress.toLowerCase()) {
                  if (transfer.value_formatted) {
                    pendingDeduction += Number(transfer.value_formatted);
                  }
                }
              }
            }
        }
      }
    } catch (storageError) {
      console.warn("Gölge bakiye hesaplanırken Storage hatası:", storageError);
    }

    // 3. ADIM: SONUCU HESAPLA (Negatife düşmesine izin verme)
    const finalBalance = actualBalance - pendingDeduction;
    return finalBalance > 0 ? finalBalance : 0;

  } catch (error) {
    throw new Error(`Token bilgileri alınamadı: ${error.message}`)
  }
}