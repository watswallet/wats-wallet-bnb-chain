<template>
    <div class="w-full h-full max-w-[420px] mx-auto bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white flex flex-col relative overflow-hidden transition-colors duration-300">
        
        <div class="shrink-0 p-5 pb-0 relative z-10">
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/10 p-1 shadow-sm transition-colors duration-300">
                        <img 
                            :src="displayToken?.image.thumb" 
                            :alt="displayToken?.name" 
                            class="w-full h-full rounded-full object-cover"
                            @error="$event.target.src = 'https://api.dicebear.com/7.x/initials/svg?seed=' + displayToken?.symbol"
                        >
                    </div>

                    <div>
                        <h2 class="text-lg font-bold leading-tight text-slate-900 dark:text-white transition-colors duration-300">{{ displayToken?.name }}</h2>
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-[10px] font-bold text-slate-500 dark:text-zinc-500 bg-slate-200 dark:bg-zinc-800/50 px-1.5 py-0.5 rounded uppercase tracking-wider transition-colors duration-300">{{ displayToken?.symbol }}</span>
                            <!-- bStocks ROZETI: kullanicinin "Apple hissesi aldim" sanip
                                 aslinda bir SERTIFIKA aldigini fark etmemesi urun
                                 sorumlulugu (Binance'in kendi ifadesi: "bStocks do not
                                 allow holders to directly own a share or stock in the
                                 underlying listed company"). tokenIsBStock TEK kaynaktir --
                                 ihracci metni ve kopru kapisi da AYNI bayragi okur. -->
                            <span v-if="tokenIsBStock" class="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider transition-colors duration-300">{{ $t('token.bStockBadge') }}</span>
                        </div>
                    </div>
                </div>
                
                <button 
                    @click="page.currentPage = 'home'"
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10 text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>

            <div class="flex items-end gap-3 mb-2">
                <h1 class="text-3xl font-bold font-mono tracking-tight text-slate-900 dark:text-white transition-colors duration-300">${{ formatPrice(displayToken?.market_data.priceUSD) }}</h1>
                <div 
                    class="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold mb-1.5 shadow-sm dark:shadow-none transition-colors duration-300"
                    :class="displayToken?.market_data.change.h24 >= 0 ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'"
                >
                    <svg v-if="displayToken?.market_data.change.h24 >= 0" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M5 15l7-7 7 7"/></svg>
                    <svg v-else class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M19 9l-7 7-7-7"/></svg>
                    <span>{{ Math.abs(displayToken?.market_data.change.h24 || 0).toFixed(2) }}%</span>
                </div>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar relative pb-6 z-0">
            <div class="w-full h-50 mb-6 px-2">
                <CryptoChart v-if="displayToken?.coingecko_id" :id="displayToken.coingecko_id" />
                <!-- IKI AYRI DURUM, IKI AYRI METIN: kayit HENUZ YUKLENIYOR ile
                     kaydin fiyat gecmisi YOK (metadata bulunamamis SPL) ayni sey degil.
                     Tek bir "Grafik Yukleniyor..." ikisinde de nabiz gibi atip SONSUZA
                     KADAR takili kalirdi.

                     KOSUL `!displayToken` DEGIL `!loaded` (kod incelemesi, Bulgu A):
                     `displayToken` satir kaydindan turedigi icin ILK BOYAMADAN itibaren
                     DOLUDUR -- normal durum budur. Yani yukleme dali HIC calismiyor ve
                     kullanici, istek daha ucmadan "fiyat gecmisi yok" okuyordu; gecici
                     bir ag hatasi da KESIN bir yokluk gibi gorunuyordu. Bayrak
                     onMounted'in `finally`sinde set edilir: istek BITTI (basarili ya da
                     degil) demektir. -->
                <div v-else-if="!loaded" class="w-full h-full flex items-center justify-center text-slate-400 dark:text-zinc-600 text-xs animate-pulse">{{ $t('token.chartLoading') }}</div>
                <div v-else class="w-full h-full flex items-center justify-center text-slate-400 dark:text-zinc-600 text-xs">{{ $t('token.noChartData') }}</div>
            </div>

            <!-- Home.vue'nun aksine burasi CSS Grid degil flex+justify-center: sabit sutun
                 sayisi yok, gizlenen dugmelerden geriye ne kalirsa kendiliginden ortalanir.
                 Bir duzen sinifi uyarlamaya GEREK YOK - ve bu, Home.vue'nun ayni turda
                 dustugu tuzagi burada bastan onledi: orada sutun sayisi "TON ise 2" diye
                 SABIT yazilmisti ve takas acilinca 3 dugmeyi 2 sutuna sikistirdi.

                 K1 GECMISI: bu satir bir donem jetton satirlarinda TUMDEN gizliydi, cunku
                 Gonder duğmesi jetton satirinda sessizce NATIVE TON gonderiyordu (gonderme
                 akisi jettonlar icin henuz bagli degildi). Akis artik bagli - Gorev 11/12/13:
                 Send.vue jetton bakiyesini ayri okur, ConfirmTransaction.vue SEND_TON_JETTON
                 aksiyonuna gider, arka planda dort kapi calisir. Bu yuzden Gonder jetton
                 satirinda da acik.

                 Swap/Bridge artik `isTonAsset`e DEGIL akis tablosuna bakiyor. Home.vue'da
                 ayni vekil kosul vardi ve TON takasi acildiginda tablo "evet" demeye
                 basladi, `v-if` hala "hayir" diyordu; ozellik kullaniciya HIC gorunmedi
                 (bkz. chainKind.js bas yorumu). Burasi o duzeltmenin atlanmis ikizi.

                 Al (selectReceive) FLOW tablosuna GIRMEZ ve sebebi farkli: o dugme
                 BuyToken.vue'yu, yani MoonPay kredi karti akisini acar. MoonPay TON'u
                 kapsamiyor (spec §8), Solana'yi da; ustelik bu bir ZINCIR AKISI degil,
                 SAGLAYICI kapsami - FLOW tablosunda karsiligi yok. Bu yuzden IKI kapi
                 birden tasiniyor (asagidaki gerekce). -->
            <div class="flex justify-center gap-9 px-5 mb-8">
                <button @click="selectSend" class="flex flex-col items-center gap-2 group cursor-pointer">
                    <div class="w-12 h-12 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 group-hover:border-indigo-400 dark:group-hover:border-indigo-500/50 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/10 flex items-center justify-center text-slate-400 dark:text-zinc-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-all shadow-sm group-hover:shadow-md">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                    </div>
                    <span class="text-[11px] font-bold text-slate-500 dark:text-zinc-500 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors">{{ $t('token.send') }}</span>
                </button>

                <!-- BULGU 2 / F8 -- AYNI dugme, IKI dalda AYRI AYRI bulundu. Bu dugme
                     Home.vue'daki "Al" (adres gosteren Receive popup) DEGILDIR: handler'i
                     (selectReceive) hep 'buy_token' sayfasina, yani BuyToken.vue'nun MoonPay
                     kredi karti akisina gider; etiketi de zaten buyToken.buy'dur.
                     Iki gerekce CELISMIYOR, tamamliyor:
                       - TON: MoonPay TON'u kapsamiyor (spec §8) ve BuyToken.vue EVM `0x`
                         adresini "Alici Adresi" diye gosterip sunucuya currencyCode:'ton' +
                         walletAddress:0x gonderirdi -- Swap/Bridge ile AYNI desen.
                       - Solana: gercek bir Al eylemini (kendi adresini gosteren popup)
                         BURAYA baglamak, Receive.vue henuz Solana/EVM adres ayrimini
                         yapmadigi icin bu token-ozel ekranda YANLIS agin adresini gosterme
                         riskini buraya tasirdi -- dugme ne YAPTIGINA gore adlandirilir.
                     IKI KAPI DA TASINDI ve hicbiri otekinin kopyasi DEGIL:
                       - `features.buy` (Solana dali, evmGates): `chainVm(kayit) === 'evm'`
                         sorar, yani EVM-DISI her VM'i TEK kosulla kapatir. Kaynagi
                         `tokenChainRecord` oldugu icin kayit COZULEMEDIGINDE AKTIF aga
                         duser -- Token.ssr.test.js'in olctugu davranis: /getTokenDataById
                         500 dondugunde EVM'de dugme KAYBOLMAZ, Solana aktifken ACILMAZ.
                       - `!isTonAsset` (TON dali): MoonPay'in TON kapsam disi olmasi bir
                         ZINCIR KAYDI sorusu degil SAGLAYICI kapsamidir; kapi dogrudan
                         SATIRIN kaydina bakar ve evmGates'in ilerideki bir tanim
                         degisikliginden BAGIMSIZ durur. Bu dugme bir kez zaten yanlislikla
                         kosulsuz birakildi (bkz. jettonTokenWiring/tonFlowWiring testleri),
                         iki katmanli kapi o hatanin sessizce geri gelmesini engelliyor. -->
                <!-- ONRAMP_ENABLED: MoonPay akisi su anda ekranda GIZLI
                     (bkz. utils/onrampConfig.js). Kapi mevcut zincir kapilarinin
                     YERINE degil USTUNE geldi - onlari olcen uc test anlamini
                     korusun diye. -->
                <template v-if="features.buy && ONRAMP_ENABLED">
                    <button v-if="!isTonAsset" @click="selectReceive" class="flex flex-col items-center gap-2 group cursor-pointer">
                        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 group-hover:border-emerald-400 dark:group-hover:border-emerald-500/50 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 flex items-center justify-center text-slate-400 dark:text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-all shadow-sm group-hover:shadow-md">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 14 14"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="9.5" x=".5" y="2.25" rx="1"/><path d="M.5 5.75h13m-4 3.5H11"/></g></svg>
                        </div>
                        <span class="text-[11px] font-bold text-slate-500 dark:text-zinc-500 group-hover:text-emerald-600 dark:group-hover:text-white transition-colors">{{ $t('buyToken.buy') }}</span>
                    </button>
                </template>

                <button v-if="canSwap" @click="selectSwap" class="flex flex-col items-center gap-2 group cursor-pointer">
                    <div class="w-12 h-12 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 group-hover:border-amber-400 dark:group-hover:border-amber-500/50 group-hover:bg-amber-50 dark:group-hover:bg-amber-500/10 flex items-center justify-center text-slate-400 dark:text-zinc-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-all shadow-sm group-hover:shadow-md">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                    </div>
                    <span class="text-[11px] font-bold text-slate-500 dark:text-zinc-500 group-hover:text-amber-600 dark:group-hover:text-white transition-colors">{{ $t('token.swap') }}</span>
                </button>

                <!-- KOPRU KAPISI (Task 10) -- kod seviyesinde zaten kapali (commit
                     340603b: utils/bridge.js bStock icin BSTOCK_NOT_BRIDGEABLE
                     firlatiyor, bridge/bridgeFrom.vue bStocklari listeden eliyor).
                     Bu `:disabled` onun ARAYUZ ayagi: `canBridge` (chainSupportsFlow)
                     DEGISTIRILMEDI -- BSC her zaman kopru destekler, kapatan
                     `tokenIsBStock` USTUNE eklendi. Yalnizca kapatmak "neden?"
                     sorusunu cevapsiz birakirdi; asagidaki aciklama satiri bunun icin. -->
                <button v-if="canBridge" @click="selectBridge" :disabled="tokenIsBStock" class="flex flex-col items-center gap-2 group cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none">
                    <div class="w-12 h-12 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 group-hover:border-blue-400 dark:group-hover:border-blue-500/50 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 flex items-center justify-center text-slate-400 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all shadow-sm group-hover:shadow-md">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    <span class="text-[11px] font-bold text-slate-500 dark:text-zinc-500 group-hover:text-blue-600 dark:group-hover:text-white transition-colors">{{ $t('token.bridge') }}</span>
                </button>
            </div>

            <!-- Kopru butonunun HEMEN YANINDA: sadece dugmeyi kapatmak "neden?"
                 sorusunu cevapsiz birakir, sadece bu metni gostermek de kullanicinin
                 yine de tiklayip hataya dusmesine izin verir -- ikisi BIRLIKTE. -->
            <div v-if="tokenIsBStock" class="px-5 -mt-6 mb-8">
                <p class="text-[10px] leading-relaxed text-slate-400 dark:text-zinc-600 text-center">{{ $t('token.bStockNoBridge') }}</p>
            </div>

            <div class="px-5 mb-8">
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex items-center justify-between shadow-sm dark:shadow-2xl transition-colors duration-300">
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-1 transition-colors duration-300">{{ $t('token.yourBalance') }}</p>
                        <!-- balanceError=true (ör. TON proxy dustu / kasa kilitli): "0" DEGIL "—" -
                             spec "bakiye hata durumunda asla 0 gostermez" (bkz. onMounted). -->
                        <p class="text-xl font-bold text-slate-900 dark:text-white font-mono transition-colors duration-300">{{ balanceError ? '—' : balance.toFixed(6) }}</p>
                    </div>

                    <div class="text-right">
                        <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-1 transition-colors duration-300">{{ $t('token.value') }}</p>
                        <p class="text-xl font-bold text-indigo-600 dark:text-indigo-400 font-mono transition-colors duration-300">{{ balanceError ? '—' : '$' + formatCurrency(usdBalance) }}</p>
                    </div>
                </div>
            </div>

            <div class="px-5 flex flex-col gap-6">
                <div class="flex flex-col gap-2">
                    <h3 class="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/5 pb-2 transition-colors duration-300">{{ $t('token.tokenInfo') }}</h3>
                    
                    <div class="flex flex-col gap-3 text-xs">
                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.network') }}</span>
                            <span class="font-bold text-slate-700 dark:text-zinc-300 transition-colors duration-300">{{ assetChainName }}</span>
                        </div>
                        
                        <div v-if="displayToken?.address && displayToken?.address !== '0x0'" class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.contract') }}</span>
                            <div class="flex items-center gap-2">
                                <span class="font-mono text-slate-400 dark:text-zinc-400 transition-colors duration-300">{{ shortenAddress(displayToken?.address) }}</span>
                                <button @click="copy(displayToken?.address)" class="text-slate-400 hover:text-indigo-600 dark:text-zinc-500 dark:hover:text-white transition-colors cursor-pointer">
                                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                </button>
                            </div>
                        </div>

                        <div v-if="decimals" class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.decimals') }}</span>
                            <span class="font-mono font-bold text-slate-700 dark:text-zinc-300 transition-colors duration-300">{{ decimals }}</span>
                        </div>

                        <!-- ISIN yalnizca bStock satirinda: kanonik kayitta YOK, kaynagi
                             `data/bStocks.js` (zincirde `verify:bstocks` ile dogrulanir). -->
                        <div v-if="bStockIsin" class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.isin') }}</span>
                            <span class="font-mono font-bold text-slate-700 dark:text-zinc-300 transition-colors duration-300">{{ bStockIsin }}</span>
                        </div>

                        <!-- IHRACCI BILGISI (Task 10) -- bunlar hisse senedi DEGIL:
                             Binance'in kendi ifadesiyle "bStocks do not allow holders
                             to directly own a share or stock in the underlying listed
                             company". Kullanicinin Apple hissesi aldigini sanmasi ile
                             sertifika aldigini bilmesi arasindaki fark urun sorumlulugu. -->
                        <p v-if="tokenIsBStock" class="text-[10px] leading-relaxed text-slate-400 dark:text-zinc-600 pt-1 transition-colors duration-300">{{ $t('token.bStockIssuer') }}</p>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <h3 class="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/5 pb-2 transition-colors duration-300">{{ $t('token.marketData') }}</h3>
                    
                    <div class="flex flex-col gap-3 text-xs">
                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.marketCap') }}</span>
                            <span class="font-mono font-bold text-slate-700 dark:text-zinc-300 transition-colors duration-300">${{ formatCurrency(displayToken?.market_data.market_cap) }}</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.marketVolume') }}</span>
                            <span class="font-mono font-bold text-slate-700 dark:text-zinc-300 transition-colors duration-300">${{ formatCurrency(displayToken?.market_data.volume) }}</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.circulatingSupply') }}</span>
                            <span class="font-mono font-bold text-slate-700 dark:text-zinc-300 transition-colors duration-300">{{ formatCurrency(displayToken?.market_data.circulating_supply) }} {{ displayToken?.symbol.toUpperCase() }}</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.ath') }}</span>
                            <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400/80 transition-colors duration-300">${{ formatPrice(displayToken?.market_data.ath) }}</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('token.atl') }}</span>
                            <span class="font-mono font-bold text-rose-600 dark:text-rose-400/80 transition-colors duration-300">${{ formatPrice(displayToken?.market_data.atl) }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { useTokenBalance } from '../composables/useTokenBalance'
import { userStore } from '../store/user'
import { networkStore } from '../store/network'
import { popupStore } from '../store/popup'
import CryptoChart from './CryptoChart.vue'
import { Contract, JsonRpcProvider } from 'ethers'
import { shortenAddress } from '../utils/shortenAddress'
import { copy } from '../utils/copy'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { configStore } from '../store/config'
import { useI18n } from 'vue-i18n'
import { ALL_CHAINS } from '../data/chains'
import { applyNetworkChange } from '../utils/applyNetworkChange'
import { evmOnlyFeatures } from '../utils/evmGates'
import { ONRAMP_ENABLED } from '../utils/onrampConfig'
import { chainVm, isSameChainId, rpcUrlsOf } from '../utils/vm'
import { tokenBucketKey } from '../utils/homeTokenBucket'
import { isResolvableChainId } from '../utils/chainIdentity'
import { rowTokenRecord } from '../utils/tokenRowRecord'
import { recoveredCoingeckoId } from '../utils/tokenIdentityByAddress'
import { isTon, chainSupportsFlow, FLOW } from '../utils/chainKind'
import { isBStock, bStockByAddress } from '../utils/bstocks'
import { NATIVE_TOKEN_ADDRESS, withNativeIdentity } from '../utils/nativeToken'
import { getJettonWalletAddress } from '../utils/ton/jettonAddress'
import { getJettonBalance } from '../utils/ton/jettonBalance'
import { getTonClient } from '../utils/ton/tonClient'
import { getTonBalance } from '../utils/ton/tonBalance'
import { ensureTonAddress } from '../utils/ton/tonIdentity'

const props = defineProps(['id'])

const crypto = cryptoStore()
const popups = popupStore()
const page = pageStore()
const network = networkStore()
const user = userStore()
const config = configStore()
const { t } = useI18n()

// IKINCI GIRIS KAPISI: Home.vue'nun Swap/Kopru dugmelerini gizlemesi yetmez --
// bu ekran (bir tokenin detay sayfasi) AYNI ozelliklere KENDI dugmeleriyle
// ulasiyor.
//
// KOD INCELEMESI (F4): kaynak AKTIF AG DEGIL, TOKENIN KENDI KAYDIDIR. `ensureChain()`
// (asagida) zaten Send/Swap/Bridge'e GITMEDEN ONCE kaydin zincirine geciyor -- yani
// bu ekranin "hangi zincirde calisiyoruz" sorusunun dogru cevabi HER ZAMAN token
// kaydi, aktif ag degil. tokenScope varsayilani "Tum Aglar" oldugu icin (bkz.
// store/tokenScope.js) Home ayni anda BIRDEN FAZLA zincirin tokenini listeler:
// Solana aktifken bir Polygon USDT satirina tiklamak swap/bridge/buy'i GERCEKTEN
// kullanilamaz yapmaz -- aktif agi okumak bunlari YANLISLIKLA gizlerdi.
//
// KOD INCELEMESI (turu 2, C): "kaydin zinciri" ile ensureChain BIRE BIR ayni
// kosulu kullanir -- cunku dugmenin ANLAMLI olup olmadigini belirleyen sey,
// tiklandiginda islemin HANGI zincirde calisacagidir:
//   1. chainId SAYIYA CEVRILEMIYORSA (kayit HENUZ YUKLENMEDI, istek BASARISIZ
//      oldu ya da pickedRef metin bir kimligi reddetti) ensureChain `true` doner
//      ve HICBIR gecis yapmaz -- islem AKTIF AGDA calisir, dolayisiyla kapi da
//      AKTIF AGA bakar. Bu ayni zamanda Task 15 ONCESI davranisi geri getirir:
//      olculdu ki aksi halde /getTokenDataById 500 dondugunde (ya da her normal
//      yuklemenin ILK anlarinda) Ethereum'da Swap/Kopru/Al-Sat KAYBOLUYORDU.
//   2. chainId cozulurse ensureChain O ZINCIRE gecer -- kapi o kayda bakar (F4).
//   3. chainId var ama ALL_CHAINS'te YOKSA ensureChain `false` doner ve akisi
//      DURDURUR -- kapi da kapali (null) kalir.
// Karsilastirma ensureChain'deki gibi isSameChainId ile yapilir; iki farkli
// karsilastirici tutmak (isSameChainId burada, Number orada) tam da bu esligin
// sessizce bozulacagi yerdi.
//
// "COZULEMEYEN kimlik" olcutu ARTIK Number() DEGIL: eskiden
// `!Number.isFinite(Number(id))` yaziyordu ve Solana'nin METIN kimligi
// ('solana-mainnet') bu suzgecte "kimlik yok" sayilip AKTIF aga dusuyordu --
// dogru cevabi (Solana kaydi) BILIYOR olmasina ragmen.
//
// KOD INCELEMESI (Bulgu 4): olcut assetChain.js ile PAYLASILIR. Bir ara surumde
// burada yalnizca BOSLUK kontrolu vardi ve bu, sayiya cevrilemeyen COZULEMEZ bir
// kimligi ('abc') "beyan edilmis kimlik" sayiyordu: tokenChainRecord null'a,
// ensureChain false'a duser, Gonder dugmesi ISLEVSIZ kalirdi. assetChain.js ise
// AYNI degeri bilerek MUAF sayiyor (swapTokenState T11/T23). Iki yer ayni
// fonksiyondan okur.
const chainIdMissing = (id) => !isResolvableChainId(id)

// KAPI UC KAYNAGI BU SIRAYLA OKUR (kod incelemesi, birlesme sonrasi tur -- FAIL-OPEN).
//
// Eskiden YALNIZCA kanonik kayit (`token.value`) okunuyordu ve o kayit cozulemedigi
// ANDA kapi AKTIF AGA dusuyordu. Somut ariza: tokenScope varsayilani "Tum Aglar" +
// aktif ag Ethereum + metadata'si OLMAYAN bir SPL satiri -> coingecko_id null ->
// props.id null -> /getTokenDataById reddeder -> token.value null -> kapi ETHEREUM
// kaydini okur -> o SOLANA satirinda Takas/Kopru/Al ACILIRDI. Dosyanin kendi
// gerekcesi ("kaynak SATIRIN kaydidir, aktif ag DEGIL") calisma zamaninda tam da
// en cok gerektigi anda karsilanmiyordu.
//
// UCUNCU KAYNAK -- `pickedRef()`, yani SATIRIN kendisi. Iki durum BIRBIRINE
// KARISTIRILMAMALI ve ayiran sey SATIRIN BEYAN ETTIGI kimliktir:
//   1. Kanonik kayit COZULDU  -> kaydin zinciri (eskisi gibi).
//   2. Kanonik kayit YOK/kimliksiz AMA satir COZULEBILIR bir chainId tasiyor ->
//      SATIRIN zinciri. `selectSend` zaten bu kaydi (displayToken) kullaniyor ve
//      `ensureChain` onun zincirine geciyor: yani islem GERCEKTEN orada calisir.
//   3. Ortada cozulebilir bir kimlik HIC YOK (satir yok, ya da 'abc' gibi
//      cozulemeyen bir deger -- pickedRef onu zaten REDDEDER) -> aktif ag SON
//      CARE. Bu, 2. maddeyle CELISMEZ: bu halde ensureChain de hicbir gecis
//      YAPMAZ, yani islem gercekten AKTIF AGDA calisir. Token.ssr.test.js'in
//      "500/red/'abc'" testlerinin olctugu davranis (EVM'de dugmeler GORUNUR
//      kalir) tam olarak budur ve "token HENUZ YUKLENMEDI" hali de buraya duser.
const tokenChainRecord = computed(() => {
    const id = token.value?.chainId
    if (!chainIdMissing(id)) return ALL_CHAINS.find(c => isSameChainId(c.chainId, id)) || null

    // SATIR: `pickedRef()` id eslesmesini ve "cozulebilir kimlik" olcutunu ZATEN
    // uyguluyor (bayat bir selected_token_ref ya da 'abc' buradan gecmez), yani
    // ikinci bir olcut YAZILMAZ -- displayToken/selectSend ile ayni kaynak.
    const rowId = pickedRef()?.chainId
    if (!chainIdMissing(rowId)) return ALL_CHAINS.find(c => isSameChainId(c.chainId, rowId)) || null

    return network.currentNetwork || null
})
const features = computed(() => evmOnlyFeatures(tokenChainRecord.value))

// EKRANIN GOSTERDIGI kayit. `token` (kanonik kayit + satir kimligi)
// COZULEMEDIGINDE satirin KENDISINDEN tam sekilli bir kayit uretilir: kullanici
// gercek bakiyesi olan bir satira basti, karsisina isimsiz bos bir ekran cikmamali.
//
// `token.value` KASTEN ayri birakildi (bu computed onu EZMEZ): Takas/Kopru
// gecisleri ve tokenChainRecord/features bugunku kaynaklarini korur -- EVM'de
// kanonik kayit yuklenemediginde ki davranis (dugmeler GORUNUR kalir,
// swap.inToken null gider) tek satir degismez.
//
// `withNativeIdentity`: NATIVE varligin ADI ve SEMBOLU cuzdanindir, kanonik
// kaydin degil. Kanonik kayit ucuncu tarafin (CoinGecko) adini tasiyor -- CANLI
// OLCUM (2026-09-17) {id:'the-open-network'} -> `{ name:"Toncoin", symbol:"ton" }`
// -- ve bu kayit ekrana DOGRUDAN basiliyordu: baslik "Toncoin", rozet "ton",
// "Dolasimdaki Arz" birimi "TON". Kullanici ana ekranda GRAM, bir tik sonra
// Toncoin goruyordu; ilk boyama satirdan dogru GRAM'i gosterdigi icin ekran
// istek donunce GERI DONUYORDU. Ezme yalnizca native tabloda kimligi olan
// kayitlarda calisir, `market_data`/adres/ondalik DOKUNULMAZ.
const displayToken = computed(() => withNativeIdentity(token.value || rowTokenRecord(pickedRef())))

const token = ref(null)
// Kanonik kayit istegi BITTI mi (basarili, basarisiz ya da atlanmis). "Kayit var mi"
// ile "istek bitti mi" AYRI sorulardir; grafik ikincisine bakar.
const loaded = ref(false)
const balance = ref(0)
const usdBalance = ref(0)
const decimals = ref(null)
// Bakiye hata durumunda ASLA 0 gostermez (spec). TON kolu proxy/kilitli kasa
// hatasinda bu bayragi TRUE birakir; sablon o zaman miktar yerine "—" basar
// (Home.vue'daki ayni desen — bkz. asagidaki onMounted).
const balanceError = ref(false)

// Swap/Bridge SATIRIN KENDI zincirine gore kapatilir, AKTIF aga gore degil: bu ekran
// capraz zincir bir portfoyden aciliyor, kullanici EVM agindayken bile bir TON
// varligina (Home > "Tum Aglar") tiklayabilir. `token.value.chainId` `pickedRef()`
// ile `crypto.selected_token_ref.chainId`'den geliyor — o da Home.vue'nun tikladigi
// SATIRIN gercek chainId'si (bkz. Home.vue selectToken). `network.currentNetwork`
// burada YANLIS kaynak olurdu.
const isTonAsset = computed(() => isTon(token.value))

// Hangi eylemin bu zincirde ANLAMI VAR sorusunun tek cevabi chainKind.js'teki
// tablodur; burasi onu OKUR, yeniden karar VERMEZ (Home.vue'daki canSwap/canBridge
// ile ayni kaynak).
//
// BIRLESME KARARI -- `evmOnlyFeatures().swap/bridge` BILEREK AND'LENMEDI (ve o
// iki alan sonradan evmGates.js'ten TAMAMEN KALDIRILDI: uretimde okuyuculari
// kalmamisti, ama orada durduklari surece otorite gibi okunuyorlardi). Solana
// dali bu iki dugmeyi `features.swap`/`features.bridge` ile kapatiyordu; o bayraklar
// `chainVm === 'evm'` VE zincirin rpc listesi dolu istiyordu. Ikisini birlestirmek
// TON TAKASINI OLDURURDU (chainVm TON'da 'ton'), oysa TON'da motor VAR: STON.fi.
// Tersi de dogru degil -- Solana icin AYRICA bir sey eklemeye gerek YOK:
// chainSupportsFlow zaten `isEvm=false` uzerinden hem takasi hem kopruyu kapatiyor,
// yani Solana dalinin BU EKRANDAKI amaci tam olarak karsilaniyor. Geriye yalnizca
// evmGates'in "rpc listesi dolu mu" terimi kaliyordu ve o BILINCLI olarak disarida:
// chainKind.js'in kopru gerekcesi onu ACIKCA reddediyor (gecici bir veri
// duzenlemesi calisan bir kopruyu sessizce kapatmasin) ve Home.vue ayni kapiyi
// rpc terimi OLMADAN kuruyor -- Token.vue'ya eklemek ayni zincirde iki ekranin
// FARKLI cevap verdigi bir tutarsizlik uretirdi.
//
// KAYNAK `tokenChainRecord` -- ne ham `token.value` ne de `network.currentNetwork`:
//   - aktif ag YANLIS olurdu: capraz zincir portfoyde (Home > "Tum Aglar")
//     Ethereum'dayken acilan bir TON/Solana satirinda kapi yanlis cevap verir.
//   - ham `token.value` (satirin token kaydi) BU BIRLESMEDE kirilgan: o nesne ne
//     `kind` ne `vm` alani tasir, yani chainKind onu ancak chainId'yi Number()'a
//     cevirip NaN'a dusurerek "bilinmeyen" sayiyor. Solana su an DOGRU sonucu
//     YANLIS sebeple aliyor (bkz. chainKind.js'in ayni tuzagi anlatan bas yorumu).
//     `tokenChainRecord` ALL_CHAINS kaydidir ve `vm: 'solana'` / `kind: 'ton'`
//     alanlarini TASIR: kapi zincir tipini TAHMIN etmez, OKUR.
//   - Ek olarak `token.value` kanonik kayit gelene kadar null'dur; /getTokenDataById
//     500 dondugunde ya da her yuklemenin ilk aninda Ethereum'da Takas/Kopru
//     KAYBOLUYORDU. tokenChainRecord bu halde aktif aga duser -- ve ensureChain()
//     de AYNI olcutle davranip hicbir gecis yapmaz, yani kapinin baktigi kayit ile
//     dugmeye basilinca calisilacak ag HER ZAMAN ayni.
const canSwap = computed(() => chainSupportsFlow(tokenChainRecord.value, FLOW.SWAP))
const canBridge = computed(() => chainSupportsFlow(tokenChainRecord.value, FLOW.BRIDGE))

// BSTOCKS ROZETI / IHRACCI / KOPRU KAPISI (Task 10) -- UCU DE AYNI bayraktan
// okur, TEK kaynak. Zincir `tokenChainRecord`ten (Takas/Kopru kapisiyla AYNI
// kaynak, F4 gerekcesi): kanonik kayit chainId TASIMIYOR olabilir, tokenChainRecord
// ise SATIRIN kimligini de kaynak sayar (yukaridaki uc kaynakli kapi). Adres
// `displayToken`ten: EKRANIN GOSTERDIGI kayit, kullanicinin bastigi satirin
// gercek kontrat adresidir. isBStock kendisi zincir=56 disini zaten ELER
// (utils/bstocks.js), yani BSC disinda bu bayrak HER ZAMAN false.
//
// KOPRU KAPISI BURADA BILEREK `canBridge`i EZMEZ: chainSupportsFlow tablosu
// "bu zincirde kopru VAR MI" sorusuna cevap verir ve BSC icin dogru cevap hala
// EVET (baska her BSC tokeni koprulenebilir). `tokenIsBStock` bunun USTUNE
// gelen IKINCI, urun-ozel bir kisitlama -- kod seviyesindeki kapi zaten kapali
// (utils/bridge.js BSTOCK_NOT_BRIDGEABLE, commit 340603b), burasi yalnizca
// dugmeyi de disabled yapip yanina aciklama koyar.
const tokenIsBStock = computed(() => isBStock(tokenChainRecord.value?.chainId, displayToken.value?.address))

// ISIN -- spec §6.2'nin kapanmamis tek vaadi: deger `data/bStocks.js`te
// vardi ama HICBIR ekranda gosterilmiyordu. Hisse detayinin ait oldugu yer:
// tokenize edilmis SERTIFIKANIN altindaki gercek menkul kiymeti kullanici
// ancak boyle dogrulayabilir.
//
// AYNI SORGUNUN IKI YUZU: `isBStock` zaten `bStockByAddress(...) !== null`
// demektir ve iki satir BIREBIR ayni argumanlari veriyor -- ayri bir
// zincir/adres kaynagi YOK, dolayisiyla ikisi CELISEMEZ.
const bStockIsin = computed(() => bStockByAddress(tokenChainRecord.value?.chainId, displayToken.value?.address)?.isin ?? null)

// K1 (merge engeli) — isTonAsset TEK BASINA yetersizdi: yalnizca SATIRIN ZINCIRINE
// bakiyor, ayni zincirdeki NATIVE TON ile bir JETTON satirini AYIRT ETMIYORDU. Sonuc:
// bir jetton satirinda native TON bakiyesi okunup jetton sembolu altinda gosteriliyor
// ve "Gonder" dugmesi (asagida selectSend) sessizce NATIVE TON gonderiyordu.
//
// Ayrim Home.vue'nun updateBalance kolundaki AYNI kaynaktan: `NATIVE_TOKEN_ADDRESS`
// disinda bir adres tasiyan TON satiri jetton'dur (bkz. Home.vue "if (token.address
// !== NATIVE_TOKEN_ADDRESS) return" - orada native/jetton okumasini ayirmak icin
// kullanilan tam olarak bu kontrol). Yeni bir kavram ICAT EDILMEDI, var olan
// ayrim tasindi.
const isTonJetton = computed(() => isTonAsset.value && token.value?.address !== NATIVE_TOKEN_ADDRESS)

// "Ag" satiri da ayni kok soruna sahipti: eskiden `network.currentNetwork.name`
// (AKTIF ag) okunuyordu. Capraz zincir portfoyde (Home > "Tum Aglar") kullanici
// Ethereum'dayken bir TON/Polygon satirina tiklarsa ekran hala "Ethereum" yazardi —
// TON'a ozel olmayan ama TON'da da yanlis olan ayni karisiklik. SATIRIN kendi
// chainId'sinden (`token.value.chainId`, yukaridaki isTonAsset ile ayni kaynak)
// ALL_CHAINS uzerinden ad cozuluyor; bu dosyada zaten import edili (rpcForChain,
// ensureChain). chainId cozulemezse (nadir: pickedRef() id uyusmazligi, kanonik
// kayda dusulur) aktif ag SON CARE olarak kalir — hicbir ad gostermemekten iyi.
const assetChainName = computed(() => {
    // Karsilastirma isSameChainId ile (bu dosyadaki DIGER her kimlik karsilastirmasiyla
    // ayni olcut): `Number()` Solana'nin METIN kimligini ('solana-mainnet') NaN yapar,
    // `NaN === NaN` false'tur ve satir SOLANA'dayken bile aktif agin adini yazardi --
    // TON'daki "Ethereum yaziyor" hatasinin Solana'daki birebir ikizi.
    const chain = ALL_CHAINS.find(c => isSameChainId(c.chainId, token.value?.chainId))
    // AYNI KOK NEDENIN ETIKET IKIZI (birlesme sonrasi tur): kanonik kayit
    // cozulemediginde (metadata'si olmayan SPL satiri, /getTokenDataById 500)
    // burasi DOGRUDAN aktif agin adina dusuyordu -- Ethereum'dayken acilan bir
    // SOLANA satirinda "Ag: Ethereum" yaziyordu; bu, testin kapattigi TON
    // hatasinin ("ekran hala Ethereum yazardi") birebir ikizi. `tokenChainRecord`
    // araya girer: o da satirin kimligini okur ve HICBIR kaynak cozulemezse zaten
    // aktif aga duser, yani son care DEGISMEDI.
    return chain?.name || tokenChainRecord.value?.name || network.currentNetwork?.name || ''
})

const ERC20_ABI = [
    "function decimals() view returns (uint8)"
]

// Yardımcı Format Fonksiyonları
const formatPrice = (val) => {
    if(!val) return '0.00'
    return val < 0.01 ? val.toFixed(6) : val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const formatCurrency = (val) => {
    if(!val) return '0'
    return val.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// KIMLIK satirdan, PIYASA VERISI kanonik kayittan.
//
// `/getTokenDataById` kaydi chainId ve decimals TASIMIYOR; `address` alani tokenin
// ANA zincirindeki adres (canli olculdu: tether -> 0xdac17f95…/ethereum). Home satiri
// ise gercek `(chainId, address)` cifti — kullanicinin bastigi sey odur. Kimligi
// kanonik kayda EZDIRMEK, Polygon USDT'yi Ethereum adresiyle acmak demekti.
//
// `id` karsilastirmasi emniyet kemeri: baska bir giris noktasi `selected_token_id`'yi
// yazip `selected_token_ref`'i bayat birakirsa ESKI satirin adresi yapisirdi.
//
// `Number.isFinite(Number(picked.chainId))` KALDIRILDI: Solana satirlarinin
// kimligi METIN oldugu icin bu kontrol onlari TOPTAN reddediyordu. Sonuc, Home'da
// bir SOL satirina basip Gonder'e gitmekti: kayit kanonik kayda EZILIYOR, yani
// `chainId` YOK oluyor ve `address` tokenin ANA zincirindeki adres ('0x0') olarak
// kaliyordu. Send.vue ise `crypto.sendAsset?.address || SOL_NATIVE_MARKER` diyor --
// '0x0' bos DEGIL, dolayisiyla native SOL bir SPL MINT'i saniliyordu.
const pickedRef = () => {
    const picked = crypto.selected_token_ref
    if (!picked || picked.id !== props.id) return null
    return !chainIdMissing(picked.chainId) && picked.address ? picked : null
}

// Kaydin ait oldugu zincirin RPC'si. Home 'Tum Aglar' kapsaminda AKTIF OLMAYAN
// zincirin satirini da gosteriyor; `network.rpc` ile okumak o satirda yanlis zincire
// sorar (bakiye 0 / "bu adreste kontrat yok").
// Yalnizca EVM yolundan cagrilir (asagidaki VM dali once doner). `rpcUrlsOf`
// kullanilir, ham `chain.rpc[0]` degil: EVM-disi bir kayitta o okuma TypeError'dir.
const rpcForChain = (chainId) => {
    if (chainIdMissing(chainId) || isSameChainId(chainId, network.currentNetwork?.chainId)) {
        return network.rpc
    }
    const chain = ALL_CHAINS.find(c => isSameChainId(c.chainId, chainId))
    return rpcUrlsOf(chain)[0] || network.rpc
}

/**
 * Satirin fiyat kimligini ADRESTEN kurtarir.
 *
 * NEDEN: ana ekran listesi `chrome.storage.local.imported_tokens` icinden gelir ve
 * o kayit DONDURULMUS bir anlik goruntudur -- hicbir kod onu sunucuyla tazelemez
 * (bkz. utils/ton/tonTokenSeed.js: "imported_tokens icin baska hicbir yerde
 * goc/onarim yok"). Satir sunucunun o GUNKU cevabini tasir: kurasyonlu TON
 * jettonlari 2026-08-24..2026-09-17 arasinda kimliksiz donuyordu (bkz. e70b89d),
 * yani o pencerede eklenen satir KALICI olarak `coingecko_id`siz kaldi ve bu ekran
 * {id: undefined} ile istek atip 404 aliyor, fiyat/grafik/piyasa verisi HIC gelmiyordu.
 * Kullanicidan tokeni silip yeniden eklemesini beklemek yerine kimlik adresten
 * cozulur -- ayni onarim her zincirdeki bayat satirda calisir.
 *
 * ZINCIR DOGRULAMASI `recoveredCoingeckoId`e AITTIR ve atlanamaz: uc, govdedeki
 * chainId'yi YOK SAYAR ve DB kolunda adres benzersiz DEGILDIR (gerekce ve canli
 * olcumler utils/tokenIdentityByAddress.js bas yorumunda).
 */
const recoverIdByAddress = async (row) => {
    if (!row?.address) return null
    try {
        const { data } = await axios.post(config.api + '/getTokenByAddress', { address: row.address })
        return recoveredCoingeckoId(data?.token, row)
    } catch (e) {
        // Bilinmeyen adres temiz 404 doner; gecici ag hatasi da buraya duser.
        // Ikisi de "kimlik yok" demektir: cagiran yedek kayda (rowTokenRecord) duser.
        console.warn('Kimlik adresten cozulemedi:', e.message)
        return null
    }
}

onMounted(async() => {
    try {
        const { active_account } = await chrome.storage.local.get('active_account')

        // chainId KENDI TIPINDE yazilir (EVM: sayi, Solana: metin). Eskiden
        // `Number(picked.chainId)` vardi -- Solana satirinda NaN uretirdi ve bu
        // NaN oldugu gibi `crypto.sendAsset`e tasinirdi.
        const picked = pickedRef()

        // KIMLIK SIRASI: satirin KENDI kimligi once. Kurtarma yalnizca o YOKKEN
        // devreye girer -- yani saglam satirlarda FAZLADAN TEK BIR ISTEK bile
        // uretilmez (adres ucunun toplu karsiligi yok, her satir ayri istektir).
        const tokenId = props.id || await recoverIdByAddress(picked)

        // Kimlik hicbir yoldan cozulemedi: istek ATILMAZ. {id: undefined} ile
        // gitmek ucun 404'unu beklemekten baska bir sey yapmiyordu.
        if (!tokenId) return

        const response = await axios.post(config.api + '/getTokenDataById', {
            id: tokenId
        })

        if(response.status !== 200) return

        token.value = picked
            ? { ...response.data.token, chainId: picked.chainId, address: picked.address }
            : response.data.token

        // SOLANA DALI EVM'DEN ONCE. Buradan asagisi ethers'tir: JsonRpcProvider,
        // ERC-20 `decimals()`, useTokenBalance. Solana kaydinda `rpc` alani YOK
        // (bkz. utils/vm.js), yani saglayici ONCEKI zincirin bayat ucuna -- ya da
        // hicbir yere -- baglanir; `decimals()` duser ve varsayilan 18 KAYDA
        // yazilirdi (SOL 9 ondalikli), bakiye de her zaman 0 gorunurdu.
        //
        // Bakiye Home'un AZ ONCE yazdigi kovadan okunur (ayni anahtar sozlesmesi,
        // bkz. homeTokenBucket.js): kullanicinin bir satir once gordugu SAYININ
        // AYNISI. Yeni bir ag turu ACILMAZ -- bu ekrana yalnizca o listeden
        // gelinir. Kayit yoksa 0. `decimals` ise ASLA tahmin edilmez: satir onu
        // tasiyorsa yazilir, tasimiyorsa null kalir (sablon o satiri gizler) --
        // ERC-20 dalinin varsayilani olan 18'i yazmak duz bir YALAN olurdu.
        if (chainVm(tokenChainRecord.value) === 'solana') {
            // Ondalik SATIRDAN gelir (bkz. Home.vue selectToken): kanonik kayitta
            // YOK ve zincirden okuyacak bir ERC-20 `decimals()` karsiligi da yok.
            // Kayda YAZILIR cunku bu kayit oldugu gibi `crypto.sendAsset`e tasiniyor
            // ve Send/ConfirmTransaction ondaligi ORADAN okuyor.
            if (Number.isInteger(picked?.decimals)) {
                decimals.value = picked.decimals
                token.value = { ...token.value, decimals: decimals.value }
            }

            const cached = user.tokenBalances[tokenBucketKey(token.value.chainId, token.value.address)]
            balance.value = cached?.amount || 0
            usdBalance.value = cached?.value ?? ((token.value.market_data?.priceUSD || 0) * balance.value)
            return
        }

        const rpc = rpcForChain(token.value.chainId)

        // Bakiye ve Decimals çekimi
        //
        // `!isTonAsset.value` KAPISI (Solana dalinin yukaridaki AYNI gerekcesi):
        // buradan asagisi ethers'tir ve kosul yalnizca "adres '0x0' degil" diyordu,
        // yani bir JETTON MASTER adresinde de kosuyordu. TON kaydinda RPC ucu YOK
        // (data/supported_chains.json -239 -> rpc: []), cagri duser ve `catch`
        // kayda VARSAYILAN 18 yazardi. O deger dogrudan getJettonBalance'a gider:
        // 6 ondalikli USDT'nin ham miktari 1e18'e bolunup bakiye 1e12 kat KUCUK
        // cikar (ekranda yine "0.000000") ve "Ondalik" satiri 18 YALANINI basardi.
        // Jetton ondaligi zincirden DOGRULANMIS bir veridir (bkz. server/data/
        // tonJettons.js) ve satirda ZATEN tasinir; tahmin edilecek bir sey yok.
        if (!isTonAsset.value && token.value.address && token.value.address !== '0x0') {
            const provider = new JsonRpcProvider(rpc)
            // Hata önleme: Sadece geçerli adreslerde contract oluştur
            try {
                const contract = new Contract(token.value.address, ERC20_ABI, provider)
                decimals.value = Number(await contract.decimals())
            } catch (e) {
                console.warn('Decimals fetch failed', e)
                decimals.value = 18 // Varsayılan
            }
            // Zincirden okunan deger KAYDA yazilir: kanonik kayitta `decimals` YOK ve bu
            // kayit oldugu gibi `sendAsset`/`swap.inToken`'a tasiniyor.
            token.value = { ...token.value, decimals: decimals.value }
        }

        // Bakiye AYRI kapali devre: `useTokenBalance` yanlis agda/kontratsiz adreste
        // firlatiyor ve eskiden ayni try'da oldugu icin fiyat satirini da goturuyordu.
        //
        // TON kolu AYRIDIR: `useTokenBalance` saf EVM (ethers.JsonRpcProvider +
        // getBalance/balanceOf), TON'dan habersiz. Eskiden bu kol TON satirinda da
        // calisiyordu ve `rpcForChain` TON'un bos rpc listesi yuzunden ya `null`'a
        // (aktif ag TON'ken → bakiye hep "0") ya da AKTIF EVM agina (aktif ag EVM'ken,
        // capraz zincir portfoyden bakilinca → kullanicinin ETH/BNB bakiyesi SESSIZCE
        // "TON" etiketiyle) dusuyordu — Home.vue'daki TON koluyla AYNI desen (kendi
        // try/catch'i, `getTonBalance`) buraya da tasindi. Karar SATIRIN zincirine
        // gore (isTonAsset), aktif aga gore DEGIL.
        if (isTonAsset.value) {
            // Ondalik SATIRDAN gelir (Solana dalindaki AYNI desen ve AYNI gerekce):
            // kanonik kayittaki `decimals` tokenin ANA zincirine aittir -- TON USDT'nin
            // kanonik kaydi Ethereum USDT'dir -- ve zincirden okuyacak bir ERC-20
            // `decimals()` karsiligi TON'da YOK. Kayda YAZILIR cunku bu kayit oldugu
            // gibi `crypto.sendAsset`/`swap.inToken`a tasiniyor ve asagidaki jetton
            // bakiyesi de onu okuyor. Satir tasimiyorsa alan UYDURULMAZ: getJettonBalance
            // gecersiz ondaligi reddeder ve sablon "0" degil "—" basar.
            if (Number.isInteger(picked?.decimals)) {
                decimals.value = picked.decimals
                token.value = { ...token.value, decimals: decimals.value }
            }

            if (isTonJetton.value) {
                // Jetton bakiyesi Home.vue'daki AYNI zincirle okunur:
                // getJettonWalletAddress -> getJettonBalance. Eskiden burada
                // `balanceError = true` vardi (K1) cunku bu yol henuz tasinmamisti;
                // getTonBalance'i cagirip sonucu jetton sembolu altinda gostermek
                // BASKA bir varligin bakiyesini dogru sanip gostermek olurdu.
                //
                // HATA YUTULMAZ: getJettonBalance hicbir hatayi 0'a cevirmez
                // (ondalik eksik, proxy dustu, kasa kilitli). Yakalanip
                // balanceError isaretlenir; sablon "0" DEGIL "—" basar.
                try {
                    const tonAddress = await ensureTonAddress(active_account, {
                        testnet: Boolean(network.currentNetwork?.testnet),
                    })
                    const client = getTonClient(config.api)
                    const walletAddress = await getJettonWalletAddress({
                        client,
                        owner: tonAddress,
                        master: token.value.address,
                        chainId: token.value.chainId,
                        storage: chrome.storage.local,
                    })
                    balance.value = await getJettonBalance({
                        client,
                        walletAddress,
                        // ONDALIK VARSAYILANI YOK: jettonlar 9 ondalik degildir
                        // (USDT-TON 6). Eksikse getJettonBalance reddeder ve satir
                        // "—" gosterir - yanlis ondalikla gosterilen bir bakiye,
                        // hic gosterilmeyenden cok daha tehlikelidir.
                        decimals: token.value.decimals,
                    })
                    // DOLAR KARSILIGI -- bu kol onu HIC hesaplamiyordu ve "DEGER"
                    // alani, fiyat ve bakiye DOGRU gelmis olsa bile "$0" kaliyordu
                    // (kullanici raporu: 0.051240 USDT / $1.00 -> "$0"). Ayni
                    // fonksiyonun DIGER UC kolu (Solana, native TON, EVM) bu satiri
                    // zaten tasiyordu; eksik olan yalnizca burasiydi.
                    //
                    // `?.` ile okunur: kanonik kayit ADRESTEN kurtarilmis olabilir ve
                    // o yolda `market_data`nin varligi garanti degil (native TON kolu
                    // duz `.market_data.priceUSD` yaziyor -- ayri bir risk, burada
                    // tekrarlanmadi).
                    usdBalance.value = (token.value.market_data?.priceUSD || 0) * balance.value
                    balanceError.value = false
                } catch (e) {
                    balanceError.value = true
                    console.error('Jetton bakiyesi okunamadi:', e.message)
                }
            } else {
                try {
                    const tonAddress = await ensureTonAddress(active_account, {
                        testnet: Boolean(network.currentNetwork?.testnet),
                    })
                    const tonAmount = await getTonBalance(getTonClient(config.api), tonAddress)

                    balance.value = tonAmount
                    usdBalance.value = (token.value.market_data.priceUSD || 0) * tonAmount
                    balanceError.value = false
                } catch (e) {
                    // amount ATANMAZ (Home.vue'daki ayni karar): balance.toFixed(6) "0"
                    // gosterirdi, spec bunu YASAKLIYOR. Sablon `balanceError`a bakip "—"
                    // basar. WALLET_LOCKED (kasa kilitliyken ensureTonAddress'in attigi
                    // hata) da bu yoldan gecer — ozel bir dal GEREKMIYOR, ayni catch yeter.
                    console.warn('TON bakiyesi okunamadi:', e.message)
                    balanceError.value = true
                }
            }
        } else {
            try {
                // `rpc` zaten rpcForChain(token.value.chainId); chainId AYNI kaynaktan.
                balance.value = await useTokenBalance(active_account.address, token.value.address, rpc, token.value.chainId)
                usdBalance.value = (token.value.market_data.priceUSD || 0) * balance.value
                balanceError.value = false
            } catch (e) {
                // amount ATANMAZ (TON kollariyla ayni desen): spec "bakiye hata
                // durumunda asla 0 gostermez"; sablon balanceError'a bakip "—" basar.
                console.warn('Bakiye okunamadi:', e.message)
                balanceError.value = true
            }
        }

    } catch (e) {
        console.error("Token data fetch error:", e)
    } finally {
        // `finally`: try icindeki ERKEN DONUSLER (status !== 200, Solana dali) de
        // buradan gecer -- yoksa o yollarda ekran sonsuza kadar "yukleniyor" kalirdi.
        loaded.value = true
    }
})

// Kaydin zinciri aktif zincirden farkliysa GITMEDEN ONCE ag degisir.
//
// Send.vue / Swap.vue / Bridge.vue bakiyeyi ve provider'i `network.rpc`'den okuyor:
// yabanci zincirin adresiyle o ekranlara girmek islemi YANLIS AGDA hazirlar.
// SelectAssets.vue ayni korumayi zaten yapiyordu; bu yol ONU ATLIYORDU.
//
// `applyNetworkChange` swap/bridge secimlerini SIFIRLIYOR — bu yuzden ag degisimi
// ONCE, kayit yazimi SONRA. `false` donerse RPC'ye ulasilamadi demektir ve akis
// SURDURULMEZ (uyari kullaniciya zaten gosterildi).
//
// KIMLIK KARSILASTIRMASI isSameChainId ILE (tokenChainRecord ile BIREBIR ayni
// olcut): `Number()` iki Solana degerini de NaN yapiyordu, `NaN === NaN` false
// oldugu icin "zincir farkli" saniliyor, ardindan arama hicbir kayitla
// eslesmedigi icin `false` donup akisi DURDURUYORDU. Yani Solana'da Gonder
// dugmesi Solana secili olsa BILE calismiyordu.
const ensureChain = async (asset) => {
    const target = asset?.chainId
    if (chainIdMissing(target) || isSameChainId(target, network.currentNetwork?.chainId)) return true

    const chain = ALL_CHAINS.find(c => isSameChainId(c.chainId, target))
    if (!chain) return false

    return await applyNetworkChange(chain, t)
}

// GECIS ARGUMANI `displayToken` -- ham `token.value` DEGIL (kapinin ucuncu
// kaynagiyla AYNI karar, bkz. tokenChainRecord).
//
// Kapi artik kanonik kayit cozulemediginde SATIRIN zincirini okuyor. Gecis eskisi
// gibi `token.value`ye baksaydi kayit null oldugunda ensureChain HICBIR gecis
// yapmaz ve kapi ile eylem AYRI zincirleri gorurdu -- iki YENI ariza dogardi:
//   - Solana aktifken bir EVM satiri (kayit cozulemedi): kapi acilir, Takas ekrani
//     SOLANA aginda acilirdi.
//   - Ethereum aktifken bir TON satiri (kayit cozulemedi): TON takasi (STON.fi)
//     dugmesi acilir ama ekran ETHEREUM'da acilirdi.
// `displayToken` kanonik kayit varken ZATEN `token.value`dir (bkz. tanimi), yani
// kayit cozulen -- ve testlerle kilitli -- yolda tek satir davranis degismez.
//
// `inToken` BILEREK `token.value` KALDI: kanonik kayit yokken Takas'a satirdan
// uretilmis bir kayit yazmak bu turun konusu DEGIL (Token.ssr.test.js "EVM de
// kayit yuklenemezse swap.inToken HALA null" bunu acikca kilitliyor); burada
// duzeltilen tek sey HANGI AGDA acildigi.
// KIMLIK SATIRDAN, PIYASA VERISI KANONIK KAYITTAN -- `pickedRef` notundaki
// ilkenin TEK uygulamasi. Iki ekran (Takas ve Gonder) ayni kaynaktan beslenir;
// iki kopya ayrisirsa biri sessizce eksik kayit devreder.
//
// CANLI OLCUM (2026-09-15): POST /getTokenDataById {id:'the-open-network'} ->
// `decimals` ALANI YOK, `symbol: "ton"`. AYIRT EDICI KONTROL ayni uctan ayni
// turda: {id:'tether'} -> `decimals: 6` VAR; yani alan ucun semasinda mevcut,
// bu KAYITTA yok.
//
// Bu iki eksik NATIVE varlikta kapanmiyor: ondaligi zincirden okuyan ERC-20 dali
// `address !== '0x0'` sartli, TON kolu ise yalnizca bakiye okuyor. Sonuc iki
// ariza, tek kok:
//   - Takas: `message.inDecimals` undefined -> background `tonSwapAssets`
//     JETTON_DECIMALS_MISSING atar -> "Teklif alinamadi" (kullanicinin konsolunda
//     birebir bu hata goruldu).
//   - Ekran: cuzdanin her yerde kullandigi "GRAM" yerine CoinGecko'nun "TON"u.
//
// ONDALIK VE SEMBOL TAHMIN EDILMEZ: satir tasimiyorsa alan HIC YAZILMAZ
// (Home.vue selectToken ve rowTokenRecord ile ayni karar). 18'e dusmek 9
// ondalikli bir varligi 10^9 kat yanlis bir miktara cevirirdi.
//
// `picked` YOKSA kayit OLDUGU GIBI doner ve bu bir ESITLIKTIR, kestirme degil:
// `displayToken` ancak `token.value` null iken satirdan kayit uretir, onu ureten
// de `pickedRef()`tir -- yani picked null iken `displayToken` zaten `token.value`.
const satirKimligiyle = (kayit, picked) => {
    if (!kayit || !picked) return kayit
    return {
        ...kayit,
        chainId: picked.chainId,
        ...(Number.isInteger(picked.decimals) ? { decimals: picked.decimals } : {}),
        ...(picked.symbol ? { symbol: picked.symbol } : {}),
    }
}

const selectSwap = async () => {
    if (!await ensureChain(displayToken.value)) return
    // TABAN `token.value` KALIR, `displayToken` DEGIL: kanonik kayit cozulemedigi
    // durumda Takas'a satirdan URETILMIS bir kayit yazmak bu turun konusu degil
    // ve ayrica kilitli (Token.ssr.test.js "kayit yuklenemezse HALA null").
    // Yardimci null'i oldugu gibi gecirir.
    crypto.swap.inToken = satirKimligiyle(token.value, pickedRef())
    popups.token_data = false
    page.currentPage = 'swap'
}

const selectBridge = async () => {
    if (!await ensureChain(displayToken.value)) return
    crypto.bridge.inToken = token.value
    popups.token_data = false
    page.currentPage = 'bridge'    
}

//
// UC AYRI DUZELTME AYNI FONKSIYONDA BULUSUYOR -- ucu de GEREKLI, hicbiri
// otekini kapsamiyor:
//
// (1) KAYNAK kanonik kayit DEGIL `displayToken` (Solana dali, Bulgu 1 -- Kritik).
//     Metadata'si olmayan bir SPL satirinda `id` NULL'dur, `/getTokenDataById`
//     HER ZAMAN duser ve `token.value` null kalir; eskiden bu null oldugu gibi
//     `crypto.sendAsset`e yaziliyor, Send.vue'nun `asset?.address ||
//     SOL_NATIVE_MARKER` ifadesi onu NATIVE SOL'e ceviriyordu -- kullanici SPL
//     satirindan geldigini sanarken SOL imzaliyordu. Kimlik HIC yoksa (ortada
//     satir da yok) akis SURDURULMEZ.
//
// (2) `market` ALANI (Solana dali, Task 16b kod incelemesi). Send.vue USD
//     tahminini `crypto.sendAsset?.market?.priceUSD` uzerinden okur --
//     SelectAssets.vue/Home.vue/bridgeFrom.vue/swapFrom.vue HEPSI ayni
//     sozlesmeye uyar (`token['market'] = token_data.market_data`). Bu ekran ise
//     fiyati HEP `market_data` alaninda tutuyor ve devrederken `.market`e
//     KOPYALAMIYORDU: Home -> Token -> Gonder yoluyla ulasilan HER varlikta
//     (EVM DAHIL, Solana'ya ozgu DEGIL) tahmin daima $0.00 gorunuyordu.
//     `displayToken.market_data` HER ZAMAN TAM SEKILLIDIR (kanonik kayittan ya da
//     rowTokenRecord'un emptyMarketData()'sindan gelir), yani spread yeni bir
//     "eksik alan" riski EKLEMEZ -- yalnizca COZULMUS fiyati DOGRU ada tasir.
//
// (3) SATIRIN kimlik alanlari kanonik kaydin USTUNE yazilir (TON dali, Bulgu 4).
//     Kanonik kayitta `decimals` YOK; TON'un '0x0' adresi yuzunden yukaridaki
//     ERC-20 `decimals()` dali da atlaniyor, yani alan hic dolmuyor ve Send.vue
//     sessizce 18'e dusup toNano'yu (TON 9 ondalik) patlatiyordu.
//
// TON dalinin `Number(picked.chainId)` yazimi BILEREK KALDIRILDI: Solana'nin
// kimligi METINDIR ('solana-mainnet') ve Number() onu NaN yapar; NaN oldugu gibi
// `crypto.sendAsset`e tasinirdi. chainId KENDI TIPINDE gecer (EVM: sayi, TON:
// negatif sayi, Solana: metin) -- onMounted'in kayda yazma bicimiyle de birebir
// ayni. Kimlik karsilastirmalari zaten isSameChainId ile yapiliyor.
//
// Ondalik TAHMIN EDILMEZ: satir tam sayi bir `decimals` tasimiyorsa alan hic
// YAZILMAZ (rowTokenRecord ile ayni karar), boylece Send.vue'nun kendi
// varsayilani devreye girer. `picked` YOKSA (nadir: bayat selected_token_ref,
// id uyusmazligi) kayit OLDUGU GIBI gider.
//
// ensureChain ARTIK gonderilecek varligi ALIR: kanonik kayit cozulemedigi icin
// `token.value` null olsa bile SATIRIN kendi zincirine gecilir. (TON dalindaki
// argumansiz `ensureChain()` cagrisi bu imzada HICBIR ZAMAN ag degistirmezdi.)
const selectSend = async () => {
    const asset = displayToken.value
    if (!asset) return
    if (!await ensureChain(asset)) return

    const picked = pickedRef()
    // `picked` YOKSA dalin `token.value` yazmasi bir ESITLIKTIR, kestirme degil:
    // `displayToken` ancak `token.value` null iken satirdan kayit uretir ve o kaydi
    // ureten sey de `pickedRef()`tir -- yani picked null iken `asset` zaten
    // `token.value`dir (ikisi de null olsaydi fonksiyon yukarida DONERDI).
    // SEMBOL DE TASINIR (2026-09-15): eskiden yalniz chainId + decimals geciyordu
    // ve Gonder ekrani TON'da "GRAM" yerine "TON" yaziyordu -- Takas'takiyle AYNI
    // kok. Karar artik tek yerde (`satirKimligiyle`), iki ekran ayrisamiyor.
    const withRowIdentity = satirKimligiyle(asset, picked)

    // `market` ATAMA DISINDA, yani HER IKI dal icin: picked olmayan yolda da
    // Send.vue'nun USD tahmini calismali (bkz. yukaridaki (2) numarali gerekce).
    crypto.sendAsset = { ...withRowIdentity, market: asset.market_data }
    popups.token_data = false
    page.currentPage = 'send'
}

const selectReceive = () => {
    popups.token_data = false
    crypto.onramp_token = token
    page.currentPage = 'buy_token'
}
</script>