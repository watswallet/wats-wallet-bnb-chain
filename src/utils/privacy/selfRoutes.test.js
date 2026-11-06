// Gizli modda kendine Takas / Kopru (SilentSwap) icin TEK DOGRU KAYNAGIN kilidi: hangi aglarin, varliklarin ve teslim tokenlerinin
// sunuldugu selfRoutes.js'ten okunur; arayuz dugmeleri, varsayilanlar ve arka plan siniri buradan sapamaz.
// Her liste Para yukle (FUND) listesidir (R4): kendine teslimin ekrani arka planda 'fund' turetilir (deliveryScreenOf), 'send' listesi okunmaz.
// Ortam ve tablolar CAGRI ANINDA okunur: testler vi.stubEnv ile listeyi degistirir, modul sifirlanmaz.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LISTED_CHAINS } from '../../data/chains'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { DELIVERY_CHAIN_IDS } from './deliveryChains'
import { nativeTokenOf, usdcTokenOf } from './deliveryTokens'
import { privateFundDeliverable, privateSourceChains } from './silentswapConfig'
import { sourcePairs } from './sourceAssets'
import * as selfRoutes from './selfRoutes'
import { selfDeliverableAssets, selfSwapTargets, selfBridgeTargets, selfSwapSourceChains, selfSourceChains, selfDeliveryTokenOf, defaultSelfSource } from './selfRoutes'

// Tek bir agin Gonder kaynagini sahte olarak kapatmak icin: o agin (zincir, varlik) Depository satiri yokmus gibi davranir.
// Gonder listesi ('hasPrivateSendSource') gercek tablodan okunmaya devam eder, yani ag FUND'da ACIK kalir ama teslim edilebilir
// varligi KALMAZ (gercek tabloda olusmayan, savunma amacli dal).
const kapali = vi.hoisted(() => ({ zincir: null }))
vi.mock('./privateBridgedSources', async (importOriginal) => {
    const orig = await importOriginal()
    return {
        ...orig,
        bridgedDepositoryFor: (id, asset) => (kapali.zincir !== null && Number(id) === kapali.zincir ? null : orig.bridgedDepositoryFor(id, asset)),
    }
})

afterEach(() => { vi.unstubAllEnvs(); kapali.zincir = null })

const TABLO = { 56: ['USDC'], 1: ['USDC', 'USDT', 'DAI', 'ETH'], 8453: ['USDC', 'ETH'], 42161: ['USDC', 'USDT', 'ETH'], 10: ['USDC', 'USDT', 'ETH'], 137: ['USDC', 'USDT'], 100: ['USDC'], 42220: ['USDC'], 5000: ['USDC'], 25: ['USDC'] }
const idler = (zincirler) => zincirler.map((c) => Number(c.chainId))
const fonDar = (liste) => vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', liste)
const oku = (ad) => readFileSync(fileURLToPath(new URL(ad, import.meta.url)), 'utf8')

describe('selfRoutes: disa aktarilan adlar', () => {
    it('tam olarak yedi ad disa aktarilir', () => {
        expect(Object.keys(selfRoutes).sort()).toEqual([
            'defaultSelfSource', 'selfBridgeTargets', 'selfDeliverableAssets', 'selfDeliveryTokenOf', 'selfSourceChains', 'selfSwapSourceChains', 'selfSwapTargets',
        ])
    })

    it('kaynak: SDK imzalama modullerini import etmez, yalniz izinli modulleri', () => {
        const kod = yorumsuz(oku('./selfRoutes.js'))
        expect(kod).not.toMatch(/from\s+'\.\/silentswap'/)
        expect(kod).not.toContain('privateOrderExec')
        expect(kod).toMatch(/from\s+'\.\/silentswapConfig'/)
        expect(kod).toMatch(/from\s+'\.\/deliveryChainSetting'/)
        expect(kod).not.toContain("openDeliveryChains('send')")
        expect(kod).not.toContain("isDeliveryChainOpen('send'")
    })
})

