// privateDefaultTokens.js -- Gizli Hesap'in YEREL token tohumu ve yerel coin satiri (gizli-mod cok-ag spec 4.7, P12, E16).
// Ag YOK: sunucu tohumu (utils/defaultTokenSeed.js) Gizli Hesap icin artik kullanilmaz.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'ethers'
import { getAssetOnChain } from '@silentswap/sdk'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { isNativeAsset } from '../nativeAsset'
import { ATS_CHAINS } from '../atsConfig'
import {
    PRIVATE_SEED_CHAIN_ID, PRIVATE_SEED_STATUS, privateNativeRow, privateSeedRows, ensurePrivateDefaultTokens,
} from './privateDefaultTokens'

const KEY = 'private-0xcccccccc00000000000000000000000000000003'

// chrome.storage.local seklinde sahte depo; get/set CAGRI SAYILIR ("hicbir sey yazilmadi" iddialari icin).
function depo(baslangic = {}) {
    const data = structuredClone(baslangic)
    return {
        data,
        get: vi.fn(async (anahtar) => structuredClone(Object.fromEntries([].concat(anahtar).filter((k) => k in data).map((k) => [k, data[k]])))),
        set: vi.fn(async (obj) => { Object.assign(data, structuredClone(obj)) }),
    }
}

const yerelYol = (yol) => typeof yol === 'string' && yol.startsWith('/') && !yol.startsWith('//')

describe('privateNativeRow -- ag basina YEREL coin satiri', () => {
    it.each([
        [1, 'ETH'], [56, 'BNB'], [8453, 'ETH'], [42161, 'ETH'], [10, 'ETH'],
        [137, 'POL'], [100, 'XDAI'], [42220, 'CELO'], [5000, 'MNT'], [25, 'CRO'],
    ])('%s: sembol %s, coingecko_id null, COININ yerel logosu (L2 zincir logosu degil), adres 0x0 (native)', (chainId, sembol) => {
        const satir = privateNativeRow(chainId)
        expect(satir.symbol).toBe(sembol)
        expect(satir.chainId).toBe(chainId)
        expect(satir.coingecko_id).toBeNull()
        expect(satir.decimals).toBe(18)
        expect(isNativeAsset(satir.address)).toBe(true)
        expect(satir.native).toBe(true)
        // ETH hangi ETH agi olursa olsun ETH elmasi (/chains/1.png); xDAI Gnosis baykusu (GNO) degil kendi dosyasi; tek coinli aglarda aginki.
        const beklenen = sembol === 'ETH' ? '/chains/1.png' : chainId === 100 ? '/tokens/100/0x0000000000000000000000000000000000000000.png' : `/chains/${chainId}.png`
        for (const alan of ['thumb', 'small', 'large']) expect(satir.image[alan]).toBe(beklenen)
    })

    it('cozulemeyen ag (Solana, bilinmeyen kimlik, bos) icin null doner, firlatmaz', () => {
        expect(privateNativeRow('solana-mainnet')).toBeNull()
        expect(privateNativeRow(999999)).toBeNull()
        expect(privateNativeRow(null)).toBeNull()
        expect(privateNativeRow(undefined)).toBeNull()
    })

    it('her cagri TAZE nesne doner (bir cagrinin degisikligi digerine sizmaz)', () => {
        const a = privateNativeRow(56)
        a.symbol = 'DEGISTI'
        expect(privateNativeRow(56).symbol).toBe('BNB')
    })
})

