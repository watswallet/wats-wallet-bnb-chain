import { isWalletAddress } from './address'
import { curatedMintInfo } from '../../data/solanaCuratedMints'
import {
    SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    COMPUTE_BUDGET_PROGRAM_ID, MEMO_V1_PROGRAM_ID, MEMO_V2_PROGRAM_ID,
} from './decodeInstructions'
import { TOKEN_PROGRAM_ID, NATIVE_MINT_ADDRESS } from './constants'

/**
 * Islem onizleme -- SAF katman: AG YOK, chrome YOK. Girdi `decodeInstructions`
 * ciktisi (+ `tokenAccountContext` haritasi); cikti onay ekraninin satirlari,
 * adres-guvenligi kapisina girecek adresler ve kilit bayraklari.
 *
 * GUVEN SINIRI (Constraint 16/27): hicbir dapp metni (Memo, site adi) karar
 * girdisi degildir. Mint etiketi YALNIZ kurasyonlu istemci tablosundan gelir;
 * `/solana/tokens` ve `fetchTokenMetadata` buraya GIRMEZ. Satirlar adresleri
 * TAM tasir (kisaltma gosterim katmaninda); adres cevirilere gomulmez.
 *
 * `hasUnknown` (Constraint 23): bilinmeyen program VAR, ya da herhangi bir
 * satirda alici/mint/sahip/tutar cozulemedi (baglam bos/eksik, ALT adresi null),
 * ya da `altUnresolved`, ya da tanimsiz talimat indeksi. `hasRedFlag` karari
 * `decodeInstructions`'in baglamli `redFlag` alanindan gelir (tek hesap yeri).
 *
 * Satir alanlari: `{ index, kind, titleKey, fields, affectsUser, risk }`. Alan
 * degerleri ham dizedir (adres tam, tutar ham birim); cozulemeyen alan
 * `value:null, unresolved:true` tasir. `titleKey:null` olan `other` satirlari
 * `type` (kendi cozucumuzun sabit adi) ile gosterilir.
 */

const SYSTEM_TITLE = {
    Transfer: 'systemTransfer',
    TransferWithSeed: 'transferWithSeed',
    CreateAccount: 'createAccount',
    CreateAccountWithSeed: 'createAccount',
    Assign: 'assign',
    AssignWithSeed: 'assign',
    WithdrawNonceAccount: 'withdrawNonce',
}
// Sahip/mint tasimayan hazirlik talimatlari: her zaman tek `walletPrep` satirina katlanir.
// InitializeAccount/2/3 BURADA DEGIL: yalniz mint = native mint VE sahip = kullanici iken katlanir (S5-F1).
const WALLET_PREP_TYPES = new Set(['SyncNative', 'InitializeImmutableOwner'])
const INIT_ACCOUNT_TYPES = new Set(['InitializeAccount', 'InitializeAccount2', 'InitializeAccount3'])
// CreateAccount kira tabani (S5-F2): Agave rent 3480 lamport/bayt-yil x 2 yil muafiyet,
// hesap basligi 128 bayt. Taban = (space + 128) * 3480 * 2 (space=165 -> 2.039.280).
const RENT_LAMPORTS_PER_BYTE_YEAR = 3480n
const RENT_EXEMPTION_YEARS = 2n
const ACCOUNT_STORAGE_OVERHEAD_BYTES = 128n
// Taban icin kullanilan space saldirgan girdisidir (CreateAccount 10 MiB'a kadar System sahipli
// hesap acabilir -> taban ~73 SOL): space bilinen sahiplere gore makul tavanla sinirlanir (F5-1-1).
// Tavani asan space'te taban tavandan hesaplanir, fazlasi fon aktarimi sayilir, hasUnknown olur.
const MAX_SYSTEM_ACCOUNT_SPACE = 80n // System sahipli hesap: 0 veya nonce hesabi (80)
const MAX_NEW_ACCOUNT_SPACE = 2048n // diger sahipler (Token/Token-2022 birkac yuz bayt) icin genel tavan
const rentExemptFloor = (space) => (space + ACCOUNT_STORAGE_OVERHEAD_BYTES) * RENT_LAMPORTS_PER_BYTE_YEAR * RENT_EXEMPTION_YEARS
// Yeni hesabin sahibi bu programlardan biri degilse cozemedigimiz bir programa devredilir (hasUnknown).
const KNOWN_NEW_ACCOUNT_OWNERS = new Set([SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID])
const toBigInt = (v) => {
    if (v == null) return null
    try { return BigInt(v) } catch { return null }
}
const MAX_GATE_ADDRESSES = 4
const SOL_DECIMALS = 9
const U = 'dapps.solana.'

