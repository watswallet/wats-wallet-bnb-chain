// Zehirli adres (address poisoning) tespiti.
//
// Saldiri: kurbanin gecmisine, gercek bir alicinin BASI ve SONU ayni olan sahte bir
// adresten 0 degerli / toz bir transfer dusulur. Kullanici bir dahaki gonderimde
// adresi gecmisten kopyalar, kisa gosterim (0xAbCd...CdEf) ayni gorundugu icin farki
// FARK ETMEZ ve parayi saldirgana yollar.
//
// Bu yuzden esik tam olarak kullanicinin GORDUGU kadardir: shortenAddress ilk 6 + son 4
// karakteri gosterir, biz de onu karsilastiririz. Daha genis bir esik (ornegin 6+6)
// gercek saldirilarin cogunu kacirir, cunku saldirgan yalnizca gorunen kadarini uydurur.
//
// UC ADRES BICIMI DE KAPSANIR. Bu dosya iki dalda BIRBIRINDEN HABERSIZ genisletildi
// (Solana dali ve TON dali); asagisi ikisinin BIRLESIMIDIR:
//   EVM    -- harf kutusu ANLAMSIZ (checksum yalnizca gorsel), kucuk harfe indirilir.
//   Solana -- base58; harf kutusu ANLAMLIDIR. Zehirleme saldirisi burada EVM'den
//             YAYGIN: vanity uretecle bas ve son karakterleri birebir eslemek ucuz.
//   TON    -- base64url; harf kutusu ANLAMLIDIR. Eskiden burada yalnizca EVM kalibi
//             vardi ve TON adresleri kapidan SESSIZCE geciyordu. Bu jetton
//             gonderimiyle gelen bir gerileme DEGILDI - native TON gonderimi de
//             P1'den beri korumasizdi. Saldiri TON'da aynen mumkun ve gonderim
//             GERI ALINAMAZ.
//
// EVM/base58 karari addressForm.js'teki PAYLASILAN tek kopyaya sorulur (ayni kurala
// historyRecipients.js ve knownRecipients.js de uyar). TON bicimini addressForm.js
// TANIMAZ; o dal burada, @ton/core'un Address ayristiricisiyla ele alinir.
//
// Dosya SAFTIR: chrome API'sine, agsa, depoya dokunmaz. @ton/core'un Address'i saf bir
// ayristiricidir (ag yok), bu yuzden bu kurali bozmaz.

import { Address } from '@ton/core'
import { canonicalAddress } from './addressForm'
import { shortenAddress } from './shortenAddress'

// EVM'in varsayilan "anlamli" bas uzunlugu: '0x' (headOffset=2) DISINDA 4 hex
// karakter. Asagidaki SHOWN_HEAD_TOTAL ile TUTARLI (2+4=6) — bkz. resolvePrefix.
export const DEFAULT_PREFIX = 4
export const DEFAULT_SUFFIX = 4

