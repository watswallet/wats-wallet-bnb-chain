<template>
    <ApprovalShell
        chain="ton"
        :title="$t('dapps.tonConnect.sendTitle')"
        :origin="hostname"
        :claimed-name="manifestName"
        :claimed-icon="manifestIcon"
    >
        <!-- Ust seviye ozet uyari: EN AZ bir mesaj veri tasiyorsa hemen origin'in
             altinda gorunur -- kullanici kartlari tek tek acmadan once bilir. -->
        <div v-if="veriTasiyanMesajVar" class="flex gap-2 px-1">
            <svg class="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            <p class="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.dataWarningTitle') }}</p>
        </div>

        <!-- IKINCI, BAGIMSIZ OZET. `payload` ve `stateInit` AYRI alanlardir ve
             AYRI gelebilirler: bir mesaj stateInit tasiyip payload TASIMAYABILIR.
             Ekran eskiden yalniz `payload`a bakiyordu, yani stateInit tasiyan
             boyle bir mesaj HICBIR uyari almadan duz bir transfer gibi
             ciziliyordu -- oysa anlami "alici adreste YENI BIR KONTRAT kuruluyor".
             Tek bir birlesik uyariya sikistirilmadi: ikisi FARKLI seyler soyler
             ve hangisinin oldugunu kullanicinin bilmesi gerekir. -->
        <div v-if="kontratKuranMesajVar" class="flex gap-2 px-1">
            <svg class="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>
            <p class="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.stateInitWarningTitle') }}</p>
        </div>

        <!-- TonConnect tek istekte 4'e kadar mesaj tasir (tasarim belgesi). Her
             mesaj KENDI kartinda, AYRI alici/miktar ile cizilir -- tek satirda
             toplamak kullaniciya GERCEKTE neyi onayladigini gostermez. -->
        <div class="flex flex-col gap-2.5">
            <div v-for="(m, i) in messages" :key="i" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2 shadow-sm dark:shadow-none transition-colors duration-300">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.messageLabel', { n: i + 1 }) }}</span>
                    <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 tabular-nums transition-colors duration-300">{{ nanoToTon(m.amountNano) }} GRAM</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('dapps.tonConnect.recipientLabel') }}</span>
                    <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded transition-colors duration-300">{{ shortAddress(m.address) }}</span>
                </div>

                <!-- Cuzdan BOC'u COZEMEZ -- bir ozet UYDURMAK, kullaniciyi gercekte
                     onaylamadigi bir seye ikna etmek olurdu. Ham deger, isteyene,
                     KAPALI baslayan bir disclosure'in arkasinda durur. -->
                <div v-if="m.payload" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5 flex flex-col gap-1.5 transition-colors duration-300">
                    <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.dataWarning') }}</p>
                    <button type="button" class="self-start text-[10px] text-amber-700 dark:text-amber-400 underline decoration-dotted cursor-pointer" @click="toggleRaw(i)">
                        {{ openRaw[i] ? '▾' : '▸' }} {{ $t('dapps.tonConnect.rawPayload') }}
                    </button>
                    <div v-if="openRaw[i]" class="text-[10px] font-mono text-amber-800 dark:text-amber-300 break-all">{{ m.payload }}</div>
                </div>

                <!-- AYRI KUTU, payload'un icine KATILMAZ: stateInit baska bir sey
                     anlatir (kod kurulumu) ve payload OLMADAN da gelebilir. Ikisini
                     tek `v-if`te birlestirmek, payload'siz-stateInit'li mesaji yine
                     gorunmez birakirdi -- duzeltilen kusurun ta kendisi. Ham deger
                     yine KAPALI baslayan bir disclosure'in arkasinda: cuzdan BOC'u
                     COZEMEZ ve bir ozet UYDURMAZ. -->
                <div v-if="m.stateInit" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5 flex flex-col gap-1.5 transition-colors duration-300">
                    <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.stateInitWarning') }}</p>
                    <button type="button" class="self-start text-[10px] text-amber-700 dark:text-amber-400 underline decoration-dotted cursor-pointer" @click="toggleInit(i)">
                        {{ openInit[i] ? '▾' : '▸' }} {{ $t('dapps.tonConnect.rawStateInit') }}
                    </button>
                    <div v-if="openInit[i]" class="text-[10px] font-mono text-amber-800 dark:text-amber-300 break-all">{{ m.stateInit }}</div>
                </div>
            </div>
        </div>

        <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex justify-between items-center shadow-sm dark:shadow-none transition-colors duration-300">
            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('dapps.tonConnect.totalLabel') }}</span>
            <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 tabular-nums transition-colors duration-300">{{ nanoToTon(toplamNano) }} GRAM</span>
        </div>

        <!-- ATS UCRET KARTI - relayer ucreti BSC'deki ATS bakiyesinden tahsil eder,
             kullanici TON gazi ODEMEZ. ConfirmTransaction.vue'nun TON kartiyla AYNI
             kurallar: gosterilen sayi DOGRUDAN imzalanacak alandir (ayri bir hesap
             YOK) ve kart YALNIZ gercek bir teklif varken cizilir -- fiyatsiz bir
             "ucret karti" ne odenecegini soylemeden alarmdan baska bir sey katmaz. -->
        <!-- "TAHMINI AG UCRETI" DEGIL: role yolunda /relay TAM OLARAK bu kadar
             keser (sozlesme ss03) ve hemen asagida "iade edilmez" yaziyor.
             ASAGIDAKI SELF-PAY KARTI ETIKETINI KORUR ve bu bilincli: orada
             gosterilen sey GERCEKTEN bir tahmin (sabit ihtiyat payi,
             TON_FEE_RESERVE, "≈" ile) -- onu da "kesin" yapmak yeni bir yalan
             olurdu.
             `v-if` KARTIN KENDISINDE kalmak ZORUNDA: asagidaki self-pay satiri bunun
             `v-else`i ve zincir kirilirsa ikisi AYNI ANDA cizilir -- tek ekranda hem
             "Kesilen Ucret 2.3 ATS" hem "≈ 0.05 GRAM". -->
        <AtsFeeCard
            v-if="sendWithTonRelay"
            label-key="send.confirmTransaction.tonFeeExact"
            paid-on-bsc-key="send.confirmTransaction.tonFeePaidOnBsc"
            no-refund-key="send.confirmTransaction.tonFeeNoRefund"
            :amount="tonFee.atsMaxFee.value"
            :logo-uri="ATS_LOGO_URI"
        />

        <!-- SELF-PAY SATIRI. Relay kartiyla AYNI ANDA cizilmez (ConfirmTransaction.vue
             Rule 3): iki farkli ucret gostermek kullaniciya hangisini odedigini
             soylemez. Kosul `sendWithTonRelay` -- cipilak "relay acik mi" DEGIL:
             teklif sessizce cozulemezse gonderim self-pay'e duser ve kullanici
             odedigi TON ucretini HICBIR YERDE gormezdi.
             TON'da imzali govde onay aninda yok, canli bir teklif cekilemez; bu yuzden
             ConfirmTransaction.vue'nun duz-TON gonderiminde kullandigi AYNI sabit
             ihtiyat payi gosterilir. -->
        <div v-else class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex justify-between items-center shadow-sm dark:shadow-none transition-colors duration-300">
            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('dapps.tonConnect.estimatedFeeLabel') }}</span>
            <span class="text-sm text-slate-800 dark:text-zinc-200 font-bold tabular-nums transition-colors duration-300">≈ {{ TON_FEE_RESERVE }} GRAM</span>
        </div>

        <!-- UCRET ENGELI KARARI. Ucret satirinin HEMEN ardinda: o satirda neden
             ATS degil de TON yazdigini aciklayan sey bu kart.
             AMBER/KIRMIZI ama ENGEL DEGIL -- ConfirmTransaction.vue'da kullanici
             ATS'yi SECIYOR ve orada `feeBlocked` gonderimi kapatir; BURADA secim
             yok, teklif dusse de self-pay CALISIR. Calisan bir gonderimi kapatmak
             sessiz dususten daha kotu olurdu. Son satir tam da bunu soyler. -->
        <div v-if="feeDecision" class="rounded-xl p-3 flex flex-col gap-1 border transition-colors duration-300 shadow-sm dark:shadow-none"
             :class="feeDecision.severity === 'blocked'
               ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
               : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'">
            <span class="text-xs font-bold text-slate-800 dark:text-zinc-100 transition-colors duration-300">{{ $t(feeDecision.i18nKey, { symbol: 'ATS' }) }}</span>
            <span v-if="feeDecision.i18nDescKey" class="text-[10px] text-slate-600 dark:text-zinc-400 transition-colors duration-300">{{ $t(feeDecision.i18nDescKey) }}</span>
            <button v-if="feeTekrarDenebilir" type="button" @click="feeTekrarDene"
                    class="mt-1 self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 cursor-pointer">
                {{ $t('send.confirmTransaction.atsQuoteRetry') }}
            </button>
            <span class="text-[10px] text-slate-500 dark:text-zinc-500 mt-0.5 transition-colors duration-300">{{ $t('dapps.tonConnect.feeFallbackSelfPay') }}</span>
        </div>

        <!-- HICBIR SEY YAPMAYAN ISLEM. Amber uyarilardan AYRI ve KIRMIZI: onlar
             "dikkat et, sonra onayla" der, bu "onaylayamazsin" der. Ayni renkte
             cizilseydi kullanici dugmenin neden kapali oldugunu aramak zorunda
             kalirdi.
             UCRET SATIRININ ALTINDA, dugmelere BITISIK duruyor: kart ile kapali
             dugme ayni bakista gorunmeli ki sebep ile sonuc birlesip anlasilsin.
             Ucret satiri BILEREK gizlenmiyor -- "~0.01 TON odeyip karsiliginda
             hicbir sey almak" tam olarak anlatilmak istenen sey. -->
        <div v-if="bosMesajVar" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 flex gap-2.5 transition-colors duration-300">
            <svg class="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
            <div class="flex flex-col gap-1 min-w-0">
                <p class="text-xs font-bold text-red-700 dark:text-red-300 transition-colors duration-300">{{ $t('dapps.tonConnect.noopWarningTitle') }}</p>
                <p class="text-[10px] text-red-600 dark:text-red-400 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.noopWarning') }}</p>
            </div>
        </div>

        <!-- YETERSIZ GRAM BAKIYESI. Noop kartiyla AYNI kirmizi: ikisi de
             "onaylayamazsin" der ve ikisi de `onayKapali`yi besler.
             ATS UCRET KARTI BILEREK GIZLENMIYOR: kart "ag ucretini sponsor
             odeyecek" diyor ve bu DOGRU -- eksik olan sey ag ucreti degil,
             GONDERILEN TUTAR. Karti gizlemek, kullanicinin sorunu yanlis yerde
             (ATS bakiyesinde) aramasina yol acardi. -->
        <div v-if="yetersizTonBakiyesi" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 flex gap-2.5 transition-colors duration-300">
            <svg class="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            <div class="flex flex-col gap-1 min-w-0">
                <p class="text-xs font-bold text-red-700 dark:text-red-300 transition-colors duration-300">{{ $t('dapps.tonConnect.insufficientTonTitle') }}</p>
                <p class="text-[10px] text-red-600 dark:text-red-400 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.insufficientTon') }}</p>
            </div>
        </div>

        <!-- background.js (tonSendUserMessage) HER hata kodunu ZATEN bitmis,
             kullaniciya-gosterilecek bir metne cevirip dondurur -- ekran onu
             OLDUGU GIBI gosterir. Ikinci bir kod->metin haritasi TUTULMAZ:
             arka plan hicbir zaman ham kod DONDURMEDIGI icin oyle bir harita
             hep karsiliksiz (unreachable) kalirdi. Yalniz `error` alani BOS/
             eksik gelirse (beklenmeyen bir dal) genel bir yedege duser. -->
        <div v-if="hata" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 transition-colors duration-300">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed transition-colors duration-300">{{ hata }}</p>
        </div>

        <template #footer>
            <button
                @click="reddet"
                :disabled="loading"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer shadow-sm dark:shadow-none"
            >
                {{ $t('dapps.tonConnect.btn_reject') }}
            </button>
            <button
                @click="onayla"
                :disabled="onayKapali"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/20 dark:shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('dapps.tonConnect.btn_approve') }}</span>
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../store/pageStore'
import { configStore } from '../../store/config'
import { shortenAddress } from '../../utils/shortenAddress'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { nanoToTon } from '../../utils/ton/tonFeeAmounts'
import { isNoopMessage, userSpentNano } from '../../utils/ton/tonConnectMessages'
import { TON_FEE_RESERVE } from '../../utils/ton/tonSend'
import { useTonFee } from '../../composables/useTonFee'
import { tonRouterListesi, rawAdres } from '../../utils/ton/tonRouters'
import { tonSendErrorText } from '../../utils/ton/tonSendErrors'
import { ATS_LOGO_URI } from '../../utils/atsConfig'
import { Address, toNano } from '@ton/core'
import { TON_TESTNET_ID } from '../../utils/chainKind'
import { getTonClient } from '../../utils/ton/tonClient'
import { getTonBalance } from '../../utils/ton/tonBalance'
import ApprovalShell from './ApprovalShell.vue'
import AtsFeeCard from '../AtsFeeCard.vue'

