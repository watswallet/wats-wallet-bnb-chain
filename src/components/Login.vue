<template>
    <!-- YON: editoryal sadelik (kullanici karari, 2026-09-02 -- uc yon gercek Chrome'da
         yan yana goruldu ve bu secildi).
         Kural: EFEKT YOK. Gradyan, parlama, bulanik isik kumesi, cam yuzey, gradyan
         baslik -- hicbiri. Hiyerarsi tipografi ve bosluktan gelir; MARKA VURGU RENGI
         YOKTUR (buton notr: acik temada siyah, koyu temada beyaz). Renk yalnizca ANLAM
         tasidiginda girer: hata icin kirmizi, basari icin yesil. -->
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-[#fcfcfd] dark:bg-[#09090b] text-slate-900 dark:text-white font-sans selection:bg-slate-900/10 dark:selection:bg-white/15 transition-colors duration-300">

        <div class="flex-1 flex flex-col justify-center px-7">

            <!-- Amblem, gomlek dugmesi buyuklugunde bir plakada. Plaka HER IKI temada da
                 koyu: logo.png gumus/beyaz bir kristal migfer ve acik zemine dogrudan
                 konunca kayboluyor (olculdu). Ikinci varlik (old-wats-black.png) FARKLI
                 bir cizim -- temaya gore degistirmek iki tema iki marka demek olurdu.
                 Plaka DURUM DEGISTIRMEZ: marka her acilista ayni gorunur, geri bildirim
                 alani alan ve butondur. -->
            <div class="h-10 w-10 rounded-[11px] bg-[#141419] flex items-center justify-center ring-1 ring-black/10 dark:ring-white/10">
                <img src="/logo.png" alt="WATS" class="h-6 w-6 object-contain" />
            </div>

            <h1 class="mt-7 text-[22px] font-semibold tracking-[-0.02em] leading-tight">
                {{ $t('login.title') }}
            </h1>

            <p class="mt-1.5 text-[13px] text-slate-500 dark:text-zinc-500">
                {{ profile?.username ? $t('login.continueAs', { username: profile.username }) : $t('login.subtitle') }}
            </p>

            <!-- Hata, etiket satirinin SAGINDA. Alanin altina koymak ya kalici bir bosluk
                 rezerve etmeyi ya da hata gelince duzeni ziplatmayi gerektirirdi; burada
                 ikisi de olmuyor ve mesaj tam da bakilan yerde. -->
            <div class="mt-9 flex items-baseline justify-between gap-3">
                <label for="login-password" class="text-[11px] font-medium text-slate-500 dark:text-zinc-500">
                    {{ $t('login.passwordLabel') }}
                </label>
                <p v-if="isError" class="text-[11px] font-medium text-red-600 dark:text-red-400">
                    {{ $t('login.wrong') }}
                </p>
            </div>

            <div class="mt-2 relative" :class="{ 'animate-nudge': isError }">
                <input
                    id="login-password"
                    ref="passwordInput"
                    autofocus
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    :disabled="isSuccess"
                    @focus="handleFocus"
                    @blur="isFocused = false"
                    @keyup.enter="unlock"
                    class="w-full h-11 rounded-[10px] border px-3.5 pr-10 text-sm outline-none transition-colors duration-200 disabled:opacity-60"
                    :class="fieldClass"
                />

                <button
                    @click="showPassword = !showPassword"
                    :aria-label="$t(showPassword ? 'login.hidePassword' : 'login.showPassword')"
                    :title="$t(showPassword ? 'login.hidePassword' : 'login.showPassword')"
                    tabindex="-1"
                    class="absolute right-0 top-0 h-11 w-10 flex items-center justify-center text-slate-400 dark:text-zinc-600 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors"
                >
                    <svg v-if="!showPassword" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.05 10.05 0 011.577-2.735m0 0A3.001 3.001 0 004 12c0 1.268.63 2.39 1.576 3.005m0-6.01L3 3m0 0l18 18M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29" /></svg>
                </button>
            </div>

            <button
                @click="unlock"
                :disabled="buttonState !== 'ready'"
                class="mt-4 h-11 w-full rounded-[10px] text-sm font-semibold flex items-center justify-center gap-2 transition-colors duration-200"
                :class="buttonClass"
            >
                <svg v-if="buttonState === 'loading'" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                <svg v-else-if="buttonState === 'success'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>

                <span v-if="buttonState === 'loading'">{{ $t('login.checking') }}</span>
                <span v-else-if="buttonState === 'success'">{{ $t('login.success') }}</span>
                <span v-else>{{ $t('login.unlock') }}</span>
            </button>

            <button
                @click="page.currentPage = 'forgot_password'"
                class="mt-5 self-start text-[12px] text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200 transition-colors"
            >
                {{ $t('login.forgot') }}
            </button>
        </div>

        <!-- Alt cubuk bir dipnot degil, bir guven ifadesi: anahtarlarin nerede durdugunu
             soyler. Onceki surumdeki `dark:text-zinc-800` #09090b uzerinde ~1.4:1
             kontrast veriyordu -- yazi vardi ama okunmuyordu. -->
        <div class="border-t border-slate-200 dark:border-white/[0.07] px-7 py-3.5 flex items-center gap-2 text-[11px] text-slate-400 dark:text-zinc-600">
            <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            <span>{{ $t('login.localEncryption') }}</span>
            <span class="ml-auto tabular-nums">v{{ pkg.version }}</span>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { userStore } from '../store/user'
import { pageStore } from '../store/pageStore'
import { exportMasterKey, verifyPassword } from '../utils/masterKey'
import pkg from '../../package.json'

const password = ref('')
const showPassword = ref(false)
const isFocused = ref(false)
const isLoading = ref(false)
const isSuccess = ref(false)
const isError = ref(false)
const passwordInput = ref(null)

const user = userStore()
const page = pageStore()

const error = ref('')
const profile = ref(null)

const handleFocus = () => {
    isFocused.value = true
    isError.value = false
}

/**
 * Butonun TEK durum kaynagi.
 *
 * KOK NEDEN: onceki surumde sablon `:class="[getButtonClass, <ucluk ifade>]"` yaziyordu
 * ve IKISI DE arka plan rengi veriyordu (`bg-slate-900 dark:bg-white` ile `bg-indigo-600`).
 * Ikisi de sinif listesine giriyordu; hangisinin kazandigi CSS SIRASINA kaliyordu, niyete
 * degil -- yani "hazir" butonun rengi kod okunarak SOYLENEMEZDI. Durumu once adlandirmak
 * iki arka planin ayni anda uretilmesini imkansiz kilar.
 */
const buttonState = computed(() => {
    if (isSuccess.value) return 'success'
    if (isLoading.value) return 'loading'
    if (!password.value) return 'disabled'
    return 'ready'
})

// Her durum, tema basina TEK bir arka plan verir (acik icin `bg-*`, koyu icin `dark:bg-*`).
// Bir duruma ikinci bir `bg-*` eklemek, yukarida anlatilan cakismayi geri getirir.
const BUTTON_CLASSES = {
    ready: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200',
    loading: 'bg-slate-400 text-white dark:bg-zinc-400 dark:text-black cursor-wait',
    success: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white',
    disabled: 'bg-slate-100 text-slate-400 dark:bg-white/[0.06] dark:text-zinc-600 cursor-not-allowed',
}

const buttonClass = computed(() => BUTTON_CLASSES[buttonState.value])

// Alanin kenarligi tek bir sirada karar verir: hata > odak > bosta. Zemin uc durumda da
// AYNI -- bu tasarimda geri bildirimi renk lekesi degil, kenarlik tasir.
const fieldClass = computed(() => {
    const surface = 'bg-white dark:bg-white/[0.03]'
    if (isError.value) return `${surface} border-red-500/70 dark:border-red-500/50`
    if (isFocused.value) return `${surface} border-slate-400 dark:border-white/25`
    return `${surface} border-slate-300 dark:border-white/10`
})

const unlock = async () => {
    if (!password.value) return

    isLoading.value = true
    isError.value = false

    try {
        const { vaults, walletSalt, active_account } = await chrome.storage.local.get(['vaults', 'walletSalt', 'active_account'])
        if (!vaults || !walletSalt) throw new Error('Data required')

        // Parola doğrulaması: eskiden diskteki jwk kopyasıyla karşılaştırılıyordu
        // (o kopya anahtarın kendisiydi). Artık gerçekten bir kasa çözülerek doğrulanır.
        const masterKey = await verifyPassword(password.value, { walletSalt, vaults })
        if (!masterKey) throw new Error('Invalid password')

        // Master key yalnızca oturum boyunca, background'ın bellek içi session'ında durur.
        await chrome.runtime.sendMessage({ type: 'UNLOCK_WALLET', masterKeyJwk: await exportMasterKey(masterKey) })

        if (!user.address && active_account) {
            user.address = active_account.address
        }

        unlockSuccess()

    } catch (err) {
        console.error("Unlock hatası:", err)
        error.value = err.message || 'Cüzdan açılamadı'
        unlockError()
    } finally {
        isLoading.value = false
    }
}

// Bu ekran acilinca yapilacak TEK sey sifre yazmak, o yuzden imlec alanda baslar.
//
// NEDEN TEK BIR focus() YETMIYOR -- iki ayri sebep, ikisi de uzanti yuzeyine ozel:
//
// 1) Ekran, pencere acilir acilmaz kurulmuyor. App.vue once depodan okuyor ve
//    service worker'a CHECK_UNLOCK soruyor (SW uykudaysa uyanmasi gerekiyor),
//    ancak ondan sonra currentPage 'welcome' oluyor; ustune <Transition
//    mode="out-in"> geciyor. Bu arada verilen odagi, pencere ETKINLESIRKEN
//    tarayici govdeye geri alabiliyor -- ve geri alinca tekrar deneyen kimse yok.
// 2) Yan panel, kullanici icine TIKLAYANA kadar klavye odagini hic almiyor.
//    O tiklama ile odak once tiklanan seye gidiyor; eski kapi ("activeElement
//    govde degilse dokunma") tam da bu yuzden her seferinde geri donuyordu.
//
// Bu yuzden odak kisa bir sure ISRARLA denenir: alan odaga oturunca ya da sure
// dolunca birakilir. Kullanici kendi tercihini yaptigi anda (bir yere dokunmak,
// Tab'a basmak) israr hemen kesilir -- odak CALINMAZ.
let israrZamanlayici = null

// Yalniz GERCEK bir yazma alanindan geri cekil. Dugme/govde/div odaktaysa
// kullanici bir sey yaziyor sayilmaz, alan odagi alabilir.
const yazmaAlani = (el) =>
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)

