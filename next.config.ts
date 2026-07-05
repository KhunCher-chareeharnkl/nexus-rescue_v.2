import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ใส่ไอพีมือถือของคุณเพื่อปลดล็อก
  allowedDevOrigins: [
    '172.25.62.19',   // ไอพีเดิม
    '10.135.251.125'  // ไอพีปัจจุบัน
  ],
};

export default nextConfig;