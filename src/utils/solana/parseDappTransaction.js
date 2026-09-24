// parseDappTransaction.js -- ILK SATIR bufferGlobal olmak ZORUNDA: Task 19 bu
// dosyaya @solana import ETMIYORDU, bu gorev ediyor. @solana/web3.js modul
// degerlendirmesinde serbest `Buffer` global'ini okur ve MV3 service
// worker'inda oyle bir global YOKTUR.
import './bufferGlobal.js'
import { Transaction, VersionedTransaction } from '@solana/web3.js'

// Dapp'ten gelen HAM baytlarin "bu bir Solana islemi mi" sezgisi -- SAF katman.
//
// KOK NEDEN (spec 4.3.1 kapi 6): Solana'nin en bilinen signMessage saldirisi,
// kullaniciya duz metin susu verilmis bir ISLEMI kor imzalatmaktir. Imzalanan
// 64 bayt daha sonra gercek bir islem olarak zincire yayinlanabilir. Bu yuzden
// signMessage/signIn yukleri, ONAY PENCERESI ACILMADAN once bu sezgiden gecer.
//
// Sezgi wire bicimini okur: [compact-u16 imza sayisi][64*n imza][mesaj]. Mesaj
// v0 ise 0x80|surum bayti ile baslar, ardindan 3 baytlik baslik
// (numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned), compact-u16
// hesap sayisi, 32*k hesap anahtari ve 32 baytlik blockhash gelir. Tek basina
// ilk bayta bakmak YETMEZ: 'A' harfiyle (0x41) baslayan bir metin de "65 imza"
// gibi okunur -- uzunluk ve baslik tutarliligi BIRLIKTE dogrulanir.
const SIGNATURE_BYTES = 64
const PUBKEY_BYTES = 32
const BLOCKHASH_BYTES = 32
// compact-u16'nin tek baytlik alani; ustu cok baytlik kodlamadir ve gercek bir
// islemde ne imza ne de hesap sayisi oraya ulasir.
const COMPACT_U16_MAX_SINGLE_BYTE = 0x7f
// Islem en az bir imza yuvasi tasir (imzasiz serilestirmede bile yuva SIFIRLARLA
// doludur); ust sinir islem boyutundan (1232 bayt) gelen kaba bir tavandir.
const MIN_SIGNATURES = 1
const MAX_SIGNATURES = 19
const VERSION_FLAG = 0x80

/**
 * Baytlar bir Solana islemi gibi mi duruyor?
 *
 * YANLIS POZITIF, kullanicinin mesru signMessage cagrisini reddeder; YANLIS
 * NEGATIF ise kor imzalama saldirisini gecirir. Esik bu yuzden "kesin islem"
 * tarafinda tutulur: butun uzunluk kontrolleri saglanmadikca false doner.
 *
 * @param {unknown} bytes
 * @returns {boolean}
 */
export function looksLikeTransaction(bytes) {
    if (!(bytes instanceof Uint8Array)) return false
    // ACIK ALT SINIR (gercek asgari DEGIL): hesap anahtarlari sayilmadan 101
    // bayt -- 1 (imza sayisi) + 64 (imza) + 3 baslik + 1 hesap sayisi + 32
    // blockhash. Gercek bir islemde en az bir hesap anahtari (32 bayt/tane)
    // daha gelir; asagidaki hesap-sayisi kontrolu (accountKeyCount) gercek
    // uzunlugu AYRICA dogrular. Bu satir olmadan bos/kisa girdi yalnizca
    // KAZARA reddedilir: bytes[0] undefined olur, `cursor` NaN'a doner ve son
    // satirdaki `bytes.length >= NaN + 32` false verir. Asagidaki kontrollerin
    // sirasi bir gun degisirse bos yuk "islem gibi" gorunur ve mesru
    // signMessage cagrilari SOLANA_MESSAGE_LOOKS_LIKE_TX ile reddedilmeye
    // baslar.
    if (bytes.length < 1 + SIGNATURE_BYTES + 4 + BLOCKHASH_BYTES) return false

    const signatureCount = bytes[0]
    if (signatureCount < MIN_SIGNATURES || signatureCount > MAX_SIGNATURES) return false

    let cursor = 1 + signatureCount * SIGNATURE_BYTES
    if (cursor >= bytes.length) return false

    // v0 mesaji 0x80|surum ile baslar. Surum biti varken alt yedi bit 0 degilse
    // desteklenen bir surum degildir -- o halde bu baytlar islem olarak zaten
    // yorumlanamaz. UYARI: bu FAIL-OPEN bir varsayimdir -- Solana'da v1
    // tanimlanirsa (bugun yok) bu satir fail-closed yone cevrilmeli, aksi
    // halde v1 baytlari "islem degil" sayilip kor imzalama korumasini
    // (spec 4.3.1 kapi 6) atlatabilir.
    const versionByte = bytes[cursor]
    if ((versionByte & VERSION_FLAG) !== 0) {
        if ((versionByte & COMPACT_U16_MAX_SINGLE_BYTE) !== 0) return false
        cursor += 1
    }

    if (cursor + 3 >= bytes.length) return false
    const numRequiredSignatures = bytes[cursor]
    const numReadonlySigned = bytes[cursor + 1]
    const numReadonlyUnsigned = bytes[cursor + 2]
    // Basligin imza sayisi, ONDEKI imza yuvasi sayisiyla ayni olmak ZORUNDADIR;
    // metin baytlarinda bu iki bagimsiz konumun tutmasi neredeyse imkansizdir.
    if (numRequiredSignatures !== signatureCount) return false
    if (numReadonlySigned > numRequiredSignatures) return false

    const accountKeyCount = bytes[cursor + 3]
    if (accountKeyCount > COMPACT_U16_MAX_SINGLE_BYTE) return false
    if (accountKeyCount < numRequiredSignatures + numReadonlyUnsigned) return false

    const afterAccountKeys = cursor + 4 + accountKeyCount * PUBKEY_BYTES
    return bytes.length >= afterAccountKeys + BLOCKHASH_BYTES
}

