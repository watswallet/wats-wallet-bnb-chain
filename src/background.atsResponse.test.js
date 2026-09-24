import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ATS KOLUNUN YANIT SOZLESMESI (background.sendTxInternal).
//
// background.js bir service worker; tumunu bir testte kosturmak mumkun degil, bu yuzden
// iddialar KAYNAK uzerinden. Olculen sey iki kural:
//
//  1. `hash` ile `txHash` AYRI dondurulur. `hash` USEROP hash'idir; dapp'e
//     eth_sendTransaction cevabi olarak o verilirse `eth_getTransactionReceipt` onu
//     ASLA bulamaz ve site basarili bir islemi sonsuza dek "bekliyor" gosterir.
//     (Dapp.vue'nun hangisini tercih ettigi ayrica olculuyor: Dapp.ats.ssr.test.js.)
//
//  2. Kapi hala IKI sart birden ariyor: `atsTransfer` bayragi VE zincirin ATS zinciri
//     olmasi. Bayrak, "ekran ATS ucretini gosterdi ve kullanici onayladi" demektir --
//     ekranin ADI degil bu SART baglayicidir. Kapiyi tek sarta indirmek, kullanicinin
//     GORMEDIGI bir ucreti onun adina onaylatmak olurdu.

const SRC = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')

// ATS dalini kaynaktan cikarir: `if (atsTransfer ...)` satirindan o dalin `return`'une.
function atsDali() {
  const bas = SRC.indexOf('if (atsTransfer && isAtsChain(chainId))')
  if (bas < 0) return null
  const son = SRC.indexOf('return', SRC.indexOf('resolve({', bas))
  return SRC.slice(bas, son)
}

describe('sendTxInternal ATS kolu', () => {
  it('kapi hem bayragi hem ATS zincirini arar', () => {
    expect(atsDali()).not.toBeNull()
  })

  it('userOp hash ile zincir hash AYRI alanlarda doner', () => {
    const dal = atsDali()
    expect(dal).toMatch(/const \{ hash, txHash \} = await executeAtsTransfer\(/)
    // Ikisi de yanitta. Yalniz `hash` donseydi dapp yolu kirilirdi; yalniz `txHash`
    // donseydi Gonder akisinin mevcut cagiranlari (hash bekliyorlar) kirilirdi.
    expect(dal).toMatch(/resolve\(\{\s*success:\s*true,\s*hash,\s*txHash\s*\}\)/)
  })

  it('yanit BigInt tasimaz - uzanti mesajlari onu serilestiremez', () => {
    // Iki alan da hex dizge; bir gun oraya gas/fee gibi bir alan eklenirse yanit
    // sessizce "Could not serialize message." ile duserdi.
    const dal = atsDali()
    expect(dal).not.toMatch(/resolve\(\{[^}]*gas[^}]*\}\)/)
  })
})
