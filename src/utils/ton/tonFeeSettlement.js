// TON ucret makbuzunun KALICI deposu.
//
// atsPaymaster.js (satir ~600-690) ayni problemi EVM icin cozuyor: capraz-zincirde
// ucret imzadan once tahsil edilir, makbuz (settlementId + atsFee) yalniz sendOneOp'un
// yerel degiskeninde tutulursa MV3 service worker'inin HERHANGI bir await'te
// sonlandirilmasi odenmis ucretin tek kanitini yok eder. Orada TAM OLARAK bu yasandi:
// kullanici tekrar denedi, sunucu yeni bir tahsilat yapti, ayni op icin IKI KEZ odendi
// (2026-08-08, 6,9 ATS).
//
// TON'un gerekcesi EVM'inkinden DAHA SERT, daha hafif degil: EVM'de ucret kullanicinin
// KENDI op'unun icinde ve op geri donerse (revert) paymaster'in postOp'u ucreti de geri
// alir. TON'da ucret AYRI bir tahsilat, gonderimden ONCE alinir ve IADESI YOKTUR - relay
// hic gitmese bile tahsil edilen ATS geri gelmez. Diskteki makbuz bu pencerede tek
// kanittir; yazilmazsa odenen ucretin izini surecek hicbir sey kalmaz.
//
// EVM'in ayni amacli deposuyla (atsPaymaster.js'teki SETTLEMENT_STORE_KEY, "ats_" onekli)
// PAYLASILMAZ - asagidaki anahtar bilerek farkli. Ortak depo, birinin budama/serialize
// hatasini digerinin kayitlarina bulastirir - TON tarafinda boyle bir hata EVM
// makbuzlarini da riske atar, ya da tersi.
//
// Kayit anahtari (tonSettlementKey) actionHash'e baglidir, seqno'ya DEGIL. seqno TON'da
// cuzdanin HERHANGI bir gonderiminde artar - ERC-4337 nonce'unun aksine islem basina
// kimlik degildir: ayni seqno farkli bir eylemi, farkli seqno ayni eylemi gosterebilir.
// seqno anahtar olsaydi, tahsilat ile kurtarma arasinda kullanicinin yaptigi ILGISIZ bir
// baska TON gonderimi makbuzu "bulunamaz" hale getirir ve odenmis ucret kalici olarak
// kaybolurdu. seqno yine de kayit ALANI olarak tasinir (relay yeniden denemesinde
// sunucuya gider) - yalniz anahtarda degil.
//
// Imzali yuk (payloadBoc + iki imza) diskte SIFRESIZ bekliyor, deadline'a kadar (design
// bolum 10 R7). Bu bilincli bir takas, sessizce yapilmiyor: yerelde calisan kotu niyetli
// bir surec bu kaydi gecikmeli oynatabilir, ama yapabilecegi tek sey kullanicinin ZATEN
// onayladigi islemi tetiklemektir - suresi deadline'da doluyor, basarida kayit aninda
// siliniyor. Alternatifi (anahtar gerektiren bir kurtarma semasi) kilitli cuzdanda hic
// calismaz, cunku kurtarmanin gerekli oldugu an tam da cuzdanin kilitli oldugu andir - o
// yuzden daha kotu bir secim olurdu.
const SETTLEMENT_STORE_KEY = 'ton_pending_settlements'
// Makbuz bu kadar bekledikten sonra zaten kullanilamaz (fiyat/gaz alanlari bayatlar,
// deadline coktan gecmis olur); kayit sonsuza kadar birikmesin.
const SETTLEMENT_TTL_MS = 24 * 60 * 60 * 1000

// chrome.storage vitest'in node ortaminda YOKTUR (eklenti disi baglamlarda da olmayabilir).
// Yoksa depo null'dur ve akis eski BELLEK ICI davranisa duser - patlamaz. Testler
// _setTonSettlementStore ile kendi sahte deposunu enjekte eder.
let settlementStoreOverride
export const _setTonSettlementStore = (store) => { settlementStoreOverride = store }
function settlementStore() {
  if (settlementStoreOverride !== undefined) return settlementStoreOverride
  try {
    if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) {
      return chrome.storage.local
    }
  } catch { /* eklenti disi baglam */ }
  return null
}

// 0x on eki ve buyuk/kucuk harf farki actionHash'i iki farkli anahtara bolerdi; sunucu ve
// tonQuoteVerify.js (Task 2, hexEsit) bu degeri farkli bicimlerde tasiyabilir.
function hexsiz(v) {
  return String(v ?? '').trim().toLowerCase().replace(/^0x/, '')
}

// Anahtar actionHash'e baglidir, seqno'ya DEGIL - bkz. dosya basi yorumu.
export const tonSettlementKey = ({ tonWallet, actionHash }) =>
  `${tonWallet}:${hexsiz(actionHash)}`

async function readSettlements() {
  const store = settlementStore()
  if (!store) return {}
  try {
    const all = await store.get(SETTLEMENT_STORE_KEY)
    const map = all && all[SETTLEMENT_STORE_KEY]
    return map && typeof map === 'object' ? map : {}
  } catch { return {} }
}