const odaklan = () => {
    // SSR/node ortaminda document YOK: ekran kilidi testleri bu bileseni gercekten
    // render ediyor (screenSetupPageWrite.ssr.test.js), ciplak erisim orayi kirardi.
    if (typeof document === 'undefined') return false

    const alan = passwordInput.value
    if (!alan || alan.disabled) return false

    const aktif = document.activeElement
    if (aktif !== alan && yazmaAlani(aktif)) return true

    alan.focus()
    return document.activeElement === alan
}

const israriBirak = () => {
    if (israrZamanlayici !== null) {
        clearInterval(israrZamanlayici)
        israrZamanlayici = null
    }
}

// ILK ODAK TUTTU DIYE BIRAKMA. Asil kirilma zaten "odak verildi, sonra geri
// alindi": pencere etkinlesirken tarayici odagi govdeye dondurebiliyor. Erken
// cikilirsa tam o an dongu calismiyor olur. Bu yuzden sure boyunca odagin
// alanda KALDIGI dogrulanir; birakma karari kullanicidan gelir (pointerdown/Tab).
const israrEt = (sureMs = 1200) => {
    if (typeof window === 'undefined') return
    israriBirak()
    odaklan()
    const bitis = Date.now() + sureMs
    israrZamanlayici = setInterval(() => {
        odaklan()
        if (Date.now() > bitis) israriBirak()
    }, 60)
}

