import { getAddress, Interface } from 'ethers'
import { usdcTokenOf, nativeTokenOf } from '../utils/privacy/deliveryTokens'

// SilentSwap teklif sekli (sdk/dist/types.d.ts Quote + PrivateQuote). Adresler
// kucuk harften getAddress ile kurulur: elle yazilmis bir checksum yanlissa
// getAddress FIRLATIR ve test yanlis sebeple kirilir.
export const USDC_BSC = getAddress('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d')
export const GATEWAY = getAddress('0xccdd2b5836c08bb7f115e8da9ece8605f8e7ea1d')
export const GIZLI = getAddress('0x' + 'cd'.repeat(20))
export const USDT_ETH = getAddress('0xdac17f958d2ee523a2206206994597c13d831ec7')
export const ROUTER = getAddress('0x' + '77'.repeat(20))

// Relay sozlesmeleri (api.relay.link/chains, 2026-10-26). Koprulu teklifler canli sekle gore Depository'ye gider
// (privateBridgedSources.js); yonlendirici/onay aracisi rotalari kapali ve yalniz ret testlerinde kullanilir.
export const DEPOSITORY = getAddress('0x4cd00e387622c35bddb9b4c962c136462338bc31')
export const DEPOSITORY_ALT = getAddress('0x59916da825d2d2ec1bf878d71c88826f6633ecca')
export const RELAY_APPROVAL_PROXY = getAddress('0xccc88a9d1b4ed6b0eaba998850414b24f1c315be')
export const RELAY_ERC20_ROUTER = getAddress('0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f')
export const DEPOSIT_ID = '0x' + '5a'.repeat(32)
const DEPOSITORY_ABI = new Interface([
    'function depositErc20(address depositor, address token, uint256 amount, bytes32 id)',
    'function depositErc20(address depositor, address token, bytes32 id)',
    'function depositNative(address depositor, bytes32 id) payable',
])
export const depositErc20Data = (depositor, token, amount, id = DEPOSIT_ID) =>
    DEPOSITORY_ABI.encodeFunctionData('depositErc20(address,address,uint256,bytes32)', [depositor, token, amount, id])
// 3 argumanli asiri yukleme: tutar yerine kaynak hesabin Depository'ye verdigi TUM izni ceker (yalniz ret testleri icin).
export const depositErc20AllowanceData = (depositor, token, id = DEPOSIT_ID) =>
    DEPOSITORY_ABI.encodeFunctionData('depositErc20(address,address,bytes32)', [depositor, token, id])
export const depositNativeData = (depositor, id = DEPOSIT_ID) => DEPOSITORY_ABI.encodeFunctionData('depositNative', [depositor, id])
const GIRDI_ADRESI = getAddress('0x' + 'ab'.repeat(20))

// CANLI SEKIL (2026-10-10, api.silentswap.com): operator dogrudan EVM odemesini kapatti, her alici
// `dest` tasir; aliciya ulasan dest.expectedDestAmount (en az dest.minDestAmount). USDC teslimi dest = BSC USDC.
// IKI UCRET MODELI (canli olcum 2026-10-29, parasiz teklifler):
//  - URETIM (integratorFee > 0; magaza Origin'i ve/veya integratorId): istenen tutar = ALICININ ALACAGI (payoutAmount).
//    Ucretler USTUNE eklenir: amount = istenen + serviceFee + integratorFee.
//  - ESKI (integratorFee 0; Origin'siz, integratorId'siz): istenen = amount (brut), ucret icten duser (15 -> 15 / 14.85 / 0.15 / 0).
// Varsayilan quoteFixture URETIM modelidir (25 istendi -> 25.25 / 25 / 0.125 / 0.125); eski model baseUsdc/arbitrumNative
// fixture'larindadir.
export const USDC_DEST_ECHO = Object.freeze({
    kind: 'evm', chainId: 56, assetId: getAddress('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'), assetSymbol: 'USDC', assetDecimals: 18,
    minDestAmount: '24000000000000000000', expectedDestAmount: '24650000000000000000',
    slippageBps: 100, route: 'cex-direct',
})

// Dondurulmus BSC dest bloklari: silentswap.js artik bunlari tutmuyor (kimlik yapisal esitlikle denetlenir), testler burada tutar.
export const USDC_BSC_DEST = Object.freeze({ kind: 'evm', chainId: 56, assetId: USDC_BSC, assetSymbol: 'USDC', assetDecimals: 18 })
export const NATIVE_BNB_DEST = Object.freeze({ kind: 'evm', chainId: 56, assetId: '0x0000000000000000000000000000000000000000', assetSymbol: 'BNB', assetDecimals: 18 })

