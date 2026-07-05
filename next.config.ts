import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ใส่ไอพีมือถือของคุณเพื่อปลดล็อก
  allowedDevOrigins: [
    '172.25.62.130',   // ไอพีเดิม
    '172.25.62.130'  // ไอพีปัจจุบัน
  ],
};

export default nextConfig;