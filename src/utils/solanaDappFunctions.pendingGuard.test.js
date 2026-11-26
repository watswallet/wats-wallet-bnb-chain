// client/src/utils/solanaDappFunctions.pendingGuard.test.js
//
// KOK NEDEN (V3-1, Task 3 duzeltme turu 1): EVM imza yolunda iki koruma var (N7):
// (2) origin basina onay-penceresi kisiti (-32005) ve (3) bekleyen IMZA istegini
// hibesiz FARKLI origin'in ezememesi (-32002). Solana imza/giris isleyicilerinde ikisi
// de yoktu: oturum istemeyen `solana_signIn` ile baska origin'in bekleyen onay
// penceresi DEGISTI ile kapatilabiliyor (kullanicinin altindan onay ekrani degisir)
// ve pencere spam'i serbestti. Bu dosya Solana imza yolunun EVM ile PARITESINI kilitler.
// GENEL KISIT: @solana/web3.js'i DOGRUDAN iceren her dosyanin ILK import'u bufferGlobal olmak zorunda.
import './solana/bufferGlobal.js'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

const ADRES = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'
const senderOf = (origin) => ({ origin, frameId: 0, tab: { id: 3, favIconUrl: origin + '/f.ico' } })
const oturum = () => ({
    address: ADRES, publicKey: '07'.repeat(32), accountKey: 'k1',
    cluster: 'solana:mainnet', appMeta: { name: 'Dapp' }, connectedAt: 1,
})
const MESAJ_B64 = btoa('merhaba dunya')

function kurChrome(local = {}) {
    const store = {
        solana_dapps: { [ORIGIN_A]: oturum() },
        vaults: [{ id: 'v1', type: 'hd', accounts: [{ key: 'k1', address: '0xabc', type: 'hd', index: 0 }] }],
        active_account: { key: 'k1', type: 'hd', index: 0, solanaAddress: ADRES },
        ...local,
    }
    const sayac = { get: 0 }
    const acilanPencereler = []
    const kapatilanPencereler = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    sayac.get += 1
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => { Object.assign(store, obj) },
                remove: async (k) => { delete store[k] },
            },
            session: { get: async () => ({}) },
        },
        windows: {
            create: async (o) => { acilanPencereler.push(o); return { id: acilanPencereler.length } },
            remove: async (id) => { kapatilanPencereler.push(id) },
            get: async () => ({}),
            getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
            onRemoved: { addListener: () => {} },
        },
        tabs: { sendMessage: async () => {} },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return { store, sayac, acilanPencereler, kapatilanPencereler }
}

const bekle = () => new Promise((r) => setTimeout(r, 5))
const RATE = { error: { code: -32005, message: 'Rate limited' } }
const PENDING = { error: { code: -32002, message: 'Request already pending' } }
const imzaMesaji = () => ({ method: 'solana_signMessage', params: [{ message: MESAJ_B64, account: ADRES }] })

beforeEach(() => {
    vi.resetModules()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
})
afterEach(() => { delete globalThis.chrome })

