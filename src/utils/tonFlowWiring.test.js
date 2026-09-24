import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// TON'un swap/bridge koduna ulasabildigi yollari kapatan degisikligin BAGLANTI testleri.
//
// Saf kapilar (chainSupportsFlow, chainsForFlow) kendi dosyalarinda test ediliyor. Ama
// dogru calisan bir kapi CAGRILMAZSA hicbir sey yapmaz - bugunku sizintinin tamami tam
// olarak buydu: kapi Home.vue'daki bir `v-if`ti ve bes ayri yol onu atliyordu.
//
// Bu depoda kaynak metni okuyan bu kalip zaten var (swapWiring.test.js,
// assetRouteWiring.test.js).

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const SELECT_FROM = read('../components/bridge/selectFromChain.vue')
const SELECT_TO = read('../components/bridge/selectToChains.vue')
const NETWORKS_POPUP = read('../components/popups/networksPopup.vue')
const CHANGE_NETWORK = read('../components/ChangeNetwork.vue')
const SWAP = read('../components/Swap.vue')
const SWAP_FROM = read('../components/swap/swapFrom.vue')
const BRIDGE_FROM = read('../components/bridge/bridgeFrom.vue')
const BACKGROUND = read('../background.js')

describe('kopru zincir secicileri akisa gore listeler', () => {
    it('kaynak zincir secicisi chainsForFlow(bridge) kullanir', () => {
        expect(SELECT_FROM).toContain("chainsForFlow('bridge')")
    })

    it('hedef zincir secicisi chainsForFlow(bridge) kullanir', () => {
        expect(SELECT_TO).toContain("chainsForFlow('bridge')")
    })

    // Filtresiz LISTED_CHAINS bu iki dosyada sizintinin ta kendisiydi.
    it('iki secici de artik LISTED_CHAINS i DOGRUDAN listelemez', () => {
        expect(SELECT_FROM).not.toContain('LISTED_CHAINS')
        expect(SELECT_TO).not.toContain('LISTED_CHAINS')
    })
})

describe('ag degisimi tek govdeden gecer', () => {
    it('kaynak zincir secicisi applyNetworkChange kullanir', () => {
        expect(SELECT_FROM).toContain("applyNetworkChange(chain, t, { flow: 'bridge' })")
    })

    // Ham setCurrentNetwork cagrisi akis kapisini, swap/bridge secim temizligini ve
    // dapp bildirimini birden atliyordu.
    it('kaynak zincir secicisi ham setCurrentNetwork CAGIRMAZ', () => {
        // CAGRI aranir, kelime degil: yukaridaki aciklama yorumu da bu adi geciyor.
        expect(SELECT_FROM).not.toContain('network.setCurrentNetwork(')
    })

    it('reddedilen gecis akisi durdurur', () => {
        expect(SELECT_FROM).toContain('if (!reachable) return')
    })
})

describe('ag secici popup akis tasir', () => {
    it('liste props.flow ile daraltilir', () => {
        expect(NETWORKS_POPUP).toContain('chainsForFlow(props.flow)')
    })

    it('secim de ayni akisi tasir', () => {
        expect(NETWORKS_POPUP).toContain('applyNetworkChange(data, t, { flow: props.flow })')
    })

    it('ChangeNetwork akisi popup a gecirir', () => {
        expect(CHANGE_NETWORK).toContain(':flow="props.flow"')
    })

    it('Takas ekrani ag degistiriciye flow=swap verir', () => {
        expect(SWAP).toContain('<ChangeNetwork flow="swap"')
    })
})

describe('token secicileri de akisa gore kapsanir', () => {
    // "Tum Aglar" kapsaminda bunlar TON dahil her zincirin kimligini sunucuya soruyordu;
    // donen TON varligi secilince aktif ag takas/kopru ekraninin ICINDE TON'a geciyordu.
    it('takas token secicisi chainsForFlow(swap) kapsar', () => {
        expect(SWAP_FROM).toContain("scopeChainIds(activeScope.value, chainsForFlow('swap'))")
        expect(SWAP_FROM).not.toContain('scopeChainIds(activeScope.value, LISTED_CHAINS)')
    })

    it('kopru token secicisi chainsForFlow(bridge) kapsar', () => {
        expect(BRIDGE_FROM).toContain("scopeChainIds(scope.filter, chainsForFlow('bridge'))")
        expect(BRIDGE_FROM).not.toContain('scopeChainIds(scope.filter, LISTED_CHAINS)')
    })
})

