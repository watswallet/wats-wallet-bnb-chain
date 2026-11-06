// NORMAL MODDA dApp KAPISI: kasadaki Gizli Hesap adresi, bir dApp'in istedigi islemde ya da imzada
// HICBIR konumda gecemez. Gizli Hesap normal hesapla zincirde baglanirsa gizlilik biter; bu tarayici
// "alici" alanini tanimaya calismaz (router/kopru calldata'sinda alici her yerde olabilir), 20 baytlik
// HAM diziyi her yerde arar. Saf fonksiyonlar: chrome API'si BILMEZ.
//
// Eslesme bicimleri:
//   1. 40 hex karakter, harf duyarsiz, 0x'li ya da 0x'siz, herhangi bir konumda (32 bayt sola dolgulu
//      ABI penceresi, paketlenmis konum, JSON metni, adres alani ... hepsi bu alt dizgeyi tasir).
//   2. Hex olarak kodlanmis METIN (personal_sign: '0x' + utf8 baytlari) icinde yazili adres: hex metin
//      baytlara, baytlar latin1 metne cozulur ve ayni 40 hex aranir.
//   3. uint160 ondalik (EIP-712 sayi alani olarak verilen adres).
//
// YANLIS POZITIF: 160 bitlik bir dizinin tesadufen eslesmesi ~2^-160; yani yalniz Gizli adresi bilerek
// gomen bir istek takilir. Hex alt dizgesi bayt siniri gozetmez (nibble kaymasi da eslesir): bu YANLIS
// pozitif degil, daha siki bir kapidir. Gizli Hesap hicbir dApp'e acilmaz, bu yuzden mesru bir dApp
// isteginde adresin gecmesi icin neden yoktur.

const HEX40 = /^[0-9a-f]{40}$/
const HEX_STRING = /^0x(?:[0-9a-f]{2})+$/i

// Gizli adresi 40 karakterlik kucuk harfli hex'e indirger; gecersizse null (hicbir seyle eslesmez).
function canonical(privateAddress) {
    if (typeof privateAddress !== 'string') return null
    const hex = privateAddress.trim().toLowerCase().replace(/^0x/, '')
    return HEX40.test(hex) ? hex : null
}

function hexToLatin1(hex) {
    let out = ''
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
    return out
}

export function containsPrivateAddress(text, privateAddress) {
    const hex = canonical(privateAddress)
    if (hex === null || typeof text !== 'string' || text === '') return false
    const lower = text.toLowerCase()
    if (lower.includes(hex)) return true
    // uint160 ondalik gosterimi (48 haneli sayi: tesadufi eslesme yok).
    const decimal = BigInt('0x' + hex).toString()
    if (text.includes(decimal)) return true
    // Hex kodlu metin: baytlari cozup ayni dizgeyi ara.
    if (HEX_STRING.test(text) && hexToLatin1(text).toLowerCase().includes(hex)) return true
    return false
}

// Parametre agacindaki (dizi / nesne / dize / sayi) HER dizgeyi tarar. Yigin tabanli, derinlik siniri
// YOK (cok derin gomme adresi saklayamaz), dongusel referansta takilmaz (WeakSet). Nesne anahtarlari da
// taranir (anahtar olarak gomulu adres).
export function payloadTouchesPrivate(params, privateAddress) {
    if (canonical(privateAddress) === null) return false
    const seen = new WeakSet()
    const stack = [params]
    while (stack.length > 0) {
        const value = stack.pop()
        if (typeof value === 'string') {
            if (containsPrivateAddress(value, privateAddress)) return true
        } else if (typeof value === 'number' || typeof value === 'bigint') {
            if (containsPrivateAddress(String(value), privateAddress)) return true
        } else if (value !== null && typeof value === 'object') {
            if (seen.has(value)) continue
            seen.add(value)
            if (Array.isArray(value)) {
                for (const item of value) stack.push(item)
            } else {
                for (const key of Object.keys(value)) {
                    if (containsPrivateAddress(key, privateAddress)) return true
                    stack.push(value[key])
                }
            }
        }
    }
    return false
}
