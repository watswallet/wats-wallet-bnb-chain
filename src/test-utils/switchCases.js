import { yorumsuz } from './kaynakTarama'

/**
 * background.js dagiticisinin `case 'ADI':` adlarini cikarir. Uc kilit testi (privacyGate, messageGate,
 * background.privacyGate) ayni regex'i kopyalardi; kopyalar ayri ayri bozulabilirdi.
 *
 * SAGLAMLIK SAYIMI: yorum disi kodda HER `case ` belirteci (tirnakli, `case SABIT:`, sablon dizgeli) sayilir ve
 * satir basindaki TIRNAKLI `case '...':` eslesmeleriyle ayni olmali. Fark (tek satirda iki case, satir ortasinda
 * case, sabit ya da sablon dizgeli case, bicim degisikligi) cikarsa bir case sessizce kilidin disinda kalirdi
 * (adi cikarilamaz); bunun yerine burada HATA verilir (T23 M5).
 *
 * @param {string} source background.js icerigi
 * @returns {string[]} case adlari, kaynak sirasiyla
 */
export function extractSwitchCases(source) {
    const cases = [...source.matchAll(/^\s*case\s+['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1])
    const tokens = (yorumsuz(source).match(/\bcase\s/g) || []).length
    if (cases.length !== tokens) {
        throw new Error(`extractSwitchCases: ${tokens} case belirteci var ama ${cases.length} tanesi satir basinda eslesti`)
    }
    return cases
}
