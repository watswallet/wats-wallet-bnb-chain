import './bufferGlobal.js'
import { TOKEN_PROGRAM_ID } from './constants'
import { base58Encode } from './base58'

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

/**
 * Solana'nin sinirsiz-allowance karsiligi ve en yaygin drainer talimatlari.
 * Kume ACIKCA sayilir: "tehlikeli gorunen her sey" gibi bir sezgi, yarin
 * eklenecek zararsiz bir talimati da kirmizi yapardi (uyari korlugu).
 */
export const RED_FLAG_INSTRUCTIONS = new Set(['Approve', 'ApproveChecked', 'SetAuthority', 'CloseAccount'])

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
    13: 'ApproveChecked', 14: 'MintToChecked', 15: 'BurnChecked', 17: 'SyncNative',
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
 * Program'a gore { program, type, fields } uretir -- redFlag BURADA YOK.
 * Kirmizi bayrak TUM programlar icin decodeOne'da TEK yerde hesaplanir (review
 * K4): yalnizca token dalinda kontrol etmek, yarin baska bir programa (orn.
 * SystemProgram'in AuthorizeNonceAccount'u) RED_FLAG_INSTRUCTIONS'a eklenecek
 * bir ad geldiginde SESSIZCE calismayan bir bayrak yaratirdi.
 */
function describeInstruction(raw) {
    if (raw.programId === SYSTEM_PROGRAM_ID) {
        const type = SYSTEM_TYPES[readU32LE(raw.data, 0)] ?? null
        const fields = type === 'Transfer' ? { lamports: readU64LE(raw.data, 4) } : {}
        return { program: 'system', type, fields }
    }

    if (raw.programId === TOKEN_PROGRAM_ID || raw.programId === TOKEN_2022_PROGRAM_ID) {
        const type = TOKEN_TYPES[raw.data[0]] ?? null
        const fields = {}
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

    return { program: 'unknown', type: null, fields: {} }
}

function decodeOne(raw, index) {
    const { program, type, fields } = describeInstruction(raw)
    return {
        index,
        programId: raw.programId,
        accounts: raw.accounts,
        dataHex: toHex(raw.data),
        program,
        type,
        fields,
        redFlag: RED_FLAG_INSTRUCTIONS.has(type),
    }
}

/**
 * @param {object} parsed parseDappTransaction ciktisi
 * @param {{lookups?: {writable: string[], readonly: string[]}}} opts
 * @returns {Array<{index, programId, program, type, redFlag, accounts, fields, dataHex}>}
 */
export function decodeInstructions(parsed, { lookups } = {}) {
    if (!parsed || !parsed.tx) return []
    return rawInstructions(parsed, lookups).map(decodeOne)
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
