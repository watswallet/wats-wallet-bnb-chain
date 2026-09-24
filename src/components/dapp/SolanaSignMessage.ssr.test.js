// SolanaSignMessage.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: bu ekran kullanicinin NE imzaladigini gordugu TEK yer. UTF-8
// cozulebilen baytlar BIREBIR gosterilmeli; gorunmez ve homoglif karakterler
// GORUNUR kilinmali (aksi halde "Log" + U+200B + "in" ile "Login" ekranda AYNI gorunur);
// cozulemeyen baytlar icin ASLA bir ozet UYDURULMAMALI (TonSignData.vue emsali).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import { buildSiwsMessage } from '../../utils/solana/siwsMessage'
import SolanaSignMessage from './SolanaSignMessage.vue'

const ADRES = 'FzYbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const HESAP = { key: 'k1', address: '0xabc', type: 'hd', index: 0, solanaAddress: ADRES }
const VAULTS = [{ accounts: [HESAP, { key: 'k2', address: '0xdef', type: 'hd', index: 1 }] }]
const ORIGIN = 'https://app.jup.ag'

// appMeta BILEREK BASKA bir kimlik iddia ediyor (K5): ikisi ayni dizeyi
// paylassaydi "ekran GERCEK origin'i mi yoksa sayfanin IDDIASINI mi baskin
// gosteriyor" sorusu test edilemezdi.
const APP_META = { name: 'Phantom Wallet', icon: 'https://cdn.kotu.example/i.png' }

const b64 = (metin) => btoa(unescape(encodeURIComponent(metin)))

const istek = (extra = {}) => ({
    type: 'SOLANA_SIGN_MESSAGE',
    id: 'req-sol-1',
    origin: ORIGIN,
    appMeta: APP_META,
    accountKey: 'k1',
    from: ADRES,
    mode: 'message',
    message: b64('Merhaba dunya'),
    ...extra,
})

const SIWS_INPUT = {
    domain: 'app.jup.ag',
    address: ADRES,
    statement: 'Jupiter uygulamasina giris yapiyorsunuz',
    uri: 'https://app.jup.ag',
    version: '1',
    nonce: 'abc123',
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})
afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { imzaSonuc = { success: true, address: ADRES, publicKey: 'AA==', signature: 'c2ln', signedMessage: currentRequest.message } } = {}) {
    const stub = installChromeStub({ current_request: currentRequest, active_account: HESAP, vaults: VAULTS })
    const gonderilen = []
    stub.setSendMessage(async (m) => {
        gonderilen.push(m)
        if (m.type === 'SOLANA_DAPP_SIGN_MESSAGE') return imzaSonuc
        return {}
    })

    const app = createApp(SolanaSignMessage)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'solana_sign_message'
    return { app, page, gonderilen, stub }
}

