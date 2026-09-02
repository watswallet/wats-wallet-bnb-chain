import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { Address } from '@ton/core'
// NOT: imza icin 'tweetnacl' DEGIL, '@ton/crypto'nun sign()'i kullanilir --
// tweetnacl bu projede dogrudan bagimlilik DEGIL (@ton/crypto uzerinden
// gecisken cozuluyor). Regresyon vektorleri bu gorevin TEK gercek dogruluk
// kilidi oldugu icin, imzalama araci projenin KENDI dogrudan bagimliligindan
// gelmeli -- gecisken bir surum degisikligi bu kilidi sessizce devre disi
// birakmasin.
import { mnemonicToPrivateKey, sign as ed25519Sign } from '@ton/crypto'
import { buildSignDataInput, SIGN_DATA_TYPES } from './tonSignDataSchemes'

const CTX = {
    workchain: 0,
    addressHash: new Uint8Array(32).fill(3),
    domain: 'app.dedust.io',
    timestamp: 1756000000,
}

const TEXT = { type: 'text', text: 'Merhaba' }
const BINARY = { type: 'binary', bytes: 'AQID' }
// NOT: brief'teki orijinal deger ('te6ccgEB') GECERLI/TAM bir BOC DEGIL --
// Cell.fromBase64('te6ccgEB') "Index 48 > 48 is out of bounds" ile PATLAR
// (dogrulandi). Dogrulanan cell semasi hucreyi OPAK bayt olarak degil,
// GERCEK bir TON hucresi olarak parse etmeyi gerektirir (bkz.
// tonSignDataSchemes.js basligi); o yuzden burada gecerli/tam bir BOC
// kullanildi (beginCell().storeUint(0x0f8a7ea5,32).storeStringTail('demo')
// .endCell().toBoc()) -- aksi halde asagidaki "her tip bayt uretir" testi
// DOGRU uygulamaya karsi BASARISIZ olurdu.
const CELL = { type: 'cell', schema: 'transfer#0f8a7ea5', cell: 'te6cckEBAQEACgAAEA+KfqVkZW1vHuYJ5g==' }

const hex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('')

// text/binary govde duzeni (tonSignDataSchemes.js basligindaki dogrulanmis
// semaya gore, MODULDEN BAGIMSIZ olarak burada YENIDEN kuruldu): bu sabit
// ondan sonraki alanlarin (domain_len, timestamp, payload_len...) tam
// ofsetini hesaplamamizi saglar.
const SIGN_DATA_PREFIX_LEN = 2 + new TextEncoder().encode('ton-connect/sign-data/').length // 0xff 0xff + literal
const DOMAIN_LEN_OFFSET = SIGN_DATA_PREFIX_LEN + 4 + 32 // + workchain(4) + address_hash(32)

function readU32BE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false)
}

