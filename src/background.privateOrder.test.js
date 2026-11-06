import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, JsonRpcProvider, AbiCoder, keccak256, makeError, getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { quoteFixture, baseUsdcQuoteFixture } from './test-utils/silentswapFixtures'
import { usdcTokenOf, nativeTokenOf } from './utils/privacy/deliveryTokens'
import { signWithKey } from './test-utils/realKeySigner'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const execMock = vi.fn()
const reportMock = vi.fn(async () => {})
const atsMock = vi.fn()
// GERCEK yurutucunun (realExec) artik izin okumasi: yurutme anindaki izin RPC okumasi bu sahte uzerinden izlenir (T6).
const allowanceMock = vi.fn(async () => 0n)
const flags = vi.hoisted(() => ({ ats: false, native: true, writerFails: false, onWrite: null }))

vi.mock('@silentswap/sdk', async (importOriginal) => ({
    ...(await importOriginal()),
    createSilentSwapClient: () => ({ quote: vi.fn(), getOrder: vi.fn(), reportDepositTransaction: (...a) => reportMock(...a) }),
}))
vi.mock('./utils/privacy/privateOrderExec', async (importOriginal) => ({
    ...(await importOriginal()),
    executePrivateDeposit: (...a) => execMock(...a),
}))
// ATS bayragi canli sabittir (S2 gecmeden false); testler iki durumu da olcer.
vi.mock('./utils/privacy/silentswapConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ORDER_ATS() { return flags.ats },
    get PRIVATE_DEST_NATIVE() { return flags.native },
}))
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    executeAtsTransfer: (...a) => atsMock(...a),
}))
// Teslim yazicisi GERCEK calisir (kova yazimi sinanir); testler yalniz cagri anini gozler ve hatasini zorlar.
vi.mock('./utils/privacy/deliveredTokenBucket', async (importOriginal) => {
    const real = await importOriginal()
    return {
        ...real,
        addDeliveredTokenToPrivateBucket: async (...a) => {
            flags.onWrite?.()
            if (flags.writerFails) throw new Error('yazici patladi')
            return real.addDeliveredTokenToPrivateBucket(...a)
        },
    }
})

const MNEMONIC = 'test test test test test test test test test test test junk'
const SAYFA = { url: 'https://site.example/', tab: { id: 3, url: 'https://site.example/' } }

let A, GIZLI, vault, jwk, BIR_HANE_FARKLI
beforeAll(async () => {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const path = "m/44'/60'/0'/0/0"
    const addr = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm').derivePath(path).address
    A = { key: 'a-1', name: 'Hesap 1', type: 'hd', index: 0, derivationPath: path, address: addr }
    vault = await createVault(masterKey, MNEMONIC, A)
    GIZLI = derivePrivateAccount(MNEMONIC, vault, { name: 'Gizli Hesap' })
    vault.privateAccount = GIZLI
    jwk = await crypto.subtle.exportKey('jwk', masterKey)
    // GIZLI.address'ten TEK onaltilik hane farkli, kucuk harfli adres: kendine sayilmamali (Gonder).
    { const k = GIZLI.address.toLowerCase(); BIR_HANE_FARKLI = k.slice(0, -1) + (k.endsWith('0') ? '1' : '0') }
}, 60000)

// Sabit bitis: fixture her cagrida "simdi + 600" uretir ve esitlik karsilastirmasini saniye siniri bozar.
const EXPIRES = Math.floor(Date.now() / 1000) + 3600
const ticketOf = () => quoteFixture().ticket
const quoteToGizli = (over = {}) => quoteFixture({ expiresAt: EXPIRES,
    recipient: { chainId: 56, address: GIZLI.address },
    recipients: [{ splitIndex: 0, address: GIZLI.address, chainId: 56, payoutAmount: '25000000000000000000' }],
    inputAddress: A.address,
    ...over,
})
// Teklif kaydi (spec 4.3): outputToken chainId tasir ve deliveryVersion 2'dir; eski `outputAsset` dizgesi kayitta yoktur.
const record = (over = {}) => ({
    createdAt: Date.now(), quote: quoteToGizli(), sourceAccountKey: 'a-1', sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25',
    outputToken: usdcTokenOf(56), deliveryVersion: 2, outputAddress: GIZLI.address, ...over,
})
const FOREIGN = '0x' + '12'.repeat(20)
const USDC_TOKEN = usdcTokenOf(56)
const CAKE = { chainId: 56, address: getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'), symbol: 'CAKE', decimals: 18 }

let bg
async function boot({ rec = record(), orders, unlocked = true, privacyFlag, imported } = {}) {
    bg = await bootBackground({
        privacyFlag,
        localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, ...(orders ? { private_orders: orders } : {}), ...(imported ? { imported_tokens: imported } : {}) },
        sessionStore: { ...(unlocked ? { sessionMasterKeyJwk: jwk } : {}), ...(rec ? { private_quotes: { [ticketOf()]: rec } } : {}) },
    })
}
// GERCEK yurutucu (ATS kolu): ag cagrisi yapan cuzdan/ERC20 parcalari taklit edilir, kayit ve
// hash secimi mantigi gercektir. executeAtsTransfer (atsMock) relay davranisini oynar.
const realExec = async (args) => {
    const { executePrivateDeposit } = await vi.importActual('./utils/privacy/privateOrderExec')
    const wallet = { address: A.address, provider: { getBalance: async () => 10n ** 30n, getNetwork: async () => ({ chainId: 56n }) } }
    return executePrivateDeposit({ ...args, wallet, erc20: () => ({ balanceOf: async () => 10n ** 30n, allowance: (...a) => allowanceMock(...a) }) })
}
const order = (message = {}) => ({ type: 'PRIVATE_ORDER', message: { ticket: ticketOf(), ...message } })

beforeEach(() => {
    execMock.mockReset()
    atsMock.mockReset()
    allowanceMock.mockReset()
    allowanceMock.mockImplementation(async () => 0n)
    reportMock.mockClear()
    flags.ats = false
    flags.native = true
    flags.writerFails = false
    flags.onWrite = null
    // Isleyici ham hatayi teshis icin console.error'a yazar; test ciktisi temiz kalsin.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep'); return { hash: '0xdep', wait: null } })
})
afterEach(async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
    teardownBackground()
    vi.restoreAllMocks()
})

