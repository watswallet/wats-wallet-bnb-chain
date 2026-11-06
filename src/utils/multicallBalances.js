// Multicall3.aggregate3 ile cok tokenlik balanceOf sorgusu: kodlama ve GUVENLI cozme.
//
// SAF katman: ag yok, depo yok. evmUsageProbe.js bu iki fonksiyonla tek bir eth_call kurar
// ve yanitini cozer (bkz. evmUsageTokens.js: neden Multicall3).
//
// GUVENLIK: yanit genel bir RPC'den gelir ve kotu niyetli/bozuk olabilir. Bu yuzden
//   - cozme her zaman try/catch icindedir; ABI hatasi, kesik veri ya da yanlis uzunluk
//     "sinyal yok" (null) demektir, ASLA firlatmaz ve ASLA 'kullanilmis' demez;
//   - beklenen eleman sayisi cagiranin bildigi sayidir (yanit baska sayida eleman iddia
//     ederse reddedilir);
//   - yanit boyutu sinirlidir (ag basina <= 6 token icin bir kac yuz bayt beklenir);
//   - bakiyeler BigInt'tir (2^53 ustu degerlerde Number kaybi yok);
//   - her alt cagri yalniz success=true VE tam 32 baytlik donus verisi tasiyorsa sayilir.
//     Kontrat olmayan bir adrese yapilan cagri success=true + bos veri doner: o giris
//     "bakiye yok" degil "sinyal yok"tur.
import { Interface, getAddress } from 'ethers'
import { MULTICALL3_ADDRESS } from './evmUsageTokens'

export { MULTICALL3_ADDRESS }

const IFACE = new Interface([
    'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
    'function balanceOf(address) view returns (uint256)',
])

// Beklenen yanit en fazla ~1 KB; bunun ~4 kati bile fazlasiyla yeter. Sisirilmis yanit reddedilir.
const MAX_RESULT_HEX_CHARS = 2 + 2 * 4096
const HEX_EVEN_RE = /^0x(?:[0-9a-fA-F]{2})+$/
// 0x + 32 bayt
const WORD_HEX_LEN = 66

/**
 * `aggregate3` cagri verisi: her token icin allowFailure=true ile balanceOf(owner).
 * Gecersiz owner/token ya da bos liste icin null (cagiran token yoklamasini atlar).
 *
 * @param {string} owner hesap adresi
 * @param {string[]} tokens token sozlesme adresleri
 * @returns {string|null} 0x... calldata
 */
export function encodeBalancesCall(owner, tokens) {
    try {
        if (!Array.isArray(tokens) || tokens.length === 0) return null
        const balanceOf = IFACE.encodeFunctionData('balanceOf', [getAddress(owner)])
        const calls = tokens.map((token) => ({ target: getAddress(token), allowFailure: true, callData: balanceOf }))
        return IFACE.encodeFunctionData('aggregate3', [calls])
    } catch (e) {
        return null
    }
}

/**
 * `aggregate3` yanitini token basina bakiyeye cozer. ASLA firlatmaz.
 *
 * @param {unknown} resultHex eth_call sonucu
 * @param {number} expectedCount sorulan token sayisi
 * @returns {Array<bigint|null>|null} token basina BigInt bakiye (alt cagri basarisiz ya da
 *   bicimsizse null); yanit tamamen kullanilamazsa (bozuk, yanlis uzunluk) null
 */
export function decodeBalancesResult(resultHex, expectedCount) {
    try {
        if (!Number.isInteger(expectedCount) || expectedCount < 1) return null
        if (typeof resultHex !== 'string' || resultHex.length > MAX_RESULT_HEX_CHARS) return null
        if (!HEX_EVEN_RE.test(resultHex)) return null

        const decoded = IFACE.decodeFunctionResult('aggregate3', resultHex)[0]
        if (!decoded || decoded.length !== expectedCount) return null

        const balances = []
        for (let i = 0; i < expectedCount; i++) {
            const entry = decoded[i]
            const success = entry?.[0]
            const data = entry?.[1]
            if (success === true && typeof data === 'string' && data.length === WORD_HEX_LEN) {
                balances.push(BigInt(data))
            } else {
                balances.push(null)
            }
        }
        return balances
    } catch (e) {
        return null
    }
}

/** Cozulmus bakiyelerden en az biri > 0 mi? (null/dizi-olmayan -> false) */
export function anyPositive(balances) {
    return Array.isArray(balances) && balances.some((b) => typeof b === 'bigint' && b > 0n)
}
