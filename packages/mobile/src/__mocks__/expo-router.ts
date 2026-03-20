export const mockRouterPush = jest.fn()
export const mockRouterReplace = jest.fn()
export const mockRouterBack = jest.fn()

export const useRouter = jest.fn(() => ({
  push: mockRouterPush,
  replace: mockRouterReplace,
  back: mockRouterBack,
}))

export const useLocalSearchParams = jest.fn(() => ({}) as Record<string, string>)