const { t } = useI18n()
const page = pageStore()
const config = configStore()

const requestData = ref(null)
const account = ref(null)
const loading = ref(false)
const hata = ref('')
const openRaw = ref({})
// payload ve stateInit AYRI acilir: birini acmak otekini de acsaydi kullanici
// istemedigi bir ham BOC duvarina bakardi.
const openInit = ref({})

const hostname = computed(() => requestData.value?.hostname || '')
const manifestName = computed(() => requestData.value?.manifest?.name || '')
const fallbackIcon = computed(() => 'https://api.dicebear.com/7.x/initials/svg?seed=' + (hostname.value || 'dapp'))
const manifestIcon = computed(() => requestData.value?.manifest?.iconUrl || fallbackIcon.value)

const messages = computed(() => requestData.value?.messages || [])

// Adres kisaltmasi mevcut yardimcidan (utils/shortenAddress.js), 8/6 ile --
// TonConnectApprove.vue'nun kendi kisaltma bicimiyle AYNI genislik.
const shortAddress = (addr) => shortenAddress(addr, 8, 6)

const toggleRaw = (i) => { openRaw.value[i] = !openRaw.value[i] }
const toggleInit = (i) => { openInit.value[i] = !openInit.value[i] }

// TOPLAM BigInt ILE toplanir, Number ILE DEGIL: nanoton degerleri bir double'in
// tam temsil edebildigi araligi asabilir (tasarim belgesindeki, erken bir
// gorevde duzeltilen AYNI sinif hata). Sonuc bir DIZE olarak tutulur, sadece
// GOSTERIM aninda nanoToTon ile TON'a cevrilir -- ikinci bir donusum yazilmaz,
// tonFeeAmounts.js'teki TEK paylasilan donusum kullanilir.
const toplamNano = computed(() =>
    messages.value.reduce((sum, m) => sum + BigInt(m.amountNano), 0n).toString())

