import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import type { Database } from "@/integrations/supabase/types";

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

let conversationViewId: string | undefined;
let conversationViewSequence = 0;

export function useConversationPushPresence(conversationId: string | null) {
  const { session } = useAuth();
  const accessToken = session?.access_token;

  useEffect(() => {
    if (!conversationId || !accessToken || !("serviceWorker" in navigator)) return;
    const url = import.meta.env["VITE_SUPABASE_URL"];
    const apiKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !apiKey) return;

    const viewId = (conversationViewId ??= crypto.randomUUID());
    let endpoint: string | undefined;
    let disposed = false;
    let pageHidden = false;
    let warned = false;

    const warn = () => {
      if (warned) return;
      warned = true;
      console.warn("[push] Presença indisponível; os avisos continuam habilitados.");
    };

    const publish = (visible: boolean) => {
      if (!endpoint) return;
      const body: Database["public"]["Functions"]["set_push_conversation_view"]["Args"] = {
        _endpoint: endpoint,
        _view_id: viewId,
        _conversation_id: visible ? conversationId : null,
        _sequence: ++conversationViewSequence,
      };
      void fetch(`${url}/rest/v1/rpc/set_push_conversation_view`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        keepalive: true,
      })
        .then((response) => {
          if (!response.ok) warn();
        })
        .catch(warn);
    };
    const isVisible = () =>
      !disposed && !pageHidden && document.visibilityState === "visible" && document.hasFocus();
    const update = () => publish(isVisible());
    const hide = () => {
      pageHidden = true;
      publish(false);
    };
    const show = () => {
      pageHidden = false;
      update();
    };
    const blur = () => publish(false);

    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", update);

    void navigator.serviceWorker
      .getRegistration(SW_URL)
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => {
        if (disposed || !subscription) return;
        endpoint = subscription.endpoint;
        update();
      })
      .catch(warn);

    const heartbeat = window.setInterval(() => {
      if (isVisible()) publish(true);
    }, 5_000);

    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("online", update);
      publish(false);
    };
  }, [conversationId, accessToken]);
}
