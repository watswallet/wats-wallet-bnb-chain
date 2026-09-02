// ADRES DEFTERINDE "SON GONDERDIKLERIM"
//
// Her basarili gonderimden sonra alici zaten diske yaziliyor (sentRecipients.js)
// ama bu liste bugune kadar YALNIZCA zehirli adres tespiti tarafindan okunuyordu.
// Kullanici en sik gonderdigi adresi her seferinde elle yaziyor - oysa veri
// orada duruyor.
//
// Bu dosya listenin GOSTERIM kararini verir; yazma tarafina hic dokunmaz.

import { dedupeKey } from './addressForm'

export const RECENT_RECIPIENTS_SHOWN = 5

// Karsilastirma anahtari PAYLASILAN dedupeKey'dir (utils/addressForm.js).
//
// Burada bir sure kendi kopyasi vardi: `address.trim().toLowerCase()`. O kopya
// base58'i (Solana VE TON) KUCULTUYORDU -- oysa base58 buyuk/kucuk harfe
// DUYARLIDIR ve kucultuldugunde YALNIZCA kasada ayrisan IKI FARKLI cuzdan ayni
// anahtara duser. Sonucu iki yonlu bir hataydi: tekillemede alicilardan biri
// SESSIZCE KAYBOLUR, eleme kapisi ise ilgisiz bir adresi "kendi hesabim/kayitli"
// sanip listeden atardi.
//
// AYNI verinin YAZICISI olan sentRecipients.js tam bu gerileme sinifini
// yorumuyla belgeleyip dedupeKey'e gecmisti; okuyucunun ikinci, bicimden
// habersiz bir kopya tutmasi iki tarafin sessizce ayrismasi demekti.
// dedupeKey ayrica bicimi de anahtara katar (EVM kucultulur, base58 birebir
// korunur) ve cozulemeyen adresler icin null doner -- yazici da tam olarak bu
// kayitlari zaten HIC yazmaz.
const key = (address) => dedupeKey(address)

// Bir eleme kaydinin TUM adres kimlikleri.
//
// Hesap kayitlari zincir basina AYRI alanlarda kimlik tasir: EVM `.address`,
// Solana `.solanaAddress`, TON `.tonAddress` / `.tonAddressTestnet` -- ve
// cagiran taraf aktif ag icin sectigi kimligi `.pickAddress` olarak isaretler
// (bkz. AddressBook.vue). YALNIZCA `.address` okumak eleme kapisini EVM DISINDA
// ETKISIZ birakiyordu: `known` kumesi yalniz 0x dizgeleri icerir, hicbir base58
// alici ile eslesmez ve kullanicinin KENDI Solana/TON adresi -- gonderen AKTIF
// hesap DAHIL -- "son gonderdiklerim" bolumunde alici olarak onerilirdi.
//
// Alan listesi ACIKTIR (kaydin butun dizge alanlarini taramak yerine): bir gun
// hesap kaydina adres OLMAYAN bir dizge alani eklenirse, o deger yanlislikla
// bir aliciyi elemeye baslamasin.
const IDENTITY_FIELDS = ['address', 'pickAddress', 'solanaAddress', 'tonAddress', 'tonAddressTestnet']

const identitiesOf = (entry) => {
    if (typeof entry === 'string') return [entry]
    if (!entry || typeof entry !== 'object') return []
    return IDENTITY_FIELDS.map(field => entry[field])
}

// Gosterilecek alicilar.
//
// Kayitli adresler ve kullanicinin KENDI hesaplari elenir: ikisi de adres
// defterinde zaten kendi bolumunde duruyor ve ayni adresi uc kez listelemek
// dogru olani secmeyi zorlastirir - zehirli adres saldirisinin tam da
// bekledigi kalabalik.
export function pickRecentRecipients(sent, {
    savedAddresses = [],
    myAccounts = [],
    limit = RECENT_RECIPIENTS_SHOWN,
} = {}) {
    if (!Array.isArray(sent)) return []

    const known = new Set()
    for (const entry of [...savedAddresses, ...myAccounts]) {
        for (const identity of identitiesOf(entry)) {
            const k = key(identity)
            if (k) known.add(k)
        }
    }

    const seen = new Set()
    const out = []

    for (const entry of sent) {
        const k = key(entry?.address)
        // Adresi olmayan ya da bozulmus kayitlar atlanir. Depoda bir kez bozulan
        // bir girdi ekranda bos bir satir olarak gorunmesin.
        if (!k || known.has(k) || seen.has(k)) continue

        seen.add(k)
        out.push({
            address: entry.address,
            label: entry.label ?? null,
            lastSentAt: Number(entry.lastSentAt) || 0,
            count: Number(entry.count) || 0,
        })
    }

    // Depo sirasi bir YAZMA artifaktidir; siralama burada acikca yapilir.
    // En son gonderilen basta; esitlikte cok gonderilen once.
    out.sort((a, b) => (b.lastSentAt - a.lastSentAt) || (b.count - a.count))

    return limit >= 0 ? out.slice(0, limit) : out
}
