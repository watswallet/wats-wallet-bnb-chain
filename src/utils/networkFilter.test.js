import { describe, it, expect } from 'vitest'
import { nextNetworkFilter, effectiveScope, ALL_NETWORKS } from './networkFilter'

describe('nextNetworkFilter', () => {
    it('ag degisince filtre YENI zincire atlar', () => {
        expect(nextNetworkFilter(ALL_NETWORKS, 1, 42161)).toBe(42161)
    })

    it('kullanici baska bir zincire filtrelemis olsa da atlar', () => {
        expect(nextNetworkFilter(137, 1, 8453)).toBe(8453)
    })

    // Store olusturulurken initializeCurrentNetwork asenkron calisiyor:
    // currentNetwork null'dan zincire geciyor. Bu bir AG DEGISIMI degil; acilista
    // "tum aglar" korunmazsa portfoy toplami hic gorulemez.
    it('ilk yukleme (null -> zincir) varsayilani EZMEZ', () => {
        expect(nextNetworkFilter(ALL_NETWORKS, undefined, 1)).toBe(ALL_NETWORKS)
        expect(nextNetworkFilter(ALL_NETWORKS, null, 42161)).toBe(ALL_NETWORKS)
    })

    it('ayni zincire "gecis" filtreyi degistirmez', () => {
        expect(nextNetworkFilter(ALL_NETWORKS, 1, 1)).toBe(ALL_NETWORKS)
        expect(nextNetworkFilter(137, 137, 137)).toBe(137)
    })

    it('metin/sayi farki ayni zincir sayilir', () => {
        expect(nextNetworkFilter(ALL_NETWORKS, '42161', 42161)).toBe(ALL_NETWORKS)
    })

    it('zincir cozulemezse filtreye dokunulmaz', () => {
        expect(nextNetworkFilter(137, 1, undefined)).toBe(137)
        expect(nextNetworkFilter(137, 1, null)).toBe(137)
    })

    // Eskiden burada filtre SAYIYA zorlanirdi (metin bir chainId hicbir token'la
    // eslesmezdi). Artik karsilastirmalar isSameChainId uzerinden yapiliyor (bkz.
    // Home.vue), bu yuzden kimlik KENDI TIPINDE donebilir: metin/sayi farki olan
    // ayni zincir yine "degisim yok" sayilir (asagidaki test), gercekten farkli
    // bir zincire gecildiginde ise deger DONUSTURULMEDEN aktarilir.
    it('gercekten farkli zincire gecince deger DONUSTURULMEDEN doner', () => {
        const out = nextNetworkFilter(ALL_NETWORKS, 1, '42161')
        expect(out).toBe('42161')
        expect(typeof out).toBe('string')
    })

    // Eskiden sayiya cevrilemeyen bir sonraki kimlik filtreyi hic degistirmezdi.
    // Bu korumanin GERCEK amaci EVM'de asla olusmayan bozuk bir deger degildi;
    // Solana'nin METIN kimligini de (yanlislikla) elerdi. isSameChainId tabanli
    // karsilastirmaya gecince bu ozel-durum kaldirildi: kimlik ne olursa olsun
    // (EVM'de currentNetwork.chainId HER ZAMAN gercek bir Number'dir) oldugu
    // gibi tasinir.
    it('metin kimlik oldugu gibi tasinir (Solananin gercek sekli budur)', () => {
        expect(nextNetworkFilter(ALL_NETWORKS, 1, 'abc')).toBe('abc')
    })

    it('kullanici elle "tum aglar"a donebilir (fonksiyon buna karismaz)', () => {
        // Elle secim dogrudan atanir; bir sonraki AG DEGISIMINE kadar korunur.
        expect(nextNetworkFilter(ALL_NETWORKS, 42161, 42161)).toBe(ALL_NETWORKS)
    })
})