// Cuzdan BOC govdesini COZEMEZ -- bir ozet UYDURMAK yerine ACIKCA "veri var" denir.
const veriTasiyanMesajVar = computed(() => messages.value.some((m) => !!m.payload))

// `stateInit` AYRI BIR SORU, payload'un bir alt kumesi DEGIL.
//
// Iki alan tonConnectMessages.js:93-97'de BAGIMSIZ normalize ediliyor ve
// background.js mesaji kurarken ikisini AYRI kullaniyor: payload -> `body`,
// stateInit -> `init`. Yani stateInit tasiyip payload TASIMAYAN mesaj tamamen
// mesru bir sekil -- ve tam da o sekil bu ekranda HICBIR uyari almiyordu:
// duz bir transfer gibi ciziliyordu. stateInit'in anlami ise duz transferin
// tersi: alici adreste YENI BIR KONTRAT kurulur ve o adres kontratin
// kodundan/verisinden TURETILIR, yani "kime gidiyor" sorusunun cevabi kullanici
// icin dogrulanabilir degildir.
const kontratKuranMesajVar = computed(() => messages.value.some((m) => !!m.stateInit))

// HICBIR SEY YAPMAYAN ISLEM -- GONDERIMI ENGELLER, uyarmakla kalmaz.
//
// OLCULDU 2026-09-14 (canli paymaster): 0 nanoton tasiyan, govdesiz bir eylem
// /quote'tan 400 ile doner -- "actions[0] does nothing - amountNano is 0 and
// there is no payloadBoc". Sunucu boyle bir eylemi FIYATLANDIRMIYOR.
//
// Kural ucret yolundan BAGIMSIZ uygulanir: mesaj hedefte hicbir sey yapmiyorsa
// ucreti kimin odedigi (ATS ya da self-pay) sonucu degistirmez -- kullanici
// karsiliginda hicbir sey almadan ag ucreti oder. Bu yuzden kapi burada,
// `relayEligible`in DISINDA.
//
// Yuklem tonConnectMessages.js'ten gelir, burada KOPYALANMAZ: mesaj seklini
// tanimlayan dosya orasidir ve iki kopya zamanla ayrisirdi.
//
// HERHANGI BIRI yeterlidir, HEPSI degil: karisik bir istekte (bir bos + bir
// gercek) bos mesaji gecirmek, kullaniciya onun ucretini de odetmek olurdu --
// ve o istek zaten ATS teklifi ALAMIYOR (sunucu eylem eylem reddediyor).
const bosMesajVar = computed(() => messages.value.some(isNoopMessage))

