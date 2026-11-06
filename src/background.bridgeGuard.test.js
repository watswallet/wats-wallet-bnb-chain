import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { BRIDGE_QUOTES_KEY, bridgeQuoteKey } from './utils/bridgeQuoteGuard'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// KOPRU ALICI KORUMASI (gizli-mod cok-ag spec 4.6, P10): getBridgeQuote, bridge, atsBridgeFeeQuote. Ag ve imza
// yollari taklit edilir; kayit mantigi (bridgeQuoteGuard) ve arka plan akisi GERCEKTIR. Cuzdan gercek bir HD
// kasadan (iki genel hesap A, A2 + Gizli Hesap) kurulur: imzaci adresi taklit degil, turetilmis adrestir.
const quoteMock = vi.fn()      // utils/bridge varsayilan ihraci: LI.FI teklifi
const crossMock = vi.fn()      // yerel dal: crossChainSwap
const callsMock = vi.fn()      // buildBridgeCalls (ATS ve gazsiz dallar, ATS ucret teklifi)
const atsExecMock = vi.fn()    // ATS dali: executeAtsTransfer
const atsQuoteMock = vi.fn()   // ATS ucret teklifi: quoteAtsTransfer
const sponsoredMock = vi.fn()  // gazsiz dal: executeSponsored
const bundlerTokenMock = vi.fn() // gazsiz dal: getBundlerToken

vi.mock('./utils/bridge', async (importOriginal) => ({
    ...(await importOriginal()),
    default: (...a) => quoteMock(...a),
    crossChainSwap: (...a) => crossMock(...a),
    buildBridgeCalls: (...a) => callsMock(...a),
}))
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    executeAtsTransfer: (...a) => atsExecMock(...a),
    quoteAtsTransfer: (...a) => atsQuoteMock(...a),
}))
vi.mock('./utils/smartAccount', async (importOriginal) => ({
    ...(await importOriginal()),
    executeSponsored: (...a) => sponsoredMock(...a),
}))
vi.mock('./utils/bundlerAuth', async (importOriginal) => ({
    ...(await importOriginal()),
    getBundlerToken: (...a) => bundlerTokenMock(...a),
}))

const MNEMONIC = 'test test test test test test test test test test test junk'
let A, A2, GIZLI, vault, jwk
beforeAll(async () => {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const hd = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
    const path1 = "m/44'/60'/0'/0/0"
    const path2 = "m/44'/60'/0'/0/1"
    A = { key: 'a-1', name: 'Hesap 1', type: 'hd', index: 0, derivationPath: path1, address: hd.derivePath(path1).address }
    A2 = { key: 'a-2', name: 'Hesap 2', type: 'hd', index: 1, derivationPath: path2, address: hd.derivePath(path2).address }
    vault = await createVault(masterKey, MNEMONIC, A)
    vault.accounts.push(A2)
    GIZLI = derivePrivateAccount(MNEMONIC, vault, { name: 'Gizli Hesap' })
    vault.privateAccount = GIZLI
    jwk = await crypto.subtle.exportKey('jwk', masterKey)
}, 60000)

const NATIVE = '0x0000000000000000000000000000000000000000'
const ROUTER = getAddress('0x' + '5a'.repeat(20))
const SPENDER = getAddress('0x' + '6b'.repeat(20))
const CALLDATA = '0x' + 'ab'.repeat(68)
const YABANCI = getAddress('0x' + '12'.repeat(20))

// LI.FI /quote yanitinin cuzdanin okudugu parcalari. `signer` hem istek sahibi hem alicidir (bridgeQuote
// fromAddress = toAddress = cuzdan adresi gonderir).
function lifiQuote(signer, over = {}) {
    return {
        id: 'q1',
        action: {
            fromChainId: 56, toChainId: 137, fromAddress: signer, toAddress: signer, fromAmount: '1000000000000000000',
            fromToken: { address: NATIVE, decimals: 18, symbol: 'BNB' }, ...over.action,
        },
        estimate: { approvalAddress: SPENDER, toAmount: '990000000000000000', executionDuration: 60, ...over.estimate },
        transactionRequest: { from: signer, to: ROUTER, chainId: 56, data: CALLDATA, value: '0x0', ...over.transactionRequest },
    }
}

