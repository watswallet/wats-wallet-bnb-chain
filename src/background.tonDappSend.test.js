import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { keyPairFromSeed } from '@ton/crypto'
import { Address, Cell, beginCell, loadMessage } from '@ton/core'
// Genel @ton/ton indeksinde YOK (paketin ic dosya yolu) - V5R1'in imzali govdesini
// COZMEK icin gerekli. `bounce`u DOGRUDAN gorunume/loga degil GERCEKTEN IMZALANAN
// govdeye yazildigini kanitlamanin tek yolu bu: govdeyi cozup outMsg.info.bounce'a
// bakmak (inceleme turu 2'nin onerdigi teknik).
import { loadWalletIdV5R1 } from '@ton/ton/dist/wallets/v5r1/WalletV5R1WalletId.js'
import { loadOutListExtendedV5R1 } from '@ton/ton/dist/wallets/v5r1/WalletV5R1Actions.js'

/**
 * TON_DAPP_SEND (tonDappSend) handler'i - dogrudan testler.
 *
 * background.js bir service worker GIRIS dosyasi: hicbir sey disari vermiyor ve
 * modul kapsaminda chrome.* dinleyicileri kaydediyor. Bu yuzden handler'a tek
 * ulasma yolu, chrome API'sini taklit edip modulu import etmek ve kaydettigi
 * onMessage dinleyicisini yakalamak. Harness background.solanaSend.test.js'ten
 * BIREBIR alindi.
 *
 * Bu dosya inceleme turu 1'in bulgularini dogrudan hedefler:
 *   - CRITICAL 1: TON_MAINNET_ID importsuzdu, MAINNET dalinda ReferenceError
 *     firlatiyordu (testler yalnizca testnet'i egzersiz ettigi icin gorunmuyordu).
 *   - CRITICAL 2: assertNoUnsettledTonFee kapisi tonDappSend'de EKSIKTI.
 *   - Onemli 4: imzalayan cuzdan onaylanan `from` ile KILITLENMEMISTI.
 *   - Onemli 3: donen BOC ile yayinlanan mesajin `init` karari FARKLI
 *     kaynaklardan (seqno===0 vs isContractDeployed) geliyordu.
 *
 * getTonClient ve tonIdentityForAccount tam MOCKLANIR (ag/gercek anahtar sirri
 * yok); walletFromKeyPair/contract.createTransfer/@ton/core GERCEKTIR - boylece
 * donen BOC ve yayinlanan govde GERCEK TON kodlamasindan gecer.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const RECIPIENT = '0:2222222222222222222222222222222222222222222222222222222222222222'

let FIXED_KEYPAIR
let MAINNET_ADDRESS_RAW
let MAINNET_ADDRESS_FRIENDLY

beforeAll(async () => {
    // Sabit tohum: TEST BOYUNCA AYNI anahtar cifti/adres, gercek @ton/crypto
    // ve @ton/ton kodundan geciyor (mock DEGIL).
    FIXED_KEYPAIR = keyPairFromSeed(Buffer.alloc(32, 7))
    const actual = await vi.importActual('./utils/ton/tonAccount')
    const contractAddress = actual.tonWalletContract(FIXED_KEYPAIR.publicKey, { testnet: false }).address
    MAINNET_ADDRESS_RAW = contractAddress.toRawString()
    // Inceleme turu 2 (kucuk sertlestirme): ayni adresin FRIENDLY (EQ.../UQ...)
    // gosterimi - Gorev 12 (onay ekrani) henuz yazilmadigi icin `from`u hangi
    // bicimde geri gonderecegi bilinmiyor, ikisi de kabul edilmeli.
    MAINNET_ADDRESS_FRIENDLY = contractAddress.toString({ bounceable: false })
})

let sessionStore
let localStore

const tonIdentityForAccount = vi.fn()
vi.mock('./utils/ton/tonIdentity', () => ({
    tonIdentityForAccount: (...a) => tonIdentityForAccount(...a),
}))

// getTonClient TAM MOCKLANIR: gercek TonClient ag'a cikar. `wallet.send` ve
// `isContractDeployed` buradan kontrol edilir - GERCEK yayin/zincir sorgusu YOK.
let seqnoValue = 0
let deployedFlag = true
const sendSpy = vi.fn(async () => {})
const isContractDeployedSpy = vi.fn(async () => deployedFlag)
const getTonClient = vi.fn(() => ({
    open: (contract) => ({
        getSeqno: async () => seqnoValue,
        send: (body) => sendSpy(body),
        address: contract.address,
        init: contract.init,
    }),
    isContractDeployed: (...a) => isContractDeployedSpy(...a),
}))
vi.mock('./utils/ton/tonClient', () => ({
    getTonClient: (...a) => getTonClient(...a),
}))

const loadAllTonSettlements = vi.fn(async () => [])
const hasUnsettledTonFee = vi.fn(() => false)
const clearTonSettlement = vi.fn(async () => {})
vi.mock('./utils/ton/tonFeeSettlement', () => ({
    loadAllTonSettlements: (...a) => loadAllTonSettlements(...a),
    hasUnsettledTonFee: (...a) => hasUnsettledTonFee(...a),
    clearTonSettlement: (...a) => clearTonSettlement(...a),
}))

let messageListener

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
                    const wanted = keys === undefined ? Object.keys(localStore)
                        : (Array.isArray(keys) ? keys : [keys])
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

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

function dappSendMessage(overrides = {}) {
    return {
        type: 'TON_DAPP_SEND',
        message: {
            messages: [{ address: RECIPIENT, amountNano: '1000000000', payload: null, stateInit: null }],
            validUntil: Math.floor(Date.now() / 1000) + 300,
            apiBase: 'https://api.test',
            from: MAINNET_ADDRESS_RAW,
            ...overrides,
        },
    }
}

/**
 * `wallet.send(body)`'e GERCEKTEN gecen imzali V5R1 govdesini cozup, icindeki
 * `sendMsg` eylemlerinin `bounce` bayraklarini SIRAYLA doner.
 *
 * Govde sekli (createWalletTransferV5R1): opcode(32) + walletId + timeout(32) +
 * seqno(32) + storeOutListExtendedV5R1(actions) + imza(kuyrukta). `bounce`u
 * yalnizca CAGRI ARGUMANINI (internal({...}) icin verilen nesneyi) okumak,
 * onun GERCEKTEN imzalanan govdeye gectigini KANITLAMAZ - bu yuzden govde
 * COZULUR (inceleme turu 2'nin onerdigi teknik).
 */
