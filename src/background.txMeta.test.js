import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Gecmis kartinin OKUYACAGI meta alanlari - EVM yollari (gonderim, takas, kopru).
 *
 * NEDEN DAVRANIS TESTI, metin testi degil: meta'yi YAZAN satir ile karti BESLEYEN
 * depo arasinda updateTxStatus'un birlestirme kurali duruyor. Kaynak metnini
 * eslemek "alan yazildi" der ama "alan kayitta KALDI" diyemez - bu depoda tam
 * olarak o ayrim onemli (bkz. asagidaki birlestirme testi).
 *
 * background.js bir service worker GIRIS dosyasi: hicbir sey disari vermiyor ve
 * modul kapsaminda chrome.* dinleyicileri kaydediyor. Tek ulasma yolu chrome
 * API'sini taklit edip modulu import etmek. Harness background.evmGates.test.js
 * ile AYNI.
 *
 * HICBIR TEST AGA CIKMAZ: uc yolun da 'queued' yazmasi fonksiyonun GIRISINDE,
 * provider/cuzdan kurulmadan ONCE olur. Kuyruktaki is resolveAccount'ta (vault
 * cozulemez) duser; biz yaniti BEKLEMEDEN deponun kendisini yokluyoruz.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const ETH = 1

// ERC-20 transfer cagri verisi: alici TX.TO DEGIL, cagri verisinin icindedir.
// tx.to token KONTRATIDIR - karta onu yazmak kullaniciya hic gondermedigi bir
// adresi "alici" diye gosterir.
const TOKEN_CONTRACT = '0x2222222222222222222222222222222222222222'
const ERC20_RECIPIENT = '0x1111111111111111111111111111111111111111'
const TRANSFER_DATA = '0xa9059cbb'
    + '000000000000000000000000' + ERC20_RECIPIENT.slice(2)
    + '0000000000000000000000000000000000000000000000000000000000000064'

const NATIVE_RECIPIENT = '0x3333333333333333333333333333333333333333'

// SOZLESME CAGRILARI. `approve` hicbir para TASIMAZ; `transferFrom` ve
// `safeTransferFrom` tasir ama alici IKINCI parametredir, `tx.to` degil.
// Uc kalip da dapp yolundan (Dapp.vue) geliyor ve o yol mesaja alici KOYMUYOR --
// arka plan yalnizca cagri verisini okuyabilir.
const OWNER = '0x4444444444444444444444444444444444444444'
const SPENDER = '0x5555555555555555555555555555555555555555'
const word = (addr) => '000000000000000000000000' + addr.slice(2)

const APPROVE_DATA = '0x095ea7b3' + word(SPENDER)
    + '0000000000000000000000000000000000000000000000000000000000000064'

const TRANSFER_FROM_DATA = '0x23b872dd' + word(OWNER) + word(ERC20_RECIPIENT)
    + '0000000000000000000000000000000000000000000000000000000000000064'

const SAFE_TRANSFER_FROM_DATA = '0x42842e0e' + word(OWNER) + word(ERC20_RECIPIENT)
    + '000000000000000000000000000000000000000000000000000000000000002a'

// Taninmayan bir router cagrisi (swapExactETHForTokens).
const UNKNOWN_CALL_DATA = '0x7ff36ab5'
    + '0000000000000000000000000000000000000000000000000000000000000001'

const USDT = {
    address: TOKEN_CONTRACT,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    image: { large: 'https://cdn.test/usdt-large.png', small: 'https://cdn.test/usdt-small.png' },
}

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

let messageListener
let sessionStore
let localStore

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
        windows: {
            create: vi.fn(async () => ({ id: 1 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })),
            onRemoved: add('onConnect'),
            remove: vi.fn(),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return listeners
}

// Yaniti BEKLEMEZ. Kartin alanlari 'queued' yazmasinda kurulur ve o yazma
// kuyruktan ONCE iner; islemin kendisi (imza/yayin) burada hic ilgilendirmiyor.
function fire(message, sender = { url: EXTENSION_ORIGIN }) {
    messageListener(message, sender, () => {})
}

// Depoyu YOKLAR. updateTxStatus await EDILMEDEN cagriliyor (bilerek, bkz.
// background.js'teki not), bu yuzden sabit sayida microtask beklemek KIRILGAN
// olurdu - kayit gorunene kadar yoklanir.
async function waitForRecord(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const found = (localStore.current_transactions || []).find(predicate)
        if (found) return found
        if (Date.now() > deadline) return null
        await new Promise((r) => setTimeout(r, 5))
    }
}

const byType = (type) => (t) => t?.meta?.type === type

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        currentNetwork: { chainId: ETH },
        current_transactions: [],
        dapps: {},
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