describe('arka plan ikinci katman', () => {
    it('background chainSupportsFlow u import eder', () => {
        expect(BACKGROUND).toContain("import { chainSupportsFlow } from './utils/chainKind'")
    })

    it('swap ve bridge isleyicileri akisi dogrular', () => {
        expect(BACKGROUND).toContain("assertChainFlow(found, 'swap')")
        expect(BACKGROUND).toContain("assertChainFlow(found, 'bridge')")
    })

    // Dogrulama provider KURULMADAN once olmali; yoksa TON yine
    // "Cannot read properties of undefined (reading 'url')" uretir.
    it('dogrulama JsonRpcProvider dan ONCE calisir', () => {
        const guardAt = BACKGROUND.indexOf("assertChainFlow(found, 'swap')")
        const providerAt = BACKGROUND.indexOf('new ethers.JsonRpcProvider(found.rpc[0].url)', guardAt)
        expect(guardAt).toBeGreaterThan(-1)
        expect(providerAt).toBeGreaterThan(guardAt)
    })

    it('hata anlamli bir ad tasir — "undefined url" degil', () => {
        expect(BACKGROUND).toContain('CHAIN_UNSUPPORTED_FOR_FLOW')
    })
})

// Bu blok, dosyanin bas yorumunda "sizintinin ta kendisi" diye anilan yerin
// KENDISINI kilitliyor: Home.vue'daki v-if. Ironik bicimde o yorum yazildiginda
// Home.vue icin tek bir iddia bile eklenmemisti; kapi chainKind.js'te TON takasa
// ACILDIGINDA (Gorev 9) dugme Home.vue'da elle gizli kaldigi icin ozellik
// kullaniciya HIC gorunmedi. Kapinin acilmasi tek basina yetmiyor - dugmenin de
// ayni tablodan okumasi gerek.
describe('ana ekran eylem dugmeleri akis tablosundan okur', () => {
    const HOME = read('../components/Home.vue')

    // Bayrak TANIMININ kendisi olculuyor, dosyanin herhangi bir yerinde gecen
    // `chainSupportsFlow` degil: cagrilip SONUCU ATILAN bir tablo okumasi, elle
    // yazilmis bir kosul kadar yanlistir ve "dosyada geciyor mu" iddiasi ikisini
    // ayirt edemez.
    // NOT: bu iddia bir donem `canBridge`i de kapsiyordu. Kopru dugmesi 2026-08-27'de
    // bilincli olarak HESABA baglandi (bkz. "kopru dugmesi hesaba sorar" blogu) -
    // tablo hala kopru ZINCIR SECICILERINI yonetiyor, dugmeyi degil. Takas ise
    // gercekten bir zincir sorusu ve burada kaliyor.
    it('takas bayragi dogrudan akis tablosundan turer', () => {
        expect(HOME).toContain(
            'const canSwap = computed(() => chainSupportsFlow(network.currentNetwork, FLOW.SWAP))'
        )
    })

    // Asil kusur: zincir TIPINE bakan bir gorunum kosulu. `isTonNetwork` bir KARAR
    // degil, karari TAKLIT eden bir vekildi ve tablo degistiginde onunla birlikte
    // degismedi.
    //
    // Adin dosyada HIC gecmemesini istemek fazlaydi: yukaridaki aciklama yorumu
    // vekilin neden kaldirildigini anlatmak icin adi ANMAK zorunda. Yasak, adin
    // yeniden CALISAN KOD olmasina: ne bir tanim, ne bir sablon baglantisi.
    it('zincir tipine bakan vekil kosul geri gelmez', () => {
        expect(HOME).not.toMatch(/(const|let|var)\s+isTonNetwork/)
        expect(HOME).not.toMatch(/v-if="!?isTonNetwork"/)
    })

    // Dugmeler `canSwap`/`canBridge` uzerinden baglanmali. Bu iddia olmasaydi
    // yukaridaki iki iddia, bayraklari kurup KULLANMAYAN bir Home.vue ile de
    // gecerdi.
    it('dugmeler hesaplanan bayraklara baglidir', () => {
        const swapBtn = HOME.split('\n').find((l) => l.includes("currentPage = 'swap'"))
        const bridgeBtn = HOME.split('\n').find((l) => l.includes('v-if="canBridge"'))
        expect(swapBtn).toMatch(/v-if="canSwap"/)
        // Kopru dugmesi artik dogrudan yonlendirmiyor: once agi koprulenebilir bir
        // zincire aliyor (goToBridge). Baglantinin KENDISI yine bayrak uzerinden.
        expect(bridgeBtn).toMatch(/@click="goToBridge"/)
    })

    // Sutun sayisi GORUNUR dugme sayisindan turemeli. Eskiden "TON ise 2, degilse 4"
    // yaziyordu; takas acilinca TON'da 3 dugme olacak ve o formul sessizce yanlis
    // duzen uretirdi (2 sutuna 3 dugme).
    it('sutun sayisi gorunur dugme sayisindan turer', () => {
        expect(HOME).toContain('actionGridClass')
        expect(HOME).not.toMatch(/isTon[^\n]*grid-cols-2/)
    })
})

