# Hugeicons migration — icon mapping

Generated from `@hugeicons/core-free-icons@4.3.0` (6,025 icons) against the
425 distinct `lucide-react@0.563.0` icons used in `src/`.

**Every target in this document was validated to exist** as a real module at
`@hugeicons/core-free-icons/dist/esm/<Target>.js`. Nothing here is guessed from
the icon browser.

## How to read this

Each row maps a lucide identifier to a **canonical hugeicons file name**. Use
the canonical name in a deep import:

```ts
import Search from "@hugeicons/core-free-icons/Search01Icon";
```

Deep imports are the house style for this migration. The barrel
(`@hugeicons/core-free-icons`) also re-exports 315 of these under their original
lucide names, but the barrel is 672 KB across 14,716 exports and webpack parses
all of it before discarding it. Deep imports skip that entirely.

## API change

Hugeicons ships icons as **data**, not components. Every call site changes shape:

```diff
-import { Search } from "lucide-react";
-<Search size={16} className="text-text-3" />
+import { HugeiconsIcon } from "@hugeicons/react";
+import Search from "@hugeicons/core-free-icons/Search01Icon";
+<HugeiconsIcon icon={Search} size={16} className="text-text-3" />
```

`HugeiconsIcon` forwards `className`, `ref`, and all SVG props, and accepts
`size`, `strokeWidth`, `absoluteStrokeWidth`, `color`.

## Counts

| category | icons | meaning |
|---|---:|---|
| Vendor alias | 402 | hugeicons' own barrel already maps the lucide name; the mapping is the vendor's choice, not ours |
| Manual | 22 | no vendor alias; resolved by hand against the export list |
| — of which flagged `REVIEW` | 5 | defensible but visually imperfect; needs a human look |
| Hand-port | 1 | `createLucideIcon` — a custom glyph, no equivalent |
| **Total** | **425** | |

## Known behavioral differences

These apply repo-wide and are **not** captured per-row.

1. **Stroke weight — the app ships at hugeicons' native 1.5.** Lucide defaulted
   to `strokeWidth={2}`; hugeicons bakes `1.5` into its path data and overrides
   it only when `strokeWidth` is passed. **This was a deliberate decision**: the
   app is intentionally lighter than it was under lucide. Do not "fix" it by
   adding `strokeWidth={2}` to new call sites.

   The 215 explicit `strokeWidth` values that pre-dated the migration are
   preserved exactly, including the 414 sites at `1.75` — which is this repo's
   actual house weight — and the outliers at `1.8`, `1.9`, `2.25`, and `0`
   (the solid media controls).
2. **Same name, different drawing.** A vendor alias means the *name* matches,
   not the artwork. Hugeicons `Cancel01Icon` (lucide `X`) is a 2-stroke cross;
   the separate `XIcon` file is a 4-ray cross. Name parity is not visual parity.
3. **No filled variants — but nothing in this repo needed them.** The free tier
   is Stroke Rounded only. An earlier draft of this document claimed the status
   indicators (`CheckCircle2`, `XCircle`, `CircleDot`, `Circle`) would regress
   to outlines. That was wrong: lucide's own `CheckCircle2` is two stroke paths
   with no fill, and **zero** of those call sites passed `fill`. They were
   already outlines. There is no regression and no reason to buy Pro over this.
4. **`fill="currentColor"` still works.** Eleven sites use it; three are
   hand-authored SVGs unrelated to lucide (`PanelIcons`, `AppMark`, a Gantt
   arrowhead). The remaining seven are solid media controls —
   `<Play|Pause|Square fill="currentColor" strokeWidth={0} />` — and they render
   correctly under hugeicons: `HugeiconsIcon` forwards `fill` to the `<svg>`
   (overriding its `fill: none` default) and applies `strokeWidth={0}`, and the
   `PlayIcon` / `PauseIcon` / `SquareIcon` glyphs are closed paths, so they fill
   solid. Verified by server-rendering the component, not by inspection.
5. **Icon identity in the DOM (`data-icon`).** Lucide stamped
   `class="lucide lucide-chevron-down"` onto every icon it rendered, and about
   fifty assertions across the unit suite plus four e2e selectors came to rely
   on it. `HugeiconsIcon` stamps nothing. Rather than delete those assertions,
   every static call site now carries `data-icon="<kebab-name>"`, applied by
   `scripts/hugeicons/stamp-data-icon.mjs`. It is one attribute where lucide
   wrote two classes, so the rendered DOM is lighter than before.

   **Keep new call sites consistent**: when you add an icon that a test needs to
   identify, add `data-icon`. Dynamic sites (`icon={item.icon}`) have no name
   available and are deliberately left unstamped — pass one explicitly if a test
   needs to distinguish them.