const SIGNATURE_LENGTH = 64
// SystemProgram kimligi burada METIN olarak duruyor: bu dosya ayristirmaya
// hizmet ediyor ve karsilastirma zaten base58 metin uzerinden yapiliyor.
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
// SystemInstruction enum'unda AdvanceNonceAccount 4'tur (u32, little-endian).
const ADVANCE_NONCE_ACCOUNT = 4
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * base64 -> bayt. `Buffer.from(x, 'base64')` gecersiz karakterleri SESSIZCE
 * ATAR: 'bu base64 degil !!!' bos olmayan, anlamsiz bir tampon uretir ve hata
 * asagida cok daha bulanik bir yerde patlardi. Bicim ONCE dogrulanir.
 */
function base64ToBytes(base64) {
    if (typeof base64 !== 'string' || base64.length === 0) throw new Error('TX_DESERIALIZE_FAILED')
    if (!BASE64_PATTERN.test(base64)) throw new Error('TX_DESERIALIZE_FAILED')
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
    if (bytes.length === 0) throw new Error('TX_DESERIALIZE_FAILED')
    return bytes
}

/** compact-u16 (shortvec) okuyucu -- islem tel biciminin uzunluk kodlamasi. */
function readShortVec(bytes, offset) {
    let value = 0
    let size = 0
    for (;;) {
        const byte = bytes[offset + size]
        if (byte === undefined) throw new Error('TX_DESERIALIZE_FAILED')
        value |= (byte & 0x7f) << (size * 7)
        size += 1
        if ((byte & 0x80) === 0) break
        // shortvec en fazla 3 bayttir; daha uzunu bozuk girdidir.
        if (size > 3) throw new Error('TX_DESERIALIZE_FAILED')
    }
    return { value, size }
}

/**
 * Surum, DESERIALIZE DENEMESIYLE DEGIL bayttan okunur.
 *
 * "once Transaction.from, olmazsa VersionedTransaction" sirasi bozuk bir legacy
 * islemi v0 sanardi; ters sira ise v1'i "cozulemedi" diye raporlardi. Ikisi de
 * kullaniciya YANLIS teshis gosterir. VERSION_PREFIX_MASK 0x7f'tir: mesajin ilk
 * baytinda ust bit KAPALIYSA mesaj legacy'dir, ACIKSA kalan 7 bit surumdur.
 */
function readVersion(bytes) {
    const { value: signatureCount, size } = readShortVec(bytes, 0)
    const prefix = bytes[size + signatureCount * SIGNATURE_LENGTH]
    if (prefix === undefined) throw new Error('TX_DESERIALIZE_FAILED')
    if ((prefix & 0x80) === 0) return 'legacy'
    return prefix & 0x7f
}