describe('PRIVATE_ORDER on kosullari', () => {
    it('teklif yoksa kapi PRIVATE_UNSUPPORTED (kaynak cozulemez)', async () => {
        await boot({ rec: null })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
    })

    // T24 M7 (c): teklif kaydinin 30 dk ust siniri PRIVATE_ORDER'da da gecerli (yalniz depo duzeyinde degil). Kapi
    // saklanan kaydi okuyamayinca kaynagi cozemez (PRIVATE_UNSUPPORTED); yurutucu cagrilmaz, hicbir sey yazilmaz.
    it('31 dakikalik teklif kaydi: PRIVATE_UNSUPPORTED, yurutucu cagrilmaz, siparis yazilmaz; 29 dakikalik teklif calisir', async () => {
        await boot({ rec: record({ createdAt: Date.now() - 31 * 60 * 1000 }) })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()

        await boot({ rec: record({ createdAt: Date.now() - 29 * 60 * 1000 }) })
        expect(await bg.call(order())).toMatchObject({ success: true, ticket: ticketOf() })
        expect(execMock).toHaveBeenCalledTimes(1)
    })

    it('kapi cikti ve kaynagi SAKLANAN tekliften okur: normal hesap -> yabanci adres engellenir', async () => {
        await boot({ rec: record({ outputAddress: '0x' + '12'.repeat(20) }) })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_TRANSFER_TARGET' })
        expect(execMock).not.toHaveBeenCalled()
    })

    it('ayni ticket icin kayit varsa PRIVATE_ORDER_IN_PROGRESS -- cift yatirma yok', async () => {
        await boot({ orders: [{ ticket: ticketOf(), depositTxHash: '0xh', status: 'AWAITING_DEPOSIT' }] })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(execMock).not.toHaveBeenCalled()
    })

    it('ATS kapaliyken gas=ats PRIVATE_UNSUPPORTED', async () => {
        await boot()
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
    })

    it('bilinmeyen gas degeri PRIVATE_UNSUPPORTED', async () => {
        await boot()
        expect(await bg.call(order({ gas: 'free' }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
    })

    it('kilitli cuzdanda WALLET_LOCKED, kayit yazilmaz', async () => {
        await boot({ unlocked: false })
        const res = await bg.call(order())
        expect(res).toEqual({ success: false, error: 'WALLET_LOCKED' })
        expect(bg.localStore.private_orders).toBeUndefined()
        expect(execMock).not.toHaveBeenCalled()
    })

    it('bayrak kapaliyken PRIVACY_DISABLED, yurutucu cagrilmaz', async () => {
        await boot({ privacyFlag: 'false' })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVACY_DISABLED' })
        expect(execMock).not.toHaveBeenCalled()
    })

    it('web sayfasi kokeni iki bicimde de reddedilir, yurutucu cagrilmaz', async () => {
        await boot()
        const expected = { error: { code: 4100, message: 'Unauthorized' } }
        expect(await bg.call(order(), SAYFA)).toEqual(expected)
        expect(await bg.call({ method: 'PRIVATE_ORDER', params: [{ ticket: ticketOf() }] }, SAYFA)).toEqual(expected)
        expect(execMock).not.toHaveBeenCalled()
    })
})

describe('PRIVATE_ORDER basari yolu', () => {
    it('yatirma yapilir, kayit + alarm + rozet + sunucu bildirimi + cevap', async () => {
        await boot()
        const res = await bg.call(order())
        expect(res).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })

        // Yurutucu SAKLANAN teklifi ve kaynak hesabin cuzdanini alir.
        const args = execMock.mock.calls[0][0]
        expect(args.quote).toEqual(quoteToGizli())
        expect(args.wallet.address).toBe(A.address)
        expect(args.gas).toBe('native')

        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(bg.localStore.private_orders[0]).toMatchObject({
            ticket: ticketOf(), depositTxHash: '0xdep', status: 'AWAITING_DEPOSIT',
            sourceAccountKey: 'a-1', outputAddress: GIZLI.address, accessToken: 'tok-1', sourceChainId: 56, gas: 'native',
        })
        expect(() => JSON.stringify(bg.localStore.private_orders)).not.toThrow()

        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, '0xdep')

        // Islem karti: aktif (Gizli) tarafa yazilir, imzaci hesaba degil.
        await vi.waitFor(() => {
            const card = bg.localStore.current_transactions?.[0]
            expect(card).toMatchObject({ status: 'success', meta: { txHash: '0xdep', chainId: 56, type: 'Transaction' }, accountKey: GIZLI.key })
        })
    })

    it('alarm zaten kuruluysa yeniden kurulmaz (takvim sifirlanmaz)', async () => {
        await boot()
        bg.chrome.alarms.get.mockImplementation(async () => ({ name: 'private_orders' }))
        await bg.call(order())
        expect(bg.chrome.alarms.create).not.toHaveBeenCalledWith('private_orders', expect.anything())
    })

    // P2-GC7-ARGS
    it('mesajdaki yatirma verisi, alici ya da tutar HIC okunmaz', async () => {
        await boot()
        const res = await bg.call(order({ to: '0xevil', data: '0xdead', amount: '1', deposit: { to: '0xevil' } }))
        expect(res.success).toBe(true)
        expect(execMock.mock.calls[0][0].quote).toEqual(quoteToGizli())
        expect(JSON.stringify(execMock.mock.calls[0][0].quote)).not.toContain('0xevil')
    })

    it('yurutucu hata verirse hata koda iner, kayit yazilmaz, kart hata olur', async () => {
        await boot()
        execMock.mockImplementation(async () => { throw new Error('PRIVATE_INSUFFICIENT_GAS') })
        const res = await bg.call(order())
        expect(res).toEqual({ success: false, error: 'PRIVATE_INSUFFICIENT_GAS' })
        expect(bg.localStore.private_orders).toBeUndefined()
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'error', meta: { errorCode: 'INSUFFICIENT_NATIVE' } }))
        // Hata sonrasi ayni ticket yeniden denenebilir (kayit yok, kilit birakildi).
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep'); return { hash: '0xdep', wait: null } })
        expect((await bg.call(order())).success).toBe(true)
    })

    // M7-3: yatirma zincirde, yardimci hatalar cevabi bozamaz.
    it('rozet ve sunucu bildirimi hata verse de cevap BASARI kalir', async () => {
        await boot()
        bg.chrome.action.setBadgeText.mockImplementation(() => { throw new Error('boom') })
        reportMock.mockImplementationOnce(() => undefined)
        const res = await bg.call(order())
        expect(res).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        expect(bg.localStore.private_orders).toHaveLength(1)
    })

    // T7 M7: bildirimin SENKRON firlatmasi ve reddedilmis soz donmesi cevabi bozmaz (yakalanmamis
    // ret vitest'i kirar, yani .catch'in gercekten bagli oldugu da kanitlanir).
    it('reportDepositTransaction senkron firlatirsa cevap BASARI, kayit ve alarm yerinde', async () => {
        await boot()
        reportMock.mockImplementationOnce(() => { throw new Error('rapor senkron patladi') })
        expect(await bg.call(order())).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
    })

    it('reportDepositTransaction reddedilirse cevap BASARI, kayit ve rozet yerinde', async () => {
        await boot()
        reportMock.mockImplementationOnce(async () => { throw new Error('rapor reddedildi') })
        expect(await bg.call(order())).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        await new Promise((r) => setTimeout(r, 10))
        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
    })

    it('yurutucuye saklanan istek beklentileri ve imzalayan cuzdan gider (imza oncesi sabitleme)', async () => {
        await boot()
        await bg.call(order())
        const args = execMock.mock.calls[0][0]
        // Beklenti SAKLANAN kayittaki outputToken'dan gelir (chainId dahil, K4).
        expect(args.expected).toEqual({ sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25', outputToken: USDC_TOKEN, outputAddress: GIZLI.address })
        expect(args.wallet.address).toBe(args.quote.inputAddress)
    })

    it('Gonder: secilen token (CAKE) kaydi: yurutucuye outputToken CAKE gider, siparis ozeti CAKE sembol/ondalikla yazilir', async () => {
        const CAKE_DEST = { kind: 'evm', chainId: 56, assetId: CAKE.address, assetSymbol: 'CAKE', assetDecimals: 18, minDestAmount: '6000000000000000000', expectedDestAmount: '6500000000000000000' }
        // K6: sunucu yankisi secimle celisir (SAHTE / 6), assetId CAKE kalir; ozetteki CAKE / 18 saklanan secimden gelir.
        // Gonder'de alici dis adrestir, teslim varligi serbesttir; Para yukle'de CAKE teslimi 1.10 teslim degismezi geregi reddedilir (asagidaki test).
        await boot({ rec: record({
            sourceAccountKey: GIZLI.key, outputAddress: FOREIGN, outputToken: CAKE,
            quote: quoteToGizli({
                dest: { ...CAKE_DEST, assetSymbol: 'SAHTE', assetDecimals: 6 }, inputAddress: GIZLI.address,
                recipient: { chainId: 56, address: FOREIGN },
                recipients: [{ splitIndex: 0, address: FOREIGN, chainId: 56, payoutAmount: '25000000000000000000' }],
            }),
        }) })
        const res = await bg.call(order())
        expect(res.success).toBe(true)
        expect(execMock.mock.calls[0][0].expected.outputToken).toEqual(CAKE)
        expect(bg.localStore.private_orders[0].summary.dest).toEqual({ chainId: 56, asset: 'CAKE', decimals: 18, expectedDestAmount: '6500000000000000000', minDestAmount: '6000000000000000000', quoteUsd: null })
        expect(bg.localStore.private_orders[0].deliveryVersion).toBe(2)
    })

    // 1.10 teslim degismezi siparis aninda da: Para yukle'de Gonder kaynagi olmayan varlik (CAKE, BSC ATS) Gizli Hesap'a teslim edilemez; yerel coin ve
    // Gonder kaynagi varliklari (USDC, BNB) edilir. Yurutucuye, cuzdana, siparis kaydina varmadan reddedilir.
    it('Para yukle: Gonder kaynagi olmayan varlik (CAKE) teslim kaydi PRIVATE_UNSUPPORTED; yurutucu cagrilmaz, siparis yazilmaz', async () => {
        const CAKE_DEST = { kind: 'evm', chainId: 56, assetId: CAKE.address, assetSymbol: 'CAKE', assetDecimals: 18, minDestAmount: '6000000000000000000', expectedDestAmount: '6500000000000000000' }
        await boot({ rec: record({ outputToken: CAKE, quote: quoteToGizli({ dest: CAKE_DEST }) }) })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
    })

    it('bozuk outputToken kaydi: PRIVATE_UNSUPPORTED, yurutucu cagrilmaz, siparis yazilmaz', async () => {
        await boot({ rec: record({ outputToken: { ...CAKE, decimals: 99 } }) })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
    })

    it('hisse tokeni teslim kaydi (bStock): PRIVATE_UNSUPPORTED, yurutucu cagrilmaz, siparis yazilmaz', async () => {
        const CRCLB = { chainId: 56, address: getAddress('0x80f3D493EBCe97e343c53D29a137942416B4ffC0'), symbol: 'CRCLB', decimals: 18 }
        await boot({ rec: record({ outputToken: CRCLB }) })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
    })
    // K4 siparis aninda: yerel (BNB) teslim bayragi kapaliyken saklanan BNB kaydi hicbir saglayici/cuzdan/yurutucu
    // cagrisina varmadan reddedilir; bayrak acikken ayni kayit yurutucuye ulasir.
    // 1.10 (sahip karari 2026-10-30): Para yukle yalniz Gonder kaynagi varliklarini teslim eder; BNB Gonder kaynagi degil (ag ucreti ATS), bu yuzden
    // yerel BNB teslim kaydi YALNIZ Gonder'de (alici dis adres) yurutucuye ulasir.
    it('yerel BNB teslim kaydi (Gonder): bayrak kapaliyken PRIVATE_UNSUPPORTED (yurutucu yok, siparis yok); aciksa yurutucuye ulasir', async () => {
        const BNB = nativeTokenOf(56)
        const BNB_DEST = { kind: 'evm', chainId: 56, assetId: BNB.address, assetSymbol: 'BNB', assetDecimals: 18, minDestAmount: '30000000000000000', expectedDestAmount: '32000000000000000' }
        const rec = () => record({
            sourceAccountKey: GIZLI.key, outputAddress: FOREIGN, outputToken: BNB,
            quote: quoteToGizli({
                dest: BNB_DEST, inputAddress: GIZLI.address, recipient: { chainId: 56, address: FOREIGN },
                recipients: [{ splitIndex: 0, address: FOREIGN, chainId: 56, payoutAmount: '24750000000000000000' }],
            }),
        })
        flags.native = false
        await boot({ rec: rec() })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()

        flags.native = true
        await boot({ rec: rec() })
        expect((await bg.call(order())).success).toBe(true)
        expect(execMock).toHaveBeenCalledTimes(1)
        expect(execMock.mock.calls[0][0].expected.outputToken).toEqual(BNB)
    })

    it('yerel BNB teslim kaydi (Para yukle): bayrak ACIKKEN bile PRIVATE_UNSUPPORTED; yurutucu yok, siparis yok (teslim degismezi)', async () => {
        const BNB = nativeTokenOf(56)
        const BNB_DEST = { kind: 'evm', chainId: 56, assetId: BNB.address, assetSymbol: 'BNB', assetDecimals: 18, minDestAmount: '30000000000000000', expectedDestAmount: '32000000000000000' }
        flags.native = true
        await boot({ rec: record({ outputToken: BNB, quote: quoteToGizli({ dest: BNB_DEST }) }) })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
    })

    // D5 / E4: surumsuz teklif kaydi okunmaz, eski-kayit yolu yoktur; yeni teklif alinir. Bilinmeyen surum de ayni.
    it('surumsuz (eski outputAsset dizgesi) ya da bilinmeyen surumlu teklif kaydi: PRIVATE_QUOTE_NOT_FOUND; yurutucu cagrilmaz, siparis yazilmaz', async () => {
        const eski = { createdAt: Date.now(), quote: quoteToGizli(), sourceAccountKey: 'a-1', sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25', outputAsset: 'USDC', outputAddress: GIZLI.address }
        for (const rec of [eski, record({ deliveryVersion: 3 }), record({ deliveryVersion: undefined })]) {
            await boot({ rec })
            expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_QUOTE_NOT_FOUND' })
            expect(execMock).not.toHaveBeenCalled()
            expect(bg.localStore.private_orders).toBeUndefined()
        }
    })

    // Gonder, BSC disi teslim: teklif kaydi Base USDC'yi tasir; kaynak Gizli Hesap, alici yabanci. Odeme ve yatirma zinciri 56'dir.
    const baseGonderRec = (over = {}) => record({
        sourceAccountKey: GIZLI.key, outputAddress: FOREIGN, payoutUsdc: '15', outputToken: usdcTokenOf(8453),
        quote: baseUsdcQuoteFixture({
            expiresAt: EXPIRES, inputAddress: GIZLI.address,
            recipient: { chainId: 8453, address: FOREIGN },
            recipients: [{ splitIndex: 0, address: FOREIGN, chainId: 8453, payoutAmount: '14850000000000000000' }],
        }),
        ...over,
    })

    // Kendine teslim (Takas/Kopru): kaynak Gizli Hesap, alici da Gizli Hesap'in kendi adresi. Odeme ve yatirma zinciri 56, teslim agi 8453.
    const kendineRec = (over = {}) => record({
        sourceAccountKey: GIZLI.key, outputAddress: GIZLI.address, payoutUsdc: '15', outputToken: usdcTokenOf(8453),
        quote: baseUsdcQuoteFixture({
            expiresAt: EXPIRES, inputAddress: GIZLI.address,
            recipient: { chainId: 8453, address: GIZLI.address },
            recipients: [{ splitIndex: 0, address: GIZLI.address, chainId: 8453, payoutAmount: '14850000000000000000' }],
        }),
        ...over,
    })

    it('Gonder: Base USDC teslimli siparis: kayit surum 2 ve summary.dest.chainId 8453, odeme/yatirma zinciri 56 ve kart 56da kalir, yazici cagrilmaz', async () => {
        const yazilan = []
        flags.onWrite = () => yazilan.push('yazildi')
        await boot({ rec: baseGonderRec() })
        expect(await bg.call(order())).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        // Yurutucu SAKLANAN kayittaki Base tokeniyle sabitlenir; yatirma zinciri teslim agiyla birlesmez.
        expect(execMock.mock.calls[0][0].expected).toEqual({ sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '15', outputToken: usdcTokenOf(8453), outputAddress: FOREIGN })
        expect(bg.localStore.private_orders[0]).toMatchObject({
            deliveryVersion: 2, sourceChainId: 56, outputAddress: FOREIGN,
            summary: { dest: { chainId: 8453, asset: 'USDC', decimals: 6 } },
        })
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'success', meta: { chainId: 56 }, accountKey: GIZLI.key }))
        // Gonder'de teslim baska birinin adresine gider (Gizli Hesap'in kendi adresine degil): Gizli Hesap'in varlik listesine yazilmaz.
        expect(yazilan).toEqual([])
    })

    it('Gizli -> kendine: Gonder kaynagi olmayan varlik (CAKE, BNB) teslim kaydi PRIVATE_UNSUPPORTED; yurutucu cagrilmaz, siparis yazilmaz, yazici cagrilmaz', async () => {
        const yazilan = []
        flags.onWrite = () => yazilan.push('yazildi')
        for (const outputToken of [CAKE, nativeTokenOf(56)]) {
            await boot({ rec: kendineRec({ outputToken, payoutUsdc: '25', quote: quoteToGizli({ inputAddress: GIZLI.address }) }) })
            expect(await bg.call(order()), outputToken.symbol).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
            expect(execMock).not.toHaveBeenCalled()
            expect(bg.localStore.private_orders).toBeUndefined()
        }
        expect(yazilan).toEqual([])
    })

    it('Gizli -> kendine: Para yukle listesi YALNIZ BSC iken Base teslimli kayit PRIVATE_CHAIN_CLOSED; yurutucu cagrilmaz, siparis yazilmaz', async () => {
        await boot({ rec: kendineRec() })
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
    })

    it('Gizli -> kendine: Gonder kaynagi varligi (BSC USDC) kaydi yurutucuye ulasir', async () => {
        await boot({ rec: kendineRec({ outputToken: USDC_TOKEN, payoutUsdc: '25', quote: quoteToGizli({ inputAddress: GIZLI.address }) }) })
        expect((await bg.call(order())).success).toBe(true)
        expect(execMock).toHaveBeenCalledTimes(1)
        expect(execMock.mock.calls[0][0].expected).toEqual({ sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25', outputToken: USDC_TOKEN, outputAddress: GIZLI.address })
    })

    // Teklifle siparis arasinda derleme listesi degisebilir (ya da kayit baska bir surumden kalmis olabilir): siparis aninda da kapali ag
    // saglayiciya, cuzdana ve yurutucuye varmadan reddedilir.
    it('Para yukle: Base teslimli kayit PRIVATE_CHAIN_CLOSED (Para yukle listesi yalniz BSC daraldiysa); yurutucu cagrilmaz, siparis yazilmaz', async () => {
        await boot({ rec: record({
            payoutUsdc: '15', outputToken: usdcTokenOf(8453),
            quote: baseUsdcQuoteFixture({ expiresAt: EXPIRES, inputAddress: A.address, recipients: [{ splitIndex: 0, address: GIZLI.address, chainId: 8453, payoutAmount: '14850000000000000000' }] }),
        }) })
        // Test ortami Para yukle'yi on ag acar (F: BSC disi Para yukle); magaza listesi gibi yalniz BSC'ye daralir.
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
    })

    it('Gonder: derleme listesi teklif aliminden sonra daraldiysa (yalniz 56) Base teslimli kayit PRIVATE_CHAIN_CLOSED; yurutucu cagrilmaz, siparis yazilmaz', async () => {
        await boot({ rec: baseGonderRec() })
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '56')
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })
        expect(execMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
    })

    // ATS-once kapisi KALDIRILDI (2026-10-28, kullanici karari; PF-F1 GERI ALINDI): siparis aninda da Gizli Hesap'in BSC ATS bakiyesi OKUNMAZ ve
    // ATS yuzunden reddedilmez. ATS kontrolu islem aninda (Takas/Kopru ATS ucret karti) yapilir. Okuma ethers sozlesme cagrisidir
    // (JsonRpcProvider.prototype.call taklit edilir; gercek aga cikilmaz): hicbir balanceOf cagrisi yapilmamali.
    describe('ATS-once kapisi YOK: siparis aninda ATS bakiyesi okunmaz (Para yukle + BSC disi teslim)', () => {
        const okuma = { cagrilar: [], deger: 0n, hata: null }
        const baseFonRec = () => record({
            payoutUsdc: '15', outputToken: usdcTokenOf(8453),
            quote: baseUsdcQuoteFixture({ expiresAt: EXPIRES, inputAddress: A.address, recipients: [{ splitIndex: 0, address: GIZLI.address, chainId: 8453, payoutAmount: '14850000000000000000' }] }),
        })

        beforeEach(() => {
            okuma.cagrilar = []; okuma.deger = 0n; okuma.hata = null
            vi.spyOn(JsonRpcProvider.prototype, 'call').mockImplementation(async function (tx) {
                okuma.cagrilar.push({ to: tx.to, data: tx.data, rpc: this._getConnection().url })
                if (okuma.hata) throw okuma.hata
                return AbiCoder.defaultAbiCoder().encode(['uint256'], [okuma.deger])
            })
            // Test ortami Para yukle'yi on ag acar (F); liste bu blokta yine de acikca sabitlenir (testler ortam degerine bagimli olmasin).
            vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56,1,8453,42161')
        })

        it('ATS bakiyesi sifirken de yurutucuye ulasir ve siparis kaydolur; hicbir zincir okumasi yapilmaz', async () => {
            okuma.deger = 0n
            await boot({ rec: baseFonRec() })
            expect(await bg.call(order())).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
            expect(execMock).toHaveBeenCalledTimes(1)
            expect(bg.localStore.private_orders).toHaveLength(1)
            expect(okuma.cagrilar).toEqual([])
        })

        it('ATS okumasi hata verecek olsa bile (RPC kapali) siparis ATS yuzunden reddedilmez; PRIVATE_ATS_FIRST hic donmez', async () => {
            okuma.hata = new Error('rpc timeout')
            await boot({ rec: baseFonRec() })
            const res = await bg.call(order())
            expect(res).not.toEqual({ success: false, error: 'PRIVATE_ATS_FIRST' })
            expect(res.success).toBe(true)
            expect(okuma.cagrilar).toEqual([])
        })

        it('Gonder (BSC disi teslim) ve BSC teslimi (Para yukle) de ATS okumaz: bakiye sifir olsa da yurutucuye ulasir', async () => {
            okuma.deger = 0n
            await boot({ rec: baseGonderRec() })
            expect((await bg.call(order())).success).toBe(true)
            expect(execMock).toHaveBeenCalledTimes(1)
            // boot() vi.clearAllMocks() cagirir: ikinci siparisin cagri sayisi sifirdan sayilir.
            await boot({ rec: record() })
            expect((await bg.call(order())).success).toBe(true)
            expect(execMock).toHaveBeenCalledTimes(1)
            expect(okuma.cagrilar).toEqual([])
        })
    })

    // E13: teslim edilen token satirini yazan TEK yer arka plandir (recordDeposit, siparis kaydindan sonra, Gizli Hesap'a teslimde: Para yukle, kendine Takas/Kopru).
    describe('teslim yazicisi (E13)', () => {
        const ATS_ROW = { name: 'ATS', symbol: 'ATS', decimals: 18, address: getAddress('0x' + 'a7'.repeat(20)), image: { thumb: '', small: '', large: '' }, coingecko_id: 'ats' }
        // Gizli Hesap kovasi tohumlu (56 anahtari var): yazici tohum bekleyen kovaya yazmaz (Task 11).
        const seeded = () => ({ [GIZLI.key]: { 56: [ATS_ROW] } })
        const CAKE_DEST = { kind: 'evm', chainId: 56, assetId: CAKE.address, assetSymbol: 'CAKE', assetDecimals: 18, minDestAmount: '6000000000000000000', expectedDestAmount: '6500000000000000000' }

        // 1.10 teslim degismezi: Para yukle'de teslim edilen token bir Gonder kaynagi olmali (CAKE edilemez); Base USDC (Gonder kaynagi) Base kovasina yazilir.
        const baseFonRec = () => record({
            payoutUsdc: '15', outputToken: usdcTokenOf(8453),
            quote: baseUsdcQuoteFixture({ expiresAt: EXPIRES, inputAddress: A.address, recipients: [{ splitIndex: 0, address: GIZLI.address, chainId: 8453, payoutAmount: '14850000000000000000' }] }),
        })

        it('Para yukle: siparis kaydi yazildiktan SONRA teslim tokeni Gizli Hesabin teslim agi (Base) kovasina eklenir', async () => {
            const gorulen = []
            flags.onWrite = () => gorulen.push(bg.localStore.private_orders?.length ?? 0)
            await boot({ rec: baseFonRec(), imported: seeded() })
            expect((await bg.call(order())).success).toBe(true)
            // Yazici cagrildiginda siparis kaydi zaten depodaydi.
            expect(gorulen).toEqual([1])
            const rows = bg.localStore.imported_tokens[GIZLI.key]['8453']
            expect(rows.map((r) => r.symbol)).toEqual(['USDC'])
            expect(rows[0]).toMatchObject({ address: usdcTokenOf(8453).address, decimals: 6, coingecko_id: null })
            expect(bg.localStore.imported_tokens[GIZLI.key]['56']).toHaveLength(1)
        })

        it('Gonder (kaynak Gizli Hesap): teslim baska birinin adresinedir, kova degismez ve yazici hic cagrilmaz', async () => {
            const yazilan = []
            flags.onWrite = () => yazilan.push('yazildi')
            await boot({
                rec: record({
                    sourceAccountKey: GIZLI.key, outputAddress: FOREIGN, outputToken: CAKE,
                    quote: quoteToGizli({
                        dest: CAKE_DEST, inputAddress: GIZLI.address,
                        recipient: { chainId: 56, address: FOREIGN },
                        recipients: [{ splitIndex: 0, address: FOREIGN, chainId: 56, payoutAmount: '25000000000000000000' }],
                    }),
                }),
                imported: seeded(),
            })
            expect((await bg.call(order())).success).toBe(true)
            expect(yazilan).toEqual([])
            expect(bg.localStore.imported_tokens[GIZLI.key]['56']).toHaveLength(1)
        })

        it('yazici firlatirsa siparis yine kaydolur ve cevap basaridir (en iyi caba, hata yatirmayi etkilemez)', async () => {
            flags.writerFails = true
            await boot({ rec: baseFonRec(), imported: seeded() })
            expect(await bg.call(order())).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
            expect(bg.localStore.private_orders).toHaveLength(1)
            expect(bg.localStore.imported_tokens[GIZLI.key]['56']).toHaveLength(1)
            expect(bg.localStore.imported_tokens[GIZLI.key]['8453']).toBeUndefined()
        })

        it('Gizli -> kendine (Takas/Kopru): siparis kaydi yazildiktan SONRA Base USDC teslim tokeni Gizli Hesabin 8453 kovasina eklenir', async () => {
            const gorulen = []
            flags.onWrite = () => gorulen.push(bg.localStore.private_orders?.length ?? 0)
            await boot({ rec: kendineRec(), imported: seeded() })
            expect((await bg.call(order())).success).toBe(true)
            expect(gorulen).toEqual([1])
            const rows = bg.localStore.imported_tokens[GIZLI.key]['8453']
            expect(rows.map((r) => r.symbol)).toEqual(['USDC'])
            expect(rows[0]).toMatchObject({ address: usdcTokenOf(8453).address, decimals: 6, coingecko_id: null })
            expect(bg.localStore.imported_tokens[GIZLI.key]['56']).toHaveLength(1)
        })

        it('Gizli -> kendine: tablo USDC si ve yerel coin disindaki Gonder kaynagi (Ethereum USDT) 1 kovasina yazilir', async () => {
            const USDT_ETH = { chainId: 1, address: getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'), symbol: 'USDT', decimals: 6 }
            const rec = kendineRec({
                outputToken: USDT_ETH,
                quote: baseUsdcQuoteFixture({
                    expiresAt: EXPIRES, inputAddress: GIZLI.address,
                    recipient: { chainId: 1, address: GIZLI.address },
                    recipients: [{ splitIndex: 0, address: GIZLI.address, chainId: 1, payoutAmount: '14850000000000000000' }],
                }),
            })
            await boot({ rec, imported: seeded() })
            expect((await bg.call(order())).success).toBe(true)
            const rows = bg.localStore.imported_tokens[GIZLI.key]['1']
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({ symbol: 'USDT', decimals: 6, address: USDT_ETH.address })
            expect(bg.localStore.imported_tokens[GIZLI.key]['8453']).toBeUndefined()
            expect(bg.localStore.imported_tokens[GIZLI.key]['56']).toHaveLength(1)
        })

        it('Gizli -> kendine: kovada zaten olan teslim tokeni ikinci kez yazilmaz (tekrar yok)', async () => {
            const USDC_ROW = { name: 'USDC', symbol: 'USDC', decimals: 6, address: usdcTokenOf(8453).address, image: { thumb: '', small: '', large: '' }, chain: null, coingecko_id: null }
            const yazilan = []
            flags.onWrite = () => yazilan.push('yazildi')
            await boot({ rec: kendineRec(), imported: { [GIZLI.key]: { 56: [ATS_ROW], 8453: [USDC_ROW] } } })
            expect((await bg.call(order())).success).toBe(true)
            expect(yazilan).toEqual(['yazildi'])
            expect(bg.localStore.imported_tokens[GIZLI.key]['8453']).toEqual([USDC_ROW])
        })

        it('Gizli -> kendine: yazici firlatirsa siparis yine kaydolur ve cevap basaridir', async () => {
            flags.writerFails = true
            const yazilan = []
            flags.onWrite = () => yazilan.push('yazildi')
            await boot({ rec: kendineRec(), imported: seeded() })
            expect(await bg.call(order())).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
            expect(yazilan).toEqual(['yazildi'])
            expect(bg.localStore.private_orders).toHaveLength(1)
            expect(bg.localStore.imported_tokens[GIZLI.key]['8453']).toBeUndefined()
            expect(bg.localStore.imported_tokens[GIZLI.key]['56']).toHaveLength(1)
        })

        it('Gizli -> bir hane farkli adres (Gonder): kendine DEGIL, kova degismez ve yazici hic cagrilmaz', async () => {
            const yazilan = []
            flags.onWrite = () => yazilan.push('yazildi')
            await boot({ rec: baseGonderRec({ outputAddress: BIR_HANE_FARKLI }), imported: seeded() })
            expect((await bg.call(order())).success).toBe(true)
            expect(execMock.mock.calls[0][0].expected.outputAddress).toBe(BIR_HANE_FARKLI)
            expect(yazilan).toEqual([])
            expect(bg.localStore.imported_tokens[GIZLI.key]['8453']).toBeUndefined()
            expect(bg.localStore.imported_tokens[GIZLI.key]['56']).toHaveLength(1)
        })
    })

    // A:I-5: ana gonderme girisi. Imzalayan Gizli Hesap, alici yabanci adres.
    it('GONDERME yonu: Gizli Hesap imzalar, kayit ve kart Gizli Hesaba yazilir', async () => {
        await boot({ rec: record({
            sourceAccountKey: GIZLI.key, outputAddress: FOREIGN,
            quote: quoteToGizli({
                recipient: { chainId: 56, address: FOREIGN },
                recipients: [{ splitIndex: 0, address: FOREIGN, chainId: 56, payoutAmount: '25000000000000000000' }],
                inputAddress: GIZLI.address,
            }),
        }) })
        const res = await bg.call(order())
        expect(res).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        const args = execMock.mock.calls[0][0]
        // Yurutucudeki cuzdan, teklifin inputAddress i ve beklentiler Gizli Hesaptir; alici yabanci.
        expect(args.wallet.address).toBe(GIZLI.address)
        expect(args.quote.inputAddress).toBe(GIZLI.address)
        expect(args.expected.outputAddress).toBe(FOREIGN)
        expect(bg.localStore.private_orders[0]).toMatchObject({ sourceAccountKey: GIZLI.key, outputAddress: FOREIGN, depositTxHash: '0xdep' })
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'success', accountKey: GIZLI.key }))
    })

    const withWait = (wait) => async ({ onSubmitted }) => { await onSubmitted('0xdep'); return { hash: '0xdep', wait } }

    it('makbuz status 0: kart ONCHAIN_FAILED, kayit depositFailed + terminal, rozet bos', async () => {
        await boot()
        execMock.mockImplementation(withWait(async () => ({ status: 0 })))
        const res = await bg.call(order())
        expect(res.success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({
            status: 'error', meta: { txHash: '0xdep', errorCode: 'ONCHAIN_FAILED' },
        }))
        await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true, status: 'ABORTED', depositTxHash: '0xdep' }))
        await vi.waitFor(() => expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' }))
        // Zincirde basarisiz olsa da siparis kaydi KALIR: ayni ticket ikinci kez gonderilmez.
        expect(bg.localStore.private_orders).toHaveLength(1)
    })

    it('wait() makbuz tasiyan retle biterse (CALL_EXCEPTION status 0) ayni sonuc', async () => {
        await boot()
        execMock.mockImplementation(withWait(async () => { throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION', receipt: { status: 0 } }) }))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'error', meta: { errorCode: 'ONCHAIN_FAILED' } }))
        await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true, status: 'ABORTED' }))
    })

    it('wait() makbuzsuz retle biterse (ag/zaman asimi) kart processing KALIR, kayit degismez (runPendingRecovery cozer)', async () => {
        await boot()
        const wait = vi.fn(async () => { throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }) })
        execMock.mockImplementation(withWait(wait))
        expect((await bg.call(order())).success).toBe(true)
        // wait() GERCEKTEN cagrildi; sonra hicbir sey degismedi.
        await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1))
        for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r))
        expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'processing', meta: { txHash: '0xdep' } })
        expect(bg.localStore.private_orders[0].depositFailed).toBeUndefined()
        expect(bg.localStore.private_orders[0].status).toBe('AWAITING_DEPOSIT')
    })

    // T14 M1: ethers TRANSACTION_REPLACED her zaman DEGISTIREN islemin makbuzunu tasir; karar
    // makbuz durumuna degil nedene gore verilir. Hata gercek ethers makeError ile kurulur.
    const NEW_HASH = '0x' + '9e'.repeat(32)
    const replaced = (reason, receiptStatus) => makeError('transaction was replaced', 'TRANSACTION_REPLACED', {
        cancelled: reason !== 'repriced',
        reason,
        replacement: { hash: NEW_HASH },
        hash: NEW_HASH,
        receipt: { status: receiptStatus, hash: NEW_HASH },
    })

    it.each([['cancelled', 1], ['replaced', 1], ['cancelled', 0], ['replaced', 0]])(
        'TRANSACTION_REPLACED %s (degistiren makbuz status %i): yatirma OLMADI -> kart ONCHAIN_FAILED, kayit terminal',
        async (reason, receiptStatus) => {
            await boot()
            execMock.mockImplementation(withWait(async () => { throw replaced(reason, receiptStatus) }))
            expect((await bg.call(order())).success).toBe(true)
            await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({
                status: 'error', meta: { txHash: '0xdep', errorCode: 'ONCHAIN_FAILED' },
            }))
            await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true, status: 'ABORTED', depositTxHash: '0xdep' }))
            await vi.waitFor(() => expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' }))
        })

    it('TRANSACTION_REPLACED repriced (makbuz status 1): kayit ve kart YENI hash e tasinir, sunucuya yeni hash bildirilir, kart success', async () => {
        await boot()
        execMock.mockImplementation(withWait(async () => { throw replaced('repriced', 1) }))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'success', meta: { txHash: NEW_HASH } }))
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: NEW_HASH, status: 'AWAITING_DEPOSIT' })
        expect(bg.localStore.private_orders[0].depositFailed).toBeUndefined()
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, NEW_HASH)
    })

    it('TRANSACTION_REPLACED repriced ama yeni islem revert oldu (status 0): yeni hash kayitli, kart ONCHAIN_FAILED, kayit terminal', async () => {
        await boot()
        execMock.mockImplementation(withWait(async () => { throw replaced('repriced', 0) }))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({
            status: 'error', meta: { txHash: NEW_HASH, errorCode: 'ONCHAIN_FAILED' },
        }))
        await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true, status: 'ABORTED', depositTxHash: NEW_HASH }))
    })

    it('TRANSACTION_REPLACED repriced ama gecerli yeni hash yok: kayit ve kart DEGISMEZ', async () => {
        await boot()
        const wait = vi.fn(async () => { throw Object.assign(replaced('repriced', 1), { replacement: {}, hash: 'bozuk' }) })
        execMock.mockImplementation(withWait(wait))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1))
        for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r))
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: '0xdep', status: 'AWAITING_DEPOSIT' })
        expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'processing', meta: { txHash: '0xdep' } })
    })

    // T20 M5 (a): bilinmeyen TRANSACTION_REPLACED nedeni karar vermez; kayit ve kart olduklari gibi kalir.
    it('TRANSACTION_REPLACED bilinmeyen neden: kayit, kart ve sunucu bildirimi DEGISMEZ (kurtarmaya birakilir)', async () => {
        await boot()
        const wait = vi.fn(async () => { throw replaced('gizemli', 1) })
        execMock.mockImplementation(withWait(wait))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1))
        for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r))
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: '0xdep', status: 'AWAITING_DEPOSIT' })
        expect(bg.localStore.private_orders[0].depositFailed).toBeUndefined()
        expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'processing', meta: { txHash: '0xdep' } })
        // Yalniz ilk (madenlenmeden once) bildirim gitti; yeni hash bildirilmedi.
        expect(reportMock.mock.calls.map((c) => c[1])).not.toContain(NEW_HASH)
    })

    // T20 M5 (b): repriced dalinda updateOrder basarisiz olsa da kart yeni hash e tasinir, sunucuya
    // yeni hash bildirilir ve makbuza gore karar verilir (kayit eski hash te kalir: yoklama cozer).
    it('TRANSACTION_REPLACED repriced ama updateOrder yazimi basarisiz: loglanir, yine de kart yeni hash e tasinir ve success olur', async () => {
        await boot()
        const realSet = bg.chrome.storage.local.set.getMockImplementation()
        let armed = false
        bg.chrome.storage.local.set.mockImplementation(async (obj) => {
            if (armed && 'private_orders' in obj) throw new Error('depo yazilamadi')
            return realSet(obj)
        })
        execMock.mockImplementation(withWait(async () => { armed = true; throw replaced('repriced', 1) }))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'success', meta: { txHash: NEW_HASH } }))
        expect(console.error).toHaveBeenCalledWith('[private] yeni yatirma hash i kaydedilemedi:', expect.any(Error))
        expect(bg.localStore.private_orders[0].depositTxHash).toBe('0xdep')
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, NEW_HASH)
    })

    // T20 M5 (c): makbuzsuz repriced: yeni hash kayda ve karta islenir, sonuc bilinmedigi icin kart 'processing' kalir.
    it('TRANSACTION_REPLACED repriced ama makbuz yok: kayit yeni hash e tasinir, kart yeni hash le processing KALIR', async () => {
        await boot()
        execMock.mockImplementation(withWait(async () => { throw Object.assign(replaced('repriced', 1), { receipt: undefined }) }))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: NEW_HASH, status: 'AWAITING_DEPOSIT' }))
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'processing', meta: { txHash: NEW_HASH } }))
        for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r))
        expect(bg.localStore.current_transactions?.[0].status).toBe('processing')
        expect(bg.localStore.private_orders[0].depositFailed).toBeUndefined()
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, NEW_HASH)
    })

    it('yurutucu hatasinin asil nedeni (cause) isleyicide loglanir, arayuze yalniz kod gider', async () => {
        await boot()
        const asil = Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
        execMock.mockImplementation(async () => { throw Object.assign(new Error('PRIVATE_FAILED'), { cause: asil }) })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(console.error).toHaveBeenCalledWith('[private] siparis basarisiz:', expect.objectContaining({ message: 'PRIVATE_FAILED' }), asil)
    })

    it('wait() basariyla biterse karti success yapar ve yatirmayi sunucuya BIR KEZ DAHA bildirir', async () => {
        await boot()
        execMock.mockImplementation(withWait(async () => ({ status: 1 })))
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'success', meta: { txHash: '0xdep' } }))
        expect(reportMock).toHaveBeenCalledTimes(2)
        for (const c of reportMock.mock.calls) expect(c).toEqual([{ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, '0xdep'])
    })

    it('ayni anda iki ayri siparis SIRAYLA yurur (islem kuyrugu)', async () => {
        const t2 = '0x' + '02'.repeat(32)
        await boot()
        bg.sessionStore.private_quotes[t2] = record({ quote: quoteToGizli({ ticket: t2, id: t2 }) })
        const events = []
        execMock.mockImplementation(async ({ quote, onSubmitted }) => {
            events.push(['start', quote.ticket])
            await new Promise((r) => setTimeout(r, 20))
            await onSubmitted('0x' + quote.ticket.slice(2, 6))
            events.push(['end', quote.ticket])
            return { hash: '0x' + quote.ticket.slice(2, 6), wait: null }
        })
        const [r1, r2] = await Promise.all([
            bg.call(order()),
            bg.call({ type: 'PRIVATE_ORDER', message: { ticket: t2 } }),
        ])
        expect(r1.success).toBe(true)
        expect(r2.success).toBe(true)
        expect(events.map((e) => e[0])).toEqual(['start', 'end', 'start', 'end'])
    })

    it('ayni ticket icin es zamanli ikinci cagri PRIVATE_ORDER_IN_PROGRESS, yurutucu bir kez', async () => {
        await boot()
        execMock.mockImplementation(async ({ onSubmitted }) => {
            await new Promise((r) => setTimeout(r, 20))
            await onSubmitted('0xdep')
            return { hash: '0xdep', wait: null }
        })
        const [r1, r2] = await Promise.all([bg.call(order()), bg.call(order())])
        expect([r1, r2].filter((r) => r.success)).toHaveLength(1)
        expect([r1, r2].find((r) => !r.success)).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(execMock).toHaveBeenCalledTimes(1)
    })
})

