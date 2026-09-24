// SolanaConnectApprove.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (K5): Wallet Standard'da TonConnect'in manifest belgesinin karsiligi
// YOKTUR -- sayfanin verdigi `appMeta` (document.title + link[rel=icon]) TAMAMEN
// saldirgan kontrolundedir ve dogrulanacak hicbir ikinci kaynagi yoktur. Bu yuzden
// ekranin BASKIN elemani arka planin sender'dan cozdugu TAM ORIGIN'dir; sayfanin
// iddia ettigi ad yalnizca soluk bir "iddia edilen" rozetidir. Fixture'da gercek
// origin (app.raydium.io) ile iddia edilen ad (jupiter-ag.com) KASITLI olarak FARKLI
// host'lar: aksi halde bilesenin origin yerine appMeta.name gosterip gostermedigi
// AYIRT EDILEMEZDI.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Buffer } from 'node:buffer'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import SolanaConnectApprove from './SolanaConnectApprove.vue'

const EVM_ADRES = '0xAaaa000000000000000000000000000000000001'
const ACCOUNT = { key: 'acc-1', address: EVM_ADRES, name: 'Hesap A', type: 'hd' }
const ICE_AKTARILAN = { key: 'acc-2', address: EVM_ADRES, name: 'Hesap B', type: 'imported' }

// base58 BUYUK/KUCUK harf duyarlidir (K8) -- fixture bilerek karisik yazilidir.
const SOL_ADRES = '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK'
const SOL_PUBKEY_HEX = '9d5a1e73c4b8f20a6d3e51c7089ab4f26d0c39e7185b4a2c6f8d0e1937bc45aa'
const SOL_PUBKEY_B64 = Buffer.from(SOL_PUBKEY_HEX, 'hex').toString('base64')

const ORIGIN = 'https://app.raydium.io'
const APP_META = { name: 'jupiter-ag.com', icon: 'https://cdn.example.com/icon.png' }

const ISTEK = {
    type: 'SOLANA_CONNECT',
    // Kaydin alani `id` -- deponun TEK sozlesmesi. resolvePendingRequest
    // (dappFunctions.js:389-412) bekleyen kaydi mesajdaki `requestId` ile bulur ve
    // MV3 yeniden baslatmasindan sonra diskteki kaydi `current_request.id` ile
    // eslestirip siler; Gorev 11 de openApprovalWindow'a `id: requestId` yaziyor.
    // Fixture'a uydurma bir `requestId` alani koymak testi yesil tutarken gercek
    // eklentide kaydi HIC SILDIRMEZ: dapp'in connect() promise'i sonsuza asilir ve
    // popup her acilista ayni olu onay ekranina doner.
    id: 'req-sol-1',
    origin: ORIGIN,
    appMeta: APP_META,
    accountKey: 'acc-1',
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, {
    account = ACCOUNT,
    identity = { success: true, address: SOL_ADRES, publicKey: SOL_PUBKEY_HEX },
} = {}) {
    const stub = installChromeStub({
        current_request: currentRequest,
        active_account: account,
        solana_dapps: {},
    })
    const gonderilen = []
    stub.setSendMessage(async (msg) => {
        gonderilen.push(msg)
        if (msg.type === 'SOLANA_CONNECT_IDENTITY') return identity
        return {}
    })

    const app = createApp(SolanaConnectApprove)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'solana_connect'

    return { app, page, stub, gonderilen }
}

// task-59: eski tek-paragraflik `connectNotice` bildirimi, EVM ConnectDapp'teki
// izin kartinin gorsel dilini paylasan 3 satirlik bir karta cevrildi -- goz
// (adres/bakiye), kalem (imza) ve kalkan (otomatik islem YAPAMAZ).
describe('SolanaConnectApprove.vue (SSR) -- izin karti', () => {
    it('3 izin satiri da cizilir, eski connectNotice paragrafi YOK', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).toContain('See your address and balance')
        expect(html).toContain('Request signatures')
        expect(html).toContain('Cannot act on your behalf')
    })
})