function decodeSentBounceFlags(bodyCell) {
    const slice = bodyCell.beginParse()
    slice.loadUint(32) // auth_signed_external opcode
    // loadWalletIdV5R1 walletId'yi networkGlobalId ile XOR'lanmis olarak COZER
    // (bkz. storeWalletIdV5R1) - ikinci argumani vermezsek BigInt(undefined)
    // ile patlar. Testler MAINNET'te (-239) calisiyor.
    loadWalletIdV5R1(slice, -239)
    slice.loadUint(32) // timeout
    slice.loadUint(32) // seqno
    const actions = loadOutListExtendedV5R1(slice)
    return actions.filter((a) => a.type === 'sendMsg').map((a) => a.outMsg.info.bounce)
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    seqnoValue = 0
    deployedFlag = true
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'acc-1', address: '0xabc' },
        vaults: [{ id: 'v1', type: 'hd', accounts: [{ key: 'acc-1', address: '0xabc' }] }],
        // MAINNET: T9 inceleme turu 1'in CRITICAL 1'i tam olarak bu dali
        // hicbir testin egzersiz etmemesinden dogdu (testler yalnizca testnet
        // dalini calistiriyordu, TON_MAINNET_ID importsuzdu ve mainnet dalinda
        // ReferenceError firlatiyordu). Varsayilan burada BILEREK mainnet.
        currentNetwork: { chainId: -239 },
        current_transactions: [],
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]

    tonIdentityForAccount.mockResolvedValue({ keyPair: FIXED_KEYPAIR, address: MAINNET_ADDRESS_RAW, friendly: MAINNET_ADDRESS_RAW })
    // vi.clearAllMocks() calisan cagrilari/sonuclari siler ama BIR ONCEKI testin
    // mockReturnValue/mockResolvedValue ile birakip GITTIGI uygulamayi SILMEZ -
    // bu yuzden her testin varsayilan durumu burada ACIKCA yeniden kurulur.
    hasUnsettledTonFee.mockReturnValue(false)
    sendSpy.mockResolvedValue(undefined)
    isContractDeployedSpy.mockImplementation(async () => deployedFlag)
})

