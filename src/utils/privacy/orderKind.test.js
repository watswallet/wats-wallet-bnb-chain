import { describe, it, expect } from 'vitest'
import { privateOrderKind } from './orderKind'

// Islem turu projeksiyonu (orderKind.js): saf islev, kasa + siparis kaydi girer; ag ve depo yok.
const PRIV = '0x' + 'ab'.repeat(20)
const OWN = '0x' + 'cd'.repeat(20)
const OWN2 = '0x' + 'ef'.repeat(20)
const FOREIGN = '0x' + '77'.repeat(20)
const PRIVATE_KEY = 'priv-1'

const vaults = (extra = {}) => [{
    id: 'v1',
    accounts: [
        { key: 'a-1', name: 'Wats 1', address: OWN },
        { key: 'a-2', name: '  Wats 2  ', address: OWN2 },
        { key: 'a-3', name: '', address: '0x' + '12'.repeat(20) },
    ],
    privateAccount: { key: PRIVATE_KEY, name: 'Gizli Hesap', address: PRIV, private: true },
    ...extra,
}]

const rec = (over = {}) => ({
    ticket: '0xt', sourceAccountKey: PRIVATE_KEY, sourceChainId: 56, outputAddress: FOREIGN, deliveryVersion: 2,
    summary: { sourceInput: { asset: 'USDC', chainId: 56 }, dest: { chainId: 56, asset: 'USDC', decimals: 6, expectedDestAmount: '1000000' } },
    ...over,
})

