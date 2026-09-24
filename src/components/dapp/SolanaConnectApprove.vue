<template>
    <!-- K5: yetkinin kaynagi TAM ORIGIN'dir; sema ve port da yetkinin parcasidir
         (https://app.x.com ile http://app.x.com AYNI yetkiyi paylasmaz), bu
         yuzden ciplak host DEGIL tam origin (kabuktaki buyuk h2) gosterilir.
         Kaynak, arka planin sender'dan cozdugu origin -- sayfanin iddia ettigi
         hicbir alan DEGIL. Wallet Standard'da manifest gibi dogrulanabilir bir
         belge YOKTUR: appMeta TAMAMEN sayfanin (saldirganin) kontrolundedir --
         bu yuzden ikincil, soluk ve ACIKCA "iddia edilen" etiketli (kabugun
         iddia pili). -->
    <ApprovalShell
        chain="solana"
        :title="$t('dapps.solana.title')"
        :origin="origin"
        :claimed-name="claimedName ? $t('dapps.solana.claimedLabel', { name: claimedName }) : ''"
        :claimed-icon="claimedIcon"
    >
        <!-- ConnectDapp.vue'daki `tonBlocked` emsali: soluk/kilitli bir dugme
             birakilmiyor, dugme tumden kaldiriliyor (asagida) ve NEDENI
             yaziliyor. Bu, arka plandaki 3. kapiya (§4.3.1) EK bir savunmadir. -->
        <div v-if="baglantiEngelli" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 flex items-start gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
            <div class="mt-0.5 text-amber-600 dark:text-amber-400 shrink-0 transition-colors duration-300">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            </div>
            <p class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.solana.accountUnsupported') }}</p>
        </div>

        <template v-else>
            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex items-center gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
                <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${solanaAddress}`" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 shrink-0 border border-slate-200 dark:border-white/5" v-if="solanaAddress" />
                <div v-else class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 animate-pulse border border-slate-200 dark:border-white/5"></div>
                <div class="flex flex-col cursor-pointer group flex-1 min-w-0" @click="copyAddress" :title="$t('dapps.solana.copy_title')">
                    <span class="text-xs text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.solana.address_label') }}</span>
                    <div class="flex items-center gap-1.5">
                        <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 font-mono transition-colors duration-300">{{ solanaAddress ? shortenAddress(solanaAddress) : '...' }}</span>
                        <span class="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold" v-if="copied">{{ $t('dapps.solana.copied') }}</span>
                    </div>
                </div>
            </div>

            <!-- YENI: eski tek-paragraflik izin bildirimi yerine EVM
                 ConnectDapp'teki kartin gorsel dili -- beyaz kart, kucuk
                 buyuk-harf baslik, 3 satir (goz/kalem/kalkan). Solana'nin
                 KENDI izinlerini acikca sayar. -->
            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl p-4 flex flex-col gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.solana.permissions_title') }}</p>

                <div class="flex items-start gap-3">
                    <div class="mt-0.5 text-emerald-600 dark:text-emerald-500 transition-colors duration-300">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ $t('dapps.solana.perm_view_title') }}</p>
                        <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('dapps.solana.perm_view_desc') }}</p>
                    </div>
                </div>

                <div class="flex items-start gap-3">
                    <div class="mt-0.5 text-emerald-600 dark:text-emerald-500 transition-colors duration-300">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ $t('dapps.solana.perm_sign_title') }}</p>
                        <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('dapps.solana.perm_sign_desc') }}</p>
                    </div>
                </div>

                <div class="flex items-start gap-3">
                    <div class="mt-0.5 text-emerald-600 dark:text-emerald-500 transition-colors duration-300">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ $t('dapps.solana.perm_noauto_title') }}</p>
                        <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('dapps.solana.perm_noauto_desc') }}</p>
                    </div>
                </div>
            </div>
        </template>

        <!-- Kimlik cozulemedi: dugme zaten !solanaAddress ile kilitli KALIR, ama
             bu SESSIZ bir kilit olmamali. Ham hata konsola, ekrana SABIT/cevrilmis
             metin (TonConnectApprove.vue emsali). -->
        <div v-if="identityError" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 transition-colors duration-300">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.solana.identity_error') }}</p>
        </div>

        <template #footer>
            <button
                @click="reddet"
                :disabled="loading"
                :class="baglantiEngelli ? 'w-full' : 'w-1/2'"
                class="py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer shadow-sm dark:shadow-none"
            >
                {{ $t('dapps.solana.btn_reject') }}
            </button>
            <button
                v-if="!baglantiEngelli"
                id="solana-connect-approve"
                @click="baglan"
                :disabled="loading || !solanaAddress || !solanaPublicKey"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/20 dark:shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('dapps.solana.btn_connect') }}</span>
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { pageStore } from '../../store/pageStore'
import { putSolanaSession } from '../../utils/solana/solanaConnectAuthz'
import { SOLANA_MAINNET_CHAIN } from '../../utils/solana/walletStandardFeatures'
import { isSolanaUnsupportedAccount } from '../../utils/solana/accountSupport'
import { gorunurKil } from '../../utils/solana/visibleText.js'
import ApprovalShell from './ApprovalShell.vue'

const page = pageStore()

const requestData = ref(null)
const account = ref(null)
// Depo bicimi HEX (yalniz dahili kolaylik, §4.4); sayfa sinirina giden bicim base64.
const solanaAddress = ref('')
const solanaPublicKey = ref('')
const identityError = ref('')
const baglantiEngelli = ref(false)
const loading = ref(false)
const copied = ref(false)

const origin = computed(() => requestData.value?.origin || '')
// C3.2: appMeta.name TAMAMEN sayfa (saldirgan) kontrolundedir -- SolanaSignTx.vue
// ve SolanaSignMessage.vue'nun kullandigi AYNI PAYLASILAN gorunmezlik/homoglif
// helper'inden (gorunurKil) gecer. Bu ekran eskiden ad'i HIC isaretlemiyordu.
const claimedName = computed(() => gorunurKil(String(requestData.value?.appMeta?.name || '').slice(0, 64)))
const fallbackIcon = computed(() => 'https://api.dicebear.com/7.x/initials/svg?seed=' + (origin.value || 'dapp'))
const claimedIcon = computed(() => requestData.value?.appMeta?.icon || fallbackIcon.value)

const shortenAddress = (addr) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-6)}` : '')

