import { describe, it, expect } from 'vitest'
import { DELIVERY_CHAINS, DELIVERY_CHAIN_IDS } from './deliveryChains'
import { hasPrivateSendSource } from './privateBridgedSources'
import { privateAssetsFor, privateFundDeliverable } from './silentswapConfig'
import { nativeTokenOf, usdcTokenOf } from './deliveryTokens'
import { ATS_CHAINS } from '../atsConfig'

// TESLIM DEGISMEZI (1.10, sahip karari 2026-10-30): Para yukle ile Gizli Hesap'a teslim edilen her varlik YALNIZ Gonder ile cikabilir (uretimde
// ATS satisi ve gizli modda Takas/Kopru kapali; gelistirmede kendine Takas/Kopru ciktilari da ayni kuraldadir, arka plan uygular). Ag ucreti her islemde ATS ile odenir; "gaz icin yerel coin" istisnasi YOKTUR. Para yukle'de
// teslim edilebilen varlik = o agda Gonder kaynagi olan varliklar (yerel coin yalniz kendisi Gonder kaynagiysa: ETH). Gonder kaynagi olmayan
// ag Para yukle listesine giremez.
const chainRow = (c) => ({ chainId: c.chainId, nativeCurrency: { symbol: c.nativeSymbol } })

describe('hasPrivateSendSource: derleme kapisinin SDK\'siz Gonder kaynagi bilgisi, privateAssetsFor ile birebir', () => {
    it.each(DELIVERY_CHAINS.map((c) => [c.chainId, c.name]))('%s %s: tablo karari = privateAssetsFor(...).length > 0', (id) => {
        const c = DELIVERY_CHAINS.find((x) => x.chainId === id)
        expect(hasPrivateSendSource(id)).toBe(privateAssetsFor(chainRow(c)).length > 0)
    })

    it('teslim tablosundaki on agin hepsinin Gonder kaynagi vardir (1.10 uretim Para yukle listesi on ag)', () => {
        expect(DELIVERY_CHAIN_IDS.filter((id) => !hasPrivateSendSource(id))).toEqual([])
    })

    it('bilinmeyen / bicim disi kimlik false (fail-closed)', () => {
        for (const id of [999999, 0, -1, NaN, undefined, null, 'abc', 1.5, '__proto__', 'constructor', '56 ']) {
            expect(hasPrivateSendSource(id), String(id)).toBe(false)
        }
    })
})

describe('privateFundDeliverable: Para yukle teslim tokeni = yalniz Gonder kaynagi varliklari (yerel coin istisnasi yok)', () => {
    it.each(DELIVERY_CHAINS.map((c) => [c.chainId, c.name]))('%s %s: USDC teslim edilir; yerel coin YALNIZ Gonder kaynagiysa', (id) => {
        const c = DELIVERY_CHAINS.find((x) => x.chainId === id)
        const sources = privateAssetsFor(chainRow(c))
        // Tablo USDC'si (secicideki sabit satir) on agin hepsinde Gonder kaynagidir.
        expect(sources).toContain('USDC')
        expect(privateFundDeliverable(usdcTokenOf(id))).toBe(true)
        // Yerel coin teslim edilebilirligi = yerel coinin Gonder kaynagi olmasi (gaz istisnasi kalkti).
        expect(privateFundDeliverable(nativeTokenOf(id))).toBe(sources.includes(c.nativeSymbol))
    })

    it('yerel coin: ETH kullanan dort agda (Ethereum, Base, Arbitrum, Optimism) teslim edilir; BNB, POL, xDAI, CELO, MNT, CRO edilmez', () => {
        const edilir = DELIVERY_CHAINS.filter((c) => privateFundDeliverable(nativeTokenOf(c.chainId))).map((c) => c.chainId)
        expect(edilir).toEqual([1, 8453, 42161, 10])
        for (const id of [56, 137, 100, 42220, 5000, 25]) expect(privateFundDeliverable(nativeTokenOf(id)), String(id)).toBe(false)
    })

    it('Gonder kaynagi OLMAYAN token (BSC ATS, BSC USDT, rastgele sozlesme) teslim edilemez', () => {
        const ATS = ATS_CHAINS[56].token.address
        expect(privateFundDeliverable({ chainId: 56, address: ATS })).toBe(false)
        expect(privateFundDeliverable({ chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955' })).toBe(false)
        expect(privateFundDeliverable({ chainId: 1, address: '0x1111111111111111111111111111111111111111' })).toBe(false)
    })

    it('adres karsilastirmasi harf boyutuna duyarsiz; baska agin USDC adresi bu agda sayilmaz', () => {
        const base = usdcTokenOf(8453)
        expect(privateFundDeliverable({ chainId: 8453, address: base.address.toLowerCase() })).toBe(true)
        expect(privateFundDeliverable({ chainId: 56, address: base.address })).toBe(false)
    })

    it('bozuk girdi false (fail-closed)', () => {
        for (const t of [null, undefined, {}, { chainId: 56 }, { address: '0x0' }, { chainId: 999999, address: '0x0000000000000000000000000000000000000000' }, 'x']) {
            expect(privateFundDeliverable(t), JSON.stringify(t)).toBe(false)
        }
    })
})
