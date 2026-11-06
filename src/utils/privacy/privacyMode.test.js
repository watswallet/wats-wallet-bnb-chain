import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../../data/supported_chains.json'
import { fakeStorage } from '../../test-utils/fakeStorage'

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true }
const ensureMock = vi.fn(async () => GIZLI)
vi.mock('./privateAccount', async (importOriginal) => ({
    ...(await importOriginal()),
    ensurePrivateAccount: (...args) => ensureMock(...args),
}))

const { setPrivacyMode, readPrivacyMode, networkFor, restoreNetworkFor, restoreNetworkWrites, PRIVACY_MODE_KEY } = await import('./privacyMode')

const BSC = supported_chains.find((c) => c.chainId === 56)
const ETH = supported_chains.find((c) => c.chainId === 1)
const BASE = supported_chains.find((c) => c.chainId === 8453)
const POLYGON = supported_chains.find((c) => c.chainId === 137)
const TON = supported_chains.find((c) => c.chainId === -239)
const SOLANA = supported_chains.find((c) => c.vm === 'solana')
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const B = { key: 'b-1', address: '0x' + 'bb'.repeat(20), type: 'hd' }
const T = { key: 't-1', address: '0x' + 'ee'.repeat(20), type: 'ton' }
// Yalniz-EVM genel hesap (tek ozel anahtar): TON/Solana aglarini desteklemez.
const IMPORTED = { key: 'i-1', address: '0x' + 'dd'.repeat(20), type: 'imported' }

const deps = (storage, over = {}) => ({
    storage,
    getMasterKey: vi.fn(async () => ({})),
    announce: vi.fn(async () => {}),
    allChains: supported_chains,
    privateAccountName: 'Gizli Hesap',
    ...over,
})

beforeEach(() => ensureMock.mockClear())

