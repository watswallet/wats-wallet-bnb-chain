// GENEL KISIT: @solana/web3.js'i DOGRUDAN iceren her dosyanin (kaynak VE test)
// ILK import'u bufferGlobal olmak zorunda -- Gorev 26 bunu test dosyasindan
// eksik biraktigi icin bir inceleme turu kaybetti, Gorev 29 de ayni sebeple
// eklemek zorunda kaldi. Bu dosya top-level src/ altinda oldugu icin goreli
// yol './utils/solana/bufferGlobal.js'.
import './utils/solana/bufferGlobal.js'
// Kosum takimi background.solanaSend.test.js'ten BIREBIR alindi: background.js
// bir service worker GIRIS dosyasi, hicbir sey disari vermiyor -- tek ulasma
// yolu chrome API'sini taklit edip kaydettigi onMessage dinleyicisini yakalamak.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js'

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const ORIGIN = 'https://app.jup.ag'
const TEST_MNEMONIC = 'abandon abandon abandon about'
const BLOCKHASH = '11111111111111111111111111111111'

let testKeypair
let wrongKeypair
let DERIVED

beforeAll(async () => {
    const actual = await vi.importActual('./utils/solana/derive')
    testKeypair = await actual.deriveSolanaKeypair(TEST_MNEMONIC, 0)
    wrongKeypair = await actual.deriveSolanaKeypair(TEST_MNEMONIC, 1)
    DERIVED = testKeypair.publicKey.toBase58()
})

let messageListener
let sessionStore
let localStore

const deriveSolanaKeypair = vi.fn()
vi.mock('./utils/solana/derive', () => ({
    deriveSolanaKeypair: (...a) => deriveSolanaKeypair(...a),
    deriveSolanaAddress: vi.fn(async () => ({ address: DERIVED, publicKey: 'ee'.repeat(32) })),
}))

const unlockVault = vi.fn()
vi.mock('./utils/crypto-utils', () => ({
    unlockVault: (...a) => unlockVault(...a),
    decryptSecret: vi.fn(),
}))

const solanaRpc = vi.fn()
vi.mock('./utils/solana/client', () => ({
    solanaRpc: (...a) => solanaRpc(...a),
    SOLANA_API_BASE: 'https://api.test',
}))

vi.mock('./utils/solana/send', () => ({
    prepareTransferContext: vi.fn(),
    broadcastSignedTransaction: vi.fn(),
}))

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
    globalThis.chrome = {
        alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN,
            onConnect: add('onConnect'), onStartup: add('onStartup'),
            onInstalled: add('onInstalled'), onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()), lastError: null,
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, localStore[k]]))),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            session: { get: vi.fn(async () => sessionStore), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
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

function txFor(payer, extraSigner) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = payer.publicKey
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }))
    if (extraSigner) {
        tx.add(SystemProgram.transfer({ fromPubkey: extraSigner.publicKey, toPubkey: payer.publicKey, lamports: 2 }))
        tx.partialSign(extraSigner)
    }
    return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
}

const REQUEST_ID = 'req-1'

