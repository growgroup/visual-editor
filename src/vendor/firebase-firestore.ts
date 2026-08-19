/**
 * `firebase/firestore` の型互換シム。
 *
 * 取り込んだ型定義(types/slide.ts 等)が createdAt/updatedAt の型として
 * Timestamp を参照しているだけで、値としては使っていない。
 * ワイヤーフレーム編集にバックエンドは不要なので、実体を持たない型だけを置く。
 */
export type Timestamp = {
  seconds: number
  nanoseconds: number
  toDate(): Date
  toMillis(): number
}