// --- TON BAKIYESI ------------------------------------------------------------
//
// BU EKRANDA HICBIR BAKIYE KONTROLU YOKTU ve eksikligi role acildiginda tehlikeli
// hale geldi: paymaster ekibinin 2026-09-14 cevabi (docs/backend-istek-2026-09-14c-
// uninit-cuzdan-role.md, bolum 5) `amountNano`nun HICBIR ZAMAN sponsorlanmadigini
// soyluyor -- rolecinin ilistirdigi TON yalniz HEDEF kontratin gazini fonlar.
// Sunucu da kullanicinin TON bakiyesini OKUMUYOR. Yani yetersiz bakiyeli bir
// gonderimde ATS TAHSIL EDILIR, islem zincirde duser ve kullanici karsiliginda
// hicbir sey almaz -- ekibin kendi uyardigi "ucret alindi, teslim edilmedi" sinifi.
//
// `null` = HENUZ OKUNMADI; `0`dan AYRI tutulur (sifir bakiye gercek bir cevaptir).
const tonBakiyesi = ref(null)
const tonBakiyesiOkunamadi = ref(false)

// Bu istegin kullanicinin KENDI bakiyesinden goturecegi toplam (nanoton).
//
// Dallanma `tonFeeActions` ile AYNI kuraldan turemek ZORUNDA (ikisi ayrisirsa
// bakiye BASKA bir govde icin olculur): role modunda yuklu mesajin tutari
// `gasTonNano`ya gider ve roleci fonlar; yuksuz mesajin tutari kullanicidan cikar.
// Self-pay'de dallanma yoktur, gonderen kullanicinin cuzdanidir.
//
// AG UCRETI yalniz self-pay'de eklenir: role modunda onu da roleci odedigi icin
// ekran zaten "≈ 0.01 GRAM" satirini GIZLIYOR. Kontrolun yine de istemesi,
// EKRANIN SOYLEDIGI ile BUTONUN YAPTIGINI ayirirdi.
const gerekenNano = computed(() => {
    const gonderilen = userSpentNano(messages.value, { relay: sendWithTonRelay.value })
    return sendWithTonRelay.value ? gonderilen : gonderilen + toNano(TON_FEE_RESERVE)
})

