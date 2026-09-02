import { ref, computed } from 'vue'
import {
  formatFuel, formatFuelExact, fuelLevel, fuelOpsLeft,
  pickFeeHint, readFeeHints, readFuelCache, writeFuelCache,
} from '../utils/atsFuel'

// Header yakit pill'inin durumu. Bakiye HER ZAMAN BSC'dendir (background 56'yi sabitler);
// buradaki `chainId` yalnizca DOGRU UCRET IPUCUNU secmek icin kullanilir, bakiyeyi degil.
export function useAtsFuel() {
  const balance = ref(null)
  const symbol = ref('ATS')
  const loading = ref(false)
  const stale = ref(false)
  const hints = ref({})
  const chainId = ref(null)

  const feePerOp = computed(() => {
    const h = pickFeeHint(hints.value, chainId.value)
    return h ? Number(h.perOp) : null
  })
  const level = computed(() => fuelLevel({ balance: balance.value, feePerOp: feePerOp.value }))
  const opsLeft = computed(() => fuelOpsLeft({ balance: balance.value, feePerOp: feePerOp.value }))
  const display = computed(() => formatFuel(balance.value))
  const exact = computed(() => formatFuelExact(balance.value))

  // Ucusan her okuma KENDI sirasini alir; sirasi eskimis bir yanit EKRANA YAZILMAZ.
  // Header aktif hesabi depodan asenkron kuruyor ve changeAccount her an degistirebiliyor:
  // A hesabinin yaniti B'den SONRA donerse, muhafiz olmadan B'nin altinda A'nin yakiti
  // yazili kalir -- zamanlayici da yok, yani oturum boyunca kendiliginden duzelmez.
  // Ayni muhafiz `loading`i da korur: eskiyen istegin finally'si, yenisi hala ucustayken
  // spinner'i durdurup yenile butonunu tekrar tiklanabilir yapiyordu.
  let gen = 0

  async function refresh(address) {
    const my = ++gen
    if (!address) { balance.value = null; loading.value = false; return }
    loading.value = true
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'ATS_FUEL_BALANCE', message: { address },
      })
      if (resp && resp.success) {
        // Onbellek ADRESE gore anahtarli: artik aktif olmayan bir hesabin DOGRU degerini
        // yazmak zararsiz, hatta istenir. Muhafizin korudugu yalniz EKRANDIR.
        await writeFuelCache(address, resp.balance)
        if (my !== gen) return
        balance.value = resp.balance
        symbol.value = resp.symbol || 'ATS'
        stale.value = false
      } else {
        // Okuma dustu: onbellekten boyanan deger EKRANDA KALIR, yalniz bayat isaretlenir.
        // '—'a dusurmek kullanicidan dogru (yalnizca eski) bir bilgiyi geri alirdi.
        if (my !== gen) return
        stale.value = true
      }
    } catch {
      // sendMessage'in KENDISI reddetti (worker kapandi vb.). Pill header'i dusuremez.
      if (my !== gen) return
      stale.value = true
    } finally {
      if (my === gen) loading.value = false
    }
  }

  // Popup her acilista yeniden mount olur. Onbellekten ANINDA boyamazsak kullanici her
  // acilista once '—' gorur; bakiye zaten biliniyorken bu pill'i kullanilamaz yapar.
  async function load(address, currentChainId) {
    const my = ++gen
    chainId.value = currentChainId ?? null
    const nextHints = await readFeeHints()
    const cached = await readFuelCache(address)
    if (my !== gen) return
    hints.value = nextHints
    balance.value = cached ? cached.balance : null
    // Bayat isaretini SIFIRLA: onceki hesabin okuma hatasindan kalan soluk nokta, yeni
    // hesabin onbellek degerinin uzerine yapisip onu haksiz yere eski gosteriyordu.
    stale.value = false
    await refresh(address)
  }

  // Ag degisimi bakiyeyi DEGISTIRMEZ (bakiye her zaman BSC'den okunur); yalnizca hangi
  // zincirin ucret ipucunun gecerli oldugunu degistirir. Bu yol bu yuzden AG OKUMASI
  // YAPMAZ; `load` cagirmak her ag anahtarlamasinda gereksiz bir balanceOf demekti.
  async function setChain(currentChainId) {
    chainId.value = currentChainId ?? null
    hints.value = await readFeeHints()
  }

  return { balance, symbol, loading, stale, feePerOp, level, opsLeft, display, exact, load, refresh, setChain }
}