describe('SolanaConnectApprove.vue (SSR) -- kimlik gosterimi', () => {
    it('BASKIN eleman TAM ORIGIN, iddia edilen ad yalnizca rozette', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        // Sema ve port da yetkinin PARCASIDIR (K5): https://app.x.com ile
        // http://app.x.com AYNI yetkiyi paylasmaz, bu yuzden ciplak host degil
        // TAM origin gosterilir.
        expect(html).toContain(ORIGIN)
        expect(html).toContain(APP_META.name)

        // FIX ROUND (kontrolor bulgusu 2): yukaridaki iki satir sadece "ikisi de
        // BIR YERDE var" der -- h2/rozet BAGLANTILARI sablonda yer degistirse
        // (origin rozette, iddia edilen ad h2'de -- tam da K5'in onlemeye
        // calistigi phishing regresyonu) bu iki satir HALA gecerdi. Asagidaki
        // iki kontrol bunu AYIRT EDER: BASKIN <h2> elemaninin ICERIGI TAM
        // OLARAK origin olmali (baska bir sey degil) ve origin, ham HTML
        // string'inde iddia edilen addan ONCE gelmeli (h2 rozetten once
        // render edilir).
        const h2Icerik = html.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1]
        expect(h2Icerik).toBe(ORIGIN)
        expect(html.indexOf(ORIGIN)).toBeLessThan(html.indexOf(APP_META.name))
    })

    // C3.2: claimedName eskiden HIC isaretlenmiyordu -- SolanaSignTx.vue ve
    // SolanaSignMessage.vue'nun kullandigi PAYLASILAN gorunmezlik/homoglif
    // helper'i (gorunurKil) simdi bu ekrana da uygulanir. appMeta.name TAMAMEN
    // sayfa (saldirgan) kontrolunde.
    it('claimedName homoglif icerirse ISARETLENIR', async () => {
        const sahteAd = 'jupitаr' // Kiril 'а' (U+0430)
        const { app } = setup({ ...ISTEK, appMeta: { name: sahteAd, icon: 'https://cdn.example.com/icon.png' } })
        const holder = captureInstance(app, 'SolanaConnectApprove')
        const html = await render(app)

        expect(holder.instance.setupState.claimedName).toContain('[U+0430]')
        expect(html).toContain('[U+0430]')
        expect(html).not.toContain(sahteAd)
    })

    it('EVM adresi ekrana ASLA sizmaz', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).not.toContain(EVM_ADRES)
        expect(html).toContain(SOL_ADRES.slice(0, 6))
    })

    it('adres SOLANA_CONNECT_IDENTITY yanitindan cozulur', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaConnectApprove')
        await render(app)

        expect(holder.instance.setupState.solanaAddress).toBe(SOL_ADRES)
        expect(holder.instance.setupState.solanaPublicKey).toBe(SOL_PUBKEY_HEX)
        const kimlik = gonderilen.find((m) => m.type === 'SOLANA_CONNECT_IDENTITY')
        expect(kimlik.message.accountKey).toBe('acc-1')
    })

    it('kendi tipi olmayan bir current_request islenmez', async () => {
        const { app, gonderilen } = setup({ type: 'CONNECT', id: 'req-evm-1', origin: ORIGIN })
        const holder = captureInstance(app, 'SolanaConnectApprove')
        await render(app)

        expect(holder.instance.setupState.requestData).toBeNull()
        expect(gonderilen).toEqual([])
    })

    // FIX ROUND (kontrolor bulgusu 1): onMounted, SOLANA_CONNECT_IDENTITY yaniti
    // gelmeden ONCE solanaAddress'i onbellekten (active_account.solanaAddress)
    // doldurur -- SADECE ilk boyama icin (bkz. component'teki §5.1 notu). Eger
    // "Baglan" dugmesinin disabled kosulu yalniz solanaAddress'e bakarsa, kimlik
    // yaniti henuz publicKey uretmeden once dugme GORSEL olarak aktif gorunur;
    // tiklama hicbir sey yapmaz (baglan() kendi kilidiyle sessizce reddeder).
    // Burada bozuk/eksik bir kimlik yaniti (adres var, publicKey yok) ile AYNI
    // yarim-durum dogrudan uretilip dugmenin disabled KALMASI dogrulanir.
    it('adres varsa ama publicKey yoksa "Baglan" dugmesi YINE devre disi kalir', async () => {
        const { app } = setup(ISTEK, { identity: { success: true, address: SOL_ADRES, publicKey: '' } })
        const html = await render(app)

        const dugmeAcilis = html.match(/<button[^>]*id="solana-connect-approve"[^>]*>/)?.[0] || ''
        // DIKKAT: dugmenin `class` degeri zaten statik "disabled:opacity-50
        // disabled:cursor-not-allowed disabled:hover:scale-100" Tailwind varyant
        // adlarini TASIR -- bu yuzden `class="..."` DEGERI cikarilmadan yapilan
        // duz bir 'disabled' arattirmasi HER ZAMAN gecerdi (dugme gercekten
        // etkin olsa bile). class degerini cikarip GERCEK `disabled` niteligini
        // ariyoruz.
        const classSiz = dugmeAcilis.replace(/class="[^"]*"/, '')
        expect(classSiz).toContain('disabled')
    })
})