const quoteMsg = (over = {}) => ({
    type: 'BRIDGE_QUOTE',
    message: {
        fromChain: 56, toChain: 137, inToken: { address: NATIVE, decimals: 18 }, outToken: { address: NATIVE, decimals: 18 },
        amount: '1', filter: 'CHEAPEST', slippage: 0.5, ...over,
    },
})

let bg
// `signer`: o an aktif hesap. Depodaki gizli mod durumu aktif hesaptan turer (Gizli Hesap aktifse gizli mod).
// `privacyFlag: 'false'` magazadaki bugunku derlemeyi taklit eder (gizlilik ozelligi kapali).
// Gizli Hesap aktifken BRIDGE / BRIDGE_QUOTE / ATS_BRIDGE_FEE_QUOTE kapida PRIVATE_SWAP_BRIDGE_CLOSED ile kesilir (bayraktan bagimsiz); bu dosyanin Gizli satirlari isleyicinin alici korumasini (P10) olcer ve privacyFlag 'false' (kapi yok) ile kurulur.
async function boot(signer = A, { session = {}, privacyFlag } = {}) {
    // privacyFlag 'false' iken arka plan acilista depoda kalan Gizli Hesap'i genel hesaba GERI ALIR (background.js rollbackPrivateAccountOnStart):
    // yalniz ilk istek Gizli hesabi gorur. Bu yuzden genel hesapla acilir, acilis oturduktan SONRA imzaci depoya yazilir (switchTo: olay yok, ikinci geri alma yok).
    const acilis = privacyFlag === 'false' ? A : signer
    bg = await bootBackground({
        privacyFlag,
        localStore: { active_account: acilis, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {} },
        sessionStore: { sessionMasterKeyJwk: jwk, ...session },
    })
    if (acilis !== signer) {
        for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
        switchTo(signer)
    }
}
// Aktif hesabi calisma sirasinda degistirir (kullanici gizli moda gecti / hesap degistirdi).
const switchTo = (account) => { bg.localStore.active_account = structuredClone(account) }

beforeEach(() => {
    for (const m of [quoteMock, crossMock, callsMock, atsExecMock, atsQuoteMock, sponsoredMock, bundlerTokenMock]) m.mockReset()
    // Isleyici hatayi teshis icin console.error'a yazar; test ciktisi temiz kalsin.
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
    teardownBackground()
    vi.restoreAllMocks()
})

const recordsOf = () => bg.sessionStore[BRIDGE_QUOTES_KEY] || {}
const keyOf = (q, chain = 56) => bridgeQuoteKey(chain, q.transactionRequest.to, q.transactionRequest.data, q.transactionRequest.value)

