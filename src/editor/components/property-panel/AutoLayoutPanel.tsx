'use client';

import { useState, useEffect } from 'react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { CompactNumberInput } from './CompactNumberInput';
import { VariableAwareUnitInput } from './VariableAwareUnitInput';
import { SPACING_UNITS } from './unit-utils';
import {
  ArrowRight,
  ArrowDown,
  WrapText,
  Grid3X3,
  Plus,
  Minus,
  LayoutGrid,
  Columns,
  Rows,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { useEditorContext } from '../../EditorContext';
import {
  AUTOLAYOUT_CLASS,
  disableAutoLayout,
  enableAutoLayout,
  relaxContainerSize,
  restoreChildrenToFlow,
} from '../../utils/restore-flow';
import type { SelectedElementInfo } from '../../types';

interface AutoLayoutPanelProps {
  element: SelectedElementInfo;
  onStyleChange: (styles: Record<string, string>) => void;
}

type LayoutMode = 'none' | 'flex' | 'grid';
type FlowDirection = 'row' | 'column' | 'wrap';
type AlignmentPosition = 'start-start' | 'start-center' | 'start-end'
  | 'center-start' | 'center-center' | 'center-end'
  | 'end-start' | 'end-center' | 'end-end';

// グリッドプリセット
const GRID_PRESETS = [
  { name: '2列', cols: 2, rows: 1, icon: '⬛⬛' },
  { name: '3列', cols: 3, rows: 1, icon: '⬛⬛⬛' },
  { name: '4列', cols: 4, rows: 1, icon: '⬛⬛⬛⬛' },
  { name: '2x2', cols: 2, rows: 2, icon: '⊞' },
  { name: '3x3', cols: 3, rows: 3, icon: '⊞⊞' },
  { name: '12列', cols: 12, rows: 1, icon: '▦' },
];

// グリッドトラックのパース（カラム/ロー数を取得）
function parseGridTemplateCount(template: string): number {
  if (!template || template === 'none') return 0;
  // repeat(n, ...) 形式をパース
  const repeatMatch = template.match(/repeat\((\d+)/);
  if (repeatMatch) return parseInt(repeatMatch[1]);
  // スペース区切りの数をカウント
  return template.split(/\s+/).filter(t => t && t !== 'none').length;
}

// カラム数からgrid-template-columnsを生成
function buildGridColumns(count: number): string {
  if (count <= 0) return 'none';
  return `repeat(${count}, 1fr)`;
}

// ロー数からgrid-template-rowsを生成
function buildGridRows(count: number): string {
  if (count <= 0) return 'auto';
  if (count === 1) return 'auto';
  return `repeat(${count}, 1fr)`;
}

export function AutoLayoutPanel({ element, onStyleChange }: AutoLayoutPanelProps) {
  const { getIframeDoc, notifyIframeChange } = useEditorContext();

  /** 選択中の要素の実体(iframe内)を引く */
  const containerEl = (): HTMLElement | null =>
    getIframeDoc()?.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`) ?? null;

  /**
   * この要素は「明示的にオートレイアウトON」か。
   *
   * computed の display で判定すると、テンプレート由来の flex を
   * 「ONになっている」と誤って表示してしまう(嘘をつく)。
   * 目印クラスの有無だけを見る。
   */
  // SelectedElementInfo はクラスを持たないので、実体から読む。
  // element.id はスタイル変更のたびに作り直されるため、変更後も再評価される
  const isAutoLayoutOn = containerEl()?.classList.contains(AUTOLAYOUT_CLASS) ?? false;

  /**
   * 既にONの器に対して、レイアウトの微調整(gap・配置など)をする前の地ならし。
   *
   * ONにした時点で子はフロー化済みだが、後から足された子や別経路で
   * 絶対配置が焼き込まれた子が混じると、その子だけ並びから外れる。
   */
  const prepareContainerForLayout = (options?: { relaxSize?: boolean }) => {
    const el = containerEl();
    if (!el) return;
    restoreChildrenToFlow(el);
    // 方向を変えるときは、焼き込まれた幅・高さも解く(縦積みで中身が溢れるため)
    if (options?.relaxSize) relaxContainerSize(el);
    // 位置が変わるので選択枠と履歴を追随させる
    notifyIframeChange();
  };

  /**
   * オートレイアウトをONにする(Figmaの「オートレイアウトを追加」に相当)。
   *
   * 目印クラスを付け、今見えている位置の順に子を並べ直してフロー化する。
   * これをやらないと、一括変換で絶対配置になった子には gap も方向も効かない。
   */
  const turnAutoLayoutOn = (direction: 'row' | 'column') => {
    const el = containerEl();
    if (!el) return;
    enableAutoLayout(el, direction);
    relaxContainerSize(el);
    notifyIframeChange();
  };

  /** オートレイアウトをOFFにする。印を外すだけで、子は今の見た目のまま残す */
  const turnAutoLayoutOff = () => {
    const el = containerEl();
    if (!el) return;
    disableAutoLayout(el);
    notifyIframeChange();
  };

  const [colCount, setColCount] = useState(() =>
    parseGridTemplateCount(element.gridTemplateColumns) || 2
  );
  const [rowCount, setRowCount] = useState(() =>
    parseGridTemplateCount(element.gridTemplateRows) || 1
  );

  // 要素が変わったらグリッド状態を同期
  useEffect(() => {
    const cols = parseGridTemplateCount(element.gridTemplateColumns);
    const rows = parseGridTemplateCount(element.gridTemplateRows);
    if (cols > 0) setColCount(cols);
    if (rows > 0) setRowCount(rows);
  }, [element.gridTemplateColumns, element.gridTemplateRows]);

  /**
   * 現在のレイアウトモード。
   *
   * [重要] computed の display だけでは判定しない。テンプレート由来の flex は
   * スライド中に山ほどあり、それを「レイアウトON」と表示すると
   * 「ONに見えるのに触っても何も起きない」という嘘になる。
   * 明示的にONにした器(gg-autolayout)だけを ON として扱う。
   */
  const getLayoutMode = (): LayoutMode => {
    if (!isAutoLayoutOn) return 'none';
    if (element.display === 'grid') return 'grid';
    return 'flex';
  };

  const layoutMode = getLayoutMode();
  const isFlex = layoutMode === 'flex';
  const isGrid = layoutMode === 'grid';

  // 現在のフロー方向を判定（Flexbox用）
  const getFlowDirection = (): FlowDirection => {
    if (element.flexWrap === 'wrap') return 'wrap';
    if (element.flexDirection === 'column') return 'column';
    return 'row';
  };

  const flowDirection = getFlowDirection();

  // フロー方向を変更（Flexbox用）
  const handleFlowChange = (direction: FlowDirection) => {
    // wrap は行方向の折り返しなので、並びの基準は row と同じ
    prepareContainerForLayout({ relaxSize: true });
    if (direction === 'wrap') {
      onStyleChange({
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
      });
    } else {
      onStyleChange({
        display: 'flex',
        flexDirection: direction,
        flexWrap: 'nowrap',
      });
    }
  };

  // レイアウトモードを変更
  const handleLayoutModeChange = (mode: LayoutMode) => {
    // ONにする瞬間だけ、子を「今見えている順」に並べ直してフロー化する。
    // これが Figma の「オートレイアウトを追加」と同じ中身
    if (mode === 'flex') turnAutoLayoutOn('row');
    else if (mode === 'grid') turnAutoLayoutOn('row');
    else turnAutoLayoutOff();

    if (mode === 'none') {
      onStyleChange({ display: 'block' });
    } else if (mode === 'flex') {
      onStyleChange({
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: '8px',
      });
    } else if (mode === 'grid') {
      onStyleChange({
        display: 'grid',
        gridTemplateColumns: buildGridColumns(colCount),
        gridTemplateRows: buildGridRows(rowCount),
        gap: '8px',
        alignItems: 'stretch',
        justifyItems: 'stretch',
      });
    }
  };

  // 配置位置を判定
  const getAlignmentPosition = (): AlignmentPosition => {
    const justify = isGrid ? element.justifyItems : element.justifyContent;
    const align = element.alignItems;

    let row: 'start' | 'center' | 'end' = 'start';
    let col: 'start' | 'center' | 'end' = 'start';

    if (justify === 'center') col = 'center';
    else if (justify === 'flex-end' || justify === 'end') col = 'end';
    else if (justify === 'space-between' || justify === 'space-around') col = 'center';

    if (align === 'center') row = 'center';
    else if (align === 'flex-end' || align === 'end') row = 'end';

    return `${row}-${col}` as AlignmentPosition;
  };

  // 配置を変更
  const handleAlignmentChange = (position: AlignmentPosition) => {
    prepareContainerForLayout();
    const [rowPos, colPos] = position.split('-') as ['start' | 'center' | 'end', 'start' | 'center' | 'end'];

    if (isFlex) {
      let justifyContent = 'flex-start';
      if (colPos === 'center') justifyContent = 'center';
      else if (colPos === 'end') justifyContent = 'flex-end';

      let alignItems = 'flex-start';
      if (rowPos === 'center') alignItems = 'center';
      else if (rowPos === 'end') alignItems = 'flex-end';

      onStyleChange({ justifyContent, alignItems });
    } else if (isGrid) {
      let justifyItems = 'start';
      if (colPos === 'center') justifyItems = 'center';
      else if (colPos === 'end') justifyItems = 'end';

      let alignItems = 'start';
      if (rowPos === 'center') alignItems = 'center';
      else if (rowPos === 'end') alignItems = 'end';

      onStyleChange({ justifyItems, alignItems });
    }
  };

  const alignmentPosition = getAlignmentPosition();

  // カラム数を変更
  const updateColumnCount = (newCount: number) => {
    const count = Math.max(1, Math.min(12, newCount));
    setColCount(count);
    onStyleChange({ gridTemplateColumns: buildGridColumns(count) });
  };

  // ロー数を変更
  const updateRowCount = (newCount: number) => {
    const count = Math.max(1, Math.min(12, newCount));
    setRowCount(count);
    onStyleChange({ gridTemplateRows: buildGridRows(count) });
  };

  // プリセットを適用
  const applyPreset = (cols: number, rows: number) => {
    setColCount(cols);
    setRowCount(rows);
    onStyleChange({
      display: 'grid',
      gridTemplateColumns: buildGridColumns(cols),
      gridTemplateRows: buildGridRows(rows),
      gap: '8px',
    });
  };

  return (
    <div className="space-y-2">
      {/* レイアウトモード選択 */}
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500">レイアウト</Label>
        <div className="flex gap-0.5">
          <TooltipButton
            icon={<span className="text-[9px] font-medium">OFF</span>}
            label="レイアウトなし"
            testId="mode-none"
            onClick={() => handleLayoutModeChange('none')}
            active={layoutMode === 'none'}
          />
          <TooltipButton
            icon={<ArrowRight className="h-3 w-3" />}
            label="Flexbox"
            testId="mode-flex"
            onClick={() => handleLayoutModeChange('flex')}
            active={layoutMode === 'flex'}
          />
          <TooltipButton
            icon={<Grid3X3 className="h-3 w-3" />}
            label="Grid"
            testId="mode-grid"
            onClick={() => handleLayoutModeChange('grid')}
            active={layoutMode === 'grid'}
          />
        </div>
      </div>

      {/* Flexbox設定 */}
      {isFlex && (
        <div className="flex items-start gap-3">
          {/* フロー方向 */}
          <div>
            <Label className="text-[9px] text-gray-600 mb-0.5 block">フロー</Label>
            <div className="flex gap-0.5">
              <TooltipButton
                icon={<ArrowRight className="h-3 w-3" />}
                label="横並び"
                testId="flow-row"
                onClick={() => handleFlowChange('row')}
                active={flowDirection === 'row'}
              />
              <TooltipButton
                icon={<ArrowDown className="h-3 w-3" />}
                label="縦並び"
                testId="flow-column"
                onClick={() => handleFlowChange('column')}
                active={flowDirection === 'column'}
              />
              <TooltipButton
                icon={<WrapText className="h-3 w-3" />}
                label="折り返し"
                testId="flow-wrap"
                onClick={() => handleFlowChange('wrap')}
                active={flowDirection === 'wrap'}
              />
            </div>
          </div>

          {/* 配置（9グリッド） */}
          <div>
            <Label className="text-[9px] text-gray-600 mb-0.5 block">配置</Label>
            <AlignmentGrid
              position={alignmentPosition}
              onChange={handleAlignmentChange}
            />
          </div>

          {/* 間隔 (Gap) */}
          <div>
            <Label className="text-[9px] text-gray-600 mb-0.5 block">Gap</Label>
            <VariableAwareUnitInput
              value={element.rawGap || `${Math.round(element.gap)}px`}
              onChange={(val) => {
                prepareContainerForLayout();
                onStyleChange({ gap: val });
              }}
              units={SPACING_UNITS}
              defaultUnit="px"
              category="spacing"
              min={0}
              compact
            />
          </div>
        </div>
      )}

      {/* Grid設定 */}
      {isGrid && (
        <div className="space-y-2">
          {/* ビジュアルグリッドプレビュー */}
          <div className="bg-[#2a2a2a] rounded p-2">
            <div
              className="grid gap-0.5 mx-auto"
              style={{
                gridTemplateColumns: `repeat(${Math.min(colCount, 6)}, 1fr)`,
                gridTemplateRows: `repeat(${Math.min(rowCount, 4)}, 1fr)`,
                width: 'fit-content',
                maxWidth: '100%',
              }}
            >
              {Array.from({ length: Math.min(colCount * rowCount, 24) }).map((_, i) => (
                <div
                  key={i}
                  className="w-4 h-3 bg-[#0d99ff]/40 rounded-sm border border-[#0d99ff]/60"
                />
              ))}
            </div>
            {(colCount > 6 || rowCount > 4) && (
              <div className="text-[9px] text-gray-500 text-center mt-1">
                {colCount} × {rowCount}
              </div>
            )}
          </div>

          {/* プリセットボタン */}
          <div>
            <Label className="text-[9px] text-gray-600 mb-1 block">プリセット</Label>
            <div className="flex flex-wrap gap-1">
              {GRID_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset.cols, preset.rows)}
                  className={`px-2 py-0.5 text-[9px] rounded border transition-colors ${
                    colCount === preset.cols && rowCount === preset.rows
                      ? 'bg-[#0d99ff] border-[#0d99ff] text-white'
                      : 'bg-[#383838] border-[#4a4a4a] text-gray-400 hover:bg-[#4a4a4a] hover:text-white'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* カラム・ロー数コントロール */}
          <div className="flex items-start gap-4">
            {/* カラム数 */}
            <div>
              <Label className="text-[9px] text-gray-600 mb-0.5 flex items-center gap-1">
                <Columns className="h-3 w-3" />
                列
              </Label>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                  onClick={() => updateColumnCount(colCount - 1)}
                  disabled={colCount <= 1}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-6 text-center text-xs font-medium">{colCount}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                  onClick={() => updateColumnCount(colCount + 1)}
                  disabled={colCount >= 12}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* ロー数 */}
            <div>
              <Label className="text-[9px] text-gray-600 mb-0.5 flex items-center gap-1">
                <Rows className="h-3 w-3" />
                行
              </Label>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                  onClick={() => updateRowCount(rowCount - 1)}
                  disabled={rowCount <= 1}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-6 text-center text-xs font-medium">{rowCount}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                  onClick={() => updateRowCount(rowCount + 1)}
                  disabled={rowCount >= 12}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Gap */}
            <div>
              <Label className="text-[9px] text-gray-600 mb-0.5 block">Gap</Label>
              <VariableAwareUnitInput
                value={element.rawGap || `${Math.round(element.gridGap || element.gap)}px`}
                onChange={(val) => {
                prepareContainerForLayout();
                onStyleChange({ gap: val });
              }}
                units={SPACING_UNITS}
                defaultUnit="px"
                category="spacing"
                min={0}
                compact
              />
            </div>
          </div>

          {/* 配置 */}
          <div className="flex items-start gap-3">
            <div>
              <Label className="text-[9px] text-gray-600 mb-0.5 block">配置</Label>
              <AlignmentGrid
                position={alignmentPosition}
                onChange={handleAlignmentChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 配置グリッドコンポーネント
function AlignmentGrid({
  position,
  onChange
}: {
  position: AlignmentPosition;
  onChange: (position: AlignmentPosition) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-0.5 bg-[#383838] p-0.5 rounded">
      {(['start', 'center', 'end'] as const).map(row => (
        (['start', 'center', 'end'] as const).map(col => {
          const pos = `${row}-${col}` as AlignmentPosition;
          const isActive = position === pos;
          return (
            <button
              key={pos}
              data-al={`align-${pos}`}
              data-active={isActive ? 'true' : 'false'}
              aria-pressed={isActive}
              title={`配置: ${pos}`}
              onClick={() => onChange(pos)}
              className={`w-3 h-3 rounded-sm transition-colors ${
                isActive
                  ? 'bg-[#0d99ff]'
                  : 'bg-[#5a5a5a] hover:bg-[#6a6a6a]'
              }`}
            />
          );
        })
      ))}
    </div>
  );
}

function TooltipButton({
  icon,
  label,
  onClick,
  active,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  /** 自動検証・目視の両方から掴めるようにする目印(見た目には出ない) */
  testId?: string;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-al={testId}
            data-active={active ? 'true' : 'false'}
            aria-pressed={active ? true : false}
            title={label}
            className={`h-6 w-6 rounded-sm inline-flex items-center justify-center transition-colors ${
              active
                ? 'bg-[#0d99ff] text-white'
                : 'text-gray-400 hover:text-white hover:bg-[#4a4a4a]'
            }`}
            onClick={handleClick}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
