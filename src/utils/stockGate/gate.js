// Ilk alim kapisi orkestratoru (spec ilk-alim-kapisi bolum 2.2, 5.10, 5.12).
//
// SAF DI: ag, depo, chrome ve vue YOK; hepsi enjekte edilir (arka plan tek ornek kurar, testler
// sahte verir). Kapi bozuk girdide ve bagimlilik hatasinda FIRLATMAZ: sonuc her zaman bir karar
// nesnesidir ve belirsizlik kapiyi ACMAZ (CHECK_FAILED). Karar hesaba BAGLI DEGILDIR (K39): kapi
// aktif hesabi, hesap kimligini ve depodaki baska bir kaydi okumaz; girdisi yalniz ihracci, kural
// tablosu, baglanti (IP) ulkesi ve saattir.
//
// R12: arayuze giden 3 anahtarli karar yanitinin ({ decision, reason, ipCountry }) TEK kaynagi
// replyOf'tur (STATUS, kapali yanitlar ve evaluate'in kapali dali hepsi ondan gecer).
//
// IHRACCI KUMESI ACIKTIR (Bolum 2): STATUS yaniti kural tablosundaki HER ihracci icin bir karar verir (sabit iki ihracci
// degil); tabloya ulasilamayan yolda zorunlu iki + gomulu tablonun ihraccilari CHECK_FAILED olur. evaluateIssuer katalog
// aramasi yapmadan, verilen ihracci dizgesiyle karar verir (arka plan RWA teklifinin eslestigi ihracciyi gecirir).
import { isValidIssuer, issuerKeysOf } from './rules'
import { decideStockBuy } from './decide'
import { BUNDLED_ELIGIBILITY_RULES } from '../../data/eligibilityRules'

// decide sonucundan ARAYUZE giden 3 anahtarli yanit (P1: ipCountry dahil, IP dizesi degil).
// Karar yanitlarinin TEK projeksiyonu: baska yerde alan alan elle kurulmaz.
function replyOf(d) {
  return { decision: d.decision, reason: d.reason, ipCountry: d.ipCountry }
}

// Kapali (BLOCKED) yanit: replyOf'tan gecer, 3 anahtarin hepsi her zaman var.
const closedReply = (reason) => replyOf({ decision: 'BLOCKED', reason, ipCountry: null })

// Kopru hedefi dogrulanamadi: hisse edinilebilen zincire giden koprude hedef token alani yok.
const bridgeTargetUnverified = () => ({ ok: false, stock: false, issuer: null, ...closedReply('CHECK_FAILED') })

// `bundled`: tabloya ulasilamayan yolda hangi ihraccilarin CHECK_FAILED verecegini belirleyen gomulu tablo (varsayilan: uretim kopyasi).
export function createStockGate({ stockIssuer, rulesClient, bridgeStockChainIds, bundled = BUNDLED_ELIGIBILITY_RULES }) {
  // R7: saat burada okunur ve decide'a girdi olarak gecer (decide saat okumaz).
  // `now` verilmezse karar aninda okunur (evaluate); status() tablodaki butun ihracciya AYNI saati gecirir (tek anlik goruntu).
  const decideReply = (issuer, { rules, ipCountry }, now = Date.now()) => replyOf(decideStockBuy({ issuer, rules, ipCountry, now }))

  // Sira: kurallar + IP ulkesi (tek anlik goruntu) -> karar.
  async function judge(issuer) {
    return decideReply(issuer, await rulesClient.ensureFresh())
  }

  async function safeJudge(issuer) {
    try {
      return await judge(issuer)
    } catch {
      return closedReply('CHECK_FAILED')
    }
  }

  // Verilen ihracci icin karar: evaluate ve evaluateIssuer'in ORTAK govdesi (ayni yanit sekli).
  async function decideIssuer(issuer) {
    const reply = await safeJudge(issuer)
    if (reply.decision === 'OK' || reply.decision === 'WARN') {
      return { ok: true, stock: true, issuer, warn: reply.decision === 'WARN' }
    }
    return { ok: false, stock: true, issuer, ...reply }
  }

  async function evaluate(input) {
    const { chainId, outAddress } = input ?? {}
    let issuer = null
    try {
      issuer = stockIssuer(chainId, outAddress)
    } catch {
      issuer = null
    }
    // Hisse degil: hicbir bagimlilik cagrilmaz.
    if (!issuer) return { ok: true, stock: false }
    return decideIssuer(issuer)
  }

  // Ihracci DIZGESIYLE karar (Bolum 2): katalog (stockIssuer) sorgulanmaz; evaluate ile ayni yanit sekli. Bicimi gecersiz ya da
  // dize olmayan ihracci hicbir bagimliliga dokunmadan KAPALI (CHECK_FAILED, issuer null); bicimi gecerli ama tabloda olmayan
  // ihracci decide'da ISSUER_UNKNOWN olur (tuketici toGateReason ile kullaniciya CHECK_FAILED gosterir). Belirsizlik kapiyi ACMAZ.
  async function evaluateIssuer(input) {
    const issuer = input?.issuer
    if (!isValidIssuer(issuer)) return { ok: false, stock: true, issuer: null, ...closedReply('CHECK_FAILED') }
    return decideIssuer(issuer)
  }

  // Kopru HEDEFI: hisse edinilebilen bir zincire (bridgeStockChainIds) giden koprude hedef token
  // alani yoksa ya da dize degilse karar VERILEMEZ -> kapali. Diger zincirler etkilenmez.
  async function evaluateBridgeTarget(input) {
    const { toChain, toTokenAddress } = input ?? {}
    const address = typeof toTokenAddress === 'string' ? toTokenAddress.trim() : ''
    if (!address && bridgeStockChainIds().includes(Number(toChain))) return bridgeTargetUnverified()
    return evaluate({ chainId: toChain, outAddress: address || toTokenAddress })
  }

  // Tablodaki HER ihracci kararini TEK anlik goruntuden verir (K34): tek ensureFresh, ayni ulke, ayni an. Govde (varsa
  // { issuer }) YOK SAYILIR (ara sozlesme bitti, PE14). ensureFresh firlatirsa zorunlu iki + gomulu tablonun ihraccilari
  // CHECK_FAILED olur.
  async function status() {
    let snapshot
    let now
    try {
      snapshot = await rulesClient.ensureFresh()
      now = Date.now() // TEK saat okumasi: butun ihracci ayni kural + ulke + AN ile karar verir (milisaniye farki karar sinirinda gorunmez)
    } catch {
      return Object.fromEntries(issuerKeysOf(bundled).map((issuer) => [issuer, closedReply('CHECK_FAILED')]))
    }
    return Object.fromEntries(issuerKeysOf(snapshot?.rules).map((issuer) => {
      try {
        return [issuer, decideReply(issuer, snapshot, now)]
      } catch {
        return [issuer, closedReply('CHECK_FAILED')]
      }
    }))
  }

  return { evaluate, evaluateBridgeTarget, evaluateIssuer, status }
}
