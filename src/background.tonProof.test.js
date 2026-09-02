import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Address, beginCell } from '@ton/core'
import { keyPairFromSeed, sign } from '@ton/crypto'
import { buildTonProofMessage, tonProofSignInput } from './utils/ton/tonProofMessage'
import { buildSignDataInput } from './utils/ton/tonSignDataSchemes'

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

// Sabit tohum: ayni girdi HER ZAMAN ayni imzayi versin, testler deterministik olsun.
const KEY_PAIR = keyPairFromSeed(Buffer.alloc(32, 7))
const TON_ADDRESS = Address.parse('0:' + '11'.repeat(32))

let messageListener
let sessionStore
let localStore

const tonIdentityForAccount = vi.fn()
vi.mock('./utils/ton/tonIdentity', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, tonIdentityForAccount: (...a) => tonIdentityForAccount(...a) }
})

// installChromeStub ve callHandler: background.solanaDerive.test.js'ten AYNEN kopyalandi.
// Kopyalaniyor cunku o dosya bir test dosyasi ve disari bir sey vermiyor; ortak bir
// harness'a cikarmak bu planin kapsami disinda.
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

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        currentNetwork: { chainId: 1, rpc: [{ url: 'https://eth' }] },
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
    tonIdentityForAccount.mockResolvedValue({ keyPair: KEY_PAIR, address: TON_ADDRESS, friendly: 'UQ...' })
})

const proofIstegi = (domain = 'app.dedust.io') => ({
    type: 'TON_DAPP_SIGN',
    message: { mode: 'proof', domain, proofPayload: 'nonce-1' },
})

describe('TON_DAPP_SIGN — proof modu', () => {
    // TIMESTAMP YANITA GIRMELI: dapp imzayi dogrularken AYNI damgayla mesaji
    // yeniden kurar. Donmezse dogrulama HER ZAMAN basarisiz olur ve sebebi
    // hicbir yerde gorunmez.
    it('signature ve timestamp dondurur', async () => {
        const r = await callHandler(proofIstegi())
        expect(r.success).toBe(true)
        expect(typeof r.signature).toBe('string')
        expect(Buffer.from(r.signature, 'base64').length).toBe(64)
        expect(Number.isInteger(r.timestamp)).toBe(true)
    })

    // Ayni girdi FARKLI alan adinda FARKLI imza vermeli. Ayni cikarsa domain
    // imzaya hic girmemis demektir ve bir sitede alinan imza baska bir sitede
    // tekrar kullanilabilir hale gelir.
    it('domain degisince imza DEGISIR', async () => {
        const a = await callHandler(proofIstegi('app.dedust.io'))
        const b = await callHandler(proofIstegi('evil.com'))
        expect(a.signature).not.toBe(b.signature)
    })

    it('proofPayload degisince imza DEGISIR', async () => {
        const a = await callHandler(proofIstegi())
        const b = await callHandler({ type: 'TON_DAPP_SIGN', message: { mode: 'proof', domain: 'app.dedust.io', proofPayload: 'nonce-2' } })
        expect(a.signature).not.toBe(b.signature)
    })

    // Kilitli cuzdanda createTonKeyPair "Wallet locked" atar. Bu hata ACIKCA
    // yanita dusmeli: sessizce yutulursa ekran donar ve kullanici neden
    // imzalanmadigini ogrenemez.
    // FIX ROUND 1 (kontrolor incelemesi): bu test ONCEDEN /lock/i ile eslesiyordu,
    // ki bu YALNIZCA tonDappSign'in HAM Ingilizce "Wallet locked. Please enter
    // your password." dizesini oldugu gibi disari sizdirmasi SAYESINDE geciyordu
    // -- yani assertion, kapatilmasi gereken TAM O bug'i (ekranin ham token
    // gostermesi) YERINDE KILITLIYORDU. Asagidaki degisiklik BILEREK: artik
    // TON_SEND_ERROR_MESSAGES'teki PAYLASILAN Turkce karsiligi dogruluyor
    // (background.js:1902) -- bu satiri /lock/i'ye GERI ALMAYIN, o eski hali
    // kasitli olarak DUZELTILEN davranisi yeniden kirar.
    it('cuzdan kilitliyken hata doner (KULLANICIYA-GOSTERILECEK, ham token DEGIL)', async () => {
        sessionStore = {}
        const r = await callHandler(proofIstegi())
        expect(r.success).toBe(false)
        expect(r.error).toBe('Cuzdan kilitli. Lutfen sifrenizi girin.')
    })

    // MUTASYON KILIDI: proof zinciri CIFT sha256 uygulamali (mesaj -> hash1,
    // tonProofSignInput(hash1) -> hash2, imzalanan hash2). Ustteki testlerin
    // hicbiri BEKLENEN baytlarla imzayi PINLEMIYOR -- yalnizca uzunluk/farklilik
    // kontrol ediyorlar ve TEK hash'e dusen bir mutasyonu da (domain/payload
    // yine digest'e girdigi icin) yakalamazlardi. Bu test beklenen imzayi
    // BIREBIR (@ton/crypto sign ile, ayni CIFT-hash zinciriyle) yeniden
    // uretip karsilastirir.
    it('imza TAM OLARAK mesaj->sha256->tonProofSignInput->sha256 zincirini imzalar', async () => {
        const r = await callHandler(proofIstegi('app.dedust.io'))

        const msg = buildTonProofMessage({
            workchain: TON_ADDRESS.workChain,
            addressHash: new Uint8Array(TON_ADDRESS.hash),
            domain: 'app.dedust.io',
            timestamp: r.timestamp,
            payload: 'nonce-1',
        })
        const msgHash = new Uint8Array(await crypto.subtle.digest('SHA-256', msg))
        const signInput = tonProofSignInput(msgHash)
        const finalDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', signInput))
        const expected = sign(Buffer.from(finalDigest), Buffer.from(KEY_PAIR.secretKey))

        expect(r.signature).toBe(expected.toString('base64'))
    })
})

