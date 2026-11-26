// GENEL KISIT: @solana/web3.js'i DOGRUDAN iceren her dosyanin (kaynak VE test)
// ILK import'u bufferGlobal olmak zorunda.
import './solana/bufferGlobal.js'

// final E-d -- Solana signAndSend: bekleyen dapp istegine BAG (TON'daki
// commitPendingRequest / releasePendingRequest / answerPendingRequest deseninin
// BIREBIR tasinmasi).
//
// Sorun: yayin surerken kullanici onay penceresini kapatirsa onRemoved dapp'e
// 4001 "User closed the window." gonderiyordu; islem ise zincire gidiyordu. Dapp
// "reddetti" gorup yeniden isterse ayni odeme IKI KEZ yapilabilirdi.
//
// Bu dosya GERCEK dappFunctions.js (kayit defteri + onRemoved dinleyicisi) ve
// GERCEK solanaDappFunctions.js kapisini (handleSolanaSignAndSend ->
// openApprovalWindow) kullanir; yalniz RPC, kasa ve turetme katmanlari mocklanir.
// Boylece kayit sekli ve yasam dongusu uretimdeki ile AYNIDIR.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'

const ORIGIN = 'https://app.example.com'
const ALICI = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const BLOCKHASH = 'GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W'
const TEST_MNEMONIC = 'abandon abandon abandon about'
const WINDOW_ID = 7
const SENDER = { origin: ORIGIN, frameId: 0, tab: { favIconUrl: ORIGIN + '/favicon.ico' } }
const POPUP = { url: 'chrome-extension://wats/src/popup/index.html' }

let testKeypair
let DERIVED
let realOwnSignatureBytes

beforeAll(async () => {
    const actual = await vi.importActual('./solana/derive')
    testKeypair = await actual.deriveSolanaKeypair(TEST_MNEMONIC, 0)
    DERIVED = testKeypair.publicKey.toBase58()
    realOwnSignatureBytes = (await vi.importActual('./solana/signAndSendPolicy')).ownSignatureBytes
})

const deriveSolanaKeypair = vi.fn()
vi.mock('./solana/derive', () => ({
    deriveSolanaKeypair: (...a) => deriveSolanaKeypair(...a),
    deriveSolanaAddress: vi.fn(),
}))

const unlockVault = vi.fn()
vi.mock('./crypto-utils', () => ({ unlockVault: (...a) => unlockVault(...a), decryptSecret: vi.fn() }))

const broadcastSignedTransaction = vi.fn()
vi.mock('./solana/send', () => ({
    broadcastSignedTransaction: (...a) => broadcastSignedTransaction(...a),
    prepareTransferContext: vi.fn(),
}))

const solanaRpc = vi.fn()
vi.mock('./solana/client', () => ({ solanaRpc: (...a) => solanaRpc(...a), SOLANA_API_BASE: 'https://api.test' }))

const ownSignatureBytes = vi.fn()
vi.mock('./solana/signAndSendPolicy', async () => {
    const actual = await vi.importActual('./solana/signAndSendPolicy')
    return { ...actual, ownSignatureBytes: (...a) => ownSignatureBytes(...a) }
})

let localStore
let sessionStore
let onRemovedListener
let dapp
let sol

function txBase64() {
    const tx = new Transaction()
    tx.feePayer = new PublicKey(DERIVED)
    tx.recentBlockhash = BLOCKHASH
    tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(DERIVED), toPubkey: new PublicKey(ALICI), lamports: 1000 }))
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
}

