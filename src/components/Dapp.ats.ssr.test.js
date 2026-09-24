// DAPP ISLEMLERINDE ATS — Dapp.vue'yu GERCEKTEN render eden testler.
//
// Kural: ATS zincirinde ucret HER ZAMAN ATS'tir ve bu, isteğin dapp'ten gelmesinden
// BAGIMSIZDIR (utils/atsFee.pickFeeBranch). Onceki davranista `fromDapp` gorulur
// gorulmez duz gaz koluna dusuluyordu; sonucu su celiskiydi: BNB'si olmayan kullanici
// Gonder ekraninda ayni zincirde ATS ile gonderebiliyor, bir dapp'in istedigi islemi
// ise HIC yapamiyordu (ekranda tek gorulen "Yetersiz Ag Ucreti").
//
// Burada olculen dort sey, hepsi ayni kapinin parcalari:
//   1. ATS zincirinde ekran ATS koluna gecer ve UCRETI GOSTERIR (arka plandaki
//      `atsTransfer` kapisinin sarti budur: kullanici gormeden onaylamis sayilmaz).
//   2. Ucret alinamazsa gonderim BLOKLANIR — ATS zorunludur, sessizce native gaza
//      DUSULMEZ (dusseydi kullanici gasless sandigi islemde kendi BNB'sini yakardi).
//   3. Gonderim `atsTransfer` + onaylanan teklif ile gider.
//   4. Dapp'e donen hash ZINCIRDEKI islem hash'idir, userOp hash'i DEGIL.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        constructor(url) { this.url = url }
        async getBalance() { return globalThis.__dappTest.balanceWei }
        async getTransactionCount() { return 0 }
        async estimateGas(tx) { return globalThis.__dappTest.estimateGas(tx) }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n, maxPriorityFeePerGas: 1n } }
        async call() { return '0x' }
        async getNetwork() { return { chainId: 56n } }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})

vi.mock('axios', () => ({
    default: {
        post: vi.fn(async () => ({ status: 200, data: {} })),
        get: vi.fn(async () => ({ data: {} })),
    },
}))

import { ethers as realEthers } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import Dapp from './Dapp.vue'
import supported_chains from '../data/supported_chains.json'
import { ATS_CHAINS } from '../utils/atsConfig'
import EN from '../i18n/locales/en.json'

const BSC = supported_chains.find((c) => Number(c.chainId) === 56)
const SIGNER = realEthers.getAddress('0xabcdef0000000000000000000000000000000001')
const SIGNER_ACCOUNT = { key: 'k1', address: SIGNER, name: 'Hesap 1', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const RECIPIENT = realEthers.getAddress('0x2222222222222222222222222222222222222222')

const HAZIR_TEKLIF = {
    success: true, ready: true, mode: 'normal', isCrosschain: false,
    nextSteps: [], opCount: 1, needsTopUp: false,
    transferFee: 2.5, atsBalance: 100, symbol: 'ATS',
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    globalThis.__dappTest = { balanceWei: 0n, estimateGas: () => 50000n }
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    delete globalThis.__dappTest
})