describe('BRIDGE_QUOTE: alici imzaci olmali, gecerli teklif kaydedilir', () => {
    it.each([
        ['genel hesap (normal mod)', () => A, undefined],
        ['genel hesap (gizlilik ozelligi KAPALI: magazadaki derleme)', () => A, 'false'],
        ['Gizli Hesap (gizlilik ozelligi KAPALI: kapi yok, yalniz isleyici)', () => GIZLI, 'false'],
    ])('%s: teklif doner ve { signer, approval } kaydi yazilir', async (_ad, hesap, privacyFlag) => {
        const signer = hesap()
        await boot(signer, { privacyFlag })
        const q = lifiQuote(signer.address)
        quoteMock.mockResolvedValueOnce(q)
        const res = await bg.call(quoteMsg())
        expect(res).toEqual({ success: true, data: q })
        const rec = recordsOf()[keyOf(q)]
        expect(rec).toMatchObject({ signer: signer.address, approval: SPENDER })
        expect(typeof rec.createdAt).toBe('number')
        expect(Object.keys(recordsOf())).toHaveLength(1)
        // Gercek chrome.storage JSON tabanlidir.
        expect(() => JSON.stringify(bg.sessionStore[BRIDGE_QUOTES_KEY])).not.toThrow()
    })

    it('LI.FI cuzdana kucuk harfli adres dondururse de teklif gecer (harf duyarsiz)', async () => {
        await boot(A)
        const q = lifiQuote(A.address.toLowerCase())
        quoteMock.mockResolvedValueOnce(q)
        expect((await bg.call(quoteMsg())).success).toBe(true)
        expect(recordsOf()[keyOf(q)]).toMatchObject({ signer: A.address })
    })

    it('fromAddress yanitta yoksa teklif gecer', async () => {
        await boot(A)
        const q = lifiQuote(A.address)
        delete q.action.fromAddress
        quoteMock.mockResolvedValueOnce(q)
        expect((await bg.call(quoteMsg())).success).toBe(true)
    })

    it.each([
        ['toAddress baska adres', { action: { toAddress: YABANCI } }],
        ['toAddress yok', { action: { toAddress: undefined } }],
        ['fromAddress baska adres (toAddress dogru)', { action: { fromAddress: YABANCI } }],
    ])('%s: teklif arayuze DONMEZ, BRIDGE_RECEIVER_MISMATCH, kayit yazilmaz', async (_ad, over) => {
        await boot(A)
        quoteMock.mockResolvedValueOnce(lifiQuote(A.address, over))
        const res = await bg.call(quoteMsg())
        expect(res).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        expect(res.data).toBeUndefined()
        expect(bg.sessionStore[BRIDGE_QUOTES_KEY]).toBeUndefined()
    })

    it('Gizli Hesap imzaci, teklif genel adrese kurulmus: BRIDGE_RECEIVER_MISMATCH (gizlilik ozelligi KAPALI: kapi yok, isleyici denetimi)', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)
        quoteMock.mockResolvedValueOnce(lifiQuote(A.address))
        expect(await bg.call(quoteMsg())).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        expect(bg.sessionStore[BRIDGE_QUOTES_KEY]).toBeUndefined()
    })

    it('eksik/bozuk LI.FI yaniti (transactionRequest yok, to/data yok): teklif donmez, ham TypeError degil kod doner', async () => {
        await boot(A)
        for (const bozuk of [
            { ...lifiQuote(A.address), transactionRequest: undefined },
            lifiQuote(A.address, { transactionRequest: { to: undefined } }),
            lifiQuote(A.address, { transactionRequest: { data: undefined } }),
            { transactionRequest: lifiQuote(A.address).transactionRequest },
        ]) {
            quoteMock.mockResolvedValueOnce(bozuk)
            expect(await bg.call(quoteMsg()), JSON.stringify(bozuk)).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        }
        expect(bg.sessionStore[BRIDGE_QUOTES_KEY]).toBeUndefined()
    })

    it('LI.FI hatasi kayit yazmaz ve mevcut hata yanitini degistirmez', async () => {
        await boot(A)
        quoteMock.mockRejectedValueOnce(new Error('No price quote was available.'))
        expect(await bg.call(quoteMsg())).toEqual({ success: false, error: 'No price quote was available.' })
        expect(bg.sessionStore[BRIDGE_QUOTES_KEY]).toBeUndefined()
    })

    it('depo yazimi basarisizsa teklif DONMEZ (kaydi olmayan teklif zaten gonderilemez)', async () => {
        await boot(A)
        quoteMock.mockResolvedValueOnce(lifiQuote(A.address))
        bg.chrome.storage.session.set.mockRejectedValueOnce(new Error('depo dolu'))
        expect(await bg.call(quoteMsg())).toEqual({ success: false, error: 'depo dolu' })
    })

    it('mevcut kapilar degismez: Solana kaynak zinciri hala reddedilir, LI.FI cagrilmaz', async () => {
        await boot(A)
        const res = await bg.call(quoteMsg({ fromChain: 'solana-mainnet' }))
        expect(res.success).toBe(false)
        expect(quoteMock).not.toHaveBeenCalled()
    })
})