describe('EVM gonderimi: kart token kimligini ve GERCEK aliciyi tasir', () => {
    // Arayuz `assetData` gonderiyor; sendTxInternal `asset` cozuyordu. Ikisi AYNI
    // isim degil, yani token kimligi arka plana HIC ULASMIYORDU.
    it('assetData sembolu/adi/logosu meta ya yazilir', async () => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '100',
                tx: { to: TOKEN_CONTRACT, value: '0x0', data: TRANSFER_DATA },
                assetData: USDT,
                toLabel: null,
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.symbol).toBe('USDT')
        expect(rec.meta.tokenName).toBe('Tether USD')
        // tokenLogo(t, null) ile cozulur: bu depoda `image` bazen NESNE bazen DIZE
        // doner ve `.large` okumak jetton satirlarini gri yer tutucuya dusurur.
        expect(rec.meta.tokenLogo).toBe('https://cdn.test/usdt-large.png')
    })

    // ASIL TUZAK: ERC-20'de tx.to TOKEN KONTRATIDIR. Onu 'recipient' diye yazmak
    // kullaniciya hic para gondermedigi bir adresi alici olarak gosterir.
    it('ERC-20 alicisi CAGRI VERISINDEN cozulur, tx.to DEGIL', async () => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '100',
                tx: { to: TOKEN_CONTRACT, value: '0x0', data: TRANSFER_DATA },
                assetData: USDT,
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.recipient?.toLowerCase()).toBe(ERC20_RECIPIENT)
        expect(rec.meta.recipient?.toLowerCase()).not.toBe(TOKEN_CONTRACT)
    })

    it('native gonderimde alici tx.to dur', async () => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '1',
                tx: { to: NATIVE_RECIPIENT, value: '0xde0b6b3a7640000', data: '0x' },
                assetData: { address: null, symbol: 'ETH', name: 'Ethereum', decimals: 18 },
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.recipient?.toLowerCase()).toBe(NATIVE_RECIPIENT)
        expect(rec.meta.symbol).toBe('ETH')
    })

    // INCELEME BULGUSU (yuksek): `evmRecipient` taninmayan her cagri verisinde
    // `tx.to`ya DUSUYORDU. Dapp yolu mesaja ne token ne alici koydugu icin
    // (Dapp.vue) kartta gorunen TEK sey o adres oluyordu: hicbir para gitmeyen
    // bir `approve` islemi "Gönderim <miktar> → 0x2222…2222" olarak okunuyordu.
    // Adres DOGRULANABILIR bir iddiadir; yanlisi, hic olmayanindan kotudur.
    it.each([
        ['approve', APPROVE_DATA],
        ['taninmayan router cagrisi', UNKNOWN_CALL_DATA],
    ])('%s gibi SOZLESME cagrilarinda alici HIC yazilmaz', async (_ad, data) => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '0',
                tx: { to: TOKEN_CONTRACT, value: '0x0', data },
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect('recipient' in rec.meta, 'sozlesme adresi alici diye yazilmis').toBe(false)
    })

    // transferFrom/safeTransferFrom GERCEKTEN tasir; alici IKINCI parametre.
    it.each([
        ['transferFrom', TRANSFER_FROM_DATA],
        ['safeTransferFrom', SAFE_TRANSFER_FROM_DATA],
    ])('%s alicisi IKINCI parametreden cozulur', async (_ad, data) => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '1',
                tx: { to: TOKEN_CONTRACT, value: '0x0', data },
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.recipient?.toLowerCase()).toBe(ERC20_RECIPIENT)
        expect(rec.meta.recipient?.toLowerCase()).not.toBe(OWNER)
    })

    // Cagri verisi DAPP'TEN geliyor ve dogrulanmis degil: Dapp.vue cozumleyemedigi
    // veriyi HAM haliyle gecirir. Yalniz UZUNLUGA bakmak, kartta uydurma bir
    // "adres" cizdirmeye yetiyordu ('0xzzzz...zzzz').
    it.each([
        ['hex OLMAYAN dolgu', '0xa9059cbb' + '0'.repeat(24) + 'z'.repeat(40) + '0'.repeat(64)],
        ['adres penceresi KISA', '0xa9059cbb' + '0'.repeat(24) + '1'.repeat(20)],
        ['ust 24 karakter SIFIR DEGIL', '0xa9059cbb' + '1'.repeat(24) + '2'.repeat(40) + '0'.repeat(64)],
    ])('%s: alici yazilmaz', async (_ad, data) => {
        fire({
            type: 'SEND_TRANSACTION',
            message: { chainId: ETH, amount: '1', tx: { to: TOKEN_CONTRACT, value: '0x0', data } },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect('recipient' in rec.meta, 'gecersiz cagri verisinden adres uretilmis').toBe(false)
    })

    // Selector'un buyuk harfli yazimi da gecerli hex'tir.
    it('BUYUK harfli selector da cozulur', async () => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH, amount: '1',
                tx: { to: TOKEN_CONTRACT, value: '0x0', data: TRANSFER_DATA.replace('0xa9059cbb', '0xA9059CBB') },
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec.meta.recipient?.toLowerCase()).toBe(ERC20_RECIPIENT)
    })

    // ERC-1155: alici yine IKINCI parametre, dinamik diziler ondan SONRA geliyor.
    it('ERC-1155 safeTransferFrom alicisi cozulur', async () => {
        const data = '0xf242432a' + word(OWNER) + word(ERC20_RECIPIENT) + '0'.repeat(192)
        fire({
            type: 'SEND_TRANSACTION',
            message: { chainId: ETH, amount: '1', tx: { to: TOKEN_CONTRACT, value: '0x0', data } },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec.meta.recipient?.toLowerCase()).toBe(ERC20_RECIPIENT)
    })

    // Adres defterindeki ad, ham adresten cok daha okunur bir satir uretir.
    it('adres defteri etiketi recipientLabel olarak tasinir', async () => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '1',
                tx: { to: NATIVE_RECIPIENT, value: '0xde0b6b3a7640000', data: '0x' },
                assetData: { symbol: 'ETH', name: 'Ethereum' },
                toLabel: 'Ahmet - borsa',
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.recipientLabel).toBe('Ahmet - borsa')
    })

    // BUTUN ALANLAR ISTEGE BAGLI: eski cagiranlar (assetData/toLabel hic
    // gondermeyenler) patlamamali ve kayit yine olusmali.
    it('assetData yoksa kayit YINE olusur, firlatma YOK', async () => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '1',
                tx: { to: NATIVE_RECIPIENT, value: '0x1', data: '0x' },
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.chainId).toBe(ETH)
    })
})

