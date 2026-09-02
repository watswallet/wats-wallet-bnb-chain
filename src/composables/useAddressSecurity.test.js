import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useAddressSecurity } from './useAddressSecurity'
import { fetchReputation } from '../utils/addressReputation'
import { getSentRecipients } from '../utils/sentRecipients'
import { fetchHistoryCounterparties } from '../utils/historyRecipients'

vi.mock('../utils/addressReputation', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, fetchReputation: vi.fn() }
})
vi.mock('../utils/sentRecipients', () => ({ getSentRecipients: vi.fn() }))
vi.mock('../utils/historyRecipients', () => ({ fetchHistoryCounterparties: vi.fn() }))

const CLEAN = { severity: null, flags: [], sources: [] }
const KNOWN = '0xAbCd' + '1'.repeat(32) + 'CdEf'
const POISON = '0xAbCd' + '2'.repeat(32) + 'CdEf'
const SAFE = '0x' + '7'.repeat(40)
const MY_ADDRESS = '0x' + 'e'.repeat(40)
const HISTORY_PEER = '0x' + 'd'.repeat(40)

// watch + await zincirinin oturmasi icin birkac mikro tur.
const flush = async () => { for (let i = 0; i < 4; i++) await nextTick() }

let store
beforeEach(() => {
    vi.clearAllMocks()
    fetchReputation.mockResolvedValue(CLEAN)
    getSentRecipients.mockResolvedValue([])
    fetchHistoryCounterparties.mockResolvedValue([])

    store = { vaults: [{ accounts: [{ name: 'Ana Hesap', address: KNOWN }] }], saved_addresses: [] }
    globalThis.chrome = {
        storage: { local: { get: vi.fn(async (keys) => {
            const out = {}
            for (const k of [].concat(keys)) if (k in store) out[k] = store[k]
            return out
        }) } }
    }
})

async function setup(initial = '') {
    const address = ref(initial)
    const sec = useAddressSecurity(address, 'https://api.test')
    await sec.loadTrusted({ chainId: 1, myAddress: MY_ADDRESS })
    await flush()
    return { address, sec }
}

describe('useAddressSecurity — temiz durum', () => {
    it('temiz adres gonderimi engellemez', async () => {
        const { address, sec } = await setup()
        address.value = SAFE
        await flush()

        expect(sec.blocked.value).toBe(false)
        expect(sec.poisonMatch.value).toBe(null)
        expect(sec.reputation.value.severity).toBe(null)
    })

    it('gecersiz adres icin itibar sorgusu YAPILMAZ', async () => {
        const { address, sec } = await setup()
        address.value = '0x123'
        await flush()

        expect(fetchReputation).not.toHaveBeenCalled()
        expect(sec.blocked.value).toBe(false)
    })
})

describe('useAddressSecurity — Solana (base58) adresi', () => {
    // isEvmAddress -> isSupportedAddress gecisinden once bu adres icin fetchReputation
    // HIC cagrilmiyordu: saglayici destegi olmadigini kullaniciya soylemenin tek yolu
    // once sorguyu YAPMAK (fetchReputation kendi icinde unsupported:true'ya karar verir).
    const SOLANA_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

    it('gecerli Solana adresi icin de itibar sorgusu YAPILIR', async () => {
        const { address, sec } = await setup()
        address.value = SOLANA_ADDR
        await flush()

        expect(fetchReputation).toHaveBeenCalledWith('https://api.test', SOLANA_ADDR)
        expect(sec.blocked.value).toBe(false)
    })

    it('unsupported bayragi disariya AYNEN tasinir ama gonderimi engellemez', async () => {
        fetchReputation.mockResolvedValue({ ...CLEAN, unsupported: true })

        const { address, sec } = await setup()
        address.value = SOLANA_ADDR
        await flush()

        expect(sec.reputation.value.unsupported).toBe(true)
        expect(sec.reputation.value.severity).toBe(null)
        expect(sec.blocked.value).toBe(false)
    })
})

describe('useAddressSecurity — ilk deger', () => {
    it('adres BASTAN doluysa da itibar sorgusu yapilir', async () => {
        // ConfirmTransaction.vue boyle calisir: adres ekran acildiginda zaten bellidir,
        // hic degismez. Yalnizca degisikligi dinleyen bir izleyici orada HIC tetiklenmez
        // ve onay ekrani sorgusuz kalirdi — dapp islemleri icin tek kapi orasi.
        fetchReputation.mockResolvedValue({ severity: 'block', flags: ['sanctioned'], sources: [] })

        const { sec } = await setup(SAFE)

        expect(fetchReputation).toHaveBeenCalledWith('https://api.test', SAFE)
        expect(sec.reputation.value.severity).toBe('block')
        expect(sec.blocked.value).toBe(true)
    })
})

