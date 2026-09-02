// Aktif agda GOSTERILECEK adres.
//
// TON aginda 0x adresi gostermek, kullaniciyi TON'u bir EVM adresine gondermeye iter;
// o para KALICI OLARAK KAYBOLUR. Bu yuzden TON'da EVM adresine GERI DUSULMEZ:
// TON adresi henuz turetilmediyse `null` doner ve arayuz "yukleniyor" gosterir.
//
// AYNI KURAL SOLANA'DA DA GECERLI: EVM-DISI her VM icin ayri bir kapi vardir,
// cunku tek bir "EVM mi?" sorusu ikinci VM'i sessizce EVM sayar (bkz. asagidaki
// solana dali).
import { isTon, isSolana } from '../utils/chainKind'

export function pickDisplayAddress({ chain, evmAddress, tonAddress, solanaAddress }) {
    if (isTon(chain)) return tonAddress || null
    // SOLANA, TON ile AYNI SINIF HATA: kapi yalnizca `isTon` sorsaydi Solana bu
    // fonksiyon icin "EVM" olur ve `evmAddress` (0x...) donerdi -- TON'da
    // kapatilan hatanin birebir ikizi. Solana adresi henuz cozulmediyse burasi da
    // `null` doner; arayuz "hazirlaniyor" gosterir, CAPRAZ VM adresine DUSMEZ.
    if (isSolana(chain)) return solanaAddress || null
    return evmAddress || null
}

// Al ekranindaki ag uyarisinin ETIKETI ("... ağlardan varlık gönderin").
//
// Bu etiket, yukaridaki adres kadar kritik: TON adresi gosterilirken etiket hala
// "EVM uyumlu" derse, kullanici bir EVM varligini bu TON adresine gonderir — sonuc
// YANLIS ADRES gostermekle AYNI (varlik KALICI OLARAK KAYBOLUR), sadece yon ters.
// Bu yuzden etiket de pickDisplayAddress ile AYNI isTon kapisindan geciyor.
export function pickNetworkWarningKey(chain) {
    return warningKeyForKind(isTon(chain) ? 'ton' : 'evm')
}

// Ayni etiket, ama AKTIF AGDAN degil SATIR TURUNDEN secilir.
//
// Al ekrani artik iki adresi birden gosteriyor ve QR kullanicinin DOKUNDUGU satiri
// izliyor. Uyari etiketi orada aktif aga baglansaydi, EVM agindayken TON satirina
// dokunan kullanici TON adresinin altinda "EVM uyumlu aglardan gonderin" yazisini
// gorurdu: bu fonksiyonun var olma sebebi olan hatanin ta kendisi. Etiket, QR'da
// hangi adres duruyorsa ONUN turunu soylemek zorunda.
export function warningKeyForKind(kind) {
    return kind === 'ton' ? 'warning_network_bold_ton' : 'warning_network_bold'
}

// Kopyalama bolumunde ALT ALTA gosterilecek adres satirlari.
//
// pickDisplayAddress "aktif agda hangi adres" sorusunu cevaplar; bu ise "kullanicinin
// sahip oldugu TUM adresler" sorusunu. Ikisi ayri kalir cunku tek satirlik yuzeyler
// (Al ekranindaki QR) hala TEK bir adres ister.
//
// Iki kural pazarlik disi:
//
// 1) TON satiri EVM adresine ASLA dusmez, EVM satiri da TON adresine. Iki adres yan
//    yana dururken bir satirin yanlis adresi tasimasi, tek adres gosteren ekrandan
//    DAHA tehlikelidir: kullanici etikete guvenip o zincirden gonderir ve varlik
//    KALICI OLARAK KAYBOLUR. Adres yoksa `address: null` doner, arayuz "hazirlaniyor"
//    gosterir ve kopyalama kapalidir.
//
// 2) Sira SABITTIR (once EVM, sonra TON). Aktif aga gore siralamak listeyi ag her
//    degistiginde ziplatir; kullanici iki satirlik bir listede kas hafizasiyla
//    hareket eder ve yanlis satiri kopyalamak burada para kaybettirir. Aktif ag
//    yalnizca `active` bayragiyla VURGULANIR, yeri degismez.
// 3) "HENUZ YOK" ile "HIC OLMAYACAK" ayri girdilerdir.
//
//    `evmAddress: null` uzun sure IKI anlami birden tasidi: "adres turetiliyor" ve
//    "bu hesabin EVM adresi hic olmayacak". Iki cagiran da TON'a kilitli hesap icin
//    `null` geciyordu ve arayuz "asla"yi "birazdan" diye gosterdi - TON ifadesiyle
//    ice aktarilan hesapta EVM satiri SONSUZA KADAR "Hazirlaniyor…" yaziyordu.
//
//    Bu, adresi gizlemekten farkli bir hata sinifi: kullaniciya var olmayan bir seyi
//    BEKLETIYOR. Bekleyen kullanici cuzdanin bozuk oldugunu dusunur, oysa hesap tam
//    olarak tasarlandigi gibi calisiyor (spec §5: TON'a kilitli hesabin EVM anahtari
//    HIC URETILMEZ).
//
//    Bayrak VARSAYILAN OLARAK acik: bilgi verilmemisse satir durur, yani bugunku
//    davranis. Yon bilincli - bir cagiran bayragi gecmeyi unutursa sonuc "gereksiz
//    satir" olur, "eksik adres" degil.
export function buildAddressRows({ chain, evmAddress, tonAddress, evmSupported = true }) {
    const ton = isTon(chain)
    const rows = []
    // Satir, adres DOLU olsa bile uretilmez: tutarsiz bir cagri (`evmSupported: false`
    // ile birlikte gelen bir EVM adresi) TON'a kilitli hesapta EVM etiketli bir adres
    // basmak demektir - (1) nolu kuralin ihlali.
    if (evmSupported) rows.push({ kind: 'evm', address: evmAddress || null, active: !ton })
    rows.push({ kind: 'ton', address: tonAddress || null, active: ton })
    return rows
}
