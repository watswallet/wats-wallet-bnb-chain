import { ethers } from "ethers"
import { networkStore } from "../store/network"

export const getEstimatedGas = async (from, to, amount, data) => {
  const network = networkStore()
  const provider = new ethers.JsonRpcProvider(network.rpc)

  try {
    if (!ethers.isAddress(from)) throw new Error("Invalid from")
    if (!ethers.isAddress(to)) throw new Error("Invalid to")

    const isContractCall = !!data && data !== "0x"

    let txRequest

    if (isContractCall) {
      // Token transfer veya herhangi bir contract call
      txRequest = {
        from,
        to,        // TOKEN ise: token kontratı olmalı
        data,
        value: 0n
      }
    } else {
      // Native transfer
      const numAmount = Number(amount)
      if (isNaN(numAmount) || numAmount < 0) throw new Error("Invalid amount")

      txRequest = {
        from,
        to,
        value: ethers.parseEther(numAmount.toString())
      }
    }

    const estimatedGas = await provider.estimateGas(txRequest)
    const feeData = await provider.getFeeData()

    // ethers v6'nin FeeData'sinda `lastBaseFeePerGas` YOK: eski EIP-1559 dali hicbir
    // zaman calismiyor, her seferinde gasPrice'a dusuluyordu. Islem
    // maxFeePerGas ile gonderildigi icin gosterilecek tavan da odur.
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 3_000_000_000n

    const gasCostWei = estimatedGas * gasPrice
    return ethers.formatEther(gasCostWei)

  } catch (error) {
    console.error("Gas estimation failed:", error.message)

    const feeData = await provider.getFeeData().catch(() => ({}))
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 3_000_000_000n

    const fallbackGas = data ? 60000n : 21000n
    const gasCostWei = fallbackGas * gasPrice

    return ethers.formatEther(gasCostWei)
  }
}
