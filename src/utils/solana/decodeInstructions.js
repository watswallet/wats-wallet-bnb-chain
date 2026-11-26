import './bufferGlobal.js'
import { TOKEN_PROGRAM_ID } from './constants'
import { base58Encode } from './base58'
import { gorunurKil } from './visibleText'

/**
 * Talimat cozucu -- SAF katman, AG YOK.
 *
 * DURUSTLUK KURALI (§5.2, K5): cozemedigimiz her sey `type: null` doner.
 * Bir ad UYDURMAK, kullaniciyi gercekte onaylamadigi bir seye ikna etmek olur.
 * Ekran bu durumda "cuzdan bu talimati okuyamiyor" der ve baytlarin SHA-256'sini
 * gosterir.
 */

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111'
export const MEMO_V1_PROGRAM_ID = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'
export const MEMO_V2_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

// Memo metni ekrana en cok bu kadar KOD NOKTASI ile cikar (dapp kontrolundeki
// metin: uzunluk sinirsiz olursa gercek icerik ekranin disina itilir).
const MEMO_MAX_CODE_POINTS = 140
const U64_MAX = '18446744073709551615'

/**
 * Solana'nin sinirsiz-allowance karsiligi ve en yaygin drainer talimatlari.
 * Kume ACIKCA sayilir: "tehlikeli gorunen her sey" gibi bir sezgi, yarin
 * eklenecek zararsiz bir talimati da kirmizi yapardi (uyari korlugu).
 */
export const RED_FLAG_INSTRUCTIONS = new Set(['Approve', 'ApproveChecked', 'SetAuthority', 'CloseAccount'])

// Assign/AssignWithSeed ADLAR kumesine GIRMEZ (kume tam dort ad olarak kilitli):
// bunlar yalnizca baglama gore kirmizidir (riskOf). UI anahtari
// `redFlag_<type>` dinamik oldugu icin her iki ad da i18n'de bulunmak zorundadir.
const CONTEXTUAL_RED_TYPES = new Set([
    'Assign', 'AssignWithSeed',
    // V4-4: adli ama ekran satiri/risk karsiligi olmayan System talimatlari.
    // Allocate kullanici hesabinda veri uzunlugunu degistirip hesabi
    // hapsedebilir (zincir ustu etkisi OLCULMEDI, fail-closed secildi);
    // AuthorizeNonceAccount nonce yetkisini devreder.
    'Allocate', 'AllocateWithSeed', 'AuthorizeNonceAccount',
])

// UI `redFlag_<type>` anahtarini dinamik uretir: riskOf'un true donebilecegi
// BUTUN tip adlari (i18n parite testi bunu sayar).
export const REDFLAG_UI_TYPES = Object.freeze([...RED_FLAG_INSTRUCTIONS, ...CONTEXTUAL_RED_TYPES])

const SYSTEM_TYPES = {
    0: 'CreateAccount', 1: 'Assign', 2: 'Transfer', 3: 'CreateAccountWithSeed',
    4: 'AdvanceNonceAccount', 5: 'WithdrawNonceAccount', 6: 'InitializeNonceAccount',
    7: 'AuthorizeNonceAccount', 8: 'Allocate', 9: 'AllocateWithSeed',
    10: 'AssignWithSeed', 11: 'TransferWithSeed', 12: 'UpgradeNonceAccount',
}

const TOKEN_TYPES = {
    0: 'InitializeMint', 1: 'InitializeAccount', 3: 'Transfer', 4: 'Approve',
    5: 'Revoke', 6: 'SetAuthority', 7: 'MintTo', 8: 'Burn', 9: 'CloseAccount',
    10: 'FreezeAccount', 11: 'ThawAccount', 12: 'TransferChecked',
    13: 'ApproveChecked', 14: 'MintToChecked', 15: 'BurnChecked', 16: 'InitializeAccount2',
    17: 'SyncNative', 18: 'InitializeAccount3', 22: 'InitializeImmutableOwner',
}

