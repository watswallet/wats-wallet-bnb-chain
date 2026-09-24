// Uzun bir alan adini KARTA SIGACAK hale getirir -- saf katman.
//
// NEDEN CSS `truncate` YETMEZ: o SONDAN kirpar ve bir alan adinin ayirt edici
// parcasi (kayitli alan adi) tam da sonda durur. 280px'lik kimlik satirinda
// "app.marketplace.getgems.io" -> "app.marketplace.get…" olurdu; kullanici hangi
// siteye baktigini soyleyemez. Bu yuzden kirpma BASTAN yapilir.
//
// TLD LISTESI YOK. 'co.uk' gibi iki parcali sonekleri dogru saymak surekli
// guncellenen bir liste ister; burada gerek de yok, cunku soru "kayitli alan adi
// hangisi" degil, "hangi parcalar siginir". Etiketler SONDAN GERIYE eklenir.

const ONEK = '…'

/**
 * @param {string} host  ham alan adi ('www.' varsa atilir)
 * @param {number} [max] gosterilecek azami karakter (onek haric)
 * @returns {string} siginiyorsa alan adinin kendisi, sigmiyorsa '…' + kuyrugu
 */
export function shortHost(host, max = 24) {
    if (typeof host !== 'string') return ''

    // 'www.' hicbir zaman ayirt edici degildir: yer kaplar, bilgi tasimaz.
    const h = host.trim().replace(/^www\./i, '')
    if (!h || h.length <= max) return h

    const parcalar = h.split('.')

    // Son IKI etiket KOSULSUZ korunur -- max'i assa bile. Alternatifi, alan adini
    // taninmaz bir harf dizisine indirmek olurdu ki bu onu hic basmamaktan farksiz.
    let kuyruk = parcalar.slice(-2).join('.')

    // Kalan etiketler sondan geriye dogru, siga siga eklenir: sigan bilgi
    // bosuna atilmaz.
    for (let i = parcalar.length - 3; i >= 0; i--) {
        const aday = `${parcalar[i]}.${kuyruk}`
        if (aday.length > max) break
        kuyruk = aday
    }

    return kuyruk === h ? h : ONEK + kuyruk
}