describe('V3-1 (2): Solana imza isleyicilerinde origin basina pencere kisiti (-32005)', () => {
    const CASES = [
        ['handleSolanaSignMessage', imzaMesaji],
        ['handleSolanaSignIn', () => ({ method: 'solana_signIn', params: [{ input: { statement: 'Giris' } }] })],
        ['handleSolanaSignTransaction', () => ({ method: 'solana_signTransaction', params: [{ account: ADRES, transaction: 'AAAA' }] })],
        ['handleSolanaSignAndSend', () => ({ method: 'solana_signAndSendTransaction', params: [{ account: ADRES, transaction: 'AAAA' }] })],
    ]
    for (const [ad, msg] of CASES) {
        it(`${ad}: 4. cagri -32005 alir; depoya HIC dokunulmaz ve pencere acilmaz`, async () => {
            const { sayac, acilanPencereler } = kurChrome()
            const mod = await import('./solanaDappFunctions.js')
            for (let i = 0; i < 3; i++) {
                mod[ad](msg(), senderOf(ORIGIN_A), () => {})
                await bekle()
            }
            const getOnce = sayac.get
            const pencereOnce = acilanPencereler.length
            const yanit = vi.fn()
            mod[ad](msg(), senderOf(ORIGIN_A), yanit)
            await bekle()
            expect(yanit).toHaveBeenCalledWith(RATE)
            expect(sayac.get).toBe(getOnce)
            expect(acilanPencereler.length).toBe(pencereOnce)
        })
    }

    it('kisit origin basinadir: A dolsa da B ayni isleyicide kisitlanmaz', async () => {
        kurChrome()
        const mod = await import('./solanaDappFunctions.js')
        for (let i = 0; i < 4; i++) { mod.handleSolanaSignMessage(imzaMesaji(), senderOf(ORIGIN_A), () => {}); await bekle() }
        const yanitB = vi.fn()
        mod.handleSolanaSignMessage(imzaMesaji(), senderOf(ORIGIN_B), yanitB)
        await bekle()
        expect(yanitB).not.toHaveBeenCalledWith(RATE)
    })

    it('handleSolanaConnect KISITLANMAZ (EVM connect ile parite: yalniz imza/gonderim)', async () => {
        kurChrome({ solana_dapps: {} })
        const mod = await import('./solanaDappFunctions.js')
        const yanitlar = []
        for (let i = 0; i < 5; i++) {
            await mod.handleSolanaConnect({ method: 'solana_connect', params: [{}] }, senderOf(ORIGIN_A), (r) => yanitlar.push(r))
            await bekle()
        }
        expect(yanitlar.some((y) => y?.error?.code === -32005)).toBe(false)
    })
})

describe('V3-1 (3): bekleyen Solana IMZA istegini hibesiz FARKLI origin ezemez (-32002)', () => {
    async function aBekliyor() {
        const env = kurChrome({ solana_dapps: { [ORIGIN_A]: oturum() } })
        const mod = await import('./solanaDappFunctions.js')
        const yanitA = vi.fn()
        mod.handleSolanaSignMessage(imzaMesaji(), senderOf(ORIGIN_A), yanitA)
        await bekle()
        expect(env.acilanPencereler.length).toBe(1)
        expect(env.store.current_request.type).toBe('SOLANA_SIGN_MESSAGE')
        return { ...env, mod, yanitA, idA: env.store.current_request.id }
    }

    it('oturumsuz B signIn: -32002; A penceresi ve kaydi YASAR, A DEGISTI almaz', async () => {
        const { mod, yanitA, idA, store, acilanPencereler, kapatilanPencereler } = await aBekliyor()
        const yanitB = vi.fn()
        mod.handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: { statement: 'Giris' } }] }, senderOf(ORIGIN_B), yanitB)
        await bekle()
        expect(yanitB).toHaveBeenCalledWith(PENDING)
        expect(acilanPencereler.length).toBe(1)
        expect(kapatilanPencereler).toEqual([])
        expect(yanitA).not.toHaveBeenCalled()
        expect(store.current_request.id).toBe(idA)
    })

    it('oturumsuz B signMessage zaten 4100 alir (pencere yok); A yasar', async () => {
        const { mod, yanitA, acilanPencereler } = await aBekliyor()
        const yanitB = vi.fn()
        mod.handleSolanaSignMessage(imzaMesaji(), senderOf(ORIGIN_B), yanitB)
        await bekle()
        expect(yanitB.mock.calls[0][0].error.code).toBe(4100)
        expect(acilanPencereler.length).toBe(1)
        expect(yanitA).not.toHaveBeenCalled()
    })

    it('Solana oturumu OLAN B (hibeli) bekleyen A istegini ezer (EVM hibeli-origin davranisi ile parite)', async () => {
        const env = kurChrome({ solana_dapps: { [ORIGIN_A]: oturum(), [ORIGIN_B]: oturum() } })
        const mod = await import('./solanaDappFunctions.js')
        const yanitA = vi.fn()
        mod.handleSolanaSignMessage(imzaMesaji(), senderOf(ORIGIN_A), yanitA)
        await bekle()
        const yanitB = vi.fn()
        mod.handleSolanaSignMessage(imzaMesaji(), senderOf(ORIGIN_B), yanitB)
        await bekle()
        expect(env.acilanPencereler.length).toBe(2)
        expect(yanitA).toHaveBeenCalledTimes(1)
        expect(yanitA.mock.calls[0][0].error).toBeDefined()
        expect(env.store.current_request.origin).toBe(ORIGIN_B)
    })

    it('AYNI origin yenisi eskisini ezer (degismeyen davranis)', async () => {
        const { mod, yanitA, acilanPencereler, store } = await aBekliyor()
        mod.handleSolanaSignMessage(imzaMesaji(), senderOf(ORIGIN_A), vi.fn())
        await bekle()
        expect(acilanPencereler.length).toBe(2)
        expect(yanitA).toHaveBeenCalledTimes(1)
        expect(store.current_request.origin).toBe(ORIGIN_A)
    })

    it('bekleyen Solana imzasi hibesiz baska origin istegini de korur: B Solana CONNECT -32002 alir', async () => {
        const { mod, yanitA, acilanPencereler } = await aBekliyor()
        const yanitB = vi.fn()
        await mod.handleSolanaConnect({ method: 'solana_connect', params: [{}] }, senderOf(ORIGIN_B), yanitB)
        await bekle()
        expect(yanitB).toHaveBeenCalledWith(PENDING)
        expect(acilanPencereler.length).toBe(1)
        expect(yanitA).not.toHaveBeenCalled()
    })
})

