import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'ethers'
import { privateTokenLogo, packagedTokenLogo, hasPrivateLogo, privateChainBadge, UNKNOWN_TOKEN_LOGO } from './privateTokenLogo'
import { DELIVERY_CHAINS } from './deliveryChains'
import { USDC_LOGO } from './deliveryTokens'
import { ATS_CHAINS } from '../atsConfig'
import { sourceAssetAddress } from './sourceAssets'
import { LOCAL_TOKEN_LOGOS } from './localTokenLogos'

// GIZLI MODDA TOKEN LOGOSU, TEK COZUCU: yalniz PAKETLI yerel yollar (ag yok), cozulemezse yedek simge. Buyuk logo HER ZAMAN tokenin kendi logosudur;
// ag yalniz kucuk rozette gorunur (Base'te ETH: Base logosu degil ETH logosu). Her teslim edilebilir token icin gercek logo kilidi:
// privateTokenLogo.guard.test.js (envanter ayni kod yollarindan turetilir).
const DAI_LOGO = '/tokens/1/0x6b175474e89094c44da98b954eedeac495271d0f.png'
const USDT_LOGO = '/tokens/1/0xdac17f958d2ee523a2206206994597c13d831ec7.png'
const XDAI_LOGO = '/tokens/100/0x0000000000000000000000000000000000000000.png'
const ETH_LOGO = '/chains/1.png'
const ZERO = '0x0000000000000000000000000000000000000000'
const publicFile = (p) => existsSync(fileURLToPath(new URL(`../../../public${p}`, import.meta.url)))
const ATS = ATS_CHAINS[56].token

