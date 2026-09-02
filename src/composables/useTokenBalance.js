import { ethers } from "ethers"
import { isNativeAsset } from "../utils/nativeAsset"
import { isStillPending } from "../utils/pendingTransactions"

export const useTokenBalance = async (walletAddress, tokenAddress, rpcUrl) => {
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

      const abi = [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
      ]
      const contract = new ethers.Contract(tokenAddress, abi, provider)
      const raw = await contract.balanceOf(walletAddress)

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