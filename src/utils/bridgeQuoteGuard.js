import { ethers } from 'ethers'

// KOPRU ALICI KORUMASI (gizli-mod cok-ag spec 4.6, P10). IKI MODDA DA calisir; gizli moda ozel degildir.
//
// ACIK: background bridge() arayuzden gelen to/data/value/approvalAddress'i alici denetimi olmadan imzalardi.
// Bayat bir teklif (hesap ya da gizli mod degisti) modlar arasinda bag kurabilirdi: Gizli Hesap imzalar ama
// teklifin alicisi eski (genel) adrestir, ya da tersi.
//
// COZUM IKI PARCA:
//   1) getBridgeQuote: LI.FI yanitinin action.toAddress'i (ve varsa fromAddress'i) imzaciya esit degilse teklif
//      arayuze DONMEZ (BRIDGE_RECEIVER_MISMATCH). Gecerli teklif icin oturum deposuna { signer, approval,
//      createdAt } kaydi yazilir (rememberBridgeQuote).
//   2) bridge() ve atsBridgeFeeQuote(): mesajdaki (zincir, to, data, value) ile ayni anahtari yeniden hesaplar
//      (assertBridgeQuoteBound). Kayit yoksa BRIDGE_QUOTE_NOT_FOUND; imzaci ayni degilse ya da onay adresi
//      kayittakinden farkliysa BRIDGE_RECEIVER_MISMATCH. Imzadan ONCE durulur.
//
// ARTIK RISK (kabul edildi, spec 4.6): LI.FI yaniti action.toAddress'te dogru adresi gosterip cagri verisinde
// (data) baska bir alici tasirsa bu denetim yakalamaz. Cagri verisi COZULMEZ; LI.FI'ye guven suruyor.

export const BRIDGE_QUOTES_KEY = 'bridge_quotes'
export const BRIDGE_QUOTE_TTL_MS = 10 * 60 * 1000
export const BRIDGE_QUOTE_MAX = 20
export const BRIDGE_RECEIVER_MISMATCH = 'BRIDGE_RECEIVER_MISMATCH'
export const BRIDGE_QUOTE_NOT_FOUND = 'BRIDGE_QUOTE_NOT_FOUND'

// Arayuz iki kodu AYNI cumleyle gosterir (bridge.quoteStale) ve teklifi yeniden ister.
export const isBridgeQuoteRefusal = (code) => code === BRIDGE_RECEIVER_MISMATCH || code === BRIDGE_QUOTE_NOT_FOUND

const refusal = (code) => new Error(code)

// Yalniz bos olmayan dizgeler adrestir; harf buyuklugu onemsiz (LI.FI kucuk harf, cuzdan checksum dondurur).
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== '' && a.toLowerCase() === b.toLowerCase()

// Teklif kaydinin anahtari: arayuzun gonderimde AYNEN geri yolladigi (zincir, to, data, value) dortlusu.
// to ve data kucuk harfe cevrilir, value dizgedir; zincir mesajdaki alandan sayiya cevrilir. Cozulemeyen
// girdi null verir (kayit yazilamaz / bulunamaz).
export function bridgeQuoteKey(chain, to, data, value) {
    const chainId = Number(chain)
    if (!Number.isInteger(chainId) || chainId <= 0) return null
    if (typeof to !== 'string' || to === '' || typeof data !== 'string') return null
    return ethers.id(JSON.stringify([chainId, to.toLowerCase(), data.toLowerCase(), String(value ?? '')]))
}

// Gecerli kayit: imzaci dizge, createdAt sayi ve 0 <= yas < omur. Saat geri alinirsa (negatif yas) kayit
// kanitlanamaz sayilir; fail-closed.
function isLive(rec, now) {
    if (!rec || typeof rec !== 'object') return false
    if (typeof rec.signer !== 'string' || typeof rec.createdAt !== 'number') return false
    const age = now - rec.createdAt
    return age >= 0 && age < BRIDGE_QUOTE_TTL_MS
}

function liveEntries(all, now) {
    if (!all || typeof all !== 'object' || Array.isArray(all)) return []
    return Object.entries(all).filter(([, rec]) => isLive(rec, now))
}

