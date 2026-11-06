import { describe, it, expect } from 'vitest'
import { Interface, AbiCoder } from 'ethers'
import { MULTICALL3_ADDRESS } from './evmUsageTokens'
import { encodeBalancesCall, decodeBalancesResult, anyPositive } from './multicallBalances'

const OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const T1 = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const T2 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const T3 = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

const IFACE = new Interface([
    'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
    'function balanceOf(address) view returns (uint256)',
])
const word = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0')

// Sahte Multicall3 yaniti: her giris [success, returnData].
const aggResult = (entries) => IFACE.encodeFunctionResult('aggregate3', [entries])
const ok = (n) => [true, word(n)]

describe('encodeBalancesCall', () => {
    it('aggregate3 secicisi ve her token icin allowFailure=true + balanceOf(owner) uretir', () => {
        const data = encodeBalancesCall(OWNER, [T1, T2])
        expect(data.startsWith('0x82ad56cb')).toBe(true) // aggregate3((address,bool,bytes)[])
        const parsed = IFACE.decodeFunctionData('aggregate3', data)
        const calls = parsed[0]
        expect(calls.length).toBe(2)
        expect(calls[0][0]).toBe(T1)
        expect(calls[1][0]).toBe(T2)
        expect(calls.every((c) => c[1] === true)).toBe(true)
        const balanceOf = IFACE.encodeFunctionData('balanceOf', [OWNER])
        expect(calls.every((c) => c[2] === balanceOf)).toBe(true)
        expect(balanceOf.startsWith('0x70a08231')).toBe(true)
    })

    it('adres kucuk harfle de verilse ayni cagri verisi uretir', () => {
        expect(encodeBalancesCall(OWNER.toLowerCase(), [T1.toLowerCase()])).toBe(encodeBalancesCall(OWNER, [T1]))
    })

    it('gecersiz owner, gecersiz token ya da bos liste icin null doner, firlatmaz', () => {
        expect(encodeBalancesCall('0x123', [T1])).toBeNull()
        expect(encodeBalancesCall(undefined, [T1])).toBeNull()
        expect(encodeBalancesCall(OWNER, ['nope'])).toBeNull()
        expect(encodeBalancesCall(OWNER, [])).toBeNull()
        expect(encodeBalancesCall(OWNER, null)).toBeNull()
        expect(encodeBalancesCall(OWNER, undefined)).toBeNull()
    })

    it('Multicall3 adresi sabittir (hedef adresi cagiran verir)', () => {
        expect(MULTICALL3_ADDRESS).toBe('0xcA11bde05977b3631167028862bE2a173976CA11')
    })
})

describe('decodeBalancesResult', () => {
    it('basarili yanit: token basina BigInt bakiye', () => {
        const res = decodeBalancesResult(aggResult([ok(0), ok(1_500_000), ok(0)]), 3)
        expect(res).toEqual([0n, 1_500_000n, 0n])
    })

    it("2^53'u asan bakiyeler BigInt olarak dogru okunur (Number kaybi yok)", () => {
        const big = 2n ** 200n + 7n
        const res = decodeBalancesResult(aggResult([ok(big)]), 1)
        expect(res).toEqual([big])
        expect(res[0] > 0n).toBe(true)
    })

    it('allowFailure: basarisiz alt cagri null olur, digerleri okunur', () => {
        const res = decodeBalancesResult(aggResult([[false, '0x'], ok(5), [false, word(99)]]), 3)
        expect(res).toEqual([null, 5n, null])
    })

    it('alt cagri basarili ama veri 32 bayt degil (EOA/0x, kisa, uzun) -> o giris null', () => {
        const res = decodeBalancesResult(
            aggResult([
                [true, '0x'], // kontrat olmayan adres
                [true, '0x' + '00'.repeat(31)], // 31 bayt
                [true, '0x' + '00'.repeat(33)], // 33 bayt
                [true, '0x' + '01'.padStart(64, '0') + '00'.repeat(32)], // 64 bayt
                ok(3),
            ]),
            5
        )
        expect(res).toEqual([null, null, null, null, 3n])
    })

    it('bozuk yanit: hex degil / bos / kesik / tek sayili uzunluk -> null', () => {
        expect(decodeBalancesResult('oops', 1)).toBeNull()
        expect(decodeBalancesResult('0x', 1)).toBeNull()
        expect(decodeBalancesResult('', 1)).toBeNull()
        expect(decodeBalancesResult('0xzz', 1)).toBeNull()
        expect(decodeBalancesResult('0x123', 1)).toBeNull()
        expect(decodeBalancesResult(undefined, 1)).toBeNull()
        expect(decodeBalancesResult(null, 1)).toBeNull()
        expect(decodeBalancesResult(42, 1)).toBeNull()
        const good = aggResult([ok(1), ok(2)])
        expect(decodeBalancesResult(good.slice(0, good.length - 64), 2)).toBeNull() // kesik
        expect(decodeBalancesResult(word(32), 1)).toBeNull() // yalniz ofset
    })

    it('ABI cozulur ama dizi uzunlugu beklenenden farkli -> null (sinyal yok)', () => {
        expect(decodeBalancesResult(aggResult([ok(1), ok(2)]), 3)).toBeNull()
        expect(decodeBalancesResult(aggResult([ok(1), ok(2)]), 1)).toBeNull()
        expect(decodeBalancesResult(aggResult([]), 1)).toBeNull()
    })

    it('kotu niyetli devasa uzunluk iddiasi (dizi uzunlugu 2^64) -> null, firlatmaz', () => {
        const evil = '0x' + word(32).slice(2) + word(2n ** 64n).slice(2)
        expect(decodeBalancesResult(evil, 1)).toBeNull()
        const coder = AbiCoder.defaultAbiCoder()
        const huge = coder.encode(['uint256'], [2n ** 255n])
        expect(decodeBalancesResult(huge, 1)).toBeNull()
    })

    it('cok buyuk yanit (rastgele sismis veri) reddedilir', () => {
        const big = '0x' + 'ab'.repeat(20_000)
        expect(decodeBalancesResult(big, 1)).toBeNull()
    })

    it('beklenen sayi gecersizse (0, negatif, NaN, sayi degil) null', () => {
        const good = aggResult([ok(1)])
        expect(decodeBalancesResult(good, 0)).toBeNull()
        expect(decodeBalancesResult(good, -1)).toBeNull()
        expect(decodeBalancesResult(good, NaN)).toBeNull()
        expect(decodeBalancesResult(good, '1')).toBeNull()
    })
})

describe('anyPositive', () => {
    it('en az bir bakiye > 0n ise true', () => {
        expect(anyPositive([0n, 1n, null])).toBe(true)
        expect(anyPositive([null, 2n ** 200n])).toBe(true)
    })

    it('hepsi 0n/null ise false', () => {
        expect(anyPositive([0n, 0n, null])).toBe(false)
        expect(anyPositive([null, null])).toBe(false)
        expect(anyPositive([])).toBe(false)
    })

    it('dizi olmayan girdide false (null donusu "sinyal yok")', () => {
        expect(anyPositive(null)).toBe(false)
        expect(anyPositive(undefined)).toBe(false)
    })
})
