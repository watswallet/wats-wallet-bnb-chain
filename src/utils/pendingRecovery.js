// SW yeniden basladiginda / popup acildiginda bekleyen islem kartlarini cozer ve takili kartlari temizler.
// background.js'ten tasindi (test edilebilirlik); bagimliliklar parametredir.
//
// GIZLI MOD KAPISI: activeIsPrivate() ilk satirdir; gizli modda HICBIR RPC atilmaz ve kart degismez.
// GIZLI HESAP KARTLARI (accountKey = gizli hesap) gizli moddan cikinca da normal IP'den ASLA sorgulanmaz;
// zincirde gerceklesmis islemi 'basarisiz' gostermek cift odemeye iter, bu yuzden hash'li gizli kart
// 'processing'+txHash ("Gonderildi") KALIR ve yalniz 24 saat siniriyla sonlanir.
//
// Belirsiz sonuclu (pending) gonderimlerde pending kart cozumu recoverStuckCards'a birakilir (hash'siz 5 dk, userOpHash'li ATS 24 saat).

// Hash'siz 'queued'/'processing' kart: SW olunce kuyruk bellekle gider; sonsuz "kuyrukta" kalmasin.
export const STUCK_NO_HASH_MS = 5 * 60 * 1000
// Hash'li kart makbuzsuz/belirsiz kalirsa tavan (pendingTransactions.PENDING_MAX_AGE_MS ile ayni deger).
export const STUCK_WITH_HASH_MS = 24 * 60 * 60 * 1000

const errorMeta = (code) => ({ errorCode: code, errorDetail: null, error: null })

/**
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.activeIsPrivate
 * @param {() => Promise<string|null>} deps.privateAccountKey   gizli hesabin kart etiketi (yoksa null)
 * @param {Array} deps.supportedChains
 * @param {(chain) => {getTransactionReceipt: Function}} deps.providerFactory
 * @param {(chainId) => ({entryPoint: string}|null)} deps.getAtsConfig
 * @param {Function} deps.extractUserOpSuccess   (receipt, entryPoint, userOpHash) => true|false|null
 * @param {() => number} deps.now
 * @param {() => Promise<Array>} deps.readCards       current_transactions'i okur
 * @param {(fn: (list: Array) => any) => Promise} deps.mutateCards  taze liste uzerinde oku-degistir-yaz
 */
export async function recoverStuckCards(deps) {
  const { activeIsPrivate, supportedChains, providerFactory, readCards, mutateCards } = deps
  if (await activeIsPrivate()) return
  const snapshot = await readCards()
  const now = deps.now()
  let privKey = null
  try { privKey = (await deps.privateAccountKey?.()) || null } catch { privKey = null }
  const patches = new Map() // kart id -> { status, meta }

  for (const ctx of snapshot) {
    if (!ctx || (ctx.status !== 'processing' && ctx.status !== 'queued')) continue
    const meta = ctx.meta || {}
    const age = Number.isFinite(ctx.timestamp) ? now - ctx.timestamp : 0
    const hasHash = !!(meta.txHash && meta.chainId)

    if (!hasHash) {
      // Yalniz userOpHash'i olan ATS karti: islem zincire gitmis olabilir; 5 dk'da 'error' yazilmaz, yalniz 24 saat siniri.
      if (meta.ats === true && meta.userOpHash) {
        if (age > STUCK_WITH_HASH_MS) patches.set(ctx.id, { status: 'error', meta: errorMeta('TX_DROPPED'), onlyIfNoHash: true })
        continue
      }
      if (age > STUCK_NO_HASH_MS) patches.set(ctx.id, { status: 'error', meta: errorMeta('TX_DROPPED'), onlyIfNoHash: true })
      continue
    }
    if (ctx.status !== 'processing') continue

    const isPrivateCard = !!privKey && ctx.accountKey === privKey
    const expire = () => { if (age > STUCK_WITH_HASH_MS) patches.set(ctx.id, { status: 'error', meta: errorMeta('TX_DROPPED') }) }
    if (isPrivateCard) { expire(); continue } // RPC YOK
    // txHash aslinda userOp hash'i (gazsiz/token-gas kolu): TX makbuzu bu hash'le ASLA bulunmaz; 'basarisiz' demek
    // gerceklesmis islemi hataya cevirir (cift odeme). Makbuzla cozulemez: sorgulanmaz, 24 saatte de error yazilmaz.
    if (meta.userOpHash && meta.userOpHash === meta.txHash) continue

    try {
      const found = supportedChains.find((c) => c.chainId === meta.chainId)
      if (!found) { expire(); continue }
      const provider = providerFactory(found)
      const receipt = await provider.getTransactionReceipt(meta.txHash)
      if (!receipt) { expire(); continue }
      if (receipt.status === 0) {
        patches.set(ctx.id, { status: 'error', meta: errorMeta('ONCHAIN_FAILED') })
      } else if (meta.ats === true) {
        // ATS: TX status 1 userOp ic revert'unu gizler; kesin sonuc yalniz UserOperationEvent.
        const cfg = deps.getAtsConfig?.(meta.chainId)
        // userOpHash yoksa olay baska kullanicilarin op'lariyla karisabilir: dogrulanamaz, 'processing' kalir.
        const ok = (cfg && meta.userOpHash) ? deps.extractUserOpSuccess(receipt, cfg.entryPoint, meta.userOpHash) : null
        if (ok === true) patches.set(ctx.id, { status: 'success' })
        else if (ok === false) patches.set(ctx.id, { status: 'error', meta: errorMeta('USEROP_FAILED') })
        else expire() // olay yok: 'success' ASLA yazilmaz
      } else {
        patches.set(ctx.id, { status: 'success' })
      }
    } catch (e) { expire() /* hata: karar verilmez, yalniz 24 saat tavani */ }
  }
  if (patches.size === 0) return
  // Sorgular agda dakikalar surebilir: yama TAZE liste uzerine id ile eslenir, anlik goruntu geri yazilmaz.
  await mutateCards((list) => {
    let changed = false
    for (const c of list) {
      const p = patches.get(c.id)
      if (p && (c.status === 'processing' || c.status === 'queued')) {
        // Hash'siz karar, snapshot'tan sonra canli akis hash yazdiysa hash'li karta UYGULANMAZ.
        if (p.onlyIfNoHash && c.meta?.txHash && c.meta?.chainId) continue
        c.status = p.status
        if (p.meta) c.meta = { ...(c.meta || {}), ...p.meta }
        changed = true
      }
    }
    return changed ? list : undefined
  })
}
