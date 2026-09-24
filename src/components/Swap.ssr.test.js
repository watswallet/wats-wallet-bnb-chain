// Swap.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: Home.vue'nun Swap dugmesini gizlemesi bu ekrandan CIKMAYA yetmez --
// ekranin TAM ICINDEKI ChangeNetwork bileseni (NetworksPopup uzerinden) aktif agi
// Solana'ya cevirebilir. Onceden ekran ACIK kalir, yalniz "desteklenmeyen zincir"
// notuyla dugme devre disi kalirdi (v-if degil disabled).
//
// BU DOSYA KORUMANIN *ATESLENDIGINI* OLCER -- ATESLEME ANINI DEGIL.
//
// Asagidaki `vi.mock('vue')` `onMounted`i `onServerPrefetch`e ESITLER ve
// `renderToString` o kancanin donusunu BEKLER. Yani koruma (useFlowScreenGuard,
// ilk kontrolu `onMounted`ta) bu harness'te GERCEKTEN kosar ve kararini
// `page.currentPage` uzerinde BIRAKIR. Olculen sey budur: KAPI OTORITESI --
// hangi zincirde ekran acik kalir, hangisinde kendini kapatir.
//
// KORUMADA `immediate: true` YOK VE OLMAMALI. Bu dosyanin eski bir surumu
// bunun tam TERSINI savunuyordu ("bu yuzden watcher'a immediate: true ile de
// baglandi, bu dosya ekranin SETUP ANINDA kendini kapattigini kanitlar").
// O gerekce ARTIK GECERSIZ ve onu izleyen biri KALICI SIYAH EKRANI geri
// getirir: `immediate: true` ilk kontrolu bilesenin SETUP'ina, yani App.vue'daki
// `<Transition mode="out-in">`in yama ORTASINA tasir; anahtarin tek bir flush
// icinde iki kez degismesi (token -> swap -> home) gecisi kalici olarak
// kilitler ve kullanici belgenin omru boyunca siyah ekran gorur -- konsolda TEK
// BIR HATA OLMADAN. Ayrintili mekanizma: composables/useFlowScreenGuard.js'in
// bas yorumu, 2. madde.
//
// TEKNIK SINIR (deneyle dogrulandi): `renderToString` bilesenin effect
// scope'unu render COZULDUKTEN SONRA durdurur. Yani korumanin DIGER yarisi --
// "kullanici EKRANDAYKEN ag degisirse ekran terk edilir" -- bu harness'te
// olculemez (jsdom/happy-dom, yani gercek bir mount, yok). O yari
// `composables/useFlowScreenGuard.test.js`te gercek bir `effectScope` ile
// olculur. Iki dosya birlikte korumanin TAMAMINI kapsar.
//
// SINIF KILIDI AYRI YERDE: "hicbir ekran setup/render sirasinda currentPage
// yazmaz" iddiasi bu dosyanin isi DEGIL (burada `onMounted` bilerek
// ateslenebilir yapilmis durumda, yani setup ile mount ayirt EDILEMEZ).
// O iddia `screenSetupPageWrite.ssr.test.js` (mock YOK, ~54 ekran) ve
// `screenDeadlockShapes.test.js` (kaynak taramasi) dosyalarinda.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu YALNIZCA ag-yonlendirmesi: gercek bakiye/quote aginin
// (ethers JsonRpcProvider) hicbirine ihtiyaci yok, hepsi sabitlenir.
const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// TON dali onMounted icinde refreshTonFee -> ensureTonAddress (PBKDF2+SLIP10
// turetme, kasa gerektirir) ve tonFee.load (relay /status, GERCEK AG) cagirir.
// Ikisi de bu dosyanin konusu DEGIL; sabitlenmezlerse TON testi ag/kasa
// yokluguna takilir ve olcmek istedigimiz seyi (yonlendirme) hic olcemez.
vi.mock('../utils/ton/tonIdentity', () => ({
    ensureTonAddress: async () => 'UQTestTonAddress000000000000000000000000000000',
}))
vi.mock('../composables/useTonFee', async () => {
    const { ref } = await import('vue')
    return {
        useTonFee: () => ({
            atsMaxFee: ref(null), atsMaxFeeRaw: ref(null), relayActive: ref(false), statusUnreadable: ref(false),
            ready: ref(false), decision: ref(null), quote: ref(null), budget: ref(null),
            loading: ref(false), onboarding: ref(false), error: ref(null),
            load: async () => {}, stop: () => {}, runOnboarding: async () => {},
        }),
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
})

function setup(chainRecord) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })

    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord
    // Kullanici zaten Swap ekranindaymis gibi baslatilir; asagidaki iddia bu
    // deger EVM disi bir zincirde KORUNMADIGINI gorecek.
    pageStore().currentPage = 'swap'

    return { app, network }
}