describe('setPrivacyMode', () => {
    it('giris: aktif hesap Gizli Hesap olur, son normal hesap hatirlanir, duyuru yapilir', async () => {
        const storage = fakeStorage({ active_account: A, currentNetwork: ETH, vaults: [{ accounts: [A, B] }] })
        const d = deps(storage)
        const r = await setPrivacyMode(true, d)
        expect(r).toEqual({ enabled: true, account: GIZLI })
        expect(storage.data.active_account).toEqual(GIZLI)
        expect(storage.data[PRIVACY_MODE_KEY]).toEqual({ lastPublicAccountKey: 'a-1', introSeen: true })
        expect(storage.data.currentNetwork).toEqual(ETH)
        expect(d.announce).toHaveBeenCalledWith(GIZLI)
    })

    it.each([['dize "false"', 'false'], ['dize "true"', 'true'], ['sayi 1', 1], ['sayi 0', 0], ['undefined', undefined], ['null', null]])(
        'boolean olmayan enabled (%s) firlatir ve hicbir sey yazilmaz ya da duyurulmaz',
        async (_ad, deger) => {
            const storage = fakeStorage({ active_account: A, currentNetwork: ETH, vaults: [{ accounts: [A] }] })
            const d = deps(storage)
            await expect(setPrivacyMode(deger, d)).rejects.toThrow('INVALID_ENABLED')
            expect(storage.set).not.toHaveBeenCalled()
            expect(d.announce).not.toHaveBeenCalled()
            expect(ensureMock).not.toHaveBeenCalled()
        },
    )

    describe('giris: aktif hesap zaten Gizli Hesap', () => {
        const kasalar = () => [{ accounts: [A], privateAccount: GIZLI }]

        it('kayitla ayni ve ag uyuyorsa yazma da duyuru da yapilmaz (cikistaki no-op ile simetrik)', async () => {
            const storage = fakeStorage({
                active_account: { ...GIZLI }, currentNetwork: BSC, vaults: kasalar(),
                [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'a-1', introSeen: true },
            })
            const d = deps(storage)
            const r = await setPrivacyMode(true, d)
            expect(r).toEqual({ enabled: true, account: GIZLI })
            expect(storage.set).not.toHaveBeenCalled()
            expect(d.announce).not.toHaveBeenCalled()
            expect(d.getMasterKey).not.toHaveBeenCalled()
        })

        it("ag Gizli Hesap'a uymuyorsa yine de aga gecilir ve duyurulur", async () => {
            const storage = fakeStorage({
                active_account: { ...GIZLI }, currentNetwork: TON, vaults: kasalar(),
                [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'a-1', introSeen: true },
            })
            const d = deps(storage)
            await setPrivacyMode(true, d)
            expect(storage.data.currentNetwork.chainId).toBe(56)
            expect(d.announce).toHaveBeenCalledWith(GIZLI)
            // zaten gizliyken son normal hesap anahtari Gizli Hesap'la EZILMEZ
            expect(storage.data[PRIVACY_MODE_KEY].lastPublicAccountKey).toBe('a-1')
        })

        it('aktif kayit depodaki kayitten farkliysa kayit yeniden yazilir', async () => {
            const storage = fakeStorage({
                active_account: { ...GIZLI, name: 'Eski ad' }, currentNetwork: BSC, vaults: kasalar(),
                [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'a-1', introSeen: true },
            })
            const d = deps(storage)
            await setPrivacyMode(true, d)
            expect(storage.data.active_account).toEqual(GIZLI)
            expect(d.announce).toHaveBeenCalledWith(GIZLI)
        })
    })

    // Kilitli cuzdanda yari gecis olmamali.
    it('kilitliyse WALLET_LOCKED ve depoya HICBIR SEY yazilmaz', async () => {
        const storage = fakeStorage({ active_account: A, currentNetwork: ETH, vaults: [{ accounts: [A] }] })
        const d = deps(storage, { getMasterKey: vi.fn(async () => { throw new Error('WALLET_LOCKED') }) })
        await expect(setPrivacyMode(true, d)).rejects.toThrow('WALLET_LOCKED')
        expect(storage.set).not.toHaveBeenCalled()
        expect(d.announce).not.toHaveBeenCalled()
    })

    // TON agindayken giris -> BSC.
    it('giris: ag Gizli Hesap\'a uymuyorsa BSC\'ye gecilir', async () => {
        const storage = fakeStorage({ active_account: T, currentNetwork: TON, vaults: [{ accounts: [A, T] }] })
        await setPrivacyMode(true, deps(storage))
        expect(storage.data.currentNetwork.chainId).toBe(56)
        expect(storage.data.last_evm_chain_id).toBe(56)
    })

    it('zaten gizlideyken tekrar giris son normal hesabi EZMEZ', async () => {
        const storage = fakeStorage({
            active_account: GIZLI, currentNetwork: BSC, vaults: [{ accounts: [A] }],
            [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'a-1', introSeen: true },
        })
        await setPrivacyMode(true, deps(storage))
        expect(storage.data[PRIVACY_MODE_KEY].lastPublicAccountKey).toBe('a-1')
        expect(ensureMock).toHaveBeenCalledWith(expect.objectContaining({ preferredAccount: null }))
    })

    it('cikis: son normal hesaba donulur ve duyurulur', async () => {
        const storage = fakeStorage({
            active_account: GIZLI, currentNetwork: BSC, vaults: [{ accounts: [A, B] }],
            [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'b-1', introSeen: true },
        })
        const d = deps(storage)
        const r = await setPrivacyMode(false, d)
        expect(r).toEqual({ enabled: false, account: B })
        expect(storage.data.active_account).toEqual(B)
        expect(storage.data[PRIVACY_MODE_KEY].introSeen).toBe(true)
        expect(d.announce).toHaveBeenCalledWith(B)
        expect(d.getMasterKey).not.toHaveBeenCalled()
    })

    // Hatirlanan hesap silinmis.
    it('cikis: hatirlanan hesap yoksa ilk normal hesaba donulur', async () => {
        const storage = fakeStorage({
            active_account: GIZLI, currentNetwork: BSC, vaults: [{ accounts: [A, B] }],
            [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'silindi', introSeen: true },
        })
        const r = await setPrivacyMode(false, deps(storage))
        expect(r.account).toEqual(A)
    })

    // TON-only hesaba donus -> TON agi.
    it('cikis: hedef hesap mevcut agi desteklemiyorsa uygun aga gecilir', async () => {
        const storage = fakeStorage({
            active_account: GIZLI, currentNetwork: BSC, vaults: [{ accounts: [T] }],
            [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 't-1', introSeen: true },
        })
        await setPrivacyMode(false, deps(storage))
        expect(storage.data.currentNetwork.chainId).toBe(-239)
    })

    // Aktif hesap zaten gizli degilken cikis istegi sessiz no-op'tur.
    it('cikis: aktif hesap zaten normalse depoya yazilmaz ve duyuru yapilmaz', async () => {
        const storage = fakeStorage({
            active_account: A, currentNetwork: ETH, vaults: [{ accounts: [A, B] }],
            [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'b-1', introSeen: true },
        })
        const d = deps(storage)
        const r = await setPrivacyMode(false, d)
        expect(r).toEqual({ enabled: false, account: A })
        expect(storage.set).not.toHaveBeenCalled()
        expect(d.announce).not.toHaveBeenCalled()
        expect(d.getMasterKey).not.toHaveBeenCalled()
    })

    it('normal hesap hic yoksa NO_PUBLIC_ACCOUNT', async () => {
        const storage = fakeStorage({ active_account: GIZLI, currentNetwork: BSC, vaults: [{ accounts: [] }] })
        await expect(setPrivacyMode(false, deps(storage))).rejects.toThrow('NO_PUBLIC_ACCOUNT')
    })
})