const yetersizTonBakiyesi = computed(() => {
    // FAIL-CLOSED: okuma dustuyse yettigini BILMIYORUZ (ConfirmTransaction.vue'daki
    // checkTonFeeSufficiency AYNI karari veriyor).
    if (tonBakiyesiOkunamadi.value) return true
    const ton = tonBakiyesi.value
    // Henuz okunmadi -> iddia YOK. Buton bu arada `loading` ile kapali degil, ama
    // okuma onMounted'in ilk islerinden biri ve render'dan once biter.
    if (ton === null) return false
    // toFixed(9) ONEMLI: getTonBalance Number donuyor ve toNano ondan fazla
    // ondalikta FIRLATIR -- nanoton TON'un 1e-9'udur, dokuzuncu hane son hanedir.
    return toNano(ton.toFixed(9)) < gerekenNano.value
})

// Onay dugmesinin TEK kapisi. `onayla()` de AYNI degiskene bakar: gorunum ile
// davranisin ayrisabilecegi bir aralik birakilmaz.
const onayKapali = computed(() => loading.value || bosMesajVar.value || yetersizTonBakiyesi.value)

// --- ATS ile odeme (gasless) -------------------------------------------------
//
// Onizleme ConfirmTransaction.vue ile AYNI composable'dan gelir; bu ekran KENDI
// fiyat hesabini YAPMAZ. Gosterilen sayi dogrudan imzalanacak alandir.
const tonFee = useTonFee()
const tonPublicKey = ref(null)
const evmCapable = ref(false)
// `null` = HENUZ BILINMIYOR, `[]` = liste bos (hicbir yuk serbest degil). Ayrimi
// korumak sart: bilinmeyeni "bos" saymak, liste gelmeden once yuklu bir gonderimi
// UYGUN gostermek olurdu.
const routerListesi = ref(null)