/**
 * K1 review bulgusu: `tx.signatures` DIZISININ uzunluguna GUVENILEMEZ.
 * `Transaction.populate` (web3.js) o diziyi TEL'deki imza yuvasi sayisi kadar
 * (shortvec, dapp kontrolunde) uretir -- mesaj basligindaki
 * numRequiredSignatures ile CAPRAZ KONTROL ETMEDEN. Sahte bir tel ikinci imza
 * yuvasini silip sayaci dusurebilir; mesaj (ve basligi) DEGISMEDEN kalir ve
 * ikinci zorunlu imzaci `tx.signatures`te hic GORUNMEZ. Zorunlu imzacilar bu
 * yuzden `versionedSigners` ile AYNI desende, mesaj basligindan ve hesap
 * anahtarlarindan turetilir -- `looksLikeTransaction` (satir 75) ZATEN ayni
 * tutarsizligi bu yuzden reddediyor.
 */
function legacySigners(tx) {
    const message = tx.compileMessage()
    const count = message.header.numRequiredSignatures
    const requiredSigners = []
    const missingCosigners = []
    for (let i = 0; i < count; i += 1) {
        const key = message.accountKeys[i]
        if (!key) throw new Error('TX_DESERIALIZE_FAILED')
        const address = key.toBase58()
        requiredSigners.push(address)
        // Tel'de bu indekse karsilik gelen yuva yoksa (forge edilmis kisa
        // sayac) imza YOK sayilir -- bu TAM OLARAK gizlenmeye calisilan durum.
        const entry = tx.signatures[i]
        if (!entry || !entry.signature) missingCosigners.push(address)
    }
    return { requiredSigners, missingCosigners }
}

function versionedSigners(tx) {
    const count = tx.message.header.numRequiredSignatures
    const requiredSigners = []
    const missingCosigners = []
    for (let i = 0; i < count; i += 1) {
        const key = tx.message.staticAccountKeys[i]
        if (!key) throw new Error('TX_DESERIALIZE_FAILED')
        const address = key.toBase58()
        requiredSigners.push(address)
        // v0'da imza yuvasi HER ZAMAN doludur; imzasiz olan SIFIR baytlardir.
        const signature = tx.signatures[i]
        if (!signature || signature.every((b) => b === 0)) missingCosigners.push(address)
    }
    return { requiredSigners, missingCosigners }
}

/** Ilk talimatin { programId, data } ikilisi -- iki surumde de AYNI sekilde. */
function firstInstruction(tx, version) {
    if (version === 'legacy') {
        const ix = tx.instructions[0]
        return ix ? { programId: ix.programId.toBase58(), data: Uint8Array.from(ix.data) } : null
    }
    const ix = tx.message.compiledInstructions[0]
    if (!ix) return null
    // Program kimligi HER ZAMAN statik anahtardir (ALT'tan gelemez).
    const key = tx.message.staticAccountKeys[ix.programIdIndex]
    if (!key) return null
    return { programId: key.toBase58(), data: Uint8Array.from(ix.data) }
}

function readUint32LE(data) {
    if (!data || data.length < 4) return null
    return ((data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0)
}

/**
 * Dapp'in verdigi base64 islemi cozer -- SAF katman, AG YOK.
 *
 * `missingCosigners` "BIZIM disimizdaki eksikler" DEGIL, imzasi olmayan TUM
 * zorunlu imzacilardir: bu modul hangi anahtarin bizim oldugumuzu BILMEZ ve
 * bilmemelidir. Cikarma islemini cagiran yapar (§4.3.1 kapi 8).
 */
export function parseDappTransaction(base64Tx) {
    const bytes = base64ToBytes(base64Tx)
    const version = readVersion(bytes)
    if (version !== 'legacy' && version !== 0) throw new Error('UNSUPPORTED_TX_VERSION')

    let tx
    try {
        tx = version === 'legacy' ? Transaction.from(bytes) : VersionedTransaction.deserialize(bytes)
    } catch (e) {
        throw new Error('TX_DESERIALIZE_FAILED')
    }

    const { requiredSigners, missingCosigners } = version === 'legacy'
        ? legacySigners(tx)
        : versionedSigners(tx)

    const first = firstInstruction(tx, version)

    return {
        version,
        tx,
        // Ucret odeyen HER ZAMAN ilk zorunlu imzacidir (Solana mesaj bicimi).
        feePayer: requiredSigners[0] ?? null,
        requiredSigners,
        missingCosigners,
        firstProgramId: first ? first.programId : null,
        // §6.5: durable nonce'ta blockhash alani bir NONCE degeridir ve
        // isBlockhashValid onu HER ZAMAN gecersiz raporlar -- tazelik kontrolu
        // atlanmali. Isareti burada, ayristirma aninda uretiyoruz.
        isDurableNonce: !!first
            && first.programId === SYSTEM_PROGRAM_ID
            && readUint32LE(first.data) === ADVANCE_NONCE_ACCOUNT,
    }
}
