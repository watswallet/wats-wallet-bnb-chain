import { createI18n } from 'vue-i18n'
import tr from './locales/tr.json'
import en from './locales/en.json'
import es from './locales/es.json'
import ptBR from './locales/pt-BR.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import vi from './locales/vi.json'
import id from './locales/id.json'
import ko from './locales/ko.json'
import ja from './locales/ja.json'
import de from './locales/de.json'
import fr from './locales/fr.json'
import { applySavedLanguage, detectLanguage } from './detectLanguage'
import { pluralRules } from './pluralRules'
import { bindHtmlLang } from './htmlLang'

const i18n = createI18n({
  legacy: false,
  // Rusca 3 cogul bicimi icin; vue-i18n varsayilani yalnizca 2 bicimi bilir.
  pluralRules,
  // Ilk deger tarayici dilinden: createI18n senkron calismak zorunda. Kullanicinin
  // kaydettigi secim depodan (async) okunup hemen ardindan uygulanir.
  locale: detectLanguage(),
  fallbackLocale: 'en',
  // Anahtarlar languages.js SUPPORTED_LANGS kodlariyla birebir ayni olmali; eksik/fazla
  // dil allLocales.test.js '12 dil kapisi' ile yakalanir.
  messages: { tr, en, es, 'pt-BR': ptBR, ru, 'zh-CN': zhCN, vi, id, ko, ja, de, fr }
})

// <html lang>'i secili dile bagla. applySavedLanguage'den ONCE: kayitli dil uygulaninca
// locale degisir ve izleme bunu yakalar. Service worker'da document yok, baglama atlanir.
bindHtmlLang(i18n)

// Kayitli dili uygula. Bunu cagiran YOKTU: kullanici Turkce sectikten sonra popup
// her acildiginda arayuz tekrar tarayici diline donuyordu; secim yalnizca
// Tercihler sayfasina girildiginde geri geliyordu.
applySavedLanguage(i18n)

export default i18n