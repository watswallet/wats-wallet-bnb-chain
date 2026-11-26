import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { ZeroAddress, getAddress } from 'ethers'
import { LCX_NATIVE } from './routerGuard.js'
import { LCX_CHAIN_IDS, toLcxToken, slippageToBps, lcxEligible, lcxKindFor } from './select.js'

const USDC_LOWER = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const USDT_LOWER = '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'
const WETH_LOWER = '0x4200000000000000000000000000000000000006'

describe('LCX_CHAIN_IDS', () => {
    it('sekiz LCX agi, plandaki sirayla', () => {
        expect(LCX_CHAIN_IDS).toEqual([1, 56, 10, 137, 42161, 8453, 100, 25])
    })

    it('dondurulmus: calisma zamaninda degistirilemez', () => {
        expect(Object.isFrozen(LCX_CHAIN_IDS)).toBe(true)
    })
})

describe('toLcxToken', () => {
    it("'0x0' LCX native adresine cevrilir", () => {
        expect(toLcxToken('0x0')).toBe(LCX_NATIVE)
    })

    it('ZeroAddress LCX native adresine cevrilir', () => {
        expect(toLcxToken(ZeroAddress)).toBe(LCX_NATIVE)
        expect(LCX_NATIVE).toBe('0x0000000000000000000000000000000000000000')
    })

    it('kucuk harfli ERC-20 adresi checksum bicimine cevrilir', () => {
        expect(toLcxToken(USDC_LOWER)).toBe(getAddress(USDC_LOWER))
        expect(toLcxToken(USDC_LOWER)).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    })

    it('zaten checksum olan adres degismez', () => {
        expect(toLcxToken('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    })

    it('gecersiz adres sessizce gecmez: firlatir', () => {
        expect(() => toLcxToken('0x1234')).toThrow()
        expect(() => toLcxToken('abc')).toThrow()
        expect(() => toLcxToken(undefined)).toThrow()
    })

    describe('native isaretcileri nativeAsset.js ile AYNI kumeden (R16)', () => {
        const EEEE_CHECKSUM = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

        it('0xEeee...EEeE (piyasa standardi placeholder) LCX native adresine cevrilir', () => {
            expect(toLcxToken(EEEE_CHECKSUM)).toBe(LCX_NATIVE)
        })

        it.each([
            ['kucuk harf', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'],
            ['buyuk harf', '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'],
            ['ZeroAddress', ZeroAddress],
            ['0x0', '0x0'],
            ['0X0 buyuk X', '0X0'],
            ['kenar bosluklu', '  0x0  '],
        ])('%s native sayilir', (_ad, deger) => {
            expect(toLcxToken(deger)).toBe(LCX_NATIVE)
        })

        it('isNativeAsset ile ayni kume: ondan "native" donen her dize LCX_NATIVE e cevrilir', async () => {
            const { isNativeAsset } = await import('../nativeAsset.js')
            for (const dize of ['0x0', ZeroAddress, EEEE_CHECKSUM, EEEE_CHECKSUM.toLowerCase()]) {
                expect(isNativeAsset(dize), dize).toBe(true)
                expect(toLcxToken(dize), dize).toBe(LCX_NATIVE)
            }
        })

        it.each([[null], [undefined], [''], ['   '], [0], [{}], [[]], [true]])(
            'isNativeAsset un "native" dedigi null/bos/dize-disi girdi (%p) native sayilmaz: firlatir',
            (deger) => {
                expect(() => toLcxToken(deger)).toThrow(TypeError)
            },
        )

        it('native gibi gorunen ama tam olmayan adres native sayilmaz', () => {
            expect(() => toLcxToken('0x00')).toThrow()
            expect(() => toLcxToken('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toThrow() // 39 hane
        })
    })
})

describe('slippageToBps', () => {
    it('yuzde -> baz puan (Math.round(p*100))', () => {
        expect(slippageToBps(0.5)).toBe(50)
        expect(slippageToBps(1)).toBe(100)
        expect(slippageToBps(0.07)).toBe(7)
    })

    it('sinirlar: 1 ve 2000 dahil', () => {
        expect(slippageToBps(0.01)).toBe(1)
        expect(slippageToBps(20)).toBe(2000)
    })

    it('aralik disi null: 2000 uzeri, 0, negatif, 1 bps altina yuvarlanan', () => {
        expect(slippageToBps(20.01)).toBeNull()
        expect(slippageToBps(0)).toBeNull()
        expect(slippageToBps(-1)).toBeNull()
        expect(slippageToBps(0.004)).toBeNull()
    })

    it('sayi olmayan girdi null', () => {
        expect(slippageToBps('abc')).toBeNull()
        expect(slippageToBps(NaN)).toBeNull()
        expect(slippageToBps(Infinity)).toBeNull()
        expect(slippageToBps(undefined)).toBeNull()
        expect(slippageToBps(null)).toBeNull()
        expect(slippageToBps('')).toBeNull()
        expect(slippageToBps(true)).toBeNull()
        expect(slippageToBps({})).toBeNull()
    })

    it('sayisal dizge de kabul edilir (arayuz girdisi dizge olabilir)', () => {
        expect(slippageToBps('0.5')).toBe(50)
        expect(slippageToBps('20.01')).toBeNull()
    })
})

describe('lcxEligible', () => {
    const TAMAM = { enabled: true, privateSigner: false, chainId: 8453, slippageBps: 50 }

    it('tum kosullar saglaninca true', () => {
        expect(lcxEligible(TAMAM)).toBe(true)
    })

    it('bayrak kapali -> false', () => {
        expect(lcxEligible({ ...TAMAM, enabled: false })).toBe(false)
    })

    it.each([[undefined], [null], ['false'], [0], [''], [NaN]])(
        'privateSigner AYNEN false degilse (%p) false: eksik ya da yanlis yazilmis alan kapiyi acmaz (R15)',
        (deger) => {
            expect(lcxEligible({ ...TAMAM, privateSigner: deger })).toBe(false)
        },
    )

    it('privateSigner alani HIC verilmezse ya da yanlis yazilirsa (privateSigned) false', () => {
        const { privateSigner: _atildi, ...alansiz } = TAMAM
        expect(lcxEligible(alansiz)).toBe(false)
        expect(lcxEligible({ ...alansiz, privateSigned: false })).toBe(false)
    })

    it('gizli imzaci -> false (LCX e hic istek yok)', () => {
        expect(lcxEligible({ ...TAMAM, privateSigner: true })).toBe(false)
    })

    it('LCX agi degil -> false', () => {
        expect(lcxEligible({ ...TAMAM, chainId: 5 })).toBe(false)
        expect(lcxEligible({ ...TAMAM, chainId: 42220 })).toBe(false)
        expect(lcxEligible({ ...TAMAM, chainId: undefined })).toBe(false)
    })

    it('kayma gecersiz (null) -> false', () => {
        expect(lcxEligible({ ...TAMAM, slippageBps: null })).toBe(false)
    })

    it('sekiz agin hepsi uygun', () => {
        for (const chainId of LCX_CHAIN_IDS) expect(lcxEligible({ ...TAMAM, chainId })).toBe(true)
    })

    it('kayma tanimsiz ya da aralik disi sayi gelirse de false (kapali basarisizlik)', () => {
        expect(lcxEligible({ ...TAMAM, slippageBps: undefined })).toBe(false)
        expect(lcxEligible({ ...TAMAM, slippageBps: 0 })).toBe(false)
        expect(lcxEligible({ ...TAMAM, slippageBps: 2001 })).toBe(false)
    })
})

describe('lcxKindFor', () => {
    const stablecoins = new Map([[8453, new Set([USDC_LOWER, USDT_LOWER])]])
    const baz = { chainId: 8453, stablecoins }

    it('iki taraf da o agin stablecoin kumesinde -> stable', () => {
        expect(lcxKindFor({ ...baz, tokenIn: USDC_LOWER, tokenOut: USDT_LOWER })).toBe('stable')
    })

    it('adres harf duyarsiz karsilastirilir (checksum girdi)', () => {
        expect(lcxKindFor({ ...baz, tokenIn: getAddress(USDC_LOWER), tokenOut: getAddress(USDT_LOWER) })).toBe('stable')
    })

    it('taraflardan biri kumede degil -> swap', () => {
        expect(lcxKindFor({ ...baz, tokenIn: USDC_LOWER, tokenOut: WETH_LOWER })).toBe('swap')
        expect(lcxKindFor({ ...baz, tokenIn: WETH_LOWER, tokenOut: USDT_LOWER })).toBe('swap')
    })

    it('native taraf -> swap', () => {
        expect(lcxKindFor({ ...baz, tokenIn: '0x0', tokenOut: USDC_LOWER })).toBe('swap')
        expect(lcxKindFor({ ...baz, tokenIn: USDC_LOWER, tokenOut: ZeroAddress })).toBe('swap')
    })

    it('0xEeee...EEeE native isaretcisi de native sayilir -> swap', () => {
        const EEEE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
        expect(lcxKindFor({ ...baz, tokenIn: EEEE, tokenOut: USDC_LOWER })).toBe('swap')
        expect(lcxKindFor({ ...baz, tokenIn: USDC_LOWER, tokenOut: EEEE.toLowerCase() })).toBe('swap')
        // Kume bile o adresi icerse native taraf kazanir (kumeye "yanlislikla" girmis olsa da stable secilmez).
        const kirli = new Map([[8453, new Set([USDC_LOWER, EEEE.toLowerCase()])]])
        expect(lcxKindFor({ chainId: 8453, stablecoins: kirli, tokenIn: USDC_LOWER, tokenOut: EEEE })).toBe('swap')
    })

    it('null / bos taraf stable sayilmaz', () => {
        expect(lcxKindFor({ ...baz, tokenIn: null, tokenOut: USDT_LOWER })).toBe('swap')
        expect(lcxKindFor({ ...baz, tokenIn: USDC_LOWER, tokenOut: '' })).toBe('swap')
    })

    it('kume baska agin: o agda kume yok -> swap', () => {
        expect(lcxKindFor({ chainId: 1, stablecoins, tokenIn: USDC_LOWER, tokenOut: USDT_LOWER })).toBe('swap')
    })

    it('kume bos ya da kayit bos Map -> swap (stable yolu kapanir, genel takas surer)', () => {
        expect(lcxKindFor({ chainId: 8453, stablecoins: new Map(), tokenIn: USDC_LOWER, tokenOut: USDT_LOWER })).toBe('swap')
        expect(lcxKindFor({ chainId: 8453, stablecoins: new Map([[8453, new Set()]]), tokenIn: USDC_LOWER, tokenOut: USDT_LOWER })).toBe('swap')
        expect(lcxKindFor({ chainId: 8453, stablecoins: undefined, tokenIn: USDC_LOWER, tokenOut: USDT_LOWER })).toBe('swap')
    })
})

describe('LCX_ENABLED bayragi (featureFlags.js)', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })
    const load = async () => {
        vi.resetModules()
        return (await import('../featureFlags.js')).LCX_ENABLED
    }

    it('degisken yoksa KAPALI', async () => {
        vi.unstubAllEnvs()
        expect(await load()).toBe(false)
    })

    it("yalniz tam 'true' metni acar", async () => {
        vi.stubEnv('VITE_LCX_ENABLED', 'true')
        expect(await load()).toBe(true)
    })

    it.each([['TRUE'], ['1'], ['yes'], ['false'], [''], [' true']])('%p KAPALI (kati kural)', async (value) => {
        vi.stubEnv('VITE_LCX_ENABLED', value)
        expect(await load()).toBe(false)
    })

    it('.env.production ve .env.development bayragi KAPALI yazar (acmak ayri bir insan commit i)', () => {
        for (const ad of ['.env.production', '.env.development']) {
            const metin = readFileSync(new URL('../../../' + ad, import.meta.url), 'utf8')
            const satirlar = metin.split(/\r?\n/).filter((l) => l.startsWith('VITE_LCX_ENABLED'))
            expect(satirlar, ad).toEqual(['VITE_LCX_ENABLED=false'])
        }
    })
})
