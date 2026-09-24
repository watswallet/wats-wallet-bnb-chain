// HOME -> TOKEN -> (GONDER | TAKAS | KOPRU) yolunun telleri — kaynak uzerinden kilitlenir.
//
// NEDEN: bu depoda bilesen (mount) testi YOK. Yolun kok problemi bir MANTIK hatasi
// degil, bir VERI KAYBIYDI: Home satiri `(chainId, address)` cifti tasiyor ama kapida
// yalniz `coingecko_id` gecirilyordu. Token.vue kanonik kaydi `/getTokenDataById`'den
// cekiyor ve o kayit — CANLI OLCULDU —
//     tether -> chain='ethereum', address=0xdac17f95…, chainId YOK, decimals YOK
// donuyor. Yani Polygon USDT satirina basmak ETHEREUM adresini aciyor, ayni kayit
// Gonder/Takas/Kopru'ye tasiniyordu. Saf katman (assetChain.js) bunu ancak slug'dan
// TAHMIN edebiliyor — dogru cevap kapida ATILMIS oluyordu.
//
// Kirilgan olduklarinin farkindayiz; alternatif hatanin SESSIZCE geri donmesi.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const HOME = read('components/Home.vue')
const TOKEN = read('components/Token.vue')
const SEND = read('components/Send.vue')
const STORE = read('store/crypto.js')

/**
 * `anchor` iceren satirdan baslar, kapanisi SATIR BASINDA olan ilk `}` satirinda biter.
 * YORUMLAR ATILIR: aksi halde kilit SAHTE olur — bir dal aramasi, dalin KENDISI
 * silinmis olsa bile ustundeki aciklama satirina uyup yesil kalir.
 */
const block = (source, anchor, closer = /^\}/) => {
    const lines = source.split(/\r?\n/)
    const start = lines.findIndex((l) => l.includes(anchor))
    if (start < 0) return ''
    const end = lines.findIndex((l, i) => i > start && closer.test(l))
    return lines.slice(start, end < 0 ? undefined : end)
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join(String.fromCharCode(10))
}

describe('(1) Home satirin KIMLIGINI kapida atmaz', () => {
    it('tiklama satirin KENDISINI gecirir, yalniz id yi DEGIL', () => {
        expect(HOME).toMatch(/@click="selectToken\(token\)"/)
        expect(HOME).not.toMatch(/selectToken\(token\.coingecko_id\)/)
    })

    it('selectToken chainId VE address yazar', () => {
        const fn = block(HOME, 'const selectToken =')
        expect(fn).toMatch(/selected_token_ref\s*=/)
        expect(fn).toMatch(/chainId:/)
        expect(fn).toMatch(/address:/)
        // Esleme emniyet kemeri: ref bayat kalirsa ESKI satirin adresi yapisirdi.
        expect(fn).toMatch(/id:/)
    })

    it('depo alani gercekten var (aksi halde yazim sessizce kaybolur)', () => {
        expect(STORE).toMatch(/selected_token_ref\s*=\s*ref\(/)
        // Pinia setup store: return listesinde OLMAYAN alan disaridan gorunmez.
        expect(block(STORE, 'return {', /^\}\)/)).toMatch(/selected_token_ref/)
    })
})