describe('es zamanli ayni ticket: bellek hizli yolu (T7 M3)', () => {
    it('ilk yurutucu tutulurken ikinci cagri HEMEN PRIVATE_ORDER_IN_PROGRESS alir (kuyruga girmez)', async () => {
        await boot()
        let release
        const hold = new Promise((r) => { release = r })
        execMock.mockImplementation(async ({ onSubmitted }) => { await hold; await onSubmitted('0xdep'); return { hash: '0xdep', wait: null } })
        const p1 = bg.call(order())
        await vi.waitFor(() => expect(execMock).toHaveBeenCalledTimes(1))
        // Kayit henuz yok (yurutucu tutuluyor): ikinci cevabi yalniz in-flight kumesi verebilir.
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(bg.localStore.private_orders).toBeUndefined()
        release()
        expect((await p1).success).toBe(true)
        expect(execMock).toHaveBeenCalledTimes(1)
    })
})

describe('yatirma sonrasi kayit yolu (T7-M2, T7-M6)', () => {
    // Yalniz private_orders yazimlarini bozar; kart (current_transactions) yazimlari etkilenmez.
    const failOrderWrites = (times) => {
        const realSet = bg.chrome.storage.local.set.getMockImplementation()
        let left = times
        bg.chrome.storage.local.set.mockImplementation(async (obj) => {
            if ('private_orders' in obj && left > 0) { left--; throw new Error('depo yazilamadi') }
            return realSet(obj)
        })
    }

    it('ilk kayit yazimi basarisiz olursa bir kez yeniden denenir, kayit yazilir', async () => {
        await boot()
        failOrderWrites(1)
        expect(await bg.call(order())).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(bg.localStore.private_orders[0]).toMatchObject({ ticket: ticketOf(), depositTxHash: '0xdep' })
    })

    // Ruling (Task 14): native yatirmada kayit YAYINDAN ONCE yazilir. Iki yazim da basarisizsa
    // yurutucu hicbir sey yayinlamaz (burada broadcast casusu), cevap PRIVATE_FAILED, para gitmedi.
    it('iki yazim da basarisiz: HICBIR sey yayinlanmaz, cevap PRIVATE_FAILED, ticket kullanilabilir kalir', async () => {
        await boot()
        failOrderWrites(2)
        const broadcast = vi.fn()
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep'); broadcast(); return { hash: '0xdep', wait: null } })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(broadcast).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders).toBeUndefined()
        // Kart hata, sunucuya bildirim yok, alarm yok.
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'error' }))
        expect(reportMock).not.toHaveBeenCalled()
        expect(bg.chrome.alarms.create).not.toHaveBeenCalledWith('private_orders', expect.anything())
        // Ticket tuketilmedi: yazim duzelince ayni ticket yeniden gonderilebilir.
        expect((await bg.call(order())).success).toBe(true)
        expect(broadcast).toHaveBeenCalledTimes(1)
        expect(bg.localStore.private_orders).toHaveLength(1)
    })

    // Yurutucu yayin sonucunu hash'li hatayla bildirir (privateOrderExec.js broadcastError).
    const broadcastRejected = (message, definitive) => async ({ onSubmitted }) => {
        await onSubmitted('0xdep')
        throw Object.assign(new Error(message), { hash: '0xdep', definitive })
    }

    it('KESIN ret: kayit depositFailed + terminal, eslenen kod, kart hata, rozet bos; ayni ticket tekrar gonderilmez', async () => {
        await boot()
        execMock.mockImplementation(broadcastRejected('PRIVATE_INSUFFICIENT_GAS', true))
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_INSUFFICIENT_GAS' })
        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(bg.localStore.private_orders[0]).toMatchObject({
            ticket: ticketOf(), depositTxHash: '0xdep', depositFailed: true, status: 'ABORTED',
        })
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({
            status: 'error', meta: { errorCode: 'INSUFFICIENT_NATIVE', txHash: '0xdep', chainId: 56 }, accountKey: GIZLI.key,
        }))
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
        // Kayit var: ayni ticket ikinci kez yurutucuya gitmez.
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(execMock).toHaveBeenCalledTimes(1)
    })

    it('KESIN ret (nonce/replacement): PRIVATE_FAILED ve depositFailed', async () => {
        await boot()
        execMock.mockImplementation(broadcastRejected('PRIVATE_FAILED', true))
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true, status: 'ABORTED' })
    })

    it('BELIRSIZ sonuc: kayit ACIK kalir, kart hash ile processing, cevap PRIVATE_DEPOSIT_UNCONFIRMED + txHash, yoklama kurulur', async () => {
        await boot()
        execMock.mockImplementation(broadcastRejected('PRIVATE_DEPOSIT_UNCONFIRMED', false))
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_DEPOSIT_UNCONFIRMED', txHash: '0xdep' })
        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(bg.localStore.private_orders[0]).toMatchObject({ ticket: ticketOf(), depositTxHash: '0xdep', status: 'AWAITING_DEPOSIT' })
        expect(bg.localStore.private_orders[0].depositFailed).toBeUndefined()
        await vi.waitFor(() => expect(bg.localStore.current_transactions?.[0]).toMatchObject({ status: 'processing', meta: { txHash: '0xdep', chainId: 56 } }))
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        // Ayni ticket tekrar gonderilemez: polling karar verir.
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(execMock).toHaveBeenCalledTimes(1)
    })

    it('hash tasimayan beklenmeyen hata native yayindan sonra BELIRSIZ sayilir (basari donmez)', async () => {
        await boot()
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep'); throw new Error('wait patladi') })
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_DEPOSIT_UNCONFIRMED', txHash: '0xdep' })
        expect(bg.localStore.private_orders).toHaveLength(1)
    })

    it('ATS: relay edilip sonra patlayan op basari + hash doner VE rapor/alarm/rozet kurulur (T11 M2)', async () => {
        flags.ats = true
        await boot()
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep'); throw new Error('dogrulanamadi') })
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, '0xdep')
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        // T11 M3: ayni ticket ikinci kez gonderilmez.
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(execMock).toHaveBeenCalledTimes(1)
    })

    it('ATS: iki kayit yazimi da basarisiz olsa da cevap basari ve ticket bellekte tuketilir', async () => {
        flags.ats = true
        await boot()
        failOrderWrites(99)
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep'); return { hash: '0xdep', wait: null } })
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: true, ticket: ticketOf(), hash: '0xdep' })
        expect(bg.localStore.private_orders).toBeUndefined()
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(execMock).toHaveBeenCalledTimes(1)
    })

    it('kayit icin gereken ozet yayindan ONCE hesaplanir: bozuk teklifte hic gonderilmez', async () => {
        await boot({ rec: record({ quote: quoteToGizli({ amount: 'abc' }) }) })
        const res = await bg.call(order())
        expect(res.success).toBe(false)
        expect(execMock).not.toHaveBeenCalled()
    })

    // T7-M6: kart, kuyruga giris anindaki degil, siparisin kabul edildigi taraftadir.
    it('kuyrukta beklerken normal moda gecilirse kart yine Gizli tarafa yazilir', async () => {
        const t2 = '0x' + '02'.repeat(32)
        await boot()
        bg.sessionStore.private_quotes[t2] = record({ quote: quoteToGizli({ ticket: t2, id: t2 }) })
        let started
        const firstStarted = new Promise((r) => { started = r })
        let release
        const hold = new Promise((r) => { release = r })
        execMock.mockImplementation(async ({ quote, onSubmitted }) => {
            if (quote.ticket === ticketOf()) { started(); await hold }
            await onSubmitted('0x' + quote.ticket.slice(2, 6))
            return { hash: '0x' + quote.ticket.slice(2, 6), wait: null }
        })
        const p1 = bg.call(order())
        const p2 = bg.call({ type: 'PRIVATE_ORDER', message: { ticket: t2 } })
        await firstStarted
        // Ikinci siparis kuyrukta beklerken kullanici normal hesaba gecer.
        bg.localStore.active_account = A
        release()
        const [r1, r2] = await Promise.all([p1, p2])
        expect(r1.success && r2.success).toBe(true)
        await vi.waitFor(() => {
            const cards = bg.localStore.current_transactions || []
            expect(cards).toHaveLength(2)
            expect(cards.every((c) => c.accountKey === GIZLI.key)).toBe(true)
            expect(cards.every((c) => c.status === 'success')).toBe(true)
        })
    })
})