// --- bridge(): imzadan ONCE ayni kayit aranir -----------------------------------------------------------------

// Arayuzun (Bridge.vue bridge) BRIDGE govdesi. ELLE kopyadir: gercek govdenin kayit anahtariyla uyumu burada degil,
// components/Bridge.recordKey.ssr.test.js'te (gercek Bridge.vue + gercek guard) sabitlenir.
const bridgeMsg = (q, over = {}) => ({
    type: 'BRIDGE',
    message: {
        from: q.action.fromToken.address, to: q.transactionRequest.to, data: q.transactionRequest.data,
        value: q.transactionRequest.value, chain: q.action.fromChainId, amount: 1, amount_raw: q.action.fromAmount,
        toChain: q.action.toChainId, fromTokenData: q.action.fromToken, ...over,
    },
})

// Uc dal ayni mesaj sekliyle, yalniz dal bayraklariyla ayrisir (bridge() icindeki `atsBridge` / `gasToken` kapilari).
const BRANCHES = {
    ats: (q) => ({ atsBridge: true, fromTokenAddress: q.action.fromToken.address, approvalAddress: q.estimate.approvalAddress, atsQuoted: { transferFee: 1, commissionFee: 0 } }),
    gasless: (q) => ({ gasToken: '0x' + '77'.repeat(20), fromTokenAddress: q.action.fromToken.address, bundlerBase: 'https://bundler.test' }),
    native: () => ({}),
}

function mockBranches() {
    callsMock.mockResolvedValue([{ to: ROUTER, value: 0n, data: CALLDATA }])
    atsExecMock.mockResolvedValue({ hash: '0xats', txHash: '0xatstx' })
    bundlerTokenMock.mockResolvedValue('jwt')
    sponsoredMock.mockResolvedValue({ hash: '0xgasless', waitPromise: Promise.resolve({ receipt: { status: 'success', transactionHash: '0xgasless' } }) })
    crossMock.mockResolvedValue({ hash: '0xnative', waitPromise: Promise.resolve({ status: 1 }) })
}
const HASH = { ats: '0xats', gasless: '0xgasless', native: '0xnative' }
// Her dalin KENDI imza/gonderim cagrisi: reddedilen bir bridge'te HICBIRI cagrilmaz.
const noSideEffects = () => {
    for (const m of [crossMock, callsMock, atsExecMock, bundlerTokenMock, sponsoredMock]) expect(m).not.toHaveBeenCalled()
}

// Teklifi `quoter` hesabiyla alir; sonra `signer` hesabina gecilir (mod/hesap degisimi) ve BRIDGE gonderilir.
async function quoteThenBridge({ quoter, signer = quoter, branch, over = {}, quoteOver = {}, privacyFlag }) {
    await boot(quoter, { privacyFlag })
    expect(bg.localStore.active_account.key).toBe(quoter.key)
    mockBranches()
    const q = lifiQuote(quoter.address, quoteOver)
    quoteMock.mockResolvedValueOnce(q)
    expect((await bg.call(quoteMsg())).success).toBe(true)
    if (signer !== quoter) switchTo(signer)
    const res = await bg.call(bridgeMsg(q, { ...BRANCHES[branch](q), ...over }))
    // Son cagrida da beklenen hesap aktif: gec kalan bir acilis geri almasi imzaciyi genel hesaba cevirseydi bu kirilirdi.
    expect(bg.localStore.active_account.key).toBe(signer.key)
    return { q, res }
}