describe('(2) Token kanonik kaydin KIMLIGINE guvenmez', () => {
    it('satirdan gelen chainId + address kanonik kaydin UZERINE yazilir', () => {
        const fn = block(TOKEN, 'onMounted(async', /^\}\)/)
        expect(fn).toMatch(/\.\.\.response\.data\.token/)
        // Task 16a: chainId ARTIK Number() ICINE SOKULMAZ -- Solana kimligi
        // METIN ve Number('solana-mainnet') NaN'dir. Bunun DAVRANIS testi
        // Token.ssr.test.js'te (gercekten render edilip `crypto.sendAsset`
        // okunuyor); buradaki tarama yalnizca eski bicimin geri sizmadigini
        // kilitler.
        expect(fn).toMatch(/chainId:\s*picked\.chainId/)
        expect(fn).not.toMatch(/chainId:\s*Number\(picked\.chainId\)/)
        expect(fn).toMatch(/address:\s*picked\.address/)
    })

    it('RPC kaydin ZINCIRINDEN cozulur, korlemesine network.rpc alinmaz', () => {
        expect(TOKEN).toMatch(/const\s+rpcForChain\s*=/)
        expect(block(TOKEN, 'onMounted(async', /^\}\)/)).toMatch(/rpcForChain\(/)
    })

    it('decimals zincirden okunup KAYDA yazilir (kanonik kayitta yok)', () => {
        // Kayit oldugu gibi sendAsset/swap.inToken'a tasiniyor; decimals dusunce
        // Send.vue sessizce 18'e duser.
        expect(block(TOKEN, 'onMounted(async', /^\}\)/)).toMatch(/decimals:\s*decimals\.value/)
    })

    it('bakiye hatasi sayfanin kalanini GOTURMEZ (ayri try)', () => {
        const fn = block(TOKEN, 'onMounted(async', /^\}\)/)
        // `[^{}]*` ZORUNLU: onMounted'in DIS try'i da `useTokenBalance`'i kapsiyor, o
        // yuzden serbest bir `[\s\S]*` ic try silinse bile eslesiyordu — mutasyonla
        // olculdu (M8 yesil gecti). Ara suslu parantez yasagi eslesmeyi IC try'a hapseder.
        expect(fn).toMatch(/try\s*\{[^{}]*useTokenBalance[\s\S]{0,400}?\}\s*catch/)
    })
})

describe('(3) baska zincirin varligiyla ekrana GIRILMEZ', () => {
    // Send/Swap/Bridge bakiyeyi ve provider'i `network.rpc`'den okuyor: yabanci
    // zincirin adresiyle girmek islemi YANLIS AGDA hazirlar.
    it('ensureChain applyNetworkChange e baglidir', () => {
        expect(TOKEN).toMatch(/import\s*\{\s*applyNetworkChange\s*\}/)
        expect(block(TOKEN, 'const ensureChain =')).toMatch(/applyNetworkChange\(/)
    })

    it('UC gecis de ensureChain den gecer', () => {
        for (const fn of ['const selectSend', 'const selectSwap', 'const selectBridge']) {
            expect(block(TOKEN, fn), fn).toMatch(/if\s*\(!await ensureChain\([^)]*\)\)\s*return/)
        }
    })

    it('ag degisimi kayit yaziminin ONUNDE durur', () => {
        // applyNetworkChange swap/bridge secimlerini SIFIRLIYOR: sonra cagrilirsa
        // yazilan token aninda siliniyor.
        const fn = block(TOKEN, 'const selectSwap')
        expect(fn.indexOf('ensureChain')).toBeLessThan(fn.indexOf('crypto.swap.inToken'))
    })
})

