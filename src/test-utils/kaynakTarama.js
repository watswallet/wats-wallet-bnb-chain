/**
 * KAYNAK KILIDI YARDIMCILARI -- yorum-kor ve satir-sonu-bagimsiz tarama.
 *
 * Bu depodaki kaynak kilidi testleri iki hata sinifina dusuyordu:
 *
 * 1. SATIR SONU TUZAGI. Dosyalar diskte CRLF. `/... => \{\n([\s\S]*?)\n\}/`
 *    gibi bir regex `{`in HEMEN yanindaki LF'i sart kosar, yani gercek
 *    `{\r\n` baytlarina ESLESMEZ ve `match()` null doner. Buradaki govde
 *    cikaricilari regex ile degil PARANTEZ ESLESTIREREK calisir: satir
 *    sonunun ne oldugu onlari hic ilgilendirmez.
 *
 * 2. YORUM KORLUGU. `expect(kaynak).toContain('initPanelWindowId')` gibi bir
 *    iddia dosyanin HERHANGI bir yerindeki bir YORUMLA ya da kullanilmayan
 *    bir IMPORT satiriyla saglanabilir -- yani iddia, adinda yazan kodu
 *    silseniz bile YESIL kalir. `yorumsuz()` yorum karakterlerini BOSLUKLA
 *    degistirir (uzunluk ve satir sayisi KORUNUR, boylece ofset
 *    karsilastirmalari orijinal kaynakla ayni sirayi verir) ve `importsuz()`
 *    import satirlarini ayni sekilde temizler.
 *
 * Hicbir yardimci satir sonu baytina ya da karakter mesafesine dayanmaz.
 */

const bosluklaAyniUzunlukta = (metin) => metin.replace(/[^\r\n]/g, ' ')

// `/` karakterinin BOLME mi REGEX baslangici mi oldugunu ayirt etmek icin.
// Yanlis ayirt edilirse regex icindeki bir tirnak sahte bir dizge baslatir ve
// tarayici gercek kodu yutar.
const REGEX_ONCESI_KELIMELER = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'do', 'else', 'yield', 'await', 'case', 'throw',
])

/**
 * Yorumlari (`//`, ` / * ... * / `, `<!-- -->`) esit uzunlukta boslukla degistirir.
 * Dizge ve regex literalleri OLDUGU GIBI kalir, satir sonlari korunur.
 * @param {string} kaynak
 * @returns {string}
 */
export function yorumsuz(kaynak) {
    let cikti = ''
    let i = 0
    const n = kaynak.length
    let sonAnlamli = ''
    let sonKelime = ''

    while (i < n) {
        const c = kaynak[i]
        const c2 = kaynak[i + 1]

        if (c === '/' && c2 === '/') {
            let j = i
            while (j < n && kaynak[j] !== '\n' && kaynak[j] !== '\r') j++
            cikti += ' '.repeat(j - i)
            i = j
            continue
        }

        if (c === '/' && c2 === '*') {
            let j = kaynak.indexOf('*/', i + 2)
            j = j === -1 ? n : j + 2
            cikti += bosluklaAyniUzunlukta(kaynak.slice(i, j))
            i = j
            continue
        }

        if (c === '<' && kaynak.startsWith('<!--', i)) {
            let j = kaynak.indexOf('-->', i + 4)
            j = j === -1 ? n : j + 3
            cikti += bosluklaAyniUzunlukta(kaynak.slice(i, j))
            i = j
            continue
        }

        if (c === "'" || c === '"' || c === '`') {
            let j = i + 1
            while (j < n) {
                if (kaynak[j] === '\\') { j += 2; continue }
                if (kaynak[j] === c) { j++; break }
                j++
            }
            cikti += kaynak.slice(i, j)
            i = j
            sonAnlamli = c
            sonKelime = ''
            continue
        }

        if (c === '/' && regexBaslayabilir(sonAnlamli, sonKelime)) {
            let j = i + 1
            let sinifIcinde = false
            while (j < n) {
                const k = kaynak[j]
                if (k === '\\') { j += 2; continue }
                if (k === '\n' || k === '\r') break
                if (k === '[') sinifIcinde = true
                else if (k === ']') sinifIcinde = false
                else if (k === '/' && !sinifIcinde) { j++; break }
                j++
            }
            cikti += kaynak.slice(i, j)
            i = j
            sonAnlamli = '/'
            sonKelime = ''
            continue
        }

        cikti += c
        if (!/\s/.test(c)) {
            sonAnlamli = c
            sonKelime = /[A-Za-z0-9_$]/.test(c) ? sonKelime + c : ''
        }
        i++
    }

    return cikti
}

function regexBaslayabilir(sonAnlamli, sonKelime) {
    if (sonAnlamli === '') return true
    if (REGEX_ONCESI_KELIMELER.has(sonKelime)) return true
    // Bir deger BITIREN karakterden sonra `/` bolmedir.
    return !/[A-Za-z0-9_$)\]]/.test(sonAnlamli)
}

