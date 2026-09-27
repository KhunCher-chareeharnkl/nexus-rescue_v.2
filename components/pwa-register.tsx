"use client";

import { useEffect, useState } from "react";
import { getPendingSosCount, syncPendingSosRequests } from "@/lib/offline-sos-queue";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_NOTICE_DISMISSED_KEY = "nexus_pwa_install_notice_dismissed";
const PUSH_NOTICE_DISMISSED_KEY = "nexus_push_notice_dismissed";

function base64UrlToUint8Array(value: string) {
  const padded = value.padEnd(value.length + (4 - (value.length % 4)) % 4, '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: InstallPromptEvent;
  }

  interface Navigator {
    standalone?: boolean;
  }
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem(INSTALL_NOTICE_DISMISSED_KEY) === "true");
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [pendingSosCount, setPendingSosCount] = useState(0);
  const [syncingSos, setSyncingSos] = useState(false);
  const [pushRegistration, setPushRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [pushDismissed, setPushDismissed] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem(PUSH_NOTICE_DISMISSED_KEY) === "true");
  const [enablingPush, setEnablingPush] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloadedForUpdate = false;
    const onControllerChange = () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    };
    const onInstallPrompt = (event: InstallPromptEvent) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          // Always revalidate the worker script when an installed app opens.
          // This avoids Android retaining an old PWA shell after a deployment.
          updateViaCache: "none",
        });
        void registration.update();
        setPushRegistration(registration);
        if ('Notification' in window && 'PushManager' in window) setPushPermission(Notification.permission);

        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
          setUpdateReady(true);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(registration.waiting ?? installing);
              setUpdateReady(true);
            }
          });
        });
      } catch {
        // The website remains fully usable if a browser blocks service workers.
      }
    };

    void register();
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    const refreshPendingCount = () => setPendingSosCount(getPendingSosCount());
    const syncQueuedSos = async () => {
      if (!navigator.onLine) return;
      setSyncingSos(true);
      await syncPendingSosRequests();
      refreshPendingCount();
      setSyncingSos(false);
    };
    const onOnline = () => { void syncQueuedSos(); };

    refreshPendingCount();
    void syncQueuedSos();
    window.addEventListener('online', onOnline);
    window.addEventListener('nexus:sos-queue-changed', refreshPendingCount);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('nexus:sos-queue-changed', refreshPendingCount);
    };
  }, []);

  const requestInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "dismissed") dismissInstallNotice();
      return;
    }

    if (isAppleMobile()) setShowIosHelp(true);
  };

  const dismissInstallNotice = () => {
    window.localStorage.setItem(INSTALL_NOTICE_DISMISSED_KEY, "true");
    setShowIosHelp(false);
    setInstallDismissed(true);
  };

  const applyUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    window.location.reload();
  };

  const enablePush = async () => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!pushRegistration || !publicKey || !('Notification' in window)) return;
    setEnablingPush(true);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== 'granted') return;
      const subscription = await pushRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
      const response = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subscription),
      });
      if (!response.ok) throw new Error('บันทึกการแจ้งเตือนไม่สำเร็จ');
      window.localStorage.setItem(PUSH_NOTICE_DISMISSED_KEY, 'true');
      setPushDismissed(true);
    } catch {
      // Permission can be retried from browser settings if the user chooses to.
    } finally {
      setEnablingPush(false);
    }
  };

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
  const canShowInstall =
    !installDismissed && !isStandalone && (Boolean(installPrompt) || isAppleMobile());
  const canShowPush =
    !pushDismissed && pushRegistration !== null && pushPermission === 'default'
    && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

  if (!updateReady && !canShowInstall && !canShowPush && pendingSosCount === 0) return null;

  return (
    <aside className="pwa-notice" aria-live="polite">
      {updateReady ? (
        <>
          <div>
            <strong>มีเวอร์ชันใหม่พร้อมใช้งาน</strong>
            <span>อัปเดตเพื่อรับการปรับปรุงล่าสุด</span>
          </div>
          <button type="button" onClick={applyUpdate}>
            อัปเดตตอนนี้
          </button>
          <button className="pwa-dismiss" type="button" onClick={() => setUpdateReady(false)} aria-label="ปิด">
            ×
          </button>
        </>
      ) : pendingSosCount > 0 ? (
        <>
          <div>
            <strong>มีคำขอ SOS รอส่ง {pendingSosCount} รายการ</strong>
            <span>{navigator.onLine ? 'ระบบจะส่งทันทีเมื่อเชื่อมต่อได้' : 'จะส่งให้อัตโนมัติเมื่ออินเทอร์เน็ตกลับมา'}</span>
          </div>
          <button type="button" onClick={() => {
            setSyncingSos(true);
            void syncPendingSosRequests().then(() => setPendingSosCount(getPendingSosCount())).finally(() => setSyncingSos(false));
          }} disabled={!navigator.onLine || syncingSos}>
            {syncingSos ? 'กำลังส่ง...' : 'ลองส่งตอนนี้'}
          </button>
        </>
      ) : canShowPush ? (
        <>
          <div>
            <strong>เปิดการแจ้งเตือนภารกิจ</strong>
            <span>รับแจ้งเตือน SOS และรายการรอยืนยัน แม้ไม่ได้เปิดหน้าเว็บ</span>
          </div>
          <button type="button" onClick={() => void enablePush()} disabled={enablingPush}>
            {enablingPush ? 'กำลังเปิด...' : 'เปิดแจ้งเตือน'}
          </button>
          <button className="pwa-dismiss" type="button" onClick={() => { window.localStorage.setItem(PUSH_NOTICE_DISMISSED_KEY, 'true'); setPushDismissed(true); }} aria-label="ปิด">×</button>
        </>
      ) : showIosHelp ? (
        <>
          <div>
            <strong>ติดตั้ง Nexus Rescue</strong>
            <span>กดปุ่มแชร์ใน Safari แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”</span>
          </div>
          <button className="pwa-dismiss" type="button" onClick={dismissInstallNotice} aria-label="ปิด">
            ×
          </button>
        </>
      ) : (
        <>
          <div>
            <strong>ติดตั้งแอป Nexus Rescue</strong>
            <span>เปิดใช้งานจากหน้าจอหลักได้รวดเร็วขึ้น</span>
          </div>
          <button type="button" onClick={() => void requestInstall()}>
            ติดตั้ง
          </button>
          <button className="pwa-dismiss" type="button" onClick={dismissInstallNotice} aria-label="ปิด">
            ×
          </button>
        </>
      )}
    </aside>
  );
}
