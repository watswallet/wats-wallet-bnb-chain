// ATS op'u relay edilince popup cevabini ne zaman serbest birakacagimizi karar veren saf kapi.
//
// Yalniz ASIL op (transfer/swap/bridge) hash'i serbest birakir. Bootstrap/onboarding op'u,
// `unconfirmed` (relay basarisiz dedi ama hash var: sonuc belirsiz) ve ikinci cagri
// serbest BIRAKMAZ. Kuyruk gorevinin makbuza kadar acik kalmasi cagiranin isidir
// (gorev `await executeAtsTransfer(...)` ile surer; bu kapi yalniz cevabi erkene alir).
const MAIN_KINDS = new Set(['transfer', 'swap', 'bridge'])

export function makeRelayedGate({ resolve }) {
  let released = false
  return function onRelayed(info) {
    if (released || !info || info.unconfirmed) return false
    if (!MAIN_KINDS.has(info.kind) || !info.txHash) return false
    released = true
    resolve(info)
    return true
  }
}
