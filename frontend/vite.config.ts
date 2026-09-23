import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_BASE_URL / VITE_WS_BASE_URL point at the deployed API Gateway
// origin -- this app is a plain static build with no server of its own,
// so every environment (local dev, S3/CloudFront) just needs those two
// set correctly. See .env.example.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
