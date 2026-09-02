// PackedUserOperation (EntryPoint v0.7/v0.8) alan paketleme.
//
// KRITIK: alan SIRASI. accountGasLimits = verification | call, gasFees = priority | max.
// Ters cevirmek ayni uzunlukta ama YANLIS bir 32-byte kelime uretir ve hata ancak
// zincirde ortaya cikar (kaynak belge bolum 6).
import { ethers } from 'ethers'

// 16 byte'lik sol-sifir-dolgulu hex. Deger 16 byte'a sigmazsa ethers hata verir (istenen).
const hex16 = (v) => ethers.toBeHex(BigInt(v), 16)

export function packAccountGasLimits(verificationGasLimit, callGasLimit) {
  return ethers.concat([hex16(verificationGasLimit), hex16(callGasLimit)])
}

export function packGasFees(maxPriorityFeePerGas, maxFeePerGas) {
  return ethers.concat([hex16(maxPriorityFeePerGas), hex16(maxFeePerGas)])
}

// prefix TAM 52 byte olmali: 20 byte paymaster + 32 byte paymaster gaz limitleri.
// Backend imzasi bu baytlari kapsadigi icin YENIDEN PAKETLENMEZ, oldugu gibi birlestirilir;
// aksi halde zincirde AA34 signature error alinir (kaynak belge bolum 5).
// paymasterData: "0x" + CIFT sayida hex basamak. Bos/"0x" normal modun degeridir.
// KORLEMESINE .slice(2) YAPILMAZ: 0x'siz bare hex gelirse ilk BYTE sessizce silinir
// (77 byte'lik bootstrap imzasi 76'ya duser) ve hata ancak zincirde AA34 olarak
// gorunur - hem de yalnizca bootstrap kullanicilarinda. Sekil bozuksa DUR.
const HEX_BYTES_RE = /^0x([0-9a-fA-F]{2})*$/

export function joinPaymasterAndData(prefix, paymasterData) {
  if (typeof prefix !== 'string' || !/^0x[0-9a-fA-F]{104}$/.test(prefix)) {
    throw new Error('paymasterAndDataPrefix tam 52 byte olmali')
  }
  if (paymasterData == null || paymasterData === '0x') return prefix
  if (typeof paymasterData !== 'string' || !HEX_BYTES_RE.test(paymasterData)) {
    throw new Error('paymasterData 0x on ekli, cift basamakli hex olmali')
  }
  return prefix + paymasterData.slice(2)
}

// 7702'de factory yoktur -> initCode her zaman 0x.
export function buildPackedUserOp({
  sender, nonce, callData, gas, maxPriorityFeePerGas, maxFeePerGas, paymasterAndData, signature = '0x',
}) {
  return {
    sender,
    nonce: ethers.toBeHex(BigInt(nonce)),
    initCode: '0x',
    callData,
    accountGasLimits: packAccountGasLimits(gas.verificationGasLimit, gas.callGasLimit),
    preVerificationGas: ethers.toBeHex(BigInt(gas.preVerificationGas)),
    gasFees: packGasFees(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData,
    signature,
  }
}