export function quoteFixture(over = {}) {
    return {
        ticket: '0x' + '01'.repeat(32), id: '0x' + '01'.repeat(32), privacy: true, accessToken: 'tok-1',
        amount: '25250000000000000000', payoutAmount: '25000000000000000000',
        serviceFee: '125000000000000000', integratorFee: '125000000000000000',
        integratorAddress: getAddress('0x' + '99'.repeat(20)),
        expectedFulfillmentMs: 90000, expiresAt: Math.floor(Date.now() / 1000) + 600,
        deposit: { to: GATEWAY, data: '0xdeadbeef' + '00'.repeat(32), value: '0', chainId: 56 },
        recipient: { chainId: 56, address: GIZLI },
        recipients: [{ splitIndex: 0, address: GIZLI, chainId: 56, payoutAmount: '25000000000000000000' }],
        asset: 'USDC', sourceAsset: 'USDC', gateway: GATEWAY, usdc: USDC_BSC,
        inputAddress: GIRDI_ADRESI,
        sourceInput: { amount: '25250000000000000000', asset: 'USDC', decimals: 18, chainId: 56 },
        dest: { ...USDC_DEST_ECHO },
        ...over,
    }
}

// Siparisin SUNUCU durum kaydi (GET /order/{ticket}) yatirmadan ONCE, canli sekil (2026-10-10): alicinin
// `address`'i SIFIR yer tutucudur (gecici cuzdan sonra atanir); paranin gidecegi yer destAddress'tir.
// Iade order.signer'a gider (SDK refundOrder belgesi).
export function orderStateFixture(over = {}, recipientOver = {}) {
    const q = quoteFixture()
    return {
        ticket: q.ticket, status: 'AWAITING_DEPOSIT', sourceAsset: 'USDC', sourceChainKind: 'evm',
        amount: q.amount, payoutsAreEstimates: false, signer: q.inputAddress, fulfilledOnchain: false, gateway: GATEWAY,
        recipients: [{
            splitIndex: 0, address: '0x0000000000000000000000000000000000000000', chainId: 56,
            payoutAmount: q.payoutAmount, status: 'PENDING', fulfillmentRoute: 'cex-direct',
            destAddress: GIZLI.toLowerCase(), destChainKind: 'evm', destChainId: 56,
            destAssetId: USDC_BSC, destAssetSymbol: 'USDC', destAssetDecimals: 18,
            minDestAmount: '24000000000000000000', expectedDestAmount: '24650000000000000000',
            ...recipientOver,
        }],
        ...over,
    }
}

// Istek beklentileri (assertQuoteMatches ikinci argumani): quoteFixture() dogrudan BSC USDC
// teklifinin istegi. Koprululer asagida kendi istekleriyle birlikte gelir.
// GERCEK URETIM TEKLIFLERI (2026-10-29 olcumu, g3-probe/result.json): BSC USDC -> BSC USDC, Origin chrome-extension://hcfdepjikbhjocfdopeabjmonpnijoei
// + integratorId. Istenen = alicinin alacagi; ucret ustune eklenir.
const OLCUM_DEST = { kind: 'evm', chainId: 56, assetId: USDC_BSC, assetSymbol: 'USDC', assetDecimals: 18, minDestAmount: '14309569231055141224', expectedDestAmount: '14749092177958298521', slippageBps: 100, route: 'deposit-bridge' }
function olcumTeklifi({ amount, payout, serviceFee, integratorFee }, over = {}) {
    return quoteFixture({
        amount, payoutAmount: payout, serviceFee, integratorFee,
        integratorAddress: getAddress('0x79d2fbd9dd80956e5e50cfb496988b6265a76091'),
        recipients: [{ splitIndex: 0, address: GIZLI, chainId: 56, payoutAmount: payout }],
        sourceInput: { amount, asset: 'USDC', decimals: 18, chainId: 56 },
        dest: { ...OLCUM_DEST },
        ...over,
    })
}
export const olcum15Fixture = (over) => olcumTeklifi({ amount: '15150000000000000000', payout: '15000000000000000000', serviceFee: '75000000000000000', integratorFee: '75000000000000000' }, over)
export const olcum20Fixture = (over) => olcumTeklifi({ amount: '20200000000000000000', payout: '20000000000000000000', serviceFee: '100000000000000000', integratorFee: '100000000000000000' }, over)
// ESKI model (Origin'siz/integratorsuz): 15 -> 15 / 14.85 / 0.15 / 0 (baseUsdcQuoteFixture'in BSC USDC karsiligi).
export const olcumEski15Fixture = (over) => olcumTeklifi({ amount: '15000000000000000000', payout: '14850000000000000000', serviceFee: '150000000000000000', integratorFee: '0' }, { integratorAddress: null, ...over })