describe('TON_DAPP_SIGN — signData modu', () => {
    it('text yuku imzalanir', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload: { type: 'text', text: 'Merhaba' } },
        })
        expect(r.success).toBe(true)
        expect(Buffer.from(r.signature, 'base64').length).toBe(64)
    })

    // IKI MOD AYNI GOVDEYI PAYLASMAZ: proof imzasi signData imzasiyla ayni
    // cikarsa, bir modda alinan imza otekinde tekrar kullanilabilir.
    it('ayni baglamda proof ve signData FARKLI imza uretir', async () => {
        const proof = await callHandler(proofIstegi())
        const data = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload: { type: 'text', text: 'nonce-1' } },
        })
        expect(proof.signature).not.toBe(data.signature)
    })

    it('cozulemeyen yuk tipi hata doner', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'a.io', payload: { type: 'uydurma' } },
        })
        expect(r.success).toBe(false)
    })

    // MUTASYON KILIDI (bu gorevin en onemli noktasi): cell tipi ONCEDEN
    // hash'lenmis gelir (`prehashed: true`, tonSignDataSchemes.js basligina
    // bakin) -- TVM'in ozyineli hucre-hash'i duz baytlarin sha256'siyla YENIDEN
    // URETILEMEZ. Handler bu 32 bayti DOGRUDAN imzalamali, UZERINE bir sha256
    // DAHA uygulamamali. Ustteki text/uydurma testleri bu dali HIC
    // egzersiz etmiyor (cell tipi kullanan tek test bu) -- prehashed dalini
    // kaldirip kosulsuz hash'e dusen bir mutasyon, o testler yesil kalirken
    // BURADA yakalanir: kosulsuz hash cell hash'ini TEKRAR sha256'lar ve
    // asagidaki dogrudan-imza beklentisiyle ARTIK eslesmez.
    it('cell yuku CIFT hash OLMADAN, dogrudan TVM hash uzerinden imzalanir', async () => {
        const cellB64 = beginCell().storeUint(0, 32).endCell().toBoc().toString('base64')
        const payload = { type: 'cell', schema: 'transfer#0f8a7ea5', cell: cellB64 }

        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload },
        })
        expect(r.success).toBe(true)

        const built = buildSignDataInput(payload, {
            workchain: TON_ADDRESS.workChain,
            addressHash: new Uint8Array(TON_ADDRESS.hash),
            domain: 'app.dedust.io',
            timestamp: r.timestamp,
        })
        expect(built.ok).toBe(true)
        expect(built.prehashed).toBe(true)

        // Beklenen imza: built.bytes (nihai TVM hash'i) DOGRUDAN imzalanir --
        // araya BASKA bir sha256 girmez.
        const expected = sign(Buffer.from(built.bytes), Buffer.from(KEY_PAIR.secretKey))
        expect(r.signature).toBe(expected.toString('base64'))
    })
})