// T21 M6: GERCEK yurutucu (native kol) ile "belirsiz yayin, sonra nonce too low, makbuz sorgusu" sonuclari
// runPrivateOrder'dan gecer. Ag/imza parcalari taklit edilir; karar mantigi ve kayit gercektir.
describe('PRIVATE_ORDER native: nonce too low sonrasi makbuz sonucu (T21 M6)', () => {
    // Yurutucu imzali baytlari cozup plana ve imzalayana karsi dogrular (T24 M2-I4): gercek anahtarla imzalanir.
    const SIGNER_KEY = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm').derivePath("m/44'/60'/0'/0/0")
    // Her yayin denemesi icin sirayla firlatilacak hata ya da (null) basari.
    // `onBroadcast(raw)`: her yayin denemesinde, yurutucunun GERCEKTEN yayinladigi baytlari gozlemek icin.
    const nativeExec = ({ script, receipt, onBroadcast }) => async (args) => {
        const { executePrivateDeposit } = await vi.importActual('./utils/privacy/privateOrderExec')
        const provider = {
            getBalance: async () => 10n ** 30n,
            getFeeData: async () => ({ gasPrice: 10n ** 9n, maxFeePerGas: null }),
            getNetwork: async () => ({ chainId: 56n }),
            call: async () => '0x',
            getTransactionReceipt: vi.fn(async () => receipt),
            waitForTransaction: vi.fn(async (hash) => ({ status: 1, hash })),
            broadcastTransaction: vi.fn(async (raw) => {
                onBroadcast?.(raw)
                const step = script.shift()
                if (step) throw step
                return { wait: async () => ({ status: 1 }) }
            }),
        }
        const wallet = {
            address: A.address,
            provider,
            estimateGas: async () => 400000n,
            populateTransaction: async (tx) => ({ ...tx, from: A.address, nonce: 7, chainId: 56n, gasPrice: 10n ** 9n }),
            signTransaction: async (tx) => signWithKey(SIGNER_KEY, tx),
        }
        return executePrivateDeposit({ ...args, wallet, sleep: async () => {}, erc20: () => ({ balanceOf: async () => 10n ** 30n, allowance: async () => BigInt(args.quote.amount) }) })
    }
    const ambiguousThenNonceLow = () => [new Error('socket hang up'), new Error('nonce too low: next nonce 8'), new Error('nonce too low: next nonce 8')]
    const card = () => bg.localStore.current_transactions?.[0]

    it('makbuz status 0: kart ONCHAIN_FAILED (canli status-0 ile ayni), kayit depositFailed + terminal, cevap PRIVATE_FAILED', async () => {
        await boot()
        execMock.mockImplementation(nativeExec({ script: ambiguousThenNonceLow(), receipt: { status: 0 } }))
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        await vi.waitFor(() => expect(card()).toMatchObject({ status: 'error', meta: { errorCode: 'ONCHAIN_FAILED', chainId: 56 } }))
        expect(card().meta.txHash).toMatch(/^0x[0-9a-f]{64}$/)
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true, status: 'ABORTED', depositTxHash: card().meta.txHash })
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })

    it('makbuz status 1: yatirma gitti sayilir, cevap basari, kayit ACIK kalir, kart success olur', async () => {
        await boot()
        execMock.mockImplementation(nativeExec({ script: ambiguousThenNonceLow(), receipt: { status: 1 } }))
        const res = await bg.call(order())
        expect(res).toMatchObject({ success: true, ticket: ticketOf() })
        expect(res.hash).toMatch(/^0x[0-9a-f]{64}$/)
        await vi.waitFor(() => expect(card()).toMatchObject({ status: 'success', meta: { txHash: res.hash } }))
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: res.hash, status: 'AWAITING_DEPOSIT' })
        expect(bg.localStore.private_orders[0].depositFailed).toBeUndefined()
        expect(reportMock).toHaveBeenCalledWith(expect.objectContaining({ id: ticketOf() }), res.hash)
    })

    // T24 M7 (a): yurutucu gercek, kayit gercek: depoya yazilan ham bayt ile AGA giden bayt AYNI ve hash'i verir.
    it('gercek yurutucu: yayin ANINDA depodaki rawDepositTx yayinlanan baytlara esit, keccak256(raw) === depositTxHash === cevap hash i', async () => {
        await boot()
        const seen = []
        const onBroadcast = (raw) => seen.push({ raw, stored: structuredClone(bg.localStore.private_orders?.[0]) })
        execMock.mockImplementation(nativeExec({ script: [], receipt: null, onBroadcast }))
        const res = await bg.call(order())
        expect(res).toMatchObject({ success: true, ticket: ticketOf() })
        expect(seen).toHaveLength(1)
        const { raw: broadcastRaw, stored } = seen[0]
        // Kayit yayindan ONCE yazilmisti ve ayni baytlari tasiyordu.
        expect(stored).toBeTruthy()
        expect(stored.rawDepositTx).toBe(broadcastRaw)
        expect(keccak256(stored.rawDepositTx)).toBe(stored.depositTxHash)
        expect(res.hash).toBe(stored.depositTxHash)
    })

    it('makbuz yok: belirsiz kalir (PRIVATE_DEPOSIT_UNCONFIRMED), kayit acik, kart processing', async () => {
        await boot()
        execMock.mockImplementation(nativeExec({ script: ambiguousThenNonceLow(), receipt: null }))
        const res = await bg.call(order())
        expect(res).toMatchObject({ success: false, error: 'PRIVATE_DEPOSIT_UNCONFIRMED' })
        await vi.waitFor(() => expect(card()).toMatchObject({ status: 'processing' }))
        expect(bg.localStore.private_orders[0].depositFailed).toBeUndefined()
    })

    it('dugumun kesin reddi (makbuz sorgulanmadi): kart ONCHAIN_FAILED OLMAZ, jenerik hata kalir', async () => {
        await boot()
        execMock.mockImplementation(nativeExec({ script: [new Error('nonce too low: next nonce 8')], receipt: { status: 0 } }))
        expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        await vi.waitFor(() => expect(card()).toMatchObject({ status: 'error' }))
        expect(card().meta.errorCode).toBeNull()
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true })
    })
})

