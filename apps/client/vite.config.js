import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    base: '/p2p-network/',
    resolve: {
        alias: {
            '@vfx/shared': path.resolve(__dirname, '../../packages/shared/src/index.js')
        }
    },
    server: {
        watch: {
            ignored: ['!../../packages/shared/**']
        }
    }
});