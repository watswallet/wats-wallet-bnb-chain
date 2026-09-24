import { describe, it, expect } from 'vitest'
import { evmOnlyFeatures } from './evmGates'

const EVM = { chainId: 1, rpc: [{ url: 'https://eth' }] }
const SOLANA = { chainId: 'solana-mainnet', vm: 'solana' }
const TON = { chainId: -239, kind: 'ton', rpc: [] }

describe('evmOnlyFeatures', () => {
    it('EVM de hepsi acik', () => {
        expect(evmOnlyFeatures(EVM)).toEqual({ ats: true, buy: true, dapp: true })
    })

    it('Solana da hepsi kapali', () => {
        expect(evmOnlyFeatures(SOLANA)).toEqual({ ats: false, buy: false, dapp: false })
    })

    // Zincir cozulemediginde de kapali: acik varsaymak, arayuzun var olmayan
    // bir RPC ile calismaya kalkmasi demek.
    it('zincir yoksa hepsi kapali', () => {
        expect(evmOnlyFeatures(null)).toEqual({ ats: false, buy: false, dapp: false })
        expect(evmOnlyFeatures(undefined).dapp).toBe(false)
    })

    // TABLO TAM OLARAK BU UC ALANDAN IBARET.
    //
    // `swap`/`bridge` bir donem buradaydi ve "EVM + rpc listesi dolu"
    // soruyordu. Kaldirildilar (gerekce evmGates.js bas yorumunda): uretimde
    // okuyuculari kalmamisti, ama orada durduklari surece OTORITE gibi
    // okunuyorlardi -- ve iki kapinin ayni soruya farkli cevap vermesi tam da
    // TON'daki kalici siyah ekrani ureten celiskiydi.
    //
    // Bu iddia o kaldirmanin KILIDIDIR: birisi alanlari geri eklerse -- ya da
    // `evmOnlyFeatures`i "her seyin kapisi" sanip yeni bir akis bayragi
    // buraya koyarsa -- kirmiziya duser ve dogru adresi (chainSupportsFlow)
    // hatirlatir. `toEqual` fazladan alani ZATEN yakalar; anahtar listesi
    // NIYETI okunur kilmak icin ayrica yazildi.
    it('tablo YALNIZCA ats/buy/dapp icerir -- akis kapilari (swap/bridge) burada DEGIL', () => {
        expect(Object.keys(evmOnlyFeatures(EVM)).sort()).toEqual(['ats', 'buy', 'dapp'])
        expect(evmOnlyFeatures(EVM)).not.toHaveProperty('swap')
        expect(evmOnlyFeatures(EVM)).not.toHaveProperty('bridge')
        // TON'da takas ACIK (STON.fi) ama bu tablo ona hic cevap vermez;
        // cevap chainSupportsFlow(chain, FLOW.SWAP)'tir.
        expect(evmOnlyFeatures(TON)).toEqual({ ats: false, buy: false, dapp: false })
    })

    // RPC TERIMI TABLODAN TAMAMEN CIKTI. Gercek bir EVM zincirinde `rpc` alani
    // bos ya da eksik olsa bile bu uc ozellik ACIK kalir: hicbiri o zincirin
    // RPC'sini kullanmiyor. Alanlar geri eklenirse ya da `isEvm` yeniden bir
    // rpc sartiyla AND'lenirse bu iddia duser.
    it('EVM zincirinde rpc bos ya da hic yoksa da ats/buy/dapp acik kalir', () => {
        expect(evmOnlyFeatures({ chainId: 999, rpc: [] })).toEqual({ ats: true, buy: true, dapp: true })
        expect(evmOnlyFeatures({ chainId: 999 })).toEqual({ ats: true, buy: true, dapp: true })
    })
})
