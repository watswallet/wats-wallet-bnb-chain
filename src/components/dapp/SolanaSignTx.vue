<template>
    <!-- GERCEK origin EN BASKIN eleman (K5, kabuktaki buyuk h2). Wallet
         Standard'da manifest YOKTUR, yani sayfanin verdigi ad TAMAMEN
         saldirgan kontrolundedir ve baskin oge OLAMAZ -- kabugun iddia
         pilinde, `claimedLabel` cevirisiyle (SolanaConnectApprove.vue'deki
         AYNI kalip) ikincil ve soluk gosterilir. -->
    <ApprovalShell
        chain="solana"
        :title="$t('dapps.solana.signTxTitle')"
        :origin="hostname"
        :claimed-name="iddiaEdilenAd ? $t('dapps.solana.claimedLabel', { name: iddiaEdilenAd }) : ''"
    >
        <template #header-extra>
            <!-- DURUSTLUK KURALI (obligation 4/K5): "yayinlanacak" YALNIZCA
                 mode==='signAndSend' iken cizilir -- sign/signAll'da yayini
                 dapp yapar, aksini soylemek daha guclu bir iddiadir. -->
            <div v-if="yayinlanacak" class="flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-full bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/50 transition-colors duration-300">
                <span class="text-[10px] font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider">{{ $t('dapps.solana.broadcastBadge') }}</span>
            </div>
            <div v-if="durableNonce" class="flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 transition-colors duration-300">
                <span class="text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">{{ $t('dapps.solana.durableNonceBadge') }}</span>
            </div>
        </template>

        <div v-if="kirmiziBayrakVar" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed">{{ $t('dapps.solana.redFlagTitle') }}</p>
        </div>

        <!-- C1 fix (task-31 review): decode+bakiye HENUZ bitmemisken (bkz.
             script'teki cozumlemeBitti) kart alani ve maliyet paneli HIC
             cizilmez -- aksi halde bu pencerede dugme etkindi ve ekran
             "0.000000000 SOL" gibi UYDURULMUS bir sifir maliyet gosteriyordu. -->
        <div v-if="requestData && !cozumlemeBitti" class="flex flex-col items-center gap-2 text-slate-400 dark:text-zinc-500">
            <p class="text-xs">{{ $t('dapps.solana.resolving') }}</p>
        </div>

        <template v-if="cozumlemeBitti">
        <!-- "Tahmini bakiye degisimi" kahraman karti (Gorev 10). Kaynak UCUNCU TARAF
             simulasyonudur: yalniz GOSTERIM, imza KARARINI baglamaz (Constraint 16).
             Tek islemde o islemin ozeti; signAll'da yalniz TUM islemlerin sonucu varsa
             ustte TOPLAM (her kart kendi ozetini kendi icinde tasir). Sonuc yoksa
             uydurma rakam yerine durustce "hesaplanamadi" denir; "degisiklik yok"
             metni YALNIZ hasUnknown ve hasRedFlag ikisi de yokken yazilir. -->
        <div v-if="kahraman && !cozumlemeHatasi" id="solana-sim-summary" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-1.5">
            <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.balanceChangeTitle') }}</span>
            <!-- KAPSAM (S10-T10-SEC-1c): bu kart yalniz cuzdan adresinin KENDI SOL/token bakiyesini
                 tahmin eder; stake, nonce, tohumdan turetilmis hesaplar ve NFT'ler DAHIL DEGIL.
                 Sonuc durumundan bagimsiz, sabit gorunur. -->
            <p class="text-[10px] text-slate-500 dark:text-zinc-400 leading-relaxed">{{ $t('dapps.solana.balanceScopeNote') }}</p>
            <template v-if="kahraman.durum === 'ok'">
                <!-- :key grup ile birlesik (SU-7): coklu modda ayni varlik hem giden hem gelen grupta olabilir. -->
                <template v-for="(s, i) in kahraman.satirlar" :key="s.grup + ':' + s.key">
                    <!-- Coklu modda (signAll) NETLEME YOK: giden ve gelen ayri gruplarda (S10-T10-SEC-2). -->
                    <span v-if="coklu && (i === 0 || kahraman.satirlar[i - 1].grup !== s.grup)" class="text-[10px] text-slate-500 dark:text-zinc-400 font-bold uppercase tracking-wider pt-1">{{ s.grup === 'giden' ? $t('dapps.solana.balanceOutgoingTotal') : $t('dapps.solana.balanceIncomingTotal') }}</span>
                    <div class="flex justify-between items-center gap-2">
                        <span class="text-base font-bold tabular-nums min-w-0 break-all" :class="s.negatif ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'">{{ s.metin }}</span>
                        <span v-if="s.dogrulanmamis" class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.unverifiedToken') }}</span>
                    </div>
                </template>
                <p v-if="kahraman.degisimYok" class="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">{{ $t('dapps.solana.balanceNoChange') }}</p>
                <p v-if="kahraman.tokenEksik" class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.balanceTokensUnreadable') }}</p>
                <p v-if="kahraman.izinNotu" class="text-[10px] text-slate-500 dark:text-zinc-400 leading-relaxed">{{ $t('dapps.solana.balanceNoPermissionNote') }}</p>
                <p v-if="coklu" class="text-[10px] text-slate-500 dark:text-zinc-400 leading-relaxed">{{ $t('dapps.solana.simSeparateNote') }}</p>
                <p v-if="coklu" class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.simIndependentNote') }}</p>
            </template>
            <p v-else-if="kahraman.durum === 'bekliyor'" class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('dapps.solana.balanceSimulating') }}</p>
            <p v-else-if="kahraman.durum === 'programHatasi'" class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.simFailedWarning') }}</p>
            <p v-else class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.balanceUnavailable') }}</p>
        </div>

        <!-- "Talimatlardan okunan" ozet: YALNIZ talimat alanlarindan okunan,
             kullanicidan CIKAN tutarlar. Simulasyon basarili olsa da bos degilse GORUNUR
             KALIR (S10-T10-SEC-1b): simulasyon yalniz cuzdan adresinin kendi bakiyesini gorur,
             yetkisi altindaki baska hesaplardan (tohum/nonce/stake) cikan para yalniz burada yazar. -->
        <div v-if="statikOzet.length > 0" id="solana-sign-tx-static-summary" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-1.5">
            <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.balanceChangeStatic') }}</span>
            <div v-for="o in statikOzet" :key="o.key" class="flex justify-between items-center gap-2">
                <span class="text-base font-bold tabular-nums min-w-0 break-all text-red-600 dark:text-red-400">-{{ o.tutar }} {{ o.etiket }}</span>
                <span v-if="o.dogrulanmamis" class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.unverifiedToken') }}</span>
            </div>
        </div>

        <div class="flex flex-col gap-2.5">
            <SolanaTxCard v-for="(kart, i) in kartlar" :key="kart.index" :kart="kart" :kullanici="kullaniciAdresi" :sim-ozet="coklu ? kartOzetleri[i] : null" />
        </div>

        <!-- Sabit uyarilar: cozemedigimiz program VAR ya da islem kalici gecerli
             olabilir. Simulasyon sonucundan BAGIMSIZ, her zaman gorunur. -->
        <div v-if="bilinmeyenVar" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
            <!-- Neden-yansiz metin (final SU-8): "program taninmiyor" YALNIZ gercek bilinmeyen
                 program / cozulemeyen talimat satiri varken; alici/sahip/mint okunamadi, RPC hatasi,
                 ALT gibi diger nedenlerde genel "bazi kisimlar kontrol edilemedi". -->
            <p v-if="bilinmeyenProgramSatiriVar" class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.unknownProgramWarning') }}</p>
            <p v-else class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.unreadablePartsWarning') }}</p>
        </div>
        <div v-if="durableNonceVar" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
            <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.durableNonceWarning') }}</p>
        </div>
        <!-- Oncelik ucreti ust siniri ESIK ustunde (txThresholds.js): amber uyari.
             Ikinci esikte ayrica kor-imza kutusu zorunludur (onayKilitli). Kosul
             talimatlardan gelir, simulasyon sonucundan BAGIMSIZDIR. -->
        <div v-if="oncelikUyari" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
            <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.priorityFeeHighWarning') }}</p>
        </div>

        <!-- C3.1: kartKur cozumleme hatasi VERDIYSE (cozumlemeHatasi) bu
             panel HIC cizilmez -- kartlar.value bos/eksik kaldigi icin
             asagidaki taban ucret/kira hesaplari UYDURULMUS bir
             "0.000000000 SOL" gosterirdi. -->
        <div v-if="!cozumlemeHatasi" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-1.5">
            <div class="flex justify-between items-start gap-2">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.totalFeeLabel') }}</span>
                <div class="text-right">
                    <!-- Simulasyonun `fee`si (ya da getFeeForMessage) TUM islemler icin
                         varsa KESIN toplam; aksi halde yalniz TABAN ucret bilinir ve
                         "en az" etiketiyle yazilir. -->
                    <span v-if="ucretKesin" class="text-sm font-bold tabular-nums">{{ toplamUcretSol }} SOL</span>
                    <span v-else class="text-sm font-bold tabular-nums">{{ $t('dapps.solana.feeAtLeast') }} {{ toplamUcretSol }} SOL</span>
                    <!-- Fiyat BILINMIYORSA satir HIC cizilmez (sifirli dolar tutari yazmak "bedava" demek olurdu). -->
                    <span v-if="ucretUsdMetni" class="block text-[11px] text-slate-500 dark:text-zinc-500 tabular-nums">≈ {{ ucretUsdMetni }}</span>
                </div>
            </div>
            <div v-if="ucretiOdeyen" class="flex justify-between items-start gap-2">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.feePaidBy') }}</span>
                <div id="solana-fee-payer" class="text-right text-sm">
                    <span v-if="ucretiOdeyen.kullanici">{{ $t('dapps.solana.youLabel') }}</span>
                    <template v-else>
                        <span>{{ $t('dapps.solana.feePayerOther') }}</span>
                        <span v-if="ucretiOdeyen.adres" class="block font-mono text-[10px] text-slate-400 dark:text-zinc-500">{{ kisa(ucretiOdeyen.adres) }}</span>
                    </template>
                </div>
            </div>
            <!-- I2 fix (task-31 review): oncelik ucreti talimati VAR ama okunamadiysa
                 bu "yok" gibi gosterilmez. Okunabilen oncelik ucretinin ham
                 mikro-lamport satiri ana kartta YOK (kullanici icin anlamsiz): yerine
                 GERCEK ust sinir ("en fazla") yazilir, ham degerler feeDetails'tedir. -->
            <div v-if="oncelikUcretiOkunamadi" class="flex justify-between items-center gap-2">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.priorityFeeLabel') }}</span>
                <span class="text-sm tabular-nums">{{ $t('dapps.solana.rentUnknown') }}</span>
            </div>
            <div v-if="oncelikUstSinirSol" class="flex justify-between items-center gap-2">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.priorityFeeLabel') }}</span>
                <span class="text-sm tabular-nums">{{ $t('dapps.solana.feeMaxLabel') }} {{ oncelikUstSinirSol }} SOL</span>
            </div>
            <!-- §5.2'nin ucuncu maliyet kalemi: OLUSTURULAN hesaplarin
                 kirasi (yalniz kira TABANI; fazlasi satirda "fon aktarimi").
                 Okunamadiysa rakam UYDURULMAZ (K5). -->
            <div class="flex justify-between items-center gap-2">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.rentLabel') }}</span>
                <span class="text-sm tabular-nums">{{ kiraCozulemedi ? $t('dapps.solana.rentUnknown') : kiraSol + ' SOL' }}</span>
            </div>
            <!-- ComputeBudget ham degerleri TEK acilirda (yalniz ilgili talimat VARSA). -->
            <details v-if="butceAyrintilari.length > 0" class="pt-1">
                <summary class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 cursor-pointer">{{ $t('dapps.solana.feeDetails') }}</summary>
                <div v-for="b in butceAyrintilari" :key="b.index" class="flex flex-col gap-0.5 pt-1.5">
                    <span v-if="coklu" class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t('dapps.solana.txLabel', { n: b.index + 1 }) }}</span>
                    <div v-if="b.limit !== null" class="flex justify-between items-center gap-2">
                        <span class="text-[10px] text-slate-500 dark:text-zinc-400">{{ $t('dapps.solana.feeCuLimit') }}</span>
                        <span class="text-[10px] tabular-nums text-slate-600 dark:text-zinc-300">{{ b.limit }}</span>
                    </div>
                    <div v-if="b.fiyat !== null" class="flex justify-between items-center gap-2">
                        <span class="text-[10px] text-slate-500 dark:text-zinc-400">{{ $t('dapps.solana.feeCuPrice') }}</span>
                        <span class="text-[10px] tabular-nums text-slate-600 dark:text-zinc-300">{{ b.fiyat }}</span>
                    </div>
                </div>
            </details>
            <!-- Ucret, kira ve bakiye farki TAHMINDIR: her zaman gorunur. -->
            <p class="text-[10px] text-slate-400 dark:text-zinc-500 leading-relaxed">{{ $t('dapps.solana.balanceEstimateNote') }}</p>
        </div>
        </template>

        <!-- §5.2'nin dorduncu kalemi: bakiye (kullanicinin odeyecegi) taban ucret
             + kirayi karsilamiyorsa KIRMIZI uyari. Uyari BILGILENDIRIR, istegi
             REDDETMEZ -- yayini yapacak olan da (bu turda) dapp'tir. -->
        <div v-if="bakiyeYetersiz" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed">{{ $t('dapps.solana.insufficientSol') }}</p>
        </div>

        <!-- ALT cozumlemesi basarisiz olduysa istek REDDEDILMEZ; yalnizca
             durustce soylenir (§5.2) ve kor-imza kutusu zorunlu olur. -->
        <div v-if="altCozulemedi" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
            <p class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.lookupUnresolved') }}</p>
        </div>

        <!-- Kor-imza kutusu: Constraint 23 kilit tablosu. Kutu kirmizi bayrakta
             HER ZAMAN, bilinmeyen/cozulemeyen parcada simulasyon sonucu YOKKEN
             zorunludur. Isaretlemek kullanicinin KENDI kararidir; dugme ve
             onayla() AYNI `onayKilitli` degerini okur. -->
        <label v-if="cozumlemeBitti && !cozumlemeHatasi && kutuGerekli" class="flex items-start gap-2.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 cursor-pointer">
            <input id="solana-sign-tx-blind-ack" type="checkbox" v-model="korImzaOnayi" :disabled="loading || gonderildi" class="mt-0.5 shrink-0">
            <!-- Onay cumlesi KUTUYU gerektiren NEDENE gore (final E-e): kor-imza nedeni -> blindAck,
                 yuksek oncelik ucreti -> priorityFeeAck, ikisi birden -> iki cumle, TEK kutu. -->
            <span class="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                <template v-if="korImzaNedeniVar">{{ $t('dapps.solana.blindAck') }}</template>
                <template v-if="korImzaNedeniVar && oncelikKutu">{{ ' ' }}</template>
                <template v-if="oncelikKutu">{{ $t('dapps.solana.priorityFeeAck') }}</template>
            </span>
        </label>

        <div v-if="hata" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed">{{ hata }}</p>
        </div>

        <template #footer>
            <button @click="reddet" :disabled="loading" class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 cursor-pointer">
                {{ $t('dapps.solana.btn_reject') }}
            </button>
            <!-- KOD INCELEMESI (obligation 1, Gorev 14'un SolanaConnectApprove'da
                 bulunan bulgusu buraya da uygulanir): dugme yalniz `loading`e
                 bagli olsaydi sablon, onMounted'in TEK await'i cozulmeden ONCE
                 zaten cizilmis olacagindan GORSEL olarak etkin gorunurdu; tiklama
                 onayla()'nin kendi kilidine SESSIZCE carpar ve kullaniciya HICBIR
                 geri bildirim gitmezdi. `onayKilitli` (istek yok / cozumleme
                 bitmedi / cozumleme hatasi / kor-imza kutusu isaretsiz) dugmeyi,
                 gonderecegi seyi GERCEKTEN bilene kadar devre disi tutar. -->
            <button
                id="solana-sign-tx-approve"
                @click="onayla"
                :disabled="loading || gonderildi || onayKilitli"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white cursor-pointer disabled:opacity-50"
            >
                {{ loading ? '…' : $t('dapps.solana.btn_sign') }}
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
// bufferGlobal ILK IMPORT: bu bilesen @solana/* grafigine giriyor ve o grafik
// modul degerlendirmesinde serbest `Buffer` global'ini okuyor.
import '../../utils/solana/bufferGlobal.js'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AddressLookupTableAccount } from '@solana/web3.js'
import { pageStore } from '../../store/pageStore'
import { configStore } from '../../store/config'
import { userStore } from '../../store/user'
import { useUsdPrice } from '../../composables/useUsdPrice'
import { useMoney } from '../../composables/useMoney'
import { tokenToUsd } from '../../utils/assetPrice'
import { shortenAddress } from '../../utils/shortenAddress'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { sha256, toHex } from '../../utils/crypto-utils'
import { parseDappTransaction } from '../../utils/solana/parseDappTransaction'
import { gorunurKil } from '../../utils/solana/visibleText.js'
import { decodeInstructions, computeBudgetSummary } from '../../utils/solana/decodeInstructions'
import { loadTokenAccountContext } from '../../utils/solana/tokenAccountContext'
import { buildTxPreview } from '../../utils/solana/txPreview'
import { formatRawAmount } from '../../utils/solana/formatRawAmount'
import { resolveSolanaSendError } from '../../utils/solana/sendErrors'
import { solanaRpc } from '../../utils/solana/client'
import { simulateMany } from '../../utils/solana/simulateTx'
import { normalizeSolanaAddress } from '../../utils/solana/address'
import {
    priorityFeeCeilingLamports, PRIORITY_FEE_BLOCK_LAMPORTS, PRIORITY_FEE_WARN_LAMPORTS,
} from '../../utils/solana/txThresholds'
import { mintDisplaySymbol } from '../../utils/solana/mintDisplay'
import { LAMPORTS_PER_SOL, SOL_DECIMALS, SOLANA_CHAIN_ID } from '../../utils/solana/constants'
import ApprovalShell from './ApprovalShell.vue'
import SolanaTxCard from './SolanaTxCard.vue'

