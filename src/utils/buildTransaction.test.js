import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { buildTransaction } from './buildTransaction'

const FROM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

// swapExactETHForTokens(...) benzeri, native value tasiyan bir dapp calldata'si
const PAYABLE_CALLDATA = '0x7ff36ab5000000000000000000000000000000000000000000000000000000000000000'

// decimals() cagirilmamasi gerektigini kanitlamak icin: cagrilirsa test patlar.
const explodingProvider = {
    call: () => { throw new Error('provider.call cagrilmamaliydi') }
}

describe('native transfer', () => {
    it('asset yoksa value tasinir, data bos kalir', async () => {
        const tx = await buildTransaction({ provider: explodingProvider, from: FROM, to: TO, amount: '1.5', asset: null })

        expect(tx.to).toBe(TO)
        expect(tx.value).toBe(ethers.parseEther('1.5'))
        expect(tx.data).toBe('0x')
    })

    it("asset '0x0' ise ERC-20 sanilmaz (kontrat cagrisi yapilmaz)", async () => {
        // Duzeltmeden once: new Contract('0x0').decimals() -> reject, gonderim sessizce olurdu.
        const tx = await buildTransaction({ provider: explodingProvider, from: FROM, to: TO, amount: '0.25', asset: '0x0' })

        expect(tx.to).toBe(TO)
        expect(tx.value).toBe(ethers.parseEther('0.25'))
    })

    it('0xEeee... placeholder da native kabul edilir', async () => {
        const tx = await buildTransaction({
            provider: explodingProvider, from: FROM, to: TO, amount: '2',
            asset: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
        })

        expect(tx.value).toBe(ethers.parseEther('2'))
    })

    it('bilimsel gosterimli miktar (1e-9) duzgun parse edilir', async () => {
        const tx = await buildTransaction({ provider: explodingProvider, from: FROM, to: TO, amount: '1e-9', asset: null })

        expect(tx.value).toBe(ethers.parseEther('0.000000001'))
    })
})

describe('dapp kontrat cagrisi (calldata var)', () => {
    it('dapp"in istedigi native value KORUNUR', async () => {
        // #13: value sessizce 0'a dusuyordu; odenmis mint / WETH deposit /
        // swapExactETHForTokens gibi payable cagrilar zincirde revert ediyordu.
        const tx = await buildTransaction({
            provider: explodingProvider,
            from: FROM,
            to: ROUTER,
            amount: '0.08',
            asset: ROUTER,
            data: PAYABLE_CALLDATA
        })

        expect(tx.value).toBe(ethers.parseEther('0.08'))
    })

    it('calldata degistirilmeden gecirilir ve to kontrattir', async () => {
        const tx = await buildTransaction({
            provider: explodingProvider, from: FROM, to: ROUTER, amount: '0.08',
            asset: ROUTER, data: PAYABLE_CALLDATA
        })

        expect(tx.data).toBe(PAYABLE_CALLDATA)
        expect(tx.to).toBe(ROUTER)
    })

    it('calldata varken ERC-20 transfer encode edilmeye CALISILMAZ', async () => {
        // explodingProvider: decimals() okunmaya kalkisilsa test patlardi.
        await expect(buildTransaction({
            provider: explodingProvider, from: FROM, to: ROUTER, amount: '0',
            asset: ROUTER, data: PAYABLE_CALLDATA
        })).resolves.toBeDefined()
    })

    it('value 0 olan kontrat cagrisi da calisir', async () => {
        const tx = await buildTransaction({
            provider: explodingProvider, from: FROM, to: ROUTER, amount: '0',
            asset: ROUTER, data: PAYABLE_CALLDATA
        })

        expect(tx.value).toBe(0n)
    })
})

describe('ERC-20 transfer', () => {
    // decimals() -> 6 donduren minimal sahte provider
    const sixDecimalsProvider = {
        call: async () => ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [6]),
        resolveName: async (n) => n
    }

    it('miktar token decimal"ine gore encode edilir ve value 0 olur', async () => {
        const tx = await buildTransaction({
            provider: sixDecimalsProvider, from: FROM, to: TO, amount: '12.5', asset: USDT
        })

        expect(tx.to).toBe(USDT)
        expect(tx.value).toBe(0n)

        const iface = new ethers.Interface(['function transfer(address to, uint256 amount)'])
        const decoded = iface.parseTransaction({ data: tx.data })
        expect(decoded.args[0]).toBe(TO)
        expect(decoded.args[1]).toBe(ethers.parseUnits('12.5', 6))
    })
})

// GERCEK VAKA (2026-08-09, Ethereum mainnet): ATS gonderimi onay ekranindan sonra
// "Invalid parameter." ile dustu. Sebep: uzak token listesinden gelen kontrat adresinin
// EIP-55 checksum'i tutmuyordu (`...Ea857F750dEC1c8`, dogrusu `...Ea857f750dEC1c8`).
// Baytlar dogru, yalniz harf kasasi yanlisti.
//
// Tuzagin can alici yani: ethers'in Contract'i bu adrese HOS GORULU davranir (decimals()
// okunur, bakiye gorunur, ucret teklifi bile alinir) ama ABI kodlayicisi getAddress ile
// REDDEDER. Yani hata ancak gonderim aninda, hem de opak bir mesajla ortaya cikar.
describe('checksum u bozuk kontrat adresi', () => {
    const sixDecimalsProvider = {
        call: async () => ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [6]),
        resolveName: async (n) => n
    }
    // Gercek olay kaydi: Ethereum ATS tokeni, yanlis kasayla.
    const BAD = '0x20bE3d6D519c5825715afa003Ea857F750dEC1c8'
    const GOOD = '0x20bE3d6D519c5825715afa003Ea857f750dEC1c8'

    it('once: bu adres ABI kodlayicidan GECMEZ (hatanin kaynagi)', () => {
        const execute = new ethers.Interface(['function execute(address dest, uint256 value, bytes func)'])
        expect(() => execute.encodeFunctionData('execute', [BAD, 0n, '0x'])).toThrow(/checksum/i)
    })

    it('sonra: to normalize edilir ve execute(...) icinde kodlanabilir', async () => {
        const tx = await buildTransaction({
            provider: sixDecimalsProvider, from: FROM, to: TO, amount: '1', asset: BAD
        })

        expect(tx.to).toBe(GOOD)
        const execute = new ethers.Interface(['function execute(address dest, uint256 value, bytes func)'])
        expect(() => execute.encodeFunctionData('execute', [tx.to, 0n, tx.data])).not.toThrow()
    })

    it('dapp ham calldata kolunda da normalize edilir', async () => {
        const tx = await buildTransaction({
            provider: sixDecimalsProvider, from: FROM, to: null, amount: '0',
            asset: BAD, data: PAYABLE_CALLDATA
        })
        expect(tx.to).toBe(GOOD)
    })

    it('zaten dogru olan adresi DEGISTIRMEZ', async () => {
        const tx = await buildTransaction({
            provider: sixDecimalsProvider, from: FROM, to: TO, amount: '1', asset: USDT
        })
        expect(tx.to).toBe(USDT)
    })
})