function setup({ teklif = HAZIR_TEKLIF, chain = BSC, txData, yakitBakiyesi = 100 } = {}) {
    const stub = installChromeStub({
        currentNetwork: chain,
        current_request: {
            type: 'SEND_TX', id: 'req-ats-1', origin: 'https://dapp.example', favicon: '',
            txData: txData || { from: SIGNER, to: RECIPIENT, amount: '0x0', data: '0x' },
        },
        active_account: SIGNER_ACCOUNT,
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [SIGNER_ACCOUNT] }],
        dapps: {},
    })
    const gonderilenMesajlar = []
    stub.setSendMessage(async (msg) => {
        gonderilenMesajlar.push(msg)
        if (msg.type === 'SEND_TRANSACTION') return { success: true, hash: '0xuserop', txHash: '0xzincirdeki' }
        if (msg.type === 'ATS_FEE_QUOTE') return teklif
        if (msg.type === 'ATS_FUEL_BALANCE') return { success: true, balance: yakitBakiyesi, symbol: 'ATS' }
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

    return { app, page, gonderilenMesajlar }
}

describe('Dapp.vue (SSR) -- ATS zincirinde ucret ATS ile odenir', () => {
    it('ekran ATS koluna gecer ve ucret teklifi ISTENIR', async () => {
        const { app, gonderilenMesajlar } = setup()
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.isAtsTransfer).toBe(true)
        const quote = gonderilenMesajlar.find((m) => m.type === 'ATS_FEE_QUOTE')
        expect(quote).toBeDefined()
        // Teklif GONDERILECEK cagri uzerinden fiyatlanir: ucret cagrinin gaz
        // maliyetinden turuyor, baska bir cagriyi fiyatlamak ekrandaki sayiyi
        // gonderilen op'tan koparirdi.
        expect(quote.message.call.to.toLowerCase()).toBe(RECIPIENT.toLowerCase())
        expect(quote.message.chainId).toBe(56)
    })

    it('ucret EKRANDA gorunur -- arka plandaki ATS kapisinin sarti budur', async () => {
        const { app } = setup()
        const html = await render(app)

        // Logo + tutar + sembol, hepsi GERCEKTEN cizilmis olmali. Cipilak
        // `toContain('ATS')` yetmez: o dize ekranin baska yerlerinde de gecebilir
        // ve iddia kartin varligini kanitlamaz (mutasyonla olculdu -- kart hic
        // cizilmezken bile yesil kaliyordu).
        expect(html).toContain('/ats.png')
        expect(html).toContain('>2.5<')
        expect(html).toContain('>ATS<')

        // Duz gaz satiri CIZILMEZ: "Estimated" rozeti yalniz o satirda var. Ikisi
        // ayni anda gorunse ekran "hem BNB hem ATS odeyeceksiniz" demis olurdu.
        expect(html).not.toContain('Estimated')
    })

    it('gonderim ATS bayragi ve ONAYLANAN teklif ile gider', async () => {
        const { app, gonderilenMesajlar } = setup()
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        await captured.instance.setupState.send()

        const sendMsg = gonderilenMesajlar.find((m) => m.type === 'SEND_TRANSACTION')
        expect(sendMsg).toBeDefined()
        expect(sendMsg.message.atsTransfer).toBe(true)
        // PER-OP ucret gonderilir (toplam DEGIL): tavan kontrolu her op'a ayri uygulanir.
        expect(sendMsg.message.atsQuoted).toEqual({ transferFee: 2.5 })
    })

    it('dapp\'e donen hash ZINCIRDEKI islem hash\'idir, userOp hash\'i DEGIL', async () => {
        // userOp hash'i dondurulseydi dapp'in eth_getTransactionReceipt cagrisi onu
        // ASLA bulamaz ve site basarili bir islemi sonsuza dek "bekliyor" gosterirdi.
        const { app, gonderilenMesajlar } = setup()
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        await captured.instance.setupState.send()

        const basari = gonderilenMesajlar.find((m) => m.type === 'SEND_TX_SUCCESS')
        expect(basari).toBeDefined()
        expect(basari.data.result).toBe('0xzincirdeki')
    })
})

describe('Dapp.vue (SSR) -- ATS alinamazsa islem BLOKLANIR', () => {
    it('teklif hazir degilse gonderim durur ve SESSIZCE native gaza DUSULMEZ', async () => {
        // Sessizce dusulseydi: kullanici gasless sandigi islemde kendi BNB'sini yakardi
        // -- ustelik ekranda hicbir BNB tutari gorunmemisken.
        const { app, gonderilenMesajlar } = setup({
            teklif: { success: false, error: 'paymaster down', httpStatus: 503 },
        })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.isAtsTransfer).toBe(true)
        expect(captured.instance.setupState.sendBlocked).toBe(true)

        await captured.instance.setupState.send()
        expect(gonderilenMesajlar.some((m) => m.type === 'SEND_TRANSACTION')).toBe(false)
    })

    it('ATS bakiyesi yetmiyorsa gonderim durur', async () => {
        const { app, gonderilenMesajlar } = setup({
            teklif: { ...HAZIR_TEKLIF, transferFee: 50, atsBalance: 1 },
        })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.sendBlocked).toBe(true)
        await captured.instance.setupState.send()
        expect(gonderilenMesajlar.some((m) => m.type === 'SEND_TRANSACTION')).toBe(false)
    })

    it('BNB bakiyesi SIFIR olsa bile ATS kolu bloklanmaz', async () => {
        // Ozelligin TUM amaci bu durum. `insufficientGas` (gaz + deger) bu kolda
        // kapi OLMAMALI: gaz ATS'ten odeniyor ve islem native deger tasimiyor.
        const { app, gonderilenMesajlar } = setup()
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.insufficientGas).toBe(true)
        expect(captured.instance.setupState.nativeAmountInsufficient).toBe(false)
        expect(captured.instance.setupState.sendBlocked).toBe(false)

        await captured.instance.setupState.send()
        expect(gonderilenMesajlar.some((m) => m.type === 'SEND_TRANSACTION')).toBe(true)
    })

    it('islem native DEGER tasiyorsa ve bakiye yetmiyorsa BLOKLANIR', async () => {
        // Gaz ATS'ten odeniyor ama gonderilen tutarin kendisi yine cuzdandan cikar.
        const { app, gonderilenMesajlar } = setup({
            txData: { from: SIGNER, to: RECIPIENT, amount: '0xde0b6b3a7640000', data: '0x' },
        })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.nativeAmountInsufficient).toBe(true)
        expect(captured.instance.setupState.sendBlocked).toBe(true)
        await captured.instance.setupState.send()
        expect(gonderilenMesajlar.some((m) => m.type === 'SEND_TRANSACTION')).toBe(false)
    })
})