/**
 * Mint etiketi: YALNIZ kurasyonlu tablo. Kurasyonlu degilse sembol YOK ve
 * `verified:false` (sahte "USDC" sembollu mint kendi adini gosteremez). Hicbir
 * ag/sunucu yanitina bakmaz.
 */
export function mintLabel(mint) {
    const info = curatedMintInfo(mint)
    return info ? { symbol: info.symbol, verified: true } : { symbol: null, verified: false }
}

function userAddress(user) {
    if (user && typeof user === 'object' && typeof user.toBase58 === 'function') return user.toBase58()
    return typeof user === 'string' && user !== '' ? user : null
}

const addrField = (name, value) => ({
    labelKey: `${U}f.${name}`, value: value ?? null, kind: 'address', ...(value == null ? { unresolved: true } : {}),
})
const textField = (name, value, unresolved = false) => ({
    labelKey: `${U}f.${name}`, value: value ?? null, kind: 'text', ...(value == null || unresolved ? { unresolved: true } : {}),
})
// Tutar ham birim dizesi tasir; bicimleme (formatUnits, BigInt) gosterim katmaninda.
const amountField = (value, { decimals = null, symbol = null, verified = false, mint = null, labelName = 'amount' } = {}) => ({
    labelKey: `${U}f.${labelName}`,
    value: value ?? null,
    kind: 'amount',
    decimals,
    symbol,
    verified,
    mint,
    ...(value == null || decimals == null ? { unresolved: true } : {}),
})