// Bildirilen hata B: Polygon aktifken Takas'in "Token Sec" secicisi POLYGON degil
// "TUM AGLAR" kapsaminda aciliyordu. Sebep: acilistaki 'all' bir CEVAP DEGIL,
// sorulmamis bir sorudur (nextNetworkFilter ilk yuklemede kasten dokunmuyor).
// Tek zincirli ekranlar (swapFrom) bunu TURETILMIS kapsamla cozer; store'a YAZMAZ.
describe('effectiveScope', () => {
    // T17
    it('kullanici pill e hic dokunmadiysa tek zincirli ekran AKTIF zinciri varsayar', () => {
        expect(effectiveScope(ALL_NETWORKS, false, 137)).toBe(137)
    })

    // T18 — acik cevap HER ekranda gecerlidir (paylasilan kapsamin tum gerekcesi).
    it('kullanici acikca "tum aglar" dediyse o secim KAZANIR', () => {
        expect(effectiveScope(ALL_NETWORKS, true, 137)).toBe(ALL_NETWORKS)
    })

    // T19
    it('tek zincir secilmisse dokunulmaz (chosen fark etmez)', () => {
        expect(effectiveScope(1, false, 137)).toBe(1)
        expect(effectiveScope(1, true, 137)).toBe(1)
    })

    // T20 — currentNetwork henuz null: uydurma bir zincire dusmek yanlis liste demek.
    // (Yalniz null/undefined: bunlar currentNetwork'un GERCEKTEN cozulemedigi
    // TEK durumlardir. isSupportedChain her secimi dogruladigindan network.js
    // 0/'abc' gibi bir chainId'yi asla currentNetwork'e YAZMAZ; asagidaki iki
    // deger artik ayri testlerde, kendi degerleriyle doner.)
    it('aktif zincir cozulemezse "tum aglar" korunur', () => {
        expect(effectiveScope(ALL_NETWORKS, false, undefined)).toBe(ALL_NETWORKS)
        expect(effectiveScope(ALL_NETWORKS, false, null)).toBe(ALL_NETWORKS)
    })

    // Eskiden burada `Number.isFinite` + `&& numeric` kontrolu vardi ve 'abc'/0
    // gibi degerleri de "tum aglar"a duserdi. Bu kontrol GERCEKTE hicbir zaman
    // olusmayan degerleri (network.js currentNetwork'e boyle bir deger asla
    // yazmaz) korumak icin degil, Solana'nin METIN kimligini de (yanlislikla)
    // elemek icin calisiyordu. `??` tabanli yeni uygulamada yalniz null/undefined
    // "cozulemedi" sayilir; baska her deger (0 dahil) OLDUGU GIBI doner.
    it('gercek olmayan (sentetik) degerler artik OLDUGU GIBI doner', () => {
        expect(effectiveScope(ALL_NETWORKS, false, 'abc')).toBe('abc')
        expect(effectiveScope(ALL_NETWORKS, false, 0)).toBe(0)
    })

    it('metin chainId (Solana) OLDUGU GIBI doner (isSameChainId tabanli karsilastirma)', () => {
        const out = effectiveScope(ALL_NETWORKS, false, '137')
        expect(out).toBe('137')
        expect(typeof out).toBe('string')
    })
})

describe('metin kimlikli zincirler (Solana)', () => {
    it('Solana ya gecis filtreyi Solana ya tasir', () => {
        expect(nextNetworkFilter(ALL_NETWORKS, 1, 'solana-mainnet')).toBe('solana-mainnet')
    })

    it('Solana dan EVM e donus filtreyi tasir', () => {
        expect(nextNetworkFilter('solana-mainnet', 'solana-mainnet', 56)).toBe(56)
    })

    it('ayni zincire "gecis" filtreyi degistirmez', () => {
        expect(nextNetworkFilter('all', 'solana-mainnet', 'solana-mainnet')).toBe('all')
    })

    it('ilk yukleme (null -> zincir) filtreye dokunmaz', () => {
        expect(nextNetworkFilter(ALL_NETWORKS, null, 'solana-mainnet')).toBe(ALL_NETWORKS)
    })

    it('effectiveScope Solana yi gecerli sayar', () => {
        expect(effectiveScope(ALL_NETWORKS, false, 'solana-mainnet')).toBe('solana-mainnet')
    })

    it('effectiveScope zincir yokken tum aglar da kalir', () => {
        expect(effectiveScope(ALL_NETWORKS, false, null)).toBe(ALL_NETWORKS)
    })
})