// Home.vue duzeltmesinin ATLANMIS IKIZI.
//
// Yukaridaki blok yazildiginda Home.vue kapatildi ve is bitti sanildi. Ama takas
// ekranina giden IKINCI bir kapi daha vardi: token detay sayfasi (Token.vue
// selectSwap). Orada da ayni vekil kosul duruyordu - `v-if="!isTonAsset"` - ve tablo
// TON takasina "evet" dedikten sonra bile jetton satirindaki Takas dugmesi gizliydi.
//
// Ders, bir dosyayi duzeltmenin yetmedigi: vekil kosul KAC yola kopyalandiysa o kadar
// yerde curur. Bu blok ikinci yolu kilitliyor.
describe('token detay sayfasi eylem dugmeleri akis tablosundan okur', () => {
    const TOKEN = read('../components/Token.vue')

    // Kaynak SATIRIN zinciri olmali, aktif ag degil: capraz zincir portfoyde
    // (Home > "Tum Aglar") kullanici Ethereum'dayken bir TON satirini acabilir ve
    // `network.currentNetwork` orada YANLIS cevap verirdi. Ayni gerekce dosyadaki
    // `isTonAsset` ve "Ag" satiri icin de yazili.
    // SOLANA BIRLESMESI: arguman `token.value`DEN `tokenChainRecord.value`A gecti.
    // Iddianin KONUSU degismedi -- kaynak yine SATIRIN zinciri, aktif ag DEGIL:
    // tokenChainRecord tam olarak `token.value?.chainId`nin ALL_CHAINS karsiligidir ve
    // `vm`/`kind` alanlarini TASIR (ham token kaydi ikisini de tasimaz, chainKind onu
    // ancak Number() ile tahmin edebiliyor ve Solana'nin METIN kimligi orada NaN'a
    // dusuyordu). Ayrica `token.value` kanonik kayit gelene kadar NULL'dur; ham haliyle
    // sorulunca kapi EVM'de de kapanip Token.ssr.test.js'in olctugu davranisi
    // ("kayit YUKLENEMEZSE (500) EVM aktifken ... GORUNUR KALIR") bozuyordu.
    // Gerekcenin tamami assetRouteWiring.test.js (6) nolu describe'da.
    it('bayraklar satirin zincirinden ve akis tablosundan turer', () => {
        expect(TOKEN).toContain(
            'const canSwap = computed(() => chainSupportsFlow(tokenChainRecord.value, FLOW.SWAP))'
        )
        expect(TOKEN).toContain(
            'const canBridge = computed(() => chainSupportsFlow(tokenChainRecord.value, FLOW.BRIDGE))'
        )
        // Kaynak SATIRDAN turemeli: aktif agi dogrudan tabloya vermek YASAK.
        expect(TOKEN).toMatch(/const id = token\.value\?\.chainId/)
        expect(TOKEN).not.toMatch(/chainSupportsFlow\(network\.currentNetwork/)

        // Yukaridaki negatif iddia TEK BASINA YETMIYOR (birlesme sonrasi tur):
        // literal yazimi engelliyor ama kod aktif agi TEK ATLAMAYLA okuyabiliyordu
        // -- kanonik kayit cozulemedigin de tokenChainRecord AKTIF AGA dusuyordu ve
        // Ethereum aktifken bir TON/SPL satirinda kapi ACILIYORDU. Aktif agdan ONCE
        // SATIRIN kendi kimligi okunur; gerekcenin tamami ve sira kilidi
        // assetRouteWiring.test.js (6) nolu describe'da, davranis olcumu
        // Token.ssr.test.js'te.
        expect(TOKEN).toMatch(/const rowId = pickedRef\(\)\?\.chainId/)
    })

    // Bayragi kurup KULLANMAYAN bir Token.vue yukaridaki iddiadan gecerdi.
    it('dugmeler hesaplanan bayraklara baglidir', () => {
        const swapBtn = TOKEN.split('\n').find((l) => l.includes('@click="selectSwap"'))
        const bridgeBtn = TOKEN.split('\n').find((l) => l.includes('@click="selectBridge"'))
        expect(swapBtn).toMatch(/v-if="canSwap"/)
        expect(bridgeBtn).toMatch(/v-if="canBridge"/)
    })

    // Asil kusurun geri gelmesi: varlik TIPINE bakan bir gorunum kosulu. `isTonAsset`
    // dosyada KALIYOR (bakiye okumasi ve MoonPay kapsami onu mesru kullaniyor), yasak
    // yalnizca takas/kopru dugmelerine yeniden baglanmasina.
    it('takas/kopru dugmeleri varlik tipine geri baglanmaz', () => {
        const swapBtn = TOKEN.split('\n').find((l) => l.includes('@click="selectSwap"'))
        const bridgeBtn = TOKEN.split('\n').find((l) => l.includes('@click="selectBridge"'))
        expect(swapBtn).not.toMatch(/isTonAsset/)
        expect(bridgeBtn).not.toMatch(/isTonAsset/)
    })

    // Al dugmesi BuyToken.vue'yu (MoonPay) acar ve TON'da kapali KALMALI: bu bir zincir
    // akisi degil saglayici kapsami (spec §8), FLOW tablosunda karsiligi yok. Iddia,
    // "hepsini tabloya bagla" refleksiyle bu dugmenin de yanlislikla acilmasina karsi.
    it('Al dugmesi MoonPay kapsami geregi TON varliginda kapali kalir', () => {
        const buyBtn = TOKEN.split('\n').find((l) => l.includes('@click="selectReceive"'))
        expect(buyBtn).toMatch(/v-if="!isTonAsset"/)
    })
})

// Baslik pill'leri AG kapisi TASIMAZ -- ATS pill'i HESAP kapisi tasir. Ikisi
// celismiyor; farkli sorular.
//
// Bir donem burada `canDapp` (FLOW.DAPP tablosu) ve `isTonNetwork` vardi; ikisi de
// TON AGINDA pill'leri gizliyordu. Kullanici 2026-08-27'de bunu geri aldirdi: EVM
// hesabiyla TON agina bakarken de ATS yakitina ve dapp baglantisina erisebilmek
// istiyor. Sinirlari kendisine anlatildi ve karari yineledi. O karar AYNEN
// yururlukte ve bu blok geri gelmedigini kilitliyor -- bu depoda ayni pill'ler uc
// kez "TON'da gorunmemeli" sezgisiyle elle gizlendi.
//
// 2026-09-05 tasarim belgesi (adim 11) BASKA bir kapi ekledi: ATS pill'i TON
// HESABINDA gizlenir. Kullanici "TON AGINDA gormek istiyorum" dedi, "EVM anahtari
// OLMAYAN bir hesapta" DEMEDI -- o hesapta pill'in gosterecegi bir sey yok:
// AtsFuelPill BSC'yi `activeAccount.address` ile sorgular, `UQ...` adreste
// `token.balanceOf` ethers'ta firlatir, useAtsFuel yutar ve pill sonsuza kadar
// "—" gosterir. Davranis Header.ssr.test.js'te GERCEK render ile olculuyor;
// burasi kapinin AGA degil HESABA bagli oldugunu kilitler.
//
// Karar degistiyse KOD degil, BU TEST degismelidir.
//
// GUNCELLEME (2026-09-10 Gorev 4, tekil aileden kumeye gecis): kapi
// `accountHasEvm(activeAccount)` DEGIL `activeAccount?.type !== 'ton'`.
// Kumeye gecince (accountKind.js) `accountHasEvm` `type:'hd'` icin de `true`
// doner -- eskiden bu, "TON hesabinda gizlenir" davranisini yalnizca genis
// tuttugu icin zararsizdi (her EVM hesabi zaten `true` donuyordu), ama artik
// TON hesabi icin de `true` doner ve tam gizlenmesi gereken nufusu ACIK
// birakir. Dogrudan tip kontrolu bu ayrimi koruyan tek yol.
describe("baslik pill'leri ag kapisi TASIMAZ, ATS pill'i HESAP kapisi tasir", () => {
    const HEADER = read('../components/Header.vue')

    it('ATS pilli YALNIZCA hesap kapisiyla kosullanir, ag kapisiyla DEGIL', () => {
        const idx = HEADER.indexOf('<AtsFuelPill')
        expect(idx).toBeGreaterThan(-1)
        const tag = HEADER.slice(idx, HEADER.indexOf('/>', idx))
        expect(tag).toContain("v-if=\"activeAccount?.type !== 'ton'\"")
        expect(tag).not.toContain('accountHasEvm')
        // Ag kapisi geri gelmemeli: `isTon(...)`, `currentNetwork`, `features.ats`
        // kullanicinin 2026-08-27 kararini sessizce geri alirdi.
        expect(tag).not.toMatch(/isTon|currentNetwork|features\./)
    })

    it('dapp baglanti kabi bir v-if arkasinda DEGIL', () => {
        const idx = HEADER.indexOf('ref="connectionDropdownRef"')
        expect(idx).toBeGreaterThan(-1)
        expect(HEADER.slice(HEADER.lastIndexOf('<div', idx), idx)).not.toContain('v-if')
    })

    // Okunmayan bir hesaplanan deger, ileride birinin "demek ki bu kapi var" diye
    // guvenecegi OLU bir kapidir. Silindiklerini kilitle.
    it('olu kapilar (isTonNetwork / canDapp) geri gelmez', () => {
        expect(HEADER).not.toMatch(/(const|let|var)\s+isTonNetwork/)
        expect(HEADER).not.toMatch(/(const|let|var)\s+canDapp/)
    })

    // GORUNURLUK acildi, KORUMA acilmadi. Bu iddia olmasaydi biri "pill zaten
    // gorunuyor" diye asagidaki kapiyi da gereksiz sanabilirdi: dapp'e TON adresi
    // SUNULMAMASI ayri bir karar ve yurulukte.
    it('dapp e TON adresi sunulmama korumasi YERINDE kalir', () => {
        // FIX 3 (fix dalgasi): kapi FAIL-CLOSED yone cevrildi -- eski kapi tipi
        // BILINMEYEN bir hesapta `acc.address`i aynen dondururdu (o kapi de
        // bilinmeyen tip icin false doner, yani ters kosulu gecerdi). Yeni kapi
        // hesap EVM oldugunu KANITLAMADIKCA null doner.
        expect(HEADER).toContain("const dappAddress = accountHasEvm(acc) ? acc.address : null")
    })
})

// Hesap kapisinin konmadigi SON yuzey.
//
// Kapi ag secicisine, ag degistirmeye, adres satirlarina, dapp yoluna, EditAccount'a
// ve Al ekranina konmustu; varlik listesi atlanmisti. TON'a kilitli hesapta "Tum
// Aglar" secili iken Ethereum ve Tether listeleniyor, "0 ETH" yaziyordu - oysa o
// bir bakiye degil, TON adresiyle yapilip yutulmus bir EVM okumasiydi.
describe('varlik listesi hesap kapisindan gecer', () => {
    const HOME = read('../components/Home.vue')

    it('liste accountSupportsChain ile suzulur', () => {
        expect(HOME).toContain(
            'currentTokens.value = allTokens.filter(t => accountSupportsChain(active_account, t.chainId))'
        )
    })

    it('accountSupportsChain accountKind ten ice aktarilir', () => {
        expect(HOME).toMatch(
            /import\s*\{[^}]*\baccountSupportsChain\b[^}]*\}\s*from\s*['"][^'"]*accountKind['"]/
        )
    })

    // Suzgec ATAMANIN kendisinde olmali: `currentTokens.value = allTokens` satiri
    // geri gelirse liste yine suzulmemis olur, `accountSupportsChain` dosyada gecse
    // bile.
    it('ham liste suzulmeden atanmaz', () => {
        expect(HOME).not.toMatch(/currentTokens\.value\s*=\s*allTokens\s*$/m)
    })
})

