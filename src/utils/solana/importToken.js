// SPL mint -> ICE AKTARMA kaydi. ImportToken.vue'nun Solana dalinin karar
// katmani.
//
// EVM'de "token ice aktar" bir ERC-20 SOZLESME adresi ister; Solana'da bu bir
// MINT adresidir. `fetchTokenMetadata` (tokenMetadata.js) ile ayni /solana/tokens
// ucu kullanilir -- Home/SelectAssets'in bakiye satirlariyla AYNI kaynak, iki
// ayri "bu mint hangi token" cevabi olusmasin diye.
//
// METADATA BULUNAMAYAN ama GERCEKTEN VAR OLAN bir mint (henuz hicbir listede
// olmayan yeni bir SPL token) REDDEDILMEZ: kullanicinin bu tokene sahip olma
// ihtimali gercek, "bilinmeyen token" etiketiyle -- ama DOGRU ondalikla --
// eklenir. Ondalik metadata'dan gelmiyorsa (ya da BOZUKSA -- asagida) MINT
// HESABININ KENDISINDEN (getAccountInfo, jsonParsed) okunur: Send.vue ondalik
// olmadan dogru bir islem hazirlayamaz, TAHMIN ETMEK (orn. 9 varsaymak) yanlis
// miktar gonderir.
//
// Mint hesabinin kendisi de BULUNAMAZSA (gecersiz/var olmayan adres) ICE AKTARMA
// REDDEDILIR: yazacak dogru bir ondalik yok, "belki dogrudur" ile kayit
// olusturmak Send'i sessizce bozar.
import { isAddress as isEvmAddress } from 'ethers'
import { fetchTokenMetadata } from './tokenMetadata'
import { solanaRpc } from './client'
import { isValidSolanaAddress, normalizeSolanaAddress } from './address'

/** Adresten okunabilir bir etiket -- useSolanaAssets/tokenRowRecord ile AYNI bicim (ilk 4 + son 4). */
function shortMint(mint) {
    return `${mint.slice(0, 4)}...${mint.slice(-4)}`
}

/**
 * Ham `getAccountInfo(mint, {encoding:'jsonParsed'})` yanitindan mint ondaligini
 * cikarir -- SAF, ag YOK. Hesap yoksa (`value: null`), mint TIPINDE degilse ya
 * da `decimals` tam sayi degilse `null` doner ("bilmiyorum").
 */
export function parseMintDecimalsResponse(result) {
    const parsed = result?.value?.data?.parsed
    if (!parsed || parsed.type !== 'mint') return null
    const decimals = parsed.info?.decimals
    return Number.isInteger(decimals) ? decimals : null
}

/**
 * `ca` girdisinin BICIM olarak bu VM'e uygun olup olmadigi -- SAF, ag YOK.
 *
 * KOD INCELEMESI (Task 16b review, F5): `ImportToken.vue`'nun `watch(ca, ...)`
 * govdesi eskiden bu iki dali (`ethers.isAddress` / `isValidSolanaAddress`)
 * DOGRUDAN kodluyordu -- iki dal birbirine karistirilsa (orn. EVM dalina yanlislikla
 * Solana kontrolu yazilsa) hicbir test bunu YAKALAMAZDI: SSR harness'i bu
 * bilesenin `watch()`ini calistiramaz (Vue, SSR render'i sirasinda setup()
 * icinde olusturulan senkron-olmayan watcher'lara gercek bir efekt bile kurmaz).
 * Karar burada, watch'tan BAGIMSIZ bir fonksiyona tasinip DOGRUDAN test edilir --
 * bilesen artik yalniz bu fonksiyonu CAGIRIR, kendi format mantigini TASIMAZ.
 *
 * NOT: Solana dalinda `validateRecipient`in aksine `isWalletAddress` (egri-ustu)
 * KULLANILMAZ -- bir mint bir CUZDAN degildir, cogu gercek mint hesabi (PDA
 * tabanli fabrikalarda) egri DISINDADIR; bicim (base58/32 bayt) yeterlidir.
 */
export function isValidImportInputFormat(vm, input) {
    if (vm === 'solana') return isValidSolanaAddress(input)
    return isEvmAddress(input)
}