// Oturum deposu withStorageList kuyrugunun disindadir: es zamanli iki teklif (popup + yan panel) ayni eski
// haritayi okuyup birbirinin kaydini silerdi. Okuma-degistirme-yazma bu modul ici kuyrukta seri yapilir; bir
// cagrinin hatasi sonrakini tikamaz (privateOrderStore.saveQuoteRecord ile ayni desen).
let writeQueue = Promise.resolve()

async function writeRecord(session, key, entry, now) {
    const { [BRIDGE_QUOTES_KEY]: all } = await session.get(BRIDGE_QUOTES_KEY)
    // Omru dolanlar atilir, ayni anahtar yeniden yazilirsa createdAt tazelenir, en yeni BRIDGE_QUOTE_MAX kalir.
    const kept = liveEntries(all, now).filter(([k]) => k !== key)
    kept.push([key, { ...entry, createdAt: now }])
    kept.sort((a, b) => a[1].createdAt - b[1].createdAt)
    await session.set({ [BRIDGE_QUOTES_KEY]: Object.fromEntries(kept.slice(-BRIDGE_QUOTE_MAX)) })
}

// getBridgeQuote'tan SONRA, yaniti arayuze vermeden ONCE cagrilir. `quote` LI.FI /quote yanitidir, `signer`
// teklifi isteyen cuzdanin adresi. Alici imzaciya bagli degilse ya da kayit anahtari kurulamiyorsa
// BRIDGE_RECEIVER_MISMATCH firlatir ve HICBIR SEY yazmaz.
export async function rememberBridgeQuote(session, { fromChain, quote, signer, now = Date.now() }) {
    const action = quote?.action
    const tx = quote?.transactionRequest
    // toAddress ZORUNLU; fromAddress yanitta varsa o da imzaci olmali.
    if (!sameAddress(action?.toAddress, signer)) throw refusal(BRIDGE_RECEIVER_MISMATCH)
    if (action.fromAddress !== undefined && !sameAddress(action.fromAddress, signer)) throw refusal(BRIDGE_RECEIVER_MISMATCH)

    const key = bridgeQuoteKey(fromChain, tx?.to, tx?.data, tx?.value)
    if (!key) throw refusal(BRIDGE_RECEIVER_MISMATCH)

    // Onay adresi: LI.FI estimate.approvalAddress'i soyluyorsa o, yoksa islemin kendi hedefi (buildBridgeCalls'taki
    // `approvalAddress || to` kuraliyla ayni).
    const approvalAddress = quote.estimate?.approvalAddress
    const approval = typeof approvalAddress === 'string' && approvalAddress !== '' ? approvalAddress : tx.to

    const run = writeQueue.then(() => writeRecord(session, key, { signer, approval }, now))
    writeQueue = run.catch(() => {})
    await run
}

// bridge() ve atsBridgeFeeQuote() icin: cuzdan kurulduktan HEMEN sonra, ATS / gazsiz / yerel dallardan ONCE.
// `approvalAddress` mesajda varsa (ATS kolu) kayittaki onay adresine esit olmalidir; bos/yoksa denetlenmez
// (buildBridgeCalls o durumda `to`'yu kullanir ve `to` anahtarla zaten baglidir).
export async function assertBridgeQuoteBound(session, { chain, to, data, value, approvalAddress, signer, now = Date.now() }) {
    const key = bridgeQuoteKey(chain, to, data, value)
    if (!key) throw refusal(BRIDGE_QUOTE_NOT_FOUND)
    const { [BRIDGE_QUOTES_KEY]: all } = await session.get(BRIDGE_QUOTES_KEY)
    // Miras alinan ozellikler kayit degildir.
    const rec = all && typeof all === 'object' && Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null
    if (!isLive(rec, now)) throw refusal(BRIDGE_QUOTE_NOT_FOUND)
    if (!sameAddress(rec.signer, signer)) throw refusal(BRIDGE_RECEIVER_MISMATCH)
    if (approvalAddress && !sameAddress(approvalAddress, rec.approval)) throw refusal(BRIDGE_RECEIVER_MISMATCH)
}