function installChromeStub() {
    onRemovedListener = null
    globalThis.chrome = {
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p, onMessage: { addListener: () => {} }, lastError: null },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { delete localStore[k] }),
            },
            session: { get: vi.fn(async () => sessionStore), set: vi.fn(async () => {}) },
        },
        windows: {
            create: vi.fn(async () => ({ id: WINDOW_ID })),
            getLastFocused: vi.fn(async () => ({ id: 1, left: 0, top: 0, width: 1000 })),
            remove: vi.fn(async () => {}),
            get: vi.fn(async () => ({ id: WINDOW_ID })),
            // Modulun KENDI pencere-kapanma dinleyicisi (dappFunctions.js modul kapsaminda
            // kaydeder); testler kullanicinin X'e basmasini bununla taklit eder.
            onRemoved: { addListener: (fn) => { onRemovedListener = fn } },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}) },
    }
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        solana_dapps: {
            [ORIGIN]: { address: DERIVED, publicKey: 'ee'.repeat(32), accountKey: 'k1', cluster: 'solana:mainnet', appMeta: { name: 'Example' }, connectedAt: 1 },
        },
        vaults: [{ id: 'v1', type: 'hd', accounts: [{ key: 'k1', type: 'hd', index: 0 }] }],
        active_account: { key: 'k1', type: 'hd', index: 0 },
    }

    installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    unlockVault.mockResolvedValue(TEST_MNEMONIC)
    deriveSolanaKeypair.mockResolvedValue(testKeypair)
    solanaRpc.mockResolvedValue({ value: true })
    broadcastSignedTransaction.mockResolvedValue('SIG_FROM_RPC')
    ownSignatureBytes.mockImplementation((...a) => realOwnSignatureBytes(...a))

    sol = await import('./solanaDappFunctions.js')
    dapp = await import('./dappFunctions.js')
})

afterEach(() => { delete globalThis.chrome })

/** Gercek kapi: dapp istegi -> pencere acilir -> bekleyen kayit kurulur. */
async function dappIstegi() {
    const dappYaniti = vi.fn()
    sol.handleSolanaSignAndSend(
        { params: [{ transaction: txBase64(), account: DERIVED, chain: 'solana:mainnet', options: { skipPreflight: false } }] },
        SENDER,
        dappYaniti,
    )
    await vi.waitFor(() => {
        expect(localStore.current_request?.requestId).toBeTruthy()
        expect(chrome.windows.create).toHaveBeenCalled()
        expect(dapp.pendingRequestState(localStore.current_request.requestId)).toBe('open')
    })
    return { dappYaniti, requestId: localStore.current_request.requestId }
}

/** Onay penceresinden gelen "Onayla": SOLANA_DAPP_SIGN_TX (signAndSend). */
function onayla(requestId) {
    return new Promise((resolve) => {
        sol.handleSolanaDappSignTx({ type: 'SOLANA_DAPP_SIGN_TX', requestId, mode: 'signAndSend' }, POPUP, resolve)
    })
}

/** Elle cozulen/reddedilen asili bir vaat (yayin ya da RPC yanitini bekletmek icin). */
function askida() {
    let coz
    let reddet
    const p = new Promise((res, rej) => { coz = res; reddet = rej })
    return { p, coz, reddet }
}