describe('Swap.vue (SSR) -- ekran EVM olmayan bir zincirde KENDINI kapatir (Task 15)', () => {
    it('EVM aktifken ekran acik kalir (currentPage swap da kalir)', async () => {
        const { app } = setup(ETH_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('swap')
    })

    it('Solana aktifken ekran KENDINI home a kapatir', async () => {
        const { app } = setup(SOLANA_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('home')
    })

    // KAPI OTORITESI BIRLESTIRME.
    //
    // Dugmeyi SUNAN otorite chainSupportsFlow(chain, FLOW.SWAP) (Home.vue canSwap,
    // Token.vue canSwap) ve o otorite TON'da takasa ACIKCA IZIN VERIYOR (STON.fi;
    // chainKind.js icindeki uzun gerekce). Ekrani KAPATAN otorite ise
    // evmOnlyFeatures(chain).swap idi ve TON'da false doner (kind 'ton', rpc bos).
    // Iki kapi CELISIYORDU: dugme goruntulenir, ekran acilir acilmaz kullaniciyi
    // disari atardi -- ve App.vue'daki <Transition mode="out-in"> bu ani
    // token -> swap -> home gecisinde kilitlendigi icin sonuc KALICI SIYAH EKRANDI.
    it('TON aktifken ekran ACIK kalir -- dugmeyi sunan kapiyla ayni otorite', async () => {
        const { app } = setup(TON_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('swap')
    })

    // "SIYAH DEGIL" ile "KULLANILABILIR" AYNI SEY DEGIL. Kapi acildiginda ekranin
    // TON'da anlamli bir baslangic durumuna dustugunu de kilitlemek gerekiyor:
    // aksi halde kullanici siyah ekran yerine, bu sefer "desteklenmeyen zincir"
    // notuyla olu bir ekran gorurdu ve duzeltme hicbir sey kazandirmamis olurdu.
    it('TON da ekran KULLANILABILIR durumda acilir -- desteklenmeyen zincir notu YOK', async () => {
        const { app } = setup(TON_CHAIN)
        const holder = captureInstance(app, 'Swap')
        await render(app)

        const state = holder.instance.setupState
        // Zincir TANINDI: reconcileSwapToken 'unsupported-chain' DEMEDI.
        expect(state.tokenNotice).toBe(null)
        expect(state.isTonNetwork).toBe(true)
        // Girdi tokeni native Toncoin ile TOHUMLANDI (buton bos kalmaz) ve
        // ondaliklari TASIYOR -- SWAP_QUOTE'un TON kolu ondalik yoksa
        // JETTON_DECIMALS_MISSING firlatir, yani bu alan teklif icin ZORUNLU.
        expect(cryptoStore().swap.inToken).toMatchObject({ symbol: 'GRAM', chainId: -239, decimals: 9 })
        // Kullanicidan beklenen bir sonraki ADIM gosteriliyor -- bir HATA degil.
        expect(state.blockReason).toBe('select-out-token')
    })
})
