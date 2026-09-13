/**
 * 要素選択処理フック
 * - シングル選択 / マルチ選択
 * - Ctrl/Cmd クリックによるリーフ選択
 * - Shift クリックによる追加選択
 * - ダブルクリックによるドリルダウン
 * - 兄弟要素（Peer）の階層認識
 */

import { useCallback, useRef, useEffect, MutableRefObject } from "react";
import { useEditorContext } from "../EditorContext";
import {
  updateSelectionBox,
  isInlineElement,
  fitElementToContent,
  getArtboardContent,
  prepareElementDragOrigin,
  prepareElementsForGroupDrag,
  getArtboardScale,
  refreshSelectionOverlay,
  syncSelectionOverlayRects,
  lockCaretScroll,
} from "../utils/dom-utils";
import { extractElementInfo } from "../utils/style-utils";
import { MARQUEE_DRAG_THRESHOLD } from "../constants";
import type { DragState, ResizeState, MarqueeState } from "../types";

/**
 * mousedown で保留し、mouseup で意味を確定するクリック情報
 *
 * [なぜ保留するか]
 * Shift の意味は「トグル」と「軸拘束ドラッグ」の2つがあり、mousedown の時点では
 * どちらか決められない。mousedown で即トグルすると、Shift+ドラッグ（軸拘束）の
 * たびに群の構成が変わってしまう。同様に「群のメンバーを素クリック → 単独選択に
 * 落ちる」も、掴んだ瞬間に落とすと群ドラッグができなくなる。
 * そのため、掴んだ時点では選択を変えず、移動量が閾値未満だったときだけ
 * mouseup で確定させる。
 */
interface PendingClick {
  element: HTMLElement;
  elementId: string;
  /** Shift が押されていたか（トグル候補） */
  shift: boolean;
  /** mousedown 時点で選択済みだったか */
  wasSelected: boolean;
  /** mousedown 時点で複数選択だったか（素クリックで単独へ畳む判定用） */
  wasMulti: boolean;
  startX: number;
  startY: number;
}

interface UseElementSelectionOptions {
  /** ドラッグ状態を更新するコールバック（useRefオブジェクトのcurrentを更新） */
  dragStateRef: MutableRefObject<DragState>;
  /** リサイズ状態を更新するコールバック（useRefオブジェクトのcurrentを更新） */
  resizeStateRef: MutableRefObject<ResizeState>;
  /** マーキー選択の開始保留フラグ */
  marqueeStartPendingRef: MutableRefObject<boolean>;
  /** マーキークリック対象の要素 */
  marqueeClickTargetRef: MutableRefObject<HTMLElement | null>;
  /** レイアウトモード */
  layoutModeRef: MutableRefObject<"absolute" | "auto">;
  /** レイアウトヒント表示関数のref（群移動できないときの案内用） */
  setShowLayoutHintRef?: MutableRefObject<(show: boolean) => void>;
  /** マーキーを既存選択への加算として実行するか（Shift+マーキー） */
  marqueeAdditiveRef?: MutableRefObject<boolean>;
  /**
   * マーキー矩形の同期的な保持先。
   * React state だと mousedown → 最初の mousemove の間に反映が間に合わず、
   * 始点が (0,0) のまま読まれて矩形がずれる。判定はこの ref を正とする。
   */
  marqueeGeomRef?: MutableRefObject<MarqueeState>;
}

interface UseElementSelectionReturn {
  /**
   * 編集可能な要素を取得（インライン要素の場合は親を返す）
   * Cmd/Ctrl クリック用：最下層（Leaf）を取得
   */
  getEditableElement: (
    target: EventTarget | null,
    iframeDoc: Document,
  ) => HTMLElement | null;

  /**
   * 最上位（Top-Level）の編集可能要素を取得
   * body直前またはdata-editableを持たない親の手前まで遡る
   */
  getTopLevelEditable: (
    element: HTMLElement,
    iframeDoc: Document,
  ) => HTMLElement;

  /**
   * 要素のドラッグを開始
   */
  startElementDrag: (
    element: HTMLElement,
    e: MouseEvent,
    iframeDoc: Document,
  ) => void;

  /**
   * 要素情報を親ウィンドウに送信
   */
  sendElementInfo: (element: HTMLElement, iframeDoc: Document) => void;

  /**
   * iframe ドキュメントに選択リスナーをセットアップ
   * @returns クリーンアップ関数
   */
  setupSelectionListeners: (iframeDoc: Document) => () => void;

  /**
   * 「いまクリックしたら選択されるであろう要素」を返す（ホバー予告用）
   * mousedown の判別器と同じ経路を通るので、輪郭とクリック結果が必ず一致する
   */
  resolveHoverTarget: (
    target: EventTarget | null,
    iframeDoc: Document,
    options: { meta: boolean },
  ) => HTMLElement | null;

  /**
   * mouseup で Shift の意味（トグル or 軸拘束ドラッグ）と
   * 「群のメンバーの素クリック → 単独選択」を確定させる。
   * ドラッグ確定処理（useDragResize）の *後* に呼ぶこと。
   * iframe の外で離した場合は、iframe ビューポート座標へ変換したイベントを渡す。
   */
  handleSelectionMouseUp: (e: MouseEvent, iframeDoc: Document) => void;
}

/**
 * 要素選択処理フック
 */