// `true`/`false` DONER (review bulgusu 4, gorev 6): tonFeeRelayer relay'i cagirmadan once
// makbuzun GERCEKTEN diske indigini bilmek zorunda - depo yoksa ya da `set()` firlarsa
// (orn. chrome.storage.local kota asimi) sessizce yutup devam etmek, ucretin alinip HICBIR
// kanit birakilmadigi tam da bu sirayi var eden senaryodur.
async function writeSettlements(map) {
  const store = settlementStore()
  if (!store) return false
  try {
    await store.set({ [SETTLEMENT_STORE_KEY]: map })
    return true
  } catch {
    return false
  }
}

// savedAt (ms, Date.now()) BU depolamanin kendi ic muhasebesidir - feeAuth.deadline
// (saniye, sunucudan geldigi gibi tasinir) ile KARISTIRILMAZ. Ikisi ayni kayitta farkli
// birimlerde durur; kilit kontrolu (hasUnsettledTonFee) yalniz deadline'a bakar.
export function pruneTonSettlements(map, now = Date.now()) {
  const out = {}
  for (const [k, v] of Object.entries(map || {})) {
    const at = Number(v && v.savedAt)
    if (Number.isFinite(at) && now - at < SETTLEMENT_TTL_MS) out[k] = v
  }
  return out
}

// @returns {Promise<boolean>} `true` YALNIZ yazma GERCEKTEN diske indiginde. Cagiran
// (tonFeeRelayer) bunu ONCE saklamadan relay'e gitmemek icin kontrol eder - "ucreti
// almadan once kanitini yazdim mi" sorusunun tek cevabi budur.
export async function saveTonSettlement(rec) {
  const store = settlementStore()
  if (!store) return false
  const map = pruneTonSettlements(await readSettlements())
  map[tonSettlementKey(rec)] = { ...rec, savedAt: Date.now() }
  return await writeSettlements(map)
}

export async function loadAllTonSettlements() {
  return pruneTonSettlements(await readSettlements())
}

// Var olan kaydi yamalar; anahtar yoksa hicbir sey yapmaz. Diger kayitlara
// dokunmadan tek kaydi guncelleyebilmek relay sonucuna gore faz yukseltmek icin gerekli
// (design bolum 6: 'relay-inflight' -> 'collected'/'unresolved' ya da silme).
//
// @returns {Promise<boolean>} `true` YALNIZ yama GERCEKTEN diske indiginde.
//   Anahtar yoksa `false`: yamalanacak kayit da yok, yani yazma INMEDI - cagirana
//   "yamaladim" demek yanlis olurdu (bkz. asagidaki ortak not).
export async function updateTonSettlement(key, patch) {
  const store = settlementStore()
  if (!store) return false
  const map = pruneTonSettlements(await readSettlements())
  if (!map[key]) return false
  map[key] = { ...map[key], ...patch }
  return await writeSettlements(map)
}

// SILME de BOOLEAN doner - "sildim" ile "SILINDI" ayni sey degil (gorev 10,
// yukumluluk 3). Bu ayrim somut: relay basariyla dondugunde cagiran once islem
// durumunu 'success' yazar, SONRA makbuzu siler; silme sessizce duserse kayit
// canli fazda kalir ve bir sonraki kurtarma turu onu yeniden isler. Cagiranin bunu
// GOREBILMESI gerekiyor - eskiden goremiyordu ve tonFeeRecovery.js bu yuzden her
// yazmadan sonra depoyu GERI OKUMAK zorundaydi (patchDurably).
//
// @returns {Promise<boolean>} `true` YALNIZ silme GERCEKTEN diske indiginde.
export async function clearTonSettlement(key) {
  const store = settlementStore()
  if (!store) return false
  const map = pruneTonSettlements(await readSettlements())
  delete map[key]
  return await writeSettlements(map)
}

// Kilidin cikisi deadline'dir, TTL DEGIL (design bolum 6 sonu). TTL'ye (24 saat)
// baglansaydi, cozulmemis bir makbuz o sure boyunca kilitler; kullanici bu arada bagimsiz
// bir TON gonderimi yaparsa SEQNO ILERLER ve saklanan payloadBoc (belirli bir seqno'ya
// kilitli) kalici olarak KULLANILAMAZ hale gelir - ucret zaten alinmis, islem hicbir zaman
// gitmemis olur. deadline ise saniyeler-dakikalar mertebesinde (relay penceresi) ve
// feeAuth.deadline ile AYNI birimde (unix saniye, sunucudan geldigi gibi) tasinir - bkz.
// tonQuoteVerify.js'in kendi `now` parametresi, ayni sozlesme.
export function hasUnsettledTonFee(settlements, now = Math.floor(Date.now() / 1000)) {
  if (!settlements || typeof settlements !== 'object') return false
  for (const rec of Object.values(settlements)) {
    if (!rec || typeof rec !== 'object') continue
    // 'unresolved': govde zaten olu sayilir (design bolum 6 - actionHash zincirde
    // dogrulanamadi). Kullaniciyi bu fazda kalici kilitlemek, dogrulanamayan bir hayalet
    // islem yuzunden cuzdani tikamak olur - kilit yalniz gercekten canli fazlar icindir.
    if (rec.phase !== 'relay-inflight' && rec.phase !== 'collected') continue
    const deadline = Number(rec.deadline)
    if (!Number.isFinite(deadline)) continue
    if (now <= deadline) return true
  }
  return false
}
