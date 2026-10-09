// Swap ekraninda ATS BAKIYESI UCRETE YETMIYORSA -- gercek render.
//
// 2026-09-25 incelemesi: bootstrap modunda /status ready:true donuyor, sunucu karari
// yok, takasin ucreti (transfer + op1) ~21.76 ATS, bakiye 1 ATS. Ekran ne bir uyari
// ciziyordu ne de dugmeyi kilitliyordu; /sponsor 'balance-missing' ile ANCAK
// gonderimden sonra reddediyordu. Send ekrani ayni durumda ucret kartinin icinde
// "Insufficient ATS balance / You need ~X ATS" yazip dugmeyi "Insufficient Balance"
// ile kilitliyor -- takas ayni dili konusmali.
//
// useAtsOpFee SABITLENIR: bu dosyanin konusu composable'in hesabi DEGIL (o
// useAtsOpFee.test.js'te), ekranin o karari NASIL cizdigi ve dugmeye tasidigi.
//
// Iddialar CEVRILMIS metin uzerinde kurulur (anahtar adi degil) ve HTML yorumlari
// once ayiklanir: SSR sablon yorumlarini ciktiya basiyor.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bakiye bol: "girdi tokeni yetersiz" sebebi ATS sebebini GOLGELEMESIN.
const useTokenBalanceMock = vi.fn(async () => 1000)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

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

// Ucret 21.76 ATS (20.87 transfer + 0.89 op1). `insufficient`, `loading` ve `decision`
// testin sectigi degerlerdir.
// Satis tavani BILEREK '0' ve `exceedsAtsCap` hep true: ucret tek basina bakiyeyi
// asinca gercekte de tavan 0'a iner -- tavan kartinin susmasi gereken durum tam bu.
const durum = vi.hoisted(() => ({ insufficient: true, loading: false, decision: null }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const TOPLAM = 21.76
    return {
        useAtsOpFee: () => ({
            atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(1), opCount: ref(2),
            bootstrapFee: ref(0.89), feeRefundable: ref(false),
            ready: ref(true), decision: ref(durum.decision), nextSteps: ref([]),
            loading: ref(durum.loading), error: ref(null), errorCode: ref(null), blocked: ref(false),
            commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('local'), commissionTreasury: ref(null),
            hasCommission: ref(false), totalAtsCost: ref(TOPLAM), maxAtsSellRaw: ref('0'),
            exceedsAtsCap: () => true,
            insufficient: ref(durum.insufficient),
            requiredAtsFor: (extra = 0) => TOPLAM + Number(extra || 0),
            insufficientFor: () => durum.insufficient,
            load: async () => {}, runOnboarding: async () => true, reset: () => {},
        }),
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { getAtsConfig } from '../utils/atsConfig'
import { resolveAtsBlocker } from '../utils/atsBlocker'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ATS_BSC = getAtsConfig(56).token.address

const token = (symbol, address) => ({
    name: symbol, symbol, address, decimals: 18, chainId: 56, image: { thumb: '', large: '' },
})
const USDT = token('usdt', '0x55d398326f99059fF775485246999027B3197955')
const USDC = token('usdc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')
const ATS = token('ats', ATS_BSC)

// Gorunen metin -- yorumlar atilir (sablon yorumlari SSR ciktisina giriyor).
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

// Ana dugmenin OKUNAN metni: sayfanin SON dugmesi (acilir pencereler ustte, dugme en
// altta). Kapsamli stil etiketlere data-v ekledigi icin etiketler atilir.
const dugmeMetni = (html) => {
    const bas = html.lastIndexOf('<button')
    const son = html.indexOf('</button>', bas)
    return html.slice(bas, son).replace(/<[^>]+>/g, '').trim()
}

const BLOK_BASLIK = 'Insufficient ATS balance'
const TAVAN_BASLIK = 'Amount too high'

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
    durum.insufficient = true
    durum.loading = false
    durum.decision = null
})

async function ciz({ inToken, amount = 5, insufficient, loading = false, decision = null }) {
    durum.insufficient = insufficient
    durum.loading = loading
    durum.decision = decision
    installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })

    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())

    networkStore().currentNetwork = BSC_CHAIN
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = inToken
    crypto.swap.outToken = USDC

    // Teklif ELDE ve miktar girilmis: dugmenin kapisi ATS dalina kadar ilerlesin.
    const holder = captureInstance(app, 'Swap', (instance) => {
        instance.setupState.inTokenAmount = amount
        instance.setupState.swapData = { expectedOutput: '5', exchangeRate: '1', depthGateWarning: false }
    })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('Swap.vue (SSR) -- ATS bakiyesi ucrete yetmiyor', () => {
    it('ucret kartinin icinde Send ile ayni blok cizilir ve dugme kilitlenir', async () => {
        const { html, state } = await ciz({ inToken: USDT, insufficient: true })

        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain(BLOK_BASLIK)
        // Gereken tutar = bu takasin toplam ucreti (ATS satilmiyor).
        expect(html).toContain('You need ~21.76 ATS')

        expect(state.blockReason).toBe('ats-insufficient')
        expect(state.isValid()).toBe(false)
        expect(dugmeMetni(html)).toBe('Insufficient Balance')
    })

    // Blok ucret kartinin ALT SERIDI: kartin basligindan SONRA, kartin disindaki
    // hata kartlarindan (teklif hatasi, tavan) ONCE.
    it('blok ucret kartinin basligindan sonra gelir', async () => {
        const { html } = await ciz({ inToken: USDT, insufficient: true })
        const kart = html.indexOf('Fee paid with ATS')
        expect(kart).toBeGreaterThan(-1)
        expect(html.indexOf(BLOK_BASLIK)).toBeGreaterThan(kart)
    })

    // ATS SATILIYORKEN: tek sebep, tek kart. Tavan 0'a inmis olsa da "en fazla 0 ATS
    // takas edilebilir / 0'a ayarla" karti CIZILMEZ; gereken tutar satilan miktari da
    // icerir (Send kurali: gosterilen kadar yukleyen kullanici gercekten acilmali).
    it('ATS satarken tavan karti SUSAR, gereken tutara satilan miktar eklenir', async () => {
        const { html, state } = await ciz({ inToken: ATS, amount: 5, insufficient: true })

        expect(state.atsCapExceeded).toBe(false)
        expect(html).not.toContain(TAVAN_BASLIK)
        expect(html).toContain(BLOK_BASLIK)
        expect(html).toContain('You need ~26.76 ATS')
        expect(state.blockReason).toBe('ats-insufficient')
    })

    // ESLENMIS: bakiye yetiyorsa blok YOK, dugme ACIK.
    it('ESLENMIS: bakiye yetiyorsa blok yok, dugme acik', async () => {
        const { html, state } = await ciz({ inToken: USDT, insufficient: false })

        expect(state.atsInsufficient).toBe(false)
        expect(html).not.toContain(BLOK_BASLIK)
        expect(state.blockReason).toBeNull()
        expect(dugmeMetni(html)).toBe('Swap')
    })

    // ESLENMIS: bastirma KOSULSUZ olmasin -- ucret karsilaniyorken satis tavani asilirsa
    // tavan karti eskisi gibi cizilir.
    it('ESLENMIS: ucret karsilaniyorken tavan karti hala calisir', async () => {
        const { html, state } = await ciz({ inToken: ATS, amount: 5, insufficient: false })

        expect(state.atsCapExceeded).toBe(true)
        expect(html).toContain(TAVAN_BASLIK)
        expect(html).not.toContain(BLOK_BASLIK)
        expect(state.blockReason).toBe('ats-cap')
    })
})