describe('useAddressSecurity — itibar', () => {
    it('sorgu surerken gonderim beklemede tutulur', async () => {
        let resolveFetch
        fetchReputation.mockReturnValue(new Promise(r => { resolveFetch = r }))

        const { address, sec } = await setup()
        address.value = SAFE
        await flush()

        expect(sec.checking.value).toBe(true)
        expect(sec.blocked.value).toBe(true)

        resolveFetch(CLEAN)
        await flush()

        expect(sec.checking.value).toBe(false)
        expect(sec.blocked.value).toBe(false)
    })

    it("'block' kararinda onay kutusu ISE YARAMAZ — engel gercekten serttir", async () => {
        fetchReputation.mockResolvedValue({ severity: 'block', flags: ['stealing_attack'], sources: [] })

        const { address, sec } = await setup()
        address.value = SAFE
        await flush()

        expect(sec.blocked.value).toBe(true)

        sec.reputationAcknowledged.value = true
        await flush()

        expect(sec.blocked.value).toBe(true)
    })

    it("'warn' kararinda onay kutusu kapiyi acar", async () => {
        fetchReputation.mockResolvedValue({ severity: 'warn', flags: ['mixer'], sources: [] })

        const { address, sec } = await setup()
        address.value = SAFE
        await flush()

        expect(sec.blocked.value).toBe(true)

        sec.reputationAcknowledged.value = true
        await flush()

        expect(sec.blocked.value).toBe(false)
    })

    it('sorgu basarisiz olursa gonderim ACIK kalir (fail-open)', async () => {
        // fetchReputation kendi icinde fail-open; burada sozlesmenin ucunu dogruluyoruz.
        fetchReputation.mockResolvedValue(CLEAN)

        const { address, sec } = await setup()
        address.value = SAFE
        await flush()

        expect(sec.blocked.value).toBe(false)
    })
})

describe('useAddressSecurity — zehirli adres', () => {
    it('benzeyen adres engellenir, onaydan sonra acilir', async () => {
        const { address, sec } = await setup()
        address.value = POISON
        await flush()

        expect(sec.poisonMatch.value.address).toBe(KNOWN)
        expect(sec.blocked.value).toBe(true)

        sec.poisonAcknowledged.value = true
        await flush()

        expect(sec.blocked.value).toBe(false)
    })

    it('bilinen adresin KENDISI engellenmez', async () => {
        const { address, sec } = await setup()
        address.value = KNOWN
        await flush()

        expect(sec.poisonMatch.value).toBe(null)
        expect(sec.blocked.value).toBe(false)
    })
})

describe('useAddressSecurity — adres degisimi', () => {
    it('adres degisince ONAYLAR sifirlanir', async () => {
        fetchReputation.mockResolvedValue({ severity: 'warn', flags: ['mixer'], sources: [] })

        const { address, sec } = await setup()
        address.value = POISON
        await flush()

        sec.poisonAcknowledged.value = true
        sec.reputationAcknowledged.value = true
        await flush()
        expect(sec.blocked.value).toBe(false)

        address.value = SAFE
        await flush()

        // Onaylar tasinsaydi yeni adres HIC uyari gostermeden gecerdi.
        expect(sec.poisonAcknowledged.value).toBe(false)
        expect(sec.reputationAcknowledged.value).toBe(false)
        expect(sec.blocked.value).toBe(true)
    })

    it('adres degisince ESKI itibar sonucu aninda dusurulur', async () => {
        fetchReputation.mockResolvedValue({ severity: 'block', flags: ['sanctioned'], sources: [] })

        const { address, sec } = await setup()
        address.value = SAFE
        await flush()
        expect(sec.reputation.value.severity).toBe('block')

        address.value = '0x123'
        await flush()

        expect(sec.reputation.value.severity).toBe(null)
    })

    it('GEC gelen eski cevap yeni adresin sonucunu EZMEZ', async () => {
        // Yaris: kullanici kotu adresi yapistirip hemen temiz adresle degistirir.
        // Kotu adresin gec donen cevabi uygulanirsa, kullanici temiz bir adrese
        // gonderirken sahte bir engel gorur — ya da tersi, gercek engel kaybolur.
        let resolveFirst
        fetchReputation
            .mockReturnValueOnce(new Promise(r => { resolveFirst = r }))
            .mockResolvedValueOnce(CLEAN)

        const { address, sec } = await setup()
        address.value = SAFE
        await flush()

        address.value = '0x' + '8'.repeat(40)
        await flush()

        resolveFirst({ severity: 'block', flags: ['sanctioned'], sources: [] })
        await flush()

        expect(sec.reputation.value.severity).toBe(null)
        expect(sec.blocked.value).toBe(false)
    })
})