const { t } = useI18n()
const page = pageStore()
const config = configStore()
const user = userStore()
// SOL fiyati YALNIZ ucret satirinin yaklasik dolar karsiligini besler; bilinmiyorsa satir cizilmez.
const solFiyati = useUsdPrice({ tokenBalances: () => user.tokenBalances, apiBase: () => config.api })
const { money } = useMoney()

// Adres arama tablosu (ALT) cozumlemesine tanidigimiz UST SINIR. Yaniti hic
// vermeyen bir sunucu suresiz beklense onay ekrani ACILIR ama HIC dolmaz ve
// dapp'in promise'i beraberinde asili kalir.
const ALT_TIMEOUT_MS = 4000
// Token hesabi baglami (mint/sahip/decimals) icin ayni gerekce: sinir asilirsa
// istek GERCEKTEN iptal edilir (solanaRpc `signal`i fetch'e baglar) ve baglam
// eksik kalir; eksik baglam kilidi ACMAZ, `hasUnknown` olarak yorumlanir.
const TOKEN_BAGLAM_TIMEOUT_MS = 4000
// Simulasyon sonucu icin EKRANIN KENDI bekleme siniri. simulateTx'in ic zaman asimlarindan
// (simulasyon + yedek ucret cagrisi 2x surebilir) BAGIMSIZ calisir: sure dolunca ekran
// "hesaplanamadi" der, gec gelen sonuc paneli yine gunceller (kutuyu kaldirabilir, ekleyemez).
const SIM_WAIT_MS = 6000
const IMZA_UCRETI_LAMPORTS = 5000
// Simulasyon sonucu yok sayilan kart (gecersiz kullanici adresi, girdi kurulamadi).
const SIM_YOK = Object.freeze({ ok: false, reason: 'unusable' })
// SPL token hesabinin sabit boyutu -- ATA kirasi bu boyutla sorulur. send.js'te
// AYNI sayi var ama modul ICINDE, disa acilmamis; ikinci bir sabit ADI acmak
// yerine deger burada tekrarlaniyor (sorgunun tek parametresi).
const ATA_HESAP_BOYUTU = 165
// Satir etiketleri `buildTxPreview` ciktisindan okunur (labelKey on eki).
const F = 'dapps.solana.f.'

