"use client";

// Push opt-in (SPEC §12): an explicit button, never an on-load permission
// prompt. Hidden entirely when the server has no VAPID keys or the browser
// has no push support.

import { useEffect, useState } from "react";

type Status = "unavailable" | "off" | "on" | "denied" | "working";

const urlBase64ToUint8Array = (base64: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

export default function PushToggle() {
  const [status, setStatus] = useState<Status>("unavailable");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/push").catch(() => null);
      if (!response?.ok || cancelled) return;
      const body = (await response.json()) as { publicKey: string | null; subscribed: boolean };
      if (!body.publicKey || cancelled) return;
      setPublicKey(body.publicKey);
      if (Notification.permission === "denied") setStatus("denied");
      else setStatus(body.subscribed && Notification.permission === "granted" ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async (): Promise<void> => {
    if (!publicKey) return;
    setStatus("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setStatus(response.ok ? "on" : "off");
    } catch {
      setStatus("off");
    }
  };

  const disable = async (): Promise<void> => {
    setStatus("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus("off");
    } catch {
      setStatus("on");
    }
  };

  if (status === "unavailable") return null;
  if (status === "denied") {
    return <p className="text-xs text-muted">Notifications are blocked in your browser settings.</p>;
  }

  return (
    <button
      type="button"
      onClick={() => void (status === "on" ? disable() : enable())}
      disabled={status === "working"}
      aria-pressed={status === "on"}
      className="rounded-md bg-surface px-2 py-1 text-sm outline-offset-2 hover:bg-accent/20 disabled:opacity-50"
    >
      {status === "on" ? "🔔 emergency alerts on" : "🔕 get emergency alerts"}
    </button>
  );
}
