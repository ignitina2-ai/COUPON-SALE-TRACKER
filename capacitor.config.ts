import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.coupon_sale_tracker',
  appName: 'Coupon Sale Tracker',
  webDir: 'dist',
  server: {
    url: 'https://coupon-sale-tracker.vercel.app',
    cleartext: false
  }
};

export default config;