// T6 (7.6 madde 1): ATS ucret teklifinde donmus artik izin (kayitta atsAllowanceRaw) yurutucuye BigInt olarak gecer; yurutme
// anindaki izin RPC okumasi YAPILMAZ. Kayitta yoksa (ucret teklifi hic cagrilmamis) yurutucu kendi okur.
describe('PRIVATE_ORDER ATS artik izin dondurma', () => {
    it("kayitta atsAllowanceRaw '5' varken executePrivateDeposit e BigInt (5n) gecer", async () => {
        flags.ats = true
        await boot({ rec: record({ atsAllowanceRaw: '5' }) })
        const res = await bg.call(order({ gas: 'ats' }))
        expect(res).toMatchObject({ success: true, ticket: ticketOf() })
        const arg = execMock.mock.calls[0][0]
        expect(typeof arg.atsAllowanceRaw).toBe('bigint')
        expect(arg.atsAllowanceRaw).toBe(5n)
    })

    it("kayitta '0' (sifir izin) 0n olarak gecer; sifir 'yok' sayilmaz", async () => {
        flags.ats = true
        await boot({ rec: record({ atsAllowanceRaw: '0' }) })
        await bg.call(order({ gas: 'ats' }))
        expect(execMock.mock.calls[0][0].atsAllowanceRaw).toBe(0n)
    })

    it.each([[undefined], [null], ['abc'], ['-1'], ['1.5'], [''], [' 5'], [5]])('kayitta atsAllowanceRaw=%j: undefined gecer (yurutucu okur)', async (v) => {
        flags.ats = true
        await boot({ rec: record(v === undefined ? {} : { atsAllowanceRaw: v }) })
        await bg.call(order({ gas: 'ats' }))
        expect(execMock.mock.calls[0][0].atsAllowanceRaw).toBeUndefined()
    })

    it('native gazda atsAllowanceRaw gecmez', async () => {
        await boot({ rec: record({ atsAllowanceRaw: '5' }) })
        await bg.call(order({ gas: 'native' }))
        expect(execMock.mock.calls[0][0].atsAllowanceRaw).toBeUndefined()
    })

    it("gercek yurutucu: kayitta donmus '5' varken op uc cagri tasir ve yurutme aninda izin OKUNMAZ", async () => {
        flags.ats = true
        await boot({ rec: record({ atsAllowanceRaw: '5' }) })
        execMock.mockImplementation(realExec)
        atsMock.mockImplementation(async ({ onRelayed }) => { onRelayed({ txHash: '0xrelayed', kind: 'transfer' }); return { txHash: '0xrelayed' } })
        const res = await bg.call(order({ gas: 'ats' }))
        expect(res).toMatchObject({ success: true, hash: '0xrelayed' })
        expect(atsMock.mock.calls[0][0].calls).toHaveLength(3)
        expect(allowanceMock).not.toHaveBeenCalled()
    })

    it('gercek yurutucu: kayitta donmus deger yoksa yurutucu izni o anda okur ve cagri listesini ona gore secer', async () => {
        flags.ats = true
        await boot()
        execMock.mockImplementation(realExec)
        allowanceMock.mockImplementation(async () => 5n)
        atsMock.mockImplementation(async ({ onRelayed }) => { onRelayed({ txHash: '0xrelayed', kind: 'transfer' }); return { txHash: '0xrelayed' } })
        const res = await bg.call(order({ gas: 'ats' }))
        expect(res).toMatchObject({ success: true, hash: '0xrelayed' })
        expect(allowanceMock).toHaveBeenCalledTimes(1)
        expect(atsMock.mock.calls[0][0].calls).toHaveLength(3)
    })
})

