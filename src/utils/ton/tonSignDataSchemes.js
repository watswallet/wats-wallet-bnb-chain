// TonConnect signData: UC TIP, UC AYRI SEMA -- saf katman.
//
// DOGRULAMA (2026-09-01, bu gorev sirasinda yapildi): asagidaki duzen
// hatirdan YAZILMADI. Iki kaynaktan birebir alindi ve resmi bir regresyon
// imzasiyla UCTAN UCA (Node + @ton/core + @ton/crypto ile) yeniden uretilip
// BAYT BAYT eslesti -- yani asagidaki yalnizca "yapisal olarak tutarli"
// degil, GERCEKTEN dogru. `tonSignDataSchemes.test.js`'teki kalici regresyon
// testi imzalama icin `@ton/crypto`'nun `sign()`ini kullanir -- bu projenin
// DOGRUDAN bagimliligidir; `tweetnacl` gecisken olarak cozulur ama hicbir
// yerde DOGRUDAN import EDILMEZ (gecisken bir surum degisikligi bu testin
// tek gercek dogruluk kilidini sessizce devre disi birakmasin diye):
//
// KAYNAK 1 (resmi): github.com/ton-connect/demo-dapp-with-react-ui
//   (ton-connect GitHub org'unun kendi resmi demo dapp + backend deposu)
//   src/server/services/sign-data-service.ts -- createTextBinaryHash() ve
//   createCellHash().
// KAYNAK 2 (bagimsiz uygulama + somut test vektoru):
//   github.com/mois-ilya/ton-sign-data-reference, src/utils.ts (KAYNAK 1 ile
//   birebir ayni algoritma) ve src/__tests__/sign.test.ts icindeki
//   "regression tests with known signatures" -- sabit bir mnemonic + adres +
//   zaman damgasi + payload icin BEKLENEN base64 imzayi barindirir.
//
// Bu gorev sirasinda KAYNAK 2'nin test vektoru ("unfold item school little
// upper surge pride endorse outer filter biology prefer regular island hidden
// dice nuclear grace motor entire weird between falcon dwarf" mnemonic'i,
// adres "UQCyqTmXJpshFu1GW1tyTX6paa3c-37OG9s3uv8ZzX_9GDfx", domain
// "example.com", timestamp 1703980800) asagidaki semayla yeniden uretildi ve
// uc tipin de KAYNAK 2'nin sabit-kodlanan beklenen imzasiyla (text/binary/
// cell) tam eslestigi Node uzerinde dogrulandi. tonSignDataSchemes.test.js
// icindeki "resmi regresyon vektoru" testi bu ayni uc vektoru kilitler.
//
// --- text / binary (KAYNAK 1/2 createTextBinaryHash, birebir ayni) ---
//   message = 0xff 0xff
//           | "ton-connect/sign-data/"        (23 ascii bayt, sabit literal)
//           | workchain                        int32  BUYUK-endian (4 bayt)
//           | address_hash                      32 bayt (ham, cuzdan adresi)
//           | domain_len                       uint32 BUYUK-endian (4 bayt)
//           | domain                            utf-8 bayt (domain_len kadar)
//           | timestamp                        uint64 BUYUK-endian (8 bayt)
//           | type_prefix                       "txt" / "bin" (3 ascii bayt)
//           | payload_len                      uint32 BUYUK-endian (4 bayt)
//           | payload                           utf-8 (text) / base64-cozulmus (binary)
//   Imzalanan = ed25519.sign( sha256(message) ). Bu modul YALNIZCA `message`i
//   dondurur -- sha256 CAGIRANDA (background service worker), WebCrypto ile
//   uygulanir. Bu tip icin `bytes` HENUZ hash DEGIL, hash'in ON-GORUNTUSUDUR
//   (donen sonucta `prehashed: false`).
//
// --- cell (KAYNAK 1/2 createCellHash) ---
//   hucre = beginCell()
//     .storeUint(0x75569022, 32)             // sabit on-ek (TonConnect signData/cell)
//     .storeUint(crc32(schema_utf8), 32)     // TL-B semasinin STANDART (imzasiz) CRC-32'si
//     .storeUint(timestamp, 64)
//     .storeAddress(workchain, address_hash) // MsgAddressInt (addr_std, anycast yok)
//     .storeStringRefTail(dnsEncode(domain)) // TEP-81: etiketler TERS + her etiketten sonra 0x00
//     .storeRef(Cell.fromBase64(payload.cell)) // dapp'in gonderdigi hucre, REF olarak
//     .endCell()
//   Imzalanan = ed25519.sign( hucre.hash() ). hucre.hash() TVM'in kendi
//   ozyineli hucre-agaci hash'idir (d1/d2 betimleyicileri + alt hucre
//   hash'leri icerir) -- duz baytlarin sha256'siyla YENIDEN URETILEMEZ. Bu
//   yuzden bu TEK tip icin `@ton/core` kullanildi (asagidaki nota bakin) ve bu
//   modul dogrudan NIHAI 32 baytlik hash'i dondurur: text/binary'nin aksine,
//   CAGIRAN bu tip icin AYRICA sha256 UYGULAMAMALI, donen baytlari dogrudan
//   ed25519 ile imzalamali (donen sonucta `prehashed: true`).
//
// `prehashed` alani -- CAGIRAN ICIN BAGLAYICI SOZLESME: `bytes` iki FARKLI
// sey ifade eder ve bunu tipe gore ayirt etmek cagirana birakilamaz (bir
// sonraki gorev -- arka plan servis calisani -- bu dosyayi OKUMAMIS olacak).
// `prehashed === false` (text/binary): `bytes` on-goruntu, cagiran sha256
// UYGULAMALI. `prehashed === true` (cell): `bytes` zaten nihai hash, cagiran
// sha256 UYGULAMAMALI. `ok`, `type`, `bytes` alanlari DEGISMEDI -- bu SADECE
// eklenen bir alan, yeniden adlandirma degil.
//
// Neden tek ortak yol YAZILMADI: tipler ayni govdeyi paylasirsa, bir tipte
// alinan imza baska bir tipte tekrar kullanilabilir hale gelir. Uc ayri yol,
// uc ayri test.
//
// AG YOK, chrome YOK. `@ton/core` SADECE cell hucresini kurup TVM hash'ini
// almak icin kullanilir -- ag erisimi yok, saf/senkron hesaplama (Cell/
// beginCell/Address hicbir yerde fetch/depo/chrome cagirmaz). schema_hash icin
// gereken CRC-32, `crc-32` npm paketi eklemek yerine asagida elle (standart
// IEEE 802.3 / zlib algoritmasi, poly 0xEDB88320) uygulandi ve yukaridaki
// regresyon vektoruyle DOGRULANDI -- yeni bir bagimlilik eklemeden.

