// ConfirmTransaction.vue (SSR) -- TON ROLE MODUNDA BAKIYE KAPISI.
//
// NE OLCULUYOR: "role acik" ile "bedava" AYNI SEY DEGIL, ve bunun IKI yonu var.
//
// Paymaster ekibinin 2026-09-14 cevabi (docs/backend-istek-2026-09-14c-uninit-
// cuzdan-role.md, bolum 5) iki seyi ayni anda soyluyor:
//
//   1. Jetton gonderimi SIFIR TON'lu cuzdanda CALISIR -- gaz ve forward payi
//      rolecinin ilistirdigi TON'dan gelir. Bizim kapimiz (jettonSendFits'in
//      0.05 TON sarti) bunu role modunda da uyguluyordu, yani gasless'in AMIRAL
//      GEMISI senaryosunu -- "hic TON'u yok, jetton gonderiyor" -- KENDI
//      kontrolumuz kapatiyordu.
//   2. `amountNano` HICBIR ZAMAN sponsorlanmaz -- gonderilen tutar her zaman
//      kullanicinin KENDI bakiyesinden cikar. Yani role modunda da tutar kadar
//      TON bulunmak ZORUNDA; bulunmazsa ATS tahsil edilir ve islem zincirde
//      duser ("ucret alindi, teslim edilmedi").
//
// Iki yon BIRLIKTE kilitleniyor: yalniz birincisini olcmek, kapiyi tumden acan
// bir yamayi da YESIL birakirdi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// --- Zincir okumalari SAPLANIR; KARAR mantigi GERCEK kalir -------------------
let tonBalanceValue = 0
let jettonBalanceValue = 0
let tonBalanceHata = null
vi.mock('../utils/ton/tonBalance', () => ({
    getTonBalance: async () => {
        if (tonBalanceHata) throw new Error(tonBalanceHata)
        return tonBalanceValue
    },
}))
vi.mock('../utils/ton/jettonBalance', () => ({
    getJettonBalance: async () => jettonBalanceValue,
    toDecimalString: (v) => String(v),
}))
vi.mock('../utils/ton/jettonAddress', () => ({
    getJettonWalletAddress: async () => '0:' + '1'.repeat(64),
}))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonIdentity', () => ({
    ensureTonAddress: async () => 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P',
}))

// useTonFee SAPLANIR: gercegi /status + /quote'a cikar. Donen sekil gercekle
// AYNI (hepsi ref) -- bilesen `.value` okuyor.
import { ref } from 'vue'
let relayActiveValue = false
let atsMaxFeeValue = null
vi.mock('../composables/useTonFee', () => ({
    useTonFee: () => ({
        atsMaxFee: ref(atsMaxFeeValue), relayActive: ref(relayActiveValue),
        statusUnreadable: ref(false), ready: ref(true), decision: ref(null),
        quote: ref(null), budget: ref(null), loading: ref(false),
        onboarding: ref(false), error: ref(null),
        load: async () => {}, stop: () => {}, runOnboarding: async () => {},
    }),
}))

