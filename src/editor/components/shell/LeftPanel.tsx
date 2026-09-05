'use client';

import { useState, type ReactNode } from 'react';
import { Layers, Files } from 'lucide-react';
import { useEditorContext } from '../../EditorContext';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { EditorLayerPanel } from '../EditorLayerPanel';
import { PagesPanel } from './PagesPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../components/ui/tabs';
import { can } from '../../../io';

export function LeftPanel({ page, pagesSlot }: { page: number; pagesSlot?: ReactNode }) {
  const { editorMode } = useEditorContext();
  const showPages = !!pagesSlot || (can('renderContent') && editorMode !== 'webpage');
  const { width, isDragging, resizeHandleProps } = useResizablePanel({
    initialWidth: 264, minWidth: 224, maxWidth: 440, direction: 'right', storageKey: 'gg-editor:left-panel-width',
  });
  const [tab, setTab] = useState(showPages ? 'pages' : 'layers');
  return (
    <aside data-left-panel aria-label="ページとレイヤー" className="relative flex shrink-0 flex-col overflow-hidden border-r border-[#444444] bg-[#2c2c2c]" style={{ width }}>
      {showPages ? (
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="ed-panel-tabs" aria-label="左パネル">
            <TabsTrigger value="pages" data-left-tab="pages"><Files className="mr-2 h-4 w-4" />ページ</TabsTrigger>
            <TabsTrigger value="layers" data-left-tab="layers"><Layers className="mr-2 h-4 w-4" />レイヤー</TabsTrigger>
          </TabsList>
          <TabsContent value="pages" forceMount className="ed-panel-tab-content">
            {pagesSlot || <PagesPanel page={page} height="100%" />}
          </TabsContent>
          <TabsContent value="layers" forceMount className="ed-panel-tab-content"><EditorLayerPanel hideSlideList /></TabsContent>
        </Tabs>
      ) : <><div className="ed-panel-heading"><Layers className="h-4 w-4" />レイヤー</div><EditorLayerPanel hideSlideList /></>}
      <div {...resizeHandleProps} />
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </aside>
  );
}