// Task-30 incelemesi Bulgu 2: handleSolanaDappSignTx artik onay penceresi
// ACILIRKEN yazilan current_request kaydini GERI OKUYUP requestId/origin/
// transactions uclusunu mesajla karsilastiriyor. Task 31 (onay ekrani) henuz
// yazilmadigindan bu kayit burada ELLE kuruluyor -- ekran gelince onun
// gonderdigi requestId ile AYNI sekle uyacak.
function signTxMsg(inner) {
    localStore.current_request = {
        // C1.5: kilit artik `current_request.type`i de kontrol eder (nihai
        // inceleme -- eski kosul bu alani hic okumuyordu). Bu fixture'in
        // GERCEK openApprovalWindow kaydiyla (handleSolanaSignTransaction)
        // AYNI sekli tasimasi icin `type` burada da yazilir.
        //
        // structuredClone: GERCEK akista current_request storage'a YAZILIR ve
        // gelen dapp mesaji ayri bir runtime.sendMessage tasimasindan
        // GELIR -- ikisi asla ayni bellek referansini PAYLASMAZ. Burada
        // `inner.transactions` referansi dogrudan kopyalanirsa, imzalayan
        // kodun (yanlislikla) `===` referans karsilastirmasi yapan bir hatasi
        // testte SESSIZCE gecerdi (gercekte asla gecmeyecekken).
        type: 'SOLANA_SIGN_TX',
        requestId: REQUEST_ID, id: REQUEST_ID,
        origin: inner.origin, transactions: structuredClone(inner.transactions),
    }
    return { type: 'SOLANA_DAPP_SIGN_TX', message: { ...inner, requestId: REQUEST_ID } }
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc', solanaAddress: DERIVED },
        vaults: [{ id: 'v1', type: 'hd', accounts: [{ key: 'k1', address: '0xabc' }] }],
        solana_dapps: { [ORIGIN]: { address: DERIVED, accountKey: 'k1', cluster: 'solana:mainnet', connectedAt: 1 } },
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
    unlockVault.mockResolvedValue(TEST_MNEMONIC)
    deriveSolanaKeypair.mockResolvedValue(testKeypair)
    solanaRpc.mockResolvedValue({ value: [null] })
})