const requestData = ref(null)

// Yayini KIM yapacak? `mode` olmadan ekran ile arka plan anlasamaz (§4.5):
// ayni ekran uc semantik islemi tasiyor ve yalnizca signAndSend'de ucret ONAY
// ANINDA odenir.
const yayinlanacak = computed(() => requestData.value?.mode === 'signAndSend')

// Durable nonce'ta blockhash tazeligi kontrolu ATLANIR (§6.5): bu islemin
// gecerlilik suresi normal bir blockhash gibi ~2 dakikada dolmaz.
const durableNonce = computed(() => !!requestData.value?.isDurableNonce)

const account = ref(null)
const loading = ref(false)
// Gorev 39 Minor 6: SEND_TX_SUCCESS'i gonderdikten SONRA current_request'in
// diskten silinmesi resolvePendingRequest icinde ASENKRON yapilir
// (dappFunctions.js: chrome.storage.local.remove('current_request') await'i)
// VE arka plan bu mesaj icin sendResponse HIC cagirmaz (background.js:
// SEND_TX_SUCCESS/SEND_TX_REJECTED `ignoredResponses` dalinda `return`,
// `return true` DEGIL) -- yani onayla()'nin `await
// chrome.runtime.sendMessage({ type: 'SEND_TX_SUCCESS', ... })`'i o silme
// islemini HIC BEKLEMEZ. Ekran, kaydin o an diskten silinmis oldugunu
// VARSAYAMAZ: kisa bir pencerede current_request HALA orada olabilir ve bu
// pencerede ikinci bir onayla() cagrisi signAndSendFromApproval'i TEKRAR
// calistirip TEKRAR yayinlayabilir (cift harcama DEGIL, ed25519
// deterministik, ama gereksiz bir ikinci ag cagrisi + ikinci bir
// SEND_TX_SUCCESS). `loading` YALNIZCA istek surerken korur, tamamlaninca
// sifirlanir (retry'ye izin vermek icin BILEREK boyle -- bkz. asagidaki hata
// dali). `gonderildi` ise BIR KEZ basariyla gonderildikten sonra HIC
// sifirlanmaz: ikinci bir onayla() cagrisi (ikinci tiklama ya da programatik
// cagri) buradan YENI bir SOLANA_DAPP_SIGN_TX gonderemez.
const gonderildi = ref(false)
const hata = ref('')
const kartlar = ref([])
// C1 fix (task-31 review): onMounted'in kartKur/getBalance await'leri surerken
// (ALT cozumlemesi ALT_TIMEOUT_MS=4000'e kadar surebilir) requestData ZATEN
// dolu ve onay dugmesi ONCEDEN SADECE ona bagliydi -- bu, hicbir kart
// cozulmemisken ve maliyet paneli UYDURULMUS bir "0.000000000 SOL"
// gosterirken etkin bir onay dugmesi sunuyordu. `cozumlemeBitti` bu pencereyi
// kapatir.
const cozumlemeBitti = ref(false)
// C3.1 (nihai inceleme, Task 31'in ERTELEDIGI ikinci kapi): kartKur bir
// istisna FIRLATIRSA (orn. parseDappTransaction TX_DESERIALIZE_FAILED) yukaridaki
// try/finally onu YUTUP `cozumlemeBitti`i yine true yapardi -- kartlar.value
// ATANMADAN once dongu kirilir, ekran SIFIR kartla "cozumleme bitti" sanir ve
// maliyet paneli UYDURULMUS "0.000000000 SOL" gosterirken onay dugmesi
// ETKIN kalirdi. Bu bayrak o pencereyi kapatir: hem dugmeyi kilitler hem
// maliyet ozetini gizler.
const cozumlemeHatasi = ref(false)
const altCozulemedi = ref(false)
// §5.2'nin kalan maliyet kalemleri. Hepsi FAIL-OPEN: zincirden okunamayan bir
// kalem istegi REDDETMEZ, yalnizca "okunamadi" olarak gosterilir.
const kiraLamports = ref(0)
const kiraCozulemedi = ref(false)
const ataKirasi = ref(null)
const bakiyeLamports = ref(null)

// Kor-imza kutusu (Constraint 23). Isaretlemek kullanicinin KENDI karari;
// simulasyon sonucu imza kararini BAGLAMAZ.
const korImzaOnayi = ref(false)

// SIMULASYON (Gorev 10). `simSonuclari[i]`: i. islemin simulateTx sonucu; yazildiktan sonra
// DEGISMEZ. Gec gelen sonuc paneli gunceller ve hasUnknown kutusunu KALDIRABILIR ama ASLA
// EKLEYEMEZ: kutu kosulu yalniz "sonuc YOK" iken acilir, sonuc gelince kapanir.
const simSonuclari = ref([])
const simBitti = ref(false)
const simZamanAsimi = ref(false)
// Ekran kapanirsa devam eden simulasyon istekleri gercekten iptal edilir.
const simIptal = new AbortController()
onBeforeUnmount(() => simIptal.abort())

