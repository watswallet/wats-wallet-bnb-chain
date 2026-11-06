import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getAddress } from 'ethers'
import { SOURCE_CHAINS, isSourceChainId } from '@silentswap/chains'
import { getAssetOnChain } from '@silentswap/sdk'
import supportedChains from '../../data/supported_chains.json'
import { ATS_CHAINS } from '../atsConfig'
import { CHAIN_CONFIG } from '../swapChains'
import { isEvm } from '../chainKind'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import {
    DELIVERY_CHAINS, DELIVERY_CHAIN_IDS, BSC_DELIVERY_CHAIN_ID, LIST_VIOLATION,
    canonicalChainId, deliveryChainOf, defaultAssetOf, parseDeliveryChains, checkDeliveryLists,
} from './deliveryChains'

const KAYNAK = fileURLToPath(new URL('./deliveryChains.js', import.meta.url))
const registryOf = (id) => supportedChains.find((c) => c.chainId === id)

describe('deliveryChains tablosu (K6): tek kaynak, SDK ve kayit dosyasiyla birebir', () => {
    it('on ag, seciciyle ayni sirada; BSC ilk satir', () => {
        expect(DELIVERY_CHAIN_IDS).toEqual([56, 1, 8453, 42161, 10, 137, 100, 42220, 5000, 25])
        expect(DELIVERY_CHAINS.map((c) => c.chainId)).toEqual(DELIVERY_CHAIN_IDS)
        expect(BSC_DELIVERY_CHAIN_ID).toBe(56)
        expect(DELIVERY_CHAINS[0].chainId).toBe(BSC_DELIVERY_CHAIN_ID)
    })

    it('tablo ve her satir dondurulmustur', () => {
        expect(Object.isFrozen(DELIVERY_CHAINS)).toBe(true)
        expect(Object.isFrozen(DELIVERY_CHAIN_IDS)).toBe(true)
        for (const c of DELIVERY_CHAINS) expect(Object.isFrozen(c), String(c.chainId)).toBe(true)
    })

    it.each(DELIVERY_CHAIN_IDS)('ag %i: USDC adresi ve ondaligi SDK kayit defteriyle birebir (checksum bicimli)', (id) => {
        const c = deliveryChainOf(id)
        expect(isSourceChainId(id)).toBe(true)
        expect(c.usdcAddress).toBe(SOURCE_CHAINS[id].usdcAddress)
        expect(c.usdcDecimals).toBe(SOURCE_CHAINS[id].usdcDecimals)
        const asset = getAssetOnChain('USDC', id)
        expect(getAddress(asset.address)).toBe(c.usdcAddress)
        expect(Number(asset.decimals)).toBe(c.usdcDecimals)
        expect(getAddress(c.usdcAddress)).toBe(c.usdcAddress)
    })

    it.each(DELIVERY_CHAIN_IDS)('ag %i: ad ile yerel coin sembolu ve ondaligi supported_chains.json ve SDK ile ayni', (id) => {
        const c = deliveryChainOf(id)
        const kayit = registryOf(id)
        expect(c.name).toBe(kayit.name)
        expect(c.nativeSymbol).toBe(kayit.nativeCurrency.symbol)
        expect(c.nativeDecimals).toBe(kayit.nativeCurrency.decimals)
        expect(c.nativeSymbol).toBe(SOURCE_CHAINS[id].viemChain.nativeCurrency.symbol)
        expect(c.nativeDecimals).toBe(SOURCE_CHAINS[id].viemChain.nativeCurrency.decimals)
    })

    it('tum kayitlar EVM', () => {
        for (const id of DELIVERY_CHAIN_IDS) expect(isEvm(id), String(id)).toBe(true)
    })

    // Zincir tablolari zaten elle esit tutuluyor: 11. ag hepsine dokunur, biri unutulursa burasi kirmizi.
    it('id kumesi ATS_CHAINS ve swapChains CHAIN_CONFIG anahtarlariyla esit', () => {
        const sirali = (liste) => [...liste].map(Number).sort((a, b) => a - b)
        expect(sirali(DELIVERY_CHAIN_IDS)).toEqual(sirali(Object.keys(ATS_CHAINS)))
        expect(sirali(DELIVERY_CHAIN_IDS)).toEqual(sirali(Object.keys(CHAIN_CONFIG)))
    })

    // P1: fonlu kanit yerel coindedir; USDC varsayilani yalniz BSC'de (alt proje 1'den beri).
    it('defaultAsset yalniz 56da usdc, ote yandaki dokuz agda native', () => {
        for (const c of DELIVERY_CHAINS) expect(c.defaultAsset, String(c.chainId)).toBe(c.chainId === 56 ? 'usdc' : 'native')
    })

    // Aktivite sunucusu (server/controllers/walletController.js CHAINS) yalniz alti teslim agina gecmis verir;
    // oteki dort ag 400 Unsupported chain doner. Alan, ozel modda gereksiz istegi kesmek icindir (spec 4.1, 4.7).
    it('activityServer alani walletController.js CHAINS anahtarlariyla esit (kaynak taramasi)', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('../../../../server/controllers/walletController.js', import.meta.url)), 'utf8')
        const govde = kaynak.match(/const CHAINS = \{([\s\S]*?)\}/)
        expect(govde, 'walletController.js CHAINS bulunamadi').not.toBeNull()
        const sunucu = new Set([...govde[1].matchAll(/^\s*(\d+)\s*:/gm)].map((m) => Number(m[1])))
        expect(sunucu.size).toBeGreaterThan(0)
        for (const c of DELIVERY_CHAINS) expect(c.activityServer, String(c.chainId)).toBe(sunucu.has(c.chainId))
    })

    it('her yerel logo dosyasi client/public/chains altinda vardir', () => {
        for (const c of DELIVERY_CHAINS) {
            expect(c.logo).toBe(`/chains/${c.chainId}.png`)
            expect(existsSync(fileURLToPath(new URL(`../../../public${c.logo}`, import.meta.url))), c.logo).toBe(true)
        }
    })

    it('rota yalniz bilgi alani: iki siniftan biri', () => {
        for (const c of DELIVERY_CHAINS) expect(['cex-direct', 'deposit-bridge'], String(c.chainId)).toContain(c.route)
    })
})