describe('Takas: kart iki tokeni de tanir', () => {
    it('kaynak/hedef sembol ve logo meta ya yazilir', async () => {
        fire({
            type: 'SWAP',
            message: {
                chainId: ETH,
                inTokenAddress: TOKEN_CONTRACT,
                outTokenAddress: '0x4444444444444444444444444444444444444444',
                amount: '25',
                slippage: 1,
                inTokenData: USDT,
                outTokenData: { symbol: 'WETH', name: 'Wrapped Ether', image: 'https://cdn.test/weth.png' },
            },
        })

        const rec = await waitForRecord(byType('Swap'))
        expect(rec).toBeTruthy()
        expect(rec.meta.fromSymbol).toBe('USDT')
        expect(rec.meta.fromLogo).toBe('https://cdn.test/usdt-large.png')
        expect(rec.meta.toSymbol).toBe('WETH')
        // `image` DIZE de olabilir (TON jettonlarinda oyle geliyor) - tokenLogo
        // iki sekli de cozer, `.large` okumak cozmez.
        expect(rec.meta.toLogo).toBe('https://cdn.test/weth.png')
    })

    // KULLANICININ SIKAYETI TAM OLARAK BUYDU: kart "Takas 0.01407177" diyordu,
    // BIRIMSIZ bir sayi. Miktar satiri `meta.symbol`i basar ve takas yolu onu hic
    // yazmiyordu -- VERILEN tokenin sembolu oraya yazilir.
    it('VERILEN tokenin sembolu miktar birimi olarak da yazilir', async () => {
        fire({
            type: 'SWAP',
            message: {
                chainId: ETH, inTokenAddress: TOKEN_CONTRACT, outTokenAddress: 'b',
                amount: '25', slippage: 1,
                inTokenData: USDT,
                outTokenData: { symbol: 'WETH' },
            },
        })

        const rec = await waitForRecord(byType('Swap'))
        expect(rec.meta.symbol).toBe('USDT')
    })

    it('token verisi gelmezse takas kaydi YINE olusur', async () => {
        fire({
            type: 'SWAP',
            message: { chainId: ETH, inTokenAddress: 'a', outTokenAddress: 'b', amount: '1', slippage: 1 },
        })

        const rec = await waitForRecord(byType('Swap'))
        expect(rec).toBeTruthy()
        expect(rec.meta.amount).toBe('1')
    })
})