// Kapsam pill'i: HESAP boyutundaki sizinti.
//
// `chainsForFlow` AKIS sizintisini kapatmisti (kopru zincir secicileri LISTED_CHAINS'i
// filtresiz listeliyordu). Ayni kalip kapsam pill'inde HESAP boyutunda duruyordu:
// TON'a kilitli hesapta menu Ethereum'u, Polygon'u, hepsini gosteriyor, birini secince
// liste bosalip "bu agda token yok" yaziyordu.
//
// Kullanicinin bildirdigi hali: "sadece TON'da olmasina ragmen tum aglar seklinde
// gozukuyor."
describe('kapsam pilli hesap kapisindan gecer', () => {
    const PILL = read('../components/NetworkScopePill.vue')

    it('menu listesi chainsForAccount ten turer', () => {
        expect(PILL).toContain('const chains = computed(() => chainsForAccount(activeAccount.value, LISTED_CHAINS))')
        expect(PILL).toMatch(
            /import\s*\{[^}]*\bchainsForAccount\b[^}]*\}\s*from\s*['"][^'"]*accountKind['"]/
        )
    })

    // Bayragi kurup KULLANMAYAN bir surum yukaridaki iddiadan gecerdi: `v-for` hala
    // LISTED_CHAINS'i dolasiyor olabilirdi.
    it('v-for filtresiz LISTED_CHAINS i DOLASMAZ', () => {
        expect(PILL).toContain('v-for="chain in chains"')
        expect(PILL).not.toMatch(/v-for="chain in LISTED_CHAINS"/)
    })

    // Tek zincirli hesapta "Tum Aglar" bir secenek degil - kume zaten tek zincir.
    it('tek zincirli hesapta Tum Aglar secenegi sunulmaz', () => {
        expect(PILL).toContain('const showAll = computed(() => props.allowAll && chains.value.length > 1)')
        expect(PILL).toContain('v-if="showAll"')
    })

    // Etiket DEGERI degil, ADI duzeltir. Store'a yazmak `chosen` mandalini kaldirir
    // ve effectiveScope'un tek zincirli ekranlardaki davranisini sessizce degistirirdi.
    it('etiket tek zincirde zincir adini yazar, deger DEGISTIRILMEZ', () => {
        expect(PILL).toContain('const soleChain = computed(() => (chains.value.length === 1 ? chains.value[0] : null))')
        expect(PILL).toContain('const showAllLabel = computed(() => isAll.value && !soleChain.value)')
        // `select` disinda bir emit yok: pill kendi kendine kapsam YAZMAZ.
        expect(PILL.match(/emit\('update:modelValue'/g) || []).toHaveLength(1)
    })
})

