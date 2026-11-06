import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import { getAssetOnChain, NATIVE_TOKEN_SENTINEL } from '@silentswap/sdk'
import { ATS_CHAINS } from '../atsConfig'
import { DELIVERY_CHAINS, DELIVERY_CHAIN_IDS } from './deliveryChains'
import {
    DELIVERY_VERSION, USDC_LOGO, nativeTokenOf, usdcTokenOf, defaultDeliveryToken, deliveryTokenKey, normalizeDeliveryToken,
    deliveryTokenFromMessage, deliveryTokenFromRecord, isNativeDeliveryToken, isUsdcDeliveryToken, buildDeliveryTokenList,
} from './deliveryTokens'

const CAKE = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
const XYZ = getAddress('0x' + '42'.repeat(20))
const ZERO = '0x' + '0'.repeat(40)
const BSC_USDC = usdcTokenOf(56).address
const BASE_USDC = usdcTokenOf(8453).address
const neden = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }
const TOKEN_HATASI = { message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' }
const AG_HATASI = { message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken.chainId' }
const cake = (chainId = 56, over = {}) => ({ chainId, address: CAKE, symbol: 'CAKE', decimals: 18, ...over })

describe('deliveryTokens: tablodan gelen tekil sabitler', () => {
    it.each(DELIVERY_CHAIN_IDS)('ag %i: USDC SDK kayit defteriyle, yerel coin sifir adresle ve tablo sembolu/ondaligiyla ayni', (id) => {
        const usdc = getAssetOnChain('USDC', id)
        expect(usdcTokenOf(id)).toEqual({ chainId: id, address: getAddress(usdc.address), symbol: 'USDC', decimals: Number(usdc.decimals) })
        const tablo = DELIVERY_CHAINS.find((c) => c.chainId === id)
        expect(nativeTokenOf(id)).toEqual({ chainId: id, address: NATIVE_TOKEN_SENTINEL, symbol: tablo.nativeSymbol, decimals: 18 })
        expect(Object.isFrozen(usdcTokenOf(id))).toBe(true)
        expect(Object.isFrozen(nativeTokenOf(id))).toBe(true)
    })

    // K5: sifir adres artik "BNB" degil, secilen agin yerel coinidir.
    it('yerel coin agdan agaya degisir: BSC BNB, Base ETH, Polygon POL, Gnosis XDAI', () => {
        expect(nativeTokenOf(56).symbol).toBe('BNB')
        expect(nativeTokenOf(8453).symbol).toBe('ETH')
        expect(nativeTokenOf(137).symbol).toBe('POL')
        expect(nativeTokenOf(100).symbol).toBe('XDAI')
        expect(usdcTokenOf(56).decimals).toBe(18)
        expect(usdcTokenOf(8453).decimals).toBe(6)
    })

    it('bilinmeyen ag ya da kanonik olmayan kimlik null; dizge kimlik de cozulur', () => {
        for (const v of [undefined, null, 99999, 43114, '08453', 8453.5, 'Base']) {
            expect(nativeTokenOf(v), String(v)).toBeNull()
            expect(usdcTokenOf(v), String(v)).toBeNull()
            expect(defaultDeliveryToken(v, true), String(v)).toBeNull()
        }
        expect(usdcTokenOf('8453')).toBe(usdcTokenOf(8453))
    })

    it('varsayilan teslim tokeni (P1): BSC USDC, BSC disi yerel coin; yerel teslim kapaliysa her yerde USDC', () => {
        expect(defaultDeliveryToken(56, true)).toBe(usdcTokenOf(56))
        expect(defaultDeliveryToken(8453, true)).toBe(nativeTokenOf(8453))
        expect(defaultDeliveryToken(8453, false)).toBe(usdcTokenOf(8453))
        expect(defaultDeliveryToken(56, false)).toBe(usdcTokenOf(56))
    })

    it('kimlik anahtari (chainId, adres): adres tek basina kimlik degildir', () => {
        expect(deliveryTokenKey(nativeTokenOf(56))).toBe(`56:${ZERO}`)
        expect(deliveryTokenKey(nativeTokenOf(56))).not.toBe(deliveryTokenKey(nativeTokenOf(8453)))
        expect(deliveryTokenKey({ chainId: 8453, address: CAKE })).toBe(`8453:${CAKE.toLowerCase()}`)
    })

    it('surum sabiti 2', () => {
        expect(DELIVERY_VERSION).toBe(2)
    })
})

describe('normalizeDeliveryToken: chainId ZORUNLU (K4)', () => {
    it('eksik, tabloda olmayan ya da kanonik olmayan chainId reddedilir (sessizce BSC e dusmez)', () => {
        for (const chainId of [undefined, null, '', 99999, 43114, 8453.5, '8453.5', '08453', ' 8453', 'Base', -1, 0, NaN, {}, [8453]]) {
            expect(neden(() => normalizeDeliveryToken({ ...cake(), chainId })), JSON.stringify(chainId) ?? String(chainId)).toEqual(AG_HATASI)
        }
        const { chainId, ...eksik } = cake()
        expect(neden(() => normalizeDeliveryToken(eksik))).toEqual(AG_HATASI)
    })

    it('sayi ve kanonik ondalik dizge kabul edilir; sonuc HER ZAMAN sayidir', () => {
        expect(normalizeDeliveryToken(cake(8453)).chainId).toBe(8453)
        expect(normalizeDeliveryToken(cake('8453')).chainId).toBe(8453)
        expect(normalizeDeliveryToken(cake('8453'))).toEqual({ chainId: 8453, address: CAKE, symbol: 'CAKE', decimals: 18 })
    })

    it('gecerli token: adres kanonik, sembol kirpilir ve buyutulur, ondalik sayi ya da rakam dizgesi; sonuc dondurulmustur', () => {
        const t = normalizeDeliveryToken({ chainId: 56, address: CAKE.toLowerCase(), symbol: ' cake ', decimals: 18 })
        expect(t).toEqual({ chainId: 56, address: CAKE, symbol: 'CAKE', decimals: 18 })
        expect(Object.isFrozen(t)).toBe(true)
        expect(normalizeDeliveryToken(cake(56, { decimals: '6' })).decimals).toBe(6)
        expect(normalizeDeliveryToken(cake(56, { symbol: 'C', decimals: 0 })).decimals).toBe(0)
    })

    // K5, K6: sifir adres o agin yerel coin tekilidir; gelen sembol ve ondalik YOK SAYILIR (bozuk olsa bile).
    it('sifir adres o agin yerel coinine doner: Base ETH, BSC BNB, Polygon POL; gelen sembol/ondalik yok sayilir', () => {
        expect(normalizeDeliveryToken({ chainId: 8453, address: ZERO, symbol: 'SAHTE', decimals: 6 })).toBe(nativeTokenOf(8453))
        expect(normalizeDeliveryToken({ chainId: 56, address: ZERO, symbol: 'ETH', decimals: 8 })).toBe(nativeTokenOf(56))
        expect(normalizeDeliveryToken({ chainId: '137', address: ZERO })).toBe(nativeTokenOf(137))
        expect(normalizeDeliveryToken({ chainId: 8453, address: ZERO, symbol: 'X'.repeat(50), decimals: 99 })).toBe(nativeTokenOf(8453))
        expect(normalizeDeliveryToken({ chainId: 8453, address: ZERO }).symbol).toBe('ETH')
    })

    it('tablo USDC adresi o agin USDC tekilidir (ondalik 6 ya da 18); gelen sembol/ondalik yok sayilir', () => {
        expect(normalizeDeliveryToken({ chainId: 56, address: BSC_USDC.toLowerCase(), symbol: 'SAHTE', decimals: 6 })).toBe(usdcTokenOf(56))
        expect(normalizeDeliveryToken({ chainId: 8453, address: BASE_USDC, symbol: 'USDC', decimals: 18 })).toBe(usdcTokenOf(8453))
        expect(normalizeDeliveryToken({ chainId: 8453, address: BASE_USDC.toLowerCase() }).decimals).toBe(6)
    })

    // Adres tek basina kimlik degildir: ayni adres baska agda baska bir tokendir.
    it('baska agin USDC adresi bu agda USDC SAYILMAZ (siradan token olarak dogrulanir)', () => {
        const t = normalizeDeliveryToken({ chainId: 8453, address: BSC_USDC, symbol: 'usdc', decimals: 18 })
        expect(t).toEqual({ chainId: 8453, address: BSC_USDC, symbol: 'USDC', decimals: 18 })
        expect(t).not.toBe(usdcTokenOf(8453))
        expect(isUsdcDeliveryToken(t)).toBe(false)
        const b = normalizeDeliveryToken({ chainId: 56, address: BASE_USDC, symbol: 'USDC', decimals: 6 })
        expect(isUsdcDeliveryToken(b)).toBe(false)
        expect(neden(() => normalizeDeliveryToken({ chainId: 8453, address: BSC_USDC, symbol: 'USDC', decimals: 99 }))).toEqual(TOKEN_HATASI)
    })

    it('yer tutucu 0xeeee... her agda reddedilir (buyuk/kucuk harf fark etmez)', () => {
        for (const chainId of [56, 8453, 1]) {
            for (const address of ['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']) {
                expect(neden(() => normalizeDeliveryToken({ chainId, address, symbol: 'ETH', decimals: 18 })), `${chainId} ${address}`).toEqual(TOKEN_HATASI)
            }
        }
    })

    it('eski dizge uyumu YOKTUR: USDC ve BNB dizgeleri reddedilir', () => {
        for (const v of ['USDC', 'BNB', 'usdc']) expect(neden(() => normalizeDeliveryToken(v)), v).toEqual(TOKEN_HATASI)
    })

    it('bozuk girdi PRIVATE_UNSUPPORTED, reason request.outputToken', () => {
        const kotu = [null, undefined, 'usdc', 'DAI', 42,
            cake(56, { address: 'garbage' }), cake(56, { address: '0x0' }),
            cake(56, { decimals: 37 }), cake(56, { decimals: -1 }), cake(56, { decimals: 1.5 }), cake(56, { decimals: '1e2' }),
            cake(56, { symbol: '' }), cake(56, { symbol: '   ' }), cake(56, { symbol: 'X'.repeat(21) }), cake(56, { symbol: 'A\u0000B' }),
            cake(56, { symbol: 7 }),
            // Gorunmez / yon degistiren karakterler: C1 kontrol, sifir genislik, bidi gecersiz kilma, bidi izolasyon, BOM.
            cake(56, { symbol: 'A\u200bB' }), cake(56, { symbol: 'AB\u202e' }), cake(56, { symbol: 'A\u2066B' }),
            cake(56, { symbol: '\ufeffAB' }), cake(56, { symbol: 'A\u0085B' })]
        for (const v of kotu) {
            expect(neden(() => normalizeDeliveryToken(v)), JSON.stringify(v) ?? String(v)).toEqual(TOKEN_HATASI)
        }
    })

    // FA3: sinir degerleri kabul edilir (36 ondalik sayi ve rakam dizgesi, tam 20 karakterlik sembol); 21 reddedilir.
    it('sinirlar: ondalik 36 (sayi ve "36") ve tam 20 karakterlik sembol kabul edilir', () => {
        expect(normalizeDeliveryToken(cake(56, { decimals: 36 })).decimals).toBe(36)
        expect(normalizeDeliveryToken(cake(56, { decimals: '36' })).decimals).toBe(36)
        const yirmi = 'S'.repeat(20)
        expect(normalizeDeliveryToken(cake(56, { symbol: yirmi })).symbol).toBe(yirmi)
        expect(neden(() => normalizeDeliveryToken(cake(56, { symbol: 'S'.repeat(21) })))).toEqual(TOKEN_HATASI)
    })

    // FA7: sembol karakter sinifi Unicode ozelligiyle (Cc, Cf, Zl, Zp); HAM degerde, kirpmadan once.
    it('sembolde bicim/ayirici/kontrol karakterleri reddedilir (U+061C, U+2060, U+2064, U+00AD, U+180E, U+2028, U+2029)', () => {
        for (const ch of ['\u061c', '\u2060', '\u2064', '\u00ad', '\u180e', '\u2028', '\u2029']) {
            for (const symbol of ['A' + ch + 'B', ch + 'AB', 'AB' + ch]) {
                expect(neden(() => normalizeDeliveryToken(cake(56, { symbol }))), JSON.stringify(symbol)).toEqual(TOKEN_HATASI)
            }
        }
    })

    it('siradan semboller gecer: USDC, CAKE, ETH.e (ETH.E olur), CJK, U+20AE iceren', () => {
        for (const [symbol, beklenen] of [['USDC', 'USDC'], ['CAKE', 'CAKE'], ['ETH.e', 'ETH.E'], ['比特币', '比特币'], ['T₮G', 'T₮G']]) {
            expect(normalizeDeliveryToken(cake(56, { symbol })).symbol, symbol).toBe(beklenen)
        }
    })

    // Sunucu listesi sembolleri kucuk harf tutar; cuzdan sembolu her yerde buyuk harf gosterir. Tek nokta burasi.
    it('sembol buyuk harfe cevrilir: cake -> CAKE, Cake -> CAKE, stETH -> STETH', () => {
        for (const [ham, beklenen] of [['cake', 'CAKE'], ['Cake', 'CAKE'], ['stETH', 'STETH'], [' cake ', 'CAKE']]) {
            expect(normalizeDeliveryToken(cake(56, { symbol: ham })).symbol, ham).toBe(beklenen)
        }
    })

    it('buyutme yerel ayarsiz: i noktali buyuk I (U+0130) olmaz (inj -> INJ)', () => {
        const s = normalizeDeliveryToken(cake(56, { symbol: 'inj' })).symbol
        expect(s).toBe('INJ')
        expect(s).not.toContain('İ')
    })

    it('uzunluk denetimi buyutmeden SONRA: 19 a + ss (20 karakter) buyuyunca 21 olur ve reddedilir', () => {
        const ham = 'a'.repeat(19) + 'ß'
        expect(ham.length).toBe(20)
        expect(ham.toUpperCase().length).toBe(21)
        expect(neden(() => normalizeDeliveryToken(cake(56, { symbol: ham })))).toEqual(TOKEN_HATASI)
    })
})

describe('isNativeDeliveryToken ve isUsdcDeliveryToken: (chainId, adres) ile karar verir', () => {
    it('yerel ve USDC tanimlari ag basinadir', () => {
        expect(isNativeDeliveryToken(nativeTokenOf(8453))).toBe(true)
        expect(isNativeDeliveryToken(usdcTokenOf(8453))).toBe(false)
        expect(isUsdcDeliveryToken(usdcTokenOf(8453))).toBe(true)
        expect(isUsdcDeliveryToken(normalizeDeliveryToken(cake(8453)))).toBe(false)
    })

    // FA8: normallestirilmemis (kucuk harfli) adres USDC-yalniz min <= odeme kuralini sessizce atlatmasin.
    it('adres buyuk/kucuk harfinden bagimsiz', () => {
        expect(isUsdcDeliveryToken({ chainId: 8453, address: BASE_USDC.toLowerCase() })).toBe(true)
        expect(isUsdcDeliveryToken({ chainId: '8453', address: BASE_USDC.toUpperCase().replace('0X', '0x') })).toBe(true)
        expect(isNativeDeliveryToken({ chainId: 56, address: ZERO })).toBe(true)
    })

    it('baska agin USDC adresi bu agda USDC degil; bilinmeyen ag ve nesne olmayan girdi false', () => {
        expect(isUsdcDeliveryToken({ chainId: 8453, address: BSC_USDC })).toBe(false)
        expect(isUsdcDeliveryToken({ chainId: 56, address: BASE_USDC })).toBe(false)
        expect(isUsdcDeliveryToken({ chainId: 99999, address: BASE_USDC })).toBe(false)
        expect(isNativeDeliveryToken({ chainId: 99999, address: ZERO })).toBe(false)
        expect(isNativeDeliveryToken({ address: ZERO })).toBe(false)
        for (const v of [null, undefined, 'USDC', 42, true, {}]) {
            expect(isUsdcDeliveryToken(v), String(v)).toBe(false)
            expect(isNativeDeliveryToken(v), String(v)).toBe(false)
        }
    })
})

describe('deliveryTokenFromMessage: VARSAYILAN YOK (K4)', () => {
    it('outputToken zorunlu: alan yok, bos nesne, undefined ya da eski outputAsset dizgesi reddedilir', () => {
        for (const v of [{}, undefined, null, { amount: '1' }, { outputAsset: 'USDC' }, { outputAsset: 'BNB' }, { outputToken: null }, { outputToken: 'USDC' }, 'x']) {
            expect(neden(() => deliveryTokenFromMessage(v)), JSON.stringify(v) ?? String(v)).toEqual(TOKEN_HATASI)
        }
    })

    it('gecerli outputToken (chainId dahil) normallestirilir; outputToken eski outputAsset alanindan once gelir', () => {
        expect(deliveryTokenFromMessage({ outputToken: cake(8453) })).toEqual({ chainId: 8453, address: CAKE, symbol: 'CAKE', decimals: 18 })
        expect(deliveryTokenFromMessage({ outputToken: cake(56), outputAsset: 'BNB' })).toEqual({ chainId: 56, address: CAKE, symbol: 'CAKE', decimals: 18 })
    })

    it('chainId yoksa ya da bozuksa PRIVATE_UNSUPPORTED (sessizce BSC USDC ye dusmez)', () => {
        const { chainId, ...eksik } = cake()
        expect(neden(() => deliveryTokenFromMessage({ outputToken: eksik }))).toEqual(AG_HATASI)
        expect(neden(() => deliveryTokenFromMessage({ outputToken: cake(99999) }))).toEqual(AG_HATASI)
    })
})

describe('deliveryTokenFromRecord: surum 2 sart (D5, E4)', () => {
    it('surum 2 ve gecerli outputToken kabul edilir', () => {
        expect(deliveryTokenFromRecord({ deliveryVersion: 2, outputToken: cake(8453) })).toEqual({ chainId: 8453, address: CAKE, symbol: 'CAKE', decimals: 18 })
    })

    it('surumsuz, farkli surumlu ya da kayit olmayan girdi reddedilir (eski kayit yolu yok)', () => {
        for (const v of [{ outputToken: cake() }, { deliveryVersion: 1, outputToken: cake() }, { deliveryVersion: '2', outputToken: cake() }, { deliveryVersion: 3, outputToken: cake() }, null, undefined, 'x']) {
            expect(neden(() => deliveryTokenFromRecord(v)), JSON.stringify(v) ?? String(v)).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'record.deliveryVersion' })
        }
    })

    it('surum 2 ama outputToken eksik ya da bozuk: PRIVATE_UNSUPPORTED', () => {
        expect(neden(() => deliveryTokenFromRecord({ deliveryVersion: 2 }))).toEqual(TOKEN_HATASI)
        expect(neden(() => deliveryTokenFromRecord({ deliveryVersion: 2, outputToken: cake(99999) }))).toEqual(AG_HATASI)
        expect(neden(() => deliveryTokenFromRecord({ deliveryVersion: 2, outputToken: { ...cake(), decimals: 99 } }))).toEqual(TOKEN_HATASI)
    })
})

