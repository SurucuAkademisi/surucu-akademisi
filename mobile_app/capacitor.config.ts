/// <reference types="@capacitor-firebase/authentication" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.surucuakademisi.app',
  appName: 'Sürücü Akademisi',
  webDir: 'src',
  plugins: {
    AdMob: {
      initializeForTesting: true
    },
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'microsoft.com']
    }
  }
};

export default config;