describe('selfDeliverableAssets', () => {
    it('Gonder kaynagi tablosuyla birebir: on agin hepsi, sayi ve sayisal dizge', () => {
        for (const [id, liste] of Object.entries(TABLO)) {
            expect(selfDeliverableAssets(Number(id)), `sayi ${id}`).toEqual(liste)
            expect(selfDeliverableAssets(String(id)), `dizge ${id}`).toEqual(liste)
        }
    })

    it('bilinmeyen ya da kanonik olmayan kimlik bos doner', () => {
        for (const id of [999999, 0, -1, -239, NaN, undefined, null, '08453', ' 8453', '0x2105', 8453.5, 'abc', 'solana-mainnet']) {
            expect(selfDeliverableAssets(id), String(id)).toEqual([])
        }
    })

    it('FUND listesi daraltilinca kapali ag bos doner', () => {
        fonDar('56,1')
        expect(selfDeliverableAssets(8453)).toEqual([])
        expect(selfDeliverableAssets(1)).toEqual(['USDC', 'USDT', 'DAI', 'ETH'])
        expect(selfDeliverableAssets(56)).toEqual(['USDC'])
    })

    it('Gonder listesi degil FUND listesi okunur', () => {
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '1,56,8453')
        fonDar('56,1')
        expect(selfDeliverableAssets(8453)).toEqual([])
        expect(selfDeliverableAssets(1).length).toBeGreaterThan(0)
    })

    it('FUND listesi bos: hicbir ag teslim edilemez', () => {
        fonDar('')
        for (const id of DELIVERY_CHAIN_IDS) expect(selfDeliverableAssets(id), String(id)).toEqual([])
    })

    it('FUND degismezi bozuksa (56 yok) liste bos sayilir', () => {
        fonDar('1')
        for (const id of DELIVERY_CHAIN_IDS) expect(selfDeliverableAssets(id), String(id)).toEqual([])
    })

    it('kaynak varligi olmayan ag (Depository satiri yok) teslim varligi vermez', () => {
        kapali.zincir = 100
        expect(selfDeliverableAssets(100)).toEqual([])
        expect(selfDeliverableAssets(1)).toEqual(['USDC', 'USDT', 'DAI', 'ETH'])
    })
})

describe('selfSwapTargets', () => {
    it('her ag ve varlik icin hedefler = teslim edilebilir liste - kaynak varlik, sirayla', () => {
        for (const [id, liste] of Object.entries(TABLO)) {
            for (const asset of liste) {
                const hedefler = selfSwapTargets(Number(id), asset)
                expect(hedefler, `${id} ${asset}`).toEqual(liste.filter((s) => s !== asset))
                expect(hedefler, `${id} ${asset} kendini icermez`).not.toContain(asset)
            }
        }
    })

    it('ornekler', () => {
        expect(selfSwapTargets(1, 'USDC')).toEqual(['USDT', 'DAI', 'ETH'])
        expect(selfSwapTargets(1, 'ETH')).toEqual(['USDC', 'USDT', 'DAI'])
        expect(selfSwapTargets(42161, 'USDT')).toEqual(['USDC', 'ETH'])
        expect(selfSwapTargets(137, 'USDC')).toEqual(['USDT'])
        expect(selfSwapTargets(137, 'USDT')).toEqual(['USDC'])
        expect(selfSwapTargets(8453, 'ETH')).toEqual(['USDC'])
        expect(selfSwapTargets('1', 'USDC')).toEqual(selfSwapTargets(1, 'USDC'))
    })

    it('tek varlikli aglarda Takas hedefi yok', () => {
        for (const id of [56, 100, 42220, 5000, 25]) expect(selfSwapTargets(id, 'USDC'), String(id)).toEqual([])
    })

    it('kaynak varlik listede degilse ya da dizge degilse bos', () => {
        const kotu = [[1, 'DOGE'], [1, 'usdc'], [1, 'BNB'], [1, ''], [1, undefined], [1, null], [1, 42], [1, '__proto__'], [1, 'constructor'], [999999, 'USDC'], ['08453', 'USDC']]
        for (const [id, asset] of kotu) expect(selfSwapTargets(id, asset), `${id} ${String(asset)}`).toEqual([])
    })

    it('FUND daraltilinca kapali agda Takas yok', () => {
        fonDar('56,1')
        expect(selfSwapTargets(1, 'USDC')).toEqual(['USDT', 'DAI', 'ETH'])
        expect(selfSwapTargets(8453, 'USDC')).toEqual([])
        expect(selfSwapTargets(137, 'USDC')).toEqual([])
    })

    it('FUND yalniz BSC: hicbir agda Takas yok', () => {
        fonDar('56')
        expect(selfSwapTargets(1, 'USDC')).toEqual([])
        expect(selfSwapTargets(56, 'USDC')).toEqual([])
        expect(selfSwapTargets(137, 'USDC')).toEqual([])
    })
})