const COMPUTE_BUDGET_TYPES = {
    1: 'RequestHeapFrame', 2: 'SetComputeUnitLimit',
    3: 'SetComputeUnitPrice', 4: 'SetLoadedAccountsDataSizeLimit',
}

const ATA_TYPES = { 0: 'Create', 1: 'CreateIdempotent', 2: 'RecoverNested' }

function readU32LE(data, offset) {
    if (!data || data.length < offset + 4) return null
    return ((data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0)
}

// u64 BigInt ile okunur ve DIZGE olarak tasinir: Number 2^53'un ustunde
// hassasiyet kaybeder ve ekranda kullanicinin hic onaylamadigi bir tutar
// gorunurdu (buildTransferPlan.js'nin kapattigi AYNI sinif hata).
function readU64LE(data, offset) {
    if (!data || data.length < offset + 8) return null
    let value = 0n
    for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(data[offset + i])
    return value.toString()
}

// 32 baytlik adres (kirpik veri -> null: kirpik baytlardan adres UYDURULMAZ).
function readPubkey(data, offset) {
    if (!data || data.length < offset + 32) return null
    return base58Encode(data.slice(offset, offset + 32))
}

// Seed alani bincode `String`: u64 uzunluk + bayt. Donus: seed'in bittigi konum
// ya da (uzunluk okunamadi / seed kirpik) null. Uzunluk BigInt ile okunur:
// 2^53 ustu bir deger Number'a cevrilince yanlis konuma atlatirdi.
function seedEnd(data, offset) {
    const len = readU64LE(data, offset)
    if (len === null) return null
    const end = BigInt(offset + 8) + BigInt(len)
    return end <= BigInt(data.length) ? Number(end) : null
}

function toHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Talimatlari surumden BAGIMSIZ tek bir sekle indirger. */
function rawInstructions(parsed, lookups) {
    if (parsed.version === 'legacy') {
        return parsed.tx.instructions.map((ix) => ({
            programId: ix.programId.toBase58(),
            accounts: ix.keys.map((k) => k.pubkey.toBase58()),
            data: Uint8Array.from(ix.data),
        }))
    }

    const message = parsed.tx.message
    const providedWritable = lookups?.writable || []
    const providedReadonly = lookups?.readonly || []
    // web3.js'in MessageV0#getAccountKeys'i (lib/index.cjs.js:941) TAM OLARAK bu
    // sayimi yapar ve uyusmazlikta FIRLATIR (review K1). Bu modul HICBIR ZAMAN
    // firlatmaz -- Task 28'in uc-ad kilidini bir dorduncu hata adiyla kirmayiz --
    // o yuzden ayni sayimi burada TEKRARLAYIP uyusmazlikta lookup araligini
    // TAMAMEN cozulmemis birakiyoruz. Kismi/eksik bir tablo (bir kaynak
    // cozulemedi, siralama farkli) her sonraki indeksi bir konum kaydirir ve
    // `all[i]` BASKA bir hesabin GERCEK adresini dondururdu -- "cozemedigimizde
    // asla uydurmayiz" kuralinin en tehlikeli ihlal sekli: ekranda GECERLI
    // gorunen ama YANLIS bir adres.
    const lookupsMatch = message.numAccountKeysFromLookups === providedWritable.length + providedReadonly.length
    // web3.js'in kendi siralamasi: once statik anahtarlar, sonra TUM tablolarin
    // YAZILABILIR indeksleri, en sonda SALT OKUNUR indeksleri. Bu sira degisirse
    // ekranda YANLIS adres gorunur, bu yuzden aynen kopyalanir.
    const all = [
        ...message.staticAccountKeys.map((k) => k.toBase58()),
        ...(lookupsMatch ? providedWritable : []),
        ...(lookupsMatch ? providedReadonly : []),
    ]
    return message.compiledInstructions.map((ix) => ({
        programId: message.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? null,
        // Cozulemeyen indeks NULL kalir -- ALT cozumlemesi ag cagrisidir ve
        // onay penceresi ICINDE yapilir (§5.2); burada asla UYDURULMAZ.
        accounts: ix.accountKeyIndexes.map((i) => all[i] ?? null),
        data: Uint8Array.from(ix.data),
    }))
}

/**
 * SystemProgram talimat alanlari. Duzen: bincode, u32 LE ayirici + alanlar.
 * Okunamayan/kirpik her alan NULL kalir (uydurma yok); `*WithSeed` talimatlarinda
 * seed (u64 uzunluk + bayt) kirpiksa SONRAKI alanlarin konumu bilinemez, hepsi null.
 */
function describeSystemFields(type, raw) {
    const d = raw.data
    if (type === 'Transfer') return { lamports: readU64LE(d, 4) }
    if (type === 'TransferWithSeed') {
        // [11][lamports u64][seed: u64 uzunluk + bayt][owner 32]
        const end = seedEnd(d, 12)
        const butun = end !== null && d.length >= end + 32
        return {
            lamports: butun ? readU64LE(d, 4) : null,
            destination: raw.accounts[2] ?? null,
        }
    }
    if (type === 'CreateAccount') {
        // [0][lamports u64][space u64][owner 32]
        return { lamports: readU64LE(d, 4), space: readU64LE(d, 12), owner: readPubkey(d, 20) }
    }
    if (type === 'CreateAccountWithSeed') {
        // [3][base 32][seed: u64 uzunluk + bayt][lamports u64][space u64][owner 32]
        const end = seedEnd(d, 36)
        if (end === null) return { lamports: null, space: null, owner: null }
        return { lamports: readU64LE(d, end), space: readU64LE(d, end + 8), owner: readPubkey(d, end + 16) }
    }
    if (type === 'WithdrawNonceAccount') return { lamports: readU64LE(d, 4) }
    if (type === 'Assign') return { owner: readPubkey(d, 4) }
    if (type === 'AssignWithSeed') {
        // [10][base 32][seed: u64 uzunluk + bayt][owner 32]
        const end = seedEnd(d, 36)
        return { owner: end === null ? null : readPubkey(d, end) }
    }
    if (type === 'AdvanceNonceAccount') return { durableNonce: true }
    return {}
}

/**
 * Memo (v1/v2): veri govdesi dogrudan UTF-8 metindir. Gecersiz UTF-8 -> metin
 * UYDURULMAZ (memoUnreadable). Metin dapp kontrolundedir: once kod noktasi
 * sinirinda kirpilir (gorunurKil'in etiketini ORTADAN bolmemek icin kirpma
 * ONCE), sonra gorunmez/yon karakterleri etiketlenir. Karar girdisi DEGILDIR.
 */
function describeMemoFields(raw) {
    let text
    try {
        // ignoreBOM: true SART (final SU-2) -- varsayilan cozucu bastaki BOM'u (EF BB BF)
        // SESSIZCE siler; ekran zincirdeki Memo'dan 3 bayt eksik metin gosterirdi.
        // Tutulan BOM gorunurKil'de [U+FEFF] olarak isaretlenir.
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw.data)
    } catch {
        return { memoText: null, memoUnreadable: true, memoTruncated: false }
    }
    const points = Array.from(text)
    const memoTruncated = points.length > MEMO_MAX_CODE_POINTS
    const kirpik = memoTruncated ? points.slice(0, MEMO_MAX_CODE_POINTS).join('') : text
    return { memoText: gorunurKil(kirpik), memoUnreadable: false, memoTruncated }
}

