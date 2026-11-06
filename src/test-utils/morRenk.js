// Bir rengin "mor" sayilip sayilmadigi (gizli mod grafit karari, kullanici 2026-10-26): OKLCH tonu 270-335 araliginda
// (indigo 272-281, violet ~293, purple ~305, fuchsia ~322) VE gozle secilir renkte (C >= 0.02). Alt sinir 270:
// slate (en fazla 265.8) ve blue (en fazla 267.9) mavi-gridir, mor sayilmaz. Tailwind'in notr grileri (zinc: ton 286,
// C en fazla 0.017) da sayilmaz. Eski gece-mor gizli zemin #0c0a13 (C 0.019) de SAYILMAZ: gizli kurallarin tonunu
// olcen test (privacyWiring.test.js) bu yuzden kendi, daha siki esigini (C >= 0.01) kullanir.
export function oklchRgb(r, g, b) {
    const [R, G, B] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return { C: Math.hypot(A, Bb), H: ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360 }
}

export const oklchHex = (hex) => oklchRgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))

export const morMu = ({ C, H }) => C >= 0.02 && H >= 270 && H <= 335
