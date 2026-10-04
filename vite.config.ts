import {defineConfig} from 'vite';
export default defineConfig({base:'./',build:{sourcemap:false},server:{headers:{'Cache-Control':'no-store'}}});
