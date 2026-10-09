import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { isKnownTonSendError } from './utils/ton/tonSendErrors'
import { TonFeeError } from './utils/ton/tonFeeClient'
import { TonRelayerError } from './utils/ton/tonFeeRelayer'
import { keyPairFromSeed } from '@ton/crypto'
import { Address, Cell, beginCell, external, loadMessage, storeMessage } from '@ton/core'
import { TonClient } from '@ton/ton'
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
 * donen BOC ve yayinlanan govde GERCEK TON kodlamasindan gecer. "Yayin siniri"
 * blogu ise GERCEK TonClient'i kosar, yalniz global fetch sahtedir.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
// dApp mesaj adresi FRIENDLY olmali (rpc.md); bounce bayragi adresten okunur.
// Ayni hash'in uc bicimi: UQ (bounce false), EQ (bounce true), raw (bayraksiz).
const RECIPIENT = 'UQAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIsAH'
const RECIPIENT_EQ = 'EQAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIp3C'
const RECIPIENT_RAW = '0:2222222222222222222222222222222222222222222222222222222222222222'

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
    gercekWaitForSeqno = (await vi.importActual('./utils/ton/tonSend')).waitForSeqno
})

let sessionStore
let localStore

const tonIdentityForAccount = vi.fn()
vi.mock('./utils/ton/tonIdentity', () => ({
    tonIdentityForAccount: (...a) => tonIdentityForAccount(...a),
}))

// getTonClient TAM MOCKLANIR: gercek TonClient ag'a cikar. Zincir okumalari
// (getSeqno, isContractDeployed) ve YAYIN buradan kontrol edilir. Yayin tek ag
// cagrisidir: sendFile/sendMessage -> sendSpy (external mesajin BOC'u, Buffer).
let seqnoValue = 0
let deployedFlag = true
const sendSpy = vi.fn(async () => {})
const isContractDeployedSpy = vi.fn(async () => deployedFlag)
const bocOf = (msg) => beginCell().store(storeMessage(msg)).endCell().toBoc()

// Acilmis cuzdanin `send`i @ton/ton 16.3 TonClient ile AYNI sirada calisir
// (createProvider().external): ONCE isContractDeployed okur, SONRA sendFile.
// Duz bir spy bu gizli okumayi saklardi.
function tonIstemcisi(getSeqno) {
    const client = {
        open: (contract) => ({
            getSeqno,
            send: async (body) => {
                const init = (await client.isContractDeployed(contract.address)) ? null : contract.init
                await client.sendFile(bocOf(external({ to: contract.address, init, body })))
            },
            address: contract.address,
            init: contract.init,
        }),
        isContractDeployed: (...a) => isContractDeployedSpy(...a),
        sendFile: (boc) => sendSpy(boc),
        sendMessage: (msg) => sendSpy(bocOf(msg)),
    }
    return client
}
const varsayilanIstemci = () => tonIstemcisi(async () => seqnoValue)
const getTonClient = vi.fn(varsayilanIstemci)
vi.mock('./utils/ton/tonClient', () => ({
    getTonClient: (...a) => getTonClient(...a),
}))

// TEK TESTLIK istemci: cuzdanin getSeqno'su testin verdigi fonksiyondur.
const istemciSeqnoIle = (getSeqno) => () => tonIstemcisi(getSeqno)

// seqno izleyicisi testten kontrol edilir; modulun geri kalani (walletFromKeyPair
// dahil) GERCEK. Varsayilan HIC sonuclanmaz ("hala bekliyor"): gercek izleyici
// 30 x 1.5 sn uyur ve test bittikten sonra sonraki testin deposuna kart
// yazabilirdi. Gercek davranisi isteyen test gercekWaitForSeqno'yu baglar.
const waitForSeqnoSpy = vi.fn()
let gercekWaitForSeqno
vi.mock('./utils/ton/tonSend', async (importOriginal) => ({
    ...(await importOriginal()),
    waitForSeqno: (...a) => waitForSeqnoSpy(...a),
}))

const loadAllTonSettlements = vi.fn(async () => [])
const hasUnsettledTonFee = vi.fn(() => false)
const clearTonSettlement = vi.fn(async () => {})
vi.mock('./utils/ton/tonFeeSettlement', () => ({
    loadAllTonSettlements: (...a) => loadAllTonSettlements(...a),
    hasUnsettledTonFee: (...a) => hasUnsettledTonFee(...a),
    clearTonSettlement: (...a) => clearTonSettlement(...a),
}))

// RELAY dali: sunucuya gidecek `actions` burada yakalanir (teklif ve dogrulama
// ayni diziyle kurulur). Modulun geri kalani GERCEK kalir.
const executeTonViaRelayer = vi.fn()
vi.mock('./utils/ton/tonFeeRelayer', async (importOriginal) => ({
    ...(await importOriginal()),
    executeTonViaRelayer: (...a) => executeTonViaRelayer(...a),
}))

let messageListener
// Kayitli dinleyiciler (pencere kapanisi B1 testlerinde tetiklenir) ve
// background.js'in KULLANDIGI dappFunctions ornegi (ayni modul kaydi).
let bgListeners
let dapp

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [], onRemoved: [] }
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
        windows: { create: vi.fn(), onRemoved: add('onRemoved'), remove: vi.fn() },
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

