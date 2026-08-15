// The real web-push sender. Kept apart from the dispatcher so tests inject
// a spy and the decision logic never touches the network.

import webpush from "web-push";
import { env } from "../env";
import type { PushPayload, PushSender } from "./dispatcher";
import type { PushSubscriptionDoc } from "./store";

let configured = false;

export const pushConfigured = (): boolean => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env();
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
};

export const webPushSender: PushSender = async (subscription: PushSubscriptionDoc, payload: PushPayload) => {
  if (!configured) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env();
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      throw new Error("web push is not configured");
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
  await webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: subscription.keys },
    JSON.stringify(payload),
    { TTL: 60 * 60 },
  );
};
