/**
 * The one group-chat call you're in (Concord CORD-07), kept at the app level so
 * it survives moving between rooms and pages. This file is the small,
 * always-loaded part: the context, its shape and the hook. The engine
 * (concord-call-engine.tsx — session, presence, keys, the floating bar) is a
 * separate chunk that loads only once someone is signed in and pushes its
 * value here, so the app tree never remounts on sign-in and a visitor never
 * downloads the group-chat library.
 */
import { createContext, useCallback, useContext, useState, lazy, Suspense, type ReactNode } from "react";
import type { Room } from "livekit-client";
import type { StoredChannel, StoredCommunity } from "@/lib/concord/concord-keys";
import type { CallerLabel } from "@/lib/concord/concord-call";
import { useNostrAuth } from "@/contexts/NostrAuthContext";

export interface CallParticipant {
  identity: string;
  label: CallerLabel;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
}

export interface ActiveCall {
  communityId: string;
  channelId: string;
  title: string;
  participants: CallParticipant[];
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /** The LiveKit room, for the stage to attach video. */
  room: Room;
}

export interface CallCtx {
  call: ActiveCall | null;
  joining: boolean;
  error: string | null;
  join(community: StoredCommunity, channel: StoredChannel, title: string): Promise<void>;
  leave(): Promise<void>;
  toggleMic(): Promise<void>;
  toggleCamera(): Promise<void>;
  toggleScreen(): Promise<void>;
  /** A room screen says which room it's showing, so the floating bar hides there. */
  setOnScreen(key: string | null): void;
}

export const callRoomKey = (communityId: string, channelId: string) => `${communityId}:${channelId}`;



const noop = async () => {};
const EMPTY: CallCtx = {
  call: null, joining: false, error: null,
  join: noop, leave: noop, toggleMic: noop, toggleCamera: noop, toggleScreen: noop, setOnScreen: () => {},
};
const Ctx = createContext<CallCtx>(EMPTY);
export const useConcordCall = () => useContext(Ctx);

const ConcordCallEngine = lazy(() => import("./concord-call-engine"));

export function ConcordCallProvider({ children }: { children: ReactNode }) {
  const { pubkey } = useNostrAuth();
  const [value, setValue] = useState<CallCtx>(EMPTY);
  const onChange = useCallback((next: CallCtx) => setValue(next), []);
  return (
    <Ctx.Provider value={pubkey ? value : EMPTY}>
      {pubkey && (
        <Suspense fallback={null}>
          <ConcordCallEngine onChange={onChange} />
        </Suspense>
      )}
      {children}
    </Ctx.Provider>
  );
}