// Yanit, siraya girmis kart yazmasindan (updateTxStatus) ONCE gelebilir.
// Depo taklidi yalniz mikro-gorev kullanir: tek makro-gorev turu hepsini
// indirir. Kart ancak bundan sonra okunursa sonuc iki yonde de kesindir.
const yazmalariBekle = () => new Promise((r) => setTimeout(r, 0))

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
 * YAYINLANAN external mesajin imzali V5R1 govdesini cozup, icindeki
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
    bgListeners = listeners
    // background.js'ten SONRA: vi.resetModules sonrasi ayni kayittan gelir.
    dapp = await import('./utils/dappFunctions')

    tonIdentityForAccount.mockResolvedValue({ keyPair: FIXED_KEYPAIR, address: MAINNET_ADDRESS_RAW, friendly: MAINNET_ADDRESS_RAW })
    // vi.clearAllMocks() calisan cagrilari/sonuclari siler ama BIR ONCEKI testin
    // mockReturnValue/mockResolvedValue ile birakip GITTIGI uygulamayi SILMEZ -
    // bu yuzden her testin varsayilan durumu burada ACIKCA yeniden kurulur.
    hasUnsettledTonFee.mockReturnValue(false)
    // mockReset: tuketilmemis ...Once degerleri de silinir (clearAllMocks
    // silmez). Or. kapiya takilan ikinci istegin yayin hatasi sonraki testin
    // yayinina, erken dusen testin GERCEK istemcisi sonraki teste sizardi.
    sendSpy.mockReset()
    sendSpy.mockResolvedValue(undefined)
    isContractDeployedSpy.mockReset()
    isContractDeployedSpy.mockImplementation(async () => deployedFlag)
    executeTonViaRelayer.mockResolvedValue({ externalBoc: 'te6RELAYBOC' })
    getTonClient.mockReset()
    getTonClient.mockImplementation(varsayilanIstemci)
    waitForSeqnoSpy.mockReset()
    waitForSeqnoSpy.mockImplementation(() => new Promise(() => {}))
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
        expect(res.error).toBe('TON_RELAY_PENDING_SETTLEMENT')
        expect(isKnownTonSendError(res.error), 'kod kullaniciya cevrilmiyor').toBe(true)
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
        expect(res.error).toBe('TON_DAPP_FROM_MISMATCH')
        expect(isKnownTonSendError(res.error), 'kod kullaniciya cevrilmiyor').toBe(true)
        expect(sendSpy).not.toHaveBeenCalled()
    })

    // BELIRSIZ YAYIN: yayinin (sendFile) hatasi (zaman asimi/5xx) mesaj KABUL
    // edildikten sonra da gelebilir. Kart 'error' olsaydi bekleyen-islem kapisi
    // acilir, tekrar denenen istek seqno+1 imzalardi (iki transfer de isler).
    it('yayin (broadcast) belirsiz duserse kod 0 doner, kart error DEGIL processing', async () => {
        sendSpy.mockRejectedValueOnce(new Error('network down'))

        const res = await callHandler(dappSendMessage())

        expect(res).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: true, code: 0 })

        await yazmalariBekle()
        const record = localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')
        expect(record.status).toBe('processing')
        expect(record.meta.errorCode, 'kart "gonderilemedi, tekrar dene" tasimamali').toBeUndefined()
    })

    // Basari dalindaki AYNI izleme: mesaj zincire indiyse kart 'success' olur.
    it('belirsiz yayindan sonra seqno izlenir: seqno ilerleyince kart success', async () => {
        // GERCEK izleyici: ilk yoklamada ilerlemeyi gorur, hic uyumaz.
        waitForSeqnoSpy.mockImplementationOnce(gercekWaitForSeqno)
        // Imza aninda 0, sonraki okumalarda 1 (ilk mesaj zincire indi).
        getTonClient.mockImplementationOnce(istemciSeqnoIle(vi.fn().mockResolvedValueOnce(0).mockResolvedValue(1)))
        sendSpy.mockRejectedValueOnce(new Error('timeout'))

        const res = await callHandler(dappSendMessage())

        expect(res).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: true, code: 0 })
        await vi.waitFor(() => {
            const record = localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')
            expect(record.status).toBe('success')
        })
    })

    // SINIR yayinin KENDISI: ondan ONCEKI hata hicbir sey gondermedi. Kart
    // eskisi gibi 'error', yanit yeniden denenebilir.
    it.each([
        ['seqno okumasi', () => getTonClient.mockImplementationOnce(istemciSeqnoIle(vi.fn().mockRejectedValue(new Error('rpc down'))))],
        ['isContractDeployed', () => isContractDeployedSpy.mockRejectedValueOnce(new Error('rpc down'))],
    ])('yayindan ONCE dusen hata (%s) karti error yazar, yayin YOK', async (_ad, kur) => {
        kur()

        const res = await callHandler(dappSendMessage())

        expect(res).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: false, code: null })
        expect(sendSpy).not.toHaveBeenCalled()

        await yazmalariBekle()
        const record = localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')
        expect(record.status).toBe('error')
        expect(record.meta.errorCode).toBe('TON_SEND_FAILED')
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
        expect(res.error).toBe('TON_DAPP_VALID_UNTIL_INVALID')
        expect(isKnownTonSendError(res.error), 'kod kullaniciya cevrilmiyor').toBe(true)
        expect(sendSpy).not.toHaveBeenCalled()
    })

    it('suresi IMZALAMA aninda dolmus valid_until reddedilir, yayin YAPILMAZ', async () => {
        const res = await callHandler(dappSendMessage({ validUntil: Math.floor(Date.now() / 1000) - 5 }))

        expect(res.success).toBe(false)
        expect(res.error).toBe('TON_DAPP_REQUEST_EXPIRED')
        expect(isKnownTonSendError(res.error), 'kod kullaniciya cevrilmiyor').toBe(true)
        expect(sendSpy).not.toHaveBeenCalled()
    })

    // rpc.md: bounce ADRESIN bayragindan okunur (EQ true, UQ false), yukten
    // DEGIL. Fikstur iki kurali TERS yonde ayirir: eski (yuk) kurali burada
    // [false, true] verirdi. GORUNUME/loga degil, GERCEKTEN IMZALANAN govdeye
    // (sendSpy'a giden body) bakilir - decodeSentBounceFlags govdeyi V5R1 sema
    // uzerinden cozer.
    it('bounce ADRESIN bayragindan gelir, yukten DEGIL (imzali govdede)', async () => {
        const opaquePayload = beginCell().storeUint(0, 32).endCell().toBoc().toString('base64')

        const res = await callHandler(dappSendMessage({
            messages: [
                { address: RECIPIENT_EQ, amountNano: '1000000000', payload: null, stateInit: null },
                { address: RECIPIENT, amountNano: '2000000000', payload: opaquePayload, stateInit: null },
            ],
        }))

        expect(res.success).toBe(true)
        expect(sendSpy).toHaveBeenCalledOnce()

        // sendSpy yayinlanan external mesajin BOC'unu alir; govde onun icinde.
        const yayin = loadMessage(Cell.fromBoc(sendSpy.mock.calls[0][0])[0].beginParse())
        const bounceFlags = decodeSentBounceFlags(yayin.body)
        expect(bounceFlags).toEqual([true, false])
    })

    // Raw adreste bounce bayragi YOK: tahmin edip imzalamak yerine durur.
    // Dogrulama (tonConnectMessages) raw'i zaten reddediyor; bu kapi bayat ya
    // da uydurulmus bir istege karsi.
    it('raw mesaj adresi TON_ADDRESS_INVALID ile durur, yayin YAPILMAZ', async () => {
        const res = await callHandler(dappSendMessage({
            messages: [{ address: RECIPIENT_RAW, amountNano: '1000000000', payload: null, stateInit: null }],
        }))

        expect(res.success).toBe(false)
        expect(res.error).toBe('TON_ADDRESS_INVALID')
        expect(isKnownTonSendError(res.error), 'kod kullaniciya cevrilmiyor').toBe(true)
        expect(sendSpy).not.toHaveBeenCalled()
    })

    // RELAY dali AYNI kurali izlemeli. Yalniz bounce degisti: tutar eslemesi
    // yukten turemeye devam eder (yuk -> amountNano '0' + gasTonNano).
    it('RELAY: bounce adresten, tutar eslemesi yukten (iki kol)', async () => {
        const opaquePayload = beginCell().storeUint(0, 32).endCell().toBoc().toString('base64')

        const res = await callHandler(dappSendMessage({
            payWithTonFee: true,
            approvedAtsFee: '18400000000000000000',
            messages: [
                { address: RECIPIENT_EQ, amountNano: '1000000000', payload: null, stateInit: null },
                { address: RECIPIENT, amountNano: '2000000000', payload: opaquePayload, stateInit: null },
            ],
        }))

        expect(res).toEqual({ success: true, boc: 'te6RELAYBOC' })
        expect(sendSpy).not.toHaveBeenCalled()
        expect(executeTonViaRelayer).toHaveBeenCalledOnce()
        expect(executeTonViaRelayer.mock.calls[0][0].actions).toEqual([
            { kind: 'raw', to: RECIPIENT_EQ, amountNano: '1000000000', bounce: true },
            { kind: 'raw', to: RECIPIENT, amountNano: '0', gasTonNano: '2000000000', payloadBoc: opaquePayload, bounce: false },
        ])
    })

    it('RELAY: raw mesaj adresi TON_ADDRESS_INVALID ile durur, teklif ISTENMEZ', async () => {
        const res = await callHandler(dappSendMessage({
            payWithTonFee: true,
            messages: [{ address: RECIPIENT_RAW, amountNano: '1000000000', payload: null, stateInit: null }],
        }))

        expect(res.success).toBe(false)
        expect(res.error).toBe('TON_ADDRESS_INVALID')
        expect(executeTonViaRelayer).not.toHaveBeenCalled()
        expect(sendSpy).not.toHaveBeenCalled()
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
        expect(res.error).toBe('TON_DAPP_FROM_MISMATCH')
        expect(isKnownTonSendError(res.error), 'kod kullaniciya cevrilmiyor').toBe(true)
        expect(sendSpy).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// B1: onaydan SONRA dapp'in yaniti ARKA PLANA aittir.
//
// Eskiden yanit yalniz onay penceresine donuyordu: yayin hatasi, suresi dolmus
// istek ya da relay hatasi dapp'e HIC ulasmiyor, dapp ancak kullanici pencereyi
// kapatinca 300 aliyordu (islem gitmis olsa bile). Penceresi degistirilen ya da
// SW yeniden basladiktan sonra kalan bir pencere ise yine imzalayip yayinliyordu.
// ---------------------------------------------------------------------------
describe('TON_DAPP_SEND -- B1: dapp yaniti arka planda', () => {
    const BAGLI = { requestId: 'req-1', appRequestId: '7' }
    const pencereyiKapat = (id) => bgListeners.onRemoved.forEach((fn) => fn(id))

    function bekleyenIstek(id = 'req-1', windowId = 5) {
        const dappYaniti = vi.fn()
        dapp.pendingRequests.set(id, { sendResponse: dappYaniti, windowId })
        return dappYaniti
    }

    const tonConnectKarti = () => localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')

    it('requestId artik bekleyen bir istek degilse HICBIR SEY turetilmez/imzalanmaz/yayinlanmaz', async () => {
        const res = await callHandler(dappSendMessage({ requestId: 'yok', appRequestId: '7' }))

        expect(res).toEqual({ success: false, error: 'TON_DAPP_REQUEST_GONE', terminal: true, code: null })
        expect(isKnownTonSendError(res.error), 'kod kullaniciya cevrilmiyor').toBe(true)
        expect(tonIdentityForAccount).not.toHaveBeenCalled()
        expect(sendSpy).not.toHaveBeenCalled()
        expect(executeTonViaRelayer).not.toHaveBeenCalled()
        expect(tonConnectKarti()).toBeUndefined()
    })

    it('basari: BOC dapp e ARKA PLANDAN gider, pencere kapanir; ekran yaniti AYNI sekilde', async () => {
        const dappYaniti = bekleyenIstek()

        const res = await callHandler(dappSendMessage(BAGLI))

        expect(Object.keys(res).sort()).toEqual(['boc', 'success'])
        expect(res.success).toBe(true)
        expect(dappYaniti).toHaveBeenCalledTimes(1)
        expect(dappYaniti).toHaveBeenCalledWith({ result: { result: res.boc, id: '7' } })
        expect(dapp.pendingRequests.has('req-1')).toBe(false)
        expect(chrome.windows.remove).toHaveBeenCalledWith(5)
    })

    it('imza aninda suresi dolmus istek: dapp e kod 1 SONUC olarak; pencere ACIK kalir', async () => {
        const dappYaniti = bekleyenIstek()

        const res = await callHandler(dappSendMessage({ ...BAGLI, validUntil: Math.floor(Date.now() / 1000) - 5 }))

        expect(res).toEqual({ success: false, error: 'TON_DAPP_REQUEST_EXPIRED', terminal: true, code: 1 })
        expect(dappYaniti).toHaveBeenCalledTimes(1)
        expect(dappYaniti).toHaveBeenCalledWith({ result: { error: { code: 1, message: 'Request expired' }, id: '7' } })
        expect(dapp.pendingRequests.get('req-1').answered).toBe(true)
        expect(chrome.windows.remove).not.toHaveBeenCalled()
        expect(sendSpy).not.toHaveBeenCalled()
    })

    it('raw mesaj adresi (imza aninda): kod 1', async () => {
        const dappYaniti = bekleyenIstek()

        const res = await callHandler(dappSendMessage({
            ...BAGLI,
            messages: [{ address: RECIPIENT_RAW, amountNano: '1000000000', payload: null, stateInit: null }],
        }))

        expect(res).toMatchObject({ error: 'TON_ADDRESS_INVALID', terminal: true, code: 1 })
        expect(dappYaniti).toHaveBeenCalledWith({
            result: { error: { code: 1, message: 'Message address must be a valid user-friendly address' }, id: '7' },
        })
    })

    it('yayin (sendFile) dustu: dapp e kod 0, terminal, kart processing; ikinci Onayla IMZALATAMAZ', async () => {
        const dappYaniti = bekleyenIstek()
        sendSpy.mockRejectedValueOnce(new Error('network down'))

        const res = await callHandler(dappSendMessage(BAGLI))

        expect(res).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: true, code: 0 })
        expect(dappYaniti).toHaveBeenCalledWith({
            result: { error: { code: 0, message: 'Sending failed after signing; the transaction may still be processed' }, id: '7' },
        })
        // Pencere "tekrar gonderme" diyor; kart da "gonderilemedi" DEMEMELI.
        await yazmalariBekle()
        expect(tonConnectKarti().status).toBe('processing')

        // Yanitlanmis istek: bu deneme imzalamaz ama ONCEKI deneme yayinlamis
        // olabilir. "Hicbir sey gonderilmedi" diyen GONE degil, ayri BUSY.
        const tekrar = await callHandler(dappSendMessage(BAGLI))
        expect(tekrar).toEqual({ success: false, error: 'TON_DAPP_REQUEST_BUSY', terminal: true, code: null })
        expect(isKnownTonSendError(tekrar.error), 'kod kullaniciya cevrilmiyor').toBe(true)
        expect(sendSpy).toHaveBeenCalledTimes(1)
        expect(dappYaniti).toHaveBeenCalledTimes(1)
    })

    // Dapp'in YENI istegi (ayni hesap) bekleyen-islem kapisina takilir: seqno+1
    // IMZALANMAZ. Ilk mesaj sonradan inseydi IKI transfer de islerdi.
    it('belirsiz yayindan sonra YENI istek TON_TX_ALREADY_PENDING ile durur, ikinci imza YOK', async () => {
        bekleyenIstek('req-1', 5)
        const ikinciDapp = bekleyenIstek('req-2', 6)
        sendSpy.mockRejectedValueOnce(new Error('network down'))

        const ilk = await callHandler(dappSendMessage(BAGLI))
        expect(ilk).toMatchObject({ success: false, terminal: true, code: 0 })
        // Ilk denemenin kart yazmasi insin (gercekte yeni istek saniyeler sonra gelir).
        await yazmalariBekle()

        const ikinci = await callHandler(dappSendMessage({ requestId: 'req-2', appRequestId: '8' }))

        expect(ikinci).toEqual({ success: false, error: 'TON_TX_ALREADY_PENDING', terminal: false, code: null })
        expect(sendSpy).toHaveBeenCalledTimes(1)
        // Yeniden denenebilir: dapp'e yanit yok, kayit acik (bekleyip tekrar dener ya da kapatir).
        expect(ikinciDapp).not.toHaveBeenCalled()
        expect(dapp.isPendingRequestOpen('req-2')).toBe(true)
    })

    it('yeniden denenebilir hata (makbuz kilidi): dapp e yanit YOK, kayit cozulur, pencere kapaninca 4001', async () => {
        const dappYaniti = bekleyenIstek()
        hasUnsettledTonFee.mockReturnValue(true)

        const res = await callHandler(dappSendMessage(BAGLI))

        expect(res).toEqual({ success: false, error: 'TON_RELAY_PENDING_SETTLEMENT', terminal: false, code: null })
        expect(dappYaniti).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.get('req-1').committed).toBe(false)

        pencereyiKapat(5)
        expect(dappYaniti).toHaveBeenCalledWith({ error: { code: 4001, message: 'User closed the window.' } })
    })

    // Kuyruga girmeden (BigInt/depo okumasi) dusen istek de hicbir sey imzalamadi:
    // bag cozulmeli, yoksa Reddet de pencere kapanisi da dapp'e HIC yanit vermez.
    it('kuyruga girmeden dusen istek bagi cozer: pencere kapaninca 4001 gider', async () => {
        const dappYaniti = bekleyenIstek()

        const res = await callHandler(dappSendMessage({ ...BAGLI, messages: 'not-an-array' }))

        expect(res).toMatchObject({ success: false, terminal: false, code: null })
        expect(dapp.isPendingRequestOpen('req-1')).toBe(true)
        pencereyiKapat(5)
        expect(dappYaniti).toHaveBeenCalledWith({ error: { code: 4001, message: 'User closed the window.' } })
    })

    it('yeniden denenebilir hatadan sonra Onayla TEKRAR calisir', async () => {
        const dappYaniti = bekleyenIstek()
        hasUnsettledTonFee.mockReturnValueOnce(true)

        const ilk = await callHandler(dappSendMessage(BAGLI))
        expect(ilk.terminal).toBe(false)

        const ikinci = await callHandler(dappSendMessage(BAGLI))
        expect(ikinci.success).toBe(true)
        expect(dappYaniti).toHaveBeenCalledWith({ result: { result: ikinci.boc, id: '7' } })
    })

    it('gonderim surerken pencere kapanirsa 4001 GITMEZ; BOC sonra dapp e ulasir', async () => {
        const dappYaniti = bekleyenIstek()
        let birak
        sendSpy.mockImplementationOnce(() => new Promise((r) => { birak = r }))

        const p = callHandler(dappSendMessage(BAGLI))
        await vi.waitFor(() => expect(sendSpy).toHaveBeenCalled())
        pencereyiKapat(5)
        expect(dappYaniti).not.toHaveBeenCalled()

        birak()
        const res = await p

        expect(res.success).toBe(true)
        expect(dappYaniti).toHaveBeenCalledTimes(1)
        expect(dappYaniti).toHaveBeenCalledWith({ result: { result: res.boc, id: '7' } })
    })

    it('gonderim surerken pencere kapanir, sonra imzadan ONCE duserse ertelenen 4001 gider', async () => {
        const dappYaniti = bekleyenIstek()
        let birak
        loadAllTonSettlements.mockImplementationOnce(() => new Promise((r) => { birak = r }))
        hasUnsettledTonFee.mockReturnValue(true)

        const p = callHandler(dappSendMessage(BAGLI))
        await vi.waitFor(() => expect(loadAllTonSettlements).toHaveBeenCalled())
        pencereyiKapat(5)
        expect(dappYaniti).not.toHaveBeenCalled()

        birak([])
        const res = await p

        expect(res.terminal).toBe(false)
        expect(dappYaniti).toHaveBeenCalledTimes(1)
        expect(dappYaniti).toHaveBeenCalledWith({ error: { code: 4001, message: 'User closed the window.' } })
        expect(sendSpy).not.toHaveBeenCalled()
    })

    // F4: eylem popup'i AYNI istegi cizebilir; gonderim surerken oradaki Reddet
    // dapp'e 300 vermemeli (islem zincire gidiyor).
    it('gonderim surerken ekranin SEND_TX_SUCCESS(300) yaniti YUTULUR; dapp BOC alir', async () => {
        const dappYaniti = bekleyenIstek()
        let birak
        sendSpy.mockImplementationOnce(() => new Promise((r) => { birak = r }))

        const p = callHandler(dappSendMessage(BAGLI))
        await vi.waitFor(() => expect(sendSpy).toHaveBeenCalled())
        await callHandler({
            type: 'SEND_TX_SUCCESS', requestId: 'req-1', status: 'success',
            data: { result: { error: { code: 300, message: 'User rejected the request' }, id: '7' } },
        })
        expect(dappYaniti).not.toHaveBeenCalled()

        birak()
        const res = await p
        expect(dappYaniti).toHaveBeenCalledTimes(1)
        expect(dappYaniti).toHaveBeenCalledWith({ result: { result: res.boc, id: '7' } })
    })

    it('ayni istek islemdeyken ikinci TON_DAPP_SEND imzalatamaz', async () => {
        bekleyenIstek()
        let birak
        sendSpy.mockImplementationOnce(() => new Promise((r) => { birak = r }))

        const p = callHandler(dappSendMessage(BAGLI))
        await vi.waitFor(() => expect(sendSpy).toHaveBeenCalled())
        const ikinci = await callHandler(dappSendMessage(BAGLI))

        // Ilk deneme tam su an yayinliyor: GONE'un "hicbir sey gonderilmedi"
        // metni yalan olurdu.
        expect(ikinci).toMatchObject({ success: false, error: 'TON_DAPP_REQUEST_BUSY', terminal: true })
        birak()
        await p
        expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    // Sonuc current_request'e de yazilir: bu istegi sonradan acan her TON ekrani
    // (or. eylem popup'i) Onayla ile degil, Kapat-yalniz ve gercek metinle acilir.
    it('terminal hata (kod 0) current_request.answered olarak yazilir', async () => {
        bekleyenIstek()
        localStore.current_request = { type: 'TON_SEND_TX', id: 'req-1' }
        sendSpy.mockRejectedValueOnce(new Error('network down'))

        await callHandler(dappSendMessage(BAGLI))

        expect(localStore.current_request).toEqual({ type: 'TON_SEND_TX', id: 'req-1', answered: { error: 'TON_SEND_FAILED', code: 0 } })
    })

    it('terminal dogrulama hatasi (kod 1) da yazilir', async () => {
        bekleyenIstek()
        localStore.current_request = { type: 'TON_SEND_TX', id: 'req-1' }

        await callHandler(dappSendMessage({ ...BAGLI, validUntil: Math.floor(Date.now() / 1000) - 5 }))

        expect(localStore.current_request.answered).toEqual({ error: 'TON_DAPP_REQUEST_EXPIRED', code: 1 })
    })

    it('yeniden denenebilir hatada sonuc YAZILMAZ (Onayla acik kalir)', async () => {
        bekleyenIstek()
        localStore.current_request = { type: 'TON_SEND_TX', id: 'req-1' }
        hasUnsettledTonFee.mockReturnValue(true)

        await callHandler(dappSendMessage(BAGLI))

        expect(localStore.current_request).toEqual({ type: 'TON_SEND_TX', id: 'req-1' })
    })

    // Kapat-yalniz ekranin cikisi: kayit hala bir pencereye bagliysa
    // current_request o pencerenindir. Durumu yalniz arka plan bilir.
    it('TON_DAPP_REQUEST_STATE kaydin durumunu doner', async () => {
        const durum = () => callHandler({ type: 'TON_DAPP_REQUEST_STATE', requestId: 'req-1' })

        expect(await durum()).toEqual({ state: 'gone' })
        bekleyenIstek()
        expect(await durum()).toEqual({ state: 'open' })
        dapp.commitPendingRequest('req-1')
        expect(await durum()).toEqual({ state: 'committed' })
    })

    it('TON_DAPP_REQUEST_STATE sayfadan gelemez (ic aksiyon)', async () => {
        bekleyenIstek()

        const r = await callHandler({ type: 'TON_DAPP_REQUEST_STATE', requestId: 'req-1' }, { url: 'https://evil.example/', tab: { id: 3 } })

        expect(r).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
    })

    describe('RELAY kolu: sinir, imzali govdenin DISKE inmesi (onSubmit)', () => {
        const RELAY = { payWithTonFee: true, approvedAtsFee: '18400000000000000000' }

        it('onSubmit cagrildiktan sonra relay duserse kod 0', async () => {
            const dappYaniti = bekleyenIstek()
            executeTonViaRelayer.mockImplementationOnce(async (a) => {
                a.onSubmit()
                throw new TonFeeError('ag hatasi', { phase: 'relay' })
            })

            const res = await callHandler(dappSendMessage({ ...BAGLI, ...RELAY }))

            expect(res).toMatchObject({ success: false, terminal: true, code: 0 })
            expect(dappYaniti).toHaveBeenCalledWith({
                result: { error: { code: 0, message: 'Sending failed after signing; the transaction may still be processed' }, id: '7' },
            })
        })

        it('imzadan ONCE duserse (TON_RELAY_UNAVAILABLE) yeniden denenebilir, dapp e yanit YOK', async () => {
            const dappYaniti = bekleyenIstek()
            executeTonViaRelayer.mockImplementationOnce(async () => { throw new TonRelayerError('TON_RELAY_UNAVAILABLE') })

            const res = await callHandler(dappSendMessage({ ...BAGLI, ...RELAY }))

            expect(res).toEqual({ success: false, error: 'TON_RELAY_UNAVAILABLE', terminal: false, code: null })
            expect(dappYaniti).not.toHaveBeenCalled()
            expect(dapp.isPendingRequestOpen('req-1')).toBe(true)
        })

        it('relay BoC donmezse kod 0 ve "BoC unavailable"', async () => {
            const dappYaniti = bekleyenIstek()
            executeTonViaRelayer.mockImplementationOnce(async (a) => {
                a.onSubmit()
                return { status: 'unconfirmed', settlementKey: 'k' }
            })

            const res = await callHandler(dappSendMessage({ ...BAGLI, ...RELAY }))

            expect(res).toEqual({ success: false, error: 'TON_DAPP_RELAY_NO_BOC', terminal: true, code: 0 })
            expect(dappYaniti).toHaveBeenCalledWith({
                result: { error: { code: 0, message: 'Transaction was sent but its BoC is unavailable' }, id: '7' },
            })
        })

        it('onSubmit relay cagrisina GERCEKTEN baglanir (fonksiyon gecer)', async () => {
            bekleyenIstek()
            await callHandler(dappSendMessage({ ...BAGLI, ...RELAY }))
            expect(typeof executeTonViaRelayer.mock.calls[0][0].onSubmit).toBe('function')
        })
    })

    it('requestId YOKSA eski davranis: bekleyen kayitlara dokunulmaz', async () => {
        const dappYaniti = bekleyenIstek()

        const ok = await callHandler(dappSendMessage())
        expect(ok.success).toBe(true)

        sendSpy.mockRejectedValueOnce(new Error('network down'))
        const hata = await callHandler(dappSendMessage())
        expect(hata.success).toBe(false)

        expect(dappYaniti).not.toHaveBeenCalled()
        expect(dapp.isPendingRequestOpen('req-1')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// YAYIN SINIRI, GERCEK zincir yoluyla: @ton/ton TonClient + axios'un fetch
// adaptoru (MV3 service worker'in kullandigi); yalniz global `fetch` sahte.
// Hangi istegin yayindan ONCE geldigini ve hatanin seklini (AxiosError
// response.status) kutuphanenin KENDISI belirler, sahte istemcinin modeli degil.
// ---------------------------------------------------------------------------
describe('TON_DAPP_SEND -- yayin siniri (GERCEK TonClient)', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    const kart = () => localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')
    const json = (status, govde) => new Response(JSON.stringify(govde), { status, headers: { 'content-type': 'application/json' } })
    const hesap = (state) => ({
        balance: '1000000000', state, code: '', data: '',
        last_transaction_id: { '@type': 'internal.transactionId', lt: '0', hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
        block_id: { '@type': 'ton.blockIdExt', workchain: 0, shard: '0', seqno: 1, root_hash: '', file_hash: '' },
        sync_utime: 0,
    })
    const normalYanit = (method) => json(200, {
        ok: true,
        result: method === 'getAddressInformation' ? hesap('active')
            : method === 'runGetMethod' ? { gas_used: 0, exit_code: 0, stack: [['num', '0x0']] }
            : { '@type': 'ok' },
    })

    // Sonraki tonDappSend GERCEK istemciyi alir. yanit(i, method): i. istegin
    // yaniti (Response), firlatilacak hata ya da null (normal yanit).
    function gercekIstemci(yanit = () => null) {
        const istekler = []
        vi.stubGlobal('fetch', async (request) => {
            const { method, params } = JSON.parse(await request.text())
            const i = istekler.push({ method, params }) - 1
            const ozel = yanit(i, method)
            if (ozel instanceof Error) throw ozel
            return ozel ?? normalYanit(method)
        })
        getTonClient.mockImplementationOnce(() => new TonClient({ endpoint: 'https://api.test/ton/rpc', httpAdapter: 'fetch' }))
        return istekler
    }

    // Yayindan ONCEKI her istegin (seqno, isContractDeployed ve wallet.send
    // kullanilsaydi onun ICINDEKI gizli okuma) dususu hicbir sey gondermedi:
    // kart 'error', yanit yeniden denenebilir. Yalniz sendBoc'un kendi dususu
    // belirsizdir. Indeksler kosudan ogrenilir, okuma sayisina baglanmaz.
    it('yayindan (sendBoc) ONCEKI her istegin dususu karti error yazar; yalniz sendBoc dususu belirsiz', async () => {
        let yayinaUlasti = false
        for (let k = 0; k < 10 && !yayinaUlasti; k++) {
            const istekler = gercekIstemci((i) => (i === k ? new TypeError('fetch failed') : null))

            const res = await callHandler(dappSendMessage())
            await yazmalariBekle()

            const dusen = istekler[k]?.method
            if (dusen === 'sendBoc') {
                yayinaUlasti = true
                expect(res).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: true, code: 0 })
                expect(kart().status).toBe('processing')
            } else {
                expect(res, `istek ${k} (${dusen}) yayindan once dustu`).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: false, code: null })
                expect(istekler.map((r) => r.method)).not.toContain('sendBoc')
                expect(kart().status).toBe('error')
            }
        }
        expect(yayinaUlasti, 'sendBoc hic denenmedi').toBe(true)
    })

    // init karari TEK: cuzdan iki okuma arasinda dagitilsa bile (or. bekleyen
    // dagitim indi) yayinlanan mesaj dapp'e donen BOC'un AYNISIDIR.
    it('yayinlanan BOC dapp e donen BOC ile AYNI baytlar (init karari tek)', async () => {
        let okuma = 0
        const istekler = gercekIstemci((i, method) => (method === 'getAddressInformation'
            ? json(200, { ok: true, result: hesap(okuma++ < 2 ? 'uninitialized' : 'active') })
            : null))

        const res = await callHandler(dappSendMessage())

        expect(res.success).toBe(true)
        expect(loadMessage(Cell.fromBase64(res.boc).beginParse()).init).not.toBeNull()
        const yayinlar = istekler.filter((r) => r.method === 'sendBoc')
        expect(yayinlar).toHaveLength(1)
        expect(yayinlar[0].params.boc).toBe(res.boc)
    })

    // 4xx: proxy istegi KENDI katmaninda durdurdu (oran limiti, beyaz liste,
    // govde siniri), toncenter'a hic iletmedi. Gonderilmemis sayilir: kart
    // 'error', kapi acik, ayni islem tekrar imzalanabilir.
    it.each([
        [429, { jsonrpc: '2.0', id: null, error: { code: -32005, message: 'rate limited' } }],
        [403, { jsonrpc: '2.0', id: '1', error: { code: -32600, message: 'method not allowed: sendBoc' } }],
        [413, { error: 'request entity too large' }],
    ])('sendBoc HTTP %i ile REDDEDILIRSE yayin yok: kart error, yeniden denenebilir', async (status, govde) => {
        gercekIstemci((i, method) => (method === 'sendBoc' ? json(status, govde) : null))

        const res = await callHandler(dappSendMessage())

        expect(res).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: false, code: null })
        expect(waitForSeqnoSpy).not.toHaveBeenCalled()
        await yazmalariBekle()
        expect(kart().status).toBe('error')
        expect(kart().meta.errorCode).toBe('TON_SEND_FAILED')

        const istekler = gercekIstemci()
        const tekrar = await callHandler(dappSendMessage())
        expect(tekrar.success).toBe(true)
        expect(istekler.filter((r) => r.method === 'sendBoc')).toHaveLength(1)
    })

    // 5xx: proxy istegi iletmis olabilir (ust akis hatasi 502, ag gecidi 504).
    it.each([502, 504])('sendBoc HTTP %i ile duserse BELIRSIZ: kod 0, kart processing, seqno izlenir', async (status) => {
        gercekIstemci((i, method) => (method === 'sendBoc'
            ? json(status, { jsonrpc: '2.0', id: '1', error: { code: -32603, message: 'ton upstream error' } })
            : null))

        const res = await callHandler(dappSendMessage())

        expect(res).toEqual({ success: false, error: 'TON_SEND_FAILED', terminal: true, code: 0 })
        await yazmalariBekle()
        expect(kart().status).toBe('processing')
        expect(waitForSeqnoSpy).toHaveBeenCalledOnce()
    })
})

