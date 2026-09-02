<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-emerald-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-sky-500/5 dark:from-sky-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex-1 flex flex-col relative px-6 py-3 overflow-y-auto custom-scrollbar z-10">
            <div class="flex flex-col items-center gap-2 mt-4">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.title') }}</p>

                <!-- K5: GERCEK origin (arka planin sender'dan cozdugu hostname)
                     ekranin EN BASKIN elemani. Manifest'in kendi `url` alanina
                     DEGIL, tonDappFunctions.js'teki resolveSenderOrigin
                     sonucuna bakiyoruz -- manifest baska bir origin'de
                     barinabilir ve orayi "origin" gibi gostermek tam da
                     onlenmek istenen kimlik taklidi olurdu. -->
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

            <!-- sameOrigin false ise manifest baska bir sunucuda barinir --
                 uyari acikca gosterilir ama baglanti YINE de engellenmez
                 (mesru dapp'ler manifestlerini CDN'de barindirabilir). -->
            <div v-if="manifestUyusmuyor" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 flex items-start gap-3 mt-5 shadow-sm dark:shadow-none transition-colors duration-300">
                <div class="mt-0.5 text-amber-600 dark:text-amber-400 shrink-0 transition-colors duration-300">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                </div>
                <p class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed transition-colors duration-300">
                    {{ $t('dapps.tonConnect.manifest_mismatch', { host: manifestHost }) }}
                </p>
            </div>

            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex items-center gap-3 mt-5 shadow-sm dark:shadow-none transition-colors duration-300">
                <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${tonAddress}`" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 shrink-0 border border-slate-200 dark:border-white/5" v-if="tonAddress" />
                <div v-else class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 animate-pulse border border-slate-200 dark:border-white/5"></div>
                <button type="button" class="flex flex-col cursor-pointer group flex-1 min-w-0 text-left" @click="copyAddress" :title="$t('dapps.tonConnect.copy_title')" :aria-label="$t('dapps.tonConnect.copy_title')">
                    <span class="text-xs text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.tonConnect.address_label') }}</span>
                    <span class="flex items-center gap-1.5">
                        <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 font-mono transition-colors duration-300">{{ tonAddress ? shortenAddress(tonAddress) : '...' }}</span>
                        <span class="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold" v-if="copied">{{ $t('dapps.tonConnect.copied') }}</span>
                    </span>
                </button>
            </div>

            <!-- proofPayload varsa kullanici SADECE adres paylasmiyor, ayni
                 zamanda imza da atiyor -- ikisi ayri satirda, karistirilmadan
                 gosterilir. -->
            <div v-if="proofIsteniyor" class="flex gap-2 px-1 mt-4">
                <svg class="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                <p class="text-[10px] text-slate-500 dark:text-zinc-500 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.proof_notice') }}</p>
            </div>

            <!-- Kimlik cozulemedi (orn. bu hesabin TON kasasi bulunamadi --
                 TON_FEE_IDENTITY'nin evmCapable bayragiyla korudugu AYNI durum).
                 Buton zaten !tonAddress ile kilitli KALIR, ama bu SESSIZ bir
                 kilit degil: kullanici NEDEN baglanamadigini gormeli. Ham hata
                 metni DEGIL, sabit/cevrilmis bir mesaj gosterilir. -->
            <div v-if="identityError" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 mt-4 transition-colors duration-300">
                <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.identity_error') }}</p>
            </div>

            <div v-if="signError" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 mt-4 transition-colors duration-300">
                <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed transition-colors duration-300">{{ signError }}</p>
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
                @click="baglan"
                :disabled="loading || !tonAddress"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/20 dark:shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('dapps.tonConnect.btn_connect') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { pageStore } from '../../store/pageStore'
import { putTonSession } from '../../utils/ton/tonConnectAuthz'
import { tonConnectDeviceInfo } from '../../utils/ton/tonConnectDevice'

const page = pageStore()

const requestData = ref(null)
const account = ref(null)
const manifestUyusmuyor = ref(false)
const proofIsteniyor = ref(false)

// TEK kimlik kaynagi TON_CONNECT_IDENTITY (background.js notu): tonIdentity.js'in
// ensureTonAddress/ton_addresses akisi FRIENDLY (UQ/EQ) adres uretir ve baska bir
// onbellek alanina yazar -- TonConnect ise RAW (0:hex) adres + hex publicKey +
// walletStateInit ister. Ikinci bir turetme yolu ACILMIYOR, var olan tek kapi
// kullaniliyor.
const tonAddress = ref('')
const tonPublicKey = ref('')
const tonWalletStateInit = ref('')
const identityError = ref('')

const signError = ref('')
const loading = ref(false)
const copied = ref(false)

const hostname = computed(() => requestData.value?.hostname || '')
const manifestName = computed(() => requestData.value?.manifest?.name || '')
const fallbackIcon = computed(() => 'https://api.dicebear.com/7.x/initials/svg?seed=' + (hostname.value || 'dapp'))
const manifestIcon = computed(() => requestData.value?.manifest?.iconUrl || fallbackIcon.value)

// Manifest FARKLI bir origin'de barinabilir (K5): kullaniciya sadece "uyusmuyor"
// demek yetmez, GERCEKTE nerede barindigini da gostermek gerekir.
const manifestHost = computed(() => {
    const url = requestData.value?.manifest?.manifestUrl
    if (!url) return ''
    try {
        return new URL(url).hostname
    } catch (e) {
        return url
    }
})

const shortenAddress = (addr) => (addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : '')

const copyAddress = async () => {
    if (!tonAddress.value) return
    try {
        await navigator.clipboard.writeText(tonAddress.value)
        copied.value = true
        setTimeout(() => { copied.value = false }, 2000)
    } catch (e) {}
}

onMounted(async () => {
    const { current_request, active_account } = await chrome.storage.local.get(['current_request', 'active_account'])
    if (!current_request || current_request.type !== 'TON_CONNECT') return

    requestData.value = current_request
    account.value = active_account
    manifestUyusmuyor.value = current_request.manifest?.sameOrigin === false
    proofIsteniyor.value = current_request.proofPayload !== null && current_request.proofPayload !== undefined

    try {
        const identity = await chrome.runtime.sendMessage({
            type: 'TON_CONNECT_IDENTITY',
            message: { chainId: Number(current_request.network), account: active_account },
        })
        if (identity?.success) {
            tonAddress.value = identity.address
            tonPublicKey.value = identity.publicKey
            tonWalletStateInit.value = identity.walletStateInit
        } else {
            // Ham hata konsola, ekrana DEGIL: kullaniciya gosterilen metin
            // $t('dapps.tonConnect.identity_error') SABIT ve cevrilmis --
            // teshis burada kalir, arayuz kod/mesaj sizdirmaz.
            console.error('[tonconnect] kimlik cozulemedi:', identity?.error)
            identityError.value = identity?.error || 'IDENTITY_FAILED'
        }
    } catch (e) {
        console.error('[tonconnect] kimlik cozulemedi:', e?.message)
        identityError.value = e?.message || 'IDENTITY_FAILED'
    }
})

const baglan = async () => {
    if (!requestData.value || loading.value) return
    // Buton zaten !tonAddress ile kilitli KALIR (sablonda), ama bu SADECE bir
    // arayuz durumu -- GARANTI degil. Asil kilit burada: adres/anahtar/
    // stateInit yoksa (kimlik cozulemedi) oturum hicbir zaman yazilmaz,
    // dugme bir sekilde tetiklense bile.
    if (!tonAddress.value) return
    loading.value = true
    signError.value = ''
    try {
        let proof = null

        // SIRA ONEMLI: imza ONCE denenir, oturum SONRA yazilir. Ters olsaydi
        // basarisiz bir imzadan sonra diskte "bagli" bir oturum kalir ve dapp
        // bunu asla kullanamazdi.
        if (proofIsteniyor.value) {
            const res = await chrome.runtime.sendMessage({
                type: 'TON_DAPP_SIGN',
                message: {
                    mode: 'proof',
                    domain: requestData.value.hostname,
                    proofPayload: requestData.value.proofPayload,
                    account: account.value,
                    // KAPSAM GENISLEMESI (kontrolor karari, gorev 13): background.js'in
                    // tonDappSign'i `from` VERILMISSE cozulen adresle karsilastirir
                    // (tonDappSend'in TonSendTx.vue icin ZATEN yaptigi AYNI kilit,
                    // Address.parse(...).equals(...)). Buradaki tonAddress zaten
                    // TON_CONNECT_IDENTITY'den cozulmus, ekranda gosterilen HAM
                    // (0:hex) TON adresi -- ikinci bir kaynak acilmiyor.
                    from: tonAddress.value,
                },
            })
            if (!res?.success) {
                signError.value = res?.error || 'Signature failed'
                return
            }
            proof = res
        }

        const { ton_dapps = {} } = await chrome.storage.local.get('ton_dapps')
        const session = {
            address: tonAddress.value,
            publicKey: tonPublicKey.value,
            walletStateInit: tonWalletStateInit.value,
            accountKey: account.value?.key,
            chain: requestData.value.network,
            manifest: requestData.value.manifest,
            connectedAt: Date.now(),
        }
        await chrome.storage.local.set({
            ton_dapps: putTonSession(ton_dapps, requestData.value.hostname, session),
        })

        const items = [{
            name: 'ton_addr',
            address: tonAddress.value,
            network: requestData.value.network,
            publicKey: tonPublicKey.value,
            walletStateInit: tonWalletStateInit.value,
        }]

        if (proof) {
            // Dapp imzayi dogrularken AYNI damga/domain ile mesaji yeniden
            // kurar (background.js:tonDappSign / tonProofMessage.js) -- burada
            // donen deger GERCEKTEN imzalanan degerle BIREBIR ayni olmali.
            const domainBytes = new TextEncoder().encode(requestData.value.hostname)
            items.push({
                name: 'ton_proof',
                proof: {
                    timestamp: proof.timestamp,
                    domain: { lengthBytes: domainBytes.length, value: requestData.value.hostname },
                    signature: proof.signature,
                    payload: requestData.value.proofPayload,
                },
            })
        }

        await chrome.runtime.sendMessage({
            type: 'CONNECT_WALLET_SUCCESS',
            requestId: requestData.value.id,
            status: 'success',
            data: {
                result: {
                    event: 'connect',
                    id: Date.now(),
                    payload: {
                        items,
                        // Kaynak tonConnectDevice.js (final inceleme K1) -- restoreConnection
                        // yanitiyla (tonDappFunctions.js) AYNI yerden okunur. Burada AYRI bir
                        // `features: []` yazmak, tam da bu ikisinin DRIFT etmesine yol acan
                        // defektti: baglanti calisir gorunur, sonra HER islem/imza dapp'in
                        // SDK'sinde HIC bize ulasmadan reddedilirdi.
                        device: tonConnectDeviceInfo(),
                    },
                },
            },
        })
        page.currentPage = 'home'
    } finally {
        loading.value = false
    }
}

const reddet = async () => {
    if (!requestData.value) return
    // TonConnect'te RED DE BIR YANITTIR (connect_error, kod 300), bir hata
    // degil. `status: 'error'` yolundan gonderilseydi resolvePendingRequest
    // (dappFunctions.js) onu `{ error: {...} }` seklinde dondururdu ve dapp'in
    // kutuphanesi bu bicimi TonConnect yaniti olarak TANIMAZDI.
    const RED = { event: 'connect_error', id: Date.now(), payload: { code: 300, message: 'User rejected the request' } }
    await chrome.runtime.sendMessage({
        type: 'CONNECT_WALLET_SUCCESS',
        requestId: requestData.value.id,
        status: 'success',
        data: { result: RED },
    })
    page.currentPage = 'home'
}
</script>