describe('privateOrderKind', () => {
    it('cikti Gizli Hesap degilse send; alici kendi hesabiysa adi (kirpilmis), yabanciysa ad yok', () => {
        expect(privateOrderKind(rec({ outputAddress: OWN }), vaults())).toEqual({ kind: 'send', sourceAsset: 'USDC', counterpartName: 'Wats 1', counterpartAddress: OWN })
        expect(privateOrderKind(rec({ outputAddress: OWN2 }), vaults()).counterpartName).toBe('Wats 2')
        expect(privateOrderKind(rec({ outputAddress: FOREIGN }), vaults())).toEqual({ kind: 'send', sourceAsset: 'USDC', counterpartName: null, counterpartAddress: FOREIGN })
    })

    it('adi bos olan kendi hesap: send yine send, ad null', () => {
        const bosAdli = '0x' + '12'.repeat(20)
        expect(privateOrderKind(rec({ outputAddress: bosAdli }), vaults())).toMatchObject({ kind: 'send', counterpartName: null, counterpartAddress: bosAdli })
    })

    it('adres karsilastirmasi harf boyutu ve 0x oneki duyarsiz', () => {
        const buyuk = '0x' + OWN.slice(2).toUpperCase()
        expect(privateOrderKind(rec({ outputAddress: buyuk }), vaults()).counterpartName).toBe('Wats 1')
        expect(privateOrderKind(rec({ outputAddress: OWN.slice(2) }), vaults()).counterpartName).toBe('Wats 1')
        // Gizli Hesap adresi hangi yazimla gelirse gelsin send DEGILDIR.
        for (const output of [PRIV.toUpperCase().replace('0X', '0x'), PRIV.slice(2), '0X' + PRIV.slice(2).toUpperCase()]) {
            expect(privateOrderKind(rec({ outputAddress: output, sourceAccountKey: 'a-1' }), vaults()).kind, output).toBe('fund')
        }
    })

    it('cikti Gizli Hesap, kaynak normal hesap: fund; karsi taraf kaynak hesap (ad yoksa yalniz adres)', () => {
        expect(privateOrderKind(rec({ outputAddress: PRIV, sourceAccountKey: 'a-1' }), vaults())).toEqual({ kind: 'fund', sourceAsset: 'USDC', counterpartName: 'Wats 1', counterpartAddress: OWN })
        expect(privateOrderKind(rec({ outputAddress: PRIV, sourceAccountKey: 'a-3' }), vaults())).toMatchObject({ kind: 'fund', counterpartName: null, counterpartAddress: '0x' + '12'.repeat(20) })
    })

    it('ikisi de Gizli Hesap: ayni zincir swap, farkli zincir bridge; karsi taraf yok', () => {
        const kendine = { outputAddress: PRIV, sourceAccountKey: PRIVATE_KEY }
        const dest = (chainId) => ({ chainId, asset: 'USDC', decimals: 6, expectedDestAmount: '1' })
        expect(privateOrderKind(rec({ ...kendine, sourceChainId: 56 }), vaults())).toEqual({ kind: 'swap', sourceAsset: 'USDC', counterpartName: null, counterpartAddress: null })
        expect(privateOrderKind(rec({ ...kendine, sourceChainId: 1, summary: { sourceInput: { asset: 'ETH' }, dest: dest(8453) } }), vaults())).toEqual({ kind: 'bridge', sourceAsset: 'ETH', counterpartName: null, counterpartAddress: null })
        expect(privateOrderKind(rec({ ...kendine, sourceChainId: '56' }), vaults()).kind).toBe('swap')
    })

    it('surumsuz (eski) kayit teslim agi 56 sayilir: 56 kaynakli kendine teslim swap, 56 disi kaynak bridge', () => {
        const eski = { outputAddress: PRIV, sourceAccountKey: PRIVATE_KEY, deliveryVersion: undefined, summary: { payoutUsdc: '5' } }
        expect(privateOrderKind(rec({ ...eski, sourceChainId: 56 }), vaults())).toMatchObject({ kind: 'swap', sourceAsset: null })
        expect(privateOrderKind(rec({ ...eski, sourceChainId: 8453 }), vaults()).kind).toBe('bridge')
    })

    it.each([
        ['cikti adresi yok', { outputAddress: undefined }],
        ['cikti adresi bos', { outputAddress: '' }],
        ['cikti adresi dizge degil', { outputAddress: 12345 }],
        ['cikti adresi kisa', { outputAddress: '0xabc' }],
        ['cikti adresi onaltilik degil', { outputAddress: '0x' + 'zz'.repeat(20) }],
        ['cikti adresinin etrafinda bosluk', { outputAddress: ' ' + OWN + ' ' }],
        ['kaynak hesap anahtari yok (cikti Gizli Hesap)', { outputAddress: PRIV, sourceAccountKey: undefined }],
        ['kaynak hesap kasada yok (cikti Gizli Hesap)', { outputAddress: PRIV, sourceAccountKey: 'yok' }],
        ['teslim agi tabloda yok (kendine teslim)', { outputAddress: PRIV, sourceAccountKey: PRIVATE_KEY, summary: { dest: { chainId: 99999, asset: 'USDC', decimals: 6 } } }],
        ['bilinmeyen kayit surumu (kendine teslim)', { outputAddress: PRIV, sourceAccountKey: PRIVATE_KEY, deliveryVersion: 3 }],
        ['kaynak zinciri okunamiyor (kendine teslim)', { outputAddress: PRIV, sourceAccountKey: PRIVATE_KEY, sourceChainId: 'abc' }],
        ['kaynak zinciri yok (kendine teslim)', { outputAddress: PRIV, sourceAccountKey: PRIVATE_KEY, sourceChainId: undefined }],
    ])('okunamayan veri null: %s', (_ad, over) => {
        const sonuc = privateOrderKind(rec(over), vaults())
        expect(sonuc.kind).toBeNull()
        expect(sonuc.counterpartName).toBeNull()
        expect(sonuc.counterpartAddress).toBeNull()
    })

    it('kasada kayitli Gizli Hesap yoksa (ya da kasa listesi bozuksa) hicbir tur uretilmez ve ad sizmaz', () => {
        const yok = vaults(); delete yok[0].privateAccount
        const adressiz = vaults({ privateAccount: { key: PRIVATE_KEY, name: 'Gizli Hesap' } })
        for (const kasa of [yok, adressiz, [], null, undefined, 'bozuk', [null, 5, {}], [{ accounts: 'dizi degil' }]]) {
            for (const output of [OWN, PRIV, FOREIGN]) {
                expect(privateOrderKind(rec({ outputAddress: output }), kasa), JSON.stringify(kasa)).toMatchObject({ kind: null, counterpartName: null, counterpartAddress: null })
            }
        }
    })

    it('siparis kaydi bozuksa cokmez: null, undefined, dizge, sayi, ic ice bozuk ozet', () => {
        for (const bozuk of [null, undefined, 'x', 7, [], { summary: 'x' }, { summary: { sourceInput: 5 } }]) {
            expect(privateOrderKind(bozuk, vaults()), JSON.stringify(bozuk)).toEqual({ kind: null, sourceAsset: null, counterpartName: null, counterpartAddress: null })
        }
        // Gecerli cikti adresi varsa ozet bozuk olsa da tur okunur (yalniz kaynak varlik bilinmez).
        expect(privateOrderKind({ outputAddress: OWN, summary: null }, vaults())).toEqual({ kind: 'send', sourceAsset: null, counterpartName: 'Wats 1', counterpartAddress: OWN })
    })

    it('kaynak varlik yalniz ozetteki sourceInput.asset; bozuk, bos ya da cok uzun deger null', () => {
        const asset = (a) => privateOrderKind(rec({ summary: { sourceInput: { asset: a } } }), vaults()).sourceAsset
        expect(asset('USDT')).toBe('USDT')
        expect(asset('USDC.e')).toBe('USDC.e')
        for (const kotu of ['', '  ', '<b>x</b>', 'A'.repeat(21), 5, null, undefined, {}, 'two words']) expect(asset(kotu), String(kotu)).toBeNull()
    })

    it('girdiyi degistirmez (kasa ve kayit derin esit kalir)', () => {
        const kasa = vaults()
        const kayit = rec({ outputAddress: OWN })
        const kasaOnce = structuredClone(kasa)
        const kayitOnce = structuredClone(kayit)
        privateOrderKind(kayit, kasa)
        expect(kasa).toEqual(kasaOnce)
        expect(kayit).toEqual(kayitOnce)
    })
})
