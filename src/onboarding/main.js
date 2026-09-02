import { createApp } from 'vue'
import Onboarding from '../components/onboarding/index.vue'
import './style.css'
import { createPinia } from 'pinia'
import i18n from '../i18n'

const app = createApp(Onboarding)
const pinia = createPinia()

app.use(i18n)
app.use(pinia)
app.mount('#app')