// GLOBAL KISIT: sayfa kontrolundeki HER metin (appMeta, cozulen adresler/
// program id'leri) `utils/solana/visibleText.js`'teki PAYLASILAN
// gorunmezlik/homoglif helper'inden (gorunurKil) gecer -- Task 23/31'in SIWS
// `uri` alani icin duzelttigi bicimin AYNISI (C3.2: eskiden bu dosya ve
// SolanaSignMessage.vue AYNI mantigi BAGIMSIZ kopyalar halinde tasiyordu,
// biri guncellenip digeri unutulursa yeni bir sinif TEK ekranda kapanirdi).
// `origin`/hostname burada BILEREK helper'dan GECMEZ: `new URL(...)
// .hostname` zaten IDNA/punycode uygulayarak Kiril/Yunan homoglif harflerini
// gorunumde AYRISTIRICI bir 'xn--' onekine cevirir (dogrulandi -- bkz. task-31
// rapor notlari); helper'i BURAYA da uygulamak sifir-genislik gibi bazi kod
// noktalarini SESSIZCE yutan (yine dogrulandi) URL ayristirmasindan SONRA
// calisacagi icin yanlis bir guven duygusu verirdi, gercek bir koruma EKLEMEZ.
const hostname = computed(() => {
    try { return new URL(requestData.value?.origin || '').hostname } catch (e) { return requestData.value?.origin || '' }
})
const iddiaEdilenAd = computed(() => gorunurKil(String(requestData.value?.appMeta?.name || '').slice(0, 64)))
// programId/adresler base58 -- bu 58 karakterlik alfabede homoglif ya da
// gorunmez bir kod noktasi hicbir zaman OLUSAMAZ (base58Encode.js). Helper yine
// de uygulanir: asiri-isaretleme ZARARSIZDIR, decodeInstructions.js'in DISINDA
// (bozuk/beklenmedik) bir girdi gelirse eksik-isaretlemeye DUSMEMEK icindir.
const kisa = (v) => gorunurKil(shortenAddress(v || '', 4, 4))

// V4-1/V4-3: `user` KAYNAGI. Onay isteginin `from` alani cuzdanin KENDI urettigi
// oturum adresidir (sayfa/dapp verisi degil) ve imza aninda imzalayici anahtara
// kilitlidir (background: derived === approvedFrom). Yedegi hesabin
// `solanaAddress`i. ASLA kullanilmayanlar: `account.address` (EVM 0x adresi),
// fee payer / staticAccountKeys[0] (saldirgan fee payer'i "kullanici" yapar ve
// bayragi susturur). Ikisi de yoksa null -> riskOf FAIL-CLOSED (kirmizi).
function onaylayanAdres() {
    const from = requestData.value?.from
    if (typeof from === 'string' && from !== '') return from
    const yedek = account.value?.solanaAddress
    return typeof yedek === 'string' && yedek !== '' ? yedek : null
}
const kullaniciAdresi = computed(() => onaylayanAdres())

const tumTalimatlar = computed(() => kartlar.value.flatMap((k) => k.talimatlar))
const butce = computed(() => computeBudgetSummary(tumTalimatlar.value))
// Kirmizi bayrak BAGLAMLIDIR (riskOf): sinirsiz/sifirdan farkli Approve,
// SetAuthority, baskasina CloseAccount, kullanicinin kendi hesabina Assign...
// Kaynak: her kartin `buildTxPreview` ciktisi (hesap yeri decodeInstructions).
const kirmiziBayrakVar = computed(() => kartlar.value.some((k) => k.preview?.hasRedFlag === true))
// Cozemedigimiz bir sey var: bilinmeyen program, tanimsiz talimat, cozulemeyen
// alici/mint/sahip, cozulemeyen ALT adresi (Constraint 23).
const bilinmeyenVar = computed(() => kartlar.value.some((k) => k.preview?.hasUnknown === true))
// Uyari METNI secimi icin (kilit DEGIL, final SU-8): satirlarda GERCEK bilinmeyen program ya da
// cozulemeyen talimat var mi. hasUnknown'un diger nedenleri (alici/sahip/mint okunamadi, RPC hatasi,
// ALT) bu degeri true yapmaz; onlar icin genel "kontrol edilemedi" metni gosterilir.
const bilinmeyenProgramSatiriVar = computed(() => kartlar.value.some((k) => (k.preview?.rows ?? [])
    .some((r) => r.kind === 'unknownProgram' || r.kind === 'undecodable')))
const durableNonceVar = computed(() => kartlar.value.some((k) => k.preview?.hasDurableNonce === true))

// SIMULASYON SONUCU (Gorev 10). Bir kartin sonucu YALNIZ ok:true ise "var" sayilir:
// 403/zaman asimi/unusable VE `err != null` (program_error) "sonuc yok"tur.
const simOk = (i) => simSonuclari.value[i]?.ok === true
// KILIT acisindan "sonuc var" = TAM sonuc (dapp-imza-guvenlik-2, Constraint 23(b) yorumu): ok:true VE
// token dizileri okunabildi (tokensUnreadable false) VE owner'siz kayit yok (partial false). Cuzdan
// token degisimini hic/eksik okuyamadiysa bilinmeyen programin SPL token cikisi (en yaygin bosaltma
// sekli) ekranda gorunmez: bu "sonuc yok" sayilir ve hasUnknown varsa kor-imza kutusu ZORUNLU olur.
// Yalniz KILIT icin gecerlidir: hero karti / metin davranisi (simOk, tokenEksik notu) AYNEN kalir.
// Alanlar `=== false` ile sorulur: simulateTx hep boolean verir; alan eksikse (ileride degisirse) kilit kapali kalir.
const simTam = (i) => {
    const r = simSonuclari.value[i]
    return r?.ok === true && r.tokensUnreadable === false && r.partial === false
}
// TUM islemler icin kullanilabilir sonuc var mi (gercek simulasyon; eskiden yer tutucuydu).
const simulasyonSonucuVar = computed(() => kartlar.value.length > 0 && kartlar.value.every((k) => simOk(k.index)))
// TAM sonucu OLMAYAN bilinmeyen/cozulemeyen parca var mi: signAll'da kart bazinda bakilir, yoksa
// zararsiz bir kartin sonucu baska kartin bilinmeyen programini serbest birakirdi.
const bilinmeyenSimsiz = computed(() => kartlar.value.some((k) => k.preview?.hasUnknown === true && !simTam(k.index)))

// ONCELIK UCRETI UST SINIRI (S9-G9-S1): SetComputeUnitPrice statik okunduysa ust sinir HER ZAMAN
// hesaplanir (limit yoksa runtime tavani 1.4M CU, bkz. txThresholds.js). Kart basina hesaplanir ve
// toplanir (her islemin kendi butcesi var). ESIKLER yalniz ucret kullanicidan ciktiginda (ya da
// ucreti odeyen bilinmiyorken) uygulanir; baska adres oderse "en fazla" satiri yine gorunur ama
// kullanicidan dusulmus sayilmaz (bakiyeYetersiz kuraliyla ayni).
const kartButceleri = computed(() => kartlar.value.map((k) => {
    const b = computeBudgetSummary(k.talimatlar)
    return {
        index: k.index,
        limit: b.unitLimit,
        fiyat: b.unitPriceMicroLamports,
        ustSinir: priorityFeeCeilingLamports(b),
        esikUygulanir: k.preview?.feePayerIsUser === true || (k.preview?.feePayer ?? null) === null,
    }
}))
const toplaBigInt = (liste) => liste.reduce((n, v) => n + v, 0n)
const oncelikUstSiniri = computed(() => toplaBigInt(kartButceleri.value.map((b) => b.ustSinir ?? 0n)))
const oncelikUstSinirSol = computed(() => (oncelikUstSiniri.value > 0n ? formatRawAmount(oncelikUstSiniri.value, SOL_DECIMALS) : null))
const oncelikKullaniciUstSiniri = computed(() => toplaBigInt(kartButceleri.value.filter((b) => b.esikUygulanir).map((b) => b.ustSinir ?? 0n)))
const oncelikUyari = computed(() => oncelikKullaniciUstSiniri.value > PRIORITY_FEE_WARN_LAMPORTS)
const oncelikKutu = computed(() => oncelikKullaniciUstSiniri.value > PRIORITY_FEE_BLOCK_LAMPORTS)
// ComputeBudget ham degerleri: yalniz feeDetails acilirinda.
const butceAyrintilari = computed(() => kartButceleri.value.filter((b) => b.limit !== null || b.fiyat !== null))

