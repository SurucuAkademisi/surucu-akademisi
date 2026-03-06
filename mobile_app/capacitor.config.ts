import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.surucuakademisi.app',
  appName: 'Sürücü Akademisi',
  webDir: 'src',
  plugins: {
    AdMob: {
      initializeForTesting: true
    }
  }
};

export default config;