6. **Glyph data is a valid `ReactNode`.** This is the sharpest edge in the whole
   migration. `IconSvgElement` is a nested array, and arrays satisfy
   `ReactNode`, so any prop typed `icon: ReactNode` accepts glyph data and
   **typechecks clean** — then React throws
   `Element type is invalid ... but got: object` at runtime. A green
   `tsc --noEmit` does not prove icon rendering is correct here; the unit suite
   does. Two forms of this shipped past the typechecker during the migration:
   `createElement(Glyph, props)` (103 sites) and
   `const Icon = config.icon; <Icon />` (5 sites).

7. **`LucideIcon` type.** 227 references across 89 files type icons as React
   *components*. Under hugeicons they are `IconSvgElement` *data*, so every
   registry (`config/toolIcons.tsx`, `config/iconMapping.ts`,
   `config/agentIcons.tsx`, `components/PanelIcons.tsx`,
   `NavigationSidebar/utils/renderIcon.tsx`) and all of its consumers change.

## Deliberate design overrides

Chosen by eye after seeing them rendered, overriding what the vendor alias
table produced.

| concept | lucide name | hugeicons | scope |
|---|---|---|---:|
| Branch | `GitBranch` | `WorkflowCircle05Icon` | 38 sites |
| Refresh | `RefreshCw` | `Refresh04Icon` | 85 sites |
| Maximize | `Maximize2`, `Maximize` | `ArrowExpand01Icon` | 14 sites |
| Minimize | `Minimize2` | `ArrowShrink01Icon` | 7 sites |
| Folder | `Folder` | `FolderClosedIcon` | 27 sites |
| Sidebar filter | `ListFilter` | `FilterMailIcon` | 2 sites (sidebar only) |
| New session | (was `Plus`) | `MessageAdd02Icon` | 1 site |
| Composer send | (was `ArrowUp01Icon`) | `MoveUpIcon` | 1 site |

Deliberately NOT swept with the above, to avoid collateral changes:

- `GitBranchPlus` / `GitBranchMinus` keep the git-branch family — they mean
  add/remove-branch and the workflow mark has no compound variant.
- `Plus` (83 sites) and `ArrowUp` (19 sites) keep their generic glyphs; only
  the new-session entry and the composer send button were retargeted.
- `Filter` / `FilterIcon` outside the sidebar (15 sites) keep `FilterIcon`.

## Rows flagged REVIEW

| lucide | uses | hugeicons | note |
|---|---:|---|---|
| `Chromium` | 7 | `ChromeIcon` | REVIEW: brand substitution, Chromium has no distinct glyph |
| `ListChevronsUpDown` | 7 | `ListChevronsDownUpIcon` | REVIEW: only list-chevron variant; vertical order is inverted |
| `ArrowRightLeft` | 4 | `ArrowLeftRightIcon` | REVIEW: arrow order differs from lucide |
| `FileJson` | 1 | `FileCodeIcon` | REVIEW: no JSON-specific glyph in free set |
| `PictureInPicture2` | 1 | `PictureInPicture01Icon` | REVIEW: no '02' variant exists |

## Hand-port

| lucide | uses | hugeicons | note |
|---|---:|---|---|
| `createLucideIcon` | 1 | `—` | custom icon factory - hand-port to a raw IconSvgElement array |

Defined at `src/scaffold/GlobalSpotlight/hooks/features/spotlightActionDefinitions.navigation.ts:47`
as `ALL_SESSIONS_SEARCH_ICON`. Port the path data into a raw `IconSvgElement`
array — the same `[[tag, attrs], ...]` shape hugeicons uses.

## Manual mappings (no vendor alias)

| lucide | uses | hugeicons | note |
|---|---:|---|---|
| `Loader2` | 52 | `Loading03Icon` | vendor maps LoaderCircle->Loading03Icon; lucide renamed Loader2->LoaderCircle upstream |
| `CheckCircle2` | 42 | `CheckmarkCircle01Icon` | vendor maps CircleCheck/CheckCircle here; lucide renamed CheckCircle2->CircleCheck |
| `Code2` | 9 | `CodeIcon` | vendor maps Code and CodeXml both here |
| `FolderGit2` | 8 | `FolderGitTwoIcon` | direct '2' analogue exists |
| `Chromium` | 7 | `ChromeIcon` | REVIEW: brand substitution, Chromium has no distinct glyph |
| `ListChevronsUpDown` | 7 | `ListChevronsDownUpIcon` | REVIEW: only list-chevron variant; vertical order is inverted |
| `CircleHelp` | 5 | `HelpCircleIcon` | file exists; not aliased in barrel |
| `ArrowRightLeft` | 4 | `ArrowLeftRightIcon` | REVIEW: arrow order differs from lucide |
| `TerminalSquare` | 4 | `SquareTerminalIcon` | file exists; not aliased in barrel |
| `Link2Off` | 3 | `Unlink02Icon` | consistent with Link2->Link02Icon numbering |
| `BarChart3` | 2 | `BarChartIcon` | vendor maps BarChart and ChartBar both here |
| `ArrowUpRightFromSquare` | 1 | `SquareArrowOutUpRightIcon` | file exists; not aliased in barrel |
| `CircleSlash2` | 1 | `CircleSlashTwoIcon` | direct '2' analogue |
| `Edit2` | 1 | `Edit02Icon` | direct numbered analogue |
| `FileCode2` | 1 | `FileCodeIcon` | direct match |
| `FileJson` | 1 | `FileCodeIcon` | REVIEW: no JSON-specific glyph in free set |
| `FilePlus2` | 1 | `FileAddIcon` | vendor maps FilePlus->FileAddIcon |
| `GanttChart` | 1 | `ChartGanttIcon` | exact semantic match |
| `Globe2` | 1 | `Globe02Icon` | direct numbered analogue |
| `MessageCircleQuestion` | 1 | `MessageCircleQuestionMarkIcon` | exact semantic match |
| `PictureInPicture2` | 1 | `PictureInPicture01Icon` | REVIEW: no '02' variant exists |
| `Wand2` | 1 | `MagicWand02Icon` | vendor maps Wand->MagicWand01Icon; '2' analogue |