// shortenAddress.js'in gosterdigi TOPLAM bas karakter sayisi. Esik BUNDAN
// BAGIMSIZ SURUKLENEMEZ (addressPoisoning.test.js'te dogrudan shortenAddress'e
// karsi dogrulanir): EVM'de bunun 2'si '0x' (anlamsiz), 4'u anlamli hex'tir
// (2+DEFAULT_PREFIX=6). Base58'de (Solana) anlamsiz bir on ek YOKTUR, bu yuzden
// varsayilan "anlamli" uzunluk TOPLAMIN TAMAMIDIR (6) — sabit DEFAULT_PREFIX(4)
// kullanilsaydi esik gorunenden (6) DUSUK kalirdi. Bu yalniz fazladan uyari
// riski degil: valf 2 (buildTrustedList, asagida) AYNI predikati iki gecmis
// adayini birbirine karsi ELEMEK icin kullanir — dusuk esik saldirganin bu
// valfi tetiklemesini GORSEL bir ikiz uretmekten kat kat (58^(6-4) yaklasik 3364 kat)
// UCUZLASTIRIR. TON'da onek ('EQ'/'UQ'/'0Q') GORUNUR ve 2 karakterdir, yani orada
// EVM ile ayni hesap gecerlidir (2+4=6).
//
// BU IFADENIN ARIZA MODU SESSIZ-DEVRE-DISI BIRAKMADIR (2. tur incelemesi,
// bilerek TASINIYOR): esik `shortenAddress`'in CIKTISINI '...' ayracindan
// bolerek geri kazaniliyor. Ayrac degisirse, ya da `start + end` 50'ye
// ULASIRSA (o zaman shortenAddress girdiyi KISALTMADAN oldugu gibi doner),
// bu ifade PATLAMAZ — sessizce 50 verir. 50 ile `isLookalike` adreslerin
// TAMAMINI karsilastirir, yani "benzer" hicbir zaman dogru olmaz: tespit
// HATA VERMEDEN, FAIL-OPEN kapanir — guvenlik kodunda en kotu ariza sekli.
// Bu yuzden iki KILIT test var (addressPoisoning.test.js: "EVM icin toplam
// karsilastirilan bas/son uzunluk shortenAddress ile TAM ORTUSUR" ve
// "splitAddress base58 icin varsayilan bas uzunlugu shortenAddress ile TAM
// ORTUSUR"): shortenAddress'in varsayilanlari kayarsa ikisi de KIRMIZI duser.
// Mutasyonla dogrulandi (start 6 -> 8: 16 test kirmizi). Testleri silen ya da
// zayiflatan biri bu koruyu da kaldirmis olur.
const SHOWN_HEAD_TOTAL = shortenAddress('x'.repeat(50)).split('...')[0].length

// `prefix` acikca verildiyse (ozel esik testleri gibi) OLDUGU GIBI kullanilir
// (headOffset UZERINE eklenir, form farketmeksizin ayni davranis). Verilmediyse
// varsayilan formun on ek uzunluguna (headOffset) gore TURETILIR ki TOPLAM
// (headOffset + prefix) HER ZAMAN SHOWN_HEAD_TOTAL'e esitlensin.
function resolvePrefix(prefix, headOffset) {
    return prefix !== undefined ? prefix : (SHOWN_HEAD_TOTAL - headOffset)
}

