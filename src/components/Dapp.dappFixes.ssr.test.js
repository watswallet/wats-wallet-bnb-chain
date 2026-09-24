// Dapp.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// Dapp bug taramasinin uc dogrulanmis bulgusu burada kilitleniyor:
//  1) `value` yalniz '0x' onekliyken wei sayiliyordu: decimal-wei deger ETH
//     sanilip 1e18 kat sisiyor, '0x' (yaygin sifir kodlamasi) kurulumun tam
//     ortasinda BigInt('0x') ile cokuyordu.
//  2) transferFrom'da token bakiyesi IMZALAYANDAN okunuyordu; tokenlar
//     calldata'daki `from`dan (args[0]) cikar -- allowance'la harcayan ama
//     token tutmayan imzalayan icin gecerli islem sonsuza dek kilitleniyordu.
//  3) send() gaz tahmini basarisiz olunca sabit 65000n ile YAYIN yapiyordu:
//     150k+ isteyen cagri zincirde kesin revert olur, kullanici bosuna gaz
//     oder. Dogrusu: dapp'in bildirdigi `gas` varsa o, yoksa yayini durdur.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Saglayici davranisi test basina globalThis.__dappTest ile yonlendirilir;
// ethers'in geri kalani (Interface, AbiCoder, formatUnits...) GERCEK kalir.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        constructor(url) { this.url = url }
        async getBalance() { return globalThis.__dappTest.balanceWei }
        async getTransactionCount() { return 0 }
        async estimateGas(tx) { return globalThis.__dappTest.estimateGas(tx) }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n, maxPriorityFeePerGas: 1n } }
        async call(tx) { return globalThis.__dappTest.call(tx) }
        async getNetwork() { return { chainId: 1n } }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})

const axiosPostMock = vi.fn(async () => ({ status: 200, data: {} }))
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args), get: vi.fn(async () => ({ data: {} })) } }))

import { ethers as realEthers } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Dapp from './Dapp.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

// Adresler GECERLI EIP-55 checksum'iyla uretilir: uydurma buyuk/kucuk harf
// karisimi bir adres ethers'te INVALID_ARGUMENT firlatir ve bakiye kontrolu
// yanlislikla atlanip test bos yere yesil kalir.
const SIGNER = realEthers.getAddress('0xabcdef0000000000000000000000000000000001')
const SIGNER_ACCOUNT = { key: 'k1', address: SIGNER, name: 'Hesap 1', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const TOKEN = realEthers.getAddress('0x00000000000000000000000000000000000000aa')
const VAULT_HOLDER = '0x1111111111111111111111111111111111111111'
const RECIPIENT = '0x2222222222222222222222222222222222222222'

const erc20 = new realEthers.Interface([
    'function transferFrom(address from, address to, uint256 amount)',
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
])
const abi = realEthers.AbiCoder.defaultAbiCoder()

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    globalThis.__dappTest = {
        balanceWei: 10n ** 18n,
        estimateGas: () => 50000n,
        // ERC20 okuma cagrilari: decimals() 6 doner; balanceOf yalniz calldata'daki
        // `from`da (VAULT_HOLDER) bakiye gorur -- imzalayanin token bakiyesi SIFIR.
        call: (tx) => {
            const selector = (tx.data || '').slice(0, 10)
            if (selector === erc20.getFunction('decimals').selector) {
                return abi.encode(['uint8'], [6])
            }
            if (selector === erc20.getFunction('balanceOf').selector) {
                const [addr] = erc20.decodeFunctionData('balanceOf', tx.data)
                const balance = addr.toLowerCase() === VAULT_HOLDER ? 500_000_000n : 0n
                return abi.encode(['uint256'], [balance])
            }
            return '0x'
        },
    }
})

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    delete globalThis.chrome
    delete globalThis.__dappTest
})