// KILIT TABLOSU (Constraint 23, tek hesap yeri): (a) kirmizi bayrak -> kutu
// simulasyondan BAGIMSIZ zorunlu; (b) hasUnknown -> kutu YALNIZ simulasyon
// sonucu yokken (kart bazinda); (c) oncelik ucreti ikinci esikte -> kutu, yine
// simulasyondan bagimsiz. Dugmenin `:disabled`i ve onayla() BU degeri okur.
// Kutu METNI icin: kor-imza nedeni (kirmizi bayrak ya da simulasyonsuz bilinmeyen) var mi (final E-e).
// Kilit mantigi DEGISMEZ; yalniz hangi onay cumlesinin yazilacagini secer.
const korImzaNedeniVar = computed(() => kirmiziBayrakVar.value || bilinmeyenSimsiz.value)
const kutuGerekli = computed(() => korImzaNedeniVar.value || oncelikKutu.value)
const onayKilitli = computed(() => !requestData.value
    || !cozumlemeBitti.value
    || cozumlemeHatasi.value
    || (kutuGerekli.value && !korImzaOnayi.value))

// Cuzdan dapp isleminin ComputeBudget'ini DEGISTIRMEZ ve talimat EKLEMEZ
// (§5.2): oyle bir mudahale dapp'in islemini gecersiz kilar. Burada yalnizca
// OKUNAN degerler kullaniliyor.
//
// Ucret: kart basina simulasyonun `fee`si (ya da getFeeForMessage yedegi) varsa o, yoksa
// yalniz TABAN ucret (imzaci x 5000) -- ucret kartinda "en az" etiketiyle. BigInt.
const kartUcretleri = computed(() => kartlar.value.map((k) => {
    const r = simSonuclari.value[k.index]
    const simUcret = r?.ok === true && typeof r.feeLamports === 'bigint' ? r.feeLamports : null
    return { kesin: simUcret !== null, lamports: simUcret ?? BigInt(k.imzaciSayisi * IMZA_UCRETI_LAMPORTS) }
}))
const ucretKesin = computed(() => kartUcretleri.value.length > 0 && kartUcretleri.value.every((u) => u.kesin))
// 9 ondalikli sabit bicim ("0.000005000"): BigInt'ten, Number'a cevrilmeden.
const lamportSol9 = (lamports) => {
    const metin = lamports.toString().padStart(SOL_DECIMALS + 1, '0')
    return `${metin.slice(0, -SOL_DECIMALS)}.${metin.slice(-SOL_DECIMALS)}`
}
const toplamUcretSol = computed(() => lamportSol9(toplaBigInt(kartUcretleri.value.map((u) => u.lamports))))
// Yaklasik dolar karsiligi: fiyat YOKSA null -> satir hic cizilmez.
const ucretUsdMetni = computed(() => money(tokenToUsd(toplamUcretSol.value, solFiyati.price.value)))
// Ucreti KULLANICI odemiyorsa (dapp sponsor/relayer) o kartin ucreti kullanicidan
// dusulmus SAYILMAZ: yalniz ucreti odeyen kullanici olan kartlar bakiye
// hesabina girer (feePayer = ilk imzaci; kullanici `request.from`dur).
const kullaniciUcretiLamports = computed(
    () => kartlar.value.reduce((n, k) => n + (k.preview?.feePayerIsUser ? k.imzaciSayisi * IMZA_UCRETI_LAMPORTS : 0), 0),
)
const kiraSol = computed(() => (kiraLamports.value / LAMPORTS_PER_SOL).toFixed(9))

// --- Simulasyon ozeti (kahraman karti) ---
// Varlik listesi: [{ key, mint (SOL icin null), decimals, delta (BigInt) }]. Satir:
// { key, negatif, metin: '-0.5 SOL', dogrulanmamis, grup }. Tutar BigInt'ten (formatRawAmount);
// bicimlenemeyen satir (bozuk decimals) tum ozeti "yok" yapar, rakam UYDURULMAZ.
function ozetSatiri(key, delta, decimals, etiket, dogrulanmamis, grup) {
    const tutar = formatRawAmount(delta < 0n ? -delta : delta, decimals)
    if (tutar === null) return null
    return { key, negatif: delta < 0n, metin: `${delta < 0n ? '-' : '+'}${tutar} ${etiket}`, dogrulanmamis, grup: grup ?? (delta < 0n ? 'giden' : 'gelen') }
}
function ozetSatirlari(varliklar) {
    const satirlar = []
    for (const v of varliklar) {
        if (v.delta === 0n) continue
        let s
        if (v.mint === null) s = ozetSatiri('SOL', v.delta, SOL_DECIMALS, 'SOL', false)
        else {
            // Etiket YALNIZ istemci kurasyonlu tablosundan (Constraint 27) ve native wSOL'dan, yalniz
            // decimals ayniysa: simulasyonun soyledigi sembol/olcek ekrana SIZMAZ.
            const sembol = mintDisplaySymbol(v.mint, v.decimals)
            s = ozetSatiri(`${v.mint}:${v.decimals}`, v.delta, v.decimals, sembol ?? kisa(v.mint), sembol === null)
        }
        if (s === null) return null
        satirlar.push(s)
    }
    return satirlar
}
// i. kartin simulasyon farki varlik listesi olarak (SOL + token).
function kartVarliklari(r) {
    return [
        { mint: null, decimals: SOL_DECIMALS, delta: r.solDeltaLamports },
        ...(r.tokenDeltas ?? []).map((tk) => ({ mint: tk.mint, decimals: tk.decimals, delta: tk.delta })),
    ]
}
// durum: 'bekliyor' | 'ok' | 'programHatasi' (err != null) | 'yok' (403/zaman asimi/unusable/gecersiz user).
function simDurumu(i) {
    const r = simSonuclari.value[i]
    if (r) return r.ok === true ? 'ok' : (r.reason === 'program_error' ? 'programHatasi' : 'yok')
    return simBitti.value || simZamanAsimi.value ? 'yok' : 'bekliyor'
}
// `izinNotu`: hasUnknown ya da hasRedFlag iken, VEYA fark bos ama kart kullaniciyi etkileyen bir satir/
// statik tutar tasiyorken "simulasyon izin/yetki ve baska hesaplardaki degisimleri gostermez".
// `tokenEksik`: token dizileri yok/owner'siz kayit (V10-2) -> "token degisimleri okunamadi" notu.
// `degisimYok` ("bakiyende degisiklik yok") YALNIZ fark gercekten bos VE yukaridakilerin HICBIRI yokken.
function ozetKur(durum, satirlar, { belirsiz = false, etkili = false, tokenEksik = false } = {}) {
    if (durum !== 'ok') return { durum, satirlar: [], degisimYok: false, izinNotu: false, tokenEksik: false }
    if (satirlar === null) return { durum: 'yok', satirlar: [], degisimYok: false, izinNotu: false, tokenEksik: false }
    const izinNotu = belirsiz || (satirlar.length === 0 && etkili)
    return { durum: 'ok', satirlar, degisimYok: satirlar.length === 0 && !izinNotu && !tokenEksik, izinNotu, tokenEksik }
}
const kartOzetleri = computed(() => kartlar.value.map((k) => {
    const durum = simDurumu(k.index)
    const r = simSonuclari.value[k.index]
    const satirlar = durum === 'ok' ? ozetSatirlari(kartVarliklari(r)) : []
    return ozetKur(durum, satirlar, {
        belirsiz: k.preview?.hasUnknown === true || k.preview?.hasRedFlag === true,
        etkili: kartEtkili(k),
        tokenEksik: durum === 'ok' && (r.tokensUnreadable === true || r.partial === true),
    })
}))
const coklu = computed(() => kartlar.value.length > 1)
// signAll'da dapp, imzali islemlerin HERHANGI bir alt kumesini yayinlayabilir: ustte islemler NETLENMEZ.
// Varlik basina "toplam giden" (negatiflerin toplami) ve "toplam gelen" (pozitiflerin toplami) AYRI
// satirlardadir. Yalniz HEPSININ sonucu varsa gosterilir; biri eksikse eksik bir toplam "tam" gibi
// gosterilmez (o kart kendi icinde "hesaplanamadi" der). Beklerken tek "simulasyon yapiliyor" satiri.
const kahraman = computed(() => {
    if (kartlar.value.length === 0) return null
    if (!coklu.value) return kartOzetleri.value[0]
    const durumlar = kartlar.value.map((k) => simDurumu(k.index))
    if (durumlar.every((d) => d === 'ok')) {
        const giden = new Map()
        const gelen = new Map()
        for (const k of kartlar.value) {
            for (const v of kartVarliklari(simSonuclari.value[k.index])) {
                if (v.delta === 0n) continue
                const hedef = v.delta < 0n ? giden : gelen
                const anahtar = `${v.mint ?? 'SOL'}:${v.decimals}`
                hedef.set(anahtar, { mint: v.mint, decimals: v.decimals, delta: (hedef.get(anahtar)?.delta ?? 0n) + v.delta })
            }
        }
        const satirlar = ozetSatirlari([...giden.values(), ...gelen.values()])
        const ozetler = kartOzetleri.value
        // "Degisim yok" yalniz HER kartin kendi farki bos ve tekli moddaki kosullar saglaniyorsa.
        const ozet = ozetKur('ok', satirlar, { tokenEksik: ozetler.some((o) => o.tokenEksik) })
        if (ozet.durum !== 'ok') return ozet
        ozet.izinNotu = ozetler.some((o) => o.izinNotu)
        ozet.degisimYok = ozetler.every((o) => o.degisimYok)
        return ozet
    }
    return durumlar.some((d) => d === 'bekliyor') ? ozetKur('bekliyor', []) : null
})

