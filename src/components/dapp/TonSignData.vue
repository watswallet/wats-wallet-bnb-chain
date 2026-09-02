<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-emerald-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-sky-500/5 dark:from-sky-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex-1 flex flex-col relative px-6 py-3 overflow-y-auto custom-scrollbar z-10">
            <div class="flex flex-col items-center gap-2 mt-4">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.signDataTitle') }}</p>

                <!-- GERCEK origin (current_request.hostname, arka planin sender'dan
                     cozdugu deger) EN BASKIN eleman -- TonConnectApprove.vue/
                     TonSendTx.vue'deki AYNI kural (K5) VE AYNI alan: manifest
                     BASKA bir origin'de barinabilir, orayi "origin" gibi
                     gostermek tam da onlenmek istenen kimlik taklidi olurdu.
                     UC onay ekrani da (bu, TonConnectApprove.vue, TonSendTx.vue)
                     AYNI gorsel guven desenini paylasir -- kullanici NEREYE
                     bakacagini bir kere ogrenir; sema (scheme) gorunurlugu
                     GEREKLIYSE bu UCUNE BIRDEN, ayri bir kararla eklenmeli,
                     tek ekranda SESSIZCE degil (fix round 1, kontrolor notu). -->
                <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight text-center break-all transition-colors duration-300">{{ hostname }}</h2>

                <!-- Manifest adi/ikonu IKINCIL: kucuk, soluk bir rozet -- manifest
                     dogrulanmamis bir iddiadir. -->
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

            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3.5 flex flex-col gap-2 mt-5 shadow-sm dark:shadow-none transition-colors duration-300">
                <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.dataLabel') }}</span>

                <!-- text: TEK okunabilir tip. Duz, secilebilir metin -- kullanici
                     NEYI imzaladigini GERCEKTEN gorur. -->
                <p
                    v-if="icerikOkunabilir"
                    class="text-sm text-slate-800 dark:text-zinc-200 whitespace-pre-wrap break-all select-text transition-colors duration-300"
                >{{ payload?.text }}</p>

                <!-- binary/cell: cuzdan bunlari COZEMEZ. Ham base64'u ekrana
                     DOKMEK, kullaniciya anlamadigi bir metni "okudugu" izlenimi
                     verirdi -- burada NE ham veri NE uydurma bir ozet var,
                     yalnizca dogrulanabilir bir hash. -->
                <div v-else class="flex flex-col gap-2.5">
                    <div class="flex gap-2">
                        <svg class="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                        <p class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.unreadableDesc') }}</p>
                    </div>
                    <div v-if="payload?.type === 'cell'" class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('dapps.tonConnect.schemaLabel') }}</span>
                        <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded break-all transition-colors duration-300">{{ payload.schema }}</span>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.hashLabel') }}</span>
                        <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 break-all transition-colors duration-300">{{ shortHash || '...' }}</span>
                    </div>
                </div>
            </div>

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
                <span v-else>{{ $t('dapps.tonConnect.btn_sign') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../store/pageStore'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { shortenAddress } from '../../utils/shortenAddress'
import { sha256, toHex } from '../../utils/crypto-utils'

const { t } = useI18n()
const page = pageStore()

const requestData = ref(null)
const account = ref(null)
const loading = ref(false)
const hata = ref('')
const contentHash = ref('')

const hostname = computed(() => requestData.value?.hostname || '')
const manifestName = computed(() => requestData.value?.manifest?.name || '')
const fallbackIcon = computed(() => 'https://api.dicebear.com/7.x/initials/svg?seed=' + (requestData.value?.hostname || 'dapp'))
const manifestIcon = computed(() => requestData.value?.manifest?.iconUrl || fallbackIcon.value)

const payload = computed(() => requestData.value?.payload || null)

// text OKUNABILIR tek tip -- binary/cell HAM bayt/hucre tasir, cuzdan bunlari
// COZEMEZ (bkz. TonSendTx.vue'daki AYNI gerekce: bir OZET UYDURMAK, kullaniciyi
// gercekte gormedigi bir seye onay verdirmek olurdu).
const icerikOkunabilir = computed(() => payload.value?.type === 'text')

// Hash TAM gosterilmez, kisaltilir -- ayni shortenAddress bicimi (adres
// DEGIL ama TEK paylasilan kisaltma yardimcisi budur, ikincisi acilmaz).
const shortHash = computed(() => (contentHash.value ? shortenAddress(contentHash.value, 16, 8) : ''))

function decodeBase64(value) {
    try {
        const bin = atob(value)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    } catch (e) {
        return null
    }
}

onMounted(async () => {
    const { current_request, active_account, vaults } = await chrome.storage.local.get(['current_request', 'active_account', 'vaults'])
    if (!current_request || current_request.type !== 'TON_SIGN_DATA') return

    requestData.value = current_request

    // ONAYLANAN HESABA KILIT: TonSendTx.vue'deki AYNI desen. current_request.accountKey
    // TonConnect oturumu kurulurken sabitlenmisti (TonConnectApprove.vue ->
    // session.accountKey) ve handleTonSignData (background.js, gorev 13 kapsam
    // genislemesi) onu buraya TASIR. Aktif hesaba SESSIZCE dusmek, kullanici
    // bagliyken hesap degistirmisse YANLIS cuzdandan imzalatmaya calisirdi --
    // background.js'in tonDappSign'i bunu asagida gonderilen `from` esitligiyle
    // SONRADAN yakalar, ama arayuzun GONDERDIGI hesap zaten dogru olmali.
    // accountKey vaults'ta bulunamazsa (eski istek / test verisi) aktif hesaba
    // dusulur -- background zaten AYNI varsayilani (resolveAccount) uyguluyor.
    const accounts = flattenVaultAccounts(vaults)
    account.value = accounts.find((a) => a.key === current_request.accountKey) || active_account || null

    // binary/cell OKUNAMAZ -- ham base64'u ekrana DOKMEK yerine bir hash
    // gosterilir (dogrulanabilir, ama yaniltmaz). Bu SADECE GOSTERIM icindir:
    // nihai imzada kullanilan digest'le AYNI olmasi GEREKMEZ (background.js
    // kendi digest'ini tonSignDataSchemes.js'ten KENDI baglamiyla kurar) --
    // amac kullaniciya "bunu okuyamiyoruz ama icerigi degistiremezsiniz"
    // guvencesi vermek, imzayi yeniden uretmek DEGIL.
    if (current_request.payload?.type === 'binary' || current_request.payload?.type === 'cell') {
        const raw = current_request.payload.type === 'binary' ? current_request.payload.bytes : current_request.payload.cell
        const bytes = decodeBase64(raw)
        if (bytes) {
            const digest = await sha256(bytes)
            contentHash.value = toHex(digest)
        }
    }
})

const onayla = async () => {
    if (!requestData.value || loading.value) return
    loading.value = true
    hata.value = ''
    try {
        const res = await chrome.runtime.sendMessage({
            type: 'TON_DAPP_SIGN',
            message: {
                mode: 'signData',
                domain: requestData.value.hostname,
                payload: requestData.value.payload,
                account: account.value,
                // KAPSAM GENISLEMESI: onaylanan adres -- background.js'in
                // tonDappSign'i BUNU cozulen anahtarin adresiyle karsilastirir
                // (tonDappSend'deki AYNI Address.parse(...).equals(...) tekigi).
                // Eksik gonderilirse kilit sessizce devre disi kalir.
                from: requestData.value.from,
            },
        })

        if (res?.success) {
            // Dapp DORDUNU birden ister (signature/timestamp/domain/address):
            // imza tek basina anlamsizdir, cunku imzalanan mesaj domain +
            // timestamp + adres ile kurulmustu (background.js:tonDappSign).
            //
            // domain BURADA DUZ BIR DIZE (final inceleme K2): TonConnect'in
            // SignDataResult sozlesmesi `domain`i STRING olarak tanimlar --
            // { lengthBytes, value } sekli ton_proof'un (TonConnectApprove.vue)
            // kanit-onizleme formatidir, BURAYA AIT DEGIL. Referans dogrulayici
            // String(result.domain) ile onizlemeyi yeniden kurar; nesne verilirse
            // "[object Object]" cikar ve ed25519 dogrulamasi SESSIZCE basarisiz olur
            // -- imzanin kendisi dogru kalir, yalniz donen metadata yanlis olurdu.
            await chrome.runtime.sendMessage({
                type: 'SIGN_MESSAGE_SUCCESS',
                requestId: requestData.value.id,
                status: 'success',
                data: {
                    result: {
                        result: {
                            signature: res.signature,
                            address: requestData.value.from,
                            timestamp: res.timestamp,
                            domain: requestData.value.hostname,
                            payload: requestData.value.payload,
                        },
                        id: requestData.value.appRequestId,
                    },
                },
            })
            page.currentPage = 'home'
        } else {
            console.error('[tonconnect] imza basarisiz:', res?.error)
            // res.error background.js'ten ZATEN kullaniciya-gosterilecek bicimde
            // gelir (TonSendTx.vue'deki AYNI sozlesme) -- oldugu gibi gosterilir.
            // Ikinci bir kod->metin haritasi TUTULMAZ.
            hata.value = res?.error || t('dapps.tonConnect.signErrorGeneric')
        }
    } finally {
        loading.value = false
    }
}

const reddet = async () => {
    if (!requestData.value) return
    // TonConnect'te RED DE BIR YANITTIR (kod 300), bir hata degil --
    // TonSendTx.vue'deki AYNI kural: `send`/`signData` yanitlari hata govdesini
    // `{ error: { code, message } }` seklinde, appRequestId ile birlikte tasir.
    await chrome.runtime.sendMessage({
        type: 'SIGN_MESSAGE_SUCCESS',
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
