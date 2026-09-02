import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * checkAndRecoverPendingTxs'in SOLANA dali.
 *
 * Once bir Solana bekleyen kaydi YALNIZCA eskiyerek (24 saat) listeden
 * dusebiliyordu: kurtarma zinciri `current_transactions[].meta.txHash`
 * eslestirmesinden okuyordu, Solana gonderimi ise oraya hicbir sey yazmiyor.
 * Yani kayit her turda `continue` ediliyor, hic COZULMUYORDU; eslesseydi de
 * bir ethers.JsonRpcProvider kurulup getTransactionReceipt BASE58 bir imzayla
 * cagrilacakti. Bu dosya iki seyi birden tutuyor: Solana kayitlari EVM dalina
 * HIC girmiyor ve getSignatureStatuses ile GERCEKTEN cozuluyorlar.
 *
 * Harness background.solanaDerive.test.js'ten alindi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
// Gercekci bir base58 Solana imzasi (64 bayt). ethers.getTransactionReceipt'e
// verilmesi ANLAMSIZDIR; testin butun mesele ettigi sey de bu.
const SOL_SIG = '5wHu1qwD4kLwYqLnJp7iHKGaTZKhcJPvBrfLGgAv1LcjJGLzL8pTDNe6Q7Zvg1cKp8oFJqPvzxTnGaVKhWnZbUqR'
const EVM_HASH = '0x' + 'ab'.repeat(32)
const SOLANA_CHAIN_ID = 'solana-mainnet'

let messageListener
let sessionStore
let localStore

// ethers KISMEN taklit ediliyor: yalnizca JsonRpcProvider. "Solana kaydi icin
// ethers saglayicisi HIC kurulmadi" iddiasi ancak yapicinin kendisi gozlenerek
// kanitlanabilir; ayrica hicbir testin gercek bir RPC'ye cikmamasi gerekir.
const jsonRpcProviderCtor = vi.fn()
const getTransactionReceipt = vi.fn(async () => null)
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SpyProvider {
        constructor(...args) { jsonRpcProviderCtor(...args) }
        getTransactionReceipt(...args) { return getTransactionReceipt(...args) }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SpyProvider } }
})

// supported_chains ADDITIVE olarak genisletiliyor: mevcut on zincir aynen
// duruyor, ustune ILERIDE eklenecek EVM-disi bir zincir ornegi konuyor
// (vm: 'ton', `rpc` alani YOK -- Solana kaydinin izledigi sozlesme).
vi.mock('./data/supported_chains.json', async (importOriginal) => {
    const actual = await importOriginal()
    const list = actual.default ?? actual
    return { default: [...list, { chainId: 'ton-mainnet', name: 'TON', vm: 'ton' }] }
})

const solanaRpc = vi.fn()
vi.mock('./utils/solana/client', () => ({
    solanaRpc: (...a) => solanaRpc(...a),
    SOLANA_API_BASE: 'https://api.test',
}))

// Bu dosya gonderim yolunu hic calistirmiyor; turetme yalnizca background.js
// import edilebilsin diye taklit ediliyor (gercek BIP-39 turetmesinin bedelini
// odememek icin).
vi.mock('./utils/solana/derive', () => ({
    deriveSolanaAddress: vi.fn(),
    deriveSolanaKeypair: vi.fn(),
}))

vi.mock('./utils/crypto-utils', () => ({
    unlockVault: vi.fn(),
    decryptSecret: vi.fn(),
}))

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

    globalThis.chrome = {
        alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN,
            onConnect: add('onConnect'),
            onStartup: add('onStartup'),
            onInstalled: add('onInstalled'),
            onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()),
            lastError: null,
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            session: {
                get: vi.fn(async () => sessionStore),
                set: vi.fn(async (obj) => { Object.assign(sessionStore, obj) }),
                remove: vi.fn(async () => {}),
            },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return listeners
}

function solanaPending(extra = {}) {
    return {
        hash: SOL_SIG,
        chainId: SOLANA_CHAIN_ID,
        from_address: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
        to_address: 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy',
        value: '1',
        asset: 'native',
        receipt_status: 'pending',
        block_timestamp: new Date().toISOString(),
        ...extra,
    }
}

function evmPending(extra = {}) {
    return {
        hash: EVM_HASH,
        receipt_status: 'pending',
        block_timestamp: new Date().toISOString(),
        ...extra,
    }
}