describe('privateSeedRows -- {BNB, USDC, ATS}, hepsi yerel logolu, fiyat kimligi yok', () => {
    it('uc satir, sirayla BNB (yerel coin), USDC, ATS', () => {
        const satirlar = privateSeedRows()
        expect(satirlar.map((s) => s.symbol)).toEqual(['BNB', 'USDC', 'ATS'])
        expect(isNativeAsset(satirlar[0].address)).toBe(true)
    })

    it('her satir coingecko_id null ve ayni kaynaktan logo tasir (uzak URL yok)', () => {
        for (const satir of privateSeedRows()) {
            expect(satir.coingecko_id, satir.symbol).toBeNull()
            for (const alan of ['thumb', 'small', 'large']) expect(yerelYol(satir.image[alan]), `${satir.symbol}.${alan}`).toBe(true)
        }
        expect(privateSeedRows().map((s) => s.image.large)).toEqual(['/chains/56.png', '/usdc.png', '/ats.png'])
    })

    it('USDC adresi ve ondaligi SDK kayit defteriyle BIREBIR AYNI (BSC)', () => {
        const usdc = privateSeedRows()[1]
        const sdk = getAssetOnChain('USDC', PRIVATE_SEED_CHAIN_ID)
        expect(usdc.address).toBe(getAddress(sdk.address))
        expect(usdc.decimals).toBe(Number(sdk.decimals))
    })

    it('ATS satiri ATS_CHAINS[56].token ile AYNI (kopya sabit yok)', () => {
        const ats = privateSeedRows()[2]
        expect(ats.address).toBe(ATS_CHAINS[56].token.address)
        expect(ats.decimals).toBe(ATS_CHAINS[56].token.decimals)
    })

    it('Ethereum tohumu YOK: satirlarin hicbiri baska zincirin tokeni degil', () => {
        const zincirler = new Set(privateSeedRows().map((s) => s.chain ?? 'binance-smart-chain'))
        expect([...zincirler]).toEqual(['binance-smart-chain'])
    })
})

