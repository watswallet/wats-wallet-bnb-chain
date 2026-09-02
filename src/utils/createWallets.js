import { ethers } from "ethers"

function createEVMWallet() {
  const wallet = ethers.Wallet.createRandom()
  return {
    privateKey: wallet.privateKey,
    publicKey: wallet.publicKey,
    address: wallet.address,
    mnemonic: wallet.mnemonic.phrase
  }
}

export async function createWallets(){
  try {
    const evmWallet = createEVMWallet()
    return evmWallet
    
  } catch (error) {
    console.error("Hata oluştu:", error)
  }
}