export function useElementSelection(
  options: UseElementSelectionOptions,
): UseElementSelectionReturn {
  const {
    selectedElementIds,
    setSelectedElement,
    setSelectedElementIds,
    setMarqueeState,
    zoom,
  } = useEditorContext();

  const {
    dragStateRef,
    resizeStateRef,
    marqueeStartPendingRef,
    marqueeClickTargetRef,
    layoutModeRef,
    setShowLayoutHintRef,
    marqueeAdditiveRef,
    marqueeGeomRef,
  } = options;

  // mousedown で保留し mouseup で意味を確定するクリック情報
  const pendingClickRef = useRef<PendingClick | null>(null);

  /**
   * ハンドルの2連打検出用。
   * リサイズが終わるたびに選択ボックス(とハンドル)は作り直されるため、
   * ブラウザは「同一要素への2連クリック」と見なさず dblclick を合成しない。
   * dblclick イベントには頼れないので、mousedown の時刻と種類で自前判定する。
   */
  const lastHandleDownRef = useRef<{ handle: string; time: number; x: number; y: number } | null>(null);

  // クロージャ問題回避のためのref
  const selectedElementIdsRef = useRef(selectedElementIds);
  const setSelectedElementRef = useRef(setSelectedElement);
  const setSelectedElementIdsRef = useRef(setSelectedElementIds);
  const setMarqueeStateRef = useRef(setMarqueeState);
  const zoomRef = useRef(zoom);

  // refを最新値に同期
  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds]);

  useEffect(() => {
    setSelectedElementRef.current = setSelectedElement;
    setSelectedElementIdsRef.current = setSelectedElementIds;
    setMarqueeStateRef.current = setMarqueeState;
  }, [setSelectedElement, setSelectedElementIds, setMarqueeState]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /**
   * 要素情報を親ウィンドウに送信
   */
  const sendElementInfo = useCallback(
    (element: HTMLElement, iframeDoc: Document) => {
      const info = extractElementInfo(element, iframeDoc);
      if (info) {
        window.postMessage({ type: "ELEMENT_SELECTED", element: info }, "*");
      }
    },
    [],
  );

  /**
   * 要素が視覚的にブロックレベルとして表示されているかを判定
   * data-inline="true" でも、Tailwindのclass="block"などでblock表示の場合はtrue
   */
  const isVisuallyBlockLevel = useCallback(
    (element: HTMLElement, iframeDoc: Document): boolean => {
      const computedStyle = iframeDoc.defaultView?.getComputedStyle(element);
      if (!computedStyle) return false;

      const display = computedStyle.display;
      // ブロックレベル表示（block, flex, grid, etc.）はtrue
      const blockDisplays = [
        "block",
        "flex",
        "grid",
        "inline-block",
        "inline-flex",
        "inline-grid",
        "table",
        "list-item",
      ];
      return blockDisplays.includes(display);
    },
    [],
  );

  /**
   * 要素が真のインライン要素（テキストフロー内に存在し、絶対配置すると壊れる）かを判定
   * 例: <p>テスト<span>テスト</span>テスト</p> のspan
   */
  const isTrueInlineInTextFlow = useCallback(
    (element: HTMLElement, iframeDoc: Document): boolean => {
      // data-inline属性がなければfalse
      if (element.getAttribute("data-inline") !== "true") {
        return false;
      }

      // <a>タグは常に選択可能
      if (element.tagName === "A") {
        return false;
      }

      // 視覚的にブロックレベルならfalse（選択可能）
      if (isVisuallyBlockLevel(element, iframeDoc)) {
        return false;
      }

      // 親がテキスト要素で、兄弟にテキストノードがある場合は真のインライン
      const parent = element.parentElement;
      if (!parent) return false;

      const textContainerTags = [
        "P",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "TD",
        "TH",
        "LABEL",
        "SPAN",
      ];
      if (textContainerTags.includes(parent.tagName)) {
        // 兄弟にテキストノードがあるかチェック
        for (const sibling of parent.childNodes) {
          if (
            sibling.nodeType === Node.TEXT_NODE &&
            sibling.textContent?.trim()
          ) {
            return true; // テキストフロー内の真のインライン要素
          }
        }
      }

      return false;
    },
    [isVisuallyBlockLevel],
  );

  /**
   * 編集可能な要素を取得（インライン要素の場合は親を返す）
   */
  const getEditableElement = useCallback(
    (target: EventTarget | null, iframeDoc: Document): HTMLElement | null => {
      if (!target) return null;
      const el = target as HTMLElement;
      if (
        !el.nodeType ||
        el.nodeType !== 1 ||
        typeof el.getAttribute !== "function"
      )
        return null;

      // selection-box およびその子要素は除外
      if (el.closest(".selection-box")) {
        return null;
      }

      // 直接data-editableを持っているか
      if (el.getAttribute("data-editable") === "true") {
        // 真のインライン要素（テキストフロー内）の場合は親のブロック要素を探す
        if (isTrueInlineInTextFlow(el, iframeDoc)) {
          let parent = el.parentElement;
          while (parent && parent !== iframeDoc.body) {
            if (
              parent.getAttribute("data-editable") === "true" &&
              !isTrueInlineInTextFlow(parent, iframeDoc)
            ) {
              return parent;
            }
            parent = parent.parentElement;
          }
          return null; // 親のブロック要素が見つからない
        }
        return el;
      }

      // 親要素を探索（真のインライン要素をスキップ）
      if (typeof el.closest === "function") {
        let current: HTMLElement | null = el;
        while (current && current !== iframeDoc.body) {
          if (
            current.getAttribute("data-editable") === "true" &&
            !isTrueInlineInTextFlow(current, iframeDoc)
          ) {
            return current;
          }
          current = current.parentElement;
        }
      }
      return null;
    },
    [isTrueInlineInTextFlow],
  );

  /**
   * [移植時の追加] Figmaと同じ「選択コンテキスト」。
   *
   * Figmaの選択は次の規則で動く:
   *   - クリック      … いま入っているコンテナ(既定はページ)の**直下の子**を選ぶ。ページ自体は選ばない
   *   - ダブルクリック … そのコンテナの中へ**1段だけ**入る(繰り返すと深くなる)
   *   - Cmd/Ctrl+click … 階層を無視して**最下層**を直接選ぶ
   *   - 空白をクリック … 選択解除してコンテキストをページへ戻す
   *
   * ここでは「スライドの面」をページとみなす。面自体を選ばせないことで、
   * 1クリック目にスライド全体のdivが選ばれてしまう問題を解消する。
   */
  const selectionContextRef = useRef<HTMLElement | null>(null);

  /** スライドの面(=Figmaのページ相当)。これ自身は選択対象にしない */
  const getCanvasRoot = useCallback((iframeDoc: Document): HTMLElement => {
    let root: HTMLElement = iframeDoc.getElementById("artboard") ?? iframeDoc.body;
    // #artboard > スライド本体(1920x1080) のようなラッパーは、面として読み飛ばす
    for (let depth = 0; depth < 4; depth++) {
      // 選択枠などエディタが注入するUIは「中身」に数えない
      // (数えるとラッパー判定が崩れ、選択の基準がスライドの面から#artboardへずれる)
      const kids = Array.from(root.children).filter(
        (c): c is HTMLElement =>
          c.nodeType === 1 &&
          !c.classList.contains("selection-box") &&
          !c.classList.contains("marquee-selection-box") &&
          !c.hasAttribute("data-editor-overlay") &&
          c.tagName !== "STYLE" &&
          c.tagName !== "SCRIPT",
      );
      const fillsParent = (c: HTMLElement) =>
        c.offsetWidth >= root.clientWidth * 0.95 &&
        c.offsetHeight >= root.clientHeight * 0.95;

      // [修正] 以前は「子がちょうど1つ」のときしか面を見つけられなかった。
      // エディタで挿入した図形・画像は面の**兄弟**(#artboard直下)に入るため、
      // 1つでも挿入した時点で面の判定が崩れ、基準が #artboard へずれていた。
      // その状態では1クリックでスライドの面そのものが選ばれ、
      // 面は data-element-id を持たないので「選択枠は出るが何も操作できない」
      // (React側の選択は空のままでプロパティパネルも空)状態になっていた。
      // 面は「エディタが編集対象にしない器」= data-editable が付かない要素なので、
      // 挿入物を除いてから探す。
      let face = kids.find(
        (c) => c.getAttribute("data-editable") !== "true" && fillsParent(c),
      );
      // 古い保存HTMLでは面にも data-editable が残っていることがある。
      // その場合だけ、従来どおり「親を埋める唯一の子」を面とみなす
      if (!face && kids.length === 1 && fillsParent(kids[0])) face = kids[0];
      if (!face) break;
      root = face;
    }
    return root;
  }, []);

  /**
   * クリック位置の要素を、いまのコンテキストの直下の階層へ引き上げる
   *
   * @param options.readonly true のとき selectionContextRef を書き換えない。
   *   ホバー予告はマウスを動かすたびに呼ばれるので、ここでコンテキストを
   *   リセットしてしまうと「ダブルクリックで潜った階層」がマウス移動だけで
   *   失われる。予告は必ず readonly で呼ぶこと。
   */
  const resolveByContext = useCallback(
    (
      hit: HTMLElement,
      iframeDoc: Document,
      options?: { readonly?: boolean },
    ): HTMLElement => {
      const canvasRoot = getCanvasRoot(iframeDoc);
      let context = selectionContextRef.current;
      // コンテキストが外れている(消えた/別の枝をクリックした)ならページへ戻す
      if (!context || !context.isConnected || context === hit || !context.contains(hit)) {
        context = canvasRoot;
        if (!options?.readonly) selectionContextRef.current = null;
      }
      if (!context.contains(hit)) return hit;

      let current: HTMLElement = hit;
      while (current.parentElement && current.parentElement !== context) {
        if (current.parentElement === iframeDoc.body) break;
        current = current.parentElement;
      }
      return current;
    },
    [getCanvasRoot],
  );

  /**
   * 最上位（Top-Level）の編集可能要素を取得
   */
  const getTopLevelEditable = useCallback(
    (element: HTMLElement, iframeDoc: Document): HTMLElement => {
      let current = element;
      while (
        current.parentElement &&
        current.parentElement !== iframeDoc.body &&
        current.parentElement.getAttribute("data-editable") === "true"
      ) {
        current = current.parentElement;
      }
      return current;
    },
    [],
  );

  /**
   * 要素のドラッグを開始
   */
  const startElementDrag = useCallback(
    (element: HTMLElement, e: MouseEvent, iframeDoc: Document) => {
      const computedStyle = iframeDoc.defaultView?.getComputedStyle(element);

      // 真のインライン要素（テキストフロー内）はドラッグしない
      if (isTrueInlineInTextFlow(element, iframeDoc)) {
        console.log(
          "[startElementDrag] Skipping true inline element:",
          element.tagName,
          element.getAttribute("data-element-id"),
        );
        return;
      }

      // インライン表示の要素は絶対配置に変換しない（ただしブロック/positioned要素は許可）
      if (computedStyle && isInlineElement(element, computedStyle)) {
        const position = computedStyle.position;
        const display = computedStyle.display;
        if (
          position === "absolute" ||
          position === "fixed" ||
          display === "block" ||
          display === "inline-block" ||
          display === "flex" ||
          display === "inline-flex" ||
          display === "grid" ||
          display === "inline-grid"
        ) {
          // ドラッグ許可、処理を続行
        } else {
          return; // 純粋なインライン要素はドラッグしない
        }
      }

      // [移植時の修正] スライドのキャンバス自体は動かさない。
      // 既存の保存済みHTMLに data-editable が残っているケースへの保険で、
      // ここを掴むとスライドごと移動して中身が版面外へ消える
      const artboard = iframeDoc.getElementById('artboard');
      if (
        artboard &&
        element.parentElement === artboard &&
        element.offsetWidth >= artboard.clientWidth - 2 &&
        element.offsetHeight >= artboard.clientHeight - 2
      ) {
        return;
      }

      // [座標基準の一本化]
      // 従来はここで `parseFloat(element.style.left) || 0` を使っていたため、
      // Tailwindの任意値クラス（`absolute left-[96px]`）だけで配置された要素は
      // origin が 0 と誤読され、移動量に「その要素自身の座標 × ズーム倍率」の誤差が乗っていた。
      // 単一ドラッグと複数ドラッグで挙動が分岐しないよう、
      // dom-utils.prepareElementDragOrigin（offsetLeft/offsetTop ベース）に集約する。
      // Skip absolute positioning conversion in component edit mode
      // to preserve the component's natural layout
      const isComponentEditMode = iframeDoc.body.classList.contains(
        "component-edit-mode",
      );
      const { left: computedLeft, top: computedTop } = prepareElementDragOrigin(
        element,
        iframeDoc,
        {
          // [選択で動かさない] mousedown では**採寸だけ**する。
          // ここで絶対配置へ変換すると要素が流れから外れ、後続の兄弟が一斉に詰め上がるため、
          // クリックして選んだだけで版面が動いて見える。
          // 変換は「しきい値を超えて実際に動き始めた時点」(useDragResize)で行う。
          convertToAbsolute: false,
        },
      );

      dragStateRef.current = {
        element,
        elements: [element],
        startX: e.clientX,
        startY: e.clientY,
        origLeft: computedLeft,
        origTop: computedTop,
        origPositions: [{ left: computedLeft, top: computedTop }],
        isDragging: true,
        hasMoved: false,
        // Flex reorder mode (auto-layout)
        flexReorderMode: false,
        flexParent: null,
        originalIndex: -1,
        targetIndex: -1,
        // Enhanced auto-layout drag (hierarchy change support)
        autoLayoutDragMode: false,
        dragGhost: null,
        originalParent: null,
        currentDropTarget: null,
        dropPosition: null,
        dropIndex: -1,
      };
    },
    [dragStateRef, layoutModeRef, isTrueInlineInTextFlow],
  );

  /**
   * 複数選択の「群ドラッグ」を開始する
   *
   * [なぜ共通化したか]
   * 従来は selection-box 経由 / 選択済み要素の内部クリック経由 / 通常クリック経由 の
   * 3箇所に同じコードが重複しており、いずれも
   *   `origPositions = selectedElements.map(el => ({ left: parseFloat(el.style.left) || 0, ... }))`
   * という壊れた座標基準を持っていた。
   * 座標基準の決定・親子の重複除外・static→absolute 変換はすべて
   * dom-utils.prepareElementsForGroupDrag に集約する。
   *
   * @returns 群ドラッグを開始できた場合 true
   */
  const startGroupDrag = useCallback(
    (
      selectedElements: HTMLElement[],
      e: MouseEvent,
      iframeDoc: Document,
    ): boolean => {
      const prepared = prepareElementsForGroupDrag(
        selectedElements,
        iframeDoc,
        layoutModeRef.current,
      );

      if (!prepared) {
        // オートレイアウト中のフロー要素は、絶対配置へ変換すると未選択の兄弟まで
        // リフローしてスライド全体が崩れる。黙って1要素だけ動かすより、
        // 「絶対配置モードに切り替えてください」というヒントを出すほうが正直。
        dragStateRef.current.isDragging = false; // 前回の状態が残っていても動かさない
        setShowLayoutHintRef?.current?.(true);
        return false;
      }

      dragStateRef.current = {
        element: prepared.elements[0],
        elements: prepared.elements,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: prepared.origPositions[0].left,
        origTop: prepared.origPositions[0].top,
        origPositions: prepared.origPositions,
        isDragging: true,
        hasMoved: false,
        // Flex reorder mode (auto-layout)
        flexReorderMode: false,
        flexParent: null,
        originalIndex: -1,
        targetIndex: -1,
        // Enhanced auto-layout drag (hierarchy change support)
        autoLayoutDragMode: false,
        dragGhost: null,
        originalParent: null,
        currentDropTarget: null,
        dropPosition: null,
        dropIndex: -1,
      };

      // 群移動で right/bottom を無効化したり absolute へ変換したりすると
      // 表示位置が微調整されるため、枠の位置を同期させる。
      // ここで refreshSelectionOverlay（作り直し）を使うと、パンくずをmousedownした
      // 直後にそのノードが消えて click が発火しなくなるため、位置同期にとどめる。
      syncSelectionOverlayRects(iframeDoc);
      return true;
    },
    [dragStateRef, layoutModeRef, setShowLayoutHintRef],
  );

  // ========================================
  // 選択状態の書き換え（.selected を唯一の正とする）
  // ========================================

  /** いま .selected が付いている要素（DOMを正とする） */
  const getSelectedEls = useCallback(
    (iframeDoc: Document): HTMLElement[] =>
      Array.from(
        iframeDoc.querySelectorAll<HTMLElement>("[data-element-id].selected"),
      ),
    [],
  );

  /** .selected から選択IDリストを作り直して React 側へ反映する */
  const commitSelection = useCallback(
    (iframeDoc: Document, focusEl?: HTMLElement | null) => {
      const els = getSelectedEls(iframeDoc);
      const ids = els
        .map((el) => el.getAttribute("data-element-id") || "")
        .filter(Boolean);
      setSelectedElementIdsRef.current(ids);
      refreshSelectionOverlay(iframeDoc);
      if (ids.length === 0) {
        setSelectedElementRef.current(null);
        window.postMessage({ type: "ELEMENT_DESELECTED" }, "*");
        return;
      }
      const target = focusEl && focusEl.isConnected ? focusEl : els[els.length - 1];
      if (target) sendElementInfo(target, iframeDoc);
    },
    [getSelectedEls, sendElementInfo],
  );

  /** 単独選択にする */
  const selectSingle = useCallback(
    (iframeDoc: Document, element: HTMLElement) => {
      iframeDoc
        .querySelectorAll(".selected")
        .forEach((el) => el.classList.remove("selected"));
      element.classList.add("selected");
      commitSelection(iframeDoc, element);
    },
    [commitSelection],
  );

  /** 選択を全解除する */
  const clearSelection = useCallback(
    (iframeDoc: Document) => {
      iframeDoc
        .querySelectorAll(".selected")
        .forEach((el) => el.classList.remove("selected"));
      selectionContextRef.current = null;
      commitSelection(iframeDoc);
    },
    [commitSelection],
  );

  /**
   * Shift+クリックのトグルを適用する
   *
   * [階層ルール] 祖先と子孫が同時に選択されると、群バウンディングボックスも
   * 群ドラッグ（親が動けば子も動く）も破綻する。そのため
   *   - 祖先が選択済みなら子孫は入れない（何も起きない）
   *   - 子孫が選択済みなら、祖先を足すときに子孫を外す
   * とする。
   */
  const applyShiftToggle = useCallback(
    (iframeDoc: Document, element: HTMLElement) => {
      const selected = getSelectedEls(iframeDoc);

      if (element.classList.contains("selected")) {
        element.classList.remove("selected");
        commitSelection(iframeDoc);
        return;
      }

      const ancestors = selected.filter((s) => s !== element && s.contains(element));
      if (ancestors.length > 0) {
        // 祖先が選択済みのまま子孫を足すと群の境界が壊れるので、両立はさせない。
        // 従来はここで何もせず黙っていたため「なぜか選択できない」に見えた。
        // Figmaと同じく、祖先を外して子孫へ入れ替える(他の選択は保つ)
        ancestors.forEach((s) => s.classList.remove("selected"));
      }
      selected.forEach((s) => {
        if (s !== element && element.contains(s)) s.classList.remove("selected");
      });
      element.classList.add("selected");
      commitSelection(iframeDoc, element);
    },
    [getSelectedEls, commitSelection],
  );

  /**
   * 押した点を内側に含む「選択済み要素」を返す
   *
   * 群のメンバーを掴んだときにコンテキスト解決で祖先へ引き上げてしまうと、
   * 「掴んだ要素」と「選択済み要素」が食い違って群が壊れる。掴み判定は
   * 生の座標ターゲットから選択済み要素を直接引く。
   */
  const findSelectedHit = useCallback(
    (rawTarget: HTMLElement, iframeDoc: Document): HTMLElement | null => {
      for (const el of getSelectedEls(iframeDoc)) {
        if (el === rawTarget || el.contains(rawTarget)) return el;
      }
      return null;
    },
    [getSelectedEls],
  );

  /**
   * 「いまクリックしたら選択されるであろう要素」（ホバー予告用）
   * mousedown の役割決定とまったく同じ順序で解決する
   */
  const resolveHoverTarget = useCallback(
    (
      target: EventTarget | null,
      iframeDoc: Document,
      opts: { meta: boolean },
    ): HTMLElement | null => {
      const hit = getEditableElement(target, iframeDoc);
      if (!hit) return null;
      if (opts.meta) return hit; // Cmd/Ctrl は最深要素
      const rawTarget = target as HTMLElement;
      const selectedHit =
        rawTarget && typeof rawTarget.closest === "function"
          ? findSelectedHit(rawTarget, iframeDoc)
          : null;
      if (selectedHit) return selectedHit;
      return resolveByContext(hit, iframeDoc, { readonly: true });
    },
    [getEditableElement, findSelectedHit, resolveByContext],
  );

  /**
   * mouseup で Shift の意味と「群 → 単独」を確定させる
   * 閾値を超えて動いていたらドラッグだったとみなし、選択は一切変えない
   */
  const handleSelectionMouseUp = useCallback(
    (e: MouseEvent, iframeDoc: Document) => {
      const pending = pendingClickRef.current;
      pendingClickRef.current = null;
      if (!pending) return;
      if (!pending.element.isConnected) return;

      const moved =
        Math.abs(e.clientX - pending.startX) > MARQUEE_DRAG_THRESHOLD ||
        Math.abs(e.clientY - pending.startY) > MARQUEE_DRAG_THRESHOLD;
      if (moved) return; // ドラッグ（Shiftなら軸拘束）だったのでトグルは取り消す

      if (pending.shift) {
        applyShiftToggle(iframeDoc, pending.element);
        return;
      }
      // 群のメンバーを素クリック（動かさず離した）→ その1つだけの選択に落ちる
      if (pending.wasMulti && pending.wasSelected) {
        selectSingle(iframeDoc, pending.element);
      }
    },
    [applyShiftToggle, selectSingle],
  );

  const setupSelectionListeners = useCallback(
    (iframeDoc: Document) => {
      /**
       * マウスダウンイベントハンドラ
       */
      /**
       * 群リサイズ(複数選択のバウンディングボックスのハンドルをドラッグ)。
       *
       * 群バウンディングボックスを基準に倍率を出し、各メンバーの位置と寸法を
       * 同じ倍率でスケールする(Figmaと同じ。文字サイズは変えない)。
       * 掴んだハンドルの反対側の辺・角が固定点。
       * 単一リサイズの機構(resizeState)には相乗りせず、ここで完結させる。
       */
      const startGroupResize = (handleName: string, downEvent: MouseEvent) => {
        const scale = getArtboardScale(iframeDoc) || 1;
        const members = (
          [...iframeDoc.querySelectorAll('.selected:not(.selection-box)')] as HTMLElement[]
        ).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            el,
            rect: r,
            left: el.offsetLeft,
            top: el.offsetTop,
            w: el.offsetWidth,
            h: el.offsetHeight,
          };
        });
        if (members.length < 2) return;

        const minL = Math.min(...members.map((m) => m.rect.left));
        const minT = Math.min(...members.map((m) => m.rect.top));
        const maxR = Math.max(...members.map((m) => m.rect.right));
        const maxB = Math.max(...members.map((m) => m.rect.bottom));
        const bboxW = maxR - minL;
        const bboxH = maxB - minT;
        if (bboxW < 1 || bboxH < 1) return;

        const fitX = handleName.includes('e') || handleName.includes('w');
        const fitY = handleName.includes('n') || handleName.includes('s');
        const anchorX = handleName.includes('w') ? maxR : minL;
        const anchorY = handleName.includes('n') ? maxB : minT;
        const startX = downEvent.clientX;
        const startY = downEvent.clientY;

        const frameRect = () =>
          (iframeDoc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();

        const applyAt = (clientX: number, clientY: number, shift: boolean) => {
          const dx = clientX - startX;
          const dy = clientY - startY;
          let sx = fitX
            ? (bboxW + (handleName.includes('w') ? -dx : dx)) / bboxW
            : 1;
          let sy = fitY
            ? (bboxH + (handleName.includes('n') ? -dy : dy)) / bboxH
            : 1;
          // Shift: 角なら等比(変化の大きい軸に合わせる)
          if (shift && fitX && fitY) {
            const u = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
            sx = u;
            sy = u;
          }
          sx = Math.max(0.05, sx);
          sy = Math.max(0.05, sy);
          members.forEach((m) => {
            if (fitX || (shift && fitY)) {
              const newClientLeft = anchorX + (m.rect.left - anchorX) * sx;
              m.el.style.left = `${m.left + (newClientLeft - m.rect.left) / scale}px`;
              m.el.style.width = `${Math.max(4, (m.w * sx))}px`;
            }
            if (fitY || (shift && fitX)) {
              const newClientTop = anchorY + (m.rect.top - anchorY) * sy;
              m.el.style.top = `${m.top + (newClientTop - m.rect.top) / scale}px`;
              m.el.style.height = `${Math.max(4, (m.h * sy))}px`;
            }
          });
          syncSelectionOverlayRects(iframeDoc);
        };

        const onIframeMove = (ev: MouseEvent) => applyAt(ev.clientX, ev.clientY, ev.shiftKey);
        const onWinMove = (ev: MouseEvent) => {
          // 親ウィンドウの座標を iframe 基準へ(カーソルが iframe の外へ出ても追従する)
          const fr = frameRect();
          if (!fr) return;
          applyAt(ev.clientX - fr.left, ev.clientY - fr.top, ev.shiftKey);
        };
        const finish = () => {
          iframeDoc.removeEventListener('mousemove', onIframeMove);
          iframeDoc.removeEventListener('mouseup', finish);
          window.removeEventListener('mousemove', onWinMove);
          window.removeEventListener('mouseup', finish);
          refreshSelectionOverlay(iframeDoc);
          const first = members[0]?.el;
          if (first) sendElementInfo(first, iframeDoc);
          window.postMessage(
            { type: 'SLIDE_CONTENT_CHANGED', html: getArtboardContent(iframeDoc) },
            '*',
          );
        };
        iframeDoc.addEventListener('mousemove', onIframeMove);
        iframeDoc.addEventListener('mouseup', finish);
        window.addEventListener('mousemove', onWinMove);
        window.addEventListener('mouseup', finish);
      };

      const handleMouseDown = (e: MouseEvent) => {
        // トリミング中は選択・ドラッグを一切動かさない(crop-mode.ts が全操作を持つ)
        if (iframeDoc.body.classList.contains("gg-cropping")) return;

        // コンテキストメニューを閉じる（右クリック以外）
        if (e.button !== 2) {
          window.postMessage({ type: "IFRAME_CLICK" }, "*");
        }

        // 右クリックはここで打ち切る。
        // 以前は左クリックと同じ経路を通っていたため、複数選択したまま右クリック
        // すると「掴んだ1個だけの選択」に畳まれ、メニューが単独要素にしか
        // 効かなくなっていた。選択の切り替えが必要なとき（選択外を右クリック）
        // だけ contextmenu ハンドラ側で単独選択にする。
        if (e.button === 2) return;

        // テキスト編集中の要素があれば、フォーカスを解除して編集を終了
        const editingElement = iframeDoc.querySelector(
          '[contenteditable="true"]',
        ) as HTMLElement | null;
        if (
          editingElement &&
          editingElement !== e.target &&
          !editingElement.contains(e.target as Node)
        ) {
          editingElement.blur();
          editingElement.classList.remove("editing");
          editingElement.removeAttribute("contenteditable");

          // テキスト選択をクリア
          const selection = iframeDoc.getSelection();
          if (selection) {
            selection.removeAllRanges();
          }

          // 選択ボックスを再表示（まだ選択されている場合）
          if (editingElement.classList.contains("selected")) {
            updateSelectionBox(iframeDoc, editingElement);
          }
          console.log("[Canvas] Text editing exited via click elsewhere");
        }

        // 描画モード・テキストモードでは選択しない
        const bodyClasses = iframeDoc.body.classList;
        if (
          bodyClasses.contains("draw-mode") ||
          bodyClasses.contains("text-mode") ||
          bodyClasses.contains("comment-mode")
        )
          return;

        // リサイズハンドル・回転ハンドルのクリック処理
        const clickedElement = e.target as HTMLElement;
        const handleType = clickedElement.getAttribute?.("data-handle");
        if (handleType) {
          e.preventDefault();
          e.stopPropagation();

          // ダブルクリック = 中身にフィット(Figmaと同じ)。
          // 右辺なら幅を最長行へ、下辺なら高さへ、角なら両方。反対側の辺は固定
          const prevDown = lastHandleDownRef.current;
          lastHandleDownRef.current = {
            handle: handleType, time: Date.now(), x: e.clientX, y: e.clientY,
          };
          if (
            prevDown &&
            prevDown.handle === handleType &&
            Date.now() - prevDown.time < 400 &&
            Math.abs(e.clientX - prevDown.x) < 4 &&
            Math.abs(e.clientY - prevDown.y) < 4 &&
            !handleType.startsWith("rotate") &&
            handleType !== "radius"
          ) {
            lastHandleDownRef.current = null;
            const fitTarget = iframeDoc.querySelector(
              ".selected:not(.selection-box)",
            ) as HTMLElement | null;
            if (fitTarget) {
              const { changed } = fitElementToContent(fitTarget, iframeDoc, handleType);
              if (changed) {
                updateSelectionBox(iframeDoc, fitTarget);
                sendElementInfo(fitTarget, iframeDoc);
                window.postMessage(
                  { type: "SLIDE_CONTENT_CHANGED", html: getArtboardContent(iframeDoc) },
                  "*",
                );
              }
            }
            return;
          }

          // 群バウンディングボックスのハンドル(elementIdを持たない)
          if (clickedElement.getAttribute("data-group-handle") === "true") {
            startGroupResize(handleType, e);
            return;
          }

          const elementId = clickedElement.getAttribute("data-element-id");
          // data-editable="true"を追加してリサイズハンドル自体を選択しないようにする
          const targetEl = elementId
            ? (iframeDoc.querySelector(
                `[data-editable="true"][data-element-id="${elementId}"]`,
              ) as HTMLElement)
            : null;

          if (targetEl) {
            // リサイズ/回転の開始（選択は維持）
            const rect = targetEl.getBoundingClientRect();
            const computedStyle =
              iframeDoc.defaultView?.getComputedStyle(targetEl);
            const currentTransform = computedStyle?.transform || "";
            const rotateMatch = currentTransform.match(/rotate\(([^)]+)deg\)/);
            const currentRotation = rotateMatch
              ? parseFloat(rotateMatch[1])
              : 0;

            // ズームスケールを考慮（getBoundingClientRectはスケール後の値を返す）
            const scale = zoomRef.current / 100;
            const actualWidth = rect.width / scale;
            const actualHeight = rect.height / scale;

            // 回転ハンドルの場合
            if (handleType.startsWith("rotate-")) {
              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;
              const startAngle =
                Math.atan2(e.clientY - centerY, e.clientX - centerX) *
                (180 / Math.PI);

              resizeStateRef.current = {
                isResizing: false,
                isRotating: true,
                element: targetEl,
                elements: [],
                handle: handleType,
                startX: e.clientX,
                startY: e.clientY,
                origLeft: parseFloat(targetEl.style.left) || 0,
                origTop: parseFloat(targetEl.style.top) || 0,
                origWidth: actualWidth,
                origHeight: actualHeight,
                origRadius: 0,
                selectionBounds: null,
                origElementStates: [],
                origScaleX: 1,
                origScaleY: 1,
                rotation: currentRotation,
                rotationStartAngle: startAngle,
                centerX,
                centerY,
              };
              iframeDoc.body.classList.add("rotating");
              console.log("[Canvas] Rotation started:", handleType);
            } else if (handleType === "radius") {
              // 角丸ハンドル
              const borderRadius =
                parseFloat(computedStyle?.borderRadius || "0") || 0;
              resizeStateRef.current = {
                isResizing: true,
                isRotating: false,
                element: targetEl,
                elements: [],
                handle: "radius",
                startX: e.clientX,
                startY: e.clientY,
                origLeft: parseFloat(targetEl.style.left) || 0,
                origTop: parseFloat(targetEl.style.top) || 0,
                origWidth: actualWidth,
                origHeight: actualHeight,
                origRadius: borderRadius,
                selectionBounds: null,
                origElementStates: [],
                origScaleX: 1,
                origScaleY: 1,
                rotation: currentRotation,
                rotationStartAngle: 0,
                centerX: 0,
                centerY: 0,
              };
              console.log("[Canvas] Border radius resize started");
            } else {
              // 通常のリサイズハンドル
              resizeStateRef.current = {
                isResizing: true,
                isRotating: false,
                element: targetEl,
                elements: [],
                handle: handleType,
                startX: e.clientX,
                startY: e.clientY,
                origLeft: parseFloat(targetEl.style.left) || 0,
                origTop: parseFloat(targetEl.style.top) || 0,
                origWidth: actualWidth,
                origHeight: actualHeight,
                origRadius: 0,
                selectionBounds: null,
                origElementStates: [],
                origScaleX: 1,
                origScaleY: 1,
                rotation: currentRotation,
                rotationStartAngle: 0,
                centerX: 0,
                centerY: 0,
              };
              console.log("[Canvas] Resize started:", handleType);
            }
          }
          return;
        }

        // 【最優先チェック】生のe.targetで選択済み要素内のクリックを検出
        // getEditableElementを呼ぶ前にチェックすることで、
        // DOM変換による検出漏れを防ぐ
        const rawTarget = e.target as HTMLElement;
        const existingIds = selectedElementIdsRef.current;

        // selection-boxをクリックした場合、対象要素のドラッグを開始。
        // Cmd/Ctrl(最下層を選ぶ)と Shift(追加/解除)は下の判別器に任せる。
        // 以前は Cmd でもここで掴んでいたため、選択中の器の上で Cmd+クリックしても
        // 中の要素を選べなかった(Figmaでは選べる)
        const selectionBox = rawTarget.closest(
          ".selection-box",
        ) as HTMLElement | null;
        if (selectionBox && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          const forElementId = selectionBox.getAttribute("data-for-element");
          if (forElementId) {
            const targetEl = iframeDoc.querySelector(
              `[data-element-id="${forElementId}"]`,
            ) as HTMLElement | null;

            if (targetEl) {
              e.preventDefault();
              e.stopPropagation();

              // 複数選択の場合は複数ドラッグ
              if (existingIds.length > 1) {
                const selectedElements = existingIds
                  .map(
                    (id) =>
                      iframeDoc.querySelector(
                        `[data-element-id="${id}"]`,
                      ) as HTMLElement,
                  )
                  .filter((el) => el !== null);

                if (selectedElements.length > 0) {
                  const started = startGroupDrag(
                    selectedElements,
                    e,
                    iframeDoc,
                  );
                  console.log(
                    "[Canvas] Multi-element drag via selection-box:",
                    existingIds,
                    started ? "started" : "blocked",
                  );
                }
              } else {
                // 単一選択時：対象要素をドラッグ
                startElementDrag(targetEl, e, iframeDoc);
                console.log(
                  "[Canvas] Drag via selection-box for:",
                  forElementId,
                );
              }
              return;
            }
          }
        }

        // ============================================================
        // 【1本の判別器】①ヒットテスト → ②役割決定 → ③保留
        //
        // [なぜ1か所に集約したか]
        // 従来は「押した点が空白か編集可能要素か」を判別する前に修飾キーで
        // 分岐しており、Cmd が最初に return するせいで
        //   - マーキーと Cmd リーフ選択が1本の経路を共有
        //   - 素ドラッグにはマーキーが割り当てられていない
        //   - Shift 分岐が resolveByContext を通らず Cmd と同じ結果になる
        //   - 空白クリックが選択を消さない
        // という食い違いが生まれていた。役割は必ず「押した点」から決める。
        // ============================================================

        // ---- ① ヒットテスト ----
        // 選択枠(オーバーレイ)の上で押した場合、e.target は枠なので紙面の要素が分からない。
        // 枠の下にある要素を elementsFromPoint で拾い、それを押した点として扱う
        // (Cmd+クリックの最下層選択、Shift+クリックの追加/解除がここを通る)
        let hitSource: Element | null = rawTarget;
        if (selectionBox && typeof iframeDoc.elementsFromPoint === "function") {
          hitSource =
            iframeDoc
              .elementsFromPoint(e.clientX, e.clientY)
              .find(
                (el) =>
                  !el.closest(
                    ".selection-box,.marquee-selection-box,[data-editor-overlay],#gg-smart-guides,#gg-measure-layer",
                  ),
              ) ?? null;
        }
        const hit = getEditableElement(hitSource, iframeDoc);
        // 空白＝押した点の祖先に編集可能要素がまったく無い状態。
        // #artboard / 紙面と同じ大きさの器 / #artboard-wrapper / #canvas-container は
        // initializeEditableElements が意図的に data-editable を付けないので
        // ここで自然に「空白」と判定される（IDの白リストは不要）。
        const isBlank =
          !hit &&
          !(hitSource && typeof hitSource.closest === "function"
            ? hitSource.closest('[data-editable="true"]')
            : null);

        // ---- ② 役割決定 ----

        // 空白: ドラッグ＝マーキー / クリック＝選択解除
        if (isBlank) {
          e.preventDefault();
          pendingClickRef.current = null;
          if (marqueeAdditiveRef) marqueeAdditiveRef.current = e.shiftKey;
          if (!e.shiftKey) {
            // Figma と同じく、空白を押した瞬間に選択は消える。
            // （従来は selectionContextRef を null にするだけで選択が残っていた）
            clearSelection(iframeDoc);
          }
          marqueeClickTargetRef.current = null;
          const geom: MarqueeState = {
            isActive: false,
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
          };
          // 同期の ref を先に確定させる（React state の反映待ちで始点がずれるのを防ぐ）
          if (marqueeGeomRef) marqueeGeomRef.current = { ...geom };
          setMarqueeStateRef.current(geom);
          marqueeStartPendingRef.current = true;
          console.log(
            "[Canvas] Marquee pending (blank) at",
            e.clientX,
            e.clientY,
            e.shiftKey ? "(additive)" : "",
          );
          return;
        }

        // 編集可能な祖先はあるが解決できない（テキストフロー内の純インライン等）
        if (!hit) return;
        if (hit.getAttribute("contenteditable") === "true") return;

        const meta = e.metaKey || e.ctrlKey;

        // 押した点を含む「選択済み要素」。あればそれを掴んだものとして扱う。
        // （コンテキスト解決で祖先へ引き上げると、掴んだ要素と選択済み要素が
        //   食い違って群が壊れる）
        const selectedHit = findSelectedHit(
          (hitSource as HTMLElement | null) ?? rawTarget,
          iframeDoc,
        );

        let target: HTMLElement;
        if (meta) {
          // Cmd/Ctrl: 階層を無視して最深要素。
          // Shift併用なら「最深要素をトグル追加」(mouseupで確定)= Figmaの複数選択。
          // 従来 meta+shift をここから外していたため、選択済みの祖先を掴んだ扱いになり
          // 「追加」のつもりが「解除」になる・そもそも深い要素を足せない、が起きていた
          target = hit;
        } else if (selectedHit) {
          target = selectedHit; // 選択済みを掴んだ
        } else {
          // 素クリックも Shift+クリックも同じ resolveByContext を通す。
          // （従来 Shift は生の最深要素を使っていたため Cmd と同一結果だった）
          target = resolveByContext(hit, iframeDoc);
        }

        if (target.getAttribute("contenteditable") === "true") {
          console.log("[Canvas] Skip - contenteditable active");
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const elementId = target.getAttribute("data-element-id") || "";
        const isSelected = target.classList.contains("selected");

        // ---- ③ 保留 ----
        // Shift の意味（トグル / 軸拘束ドラッグ）と「群→単独の畳み込み」は
        // mouseup で移動量を見て確定させる
        pendingClickRef.current = {
          element: target,
          elementId,
          shift: e.shiftKey,
          wasSelected: isSelected,
          wasMulti: existingIds.length > 1,
          startX: e.clientX,
          startY: e.clientY,
        };

        if (isSelected) {
          // 選択済みを掴んだ → 群/単独ドラッグを開始（Shift でも同じ）
          if (existingIds.length > 1) {
            const selectedElements = existingIds
              .map(
                (id) =>
                  iframeDoc.querySelector(
                    `[data-element-id="${id}"]`,
                  ) as HTMLElement,
              )
              .filter((el) => el !== null);
            if (selectedElements.length > 0) {
              const started = startGroupDrag(selectedElements, e, iframeDoc);
              console.log(
                "[Canvas] Group drag:",
                existingIds.length,
                started ? "started" : "blocked",
              );
            }
          } else {
            startElementDrag(target, e, iframeDoc);
            console.log("[Canvas] Single drag start:", elementId);
          }
          return;
        }

        if (e.shiftKey) {
          // 未選択 + Shift → 追加するかは mouseup で確定（ここでは動かさない）
          console.log("[Canvas] Shift add pending:", elementId);
          return;
        }

        // 未選択 + 素クリック → その場で単独選択してドラッグ開始（モード非依存）
        selectSingle(iframeDoc, target);
        startElementDrag(target, e, iframeDoc);
        console.log("[Canvas] Select + drag start:", elementId);
      };

      /**
       * 要素がテキスト編集可能かどうかを判定
       * - 直接テキストノードを含む場合
       * - または特定のテキスト系タグの場合
       */
      /** 中に文字を置ける図形か(線・ペンは除く) */
      const isTextBearingShape = (element: HTMLElement): boolean => {
        const t = element.getAttribute("data-shape-type");
        return !!t && !["line", "arrow", "pen", "pencil", "icon"].includes(t);
      };

      const isTextEditable = (element: HTMLElement): boolean => {
        // 既に編集中なら無視
        if (element.getAttribute("contenteditable") === "true") return false;

        // 図形は空でも文字を入れられる(PowerPointと同じ)
        if (isTextBearingShape(element)) return true;

        // 画像やSVGは編集不可
        const tagName = element.tagName.toUpperCase();
        if (["IMG", "SVG", "VIDEO", "IFRAME", "CANVAS"].includes(tagName))
          return false;

        // 直接テキストノードを含むかチェック
        for (const child of element.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
            return true;
          }
        }

        // テキスト系タグで、子要素がテキストのみの場合も編集可能
        const textTags = [
          "P",
          "H1",
          "H2",
          "H3",
          "H4",
          "H5",
          "H6",
          "SPAN",
          "A",
          "LABEL",
          "LI",
          "TD",
          "TH",
          "BUTTON",
        ];
        if (textTags.includes(tagName) && element.textContent?.trim()) {
          return true;
        }

        return false;
      };

      /**
       * テキスト編集モードを開始
       */
      const enableTextEditing = (element: HTMLElement) => {
        // 図形に初めて文字を入れるときは、中央寄せと余白を用意する
        // (PowerPointの図形内テキストと同じ見え方にするため)
        if (isTextBearingShape(element) && !element.textContent?.trim()) {
          const s = element.style;
          s.display = "flex";
          s.alignItems = "center";
          s.justifyContent = "center";
          s.textAlign = "center";
          if (!s.padding) s.padding = "16px 24px";
          if (!s.color) s.color = "#ffffff";
          if (!s.fontSize) s.fontSize = "28px";
          if (!s.lineHeight) s.lineHeight = "1.4";
          s.overflowWrap = "anywhere";
        }
        element.setAttribute("contenteditable", "true");
        element.classList.add("editing");

        // 選択ボックスを非表示にして編集に集中
        iframeDoc
          .querySelectorAll(".selection-box")
          .forEach((box) => box.remove());

        // 紙面が飛ぶのを防ぐ(キャレット追従のスクロールを打ち消す)。
        // 祖先のスクロール位置は focus の前に覚える必要があるので、フォーカスより先に張る
        lockCaretScroll(element, iframeDoc);

        // preventScroll: ダブルクリックした場所は既に見えているので、フォーカスでの
        // スクロールは要らない(あると編集に入った瞬間に紙面が動く)
        element.focus({ preventScroll: true });

        // テキスト全体を選択（オプション）
        const selection = iframeDoc.getSelection();
        if (selection) {
          const range = iframeDoc.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      };

      /**
       * ダブルクリックイベントハンドラ（Figmaスタイル）
       * - Ctrl/Cmd + ダブルクリック → テキスト編集開始
       * - 既に選択済みの要素をダブルクリック → テキスト編集開始
       * - それ以外 → ドリルダウン選択のみ
       */
      const handleDoubleClick = (e: MouseEvent) => {
        const bodyClasses = iframeDoc.body.classList;
        if (bodyClasses.contains("gg-cropping")) return;
        if (
          bodyClasses.contains("draw-mode") ||
          bodyClasses.contains("text-mode") ||
          bodyClasses.contains("comment-mode")
        )
          return;


        const isCtrlCmd = e.ctrlKey || e.metaKey;
        const deepElement = getEditableElement(e.target, iframeDoc);

        if (!deepElement) return;

        e.preventDefault();
        e.stopPropagation();

        const elementId = deepElement.getAttribute("data-element-id") || "";
        const currentSelectedIds = selectedElementIdsRef.current;
        const isAlreadySelected = currentSelectedIds.includes(elementId);

        // Ctrl/Cmd + ダブルクリック、または既に選択済みの要素をダブルクリック
        // → テキスト編集可能ならテキスト編集開始
        if ((isCtrlCmd || isAlreadySelected) && isTextEditable(deepElement)) {
          // 既存の選択をクリア
          iframeDoc
            .querySelectorAll(".selected")
            .forEach((el) => el.classList.remove("selected"));
          iframeDoc
            .querySelectorAll(".selection-box")
            .forEach((box) => box.remove());

          deepElement.classList.add("selected");
          setSelectedElementIdsRef.current([elementId]);
          enableTextEditing(deepElement);
          console.log(
            "[Canvas] Text editing started via double-click:",
            elementId,
          );
          sendElementInfo(deepElement, iframeDoc);
          return;
        }

        // それ以外 → **必ず枠が変わる段まで**潜る(Figmaのダブルクリック相当)
        //
        // [なぜ「1段ずつ」をやめたか]
        // DOM を1段ずつ潜ると、親と同じ矩形のラッパー div（レイアウト用の
        // 中間ノード）を踏んだ段では選択枠が1pxも動かず、
        // 「ダブルクリックしても何も起きない」ように見える。
        // 矩形が起点と一致する段は読み飛ばし、枠が変わる段で止める。
        const selectedNow = currentSelectedIds[0]
          ? iframeDoc.querySelector<HTMLElement>(
              `[data-element-id="${currentSelectedIds[0]}"]`,
            )
          : null;

        // 潜る起点：いまの選択がクリック位置を含むならそれ、
        // そうでなければ「素クリックで選ばれる要素」
        const base =
          selectedNow &&
          selectedNow !== deepElement &&
          selectedNow.contains(deepElement)
            ? selectedNow
            : resolveByContext(deepElement, iframeDoc);

        let drilled: HTMLElement = deepElement;
        if (base !== deepElement && base.contains(deepElement)) {
          const baseRect = base.getBoundingClientRect();
          // 画面上2px未満の差は「枠が動いていない」と同じに見えるので同一扱いにする。
          // （getBoundingClientRect はズーム後の実寸なので、この2pxは見た目の2px）
          const SAME_RECT_TOLERANCE = 2;
          const sameRect = (el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return (
              Math.abs(r.left - baseRect.left) < SAME_RECT_TOLERANCE &&
              Math.abs(r.top - baseRect.top) < SAME_RECT_TOLERANCE &&
              Math.abs(r.width - baseRect.width) < SAME_RECT_TOLERANCE &&
              Math.abs(r.height - baseRect.height) < SAME_RECT_TOLERANCE
            );
          };

          selectionContextRef.current = base;
          drilled = resolveByContext(deepElement, iframeDoc);

          let guard = 0;
          while (drilled !== deepElement && sameRect(drilled) && guard++ < 20) {
            selectionContextRef.current = drilled;
            const next = resolveByContext(deepElement, iframeDoc);
            if (next === drilled) break;
            drilled = next;
          }
          // 次のクリック/ダブルクリックのために、コンテキストは
          // 「選ばれた要素の親」＝いま入っているコンテナに合わせる
          selectionContextRef.current = drilled.parentElement;
        }

        iframeDoc
          .querySelectorAll(".selected")
          .forEach((el) => el.classList.remove("selected"));
        drilled.classList.add("selected");
        setSelectedElementIdsRef.current([
          drilled.getAttribute("data-element-id") || "",
        ]);
        refreshSelectionOverlay(iframeDoc);
        sendElementInfo(drilled, iframeDoc);
      };

      /**
       * クリックイベントハンドラ
       * <a>タグのデフォルト動作（リンク遷移）を防ぐ
       */
      const handleClick = (e: MouseEvent) => {
        if (iframeDoc.body.classList.contains("gg-cropping")) return;
        const target = e.target as HTMLElement;

        // <a>タグまたはその子要素がクリックされた場合
        const anchorElement = target.closest("a");
        if (anchorElement) {
          // エディタ内ではリンクのデフォルト動作を常に防ぐ
          e.preventDefault();
        }
      };

      // イベントリスナーを登録
      /**
       * パンくず(選択枠の上に出る祖先チップ)からの選択。
       *
       * 従来は useEditorMessages が独自にDOMを触って選択していたため、
       * このフックが持つ選択状態(selectionContextRef)が古いまま残り、
       * 次の操作で元の要素へ戻ってしまっていた。正規の selectSingle を通す。
       */
      const handleBreadcrumbSelect = (e: MessageEvent) => {
        if (e.data?.type !== "breadcrumb-select" || !e.data.elementId) return;
        const el = iframeDoc.querySelector(
          `[data-element-id="${e.data.elementId}"]`,
        ) as HTMLElement | null;
        if (el) selectSingle(iframeDoc, el);
      };

      iframeDoc.addEventListener("mousedown", handleMouseDown);
      iframeDoc.addEventListener("click", handleClick);
      iframeDoc.addEventListener("dblclick", handleDoubleClick);
      window.addEventListener("message", handleBreadcrumbSelect);

      // クリーンアップ関数を返す
      return () => {
        iframeDoc.removeEventListener("mousedown", handleMouseDown);
        iframeDoc.removeEventListener("click", handleClick);
        iframeDoc.removeEventListener("dblclick", handleDoubleClick);
        window.removeEventListener("message", handleBreadcrumbSelect);
      };
    },
    [
      getEditableElement,
      getTopLevelEditable,
      resolveByContext,
      startElementDrag,
      startGroupDrag,
      sendElementInfo,
      findSelectedHit,
      selectSingle,
      clearSelection,
      dragStateRef,
      marqueeStartPendingRef,
      marqueeClickTargetRef,
      marqueeAdditiveRef,
      marqueeGeomRef,
      resizeStateRef,
    ],
  );

  return {
    getEditableElement,
    getTopLevelEditable,
    startElementDrag,
    sendElementInfo,
    setupSelectionListeners,
    resolveHoverTarget,
    handleSelectionMouseUp,
  };
}