describe('Kopru: HEDEF AG kimligi kartta', () => {
    // Gercek eksik BUYDU: koprunun hedef agi payload'da HIC YOKTU, yani kart
    // "nereye" sorusunu hicbir zaman cevaplayamiyordu.
    it('toChainId meta ya yazilir', async () => {
        fire({
            type: 'BRIDGE',
            message: {
                chain: ETH,
                toChain: 56,
                to: '0x5555555555555555555555555555555555555555',
                from: TOKEN_CONTRACT,
                data: '0x',
                value: '0',
                amount: 12,
                amount_raw: '12000000',
                fromTokenData: USDT,
            },
        })

        const rec = await waitForRecord(byType('Bridge'))
        expect(rec).toBeTruthy()
        expect(rec.meta.toChainId).toBe(56)
        // Miktar satirinin BIRIMI: koprude de "12" degil "12 USDT" yazmali.
        expect(rec.meta.symbol).toBe('USDT')
    })

    // KOPRUDE KART EKSENI AGDIR, token DEGIL (TxIdentityLine.vue). Token
    // sembol/logolarini yazmak, HIC OKUNMAYAN alanlari chrome.storage.local'a
    // kalici olarak sisirmek olurdu: kayitlar kullanici silene kadar duruyor.
    it('okunmayan token sembol/logo alanlari YAZILMAZ', async () => {
        fire({
            type: 'BRIDGE',
            message: {
                chain: ETH, toChain: 56, to: 'r', from: TOKEN_CONTRACT,
                data: '0x', value: '0', amount: 12, amount_raw: '12000000',
                fromTokenData: USDT,
            },
        })

        const rec = await waitForRecord(byType('Bridge'))
        for (const alan of ['fromSymbol', 'fromLogo', 'toSymbol', 'toLogo']) {
            expect(alan in rec.meta, `${alan} yaziliyor ama kart okumuyor`).toBe(false)
        }
    })

    // 'to' ALICI DEGIL: bridge()'te router KONTRATIDIR. Adi karistirilirsa kart
    // kullaniciya router adresini "alici" diye gosterir.
    it('koprude to alani recipient olarak yazilmaz', async () => {
        fire({
            type: 'BRIDGE',
            message: {
                chain: ETH, toChain: 56, to: '0x5555555555555555555555555555555555555555',
                from: TOKEN_CONTRACT, data: '0x', value: '0', amount: 12, amount_raw: '12000000',
            },
        })

        const rec = await waitForRecord(byType('Bridge'))
        expect(rec).toBeTruthy()
        expect(rec.meta.recipient).toBeUndefined()
    })
})

describe('meta BIRLESTIRILIR: sonraki durum yazimlari alanlari SILMEZ', () => {
    // Sozlesmenin tasiyici kolonu. updateTxStatus meta'yi yayarak birlestiriyor,
    // bu yuzden alanlari YALNIZ 'queued' yazmasina eklemek yetiyor. Bu davranis
    // kirilirsa (or. birlestirme yerine atama) kart ilk saniyeden sonra bos kalir
    // ve hicbir birim testi bunu gormezdi.
    it('queued da eklenen alanlar processing/error sonrasi da duruyor', async () => {
        fire({
            type: 'SEND_TRANSACTION',
            message: {
                chainId: ETH,
                amount: '100',
                tx: { to: TOKEN_CONTRACT, value: '0x0', data: TRANSFER_DATA },
                assetData: USDT,
                toLabel: 'Ahmet - borsa',
            },
        })

        // Durum ILERLEMIS olmali: 'queued' disinda bir yazim gerceklesmeden bu
        // test birlestirmeyi degil yalnizca ilk yazimi olcerdi.
        const rec = await waitForRecord((t) => t?.meta?.type === 'Transaction' && t.status !== 'queued')
        expect(rec).toBeTruthy()
        expect(rec.status).not.toBe('queued')
        expect(rec.meta.symbol).toBe('USDT')
        expect(rec.meta.tokenName).toBe('Tether USD')
        expect(rec.meta.tokenLogo).toBe('https://cdn.test/usdt-large.png')
        expect(rec.meta.recipient?.toLowerCase()).toBe(ERC20_RECIPIENT)
        expect(rec.meta.recipientLabel).toBe('Ahmet - borsa')
    })
})

describe('OLU DEGISKEN: sendTxInternal artik assetData okuyor', () => {
    // `const { tx, amount, chainId, asset } = message.message` -- arayuz `asset`
    // diye bir alan HIC gondermiyor (ConfirmTransaction.vue `assetData` yaziyor).
    // Bu baglama her zaman undefined'di; yerinde birakmak bir sonraki okuyucuyu
    // "token verisi zaten geliyor" diye yaniltir.
    it('olu asset baglamasi kaldirilmis', () => {
        const BG = codeOnly(read('./background.js'))
        const start = BG.indexOf('async function sendTxInternal(')
        expect(start).toBeGreaterThan(-1)
        const head = BG.slice(start, BG.indexOf('const txId', start))
        expect(head).not.toMatch(/\basset\b\s*[,}]/)
    })
})