/**
 * Program'a gore { program, type, fields } uretir -- redFlag BURADA YOK.
 * Kirmizi bayrak TUM programlar icin decodeOne'da TEK yerde hesaplanir (review
 * K4): yalnizca token dalinda kontrol etmek, yarin baska bir programa (orn.
 * SystemProgram'in AuthorizeNonceAccount'u) RED_FLAG_INSTRUCTIONS'a eklenecek
 * bir ad geldiginde SESSIZCE calismayan bir bayrak yaratirdi.
 */
function describeInstruction(raw) {
    if (raw.programId === SYSTEM_PROGRAM_ID) {
        const type = SYSTEM_TYPES[readU32LE(raw.data, 0)] ?? null
        return { program: 'system', type, fields: describeSystemFields(type, raw) }
    }

    if (raw.programId === TOKEN_PROGRAM_ID || raw.programId === TOKEN_2022_PROGRAM_ID) {
        const type = TOKEN_TYPES[raw.data[0]] ?? null
        // Token ve Token-2022 AYRI etiketlenir: Token-2022'de transfer ucreti/hook
        // olabilir, tutar nominaldir (ekran bunu ayri not eder).
        const fields = { tokenProgram: raw.programId === TOKEN_2022_PROGRAM_ID ? 'Token-2022' : 'Token' }
        if (type === 'Transfer' || type === 'Approve' || type === 'MintTo' || type === 'Burn') {
            fields.amount = readU64LE(raw.data, 1)
        }
        if (type === 'TransferChecked' || type === 'ApproveChecked'
            || type === 'MintToChecked' || type === 'BurnChecked') {
            fields.amount = readU64LE(raw.data, 1)
            fields.decimals = raw.data[9] ?? null
        }
        // Approve/ApproveChecked'te delegate FARKLI hesap indeksindedir:
        // ApproveChecked'in Approve'tan bir fazla hesabi (mint) vardir, delegate
        // bir konum kayar. Gercek createApproveInstruction/createApproveCheckedInstruction
        // ciktisiyla dogrulandi (bkz. task-27-report.md fix bolumu).
        if (type === 'Approve') fields.delegate = raw.accounts[1] ?? null
        if (type === 'ApproveChecked') fields.delegate = raw.accounts[2] ?? null
        // Sinirsiz izin: miktar tam 2^64-1 (u64 azami). Miktar okunamadiysa
        // (kirpik) riskOf zaten fail-closed (miktar '0' degil).
        if (type === 'Approve' || type === 'ApproveChecked') fields.unlimited = fields.amount === U64_MAX
        // InitializeAccount hesaplari: [hesap, mint, sahip, rent]; 2 ve 3'te sahip
        // hesap listesinde DEGIL veri govdesindedir ([16|18][sahip 32]); hesaplar
        // [hesap, mint, (rent)]. Sahip okunmazsa (kirpik) null: UYDURULMAZ.
        if (type === 'InitializeAccount') {
            fields.mint = raw.accounts[1] ?? null
            fields.owner = raw.accounts[2] ?? null
        }
        if (type === 'InitializeAccount2' || type === 'InitializeAccount3') {
            fields.mint = raw.accounts[1] ?? null
            fields.owner = readPubkey(raw.data, 1)
        }
        // CloseAccount hesaplari: [kapatilan, kira alicisi, sahip]
        if (type === 'CloseAccount') fields.rentTo = raw.accounts[1] ?? null
        if (type === 'SetAuthority') {
            // Veri govdesi: [6 (ayirici), authorityType, option(0|1), 32 bayt?].
            // Gercek encoder ciktisiyla dogrulandi (bkz. task-27-report.md).
            fields.authorityType = raw.data[1] ?? null
            // Option bayti (data[2]) 1 ise yeni yetkili GERCEKTEN 32 bayt olarak
            // vardir; 0 ise Revoke'tur (yetkili kaldirilir). Bayt sayisi 35'ten
            // AZSA (kirpilmis/kotu niyetli talimat) 32 baytin tumu yoktur --
            // KIRPILMIS baytlardan bir adres UYDURMAK, "cozemedigimizde asla
            // uydurmayiz" kuralini bu modulun en kritik alaninda ihlal ederdi.
            fields.newAuthority = (raw.data[2] === 1 && raw.data.length >= 35)
                ? base58Encode(raw.data.slice(3, 35))
                : null
            // Yetkiyi KALDIRMA (option 0) ile KIRPIK/bozuk veriyi ayirt etmek
            // icin: yalniz acik option===0 "kaldirma"dir. newAuthority null tek
            // basina bunu soylemez (kirpik option=1 veri de null verir).
            fields.removesAuthority = raw.data.length >= 3 && raw.data[2] === 0
        }
        return { program: 'token', type, fields }
    }

    if (raw.programId === ASSOCIATED_TOKEN_PROGRAM_ID) {
        // ATA programinda BOS veri "Create" demektir; ayirici yalnizca 1 ve 2 icin var.
        const type = raw.data.length === 0 ? 'Create' : (ATA_TYPES[raw.data[0]] ?? null)
        return { program: 'ata', type, fields: {} }
    }

    if (raw.programId === COMPUTE_BUDGET_PROGRAM_ID) {
        const type = COMPUTE_BUDGET_TYPES[raw.data[0]] ?? null
        const fields = {}
        if (type === 'SetComputeUnitLimit') fields.units = readU32LE(raw.data, 1)
        if (type === 'SetComputeUnitPrice') fields.microLamports = readU64LE(raw.data, 1)
        return { program: 'computeBudget', type, fields }
    }

    if (raw.programId === MEMO_V1_PROGRAM_ID || raw.programId === MEMO_V2_PROGRAM_ID) {
        return { program: 'memo', type: 'Memo', fields: describeMemoFields(raw) }
    }

    return { program: 'unknown', type: null, fields: {} }
}

