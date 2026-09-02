import { describe, it, expect } from 'vitest'
import { evmOnlyFeatures } from './evmGates'

const EVM = { chainId: 1, rpc: [{ url: 'https://eth' }] }
const SOLANA = { chainId: 'solana-mainnet', vm: 'solana' }

describe('evmOnlyFeatures', () => {
    it('EVM de hepsi acik', () => {
        expect(evmOnlyFeatures(EVM)).toEqual({
            swap: true, bridge: true, ats: true, buy: true, dapp: true
        })
    })

    it('Solana da hepsi kapali', () => {
        expect(evmOnlyFeatures(SOLANA)).toEqual({
            swap: false, bridge: false, ats: false, buy: false, dapp: false
        })
    })

    // Zincir cozulemediginde de kapali: acik varsaymak, arayuzun var olmayan
    // bir RPC ile calismaya kalkmasi demek.
    it('zincir yoksa hepsi kapali', () => {
        expect(evmOnlyFeatures(null)).toEqual({
            swap: false, bridge: false, ats: false, buy: false, dapp: false
        })
        expect(evmOnlyFeatures(undefined).swap).toBe(false)
    })

    // KASITLI FARKLILIK: gercek bir EVM zincirinde `rpc` alani BOS/eksikse (orn.
    // kullanicinin elle ekledigi, url'siz kalmis bir ozel ag) swap/bridge motoru
    // calistiramaz ve kapanir -- ama ats/buy/dapp bu zincirin RPC'sine hic
    // bakmaz (ATS bakiyesi sabit BSC'den, MoonPay kendi ucuna, eth_requestAccounts/
    // eth_chainId zaten bilinen bir adresi/kimligi dondurur), yani acik kalmalari
    // dogru: kapatmak "EVM mi" ile "bu RPC su an calisiyor mu" sorularini
    // birbirine karistirir.
    it('EVM zincirinde rpc bossa yalniz swap/bridge kapanir, ats/buy/dapp acik kalir', () => {
        const evmNoRpc = { chainId: 999, rpc: [] }
        expect(evmOnlyFeatures(evmNoRpc)).toEqual({
            swap: false, bridge: false, ats: true, buy: true, dapp: true
        })
    })

    // `rpc` alani hic yoksa (undefined) da ayni ayrim gecerli olmali.
    it('EVM zincirinde rpc alani hic yoksa yalniz swap/bridge kapanir', () => {
        const evmMissingRpc = { chainId: 999 }
        expect(evmOnlyFeatures(evmMissingRpc)).toEqual({
            swap: false, bridge: false, ats: true, buy: true, dapp: true
        })
    })
})
