import { defineStore } from "pinia"
import { ref } from "vue"

export const configStore = defineStore('configStore', () => {
    // URL'ler build-time env'den gelir (Vite mode): dev -> localhost, prod -> prod backend.
    // Kaynak her branch'te AYNI; deger .env.[mode] dosyalarinda. Fallback: guvenli localhost.
    const api = ref(import.meta.env.VITE_API_URL || 'http://localhost:8000')
    // Pimlico bundler+paymaster proxy koku (kendi backend). API key burada DEGIL, sunucuda.
    const bundlerBase = ref(import.meta.env.VITE_BUNDLER_BASE || 'http://localhost:8000')

    return { api, bundlerBase }
})
