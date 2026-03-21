import { useEffect } from 'react'

export const mockRouterPush = jest.fn()
export const mockRouterReplace = jest.fn()
export const mockRouterBack = jest.fn()

export const useRouter = jest.fn(() => ({
  push: mockRouterPush,
  replace: mockRouterReplace,
  back: mockRouterBack,
}))

export const useLocalSearchParams = jest.fn(() => ({}) as Record<string, string>)

// useFocusEffect はテスト環境では通常の useEffect として動作させる
export const useFocusEffect = (cb: () => (() => void) | void) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => cb() ?? undefined, [])
}