describe('buildDeliveryTokenList', () => {
    const remote = [
        { address: '0x0', symbol: 'BNB', name: 'BNB', decimals: 18, native: true, image: { large: 'https://img/bnb.png' } },
        { address: CAKE.toLowerCase(), symbol: 'CAKE', name: 'PancakeSwap', decimals: 18, image: { large: 'https://img/cake.png' } },
        { address: BSC_USDC.toLowerCase(), symbol: 'USDC', name: 'USD Coin', decimals: 18, image: { large: 'https://img/usdc.png' } },
        { address: getAddress('0x' + '11'.repeat(20)), symbol: 'NODEC', name: 'Ondaliksiz' },
        { address: 'garbage', symbol: 'BAD', name: 'Bozuk', decimals: 18 },
        { address: getAddress('0x' + '22'.repeat(20)), symbol: 'L'.repeat(25), name: 'Uzun', decimals: 18 },
        // Gorunmez / yon degistiren sembol ve yerel-token yer tutucusu: sessizce duser.
        { address: getAddress('0x' + '33'.repeat(20)), symbol: 'A\u200bB', name: 'Sifir genislik', decimals: 18 },
        { address: getAddress('0x' + '44'.repeat(20)), symbol: 'AB\u202e', name: 'Bidi', decimals: 18 },
        { address: getAddress('0x' + '55'.repeat(20)), symbol: 'A\u2066B', name: 'Izolasyon', decimals: 18 },
        { address: getAddress('0x' + '66'.repeat(20)), symbol: '\ufeffAB', name: 'BOM', decimals: 18 },
        { address: getAddress('0x' + '77'.repeat(20)), symbol: 'A\u0085B', name: 'C1', decimals: 18 },
        { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', name: 'Yer tutucu', decimals: 18 },
    ]
    const imported = [
        { address: XYZ, symbol: 'XYZ', name: 'Xyz Token', decimals: '9', logoURI: 'xyz.png' },
        { address: CAKE, symbol: 'CAKE', name: 'Cake (ice aktarilan)', decimals: 18 },
    ]
    const BSC = { chainId: 56, nativeEnabled: true }
    const semboller = (liste) => liste.map((t) => t.symbol)

    it('chainId ZORUNLU: eksik ya da tabloda olmayan ag PRIVATE_UNSUPPORTED', () => {
        for (const chainId of [undefined, null, 99999, '08453', 8453.5]) {
            expect(neden(() => buildDeliveryTokenList({ chainId, nativeEnabled: true })), String(chainId)).toEqual(AG_HATASI)
        }
        expect(neden(() => buildDeliveryTokenList())).toEqual(AG_HATASI)
    })

    it('BSC sirasi: BNB, USDC, ATS (sabit); sonra ice aktarilanlar, sunucu listesi; ayni adres bir kez; bozuk kayitlar duser', () => {
        const list = buildDeliveryTokenList({ ...BSC, imported, remote })
        expect(semboller(list)).toEqual(['BNB', 'USDC', 'ATS', 'XYZ', 'CAKE'])
        expect(list[3]).toMatchObject({ chainId: 56, address: XYZ, decimals: 9, name: 'Xyz Token' })
        // CAKE ice aktarilandan gelir (ilk gorulen kazanir), sunucu kopyasi dusurulur.
        expect(list[4].name).toBe('Cake (ice aktarilan)')
        expect(list.every((t) => t.chainId === 56)).toBe(true)
    })

    it('ATS yalniz BSC listesinde ve ATS_CHAINS kaydindan (kopya adres yok)', () => {
        const ats = ATS_CHAINS[56].token
        const bsc = buildDeliveryTokenList(BSC).find((t) => t.symbol === 'ATS')
        expect(bsc).toMatchObject({ chainId: 56, address: getAddress(ats.address), decimals: ats.decimals })
        for (const id of DELIVERY_CHAIN_IDS.filter((x) => x !== 56)) {
            expect(semboller(buildDeliveryTokenList({ chainId: id, nativeEnabled: true })), String(id)).not.toContain('ATS')
        }
    })

    it('sabit satirlar ag basina: Base listesi ETH, USDC (6 ondalik); Polygon POL', () => {
        const base = buildDeliveryTokenList({ chainId: 8453, nativeEnabled: true })
        expect(semboller(base)).toEqual(['ETH', 'USDC'])
        expect(base[0]).toMatchObject({ chainId: 8453, address: ZERO, decimals: 18 })
        expect(base[1]).toMatchObject({ chainId: 8453, address: BASE_USDC, decimals: 6 })
        expect(semboller(buildDeliveryTokenList({ chainId: 137, nativeEnabled: true }))).toEqual(['POL', 'USDC'])
    })

    // Logo kurali TEK yerdedir (privateTokenLogo.js, kilidi privateTokenLogo.guard.test.js): liste satirlari logo (image/logoURI) TASIMAZ, sunucu ya da
    // ice aktarilan satirdaki uzak logo alanlari satira girmez. USDC_LOGO yerel dosya sabitidir.
    it('satirlar logo tasimaz: image / logoURI yok; USDC_LOGO yerel dosya sabiti', () => {
        expect(USDC_LOGO).toBe('/usdc.png')
        for (const chainId of DELIVERY_CHAIN_IDS) {
            for (const t of buildDeliveryTokenList({ chainId, nativeEnabled: true, imported, remote })) {
                expect(t, `${chainId}:${t.symbol}`).not.toHaveProperty('image')
                expect(t, `${chainId}:${t.symbol}`).not.toHaveProperty('logoURI')
            }
        }
    })

    it('yerel teslim kapaliyken yerel coin hic listelenmez (sunucunun yerel kaydi da)', () => {
        const list = buildDeliveryTokenList({ chainId: 56, nativeEnabled: false, imported, remote })
        expect(semboller(list)).toEqual(['USDC', 'ATS', 'XYZ', 'CAKE'])
    })

    it('arama sembol, ad ve tam adreste; buyuk/kucuk harf duyarsiz', () => {
        const ara = (search) => semboller(buildDeliveryTokenList({ ...BSC, imported, remote, search }))
        expect(ara('CaKe')).toEqual(['CAKE'])
        expect(ara(' usd ')).toEqual(['USDC'])
        expect(ara(XYZ.toLowerCase())).toEqual(['XYZ'])
        expect(ara('')).toEqual(['BNB', 'USDC', 'ATS', 'XYZ', 'CAKE'])
    })

    // FA6: sifir adresli, native:true OLMAYAN kayit yerel kapaliyken listeye hic girmez; aciksa tek satir ve sabit giris.
    it('sifir adresli (native bayraksiz) kayit: yerel kapaliyken yok; aciksa tek satir ve sabit giris', () => {
        const zeroEntry = { address: ZERO, symbol: 'SAHTEBNB', name: 'Sahte', decimals: 6 }
        const girdi = { imported: [zeroEntry, ...imported], remote: [zeroEntry, ...remote] }
        expect(semboller(buildDeliveryTokenList({ chainId: 56, nativeEnabled: false, ...girdi }))).toEqual(['USDC', 'ATS', 'XYZ', 'CAKE'])
        const acik = buildDeliveryTokenList({ ...BSC, ...girdi })
        const bnb = acik.filter((t) => t.address === ZERO)
        expect(bnb).toHaveLength(1)
        expect(bnb[0]).toMatchObject({ chainId: 56, symbol: 'BNB', decimals: 18, name: 'BNB' })
    })

    // FA4: ayni (chainId, adres) iki kaynakta FARKLI ondalikla geldiyse belirsiz: token listeden tamamen dusurulur.
    it('ayni adres, farkli ondalik (ice aktarilan 8, sunucu 18): CAKE satiri yok; sirasi ters de ayni', () => {
        const imp = [{ address: CAKE, symbol: 'CAKE', name: 'Cake', decimals: 8 }]
        const rem = [{ address: CAKE.toLowerCase(), symbol: 'CAKE', name: 'Cake', decimals: 18 }]
        expect(semboller(buildDeliveryTokenList({ chainId: 56, imported: imp, remote: rem }))).toEqual(['USDC', 'ATS'])
        expect(semboller(buildDeliveryTokenList({ chainId: 56, imported: rem, remote: imp }))).toEqual(['USDC', 'ATS'])
        expect(semboller(buildDeliveryTokenList({ chainId: 56, imported: [...imp, ...rem] }))).toEqual(['USDC', 'ATS'])
    })

    it('ayni adres, ayni ondalik: tam bir CAKE satiri', () => {
        const imp = [{ address: CAKE, symbol: 'CAKE', name: 'Cake', decimals: 18 }]
        const rem = [{ address: CAKE.toLowerCase(), symbol: 'CAKE', name: 'Cake', decimals: '18' }]
        expect(buildDeliveryTokenList({ chainId: 56, imported: imp, remote: rem }).filter((t) => t.symbol === 'CAKE')).toHaveLength(1)
    })

    it('USDC adresinde uyusmayan kayit: yine tek sabit USDC; yerel coin sabiti de dusmez', () => {
        const kotu = [{ address: BSC_USDC, symbol: 'USDC', decimals: 6 }, { address: BSC_USDC.toLowerCase(), symbol: 'USDC', decimals: 8 },
            { address: ZERO, symbol: 'BNB', decimals: 6 }]
        const list = buildDeliveryTokenList({ ...BSC, imported: kotu, remote: kotu })
        expect(list.filter((t) => t.address === BSC_USDC)).toHaveLength(1)
        expect(list.find((t) => t.symbol === 'USDC')).toMatchObject({ address: BSC_USDC, decimals: 18 })
        expect(list.filter((t) => t.address === ZERO)).toHaveLength(1)
        expect(semboller(list)).toEqual(['BNB', 'USDC', 'ATS'])
    })

    // FA9: liste adi yalniz gorunum ve arama metnidir; gorunmez/yon karakterleri atilir, 60 ile sinirlanir, bosa sembol.
    it('ad temizligi: U+202E ve U+200B atilir, en fazla 60 karakter; bos kalirsa sembol', () => {
        const uzun = 'Cake\u202e' + 'A\u200b'.repeat(157)
        expect(uzun.length).toBe(5 + 314)
        const cakeSatiri = buildDeliveryTokenList({ chainId: 56, imported: [{ address: CAKE, symbol: 'CAKE', name: uzun, decimals: 18 }] }).find((t) => t.symbol === 'CAKE')
        expect(cakeSatiri.name).not.toMatch(/[\u202e\u200b]/)
        expect(cakeSatiri.name.length).toBeLessThanOrEqual(60)
        expect(cakeSatiri.name.startsWith('CakeAAAA')).toBe(true)
        const bos = buildDeliveryTokenList({ chainId: 56, imported: [{ address: XYZ, symbol: 'XYZ', name: '\u200b\u202e  ', decimals: 9 }] })
        expect(bos.find((t) => t.symbol === 'XYZ').name).toBe('XYZ')
    })

    // Sunucu (/getChainTokens) sembolleri kucuk harf saklar: secici satiri buyuk harfle gelir, arama yine bulur.
    it('sunucu kaydi kucuk harf sembolle (cake) gelir: satir CAKE, "cake" ve "CAKE" aramasi bulur', () => {
        const rem = [{ address: CAKE.toLowerCase(), symbol: 'cake', name: 'PancakeSwap', decimals: 18 }]
        expect(semboller(buildDeliveryTokenList({ chainId: 56, remote: rem }))).toEqual(['USDC', 'ATS', 'CAKE'])
        expect(semboller(buildDeliveryTokenList({ chainId: 56, remote: rem, search: 'cake' }))).toEqual(['CAKE'])
        expect(semboller(buildDeliveryTokenList({ chainId: 56, remote: rem, search: 'CAKE' }))).toEqual(['CAKE'])
    })

    it('liste girdileri dizi degilse cokmez; sabit satirlar yine gelir', () => {
        expect(semboller(buildDeliveryTokenList({ ...BSC, imported: null, remote: { tokens: [] } }))).toEqual(['BNB', 'USDC', 'ATS'])
    })

    // 4.1 "Satirin agi (damgalama)": uc kaynak agi farkli tasir; ag karari normallestirmeden ONCE ve seciciye gore verilir.
    describe('satirin agi (damgalama kurallari)', () => {
        it('ImportToken bicimli satir (chain: slug, chainId YOK) secici aginda gorunur ve o ag damgasini alir', () => {
            const satir = { name: 'Cake', symbol: 'CAKE', decimals: 18, address: CAKE, chain: 'base', image: { thumb: '', small: '', large: '' }, coingecko_id: null }
            const list = buildDeliveryTokenList({ chainId: 8453, imported: [satir] })
            expect(list.find((t) => t.symbol === 'CAKE')).toMatchObject({ chainId: 8453, address: CAKE })
        })

        it('teslim yazicisi bicimli satir (chain: null) gorunur', () => {
            const satir = { name: 'CAKE', symbol: 'CAKE', decimals: 18, address: CAKE, image: { thumb: '', small: '', large: '' }, chain: null, coingecko_id: null }
            expect(semboller(buildDeliveryTokenList({ chainId: 8453, imported: [satir] }))).toContain('CAKE')
        })

        it('baska ag damgali sunucu satiri DUSER: ayni adres baska agda baska bir tokendir', () => {
            const satir56 = { chainId: 56, address: CAKE, symbol: 'CAKE', decimals: 18, name: 'Cake' }
            expect(semboller(buildDeliveryTokenList({ chainId: 8453, remote: [satir56] }))).not.toContain('CAKE')
            expect(semboller(buildDeliveryTokenList({ chainId: 8453, imported: [satir56] }))).not.toContain('CAKE')
            // ayni satir kendi aginda gorunur; chainId dizge de olabilir
            expect(semboller(buildDeliveryTokenList({ chainId: 56, remote: [satir56] }))).toContain('CAKE')
            expect(semboller(buildDeliveryTokenList({ chainId: 56, remote: [{ ...satir56, chainId: '56' }] }))).toContain('CAKE')
        })

        // Normallestirme satirin kendi chainId'sini seciciyle EZSEYDI, 56 damgali satir sessizce Base'e donerdi.
        it('ag karari normallestirmeden ONCE verilir: damgali satir secici agina CEVRILMEZ, dusurulur', () => {
            const list = buildDeliveryTokenList({ chainId: 8453, remote: [{ chainId: 56, address: XYZ, symbol: 'XYZ', decimals: 9, name: 'Xyz' }, { chainId: 8453, address: XYZ, symbol: 'XYZ', decimals: 9, name: 'Xyz' }] })
            expect(list.filter((t) => t.symbol === 'XYZ')).toHaveLength(1)
            expect(list.find((t) => t.symbol === 'XYZ').chainId).toBe(8453)
            expect(semboller(buildDeliveryTokenList({ chainId: 8453, remote: [{ chainId: 56, address: XYZ, symbol: 'XYZ', decimals: 9, name: 'Xyz' }] }))).not.toContain('XYZ')
        })

        it('bozuk ya da kanonik olmayan chainId tasiyan satir da duser (sessizce secici agina donusturulmez)', () => {
            // [8453], '0x2105', '08453' ve ' 8453' Number() ile 8453'e donusur (secici aginda ESLESIRDI): kanonik olmadiklari icin DUSMELIDIR
            // (K4); true da kanonik bir ag kimligi degildir.
            for (const chainId of ['abc', '', NaN, 0, {}, 99999, true, [8453], '0x2105', '08453', ' 8453']) {
                const list = buildDeliveryTokenList({ chainId: 8453, remote: [{ chainId, address: XYZ, symbol: 'XYZ', decimals: 9, name: 'Xyz' }] })
                expect(semboller(list), JSON.stringify(chainId) ?? String(chainId)).not.toContain('XYZ')
            }
        })

        it('(chainId, adres) tekillestirmesi: ayni adres iki agda iki ayri listede, bir listede tek satir', () => {
            const rem = (chainId) => [{ chainId, address: XYZ, symbol: 'XYZ', decimals: 9, name: 'Xyz' }]
            expect(buildDeliveryTokenList({ chainId: 56, remote: rem(56) }).filter((t) => t.symbol === 'XYZ')).toHaveLength(1)
            expect(buildDeliveryTokenList({ chainId: 8453, remote: rem(8453) }).filter((t) => t.symbol === 'XYZ')).toHaveLength(1)
        })
    })
})
