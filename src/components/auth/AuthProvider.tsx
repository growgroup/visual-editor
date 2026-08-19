import { createContext, useContext, type ReactNode } from 'react'

/**
 * 認証スタブ。オリジナルは Firebase Auth の Context。
 * このプロジェクトはバックエンド無しのローカル編集用途のため、
 * 「常にローカルユーザーでログイン済み」として振る舞う。
 */
// `id` は `uid` のエイリアス。移植元コードには user.uid / user.id 両方の参照があるため両対応にする。
type StubUser = { uid: string; id: string; email: string | null; displayName: string | null }

type AuthContextType = {
  user: StubUser | null
  loading: boolean
  getIdToken: () => Promise<string | null>
  signOut: () => Promise<void>
}

const LOCAL_USER: StubUser = { uid: 'local', id: 'local', email: null, displayName: 'Local' }

const AuthContext = createContext<AuthContextType>({
  user: LOCAL_USER,
  loading: false,
  getIdToken: async () => 'local-dev',
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        user: LOCAL_USER,
        loading: false,
        getIdToken: async () => 'local-dev',
        signOut: async () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  return useContext(AuthContext)
}