describe('(4) Gonder kapisi kaynaga GUVENMEZ', () => {
    it('Takas ile AYNI saf katman kullanilir', () => {
        expect(SEND).toMatch(/from\s+['"]\.\.\/utils\/assetChain['"]/)
        expect(SEND).toMatch(/classifyAssetChain\(crypto\.sendAsset/)
    })

    it('KESIN sebep gonderimi kilitler', () => {
        expect(SEND).toMatch(/isCertainMismatch\(assetChainNotice\.value\)/)
        expect(block(SEND, 'const isFormValid =')).toMatch(/assetChainBlocked\.value\)\s*return false/)
    })

    it('SUPHELI sebep kilitlemez, yalniz uyarir', () => {
        // Ayni adres birden cok zincirde gecerli olabiliyor; kilitlemek CALISAN bir
        // gonderimi oldururdu.
        expect(SEND).toMatch(/v-if="assetChainNotice"/)
        expect(SEND).not.toMatch(/assetChainNotice\.value\s*\)\s*return false/)
    })

    it('uc sebep AYRI metin basar (tek metin yanlis yonlendirir)', () => {
        for (const key of ['send.assetForeignAsset', 'send.assetChainMismatch', 'send.assetChainSuspect']) {
            expect(SEND, key).toContain(key)
        }
    })
})

describe('(5) i18n paritesi', () => {
    it('iki dilde de uyari metinleri DOLU', () => {
        for (const locale of ['tr', 'en']) {
            const dict = JSON.parse(read(`i18n/locales/${locale}.json`))
            for (const key of ['assetChainMismatch', 'assetForeignAsset', 'assetChainSuspect']) {
                expect(typeof dict.send[key], `${locale}.${key}`).toBe('string')
                expect(dict.send[key].length, `${locale}.${key}`).toBeGreaterThan(0)
            }
        }
    })
})

// Token.vue bilesen olarak mount EDILEMIYOR (repoda @vue/test-utils veya bir DOM
// ortami -jsdom/happy-dom- kurulu degil, vitest environment 'node'). Bu yuzden bu
// dosyanin kendi deseni izleniyor: kapi kararini veren SATIRLAR kaynak metinden
// regex ile kilitleniyor. Saf mantik zaten chainKind.test.js'te tam kapsanan
// `isTon`'a dayaniyor; burada kilitlenen sey Token.vue'nun o fonksiyonu DOGRU
// KAYNAKLA (satirin kendi zinciri) cagirdigi, aktif agla degil.
describe('(6) Token.vue: Swap/Bridge SATIRIN zincirine gore kapida atilir (aktif aga degil)', () => {
    it('isTonAsset SATIRIN cozulmus kaydina (token.value) bakar, aktif aga degil', () => {
        // Ithal listesi artik `chainSupportsFlow, FLOW` de tasiyor (takas/kopru kapisi
        // ayni dosyadan okunuyor); kilitlenen sey `isTon`in ORADAN geldigi, listenin
        // tam metni degil.
        expect(TOKEN).toMatch(/import\s*\{[^}]*\bisTon\b[^}]*\}\s*from\s*['"]\.\.\/utils\/chainKind['"]/)
        expect(TOKEN).toMatch(/isTonAsset\s*=\s*computed\(\(\)\s*=>\s*isTon\(token\.value\)\)/)
        // Yanlis kaynak REGRESYONU: biri `isTon(network.currentNetwork)` yazarsa capraz
        // zincir portfoyde (Home > "Tum Aglar") karar TAMAMEN yanlis olur — kullanici
        // EVM agindayken TON satirina, ya da TON agindayken EVM satirina tiklayabilir.
        expect(TOKEN).not.toMatch(/isTonAsset\s*=\s*computed\(\(\)\s*=>\s*isTon\(network\.currentNetwork\)\)/)
    })

    // Bu test bir donem `v-if="!isTonAsset"` metnini kilitliyordu. O kosul, yazildigi
    // gun DOGRU cevabi veriyordu ama KARARIN KENDISI degil onu taklit eden bir vekildi:
    // chainKind.js tablosu TON takasina "evet" demeye baslayinca vekil "hayir" demeye
    // devam etti ve ozellik kullaniciya HIC gorunmedi. Ayni hata once Home.vue'da
    // yasandi, buraya da kopyalanmisti.
    //
    // KORUNAN SEY DEGISMEDI: kapi bir `v-if` olmali - dugme soluk/kilitli birakilip
    // tiklanabilir DURMAMALI. Degisen tek sey, kapinin neye BAKTIGI.
    it('Swap ve Bridge dugmeleri v-if ile kapida atilir; soluk/kilitli birakilmaz', () => {
        expect(TOKEN).toMatch(/<button\s+v-if="canSwap"\s+@click="selectSwap"/)
        expect(TOKEN).toMatch(/<button\s+v-if="canBridge"\s+@click="selectBridge"/)
    })

    // Yukaridaki iddia, bayraklari KURMAYAN ya da tabloyu okumayan bir Token.vue ile de
    // gecerdi (`const canSwap = computed(() => !isTonAsset.value)` yazmak yeterdi).
    // Bayragin KAYNAGI ayrica kilitleniyor - ve kaynak SATIRIN zinciri olmali, aktif ag
    // degil: bu describe'in tamaminin konusu tam olarak o ayrim.
    //
    // SOLANA BIRLESMESI: arguman `token.value`DEN `tokenChainRecord.value`A gecti.
    // Iddianin KONUSU degismedi -- kaynak yine SATIRIN zinciri, aktif ag DEGIL:
    // `tokenChainRecord` tam olarak `token.value?.chainId`nin ALL_CHAINS karsiligidir.
    // Degisme sebebi, iddianin dayandigi iki BIRLESME ONCESI gercegin dusmesi:
    //   1) "chainId hep sayidir": ham `token.value` ne `kind` ne `vm` tasir, chainKind
    //      onu ancak Number()'a cevirerek siniflandirabiliyor ve Solana'nin METIN
    //      kimligi ('solana-mainnet') orada NaN'a dusuyor -- dogru cevap, YANLIS
    //      sebeple (bkz. chainKind.js bas yorumu). `tokenChainRecord` bir ALL_CHAINS
    //      kaydidir ve `vm`/`kind` alanlarini TASIR: kapi tipi TAHMIN etmez, OKUR.
    //   2) "kayit hep vardir": `token.value` kanonik kayit gelene kadar ve
    //      /getTokenDataById 500 dondugunde NULL'dur; `chainSupportsFlow(null, ...)`
    //      false doner, yani dugmeler EVM'de de kaybolurdu. Token.ssr.test.js bunu
    //      GERCEKTEN render ederek olcuyor ("kayit YUKLENEMEZSE (500) EVM aktifken
    //      Swap/Kopru/Al-Sat GORUNUR KALIR") -- iki dosya ayni anda yesil olamiyordu.
    // Kilidin disleri asagida korunuyor: kaynak SATIRIN kaydindan turemeli ve
    // AKTIF AG dogrudan okunmamali.
    it('bayraklar akis tablosundan ve SATIRIN zincirinden turer', () => {
        expect(TOKEN).toContain(
            'const canSwap = computed(() => chainSupportsFlow(tokenChainRecord.value, FLOW.SWAP))'
        )
        expect(TOKEN).toContain(
            'const canBridge = computed(() => chainSupportsFlow(tokenChainRecord.value, FLOW.BRIDGE))'
        )
        // Kaynagin KENDISI de kilitli: tokenChainRecord SATIRIN chainId'sini arar.
        expect(TOKEN).toMatch(/const tokenChainRecord = computed\(/)
        expect(TOKEN).toMatch(/const id = token\.value\?\.chainId/)
        // Yanlis kaynak REGRESYONU (bu describe'in konusu): tabloya dogrudan aktif ag
        // verilirse capraz zincir portfoyde karar tamamen yanlis olur.
        expect(TOKEN).not.toMatch(/chainSupportsFlow\(network\.currentNetwork/)

        // FAIL-OPEN KILIDI (birlesme sonrasi tur). Yukaridaki negatif iddia TEK
        // BASINA SAHTE GUVENCEYDI: yalnizca LITERAL yazimi engelliyor, oysa kod
        // aktif agi TEK ATLAMAYLA -- tokenChainRecord'un "kayit cozulemedi" dali
        // uzerinden -- zaten okuyordu. Olculdu: aktif ag Ethereum + metadata'si
        // OLMAYAN bir SPL satirinda Takas/Kopru/Al ACILIYORDU (props.id null ->
        // istek duser -> token.value null -> kapi Ethereum kaydini okur).
        //
        // Kural: aktif ag SON CARE'dir. Ondan ONCE SATIRIN kendi kimligi
        // (pickedRef -> selected_token_ref) okunmali; satirin kimligi de yoksa
        // aktif aga dusmek DOGRUDUR, cunku o halde ensureChain de hicbir gecis
        // yapmaz. Davranis olcumu Token.ssr.test.js'te ("kanonik kayit COZULEMEZSE
        // kapi SATIRIN zincirini okur").
        const record = block(TOKEN, 'const tokenChainRecord = computed(', /^\}\)/)
        expect(record).toMatch(/pickedRef\(\)\?\.chainId/)
        expect(record.indexOf('pickedRef()')).toBeLessThan(record.indexOf('network.currentNetwork'))
    })

    // Kapi ile EYLEM ayni zinciri gormeli: kapi satirin zincirine baktigina gore
    // gecis de o zincire yapilmali, yoksa TON satirinda acilan Takas dugmesi
    // kullaniciyi ETHEREUM takas ekranina goturur (kayit cozulemediginde
    // `token.value` null'dur ve ensureChain(null) HICBIR gecis yapmaz).
    it('Takas/Kopru gecisi de kapiyla AYNI kaynaga (displayToken) bakar', () => {
        for (const fn of ['const selectSwap', 'const selectBridge']) {
            expect(block(TOKEN, fn), fn).toMatch(/ensureChain\(displayToken\.value\)/)
        }
        // `inToken`in TABANI BILEREK kanonik kayit kalir (Token.ssr.test.js: "EVM de
        // kayit yuklenemezse swap.inToken HALA null") -- degisen tek sey HANGI AG.
        //
        // 2026-09-15: kayit artik `satirKimligiyle` ile SARMALANIYOR (satirin ondalik
        // ve sembolu ustune yaziliyor; gerekce Token.vue'daki yardimcinin basinda).
        // ILK ARGUMAN hala `token.value` OLMAK ZORUNDA: `displayToken.value`
        // yazilirsa kayit cozulemedigi durumda Takas'a satirdan URETILMIS bir kayit
        // gider ve yukaridaki kilitli karar bozulur.
        expect(block(TOKEN, 'const selectSwap'))
            .toMatch(/crypto\.swap\.inToken\s*=\s*satirKimligiyle\(\s*token\.value\s*,/)
    })

    it('Gonder TON da da calisir; kosulsuz kaldigini kilitle', () => {
        // Send TON icin de calisan gercek bir akis (tonSend.js). Biri yanlislikla
        // bunu da isTonAsset arkasina alirsa TON'da hicbir islem yapilamaz hale gelir.
        expect(TOKEN).toMatch(/<button\s+@click="selectSend"/)
    })

    // BULGU 2 (merge engelleyici, bu turun duzeltmesi): bu dugme Home.vue'daki "Al"
    // (adres gosteren Receive popup'i) DEGIL — BuyToken.vue'yu (MoonPay kredi karti
    // akisi) acar. TON'da MoonPay kapsam disi (spec §8) ve BuyToken.vue EVM `0x`
    // adresini "Alici Adresi" diye gosterip sunucuya currencyCode:'ton' +
    // walletAddress:0x gonderirdi. Onceki tur bunu YANLISLIKLA "TON'da da calisan
    // gercek bir akis" sanip kosulsuz birakmisti (bkz. git gecmisi) — Swap/Bridge
    // ile AYNI v-if deseni burada da gerekli.
    it('Al (BuyToken/MoonPay) Swap/Bridge ile AYNI kapidan gecer, kosulsuz KALMAZ', () => {
        expect(TOKEN).toMatch(/<button\s+v-if="!isTonAsset"\s+@click="selectReceive"/)
        expect(TOKEN).not.toMatch(/<button\s+@click="selectReceive"/)
    })

    it('token.value.chainId SATIRIN kendi kaydindan gelir (pickedRef -> selected_token_ref)', () => {
        // isTonAsset'in dogru karar verebilmesi icin token.value.chainId SATIRIN
        // chainId'si olmali; (2) nolu describe'da zaten kilitli, burada capraz
        // referans olarak yeniden dogrulaniyor — regresyon iki testi BIRDEN kirar.
        //
        // SOLANA BIRLESMESI: `Number(...)` sarmalayicisi DUSTU. Iddia "kimlik SATIRDAN
        // gelir" olarak AYNEN duruyor, yalnizca "her chainId sayidir" varsayimi artik
        // gecersiz: Number('solana-mainnet') NaN'dir ve o NaN kayda yazilip oldugu gibi
        // crypto.sendAsset'e tasinirdi. AYNI olcut (2) nolu describe'da Task 16a
        // gerekcesiyle zaten yaziliydi -- iki iddia birbiriyle CELISIYORDU.
        const fn = block(TOKEN, 'onMounted(async', /^\}\)/)
        expect(fn).toMatch(/chainId:\s*picked\.chainId/)
        expect(fn).not.toMatch(/chainId:\s*Number\(picked\.chainId\)/)
    })
})

