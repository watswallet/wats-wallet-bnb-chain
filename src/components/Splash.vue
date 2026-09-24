<template>
    <!-- YUKLEME EKRANI. Kullanici karari (2026-09-15): "sadece dark/light theme
         uzerinde duran bir wats logosu, altinda da loading spinner, bu kadar."
         Metin, yuzde, ipucu YOK -- "bu kadar" bir sinirdir (kilit:
         Splash.ssr.test.js).

         YON: Login.vue ile AYNI -- EFEKT YOK. Gradyan, parlama, cam yuzey,
         marka vurgu rengi hicbiri girmez; ekranda zaten tek bir sey var.

         `fixed inset-0`: zemin SAYDAM birakilamaz, cunku bu ekranin butun
         amaci altindaki YARIM DOLU ana sayfayi gostermemek. -->
    <div
        data-splash
        class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#fcfcfd] dark:bg-[#09090b] transition-colors duration-300"
    >
        <!-- Plaka HER IKI temada da koyu. Gerekce Login.vue'de olculdu: logo.png
             gumus/beyaz bir kristal migfer ve acik zemine DOGRUDAN konunca
             kayboluyor. Temaya gore varlik degistirmek (old-wats-black/white)
             FARKLI bir cizim demek olurdu -- iki tema, iki marka. -->
        <div class="h-10 w-10 rounded-[11px] bg-[#141419] flex items-center justify-center ring-1 ring-black/10 dark:ring-white/10">
            <img src="/logo.png" alt="WATS" class="h-6 w-6 object-contain" />
        </div>

        <!-- Spinner logonun ALTINDA ve ondan KUCUK: marka once okunur, hareket
             ikinci sirada. Renk notr (slate/zinc) -- bkz. yukaridaki "marka
             vurgu rengi yok" kurali. -->
        <div
            class="mt-5 h-[18px] w-[18px] rounded-full border-2 border-slate-200 border-t-slate-900 dark:border-zinc-800 dark:border-t-zinc-100 animate-spin"
        ></div>
    </div>
</template>
