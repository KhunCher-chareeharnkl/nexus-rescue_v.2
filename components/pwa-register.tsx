"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

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
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

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

  const requestInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      return;
    }

    if (isAppleMobile()) setShowIosHelp(true);
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
  const canShowInstall = !isStandalone && (Boolean(installPrompt) || isAppleMobile());

  if (!updateReady && !canShowInstall) return null;

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
      ) : showIosHelp ? (
        <>
          <div>
            <strong>ติดตั้ง Nexus Rescue</strong>
            <span>กดปุ่มแชร์ใน Safari แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”</span>
          </div>
          <button className="pwa-dismiss" type="button" onClick={() => setShowIosHelp(false)} aria-label="ปิด">
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
        </>
      )}
    </aside>
  );
}
