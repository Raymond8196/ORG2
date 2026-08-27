/**
 * Icon Name Mapping
 *
 * Maps icon names (lowercase-hyphen format) to Lucide icon components
 * This file has no dependencies to avoid circular imports
 */
import Activity from "@hugeicons/core-free-icons/Activity01Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import Network from "@hugeicons/core-free-icons/AiNetworkIcon";
import BadgeCent from "@hugeicons/core-free-icons/BadgeCentIcon";
import BarChart from "@hugeicons/core-free-icons/BarChartIcon";
import BarChart3 from "@hugeicons/core-free-icons/BarChartIcon";
import Blocks from "@hugeicons/core-free-icons/BlocksIcon";
import BookMarked from "@hugeicons/core-free-icons/BookBookmark01Icon";
import BookOpen from "@hugeicons/core-free-icons/BookOpen01Icon";
import Bot from "@hugeicons/core-free-icons/BotIcon";
import Lightbulb from "@hugeicons/core-free-icons/BulbIcon";
import ChartGantt from "@hugeicons/core-free-icons/ChartGanttIcon";
import ListTodo from "@hugeicons/core-free-icons/CheckListIcon";
import ChevronsLeftRightEllipsis from "@hugeicons/core-free-icons/ChevronsLeftRightEllipsisIcon";
import CircleDollarSign from "@hugeicons/core-free-icons/CircleDollarSignIcon";
import CirclePile from "@hugeicons/core-free-icons/CirclePileIcon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import Coins from "@hugeicons/core-free-icons/Coins01Icon";
import Command from "@hugeicons/core-free-icons/CommandIcon";
import Compass from "@hugeicons/core-free-icons/CompassIcon";
import Terminal from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Database from "@hugeicons/core-free-icons/DatabaseIcon";
import Diff from "@hugeicons/core-free-icons/DiffIcon";
import Folder from "@hugeicons/core-free-icons/Folder01Icon";
import FolderCode from "@hugeicons/core-free-icons/FolderCodeIcon";
import FolderKanban from "@hugeicons/core-free-icons/FolderKanbanIcon";
import Fuel from "@hugeicons/core-free-icons/FuelIcon";
import Globe from "@hugeicons/core-free-icons/GlobeIcon";
import Home from "@hugeicons/core-free-icons/Home01Icon";
import IdCard from "@hugeicons/core-free-icons/IdCardIcon";
import Inbox from "@hugeicons/core-free-icons/InboxIcon";
import InfinityIcon from "@hugeicons/core-free-icons/Infinity01Icon";
import KeyRound from "@hugeicons/core-free-icons/Key02Icon";
import LayoutList from "@hugeicons/core-free-icons/ListViewIcon";
import MapPin from "@hugeicons/core-free-icons/Location01Icon";
import Wand2 from "@hugeicons/core-free-icons/MagicWand02Icon";
import MessageSquare from "@hugeicons/core-free-icons/Message01Icon";
import PackageCheck from "@hugeicons/core-free-icons/PackageDeliveredIcon";
import Box from "@hugeicons/core-free-icons/PackageIcon";
import PlayCircle from "@hugeicons/core-free-icons/PlayCircleIcon";
import Play from "@hugeicons/core-free-icons/PlayIcon";
import Plug from "@hugeicons/core-free-icons/Plug01Icon";
import Radar from "@hugeicons/core-free-icons/Radar01Icon";
import Rocket from "@hugeicons/core-free-icons/RocketIcon";
import Airplay from "@hugeicons/core-free-icons/ScreenRotationIcon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import SearchCode from "@hugeicons/core-free-icons/Search02Icon";
import Server from "@hugeicons/core-free-icons/ServerStack01Icon";
import Settings from "@hugeicons/core-free-icons/Settings01Icon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import Store from "@hugeicons/core-free-icons/Store01Icon";
import Ticket from "@hugeicons/core-free-icons/Ticket01Icon";
import Users from "@hugeicons/core-free-icons/UserMultipleIcon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import History from "@hugeicons/core-free-icons/WorkHistoryIcon";
import Workflow from "@hugeicons/core-free-icons/WorkflowCircle01Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * Maps icon names to their corresponding Lucide components
 * Useful for dynamic icon rendering
 */
export const ICON_NAME_MAP: Record<string, IconSvgElement | null> = {
  folder: Folder,
  "message-square": MessageSquare,
  code: Code,
  "folder-code": FolderCode,
  terminal: Terminal,
  globe: Globe,
  "file-text": BookOpen,
  "book-open": BookOpen,
  "book-marked": BookMarked,
  bot: Bot,
  plus: Plus,
  "plus-circle": Plus,
  play: Play,
  "play-circle": PlayCircle,
  settings: Settings,
  cog: Settings,
  bolt: Settings,
  "bar-chart": BarChart,
  "bar-chart-3": BarChart3,
  server: Server,
  command: Command,
  compass: Compass,
  search: Search,
  "search-code": SearchCode,
  "chart-gantt": ChartGantt,
  box: Box,
  coins: Coins,
  database: Database,
  "git-compare-arrows": Diff,
  diff: Diff,
  history: History,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  ticket: Ticket,
  "key-round": KeyRound,
  "id-card": IdCard,
  infinity: InfinityIcon,
  "layout-list": LayoutList,
  "list-todo": ListTodo,
  "folder-kanban": FolderKanban,
  radar: Radar,
  activity: Activity,
  users: Users,
  kanban: ChartGantt, // Using ChartGantt for kanban
  home: Home,
  inbox: Inbox,
  wallet: Wallet,
  "badge-cent": BadgeCent,
  "circle-dollar-sign": CircleDollarSign,
  blocks: Blocks,
  "package-check": PackageCheck,
  plug: Plug,
  rocket: Rocket,
  "chevrons-left-right-ellipsis": ChevronsLeftRightEllipsis,
  store: Store,
  fuel: Fuel,
  workflow: Workflow,
  "map-pin": MapPin,
  network: Network,
  airplay: Airplay,
  "circle-pile": CirclePile,
  "wand-2": Wand2,
};

/**
 * Get Lucide icon component by name
 */
export function getIconByName(iconName: string): IconSvgElement | null {
  return ICON_NAME_MAP[iconName] ?? null;
}