describe('deliveryChains.js bagimsizdir (yapilandirma dosyasi de import eder)', () => {
    it('hicbir sey import etmez, ortam okumaz (kaynak taramasi, yorumsuz)', () => {
        const kod = yorumsuz(readFileSync(KAYNAK, 'utf8'))
        expect(kod).not.toMatch(/\bimport\b/)
        expect(kod).not.toMatch(/\brequire\s*\(/)
        expect(kod).not.toMatch(/import\.meta/)
        expect(kod).not.toMatch(/process\.env/)
    })

    // manifest.config.js bu dosyayi Node'da (Vite yapilandirma yukleyicisiyle) import eder: bundler olmadan da yuklenmeli.
    it('Node ESM olarak, bundler olmadan yuklenir', () => {
        const betik = `import(${JSON.stringify(pathToFileURL(KAYNAK).href)}).then((m) => console.log(Object.keys(m).sort().join(',')))`
        const cikti = execFileSync(process.execPath, ['--input-type=module', '-e', betik], { encoding: 'utf8' }).trim()
        expect(cikti.split(',')).toEqual(expect.arrayContaining(['DELIVERY_CHAINS', 'parseDeliveryChains', 'checkDeliveryLists']))
    })
})

describe('canonicalChainId ve deliveryChainOf', () => {
    it('sayi ve kanonik ondalik dizge kabul edilir', () => {
        expect(canonicalChainId(8453)).toBe(8453)
        expect(canonicalChainId('8453')).toBe(8453)
        expect(deliveryChainOf('8453').name).toBe('Base')
        expect(deliveryChainOf(56).chainId).toBe(56)
    })

    it('kanonik olmayan ya da tabloda olmayan kimlik null', () => {
        for (const v of [undefined, null, '', ' 8453', '8453 ', '08453', '0x2105', '8453.5', 8453.5, 0, '0', -1, '-1', NaN, Infinity, true, {}, [], [8453], 'abc', '1e3']) {
            expect(deliveryChainOf(v), JSON.stringify(v) ?? String(v)).toBeNull()
        }
        expect(canonicalChainId(99999)).toBe(99999)
        expect(deliveryChainOf(99999)).toBeNull()
        expect(deliveryChainOf(43114)).toBeNull()
    })
})

describe('defaultAssetOf (P1)', () => {
    it('BSC usdc, diger aglar native; yerel teslim kapaliyken her yerde usdc; bilinmeyen ag null', () => {
        expect(defaultAssetOf(56, true)).toBe('usdc')
        expect(defaultAssetOf(8453, true)).toBe('native')
        expect(defaultAssetOf('1', true)).toBe('native')
        expect(defaultAssetOf(8453, false)).toBe('usdc')
        expect(defaultAssetOf(56, false)).toBe('usdc')
        expect(defaultAssetOf(8453, undefined)).toBe('usdc')
        expect(defaultAssetOf(99999, true)).toBeNull()
        expect(defaultAssetOf(undefined, true)).toBeNull()
    })
})

describe('parseDeliveryChains (4.2 kural 2)', () => {
    it('degisken yok, bos, yalniz bosluk ya da dizge degil: hicbir ag, gecersiz de yok', () => {
        for (const v of [undefined, null, '', '   ', 56, {}, [], true]) {
            expect(parseDeliveryChains(v), JSON.stringify(v) ?? String(v)).toEqual({ ids: [], invalid: [] })
        }
    })

    it('gecerli ogeler tablo sirasiyla ve tekil; kirpma ve tekrar', () => {
        expect(parseDeliveryChains('25, 1 ,56,8453').ids).toEqual([56, 1, 8453, 25])
        expect(parseDeliveryChains('56,56,56').ids).toEqual([56])
        expect(parseDeliveryChains('1,56,8453,42161,10,137,100,42220,5000,25').ids).toEqual(DELIVERY_CHAIN_IDS)
        expect(parseDeliveryChains('56').invalid).toEqual([])
    })

    it('kanonik olmayan, tabloda olmayan ve bos ogeler invalid listesine gider', () => {
        const r = parseDeliveryChains('56,abc,0,-1,1.5,99999,056,1e3,0x38, ,8453')
        expect(r.ids).toEqual([56, 8453])
        expect(r.invalid).toEqual(['abc', '0', '-1', '1.5', '99999', '056', '1e3', '0x38', ''])
        expect(parseDeliveryChains('56,,1').invalid).toEqual([''])
        expect(parseDeliveryChains('56,').invalid).toEqual([''])
        expect(parseDeliveryChains('43114').invalid).toEqual(['43114'])
    })
})

describe('checkDeliveryLists (4.2 kural 3 + 1.10 teslim degismezi): degismezler', () => {
    const HEPSI = DELIVERY_CHAIN_IDS
    // Gonder kaynagi olan aglar: cagiran (deliveryChainSetting.js, manifest.config.js) hasPrivateSendSource ile hesaplayip ACIKCA verir.
    const KAYNAKLI = HEPSI

    it('gecerli ciftler ihlal uretmez', () => {
        expect(checkDeliveryLists([], [], KAYNAKLI)).toEqual([])
        expect(checkDeliveryLists(HEPSI, [], KAYNAKLI)).toEqual([])
        expect(checkDeliveryLists([56], [56], KAYNAKLI)).toEqual([])
        expect(checkDeliveryLists(HEPSI, [56], KAYNAKLI)).toEqual([])
        expect(checkDeliveryLists([8453], [], KAYNAKLI)).toEqual([])
        expect(checkDeliveryLists(HEPSI, HEPSI, KAYNAKLI)).toEqual([])
    })

    it('(a) Para yukle Gonder listesinin altkumesi degilse ihlal', () => {
        expect(checkDeliveryLists([56], [56, 1], KAYNAKLI)).toEqual([LIST_VIOLATION.FUND_NOT_IN_SEND])
        expect(checkDeliveryLists([], [56], KAYNAKLI)).toEqual([LIST_VIOLATION.FUND_NOT_IN_SEND])
        expect(checkDeliveryLists([1, 56], [56, 1], KAYNAKLI)).toEqual([])
    })

    it('(b) Para yuklede BSC disi ag varsa 56 da olmali', () => {
        expect(checkDeliveryLists([1, 8453], [1], KAYNAKLI)).toEqual([LIST_VIOLATION.FUND_NEEDS_BSC])
        expect(checkDeliveryLists([56, 1], [56, 1], KAYNAKLI)).toEqual([])
    })

    // 1.10 teslim degismezi: ATS satisi satin alma yolu artik sart DEGIL (uretimde kapali); yerine her Para yukle agi icin en az bir Gonder
    // kaynagi sarti gelir (teslim edilen varlik yalniz Gonder ile cikabilir).
    it('(c) Para yuklede Gonder kaynagi olmayan ag varsa ihlal; ATS satisi bayragina bagli degil', () => {
        expect(checkDeliveryLists([56, 1], [56, 1], [56])).toEqual([LIST_VIOLATION.FUND_NO_SEND_SOURCE])
        expect(checkDeliveryLists([56, 1, 8453], [56, 1, 8453], [56, 8453])).toEqual([LIST_VIOLATION.FUND_NO_SEND_SOURCE])
        expect(checkDeliveryLists([56, 1], [56, 1], [])).toEqual([LIST_VIOLATION.FUND_NO_SEND_SOURCE])
        expect(checkDeliveryLists([56, 1], [56, 1], [56, 1])).toEqual([])
        // Gonder kaynagi yalniz Para yukle'deki aglar icin sarttir
        expect(checkDeliveryLists([56, 1], [56], [56])).toEqual([])
        // eski ATS satisi ihlali kodu artik yok
        expect(LIST_VIOLATION.FUND_NEEDS_ATS_SALE).toBeUndefined()
    })

    // Gizli varsayilan yok: kaynakli aglar acikca verilir; verilmeyen / dizi olmayan deger "hicbir agin kaynagi yok" sayilir (fail-closed).
    it('imzada gizli varsayilan yok: Gonder kaynakli aglar acikca verilir, verilmezse BSC disi Para yukle reddedilir', () => {
        const kod = yorumsuz(readFileSync(KAYNAK, 'utf8'))
        expect(kod).toContain('export function checkDeliveryLists(send, fund, sendSourceChains) {')
        expect(kod).not.toMatch(/sendSourceChains\s*=/)
        expect(checkDeliveryLists([56, 1], [56, 1])).toEqual([LIST_VIOLATION.FUND_NO_SEND_SOURCE])
        expect(checkDeliveryLists([56], [56], undefined)).toEqual([LIST_VIOLATION.FUND_NO_SEND_SOURCE])
        expect(checkDeliveryLists([56], [56], 'x')).toEqual([LIST_VIOLATION.FUND_NO_SEND_SOURCE])
    })

    it('ihlaller birlikte raporlanir; Para yukle bos ya da dizi degilse Gonder kaynagi aranmaz', () => {
        expect(checkDeliveryLists([56], [1], [56])).toEqual([
            LIST_VIOLATION.FUND_NOT_IN_SEND, LIST_VIOLATION.FUND_NEEDS_BSC, LIST_VIOLATION.FUND_NO_SEND_SOURCE,
        ])
        expect(checkDeliveryLists(undefined, undefined)).toEqual([])
        expect(checkDeliveryLists('56', '56')).toEqual([])
    })
})