// Iki bicim arasindaki TEK cevrim noktasi: depo kaydi hex tutar, dapp'e giden
// yanit base64 ister (§3.3). Ikisini ayni yerde tutmak, ileride birinin sessizce
// otekine kaymasini engeller.
const hexToBase64 = (hex) => {
    const temiz = String(hex || '').replace(/^0x/, '')
    let ikili = ''
    for (let i = 0; i + 1 < temiz.length; i += 2) ikili += String.fromCharCode(parseInt(temiz.slice(i, i + 2), 16))
    return btoa(ikili)
}

const copyAddress = async () => {
    if (!solanaAddress.value) return
    try {
        await navigator.clipboard.writeText(solanaAddress.value)
        copied.value = true
        setTimeout(() => { copied.value = false }, 2000)
    } catch (e) {}
}

onMounted(async () => {
    const { current_request, active_account } = await chrome.storage.local.get(['current_request', 'active_account'])
    if (!current_request || current_request.type !== 'SOLANA_CONNECT') return

    requestData.value = current_request
    account.value = active_account
    baglantiEngelli.value = isSolanaUnsupportedAccount(active_account)
    // Turetilemeyecek bir anahtar icin kimlik SORULMAZ: SOLANA_CONNECT_IDENTITY
    // anahtar turettigi icin kasa acmayi gerektirir, sonuc zaten reddedilecektir.
    if (baglantiEngelli.value) return

    // Onbellekteki adres SADECE ilk boyama icin; ASLA EVM adresine dusulmez (§5.1)
    // ve oturum bu degerle YAZILMAZ -- yetkili kaynak asagidaki kimlik yanitidir
    // (publicKey'i yalniz o verir).
    solanaAddress.value = active_account?.solanaAddress || ''

    try {
        const identity = await chrome.runtime.sendMessage({
            type: 'SOLANA_CONNECT_IDENTITY',
            message: { accountKey: active_account?.key },
        })
        if (identity?.success) {
            solanaAddress.value = identity.address
            solanaPublicKey.value = identity.publicKey
        } else {
            console.error('[solana-dapp] kimlik cozulemedi:', identity?.error)
            identityError.value = identity?.error || 'IDENTITY_FAILED'
            solanaAddress.value = ''
        }
    } catch (e) {
        console.error('[solana-dapp] kimlik cozulemedi:', e?.message)
        identityError.value = e?.message || 'IDENTITY_FAILED'
        solanaAddress.value = ''
    }
})