describe('selfBridgeTargets', () => {
    it('on agin her biri icin dokuz hedef, kaynak asla yok, tablo sirasi', () => {
        for (const id of Object.keys(TABLO)) {
            const hedefler = selfBridgeTargets(Number(id))
            expect(hedefler, id).toEqual(DELIVERY_CHAIN_IDS.filter((x) => x !== Number(id)))
            expect(hedefler.length, id).toBe(9)
            expect(hedefler, id).not.toContain(Number(id))
        }
    })

    it('ornekler ve sayisal dizge', () => {
        expect(selfBridgeTargets(56)).toEqual([1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
        expect(selfBridgeTargets('56')).toEqual(selfBridgeTargets(56))
    })

    it('tabloda olmayan ya da kanonik olmayan kaynak bos', () => {
        for (const id of [-239, 999999, 0, NaN, undefined, null, '08453', 'abc', 'solana-mainnet']) {
            expect(selfBridgeTargets(id), String(id)).toEqual([])
        }
    })

    it("FUND daraltilinca hedefler daralir; kaynak ag FUND'da olmak zorunda degil", () => {
        fonDar('56,1')
        expect(selfBridgeTargets(1)).toEqual([56])
        expect(selfBridgeTargets(56)).toEqual([1])
        expect(selfBridgeTargets(8453)).toEqual([56, 1])
    })

    it('FUND yalniz BSC: BSC kaynaginin hedefi yok, baska kaynaklarin hedefi yalniz BSC', () => {
        fonDar('56')
        expect(selfBridgeTargets(56)).toEqual([])
        expect(selfBridgeTargets(1)).toEqual([56])
    })

    it('FUND bos ya da degismez bozuk: her kaynak icin bos', () => {
        for (const liste of ['', '1']) {
            fonDar(liste)
            expect(selfBridgeTargets(56), `liste "${liste}" 56`).toEqual([])
            expect(selfBridgeTargets(1), `liste "${liste}" 1`).toEqual([])
        }
    })

    it('teslim edilebilir varligi olmayan acik ag hedef sayilmaz', () => {
        kapali.zincir = 100
        const hedefler = selfBridgeTargets(56)
        expect(hedefler).toEqual([1, 8453, 42161, 10, 137, 42220, 5000, 25])
        expect(hedefler.length).toBe(8)
        expect(hedefler).not.toContain(100)
        expect(selfBridgeTargets(100)).toEqual([56, 1, 8453, 42161, 10, 137, 42220, 5000, 25])
    })
})

describe('selfSwapSourceChains ve selfSourceChains', () => {
    it('LISTED_CHAINS: kimlikler 1, 10, 8453, 42161, 137 (liste sirasi)', () => {
        const ids = idler(selfSwapSourceChains(LISTED_CHAINS))
        expect(ids).toEqual([1, 10, 8453, 42161, 137])
        for (const yok of [56, 100, 42220, 5000, 25]) expect(ids).not.toContain(yok)
        for (const var_ of [1, 10, 137, 8453, 42161]) expect(ids).toContain(var_)
    })

    it('cift sayilari: Takas 14, Kopru 19', () => {
        const takas = sourcePairs(selfSwapSourceChains(LISTED_CHAINS)).map((p) => p.key)
        expect(takas).toEqual(['1:USDC', '1:USDT', '1:DAI', '1:ETH', '10:USDC', '10:USDT', '10:ETH', '8453:USDC', '8453:ETH', '42161:USDC', '42161:USDT', '42161:ETH', '137:USDC', '137:USDT'])
        expect(takas.length).toBe(14)
        expect(sourcePairs(privateSourceChains(LISTED_CHAINS)).length).toBe(19)
    })

    it('girdi bos, dizi degil ya da sirasi ters: sonuc girdiyi izler, girdi degismez', () => {
        expect(selfSwapSourceChains(undefined)).toEqual([])
        expect(selfSwapSourceChains(null)).toEqual([])
        expect(selfSwapSourceChains([])).toEqual([])
        const ters = [...LISTED_CHAINS].reverse()
        const uzunluk = ters.length
        const sonuc = selfSwapSourceChains(ters)
        expect(idler(sonuc)).toEqual([137, 42161, 8453, 10, 1])
        expect(ters.length).toBe(uzunluk)
        for (const kayit of sonuc) expect(ters.includes(kayit)).toBe(true)
    })

    it('FUND daraltilinca Takas kaynak zincirleri daralir', () => {
        fonDar('56,1')
        expect(idler(selfSwapSourceChains(LISTED_CHAINS))).toEqual([1])
        for (const liste of ['56', '', '1']) {
            fonDar(liste)
            expect(idler(selfSwapSourceChains(LISTED_CHAINS)), `liste "${liste}"`).toEqual([])
        }
    })

    it('selfSourceChains("swap") = Takas kaynaklari', () => {
        expect(idler(selfSourceChains('swap', LISTED_CHAINS))).toEqual([1, 10, 8453, 42161, 137])
    })

    it('selfSourceChains bridge, fund, send ve bilinmeyen kip = tum Gonder kaynaklari (on zincir)', () => {
        for (const mode of ['bridge', 'fund', 'send', undefined, 'baska']) {
            const ids = idler(selfSourceChains(mode, LISTED_CHAINS))
            expect(ids, String(mode)).toEqual(idler(privateSourceChains(LISTED_CHAINS)))
            expect(ids.length, String(mode)).toBe(10)
        }
    })

    it('Kopru kaynak listesi FUND listesine bagli degil', () => {
        fonDar('')
        expect(selfSourceChains('bridge', LISTED_CHAINS).length).toBe(10)
        expect(selfSourceChains('swap', LISTED_CHAINS)).toEqual([])
    })
})

describe('selfDeliveryTokenOf', () => {
    it('her ag ve her teslim edilebilir varlik icin token dondurur ve privateFundDeliverable gecer', () => {
        for (const [id, liste] of Object.entries(TABLO)) {
            for (const asset of liste) {
                const token = selfDeliveryTokenOf(Number(id), asset)
                expect(token, `${id} ${asset}`).not.toBeNull()
                expect(token.chainId, `${id} ${asset} zincir`).toBe(Number(id))
                expect(token.symbol, `${id} ${asset} sembol`).toBe(asset)
                expect(privateFundDeliverable(token), `${id} ${asset} teslim`).toBe(true)
                expect(Object.isFrozen(token), `${id} ${asset} dondurulmus`).toBe(true)
            }
        }
    })

    it('tablo tekilleri', () => {
        expect(selfDeliveryTokenOf(56, 'USDC')).toBe(usdcTokenOf(56))
        expect(selfDeliveryTokenOf(1, 'ETH')).toBe(nativeTokenOf(1))
        expect(selfDeliveryTokenOf('8453', 'ETH')).toBe(nativeTokenOf(8453))
        expect(selfDeliveryTokenOf(137, 'USDC')).toBe(usdcTokenOf(137))
    })

    it('USDT ve DAI SDK kaydindan', () => {
        expect(selfDeliveryTokenOf(1, 'USDT')).toEqual({ chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 })
        expect(selfDeliveryTokenOf(1, 'DAI')).toEqual({ chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 })
        const poly = selfDeliveryTokenOf(137, 'USDT')
        expect(poly.address).toBe('0xc2132D05D31c914a87C6611C10748AEb04B58e8F')
        expect(poly.decimals).toBe(6)
    })

    it('teslim edilemeyen sembol, bilinmeyen ag ya da bozuk girdi null', () => {
        const kotu = [['56', 'BNB'], [137, 'POL'], [100, 'XDAI'], [56, 'ETH'], [8453, 'USDT'], [8453, 'DAI'], [1, 'DOGE'], [1, 'usdc'], [1, ''], [1, undefined], [1, null], [1, 42], [1, '__proto__'], [999999, 'USDC'], ['08453', 'USDC'], [undefined, 'USDC']]
        for (const [id, symbol] of kotu) {
            expect(() => selfDeliveryTokenOf(id, symbol), `${String(id)} ${String(symbol)} firlatmaz`).not.toThrow()
            expect(selfDeliveryTokenOf(id, symbol), `${String(id)} ${String(symbol)}`).toBeNull()
        }
    })

    it('FUND daraltilinca kapali agda null', () => {
        fonDar('56,1')
        expect(selfDeliveryTokenOf(8453, 'USDC')).toBeNull()
        expect(selfDeliveryTokenOf(1, 'USDC')).toBe(usdcTokenOf(1))
        vi.unstubAllEnvs()
        kapali.zincir = 100
        expect(selfDeliveryTokenOf(100, 'USDC')).toBeNull()
    })
})

describe('defaultSelfSource', () => {
    it('swap: Ethereum USDC; bridge, fund, send ve bilinmeyen kip: BSC USDC', () => {
        expect(defaultSelfSource('swap')).toEqual({ chainId: 1, asset: 'USDC' })
        for (const mode of ['bridge', 'fund', 'send', undefined, 'baska']) {
            expect(defaultSelfSource(mode), String(mode)).toEqual({ chainId: 56, asset: 'USDC' })
        }
    })

    it('her cagrida yeni nesne', () => {
        const a = defaultSelfSource('swap')
        a.chainId = 999
        expect(defaultSelfSource('swap').chainId).toBe(1)
        const b = defaultSelfSource('bridge')
        expect(defaultSelfSource('bridge')).not.toBe(b)
    })

    it('swap baslangici gecerli bir Takas cifti, bridge baslangici gecerli bir Kopru kaynagi', () => {
        const ilk = sourcePairs(selfSwapSourceChains(LISTED_CHAINS))[0]
        const s = defaultSelfSource('swap')
        expect(ilk.key).toBe('1:USDC')
        expect(ilk.key).toBe(`${s.chainId}:${s.asset}`)
        expect(selfSwapTargets(s.chainId, s.asset).length).toBeGreaterThan(0)
        expect(sourcePairs(privateSourceChains(LISTED_CHAINS)).map((p) => p.key)).toContain('56:USDC')
        expect(selfBridgeTargets(56).length).toBeGreaterThan(0)
    })

    it('FUND daraltilinca swap baslangici ilk gecerli Takas cifti ya da BSC USDC yedegi', () => {
        fonDar('56,1')
        expect(defaultSelfSource('swap')).toEqual({ chainId: 1, asset: 'USDC' })
        expect(defaultSelfSource('bridge')).toEqual({ chainId: 56, asset: 'USDC' })
        for (const liste of ['56', '', '1']) {
            fonDar(liste)
            expect(defaultSelfSource('swap'), `liste "${liste}"`).toEqual({ chainId: 56, asset: 'USDC' })
            expect(defaultSelfSource('bridge'), `liste "${liste}" bridge`).toEqual({ chainId: 56, asset: 'USDC' })
        }
    })
})
