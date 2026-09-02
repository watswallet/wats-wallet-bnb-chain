// TON takas teklifi: sunucu proxy'sinden alir, DOGRULAR, normalize eder.
//
// Teklif dogrudan api.ston.fi'den DEGIL kendi sunucumuzdan gelir
// (POST /ton/swap/simulate). Uc gerekce: uzantinin CSP'sine yeni alan adi
// eklemek gerekmez, router filosu sunucuda onbeklenir, ve yukari akisin hata
// govdesi istemciye hic ulasmaz.
//
// BU DOSYA SAFTIR: fetch disaridan verilir, chrome API'sine ve depoya dokunmaz.
//
// EN ONEMLI KURAL: `minAskUnits` SUNUCUDAN GELIR ve burada YENIDEN HESAPLANMAZ.
// Kayma korumasi odur.
//
// DURUSTCE: STON.fi'nin bugunku formulu KARMASIK DEGIL - uc gercek teklif
// olculdu ve ucu de tam olarak floor(ask_units * (1 - slippage)) cikti. Yani
// "saglayicinin matematigini taklit edemeyiz" demek YANLIS olurdu. Sebep baska
// ve daha saglam:
//
//   1. TEK KAYNAK. Ekranda gosterilen sayi ile zincire giden sayi AYNI yerden
//      gelir. Hesaplasaydik, gosterim ile imza arasinda bir yuvarlama ya da
//      farkli bir slippage kaynagi ayrisma uretebilirdi - ve ayrisan deger
//      zincire giden olurdu.
//   2. FORMUL BIZIM DEGIL. Bugun duz yuzde; STON.fi yarin ucret-farkindali ya
//      da egri-tipine ozel bir hesaba gecerse bizim kopyamiz SESSIZCE ayrisir
//      ve kullaniciya gosterdigimizden ZAYIF bir koruma imzalariz.
//   3. YUVARLAMA YONU. floor ile round bir birim fark eder; tahmin edilecek
//      bir sey degil.

export const QUOTE_MAX_AGE_MS = 30 * 1000

// Kullanici degistirmezse bu kullanilir. Sunucu tarafinda da bir ust sinir var
// (MAX_SLIPPAGE), yani burada bir hata olsa bile sinirsiz kayma disari cikamaz.
export const DEFAULT_SLIPPAGE = 0.01

/**
 * Teklif hala GECERLI mi?
 *
 * Bayat bir teklifle imzalamak, kullanicinin EKRANDA GORDUGU fiyatla zincire
 * GIDEN fiyatin ayrismasi demektir. Havuz fiyati saniyeler icinde kayabilir.
 *
 * Zaman damgasi yoksa ya da gelecege aitse REDDEDER. Ikisi de "guvenilmez veri"
 * demek ve guvenli yon burada reddetmektir - "taze say" demek kapiyi tumden
 * devre disi birakirdi.
 */
export function isQuoteFresh(quote, now = Date.now()) {
    const at = quote?.fetchedAt
    if (!Number.isFinite(at)) return false
    const age = now - at
    // Gelecek zaman damgasi: bozuk saat ya da kurcalanmis veri.
    if (age < 0) return false
    // `<=` BILEREK: sinir DEGERI degil, ASILMASI reddediliyor
    // (tonSendAmountFits / jettonSendFits ile ayni karar).
    return age <= QUOTE_MAX_AGE_MS
}

// Yanitin ZORUNLU alanlari. Biri eksikse teklif KULLANILAMAZ ve eksik alanla
// devam etmek korumasiz bir takas kurmak demektir.
function assertUsable(quote) {
    if (!quote || typeof quote !== 'object') throw new Error('TON_SWAP_QUOTE_FAILED')

    // askUnits: kullaniciya gosterilen cikti.
    // minAskUnits: KAYMA KORUMASI - yoksa takas kotu fiyattan dolar.
    for (const field of ['askUnits', 'minAskUnits']) {
        const v = quote[field]
        if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Error('TON_SWAP_QUOTE_FAILED')
    }

    // Router ADRES + SURUM birlikte gelmek zorunda. routerFactory dogru sozlesme
    // sinifini secmek icin surume ihtiyac duyar; v1 ve v2 FARKLI alan duzeni
    // kullaniyor (docs/superpowers/notes/2026-08-26-stonfi-dogrulama.md §1).
    // Ciplak adresle kurulan mesaj yanlis router'a gider ve islem duser.
    const r = quote.router
    if (!r || typeof r.address !== 'string' || !r.address) throw new Error('TON_SWAP_QUOTE_FAILED')
    if (!Number.isInteger(r.majorVersion)) throw new Error('TON_SWAP_QUOTE_FAILED')
}

