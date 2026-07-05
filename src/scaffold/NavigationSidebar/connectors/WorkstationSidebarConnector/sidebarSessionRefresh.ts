import { useEffect } from "react";

import { loadSidebarSessions } from "@src/store/session";

export function useSidebarSessionRefreshEffects(): void {
  useEffect(() => {
    void loadSidebarSessions({ forceRefresh: true });
  }, []);
}