describe('useAddressSecurity — gecmis karsi taraflari', () => {
    it('gecmisteki muhatabin ikizi uyari uretir', async () => {
        // Kapanmasini istedigimiz delik: hic GONDERMEDIGIN, yalnizca odeme ALDIGIN bir
        // adresin ikizi eskiden sessiz geciyordu.
        fetchHistoryCounterparties.mockResolvedValue([
            { address: HISTORY_PEER, label: null, source: 'history' }
        ])

        const { address, sec } = await setup()
        address.value = HISTORY_PEER.slice(0, 6) + '9'.repeat(32) + HISTORY_PEER.slice(-4)
        await flush()

        expect(sec.poisonMatch.value?.address).toBe(HISTORY_PEER)
        expect(sec.blocked.value).toBe(true)
    })

    it('gecmis alinamazsa diger kaynaklar calismaya devam eder', async () => {
        fetchHistoryCounterparties.mockResolvedValue([])

        const { address, sec } = await setup()
        address.value = POISON
        await flush()

        // KNOWN hala vaults'tan geliyor.
        expect(sec.poisonMatch.value?.address).toBe(KNOWN)
    })

    it('gecmis cagrisina zincir ve kendi adresim gecirilir', async () => {
        await setup()
        expect(fetchHistoryCounterparties).toHaveBeenCalledWith('https://api.test', MY_ADDRESS, 1)
    })
})

// ---------------------------------------------------------------------------
// TON AGINDA KORUMA GERCEKTEN BAGLI MI
//
// addressPoisoning.js artik TON adreslerini taniyor, ama bu TEK BASINA yeterli
// degildi: loadTrusted hesaplari `address` (EVM) alanindan okuyordu, yani TON
// agindayken guvenilir listeye HIC TON adresi girmiyordu ve karsilastirilacak
// bir sey olmadigi icin koruma SESSIZCE hicbir sey yapmiyordu.
// ---------------------------------------------------------------------------
const TON_MAIN = 'UQCQvhHtQ6MKAQ0J7OCHB3lug434uG7tBMrDgKvtylug9knE'
const TON_TESTNET = '0QCQvhHtQ6MKAQ0J7OCHB3lug434uG7tBMrDgKvtylug9vJO'
const TON_PEER = 'UQCQPrqe2A193cxe8KSAro91Z5BY98wAFXFk7k_3dNe1W3nE'

describe('TON aginda guvenilir liste', () => {
    it('hesabin TON adresi listeye GIRER, EVM adresi GIRMEZ', async () => {
        store.vaults = [{ accounts: [{ name: 'Ana', address: KNOWN, tonAddress: TON_MAIN }] }]
        const address = ref('')
        const sec = useAddressSecurity(address, 'https://api.test')
        await sec.loadTrusted({ chainId: -239, myAddress: KNOWN })

        const addrs = sec.trusted.value.map(t => t.address)
        expect(addrs).toContain(TON_MAIN)
        expect(addrs).not.toContain(KNOWN)
    })

    it('testnet te AYRI alan okunur', async () => {
        store.vaults = [{ accounts: [{ name: 'Ana', address: KNOWN, tonAddress: TON_MAIN, tonAddressTestnet: TON_TESTNET }] }]
        const sec = useAddressSecurity(ref(''), 'https://api.test')
        await sec.loadTrusted({ chainId: -3, myAddress: KNOWN })

        expect(sec.trusted.value.map(t => t.address)).toContain(TON_TESTNET)
    })

    // Gecmis karsi taraflari da DOGRU kimlikle sorulmali: TON agindayken
    // kullanicinin EVM adresiyle gecmis sorulursa bos doner ve gecmisten gelen
    // guvenilir adresler hic olusmaz.
    it('gecmis TON adresiyle sorulur - cagiranin verdigi EVM adresiyle DEGIL', async () => {
        store.vaults = [{ accounts: [{ name: 'Ana', address: KNOWN, tonAddress: TON_MAIN }] }]
        store.active_account = { address: KNOWN, tonAddress: TON_MAIN }
        fetchHistoryCounterparties.mockResolvedValue([{ address: TON_PEER, label: null }])

        const sec = useAddressSecurity(ref(''), 'https://api.test')
        await sec.loadTrusted({ chainId: -239, myAddress: KNOWN })

        expect(fetchHistoryCounterparties).toHaveBeenCalledWith('https://api.test', TON_MAIN, -239)
    })

    // Onbellekli TON adresi yoksa gecmis HIC SORULMAZ - yanlis adresle sormak
    // bos sonuc doner ve gereksiz bir istek olur.
    it('onbellekli TON adresi yoksa gecmis SORULMAZ', async () => {
        store.vaults = [{ accounts: [{ name: 'Ana', address: KNOWN }] }]
        store.active_account = { address: KNOWN }

        const sec = useAddressSecurity(ref(''), 'https://api.test')
        await sec.loadTrusted({ chainId: -239, myAddress: KNOWN })

        expect(fetchHistoryCounterparties).not.toHaveBeenCalled()
    })

    // EVM davranisi AYNEN korunmali.
    it('EVM aginda gecmis cagiranin verdigi adresle sorulur', async () => {
        const sec = useAddressSecurity(ref(''), 'https://api.test')
        await sec.loadTrusted({ chainId: 1, myAddress: MY_ADDRESS })
        expect(fetchHistoryCounterparties).toHaveBeenCalledWith('https://api.test', MY_ADDRESS, 1)
    })
})