describe('BRIDGE: kayitli teklif, ayni imzaci -> gonderilir (uc dal)', () => {
    it.each(Object.keys(BRANCHES))('%s dali: gecer ve kendi gonderim cagrisini yapar', async (branch) => {
        const { res } = await quoteThenBridge({ quoter: A, branch })
        expect(res).toEqual({ success: true, hash: HASH[branch] })
        const cagri = { ats: atsExecMock, gasless: sponsoredMock, native: crossMock }
        for (const [ad, mock] of Object.entries(cagri)) expect(mock, ad).toHaveBeenCalledTimes(ad === branch ? 1 : 0)
    })

    it.each(Object.keys(BRANCHES))('Gizli Hesap kendi teklifiyle gonderebilir (gizlilik ozelligi KAPALI: kapi yok): %s dali', async (branch) => {
        const { res } = await quoteThenBridge({ quoter: GIZLI, branch, privacyFlag: 'false' })
        expect(res).toEqual({ success: true, hash: HASH[branch] })
    })

    it('harf buyuklugu: to ve data buyuk harfle gelse de ayni kayit bulunur', async () => {
        const { res } = await quoteThenBridge({
            quoter: A, branch: 'native',
            over: { to: ROUTER.toUpperCase().replace('0X', '0x'), data: CALLDATA.toUpperCase().replace('0X', '0x') },
        })
        expect(res).toEqual({ success: true, hash: HASH.native })
    })

    it('ATS dalinda onay adresi mesajda yoksa denetlenmez ve gecer', async () => {
        const { res } = await quoteThenBridge({ quoter: A, branch: 'ats', over: { approvalAddress: undefined } })
        expect(res).toEqual({ success: true, hash: HASH.ats })
    })

    it('ATS dalinda onay adresi harf farkiyla gelirse gecer', async () => {
        const { res } = await quoteThenBridge({ quoter: A, branch: 'ats', over: { approvalAddress: SPENDER.toLowerCase() } })
        expect(res).toEqual({ success: true, hash: HASH.ats })
    })
})