// Ucreti kim oduyor: hepsini kullanici -> "Sen"; yalniz tek bir baska adres ->
// "baska hesap" + kisaltilmis adres; karisik/birden cok -> yalniz "baska hesap".
const ucretiOdeyen = computed(() => {
    if (kartlar.value.length === 0) return null
    const odeyenler = kartlar.value.map((k) => k.preview?.feePayer ?? null)
    if (odeyenler.some((a) => a === null)) return null
    if (kartlar.value.every((k) => k.preview?.feePayerIsUser)) return { kullanici: true, adres: null }
    const baskalari = [...new Set(kartlar.value.filter((k) => !k.preview?.feePayerIsUser).map((k) => k.preview.feePayer))]
    const karisik = kartlar.value.some((k) => k.preview?.feePayerIsUser)
    return { kullanici: false, adres: !karisik && baskalari.length === 1 ? baskalari[0] : null }
})

// I2 fix (task-31 review): unitPriceMicroLamports===null AYNI sekilde HEM
// "SetComputeUnitPrice talimati hic yok" HEM "var ama verisi kirpilmis,
// microLamports okunamadi" (readU64LE null doner, decodeInstructions.js)
// durumlarinda gelir. Ikisini AYIRT ETMEDEN "yok" gostermek, "okunamadi"yi
// OLUMLU bir iddiaya cevirir -- K5'in yasakladigi TAM O sinif.
const oncelikUcretiOkunamadi = computed(() => tumTalimatlar.value.some((ix) => ix.type === 'SetComputeUnitPrice')
    && butce.value.unitPriceMicroLamports === null)
// Bakiye OKUNAMADIYSA uyari HIC cikmaz: bir RPC hatasi yuzunden "bakiyen
// yetmiyor" demek, kullaniciya gercek olmayan bir engel gostermek olurdu. Kira
// okunamadiysa toplam EKSIK tahmin edilir -- bu yondeki hata yalnizca uyariyi
// kacirir, ASLA uydurmaz.
const bakiyeYetersiz = computed(() => bakiyeLamports.value !== null
    && bakiyeLamports.value < kullaniciUcretiLamports.value + kiraLamports.value)

// "Talimatlardan okunan" ozet: kullanicidan CIKAN tutarlar, varlik basina
// BigInt toplam. Yalniz ucreti/etkisi kullaniciya ait satirlar (affectsUser) ve
// yalniz tutar+decimals CIKARILABILEN alanlar; cozulemeyen satir hasUnknown'dan
// (kilit) gelir, burada uydurulmaz. Kira dahil DEGIL (ayri kalem); CreateAccount'ta
// yalniz "fon aktarimi" kismi girer; baskasina CloseAccount'ta hesaptaki SOL girer.
const OZET_SATIR_TURLERI = new Set(['systemTransfer', 'transferWithSeed', 'withdrawNonce', 'tokenTransfer', 'burn'])
// Kart listesinden ozet kurar: tum ekran icin ve kart basina (izin/degisimYok kararlari) ayni kod.
function statikOzetKur(kartListesi) {
    const toplam = new Map()
    for (const kart of kartListesi) {
        for (const row of kart.preview?.rows ?? []) {
            if (row.affectsUser !== true) continue
            let alanlar
            // Nonce hesabindan kullanicinin KENDI adresine cekim kullanicidan cikan para degildir.
            if (row.kind === 'withdrawNonce' && row.fields.some((f) => f.labelKey === `${F}to` && f.value === kullaniciAdresi.value)) continue
            if (OZET_SATIR_TURLERI.has(row.kind)) alanlar = row.fields.filter((f) => f.kind === 'amount')
            else if (row.kind === 'createAccount') alanlar = row.fields.filter((f) => f.labelKey === `${F}fundTransfer`)
            // CloseAccount: hedefe giden SOL (yalniz baskasina kapatmada tutar alani vardir; okunamadiysa
            // alan unresolved olup asagida atlanir, ekran "tum SOL gidebilir" der).
            else if (row.kind === 'closeAccount') alanlar = row.fields.filter((f) => f.kind === 'amount')
            else continue
            for (const f of alanlar) {
                if (f.unresolved || f.value == null || !/^[0-9]+$/.test(String(f.value))) continue
                // Varlik anahtari: SOL tutari (mint YOK, sembol SOL) ya da mint adresi + decimals. Mint'i
                // olmayan token tutari (bozuk islem) SOL toplamina KARISTIRILMAZ. Ayni mint'in FARKLI decimals
                // ile gelen tutarlari AYRI satirdir: farkli olcekteki ham birimler toplanip ilk olcekle
                // bicimlenseydi yanlis bir tutar gorunurdu (hero karti ayni anahtari kullanir).
                const solTutari = f.mint == null && f.symbol === 'SOL'
                if (f.mint == null && !solTutari) continue
                const anahtar = solTutari ? 'SOL' : `${f.mint}:${f.decimals}`
                const kayit = toplam.get(anahtar) ?? { ham: 0n, decimals: f.decimals, symbol: f.verified ? f.symbol : null, verified: f.verified === true, mint: f.mint ?? null }
                // wSOL kurasyonlu tabloda yok: gosterim katmaninda ozel durum (mintDisplay.js).
                if (!kayit.verified && f.mint != null) {
                    const ozel = mintDisplaySymbol(f.mint, f.decimals)
                    if (ozel !== null) { kayit.symbol = ozel; kayit.verified = true }
                }
                kayit.ham += BigInt(f.value)
                toplam.set(anahtar, kayit)
            }
        }
    }
    const satirlar = []
    for (const [anahtar, k] of toplam) {
        if (k.ham === 0n) continue
        const tutar = formatRawAmount(k.ham, k.decimals)
        if (tutar === null) continue
        satirlar.push({
            key: anahtar,
            tutar,
            etiket: k.verified && k.symbol ? k.symbol : kisa(k.mint),
            dogrulanmamis: !(k.verified && k.symbol),
        })
    }
    return satirlar
}
const statikOzet = computed(() => statikOzetKur(kartlar.value))
// Kartin kullaniciyi etkileyen bir satiri (affectsUser) ya da okunan statik tutari var mi? Varsa
// simulasyonun BOS farki "degisim yok" anlamina GELMEZ: yetkisi altindaki baska hesaplardan
// (tohumdan turetilmis, nonce, stake) cikan para cuzdan adresinin kendi bakiyesinde gorunmez.
const kartEtkili = (k) => statikOzetKur([k]).length > 0 || (k.preview?.rows ?? []).some((r) => r.affectsUser === true)

/**
 * v0 islemlerinde adreslerin bir kismi ADRES ARAMA TABLOSUNDADIR ve zincirden
 * okunmadan cozulemez. Basarisizlik istegi REDDETMEZ (§5.2): sunucu bir
 * saniyeligine yavasladi diye mesru bir islemi oldurmek yerine ekran "bu
 * adresleri cozemedim" der -- ve bilinmeyen oldugu icin kor-imza kutusu zorunlu
 * olur (Constraint 23).
 */
async function altAdresleri(parsed) {
    if (parsed.version !== 0) return null
    const lookups = parsed.tx.message.addressTableLookups || []
    if (lookups.length === 0) return null

    const keys = lookups.map((l) => l.accountKey.toBase58())
    const zamanAsimi = new Promise((_, reject) => setTimeout(() => reject(new Error('SOLANA_RPC_TIMEOUT')), ALT_TIMEOUT_MS))
    const res = await Promise.race([
        solanaRpc('getMultipleAccounts', [keys, { encoding: 'base64' }]),
        zamanAsimi,
    ])

    // Eksik/uyumsuz yanit (orn. bos dizi) "cozuldu, adres yok" DEGILDIR: tablo
    // sayisiyla birebir uyusmayan yanit cozulmemis sayilir.
    const degerler = res?.value
    if (!Array.isArray(degerler) || degerler.length !== keys.length) throw new Error('ALT_RESPONSE_MISMATCH')

    const writable = []
    const readonly = []
    degerler.forEach((hesap, i) => {
        if (!hesap?.data?.[0]) throw new Error('ALT_NOT_FOUND')
        const table = AddressLookupTableAccount.deserialize(Uint8Array.from(Buffer.from(hesap.data[0], 'base64')))
        for (const idx of lookups[i].writableIndexes) writable.push(table.addresses[idx]?.toBase58() ?? null)
        for (const idx of lookups[i].readonlyIndexes) readonly.push(table.addresses[idx]?.toBase58() ?? null)
    })
    // Tabloda olmayan indeks de cozulemeyen adrestir.
    if (writable.includes(null) || readonly.includes(null)) throw new Error('ALT_INDEX_MISSING')
    return { writable, readonly }
}