export function buildTxPreview({ decoded, parsed, user, tokenCtx, mintLabel: labeler = mintLabel, altUnresolved = false } = {}) {
    const list = Array.isArray(decoded) ? decoded : []
    const me = userAddress(user)
    const ctx = tokenCtx instanceof Map ? tokenCtx : new Map()

    // Savunmaci: enjekte edilen etiketleyici dogrulanmamis bir sembolu ASLA ekrana tasiyamaz.
    const label = (mint) => {
        if (!mint) return { symbol: null, verified: false }
        let r
        try { r = labeler(mint) } catch { r = null }
        const verified = r?.verified === true && typeof r.symbol === 'string' && r.symbol !== ''
        return { symbol: verified ? r.symbol : null, verified }
    }

    const programIds = new Set([
        SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        COMPUTE_BUDGET_PROGRAM_ID, MEMO_V1_PROGRAM_ID, MEMO_V2_PROGRAM_ID,
    ])
    for (const ix of list) if (ix.programId) programIds.add(ix.programId)

    const rows = []
    const gateRaw = []
    let unknown = altUnresolved === true
    let rentLamports = 0n
    let walletPrepDone = false

    // user bilinmiyorsa satir "senin hesabin" varsayilir (soluklastirma YOK: muhafazakar).
    const isMe = (a) => me === null || a === me
    const gate = (address, { curve }) => {
        if (typeof address !== 'string' || address === '') return
        if (address === me || programIds.has(address)) return
        if (curve && !isWalletAddress(address)) return // egri disi (PDA/kasa) alici gurultudur
        gateRaw.push(address)
    }
    const tokenOf = (mint, decimalsHint) => {
        const l = label(mint)
        const cur = mint ? curatedMintInfo(mint) : null
        return { mint: mint ?? null, decimals: decimalsHint ?? cur?.decimals ?? null, symbol: l.symbol, verified: l.verified }
    }
    const push = (row, ix) => rows.push({ index: ix.index, ...row })
    // Islem ici yaratilan hesabin baglam kaydi BELIRSIZ ({mint:null, owner:null}) mi? tokenAccountContext
    // ayni hesabin FARKLI {mint, owner} ile tekrarini ya da CloseAccount SONRASI yeniden yaratilmasini
    // boyle isaretler (dapp-imza-guvenlik-1): hesap kimin oldugu bilinemez -> hasUnknown. Yalniz
    // yaratma/baslatma satirlarinda sorulur (o hesaplar zincirden okunmaz, yalniz yerel haritadan gelir).
    const belirsizHesap = (hesap) => {
        const c = typeof hesap === 'string' ? ctx.get(hesap) : undefined
        return c !== undefined && c.mint == null && c.owner == null
    }

    for (const ix of list) {
        const a = ix.accounts || []
        const f = ix.fields || {}
        const risk = ix.redFlag === true

        // Bilinen ComputeBudget opcode'lari ucret katmanina gider; TANIMSIZ opcode (type null) atlanmaz:
        // asagida "okunamayan talimat" satiri + hasUnknown olur (SU-1).
        if (ix.program === 'computeBudget' && ix.type) continue

        if (ix.program === 'system' && ix.type) {
            const kind = SYSTEM_TITLE[ix.type]
            if (ix.type === 'Transfer' || ix.type === 'TransferWithSeed') {
                const dest = ix.type === 'Transfer' ? a[1] : f.destination
                if (f.lamports == null || dest == null) unknown = true
                gate(dest, { curve: true })
                push({
                    kind, titleKey: `${U}ix.${kind}`, risk,
                    affectsUser: isMe(a[0]) || (ix.type === 'TransferWithSeed' && isMe(a[1])),
                    fields: [addrField('from', a[0]), addrField('to', dest), amountField(f.lamports, { decimals: SOL_DECIMALS, symbol: 'SOL', verified: true })],
                }, ix)
            } else if (ix.type === 'WithdrawNonceAccount') {
                if (f.lamports == null || a[1] == null) unknown = true
                gate(a[1], { curve: true })
                push({
                    kind, titleKey: `${U}ix.${kind}`, risk, affectsUser: isMe(a[4]) || isMe(a[0]),
                    fields: [addrField('from', a[0]), addrField('to', a[1]), amountField(f.lamports, { decimals: SOL_DECIMALS, symbol: 'SOL', verified: true })],
                }, ix)
            } else if (ix.type === 'CreateAccount' || ix.type === 'CreateAccountWithSeed') {
                // Kira tabani (S5-F2): lamports'un yalniz taban kadari "kira" sayilir;
                // fazlasi yeni hesaba para aktarimidir (duz Transfer ile ayni cikis):
                // ayri `fundTransfer` tutari, yeni hesap kapiya girer (egri kurali ayni).
                const lamports = toBigInt(f.lamports)
                const space = toBigInt(f.space)
                if (lamports === null || space === null || f.owner == null || a[1] == null) unknown = true
                else if (!KNOWN_NEW_ACCOUNT_OWNERS.has(f.owner)) unknown = true
                let rent = lamports
                let excess = 0n
                if (lamports !== null) {
                    // space okunamadiysa taban bilinemez: HEPSI fon aktarimi sayilir (muhafazakar).
                    // space tavani asarsa taban tavandan hesaplanir (saldirgan girdisi tabani sisiremez).
                    const maxSpace = f.owner === SYSTEM_PROGRAM_ID ? MAX_SYSTEM_ACCOUNT_SPACE : MAX_NEW_ACCOUNT_SPACE
                    if (space !== null && space > maxSpace) unknown = true
                    const floor = space === null ? 0n : rentExemptFloor(space > maxSpace ? maxSpace : space)
                    rent = lamports < floor ? lamports : floor
                    excess = lamports - rent
                }
                const mine = isMe(a[0])
                if (mine && rent !== null) rentLamports += rent
                if (mine && excess > 0n) gate(a[1], { curve: true })
                push({
                    kind, titleKey: `${U}ix.${kind}`, risk, affectsUser: mine,
                    fields: [
                        addrField('from', a[0]), addrField('to', a[1]),
                        amountField(rent === null ? null : rent.toString(), { decimals: SOL_DECIMALS, symbol: 'SOL', verified: true, labelName: 'rent' }),
                        ...(excess > 0n ? [amountField(excess.toString(), { decimals: SOL_DECIMALS, symbol: 'SOL', verified: true, labelName: 'fundTransfer' })] : []),
                        textField('space', f.space ?? null), addrField('program', f.owner ?? null),
                    ],
                }, ix)
            } else if (ix.type === 'Assign' || ix.type === 'AssignWithSeed') {
                // Yeni sahip bilinen program degilse hesap cozemedigimiz bir programa devredilir (SU-1).
                if (a[0] == null || f.owner == null) unknown = true
                else if (!KNOWN_NEW_ACCOUNT_OWNERS.has(f.owner)) unknown = true
                push({
                    kind, titleKey: `${U}ix.${kind}`, risk, affectsUser: isMe(a[0]),
                    fields: [addrField('owner', a[0]), addrField('program', f.owner ?? null)],
                }, ix)
            } else if (ix.type !== 'AdvanceNonceAccount') {
                // Allocate*, InitializeNonce, AuthorizeNonce, UpgradeNonce: adiyla, ek ayrinti yok.
                // (ILK siradaki AdvanceNonceAccount satir uretmez: `hasDurableNonce` uyarisi ekrana tasir.)
                push({ kind: 'other', titleKey: null, type: ix.type, risk, affectsUser: isMe(a[0]), fields: [addrField('owner', a[0])] }, ix)
            } else if (ix !== list[0]) {
                // ILK sirada OLMAYAN AdvanceNonceAccount durable nonce uyarisini tetiklemez (islem o
                // nonce ile gecerli degildir) ama sessiz de kalmaz: nonce hesabi ve yetkilisi kullaniciysa
                // satir kullaniciyi etkiler (SU-1).
                push({ kind: 'other', titleKey: null, type: ix.type, risk, affectsUser: isMe(a[2]) || isMe(a[0]), fields: [addrField('owner', a[0])] }, ix)
            }
            continue
        }

        if (ix.program === 'token' && ix.type) {
            const t = ix.type
            const token2022 = f.tokenProgram === 'Token-2022'
            if (t === 'Transfer' || t === 'TransferChecked') {
                const checked = t === 'TransferChecked'
                const src = a[0]
                const dest = checked ? a[2] : a[1]
                const authority = checked ? a[3] : a[2]
                const srcInfo = ctx.get(src)
                const mint = checked ? (a[1] ?? null) : (srcInfo?.mint ?? null)
                const tok = tokenOf(mint, checked ? f.decimals : srcInfo?.decimals)
                const destOwner = ctx.get(dest)?.owner ?? null
                if (mint == null || destOwner == null || f.amount == null || tok.decimals == null) unknown = true
                gate(destOwner, { curve: true })
                push({
                    kind: 'tokenTransfer', titleKey: `${U}ix.tokenTransfer`, risk,
                    affectsUser: isMe(authority) || (me !== null && srcInfo?.owner === me),
                    ...(token2022 ? { token2022Nominal: true } : {}),
                    fields: [
                        amountField(f.amount, tok),
                        addrField('mint', mint),
                        { ...addrField('to', destOwner), tokenAccount: dest ?? null },
                    ],
                }, ix)
            } else if (t === 'Approve' || t === 'ApproveChecked') {
                const checked = t === 'ApproveChecked'
                const srcInfo = ctx.get(a[0])
                const mint = checked ? (a[1] ?? null) : (srcInfo?.mint ?? null)
                const tok = tokenOf(mint, checked ? f.decimals : srcInfo?.decimals)
                const ownerAcc = checked ? a[3] : a[2]
                if (mint == null || f.delegate == null || f.amount == null || tok.decimals == null) unknown = true
                if (f.amount !== '0') gate(f.delegate, { curve: false }) // 0 = izni SIFIRLAMA
                push({
                    kind: 'approve',
                    titleKey: f.unlimited ? `${U}ix.approveUnlimited` : `${U}ix.approve`,
                    unlimited: f.unlimited === true, risk, affectsUser: isMe(ownerAcc),
                    fields: [amountField(f.amount, tok), addrField('mint', mint), addrField('spender', f.delegate ?? null)],
                }, ix)
            } else if (t === 'Revoke') {
                push({ kind: 'revoke', titleKey: `${U}ix.revoke`, risk, affectsUser: isMe(a[1]), fields: [] }, ix)
            } else if (t === 'SetAuthority') {
                if (f.newAuthority != null) gate(f.newAuthority, { curve: false })
                else if (f.removesAuthority !== true) unknown = true // kirpik veri: yeni yetkili okunamadi
                const typeOk = Number.isInteger(f.authorityType) && f.authorityType >= 0 && f.authorityType <= 3
                push({
                    kind: 'setAuthority', titleKey: `${U}ix.setAuthority`, risk, affectsUser: isMe(a[1]),
                    removesAuthority: f.removesAuthority === true,
                    fields: [
                        ...(typeOk ? [{ labelKey: `${U}f.authorityType_${f.authorityType}`, value: String(f.authorityType), kind: 'text' }] : []),
                        addrField('newAuthority', f.newAuthority ?? null),
                    ],
                }, ix)
            } else if (t === 'CloseAccount') {
                if (f.rentTo == null) unknown = true
                gate(f.rentTo, { curve: false })
                // Hedefe hesaptaki SOL'un TAMAMI gider (S9-G9-S2): native (wSOL) hesapta kira +
                // sarili bakiye; native degilse (bakiye sifir olmak zorunda) kira. Bu islemde
                // hesaba eklenenler de dahildir. Tutar yalniz hedef kullanici DEGILKEN (kirmizi
                // satir) gosterilir; zincirden okunamazsa "tum SOL gidebilir" (fail-closed,
                // hasUnknown) -- kirmizi bayrak ve kutu her durumda kalir.
                const closeFields = [addrField('rentTo', f.rentTo ?? null)]
                if (risk) {
                    const closed = ctx.get(a[0])
                    const lamports = typeof closed?.lamports === 'string' && /^[0-9]+$/.test(closed.lamports) ? closed.lamports : null
                    if (lamports === null) {
                        unknown = true
                        closeFields.push(amountField(null, { decimals: SOL_DECIMALS, symbol: 'SOL', verified: true, labelName: 'closeSolUnknown' }))
                    } else {
                        closeFields.push(amountField(lamports, {
                            decimals: SOL_DECIMALS, symbol: 'SOL', verified: true,
                            labelName: closed.isNative === true ? 'closeSolAll' : 'closeSolRent',
                        }))
                    }
                }
                push({
                    kind: 'closeAccount', titleKey: `${U}ix.closeAccount`, risk, affectsUser: isMe(a[2]) || isMe(f.rentTo),
                    fields: closeFields,
                }, ix)
            } else if (t === 'MintTo' || t === 'MintToChecked' || t === 'Burn' || t === 'BurnChecked') {
                const mintKind = t.startsWith('Mint')
                const checked = t.endsWith('Checked')
                let mint
                let decimalsHint
                if (mintKind) {
                    mint = a[0] ?? null
                    decimalsHint = checked ? f.decimals : ctx.get(a[0])?.decimals
                } else if (checked) {
                    mint = a[1] ?? null
                    decimalsHint = f.decimals
                } else {
                    const info = ctx.get(a[0])
                    mint = info?.mint ?? null
                    decimalsHint = info?.decimals
                }
                const tok = tokenOf(mint, decimalsHint)
                if (mint == null || f.amount == null || tok.decimals == null) unknown = true
                const kind = mintKind ? 'mintTo' : 'burn'
                push({
                    kind, titleKey: `${U}ix.${kind}`, risk, affectsUser: isMe(a[2]),
                    fields: [amountField(f.amount, tok), addrField('mint', mint)],
                }, ix)
            } else if (INIT_ACCOUNT_TYPES.has(t)) {
                const owner = f.owner ?? null
                const mint = f.mint ?? null
                const ownerIsMe = me !== null && owner === me
                if (belirsizHesap(a[0])) unknown = true // ayni hesap tekrar/kapat-yeniden-yarat (dapp-imza-guvenlik-1)
                if (mint === NATIVE_MINT_ADDRESS && ownerIsMe) {
                    // Mesru wSOL hazirligi (Jupiter): sahip kullanici + native mint -> tek grup satiri.
                    if (!walletPrepDone) {
                        walletPrepDone = true
                        push({ kind: 'walletPrep', titleKey: `${U}ix.walletPrep`, risk: false, affectsUser: true, fields: [] }, ix)
                    }
                } else {
                    // Sahip kullanici degilse (ya da bilinmiyorsa) bu bir "hazirlik" DEGILDIR: hesap
                    // baskasina ait olur. Kirmizi bayrak degil (mesru vault/escrow akislari var);
                    // sahip tam adresle gorunur, kapiya girer, hasUnknown olur. Mint cozulemediyse
                    // (kirpik talimat) sahip kullanici olsa da hesap hangi token'a ait bilinmez: hasUnknown (SU-1).
                    if (!ownerIsMe || mint == null) unknown = true
                    gate(owner, { curve: true })
                    const tok = tokenOf(mint, null)
                    push({
                        kind: 'initializeAccount', titleKey: `${U}ix.initializeAccount`, risk, affectsUser: true,
                        fields: [{ ...addrField('mint', mint), symbol: tok.symbol, verified: tok.verified }, addrField('owner', owner)],
                    }, ix)
                }
            } else if (WALLET_PREP_TYPES.has(t)) {
                // Tek grup satiri: ayni islemde birden cok hazirlik talimati tek satir olur.
                if (!walletPrepDone) {
                    walletPrepDone = true
                    push({ kind: 'walletPrep', titleKey: `${U}ix.walletPrep`, risk: false, affectsUser: true, fields: [] }, ix)
                }
            } else {
                push({ kind: 'other', titleKey: null, type: t, risk, affectsUser: true, fields: [] }, ix)
            }
            continue
        }

        if (ix.program === 'ata' && (ix.type === 'Create' || ix.type === 'CreateIdempotent')) {
            // [funder, ata, owner, mint, systemProgram, tokenProgram]
            const [funder, , owner, mint] = a
            if (owner == null || mint == null || belirsizHesap(a[1])) unknown = true
            const forOther = me !== null && funder === me && owner != null && owner !== me
            const kind = forOther ? 'ataForOther' : 'ataCreate'
            const tok = tokenOf(mint ?? null, null)
            push({
                kind, titleKey: `${U}ix.${kind}`, risk, affectsUser: isMe(funder) || isMe(owner),
                fields: [addrField('owner', owner ?? null), { ...addrField('mint', mint ?? null), symbol: tok.symbol, verified: tok.verified }],
            }, ix)
            continue
        }

        if (ix.program === 'ata' && ix.type === 'RecoverNested') {
            push({ kind: 'other', titleKey: null, type: ix.type, risk, affectsUser: true, fields: [] }, ix)
            continue
        }

        if (ix.program === 'memo') {
            // Dapp metni: yalniz gosterim, KARAR GIRDISI DEGIL.
            push({
                kind: 'memo', titleKey: `${U}ix.memo`, risk: false, affectsUser: false,
                memoTruncated: f.memoTruncated === true,
                fields: [textField('memoText', f.memoText ?? null, f.memoUnreadable === true)],
            }, ix)
            continue
        }

        // Bilinmeyen program VEYA bilinen programda tanimsiz talimat indeksi (type:null):
        // cozemedigimiz sey ASLA uydurulmaz; kilit hasUnknown ile yonetilir.
        unknown = true
        const bilinmeyenProgram = ix.program === 'unknown'
        push({
            kind: bilinmeyenProgram ? 'unknownProgram' : 'undecodable',
            titleKey: bilinmeyenProgram ? `${U}ix.unknownProgram` : `${U}undecodable`,
            risk, affectsUser: true, dataHex: ix.dataHex ?? null,
            fields: [addrField('program', ix.programId ?? null)],
        }, ix)
    }

    const uniqueGate = [...new Set(gateRaw)]
    const feePayer = typeof parsed?.feePayer === 'string' ? parsed.feePayer : null
    const first = list[0]

    return {
        rows,
        gateAddresses: uniqueGate.slice(0, MAX_GATE_ADDRESSES),
        extraAddressCount: Math.max(0, uniqueGate.length - MAX_GATE_ADDRESSES),
        feePayer,
        feePayerIsUser: me !== null && feePayer !== null && feePayer === me,
        hasUnknown: unknown,
        hasRedFlag: list.some((ix) => ix.redFlag === true),
        hasDurableNonce: (first?.program === 'system' && first?.type === 'AdvanceNonceAccount') || parsed?.isDurableNonce === true,
        rentLamports,
    }
}
