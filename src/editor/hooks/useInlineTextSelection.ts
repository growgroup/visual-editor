'use client';

import { useSyncExternalStore } from 'react';
import {
  getInlineTextSummary,
  subscribeInlineTextSelection,
  type InlineTextSummary,
} from '../utils/inline-text-style';

/**
 * テキストの一部を選んでいるときの、その範囲の文字の見た目。選んでいなければ null。
 * パネルが「選んだ文字の値」と「混在」を出すのに使う
 */
export function useInlineTextSelection(): InlineTextSummary | null {
  return useSyncExternalStore(subscribeInlineTextSelection, getInlineTextSummary, getInlineTextSummary);
}