// Verilen metni saran ogenin sinifini render edilmis HTML'den cikarir.
// Metinden hemen onceki IKI `<div class=` onun iki atasidir (ic: baslik satiri,
// dis: bolumun kendisi) -- aradaki her sey span/img, div DEGIL.
function kesitSinifi(html, metin) {
    const at = html.indexOf(metin)
    if (at < 0) return null
    const onceki = [...html.slice(0, at).matchAll(/<div class="([^"]*)"/g)]
    return onceki.length >= 2 ? onceki[onceki.length - 2][1] : null
}

describe('Dapp.vue (SSR) -- ucret ve eksik bakiye TEK kartta', () => {
    // Ayri kartlar cizildiginde ikisi arasina teknik detaylar akordiyonu giriyor ve
    // ayni konu ekranda ikiye bolunuyordu.
    const EKSIK_TEKLIF = {
        ...HAZIR_TEKLIF,
        transferFee: 20.487605,
        atsBalance: 2.080255,
        decision: { action: 'buy-ats', severity: 'user', i18nKey: 'send.confirmTransaction.atsBalanceMissing' },
    }

    it('iki tutar da ayni kartta gorunur', async () => {
        const { app } = setup({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        const html = await render(app)

        expect(html).toContain('>20.487605<')   // ucret
        expect(html).toContain('>18.40735<')    // eksik miktar
        // Dokum satiri da ayni yerde: sayinin nereden geldigi gorunsun.
        expect(html).toContain('2.080255')
    })

    it('eksik bakiye AYRI bir kart olarak cizilmez', async () => {
        const { app } = setup({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        const html = await render(app)

        // Bolumun KENDI yuzeyi yok: kartin icinde bir katman, kart degil. Zemin
        // sermesi (eski hali) onu kartin dibine yapismis dolu kirmizi bir bloga
        // ceviriyordu; ayirimi artik ayrac + tipografi tasiyor.
        const kesit = kesitSinifi(html, 'Missing balance')
        expect(kesit, 'bolum bulunamadi').toBeTruthy()
        expect(kesit, 'bolum kendi zeminini sermis').not.toMatch(/(^|\s)bg-/)
        expect(kesit, 'bolum ayraci yok').toMatch(/border-t/)

        // Kendi kart kabugunu de takmiyor.
        expect(html).not.toMatch(/border border-red-200[^"]*rounded-xl/)
    })

    // Birlesmenin bedeli TEKRAR olmamali: iki kart yan yana dururken dogal olan
    // seyler (kendi logosu, kendi "gereken" satiri, kendi "BSC'de olmali" notu) tek
    // kartta ayni bilgiyi ikinci kez basmak demek.
    it('ATS logosu kartta TEK kez basilir', async () => {
        const { app } = setup({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        const html = await render(app)

        expect(html.split('/ats.png').length - 1).toBe(1)
    })

    it('gereken tutar ve "BSC\'de olmali" notu TEKRARLANMAZ', async () => {
        const { app } = setup({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        const html = await render(app)

        // "Gereken X ATS" hemen ustundeki ucret tutarinin kendisi; "ATS'niz BSC'de
        // olmali" da ucret notunun tekrari. Ikisi de kart ICINDE cizilmemeli --
        // kendi kartinda (standalone) anlamlilar, orada ustte bir ucret YOK.
        const c = EN.send.confirmTransaction
        expect(html).not.toContain(c.atsShortfallBreakdown.split('{')[0].trim())
        expect(html).not.toContain(c.atsShortfallWhere.split('{')[0].trim())

        // Yoklukla saglanan iddia tuzagi: bakiye BILGISI yine de kartta.
        expect(html).toContain('2.080255')
    })
})

describe('ATS kapsami', () => {
    it('desteklenen her EVM agi ATS zinciridir -- yani dapp kolu her yerde ATS', () => {
        // Bu iddia bir HATIRLATMADIR: kural degisirse (yeni bir EVM agi ATS'siz
        // eklenirse) Dapp.vue'nun duz gaz kolu yeniden CANLI hale gelir ve o kolun
        // testleri (Dapp.dappFixes.ssr.test.js) sentetik zincirle degil gercek
        // zincirle kosmalidir.
        const evm = supported_chains.filter((c) => Number.isFinite(Number(c.chainId)) && Number(c.chainId) > 0)
        const atsDisi = evm.filter((c) => !ATS_CHAINS[Number(c.chainId)])
        expect(atsDisi.map((c) => c.name)).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// KURULUM DUSERSE SESSIZCE NATIVE GAZA DUSULMEZ.
//
// OLCULEN HATA (denetim 2026-09-14): onMounted'in TAMAMI tek bir try/catch
// icinde ve catch yalnizca console'a yaziyordu (Dapp.vue:1006). `isAtsTransfer`
// ise hata verebilecek isin SONUNDA (:980) true oluyordu. Yani kurulum ortasinda
// bir RPC cagrisi dusunce:
//
//   isAtsTransfer  false KALIR   -> feeBlocked'in ATS kolu HIC calismaz
//   insufficientGas false KALIR  -> native gaz uyarisi da cikmaz
//   -> sendBlocked false -> buton ACIK -> arka plana atsTransfer:false gider
//   -> islem SESSIZCE kullanicinin NATIVE gaziyla yayinlanir
//
// ATS'in vaadi "native gerekmez"; sifir BNB'li bir kullanici bunu onaylar ve
// islem zincirde duser. KARDES EKRAN (ConfirmTransaction.vue) bu hatayi
// TASIMIYOR: orada global try/catch YOK ve `isAtsTransfer` teklif cagrisindan
// ONCE (:1347) kuruluyor.
//
// Hata enjeksiyonu GERCEKCI: provider.getBalance (Dapp.vue:1123) `.catch()`
// TASIMIYOR -- yanindaki getEstimatedGas (:1121) ve estimateGas (:1131)
// tasiyor. Yani gercekte dusen cagrilardan biri tam olarak budur.
// ---------------------------------------------------------------------------
describe('Dapp.vue (SSR) -- kurulum dusunce', () => {
    const rpcPatlat = () => {
        Object.defineProperty(globalThis.__dappTest, 'balanceWei', {
            configurable: true,
            get() { throw new Error('RPC dustu') },
        })
    }
    const rpcDuzelt = (deger = 0n) => {
        Object.defineProperty(globalThis.__dappTest, 'balanceWei', {
            configurable: true, writable: true, value: deger,
        })
    }

    it('kurulum dustugu ISARETLENIR', async () => {
        rpcPatlat()
        const { app } = setup()
        const holder = captureInstance(app, 'Dapp')
        await render(app)
        expect(holder.instance.setupState.kurulumDustu).toBe(true)
    })

    // ASIL DUZELTME.
    it('gonderim BLOKLANIR', async () => {
        rpcPatlat()
        const { app } = setup()
        const holder = captureInstance(app, 'Dapp')
        await render(app)
        expect(holder.instance.setupState.sendBlocked).toBe(true)
    })

    // Gorunumden BAGIMSIZ kapi: buton disabled olsa da send() baska bir yoldan
    // cagrilabilir. Yayini engelleyen sey butonun gorunumu OLMAMALI.
    it('send() cagrilsa BILE islem yayinlanmaz', async () => {
        rpcPatlat()
        const { app, gonderilenMesajlar } = setup()
        const holder = captureInstance(app, 'Dapp')
        await render(app)

        await holder.instance.setupState.send()
        expect(gonderilenMesajlar.find((m) => m.type === 'SEND_TRANSACTION')).toBeUndefined()
    })

    it('sebep EKRANDA yazar', async () => {
        rpcPatlat()
        const { app } = setup()
        const html = await render(app)
        expect(EN.send.confirmTransaction.setupFailedTitle).toBeTruthy()
        expect(html).toContain(EN.send.confirmTransaction.setupFailedTitle)
    })

    it('tekrar dene kurulumu YENIDEN calistirir ve blok KALKAR', async () => {
        rpcPatlat()
        const { app } = setup()
        const holder = captureInstance(app, 'Dapp')
        await render(app)
        expect(holder.instance.setupState.kurulumDustu).toBe(true)

        rpcDuzelt(0n)
        await holder.instance.setupState.kurulumuCalistir()

        expect(holder.instance.setupState.kurulumDustu).toBe(false)
        expect(holder.instance.setupState.isAtsTransfer).toBe(true)
    })

    // KARSIT KANIT: saglam kurulumda hicbir sey bloklanmiyor. Olmasaydi
    // yukaridaki testler her zaman gecerdi ve hicbir sey kanitlamazlardi.
    it('saglam kurulumda blok YOK (karsit kanit)', async () => {
        const { app } = setup()
        const holder = captureInstance(app, 'Dapp')
        await render(app)
        expect(holder.instance.setupState.kurulumDustu).toBe(false)
        expect(holder.instance.setupState.sendBlocked).toBe(false)
    })
})