// Onceki turda raporlanan (duzeltilmeyen) iki bulgu: (1) TON varliginda bakiye ya
// hep "0" (aktif ag TON'ken network.rpc null) ya da SESSIZCE kullanicinin EVM
// bakiyesi "TON" etiketiyle (aktif ag EVM'ken, capraz zincir portfoyden bakilinca
// rpcForChain aktif EVM agina duser); (2) "Ag" satiri satirin zincirini degil
// AKTIF agi gosteriyordu. Koordinator ikisini de Important isaretledi ve bu turda
// duzeltildi. Ayni mount-edilemez kisitlama gecerli (bkz. (6) nolu describe'un
// aciklamasi); kilit yine kaynak-metin regex'i ile.
describe('(7) Token.vue: TON bakiyesi kendi yolundan gelir, hata 0 GOSTERMEZ; Ag adi SATIRIN zincirinden cozulur', () => {
    it('TON bakiyesi useTokenBalance (EVM) DEGIL, getTonBalance/getTonClient/ensureTonAddress uzerinden gelir', () => {
        expect(TOKEN).toMatch(/import\s*\{\s*getTonClient\s*\}\s*from\s*['"]\.\.\/utils\/ton\/tonClient['"]/)
        expect(TOKEN).toMatch(/import\s*\{\s*getTonBalance\s*\}\s*from\s*['"]\.\.\/utils\/ton\/tonBalance['"]/)
        expect(TOKEN).toMatch(/import\s*\{\s*ensureTonAddress\s*\}\s*from\s*['"]\.\.\/utils\/ton\/tonIdentity['"]/)

        const fn = block(TOKEN, 'onMounted(async', /^\}\)/)
        // Karar SATIRIN zincirine gore (isTonAsset), aktif aga gore DEGIL.
        expect(fn).toMatch(/if\s*\(isTonAsset\.value\)\s*\{/)
        // Gorev 1 (ag bazli TON adres onbellegi) sonrasi cagri opts alir; kilit
        // active_account'un hala DOGRU parametre oldugunu, testnet bayraginin da
        // GECTIGINI dogrular.
        expect(fn).toMatch(/ensureTonAddress\(\s*active_account\s*,\s*\{\s*testnet:/)
        expect(fn).toMatch(/getTonBalance\(getTonClient\(config\.api\),\s*tonAddress\)/)
    })

    it('TON kolunda hata durumunda balance/usdBalance YAZILMAZ (0a dusurulmez) - balanceError=true kalir', () => {
        const fn = block(TOKEN, 'onMounted(async', /^\}\)/)
        // TON try/catch'inin catch govdesi: sadece balanceError=true, balance/usdBalance'a
        // DOKUNULMAZ. `[^{}]*` sarti ayni dosyadaki (2) nolu testteki gibi ic try'a hapseder.
        const tonCatch = fn.match(/if\s*\(isTonAsset\.value\)\s*\{[\s\S]*?catch\s*\(e\)\s*\{([^{}]*)\}/)
        expect(tonCatch, 'TON catch govdesi bulunamadi').toBeTruthy()
        const body = tonCatch[1]
        expect(body).toMatch(/balanceError\.value\s*=\s*true/)
        expect(body).not.toMatch(/balance\.value\s*=/)
        expect(body).not.toMatch(/usdBalance\.value\s*=/)
    })

    it('EVM kolu da TON ile AYNI kurala gecti: useTokenBalance + hata 0a DUSURULMEZ (balanceError)', () => {
        // Eski davranis (hatada balance=0) BILEREK degistirildi (UI/UX taramasi,
        // 2026-09-02): sahte 0, spec'in "hata 0 gostermez" kuralini EVM kolunda da
        // ihlal ediyordu. Artik catch yalniz balanceError isaretler, sablon "—" basar.
        const fn = block(TOKEN, 'onMounted(async', /^\}\)/)
        const evmElse = fn.match(/\}\s*else\s*\{([\s\S]*?)\n\s*\}\n\s*\n?\s*\}\s*catch\s*\(e\)\s*\{\s*console\.error\("Token data fetch error/)
        expect(evmElse, 'EVM else govdesi bulunamadi').toBeTruthy()
        const body = evmElse[1]
        // 4. arguman `chainId` SATIRIN zincirinden gelir (rpc de oyle): bStock
        // kolu ancak dogru uctayken acilmali, yoksa satir bos/0 kalirdi.
        expect(body).toMatch(/useTokenBalance\(active_account\.address,\s*token\.value\.address,\s*rpc,\s*token\.value\.chainId\)/)
        // catch govdesi: sadece balanceError=true; balance/usdBalance'a DOKUNULMAZ
        // (TON kolu testiyle ayni `[^{}]*` hapsi).
        const evmCatch = body.match(/catch\s*\(e\)\s*\{([^{}]*)\}/)
        expect(evmCatch, 'EVM catch govdesi bulunamadi').toBeTruthy()
        expect(evmCatch[1]).toMatch(/balanceError\.value\s*=\s*true/)
        expect(evmCatch[1]).not.toMatch(/balance\.value\s*=/)
        expect(evmCatch[1]).not.toMatch(/usdBalance\.value\s*=/)
    })

    it('sablon miktar yerine "—" basar (balanceError), hicbir yerde ciplak balance.toFixed kalmadi', () => {
        expect(TOKEN).toMatch(/\{\{\s*balanceError\s*\?\s*'—'\s*:\s*balance\.toFixed\(6\)\s*\}\}/)
        expect(TOKEN).toMatch(/\{\{\s*balanceError\s*\?\s*'—'\s*:\s*'\$'\s*\+\s*formatCurrency\(usdBalance\)\s*\}\}/)
        // Eski, kosulsuz hal REGRESYONU: biri balanceError kontrolunu kaldirirsa "0"
        // sessizce geri doner (spec ihlali).
        expect(TOKEN).not.toMatch(/\{\{\s*balance\.toFixed\(6\)\s*\}\}/)
    })

    it('"Ag" satiri artik AKTIF agi degil SATIRIN zincirini gosterir', () => {
        expect(TOKEN).toMatch(/assetChainName\s*=\s*computed\(\(\)\s*=>\s*\{/)
        const fn = block(TOKEN, 'const assetChainName = computed')
        // SOLANA BIRLESMESI: karsilastirici `Number(a) === Number(b)` DEGIL
        // `isSameChainId`. Iddia degismedi (ad SATIRIN chainId'sinden cozulur), ama
        // sayisal karsilastirma "her chainId sayidir" gercegine dayaniyordu: Solana'da
        // iki taraf da NaN olur, NaN === NaN false'tur ve satir Solana'dayken ekran
        // yine AKTIF agin adini yazardi -- bu testin kapattigi TON hatasinin birebir
        // ikizi. isSameChainId bu dosyadaki (ve Token.vue'deki) tek karsilastiricidir.
        expect(fn).toMatch(/ALL_CHAINS\.find\(c\s*=>\s*isSameChainId\(c\.chainId,\s*token\.value\?\.chainId\)\)/)

        // Sablonda dogrudan `network.currentNetwork.name` KALMADI; "Ag" satiri
        // `assetChainName`'i kullanir.
        expect(TOKEN).toMatch(/\{\{\s*assetChainName\s*\}\}/)
        expect(TOKEN).not.toMatch(/\{\{\s*network\.currentNetwork\.name\s*\}\}/)
    })
})

// BULGU 4: `/getTokenDataById` kaydinda decimals YOK; TON satirinin adresi '0x0'
// oldugu icin Token.vue zincirden de okuyamiyordu (yukaridaki (2) nolu describe'daki
// AYNI onMounted bloğu, `token.value.address !== '0x0'` kapisinin ARKASINDA kaliyor)
// -> Send.vue `crypto.sendAsset?.decimals || 18` sessizce 18'e duşuyordu. TON 9
// ondaliklidir: formatSafeAmount(v, 18) float artigini kirpmiyor, toNano 9 basamaktan
// fazla girdide TON_AMOUNT_INVALID atiyor ("Gecersiz miktar"). Fail-closed, para kaybi
// YOK — ama başlik özelliği (MAX/Send) bozuktu. Home satirinin KENDI decimals'i
// (buildNativeToken decimals:9) satirin diger kimlik alanlariyla (chainId, address)
// AYNI yoldan (selected_token_ref -> pickedRef) tasinir.
describe('(8) Token.vue: Gonder varligi Home satirindan DOGRU decimals tasir (TON 9, sessiz 18 degil)', () => {
    it('Home selectToken decimals i de selected_token_ref e yazar', () => {
        const fn = block(HOME, 'const selectToken =')
        expect(fn).toMatch(/decimals:\s*token\.decimals/)
    })

    // KARAR TASINDI, KAYBOLMADI (2026-09-15). Ayni devir Takas'ta da gerekiyordu
    // (kanonik kayit ondaliksiz -> JETTON_DECIMALS_MISSING) ve iki kopya ayrisirsa
    // biri sessizce eksik kayit devreder; karar tek yardimciya alindi:
    // `satirKimligiyle`. Iddia bu yuzden artik ORAYA bakiyor.
    it('Token.vue selectSend crypto.sendAsset e picked.decimals + chainId yi tasir', () => {
        const cagri = block(TOKEN, 'const selectSend =')
        expect(cagri).toMatch(/pickedRef\(\)/)
        // Devri YAPAN yer: ortak yardimci.
        expect(cagri).toMatch(/satirKimligiyle\(\s*asset\s*,\s*picked\s*\)/)

        const fn = block(TOKEN, 'const satirKimligiyle =')
        expect(fn).toMatch(/decimals:\s*picked\.decimals/)
        // SOLANA BIRLESMESI: onMounted'daki AYNI sebeple `Number(...)` dustu (bkz. (2)
        // ve (6) nolu describe'lar). Kimlik KENDI TIPINDE tasinir: EVM sayi, TON
        // negatif sayi, Solana METIN. Davranis olcumu Token.ssr.test.js'te
        // ("native SOL: chainId METIN kalir").
        expect(fn).toMatch(/chainId:\s*picked\.chainId/)
        expect(fn).not.toMatch(/chainId:\s*Number\(picked\.chainId\)/)
    })

    it('picked yoksa (pickedRef() id uyusmazligi) kayit OLDUGU GIBI kalir', () => {
        // Stale selected_token_ref (baska bir token id) durumunda YANLIS chainId/decimals
        // ZORLA YAZILMAMALI; kayit zaten kanonik kayittan (veya onceki eslesmeden)
        // geliyor. Karar `satirKimligiyle`nin ILK SATIRINDA ve artik IKI cagirani
        // birden koruyor (Takas + Gonder).
        const fn = block(TOKEN, 'const satirKimligiyle =')
        expect(fn).toMatch(/if\s*\(!kayit\s*\|\|\s*!picked\)\s*return\s+kayit/)
    })
})
