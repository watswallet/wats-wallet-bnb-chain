// Salt-okuma RPC istekleri icin "yedekli okuma" (hedged read).
//
// Ilk adres HEDGE_DELAY_MS icinde yanit vermezse (ya da hata verirse) SIRADAKI adreste ayni okuma da baslar;
// ilk BASARILI yanit alinir, digerleri birakilir. Tek bir satir tek bir kaynaktan gelir: iki kaynaktan deger
// KARISTIRILMAZ. Tum adresler basarisizsa ILK adresin hatasi atilir (yedeksiz bugunku davranis).
//
// YALNIZ OKUMA icin: islem gonderme / imza / nonce yollarinda KULLANILMAZ (ayni istegi iki uca gondermek orada
// tehlikeli). Gizli modda cagiran tek adres verir, yani hicbir ek adrese gidilmez.
export const HEDGE_DELAY_MS = 1750

export function hedgedRead(urls, read, { delayMs = HEDGE_DELAY_MS } = {}) {
  const list = (urls || []).filter(Boolean)
  if (list.length === 0) return Promise.reject(new Error('RPC adresi yok'))
  if (list.length === 1) return read(list[0])

  return new Promise((resolve, reject) => {
    let started = 0
    let failed = 0
    let done = false
    let timer = null
    let firstError

    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn(value)
    }
    const startNext = () => {
      if (done || started >= list.length) return
      const idx = started++
      clearTimeout(timer)
      if (started < list.length) timer = setTimeout(startNext, delayMs)
      let p
      try { p = Promise.resolve(read(list[idx])) } catch (e) { p = Promise.reject(e) }
      p.then(
        (v) => finish(resolve, v),
        (e) => {
          if (idx === 0) firstError = e
          failed++
          if (failed === list.length) finish(reject, firstError)
          else startNext()
        },
      )
    }
    startNext()
  })
}