/**
 * `import ...` satirlarini esit uzunlukta boslukla degistirir. Kullanilmayan
 * bir import'un tek basina bir iddiayi yesil tutmasini engeller.
 * @param {string} kaynak
 * @returns {string}
 */
export function importsuz(kaynak) {
    return kaynak.replace(/^[^\S\r\n]*import[^\r\n]*/gm, bosluklaAyniUzunlukta)
}

/** Yorumlari VE import satirlarini temizlenmis kaynak. */
export function saltKod(kaynak) {
    return importsuz(yorumsuz(kaynak))
}

const KAPANIS = { '{': '}', '(': ')', '[': ']' }

/**
 * `acilisAt` konumundaki acilis karakterinin ESLESEN kapanisinin indeksini
 * doner (dizge/regex/yorum ICINDEKI parantezleri saymaz). Bulunamazsa -1.
 * @param {string} kod yorumlari TEMIZLENMIS kaynak
 * @param {number} acilisAt
 */
export function eslesenKapanis(kod, acilisAt) {
    const acilis = kod[acilisAt]
    const kapanis = KAPANIS[acilis]
    if (!kapanis) return -1

    let derinlik = 0
    let i = acilisAt
    let sonAnlamli = ''
    let sonKelime = ''

    while (i < kod.length) {
        const c = kod[i]

        if (c === "'" || c === '"' || c === '`') {
            let j = i + 1
            while (j < kod.length) {
                if (kod[j] === '\\') { j += 2; continue }
                if (kod[j] === c) { j++; break }
                j++
            }
            i = j
            sonAnlamli = c
            sonKelime = ''
            continue
        }

        if (c === '/' && regexBaslayabilir(sonAnlamli, sonKelime)) {
            let j = i + 1
            let sinifIcinde = false
            while (j < kod.length) {
                const k = kod[j]
                if (k === '\\') { j += 2; continue }
                if (k === '\n' || k === '\r') break
                if (k === '[') sinifIcinde = true
                else if (k === ']') sinifIcinde = false
                else if (k === '/' && !sinifIcinde) { j++; break }
                j++
            }
            i = j
            sonAnlamli = '/'
            sonKelime = ''
            continue
        }

        if (c === acilis) derinlik++
        else if (c === kapanis) {
            derinlik--
            if (derinlik === 0) return i
        }

        if (!/\s/.test(c)) {
            sonAnlamli = c
            sonKelime = /[A-Za-z0-9_$]/.test(c) ? sonKelime + c : ''
        }
        i++
    }

    return -1
}

/**
 * `imza` ile eslesen yerden SONRAKI ilk `{`in govdesini doner (parantez
 * eslestirmeyle -- satir sonundan BAGIMSIZ). Yorumlar temizlenmistir.
 *
 * @param {string} kaynak ham dosya icerigi
 * @param {RegExp|string} imza govdenin ONUNDEKI imza
 * @returns {string|null} govde (dis `{}` HARIC) ya da bulunamazsa null
 */
export function blokGovdesi(kaynak, imza) {
    return icGovde(kaynak, imza, '{')
}

/**
 * Ayni sey, ama `(` icin: `computed(...)` / `defineStore(...)` gibi govdesi
 * suslu parantezle SARILMAYAN ifadeler icin.
 */
export function cagriGovdesi(kaynak, imza) {
    return icGovde(kaynak, imza, '(')
}

/** Ayni sey, `[` icin: dizi sabitleri. */
export function diziGovdesi(kaynak, imza) {
    return icGovde(kaynak, imza, '[')
}

function icGovde(kaynak, imza, acilis) {
    const kod = yorumsuz(kaynak)
    const re = imza instanceof RegExp
        ? imza
        : new RegExp(imza.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const eslesme = kod.match(re)
    if (!eslesme) return null

    // Arama eslesmenin SON karakterinden baslar, basindan DEGIL: aksi halde
    // `bootstrapWalletUi({ surface = SURFACE_POPUP } = {})` gibi bir imzada
    // parametre YIKIMININ suslu parantezi fonksiyon govdesi sanilir. Son
    // karakter dahil edilir ki imzanin KENDISI acilisla bitebilsin
    // (`computed(` gibi).
    const bas = kod.indexOf(acilis, eslesme.index + eslesme[0].length - 1)
    if (bas === -1) return null
    const son = eslesenKapanis(kod, bas)
    if (son === -1) return null
    return kod.slice(bas + 1, son)
}

/**
 * Bir CSS kuralinin SECICI LISTESINI dizi olarak doner (`{`ten onceki kisim,
 * virgulle bolunmus ve kirpilmis). Bulunamazsa null.
 */
export function cssSeciciListesi(css, ilkSecici) {
    const kod = yorumsuz(css)
    const bas = kod.indexOf(ilkSecici)
    if (bas === -1) return null
    const suslu = kod.indexOf('{', bas)
    if (suslu === -1) return null
    return kod.slice(bas, suslu).split(',').map((s) => s.trim()).filter(Boolean)
}

/** Bir CSS kuralinin BILDIRIM govdesini (`{` ve `}` arasi) doner. */
export function cssKuralGovdesi(css, ilkSecici) {
    return icGovde(css, ilkSecici, '{')
}
