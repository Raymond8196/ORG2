export interface ReplayProgressSegment {
  id: string;
  startValue: number;
  endValue: number;
  colorIndex: number;
  tooltip: string;
  ariaLabel: string;
  isActive?: boolean;
}
