type StopCallback = () => void;

let activeSources: Map<string, StopCallback> = new Map();

function setMediaSessionState(state: "playing" | "paused" | "none") {
  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  } catch {}
}

export function registerAudioSource(id: string, stopFn: StopCallback) {
  for (const [key, stop] of activeSources) {
    if (key !== id) {
      stop();
      activeSources.delete(key);
    }
  }
  activeSources.set(id, stopFn);
  setMediaSessionState("playing");
}

export function unregisterAudioSource(id: string) {
  activeSources.delete(id);
  if (activeSources.size === 0) {
    setMediaSessionState("paused");
  }
}

export function stopAllAudio(exceptId?: string) {
  for (const [key, stop] of activeSources) {
    if (key !== exceptId) {
      stop();
      activeSources.delete(key);
    }
  }
  if (activeSources.size === 0) {
    setMediaSessionState("paused");
  }
}