## Vendor-alias mappings

Resolved from hugeicons' own barrel re-exports. Listed most-used first.

| lucide | uses | hugeicons | note |
|---|---:|---|---|
| `X` | 101 | `Cancel01Icon` |  |
| `ChevronRight` | 93 | `ArrowRight01Icon` |  |
| `RefreshCw` | 87 | `RefreshIcon` |  |
| `Plus` | 83 | `Add01Icon` |  |
| `Check` | 77 | `Tick01Icon` |  |
| `ChevronDown` | 70 | `ArrowDown01Icon` |  |
| `Search` | 67 | `Search01Icon` |  |
| `Trash2` | 55 | `Delete02Icon` |  |
| `SquareArrowOutUpRight` | 43 | `SquareArrowOutUpRightIcon` |  |
| `Copy` | 39 | `Copy01Icon` |  |
| `GitBranch` | 38 | `GitBranchIcon` |  |
| `Code` | 29 | `CodeIcon` |  |
| `XCircle` | 29 | `CancelCircleIcon` |  |
| `Circle` | 27 | `CircleIcon` |  |
| `Folder` | 27 | `Folder01Icon` |  |
| `Terminal` | 27 | `ComputerTerminal01Icon` |  |
| `CircleDot` | 26 | `CircleIcon` |  |
| `GitPullRequest` | 26 | `GitPullRequestIcon` |  |
| `Globe` | 26 | `GlobeIcon` |  |
| `Clock` | 23 | `Clock01Icon` |  |
| `Pencil` | 23 | `Pen01Icon` |  |
| `ChevronLeft` | 22 | `ArrowLeft01Icon` |  |
| `Box` | 21 | `PackageIcon` |  |
| `ChevronsUpDown` | 21 | `ArrowUpDownIcon` |  |
| `ListChecks` | 21 | `CheckListIcon` |  |
| `ArrowLeft` | 20 | `ArrowLeft01Icon` |  |
| `MoreHorizontal` | 20 | `MoreHorizontalIcon` |  |
| `User` | 20 | `UserIcon` |  |
| `Users` | 20 | `UserMultipleIcon` |  |
| `ArrowUp` | 19 | `ArrowUp01Icon` |  |
| `Info` | 19 | `InformationCircleIcon` |  |
| `ListTodo` | 19 | `CheckListIcon` |  |
| `Lock` | 19 | `LockIcon` |  |
| `Minus` | 19 | `MinusSignIcon` |  |
| `Play` | 19 | `PlayIcon` |  |
| `AlertCircle` | 18 | `AlertCircleIcon` |  |
| `ChevronsDownUp` | 18 | `ChevronsDownUpIcon` |  |
| `FolderOpen` | 18 | `FolderOpenIcon` |  |
| `AlertTriangle` | 17 | `Alert01Icon` |  |
| `ArrowRight` | 17 | `ArrowRight01Icon` |  |
| `Sparkles` | 17 | `SparklesIcon` |  |
| `Network` | 16 | `AiNetworkIcon` |  |
| `Bot` | 15 | `BotIcon` |  |
| `Cloud` | 15 | `CloudIcon` |  |
| `Hash` | 15 | `HashtagIcon` |  |
| `Infinity` | 15 | `Infinity01Icon` |  |
| `MessageSquare` | 15 | `Message01Icon` |  |
| `FileText` | 14 | `File02Icon` |  |
| `GitMerge` | 14 | `GitMergeIcon` |  |
| `Inbox` | 14 | `InboxIcon` |  |
| `Layout` | 14 | `Layout01Icon` |  |
| `MessageCircle` | 14 | `BubbleChatIcon` |  |
| `RotateCcw` | 14 | `RotateLeft01Icon` |  |
| `Settings` | 14 | `Settings01Icon` |  |
| `ArrowDown` | 13 | `ArrowDown01Icon` |  |
| `BookOpen` | 13 | `BookOpen01Icon` |  |
| `Eye` | 13 | `ViewIcon` |  |
| `Filter` | 13 | `FilterIcon` |  |
| `Layers` | 13 | `Layers01Icon` |  |
| `Maximize2` | 13 | `Maximize02Icon` |  |
| `Calendar` | 11 | `Calendar01Icon` |  |
| `Download` | 11 | `Download01Icon` |  |
| `GitCommitHorizontal` | 11 | `GitCommitIcon` |  |
| `Laptop` | 11 | `LaptopIcon` |  |
| `List` | 11 | `ListViewIcon` |  |
| `LogIn` | 11 | `Login01Icon` |  |
| `Zap` | 11 | `FlashIcon` |  |
| `ChevronUp` | 10 | `ArrowUp01Icon` |  |
| `FileDiff` | 10 | `FileDiffIcon` |  |
| `FolderKanban` | 10 | `FolderKanbanIcon` |  |
| `History` | 10 | `WorkHistoryIcon` |  |
| `Keyboard` | 10 | `KeyboardIcon` |  |
| `Link2` | 10 | `Link02Icon` |  |
| `ListChevronsDownUp` | 10 | `ListChevronsDownUpIcon` |  |
| `MessagesSquare` | 10 | `MessageMultiple01Icon` |  |
| `Archive` | 9 | `ArchiveIcon` |  |
| `Brain` | 9 | `BrainIcon` |  |
| `Chrome` | 9 | `ChromeIcon` |  |
| `Database` | 9 | `DatabaseIcon` |  |
| `KeyRound` | 9 | `Key02Icon` |  |
| `ScanSearch` | 9 | `SearchAreaIcon` |  |
| `CheckCircle` | 8 | `CheckmarkCircle01Icon` |  |
| `Ellipsis` | 8 | `MoreHorizontalIcon` |  |
| `GitFork` | 8 | `GitForkIcon` |  |
| `GitPullRequestDraft` | 8 | `GitPullRequestDraftIcon` |  |
| `Grip` | 8 | `Drag01Icon` |  |
| `Monitor` | 8 | `ComputerIcon` |  |
| `Square` | 8 | `SquareIcon` |  |
| `Undo2` | 8 | `Undo02Icon` |  |
| `Wrench` | 8 | `Wrench01Icon` |  |
| `AtSign` | 7 | `AtIcon` |  |
| `Braces` | 7 | `FirstBracketIcon` |  |
| `CircleSlash` | 7 | `CircleSlashIcon` |  |
| `Diff` | 7 | `DiffIcon` |  |
| `File` | 7 | `File01Icon` |  |
| `Flag` | 7 | `Flag01Icon` |  |
| `Gauge` | 7 | `GaugeIcon` |  |
| `GitPullRequestClosed` | 7 | `GitPullRequestClosedIcon` |  |
| `LayoutGrid` | 7 | `LayoutGridIcon` |  |
| `LayoutList` | 7 | `ListViewIcon` |  |
| `Minimize2` | 7 | `Minimize02Icon` |  |
| `MousePointer2` | 7 | `Cursor02Icon` |  |
| `Pin` | 7 | `PinIcon` |  |
| `PlayCircle` | 7 | `PlayCircleIcon` |  |
| `Rocket` | 7 | `RocketIcon` |  |
| `Tag` | 7 | `Tag01Icon` |  |
| `ArrowLeftRight` | 6 | `ArrowLeftRightIcon` |  |
| `CalendarClock` | 6 | `TimeScheduleIcon` |  |
| `ChevronsRight` | 6 | `ArrowRightDoubleIcon` |  |
| `Clipboard` | 6 | `ClipboardIcon` |  |
| `ClipboardList` | 6 | `CheckListIcon` |  |
| `FolderPlus` | 6 | `FolderAddIcon` |  |
| `FolderTree` | 6 | `FolderTreeIcon` |  |
| `ListTree` | 6 | `HierarchyFilesIcon` |  |
| `Pause` | 6 | `PauseIcon` |  |
| `SquarePen` | 6 | `PencilEdit02Icon` |  |
| `Activity` | 5 | `Activity01Icon` |  |
| `Boxes` | 5 | `Package01Icon` |  |
| `Building2` | 5 | `Building02Icon` |  |
| `CloudUpload` | 5 | `CloudUploadIcon` |  |
| `Columns3` | 5 | `LayoutThreeColumnIcon` |  |
| `Compass` | 5 | `CompassIcon` |  |
| `FileCode` | 5 | `FileScriptIcon` |  |
| `FileSymlink` | 5 | `FileSymlinkIcon` |  |
| `FolderSearch` | 5 | `FolderSearchIcon` |  |
| `Image` | 5 | `Image01Icon` |  |
| `Key` | 5 | `Key01Icon` |  |
| `Link` | 5 | `Link01Icon` |  |
| `Mail` | 5 | `Mail01Icon` |  |
| `Palette` | 5 | `ColorPickerIcon` |  |
| `PanelLeft` | 5 | `PanelLeftIcon` |  |
| `PanelRight` | 5 | `PanelRightIcon` |  |
| `Repeat` | 5 | `RepeatIcon` |  |
| `Save` | 5 | `FloppyDiskIcon` |  |
| `Server` | 5 | `ServerStack01Icon` |  |
| `Settings2` | 5 | `Settings02Icon` |  |
| `Shield` | 5 | `Shield01Icon` |  |
| `ShieldCheck` | 5 | `SecurityCheckIcon` |  |
| `Split` | 5 | `SplitIcon` |  |
| `SquareTerminal` | 5 | `SquareTerminalIcon` |  |
| `UserRound` | 5 | `UserCircleIcon` |  |
| `ArchiveRestore` | 4 | `ArchiveArrowUpIcon` |  |
| `ArrowUpFromLine` | 4 | `ArrowUpFromLineIcon` |  |
| `ArrowUpRight` | 4 | `ArrowUpRight01Icon` |  |
| `BellOff` | 4 | `NotificationOff01Icon` |  |
| `BrushCleaning` | 4 | `BrushCleaningIcon` |  |
| `CaseSensitive` | 4 | `TextIcon` |  |
| `CheckCheck` | 4 | `TickDouble01Icon` |  |
| `ChevronsLeftRightEllipsis` | 4 | `ChevronsLeftRightEllipsisIcon` |  |
| `CircleDashed` | 4 | `CircleIcon` |  |
| `Command` | 4 | `CommandIcon` |  |
| `DraftingCompass` | 4 | `DraftingCompassIcon` |  |
| `Github` | 4 | `GithubIcon` |  |
| `HatGlasses` | 4 | `HatGlassesIcon` |  |
| `Home` | 4 | `Home01Icon` |  |
| `ListFilter` | 4 | `FilterIcon` |  |
| `LoaderCircle` | 4 | `Loading03Icon` |  |
| `Moon` | 4 | `MoonIcon` |  |
| `MousePointerClick` | 4 | `CursorPointer02Icon` |  |
| `PenTool` | 4 | `PenTool01Icon` |  |
| `PinOff` | 4 | `PinOffIcon` |  |
| `Tags` | 4 | `TagsIcon` |  |
| `TriangleAlert` | 4 | `TriangleAlertIcon` |  |
| `UserPlus` | 4 | `UserAdd01Icon` |  |
| `Airplay` | 3 | `ScreenRotationIcon` |  |
| `AppWindow` | 3 | `AppWindowIcon` |  |
| `ArrowDownToLine` | 3 | `ArrowDownToLineIcon` |  |
| `BellRing` | 3 | `NotificationBubbleIcon` |  |
| `Briefcase` | 3 | `Briefcase01Icon` |  |
| `BriefcaseBusiness` | 3 | `Briefcase02Icon` |  |
| `ClipboardCopy` | 3 | `Copy01Icon` |  |
| `CornerDownRight` | 3 | `ArrowTurnDownIcon` |  |
| `Cpu` | 3 | `CpuIcon` |  |
| `EyeOff` | 3 | `ViewOffIcon` |  |
| `Fingerprint` | 3 | `FingerPrintIcon` |  |
| `FlaskConical` | 3 | `TestTubeIcon` |  |
| `FolderOutput` | 3 | `FolderOutputIcon` |  |
| `GitCommit` | 3 | `GitCommitIcon` |  |
| `HelpCircle` | 3 | `HelpCircleIcon` |  |
| `ImageIcon` | 3 | `Image01Icon` |  |
| `Import` | 3 | `ImportIcon` |  |
| `Milestone` | 3 | `RoadLocation01Icon` |  |
| `Package` | 3 | `PackageIcon` |  |
| `Power` | 3 | `PowerServiceIcon` |  |
| `Send` | 3 | `MailSend01Icon` |  |
| `Share2` | 3 | `Share02Icon` |  |
| `ShieldOff` | 3 | `Shield02Icon` |  |
| `Timer` | 3 | `Timer01Icon` |  |
| `Toolbox` | 3 | `ToolboxIcon` |  |
| `Unplug` | 3 | `UnplugIcon` |  |
| `ZoomIn` | 3 | `ZoomInAreaIcon` |  |
| `ZoomOut` | 3 | `ZoomOutAreaIcon` |  |
| `ArrowBigUp` | 2 | `ArrowUpBigIcon` |  |
| `ArrowDownFromLine` | 2 | `ArrowDownFromLineIcon` |  |
| `ArrowUpDown` | 2 | `ArrowUpDownIcon` |  |
| `BadgeCent` | 2 | `BadgeCentIcon` |  |
| `Bell` | 2 | `Notification01Icon` |  |
| `Blocks` | 2 | `BlocksIcon` |  |
| `Book` | 2 | `Book01Icon` |  |
| `BookDashed` | 2 | `Book02Icon` |  |
| `Bug` | 2 | `Bug01Icon` |  |
| `CalendarArrowUp` | 2 | `CalendarArrowUpIcon` |  |
| `CalendarDays` | 2 | `Calendar02Icon` |  |
| `ChevronsLeft` | 2 | `ArrowLeftDoubleIcon` |  |
| `ClipboardCheck` | 2 | `ClipboardIcon` |  |
| `ClockArrowDown` | 2 | `Time02Icon` |  |
| `ClockArrowUp` | 2 | `Time02Icon` |  |
| `CloudAlert` | 2 | `CloudAlertIcon` |  |
| `CloudOff` | 2 | `CloudLoadingIcon` |  |
| `Coffee` | 2 | `Coffee01Icon` |  |
| `Cog` | 2 | `Settings01Icon` |  |
| `Contrast` | 2 | `ContrastIcon` |  |
| `CornerDownLeft` | 2 | `ArrowTurnDownIcon` |  |
| `Delete` | 2 | `Delete01Icon` |  |
| `Diamond` | 2 | `DiamondIcon` |  |
| `Dock` | 2 | `DockIcon` |  |
| `Expand` | 2 | `ArrowExpand01Icon` |  |
| `FileEdit` | 2 | `FileEditIcon` |  |
| `FilePenLine` | 2 | `FilePenLineIcon` |  |
| `FilePlus` | 2 | `FileAddIcon` |  |
| `FileSearch` | 2 | `FileSearchIcon` |  |
| `Focus` | 2 | `CenterFocusIcon` |  |
| `FoldVertical` | 2 | `FoldVerticalIcon` |  |
| `FolderCog` | 2 | `FolderCogIcon` |  |
| `FolderInput` | 2 | `FolderInputIcon` |  |
| `FunctionSquare` | 2 | `FunctionSquareIcon` |  |
| `Funnel` | 2 | `FunnelIcon` |  |
| `GitBranchMinus` | 2 | `GitBranchMinusIcon` |  |
| `GitBranchPlus` | 2 | `GitBranchIcon` |  |
| `GitCommitVertical` | 2 | `GitCommitIcon` |  |
| `GitCompareArrows` | 2 | `GitCompareIcon` |  |
| `GripVertical` | 2 | `Drag01Icon` |  |
| `ImageOff` | 2 | `ImageNotFound01Icon` |  |
| `LayoutDashboard` | 2 | `DashboardSquare01Icon` |  |
| `Lightbulb` | 2 | `BulbIcon` |  |
| `Loader` | 2 | `Loading01Icon` |  |
| `Map` | 2 | `MapsIcon` |  |
| `MapPin` | 2 | `Location01Icon` |  |
| `MessageCircleMore` | 2 | `MessageCircleMoreIcon` |  |
| `MessageCircleQuestionMark` | 2 | `MessageCircleQuestionMarkIcon` |  |
| `MessageSquareMore` | 2 | `MessageSquareMoreIcon` |  |
| `MessageSquarePlus` | 2 | `MessageAdd01Icon` |  |
| `MessageSquareText` | 2 | `Message02Icon` |  |
| `MonitorCog` | 2 | `ComputerSettingsIcon` |  |
| `MoveVertical` | 2 | `MoveTopIcon` |  |
| `Option` | 2 | `OptionIcon` |  |
| `PackageCheck` | 2 | `PackageDeliveredIcon` |  |
| `PanelBottom` | 2 | `SidebarBottomIcon` |  |
| `PanelRightOpen` | 2 | `PanelRightOpenIcon` |  |
| `PencilRuler` | 2 | `PencilRulerIcon` |  |
| `Phone` | 2 | `SmartPhone01Icon` |  |
| `Plug` | 2 | `Plug01Icon` |  |
| `Radar` | 2 | `Radar01Icon` |  |
| `Regex` | 2 | `TextIcon` |  |
| `SlidersHorizontal` | 2 | `SlidersHorizontalIcon` |  |
| `SquareArrowRight` | 2 | `SquareArrowRight01Icon` |  |
| `Star` | 2 | `StarIcon` |  |
| `Store` | 2 | `Store01Icon` |  |
| `Type` | 2 | `TextIcon` |  |
| `UserRoundCog` | 2 | `UserRoundCogIcon` |  |
| `Variable` | 2 | `VariableIcon` |  |
| `Wallet` | 2 | `Wallet01Icon` |  |
| `WholeWord` | 2 | `TextIcon` |  |
| `Wifi` | 2 | `Wifi01Icon` |  |
| `Workflow` | 2 | `WorkflowCircle01Icon` |  |
| `AlignHorizontalSpaceAround` | 1 | `AlignHorizontalSpaceAroundIcon` |  |
| `AlignLeft` | 1 | `TextAlignLeftIcon` |  |
| `AlignVerticalSpaceAround` | 1 | `AlignVerticalSpaceAroundIcon` |  |
| `Anchor` | 1 | `AnchorIcon` |  |
| `ArrowBigLeft` | 1 | `ArrowLeftBigIcon` |  |
| `ArrowBigRight` | 1 | `ArrowRightBigIcon` |  |
| `ArrowBigRightDash` | 1 | `ArrowBigRightDashIcon` |  |
| `ArrowDown10` | 1 | `ArrangeByNumbersOneNineIcon` |  |
| `ArrowDownAZ` | 1 | `ArrangeByLettersZAIcon` |  |
| `ArrowDownToDot` | 1 | `ArrowDownToDotIcon` |  |
| `ArrowUpFromDot` | 1 | `ArrowUpFromDotIcon` |  |
| `Award` | 1 | `Award01Icon` |  |
| `Ban` | 1 | `BanIcon` |  |
| `BarChart` | 1 | `BarChartIcon` |  |
| `Blend` | 1 | `BlendIcon` |  |
| `Bold` | 1 | `TextBoldIcon` |  |
| `BookMarked` | 1 | `BookBookmark01Icon` |  |
| `BookSearch` | 1 | `Book01Icon` |  |
| `BotMessageSquare` | 1 | `ChatBotIcon` |  |
| `BotOff` | 1 | `BotOffIcon` |  |
| `Cable` | 1 | `UsbIcon` |  |
| `CalendarOff` | 1 | `CalendarBlock01Icon` |  |
| `CalendarX` | 1 | `CalendarRemove01Icon` |  |
| `Camera` | 1 | `Camera01Icon` |  |
| `Captions` | 1 | `CaptionsIcon` |  |
| `ChartColumn` | 1 | `BarChartIcon` |  |
| `ChartGantt` | 1 | `ChartGanttIcon` |  |
| `ChartNoAxesGantt` | 1 | `ChartNoAxesGanttIcon` |  |
| `CheckSquare` | 1 | `CheckmarkSquare01Icon` |  |
| `CircleArrowOutUpRight` | 1 | `CircleArrowOutUpRightIcon` |  |
| `CircleArrowUp` | 1 | `CircleArrowUp01Icon` |  |
| `CircleCheck` | 1 | `CheckmarkCircle01Icon` |  |
| `CircleDollarSign` | 1 | `CircleDollarSignIcon` |  |
| `CircleDotDashed` | 1 | `CircleDotDashedIcon` |  |
| `CircleMinus` | 1 | `MinusSignCircleIcon` |  |
| `CirclePile` | 1 | `CirclePileIcon` |  |
| `CircleX` | 1 | `CancelCircleIcon` |  |
| `ClipboardPen` | 1 | `ClipboardPenIcon` |  |
| `Clock3` | 1 | `Clock03Icon` |  |
| `CloudDownload` | 1 | `CloudDownloadIcon` |  |
| `Coins` | 1 | `Coins01Icon` |  |
| `Computer` | 1 | `ComputerIcon` |  |
| `CopyCheck` | 1 | `Copy02Icon` |  |
| `CopyPlus` | 1 | `Copy01Icon` |  |
| `CopyX` | 1 | `Copy01Icon` |  |
| `CornerUpLeft` | 1 | `ArrowTurnUpIcon` |  |
| `CreditCard` | 1 | `CreditCardIcon` |  |
| `Crosshair` | 1 | `Target01Icon` |  |
| `Eclipse` | 1 | `EclipseIcon` |  |
| `Edit` | 1 | `Edit01Icon` |  |
| `ExternalLink` | 1 | `ArrowUpRight01Icon` |  |
| `Feather` | 1 | `FeatherIcon` |  |
| `FileBox` | 1 | `FileBoxIcon` |  |
| `FilePen` | 1 | `FilePenIcon` |  |
| `Files` | 1 | `Files01Icon` |  |
| `Flame` | 1 | `FireIcon` |  |
| `FolderCode` | 1 | `FolderCodeIcon` |  |
| `FolderMinus` | 1 | `FolderMinusIcon` |  |
| `FolderSymlink` | 1 | `FolderSymlinkIcon` |  |
| `Fuel` | 1 | `FuelIcon` |  |
| `Fullscreen` | 1 | `FullScreenIcon` |  |
| `GalleryThumbnails` | 1 | `GalleryThumbnailsIcon` |  |
| `Hammer` | 1 | `LegalHammerIcon` |  |
| `HandMetal` | 1 | `Shaka01Icon` |  |
| `Heading2` | 1 | `Heading02Icon` |  |
| `Headphones` | 1 | `HeadphonesIcon` |  |
| `Heart` | 1 | `FavouriteIcon` |  |
| `HeartPulse` | 1 | `Cardiogram01Icon` |  |
| `Hexagon` | 1 | `HexagonIcon` |  |
| `IdCard` | 1 | `IdCardIcon` |  |
| `Italic` | 1 | `TextItalicIcon` |  |
| `Languages` | 1 | `LanguageCircleIcon` |  |
| `LaptopMinimal` | 1 | `LaptopMinimalIcon` |  |
| `LayoutPanelTop` | 1 | `LayoutTopIcon` |  |
| `ListOrdered` | 1 | `LeftToRightListNumberIcon` |  |
| `Logs` | 1 | `LogsIcon` |  |
| `MailOpen` | 1 | `MailOpen01Icon` |  |
| `Maximize` | 1 | `Maximize01Icon` |  |
| `Menu` | 1 | `Menu01Icon` |  |
| `MessageCircleWarning` | 1 | `MessageCircleWarningIcon` |  |
| `Mic` | 1 | `Mic01Icon` |  |
| `MonitorDot` | 1 | `ComputerIcon` |  |
| `MonitorPlay` | 1 | `ComputerVideoIcon` |  |
| `MonitorSmartphone` | 1 | `ComputerPhoneSyncIcon` |  |
| `MoveHorizontal` | 1 | `MoveLeftIcon` |  |
| `Omega` | 1 | `OmegaIcon` |  |
| `Package2` | 1 | `Package01Icon` |  |
| `Paintbrush` | 1 | `PaintBrush01Icon` |  |
| `PanelsTopLeft` | 1 | `PanelsTopLeftIcon` |  |
| `Paperclip` | 1 | `AttachmentIcon` |  |
| `PenLine` | 1 | `PenTool01Icon` |  |
| `PencilLine` | 1 | `PencilEdit01Icon` |  |
| `Plane` | 1 | `Airplane01Icon` |  |
| `Puzzle` | 1 | `PuzzleIcon` |  |
| `Quote` | 1 | `QuoteUpIcon` |  |
| `Radio` | 1 | `RadioIcon` |  |
| `Replace` | 1 | `ReplaceIcon` |  |
| `ReplaceAll` | 1 | `ReplaceAllIcon` |  |
| `Reply` | 1 | `MailReply01Icon` |  |
| `Rewind` | 1 | `Backward01Icon` |  |
| `RotateCw` | 1 | `RotateClockwiseIcon` |  |
| `Rows2` | 1 | `LayoutTwoRowIcon` |  |
| `RulerDimensionLine` | 1 | `RulerDimensionLineIcon` |  |
| `ScrollText` | 1 | `ScrollIcon` |  |
| `SearchCode` | 1 | `Search02Icon` |  |
| `SearchX` | 1 | `SearchMinusIcon` |  |
| `Sheet` | 1 | `SheetIcon` |  |
| `ShieldAlert` | 1 | `Shield01Icon` |  |
| `ShieldBan` | 1 | `SecurityBlockIcon` |  |
| `SignalHigh` | 1 | `SignalFull01Icon` |  |
| `SkipBack` | 1 | `Backward01Icon` |  |
| `SkipForward` | 1 | `Forward01Icon` |  |
| `Slash` | 1 | `SlashIcon` |  |
| `Space` | 1 | `SaturnIcon` |  |
| `Sparkle` | 1 | `SparklesIcon` |  |
| `Sprout` | 1 | `Plant01Icon` |  |
| `SquareChevronRight` | 1 | `SquareChevronRightIcon` |  |
| `SquareKanban` | 1 | `KanbanIcon` |  |
| `SquareMousePointer` | 1 | `SquareMousePointerIcon` |  |
| `SquareRoundCorner` | 1 | `SquareRoundCornerIcon` |  |
| `SquareStack` | 1 | `SquareStackIcon` |  |
| `StopCircle` | 1 | `StopCircleIcon` |  |
| `Strikethrough` | 1 | `TextStrikethroughIcon` |  |
| `Sun` | 1 | `Sun01Icon` |  |
| `TableProperties` | 1 | `TablePropertiesIcon` |  |
| `Target` | 1 | `Target01Icon` |  |
| `TextQuote` | 1 | `QuoteUpIcon` |  |
| `ThumbsUp` | 1 | `ThumbsUpIcon` |  |
| `Ticket` | 1 | `Ticket01Icon` |  |
| `TrendingDown` | 1 | `AnalyticsDownIcon` |  |
| `TrendingUp` | 1 | `AnalyticsUpIcon` |  |
| `Unlink2` | 1 | `Unlink02Icon` |  |
| `Unlock` | 1 | `SquareUnlock01Icon` |  |
| `UserMinus` | 1 | `UserMinus01Icon` |  |
| `UserRoundCheck` | 1 | `UserRoundCheckIcon` |  |
| `UsersRound` | 1 | `UsersRoundIcon` |  |
| `Waypoints` | 1 | `WaypointsIcon` |  |