// Kullanici adresi ham dize olarak karsilastirilir: base58 buyuk/kucuk harf
// duyarlidir, toLowerCase YOK. PublicKey verilirse dizeye cevrilir.
function userAddress(user) {
    if (user && typeof user === 'object' && typeof user.toBase58 === 'function') return user.toBase58()
    return typeof user === 'string' && user !== '' ? user : null
}

/**
 * Bir talimatin BAGLAMLI kirmizi bayragi. `ix` decodeInstructions ogesidir
 * ({type, accounts, fields}).
 *
 * FAIL-CLOSED: `user` verilmezse (ya da bos) baglam sorulamaz -> kirmizi adlar
 * ve Assign'lar kirmizi kalir; bir hesap cozulemediyse (null) de kirmizidir.
 * Bayrak kasitli olarak GENIS degil: her takasta kirmizi basmak uyari korlugu
 * yaratir, bu yuzden kullanicinin kendi islemleri (kira kendine, sifir izin,
 * yetkiyi kaldirma, bu islemde yaratilan hesaba Assign) kirmizi degildir.
 *
 * Kume danisma kurali: RED_FLAG_INSTRUCTIONS her talimat icin TAM BIR kez
 * sorulur (yarin eklenecek bir ad sessizce bayraksiz kalmasin; spy testi kilitli).
 *
 * @param {{type: string|null, accounts?: Array<string|null>, fields?: object}} ix
 * @param {{user?: string|object|null, createdInTx?: Set<string>}} [ctx]
 * @returns {boolean}
 */
