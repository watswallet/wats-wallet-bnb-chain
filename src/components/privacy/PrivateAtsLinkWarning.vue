<template>
    <!-- Gizli modda ATS ucret kartinin "ATS YETERSIZ / ATS AL" durumundaki KIRMIZI uyari (2026-10-28: Para yukle'deki ATS-once kartindan tasindi).
         Gorunurluk kosulunu CAGIRAN verir (utils/privacy/privateAtsLinkWarning.js); bu bilesen yalniz cizer. Gri "Wats satis sunucusu ..." notu
         (privacy.atsSale.notice) ATS satis blogunda zaten vardir ve burada TEKRARLANMAZ. Metin mevcut anahtardir. -->
    <p data-testid="private-ats-link-warning" role="note" class="w-full px-1 text-xs font-medium leading-snug text-red-600 dark:text-red-400">{{ $t('privacy.transfer.atsLinkWarning') }}</p>
</template>
