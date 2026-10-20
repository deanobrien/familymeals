// Stand-in for @react-native-async-storage/async-storage under plain Node (see ../../vitest.live.config.mts).
const data = new Map<string, string>();

const AsyncStorage = {
  getItem: async (k: string) => data.get(k) ?? null,
  setItem: async (k: string, v: string) => void data.set(k, v),
  removeItem: async (k: string) => void data.delete(k),
};

export default AsyncStorage;
