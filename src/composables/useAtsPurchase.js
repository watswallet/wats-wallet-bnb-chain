// "ATS AL" KISAYOLU (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.4).
//
// Cuzdani satin alma ekraninda acar: ag BSC, kaynak bakiyesi olan ilk odeme tokeni (USDT > USDC >
// BNB; hicbiri yoksa USDT), hedef ATS, sayfa takas. SIRA ZORUNLU: once ag degisir, SONRA tokenler
// yazilir -- applyNetworkChange secili takas tokenlerini SIFIRLAR; ters sira secimi silerdi
// (Token.vue selectSwap ile ayni desen). Tutar onceden doldurulmaz: Swap.vue'nun yerel durumu.
import { useI18n } from 'vue-i18n'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { ALL_CHAINS } from '../data/chains'
import { applyNetworkChange } from '../utils/applyNetworkChange'
import { useTokenBalance } from './useTokenBalance'
import { isSameChainId } from '../utils/vm'
import { buildNativeToken } from '../utils/nativeToken'
import { ATS_LOGO_URI } from '../utils/atsConfig'
import { ATS_SALE_ATS, ATS_SALE_CHAIN_ID, ATS_SALE_PAY_TOKENS, isAtsSaleLive } from '../utils/atsSaleConfig'

// Bakiye okumasi ASILIRSA (tek RPC, failover yok) ekran bekletilmez: sure dolunca o token 0 sayilir.
export const PAY_PICK_TIMEOUT_MS = 2500

// Logolar native tablodaki (data/native_tokens.json) ile AYNI kaynaktan: CoinGecko gorsel CDN'i
// (2026-10-04 olculdu: large/small/thumb uclari 200 image/png). `image` olmasa tokenLogo gri yer
// tutucuya duserdi; ekran calisirdi ama odeme tokeni tanimsiz gorunurdu.
const PAY_META = {
    USDT: { name: 'Tether USD', coingecko_id: 'tether', large: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png' },
    USDC: { name: 'USD Coin', coingecko_id: 'usd-coin', large: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png' },
}
const cgImage = (large) => ({ large, small: large.replace('/large/', '/small/'), thumb: large.replace('/large/', '/thumb/') })

/** Takas ekraninin token kaydi. BNB zincirin kanonik native kaydidir (adres '0x0'). */
export function salePayRecord(symbol) {
    const t = ATS_SALE_PAY_TOKENS.find((p) => p.symbol === symbol) || ATS_SALE_PAY_TOKENS[0]
    if (t.symbol === 'BNB') return buildNativeToken(ATS_SALE_CHAIN_ID)
    const meta = PAY_META[t.symbol]
    return {
        name: meta.name, symbol: t.symbol.toLowerCase(), address: t.address, decimals: t.decimals,
        // chainId SART: Swap.vue acilista reconcileSwapToken -> classifyAssetChain ile kaydi
        // aktif zincirle kiyaslar; chainId'li kayit BSC'de gecerli sayilir ve korunur.
        chainId: ATS_SALE_CHAIN_ID, coingecko_id: meta.coingecko_id, image: cgImage(meta.large),
    }
}

export const ATS_SALE_OUT_RECORD = Object.freeze({
    name: 'Alltoscan', symbol: 'ats', address: ATS_SALE_ATS, decimals: 18,
    chainId: ATS_SALE_CHAIN_ID, logoURI: ATS_LOGO_URI,
})

/** Saf kural: ATS_SALE_PAY_TOKENS sirasinda bakiyesi > 0 olan ilk sembol; yoksa USDT. */
export function pickPayToken(balances) {
    const liste = Array.isArray(balances) ? balances : []
    for (const p of ATS_SALE_PAY_TOKENS) {
        const b = liste.find((x) => x && x.symbol === p.symbol)
        if (b && Number(b.balance) > 0) return p.symbol
    }
    return ATS_SALE_PAY_TOKENS[0].symbol
}

// Sure TOKEN BASINA isler (controller P2-C10): asili bir okuma yalniz kendi bakiyesini 0'a
// dusurur. Butun kume tek sureye yarissaydi, USDT asilinca cevap vermis USDC/BNB bakiyesi de
// atilir ve "bakiyesi olan ilk token" kurali bozulurdu.
async function readPayBalances(address, rpc) {
    const one = async (p) => {
        let timer
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ symbol: p.symbol, balance: 0 }), PAY_PICK_TIMEOUT_MS)
        })
        const read = (async () => {
            try {
                return { symbol: p.symbol, balance: await useTokenBalance(address, p.address, rpc, ATS_SALE_CHAIN_ID) }
            } catch {
                return { symbol: p.symbol, balance: 0 }
            }
        })()
        try {
            return await Promise.race([read, timeout])
        } finally {
            clearTimeout(timer)
        }
    }
    return Promise.all(ATS_SALE_PAY_TOKENS.map(one))
}

/**
 * @param {{t: Function}} opts  ceviri (applyNetworkChange uyarilari icin)
 * @returns {Promise<boolean>} satin alma ekrani acildiysa true
 */
export async function openAtsPurchase({ t }) {
    const network = networkStore()
    if (!isSameChainId(network.currentNetwork?.chainId, ATS_SALE_CHAIN_ID)) {
        const chain = ALL_CHAINS.find((c) => isSameChainId(c.chainId, ATS_SALE_CHAIN_ID))
        if (!chain) return false
        // Akis kapisi ve hesap kapisi (TON hesabi BSC'ye gecemez) applyNetworkChange'te; reddederse
        // kullaniciya uyari zaten gosterildi, akis SURDURULMEZ.
        if (!(await applyNetworkChange(chain, t, { flow: 'swap' }))) return false
    }
    const { active_account } = await chrome.storage.local.get('active_account')
    const balances = active_account?.address ? await readPayBalances(active_account.address, network.rpc) : []
    const crypto = cryptoStore()
    crypto.swap.inToken = salePayRecord(pickPayToken(balances))
    crypto.swap.outToken = { ...ATS_SALE_OUT_RECORD }
    pageStore().currentPage = 'swap'
    return true
}

// DAPP ONAY PENCERESINDEN SATIN ALMA. Onay penceresi bekleyen bir dapp istegine bagli ayri bir
// penceredir; satin alma AYRI bir cuzdan penceresinde acilir ve bu adres o pencereyi isaretler.
// App.vue onu hicbir zaman dapp onay ekranina yonlendirmez (S7.1, yan panel gibi).
export const ATS_PURCHASE_QUERY = 'ats-purchase'

export function isAtsPurchaseLaunch(loc) {
    try {
        return new URLSearchParams((loc && loc.search) || '').get(ATS_PURCHASE_QUERY) === '1'
    } catch {
        return false
    }
}

export async function openAtsPurchaseWindow() {
    await chrome.windows.create({
        // `#window` SART: popup/main.js bu hash'le pencere moduna girer (360x600 kilidi gevser, yan
        // panel koprusu calismaz) -- dapp onay penceresiyle AYNI yuzey (utils/uiSurface.js).
        url: chrome.runtime.getURL(`src/popup/index.html?${ATS_PURCHASE_QUERY}=1#window`),
        type: 'popup', width: 360, height: 600, focused: true,
    })
}

/** Bilesenler icin: satis acik mi ve ceviriyle baglanmis acici. */
export function useAtsPurchase() {
    const { t } = useI18n()
    return { live: isAtsSaleLive(), open: () => openAtsPurchase({ t }) }
}