// ATS DISI bir EVM zinciri. Bugun desteklenen EVM aglarinin HEPSI ATS zinciri
// (atsConfig.ATS_CHAINS), yani duz gaz kolu canli veriyle hic acilmiyor. Kol yine de
// olu degil: atsConfig bir kaydin adresleri eksik oldugunda getAtsConfig'i null
// dondurur ve ekran o zincirde duz gaza duser. Testin bu kolu olcebilmesi icin
// zincir sentetik kuruluyor -- aksi halde koruma sessizce test disi kalirdi.
const ATS_DISI_CHAIN = { ...ETH_CHAIN, chainId: 43114, name: 'Avalanche' }

function setup(txData, chain = ETH_CHAIN) {
    const stub = installChromeStub({
        currentNetwork: chain,
        current_request: {
            type: 'SEND_TX',
            id: 'req-fix-1',
            origin: 'https://dapp.example',
            favicon: '',
            txData,
        },
        active_account: SIGNER_ACCOUNT,
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [SIGNER_ACCOUNT] }],
        dapps: {},
    })
    const gonderilenMesajlar = []
    stub.setSendMessage(async (msg) => {
        gonderilenMesajlar.push(msg)
        if (msg.type === 'SEND_TRANSACTION') return { success: true, hash: '0xuserop', txHash: '0xzincir' }
        // ATS teklifi HAZIR doner. Bos yanit dondurmek ekrani bloklu birakirdi ve
        // send() hic kosmadan cikardi -- asagidaki iddialar o zaman "hicbir sey
        // gonderilmedi"yi olcup sessizce yesil kalirdi.
        if (msg.type === 'ATS_FEE_QUOTE') {
            return {
                success: true, ready: true, mode: 'normal', isCrosschain: true,
                nextSteps: [], opCount: 1, needsTopUp: false,
                transferFee: 2.5, atsBalance: 100, symbol: 'ATS',
            }
        }
        if (msg.type === 'ATS_FUEL_BALANCE') return { success: true, balance: 100, symbol: 'ATS' }
        return {}
    })
    globalThis.chrome.storage.local.remove = async (key) => { delete stub.localStore[key] }

    const app = createApp(Dapp)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chain
    const page = pageStore()
    page.currentPage = 'dapp'
    const crypto = cryptoStore()

    return { app, page, stub, crypto, gonderilenMesajlar }
}

describe('Dapp.vue (SSR) -- dapp `value` alani her bicimde WEI olarak cozulur', () => {
    it('decimal-wei string ETH sanilip 1e18 kat SISMEZ', async () => {
        // 0.015 ETH, web3.js'in gonderebilecegi bicimde: decimal wei.
        const { app, crypto } = setup({ from: SIGNER, to: RECIPIENT, amount: '15000000000000000', data: '0x' })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.setupStateEmptyError).toBeUndefined()
        expect(crypto.transactionData.nativeValue).toBe('0.015')
        expect(crypto.transactionData.amount).toBe('0.015')
    })

    it("value '0x' (yaygin sifir kodlamasi) kurulumu COKERTMEZ", async () => {
        const { app, crypto } = setup({ from: SIGNER, to: RECIPIENT, amount: '0x', data: '0x' })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(crypto.transactionData.nativeValue).toBe('0')
        // Kurulum sonuna kadar KOSTU (nonce dolduruldu): onceki kod BigInt('0x')
        // ile parse'dan ONCE patliyor, ekran bos/bayat veriyle aciliyordu.
        expect(captured.instance.setupState.nonce).toBe(0)
        expect(captured.instance.setupState.txType).toBe('NATIVE')
    })
})

describe('Dapp.vue (SSR) -- onceki akistan kalan sendAsset dapp onayina SIZMAZ', () => {
    it('native transferde bayat token sembolu gosterilmez (sendAsset sifirlanir)', async () => {
        const { app, crypto } = setup({ from: SIGNER, to: RECIPIENT, amount: '0x38d7ea4c68000', data: '0x' })
        // Kullanici az once cuzdan ici USDC gonderimi hazirlamisti; store paylasimli.
        crypto.sendAsset = { symbol: 'USDC', decimals: 6 }
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        // Kalinti temizlenmeli: yoksa onay basligi '-0.001 USDC' yazar, oysa
        // imzalanan sey 0.001 ETH'lik NATIVE transferdir.
        expect(captured.instance.setupState.txType).toBe('NATIVE')
        expect(crypto.sendAsset).toBeNull()
    })
})