import { Address, beginCell, Cell } from '@ton/core'

export const SIGN_DATA_TYPES = ['text', 'binary', 'cell']
const BAD_REQUEST = 1

const enc = new TextEncoder()
const err = (message) => ({ ok: false, code: BAD_REQUEST, message })

const SIGN_DATA_PREFIX = enc.encode('ton-connect/sign-data/')
const CELL_MAGIC = 0x75569022

function decodeBase64(value) {
    try {
        const bin = atob(value)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    } catch (e) {
        return null
    }
}

function concat(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of parts) { out.set(p, offset); offset += p.length }
    return out
}

function i32be(n) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setInt32(0, n | 0, false)
    return b
}

function u32be(n) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, n, false)
    return b
}

function u64be(n) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigUint64(0, BigInt(n), false)
    return b
}

function validCtx(ctx) {
    if (!ctx || typeof ctx !== 'object') return false
    if (!Number.isInteger(ctx.workchain)) return false
    if (!(ctx.addressHash instanceof Uint8Array) || ctx.addressHash.length !== 32) return false
    if (typeof ctx.domain !== 'string' || ctx.domain.length === 0) return false
    if (!Number.isInteger(ctx.timestamp) || ctx.timestamp < 0) return false
    return true
}

/** text/binary: uc tipin PAYLASTIGI baglam govdesi (KAYNAK 1/2). */
function textBinaryContext({ workchain, addressHash, domain, timestamp }) {
    const domainBytes = enc.encode(domain)
    return concat([
        new Uint8Array([0xff, 0xff]),
        SIGN_DATA_PREFIX,
        i32be(workchain),
        addressHash,
        u32be(domainBytes.length),
        domainBytes,
        u64be(timestamp),
    ])
}

