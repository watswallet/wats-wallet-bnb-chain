// ATS gonderiminde executeAtsTransfer'in firlattigi hatayi siniflar.
//
// 'error'      : kesin basarisiz (zincirde ic revert: opSuccess === false) ya da islem zincire hic gitmemis
//                (txHash'siz, opSuccess'siz hata).
// 'unverified' : sonuc BILINMIYOR (opSuccess === null) ya da islem zincire GITMIS (txHash var: relay "basarisiz"
//                dedi / makbuz dogrulanamadi). Kart 'error' YAZILMAZ; 'processing'+txHash kalir, kurtarma
//                userOp olayiyla cozer. 'Basarisiz' demek kullaniciyi tekrar gondermeye (cift odeme) iter.
export function atsSendOutcome(e) {
  if (!e || e.opSuccess === false) return { kind: 'error' }
  if (e.opSuccess === null || e.txHash) {
    return {
      kind: 'unverified',
      ...(e.txHash ? { txHash: e.txHash } : {}),
      ...(e.userOpHash ? { userOpHash: e.userOpHash } : {}),
    }
  }
  return { kind: 'error' }
}

// ATS kartinin hata yolundaki karari (CoW vb.): belirsiz sonuc 'processing' kalir, kesin hata 'error' olur.
export function atsFailureCard(e) {
  const o = atsSendOutcome(e)
  if (o.kind !== 'unverified') return { status: 'error' }
  const { kind, ...extra } = o
  return { status: 'processing', extra }
}

// Dapp onay ekraninin SEND_TRANSACTION yanitini yorumlar.
// 'pending' : sonuc belirsiz ve zincir hash'i yok; 'basarisiz' DEGIL (tekrar gonderim = cift odeme).
export function dappSendOutcome(response) {
  const hash = response?.txHash || response?.hash || response?.signature
  if (response?.unverified) return hash ? { kind: 'success', hash } : { kind: 'pending' }
  if (response?.success === false || !hash) return { kind: 'error' }
  return { kind: 'success', hash }
}
