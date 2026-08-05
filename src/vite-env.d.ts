/// <reference types="vite/client" />

declare const __BUILD_INFO__: { hash: string; date: string };

declare module "*?raw" {
  const content: string;
  export default content;
}