describe('Dapp.vue (SSR) -- token decimals otoritesi ZINCIRDIR, API kaydi degil', () => {
    it('API farkli decimals soylese de bakiye kontrolu zincirin degeriyle yapilir', async () => {
        // API kaydi (coklu zincir tokeni) 18 diyor; bu zincirdeki kontrat 6.
        // mockResolvedValueOnce: kalici implementasyon degistirilmez, sonraki
        // testlere sizamaz (afterEach yalnizca mockClear yapiyor).
        axiosPostMock.mockResolvedValueOnce({
            status: 200,
            data: { token: { symbol: 'USDT', name: 'Tether', decimals: 18 } },
        })

        const data = erc20.encodeFunctionData('transferFrom', [VAULT_HOLDER, RECIPIENT, 100_000_000n])
        const { app, crypto } = setup({ from: SIGNER, to: TOKEN, amount: '0x0', data })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        // amount zincir decimals'iyla (6) formatlandi; sendAsset ayni olcegi
        // tasimali ki parseUnits ayni sayiyi baska olcekle okumasin.
        expect(crypto.transactionData.amount).toBe('100.0')
        expect(crypto.sendAsset.decimals).toBe(6)
        expect(captured.instance.setupState.insufficientTokenBalance).toBe(false)
    })
})

describe('Dapp.vue (SSR) -- transferFrom bakiyesi fonlarin CIKTIGI adresten okunur', () => {
    it('imzalayan yalniz allowance sahibiyken (token bakiyesi 0) gecerli islem KILITLENMEZ', async () => {
        const data = erc20.encodeFunctionData('transferFrom', [VAULT_HOLDER, RECIPIENT, 100_000_000n])
        const { app, crypto } = setup({ from: SIGNER, to: TOKEN, amount: '0x0', data })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.txType).toBe('TRANSFER')
        expect(crypto.transactionData.amount).toBe('100.0')
        // Kurulum bakiye kontrolune kadar KOSTU.
        expect(captured.instance.setupState.nonce).toBe(0)
        // VAULT_HOLDER'da 500 token var, gonderilen 100: yetersiz DEGIL.
        expect(captured.instance.setupState.insufficientTokenBalance).toBe(false)
    })
})

