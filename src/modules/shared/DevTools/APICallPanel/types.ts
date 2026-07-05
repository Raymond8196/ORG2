// ============================================
// Type Definitions
// ============================================
import type {
  ApiCall,
  ApiCallHotspot,
  TimerHotspot,
} from "@src/util/monitoring/apiTracker";

export interface APICallPanelProps {
  visible: boolean;
  apiCalls: ApiCall[];
  hotspots: ApiCallHotspot[];
  timerHotspots: TimerHotspot[];
  onClose: () => void;
  onClear: () => void;
}
