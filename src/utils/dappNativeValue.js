import { ethers } from 'ethers'

/**
 * eth_sendTransaction `value` alanini wei'ye cevirir.
 *
 * Deger HER bicimde WEI'dir: hex quantity ('0x38d7ea4c68000') onerilen bicim,
 * ama web3.js gibi kutuphaneler decimal string ('15000000000000000') ya da
 * Number da gonderir. Yalniz '0x' onekini wei saymak decimal-wei degeri ETH
 * sanip 1e18 kat sisiriyordu. '0x' tek basina yaygin bir SIFIR kodlamasidir;
 * BigInt('0x') firlatir ve onay ekraninin kurulumunu cokertiyordu.
 */
export function dappValueToWei(rawValue) {
    if (rawValue === undefined || rawValue === null) return 0n
    const s = String(rawValue).trim()
    if (s === '' || s === '0x') return 0n
    if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s)
    if (/^[0-9]+$/.test(s)) return BigInt(s)
    throw new Error('INVALID_TX_VALUE: ' + s)
}

/** Ayni degeri insan-okur ether dizgesi olarak verir ('0.015'); sifirda '0'. */
export function dappValueToEtherString(rawValue) {
    const wei = dappValueToWei(rawValue)
    return wei === 0n ? '0' : ethers.formatEther(wei)
}
