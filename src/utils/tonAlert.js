// TonConnect ag / hesap uyusmazligi UYARI penceresi (B2) -- arka plan tarafi.
//
// rpc.md:100,104 ve wallet-guidelines.md: istekteki network ya da from
// cuzdanla uyusmazsa cuzdan UYARI gostermeli, gonderime izin vermemeli ve ag/
// hesap degistirmeyi ONERMEMELI. Dapp'e kod 1 cagiran tarafindan zaten
// verildi; bu pencere yalniz kullaniciya nedenini soyler.
//
// openApprovalWindow'dan GECMEZ (bekleyen bir onayi 300'le iptal ederdi);
// pendingRequests'e kaydolmaz, current_request'e dokunmaz. Sayfa spam'ine
// karsi: ayni anda tek pencere, host basina 10 sn'de en fazla bir uyari.

const ANAHTAR = 'ton_alert'
const SAYFA = 'src/popup/index.html#alert'
const ARALIK_MS = 10000
// openApprovalWindow ile AYNI dis boyut ve capa: altta acik bir onay varsa
// TAMAMEN ortulur. Kisa olsaydi onayin Reddet/Onayla seridi acikta kalirdi.
const GENISLIK = 360
const YUKSEKLIK = 600
const TURLER = new Set(['network', 'from'])

// hostname -> son uyari zamani. SW yeniden baslarsa sifirlanir; tek pencere
// kurali depodaki windowId ile yine korunur.
const sonUyari = new Map()

// Isler SIRAYLA: es zamanli iki uyumsuzluk ikisi de "pencere yok" okuyup iki
// pencere acmasin; kapanis temizligi de ayni siraya girer.
let sira = Promise.resolve()

function siraya(is) {
    const sonuc = sira.then(is).catch((e) => {
        console.error('[tonconnect] uyari penceresi:', e?.message ?? e)
    })
    sira = sonuc
    return sonuc
}

// Dapp verisi depoya SINIRLI yazilir. Dize olmayan deger null: opak ag
// kimligi -239 (sayi) '-239' ile uyusmaz, ekranda "Mainnet istedi, cuzdan
// Mainnet'te" gibi celiskili bir metin cikmasin.
const kirp = (v, sinir = 128) => (typeof v === 'string' ? v.slice(0, sinir) : null)

/**
 * Kayitli pencere HALA bizim uyari sayfamiz mi? Tarayici yeniden baslayinca
 * pencere kimlikleri bastan sayilir; eski kimlik alakasiz bir pencereye denk
 * gelirse o one getirilir ve uyari hic gorunmezdi.
 */
async function acikUyariPenceresi(windowId) {
    if (typeof windowId !== 'number') return null
    try {
        const w = await chrome.windows.get(windowId, { populate: true })
        const url = chrome.runtime.getURL(SAYFA)
        const bizim = Array.isArray(w?.tabs) && w.tabs.some((t) => t?.url === url || t?.pendingUrl === url)
        return bizim ? windowId : null
    } catch {
        return null
    }
}

// openApprovalWindow ile ayni yer: son odakli pencerenin sag ust kosesi.
async function konum() {
    try {
        const son = await chrome.windows.getLastFocused()
        if (son && son.width && son.left !== undefined) return { left: son.left + son.width - GENISLIK, top: son.top }
    } catch {}
    return {}
}

async function uyariGoster({ kind, hostname, appName, requested, expected, network } = {}) {
    if (!TURLER.has(kind)) return
    const host = kirp(hostname) ?? ''
    const simdi = Date.now()
    for (const [h, zaman] of sonUyari) {
        if (simdi - zaman >= ARALIK_MS) sonUyari.delete(h)
    }
    // Kisilan host hicbir sey yapmaz: acik pencereyi one de getirmez.
    if (sonUyari.has(host)) return
    sonUyari.set(host, simdi)

    const kayit = {
        id: crypto.randomUUID(),
        kind,
        hostname: host,
        appName: kirp(appName, 64),
        requested: kirp(requested),
        expected: kirp(expected),
        network: kirp(network),
        createdAt: simdi,
    }

    const { [ANAHTAR]: onceki } = await chrome.storage.local.get(ANAHTAR)
    const acik = await acikUyariPenceresi(onceki?.windowId)
    if (acik !== null) {
        await chrome.storage.local.set({ [ANAHTAR]: { ...kayit, windowId: acik } })
        try { await chrome.windows.update(acik, { focused: true }) } catch {}
        return
    }

    // Kayit pencereden ONCE yazilir: sayfa acilir acilmaz onu bulsun.
    await chrome.storage.local.set({ [ANAHTAR]: { ...kayit, windowId: null } })
    const pencere = await chrome.windows.create({
        url: chrome.runtime.getURL(SAYFA),
        type: 'popup',
        width: GENISLIK,
        height: YUKSEKLIK,
        ...(await konum()),
        focused: true,
    })
    // Arada kullanici Kapat'a bastiysa (kayit silindi) kayit diriltilmez.
    const { [ANAHTAR]: simdiki } = await chrome.storage.local.get(ANAHTAR)
    if (simdiki?.id === kayit.id) {
        await chrome.storage.local.set({ [ANAHTAR]: { ...simdiki, windowId: pencere?.id ?? null } })
    }
}

/**
 * Uyari penceresini gosterir ya da acik olani gunceller. Hic firlatmaz:
 * cagiran dapp'e yanitini coktan vermistir.
 * @param {{kind:'network'|'from', hostname:string, appName?:string, requested:any, expected:string, network?:string}} girdi
 */
export function showTonAlert(girdi) {
    return siraya(() => uyariGoster(girdi))
}

async function pencereKapandi(windowId) {
    const { [ANAHTAR]: kayit } = await chrome.storage.local.get(ANAHTAR)
    if (kayit && kayit.windowId === windowId) await chrome.storage.local.remove(ANAHTAR)
}

// Modul ust duzeyinde: MV3'te dinleyici SW her uyandiginda yeniden kurulmali.
chrome.windows.onRemoved.addListener((windowId) => {
    if (typeof windowId !== 'number') return
    siraya(() => pencereKapandi(windowId))
})