// UYGUNLUK, KART CIZILMEDEN ONCE. Bu ekranda relay/self-pay anahtari YOK - mod
// karardan turuyor. Yani "gonderim aninda anlariz" secenegi yok: kullaniciya
// odeyemeyecegi bir ucret gostermek, donebilecegi hicbir secenegi olmayan bir
// cikmazdir (ConfirmTransaction.vue'daki AYNI gerekce).
//
// Uc kapi:
//   1. `stateInit` -> ASLA. Sunucu reddediyor; var olan her kontratin adresi kendi
//      ilk StateInit'inin hash'i oldugu icin alan rolecinin TON'unu beyaz liste
//      disina akitabilirdi.
//   2. `payload` -> hedef router beyaz listesinde OLMALI (sunucu zorluyor).
//      Liste okunamadiysa (eski sunucu: uc 404) yuklu gonderim UYGUN DEGILDIR.
//   3. EVM kasasi -> ATS BSC'de imzalanir; TON'a kilitli hesapta imzalayacak
//      anahtar yoktur.
const relayEligible = computed(() => {
    // Sunucu bos eylemi fiyatlandirmiyor (400). Teklifi yine de istemek, her
    // acilista basarisiz olacagini BILDIGIMIZ bir cagri yapmak olurdu.
    if (bosMesajVar.value) return false
    if (!evmCapable.value) return false
    const list = messages.value
    if (!list.length) return false
    if (list.some((m) => m.stateInit)) return false
    if (!list.some((m) => m.payload)) return true
    const izinli = routerListesi.value
    if (!izinli) return false
    return list.every((m) => {
        if (!m.payload) return true
        const raw = rawAdres(Address, m.address)
        return !!raw && izinli.has(raw)
    })
})

// GONDERIM MODU = KARTIN GORUNURLUGU. Yalniz "uygun ve bolge acik" yeterli
// olsaydi (teklif dusmus), fiyati hic gorunmemis bir ucreti onaylatmis olurduk.
const sendWithTonRelay = computed(() =>
    relayEligible.value && tonFee.relayActive.value && tonFee.atsMaxFee.value != null)

// Onizlemedeki niyet GONDERIMDEKININ AYNISI olmali - arka plan (tonDappSend)
// eylemleri AYNI kuralla kuruyor. Ayrisirsa teklif baska bir govde icin
// fiyatlanir ve dogrulama kullanicinin fiyatini GORDUGU gonderimde duser.
const tonFeeActions = computed(() => messages.value.map((m) => (m.payload
    ? { kind: 'raw', to: m.address, amountNano: '0', gasTonNano: String(m.amountNano), payloadBoc: m.payload, bounce: true }
    : { kind: 'raw', to: m.address, amountNano: String(m.amountNano), bounce: false })))

// Teklif argumanlari TEK yerde: ilk yukleme ve "tekrar dene" AYNI niyeti
// fiyatlatmali. Ikinci bir kopya yazilsaydi biri gunun birinde otekinden ayrisir
// ve teklif BASKA bir govde icin fiyatlanirdi -- dogrulama (V5/V6) tam da
// kullanicinin fiyati GORDUGU gonderimde duserdi.
//
// `sender` /status ve /quote'un `payer`i, yani EVM adresi. Buraya ancak
// `evmCapable` TRUE iken gelinir ve o yuklem hesabin BSC kasasini cozer -- yani
// bu daldaki `account.address` EVM adresidir. TON'a kilitli bir hesapta
// (address = TON adresi) `relayEligible` zaten false olur.
const tonFeeLoadArgs = () => ({
    sender: account.value?.address,
    tonWallet: requestData.value?.from,
    tonPublicKey: tonPublicKey.value,
    actions: tonFeeActions.value,
})

// ENGEL KARARI -- SESSIZ DUSUSU BITIRIR.
//
// useTonFee /status ya da /quote dustugunde bir `decision` URETIYOR ama bu ekran
// onu HIC cizmiyordu (ConfirmTransaction.vue 7 yerde ciziyor). Sonuc: her
// acilista alinan 400/500 kullaniciya HICBIR SEY soylemeden self-pay'e dusuyordu.
//
// `internal` CIZILMEZ: tonFeeBlocker.js'in kendi tanimi "istemci/akis hatasi;
// kod duzeltir, suclan(m)az". Kullaniciya gosterilecek bir sey degil.
//
// `relayEligible` kapisi niyeti acik tutar: ATS hic masada degilse (EVM kasasi
// yok, stateInit var, bos mesaj) ATS hakkinda alarm vermeyiz. Bugun zaten o
// halde `load()` hic cagrilmadigi icin `decision` null kalir -- kapi ucuz ve
// niyeti kod duzeyinde yazili tutar.
const feeDecision = computed(() => {
    if (!relayEligible.value || tonFee.loading.value) return null
    const d = tonFee.decision.value
    return d && d.severity !== 'internal' ? d : null
})

