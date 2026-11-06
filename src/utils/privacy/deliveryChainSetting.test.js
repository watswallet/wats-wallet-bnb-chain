import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { DELIVERY_CHAIN_IDS, deliveryChainOf } from './deliveryChains'
import { openDeliveryChains, isDeliveryChainOpen, defaultDeliveryChain } from './deliveryChainSetting'

// Hangi aglarin Gonder kaynagi oldugu testin elindedir (null = gercek tablo: on agin hepsi). Teslim degismezi (1.10): Para yukle'deki her
// agin en az bir Gonder kaynagi olmali.
const kaynak = vi.hoisted(() => ({ only: null }))
vi.mock('./privateBridgedSources', async (importOriginal) => {
    const orig = await importOriginal()
    return { ...orig, hasPrivateSendSource: (id) => (kaynak.only === null ? orig.hasPrivateSendSource(id) : kaynak.only.includes(id)) }
})

const ayarla = (send, fund) => {
    vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', send)
    vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', fund)
}
const idler = (ekran) => openDeliveryChains(ekran).map((c) => c.chainId)

afterEach(() => { vi.unstubAllEnvs(); kaynak.only = null })

describe('deliveryChainSetting: iki derleme listesi (spec 4.2)', () => {
    // Test ortami Para yukle'yi de on ag acar (her agin Gonder kaynagi var; ATS satisi bayragi artik sart degil).
    it('test ortami (vitest.config.js test.env): Gonder ve Para yukle on agin hepsi', () => {
        expect(idler('send')).toEqual(DELIVERY_CHAIN_IDS)
        expect(idler('fund')).toEqual(DELIVERY_CHAIN_IDS)
    })

    // E1, kural 1: bayrak yoklugu "hepsi acik" demek degildir; BSC dahil hicbir ag acik olmaz.
    it('degisken yok, bos ya da yalniz bosluk: o ekran icin hicbir ag acik degil (BSC dahil)', () => {
        for (const v of [undefined, '', '   ']) {
            ayarla(v, v)
            for (const ekran of ['send', 'fund']) {
                expect(idler(ekran), `${ekran} ${JSON.stringify(v)}`).toEqual([])
                expect(isDeliveryChainOpen(ekran, 56)).toBe(false)
                expect(defaultDeliveryChain(ekran)).toBeNull()
            }
        }
    })

    it('ekran basina ayri kumeler, tablo sirasiyla', () => {
        ayarla('25,8453,1,56', '56')
        expect(idler('send')).toEqual([56, 1, 8453, 25])
        expect(idler('fund')).toEqual([56])
        expect(isDeliveryChainOpen('send', 8453)).toBe(true)
        expect(isDeliveryChainOpen('fund', 8453)).toBe(false)
        expect(isDeliveryChainOpen('send', 137)).toBe(false)
    })

    it('varsayilan ag: tablo sirasindaki ilk acik ag (56 aciksa 56), hicbiri yoksa null', () => {
        ayarla('8453,1,56', '56')
        expect(defaultDeliveryChain('send')).toBe(56)
        ayarla('8453,1', '')
        expect(defaultDeliveryChain('send')).toBe(1)
        ayarla('25,8453', '')
        expect(defaultDeliveryChain('send')).toBe(8453)
        expect(defaultDeliveryChain('fund')).toBeNull()
    })

    it('bilinmeyen ekran hicbir ag acmaz (fail-closed)', () => {
        for (const ekran of ['', 'x', undefined, null, 'SEND', 'transfer']) {
            expect(openDeliveryChains(ekran), String(ekran)).toEqual([])
            expect(isDeliveryChainOpen(ekran, 56)).toBe(false)
            expect(defaultDeliveryChain(ekran)).toBeNull()
        }
    })

    // Kural 3: ihlalde YALNIZ Para yukle listesi bos sayilir; Gonder listesi etkilenmez.
    it('degismez ihlali: Para yukle listesi bos sayilir, Gonder listesi degismez', () => {
        ayarla('1', '56')
        expect([idler('send'), idler('fund')]).toEqual([[1], []])
        ayarla('56,1', '1')
        expect([idler('send'), idler('fund')]).toEqual([[56, 1], []])
        ayarla('56,1', '56')
        expect([idler('send'), idler('fund')]).toEqual([[56, 1], [56]])
    })

    // Teslim degismezi (1.10): ATS satisi bayragi Para yukle'yi ARTIK etkilemez; yerine her Para yukle agi icin en az bir Gonder kaynagi
    // sarti gelir. Biri eksikse Para yukle listesi BOS sayilir (BSC bile kapanir: kullanici yarim liste ile kapali kapida kalmasin),
    // Gonder listesi etkilenmez.
    it('BSC disi Para yukle: ATS satisi bayragi ne olursa olsun acik; Gonder kaynagi olmayan ag varsa Para yukle BOS sayilir', () => {
        ayarla('56,1,8453', '56,8453')
        for (const v of ['true', 'false', '', 'TRUE', undefined]) {
            vi.stubEnv('VITE_PRIVATE_ATS_SALE', v)
            expect([idler('send'), idler('fund')], JSON.stringify(v)).toEqual([[56, 1, 8453], [56, 8453]])
        }
        expect(isDeliveryChainOpen('fund', 8453)).toBe(true)
        kaynak.only = [56, 1]
        expect([idler('send'), idler('fund')]).toEqual([[56, 1, 8453], []])
        expect(defaultDeliveryChain('fund')).toBeNull()
        kaynak.only = [56, 8453]
        expect([idler('send'), idler('fund')]).toEqual([[56, 1, 8453], [56, 8453]])
        // Gonder kaynagi yalniz Para yukle'deki aglar icin sarttir
        ayarla('56,1,8453', '56')
        kaynak.only = [56]
        expect([idler('send'), idler('fund')]).toEqual([[56, 1, 8453], [56]])
    })

    it('gecersiz ve tabloda olmayan ogeler acilmaz (derleme kapisi onlari zaten reddeder)', () => {
        ayarla('56,abc,43114,0,1.5', '56')
        expect(idler('send')).toEqual([56])
    })

    it('isDeliveryChainOpen kanonik kimlikle calisir: sayi ve ondalik dizge', () => {
        ayarla('56,8453', '56')
        expect(isDeliveryChainOpen('send', 8453)).toBe(true)
        expect(isDeliveryChainOpen('send', '8453')).toBe(true)
        for (const v of [undefined, null, '', '08453', 8453.5, 'Base', {}, [8453]]) {
            expect(isDeliveryChainOpen('send', v), JSON.stringify(v) ?? String(v)).toBe(false)
        }
    })

    it('satirlar tablonun kendi (dondurulmus) satirlaridir', () => {
        ayarla('56,8453', '56')
        const [bsc, base] = openDeliveryChains('send')
        expect(bsc).toBe(deliveryChainOf(56))
        expect(base).toBe(deliveryChainOf(8453))
    })

    // Vite yalniz `import.meta.env.VITE_ADI` yazimini derlemede sabitler; dinamik anahtar uretimde `undefined` olurdu.
    it('iki degisken adi kaynakta harfi harfine ve ortami cagri aninda okur', () => {
        const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./deliveryChainSetting.js', import.meta.url)), 'utf8'))
        expect(kod).toContain('import.meta.env.VITE_PRIVATE_SEND_CHAINS')
        expect(kod).toContain('import.meta.env.VITE_PRIVATE_FUND_CHAINS')
        expect(kod).not.toContain('VITE_PRIVATE_ATS_SALE')
        expect(kod).not.toMatch(/import\.meta\.env\[/)
        expect(kod).not.toMatch(/^const [A-Z_]+ = .*import\.meta\.env/m)
    })
})