export const requestFixture = (over = {}) => ({
    sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25', outputToken: usdcTokenOf(56),
    outputAddress: GIZLI, inputAddress: quoteFixture().inputAddress,
    ...over,
})

// Ethereum USDT (ERC-20) kaynaktan koprulu teklif: izin VAR (spender = deposit.to = Depository), token USDT, value 0,
// cagri depositErc20(girdi adresi, USDT, bridge.sourceAmount, id). Cagridaki depositor teklifin inputAddress'idir
// (over.inputAddress verilirse o): canli teklifte de sunucu depositor'u istek adresinden yazar.
export function bridgedErc20QuoteFixture(over = {}) {
    return quoteFixture({
        deposit: { to: DEPOSITORY, data: depositErc20Data(over.inputAddress ?? GIRDI_ADRESI, USDT_ETH, '25300000'), value: '0', chainId: 1 },
        bridge: { protocol: 'relay', sourceChainId: 1, destinationChainId: 56, sourceToken: USDT_ETH, sourceUsdc: USDT_ETH, estimatedDeliveryMs: 60000, sourceAmount: '25300000' },
        sourceAsset: 'USDT',
        sourceInput: { amount: '25300000', asset: 'USDT', decimals: 6, chainId: 1 },
        ...over,
    })
}
export const bridgedErc20RequestFixture = (over = {}) => requestFixture({ sourceChainId: 1, sourceAsset: 'USDT', ...over })

// Ethereum ETH (native) kaynaktan koprulu teklif: izin yok, value = bridge.sourceAmount, cagri depositNative(girdi adresi, id).
export function bridgedNativeQuoteFixture(over = {}) {
    return quoteFixture({
        deposit: { to: DEPOSITORY, data: depositNativeData(over.inputAddress ?? GIRDI_ADRESI), value: '10000000000000000', chainId: 1 },
        bridge: { protocol: 'relay', sourceChainId: 1, destinationChainId: 56, sourceToken: '0x0000000000000000000000000000000000000000', sourceUsdc: '0x0000000000000000000000000000000000000000', estimatedDeliveryMs: 60000, sourceAmount: '10000000000000000' },
        sourceAsset: 'ETH',
        sourceInput: { amount: '10000000000000000', asset: 'ETH', decimals: 18, chainId: 1 },
        ...over,
    })
}
export const bridgedNativeRequestFixture = (over = {}) => requestFixture({ sourceChainId: 1, sourceAsset: 'ETH', ...over })

// Ethereum DAI (ERC-20, 18 ondalik) kaynaktan koprulu teklif. Sahte yanit denemeleri (deposit.to ve
// calldata) bunun uzerine kurulur: DAI'nin push/move gibi standart disi secicileri vardir.
export const DAI_ETH = getAddress('0x6b175474e89094c44da98b954eedeac495271d0f')
export function bridgedDaiQuoteFixture(over = {}) {
    return quoteFixture({
        deposit: { to: DEPOSITORY, data: depositErc20Data(over.inputAddress ?? GIRDI_ADRESI, DAI_ETH, '25300000000000000000'), value: '0', chainId: 1 },
        bridge: { protocol: 'relay', sourceChainId: 1, destinationChainId: 56, sourceToken: DAI_ETH, sourceUsdc: DAI_ETH, estimatedDeliveryMs: 60000, sourceAmount: '25300000000000000000' },
        sourceAsset: 'DAI',
        sourceInput: { amount: '25300000000000000000', asset: 'DAI', decimals: 18, chainId: 1 },
        ...over,
    })
}
export const bridgedDaiRequestFixture = (over = {}) => requestFixture({ sourceChainId: 1, sourceAsset: 'DAI', ...over })

// BSC kaynakli USDT (ERC-20, 18 ondalik): kopru kaynak ve hedef zinciri AYNI (56). Canli sekil (2026-10-26): deposit.to
// Relay onay aracisi, cagri transferAndMulticall (keyfi cagri listesi). Bu rota KAPALIDIR; fixture yalniz ret testleri icindir.
export const USDT_BSC = getAddress('0x55d398326f99059ff775485246999027b3197955')
export function bridgedBscUsdtQuoteFixture(over = {}) {
    return quoteFixture({
        deposit: { to: RELAY_APPROVAL_PROXY, data: '0xf9e4bab4' + '00'.repeat(64), value: '0', chainId: 56 },
        bridge: { protocol: 'relay', sourceChainId: 56, destinationChainId: 56, sourceToken: USDT_BSC, sourceUsdc: USDT_BSC, estimatedDeliveryMs: 30000, sourceAmount: '25300000000000000000' },
        sourceAsset: 'USDT',
        sourceInput: { amount: '25300000000000000000', asset: 'USDT', decimals: 18, chainId: 56 },
        ...over,
    })
}
export const bridgedBscUsdtRequestFixture = (over = {}) => requestFixture({ sourceChainId: 56, sourceAsset: 'USDT', ...over })

