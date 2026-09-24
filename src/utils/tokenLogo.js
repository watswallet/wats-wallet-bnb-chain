// Bir token kaydindan GOSTERILECEK LOGO URL'ini cozer -- saf katman.
//
// NEDEN VAR (olculdu 2026-09-14, canli API -- POST /getChainTokens):
// Sunucu `image` alanini IKI FARKLI SEKILDE donduruyor.
//
//   chainId  56 (BSC)  -> image: { large, small, thumb }     NESNE
//   chainId   1 (ETH)  -> image: { large, small, thumb }     NESNE
//   chainId -239 TON   -> image: { large, small, thumb }     NESNE  (yerli coin)
//   chainId -239 jetton-> image: "https://tether.to/..."     DIZE
//
// Arayuz her yerde `token.image?.large` okuyordu. Bir DIZENIN `.large`i
// `undefined` oldugu icin TON jetton'lari (USDT, NOT, DOGS, STON, HMSTR, CATI)
// gri yer tutucu ile ciziliyordu -- oysa URL'ler gecerliydi, besi de 200 PNG.
//
// Kalip 15 cagri yerine dagilmisti ve yalnizca BIRI (Dapp.vue) dize bicimini
// ele aliyordu: sekil bir kez fark edilmis ama tek yerde cozulmustu. Bu dosya
// o cevabin TEK kopyasidir -- yenisi eklendiginde 15 yeri gezmek gerekmesin.
//
// AYRICA FIRLATMAZ: Home.vue `token.image.large` yaziyordu (opsiyonel zincir
// YOK) ve `image` hic olmayan bir kayitta TypeError atiyordu. Swap.vue:85'teki
// yorum ayni tuzagi zaten anlatiyor.
//
// AG YOK, DEPO YOK.

export const VARSAYILAN_TOKEN_LOGOSU = '/default-token.png'

// Bos dize, bosluk ve dize OLMAYAN degerler "yok" sayilir: hepsi `src`e girince
// ya goreli yol olarak 404 uretir ya da "[object Object]" olur.
const url = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * @param {object|null|undefined} token  API'den ya da diskten gelen token kaydi
 * @param {string} [yedek]  hicbir alan cozulmezse donecek deger
 * @returns {string} her zaman bir dize -- cagiran ayrica `|| '...'` yazmak zorunda degil
 */
export function tokenLogo(token, yedek = VARSAYILAN_TOKEN_LOGOSU) {
    const im = token?.image

    // `image` ONCE gelir: API'nin TAZE verisidir. `logoURI` cogunlukla diskteki
    // ESKI kopyadir (ice aktarma aninda damgalanir) ve token yeniden markalanmissa
    // bayat kalir.
    if (typeof im === 'string') {
        const d = url(im)
        if (d) return d
    } else if (im && typeof im === 'object') {
        // large -> small -> thumb. Liste satirlari 24-40px cizsin diye `thumb`
        // tercih edilmez: kucuk kaynak buyutulunce bulaniklasir, buyugu
        // kucultmek ise bedava.
        const d = url(im.large) || url(im.small) || url(im.thumb)
        if (d) return d
    }

    return url(token?.logoURI) || url(token?.logo) || yedek
}