// Panel/popup sonradan odak alirsa (kullanici icine tikladiginda) tekrar dene.
const pencereOdaklandi = () => israrEt(600)

// Tab, "odagi ben yonetiyorum" demektir; israr orada biter. Diger tuslar
// KESMEZ: odak henuz oturmamisken yazmaya baslayan kullanicinin dongusunu
// kapatmak, tam da duzeltmeye calistigimiz sonucu verirdi.
const tusaBasildi = (e) => { if (e.key === 'Tab') israriBirak() }

onMounted(async () => {
    israrEt()
    if (typeof window !== 'undefined') {
        window.addEventListener('focus', pencereOdaklandi)
        // Kullanici bir yere dokundu: secim onun, israr biter. Yakalama evresi
        // SART -- israr dongusunun bir sonraki turundan once calismali, yoksa
        // tikladigi dugmenin odagini geri calardi.
        document.addEventListener('pointerdown', israriBirak, true)
        document.addEventListener('keydown', tusaBasildi, true)
    }

    const { user: u } = await chrome.storage.local.get('user')
    profile.value = u
})

onUnmounted(() => {
    israriBirak()
    if (typeof window !== 'undefined') {
        window.removeEventListener('focus', pencereOdaklandi)
        document.removeEventListener('pointerdown', israriBirak, true)
        document.removeEventListener('keydown', tusaBasildi, true)
    }
})

const unlockError = () => {
    isLoading.value = false
    isError.value = true

    // 2 saniye: onceki 500 ms, "Yanlis sifre." okunmadan kayboluyordu. Kullanici alana
    // dokundugu anda zaten temizleniyor (handleFocus).
    setTimeout(() => isError.value = false, 2000)
}

const unlockSuccess = () => {
    isLoading.value = false
    isSuccess.value = true

    setTimeout(() => {
        if (!page.redirect) {
            page.currentPage = 'home'
        } else {
            page.currentPage = page.redirect
            page.redirect = null
        }
    }, 800)
}
</script>

<style scoped>
/* Tek hareket, ve kucuk: 2px. Onceki 4px'lik sarsinti bu sadelikteki bir ekranda
   abartili duruyordu; amac dikkati cekmek, ekrani sallamak degil. */
@keyframes nudge {
    0%, 100% { transform: translateX(0); }
    30% { transform: translateX(-2px); }
    70% { transform: translateX(2px); }
}
.animate-nudge {
    animation: nudge 0.22s ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
    .animate-nudge { animation: none; }
}
</style>
