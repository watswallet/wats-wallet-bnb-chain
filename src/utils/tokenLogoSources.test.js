// Normal mod TEK token logo cozucusu: siralama, yerel coin kurali, Trust Wallet checksum'u, gizli mod anahtari.
import { describe, it, expect, afterEach } from 'vitest'
import { getAddress } from 'ethers'
import {
    tokenLogoSources, hasLogoSource, trustWalletLogo, toChecksumAddress, coinLogoOfSymbol, nativeCoinLogo, isLogoPlaceholder,
} from './tokenLogoSources'
import { setLocalLogosOnly } from './tokenLogo'
import { LOCAL_TOKEN_LOGOS, localTokenLogoPath } from './privacy/localTokenLogos'

afterEach(() => setLocalLogosOnly(false))

const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca' // Ethereum: paketli
const UNKNOWN_POLYGON = '0x1111111111111111111111111111111111111111'
const IMG = { large: 'https://cdn.example/large/x.png', small: 'https://cdn.example/small/x.png', thumb: 'https://cdn.example/thumb/x.png' }

describe('toChecksumAddress -- ethers.getAddress ile ayni', () => {
    it('EIP-55 resmi vektorleri', () => {
        for (const v of [
            '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
            '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
        ]) expect(toChecksumAddress(v.toLowerCase())).toBe(v)
    })

    it('rastgele 300 adreste ethers ile birebir', () => {
        let seed = 12345
        const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed }
        for (let i = 0; i < 300; i++) {
            let hex = ''
            for (let k = 0; k < 40; k++) hex += (next() % 16).toString(16)
            expect(toChecksumAddress('0x' + hex)).toBe(getAddress('0x' + hex))
        }
    })

    it('gecersiz girdi null', () => {
        for (const v of [undefined, null, '', '0x123', 'zz', 123, '0x' + 'g'.repeat(40)]) expect(toChecksumAddress(v)).toBeNull()
    })
})

