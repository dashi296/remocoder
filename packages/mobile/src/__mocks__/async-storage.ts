const store: Record<string, string | null> = {}

const AsyncStorage = {
  getMany: jest.fn(async (keys: string[]) => {
    const result: Record<string, string | null> = {}
    for (const key of keys) {
      result[key] = store[key] ?? null
    }
    return result
  }),
  setMany: jest.fn(async (entries: Record<string, string>) => {
    Object.assign(store, entries)
  }),
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    store[key] = value
  }),
  clear: jest.fn(async () => {
    Object.keys(store).forEach((k) => delete store[k])
  }),
  _store: store,
}

export default AsyncStorage