// KAPSAM GENISLEMESI (kontrolor karari, gorev 13): tonDappSend'de COKTAN VAR
// olan `from` kilidi (bkz. background.tonDappSend.test.js: "imzalayan hesap
// onaylanan from ile uyusmuyorsa") tonDappSign'da HIC YOKTU -- COZULEN adres
// (address) imzaya (addressHash/workChain) DOGRUDAN gomuluyor ve dapp'e
// "address" olarak GERI bildiriliyordu, ama hicbir yer bunu onay ekraninda
// gosterilen `from` ile KARSILASTIRMIYORDU. `from` VERILMEZSE (eski/baska bir
// cagiran) eski davranis KORUNUR -- kosul BUNUN icin var.
describe('TON_DAPP_SIGN — from kilidi (kapsam genislemesi, gorev 13)', () => {
    const dogruFrom = TON_ADDRESS.toRawString()
    const dogruFromFriendly = TON_ADDRESS.toString({ bounceable: false })
    const yanlisFrom = '0:' + '22'.repeat(32)

    it('signData: from dogru adresle eslesirse imza basarili', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload: { type: 'text', text: 'Merhaba' }, from: dogruFrom },
        })
        expect(r.success).toBe(true)
    })

    // Kucuk sertlestirme (tonDappSend'deki AYNI gerekce): from artik
    // Address.parse(...).equals(...) ile karsilastiriliyor, duz dize DEGIL --
    // FRIENDLY (EQ.../UQ...) bicimde gelirse de gonderim REDDEDILMEMELI.
    it('signData: from FRIENDLY (EQ.../UQ...) bicimde gelirse de KABUL edilir', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload: { type: 'text', text: 'Merhaba' }, from: dogruFromFriendly },
        })
        expect(r.success).toBe(true)
    })

    it('signData: from onaylanan adresle uyusmuyorsa GURULTULU reddedilir, imza ATILMAZ', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload: { type: 'text', text: 'Merhaba' }, from: yanlisFrom },
        })
        expect(r.success).toBe(false)
        // tonDappSend'in AYNI kodu (TON_DAPP_FROM_MISMATCH) PAYLASILAN metne
        // cevrilir (TON_SEND_ERROR_MESSAGES) -- ham kod ekrana SIZMAZ.
        expect(r.error).toBe('Imzalayan hesap onaylanan hesapla uyusmuyor. Islem durduruldu.')
    })

    it('signData: from ayristirilamayan bozuk bir deger olursa GURULTULU reddedilir', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload: { type: 'text', text: 'Merhaba' }, from: 'boyle-bir-ton-adresi-yok' },
        })
        expect(r.success).toBe(false)
        expect(r.error).toBe('Imzalayan hesap onaylanan hesapla uyusmuyor. Islem durduruldu.')
    })

    it('signData: from VERILMEZSE eski davranis KORUNUR (geriye donuk uyumluluk)', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'signData', domain: 'app.dedust.io', payload: { type: 'text', text: 'Merhaba' } },
        })
        expect(r.success).toBe(true)
    })

    // Assertion mode'dan BAGIMSIZ, address cozuldukten HEMEN sonra kurulur --
    // yani proof yolunu da ayni korur. TonConnectApprove.vue'nun ton_proof
    // cagrisi da BU YUZDEN `from` gondermeye baslamali (kapsam genislemesi 4).
    it('proof: from onaylanan adresle uyusmuyorsa GURULTULU reddedilir', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'proof', domain: 'app.dedust.io', proofPayload: 'nonce-1', from: yanlisFrom },
        })
        expect(r.success).toBe(false)
        expect(r.error).toBe('Imzalayan hesap onaylanan hesapla uyusmuyor. Islem durduruldu.')
    })

    it('proof: from dogru adresle eslesirse imza basarili', async () => {
        const r = await callHandler({
            type: 'TON_DAPP_SIGN',
            message: { mode: 'proof', domain: 'app.dedust.io', proofPayload: 'nonce-1', from: dogruFrom },
        })
        expect(r.success).toBe(true)
    })
})
