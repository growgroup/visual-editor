'use client';

import { useEditorContext } from '../EditorContext';
import { BreakpointSelector } from './BreakpointSelector';

/**
 * エディタのフッター（ショートカットヘルプ表示 + ブレイクポイントセレクター）
 */
export function EditorFooter() {
  const { activeTool, editorMode } = useEditorContext();

  return (
    <div className="px-4 py-2 bg-[#2c2c2c] border-t border-[#444444]">
      <div className="flex items-center justify-between text-xs text-gray-500">
        {/* 左側: ショートカットヘルプ */}
        <div className="flex items-center gap-4">
          {activeTool === 'select' ? (
            <>
              <span>
                <kbd className="px-1 py-0.5 bg-[#444444] rounded text-gray-400">
                  クリック
                </kbd>{' '}
                選択 & 編集
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-[#444444] rounded text-gray-400">
                  Enter
                </kbd>{' '}
                確定
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-[#444444] rounded text-gray-400">
                  Esc
                </kbd>{' '}
                キャンセル
              </span>
            </>
          ) : (
            <>
              <span>
                <kbd className="px-1 py-0.5 bg-[#444444] rounded text-gray-400">
                  ドラッグ
                </kbd>{' '}
                描画
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-[#444444] rounded text-gray-400">
                  V
                </kbd>{' '}
                選択ツールに戻る
              </span>
            </>
          )}
        </div>

        {/* 中央: ブレイクポイントセレクター（webpageモードのみ） */}
        {editorMode === 'webpage' && (
          <div className="flex items-center">
            <BreakpointSelector />
          </div>
        )}

        {/* 右側: Undo/Redoショートカット */}
        <div className="flex items-center gap-4">
          <span>
            <kbd className="px-1 py-0.5 bg-[#444444] rounded text-gray-400">
              ⌘Z
            </kbd>{' '}
            元に戻す
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-[#444444] rounded text-gray-400">
              ⌘⇧Z
            </kbd>{' '}
            やり直し
          </span>
        </div>
      </div>
    </div>
  );
}
