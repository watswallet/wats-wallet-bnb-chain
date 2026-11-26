import { isValidSolanaAddress } from './address'
import { solanaRpc } from './client'
import { NATIVE_MINT_ADDRESS } from './constants'

/**
 * Token hesabi baglami -- onay ekraninin "bu hesap hangi token'a/kime ait"
 * sorusu. Talimatta yalniz kaynak ve hedef TOKEN HESABI adresi vardir; mint,
 * sahip ve decimals zincirden okunur. AG YALNIZ BURADA (txPreview saftir).
 *
 * Donus: Map<tokenHesabiAdresi, { mint, owner, decimals, lamports?, isNative? }>; her alan
 * cozulemezse null. `lamports` (ham birim dizesi) ve `isNative` yalniz zincirden OKUNAN
 * hesaplarda ve okunabildiyse bulunur (islem ici yaratilan hesapta yoktur).
 * Mint hesabinin kendisi icin { mint: <kendi adresi>, owner: null, decimals }.
 *
 * FAIL-OPEN: RPC hatasi / 403 / zaman asimi / iptal / bicimsiz yanit FIRLATMAZ;
 * yalniz RPC'den gelecek kisim eksik kalir. Eksik baglam kilidi ACMAZ, ustte
 * `hasUnknown` olarak yorumlanir (txPreview). Bu veri SAGLAYICIDAN gelir ve
 * yalniz GOSTERIM/UYARI icindir; imza kararini baglamaz.
 */

const MAX_ACCOUNTS = 100 // sunucu getMultipleAccounts siniri ile ayni
const TOKEN_PROGRAM_NAMES = new Set(['spl-token', 'spl-token-2022'])

const isAddr = (v) => typeof v === 'string' && isValidSolanaAddress(v)
const isDecimals = (v) => Number.isInteger(v) && v >= 0 && v <= 255
// Hesabin lamports'u: negatif olmayan GUVENLI tam sayi ya da rakam dizesi -> ham birim
// DIZESI. 2^53'un ustundeki JSON sayisi hassasiyet kaybetmis olabilir: okunamadi sayilir
// (ekran "tum SOL gidebilir" der; uydurma tutar gosterilmez).
function readLamports(v) {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? String(v) : null
    return typeof v === 'string' && /^[0-9]+$/.test(v) ? v : null
}

/**
 * Islem ici yaratilan token hesaplarindan yerel harita: ATA Create/CreateIdempotent
 * ve InitializeAccount/2/3 (hesap -> {mint, owner}). Islem icinde yaratilan hesap
 * zincirde henuz YOKTUR (getMultipleAccounts null doner), bu yuzden sahibi yalniz
 * talimattan bilinir. Yerel veri zincir tarafindan zorlanir: talimat ile sonuc
 * uyusmazsa islem basarisiz olur.
 */
function localAtaMap(decoded) {
    const map = new Map()
    // Bu islemde CloseAccount ile kapatilmis hesaplar (accounts[0]).
    const closed = new Set()
    for (const ix of decoded) {
        let ata = null
        let owner = null
        let mint = null
        if (ix.program === 'token' && ix.type === 'CloseAccount') {
            const kapanan = (ix.accounts || [])[0]
            if (typeof kapanan === 'string' && kapanan !== '') closed.add(kapanan)
            continue
        }
        if (ix.program === 'ata' && (ix.type === 'Create' || ix.type === 'CreateIdempotent')) {
            // [funder, ata, owner, mint, systemProgram, tokenProgram]
            ;[, ata, owner, mint] = ix.accounts || []
        } else if (ix.program === 'token' && (ix.type === 'InitializeAccount' || ix.type === 'InitializeAccount2' || ix.type === 'InitializeAccount3')) {
            ata = (ix.accounts || [])[0]
            owner = ix.fields?.owner
            mint = ix.fields?.mint
        } else {
            continue
        }
        if (!ata) continue
        const okunur = Boolean(owner && mint)
        const onceki = map.get(ata)
        // Hesap bu islemde ilk kez (ve daha once kapatilmadan) yaratiliyor: kayit talimattan gelir.
        if (!onceki && !closed.has(ata)) {
            if (okunur) map.set(ata, { mint, owner, decimals: null })
            continue
        }
        // Ayni hesap ikinci kez gelirse ILK kayit KORUNMAZ (dapp-imza-guvenlik-1): saldirgan hesabi
        // kapatip baska sahiple yeniden yaratabilir; ilk kayit korunsaydi Transfer satiri eski
        // (kullanici) sahibini "To: You" diye gosterir, gercek alici saldirgan olurdu. Bu yuzden:
        // - ayni {mint, owner} tekrari (idempotent) kaydi DEGISTIRMEZ;
        // - FARKLI {mint, owner} ya da ayni islemde CloseAccount SONRASI yaratma kaydi BELIRSIZ yapar
        //   ({mint:null, owner:null}); belirsiz kayit KALICIDIR (sonraki talimat geri cevirmez).
        // txPreview bunu "alici cozulemedi" + hasUnknown olarak yorumlar. Zincir ustu gecerlilik
        // OLCULMEDI: kural fail-closed oldugu icin bekletilmez.
        if (closed.has(ata) || !okunur || !onceki || onceki.owner !== owner || onceki.mint !== mint) {
            map.set(ata, { mint: null, owner: null, decimals: null })
        }
    }
    return map
}