/**
 * Sunucudan takas teklifi alir.
 *
 * @returns {{ offerUnits, askUnits, minAskUnits, poolAddress, priceImpact,
 *             feeUnits, router: { address, majorVersion, minorVersion,
 *             routerType, ptonMasterAddress }, fetchedAt }}
 *
 * `units` HAM TAMSAYI DIZESIDIR (ondalik zaten uygulanmis). Ondalikli sayi
 * KABUL EDILMEZ: bu dosya donusum yapmaz, cunku donusum kayan noktaya bulasirsa
 * miktar sessizce degisir (bkz. jettonTransfer.js decimalToRawUnits notu -
 * 2.675 @ 2 ondalik, kayan nokta ile 268 cikiyordu, 267 degil).
 */
export async function getTonSwapQuote({
    apiBase, offerAddress, askAddress, units, slippage = DEFAULT_SLIPPAGE,
    fetchImpl = (...args) => fetch(...args),
}) {
    const base = String(apiBase || '').trim().replace(/\/+$/, '')
    // Sunucu adresi yoksa AGA HIC CIKILMAZ: tonClient.js ile ayni anahtar,
    // cunku kullaniciya gosterilecek mesaj da ayni ("Sunucuya baglanilamadi").
    if (!base) throw new Error('TON_API_BASE_MISSING')

    let response
    try {
        response = await fetchImpl(`${base}/ton/swap/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                offerAddress, askAddress, units,
                slippageTolerance: slippage,
            }),
        })
    } catch {
        // Ham ag hatasi SIZMAZ. Hata sozlesmemiz makine-okunur anahtarlardir;
        // arayuz eslemesi ancak anahtari cevirebilir, ham fetch metnini degil
        // (o metin kullaniciya "ECONNREFUSED 1.2.3.4:443" diye gorunurdu).
        throw new Error('TON_SWAP_QUOTE_FAILED')
    }

    let body = null
    try {
        body = await response.json()
    } catch {
        throw new Error('TON_SWAP_QUOTE_FAILED')
    }

    if (!response.ok || body?.success !== true) {
        // Sunucunun anahtarini KORU: rota yoklugu bir HATA DEGIL bir CEVAPTIR
        // ("bu cift takas edilemiyor"). QUOTE_FAILED'a cevirmek gercek sebebi
        // gizler ve kullaniciya "baglantinizi kontrol edin" dedirtir.
        const code = typeof body?.code === 'string' ? body.code : 'TON_SWAP_QUOTE_FAILED'
        throw new Error(code)
    }

    const quote = body.quote
    assertUsable(quote)

    return {
        // TEKLIF HANGI CIFT ICIN ALINDIGINI TASIR. Bu alanlar kozmetik degil,
        // bir PARA KAPISININ girdisi: kullanici teklifi aldiktan sonra token
        // degistirirse (ya da bir yaris sonucu eski teklif elde kalirsa), o
        // teklifin `minAskUnits`i BASKA BIR CIFT icin hesaplanmistir ve onunla
        // imzalamak, kullanicinin gormedigi bir korumayla takas yapmak olur.
        // tonSwap.js gonderim oncesi bunlarin eslesmesini SART kosar.
        offerAddress,
        askAddress,
        offerUnits: String(quote.offerUnits ?? units),
        askUnits: quote.askUnits,
        // SUNUCUDAN GELDIGI GIBI GECER. Yeniden hesaplanmiyor - dosya basi notu.
        minAskUnits: quote.minAskUnits,
        poolAddress: quote.poolAddress ?? null,
        priceImpact: Number(quote.priceImpact ?? 0),
        feeUnits: quote.feeUnits ?? null,
        router: {
            address: quote.router.address,
            majorVersion: quote.router.majorVersion,
            minorVersion: quote.router.minorVersion,
            routerType: quote.router.routerType ?? null,
            ptonMasterAddress: quote.router.ptonMasterAddress ?? null,
        },
        // Tazelik kapisi (isQuoteFresh) buna bakar.
        fetchedAt: Date.now(),
    }
}