// Adresi BICIMI + KIMLIGI + GORUNEN DIZESI olarak cozer; gecersizse null.
//
// Dorduncu alan headOffset ile birlikte dordu de AYRI birer sorunun cevabidir:
//   form       -> iki FARKLI zincirin adresi BIRBIRIYLE KARSILASTIRILMAZ (bkz. isLookalike).
//   key        -> "bu ikisi AYNI hesap mi" sorusunun cevabi. EVM'de kucuk harfli adres;
//                 base58'de dizenin KENDISI (kucultmek YASAK); TON'da HAM bicim
//                 ('0:abc...'), cunku TON'da AYNI hesabin bounceable (EQ...) ve
//                 non-bounceable (UQ...) yazimlari BAMBASKA dizelerdir — dize
//                 karsilastirmasi yapilsaydi kullanicinin KENDI bilinen alicisi
//                 "zehirli adres" diye isaretlenirdi. Yanlis pozitif ureten bir uyari,
//                 kullaniciyi GERCEK uyarilara da korlestirir.
//   display    -> kullanicinin EKRANDA GORDUGU dize. Saldiri tam olarak buna dayanir,
//                 o yuzden pencere karsilastirmasi kimlik uzerinde degil GORUNEN dize
//                 uzerinde yapilir (TON'da kimlik ham bicimdir, kullanici onu gormez).
//   headOffset -> gosterimde ANLAM TASIMAYAN on ekin uzunlugu: EVM'de '0x', TON'da
//                 'EQ'/'UQ'/'0Q' icin 2; base58'de on ek olmadigi icin 0.
//
// SIRALAMA ONEMLI: once PAYLASILAN addressForm.js (EVM + base58), sonra TON. Ters
// sirada calisilamaz — addressForm.js'in "'0x' oneki DUSMUS 40 karakterlik hex'i
// Solana SANMA" korumasi (bkz. o dosya) atlanmis olurdu. Ters yonde bir cakisma
// YOKTUR: TON friendly bicimi HER ZAMAN 48 karakterdir, base58 kalibi ise 32-44
// kabul eder; TON ham bicimi ':' tasir ve base58 alfabesinde ':' yoktur.
function canonical(address) {
    const shared = canonicalAddress(address)
    // EVM'de key zaten kucuk harflidir (kutu anlamsiz), base58'de dizenin
    // KENDISIDIR (kutu anlamli) — iki bicimde de kullanicinin gordugu dizeyle ayni
    // karakterler karsilastirilir, bu yuzden display = key.
    if (shared) return { ...shared, display: shared.key }

    if (!address || typeof address !== 'string') return null
    const text = address.trim()
    if (!text) return null

    // Address.parse hem friendly (EQ/UQ/0Q...) hem ham (0:abc...) bicimi kabul eder ve
    // gecersizde FIRLATIR. Firlatma yutulur: bu fonksiyonun sozlesmesi "gecersizse null",
    // istisna degil.
    try {
        return { form: 'ton', key: Address.parse(text).toRawString(), display: text, headOffset: 2 }
    } catch {
        return null
    }
}

// Test/dis kullanim icin: canonical()'in urettigi anahtari doner (gecersizse null).
// Iki adresin GERCEKTEN ayni sayilip sayilmadigini dogrulamak icindir — ozellikle
// base58'in kucultulmedigini kanitlamak icin.
export function normalizeForCompare(address) {
    return canonical(address)?.key ?? null
}

// Cagiran taraflar "bu adres bu modulun kapsaminda mi" kararini kendileri verebilsin
// diye disa acik. Alt modullerin kendi ic korumasina guvenmek, korumayi gorunmez kilar.
export function isSupportedAddress(address) {
    return canonical(address) !== null
}

// Geriye donuk uyum: YALNIZCA EVM soran cagri noktalari icin (itibar sorgusu gibi
// EVM'e ozgu servisler). TON ve Solana icin false doner.
export function isEvmAddress(address) {
    return canonical(address)?.form === 'evm'
}

export function isLookalike(a, b, { prefix, suffix = DEFAULT_SUFFIX } = {}) {
    const left = canonical(a)
    const right = canonical(b)
    if (!left || !right) return false

    // Farkli bicimlerin adresleri hicbir kosulda benzer degildir.
    //
    // BU KAPI ARTIK YUK TASIYOR. TON tarafinda bir donem kaldirilmisti ve o gun
    // dogruydu: yalnizca iki bicim (EVM + TON) varken ULASILAMAZDI, cunku gorunur
    // pencere ayirt edici oneki her zaman kapsiyor ('0x' ile 'UQ'/'EQ'/'0:' ilk iki
    // karakterde ayrisir). UCUNCU bicim (base58/Solana) o argumani BOZAR: base58'de
    // on ek YOKTUR (headOffset=0) ve base58 alfabesi 'E', 'Q', 'U' harflerini ICERIR
    // — 'UQ...' ile baslayan gecerli bir Solana adresi bir TON adresiyle TESADUFEN
    // ayni gorunur pencereyi paylasabilir. Kapi olmasaydi bu, kullanicinin kendi
    // adresini "zehirli" ilan eden bir YANLIS POZITIF uretirdi.
    if (left.form !== right.form) return false

    // AYNI adres benzer degildir: o zaten bilinen alicidir, uyari degil onay hak eder.
    // Karsilastirma KIMLIK uzerinden — TON'da ayni hesabin EQ/UQ/ham bicimleri farkli
    // dizelerdir ama AYNI adrestir.
    if (left.key === right.key) return false

    // Pencere GORUNEN dize uzerinde: saldiri kullanicinin ekranda gorduguna dayanir.
    // Formlar esit oldugu icin (yukaridaki kapi) iki tarafin headOffset'i de esittir.
    const head = left.headOffset + resolvePrefix(prefix, left.headOffset)
    return left.display.slice(0, head) === right.display.slice(0, head)
        && left.display.slice(-suffix) === right.display.slice(-suffix)
}