describe('SolanaSignMessage.vue (SSR) -- gosterim', () => {
    it('UTF-8 cozulebilen mesaj BIREBIR cizilir', async () => {
        const { app } = setup(istek())
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)
        expect(holder.instance.setupState.okunabilir).toBe(true)
        expect(html).toContain('Merhaba dunya')
    })

    it('BASKIN eleman GERCEK origin, sayfanin IDDIA ettigi ad baskin degil', async () => {
        const { app } = setup(istek())
        const html = await render(app)
        expect(html).toContain(ORIGIN)
        expect(html).toContain(APP_META.name)

        // KOD INCELEMESI (Gorev 14'un ayni bulgusu buraya da uygulanir): yukaridaki
        // iki satir sadece "ikisi de BIR YERDE var" der -- h2/rozet BAGLANTILARI
        // sablonda yer degistirse (origin rozette, iddia edilen ad h2'de -- tam da
        // K5'in onlemeye calistigi phishing regresyonu) bu iki satir HALA gecerdi.
        // Asagidaki iki kontrol bunu AYIRT EDER: BASKIN <h2> elemaninin ICERIGI TAM
        // OLARAK origin olmali (baska bir sey degil) ve origin, ham HTML string'inde
        // iddia edilen addan ONCE gelmeli (h2 rozetten once render edilir).
        //
        // BU ASSERTION'IN GERCEKTEN ISLEDIGI, iki binding'in ELLE gecici olarak
        // yer degistirilip testin KIRMIZIYA dondugu gozlemlenerek dogrulandi
        // (bkz. task-23-report.md "dominance swap RED evidence" bolumu); burada
        // sadece nihai (dogru) hali kilitlenir.
        const h2Icerik = html.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1]
        expect(h2Icerik).toBe(ORIGIN)
        expect(html.indexOf(ORIGIN)).toBeLessThan(html.indexOf(APP_META.name))
    })

    // C3.2: appMetaAdi eskiden gorunurKil'den GECMIYORDU -- SolanaSignTx.vue'nun
    // "claimed" rozetiyle TUTARSIZ hijyen (mesaj govdesi ve SIWS alanlari zaten
    // isaretleniyordu, ama iddia edilen ad rozeti degildi). appMeta.name TAMAMEN
    // sayfa (saldirgan) kontrolunde -- Kiril 'а' (U+0430) ile yazilmis bir ad
    // GERCEK bir markaya (Latin 'a') AYNI gorunur.
    it('claimed rozetindeki appMeta.name homoglif icerirse ISARETLENIR', async () => {
        const sahteAd = 'jupitаr' // Kiril 'а' (U+0430)
        const { app } = setup(istek({ appMeta: { name: sahteAd, icon: null } }))
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)

        expect(holder.instance.setupState.appMetaAdi).toContain('[U+0430]')
        expect(html).toContain('[U+0430]')
        expect(html).not.toContain(sahteAd)
    })

    // Gorunmez ve homoglif karakterler ekranda AYIRT EDILEBILIR olmali:
    // "Log" + U+200B + "in" ile "Login" ayni goruntuyu verir, Kiril 'a'
    // (U+0430) ile Latin 'a' de oyle -- ikisi de klasik oltalama vektoru.
    it('gorunmez ve homoglif karakterler kod noktasiyla ISARETLENIR', async () => {
        const { app } = setup(istek({ message: b64('Log​in аpp') }))
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)
        expect(holder.instance.setupState.gorunurMetin).toContain('[U+200B]')
        expect(holder.instance.setupState.gorunurMetin).toContain('[U+0430]')
        expect(html).toContain('[U+200B]')
    })

    // Ham base64'u ekrana dokmek, kullaniciya anlamadigi bir metni "okudugu"
    // izlenimi verir. Yerine hex + dogrulanabilir bir hash gosterilir.
    it('UTF-8 cozulemeyen baytlar hex + SHA-256 olarak gosterilir, ham base64 EKRANDA YOK', async () => {
        const bozuk = btoa(String.fromCharCode(0xff, 0xfe, 0xfd, 0xfc))
        const { app } = setup(istek({ message: bozuk }))
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)
        expect(holder.instance.setupState.okunabilir).toBe(false)
        expect(holder.instance.setupState.hexMetin).toBe('fffefdfc')
        expect(holder.instance.setupState.contentHash).toHaveLength(64)
        expect(html).not.toContain(bozuk)
    })

    it('signIn modunda alanlar yapilandirilmis gosterilir ve ZORLANAN alanlar isaretlenir', async () => {
        const { app } = setup(istek({ mode: 'signIn', message: b64('app.jup.ag wants you to sign in'), signInInput: SIWS_INPUT }))
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)
        expect(holder.instance.setupState.zorlananAlanlar).toEqual(['domain', 'address'])
        expect(html).toContain('app.jup.ag')
        expect(html).toContain('abc123')
    })

    // KOK NEDEN (3 bulgudan 1.): arka plan SIWS govdesini KENDISI kurar
    // (buildSiwsMessage) ve domain'i orada ezer; kayda yazilan `message` alani
    // BUDUR. Ekran bu ekranin BASKA bir yerinde (siwsAlanlari) signInInput'i AYRICA
    // yapilandirilmis gosterir, ama imzalanacak METIN GORUNUMU signInInput'ten
    // YENIDEN KURULMAMALI -- kursaydi, ekranin gosterdigi metin ile cuzdanin
    // GERCEKTEN imzaladigi bayt dizisi ayrisabilirdi (kullanici gormedigi bir
    // seyi onaylar -- bu ozelligin uretebilecegi EN KOTU sonuc).
    //
    // Bu yuzden stored `message` BILEREK signInInput'ten buildSiwsMessage ile
    // uretilecek govdeden FARKLI bir metin tasir: ekran signInInput'i kullanarak
    // govdeyi kendi yeniden kursaydi, asagidaki assertion'lar KIRMIZIYA duserdi.
    it('signIn modunda GORUNEN metin depodaki BAYTLARDAN gelir, signInInput\'ten YENIDEN KURULMAZ', async () => {
        const depodakiMesaj = 'app.jup.ag wants you to sign in with your Solana account:\n' + ADRES +
            '\n\nBU SATIR YALNIZCA KAYITTAKI message ALANINDA VAR, signInInput ile KURULAMAZ'
        const { app } = setup(istek({ mode: 'signIn', message: b64(depodakiMesaj), signInInput: SIWS_INPUT }))
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)

        const signInInputTenKurulacakOlan = buildSiwsMessage(SIWS_INPUT)
        // ON KOSUL: iki metin GERCEKTEN farkli olmali, aksi halde asagidaki
        // assertion'lar hangi davranisi ayirt ettigini KANITLAYAMAZ.
        expect(depodakiMesaj).not.toBe(signInInputTenKurulacakOlan)

        expect(holder.instance.setupState.cozulenMetin).toBe(depodakiMesaj)
        expect(html).toContain('BU SATIR YALNIZCA KAYITTAKI message ALANINDA VAR')
        expect(html).not.toContain(signInInputTenKurulacakOlan)
    })

    // KOD INCELEMESI (Gorev 23 fix turu, bulgu 1): `domain`/`address` DISINDAKI
    // her SIWS alani (uri basta) sayfa tarafindan verilir ve HICBIR sekilde
    // zorlanmaz. Ana mesaj govdesi gorunmez/homoglif karakterleri isaretlerken
    // bu alan dokumu ISARETLEMEZSE, sayfa uri alanina Kiril U+0430 ile yazilmis
    // bir host koyup GERCEK domain'deki Latin 'a'ya AYNI gorunen bir satir
    // uretebilir -- tam da kullanicinin "yapilandirilmis, guvenilir" sandigi
    // yerde. `uri` VE `nonce` ayni testte kontrol edilir: ikisi de domain/address
    // disi, serbest-metin SIWS alanlaridir.
    it('SIWS alan dokumu de gorunmez/homoglif karakterleri ISARETLER (uri sayfa tarafindan verilir)', async () => {
        const sahteUri = 'https://' + 'а' + 'pp.jup.ag' // Kiril 'a' + geri kalani -- taklit host
        const kirliInput = { ...SIWS_INPUT, uri: sahteUri, nonce: 'abc' + '​' + '123' }
        const { app } = setup(istek({ mode: 'signIn', message: b64('app.jup.ag wants you to sign in'), signInInput: kirliInput }))
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)

        const alanlar = holder.instance.setupState.siwsAlanlari
        const uriAlan = alanlar.find((a) => a.key === 'uri')
        const nonceAlan = alanlar.find((a) => a.key === 'nonce')

        expect(uriAlan.value).toContain('[U+0430]')
        expect(uriAlan.value).not.toBe(sahteUri)
        expect(nonceAlan.value).toContain('[U+200B]')

        expect(html).toContain('[U+0430]')
        // Ham (isaretlenmemis) sahte uri HICBIR YERDE gorunmemeli -- gorunseydi
        // isaretleme bu alanda hic calismamis demektir.
        expect(html).not.toContain(sahteUri)
    })
})

