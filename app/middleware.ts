// Next.js 16 loads the root-level proxy.ts. Keep this re-export only so
// existing editor references to app/middleware.ts do not point at stale auth code.
export { proxy as middleware, config } from '../proxy';
