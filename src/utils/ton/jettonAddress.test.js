import { describe, it, expect, vi } from 'vitest'
import { jettonWalletCacheKey, getJettonWalletAddress } from './jettonAddress'

// Jetton cuzdan adresi DETERMINISTIKTIR ve ASLA DEGISMEZ (sahip + master'dan turer).
// Bu yuzden kalici onbellege alinir ve hic gecersizlestirilmez. Kazanc kucuk degil:
// onbellek olmadan her bakiye yenilemesi jetton basina IKI proxy cagrisi eder.
//
// chainId ANAHTARA DAHIL: mainnet (-239) ve testnet (-3) FARKLI sozlesmelerdir. Bu
// ayrim olmadan testnet'te yapilan TEK bir okuma, kullanicinin mainnet bakiyesini
// KALICI olarak yanlis adresten okuturdu.

const OWNER = 'UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r'
const MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const DERIVED = 'EQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'

// Ikinci, farkli bir jetton master ve onun turetilmis cuzdan adresi - es zamanlilik
// testinde kullanilir (asagida). Adres formatinin gecerli olmasi onemli degil, mock
// zaten parse etmiyor; sadece MASTER'dan AYIRT EDILEBILIR olmasi yeterli.
const MASTER_2 = 'EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t'
const DERIVED_2 = 'EQBIhPuWmjT7fP-VomuXou_f6WkAImQvOsWk9YLnZFOwrjJd'

const makeStorage = () => {
    const data = {}
    return {
        get: vi.fn(async (k) => (k in data ? { [k]: data[k] } : {})),
        set: vi.fn(async (obj) => { Object.assign(data, obj) }),
    }
}

const makeClient = (address = DERIVED) => ({
    open: vi.fn(() => ({ getWalletAddress: vi.fn(async () => ({ toString: () => address })) })),
})

// Zincire cikan cagrinin GERCEK bir gecikmesi var (RPC), yani iki es zamanli
// cagrinin donus anlari birbirinden AYRISIR. Bunu taklit etmeden iki mock hep
// ayni mikro-gorev turunde cozulur ve "yazmadan once taze oku" korumasi bile
// ayirt edilemez hale gelir (ikisi de digeri henuz yazmamisken taze okumus
// olur). delayMs farki, gercek ag jitter'inin garanti ettigi seyi taklit eder.
const makeDelayedClient = (address, delayMs) => ({
    open: vi.fn(() => ({
        getWalletAddress: vi.fn(() => new Promise((resolve) => {
            setTimeout(() => resolve({ toString: () => address }), delayMs)
        })),
    })),
})

describe('jettonWalletCacheKey', () => {
    it('chainId iceriyor - mainnet ve testnet AYNI anahtari uretmez', () => {
        expect(jettonWalletCacheKey({ chainId: -239, owner: OWNER, master: MASTER }))
            .not.toBe(jettonWalletCacheKey({ chainId: -3, owner: OWNER, master: MASTER }))
    })

    it('farkli master farkli anahtar uretir', () => {
        expect(jettonWalletCacheKey({ chainId: -239, owner: OWNER, master: MASTER }))
            .not.toBe(jettonWalletCacheKey({ chainId: -239, owner: OWNER, master: OWNER }))
    })
})

describe('getJettonWalletAddress', () => {
    it('ilk cagride zincirden okur ve onbellege yazar', async () => {
        const storage = makeStorage()
        const addr = await getJettonWalletAddress({ client: makeClient(), owner: OWNER, master: MASTER, chainId: -239, storage })
        expect(addr).toBe(DERIVED)
        expect(storage.set).toHaveBeenCalled()
    })

    it('ikinci cagride zincire HIC gitmez', async () => {
        const storage = makeStorage()
        const client = makeClient()
        await getJettonWalletAddress({ client, owner: OWNER, master: MASTER, chainId: -239, storage })
        client.open.mockClear()
        const addr = await getJettonWalletAddress({ client, owner: OWNER, master: MASTER, chainId: -239, storage })
        expect(addr).toBe(DERIVED)
        expect(client.open).not.toHaveBeenCalled()
    })

    it('farkli agda onbellek PAYLASILMAZ', async () => {
        const storage = makeStorage()
        const client = makeClient()
        await getJettonWalletAddress({ client, owner: OWNER, master: MASTER, chainId: -239, storage })
        client.open.mockClear()
        await getJettonWalletAddress({ client, owner: OWNER, master: MASTER, chainId: -3, storage })
        expect(client.open).toHaveBeenCalled()
    })

    it('zincir hatasi YUTULMAZ', async () => {
        const client = { open: () => ({ getWalletAddress: async () => { throw new Error('proxy down') } }) }
        await expect(getJettonWalletAddress({ client, owner: OWNER, master: MASTER, chainId: -239, storage: makeStorage() }))
            .rejects.toThrow()
    })

    // KAYIP GUNCELLEME: bu modulun asil cagirani bakiyeleri Promise.allSettled ile
    // PARALEL okuyacak, yani AYNI owner/chainId icin farkli master'lar es zamanli
    // buraya girebilir. Sirali await KULLANMIYORUZ - Promise.all iki cagriyi da
    // beklemeden baslatir, tipki gercek cagiranin yapacagi gibi.
    //
    // Gecikmeler KASITLI FARKLI (0 / 15ms): A'nin zincir cagrisi hemen doner, B'ninki
    // gercek bir RPC gibi geriden gelir. Boylece A'nin taze-okuma+yazma dongusu B'nin
    // zincir cagrisi donmeden TAMAMLANIR; B yazmaya hazirlanirken taze okudugunda
    // A'nin kaydini GORMELIDIR. Iki cagri da tamamen ayni mikro-gorevde cozulseydi
    // (ikisi de sifir gecikme) "taze okuma" korumasi bile hicbir seyi ayirt edemezdi -
    // ikisi de digeri henuz yazmamisken taze okurdu. Bu yuzden gecikme farki testin
    // KENDISININ bir parcasi, kozmetik degil.
    it('es zamanli iki farkli master onbellekte HER IKI kaydi da tutar - kayip guncelleme YOK', async () => {
        const storage = makeStorage()
        const clientA = makeDelayedClient(DERIVED, 0)
        const clientB = makeDelayedClient(DERIVED_2, 15)

        await Promise.all([
            getJettonWalletAddress({ client: clientA, owner: OWNER, master: MASTER, chainId: -239, storage }),
            getJettonWalletAddress({ client: clientB, owner: OWNER, master: MASTER_2, chainId: -239, storage }),
        ])

        const stored = await storage.get('tonJettonWallets')
        const map = stored['tonJettonWallets']
        expect(map[jettonWalletCacheKey({ chainId: -239, owner: OWNER, master: MASTER })]).toBe(DERIVED)
        expect(map[jettonWalletCacheKey({ chainId: -239, owner: OWNER, master: MASTER_2 })]).toBe(DERIVED_2)
    })
})