// final test-kalitesi-3: V3-1 korumasinin (dappFunctions.js PROTECTED_SIGN_TYPES +
// blockedByPendingSign + hasSolanaGrant/hasEvmGrant) iki acigi testsizdi:
//   1) SOLANA_SIGN_TX tipi (signTransaction + signAndSend bekleyen penceresi) HICBIR testte
//      bekleyen kayit olarak kurulmuyordu; tip kumeden dusse test kirmizi olmazdi.
//   2) Hibe izolasyonu: EVM hibesi Solana imzasini yetkilendirmez (ve tersi), depo okuma
//      hatasi "hibe yok" sayilir (kapali-basarisiz). Kosul `!(evm||solana)`'ya gevsetilse ya
//      da catch `true` dondurse, "altindan onay ekrani degistirme" saldirisi yalniz hibeli
//      bir origin icin yeniden acilirdi.
describe('final test-kalitesi-3: SOLANA_SIGN_TX bekleyen kaydi ve hibe izolasyonu', () => {
    const BLOCKHASH = '11111111111111111111111111111111'
    const ALICI = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const EVM_ADRES = '0xAbCdEf0000000000000000000000000000000001'

    // Gercek, tek imzali (oturum adresi imzaci) SystemProgram.transfer islemi.
    const islemB64 = () => {
        const tx = new Transaction()
        tx.feePayer = new PublicKey(ADRES)
        tx.recentBlockhash = BLOCKHASH
        tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(ADRES), toPubkey: new PublicKey(ALICI), lamports: 1000 }))
        return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
    }

    // Bekleyen kaydin TIPI basina A'nin istegi (gercek isleyiciler, gercek kayit).
    const BEKLEYENLER = [
        ['SOLANA_SIGN_MESSAGE (signMessage)', 'SOLANA_SIGN_MESSAGE', 'handleSolanaSignMessage', imzaMesaji],
        ['SOLANA_SIGN_TX (signTransaction)', 'SOLANA_SIGN_TX', 'handleSolanaSignTransaction',
            () => ({ method: 'solana_signTransaction', params: [{ account: ADRES, transactions: [islemB64()] }] })],
        ['SOLANA_SIGN_TX (signAndSend)', 'SOLANA_SIGN_TX', 'handleSolanaSignAndSend',
            () => ({ method: 'solana_signAndSendTransaction', params: [{ account: ADRES, transaction: islemB64() }] })],
    ]

    async function aBekliyor(tip, isleyici, mesaj, local = {}) {
        const env = kurChrome({ solana_dapps: { [ORIGIN_A]: oturum() }, ...local })
        const mod = await import('./solanaDappFunctions.js')
        const dapp = await import('./dappFunctions.js')
        const yanitA = vi.fn()
        mod[isleyici](mesaj(), senderOf(ORIGIN_A), yanitA)
        await vi.waitFor(() => expect(env.acilanPencereler.length).toBe(1))
        await vi.waitFor(() => expect(env.store.current_request?.type).toBe(tip))
        expect(yanitA).not.toHaveBeenCalled()
        return { ...env, mod, dapp, yanitA, idA: env.store.current_request.id }
    }

    // (a) Hibesiz B'nin signIn / connect istegi: -32002; A penceresi ve current_request YASAR.
    const B_ISTEKLERI = [
        ['signIn', (mod, yanit) => mod.handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: { statement: 'Giris' } }] }, senderOf(ORIGIN_B), yanit)],
        ['connect', (mod, yanit) => mod.handleSolanaConnect({ method: 'solana_connect', params: [{}] }, senderOf(ORIGIN_B), yanit)],
    ]
    for (const [bekleyenAd, tip, isleyici, mesaj] of BEKLEYENLER) {
        for (const [bAd, bIstek] of B_ISTEKLERI) {
            it(`(a) bekleyen ${bekleyenAd}: hibesiz B ${bAd} -> -32002, A penceresi ve kaydi YASAR`, async () => {
                const { mod, yanitA, idA, store, acilanPencereler, kapatilanPencereler } = await aBekliyor(tip, isleyici, mesaj)
                const yanitB = vi.fn()
                bIstek(mod, yanitB)
                await bekle()
                expect(yanitB).toHaveBeenCalledWith(PENDING)
                expect(acilanPencereler.length).toBe(1)
                expect(kapatilanPencereler).toEqual([])
                expect(yanitA).not.toHaveBeenCalled()
                expect(store.current_request.id).toBe(idA)
            })
        }
    }

    // (b) EVM hibesi Solana imzasini yetkilendirmez: B'nin yalniz EVM hibesi (dapps[b.example]) var.
    for (const [bekleyenAd, tip, isleyici, mesaj] of BEKLEYENLER) {
        it(`(b) bekleyen ${bekleyenAd}: yalniz EVM hibeli B'nin Solana signIn istegi -> -32002`, async () => {
            const { mod, yanitA, idA, store, acilanPencereler, kapatilanPencereler } = await aBekliyor(
                tip, isleyici, mesaj, { dapps: { 'b.example': { accounts: [EVM_ADRES], chainId: '0x1' } } },
            )
            const yanitB = vi.fn()
            mod.handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: { statement: 'Giris' } }] }, senderOf(ORIGIN_B), yanitB)
            await bekle()
            expect(yanitB).toHaveBeenCalledWith(PENDING)
            expect(acilanPencereler.length).toBe(1)
            expect(kapatilanPencereler).toEqual([])
            expect(yanitA).not.toHaveBeenCalled()
            expect(store.current_request.id).toBe(idA)
        })
    }

    // (c) Solana oturumu EVM istegini yetkilendirmez: B'nin yalniz Solana oturumu (solana_dapps[B]) var,
    // EVM eth_requestAccounts istegi gonderiyor.
    for (const [bekleyenAd, tip, isleyici, mesaj] of BEKLEYENLER) {
        it(`(c) bekleyen ${bekleyenAd}: yalniz Solana oturumlu B'nin EVM eth_requestAccounts istegi -> -32002`, async () => {
            const { dapp, yanitA, idA, store, acilanPencereler, kapatilanPencereler } = await aBekliyor(
                tip, isleyici, mesaj, { solana_dapps: { [ORIGIN_A]: oturum(), [ORIGIN_B]: oturum() } },
            )
            const yanitB = vi.fn()
            await dapp.handleConnectWallet({ method: 'eth_requestAccounts' }, senderOf(ORIGIN_B), yanitB)
            await bekle()
            expect(yanitB).toHaveBeenCalledWith(PENDING)
            expect(acilanPencereler.length).toBe(1)
            expect(kapatilanPencereler).toEqual([])
            expect(yanitA).not.toHaveBeenCalled()
            expect(store.current_request.id).toBe(idA)
        })
    }

    // (d) Depo okuma hatasi "hibe yok" sayilir (kapali-basarisiz): hem Solana hem EVM gelen istek icin.
    // B'nin kendi kapilari depoyu okuyacagi icin (hata onlari erken keserdi) istek dogrudan
    // openApprovalWindow'a verilir -- korumanin oldugu yer burasi.
    for (const [bekleyenAd, tip, isleyici, mesaj] of BEKLEYENLER) {
        for (const [gelenAd, gelenTip] of [['Solana', 'SOLANA_SIGN_MESSAGE'], ['EVM', 'CONNECT']]) {
            it(`(d) bekleyen ${bekleyenAd}: depo okuma hatasi -> gelen ${gelenAd} istegi -32002 alir, A yasar`, async () => {
                const { dapp, yanitA, idA, store, acilanPencereler, kapatilanPencereler } = await aBekliyor(tip, isleyici, mesaj)
                chrome.storage.local.get = async () => { throw new Error('depo okunamadi') }
                const yanitB = vi.fn()
                await dapp.openApprovalWindow('b-istek-1', yanitB, { type: gelenTip, id: 'b-istek-1', origin: ORIGIN_B })
                expect(yanitB).toHaveBeenCalledWith(PENDING)
                expect(acilanPencereler.length).toBe(1)
                expect(kapatilanPencereler).toEqual([])
                expect(yanitA).not.toHaveBeenCalled()
                expect(store.current_request.id).toBe(idA)
            })
        }
    }

    // (e) final E-d ile birlikte: bekleyen signAndSend ISTEGI IMZALAYIP YAYINLARKEN ('committed')
    // V3-1 korumasi AYNEN gecerlidir ve degistirme 4001 GONDERMEZ (islem zincire giderken yalan olurdu).
    it('(e1) committed bekleyen signAndSend: hibesiz B signIn -> -32002, kayit committed KALIR', async () => {
        const [, tip, isleyici, mesaj] = BEKLEYENLER[2]
        const { mod, dapp, yanitA, idA, store, acilanPencereler, kapatilanPencereler } = await aBekliyor(tip, isleyici, mesaj)
        expect(dapp.commitPendingRequest(idA)).toBe(true)

        const yanitB = vi.fn()
        mod.handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: { statement: 'Giris' } }] }, senderOf(ORIGIN_B), yanitB)
        await bekle()

        expect(yanitB).toHaveBeenCalledWith(PENDING)
        expect(acilanPencereler.length).toBe(1)
        expect(kapatilanPencereler).toEqual([])
        expect(yanitA).not.toHaveBeenCalled()
        expect(dapp.pendingRequestState(idA)).toBe('committed')
        expect(store.current_request.id).toBe(idA)
    })

    it('(e2) committed bekleyen signAndSend: hibeli B yeni pencere acar ama A\'ya 4001 GITMEZ; bag cozulunce gider', async () => {
        const [, tip, isleyici, mesaj] = BEKLEYENLER[2]
        const { mod, dapp, yanitA, idA, acilanPencereler } = await aBekliyor(
            tip, isleyici, mesaj, { solana_dapps: { [ORIGIN_A]: oturum(), [ORIGIN_B]: oturum() } },
        )
        expect(dapp.commitPendingRequest(idA)).toBe(true)

        const yanitB = vi.fn()
        mod.handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: { statement: 'Giris' } }] }, senderOf(ORIGIN_B), yanitB)
        await vi.waitFor(() => expect(acilanPencereler.length).toBe(2))

        // A hala imzaliyor/yayinliyor: DEGISTI 4001'i gitmez, kayit yasar.
        expect(yanitA).not.toHaveBeenCalled()
        expect(dapp.pendingRequestState(idA)).toBe('committed')

        // Yayin kesin reddedilirse bag cozulur ve ertelenen 4001 SIMDI gider.
        dapp.releasePendingRequest(idA)
        expect(yanitA).toHaveBeenCalledTimes(1)
        expect(yanitA).toHaveBeenCalledWith({ error: { code: 4001, message: 'Request replaced by a new one.' } })
        expect(dapp.pendingRequestState(idA)).toBe('gone')
    })

    // Kontrol: B'nin KENDI turunden gecerli hibesi varsa koruma ezmeye izin verir (parite).
    it('kontrol: Solana oturumlu B, bekleyen SOLANA_SIGN_TX istegini Solana signIn ile ezer', async () => {
        const [, tip, isleyici, mesaj] = BEKLEYENLER[1]
        const { mod, yanitA, acilanPencereler, store } = await aBekliyor(
            tip, isleyici, mesaj, { solana_dapps: { [ORIGIN_A]: oturum(), [ORIGIN_B]: oturum() } },
        )
        const yanitB = vi.fn()
        mod.handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: { statement: 'Giris' } }] }, senderOf(ORIGIN_B), yanitB)
        await vi.waitFor(() => expect(acilanPencereler.length).toBe(2))
        expect(yanitB).not.toHaveBeenCalledWith(PENDING)
        expect(yanitA).toHaveBeenCalledTimes(1)
        expect(store.current_request.origin).toBe(ORIGIN_B)
    })
})