describe('privateTokenLogo: adressiz sorgu (siparis karti: yalniz sembol + ag)', () => {
    it('USDC her agda paketli USDC logosu (ag okunamasa da)', () => {
        for (const chain of DELIVERY_CHAINS) expect(privateTokenLogo({ chainId: chain.chainId, symbol: 'USDC' }), String(chain.chainId)).toBe(USDC_LOGO)
        expect(privateTokenLogo({ chainId: null, symbol: 'USDC' })).toBe(USDC_LOGO)
        expect(privateTokenLogo({ chainId: 99999, symbol: 'USDC' })).toBe(USDC_LOGO)
    })

    it('yerel coin COININ logosu: ETH hangi ETH agi olursa olsun ETH logosu (L2 logosu degil)', () => {
        for (const chainId of [1, 8453, 42161, 10]) expect(privateTokenLogo({ chainId, symbol: 'ETH' }), String(chainId)).toBe(ETH_LOGO)
        for (const chainId of [8453, 42161, 10]) expect(privateTokenLogo({ chainId, symbol: 'ETH' })).not.toBe(`/chains/${chainId}.png`)
    })

    it('tek coinli aglarda coinin logosu: BNB/56, POL/137, CELO/42220, MNT/5000, CRO/25', () => {
        for (const [chainId, coin] of [[56, 'BNB'], [137, 'POL'], [42220, 'CELO'], [5000, 'MNT'], [25, 'CRO']]) {
            expect(privateTokenLogo({ chainId, symbol: coin }), `${chainId}:${coin}`).toBe(`/chains/${chainId}.png`)
        }
    })

    it('Gnosis xDAI kendi logosunu alir: Gnosis baykusu (GNO) ya da yedek simge degil', () => {
        expect(privateTokenLogo({ chainId: 100, symbol: 'XDAI' })).toBe(XDAI_LOGO)
        expect(privateTokenLogo({ chainId: 100, symbol: 'XDAI' })).not.toBe('/chains/100.png')
        expect(privateTokenLogo({ chainId: null, symbol: 'XDAI' })).toBe(XDAI_LOGO)
    })

    it('ATS BSC ATS logosu; baska agda ATS yoktur (yedek simge)', () => {
        expect(privateTokenLogo({ chainId: 56, symbol: 'ATS' })).toBe('/ats.png')
        expect(privateTokenLogo({ chainId: 8453, symbol: 'ATS' })).toBe(UNKNOWN_TOKEN_LOGO)
    })

    it('adres tabanli paketli logosu olan token kendi dosyasini kullanir (USDT Ethereum/Polygon/Arbitrum/Optimism, DAI Ethereum)', () => {
        expect(privateTokenLogo({ chainId: 1, symbol: 'USDT' })).toBe(USDT_LOGO)
        expect(privateTokenLogo({ chainId: 137, symbol: 'USDT' })).toBe('/tokens/137/0xc2132d05d31c914a87c6611c10748aeb04b58e8f.png')
        expect(privateTokenLogo({ chainId: 42161, symbol: 'USDT' })).toBe('/tokens/42161/0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.png')
        expect(privateTokenLogo({ chainId: 10, symbol: 'USDT' })).toBe('/tokens/10/0x94b008aa00579c1307b0ef2c499ad98a8ce58e58.png')
        expect(privateTokenLogo({ chainId: 1, symbol: 'DAI' })).toBe(DAI_LOGO)
        for (const key of ['1:0x6b175474e89094c44da98b954eedeac495271d0f', '10:0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', '42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '100:' + ZERO]) {
            expect(LOCAL_TOKEN_LOGOS.has(key), key).toBe(true)
        }
    })

    it('adres dosyasi olmayan ama sembolu bilinen token sembol yedegine duser: DAI/USDT baska aglarda ve ag okunamasa da ayni tokenin logosu', () => {
        for (const chainId of [56, 8453, 42161, 10, 137, null, 99999]) expect(privateTokenLogo({ chainId, symbol: 'DAI' }), `DAI/${chainId}`).toBe(DAI_LOGO)
        for (const chainId of [56, 8453, null, 99999]) expect(privateTokenLogo({ chainId, symbol: 'USDT' }), `USDT/${chainId}`).toBe(USDT_LOGO)
        expect(privateTokenLogo({ chainId: 56, symbol: 'ETH' })).toBe(ETH_LOGO)
        expect(privateTokenLogo({ chainId: null, symbol: 'ETH' })).toBe(ETH_LOGO)
        expect(privateTokenLogo({ chainId: 1, symbol: 'BNB' })).toBe('/chains/56.png')
    })

    it('gercekten bilinmeyen semboller yedek simge (gizli mod bunlari uretmemeli)', () => {
        for (const [chainId, symbol] of [[56, 'CAKE'], [8453, 'XYZ'], [1, 'UNI']]) expect(privateTokenLogo({ chainId, symbol }), `${chainId}:${symbol}`).toBe(UNKNOWN_TOKEN_LOGO)
        // Kayit defterinde olan ve paketli logosu bulunan bir sembol (WBTC) gercekten bilinmeyen sayilmaz: ayni tokenin paketli logosu.
        expect(privateTokenLogo({ chainId: 1, symbol: 'WBTC' })).toBe('/tokens/10/0x68f180fcce6836688e9084f035309e29bf0a2095.png')
    })

    it('okunamayan girdi yedek simge verir ve cokmez (sembol yok/dizge degil/prototip adi, bos nesne, girdisiz)', () => {
        for (const [chainId, symbol] of [[56, ''], [56, null], [56, undefined], [56, 5], [56, {}], [56, 'constructor'], [56, '__proto__'], [56, 'toString'], [null, 'hasOwnProperty']]) {
            expect(privateTokenLogo({ chainId, symbol }), `${chainId}:${String(symbol)}`).toBe(UNKNOWN_TOKEN_LOGO)
        }
        expect(privateTokenLogo({})).toBe(UNKNOWN_TOKEN_LOGO)
        expect(privateTokenLogo()).toBe(UNKNOWN_TOKEN_LOGO)
        expect(packagedTokenLogo({ chainId: 56, symbol: 'CAKE' })).toBeNull()
    })
})

describe('privateTokenLogo: adresli sorgu (secici satiri, teslim cipi)', () => {
    it('yerel coin (sifir adres, 0x0, bos) COININ logosu; sembol celisse de agin yerel coini kazanir', () => {
        for (const address of [ZERO, '0x0', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeEeeeeE']) {
            for (const chainId of [1, 8453, 42161, 10]) expect(privateTokenLogo({ chainId, address, symbol: 'ETH' }), `${chainId}:${address}`).toBe(ETH_LOGO)
        }
        expect(privateTokenLogo({ chainId: 56, address: ZERO, symbol: 'BNB' })).toBe('/chains/56.png')
        expect(privateTokenLogo({ chainId: 137, address: ZERO, symbol: 'POL' })).toBe('/chains/137.png')
        expect(privateTokenLogo({ chainId: 100, address: ZERO, symbol: 'XDAI' })).toBe(XDAI_LOGO)
        expect(privateTokenLogo({ chainId: 8453, address: ZERO, symbol: 'BNB' })).toBe(ETH_LOGO)
    })

    it('her agin USDC adresi (tablo, harf boyutu fark etmez) USDC logosu; baska agin USDC adresi bu agda USDC sayilmaz', () => {
        for (const chain of DELIVERY_CHAINS) {
            expect(privateTokenLogo({ chainId: chain.chainId, address: chain.usdcAddress, symbol: 'USDC' }), String(chain.chainId)).toBe(USDC_LOGO)
            expect(privateTokenLogo({ chainId: chain.chainId, address: chain.usdcAddress.toLowerCase() })).toBe(USDC_LOGO)
        }
        expect(privateTokenLogo({ chainId: 1, address: DELIVERY_CHAINS.find((c) => c.chainId === 8453).usdcAddress, symbol: 'USDC' })).toBe(UNKNOWN_TOKEN_LOGO)
    })

    it('BSC ATS adresi ATS logosu', () => {
        expect(privateTokenLogo({ chainId: 56, address: ATS.address, symbol: 'ATS' })).toBe('/ats.png')
        expect(privateTokenLogo({ chainId: 1, address: ATS.address, symbol: 'ATS' })).toBe(UNKNOWN_TOKEN_LOGO)
    })

    it('kayit defterinde adresi dogrulanan token ayni tokenin paketli logosunu alir (Arbitrum/Optimism/BSC USDT, Base DAI)', () => {
        expect(privateTokenLogo({ chainId: 42161, address: sourceAssetAddress(42161, 'USDT'), symbol: 'USDT' })).toBe('/tokens/42161/0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.png')
        expect(privateTokenLogo({ chainId: 56, address: sourceAssetAddress(56, 'USDT'), symbol: 'USDT' })).toBe(USDT_LOGO)
        expect(privateTokenLogo({ chainId: 8453, address: sourceAssetAddress(8453, 'DAI'), symbol: 'DAI' })).toBe(DAI_LOGO)
        expect(privateTokenLogo({ chainId: 1, address: getAddress(sourceAssetAddress(1, 'DAI')), symbol: 'DAI' })).toBe(DAI_LOGO)
    })

    it('TAKLIT: kendine USDT/DAI/USDC diyen rastgele sozlesme gercek logoyu odunc ALAMAZ (yedek simge)', () => {
        const rastgele = '0x' + '55'.repeat(20)
        for (const symbol of ['USDT', 'DAI', 'USDC', 'ETH', 'ATS']) {
            for (const chainId of [1, 56, 8453]) expect(privateTokenLogo({ chainId, address: rastgele, symbol }), `${chainId}:${symbol}`).toBe(UNKNOWN_TOKEN_LOGO)
        }
        // Ag tabloda yoksa adresli token cozulemez.
        expect(privateTokenLogo({ chainId: 99999, address: sourceAssetAddress(1, 'USDT'), symbol: 'USDT' })).toBe(UNKNOWN_TOKEN_LOGO)
    })
})

describe('hasPrivateLogo -- gizli modda logosuz satirin TEK ortak testi', () => {
    it('privateTokenLogo yedek simgeye DUSMEYECEKSE true; her iki islev ayni kararda (ayrisamaz)', () => {
        const ornekler = [
            { chainId: 1, address: sourceAssetAddress(1, 'DAI'), symbol: 'DAI' },
            { chainId: 56, address: '0x0', symbol: 'BNB' },
            { chainId: 56, address: DELIVERY_CHAINS[0].usdcAddress, symbol: 'USDC' },
            { chainId: 56, address: ATS.address, symbol: 'ATS' },
            { chainId: 1, symbol: 'DAI' },
            { chainId: 99999, symbol: 'ETH' },
            { chainId: 1, address: '0x' + '42'.repeat(20), symbol: 'USDT' },
            { chainId: 1, symbol: 'YOKTOKEN' },
            { chainId: 56, address: '0x' + '42'.repeat(20), symbol: 'X' },
            {}, undefined,
        ]
        for (const t of ornekler) expect(hasPrivateLogo(t), JSON.stringify(t)).toBe(privateTokenLogo(t) !== UNKNOWN_TOKEN_LOGO)
        expect(hasPrivateLogo(ornekler[0])).toBe(true)
        expect(hasPrivateLogo(ornekler[6])).toBe(false)
        expect(hasPrivateLogo(ornekler[8])).toBe(false)
    })
})

describe('privateChainBadge', () => {
    it('teslim aginin paketli zincir logosu; ag okunamiyorsa null (rozet cizilmez)', () => {
        for (const chain of DELIVERY_CHAINS) expect(privateChainBadge(chain.chainId), String(chain.chainId)).toBe(`/chains/${chain.chainId}.png`)
        expect(privateChainBadge('56')).toBe('/chains/56.png')
        for (const bad of [null, undefined, 99999, 'abc', 'solana-mainnet']) expect(privateChainBadge(bad), String(bad)).toBeNull()
    })
})

describe('privateTokenLogo: sonuc her zaman paketli yerel yol', () => {
    it('donen her dosya gercekten client/public altindadir (uzak adres yok, olu baglanti yok)', () => {
        for (const chain of DELIVERY_CHAINS) {
            for (const symbol of ['USDC', chain.nativeSymbol, 'ETH', 'USDT', 'DAI', 'ATS', 'WBTC', 'CAKE', 'XYZ']) {
                const logo = privateTokenLogo({ chainId: chain.chainId, symbol })
                expect(logo, `${chain.chainId}:${symbol}`).toMatch(/^\//)
                expect(publicFile(logo), `${chain.chainId}:${symbol} -> ${logo}`).toBe(true)
            }
        }
    })
})