export function riskOf(ix, { user, createdInTx } = {}) {
    const kirmiziAd = RED_FLAG_INSTRUCTIONS.has(ix.type)
    if (!kirmiziAd && !CONTEXTUAL_RED_TYPES.has(ix.type)) return false

    const me = userAddress(user)
    if (me === null) return true // baglam yok -> fail-closed

    const accounts = ix.accounts || []
    const fields = ix.fields || {}

    switch (ix.type) {
        case 'CloseAccount':
            // kira kullaniciya donuyorsa kirmizi degil (Jupiter wSOL); cozulemeyen
            // ya da baska hedef kirmizi.
            return accounts[1] == null || accounts[1] !== me
        case 'Approve':
        case 'ApproveChecked':
            // miktar 0 = izni SIFIRLAMA (kirmizi degil); okunamayan miktar kirmizi.
            return fields.amount !== '0'
        case 'SetAuthority':
            // yalniz acik "yetkiyi kaldir" (option 0) kirmizi degil; kirpik/bozuk
            // veri fail-closed.
            return fields.removesAuthority !== true
        case 'Assign':
        case 'AssignWithSeed':
        case 'Allocate':
        case 'AllocateWithSeed':
        case 'AuthorizeNonceAccount': {
            const hedef = accounts[0]
            if (hedef == null) return true
            // SIRA ONEMLI (S4-S4-1): kullanicinin KENDI adresi, createdInTx'te olsa
            // bile ASLA muaf degildir. Mesru akista kullanicinin ana adresi hicbir
            // zaman CreateAccount hedefi olmaz (hedef yeni anahtar cifti); bu
            // kontrol muafiyetten ONCE gelmezse CreateAccount(hedef=kullanici) +
            // Assign(kullanici) cifti iki talimati da kirmizisiz gecerdi.
            if (hedef === me) return true
            // Bu islemde yaratilan yeni hesaba islem serbest.
            if (createdInTx && createdInTx.has(hedef)) return false
            // Nonce yetkisini devretmek, yaratilmamis (mevcut) hesapta HER ZAMAN
            // kirmizi (yetkili kullanici mi baskasi mi okunmaz).
            if (ix.type === 'AuthorizeNonceAccount') return true
            // Seed'li turevlerde taban anahtari kullanici ise (turetilmis ama bu
            // islemde yaratilmamis hesap; sahipligi/boyutu onun yetkisiyle degisir).
            return (ix.type === 'AssignWithSeed' || ix.type === 'AllocateWithSeed') && accounts[1] === me
        }
        default:
            return true
    }
}