describe('ensurePrivateDefaultTokens -- yerel, idempotent, dar yazim', () => {
    it("depoda imported_tokens HIC yoksa: yalniz bu hesabin kovasina { '56': [BNB, USDC, ATS] } yazilir (seeded)", async () => {
        const s = depo({})
        expect(await ensurePrivateDefaultTokens(KEY, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.SEEDED })
        expect(Object.keys(s.data.imported_tokens)).toEqual([KEY])
        expect(Object.keys(s.data.imported_tokens[KEY])).toEqual(['56'])
        expect(s.data.imported_tokens[KEY]['56'].map((r) => r.symbol)).toEqual(['BNB', 'USDC', 'ATS'])
        expect(s.set).toHaveBeenCalledTimes(1)
    })

    it('ikinci cagri healthy doner ve HIC yazmaz', async () => {
        const s = depo({})
        await ensurePrivateDefaultTokens(KEY, { storage: s })
        s.set.mockClear()
        expect(await ensurePrivateDefaultTokens(KEY, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.HEALTHY })
        expect(s.set).not.toHaveBeenCalled()
    })

    it("'56' bos dizi ise (kullanici hepsini silmis) healthy: kullanicinin kasitli secimi geri alinmaz", async () => {
        const s = depo({ imported_tokens: { [KEY]: { 56: [] } } })
        expect(await ensurePrivateDefaultTokens(KEY, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.HEALTHY })
        expect(s.set).not.toHaveBeenCalled()
        expect(s.data.imported_tokens[KEY]).toEqual({ 56: [] })
    })

    it("eski sunucu tohumu ({1:[ETH,USDT], 56:[ATS,BNB]}) olan profil healthy sayilir: goc YOK, kova oldugu gibi kalir", async () => {
        const eski = { 1: [{ symbol: 'eth' }, { symbol: 'usdt' }], 56: [{ symbol: 'ats' }, { symbol: 'bnb' }] }
        const s = depo({ imported_tokens: { [KEY]: eski } })
        expect(await ensurePrivateDefaultTokens(KEY, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.HEALTHY })
        expect(s.data.imported_tokens[KEY]).toEqual(eski)
    })

    it("kovada '56' yoksa ama baska zincir anahtari varsa: '56' EKLENIR, mevcut anahtar korunur, baska hesap DOKUNULMAZ", async () => {
        const baskaHesap = { 1: [{ symbol: 'usdt' }], '-239': [{ symbol: 'GRAM' }] }
        const kendi = { 8453: [{ symbol: 'DEGEN' }] }
        const s = depo({ imported_tokens: { acc1: baskaHesap, [KEY]: kendi } })

        expect(await ensurePrivateDefaultTokens(KEY, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.SEEDED })

        expect(s.data.imported_tokens.acc1).toEqual(baskaHesap)
        expect(s.data.imported_tokens[KEY][8453]).toEqual(kendi[8453])
        expect(s.data.imported_tokens[KEY][56].map((r) => r.symbol)).toEqual(['BNB', 'USDC', 'ATS'])
    })

    it('bozuk imported_tokens (dizi / null) ya da bozuk kova (dizi) nesneyle degistirilir, firlatmaz', async () => {
        for (const bozuk of [[], null, 'x', { [KEY]: [] }, { [KEY]: 'x' }]) {
            const s = depo({ imported_tokens: bozuk })
            expect(await ensurePrivateDefaultTokens(KEY, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.SEEDED })
            expect(Object.keys(s.data.imported_tokens[KEY])).toEqual(['56'])
        }
    })

    it('okuma ya da yazma hatasi: failed doner, FIRLATMAZ', async () => {
        const okumaHatasi = { get: vi.fn(async () => { throw new Error('depo yok') }), set: vi.fn() }
        expect(await ensurePrivateDefaultTokens(KEY, { storage: okumaHatasi })).toEqual({ status: PRIVATE_SEED_STATUS.FAILED })
        expect(okumaHatasi.set).not.toHaveBeenCalled()

        const yazmaHatasi = { get: vi.fn(async () => ({})), set: vi.fn(async () => { throw new Error('kota') }) }
        expect(await ensurePrivateDefaultTokens(KEY, { storage: yazmaHatasi })).toEqual({ status: PRIVATE_SEED_STATUS.FAILED })
    })

    it('gecersiz hesap anahtari (bos, undefined, dizge degil) ve depo yoksa: failed, depoya HIC dokunulmaz', async () => {
        const s = depo({})
        for (const anahtar of ['', undefined, null, 5, {}]) {
            expect(await ensurePrivateDefaultTokens(anahtar, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.FAILED })
        }
        expect(await ensurePrivateDefaultTokens(KEY, { storage: null })).toEqual({ status: PRIVATE_SEED_STATUS.FAILED })
        expect(s.get).not.toHaveBeenCalled()
        expect(s.set).not.toHaveBeenCalled()
    })

    it('ayni hesap icin eszamanli cagrilar TEK ise iner (App acilisi + Home yuklemesi)', async () => {
        const s = depo({})
        const [a, b, c] = await Promise.all([
            ensurePrivateDefaultTokens(KEY, { storage: s }),
            ensurePrivateDefaultTokens(KEY, { storage: s }),
            ensurePrivateDefaultTokens(KEY, { storage: s }),
        ])
        expect([a.status, b.status, c.status]).toEqual(['seeded', 'seeded', 'seeded'])
        expect(s.set).toHaveBeenCalledTimes(1)
    })

    it('is bitince kayit silinir: sonraki cagri tekrar depoyu OKUR (bayat sonuc donmez)', async () => {
        const s = depo({})
        await ensurePrivateDefaultTokens(KEY, { storage: s })
        delete s.data.imported_tokens[KEY]
        expect(await ensurePrivateDefaultTokens(KEY, { storage: s })).toEqual({ status: PRIVATE_SEED_STATUS.SEEDED })
    })
})

describe('privateDefaultTokens -- ag ve SDK yok', () => {
    const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./privateDefaultTokens.js', import.meta.url)), 'utf8'))

    it('axios, fetch, sendMessage ya da sunucu tohumu import etmez', () => {
        expect(kaynak).not.toMatch(/\baxios\b|\bfetch\s*\(|sendMessage|XMLHttpRequest|defaultTokenSeed|getImportedTokens/)
    })

    it('SDK, silentswap.js ya da privateOrderExec.js import etmez (popup paketi)', () => {
        expect(kaynak).not.toMatch(/@silentswap|silentswap\.js|privateOrderExec/)
    })
})
