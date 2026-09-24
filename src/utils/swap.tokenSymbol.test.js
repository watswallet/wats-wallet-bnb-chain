// getTokenSymbol: bekleyen takas satirinin token adini zincirden cozer.
//
// KOK NEDEN: buildSwapPendingSkeleton sembol yerine 'INPUT'/'OUTPUT' yaziyordu
// cunku cagiran taraf sembolu HIC cozmuyordu. Ondalik icin zaten AYNI desen var
// (getTokenDecimals: onbellek + zincir cagrisi + guvenli yedek); bu metot onun
// birebir ikizi. Constructor ag cagrisi yapmadigi icin (bkz. swap.buildSwapCalls
// .test.js'teki ayni gerekce) burasi provider stub'uyla durustce test edilebilir.
import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { MultiChainSwapManager } from './swap'

const PRIVATE_KEY = '0x' + '1'.repeat(64)
const CHAIN_ID = 56 // BSC — native sembolu BNB
const TOKEN = '0x1111111111111111111111111111111111111111'

// ethers.Contract bir "runner" ister; salt-okunur cagri icin yalniz `call`
// kullanilir. Donen deger ABI kodlanmis bir string olmali.
function makeManager(callImpl) {
    const manager = new MultiChainSwapManager(PRIVATE_KEY, CHAIN_ID)
    manager.getProvider = () => ({ call: callImpl })
    return manager
}

const encodeString = (value) => ethers.AbiCoder.defaultAbiCoder().encode(['string'], [value])

describe('MultiChainSwapManager.getTokenSymbol', () => {
    it('ERC20 sembolunu zincirden okur', async () => {
        const manager = makeManager(async () => encodeString('USDC'))
        expect(await manager.getTokenSymbol(TOKEN)).toBe('USDC')
    })

    it('native adres icin zincirin native sembolunu doner (BSC -> BNB)', async () => {
        const manager = makeManager(async () => { throw new Error('native icin zincire GIDILMEMELI') })
        expect(await manager.getTokenSymbol(ethers.ZeroAddress)).toBe('BNB')
        expect(await manager.getTokenSymbol('0x0')).toBe('BNB')
    })

    // Sembol cozulemedigi anda 'INPUT'/'TOKEN' gibi bir yer tutucuya DUSMEK
    // duzeltilen hatanin ta kendisidir: bos dize doner, cagiran birimsiz gosterir.
    it('zincir cagrisi patlarsa bos dize doner, yer tutucu UYDURMAZ', async () => {
        const manager = makeManager(async () => { throw new Error('RPC down') })
        expect(await manager.getTokenSymbol(TOKEN)).toBe('')
    })

    it('bos/bosluklu sembol bos dizeye normalize edilir', async () => {
        const manager = makeManager(async () => encodeString('   '))
        expect(await manager.getTokenSymbol(TOKEN)).toBe('')
    })

    it('ayni token icin zincire IKINCI kez gidilmez (onbellek)', async () => {
        let cagriSayisi = 0
        const manager = makeManager(async () => { cagriSayisi++; return encodeString('USDC') })

        await manager.getTokenSymbol(TOKEN)
        await manager.getTokenSymbol(TOKEN)

        expect(cagriSayisi).toBe(1)
    })

    it('basarisiz sonuc da onbelleklenir (her satirda tekrar denenmez)', async () => {
        let cagriSayisi = 0
        const manager = makeManager(async () => { cagriSayisi++; throw new Error('RPC down') })

        await manager.getTokenSymbol(TOKEN)
        await manager.getTokenSymbol(TOKEN)

        expect(cagriSayisi).toBe(1)
    })
})
