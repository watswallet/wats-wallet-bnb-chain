import { ref, computed } from 'vue'
import axios from 'axios'
import { configStore } from '../store/config'
import { pickDefaultGasToken, isOptionInsufficient } from '../utils/gasToken'
import { tokenLogo } from '../utils/tokenLogo'

// Gasless fee-token secimi: kesif (GASLESS_TOKEN_OPTIONS) + secim state'i + default-pick.
// send/swap/bridge ortak kullanir. gasToken: null = native, aksi = ERC-20 adresi.
export function useGasToken() {
  const config = configStore()
  const gasToken = ref(null)
  const gasTokenOptions = ref([])
  const loadingTokens = ref(false)
  const ctx = ref({ sentAssetAddress: null, sendAmount: 0 })
  let lastKey = null
  let loadVersion = 0

  const selectedOption = computed(() => gasTokenOptions.value.find((t) => t.token === gasToken.value) || null)
  const selectedInsufficient = computed(() =>
    gasToken.value !== null && isOptionInsufficient(selectedOption.value, {
      sentAssetAddress: ctx.value.sentAssetAddress, sendAmount: ctx.value.sendAmount,
    }))

  async function enrichLogos(version) {
    const updated = await Promise.all(gasTokenOptions.value.map(async (opt) => {
      try {
        const { data } = await axios.post(config.api + '/getTokenByAddress', { address: opt.token })
        // TON jetton'larinda `image` bir DIZEDIR; eski zincir orada bos donerdi.
        const img = tokenLogo(data?.token, null)
        return img ? { ...opt, logoURI: img } : opt
      } catch { return opt }
    }))
    if (version === loadVersion) gasTokenOptions.value = updated // stale yukleme ise yazma (race korumasi)
  }

  async function loadGasOptions({ chainId, address, bundlerBase, sentAsset, sendAmount, nativeInsufficient }) {
    ctx.value = { sentAssetAddress: sentAsset?.address || null, sendAmount }
    const key = `${chainId}:${String(sentAsset?.address || '').toLowerCase()}`
    if (key !== lastKey) {
      loadVersion++
      const version = loadVersion
      loadingTokens.value = true
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'GASLESS_TOKEN_OPTIONS',
          message: { chainId, address, bundlerBase, sendAsset: sentAsset || null },
        })
        if (version !== loadVersion) return // daha yeni bir yukleme basladi -> bunu birak
        gasTokenOptions.value = resp?.success ? (resp.options || []) : []
        lastKey = key
        if (gasTokenOptions.value.length) enrichLogos(version)
      } catch (e) {
        console.warn('useGasToken loadGasOptions error', e?.message)
      } finally {
        loadingTokens.value = false
      }
    }
    if (nativeInsufficient && gasToken.value === null && gasTokenOptions.value.length) {
      gasToken.value = pickDefaultGasToken(gasTokenOptions.value, {
        sentAssetAddress: ctx.value.sentAssetAddress, sendAmount,
      })
    }
  }

  function resetGasToken() { gasToken.value = null; gasTokenOptions.value = []; lastKey = null }

  return { gasToken, gasTokenOptions, loadingTokens, selectedOption, selectedInsufficient, loadGasOptions, resetGasToken }
}