// checkAndRecoverPendingTxs HEARTBEAT'te AWAIT EDILMEDEN tetikleniyor; bu
// yuzden tetikleyip yerlesmesi icin birkac tur bekleniyor.
async function runRecovery() {
    messageListener({ type: 'HEARTBEAT' }, { url: EXTENSION_ORIGIN }, () => {})
    await new Promise((r) => setTimeout(r, 60))
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    getTransactionReceipt.mockResolvedValue(null)
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        current_transactions: [],
        pending_transactions: [],
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

describe('checkAndRecoverPendingTxs - Solana', () => {
    it('onaylanan Solana kaydi getSignatureStatuses ile cozulur ve listeden CIKAR', async () => {
        localStore.pending_transactions = [solanaPending()]
        solanaRpc.mockResolvedValue({
            value: [{ slot: 42, confirmations: null, err: null, confirmationStatus: 'finalized' }],
        })

        await runRecovery()

        expect(solanaRpc).toHaveBeenCalledWith(
            'getSignatureStatuses', [[SOL_SIG], { searchTransactionHistory: true }]
        )
        // Cozulen kayit listede BIRAKILMAZ: golge bakiye onu sonsuza dek
        // dusmeye devam eder ve bakiye kalici olarak eksik gorunur.
        expect(localStore.pending_transactions).toHaveLength(0)
    })

    it('zincirde HATA ile sonuclanan kayit da cozulur', async () => {
        localStore.pending_transactions = [solanaPending()]
        solanaRpc.mockResolvedValue({
            value: [{ slot: 42, err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' }],
        })

        await runRecovery()

        expect(localStore.pending_transactions).toHaveLength(0)
    })

    // Henuz gorunmeyen bir imza DUSMUS de olabilir, sadece gec de yayilmis
    // olabilir. Ikisi ayirt edilemedigi icin kayda DOKUNULMAZ; sure dolunca
    // prunePendingTransactions zaten temizler.
    it('henuz gorunmeyen kayit DOKUNULMAZ', async () => {
        localStore.pending_transactions = [solanaPending()]
        solanaRpc.mockResolvedValue({ value: [null] })

        await runRecovery()

        expect(localStore.pending_transactions).toHaveLength(1)
        expect(localStore.pending_transactions[0].receipt_status).toBe('pending')
    })

    // Henuz yalnizca 'processed' olan bir islem geri alinabilir; 'confirmed'
    // altindaki hicbir durum COZULMUS sayilmaz.
    it('yalnizca processed olan kayit COZULMUS sayilmaz', async () => {
        localStore.pending_transactions = [solanaPending()]
        solanaRpc.mockResolvedValue({
            value: [{ slot: 42, err: null, confirmationStatus: 'processed' }],
        })

        await runRecovery()

        expect(localStore.pending_transactions).toHaveLength(1)
        expect(localStore.pending_transactions[0].receipt_status).toBe('pending')
    })

    // ASIL kapi: current_transactions'ta EVM'e benzeyen bir eslesme OLSA BILE
    // Solana kaydi EVM dalina girmemeli. Girseydi base58 bir imza
    // ethers.JsonRpcProvider.getTransactionReceipt'e verilirdi.
    it('Solana kaydi icin ethers saglayicisi HIC kurulmaz', async () => {
        localStore.pending_transactions = [solanaPending()]
        localStore.current_transactions = [
            { id: 'c1', status: 'done', meta: { txHash: SOL_SIG, chainId: 1 } },
        ]
        solanaRpc.mockResolvedValue({ value: [null] })

        await runRecovery()

        expect(jsonRpcProviderCtor).not.toHaveBeenCalled()
        expect(getTransactionReceipt).not.toHaveBeenCalled()
    })

    // Kural POZITIF: yalnizca BILINEN EVM-DISI zincirler (kayitlarinda vm:
    // 'solana' yazan) kendi yollarina ayrilir. Bunun tersi -- "chainId'si sayi
    // degilse atla" -- METIN chainId tasiyan bir EVM kaydini SESSIZCE sonsuza
    // dek atlardi; kayit ancak 24 saat sonra eskiyerek duser ve o sure boyunca
    // golge bakiyeden dusulmeye devam ederdi. chainId hem 1 hem '1' olarak
    // dolasiyor (isSameChainId'nin var olma sebebi); yeni bir iskelet kurucusu,
    // bir JSON gidis-donusu veya gocurulmus bir kayit kolayca metin uretir.
    it('chainId si METIN olan EVM kaydi yine de cozulur', async () => {
        localStore.pending_transactions = [evmPending({ chainId: '1' })]
        localStore.current_transactions = [
            { id: 'c1', status: 'done', meta: { txHash: EVM_HASH, chainId: 1 } },
        ]
        getTransactionReceipt.mockResolvedValue({
            status: 1, blockNumber: 1234, gasUsed: 21000n, effectiveGasPrice: 1000000000n,
        })

        await runRecovery()

        expect(jsonRpcProviderCtor).toHaveBeenCalledOnce()
        expect(localStore.pending_transactions).toHaveLength(0)
    })

    // Ayni pozitif kural Solana tarafinda: kaydin chainId'si supported_chains'te
    // vm: 'solana' olan kayda denk geliyorsa Solana yoluna ayrilir. Burada
    // hash'in bicimine HIC bakilmaz - ayrimi yapan sey zincirin kendisidir.
    it('zinciri vm: solana olan kayit Solana yoluna ayrilir', async () => {
        localStore.pending_transactions = [solanaPending()]
        solanaRpc.mockResolvedValue({ value: [null] })

        await runRecovery()

        expect(solanaRpc).toHaveBeenCalledOnce()
        expect(jsonRpcProviderCtor).not.toHaveBeenCalled()
    })

    // Karsi yon: EVM kurtarmasi bozulmadi. (Yeni Solana dali kayitlari yanlislikla
    // yutsaydi EVM islemleri sonsuza dek 'pending' kalirdi.)
    it('EVM kaydi eski yoluyla cozulmeye devam eder', async () => {
        localStore.pending_transactions = [evmPending()]
        localStore.current_transactions = [
            { id: 'c1', status: 'done', meta: { txHash: EVM_HASH, chainId: 1 } },
        ]
        getTransactionReceipt.mockResolvedValue({
            status: 1, blockNumber: 1234, gasUsed: 21000n, effectiveGasPrice: 1000000000n,
        })

        await runRecovery()

        expect(jsonRpcProviderCtor).toHaveBeenCalledOnce()
        expect(getTransactionReceipt).toHaveBeenCalledWith(EVM_HASH)
        expect(solanaRpc).not.toHaveBeenCalled()
        expect(localStore.pending_transactions).toHaveLength(0)
    })

    // RPC/proxy dusebilir. Bir Solana kaydinin cozulememesi ne o kaydi
    // bozmali ne de ayni turdaki EVM kayitlarinin islenmesini durdurmali.
    it('getSignatureStatuses duserse kayit BOZULMAZ, EVM kayitlari islenmeye devam eder', async () => {
        localStore.pending_transactions = [solanaPending(), evmPending()]
        localStore.current_transactions = [
            { id: 'c1', status: 'done', meta: { txHash: EVM_HASH, chainId: 1 } },
        ]
        solanaRpc.mockRejectedValue(new Error('SOLANA_RPC_HTTP_503'))
        getTransactionReceipt.mockResolvedValue({
            status: 1, blockNumber: 1234, gasUsed: 21000n, effectiveGasPrice: 1000000000n,
        })

        await runRecovery()

        const kalanlar = localStore.pending_transactions
        expect(kalanlar).toHaveLength(1)
        expect(kalanlar[0].hash).toBe(SOL_SIG)
        expect(kalanlar[0].receipt_status).toBe('pending')
    })

    // withStorageList bozuk/dizi olmayan bir anahtari sessizce []'e indirger.
    // Ham `const { pending_transactions = [] } = await get(...)` yolu bunu
    // yapmaz: varsayilan yalnizca undefined icin devreye girer, dizi olmayan
    // deger oldugu gibi gecer ve `for...of` TypeError firlatir -- kurtarmanin
    // TAMAMI (EVM dali dahil) o turda coker.
    // Ag isi 3. turda kilidin disina cikinca, kilidin kazara sagladigi
    // SERILESTIRME de kayboldu: HEARTBEAT kurtarmayi await etmeden ve kullanici
    // hareket ettikce 5 saniyede bir tetikliyor, yani onceki tur hala agdayken
    // ikincisi baslayip AYNI kayitlar icin AYNI sorgulari tekrarliyordu.
    // Birlestirme hash ile ve taze liste uzerinde yapildigi icin sonuc DOGRU
    // kaliyor; sorun, kendi proxy'mize karsi surekli ikilenen yuk (IP ile hiz
    // sinirli, ucretli bir saglayici anahtarini paylasiyor).
    it('devam eden tur varken IKINCI HEARTBEAT yeni sorgu turu BASLATMAZ', async () => {
        localStore.pending_transactions = [solanaPending()]
        let birak
        solanaRpc.mockReturnValue(new Promise((r) => { birak = () => r({ value: [null] }) }))

        messageListener({ type: 'HEARTBEAT' }, { url: EXTENSION_ORIGIN }, () => {})
        await vi.waitFor(() => { expect(solanaRpc).toHaveBeenCalledTimes(1) })

        messageListener({ type: 'HEARTBEAT' }, { url: EXTENSION_ORIGIN }, () => {})
        await new Promise((r) => setTimeout(r, 60))

        expect(solanaRpc).toHaveBeenCalledTimes(1)

        birak()
        await new Promise((r) => setTimeout(r, 60))
    })

    // Bayragin TERS yonu: tur bitince temizlenmeli. Temizlenmezse kurtarma bir
    // daha HIC calismaz ve bekleyen kayitlar yalnizca 24 saatte eskiyerek
    // duser -- Solana kayitlarinin cozulmesi icin 5. bulguda yapilan isin
    // tamamini sessizce geri alan bir hata olurdu.
    it('tur bittikten SONRA gelen HEARTBEAT yeniden sorgular', async () => {
        localStore.pending_transactions = [solanaPending()]
        solanaRpc.mockResolvedValue({ value: [null] })

        await runRecovery()
        expect(solanaRpc).toHaveBeenCalledTimes(1)

        await runRecovery()
        expect(solanaRpc).toHaveBeenCalledTimes(2)
    })

    // 6. bulgu: kaydin BEYAN ETTIGI zincir taninmiyorsa atlanir. Onu
    // current_transactions'tan gelen BASKA bir zincire sormak yanlis zincire
    // soru sormaktir; base58/baska bicimli bir hash ethers'a gidiyordu.
    it('taninmayan bir zincir beyan eden kayit ethers dalina GIRMEZ', async () => {
        localStore.pending_transactions = [evmPending({ hash: 'BASE58GIBI', chainId: 'aptos-mainnet' })]
        localStore.current_transactions = [
            { id: 'c1', status: 'done', meta: { txHash: 'BASE58GIBI', chainId: 1 } },
        ]

        await runRecovery()

        expect(jsonRpcProviderCtor).not.toHaveBeenCalled()
        expect(solanaRpc).not.toHaveBeenCalled()
        expect(localStore.pending_transactions).toHaveLength(1)
    })

    // Ayni kapi ILERIDEKI EVM-DISI zincirler icin: chainVm bilinmeyen bir `vm`
    // degerini EVM'e dusurur, yani "Solana degil" testi yetmez. Olculen sey
    // KULLANILABILIR EVM UCU olup olmadigi (rpcUrlsOf) -- Solana kaydinda `rpc`
    // alaninin bilerek bulunmamasinin sebebi de bu. (Depoda bir
    // feat/ton-tonconnect dali var: ikinci bir EVM-disi zincir varsayim degil.)
    it('vm si bilinmeyen, RPC ucu olmayan zincir ethers dalina GIRMEZ', async () => {
        localStore.pending_transactions = [evmPending({ hash: 'BASE58GIBI', chainId: 'ton-mainnet' })]
        localStore.current_transactions = [
            { id: 'c1', status: 'done', meta: { txHash: 'BASE58GIBI', chainId: 1 } },
        ]

        await runRecovery()

        expect(jsonRpcProviderCtor).not.toHaveBeenCalled()
        expect(solanaRpc).not.toHaveBeenCalled()
        expect(localStore.pending_transactions).toHaveLength(1)
    })

    it('bozuk (dizi olmayan) bekleyen liste kurtarmayi COKERTMEZ', async () => {
        const hataKaydi = vi.spyOn(console, 'error').mockImplementation(() => {})
        localStore.pending_transactions = { bozuk: true }

        await runRecovery()

        expect(hataKaydi).not.toHaveBeenCalled()
        hataKaydi.mockRestore()
    })
})