describe('Solana signAndSend: bekleyen istege bag (final E-d)', () => {
    it('yayin SURERKEN pencere kapanirsa dapp a 4001 GITMEZ; yayin sonucu (imza) dapp a iletilir', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        const yayin = askida()
        broadcastSignedTransaction.mockReturnValueOnce(yayin.p)

        const sonuc = onayla(requestId)
        await vi.waitFor(() => expect(broadcastSignedTransaction).toHaveBeenCalledOnce())
        // Imzalamadan hemen once bag kuruldu.
        expect(dapp.pendingRequestState(requestId)).toBe('committed')

        // Kullanici X'e basar.
        onRemovedListener(WINDOW_ID)
        expect(dappYaniti).not.toHaveBeenCalled()
        expect(dapp.pendingRequestState(requestId)).toBe('committed')

        yayin.coz('SIG_FROM_RPC')
        const res = await sonuc

        const tx = Transaction.from(Buffer.from(broadcastSignedTransaction.mock.calls[0][0], 'base64'))
        const imza = bs58.encode(tx.signature)
        expect(res.result.signature).toBe(imza)
        // Dapp'e TAM BIR yanit gider ve o yanit imzadir (4001 degil).
        expect(dappYaniti).toHaveBeenCalledOnce()
        expect(dappYaniti.mock.calls[0][0]).toEqual({
            result: { signature: imza, signatureBytes: res.result.signatureBytes },
        })
        expect(dapp.pendingRequestState(requestId)).toBe('gone')
    })

    it('BELIRSIZ yayinda pencere kapanirsa dapp imza + broadcastStatusUnknown alir (4001 DEGIL)', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        const yayin = askida()
        broadcastSignedTransaction.mockReturnValueOnce(yayin.p)

        const sonuc = onayla(requestId)
        await vi.waitFor(() => expect(broadcastSignedTransaction).toHaveBeenCalledOnce())
        onRemovedListener(WINDOW_ID)

        yayin.reddet(new Error('SOLANA_RPC_TIMEOUT'))
        const res = await sonuc

        expect(res.result.broadcastStatusUnknown).toBe(true)
        expect(dappYaniti).toHaveBeenCalledOnce()
        expect(dappYaniti.mock.calls[0][0]).toEqual({
            result: {
                signature: res.result.signature,
                signatureBytes: res.result.signatureBytes,
                broadcastStatusUnknown: true,
                broadcastError: 'SOLANA_RPC_TIMEOUT',
            },
        })
    })

    it('KESIN red (zincire gitmedi) + pencere yayin sirasinda kapandi: bag cozulur, dapp a 4001 simdi gider', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        const yayin = askida()
        broadcastSignedTransaction.mockReturnValueOnce(yayin.p)

        const sonuc = onayla(requestId)
        await vi.waitFor(() => expect(broadcastSignedTransaction).toHaveBeenCalledOnce())
        onRemovedListener(WINDOW_ID)
        expect(dappYaniti).not.toHaveBeenCalled()

        yayin.reddet(new Error('SOLANA_RPC_HTTP_403'))
        const res = await sonuc

        expect(res.error).toBe('SOLANA_RPC_HTTP_403')
        // Hicbir sey zincire gitmedi: dapp'in 4001'i artik DOGRU ve tam bir kez gider.
        expect(dappYaniti).toHaveBeenCalledOnce()
        expect(dappYaniti.mock.calls[0][0]).toEqual({ error: { code: 4001, message: 'User closed the window.' } })
        expect(dapp.pendingRequestState(requestId)).toBe('gone')
    })

    it('KESIN red + pencere ACIK: dapp yanitlanmaz, kayit yeniden denenebilir kalir', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        broadcastSignedTransaction.mockRejectedValueOnce(new Error('SOLANA_RPC_HTTP_403'))

        const ilk = await onayla(requestId)

        expect(ilk.error).toBe('SOLANA_RPC_HTTP_403')
        expect(dappYaniti).not.toHaveBeenCalled()
        expect(dapp.pendingRequestState(requestId)).toBe('open')

        // Ikinci deneme basarili olur ve dapp'e TAM BIR yanit gider.
        const ikinci = await onayla(requestId)
        expect(ikinci.result.signature).toBeTruthy()
        expect(dappYaniti).toHaveBeenCalledOnce()
        expect(dappYaniti.mock.calls[0][0].result.signature).toBe(ikinci.result.signature)
    })

    it('basarili yayin, pencere ACIK: dapp yaniti ARKA PLANDAN gider ve pencere kapatilir', async () => {
        const { dappYaniti, requestId } = await dappIstegi()

        const res = await onayla(requestId)

        expect(dappYaniti).toHaveBeenCalledOnce()
        expect(dappYaniti.mock.calls[0][0]).toEqual({ result: { signature: res.result.signature, signatureBytes: res.result.signatureBytes } })
        expect(dapp.pendingRequestState(requestId)).toBe('gone')
        expect(chrome.windows.remove).toHaveBeenCalledWith(WINDOW_ID)
        expect(localStore.current_request).toBeUndefined()
    })

    it('yayin suruyorken ikinci onay: yayin YAPILMAZ (commit false)', async () => {
        const { requestId } = await dappIstegi()
        const yayin = askida()
        broadcastSignedTransaction.mockReturnValueOnce(yayin.p)

        const birinci = onayla(requestId)
        await vi.waitFor(() => expect(broadcastSignedTransaction).toHaveBeenCalledOnce())

        const ikinci = await onayla(requestId)

        expect(ikinci.error).toBeTruthy()
        expect(ikinci.result).toBeUndefined()
        expect(broadcastSignedTransaction).toHaveBeenCalledOnce()

        yayin.coz('SIG_FROM_RPC')
        const res = await birinci
        expect(res.result.signature).toBeTruthy()
    })

    // SW yeniden basladi / istek degistirildi / pencere kapandi: diskte current_request
    // kalmis olabilir ama bekleyen kayit YOKTUR. Bayat onay yayin YAPMAZ.
    it('bekleyen kayit yoksa (SW yeniden basladi) hicbir sey turetilmez, imzalanmaz, yayinlanmaz', async () => {
        const { requestId } = await dappIstegi()
        dapp.pendingRequests.delete(requestId)

        const res = await onayla(requestId)

        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(res.result).toBeUndefined()
        expect(unlockVault).not.toHaveBeenCalled()
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    it('imza ONCESI (blockhash kontrolu surerken) pencere kapanirsa: dapp 4001 alir, yayin YAPILMAZ', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        const rpc = askida()
        solanaRpc.mockReturnValueOnce(rpc.p)

        const sonuc = onayla(requestId)
        await vi.waitFor(() => expect(solanaRpc).toHaveBeenCalled())
        // Henuz imzalanmadi: bag YOK, kapanis normal 4001 verir.
        expect(dapp.pendingRequestState(requestId)).toBe('open')
        onRemovedListener(WINDOW_ID)
        expect(dappYaniti).toHaveBeenCalledOnce()
        expect(dappYaniti.mock.calls[0][0]).toEqual({ error: { code: 4001, message: 'User closed the window.' } })

        rpc.coz({ value: true })
        const res = await sonuc

        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
        expect(dappYaniti).toHaveBeenCalledOnce()
    })

    it('yayin ONCESI hata (bayat blockhash): bag KURULMAZ, kayit acik kalir', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        solanaRpc.mockResolvedValue({ value: false })

        const res = await onayla(requestId)

        expect(res.error).toBe('SOLANA_BLOCKHASH_EXPIRED')
        expect(dapp.pendingRequestState(requestId)).toBe('open')
        expect(dappYaniti).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    it('imzadan SONRA yayin oncesi dusme (ownSignatureBytes null): bag cozulur, yayin YOK', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        ownSignatureBytes.mockReturnValueOnce(null)

        const res = await onayla(requestId)

        expect(res.error).toBe('SOLANA_SEND_FAILED')
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
        // Bag cozuldu: kullanici yeniden dener ya da reddeder.
        expect(dapp.pendingRequestState(requestId)).toBe('open')
        expect(dappYaniti).not.toHaveBeenCalled()
    })

    it('imzalama sirasinda beklenmeyen istisna: bag cozulur (kayit asili kalmaz)', async () => {
        const { dappYaniti, requestId } = await dappIstegi()
        ownSignatureBytes.mockImplementationOnce(() => { throw new Error('BEKLENMEYEN') })

        const res = await onayla(requestId)

        expect(res.error).toBe('BEKLENMEYEN')
        expect(dapp.pendingRequestState(requestId)).toBe('open')
        expect(dappYaniti).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // signTransaction ve signMessage DEGISMEZ: onlarin onay yolu bagi KURMAZ.
    it('mode sign (signTransaction): bekleyen kayit dokunulmaz, dapp yaniti ekrandan gelir', async () => {
        const dappYaniti = vi.fn()
        sol.handleSolanaSignTransaction(
            { params: [{ transactions: [txBase64()], account: DERIVED, chain: 'solana:mainnet' }] },
            SENDER,
            dappYaniti,
        )
        await vi.waitFor(() => {
            expect(localStore.current_request?.requestId).toBeTruthy()
            expect(dapp.pendingRequestState(localStore.current_request.requestId)).toBe('open')
        })
        const requestId = localStore.current_request.requestId

        const res = await new Promise((resolve) => {
            sol.handleSolanaDappSignTx({
                type: 'SOLANA_DAPP_SIGN_TX', requestId, mode: 'sign',
                message: {
                    mode: 'sign', origin: ORIGIN, chain: 'solana:mainnet', transactions: localStore.current_request.transactions,
                    from: DERIVED, requestId,
                },
            }, POPUP, resolve)
        })

        expect(res.success).toBe(true)
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
        // Arka plan dapp'i YANITLAMAZ: sign yolunda yaniti ekranin SEND_TX_SUCCESS'i verir.
        expect(dappYaniti).not.toHaveBeenCalled()
        expect(dapp.pendingRequestState(requestId)).toBe('open')
    })
})
