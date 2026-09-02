import { describe, it, expect } from 'vitest'
import {
    grantedSolanaSession,
    putSolanaSession,
    removeSolanaSession,
    orphanSolanaOrigins,
} from './solanaConnectAuthz'

const ADDR = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'
const ORIGIN = 'https://app.example.com'
const SESSION = {
    address: ADDR,
    publicKey: '8a1f00ff',
    accountKey: 'acc-1',
    cluster: 'solana:mainnet',
    appMeta: { name: 'Ornek Dapp', icon: null },
    connectedAt: 1756700000,
}
const STORE = { [ORIGIN]: SESSION }

describe('grantedSolanaSession', () => {
    it('kayitli origin ve adres istenmemisse oturum doner', () => {
        expect(grantedSolanaSession(STORE, ORIGIN, undefined)).toEqual(SESSION)
    })

    it('istenen adres oturumunkiyle ayniysa doner', () => {
        expect(grantedSolanaSession(STORE, ORIGIN, ADDR)).toEqual(SESSION)
    })

    // Baglantidan sonra dapp BASKA bir adres icin imza isteyebilir. O adres bu
    // origin'e hic verilmedi: vermek, kullanicinin dapp'e gostermedigi bir
    // hesabindan islem hazirlatmak olurdu.
    it('YABANCI adres istenirse null', () => {
        const baska = '4Nd1mQwWY3v8CPKzSNbYZK4NGxHT6WKGqTLW1CtFYbQr'
        expect(grantedSolanaSession(STORE, ORIGIN, baska)).toBe(null)
    })

    // K8: base58'de buyuk/kucuk harf ANLAMLIDIR. Repodaki her EVM aliskanligi
    // adresi toLowerCase() yapiyor; burada tek bir norm() cagrisi FARKLI iki
    // Solana hesabini ayni sayardi -- yani baska bir hesap uzerinde yetki verirdi.
    it('adres karsilastirmasi TAM eslesmedir -- harf duyarli', () => {
        expect(grantedSolanaSession(STORE, ORIGIN, ADDR.toLowerCase())).toBe(null)
        expect(grantedSolanaSession(STORE, ORIGIN, ADDR.toUpperCase())).toBe(null)
        expect(grantedSolanaSession(STORE, ORIGIN, ` ${ADDR} `)).toBe(null)
    })

    it('kayitsiz origin null', () => {
        expect(grantedSolanaSession(STORE, 'https://evil.com', undefined)).toBe(null)
    })

    // Istegi undefined/null ile almak "adres belirtilmedi" demek; o durumda oturumun
    // kendi adresi kullanilir. Ancak dapp, account.address (istek icindeki ham veri)
    // gonderebilir: bos adres ('') icin yetki vermek fail-open demek -- karmasik bir
    // derin karsilastirmasi olmadan oturum geri doner. Bunu acikca reddetmeliyiz.
    it('adres bos string ile istenmisse null -- undefined/null den FARKLI', () => {
        expect(grantedSolanaSession(STORE, ORIGIN, '')).toBe(null)
        expect(grantedSolanaSession(STORE, ORIGIN, undefined)).toEqual(SESSION)
        expect(grantedSolanaSession(STORE, ORIGIN, null)).toEqual(SESSION)
    })

    it('bos/bozuk depoda null', () => {
        expect(grantedSolanaSession(undefined, ORIGIN)).toBe(null)
        expect(grantedSolanaSession({}, ORIGIN)).toBe(null)
        expect(grantedSolanaSession({ [ORIGIN]: null }, ORIGIN)).toBe(null)
        expect(grantedSolanaSession({ [ORIGIN]: { address: '' } }, ORIGIN)).toBe(null)
    })

    // K5: anahtar TAM ORIGIN'dir. hostname yetseydi http://app.example.com ve o
    // host'un HER portu ayni yetkiyi paylasirdi -- yani ag uzerinde araya giren
    // bir http sayfasi https oturumunun imza yetkisini devralirdi.
    it('TAM ORIGIN anahtarlar: sema ve port FARKLI anahtarlardir', () => {
        expect(grantedSolanaSession(STORE, 'http://app.example.com')).toBe(null)
        expect(grantedSolanaSession(STORE, 'https://app.example.com:8443')).toBe(null)
        expect(grantedSolanaSession(STORE, 'app.example.com')).toBe(null)
        expect(grantedSolanaSession(STORE, 'https://evil.app.example.com')).toBe(null)
    })
})

