"use client";

import { useEffect, useState } from "react";
import { getPendingSosCount, syncPendingSosRequests } from "@/lib/offline-sos-queue";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_NOTICE_DISMISSED_KEY = "nexus_pwa_install_notice_dismissed";

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
  const [installDismissed, setInstallDismissed] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [pendingSosCount, setPendingSosCount] = useState(0);
  const [syncingSos, setSyncingSos] = useState(false);

  useEffect(() => {
    setInstallDismissed(
      window.localStorage.getItem(INSTALL_NOTICE_DISMISSED_KEY) === "true",
    );
  }, []);

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
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

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

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
  const canShowInstall =
    !installDismissed && !isStandalone && (Boolean(installPrompt) || isAppleMobile());

  if (!updateReady && !canShowInstall && pendingSosCount === 0) return null;

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
