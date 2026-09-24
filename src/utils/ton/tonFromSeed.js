/**
 * Ana BIP39 ifadesinden HESABA OZEL bir TON-native ifade turetir.
 *
 * evmFromTon.js'in AYNASI. Orada TON ifadesinden gecerli bir BIP39 ifadesi
 * uretiliyor; burada BIP39 ifadesinden gecerli bir TON ifadesi.
 *
 * NEDEN SLIP-10 DEGIL:
 *
 * Prototipin yolu m/44'/607'/{i}' idi ve Tonkeeper bunu destekliyor -- ama o
 * yol Tonkeeper tarafinda SABITTIR:
 *     const TON_DERIVATION_PATH = "m/44'/607'/0'"    (mnemonicService.ts)
 * Hesap indeksi kavrami yoktur. Yani index>0 hesaplarimizin TON adresleri baska
 * hicbir cuzdanda IFADEYLE acilamazdi; tek cikis ham ed25519 anahtariydi.
 *
 * Burada uretilen sey TON'un KENDI semasinda gecerli bir ifadedir -- Tonkeeper'in
 * once denedigi BIRINCIL dal -- yani her hesap tam erisimle acilir.
 *
 * KURAL:
 *   ana ifade
 *     -> bip39 tohumu (PBKDF2, 2048 tur)
 *     -> kok = HMAC-SHA512(anahtar = TON_FROM_SEED_DOMAIN, veri = tohum ‖ index_BE32)
 *     -> sayac 0,1,2...:
 *          kelimeler = HMAC-SHA512(kok, sayac_BE32) -> 24 x 11 bit -> TON wordlist
 *          gecerli mi? (isTonMnemonic)
 *     -> ilk gecerli ifade
 *
 * NEDEN ARAMA: TON'da gecerlilik kelimelere gomulu bir saglama biti DEGIL,
 * entropiden turetilen hash'in ilk baytinin 0 olmasidir. Yani rastgele bir
 * kelime dizisi ~1/256 olasilikla gecerlidir ve gecerli olani BULMAK gerekir.
 * Olculdu: ortalama 125 deneme / 68 ms (en kotu ornek 405 deneme / 205 ms).
 *
 * GECERLILIK TEK YERDE TANIMLI: `isTonMnemonic` (tonMnemonic.js). Buraya ikinci
 * bir kopya yazilsaydi iki gercek olur ve sapma YANLIS ADRES olarak gorunurdu.
 *
 * `window` KULLANILMAZ: bu modul MV3 service worker'inda da calisabilmeli.
 * Yalnizca ciplak `crypto.subtle`. `mnemonicWordList` @ton/crypto'dan gelir ve
 * SAF VERIDIR -- hicbir ilkel'e dokunmaz, service worker'da guvenlidir.
 *
 * SIR YAZILMAZ: bu dosya yalnizca hesaplar; diske/aga hicbir sey gondermez.
 */
import * as bip39 from 'bip39'
import { mnemonicWordList } from '@ton/crypto'
import { isTonMnemonic } from './tonMnemonic'

/**
 * Alan ayirici. DEGISTIRILEMEZ.
 *
 * Degisirse AYNI ana ifade BASKA bir TON cuzdani uretir ve kullanicinin eski
 * adresindeki para uygulamada ulasilamaz hale gelir. Surum eki bilincli: kural
 * gercekten degismek zorunda kalirsa YENI bir ad alir (v2) ve eski ad, eski
 * cuzdanlari cozmek icin durur.
 */
export const TON_FROM_SEED_DOMAIN = 'wats/ton-from-seed/v1'

// TON standardi 24 kelimedir.
const TON_WORDS = 24

// 2048 kelimelik liste -> kelime basina 11 bit.
const BITS_PER_WORD = 11n
const WORD_MASK = 0x7ffn

// Hardened sinirini asan index turetme yolunda tasar. tonAccount.js ile ayni sinir.
const HARDENED = 0x80000000

// Pratikte ~125 deneme yetiyor; 4096 guvenli bir ust sinir. Sinirsiz donguye
// birakilmaz: bozuk bir wordlist sessiz bir kilitlenme olurdu.
const MAX_TRIES = 4096

async function hmacSha512(keyBytes, dataBytes) {
    const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-512' },
        false,
        ['sign']
    )
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes))
}

function uint32BE(n) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, n, false)
    return b
}

// 64 baytlik HMAC ciktisindan 24 x 11 = 264 bit cekilir (512 bit fazlasiyla yeter).
function wordsFromMaterial(material) {
    const out = []
    let acc = 0n
    let bits = 0n
    let i = 0
    while (out.length < TON_WORDS) {
        if (bits < BITS_PER_WORD) {
            acc = (acc << 8n) | BigInt(material[i++])
            bits += 8n
            continue
        }
        bits -= BITS_PER_WORD
        out.push(mnemonicWordList[Number((acc >> bits) & WORD_MASK)])
    }
    return out
}

/**
 * @param {string} masterMnemonic ana BIP39 ifadesi
 * @param {number} index hesap indeksi
 * @returns {Promise<string>} 24 kelimelik GECERLI TON-native ifade
 * @throws {Error} TON_INDEX_INVALID — index tam sayi / 0..2^31-1 araliginda degil
 * @throws {Error} TON_MNEMONIC_DERIVE_EXHAUSTED — MAX_TRIES icinde gecerli ifade yok
 */
export async function tonMnemonicFromSeed(masterMnemonic, index) {
    // Gecersiz index DUZELTILMEZ, reddedilir: duzeltilseydi iki farkli hesap ayni
    // TON adresini paylasir ve hesap izolasyonu sessizce kirilirdi.
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
        throw new Error('TON_INDEX_INVALID')
    }

    const seed = new Uint8Array(await bip39.mnemonicToSeed(String(masterMnemonic).trim()))

    const material = new Uint8Array(seed.length + 4)
    material.set(seed)
    material.set(uint32BE(index), seed.length)

    const root = await hmacSha512(new TextEncoder().encode(TON_FROM_SEED_DOMAIN), material)

    for (let counter = 0; counter < MAX_TRIES; counter++) {
        const words = wordsFromMaterial(await hmacSha512(root, uint32BE(counter)))
        if (await isTonMnemonic(words)) return words.join(' ')
    }

    throw new Error('TON_MNEMONIC_DERIVE_EXHAUSTED')
}