describe('putSolanaSession / removeSolanaSession', () => {
    it('put YENI nesne dondurur, girdiyi DEGISTIRMEZ', () => {
        const store = {}
        const sonuc = putSolanaSession(store, ORIGIN, SESSION)
        expect(sonuc[ORIGIN]).toEqual(SESSION)
        expect(store).toEqual({})
    })

    it('put bos/gecersiz depoda calisir', () => {
        expect(putSolanaSession(undefined, ORIGIN, SESSION)).toEqual(STORE)
        expect(putSolanaSession(null, ORIGIN, SESSION)).toEqual(STORE)
    })

    it('remove yalniz hedefi siler, girdiyi DEGISTIRMEZ', () => {
        const digeri = 'https://baska.example.org'
        const store = { [ORIGIN]: SESSION, [digeri]: SESSION }
        const sonuc = removeSolanaSession(store, ORIGIN)
        expect(sonuc[ORIGIN]).toBeUndefined()
        expect(sonuc[digeri]).toEqual(SESSION)
        expect(store[ORIGIN]).toEqual(SESSION)
    })

    it('remove ayni host un BASKA semasina dokunmaz', () => {
        const store = { [ORIGIN]: SESSION, 'http://app.example.com': SESSION }
        const sonuc = removeSolanaSession(store, 'http://app.example.com')
        expect(sonuc[ORIGIN]).toEqual(SESSION)
        expect(sonuc['http://app.example.com']).toBeUndefined()
    })

    it('remove bilinmeyen origin icin patlamaz', () => {
        expect(removeSolanaSession({}, 'https://yok.example.com')).toEqual({})
        expect(removeSolanaSession(undefined, ORIGIN)).toEqual({})
    })
})

describe('orphanSolanaOrigins', () => {
    // Oturum accountKey'e SABITLENIR (K10). Bagli hesap silinirse oturumu tutmanin
    // anlami kalmaz -- imzalayacak anahtar yok.
    it('hesabi artik var olmayan oturumlarin TAM ORIGIN lerini listeler', () => {
        const store = {
            [ORIGIN]: SESSION,
            'https://silik.example.org': { ...SESSION, accountKey: 'silindi' },
        }
        expect(orphanSolanaOrigins(store, ['acc-1'])).toEqual(['https://silik.example.org'])
    })

    it('hepsi gecerliyse bos dizi', () => {
        expect(orphanSolanaOrigins(STORE, ['acc-1', 'acc-2'])).toEqual([])
    })

    // FAIL-CLOSED DEGIL: hesap listesi okunamadiysa hicbir oturumu silmeyiz. Bos
    // liste "hicbir hesap yok" degil "bilmiyorum" demek olabilir ve kullanicinin
    // butun dapp baglantilarini silmek geri alinamaz.
    it('hesap listesi bos/gecersizse HICBIR oturum yetim sayilmaz', () => {
        expect(orphanSolanaOrigins(STORE, [])).toEqual([])
        expect(orphanSolanaOrigins(STORE, null)).toEqual([])
        expect(orphanSolanaOrigins(STORE, undefined)).toEqual([])
        expect(orphanSolanaOrigins(STORE, 'acc-1')).toEqual([])
    })

    it('accountKey tasimayan bozuk kayit yetim SAYILMAZ', () => {
        const store = {
            'https://bozuk.example.org': { ...SESSION, accountKey: undefined },
            'https://bos.example.org': null,
        }
        expect(orphanSolanaOrigins(store, ['acc-1'])).toEqual([])
    })

    it('bos/gecersiz depo bos dizi', () => {
        expect(orphanSolanaOrigins(undefined, ['acc-1'])).toEqual([])
        expect(orphanSolanaOrigins({}, ['acc-1'])).toEqual([])
    })
})