describe('SOLANA_DAPP_SIGN_TX', () => {
    it('islemi imzalar ve base64 dizileri doner', async () => {
        const msg = signTxMsg({
            mode: 'sign', origin: ORIGIN, chain: 'solana:mainnet',
            transactions: [txFor(testKeypair)],
            account: localStore.active_account, from: DERIVED,
        })
        const res = await callHandler(msg)

        expect(res.success).toBe(true)
        expect(res.signedTransactions).toHaveLength(1)

        const geri = Transaction.from(Buffer.from(res.signedTransactions[0], 'base64'))
        expect(geri.signatures.find((s) => s.publicKey.equals(testKeypair.publicKey)).signature).not.toBeNull()
        expect(geri.verifySignatures()).toBe(true)

        // structuredClone: current_request ve dapp mesaji ayri bellek
        // referanslari tasir (fixture gercek akisi taklit eder).
        expect(localStore.current_request.transactions).not.toBe(msg.message.transactions)
    })

    // §6.2: dapp'e geri donen islemde ORTAK IMZACININ imzasi hayatta kalmali.
    it('ortak imzacinin mevcut imzasi KORUNUR', async () => {
        const ortak = Keypair.generate()
        const base64 = txFor(testKeypair, ortak)
        const oncesi = Transaction.from(Buffer.from(base64, 'base64'))
            .signatures.find((s) => s.publicKey.equals(ortak.publicKey)).signature

        const res = await callHandler(signTxMsg({
            mode: 'sign', origin: ORIGIN, transactions: [base64], account: localStore.active_account, from: DERIVED,
        }))

        const sonrasi = Transaction.from(Buffer.from(res.signedTransactions[0], 'base64'))
            .signatures.find((s) => s.publicKey.equals(ortak.publicKey)).signature
        expect(Buffer.compare(Buffer.from(sonrasi), Buffer.from(oncesi))).toBe(0)
    })

    it('toplu istekte HER islem ayri ayri imzalanir', async () => {
        const res = await callHandler(signTxMsg({
            mode: 'signAll', origin: ORIGIN, transactions: [txFor(testKeypair), txFor(testKeypair)],
            account: localStore.active_account, from: DERIVED,
        }))
        expect(res.signedTransactions).toHaveLength(2)
        for (const b of res.signedTransactions) {
            expect(Transaction.from(Buffer.from(b, 'base64')).verifySignatures()).toBe(true)
        }
    })

    // Bulgu 3 (task-30 incelemesi): all-or-nothing ozelligi INSA GEREGI var
    // (.map icinde bir firlatma butun sonucu iptal eder) ama HICBIR test bunu
    // dogrudan iddia etmiyordu -- flatMap/Promise.allSettled'a gelecekteki bir
    // refactor bunu SESSIZCE kirar, suite yesil kalirdi. Uc islemden UCUNCUSU
    // FARKLI bir imzaci gerektiriyor: ilk ikisi tek basina gecerli olsa bile
    // yanit HICBIR imzali islem TASIMAMALI.
    it('karisik toplu istekte UCUNCU islem farkli imzaci gerektirirse HICBIRI imzalanmaz', async () => {
        const res = await callHandler(signTxMsg({
            mode: 'signAll', origin: ORIGIN,
            transactions: [txFor(testKeypair), txFor(testKeypair, Keypair.generate()), txFor(wrongKeypair)],
            account: localStore.active_account, from: DERIVED,
        }))
        expect(res.success).toBe(false)
        expect(res.error).toBe('SOLANA_NOT_A_SIGNER')
        expect(res.signedTransactions).toBeUndefined()
    })

    // Bulgu 2 (task-30 incelemesi): iki §6.1 kilidi yalnizca KIM imzaladigini
    // zorluyordu, NE imzalandigini degil. Mesajdaki `transactions` onay
    // penceresi acilirken yazilan current_request'ten FARKLIYSA -- kullaniciya
    // GOSTERILEN sey ile imzalanmak istenen sey ayni degildir -- ve hicbir
    // sey imzalanmamalidir.
    it('mesajin transactions dizisi saklanan current_request ile FARKLIYSA reddedilir, hicbir sey imzalanmaz', async () => {
        const gorunen = txFor(testKeypair)
        const baskaBirIslem = txFor(testKeypair, Keypair.generate())
        localStore.current_request = { type: 'SOLANA_SIGN_TX', requestId: REQUEST_ID, id: REQUEST_ID, origin: ORIGIN, transactions: [gorunen] }

        const res = await callHandler({
            type: 'SOLANA_DAPP_SIGN_TX',
            message: {
                mode: 'sign', origin: ORIGIN, transactions: [baskaBirIslem],
                account: localStore.active_account, from: DERIVED, requestId: REQUEST_ID,
            },
        })
        expect(res.success).toBe(false)
        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(res.signedTransactions).toBeUndefined()
    })

    // C1.5 -- nihai inceleme: eski kilit `requestId !== current_request.requestId`
    // seklindeydi -- ikisi de `undefined` gelince (`!==` esitligi tatmin
    // olur) SESSIZCE gecerdi. `!requestId` bu bosluk icin FAIL-CLOSED.
    it('C1.5: requestId hem mesajda hem current_request te undefined ise SOLANA_DAPP_FROM_MISMATCH, anahtar TURETILMEZ', async () => {
        localStore.current_request = { type: 'SOLANA_SIGN_TX', origin: ORIGIN, transactions: [txFor(testKeypair)] }

        const res = await callHandler({
            type: 'SOLANA_DAPP_SIGN_TX',
            message: {
                mode: 'sign', origin: ORIGIN, transactions: [txFor(testKeypair)],
                account: localStore.active_account, from: DERIVED,
            },
        })
        expect(res.success).toBe(false)
        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
    })

    // C1.5 -- eski kilit `current_request.type`i HIC kontrol etmiyordu: diskte
    // bekleyen bir SOLANA_SIGN_MESSAGE kaydi (ayni requestId/origin/transactions
    // ile) bu yolun imzalamasina izin verirdi.
    it('C1.5: current_request.type SOLANA_SIGN_TX DEGILSE (orn. SOLANA_SIGN_MESSAGE) SOLANA_DAPP_FROM_MISMATCH, anahtar TURETILMEZ', async () => {
        const tx = txFor(testKeypair)
        // `requestId` KASITLI OLARAK REQUEST_ID ile ESLESTIRILIR: aksi halde
        // requestId farkliligi TEK BASINA reddi tetikler ve `type` kontrolu
        // testi hicbir sey ISPAT ETMEDEN yesil tutar (F1 -- fix turu 1
        // incelemesi). Burada YALNIZCA `type` alani farklidir.
        localStore.current_request = { type: 'SOLANA_SIGN_MESSAGE', id: 'x', requestId: REQUEST_ID, origin: ORIGIN, transactions: [tx] }

        const res = await callHandler({
            type: 'SOLANA_DAPP_SIGN_TX',
            message: {
                mode: 'sign', origin: ORIGIN, transactions: [tx],
                account: localStore.active_account, from: DERIVED, requestId: REQUEST_ID,
            },
        })
        expect(res.success).toBe(false)
        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
    })

    // §6.1 -- BIRINCI kilit: onay ekraninda gosterilen `from`.
    it('onaylanan from ile turetilen anahtar ayrisirsa SOLANA_DAPP_FROM_MISMATCH', async () => {
        const res = await callHandler(signTxMsg({
            mode: 'sign', origin: ORIGIN, transactions: [txFor(testKeypair)],
            account: localStore.active_account, from: wrongKeypair.publicKey.toBase58(),
        }))
        expect(res.success).toBe(false)
        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
    })

    // §6.1 -- IKINCI kilit: yetkinin GERCEK kaynagi olan oturum kaydi.
    it('solana_dapps kaydindaki adres ayrisirsa SOLANA_DAPP_FROM_MISMATCH', async () => {
        localStore.solana_dapps[ORIGIN].address = wrongKeypair.publicKey.toBase58()
        const res = await callHandler(signTxMsg({
            mode: 'sign', origin: ORIGIN, transactions: [txFor(testKeypair)], account: localStore.active_account, from: DERIVED,
        }))
        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
    })

    it('anahtarimiz imzaci degilse SOLANA_NOT_A_SIGNER', async () => {
        const res = await callHandler(signTxMsg({
            mode: 'sign', origin: ORIGIN, transactions: [txFor(wrongKeypair)], account: localStore.active_account, from: DERIVED,
        }))
        expect(res.error).toBe('SOLANA_NOT_A_SIGNER')
    })

    it('kilitli cuzdanda WALLET_LOCKED', async () => {
        sessionStore = {}
        const res = await callHandler(signTxMsg({
            mode: 'sign', origin: ORIGIN, transactions: [txFor(testKeypair)], account: localStore.active_account, from: DERIVED,
        }))
        expect(res.error).toBe('WALLET_LOCKED')
    })

    // messageGate.js bir RED LISTESIDIR: bu ad INTERNAL_ACTIONS'a yazilmazsa
    // HERHANGI bir sayfa, kullanicinin hic gormedigi bir islemi imzalatabilir.
    it('sayfa kokeninden gelirse FORBIDDEN_ORIGIN ile reddedilir', async () => {
        const res = await callHandler(
            { type: 'SOLANA_DAPP_SIGN_TX', message: { transactions: [] } },
            { url: 'https://kotu.example.com/', origin: 'https://kotu.example.com' },
        )
        expect(res.error).toBe('FORBIDDEN_ORIGIN')
    })

    // DAGITICI KABLOSU. Task 29 `handleSolanaSignTransaction`i yaziyor ama onu
    // dagiticiya BU gorev bagliyor. Kablo olmazsa istek `default` dalina duser
    // ve dapp'e 'Unknown message type' doner: Wallet Standard'in
    // `solana:signTransaction`i de legacy `signTransaction` de coker, ama
    // isleyiciyi DOGRUDAN cagiran birim testleri yesil kalir -- yani bu kilit
    // olmadan bosluk yalnizca tarayicida gorunur.
    it("solana_signTransaction dagiticiya BAGLI (default dalina DUSMEZ)", async () => {
        const res = await callHandler({ method: 'solana_signTransaction', params: [{ transactions: [] }] })
        expect(res).toBeDefined()
        expect(res.error).not.toBe('Unknown message type')
    })
})
