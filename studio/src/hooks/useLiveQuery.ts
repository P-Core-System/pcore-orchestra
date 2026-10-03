import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, wsInvalidationKeys } from "../lib/queryKeys";
import type { WsEvent } from "../lib/api";

/**
 * Live query wiring — architecture §5.
 *
 * Connects to the server's `/api/ws` stream (server → client only) and turns
 * every event into targeted `queryClient.invalidateQueries` calls through
 * `wsInvalidationKeys`. The 5 s `refetchInterval` configured on the
 * QueryClient is the fallback, so a dropped socket still converges.
 *
 * Connection status follows the header indicator contract (spec §2):
 * `connected` (open) → `reconnecting` (socket lost, retry scheduled) →
 * `disconnected` (initial / gave up after unmount).
 */

export type WsStatus = "connected" | "reconnecting" | "disconnected";

const RETRY_MS = 2000;

export function useLiveQuery(): WsStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const setStatusBoth = (next: WsStatus) => {
      if (!alive.current) return;
      setStatus(next);
      queryClient.setQueryData(queryKeys.wsStatus(), next);
    };

    const scheduleRetry = () => {
      if (!alive.current || retryTimer !== null) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, RETRY_MS);
    };

    const connect = () => {
      if (!alive.current) return;
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const socketUrl = `${scheme}://${window.location.host}/api/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(socketUrl);
      } catch {
        setStatusBoth("reconnecting");
        scheduleRetry();
        return;
      }
      socket = ws;

      ws.onopen = () => setStatusBoth("connected");

      ws.onmessage = (message: MessageEvent) => {
        let event: WsEvent | null = null;
        try {
          event = JSON.parse(String(message.data)) as WsEvent;
        } catch {
          return; // a malformed frame must not break the stream
        }
        if (!event || typeof event.type !== "string") return;
        for (const key of wsInvalidationKeys(event)) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      };

      ws.onerror = () => {
        // `onclose` always follows; it owns the retry.
      };

      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (!alive.current) return;
        setStatusBoth("reconnecting");
        scheduleRetry();
      };
    };

    connect();

    return () => {
      alive.current = false;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      // `alive.current === false` blocks every further status write, so the
      // closing socket cannot call setState after the component is gone.
    };
  }, [queryClient]);

  return status;
}