// BLOGUN IKI DISLAMASI -- sablon kosulunun `!atsLoading` ve buy-ats parcalari. Ikisi de
// yalniz kaynak-metin regex'iyle olculuyordu (atsFeeCardTogether.test.js); burada GERCEK
// render ile. Her iki durumda da `atsInsufficient` TRUE kalir: blogu gizleyen tek sey
// dislamanin kendisi olmali, karar degil.
describe('Swap.vue (SSR) -- yetersiz ATS blogu ne zaman CIZILMEZ', () => {
    // Teklif yenilenirken blok onceki teklifin sayisini cizerdi. Dugme yine KILITLI:
    // blogu gizlemek gonderimi acmamali.
    it('teklif yenilenirken (atsLoading) blok cizilmez, dugme kilitli kalir', async () => {
        const { html, state } = await ciz({ inToken: USDT, insufficient: true, loading: true })

        expect(state.atsLoading).toBe(true)
        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain('Fee paid with ATS')
        expect(html).not.toContain(BLOK_BASLIK)
        expect(state.isValid()).toBe(false)
    })

    // Sunucu zaten "ATS al" diyorsa o yol anlatir; ayni sey iki kez yazilmaz (Send
    // kurali). Yakit bakiyesi (ATS_FUEL_BALANCE) bu testte OKUNAMIYOR, yani eksik-ATS
    // bolumu (v-if) cizilemez ve slot'u engel satiri tasir -- dislama TAM bu yolda
    // is gorur: bolum cizilseydi blok zaten v-else-if'in arkasinda kalirdi.
    it('sunucu buy-ats derken blok cizilmez, engel satiri anlatir', async () => {
        const { html, state } = await ciz({
            inToken: USDT, insufficient: true, decision: resolveAtsBlocker('balance-missing'),
        })

        expect(state.atsDecision.action).toBe('buy-ats')
        expect(state.showAtsShortfall).toBe(false)
        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain('ATS balance required')
        expect(html).not.toContain(BLOK_BASLIK)
        expect(state.isValid()).toBe(false)
    })
})
