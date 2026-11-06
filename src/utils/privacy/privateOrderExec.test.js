import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAddress, isAddress, Interface, keccak256, JsonRpcProvider, Wallet, Transaction, makeError } from 'ethers'
import { depositGasWithHeadroom, DEPOSIT_EXECUTION_PROBE_GAS_CAP } from '@silentswap/chains'
import { executePrivateDeposit, sendRefund, sendRefundAts, buildRefundCall, atsRefundRequired, assertQuoteFresh, readApprovalAllowance, depositGasExceedsCap, PRIVATE_RPC_TIMEOUT_MS } from './privateOrderExec'
import * as fixtures from '../../test-utils/silentswapFixtures'
import { signWithKey } from '../../test-utils/realKeySigner'

const { requestFixture, bridgedNativeRequestFixture, bridgedErc20RequestFixture, DEPOSITORY } = fixtures

// Yurutucu IMZALI baytlari cozup gonderenin imzalayan cuzdan oldugunu dogrular (T24 M2-I4): sahte
// imza yetmez, GERCEK bir anahtar gerekir. Bu yuzden imzalayan cuzdanin adresi (ME) gercek bir
// anahtardan gelir ve teklif fixture'lari inputAddress'i ona sabitler (ustune yazilabilir).
const REAL_KEY_WALLET = new Wallet('0x' + '11'.repeat(32))
const ME = REAL_KEY_WALLET.address
const withMe = (fn) => (over = {}) => fn({ inputAddress: ME, ...over })
const quoteFixture = withMe(fixtures.quoteFixture)
const bridgedNativeQuoteFixture = withMe(fixtures.bridgedNativeQuoteFixture)
const bridgedErc20QuoteFixture = withMe(fixtures.bridgedErc20QuoteFixture)

// Cuzdanin signTransaction'inin SENKRON esi: dolu islemi gercek anahtarla imzalar (ortak yardimci).
const signSync = (tx) => signWithKey(REAL_KEY_WALLET, tx)

// PRIVATE_BRIDGED_SOURCES uretimde ACIKTIR (yalniz Relay Depository rotasi). Yurutucu imzadan once assertQuoteMatches'i
// yeniden calistirir; koprulu rotanin yurutucu davranisi (izin, deger, kayit sirasi) asagidaki testlerde sinanir. Sabit
// kapatilirsa saklanan koprulu tekliflerin imzalanamadigi 'koprulu kaynaklar KAPALI' blogunda sinanir.
const flags = vi.hoisted(() => ({ bridged: true }))
// TEK DIKIS (T26 M3): sabit yalniz privateBridgedSources.js'tedir; hem assertQuoteMatches hem kapi yardimcilari onu oradan okur.
vi.mock('./privateBridgedSources', async (importOriginal) => {
    const real = await importOriginal()
    return { ...real, get PRIVATE_BRIDGED_SOURCES() { return flags.bridged } }
})

const GATEWAY = getAddress('0xccdd2b5836c08bb7f115e8da9ece8605f8e7ea1d')
// Uretim modeli (ucret USTUNE eklenir): 25 USDC istendi -> cuzdandan cikan quote.amount = 25.25 (alicinin alacagi 25, ucretler 0.25).
const NEED = 25250000000000000000n
// Saklanan teklifin istek beklentileri (inputAddress'i yurutucu IMZALAYAN cuzdandan ekler).
const EXPECTED = requestFixture()
// Varsayilan sahte cuzdanin imzaladigi islem (tahmin 400000 -> gasLimit %25 pay eklenmis) ve hash'i: hash
// imzali bayttan turetilir (keccak256), yurutucu de oyle yapar.
const DEFAULT_GAS_PRICE = 10n ** 9n
const DEFAULT_POPULATED = {
    to: GATEWAY, data: quoteFixture().deposit.data, value: 0n, gasLimit: depositGasWithHeadroom(400000n),
    from: ME, nonce: 7, chainId: 56n, gasPrice: DEFAULT_GAS_PRICE,
}
const SIGNED = signSync(DEFAULT_POPULATED)
const SIGNED_HASH = keccak256(SIGNED)
const nowSec = () => Math.floor(Date.now() / 1000)

function fakes({
    tokenBalance = NEED, allowance = 0n, native = 10n ** 18n, gasPrice = DEFAULT_GAS_PRICE,
    estimate = 400000n, networkChainId = 56n, broadcastError = null, signError = null, broadcastScript = null,
} = {}) {
    const order = []
    const token = {
        balanceOf: vi.fn(async () => tokenBalance),
        allowance: vi.fn(async () => allowance),
        approve: vi.fn(async (spender, amount) => { order.push(['approve', String(amount)]); return { wait: vi.fn(async () => ({ status: 1 })) } }),
    }
    const wallet = {
        address: ME,
        provider: {
            getBalance: vi.fn(async () => native),
            getFeeData: vi.fn(async () => ({ gasPrice, maxFeePerGas: null })),
            getNetwork: vi.fn(async () => ({ chainId: networkChainId })),
            // Imzadan once nihai gasLimit ile eth_call denemesi (T24 M2-m5); varsayilan: basarili.
            call: vi.fn(async () => '0x'),
            waitForTransaction: vi.fn(async (hash) => ({ status: 1, hash })),
            // broadcastScript: her yayin denemesi icin sirayla firlatilacak hata (null = basari).
            broadcastTransaction: vi.fn(async (raw) => {
                const step = broadcastScript ? broadcastScript.shift() : broadcastError
                if (step) throw step
                order.push(['broadcast', raw])
                return { hash: SIGNED_HASH, wait: async () => ({ status: 1 }) }
            }),
        },
        estimateGas: vi.fn(async () => { order.push(['estimate']); return estimate }),
        // Gercek ethers de ucret alanlarini doldurur (burada eski tip: getFeeData gasPrice verir).
        populateTransaction: vi.fn(async (tx) => ({ ...tx, from: ME, nonce: 7, chainId: networkChainId, gasPrice })),
        // GERCEK imza: yurutucu bayti cozup plana karsilastirir. Argumandaki alanlar imzaya girer.
        signTransaction: vi.fn(async (tx) => { if (signError) throw signError; order.push(['sign']); return signSync(tx) }),
        // Eski yol: yurutucu artik sendTransaction KULLANMAZ (imzala-kaydet-yayinla).
        sendTransaction: vi.fn(async () => { throw new Error('sendTransaction kullanilmamali') }),
    }
    const onSubmitted = vi.fn(async () => { order.push(['submitted']) })
    const sleep = vi.fn(async () => {})
    return { token, wallet, onSubmitted, order, sleep, erc20: () => token }
}
const run = (f, over = {}) => executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED, sleep: f.sleep, ...over })
// Yurutucunun gercekte imzaladigi baytin hash'i (rota baska deger/hedef tasiyinca SIGNED_HASH degil).
const signedHashOf = (f) => keccak256(signSync(f.wallet.signTransaction.mock.calls[0][0]))
const nothingSent = (f) => {
    expect(f.token.approve).not.toHaveBeenCalled()
    expect(f.wallet.signTransaction).not.toHaveBeenCalled()
    expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
    expect(f.onSubmitted).not.toHaveBeenCalled()
}