// Uyari kartinda farkli olan ORTAYI vurgulayabilmek icin adresi uce boler.
// head EVM'de '0x'i, TON'da 'EQ'/'UQ' onekini tasir; base58'de on ek yoktur.
// head+mid+tail birlestiginde adresin aynisi cikar.
export function splitAddress(address, { prefix, suffix = DEFAULT_SUFFIX } = {}) {
    const c = canonical(address)
    if (!c) return null

    // Harf kutusu KORUNUR (kullanici adresini gordugu gibi gormeli) ama bosluk atilir:
    // defterdeki bir kayit bosluk tasiyorsa dilimleme kayar ve kart yanlis adres gosterirdi.
    const clean = address.trim()
    const head = c.headOffset + resolvePrefix(prefix, c.headOffset)
    return {
        head: clean.slice(0, head),
        mid: clean.slice(head, clean.length - suffix),
        tail: clean.slice(-suffix)
    }
}

// Guvenilir adresler: kendi hesaplarin, adres defteri, daha once gonderdiklerin.
// Oncelik hesap > defter > gecmis — knownRecipients.js ile ayni sira, ayni kayit
// checksum case'i korunur (identicon seed'i her ekranda ayni kalsin).
export function buildTrustedList({ accounts, savedAddresses, sentRecipients, historyRecipients } = {}) {
    // 'form:key' ile anahtarlanir. Iki sebep birden:
    //   1. Ayni karakter dizisi iki bicimde gecerli olamaz (EVM hex ile base58
    //      kesisimi bos) ama bicim ayrimi yine de acikca korunur.
    //   2. Tekillestirme DIZEYE degil KIMLIGE gore olur: TON'da ayni hesabin EQ ve UQ
    //      bicimleri farkli dizelerdir ama AYNI kayittir (key = ham bicim). Dizeye
    //      gore tekillestirilseydi liste siser ve "zaten guvenilir mi" kontrolu ayni
    //      adresi iki kez tarardi.
    const seen = new Set()
    const list = []

    // `addressesOf` VARSAYILANI tek bir `.address` alani okur. Hesaplar (vault
    // accounts) FARKLIDIR: background.js ayni hesap icin EVM (`.address`) ve
    // Solana (`.solanaAddress`) kimliklerini AYRI alanlarda tutar (Task 13 kod
    // incelemesi, Kritik 1). Yalnizca `.address` okunsaydi kullanicinin KENDI
    // Solana adresi hicbir zaman kendi guvenilir listesine giremezdi — Solana'da
    // TEK kalan kaynak (gecmis) ise saldirganin ayni gecmise dustugu bir ikizle
    // (valf 2) kolayca alt edilebilir.
    //
    // TON kimligi BURADA OKUNMAZ ve bu BILINCLI: hesabin TON adresi AGA GORE ayri
    // alanlarda durur (`tonAddress` / `tonAddressTestnet`) ve secimi
    // knownRecipients.js'teki `accountsForChain` AKTIF ZINCIRE gore yapip `.address`
    // alanina yazarak buraya verir. Iki TON alani da burada kosulsuz okunsaydi
    // mainnet agindayken testnet adresi de "guvenilir" sayilirdi.
    function collect(entries, source, labelOf, addressesOf = (e) => [e?.address]) {
        const out = []
        if (!Array.isArray(entries)) return out
        for (const entry of entries) {
            for (const address of addressesOf(entry)) {
                const c = canonical(address)
                if (!c) continue
                const dedupeKey = `${c.form}:${c.key}`
                if (seen.has(dedupeKey)) continue
                seen.add(dedupeKey)
                out.push({ address, label: labelOf(entry), source })
            }
        }
        return out
    }

    // Kullanicinin KENDI beyan ettigi kaynaklar: sorgusuz guvenilir.
    list.push(...collect(accounts, 'account', e => e?.name ?? null, e => [e?.address, e?.solanaAddress]))
    // AYNI kod incelemesinin (Kritik 1) UCUNCU maddesi: `savedAddresses` bu
    // fonksiyon acisindan ZATEN form-farkindadir (base58 bir kayit gelse dogru
    // islenir, yukaridaki testler bunu kanitliyor). GUNCELLEME (Task 16b): adres
    // defteri YAZMA tarafi (settings/addresses/AddAddress.vue, EditAddress.vue)
    // ARTIK `ethers.isAddress` ile kapida DURMUYOR -- `validateRecipient`
    // (Task 12) kullaniyor ve base58 bir kaydi harf kasasi korunarak kabul
    // ediyor. Yani bu kaynak Solana'da ARTIK bos DEGIL: kullanici bir Solana
    // adresini adres defterine kaydettiyse, o kayit BURADAN gecer ve guvenilir
    // listeye girer.
    list.push(...collect(savedAddresses, 'saved', e => e?.label ?? null))
    list.push(...collect(sentRecipients, 'sent', e => e?.label ?? null))

    // Gecmis FARKLIDIR: icerigini dusman da yazabilir — zehirleme yemi tam olarak oraya
    // duser. Sorgusuz kabul edilirse koruma TERSINE doner: yem "tanidik" olup sessizce
    // gecer, gercek adres sahte uyari uretir. Iki valf:
    const candidates = collect(historyRecipients, 'history', e => e?.label ?? null)

    const safe = candidates.filter(candidate =>
        // 1) Zaten guvendigim bir adrese benziyorsa: gercek bir muhatap degil, taklididir.
        !list.some(trusted => isLookalike(candidate.address, trusted.address)) &&
        // 2) Iki gecmis adayi birbirine benziyorsa hangisinin yem oldugunu BILEMEYIZ.
        //    Ikisini de dislamak yalnizca uyari uretmemek demek — mevcut duruma doner,
        //    kotulesmez. Birini secmek ise yanlis olani "tanidik" ilan etme riskidir.
        !candidates.some(other => isLookalike(candidate.address, other.address))
    )

    list.push(...safe)

    return list
}

// Aday adres guvenilir listedekilerden birine benziyorsa o kaydi doner.
// TAM eslesme uyari uretmez: kullanici zaten bildigi bir adrese gonderiyordur.
export function findLookalike(candidate, trusted, opts) {
    const target = canonical(candidate)
    if (!target || !Array.isArray(trusted)) return null

    // Karsilastirma KIMLIK uzerinden: ayni hesabin BASKA bir bicimi de (TON'da
    // EQ/UQ/ham) "bilinen alici"dir, zehir degil.
    const exactMatch = trusted.some(entry => {
        const c = canonical(entry?.address)
        return c && c.form === target.form && c.key === target.key
    })
    if (exactMatch) return null

    // DIKKAT: isLookalike'a HAM `candidate` gecilir, `target.key` DEGIL. Kimlik bicimi
    // (TON'da `0:abc...`) kullanicinin gordugu dize DEGILDIR; pencere karsilastirmasi
    // onun uzerinde yapilirsa bambaska karakterler karsilastirilir ve kapi sessizce
    // hicbir seyi yakalamaz hale gelir.
    return trusted.find(entry => isLookalike(candidate, entry?.address, opts)) ?? null
}
