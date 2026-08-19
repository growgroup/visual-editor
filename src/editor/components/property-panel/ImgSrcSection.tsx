import { useEffect, useRef, useState } from 'react';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/collapsible';
import { Image as ImageIcon, ChevronRight, Upload } from 'lucide-react';
import { uploadEditorImage } from '../../../lib/firebase/storage';
import type { SelectedElementInfo } from '../../types';

interface ImgSrcSectionProps {
  selectedElement: SelectedElementInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttributeChange: (attrs: Record<string, string>) => void;
  /** 選択中要素の現在のsrc(iframeから取得済みのもの) */
  currentSrc?: string;
}

/**
 * [移植時の追加] <img> 要素の src を差し替えるセクション。
 * ファイル選択でアップロード(public/media/uploads/ に実ファイル保存)するか、
 * URLを直接指定できる。既存の ImageSection は「背景画像」用で <img> は扱えなかった。
 */
export function ImgSrcSection({
  selectedElement,
  open,
  onOpenChange,
  onAttributeChange,
  currentSrc = '',
}: ImgSrcSectionProps) {
  const [urlValue, setUrlValue] = useState(currentSrc);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 選択要素が変わったとき / メディアライブラリなど外部から src が差し替わったときに追従する
  // （ローカルstateのままだとプレビューとURL欄が古い画像を指し続ける）
  useEffect(() => {
    setUrlValue(currentSrc);
  }, [currentSrc, selectedElement.id]);

  if (selectedElement.tagName?.toUpperCase() !== 'IMG') return null;

  const applySrc = (src: string) => {
    if (!src) return;
    onAttributeChange({ src });
    setUrlValue(src);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { storageUrl } = await uploadEditorImage(file, { fileName: file.name });
      applySrc(storageUrl);
    } catch (err) {
      console.error('[ImgSrcSection] 画像の差し替えに失敗:', err);
      alert(`画像の差し替えに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
        <span className="flex items-center gap-2">
          <ImageIcon className="w-3.5 h-3.5" />
          画像の差し替え
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3">
        {/* プレビュー */}
        {urlValue && (
          <div className="flex items-center justify-center rounded border border-[#444444] bg-[#2c2c2c] p-2">
            <img
              src={urlValue}
              alt=""
              className="max-h-24 max-w-full object-contain"
            />
          </div>
        )}

        {/* ファイル選択 */}
        <div>
          <Label className="text-[10px] text-gray-500">ファイルから差し替え</Label>
          <label className="mt-1 flex h-7 cursor-pointer items-center justify-center gap-2 rounded border border-[#444444] bg-[#383838] text-xs text-white hover:bg-[#4a4a4a]">
            <Upload className="h-3 w-3" />
            {uploading ? 'アップロード中…' : '画像を選択'}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
              disabled={uploading}
            />
          </label>
        </div>

        {/* URL直接指定 */}
        <div>
          <Label className="text-[10px] text-gray-500">画像のURL / パス</Label>
          <Input
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onBlur={() => applySrc(urlValue)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySrc(urlValue);
            }}
            placeholder="/media/xxx.png"
            className="mt-1 h-7 border-[#444444] bg-[#383838] text-xs text-white"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
