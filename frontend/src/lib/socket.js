import { io } from "socket.io-client";
import { useAuthStore } from "../stores/authStore.js";

let socket = null;

// Lazy singleton. Reconnects with whatever access token is current at the
// moment of connection — sufficient for the live chat + QR use case.
export function getSocket() {
  if (socket && socket.connected) return socket;
  if (socket) return socket;

  const token = useAuthStore.getState().accessToken;
  // VITE_SOCKET_URL: same-origin in dev (proxied), explicit URL in prod
  // when frontend and API are on different hosts (Cloudflare Pages → VPS).
  const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
  socket = io(socketUrl, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on("connect_error", (err) => {
    // Most likely cause: access token expired. Caller can refresh + reconnect.
    console.warn("[socket] connect_error:", err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