// Yeniden denemenin ANLAMLI oldugu TEK durumlar bunlar (ConfirmTransaction.vue
// ile AYNI kural). `abort-unsafe` bir GUVENLIK reddidir: ayni yanit yine gelir
// ve dugme kullaniciyi donguye sokar. `reduce-amount`/`buy-ats` de tekrar
// denemekle cozulmez.
const feeTekrarDenebilir = computed(() => !!feeDecision.value
    && (feeDecision.value.action === 'retry-later' || feeDecision.value.action === 'refresh-status'))

const feeTekrarDene = async () => { await tonFee.load(tonFeeLoadArgs()) }

onMounted(async () => {
    const { current_request, active_account, vaults } = await chrome.storage.local.get(['current_request', 'active_account', 'vaults'])
    if (!current_request || current_request.type !== 'TON_SEND_TX') return

    requestData.value = current_request

    // ONAYLANAN HESABA KILIT: current_request.accountKey TonConnect oturumu
    // kurulurken sabitlenmisti (TonConnectApprove.vue -> session.accountKey).
    // Aktif hesaba SESSIZCE dusmek, kullanici bagliyken hesap degistirmisse
    // YANLIS cuzdandan imzalatmaya calisirdi -- background.js'in tonDappSend'i
    // bunu `from` esitligiyle SONRADAN yakalar, ama arayuzun GONDERDIGI hesap
    // zaten dogru olmali. accountKey vaults'ta bulunamazsa (eski istek / test
    // verisi) aktif hesaba dusulur -- background zaten AYNI varsayilani
    // (resolveAccount) uyguluyor, yani bu YENI bir risk ACMAZ.
    const accounts = flattenVaultAccounts(vaults)
    account.value = accounts.find((a) => a.key === current_request.accountKey) || active_account || null

    // BAKIYE, ATS onizlemesinden ONCE ve KENDI hata yolunda: onizleme dusse bile
    // bakiye kapisi calismali (tersi de dogru). Ayni try icine konsaydi, ATS
    // onizlemesindeki bir hata bakiyeyi SESSIZCE okunmamis birakirdi -- ve
    // `yetersizTonBakiyesi` okunmamisligi "iddia yok" sayar, yani kapi acilirdi.
    try {
        tonBakiyesi.value = await getTonBalance(
            getTonClient(config.api),
            current_request.from,
            { testnet: String(current_request.network) === String(TON_TESTNET_ID) },
        )
        tonBakiyesiOkunamadi.value = false
    } catch (e) {
        console.error('[tonconnect] TON bakiyesi okunamadi:', e?.message)
        tonBakiyesiOkunamadi.value = true
    }

    // ATS onizlemesi. Hicbiri gonderimi BLOKLAMAZ: hepsi sessizce basarisiz olursa
    // ekran self-pay satirini gosterir ve islem eskisi gibi calisir.
    try {
        // `account` ACIKCA gonderilir. Gonderilmezse arka plan resolveAccount ile
        // AKTIF hesaba duser -- oysa bu ekran onaylanan hesaba KILITLIDIR
        // (current_request.accountKey). Ayrisirlarsa onizlemenin acik anahtari
        // BASKA bir cuzdanin olur, sunucunun donderdigi feeAuth.tonPublicKey
        // imzalayanla eslesmez ve dogrulama (V6) kullanicinin FIYATI GORDUGU
        // gonderimde "govde dogrulanamadi" ile duser.
        const [kimlik, liste] = await Promise.all([
            chrome.runtime.sendMessage({
                type: 'TON_FEE_IDENTITY',
                message: { chainId: current_request.network, account: account.value },
            }),
            tonRouterListesi(),
        ])
        tonPublicKey.value = kimlik?.success ? kimlik.tonPublicKey : null
        evmCapable.value = kimlik?.success ? kimlik.evmCapable === true : false
        routerListesi.value = liste?.routers ?? null
    } catch (e) {
        console.warn('[tonconnect] ATS onizlemesi kurulamadi:', e?.message)
    }

    // Teklif YALNIZ uygunsa istenir: uygun olmayan bir gonderim icin fiyat
    // cekmek, kullaniciya gosterilmeyecek bir sayi ugruna sunucuyu mesgul etmek
    // ve `atsMaxFee`i doldurup kartin kapisini kazara acmak olurdu.
    if (relayEligible.value) {
        await tonFee.load(tonFeeLoadArgs())
    }
})