/** Zincirden okunmasi GEREKEN adresler (siraya gore, benzersiz, null'suz). */
function addressesToResolve(decoded, local) {
    const out = []
    const seen = new Set()
    const add = (a) => {
        if (typeof a !== 'string' || a === '' || seen.has(a) || local.has(a)) return
        seen.add(a)
        out.push(a)
    }
    for (const ix of decoded) {
        if (ix.program !== 'token') continue
        const a = ix.accounts || []
        switch (ix.type) {
            case 'Transfer': add(a[0]); add(a[1]); break // mint/decimals kaynaktan, sahip hedeften
            case 'TransferChecked': add(a[2]); break // mint+decimals talimatta; yalniz hedef sahibi
            case 'Approve': add(a[0]); break // mint kaynak hesaptan
            case 'MintTo': add(a[0]); break // decimals mint hesabindan
            case 'Burn': add(a[0]); break // mint kaynak hesaptan
            case 'CloseAccount': add(a[0]); break // kapatilan hesabin lamports'u (hedefe giden SOL tutari)
            default: break // ApproveChecked/MintToChecked/BurnChecked/Revoke/SetAuthority: gerekmez
        }
    }
    return out
}

/** jsonParsed hesap kaydi -> { mint, owner, decimals } | null (tanimsiz bicim). */
function readParsedAccount(address, hesap) {
    const data = hesap?.data
    if (!data || typeof data !== 'object' || !TOKEN_PROGRAM_NAMES.has(data.program)) return null
    const parsed = data.parsed
    const info = parsed?.info
    if (!info || typeof info !== 'object') return null
    if (parsed.type === 'account') {
        const lamports = readLamports(hesap.lamports)
        return {
            mint: isAddr(info.mint) ? info.mint : null,
            owner: isAddr(info.owner) ? info.owner : null,
            decimals: isDecimals(info.tokenAmount?.decimals) ? info.tokenAmount.decimals : null,
            // CloseAccount ile hedefe giden SOL: hesaptaki TUM lamports (kira + sarili SOL).
            // Alanlar yalniz okunabildiyse eklenir (yoksa "okunamadi" anlamina gelir).
            ...(lamports !== null ? { lamports } : {}),
            ...(info.isNative === true || info.mint === NATIVE_MINT_ADDRESS ? { isNative: true } : {}),
        }
    }
    if (parsed.type === 'mint') {
        return { mint: address, owner: null, decimals: isDecimals(info.decimals) ? info.decimals : null }
    }
    return null
}

/**
 * @param {{decoded: Array, rpc?: Function, signal?: AbortSignal}} args
 *   `rpc(method, params, { signal })`: varsayilan `solanaRpc` (Gorev 37 iptal sinyali).
 * @returns {Promise<Map<string, {mint: string|null, owner: string|null, decimals: number|null}>>}
 */
export async function loadTokenAccountContext({ decoded, rpc = solanaRpc, signal } = {}) {
    const list = Array.isArray(decoded) ? decoded : []
    const result = localAtaMap(list)
    try {
        const wanted = addressesToResolve(list, result).slice(0, MAX_ACCOUNTS)
        if (wanted.length === 0) return result

        const res = await rpc('getMultipleAccounts', [wanted, { encoding: 'jsonParsed' }], { signal })
        const values = res?.value
        // Uzunluk uyusmazligi hizayi bozar: hesap -> kayit eslemesi YANLIS olur.
        if (!Array.isArray(values) || values.length !== wanted.length) return result

        wanted.forEach((address, i) => {
            const entry = readParsedAccount(address, values[i])
            if (entry) result.set(address, entry)
        })
    } catch {
        // Fail-open: ag/iptal/403 -> yalniz yerel (islem ici ATA) harita kalir.
    }
    return result
}
