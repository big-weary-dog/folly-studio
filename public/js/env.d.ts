// Types for imports Vite resolves (vite/client covers styles, ?url and the like): '<path>/sandbox.html?sandbox' is
// the URL of the built sandbox page (tools/vite-sandbox.js).
declare module '*.html?sandbox' {
  const url: string;
  export default url;
}
