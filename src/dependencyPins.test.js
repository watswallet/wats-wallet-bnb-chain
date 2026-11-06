// Birlesme (origin/main 1.9.1 + gizli mod): package.json ile package-lock.json birbiriyle SENKRON kalir.
// Iki dosya git tarafindan OTOMATIK birlesir (cakisma cikmaz) ve yanlis bir birlesme sessiz kalir: surum uclusu
// ayrisir, SilentSwap SDK pini gevser ya da kilitte ikinci bir @silentswap/chains kopyasi olusur (ust belge
// bolum 14, "Ana dal WalletConnect'i (1.8.3) alinca birlestirirken" listesi).
// `sorunlar` saf bir denetleyicidir: gercek dosyalar ve bilerek bozulmus kopyalar AYNI islevden gecer, boylece
// kilit hicbir sey denetlemeden yesil olamaz.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const oku = (yol) => JSON.parse(readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8'))

const PIN = '2.3.0'
const PIN_PAKETLERI = ['@silentswap/sdk', '@silentswap/chains']
const siralanmis = (nesne) => JSON.stringify(Object.entries(nesne ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))

/** Sorun listesi doner; bos liste = temiz. */
function sorunlar(pkg, kilit) {
    const s = []
    const kok = kilit.packages?.[''] ?? {}
    const surumler = [pkg.version, kilit.version, kok.version]
    if (new Set(surumler).size !== 1) s.push(`surum uclusu ayrisiyor: ${surumler.join(' | ')}`)
    for (const bolum of ['dependencies', 'devDependencies']) {
        if (siralanmis(pkg[bolum]) !== siralanmis(kok[bolum])) s.push(`kilit kok girdisi package.json ${bolum} ile senkron degil`)
    }
    for (const ad of PIN_PAKETLERI) {
        if (pkg.dependencies?.[ad] !== PIN) s.push(`${ad} pini ${PIN} degil: ${pkg.dependencies?.[ad]}`)
        const kayit = kilit.packages?.[`node_modules/${ad}`]
        if (kayit?.version !== PIN) s.push(`kilitte ${ad} surumu ${PIN} degil: ${kayit?.version}`)
    }
    const kopyalar = Object.keys(kilit.packages ?? {}).filter((k) => /(^|\/)node_modules\/@silentswap\/chains$/.test(k))
    if (kopyalar.length !== 1) s.push(`kilitte ${kopyalar.length} adet @silentswap/chains kopyasi var (1 beklenir)`)
    return s
}

describe('package.json ve package-lock.json senkron (birlesme kilidi)', () => {
    const pkg = oku('../package.json')
    const kilit = oku('../package-lock.json')

    it('gercek dosyalar temiz: surum uclusu esit, SDK pinleri tam 2.3.0, kilitte tek chains kopyasi, kok girdisi senkron', () => {
        // Sorunlar metin olarak karsilastirilir: kirmizi olursa hangi kuralin bozuldugu hata satirinda gorunur.
        expect(sorunlar(pkg, kilit).join('\n')).toBe('')
    })

    // Denetleyicinin kendisi sinanir: her bozulma AYRI bir sorunla yakalanmali (aksi halde yukaridaki yesil bos olurdu).
    it.each([
        ['kilit paket kokunun surumu ayrisir', (k) => { k.kilit.packages[''].version = '0.0.0' }, 'surum uclusu ayrisiyor'],
        ['kilit ust surumu ayrisir', (k) => { k.kilit.version = '0.0.0' }, 'surum uclusu ayrisiyor'],
        ['package.json surumu ayrisir', (k) => { k.pkg.version = '0.0.0' }, 'surum uclusu ayrisiyor'],
        ['SDK pini gevser (^2.3.0)', (k) => { k.pkg.dependencies['@silentswap/sdk'] = '^2.3.0' }, '@silentswap/sdk pini'],
        ['chains pini kayar (2.3.1)', (k) => { k.pkg.dependencies['@silentswap/chains'] = '2.3.1' }, '@silentswap/chains pini'],
        ['kilitteki sdk surumu kayar', (k) => { k.kilit.packages['node_modules/@silentswap/sdk'].version = '2.2.0' }, 'kilitte @silentswap/sdk surumu'],
        ['kilitte ikinci chains kopyasi olusur', (k) => { k.kilit.packages['node_modules/@silentswap/sdk/node_modules/@silentswap/chains'] = { version: '2.2.0' } }, 'chains kopyasi var'],
        ['package.json bagimliligi eklenir ama kilit koku eski kalir', (k) => { k.pkg.dependencies.ornek = '1.0.0' }, 'dependencies ile senkron degil'],
    ])('denetleyici bozulmayi yakalar: %s', (_ad, boz, beklenen) => {
        const k = structuredClone({ pkg, kilit })
        boz(k)
        expect(sorunlar(k.pkg, k.kilit).join('\n')).toContain(beklenen)
    })
})