describe('TON_DAPP_SEND', () => {
    // CRITICAL 1: bu SENARYO (mainnet) TON_MAINNET_ID importsuzken
    // `const chainId = testnet ? TON_TESTNET_ID : TON_MAINNET_ID` satirinda
    // ReferenceError firlatiyordu - islem hicbir zaman kuyruga girmiyordu.
    it('MAINNET yolunda ReferenceError firlatmadan imzalar ve yayinlar', async () => {
        const res = await callHandler(dappSendMessage())

        expect(res.success).toBe(true)
        expect(typeof res.boc).toBe('string')
        expect(sendSpy).toHaveBeenCalledOnce()

        // Gecmis karti GERCEK bir TON kimligiyle (-239) yazilmis olmali - baska
        // turlu hasPendingTonTx bu kaydi hic gormez (bkz. tonPending.js:isTon).
        const record = localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')
        expect(record).toBeTruthy()
        expect(record.meta.chainId).toBe(-239)
    })

    it('cozulmemis ucret makbuzu varken islem DURUR, yayin HIC yapilmaz', async () => {
        hasUnsettledTonFee.mockReturnValue(true)

        const res = await callHandler(dappSendMessage())

        expect(res.success).toBe(false)
        expect(res.error).toBe('Cozulmemis bir ucret kaydi var. Once onun sonuclanmasi bekleniyor.')
        expect(sendSpy).not.toHaveBeenCalled()
    })

    // Onemli 4: onay ekraninda kullaniciya gosterilen `from`, burada COZULEN
    // anahtarin adresiyle AYNI olmali. `accountFromUi` yanlis/eski bir hesaba
    // isaret ettiginde (ya da onay ekrani `from`u hic tasimadiginda) baska bir
    // hesaptan imzalanmasin diye bu GURULTULU sekilde reddedilir.
    it('imzalayan hesap onaylanan from ile uyusmuyorsa islem DURUR, yayin HIC yapilmaz', async () => {
        const res = await callHandler(dappSendMessage({
            from: '0:9999999999999999999999999999999999999999999999999999999999999999',
        }))

        expect(res.success).toBe(false)
        expect(res.error).toBe('Imzalayan hesap onaylanan hesapla uyusmuyor. Islem durduruldu.')
        expect(sendSpy).not.toHaveBeenCalled()
    })

    it('yayin (broadcast) basarisiz olursa hata doner ve kart error yazilir', async () => {
        sendSpy.mockRejectedValueOnce(new Error('network down'))

        const res = await callHandler(dappSendMessage())

        expect(res.success).toBe(false)
        expect(typeof res.error).toBe('string')

        const record = localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')
        expect(record.status).toBe('error')
    })

    // Onemli 3: donen BOC'un `init` karari YAYINLANAN mesajla AYNI kaynaktan
    // (isContractDeployed) gelmeli, seqno===0'dan DEGIL. deployedFlag=false
    // burada seqno da 0 - eski (yanlis) kod ile yeni kod AYNI sonucu verirdi;
    // asil ayirt edici durum deployedFlag=true + seqno===0 (asagidaki ikinci test).
    it('cuzdan henuz dagitilmamissa (isContractDeployed=false) BOC init TASIR', async () => {
        deployedFlag = false
        seqnoValue = 0

        const res = await callHandler(dappSendMessage())
        expect(res.success).toBe(true)

        const parsed = loadMessage(Cell.fromBase64(res.boc).beginParse())
        expect(parsed.init).not.toBeNull()
    })

    // AYIRT EDICI DURUM: cuzdan ZATEN dagitilmis (isContractDeployed=true) AMA
    // seqno hala 0 gorunuyor (or. zincir gecikmesi/yeniden kurulmus takip).
    // seqno===0 kararina dayanan ESKI kod burada da init EKLERDI; dogru kod
    // (isContractDeployed) init eklemez - donen BOC gercek yayinla AYNI hash'i
    // tasir.
    it('seqno 0 olsa bile cuzdan dagitilmissa (isContractDeployed=true) BOC init TASIMAZ', async () => {
        deployedFlag = true
        seqnoValue = 0

        const res = await callHandler(dappSendMessage())
        expect(res.success).toBe(true)

        const parsed = loadMessage(Cell.fromBase64(res.boc).beginParse())
        expect(parsed.init).toBeNull()
    })

    // Inceleme turu 2 (Onemli): kuyruga girmeden ONCE calisan blok (meta/chainId
    // kurulumu) KENDI try/catch'i olmadan yaziliyordu. `messages` bozuksa
    // (dizi degil ya da amountNano BigInt'e cevrilemez) o blok FIRLIYORDU ve
    // dispatcher tonDappSend'i .catch'SIZ cagirdigi icin sendResponse HIC
    // cagrilmiyor, dapp'in istegi SESSIZCE asili kaliyordu (test bunu yakalamak
    // icin bir zaman asimi YERINE dogrudan yanitin GELDIGINI dogrular - handler
    // .then/.catch OLMADAN cagirsaydi callHandler ASLA cozulmez ve test kendisi
    // zaman asimina ugrardi).
    it('messages bozuksa asilmaz - success:false ile HEMEN doner', async () => {
        const res = await callHandler(dappSendMessage({ messages: 'not-an-array' }))

        expect(res).toBeTruthy()
        expect(res.success).toBe(false)
        expect(sendSpy).not.toHaveBeenCalled()
    })

    it('messages icindeki amountNano BigInte cevrilemezse asilmaz - success:false ile HEMEN doner', async () => {
        const res = await callHandler(dappSendMessage({
            messages: [{ address: RECIPIENT, amountNano: 'not-a-number' }],
        }))

        expect(res).toBeTruthy()
        expect(res.success).toBe(false)
        expect(sendSpy).not.toHaveBeenCalled()
    })

    // Inceleme turu 2: valid_until kapisinin GERCEKTEN calistigini (silinirse
    // suit'in geri kalani yesil kalirdi) dogrudan sinamak.
    it('valid_until MILISANIYE (uint32 sinirini asiyor) reddedilir, yayin YAPILMAZ', async () => {
        // Date.now() milisaniye cinsinden ~1.7e12+, uint32 sinirini (0xFFFFFFFF
        // ~4.29e9) rahatca asar - tam da bir dapp'in saniye yerine milisaniye
        // yollamasi hatasi.
        const res = await callHandler(dappSendMessage({ validUntil: Date.now() }))

        expect(res.success).toBe(false)
        expect(res.error).toBe('Islem gecerlilik suresi gecersiz.')
        expect(sendSpy).not.toHaveBeenCalled()
    })

    it('suresi IMZALAMA aninda dolmus valid_until reddedilir, yayin YAPILMAZ', async () => {
        const res = await callHandler(dappSendMessage({ validUntil: Math.floor(Date.now() / 1000) - 5 }))

        expect(res.success).toBe(false)
        expect(res.error).toBe('Bu islemin onay suresi doldu. Lutfen tekrar deneyin.')
        expect(sendSpy).not.toHaveBeenCalled()
    })

    // Onemli 6: payload TASIYAN bir mesaj (kontrata cagri) bounce:true, TASIMAYAN
    // (duz transfer) bounce:false uretmeli. GORUNUME/loga degil, GERCEKTEN
    // IMZALANAN govdeye (sendSpy'a giden body) bakilir - decodeSentBounceFlags
    // govdeyi V5R1 sema uzerinden cozer.
    it('payload tasiyan mesaj bounce:true, tasimayan bounce:false uretir (imzali govdede)', async () => {
        const opaquePayload = beginCell().storeUint(0, 32).endCell().toBoc().toString('base64')

        const res = await callHandler(dappSendMessage({
            messages: [
                { address: RECIPIENT, amountNano: '1000000000', payload: null, stateInit: null },
                { address: RECIPIENT, amountNano: '2000000000', payload: opaquePayload, stateInit: null },
            ],
        }))

        expect(res.success).toBe(true)
        expect(sendSpy).toHaveBeenCalledOnce()

        const sentBody = sendSpy.mock.calls[0][0]
        const bounceFlags = decodeSentBounceFlags(sentBody)
        expect(bounceFlags).toEqual([false, true])
    })

    // Kucuk sertlestirme (inceleme turu 2): from artik Address.parse(...).equals(...)
    // ile karsilastiriliyor, duz dize DEGIL - Gorev 12 (onay ekrani) FRIENDLY
    // bicimde geri gonderirse de gonderim REDDEDILMEMELI.
    it('from FRIENDLY (EQ.../UQ...) bicimde gelirse de KABUL edilir', async () => {
        const res = await callHandler(dappSendMessage({ from: MAINNET_ADDRESS_FRIENDLY }))

        expect(res.success).toBe(true)
        expect(sendSpy).toHaveBeenCalledOnce()
    })

    it('from ayristirilamayan bozuk bir deger olursa GURULTULU reddedilir, yayin YAPILMAZ', async () => {
        const res = await callHandler(dappSendMessage({ from: 'boyle-bir-ton-adresi-yok' }))

        expect(res.success).toBe(false)
        expect(res.error).toBe('Imzalayan hesap onaylanan hesapla uyusmuyor. Islem durduruldu.')
        expect(sendSpy).not.toHaveBeenCalled()
    })
})
