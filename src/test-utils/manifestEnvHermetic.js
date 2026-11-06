import { stubManifestEnvForFile } from './manifestEnv'

// Yan etkili import: manifest.config.js'i statik import eden test dosyasi bunu ONDEN import eder (ESM import'lari
// kaynak sirasiyla degerlendirilir), boylece config yuklenirken ortam hermetiktir (T23 M7). Ayrintilar manifestEnv.js'te.
stubManifestEnvForFile()