// ---------------------------------------------------------------------------
// seqno IZLEYICISININ SONUCU. waitForSeqno `false` (~45 sn'de seqno degismedi)
// ya da hata "basarisiz" DEGILDIR: islem zincire gitmis olabilir. Kart 'error'
// olsaydi bekleyen-islem kapisi acilir, yeni istek seqno+1 imzalar ve ilk mesaj
// sonradan inerse IKI transfer de islerdi.
// ---------------------------------------------------------------------------
describe('TON_DAPP_SEND -- seqno izleyicisi dogrulayamazsa kart processing kalir', () => {
    const kart = () => localStore.current_transactions.find((t) => t.meta?.type === 'TonConnect')

    it.each([
        ['basarili', 'false'],
        ['basarili', 'hata'],
        ['belirsiz', 'false'],
        ['belirsiz', 'hata'],
    ])('%s yayin, izleyici %s: kart processing, yeni istek TON_TX_ALREADY_PENDING', async (yayin, izleyici) => {
        if (yayin === 'belirsiz') sendSpy.mockRejectedValueOnce(new Error('network down'))
        if (izleyici === 'false') waitForSeqnoSpy.mockResolvedValueOnce(false)
        else waitForSeqnoSpy.mockRejectedValueOnce(new Error('rpc down'))

        const ilk = await callHandler(dappSendMessage())
        expect(ilk).toMatchObject(yayin === 'basarili' ? { success: true } : { success: false, terminal: true, code: 0 })

        // Izleyici IMZA anindaki seqno ile, imzalayan cuzdan uzerinde kurulur.
        expect(waitForSeqnoSpy).toHaveBeenCalledOnce()
        expect(waitForSeqnoSpy).toHaveBeenCalledWith(expect.objectContaining({
            previous: 0,
            contract: expect.objectContaining({ getSeqno: expect.any(Function) }),
        }))
        expect(waitForSeqnoSpy.mock.calls[0][0].contract.address.toRawString()).toBe(MAINNET_ADDRESS_RAW)

        await yazmalariBekle()
        expect(kart().status).toBe('processing')
        expect(kart().meta.errorCode).toBeUndefined()

        const ikinci = await callHandler(dappSendMessage())
        expect(ikinci).toEqual({ success: false, error: 'TON_TX_ALREADY_PENDING', terminal: false, code: null })
        expect(sendSpy).toHaveBeenCalledTimes(1)
    })
})