/**
 * TEP-81 alan-adi ic gosterimi: etiketler TERS cevrilir, her etiketten sonra
 * 0x00 eklenir. Ornek: "app.dedust.io" -> "io\0dedust\0app\0".
 * Yalnizca cell semasinda kullanilir -- text/binary domain'i DUZ utf-8 gomer.
 * Bos etiket ("a..b") reddedilir (null doner).
 */
function dnsEncodeDomain(domain) {
    let norm = domain.toLowerCase()
    if (norm.endsWith('.')) norm = norm.slice(0, -1)
    if (norm === '') return '\u0000'
    const labels = norm.split('.')
    if (labels.some((l) => l.length === 0)) return null
    return labels.reverse().map((l) => `${l}\u0000`).join('')
}

// Standart CRC-32 (IEEE 802.3 / zlib), poly 0xEDB88320, init/final 0xFFFFFFFF.
// `crc-32` npm paketiyle (ve dolayisiyla KAYNAK 1/2'nin schema_hash alaniyla)
// AYNI sonucu uretir -- basdaki regresyon vektoruyle dogrulandi.
const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
        table[n] = c >>> 0
    }
    return table
})()

function crc32(bytes) {
    let crc = 0xffffffff
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

export function buildSignDataInput(payload, ctx) {
    if (!payload || typeof payload !== 'object') return err('Malformed signData payload')
    if (!validCtx(ctx)) return err('Bad sign-data context')

    switch (payload.type) {
        case 'text': {
            if (typeof payload.text !== 'string' || !payload.text) return err('signData text is missing')
            const textBytes = enc.encode(payload.text)
            return {
                ok: true,
                type: 'text',
                prehashed: false,
                bytes: concat([
                    textBinaryContext(ctx),
                    enc.encode('txt'),
                    u32be(textBytes.length),
                    textBytes,
                ]),
            }
        }
        case 'binary': {
            if (typeof payload.bytes !== 'string' || !payload.bytes) return err('signData bytes is missing')
            const raw = decodeBase64(payload.bytes)
            if (!raw) return err('signData bytes is not valid base64')
            return {
                ok: true,
                type: 'binary',
                prehashed: false,
                bytes: concat([
                    textBinaryContext(ctx),
                    enc.encode('bin'),
                    u32be(raw.length),
                    raw,
                ]),
            }
        }
        case 'cell': {
            if (typeof payload.cell !== 'string' || !payload.cell) return err('signData cell is missing')
            if (typeof payload.schema !== 'string' || !payload.schema) return err('signData schema is missing')

            let userCell
            try {
                userCell = Cell.fromBase64(payload.cell)
            } catch (e) {
                return err('signData cell is not a valid BOC')
            }

            const dnsDomain = dnsEncodeDomain(ctx.domain)
            if (dnsDomain === null) return err('Bad domain for cell payload')

            const schemaHash = crc32(enc.encode(payload.schema))
            const address = new Address(ctx.workchain, ctx.addressHash)

            let hash
            try {
                const msgCell = beginCell()
                    .storeUint(CELL_MAGIC, 32)
                    .storeUint(schemaHash, 32)
                    .storeUint(ctx.timestamp, 64)
                    .storeAddress(address)
                    .storeStringRefTail(dnsDomain)
                    .storeRef(userCell)
                    .endCell()
                hash = new Uint8Array(msgCell.hash())
            } catch (e) {
                return err('signData cell could not be built')
            }

            // Onemli: cagiran bu 32 bayti DOGRUDAN ed25519 ile imzalamali --
            // text/binary'nin aksine AYRICA sha256 UYGULAMAMALI (yukaridaki
            // basliktaki nota ve `prehashed` sozlesmesine bakin).
            return { ok: true, type: 'cell', prehashed: true, bytes: hash }
        }
        default:
            return err('Unsupported signData payload type')
    }
}
