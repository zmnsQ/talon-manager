/// <reference types="vite/client" />

declare module '*.png' {
  const src: string
  export default src
}

// Vite ?asset suffix for Electron main process
declare module '*?asset' {
  const src: string
  export default src
}
