// Al/Sat ekraninda ihracci gecisi (bStocks <-> xStocks). Spec 5.3, TK13.
//
// SOZLESME
// - Secenekler YALNIZ katalogdan gelir (`issuerOptions` -> `stockEntry`). Ekrandaki / store'daki
//   serbest adres hic kullanilmaz: hedef satir her zaman donuk katalog kaydidir.
// - CUZDANIN AKTIF AGI DEGISMEZ (kullanici karari 2026-10-23): ihracci degisince hedef satir baska
//   zincirde olsa bile `applyNetworkChange` CAGRILMAZ; yalniz `selected_token_ref` hedef satira yazilir.
//   Teklif, bakiye ve emir hissenin zincirinden calisir (StockTrade ag kilidi yok).
// - `selected_token_ref` (+ `selected_token_id`) hedef satira yazilir ve `onSwitched`
//   ({ issuer, row, payToken }) atesler: ekran tutari, teklifi ve odeme tokenini sifirlar
//   (mevcut `setSide` kalibi). payToken hedef zincirin varsayilanidir (`defaultPayToken`).
import { computed } from 'vue'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { XSTOCKS_ENABLED } from '../utils/featureFlags'
import { stockEntry } from '../utils/tokenizedStocks'
import { issuerOptions, companyRows } from '../utils/stocks/stockCompanies'
import { defaultPayToken } from '../utils/stockTrade'

/** Home.openStock ile AYNI sekil: `crypto.selected_token_ref`. */
export function refOfRow(row) {
  return {
    id: row.coingeckoId,
    chainId: row.chainId,
    address: row.address,
    decimals: row.decimals,
    symbol: row.symbol,
  }
}

/**
 * @param {{ onSwitched?: (e:{issuer:string,row:object,payToken:object|null})=>void,
 *           xstocksEnabled?: boolean,
 *           market?: () => ({state:'open'|'closed', nextChangeAt:string|null}|null),
 *           now?: () => Date }} [opts]
 *   `xstocksEnabled` testte enjekte edilir; uretimde varsayilan kullanilir.
 *   `market`: xStocks ihraccisinin piyasa durumu (marketStatus). null/bilinmiyor -> kilit YOK.
 */
export function useIssuerSwitch({ onSwitched, xstocksEnabled = XSTOCKS_ENABLED, market = () => null, now = () => new Date() } = {}) {
  const network = networkStore()
  const crypto = cryptoStore()

  const currentEntry = computed(() => {
    const r = crypto.selected_token_ref
    return r ? stockEntry(r.chainId, r.address) : null
  })
  // Ihracci gecisi YALNIZ sayfanin su anki aginda (secili satirin chainId'si; kullanici karari 2026-10-28).
  // `available`: o ihraccinin ayni hisse icin bu agda satiri var; yoksa secenek gorunur ama PASIF (row = issuerOptions satiri).
  const options = computed(() => {
    const cur = currentEntry.value
    return issuerOptions(cur, {
      xstocksEnabled,
      activeChainId: network.currentNetwork?.chainId ?? null,
    }).map((o) => {
      const same = cur
        ? companyRows(cur.underlying, { xstocksEnabled }).find((r) => r.issuer === o.issuer && Number(r.chainId) === Number(cur.chainId))
        : null
      return { ...o, available: Boolean(same) }
    })
  })
  const selected = computed(() => currentEntry.value?.issuer ?? null)

  // Ihracci piyasasi KAPALIYKEN xStocks icin 'alim kapali' notu (kullanici karari 2026-10-24; dugme aktif, satis acik).
  // Durum bilinmiyorsa (null) kilit yok: mevcut davranis. `kind`: kapali donem hafta sonuna denk mi.
  const xLock = computed(() => {
    const m = market()
    if (!m || m.state !== 'closed') return null
    if (!options.value.some((o) => o.issuer === 'xstocks') && currentEntry.value?.issuer !== 'xstocks') return null
    const next = typeof m.nextChangeAt === 'string' ? new Date(m.nextChangeAt) : null
    const nextOk = next && Number.isFinite(next.getTime())
    const day = now().getDay()
    const weekend = day === 0 || day === 6 || Boolean(nextOk && next.getDay() === 1)
    return { issuer: 'xstocks', kind: weekend ? 'weekend' : 'market', nextChangeAt: nextOk ? m.nextChangeAt : null }
  })
  // xStocks secili ve piyasa kapali: ekran yalniz AL'i kilitler (Sat acik; kullanici karari 2026-10-24). Secici dugmesi pasiflenmez.
  const blocked = computed(() => Boolean(xLock.value) && selected.value === 'xstocks')

  // Ag secici: SECILI ihraccinin ayni dayanak icin katalogdaki tum satirlari (bStocks yalniz BSC).
  const chainRows = computed(() => {
    const cur = currentEntry.value
    if (!cur) return []
    return companyRows(cur.underlying, { xstocksEnabled }).filter((r) => r.issuer === cur.issuer)
  })
  const chain = computed(() => (currentEntry.value ? Number(currentEntry.value.chainId) : null))

  function commit(row) {
    crypto.selected_token_ref = refOfRow(row)
    crypto.selected_token_id = row.coingeckoId
    onSwitched?.({ issuer: row.issuer, row, payToken: defaultPayToken(row.chainId) })
  }

  /** Yalniz hisse baglami (selected_token_ref) degisir; cuzdanin aktif agi DEGISMEZ. */
  function pickChain(chainId) {
    const cur = currentEntry.value
    const row = chainRows.value.find((r) => Number(r.chainId) === Number(chainId))
    if (!cur || !row) return { ok: false, reason: 'unknown-chain' }
    if (Number(row.chainId) === Number(cur.chainId)) return { ok: true, changed: false }
    commit(row)
    return { ok: true, changed: true, row }
  }

  /**
   * Eszamanlidir (ag beklemesi yok): ref ve olay ayni adimda yazilir.
   * @returns {{ok:true, changed:boolean, row?:object}|{ok:false, reason:'unknown-issuer'|'not-on-network'}}
   */
  function pick(issuer) {
    const start = currentEntry.value
    const option = options.value.find((o) => o.issuer === issuer)
    if (!start || !option) return { ok: false, reason: 'unknown-issuer' }
    if (option.issuer === start.issuer) return { ok: true, changed: false }

    // Hedef satir her zaman sayfanin AYNI agindaki satirdir; yoksa gecis yok (ag asla degismez).
    if (!option.available) return { ok: false, reason: 'not-on-network' }
    const row = option.row
    commit(row)
    return { ok: true, changed: true, row }
  }

  // Piyasa durumu okunacak xStocks satiri (yoksa null).
  const marketRow = computed(() => options.value.find((o) => o.issuer === 'xstocks')?.row ?? null)

  return { options, selected, pick, chainRows, chain, pickChain, xLock, blocked, marketRow }
}