// ConnectDapp.vue'daki `tonBlocked` emsali: soluk/kilitli bir dugme birakilmaz,
// dugme TUMDEN KALDIRILIR. Bu, §4.3.1'in 3. kapisina EK bir savunmadir.
describe('SolanaConnectApprove.vue (SSR) -- desteklenmeyen hesap', () => {
    it('onay dugmesi devre disi DEGIL, HIC YOK', async () => {
        const { app, gonderilen } = setup(ISTEK, { account: ICE_AKTARILAN })
        const holder = captureInstance(app, 'SolanaConnectApprove')
        const html = await render(app)

        expect(holder.instance.setupState.baglantiEngelli).toBe(true)
        expect(html).not.toContain('id="solana-connect-approve"')
        expect(html).toContain('This account cannot sign Solana transactions')
        // Kimlik bile SORULMAZ: turetilemeyecek bir anahtar icin kasa acilmaz.
        expect(gonderilen.find((m) => m.type === 'SOLANA_CONNECT_IDENTITY')).toBeUndefined()
    })

    it('baglan() elle cagrilsa bile oturum YAZILMAZ ve dapp yanitlanmaz', async () => {
        const { app, stub, gonderilen } = setup(ISTEK, { account: ICE_AKTARILAN })
        const holder = captureInstance(app, 'SolanaConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        expect(stub.localStore.solana_dapps[ORIGIN]).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
    })
})

describe('SolanaConnectApprove.vue (SSR) -- kimlik cozulemedi', () => {
    it('SABIT/cevrilmis bir hata gosterilir, ham kod DEGIL', async () => {
        const { app } = setup(ISTEK, { identity: { success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' } })
        const holder = captureInstance(app, 'SolanaConnectApprove')
        const html = await render(app)

        expect(holder.instance.setupState.identityError).toBeTruthy()
        expect(holder.instance.setupState.solanaAddress).toBe('')
        expect(html).toContain('Could not prepare a Solana address for this account')
        expect(html).not.toContain('SOLANA_ACCOUNT_UNSUPPORTED')
    })

    it('kimlik yokken baglan() diske HICBIR SEY yazmaz', async () => {
        const { app, stub, gonderilen } = setup(ISTEK, { identity: { success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' } })
        const holder = captureInstance(app, 'SolanaConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        expect(stub.localStore.solana_dapps[ORIGIN]).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
    })
})

describe('SolanaConnectApprove.vue (SSR) -- onay', () => {
    it('oturum TAM ORIGIN altina yazilir ve TUM alanlari dogrudur', async () => {
        const { app, stub } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        // Anahtar TAM ORIGIN'dir (K5) -- ciplak host DEGIL.
        expect(stub.localStore.solana_dapps['app.raydium.io']).toBeUndefined()
        const oturum = stub.localStore.solana_dapps[ORIGIN]
        expect(oturum.address).toBe(SOL_ADRES)
        expect(oturum.publicKey).toBe(SOL_PUBKEY_HEX)
        expect(oturum.accountKey).toBe('acc-1')
        expect(oturum.cluster).toBe('solana:mainnet')
        expect(oturum.appMeta).toEqual(APP_META)
        expect(typeof oturum.connectedAt).toBe('number')
    })

    it('CONNECT_WALLET_SUCCESS yaniti publicKey i BASE64 tasir, hex DEGIL', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        const ok = gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')
        // YANIT ZARFININ alani `requestId`, KAYDIN alani `id` -- ikisi ayni sey degil.
        // Deger `current_request.id`den okunur (ConnectDapp.vue:183 ve
        // TonConnectApprove.vue:260/293 ile birebir ayni desen).
        expect(ok.requestId).toBe('req-sol-1')
        expect(ok.status).toBe('success')
        expect(ok.data.result.address).toBe(SOL_ADRES)
        // C1.5 -- nihai inceleme: `accountKey` sinira ARTIK CIKMAZ (content.js
        // bu `data.result`u OLDUGU GIBI sayfa dunyasina tasir). Depolanan
        // `solana_dapps[...].accountKey` (yukaridaki "oturum TAM ORIGIN..."
        // testinde dogrulanir) dahili K10 korelasyon anahtaridir.
        expect(ok.data.result).not.toHaveProperty('accountKey')
        // Depo hex tutar (yalniz dahili kolaylik), sayfa siniri base64 ister (§3.3).
        expect(ok.data.result.publicKey).toBe(SOL_PUBKEY_B64)
        expect(ok.data.result.publicKey).not.toBe(SOL_PUBKEY_HEX)
    })
})

describe('SolanaConnectApprove.vue (SSR) -- red', () => {
    // TON deseni KOPYALANMAZ (§3.6): Wallet Standard'da red bir yanit govdesi
    // degil, dapp'in promise'inin reject'idir -- EVM ekranlarinin _REJECTED +
    // status:'error' deseni kullanilir.
    it('CONNECT_WALLET_REJECTED / 4001 ile yanitlanir, oturum yazilmaz', async () => {
        const { app, stub, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaConnectApprove')
        await render(app)

        await holder.instance.setupState.reddet()

        const red = gonderilen.find((m) => m.type === 'CONNECT_WALLET_REJECTED')
        expect(red.requestId).toBe('req-sol-1')
        expect(red.status).toBe('error')
        expect(red.error.code).toBe(4001)
        expect(stub.localStore.solana_dapps[ORIGIN]).toBeUndefined()
    })
})