// Token hesabi baglami (mint/sahip/decimals): FAIL-OPEN, sinirli sure. Eksik
// kalan baglam kilidi ACMAZ, txPreview'da hasUnknown olarak yorumlanir.
async function tokenBaglami(talimatlar) {
    const iptal = new AbortController()
    const zamanlayici = setTimeout(() => iptal.abort(), TOKEN_BAGLAM_TIMEOUT_MS)
    try {
        return await loadTokenAccountContext({ decoded: talimatlar, signal: iptal.signal })
    } catch (e) {
        return new Map()
    } finally {
        clearTimeout(zamanlayici)
    }
}

async function kartKur(base64, index) {
    const parsed = parseDappTransaction(base64)

    let lookups = null
    let altUnresolved = false
    try {
        lookups = await altAdresleri(parsed)
    } catch (e) {
        // Fail-open: cozumleme yoksa adresler null kalir, istek AYAKTA kalir.
        altCozulemedi.value = true
        altUnresolved = true
    }

    // `user`: baglamli kirmizi bayragin (kira kime, Assign kime) ve onizlemenin
    // (hangi satir kullaniciyi etkiler) referansi. decodeInstructions ve
    // buildTxPreview'a AYNI deger verilir.
    const user = onaylayanAdres()
    const talimatlar = decodeInstructions(parsed, { lookups: lookups || undefined, user })
    for (const ix of talimatlar) {
        // Cozulemeyen talimatta bir ozet UYDURMAK yerine dogrulanabilir bir
        // hash gosterilir. SADECE GOSTERIM icindir; imzada kullanilmaz.
        if (ix.type === null) {
            ix.hash = toHex(await sha256(Uint8Array.from(ix.dataHex.match(/../g)?.map((h) => parseInt(h, 16)) || [])))
        }
    }

    const tokenCtx = await tokenBaglami(talimatlar)
    const preview = buildTxPreview({ decoded: talimatlar, parsed, user, tokenCtx, altUnresolved })

    // §5.2'nin ucuncu maliyet kalemi: OLUSTURULAN hesaplarin kirasi. CreateAccount
    // kirasi onizlemeden gelir (yalniz kira TABANI; fazlasi satirda ayri "fon
    // aktarimi"). Kira alani okunamadiysa (kirpik veri) kalem "okunamadi" olur,
    // SESSIZCE 0 yazilmaz (K5).
    if (preview.rows.some((r) => r.kind === 'createAccount' && r.fields.some((f) => f.labelKey === `${F}rent` && f.value == null))) {
        kiraCozulemedi.value = true
    }
    // ATA kirasi zincirden gelir ve TEK SEFER sorulup onbellege alinir (her kart
    // icin yeniden sormak, uc islemlik bir toplu imzada uc gereksiz RPC
    // demekti). ALT ile AYNI fail-open disiplini: bir RPC hatasi mesru islemi
    // REDDETMEZ, yalnizca kalemi "okunamadi" birakir.
    try {
        let kira = Number(preview.rentLamports)
        for (const ix of talimatlar) {
            if (ix.program === 'ata' && (ix.type === 'Create' || ix.type === 'CreateIdempotent')) {
                // Kira yalniz funder (accounts[0]) KULLANICI ise kullanicinin kirasidir (SU-6): funder baska
                // hesapsa kira kullanicidan cikmaz (bakiye uyarisi yanlis-pozitif vermesin, maliyet atfi
                // bulanmasin). Kullanici bilinmiyorsa (null) muhafazakar: kira kullaniciya sayilir.
                if (user !== null && ix.accounts?.[0] !== user) continue
                if (ataKirasi.value === null) {
                    ataKirasi.value = Number(await solanaRpc('getMinimumBalanceForRentExemption', [ATA_HESAP_BOYUTU]))
                }
                // Bicimsiz bir yanit (dizge/null/NaN) SESSIZCE 0 kira olarak
                // gosterilmemeli; kalem acikca "okunamadi" olur.
                if (!Number.isFinite(ataKirasi.value)) throw new Error('RENT_UNAVAILABLE')
                kira += ataKirasi.value
            }
        }
        kiraLamports.value += kira
    } catch (e) {
        kiraCozulemedi.value = true
    }

    return {
        index,
        talimatlar,
        preview,
        isDurableNonce: parsed.isDurableNonce,
        imzaciSayisi: parsed.requiredSigners.length,
        simGirdisi: simGirdisiKur(base64, parsed, altUnresolved ? null : lookups),
    }
}

/**
 * Simulasyon girdileri: gosterilen ve imzalanacak AYNI sabitlenmis islem baytlarindan
 * (`base64` = current_request.transactions[i]; arka plan imzayi da bu kayittan alir).
 * `base64Tx` o dizenin KENDISI, `messageBase64` ve `accountKeys` ayni ayristirmadan ve imza
 * yolunun kullandigi mesaj baytlariyla (legacy: compileMessage().serialize(), v0: message.serialize())
 * turetilir; `serializeMessage()` kullanilmaz (imza yuvalarini yeniden kurabilir, yan etkili).
 * `accountKeys` base58 DIZE dizisidir (PublicKey[] degil); ALT cozulmusse tam liste
 * (static + yazilabilir + salt-okunur), cozulmediyse yalniz static (simulateTx, yanittaki
 * loadedAddresses ile tamamlamayi dener). Kurulamazsa null: o kart "sonuc yok" olur.
 */
function simGirdisiKur(base64, parsed, lookups) {
    try {
        const legacy = parsed.version === 'legacy'
        const mesaj = legacy ? parsed.tx.compileMessage().serialize() : parsed.tx.message.serialize()
        const statik = legacy ? parsed.tx.compileMessage().accountKeys : parsed.tx.message.staticAccountKeys
        const accountKeys = statik.map((k) => k.toBase58())
        if (lookups) accountKeys.push(...lookups.writable, ...lookups.readonly)
        return { base64Tx: base64, messageBase64: Buffer.from(mesaj).toString('base64'), accountKeys }
    } catch (e) {
        return null
    }
}

// Simulasyon kullanicisi: onaylayan adres GECERLI bir Solana adresi VE kanonik bicimdeyse. Aksi halde
// (bos/bozuk/bosluklu) simulasyon CAGRILMAZ: gecersiz user ile hesaplanan "bos fark" ASLA
// "degisim yok" diye gosterilmemeli.
const simKullanicisi = computed(() => {
    const adres = kullaniciAdresi.value
    return typeof adres === 'string' && normalizeSolanaAddress(adres) === adres ? adres : null
})

// Tum kartlari simule eder (signAll'da her islem AYRI). Hicbir yol firlatmaz. Sonuclar TEK SEFER
// yazilir ve ekran zaman asimina dusmus olsa bile gec gelen sonuc paneli gunceller.
async function simulasyonuCalistir() {
    const liste = kartlar.value
    try {
        if (liste.length === 0) return
        const kullanici = simKullanicisi.value
        if (kullanici === null) {
            simSonuclari.value = liste.map(() => SIM_YOK)
            return
        }
        const sonuclar = await simulateMany(liste.map((k) => k.simGirdisi), { user: kullanici, signal: simIptal.signal })
        simSonuclari.value = liste.map((k, i) => sonuclar?.[i] ?? SIM_YOK)
    } catch (e) {
        simSonuclari.value = liste.map(() => SIM_YOK)
    } finally {
        simBitti.value = true
    }
}