describe('PRIVATE_ORDER ATS', () => {
    it('ATS acikken yurutucuye atsExecute verilir ve opKind private ile cagrilir', async () => {
        flags.ats = true
        await boot()
        atsMock.mockResolvedValue({ hash: '0xuserop', txHash: '0xchain' })
        execMock.mockImplementation(async ({ atsExecute, onSubmitted }) => {
            const r = await atsExecute({ chainId: 56, calls: [{ to: '0x1' }] })
            await onSubmitted(r.txHash)
            return { hash: r.txHash, wait: null }
        })
        const res = await bg.call(order({ gas: 'ats', atsQuoted: { fee: '1' } }))
        expect(res).toEqual({ success: true, ticket: ticketOf(), hash: '0xchain' })
        expect(execMock.mock.calls[0][0].gas).toBe('ats')
        const a = atsMock.mock.calls[0][0]
        expect(a).toMatchObject({ chainId: 56, calls: [{ to: '0x1' }], quoted: { fee: '1' }, opKind: 'private' })
        expect(typeof a.privateKey).toBe('string')
        expect(bg.localStore.private_orders[0]).toMatchObject({ gas: 'ats', depositTxHash: '0xchain' })
        // Basari yolunda da rapor, alarm ve rozet kurulur (afterPrivateDeposit).
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, '0xchain')
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
    })

    // M1: yurutucunun onRelayed geri cagrisi executeAtsTransfer'e AYNEN gecer; relay edilip
    // sonra patlayan op'un hash'i yatirma kaydina yazilir ve cevap basari + hash kalir.
    it('onRelayed executeAtsTransfer e gecer: relay edilip patlayan op kaydedilir', async () => {
        flags.ats = true
        await boot()
        atsMock.mockImplementation(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xrelayed', kind: 'transfer' })
            throw new Error('transfer islemi basarisiz veya sonucu dogrulanamadi')
        })
        execMock.mockImplementation(async ({ atsExecute, onSubmitted }) => {
            await atsExecute({ chainId: 56, calls: [{ to: '0x1' }], onRelayed: ({ txHash }) => onSubmitted(txHash) })
            return { hash: 'asla', wait: null }
        })
        const res = await bg.call(order({ gas: 'ats' }))
        expect(res).toEqual({ success: true, ticket: ticketOf(), hash: '0xrelayed' })
        expect(typeof atsMock.mock.calls[0][0].onRelayed).toBe('function')
        expect(bg.localStore.private_orders[0]).toMatchObject({ gas: 'ats', depositTxHash: '0xrelayed', status: 'AWAITING_DEPOSIT' })
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, '0xrelayed')
        // T11 M3: relay edilip patlayan siparis ayni ticket ile ikinci kez gonderilmez.
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(atsMock).toHaveBeenCalledTimes(1)
    })

    // B:I1: relay.success false hatasi txHash tasir; gercek yurutucu + sendOneOp'un unconfirmed
    // bildirimi: hash kaydedilir, cevap basari + hash, ticket yeniden gonderilemez.
    it('relay success:false (hata txHash tasir): hash kaydedilir, ikinci siparis IN_PROGRESS, atsExecute bir kez', async () => {
        flags.ats = true
        await boot()
        execMock.mockImplementation(realExec)
        atsMock.mockImplementation(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xfailedrelay', kind: 'transfer', unconfirmed: true })
            throw Object.assign(new Error('relay basarisiz (tx 0xfailedrelay)'), { txHash: '0xfailedrelay', userOpHash: '0xuserop' })
        })
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: true, ticket: ticketOf(), hash: '0xfailedrelay' })
        expect(bg.localStore.private_orders[0]).toMatchObject({ gas: 'ats', depositTxHash: '0xfailedrelay', status: 'AWAITING_DEPOSIT' })
        expect(reportMock).toHaveBeenCalledWith({ id: ticketOf(), privacy: true, accessToken: 'tok-1' }, '0xfailedrelay')
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(atsMock).toHaveBeenCalledTimes(1)
    })

    // B:M8: userOp hash'i deposit hash'i olarak ASLA kaydedilmez/raporlanmaz; hash yoksa belirsiz
    // hatasi doner, kayit yazilmaz ama ticket bellekte tuketilir.
    it('ATS sonucunda yalniz userOp hash i: UNTRACKED (hash yok), kayit ve rapor yok, ticket tuketilir', async () => {
        flags.ats = true
        await boot()
        execMock.mockImplementation(realExec)
        atsMock.mockResolvedValue({ hash: '0xuserop' })
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_DEPOSIT_UNTRACKED' })
        expect(bg.localStore.private_orders).toBeUndefined()
        expect(reportMock).not.toHaveBeenCalled()
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(atsMock).toHaveBeenCalledTimes(1)
    })

    // Son inceleme I1: hash'siz ama op'un calismis olabilecegi red (gercek yurutucu): ticket tuketilir.
    it('ATS hash siz opMayHaveRun reddi: UNTRACKED, kayit/rapor yok, ticket tuketilir', async () => {
        flags.ats = true
        await boot()
        execMock.mockImplementation(realExec)
        atsMock.mockRejectedValue(Object.assign(new Error('islem sonucu dogrulanamadi: nonce ilerledigi icin op ZINCIRDE CALISMIS olabilir'), { opMayHaveRun: true, userOpHash: '0xuserop' }))
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_DEPOSIT_UNTRACKED' })
        expect(bg.localStore.private_orders).toBeUndefined()
        expect(reportMock).not.toHaveBeenCalled()
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_ORDER_IN_PROGRESS' })
        expect(atsMock).toHaveBeenCalledTimes(1)
    })

    // T5 (sT12): hash'li ATS belirsizligi (relay success:false + hash) UNTRACKED OLMAZ: kayit yazilir, cevap basari + hash.
    it('hash li ATS belirsizligi UNTRACKED degil: basari + ticket + hash, kayit yazilir', async () => {
        flags.ats = true
        await boot()
        execMock.mockImplementation(realExec)
        atsMock.mockImplementation(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xhashli', kind: 'transfer', unconfirmed: true })
            throw Object.assign(new Error('relay basarisiz (tx 0xhashli)'), { txHash: '0xhashli', userOpHash: '0xuserop' })
        })
        const res = await bg.call(order({ gas: 'ats' }))
        expect(res).toEqual({ success: true, ticket: ticketOf(), hash: '0xhashli' })
        expect(res.error).toBeUndefined()
        expect(bg.localStore.private_orders[0]).toMatchObject({ gas: 'ats', depositTxHash: '0xhashli' })
    })

    // T5: kod YALNIZ gas=ats + hash yok + UNCONFIRMED iken degisir; native yolda hash siz UNCONFIRMED ayni kalir.
    it('native gas ile hash siz PRIVATE_DEPOSIT_UNCONFIRMED kodu DEGISMEZ', async () => {
        await boot()
        execMock.mockImplementation(async () => { throw new Error('PRIVATE_DEPOSIT_UNCONFIRMED') })
        expect(await bg.call(order({ gas: 'native' }))).toEqual({ success: false, error: 'PRIVATE_DEPOSIT_UNCONFIRMED' })
    })

    it('ATS acik ama kaynak zincir ATS zinciri degilse PRIVATE_UNSUPPORTED', async () => {
        flags.ats = true
        await boot({ rec: record({ sourceChainId: 43114 }) })
        expect(await bg.call(order({ gas: 'ats' }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(execMock).not.toHaveBeenCalled()
    })
})

// T8 M5: iade ve yatirma ayni global islem kuyrugunu paylasir; kuyrukta bekleyen iade, onundeki
// yatirmanin KAYDINI gorur (kayit okumasi kuyruk icinde yapilir).
describe('iade yatirmanin arkasinda siralanir', () => {
    it('ayni ticket icin gelen iade, yatirma bitip kaydi yazilana kadar calismaz ve kaydi gorur', async () => {
        await boot()
        let release
        const hold = new Promise((r) => { release = r })
        execMock.mockImplementation(async ({ onSubmitted }) => { await hold; await onSubmitted('0xdep'); return { hash: '0xdep', wait: null } })
        const deposit = bg.call(order())
        await vi.waitFor(() => expect(execMock).toHaveBeenCalledTimes(1))

        let refundDone = false
        const refund = bg.call({ type: 'PRIVATE_REFUND', message: { ticket: ticketOf() } }).then((r) => { refundDone = true; return r })
        for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
        // Kuyrukta bekliyor: yatirma tutulurken cevap yok (kayit hic okunmadi).
        expect(refundDone).toBe(false)

        release()
        expect((await deposit).success).toBe(true)
        // Iade artik yatirmanin yazdigi kaydi gorur (PRIVATE_UNSUPPORTED degil); durum iadeye uygun degil.
        expect(await refund).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
    })
})

// T24: ham imzali bayt kalici, sinirli saglayici, destroy, settle logu
describe('yatirma dayanikliligi: ham bayt, saglayici, settle (T24)', () => {
    const RAW = '0x02' + 'ab'.repeat(40)
    const withRaw = () => execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep', RAW); return { hash: '0xdep', wait: null } })

    it('native: ham imzali bayt hash ile AYNI yazimda siparis kaydina girer (kart kimligi ve tarafi da)', async () => {
        await boot()
        withRaw()
        expect((await bg.call(order())).success).toBe(true)
        expect(bg.localStore.private_orders).toHaveLength(1)
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: '0xdep', rawDepositTx: RAW, cardSide: GIZLI.key })
        expect(typeof bg.localStore.private_orders[0].cardTxId).toBe('string')
        // Kayit yazimi tek upsert: hash ve bayt ayri yazimlarda degil.
        const orderWrites = bg.chrome.storage.local.set.mock.calls.filter(([o]) => 'private_orders' in o)
        expect(orderWrites).toHaveLength(1)
        expect(orderWrites[0][0].private_orders[0]).toMatchObject({ depositTxHash: '0xdep', rawDepositTx: RAW })
    })

    it('kayit yazimi basarisiz olursa (iki kez) bayt hicbir yerde kalmaz ve hicbir sey yayinlanmaz', async () => {
        await boot()
        withRaw()
        const realSet = bg.chrome.storage.local.set.getMockImplementation()
        bg.chrome.storage.local.set.mockImplementation(async (obj) => {
            if ('private_orders' in obj) throw new Error('depo yazilamadi')
            return realSet(obj)
        })
        const res = await bg.call(order())
        expect(res).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(bg.localStore.private_orders).toBeUndefined()
    })

    it('ATS: yurutucu bayt vermese de (ve verse bile) ham bayt KAYDEDILMEZ', async () => {
        flags.ats = true
        await boot()
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xats', RAW); return { hash: '0xats', wait: null } })
        expect((await bg.call(order({ gas: 'ats' }))).success).toBe(true)
        expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: '0xats', rawDepositTx: null, gas: 'ats' })
    })

    it('onay (status 1) gelince depositConfirmed true ve ham bayt silinir', async () => {
        await boot()
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep', RAW); return { hash: '0xdep', wait: async () => ({ status: 1 }) } })
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositConfirmed: true, rawDepositTx: null }))
    })

    it('yeni hash ile yeniden fiyatlama (repriced): eski ham bayt silinir', async () => {
        await boot()
        const H2 = '0x' + 'ee'.repeat(32)
        execMock.mockImplementation(async ({ onSubmitted }) => {
            await onSubmitted('0xdep', RAW)
            return { hash: '0xdep', wait: async () => { throw Object.assign(new Error('replaced'), { code: 'TRANSACTION_REPLACED', reason: 'repriced', replacement: { hash: H2 }, receipt: null }) } }
        })
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositTxHash: H2, rawDepositTx: null }))
    })

    it('makbuz status 0: kayit terminal olur ve ham bayt silinir', async () => {
        await boot()
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep', RAW); return { hash: '0xdep', wait: async () => ({ status: 0 }) } })
        await bg.call(order())
        await vi.waitFor(() => expect(bg.localStore.private_orders[0]).toMatchObject({ depositFailed: true, status: 'ABORTED', rawDepositTx: null }))
    })

    describe('saglayici: 15 sn istek zaman asimi ve destroy', () => {
        it('yurutucuya 15 sn FetchRequest zaman asimli saglayici verilir; makbuz beklemesi YOKSA akis bitince destroy edilir', async () => {
            await boot()
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            let seen
            execMock.mockImplementation(async ({ wallet, onSubmitted }) => { seen = wallet.provider; await onSubmitted('0xdep', RAW); return { hash: '0xdep', wait: null } })
            await bg.call(order())
            expect(seen._getConnection().timeout).toBe(15000)
            expect(destroySpy).toHaveBeenCalledTimes(1)
            expect(destroySpy.mock.contexts[0]).toBe(seen)
        })

        it('makbuz beklemesi varsa destroy BEKLEME BITINCE yapilir (once degil)', async () => {
            await boot()
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            let release
            const gate = new Promise((r) => { release = r })
            execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep', RAW); return { hash: '0xdep', wait: async () => { await gate; return { status: 1 } } } })
            await bg.call(order())
            await new Promise((r) => setTimeout(r, 20))
            expect(destroySpy).not.toHaveBeenCalled()
            release()
            await vi.waitFor(() => expect(destroySpy).toHaveBeenCalledTimes(1))
        })

        it('yurutucu hata verirse de saglayici destroy edilir', async () => {
            await boot()
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            execMock.mockImplementation(async () => { throw new Error('PRIVATE_PROVIDER_DOWN') })
            expect(await bg.call(order())).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
            expect(destroySpy).toHaveBeenCalledTimes(1)
        })
    })

    it('settle hatasi loglanir: son kart yazimi atarsa iz kalir', async () => {
        await boot()
        execMock.mockImplementation(async ({ onSubmitted }) => { await onSubmitted('0xdep', RAW); return { hash: '0xdep', wait: async () => ({ status: 1 }) } })
        const realSet = bg.chrome.storage.local.set.getMockImplementation()
        bg.chrome.storage.local.set.mockImplementation(async (obj) => {
            // 'processing' yazimi gecer, 'success' karti yazimi (settle'in son adimi) duser.
            if ('current_transactions' in obj && obj.current_transactions[0]?.status === 'success') throw new Error('kart yazilamadi')
            return realSet(obj)
        })
        expect((await bg.call(order())).success).toBe(true)
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[private] yatirma sonucu islenemedi:', expect.any(Error)))
    })
})
