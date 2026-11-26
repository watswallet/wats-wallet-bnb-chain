// Dapp onay ekraninda send() govdesinin KARAR kismi (saf; ref gormez, bagimliliklar parametre).
// Davranis Dapp.vue'den aynen tasindi.
import { dappSendOutcome } from './atsSendOutcome'

const PENDING_MESSAGE = 'Transaction result could not be verified yet; it may have been sent. Check the wallet history before retrying.'

// Arka plan yanitini dapp'e / ekrana uygular. Kesin hatada FIRLATIR (cagiran catch'e duser).
// state.replied: 'dapp'e bu requestId icin cevap GONDERILDI (denendi); catch ikinci cevap atmaz.
export async function finishDappSend({ response, fromDapp, requestId, sendMessage, setPage, txFailedText, state = { replied: false } }) {
  const outcome = dappSendOutcome(response)
  if (outcome.kind === 'error') {
    throw new Error(response?.error || txFailedText)
  }
  // Sonuc belirsiz ve hash yok: 'basarisiz' DEGIL (site tekrar gonderirse cift odeme).
  // Not: pending kart cozumu recoverStuckCards'a birakilir (hash'siz 5 dk, userOpHash'li ATS 24 saat).
  if (outcome.kind === 'pending') {
    if (fromDapp && requestId) {
      state.replied = true
      await sendMessage({
        type: 'SEND_TX_REJECTED',
        requestId,
        status: 'error',
        error: { code: -32603, message: PENDING_MESSAGE }
      })
    }
    setPage('home')
    return
  }
  if (fromDapp && requestId) {
    state.replied = true
    await sendMessage({
      type: 'SEND_TX_SUCCESS',
      requestId,
      status: 'success',
      data: { result: outcome.hash }
    })
    setPage('home')
  } else {
    setPage('home')
  }
}

// catch dali. Donus: 'alert' = dapp'siz akis, cagiran kullaniciya gosterir; 'dapp' = dapp'e cevap gitti.
export async function failDappSend({ err, fromDapp, requestId, sendMessage, setPage, state = { replied: false } }) {
  if (fromDapp && requestId) {
    // Cevap zaten gonderildiyse (pending REJECTED / SUCCESS) ikinci cevap ATILMAZ: SUCCESS'ten sonra
    // REJECTED, zincire gitmis islemi dapp'e 'reddedildi' dondurur (cift odeme riski).
    if (!state.replied) {
      state.replied = true
      try {
        await sendMessage({
          type: 'SEND_TX_REJECTED',
          requestId,
          status: 'error',
          error: { code: -32603, message: err.message || 'Internal error' }
        })
      } catch (e) {
        console.warn('SEND_TX_REJECTED gonderilemedi', e)
      }
    }
    setPage('home')
    return 'dapp'
  }
  return 'alert'
}