// CANLI SEKILLER (2026-10-15, api.silentswap.com, para hareketi yok; .superpowers/sdd/2026-10-15-gizli-mod-cok-ag/order-state-results.json):
// Base (8453) USDC ve Arbitrum (42161) yerel coin teslimi, 15 USDC brut, imzaci BSC USDC. TEKLIFTE recipients[0].chainId TESLIM
// agidir; siparis KAYDINDA recipients[0].chainId 56 SABIT (adres sifir yer tutucu) ve teslim agi yalniz destChainId'dedir.
const SIFIR = '0x0000000000000000000000000000000000000000'
export const BASE_USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')

export const BASE_USDC_DEST_ECHO = Object.freeze({
    kind: 'evm', chainId: 8453, assetId: BASE_USDC, assetSymbol: 'USDC', assetDecimals: 6,
    minDestAmount: '14346647', expectedDestAmount: '14787310', destQuoteUsd: 14.78160209834, destGasUsd: null,
    slippageBps: 100, quoteExpiresAt: 1792076630, route: 'cex-direct',
})
export function baseUsdcQuoteFixture(over = {}) {
    return quoteFixture({
        amount: '15000000000000000000', payoutAmount: '14850000000000000000', serviceFee: '150000000000000000', integratorFee: '0',
        integratorAddress: null, expectedFulfillmentMs: 120000,
        recipients: [{ splitIndex: 0, address: GIZLI, chainId: 8453, payoutAmount: '14850000000000000000' }],
        sourceInput: { amount: '15000000000000000000', asset: 'USDC', decimals: 18, chainId: 56 },
        dest: { ...BASE_USDC_DEST_ECHO },
        ...over,
    })
}
export const baseUsdcRequestFixture = (over = {}) => requestFixture({ payoutUsdc: '15', outputToken: usdcTokenOf(8453), ...over })
export function baseUsdcOrderStateFixture(over = {}, recipientOver = {}) {
    const q = baseUsdcQuoteFixture()
    return orderStateFixture({ ticket: q.ticket, amount: q.amount, sourceInput: q.sourceInput, ...over }, {
        payoutAmount: q.payoutAmount, destChainId: 8453, destAssetId: BASE_USDC, destAssetSymbol: 'USDC', destAssetDecimals: 6,
        minDestAmount: '14639436', expectedDestAmount: '14787310', ...recipientOver,
    })
}

export const ARBITRUM_NATIVE_DEST_ECHO = Object.freeze({
    kind: 'evm', chainId: 42161, assetId: SIFIR, assetSymbol: 'ETH', assetDecimals: 18,
    minDestAmount: '5970469911390198', expectedDestAmount: '6153854783951967', destQuoteUsd: 14.739282208687, destGasUsd: null,
    slippageBps: 100, quoteExpiresAt: 1792076635, route: 'cex-direct',
})
export function arbitrumNativeQuoteFixture(over = {}) {
    return quoteFixture({
        amount: '15000000000000000000', payoutAmount: '14850000000000000000', serviceFee: '150000000000000000', integratorFee: '0',
        integratorAddress: null, expectedFulfillmentMs: 120000,
        recipients: [{ splitIndex: 0, address: GIZLI, chainId: 42161, payoutAmount: '14850000000000000000' }],
        sourceInput: { amount: '15000000000000000000', asset: 'USDC', decimals: 18, chainId: 56 },
        dest: { ...ARBITRUM_NATIVE_DEST_ECHO },
        ...over,
    })
}
export const arbitrumNativeRequestFixture = (over = {}) => requestFixture({ payoutUsdc: '15', outputToken: nativeTokenOf(42161), ...over })
export function arbitrumNativeOrderStateFixture(over = {}, recipientOver = {}) {
    const q = arbitrumNativeQuoteFixture()
    return orderStateFixture({ ticket: q.ticket, amount: q.amount, sourceInput: q.sourceInput, ...over }, {
        payoutAmount: q.payoutAmount, destChainId: 42161, destAssetId: SIFIR, destAssetSymbol: 'ETH', destAssetDecimals: 18,
        minDestAmount: '6092316236112447', expectedDestAmount: '6153854783951967', ...recipientOver,
    })
}