// Bu islemde yaratilan hesaplar (CreateAccount/CreateAccountWithSeed'in hedefi,
// hesap indeksi 1). Liste duzeyinde ON-GECISLE toplanir: Assign yaratmadan once
// gelse de ayni islemin yeni hesabidir.
function collectCreatedAccounts(raws, user) {
    const me = userAddress(user)
    const created = new Set()
    for (const raw of raws) {
        if (raw.programId !== SYSTEM_PROGRAM_ID) continue
        const t = SYSTEM_TYPES[readU32LE(raw.data, 0)]
        // Kullanicinin kendi adresi "yeni yaratilan hesap" SAYILMAZ (S4-S4-1).
        if ((t === 'CreateAccount' || t === 'CreateAccountWithSeed') && raw.accounts[1] && raw.accounts[1] !== me) {
            created.add(raw.accounts[1])
        }
    }
    return created
}

// decodeOne tek basina cagrilirsa createdInTx bos kume sayilir.
function decodeOne(raw, index, ctx = {}) {
    const { program, type, fields } = describeInstruction(raw)
    const ix = { index, programId: raw.programId, accounts: raw.accounts, program, type, fields }
    return {
        ...ix,
        dataHex: toHex(raw.data),
        redFlag: riskOf(ix, { user: ctx.user, createdInTx: ctx.createdInTx ?? new Set() }),
    }
}

/**
 * @param {object} parsed parseDappTransaction ciktisi
 * @param {{lookups?: {writable: string[], readonly: string[]}, user?: string}} opts
 *   `user`: onaylayan hesabin adresi; yoksa baglamli bayrak FAIL-CLOSED (riskOf).
 * @returns {Array<{index, programId, program, type, redFlag, accounts, fields, dataHex}>}
 */
export function decodeInstructions(parsed, { lookups, user } = {}) {
    if (!parsed || !parsed.tx) return []
    const raws = rawInstructions(parsed, lookups)
    const createdInTx = collectCreatedAccounts(raws, user)
    return raws.map((raw, index) => decodeOne(raw, index, { user, createdInTx }))
}

/**
 * ComputeBudget'tan OKUNAN degerler. Cuzdan bu talimatlari ASLA degistirmez ve
 * kendisi de eklemez (§5.2): dapp'in isleminin butcesini oynatmak, islemi
 * gecersiz kilar ya da dapp'in hesapladigi ucreti bozar.
 */
export function computeBudgetSummary(decoded) {
    let unitLimit = null
    let unitPriceMicroLamports = null
    for (const ix of decoded || []) {
        if (ix.type === 'SetComputeUnitLimit') unitLimit = ix.fields.units ?? null
        if (ix.type === 'SetComputeUnitPrice') unitPriceMicroLamports = ix.fields.microLamports ?? null
    }
    return { unitLimit, unitPriceMicroLamports }
}

export function hasRedFlag(decoded) {
    return (decoded || []).some((ix) => ix.redFlag === true)
}