onUnmounted(() => { tonFee.stop() })

const onayla = async () => {
    // GORUNUMDEN BAGIMSIZ KAPI: dugme disabled olsa da bu fonksiyon setupState
    // uzerinden ya da ileride baska bir yoldan cagrilabilir. Imzalamayi
    // engelleyen sey butonun gorunumu DEGIL, bu satir olmali.
    if (!requestData.value || onayKapali.value) return
    loading.value = true
    hata.value = ''
    try {
        // BES ALAN da gonderilir (arka planla dogrulanan sozlesme): apiBase
        // eksikse arka plan TON_API_BASE_MISSING ile firlar, `from` eksikse
        // onay ekraninda gosterilen hesapla imzalayanin eslesmesi hic
        // dogrulanamaz.
        const res = await chrome.runtime.sendMessage({
            type: 'TON_DAPP_SEND',
            message: {
                messages: requestData.value.messages,
                validUntil: requestData.value.validUntil,
                apiBase: config.api,
                account: account.value,
                from: requestData.value.from,
                // Alan adi arka planda BILINMIYOR: istek bu onay penceresinden
                // geliyor, gonderen sekmeden degil. Tasimazsak gecmis karti
                // "hangi dapp" sorusunu hic cevaplayamaz.
                dappHost: hostname.value,
                // KULLANICININ GORDUGU TUTAR arka plana gider ve dogrulamanin
                // (V10) girdisi olur: sunucu daha yuksek bir ucret kurarsa gonderim
                // DUSER. `sendWithTonRelay` kartin gorunurluguyle AYNI kosul, yani
                // "fiyati gormeden onaylamis olma" durumu kod duzeyinde imkansiz.
                payWithTonFee: sendWithTonRelay.value,
                approvedAtsFee: sendWithTonRelay.value
                    ? (tonFee.quote.value?.sign?.feeAuth?.atsMaxFee ?? null)
                    : null,
            },
        })

        if (res?.success) {
            // Dapp BOC bekliyor, islem hash'i DEGIL (tasarim belgesi SS3.1) --
            // hash dondurmek dapp'in yanit ayristirmasini bozar.
            await chrome.runtime.sendMessage({
                type: 'SEND_TX_SUCCESS',
                requestId: requestData.value.id,
                status: 'success',
                data: { result: { result: res.boc, id: requestData.value.appRequestId } },
            })
            page.currentPage = 'home'
        } else {
            console.error('[tonconnect] gonderim basarisiz:', res?.error)
            // res.error artik bir KOD'dur, bitmis metin DEGIL: arka plan dil bilmez
            // ve eskiden buraya SABIT TURKCE cumleler yaziyordu -- ingilizce arayuzde
            // kullanici Turkce hata okuyordu. Ceviri BURADA yapilir
            // (utils/ton/tonSendErrors.js); taninmayan bir kod GIZLENMEZ, ham haliyle
            // gorunur. Alan bos/eksikse (beklenmeyen bir dal) ekranin KENDI genel
            // yedegi kullanilir.
            hata.value = res?.error ? tonSendErrorText(res.error, t) : t('dapps.tonConnect.sendErrorGeneric')
        }
    } finally {
        loading.value = false
    }
}

const reddet = async () => {
    if (!requestData.value) return
    // TonConnect'te RED DE BIR YANITTIR (kod 300), bir hata degil -- ama
    // `connect`ten FARKLI tasinir: `send` yanitlari hata govdesini
    // `{ error: { code, message } }` seklinde, appRequestId ile birlikte
    // gonderir (tasarim belgesi SS3.1). `status: 'error'` yolundan gonderilseydi
    // resolvePendingRequest (dappFunctions.js) onu farkli bir bicimde
    // sarmalardi ve dapp'in kutuphanesi TonConnect yaniti olarak TANIMAZDI.
    await chrome.runtime.sendMessage({
        type: 'SEND_TX_SUCCESS',
        requestId: requestData.value.id,
        status: 'success',
        data: {
            result: {
                error: { code: 300, message: 'User rejected the request' },
                id: requestData.value.appRequestId,
            },
        },
    })
    page.currentPage = 'home'
}
</script>
