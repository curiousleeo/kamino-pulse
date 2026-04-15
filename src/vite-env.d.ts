/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_JUPITER_API_KEY: string
  readonly VITE_HELIUS_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