/**
 * Zaten cozulmus girdilerden (metadata Map girdisi + gerekirse zincirden okunan
 * ondalik) ICE AKTARMA kaydini kurar -- SAF, ag YOK. Karar mantigi burada
 * toplanir ki `resolveMintForImport`in ag/hata kismindan BAGIMSIZ test edilebilsin.
 *
 * KOD INCELEMESI (Task 16b review, F2): `metadata.decimals` DOGRULANMADAN
 * dogrudan kullaniliyordu. Sunucu (Jupiter token listesi) bu alani HER ZAMAN
 * dolu/GECERLI bir tam sayi olarak DONDURMEZ -- eksik, `null` ya da dizge
 * ('6') gelebilir; `tokenMetadata.js` bunu OLDUGU GIBI Map'e yazar, hicbir
 * asama dogrulamaz. Sonuc: kullanici "Dogrulandi" (known:true) rozetiyle
 * ondaliksiz/bozuk bir kayit ice aktarir, Send zincirde genel bir hatayla
 * duser. `metadata.decimals` GECERSIZSE, tipki metadata YOKMUS gibi, ondalik
 * zincirden (`mintDecimals`) okunur -- ama sembol/isim/logo/coingecko_id GIBI
 * GUVENILIR alanlar metadata'dan KORUNUR (tumunu atip "bilinmeyen token"e
 * dusmek gereksiz bilgi kaybi olurdu).
 *
 * @param {string} mint - dogrulanmis, HARF KASASI KORUNMUS (normalizeSolanaAddress) mint.
 * @param {{mint,symbol,name,decimals,logoURI,coingecko_id}|null} metadata - fetchTokenMetadata sonucu (bulunduysa).
 * @param {number|null} mintDecimals - metadata YOKSA ya da ondaligi GECERSIZSE zincirden okunan ondalik.
 * @returns {{ok:true, known:boolean, token:object}|{ok:false, reason:string}}
 */
export function buildSolanaImportRecord({ mint, metadata = null, mintDecimals = null } = {}) {
    if (!isValidSolanaAddress(mint)) return { ok: false, reason: 'INVALID_MINT' }
    const canonical = normalizeSolanaAddress(mint)

    // Metadata'nin KENDI ondaligi yalniz GECERLI bir tam sayiysa guvenilir --
    // aksi halde (yok, null, dizge, ondalikli...) zincirden okunana DUSULUR.
    const metadataDecimals = Number.isInteger(metadata?.decimals) ? metadata.decimals : null
    const decimals = metadataDecimals ?? mintDecimals

    // Ne metadata NE DE zincirden dogru bir ondalik gelmediyse HONEST bir kayit
    // kurulamaz -- reddedilir. Send.vue ondaligi TAHMIN EDEMEZ.
    if (!Number.isInteger(decimals)) return { ok: false, reason: 'MINT_NOT_FOUND' }

    if (metadata) {
        const label = metadata.symbol || metadata.name || shortMint(canonical)
        return {
            ok: true,
            known: true,
            token: {
                name: metadata.name || label,
                symbol: metadata.symbol || label,
                decimals,
                address: canonical,
                image: metadata.logoURI
                    ? { thumb: metadata.logoURI, small: metadata.logoURI, large: metadata.logoURI }
                    : { thumb: '', small: '', large: '' },
                coingecko_id: metadata.coingecko_id || null,
            },
        }
    }

    const label = shortMint(canonical)
    return {
        ok: true,
        known: false,
        token: {
            name: label,
            symbol: label,
            decimals,
            address: canonical,
            image: { thumb: '', small: '', large: '' },
            coingecko_id: null,
        },
    }
}

/**
 * Ag cagrisi yapan ince orkestrator: ONCE metadata dener. Metadata'nin GECERLI
 * bir ondaligi VARSA mint hesabina AYRICA sorulmaz (gereksiz RPC turu). Yoksa
 * -- ya da metadata'nin ondaligi BOZUKSA (F2) -- mint hesabindan ondalik
 * okunur. Karar HER ZAMAN `buildSolanaImportRecord`e birakilir.
 */
export async function resolveMintForImport(mint) {
    if (!isValidSolanaAddress(mint)) return { ok: false, reason: 'INVALID_MINT' }
    const canonical = normalizeSolanaAddress(mint)

    const metadataMap = await fetchTokenMetadata([canonical])
    const metadata = metadataMap.get(canonical) || null

    if (Number.isInteger(metadata?.decimals)) {
        return buildSolanaImportRecord({ mint: canonical, metadata })
    }

    let mintDecimals = null
    try {
        const result = await solanaRpc('getAccountInfo', [canonical, { encoding: 'jsonParsed' }])
        mintDecimals = parseMintDecimalsResponse(result)
    } catch (e) {
        console.error('Mint hesabi okunamadi:', e.message)
        mintDecimals = null
    }

    return buildSolanaImportRecord({ mint: canonical, metadata, mintDecimals })
}