describe('buildSignDataInput', () => {
    it.each([TEXT, BINARY, CELL])('$type yuku cozulur ve bayt uretir', (p) => {
        const r = buildSignDataInput(p, CTX)
        expect(r.ok).toBe(true)
        expect(r.type).toBe(p.type)
        expect(r.bytes).toBeInstanceOf(Uint8Array)
        expect(r.bytes.length).toBeGreaterThan(0)
        // `prehashed`: cell'de `bytes` ZATEN nihai hash (cagiran AYRICA
        // sha256 UYGULAMAMALI); text/binary'de `bytes` hash'in ON-GORUNTUSU
        // (cagiran sha256 UYGULAMALI). Bu alan yanlissa cagiran cell'i
        // GORUNMEZ sekilde bozar (asagidaki resmi regresyon testi de bu
        // alani KULLANARAK dogrular).
        expect(r.prehashed).toBe(p.type === 'cell')
    })

    // UC AYRI SEMA: ayni girdi uc tipte uc FARKLI imza girdisi vermeli. Ayni
    // sonucu verirlerse tipler birbirine karismis demektir ve bir tipte alinan
    // imza baska bir tipte tekrar kullanilabilir hale gelir.
    it('uc tip birbirinden FARKLI girdi uretir', () => {
        const uretilen = SIGN_DATA_TYPES.map((t) => {
            const p = t === 'text' ? TEXT : t === 'binary' ? BINARY : CELL
            return hex(buildSignDataInput(p, CTX).bytes)
        })
        expect(new Set(uretilen).size).toBe(3)
    })

    // Baglam alanlarinin HEPSI girdiye girmeli: biri disarida kalirsa, bir
    // alan adinda alinan imza BASKA bir alan adinda tekrar kullanilabilir.
    it.each([
        ['domain', { domain: 'evil.com' }],
        ['timestamp', { timestamp: CTX.timestamp + 1 }],
        ['addressHash', { addressHash: new Uint8Array(32).fill(4) }],
        ['workchain', { workchain: -1 }],
    ])('%s degisince girdi DEGISIR', (_ad, degisiklik) => {
        const a = hex(buildSignDataInput(TEXT, CTX).bytes)
        const b = hex(buildSignDataInput(TEXT, { ...CTX, ...degisiklik }).bytes)
        expect(a).not.toBe(b)
    })

    it('icerik degisince girdi degisir', () => {
        const a = hex(buildSignDataInput(TEXT, CTX).bytes)
        const b = hex(buildSignDataInput({ type: 'text', text: 'Baska' }, CTX).bytes)
        expect(a).not.toBe(b)
    })

    it('bilinmeyen tip reddedilir (kod 1)', () => {
        const r = buildSignDataInput({ type: 'uydurma', text: 'x' }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
    })

    it('eksik alanlar reddedilir', () => {
        expect(buildSignDataInput({ type: 'text' }, CTX).ok).toBe(false)
        expect(buildSignDataInput({ type: 'binary' }, CTX).ok).toBe(false)
        expect(buildSignDataInput({ type: 'cell', cell: 'te6' }, CTX).ok).toBe(false)
        expect(buildSignDataInput(null, CTX).ok).toBe(false)
    })

    it('gecersiz base64 (binary) reddedilir', () => {
        expect(buildSignDataInput({ type: 'binary', bytes: '!!!' }, CTX).ok).toBe(false)
    })

    // Onceki tum testler yalniz ASCII icerik/domain kullaniyordu -- bu durumda
    // JS'in UTF-16 `.length`'i ile GERCEK utf-8 bayt sayisi HER ZAMAN esittir,
    // yani payload_len/domain_len alanini yanlislikla `.length` ile yazan bir
    // uygulama da YUKARIDAKI TUM testleri gecerdi (bagimsiz dogrulandi). Bu
    // testler ozellikle bu ariza sinifini hedefler: alanin GERCEK deger
    // BAYT'ini, sabit bir sayiyla PINleyerek dogrular.
    it('payload_len GERCEK utf-8 bayt sayisidir, JS .length DEGIL', () => {
        // 'ç','ö','ğ' UTF-8'de 2'ser bayt (6 bayt), '🚀' 4 bayt (surrogate
        // cift -- JS .length'te 2 birim sayilir) = TOPLAM 10 bayt, ama JS
        // .length 5'tir (3 + 2). Bu FARK testin butun amacidir.
        const nonAscii = 'çöğ🚀'
        expect(nonAscii.length).toBe(5) // JS .length -- YANLIS uygulama bunu yazardi
        expect(new TextEncoder().encode(nonAscii).length).toBe(10) // gercek utf-8 bayt

        const r = buildSignDataInput({ type: 'text', text: nonAscii }, CTX)
        expect(r.ok).toBe(true)

        const domainLen = readU32BE(r.bytes, DOMAIN_LEN_OFFSET)
        const payloadLenOffset = DOMAIN_LEN_OFFSET + 4 + domainLen + 8 + 3 // + domain + timestamp(8) + "txt"(3)
        const payloadLen = readU32BE(r.bytes, payloadLenOffset)
        // Sabit, elle hesaplanmis deger -- `.length` (5) yazilsaydi bu PATLARDI.
        expect(payloadLen).toBe(10)
    })

    it('domain_len GERCEK utf-8 bayt sayisidir, JS .length DEGIL', () => {
        // 'é' UTF-8'de 2 bayt, JS .length'te 1 birim -- "café.com" JS
        // .length=8 ama utf-8 bayt=9.
        const nonAsciiDomain = 'café.com'
        expect(nonAsciiDomain.length).toBe(8) // JS .length -- YANLIS uygulama bunu yazardi
        expect(new TextEncoder().encode(nonAsciiDomain).length).toBe(9) // gercek utf-8 bayt

        const r = buildSignDataInput(TEXT, { ...CTX, domain: nonAsciiDomain })
        expect(r.ok).toBe(true)

        const domainLen = readU32BE(r.bytes, DOMAIN_LEN_OFFSET)
        // Sabit, elle hesaplanmis deger -- `.length` (8) yazilsaydi bu PATLARDI.
        expect(domainLen).toBe(9)
    })

    it('gecersiz BOC (cell) reddedilir', () => {
        // Brief'teki placeholder DEGERI bunun icin gercek bir vaka: yarim/
        // gecersiz bir BOC sessizce kabul EDILMEMELI.
        const r = buildSignDataInput({ type: 'cell', schema: 'x', cell: 'te6ccgEB' }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
    })

    it('gecersiz baglam (eksik/bozuk ctx) reddedilir', () => {
        expect(buildSignDataInput(TEXT, null).ok).toBe(false)
        expect(buildSignDataInput(TEXT, { ...CTX, addressHash: new Uint8Array(31) }).ok).toBe(false)
        expect(buildSignDataInput(TEXT, { ...CTX, domain: '' }).ok).toBe(false)
        expect(buildSignDataInput(TEXT, { ...CTX, timestamp: -1 }).ok).toBe(false)
    })
})

// --- Resmi regresyon vektoru -------------------------------------------
//
// Yukaridaki testler yalnizca YAPISAL ozellikleri kilitler (tipler ayrisir,
// alanlar etkiler) -- YANLIS bir bayt duzeni de bu ozellikleri saglayabilir.
// Bu blok bunun yerine SOMUT bir kanit kullanir: KAYNAK 2'nin
// (github.com/mois-ilya/ton-sign-data-reference, src/__tests__/sign.test.ts,
// "regression tests with known signatures") deposunda sabit-kodlanan
// GERCEK bir mnemonic + adres + domain + timestamp + payload icin BEKLENEN
// ed25519 imzasini, buildSignDataInput'in ciktisini (text/binary icin
// sha256'layip, cell icin DOGRUDAN) imzalayarak yeniden uretir. Duzen tek bir
// bayt bile yanlissa imza ESLESMEZ -- yapisal testlerin aksine bu test YANLIS
// bir duzenle GECEMEZ.
describe('resmi regresyon vektoru (mois-ilya/ton-sign-data-reference)', () => {
    const TEST_MNEMONIC = [
        'unfold', 'item', 'school', 'little', 'upper', 'surge', 'pride', 'endorse',
        'outer', 'filter', 'biology', 'prefer', 'regular', 'island', 'hidden', 'dice',
        'nuclear', 'grace', 'motor', 'entire', 'weird', 'between', 'falcon', 'dwarf',
    ]
    const TEST_ADDRESS = 'UQCyqTmXJpshFu1GW1tyTX6paa3c-37OG9s3uv8ZzX_9GDfx'
    const parsedAddr = Address.parse(TEST_ADDRESS)
    const REF_CTX = {
        workchain: parsedAddr.workChain,
        addressHash: new Uint8Array(parsedAddr.hash),
        domain: 'example.com',
        timestamp: 1703980800,
    }

    async function signViaModule(payload) {
        const keyPair = await mnemonicToPrivateKey(TEST_MNEMONIC)
        const r = buildSignDataInput(payload, REF_CTX)
        expect(r.ok).toBe(true)
        // `prehashed` sozlesmesi: false ise (text/binary) `bytes` hash'in
        // ON-GORUNTUSU -- cagiran gibi sha256 uygula. true ise (cell) `bytes`
        // ZATEN nihai hash -- tekrar hashleme. Bu, sozlesmenin KENDISINI de
        // (r.type ile degil r.prehashed ile dallanarak) dogrular.
        const finalHash = r.prehashed
            ? r.bytes
            : crypto.createHash('sha256').update(r.bytes).digest()
        const sig = ed25519Sign(finalHash, keyPair.secretKey)
        return sig.toString('base64')
    }

    it('text: bilinen imzayla BIREBIR eslesir', async () => {
        const sig = await signViaModule({ type: 'text', text: 'Hello, TON!' })
        expect(sig).toBe('/34cktAUdWpCVgUfyXQlFtINRhdC9DRlshhMtOx1I9G2TDLV20xrHPxp9fvifz3EHZthCnSHN/IVF8zw7twNCw==')
    })

    it('binary: bilinen imzayla BIREBIR eslesir', async () => {
        const sig = await signViaModule({ type: 'binary', bytes: 'SGVsbG8sIFRPTiE=' })
        expect(sig).toBe('R7vQ6Zj2CYXJAa+ldLWgwPbJyR/58XrQV3HDw4yuqSYmR8PcoBpt5h1DOLX0LgxjOE3tieuwsDP6WwnCDkAECg==')
    })

    it('cell: bilinen imzayla BIREBIR eslesir', async () => {
        const sig = await signViaModule({
            type: 'cell',
            schema: 'message#_ text:string = Message;',
            cell: 'te6cckEBAQEAEQAAHgAAAABIZWxsbywgVE9OIb7WCx4=',
        })
        expect(sig).toBe('xULn8inA8A1qhFEFK8jpY+UEq7dHlpA/tm8LkxBBzRkZjTrni31H1p5Q+XMTS4I7HWsyC0i82teVdwc02lg4AQ==')
    })
})
