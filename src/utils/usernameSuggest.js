// Onboarding'de onerilen rastgele kullanici adi -- saf katman.
//
// NEDEN AYRI DOSYA: uretici eskiden CreateUsername.vue'nun setup kapsaminda
// gomuluydu, disaridan erisilemiyordu ve TEST EDILEMIYORDU. Havuzu buyutmenin
// dogru oldugunu kanitlamanin tek yolu onu buraya cikarmakti.
//
// AG YOK, DEPO YOK, chrome YOK.

// CreateUsername.vue'daki input'un `maxlength`i. Iki yerde yasamamasi icin
// buradan disa verilir.
export const MAX_USERNAME_LENGTH = 15

// Adresten alinan ek KAC HANE: iki kelime kalibinda 3, tek kelime kalibinda 6.
// Ekin isi ADI BENZERSIZ KILMAK -- asagidaki uzunluk kapisinin korudugu sey de
// tam olarak bu (bkz. `sigarMi`).
const EK_IKI_KELIME = 3
const EK_TEK_KELIME = 6

export const USERNAME_PREFIXES = [
    'cyber', 'neon', 'dark', 'void', 'astro', 'cosmo', 'meta', 'poly', 'omni', 'hyper', 'nano',
    'giga', 'retro', 'synth', 'pixel', 'quantum', 'lunar', 'solar', 'toxic', 'holo', 'mecha',
    'iron', 'gold', 'silver', 'azure', 'crimson', 'jade', 'onyx', 'nova', 'zen', 'aether', 'agate',
    'alpine', 'altair', 'amber', 'amp', 'ancient', 'apogee', 'arc', 'arcane', 'arctic', 'arid',
    'ashen', 'astral', 'auburn', 'aurora', 'aurum', 'avian', 'basalt', 'binary', 'boreal', 'brass',
    'brisk', 'bronze', 'carbon', 'celadon', 'ceramic', 'cerise', 'chalk', 'chaos', 'chroma',
    'cinder', 'clawed', 'coastal', 'cobalt', 'copper', 'coral', 'cryo', 'crypto', 'cyan', 'cyclone',
    'delta', 'digital', 'dread', 'dusk', 'elder', 'emerald', 'fabled', 'fanged', 'feline', 'feral',
    'ferro', 'fleet', 'flint', 'gamma', 'garnet', 'glacial', 'granite', 'grim', 'helio', 'hex',
    'indigo', 'infra', 'ion', 'ionic', 'ivory', 'jet', 'kinetic', 'laser', 'lazuli', 'lilac',
    'lithe', 'litho', 'logic', 'lucid', 'lupine', 'lyra', 'mach', 'magenta', 'magma', 'marble',
    'matrix', 'matte', 'mauve', 'mica', 'micro', 'molten', 'monsoon', 'mystic', 'mythic', 'nickel',
    'nimble', 'nitro', 'ochre', 'olivine', 'omen', 'opal', 'optic', 'orbital', 'orion', 'oxide',
    'pastel', 'pearl', 'photon', 'plasma', 'plumed', 'polar', 'presto', 'primal', 'proto', 'prowl',
    'quartz', 'radiant', 'raptor', 'raster', 'rime', 'runic', 'russet', 'sable', 'saffron',
    'scaled', 'scarlet', 'seismic', 'sepia', 'shale', 'silica', 'slate', 'spry', 'starlit',
    'static', 'stealth', 'steel', 'striped', 'tawny', 'teal', 'tempest', 'tera', 'thermal',
    'thunder', 'tidal', 'tigris', 'titan', 'topaz', 'turbo', 'tusked', 'ultra', 'umber', 'umbra',
    'umbral', 'ursine', 'vector', 'vega', 'velvet', 'verdant', 'vesper', 'violet', 'virtual',
    'vivid', 'volt', 'vulpine', 'warp', 'winged', 'wyrd', 'zenith', 'zircon',
]