describe('BRIDGE: kayit yok -> BRIDGE_QUOTE_NOT_FOUND, imza/gonderim yok (uc dal)', () => {
    it.each(Object.keys(BRANCHES))('%s dali: hic teklif alinmamis', async (branch) => {
        await boot(A)
        mockBranches()
        const q = lifiQuote(A.address)
        const res = await bg.call(bridgeMsg(q, BRANCHES[branch](q)))
        expect(res).toEqual({ success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' })
        noSideEffects()
    })

    it.each([
        ['to degistirilmis', { to: YABANCI }],
        ['data degistirilmis', { data: CALLDATA + 'ff' }],
        ['value degistirilmis', { value: '0xde0b6b3a7640000' }],
        ['zincir degistirilmis (ayni calldata baska zincirde gecmez)', { chain: 1 }],
    ])('%s: arayuzun teklifteki cagriyi degistirmesi yakalanir', async (_ad, over) => {
        const { res } = await quoteThenBridge({ quoter: A, branch: 'native', over })
        expect(res).toEqual({ success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' })
        noSideEffects()
    })

    it('10 dakikadan eski kayit: BRIDGE_QUOTE_NOT_FOUND; 9 dakikalik kayit gecer', async () => {
        const q = lifiQuote(A.address)
        const kayit = (yasMs) => ({ [BRIDGE_QUOTES_KEY]: { [keyOf(q)]: { signer: A.address, approval: SPENDER, createdAt: Date.now() - yasMs } } })

        await boot(A, { session: kayit(10 * 60 * 1000 + 1000) })
        mockBranches()
        expect(await bg.call(bridgeMsg(q))).toEqual({ success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' })
        noSideEffects()

        await boot(A, { session: kayit(9 * 60 * 1000) })
        mockBranches()
        expect(await bg.call(bridgeMsg(q))).toEqual({ success: true, hash: HASH.native })
    })

    it('depo okunamazsa hata doner ve hicbir dal calismaz (fail-closed)', async () => {
        await boot(A)
        mockBranches()
        const q = lifiQuote(A.address)
        quoteMock.mockResolvedValueOnce(q)
        await bg.call(quoteMsg())
        const get = bg.chrome.storage.session.get
        const gercek = get.getMockImplementation()
        get.mockImplementation(async (k) => (k === BRIDGE_QUOTES_KEY ? Promise.reject(new Error('depo okunamadi')) : gercek(k)))
        expect(await bg.call(bridgeMsg(q))).toEqual({ success: false, error: 'depo okunamadi' })
        noSideEffects()
    })
})

describe('BRIDGE: hesap / gizli mod degisti -> BRIDGE_RECEIVER_MISMATCH (uc dal) (gizlilik ozelligi KAPALI: kapi yok)', () => {
    it.each(Object.keys(BRANCHES))('%s dali: genel hesapla alinan teklif, sonra Gizli Hesaba gecildi', async (branch) => {
        const { res } = await quoteThenBridge({ quoter: A, signer: GIZLI, branch, privacyFlag: 'false' })
        expect(res).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        noSideEffects()
    })

    it.each(Object.keys(BRANCHES))('%s dali: Gizli Hesapla alinan teklif, sonra genel hesaba donuldu', async (branch) => {
        const { res } = await quoteThenBridge({ quoter: GIZLI, signer: A, branch, privacyFlag: 'false' })
        expect(res).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        noSideEffects()
    })

    it('reddedilen bridge islem listesine hata karti olarak duser (queued -> error) ve ham kodu tasir, zincire hicbir sey gitmez', async () => {
        const { res } = await quoteThenBridge({ quoter: A, signer: GIZLI, branch: 'native', privacyFlag: 'false' })
        expect(res.success).toBe(false)
        // bridge() catch'i `updateTxStatus('error')`u BEKLEMEZ: kart yanittan sonra yazilabilir, bu yuzden beklenir
        // (background.txMeta.test.js ayni nedenle waitForRecord kullanir).
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]?.status).toBe('error'))
        const kartlar = bg.localStore.current_transactions
        expect(kartlar).toHaveLength(1)
        // Ham kod errorCode'da degil `meta.error`da durur (txErrorFromException); ekranda cevirisini txErrors.js
        // eslemesi (bridge.quoteStale) verir.
        expect(kartlar[0].meta.error).toBe('BRIDGE_RECEIVER_MISMATCH')
        noSideEffects()
    })
})

describe('BRIDGE: gizlilik ozelligi KAPALI (magazadaki derleme): ayni koruma', () => {
    // Normal mod acigi: iki genel hesap arasinda gecis. Teklif A'nin adresine kurulur, kullanici Hesap 2'ye gecer.
    it.each(Object.keys(BRANCHES))('%s dali: iki genel hesap arasinda gecis sonrasi bayat teklif BRIDGE_RECEIVER_MISMATCH', async (branch) => {
        const { res } = await quoteThenBridge({ quoter: A, signer: A2, branch, privacyFlag: 'false' })
        expect(res).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        noSideEffects()
    })

    it('ayni hesap gecer; kayitsiz teklif BRIDGE_QUOTE_NOT_FOUND', async () => {
        const { res } = await quoteThenBridge({ quoter: A, branch: 'native', privacyFlag: 'false' })
        expect(res).toEqual({ success: true, hash: HASH.native })
        const kayitsiz = lifiQuote(A.address, { transactionRequest: { data: CALLDATA + 'cc' } })
        expect(await bg.call(bridgeMsg(kayitsiz))).toEqual({ success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' })
        expect(crossMock).toHaveBeenCalledTimes(1)
    })
})

describe('BRIDGE: ATS dalinda onay adresi kayittakine bagli', () => {
    it.each([
        ['baska adres', YABANCI],
        ['router adresi (kayitta onay adresi ayri)', ROUTER],
    ])('%s: BRIDGE_RECEIVER_MISMATCH, buildBridgeCalls ve executeAtsTransfer cagrilmaz', async (_ad, approvalAddress) => {
        const { res } = await quoteThenBridge({ quoter: A, branch: 'ats', over: { approvalAddress } })
        expect(res).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        noSideEffects()
    })

    it('kayitta estimate.approvalAddress yoksa onay adresi islemin to adresidir', async () => {
        const quoteOver = { estimate: { approvalAddress: undefined } }
        const ok = await quoteThenBridge({ quoter: A, branch: 'ats', quoteOver, over: { approvalAddress: ROUTER } })
        expect(ok.res).toEqual({ success: true, hash: HASH.ats })

        const kotu = await quoteThenBridge({ quoter: A, branch: 'ats', quoteOver, over: { approvalAddress: SPENDER } })
        expect(kotu.res).toEqual({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
    })
})

// --- atsBridgeFeeQuote: ucret teklifi AYNI kayda baglidir ------------------------------------------------------

// Arayuzun (Bridge.vue refreshAtsOpFee) ATS_BRIDGE_FEE_QUOTE govdesi: teklifin transactionRequest'i ve onay adresi.
// bridgeMsg gibi ELLE kopyadir; gercek govdenin uyumu components/Bridge.recordKey.ssr.test.js'te sabitlenir.
const feeMsg = (q, over = {}) => ({
    type: 'ATS_BRIDGE_FEE_QUOTE',
    message: {
        chainId: q.action.fromChainId, to: q.transactionRequest.to, data: q.transactionRequest.data,
        value: q.transactionRequest.value, fromTokenAddress: q.action.fromToken.address,
        amount_raw: q.action.fromAmount, approvalAddress: q.estimate.approvalAddress, ...over,
    },
})

async function quoteThenFee({ quoter, signer = quoter, over = {}, privacyFlag }) {
    await boot(quoter, { privacyFlag })
    expect(bg.localStore.active_account.key).toBe(quoter.key)
    callsMock.mockResolvedValue([{ to: ROUTER, value: 0n, data: CALLDATA }])
    atsQuoteMock.mockResolvedValue({ transferFee: '0.5', symbol: 'ATS', ready: true, opCount: 1 })
    const q = lifiQuote(quoter.address)
    quoteMock.mockResolvedValueOnce(q)
    expect((await bg.call(quoteMsg())).success).toBe(true)
    if (signer !== quoter) switchTo(signer)
    const res = await bg.call(feeMsg(q, over))
    // Son cagrida da beklenen hesap aktif: gec kalan bir acilis geri almasi imzaciyi genel hesaba cevirseydi bu kirilirdi.
    expect(bg.localStore.active_account.key).toBe(signer.key)
    return { q, res }
}

describe('ATS_BRIDGE_FEE_QUOTE: ayni alici korumasi', () => {
    it.each([
        ['genel hesap', () => A, undefined],
        ['genel hesap (gizlilik ozelligi KAPALI: magazadaki derleme)', () => A, 'false'],
        ['Gizli Hesap (gizlilik ozelligi KAPALI: kapi yok, yalniz isleyici)', () => GIZLI, 'false'],
    ])('%s: kayitli teklif icin ucret teklifi doner', async (_ad, hesap, privacyFlag) => {
        const { res } = await quoteThenFee({ quoter: hesap(), privacyFlag })
        expect(res).toMatchObject({ success: true, transferFee: '0.5', symbol: 'ATS' })
        expect(callsMock).toHaveBeenCalledTimes(1)
        expect(atsQuoteMock).toHaveBeenCalledTimes(1)
    })

    it('kayit yok (hic teklif alinmamis): BRIDGE_QUOTE_NOT_FOUND, bundler teklifine gidilmez', async () => {
        await boot(A)
        callsMock.mockResolvedValue([])
        const res = await bg.call(feeMsg(lifiQuote(A.address)))
        expect(res).toMatchObject({ success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' })
        expect(callsMock).not.toHaveBeenCalled()
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    it.each([
        ['genel -> Gizli (gizlilik ozelligi KAPALI)', () => A, () => GIZLI, 'false'],
        ['Gizli -> genel (gizlilik ozelligi KAPALI)', () => GIZLI, () => A, 'false'],
        ['genel -> genel (gizlilik ozelligi KAPALI)', () => A, () => A2, 'false'],
    ])('hesap/mod degisti (%s): BRIDGE_RECEIVER_MISMATCH, bundler teklifine gidilmez', async (_ad, quoter, signer, privacyFlag) => {
        const { res } = await quoteThenFee({ quoter: quoter(), signer: signer(), privacyFlag })
        expect(res).toMatchObject({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        expect(callsMock).not.toHaveBeenCalled()
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    it('onay adresi kayittakinden farkliysa BRIDGE_RECEIVER_MISMATCH; mesajda yoksa gecer', async () => {
        const kotu = await quoteThenFee({ quoter: A, over: { approvalAddress: YABANCI } })
        expect(kotu.res).toMatchObject({ success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        expect(atsQuoteMock).not.toHaveBeenCalled()

        const yok = await quoteThenFee({ quoter: A, over: { approvalAddress: undefined } })
        expect(yok.res.success).toBe(true)
    })

    it('arayuz cagriyi degistirirse (to/data/value) kayit bulunamaz', async () => {
        for (const over of [{ to: YABANCI }, { data: CALLDATA + 'ff' }, { value: '0x1' }]) {
            const { res } = await quoteThenFee({ quoter: A, over })
            expect(res, JSON.stringify(over)).toMatchObject({ success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' })
        }
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    // bridge() blogundaki 10 dk / 9 dk ve depo okuma hatasi testlerinin ucret yolu karsiliklari: atsBridgeFeeQuote guard'in
    // AYRI bir cagri yeridir ve kapali-basarisiz olmasi incelenen ozelliktir (guard'i try/catch ile sarmak bu ikisini kirar).
    it('10 dakikadan eski kayit: BRIDGE_QUOTE_NOT_FOUND ve bundler teklifine gidilmez; 9 dakikalik kayit gecer', async () => {
        const q = lifiQuote(A.address)
        const kayit = (yasMs) => ({ [BRIDGE_QUOTES_KEY]: { [keyOf(q)]: { signer: A.address, approval: SPENDER, createdAt: Date.now() - yasMs } } })
        const hazirla = () => {
            callsMock.mockResolvedValue([{ to: ROUTER, value: 0n, data: CALLDATA }])
            atsQuoteMock.mockResolvedValue({ transferFee: '0.5', symbol: 'ATS', ready: true, opCount: 1 })
        }

        await boot(A, { session: kayit(10 * 60 * 1000 + 1000) })
        hazirla()
        expect(await bg.call(feeMsg(q))).toMatchObject({ success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' })
        expect(callsMock).not.toHaveBeenCalled()
        expect(atsQuoteMock).not.toHaveBeenCalled()

        await boot(A, { session: kayit(9 * 60 * 1000) })
        hazirla()
        expect(await bg.call(feeMsg(q))).toMatchObject({ success: true, transferFee: '0.5', symbol: 'ATS' })
        expect(callsMock).toHaveBeenCalledTimes(1)
        expect(atsQuoteMock).toHaveBeenCalledTimes(1)
    })

    it('depo okunamazsa hata doner ve ne buildBridgeCalls ne quoteAtsTransfer calisir (fail-closed)', async () => {
        await boot(A)
        callsMock.mockResolvedValue([{ to: ROUTER, value: 0n, data: CALLDATA }])
        atsQuoteMock.mockResolvedValue({ transferFee: '0.5', symbol: 'ATS', ready: true, opCount: 1 })
        const q = lifiQuote(A.address)
        quoteMock.mockResolvedValueOnce(q)
        // Gecerli kayit VAR: ucret yolunu durduran tek sey depo okuma hatasidir (hatayi yutan bir sarmalayici akisi surdururdu).
        expect((await bg.call(quoteMsg())).success).toBe(true)
        const get = bg.chrome.storage.session.get
        const gercek = get.getMockImplementation()
        get.mockImplementation(async (k) => (k === BRIDGE_QUOTES_KEY ? Promise.reject(new Error('depo okunamadi')) : gercek(k)))
        expect(await bg.call(feeMsg(q))).toMatchObject({ success: false, error: 'depo okunamadi' })
        expect(callsMock).not.toHaveBeenCalled()
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    it('ATS zinciri olmayan zincirde mevcut erken donus degismez (bundler zaten kullanilmaz)', async () => {
        await boot(A)
        const res = await bg.call(feeMsg(lifiQuote(A.address), { chainId: 43114 }))
        expect(res).toEqual({ success: false, error: 'ATS not enabled for chain' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })
})