vi.mock('../utils/historyRecipients', () => ({ fetchHistoryCounterparties: async () => [] }))
const axiosGet = vi.fn(async () => ({ status: 200, data: {} }))
vi.mock('axios', () => ({ default: { get: (...a) => axiosGet(...a), post: (...a) => axiosGet(...a) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import ConfirmTransaction from './ConfirmTransaction.vue'
import supported_chains from '../data/supported_chains.json'
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'

const TON_CHAIN = supported_chains.find((c) => String(c.chainId) === '-239')
const TON_TO = 'UQBSV_JhbECj_h_whhhC2V-zZAS_MOLoSCl1FjNXUwnmmbqq'
const JETTON = { address: '0:' + 'a'.repeat(64), decimals: 9, symbol: 'USDT', name: 'USDT' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    relayActiveValue = false
    atsMaxFeeValue = null
    tonBalanceValue = 0
    jettonBalanceValue = 0
    tonBalanceHata = null
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

/**
 * Ekrani TON aginda kurar ve "gonderim engelli mi" sorusunun NIHAI cevabini doner.
 * @param {{relay: boolean, ton: number, jetton?: number, amount: string, asset?: object}} senaryo
 */
async function ekraniKur({ relay, ton, jetton = 0, amount, asset, okumaHatasi = null }) {
    tonBalanceHata = okumaHatasi
    relayActiveValue = relay
    // Kartin gorunurlugu atsMaxFee'ye de bagli: bolge acik ama teklif dusmusse
    // sendWithTonRelay FALSE'tur. Iki alani birlikte kurmak, testin "role modu"
    // dedigi seyin ekranin anladigi sey olmasini saglar.
    atsMaxFeeValue = relay ? '20.97' : null
    tonBalanceValue = ton
    jettonBalanceValue = jetton

    const stub = installChromeStub({
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', name: 'A' },
        vaults: [],
    })
    // evmCapable: role kolunun UCUNCU kapisi. TON'a kilitli hesapta ATS'i BSC'de
    // imzalayacak anahtar yoktur ve orada role HIC acilmaz.
    stub.setSendMessage(async (m) => (m?.type === 'TON_FEE_IDENTITY'
        ? { success: true, tonPublicKey: '0x' + '11'.repeat(32), evmCapable: true }
        : { success: false }))

    const pinia = createTestPinia()
    const network = networkStore()
    network.currentNetwork = TON_CHAIN
    const crypto = cryptoStore()
    crypto.sendAsset = asset || { address: NATIVE_TOKEN_ADDRESS, decimals: 9, symbol: 'GRAM', name: 'GRAM' }
    crypto.transactionData = { to: TON_TO, amount, from: TON_TO }
    pageStore().currentPage = 'confirmTransaction'

    const app = createApp(ConfirmTransaction, { use: [pinia, createTestI18n('tr')] })
    const holder = captureInstance(app, 'ConfirmTransaction')
    await render(app)
    expect(holder.setupStateEmptyError).toBeUndefined()
    return { engelli: holder.instance.setupState.feeBlocked === true }
}

describe('jetton: role modunda 0.05 TON ilisik payi ARANMAZ (roleci fonluyor)', () => {
    it('role ACIK + SIFIR TON + yeterli jetton -> gonderim ENGELLENMEZ', async () => {
        const { engelli } = await ekraniKur({ relay: true, ton: 0, jetton: 100, amount: '10', asset: JETTON })
        expect(engelli).toBe(false)
    })

    // ASIRI DUZELTME KORUMASI: kapi tumden kaldirilirsa ustteki test de yesil
    // kalirdi; asagidaki ikisi onu yakalar.
    it('role KAPALI + SIFIR TON -> gonderim ENGELLENIR (self-pay ilisigi kullanicidan)', async () => {
        const { engelli } = await ekraniKur({ relay: false, ton: 0, jetton: 100, amount: '10', asset: JETTON })
        expect(engelli).toBe(true)
    })

    it('role ACIK ama JETTON bakiyesi yetmiyor -> gonderim ENGELLENIR', async () => {
        const { engelli } = await ekraniKur({ relay: true, ton: 0, jetton: 5, amount: '10', asset: JETTON })
        expect(engelli).toBe(true)
    })
})

describe('duz TON: role modunda ihtiyat payi ARANMAZ ama TUTAR kullanicidan cikar', () => {
    // Kart role modunda ucreti SIFIR gosteriyor (gasNativeAmount). Kontrolun
    // 0.01 istemesi, ekranin soyledigi ile butonun yaptigini ayirirdi.
    it('role ACIK + bakiye tam TUTARA esit -> ENGELLENMEZ', async () => {
        const { engelli } = await ekraniKur({ relay: true, ton: 1, amount: '1' })
        expect(engelli).toBe(false)
    })

    it('role KAPALI + bakiye tam TUTARA esit -> ENGELLENIR (ihtiyat payi gerekli)', async () => {
        const { engelli } = await ekraniKur({ relay: false, ton: 1, amount: '1' })
        expect(engelli).toBe(true)
    })

    // Bolum 5: `amountNano` HICBIR ZAMAN sponsorlanmaz.
    it('role ACIK ama bakiye TUTARDAN AZ -> ENGELLENIR', async () => {
        const { engelli } = await ekraniKur({ relay: true, ton: 0.5, amount: '1' })
        expect(engelli).toBe(true)
    })
})

// FAIL-CLOSED. Bakiye okunamadiysa (proxy dustu, kasa kilitli, RPC hatasi)
// ucretin karsilandigini BILMIYORUZ -- bir hiccup Onayla dugmesini ACMAMALI.
// Bu dal karar `insufficientGas` ref'ine yazilirken de vardi; karar computed'e
// tasinirken SESSIZCE kaybolabilirdi (mutasyon testi tam bunu yakaladi).
describe('bakiye okunamazsa fail-closed', () => {
    it('role ACIK olsa bile okuma DUSERSE gonderim ENGELLENIR', async () => {
        const { engelli } = await ekraniKur({ relay: true, ton: 999, amount: '1', okumaHatasi: 'proxy dustu' })
        expect(engelli).toBe(true)
    })

    it('jetton kolunda da AYNI karar', async () => {
        const { engelli } = await ekraniKur({
            relay: true, ton: 999, jetton: 999, amount: '1', asset: JETTON, okumaHatasi: 'RPC hatasi',
        })
        expect(engelli).toBe(true)
    })
})