describe('readPrivacyMode / networkFor', () => {
    it('bos depoda varsayilan doner', async () => {
        expect(await readPrivacyMode(fakeStorage({}))).toEqual({ lastPublicAccountKey: null, introSeen: false })
    })

    it('uyumlu agda null, uyumsuzda tercih edilen ya da ilk aday', () => {
        expect(networkFor(GIZLI, BSC, supported_chains, 56)).toBe(null)
        expect(networkFor(GIZLI, TON, supported_chains, 56).chainId).toBe(56)
        expect(networkFor(T, BSC, supported_chains, 56).chainId).toBe(-239)
    })
})

// P5 (spec 4.9): cikista GIRIS ONCESI (donmus) ag geri yuklenir. Geri yazim hesap gecisiyle AYNI
// storage.set icindedir: siteler hesabin degistigi anda zaten donmus agi gorur.
describe('restoreNetworkFor', () => {
    it('donmus kayit bir nesne, listede ve hesap destekliyorsa kaydin KENDISI doner', () => {
        expect(restoreNetworkFor(A, BASE, supported_chains)).toBe(BASE)
        // HD hesap ucunu de destekler: TON agi geri yazilabilir.
        expect(restoreNetworkFor(A, TON, supported_chains)).toBe(TON)
    })

    it('hesap agi desteklemiyorsa null (EVM-only hesaba TON, yalniz-TON hesaba EVM, Gizli Hesap\'a TON)', () => {
        expect(restoreNetworkFor(IMPORTED, TON, supported_chains)).toBe(null)
        expect(restoreNetworkFor(T, ETH, supported_chains)).toBe(null)
        expect(restoreNetworkFor(GIZLI, TON, supported_chains)).toBe(null)
    })

    // PF-B4: accountSupportsChain hesap bilinmiyorsa FAIL-OPEN'dir; cikis hesabi yoksa ag yazilmaz.
    it('cikis hesabi yoksa (null / undefined) null: fail closed, geri yazim yok', () => {
        expect(restoreNetworkFor(null, BASE, supported_chains)).toBe(null)
        expect(restoreNetworkFor(undefined, BASE, supported_chains)).toBe(null)
    })

    it.each([
        ['undefined (kayit yok)', undefined],
        ['null (girisin ag kaydi yoktu)', null],
        ['dize', 'ethereum'],
        ['sayi', 1],
        ['dizi', [ETH]],
        ['chainId\'siz nesne', { name: 'Ethereum' }],
    ])('donmus deger kullanilamaz (%s): null', (_ad, donmus) => {
        expect(restoreNetworkFor(A, donmus, supported_chains)).toBe(null)
    })

    it('chainId allChains listesinde yoksa null (kaldirilmis ag geri yazilmaz)', () => {
        expect(restoreNetworkFor(A, { chainId: 99999, name: 'Kaldirilmis ag' }, supported_chains)).toBe(null)
        expect(restoreNetworkFor(A, ETH, [BSC])).toBe(null)
        expect(restoreNetworkFor(A, ETH, undefined)).toBe(null)
    })

    it('chainId sayi ya da dize olabilir (isSameChainId)', () => {
        const dizeli = { ...BASE, chainId: '8453' }
        expect(restoreNetworkFor(A, dizeli, supported_chains)).toBe(dizeli)
    })

    // Solana'nin chainId'si METINDIR ('solana-mainnet'): Number() NaN verir, karsilastirma metinle yapilmali.
    it('Solana kaydi (metin chainId): HD hesaba geri yazilir, EVM-only ve Gizli Hesap\'a yazilmaz', () => {
        expect(typeof SOLANA.chainId).toBe('string')
        expect(restoreNetworkFor(A, SOLANA, supported_chains)).toBe(SOLANA)
        expect(restoreNetworkFor(IMPORTED, SOLANA, supported_chains)).toBe(null)
        expect(restoreNetworkFor(GIZLI, SOLANA, supported_chains)).toBe(null)
    })
})