// Kopru dugmesi ZINCIRE degil HESABA sorar (kullanici karari, 2026-08-27).
//
// Iki ayri soru uzun sure tek satirda birlestirilmisti:
//   1) "bu ZINCIR koprulenebilir mi" -> zincir SECICILERI hala bunu okuyor
//   2) "bu HESAP kopru ekranina girebilir mi" -> hesabin EVM adresi var mi
// Dugme (1)'i soruyordu ve EVM hesabiyla TON agina bakan kullanici dugmeyi hic
// goremiyordu - oysa onun EVM adresi VAR, eksik olan yalnizca aktif agdi.
describe('kopru dugmesi hesaba sorar, zincire degil', () => {
    const HOME = read('../components/Home.vue')

    // Gorev 4 (accountKindOf/isTonOnlyAccount temizligi): `isTonOnlyAccount` kod
    // tabanindan tamamen kaldirildi. Sorulan soru degismedi ("hesabin EVM adresi
    // var mi"), yalnizca ifade degisti -- `accountHasEvm` kullanilamaz cunku
    // kumeye gecince (accountKind.js) o fonksiyon `type:'ton'` icin de `true`
    // doner; dogrudan tip kontrolu ayni ayrimi koruyan tek yol.
    it('canBridge hesabin EVM adresi olup olmadigindan turer', () => {
        expect(HOME).not.toContain('isTonOnlyAccount')
        expect(HOME).toContain(
            "const canBridge = computed(() => activeAccount.value !== null && activeAccount.value?.type !== 'ton')"
        )
    })

    // `activeAccount` null "TON degil" DEMEK DEGIL, "henuz bilinmiyor" demek. Kapi
    // null'i acik sayarsa dugme bir kare gorunup kaybolur.
    it('hesap bilinmeden dugme acilmaz', () => {
        expect(HOME).toMatch(/canBridge[^\n]*activeAccount\.value !== null/)
    })

    // Takas kapisi DEGISMEDI: o gercekten zincire ait bir soru (STON.fi TON'da var,
    // EVM'de swapChains tablosu). Ikisini ayni anda "hesaba sor" yapmak yanlis olurdu.
    it('takas kapisi hala akis tablosundan okur', () => {
        expect(HOME).toContain(
            'const canSwap = computed(() => chainSupportsFlow(network.currentNetwork, FLOW.SWAP))'
        )
    })

    // Dugmeyi gorunur yapmak TEK BASINA yetmiyordu: kopru ekraninin kaynak zinciri
    // aktif agdir, yani TON'da acilinca ekranda kaynak olarak "TON" yazardi -
    // kullanicinin acikca istemedigi sey.
    it('gecis once koprulenebilir bir zincire alir', () => {
        expect(HOME).toContain('const goToBridge = async () => {')
        expect(HOME).toContain("chainsForFlow('bridge').find(c => accountSupportsChain(activeAccount.value, c))")
        const btn = HOME.split('\n').find((l) => l.includes('v-if="canBridge"'))
        expect(btn).toContain('@click="goToBridge"')
        expect(btn).not.toContain("currentPage = 'bridge'")
    })

    // Ag degisimi reddedilirse (RPC yok, kapi reddetti) SAYFA DEGISMEZ: yarim bir
    // gecis, TON'u kaynak gosteren bir kopru ekranindan daha iyidir.
    it('ag degisimi basarisizsa kopru ekranina GECILMEZ', () => {
        const fn = HOME.slice(HOME.indexOf('const goToBridge'))
        const body = fn.slice(0, fn.indexOf('\n}'))
        expect(body).toContain('if (!await applyNetworkChange(target, t, { flow: \'bridge\' })) return')
        expect(body.indexOf('return')).toBeLessThan(body.indexOf("page.currentPage = 'bridge'"))
    })
})