onMounted(async () => {
    const { current_request, active_account, vaults } = await chrome.storage.local.get(['current_request', 'active_account', 'vaults'])
    if (!current_request || current_request.type !== 'SOLANA_SIGN_TX') return

    requestData.value = current_request

    // SOL fiyati ikincil yaklasik dolar satirini besler: BEKLENMEZ (ekranin kurulmasini geciktirmemeli).
    solFiyati.loadNative(SOLANA_CHAIN_ID).catch(() => {})

    // ONAYLANAN HESABA KILIT (TonSendTx.vue'deki AYNI desen): accountKey
    // oturum kurulurken sabitlendi. Aktif hesaba SESSIZCE dusmek, kullanici
    // bagliyken hesap degistirmisse YANLIS cuzdandan imzalatmaya calisirdi --
    // background'un §6.1 kilidi bunu sonradan yakalar, ama arayuzun GONDERDIGI
    // hesap zaten dogru olmali.
    const accounts = flattenVaultAccounts(vaults)
    account.value = accounts.find((a) => a.key === current_request.accountKey) || active_account || null

    // C1 fix (task-31 review): butun kart cozumleme + bakiye okuma isi bu
    // try/finally'e alinir. `finally` ile HER durumda (basarili ya da
    // beklenmedik bir istisna) `cozumlemeBitti` sonunda true olur -- aksi
    // halde bir istisna ekrani SONSUZA dek "yukleniyor" durumunda kilitlerdi.
    try {
        const liste = []
        for (let i = 0; i < current_request.transactions.length; i += 1) {
            // C3.1: kartKur'un cozumleme hatasi (parseDappTransaction firlatirsa)
            // digerlerinden AYRI yakalanir -- disaridaki try/finally bunu
            // yutup dongu KESILMEDEN devam etseydi ya da hic yakalamasaydi,
            // asagidaki `kartlar.value = liste` HIC calismaz, `finally`
            // yine de `cozumlemeBitti`yi true yapar ve ekran sifir kartla
            // "hazir" gorunurdu.
            try {
                liste.push(await kartKur(current_request.transactions[i], i))
            } catch (e) {
                cozumlemeHatasi.value = true
                hata.value = t(resolveSolanaSendError('TX_DESERIALIZE_FAILED'))
                break
            }
        }
        kartlar.value = liste

        // §5.2'nin dorduncu kalemi: SOL bakiyesi. Okunamazsa null KALIR ve
        // uyari hic gorunmez -- fail-open, ALT ile ayni gerekce.
        try {
            const bakiye = await solanaRpc('getBalance', [current_request.from])
            const lamports = Number(bakiye?.value)
            bakiyeLamports.value = Number.isFinite(lamports) ? lamports : null
        } catch (e) {
            bakiyeLamports.value = null
        }
    } finally {
        cozumlemeBitti.value = true
    }

    // SIMULASYON (statik katman ZATEN gorunur ve bagimsizdir): cozumleme hatasi varsa yapilmaz.
    // Ekranin KENDI zamanlayicisi (SIM_WAIT_MS) simulateTx'in ic zaman asimlarindan BAGIMSIZ calisir;
    // sure dolarsa "hesaplanamadi" gorunur ama simulasyon surer ve gec sonuc paneli gunceller.
    if (!cozumlemeHatasi.value) {
        await new Promise((coz) => {
            const zamanlayici = setTimeout(() => { simZamanAsimi.value = true; coz() }, SIM_WAIT_MS)
            simulasyonuCalistir().then(() => { clearTimeout(zamanlayici); coz() })
        })
    }
})

const onayla = async () => {
    // Gorev 39 Minor 6: `gonderildi` basarili bir gonderimden sonra HIC
    // sifirlanmaz (bkz. tanimindaki not) -- `loading` gibi `finally`de geri
    // ACILMAZ, boylece ikinci bir onayla() cagrisi (ikinci tiklama ya da
    // programatik cagri) buradan ASLA gecemez. `onayKilitli` dugmenin
    // `:disabled`i ile AYNI degerdir (S5): kutu isaretsizken dogrudan cagri da
    // iptal olur.
    if (!requestData.value || loading.value || gonderildi.value || onayKilitli.value) return
    loading.value = true
    hata.value = ''
    try {
        const res = await chrome.runtime.sendMessage({
            type: 'SOLANA_DAPP_SIGN_TX',
            // YENI -- UST DUZEYDE: arka planin signAndSend dali bunlari
            // `message.requestId` ve `message?.mode` olarak okuyor (Gorev 39,
            // signAndSendFromApproval'in icerik kilidi -- solanaDappFunctions.js:
            // `!message.requestId || current_request.requestId !== message.requestId`).
            // `.requestId` okunur, `.id` DEGIL --
            // asagidaki `message.message.requestId` (Task 30'un sign/signAll
            // kilidi) ile AYNI alan adi kullanilir; ikisi URETIMDE ayni
            // UUID'den geldigi icin bugun esit ama alan adi TESADUFEN degil
            // BILEREK eslenir.
            requestId: requestData.value.requestId,
            // `mode` ARKA PLANIN yayin dalini secer. Gonderilmezse yayin HIC
            // yapilmaz ve kullanicinin gordugu "yayinlanacak" rozeti yalan olur.
            // Arka plan bu degeri ayrica DISKTEKI kayitla karsilastirir.
            mode: requestData.value.mode,
            // M3 Gorev 31'de kurulan govde AYNEN KALIR -- sign/signAll yolu
            // hala BU alanlardan okuyor.
            message: {
                mode: requestData.value.mode,
                origin: requestData.value.origin,
                chain: requestData.value.chain,
                transactions: requestData.value.transactions,
                account: account.value,
                // §6.1'in birinci kilidi: bu alan eksik gonderilirse arka
                // plandaki karsilastirma sessizce devre disi kalir.
                from: requestData.value.from,
                // Obligation 4 (task-31): Task 30'un icerik baglama kilidi
                // `current_request.requestId` ile bu alani karsilastirir --
                // eksik gonderilirse HER onay SOLANA_DAPP_FROM_MISMATCH ile
                // kapali basarisiz olur.
                requestId: requestData.value.requestId,
            },
        })

        // signAndSend yaniti: `success` alani YOK, dogrudan `result` var.
        // Yanit OLDUGU GIBI iletilir (§3.3): `signature` legacy seridin,
        // `signatureBytes` Wallet Standard seridinin isine yarar; birini
        // burada yeniden kurmak seritlerden birini sessizce kirar. Belirsiz
        // yayinlarda (broadcastStatusUnknown) da AYNI dal kullanilir --
        // `res.result` zaten o alanlari tasir, ayrica IS UYDURULMAZ.
        if (res?.result) {
            await chrome.runtime.sendMessage({
                type: 'SEND_TX_SUCCESS',
                requestId: requestData.value.id,
                status: 'success',
                data: { result: res.result },
            })
            gonderildi.value = true
            page.currentPage = 'home'
        } else if (res?.success) {
            await chrome.runtime.sendMessage({
                type: 'SEND_TX_SUCCESS',
                requestId: requestData.value.id,
                status: 'success',
                data: { result: { signedTransactions: res.signedTransactions } },
            })
            gonderildi.value = true
            page.currentPage = 'home'
        } else {
            // Arka plan ham KOD doner; kullaniciya ASLA ham kod gosterilmez
            // (§3.6). Ceviri TEK yerden, sendErrors.js tablosundan.
            hata.value = t(resolveSolanaSendError(res?.error))
        }
    } catch (e) {
        // Obligation 3 (task-31, Gorev 23 fix turunun AYNI bulgusu): sendMessage'in
        // KENDISI reddedebilir (uzanti baglami gecersiz kilindi, service worker
        // kapandi) -- bu, `res.success === false` dalindan FARKLI bir hattir ve
        // yakalanmazsa dugme Gorev 14'un kilit-yok-geri-bildirim-yok defektini
        // BASKA bir sekilde yeniden uretir. Ham istisna mesaji ASLA ekrana
        // yazilmaz (§3.6); resolveSolanaSendError(null) TABLO'nun jenerik
        // anahtarina duser. Basarisizlikta eve GECILMEZ.
        console.error('[solana-dapp] SOLANA_DAPP_SIGN_TX gonderilemedi:', e?.message)
        hata.value = t(resolveSolanaSendError(null))
    } finally {
        loading.value = false
    }
}

const reddet = async () => {
    if (!requestData.value) return
    try {
        // EVM ekranlarinin (Sign.vue) deseni: red bir HATADIR ve `status: 'error'`
        // ile gonderilir -- TON'un "red de bir yanittir" deseni Wallet Standard'da
        // GECERSIZDIR, orada hata FIRLATILIR ve dapp'in promise'i reject olur.
        await chrome.runtime.sendMessage({
            type: 'SEND_TX_REJECTED',
            requestId: requestData.value.id,
            status: 'error',
            error: { code: 4001, message: 'User rejected the request.' },
        })
        page.currentPage = 'home'
    } catch (e) {
        // Obligation 3 (task-31): onayla()'daki AYNI gerekce -- sendMessage
        // kendisi reddederse kullanici "reddettim" sanip ekrandan ayrilir ama
        // arka plan HABERSIZ kalir. page.currentPage BURADA 'home'a GECMEZ,
        // kullanici hatayi gorup TEKRAR deneyebilsin diye ayni ekranda kalir.
        console.error('[solana-dapp] SEND_TX_REJECTED gonderilemedi:', e?.message)
        hata.value = t(resolveSolanaSendError(null))
    }
}
</script>
