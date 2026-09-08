import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  getPushPublicKey,
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "@/lib/push/push.functions";

const SW_URL = "/nexa-push-sw.js";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function bufferToBase64Url(buffer: ArrayBuffer | null) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PushState = {
  supported: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  needsInstall: boolean;
  permission: NotificationPermission | "unsupported";
  enabled: boolean;
  busy: boolean;
};

export function usePushNotifications() {
  const publicKeyFn = useServerFn(getPushPublicKey);
  const saveFn = useServerFn(savePushSubscription);
  const removeFn = useServerFn(removePushSubscription);
  const testFn = useServerFn(sendTestPush);

  const [state, setState] = useState<PushState>({
    supported: false,
    isIOS: false,
    isStandalone: false,
    needsInstall: false,
    permission: "unsupported",
    enabled: false,
    busy: false,
  });

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && "ontouchend" in document);
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    let enabled = false;
    if (supported) {
      const registration = await navigator.serviceWorker.getRegistration(SW_URL);
      const subscription = await registration?.pushManager.getSubscription();
      enabled = Boolean(subscription);
    }

    setState((prev) => ({
      ...prev,
      supported,
      isIOS,
      isStandalone,
      needsInstall: isIOS && !isStandalone,
      permission: supported ? Notification.permission : "unsupported",
      enabled,
    }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true }));
    try {
      const { publicKey } = await publicKeyFn();
      if (!publicKey) throw new Error("As chaves de notificação não estão configuradas.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Permissão de notificação negada no aparelho.");
      }

      const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
      await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await saveFn({
        data: {
          endpoint: subscription.endpoint,
          p256dh: bufferToBase64Url(subscription.getKey("p256dh")),
          auth: bufferToBase64Url(subscription.getKey("auth")),
          userAgent: navigator.userAgent,
        },
      });

      await refresh();
      return { ok: true as const };
    } finally {
      setState((prev) => ({ ...prev, busy: false }));
    }
  }, [publicKeyFn, refresh, saveFn]);

  const disable = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true }));
    try {
      const registration = await navigator.serviceWorker.getRegistration(SW_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removeFn({ data: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      await refresh();
    } finally {
      setState((prev) => ({ ...prev, busy: false }));
    }
  }, [refresh, removeFn]);

  const test = useCallback(async () => testFn({ data: undefined }), [testFn]);

  return { ...state, enable, disable, test, refresh };
}