export const USERNAME_NOUNS = [
    'wolf', 'ape', 'bear', 'bull', 'fox', 'owl', 'lynx', 'node', 'hash', 'byte', 'flux', 'punk',
    'bot', 'dex', 'dao', 'whale', 'shark', 'hawk', 'lion', 'forge', 'mint', 'vault', 'grid', 'core',
    'nexus', 'apex', 'echo', 'vibe', 'pulse', 'dash', 'adder', 'aegis', 'albedo', 'alloy', 'anode',
    'anvil', 'arrow', 'ashlar', 'atoll', 'aura', 'badger', 'banshee', 'beacon', 'beam', 'bedrock',
    'beluga', 'bison', 'blur', 'boar', 'bolt', 'boulder', 'brick', 'buffer', 'bullion', 'burst',
    'cache', 'cairn', 'caldera', 'candela', 'capsule', 'carbide', 'cascade', 'cathode', 'cavern',
    'centaur', 'chasm', 'chimera', 'chisel', 'cicada', 'cipher', 'cobble', 'cobra', 'codec',
    'comet', 'condor', 'coyote', 'crag', 'crater', 'crow', 'cyborg', 'cygnus', 'daemon', 'dart',
    'dingo', 'dolmen', 'dragon', 'drifter', 'drone', 'dryad', 'dune', 'eagle', 'eclipse', 'egret',
    'elk', 'ember', 'enamel', 'ermine', 'facet', 'falcon', 'fang', 'faun', 'ferrite', 'finch',
    'fjord', 'flare', 'flicker', 'foundry', 'galaxy', 'gale', 'gem', 'geode', 'geyser', 'girder',
    'glacier', 'glaze', 'gleam', 'glimmer', 'glint', 'gloss', 'glyph', 'gnome', 'goblin', 'griffin',
    'grotto', 'gust', 'halo', 'hare', 'helix', 'heron', 'hive', 'hornet', 'imp', 'ingot', 'jolt',
    'kelpie', 'kernel', 'kudu', 'lander', 'lantern', 'lark', 'lattice', 'lemur', 'lich', 'lumen',
    'magnet', 'magpie', 'manta', 'mantis', 'marlin', 'marten', 'menhir', 'mesa', 'meteor', 'mink',
    'mirage', 'modem', 'moose', 'motor', 'nebula', 'nimbus', 'nomad', 'nugget', 'obelisk', 'ocelot',
    'okapi', 'orbit', 'ore', 'oryx', 'osprey', 'packet', 'pebble', 'petrel', 'pillar', 'pixie',
    'plateau', 'plume', 'prism', 'proxy', 'puffin', 'pulsar', 'quark', 'quarry', 'quasar', 'quill',
    'racer', 'ravine', 'reef', 'relay', 'rider', 'ridge', 'rivet', 'roc', 'rocket', 'rook', 'rotor',
    'router', 'rover', 'rune', 'scout', 'scree', 'script', 'selkie', 'sentry', 'serval', 'shade',
    'shard', 'sheen', 'shimmer', 'shrike', 'shuttle', 'slab', 'smelter', 'socket', 'spark',
    'spectra', 'sphinx', 'spire', 'squall', 'steppe', 'stoat', 'stone', 'strata', 'summit', 'swarm',
    'swoop', 'sylph', 'taiga', 'talon', 'tapir', 'tarn', 'tektite', 'tempo', 'thorn', 'torch',
    'tremor', 'tusk', 'undine', 'vortex', 'voyager', 'walrus', 'whirl', 'wraith', 'wren', 'wyrm',
    'wyvern', 'zephyr',
]

const sec = (liste, rastgele) => liste[Math.floor(rastgele() * liste.length)]

// Bir cift KIRPILMADAN kullanilabilir mi?
//
// ESKI DAVRANIS VE DUZELTILEN HATA: ad 15 harfi gectiginde `substring(0, 15)`
// uygulaniyordu ve kirpilan sey TAM OLARAK adresten gelen ektir:
//     quantum + Crimson + 739  ->  "quantumCrimson7"
// Ek gidince ad BENZERSIZ OLMAKTAN CIKAR; iki kullanici ayni ada dusebilir ve
// ikincisi sunucudan "bu ad alinmis" yiyerek elle ad uydurmak zorunda kalir.
// Havuzu buyutmek bu hatayi SIKLASTIRIRDI (uzun kelime daha cok), o yuzden
// kirpma tumden kaldirildi: cift ZATEN sigacak sekilde secilir.
const sigarMi = (onek, isim) => onek.length + isim.length + EK_IKI_KELIME <= MAX_USERNAME_LENGTH

/**
 * @param {object} [opts]
 * @param {string|null} [opts.address]  EVM adresi. Yoksa ek rastgele rakamdan uretilir
 *   -- bu ekrana kasa cozulmeden de gelinebiliyor.
 * @param {() => number} [opts.rastgele]  [0,1) uretir. Testler icin enjekte edilebilir;
 *   uygulamada `Math.random`.
 * @returns {string} 3-15 karakter, yalnizca [a-zA-Z0-9]
 */
export function generateUsername({ address = null, rastgele = Math.random } = {}) {
    const ikiKelime = rastgele() > 0.5

    if (ikiKelime) {
        const onek = sec(USERNAME_PREFIXES, rastgele)
        // Yalnizca SIGAN isimler arasindan secilir. Bos kalmasi imkansiz: her iki
        // havuzda da en kisa kelime 3 harf ve 7 + 3 + 3 = 13 <= 15. Yine de
        // bos kalirsa tek kelime kalibina duselim -- sessiz bir `undefined`
        // "undefined739" gibi bir ad uretirdi.
        const sigan = USERNAME_NOUNS.filter((n) => sigarMi(onek, n))
        if (sigan.length) {
            const isim = sec(sigan, rastgele)
            const ek = address ? String(address).slice(-EK_IKI_KELIME)
                : String(Math.floor(100 + rastgele() * 900))
            return onek + isim.charAt(0).toUpperCase() + isim.slice(1) + ek
        }
    }

    // Tek kelime: her iki havuz da aday. 7 + 6 = 13 <= 15, kirpma GEREKMEZ.
    const kelime = sec([...USERNAME_PREFIXES, ...USERNAME_NOUNS], rastgele)
    const ek = address ? String(address).slice(-EK_TEK_KELIME)
        : String(Math.floor(100000 + rastgele() * 900000))
    return kelime + ek
}