describe('SolanaSignMessage.vue (SSR) -- onay ve red', () => {
    it('SOLANA_DAPP_SIGN_MESSAGE onaylanan hesap ve from ile cagrilir, sonuc SIGN_MESSAGE_SUCCESS ile doner', async () => {
        const { app, gonderilen } = setup(istek())
        const holder = captureInstance(app, 'SolanaSignMessage')
        await render(app)
        await holder.instance.setupState.onayla()

        const imza = gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_MESSAGE')
        expect(imza.message.mode).toBe('message')
        expect(imza.message.origin).toBe(ORIGIN)
        expect(imza.message.from).toBe(ADRES)
        expect(imza.message.accountKey).toBe('k1')
        expect(imza.message.message).toBe(b64('Merhaba dunya'))

        const ok = gonderilen.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')
        expect(ok.requestId).toBe('req-sol-1')
        expect(ok.data.result.signature).toBe('c2ln')
        expect(ok.data.result.signedMessage).toBe(b64('Merhaba dunya'))
    })

    it('signIn modunda yanit address ve publicKey de tasir', async () => {
        const { app, gonderilen } = setup(istek({ mode: 'signIn', signInInput: SIWS_INPUT }))
        const holder = captureInstance(app, 'SolanaSignMessage')
        await render(app)
        await holder.instance.setupState.onayla()

        const ok = gonderilen.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')
        expect(ok.data.result.address).toBe(ADRES)
        expect(ok.data.result.publicKey).toBe('AA==')
    })

    it('imza basarisizsa dapp e basarili BILDIRILMEZ ve HAM KOD gosterilmez', async () => {
        const { app, gonderilen } = setup(istek(), { imzaSonuc: { success: false, error: 'SOLANA_DAPP_FROM_MISMATCH' } })
        const holder = captureInstance(app, 'SolanaSignMessage')
        await render(app)
        await holder.instance.setupState.onayla()

        expect(gonderilen.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')).toBeUndefined()
        expect(holder.instance.setupState.hata).toBeTruthy()
        expect(holder.instance.setupState.hata).not.toContain('SOLANA_DAPP_FROM_MISMATCH')
    })

    it('red 4001 ile SIGN_MESSAGE_REJECTED gonderir, imza HIC istenmez', async () => {
        const { app, gonderilen } = setup(istek())
        const holder = captureInstance(app, 'SolanaSignMessage')
        await render(app)
        await holder.instance.setupState.reddet()

        const red = gonderilen.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(red.requestId).toBe('req-sol-1')
        expect(red.error.code).toBe(4001)
        expect(gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_MESSAGE')).toBeUndefined()
    })
})

// KOD INCELEMESI (Gorev 23 fix turu, bulgu 2): `onayla` onceden `try { ... }
// finally { loading.value = false }` idi, `catch` YOKTU; `reddet`in ise hic
// `try`si YOKTU. `chrome.runtime.sendMessage` REDDEDERSE (uzanti baglami
// gecersiz kilindi, service worker kapandi) `finally` loading'i sifirlar ama
// `hata` BOS kalir ve dapp'e NE basari NE de red gider -- kullanici tiklar,
// dugme tekrar etkinlesir, GORUNURDE HICBIR SEY olmaz. Bu, tam da bu gorevin
// COZMESI istenen "tiklama sessizce hicbir sey yapmaz" defektinin BASKA bir
// bicimidir; dugme kilidini duzeltip bu hatti acik birakmak tutarsiz olurdu.
describe('SolanaSignMessage.vue (SSR) -- sendMessage kendisi reddederse', () => {
    it('SOLANA_DAPP_SIGN_MESSAGE gonderimi REDDEDERSE cevirilmis hata gosterilir, sessiz sifirlama YOK', async () => {
        const { app, page, stub } = setup(istek())
        const holder = captureInstance(app, 'SolanaSignMessage')
        await render(app)

        // Basarili yanit veren varsayilan mock'u, reddeden (throw eden) bir
        // sahteyle DEGISTIRIYORUZ -- onMounted zaten tamamlandi, chrome.storage
        // cagrisi tekrar yapilmayacak, tek etkilenen yol onayla()'nin sendMessage'i.
        stub.setSendMessage(async () => { throw new Error('Extension context invalidated.') })

        await holder.instance.setupState.onayla()

        expect(holder.instance.setupState.loading).toBe(false)
        expect(holder.instance.setupState.hata).toBeTruthy()
        // Ham istisna mesaji ASLA ekrana yazilmaz (§3.6).
        expect(holder.instance.setupState.hata).not.toContain('Extension context invalidated')
        // Basarisizlikta eve DONULMEMELI -- kullanici hatayi gorup tekrar
        // deneyebilsin diye ayni ekranda kalmali.
        expect(page.currentPage).toBe('solana_sign_message')
    })

    it('SIGN_MESSAGE_REJECTED gonderimi REDDEDERSE cevirilmis hata gosterilir, sessiz sifirlama YOK', async () => {
        const { app, page, stub } = setup(istek())
        const holder = captureInstance(app, 'SolanaSignMessage')
        await render(app)

        stub.setSendMessage(async () => { throw new Error('Extension context invalidated.') })

        await holder.instance.setupState.reddet()

        expect(holder.instance.setupState.hata).toBeTruthy()
        expect(holder.instance.setupState.hata).not.toContain('Extension context invalidated')
        // Arka plan reddi ALAMADIYSA kullanici "reddettim" saniyor olabilir ama
        // arka plan HABERSIZ -- ekran 'home'a GECMEMELI.
        expect(page.currentPage).toBe('solana_sign_message')
    })
})

// KOD INCELEMESI (Gorev 14'un SolanaConnectApprove'da bulunan 1. bulgusu buraya
// da uygulanir): onMounted'in TEK await'i (chrome.storage.local.get) COZULMEDEN
// once requestData hala null'dur, ama sablon o ana kadar da render edilmis ve
// dugme sadece `loading`e bagliysa GORSEL olarak etkin gorunur. Bu ANDA bir
// tiklama onayla()'nin kendi kilidine ("if (!requestData.value...) return")
// SESSIZCE carpar -- hicbir hata, hicbir geri bildirim.
//
// SSR'da bu GECICI pencereyi dogrudan yakalayamayiz (render() TUM onMounted
// zincirini bekler), ama current_request TIPI eslesmezse requestData KALICI
// olarak null KALIR -- ayni yari-durumun SABIT/gozlemlenebilir bir izdusumu.
// Dugme bu durumda da devre disi KALMALIDIR; aksi halde asil sorun (deger
// COZULMEDEN dugmenin etkin gorunmesi) sadece "requestData hicbir zaman
// gelmeyince" degil, "henuz gelmeyince" de sureklidir ve buradaki kontrol
// o davranisin GERCEKTEN requestData'ya bagli oldugunu kanitlar.
describe('SolanaSignMessage.vue (SSR) -- onay dugmesi cozulme kilidi', () => {
    it('istek henuz/hic COZULMEMISKEN imzala dugmesi devre disi kalir, tiklama SESSIZCE hicbir sey yapmaz', async () => {
        const { app, gonderilen } = setup({ type: 'SOLANA_CONNECT', id: 'req-x', origin: ORIGIN })
        const holder = captureInstance(app, 'SolanaSignMessage')
        const html = await render(app)

        expect(holder.instance.setupState.requestData).toBeNull()

        const dugmeAcilis = html.match(/<button[^>]*id="solana-sign-approve"[^>]*>/)?.[0] || ''
        // DIKKAT (Gorev 14 emsali): dugmenin `class` degeri zaten statik
        // "disabled:opacity-50" gibi Tailwind varyant adlarini TASIR -- class
        // degeri CIKARILMADAN yapilan duz bir 'disabled' arattirmasi HER ZAMAN
        // gecerdi (dugme gercekten etkin olsa bile). class degerini cikarip
        // GERCEK `disabled` niteligini ariyoruz.
        const classSiz = dugmeAcilis.replace(/class="[^"]*"/, '')
        expect(classSiz).toContain('disabled')

        await holder.instance.setupState.onayla()
        expect(gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_MESSAGE')).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')).toBeUndefined()
    })
})
