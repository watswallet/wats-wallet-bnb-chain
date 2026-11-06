import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { createAvatar } from '@dicebear/core'
import { identicon, initials } from '@dicebear/collection'
import { identiconUri, initialsUri, setNeutralAvatars, neutralAvatars } from './localAvatar'
import { oklchHex, morMu } from '../test-utils/morRenk'

describe('localAvatar', () => {
    it('ag istegi YAPMADAN data URI uretir', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        const uri = identiconUri('0x8ba1f109551bD432803012645Ac136ddd64DBA72')
        expect(uri.startsWith('data:image/svg+xml')).toBe(true)
        expect(fetchSpy).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
    })

    it('kutuphane ile ayni ciktiyi verir', () => {
        expect(identiconUri('seed-1')).toBe(createAvatar(identicon, { seed: 'seed-1' }).toDataUri())
        expect(initialsUri('USDT')).toBe(createAvatar(initials, { seed: 'USDT' }).toDataUri())
    })

    // ALTIN DEGERLER (D-M2): identicon adres tanima yardimcisidir (AddressBook), bir
    // bagimlilik yukseltmesi ciktiyi sessizce degistirirse her kullanicinin hesap
    // ikonu degisir. Degerler tam data URI'nin sha256'sidir; 7.2.0 ve 9.4.3 icin
    // AYNIDIR. Bu test kirilirsa surum yukseltmesi KASITLI olmali: ikon degisimini
    // kabul edip hash'leri guncelle. initials ciktisi altina ALINMAZ (surumler
    // arasinda arka plan rengi degisir).
    const sha = (s) => createHash('sha256').update(s).digest('hex')
    const GOLDEN = [
        ['0x8ba1f109551bD432803012645Ac136ddd64DBA72', 'ab3eac92559f020034f0e94f1d7f4d841309d8305372454d4e3802da7615546a', 1802],
        ['seed-1', 'bf77f2c6be848f4544591ad007c02f466b35e4569ab8d88c7543e482b9fb6279', 1766],
        ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'd99f34e5b6fea668d643fa6a1897a033f40e6648017e8bef510c117bc4d9ec11', 1800],
    ]
    for (const [seed, hash, len] of GOLDEN) {
        it('identicon altin deger: ' + seed, () => {
            const uri = identiconUri(seed)
            expect(uri.length).toBe(len)
            expect(sha(uri)).toBe(hash)
        })
    }

    it('bos tohum patlamaz', () => {
        expect(identiconUri(undefined).startsWith('data:')).toBe(true)
        expect(initialsUri(null).startsWith('data:')).toBe(true)
    })
})

// GIZLI MOD: NOTR AVATARLAR (grafit karari, kullanici 2026-10-26: gizli modda hicbir sey mor gorunmez). Avatar bir
// data URI <img>'dir, CSS onu boyayamaz; anahtar bu modulde, privacyUiSync cevirir. "Mor"un tanimi tek yerde:
// test-utils/morRenk.js (privacyWiring.test.js ile ayni olcu).
describe('localAvatar -- gizli mod notr avatarlar', () => {
    afterEach(() => setNeutralAvatars(false))

    // Data URI'yi cozup icindeki #rrggbb renklerini toplar (identicon satir dolgulari, initials zemini ve yazisi).
    const renkler = (uri) => [...decodeURIComponent(uri.slice(uri.indexOf(',') + 1)).matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase())
    const morlar = (uri) => renkler(uri).filter((h) => morMu(oklchHex(h)))

    // Varsayilan paletle MOR cizilen tohumlar: identicon #5e35b1, initials zemini #3949ab (on kosul KONTROL'de).
    const MOR_ADRES = '0x0006C0ffEec0FfeEc0FFEeC0FfeeC0fFeEc0FfEE'
    const MOR_INITIALS = 'BNB'

    it('anahtar varsayilan KAPALI; yalniz tam true acar', () => {
        expect(neutralAvatars()).toBe(false)
        for (const v of ['true', 1, {}, null]) {
            setNeutralAvatars(v)
            expect(neutralAvatars()).toBe(false)
        }
        setNeutralAvatars(true)
        expect(neutralAvatars()).toBe(true)
        setNeutralAvatars(false)
        expect(neutralAvatars()).toBe(false)
    })

    it('KONTROL: anahtar kapaliyken bu tohumlar varsayilan paletle MOR cizilir', () => {
        expect(morlar(identiconUri(MOR_ADRES)).length).toBeGreaterThan(0)
        expect(morlar(initialsUri(MOR_INITIALS)).length).toBeGreaterThan(0)
    })

    it('anahtar acikken identicon mor icermez: tum satirlar tek notr gri (zinc-500)', () => {
        setNeutralAvatars(true)
        const uri = identiconUri(MOR_ADRES)
        expect(morlar(uri)).toEqual([])
        expect([...new Set(renkler(uri))]).toEqual(['#71717a'])
    })

    it('anahtar acikken identicon sekli AYNI kalir, yalniz renk degisir (adres tanima korunur)', () => {
        const sekil = (uri) => decodeURIComponent(uri).replace(/#[0-9a-f]{6}\b/gi, '#')
        const varsayilan = identiconUri(MOR_ADRES)
        setNeutralAvatars(true)
        const notr = identiconUri(MOR_ADRES)
        expect(notr).not.toBe(varsayilan)
        expect(sekil(notr)).toBe(sekil(varsayilan))
    })

    it('anahtar acikken initials zemini notr gri (zinc-600), yazi beyaz, harfler ayni', () => {
        setNeutralAvatars(true)
        const uri = initialsUri(MOR_INITIALS)
        expect(morlar(uri)).toEqual([])
        expect(renkler(uri).sort()).toEqual(['#52525b', '#ffffff'])
        expect(decodeURIComponent(uri)).toContain('>BN</text>')
    })

    it('onbellek modu ayirir; anahtar kapaninca cikti kutuphanenin varsayilaniyla bayt bayt ayni', () => {
        const once = identiconUri(MOR_ADRES)
        const onceInitials = initialsUri(MOR_INITIALS)
        setNeutralAvatars(true)
        expect(identiconUri(MOR_ADRES)).not.toBe(once)
        expect(initialsUri(MOR_INITIALS)).not.toBe(onceInitials)
        setNeutralAvatars(false)
        expect(identiconUri(MOR_ADRES)).toBe(createAvatar(identicon, { seed: MOR_ADRES }).toDataUri())
        expect(initialsUri(MOR_INITIALS)).toBe(createAvatar(initials, { seed: MOR_INITIALS }).toDataUri())
    })
})
