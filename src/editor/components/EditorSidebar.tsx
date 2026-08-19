'use client';

import { useState } from 'react';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Search, Layers, ChevronRight, ChevronDown, MousePointer2 } from 'lucide-react';
import { useEditorContext } from '../EditorContext';
import { useElementActions } from '../hooks/useElementActions';
import {
  LayoutSection,
  TypographySection,
  FillSection,
  BorderSection,
  EffectSection,
  ImageSection,
} from './property-panel';
import type { DOMTreeNode } from '../types';

/**
 * レイヤーパネルとプロパティパネルを含むサイドバー
 */
export function EditorSidebar() {
  const {
    selectedElement,
    domTree,
    searchQuery,
    setSearchQuery,
    expandedNodes,
    setExpandedNodes,
    openSections,
    setOpenSections,
    iframeRef,
  } = useEditorContext();

  const { updateElementStyle } = useElementActions();

  // レイヤーノードの展開/折りたたみ
  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  // レイヤーノードのレンダリング
  const renderLayerNode = (node: DOMTreeNode, depth: number = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedElement?.id === node.id;

    // 検索フィルタ
    if (searchQuery) {
      const matchesSearch =
        node.tagName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.className.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.text.toLowerCase().includes(searchQuery.toLowerCase());
      const childrenMatch = node.children.some((child) =>
        child.tagName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        child.className.toLowerCase().includes(searchQuery.toLowerCase()) ||
        child.text.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (!matchesSearch && !childrenMatch) return null;
    }

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-1 py-1 px-2 text-xs cursor-pointer hover:bg-[#444444] ${
            isSelected ? 'bg-[#0d99ff]/25 text-[#7cc4ff]' : 'text-gray-400'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(node.id);
              }}
              className="p-0.5 hover:bg-[#4a4a4a] rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <Layers className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">
            {node.className || node.tagName}
            {node.text && (
              <span className="text-gray-500 ml-1">{node.text}</span>
            )}
          </span>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child) => renderLayerNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-64 bg-[#2c2c2c] border-l border-[#444444] flex flex-col">
      {/* レイヤーパネル */}
      <div className="border-b border-[#444444]">
        <div className="px-3 py-2 text-xs font-medium text-gray-400 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" />
          レイヤー
        </div>
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <Input
              type="text"
              placeholder="検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs bg-[#383838] border-[#444444] text-white"
            />
          </div>
        </div>
        <ScrollArea className="h-40">
          {domTree.map((node) => renderLayerNode(node))}
        </ScrollArea>
      </div>

      {/* プロパティパネル */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 text-xs font-medium text-gray-400 border-b border-[#444444]">
          プロパティ
        </div>
        {selectedElement ? (
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              {/* 選択要素情報 */}
              <div className="text-xs text-gray-400 mb-2">
                <span className="text-white font-medium">{selectedElement.tagName}</span>
                {selectedElement.text && (
                  <span className="text-gray-500 ml-1 truncate block">
                    {selectedElement.text}
                  </span>
                )}
              </div>

              {/* レイアウトセクション */}
              <LayoutSection
                selectedElement={selectedElement}
                open={openSections.layout}
                onOpenChange={(open) =>
                  setOpenSections((prev) => ({ ...prev, layout: open }))
                }
                onStyleChange={updateElementStyle}
              />

              {/* 画像セクション */}
              <ImageSection
                selectedElement={selectedElement}
                open={openSections.image}
                onOpenChange={(open) =>
                  setOpenSections((prev) => ({ ...prev, image: open }))
                }
                onStyleChange={updateElementStyle}
              />

              {/* テキストセクション */}
              <TypographySection
                selectedElement={selectedElement}
                open={openSections.typography}
                onOpenChange={(open) =>
                  setOpenSections((prev) => ({ ...prev, typography: open }))
                }
                onStyleChange={updateElementStyle}
                iframeDoc={iframeRef.current?.contentDocument || null}
              />

              {/* 塗りセクション */}
              <FillSection
                selectedElement={selectedElement}
                open={openSections.fill}
                onOpenChange={(open) =>
                  setOpenSections((prev) => ({ ...prev, fill: open }))
                }
                onStyleChange={updateElementStyle}
              />

              {/* 線セクション */}
              <BorderSection
                selectedElement={selectedElement}
                open={openSections.stroke}
                onOpenChange={(open) =>
                  setOpenSections((prev) => ({ ...prev, stroke: open }))
                }
                onStyleChange={updateElementStyle}
              />

              {/* エフェクトセクション */}
              <EffectSection
                selectedElement={selectedElement}
                open={openSections.effects}
                onOpenChange={(open) =>
                  setOpenSections((prev) => ({ ...prev, effects: open }))
                }
                onStyleChange={updateElementStyle}
              />
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center text-gray-500 text-xs">
              <MousePointer2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>要素を選択してください</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