// Ag secicideki "EVM Cuzdani Olustur" yonlendirmesi KALDIRILDI.
//
// Kisa omurluydu ve sebebi ogreticidir: yonlendirme, kullanicinin EVM cuzdani
// olmadigi durumu kapatmak icin eklendi. Ayni turda hibrit ice aktarma geldi ve o
// durumu KAYNAGINDA yok etti - TON ice aktaran kullaniciya artik yaninda bir EVM
// kasasi da kuruluyor.
//
// Sonrasinda olculdu: TON kasasi YALNIZCA iki yerde kuruluyor (CreatePassword2,
// ImportPhrases) ve ikisi de hibrit kasayi da kuruyor; depoda kasa/hesap SILME
// akisi YOK. Yani `hasEvmVault` hicbir gercek kullanicida false olamaz ve dugme
// ULASILAMAZ hale gelmisti.
//
// Ulasilamaz bir dugme zararsiz degil: bakimi yapilmaz, test edilemez ve ileride
// biri "demek ki bu durum ele alinmis" diye ona guvenir. Bu blok kaldirildigini
// KAYDEDIYOR ki, kasa silme akisi eklenirse birinin bu karari yeniden vermesi
// gerektigi gorulsun.
describe('ag secici: EVM olusturma yonlendirmesi ulasilamaz oldugu icin kaldirildi', () => {
    const POPUP = read('../components/popups/networksPopup.vue')

    it('yonlendirme ve kalintilari dosyada YOK', () => {
        for (const dead of ['showCreateEvm', 'goToAddWallet', 'create_evm_title', 'create_evm_desc']) {
            expect(POPUP, dead).not.toContain(dead)
        }
    })

    it('olu i18n anahtarlari iki dilden de silindi', () => {
        for (const loc of ['tr', 'en']) {
            const dict = JSON.parse(read(`../i18n/locales/${loc}.json`)).popups.networksPopup
            expect(dict.create_evm_title, loc).toBeUndefined()
            expect(dict.create_evm_desc, loc).toBeUndefined()
        }
    })

    // Kaldirmanin DAYANDIGI olcum. Bu iddia kirilirsa - biri ucuncu bir TON kurulum
    // yolu eklerse - dugmenin ulasilamazligi da kirilmis demektir.
    it('TON kuran her yol AYNI hibrit yardimciyi kullanir', () => {
        for (const rel of ['../components/onboarding/ImportPhrases.vue',
                           '../components/onboarding/CreatePassword2.vue']) {
            const src = read(rel)
            expect(src, rel).toContain('buildHybridTonAccount(')
            expect(src, rel).not.toContain('createTonVault(')
        }
    })
})