describe('tokenLogoSources -- SIRA: paketli > uzak > Trust Wallet', () => {
    it('paketli dosya (ag, adres) her zaman ilk; sonra sunucu gorseli; en sonda Trust Wallet', () => {
        expect(hasLogoSource({ chainId: 1, address: LINK })).toBe(true)
        const list = tokenLogoSources({ chainId: 1, address: LINK, symbol: 'LINK', image: IMG })
        expect(list[0]).toBe(localTokenLogoPath(1, LINK))
        expect(list.slice(1, 4)).toEqual([IMG.large, IMG.small, IMG.thumb])
        expect(list[4]).toBe('https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/' + getAddress(LINK) + '/logo.png')
        expect(list).toHaveLength(5)
    })

    it('paketli dosya yoksa sunucu gorseli ilk, Trust Wallet son', () => {
        const list = tokenLogoSources({ chainId: 137, address: UNKNOWN_POLYGON, symbol: 'X', image: IMG, logoURI: 'https://old.example/x.png' })
        expect(list).toEqual([
            IMG.large, IMG.small, IMG.thumb, 'https://old.example/x.png',
            'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/' + getAddress(UNKNOWN_POLYGON) + '/logo.png',
        ])
    })

    it('image DIZE ise (TON jetton) dogrudan kullanilir; logo ve iconUrl alanlari da okunur', () => {
        expect(tokenLogoSources({ chainId: -239, address: 'EQabc', image: 'https://tether.to/t.png' })).toEqual(['https://tether.to/t.png'])
        expect(tokenLogoSources({ chainId: 1, address: UNKNOWN_POLYGON, logo: 'https://a/l.png', iconUrl: 'https://a/i.png' }).slice(0, 2)).toEqual(['https://a/l.png', 'https://a/i.png'])
    })

    it('yer tutucu dosyalar (default-token.png vb.) LOGO SAYILMAZ', () => {
        for (const p of ['/default-token.png', '/default-dapp.png', '/default-chain.png', 'https://x/y/default-token.png?v=2']) expect(isLogoPlaceholder(p)).toBe(true)
        const list = tokenLogoSources({ chainId: 'solana-mainnet', address: 'native', symbol: 'FOO', image: { large: '/default-token.png', small: '/default-token.png', thumb: '/default-token.png' } })
        expect(list.join('|')).not.toMatch(/default-/)
        expect(hasLogoSource({ symbol: 'FOO', image: { large: '/default-token.png' } })).toBe(false)
    })

    it('cozulemeyen / bozuk girdi bos dizi doner ve firlatmaz', () => {
        for (const t of [undefined, null, {}, 'x', 5, { image: 7 }, { image: { large: '' } }, { chainId: 1 }]) {
            expect(tokenLogoSources(t)).toEqual([])
            expect(hasLogoSource(t)).toBe(false)
        }
    })

    it('tekrarlanan adres tek kez yer alir', () => {
        const list = tokenLogoSources({ chainId: 1, address: UNKNOWN_POLYGON, image: { large: 'https://a/x.png', small: 'https://a/x.png', thumb: 'https://a/x.png' }, logoURI: 'https://a/x.png' })
        expect(list.filter((u) => u === 'https://a/x.png')).toHaveLength(1)
    })

    it('kayit chainId tasimiyorsa verilen ag kullanilir (ice aktarilmis tokenlar)', () => {
        const list = tokenLogoSources({ address: LINK, symbol: 'LINK' }, { chainId: 1 })
        expect(list[0]).toBe(localTokenLogoPath(1, LINK))
    })

    it('agin USDC adresi /usdc.png, ATS /ats.png', () => {
        expect(tokenLogoSources({ chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' })[0]).toBeDefined()
        const bscUsdc = tokenLogoSources({ chainId: 56, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' })
        expect(bscUsdc[0]).toMatch(/^\/(usdc\.png|tokens\/56\/)/)
    })
})

describe('yerel coin = COININ logosu', () => {
    it('ETH hangi L2 olursa olsun ETH elmasi (/chains/1.png)', () => {
        for (const chainId of [1, 8453, 42161, 10]) {
            expect(tokenLogoSources({ chainId, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', native: true })[0]).toBe('/chains/1.png')
        }
        // sembol yoksa agin kendi coini
        expect(nativeCoinLogo(8453, undefined)).toBe('/chains/1.png')
    })

    it('BNB / POL / CELO / MNT / CRO kendi ag logosu; xDAI Gnosis sifir adres dosyasi', () => {
        expect(coinLogoOfSymbol('BNB')).toBe('/chains/56.png')
        expect(coinLogoOfSymbol('POL')).toBe('/chains/137.png')
        expect(coinLogoOfSymbol('MATIC')).toBe('/chains/137.png')
        expect(coinLogoOfSymbol('CELO')).toBe('/chains/42220.png')
        expect(coinLogoOfSymbol('MNT')).toBe('/chains/5000.png')
        expect(coinLogoOfSymbol('CRO')).toBe('/chains/25.png')
        expect(coinLogoOfSymbol('DOGE')).toBeNull()
        const xdai = tokenLogoSources({ chainId: 100, address: '0x0', symbol: 'XDAI' })[0]
        expect(xdai).toBe('/tokens/100/0x0000000000000000000000000000000000000000.png')
        expect(LOCAL_TOKEN_LOGOS.has('100:0x0000000000000000000000000000000000000000')).toBe(true)
    })

    it('yerel coinde Trust Wallet adayi YOK; sunucu gorseli paketlinin ardindan gelir', () => {
        const list = tokenLogoSources({ chainId: 56, address: '0x0', symbol: 'BNB', native: true, image: IMG })
        expect(list).toEqual(['/chains/56.png', IMG.large, IMG.small, IMG.thumb])
    })

    it('Solana: SOL ag logosu, SPL mint icin Trust Wallet son aday', () => {
        expect(tokenLogoSources({ chainId: 'solana-mainnet', address: 'native', native: true, symbol: 'SOL' })[0]).toBe('/chains/solana.svg')
        const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const list = tokenLogoSources({ chainId: 'solana-mainnet', address: mint, symbol: 'USDC', image: 'https://cdn/usdc.png' })
        expect(list).toEqual(['https://cdn/usdc.png', 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/' + mint + '/logo.png'])
    })
})

describe('Trust Wallet adresi', () => {
    it('ag + checksum adres; desteklenmeyen ag / bozuk adres null', () => {
        expect(trustWalletLogo(8453, UNKNOWN_POLYGON)).toBe('https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/' + getAddress(UNKNOWN_POLYGON) + '/logo.png')
        expect(trustWalletLogo(999999, UNKNOWN_POLYGON)).toBeNull()
        expect(trustWalletLogo(1, '0x123')).toBeNull()
        expect(trustWalletLogo(-239, 'EQabc')).toBeNull()
        expect(trustWalletLogo(undefined, UNKNOWN_POLYGON)).toBeNull()
    })
})

describe('gizli mod anahtari acikken uzak kaynak YOK', () => {
    it('yalniz yerel yollar doner: sunucu gorseli ve Trust Wallet elenir', () => {
        setLocalLogosOnly(true)
        expect(tokenLogoSources({ chainId: 1, address: LINK, image: IMG, logoURI: 'https://old/x.png' })).toEqual([localTokenLogoPath(1, LINK)])
        expect(tokenLogoSources({ chainId: 137, address: UNKNOWN_POLYGON, image: IMG })).toEqual([])
        expect(hasLogoSource({ chainId: 137, address: UNKNOWN_POLYGON, image: IMG })).toBe(false)
        expect(tokenLogoSources({ chainId: 1, address: '0x0', symbol: 'ETH', native: true, image: IMG })).toEqual(['/chains/1.png'])
    })
})
