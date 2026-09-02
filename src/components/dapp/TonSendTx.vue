<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-emerald-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-sky-500/5 dark:from-sky-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex-1 flex flex-col relative px-6 py-3 overflow-y-auto custom-scrollbar z-10">
            <div class="flex flex-col items-center gap-2 mt-4">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.sendTitle') }}</p>

                <!-- GERCEK origin (arka planin sender'dan cozdugu hostname) EN BASKIN
                     eleman -- TonConnectApprove.vue'deki AYNI kural (K5): manifest
                     BASKA bir origin'de barinabilir, onu "origin" gibi gostermek tam
                     da onlenmek istenen kimlik taklidi olurdu. -->
                <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight text-center break-all transition-colors duration-300">{{ hostname }}</h2>

                <!-- Manifest adi/ikonu IKINCIL: kucuk, soluk bir rozet. -->
                <div class="flex items-center gap-2 mt-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 max-w-full transition-colors duration-300">
                    <img
                        :src="manifestIcon"
                        @error="$event.target.src = fallbackIcon"
                        :alt="$t('dapps.tonConnect.alt_dapp_logo')"
                        class="w-4 h-4 rounded-full object-contain shrink-0"
                    >
                    <span class="text-xs font-medium text-slate-500 dark:text-zinc-400 truncate transition-colors duration-300">{{ manifestName }}</span>
                </div>
            </div>

            <!-- Ust seviye ozet uyari: EN AZ bir mesaj veri tasiyorsa hemen origin'in
                 altinda gorunur -- kullanici kartlari tek tek acmadan once bilir. -->
            <div v-if="veriTasiyanMesajVar" class="flex gap-2 px-1 mt-4">
                <svg class="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                <p class="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.dataWarningTitle') }}</p>
            </div>

            <!-- TonConnect tek istekte 4'e kadar mesaj tasir (tasarim belgesi). Her
                 mesaj KENDI kartinda, AYRI alici/miktar ile cizilir -- tek satirda
                 toplamak kullaniciya GERCEKTE neyi onayladigini gostermez. -->
            <div class="flex flex-col gap-2.5 mt-5">
                <div v-for="(m, i) in messages" :key="i" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2 shadow-sm dark:shadow-none transition-colors duration-300">
                    <div class="flex justify-between items-center">
                        <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.messageLabel', { n: i + 1 }) }}</span>
                        <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 tabular-nums transition-colors duration-300">{{ nanoToTon(m.amountNano) }} TON</span>
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
                </div>
            </div>

            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex justify-between items-center mt-3 shadow-sm dark:shadow-none transition-colors duration-300">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('dapps.tonConnect.totalLabel') }}</span>
                <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 tabular-nums transition-colors duration-300">{{ nanoToTon(toplamNano) }} TON</span>
            </div>

            <!-- TON'da imzali govde onay aninda yok, canli bir teklif cekilemez --
                 ConfirmTransaction.vue'nun duz-TON gonderiminde kullandigi AYNI
                 sabit ihtiyat payi (TON_FEE_RESERVE) burada da gosterilir. -->
            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex justify-between items-center mt-2.5 shadow-sm dark:shadow-none transition-colors duration-300">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('dapps.tonConnect.estimatedFeeLabel') }}</span>
                <span class="text-sm text-slate-800 dark:text-zinc-200 font-bold tabular-nums transition-colors duration-300">≈ {{ TON_FEE_RESERVE }} TON</span>
            </div>

            <!-- background.js (tonSendUserMessage) HER hata kodunu ZATEN bitmis,
                 kullaniciya-gosterilecek bir metne cevirip dondurur -- ekran onu
                 OLDUGU GIBI gosterir. Ikinci bir kod->metin haritasi TUTULMAZ:
                 arka plan hicbir zaman ham kod DONDURMEDIGI icin oyle bir harita
                 hep karsiliksiz (unreachable) kalirdi. Yalniz `error` alani BOS/
                 eksik gelirse (beklenmeyen bir dal) genel bir yedege duser. -->
            <div v-if="hata" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 mt-4 transition-colors duration-300">
                <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed transition-colors duration-300">{{ hata }}</p>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative z-20 flex gap-3 transition-colors duration-300">
            <button
                @click="reddet"
                :disabled="loading"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer shadow-sm dark:shadow-none"
            >
                {{ $t('dapps.tonConnect.btn_reject') }}
            </button>
            <button
                @click="onayla"
                :disabled="loading"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/20 dark:shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('dapps.tonConnect.btn_approve') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../store/pageStore'
import { configStore } from '../../store/config'
import { shortenAddress } from '../../utils/shortenAddress'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { nanoToTon } from '../../utils/ton/tonFeeAmounts'
import { TON_FEE_RESERVE } from '../../utils/ton/tonSend'

const { t } = useI18n()
const page = pageStore()
const config = configStore()

const requestData = ref(null)
const account = ref(null)
const loading = ref(false)
const hata = ref('')
const openRaw = ref({})

const hostname = computed(() => requestData.value?.hostname || '')
const manifestName = computed(() => requestData.value?.manifest?.name || '')
const fallbackIcon = computed(() => 'https://api.dicebear.com/7.x/initials/svg?seed=' + (hostname.value || 'dapp'))
const manifestIcon = computed(() => requestData.value?.manifest?.iconUrl || fallbackIcon.value)

const messages = computed(() => requestData.value?.messages || [])

// Adres kisaltmasi mevcut yardimcidan (utils/shortenAddress.js), 8/6 ile --
// TonConnectApprove.vue'nun kendi kisaltma bicimiyle AYNI genislik.
const shortAddress = (addr) => shortenAddress(addr, 8, 6)

const toggleRaw = (i) => { openRaw.value[i] = !openRaw.value[i] }

// TOPLAM BigInt ILE toplanir, Number ILE DEGIL: nanoton degerleri bir double'in
// tam temsil edebildigi araligi asabilir (tasarim belgesindeki, erken bir
// gorevde duzeltilen AYNI sinif hata). Sonuc bir DIZE olarak tutulur, sadece
// GOSTERIM aninda nanoToTon ile TON'a cevrilir -- ikinci bir donusum yazilmaz,
// tonFeeAmounts.js'teki TEK paylasilan donusum kullanilir.
const toplamNano = computed(() =>
    messages.value.reduce((sum, m) => sum + BigInt(m.amountNano), 0n).toString())

// Cuzdan BOC govdesini COZEMEZ -- bir ozet UYDURMAK yerine ACIKCA "veri var" denir.
const veriTasiyanMesajVar = computed(() => messages.value.some((m) => !!m.payload))

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
})

const onayla = async () => {
    if (!requestData.value || loading.value) return
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
            // res.error background.js'ten ZATEN kullaniciya-gosterilecek bicimde
            // gelir (tonSendUserMessage) -- oldugu gibi gosterilir. Yalniz alan
            // bos/eksikse (beklenmeyen bir dal) genel yedege duser.
            hata.value = res?.error || t('dapps.tonConnect.sendErrorGeneric')
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
