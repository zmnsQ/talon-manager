// Allow Electron's -webkit-app-region CSS property in React style props
import 'csstype'

declare module 'csstype' {
  interface Properties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