const baglan = async () => {
    if (!requestData.value || loading.value) return
    // Sablondaki v-if ve :disabled yalnizca ARAYUZ durumudur, GARANTI degil.
    // Asil kilit burada: hesap desteklenmiyorsa ya da kimlik cozulemediyse
    // diske HICBIR SEY yazilmaz ve dapp'in istegi yanitlanmaz.
    if (baglantiEngelli.value || !solanaAddress.value || !solanaPublicKey.value) return
    loading.value = true
    try {
        const { solana_dapps = {} } = await chrome.storage.local.get('solana_dapps')
        const session = {
            address: solanaAddress.value,
            publicKey: solanaPublicKey.value,
            // Oturum bu hesaba SABITLENIR (K10): kullanici hesap degistirirse
            // dapp'e bos hesap listesi gider, kayit oldugu gibi kalir.
            accountKey: account.value?.key,
            cluster: SOLANA_MAINNET_CHAIN,
            appMeta: requestData.value.appMeta || null,
            connectedAt: Date.now(),
        }
        // Anahtar TAM ORIGIN (K5) -- ciplak host yazmak, o host'un her semasina
        // ve her portuna ayni yetkiyi verirdi.
        await chrome.storage.local.set({
            solana_dapps: putSolanaSession(solana_dapps, requestData.value.origin, session),
        })

        await chrome.runtime.sendMessage({
            type: 'CONNECT_WALLET_SUCCESS',
            // Yanit zarfinin alani `requestId`, DEGERI kaydin `id`sidir
            // (TonConnectApprove.vue:260 emsali). Kayittan `requestId` okunsaydi deger
            // undefined olur, resolvePendingRequest (dappFunctions.js:389-412) bekleyen
            // kaydi bulamaz, `current_request` HIC SILINMEZ ve dapp'in connect()
            // promise'i sonsuza kadar askida kalirdi.
            requestId: requestData.value.id,
            status: 'success',
            data: {
                // C1.5 -- nihai inceleme: `accountKey` sinira ARTIK CIKMAZ.
                // Depolanan `session.accountKey` (yukarida) dahili K10
                // korelasyon anahtaridir; content.js bu `data.result`u
                // OLDUGU GIBI sayfa dunyasina tasir, yani buradaki her alan
                // HERHANGI bir sayfa betigi tarafindan okunabilir.
                result: {
                    address: solanaAddress.value,
                    publicKey: hexToBase64(solanaPublicKey.value),
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
    // TON deseni burada KOPYALANMAZ (§3.6): TonConnect'te red gecerli bir yanit
    // GOVDESIDIR, Wallet Standard'da ise dapp'in promise'i REJECT olur. Bu yuzden
    // EVM ekranlarinin (ConnectDapp.vue) _REJECTED + status:'error' deseni.
    await chrome.runtime.sendMessage({
        type: 'CONNECT_WALLET_REJECTED',
        // Onay yolundaki AYNI gerekce: kaydin alani `id`dir
        // (TonConnectApprove.vue:293 emsali).
        requestId: requestData.value.id,
        status: 'error',
        error: { code: 4001, message: 'User rejected the request.' },
    })
    page.currentPage = 'home'
}
</script>
