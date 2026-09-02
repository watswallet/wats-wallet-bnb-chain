import { createI18n } from 'vue-i18n'
import tr from './locales/tr.json'
import en from './locales/en.json'
import { applySavedLanguage, detectLanguage } from './detectLanguage'

const i18n = createI18n({
  legacy: false,
  // Ilk deger tarayici dilinden: createI18n senkron calismak zorunda. Kullanicinin
  // kaydettigi secim depodan (async) okunup hemen ardindan uygulanir.
  locale: detectLanguage(),
  fallbackLocale: 'en',
  messages: { tr, en }
})

// Kayitli dili uygula. Bunu cagiran YOKTU: kullanici Turkce sectikten sonra popup
// her acildiginda arayuz tekrar tarayici diline donuyordu; secim yalnizca
// Tercihler sayfasina girildiginde geri geliyordu.
applySavedLanguage(i18n)

export default i18n