describe('executePrivateDeposit -- native gaz', () => {
    // REVIEW FOCUS 1
    it('suresi dolmus teklifte HICBIR islem gonderilmez', async () => {
        const f = fakes()
        const quote = quoteFixture({ expiresAt: nowSec() - 1 })
        await expect(run(f, { quote })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        nothingSent(f)
    })

    it('bakiye ISTENEN tutara (alicinin 25) yeter ama BRUT cikan tutara (25.25) yetmiyorsa PRIVATE_INSUFFICIENT_BALANCE; hicbir sey gonderilmez', async () => {
        const f = fakes({ tokenBalance: 25000000000000000000n })
        await expect(run(f)).rejects.toThrow('PRIVATE_INSUFFICIENT_BALANCE')
        nothingSent(f)
    })

    it('bakiye tam brut tutara (25.25) esitse gecer; izin da istenen degil BRUT tutardir (25.25), 25 degil', async () => {
        const f = fakes({ tokenBalance: 25250000000000000000n })
        await run(f)
        expect(f.order[0]).toEqual(['approve', '25250000000000000000'])
        expect(f.order.some((o) => o[0] === 'approve' && o[1] === '25000000000000000000')).toBe(false)
    })

    it('token yetmezse PRIVATE_INSUFFICIENT_BALANCE', async () => {
        const f = fakes({ tokenBalance: NEED - 1n })
        await expect(run(f)).rejects.toThrow('PRIVATE_INSUFFICIENT_BALANCE')
        nothingSent(f)
    })

    it('gaz yetmezse PRIVATE_INSUFFICIENT_GAS ve approve gonderilmez', async () => {
        const f = fakes({ native: 1n })
        await expect(run(f)).rejects.toThrow('PRIVATE_INSUFFICIENT_GAS')
        expect(f.token.approve).not.toHaveBeenCalled()
    })

    it('izin yoksa TAM tutarlik approve, tahmin, imza, KAYIT, SONRA yayin', async () => {
        const f = fakes()
        const r = await run(f)
        expect(r.hash).toBe(SIGNED_HASH)
        expect(f.order).toEqual([['approve', String(NEED)], ['estimate'], ['sign'], ['submitted'], ['broadcast', SIGNED]])
        // Kayit, imzali baytlardan HESAPLANAN hash ile yazilir.
        expect(f.onSubmitted).toHaveBeenCalledWith(SIGNED_HASH, SIGNED)
        expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
        // Imzalanan islem gateway'e, TAM yatirma verisiyle gider.
        const tx = f.wallet.populateTransaction.mock.calls[0][0]
        expect(tx.to).toBe(GATEWAY)
        expect(tx.data).toBe(quoteFixture().deposit.data)
        expect(tx.value).toBe(0n)
    })

    // REVIEW FOCUS 5
    it('sifir olmayan ama yetersiz izin: once 0, sonra tam tutar', async () => {
        const f = fakes({ allowance: 5n })
        await run(f)
        expect(f.order.slice(0, 2)).toEqual([['approve', '0'], ['approve', String(NEED)]])
    })

    it('yeterli izin varsa approve yok', async () => {
        const f = fakes({ allowance: NEED })
        await run(f)
        expect(f.token.approve).not.toHaveBeenCalled()
    })

    it('imza dustu: kayit YAZILMAZ ve yayin yapilmaz, izin yalniz teklif tutari kadar', async () => {
        const f = fakes({ signError: new Error('imza yok') })
        await expect(run(f)).rejects.toThrow('imza yok')
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
        expect(f.order).toEqual([['approve', String(NEED)], ['estimate']])
    })

    it('approve beklenirken teklif dolarsa deposit IMZALANMAZ ve kayit yazilmaz', async () => {
        const f = fakes()
        const quote = quoteFixture()
        f.token.approve.mockImplementation(async () => {
            quote.expiresAt = nowSec() - 1
            return { wait: async () => ({ status: 1 }) }
        })
        await expect(run(f, { quote })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('wait() yatirma islemini makbuz icin bekler', async () => {
        const f = fakes({ allowance: NEED })
        const r = await run(f)
        expect(await r.wait()).toEqual({ status: 1 })
    })
})

describe('executePrivateDeposit -- imzala, kaydet, sonra yayinla (B:M10, A:I-2)', () => {
    it('onSubmitted fonksiyon degilse hicbir sey gonderilmez (approve dahil)', async () => {
        for (const bad of [undefined, null, 'x', {}]) {
            const f = fakes()
            await expect(run(f, { onSubmitted: bad })).rejects.toThrow('PRIVATE_FAILED')
            expect(f.token.approve).not.toHaveBeenCalled()
            expect(f.wallet.signTransaction).not.toHaveBeenCalled()
            expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
        }
    })

    it('onSubmitted firlatirsa (kayit yazilamadi) HICBIR sey yayinlanmaz, PRIVATE_FAILED', async () => {
        const f = fakes({ allowance: NEED })
        f.onSubmitted.mockImplementation(async () => { throw new Error('depo yazilamadi') })
        await expect(run(f)).rejects.toThrow('PRIVATE_FAILED')
        expect(f.wallet.signTransaction).toHaveBeenCalledTimes(1)
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('onSubmitted SENKRON firlatirsa da yayin yapilmaz', async () => {
        const f = fakes({ allowance: NEED })
        f.onSubmitted.mockImplementation(() => { throw new Error('senkron') })
        await expect(run(f)).rejects.toThrow('PRIVATE_FAILED')
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('"already known" yaniti BASARIDIR (ayni islem zaten havuzda)', async () => {
        const f = fakes({ allowance: NEED, broadcastError: new Error('already known') })
        const r = await run(f)
        expect(r.hash).toBe(SIGNED_HASH)
        // Cevapta tx yok: makbuz bekleme hash'ten, 1 onayla yapilir.
        expect(await r.wait()).toEqual({ status: 1, hash: SIGNED_HASH })
        expect(f.wallet.provider.waitForTransaction).toHaveBeenCalledWith(SIGNED_HASH, 1)
        expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['ethers INSUFFICIENT_FUNDS kodu', Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }), 'PRIVATE_INSUFFICIENT_GAS'],
        ['insufficient funds metni', new Error('insufficient funds for gas * price + value'), 'PRIVATE_INSUFFICIENT_GAS'],
        ['ethers NONCE_EXPIRED kodu', Object.assign(new Error('x'), { code: 'NONCE_EXPIRED' }), 'PRIVATE_FAILED'],
        ['nonce too low metni', new Error('nonce too low: next nonce 8'), 'PRIVATE_FAILED'],
        ['ethers REPLACEMENT_UNDERPRICED kodu', Object.assign(new Error('x'), { code: 'REPLACEMENT_UNDERPRICED' }), 'PRIVATE_FAILED'],
        ['replacement transaction underpriced metni', new Error('replacement transaction underpriced'), 'PRIVATE_FAILED'],
        ['intrinsic gas too low metni', new Error('intrinsic gas too low'), 'PRIVATE_FAILED'],
        ['exceeds block gas limit metni', new Error('exceeds block gas limit'), 'PRIVATE_FAILED'],
        ['ic ice hata metni (info.error.message)', Object.assign(new Error('could not coalesce error'), { info: { error: { message: 'Nonce too low' } } }), 'PRIVATE_FAILED'],
    ])('kesin ret: %s -> hash + definitive:true + %s', async (_ad, hata, kod) => {
        const f = fakes({ allowance: NEED, broadcastError: hata })
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe(kod)
        expect(e.hash).toBe(SIGNED_HASH)
        expect(e.definitive).toBe(true)
        // Makbuz sorgulanmadi: zincirde basarisiz DEGIL, dugum reddetti (kart ONCHAIN_FAILED olmaz).
        expect(e.onchainFailed).toBeUndefined()
        // Kayit yayindan ONCE yazilmisti.
        expect(f.onSubmitted).toHaveBeenCalledWith(SIGNED_HASH, SIGNED)
    })

    it.each([
        ['ag hatasi', Object.assign(new Error('network error'), { code: 'NETWORK_ERROR' })],
        ['zaman asimi', Object.assign(new Error('timeout'), { code: 'TIMEOUT' })],
        ['sunucu hatasi', Object.assign(new Error('bad response 502'), { code: 'SERVER_ERROR' })],
        ['bilinmeyen', new Error('beklenmeyen bir sey')],
        ['Error olmayan firlatma', 'garip'],
    ])('belirsiz sonuc: %s -> PRIVATE_DEPOSIT_UNCONFIRMED + hash + definitive:false', async (_ad, hata) => {
        const f = fakes({ allowance: NEED, broadcastError: hata })
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
        expect(e.hash).toBe(SIGNED_HASH)
        expect(e.definitive).toBe(false)
        // Belirsiz sonuc: ayni bayt iki kez daha denenir (T14 M4), hepsi belirsizse belirsiz.
        expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(3)
    })
})

describe('executePrivateDeposit -- deposit gaz guvenlikleri (B:I3)', () => {
    it('tahmin DEPOSIT_EXECUTION_PROBE_GAS_CAP uzerindeyse PRIVATE_UNSUPPORTED, hicbir sey imzalanmaz', async () => {
        const f = fakes({ allowance: NEED, estimate: 20000001n })
        await expect(run(f)).rejects.toThrow('PRIVATE_UNSUPPORTED')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('tam sinirdaki tahmin kabul edilir ve gasLimit tavani (25M) asmaz', async () => {
        const f = fakes({ allowance: NEED, estimate: 20000000n })
        await run(f)
        expect(f.wallet.populateTransaction.mock.calls[0][0].gasLimit).toBe(25000000n)
    })

    it('gasLimit = tahmin + %25 pay (depositGasWithHeadroom)', async () => {
        const f = fakes({ allowance: NEED, estimate: 400000n })
        await run(f)
        expect(f.wallet.estimateGas).toHaveBeenCalledTimes(1)
        expect(f.wallet.populateTransaction.mock.calls[0][0].gasLimit).toBe(500000n)
    })

    it('tahmin approve SONRASI yapilir (deposit approve olmadan revert eder)', async () => {
        const f = fakes()
        await run(f)
        const names = f.order.map((o) => o[0])
        expect(names.indexOf('approve')).toBeLessThan(names.indexOf('estimate'))
    })

    it('tahmin firlatirsa (revert) hicbir sey imzalanmaz ve kayit yazilmaz', async () => {
        const f = fakes({ allowance: NEED })
        // Gercek ethers revert'u CALL_EXCEPTION kodlu gelir: saglayici kesintisi DEGILDIR, oldugu gibi gider.
        f.wallet.estimateGas.mockRejectedValue(makeError('execution reverted', 'CALL_EXCEPTION', { action: 'estimateGas', data: null, reason: null, transaction: {}, invocation: null, revert: null }))
        await expect(run(f)).rejects.toThrow('execution reverted')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })
})

describe('executePrivateDeposit -- imzalayan cuzdana ve agina baglama (B:I4)', () => {
    it('teklifin inputAddress i imzalayan cuzdan degilse PRIVATE_QUOTE_MISMATCH, hicbir sey gonderilmez', async () => {
        const f = fakes()
        f.wallet.address = getAddress('0x' + '11'.repeat(20))
        await expect(run(f)).rejects.toThrow('PRIVATE_QUOTE_MISMATCH')
        nothingSent(f)
    })

    it('saglayicinin agi yatirma zinciri degilse PRIVATE_QUOTE_MISMATCH, hicbir sey gonderilmez', async () => {
        const f = fakes({ networkChainId: 1n })
        await expect(run(f)).rejects.toThrow('PRIVATE_QUOTE_MISMATCH')
        nothingSent(f)
    })

    it('ag sorgusu firlatirsa fail-closed: hicbir sey gonderilmez', async () => {
        const f = fakes()
        const asil = new Error('rpc down')
        f.wallet.provider.getNetwork.mockRejectedValue(asil)
        const e = await run(f).catch((x) => x)
        // On-imza RPC hatasi temiz kodla gelir (T24 M2-I1); asil hata cause ta.
        expect(e.message).toBe('PRIVATE_PROVIDER_DOWN')
        expect(e.cause).toBe(asil)
        nothingSent(f)
    })

    it('saklanan teklif beklentilere uymuyorsa (yatirma hedefi degisti) hicbir sey gonderilmez', async () => {
        const f = fakes()
        const quote = quoteFixture({ deposit: { ...quoteFixture().deposit, to: getAddress('0x' + '66'.repeat(20)) } })
        // Gercek cevap deterministik: yatirma hedefi dogrudan rotada gateway'dir ('direct.to' pini).
        await expect(run(f, { quote })).rejects.toThrow('PRIVATE_UNSUPPORTED')
        nothingSent(f)
    })

    it('beklenen tutar saklananla uyusmazsa PRIVATE_QUOTE_MISMATCH', async () => {
        const f = fakes()
        await expect(run(f, { expected: requestFixture({ payoutUsdc: '26' }) })).rejects.toThrow('PRIVATE_QUOTE_MISMATCH')
        nothingSent(f)
    })

    // Imza oncesi sabitleme (gercek yurutucu, taklit degil): beklenen teslim tokeni CAKE iken teklifin dest blogu da
    // CAKE olmali; USDC dest blogu 'dest.echo' ile reddedilir ve hicbir sey imzalanmaz/gonderilmez.
    const CAKE_TOKEN = { chainId: 56, address: getAddress('0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'), symbol: 'CAKE', decimals: 18 }
    const CAKE_DEST = { kind: 'evm', chainId: 56, assetId: CAKE_TOKEN.address, assetSymbol: 'CAKE', assetDecimals: 18, minDestAmount: '6000000000000000000', expectedDestAmount: '6500000000000000000', slippageBps: 100, route: 'cex-direct' }

    it('beklenen outputToken CAKE ve teklifin dest blogu CAKE: sabitleme gecer, USDC mutlu yoluyla ayni akis', async () => {
        const f = fakes()
        const r = await run(f, { quote: quoteFixture({ dest: CAKE_DEST }), expected: requestFixture({ outputToken: CAKE_TOKEN }) })
        expect(r.hash).toBe(SIGNED_HASH)
        expect(f.order).toEqual([['approve', String(NEED)], ['estimate'], ['sign'], ['submitted'], ['broadcast', SIGNED]])
        expect(f.onSubmitted).toHaveBeenCalledWith(SIGNED_HASH, SIGNED)
    })

    it('beklenen outputToken CAKE ama teklif varsayilan USDC dest tasiyor: PRIVATE_QUOTE_MISMATCH (dest.echo), hicbir sey gonderilmez', async () => {
        const f = fakes()
        const err = await run(f, { expected: requestFixture({ outputToken: CAKE_TOKEN }) }).catch((e) => e)
        expect(err.message).toBe('PRIVATE_QUOTE_MISMATCH')
        expect(err.reason).toBe('dest.echo')
        nothingSent(f)
    })

    it('beklentiler verilmezse fail-closed: PRIVATE_UNSUPPORTED, hicbir sey gonderilmez', async () => {
        for (const bad of [undefined, null, {}]) {
            const f = fakes()
            await expect(run(f, { expected: bad })).rejects.toThrow('PRIVATE_UNSUPPORTED')
            nothingSent(f)
        }
    })
})

describe('executePrivateDeposit -- tazelik payi (B:M7) ve approve zaman asimi (B:M2)', () => {
    it('20 sn\'den az kalan teklif baslangicta reddedilir', async () => {
        const f = fakes()
        await expect(run(f, { quote: quoteFixture({ expiresAt: nowSec() + 19 }) })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        nothingSent(f)
    })

    // Saat enjekte edilir (gercek saatle sinira 1-2 sn kala yuklu makinede flake olurdu).
    it('22 sn kalan teklif kabul edilir, 20 sn kalan reddedilir (enjekte saat)', async () => {
        const quote = quoteFixture({ expiresAt: 1_000_000 })
        const f = fakes({ allowance: NEED })
        await run(f, { quote, now: (1_000_000 - 22) * 1000 })
        expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(1)
        const g = fakes({ allowance: NEED })
        await expect(run(g, { quote, now: (1_000_000 - 20) * 1000 })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        nothingSent(g)
    })

    it('approve sirasinda pay 20 sn\'nin altina inerse IMZADAN once durulur', async () => {
        const f = fakes()
        const quote = quoteFixture({ expiresAt: nowSec() + 60 })
        f.token.approve.mockImplementation(async () => {
            quote.expiresAt = nowSec() + 5
            return { wait: async () => ({ status: 1 }) }
        })
        await expect(run(f, { quote })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('assertQuoteFresh ozel pay ile calisir (milisaniye)', () => {
        const q = { expiresAt: 1000 }
        expect(() => assertQuoteFresh(q, 1000 * 1000 - 20000 - 1, 20000)).not.toThrow()
        expect(() => assertQuoteFresh(q, 1000 * 1000 - 20000, 20000)).toThrow('PRIVATE_QUOTE_EXPIRED')
        expect(() => assertQuoteFresh(q, 1000 * 1000 - 1)).not.toThrow()
    })

    it('approve makbuzu 120 sn ile sinirli beklenir (wait(1, 120000))', async () => {
        const f = fakes()
        await run(f)
        const wait = (await f.token.approve.mock.results[0].value).wait
        expect(wait).toHaveBeenCalledWith(1, 120000)
    })

    it('approve makbuz zaman asimi PRIVATE_FAILED verir, deposit imzalanmaz', async () => {
        const f = fakes()
        f.token.approve.mockImplementation(async () => ({ wait: async () => { throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }) } }))
        await expect(run(f)).rejects.toThrow('PRIVATE_FAILED')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('sifirlama approve i da zaman asimina tabidir', async () => {
        const f = fakes({ allowance: 5n })
        const waits = []
        f.token.approve.mockImplementation(async () => { const w = vi.fn(async () => ({ status: 1 })); waits.push(w); return { wait: w } })
        await run(f)
        expect(waits).toHaveLength(2)
        for (const w of waits) expect(w).toHaveBeenCalledWith(1, 120000)
    })
})

describe('executePrivateDeposit -- gercek butce (T14 M3)', () => {
    // Yedek on kontrol (500k x 1 gwei = 5e14) gecer; gercek gasLimit = 1.25 x 4M = 5M -> 5e15 gerekir.
    it('bakiye yedek butceyle gercek butce arasindaysa PRIVATE_INSUFFICIENT_GAS: kayit yok, yayin yok, ticket kullanilabilir', async () => {
        const f = fakes({ allowance: NEED, estimate: 4000000n, native: 10n ** 15n })
        await expect(run(f)).rejects.toThrow('PRIVATE_INSUFFICIENT_GAS')
        expect(f.wallet.estimateGas).toHaveBeenCalledTimes(1)
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
        // Ayni bakiye kucuk tahminle yeter: ret gercekten gasLimit x ucret hesabindan geliyor.
        const g = fakes({ allowance: NEED, estimate: 400000n, native: 10n ** 15n })
        await run(g)
        expect(g.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(1)
    })

    it('EIP-1559 ucreti (maxFeePerGas) gasPrice yerine kullanilir', async () => {
        const f = fakes({ allowance: NEED, estimate: 400000n, native: 10n ** 15n })
        // gasLimit 500k x 3 gwei = 1.5e15 > 1e15
        f.wallet.populateTransaction.mockImplementation(async (tx) => ({ ...tx, from: ME, nonce: 7, chainId: 56n, maxFeePerGas: 3n * 10n ** 9n, maxPriorityFeePerGas: 1n }))
        await expect(run(f)).rejects.toThrow('PRIVATE_INSUFFICIENT_GAS')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
    })

    it('ucret alani olmayan doldurulmus islem fail-closed: imzalanmaz', async () => {
        const f = fakes({ allowance: NEED })
        f.wallet.populateTransaction.mockImplementation(async (tx) => ({ ...tx, from: ME, nonce: 7, chainId: 56n }))
        await expect(run(f)).rejects.toThrow('PRIVATE_FAILED')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('native kaynakta deger de butceye girer', async () => {
        const quote = bridgedNativeQuoteFixture()
        // value 1e16; zincir 1 oldugu icin yedek on kontrol 1e16 + 800k x 1 gwei = 1.08e16 ister:
        // 1.09e16 bunu gecer ve doldurulmus islem kontrolune ulasir. Gercek butce
        // 1e16 + 2.5M (2M tahmin + pay) x 1 gwei = 1.25e16 > 1.09e16 oldugundan reddedilir.
        const native = 10900000000000000n
        const f = fakes({ native, networkChainId: 1n, estimate: 2000000n })
        await expect(run(f, { quote, expected: bridgedNativeRequestFixture() })).rejects.toThrow('PRIVATE_INSUFFICIENT_GAS')
        // Reddin nedeni value + gasLimit x ucret: tahmin ve doldurma calisti, imza/yayin yok.
        expect(f.wallet.estimateGas).toHaveBeenCalledTimes(1)
        expect(f.wallet.populateTransaction).toHaveBeenCalledTimes(1)
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('native kaynakta deger butceye girer: ayni bakiye, kucuk tahminle (1e16 + 5e14 = 1.05e16) basarir', async () => {
        const quote = bridgedNativeQuoteFixture()
        const f = fakes({ native: 10900000000000000n, networkChainId: 1n, estimate: 400000n })
        const r = await run(f, { quote, expected: bridgedNativeRequestFixture() })
        expect(r.hash).toBe(signedHashOf(f))
        expect(f.wallet.estimateGas).toHaveBeenCalledTimes(1)
        expect(f.wallet.signTransaction).toHaveBeenCalledTimes(1)
    })

    it('ikinci tazelik kontrolu IMZADAN hemen once: tahmin sirasinda dolan teklif imzalanmaz', async () => {
        const f = fakes({ allowance: NEED })
        const quote = quoteFixture({ expiresAt: nowSec() + 60 })
        f.wallet.estimateGas.mockImplementation(async () => { quote.expiresAt = nowSec() + 5; return 400000n })
        await expect(run(f, { quote })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })
})

describe('executePrivateDeposit -- koprulu kaynaklar (native yurutucu)', () => {
    it('ERC-20 kopru kaynagi: izin Relay Depository ye tam tutar, deposit Depository ye gider, deger 0', async () => {
        const quote = bridgedErc20QuoteFixture()
        const f = fakes({ tokenBalance: 25300000n, networkChainId: 1n })
        const r = await run(f, { quote, expected: bridgedErc20RequestFixture() })
        expect(r.hash).toBe(signedHashOf(f))
        expect(f.token.approve).toHaveBeenCalledWith(DEPOSITORY, 25300000n)
        expect(f.order.map((o) => o[0])).toEqual(['approve', 'estimate', 'sign', 'submitted', 'broadcast'])
        const tx = f.wallet.populateTransaction.mock.calls[0][0]
        expect(tx.to).toBe(DEPOSITORY)
        expect(tx.value).toBe(0n)
        expect(tx.data).toBe(quote.deposit.data)
    })

    it('ERC-20 kopru kaynaginda token bakiyesi yetmezse hicbir sey gonderilmez', async () => {
        const f = fakes({ tokenBalance: 25299999n, networkChainId: 1n })
        await expect(run(f, { quote: bridgedErc20QuoteFixture(), expected: bridgedErc20RequestFixture() })).rejects.toThrow('PRIVATE_INSUFFICIENT_BALANCE')
        nothingSent(f)
    })

    it('native kopru kaynagi: approve YOK, deger deposit ile gider, KAYIT yayindan once', async () => {
        const quote = bridgedNativeQuoteFixture()
        const f = fakes({ networkChainId: 1n })
        const r = await run(f, { quote, expected: bridgedNativeRequestFixture() })
        expect(r.hash).toBe(signedHashOf(f))
        expect(f.token.approve).not.toHaveBeenCalled()
        expect(f.order.map((o) => o[0])).toEqual(['estimate', 'sign', 'submitted', 'broadcast'])
        const tx = f.wallet.populateTransaction.mock.calls[0][0]
        expect(tx.to).toBe(DEPOSITORY)
        expect(tx.value).toBe(10n ** 16n)
    })

    it('native kopru kaynaginda deger bakiyeyi asarsa PRIVATE_INSUFFICIENT_BALANCE', async () => {
        const f = fakes({ native: 10n ** 16n - 1n, networkChainId: 1n })
        await expect(run(f, { quote: bridgedNativeQuoteFixture(), expected: bridgedNativeRequestFixture() })).rejects.toThrow('PRIVATE_INSUFFICIENT_BALANCE')
        nothingSent(f)
    })
})

// Eski bir oturumda saklanmis koprulu teklif sabit kapaliyken de imzalanamaz: yurutucu ayni kapiyi
// yeniden calistirir ve HICBIR islem (izin, imza, yayin, kayit) gitmez.
describe('executePrivateDeposit -- koprulu kaynaklar KAPALI', () => {
    beforeAll(() => { flags.bridged = false })
    afterAll(() => { flags.bridged = true })

    it('saklanan koprulu ERC-20 ve native teklif PRIVATE_UNSUPPORTED, hicbir sey gonderilmez', async () => {
        const f1 = fakes({ tokenBalance: 25300000n, networkChainId: 1n })
        await expect(run(f1, { quote: bridgedErc20QuoteFixture(), expected: bridgedErc20RequestFixture() })).rejects.toThrow('PRIVATE_UNSUPPORTED')
        nothingSent(f1)
        const f2 = fakes({ networkChainId: 1n })
        await expect(run(f2, { quote: bridgedNativeQuoteFixture(), expected: bridgedNativeRequestFixture() })).rejects.toThrow('PRIVATE_UNSUPPORTED')
        nothingSent(f2)
    })

    it('dogrudan BSC USDC yatirma kapaliyken de calisir', async () => {
        const f = fakes()
        const r = await run(f)
        expect(r.hash).toBe(SIGNED_HASH)
    })
})

describe('executePrivateDeposit -- hata nedeni (T14 M7)', () => {
    it('approve zaman asimi: PRIVATE_FAILED, asil hata cause ta', async () => {
        const f = fakes()
        const asil = Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
        f.token.approve.mockImplementation(async () => ({ wait: async () => { throw asil } }))
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_FAILED')
        expect(e.cause).toBe(asil)
    })

    it('approve revert i: PRIVATE_FAILED, asil hata cause ta', async () => {
        const f = fakes()
        const asil = Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION', receipt: { status: 0 } })
        f.token.approve.mockImplementation(async () => ({ wait: async () => { throw asil } }))
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_FAILED')
        expect(e.cause).toBe(asil)
    })

    it('kayit yazimi hatasi: PRIVATE_FAILED, asil hata cause ta, yayin yok', async () => {
        const f = fakes({ allowance: NEED })
        const asil = new Error('depo yazilamadi')
        f.onSubmitted.mockImplementation(async () => { throw asil })
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_FAILED')
        expect(e.cause).toBe(asil)
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })
})

// Gercek ethers JsonRpcProvider: yalniz ag katmani (_send) taklit edilir. Dugum hata mesajlari
// ethers'in kendi hata katmanindan (getRpcError) gecerek yurutucuye ulasir.
class ScriptedRpcProvider extends JsonRpcProvider {
    // `node`: gercek bir dugumun yanitlari; verilmezse yalniz yayin akisi (eth_blockNumber + sendRaw) calisir.
    constructor(script, node = null) {
        super('http://127.0.0.1:1', 56, { staticNetwork: true })
        this.script = script
        this.sent = []
        this.node = node
        this.calls = []
    }
    async _send(payload) {
        return (Array.isArray(payload) ? payload : [payload]).map((p) => {
            this.calls.push(p)
            if (p.method === 'eth_blockNumber') return { id: p.id, result: '0x10' }
            const hex = (n) => '0x' + BigInt(n).toString(16)
            const n = this.node
            if (n && p.method === 'eth_chainId') return { id: p.id, result: hex(56) }
            if (n && p.method === 'eth_getTransactionCount') return { id: p.id, result: hex(n.nonce) }
            if (n && p.method === 'eth_estimateGas') return { id: p.id, result: hex(n.estimate) }
            if (n && p.method === 'eth_gasPrice') return { id: p.id, result: hex(n.gasPrice) }
            if (n && p.method === 'eth_maxPriorityFeePerGas') return { id: p.id, result: hex(1n) }
            if (n && p.method === 'eth_getBalance') return { id: p.id, result: hex(n.balance) }
            // eth_call (imza oncesi benzetim): varsayilan basarili, node.callError revert.
            if (p.method === 'eth_call') return n?.callError ? { id: p.id, error: { code: 3, message: 'execution reverted', data: '0x' } } : { id: p.id, result: '0x' }
            if (n && p.method === 'eth_getBlockByNumber') return { id: p.id, result: n.block }
            if (p.method !== 'eth_sendRawTransaction') return { id: p.id, error: { code: -32601, message: 'method not found' } }
            this.sent.push(p.params[0])
            const step = this.script.shift()
            if (step) return { id: p.id, error: { code: -32000, message: step } }
            return { id: p.id, result: keccak256(p.params[0]) }
        })
    }
}
// Ag/ust akim hatasi: dugum islemi kabul etti mi bilinmez (ethers UNKNOWN_ERROR sarar).
const timeoutError = () => 'upstream request timeout'
async function realShape(script, over = {}) {
    // Plana UYAN ve fakes()'in doldurdugu islemle (eski tip: gasPrice, gasLimit 500000, nonce 7) AYNI turde,
    // gasLimit ve nonce'ta imzali islem (yurutucu imzalanan baytlari plana ve doldurulan islemle karsilastirir).
    const signed = await REAL_KEY_WALLET.signTransaction({
        type: 0, chainId: 56, nonce: 7, to: GATEWAY, data: quoteFixture().deposit.data, value: 0,
        gasLimit: 500000, gasPrice: DEFAULT_GAS_PRICE,
    })
    const f = fakes({ allowance: NEED, ...over })
    const provider = new ScriptedRpcProvider(script)
    Object.assign(provider, { getBalance: f.wallet.provider.getBalance, getFeeData: f.wallet.provider.getFeeData })
    f.wallet.provider = provider
    f.wallet.signTransaction = vi.fn(async () => signed)
    return { f, provider, signed }
}

describe('executePrivateDeposit -- yayin siniflamasi, gercek ethers hata sekilleri (T14 M4)', () => {
    it.each([
        ['transaction underpriced', 'PRIVATE_FAILED'],
        ['max fee per gas less than block base fee: maxFeePerGas: 1, baseFee: 5', 'PRIVATE_FAILED'],
        ['fee cap less than block base fee', 'PRIVATE_FAILED'],
        ['insufficient funds for gas * price + value', 'PRIVATE_INSUFFICIENT_GAS'],
        ['nonce too low', 'PRIVATE_FAILED'],
    ])('dugum reddi "%s" -> kesin ret, TEK yayin denemesi', async (mesaj, kod) => {
        const { f, provider, signed } = await realShape([mesaj])
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe(kod)
        expect(e.definitive).toBe(true)
        expect(e.hash).toBe(keccak256(signed))
        expect(provider.sent).toEqual([signed])
        expect(f.sleep).not.toHaveBeenCalled()
        expect(f.onSubmitted).toHaveBeenCalledWith(keccak256(signed), signed)
    })

    it('belirsiz sonuc: AYNI imzali bayt uc kez gonderilir, aralarinda beklenir, hepsi belirsizse PRIVATE_DEPOSIT_UNCONFIRMED', async () => {
        const { f, provider, signed } = await realShape([timeoutError(), timeoutError(), timeoutError()])
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
        expect(e.definitive).toBe(false)
        expect(e.hash).toBe(keccak256(signed))
        expect(provider.sent).toEqual([signed, signed, signed])
        expect(f.sleep).toHaveBeenCalledTimes(2)
        for (const [ms] of f.sleep.mock.calls) expect(ms).toBeGreaterThanOrEqual(1000)
        // Kayit yalniz BIR kez, yayindan once yazildi.
        expect(f.onSubmitted).toHaveBeenCalledTimes(1)
    })

    it('ilk deneme belirsiz, ikincisi basarili: gitti sayilir (tekrar zararsiz)', async () => {
        const { f, provider, signed } = await realShape([timeoutError(), null])
        const r = await run(f)
        expect(r.hash).toBe(keccak256(signed))
        expect(provider.sent).toEqual([signed, signed])
        expect(f.sleep).toHaveBeenCalledTimes(1)
    })

    it('ilk deneme belirsiz, ikincisi "already known": gitti sayilir ve makbuz hash ten beklenir', async () => {
        const { f, signed } = await realShape([timeoutError(), 'already known'])
        f.wallet.provider.waitForTransaction = vi.fn(async (hash) => ({ status: 1, hash }))
        const r = await run(f)
        expect(r.hash).toBe(keccak256(signed))
        await r.wait()
        expect(f.wallet.provider.waitForTransaction).toHaveBeenCalledWith(keccak256(signed), 1)
    })

    it('ilk deneme belirsiz, ikincisi kesin ret (underpriced): kesin sayilir ve durulur', async () => {
        const { f, provider } = await realShape([timeoutError(), 'transaction underpriced', null])
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_FAILED')
        expect(e.definitive).toBe(true)
        expect(provider.sent).toHaveLength(2)
    })

    // Ilk gonderim dugume ulasip madenlenmis olabilir: ayni bayt icin "nonce too low" bu islemin
    // KENDISI olabilir. Kesin ret sayilirsa gitmis bir yatirma "basarisiz" gosterilirdi.
    it('ilk deneme belirsiz, sonra "nonce too low": kesin ret SAYILMAZ, belirsiz kalir', async () => {
        const { f } = await realShape([timeoutError(), 'nonce too low', 'nonce too low'])
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
        expect(e.definitive).toBe(false)
    })

    // T20 M4: takili RPC global islem kuyrugunu dakikalarca tutmasin. Her deneme 15 sn (PRIVATE_RPC_TIMEOUT_MS) ile sinirli,
    // zaman asimi belirsizdir, sonraki deneme AYNI imzali bayti yollar.
    describe('yayin zaman asimi (T20 M4)', () => {
        const hang = () => new Promise(() => {})
        it('hic cevap vermeyen yayin: uc deneme x 15 sn sonra PRIVATE_DEPOSIT_UNCONFIRMED, ayni bayt', async () => {
            vi.useFakeTimers()
            try {
                const f = fakes({ allowance: NEED })
                f.wallet.provider.broadcastTransaction = vi.fn(hang)
                const p = run(f).catch((x) => x)
                await vi.advanceTimersByTimeAsync(PRIVATE_RPC_TIMEOUT_MS - 1)
                expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(1)
                await vi.advanceTimersByTimeAsync(1)
                expect(f.sleep).toHaveBeenCalledTimes(1)
                await vi.advanceTimersByTimeAsync(PRIVATE_RPC_TIMEOUT_MS)
                await vi.advanceTimersByTimeAsync(PRIVATE_RPC_TIMEOUT_MS)
                const e = await p
                expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
                expect(e.definitive).toBe(false)
                expect(e.hash).toBe(SIGNED_HASH)
                const calls = f.wallet.provider.broadcastTransaction.mock.calls
                expect(calls).toHaveLength(3)
                for (const [raw] of calls) expect(raw).toBe(SIGNED)
                // Kayit yayindan once ve yalniz bir kez yazildi.
                expect(f.onSubmitted).toHaveBeenCalledTimes(1)
            } finally {
                vi.useRealTimers()
            }
        })

        it('ilk deneme takilir, ikincisi basarili: gitti sayilir', async () => {
            vi.useFakeTimers()
            try {
                const f = fakes({ allowance: NEED })
                let n = 0
                f.wallet.provider.broadcastTransaction = vi.fn(async () => {
                    if (n++ === 0) return hang()
                    return { hash: SIGNED_HASH, wait: async () => ({ status: 1 }) }
                })
                const p = run(f)
                await vi.advanceTimersByTimeAsync(PRIVATE_RPC_TIMEOUT_MS)
                const r = await p
                expect(r.hash).toBe(SIGNED_HASH)
                expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(2)
            } finally {
                vi.useRealTimers()
            }
        })

        // T21 M7c: sure dolduktan SONRA reddedilen yayin yakalanmamis ret (unhandledRejection) uretmemeli.
        it('suresi dolduktan sonra reddeden yayin yakalanmamis ret uretmez (gec sonuc yutulur)', async () => {
            const unhandled = []
            const onUnhandled = (reason) => unhandled.push(reason)
            process.on('unhandledRejection', onUnhandled)
            vi.useFakeTimers()
            try {
                const f = fakes({ allowance: NEED })
                let n = 0
                f.wallet.provider.broadcastTransaction = vi.fn(() => {
                    if (n++ === 0) return new Promise((_, reject) => setTimeout(() => reject(new Error('gec ret')), 20000))
                    return Promise.resolve({ hash: SIGNED_HASH, wait: async () => ({ status: 1 }) })
                })
                const p = run(f)
                await vi.advanceTimersByTimeAsync(PRIVATE_RPC_TIMEOUT_MS)
                const r = await p
                expect(r.hash).toBe(SIGNED_HASH)
                // Ilk yayin 20. sn'de reddedilir (zaman asimindan 5 sn sonra).
                await vi.advanceTimersByTimeAsync(10000)
            } finally {
                vi.useRealTimers()
                for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
                process.off('unhandledRejection', onUnhandled)
            }
            expect(unhandled).toEqual([])
        })

        it('zamanlayici temizlenir: hizli basari bekleyen zamanlayici birakmaz', async () => {
            vi.useFakeTimers()
            try {
                const f = fakes({ allowance: NEED })
                await run(f)
                expect(vi.getTimerCount()).toBe(0)
            } finally {
                vi.useRealTimers()
            }
        })
    })

    // T20 S1 (onaylandi): belirsiz denemeden sonra "nonce too low" kesin degildir; makbuz bir kez sorgulanir.
    describe('nonce too low sonrasi makbuz (T20 S1)', () => {
        const nonceLow = () => new Error('nonce too low: next nonce 8')
        const setup = (receipt) => {
            const f = fakes({ allowance: NEED, broadcastScript: [new Error('upstream request timeout'), nonceLow(), nonceLow()] })
            f.wallet.provider.getTransactionReceipt = vi.fn(async () => receipt)
            return f
        }

        it('makbuz status 1: gitti sayilir, makbuz hash ten beklenir', async () => {
            const f = setup({ status: 1 })
            const r = await run(f)
            expect(r.hash).toBe(SIGNED_HASH)
            expect(f.wallet.provider.getTransactionReceipt).toHaveBeenCalledTimes(1)
            expect(f.wallet.provider.getTransactionReceipt).toHaveBeenCalledWith(SIGNED_HASH)
            await r.wait()
            expect(f.wallet.provider.waitForTransaction).toHaveBeenCalledWith(SIGNED_HASH, 1)
            // makbuz bulununca baska yayin denenmez
            expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(2)
        })

        it('makbuz status 0: zincirde basarisiz = kesin ret (PRIVATE_FAILED, hash ile)', async () => {
            const f = setup({ status: 0 })
            const e = await run(f).catch((x) => x)
            expect(e.message).toBe('PRIVATE_FAILED')
            expect(e.definitive).toBe(true)
            expect(e.hash).toBe(SIGNED_HASH)
            // Zincirde status-0 makbuzu: cagirana kart icin soylenir (T21 M6); baska kesin retlerde yok.
            expect(e.onchainFailed).toBe(true)
            expect(f.wallet.provider.getTransactionReceipt).toHaveBeenCalledTimes(1)
        })

        it('makbuz yok: PRIVATE_DEPOSIT_UNCONFIRMED kalir, makbuz TEK kez sorgulanir', async () => {
            const f = setup(null)
            const e = await run(f).catch((x) => x)
            expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
            expect(e.definitive).toBe(false)
            expect(f.wallet.provider.getTransactionReceipt).toHaveBeenCalledTimes(1)
            expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(3)
        })

        it('makbuz sorgusu firlatirsa belirsiz kalir', async () => {
            const f = setup(null)
            f.wallet.provider.getTransactionReceipt = vi.fn(async () => { throw new Error('rpc down') })
            const e = await run(f).catch((x) => x)
            expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
        })

        it('ilk deneme kesin nonce too low ise (belirsizlik yok) makbuz sorgulanmaz, kesin ret', async () => {
            const f = fakes({ allowance: NEED, broadcastScript: [nonceLow()] })
            f.wallet.provider.getTransactionReceipt = vi.fn(async () => ({ status: 1 }))
            const e = await run(f).catch((x) => x)
            expect(e.message).toBe('PRIVATE_FAILED')
            expect(e.definitive).toBe(true)
            expect(f.wallet.provider.getTransactionReceipt).not.toHaveBeenCalled()
        })

        it('makbuz sorgusu takilirsa 15 sn sonra belirsiz kalir', async () => {
            vi.useFakeTimers()
            try {
                const f = setup(null)
                f.wallet.provider.getTransactionReceipt = vi.fn(() => new Promise(() => {}))
                const p = run(f).catch((x) => x)
                await vi.advanceTimersByTimeAsync(25000)
                const e = await p
                expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
            } finally {
                vi.useRealTimers()
            }
        })
    })

    it('"already known" ilk denemede de tek yayinla basaridir', async () => {
        const { f, provider, signed } = await realShape(['already known'])
        const r = await run(f)
        expect(r.hash).toBe(keccak256(signed))
        expect(provider.sent).toHaveLength(1)
    })
})

describe('executePrivateDeposit -- ATS', () => {
    it('approve + deposit TEK op, cuzdandan islem gonderilmez, native gaz aranmaz', async () => {
        const f = fakes({ native: 0n })
        const atsExecute = vi.fn(async () => ({ txHash: '0xats' }))
        const r = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })
        expect(r.hash).toBe('0xats')
        const { chainId, calls } = atsExecute.mock.calls[0][0]
        expect(chainId).toBe(56)
        expect(calls).toHaveLength(2)
        expect(calls[1].to).toBe(GATEWAY)
        expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).toHaveBeenCalledWith('0xats')
    })

    it('atsExecute hem op hash hem zincir hash donerse ZINCIR hash kaydedilir', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async () => ({ hash: '0xuserop', txHash: '0xchain' }))
        const r = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })
        expect(r.hash).toBe('0xchain')
        expect(f.onSubmitted).toHaveBeenCalledWith('0xchain')
    })

    it('ATS yolunda da suresi dolmus teklif HICBIR sey calistirmaz', async () => {
        const f = fakes()
        const atsExecute = vi.fn()
        const quote = quoteFixture({ expiresAt: Math.floor(Date.now() / 1000) - 1 })
        await expect(executePrivateDeposit({ quote, wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        expect(atsExecute).not.toHaveBeenCalled()
    })

    it('atsExecute verilmemisse hicbir sey gonderilmez (fail-closed)', async () => {
        const f = fakes()
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('PRIVATE_UNSUPPORTED')
        expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    // M1 (Task 7 incelemesi): op relay edildi ama sonuc dogrulanamadi ya da basarisiz.
    // Yatirma zincire gitmis olabilir: hash'in kaydi KAYBOLMAZ, hata yine yukari gider.
    it('op relay edildi sonra atsExecute firlatti: yatirma hash i yine de kaydedilir', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xrelayed', kind: 'transfer' })
            throw new Error('transfer islemi basarisiz veya sonucu dogrulanamadi')
        })
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('sonucu dogrulanamadi')
        expect(f.onSubmitted).toHaveBeenCalledTimes(1)
        expect(f.onSubmitted).toHaveBeenCalledWith('0xrelayed')
    })

    it('onRelayed yazimi bitmeden hata yukari GITMEZ (kayit once tamamlanir)', async () => {
        const f = fakes()
        const sirasi = []
        f.onSubmitted.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); sirasi.push('yazildi') })
        const atsExecute = vi.fn(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xrelayed', kind: 'transfer' })
            throw new Error('dogrulanamadi')
        })
        await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch(() => sirasi.push('hata'))
        expect(sirasi).toEqual(['yazildi', 'hata'])
    })

    it('relay edilip sonra basariyla donerse kayit TEK kez yazilir', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xchain', kind: 'transfer' })
            return { hash: '0xuserop', txHash: '0xchain' }
        })
        const r = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })
        expect(r.hash).toBe('0xchain')
        expect(f.onSubmitted).toHaveBeenCalledTimes(1)
    })

    // Bootstrap modunda op1 (kurulum) da relay edilir; onun hash'i yatirma DEGILDIR.
    it('bootstrap op1 in hash i yatirma olarak KAYDEDILMEZ', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xkurulum', kind: 'bootstrap' })
            throw new Error('kurulum islemi basarisiz; transfer gonderilmedi')
        })
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('kurulum')
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('ATS sonucunda hic hash yoksa kayit yazilmaz ve hashsiz PRIVATE_DEPOSIT_UNCONFIRMED firlar', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async () => ({}))
        const e = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch((x) => x)
        expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
        expect(e.hash).toBeUndefined()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    // Son inceleme I1: hash'siz ama op'un calismis olabilecegi RED (nonce ilerledi / hak bitti).
    it('hash siz opMayHaveRun reddi -> hashsiz PRIVATE_DEPOSIT_UNCONFIRMED, kayit yazilmaz', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async () => { throw Object.assign(new Error('islem sonucu dogrulanamadi'), { opMayHaveRun: true, userOpHash: '0xuserop' }) })
        const e = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch((x) => x)
        expect(e.message).toBe('PRIVATE_DEPOSIT_UNCONFIRMED')
        expect(e.hash).toBeUndefined()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('opMayHaveRun OLMAYAN hash siz red oldugu gibi yukari gider (yatirma gitmemistir)', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async () => { throw Object.assign(new Error('relay reddetti'), { userOpHash: '0xuserop' }) })
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('relay reddetti')
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    // B:M8: userOp hash'i deposit hash'i DEGILDIR; yalniz o varsa kayit yazilmaz.
    it('yalniz userOp hash i donerse (txHash yok) kayit yazilmaz, UNCONFIRMED firlar', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async () => ({ hash: '0xuserop' }))
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('PRIVATE_DEPOSIT_UNCONFIRMED')
        expect(f.onSubmitted).not.toHaveBeenCalledWith('0xuserop')
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    // B:I1: sendOneOp relay success:false hatasinda onRelayed'i unconfirmed ile cagirir; hash kaydedilir.
    it('relay basarisiz (unconfirmed) ama hash var: transfer hash i kaydedilir, hata yukari gider', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xfailedrelay', kind: 'transfer', unconfirmed: true })
            throw Object.assign(new Error('relay basarisiz (tx 0xfailedrelay)'), { txHash: '0xfailedrelay' })
        })
        const e = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch((x) => x)
        expect(e.message).toContain('relay basarisiz')
        expect(f.onSubmitted).toHaveBeenCalledTimes(1)
        expect(f.onSubmitted).toHaveBeenCalledWith('0xfailedrelay')
    })

    it('bootstrap op unun unconfirmed hash i da yatirma olarak KAYDEDILMEZ', async () => {
        const f = fakes()
        const atsExecute = vi.fn(async ({ onRelayed }) => {
            onRelayed({ txHash: '0xkurulum', kind: 'bootstrap', unconfirmed: true })
            throw Object.assign(new Error('relay basarisiz'), { txHash: '0xkurulum' })
        })
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('relay basarisiz')
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    // T11 M7: kayit yazimi bitmeden basari DONMEZ; donen hash yalniz yazim bittikten sonra bilinir.
    it('kayit yazimi bitene dek yurutucu donmez; donen hash yazilan hash tir', async () => {
        const f = fakes()
        let release
        const gate = new Promise((r) => { release = r })
        const adim = []
        f.onSubmitted.mockImplementation(async (h) => { await gate; adim.push('yazildi:' + h) })
        const atsExecute = vi.fn(async ({ onRelayed }) => { onRelayed({ txHash: '0xchain', kind: 'transfer' }); return { txHash: '0xchain' } })
        const p = executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).then((r) => { adim.push('dondu'); return r })
        await new Promise((r) => setTimeout(r, 10))
        expect(adim).toEqual([])
        release()
        const r = await p
        expect(adim).toEqual(['yazildi:0xchain', 'dondu'])
        expect(r.hash).toBe('0xchain')
    })

    it('kayit yazimi reddedilirse yurutucu hash li hatayla biter, basari donmez', async () => {
        const f = fakes()
        f.onSubmitted.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('depo yok') })
        const atsExecute = vi.fn(async ({ onRelayed }) => { onRelayed({ txHash: '0xchain', kind: 'transfer' }); return { txHash: '0xchain' } })
        const e = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch((x) => x)
        expect(e.message).toBe('depo yok')
        expect(e.hash).toBe('0xchain')
        expect(f.onSubmitted).toHaveBeenCalledTimes(1)
    })

    // B:M8: native kaynakta (ETH koprusu) deposit.value op'tan gider; native bakiye yetmezse
    // ucret tahsil edilmeden ONCE durulur (assertSourceFunds ATS yolunda da kosar).
    it('ATS: deposit.value native bakiyeyi asarsa PRIVATE_INSUFFICIENT_BALANCE, atsExecute cagrilmaz', async () => {
        const f = fakes({ native: 9999999999999999n })
        const quote = bridgedNativeQuoteFixture()
        const atsExecute = vi.fn(async () => ({ txHash: '0xats' }))
        const expected = { ...EXPECTED, sourceChainId: 1, sourceAsset: 'ETH' }
        await expect(executePrivateDeposit({ quote, wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected })).rejects.toThrow('PRIVATE_INSUFFICIENT_BALANCE')
        expect(atsExecute).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('ATS: deposit.value native bakiyeyle karsilaniyorsa op calisir', async () => {
        const f = fakes({ native: 10n ** 16n })
        const quote = bridgedNativeQuoteFixture()
        const atsExecute = vi.fn(async () => ({ txHash: '0xats' }))
        const expected = { ...EXPECTED, sourceChainId: 1, sourceAsset: 'ETH' }
        const r = await executePrivateDeposit({ quote, wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected })
        expect(r.hash).toBe('0xats')
        expect(atsExecute.mock.calls[0][0].calls).toHaveLength(1)
    })
})

// T6 (7.6 madde 1): ATS kolunda artik izin. Cagri listesi atsCallsFromPlan(plan, izin) ile secilir; izin ya cagiranin dondurdugu
// degerdir (atsAllowanceRaw: ucret teklifindeki liste) ya da yurutucu o anda cuzdan saglayicisindan okur. Native kol DEGISMEZ.
describe('readApprovalAllowance', () => {
    const approval = { token: getAddress('0x' + 'aa'.repeat(20)), spender: GATEWAY, amount: NEED }
    const provider = { tag: 'saglayici' }

    it('sahte erc20 ile izni bigint olarak okur (token, saglayici ve (owner, spender) ile)', async () => {
        const allowance = vi.fn(async () => 7n)
        const erc20 = vi.fn(() => ({ allowance }))
        expect(await readApprovalAllowance({ provider, owner: ME, approval, erc20 })).toBe(7n)
        expect(erc20).toHaveBeenCalledWith(approval.token, provider)
        expect(allowance).toHaveBeenCalledWith(ME, GATEWAY)
    })

    it('approval yoksa (native kaynak) null doner ve hicbir okuma yapmaz', async () => {
        const erc20 = vi.fn()
        expect(await readApprovalAllowance({ provider, owner: ME, approval: null, erc20 })).toBe(null)
        expect(await readApprovalAllowance({ provider, owner: ME, erc20 })).toBe(null)
        expect(erc20).not.toHaveBeenCalled()
    })

    it('saglayici hatasi PRIVATE_PROVIDER_DOWN olur', async () => {
        const erc20 = () => ({ allowance: async () => { throw new Error('ag koptu') } })
        await expect(readApprovalAllowance({ provider, owner: ME, approval, erc20 })).rejects.toThrow('PRIVATE_PROVIDER_DOWN')
    })
})

describe('executePrivateDeposit -- ATS artik izin', () => {
    const atsRun = (f, over = {}) => {
        const atsExecute = vi.fn(async () => ({ txHash: '0xats' }))
        return { atsExecute, p: executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED, ...over }) }
    }
    const approveArgs = (c) => new Interface(['function approve(address spender, uint256 amount)']).decodeFunctionData('approve', c.data).map(String)

    it('atsAllowanceRaw artik izin (5n) verilince atsExecute uc cagri alir; izin RPC den OKUNMAZ', async () => {
        const f = fakes({ allowance: 999n })
        const { atsExecute, p } = atsRun(f, { atsAllowanceRaw: 5n })
        await p
        const { calls } = atsExecute.mock.calls[0][0]
        expect(calls).toHaveLength(3)
        expect(approveArgs(calls[0])).toEqual([GATEWAY, '0'])
        expect(approveArgs(calls[1])).toEqual([GATEWAY, String(NEED)])
        expect(calls[2].to).toBe(GATEWAY)
        expect(f.token.allowance).not.toHaveBeenCalled()
    })

    it('atsAllowanceRaw tutara esit: tek cagri (deposit), izin okunmaz', async () => {
        const f = fakes({ allowance: 5n })
        const { atsExecute, p } = atsRun(f, { atsAllowanceRaw: NEED })
        await p
        const { calls } = atsExecute.mock.calls[0][0]
        expect(calls).toHaveLength(1)
        expect(calls[0].to).toBe(GATEWAY)
        expect(f.token.allowance).not.toHaveBeenCalled()
    })

    it('atsAllowanceRaw 0n: iki cagri [approve(tutar), deposit]', async () => {
        const f = fakes({ allowance: 5n })
        const { atsExecute, p } = atsRun(f, { atsAllowanceRaw: 0n })
        await p
        const { calls } = atsExecute.mock.calls[0][0]
        expect(calls).toHaveLength(2)
        expect(approveArgs(calls[0])).toEqual([GATEWAY, String(NEED)])
    })

    it('atsAllowanceRaw verilmezse (undefined ve null) izin cuzdan saglayicisindan o anda okunur ve ayni kural uygulanir', async () => {
        for (const v of [undefined, null]) {
            const f = fakes({ allowance: 5n })
            const { atsExecute, p } = atsRun(f, { atsAllowanceRaw: v })
            await p
            expect(atsExecute.mock.calls[0][0].calls).toHaveLength(3)
            expect(f.token.allowance).toHaveBeenCalledWith(ME, GATEWAY)
        }
        const g = fakes({ allowance: NEED })
        const r = atsRun(g)
        await r.p
        expect(r.atsExecute.mock.calls[0][0].calls).toHaveLength(1)
        const h = fakes({ allowance: 0n })
        const s = atsRun(h)
        await s.p
        expect(s.atsExecute.mock.calls[0][0].calls).toHaveLength(2)
    })

    it('izin okumasi basarisizsa PRIVATE_PROVIDER_DOWN, atsExecute cagrilmaz', async () => {
        const f = fakes()
        f.token.allowance.mockImplementation(async () => { throw new Error('ag koptu') })
        const { atsExecute, p } = atsRun(f)
        await expect(p).rejects.toThrow('PRIVATE_PROVIDER_DOWN')
        expect(atsExecute).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('native kaynakta (approval yok) izin okunmaz: tek cagri', async () => {
        const f = fakes({ native: 10n ** 16n })
        const atsExecute = vi.fn(async () => ({ txHash: '0xats' }))
        const expected = { ...EXPECTED, sourceChainId: 1, sourceAsset: 'ETH' }
        await executePrivateDeposit({ quote: bridgedNativeQuoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected, atsAllowanceRaw: 5n })
        expect(atsExecute.mock.calls[0][0].calls).toHaveLength(1)
        expect(f.token.allowance).not.toHaveBeenCalled()
    })

    it('native gaz kolu DEGISMEZ: atsAllowanceRaw yok sayilir, ensureExactAllowance izni sifirlayip tam tutar yazar', async () => {
        const f = fakes({ allowance: 5n })
        await run(f, { atsAllowanceRaw: NEED })
        expect(f.order.slice(0, 2)).toEqual([['approve', '0'], ['approve', String(NEED)]])
    })
})

describe('executePrivateDeposit -- ATS kayit sozlesmesi ve sabitleme', () => {
    it('onSubmitted SENKRON firlatirsa yurutucu basari DONMEZ ve hata hash i tasir (B:M4)', async () => {
        const f = fakes()
        f.onSubmitted.mockImplementation(() => { throw new Error('depo yok') })
        const atsExecute = vi.fn(async ({ onRelayed }) => { onRelayed({ txHash: '0xchain', kind: 'transfer' }); return { txHash: '0xchain' } })
        const e = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch((x) => x)
        expect(e.message).toBe('depo yok')
        expect(e.hash).toBe('0xchain')
    })

    it('onSubmitted reddedilirse (relay sonrasi) hata hash i tasir', async () => {
        const f = fakes()
        f.onSubmitted.mockRejectedValue(new Error('depo yok'))
        const atsExecute = vi.fn(async () => ({ txHash: '0xchain' }))
        const e = await executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch((x) => x)
        expect(e.message).toBe('depo yok')
        expect(e.hash).toBe('0xchain')
    })

    it('ATS yolunda da imzalayan cuzdan teklifin inputAddress i degilse hicbir op calistirilmaz', async () => {
        const f = fakes()
        f.wallet.address = getAddress('0x' + '11'.repeat(20))
        const atsExecute = vi.fn()
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(atsExecute).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('ATS yolunda beklenti verilmezse fail-closed', async () => {
        const f = fakes()
        const atsExecute = vi.fn()
        await expect(executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20 })).rejects.toThrow('PRIVATE_UNSUPPORTED')
        expect(atsExecute).not.toHaveBeenCalled()
    })
})

describe('executePrivateDeposit -- gecerli sure sart (T7-M5)', () => {
    // Suresi okunamayan teklif "hic dolmaz" sayilmaz: fail-closed.
    it.each([[undefined], [null], [''], ['yarin'], [0], [-5], [NaN]])('expiresAt=%s ise PRIVATE_QUOTE_EXPIRED, para gitmez', async (bad) => {
        const f = fakes()
        const quote = quoteFixture({ expiresAt: bad })
        await expect(executePrivateDeposit({ quote, wallet: f.wallet, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED })).rejects.toThrow('PRIVATE_QUOTE_EXPIRED')
        expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })
})

// Iade cuzdani: yatirmayla ayni imzala-kaydet-yayinla protokolu. Gercek anahtarla imzalar (yurutucu baytlari cozer).
const REFUND_TICKET = '0x' + '01'.repeat(32)
const REFUND_IFACE_T = new Interface(['function refund(bytes32 ticket)'])
function refundFakes({ native = 10n ** 18n, networkChainId = 56n, broadcastScript = null, populate = null } = {}) {
    const order = []
    const wallet = {
        address: ME,
        provider: {
            getNetwork: vi.fn(async () => ({ chainId: networkChainId })),
            getBalance: vi.fn(async () => native),
            getTransactionReceipt: vi.fn(async () => null),
            waitForTransaction: vi.fn(async (hash) => ({ status: 1, hash })),
            broadcastTransaction: vi.fn(async (raw) => {
                const step = broadcastScript ? broadcastScript.shift() : null
                if (step) throw step
                order.push(['broadcast', raw])
                return { hash: keccak256(raw), wait: async () => ({ status: 1 }) }
            }),
        },
        populateTransaction: vi.fn(async (tx) => {
            if (populate) return populate(tx)
            return { ...tx, from: ME, nonce: 3, chainId: networkChainId, gasLimit: 90000n, gasPrice: DEFAULT_GAS_PRICE }
        }),
        signTransaction: vi.fn(async (tx) => { order.push(['sign']); return signSync(tx) }),
        sendTransaction: vi.fn(async () => { throw new Error('sendTransaction kullanilmamali') }),
    }
    const onSubmitted = vi.fn(async () => { order.push(['submitted']) })
    const sleep = vi.fn(async () => {})
    return { wallet, onSubmitted, order, sleep }
}
const refund = (f, over = {}) => sendRefund({ wallet: f.wallet, gateway: GATEWAY, ticket: REFUND_TICKET, onSubmitted: f.onSubmitted, sleep: f.sleep, ...over })
const refundNothingSent = (f) => {
    expect(f.wallet.signTransaction).not.toHaveBeenCalled()
    expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
    expect(f.onSubmitted).not.toHaveBeenCalled()
}

// GECERLI (EIP-55 saglama toplamli) ama kanonik gateway'den bir hane farkli adres: ilk korumayi
// (adres bicimi) gecip kanonik esitlik dalina ulasir (T16 M6).
const NEAR_CANONICAL = getAddress(GATEWAY.slice(0, -1).toLowerCase() + (GATEWAY.toLowerCase().endsWith('1') ? '2' : '1'))

describe('sendRefund -- gateway dogrulamasi (T7-M4)', () => {
    it('yakin-kanonik test adresi gecerli bir adrestir ve kanonik gateway den farklidir', () => {
        expect(isAddress(NEAR_CANONICAL)).toBe(true)
        expect(NEAR_CANONICAL).not.toBe(GATEWAY)
    })

    // B:M1: onekesiz adres de normalize edilir ('0'.repeat(40) sifir adrese giderdi); hedef kanonik BSC
    // gateway'ine (ya da emekli listesine) esit olmali.
    it.each([
        [undefined], [null], [''], ['0xevil'], ['0x' + '0'.repeat(40)], [123], ['0x' + 'ab'.repeat(19)],
        ['0'.repeat(40)], ['11'.repeat(20)], ['0x' + '11'.repeat(20)], ['ab'.repeat(20)],
        [NEAR_CANONICAL], ['0x' + 'zz'.repeat(20)], [' ' + GATEWAY],
    ])('gateway=%s ise firlatir, hicbir sey imzalanmaz ya da yayinlanmaz', async (bad) => {
        const f = refundFakes()
        await expect(refund(f, { gateway: bad })).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        refundNothingSent(f)
        expect(f.wallet.populateTransaction).not.toHaveBeenCalled()
    })
})

describe('sendRefund -- imzala, kaydet, yayinla (T25 M2-I3)', () => {
    it('sira: doldur, imzala, KAYIT, SONRA yayin; kayit hash ve ham imzali bayti alir', async () => {
        const f = refundFakes()
        const r = await refund(f)
        const signed = f.onSubmitted.mock.calls[0][1]
        expect(f.order).toEqual([['sign'], ['submitted'], ['broadcast', signed]])
        expect(r.hash).toBe(keccak256(signed))
        expect(f.onSubmitted).toHaveBeenCalledWith(r.hash, signed)
        expect(f.wallet.sendTransaction).not.toHaveBeenCalled()
        expect(await r.wait()).toEqual({ status: 1 })
    })

    it('imzalanan islem gateway e refund(bytes32) verisiyle, deger 0, gateway zincirinde, verilen cuzdandan gider', async () => {
        const f = refundFakes()
        await refund(f)
        const tx = Transaction.from(f.onSubmitted.mock.calls[0][1])
        expect(getAddress(tx.to)).toBe(GATEWAY)
        expect(REFUND_IFACE_T.decodeFunctionData('refund', tx.data)[0]).toBe(REFUND_TICKET)
        expect(tx.value).toBe(0n)
        expect(tx.chainId).toBe(56n)
        expect(getAddress(tx.from)).toBe(ME)
    })

    it('kanonik gateway kucuk harf, onekesiz ya da kacak saglama toplamli karisik harfle verilse de kanonik adrese gider', async () => {
        // Saglama toplami BILEREK bozulur: ethers getAddress bu girdiyi reddederdi.
        const offChecksum = [...GATEWAY.slice(2)].map((c) => (/[a-f]/.test(c) ? c.toUpperCase() : /[A-F]/.test(c) ? c.toLowerCase() : c)).join('')
        const broken = '0x' + offChecksum
        expect(broken.toLowerCase()).toBe(GATEWAY.toLowerCase())
        expect(broken).not.toBe(GATEWAY)
        expect(() => getAddress(broken)).toThrow()
        for (const given of [GATEWAY.toLowerCase(), GATEWAY.slice(2), broken]) {
            const f = refundFakes()
            await refund(f, { gateway: given })
            expect(f.wallet.populateTransaction.mock.calls[0][0].to).toBe(GATEWAY)
        }
    })

    it('kayit yazilamazsa PRIVATE_FAILED (asil hata cause ta), HICBIR sey yayinlanmaz', async () => {
        const f = refundFakes()
        f.onSubmitted.mockRejectedValue(new Error('depo dolu'))
        const e = await refund(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_FAILED')
        expect(e.cause.message).toBe('depo dolu')
        expect(f.wallet.signTransaction).toHaveBeenCalledTimes(1)
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('onSubmitted verilmemisse hicbir sey gonderilmez (fail-closed)', async () => {
        const f = refundFakes()
        await expect(sendRefund({ wallet: f.wallet, gateway: GATEWAY, ticket: REFUND_TICKET })).rejects.toThrow('PRIVATE_FAILED')
        refundNothingSent(f)
    })

    it('saglayici baska bir aga bakiyorsa imzalanmaz', async () => {
        const f = refundFakes({ networkChainId: 1n })
        await expect(refund(f)).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        refundNothingSent(f)
    })

    it('gaz yetmezse PRIVATE_INSUFFICIENT_GAS: imzalanmaz, kaydedilmez', async () => {
        const f = refundFakes({ native: 1n })
        await expect(refund(f)).rejects.toThrow('PRIVATE_INSUFFICIENT_GAS')
        refundNothingSent(f)
    })

    it('dusman populateTransaction `to` u degistirir: imzali bayt reddedilir, kayit ve yayin yok', async () => {
        const f = refundFakes({ populate: (tx) => ({ ...tx, to: NEAR_CANONICAL, from: ME, nonce: 3, chainId: 56n, gasLimit: 90000n, gasPrice: DEFAULT_GAS_PRICE }) })
        await expect(refund(f)).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('dusman populateTransaction deger ekler: imzali bayt reddedilir', async () => {
        const f = refundFakes({ populate: (tx) => ({ ...tx, value: 1n, from: ME, nonce: 3, chainId: 56n, gasLimit: 90000n, gasPrice: DEFAULT_GAS_PRICE }) })
        await expect(refund(f)).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        expect(f.onSubmitted).not.toHaveBeenCalled()
    })

    it('belirsiz yayin: AYNI bayt uc kez, sonunda PRIVATE_REFUND_UNCONFIRMED hash ile; kayit yayindan once yazilmisti', async () => {
        const f = refundFakes({ broadcastScript: [new Error('ag'), new Error('502'), new Error('timeout')] })
        const e = await refund(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_REFUND_UNCONFIRMED')
        expect(e.definitive).toBe(false)
        const [hash, signed] = f.onSubmitted.mock.calls[0]
        expect(e.hash).toBe(hash)
        expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(3)
        for (const c of f.wallet.provider.broadcastTransaction.mock.calls) expect(c[0]).toBe(signed)
        expect(f.sleep).toHaveBeenCalledTimes(2)
        expect(f.onSubmitted.mock.invocationCallOrder[0]).toBeLessThan(f.wallet.provider.broadcastTransaction.mock.invocationCallOrder[0])
    })

    it('ilk deneme belirsiz, ikincisi basarili: gitti sayilir', async () => {
        const f = refundFakes({ broadcastScript: [new Error('ag')] })
        const r = await refund(f)
        expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(2)
        expect(r.hash).toBe(f.onSubmitted.mock.calls[0][0])
    })

    it('"already known" gitti sayilir; makbuz hash ten beklenir', async () => {
        const f = refundFakes({ broadcastScript: [new Error('already known')] })
        const r = await refund(f)
        await r.wait()
        expect(f.wallet.provider.waitForTransaction).toHaveBeenCalledWith(r.hash, 1)
    })

    it('kesin ret (underpriced): definitive, PRIVATE_FAILED, tekrar yok', async () => {
        const f = refundFakes({ broadcastScript: [new Error('replacement transaction underpriced')] })
        const e = await refund(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_FAILED')
        expect(e.definitive).toBe(true)
        expect(e.hash).toBe(f.onSubmitted.mock.calls[0][0])
        expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(1)
    })

    it('kesin ret (insufficient funds): definitive, PRIVATE_INSUFFICIENT_GAS', async () => {
        const f = refundFakes({ broadcastScript: [new Error('insufficient funds for gas * price + value')] })
        const e = await refund(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_INSUFFICIENT_GAS')
        expect(e.definitive).toBe(true)
    })

    it('yayin denemesi takilirsa her deneme 15 sn te kesilir, sonuc belirsiz sayilir', async () => {
        vi.useFakeTimers()
        try {
            const f = refundFakes()
            f.wallet.provider.broadcastTransaction = vi.fn(() => new Promise(() => {}))
            f.sleep = undefined
            const p = sendRefund({ wallet: f.wallet, gateway: GATEWAY, ticket: REFUND_TICKET, onSubmitted: f.onSubmitted }).catch((x) => x)
            await vi.advanceTimersByTimeAsync(15000 * 3 + 1500 * 2)
            const e = await p
            expect(e.message).toBe('PRIVATE_REFUND_UNCONFIRMED')
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it('takili populateTransaction 30 sn te PRIVATE_PROVIDER_DOWN, hicbir sey imzalanmaz', async () => {
        vi.useFakeTimers()
        try {
            const f = refundFakes()
            f.wallet.populateTransaction = vi.fn(() => new Promise(() => {}))
            const p = refund(f).catch((x) => x)
            await vi.advanceTimersByTimeAsync(30000)
            expect((await p).message).toBe('PRIVATE_PROVIDER_DOWN')
            refundNothingSent(f)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('sendRefund -- emekli gateway listesi (T25 M2-m4)', () => {
    const OLD_GATEWAY = getAddress('0x' + '9a'.repeat(20))

    it('bugun bos: eski adres reddedilir', async () => {
        const f = refundFakes()
        await expect(refund(f, { gateway: OLD_GATEWAY })).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        refundNothingSent(f)
    })

    it('listedeki emekli gateway e iade gider (kanonik de kabul edilmeye devam eder)', async () => {
        const f = refundFakes()
        await refund(f, { gateway: OLD_GATEWAY.toLowerCase(), retiredGateways: [OLD_GATEWAY] })
        expect(getAddress(Transaction.from(f.onSubmitted.mock.calls[0][1]).to)).toBe(OLD_GATEWAY)
        const g = refundFakes()
        await refund(g, { retiredGateways: [OLD_GATEWAY] })
        expect(getAddress(Transaction.from(g.onSubmitted.mock.calls[0][1]).to)).toBe(GATEWAY)
    })

    it('listede olmayan adres emekli listesi doluyken de reddedilir', async () => {
        const f = refundFakes()
        await expect(refund(f, { gateway: NEAR_CANONICAL, retiredGateways: [OLD_GATEWAY] })).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        refundNothingSent(f)
    })
})

// Gercek ethers Wallet: populateTransaction, nonce, ucret ve imza GERCEK; yalniz ag katmani taklit.
const BLOCK = {
    number: '0x10', hash: '0x' + 'aa'.repeat(32), parentHash: '0x' + 'bb'.repeat(32), timestamp: '0x65000000', nonce: '0x0000000000000000',
    difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', miner: '0x' + '00'.repeat(20), extraData: '0x',
    baseFeePerGas: '0x3b9aca00', transactions: [],
}
const NODE = { nonce: 7n, estimate: 400000n, gasPrice: 10n ** 9n, balance: 10n ** 18n, block: BLOCK }
function realWallet(script = [], node = NODE) {
    const provider = new ScriptedRpcProvider(script, node)
    return { provider, wallet: REAL_KEY_WALLET.connect(provider) }
}
// Imzali baytin DOLDURULMUS islemden (T24 M8) sapmalari: yatirma ve iade AYNI paylasilan korumayi kullanir, ikisi de
// ayni tabloyla sinanir. fakes()/refundFakes() eski tip (gasPrice) doldurur; tur bos oldugundan ethers yalniz 0 ya da 1
// cikarir: EIP-1559 (2) ve EIP-7702 (4) imzali baytlari bunun disindadir. Her giris: [ad, mutate, imzalayan].
let AUTHORIZATION
beforeAll(async () => {
    AUTHORIZATION = await REAL_KEY_WALLET.authorize({ address: getAddress('0x' + '66'.repeat(20)), nonce: 0, chainId: 56 })
})
const asEip1559 = (tx) => ({ ...tx, gasPrice: undefined, type: 2, maxFeePerGas: DEFAULT_GAS_PRICE, maxPriorityFeePerGas: 1n })
const SIGNED_SHAPE_TAMPERS = [
    ['gasLimit farkli (butce baska gasLimit ile olculdu)', (tx) => ({ ...tx, gasLimit: tx.gasLimit + 1n }), REAL_KEY_WALLET],
    ['nonce farkli', (tx) => ({ ...tx, nonce: tx.nonce + 1 }), REAL_KEY_WALLET],
    ['islem turu farkli (doldurulan eski tip, imzali EIP-1559)', asEip1559, REAL_KEY_WALLET],
    ['EIP-7702 yetki listesi (tur 4)', (tx) => ({ ...asEip1559(tx), type: 4, authorizationList: [AUTHORIZATION] }), REAL_KEY_WALLET],
]

// T24: yatirma dayanikliligi. Imzalanan BAYTLAR plana esit olmali, yatirma imzadan once nihai
// gasLimit ile denenmeli, izin tam tutar olmali, her on-imza RPC adimi sinirli olmali.
describe('executePrivateDeposit -- imzalanan bayt plana esit (T24 M2-I4)', () => {
    const OTHER = getAddress('0x' + '66'.repeat(20))

    it('signTransaction argumani plan in to/data/value degerlerini ve doldurulan gasLimit i tasir', async () => {
        const f = fakes({ allowance: NEED, estimate: 400000n })
        await run(f)
        const arg = f.wallet.signTransaction.mock.calls[0][0]
        expect(arg.to).toBe(GATEWAY)
        expect(arg.data).toBe(quoteFixture().deposit.data)
        expect(arg.value).toBe(0n)
        expect(arg.gasLimit).toBe(depositGasWithHeadroom(400000n))
        expect(arg.gasLimit).toBe(500000n)
    })

    // Imzalanan bayt plandan saparsa HICBIR sey kaydedilmez ya da yayinlanmaz.
    it.each([
        ['hedef (to) farkli', (tx) => ({ ...tx, to: OTHER }), REAL_KEY_WALLET],
        ['calldata farkli', (tx) => ({ ...tx, data: '0xdeadbeef' }), REAL_KEY_WALLET],
        ['deger (value) farkli', (tx) => ({ ...tx, value: 1n }), REAL_KEY_WALLET],
        ['zincir (chainId) farkli', (tx) => ({ ...tx, chainId: 1n }), REAL_KEY_WALLET],
        ['gonderen (from) farkli: baska anahtarla imzalanmis', (tx) => tx, new Wallet('0x' + '22'.repeat(32))],
        ...SIGNED_SHAPE_TAMPERS,
    ])('imzali bayt: %s -> PRIVATE_QUOTE_MISMATCH, kayit ve yayin YOK', async (_ad, mutate, signer) => {
        const f = fakes({ allowance: NEED })
        f.wallet.signTransaction = vi.fn(async (tx) => signWithKey(signer, mutate(tx)))
        await expect(run(f)).rejects.toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('cozulemeyen imzali bayt (bozuk) PRIVATE_QUOTE_MISMATCH, kayit ve yayin yok', async () => {
        const f = fakes({ allowance: NEED })
        f.wallet.signTransaction = vi.fn(async () => '0x02' + 'ee'.repeat(60))
        await expect(run(f)).rejects.toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    const runReal = (wallet, over = {}) => {
        const token = { balanceOf: vi.fn(async () => NEED), allowance: vi.fn(async () => NEED), approve: vi.fn() }
        const onSubmitted = vi.fn(async () => {})
        return { token, onSubmitted, p: executePrivateDeposit({ quote: quoteFixture(), wallet, onSubmitted, erc20: () => token, expected: EXPECTED, sleep: async () => {}, ...over }) }
    }

    it('gercek Wallet: yayinlanan ham islem plan in to/data/value/chainId ve gasLimit (1.25 x tahmin) degerlerini tasir', async () => {
        const { provider, wallet } = realWallet()
        const { p, onSubmitted } = runReal(wallet)
        const r = await p
        expect(provider.sent).toHaveLength(1)
        const tx = Transaction.from(provider.sent[0])
        expect(tx.to).toBe(GATEWAY)
        expect(tx.data).toBe(quoteFixture().deposit.data)
        expect(tx.value).toBe(0n)
        expect(tx.chainId).toBe(56n)
        expect(tx.from).toBe(ME)
        expect(tx.gasLimit).toBe(NODE.estimate * 125n / 100n)
        expect(tx.nonce).toBe(7)
        // Kayit ayni bayti ve hash'ini alir.
        expect(onSubmitted).toHaveBeenCalledWith(keccak256(provider.sent[0]), provider.sent[0])
        expect(r.hash).toBe(keccak256(provider.sent[0]))
        // Benzetim, imzadan once, nihai gasLimit ile gitti.
        const call = provider.calls.find((c) => c.method === 'eth_call')
        expect(call.params[0]).toMatchObject({ from: ME.toLowerCase(), to: GATEWAY.toLowerCase(), data: quoteFixture().deposit.data })
        expect(BigInt(call.params[0].gas)).toBe(tx.gasLimit)
    })

    it('gercek Wallet, dusman populateTransaction `to` u degistirir: yurutucu reddeder, kayit ve yayin yok', async () => {
        const { provider, wallet } = realWallet()
        const realPopulate = wallet.populateTransaction.bind(wallet)
        wallet.populateTransaction = (tx) => realPopulate({ ...tx, to: OTHER })
        const { p, onSubmitted } = runReal(wallet)
        await expect(p).rejects.toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(onSubmitted).not.toHaveBeenCalled()
        expect(provider.sent).toEqual([])
    })

    it('gercek Wallet, node eth_call i revert ederse: PRIVATE_UNSUPPORTED (JSON-RPC execution reverted), yayin yok', async () => {
        const { provider, wallet } = realWallet([], { ...NODE, callError: true })
        const { p, onSubmitted } = runReal(wallet)
        await expect(p).rejects.toThrow('PRIVATE_UNSUPPORTED')
        expect(onSubmitted).not.toHaveBeenCalled()
        expect(provider.sent).toEqual([])
    })
})

// Iade, yatirmayla AYNI imzali-bayt korumasini kullanir (T25 M1): ayni tablo, ayni sapmalar, hata kodu PRIVATE_REFUND_NOT_ALLOWED.
describe('sendRefund -- imzalanan bayt refund(ticket) cagrisina esit (T25 M2)', () => {
    const OTHER = getAddress('0x' + '66'.repeat(20))
    const refundData = REFUND_IFACE_T.encodeFunctionData('refund', [REFUND_TICKET])

    // Hedef/deger/calldata/gonderen/zincir sapmalari: zincir dali ag denetimini (saglayici 56 der) GECEREK korumaya ulasir.
    it.each([
        ['hedef (to) farkli', (tx) => ({ ...tx, to: OTHER }), REAL_KEY_WALLET],
        ['calldata farkli (baska ticket)', (tx) => ({ ...tx, data: REFUND_IFACE_T.encodeFunctionData('refund', ['0x' + '02'.repeat(32)]) }), REAL_KEY_WALLET],
        ['deger (value) farkli', (tx) => ({ ...tx, value: 1n }), REAL_KEY_WALLET],
        ['zincir (chainId) farkli: saglayici 56 der, imzali bayt 1', (tx) => ({ ...tx, chainId: 1n }), REAL_KEY_WALLET],
        ['gonderen (from) farkli: baska anahtarla imzalanmis', (tx) => tx, new Wallet('0x' + '22'.repeat(32))],
        ...SIGNED_SHAPE_TAMPERS,
    ])('imzali bayt: %s -> PRIVATE_REFUND_NOT_ALLOWED, kayit ve yayin YOK', async (_ad, mutate, signer) => {
        const f = refundFakes()
        f.wallet.signTransaction = vi.fn(async (tx) => signWithKey(signer, mutate(tx)))
        await expect(refund(f)).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('cozulemeyen imzali bayt (bozuk) PRIVATE_REFUND_NOT_ALLOWED, kayit ve yayin yok', async () => {
        const f = refundFakes()
        f.wallet.signTransaction = vi.fn(async () => '0x02' + 'ee'.repeat(60))
        await expect(refund(f)).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('uyan imza gecer: tamper tablosunun kontrolu (mutate yok -> kayit + yayin)', async () => {
        const f = refundFakes()
        await refund(f)
        expect(f.onSubmitted).toHaveBeenCalledTimes(1)
        expect(f.wallet.provider.broadcastTransaction).toHaveBeenCalledTimes(1)
    })

    // Gercek ethers Wallet: populateTransaction (tahmin, nonce, ucret), imza GERCEK; yalniz ag katmani taklit.
    it('gercek Wallet: iade refund(ticket) cagrisini KAYNAK hesaptan imzalar; kayit ve yayin ayni baytlari tasir', async () => {
        const { provider, wallet } = realWallet()
        const onSubmitted = vi.fn(async () => {})
        const r = await sendRefund({ wallet, gateway: GATEWAY, ticket: REFUND_TICKET, onSubmitted, sleep: async () => {} })
        expect(provider.sent).toHaveLength(1)
        const tx = Transaction.from(provider.sent[0])
        expect(tx.to).toBe(GATEWAY)
        expect(tx.data).toBe(refundData)
        expect(tx.value).toBe(0n)
        expect(tx.chainId).toBe(56n)
        expect(tx.from).toBe(ME)
        expect(tx.nonce).toBe(7)
        expect(onSubmitted).toHaveBeenCalledWith(keccak256(provider.sent[0]), provider.sent[0])
        expect(r.hash).toBe(keccak256(provider.sent[0]))
    })

    it('gercek Wallet, dusman populateTransaction calldata yi degistirir: reddedilir, kayit ve yayin yok', async () => {
        const { provider, wallet } = realWallet()
        const realPopulate = wallet.populateTransaction.bind(wallet)
        wallet.populateTransaction = (tx) => realPopulate({ ...tx, data: '0xdeadbeef' })
        const onSubmitted = vi.fn(async () => {})
        await expect(sendRefund({ wallet, gateway: GATEWAY, ticket: REFUND_TICKET, onSubmitted, sleep: async () => {} })).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        expect(onSubmitted).not.toHaveBeenCalled()
        expect(provider.sent).toEqual([])
    })
})

describe('executePrivateDeposit -- imza oncesi benzetim (T24 M2-m5)', () => {
    const revert = () => makeError('execution reverted', 'CALL_EXCEPTION', { action: 'call', data: null, reason: null, transaction: {}, invocation: null, revert: null })

    it('eth_call imzadan ONCE, nihai gasLimit ve plan alanlariyla yapilir', async () => {
        const f = fakes({ allowance: NEED, estimate: 400000n })
        f.wallet.provider.call.mockImplementation(async () => { f.order.push(['simulate']); return '0x' })
        await run(f)
        expect(f.wallet.provider.call).toHaveBeenCalledTimes(1)
        expect(f.wallet.provider.call).toHaveBeenCalledWith({
            from: ME, to: GATEWAY, data: quoteFixture().deposit.data, value: 0n, gasLimit: depositGasWithHeadroom(400000n),
        })
        expect(f.order.map((o) => o[0])).toEqual(['estimate', 'simulate', 'sign', 'submitted', 'broadcast'])
    })

    it('benzetim revert ederse PRIVATE_UNSUPPORTED: imzalanmaz, kayit ve yayin yok', async () => {
        const f = fakes({ allowance: NEED })
        f.wallet.provider.call.mockRejectedValue(revert())
        const e = await run(f).catch((x) => x)
        expect(e.message).toBe('PRIVATE_UNSUPPORTED')
        expect(e.cause.code).toBe('CALL_EXCEPTION')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
        expect(f.onSubmitted).not.toHaveBeenCalled()
        expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
    })

    it('benzetim ag hatasi verirse PRIVATE_PROVIDER_DOWN (revert degil)', async () => {
        const f = fakes({ allowance: NEED })
        f.wallet.provider.call.mockRejectedValue(new Error('rpc down'))
        await expect(run(f)).rejects.toThrow('PRIVATE_PROVIDER_DOWN')
        expect(f.wallet.signTransaction).not.toHaveBeenCalled()
    })
})

describe('executePrivateDeposit -- izin tutardan buyukse sifirla ve tam tutar (T24 M2-m2)', () => {
    it('mevcut izin tutardan BUYUK: once 0, sonra tam tutar (harcayici erisimi karttaki tutara esit)', async () => {
        const f = fakes({ allowance: NEED + 1n })
        await run(f)
        expect(f.order.slice(0, 2)).toEqual([['approve', '0'], ['approve', String(NEED)]])
        expect(f.token.approve).toHaveBeenCalledTimes(2)
    })

    it('mevcut izin tutara TAM ESIT: approve yok', async () => {
        const f = fakes({ allowance: NEED })
        await run(f)
        expect(f.token.approve).not.toHaveBeenCalled()
    })

    it('cok buyuk (sinirsiz) kalinti izin de sifirlanir', async () => {
        const f = fakes({ allowance: 2n ** 256n - 1n })
        await run(f)
        expect(f.order.slice(0, 2)).toEqual([['approve', '0'], ['approve', String(NEED)]])
    })
})

// T24 M2-I1: hicbir on-imza RPC adimi 15 sn'yi asmaz; takili dugum temiz PRIVATE_PROVIDER_DOWN verir.
describe('executePrivateDeposit -- takili RPC, sinirli adimlar (T24 M2-I1)', () => {
    const hang = () => new Promise(() => {})
    const steps = [
        ['getNetwork', 15000, (f) => { f.wallet.provider.getNetwork = vi.fn(hang) }],
        ['token balanceOf', 15000, (f) => { f.token.balanceOf = vi.fn(hang) }],
        ['getBalance (gaz on kontrolu)', 30000, (f) => { f.wallet.provider.getBalance = vi.fn(hang) }],
        ['getFeeData', 30000, (f) => { f.wallet.provider.getFeeData = vi.fn(hang) }],
        ['allowance', 15000, (f) => { f.token.allowance = vi.fn(hang) }],
        ['approve gonderimi', 30000, (f) => { f.token.approve = vi.fn(hang) }],
        ['estimateGas', 30000, (f) => { f.wallet.estimateGas = vi.fn(hang) }],
        ['populateTransaction', 30000, (f) => { f.wallet.populateTransaction = vi.fn(hang) }],
        ['eth_call benzetimi', 15000, (f) => { f.wallet.provider.call = vi.fn(hang) }],
    ]
    it.each(steps)('%s takilirsa: PRIVATE_PROVIDER_DOWN, sinirin icinde, hicbir sey imzalanmaz/kaydedilmez/yayinlanmaz', async (_ad, limit, setup) => {
        vi.useFakeTimers()
        try {
            const f = fakes()
            setup(f)
            const p = run(f).catch((x) => x)
            let settled = false
            p.then(() => { settled = true })
            await vi.advanceTimersByTimeAsync(limit - 1)
            expect(settled).toBe(false)
            await vi.advanceTimersByTimeAsync(1)
            const e = await p
            expect(e.message).toBe('PRIVATE_PROVIDER_DOWN')
            expect(f.wallet.signTransaction).not.toHaveBeenCalled()
            expect(f.onSubmitted).not.toHaveBeenCalled()
            expect(f.wallet.provider.broadcastTransaction).not.toHaveBeenCalled()
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it('tek istek siniri 15 sn (PRIVATE_RPC_TIMEOUT_MS)', () => {
        expect(PRIVATE_RPC_TIMEOUT_MS).toBe(15000)
    })

    it('ATS kolunda da bakiye sorgusu takilirsa PRIVATE_PROVIDER_DOWN, op relay edilmez', async () => {
        vi.useFakeTimers()
        try {
            const f = fakes()
            f.token.balanceOf = vi.fn(hang)
            const atsExecute = vi.fn()
            const p = executePrivateDeposit({ quote: quoteFixture(), wallet: f.wallet, gas: 'ats', atsExecute, onSubmitted: f.onSubmitted, erc20: f.erc20, expected: EXPECTED }).catch((x) => x)
            await vi.advanceTimersByTimeAsync(15000)
            expect((await p).message).toBe('PRIVATE_PROVIDER_DOWN')
            expect(atsExecute).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('bakiye yetersizligi gibi kendi kodlu hatalar PRIVATE_PROVIDER_DOWN a donusmez', async () => {
        const f = fakes({ tokenBalance: NEED - 1n })
        await expect(run(f)).rejects.toThrow('PRIVATE_INSUFFICIENT_BALANCE')
    })
})

describe('depositGasExceedsCap -- agir rota siniri (T7, R5)', () => {
    it('tam sinirda false, sinirin bir ustunde true (bigint ve dizge)', () => {
        expect(depositGasExceedsCap(DEPOSIT_EXECUTION_PROBE_GAS_CAP)).toBe(false)
        expect(depositGasExceedsCap(DEPOSIT_EXECUTION_PROBE_GAS_CAP + 1n)).toBe(true)
        expect(depositGasExceedsCap((DEPOSIT_EXECUTION_PROBE_GAS_CAP + 1n).toString())).toBe(true)
        expect(depositGasExceedsCap(DEPOSIT_EXECUTION_PROBE_GAS_CAP.toString())).toBe(false)
    })

    it('eksik ya da bozuk deger false (atlanir)', () => {
        expect(depositGasExceedsCap('abc')).toBe(false)
        expect(depositGasExceedsCap(undefined)).toBe(false)
        expect(depositGasExceedsCap(null)).toBe(false)
        expect(depositGasExceedsCap('')).toBe(false)
        expect(depositGasExceedsCap({})).toBe(false)
    })
})

// --- ATS ile iade (sahip karari 2026-10-30: ag ucreti native coin ile odenmez) ---
describe('buildRefundCall / atsRefundRequired', () => {
    it('kanonik gateway + refund(ticket) calldata + deger 0; bilinmeyen gateway reddedilir', () => {
        const ticket = '0x' + '07'.repeat(32)
        const call = buildRefundCall({ gateway: GATEWAY, ticket })
        expect(call).toEqual({ to: GATEWAY, data: new Interface(['function refund(bytes32 ticket)']).encodeFunctionData('refund', [ticket]), value: 0n })
        expect(() => buildRefundCall({ gateway: '0x' + '99'.repeat(20), ticket })).toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        expect(() => buildRefundCall({ gateway: undefined, ticket })).toThrow('PRIVATE_REFUND_NOT_ALLOWED')
    })

    it('gereken ATS: tek op = ucret; kurulum modunda (2 op) + kurulum ucreti; okunamayan ucret null', () => {
        expect(atsRefundRequired({ transferFee: 24.5, opCount: 1 })).toBe(24.5)
        expect(atsRefundRequired({ transferFee: 24.5, bootstrapFee: 11, opCount: 2 })).toBe(35.5)
        expect(atsRefundRequired({ transferFee: 10, opCount: 2 })).toBe(20)
        expect(atsRefundRequired({ transferFee: 'x' })).toBeNull()
        expect(atsRefundRequired(null)).toBeNull()
    })
})

describe('sendRefundAts', () => {
    const TICKET = '0x' + '07'.repeat(32)
    const TX = '0x' + 'ab'.repeat(32)
    const wallet = (chainId = 56n) => ({ address: ME, provider: { getNetwork: async () => ({ chainId }) } })
    const quote = (over = {}) => ({ ready: true, decision: null, atsBalance: 100, transferFee: 24.87, bootstrapFee: 11, opCount: 1, ...over })
    const setup = (over = {}) => {
        const calls = []
        const args = {
            wallet: wallet(),
            gateway: GATEWAY,
            ticket: TICKET,
            atsQuote: vi.fn(async () => quote()),
            atsExecute: vi.fn(async ({ onRelayed }) => { calls.push('execute'); onRelayed({ txHash: TX, kind: 'transfer' }); return { hash: '0xu', txHash: TX } }),
            onBeforeSend: vi.fn(async () => { calls.push('before') }),
            onRecord: vi.fn(async () => { calls.push('record') }),
            ...over,
        }
        return { args, calls }
    }
    const callOf = () => buildRefundCall({ gateway: GATEWAY, ticket: TICKET })

    it('sira: teklif -> isaret (onBeforeSend) -> op -> kayit; op yalniz refund cagrisini tasir; native imza/bakiye yok', async () => {
        const { args, calls } = setup()
        const r = await sendRefundAts(args)
        expect(r).toEqual({ hash: TX, confirmed: true })
        expect(calls).toEqual(['before', 'execute', 'record'])
        expect(args.atsQuote).toHaveBeenCalledWith({ chainId: 56, calls: [callOf()] })
        expect(args.atsExecute.mock.calls[0][0]).toMatchObject({ chainId: 56, calls: [callOf()] })
        expect(args.atsExecute.mock.calls[0][0].quoted.transferFee).toBe(24.87)
        expect(args.onRecord).toHaveBeenCalledWith(TX)
    })

    it('baska zincirde saglayici: PRIVATE_REFUND_NOT_ALLOWED, teklif bile istenmez', async () => {
        const { args } = setup({ wallet: wallet(1n) })
        await expect(sendRefundAts(args)).rejects.toThrow('PRIVATE_REFUND_NOT_ALLOWED')
        expect(args.atsQuote).not.toHaveBeenCalled()
        expect(args.atsExecute).not.toHaveBeenCalled()
    })

    it('ATS yetersiz: PRIVATE_INSUFFICIENT_ATS (atsNeeded, atsBalance), isaret yazilmaz, op yok', async () => {
        const { args } = setup({ atsQuote: vi.fn(async () => quote({ atsBalance: 5 })) })
        await expect(sendRefundAts(args)).rejects.toMatchObject({ message: 'PRIVATE_INSUFFICIENT_ATS', atsNeeded: 24.87, atsBalance: 5 })
        expect(args.onBeforeSend).not.toHaveBeenCalled()
        expect(args.atsExecute).not.toHaveBeenCalled()
    })

    it('teklif hazir degil (kurulum gerekli): PRIVATE_ATS_UNAVAILABLE; "ATS al" karari: INSUFFICIENT_ATS', async () => {
        const a = setup({ atsQuote: vi.fn(async () => quote({ ready: false, decision: { action: 'run-onboarding' } })) })
        await expect(sendRefundAts(a.args)).rejects.toThrow('PRIVATE_ATS_UNAVAILABLE')
        const b = setup({ atsQuote: vi.fn(async () => quote({ ready: false, decision: { action: 'buy-ats' } })) })
        await expect(sendRefundAts(b.args)).rejects.toThrow('PRIVATE_INSUFFICIENT_ATS')
        expect(a.args.atsExecute).not.toHaveBeenCalled()
        expect(b.args.atsExecute).not.toHaveBeenCalled()
    })

    it('teklif zaman asimi: PRIVATE_PROVIDER_DOWN (op yok)', async () => {
        vi.useFakeTimers()
        try {
            const { args } = setup({ atsQuote: vi.fn(() => new Promise(() => {})) })
            const p = sendRefundAts(args).catch((e) => e)
            await vi.advanceTimersByTimeAsync(41000)
            expect((await p).message).toBe('PRIVATE_PROVIDER_DOWN')
            expect(args.atsExecute).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('isaret yazilamazsa (onBeforeSend firlatir) PRIVATE_FAILED ve op GONDERILMEZ', async () => {
        const { args } = setup({ onBeforeSend: vi.fn(async () => { throw new Error('depo') }) })
        await expect(sendRefundAts(args)).rejects.toThrow('PRIVATE_FAILED')
        expect(args.atsExecute).not.toHaveBeenCalled()
    })

    it('op relay edilmeden reddedildi: kodlu hata, hash/untracked YOK', async () => {
        const { args } = setup({ atsExecute: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'paymaster-paused' }) }) })
        const e = await sendRefundAts(args).catch((x) => x)
        expect(e.message).toBe('PRIVATE_ATS_UNAVAILABLE')
        expect(e.hash).toBeUndefined()
        expect(e.untracked).toBeUndefined()
        expect(args.onRecord).not.toHaveBeenCalled()
    })

    it('hash\'li belirsiz sonuc: PRIVATE_REFUND_UNCONFIRMED + hash (definitive false); opSuccess false: PRIVATE_FAILED definitive true', async () => {
        const unknown = setup({ atsExecute: vi.fn(async ({ onRelayed }) => { onRelayed({ txHash: TX, kind: 'transfer' }); throw Object.assign(new Error('d'), { opSuccess: null }) }) })
        await expect(sendRefundAts(unknown.args)).rejects.toMatchObject({ message: 'PRIVATE_REFUND_UNCONFIRMED', hash: TX, definitive: false })
        const failed = setup({ atsExecute: vi.fn(async ({ onRelayed }) => { onRelayed({ txHash: TX, kind: 'transfer' }); throw Object.assign(new Error('d'), { opSuccess: false }) }) })
        await expect(sendRefundAts(failed.args)).rejects.toMatchObject({ message: 'PRIVATE_FAILED', hash: TX, definitive: true })
        // relay "basarisiz" dedi ama hata hash tasiyor: yine kaydedilir ve belirsiz sayilir
        const relayFail = setup({ atsExecute: vi.fn(async () => { throw Object.assign(new Error('relay'), { txHash: TX }) }) })
        await expect(sendRefundAts(relayFail.args)).rejects.toMatchObject({ message: 'PRIVATE_REFUND_UNCONFIRMED', hash: TX })
        expect(relayFail.args.onRecord).toHaveBeenCalledWith(TX)
    })

    it('hash\'siz ama op calismis olabilir (opMayHaveRun): UNCONFIRMED + untracked', async () => {
        const { args } = setup({ atsExecute: vi.fn(async () => { throw Object.assign(new Error('nonce ilerledi'), { opMayHaveRun: true }) }) })
        await expect(sendRefundAts(args)).rejects.toMatchObject({ message: 'PRIVATE_REFUND_UNCONFIRMED', untracked: true })
        expect(args.onRecord).not.toHaveBeenCalled()
    })

    it('kurulum (bootstrap) op\'unun hash\'i iade sayilmaz: yalniz transfer op\'u kaydedilir', async () => {
        const { args } = setup({
            atsExecute: vi.fn(async ({ onRelayed }) => {
                onRelayed({ txHash: '0x' + '55'.repeat(32), kind: 'bootstrap' })
                onRelayed({ txHash: TX, kind: 'transfer' })
                return { txHash: TX }
            }),
        })
        await sendRefundAts(args)
        expect(args.onRecord).toHaveBeenCalledTimes(1)
        expect(args.onRecord).toHaveBeenCalledWith(TX)
    })
})