// DUSEN CAGRI YAYINLANMAZ — HER IKI UCRET KOLUNDA.
//
// Koruma once yalniz duz gaz kolunda vardi (kor 65000n ile yayin yapmama). ATS kolu
// eklenince ayni tehlike SURUYOR, hatta adi degisiyor: dusen bir op'ta paymaster ATS'i
// yine tahsil eder, yani kullanici bos yere ATS oder ve dapp geri donen hash'i
// "basarili" sanar. Bu yuzden iki kol da AYNI iki iddiayla olculur: dapp kendi gaz
// limitini bildirmemisse yayin DURUR, bildirmisse yayin GECER.
describe('Dapp.vue (SSR) -- dusen cagri yayinlanmaz (ATS kolu)', () => {
    it('dapp gas bildirmemisse islem YAYINLANMAZ, dapp\'e hata doner', async () => {
        const data = erc20.encodeFunctionData('transferFrom', [VAULT_HOLDER, RECIPIENT, 100_000_000n])
        const { app, page, gonderilenMesajlar } = setup({ from: SIGNER, to: TOKEN, amount: '0x0', data })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.isAtsTransfer).toBe(true)

        globalThis.__dappTest.estimateGas = () => { throw new Error('execution reverted') }
        await captured.instance.setupState.send()

        expect(gonderilenMesajlar.some(m => m.type === 'SEND_TRANSACTION')).toBe(false)
        expect(gonderilenMesajlar).toContainEqual(expect.objectContaining({
            type: 'SEND_TX_REJECTED',
            requestId: 'req-fix-1',
        }))
        expect(page.currentPage).toBe('home')
    })

    it('dapp gas bildirdiyse yayinlanir ve ATS bayragi ile gider', async () => {
        const data = erc20.encodeFunctionData('transferFrom', [VAULT_HOLDER, RECIPIENT, 100_000_000n])
        const { app, gonderilenMesajlar } = setup({ from: SIGNER, to: TOKEN, amount: '0x0', data, gas: '0x30d40' })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        globalThis.__dappTest.estimateGas = () => { throw new Error('execution reverted') }
        await captured.instance.setupState.send()

        const sendMsg = gonderilenMesajlar.find(m => m.type === 'SEND_TRANSACTION')
        expect(sendMsg).toBeDefined()
        // ATS kolunda arka plan tx'ten yalniz to/value/data okur; UYDURULMUS bir gaz
        // limiti (eski 65000n) buraya HIC girmemeli.
        expect(sendMsg.message.tx.gasLimit).toBeUndefined()
        expect(sendMsg.message.atsTransfer).toBe(true)
    })

    it('tahmin BAKIYE yuzunden dustuyse yayin DURMAZ', async () => {
        // ATS kolunun butun amaci 0 native'li kullanici. "insufficient funds" bir
        // revert DEGILDIR; onu engel saymak ozelligi tam calisacagi yerde kapatirdi.
        const data = erc20.encodeFunctionData('transferFrom', [VAULT_HOLDER, RECIPIENT, 100_000_000n])
        const { app, gonderilenMesajlar } = setup({ from: SIGNER, to: TOKEN, amount: '0x0', data })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        globalThis.__dappTest.estimateGas = () => {
            throw new Error('insufficient funds for gas * price + value: address 0x.. have 0 want 1')
        }
        await captured.instance.setupState.send()

        expect(gonderilenMesajlar.some(m => m.type === 'SEND_TRANSACTION')).toBe(true)
    })
})

describe('Dapp.vue (SSR) -- gaz tahmini basarisizliginda kor 65000n ile yayin YAPILMAZ (duz gaz kolu)', () => {
    it('dapp gas bildirmemisse islem YAYINLANMAZ, dapp\'e hata doner', async () => {
        const data = erc20.encodeFunctionData('transferFrom', [VAULT_HOLDER, RECIPIENT, 100_000_000n])
        const { app, page, gonderilenMesajlar } = setup({ from: SIGNER, to: TOKEN, amount: '0x0', data }, ATS_DISI_CHAIN)
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.isAtsTransfer).toBe(false)

        globalThis.__dappTest.estimateGas = () => { throw new Error('execution reverted') }
        await captured.instance.setupState.send()

        expect(gonderilenMesajlar.some(m => m.type === 'SEND_TRANSACTION')).toBe(false)
        expect(gonderilenMesajlar).toContainEqual(expect.objectContaining({
            type: 'SEND_TX_REJECTED',
            requestId: 'req-fix-1',
        }))
        expect(page.currentPage).toBe('home')
    })

    it('dapp gas bildirdiyse tahmin dususe o limitle yayinlanir (65000n DEGIL)', async () => {
        const data = erc20.encodeFunctionData('transferFrom', [VAULT_HOLDER, RECIPIENT, 100_000_000n])
        const { app, gonderilenMesajlar } = setup({ from: SIGNER, to: TOKEN, amount: '0x0', data, gas: '0x30d40' }, ATS_DISI_CHAIN)
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        globalThis.__dappTest.estimateGas = () => { throw new Error('execution reverted') }
        await captured.instance.setupState.send()

        const sendMsg = gonderilenMesajlar.find(m => m.type === 'SEND_TRANSACTION')
        expect(sendMsg).toBeDefined()
        expect(sendMsg.message.tx.gasLimit).toBe('200000')
    })
})