describe('restoreNetworkWrites', () => {
    it('canli ag farkliysa currentNetwork ve EVM ise last_evm_chain_id', () => {
        expect(restoreNetworkWrites(BASE, POLYGON)).toEqual({ currentNetwork: BASE, last_evm_chain_id: 8453 })
    })

    it('canli ag yoksa da yazilir', () => {
        expect(restoreNetworkWrites(ETH, undefined)).toEqual({ currentNetwork: ETH, last_evm_chain_id: 1 })
    })

    it('EVM disi agda last_evm_chain_id YAZILMAZ (TON ve Solana "son EVM zinciri" olamaz)', () => {
        expect(restoreNetworkWrites(TON, BSC)).toEqual({ currentNetwork: TON })
        expect(restoreNetworkWrites(SOLANA, BSC)).toEqual({ currentNetwork: SOLANA })
    })

    it('canli ag zaten ayni zincirse bos nesne (sayi / dize farki onemsiz)', () => {
        expect(restoreNetworkWrites(ETH, ETH)).toEqual({})
        expect(restoreNetworkWrites(ETH, { ...ETH, chainId: '1' })).toEqual({})
    })
})

describe('setPrivacyMode cikis: giris oncesi ag geri yuklenir (P5)', () => {
    const cikisDeposu = (extra = {}) => fakeStorage({
        active_account: GIZLI, currentNetwork: POLYGON, last_evm_chain_id: 137,
        vaults: [{ accounts: [A, B] }],
        [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'a-1', introSeen: true },
        ...extra,
    })
    const yazilanAnahtarlar = (storage) => Object.keys(storage.set.mock.calls[0][0]).sort()

    it('Base\'de girilir, Polygon\'a gecilir, cikista ag Base olur ve last_evm_chain_id Base\'tir', async () => {
        const storage = fakeStorage({ active_account: A, currentNetwork: BASE, last_evm_chain_id: 8453, vaults: [{ accounts: [A, B] }] })
        await setPrivacyMode(true, deps(storage))
        expect(storage.data.currentNetwork).toEqual(BASE)
        // Gizli oturumda ag secimi: arayuz currentNetwork ve last_evm_chain_id'yi yazar.
        storage.data.currentNetwork = POLYGON
        storage.data.last_evm_chain_id = 137

        const r = await setPrivacyMode(false, deps(storage, { restoreNetwork: BASE }))
        expect(r).toEqual({ enabled: false, account: A })
        expect(storage.data.active_account).toEqual(A)
        expect(storage.data.currentNetwork).toEqual(BASE)
        expect(storage.data.last_evm_chain_id).toBe(8453)
    })

    it('active_account ve currentNetwork TEK storage.set icindedir (ayri bir ag yazimi yok)', async () => {
        const storage = cikisDeposu()
        await setPrivacyMode(false, deps(storage, { restoreNetwork: ETH }))
        expect(storage.set).toHaveBeenCalledTimes(1)
        const yazim = storage.set.mock.calls[0][0]
        expect(yazilanAnahtarlar(storage)).toEqual(['active_account', 'currentNetwork', 'last_evm_chain_id', PRIVACY_MODE_KEY].sort())
        expect(yazim.active_account).toEqual(A)
        expect(yazim.currentNetwork).toEqual(ETH)
        expect(yazim.last_evm_chain_id).toBe(1)
    })

    it('KONTROL: canli ag zaten donmus agsa ag alanlari yazilmaz (gereksiz onChanged yok)', async () => {
        const storage = cikisDeposu({ currentNetwork: ETH, last_evm_chain_id: 1 })
        await setPrivacyMode(false, deps(storage, { restoreNetwork: ETH }))
        expect(yazilanAnahtarlar(storage)).toEqual(['active_account', PRIVACY_MODE_KEY].sort())
    })

    it('donmus ag EVM disiysa (TON) currentNetwork geri yazilir, last_evm_chain_id yazilmaz', async () => {
        const storage = cikisDeposu({ currentNetwork: BSC, last_evm_chain_id: 56 })
        await setPrivacyMode(false, deps(storage, { restoreNetwork: TON }))
        expect(storage.data.currentNetwork).toEqual(TON)
        expect(yazilanAnahtarlar(storage)).toEqual(['active_account', 'currentNetwork', PRIVACY_MODE_KEY].sort())
        expect(storage.data.last_evm_chain_id).toBe(56)
    })

    it('KONTROL: cikis hesabi donmus agi desteklemiyorsa (EVM-only hesap, TON agi) geri yazim yok, uygun canli aga dokunulmaz', async () => {
        const storage = cikisDeposu({
            currentNetwork: BSC, vaults: [{ accounts: [IMPORTED] }],
            [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 'i-1', introSeen: true },
        })
        await setPrivacyMode(false, deps(storage, { restoreNetwork: TON }))
        expect(storage.data.active_account).toEqual(IMPORTED)
        expect(storage.data.currentNetwork).toEqual(BSC)
        expect(yazilanAnahtarlar(storage)).toEqual(['active_account', PRIVACY_MODE_KEY].sort())
    })

    it('KONTROL: cikis hesabi yalniz-TON ise donmus EVM agi geri yazilmaz; mevcut networkFor TON agini secer', async () => {
        const storage = cikisDeposu({
            currentNetwork: BSC, vaults: [{ accounts: [T] }],
            [PRIVACY_MODE_KEY]: { lastPublicAccountKey: 't-1', introSeen: true },
        })
        await setPrivacyMode(false, deps(storage, { restoreNetwork: ETH }))
        expect(storage.data.currentNetwork.chainId).toBe(-239)
        expect(storage.data.last_evm_chain_id).toBe(137)
    })

    it.each([
        ['kayit yok (undefined)', undefined],
        ['girisin ag kaydi yoktu (null)', null],
        ['bozuk deger (dize)', 'ethereum'],
        ['listede olmayan zincir', { chainId: 99999, name: 'Kaldirilmis ag' }],
    ])('KONTROL: donmus kayit kullanilamaz (%s): geri yazim yok, canli ag oldugu gibi kalir', async (_ad, donmus) => {
        const storage = cikisDeposu()
        await setPrivacyMode(false, deps(storage, { restoreNetwork: donmus }))
        expect(storage.data.currentNetwork).toEqual(POLYGON)
        expect(yazilanAnahtarlar(storage)).toEqual(['active_account', PRIVACY_MODE_KEY].sort())
    })

    it('KONTROL: giriste restoreNetwork yok sayilir (giris davranisi degismez)', async () => {
        const storage = fakeStorage({ active_account: A, currentNetwork: POLYGON, vaults: [{ accounts: [A] }] })
        await setPrivacyMode(true, deps(storage, { restoreNetwork: ETH }))
        expect(storage.data.active_account).toEqual(GIZLI)
        expect(storage.data.currentNetwork).toEqual(POLYGON)
    })
})
