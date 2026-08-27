import { createContext, useContext, useState, useCallback } from "react";

interface OutpostComposeState {
  relayUrl: string;
  activeTab: "feed" | "featured" | "topics" | "horizon" | "about";
  triggerCompose: (mode: "note" | "topic") => void;
  canPostHorizon?: boolean;
}

interface OutpostComposeContextType {
  outpostCompose: OutpostComposeState | null;
  registerOutpostCompose: (state: OutpostComposeState) => void;
  unregisterOutpostCompose: () => void;
  horizonDialogOpen: boolean;
  setHorizonDialogOpen: (open: boolean) => void;
}

const OutpostComposeContext = createContext<OutpostComposeContextType>({
  outpostCompose: null,
  registerOutpostCompose: () => {},
  unregisterOutpostCompose: () => {},
  horizonDialogOpen: false,
  setHorizonDialogOpen: () => {},
});

export function useOutpostCompose() {
  return useContext(OutpostComposeContext);
}

export function OutpostComposeProvider({ children }: { children: React.ReactNode }) {
  const [outpostCompose, setOutpostCompose] = useState<OutpostComposeState | null>(null);
  const [horizonDialogOpen, setHorizonDialogOpen] = useState(false);

  const registerOutpostCompose = useCallback((state: OutpostComposeState) => {
    setOutpostCompose(state);
  }, []);

  const unregisterOutpostCompose = useCallback(() => {
    setOutpostCompose(null);
    setHorizonDialogOpen(false);
  }, []);

  return (
    <OutpostComposeContext.Provider value={{ outpostCompose, registerOutpostCompose, unregisterOutpostCompose, horizonDialogOpen, setHorizonDialogOpen }}>
      {children}
    </OutpostComposeContext.Provider>
  );
}
